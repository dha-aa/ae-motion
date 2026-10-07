/**
 * Background aerender jobs for render_start / render_status / render_cancel.
 *
 * Jobs live in memory only. Finished jobs are pruned to the most recent {@link MAX_FINISHED_JOBS}, and running
 * jobs are killed by {@link RenderManager.dispose} when the server shuts down.
 */
import { spawn, ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { Bridge } from "../bridge.js";
import { AeToolError } from "../errors.js";
import { assertAllowed } from "../sandbox.js";
import { findAerender, findWrittenOutput } from "./aerender.js";

const MAX_FINISHED_JOBS = 30;
const LOG_LINES_KEPT = 40;
const LOG_LINES_REPORTED = 10;
/** aerender prints e.g. `PROGRESS:  0:00:01:05 (35): 0 Seconds`; the number in parentheses is the frame. */
const PROGRESS_RE = /PROGRESS:\s+\d+:\d+:\d+:\d+\s+\((\d+)\)/;

export type JobState = "running" | "done" | "failed" | "canceled";

interface Job {
  id: string;
  state: JobState;
  percent: number;
  /** The requested output path (after sandboxing). */
  output: string;
  totalFrames: number;
  log: string[];
  child: ChildProcess;
  exitCode: number | null;
  startedAt: number;
  finishedAt?: number;
}

export interface RenderArgs {
  comp_id: number;
  output_path: string;
  om_template?: string;
  rs_template?: string;
  overwrite?: boolean;
}

/** What the host's prepare_render command returns. */
interface PreparedRender {
  project_path: string;
  comp_name: string;
  total_frames: number;
  aerender_dir: string;
}

export class RenderManager {
  private jobs = new Map<string, Job>();

  constructor(private readonly bridge: Bridge) {}

  /**
   * Save the project (via the host's prepare_render) and spawn aerender. Everything that can fail is checked before
   * the existing output file is removed, so a render that never starts keeps the previous file.
   */
  async start(a: RenderArgs): Promise<{ job_id: string; output_path: string }> {
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
    const { project_path, comp_name, total_frames, aerender_dir } = prep.result as PreparedRender;

    const bin = findAerender(aerender_dir);
    const args = ["-project", project_path, "-comp", comp_name, "-output", out];
    if (a.rs_template) args.push("-RStemplate", a.rs_template);
    if (a.om_template) args.push("-OMtemplate", a.om_template);

    if (replacing) fs.rmSync(out, { force: true });

    const child = spawn(bin, args, { windowsHide: true });
    const job: Job = {
      id: randomUUID().slice(0, 8), state: "running", percent: 0, output: out, totalFrames: Math.max(1, total_frames),
      log: [], child, exitCode: null, startedAt: Date.now(),
    };
    this.jobs.set(job.id, job);
    this.watch(job);
    return { job_id: job.id, output_path: out };
  }

  status(id: string) {
    const j = this.get(id);
    let actual = j.output;
    if (j.state === "done" && !fs.existsSync(actual)) actual = findWrittenOutput(j.output, j.startedAt) ?? actual;
    const out: Record<string, unknown> = {
      job_id: j.id, state: j.state, percent: j.percent, output_path: actual, output_exists: fs.existsSync(actual),
      exit_code: j.exitCode, log_tail: j.log.slice(-LOG_LINES_REPORTED),
    };
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

  /** Stop any running aerender processes (called when the MCP server shuts down). */
  dispose(): void {
    for (const j of this.jobs.values()) {
      if (j.state === "running") {
        j.state = "canceled";
        try { j.child.kill(); } catch {}
      }
    }
  }

  /** Follow aerender's output for progress and a log tail, and record how it exits. */
  private watch(job: Job): void {
    let partial = "";
    const onData = (buf: Buffer) => {
      const lines = (partial + buf.toString()).split(/\r?\n/);
      partial = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue;
        job.log.push(line);
        if (job.log.length > LOG_LINES_KEPT) job.log.shift();
        const m = PROGRESS_RE.exec(line);
        if (m) job.percent = Math.min(99, Math.round((parseInt(m[1], 10) / job.totalFrames) * 100));
      }
    };
    job.child.stdout?.on("data", onData);
    job.child.stderr?.on("data", onData);
    job.child.on("error", (e) => {
      if (job.state === "running") job.state = "failed";
      job.log.push(String(e));
    });
    job.child.on("exit", (code, signal) => {
      job.exitCode = code;
      job.finishedAt = Date.now();
      if (job.state === "canceled") return;
      if (signal) job.log.push(`aerender was terminated by ${signal}`);
      job.state = code === 0 ? "done" : "failed";
      if (code === 0) job.percent = 100;
    });
  }

  /** Keep the job table bounded: drop finished jobs beyond the most recent MAX_FINISHED_JOBS. */
  private prune(): void {
    const done = [...this.jobs.values()].filter((j) => j.state !== "running").sort((x, y) => (y.finishedAt ?? 0) - (x.finishedAt ?? 0));
    for (const j of done.slice(MAX_FINISHED_JOBS)) this.jobs.delete(j.id);
  }

  private get(id: string): Job {
    const j = this.jobs.get(id);
    if (!j) throw new AeToolError("NOT_FOUND", `Unknown render job: ${id}`);
    return j;
  }
}
