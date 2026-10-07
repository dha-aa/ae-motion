# Evaluations

`ae-motion.eval.xml` measures how well a model can answer realistic questions about an After Effects project using **only** this server's tools (phase 4 of the MCP builder guide). Every question is read-only and has one exact-string answer, verified by hand with the server's tools.

The answers come from a fixed project, `fixtures/rocket_launch.aep`: an 8-second rocket launch built with this server (expressions, keyframes, effects, layer styles, a precomp, masks, parenting, text keyframes). Do not save changes into it.

## What the questions cover

| # | Needs | Answer |
|---|---|---|
| 1 | find the text layer, read text at a time (`get_text` with `time`) | IGNITION |
| 2 | source-text keyframes + position keyframes, then subtract | 1.6 |
| 3 | read an expression on a trim-paths property (`list_properties` / `get_keyframes`) | Rocket |
| 4 | position keyframes, ignoring the expression on top | -520 |
| 5 | walk a shape layer's root groups | 7 |
| 6 | read a scale expression | 135 |
| 7 | opacity keyframes, then subtract | 3.25 |
| 8 | find the null and count layers whose `parent_id` points to it (`get_comp`) | 4 |
| 9 | mask properties | 170 |
| 10 | layer blend mode | ADD |

Question 10 is deliberately not answerable with the inspection tools: `get_layer` and `get_comp` do not report a layer's blend mode (or its motion blur switch). With `run_jsx` disabled a model should fail it; with it enabled it can read `layer.blendingMode`. Either outcome is useful signal (see "Known gaps" below).

## Running

1. Open After Effects with the AE Motion MCP panel, and open `evals/fixtures/rocket_launch.aep` (File > Open Project). There is no tool to open a project yet.
2. Build the server: `npm run build`.
3. Run the harness from the MCP builder skill (needs Python with `anthropic` and `mcp`, and an `ANTHROPIC_API_KEY`; it calls the Claude API once per question, so it costs money):

```bash
python <mcp-builder skill>/scripts/evaluation.py \
  -t stdio -c node -a dist/index.js \
  -e AE_MCP_UPDATE_CHECK=0 \
  -o evals/report.md \
  evals/ae-motion.eval.xml
```

Add `-e AE_MCP_ALLOW_JSX=1` to let the model fall back to `run_jsx` (question 10 then becomes answerable).

The report lists accuracy, tool calls per question and the model's feedback on the tools: read the feedback, it is the point of the exercise.

## Known gaps found while writing these

- **No tool opens a project.** Writing the evaluation needed `run_jsx` (`app.open`) to load the fixture.
- **Blend mode and motion blur are not reported** by `get_layer` / `get_comp`, although `set_layer` sets both.
