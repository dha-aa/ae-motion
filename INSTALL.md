# Installing ae-motion (instructions for AI agents)

You are an agent (Claude Code, Claude Desktop, Codex, Cursor or similar) and the user asked you to install
ae-motion from `https://github.com/dha-aa/ae-motion`. Follow these steps in order. Run the commands yourself; ask the
user only where a step says so. People installing by hand: see [README.md](README.md#installation).

## 1. Check the machine, and install what is missing

Find the OS first (`uname -s` gives `Darwin` on macOS; on Windows use PowerShell). After Effects does not run on
Linux: stop and tell the user. Then check each requirement:

| Requirement | Check | macOS | Windows |
| --- | --- | --- | --- |
| After Effects 2022 (22.0) or later | a folder named `Adobe After Effects <year>` | in `/Applications` | in `C:\Program Files\Adobe` |
| Node.js 22.18 or later | `node --version` | see below | `winget install -e --id OpenJS.NodeJS.LTS` |
| git | `git --version` | see below | `winget install -e --id Git.Git` |

If Node.js or git is missing (or Node.js is older), ask the user once, naming what you will install and how, then
install it:

- **macOS with Homebrew** (`brew --version` works): `brew install node git` (only the missing ones).
- **macOS without Homebrew:**
  - git: `xcode-select --install` opens Apple's installer for the Command Line Tools (git is in it). Tell the user to
    click **Install**, and wait until `git --version` works.
  - Node.js: the newest LTS is the first entry of <https://nodejs.org/dist/index.json> whose `lts` is not `false`.
    Download its macOS installer, `https://nodejs.org/dist/<version>/node-<version>.pkg`, to a temp folder and run
    `open <file>.pkg`. Tell the user to click through it, and wait until `node --version` shows it.
- **Windows:** the `winget` commands in the table. Windows asks the user to allow each one. A shell that was already
  open does not see the new `PATH`: open a new one, or call `C:\Program Files\nodejs\node.exe` and
  `C:\Program Files\Git\cmd\git.exe` directly.

If the user says no, or an install fails, show what happened and stop: the install needs both. If After Effects is
missing, tell the user. You can still install; ae-motion works once After Effects is installed.

## 2. Get the code

Clone into a lasting folder (the MCP clients run the server from here, so not a temp folder). Default
`~/ae-motion`, unless the user named a place. If the folder already holds ae-motion, skip the clone: step 3 updates
it.

```bash
git clone https://github.com/dha-aa/ae-motion.git ~/ae-motion
```

## 3. Run the installer

From the repo folder, on macOS and Windows alike:

```bash
node scripts/update.ts
```

It checks out the newest release (a `vX.Y.Z` tag: `main` can hold unreleased work, and the panel's Update button
installs releases only, so installing `main` would have the first Update move it back), then runs the installer for
this OS. That takes about a minute (`npm install`, build) and does everything that can be scripted: it builds the
server and checks it starts (`Server: starts and lists N tools`), installs the After Effects panel, allows unsigned
panels, and registers the server with Claude Desktop and with Claude Code (user scope, every project). Read its
output. The lines starting `Claude Desktop:` and `Claude Code:` say what it registered or skipped and why. If it
fails, show the user the error; do not edit files in the repo to work around it.

For another MCP client (Cursor, Codex, Windsurf, VS Code), add a stdio server to that client's config yourself:
command `node`, argument the absolute path of `dist/index.js` in the repo folder, name `ae-motion`.

## 4. Tell the user the steps only they can do

These are in After Effects' own UI. Give the user this list:

1. In After Effects, open **After Effects > Settings > Scripting & Expressions** (macOS) or **Edit > Preferences >
   Scripting & Expressions** (Windows) and turn on **Allow Scripts to Write Files and Access Network**.
2. Restart After Effects, then open **Window > Extensions > AE Motion MCP**. Keep the panel open (dock it, so it opens
   with After Effects).
3. Restart Claude Desktop if it was open (it reads its config at start). In Claude Code, type `/mcp`, pick
   `ae-motion` and **Reconnect** (or start a new session).

## 5. Check it works

When the user says they are done, run from the repo folder:

```bash
node scripts/check.ts --ae
```

It prints one line per part: `Server:`, `After Effects setting:` (read from After Effects' prefs file, which After
Effects writes when it quits, so a setting just changed shows after a restart) and `Panel:` (`get_project` through the
panel: the After Effects version and the open project). Exit code 0 means everything is ready. Otherwise tell the user
the step each failing line names and run it again once they are done. Do not trust `~/.ae-motion-mcp/bridge.json`
alone: After Effects quitting
without closing the panel (a crash) can leave it behind.

Then suggest a first try, such as: "create a 1920x1080 comp, 5 seconds, with a title that slides in, and show me a
frame".
