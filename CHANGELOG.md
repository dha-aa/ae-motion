# Changelog

All notable changes. Versions follow [semantic versioning](https://semver.org); each release is a git tag `vX.Y.Z`, which is what the update check looks for.

## 2.2.0 — 2026-10-08

### Added
- `batch`: run up to 50 tool calls in one call, with `"$N.path"` references to earlier results (`"$1.id"`). Each step is validated and sandboxed like a direct call. Building a scene takes a couple of calls instead of dozens, the largest token saving.
- `preview_frame` takes up to 9 times and returns them tiled into one contact sheet, and a `size` option.

### Changed
- `preview_frame` shrinks the image it returns (768 px on the longest edge by default; the full-size PNG stays on disk): about 440 tokens instead of 1,530 for a full HD frame, and six frames in one sheet about 670 instead of 9,200.
- Shorter results: tools that change layers return `{id, index, name}` (timeline tools and `duplicate_layer` add timing, `set_layer` the fields passed), `set_keyframes` returns `num_keys`, comp info and `list_properties` leave out defaults.
- Smaller tool list (about 16.9k tokens, from 21.8k in 2.1.0 and 25.9k in 2.0.0): shorter descriptions, refs inlined, numeric bounds left to validation, the shape spec referenced instead of repeated.

## 2.1.0 — 2026-10-08

### Added
- `open_project` opens an `.aep` (refuses to discard unsaved changes unless asked).
- Layer info reports `blend_mode` and `motion_blur`.
- `AE_MCP_TOOLSETS` loads only some tool groups, so the model gets fewer tool definitions (`core`: 38 tools, about half the tokens).
- An MCP evaluation (`evals/`): 10 read-only questions on a fixture project.

### Changed
- Lower token cost. Tool definitions are about 16% smaller (shorter shared descriptions, no per-tool `$schema`, the shape spec only where a shape is accepted). Typical results are about 35% smaller: layer and key info leave out default values (a missing flag means false, blend mode `NORMAL`, stretch 100, enabled, no parent), `set_text` reads back only the fields set, and `edit_keyframes` returns only the edited keys. Non-integer numbers are rounded to 6 significant digits.
- `run_jsx` is the tool of last resort: its description and the server instructions point to the dedicated tools first.

## 2.0.0 — 2026-10-07

**Breaking:** Node.js 22.18 or later is required (the build, tests and scripts run TypeScript directly).

### Added
- **Update notices:** the server checks GitHub for a newer release at most once a day (`AE_MCP_UPDATE_CHECK=0` turns it off); `get_project` carries an `update` note, `check_for_updates` asks directly, and the After Effects panel shows the installed version and an "update available" line.
- **Design tools:** `align_layers` (align and distribute by visible content), `set_anchor`, `add_shape` (dashes, caps, joins), `add_layer_style` (9 layer styles), `text_to_shapes`; `get_layer` reports bounds.
- **Keyframe editing:** `edit_keyframes` (single keys: value, easing, motion-path tangents, roving; move, delete), `copy_animation`; separate dimensions and auto-orient in `set_layer`.
- **Timeline editing:** `insert_time` (ripple insert), `align_to_markers` (cut to a beat), `update_marker`, `trim_comp`, `replace_source`; `delete_range` can move markers.
- **Paths and motion blur:** mask and shape paths can be keyframed (morphs); comp motion blur and frame blending switches.
- More `set_layer` switches: guide, adjustment, effects, audio, preserve transparency, solid color and size, frame blending, quality, collapse; `precompose` can leave attributes.
- `run-ae-motion` agent skill with a driver for running and testing against a live After Effects.

### Changed
- Strict input validation: unknown arguments are rejected instead of silently ignored.
- Every tool has a title and MCP annotations (read-only, destructive, idempotent, open-world).
- Results are compact JSON, capped at 25,000 characters with a hint to narrow the request.
- `stagger` and camera rigs keep easing and motion-path curves.
- Project restructured: server tools in `src/tools/`, ExtendScript in `host/` (built into `panel/host/host.jsx`), docs in `docs/`, CI on macOS, Linux and Windows.

### Fixed
- `add_property` treated the match name as a file path, so text animators could not be added.
- Rect-to-ellipse path morphs twisted; ellipse vertices now line up with rect corners.

## 1.0.0

Initial version: 52 tools for comps, layers, keyframes, text, masks, effects, 3D cameras and lights, preview frames and `aerender` renders.
