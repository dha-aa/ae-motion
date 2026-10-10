/** MCP prompts. motion-guide gives the model the conventions and a good build loop. */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

/** Shared with the server instructions: run_jsx is the lowest-priority tool. */
export const RUN_JSX_RULE =
  "run_jsx is a last resort: use a dedicated tool whenever one exists (list_properties / add_property / set_property reach almost any property), and only fall back to run_jsx for something no tool covers.";

/**
 * Sent to clients at connect time (MCP server instructions). The conventions live here, once, instead of in every
 * tool's field descriptions (which are repeated in the tool list on every request).
 */
export const SERVER_INSTRUCTIONS = [
  "Controls a live Adobe After Effects project. Start with get_project; check results with preview_frame (pass several times in one call: images are the most expensive results). The motion-guide prompt has the recommended build loop.",
  "Units: time in seconds, sizes and positions in pixels, colors [r,g,b] 0-1, scale in percent, angles in degrees. Coordinates: x right, y DOWN, z into the screen (a camera in front of the comp has negative z).",
  "Ids: comps, layers and items are numeric ids from get_project / get_comp (project-wide, not layer indexes). Unknown argument keys are rejected.",
  'Properties: an alias (position, scale, rotation, opacity, anchor; x_position / y_position / z_position after set_layer separate_dimensions; volume = audio levels in dB, a number sets both channels) or a path of match names and 1-based indexes, e.g. ["ADBE Effect Parade", 1, "ADBE Gaussian Blur 2-0001"]; list_properties shows them.',
  "Batch: run several steps in one batch call (\"$1.id\" uses step 1's result) instead of one call per step.",
  "Results are short: tools that change layers return {id, index, name} (+ timing or the fields you set); get_layer / get_comp / get_keyframes read the rest. Defaults are left out: a missing flag is false (locked, shy, solo, three_d, motion_blur, comp motion_blur / frame_blending), blend_mode NORMAL, stretch 100, enabled true, no parent; a comp has square pixels, work area = whole comp unless listed, and shutter settings appear only with motion blur on. get_comp lists layers top first; a missing in is 0, out the comp's end, start equal to in (get_layer has the label and index).",
  RUN_JSX_RULE,
].join("\n");

const MOTION_GUIDE = [
  "You control After Effects through MCP tools. Conventions:",
  "- Time is in seconds, sizes in pixels, colors are [r,g,b] floats 0-1, scale is in percent.",
  "- Address comps/layers by the numeric ids the tools return. Address properties by alias (position, scale, rotation, opacity, anchor) or match-name arrays; use list_properties to discover paths.",
  "- Every tool call is one undo step in After Effects (each step of a batch too).",
  'Recommended loop: get_project -> create_comp -> add_layer (background first) -> set_keyframes with ease_in/ease_out ("easy") -> preview_frame with several key times in one call (one tiled image) -> adjust -> render_start, then poll render_status, waiting its poll_after_s between polls.',
  "Motion craft: animate (named moves, springs), text_reveal and transition give finished-looking motion in one call each. Entrances decelerate (snappy) in 0.4-0.7 s, exits accelerate and run shorter (0.3-0.45 s). Overlap, never move in unison: stagger related layers 0.03-0.08 s. Keep the frame alive: something should change every beat (60-80 BPM cinematic, 90-110 smooth, 115-125 kinetic), and no hold longer than about 1 s. Prefer a few bold moves (rise from a mask line, pop on a spring, wipe/iris transitions, scale pushes) over crossfades, blur-ins and 3D flips. Cut on the beat: beat_markers, then align_to_markers.",
  "Review loop: after each scene run review_motion (free: no image) and fix its warnings, then preview_frame with 4-9 times in one call; check readable text, safe margins, contrast and that every element has somewhere to go.",
  "Sound: find_sound_cues lists where the animation wants effects; place the user's sound files there with add_sfx (it lines up each sound's loudest moment). Keep effects below the music (about -6 to -12 dB); duck_music lowers the music under voice-over and effects.",
  "Build in few calls: batch the steps of a scene (add_layer, then set_keyframes on \"$1.id\", and so on). Prefer set_keyframes over many set_property calls. Use stagger for repeated elements. Do not assume effect names: find_effects first.",
  RUN_JSX_RULE,
].join("\n");

export function registerPrompts(server: McpServer): void {
  server.registerPrompt("motion-guide", { description: "Conventions and the recommended build loop for motion graphics" }, () => ({
    messages: [{ role: "user", content: { type: "text", text: MOTION_GUIDE } }],
  }));
}
