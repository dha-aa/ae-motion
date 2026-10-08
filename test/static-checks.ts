// Static checks (run after `npm run build`):
//  1. panel/host/host.jsx is up to date with host/ and parses.
//  2. host/ sources use only ES3 syntax (ExtendScript has no ES5+ syntax or array/string helpers).
//  3. The server's tools/list matches the host commands: every bridged tool has a C.<name> and vice versa.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, execFileSync } from "node:child_process";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { buildHost, emittedPath, HOST_OUT, HOST_SOURCES } from "../scripts/build-host.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");


const EXPECTED_TOOLS = 67; // update when adding or removing a tool
// Tool definitions are sent to the model on every request, so their size is a cost. Raise this only on purpose
// (measured at about 60k chars for 66 tools).
const TOOLS_LIST_BUDGET = 63_000;
const SERVER_ONLY_TOOLS = new Set(["render_start", "render_status", "render_cancel", "check_for_updates", "batch", "load_tools"]); // implemented in TypeScript, no host command
const HOST_ONLY_COMMANDS = new Set(["get_selection", "prepare_render"]); // used by a resource / render_start, not tools

let bad = 0;
const report = (ok: boolean, msg: string): void => { console.log((ok ? "PASS  " : "FAIL  ") + msg); if (!ok) bad++; };

// 1. built file is current and parses
const host = fs.readFileSync(HOST_OUT, "utf8");
report(host === buildHost(), "panel/host/host.jsx is up to date with host/ (run `npm run build`)");
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "ae-motion-static-"));
const checkFile = path.join(TMP, "host_check.js");
fs.writeFileSync(checkFile, host);
try { execFileSync(process.execPath, ["--check", checkFile]); report(true, "host.jsx parses"); } catch (e) { report(false, "host.jsx syntax: " + (e instanceof Error ? e.message : String(e))); }
fs.rmSync(TMP, { recursive: true, force: true });

