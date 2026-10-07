# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

An MCP server that lets an MCP client (Claude Code, Claude Desktop) control a live Adobe After Effects project: build comps, add/animate layers, preview frames and render — all through tools that end up calling ExtendScript inside AE.

```
MCP client --stdio--> MCP server (src/, TypeScript) --HTTP 127.0.0.1 + token--> CEP panel in AE (panel/main.js) --cep.evalScript--> ExtendScript (host/ -> panel/host/host.jsx)
```

Full docs: `docs/architecture.md` (layout, protocol, lifecycle), `docs/tools.md` (tool reference), `docs/development.md` (adding a tool, quirks, tests).

## Commands

```bash
npm install
npm run build       # clean; host/ -> panel/host/host.jsx (scripts/build-host.ts); src/ -> dist/ (tsc)
npm test            # build, then run everything in test/ (no After Effects needed)
npm run typecheck   # tsc --noEmit (src/) + tsc -p tsconfig.tools.json (scripts/, test/, the skill driver)
```

Tests, `scripts/` and the skill driver are TypeScript that Node (22.18+) runs directly via type stripping: erasable syntax only (no enum/namespace/parameter properties), `.ts` import extensions, `import type` for types. The `test/mock-*.test.ts` files are `// @ts-nocheck` (loose AE fakes); the rest are strictly typed. There is no lint command and no single-test runner. `npm test` runs `test/run-all.ts`; run one file with `node test/<file>` after `npm run build`:
1. `static-checks.ts` — generated `host.jsx` is current and parses; ES3 lint of `host/` (reports `host/<file>:<line>`); boots `dist/index.js` and diffs `tools/list` against the `C.<name> = function` commands. `EXPECTED_TOOLS` must match the tool count.
2. `mock-host.test.ts` — layer/timeline/comp/marker commands (incl. insert_time, align_to_markers, trim_comp, update_marker, replace_source) against a mock AE DOM.
3. `mock-camera.test.ts` — camera maths, rigs, shake, lights, 3D layers, linking, 3D views against a mock DOM.
4. `mock-shapes.test.ts` — path (shape) values for masks/shape layers, ellipse vertex order, comp motion blur.
5. `mock-design.test.ts` — bounds/align/distribute maths, anchors, switches, solids, precompose leave-attributes, style/shape validation.
6. `mock-keyframes.test.ts` — edit_keyframes, copy_animation, stagger fidelity, separate dimensions, auto-orient (models the ease/bezier and roving quirks).
7. `aerender-discovery.test.ts` — `findAerender` (`dist/render/aerender.js`) against fake install layouts.
8. `server.test.ts` — the built server over stdio with a fake bridge and fake `aerender`: render lifecycle, preview wait, path sandboxing, run_jsx gate.

## Layout

- `src/index.ts` entry (stdio, shutdown) · `src/server.ts` `createServer(bridge)` · `src/config.ts` every env var + version · `src/errors.ts` `ErrorCode`, `AeToolError` · `src/bridge.ts` `Bridge` + `HttpBridge` · `src/sandbox.ts` · `src/resources.ts` · `src/prompts.ts`
- `src/tools/registry.ts` — `ToolRegistry.bridged(name, desc, shape, { paths?, readOnly?, destructive?, idempotent?, openWorld?, tooLargeHint? })` (validate, sandbox `paths`, forward to the host command of the same name) and `ToolRegistry.tool(...)` for server-side logic. It makes every input schema strict at all depths (unknown keys rejected), adds a title + all four MCP annotations (non-read-only tools default to destructive), returns compact JSON and replaces results over `CHARACTER_LIMIT` (25k chars) with an error. `src/tools/schemas.ts` shared zod schemas.
- `src/tools/<group>.ts` ↔ `host/commands/<group>.jsx`: inspect, project, layers, timeline (+markers), masks, animate (+`text.jsx`), scene3d, design (align, anchors, add_shape, layer styles, text to shapes), output (preview/render), scripting (run_jsx).
- `src/render/aerender.ts` (find aerender / written file), `src/render/manager.ts` (`RenderManager`).
- `host/*.ts` (pilot: `core/layout.ts`, `commands/design.ts`) are TypeScript compiled by `tsc -p tsconfig.host.json` to `build/host/` against AE 22.0 + ES3 lib types (`types-for-adobe`); the rest of `host/` is `.jsx`. Script mode: all top-level names are global and shared (type names merge with AE/ScriptUI globals, so prefix them); `.jsx` helpers used from `.ts` get JSDoc types (`fail` returns never). Details in `docs/development.md`.
- `host/` — ExtendScript sources: `json.jsx` polyfill, `core/` helpers, `commands/`, `dispatch.jsx`. `scripts/build-host.ts` wraps them in one closure (`var AEM = (function () { var C = {}; ... })()`) and writes `panel/host/host.jsx`, which is **generated and gitignored — never edit it**. New host files go in `MODULES` in the build script; top-level names must be unique across `host/` (the build checks).
- `panel/` — the CEP extension as installed (manifest, `main.js` HTTP bridge with serial queue, `index.html`).

