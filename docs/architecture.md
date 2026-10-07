# Architecture

## Overview

Three processes cooperate. The MCP server never touches After Effects directly; it sends named commands over a local, token-protected HTTP bridge to a CEP panel, which runs them as ExtendScript inside After Effects.

```
┌────────────┐  stdio   ┌──────────────────────┐  HTTP 127.0.0.1   ┌───────────────────────┐ evalScript ┌──────────────────────┐
│ MCP client │ ───────▶ │ MCP server (Node)    │ ────────────────▶ │ CEP panel (Node+CEF)  │ ─────────▶ │ ExtendScript (ES3)   │
│ Claude …   │ ◀─────── │ src/  → dist/        │ ◀──────────────── │ panel/main.js         │ ◀───────── │ panel/host/host.jsx  │
└────────────┘          └──────────────────────┘  x-ae-token        └───────────────────────┘   JSON     └──────────────────────┘
                          validates (zod), sandboxes paths,            serial queue: one command          runs the command in one
                          runs aerender and the preview wait           at a time                          undo group, returns JSON
```

| Piece | Source | Runs in | Job |
|---|---|---|---|
| MCP server | `src/` (TypeScript, built to `dist/`) | Node 18+, launched by the MCP client | Tool schemas, validation, path sandbox, render jobs, preview wait |
| CEP panel | `panel/main.js`, `panel/index.html`, `panel/CSXS/manifest.xml` | After Effects' CEP runtime (Node enabled) | HTTP bridge, auth token, serial command queue, status UI |
| Host script | `host/` (ES3), built to `panel/host/host.jsx` | After Effects' ExtendScript engine | The actual After Effects DOM work |

## Repository layout

```
src/                        MCP server (TypeScript)
  index.ts                  entry point: stdio transport, shutdown hooks
  server.ts                 createServer(): wires tools, resources, prompts to a bridge
  config.ts                 server name/version and every environment variable
  errors.ts                 ErrorCode, AeToolError, error normalisation
  bridge.ts                 Bridge interface + HttpBridge (the CEP transport)
  sandbox.ts                path allowlist for tool arguments
  resources.ts              ae://project, ae://selection
  prompts.ts                motion-guide
  tools/
    registry.ts             ToolRegistry: tool() / bridged() helpers, result helpers
    schemas.ts              shared zod schemas (ids, colors, vectors, property paths)
    index.ts                registerAllTools()
    inspect.ts project.ts layers.ts timeline.ts masks.ts animate.ts scene3d.ts design.ts output.ts scripting.ts
  render/
    aerender.ts             find aerender; find the file it actually wrote
    manager.ts              RenderManager: background aerender jobs

host/                       ExtendScript sources (ES3), one closure once built
  json.jsx                  JSON polyfill (ExtendScript has none)
  core/                     shared helpers: util, lookup, describe, keys, shapes, timing, vector, scene3d, layout
  commands/                 C.<command> implementations, one file per tool group (mirrors src/tools/)
  dispatch.jsx              AEM.dispatch(): parse, undo group, run, serialise errors

panel/                      the CEP extension that gets installed into After Effects
  CSXS/manifest.xml         extension manifest (AE 22.0+, CSXS 9)
  index.html, main.js       status UI and the HTTP bridge
  host/host.jsx             GENERATED from host/ by scripts/build-host.mjs (gitignored)

scripts/
  build-host.mjs            concatenates host/ into panel/host/host.jsx
  install.sh, install.ps1   build, copy panel/ into the CEP folder, enable unsigned panels

test/                       runs without After Effects (see docs/development.md)
docs/                       this documentation
```

Each tool group has a matching pair: `src/tools/<group>.ts` declares the tools, `host/commands/<group>.jsx` implements the commands with the same names.

## Request lifecycle

Take `set_keyframes`:

1. The client calls the tool over stdio. The MCP SDK validates the arguments against the zod schema in `src/tools/animate.ts`.
2. The registry has made every input schema strict (`deepStrict`), so unknown keys at any depth are rejected here. `ToolRegistry.bridged` then sandboxes any declared path arguments (`src/sandbox.ts`) and calls `bridge.run("set_keyframes", args)`.
3. `HttpBridge` reads `~/.ae-motion-mcp/bridge.json` for the port and token and POSTs `{cmd, args}` to `http://127.0.0.1:<port>/cmd`.
4. `panel/main.js` checks the `x-ae-token` header and queues the command behind any in-flight one, so After Effects runs exactly one command at a time.
5. The panel calls `cep.evalScript('AEM.dispatch("<json>")')`.
6. `dispatch` (in `host/dispatch.jsx`) parses the JSON, opens an undo group unless the command is read-only, runs `C.set_keyframes(args)`, closes the undo group, and returns `{"ok":true,"result":...}` or `{"ok":false,"error":{...}}` as a string.
7. The panel parses the string and replies over HTTP; the server returns it to the client as compact JSON text, with `isError` set on failure. Results over `CHARACTER_LIMIT` (25,000 characters, `src/config.ts`) are replaced by an error carrying the tool's `tooLargeHint`.

