/**
 * Server identity and every environment variable the server reads, in one place.
 *
 * Variables are read on each call rather than cached, so a test (or a long-running server) sees the
 * current environment.
 */
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const pkg = createRequire(import.meta.url)("../package.json") as { name: string; version: string; repository?: { url?: string } };

export const SERVER_NAME: string = pkg.name;
export const SERVER_VERSION: string = pkg.version;
/** The folder the server was installed from (the git checkout users update with git pull). */
export const REPO_ROOT: string = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
/** "owner/name" of the GitHub repository, from package.json repository.url. */
export const REPO_SLUG: string = /github\.com[/:]([^/]+\/[^/.]+)/.exec(pkg.repository?.url ?? "")?.[1] ?? "dha-aa/ae-motion";

/** Path of the file the CEP panel writes its port and token to. Override: AE_MCP_BRIDGE_FILE (set it for the panel too). */
export function bridgeFile(): string {
  return process.env.AE_MCP_BRIDGE_FILE || path.join(os.homedir(), ".ae-motion-mcp", "bridge.json");
}

/** Folders tools may read and write. AE_MCP_ALLOWED_DIRS (OS path delimiter separated), default the home folder. The temp folder is always added by the sandbox. */
export function allowedDirs(): string[] {
  const env = process.env.AE_MCP_ALLOWED_DIRS;
  return env ? env.split(path.delimiter).filter(Boolean) : [os.homedir()];
}

/** run_jsx is off unless AE_MCP_ALLOW_JSX=1. */
export function jsxEnabled(): boolean {
  return process.env.AE_MCP_ALLOW_JSX === "1";
}

/** The update check runs unless AE_MCP_UPDATE_CHECK=0. */
export function updateCheckEnabled(): boolean {
  return process.env.AE_MCP_UPDATE_CHECK !== "0";
}

/** Where version tags are listed (GitHub's tags API). AE_MCP_UPDATE_URL overrides it (tests, mirrors). */
export function updateTagsUrl(): string {
  return process.env.AE_MCP_UPDATE_URL || `https://api.github.com/repos/${REPO_SLUG}/tags?per_page=100`;
}

/** Explicit path to the aerender executable (AE_AERENDER), if set. */
export function aerenderOverride(): string | undefined {
  return process.env.AE_AERENDER || undefined;
}

/** Tool groups (src/tools/<group>.ts). */
export const TOOLSETS = ["inspect", "project", "layers", "timeline", "masks", "animate", "scene3d", "design", "output", "scripting", "meta"] as const;
export type Toolset = (typeof TOOLSETS)[number];

/**
 * Which tool groups to register (AE_MCP_TOOLSETS, comma separated; default: all). Fewer tools means a smaller tool
 * list in every request. inspect and meta are always on. "core" = inspect, project, layers, animate, output.
 */
export function enabledToolsets(): Set<Toolset> {
  const env = process.env.AE_MCP_TOOLSETS?.trim();
  if (!env || env === "all") return new Set(TOOLSETS);
  const out = new Set<Toolset>(["inspect", "meta"]);
  for (const raw of env.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean)) {
    if (raw === "core") for (const g of ["project", "layers", "animate", "output"] as const) out.add(g);
    else if ((TOOLSETS as readonly string[]).includes(raw)) out.add(raw as Toolset);
    else process.stderr.write(`ae-motion-mcp: unknown toolset "${raw}" in AE_MCP_TOOLSETS (known: core, ${TOOLSETS.join(", ")})\n`);
  }
  return out;
}

/** Largest tool response (text characters) returned to the client; bigger ones become an error with a hint. */
export const CHARACTER_LIMIT = 25_000;

/** Bridge timeouts in milliseconds. */
export const TIMEOUTS = {
  /** Default for a bridged command. */
  command: 30_000,
  /** preview_frame: rendering one heavy frame can take a while. */
  preview: 60_000,
  /** How long preview_frame waits for After Effects to finish writing the PNG. */
  previewFile: 10_000,
} as const;
