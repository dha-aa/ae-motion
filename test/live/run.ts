// Live tests: the behaviours the mock tests model, checked against a real After Effects through the built server.
// The mocks (test/mock-*.test.ts) are fakes written by hand; these catch a mock that no longer matches After Effects
// (a new AE version, a quirk modelled wrong). Not part of `npm test` (CI has no After Effects): run before a release.
//
//   npm run build && node test/live/run.ts --yes [--only <name substring>]
//
// Needs After Effects with the ae-motion panel open. It replaces the open project with a new one (--yes confirms).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PNG } from "pngjs";
import { startClient, type ToolResult } from "../../scripts/mcp-client.ts";

const argv = process.argv.slice(2);
if (!argv.includes("--yes")) {
  console.error("Live tests replace the project open in After Effects with a new, unsaved one. Save your work, then run with --yes.");
  process.exit(2);
}
const only = argv.includes("--only") ? argv[argv.indexOf("--only") + 1] : undefined;

type Json = Record<string, any>;
const c = await startClient();
const status = await c.call("get_project");
if (status.isError) { console.error("After Effects is not reachable: " + JSON.stringify(status.value)); c.close(); process.exit(1); }

/** Call a tool and return its result, failing the check on an error result. */
async function call(tool: string, args: Json = {}): Promise<any> {
  const r: ToolResult = await c.call(tool, args);
  if (r.isError) throw new Error(`${tool} failed: ${JSON.stringify(r.value)}`);
  return r.value;
}
async function callError(tool: string, args: Json): Promise<Json> {
  const r = await c.call(tool, args);
  if (!r.isError) throw new Error(`${tool} should have failed, got ${JSON.stringify(r.value)}`);
  return r.value.error;
}
const near = (a: number, b: number, tol = 0.01): boolean => Math.abs(a - b) <= tol;
function expect(cond: boolean, what: string, got?: unknown): void { if (!cond) throw new Error(what + (got === undefined ? "" : `; got ${JSON.stringify(got)}`)); }
function expectNear(a: number[] | number, b: number[] | number, what: string, tol = 0.01): void {
  const x = ([] as number[]).concat(a), y = ([] as number[]).concat(b);
  expect(y.every((v, i) => near(x[i], v, tol)), `${what}: expected ${JSON.stringify(b)}`, a);
}

let comp = 0;
/** A fresh 1920x1080, 30 fps, 10 s comp for one check. */
const newComp = async (name: string, extra: Json = {}): Promise<number> => (await call("create_comp", { name, width: 1920, height: 1080, fps: 30, duration: 10, ...extra })).id;
const solid = async (name: string, options: Json = {}): Promise<number> => (await call("add_layer", { comp_id: comp, kind: "solid", options: { name, color: [0.5, 0.5, 0.5], ...options } })).id;

const checks: [name: string, fn: () => Promise<void>][] = [];
const check = (name: string, fn: () => Promise<void>): void => { checks.push([name, fn]); };

// ----- layers and timing (mock-host) -----
check("setting in keeps out; changing start moves in and out", async () => {
  const l = await solid("L");
  let r = await call("set_layer", { layer_id: l, in: 1 });
  expect(r.in === 1 && r.out === 10, "in 1 keeps out at the comp end", r);
  r = await call("set_layer", { layer_id: l, start: 2 });
  expect(r.start === 2 && r.in === 3 && r.out === 12, "start 2 moves in to 3 and out to 12", r);
  r = await call("set_layer", { layer_id: l, out: 5 });
  expect(r.in === 3 && r.out === 5, "out alone leaves in", r);
});

check("timeline commands snap times to whole frames", async () => {
  const l = await solid("L");
  await call("split_layer", { layer_ids: [l], time: 4.01 });
  const ids = (await call("get_comp", { comp_id: comp })).layers.map((x: Json) => x.id);
  const ins = (await call("get_layer", { layer_ids: ids })).layers.map((x: Json) => x.in).sort();
  expect(ins.length === 2 && near(ins[1], 4, 1e-4), "split at 4.01 cuts at frame 120 (4 s)", ins);
});

