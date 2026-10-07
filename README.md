# AE Motion MCP

An [MCP](https://modelcontextprotocol.io) server that lets Claude (or any MCP client) build, animate, preview and render motion graphics in a live Adobe After Effects project.

Ask for "a 5 second lower third with an eased slide-in", and the model creates the comp, adds layers, sets keyframes, checks a preview frame and kicks off a render, all in the project you have open.

```
MCP client --stdio--> MCP server (TypeScript) --HTTP 127.0.0.1 + token--> CEP panel in AE --> ExtendScript
```

The server only talks to After Effects through a `Bridge` interface (`src/bridge.ts`), so the transport can be swapped (for example for UXP) without touching the tools.

## Contents

- [Requirements](#requirements)
- [Installation](#installation)
- [Verify it works](#verify-it-works)
- [Tools](#tools)
- [Configuration](#configuration)
- [Security](#security)
- [Troubleshooting](#troubleshooting)
- [Updating and uninstalling](#updating-and-uninstalling)
- [Development](#development)

## Requirements

- After Effects 2022 (22.0) or later, on macOS or Windows
- Node.js 18 or later (uses the built-in `fetch`)
- An MCP client such as Claude Code or Claude Desktop

## Installation

### 1. Get the code and run the installer

```bash
git clone https://github.com/dha-aa/ae-motion.git
cd ae-motion
```

macOS:

```bash
bash scripts/install.sh
```

Windows (PowerShell):

```powershell
./scripts/install.ps1
```

The installer does three things:

1. Copies `panel/` into the CEP extensions folder
   - macOS: `~/Library/Application Support/Adobe/CEP/extensions/com.aemotion.mcp`
   - Windows: `%APPDATA%\Adobe\CEP\extensions\com.aemotion.mcp`
2. Enables unsigned CEP panels (`PlayerDebugMode`, CSXS 9 to 12). This is a per-user setting that CEP requires for any panel that isn't signed by Adobe.
3. Runs `npm install && npm run build` to produce `dist/index.js`.

<details>
<summary>Prefer to install by hand?</summary>

1. Copy the contents of `panel/` into the extensions folder above, in a folder named `com.aemotion.mcp`.
2. Enable unsigned panels.
   - macOS: `for v in 9 10 11 12; do defaults write com.adobe.CSXS.$v PlayerDebugMode 1; done`
   - Windows: for each of 9 to 12, `reg add "HKCU\Software\Adobe\CSXS.<v>" /v PlayerDebugMode /t REG_SZ /d 1 /f`
3. In the repo folder run `npm install && npm run build`.

</details>

### 2. Allow scripts in After Effects

Open the preferences, go to **Scripting & Expressions**, and enable **Allow Scripts to Write Files and Access Network**.

- macOS: **After Effects > Settings**
- Windows: **Edit > Preferences**

### 3. Open the panel

Restart After Effects, then open **Window > Extensions > AE Motion MCP** and keep it open. Docking it in a workspace makes it load on startup.

The panel starts a small server on `127.0.0.1` (port 47670, or the next free port up to 47690) and writes its port and a random token to `~/.ae-motion-mcp/bridge.json`. The MCP server reads that file to find it. If the panel is closed, every tool returns `BRIDGE_DOWN`.

### 4. Register the server with your client

Use the **absolute path** to `dist/index.js`.

**Claude Code**

```bash
claude mcp add ae-motion -- node /absolute/path/to/ae-motion/dist/index.js
```

**Claude Desktop**: add this to `claude_desktop_config.json` (macOS: `~/Library/Application Support/Claude/`, Windows: `%APPDATA%\Claude\`) and restart the app.

```json
{
  "mcpServers": {
    "ae-motion": {
      "command": "node",
      "args": ["/absolute/path/to/ae-motion/dist/index.js"]
    }
  }
}
```

**Other clients**: any client that can launch a stdio MCP server works with `node /absolute/path/to/ae-motion/dist/index.js`.

To set [environment variables](#configuration), add an `env` object next to `args` in the JSON above, or pass `--env KEY=value` to `claude mcp add` (before the server name).

## Verify it works

1. The panel status line shows `127.0.0.1:<port>`, and `~/.ae-motion-mcp/bridge.json` exists.
2. In your client, ask: **"get the project info"**. You should get the project's comps, footage and the After Effects version.
3. Then try something visible: "create a 1920x1080 comp at 30 fps, 5 seconds, with a white solid background, and show me frame 0".

If a call fails, the error includes a code and a hint. See [Troubleshooting](#troubleshooting).

## Tools

41 tools, grouped by what they do. Time is in seconds, sizes in pixels, colors are `[r,g,b]` floats from 0 to 1, and scale is in percent. Comps and layers are addressed by the numeric ids the tools return. Properties are addressed by alias (`position`, `scale`, `rotation`, `opacity`, `anchor`) or by an array of match names; use `list_properties` to discover paths.

| Group | Tool | What it does |
|---|---|---|
| Inspect | `get_project` | Project items, active comp id, AE version, project path |
| | `get_comp` | Comp settings, work area, playhead time, marker count, and its layers |
| | `get_layer` | Transform values, effects, expressions, marker count, layer flags |
| | `list_properties` | Walk a layer's property tree (names, match names, values, keyframe counts) |
| | `get_keyframes` | Read a property's keyframes: values, interpolation, temporal ease, expression |
| | `find_effects` | Search installed effects by name, match name or category |
| Project | `save_project` | Save, or Save As to a path (needed before `render_start`) |
| | `set_comp` | Change a comp's name, size, fps, duration, background, pixel aspect or work area |
| | `delete_item` | Delete a comp, footage item or folder (refuses used items unless `force`) |
| | `create_comp` | Create a composition and open it |
| | `import_footage` | Import a file or image sequence |
| Layers | `add_layer` | Add a solid, text, shape (rect, ellipse, star, polygon, path), null, adjustment, footage, precomp, camera or light layer |
| | `set_layer` | Name, timing, time stretch, parent, blend mode, visibility, 3D, shy, solo, lock, label, motion blur, time remap |
| | `delete_layer` | Remove a layer |
| | `duplicate_layer` | Duplicate a layer, optionally several offset copies |
| | `reorder_layer` | Move a layer to the top, bottom, up, down, an index, or before/after another layer |
| | `precompose` | Precompose layers from one comp |
| Timeline | `split_layer` | Split layers at a time (Cmd/Ctrl+Shift+D) |
| | `delete_range` | Cut a time range out of the comp, with ripple or lift |
| | `shift_layers` | Move layers in time |
| | `sequence_layers` | Place layers end to end, with optional overlap |
| | `set_playhead` | Move the current-time indicator |
| | `add_marker`, `list_markers`, `delete_marker` | Layer and comp markers with comment, duration, chapter, url, label |
| Masks and mattes | `add_mask` | Add a rect, ellipse, polygon or bezier-path mask with mode, feather, opacity, expansion |
| | `set_track_matte` | Use a layer as an alpha or luma track matte, or remove the matte |
| Animate | `set_property` | Set a value, or a keyframe at `time` |
| | `set_keyframes` | Replace all keyframes on a property, with interpolation and easing |
| | `set_expression` | Set or clear an expression and report syntax errors |
| | `apply_effect` | Add an effect by match name and set its parameters |
| | `edit_effect` | Remove, enable or disable an effect |
| | `apply_preset` | Apply an `.ffx` animation preset |
| | `set_text` | Text content, font, size, color, tracking, justification |
| | `stagger` | Offset existing keyframes across layers |
| | `add_shape_modifier` | Add Trim Paths, Repeater or Round Corners to a shape group |
| Preview and render | `preview_frame` | Render one frame to PNG and return it as an image |
| | `render_start` | Save the project and start a background `aerender` job |
| | `render_status` | State, percent and log tail of a render job |
| | `render_cancel` | Cancel a running render job |
| Escape hatch | `run_jsx` | Run arbitrary ExtendScript (disabled unless `AE_MCP_ALLOW_JSX=1`) |

Resources: `ae://project`, `ae://selection`. Prompt: `motion-guide` (conventions and the recommended build loop).

A good build loop is: `get_project`, `create_comp`, `add_layer` (background first), `set_keyframes` with easing, `preview_frame` at key moments, adjust, then `render_start` and poll `render_status`. Prefer `set_keyframes` over many `set_property` calls, use `stagger` for repeated elements, and call `find_effects` rather than guessing effect names.

### Timeline editing

The timeline tools work like the editing commands in the After Effects timeline. All times are comp seconds and snap to whole frames unless a tool has `snap: false`.

- **Cut:** `split_layer` splits one or more layers at a time, like Cmd/Ctrl+Shift+D. The first part stays on the original layer; a copy above it holds the second part.
- **Remove a section:** `delete_range` takes out `start` to `end`. Layers inside the range are deleted, layers crossing an edge are trimmed, and layers spanning the range are split with the middle removed. With `ripple` (the default) later material moves earlier to close the gap; `ripple: false` leaves the gap. `shorten_comp` also shortens the comp when rippling.
- **Arrange:** `shift_layers` moves layers in time, `sequence_layers` places them end to end (with optional `overlap`), and `reorder_layer` changes stacking order.
- **Navigate and mark:** `set_playhead` moves the current-time indicator; `add_marker`, `list_markers` and `delete_marker` manage layer and comp markers; `set_comp` can set the work area.

Example prompts: "split the title layer at 2.5 seconds", "cut 3s to 5s out of every layer and close the gap", "line up these five layers one after another with a 10 frame overlap", "add a marker at every beat".

Errors come back as `{error:{code,message,hint}}` with codes `NOT_FOUND`, `BAD_ARGS`, `AE_ERROR`, `BRIDGE_DOWN`, `TIMEOUT`, `FORBIDDEN`, `UNSUPPORTED` and `EXISTS`.

## Configuration

All settings are environment variables on the MCP server process. The one exception is `AE_MCP_BRIDGE_FILE`, which must also be set for the panel's environment if you change it.

| Variable | Effect |
|---|---|
| `AE_MCP_ALLOWED_DIRS` | Folders (separated by the OS path delimiter, `:` or `;`) that tools may read from and write to. Default: your home folder. The temp folder is always allowed. |
| `AE_MCP_ALLOW_JSX` | Set to `1` to enable `run_jsx`. |
| `AE_AERENDER` | Full path to `aerender` if auto-detection fails. |
| `AE_MCP_BRIDGE_FILE` | Override the bridge file (default `~/.ae-motion-mcp/bridge.json`). |

## Security

- The panel only listens on `127.0.0.1` and every request needs the random token stored in the bridge file, which is created readable by your user only.
- File paths passed to tools (`import_footage`, `apply_preset`, render output) must be inside `AE_MCP_ALLOWED_DIRS`.
- `run_jsx` can execute anything After Effects can, so it is off unless you opt in.
- Installing the panel turns on `PlayerDebugMode` for CEP, which lets this user load any unsigned panel. Turn it back off if you uninstall (see below).

## Behavior notes

- Commands run one at a time in After Effects. A call that takes longer than 30 seconds returns `TIMEOUT` but may still finish in AE, so inspect the project before retrying.
- Every mutating tool call is one undo step. If a tool fails midway, partial changes stay in that undo group, so undo once to revert.
- `render_start` saves the project and runs `aerender` in the background. The project must have been saved at least once. If the output file already exists you must pass `overwrite: true`; the old file is only removed once the render is actually about to start, so a failed start keeps it. After Effects takes the file extension from the output module, so the file can differ from `output_path` (on After Effects 26.3 the default output module turned a `.mov` request into `.mp4`); `render_status` reports the file that was actually written. For a specific format, name an output-module template in `om_template`. Canceling a render can leave a partial temp file next to the output.
- Running renders are stopped when the MCP client disconnects or the server is terminated.
- `preview_frame` uses `comp.saveFrameToPng`; on versions without it you get `UNSUPPORTED`.
- `stagger` does not preserve spatial tangents on position keyframes.
- `split_layer` and `delete_range` check everything first where they can, and skip or refuse locked layers. `delete_range` does not move markers.
- A layer that is used as a track matte is hidden by After Effects (its `enabled` flag becomes false), as in the timeline UI, and it stays hidden after the matte is removed (turn it back on with `set_layer` `enabled: true`).
- `set_track_matte` uses `setTrackMatte` on After Effects 23 and later. Older versions need the matte layer directly above the target (use `reorder_layer`).
- `delete_item` refuses items that are used in comps or non-empty folders unless `force` is true.

## Troubleshooting

| Symptom | Cause and fix |
|---|---|
| `BRIDGE_DOWN`: Bridge file not found | The panel isn't open. Open **Window > Extensions > AE Motion MCP** and keep it open. |
| `BRIDGE_DOWN`: rejected the token (stale bridge file) | After Effects was restarted or the panel reloaded. Close and reopen the panel. |
| `BRIDGE_DOWN`: Cannot reach the After Effects panel | After Effects isn't running, or the panel is closed. Check the status line in the panel. |
| The panel isn't in the **Window > Extensions** menu | Re-run the installer, make sure `PlayerDebugMode` is set for your CSXS version, then fully restart After Effects. |
| Panel status shows "Cannot write bridge file" | `~/.ae-motion-mcp/` can't be created or written by your user. Fix the folder permissions, or point `AE_MCP_BRIDGE_FILE` somewhere writable (for both the panel and the server). |
| `preview_frame` or `import_footage` fail with a scripting permission error | Enable **Allow Scripts to Write Files and Access Network** in After Effects (see [Installation](#2-allow-scripts-in-after-effects)). |
| `FORBIDDEN`: path outside the allowed folders | Add the folder to `AE_MCP_ALLOWED_DIRS`. |
| `FORBIDDEN`: `run_jsx` is disabled | Set `AE_MCP_ALLOW_JSX=1` in the server's environment. |
| `TIMEOUT` | The command may still be running. Check the panel, inspect state, then retry. A modal dialog open in After Effects will also block commands. |
| `AE_ERROR`: aerender not found | Set `AE_AERENDER` to the full path of the `aerender` executable. |
| `BAD_ARGS`: Project has never been saved | Save the project once in After Effects, then call `render_start` again. |
| `EXISTS` on `render_start` | The output file exists. Pass `overwrite: true` or choose another path. |
| `UNSUPPORTED` on `preview_frame` | Your After Effects version has no `saveFrameToPng`. Update After Effects. |
| Changes to the server don't show up | Run `npm run build`, then restart the MCP server from your client. |

Panel logs are in `~/Library/Logs/CSXS/` on macOS and `%TEMP%` (`csxs*.log`) on Windows.

## Updating and uninstalling

**Update:** `git pull`, run the installer again (it replaces the installed panel and rebuilds), restart After Effects, and restart the MCP server from your client.

**Uninstall:**

1. Remove the server from your client (`claude mcp remove ae-motion`, or delete the entry from the Claude Desktop config).
2. Delete the installed panel folder (see [Installation](#1-get-the-code-and-run-the-installer)).
3. Delete `~/.ae-motion-mcp/`.
4. Optional: turn unsigned panels back off.
   - macOS: `for v in 9 10 11 12; do defaults delete com.adobe.CSXS.$v PlayerDebugMode; done`
   - Windows: delete the `PlayerDebugMode` value under `HKCU\Software\Adobe\CSXS.9` to `CSXS.12`.

## Development

```bash
npm install
npm run build     # compile src/ to dist/
npm start         # run the server on stdio (normally launched by your client)
npm test          # build, then run the tests in test/ (no After Effects needed)
```

Layout:

```
src/        MCP server (index.ts tools, bridge.ts, render.ts, sandbox.ts)
panel/      CEP panel (manifest, HTTP bridge in main.js, host/host.jsx ExtendScript)
scripts/    install.sh, install.ps1
```

After editing `panel/`, re-run the installer to copy it into the extensions folder and reopen the panel. After Effects DOM details (effect match names, `saveFrameToPng` availability) live in `panel/host/host.jsx`, which is the first place to look when a tool behaves differently on a new After Effects version.

### Test status

`npm test` needs no After Effects: it lints `host.jsx` for ExtendScript-safe syntax, checks the tool list, runs logic tests against a mock After Effects DOM, and runs a render lifecycle test with a fake `aerender`. The mock reproduces two real After Effects behaviors that caused bugs: changing a layer's start time moves its in/out points, and setting an in point also moves the out point.

Checked by hand on macOS with After Effects 26.3: every tool has been run against a real project, including real `aerender` renders with `render_status` and `render_cancel`, Save As and in-place saves, `import_footage` and `apply_preset`. For `run_jsx` only the default block was checked. Not exercised: camera and adjustment layers, the `set_layer` parent and blend mode options, running code through `run_jsx`, and the Windows installer. Issues and fixes are welcome.

## License

MIT
