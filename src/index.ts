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
import { checkForUpdates } from "./update.js";
import { usage } from "./usage.js";

const { server, renders } = createServer(new HttpBridge());

// Stop running aerender jobs when the client disconnects or the server is terminated.
let shuttingDown = false;
const shutdown = () => {
  if (shuttingDown) return;
  shuttingDown = true;
  renders.dispose();
  usage.flush(); // the last burst of calls, before the panel's meter loses this session
};
const shutdownAndExit = () => {
  shutdown();
  process.exit(0);
};
process.on("exit", shutdown);
for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"] as const) process.on(sig, shutdownAndExit);
process.stdin.on("end", shutdownAndExit);

await server.connect(new StdioServerTransport());

// Look for a newer version in the background (at most once a day, cached; never blocks or fails a tool).
void checkForUpdates();
