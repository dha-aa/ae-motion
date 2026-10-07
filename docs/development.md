# Development

## Setup and commands

```bash
npm install
npm run build        # clean, then build panel/host/host.jsx (from host/) and dist/ (from src/)
npm test             # build, then run every test in test/ (no After Effects needed)
npm run typecheck    # tsc --noEmit
npm start            # run the server on stdio (normally your MCP client launches it)
```

| Script | Does |
|---|---|
| `build:host` | `node scripts/build-host.mjs`: concatenate `host/` into `panel/host/host.jsx` |
| `build:server` | `tsc`: compile `src/` into `dist/` |
| `clean` | remove `dist/` |

What a change needs before you can see it in After Effects:

| You changed | Then |
|---|---|
| `src/` | `npm run build`, restart the MCP server from your client |
| `host/` or `panel/` | `npm run build`, re-run the installer (copies `panel/` into the CEP folder), close and reopen the panel |

`panel/host/host.jsx` is generated and gitignored. Edit the files in `host/`, never the generated file.

## Adding a tool

A tool has two halves with the same name: a schema on the server and a command in After Effects. As an example, a `set_layer_color` tool:

1. **Server**: register it in the matching `src/tools/<group>.ts`:

   ```ts
   r.bridged(
     "set_layer_color",
     "Set a layer's label color (0-16).",
     { layer_id: id("Layer"), label: Label },
   );
   ```

   - Use the shared schemas from `src/tools/schemas.ts` (`id`, `Color`, `V3`, `PropPath`, `Time`, ...).
   - Any argument that is a filesystem path must be listed in `{ paths: ["..."] }`, so it is sandboxed and slash-normalised. Never list anything that isn't a path.
   - Set the annotations in the options: `readOnly: true` if it changes nothing; otherwise it defaults to destructive and non-idempotent, so pass `destructive: false` for purely additive tools and `idempotent: true` when repeating the call changes nothing more. Add a `tooLargeHint` if the result can get big. `title` is derived from the name.
   - Nested `z.object`s need nothing special: the registry makes every object strict (unknown keys rejected).
   - Use `r.tool(...)` instead only when the server must do real work (see `src/tools/output.ts`).
   - Write the description for the model: what the tool does, units, defaults, and what it refuses.

2. **Host**: add `C.set_layer_color` to the matching `host/commands/<group>.jsx`:

   ```js
   C.set_layer_color = function (a) {
     need(a, ["layer_id", "label"]);
     var l = getLayer(a.layer_id);
     if (a.label < 0 || a.label > 16) fail("BAD_ARGS", "label must be 0 to 16");
     l.label = a.label;
     return layerInfo(l);
   };
   ```

   - **ES3 only** (see below). Validate before you change anything.
   - Raise errors with `fail(code, message, hint)`; give a hint that tells the model what to do next.
   - Return plain JSON (copy After Effects arrays with `copyArr`).
   - If the command changes nothing undoable, add it to `READONLY` in `host/dispatch.jsx`.
   - A new host file must be added to `MODULES` in `scripts/build-host.mjs`. Top-level names must be unique across `host/`; the build fails on a duplicate.

3. **Tests**: bump `EXPECTED_TOOLS` in `test/static-checks.mjs`, and add logic tests to `test/mock-host.test.mjs` or `test/mock-camera.test.mjs` when the command has real logic.

4. **Docs**: add the tool to the table in `docs/tools.md` and the group list in `README.md`.

