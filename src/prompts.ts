/** MCP prompts. motion-guide gives the model the conventions and a good build loop. */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

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
  "Work like a senior motion designer and video editor. Sizes below are relative to S = the comp's short side (1080 for 1920x1080, 1080x1920 and 1080x1080), so they fit any format:",
  "- Format: landscape 16:9 for screens and YouTube; vertical 9:16 for Reels, TikTok and Shorts; square or 4:5 for feeds. Compose for the format asked: in vertical stack elements top to bottom, keep the main content in the middle 60% of the height, and keep text out of the top 10% and bottom 20% (the apps' UI covers them) and 5% from the sides. Elsewhere keep text inside the 5% title-safe margin.",
  "- Copy: use the text exactly as given (same words, case and punctuation); never switch on all caps unless asked.",
  "- Type: headlines 10-18% of S (110-200 px at 1080), supporting lines at least half the headline size and never under 3.3% of S; lower-third names 5.5-6.7% of S with titles 3-3.7% of S; captions 4.5-6% of S. Bold or semibold for headlines; wide tracking only on small label text.",
  "- Layout: one clear focal point; centre the visual weight of the whole group, not just one layer; let groups span about 40-70% of the frame width (up to 85% in vertical); align related elements to a shared edge or centre.",
  "- Motion timing: something moves within the first 0.2 s; entrances take 0.4-0.7 s, decelerate (snappy or spring) and overlap with a 0.05-0.12 s stagger; finish the build by about 40% of a short piece; exits accelerate and run shorter (0.3-0.45 s).",
  "- Holds: never let the frame freeze. After the build keep a slow visible motion: animate push (3-6% over the hold) on the main element or a parent null, or drift; background elements can drift too.",
  "- Polish: a background with depth (gradient, vignette or soft glow, not flat black or white unless asked); glows and shadows with soft edges (blur a shape or use a layer style; never a hard-edged box); one accent colour used sparingly; shapes that draw on (trim paths) or grow from an edge instead of plain fading boxes; consistent corner radii.",
  "- Editing footage: cut on action or on the beat (beat_markers, align_to_markers); hold each shot long enough to read (about 1.5 s minimum, longer with text or detail); vary shot lengths so the pace breathes; open with the strongest moment (vertical social video: a hook in the first 1-2 s); trim dead air and long pauses (split_layer, delete_range with ripple); cover jump cuts with b-roll; mostly hard cuts, with transitions only where the scene or idea changes.",
  "- Footage framing: fill the frame unless letterboxing is asked for; scale footage no more than about 120% (it softens); reframe landscape footage for vertical by scaling to fill the height and keeping the subject centred.",
  "- Text over video: keep it readable on busy footage with a soft shadow, an outline or a translucent box behind it; captions for social video: 1-2 short lines timed to the speech, high contrast, in the safe area.",
  "- Sound: dialogue first; music under voice-over (duck_music) and sound effects about 6-12 dB below the music (add_sfx); deliver social video at about -14 LUFS (render_start deliver).",
  "- Counting animations only for plain numbers (not for text like 24/7).",
  "- Before finishing: run review_motion and fix every warning, then preview_frame with 6-9 times across the comp and check readability, margins, contrast, framing and that nothing looks frozen or clipped.",
].join("\n");

/**
 * Sent to clients at connect time (MCP server instructions). The conventions live here, once, instead of in every
 * tool's field descriptions (which are repeated in the tool list on every request).
 */
export const SERVER_INSTRUCTIONS = [
  "Controls a live Adobe After Effects project. Start with get_project: it lists every comp with its layers (ids, names, kinds, timing), so you can usually go straight to the layer you need. Check visuals with preview_frame (several times in one call: one tiled image, about 0.1 s per frame). The motion-guide prompt has the recommended build loop.",
  "Work fast: make independent calls together in one turn (several reads, or edits to different layers) and put dependent steps in one batch call. Results already show the outcome (set_keyframes returns the keys as set, set_property the value read back, set_layer the fields you changed, camera_move the final values), so don't re-read to confirm.",
  "Units: time in seconds, sizes and positions in pixels, colors [r,g,b] 0-1, scale in percent, angles in degrees. Coordinates: x right, y DOWN, z into the screen (a camera in front of the comp has negative z).",
  "Ids: comps, layers and items are numeric ids from get_project / get_comp (project-wide, not layer indexes). Unknown argument keys are rejected.",
  'Properties: an alias (position, scale, rotation, opacity, anchor; x_position / y_position / z_position after set_layer separate_dimensions; volume = audio levels in dB, a number sets both channels) or a path of match names and 1-based indexes, e.g. ["ADBE Effect Parade", 1, "ADBE Gaussian Blur 2-0001"]; list_properties shows them.',
  "Batch: run several steps in one batch call (\"$1.id\" uses step 1's result) instead of one call per step.",
  "Results are short: tools that change layers return {id, index, name} (+ timing or the fields you set); get_layer / get_comp / get_keyframes read the rest. Defaults are left out: a missing flag is false (locked, shy, solo, three_d, motion_blur, comp motion_blur / frame_blending), blend_mode NORMAL, stretch 100, enabled true, no parent; a comp has square pixels, work area = whole comp unless listed, and shutter settings appear only with motion blur on. get_comp lists layers top first; a missing in is 0, out the comp's end, start equal to in (get_layer has the label and index).",
  DESIGN_RULES,
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
  DESIGN_RULES,
  RUN_JSX_RULE,
].join("\n");

export function registerPrompts(server: McpServer): void {
  server.registerPrompt("motion-guide", { description: "Conventions and the recommended build loop for motion graphics" }, () => ({
    messages: [{ role: "user", content: { type: "text", text: MOTION_GUIDE } }],
  }));
}