## Versions and updates

- One version in `package.json` and `panel/CSXS/manifest.xml` (two places); the build stamps it into host.jsx as `AEM.version`; `test/static-checks.ts` enforces all three. Releases are git tags `vX.Y.Z` plus a `CHANGELOG.md` entry (`docs/development.md` → Releasing).
- `src/update.ts`: daily background check of GitHub's tags API (`AE_MCP_UPDATE_CHECK=0` off, `AE_MCP_UPDATE_URL` override), cached in `update.json` next to the bridge file; `get_project` adds an `update` note, `check_for_updates` (server-only tool) asks directly, the panel reads the cache and shows an update line. Tests keep the check off by default (no real network).

## Rules

- **Adding a tool touches both ends**: register it in `src/tools/<group>.ts` and implement `C.<name>` in `host/commands/<group>.jsx`; bump `EXPECTED_TOOLS`; add it to `docs/tools.md` and the README group table. Step by step: `docs/development.md`.
- **`host/` must stay ES3**: no arrow functions, `let`/`const`, template literals, spread, or ES5+ array/string methods (`forEach`, `map`, `.includes`, `.trim`, `Object.keys`...). No `Array.prototype.indexOf`. The lint scans comments too (backticks, `...`). Don't type ` `/` ` escapes with the Write tool — it has turned them into raw characters; the lint catches that.
- **Paths**: only arguments listed in `paths` are sandboxed (`assertAllowed` against `AE_MCP_ALLOWED_DIRS`, default home + temp) and slash-normalised (`toAe`). List every path argument there, and nothing that isn't a path (a match name was once sandboxed by mistake).
- **Errors**: always `{error:{code,message,hint}}` with `code` one of `NOT_FOUND`, `BAD_ARGS`, `AE_ERROR`, `BRIDGE_DOWN`, `TIMEOUT`, `FORBIDDEN`, `UNSUPPORTED`, `EXISTS`. Throw `AeToolError` in TypeScript, `fail(code, message, hint)` in ExtendScript.
- **Undo**: every mutating command runs in one undo group (`host/dispatch.jsx`); read-only commands are listed in `READONLY` there.
- Conventions for tools: time in seconds, sizes in pixels, colors `[r,g,b]` 0–1, scale in percent; comps/layers by numeric id; properties by alias (`position|scale|rotation|opacity|anchor`) or match-name arrays.
- Changes to `host/` or `panel/` need `npm run build` **and** the installer re-run (`scripts/install.sh` / `.ps1`) plus reopening the panel. `host/` is the first place to look when a tool behaves differently on another AE version.

## After Effects quirks (found in live testing)

