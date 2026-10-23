# Setup and reference

The details behind the [README](../README.md): what the installer does, installing and registering by hand,
configuration, security, troubleshooting, updates and uninstalling.

## Contents

- [Requirements](#requirements)
- [What the installer does](#what-the-installer-does)
- [Install by hand](#install-by-hand)
- [Register with your client by hand](#register-with-your-client-by-hand)
- [The panel](#the-panel)
- [Check the install](#check-the-install)
- [Configuration](#configuration)
- [Security](#security)
- [Troubleshooting](#troubleshooting)
- [Updates](#updates)
- [Updating](#updating)
- [Uninstalling](#uninstalling)

## Requirements

- After Effects 2022 (22.0) or later, on macOS or Windows
- Node.js 22.18 or later (the build and tests run TypeScript directly through Node's type stripping). Check with `node --version`. Install the LTS from [nodejs.org](https://nodejs.org), or `brew install node` (macOS, Homebrew) or `winget install -e --id OpenJS.NodeJS.LTS` (Windows).
- git, so the panel's Update button can update. Check with `git --version`. macOS: `xcode-select --install` or `brew install git`; Windows: `winget install -e --id Git.Git` or [git-scm.com](https://git-scm.com).
- An MCP client such as Claude Code or Claude Desktop

Installing with an agent ([INSTALL.md](../INSTALL.md)) checks all of these and, with your OK, installs Node.js and git for you.

## What the installer does

`node scripts/update.ts` checks out the newest release (the panel's Update button installs releases too, so it never moves you back from unreleased `main`) and runs the installer for your OS: `scripts/install.sh` on macOS, `scripts/install.ps1` on Windows. Run the installer directly to install whatever is checked out.

The installer:

1. Runs `npm install && npm run build`, which produces the server (`dist/`) and the panel's host script (`panel/host/host.jsx`), then checks the built server starts (`scripts/check.ts`), so a broken build fails the install instead of the first tool call.
2. Copies `panel/` into the CEP extensions folder:
   - macOS: `~/Library/Application Support/Adobe/CEP/extensions/com.aemotion.mcp`
   - Windows: `%APPDATA%\Adobe\CEP\extensions\com.aemotion.mcp`
3. Enables unsigned CEP panels (`PlayerDebugMode`, CSXS 9 to 12). This per-user setting is required for any panel that isn't signed by Adobe.
4. Registers the server with **Claude Desktop** (adds `ae-motion` to `claude_desktop_config.json`, keeping your other servers and settings; restart Claude Desktop) and **Claude Code** (user scope, so it works in every project). It keeps an `env` you added to an existing entry, skips a client that isn't installed, and never touches a config file that isn't valid JSON. Set `AE_MCP_REGISTER=0` to skip this step (`AE_MCP_REGISTER=0 bash scripts/install.sh`).

## Install by hand

Without the installer scripts:

1. In the repo folder run `npm install && npm run build`.
2. Copy the contents of `panel/` into the extensions folder above, in a folder named `com.aemotion.mcp`.
3. Enable unsigned panels.
   - macOS: `for v in 9 10 11 12; do defaults write com.adobe.CSXS.$v PlayerDebugMode 1; done`
   - Windows: for each of 9 to 12, `reg add "HKCU\Software\Adobe\CSXS.<v>" /v PlayerDebugMode /t REG_SZ /d 1 /f`
4. [Register the server](#register-with-your-client-by-hand), then do [the two steps in After Effects](../README.md#the-two-steps-in-after-effects).

## Register with your client by hand

The installer already does this for Claude Desktop and Claude Code; to do it by hand, or for another client, use the **absolute path** to `dist/index.js`.

**Claude Code**

```bash
claude mcp add -s user ae-motion -- node /absolute/path/to/ae-motion/dist/index.js
```

In a running Claude Code session, `/mcp` > ae-motion > **Reconnect** loads it; new sessions load it on their own.

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

Claude Desktop (and any client that sends every tool definition with every message) is shown the core tools only: about 11k tokens of definitions per message instead of 18k. The other tools are named in the server instructions; a `batch` step that uses one shows its group, or the model calls `load_tools`. Claude Code is shown every tool, because it loads tool definitions only when a tool is used. Set `AE_MCP_TOOLSETS` to choose the groups yourself (`all` for everything).

**Other clients**: any client that can launch a stdio MCP server works with `node /absolute/path/to/ae-motion/dist/index.js`.

To set [environment variables](#configuration), add an `env` object next to `args` in the JSON above, or pass `--env KEY=value` to `claude mcp add` (before the server name).

## The panel

**Window > Extensions > AE Motion MCP.** Keep it open; docking it in a workspace makes it load on startup.

The panel starts a small server on `127.0.0.1` (port 47670, or the next free port up to 47690) and writes its port and a random token to `~/.ae-motion-mcp/bridge.json`. The MCP server reads that file to find it. If the panel is closed, every tool returns `BRIDGE_DOWN`.

```
MCP client --stdio--> MCP server (Node) --HTTP 127.0.0.1 + token--> CEP panel in AE --> ExtendScript
```

The panel also shows a **token meter**: the estimated tokens ae-motion has added to the model's context in this session (tool results and preview images), and the size of its tool definitions per request. It counts only what ae-motion sends; your messages and the model's replies are on top (your client shows the full count).

## Check the install

In the repo folder run `node scripts/check.ts --ae`. It checks the server starts, the scripting setting is on (from After Effects' prefs file, which After Effects saves when it quits) and the panel answers, and names the step still missing. The panel status line shows `127.0.0.1:<port>` too.

If a call fails, the error includes a code and a hint. See [Troubleshooting](#troubleshooting).

## Configuration

All settings are environment variables on the MCP server process. The one exception is `AE_MCP_BRIDGE_FILE`, which must also be set for the panel's environment if you change it.

| Variable | Effect |
|---|---|
| `AE_MCP_ALLOWED_DIRS` | Folders (separated by the OS path delimiter, `:` or `;`) that tools may read from and write to. Default: your home folder. The temp folder is always allowed. |
| `AE_MCP_ALLOW_JSX` | Set to `1` to enable `run_jsx`. |
| `AE_MCP_TOOLSETS` | Load only some tool groups, to send the model fewer tool definitions (cheaper requests): a comma list of `project`, `layers`, `timeline`, `masks`, `animate`, `motion`, `scene3d`, `design`, `output`, `audio`, `scripting`, `core` (= project, layers, animate, motion, output: about 11k tokens of definitions instead of 18k) or `all`. `inspect`, `check_for_updates` and `batch` are always on. Every tool is registered either way; the others are only left out of the tool list, named in the instructions, and shown by `load_tools` or a `batch` step that uses one (the client is told to refresh its tool list). Default: Claude Code `all` (it defers definitions itself), other clients `core`. |
| `AE_AERENDER` | Full path to `aerender` if auto-detection fails. |
| `AE_MCP_FFMPEG` | Full path to `ffmpeg`, used to check renders and make `deliver` MP4s, if it isn't found on `PATH` or in the usual install folders. |
| `AE_MCP_BRIDGE_FILE` | Override the bridge file (default `~/.ae-motion-mcp/bridge.json`). |
| `AE_MCP_UPDATE_CHECK` | Set to `0` to turn off the daily check for new releases (see [Updates](#updates)). |
| `AE_MCP_UPDATE_URL` | Where the update check lists version tags (default: GitHub's tags API for this repository). For mirrors and tests. |
| `AE_MCP_REGISTER` | Installer only: set to `0` to skip registering with Claude Desktop and Claude Code. |

## Security

- The panel only listens on `127.0.0.1`, and every request needs the random token stored in the bridge file, which is created readable by your user only.
- File paths passed to tools (`import_footage`, `apply_preset`, `save_project`, render output) must be inside `AE_MCP_ALLOWED_DIRS`.
- `run_jsx` can execute anything After Effects can, so it is off unless you opt in.
- Installing the panel turns on `PlayerDebugMode` for CEP, which lets this user load any unsigned panel. Turn it back off if you uninstall (see [Uninstalling](#uninstalling)).

## Troubleshooting

| Symptom | Cause and fix |
|---|---|
| `BRIDGE_DOWN`: Bridge file not found | The panel isn't open. Open **Window > Extensions > AE Motion MCP** and keep it open. |
| `BRIDGE_DOWN`: rejected the token (stale bridge file) | After Effects was restarted or the panel reloaded. Close and reopen the panel. |
| `BRIDGE_DOWN`: Cannot reach the After Effects panel | After Effects isn't running, or the panel is closed. Check the status line in the panel. |
| The panel isn't in the **Window > Extensions** menu | Re-run the installer, make sure `PlayerDebugMode` is set for your CSXS version, then fully restart After Effects. |
| Panel status shows "Cannot write bridge file" | `~/.ae-motion-mcp/` can't be created or written by your user. Fix the folder permissions, or point `AE_MCP_BRIDGE_FILE` somewhere writable (for both the panel and the server). |
| `preview_frame` or `import_footage` fail with a scripting permission error | Enable **Allow Scripts to Write Files and Access Network** in After Effects (**After Effects > Settings** on macOS, **Edit > Preferences** on Windows, then **Scripting & Expressions**). |
| `FORBIDDEN`: path outside the allowed folders | Add the folder to `AE_MCP_ALLOWED_DIRS`. |
| `FORBIDDEN`: `run_jsx` is disabled | Set `AE_MCP_ALLOW_JSX=1` in the server's environment. |
| `TIMEOUT` | The message says what happened: still running (it finishes on its own: inspect state before retrying), or dropped before it started because After Effects was busy with another command (safe to retry). A modal dialog open in After Effects blocks commands. |
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
- **GitHub:** releases are git tags `vX.Y.Z`; what changed is in [CHANGELOG.md](../CHANGELOG.md).

How the check works: the MCP server asks GitHub for the repository's version tags at most once a day, in the background, with a short timeout, and caches the answer in `~/.ae-motion-mcp/update.json` (the panel only reads that file). It sends nothing but a normal anonymous request, and a failed check never affects a tool. Set `AE_MCP_UPDATE_CHECK=0` to turn it off.

## Updating

**From the panel:** click **Update to vX.Y.Z** (or **Reinstall**) in the AE Motion MCP panel, then click again to confirm. It runs `scripts/update.ts` in your ae-motion folder, which checks out the newest release tag (never unreleased work on `main`) and runs the installer, shows the output, and restarts the panel with the new version; then restart your AI client so it uses the new server. The checkout is left on that tag (`git switch main` goes back). The panel finds the folder and your `git` / `node` / `npm` through `install.json`, which the installer writes, so a panel installed before this button existed needs one manual update first. If you have local changes, it stops and says so: commit or stash them, or update by hand.

**By hand:** in the repo folder, `node scripts/update.ts` (the newest release, then the installer; the same command installs). Or `git pull` for the latest `main`, then run the installer again (`bash scripts/install.sh`, or `./scripts/install.ps1` on Windows; it rebuilds and replaces the installed panel). Reopen the AE Motion MCP panel (or restart After Effects) and restart the MCP server from your client. The panel's Version line shows the new version.

## Uninstalling

1. Remove the server from your client (`claude mcp remove -s user ae-motion`, or delete the entry from the Claude Desktop config).
2. Delete the installed panel folder (see [What the installer does](#what-the-installer-does)).
3. Delete `~/.ae-motion-mcp/`.
4. Optional: turn unsigned panels back off.
   - macOS: `for v in 9 10 11 12; do defaults delete com.adobe.CSXS.$v PlayerDebugMode; done`
   - Windows: delete the `PlayerDebugMode` value under `HKCU\Software\Adobe\CSXS.9` to `CSXS.12`.