check("split_layer cuts one layer into two at the time", async () => {
  const l = await solid("L");
  const r = await call("split_layer", { layer_ids: [l], time: 4 });
  const layers = (await call("get_comp", { comp_id: comp })).layers;
  expect(layers.length === 2, "two layers", layers);
  const info = (await call("get_layer", { layer_ids: layers.map((x: Json) => x.id) })).layers;
  const outs = info.map((x: Json) => [x.in, x.out]).sort((a: number[], b: number[]) => a[0] - b[0]);
  expect(JSON.stringify(outs) === JSON.stringify([[0, 4], [4, 10]]), "pieces 0-4 and 4-10", { outs, r });
});

check("a track matte layer is hidden", async () => {
  const fill = await solid("Fill");
  const matte = (await call("add_layer", { comp_id: comp, kind: "text", options: { name: "M", text: "MATTE", text_style: { size: 200 } } })).id;
  await call("set_track_matte", { layer_id: fill, matte_layer_id: matte, type: "alpha" });
  const m = await call("get_layer", { layer_id: matte });
  expect(m.enabled === false, "matte layer disabled", m.enabled);
});

check("parenting keeps a layer in place on screen", async () => {
  const n = (await call("add_layer", { comp_id: comp, kind: "null", options: { name: "N", position: [100, 100] } })).id;
  const l = await solid("L", { position: [500, 500], size: [100, 100] });
  await call("link_layers", { layer_ids: [l], parent_id: n });
  const g = await call("get_layer", { layer_id: l });
  expect(g.parent_id === n, "parent set", g.parent_id);
  expectNear(g.transform.position.slice(0, 2), [400, 400], "position becomes relative to the null");
  expectNear(g.bounds.comp.center, [500, 500], "still centred where it was", 0.5);
});

check("precompose moves layers into a new comp", async () => {
  const a = await solid("A"), b = await solid("B");
  const r = await call("precompose", { layer_ids: [a, b], name: "Inner" });
  const outer = (await call("get_comp", { comp_id: comp })).layers;
  expect(outer.length === 1 && outer[0].kind === "precomp", "one precomp layer left", outer);
  const item = (await call("get_project")).items.find((x: Json) => x.name === "Inner");
  const inner = await call("get_comp", { comp_id: item?.id });
  expect(inner.num_layers === 2, "inner comp has both layers", { inner, r });
});

check("insert_time pushes later layers and extends the comp", async () => {
  const l = await solid("L");
  await call("set_layer", { layer_id: l, start: 3 });
  await call("insert_time", { comp_id: comp, at: 1, duration: 2, extend_comp: true });
  const g = await call("get_layer", { layer_id: l });
  expect(g.start === 5, "layer pushed 2 s", g.start);
  expect((await call("get_comp", { comp_id: comp })).duration === 12, "comp extended to 12 s");
});

// ----- markers (mock-host) -----
check("update_marker writes the marker back (keyValue is a copy)", async () => {
  await call("add_marker", { comp_id: comp, time: 2, comment: "A" });
  await call("update_marker", { comp_id: comp, index: 1, comment: "B", duration: 1 });
  const m = (await call("list_markers", { comp_id: comp })).markers;
  expect(m.length === 1 && m[0].comment === "B" && m[0].duration === 1, "comment and duration changed", m);
});

// ----- keyframes (mock-keyframes) -----
check("keys get the easing asked for, and edit_keyframes keeps it when moving a key", async () => {
  const l = await solid("L");
  await call("set_keyframes", { layer_id: l, path: "position", keys: [{ t: 0, v: [0, 540], ease_out: "easy" }, { t: 1, v: [960, 540], ease_in: "easy" }] });
  let k = (await call("get_keyframes", { layer_id: l, path: "position" })).keys;
  expect(k.length === 2 && k[0].interp_out === "bezier" && k[1].interp_in === "bezier", "eased keys are bezier", k);
  const before = k[1];
  await call("edit_keyframes", { layer_id: l, path: "position", edits: [{ action: "move", index: 2, to: 2 }] });
  k = (await call("get_keyframes", { layer_id: l, path: "position" })).keys;
  expect(k.length === 2 && k[1].t === 2 && k[1].interp_in === "bezier", "moved key is still eased", k);
  expect(JSON.stringify({ ...k[1], t: 0, index: 0 }) === JSON.stringify({ ...before, t: 0, index: 0 }), "and kept every setting", { before, after: k[1] });
});

