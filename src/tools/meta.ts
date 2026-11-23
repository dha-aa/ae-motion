/** Tools about the server itself: the guide (src/guide.ts), version and updates (src/update.ts). Server-only, no host command. */
import { z } from "zod";
import { SERVER_VERSION } from "../config.js";
import { guideState, guideText, TOPICS, type Topic } from "../guide.js";
import { checkForUpdates } from "../update.js";
import { json, type ToolRegistry } from "./registry.js";

export function registerMetaTools(r: ToolRegistry): void {
  r.tool(
    "guide",
    "Which tool does each job, and how-tos per area with example calls checked against the real schemas. No After Effects needed: call it before building, and for an area's topic before using its tools. Default topic: tools (the map, listing the topics).",
    { topics: z.array(z.enum(TOPICS)).min(1).optional() },
    async (a) => {
      guideState.read = true;
      // plain text: the examples are JSON, and JSON-encoding them again would escape every quote
      return { content: [{ type: "text", text: guideText([...new Set<Topic>(a.topics ?? ["tools"])]) }] };
    },
    { readOnly: true },
  );

  r.tool(
    "check_for_updates",
    "Check whether a newer ae-motion-mcp release exists (GitHub version tags). Returns current and latest versions, update_available and, if so, how to update. Uses a result cached for a day unless force is true. Disabled when AE_MCP_UPDATE_CHECK=0.",
    { force: z.boolean().optional() },
    async (a) => json((await checkForUpdates(a.force === true)) ?? { current: SERVER_VERSION, disabled: true, note: "Update checks are off (AE_MCP_UPDATE_CHECK=0)" }),
    { readOnly: true, openWorld: true },
  );
}
