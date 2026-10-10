// Runs evals/evaluation.xml against a live After Effects through headless Claude Code (`claude -p`), so it uses the
// Claude Code login instead of an API key. Each question is a fresh session that sees only ae-motion's read-only
// tools (no built-in tools, no other MCP servers), started from an empty directory so no project CLAUDE.md loads.
//
//   npm run build && node evals/run.ts [--no-build] [--model <alias>] [--only 1,4] [--jobs N]
//
// Needs After Effects with the ae-motion panel open. Without --no-build it first rebuilds the fixture project
// (evals/build-fixture.ts), which replaces the open project: save your work first.
import { spawn, execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);
const opt = (name: string): string | undefined => { const i = argv.indexOf(name); return i < 0 ? undefined : argv[i + 1]; };
const MODEL = opt("--model");
const ONLY = opt("--only")?.split(",").map(Number);
const JOBS = Number(opt("--jobs") ?? 1); // questions only read, so they can run in parallel; the panel serialises AE calls
const TIMEOUT_MS = 10 * 60_000;

type Qa = { n: number; question: string; answer: string };
type Outcome = Qa & { got: string; pass: boolean; tool_calls: number; tools: Record<string, number>; denied: number; turns: number; seconds: number; cost_usd?: number; summary: string; error?: string };

const xml = fs.readFileSync(path.join(ROOT, "evals", "evaluation.xml"), "utf8");
const unescape = (s: string): string => s.trim().replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
const qas: Qa[] = [...xml.matchAll(/<qa_pair>\s*<question>([\s\S]*?)<\/question>\s*<answer>([\s\S]*?)<\/answer>\s*<\/qa_pair>/g)]
  .map((m, i) => ({ n: i + 1, question: unescape(m[1]), answer: unescape(m[2]) }))
  .filter((q) => !ONLY || ONLY.includes(q.n));

const server = path.join(ROOT, "dist", "index.js");
if (!fs.existsSync(server)) { console.error("dist/index.js missing: run `npm run build` first"); process.exit(1); }
const driver = (...args: string[]): string => execFileSync(process.execPath, [path.join(ROOT, ".claude", "skills", "run-ae-motion", "driver.ts"), ...args], { cwd: ROOT, encoding: "utf8" });

// After Effects must be reachable; rebuild the fixture unless told not to
try { if (!/"panel": "up"/.test(driver("status"))) throw new Error("panel not up"); } catch { console.error("After Effects panel not reachable: open After Effects and the ae-motion panel"); process.exit(1); }
if (!argv.includes("--no-build")) {
  execFileSync(process.execPath, [path.join(ROOT, "evals", "build-fixture.ts")], { stdio: "inherit" });
  try { driver("script", path.join("evals", "fixture.jsonl")); } catch (e) { console.error("fixture build failed:\n" + String((e as { stdout?: string }).stdout ?? e).slice(-2000)); process.exit(1); }
  finally { fs.rmSync(path.join(ROOT, "evals", "fixture.jsonl.results.json"), { force: true }); }
  console.log("fixture built in After Effects");
}

// the read-only tools, from the server's own annotations
const tools = await listTools();
const readOnly = tools.filter((t) => t.annotations?.readOnlyHint === true && t.name !== "check_for_updates").map((t) => `mcp__ae-motion__${t.name}`);

async function listTools(): Promise<{ name: string; annotations?: { readOnlyHint?: boolean } }[]> {
  const srv = spawn(process.execPath, [server], { stdio: ["pipe", "pipe", "ignore"], env: { ...process.env, AE_MCP_UPDATE_CHECK: "0" } });
  let buf = "";
  const reply = new Promise<any>((resolve) => srv.stdout.on("data", (d) => {
    buf += d;
    for (const line of buf.split("\n")) { try { const m = JSON.parse(line); if (m.id === 2) resolve(m.result.tools); } catch { /* partial line */ } }
  }));
  const send = (o: object): boolean => srv.stdin.write(JSON.stringify(o) + "\n");
  send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "eval", version: "0" } } });
  send({ jsonrpc: "2.0", method: "notifications/initialized" });
  send({ jsonrpc: "2.0", id: 2, method: "tools/list" });
  const list = await reply;
  srv.kill();
  return list;
}

const work = fs.mkdtempSync(path.join(os.tmpdir(), "ae-motion-eval-"));
const mcpConfig = path.join(work, "mcp.json");
fs.writeFileSync(mcpConfig, JSON.stringify({ mcpServers: { "ae-motion": { command: process.execPath, args: [server], env: { AE_MCP_UPDATE_CHECK: "0" } } } }));

const PROMPT = (q: string): string => `You are answering a question about the Adobe After Effects project that is open right now, using only the ae-motion tools. Do not change the project.

Question: ${q}

Explore with the tools until you are sure. Then reply with a short <summary> of how you found the answer (which tools, any difficulties, anything about the tools that made it harder), followed by the bare answer in <response></response> tags.`;

