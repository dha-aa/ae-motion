/**
 * The only way the server talks to After Effects.
 *
 * Tools depend on the {@link Bridge} interface, never on the transport, so the CEP/HTTP transport could be
 * replaced (for example by UXP) without touching the tool definitions.
 *
 * Wire protocol (see docs/architecture.md): POST http://127.0.0.1:<port>/cmd with header `x-ae-token` and body
 * `{cmd, args}`; the reply is a {@link BridgeResult}. Port and token come from the bridge file the panel writes.
 */
import fs from "node:fs";
import { bridgeFile, TIMEOUTS } from "./config.js";
import type { ToolErrorBody } from "./errors.js";

export type BridgeResult = { ok: true; result: any } | { ok: false; error: ToolErrorBody };

export interface Bridge {
  /** Run one host command. Never throws: transport failures come back as BRIDGE_DOWN / TIMEOUT results. */
  run(command: string, args: Record<string, unknown>, timeoutMs?: number): Promise<BridgeResult>;
}

const fail = (code: ToolErrorBody["code"], message: string, hint?: string): BridgeResult => ({ ok: false, error: { code, message, hint } });

type PanelHealth = { busy?: { cmd: string; seconds: number }; queued?: number };

/** What the panel is doing right now (GET /health), or null for an older panel or no answer within 2 s. */
async function panelHealth(info: { port: number; token: string }): Promise<PanelHealth | null> {
  try {
    const r = await fetch(`http://127.0.0.1:${info.port}/health`, { headers: { "x-ae-token": info.token }, signal: AbortSignal.timeout(2000) });
    const j = (await r.json()) as { result?: PanelHealth };
    return j.result && "queued" in j.result ? j.result : null;
  } catch {
    return null;
  }
}

/**
 * A TIMEOUT that says what happened to the command. The panel drops a queued command once its request is closed
 * (which the abort just did), so if After Effects is busy with something else this one never ran and is safe to retry;
 * if it is busy with this command, that keeps running and finishes on its own.
 */
function timedOut(command: string, timeoutMs: number, health: PanelHealth | null): BridgeResult {
  const msg = `No response within ${timeoutMs / 1000}s`;
  const busy = health?.busy;
  if (!health) return fail("TIMEOUT", msg, "The command may still be running in After Effects; check the panel and inspect state before retrying");
  const waiting = health.queued ? `, ${health.queued} more waiting` : "";
  if (busy && busy.cmd === command) {
    return fail("TIMEOUT", `${msg}: After Effects is still running ${command} (${busy.seconds} s${waiting})`,
      "It can't be stopped and will finish on its own (a heavy comp, or a dialog open in After Effects). Inspect state before retrying, or it may run twice");
  }
  if (busy) {
    return fail("TIMEOUT", `${msg}: After Effects is busy with ${busy.cmd} (${busy.seconds} s${waiting}); ${command} had not started and was dropped`,
      "Check After Effects for an open dialog; retry once it is free");
  }
  return fail("TIMEOUT", `${msg}; After Effects is free again`, "The command probably finished just after the timeout: inspect state before retrying");
}

/** Talks to the CEP panel's localhost HTTP endpoint. The bridge file is re-read on every call, so a panel restart is picked up. */
export class HttpBridge implements Bridge {
  async run(command: string, args: Record<string, unknown>, timeoutMs: number = TIMEOUTS.command): Promise<BridgeResult> {
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
      if (e?.name === "AbortError") return timedOut(command, timeoutMs, await panelHealth(info));
      return fail("BRIDGE_DOWN", `Cannot reach the After Effects panel: ${e?.cause?.code ?? e?.message ?? e}`, "Is After Effects open with the AE Motion MCP panel visible?");
    } finally {
      clearTimeout(timer);
    }
  }
}
