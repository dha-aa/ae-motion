#!/usr/bin/env node
// Agent driver for ae-motion-mcp: a tiny MCP client that spawns dist/index.js over stdio and calls tools,
// plus raw access to the After Effects panel bridge. Run from the repo root after `npm run build`.
//
//   node .claude/skills/run-ae-motion/driver.ts [--fake] [--allow-jsx] <command> [...]
//
//   status                     is the AE panel reachable? (reads the bridge file, GET /health)
//   list                       tool names (+ resources, prompts)
//   call <tool> [json]         call one tool; prints the JSON result; images -> $SHOTS/<tool>-<ts>.png
//   script <file|->            run many calls in ONE server session; each line: {"tool": "...", "args": {...}}
//                              "$N.path.to.field" strings in args are replaced with values from result N (0-based)
//   bridge <cmd> [json]        send a host command straight to the panel, bypassing the MCP server
//                              (also reaches non-tool commands: get_selection, prepare_render)
//   reload-host                re-evaluate panel/host/host.jsx inside AE (after `npm run build:host`),
//                              no installer re-run or panel reopen needed for host/ changes
//   smoke                      end-to-end: comp -> shapes -> eased keys -> preview PNG -> delete comp (leaves nothing behind)
//
//   --fake       start a fake panel (echoes {fake, cmd, args}) instead of talking to After Effects
//   --allow-jsx  set AE_MCP_ALLOW_JSX=1 for the spawned server (enables run_jsx)
//
// Env: SHOTS (default /tmp/ae-motion-shots), AE_MCP_BRIDGE_FILE (default ~/.ae-motion-mcp/bridge.json).
import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

type Json = Record<string, any>; // free-form tool args and results
type Rpc = { id?: number; result?: any; error?: unknown };
type Server = { ready: Promise<void>; request: (method: string, params?: Json) => Promise<any>; close: () => void };

const ROOT = process.cwd();
const SERVER = path.join(ROOT, "dist", "index.js");
const SHOTS = process.env.SHOTS || "/tmp/ae-motion-shots";

let argv = process.argv.slice(2);
const flag = (f: string): boolean => { const i = argv.indexOf(f); if (i < 0) return false; argv.splice(i, 1); return true; };
const FAKE = flag("--fake");
const ALLOW_JSX = flag("--allow-jsx");
const [cmd, ...rest] = argv;

const die = (msg: string): never => { console.error(msg); process.exit(1); };
const print = (o: unknown): void => console.log(typeof o === "string" ? o : JSON.stringify(o, null, 2));

// ---------- bridge (fake or real) ----------
let fakeServer: http.Server | null = null;
let bridgeFile = process.env.AE_MCP_BRIDGE_FILE || path.join(os.homedir(), ".ae-motion-mcp", "bridge.json");

async function startFakeBridge() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ae-motion-fake-"));
  const token = "fake-token";
  fakeServer = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      res.setHeader("content-type", "application/json");
      if (req.headers["x-ae-token"] !== token) { res.statusCode = 401; return res.end("{}"); }
      if (req.method === "GET") return res.end(JSON.stringify({ ok: true, result: { panel: "fake" } }));
      const { cmd, args } = JSON.parse(body);
      // a fake PNG so preview_frame completes
      if (cmd === "preview_frame" && args.output_path) fs.writeFileSync(args.output_path, Buffer.from("89504e470d0a1a0a", "hex"));
      res.end(JSON.stringify({ ok: true, result: { fake: true, cmd, args } }));
    });
  });
  await new Promise<void>((r) => fakeServer!.listen(0, "127.0.0.1", () => r()));
  bridgeFile = path.join(dir, "bridge.json");
  fs.writeFileSync(bridgeFile, JSON.stringify({ port: (fakeServer.address() as AddressInfo).port, token }));
}

function bridgeInfo(): { port: number; token: string } {
  try { return JSON.parse(fs.readFileSync(bridgeFile, "utf8")); }
  catch { return die(`No bridge file at ${bridgeFile}: open After Effects > Window > Extensions > AE Motion MCP (or use --fake)`); }
}

