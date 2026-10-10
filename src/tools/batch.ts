/**
 * batch: run several tools in one call. Every tool call is a model round trip that re-reads the whole
 * conversation, so building a scene in 2 calls instead of 30 is the largest token saving there is. Each step goes
 * through the same validation, path sandbox and host command (or server handler, for get_project, render_status
 * and the like) as calling the tool directly; a string "$N.path" (N = 1-based step, path = dot-separated keys and
 * array indexes) is replaced by that value from step N's result first, so a step can use an id an earlier step
 * created. "$$" escapes a literal dollar ("$$99" is the text "$99"), so prices and the like can be passed.
 *
 * Models do not always send the shape the schema asks for, so the steps are normalised first: JSON strings for
 * steps or args, name / arguments / params for tool / args, and client-prefixed tool names (mcp__ae-motion__x).
 * A result too big to return is shortened instead of turned into an error, because by then every step has run in
 * After Effects and an error would invite the model to run it all again.
 */
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { CHARACTER_LIMIT } from "../config.js";
import { AeToolError, type ErrorCode } from "../errors.js";
import { assertAllowed, toAe } from "../sandbox.js";
import { json, type ToolExtra, type ToolRegistry } from "./registry.js";

const MAX_STEPS = 50;
const REF = /^\$(\d+)((?:\.[\w-]+)*)$/;
// open_project would leave later steps on another project; preview_frame returns an image; run_jsx stays a
// deliberate, direct call; batch and load_tools are not steps
const NOT_IN_BATCH = new Set(["open_project", "preview_frame", "run_jsx", "batch", "load_tools"]);

type Step = { tool: string; args: Record<string, unknown> };

// The results of recent batches by batch_id, so a batch that stopped at step N can resume there (resume: {batch_id,
// from: N}) with the ids its earlier steps made, instead of running everything again or rewiring the references.
const RUNS_KEPT = 10;
const runs = new Map<string, unknown[]>();
function remember(id: string, results: unknown[]): void {
  runs.delete(id);
  runs.set(id, results.slice());
  while (runs.size > RUNS_KEPT) runs.delete(runs.keys().next().value as string);
}

const parseMaybe = (v: unknown): unknown => {
  if (typeof v !== "string") return v;
  try { return JSON.parse(v); } catch { return v; }
};

/** Accept the step shapes models send by mistake (see the file comment); anything else is left for zod to report. */
export function normalizeSteps(v: unknown): unknown {
  const steps = parseMaybe(v);
  if (!Array.isArray(steps)) return steps;
  return steps.map((raw) => {
    const s = parseMaybe(raw);
    if (!s || typeof s !== "object" || Array.isArray(s)) return s;
    const { tool, name, args, arguments: argumentsKey, params, input, ...rest } = s as Record<string, unknown>;
    const out: Record<string, unknown> = { ...rest };
    const t = tool ?? name;
    if (t !== undefined) out.tool = typeof t === "string" ? t.replace(/^mcp__.+?__/, "") : t;
    const a = args ?? argumentsKey ?? params ?? input;
    if (a !== undefined) out.args = parseMaybe(a);
    return out;
  });
}

const LITERAL = 'For text that starts with "$" and a number (a price), write "$$" ("$$99")';

