/**
 * batch: run several bridged tools in one call. Every tool call is a model round trip that re-reads the whole
 * conversation, so building a scene in 2 calls instead of 30 is the largest token saving there is. Each step goes
 * through the same validation, path sandbox and host command as calling the tool directly; a string "$N.path"
 * (N = 1-based step, path = dot-separated keys and array indexes) is replaced by that value from step N's result
 * first, so a step can use an id an earlier step created. Server only: no host command of its own.
 */
import { z } from "zod";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { AeToolError, type ErrorCode } from "../errors.js";
import { assertAllowed, toAe } from "../sandbox.js";
import { json, type ToolRegistry } from "./registry.js";

const MAX_STEPS = 50;
const REF = /^\$(\d+)((?:\.[\w-]+)*)$/;
// switching projects mid-batch would leave the later steps acting on another project
const NOT_IN_BATCH = new Set(["open_project"]);

/** Replace "$N.path" strings anywhere in v with values from earlier results. */
export function resolveRefs(v: unknown, results: unknown[], step: number): unknown {
  if (typeof v === "string") {
    const m = REF.exec(v);
    if (!m) return v;
    const n = Number(m[1]);
    if (n < 1 || n >= step) throw new AeToolError("BAD_ARGS", `Step ${step}: "${v}" refers to step ${n}, which has not run yet`, "Refer only to earlier steps ($1 is the first)");
    let cur: unknown = results[n - 1];
    for (const k of m[2].split(".").slice(1)) {
      cur = cur !== null && typeof cur === "object" ? (cur as Record<string, unknown>)[k] : undefined;
      if (cur === undefined) throw new AeToolError("BAD_ARGS", `Step ${step}: "${v}" not found in step ${n}'s result`, `Step ${n} returned ${JSON.stringify(results[n - 1]).slice(0, 300)}`);
    }
    return cur;
  }
  if (Array.isArray(v)) return v.map((x) => resolveRefs(x, results, step));
  if (v !== null && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, resolveRefs(x, results, step)]));
  return v;
}

type Path = (string | number)[];

/** Where "$N.path" strings sit in v, as key paths. */
function refPaths(v: unknown, at: Path = [], out: Path[] = []): Path[] {
  if (typeof v === "string" && REF.test(v)) out.push(at);
  else if (Array.isArray(v)) v.forEach((x, i) => refPaths(x, [...at, i], out));
  else if (v !== null && typeof v === "object") for (const [k, x] of Object.entries(v)) refPaths(x, [...at, k], out);
  return out;
}

const startsWith = (p: Path, prefix: Path): boolean => prefix.length <= p.length && prefix.every((k, i) => p[i] === k);

/**
 * Check every step before any runs: tool known and allowed, references only to earlier steps, arguments valid. A
 * reference's value is unknown until its step runs, so type errors at (or inside a union around) a reference are not
 * counted; unknown keys, missing fields and every other value are.
 */
export function precheck(steps: { tool: string; args: Record<string, unknown> }[], tools: ToolRegistry["bridgedTools"]): { step: number; tool: string; message: string }[] {
  const problems: { step: number; tool: string; message: string }[] = [];
  steps.forEach(({ tool, args }, i) => {
    const step = i + 1, spec = tools.get(tool), add = (message: string) => problems.push({ step, tool, message });
    if (!spec) return add("unknown or unavailable tool (if its group is not loaded, call load_tools first)");
    if (NOT_IN_BATCH.has(tool)) return add("not allowed in batch: call it directly");
    const refs = refPaths(args);
    for (const p of refs) {
      const n = Number(REF.exec(String(p.reduce<unknown>((o, k) => (o as Record<string | number, unknown>)[k], args)))![1]);
      if (n < 1 || n >= step) add(`${p.join(".")} refers to step ${n}, which has not run yet`);
    }
    const parsed = spec.schema.safeParse(args);
    if (parsed.success) return;
    for (const x of parsed.error.issues) {
      if (refs.some((rp) => startsWith(x.path, rp) || (x.code === "invalid_union" && startsWith(rp, x.path)))) continue;
      add(`${x.path.join(".") || "args"}: ${x.message}`);
    }
  });
  return problems;
}

export function registerBatchTool(r: ToolRegistry): void {
  r.tool(
    "batch",
    'Run up to 50 tool calls in order in one call (saves round trips: prefer it for multi-step builds). A string "$N.path" in args is replaced by that value from step N\'s result, e.g. "$1.id" or "$2.layers.0.id". All steps are checked before any runs (a bad argument anywhere means nothing runs); a step that fails in After Effects stops the batch and returns the results so far. Each step is its own undo step. Not for preview_frame, render_*, run_jsx or open_project.',
    {
      steps: z.array(z.object({ tool: z.string(), args: z.record(z.unknown()).default({}) })).min(1).max(MAX_STEPS),
      results: z.enum(["all", "last", "none"]).default("all").describe("Which results to return (default all; none returns only the step count)"),
    },
    async (a) => {
      const problems = precheck(a.steps, r.bridgedTools);
      if (problems.length) {
        return json({ error: { code: "BAD_ARGS", message: `${problems.length} problem(s) found; nothing ran`, hint: "Fix every listed step and send the batch again" }, steps: 0, problems }, true);
      }
      const results: unknown[] = [];
      const out = (): unknown => (a.results === "all" ? results : a.results === "last" ? results.slice(-1) : undefined);
      for (let i = 0; i < a.steps.length; i++) {
        const step = i + 1, { tool, args } = a.steps[i];
        const spec = r.bridgedTools.get(tool);
        // the error, plus how far the batch got (earlier steps are not undone)
        const fail = (code: ErrorCode, message: string, hint: string): CallToolResult =>
          json({ error: { code, message: `Step ${step} (${tool}): ${message}`, hint }, steps: i, ...(i && a.results !== "none" ? { results: out() } : {}) }, true);
        if (!spec || NOT_IN_BATCH.has(tool)) return fail("BAD_ARGS", spec ? "not allowed in batch" : "unknown or unavailable tool", spec ? "Use the tool directly, outside batch" : "Check the name; if its group is not loaded, call load_tools first");
        let resolved: unknown;
        try {
          resolved = resolveRefs(args, results, step);
        } catch (e) {
          const err = e as AeToolError;
          return fail(err.code ?? "BAD_ARGS", err.message, err.hint ?? "Check the reference");
        }
        const parsed = spec.schema.safeParse(resolved);
        if (!parsed.success) return fail("BAD_ARGS", parsed.error.issues.map((x) => `${x.path.join(".") || "args"}: ${x.message}`).join("; "), "Fix the arguments");
        const sent: Record<string, unknown> = { ...(parsed.data as Record<string, unknown>) };
        try {
          for (const k of spec.paths) if (typeof sent[k] === "string") sent[k] = toAe(assertAllowed(sent[k] as string));
        } catch (e) {
          const err = e as AeToolError;
          return fail(err.code ?? "FORBIDDEN", err.message, err.hint ?? "Use a path inside the allowed folders");
        }
        const res = await r.deps.bridge.run(tool, sent);
        if (!res.ok) return fail(res.error.code, res.error.message, res.error.hint ?? "Fix this step and run the rest again");
        results.push(res.result);
      }
      return json(a.results === "none" ? { steps: results.length } : { steps: results.length, results: out() });
    },
    { tooLargeHint: 'Pass results: "last" or "none", or split the batch' },
  );
}
