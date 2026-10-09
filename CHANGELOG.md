# Changelog

All notable changes. Versions follow [semantic versioning](https://semver.org); each release is a git tag `vX.Y.Z`, which is what the update check looks for.

## 2.8.0 — 2026-10-09

### Added
- A `motion` tool group (part of `core`) for finished-looking motion in one call each:
  - `animate`: named entrance and exit moves (fade, pop, grow, slide, drop, spin) keyed from each layer's rest values, with snappy, smooth, spring, bounce or linear curves, stagger and order. Springs are closed-form step responses in an expression on linear keys, so they scrub and render identically and land exactly on the key.
  - `text_reveal`: per-character, word or line reveals (rise, drop, fade, pop, blur, typewriter) through a text animator and an expression selector, in forward, reverse, center or random order, optionally masked so letters rise from behind a line.
  - `transition`: wipe, staggered bars or iris shape transitions that cover the frame at the cut.
  - `review_motion`: a motion critic that needs no render: linear keys, dead holds, unison starts, entrances with no animation, cut-off moves, jumps, small text and beat sync.
- The `motion-guide` prompt has motion-craft rules (timing, overlap, beat pacing, what to avoid) and a review loop.

## 2.7.0 — 2026-10-09

### Added
- `duck_music`: lower the music under voice-over and sound effects, with eased attack and release; long layers duck only where they are heard. Ducks are "duck" markers on the music read by one expression, so its own volume keys keep working.

## 2.6.0 — 2026-10-09

### Added
- `find_sound_cues`: list where a comp's animation wants sound effects (whoosh at a move's peak speed, impact on abrupt landings, pop on scale pops, typing, swipe), from its keyframes.
- `add_sfx`: place a sound file so its loudest moment lands on a cue (or its start), with volume in dB, fades and trimming; repeated files are imported once.
- A `volume` property alias (audio levels in dB; a number sets both channels) for `set_property`, `set_keyframes` and `edit_keyframes`.

### Changed
- The audio tools (`beat_markers`, `audio_react` and the two above) are their own tool group, `audio` in `AE_MCP_TOOLSETS` (not part of `core`).

### Fixed
- The amplitude analysis left an "Audio Amplitude" solid in the project each time; its source item is now removed with it.

## 2.5.0 — 2026-10-09

### Added
- `beat_markers`: put markers on an audio layer's beats, detected from loudness (After Effects' Convert Audio to Keyframes) or from a BPM grid; returns the beat times and the tempo. With `align_to_markers` this cuts layers to the music.
- `audio_react`: drive any property of many layers with the music's loudness (pulse, bounce, glow), through one shared amplitude null.

## 2.4.1 — 2026-10-08

### Fixed
- **`add_layer`, `set_layer` and `set_text` were refused by the Claude API** (so Claude Code could not use them) since 2.1.0: their `box_size` / `solid_size` schemas used draft-07 tuple `items`, which is invalid under JSON Schema 2020-12 once the `$schema` header was dropped. Tuples are now advertised as a plain `items` schema, and the tests compile every tool schema as JSON Schema 2020-12.

## 2.4.0 — 2026-10-08

### Added
- `find_fonts`: search installed fonts by family, style or PostScript name (After Effects 24.0+).
- `add_layer` takes `text_style` (set_text's styling) and `anchor` (as set_anchor), applied before `position`: styled, centered text in one call instead of four.
- `set_expression` takes `layer_ids`: one shared expression on many layers in one call.

### Changed
- `batch` checks every step before running any and lists all problems at once; a bad argument no longer leaves a half-run batch.
- `set_text` (and `add_layer` `text_style`) refuse a font that is not installed instead of silently keeping the old one (After Effects 24.0+).

## 2.3.0 — 2026-10-08

### Added
- **Update button in the After Effects panel:** "Update to vX.Y.Z" (or "Reinstall") runs `git pull` and the installer, shows the output, loads the new host script and restarts the panel. The installers now write `install.json` (repo folder, and a PATH that finds git, node and npm, which After Effects started from the Dock cannot). A panel installed before 2.3.0 needs one manual update first.
- `load_tools`: with `AE_MCP_TOOLSETS` (e.g. `core`: about 7.5k tokens of tool definitions instead of 16k) the server adds the left-out tool groups during the session and tells the client (`tools/list_changed`); the new tools also run through `batch`. The README's Claude Desktop example uses `core`.

### Fixed
- `set_anchor`'s description named a wrong argument (`to`; it is `anchor`).

### Removed
- The MCP evaluation (`evals/`) and its fixture project.

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
