#!/usr/bin/env node
/**
 * Entry point: runs the AE Motion MCP server on stdio (normally launched by the MCP client).
 *
 *   MCP client --stdio--> this server --HTTP 127.0.0.1 + token--> CEP panel in AE --> ExtendScript
 *
 * See docs/architecture.md.
 */
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { HttpBridge } from "./bridge.js";
import { createServer } from "./server.js";

const { server, renders } = createServer(new HttpBridge());

// Stop running aerender jobs when the client disconnects or the server is terminated.
let shuttingDown = false;
const shutdown = () => {
  if (shuttingDown) return;
  shuttingDown = true;
  renders.dispose();
};
const shutdownAndExit = () => {
  shutdown();
  process.exit(0);
};
process.on("exit", shutdown);
for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"] as const) process.on(sig, shutdownAndExit);
process.stdin.on("end", shutdownAndExit);

await server.connect(new StdioServerTransport());
