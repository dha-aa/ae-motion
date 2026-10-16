# Changelog

All notable changes. Versions follow [semantic versioning](https://semver.org); each release is a git tag `vX.Y.Z`, which is what the update check looks for.

## 2.21.0 — 2026-10-16

### Added
- `batch` named steps: give a step `as: "title"` and refer to it as `"$title.id"` instead of counting steps, the most common reference mistake in long builds. A `"$word"` that is not a declared name stays literal text, so `"$TSLA"` in a caption still works; a repeated name, or a name used before its step, is reported before anything runs.
- `batch` `defaults: {tool: args}`: shared arguments merged under every step of that tool (nested objects merge, the step's own values win). Repeated layers such as captions send their `comp_id` and style once instead of in every step, which cut a 48-caption build to about a third of its size.
- `add_layer` `fit: "cover" | "contain"` scales footage, precomps and solids to fill the comp frame or fit inside it (pixel aspect included) and returns the `scale` used, instead of working out a percentage per clip.
- `add_layer` `source_in` and `stretch`: place a clip by the source time it shows at `in` (`{in: 1, source_in: 9.3}`) and its speed, with no start-time maths. Hand-computed start times put the wrong part of a clip on screen twice while building a 3-minute edit.

### Verified
- Live in After Effects 26.3: `fit` cover / contain scales, `source_in` with `stretch`, named steps, `defaults` and a literal `$word` in `batch`; both are now part of the live tests (27/27 pass).

## 2.20.1 — 2026-10-12

### Fixed
- `preview_frame` images show the comp's background in its own colour. After Effects writes the background as transparent pixels, which clients drew white, so light text on a dark comp looked invisible or washed out and a model could "fix" a design that was fine. The returned image is now opaque and matches the comp exactly (the edges were already blended).
- `set_layer` reads back every field it sets: `adjustment`, `guide`, `effects`, `audio`, `quality`, `sampling`, `collapse`, `time_remap`, `frame_blending`, `auto_orient`, `separate_dimensions`, `preserve_transparency`, `solid_color` and `solid_size` were left out of its result.
- `import_footage` `as: sequence` refuses a file whose name has no frame number. After Effects took every image in that folder as one sequence named after the folder.
- A layered PSD or Illustrator comp import says its duration comes from After Effects' still-footage preference (it was 102.9 s), and its `<name> Layers` folder moves into `folder` with the comp.
- About 50 errors now say what to do next (a missing file names the allowed folders, a move starting before 0 s says to start later, stagger on a property with no keys says to animate it first, and so on).

### Verified
- Blend modes and adjustment layers, from preview pixels in After Effects 26.3, now part of the live tests.

## 2.20.0 — 2026-10-12

### Added
- `set_text` `ranges` style part of a text in the same call (After Effects 24.3+): a word in the accent colour, a bold name, one outlined line. Each range is `match` (every occurrence of a string) or `start` / `end` character indexes, with font, size, color, stroke, faux styles, caps, tracking, scale or baseline shift. This used to take a text animator built through several `add_property` calls. Every range is checked against the text before anything changes.
- `get_text` lists the parts styled differently from the first character (`ranges`, only the fields that differ), so a model sees part styling before it changes the text.
- `import_footage` imports several files at once (`paths`), a layered PSD or Illustrator file as a comp of its layers (`as: comp` / `comp_cropped`), and sets the footage's interpretation as it imports: `fps` (image sequences come in at 30 fps whatever they were rendered at, so a 24 fps render played too fast), `loop` and `alpha`. `folder` files the imports in a project folder (made if missing). Every file is checked before any is imported.
- `set_item`, a new tool: rename a project item, set its comment or label, move it into a folder or back to the top level, change a footage item's `fps` / `loop` / `alpha`, or swap its file (or image sequence) for every layer that uses it.
- Footage in `get_project` shows its `fps`, and items inside a folder show `folder_id`.
- `save_project` `clean: true` removes footage no comp uses before saving (imports never placed, sources left behind by `replace_source`), and says how many (`removed_footage`).
- A wrong argument name now says which one was meant: `Unrecognized key: "stagger" (did you mean stagger -> stagger_seconds?)`. The suggestion is a known synonym (the timing tools name the same idea `stagger`, `stagger_seconds` and `offset_seconds`) or a near spelling, so a model fixes the call on the first retry. It costs nothing in the tool definitions.
- `find_sound_cues` `events`: the model says what moments mean (importance 0-1, a label, optionally the sound) and the tool keeps the timing: the nearest motion cue takes the importance and keeps its frame-exact time; an event with no motion becomes its own cue; importance 0 keeps a moment quiet. The meaning comes from the model and the timing from the rules, which a music and sound-effects planner needs.
- `duck_music` `dips`: stretches of near-silence, e.g. 0.35 s before a reveal (measured live: -100 dB through the pause, then the impact). A dips-only call keeps the ducks as they are.
- `set_layer` `audio_fade` (in / out seconds) and `sequence_layers` `audio_crossfade`: equal-power fades, so one music cue crossfades into the next without a dip in level (measured live: within 0.4 dB through a 2 s crossfade).

### Changed
- `stagger` and `shift_layers` say which one moves keys and which moves whole layers, and point to `sequence_layers`.
- `duck_music` ducks by -6 dB by default (was -10): the usual range under narration is 4-8 dB.
- `find_sound_cues` ranks cuts low on their own, so a hit on every cut is no longer the default; story events raise the cuts that matter.
- Volume keys can be set under the ducking expression (`set_keyframes` refused them, and its hint said to clear the expression, which removed the ducking). Springs are still refused there, since they would replace it.

### Fixed
- `set_text` with new text now says when it removed part styling (`ranges_cleared: true`): After Effects gives every character the first one's style when the text changes. Passing the same text no longer reassigns it, so part styling survives.
- `find_sound_cues` cues a scale pop when the layer arrives (97% of the way), not at its last key: with a spring or snappy ease the last key is where it only settles, up to 15 frames after the hit. An entrance that pops and fades in is now one cue instead of two competing ones. Found by building a 12-second documentary reveal and checking where the impact belongs.
- The after-render check no longer calls a dark title card with a line of text a black picture (and no longer suggests a GPU failure for it): a frame now counts as black only when 99.9% of it is dark.

## 2.18.0 — 2026-10-11

### Added
- `set_property` takes `layer_ids`: the same value on many layers in one call (13 coins, 10 ingots), every layer checked before any changes.
- `save_project` `snapshot: true` (with an optional `note`) keeps a numbered copy in `snapshots/` next to the project, so going back to an earlier version is `open_project` on that copy instead of rebuilding it from memory.
- `render_start` `start` / `end` (seconds) render part of a comp, and `draft: true` uses the Draft Settings template: a quick moving preview of a few seconds, where `preview_frame` only shows stills.
- `preview_frame` names the scene each frame shows in an edit (`scene`, or `scenes` for a contact sheet): the top precomp playing at that time.
- `add_layer_style` accepts the Layer Style panel's labels where the match name differs: `size` (blur), `spread` / `choke`, `angle`, `altitude`, `blend_mode`, `range`, `technique`.

### Fixed
- `render_start` always passes the comp's frame range to `aerender`, and a finished file shorter than that fails the job. A render once stopped at 54 of 2,422 frames, exited 0 and was reported as done with a clean check.
- A new text layer no longer inherits the last text's character settings (After Effects takes the Character panel's current ones): `add_layer` starts text from tracking 0, no faux styles or caps, auto leading, 100% scale, before any `text_style`.
- `set_track_matte` and `add_layer_style` warn when a 3D layer has layer styles: After Effects then ignores its track matte and draws it in stacking order instead of by depth (verified live; even a style switched off does it).
- `review_motion` checks text against the title-safe margin on its last frame too, not only mid-way: camera pushes carried titles out of frame by the end, where the check never looked.
- `batch`: a `"$N.path"` reference inside an array (e.g. `layer_ids: ["$1.id", "$2.id"]`) was rejected by the pre-check ("expected number, received string") although it resolves to a number when the step runs. Zod reports array positions as numbers and the comparison only matched strings.

## 2.17.0 — 2026-10-11

### Added
- `animate` moves for holds: `push` (a slow scale-up, default 4%) and `drift` (a slow float), from where a layer's animation lands to its out point, keeping the landing's ease (a spring still lands exactly). In review, frozen holds after the build were the most common flaw.
- Design rules for the model in the server instructions and `motion-guide`, as a senior motion designer and video editor would work: sizes relative to the comp's short side so they fit landscape, vertical (9:16 social) and square; the safe areas social apps cover; copy kept exactly as given; timing (move within 0.2 s, finish the build by 40%), keeping holds alive, polish (soft-edged glows, depth, one accent colour); and for footage: cutting on action or the beat, shot lengths, hooks, trimming dead air, b-roll over jump cuts, framing and reframing for vertical, text over video and captions, sound levels and delivery loudness.
- `review_motion` checks: a late first move (after 0.3 s); changes too small to see no longer count as motion, so a wobbling layer still shows as a hold; text crossing the 5% title-safe margin, or in vertical comps the top 10% and bottom 20% that social apps cover; small text judged against 3% of the comp's short side (was 2.2% of its height).

### Changed
- `preview_frame` is 5-7 times faster: about 0.1 s per frame instead of 0.6 s, 0.2 s for a six-frame sheet instead of about 3 s. It returns as soon as the PNG is complete (its IEND chunk) instead of polling the size in 150 ms steps, and renders at the coarsest resolution that still covers the returned image instead of always at full resolution.
- `get_project` lists each comp's layers (unless the project has over 300), and `set_keyframes` returns the keys as set, so a model needs fewer calls; the server instructions ask it to make independent calls together and not to re-read what a result already shows.

### Fixed
- `get_project` works on big projects: it used to stop at 500 items and, past roughly 300 items with real file names, went over the size limit and failed with no way to ask for less. It now takes `name` (substring) and `type` filters and pages with `limit` (default 200) / `offset`, reporting `matched` and `next_offset` like `get_comp` (the `truncated` field is gone). The 300-layer limit for listing each comp's layers now counts the comps on the returned page, so paging also brings layers back on big projects.
- `list_markers` pages with `limit` (default 100) / `offset` and returns `next_offset`, instead of stopping at 500 markers.
- `set_playhead` and `set_3d_view` are no longer marked destructive: they only change the viewer.
- The update instructions `get_project` and `check_for_updates` give for updating by hand said `git pull`, which fails in the state the panel's Update button leaves the repo in (a release tag, not a branch). They now say `node scripts/update.ts`, which checks out the newest release and runs the installer.
- `set_light`'s `point_of_interest` was described as where a camera looks.
- Errors that left the model guessing now say what to do: an unknown `blend_mode` lists the valid names, an unknown render job explains that jobs are forgotten when the MCP server restarts, a marker property points to the marker tools (not `run_jsx`), and "not keyframable", "does not support expressions", a missing preset and failed menu commands (`text_to_shapes`, `add_layer_style`) have hints.
- The `ae://project` and `ae://selection` resources return compact JSON, and a failed read is now a resources/read error (with the code and hint) instead of the error body returned as if it were the resource.

### Removed
- The evaluations (`evals/`): the question and build-task runs through headless Claude Code. The live tests (`test/live/run.ts`) stay.
- The hard limit on the size of the tool definitions (`npm test` prints the size instead).

## 2.16.0 — 2026-10-11

### Changed
- Back to the 2.13.0 code: everything from 2.14.0 and 2.15.0 is undone (the compact schemas, `run_jsx` hidden when disabled, the core-toolset default and its reversal, the six extra build evaluations, the split `review.ts` / `sound.ts` host files, the constant-time token check, and the removed tool-list budget). Reopen the panel after updating. The undone work is kept in the git history and on the `backup-speed-quality` branch.

## 2.15.0 — 2026-10-11

### Changed
- All tools are loaded by default again (`AE_MCP_TOOLSETS=core` is still there to opt in). With core as the default (2.14.0) the evals kept their scores on about 40% fewer input tokens, but cost only 2-8% less, because most of the input is cached and cached tokens are cheap, and ran 12-20% slower; and the model rebuilt camera moves, alignment and 3D settings from keyframes instead of loading `camera_move`, `align_layers` and `set_3d`. The smaller schemas and the hidden `run_jsx` from 2.14.0 stay: they cut 5-7% of the tokens with no such side effect.
- No hard limit on the size of the tool definitions any more (`npm test` prints it).

## 2.14.0 — 2026-10-11

### Changed
- The server starts with the core tools by default (`AE_MCP_TOOLSETS=core`: comps, layers, keyframes, text, effects, motion, previews, renders), about 9k tokens of tool definitions per request instead of 16k; the model adds 3D and cameras, timeline and markers, masks, layout and audio with `load_tools`, whose description now lists each group's tools. In the evals this kept every score (10/10 questions, 13/13 build tasks) on 35-38% fewer input tokens. `AE_MCP_TOOLSETS=all` loads everything up front as before.
- Smaller tool schemas for every tool set: plain-type unions are written as one type list, add_shape's shape and the easing options are advertised by reference (still validated strictly), and layer_ids' "same comp" is said once in the server instructions. About 4% smaller with all tools loaded.
- `run_jsx` is only listed when `AE_MCP_ALLOW_JSX=1`; before, every request carried the definition of a tool that could only refuse.

- The panel compares the bridge token in constant time.
- The largest host files are split: `review_motion` moved to `host/commands/review.ts`, sound effects and sound cues to `host/commands/sound.ts` (a pure move: host.jsx has the same code lines).

### Added
- Six more build evaluations (a camera push-in, a word-by-word text reveal, a wipe transition at a cut, beat markers from a music track, spring pop-ins, a 3D layer), each check confirmed to fail on the untouched project and pass on a correct solution, and the input tokens per question in every eval run. The fixture gains a synthesized 120 BPM music track.

## 2.13.0 — 2026-10-10

Update the panel too (the Update button, or reinstall), then reopen it: the timeout fix lives in the panel.

### Fixed
- The panel's Update button installed whatever was on `main`, which can hold merged but unreleased work, while the update notice named the newest release. It now runs `scripts/update.ts`, which checks out the newest release tag and then runs the installer; it stops if you have local changes (a `package-lock.json` rewritten by npm doesn't count). Run it by hand with `node scripts/update.ts`.
- A command that timed out while waiting behind a slow one still ran later, out of the model's sight. The panel now drops a queued command once its caller has given up, and the `TIMEOUT` error says which happened: the command was waiting behind another one and never ran (safe to retry), or After Effects is still busy with it (it finishes on its own: inspect before retrying).