const norm = (s: string): string => s.trim().toLowerCase().replace(/\s+/g, " ").replace(/[.]$/, "").replace(/^(\d+(?:\.\d+)?)\s*(s|sec|seconds?|px|°|degrees?)$/, "$1");

function ask(qa: Qa): Promise<Outcome> {
  const args = ["-p", PROMPT(qa.question), "--output-format", "stream-json", "--verbose", "--tools", "", "--strict-mcp-config", "--mcp-config", mcpConfig,
    "--allowedTools", readOnly.join(","), "--disable-slash-commands", "--no-session-persistence", ...(MODEL ? ["--model", MODEL] : [])];
  const started = Date.now();
  return new Promise((resolve) => {
    const child = spawn("claude", args, { cwd: work, stdio: ["ignore", "pipe", "pipe"] });
    let out = "", err = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    const timer = setTimeout(() => child.kill(), TIMEOUT_MS);
    child.on("close", (code) => {
      clearTimeout(timer);
      const used: Record<string, number> = {};
      let calls = 0, denied = 0, final = "", turns = 0, cost: number | undefined;
      for (const line of out.split("\n")) {
        let ev: any;
        try { ev = JSON.parse(line); } catch { continue; }
        if (ev.type === "assistant") for (const b of ev.message?.content ?? []) if (b.type === "tool_use") { calls++; const n = String(b.name).replace("mcp__ae-motion__", ""); used[n] = (used[n] ?? 0) + 1; }
        if (ev.type === "result") { final = ev.result ?? ""; turns = ev.num_turns ?? 0; cost = ev.total_cost_usd; denied = ev.permission_denials?.length ?? 0; }
      }
      const got = /<response>([\s\S]*?)<\/response>/.exec(final)?.[1]?.trim() ?? "";
      const summary = /<summary>([\s\S]*?)<\/summary>/.exec(final)?.[1]?.trim() ?? "";
      resolve({ ...qa, got, pass: got !== "" && norm(got) === norm(qa.answer), tool_calls: calls, tools: used, denied, turns, seconds: Math.round((Date.now() - started) / 1000), cost_usd: cost, summary,
        error: code === 0 && final ? undefined : `claude exited ${code}: ${err.trim().slice(-500) || final.slice(-500)}` });
    });
  });
}

// a usage limit or login problem is not a wrong answer: stop, and report those questions as not run
const LIMIT = /session limit|usage limit|rate limit|hit your .*limit|not logged in|please run \/login/i;
const results: Outcome[] = [];
const notRun: number[] = [];
let stopped = "";
const queue = [...qas];
await Promise.all(Array.from({ length: Math.max(1, JOBS) }, async () => {
  for (let qa = queue.shift(); qa; qa = queue.shift()) {
    if (stopped) { notRun.push(qa.n); continue; }
    const r = await ask(qa);
    if (!r.pass && r.error && LIMIT.test(r.error)) { stopped ||= r.error; notRun.push(qa.n); continue; }
    results.push(r);
    console.log(`${r.pass ? "PASS" : "FAIL"}  Q${r.n}  expected ${JSON.stringify(r.answer)}, got ${JSON.stringify(r.got)}  (${r.tool_calls} tool calls, ${r.seconds} s)${r.error ? "\n      " + r.error : ""}`);
  }
}));
results.sort((a, b) => a.n - b.n);
notRun.sort((a, b) => a - b);
if (stopped) console.log(`\nStopped: ${stopped}\nNot run: Q${notRun.join(", Q")} (run them later with --no-build --only ${notRun.join(",")})`);

const passed = results.filter((r) => r.pass).length;
const calls = results.reduce((s, r) => s + r.tool_calls, 0);
const cost = results.reduce((s, r) => s + (r.cost_usd ?? 0), 0);
console.log(`\n${passed}/${results.length} correct · ${calls} tool calls (${(calls / Math.max(1, results.length)).toFixed(1)} per question) · ${results.filter((r) => r.denied).length} questions tried a non-read-only tool` + (cost ? ` · API-equivalent cost $${cost.toFixed(2)}` : ""));

const dir = path.join(ROOT, "evals", "results");
fs.mkdirSync(dir, { recursive: true });
const file = path.join(dir, new Date().toISOString().replace(/[:.]/g, "-") + ".json");
fs.writeFileSync(file, JSON.stringify({ model: MODEL ?? "default", passed, total: results.length, not_run: notRun, results }, null, 2));
console.log(`details (each answer's summary of how it got there): ${path.relative(ROOT, file)}`);
fs.rmSync(work, { recursive: true, force: true });
process.exit(passed === results.length && !notRun.length ? 0 : 1);
