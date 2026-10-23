# AE Motion MCP

Ask Claude to make animations in After Effects, and it makes them in your project.

https://github.com/user-attachments/assets/4734d955-5c97-4644-a387-f05d4dc0e2f6

https://github.com/user-attachments/assets/c05af0f1-3f7e-4a31-84ef-cbc0fb87006d

**Full video:** [watch on YouTube](https://youtu.be/XZhw3wOFpBU?si=aVW5Yp-KPTFF2jAl)

## How it works

Claude can't use After Effects by itself. This project gives it a way in, with two parts:

1. **A small program on your computer** that Claude talks to.
2. **A panel inside After Effects** that does what the program asks.

You type *"make a 5 second title that slides in"*. Claude tells the program, the program tells the panel, and the
panel makes the comp, layers and keyframes in your open project. They are normal After Effects layers: you can edit
them, and undo anything.

## What you need

- After Effects 2022 or newer, on a Mac or Windows PC
- Claude Code or Claude Desktop

## Install with Claude (easiest)

1. Paste this into Claude Code, or the **Code** tab of the Claude desktop app:

   ```text
   Install the After Effects MCP server from https://github.com/dha-aa/ae-motion. Follow its INSTALL.md.
   ```

   Claude installs everything. If your computer is missing something it needs (Node.js or git), Claude asks you
   first, then installs it. Claude asks your permission before each command it runs on your computer: that is
   normal, allow them. (Claude follows [INSTALL.md](INSTALL.md), the step-by-step version written for AI agents.)

2. Do the two steps below in After Effects, then tell Claude you're done. Claude checks that everything works.

## Install by hand

1. Install [Node.js](https://nodejs.org) and [git](https://git-scm.com).
2. Open a terminal and run:

   ```bash
   git clone https://github.com/dha-aa/ae-motion.git
   cd ae-motion
   node scripts/update.ts
   ```

3. Do the two steps below in After Effects.
4. Check it: run `node scripts/check.ts --ae` in the same folder. It tells you if anything is missing.

## The two steps in After Effects

Both ways of installing end with these. Only you can do them.

1. **Allow scripts.** Open **After Effects > Settings > Scripting & Expressions** (on Windows: **Edit > Preferences >
   Scripting & Expressions**; older Mac versions say **Preferences** instead of **Settings**) and turn on **Allow
   Scripts to Write Files and Access Network**.
2. **Open the panel.** Restart After Effects, then open **Window > Extensions > AE Motion MCP**. Keep it open while
   you work (dock it, and it opens by itself next time).

Then restart Claude Desktop, or start a new Claude Code session. Now ask in any chat, with your project open in After
Effects: *"Create a 1920x1080 comp, 5 seconds, with a title that slides in, and show me a frame."*

## Need more?

Problems, updating, uninstalling and all the settings: [docs/setup.md](docs/setup.md).
Every command Claude can use: [docs/tools.md](docs/tools.md).

## License

[MIT](LICENSE)
