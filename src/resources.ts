/** MCP resources: read-only JSON views of the live project, backed by host commands. */
import { ProtocolError, ProtocolErrorCode, type McpServer } from "@modelcontextprotocol/server";
import type { Bridge } from "./bridge.js";

const RESOURCES = [
  { name: "project", title: "Project", uri: "ae://project", description: "Current project summary", command: "get_project" },
  { name: "selection", title: "Selection", uri: "ae://selection", description: "Layers selected in the active comp", command: "get_selection" },
] as const;

export function registerResources(server: McpServer, bridge: Bridge): void {
  for (const res of RESOURCES) {
    server.registerResource(res.name, res.uri, { title: res.title, description: res.description, mimeType: "application/json" }, async (uri) => {
      const r = await bridge.run(res.command, {});
      // a failed read is a resources/read error (resources have no isError result), not JSON that looks like the resource
      if (!r.ok) throw new ProtocolError(ProtocolErrorCode.InternalError, `${r.error.code}: ${r.error.message}${r.error.hint ? ` (${r.error.hint})` : ""}`);
      return { contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify(r.result) }] };
    });
  }
}