Tools with server-side logic use `ToolRegistry.tool` instead: `preview_frame` (bridge call, then waits for the PNG to finish writing), `render_start` / `render_status` / `render_cancel` (`src/render/`), and `run_jsx` (gated by `AE_MCP_ALLOW_JSX`).

## Wire protocol

**Bridge file** (`~/.ae-motion-mcp/bridge.json`, mode 0600, override with `AE_MCP_BRIDGE_FILE` for both sides):

```json
{ "port": 47670, "token": "<48 hex chars>", "pid": 12345 }
```

The panel writes it when its HTTP server starts (port 47670, or the next free port up to 47690) and deletes it on unload if the token is still its own. The server re-reads it on every call, so reopening the panel needs no server restart.

**Endpoints** (all require header `x-ae-token: <token>`, otherwise HTTP 401):

| Method and path | Body | Reply |
|---|---|---|
| `POST /cmd` | `{"cmd": "<command>", "args": {...}}` (max 5 MB) | `{"ok": true, "result": ...}` or `{"ok": false, "error": {"code", "message", "hint"}}` |
| `GET /health` | | `{"ok": true, "result": {"panel": "ae-motion-mcp"}}`; handy for checking the panel by hand with curl |

**Host commands** are every `C.<name>` in `host/commands/`. All bridged tools map 1:1 to a command of the same name. Two commands are not tools: `get_selection` (backs the `ae://selection` resource) and `prepare_render` (saves the project and returns `project_path`, `comp_name`, `total_frames`, `aerender_dir` for `render_start`).

## Undo and failure semantics

- Each mutating command is wrapped in `app.beginUndoGroup("MCP: <cmd>")` / `endUndoGroup()`, so one tool call is one undo step. The read-only list is `READONLY` in `host/dispatch.jsx`.
- Commands validate what they can before changing anything; a command that fails partway leaves its partial state inside its undo group.
- Errors raised with `fail(code, message, hint)` in ExtendScript keep their code. Anything else becomes `AE_ERROR`, with the ExtendScript line number in the hint (a line of `panel/host/host.jsx`; the `// ---- host/<file> ----` banners map it back to a source file).
- Transport problems never throw in the server: `HttpBridge` returns `BRIDGE_DOWN` (no bridge file, refused connection, stale token) or `TIMEOUT` (default 30 s). A timed-out command may still complete in After Effects.

## Security model

- The bridge listens only on `127.0.0.1` and requires the per-session random token, which lives in a file only the user can read.
- Path arguments are resolved (following symlinks of the existing part) and must sit inside `AE_MCP_ALLOWED_DIRS` (default: home) or the temp folder. Only arguments a tool declares in `paths` are treated as paths. Everything else, such as effect match names, is forwarded unchanged.
- `run_jsx` evaluates arbitrary ExtendScript and is refused by the server unless `AE_MCP_ALLOW_JSX=1`.

## Rendering

`render_start` (`src/render/manager.ts`):

1. Sandboxes `output_path`; refuses an existing file without `overwrite`, and refuses a directory.
2. Calls the host's `prepare_render`, which saves the project (it must have been saved once) and reports the project path, comp name, frame count and After Effects install folder.
3. Locates `aerender` (`src/render/aerender.ts`): `AE_AERENDER`, then the reported folder and up to four parents (plus `Support Files/` on Windows), then the standard install locations.
4. Only now deletes the old output, then spawns `aerender -project … -comp … -output …` (plus `-RStemplate` / `-OMtemplate`).
5. Parses `PROGRESS: … (<frame>)` lines for percent and keeps a 40-line log.

Jobs are tracked in memory, finished jobs are pruned to the 30 most recent, and running jobs are killed when the server shuts down (`SIGINT`, `SIGTERM`, `SIGHUP`, or stdin closing). Because the output module picks the extension, `render_status` looks for the file actually written when the requested one is missing.

## Swapping the transport

Tools depend only on the `Bridge` interface in `src/bridge.ts`:

```ts
interface Bridge {
  run(command: string, args: Record<string, unknown>, timeoutMs?: number): Promise<BridgeResult>;
}
```

A UXP or other transport needs a new `Bridge` implementation passed to `createServer()` in `src/index.ts`, plus a way to call `AEM.dispatch` (or an equivalent) on the After Effects side. No tool definitions change.
