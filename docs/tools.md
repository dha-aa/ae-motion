# Tool reference

59 tools, grouped the same way as the source (`src/tools/<group>.ts` on the server, `host/commands/<group>.jsx` in After Effects). Every tool's full argument schema and description is served by the MCP `tools/list` call, so your client always sees the current details. This page gives the overview and the behavior you can't read off a schema.

## Conventions

- Time is in seconds, sizes in pixels, colors are `[r,g,b]` floats from 0 to 1, and scale is in percent.
- Comps, layers and project items are addressed by the numeric ids the tools return (`get_project`, `get_comp`).
- Properties are addressed by alias (`position`, `scale`, `rotation`, `opacity`, `anchor`) or by an array of match names and 1-based indexes, e.g. `["ADBE Effect Parade", "ADBE Gaussian Blur 2", "ADBE Gaussian Blur 2-0001"]`. Use `list_properties` to discover paths.
- Coordinates: x to the right, y **down**, z into the screen.
- Every mutating call is one undo step in After Effects. If a tool fails midway, its partial changes stay in that undo group, so undo once to revert.
- A good build loop: `get_project`, `create_comp`, `add_layer` (background first), `set_keyframes` with easing, `preview_frame` at key moments, adjust, then `render_start` and poll `render_status`. Prefer `set_keyframes` over many `set_property` calls, use `stagger` for repeated elements, and call `find_effects` rather than guessing effect match names.

## Tools

| Group | Tool | What it does |
|---|---|---|
| Inspect | `get_project` | Project items, active comp id, AE version, project path |
| | `get_comp` | Comp settings, work area, playhead time, marker count, and its layers |
| | `get_layer` | Transform values, effects, expressions, masks, track matte, marker count, layer flags |
| | `list_properties` | Walk a layer's property tree (names, match names, values, keyframe counts) |
| | `get_keyframes` | Read a property's keyframes: values, interpolation, temporal ease, expression |
| | `find_effects` | Search installed effects by name, match name or category |
| Project | `save_project` | Save, or Save As to a path (needed before `render_start`) |
| | `create_comp` | Create a composition and open it |
| | `set_comp` | Change a comp's name, size, fps, duration, background, pixel aspect, work area, or motion blur (switch, shutter angle, phase) |
| | `import_footage` | Import a file or image sequence |
| | `delete_item` | Delete a comp, footage item or folder (refuses used items unless `force`) |
| Layers | `add_layer` | Add a solid, text (point or box), shape (rect, ellipse, star, polygon, path), null, adjustment, footage, precomp, camera or light layer; optional `position` and `three_d` place it as it is created |
| | `set_layer` | Name, timing, time stretch, parent, blend mode, visibility, 3D, shy, solo, lock, label, motion blur, time remap, separate dimensions, auto-orient along path, frame blending, quality, collapse transformations |
| | `replace_source` | Swap the footage, comp or solid a layer shows, keeping its timing, keyframes and effects |
| | `link_layers` | Parent several layers to a layer, unlink them, or create a null and parent them all to it in one call |
| | `delete_layer` | Remove a layer |
| | `duplicate_layer` | Duplicate a layer, optionally several offset copies |
| | `reorder_layer` | Move a layer to the top, bottom, up, down, an index, or before/after another layer |
| | `precompose` | Precompose layers from one comp |
| Timeline | `split_layer` | Split layers at a time (Cmd/Ctrl+Shift+D) |
| | `delete_range` | Cut a time range out of the comp, with ripple or lift (optionally rippling comp markers) |
| | `insert_time` | Ripple insert: open a gap, splitting layers that span it, optionally moving comp markers |
| | `shift_layers` | Move layers in time |
| | `sequence_layers` | Place layers end to end, with optional overlap |
| | `align_to_markers` | Start layers on consecutive comp or layer markers, optionally trimming each at the next (cut to a beat) |
| | `trim_comp` | Trim the comp to its work area or to its layers |
| | `set_playhead` | Move the current-time indicator |
| | `add_marker`, `update_marker`, `list_markers`, `delete_marker` | Layer and comp markers with comment, duration, chapter, url, label; edit or move one in place |
| Masks and mattes | `add_mask` | Add a rect, ellipse, polygon or bezier-path mask with mode, feather, opacity, expansion |
| | `set_track_matte` | Use a layer as an alpha or luma track matte, or remove the matte |
| Animate | `set_property` | Set a value, or a keyframe at `time` |
| | `set_keyframes` | Replace all keyframes on a property, with interpolation and easing; also path keyframes (mask and shape morphs) |
| | `edit_keyframes` | Edit single keys: add or update (value, easing, curved motion-path tangents, auto-bezier, roving), move, delete |
| | `copy_animation` | Copy a property's animation, with every key setting and any expression, to other layers, with offset and stagger |
| | `set_expression` | Set or clear an expression and report syntax errors |
| | `add_property` | Add a text animator, its properties and range selector (layer styles cannot be created by scripts) |
| | `apply_effect` | Add an effect by match name and set its parameters |
| | `edit_effect` | Remove, enable or disable an effect |
| | `apply_preset` | Apply an `.ffx` animation preset |
| | `set_text` | Text content and full styling: font, size, fill and stroke, leading, tracking, scale, caps, super/subscript, indents, spacing, justification, box size; reads values back |
| | `get_text` | Read a text layer's content and styling |
| | `stagger` | Offset existing keyframes across layers (keeps easing and path curves) |
| | `add_shape_modifier` | Add Trim Paths, Repeater or Round Corners to a shape group |
| 3D and camera | `get_camera` | Read a camera: lens (zoom, focal length, field of view), depth of field, iris, position, point of interest, and what drives each property |
| | `set_camera` | Lens, depth of field, focus, iris, one-node or two-node, position, point of interest, rotation, look at a layer |
| | `camera_move` | Keyframed moves: dolly, truck, pedestal, crane, pan, tilt, roll, orbit, zoom, rack focus, or a path through waypoints |
| | `camera_shake` | Handheld shake on position, aim or roll (wiggle expressions), removable |
| | `camera_rig` | Create or remove a rig: two 3D null controls (position and target) that drive the camera |
| | `set_3d` | Make a layer 3D; set position, rotation, orientation, scale and material options (shadows, shininess, metal) |
| | `set_light` | Light type, intensity, color, cone, falloff, shadows, and placement |
| | `set_3d_view` | Switch the viewer's 3D view: active camera, default, front, left, top, back, right, bottom, custom 1 to 3 |
| Preview and render | `preview_frame` | Render one frame to PNG and return it as an image |
| | `render_start` | Save the project and start a background `aerender` job |
| | `render_status` | State, percent, log tail and the file actually written |
| | `render_cancel` | Cancel a running render job |
| Escape hatch | `run_jsx` | Run arbitrary ExtendScript (disabled unless `AE_MCP_ALLOW_JSX=1`) |

