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
const calls: string[] = []; // every command the fake bridge received, in order

const bridge = http.createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    res.setHeader("content-type", "application/json");
    if (req.headers["x-ae-token"] !== TOKEN) { res.statusCode = 401; return res.end("{}"); }
    const { cmd, args } = JSON.parse(body);
    received[cmd] = args;
    calls.push(cmd);
    if (cmd === "add_layer") return res.end(JSON.stringify({ ok: true, result: { id: 42, name: args.options?.name ?? "L" } }));
    if (cmd === "delete_layer" && args.layer_id === 13) return res.end(JSON.stringify({ ok: false, error: { code: "NOT_FOUND", message: "No layer with id 13", hint: "Use get_comp" } }));
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
  const notifications: string[] = []; // methods of server notifications, in order
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
        else if (j.id === undefined && j.method) notifications.push(j.method);
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
  return { p, call, exited, init, notifications };
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

// Phase H: batch runs bridged tools in order with the same validation, sandbox and references to earlier results.
{
  const s = startServer();
  await s.init();
  const callTool = (name: string, args: Json) => s.call("tools/call", { name, arguments: args });
  const body = async (name: string, args: Json): Promise<[Json, boolean]> => {
    const r = await callTool(name, args);
    let b: Json = {};
    try { b = JSON.parse(textOf(r)); } catch {}
    return [b, r.result?.isError === true];
  };

  calls.length = 0;
  const [ok] = await body("batch", { steps: [
    { tool: "add_layer", args: { comp_id: 1, kind: "null", options: { name: "Ctrl" } } },
    { tool: "set_layer", args: { layer_id: "$1.id", label: 3 } },
    { tool: "link_layers", args: { layer_ids: [5, 6], parent_id: "$1.id" } },
  ] });
  results.push(["H: batch runs the steps in order and fills $N.path references", calls.join(",") === "add_layer,set_layer,link_layers" && received.set_layer?.layer_id === 42 && received.link_layers?.parent_id === 42 && ok.steps === 3 && ok.results?.[0]?.id === 42]);

  calls.length = 0;
  const [bad, badErr] = await body("batch", { steps: [{ tool: "set_layer", args: { layer_id: 1, label: 2 } }, { tool: "set_layer", args: { layer_id: 1, colour: 2 } }, { tool: "set_layer", args: { layer_id: 1 } }] });
  results.push(["H: an invalid step anywhere means nothing runs, and it is reported", badErr && calls.length === 0 && bad.steps === 0 && bad.problems?.length === 1 && bad.problems[0].step === 2 && /colour/.test(bad.problems[0].message)]);

  calls.length = 0;
  const [pre, preErr] = await body("batch", { steps: [
    { tool: "add_layer", args: { comp_id: 1, kind: "null" } },
    { tool: "set_layer", args: { layer_id: "$1.id", label: 3 } },
    { tool: "add_shape", args: { layer_id: "$1.id", type: "rect" } },
    { tool: "set_layer", args: { layer_id: "$9.id" } },
    { tool: "camera_teleport", args: {} },
  ] });
  const msgs = (pre.problems ?? []).map((x: Json) => `${x.step}:${x.message}`).join(" | ");
  results.push(["H: the pre-check lists every problem: unknown keys next to a reference, forward references, unknown tools", preErr && calls.length === 0 && pre.problems?.length === 4 && /3:args: Unrecognized key.*'type'/.test(msgs) && /3:shape: Required/.test(msgs) && /4:.*step 9/.test(msgs) && /5:unknown/.test(msgs) && !/^2:/.test(msgs)]);

  calls.length = 0;
  const [failed, failedErr] = await body("batch", { steps: [{ tool: "delete_layer", args: { layer_id: 13 } }, { tool: "set_layer", args: { layer_id: 1 } }] });
  results.push(["H: a host error stops the batch with the host's code", failedErr && failed.error?.code === "NOT_FOUND" && calls.length === 1]);

  calls.length = 0;
  const [outside, outsideErr0] = await body("batch", { steps: [{ tool: "import_footage", args: { path: "/etc/passwd" } }] });
  const outsideErr = outsideErr0 && outside.error?.code === "FORBIDDEN";
  await body("batch", { steps: [{ tool: "import_footage", args: { path: path.join(DIR, "a.png") } }] });
  const sandboxed = calls.length === 1 && !String(received.import_footage?.path).includes("\\");
  calls.length = 0;
  const [, refErr] = await body("batch", { steps: [{ tool: "set_layer", args: { layer_id: "$1.id" } }] });
  const [, jsxErr] = await body("batch", { steps: [{ tool: "run_jsx", args: { code: "1" } }] });
  const [, openErr] = await body("batch", { steps: [{ tool: "open_project", args: { path: path.join(DIR, "x.aep") } }] });
  results.push(["H: paths are sandboxed, forward references, run_jsx and open_project are refused", sandboxed && outsideErr && refErr && jsxErr && openErr && calls.length === 0]);

  const [last] = await body("batch", { steps: [{ tool: "add_layer", args: { comp_id: 1, kind: "null" } }, { tool: "set_layer", args: { layer_id: "$1.id" } }], results: "none" });
  results.push(["H: results none returns only the step count", JSON.stringify(last) === '{"steps":2}']);

  // the shapes models send by mistake: steps / args as JSON strings, name / arguments, client-prefixed names
  calls.length = 0;
  const [loose, looseErr] = await body("batch", { steps: JSON.stringify([
    { name: "mcp__ae-motion__add_layer", arguments: JSON.stringify({ comp_id: 1, kind: "null" }) },
    { tool: "set_layer", params: { layer_id: "$1.id", label: 2 } },
  ]) });
  results.push(["H: batch accepts JSON-string steps/args, name/arguments/params and prefixed tool names", !looseErr && loose.steps === 2 && calls.join(",") === "add_layer,set_layer" && received.set_layer?.layer_id === 42]);

  // server-side tools run as steps too (get_project adds no host command of its own beyond the bridge call)
  calls.length = 0;
  const [srv, srvErr] = await body("batch", { steps: [{ tool: "get_project", args: {} }, { tool: "add_layer", args: { comp_id: 1, kind: "null" } }] });
  const [, prevErr] = await body("batch", { steps: [{ tool: "preview_frame", args: { comp_id: 1, time: 0 } }] });
  results.push(["H: server tools such as get_project run in a batch; preview_frame is refused", !srvErr && srv.steps === 2 && calls.join(",") === "get_project,add_layer" && prevErr && calls.length === 2]);

  // results over the size limit are shortened, not turned into an error: every step already ran
  calls.length = 0;
  const big = await callTool("batch", { steps: [{ tool: "add_layer", args: { comp_id: 1, kind: "null" } }, { tool: "list_properties", args: { layer_id: 1 } }] });
  const bigBody = JSON.parse(textOf(big));
  results.push(["H: an over-limit batch result is shortened to ids and names, not an error", big.result?.isError !== true && bigBody.steps === 2 && bigBody.results?.[0]?.id === 42 && /shortened/.test(bigBody.note) && textOf(big).length < 25000]);

  // progress after each step when the client asks for it
  const before = s.notifications.length;
  await s.call("tools/call", { name: "batch", arguments: { steps: [{ tool: "add_layer", args: { comp_id: 1, kind: "null" } }, { tool: "set_layer", args: { layer_id: "$1.id" } }] }, _meta: { progressToken: "p1" } });
  results.push(["H: batch sends a progress notification per step when given a progress token", s.notifications.slice(before).filter((m) => m === "notifications/progress").length === 2]);

  s.p.stdin.end();
  await Promise.race([s.exited, sleep(3000)]);
  s.p.kill();
}

