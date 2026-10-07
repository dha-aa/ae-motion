/** MCP prompts. motion-guide gives the model the conventions and a good build loop. */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

const MOTION_GUIDE = [
  "You control After Effects through MCP tools. Conventions:",
  "- Time is in seconds, sizes in pixels, colors are [r,g,b] floats 0-1, scale is in percent.",
  "- Address comps/layers by the numeric ids the tools return. Address properties by alias (position, scale, rotation, opacity, anchor) or match-name arrays; use list_properties to discover paths.",
  "- Every tool call is one undo step in After Effects.",
  'Recommended loop: get_project -> create_comp -> add_layer (background first) -> set_keyframes with ease_in/ease_out ("easy") -> preview_frame at key moments -> adjust -> render_start, then poll render_status.',
  "Prefer set_keyframes over many set_property calls. Use stagger for repeated elements. Do not assume effect names: find_effects first.",
].join("\n");

export function registerPrompts(server: McpServer): void {
  server.registerPrompt("motion-guide", { description: "Conventions and the recommended build loop for motion graphics" }, () => ({
    messages: [{ role: "user", content: { type: "text", text: MOTION_GUIDE } }],
  }));
}