async function rawBridge(command: string, args: Json = {}, timeoutMs = 60000): Promise<Json> {
  const { port, token } = bridgeInfo();
  const r = await fetch(`http://127.0.0.1:${port}/cmd`, {
    method: "POST", headers: { "content-type": "application/json", "x-ae-token": token },
    body: JSON.stringify({ cmd: command, args }), signal: AbortSignal.timeout(timeoutMs),
  });
  if (r.status === 401) die("Bridge rejected the token: stale bridge file. Close and reopen the panel.");
  return r.json();
}

// ---------- MCP client over stdio ----------
function startServer(): Server {
  if (!fs.existsSync(SERVER)) die(`${SERVER} not found: run \`npm run build\` from the repo root first`);
  const env: NodeJS.ProcessEnv = { ...process.env, AE_MCP_BRIDGE_FILE: bridgeFile };
  if (ALLOW_JSX) env.AE_MCP_ALLOW_JSX = "1";
  const p = spawn(process.execPath, [SERVER], { env, stdio: ["pipe", "pipe", "inherit"] });
  let buf = "", nextId = 1;
  const waiters = new Map<number, (m: Rpc) => void>();
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
  const request = (method: string, params: Json = {}): Promise<any> => new Promise((resolve, reject) => {
    const id = nextId++;
    const t = setTimeout(() => reject(new Error(`timeout waiting for ${method}`)), 120000);
    waiters.set(id, (m) => { clearTimeout(t); m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result); });
    p.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
  });
  const ready = request("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "ae-motion-driver", version: "1" } })
    .then(() => { p.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n"); });
  const close = () => { p.stdin.end(); setTimeout(() => p.kill(), 2000).unref(); };
  return { ready, request, close };
}

/** Call a tool; returns {isError, value} where value is the parsed JSON text. Images are saved to SHOTS. */
async function callTool(srv: Server, tool: string, args: Json = {}): Promise<{ isError: boolean; value: any }> {
  const r: CallToolResult = await srv.request("tools/call", { name: tool, arguments: args });
  let value: any = null;
  const images: string[] = [];
  for (const c of r.content || []) {
    if (c.type === "text") { try { value = JSON.parse(c.text); } catch { value = c.text; } }
    if (c.type === "image") {
      fs.mkdirSync(SHOTS, { recursive: true });
      const f = path.join(SHOTS, `${tool}-${Date.now()}.png`);
      fs.writeFileSync(f, Buffer.from(c.data, "base64"));
      images.push(f);
    }
  }
  if (images.length) value = { ...(typeof value === "object" && value ? value : { text: value }), saved: images };
  return { isError: !!r.isError, value };
}

// "$2.layers.0.id" -> results[2].layers[0].id
function substitute(v: unknown, results: unknown[]): unknown {
  if (typeof v === "string" && /^\$\d+(\.|$)/.test(v)) {
    const [n, ...keys] = v.slice(1).split(".");
    return keys.reduce<any>((o, k) => (o == null ? o : o[k]), results[+n]);
  }
  if (Array.isArray(v)) return v.map((x) => substitute(x, results));
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, substitute(x, results)]));
  return v;
}

type Step = { tool: string; args?: Json; allowError?: boolean };

async function runScript(lines: Step[]): Promise<number> {
  const srv = startServer();
  await srv.ready;
  const results: unknown[] = [];
  let failed = false;
  for (const [i, step] of lines.entries()) {
    const args = substitute(step.args || {}, results) as Json;
    const { isError, value } = await callTool(srv, step.tool, args);
    results.push(value);
    console.log(`--- [${i}] ${step.tool} ${isError ? "ERROR" : "ok"}`);
    print(value);
    if (isError && !step.allowError) { failed = true; break; }
  }
  srv.close();
  return failed ? 1 : 0;
}

const parseJson = (s: string | undefined, what: string): any => { if (!s) return {}; try { return JSON.parse(s); } catch { die(`${what} is not valid JSON: ${s}`); } };

// ---------- commands ----------
let code = 0;
if (FAKE) await startFakeBridge();