// 1b. one version everywhere: package.json, the panel manifest and the host stamp
const pkgVersion: string = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8")).version;
const manifest = fs.readFileSync(path.join(ROOT, "panel", "CSXS", "manifest.xml"), "utf8");
const manifestVersions = [...manifest.matchAll(/(?:ExtensionBundleVersion|Extension Id="[^"]+" Version)="([^"]+)"/g)].map((m) => m[1]);
report(manifestVersions.length === 2 && manifestVersions.every((v) => v === pkgVersion), `panel manifest versions match package.json ${pkgVersion} (found ${manifestVersions.join(", ")})`);
report(host.includes(`version: ${JSON.stringify(pkgVersion)}`), `host.jsx is stamped with version ${pkgVersion}`);

// 2. ES3 lint, per emitted file (host/*.jsx as written, host/*.ts as compiled by tsc into build/host/)
const banned: [RegExp, string][] = [
  [/=>/, "arrow function"], [/\blet\s/, "let"], [/\bconst\s/, "const"], [/`/, "template literal"],
  [/\.(forEach|map|filter|reduce|some|every)\(/, "ES5 array method"],
  [/Object\.keys|Array\.isArray|\.trim\(\)|\.includes\(|\.startsWith\(|\.endsWith\(|\.padStart\(|\.repeat\(/, "ES5+/ES6 helper"],
  [/\.\.\./, "spread"], [/[\u2028\u2029]/, "raw line/paragraph separator (use \\u2028 / \\u2029)"],
];
let lintHits = 0;
const indexOfUses: string[] = [];
for (const rel of HOST_SOURCES) {
  const file = path.relative(ROOT, emittedPath(rel));
  fs.readFileSync(emittedPath(rel), "utf8").split("\n").forEach((ln, i) => {
    for (const [re, what] of banned) if (re.test(ln)) { console.log(`      ${file}:${i + 1}: ${what}: ${ln.trim().slice(0, 100)}`); lintHits++; }
    if (/\.indexOf\(/.test(ln)) indexOfUses.push(`${file}:${i + 1}: ${ln.trim().slice(0, 100)}`);
  });
}
report(lintHits === 0, `ES3 lint (${lintHits} hits)`);
// Array.prototype.indexOf is missing in ExtendScript; list every use so string-only use can be confirmed by eye.
console.log("      indexOf uses (must all be on strings):");
for (const u of indexOfUses) console.log("        " + u);

// 3. tool/command cross-check via a real tools/list
const srv = spawn(process.execPath, [path.join(ROOT, "dist", "index.js")], { stdio: ["pipe", "pipe", "pipe"], env: { ...process.env, AE_MCP_UPDATE_CHECK: "0" } });
let out = "";
srv.stdout.on("data", (d) => (out += d));
const send = (o: object): boolean => srv.stdin.write(JSON.stringify(o) + "\n");
send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "t", version: "0" } } });
send({ jsonrpc: "2.0", method: "notifications/initialized" });
send({ jsonrpc: "2.0", id: 2, method: "tools/list" });
await new Promise((r) => setTimeout(r, 1500));
srv.stdin.end();
const msgs = out.split("\n").filter(Boolean).map((l) => JSON.parse(l));
const tools: Tool[] = msgs.find((m: { id?: number }) => m.id === 2).result.tools;
const instructions: string = msgs.find((m: { id?: number }) => m.id === 1).result.instructions ?? "";
report(/run_jsx is a last resort/.test(instructions), "server instructions tell clients run_jsx is a last resort");
report(/^LAST RESORT/.test(tools.find((t) => t.name === "run_jsx")?.description ?? ""), "run_jsx's description starts with LAST RESORT");
const names = tools.map((t) => t.name);
report(names.length === EXPECTED_TOOLS, `tools/list returns ${names.length} tools (expected ${EXPECTED_TOOLS})`);
const cmds = new Set([...host.matchAll(/C\.(\w+) = function/g)].map((m) => m[1]));
const missing = names.filter((n) => !SERVER_ONLY_TOOLS.has(n) && !cmds.has(n));
report(missing.length === 0, `every bridged tool has a host command${missing.length ? " (missing: " + missing.join(", ") + ")" : ""}`);
const extra = [...cmds].filter((c) => !names.includes(c) && !HOST_ONLY_COMMANDS.has(c));
report(extra.length === 0, `no host commands without a tool${extra.length ? " (" + extra.join(", ") + ")" : ""}`);
const badSchema = tools.filter((t) => !t.inputSchema || t.inputSchema.type !== "object").map((t) => t.name);
report(badSchema.length === 0, "all tools have object input schemas");
const ANNOTATIONS: string[] = ["readOnlyHint", "destructiveHint", "idempotentHint", "openWorldHint"];
const unannotated = tools.filter((t) => !t.title || !t.annotations || ANNOTATIONS.some((k) => typeof (t.annotations as Record<string, unknown>)[k] !== "boolean")).map((t) => t.name);
report(unannotated.length === 0, `every tool has a title and all four annotations${unannotated.length ? " (" + unannotated.join(", ") + ")" : ""}`);
const loose = tools.filter((t) => t.inputSchema.additionalProperties !== false).map((t) => t.name);
report(loose.length === 0, `every input schema rejects unknown keys${loose.length ? " (" + loose.join(", ") + ")" : ""}`);
const listSize = JSON.stringify(tools).length;
report(listSize <= TOOLS_LIST_BUDGET, `tools/list is ${listSize} chars, within the ${TOOLS_LIST_BUDGET} budget`);
const withDialect = tools.filter((t) => "$schema" in t.inputSchema).map((t) => t.name);
report(withDialect.length === 0, `no input schema carries a $schema header${withDialect.length ? " (" + withDialect.join(", ") + ")" : ""}`);
console.log("      tools: " + names.join(", "));
process.exit(bad ? 1 : 0);
