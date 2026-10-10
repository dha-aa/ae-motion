// The after-render check and delivery (src/render/check.ts) against real ffmpeg on synthetic clips. Skipped (passes)
// when ffmpeg is not installed: the server tests cover the job flow with a fake ffmpeg.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { findFfmpeg, checkMedia, deliver } = await import(pathToFileURL(path.join(ROOT, "dist", "render", "check.js")).href);
const results: [name: string, pass: boolean, msg?: string][] = [];
const errText = (e: unknown): string => (e instanceof Error ? e.message : String(e));
const t = async (name: string, fn: () => Promise<void>): Promise<void> => { try { await fn(); results.push([name, true]); } catch (e) { results.push([name, false, errText(e)]); } };
const ok = (c: boolean, m: string): void => { if (!c) throw new Error(m); };

const ff = findFfmpeg();
if (!ff) {
  console.log("SKIP  ffmpeg not found: render checks not tested here");
  process.exit(0);
}
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ae-motion-check-"));
const clip = path.join(tmp, "clip.mp4");
// 2 s of picture then 2 s of black; a quiet tone for 2.5 s then 1.5 s of silence
execFileSync(ff, ["-loglevel", "error", "-y", "-f", "lavfi", "-i", "testsrc2=s=320x180:r=30:d=2", "-f", "lavfi", "-i", "color=c=black:s=320x180:r=30:d=2",
  "-f", "lavfi", "-i", "sine=f=440:d=2.5,volume=0.3", "-f", "lavfi", "-i", "anullsrc=r=48000:cl=mono:d=1.5",
  "-filter_complex", "[0:v][1:v]concat=n=2:v=1:a=0[v];[2:a][3:a]concat=n=2:v=0:a=1[a]", "-map", "[v]", "-map", "[a]", "-c:v", "libx264", "-c:a", "aac", clip]);

await t("finds black picture and silence where they are, and the loudness per second", async () => {
  const r = await checkMedia(ff, clip);
  ok(r.has_video && r.has_audio, "streams");
  ok(r.black.length === 1 && Math.abs(r.black[0][0] - 2) < 0.15 && Math.abs(r.black[0][1] - 4) < 0.15, "black " + JSON.stringify(r.black));
  ok(r.silent.length === 1 && Math.abs(r.silent[0][0] - 2.5) < 0.15, "silent " + JSON.stringify(r.silent));
  ok(Array.isArray(r.loudness_timeline) && r.loudness_timeline.length === 4 && r.loudness_timeline[3] <= -60 && r.loudness_timeline[0] > -45, "timeline " + JSON.stringify(r.loudness_timeline));
  ok(r.issues.some((x: string) => /^Black picture 2-4 s/.test(x)) && r.issues.some((x: string) => /^Silence/.test(x)) && r.issues.some((x: string) => /Quiet mix/.test(x)), "issues " + JSON.stringify(r.issues));
});

await t("deliver encodes an H.264 MP4 at the loudness target", async () => {
  const out = path.join(tmp, "out.mp4");
  const d = await deliver(ff, clip, out, -14);
  ok(d.ok, "deliver failed: " + d.message);
  const r = await checkMedia(ff, out);
  ok(r.loudness_lufs !== undefined && Math.abs(r.loudness_lufs + 14) < 1.5, "loudness " + r.loudness_lufs);
});

await t("a small move on a plain frame is not frozen; a held frame is", async () => {
  const small = path.join(tmp, "small.mp4"), held = path.join(tmp, "held.mp4");
  // a 40 px dot crossing a white 1280 x 720 frame at 200 px/s (about what a stick figure's arm changes)
  execFileSync(ff, ["-loglevel", "error", "-y", "-f", "lavfi", "-i", "color=c=white:s=1280x720:r=30:d=3", "-f", "lavfi", "-i", "color=c=black:s=40x40:r=30:d=3",
    "-filter_complex", "[0][1]overlay=x='100+t*200':y=300:eval=frame", "-c:v", "libx264", small]);
  execFileSync(ff, ["-loglevel", "error", "-y", "-f", "lavfi", "-i", "testsrc2=s=640x360:r=30:d=1", "-vf", "tpad=stop_mode=clone:stop_duration=3", "-c:v", "libx264", held]);
  ok((await checkMedia(ff, small)).frozen.length === 0, "small move read as frozen");
  ok((await checkMedia(ff, held)).frozen.length === 1, "held frame not found");
});

await t("a clean audio-only file reports no issues", async () => {
  const aif = path.join(tmp, "mix.aif");
  execFileSync(ff, ["-loglevel", "error", "-y", "-f", "lavfi", "-i", "sine=f=220:d=3,volume=1.5", aif]);
  const r = await checkMedia(ff, aif);
  ok(!r.has_video && r.has_audio && r.black.length === 0, "streams");
  ok(r.issues.length === 0, "issues " + JSON.stringify(r.issues));
});

fs.rmSync(tmp, { recursive: true, force: true });
for (const [name, pass, msg] of results) console.log((pass ? "PASS" : "FAIL") + "  " + name + (pass ? "" : "\n      " + msg));
process.exit(results.every((x) => x[1]) ? 0 : 1);
