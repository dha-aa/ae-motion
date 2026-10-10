# Evaluations

Ten questions that check whether a model with **only ae-motion's read-only tools** can find its way around a real
After Effects project: nested comps, layer timing, markers, effects, expressions, text, track mattes, parenting and
camera keys. Unit tests prove the tools behave; this checks the tool descriptions and results are clear enough for
a model to use well. Watch the score, the tool calls per question, and each answer's `summary` (the model is asked
to say what made it harder).

| File | What it is |
|---|---|
| `build-fixture.ts` | writes `fixture.jsonl`, the driver script that builds the fixed test project |
| `fixture.jsonl` | generated, committed so the project can be rebuilt with the driver alone |
| `evaluation.xml` | the questions and answers (the mcp-builder skill's format), verified in AE 26.3 |
| `run.ts` | the runner |

## Running

```bash
npm run build
node evals/run.ts                 # rebuilds the fixture (replaces the open project: save first), then asks all 10
node evals/run.ts --no-build --only 3,7 --jobs 3 --model sonnet
```

- **No API key.** Each question is a fresh headless Claude Code session (`claude -p`) on your Claude Code login,
  so it counts against your plan's usage. A usage limit stops the run and lists the questions not run (they are not
  counted as wrong). The `cost` it prints is what the same run would cost on the API, as Claude Code reports it.
- **Isolation.** Only the ae-motion server (`--strict-mcp-config`), no built-in tools, only the tools whose
  `readOnlyHint` is true allowed (others are denied and counted), started in an empty temp directory so no
  project `CLAUDE.md` loads.
- **Needs After Effects** with the ae-motion panel open, so it does not run on CI.
- Results go to `evals/results/<time>.json` (gitignored): per question the answer, pass, tool calls by name,
  denials, turns, seconds and the model's summary.
- The mcp-builder skill's own `evaluation.py` runs the same `evaluation.xml` through the Anthropic API instead
  (needs `ANTHROPIC_API_KEY`).

## Changing questions

Questions must be read-only, independent, have one stable answer, and need several tool calls. Edit
`build-fixture.ts`, regenerate, rebuild in AE, then check every affected answer with the read-only tools before
committing (`node .claude/skills/run-ae-motion/driver.ts call get_comp '{"comp_id": N}'` and so on).

## Results so far

| Date | Version | Model | Score | Tool calls / question | Notes |
|---|---|---|---|---|---|
| 2026-10-10 | 2.11.3 | default | 10/10 | 9.2 | `batch` denied in 5 questions; layers fetched one by one; precomp source guessed from comp times |
| 2026-10-10 | 2.12.0 | default | 10/10 | 5.6 | `get_layer layer_ids`, `source_id`, layer `text`, `get_keyframes` static `value` |
