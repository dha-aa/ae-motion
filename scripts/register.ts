// Registers the ae-motion server with Claude Desktop (claude_desktop_config.json) and Claude Code (user scope, every
// project). The installers run this last, and the panel's Update button re-runs the installer, so it changes only what
// is missing or out of date and keeps what the user added (other servers, app settings, the server's `env`).
// A failure here never fails the install: it prints what to do by hand instead.
//
//   node scripts/register.ts        AE_MCP_REGISTER=0 skips it
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const NAME = "ae-motion";

export interface ServerEntry { command: string; args: string[]; env?: Record<string, string> }

/** Claude Desktop's config file: ~/Library/Application Support/Claude on macOS, %APPDATA%\Claude on Windows. */
export function desktopConfigPath(platform: string, home: string, appData?: string): string | null {
  if (platform === "darwin") return path.join(home, "Library", "Application Support", "Claude", "claude_desktop_config.json");
  if (platform === "win32") return path.join(appData || path.join(home, "AppData", "Roaming"), "Claude", "claude_desktop_config.json");
  return null;
}

/**
 * The first `node` on PATH as an absolute path. Claude Desktop is started from the Dock / Start menu with a minimal
 * PATH, so a bare "node" would not find Homebrew or nvm installs; falls back to the node running this script.
 */
export function findNode(pathEnv: string, platform: string, fallback: string): string {
  const exe = platform === "win32" ? "node.exe" : "node";
  for (const dir of pathEnv.split(platform === "win32" ? ";" : ":")) {
    if (!dir) continue;
    const p = path.join(dir, exe);
    try { if (fs.statSync(p).isFile()) return p; } catch { /* not here */ }
  }
  return fallback;
}

/**
 * Claude Desktop's config text with ae-motion set to `command` + `args`, keeping every other key, server and the
 * entry's own `env`. `changed` is false when it already matched. Throws on text that is not a JSON object, so a file
 * the user broke by hand is never overwritten.
 */
export function mergeDesktopConfig(text: string | null, command: string, args: string[]): { text: string; changed: boolean } {
  const cfg: Record<string, unknown> = text && text.trim() ? JSON.parse(text) : {};
  if (!cfg || typeof cfg !== "object" || Array.isArray(cfg)) throw new Error("not a JSON object");
  const servers = (cfg.mcpServers && typeof cfg.mcpServers === "object" ? cfg.mcpServers : {}) as Record<string, ServerEntry>;
  const old = servers[NAME];
  if (old && old.command === command && JSON.stringify(old.args) === JSON.stringify(args)) return { text: text as string, changed: false };
  servers[NAME] = { ...old, command, args };
  cfg.mcpServers = servers;
  return { text: JSON.stringify(cfg, null, 2) + "\n", changed: true };
}

function registerDesktop(serverJs: string): string {
  const file = desktopConfigPath(process.platform, os.homedir(), process.env.APPDATA);
  if (!file) return "Claude Desktop: not available on this platform, skipped.";
  if (!fs.existsSync(path.dirname(file))) return "Claude Desktop: not installed, skipped (re-run the installer after installing it).";
  const node = findNode(process.env.PATH ?? "", process.platform, process.execPath);
  const text = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null;
  let merged;
  try { merged = mergeDesktopConfig(text, node, [serverJs]); } catch (e) {
    return `Claude Desktop: ${file} is not valid JSON (${(e as Error).message}); left it alone. Add ae-motion by hand (docs/setup.md).`;
  }
  if (!merged.changed) return "Claude Desktop: already registered.";
  // write next to it, then rename: the app reads this file too, and must never see half of it
  fs.writeFileSync(file + ".tmp", merged.text);
  fs.renameSync(file + ".tmp", file);
  return `Claude Desktop: registered in ${file} (restart Claude Desktop to load it).`;
}

/** Runs the `claude` CLI; on Windows it is claude.cmd, which needs a shell, so arguments are quoted for cmd. */
function claude(args: string[]): { status: number | null; out: string } {
  const win = process.platform === "win32";
  const r = win
    ? spawnSync(["claude", ...args.map((a) => (/[\s"&|<>^]/.test(a) ? `"${a.replace(/"/g, '""')}"` : a))].join(" "), { shell: true, encoding: "utf8" })
    : spawnSync("claude", args, { encoding: "utf8" });
  return { status: r.error ? null : r.status, out: ((r.stdout ?? "") + (r.stderr ?? "")).trim() };
}

function registerClaudeCode(serverJs: string): string {
  const manual = `claude mcp add -s user ${NAME} -- node "${serverJs}"`;
  if (claude(["--version"]).status !== 0) return `Claude Code: \`claude\` not found on PATH, skipped. To add it later: ${manual}`;
  // user-scope servers are the top-level mcpServers of ~/.claude.json (read only: the CLI does the writing)
  let old: ServerEntry | undefined;
  try { old = JSON.parse(fs.readFileSync(path.join(os.homedir(), ".claude.json"), "utf8")).mcpServers?.[NAME]; } catch { /* none yet */ }
  if (old && old.command === "node" && JSON.stringify(old.args) === JSON.stringify([serverJs])) return "Claude Code: already registered (user scope).";
  if (old) claude(["mcp", "remove", "-s", "user", NAME]);
  const env = Object.entries(old?.env ?? {}).flatMap(([k, v]) => ["-e", `${k}=${v}`]);
  const r = claude(["mcp", "add", "-s", "user", NAME, ...env, "--", "node", serverJs]);
  if (r.status !== 0) return `Claude Code: \`claude mcp add\` failed (${r.out || "exit " + r.status}). Add it by hand: ${manual}`;
  return "Claude Code: registered at user scope (every project; new sessions load it, or /mcp > ae-motion > Reconnect in a running one).";
}

function main(): number {
  if (process.env.AE_MCP_REGISTER === "0") { console.log("AE_MCP_REGISTER=0: not registering with Claude Desktop or Claude Code."); return 0; }
  const serverJs = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "dist", "index.js");
  for (const step of [registerDesktop, registerClaudeCode]) {
    try { console.log(step(serverJs)); } catch (e) { console.log(`${step === registerDesktop ? "Claude Desktop" : "Claude Code"}: ${(e as Error).message}`); }
  }
  return 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) process.exitCode = main();