### Changed
- The After Effects side (`host/`) is TypeScript throughout, strict, instead of ES3 JavaScript with a two-file TypeScript pilot. Each command's arguments are typed from the server's own tool schemas (`host/args.d.ts`, generated by `npm run build`), so a renamed argument fails the type check instead of reading `undefined` in After Effects. The conversion only added types: compiling the old and the new code with the same compiler gives the same JavaScript, file by file.
- Dependencies at their latest versions: zod 4 (from 3), the MCP SDK 1.32 (from 1.12), TypeScript 7 (from 5.9). Every object schema is now a `z.strictObject`, and a static check rejects a plain `z.object`, so unknown keys keep failing at any depth. TypeScript 7 can't produce ES5 any more, so the host is compiled by TypeScript 5.9 (installed as `typescript-es5`) while TypeScript 7 type-checks everything. `@types/node` stays on 22, the oldest Node ae-motion supports.
- Tool definitions are 102 characters smaller (68,893): zod 4 no longer copies the `offset` description of `beat_markers` onto `start` and `end` (a zod 3 bug), and record schemas no longer state that keys are strings.

### Added
- Live tests (`node test/live/run.ts --yes`): 21 checks of the behaviours the mock tests model (layer timing, frame snapping, track mattes, parenting, markers, keyframe easing, springs, cameras, alignment and more) against a real After Effects, so a mock that no longer matches After Effects shows up. Run before a release; CI has no After Effects.
- Build evaluations (`node evals/run.ts --build`): seven tasks that change the test project, each graded by a check that reads the result through the tools. The existing ten questions only read.
- Tests for the panel (`test/panel.test.ts`: the real `panel/main.js` with a fake CEP, driven by the server's bridge) and the update script (`test/update-script.test.ts`).
- `docs/future.md`: Adobe's move from CEP to UXP in After Effects (public beta targeted for November 2026, CEP off by default from December 2028 and removed in December 2029) and what it would mean for ae-motion's panel, host and bridge.

## 2.12.0 — 2026-10-10

### Added
- `evals/`: ten read-only questions about a fixed test project (built by `evals/build-fixture.ts`) that check a model can find its way around a real After Effects project with ae-motion's tools alone. `node evals/run.ts` runs them through headless Claude Code, so no API key is needed, and reports the score, tool calls per question and each answer's notes on what made it harder.
- `get_layer` takes `layer_ids` to read several layers in one call. Read-only clients can't use `batch` (it can change things, so it isn't marked read-only), and in the first eval run models fetched layers one by one, up to 8 calls in a row.
- `get_layer` includes a text layer's `text`, and layer info (`get_layer`, `get_comp` rows) has `source_id` for precomp and footage layers: the comp or footage item it plays. Before, a model had to guess which comp a precomp layer showed from its name.

