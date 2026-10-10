// Runs the evaluations against a live After Effects through headless Claude Code (`claude -p`), so it uses the
// Claude Code login instead of an API key. Each question or task is a fresh session that sees only ae-motion's tools
// (no built-in tools, no other MCP servers), started from an empty directory so no project CLAUDE.md loads.
//
//   npm run build && node evals/run.ts [--no-build] [--model <alias>] [--only 1,4] [--jobs N]   questions (read-only)
//   npm run build && node evals/run.ts --build [--model <alias>] [--only 1,4]                   build tasks
//
// Questions (evals/evaluation.xml) get the read-only tools and are graded on the answer. Build tasks
// (evals/build-tasks.ts) get the tools that change the project too (not run_jsx, rendering, or opening, saving and
// importing files); the fixture is rebuilt before each, and the task's check reads the result through the tools.
// Needs After Effects with the ae-motion panel open. Building the fixture (evals/build-fixture.ts) replaces the open
// project: save your work first. Questions skip that with --no-build; build tasks always rebuild it.
import { spawn, execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { startClient } from "../scripts/mcp-client.ts";
import { TASKS } from "./build-tasks.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);
const opt = (name: string): string | undefined => { const i = argv.indexOf(name); return i < 0 ? undefined : argv[i + 1]; };
const MODEL = opt("--model");
const ONLY = opt("--only")?.split(",").map(Number);
const BUILD = argv.includes("--build");
const JOBS = BUILD ? 1 : Number(opt("--jobs") ?? 1); // questions only read, so they can run in parallel; the panel serialises AE calls
const TIMEOUT_MS = 10 * 60_000;

type Qa = { n: number; question: string; answer: string };
type Outcome = Qa & { got: string; pass: boolean; tool_calls: number; tools: Record<string, number>; denied: number; turns: number; seconds: number; cost_usd?: number; summary: string; error?: string };

const xml = fs.readFileSync(path.join(ROOT, "evals", "evaluation.xml"), "utf8");
const unescape = (s: string): string => s.trim().replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
const qas: Qa[] = (BUILD
  ? TASKS.map((t) => ({ n: t.n, question: t.task, answer: "(checked)" }))
  : [...xml.matchAll(/<qa_pair>\s*<question>([\s\S]*?)<\/question>\s*<answer>([\s\S]*?)<\/answer>\s*<\/qa_pair>/g)]
    .map((m, i) => ({ n: i + 1, question: unescape(m[1]), answer: unescape(m[2]) })))
  .filter((q) => !ONLY || ONLY.includes(q.n));

const server = path.join(ROOT, "dist", "index.js");
if (!fs.existsSync(server)) { console.error("dist/index.js missing: run `npm run build` first"); process.exit(1); }
const driver = (...args: string[]): string => execFileSync(process.execPath, [path.join(ROOT, ".claude", "skills", "run-ae-motion", "driver.ts"), ...args], { cwd: ROOT, encoding: "utf8" });

// After Effects must be reachable; rebuild the fixture unless told not to (build tasks rebuild it before each task)
try { if (!/"panel": "up"/.test(driver("status"))) throw new Error("panel not up"); } catch { console.error("After Effects panel not reachable: open After Effects and the ae-motion panel"); process.exit(1); }
function buildFixture(): void {
  execFileSync(process.execPath, [path.join(ROOT, "evals", "build-fixture.ts")], { stdio: "ignore" });
  try { driver("script", path.join("evals", "fixture.jsonl")); } catch (e) { console.error("fixture build failed:\n" + String((e as { stdout?: string }).stdout ?? e).slice(-2000)); process.exit(1); }
  finally { fs.rmSync(path.join(ROOT, "evals", "fixture.jsonl.results.json"), { force: true }); }
}
if (!BUILD && !argv.includes("--no-build")) { buildFixture(); console.log("fixture built in After Effects"); }

// the tools each mode may use, from the server's own annotations
const client = await startClient();
const tools = await client.tools();
const NEVER = new Set(["check_for_updates", "run_jsx", "open_project", "save_project", "import_footage", "apply_preset", "render_start", "render_status", "render_cancel", "load_tools", "add_sfx", "delete_item"]);
const allowed = tools.filter((t) => !NEVER.has(t.name) && (BUILD || t.annotations?.readOnlyHint === true)).map((t) => `mcp__ae-motion__${t.name}`);

const work = fs.mkdtempSync(path.join(os.tmpdir(), "ae-motion-eval-"));
const mcpConfig = path.join(work, "mcp.json");
fs.writeFileSync(mcpConfig, JSON.stringify({ mcpServers: { "ae-motion": { command: process.execPath, args: [server], env: { AE_MCP_UPDATE_CHECK: "0" } } } }));

const PROMPT = (q: string): string => BUILD
  ? `You are working in the Adobe After Effects project that is open right now, using only the ae-motion tools.

Task: ${q}

Find what you need with the tools, make the change, and check it. Then reply with a short <summary> of what you did (which tools, any difficulties, anything about the tools that made it harder) and <response>done</response>.`
  : `You are answering a question about the Adobe After Effects project that is open right now, using only the ae-motion tools. Do not change the project.

Question: ${q}

Explore with the tools until you are sure. Then reply with a short <summary> of how you found the answer (which tools, any difficulties, anything about the tools that made it harder), followed by the bare answer in <response></response> tags.`;

const norm = (s: string): string => s.trim().toLowerCase().replace(/\s+/g, " ").replace(/[.]$/, "").replace(/^(\d+(?:\.\d+)?)\s*(s|sec|seconds?|px|°|degrees?)$/, "$1");

function ask(qa: Qa): Promise<Outcome> {
  const args = ["-p", PROMPT(qa.question), "--output-format", "stream-json", "--verbose", "--tools", "", "--strict-mcp-config", "--mcp-config", mcpConfig,
    "--allowedTools", allowed.join(","), "--disable-slash-commands", "--no-session-persistence", ...(MODEL ? ["--model", MODEL] : [])];
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

/** Build tasks: the task's check reads the project; `got` lists what is wrong ("ok" when nothing is). */
async function grade(r: Outcome): Promise<void> {
  const task = TASKS.find((t) => t.n === r.n)!;
  const call = async (tool: string, args: Record<string, unknown> = {}): Promise<any> => {
    const x = await client.call(tool, args);
    if (x.isError) throw new Error(`${tool}: ${JSON.stringify(x.value)}`);
    return x.value;
  };
  let bad: string[];
  try { bad = await task.check(call); } catch (e) { bad = ["check failed: " + (e instanceof Error ? e.message : String(e))]; }
  r.pass = bad.length === 0;
  r.got = bad.length ? bad.join("; ") : "ok";
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
    if (BUILD) buildFixture();
    const r = await ask(qa);
    if (BUILD && !r.error) await grade(r);
    if (!r.pass && r.error && LIMIT.test(r.error)) { stopped ||= r.error; notRun.push(qa.n); continue; }
    results.push(r);
    const what = BUILD ? (r.pass ? "" : `  ${r.got}`) : `  expected ${JSON.stringify(r.answer)}, got ${JSON.stringify(r.got)}`;
    console.log(`${r.pass ? "PASS" : "FAIL"}  ${BUILD ? "B" : "Q"}${r.n}${what}  (${r.tool_calls} tool calls, ${r.seconds} s)${r.error ? "\n      " + r.error : ""}`);
  }
}));
results.sort((a, b) => a.n - b.n);
notRun.sort((a, b) => a - b);
if (stopped) console.log(`\nStopped: ${stopped}\nNot run: Q${notRun.join(", Q")} (run them later with --no-build --only ${notRun.join(",")})`);

const passed = results.filter((r) => r.pass).length;
const calls = results.reduce((s, r) => s + r.tool_calls, 0);
const cost = results.reduce((s, r) => s + (r.cost_usd ?? 0), 0);
console.log(`\n${passed}/${results.length} ${BUILD ? "tasks done right" : "correct"} · ${calls} tool calls (${(calls / Math.max(1, results.length)).toFixed(1)} per ${BUILD ? "task" : "question"}) · ${results.filter((r) => r.denied).length} ${BUILD ? "tasks" : "questions"} tried a tool they don't have` + (cost ? ` · API-equivalent cost $${cost.toFixed(2)}` : ""));

const dir = path.join(ROOT, "evals", "results");
fs.mkdirSync(dir, { recursive: true });
const file = path.join(dir, new Date().toISOString().replace(/[:.]/g, "-") + ".json");
fs.writeFileSync(file, JSON.stringify({ mode: BUILD ? "build" : "questions", model: MODEL ?? "default", passed, total: results.length, not_run: notRun, results }, null, 2));
console.log(`details (each answer's summary of how it got there): ${path.relative(ROOT, file)}`);
fs.rmSync(work, { recursive: true, force: true });
client.close();
process.exit(passed === results.length && !notRun.length ? 0 : 1);
