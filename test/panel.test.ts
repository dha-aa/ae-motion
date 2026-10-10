// The CEP panel (panel/main.js) against a fake CEP and DOM, driven by the server's real HttpBridge (dist/bridge.js):
// token check, one command at a time, dropping commands whose caller timed out, the TIMEOUT messages, the Update
// button and the bridge file's lifecycle. The panel's real Node modules are used except child_process (faked).
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "ae-motion-panel-")));
const bridgeFile = path.join(tmp, "state", "bridge.json");
process.env.AE_MCP_BRIDGE_FILE = bridgeFile;
const { HttpBridge } = await import(pathToFileURL(path.join(ROOT, "dist", "bridge.js")).href);

type Json = Record<string, any>;
const results: [name: string, pass: boolean, msg?: string][] = [];
const errText = (e: unknown): string => (e instanceof Error ? e.message : String(e));
const t = async (name: string, fn: () => Promise<void> | void): Promise<void> => { try { await fn(); results.push([name, true]); } catch (e) { results.push([name, false, errText(e)]); } };
const eq = (a: unknown, b: unknown, what: string): void => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${what}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); };
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
async function until(cond: () => boolean, what: string, ms = 3000): Promise<void> {
  const end = Date.now() + ms;
  while (!cond()) { if (Date.now() > end) throw new Error("timed out waiting for " + what); await sleep(10); }
}

// ----- fakes -----
const panelDir = path.join(tmp, "panel");
fs.mkdirSync(panelDir);
const repo = path.join(tmp, "repo");
fs.mkdirSync(path.join(repo, "scripts"), { recursive: true });
fs.writeFileSync(path.join(repo, "scripts", "update.ts"), "");

class El {
  textContent = ""; className = ""; disabled = false; style: Json = {}; attrs: Json = {}; listeners: Json = {};
  setAttribute(k: string, v: string): void { this.attrs[k] = v; }
  getAttribute(k: string): string { return this.attrs[k]; }
  addEventListener(ev: string, fn: () => void): void { this.listeners[ev] = fn; }
  click(): void { this.listeners.click(); }
}
const els: Record<string, El> = {};
const document = { getElementById: (id: string): El => (els[id] ??= new El()) };
els["update-btn"] = new El();
els["update-btn"].attrs["data-label"] = "Reinstall";

/** cep.evalScript: AEM.dispatch calls wait until the test releases them (one deferred per call). */
type Pending = { cmd: string; args: Json; resolve: (reply: string) => void };
const pending: Pending[] = [];
const ran: string[] = [];
let maxConcurrent = 0, concurrent = 0, hostVersion = "2.12.0", evalFiles: string[] = [];
const cep = {
  evalScript(script: string, cb: (r: string) => void): void {
    if (script === "AEM.version") return void setTimeout(() => cb(hostVersion), 0);
    if (script.startsWith("$.evalFile(")) { evalFiles.push(script); return void setTimeout(() => cb("true"), 0); }
    const m = /^AEM\.dispatch\((.*)\)$/s.exec(script);
    if (!m) throw new Error("unexpected script " + script);
    const { cmd, args } = JSON.parse(JSON.parse(m[1]));
    ran.push(cmd);
    concurrent++; maxConcurrent = Math.max(maxConcurrent, concurrent);
    pending.push({ cmd, args, resolve: (reply) => { concurrent--; cb(reply); } });
  },
};
const finish = (reply: Json | string = { ok: true, result: {} }): void => {
  const p = pending.shift();
  if (!p) throw new Error("nothing running");
  p.resolve(typeof reply === "string" ? reply : JSON.stringify(reply));
};

/** child_process.spawn: records the call; the test ends the fake process with `exit`. */
type Spawned = { cmd: string; args: string[]; opts: Json; exit: (code: number, out?: string) => void };
const spawned: Spawned[] = [];
const fakeChildProcess = {
  spawn(cmd: string, args: string[], opts: Json) {
    const h: Json = { stdout: {}, stderr: {} };
    const on = (target: Json) => (ev: string, fn: (...a: unknown[]) => void) => { target["on_" + ev] = fn; };
    h.on = on(h); h.stdout.on = on(h.stdout); h.stderr.on = on(h.stderr);
    spawned.push({ cmd, args, opts, exit: (code, out = "") => { if (out) h.stdout.on_data(out); h.on_close(code); } });
    return h;
  },
};