5. **Verify in real After Effects.** The mocks only model behavior already seen in AE. Note anything surprising under [After Effects quirks](#after-effects-quirks).

`npm test` fails if the server's tool list and the host's commands drift apart.

## ExtendScript rules

After Effects runs `host.jsx` in ExtendScript, an ES3 engine:

- No `let`/`const`, arrow functions, template literals, spread, destructuring or classes.
- No ES5+ helpers: `forEach`, `map`, `filter`, `reduce`, `some`, `every`, `Object.keys`, `Array.isArray`, `.trim()`, `.includes()`, `.startsWith()`, `.endsWith()`, `.padStart()`, `.repeat()`.
- No `Array.prototype.indexOf`. `String.prototype.indexOf` is fine; the static check lists every `indexOf` so you can confirm each one is on a string.
- No built-in `JSON`; `host/json.jsx` provides `JSON.stringify` and `JSON.parse`.
- Declare all `var`s at the top of the function. Function-scoped `var` is the only scope there is.

`test/static-checks.mjs` lints `host/` for these, comments included, and reports `host/<file>:<line>`.

## After Effects quirks

Found in live testing; the code relies on all of these.

- Setting a layer's `inPoint` also moves its `outPoint` (the layer keeps its length). Use `setIn(layer, t)` (`host/core/timing.jsx`), which puts `outPoint` back. Assigning `outPoint` on its own is safe.
- Changing `startTime` moves the in and out points with it. `shiftLayer` relies on that but still checks.
- Using a layer as a track matte hides it (`enabled` becomes false).
- `app.path` is a Folder object, not a string: use `app.path.fsName` (`appDir()`). `new Folder(app.path)` gives a bogus temp path.
- `aerender` takes the output file's extension from the output module, so the written file can differ from `-output` (a `.mov` request became `.mp4`). `render_status` looks for the real file once the job is done.
- Time changes should snap to whole frames (`snapT`); several tools rely on exact frame boundaries.
- Coordinates are x right, y down, z into the screen: a camera in front of the comp has negative z, and up on screen is negative y. The camera helpers (`yaw`, `elevate`, `rightOf` in `host/core/vector.jsx`) rely on this.
- Rig, shake and look-at expressions are marked on their first line: `// ae-motion rig`, `// ae-motion shake`, `// ae-motion look-at`. `keyTarget` sends keyframes to a rig's control layers, lets keys sit under a shake, and refuses any other expression.
- Lens maths assumes a 36 mm film width: zoom px = focal length × comp width / 36.
- `addCamera` and `addLight` leave x and y at 0 even when given a center; `centerLayer` puts them over the comp center.
- `layer.parent = x` keeps the layer where it is on screen (After Effects compensates its position), and `parent = null` does too. `setParentWithJump` keeps the layer's own values, so the layer moves by the parent's offset.
- 3D views are run with `app.findMenuCommandId(<menu item>)` + `app.executeCommand`. The active camera item is named `Active Camera (<camera layer name>)`; a plain "Active Camera" is not found. Running a view command clears the layer selection. Check a new menu name against View > Switch 3D View before adding it.
- `saveFrameToPng` can return before the PNG is fully written (heavy 3D frames); `preview_frame` waits for the file to appear and stop growing.
- Setting keyframes on time remapping: removing every key switches time remapping off, so `set_keyframes` adds the new keys before removing the old ones.
- Layer ids and `project.layerByID` exist from After Effects 22.0, the manifest's minimum version.
- Setting a key's temporal ease switches it to bezier, so `restoreKey` sets the ease first and the interpolation type last.
- Roving keys re-time themselves whenever any other key changes, so code that rewrites keys (`replaceKeys`) turns roving off first and restores it at the end. After Effects may also rescale a roving key's tangents.

`test/mock-host.test.mjs` models the first two; keep the mocks in sync when you find another.

## Tests

`npm test` runs `test/run-all.mjs`, which runs each file below and fails if any fails. Run one directly with `node test/<file>` after `npm run build`.

| File | Checks |
|---|---|
| `static-checks.mjs` | `host.jsx` is up to date and parses; ES3 lint of `host/`; `tools/list` matches the host commands; `EXPECTED_TOOLS` |
| `mock-host.test.mjs` | Layer, timeline, comp, marker and item commands against a fake After Effects DOM |
| `mock-camera.test.mjs` | Camera maths, moves, rigs, shake, look-at, 3D layers, lights, linking and 3D views against a fake DOM |
| `mock-shapes.test.mjs` | Path values from shape specs, the ellipse vertex order, get_keyframes round trips, comp motion blur |
| `mock-keyframes.test.mjs` | `edit_keyframes`, `copy_animation`, `stagger` fidelity, separate dimensions, auto-orient; the fake property models the ease-switches-to-bezier and roving re-time behaviors |
| `aerender-discovery.test.mjs` | `findAerender` against fake install layouts |
| `server.test.mjs` | The built server end to end over stdio, with a fake bridge and a fake `aerender`: render lifecycle (failed start keeps old output, jobs stop on disconnect, the real output file is reported), `preview_frame` waiting, path sandboxing, the `run_jsx` gate. Skipped on Windows (uses a bash script) |

CI (`.github/workflows/ci.yml`) runs `npm test` on macOS, Linux and Windows with Node 18 and 22.

A green `npm test` doesn't prove a change works in real After Effects: the mocks only know the behavior already seen there.

## Verification status

Checked by hand on macOS with After Effects 26.3: every tool has been run against a real project, including real `aerender` renders with `render_status` and `render_cancel`, Save As and in-place saves, `import_footage` and `apply_preset`. The 3D camera, light and 3D layer tools were checked live: lens and depth-of-field setup, every move type (directions confirmed from rendered pixels), easing, rig create and remove with the animation preserved, shake, look-at, path, `set_3d` and `set_light` including materials, shadows and keyframes. Linking, the null options and all eleven 3D views were checked live too.

Not exercised yet: adjustment layers, the `set_layer` blend mode option, running code through `run_jsx` (only the disabled path was checked), and the Windows installer.

The repository restructure (the server split into `src/tools/`, the host script split into `host/`) was verified with `npm test`, an unchanged `tools/list`, and a function-by-function comparison of the generated `host.jsx` with the previous hand-written one; a live smoke test on After Effects 26.3 (macOS) then passed: get_project, create_comp, shape/text/camera layers, set_keyframes with easing, add_property (text animator and property), set_text, preview_frame, get_camera, precompose and a NOT_FOUND lookup. render_start was not rerun after the restructure.