check("a spring overshoots and lands exactly on the next key", async () => {
  const l = await solid("L", { size: [200, 200] });
  await call("set_keyframes", { layer_id: l, path: "scale", keys: [{ t: 0, v: [0, 0], interp: "spring" }, { t: 1, v: [100, 100] }] });
  const at = async (t: number): Promise<number> => (await call("get_layer", { layer_id: l, time: t })).transform.scale[0];
  const samples = [];
  for (const t of [0.2, 0.3, 0.4, 0.5, 0.6]) samples.push(await at(t));
  expect(Math.max(...samples) > 100, "overshoots 100 somewhere", samples);
  expectNear(await at(1), 100, "lands on 100 at the key", 1e-3);
  expectNear(await at(0), 0, "starts at 0", 1e-3);
});

check("get_keyframes gives an unanimated value before its expression", async () => {
  const l = await solid("L");
  await call("set_expression", { layer_id: l, path: "rotation", expression: "45" });
  const k = await call("get_keyframes", { layer_id: l, path: "rotation" });
  expect(k.num_keys === 0 && k.value === 0 && k.expression === "45", "value 0 under expression 45", k);
  expect((await call("get_layer", { layer_id: l })).transform.rotation === 45, "get_layer shows the expression's result");
});

// ----- text, effects, masks, shapes -----
check("text layers: size and text read back", async () => {
  const t = (await call("add_layer", { comp_id: comp, kind: "text", options: { name: "T", text: "HELLO", text_style: { size: 80 } } })).id;
  await call("set_text", { layer_id: t, size: 50, text: "WORLD" });
  const g = await call("get_text", { layer_id: t });
  expect(g.text === "WORLD" && g.size === 50, "text and size", g);
});

check("text ranges: part styling sticks (stroke too), reads back, and new text clears it", async () => {
  const t = (await call("add_layer", { comp_id: comp, kind: "text", options: { name: "R", text: "Make every frame count", text_style: { size: 60 } } })).id;
  await call("set_text", { layer_id: t, ranges: [{ match: "every", color: [1, 0.5, 0], size: 80 }, { start: 17, stroke_color: [0, 0, 1], stroke_width: 3 }] });
  const g = await call("get_text", { layer_id: t });
  const every = g.ranges?.find((r: { text: string }) => r.text === "every"), count = g.ranges?.find((r: { text: string }) => r.text === "count");
  expect(g.size === 60 && every?.size === 80 && JSON.stringify(every?.color) === "[1,0.5,0]", "every: size 80, orange; layer size 60", g);
  expect(count?.stroke === true && count?.stroke_width === 3, "count: stroke on (needs applyStroke set explicitly)", g);
  const r = await call("set_text", { layer_id: t, text: "Make every second count" });
  expect(r.ranges_cleared === true && (await call("get_text", { layer_id: t })).ranges === undefined, "new text clears part styling", r);
});

