/** MCP prompts. motion-guide gives the model the conventions and a good build loop. */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

/** Shared with the server instructions: run_jsx is the lowest-priority tool. */
export const RUN_JSX_RULE =
  "run_jsx is a last resort: use a dedicated tool whenever one exists (list_properties / add_property / set_property reach almost any property), and only fall back to run_jsx for something no tool covers.";

/** Sent to clients at connect time (MCP server instructions). */
export const SERVER_INSTRUCTIONS = [
  "Controls a live Adobe After Effects project. Time in seconds, sizes in pixels, colors [r,g,b] 0-1, scale in percent; comps and layers by the numeric ids tools return.",
  "Start with get_project; check results with preview_frame. The motion-guide prompt has the recommended build loop.",
  RUN_JSX_RULE,
].join("\n");

const MOTION_GUIDE = [
  "You control After Effects through MCP tools. Conventions:",
  "- Time is in seconds, sizes in pixels, colors are [r,g,b] floats 0-1, scale is in percent.",
  "- Address comps/layers by the numeric ids the tools return. Address properties by alias (position, scale, rotation, opacity, anchor) or match-name arrays; use list_properties to discover paths.",
  "- Every tool call is one undo step in After Effects.",
  'Recommended loop: get_project -> create_comp -> add_layer (background first) -> set_keyframes with ease_in/ease_out ("easy") -> preview_frame at key moments -> adjust -> render_start, then poll render_status.',
  "Prefer set_keyframes over many set_property calls. Use stagger for repeated elements. Do not assume effect names: find_effects first.",
  RUN_JSX_RULE,
].join("\n");

export function registerPrompts(server: McpServer): void {
  server.registerPrompt("motion-guide", { description: "Conventions and the recommended build loop for motion graphics" }, () => ({
    messages: [{ role: "user", content: { type: "text", text: MOTION_GUIDE } }],
  }));
}