const req = createRequire(import.meta.url);
let reloaded = 0;
const storage = new Map<string, string>();
const windowListeners: Json = {};
const window = {
  __adobe_cep__: cep,
  location: { pathname: path.join(panelDir, "index.html").split(path.sep).join("/").replace(/^(?=[A-Za-z]:)/, "/"), reload: () => { reloaded++; } },
  localStorage: { getItem: (k: string) => storage.get(k) ?? null, setItem: (k: string, v: string) => void storage.set(k, v), removeItem: (k: string) => void storage.delete(k) },
  addEventListener: (ev: string, fn: () => void) => { windowListeners[ev] = fn; },
};
const intervals: (() => void)[] = [];
const ctx = vm.createContext({
  window, document, process, console, Promise, JSON, Math, Date, decodeURIComponent, setImmediate,
  setTimeout, clearTimeout, setInterval: (fn: () => void) => { intervals.push(fn); return 0; },
  require: (name: string) => (name === "child_process" ? fakeChildProcess : req(name)),
});
vm.runInContext(fs.readFileSync(path.join(ROOT, "panel", "main.js"), "utf8"), ctx, { filename: "panel/main.js" });

await until(() => fs.existsSync(bridgeFile), "the bridge file");
const info = JSON.parse(fs.readFileSync(bridgeFile, "utf8"));
const bridge = new HttpBridge();
const raw = (method: string, url: string, token: string, body?: string): Promise<{ status: number; json: Json }> => new Promise((resolve, reject) => {
  const r = http.request({ host: "127.0.0.1", port: info.port, path: url, method, headers: { "x-ae-token": token } }, (res) => {
    let d = ""; res.on("data", (c) => (d += c)); res.on("end", () => resolve({ status: res.statusCode!, json: JSON.parse(d) }));
  });
  r.on("error", reject);
  r.end(body);
});

// ----- tests -----
await t("writes the bridge file (port, token, pid) owner-only and shows the address", () => {
  if (!(info.port >= 47670 && info.port <= 47690)) throw new Error("port " + info.port);
  eq(info.token.length, 48, "token length");
  eq(info.drops, true, "says it drops timed-out commands");
  if (process.platform !== "win32") eq((fs.statSync(bridgeFile).mode & 0o777).toString(8), "600", "mode");
  eq(els.status.textContent, "127.0.0.1:" + info.port, "status");
  eq(els.status.className, "ok", "status class");
});

await t("rejects a wrong token, answers /health, 404s other routes and 400s bad JSON", async () => {
  eq((await raw("GET", "/health", "nope")).status, 401, "bad token");
  const h = await raw("GET", "/health", info.token);
  eq([h.status, h.json.result], [200, { panel: "ae-motion-mcp", queued: 0 }], "health");
  eq((await raw("GET", "/cmd", info.token)).status, 404, "GET /cmd");
  const bad = await raw("POST", "/cmd", info.token, "{nope");
  eq([bad.status, bad.json.error.code], [400, "BAD_ARGS"], "bad JSON");
  eq(ran.length, 0, "nothing ran");
});

await t("runs a command and returns the host's reply; a non-JSON reply becomes AE_ERROR", async () => {
  const p = bridge.run("get_project", { a: 1 });
  await until(() => pending.length === 1, "dispatch");
  eq(pending[0].args, { a: 1 }, "args reach the host");
  finish({ ok: true, result: { name: "P" } });
  eq(await p, { ok: true, result: { name: "P" } }, "reply");
  eq([String(els.count.textContent), els.last.textContent], ["1", "get_project"], "counters");
  const q = bridge.run("get_comp", {});
  await until(() => pending.length === 1, "dispatch");
  finish("Error: something broke");
  const r = await q;
  eq([r.ok, r.error.code], [false, "AE_ERROR"], "non-JSON reply");
  eq(els.err.textContent, "AE_ERROR: Host returned: Error: something broke", "last error");
});

