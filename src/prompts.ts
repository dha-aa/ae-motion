/** MCP prompts. motion-guide gives the model the conventions and a good build loop. */
import type { McpServer } from "@modelcontextprotocol/server";

/** Shared with the server instructions: run_jsx is the lowest-priority tool. */
export const RUN_JSX_RULE =
  "run_jsx is a last resort: use a dedicated tool whenever one exists (list_properties / add_property / set_property reach almost any property), and only fall back to run_jsx for something no tool covers.";

/**
 * How to make it look professional: the rules a senior motion designer and video editor work by, in the server
 * instructions (every client gets them) and the motion-guide prompt. Sizes are relative to the frame's short side, so
 * they hold for landscape, vertical and square comps. Written from what made results look amateur in review: empty
 * openings, frozen holds, undersized type, template-like boxes, hard-edged glows, changed copy.
 */
export const DESIGN_RULES = [
  "Work like a senior motion designer and video editor. S = the comp's short side (1080 for 1920x1080, 1080x1920, 1080x1080):",
  "- Format: 16:9 for screens and YouTube, 9:16 for Reels/TikTok/Shorts, square or 4:5 for feeds. Vertical: stack top to bottom, main content in the middle 60% of the height, no text in the top 10%, bottom 20% (app UI) or 5% at the sides. Elsewhere text stays in the 5% title-safe margin.",
  "- Copy exactly as given (words, case, punctuation); no all caps unless asked.",
  "- Type: headlines 10-18% of S, bold or semibold; supporting lines at least half the headline and 3.3% of S; lower-third names 5.5-6.7% of S, titles 3-3.7%; captions 4.5-6%. Wide tracking only on small labels.",
  "- Layout: one focal point; centre the whole group's visual weight; groups span 40-70% of the width (85% in vertical); align to shared edges or centres.",
  "- Timing: something moves within 0.2 s; entrances 0.4-0.7 s, decelerating (snappy or spring), staggered 0.05-0.12 s; build done by about 40% of a short piece; exits accelerate and run 0.3-0.45 s.",
  "- Holds never freeze: a slow push (3-6% over the hold) on the main element or a parent null, or drift.",
  "- Polish: backgrounds with depth (gradient, vignette, soft glow; not flat black or white unless asked); soft-edged glows and shadows (blur or a layer style, never a hard box); one accent colour, sparingly; shapes draw on (trim paths) or grow from an edge rather than fade; consistent corner radii.",
  "- Footage: cut on action or the beat (beat_markers, align_to_markers); shots at least about 1.5 s, longer with text; vary lengths; open strong (social: a hook in 1-2 s); trim dead air (split_layer, delete_range ripple); b-roll over jump cuts; mostly hard cuts, transitions only where the scene changes. Fill the frame unless letterboxing is asked; scale footage at most about 120%; for vertical, scale landscape to fill the height with the subject centred.",
  "- Text over video: a soft shadow, outline or translucent box on busy footage; social captions 1-2 short lines timed to the speech, high contrast, in the safe area.",
  "- Sound: dialogue first; duck_music under voice-over; effects 6-12 dB below the music (add_sfx); social delivery about -14 LUFS (render_start deliver).",
  "- Counting animations only for plain numbers (not 24/7).",
  "- Before finishing: run review_motion and fix every warning, then preview_frame at 6-9 times: readability, margins, contrast, framing, nothing frozen or clipped.",
].join("\n");

/**
 * Sent to clients at connect time (MCP server instructions). The conventions live here, once, instead of in every
 * tool's field descriptions (which are repeated in the tool list on every request).
 */
export const SERVER_INSTRUCTIONS = [
  "Controls a live Adobe After Effects project. Start with get_project: every comp with its layers (ids, names, kinds, timing). Check visuals with preview_frame (several times in one call give one tiled image). The motion-guide prompt has the build loop.",
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

const GUIDE_BODY = [
  "- Every tool call is one undo step in After Effects (each step of a batch too).",
  'Recommended loop: get_project -> create_comp -> add_layer (background first) -> set_keyframes with ease_in/ease_out ("easy") -> preview_frame with several key times in one call (one tiled image) -> adjust -> render_start, then poll render_status, waiting its poll_after_s between polls.',
  "Motion craft: animate (named moves, springs), text_reveal and transition give finished-looking motion in one call each. Entrances decelerate (snappy) in 0.4-0.7 s, exits accelerate and run shorter (0.3-0.45 s). Overlap, never move in unison: stagger related layers 0.03-0.08 s. Keep the frame alive: something should change every beat (60-80 BPM cinematic, 90-110 smooth, 115-125 kinetic), and no hold longer than about 1 s. Prefer a few bold moves (rise from a mask line, pop on a spring, wipe/iris transitions, scale pushes) over crossfades, blur-ins and 3D flips. Cut on the beat: beat_markers, then align_to_markers.",
  "Review loop: after each scene run review_motion (free: no image) and fix its warnings, then preview_frame with 4-9 times in one call; check readable text, safe margins, contrast and that every element has somewhere to go.",
  "Sound: find_sound_cues lists where the animation wants effects; place the user's sound files there with add_sfx (it lines up each sound's loudest moment). Keep effects below the music (about -6 to -12 dB); duck_music lowers the music under voice-over and effects. Sound follows the story, not every cut: pass find_sound_cues events for the moments that matter (importance 0-1, 0 for none) and let it keep the motion's exact frame; a big reveal can take a riser that peaks on it (add_sfx align peak, lead_in), a short silence just before it (duck_music dips) and one impact; silence is a valid choice. Change music cues with sequence_layers overlap + audio_crossfade, and fade with set_layer audio_fade.",
  "Build in few calls: batch the steps of a scene (add_layer, then set_keyframes on \"$1.id\", and so on). Prefer set_keyframes over many set_property calls. Use stagger for repeated elements. Do not assume effect names: find_effects first.",
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
  server.registerPrompt("motion-guide", { description: "Conventions and the recommended build loop for motion graphics" }, () => ({
    messages: [{ role: "user", content: { type: "text", text: motionGuide(server.server.getClientVersion()?.name) } }],
  }));
}