### Changed
- `get_keyframes` on a property without keys returns its `value` (before any expression). Before, it returned only an empty key list, so reading an effect setting such as a blur amount needed `list_properties`.

## 2.11.3 — 2026-10-10

### Added
- `CONTRIBUTING.md`: strict rules for changing ae-motion (design, ExtendScript, server code, tests, live verification, docs, shipping) and a pre-merge checklist, each rule backed by the incident that made it necessary. Linked from `CLAUDE.md`, the README and `docs/development.md`.

### Changed
- Bad arguments (a schema failure, caught before any tool runs) now come back in ae-motion's error format, `{error: {code: "BAD_ARGS", message, hint}}`, like every other error, in place of the SDK's raw "MCP error -32602: Input validation error: ..." text; they are still `isError` tool results (as the MCP spec asks, so the model can correct and retry) and now count in the token meter.

## 2.11.2 — 2026-10-10

### Fixed
- CI: the render-progress test (C3) waited a fixed 1.6 s for the fake renderer's frames and failed on slower macOS runners; it now waits for the frames, and failing server tests print the values they saw.

### Changed
- The panel's token meter shows just two numbers: this session's tokens and the tool definitions per request (the text / image split, calls, daily total and costliest tools are gone). The session is the latest one that made tool calls, so tests and helper scripts no longer show up as "(+43 other)".