// Phase I: AE_MCP_TOOLSETS leaves groups out; load_tools adds them during the session.
{
  const s = startServer({ AE_MCP_TOOLSETS: "core" });
  const initReply = await s.call("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "t", version: "0" } });
  s.p.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
  const listNames = async (srv: { call: typeof s.call }): Promise<string[]> => (((await srv.call("tools/list", {})).result as Json | undefined)?.tools ?? []).map((t: Json) => t.name);
  const names = (): Promise<string[]> => listNames(s);
  const before = await names();
  results.push(["I: a partial toolset lists load_tools and not the other groups' tools", before.includes("load_tools") && before.includes("batch") && before.includes("add_layer") && !before.includes("camera_move") && /load_tools/.test((initReply.result as Json | undefined)?.instructions ?? "")]);

  const r = await s.call("tools/call", { name: "load_tools", arguments: { groups: ["scene3d"] } });
  let body: Json = {};
  try { body = JSON.parse(textOf(r)); } catch {}
  await sleep(200);
  const after = await names();
  results.push(["I: load_tools registers the group, reports its tools and sends tools/list_changed", body.loaded?.[0] === "scene3d" && body.tools?.includes("camera_move") && after.includes("camera_move") && s.notifications.includes("notifications/tools/list_changed")]);

  calls.length = 0;
  const viaBatch = await s.call("tools/call", { name: "batch", arguments: { steps: [{ tool: "set_light", args: { layer_id: 3, intensity: 50 } }] } });
  const again = JSON.parse(textOf(await s.call("tools/call", { name: "load_tools", arguments: { groups: ["scene3d"] } })));
  results.push(["I: loaded tools run through batch; loading a group twice adds nothing", viaBatch.result?.isError !== true && calls.join(",") === "set_light" && again.loaded.length === 0]);

  const all = startServer();
  await all.init();
  const allNames = await listNames(all);
  results.push(["I: with every group loaded there is no load_tools", !allNames.includes("load_tools") && allNames.includes("camera_move")]);

  for (const x of [s, all]) { x.p.stdin.end(); await Promise.race([x.exited, sleep(3000)]); x.p.kill(); }
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
