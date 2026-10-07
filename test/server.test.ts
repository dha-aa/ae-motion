// Integration tests for the MCP server against a fake bridge and a fake aerender (no After Effects needed):
// render job lifecycle, preview_frame, and how arguments are forwarded (path sandboxing, run_jsx gate).
// Uses a bash script as the fake aerender, so it is skipped on Windows.
import http from "node:http";
import os from "node:os";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import type { AddressInfo } from "node:net";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

/** A JSON-RPC reply from the server; `result` is a CallToolResult for tools/call. */
type RpcReply = { id?: number; result?: CallToolResult; error?: { code: number; message: string } };
type Json = Record<string, any>; // tool payloads and forwarded args are free-form JSON

if (process.platform === "win32") { console.log("SKIP  render tests (need bash)"); process.exit(0); }
const DIR = fs.mkdtempSync(path.join(os.tmpdir(), "ae-motion-render-"));
const SERVER = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "dist", "index.js");
const TOKEN = "testtoken";
let prepareOk = true;
const received: Record<string, Json> = {}; // command -> args of the last call the fake bridge received

const bridge = http.createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    res.setHeader("content-type", "application/json");
    if (req.headers["x-ae-token"] !== TOKEN) { res.statusCode = 401; return res.end("{}"); }
    const { cmd, args } = JSON.parse(body);
    received[cmd] = args;
    if (cmd === "prepare_render") {
      if (!prepareOk) return res.end(JSON.stringify({ ok: false, error: { code: "BAD_ARGS", message: "Project has never been saved" } }));
      return res.end(JSON.stringify({ ok: true, result: { project_path: "/tmp/x.aep", comp_name: "C", total_frames: 10, aerender_dir: DIR } }));
    }
    if (cmd === "list_properties") return res.end(JSON.stringify({ ok: true, result: { properties: "x".repeat(30000) } })); // over CHARACTER_LIMIT
    if (cmd === "preview_frame") {
      // After Effects can finish writing the PNG a moment after the command returns, especially for heavy 3D frames.
      setTimeout(() => fs.writeFileSync(args.output_path, "fake png bytes"), 700);
      return res.end(JSON.stringify({ ok: true, result: {} }));
    }
    res.end(JSON.stringify({ ok: true, result: {} }));
  });
});
await new Promise<void>((r) => bridge.listen(0, "127.0.0.1", () => r()));
fs.writeFileSync(path.join(DIR, "bridge.json"), JSON.stringify({ port: (bridge.address() as AddressInfo).port, token: TOKEN }));

const fake = path.join(DIR, "aerender");
fs.writeFileSync(fake, `#!/bin/bash\necho $$ > ${DIR}/aerender.pid\nif [ "$FAKE_MODE" = "write" ]; then\n  while [ "$1" != "-output" ]; do shift; done\n  out="$2"; echo "PROGRESS: finished"; printf data > "\${out%.*}.mp4"; exit 0\nfi\nexec sleep 300\n`, { mode: 0o755 });

function startServer(extraEnv: Record<string, string> = {}) {
  const p = spawn("node", [SERVER], {
    // update checks stay off unless a test turns them on (no real network calls from tests)
    env: { ...process.env, AE_MCP_BRIDGE_FILE: path.join(DIR, "bridge.json"), AE_AERENDER: fake, AE_MCP_ALLOWED_DIRS: DIR, AE_MCP_UPDATE_CHECK: "0", ...extraEnv },
    stdio: ["pipe", "pipe", "pipe"],
  });
  let buf = "";
  const waiters = new Map<number, (reply: RpcReply) => void>();
  p.stdout.on("data", (d) => {
    buf += d;
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i);
      buf = buf.slice(i + 1);
      if (!line.trim()) continue;
      try {
        const j = JSON.parse(line);
        if (j.id !== undefined && waiters.has(j.id)) { waiters.get(j.id)!(j); waiters.delete(j.id); }
      } catch {}
    }
  });
  let nextId = 1;
  const call = (method: string, params: Json): Promise<RpcReply> =>
    new Promise((resolve, reject) => {
      const id = nextId++;
      waiters.set(id, resolve);
      p.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
      setTimeout(() => reject(new Error("timeout " + method)), 15000);
    });
  const exited = new Promise<{ code: number | null; sig: NodeJS.Signals | null }>((r) => p.on("exit", (code, sig) => r({ code, sig })));
  const init = async () => {
    await call("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "t", version: "0" } });
    p.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
  };
  return { p, call, exited, init };
}

const alive = (pid: number): boolean => { try { process.kill(pid, 0); return true; } catch { return false; } };
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
/** First text block of a tool result. */
const textOf = (r: RpcReply): string => { const c = r.result?.content?.[0]; return c && c.type === "text" ? c.text : ""; };
const results: [name: string, pass: boolean][] = [];