## 2.11.1 — 2026-10-10

### Fixed
- A delivery render could fail with "master not found": aerender can exit a moment before its file is on disk, so the render manager now waits for the file to settle before encoding and checking.
- The ES3 lint now flags Java reserved words used as names (`long`, `int`, `final` and so on): one stops After Effects loading host.jsx at all, which is how it was found.
- The render check's frozen-picture test read a small figure moving on a plain frame as frozen (noise threshold 0.003, now 0.0005).

## 2.11.0 — 2026-10-10

Everything that got in the way while making a 60 s documentary film with ae-motion: the tools now check their own
output (renders, mixes, what the camera sees), and the jobs that needed raw scripts have options.

### Fixed
- `preview_frame` rendered at the comp's lowered viewer resolution on heavy comps (text looked broken) and gave up after 10 s on heavy 3D frames: it now renders full resolution (the setting is restored) and waits up to 45 s.
- `duck_music` (loudness and auto modes), `beat_markers`, `audio_react`, `find_sound_cues` and `add_sfx` peak alignment analysed the wrong part of the comp for audio that starts after the current work area ends: the work area was shrunk to one frame and then moved, and After Effects 26.3 moves the end, not the start, so the analysis heard silence (a narrated film got no ducks under its later voice-over). The work area is now opened to the whole comp, then set and checked; `set_comp work_area` uses the same helper.
- `render_status` reported a render as `done` when aerender exited 0 after running out of GPU memory, which leaves every later frame black and drops the audio. Error lines are now collected (`errors`, with a `hint`), and a GPU failure fails the job.

