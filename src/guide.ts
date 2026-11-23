/**
 * What a model needs to use every tool well, served by the guide tool (src/tools/meta.ts) to any client, and partly by
 * the server instructions and the motion-guide prompt (src/prompts.ts).
 *
 * Why a tool: Claude Code defers MCP tool definitions, so a model sees only the tool names until it loads one, and it
 * shows the server instructions cut at 4,096 characters. A prompt (motion-guide) is something the user runs, not the
 * model. A tool every client can call is the one place a model can always read which tool does what.
 *
 * test/server.test.ts keeps it true: TOOL_MAP names exactly the registered tools, and every example line (two spaces,
 * a tool name, its JSON arguments) passes that tool's real schema, batch steps through batch's own pre-check.
 */

/** Shared with the server instructions: run_jsx is the lowest-priority tool. */
export const RUN_JSX_RULE =
  "run_jsx is a last resort, only for what no tool covers: list_properties / add_property / set_property reach almost any property.";

/**
 * How to make it look professional: the rules a senior motion designer and video editor work by, in the server
 * instructions (every client gets them), the motion-guide prompt and guide topic design. Sizes are relative to the
 * frame's short side, so they hold for landscape, vertical and square comps. Written from what made results look
 * amateur in review: empty openings, frozen holds, undersized type, template-like boxes, hard-edged glows, changed copy.
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

/** Every tool, by area, with what it is for (and what it is not for, where tools are easy to mix up). */
export const TOOL_MAP: [area: string, rows: [tool: string, use: string][]][] = [
  ["Start and server", [
    ["guide", "this map, and how-tos with checked example calls by topic (no After Effects needed)"],
    ["get_project", "every comp with its layers (ids, names, kinds, timing), the active comp: call it first"],
    ["batch", 'several steps in one call; "$1.id" or "$name.id" passes an earlier step\'s result (not preview_frame, run_jsx, open_project)'],
    ["load_tools", "show a tool group the client does not list yet (only listed while some are hidden)"],
    ["check_for_updates", "is a newer ae-motion release out"],
    ["run_jsx", "raw ExtendScript; last resort when no tool covers it, off unless AE_MCP_ALLOW_JSX=1"],
  ]],
  ["Look around (read only)", [
    ["get_comp", "one comp's settings and layers, top first (filter by name, kind or at; page with limit / offset)"],
    ["get_layer", "a layer's transform values, effects (with their indexes), masks, matte, bounds; several with layer_ids"],
    ["list_properties", "a layer's property tree with match names: find a path before set_property / set_keyframes"],
    ["get_keyframes", "one property's keys, easing and expression"],
    ["get_text", "a text layer's content and styling"],
    ["get_camera", "a camera's lens, focus, position and what drives each property"],
    ["list_markers", "a layer's or comp's markers, with their indexes"],
    ["find_effects", "installed effects' match names (never guess one)"],
    ["find_fonts", "installed fonts' PostScript names for set_text / text_style (never guess one)"],
  ]],
  ["Project and comps", [
    ["create_comp", "new comp (size, fps, duration, background color)"],
    ["set_comp", "change comp settings: size, duration, work area, the comp motion-blur switch, renderer"],
    ["import_footage", "import files (video, audio, images, sequences, layered PSD/AI as comps) into the project"],
    ["set_item", "rename, file, label or re-interpret a project item; swap a footage file everywhere"],
    ["delete_item", "delete a project item (refuses used items unless force)"],
    ["open_project", "open a project or a new empty one (replaces the open project)"],
    ["save_project", "save, save as, clean unused footage, keep a numbered snapshot"],
  ]],
  ["Layers", [
    ["add_layer", "any new layer: text, shape, solid, null, adjustment, footage / precomp (item_id), camera, light, mesh; first settings in options"],
    ["set_layer", "timing (in, out, start, stretch), parent, blend mode, switches, audio fade; not property values (set_property)"],
    ["duplicate_layer", "copies of a layer, optionally offset in time"],
    ["delete_layer", "delete a layer"],
    ["reorder_layer", "change stacking order"],
    ["link_layers", "parent several layers to a layer or to a new null"],
    ["precompose", "move layers into a new comp"],
    ["replace_source", "swap what a layer shows for another item, keeping its timing and animation"],
  ]],
  ["Timeline and markers", [
    ["split_layer", "cut layers in two at a time"],
    ["delete_range", "remove a time span from the comp, closing the gap (ripple)"],
    ["insert_time", "open a gap at a time, moving later layers"],
    ["shift_layers", "move whole layers in time by seconds (keys go with them)"],
    ["sequence_layers", "place layers one after another (overlap, audio crossfade)"],
    ["align_to_markers", "start each layer on the next marker (cut to beats)"],
    ["trim_comp", "trim the comp to its work area or its layers"],
    ["set_playhead", "move the comp's current time"],
    ["add_marker", "add a layer or comp marker"],
    ["update_marker", "change a marker"],
    ["delete_marker", "delete a marker"],
  ]],
  ["Animation", [
    ["animate", "ready-made moves: fade, pop, grow, slide, drop, spin in or out; push / drift through holds; the first choice for entrances and exits"],
    ["text_reveal", "reveal or hide text by character, word or line"],
    ["transition", "a shape wipe, bars or iris covering a cut between scenes"],
    ["set_keyframes", "custom animation: all keys of one property with easing (replaces its keys unless merge)"],
    ["edit_keyframes", "change single keys (set, move, delete, re-ease) and leave the rest"],
    ["set_property", "a static value, or one key at time; the same value on many layers"],
    ["copy_animation", "copy one property's keys or expression to other layers"],
    ["stagger", "offset existing keys across layers (keys only; whole layers: shift_layers)"],
    ["set_expression", "put an expression on a property (one or many layers)"],
    ["review_motion", "critique a comp's animation and layout without rendering: run after each scene"],
  ]],
  ["Properties, effects and styles", [
    ["add_property", "create what does not exist yet (text animators, selectors) so it can be set"],
    ["apply_effect", "add an effect by match name with its parameters"],
    ["edit_effect", "set, enable, disable or remove an effect by index"],
    ["apply_preset", "apply an .ffx animation preset"],
    ["add_layer_style", "drop shadow, glow, stroke, bevel, overlays (soft shadows and glows)"],
    ["add_shape_modifier", "trim paths (draw-on), repeater, round corners on a shape group"],
  ]],
  ["Text, shapes, masks and layout", [
    ["set_text", "change text and its styling, or style part of it (ranges)"],
    ["text_to_shapes", "turn text into letter-outline shapes"],
    ["add_shape", "add another shape group to a shape layer"],
    ["add_mask", "add a mask (rect, ellipse, polygon, path)"],
    ["set_track_matte", "use one layer as another's matte"],
    ["align_layers", "align and distribute layers by their visible content"],
    ["set_anchor", "move the anchor point onto the content (scale or rotate from an edge)"],
  ]],
  ["3D and camera", [
    ["set_3d", "make a layer 3D and set its 3D transform and material"],
    ["set_camera", "a camera's lens, depth of field, focus, position, aim"],
    ["camera_move", "animate a camera: dolly, truck, pedestal, crane, pan, tilt, roll, orbit, zoom, rack focus, path"],
    ["camera_shake", "handheld shake"],
    ["camera_rig", "null controls that drive a camera"],
    ["set_light", "a light's type, intensity, cone, falloff, shadows"],
    ["set_3d_view", "the viewer's 3D view (editor only; renders use the active camera)"],
  ]],
  ["Audio", [
    ["beat_markers", "markers on the beats of a music layer"],
    ["audio_react", "drive a property with a layer's loudness"],
    ["find_sound_cues", "where the animation wants sound effects"],
    ["add_sfx", "place a sound file so its loudest moment hits a time"],
    ["duck_music", "lower the music under voice-over and effects; silent dips"],
  ]],
  ["Preview and render", [
    ["preview_frame", "see frames: several times in one call give one tiled image"],
    ["render_start", "render to a file in the background (only when the user asks), optionally delivery loudness"],
    ["render_status", "a render's progress and the check of the written file"],
    ["render_cancel", "stop a render"],
  ]],
];

