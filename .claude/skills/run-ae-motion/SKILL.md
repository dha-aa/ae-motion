---
name: run-ae-motion
description: Build, run, test and drive the ae-motion MCP server against a live After Effects (or a fake bridge without AE). Use when asked to start or smoke-test ae-motion, call one of its MCP tools, take a preview screenshot of a comp, hot-reload host.jsx changes into After Effects, or check that a tool change works end to end.
---

ae-motion is an MCP stdio server (`dist/index.js`) that drives After Effects through a CEP panel. Agents drive it with **`.claude/skills/run-ae-motion/driver.ts`**: a small MCP client that spawns a fresh server per command, calls tools, saves returned images as PNGs, talks to the panel's bridge directly, and hot-reloads the host script into a running AE. All paths are relative to the repo root; run the driver from there.

## Prerequisites

- Node 22.18+ (runs the `.ts` driver, scripts and tests directly; verified on Node 24, macOS).
- For real runs: After Effects 22+ with the panel installed and open (**Window > Extensions > AE Motion MCP**), and "Allow Scripts to Write Files and Access Network" enabled. Without AE, use `--fake` (server layer only).

## Build

```bash
npm install
npm run build          # clean; host/ -> panel/host/host.jsx; src/ -> dist/
bash scripts/install.sh   # macOS: build + copy panel/ into the CEP folder (needed once, and to persist host/ changes)
```

## Run (agent path)

```bash
D=.claude/skills/run-ae-motion/driver.ts
node $D status        # {"panel":"up","port":47670,...}; exit 1 if the panel is down
node $D smoke         # comp -> shapes -> eased keys -> preview PNG -> delete comp; exit 0 = all ok
```

`smoke` saves its frame to `/tmp/ae-motion-shots/preview_frame-<ts>.png` (override with `SHOTS=`). **Open the PNG and look at it**: an orange rounded box centered on a dark blue background at t = 0.75 s.

| command | what it does |
|---|---|
| `status` | Bridge file present + panel answers `GET /health` |
| `list` | Tool names (64), resources, prompts from a real `tools/list` |
| `call <tool> [json]` | One tool call. Prints the result JSON; images are saved to `$SHOTS`. Exit 1 on any error |
| `script <file\|->` | Many calls in **one** server session, one JSON per line: `{"tool":..., "args":..., "allowError":true?}`. `"$N.field.path"` in args is replaced by result N's value (0-based). Stops at the first error unless `allowError` |
| `bridge <cmd> [json]` | Raw host command to the panel, bypassing the MCP server (zod, sandbox, run_jsx gate). Reaches non-tool commands `get_selection`, `prepare_render` |
| `reload-host` | Load the current `panel/host/host.jsx` into the running AE; no installer or panel reopen |
| `--fake` | (flag) Start a fake panel that echoes `{fake, cmd, args}`: see exactly what the server forwards to AE, no AE needed |
| `--allow-jsx` | (flag) Spawn the server with `AE_MCP_ALLOW_JSX=1` |

Examples (all run and verified):

```bash
node $D call get_project
node $D --allow-jsx call run_jsx '{"code":"app.version"}'          # {"result":"26.3x87"}
node $D --fake call import_footage "{\"path\":\"$HOME/Movies/clip.mov\"}"   # shows the sandboxed path sent to AE
node $D script - <<'EOF'
{"tool":"create_comp","args":{"name":"drv","width":320,"height":180,"fps":24,"duration":1}}
{"tool":"add_layer","args":{"comp_id":"$0.id","kind":"text","options":{"text":"hi"}}}
{"tool":"get_text","args":{"layer_id":"$1.id"}}
{"tool":"get_layer","args":{"layer_id":999999},"allowError":true}
{"tool":"delete_item","args":{"item_id":"$0.id","force":true}}
EOF
```

### Iterating on host/ (ExtendScript) changes

```bash
npm run build:host                 # regenerate panel/host/host.jsx from host/
node $D reload-host                # "reloaded .../panel/host/host.jsx (N chars)"
node $D bridge <your_command> '{}' # or: node $D call <tool> '{...}'
```

