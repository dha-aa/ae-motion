/**
 * Registration helpers every tool module uses.
 *
 * - {@link ToolRegistry.bridged}: the common case. Validate args with zod, sandbox any path arguments, forward
 *   to the host command of the same name and return its result. The host must define `C.<name>`
 *   (test/static-checks.ts enforces this).
 * - {@link ToolRegistry.tool}: for tools with server-side logic (preview, render, run_jsx).
 *
 * Every tool gets:
 * - strict input validation: unknown keys are rejected (at any depth) instead of silently dropped, so a typo
 *   like `colour` fails loudly rather than "succeeding" without effect. Every object schema is a z.strictObject
 *   (test/static-checks.ts fails on a plain z.object in src/);
 * - a title and the four MCP annotations (see {@link ToolOptions});
 * - compact JSON output with numbers rounded to 6 significant digits, capped at {@link CHARACTER_LIMIT} characters;
 * - error handling: anything thrown becomes an MCP error result `{error: {code, message, hint}}`.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult, ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { Bridge, BridgeResult } from "../bridge.js";
import { CHARACTER_LIMIT } from "../config.js";
import { toErrorBody, type ToolErrorBody } from "../errors.js";
import type { RenderManager } from "../render/manager.js";
import { assertAllowed, toAe } from "../sandbox.js";
import { usage } from "../usage.js";

export interface ToolDeps {
  bridge: Bridge;
  renders: RenderManager;
}

/**
 * Behavior hints for clients (MCP tool annotations). Defaults:
 * - read-only tools: not destructive, idempotent;
 * - other tools: destructive (may overwrite or delete), not idempotent;
 * - openWorld false: tools only touch the local After Effects project and files.
 */
export interface ToolOptions {
  /** Changes nothing in the project or on disk. */
  readOnly?: boolean;
  /** May overwrite or delete existing work (MCP default for non-read-only tools). False = purely additive. */
  destructive?: boolean;
  /** Calling again with the same arguments has no further effect. */
  idempotent?: boolean;
  /** Reaches beyond the local project (only run_jsx can). */
  openWorld?: boolean;
  /** Human-readable name; derived from the tool name when omitted. */
  title?: string;
  /** Suggestion added when a response exceeds CHARACTER_LIMIT (how to ask for less). */
  tooLargeHint?: string;
}

export interface BridgedOptions extends ToolOptions {
  /** Top-level arguments that are filesystem paths: checked against the sandbox and slash-normalised before sending. */
  paths?: string[];
}

type Args<S extends z.ZodRawShape> = z.infer<z.ZodObject<S>>;

/**
 * Round non-integers to 6 significant digits: After Effects reports float noise (0.21999999880791 for 0.22), and
 * every digit costs tokens. 6 digits keep sub-pixel positions and frame times exact enough.
 */
function roundNumbers(_key: string, v: unknown): unknown {
  return typeof v === "number" && !Number.isInteger(v) && Number.isFinite(v) ? Number(v.toPrecision(6)) : v;
}

/** A compact JSON text result. Compact rather than pretty-printed: indentation roughly doubles the size. */
export function json(value: unknown, isError = false): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(value, roundNumbers) }], isError };
}

export function errorResult(error: ToolErrorBody): CallToolResult {
  return json({ error }, true);
}

export function fromBridge(r: BridgeResult): CallToolResult {
  return r.ok ? json(r.result) : errorResult(r.error);
}

/** "get_3d_view" -> "Get 3D View". */
export function titleFromName(name: string): string {
  return name
    .split("_")
    .map((w) => (/^\d+d$/i.test(w) ? w.toUpperCase() : w === "jsx" ? "JSX" : w[0].toUpperCase() + w.slice(1)))
    .join(" ");
}

// The title goes on the tool itself only: repeating it inside the annotations costs tokens for nothing.
function annotationsFor(o: ToolOptions): ToolAnnotations {
  const readOnly = o.readOnly ?? false;
  return {
    readOnlyHint: readOnly,
    destructiveHint: readOnly ? false : (o.destructive ?? true),
    idempotentHint: o.idempotent ?? readOnly,
    openWorldHint: o.openWorld ?? false,
  };
}

/** Replace an over-long text result with an actionable error, so one call cannot flood the model's context. */
function capSize(result: CallToolResult, hint?: string): CallToolResult {
  const size = result.content.reduce((n, c) => n + (c.type === "text" ? c.text.length : 0), 0);
  if (size <= CHARACTER_LIMIT) return result;
  return errorResult({
    code: "BAD_ARGS",
    message: `Response is ${size} characters, over the ${CHARACTER_LIMIT} limit`,
    hint: hint ?? "Ask for less data (narrower filter, fewer items or a smaller depth)",
  });
}

/** What batch needs to run a bridged tool itself: its strict schema and path arguments. */
export interface BridgedSpec {
  schema: z.ZodType;
  paths: string[];
}

