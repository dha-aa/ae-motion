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

type BridgeInfo = { port: number; token: string; drops?: boolean };
/** GET /health: what the panel is running. "silent": no answer within 2 s, which means After Effects is busy (the
 * panel can't answer while ExtendScript runs); "old": a panel from before busy / queued were reported. */
type Health = { busy?: { cmd: string; seconds: number }; queued: number } | "silent" | "old";

async function panelHealth(info: BridgeInfo): Promise<Health> {
  try {
    const r = await fetch(`http://127.0.0.1:${info.port}/health`, { headers: { "x-ae-token": info.token }, signal: AbortSignal.timeout(2000) });
    const j = (await r.json()) as { result?: { busy?: { cmd: string; seconds: number }; queued?: number } };
    return j.result && typeof j.result.queued === "number" ? { busy: j.result.busy, queued: j.result.queued } : "old";
  } catch (e) {
    return (e as Error)?.name === "TimeoutError" ? "silent" : "old";
  }
}

/**
 * A TIMEOUT that says what happened to the command, so the model knows whether retrying could run it twice.
 * A panel that writes `drops: true` in the bridge file drops a queued command once its request closes (the abort
 * just closed it). `earlier`: a command this server sent before this one that has not returned yet, which this one
 * was waiting behind (the panel runs commands one at a time).
 */
function timedOut(command: string, timeoutMs: number, info: BridgeInfo, health: Health, earlier: { cmd: string; seconds: number } | null): BridgeResult {
  const msg = `No response within ${timeoutMs / 1000}s`;
  const running = "It can't be stopped and will finish on its own (a heavy comp, or a dialog open in After Effects). Inspect state before retrying, or it may run twice";
  if (earlier) {
    return info.drops
      ? fail("TIMEOUT", `${msg}: ${command} was waiting behind ${earlier.cmd} (sent ${earlier.seconds} s ago), so it never started and was dropped`, "Nothing changed. Retry once After Effects is free; check it for an open dialog")
      : fail("TIMEOUT", `${msg}: ${command} is waiting behind ${earlier.cmd} and will still run when that finishes`, "Don't retry yet: inspect state once After Effects is free (an older panel; reopen it to get one that drops timed-out commands)");
  }
  if (health === "silent") return fail("TIMEOUT", `${msg}: After Effects is busy, probably still running ${command}`, running);
  if (health === "old") return fail("TIMEOUT", msg, "The command may still be running in After Effects; check the panel and inspect state before retrying");
  if (health.busy?.cmd === command) return fail("TIMEOUT", `${msg}: After Effects is still running ${command} (${health.busy.seconds} s)`, running);
  if (health.busy && info.drops) return fail("TIMEOUT", `${msg}: After Effects is busy with ${health.busy.cmd}; ${command} never started and was dropped`, "Nothing changed. Retry once After Effects is free; check it for an open dialog");
  return fail("TIMEOUT", `${msg}; After Effects is free again`, "The command probably finished just after the timeout: inspect state before retrying");
}

/** Talks to the CEP panel's localhost HTTP endpoint. The bridge file is re-read on every call, so a panel restart is picked up. */
export class HttpBridge implements Bridge {
  /** Commands sent and not answered yet, oldest first (for the TIMEOUT message). */
  private readonly inflight = new Map<number, { cmd: string; since: number }>();
  private seq = 0;

  async run(command: string, args: Record<string, unknown>, timeoutMs: number = TIMEOUTS.command): Promise<BridgeResult> {
    let info: BridgeInfo;
    try {
      info = JSON.parse(fs.readFileSync(bridgeFile(), "utf8"));
    } catch {
      return fail("BRIDGE_DOWN", "Bridge file not found", "In After Effects open Window > Extensions > AE Motion MCP and keep the panel open");
    }
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeoutMs);
    const id = ++this.seq;
    this.inflight.set(id, { cmd: command, since: Date.now() });
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
        const first = [...this.inflight].find(([k]) => k < id)?.[1];
        const earlier = first ? { cmd: first.cmd, seconds: Math.round((Date.now() - first.since) / 1000) } : null;
        this.inflight.delete(id);
        return timedOut(command, timeoutMs, info, earlier ? "old" : await panelHealth(info), earlier);
      }
      return fail("BRIDGE_DOWN", `Cannot reach the After Effects panel: ${e?.cause?.code ?? e?.message ?? e}`, "Is After Effects open with the AE Motion MCP panel visible?");
    } finally {
      clearTimeout(timer);
      this.inflight.delete(id);
    }
  }
}
