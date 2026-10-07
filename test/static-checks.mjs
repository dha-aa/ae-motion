// Static checks: ES3-only syntax in host.jsx, and every bridged MCP tool has a matching host command.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, execFileSync } from "node:child_process";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "ae-motion-static-"));
const host = fs.readFileSync(`${ROOT}/panel/host/host.jsx`, "utf8");
let bad = 0;
const report = (ok, msg) => { console.log((ok ? "PASS  " : "FAIL  ") + msg); if (!ok) bad++; };

// 1. syntax parses
const checkFile = path.join(TMP, "host_check.js");
fs.writeFileSync(checkFile, host);
try { execFileSync("node", ["--check", checkFile]); report(true, "host.jsx parses"); } catch (e) { report(false, "host.jsx syntax: " + e.message); }

// 2. ES3 lint (ExtendScript has no ES5+ array/string helpers)
const banned = [
  [/=>/, "arrow function"], [/\blet\s/, "let"], [/\bconst\s/, "const"], [/`/, "template literal"],
  [/\.(forEach|map|filter|reduce|some|every)\(/, "ES5 array method"], [/Object\.keys|Array\.isArray|\.trim\(\)|\.includes\(|\.startsWith\(|\.endsWith\(|\.padStart\(|\.repeat\(/, "ES5+/ES6 helper"],
  [/\.\.\./, "spread"],
];
const lines = host.split("\n");
let lintHits = 0;
lines.forEach((ln, i) => { for (const [re, what] of banned) if (re.test(ln)) { console.log(`      line ${i + 1}: ${what}: ${ln.trim().slice(0, 100)}`); lintHits++; } });
report(lintHits === 0, `ES3 lint (${lintHits} hits)`);

// Array indexOf is missing in ExtendScript; show every use so string-only use can be confirmed by eye
const idx = lines.map((ln, i) => [i + 1, ln]).filter(([, ln]) => /\.indexOf\(/.test(ln));
console.log("      indexOf uses (must all be on strings):");
idx.forEach(([n, ln]) => console.log(`        ${n}: ${ln.trim().slice(0, 110)}`));

// 3. tool/command cross-check via a real tools/list
const srv = spawn("node", [path.join(ROOT, "dist", "index.js")], { stdio: ["pipe", "pipe", "pipe"] });
let out = "";
srv.stdout.on("data", (d) => (out += d));
const send = (o) => srv.stdin.write(JSON.stringify(o) + "\n");
send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "t", version: "0" } } });
send({ jsonrpc: "2.0", method: "notifications/initialized" });
send({ jsonrpc: "2.0", id: 2, method: "tools/list" });
await new Promise((r) => setTimeout(r, 1500));
srv.stdin.end();
const msgs = out.split("\n").filter(Boolean).map((l) => JSON.parse(l));
const tools = msgs.find((m) => m.id === 2).result.tools;
const names = tools.map((t) => t.name);
const EXPECTED_TOOLS = 51; // update when adding or removing a tool
report(names.length === EXPECTED_TOOLS, `tools/list returns ${names.length} tools (expected ${EXPECTED_TOOLS})`);
const cmds = new Set([...host.matchAll(/C\.(\w+) = function/g)].map((m) => m[1]));
const notBridged = new Set(["render_start", "render_status", "render_cancel"]);
const missing = names.filter((n) => !notBridged.has(n) && !cmds.has(n));
report(missing.length === 0, `every bridged tool has a host command${missing.length ? " (missing: " + missing.join(", ") + ")" : ""}`);
const extra = [...cmds].filter((c) => !names.includes(c) && !["get_selection", "prepare_render"].includes(c));
report(extra.length === 0, `no host commands without a tool${extra.length ? " (" + extra.join(", ") + ")" : ""}`);
const badSchema = tools.filter((t) => !t.inputSchema || t.inputSchema.type !== "object").map((t) => t.name);
report(badSchema.length === 0, "all tools have object input schemas");
console.log("      tools: " + names.join(", "));
fs.rmSync(TMP, { recursive: true, force: true });
process.exit(bad ? 1 : 0);
