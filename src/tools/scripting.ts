/** run_jsx, the escape hatch. Off unless AE_MCP_ALLOW_JSX=1. Host side: host/commands/output.jsx. */
import { z } from "zod";
import { jsxEnabled } from "../config.js";
import { AeToolError } from "../errors.js";
import { fromBridge, type ToolRegistry } from "./registry.js";

export function registerScriptingTools(r: ToolRegistry): void {
  r.tool(
    "run_jsx",
    "Run arbitrary ExtendScript in After Effects and return its result. Disabled unless AE_MCP_ALLOW_JSX=1.",
    { code: z.string() },
    async (a) => {
      if (!jsxEnabled()) throw new AeToolError("FORBIDDEN", "run_jsx is disabled", "Set AE_MCP_ALLOW_JSX=1 in the MCP server environment to enable it");
      return fromBridge(await r.deps.bridge.run("run_jsx", { code: a.code }));
    },
    { openWorld: true }, // arbitrary code can reach the filesystem or network
  );
}
