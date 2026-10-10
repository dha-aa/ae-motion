# Changing ae-motion: the rules

These rules are strict. Each one exists because breaking it once cost a broken release, a crashed After Effects, a
red CI run or a lost afternoon. The incident is noted under each rule; do not relax a rule without a better fix for
that incident. How-to material (setup, adding a tool step by step, the quirk list) is in
[docs/development.md](docs/development.md); this file is what must be true before a change ships.

**Before anything else:** read `CLAUDE.md`, the "After Effects quirks" and "ExtendScript rules" sections of
`docs/development.md`, and the code you are changing. Search for an existing tool or option before adding one.

---

## 1. Design: what to build

1. **General tools, not use-case tools.** A new capability is an option on an existing tool or one general tool,
   never a tool per scenario (no `add_chart`, `count_up`, `make_intro`). Ask: does this work for cases nobody
   mentioned yet?
2. **Ask before building anything large or visual-taste-heavy** (a new tool group, a character system, a style).
   Show a plan or one sample first. *Incident: a character rig and a clothing system were built, rebuilt three times
   for quality, then removed.*
3. **Tool definitions cost tokens on every request.** `TOOLS_LIST_BUDGET` in `test/static-checks.ts` is a hard
   limit. Before raising it, shorten descriptions; when you do raise it, write why in the comment next to it. Never
   repeat in a description what the schema already says (enums, ranges). Prefer one option on an existing tool over
   a new tool.
4. **Results leave out defaults and stay short.** Return ids and what changed, not full objects. Over 25k characters
   becomes an error with a hint, so big lists need filters or paging (`limit` / `offset` / `next_offset`).
5. **Destructive behaviour must be visible in the result.** If a call replaces or removes existing data, the result
   says how much (`replaced`, `removed`, `deleted`). *Incident: `set_keyframes` silently replaced a whole animation.*
6. **Remove features cleanly.** Taking something out means the tool, its registration, schema, tests, docs, changelog
   lines, budget and `EXPECTED_TOOLS` all go back. Keep generally useful fixes found along the way, as separate
   changelog entries.

## 2. Host code (ExtendScript, `host/`)

1. **ES3 only.** The lint in `npm test` catches most of it: no `let` / `const` / arrows / template literals / spread,
   no ES5 array methods, no `Array.prototype.indexOf`, no `...` or backticks even in comments.
2. **No Java reserved words as names**: `long`, `int`, `char`, `byte`, `short`, `float`, `double`, `final`, `native`,
   `goto`, `boolean`, `abstract`, `volatile`, `transient`, `synchronized`, `throws`. *Incident: a variable named
   `long` made After Effects refuse the whole `host.jsx`; the old code kept running and every test of the new code
   "failed" for no visible reason.*
3. **Test flags with `=== true`, never by truthiness.** ExtendScript objects inherit `watch`, `unwatch` and `toSource`
   from `Object.prototype`, so `if (o.watch)` is always true. *Incident: every character got a watch.*
4. **Read-only commands never add layers, effects or expressions**, not even temporarily. Compute in ExtendScript.
   *Incident: a "read-only" review check added a probe layer with expressions to a 211-layer 3D comp and crashed
   After Effects.*
5. **Every mutating command is one undo group** (`host/dispatch.jsx`); read-only commands are listed in `READONLY`.
6. **Errors are `fail(code, message, hint)`** with a code from the list in `CLAUDE.md` and a hint that says what to do
   next. TypeScript throws `AeToolError` the same way. Schema failures are rewritten into the same format by
   `toolInputErrors`; do not let any other error format reach the model.
7. **Every path argument is listed in the tool's `paths`** (sandbox + slash normalising), and nothing that is not a
   path.
8. **Set values the way After Effects actually behaves**, and check the result when the order matters (work area,
   `inPoint`, roving keys, `moveTo`). *Incident: the work area was set start-first, AE moved the end instead, and
   every audio analysis heard silence; tests passed because the mock did not model it.*
9. **Expressions we write are marked on line 1** (`// ae-motion <kind>`) so tools can recognise and rebuild them.
10. **Edit host files with exact, reviewed edits.** No regex or loop-driven rewrites across a file without reading
    the diff before building. *Incident: an automated clean-up spliced a file into nested duplicate copies.*

