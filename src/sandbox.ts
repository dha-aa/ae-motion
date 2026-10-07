import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { AeToolError } from "./bridge.js";

const norm = (p: string) => (process.platform === "win32" ? p.toLowerCase() : p);

function realish(p: string): string {
  let cur = path.resolve(p);
  const rest: string[] = [];
  while (!fs.existsSync(cur)) {
    const parent = path.dirname(cur);
    if (parent === cur) break;
    rest.unshift(path.basename(cur));
    cur = parent;
  }
  return path.join(fs.realpathSync(cur), ...rest);
}

function roots(): string[] {
  const env = process.env.AE_MCP_ALLOWED_DIRS;
  const base = env ? env.split(path.delimiter).filter(Boolean) : [os.homedir()];
  return [...base, os.tmpdir()].map((r) => norm(realish(r)));
}

/** Returns the resolved path, or throws FORBIDDEN if it is outside the allowlist. */
export function assertAllowed(p: string): string {
  const resolved = realish(p);
  const n = norm(resolved);
  const ok = roots().some((r) => n === r || n.startsWith(r.endsWith(path.sep) ? r : r + path.sep));
  if (!ok) {
    throw new AeToolError("FORBIDDEN", `Path is outside the allowed folders: ${p}`, "Set AE_MCP_ALLOWED_DIRS (separated by the OS path delimiter) to allow more folders");
  }
  return resolved;
}

/** After Effects accepts forward slashes on every platform. */
export const toAe = (p: string) => p.replace(/\\/g, "/");