check("import_footage: a sequence conforms to fps into a folder; a still refuses fps; set_item renames and moves", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ae-motion-live-"));
  const png = new PNG({ width: 16, height: 16 }); png.data.fill(200);
  for (let i = 1; i <= 10; i++) fs.writeFileSync(path.join(dir, `f_${String(i).padStart(3, "0")}.png`), PNG.sync.write(png));
  fs.mkdirSync(path.join(dir, "still")); fs.writeFileSync(path.join(dir, "still", "logo.png"), PNG.sync.write(png));
  try {
    const seq = await call("import_footage", { path: path.join(dir, "f_001.png"), as: "sequence", fps: 20, loop: 2, folder: "Live imports" });
    expect(seq.fps === 20 && near(seq.duration, 1) && typeof seq.folder_id === "number", "10 frames at 20 fps looped twice = 1 s, in a folder", seq);
    const still = await call("import_footage", { path: path.join(dir, "still", "logo.png"), fps: 12, folder: "Live imports" });
    expect(still.folder_id === seq.folder_id && still.skipped?.[0]?.field === "fps", "still: same folder, fps skipped", still);
    const moved = await call("set_item", { item_id: seq.id, name: "Seq", folder: null, label: 2 });
    expect(moved.name === "Seq" && moved.folder_id === undefined && moved.label === 2, "renamed, at the top level", moved);
    expect((await callError("set_item", { item_id: comp, fps: 24 })).code === "BAD_ARGS", "fps on a comp is refused");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

check("audio: duck_music dips, audio_fade and volume keys all live under the duck expression", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ae-motion-live-"));
  // 4 s of a 220 Hz tone, 16-bit mono PCM
  const rate = 48000, n = rate * 4, wav = Buffer.alloc(44 + n * 2);
  wav.write("RIFF", 0); wav.writeUInt32LE(36 + n * 2, 4); wav.write("WAVEfmt ", 8); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(rate, 24); wav.writeUInt32LE(rate * 2, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write("data", 36); wav.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) wav.writeInt16LE(Math.round(8000 * Math.sin((2 * Math.PI * 220 * i) / rate)), 44 + i * 2);
  fs.writeFileSync(path.join(dir, "tone.wav"), wav);
  try {
    const item = await call("import_footage", { path: path.join(dir, "tone.wav") });
    const m = (await call("add_layer", { comp_id: comp, kind: "footage", options: { item_id: item.id } })).id;
    const d = await call("duck_music", { music_layer_id: m, dips: [{ start: 2, end: 2.5 }] });
    expect(d.dips === 1 && d.valid === true, "the dip expression is valid in After Effects", d);
    const f = await call("set_layer", { layer_id: m, audio_fade: { in: 0.5, out: 1 } });
    expect(f.audio_fade?.in === 0.5, "fades set", f);
    await call("set_keyframes", { layer_id: m, path: "volume", keys: [{ t: 1, v: -3 }], merge: true });
    const k = await call("get_keyframes", { layer_id: m, path: "volume" });
    expect(k.num_keys === 11 && /^\/\/ ae-motion duck/.test(k.expression ?? ""), "5 + 5 fade keys and the new one, under the duck expression", k);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

check("effects apply with parameters and can be removed", async () => {
  const l = await solid("L");
  await call("apply_effect", { layer_id: l, match_name: "ADBE Gaussian Blur 2", params: { "ADBE Gaussian Blur 2-0001": 12 } });
  let e = (await call("get_layer", { layer_id: l })).effects;
  expect(e.length === 1 && /Gaussian/.test(JSON.stringify(e)), "one Gaussian Blur", e);
  const v = await call("list_properties", { layer_id: l, group_path: ["ADBE Effect Parade", 1], depth: 1 });
  expect(/"value":12\b/.test(JSON.stringify(v)), "blurriness 12", v);
  await call("edit_effect", { layer_id: l, effect_index: 1, action: "remove" });
  e = (await call("get_layer", { layer_id: l })).effects;
  expect(e.length === 0, "removed", e);
});

check("masks and shape layers draw where asked", async () => {
  const l = await solid("L");
  await call("add_mask", { layer_id: l, shape: { type: "rect", size: [400, 200] } });
  expect((await call("get_layer", { layer_id: l })).masks.length === 1, "one mask");
  const s = (await call("add_layer", { comp_id: comp, kind: "shape", options: { name: "S", position: [960, 540], shape: { type: "rect", size: [300, 100], fill: [1, 0, 0] } } })).id;
  const b = (await call("get_layer", { layer_id: s })).bounds.comp;
  expectNear([b.width, b.height], [300, 100], "shape bounds", 1);
  expectNear(b.center, [960, 540], "shape centre", 1);
});

// ----- layout (mock-design) -----
check("align_layers centres a layer in the comp by its bounds", async () => {
  const s = (await call("add_layer", { comp_id: comp, kind: "shape", options: { name: "S", position: [200, 200], shape: { type: "rect", size: [300, 100], fill: [1, 0, 0] } } })).id;
  await call("align_layers", { layer_ids: [s], align: "center", to: "comp" });
  expectNear((await call("get_layer", { layer_id: s })).bounds.comp.center, [960, 540], "centred", 0.5);
});

// ----- 3D and cameras (mock-camera) -----
check("a new camera sits in front of the comp (negative z) and a dolly in moves it closer", async () => {
  const cam = (await call("add_layer", { comp_id: comp, kind: "camera", options: { name: "Cam" } })).id;
  const g = await call("get_camera", { layer_id: cam });
  expectNear(g.position.slice(0, 2), [960, 540], "centred on the comp", 0.5);
  expect(g.position[2] < 0, "negative z", g.position);
  await call("camera_move", { layer_id: cam, type: "dolly", start: 0, duration: 2, distance: 500 });
  const k = (await call("get_keyframes", { layer_id: cam, path: "position" })).keys;
  expect(k.length >= 2 && k[k.length - 1].v[2] > k[0].v[2], "z increases (towards the comp)", k);
});

check("set_3d places a layer in depth", async () => {
  const l = await solid("L");
  await call("set_3d", { layer_id: l, three_d: true, z: 300 });
  const g = await call("get_layer", { layer_id: l });
  expect(g.three_d === true && g.transform.position[2] === 300, "3D at z 300", g);
});

// ----- motion (mock-motion) -----
check("animate, text_reveal and review_motion run on real layers", async () => {
  const l = await solid("L", { size: [300, 300] });
  await call("animate", { layer_ids: [l], move: "pop", time: 1 });
  const t = (await call("add_layer", { comp_id: comp, kind: "text", options: { name: "T", text: "REVEAL ME", text_style: { size: 100 } } })).id;
  await call("text_reveal", { layer_id: t, style: "rise", time: 0.5 });
  const g = await call("get_layer", { layer_id: t });
  expect(g.expressions.length > 0 || /reveal/i.test(JSON.stringify(g)), "reveal added an expression", g.expressions);
  const r = await call("review_motion", { comp_id: comp });
  expect(typeof r === "object", "review result", r);
});

// ----- output -----
check("preview_frame returns one tiled image for several times", async () => {
  await solid("L");
  const r = await c.call("preview_frame", { comp_id: comp, time: [0, 1, 2] });
  expect(!r.isError && r.images === 1, "one image", r);
});

// ----- server-side features against the real host -----
check("batch runs several steps with $N references", async () => {
  const r = await call("batch", { steps: [
    { tool: "add_layer", args: { comp_id: comp, kind: "solid", options: { name: "B1" } } },
    { tool: "set_layer", args: { layer_id: "$1.id", in: 2 } },
  ] });
  const g = (await call("get_comp", { comp_id: comp })).layers;
  expect(g.length === 1 && g[0].name === "B1" && g[0].in === 2, "layer added and changed", { g, r });
});

check("errors use the ae-motion format", async () => {
  const e = await callError("get_layer", { layer_id: 999999 });
  expect(e.code === "NOT_FOUND" && typeof e.hint === "string", "NOT_FOUND with a hint", e);
});

// ----- run -----
await call("open_project", { new: true, discard_unsaved: true });
const results: [string, boolean, string?][] = [];
for (const [name, fn] of checks) {
  if (only && !name.includes(only)) continue;
  try {
    comp = await newComp(name.slice(0, 30));
    await fn();
    results.push([name, true]);
  } catch (e) { results.push([name, false, e instanceof Error ? e.message : String(e)]); }
}
c.close();
let failed = 0;
for (const [name, pass, msg] of results) { console.log((pass ? "PASS  " : "FAIL  ") + name + (msg ? "\n      " + msg : "")); if (!pass) failed++; }
console.log(`\n${results.length - failed}/${results.length} live checks passed (After Effects ${status.value.ae_version})`);
process.exit(failed ? 1 : 0);
