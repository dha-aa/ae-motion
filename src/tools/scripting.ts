/**
 * run_jsx, the escape hatch and the tool of last resort. Off unless AE_MCP_ALLOW_JSX=1. Raw ExtendScript skips the
 * validation, path sandbox and error handling the dedicated tools give, so its description steers models to them first.
 * Host side: host/commands/output.jsx.
 */
import { z } from "zod";
import { jsxEnabled } from "../config.js";
import { AeToolError } from "../errors.js";
import { fromBridge, type ToolRegistry } from "./registry.js";

export function registerScriptingTools(r: ToolRegistry): void {
  r.tool(
    "run_jsx",
    "LAST RESORT: run arbitrary ExtendScript in After Effects and return its result. Use it only when no dedicated tool can do the job: first look for one (layers, keyframes, effects via find_effects/apply_effect, properties via list_properties/add_property/set_property, design, timeline, 3D tools). Raw scripts skip input validation, the file-path sandbox and the tools' error hints, and can break the project. Keep scripts short and read-only where possible; the call is still one undo step. Disabled unless AE_MCP_ALLOW_JSX=1.",
    { code: z.string() },
    async (a) => {
      if (!jsxEnabled()) throw new AeToolError("FORBIDDEN", "run_jsx is disabled", "Set AE_MCP_ALLOW_JSX=1 in the MCP server environment to enable it");
      return fromBridge(await r.deps.bridge.run("run_jsx", { code: a.code }));
    },
    { openWorld: true }, // arbitrary code can reach the filesystem or network
  );
}