Resources: `ae://project` (same as `get_project`) and `ae://selection` (layers selected in the active comp). Prompt: `motion-guide`.

Every tool has a title and the four MCP annotations: `readOnlyHint` (inspection, preview, render status), `destructiveHint` (false only for purely additive tools such as `create_comp`, `add_layer`, `add_marker`), `idempotentHint` (the `set_*` tools and deletes by id) and `openWorldHint` (only `run_jsx`). Clients can use them to skip confirmation for safe calls.

## Input and output rules

- **Unknown arguments are rejected**, at any depth: `set_layer` with `colour` fails with `Unrecognized key(s) in object: 'colour'` instead of silently ignoring it. Schema errors come back as plain text (`MCP error -32602: Input validation error: ...`) and never reach After Effects.
- **Results are compact JSON** (no indentation).
- **Responses are capped at 25,000 characters.** A bigger result is replaced by a `BAD_ARGS` error that says how to ask for less; for `list_properties`, pass `group_path` and/or a smaller `depth`.

## Keyframe editing

- **Whole property vs single keys:** `set_keyframes` replaces every key on a property; `edit_keyframes` changes individual keys and leaves the rest alone. Edits run in order and address a key by `t` (matched within half a frame) or `index` (from `get_keyframes`).
- **Curved motion paths:** on spatial properties (position, anchor point, point of interest) `set` takes `spatial_in` / `spatial_out` tangents relative to the key, e.g. `{action: "set", t: 1, spatial_in: [-120, 0], spatial_out: [120, 0]}` bends the path through that key. `auto_bezier` and `continuous` switch After Effects' own smoothing. `get_keyframes` reports the same fields, so keys can be read, tweaked and written back.
- **Roving keys** (`roving: true`) let After Effects pick the key's time for an even speed along the path; it re-times the key whenever its neighbours change. The first and last keys cannot rove.
- **Moving a key** (`{action: "move", t: 2, to: 2.5}`) keeps its value, easing and tangents; it refuses to land on another key.
- **Separate dimensions:** `set_layer` `separate_dimensions: true` splits position into `x_position`, `y_position` (and `z_position`), each with its own keys and easing; this is the usual way to make bounces.
- **Auto-orient:** `set_layer` `auto_orient: "path"` rotates the layer along its motion path.
- **Reusing animation:** `copy_animation` copies one property's keys, with every setting and any expression, to other layers; `stagger_seconds` offsets each target a little more. `stagger` shifts existing keys across layers and keeps every key setting.