// Phase A: a render that cannot start (project never saved) must not destroy the existing output file.
{
  const out = path.join(DIR, "existing.mov");
  fs.writeFileSync(out, "previous render");
  prepareOk = false;
  const s = startServer();
  await s.init();
  const r = await s.call("tools/call", { name: "render_start", arguments: { comp_id: 1, output_path: out, overwrite: true } });
  const text = textOf(r);
  results.push(["A: failed start is reported as an error", r.result?.isError === true && text.includes("never been saved")]);
  results.push(["A: existing output survives a failed start", fs.existsSync(out)]);
  s.p.stdin.end();
  await Promise.race([s.exited, sleep(3000)]);
  s.p.kill();
}

// Phase B: when the MCP client disconnects, running aerender jobs must be stopped and the server must exit.
{
  const out = path.join(DIR, "new.mov");
  try { fs.rmSync(out); } catch {}
  try { fs.rmSync(path.join(DIR, "aerender.pid")); } catch {}
  prepareOk = true;
  const s = startServer();
  await s.init();
  const r = await s.call("tools/call", { name: "render_start", arguments: { comp_id: 1, output_path: out } });
  let pid = 0;
  for (let i = 0; i < 50 && !pid; i++) { // first exec of a fresh script can be slow on macOS
    await sleep(100);
    try { pid = parseInt(fs.readFileSync(path.join(DIR, "aerender.pid"), "utf8"), 10) || 0; } catch {}
  }
  const spawned = r.result?.isError !== true && pid > 0 && alive(pid);
  if (!spawned) console.log("  debug:", JSON.stringify({ result: r.result, pid, alive: pid > 0 && alive(pid) }));
  results.push(["B: render_start spawns aerender", spawned]);
  s.p.stdin.end(); // client goes away
  const ex = await Promise.race([s.exited, sleep(4000).then(() => "still-running")]);
  results.push(["B: server exits when the client disconnects", ex !== "still-running"]);
  await sleep(300);
  results.push(["B: aerender is stopped on disconnect", pid > 0 && !alive(pid)]);
  if (pid > 0 && alive(pid)) process.kill(pid, "SIGKILL"); // cleanup if the check failed
  s.p.kill();
}

// Phase C: aerender writes a different extension than requested; render_status must report the real file.
{
  prepareOk = true;
  const s = startServer({ FAKE_MODE: "write" });
  await s.init();
  const out = path.join(DIR, "c.mov");
  const r = await s.call("tools/call", { name: "render_start", arguments: { comp_id: 1, output_path: out } });
  const job = JSON.parse(textOf(r)).job_id;
  let st: Json = {};
  for (let i = 0; i < 50 && st.state !== "done"; i++) {
    await sleep(100);
    const sr = await s.call("tools/call", { name: "render_status", arguments: { job_id: job } });
    st = JSON.parse(textOf(sr));
  }
  results.push(["C: job finishes", st.state === "done"]);
  results.push(["C: status reports the file actually written (.mp4)", typeof st.output_path === "string" && st.output_path.endsWith(".mp4") && st.output_exists === true]);
  results.push(["C: status keeps the requested path and explains the difference", typeof st.requested_path === "string" && st.requested_path.endsWith("c.mov") && typeof st.note === "string"]);
  s.p.stdin.end();
  await Promise.race([s.exited, sleep(3000)]);
  s.p.kill();
}

// Phase D: preview_frame must wait for a PNG that is written shortly after the command returns.
{
  prepareOk = true;
  const s = startServer();
  await s.init();
  const started = Date.now();
  const r = await s.call("tools/call", { name: "preview_frame", arguments: { comp_id: 1, time: 0 } });
  const content = r.result?.content ?? [];
  results.push(["D: preview_frame waits for a PNG written after the command returns", r.result?.isError !== true && content.some((c) => c.type === "image")]);
  results.push(["D: ...without waiting much longer than needed", Date.now() - started < 5000]);
  s.p.stdin.end();
  await Promise.race([s.exited, sleep(3000)]);
  s.p.kill();
}

// Phase E: argument forwarding. Only declared path arguments are sandboxed; everything else reaches the host unchanged.
{
  const s = startServer();
  await s.init();
  const callTool = (name: string, args: Json) => s.call("tools/call", { name, arguments: args });
  const errCode = (r: RpcReply): string | undefined => { try { return JSON.parse(textOf(r)).error.code; } catch { return undefined; } };

  await callTool("add_property", { layer_id: 1, match_name: "ADBE Text Animator", group_path: ["ADBE Text Properties", "ADBE Text Animators"] });
  results.push(["E: add_property forwards match_name unchanged (it is not a path)", received.add_property?.match_name === "ADBE Text Animator"]);

  const inside = path.join(DIR, "sub", "clip.mov");
  await callTool("import_footage", { path: inside });
  results.push(["E: path arguments inside the allowed folders are resolved and sent with forward slashes",
    received.import_footage?.path === fs.realpathSync(DIR).replace(/\\/g, "/") + "/sub/clip.mov"]);

  delete received.import_footage;
  const outside = await callTool("import_footage", { path: path.join(path.parse(DIR).root, "definitely-not-allowed", "x.mov") });
  results.push(["E: path arguments outside the allowed folders are refused before reaching the host", errCode(outside) === "FORBIDDEN" && !received.import_footage]);

  const jsx = await callTool("run_jsx", { code: "1+1" });
  results.push(["E: run_jsx is refused unless AE_MCP_ALLOW_JSX=1", errCode(jsx) === "FORBIDDEN" && !received.run_jsx]);

  s.p.stdin.end();
  await Promise.race([s.exited, sleep(3000)]);
  s.p.kill();
}

