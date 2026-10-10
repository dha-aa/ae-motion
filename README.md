# AE Motion MCP

An [MCP](https://modelcontextprotocol.io) server that lets Claude (or any MCP client) build, animate, preview and render motion graphics in a live Adobe After Effects project.

Ask for "a 5 second lower third with an eased slide-in", and the model creates the comp, adds layers, sets keyframes, checks a preview frame and kicks off a render, all in the project you have open.

https://github.com/user-attachments/assets/4734d955-5c97-4644-a387-f05d4dc0e2f6



https://github.com/user-attachments/assets/c05af0f1-3f7e-4a31-84ef-cbc0fb87006d

**Full Video:** [Watch here](https://youtu.be/XZhw3wOFpBU?si=aVW5Yp-KPTFF2jAl)




```
MCP client --stdio--> MCP server (Node) --HTTP 127.0.0.1 + token--> CEP panel in AE --> ExtendScript
```

## Contents

- [Requirements](#requirements)
- [Installation](#installation)
- [Verify it works](#verify-it-works)
- [What it can do](#what-it-can-do)
- [Configuration](#configuration)
- [Security](#security)
- [Troubleshooting](#troubleshooting)
- [Updates](#updates)
- [Updating and uninstalling](#updating-and-uninstalling)
- [Documentation](#documentation)

## Requirements

- After Effects 2022 (22.0) or later, on macOS or Windows
- Node.js 22.18 or later (the build and tests run TypeScript directly through Node's type stripping)
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

The installer:

1. Runs `npm install && npm run build`, which produces the server (`dist/`) and the panel's host script (`panel/host/host.jsx`).
2. Copies `panel/` into the CEP extensions folder:
   - macOS: `~/Library/Application Support/Adobe/CEP/extensions/com.aemotion.mcp`
   - Windows: `%APPDATA%\Adobe\CEP\extensions\com.aemotion.mcp`
3. Enables unsigned CEP panels (`PlayerDebugMode`, CSXS 9 to 12). This per-user setting is required for any panel that isn't signed by Adobe.

<details>
<summary>Prefer to install by hand?</summary>

1. In the repo folder run `npm install && npm run build`.
2. Copy the contents of `panel/` into the extensions folder above, in a folder named `com.aemotion.mcp`.
3. Enable unsigned panels.
   - macOS: `for v in 9 10 11 12; do defaults write com.adobe.CSXS.$v PlayerDebugMode 1; done`
   - Windows: for each of 9 to 12, `reg add "HKCU\Software\Adobe\CSXS.<v>" /v PlayerDebugMode /t REG_SZ /d 1 /f`

</details>

### 2. Allow scripts in After Effects

Open the preferences, go to **Scripting & Expressions**, and enable **Allow Scripts to Write Files and Access Network**.

- macOS: **After Effects > Settings**
- Windows: **Edit > Preferences**

### 3. Open the panel

Restart After Effects, then open **Window > Extensions > AE Motion MCP** and keep it open. Docking it in a workspace makes it load on startup.

The panel starts a small server on `127.0.0.1` (port 47670, or the next free port up to 47690) and writes its port and a random token to `~/.ae-motion-mcp/bridge.json`. The MCP server reads that file to find it. If the panel is closed, every tool returns `BRIDGE_DOWN`.

The panel also shows a **token meter**: the estimated tokens ae-motion has added to the model's context in this session (tool results and preview images), and the size of its tool definitions per request. It counts only what ae-motion sends; your messages and the model's replies are on top (your client shows the full count).

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
      "args": ["/absolute/path/to/ae-motion/dist/index.js"],
      "env": { "AE_MCP_TOOLSETS": "core" }
    }
  }
}
```

`AE_MCP_TOOLSETS: core` starts Claude Desktop with the core tools only (about 7.5k tokens of tool definitions instead of 16k on every message); the model adds 3D, timeline, masks, design or scripting with `load_tools` when it needs them. Leave it out to load everything. Claude Code does not need it: it loads MCP tools only when they are used.

**Other clients**: any client that can launch a stdio MCP server works with `node /absolute/path/to/ae-motion/dist/index.js`.

To set [environment variables](#configuration), add an `env` object next to `args` in the JSON above, or pass `--env KEY=value` to `claude mcp add` (before the server name).

## Verify it works

1. The panel status line shows `127.0.0.1:<port>`, and `~/.ae-motion-mcp/bridge.json` exists.
2. In your client, ask: **"get the project info"**. You should get the project's comps, footage and the After Effects version.
3. Then try something visible: "create a 1920x1080 comp at 30 fps, 5 seconds, with a white solid background, and show me frame 0".

If a call fails, the error includes a code and a hint. See [Troubleshooting](#troubleshooting).

## What it can do

77 tools in thirteen groups. The full reference, with behavior notes, is in [docs/tools.md](docs/tools.md).

| Group | Tools |
|---|---|
| Inspect | `get_project`, `get_comp`, `get_layer`, `list_properties`, `get_keyframes`, `find_effects` |
| Project | `open_project`, `save_project`, `create_comp`, `set_comp`, `import_footage`, `delete_item` |
| Layers | `add_layer`, `set_layer`, `link_layers`, `replace_source`, `delete_layer`, `duplicate_layer`, `reorder_layer`, `precompose` |
| Timeline | `split_layer`, `delete_range`, `insert_time`, `shift_layers`, `sequence_layers`, `align_to_markers`, `trim_comp`, `set_playhead`, `add_marker`, `update_marker`, `list_markers`, `delete_marker` |
| Masks and mattes | `add_mask`, `set_track_matte` |
| Design | `align_layers`, `set_anchor`, `add_shape`, `add_layer_style`, `text_to_shapes` |
| Animate | `set_property`, `set_keyframes`, `edit_keyframes`, `copy_animation`, `set_expression`, `add_property`, `apply_effect`, `edit_effect`, `apply_preset`, `set_text`, `get_text`, `find_fonts`, `stagger`, `add_shape_modifier` |
| Motion | `animate` (named moves with springs and bounces), `text_reveal`, `transition` (wipe, bars, iris), `review_motion` (a motion critic) |
| 3D and camera | `get_camera`, `set_camera`, `camera_move`, `camera_shake`, `camera_rig`, `set_3d`, `set_light`, `set_3d_view` |
| Preview and render | `preview_frame`, `render_start`, `render_status`, `render_cancel` |
| Escape hatch | `run_jsx` (disabled unless `AE_MCP_ALLOW_JSX=1`) |
| Audio | `beat_markers`, `audio_react`, `find_sound_cues`, `add_sfx`, `duck_music` |
| Server | `check_for_updates`, `batch` (many steps in one call), `load_tools` (only with `AE_MCP_TOOLSETS`) |

Also: resources `ae://project` and `ae://selection`, and the prompt `motion-guide` (conventions and a recommended build loop).

Conventions: time in seconds, sizes in pixels, colors `[r,g,b]` floats 0 to 1, scale in percent. Comps and layers are addressed by the numeric ids tools return; properties by alias (`position`, `scale`, `rotation`, `opacity`, `anchor`) or an array of match names (`list_properties` discovers them). Every mutating call is one undo step in After Effects.

Example prompts: "orbit the camera 120 degrees around the product over 4 seconds", "cut 3s to 5s out of every layer and close the gap", "line up these five layers one after another with a 10 frame overlap", "make these cards 3D, rotate them 25 degrees and add a spot light with shadows", "center the title and give it a soft drop shadow", "space these icons evenly across the bottom".

## Configuration

All settings are environment variables on the MCP server process. The one exception is `AE_MCP_BRIDGE_FILE`, which must also be set for the panel's environment if you change it.

| Variable | Effect |
|---|---|
| `AE_MCP_ALLOWED_DIRS` | Folders (separated by the OS path delimiter, `:` or `;`) that tools may read from and write to. Default: your home folder. The temp folder is always allowed. |
| `AE_MCP_ALLOW_JSX` | Set to `1` to enable `run_jsx`. |
| `AE_MCP_TOOLSETS` | Load only some tool groups, to send the model fewer tool definitions (cheaper requests): a comma list of `project`, `layers`, `timeline`, `masks`, `animate`, `motion`, `scene3d`, `design`, `output`, `audio`, `scripting`, or `core` (= project, layers, animate, motion, output: about 7.5k tokens of definitions instead of 16k). `inspect`, `check_for_updates` and `batch` are always on, and `load_tools` adds the other groups during a session (the client is told to refresh its tool list; the new tools also run through `batch`). Default: all. |
| `AE_AERENDER` | Full path to `aerender` if auto-detection fails. |
| `AE_MCP_BRIDGE_FILE` | Override the bridge file (default `~/.ae-motion-mcp/bridge.json`). |
| `AE_MCP_UPDATE_CHECK` | Set to `0` to turn off the daily check for new releases (see [Updates](#updates)). |

## Security

- The panel only listens on `127.0.0.1`, and every request needs the random token stored in the bridge file, which is created readable by your user only.
- File paths passed to tools (`import_footage`, `apply_preset`, `save_project`, render output) must be inside `AE_MCP_ALLOWED_DIRS`.
- `run_jsx` can execute anything After Effects can, so it is off unless you opt in.
- Installing the panel turns on `PlayerDebugMode` for CEP, which lets this user load any unsigned panel. Turn it back off if you uninstall (see below).

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
| `TIMEOUT` | The command may still be running. Check the panel, inspect state, then retry. A modal dialog open in After Effects also blocks commands. |
| `AE_ERROR`: aerender not found | Set `AE_AERENDER` to the full path of the `aerender` executable. |
| `BAD_ARGS`: Project has never been saved | Save the project once (or call `save_project` with a path), then call `render_start` again. |
| `EXISTS` on `render_start` | The output file exists. Pass `overwrite: true` or choose another path. |
| `UNSUPPORTED` on `preview_frame` | Your After Effects version has no `saveFrameToPng`. Update After Effects. |
| `AE_ERROR` with hint "ExtendScript line N" | N is a line of the installed `panel/host/host.jsx`; the `// ---- host/<file> ----` banners there show which source file it came from. Please open an issue. |
| `Unknown file extension ".ts"` during install or `npm test` | Your Node.js is older than 22.18, which cannot run `.ts` files directly. Update Node.js (`node --version` to check). |
| Changes to the server don't show up | Run `npm run build`, then restart the MCP server from your client. Changes under `host/` or `panel/` also need the installer re-run and the panel reopened. |

Panel logs are in `~/Library/Logs/CSXS/` on macOS and `%TEMP%` (`csxs*.log`) on Windows.

## Updates

You find out about new versions in three places:

- **The After Effects panel** shows the installed version and, when a newer release exists, a line like `v2.1.0 available` with an **Update to v2.1.0** button.
- **Your AI client:** `get_project` (usually the first call) includes an `update` note with the new version and the command to run, so the model can tell you. You can also ask "check for updates" (`check_for_updates`).
- **GitHub:** releases are git tags `vX.Y.Z`; what changed is in [CHANGELOG.md](CHANGELOG.md).

How the check works: the MCP server asks GitHub for the repository's version tags at most once a day, in the background, with a short timeout, and caches the answer in `~/.ae-motion-mcp/update.json` (the panel only reads that file). It sends nothing but a normal anonymous request, and a failed check never affects a tool. Set `AE_MCP_UPDATE_CHECK=0` to turn it off.

## Updating and uninstalling

**Update from the panel:** click **Update to vX.Y.Z** (or **Reinstall**) in the AE Motion MCP panel, then click again to confirm. It runs `git pull` and the installer in your ae-motion folder, shows the output, and restarts the panel with the new version; then restart your AI client so it uses the new server. The panel finds the folder and your `git` / `node` / `npm` through `install.json`, which the installer writes, so a panel installed before this button existed needs one manual update first. If `git pull` fails (local changes, a branch without an upstream), update by hand.

**Update by hand:** in the repo folder, `git pull`, then run the installer again (`bash scripts/install.sh`, or `./scripts/install.ps1` on Windows; it rebuilds and replaces the installed panel). Reopen the AE Motion MCP panel (or restart After Effects) and restart the MCP server from your client. The panel's Version line shows the new version.

**Uninstall:**

1. Remove the server from your client (`claude mcp remove ae-motion`, or delete the entry from the Claude Desktop config).
2. Delete the installed panel folder (see [Installation](#1-get-the-code-and-run-the-installer)).
3. Delete `~/.ae-motion-mcp/`.
4. Optional: turn unsigned panels back off.
   - macOS: `for v in 9 10 11 12; do defaults delete com.adobe.CSXS.$v PlayerDebugMode; done`
   - Windows: delete the `PlayerDebugMode` value under `HKCU\Software\Adobe\CSXS.9` to `CSXS.12`.

## Documentation

- [docs/tools.md](docs/tools.md): every tool, the timeline and camera models, and behavior notes
- [docs/architecture.md](docs/architecture.md): how the pieces fit, the wire protocol, the repository layout
- [docs/development.md](docs/development.md): building, testing, adding a tool, After Effects quirks, verification status

## License

[MIT](LICENSE)