/** Replace "$N.path" strings anywhere in v with values from earlier results; "$$..." becomes the literal "$...". */
export function resolveRefs(v: unknown, results: unknown[], step: number): unknown {
  if (typeof v === "string") {
    if (v.startsWith("$$")) return v.slice(1);
    const m = REF.exec(v);
    if (!m) return v;
    const n = Number(m[1]);
    if (n < 1 || n >= step) throw new AeToolError("BAD_ARGS", `Step ${step}: "${v}" refers to step ${n}, which has not run yet`, `Refer only to earlier steps ($1 is the first). ${LITERAL}`);
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

/** The schema batch validates a step's args with, if the tool can run in a batch. */
function schemaOf(r: Pick<ToolRegistry, "bridgedTools" | "serverTools">, tool: string): z.ZodTypeAny | undefined {
  return (r.bridgedTools.get(tool) ?? r.serverTools.get(tool))?.schema;
}

/**
 * Check every step before any runs: tool known and allowed, references only to earlier steps, arguments valid. A
 * reference's value is unknown until its step runs, so type errors at (or inside a union around) a reference are not
 * counted; unknown keys, missing fields and every other value are.
 */
export function precheck(steps: Step[], r: Pick<ToolRegistry, "bridgedTools" | "serverTools">): { step: number; tool: string; message: string }[] {
  const problems: { step: number; tool: string; message: string }[] = [];
  steps.forEach(({ tool, args }, i) => {
    const step = i + 1, schema = schemaOf(r, tool), add = (message: string) => problems.push({ step, tool, message });
    if (NOT_IN_BATCH.has(tool)) return add("not allowed in batch: call it directly");
    if (!schema) return add("unknown or unavailable tool (if its group is not loaded, call load_tools first)");
    const refs = refPaths(args);
    for (const p of refs) {
      const n = Number(REF.exec(String(p.reduce<unknown>((o, k) => (o as Record<string | number, unknown>)[k], args)))![1]);
      if (n < 1 || n >= step) add(`${p.join(".")} refers to step ${n}, which has not run yet${n === 0 ? " (steps count from $1)" : ""}. ${LITERAL}`);
    }
    const parsed = schema.safeParse(args);
    if (parsed.success) return;
    for (const x of parsed.error.issues) {
      if (refs.some((rp) => startsWith(x.path.map(String), rp) || (x.code === "invalid_union" && startsWith(rp, x.path.map(String))))) continue;
      add(`${x.path.join(".") || "args"}: ${x.message}`);
    }
  });
  return problems;
}

/** A result cut down to what later calls need: ids and names of what was made, not every field. */
function brief(v: unknown): unknown {
  if (Array.isArray(v)) return v.length > 20 ? { items: v.length } : v.map(brief);
  if (v === null || typeof v !== "object") return v;
  const o = v as Record<string, unknown>, out: Record<string, unknown> = {};
  for (const k of ["id", "index", "name", "comp_id", "layer_id", "job_id", "path", "error"]) if (k in o) out[k] = o[k];
  for (const [k, x] of Object.entries(o)) if (!(k in out) && x !== null && typeof x === "object" && !Array.isArray(x) && "id" in (x as object)) out[k] = brief(x);
  return Object.keys(out).length ? out : { fields: Object.keys(o).slice(0, 12) };
}

/** The batch reply, shortened (brief results, then the last only) when it would pass the size limit. */
function reply(body: Record<string, unknown>, isError = false): CallToolResult {
  const fits = (b: unknown) => JSON.stringify(b).length <= CHARACTER_LIMIT - 500;
  if (!Array.isArray(body.results) || fits(body)) return json(body, isError);
  const all = body.results as unknown[];
  let next: Record<string, unknown> = { ...body, results: all.map(brief), note: "Results shortened to ids and names (over the size limit); every step ran. get_comp / get_layer read the rest" };
  if (!fits(next)) next = { ...body, results: all.slice(-1).map(brief), note: "Only the last result is shown (over the size limit); every step ran" };
  return json(next, isError);
}

/** A server tool's reply as a plain result (its JSON), or the error it carries. */
function unwrap(res: CallToolResult): { ok: true; result: unknown } | { ok: false; error: { code: ErrorCode; message: string; hint?: string } } {
  const text = res.content.map((c) => (c.type === "text" ? c.text : "")).join("");
  let v: unknown = text;
  try { v = JSON.parse(text); } catch { /* plain text */ }
  if (!res.isError) return { ok: true, result: v };
  const e = (v as { error?: { code?: ErrorCode; message?: string; hint?: string } })?.error;
  return { ok: false, error: { code: e?.code ?? "AE_ERROR", message: e?.message ?? text, hint: e?.hint } };
}

export function registerBatchTool(r: ToolRegistry): void {
  r.tool(
    "batch",
    'Run up to 50 tool calls in order in one call (prefer it for multi-step builds). "$N.path" in args is that value from step N\'s result (from 1), e.g. "$1.id", "$2.layers.0.id"; "$$" is a literal $ ("$$99"). All steps are checked before any runs; a step that fails in After Effects stops the batch with the results so far and a batch_id for resume. Each step is its own undo step. Not preview_frame, run_jsx or open_project.',
    {
      steps: z.preprocess(normalizeSteps, z.array(z.strictObject({ tool: z.string(), args: z.record(z.string(), z.unknown()).default({}) })).min(1).max(MAX_STEPS)),
      results: z.enum(["all", "last", "none"]).default("all").describe("Which results to return (default all; none returns only the step count)"),
      resume: z.strictObject({ batch_id: z.string(), from: z.number().int().min(2) }).optional().describe("After a failure: the same steps, fixed, run from step `from` with the earlier results"),
    },
    async (a, extra?: ToolExtra) => {
      const steps = a.steps as Step[];
      let results: unknown[] = [], first = 1;
      const batchId = a.resume?.batch_id ?? randomUUID().slice(0, 8);
      if (a.resume) {
        const prior = runs.get(a.resume.batch_id);
        if (!prior) return json({ error: { code: "NOT_FOUND", message: `Unknown batch_id ${a.resume.batch_id}`, hint: `Only the last ${RUNS_KEPT} batches are kept, and not across server restarts: run the batch again` } }, true);
        if (prior.length < a.resume.from - 1) return json({ error: { code: "BAD_ARGS", message: `Batch ${batchId} has results for steps 1-${prior.length} only`, hint: `Resume from step ${prior.length + 1} at most` } }, true);
        if (a.resume.from > steps.length) return json({ error: { code: "BAD_ARGS", message: `from ${a.resume.from} is past the last step (${steps.length})`, hint: "Send the same steps again (fixed), not only the rest" } }, true);
        results = prior.slice(0, a.resume.from - 1);
        first = a.resume.from;
      }
      const problems = precheck(steps, r).filter((x) => x.step >= first);
      if (problems.length) {
        return json({ error: { code: "BAD_ARGS", message: `${problems.length} problem(s) found; nothing ran`, hint: "Fix every listed step and send the batch again" }, steps: 0, problems }, true);
      }
      const out = (): unknown => (a.results === "all" ? results : a.results === "last" ? results.slice(-1) : undefined);
      // progress after each step: clients that honour it keep a long batch from timing out
      const token = extra?._meta?.progressToken;
      const progress = async (done: number, tool: string) => {
        if (token === undefined || !extra?.sendNotification) return;
        try { await extra.sendNotification({ method: "notifications/progress", params: { progressToken: token, progress: done, total: steps.length, message: tool } }); } catch { /* best effort */ }
      };
      for (let i = first - 1; i < steps.length; i++) {
        const step = i + 1, { tool, args } = steps[i];
        const bridged = r.bridgedTools.get(tool), server = r.serverTools.get(tool);
        // the error, how far the batch got (earlier steps are not undone), and how to resume after fixing this step
        const fail = (code: ErrorCode, message: string, hint: string): CallToolResult => {
          remember(batchId, results);
          return reply({ error: { code, message: `Step ${step} (${tool}): ${message}`, hint: `${hint}. Then send the steps again with resume: {batch_id: "${batchId}", from: ${step}}` },
            steps: i, batch_id: batchId, ...(i && a.results !== "none" ? { results: out() } : {}) }, true);
        };
        let resolved: unknown;
        try {
          resolved = resolveRefs(args, results, step);
        } catch (e) {
          const err = e as AeToolError;
          return fail(err.code ?? "BAD_ARGS", err.message, err.hint ?? "Check the reference");
        }
        const parsed = (bridged ?? server)!.schema.safeParse(resolved);
        if (!parsed.success) return fail("BAD_ARGS", parsed.error.issues.map((x) => `${x.path.join(".") || "args"}: ${x.message}`).join("; "), "Fix the arguments");
        const sent: Record<string, unknown> = { ...(parsed.data as Record<string, unknown>) };
        let res: ReturnType<typeof unwrap>;
        try {
          if (bridged) {
            for (const k of bridged.paths) if (typeof sent[k] === "string") sent[k] = toAe(assertAllowed(sent[k] as string));
            res = await r.deps.bridge.run(tool, sent);
          } else {
            res = unwrap(await server!.run(sent));
          }
        } catch (e) {
          const err = e as AeToolError;
          return fail(err.code ?? "AE_ERROR", err.message ?? String(e), err.hint ?? "Fix this step and run the rest again");
        }
        if (!res.ok) return fail(res.error.code, res.error.message, res.error.hint ?? "Fix this step and run the rest again");
        results.push(res.result);
        await progress(step, tool);
      }
      remember(batchId, results);
      return reply(a.results === "none" ? { steps: results.length } : { steps: results.length, results: out() });
    },
    { tooLargeHint: 'Pass results: "last" or "none", or split the batch' },
  );
}
