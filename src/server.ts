/** Builds the MCP server: tools, resources and prompts, wired to a bridge and a render manager. */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Bridge } from "./bridge.js";
import { enabledToolsets, SERVER_NAME, SERVER_VERSION, TOOLSETS } from "./config.js";
import { registerPrompts, SERVER_INSTRUCTIONS } from "./prompts.js";
import { RenderManager } from "./render/manager.js";
import { registerResources } from "./resources.js";
import { registerAllTools } from "./tools/index.js";
import { slimToolList, ToolRegistry } from "./tools/registry.js";

export interface AeMotionServer {
  server: McpServer;
  renders: RenderManager;
}

export function createServer(bridge: Bridge): AeMotionServer {
  const on = enabledToolsets();
  const lazy = TOOLSETS.some((g) => !on.has(g));
  const instructions = SERVER_INSTRUCTIONS + (lazy ? "\nSome tool groups are not loaded yet: if no tool fits, load_tools adds them (3D, timeline, masks and so on)." : "");
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION }, { instructions });
  const renders = new RenderManager(bridge);
  registerAllTools(new ToolRegistry(server, { bridge, renders }), on);
  registerResources(server, bridge);
  registerPrompts(server);
  slimToolList(server);
  return { server, renders };
}
