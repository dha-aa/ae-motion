/**
 * Registration helpers every tool module uses.
 *
 * - {@link ToolRegistry.bridged}: the common case. Validate args with zod, sandbox any path arguments, forward
 *   to the host command of the same name and return its result. The host must define `C.<name>`
 *   (test/static-checks.mjs enforces this).
 * - {@link ToolRegistry.tool}: for tools with server-side logic (preview, render, run_jsx).
 *
 * Both catch anything thrown and return it as an MCP error result `{error: {code, message, hint}}`.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { z } from "zod";
import type { Bridge, BridgeResult } from "../bridge.js";
import { toErrorBody, type ToolErrorBody } from "../errors.js";
import type { RenderManager } from "../render/manager.js";
import { assertAllowed, toAe } from "../sandbox.js";

export interface ToolDeps {
  bridge: Bridge;
  renders: RenderManager;
}

export interface ToolOptions {
  /** Tells clients the tool changes nothing (MCP readOnlyHint). */
  readOnly?: boolean;
}

export interface BridgedOptions extends ToolOptions {
  /** Top-level arguments that are filesystem paths: checked against the sandbox and slash-normalised before sending. */
  paths?: string[];
}

type Args<S extends z.ZodRawShape> = z.objectOutputType<S, z.ZodTypeAny>;

/** A JSON text result. */
export function json(value: unknown, isError = false): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }], isError };
}

export function errorResult(error: ToolErrorBody): CallToolResult {
  return json({ error }, true);
}

export function fromBridge(r: BridgeResult): CallToolResult {
  return r.ok ? json(r.result) : errorResult(r.error);
}

export class ToolRegistry {
  constructor(
    private readonly server: McpServer,
    readonly deps: ToolDeps,
  ) {}

  tool<S extends z.ZodRawShape>(name: string, description: string, shape: S, run: (args: Args<S>) => Promise<CallToolResult>, opts: ToolOptions = {}): void {
    const handler = async (args: Args<S>): Promise<CallToolResult> => {
      try {
        return await run(args);
      } catch (e) {
        return errorResult(toErrorBody(e));
      }
    };
    const config = { description, inputSchema: shape, ...(opts.readOnly ? { annotations: { readOnlyHint: true } } : {}) };
    // The SDK's generic callback type does not line up with zod's inferred output type; the shape is the same.
    this.server.registerTool(name, config, handler as any);
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