### Added
- Render checks (with ffmpeg): every finished render is checked for black, frozen and silent stretches and its loudness (with a per-second timeline), reported by `render_status` as `check` with plain-words issues; `verify: false` skips it. This catches a GPU failure's black frames and dropped audio as soon as the render ends.
- `render_start deliver: true`: a ProRes master encoded into a ready-to-post H.264 MP4 at `loudness` (default -14 LUFS, -1 dBTP), and `audio_only: true`: the mix alone in seconds, to check it before rendering the picture.
- `review_motion` scene checks: layers hidden behind an opaque one (by camera depth in 3D), off screen, and text partly covered (a letterbox bar); computed read-only from the transforms and the camera.
- `set_keyframes merge: true` keeps keys at other times; both modes report `replaced`.
- `camera_move spatial: "linear"`: straight motion paths between waypoints (no auto-bezier overshoot).
- `set_3d z`: depth only, keeping x/y and every position key.
- `open_project new: true`, and `set_layer sampling: "bicubic"` for sharp scaled images.
- `add_layer` `fit_to`: a rect that keeps fitting a text layer's bounds plus padding (highlights, pills, buttons).
- `batch` resume: a failed batch returns `batch_id`; resend the fixed steps with `resume: {batch_id, from}`. The skill driver's scripts save their results and resume with `--from N`.
- `render_status` says how long a render still needs: `frames_done` / `total_frames`, `elapsed_s`, `seconds_per_frame` (over the recent frames, so a heavy scene updates it), `eta_s` and `finishes_at`, and `poll_after_s` (a quarter of the time left, 5-60 s) so a client neither polls every second nor waits blind; `phase: "starting"` until aerender has loaded the project. Frames are counted, so a partial render's percent is right too.
- `render_start software: true` renders with Mercury Software Only (set in the project before aerender starts; `false` goes back to the GPU).
- `batch`: `"$$"` is a literal dollar, so text that starts with `$` and a number (a price, `"$$99"`) no longer reads as a reference to a step; the reference error says how to escape it. The skill driver's scripts take the same escape.

