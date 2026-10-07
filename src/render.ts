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
}

export interface RenderArgs {
  comp_id: number;
  output_path: string;
  om_template?: string;
  rs_template?: string;
  overwrite?: boolean;
}

function findAerender(dir: string): string {
  const exe = process.platform === "win32" ? "aerender.exe" : "aerender";
  const candidates = [process.env.AE_AERENDER, path.join(dir, exe), path.join(dir, "Support Files", exe), path.join(path.dirname(dir), exe)];
  for (const c of candidates) if (c && fs.existsSync(c)) return c;
  throw new AeToolError("AE_ERROR", "aerender not found", "Set AE_AERENDER to the full path of the aerender executable");
}

export class RenderManager {
  private jobs = new Map<string, Job>();
  constructor(private bridge: Bridge) {}

  async start(a: RenderArgs) {
    const out = assertAllowed(a.output_path);
    if (fs.existsSync(out) && !a.overwrite) {
      throw new AeToolError("EXISTS", `Output already exists: ${out}`, "Pass overwrite: true or choose another path");
    }
    fs.mkdirSync(path.dirname(out), { recursive: true });

    const prep = await this.bridge.run("prepare_render", { comp_id: a.comp_id });
    if (!prep.ok) throw new AeToolError(prep.error.code, prep.error.message, prep.error.hint);
    const { project_path, comp_name, total_frames, aerender_dir } = prep.result;

    const bin = findAerender(aerender_dir);
    const args = ["-project", project_path, "-comp", comp_name, "-output", out];
    if (a.rs_template) args.push("-RStemplate", a.rs_template);
    if (a.om_template) args.push("-OMtemplate", a.om_template);
    if (a.overwrite) args.push("-OVERWRITE");

    const child = spawn(bin, args, { windowsHide: true });
    const job: Job = { id: randomUUID().slice(0, 8), state: "running", percent: 0, output: out, totalFrames: Math.max(1, total_frames), log: [], child, exitCode: null };
    this.jobs.set(job.id, job);

    const onData = (buf: Buffer) => {
      for (const line of buf.toString().split(/\r?\n/)) {
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
      job.state = "failed";
      job.log.push(String(e));
    });
    child.on("exit", (code) => {
      job.exitCode = code;
      if (job.state === "canceled") return;
      job.state = code === 0 ? "done" : "failed";
      if (code === 0) job.percent = 100;
    });
    return { job_id: job.id, output_path: out };
  }

  private get(id: string): Job {
    const j = this.jobs.get(id);
    if (!j) throw new AeToolError("NOT_FOUND", `Unknown render job: ${id}`);
    return j;
  }

  status(id: string) {
    const j = this.get(id);
    return { job_id: j.id, state: j.state, percent: j.percent, output_path: j.output, output_exists: fs.existsSync(j.output), exit_code: j.exitCode, log_tail: j.log.slice(-10) };
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