Verified by adding a throwaway `C.ping` to `host/dispatch.jsx`: `Unknown command: ping` → build:host + reload-host → `{"pong":true}` → revert + reload → `Unknown command` again.

### Iterating on src/ (server) changes

```bash
npm run build:server
node $D call <tool> '{...}'        # every driver command spawns a fresh dist/index.js
```

### Host logic without After Effects

```bash
node test/mock-host.test.ts       # 50/50: layers, timeline, markers, comps against a fake AE DOM
node test/mock-camera.test.ts     # 23/23: camera maths, rigs, shake, lights, 3D views
```

Add a case there for host logic that needs no real AE behavior.

## Run (human path)

Register `node <repo>/dist/index.js` with an MCP client (`claude mcp add ae-motion -- node "$PWD/dist/index.js"`), keep the AE panel open, and ask the model. In a Claude Code session, run `/mcp` → reconnect after rebuilding, or the session keeps the old server.

## Test

```bash
npm test     # build + 8 test files, no AE needed: "all 8 test files passed"
```

## Gotchas

- **`$.evalFile(host.jsx)` does not hot-reload.** It evaluates in the caller's local scope, so the global `AEM` the panel calls stays the old closure (it reports success, nothing changes). `reload-host` reads the file and assigns `$.global.AEM = eval(src + ";AEM")` instead.
- **A reload lasts until the panel reopens.** Reopening loads the *installed* copy from the CEP folder. Run `bash scripts/install.sh` to make host/ changes stick.
- **A Claude Code session's own ae-motion MCP tools run the server it started with.** After `npm run build`, those tools still run old code until `/mcp` reconnects. The driver has no such problem (fresh server per command).
- **Preview PNGs are transparent where nothing is drawn**: the comp's `bg_color` is not rendered, so frames look white in a viewer. Add a full-frame layer first (smoke uses a shape) if you need to see the background.
- **`~` is not expanded in path arguments.** `"~/x.mov"` becomes `<server cwd>/~/x.mov` (seen via `--fake`). Pass absolute paths.
- **Unknown argument keys are rejected at any depth** (`Unrecognized key(s) in object: 'fil' at options.shape`): check spelling against `list` / the tool schema rather than retrying.
- **The driver pretty-prints results for reading; the wire format is compact JSON.** Measure response sizes from the server, not from driver output (the 25,000-character cap applies to the compact form).
- **Schema violations come back as plain text** (`MCP error -32602: Input validation error: ...`), not `{error:{code}}` JSON. They never reach AE. The driver still exits 1.
- **`bridge` and `reload-host` bypass the `AE_MCP_ALLOW_JSX` gate**: run_jsx's gate lives in the server, and the host command always exists. It's a local dev tool using your own token. Don't build product features on it.
- **Render jobs live in one server's memory**: `render_status` in a separate `call` won't find a job started by an earlier `call`. Keep `render_start` and its status checks in one `script`. (Rendering was not exercised with this driver: it needs a saved project.)
- **Every tool call is an AE undo step and leaves items in the open project.** `smoke` deletes its comp at the end; for your own scripts, end with `delete_item ... force:true`.
- **Solid layers leave footage items behind.** `kind: solid` creates an item in the project's Solids folder, and deleting the comp keeps it. For throwaway backgrounds use a full-frame shape (`kind: shape`, `shape: {type: rect, size: [w, h], fill}`), as `smoke` does; to clean up, `delete_item` the Solids folder id from `get_project` with `force: true`.

## Troubleshooting

- **`No bridge file at ~/.ae-motion-mcp/bridge.json`** / `status` → `"panel":"down"`: the panel isn't open (or AE was restarted / the panel folder was replaced by the installer). Open Window > Extensions > AE Motion MCP.
- **`.../dist/index.js not found: run npm run build`**: the driver runs from the repo root and needs a build. `npm test` also rebuilds.
- **`Unknown command: <name>` after editing host/**: the running AE still has the old host script. `npm run build:host && node $D reload-host`.