## 2.10.0 — 2026-10-09

Fewer tokens per result and per request, measured on the 127-layer reel comp: `get_comp` 4,167 -> 2,591 tokens (38 % less), `list_properties` 4,444 -> 584 (87 %), `review_motion` 1,390 -> 252 (82 %), `get_keyframes` 429 -> 339 (22 %), `get_project` 877 -> 714 (19 %); tool definitions 72.0k -> 68.2k characters (about 1k tokens per request) while adding options.

### Added
- `get_comp` filters and paging for big comps: `name`, `kind`, `at` (layers visible at a time), `limit` / `offset` (`matched`, `next_offset`), and `kinds` (layer counts by kind).
- `list_properties` `all` and `review_motion` `all` to get the full output back.

### Changed
- `get_comp` layer rows leave out the comp id, index and label, and `in` / `out` / `start` at their defaults (documented in the server instructions).
- `list_properties` skips the marker, empty groups, unused layer styles, 3D-only options on 2D layers and hidden X/Y/Z position by default, and cuts very long expressions; only indexed groups' children carry `index`.
- `get_keyframes` (and `edit_keyframes`' result) shows temporal ease only on bezier sides and as one `{speed, influence}` or `"easy"` when every dimension shares it: the form the keyframe tools take.
- `review_motion` merges the same issue on several layers into one entry (`layer_ids`) and counts info notes in `stats.info`.
- `get_project` leaves out the (zero) frame size of audio items.
- Advertised schemas: nested `additionalProperties: false` and descriptions that only restate the key (`Layer id`) or the conventions in the server instructions are dropped (validation is unchanged); `set_3d` scale and orientation now say % and degrees (they said px). The panel's token meter counts only what the model sees of the definitions (name, description, schema).

## 2.9.0 — 2026-10-09

### Added
- A token meter in the After Effects panel: an estimate of what ae-motion adds to the model's context in this session (tool-result text and preview images, with a split bar), the size of the tool definitions each request carries, today's total across sessions, and the three costliest tools. The server (`src/usage.ts`) estimates text at about 3.6 characters per token and images at width x height / 750 (Anthropic's formula), and writes `usage/<pid>.json` next to the bridge file; the panel reads it every 2 s. The server cannot see the client's real counts, so your messages and the model's replies are not included.

## 2.8.3 — 2026-10-09

### Added
- `camera_move` `combine: true` layers a move over the camera's existing animation instead of replacing the keys in its range, so a dolly and a truck (or a pan during an orbit) over the same seconds add up; keys after the move keep its final offset.
- `add_shape` `at: "bottom"` adds the group below the others and keeps every existing group's index (the default `top` makes it group 1 and moves the others down one, which the description now says).
- `duck_music` `min_level` (default -9 dB): quieter effects no longer trigger ducks. The result reports `coverage` (share of the music ducked), `ignored_quiet`, and a `note` when ducks would cover more than half the music (a lower music level is the better fix then).

## 2.8.2 — 2026-10-09

### Changed
- `find_sound_cues` picks cues the way a sound designer would: what happens on one frame is one cue (`layer_ids` lists the layers; entrances on a cut become one `hit`), cues are ranked (`priority`, `tier` hero / major / minor; landings always rank first) and only the most important are kept, spaced out, by `density` (sparse / normal / dense) or `max` and `min_gap`; `skipped` says how many were left out. A `text_reveal` is one cue for the whole reveal instead of nothing (or one per letter).

### Added
- `add_sfx` `lead_in`: keep only that much of a sound before its hit (cuts a cinematic impact's long build-up, with a short fade). It returns `hit`.

### Fixed
- `add_sfx` `max_duration` trimmed from the file's first frame, so with peak alignment it could cut the sound off before its hit (the hit never played). It now counts from the hit (from the first frame with `align: "start"`).
- `review_motion` reported a word or line `text_reveal` as cut off by the layer's out point: it estimated the reveal's length from the letter count. Reveals now record their unit count.

## 2.8.1 — 2026-10-09

### Fixed
- `batch` failed on input shapes models often send: `steps` or `args` as a JSON string, `name` / `arguments` / `params` instead of `tool` / `args`, and client-prefixed tool names (`mcp__ae-motion__add_layer`). These are now accepted.
- `batch` turned results over the size limit into an error after every step had already run (inviting a re-run that duplicated layers); they are now shortened to ids and names.
- Server-side tools (`get_project`, `render_start`, `render_status`, `check_for_updates`) can be batch steps; `preview_frame` is refused up front instead of failing.

### Added
- `batch` sends a progress notification after each step when the client passes a progress token, so long batches need not time out.

## 2.8.0 — 2026-10-09

### Added
- A `motion` tool group (part of `core`) for finished-looking motion in one call each:
  - `animate`: named entrance and exit moves (fade, pop, grow, slide, drop, spin) keyed from each layer's rest values, with snappy, smooth, spring, bounce or linear curves, stagger and order. Springs are closed-form step responses in an expression on linear keys, so they scrub and render identically and land exactly on the key.
  - `text_reveal`: per-character, word or line reveals (rise, drop, fade, pop, blur, typewriter) through a text animator and an expression selector, in forward, reverse, center or random order, optionally masked so letters rise from behind a line.
  - `transition`: wipe, staggered bars or iris shape transitions that cover the frame at the cut.
  - `review_motion`: a motion critic that needs no render: linear keys, dead holds, unison starts, entrances with no animation, cut-off moves, jumps, small text and beat sync.
- Springs on any property: `interp: "spring"` / `"bounce"` on a key in `set_keyframes` and `edit_keyframes` springs the segment to the next key (effects, masks, cameras, anything keyframable); `get_keyframes` reports them, and moving or deleting a key keeps the spring in step.
- The `motion-guide` prompt has motion-craft rules (timing, overlap, beat pacing, what to avoid) and a review loop.

## 2.7.0 — 2026-10-09

### Added
- `duck_music`: lower the music under voice-over and sound effects, with eased attack and release; long layers duck only where they are heard. Ducks are "duck" markers on the music read by one expression, so its own volume keys keep working.

## 2.6.0 — 2026-10-09

### Added
- `find_sound_cues`: list where a comp's animation wants sound effects (whoosh at a move's peak speed, impact on abrupt landings, pop on scale pops, typing, swipe), from its keyframes.
- `add_sfx`: place a sound file so its loudest moment lands on a cue (or its start), with volume in dB, fades and trimming; repeated files are imported once.
- A `volume` property alias (audio levels in dB; a number sets both channels) for `set_property`, `set_keyframes` and `edit_keyframes`.

### Changed
- The audio tools (`beat_markers`, `audio_react` and the two above) are their own tool group, `audio` in `AE_MCP_TOOLSETS` (not part of `core`).

### Fixed
- The amplitude analysis left an "Audio Amplitude" solid in the project each time; its source item is now removed with it.

## 2.5.0 — 2026-10-09

### Added
- `beat_markers`: put markers on an audio layer's beats, detected from loudness (After Effects' Convert Audio to Keyframes) or from a BPM grid; returns the beat times and the tempo. With `align_to_markers` this cuts layers to the music.
- `audio_react`: drive any property of many layers with the music's loudness (pulse, bounce, glow), through one shared amplitude null.

## 2.4.1 — 2026-10-08

### Fixed
- **`add_layer`, `set_layer` and `set_text` were refused by the Claude API** (so Claude Code could not use them) since 2.1.0: their `box_size` / `solid_size` schemas used draft-07 tuple `items`, which is invalid under JSON Schema 2020-12 once the `$schema` header was dropped. Tuples are now advertised as a plain `items` schema, and the tests compile every tool schema as JSON Schema 2020-12.

## 2.4.0 — 2026-10-08

### Added
- `find_fonts`: search installed fonts by family, style or PostScript name (After Effects 24.0+).
- `add_layer` takes `text_style` (set_text's styling) and `anchor` (as set_anchor), applied before `position`: styled, centered text in one call instead of four.
- `set_expression` takes `layer_ids`: one shared expression on many layers in one call.

### Changed
- `batch` checks every step before running any and lists all problems at once; a bad argument no longer leaves a half-run batch.
- `set_text` (and `add_layer` `text_style`) refuse a font that is not installed instead of silently keeping the old one (After Effects 24.0+).

## 2.3.0 — 2026-10-08

### Added
- **Update button in the After Effects panel:** "Update to vX.Y.Z" (or "Reinstall") runs `git pull` and the installer, shows the output, loads the new host script and restarts the panel. The installers now write `install.json` (repo folder, and a PATH that finds git, node and npm, which After Effects started from the Dock cannot). A panel installed before 2.3.0 needs one manual update first.
- `load_tools`: with `AE_MCP_TOOLSETS` (e.g. `core`: about 7.5k tokens of tool definitions instead of 16k) the server adds the left-out tool groups during the session and tells the client (`tools/list_changed`); the new tools also run through `batch`. The README's Claude Desktop example uses `core`.

### Fixed
- `set_anchor`'s description named a wrong argument (`to`; it is `anchor`).

### Removed
- The MCP evaluation (`evals/`) and its fixture project.

## 2.2.0 — 2026-10-08

### Added
- `batch`: run up to 50 tool calls in one call, with `"$N.path"` references to earlier results (`"$1.id"`). Each step is validated and sandboxed like a direct call. Building a scene takes a couple of calls instead of dozens, the largest token saving.
- `preview_frame` takes up to 9 times and returns them tiled into one contact sheet, and a `size` option.

### Changed
- `preview_frame` shrinks the image it returns (768 px on the longest edge by default; the full-size PNG stays on disk): about 440 tokens instead of 1,530 for a full HD frame, and six frames in one sheet about 670 instead of 9,200.
- Shorter results: tools that change layers return `{id, index, name}` (timeline tools and `duplicate_layer` add timing, `set_layer` the fields passed), `set_keyframes` returns `num_keys`, comp info and `list_properties` leave out defaults.
- Smaller tool list (about 16.9k tokens, from 21.8k in 2.1.0 and 25.9k in 2.0.0): shorter descriptions, refs inlined, numeric bounds left to validation, the shape spec referenced instead of repeated.

## 2.1.0 — 2026-10-08

### Added
- `open_project` opens an `.aep` (refuses to discard unsaved changes unless asked).
- Layer info reports `blend_mode` and `motion_blur`.
- `AE_MCP_TOOLSETS` loads only some tool groups, so the model gets fewer tool definitions (`core`: 38 tools, about half the tokens).
- An MCP evaluation (`evals/`): 10 read-only questions on a fixture project.

### Changed
- Lower token cost. Tool definitions are about 16% smaller (shorter shared descriptions, no per-tool `$schema`, the shape spec only where a shape is accepted). Typical results are about 35% smaller: layer and key info leave out default values (a missing flag means false, blend mode `NORMAL`, stretch 100, enabled, no parent), `set_text` reads back only the fields set, and `edit_keyframes` returns only the edited keys. Non-integer numbers are rounded to 6 significant digits.
- `run_jsx` is the tool of last resort: its description and the server instructions point to the dedicated tools first.

## 2.0.0 — 2026-10-07

**Breaking:** Node.js 22.18 or later is required (the build, tests and scripts run TypeScript directly).

### Added
- **Update notices:** the server checks GitHub for a newer release at most once a day (`AE_MCP_UPDATE_CHECK=0` turns it off); `get_project` carries an `update` note, `check_for_updates` asks directly, and the After Effects panel shows the installed version and an "update available" line.
- **Design tools:** `align_layers` (align and distribute by visible content), `set_anchor`, `add_shape` (dashes, caps, joins), `add_layer_style` (9 layer styles), `text_to_shapes`; `get_layer` reports bounds.
- **Keyframe editing:** `edit_keyframes` (single keys: value, easing, motion-path tangents, roving; move, delete), `copy_animation`; separate dimensions and auto-orient in `set_layer`.
- **Timeline editing:** `insert_time` (ripple insert), `align_to_markers` (cut to a beat), `update_marker`, `trim_comp`, `replace_source`; `delete_range` can move markers.
- **Paths and motion blur:** mask and shape paths can be keyframed (morphs); comp motion blur and frame blending switches.
- More `set_layer` switches: guide, adjustment, effects, audio, preserve transparency, solid color and size, frame blending, quality, collapse; `precompose` can leave attributes.
- `run-ae-motion` agent skill with a driver for running and testing against a live After Effects.

### Changed
- Strict input validation: unknown arguments are rejected instead of silently ignored.
- Every tool has a title and MCP annotations (read-only, destructive, idempotent, open-world).
- Results are compact JSON, capped at 25,000 characters with a hint to narrow the request.
- `stagger` and camera rigs keep easing and motion-path curves.
- Project restructured: server tools in `src/tools/`, ExtendScript in `host/` (built into `panel/host/host.jsx`), docs in `docs/`, CI on macOS, Linux and Windows.

### Fixed
- `add_property` treated the match name as a file path, so text animators could not be added.
- Rect-to-ellipse path morphs twisted; ellipse vertices now line up with rect corners.

## 1.0.0

Initial version: 52 tools for comps, layers, keyframes, text, masks, effects, 3D cameras and lights, preview frames and `aerender` renders.