// Phase F: strict input validation and the response size cap.
{
  const s = startServer();
  await s.init();
  const callTool = (name: string, args: Json) => s.call("tools/call", { name, arguments: args });
  const text = textOf;

  delete received.set_layer;
  const typo = await callTool("set_layer", { layer_id: 1, colour: 5 });
  results.push(["F: an unknown argument is rejected, not silently dropped", typo.result?.isError === true && text(typo).includes("colour") && !received.set_layer]);

  delete received.add_layer;
  const nested = await callTool("add_layer", { comp_id: 1, kind: "shape", options: { shape: { type: "rect", fil: [1, 0, 0] } } });
  results.push(["F: unknown keys in nested objects are rejected too", nested.result?.isError === true && text(nested).includes("fil") && !received.add_layer]);

  await callTool("add_layer", { comp_id: 1, kind: "shape", options: { shape: { fill: [1, 0, 0] } } });
  results.push(["F: schema defaults still apply under strict validation", received.add_layer?.options?.shape?.type === "rect"]);

  const big = await callTool("list_properties", { layer_id: 1 });
  let body: Json = {};
  try { body = JSON.parse(text(big)); } catch {}
  results.push(["F: an over-limit response becomes an error with the tool's hint", big.result?.isError === true && /over the 25000 limit/.test(body.error?.message ?? "") && /group_path/.test(body.error?.hint ?? "")]);

  s.p.stdin.end();
  await Promise.race([s.exited, sleep(3000)]);
  s.p.kill();
}

// Phase G: update check against a fake GitHub tags API.
{
  const tagServer = http.createServer((req, res) => {
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify([{ name: "v99.1.0" }, { name: "v2.0.0" }, { name: "nightly" }, { name: "v99.0.9" }]));
  });
  await new Promise<void>((r) => tagServer.listen(0, "127.0.0.1", () => r()));
  const tagsUrl = `http://127.0.0.1:${(tagServer.address() as AddressInfo).port}/tags`;
  const cache = path.join(DIR, "update.json");
  try { fs.rmSync(cache); } catch {}

  const s = startServer({ AE_MCP_UPDATE_CHECK: "1", AE_MCP_UPDATE_URL: tagsUrl });
  await s.init();
  const check = JSON.parse(textOf(await s.call("tools/call", { name: "check_for_updates", arguments: { force: true } })));
  results.push(["G: check_for_updates finds the newest vX.Y.Z tag and how to update",
    check.latest === "99.1.0" && check.update_available === true && /git pull/.test(check.how ?? "")]);
  results.push(["G: the result is cached next to the bridge file (the panel reads it)", fs.existsSync(cache) && JSON.parse(fs.readFileSync(cache, "utf8")).latest === "99.1.0"]);
  const proj = JSON.parse(textOf(await s.call("tools/call", { name: "get_project", arguments: {} })));
  results.push(["G: get_project carries the update note", proj.update?.latest === "99.1.0"]);
  s.p.stdin.end(); await Promise.race([s.exited, sleep(3000)]); s.p.kill();

  const off = startServer({ AE_MCP_UPDATE_CHECK: "0", AE_MCP_UPDATE_URL: tagsUrl });
  await off.init();
  const disabled = JSON.parse(textOf(await off.call("tools/call", { name: "check_for_updates", arguments: {} })));
  const proj2 = JSON.parse(textOf(await off.call("tools/call", { name: "get_project", arguments: {} })));
  results.push(["G: AE_MCP_UPDATE_CHECK=0 turns the check and the note off", disabled.disabled === true && proj2.update === undefined]);
  off.p.stdin.end(); await Promise.race([off.exited, sleep(3000)]); off.p.kill();

  try { fs.rmSync(cache); } catch {}
  const down = startServer({ AE_MCP_UPDATE_CHECK: "1", AE_MCP_UPDATE_URL: "http://127.0.0.1:9/tags" });
  await down.init();
  const failed = await down.call("tools/call", { name: "check_for_updates", arguments: { force: true } });
  const fbody = JSON.parse(textOf(failed));
  results.push(["G: an unreachable update server is reported, not thrown", failed.result?.isError !== true && fbody.latest === null && typeof fbody.error === "string"]);
  down.p.stdin.end(); await Promise.race([down.exited, sleep(3000)]); down.p.kill();
  tagServer.close();
}

for (const [name, ok] of results) console.log((ok ? "PASS" : "FAIL") + "  " + name);
bridge.close();
fs.rmSync(DIR, { recursive: true, force: true });
process.exit(results.every((x) => x[1]) ? 0 : 1);