await t("runs one command at a time, in arrival order", async () => {
  maxConcurrent = 0; ran.length = 0;
  const ps = ["a", "b", "c"].map((c) => bridge.run(c, {}));
  await until(() => pending.length === 1, "first dispatch");
  await sleep(50);
  eq(pending.length, 1, "only one in After Effects");
  for (let i = 0; i < 3; i++) { await until(() => pending.length === 1, "next dispatch"); finish(); }
  await Promise.all(ps);
  eq([ran, maxConcurrent], [["a", "b", "c"], 1], "order and concurrency");
});

await t("/health reports the running command and the queue", async () => {
  const p1 = bridge.run("render_heavy", {});
  const p2 = bridge.run("next_one", {});
  await until(() => pending.length === 1, "dispatch");
  await sleep(30);
  const h = await raw("GET", "/health", info.token);
  eq([h.json.result.busy.cmd, h.json.result.queued], ["render_heavy", 1], "busy and queued");
  finish(); await until(() => pending.length === 1, "second"); finish();
  await Promise.all([p1, p2]);
});

await t("a queued command whose caller timed out is dropped, not run late; the TIMEOUT says so", async () => {
  ran.length = 0;
  const slow = bridge.run("slow_render", {}, 5000);
  await until(() => pending.length === 1, "dispatch");
  const late = await bridge.run("add_layer", {}, 150); // times out while queued behind slow_render
  eq(late.error.code, "TIMEOUT", "code");
  if (!/add_layer was waiting behind slow_render .* never started and was dropped/.test(late.error.message)) throw new Error("message: " + late.error.message);
  await sleep(30); // After Effects finishes slow_render a little later (here the panel would be blocked until then)
  finish();
  await slow;
  await sleep(50);
  eq([ran, pending.length], [["slow_render"], 0], "add_layer never reached After Effects");
  if (!/dropped 1/.test(els.err.textContent)) throw new Error("panel shows: " + els.err.textContent);
});

await t("a running command that times out keeps running; the TIMEOUT says to inspect before retrying", async () => {
  const r = await bridge.run("precompose", {}, 150);
  if (!/still running precompose/.test(r.error.message) || !/may run twice/.test(r.error.hint)) throw new Error(JSON.stringify(r.error));
  finish();
  await sleep(30);
  eq(pending.length, 0, "nothing left running");
});

/** Point the bridge file at a stand-in panel for one call. */
async function withPanel(handler: http.RequestListener, extra: Json, fn: () => Promise<void>): Promise<void> {
  const srv = http.createServer(handler);
  await new Promise<void>((r) => srv.listen(0, "127.0.0.1", () => r()));
  const saved = fs.readFileSync(bridgeFile, "utf8");
  fs.writeFileSync(bridgeFile, JSON.stringify({ port: (srv.address() as { port: number }).port, token: "x", ...extra }));
  try { await fn(); } finally { fs.writeFileSync(bridgeFile, saved); srv.closeAllConnections(); srv.close(); }
}

await t("TIMEOUT while After Effects is busy (the real panel can't answer /health then): probably still running", async () => {
  await withPanel(() => { /* blocked: answers nothing */ }, { drops: true }, async () => {
    const r = await bridge.run("precompose", {}, 150);
    if (!/After Effects is busy, probably still running precompose/.test(r.error.message) || !/may run twice/.test(r.error.hint)) throw new Error(JSON.stringify(r.error));
  });
});

await t("TIMEOUT behind an older panel's queue says the command will still run", async () => {
  await withPanel(() => {}, {}, async () => {
    const first = bridge.run("slow", {}, 2000);
    await sleep(20);
    const r = await bridge.run("add_layer", {}, 150);
    if (!/add_layer is waiting behind slow and will still run/.test(r.error.message)) throw new Error(JSON.stringify(r.error));
    await first;
  });
});

await t("TIMEOUT from an older panel (no queue in /health) keeps the generic message", async () => {
  const old = http.createServer((q, s) => {
    if (q.url === "/health") return s.end(JSON.stringify({ ok: true, result: { panel: "ae-motion-mcp" } }));
    // never answer /cmd
  });
  await new Promise<void>((r) => old.listen(0, "127.0.0.1", () => r()));
  const saved = fs.readFileSync(bridgeFile, "utf8");
  fs.writeFileSync(bridgeFile, JSON.stringify({ port: (old.address() as { port: number }).port, token: "x" }));
  const r = await bridge.run("get_project", {}, 150);
  fs.writeFileSync(bridgeFile, saved);
  old.closeAllConnections(); old.close();
  eq([r.error.code, r.error.message], ["TIMEOUT", "No response within 0.15s"], "generic");
});