- Setting `inPoint` also moves `outPoint` (layer keeps its length): use `setIn(layer, t)` (`host/core/timing.jsx`). Assigning `outPoint` alone is safe.
- Changing `startTime` moves in/out with it; `shiftLayer` relies on that but still checks.
- Using a layer as a track matte hides it (`enabled` becomes false).
- `app.path` is a Folder: use `app.path.fsName` (`appDir()`); `new Folder(app.path)` gives a bogus temp path.
- `aerender` takes the extension from the output module (`.mov` request → `.mp4`); `render_status` finds the real file.
- Snap time changes to whole frames (`snapT`).
- Coordinates: x right, y DOWN, z into the screen; a camera in front of the comp has negative z. `yaw`, `elevate`, `rightOf` rely on this.
- Camera expressions we add are marked on line 1: `// ae-motion rig`, `// ae-motion shake`, `// ae-motion look-at`. `keyTarget` keys a rig's controls, lets keys sit under a shake, refuses other expressions.
- Lens maths assumes 36 mm film width: zoom px = focal length × comp width / 36.
- `addCamera`/`addLight` leave x,y at 0 even with a center; `centerLayer` fixes it.
- `layer.parent = x` (and `= null`) keeps the layer in place on screen; `setParentWithJump` keeps its values. `link_layers` uses the first unless `jump: true`.
- 3D views: `app.findMenuCommandId(<menu item>)` + `app.executeCommand`; the active camera item is `Active Camera (<camera name>)`. Running one clears the selection. Verify new names against View > Switch 3D View.
- `saveFrameToPng` can return before the PNG is written; `preview_frame` waits for it to stop growing.
- Removing every time-remap key turns time remapping off; `set_keyframes` adds new keys first.
- Path keyframes morph vertex i into vertex i. `boxShape` puts ellipse vertices on the diagonals, matching a rect's corners (top-left first, clockwise), so rect <-> ellipse morphs don't twist; AE's own ellipses start at the top and would.
- A layer's motion blur switch does nothing until the comp's `motionBlur` is on too (`set_comp motion_blur`); frame blending likewise needs `comp.frameBlending` (`set_comp frame_blending`).
- A `MarkerValue` from `keyValue` is a copy: change it, then write it back with `setValueAtTime` (`update_marker`).
- `moveTo()` on a property invalidates that object, and menu commands can invalidate held references: read first, re-fetch after.
- Menu commands act on the selection in the viewer (`selectOnly`); names are localized, so `findMenuCommandId(name) || id` (Create Shapes from Text 3781, Layer Styles 9000-9008: drop shadow, inner shadow, outer glow, inner glow, bevel, satin, color overlay, gradient overlay, stroke).
- Gradient colors can't be set by script. First stroke dash lists all 3 pairs (unused ones don't render, can't be removed). Leave-attributes precompose needs one layer with a source.
- Mock tests: arrays created outside the vm context fail the host's `instanceof Array`; build them in the context (`inner()` in mock-design).
- Setting a key's temporal ease switches it to bezier: restore ease first, interpolation type last (`restoreKey`).
- Roving keys re-time whenever other keys change; `replaceKeys` un-roves first and re-applies roving at the end, or old keys can't be found and get duplicated. Copy/move keys with `snapKey`/`restoreKey`/`replaceKeys` (`host/core/keys.jsx`) so no key setting is lost.
- Layer ids / `project.layerByID` exist from AE 22.0 (manifest minimum); `getLayer` uses `layerByID` only, so mocks must define it.
- The mock in `test/mock-host.test.ts` models the first two quirks; keep mocks in sync when you find another.

## Verification status

Every tool was checked by hand against real AE (26.3, macOS), camera move directions confirmed from rendered pixels. Gaps: adjustment layers, `set_layer` blend mode, running code through `run_jsx`, the Windows installer. The restructure into `src/tools/` + `host/` was verified by tests, an identical `tools/list`, and a function-level diff of the generated `host.jsx`, then smoke-tested live in AE 26.3 (all but render_start). A green `npm test` doesn't prove a change works in real AE.
