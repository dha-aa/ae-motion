/**
 * Locating the aerender executable and the file it actually wrote.
 */
import fs from "node:fs";
import path from "node:path";
import { aerenderOverride } from "../config.js";
import { AeToolError } from "../errors.js";

const aerenderName = () => (process.platform === "win32" ? "aerender.exe" : "aerender");

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
 * Locate aerender. Tries AE_AERENDER, then the folder After Effects reported (`aerenderDir`) and up to four of its
 * parents (the layout differs between macOS and Windows and between versions), then the standard install locations.
 * @throws AeToolError AE_ERROR when nothing is found.
 */
export function findAerender(aerenderDir: string): string {
  const exe = aerenderName();
  const candidates: (string | undefined)[] = [aerenderOverride()];
  let cur = aerenderDir || "";
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
 * After Effects takes the file extension from the output module, so the file it writes can differ from the requested
 * path (for example a .mov request produced .mp4). Find the newest file with the same base name written since `since`
 * (epoch ms). Partial temp files (`name.<pid>.<n>.ext`) are ignored.
 */
export function findWrittenOutput(requested: string, since: number): string | undefined {
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
