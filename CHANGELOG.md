# Changelog

All notable changes. Versions follow [semantic versioning](https://semver.org); each release is a git tag `vX.Y.Z`, which is what the update check looks for.

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
