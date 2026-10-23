// scripts/check.ts (run by the installers, and with --ae at the end of INSTALL.md) must say which part is missing:
// the server, After Effects' scripting setting (read from a fake prefs file in a throwaway HOME) or the panel (a fake
// bridge). Needs the built server (npm run build).
import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";
import { aePrefsFile, scriptingAllowed } from "../scripts/check.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPT = path.join(ROOT, "scripts", "check.ts");
const results: [name: string, pass: boolean, msg?: string][] = [];
const errText = (e: unknown): string => (e instanceof Error ? e.message : String(e));
const t = async (name: string, fn: () => void | Promise<void>): Promise<void> => { try { await fn(); results.push([name, true]); } catch (e) { results.push([name, false, errText(e)]); } };
const eq = (a: unknown, b: unknown, what: string): void => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${what}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); };

const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "ae-motion-check-")));
// After Effects writes its prefs as one long line with CR separators and tabs
const prefsText = (v: string): string => `# Text File Version 1.1\r["Main Pref Section v2"]\r\t"Pref_SCRIPTING_FILE_NETWORK_SECURITY" = "${v}"\r`;
const writePrefs = (base: string, version: string, v: string): void => {
  fs.mkdirSync(path.join(base, version), { recursive: true });
  fs.writeFileSync(path.join(base, version, `Adobe After Effects ${version} Prefs.txt`), prefsText(v));
};

await t("scriptingAllowed reads the setting from a prefs file", () => {
  eq(scriptingAllowed(prefsText("1")), true, "on");
  eq(scriptingAllowed(prefsText("0")), false, "off");
  eq(scriptingAllowed('["Main Pref Section v2"]\r'), null, "not listed");
});

await t("aePrefsFile picks the newest version that has a prefs file", () => {
  const home = path.join(tmp, "home-pick"), base = path.join(home, "Library", "Preferences", "Adobe", "After Effects");
  eq(aePrefsFile("darwin", home), null, "no After Effects folder");
  writePrefs(base, "26.5", "1");
  writePrefs(base, "26.10", "0");
  fs.mkdirSync(path.join(base, "27.0")); // a newer version that was never started: no prefs yet
  eq(aePrefsFile("darwin", home), path.join(base, "26.10", "Adobe After Effects 26.10 Prefs.txt"), "26.10 > 26.5, 27.0 skipped");
  const appData = path.join(tmp, "appdata");
  writePrefs(path.join(appData, "Adobe", "After Effects"), "25.0", "1");
  eq(aePrefsFile("win32", home, appData), path.join(appData, "Adobe", "After Effects", "25.0", "Adobe After Effects 25.0 Prefs.txt"), "Windows uses APPDATA");
  eq(aePrefsFile("linux", home), null, "no After Effects on Linux");
});

// a home whose newest After Effects has the setting `v`, for the script runs below
const home = (name: string, v: string): string => {
  const h = path.join(tmp, name);
  writePrefs(path.join(h, "Library", "Preferences", "Adobe", "After Effects"), "26.5", v);
  writePrefs(path.join(h, "AppData", "Adobe", "After Effects"), "26.5", v);
  return h;
};
const run = (args: string[], env: Record<string, string>): Promise<{ status: number | null; out: string }> => new Promise((resolve) => {
  const p = spawn(process.execPath, [SCRIPT, ...args], { env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"] });
  let out = "";
  p.stdout.on("data", (d) => { out += d; });
  p.stderr.on("data", (d) => { out += d; });
  p.on("close", (status) => resolve({ status, out }));
});
const envFor = (h: string, bridge: string): Record<string, string> => ({ HOME: h, USERPROFILE: h, APPDATA: path.join(h, "AppData"), AE_MCP_BRIDGE_FILE: bridge });

await t("without --ae: checks only that the server starts", async () => {
  const r = await run([], envFor(home("home-plain", "0"), path.join(tmp, "missing.json")));
  eq(r.status, 0, "exit code\n" + r.out);
  if (!/^Server: starts and lists \d+ tools \(v\d+\.\d+\.\d+\)\.$/m.test(r.out)) throw new Error(r.out);
  if (/After Effects setting|Panel:/.test(r.out)) throw new Error("checked After Effects without --ae:\n" + r.out);
});

// After Effects (and its prefs folder) exists on macOS and Windows only
const aeOs = process.platform === "darwin" || process.platform === "win32";
if (aeOs) await t("--ae names the setting that is off and the panel that is not open", async () => {
  const r = await run(["--ae"], envFor(home("home-off", "0"), path.join(tmp, "missing.json")));
  eq(r.status, 1, "exit code\n" + r.out);
  if (!/Allow Scripts to Write Files and Access Network is off/.test(r.out)) throw new Error("setting:\n" + r.out);
  if (!/Panel: not reachable \(Bridge file not found\)\. In After Effects open Window > Extensions > AE Motion MCP/.test(r.out)) throw new Error("panel:\n" + r.out);
});

if (aeOs) await t("--ae passes with the setting on and the panel answering", async () => {
  const bridge = http.createServer((req, res) => {
    let body = "";
    req.on("data", (d) => { body += d; });
    req.on("end", () => {
      const { cmd } = JSON.parse(body || "{}");
      res.setHeader("content-type", "application/json");
      if (req.headers["x-ae-token"] !== "tok" || cmd !== "get_project") { res.statusCode = 400; return res.end("{}"); }
      res.end(JSON.stringify({ ok: true, result: { ae_version: "26.5x12", project_path: "/p/show.aep", items: [] } }));
    });
  });
  await new Promise<void>((r) => bridge.listen(0, "127.0.0.1", r));
  const file = path.join(tmp, "bridge.json");
  fs.writeFileSync(file, JSON.stringify({ port: (bridge.address() as AddressInfo).port, token: "tok" }));
  try {
    const r = await run(["--ae"], envFor(home("home-on", "1"), file));
    eq(r.status, 0, "exit code\n" + r.out);
    if (!/Allow Scripts to Write Files and Access Network is on/.test(r.out)) throw new Error("setting:\n" + r.out);
    if (!/Panel: connected to After Effects 26\.5x12, project \/p\/show\.aep\./.test(r.out)) throw new Error("panel:\n" + r.out);
  } finally { bridge.close(); }
});

if (!aeOs) results.push(["no After Effects on " + process.platform + ": --ae tests skipped", true]);
fs.rmSync(tmp, { recursive: true, force: true });
let failed = 0;
for (const [name, pass, msg] of results) { console.log((pass ? "PASS  " : "FAIL  ") + name + (msg ? "\n      " + msg : "")); if (!pass) failed++; }
process.exit(failed ? 1 : 0);
