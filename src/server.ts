/** Builds the MCP server: tools, resources and prompts, wired to a bridge and a render manager. */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Bridge } from "./bridge.js";
import { SERVER_NAME, SERVER_VERSION } from "./config.js";
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
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION }, { instructions: SERVER_INSTRUCTIONS });
  const renders = new RenderManager(bridge);
  registerAllTools(new ToolRegistry(server, { bridge, renders }));
  registerResources(server, bridge);
  registerPrompts(server);
  slimToolList(server);
  return { server, renders };
}
