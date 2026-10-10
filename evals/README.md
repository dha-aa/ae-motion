# Evaluations

Unit tests prove the tools behave; these check the tool descriptions and results are clear enough for a model to use
well, on a real After Effects project (nested comps, layer timing, markers, effects, expressions, text, track mattes,
parenting and camera keys). Two sets:

- **Questions** (`evaluation.xml`): ten questions answered with **only the read-only tools**, graded on the answer.
- **Build tasks** (`build-tasks.ts`, `--build`): thirteen changes to make (an eased text layer, a fade-out, a re-timed
  stagger, markers, an effect value, a re-timed camera key, centring a layer, a camera push-in, a word-by-word text
  reveal, a wipe transition at a cut, beat markers from a music track, spring pop-ins, a 3D layer). The model also gets the tools that
  change things; afterwards each task's `check` reads the project through the tools and lists what is wrong.

Watch the score, the tool calls per question, and each answer's `summary` (the model is asked to say what made it
harder).

| File | What it is |
|---|---|
| `build-fixture.ts` | writes `fixture.jsonl`, the driver script that builds the fixed test project |
| `fixture.jsonl` | generated (gitignored): the driver script, naming the synthesized music in the temp folder |
| `evaluation.xml` | the questions and answers (the mcp-builder skill's format), verified in AE 26.3 |
| `build-tasks.ts` | the build tasks and their checks; each check was confirmed to fail on the untouched fixture and pass on a correct solution |
| `run.ts` | the runner |

## Running

```bash
npm run build
node evals/run.ts                 # rebuilds the fixture (replaces the open project: save first), then asks all 10
node evals/run.ts --no-build --only 3,7 --jobs 3 --model sonnet
node evals/run.ts --build         # build tasks: rebuilds the fixture before each task (one at a time)
node evals/run.ts --build --only 2,6
node evals/run.ts --toolsets all  # the server with every tool group loaded (default: core, the others via load_tools)
```

The fixture includes a music track synthesized by `build-fixture.ts` (clicks on a 120 BPM grid, written to the temp
folder), so `fixture.jsonl` names a temp file and is generated, not committed. Each run prints the input tokens per
question (most of it the cached tool definitions and earlier turns) and records them per answer.

- **No API key.** Each question is a fresh headless Claude Code session (`claude -p`) on your Claude Code login,
  so it counts against your plan's usage. A usage limit stops the run and lists the questions not run (they are not
  counted as wrong). The `cost` it prints is what the same run would cost on the API, as Claude Code reports it.
- **Isolation.** Only the ae-motion server (`--strict-mcp-config`) with its default tool set, no built-in tools,
  started in an empty temp directory so no project `CLAUDE.md` loads. Questions allow only the tools whose `readOnlyHint` is true; build
  tasks allow the rest too, except `run_jsx`, rendering, and opening, saving, importing or deleting project items.
  Calls to other tools are denied and counted.
- **Needs After Effects** with the ae-motion panel open, so it does not run on CI.
- Results go to `evals/results/<time>.json` (gitignored): per question the answer, pass, tool calls by name,
  denials, turns, seconds and the model's summary.
- The mcp-builder skill's own `evaluation.py` runs the same `evaluation.xml` through the Anthropic API instead
  (needs `ANTHROPIC_API_KEY`).

## Changing questions and tasks

Questions must be read-only, independent, have one stable answer, and need several tool calls. A build task's check
should test only what the task states, with a frame of tolerance; confirm it fails on the untouched fixture and
passes after you make the change by hand. Edit
`build-fixture.ts`, regenerate, rebuild in AE, then check every affected answer with the read-only tools before
committing (`node .claude/skills/run-ae-motion/driver.ts call get_comp '{"comp_id": N}'` and so on).

## Results so far

| Date | Version | Model | Score | Tool calls / question | Notes |
|---|---|---|---|---|---|
| 2026-10-10 | 2.11.3 | default | 10/10 | 9.2 | `batch` denied in 5 questions; layers fetched one by one; precomp source guessed from comp times |
| 2026-10-10 | 2.12.0 | default | 10/10 | 5.6 | `get_layer layer_ids`, `source_id`, layer `text`, `get_keyframes` static `value` |
| 2026-10-10 | 2.13.0 | default | 10/10 | 5.5 | host in TypeScript, zod 4, SDK 1.32: unchanged behaviour |

From here with input tokens per question (cached share in brackets), on the fixture with the music track:

| Date | Version | Tool set | Score | Calls / question | Input tokens / question | Notes |
|---|---|---|---|---|---|---|
| 2026-10-11 | 2.13.0 | all | 10/10 | 5.3 | 168k (97%) | baseline |
| 2026-10-11 | unreleased | all | 10/10 | 5.0 | 156k (96%) | compact schemas, run_jsx only when enabled |
| 2026-10-11 | unreleased | core | 10/10 | 5.7 | 109k (95%) | core by default, load_tools lists tool names; 2 questions tried `batch` (not read-only) after load_tools |

Build tasks:

| Date | Version | Model | Score | Tool calls / task | Notes |
|---|---|---|---|---|---|
| 2026-10-10 | 2.12.0 + unreleased | default | 7/7 | 6.0 | first run; `batch` for repeated steps, `edit_keyframes` move kept the camera key's value, nothing denied |
| 2026-10-10 | 2.13.0 | default | 7/7 | 6.1 | host in TypeScript, zod 4, SDK 1.32 |

Thirteen tasks, with input tokens per task:

| Date | Version | Tool set | Score | Calls / task | Input tokens / task | Notes |
|---|---|---|---|---|---|---|
| 2026-10-11 | 2.13.0 | all | 13/13 | 6.2 | 204k (98%) | baseline |
| 2026-10-11 | unreleased | all | 13/13 | 6.0 | 194k (98%) | compact schemas, run_jsx only when enabled |
| 2026-10-11 | unreleased | core | 13/13 | 6.3 | 126k (96%) | load_tools for markers and beats; camera, 3D and layout tasks done with the core tools |