## Paths and motion blur

- **Path properties** (a mask's `ADBE Mask Shape`, a shape layer's `ADBE Vector Shape`) take a *shape spec* as their value in `set_property` and `set_keyframes`, in the same format as `add_mask`: `{type: "rect" | "ellipse", position?, size?}` (default: the full layer), `{type: "polygon", points}`, or `{type: "path", vertices, in_tangents?, out_tangents?, closed?}`. `get_keyframes` returns path keys as `{type: "path", ...}`, which can be written back unchanged.
- **Morphs:** keep the vertex count the same across keys. Rects and ellipses both have 4 vertices starting at the top-left, so a rect keyframe morphs into an ellipse keyframe without twisting. Example: `set_keyframes` on `["ADBE Mask Parade", 1, "ADBE Mask Shape"]` with `{t: 0, v: {type: "rect"}}` and `{t: 1, v: {type: "ellipse"}}`. The path of a shape layer created by `add_layer` is at `["ADBE Root Vectors Group", 1, "ADBE Vectors Group", 1, "ADBE Vector Shape"]`.
- **Motion blur** needs both switches: `set_layer` `motion_blur: true` on the layer and `set_comp` `motion_blur: true` on the comp. `shutter_angle` (default 180) sets the blur length; 360 is a long, smooth blur.

## Timeline editing

The timeline tools work like the editing commands in the After Effects timeline. All times are comp seconds and snap to whole frames unless a tool has `snap: false`.