/** How-to topics, beside tools (the map) and design (DESIGN_RULES). Lines of two spaces + tool + JSON are example calls. */
const HOWTO = {
  workflow: [
    "Build loop:",
    "1. get_project for the ids of comps and layers (ids are project-wide numbers from results, never layer indexes; never invent one). A new piece: create_comp, whose result has the comp id.",
    "  create_comp {\"name\":\"Promo\",\"width\":1920,\"height\":1080,\"fps\":30,\"duration\":10}",
    "2. Build a scene in one batch: background first, then content, then its animation. Name steps with as and refer to them as \"$name.id\":",
    "  batch {\"steps\":[{\"tool\":\"add_layer\",\"as\":\"bg\",\"args\":{\"comp_id\":1,\"kind\":\"solid\",\"options\":{\"name\":\"BG\",\"color\":[0.06,0.07,0.1]}}},{\"tool\":\"add_layer\",\"as\":\"title\",\"args\":{\"comp_id\":1,\"kind\":\"text\",\"options\":{\"text\":\"Launch day\",\"position\":[960,540],\"anchor\":\"center\",\"text_style\":{\"size\":150,\"color\":[1,1,1],\"justification\":\"center\"}}}},{\"tool\":\"animate\",\"args\":{\"layer_ids\":[\"$title.id\"],\"move\":\"slide\",\"time\":0.2}}]}",
    "3. review_motion (no image, cheap) and fix every warning:",
    "  review_motion {\"comp_id\":1}",
    "4. preview_frame with several times in one call (one tiled image):",
    "  preview_frame {\"comp_id\":1,\"time\":[0.5,1.5,3,6]}",
    "5. Adjust, review again, save. Render only when the user asks, then poll render_status, waiting its poll_after_s between polls:",
    "  render_start {\"comp_id\":1,\"output_path\":\"/absolute/path/promo.mp4\",\"deliver\":true}",
    "Rules:",
    "- Results already show the outcome (keys as set, values read back, fields changed): do not re-read to confirm.",
    "- Unknown argument keys are rejected. An error is {error: {code, message, hint}}: do what the hint says instead of sending the same call again.",
    "- Each call is one undo step (each batch step too).",
    "- batch: up to 50 steps, all checked before any runs. A failed step returns batch_id: fix it and send the same steps with resume: {batch_id, from: N}. defaults sends shared arguments once:",
    "  batch {\"defaults\":{\"add_layer\":{\"comp_id\":1,\"kind\":\"text\",\"options\":{\"text_style\":{\"size\":54,\"color\":[1,1,1]}}}},\"steps\":[{\"tool\":\"add_layer\",\"args\":{\"options\":{\"text\":\"First line\",\"in\":0,\"out\":2}}},{\"tool\":\"add_layer\",\"args\":{\"options\":{\"text\":\"Second line\",\"in\":2,\"out\":4}}}]}",
    "- Text that starts with $ and a number is written \"$$\" in a batch (\"$$99\").",
    "- Big projects: get_comp with name, kind or at, and page with limit / offset.",
    "- save_project snapshot: true keeps a numbered copy to go back to with open_project.",
    "- Hidden tool groups (clients other than Claude Code): a batch step that names one of their tools shows its group, or call load_tools.",
  ],
  motion: [
    "Use the highest-level tool that does the job:",
    "- Entrances and exits: animate. It keys from the layer's current values, so place the layer where it should rest first. style snappy (default), smooth, spring, bounce, linear; stagger offsets each layer:",
    "  animate {\"layer_ids\":[4,5,6],\"move\":\"pop\",\"time\":0.3,\"stagger\":0.08}",
    "  animate {\"layer_ids\":[4,5,6],\"move\":\"slide\",\"phase\":\"out\",\"direction\":\"down\"}",
    "- Holds: animate push (slow scale-up, amount %) or drift; they run from where the animation lands to the out point:",
    "  animate {\"layer_ids\":[4],\"move\":\"push\",\"amount\":4}",
    "- Text by character, word or line: text_reveal (mask clips rise / drop at a line):",
    "  text_reveal {\"layer_id\":7,\"style\":\"rise\",\"by\":\"words\",\"mask\":true,\"time\":0.2}",
    "- Scene changes: transition covers the frame at time; cut the scenes there.",
    "  transition {\"comp_id\":1,\"time\":4,\"type\":\"wipe\",\"direction\":\"left\"}",
    "- Custom animation: set_keyframes replaces every key of one property (merge: true keeps keys at other times). ease_in / ease_out: \"easy\" or {speed, influence}; interp spring or bounce springs a key into the next one:",
    "  set_keyframes {\"layer_id\":4,\"path\":\"position\",\"keys\":[{\"t\":0,\"v\":[960,1300],\"ease_out\":{\"speed\":0,\"influence\":80}},{\"t\":0.6,\"v\":[960,540],\"ease_in\":{\"speed\":0,\"influence\":90}}]}",
    "  set_keyframes {\"layer_id\":4,\"path\":\"scale\",\"keys\":[{\"t\":0,\"v\":[0,0],\"interp\":\"spring\"},{\"t\":0.5,\"v\":[100,100]}]}",
    "- Single keys: edit_keyframes (set, move, delete by t or index), leaving the others:",
    "  edit_keyframes {\"layer_id\":4,\"path\":\"position\",\"edits\":[{\"action\":\"move\",\"t\":0.6,\"to\":0.8},{\"action\":\"set\",\"t\":0.8,\"ease_in\":\"easy\"}]}",
    "- One value: set_property (static, or a key at time); the same value on many layers with layer_ids:",
    "  set_property {\"layer_ids\":[4,5],\"path\":\"opacity\",\"value\":80}",
    "- The same animation on other layers: copy_animation (stagger_seconds offsets each target). Existing keys offset across layers: stagger. Whole layers in time: shift_layers.",
    "  copy_animation {\"from_layer_id\":4,\"path\":\"position\",\"to_layer_ids\":[5,6],\"stagger_seconds\":0.08}",
    "- Expressions: set_expression (an empty string clears it); the result says whether After Effects accepted it.",
    "  set_expression {\"layer_id\":4,\"path\":\"rotation\",\"expression\":\"time * 30\"}",
    "- Read first when editing existing work: get_keyframes (keys, easing), list_properties (paths).",
    "- Then review_motion: linear easing, frozen holds, layers moving in unison, moves cut off, late first move.",
    "Craft: overlap, never move in unison (stagger related layers); keep the frame alive (something changes every beat: 60-80 BPM cinematic, 90-110 smooth, 115-125 kinetic; no hold over about 1 s without push or drift); a few bold moves (rise from a mask line, pop on a spring, wipe or iris transitions, scale pushes) over crossfades, blur-ins and 3D flips; cut on the beat (topic audio). One set_keyframes beats many set_property calls.",
    "Pitfalls: set_keyframes refuses while an expression it did not write is on the property (clear it with set_expression \"\"); motion blur needs set_layer motion_blur and set_comp motion_blur.",
  ],
  text: [
    "- New text: add_layer kind text. options.anchor center puts the text's centre on position; box_size makes paragraph (box) text; text_style takes set_text's fields:",
    "  add_layer {\"comp_id\":1,\"kind\":\"text\",\"options\":{\"text\":\"Fresh drops every Friday\",\"box_size\":[900,300],\"position\":[540,960],\"anchor\":\"center\",\"text_style\":{\"font\":\"Montserrat-Bold\",\"size\":96,\"color\":[1,1,1],\"justification\":\"center\"}}}",
    "- Fonts: a PostScript name from find_fonts (an unknown font is refused, so never guess one):",
    "  find_fonts {\"query\":\"montserrat bold\"}",
    "- Change: set_text (only the fields passed change; skipped lists what After Effects refused). Part of the text: ranges, by match (every occurrence) or start / end character indexes (AE 24.3+). New text clears earlier ranges, so pass ranges in the same call:",
    "  set_text {\"layer_id\":7,\"text\":\"Save 40% today\",\"ranges\":[{\"match\":\"40%\",\"color\":[1,0.75,0.1],\"faux_bold\":true}]}",
    "- Read: get_text. Point text cannot become box text: add a new layer with box_size.",
    "- Animate: text_reveal (topic motion), or a text animator with add_property, then properties under the returned path + \"ADBE Text Animator Properties\" (ADBE Text Opacity, ADBE Text Position 3D, ADBE Text Fill Color) and a selector under path + \"ADBE Text Selectors\" (ADBE Text Selector):",
    "  add_property {\"layer_id\":7,\"match_name\":\"ADBE Text Animator\",\"group_path\":[\"ADBE Text Properties\",\"ADBE Text Animators\"]}",
    "- Letter outlines to animate as paths: text_to_shapes.",
    "- Over busy footage: a soft add_layer_style drop_shadow, or a box behind it that keeps fitting the text (add_layer shape with fit_to, topic graphics).",
  ],
  graphics: [
    "- Shape layers: add_layer kind shape with options.shape (rect, ellipse, star, polygon, path; fill, stroke, roundness, dashes); add_shape adds more groups (position is the offset inside the layer):",
    "  add_layer {\"comp_id\":1,\"kind\":\"shape\",\"options\":{\"name\":\"Card\",\"position\":[960,540],\"shape\":{\"type\":\"rect\",\"size\":[800,450],\"roundness\":32,\"fill\":[0.12,0.13,0.18]}}}",
    "  add_shape {\"layer_id\":8,\"shape\":{\"type\":\"ellipse\",\"size\":[120,120],\"fill\":[1,0.4,0.2],\"position\":[-300,-150]}}",
    "- A box that keeps fitting another layer's content plus padding (text highlight, lower-third plate): fit_to:",
    "  add_layer {\"comp_id\":1,\"kind\":\"shape\",\"options\":{\"name\":\"Plate\",\"fit_to\":{\"layer_id\":7,\"padding\":[40,20]},\"shape\":{\"type\":\"rect\",\"roundness\":16,\"fill\":[0,0,0],\"fill_opacity\":60}}}",
    "- Draw-on is for strokes: a stroke-only shape, an open path for a line. Trimming a filled shape closes the cut outline into a wedge, so grow a filled bar from an edge instead (set_anchor left, then scale [0,100] to [100,100]).",
    "  add_layer {\"comp_id\":1,\"kind\":\"shape\",\"options\":{\"name\":\"Underline\",\"position\":[960,745],\"shape\":{\"type\":\"path\",\"vertices\":[[-110,0],[110,0]],\"closed\":false,\"stroke\":[1,0.62,0.2],\"stroke_width\":8,\"line_cap\":\"round\"}}}",
    "Then add_shape_modifier trim_paths. Its result gives the modifier's path (on that line, group 3: path, stroke, then the trim), so key the end with set_keyframes at that path + \"ADBE Vector Trim End\" (0 to 100). repeater and round_corners work the same way.",
    "  add_shape_modifier {\"layer_id\":8,\"modifier\":\"trim_paths\",\"params\":{\"ADBE Vector Trim End\":0}}",
    "  set_keyframes {\"layer_id\":8,\"path\":[\"ADBE Root Vectors Group\",1,\"ADBE Vectors Group\",3,\"ADBE Vector Trim End\"],\"keys\":[{\"t\":0.75,\"v\":0,\"ease_out\":{\"speed\":0,\"influence\":80}},{\"t\":1.35,\"v\":100,\"ease_in\":{\"speed\":0,\"influence\":90}}]}",
    "- Masks: add_mask (rect, ellipse, polygon, path; feather, mode, inverted) returns path [\"ADBE Mask Parade\", n]. Animate the shape at path + \"ADBE Mask Shape\" with a shape spec as v (keep the vertex count the same across keys):",
    "  add_mask {\"layer_id\":9,\"shape\":{\"type\":\"rect\",\"position\":[960,540],\"size\":[10,1080]},\"feather\":20}",
    "  set_keyframes {\"layer_id\":9,\"path\":[\"ADBE Mask Parade\",1,\"ADBE Mask Shape\"],\"keys\":[{\"t\":0,\"v\":{\"type\":\"rect\",\"position\":[960,540],\"size\":[10,1080]},\"ease_out\":\"easy\"},{\"t\":0.7,\"v\":{\"type\":\"rect\",\"position\":[960,540],\"size\":[1920,1080]},\"ease_in\":\"easy\"}]}",
    "- Track mattes: set_track_matte (alpha, luma, inverted); matte_layer_id null removes it.",
    "  set_track_matte {\"layer_id\":10,\"matte_layer_id\":7,\"type\":\"alpha\"}",
    "- Soft shadows, glows, strokes: add_layer_style; its result lists every param name and path.",
    "  add_layer_style {\"layer_id\":7,\"style\":\"drop_shadow\",\"params\":{\"opacity\":35,\"distance\":6,\"size\":24}}",
    "- Effects: find_effects for the match name, then apply_effect (params by name, match name or 1-based index; a failed param removes the effect); edit_effect by the index get_layer lists.",
    "  find_effects {\"query\":\"blur\"}",
    "  apply_effect {\"layer_id\":4,\"match_name\":\"ADBE Gaussian Blur 2\",\"params\":{\"Blurriness\":20}}",
    "- Layout: align_layers aligns and distributes by visible content; set_anchor moves the anchor onto the content (scale from the bottom, rotate from a corner):",
    "  align_layers {\"layer_ids\":[4,5,6],\"align\":\"v_center\",\"distribute\":\"horizontal\"}",
    "  set_anchor {\"layer_id\":8,\"anchor\":\"bottom\"}",
    "- Blend modes, adjustment layers, a solid's color and size: set_layer (blend_mode, adjustment, solid_color, solid_size).",
  ],
  properties: [
    "Address a property by alias (position, scale, rotation, opacity, anchor; x_position / y_position / z_position after set_layer separate_dimensions; volume = audio levels in dB) or by a path of match names and 1-based indexes. Never guess a match name: list_properties shows the real paths.",
    "  list_properties {\"layer_id\":4,\"group_path\":[\"ADBE Effect Parade\"],\"depth\":3}",
    "  get_keyframes {\"layer_id\":4,\"path\":[\"ADBE Effect Parade\",1,\"ADBE Gaussian Blur 2-0001\"]}",
    "- An effect's parameter: [\"ADBE Effect Parade\", effect index (get_layer lists them), parameter match name]. A layer style's: the add_layer_style result's path.",
    "- Not there yet (text animators, selectors): add_property, then set_property / set_keyframes under the returned path.",
    "- Values: numbers, arrays ([x,y] or [x,y,z] px, scale [x,y] %, colors [r,g,b] 0-1), strings, booleans; mask and shape paths take a shape spec.",
    "- An animated property needs time in set_property (it sets or updates the key there):",
    "  set_property {\"layer_id\":4,\"path\":[\"ADBE Effect Parade\",1,\"ADBE Gaussian Blur 2-0001\"],\"value\":0,\"time\":1}",
    "- Change several layers at once: set_property / set_expression layer_ids.",
    "- Read a layer's values, effects and masks: get_layer (values at time).",
  ],
  edit: [
    "- Import, then add a footage layer with item_id; fit cover fills the frame; in / out are comp times, source_in is the source time shown at in:",
    "  import_footage {\"paths\":[\"/absolute/path/a.mp4\",\"/absolute/path/b.mp4\"],\"folder\":\"Footage\"}",
    "  add_layer {\"comp_id\":1,\"kind\":\"footage\",\"options\":{\"item_id\":12,\"fit\":\"cover\",\"in\":0,\"out\":3,\"source_in\":5}}",
    "- Cut: split_layer at a time; delete_range removes a span from every unlocked layer and closes the gap (ripple); insert_time opens one.",
    "  split_layer {\"layer_ids\":[11],\"time\":2.5}",
    "  delete_range {\"comp_id\":1,\"start\":3,\"end\":5}",
    "- Order in time: sequence_layers (one after another, overlap), shift_layers (move by seconds), align_to_markers (each starts on a marker).",
    "  sequence_layers {\"layer_ids\":[11,12,13],\"start\":0}",
    "  shift_layers {\"layer_ids\":[14],\"offset_seconds\":1.5}",
    "- Trim one layer: set_layer in / out (comp times). Speed: stretch (200 = half speed, negative reverses), or time_remap.",
    "  set_layer {\"layer_id\":11,\"in\":1.5,\"out\":4}",
    "- Markers: add_marker, list_markers, update_marker, delete_marker (on a layer_id or a comp_id). Beats: beat_markers (topic audio).",
    "  add_marker {\"comp_id\":1,\"time\":4,\"comment\":\"Scene 2\"}",
    "- Comp length: trim_comp (to work_area or layers), or set_comp duration.",
    "- Swap a clip and keep its animation: replace_source. Group layers into a new comp: precompose.",
  ],
  audio: [
    "- Cut to music: beat_markers on the music layer (every: 2 = every other beat), then align_to_markers:",
    "  beat_markers {\"audio_layer_id\":3,\"every\":2}",
    "  align_to_markers {\"layer_ids\":[11,12,13],\"trim_to_next\":true}",
    "- Sound effects: find_sound_cues lists where the motion wants sounds (events: story moments with importance 0-1); add_sfx places the user's file so its loudest moment hits that time, 6-12 dB below the music:",
    "  find_sound_cues {\"comp_id\":1,\"density\":\"sparse\"}",
    "  add_sfx {\"comp_id\":1,\"path\":\"/absolute/path/whoosh.wav\",\"time\":1.2,\"volume\":-12}",
    "- Voice-over: duck_music lowers the music under every other audio layer (or under_layer_ids); dips make a short silence before a reveal:",
    "  duck_music {\"music_layer_id\":3,\"amount\":-8}",
    "  duck_music {\"music_layer_id\":3,\"dips\":[{\"start\":5.8,\"end\":6}]}",
    "- Fades: set_layer audio_fade (equal power), sequence_layers audio_crossfade between music cues. Levels: property alias volume (dB).",
    "  set_layer {\"layer_id\":3,\"audio_fade\":{\"in\":0.5,\"out\":2}}",
    "- Visuals driven by loudness: audio_react.",
    "  audio_react {\"audio_layer_id\":3,\"layer_ids\":[4],\"path\":\"scale\",\"from\":[100,100],\"to\":[115,115]}",
    "- Sound follows the story, not every cut: pass find_sound_cues events for the moments that matter (importance 0 mutes one); a big reveal can take a riser that peaks on it (add_sfx align peak, lead_in), a short silence just before it (duck_music dips) and one impact. Silence is a valid choice.",
    "- Delivery: render_start deliver (about -14 LUFS), only when the user asks for a render.",
  ],
  workarounds: [
    "For what ae-motion has no tool for: other ways to get it done. Pick the best route the client really has (check that a tool or program exists before relying on it), tell the user which route you are taking, and check the result (preview_frame) before saying it is done.",
    "Routes besides ae-motion's tools: other tools the client has (image, video, voice, music or sound generators; transcription), a shell with ffmpeg or Python, the user's own files, or a step the user does in After Effects. Files made elsewhere go in a folder ae-motion may read (by default the home or temp folder), then import_footage.",
    "- Media (photos, footage, voice, music, sound effects, icons): the user's files; a generator tool the client has; or make it. ffmpeg makes tones, noise whooshes, test clips and stills: `ffmpeg -f lavfi -i \"sine=frequency=880:duration=0.3\" pop.wav`, `ffmpeg -f lavfi -i \"anoisesrc=d=1:c=pink\" -af \"afade=t=in:d=0.5,afade=t=out:st=0.5:d=0.5\" whoosh.wav`, `ffmpeg -ss 1 -i clip.mp4 -frames:v 1 still.png`. Python can draw images. After Effects draws text, shapes and generated effects (Gradient Ramp, Fractal Noise).",
    "- Tracking: with a shell and OpenCV (`python3 -c \"import cv2\"` works), track the footage file and key a null parented to the footage layer with set_keyframes (t = frame / fps; positions in the footage's pixels, which is the parent's own space). Or the user tracks in After Effects, and the tools use the result (get_keyframes, copy_animation, link_layers).",
    "- Cutting out a subject: green or blue screen with a keying effect (find_effects \"key\"); a simple shape with an animated mask (set_keyframes on ADBE Mask Shape); a segmentation tool the client has, output as a PNG sequence with alpha (import_footage as sequence); or Roto Brush by the user.",
    "- Stabilizing: ffmpeg's deshake filter (`ffmpeg -i in.mp4 -vf deshake out.mp4`), or Warp Stabilizer by the user. Removing an object: cover it with a patch (duplicate_layer, add_mask, shift its position), or Content-Aware Fill by the user.",
    "- Gradient colours cannot be set by script (shape fills and strokes, the gradient_overlay style): use the Gradient Ramp effect (linear or radial, two colours) or 4-Color Gradient (ADBE 4ColorGradient):",
    "  apply_effect {\"layer_id\":4,\"match_name\":\"ADBE Ramp\",\"params\":{\"Start of Ramp\":[960,0],\"Start Color\":[0.1,0.12,0.3],\"End of Ramp\":[960,1080],\"End Color\":[0.02,0.02,0.05],\"Ramp Shape\":\"Radial Ramp\"}}",
    "- Speech for captions: a transcription tool the client has (or Whisper, if installed) gives words with times; then one add_layer text per line with in / out. Beats, peaks and loudness: the audio tools.",
    "- A closer look than preview_frame: extract stills from a video file with ffmpeg and view them, if the client can read images; render_start draft only when the user asked for a render.",
    "- Plugins that are not installed: rebuild the look from built-in effects (find_effects), or ask the user. Fonts: installed ones (find_fonts); ask the user to install another.",
    "- Undoing: change it back with the tools. Before a risky change to a saved project, save_project snapshot: true; open_project on that copy restores it exactly. Or the user presses Undo.",
    "- Essential Graphics (.mogrt), Media Encoder: no tool yet; render_start renders (deliver: an H.264 MP4).",
    "- Inside After Effects, for what no tool covers: run_jsx, if the user turned it on (AE_MCP_ALLOW_JSX=1).",
  ],
  "3d": [
    "Coordinates: x right, y down, z into the screen; a camera in front of the comp has negative z.",
    "- 3D layers: set_3d (position, z, rotation, orientation, scale, material; keys with time):",
    "  set_3d {\"layer_id\":4,\"rotation\":{\"y\":25},\"material\":{\"casts_shadows\":\"on\"}}",
    "- Camera: add_layer kind camera, then set_camera (lens by zoom, focal_length or fov; depth_of_field, focus_on_layer_id):",
    "  add_layer {\"comp_id\":1,\"kind\":\"camera\",\"options\":{\"name\":\"Cam\"}}",
    "  set_camera {\"layer_id\":20,\"focal_length\":50,\"depth_of_field\":true,\"focus_on_layer_id\":4}",
    "- Camera moves with editable keys: camera_move. Position and target moves need a two-node camera (set_camera two_node); combine adds to existing moves instead of replacing keys in range:",
    "  camera_move {\"layer_id\":20,\"type\":\"orbit\",\"degrees\":60,\"duration\":4,\"easing\":\"ease_in_out\"}",
    "  camera_move {\"layer_id\":20,\"type\":\"dolly\",\"distance\":300,\"start\":4,\"duration\":2}",
    "- Handheld: camera_shake. Controls to animate or parent to: camera_rig create.",
    "  camera_shake {\"layer_id\":20,\"amount\":6,\"frequency\":1.5}",
    "- Lights: add_layer kind light (light_type), then set_light (intensity %, cone, falloff, shadows):",
    "  add_layer {\"comp_id\":1,\"kind\":\"light\",\"options\":{\"light_type\":\"spot\",\"position\":[960,200,-600]}}",
    "  set_light {\"layer_id\":21,\"intensity\":120,\"casts_shadows\":true,\"shadow_diffusion\":30}",
    "- get_camera reads the lens and what drives each property. set_3d_view changes the viewer only (renders use the active camera).",
    "- 3D primitives (After Effects 26.3+): add_layer kind mesh with options.mesh.",
  ],
} as const;

