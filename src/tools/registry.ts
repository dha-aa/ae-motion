/**
 * Registration helpers every tool module uses.
 *
 * - {@link ToolRegistry.bridged}: the common case. Validate args with zod, sandbox any path arguments, forward
 *   to the host command of the same name and return its result. The host must define `C.<name>`
 *   (test/static-checks.mjs enforces this).
 * - {@link ToolRegistry.tool}: for tools with server-side logic (preview, render, run_jsx).
 *
 * Every tool gets:
 * - strict input validation: unknown keys are rejected (at any depth) instead of silently dropped, so a typo
 *   like `colour` fails loudly rather than "succeeding" without effect;
 * - a title and the four MCP annotations (see {@link ToolOptions});
 * - compact JSON output, capped at {@link CHARACTER_LIMIT} characters;
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

/** A compact JSON text result. Compact rather than pretty-printed: indentation roughly doubles the size. */
export function json(value: unknown, isError = false): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(value) }], isError };
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

function annotationsFor(name: string, o: ToolOptions): ToolAnnotations {
  const readOnly = o.readOnly ?? false;
  return {
    title: o.title ?? titleFromName(name),
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

export class ToolRegistry {
  constructor(
    private readonly server: McpServer,
    readonly deps: ToolDeps,
  ) {}

  tool<S extends z.ZodRawShape>(name: string, description: string, shape: S, run: (args: Args<S>) => Promise<CallToolResult>, opts: ToolOptions = {}): void {
    const handler = async (args: Args<S>): Promise<CallToolResult> => {
      try {
        return capSize(await run(args), opts.tooLargeHint);
      } catch (e) {
        return errorResult(toErrorBody(e));
      }
    };
    const annotations = annotationsFor(name, opts);
    const config = { title: annotations.title, description, inputSchema: deepStrict(z.object(shape)), annotations };
    // The SDK's generic callback type does not line up with zod's inferred output type; the shape is the same.
    this.server.registerTool(name, config as any, handler as any);
  }

  bridged<S extends z.ZodRawShape>(name: string, description: string, shape: S, opts: BridgedOptions = {}): void {
    const paths = opts.paths ?? [];
    for (const k of paths) if (!(k in shape)) throw new Error(`bridged("${name}"): path argument "${k}" is not in the schema`);
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
