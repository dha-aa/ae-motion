# AE Motion MCP

An MCP server that lets Claude (or any MCP client) build, animate, preview and render motion graphics in a live Adobe After Effects project.

```
MCP client --stdio--> MCP server (TypeScript) --HTTP 127.0.0.1 + token--> CEP panel in AE --> ExtendScript
```

The server only talks to After Effects through a `Bridge` interface (`src/bridge.ts`), so the transport can be swapped (for example for UXP) without touching the tools.

## Requirements

- After Effects 2022 (22.0) or later, Windows or macOS
- Node.js 18+

## Install

macOS: `bash scripts/install.sh`
Windows (PowerShell): `./scripts/install.ps1`

The installer copies the panel into the CEP extensions folder, enables unsigned panels (`PlayerDebugMode`), and runs `npm install && npm run build`.

Then:

1. In After Effects enable **Scripting & Expressions > Allow Scripts to Write Files and Access Network**.
2. Restart After Effects. Open **Window > Extensions > AE Motion MCP** and keep it open (dock it so it loads on startup).
3. Register the server:
   - Claude Code: `claude mcp add ae-motion -- node /absolute/path/to/ae-motion-mcp/dist/index.js`
   - Claude Desktop: add `{"mcpServers":{"ae-motion":{"command":"node","args":["/absolute/path/to/ae-motion-mcp/dist/index.js"]}}}` to the config file.
4. Ask: "get the project info".

## Tools (23)

| Group | Tools |
|---|---|
| Inspect | `get_project`, `get_comp`, `get_layer`, `list_properties`, `find_effects` |
| Build | `create_comp`, `import_footage`, `add_layer`, `set_layer`, `delete_layer`, `precompose` |
| Animate | `set_property`, `set_keyframes`, `set_expression`, `apply_effect`, `apply_preset`, `set_text`, `stagger` |
| Preview/render | `preview_frame`, `render_start`, `render_status`, `render_cancel` |
| Escape hatch | `run_jsx` (disabled unless `AE_MCP_ALLOW_JSX=1`) |

Resources: `ae://project`, `ae://selection`. Prompt: `motion-guide`.

Conventions: time in seconds, sizes in pixels, colors `[r,g,b]` 0-1, scale in percent. Comps and layers are addressed by the ids tools return. Properties by alias (`position`, `scale`, `rotation`, `opacity`, `anchor`) or match-name arrays. Every mutating tool call is one undo step. Errors are `{error:{code,message,hint}}` with codes `NOT_FOUND`, `BAD_ARGS`, `AE_ERROR`, `BRIDGE_DOWN`, `TIMEOUT`, `FORBIDDEN`, `UNSUPPORTED`, `EXISTS`.

## Environment variables

| Variable | Effect |
|---|---|
| `AE_MCP_ALLOWED_DIRS` | Folders (OS path-delimiter separated) tools may read/write. Default: home folder. The temp folder is always allowed. |
| `AE_MCP_ALLOW_JSX` | Set to `1` to enable `run_jsx`. |
| `AE_AERENDER` | Full path to `aerender` if auto-detection fails. |
| `AE_MCP_BRIDGE_FILE` | Override the bridge file (default `~/.ae-motion-mcp/bridge.json`); set it for both the panel's environment and the server if you change it. |

## Behavior notes

- Commands run one at a time in AE. Calls over 30 s return `TIMEOUT` but may still finish in AE; inspect before retrying.
- `render_start` saves the project and runs `aerender` in the background. The project must have been saved once. `.mp4` output needs an H.264 output-module template (Adobe Media Encoder) that you name in `om_template`.
- `preview_frame` uses `comp.saveFrameToPng`; on versions without it you get `UNSUPPORTED`.
- `stagger` does not preserve spatial tangents on position keyframes.
- If a mutating tool fails midway, partial changes stay in its single undo group; undo once to revert.

## Verification status

This was written without access to After Effects and its dependencies could not be installed in the build environment, so it has **not been run end to end**. Syntax checks were run on the panel and host scripts. First-run checklist: `get_project`, then `create_comp` + `add_layer` + `set_keyframes`, then `preview_frame`, then `render_start`. Likely first fixes, if any, are in `panel/host/host.jsx` (AE DOM details such as effect match names or `saveFrameToPng` availability).

## Layout

```
src/        MCP server (index.ts tools, bridge.ts, render.ts, sandbox.ts)
panel/      CEP panel (manifest, HTTP bridge, host/host.jsx ExtendScript)
scripts/    install.sh, install.ps1
```
