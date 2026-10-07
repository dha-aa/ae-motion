/** Tools about the server itself: version and updates (src/update.ts). Server-only, no host command. */
import { z } from "zod";
import { SERVER_VERSION } from "../config.js";
import { checkForUpdates } from "../update.js";
import { json, type ToolRegistry } from "./registry.js";

export function registerMetaTools(r: ToolRegistry): void {
  r.tool(
    "check_for_updates",
    "Check whether a newer ae-motion-mcp release exists (GitHub version tags). Returns current and latest versions, update_available and, if so, the command to update (git pull + installer, then reopen the After Effects panel and restart the MCP client). Uses a result cached for a day unless force is true. Disabled when AE_MCP_UPDATE_CHECK=0.",
    { force: z.boolean().optional() },
    async (a) => json((await checkForUpdates(a.force === true)) ?? { current: SERVER_VERSION, disabled: true, note: "Update checks are off (AE_MCP_UPDATE_CHECK=0)" }),
    { readOnly: true, openWorld: true },
  );
}