/** The part of the SDK's per-request context tools use: the client's progress token and a way to notify it. */
export interface ToolExtra {
  _meta?: { progressToken?: string | number };
  sendNotification?: (n: { method: "notifications/progress"; params: { progressToken: string | number; progress: number; total?: number; message?: string } }) => Promise<void>;
}

/** What batch needs to run a server-side tool (get_project, render_status ...): its strict schema and handler. */
export interface ServerSpec {
  schema: z.ZodType;
  run: (args: Record<string, unknown>) => Promise<CallToolResult>;
}

export class ToolRegistry {
  /** Every bridged tool registered so far, for batch. */
  readonly bridgedTools = new Map<string, BridgedSpec>();
  /** Every tool implemented in the server (not bridged), for batch. */
  readonly serverTools = new Map<string, ServerSpec>();
  /** Every tool registered so far, in order (load_tools reports what it added). */
  readonly names: string[] = [];
  /** Each tool's top-level argument names, for "did you mean" hints on unknown keys (toolInputErrors). */
  readonly argNames = new Map<string, string[]>();

  constructor(
    private readonly server: McpServer,
    readonly deps: ToolDeps,
  ) {}

  tool<S extends z.ZodRawShape>(name: string, description: string, shape: S, run: (args: Args<S>, extra?: ToolExtra) => Promise<CallToolResult>, opts: ToolOptions = {}): void {
    const handler = async (args: Args<S>, extra?: ToolExtra): Promise<CallToolResult> => {
      let out: CallToolResult;
      try {
        out = capSize(await run(args, extra), opts.tooLargeHint);
      } catch (e) {
        out = errorResult(toErrorBody(e));
      }
      usage.record(name, out); // the token meter in the panel
      return out;
    };
    this.names.push(name);
    this.argNames.set(name, Object.keys(shape));
    const config = { title: opts.title ?? titleFromName(name), description, inputSchema: z.strictObject(shape), annotations: annotationsFor(opts) };
    if (!this.bridgedTools.has(name)) this.serverTools.set(name, { schema: config.inputSchema, run: run as ServerSpec["run"] });
    // The SDK's generic callback type does not line up with zod's inferred output type; the shape is the same.
    this.server.registerTool(name, config as any, handler as any);
  }

  bridged<S extends z.ZodRawShape>(name: string, description: string, shape: S, opts: BridgedOptions = {}): void {
    const paths = opts.paths ?? [];
    for (const k of paths) if (!(k in shape)) throw new Error(`bridged("${name}"): path argument "${k}" is not in the schema`);
    this.bridgedTools.set(name, { schema: z.strictObject(shape), paths });
    this.tool(
      name,
      description,
      shape,
      async (a) => {
        const args: Record<string, unknown> = { ...a };
        sandboxPaths(args, paths);
        return fromBridge(await this.deps.bridge.run(name, args));
      },
      opts,
    );
  }
}

/** Sandbox and slash-normalise the path arguments in args (a string, or an array of strings), in place. */
export function sandboxPaths(args: Record<string, unknown>, paths: string[]): void {
  for (const k of paths) {
    const v = args[k];
    if (typeof v === "string") args[k] = toAe(assertAllowed(v));
    else if (Array.isArray(v)) args[k] = v.map((p) => (typeof p === "string" ? toAe(assertAllowed(p)) : p));
  }
}

type ListHandler = (request: unknown, extra: unknown) => Promise<{ tools: Record<string, unknown>[] }>;

// Range and length bounds are still enforced by zod (its error says what is wrong); the model does not need them
// up front on every request.
const BOUNDS = new Set(["minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum", "minItems", "maxItems"]);

/**
 * A copy of an input schema with local $refs inlined (a ref path is longer than what it points to), bounds and
 * nested additionalProperties: false dropped (zod enforces both; the top level keeps it), and string propertyNames
 * dropped (JSON keys are strings anyway).
 * Tuples (zod's draft-07 `items: [a, b]`) become one `items` schema when the members are alike, else `prefixItems`:
 * without the $schema header clients read the schema as draft 2020-12, where an `items` array is invalid (the Claude
 * API refused add_layer, set_layer and set_text over box_size / solid_size).
 */
export function slimSchema(root: Record<string, unknown>): Record<string, unknown> {
  const at = (ref: string): unknown => ref.slice(2).split("/").reduce<unknown>((o, k) => (o as Record<string, unknown>)?.[k], root);
  const walk = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(walk);
    if (!v || typeof v !== "object") return v;
    const o = v as Record<string, unknown>;
    if (typeof o.$ref === "string" && o.$ref.startsWith("#/")) {
      const { $ref, ...rest } = o;
      return walk({ ...(at($ref as string) as object), ...rest });
    }
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(o)) if (k !== "$schema" && !BOUNDS.has(k)) out[k] = walk(x);
    // nested objects: strictness is enforced by zod and stated in the server instructions (the top level keeps it)
    if (out.additionalProperties === false && o !== root) delete out.additionalProperties;
    // zod 4 states that a record's keys are strings, which JSON object keys always are
    if (JSON.stringify(out.propertyNames) === '{"type":"string"}') delete out.propertyNames;
    if (Array.isArray(out.items)) {
      const members = out.items as unknown[], first = JSON.stringify(members[0]);
      if (members.every((m) => JSON.stringify(m) === first)) out.items = members[0];
      else { out.prefixItems = members; delete out.items; }
      delete out.additionalItems;
    }
    return out;
  };
  return walk(root) as Record<string, unknown>;
}