- **Cut:** `split_layer` splits one or more layers at a time, like Cmd/Ctrl+Shift+D. The first part stays on the original layer; a copy above it holds the second part.
- **Remove a section:** `delete_range` takes out `start` to `end`. Layers inside the range are deleted, layers crossing an edge are trimmed, and layers spanning the range are split with the middle removed. With `ripple` (the default) later material moves earlier to close the gap; `ripple: false` leaves the gap. `shorten_comp` also shortens the comp when rippling, and `move_markers` deletes comp markers inside the range and pulls later ones in.
- **Make room:** `insert_time` is the reverse: it opens a gap of `duration` at `at`, moving later layers and splitting layers that span the point, lengthens the comp (`extend_comp`, default on) and with `move_markers` moves later comp markers too.
- **Cut to a beat:** put markers on the beats (`add_marker`, or use an audio layer's markers with `marker_layer_id`), then `align_to_markers` starts layer *i* on marker *i*; `trim_to_next` ends each layer at the following marker.
- **Swap shots:** `replace_source` changes what a layer shows without touching its timing, keyframes or effects.
- **Tidy up:** `trim_comp` with `to: work_area` (like Composition > Trim Comp to Work Area) or `to: layers` moves everything so the range starts at 0 and sets the duration to it.
- **Arrange:** `shift_layers` moves layers in time, `sequence_layers` places them end to end (with optional `overlap`), and `reorder_layer` changes stacking order.
- **Navigate and mark:** `set_playhead` moves the current-time indicator; `add_marker`, `update_marker`, `list_markers` and `delete_marker` manage layer and comp markers; `set_comp` can set the work area.
- **Speed changes:** time stretch (`set_layer stretch`, 200 = half speed) or time remapping, plus `frame_blending: "pixel_motion"` (or `frame_mix`) for smooth slow motion. Like motion blur, frame blending also needs the comp switch: `set_comp frame_blending: true`.

## 3D cameras

The camera tools use After Effects' coordinates: x to the right, y **down**, z into the screen, so a camera in front of the comp has a negative z and "up" on screen is a negative y. Most moves need a two-node camera (one with a point of interest, which is what `add_layer` creates by default).

- **Set up:** `set_camera` takes the lens as `zoom` (px), `focal_length` (mm, on a 36 mm film width) or `fov` (horizontal degrees), plus depth of field, focus distance (or `focus_on_layer_id`), aperture, blur level and the iris controls. `look_at_layer_id` aims the camera at a layer; with `follow: true` it keeps following. `get_camera` reads it all back.
- **Move:** `camera_move` makes keyframes you can edit afterwards. `dolly` goes toward or away from the target, `truck` and `pedestal` slide the camera and target together, `crane` lifts the camera while it keeps looking at the target, `pan` and `tilt` turn the point of interest, `roll` rolls, `orbit` circles a target (`degrees` to the right, `vertical_degrees` up), `zoom` changes the lens, `rack_focus` pulls focus to a distance or a layer, and `path` flies through waypoints. Every move has a `start`, `duration` and `easing`, begins from the camera's value at `start`, and replaces keyframes inside its own time range.
- **Rig and shake:** `camera_rig create` adds two 3D null controls linked to the camera by expressions, so one layer drives the whole move; `camera_move` then keys the controls for you. `camera_shake` adds handheld shake with wiggle expressions on top of any keyframes. Both are removable.
- **3D layers and lights:** `set_3d` turns a layer 3D and sets its transform and material; `set_light` edits lights.

## Behavior notes

- Commands run one at a time in After Effects. A call that takes longer than 30 seconds (60 for `preview_frame`) returns `TIMEOUT` but may still finish in AE, so inspect the project before retrying.
- `render_start` saves the project and runs `aerender` in the background. The project must have been saved at least once. If the output file already exists you must pass `overwrite: true`; the old file is only removed once the render is about to start, so a failed start keeps it. After Effects takes the file extension from the output module, so the file can differ from `output_path` (on After Effects 26.3 the default output module turned a `.mov` request into `.mp4`); `render_status` reports the file that was actually written. For a specific format, name an output-module template in `om_template`. Canceling a render can leave a partial temp file next to the output.
- Running renders are stopped when the MCP client disconnects or the server is terminated. Job state is kept in memory, so restarting the server forgets old job ids.
- `preview_frame` uses `comp.saveFrameToPng`; on versions without it you get `UNSUPPORTED`. After Effects can keep writing the PNG for a moment after it returns (heavy 3D frames), so the server waits up to 10 seconds for the file. PNGs are written to `<temp>/ae-motion-mcp/`.
- `split_layer`, `delete_range` and `insert_time` check everything first where they can, and skip or refuse locked layers (`trim_comp` moves locked layers too and re-locks them). Layer markers always move with their layer; comp markers move only with `move_markers`.
- A layer used as a track matte is hidden by After Effects (its `enabled` flag becomes false), as in the timeline UI, and stays hidden after the matte is removed (turn it back on with `set_layer` `enabled: true`).
- `set_track_matte` uses `setTrackMatte` on After Effects 23 and later. Older versions need the matte layer directly above the target (use `reorder_layer`).
- `delete_item` refuses items that are used in comps, or non-empty folders, unless `force` is true.
- `link_layers` keeps each layer where it is on screen when you link or unlink it. `jump: true` keeps the layer's own values instead, so it moves by the parent's offset. With `new_null` the null goes at the average of the layers' position values (stacked above the top-most one), and it is 3D if any of them is. A self-link, a cycle, a locked layer or mixed comps are refused before anything changes.
- `set_3d_view` runs After Effects' own View > Switch 3D View command. It only changes what the editor shows: `preview_frame` and renders always use the active camera. Running it clears the layer selection and cannot be undone from a script. `active_camera` needs a camera in the comp (the menu item is named after it).
- Camera rigs, shake and look-at are expressions with a marker comment on the first line (`// ae-motion rig`, `// ae-motion shake`, `// ae-motion look-at`). `camera_move` keys a rig's controls, works underneath a shake, and refuses any other expression on position or point of interest. Do not rename a rig's control layers.
- Focal length assumes a 36 mm film width, so `focal_length` and `fov` are converted to zoom pixels using the comp width.
- `set_text` styling applies to the whole layer; anything After Effects refuses is listed in `skipped` instead of failing the call. Point text cannot be turned into box text after creation (create it with `add_layer` `options.box_size`).

## Errors

Every error is returned as `{"error": {"code", "message", "hint"}}` with `isError: true`.

| Code | Meaning |
|---|---|
| `NOT_FOUND` | An id, file, property, marker or render job does not exist |
| `BAD_ARGS` | The arguments are invalid for the current project state |
| `AE_ERROR` | After Effects threw, or something unexpected failed (the hint names the ExtendScript line) |
| `BRIDGE_DOWN` | The panel is not reachable: closed, stale token, or After Effects not running |
| `TIMEOUT` | No reply in time; the command may still finish in After Effects |
| `FORBIDDEN` | A path outside `AE_MCP_ALLOWED_DIRS`, or `run_jsx` while disabled |
| `UNSUPPORTED` | This After Effects version lacks the feature |
| `EXISTS` | Refusing to overwrite an existing file without `overwrite: true` |
