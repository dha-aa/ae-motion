/** MCP resources: read-only JSON views of the live project, backed by host commands. */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Bridge } from "./bridge.js";

const RESOURCES = [
  { name: "project", uri: "ae://project", description: "Current project summary", command: "get_project" },
  { name: "selection", uri: "ae://selection", description: "Layers selected in the active comp", command: "get_selection" },
] as const;

export function registerResources(server: McpServer, bridge: Bridge): void {
  for (const res of RESOURCES) {
    server.registerResource(res.name, res.uri, { description: res.description, mimeType: "application/json" }, async (uri) => {
      const r = await bridge.run(res.command, {});
      return { contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify(r.ok ? r.result : r.error, null, 2) }] };
    });
  }
}