/** Every topic the guide tool serves, in the order it lists them. */
export const TOPICS = ["tools", "workflow", "workarounds", "design", "motion", "text", "graphics", "properties", "edit", "audio", "3d"] as const;
export type Topic = (typeof TOPICS)[number];

/** What each topic covers, for the tools map's header. */
const ABOUT: Record<Exclude<Topic, "tools">, string> = {
  workflow: "build loop, batch, review, render",
  workarounds: "other ways to get done what ae-motion has no tool for: other tools, a shell, the user",
  design: "the design rules",
  motion: "animation tools",
  text: "type",
  graphics: "shapes, masks, mattes, styles, effects, layout",
  properties: "property paths and values",
  edit: "footage, cutting, timing, markers",
  audio: "music, sound effects, ducking",
  "3d": "3D layers, cameras, lights",
};

function toolsText(): string {
  const head = `Every ae-motion tool by job. Before using an area for the first time, read its topic (several in one call): ${(Object.keys(ABOUT) as (keyof typeof ABOUT)[]).map((t) => `${t} (${ABOUT[t]})`).join("; ")}. Their example calls are checked against the real schemas.`;
  return [head, ...TOOL_MAP.map(([area, rows]) => [`${area}:`, ...rows.map(([t, use]) => `- ${t}: ${use}`)].join("\n"))].join("\n");
}

/** The text of one topic. */
export function topicText(topic: Topic): string {
  if (topic === "tools") return toolsText();
  if (topic === "design") return DESIGN_RULES;
  return HOWTO[topic].join("\n");
}

/** The guide tool's reply: the topics asked for, each under a heading. */
export function guideText(topics: readonly Topic[]): string {
  return topics.map((t) => `# ${t}\n${topicText(t)}`).join("\n\n");
}

/** An example call in a topic: two spaces, a tool name, its JSON arguments. */
export const EXAMPLE = /^ {2}([a-z][a-z0-9_]*) (\{.*\})$/;

/** Whether guide has been called in this server process (get_project points to it until then). */
export const guideState = { read: false };
