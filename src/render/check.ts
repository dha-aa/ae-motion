/**
 * After-render checks and delivery with ffmpeg (optional: everything here is skipped when ffmpeg is not found).
 *
 * ae-motion cannot watch or hear what it made, so a finished render is checked the way an editor would scrub it:
 * black stretches, frozen picture, silence, and the loudness over time. That caught both failures of a GPU
 * out-of-memory render (black after 29 s, no audio after 45 s) that otherwise only a person watching would see.
 * deliver turns the render (a ProRes master) into a ready-to-post H.264 MP4 at a loudness target (two-pass loudnorm).
 */
import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const run = (bin: string, args: string[], timeoutMs = 15 * 60_000): Promise<{ code: number; out: string }> =>
  new Promise((resolve) => {
    execFile(bin, args, { maxBuffer: 64 * 1024 * 1024, timeout: timeoutMs, windowsHide: true }, (err, stdout, stderr) => {
      const code = err ? (typeof (err as { code?: unknown }).code === "number" ? (err as { code: number }).code : 1) : 0;
      resolve({ code, out: `${stdout}\n${stderr}` });
    });
  });

/** ffmpeg from AE_MCP_FFMPEG, PATH, or the usual install folders; null when there is none. */
export function findFfmpeg(env: NodeJS.ProcessEnv = process.env): string | null {
  if (env.AE_MCP_FFMPEG) return fs.existsSync(env.AE_MCP_FFMPEG) ? env.AE_MCP_FFMPEG : null;
  const exe = process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg";
  const dirs = [...(env.PATH ?? "").split(path.delimiter), "/opt/homebrew/bin", "/usr/local/bin", "/usr/bin"];
  for (const d of dirs) {
    const p = d && path.join(d, exe);
    if (p && fs.existsSync(p)) return p;
  }
  return null;
}

type Span = [number, number];
const r1 = (x: number) => Math.round(x * 10) / 10;

export interface MediaCheck {
  duration_s: number | null;
  has_video: boolean;
  has_audio: boolean;
  /** Stretches of black picture (at least 0.5 s), frozen picture (2 s) and silence (1 s), in seconds. */
  black: Span[];
  frozen: Span[];
  silent: Span[];
  loudness_lufs?: number;
  true_peak_db?: number;
  /** Momentary loudness (LUFS) per second: where the mix is loud, quiet or empty. */
  loudness_timeline?: number[];
  /** Plain-words findings, worst first; empty when nothing looks wrong. */
  issues: string[];
}

/** Pair "x_start: a" / "x_end: b" lines into spans (an open span runs to the end). */
function spans(out: string, key: string, end: number | null): Span[] {
  const re = new RegExp(`${key}_(start|end):\\s*(-?[\\d.]+)`, "g"), res: Span[] = [];
  let open: number | null = null, m: RegExpExecArray | null;
  while ((m = re.exec(out))) {
    const v = parseFloat(m[2]);
    if (m[1] === "start") open = v;
    else if (open !== null) { res.push([r1(open), r1(v)]); open = null; }
  }
  if (open !== null && end !== null) res.push([r1(open), r1(end)]);
  return res;
}

const fmt = (s: Span[]) => s.slice(0, 4).map(([a, b]) => `${a}-${b} s`).join(", ") + (s.length > 4 ? ` (+${s.length - 4} more)` : "");

