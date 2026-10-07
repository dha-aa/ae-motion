/**
 * Server identity and every environment variable the server reads, in one place.
 *
 * Variables are read on each call rather than cached, so a test (or a long-running server) sees the
 * current environment.
 */
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";

const pkg = createRequire(import.meta.url)("../package.json") as { name: string; version: string };

export const SERVER_NAME: string = pkg.name;
export const SERVER_VERSION: string = pkg.version;

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

/** Explicit path to the aerender executable (AE_AERENDER), if set. */
export function aerenderOverride(): string | undefined {
  return process.env.AE_AERENDER || undefined;
}

/** Bridge timeouts in milliseconds. */
export const TIMEOUTS = {
  /** Default for a bridged command. */
  command: 30_000,
  /** preview_frame: rendering one heavy frame can take a while. */
  preview: 60_000,
  /** How long preview_frame waits for After Effects to finish writing the PNG. */
  previewFile: 10_000,
} as const;
