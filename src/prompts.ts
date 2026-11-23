/**
 * The server instructions (every client gets them at connect time) and the motion-guide prompt. The guidance text
 * itself lives in src/guide.ts, which the guide tool serves too.
 */
import type { McpServer } from "@modelcontextprotocol/server";
import { DESIGN_RULES, RUN_JSX_RULE, topicText } from "./guide.js";

export { DESIGN_RULES, RUN_JSX_RULE };

/**
 * Sent to clients at connect time (MCP server instructions). The conventions live here, once, instead of in every
 * tool's field descriptions (which are repeated in the tool list on every request). The first line sends the model to
 * the guide tool: in Claude Code it sees only tool names until it loads one, and a prompt is the user's to run.
 */
export const SERVER_INSTRUCTIONS = [
  "Controls a live Adobe After Effects project. First call guide (no After Effects needed): which tool does each job, with checked example calls; read an area's topic before using it, and topic limits before promising anything unusual. Then get_project: every comp with its layers (ids, names, kinds, timing).",
  "Work fast: make independent calls together in one turn; put dependent steps in one batch call (\"$1.id\" uses step 1's result). Results already show the outcome (keys as set, values read back, fields changed), so don't re-read to confirm.",
  "Units: seconds, pixels, colors [r,g,b] 0-1, scale in percent, degrees. x right, y DOWN, z into the screen (a camera in front of the comp has negative z). Comps, layers and items are project-wide numeric ids, not layer indexes. Unknown argument keys are rejected.",
  'Properties: an alias (position, scale, rotation, opacity, anchor; x_position / y_position / z_position after set_layer separate_dimensions; volume = audio levels in dB) or a path of match names and 1-based indexes, e.g. ["ADBE Effect Parade", 1, "ADBE Gaussian Blur 2-0001"]; list_properties shows them.',
  "Layer edits return {id, index, name}; results leave out defaults: a missing flag is false (locked, shy, solo, three_d, motion_blur, comp motion_blur / frame_blending), blend_mode NORMAL, stretch 100, enabled true, no parent, square pixels, work area = whole comp, shutter only with motion blur on. get_comp lists layers top first; a missing in is 0, out the comp's end, start equal to in.",
  DESIGN_RULES,
  RUN_JSX_RULE,
].join("\n");

/** The conventions the server instructions also state (units, ids, properties). */
const CONVENTIONS = [
  "You control After Effects through MCP tools. Conventions:",
  "- Time is in seconds, sizes in pixels, colors are [r,g,b] floats 0-1, scale is in percent.",
  "- Address comps/layers by the numeric ids the tools return. Address properties by alias (position, scale, rotation, opacity, anchor) or match-name arrays; use list_properties to discover paths.",
].join("\n");

/** The prompt's body: the build loop, the motion and sound craft, and where the rest is. */
const GUIDE_BODY = [
  "The guide tool maps every tool to its job and has a topic per area (text, graphics, properties, edit, 3d ...) with checked example calls: call it before using an area.",
  topicText("workflow"),
  topicText("motion"),
  topicText("audio"),
].join("\n");

/**
 * Clients known to put the server instructions in the model's context (Claude Code does), and how much of them: Claude
 * Code cuts them at 4096 characters (measured in a session: the text stopped mid-way through "Editing footage"). For
 * these clients the guide leaves out what the visible part already says (the conventions and the design rules that
 * fit), so the model does not read it twice, and keeps every rule past the cut. Other clients may not show the
 * instructions at all and get the whole guide.
 */
const SHOWS_INSTRUCTIONS: [client: RegExp, visibleChars: number][] = [[/claude[-_ ]?code/i, 4096]];

/** Whether a line of the server instructions ends inside the part the model sees. */
const seen = (line: string, visible: number): boolean => {
  const at = SERVER_INSTRUCTIONS.indexOf(line);
  return at >= 0 && at + line.length <= visible;
};

export function motionGuide(clientName: string | undefined): string {
  const shown = SHOWS_INSTRUCTIONS.find(([re]) => re.test(clientName ?? ""));
  if (!shown) return [CONVENTIONS, GUIDE_BODY, DESIGN_RULES, RUN_JSX_RULE].join("\n");
  const rest = [...DESIGN_RULES.split("\n"), RUN_JSX_RULE].filter((l) => !seen(l, shown[1]));
  if (!rest.length) return ["You control After Effects through MCP tools. The ae-motion server instructions give the conventions and the design rules.", GUIDE_BODY].join("\n");
  if (!rest[0].startsWith("Work like")) rest.unshift("More rules of the senior motion designer and video editor (S = the comp's short side):");
  return ["You control After Effects through MCP tools. The ae-motion server instructions give the conventions and the first design rules; the rest are below.", GUIDE_BODY, ...rest].join("\n");
}

export function registerPrompts(server: McpServer): void {
  server.registerPrompt("motion-guide", { title: "Motion Guide", description: "Conventions, the build loop and the motion and sound craft" }, () => ({
    messages: [{ role: "user", content: { type: "text", text: motionGuide(server.server.getClientVersion()?.name) } }],
  }));
}