await t("version line and update notice come from the host and update.json", async () => {
  eq(els.version.textContent, "v2.12.0", "version");
  eq(els["update-row"].style.display, "none", "no update.json: hidden");
  fs.writeFileSync(path.join(tmp, "state", "update.json"), JSON.stringify({ latest: "2.13.0" }));
  intervals.forEach((f) => f());
  eq([els.update.textContent, els["update-row"].style.display, els["update-btn"].textContent], ["v2.13.0 available", "", "Update to v2.13.0"], "update shown");
  fs.writeFileSync(path.join(tmp, "state", "update.json"), JSON.stringify({ latest: "2.9.9" }));
  intervals.forEach((f) => f());
  eq([els["update-row"].style.display, els["update-btn"].textContent], ["none", "Reinstall"], "older release: hidden");
});

await t("Update needs install.json, and two clicks", async () => {
  els["update-btn"].click(); els["update-btn"].click();
  if (!/re-run the installer/.test(els["update-log"].textContent)) throw new Error("no install.json: " + els["update-log"].textContent);
  fs.writeFileSync(path.join(panelDir, "install.json"), "﻿" + JSON.stringify({ repo, path: "/opt/fake/bin" })); // PowerShell writes a BOM
  els["update-btn"].click();
  eq([spawned.length, els["update-btn"].textContent], [0, "Click again to confirm"], "first click only arms");
  els["update-btn"].click();
  eq(spawned.length, 1, "second click runs it");
});

await t("Update runs scripts/update.ts with the installer's PATH, then reloads the host and the panel", async () => {
  const s = spawned[0];
  eq([s.cmd, s.args, s.opts.cwd], ["node", [path.join("scripts", "update.ts")], repo], "command");
  if (!s.opts.env.PATH.startsWith("/opt/fake/bin" + (process.platform === "win32" ? ";" : ":"))) throw new Error("PATH " + s.opts.env.PATH);
  eq(els["update-btn"].disabled, true, "button disabled while running");
  s.exit(0, "Checked out v2.13.0.\n");
  await until(() => reloaded === 1, "panel reload", 4000);
  if (!/host\.jsx/.test(evalFiles[0])) throw new Error("host not reloaded: " + evalFiles[0]);
  eq(storage.get("aem-updated"), "1", "restart note");
});

await t("a failed update shows the output and re-enables the button", async () => {
  els["update-btn"].click(); els["update-btn"].click();
  spawned[1].exit(1, "Local changes in host/x.jsx\n");
  if (!/Local changes in host\/x\.jsx[\s\S]*Update failed \(exit 1\)/.test(els["update-log"].textContent)) throw new Error(els["update-log"].textContent);
  eq([els["update-log"].className, els["update-btn"].disabled], ["bad", false], "error state");
});

await t("an ae-motion folder without scripts/update.ts is not updated", async () => {
  fs.rmSync(path.join(repo, "scripts", "update.ts"));
  els["update-btn"].click(); els["update-btn"].click();
  eq(spawned.length, 2, "nothing spawned");
  if (!/update by hand/.test(els["update-log"].textContent)) throw new Error(els["update-log"].textContent);
});

await t("closing the panel removes its own bridge file, not a newer panel's", () => {
  windowListeners.unload();
  eq(fs.existsSync(bridgeFile), false, "own file removed");
  fs.writeFileSync(bridgeFile, JSON.stringify({ port: 1, token: "another panel" }));
  windowListeners.unload();
  eq(fs.existsSync(bridgeFile), true, "other panel's file kept");
});

fs.rmSync(tmp, { recursive: true, force: true });
let failed = 0;
for (const [name, pass, msg] of results) { console.log((pass ? "PASS  " : "FAIL  ") + name + (msg ? "\n      " + msg : "")); if (!pass) failed++; }
process.exit(failed ? 1 : 0);
