import { spawn, ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { AeToolError, Bridge } from "./bridge.js";
import { assertAllowed } from "./sandbox.js";

type State = "running" | "done" | "failed" | "canceled";
interface Job {
  id: string;
  state: State;
  percent: number;
  output: string;
  totalFrames: number;
  log: string[];
  child: ChildProcess;
  exitCode: number | null;
  finishedAt?: number;
  startedAt: number;
}

export interface RenderArgs {
  comp_id: number;
  output_path: string;
  om_template?: string;
  rs_template?: string;
  overwrite?: boolean;
}

function aerenderName(): string {
  return process.platform === "win32" ? "aerender.exe" : "aerender";
}

/** Standard install locations, newest version first, for when After Effects does not report a usable folder. */
function installCandidates(exe: string): string[] {
  const out: string[] = [];
  const scan = (root: string, sub: string[]) => {
    let names: string[] = [];
    try { names = fs.readdirSync(root); } catch { return; }
    for (const n of names.filter((x) => /^Adobe After Effects/i.test(x)).sort().reverse()) out.push(path.join(root, n, ...sub, exe));
  };
  if (process.platform === "darwin") scan("/Applications", []);
  else if (process.platform === "win32") {
    for (const root of [process.env["ProgramFiles"], process.env["ProgramFiles(x86)"]]) if (root) scan(path.join(root, "Adobe"), ["Support Files"]);
  }
  return out;
}

/**
 * Locate aerender. Tries AE_AERENDER, then the folder After Effects reported and its parents (the layout differs between
 * macOS and Windows and between versions), then the standard install locations.
 */
export function findAerender(dir: string): string {
  const exe = aerenderName();
  const candidates: (string | undefined)[] = [process.env.AE_AERENDER];
  let cur = dir || "";
  for (let i = 0; i < 5 && cur; i++) {
    candidates.push(path.join(cur, exe), path.join(cur, "Support Files", exe));
    const up = path.dirname(cur);
    if (up === cur) break;
    cur = up;
  }
  candidates.push(...installCandidates(exe));
  for (const c of candidates) if (c && fs.existsSync(c)) return c;
  throw new AeToolError("AE_ERROR", "aerender not found", "Set AE_AERENDER to the full path of the aerender executable");
}

/**
 * After Effects takes the file extension from the output module, so the file it writes can differ from the requested path
 * (for example a .mov request produced .mp4). Look for a file with the same name written since the job started.
 * Partial temp files (name.<pid>.<n>.ext) are ignored.
 */
function findWritten(requested: string, since: number): string | undefined {
  const dir = path.dirname(requested);
  const base = path.basename(requested, path.extname(requested));
  const partial = new RegExp("^" + base.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\.\\d+\\.\\d+\\.");
  let names: string[] = [];
  try { names = fs.readdirSync(dir); } catch { return undefined; }
  let best: { p: string; t: number } | undefined;
  for (const n of names) {
    if (!n.startsWith(base + ".") || partial.test(n)) continue;
    const p = path.join(dir, n);
    let st: fs.Stats;
    try { st = fs.statSync(p); } catch { continue; }
    if (!st.isFile() || st.mtimeMs < since - 2000) continue;
    if (!best || st.mtimeMs > best.t) best = { p, t: st.mtimeMs };
  }
  return best?.p;
}

export class RenderManager {
  private jobs = new Map<string, Job>();
  constructor(private bridge: Bridge) {}

  async start(a: RenderArgs) {
    const out = assertAllowed(a.output_path);
    const replacing = fs.existsSync(out);
    if (replacing) {
      if (!a.overwrite) throw new AeToolError("EXISTS", `Output already exists: ${out}`, "Pass overwrite: true or choose another path");
      if (fs.statSync(out).isDirectory()) throw new AeToolError("BAD_ARGS", `Output path is a directory: ${out}`);
    }
    fs.mkdirSync(path.dirname(out), { recursive: true });
    this.prune();

    const prep = await this.bridge.run("prepare_render", { comp_id: a.comp_id });
    if (!prep.ok) throw new AeToolError(prep.error.code, prep.error.message, prep.error.hint);
    const { project_path, comp_name, total_frames, aerender_dir } = prep.result;

    const bin = findAerender(aerender_dir);
    const args = ["-project", project_path, "-comp", comp_name, "-output", out];
    if (a.rs_template) args.push("-RStemplate", a.rs_template);
    if (a.om_template) args.push("-OMtemplate", a.om_template);

    // Remove the old output only now that nothing else can fail, so a render that never starts keeps the previous file.
    if (replacing) fs.rmSync(out, { force: true });

    const child = spawn(bin, args, { windowsHide: true });
    const job: Job = { id: randomUUID().slice(0, 8), state: "running", percent: 0, output: out, totalFrames: Math.max(1, total_frames), log: [], child, exitCode: null, startedAt: Date.now() };
    this.jobs.set(job.id, job);

    let partial = "";
    const onData = (buf: Buffer) => {
      const chunk = partial + buf.toString();
      const lines = chunk.split(/\r?\n/);
      partial = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue;
        job.log.push(line);
        if (job.log.length > 40) job.log.shift();
        const m = line.match(/PROGRESS:\s+\d+:\d+:\d+:\d+\s+\((\d+)\)/);
        if (m) job.percent = Math.min(99, Math.round((parseInt(m[1], 10) / job.totalFrames) * 100));
      }
    };
    child.stdout?.on("data", onData);
    child.stderr?.on("data", onData);
    child.on("error", (e) => {
      if (job.state === "running") job.state = "failed";
      job.log.push(String(e));
    });
    child.on("exit", (code, signal) => {
      job.exitCode = code;
      job.finishedAt = Date.now();
      if (job.state === "canceled") return;
      if (signal) job.log.push(`aerender was terminated by ${signal}`);
      job.state = code === 0 ? "done" : "failed";
      if (code === 0) job.percent = 100;
    });
    return { job_id: job.id, output_path: out };
  }

  /** Keep the job table bounded: drop finished jobs beyond the 30 most recent. */
  private prune() {
    const done = [...this.jobs.values()].filter((j) => j.state !== "running").sort((x, y) => (y.finishedAt ?? 0) - (x.finishedAt ?? 0));
    for (const j of done.slice(30)) this.jobs.delete(j.id);
  }

  /** Stop any running aerender processes (called when the MCP server shuts down). */
  dispose() {
    for (const j of this.jobs.values()) {
      if (j.state === "running") {
        j.state = "canceled";
        try { j.child.kill(); } catch {}
      }
    }
  }

  private get(id: string): Job {
    const j = this.jobs.get(id);
    if (!j) throw new AeToolError("NOT_FOUND", `Unknown render job: ${id}`);
    return j;
  }

  status(id: string) {
    const j = this.get(id);
    let actual = j.output;
    if (j.state === "done" && !fs.existsSync(actual)) actual = findWritten(j.output, j.startedAt) ?? actual;
    const out: Record<string, unknown> = { job_id: j.id, state: j.state, percent: j.percent, output_path: actual, output_exists: fs.existsSync(actual), exit_code: j.exitCode, log_tail: j.log.slice(-10) };
    if (actual !== j.output) {
      out.requested_path = j.output;
      out.note = "After Effects chose the file extension from the output module, so the file differs from the requested path";
    }
    return out;
  }

  cancel(id: string) {
    const j = this.get(id);
    if (j.state === "running") {
      j.state = "canceled";
      j.child.kill();
    }
    return { job_id: j.id, state: j.state };
  }
}