/**
 * Slim what tools/list sends, which the client passes to the model on every request: slimSchema on each input
 * schema, and no "execution" block (task support, unused here). The SDK builds tools/list itself, so this wraps its
 * handler; if the SDK's internals change, it does nothing (test/static-checks.ts fails if "$schema" comes back).
 */
type CallHandler = (request: { params: { name: string; arguments?: Record<string, unknown> } }, extra: unknown) => Promise<CallToolResult>;
const INPUT_ERROR = /^MCP error -32602: Input validation error: Invalid arguments for tool \S+: /;

/**
 * Bad arguments as ae-motion errors. The SDK reports a schema failure as an isError result (as the spec asks) but in
 * its own words ("MCP error -32602: Input validation error: ..."), without a hint, before any tool handler runs. This
 * rewrites it as {error: {code: BAD_ARGS, message, hint}} like every other error, and counts it in the token meter.
 */
// Argument names a model mixes up across tools; a key in one group suggests the tool's own name from it.
const SAME_ARG: string[][] = [
  ["stagger", "stagger_seconds", "offset_seconds", "offset", "delay"],
  ["layer_ids", "layers", "ids"], ["layer_id", "layer", "id"], ["comp_id", "comp"], ["item_id", "item"],
  ["path", "property", "prop"], ["color", "colour", "fill_color"], ["size", "font_size"], ["duration", "length"],
  ["expression", "expr"], ["text", "content"], ["time", "t", "at"],
];

function editDistance(a: string, b: string): number {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array<number>(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  }
  return d[a.length][b.length];
}

/** The tool's argument an unknown key most likely meant: a known synonym, else a near spelling; only keys not passed. */
export function suggestArg(key: string, valid: string[], passed: string[]): string | undefined {
  const free = valid.filter((v) => !passed.includes(v));
  const group = SAME_ARG.find((g) => g.includes(key));
  const closest = (list: string[]): string | undefined => list.reduce<string | undefined>((b, v) => (b === undefined || editDistance(key, v) < editDistance(key, b) ? v : b), undefined);
  // a synonym the tool has (the closest one when it has several: copy_animation has offset_ and stagger_seconds)
  const syn = group && closest(free.filter((v) => group.includes(v)));
  if (syn) return syn;
  const near = closest(free);
  return near !== undefined && editDistance(key, near) <= Math.max(2, Math.floor(near.length / 3)) ? near : undefined;
}

export function toolInputErrors(server: McpServer, argNames?: Map<string, string[]>): void {
  const handlers = (server.server as unknown as { _requestHandlers?: Map<string, CallHandler> })._requestHandlers;
  const original = handlers?.get("tools/call");
  if (!handlers || !original) return;
  handlers.set("tools/call", async (request, extra) => {
    const res = await original(request, extra);
    const text = res.isError && res.content?.[0]?.type === "text" ? res.content[0].text : "";
    if (!INPUT_ERROR.test(text)) return res;
    const valid = argNames?.get(request.params.name) ?? [], passed = Object.keys(request.params.arguments ?? {});
    const issues = text.replace(INPUT_ERROR, "").split("\n").map((x) => x.trim()).filter(Boolean)
      // a top-level unknown key gets the likely intended name (nested ones carry an "at" path and are left as they are)
      .map((x) => (/ at /.test(x) ? x : x.replace(/^Unrecognized keys?: (.+)$/, (line, list: string) => {
        const hints = [...list.matchAll(/"([^"]+)"/g)].map((m) => [m[1], suggestArg(m[1], valid, passed)]).filter((h) => h[1]);
        return hints.length ? `${line} (did you mean ${hints.map((h) => `${h[0]} -> ${h[1]}`).join(", ")}?)` : line;
      })))
      .join("; ");
    const out = errorResult({ code: "BAD_ARGS", message: `Invalid arguments for ${request.params.name}: ${issues}`, hint: "Fix the listed arguments (unknown keys are rejected; the tool's input schema lists the valid ones)" });
    usage.record(request.params.name, out);
    return out;
  });
}

export function slimToolList(server: McpServer): void {
  const handlers = (server.server as unknown as { _requestHandlers?: Map<string, ListHandler> })._requestHandlers;
  const original = handlers?.get("tools/list");
  if (!handlers || !original) return;
  handlers.set("tools/list", async (request, extra) => {
    const res = await original(request, extra);
    for (const t of res.tools) {
      if (t.inputSchema) t.inputSchema = slimSchema(t.inputSchema as Record<string, unknown>);
      delete t.execution;
    }
    // what the model sees of each tool (titles and annotations stay in the client)
    usage.definitions(JSON.stringify(res.tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.inputSchema }))));
    return res;
  });
}
