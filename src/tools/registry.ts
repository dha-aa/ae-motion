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
 *   like `colour` fails loudly rather than "succeeding" without effect;
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

type Args<S extends z.ZodRawShape> = z.objectOutputType<S, z.ZodTypeAny>;

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

/**
 * Rebuild a schema so that every object in it rejects unknown keys. Definitions (constraints, descriptions,
 * defaults) are copied, only object strictness changes.
 */
export function deepStrict(schema: z.ZodTypeAny): z.ZodTypeAny {
  const def = schema._def as any;
  if (schema instanceof z.ZodObject) {
    const shape = Object.fromEntries(Object.entries(schema.shape as z.ZodRawShape).map(([k, v]) => [k, deepStrict(v)]));
    return new z.ZodObject({ ...def, shape: () => shape, unknownKeys: "strict" });
  }
  if (schema instanceof z.ZodOptional) return new z.ZodOptional({ ...def, innerType: deepStrict(def.innerType) });
  if (schema instanceof z.ZodNullable) return new z.ZodNullable({ ...def, innerType: deepStrict(def.innerType) });
  if (schema instanceof z.ZodDefault) return new z.ZodDefault({ ...def, innerType: deepStrict(def.innerType) });
  if (schema instanceof z.ZodArray) return new z.ZodArray({ ...def, type: deepStrict(def.type) });
  if (schema instanceof z.ZodUnion) return new z.ZodUnion({ ...def, options: def.options.map(deepStrict) });
  if (schema instanceof z.ZodRecord) return new z.ZodRecord({ ...def, valueType: deepStrict(def.valueType) });
  if (schema instanceof z.ZodTuple) return new z.ZodTuple({ ...def, items: def.items.map(deepStrict) });
  if (schema instanceof z.ZodEffects) return new z.ZodEffects({ ...def, schema: deepStrict(def.schema) });
  return schema;
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
  schema: z.ZodTypeAny;
  paths: string[];
}

/** The part of the SDK's per-request context tools use: the client's progress token and a way to notify it. */
export interface ToolExtra {
  _meta?: { progressToken?: string | number };
  sendNotification?: (n: { method: "notifications/progress"; params: { progressToken: string | number; progress: number; total?: number; message?: string } }) => Promise<void>;
}

/** What batch needs to run a server-side tool (get_project, render_status ...): its strict schema and handler. */
export interface ServerSpec {
  schema: z.ZodTypeAny;
  run: (args: Record<string, unknown>) => Promise<CallToolResult>;
}

export class ToolRegistry {
  /** Every bridged tool registered so far, for batch. */
  readonly bridgedTools = new Map<string, BridgedSpec>();
  /** Every tool implemented in the server (not bridged), for batch. */
  readonly serverTools = new Map<string, ServerSpec>();
  /** Every tool registered so far, in order (load_tools reports what it added). */
  readonly names: string[] = [];

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
    const config = { title: opts.title ?? titleFromName(name), description, inputSchema: deepStrict(z.object(shape)), annotations: annotationsFor(opts) };
    if (!this.bridgedTools.has(name)) this.serverTools.set(name, { schema: config.inputSchema, run: run as ServerSpec["run"] });
    // The SDK's generic callback type does not line up with zod's inferred output type; the shape is the same.
    this.server.registerTool(name, config as any, handler as any);
  }

  bridged<S extends z.ZodRawShape>(name: string, description: string, shape: S, opts: BridgedOptions = {}): void {
    const paths = opts.paths ?? [];
    for (const k of paths) if (!(k in shape)) throw new Error(`bridged("${name}"): path argument "${k}" is not in the schema`);
    this.bridgedTools.set(name, { schema: deepStrict(z.object(shape)), paths });
    this.tool(
      name,
      description,
      shape,
      async (a) => {
        const args: Record<string, unknown> = { ...a };
        for (const k of paths) if (typeof args[k] === "string") args[k] = toAe(assertAllowed(args[k] as string));
        return fromBridge(await this.deps.bridge.run(name, args));
      },
      opts,
    );
  }
}

type ListHandler = (request: unknown, extra: unknown) => Promise<{ tools: Record<string, unknown>[] }>;

// Range and length bounds are still enforced by zod (its error says what is wrong); the model does not need them
// up front on every request.
const BOUNDS = new Set(["minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum", "minItems", "maxItems"]);

/**
 * A copy of an input schema with local $refs inlined (a ref path is longer than what it points to), bounds and
 * nested additionalProperties: false dropped (zod enforces both; the top level keeps it).
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
type CallHandler = (request: { params: { name: string } }, extra: unknown) => Promise<CallToolResult>;
const INPUT_ERROR = /^MCP error -32602: Input validation error: Invalid arguments for tool \S+: /;

/**
 * Bad arguments as ae-motion errors. The SDK reports a schema failure as an isError result (as the spec asks) but in
 * its own words ("MCP error -32602: Input validation error: ..."), without a hint, before any tool handler runs. This
 * rewrites it as {error: {code: BAD_ARGS, message, hint}} like every other error, and counts it in the token meter.
 */
export function toolInputErrors(server: McpServer): void {
  const handlers = (server.server as unknown as { _requestHandlers?: Map<string, CallHandler> })._requestHandlers;
  const original = handlers?.get("tools/call");
  if (!handlers || !original) return;
  handlers.set("tools/call", async (request, extra) => {
    const res = await original(request, extra);
    const text = res.isError && res.content?.[0]?.type === "text" ? res.content[0].text : "";
    if (!INPUT_ERROR.test(text)) return res;
    const issues = text.replace(INPUT_ERROR, "").split("\n").map((x) => x.trim()).filter(Boolean).join("; ");
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
