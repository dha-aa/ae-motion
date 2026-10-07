# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

An MCP server that lets an MCP client (Claude Code, Claude Desktop) control a live Adobe After Effects project: build comps, add/animate layers, preview frames and render — all through tools that end up calling ExtendScript inside AE.

```
MCP client --stdio--> MCP server (src/, TypeScript) --HTTP 127.0.0.1 + token--> CEP panel in AE (panel/main.js) --cep.evalScript--> ExtendScript (panel/host/host.jsx)
```

The MCP server never talks to AE directly — only through the `Bridge` interface in `src/bridge.ts`, so the transport (currently CEP/HTTP) could be swapped (e.g. for UXP) without touching the tool definitions in `src/index.ts`.

## Commands

```bash
npm install
npm run build     # tsc: compiles src/ -> dist/
npm start         # runs the server on stdio (normally launched by the MCP client, not by hand)
npm test          # build, then run everything in test/ (no After Effects needed)
```

There is no separate lint command and no single-test runner — `npm test` runs `test/run-all.mjs`, which runs these in order and stops on the first failure:
1. `test/static-checks.mjs` — parses `panel/host/host.jsx`, lints it for ES3 violations, boots `dist/index.js` and diffs `tools/list` against the command functions (`C.<name> = function`) defined in `host.jsx`.
2. `test/mock-host.test.mjs` — logic tests for layer/timeline/comp/marker tools against a mock After Effects DOM (no real AE).
3. `test/render.test.mjs` — render job lifecycle (start, failed-start keeps old output, jobs stop on client disconnect) against a fake bridge and fake `aerender`.

To run one of these files directly: `node test/static-checks.mjs` (after `npm run build`, since it execs `dist/index.js`).

## Architecture

### Three processes, one source of truth for the protocol

- **`src/index.ts`** — the MCP server. Every tool is registered via one of two thin helpers: `tool(name, description, zodShape, run)` for anything with custom logic, and `bridged(name, description, zodShape, pathArgs?, timeoutMs?)` for the common case of "validate args, forward them to the bridge, return the result." `pathArgs` lists which fields are filesystem paths that need sandboxing (see below) before being sent across.
- **`src/bridge.ts`** — `HttpBridge` reads `~/.ae-motion-mcp/bridge.json` (port + token) on every call and POSTs `{cmd, args}` to `http://127.0.0.1:<port>/cmd`. If the file is missing, the token is stale, or the request times out/fails, it returns a typed `BridgeResult` error (`BRIDGE_DOWN`/`TIMEOUT`) rather than throwing — tools surface this as `{error:{code,message,hint}}`.
- **`panel/main.js`** — the CEP panel's Node context. Runs an HTTP server on `127.0.0.1:47670` (or next free port up to 47690), writes `bridge.json` with a random token, and serializes every incoming command through a promise chain (`enqueue`) into `cep.evalScript(...)` calls — AE only ever executes one command at a time.
- **`panel/host/host.jsx`** — the ExtendScript side. Each bridge command name must have a matching `C.<command> = function(...)` here. **This file must stay ES3**: no arrow functions, `let`/`const`, template literals, spread, or ES5+ array/string methods (`forEach`, `map`, `.includes`, `.trim`, etc.) — ExtendScript's engine doesn't support them. `test/static-checks.mjs` lints for this automatically.

Adding a new MCP tool means touching both ends: register it in `src/index.ts` (with a zod schema) and implement the matching `C.<name>` in `host.jsx`. `static-checks.mjs` will fail if the two drift out of sync, and the `EXPECTED_TOOLS` constant there needs bumping when the tool count changes.

### After Effects quirks to remember (found in live testing)

- Setting a layer's `inPoint` also moves its `outPoint` (the layer keeps its length). Use `setIn(layer, t)` in `host.jsx`, which puts `outPoint` back, instead of assigning `inPoint` directly. Assigning `outPoint` on its own is safe.
- Changing `startTime` moves the in and out points with it. `shiftLayer` relies on that but still checks.
- Using a layer as a track matte hides it (`enabled` becomes false).
- `app.path` is a Folder object, not a string: use `app.path.fsName` (`appDir()` in `host.jsx`). `new Folder(app.path)` gives a bogus temp path.
- `aerender` takes the output file's extension from the output module, so the written file can differ from `-output` (a `.mov` request became `.mp4`). `render_status` looks for the real file once the job is done.
- Time changes should snap to whole frames (`snapT`); several tools rely on exact frame boundaries.
- The mock in `test/mock-host.test.mjs` models the first two quirks; keep it in sync when you find another.

### Conventions tools follow (see the `motion-guide` prompt in index.ts)

- Time in seconds, sizes in pixels, colors `[r,g,b]` floats 0–1, scale in percent.
- Comps/layers are addressed by the numeric ids other tools return; properties by alias (`position|scale|rotation|opacity|anchor`) or an array of match names — `list_properties` discovers the paths.
- Every mutating tool call is one AE undo step; a tool that fails partway leaves its partial state in that undo group.
- Prefer `set_keyframes` (replaces all keyframes at once) over repeated `set_property` calls; use `stagger` for repeated elements across layers; call `find_effects` instead of guessing match names.

### Path sandboxing (`src/sandbox.ts`)

Any tool argument that is a filesystem path (import paths, `.ffx` presets, render/save output) is resolved and checked against `AE_MCP_ALLOWED_DIRS` (default: home dir; temp dir always allowed) via `assertAllowed`, then converted to forward slashes via `toAe` before being sent to AE. `pathArgs` in a `bridged(...)` call is what wires this in per-tool — don't bypass it by passing path-shaped args outside that list.

### Rendering (`src/render.ts`)

`render_start` is async: it calls the bridge's `prepare_render` (which must have saved the project already) to get `project_path`/`comp_name`/`total_frames`, locates `aerender` (via `AE_AERENDER` or by searching near the AE install dir), then spawns it and parses `PROGRESS: ... (<frame>)` lines from stdout/stderr to compute percent. Jobs are tracked in-memory (`RenderManager.jobs`), pruned to the 30 most recent finished jobs, and killed on server shutdown (`dispose()`, wired to `SIGINT`/`SIGTERM`/`SIGHUP`/stdin-end in `index.ts`). The old output file is only deleted right before `spawn` — a render that fails to start never destroys existing output.

### Error codes

Every error is `{error:{code,message,hint}}` with `code` one of `NOT_FOUND`, `BAD_ARGS`, `AE_ERROR`, `BRIDGE_DOWN`, `TIMEOUT`, `FORBIDDEN`, `UNSUPPORTED`, `EXISTS`. Throw `AeToolError(code, message, hint?)` from `src/bridge.ts` to produce one from TypeScript-side logic (sandboxing, render manager); bridge/host-side errors already arrive in this shape.

## Working on `panel/`

Changes to `panel/` aren't picked up by `npm run build` — they need the installer re-run (`scripts/install.sh` / `scripts/install.ps1`) to copy `panel/` into the CEP extensions folder, then the AE panel reopened. `host.jsx` is the first place to look when a tool behaves differently on a different After Effects version (effect match names, `comp.saveFrameToPng` availability, etc.).

## Verification status

Every tool was checked by hand against a real AE project (26.3, macOS); see "Test status" in the README for the gaps (camera and adjustment layers, `set_layer` parent and blend mode, running code through `run_jsx`, the Windows installer). The mock in `test/mock-host.test.mjs` only knows the AE behavior we have seen, so a green `npm test` doesn't prove a change works in real AE.