switch (cmd) {
  case "status": {
    if (!fs.existsSync(bridgeFile)) { print({ panel: "down", bridge_file: bridgeFile }); code = 1; break; }
    const { port, token } = bridgeInfo();
    try {
      const r = await fetch(`http://127.0.0.1:${port}/health`, { headers: { "x-ae-token": token }, signal: AbortSignal.timeout(3000) });
      print({ panel: r.status === 200 ? "up" : `http ${r.status}`, port, bridge_file: bridgeFile });
      code = r.status === 200 ? 0 : 1;
    } catch (e) {
      const err = e as { cause?: { code?: string }; message?: string };
      print({ panel: "unreachable", port, error: String(err.cause?.code || err.message) });
      code = 1;
    }
    break;
  }
  case "list": {
    const srv = startServer();
    await srv.ready;
    const tools = (await srv.request("tools/list")).tools;
    const resources = (await srv.request("resources/list")).resources.map((r: { uri: string }) => r.uri);
    const prompts = (await srv.request("prompts/list")).prompts.map((p: { name: string }) => p.name);
    print({ count: tools.length, tools: tools.map((t: { name: string }) => t.name), resources, prompts });
    srv.close();
    break;
  }
  case "call": {
    const [tool, json] = rest;
    if (!tool) die("usage: call <tool> [json-args]");
    const srv = startServer();
    await srv.ready;
    const { isError, value } = await callTool(srv, tool, parseJson(json, "args"));
    print(value);
    srv.close();
    code = isError ? 1 : 0;
    break;
  }
  case "script": {
    const src = rest[0] === "-" || !rest[0] ? fs.readFileSync(0, "utf8") : fs.readFileSync(rest[0], "utf8");
    const lines = src.split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#")).map((l) => parseJson(l, "script line"));
    code = await runScript(lines);
    break;
  }
  case "bridge": {
    const [command, json] = rest;
    if (!command) die("usage: bridge <host-command> [json-args]");
    const r = await rawBridge(command, parseJson(json, "args"));
    print(r);
    code = r.ok ? 0 : 1;
    break;
  }
  case "reload-host": {
    const host = path.join(ROOT, "panel", "host", "host.jsx").replace(/\\/g, "/");
    if (!fs.existsSync(host)) die(`${host} not found: run \`npm run build:host\` first`);
    // run_jsx is a host command; the AE_MCP_ALLOW_JSX gate lives in the MCP server, which this bypasses.
    // $.evalFile does NOT work: it evaluates in run_jsx's local scope and the global AEM stays the old one.
    // Read the file and assign the new closure to $.global.AEM explicitly.
    const jsx = [
      `var f = new File(${JSON.stringify(host)}); f.encoding = "UTF-8";`,
      `if (!f.open("r")) throw new Error("cannot open " + f.fsName);`,
      `var s = f.read(); f.close();`,
      `$.global.AEM = eval(s + "\\n;AEM");`,
      `"reloaded " + f.fsName + " (" + s.length + " chars)"`,
    ].join(" ");
    const r = await rawBridge("run_jsx", { code: jsx });
    print(r);
    code = r.ok ? 0 : 1;
    break;
  }
  case "smoke": {
    const steps = [
      { tool: "get_project" },
      { tool: "create_comp", args: { name: "ae-motion smoke", width: 640, height: 360, fps: 30, duration: 2, bg_color: [0.1, 0.1, 0.15] } },
      // a shape, not a solid: solids create a footage item that deleting the comp leaves behind
      { tool: "add_layer", args: { comp_id: "$1.id", kind: "shape", options: { name: "BG", shape: { type: "rect", size: [640, 360], fill: [0.12, 0.14, 0.2] } } } },
      { tool: "add_layer", args: { comp_id: "$1.id", kind: "shape", options: { name: "Box", shape: { type: "rect", size: [120, 120], fill: [1, 0.4, 0.2], roundness: 16 } } } },
      { tool: "set_keyframes", args: { layer_id: "$3.id", path: "position", keys: [{ t: 0, v: [100, 180], ease_out: "easy" }, { t: 1.5, v: [540, 180], ease_in: "easy" }] } },
      { tool: "get_comp", args: { comp_id: "$1.id" } },
      { tool: "preview_frame", args: { comp_id: "$1.id", time: 0.75 } },
      { tool: "delete_item", args: { item_id: "$1.id", force: true } },
    ];
    code = await runScript(steps);
    break;
  }
  default:
    die("usage: driver.ts [--fake] [--allow-jsx] status | list | call <tool> [json] | script <file|-> | bridge <cmd> [json] | reload-host | smoke");
}

(fakeServer as http.Server | null)?.close(); // assigned inside startFakeBridge, which narrowing cannot see
process.exit(code);
