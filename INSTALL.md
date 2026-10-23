# Installing ae-motion (instructions for AI agents)

You are an agent (Claude Code, Claude Desktop, Codex, Cursor or similar) and the user asked you to install
ae-motion from `https://github.com/dha-aa/ae-motion`. Follow these steps in order. Run the commands yourself; ask the
user only where a step says so. People installing by hand: see [README.md](README.md#installation).

## 1. Check the machine

- **OS:** macOS or Windows. After Effects does not run on Linux: stop and tell the user.
- **Node.js 22.18 or later:** `node --version`. If it is missing or older, tell the user and suggest installing the
  current LTS from <https://nodejs.org> (or `brew install node` / `nvm install --lts`). Do not continue without it.
- **git:** `git --version`. Without git, download and unpack
  `https://github.com/dha-aa/ae-motion/archive/refs/heads/main.zip` instead of cloning (the panel's Update button then
  reinstalls the files as they are instead of updating to the newest release).
- **After Effects 2022 (22.0) or later** should be installed. You do not need it running to install.

## 2. Get the code

Clone into a lasting folder (the MCP clients run the server from here, so not a temp folder). Default
`~/ae-motion`, unless the user named a place. If the folder already holds ae-motion, `git pull` there instead.

```bash
git clone https://github.com/dha-aa/ae-motion.git ~/ae-motion
```

## 3. Run the installer

From the repo folder:

- macOS: `bash scripts/install.sh`
- Windows (PowerShell): `powershell -ExecutionPolicy Bypass -File scripts\install.ps1`

It takes about a minute (`npm install`, build) and does everything that can be scripted: it builds the server,
installs the After Effects panel, allows unsigned panels, and registers the server with Claude Desktop and with
Claude Code (user scope, every project). Read its output. The lines starting `Claude Desktop:` and `Claude Code:` say
what it registered or skipped and why. If it fails, show the user the error; do not edit files in the repo to work
around it.

For another MCP client (Cursor, Codex, Windsurf, VS Code), add a stdio server to that client's config yourself:
command `node`, argument the absolute path of `dist/index.js` in the repo folder, name `ae-motion`.

## 4. Tell the user the steps only they can do

These are settings in After Effects' own UI; there is no supported way to script them. Give the user this list:

1. In After Effects, open **After Effects > Settings > Scripting & Expressions** (macOS) or **Edit > Preferences >
   Scripting & Expressions** (Windows) and turn on **Allow Scripts to Write Files and Access Network**.
2. Restart After Effects, then open **Window > Extensions > AE Motion MCP**. Keep the panel open (dock it, so it opens
   with After Effects).
3. Restart Claude Desktop if it was open (it reads its config at start). In Claude Code, start a new session.

## 5. Check it works

Once the user has opened the panel: the file `~/.ae-motion-mcp/bridge.json` exists. If your client already has the
ae-motion tools (a new session may be needed), call `get_project`: it returns the open project and the After Effects
version. A `BRIDGE_DOWN` error means the panel is not open or the scripting setting is off.

Then suggest a first try, such as: "create a 1920x1080 comp, 5 seconds, with a title that slides in, and show me a
frame".