/** One ffmpeg pass over a rendered file. */
export async function checkMedia(ffmpeg: string, file: string): Promise<MediaCheck> {
  const probe = (await run(ffmpeg, ["-hide_banner", "-i", file], 60_000)).out;
  const d = /Duration:\s*(\d+):(\d+):([\d.]+)/.exec(probe);
  const duration = d ? +d[1] * 3600 + +d[2] * 60 + parseFloat(d[3]) : null;
  const hasVideo = /Stream #.*Video:/.test(probe), hasAudio = /Stream #.*Audio:/.test(probe);
  const args = ["-hide_banner", "-nostats", "-i", file];
  if (hasVideo) args.push("-vf", "blackdetect=d=0.5:pix_th=0.10,freezedetect=n=0.003:d=2");
  else args.push("-vn");
  if (hasAudio) args.push("-af", "silencedetect=noise=-50dB:d=1,ebur128=peak=true");
  else args.push("-an");
  args.push("-f", "null", "-");
  const out = (await run(ffmpeg, args)).out;
  const res: MediaCheck = {
    duration_s: duration === null ? null : r1(duration), has_video: hasVideo, has_audio: hasAudio,
    black: [], frozen: hasVideo ? spans(out.replace(/lavfi\.freezedetect\./g, ""), "freeze", duration) : [],
    silent: hasAudio ? spans(out, "silence", duration) : [], issues: [],
  };
  // blackdetect prints black_start:a black_end:b on one line
  if (hasVideo) {
    const b: Span[] = [];
    for (const m of out.matchAll(/black_start:\s*([\d.]+)\s+black_end:\s*([\d.]+)/g)) b.push([r1(+m[1]), r1(+m[2])]);
    res.black = b;
  }
  if (hasAudio) {
    const sum = out.slice(out.lastIndexOf("Summary:"));
    const i = /I:\s*(-?[\d.]+) LUFS/.exec(sum), p = /Peak:\s*(-?[\d.inf]+) dBFS/.exec(sum);
    if (i) res.loudness_lufs = parseFloat(i[1]);
    if (p && p[1] !== "-inf") res.true_peak_db = parseFloat(p[1]);
    const perSecond = new Map<number, number>();
    for (const m of out.matchAll(/t:\s*([\d.]+)\s+TARGET:.*?M:\s*(-?[\d.inf]+)/g)) {
      const s = Math.floor(parseFloat(m[1]) - 1e-6), v = m[2] === "-inf" ? -70 : Math.max(-70, parseFloat(m[2]));
      perSecond.set(s, Math.max(perSecond.get(s) ?? -70, v));
    }
    if (perSecond.size) res.loudness_timeline = [...perSecond.keys()].sort((a, b) => a - b).map((k) => Math.round(perSecond.get(k)!));
  }
  const total = duration ?? 0, long = (s: Span[]) => s.reduce((n, [a, b]) => n + b - a, 0);
  if (res.black.length) res.issues.push(`Black picture ${fmt(res.black)}${long(res.black) > total * 0.3 ? " (a large part of the render: a GPU failure or a missing layer?)" : ""}`);
  if (res.silent.length) res.issues.push(`Silence ${fmt(res.silent)}`);
  if (res.frozen.length) res.issues.push(`Frozen picture ${fmt(res.frozen)}`);
  if (res.loudness_lufs !== undefined && res.loudness_lufs < -24) res.issues.push(`Quiet mix: ${res.loudness_lufs} LUFS (social video is about -14)`);
  if (res.true_peak_db !== undefined && res.true_peak_db > -0.1) res.issues.push(`Peaks reach ${res.true_peak_db} dBFS: likely clipping`);
  return res;
}

/** Encode a render to an H.264 / AAC MP4 at a loudness target (two-pass loudnorm), for posting. */
export async function deliver(ffmpeg: string, input: string, output: string, lufs = -14): Promise<{ ok: boolean; message?: string }> {
  const probe = (await run(ffmpeg, ["-hide_banner", "-i", input], 60_000)).out;
  const hasAudio = /Stream #.*Audio:/.test(probe);
  let af: string[] = [];
  if (hasAudio) {
    const target = `I=${lufs}:TP=-1:LRA=11`;
    const m = (await run(ffmpeg, ["-hide_banner", "-nostats", "-i", input, "-vn", "-af", `loudnorm=${target}:print_format=json`, "-f", "null", "-"])).out;
    const j = m.slice(m.lastIndexOf("{"), m.lastIndexOf("}") + 1);
    let v: Record<string, string> = {};
    try { v = JSON.parse(j); } catch { /* single pass below */ }
    const two = v.input_i ? `:measured_I=${v.input_i}:measured_TP=${v.input_tp}:measured_LRA=${v.input_lra}:measured_thresh=${v.input_thresh}:offset=${v.target_offset}:linear=true` : "";
    af = ["-af", `loudnorm=${target}${two},aresample=48000`, "-c:a", "aac", "-b:a", "256k"];
  }
  const args = ["-hide_banner", "-y", "-i", input, "-c:v", "libx264", "-preset", "slow", "-crf", "17", "-pix_fmt", "yuv420p", ...af, "-movflags", "+faststart", output];
  const r = await run(ffmpeg, args);
  if (r.code !== 0 || !fs.existsSync(output)) return { ok: false, message: r.out.trim().split("\n").slice(-3).join(" ") };
  return { ok: true };
}
