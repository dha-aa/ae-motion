/**
 * Filesystem sandbox for tool arguments that are paths (imports, presets, project and render output).
 *
 * A path is allowed when it resolves (following symlinks of the part that exists) inside one of
 * {@link allowedDirs} or the OS temp folder. Tools opt in per argument via `paths` in the tool registry.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { allowedDirs } from "./config.js";
import { AeToolError } from "./errors.js";

const norm = (p: string) => (process.platform === "win32" ? p.toLowerCase() : p);

/** Resolve p through realpath for the longest existing prefix; the missing tail is appended as-is. */
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
  return [...allowedDirs(), os.tmpdir()].map((r) => norm(realish(r)));
}

/** Returns the resolved path, or throws FORBIDDEN if it is outside the allowed folders. */
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
