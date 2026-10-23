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

## What Claude can do in After Effects

78 tools, grouped by what they're for. You never call them yourself: ask in plain words, and Claude picks the right
ones.

| Area | Ask for things like | Tools |
|---|---|---|
| **Look around** | "What's in this project?" | `get_project` `get_comp` `get_layer` `list_properties` `get_keyframes` `find_effects` |
| **Project and comps** | "Make a 1080x1920 comp for Reels" | `open_project` `save_project` `create_comp` `set_comp` `import_footage` `set_item` `delete_item` |
| **Layers** | "Add a title and a logo, parent the logo to it" | `add_layer` `set_layer` `link_layers` `replace_source` `delete_layer` `duplicate_layer` `reorder_layer` `precompose` |
| **Timeline and editing** | "Cut 3s to 5s out and close the gap" | `split_layer` `delete_range` `insert_time` `shift_layers` `sequence_layers` `align_to_markers` `trim_comp` `set_playhead` `add_marker` `update_marker` `list_markers` `delete_marker` |
| **Masks and mattes** | "Reveal the text through a wipe" | `add_mask` `set_track_matte` |
| **Layout and design** | "Center the title and give it a soft shadow" | `align_layers` `set_anchor` `add_shape` `add_layer_style` `text_to_shapes` |
| **Animation and effects** | "Ease the logo in, then add a glow" | `set_property` `set_keyframes` `edit_keyframes` `copy_animation` `set_expression` `add_property` `apply_effect` `edit_effect` `apply_preset` `set_text` `get_text` `find_fonts` `stagger` `add_shape_modifier` |
| **Ready-made motion** | "Pop the cards in with a spring" | `animate` `text_reveal` `transition` `review_motion` |
| **3D and camera** | "Orbit the camera around the product" | `get_camera` `set_camera` `camera_move` `camera_shake` `camera_rig` `set_3d` `set_light` `set_3d_view` |
| **Audio** | "Cut the clips to the beat, duck the music under the voice" | `beat_markers` `audio_react` `find_sound_cues` `add_sfx` `duck_music` |
| **Preview and render** | "Show me frame 2s, then render an MP4" | `preview_frame` `render_start` `render_status` `render_cancel` |
| **Power tools** | "Check for updates" | `batch` `check_for_updates` `run_jsx` (off unless you turn it on) |

How each one works: [docs/tools.md](docs/tools.md).

## Contributing

Bug reports, ideas and code are all welcome.

- **Found a bug?** [Open an issue](https://github.com/dha-aa/ae-motion/issues) with your After Effects version, Mac
  or Windows, what you asked Claude, and what `node scripts/check.ts --ae` prints.
- **Want to change the code?** Start with [CONTRIBUTING.md](CONTRIBUTING.md): it gets you set up in three commands,
  and the tests run without After Effects.
- **Working with an AI agent?** Point it at [AGENTS.md](AGENTS.md): it says what to read first.

If ae-motion saves you time, a star on GitHub helps other editors find it.

## Need more?

Problems, updating, uninstalling and all the settings: [docs/setup.md](docs/setup.md).

## License

[MIT](LICENSE)
