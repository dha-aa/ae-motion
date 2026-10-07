// Integration test for render_start against a fake bridge and a fake aerender (no After Effects needed).
// Uses a bash script as the fake aerender, so it is skipped on Windows.
import http from "node:http";
import os from "node:os";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

if (process.platform === "win32") { console.log("SKIP  render tests (need bash)"); process.exit(0); }
const DIR = fs.mkdtempSync(path.join(os.tmpdir(), "ae-motion-render-"));
const SERVER = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "dist", "index.js");
const TOKEN = "testtoken";
let prepareOk = true;

const bridge = http.createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    res.setHeader("content-type", "application/json");
    if (req.headers["x-ae-token"] !== TOKEN) { res.statusCode = 401; return res.end("{}"); }
    const { cmd } = JSON.parse(body);
    if (cmd === "prepare_render") {
      if (!prepareOk) return res.end(JSON.stringify({ ok: false, error: { code: "BAD_ARGS", message: "Project has never been saved" } }));
      return res.end(JSON.stringify({ ok: true, result: { project_path: "/tmp/x.aep", comp_name: "C", total_frames: 10, aerender_dir: DIR } }));
    }
    res.end(JSON.stringify({ ok: true, result: {} }));
  });
});
await new Promise((r) => bridge.listen(0, "127.0.0.1", r));
fs.writeFileSync(path.join(DIR, "bridge.json"), JSON.stringify({ port: bridge.address().port, token: TOKEN }));

const fake = path.join(DIR, "aerender");
fs.writeFileSync(fake, `#!/bin/bash\necho $$ > ${DIR}/aerender.pid\nif [ "$FAKE_MODE" = "write" ]; then\n  while [ "$1" != "-output" ]; do shift; done\n  out="$2"; echo "PROGRESS: finished"; printf data > "\${out%.*}.mp4"; exit 0\nfi\nexec sleep 300\n`, { mode: 0o755 });

function startServer(extraEnv = {}) {
  const p = spawn("node", [SERVER], {
    env: { ...process.env, AE_MCP_BRIDGE_FILE: path.join(DIR, "bridge.json"), AE_AERENDER: fake, AE_MCP_ALLOWED_DIRS: DIR, ...extraEnv },
    stdio: ["pipe", "pipe", "pipe"],
  });
  let buf = "";
  const waiters = new Map();
  p.stdout.on("data", (d) => {
    buf += d;
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i);
      buf = buf.slice(i + 1);
      if (!line.trim()) continue;
      try {
        const j = JSON.parse(line);
        if (j.id !== undefined && waiters.has(j.id)) { waiters.get(j.id)(j); waiters.delete(j.id); }
      } catch {}
    }
  });
  let nextId = 1;
  const call = (method, params) =>
    new Promise((resolve, reject) => {
      const id = nextId++;
      waiters.set(id, resolve);
      p.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
      setTimeout(() => reject(new Error("timeout " + method)), 15000);
    });
  const exited = new Promise((r) => p.on("exit", (code, sig) => r({ code, sig })));
  const init = async () => {
    await call("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "t", version: "0" } });
    p.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
  };
  return { p, call, exited, init };
}

const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];

// Phase A: a render that cannot start (project never saved) must not destroy the existing output file.
{
  const out = path.join(DIR, "existing.mov");
  fs.writeFileSync(out, "previous render");
  prepareOk = false;
  const s = startServer();
  await s.init();
  const r = await s.call("tools/call", { name: "render_start", arguments: { comp_id: 1, output_path: out, overwrite: true } });
  const text = r.result?.content?.[0]?.text ?? "";
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
  const job = JSON.parse(r.result.content[0].text).job_id;
  let st = {};
  for (let i = 0; i < 50 && st.state !== "done"; i++) {
    await sleep(100);
    const sr = await s.call("tools/call", { name: "render_status", arguments: { job_id: job } });
    st = JSON.parse(sr.result.content[0].text);
  }
  results.push(["C: job finishes", st.state === "done"]);
  results.push(["C: status reports the file actually written (.mp4)", typeof st.output_path === "string" && st.output_path.endsWith(".mp4") && st.output_exists === true]);
  results.push(["C: status keeps the requested path and explains the difference", typeof st.requested_path === "string" && st.requested_path.endsWith("c.mov") && typeof st.note === "string"]);
  s.p.stdin.end();
  await Promise.race([s.exited, sleep(3000)]);
  s.p.kill();
}

for (const [name, ok] of results) console.log((ok ? "PASS" : "FAIL") + "  " + name);
bridge.close();
fs.rmSync(DIR, { recursive: true, force: true });
process.exit(results.every((x) => x[1]) ? 0 : 1);
