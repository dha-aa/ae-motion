import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export type BridgeError = { code: string; message: string; hint?: string };
export type BridgeResult = { ok: true; result: any } | { ok: false; error: BridgeError };

export class AeToolError extends Error {
  constructor(public code: string, message: string, public hint?: string) {
    super(message);
  }
}

/** The server only talks to After Effects through this interface, so the transport is swappable. */
export interface Bridge {
  run(command: string, args: Record<string, unknown>, timeoutMs?: number): Promise<BridgeResult>;
}

const fail = (code: string, message: string, hint?: string): BridgeResult => ({ ok: false, error: { code, message, hint } });

function bridgeFile(): string {
  return process.env.AE_MCP_BRIDGE_FILE || path.join(os.homedir(), ".ae-motion-mcp", "bridge.json");
}

/** Talks to the CEP panel's localhost HTTP endpoint (port + token read from the bridge file). */
export class HttpBridge implements Bridge {
  async run(command: string, args: Record<string, unknown>, timeoutMs = 30_000): Promise<BridgeResult> {
    let info: { port: number; token: string };
    try {
      info = JSON.parse(fs.readFileSync(bridgeFile(), "utf8"));
    } catch {
      return fail("BRIDGE_DOWN", "Bridge file not found", "In After Effects open Window > Extensions > AE Motion MCP and keep the panel open");
    }
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      const r = await fetch(`http://127.0.0.1:${info.port}/cmd`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-ae-token": info.token },
        body: JSON.stringify({ cmd: command, args }),
        signal: ctl.signal,
      });
      if (r.status === 401) return fail("BRIDGE_DOWN", "Bridge rejected the token (stale bridge file)", "Close and reopen the AE Motion MCP panel");
      return (await r.json()) as BridgeResult;
    } catch (e: any) {
      if (e?.name === "AbortError") {
        return fail("TIMEOUT", `No response within ${timeoutMs / 1000}s`, "The command may still be running in After Effects; check the panel and inspect state before retrying");
      }
      return fail("BRIDGE_DOWN", `Cannot reach the After Effects panel: ${e?.cause?.code ?? e?.message ?? e}`, "Is After Effects open with the AE Motion MCP panel visible?");
    } finally {
      clearTimeout(timer);
    }
  }
}
