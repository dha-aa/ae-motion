/**
 * Background aerender jobs for render_start / render_status / render_cancel.
 *
 * Jobs live in memory only. Finished jobs are pruned to the most recent {@link MAX_FINISHED_JOBS}, and running
 * jobs are killed by {@link RenderManager.dispose} when the server shuts down.
 *
 * aerender can exit 0 after errors it only logs: when After Effects runs out of GPU memory every later frame renders
 * black and the audio drops out, yet the job "finishes". Error lines are collected; a GPU failure fails the job, with
 * the fix (render_start software: true, Mercury Software Only) in the hint.
 */
import { spawn, ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { Bridge } from "../bridge.js";
import { AeToolError } from "../errors.js";
import { assertAllowed } from "../sandbox.js";
import { findAerender, findWrittenOutput } from "./aerender.js";
import { checkMedia, deliver, findFfmpeg, type MediaCheck } from "./check.js";

const MAX_FINISHED_JOBS = 30;
const LOG_LINES_KEPT = 40;
const LOG_LINES_REPORTED = 10;
/** aerender prints e.g. `PROGRESS:  0:00:01:05 (35): 0 Seconds`; the number in parentheses is the frame. */
const PROGRESS_RE = /PROGRESS:\s+\d+:\d+:\d+:\d+\s+\((\d+)\)/;
/** Lines that report a problem, e.g. "After Effects has encountered a failure (code: 19969) related to GPU-enabled effects". */
const ERROR_RE = /encountered a failure|out of memory|cannot allocate|\berror\b/i;
const GPU_RE = /GPU/i;
const MAX_ERRORS = 5;
const GPU_HINT = "After Effects ran out of GPU memory: frames after the failure render black and the audio can drop out. Render again with software: true (Mercury Software Only; slower, no GPU limit)";
const ERROR_HINT = "aerender logged errors while rendering: check the frames they mention (an effect over its limits renders wrong, e.g. Motion Tile over 30000 px)";

/** Frames whose times give the render speed (the recent ones: heavy scenes slow it down). */
const SPEED_SAMPLES = 120;

/**
 * How long a job has taken and how long it still needs: frames done, speed over the recent frames, an estimated
 * finish, and when to poll again (so a client neither polls every second nor waits blind).
 */
export function timing(j: Pick<Job, "state" | "frames" | "totalFrames" | "samples" | "startedAt" | "finishedAt" | "phase">, now = Date.now()) {
  const elapsed = ((j.finishedAt ?? now) - j.startedAt) / 1000, r1 = (x: number) => Math.round(x * 10) / 10;
  const out: Record<string, unknown> = { frames_done: j.frames, total_frames: j.totalFrames, elapsed_s: r1(elapsed) };
  if (j.state !== "running") return out;
  if (j.phase) { out.poll_after_s = 5; return out; }
  if (j.frames === 0) {
    out.phase = "starting";
    out.note = "aerender is launching After Effects and loading the project (often 10-60 s) before the first frame";
    out.poll_after_s = 10;
    return out;
  }
  const [t0, f0] = j.samples[0], [t1, f1] = j.samples[j.samples.length - 1];
  const spf = f1 > f0 && t1 > t0 ? (t1 - t0) / 1000 / (f1 - f0) : elapsed / j.frames;
  const eta = Math.max(0, (j.totalFrames - j.frames) * spf);
  out.seconds_per_frame = Math.round(spf * 100) / 100;
  out.eta_s = Math.round(eta);
  out.finishes_at = new Date(now + eta * 1000).toISOString();
  out.poll_after_s = Math.round(Math.min(60, Math.max(5, eta / 4)));
  return out;
}

/** The file found() returns once it exists and its size has stopped changing, or null after timeoutMs. */
async function settled(found: () => string | null | undefined, timeoutMs: number): Promise<string | null> {
  const end = Date.now() + timeoutMs;
  let last = -1;
  while (Date.now() < end) {
    const f = found();
    if (f) {
      const size = fs.statSync(f).size;
      if (size > 0 && size === last) return f;
      last = size;
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  return found() ?? null;
}

export type JobState = "running" | "done" | "failed" | "canceled";

interface Job {
  id: string;
  state: JobState;
  percent: number;
  /** The requested output path (after sandboxing). */
  output: string;
  totalFrames: number;
  log: string[];
  /** Error lines from aerender's output (first few). */
  errors: string[];
  gpuFailure: boolean;
  /** Frames rendered so far (one aerender PROGRESS line each), and recent [ms, frames] samples for the speed. */
  frames: number;
  samples: [number, number][];
  /** After aerender: encoding the delivery MP4, then checking the result (ffmpeg). */
  phase?: "encoding" | "checking";
  /** The file aerender writes (a ProRes master when delivering), and the delivery target. */
  renderPath: string;
  deliverTo?: string;
  lufs: number;
  verify: boolean;
  check?: MediaCheck | { skipped: string };
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
  /** true: render with Mercury Software Only (no GPU); false: back to the GPU. Saved in the project. */
  software?: boolean;
  /** Check the finished file for black, frozen and silent stretches and its loudness (default: when ffmpeg exists). */
  verify?: boolean;
  /** Render a ProRes master, then encode output_path as an H.264 MP4 at `loudness` LUFS (needs ffmpeg). */
  deliver?: boolean;
  loudness?: number;
  /** Render only the audio (AIFF), to check the mix in seconds instead of rendering the picture. */
  audio_only?: boolean;
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
    if (a.deliver && a.audio_only) throw new AeToolError("BAD_ARGS", "deliver and audio_only cannot be combined", "audio_only checks the mix; deliver makes the final MP4");
    if (a.deliver && !this.ffmpeg()) throw new AeToolError("UNSUPPORTED", "deliver needs ffmpeg, which was not found", "Install ffmpeg (brew install ffmpeg) or set AE_MCP_FFMPEG to its path");
    const replacing = fs.existsSync(out);
    if (replacing) {
      if (!a.overwrite) throw new AeToolError("EXISTS", `Output already exists: ${out}`, "Pass overwrite: true or choose another path");
      if (fs.statSync(out).isDirectory()) throw new AeToolError("BAD_ARGS", `Output path is a directory: ${out}`);
    }
    fs.mkdirSync(path.dirname(out), { recursive: true });
    this.prune();

    const prep = await this.bridge.run("prepare_render", { comp_id: a.comp_id, ...(a.software === undefined ? {} : { software: a.software }) });
    if (!prep.ok) throw new AeToolError(prep.error.code, prep.error.message, prep.error.hint);
    const { project_path, comp_name, total_frames, aerender_dir } = prep.result as PreparedRender;

    const bin = findAerender(aerender_dir);
    // delivering renders a ProRes master next to the target and encodes it afterwards; audio_only renders AIFF
    const renderPath = a.deliver ? out.replace(/(\.[^./\\]+)?$/, ".master.mov") : out;
    const om = a.om_template ?? (a.deliver ? "High Quality" : a.audio_only ? "AIFF 48kHz" : undefined);
    const args = ["-project", project_path, "-comp", comp_name, "-output", renderPath];
    if (a.rs_template) args.push("-RStemplate", a.rs_template);
    if (om) args.push("-OMtemplate", om);

    if (replacing) fs.rmSync(out, { force: true });

    const child = spawn(bin, args, { windowsHide: true });
    const job: Job = {
      id: randomUUID().slice(0, 8), state: "running", percent: 0, output: out, totalFrames: a.audio_only ? 1 : Math.max(1, total_frames),
      log: [], errors: [], gpuFailure: false, frames: 0, samples: [], child, exitCode: null, startedAt: Date.now(),
      renderPath, deliverTo: a.deliver ? out : undefined, lufs: a.loudness ?? -14, verify: a.verify ?? this.ffmpeg() !== null,
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
      job_id: j.id, state: j.state, percent: j.percent, ...timing(j), output_path: actual, output_exists: fs.existsSync(actual),
      exit_code: j.exitCode, log_tail: j.log.slice(-LOG_LINES_REPORTED),
    };
    if (j.phase && j.state === "running") out.phase = j.phase;
    if (j.check) out.check = j.check;
    if (j.errors.length) {
      out.errors = j.errors;
      out.hint = j.gpuFailure ? GPU_HINT : ERROR_HINT;
    }
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
        if (m) {
          // count frames rather than read the frame number: a render of part of a comp starts past frame 1
          job.frames++;
          job.percent = Math.min(99, Math.round((job.frames / job.totalFrames) * 100));
          job.samples.push([Date.now(), job.frames]);
          if (job.samples.length > SPEED_SAMPLES) job.samples.shift();
        }
        else if (ERROR_RE.test(line)) {
          const e = line.replace(/^PROGRESS:\s*/, "").trim();
          if (GPU_RE.test(e)) job.gpuFailure = true;
          if (job.errors.length < MAX_ERRORS && !job.errors.includes(e)) job.errors.push(e);
        }
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
      if (job.state === "canceled") { job.finishedAt = Date.now(); return; }
      if (signal) job.log.push(`aerender was terminated by ${signal}`);
      // a GPU failure leaves black frames behind an exit code of 0
      if (code !== 0 || job.gpuFailure) { job.state = "failed"; job.finishedAt = Date.now(); return; }
      void this.finish(job);
    });
  }

  private ffmpegPath: string | null | undefined;
  private ffmpeg(): string | null {
    if (this.ffmpegPath === undefined) this.ffmpegPath = findFfmpeg();
    return this.ffmpegPath;
  }

  /** After aerender: encode the delivery MP4, then check the file; the job is done only after both. */
  private async finish(job: Job): Promise<void> {
    const fail = (e: string) => { job.errors.push(e); job.state = "failed"; job.finishedAt = Date.now(); };
    // aerender can exit a moment before its file is on disk (seen with a delivery master): wait for it to settle
    let file = await settled(() => (fs.existsSync(job.renderPath) ? job.renderPath : findWrittenOutput(job.renderPath, job.startedAt)), 30_000) ?? job.renderPath;
    const ff = this.ffmpeg();
    if (job.deliverTo && ff) {
      job.phase = "encoding";
      const d = await deliver(ff, file, job.deliverTo, job.lufs);
      if (job.state !== "running") return;
      if (!d.ok) return fail(`Encoding the delivery MP4 failed: ${d.message ?? "ffmpeg error"} (the master is kept at ${file})`);
      fs.rmSync(file, { force: true });
      file = job.deliverTo;
    }
    if (job.verify) {
      if (!ff) job.check = { skipped: "ffmpeg not found: install it or set AE_MCP_FFMPEG to check renders" };
      else {
        job.phase = "checking";
        try { job.check = await checkMedia(ff, file); } catch (e) { job.check = { skipped: `check failed: ${String(e)}` }; }
      }
    }
    if (job.state !== "running") return;
    job.phase = undefined;
    job.state = "done";
    job.percent = 100;
    job.finishedAt = Date.now();
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
