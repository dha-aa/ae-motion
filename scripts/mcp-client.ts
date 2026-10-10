// A minimal MCP client for scripts that drive the built server (dist/index.js) over stdio: the live tests
// (test/live/run.ts) and the evaluations (evals/). Talks to whatever panel the bridge file names (real After Effects).
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const SERVER = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "dist", "index.js");

export type Tool = { name: string; description?: string; inputSchema?: unknown; annotations?: { readOnlyHint?: boolean } };
/** A tool result: `value` is the parsed JSON text (or the raw text), `images` the number of image blocks. */
export type ToolResult = { isError: boolean; value: any; images: number };
export type Client = {
  call(tool: string, args?: Record<string, unknown>): Promise<ToolResult>;
  tools(): Promise<Tool[]>;
  close(): void;
};

export async function startClient(env: Record<string, string> = {}): Promise<Client> {
  if (!fs.existsSync(SERVER)) throw new Error("dist/index.js missing: run `npm run build` first");
  const p = spawn(process.execPath, [SERVER], { env: { ...process.env, AE_MCP_UPDATE_CHECK: "0", ...env }, stdio: ["pipe", "pipe", "inherit"] });
  let buf = "", nextId = 1;
  const waiters = new Map<number, (m: { result?: any; error?: unknown }) => void>();
  p.stdout.on("data", (d) => {
    buf += d;
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i); buf = buf.slice(i + 1);
      if (!line.trim()) continue;
      const msg = JSON.parse(line);
      if (msg.id !== undefined && waiters.has(msg.id)) { waiters.get(msg.id)!(msg); waiters.delete(msg.id); }
    }
  });
  const request = (method: string, params: Record<string, unknown> = {}): Promise<any> => new Promise((resolve, reject) => {
    const id = nextId++;
    const timer = setTimeout(() => reject(new Error(`no reply to ${method} within 180 s`)), 180_000);
    waiters.set(id, (m) => { clearTimeout(timer); if (m.error) reject(new Error(JSON.stringify(m.error))); else resolve(m.result); });
    p.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
  });
  await request("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "ae-motion-scripts", version: "1" } });
  p.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
  return {
    async call(tool, args = {}) {
      const r = await request("tools/call", { name: tool, arguments: args });
      let value: any = null, images = 0;
      for (const c of r.content ?? []) {
        if (c.type === "text") { try { value = JSON.parse(c.text); } catch { value = c.text; } }
        if (c.type === "image") images++;
      }
      return { isError: !!r.isError, value, images };
    },
    async tools() { return (await request("tools/list")).tools; },
    close() { p.stdin.end(); setTimeout(() => p.kill(), 2000).unref(); },
  };
}
