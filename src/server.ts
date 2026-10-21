/** Builds the MCP server: tools, resources and prompts, wired to a bridge and a render manager. */
import { McpServer } from "@modelcontextprotocol/server";
import type { Bridge } from "./bridge.js";
import { enabledToolsets, SERVER_NAME, SERVER_VERSION, toolsetsChosen } from "./config.js";
import { registerPrompts, SERVER_INSTRUCTIONS } from "./prompts.js";
import { RenderManager } from "./render/manager.js";
import { registerResources } from "./resources.js";
import { registerAllTools, type ToolVisibility } from "./tools/index.js";
import { slimToolList, toolInputErrors, ToolRegistry } from "./tools/registry.js";
import { usage } from "./usage.js";

export interface AeMotionServer {
  server: McpServer;
  renders: RenderManager;
}

export function createServer(bridge: Bridge): AeMotionServer {
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION }, { instructions: SERVER_INSTRUCTIONS });
  const renders = new RenderManager(bridge);
  const registry = new ToolRegistry(server, { bridge, renders });
  const vis = registerAllTools(registry, enabledToolsets());
  registerResources(server, bridge);
  registerPrompts(server);
  slimToolList(server, (t) => vis.listed(t));
  toolInputErrors(server, registry);
  pickToolsForClient(server, vis);
  usage.clientName = () => server.server.getClientVersion()?.name ?? null;
  return { server, renders };
}

/** Claude Code loads MCP tool definitions only when a tool is used, so listing every tool costs it nothing. */
const DEFERS_TOOLS = /claude[-_ ]?code/i;

/**
 * During the handshake: unless AE_MCP_TOOLSETS chose the groups, show Claude Code every group (it defers definitions
 * itself) and other clients core only; then send instructions that name the hidden tools, so a model knows they exist
 * (names cost a few hundred characters, the definitions several thousand on every request). Wraps the SDK's
 * initialize handler like slimToolList wraps tools/list; if the SDK's internals change, every client sees core.
 */
function pickToolsForClient(server: McpServer, vis: ToolVisibility): void {
  type InitHandler = (request: { params?: { clientInfo?: { name?: string } } }, extra: unknown) => Promise<{ instructions?: string }>;
  const handlers = (server.server as unknown as { _requestHandlers?: Map<string, InitHandler> })._requestHandlers;
  const original = handlers?.get("initialize");
  if (!handlers || !original) return;
  handlers.set("initialize", async (request, extra) => {
    const res = await original(request, extra);
    if (!toolsetsChosen() && DEFERS_TOOLS.test(request.params?.clientInfo?.name ?? "")) vis.show(vis.hidden(), false);
    if (vis.hidden().length) {
      res.instructions = SERVER_INSTRUCTIONS + `\nMore tools, not listed yet (to keep every request small): ${vis.hiddenText()}. Use one as a batch step and its group is listed first (its arguments follow the tool's usual schema), or call load_tools to see the arguments.`;
    }
    return res;
  });
}