## 3. Server code (TypeScript, `src/`)

1. **Register through `ToolRegistry`** (`bridged` / `tool`) so every tool gets strict schemas, annotations, size
   capping, the token meter and the error format. Set `readOnly`, `destructive`, `idempotent` and `openWorld`
   truthfully (`openWorld: true` only for tools that reach the network).
2. **Nothing writes to stdout** (it is the protocol stream). Use stderr.
3. **Background work reports progress and failure honestly.** A job is `done` only after its output is checked to
   exist; errors a child process only logs are collected and fail the job. *Incidents: aerender exited 0 after a GPU
   failure (black frames, no audio) and reported success; aerender exited before its file was on disk and the next
   step failed.*
4. **Wait for conditions, never for a fixed time**: poll until a file exists and stops growing, or until a status
   says so, with a timeout.

## 4. Tests

1. **Every behaviour change gets a test** in the matching file (`test/mock-*.test.ts` for host commands,
   `test/server.test.ts` for server behaviour, `test/render-check.test.ts` for ffmpeg checks). A bug fix gets a test
   that fails without the fix.
2. **Mocks model the After Effects quirk you hit.** When live AE behaves differently from a mock, fix the mock first
   (so the test fails), then the code. Add the quirk to `CLAUDE.md` and `docs/development.md`.
3. **No fixed sleeps in tests.** Poll for the condition with a generous timeout, and make failing checks print the
   values they saw. *Incident: a test that waited a fixed 1.6 s passed on a laptop and failed on CI runners.*
4. **`npm test` and `npm run typecheck` must both pass locally before every commit.**
5. **A green `npm test` does not prove a host change works.** See section 5.

## 5. Verify in real After Effects (any change to `host/` or `panel/`)

1. `npm run build`, `bash scripts/install.sh`, then `node .claude/skills/run-ae-motion/driver.ts reload-host` and
   **check it printed `"ok": true`**. If it did not, After Effects is still running the old code (see 2.2).
2. Exercise the change with the driver (`call` or `script`), including its error paths.
3. For anything visual, look at it: `preview_frame` at the key times (several in one call), and `review_motion` for
   motion. For renders, read `render_status`'s `check`.
4. Note in the PR what was verified live and what was not.

## 6. Documentation

Update in the same change: `docs/tools.md` (tool reference), the README group table (new tools), `CLAUDE.md`
(layout, rules, quirks), `docs/development.md` (how-to, quirks) and a `CHANGELOG.md` entry under `## Unreleased`
(Added / Changed / Fixed, written for users: what changed and why it matters).

## 7. Shipping

1. Work on a branch, never on `main`.
2. Release: bump the version in `package.json` and both places in `panel/CSXS/manifest.xml`, turn `## Unreleased`
   into `## X.Y.Z — date`, then `npm install --package-lock-only`, `npm run typecheck`, `npm test`.
3. Commit with the attribution line, push, open a PR whose description says what changed, why, and how it was
   tested (including live checks).
4. **Merge only when CI is green on every runner** (`gh pr checks <n> --watch`). *Incident: 2.11.1 was merged
   without waiting and `main` went red.*
5. Tag `vX.Y.Z` on the merged `main`, push the tag, create the GitHub release with the changelog section as notes,
   then reinstall locally (`bash scripts/install.sh`).
6. Semantic versioning: removing or renaming a tool or argument is a major bump; new tools or options are minor;
   fixes are patch.

---

### Pre-merge checklist

- [ ] General design, no use-case tool; asked first if large
- [ ] ES3 clean, no reserved-word names, flags tested `=== true`, read-only stays read-only
- [ ] Errors in the standard format with hints; paths sandboxed; destructive results report what they removed
- [ ] Tests added (fail without the change); no fixed sleeps; `npm test` + `npm run typecheck` pass
- [ ] Host change reloaded (`"ok": true`) and verified live; visual changes previewed
- [ ] Token budget respected (or raised with a reason)
- [ ] Docs and `CHANGELOG.md` updated
- [ ] CI green on every runner before merge; tag + release after
