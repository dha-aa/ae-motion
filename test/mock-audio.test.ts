// @ts-nocheck -- the fake After Effects DOM here is deliberately loose (untyped fakes); these tests are checked by running them.
// beat_markers and audio_react (host/commands/audio.jsx) against a fake After Effects whose "Convert Audio to
// Keyframes" builds the amplitude null from synthesized drum tracks with known beat times, so beat detection
// accuracy, the muting / work-area handling around the menu command, and the audio_react wiring can be checked.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import assert from "node:assert/strict";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC = fs.readFileSync(path.join(ROOT, "panel", "host", "host.jsx"), "utf8");
const FPS = 30;

/** Per-frame loudness (mean |sample|, like the amplitude sliders) of kicks at the given times over a noise bed. */
function loudness(beats, { dur = 8, gain = () => 1, noise = 0.03, pad = 0 } = {}) {
  const sr = 8000, n = Math.round(dur * sr), x = new Float64Array(n);
  let seed = 1;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
  for (const b of beats) {
    const s = Math.round(b * sr), g = gain(b);
    for (let i = 0; i < 0.25 * sr && s + i < n; i++) { const t = i / sr; x[s + i] += g * 0.9 * Math.exp(-t * 18) * Math.sin(2 * Math.PI * (55 + 90 * Math.exp(-t * 30)) * t); }
  }
  for (let i = 0; i < n; i++) x[i] += noise * rnd() + pad * Math.sin(2 * Math.PI * 220 * i / sr);
  const frames = Math.round(dur * FPS), v = [];
  for (let k = 0; k < frames; k++) {
    let s = 0; const a = Math.round(k / FPS * sr), b = Math.round((k + 1) / FPS * sr);
    for (let i = a; i < b; i++) s += Math.abs(x[i]);
    v.push(20 * s / (b - a));
  }
  return v;
}
const grid = (bpm, first, dur = 8) => { const out = []; for (let t = first; t < dur - 1e-9; t += 60 / bpm) out.push(t); return out; };

class Prop {
  constructor(v, matchName = "") { this._v = v; this.keys = []; this.expression = ""; this.matchName = matchName; this.propertyType = 1; this.dimensionsSeparated = false; }
  // keys ease in and out (smoothstep), so the fastest frame of a segment is its middle
  valueAtTime(t) {
    const k = this.keys;
    if (!k.length) return this._v;
    if (t <= k[0].t) return k[0].v;
    if (t >= k[k.length - 1].t) return k[k.length - 1].v;
    const i = k.findIndex((x) => x.t > t), a = k[i - 1], b = k[i], u = (t - a.t) / (b.t - a.t), e = u * u * (3 - 2 * u);
    return Array.isArray(a.v) ? a.v.map((x, j) => x + (b.v[j] - x) * e) : a.v + (b.v - a.v) * e;
  }
  setValue(v) { this._v = v; }
  get canSetExpression() { return true; }
  get canVaryOverTime() { return true; }
  get expressionEnabled() { return this.expression !== ""; }
  get expressionError() { return /^\/\/ ae-motion duck/.test(this.expression) && !/value \+ \[g, g\];$/.test(this.expression) ? "bad" : ""; }
  get value() { return this._v; }
  get numKeys() { return this.keys.length; }
  keyTime(i) { return this.keys[i - 1].t; }
  keyValue(i) { return this.keys[i - 1].v; }
  removeKey(i) { this.keys.splice(i - 1, 1); }
  nearestKeyIndex(t) { let b = 1; this.keys.forEach((k, i) => { if (Math.abs(k.t - t) < Math.abs(this.keys[b - 1].t - t)) b = i + 1; }); return b; }
  setValueAtTime(t, v) { const i = this.keys.findIndex((k) => Math.abs(k.t - t) < 1e-9); if (i >= 0) this.keys[i].v = v; else { this.keys.push({ t, v }); this.keys.sort((a, b) => a.t - b.t); } }
}

function makeWorld(amplitude, { menu = true } = {}) {
  let nextId = 10;
  class CompItem {} class AVLayer {} class TextLayer {} class ShapeLayer {} class CameraLayer {} class LightLayer {} class Stub {}
  class MarkerValue { constructor(c) { this.comment = c; } }
  const layers = new Map(), log = { menuRuns: 0, audibleDuringRun: null, workAreaDuringRun: null, imports: 0, sourcesRemoved: 0 };
  const items = [];
  const comp = Object.assign(new CompItem(), {
    id: 1, name: "Main", width: 1280, height: 720, duration: 10, frameRate: FPS, frameDuration: 1 / FPS, workAreaStart: 2, workAreaDuration: 5,
    numLayers: 0, _layers: [], markerProperty: new Prop(null), layer: (i) => comp._layers[i - 1], openInViewer() {},
  });
  const add = (l, top = false) => {
    Object.assign(l, { id: nextId++, containingComp: comp, selected: false, enabled: true, parent: null, startTime: 0, label: 0, locked: false });
    const tg = { "ADBE Scale": new Prop([100, 100, 100]), "ADBE Opacity": new Prop(100), "ADBE Position": new Prop([640, 360, 0]), "ADBE Rotate Z": new Prop(0) };
    const markers = new Prop(null), effects = l.effects || [], levels = new Prop([0, 0], "ADBE Audio Levels"), groups = l.groups || {};
    l.property = (n) => n === "ADBE Transform Group" ? { property: (m) => tg[m] } : n === "ADBE Marker" ? markers : n === "ADBE Effect Parade" ? { numProperties: effects.length, property: (i) => effects[i - 1] }
      : n === "ADBE Audio Group" ? { property: () => levels } : groups[n] || null;
    l.tg = tg; l.markers = markers; l.levels = levels;
    l.remove = () => { comp._layers.splice(comp._layers.indexOf(l), 1); layers.delete(l.id); reindex(); };
    if (top) comp._layers.unshift(l); else comp._layers.push(l);
    layers.set(l.id, l); reindex();
    return l;
  };
  const reindex = () => { comp._layers.forEach((x, i) => (x.index = i + 1)); comp.numLayers = comp._layers.length; };
  const audioLayer = (name) => add(Object.assign(new AVLayer(), { name, hasAudio: true, audioEnabled: true, inPoint: 0, outPoint: 8 }));
  const plain = (name, Kind = AVLayer, extra = {}) => add(Object.assign(new Kind(), { name, hasAudio: false, hasVideo: true, audioEnabled: false, inPoint: 0, outPoint: 8 }, extra));
  // a group of properties as list_properties walks them
  const group = (children) => ({ propertyType: 3, numProperties: children.length, property: (i) => children[i - 1] });
  const keyed = (matchName, keys) => { const p = new Prop(0, matchName); p.keys = keys.map(([t, v]) => ({ t, v })); return p; };
  // a sound layer from a footage item: in/out follow startTime, like After Effects
  const soundLayer = (item) => {
    const l = add(Object.assign(new AVLayer(), { name: item.name, hasAudio: true, hasVideo: false, audioEnabled: true }));
    let out = null, inp = null;
    Object.defineProperty(l, "inPoint", { get: () => (inp === null ? l.startTime : Math.max(inp, l.startTime)), set: (v) => (inp = v) });
    Object.defineProperty(l, "outPoint", { get: () => (out === null ? l.startTime + item.duration : out), set: (v) => (out = v) });
    return l;
  };
  comp.layers = { add: (item) => soundLayer(item) };
  class FootageItem {}
  class File { constructor(p) { this.fsName = p; this.exists = !/missing/.test(p); } }
  class ImportOptions { constructor(f) { this.file = f; } canImportAs() { return true; } }
  const app = {
    project: {
      itemByID: (id) => (id === 1 ? comp : null), layerByID: (id) => layers.get(id) || null,
      get numItems() { return items.length; }, item: (i) => items[i - 1],
      importFile(io) { log.imports++; const it = Object.assign(new FootageItem(), { name: io.file.fsName.split("/").pop(), file: io.file, hasAudio: true, duration: /long/.test(io.file.fsName) ? 4 : 1, remove() {} }); items.push(it); return it; },
    },
    beginUndoGroup() {}, endUndoGroup() {},
    findMenuCommandId: (n) => (menu && n === "Convert Audio to Keyframes" ? 5015 : 0),
    executeCommand(id) {
      assert.equal(id, 5015);
      log.menuRuns++;
      log.audibleDuringRun = comp._layers.filter((l) => l.hasAudio && l.audioEnabled).map((l) => l.name);
      log.workAreaDuringRun = [comp.workAreaStart, comp.workAreaDuration];
      // the slider keys After Effects writes: one per frame of the work area, for left, right and both channels
      const series = typeof amplitude === "function" ? amplitude(log.audibleDuringRun[0]) : amplitude;
      const slider = () => { const p = new Prop(0); series.forEach((v, k) => { const t = k / FPS; if (t >= comp.workAreaStart - 1e-9 && t < comp.workAreaStart + comp.workAreaDuration - 1e-9) p.keys.push({ t, v }); }); return p; };
      const fx = [1, 2, 3].map(() => { const s = slider(); return { property: () => s }; });
      // a null's source is a solid item in the project, which outlives the layer unless it is removed too
      const src = { name: "Audio Amplitude", usedIn: [], remove() { log.sourcesRemoved++; } };
      const nl = add(Object.assign(new AVLayer(), { name: "Audio Amplitude", hasAudio: false, audioEnabled: false, inPoint: 0, outPoint: 10, effects: fx, source: src }), true);
      const rm = nl.remove; nl.remove = () => { rm(); };
    },
  };
  const ctx = { app, MarkerValue, CompItem, AVLayer, TextLayer, ShapeLayer, CameraLayer, LightLayer, FolderItem: Stub, FootageItem, SolidSource: Stub, File, ImportOptions,
    ImportAsType: { FOOTAGE: 1 }, PropertyValueType: { OneD: 1, TwoD: 2, ThreeD: 3, COLOR: 4, TwoD_SPATIAL: 5, ThreeD_SPATIAL: 6, SHAPE: 7, TEXT_DOCUMENT: 8, NO_VALUE: 9, MARKER: 10, CUSTOM_VALUE: 11 }, PropertyType: { PROPERTY: 1, INDEXED_GROUP: 2, NAMED_GROUP: 3 } };
  vm.createContext(ctx);
  vm.runInContext(SRC, ctx);
  const call = (cmd, args = {}) => JSON.parse(ctx.AEM.dispatch(JSON.stringify({ cmd, args })));
  return { call, comp, audioLayer, plain, log, group, keyed, TextLayer, ShapeLayer };
}

const results = [];
const t = (name, fn) => { try { fn(); results.push([name, true]); } catch (e) { results.push([name, false, e.message]); } };
const ok = (r) => { assert.equal(r.ok, true, JSON.stringify(r.error)); return r.result; };
const plainArr = (v) => JSON.parse(JSON.stringify(v)); // host-realm arrays compared as plain values
const near = (a, b, m = "", tol = 1e-6) => assert.ok(Math.abs(a - b) <= tol, `${m}: expected ${b}, got ${a}`);
const fails = (r, code) => { assert.equal(r.ok, false, "should fail"); if (code) assert.equal(r.error.code, code, JSON.stringify(r.error)); return r.error; };
/** Every true beat found within one frame, and nothing extra. */
const sameBeats = (found, truth) => {
  assert.equal(found.length, truth.length, `found ${found.length} beats, expected ${truth.length}: ${found.map((x) => x.toFixed(3)).join(" ")}`);
  truth.forEach((b, i) => assert.ok(Math.abs(found[i] - b) <= 1 / FPS + 1e-9, `beat ${i + 1}: ${found[i].toFixed(3)} vs ${b.toFixed(3)}`));
};

t("detects 120 BPM kicks within a frame and estimates the tempo", () => {
  const truth = grid(120, 0.25), w = makeWorld(loudness(truth)), a = w.audioLayer("kick.wav");
  const r = ok(w.call("beat_markers", { audio_layer_id: a.id }));
  sameBeats(r.times, truth);
  assert.equal(r.bpm, 120); assert.equal(r.on, "comp");
  assert.equal(w.comp.markerProperty.numKeys, truth.length);
  assert.equal(w.comp.markerProperty.keyValue(1).comment, "beat");
});

t("tempo sweep: 80-174 BPM, different offsets and noise, every beat within a frame", () => {
  for (const [bpm, first, noise] of [[80, 0.1, 0.02], [95, 0.6, 0.05], [128, 0.05, 0.03], [150, 0.33, 0.06], [174, 0.2, 0.04]]) {
    const truth = grid(bpm, first), w = makeWorld(loudness(truth, { noise })), a = w.audioLayer(`t${bpm}.wav`);
    const r = ok(w.call("beat_markers", { audio_layer_id: a.id }));
    sameBeats(r.times, truth);
    assert.ok(Math.abs(r.bpm - bpm) <= 3, `${bpm} BPM estimated as ${r.bpm}`);
  }
});

t("adaptive threshold: loud and quiet halves over a steady pad are both found", () => {
  const truth = grid(100, 0.4), amp = loudness(truth, { gain: (b) => (b < 4 ? 1 : 0.3), pad: 0.12 });
  const w = makeWorld(amp), a = w.audioLayer("song.wav");
  sameBeats(ok(w.call("beat_markers", { audio_layer_id: a.id })).times, truth);
});

t("silence gives no beats; sensitivity 0 ignores soft ghost notes that 1 picks up", () => {
  const w = makeWorld(loudness([], { noise: 0.01 })), a = w.audioLayer("quiet.wav");
  assert.equal(ok(w.call("beat_markers", { audio_layer_id: a.id })).count, 0);
  const main = grid(120, 0.25), ghosts = main.slice(0, -1).map((b) => b + 0.25);
  const amp = loudness([...main, ...ghosts].sort((x, y) => x - y), { gain: (b) => (main.some((m) => Math.abs(m - b) < 1e-9) ? 1 : 0.18) });
  const w2 = makeWorld(amp), a2 = w2.audioLayer("ghosts.wav");
  sameBeats(ok(w2.call("beat_markers", { audio_layer_id: a2.id, sensitivity: 0 })).times, main);
  assert.ok(ok(w2.call("beat_markers", { audio_layer_id: a2.id, sensitivity: 1 })).count > main.length);
});

t("only the analysed layer is audible during the menu command; audio, work area and the null are restored", () => {
  const w = makeWorld(loudness(grid(120, 0.25))), music = w.audioLayer("music.wav"), vo = w.audioLayer("voice.wav"); w.plain("Title");
  music.inPoint = 1; music.outPoint = 7;
  ok(w.call("beat_markers", { audio_layer_id: music.id }));
  assert.deepEqual(w.log.audibleDuringRun, ["music.wav"]);
  assert.deepEqual(w.log.workAreaDuringRun.map((x) => +x.toFixed(6)), [1, 6], "work area set to the audio layer");
  assert.equal(vo.audioEnabled, true, "other audio restored");
  assert.deepEqual([w.comp.workAreaStart, w.comp.workAreaDuration], [2, 5], "work area restored");
  assert.ok(!w.comp._layers.some((l) => /Amplitude/.test(l.name)), "amplitude null removed");
  assert.equal(w.log.sourcesRemoved, 1, "and its source item, so the project does not fill with Audio Amplitude solids");
});

t("bpm grid, every nth beat, layer markers, and replacing earlier beat markers but not others", () => {
  const w = makeWorld([]), a = w.audioLayer("track.wav");
  let r = ok(w.call("beat_markers", { audio_layer_id: a.id, bpm: 120, offset: 0.25 }));
  assert.equal(r.count, 16); assert.equal(w.log.menuRuns, 0, "no analysis with bpm");
  w.comp.markerProperty.setValueAtTime(3.1, new (function M() { this.comment = "drop"; })());
  r = ok(w.call("beat_markers", { audio_layer_id: a.id, bpm: 120, offset: 0.25, every: 4 }));
  assert.equal(r.count, 4); assert.equal(r.replaced, 16);
  assert.deepEqual(w.comp.markerProperty.keys.map((k) => k.v.comment).filter((c) => c === "drop"), ["drop"], "other markers kept");
  r = ok(w.call("beat_markers", { audio_layer_id: a.id, bpm: 60, on: "layer" }));
  assert.equal(r.on, "layer"); assert.equal(a.markers.numKeys, 8);
});

t("audio_react: one expression on every layer from the track's quiet-to-loud range; the null is reused", () => {
  const w = makeWorld(loudness(grid(120, 0.25))), a = w.audioLayer("kick.wav"), x = w.plain("Logo"), y = w.plain("Ring");
  const r = ok(w.call("audio_react", { audio_layer_id: a.id, layer_ids: [x.id, y.id], path: "scale", from: [100, 100], to: [130, 130] }));
  assert.equal(r.set, 2); assert.equal(r.valid, true); assert.ok(r.range[0] < r.range[1]);
  const ex = x.tg["ADBE Scale"].expression;
  assert.equal(ex, y.tg["ADBE Scale"].expression);
  assert.match(ex, /^\/\/ ae-motion audio\n/); assert.match(ex, /thisComp\.layer\("Audio Amplitude: kick\.wav"\)\.effect\(3\)\(1\)/); assert.match(ex, /\[100,100\], \[130,130\]\);$/);
  ok(w.call("audio_react", { audio_layer_id: a.id, layer_ids: [x.id], path: "opacity", from: 40, to: 100, channel: "left" }));
  assert.equal(w.log.menuRuns, 1, "amplitude null reused");
  assert.match(x.tg["ADBE Opacity"].expression, /effect\(1\)\(1\)/);
});

t("errors: no audio, no menu command, silent track", () => {
  const w = makeWorld(loudness(grid(120, 0.25))), title = w.plain("Title");
  fails(w.call("beat_markers", { audio_layer_id: title.id }), "BAD_ARGS");
  const w2 = makeWorld(loudness(grid(120, 0.25)), { menu: false }), a2 = w2.audioLayer("x.wav");
  fails(w2.call("beat_markers", { audio_layer_id: a2.id }), "UNSUPPORTED");
  assert.equal(a2.audioEnabled, true);
  const w3 = makeWorld(new Array(240).fill(0)), a3 = w3.audioLayer("silent.wav"), l3 = w3.plain("L");
  fails(w3.call("audio_react", { audio_layer_id: a3.id, layer_ids: [l3.id], path: "scale", from: [100, 100], to: [120, 120] }), "BAD_ARGS");
});

t("find_sound_cues: whoosh at a move's fastest frame, impact on an abrupt landing, pop on a scale pop, typing and swipe with durations", () => {
  const w = makeWorld([]);
  const car = w.plain("Car"); car.tg["ADBE Position"].keys = [{ t: 1, v: [-300, 400, 0] }, { t: 2, v: [600, 400, 0] }];
  const ball = w.plain("Ball"); ball.tg["ADBE Position"].keys = [{ t: 3, v: [640, 0, 0] }, { t: 3.4, v: [640, 650, 0] }];
  ball.tg["ADBE Position"].valueAtTime = function (t) { const [a, b] = this.keys; const u = Math.max(0, Math.min(1, (t - a.t) / (b.t - a.t))); return [640, 650 * u * u, 0]; }; // falls and hits the floor
  const title = w.plain("25 lakh", w.TextLayer, { inPoint: 4.35 });
  title.tg["ADBE Scale"].keys = [{ t: 4.35, v: [0, 0, 100] }, { t: 4.55, v: [112, 112, 100] }, { t: 4.7, v: [100, 100, 100] }];
  const line = w.plain("For your future", w.TextLayer, { inPoint: 5, groups: { "ADBE Text Properties": w.group([w.group([w.group([w.keyed("ADBE Text Percent Start", [[5.15, 0], [6, 100]])])])]) } });
  const arrow = w.plain("Arrow", w.ShapeLayer, { groups: { "ADBE Root Vectors Group": w.group([w.group([w.keyed("ADBE Vector Trim End", [[4.05, 0], [4.45, 100]])])]) } });
  w.audioLayer("music.wav");
  const r = ok(w.call("find_sound_cues", { comp_id: 1 }));
  const by = (layer, event) => r.cues.find((c) => c.layer === layer && c.event === event) ?? assert.fail(`no ${event} cue on ${layer}: ${JSON.stringify(r.cues)}`);
  const none = (layer, event) => !r.cues.some((c) => c.layer === layer && c.event === event);
  near(by("Car", "move").t, 1.5, "whoosh at the middle of an eased move", 1 / FPS);
  assert.equal(by("Car", "move").sound, "whoosh");
  assert.ok(none("Car", "land"), "an eased stop is not an impact");
  near(by("Ball", "land").t, 3.4, "impact when the falling ball stops", 1e-6);
  assert.equal(by("Ball", "land").sound, "impact");
  near(by("25 lakh", "pop_in").t, 4.55, "pop at the scale peak (snapped to a frame)", 0.5 / FPS + 1e-9);
  assert.ok(none("25 lakh", "appear"), "the entrance merges into the stronger pop");
  assert.deepEqual([by("For your future", "type_on").sound, +by("For your future", "type_on").duration.toFixed(3)], ["typing", 0.85]);
  assert.deepEqual([by("Arrow", "draw_on").sound, +by("Arrow", "draw_on").duration.toFixed(3)], ["swipe", 0.4]);
  assert.ok(!r.cues.some((c) => c.layer === "music.wav"), "audio layers have no cues");
  const ts = r.cues.map((c) => c.t); assert.deepEqual(ts, [...ts].sort((x, y) => x - y), "in time order");
  assert.equal(ok(w.call("find_sound_cues", { comp_id: 1, start: 4, end: 5 })).cues.every((c) => c.t >= 4 && c.t <= 5), true);
  assert.equal(ok(w.call("find_sound_cues", { comp_id: 1, max: 2 })).count, 2);
});

t("find_sound_cues as a sound designer: simultaneous moments merge, entrances at a cut are one hit, a budget keeps the heroes spaced out", () => {
  const w = makeWorld([]);
  // four pieces of debris fly out together: one whoosh, not four
  const debris = [1, 2, 3, 4].map((i) => { const d = w.plain("Debris " + i); d.tg["ADBE Position"].keys = [{ t: 1, v: [640, 600, 0] }, { t: 1.6, v: [640 + i * 150, 100, 0] }]; return d; });
  // a card cut at 3 s: the old card ends, three new layers appear on the same frame
  const old = w.plain("Old card"); old.outPoint = 3;
  ["Card", "Word", "Icon"].forEach((n) => w.plain(n, undefined, { inPoint: 3 }));
  // a ball lands hard at 2 s (the hero)
  const ball = w.plain("Ball"); ball.tg["ADBE Position"].keys = [{ t: 1.7, v: [640, 0, 0] }, { t: 2, v: [640, 650, 0] }];
  ball.tg["ADBE Position"].valueAtTime = function (t) { const [a, b] = this.keys; const u = Math.max(0, Math.min(1, (t - a.t) / (b.t - a.t))); return [640, 650 * u * u, 0]; };
  // many small pops close together
  for (let i = 0; i < 6; i++) { const p = w.plain("Dot " + i, undefined, { inPoint: 4 + i * 0.05 }); p.tg["ADBE Scale"].keys = [{ t: 4 + i * 0.05, v: [0, 0, 100] }, { t: 4.2 + i * 0.05, v: [100, 100, 100] }]; }
  const r = ok(w.call("find_sound_cues", { comp_id: 1 }));
  const whoosh = r.cues.filter((c) => c.sound === "whoosh" && c.t < 1.7);
  assert.equal(whoosh.length, 1, JSON.stringify(r.cues)); assert.equal(plainArr(whoosh[0].layer_ids).length, 4, "the merged cue lists every layer");
  const cut = r.cues.find((c) => Math.abs(c.t - 3) < 1e-6);
  assert.equal(cut.event, "cut"); assert.equal(cut.sound, "hit"); assert.equal(plainArr(cut.layer_ids).length, 3);
  const land = r.cues.find((c) => c.event === "land");
  assert.equal(land.tier, "hero"); assert.ok(r.cues.every((c) => c.priority <= land.priority), "the landing ranks first");
  // the six pops are 50 ms apart: spaced to the normal gap (0.25 s) only two survive
  const pops = r.cues.filter((c) => c.t >= 3.9 && c.t <= 4.6);
  assert.ok(pops.length <= 2, JSON.stringify(pops));
  const ts = r.cues.map((c) => c.t); for (let i = 1; i < ts.length; i++) assert.ok(ts[i] - ts[i - 1] >= 0.25 - 1e-6, "spaced: " + ts);
  // sparse keeps fewer; dense more; max caps; skipped reports the rest
  const sparse = ok(w.call("find_sound_cues", { comp_id: 1, density: "sparse" })), dense = ok(w.call("find_sound_cues", { comp_id: 1, density: "dense" }));
  assert.ok(sparse.count <= r.count && r.count <= dense.count, `${sparse.count} <= ${r.count} <= ${dense.count}`);
  const st = sparse.cues.map((c) => c.t); for (let i = 1; i < st.length; i++) assert.ok(st[i] - st[i - 1] >= 0.45 - 1e-6, "sparse spacing: " + st);
  assert.equal(ok(w.call("find_sound_cues", { comp_id: 1, max: 1 })).cues[0].event, "land", "max 1 keeps the hero");
  assert.ok(sparse.cues.some((c) => c.event === "land"), "sparse still keeps the hero");
  assert.ok(sparse.skipped > 0);
  fails(w.call("find_sound_cues", { comp_id: 1, density: "loud" }), "BAD_ARGS");
});

t("add_sfx: the sound's loudest frame lands on time; fades, volume, one import per file, peak measured once", () => {
  // a whoosh file: loudest 0.4 s in
  const whoosh = Array.from({ length: 30 }, (_, k) => 30 * Math.exp(-(((k - 12) / 4) ** 2)));
  const w = makeWorld(whoosh), music = w.audioLayer("music.wav");
  const r = ok(w.call("add_sfx", { comp_id: 1, path: "/sfx/whoosh.wav", time: 1.5, volume: -9, fade_in: 0.1, fade_out: 0.2 }));
  near(r.peak_offset, 0.4, "peak found", 1e-9); near(r.start, 1.1, "starts 0.4 s early so the peak hits 1.5", 1e-9);
  assert.deepEqual(w.log.audibleDuringRun, ["SFX: whoosh.wav"], "measured alone");
  assert.equal(music.audioEnabled, true);
  const sfx = w.comp._layers.find((l) => l.id === r.layer.id);
  assert.equal(sfx.name, "SFX: whoosh.wav");
  assert.deepEqual(sfx.levels.keys.map((k) => [+k.t.toFixed(3), k.v[0]]), [[1.1, -48], [1.2, -9], [1.9, -9], [2.1, -48]]);
  const r2 = ok(w.call("add_sfx", { comp_id: 1, path: "/sfx/whoosh.wav", time: 4, align: "start", volume: -12 }));
  near(r2.start, 4, "align start", 1e-9);
  ok(w.call("add_sfx", { comp_id: 1, path: "/sfx/whoosh.wav", time: 6 }));
  assert.equal(w.log.imports, 1, "imported once"); assert.equal(w.log.menuRuns, 1, "peak measured once");
  assert.deepEqual(plainArr(w.comp._layers.find((l) => l.id === r2.layer.id).levels.value), [-12, -12]);
  fails(w.call("add_sfx", { comp_id: 1, path: "/sfx/missing.wav", time: 1 }), "NOT_FOUND");
  fails(w.call("add_sfx", { comp_id: 1, path: "/sfx/whoosh.wav", time: 1, fade_in: 0.8, fade_out: 0.8 }), "BAD_ARGS");
});

t("add_sfx lead_in and max_duration keep the hit: a long build-up is cut before the peak, the end is trimmed from the peak", () => {
  // a 4 s cinematic impact whose loudest frame is 2.2 s in (a long build first)
  const w = makeWorld(Array.from({ length: 120 }, (_, k) => (Math.abs(k / FPS - 2.2) < 0.02 ? 30 : k / FPS < 2.2 ? 4 : 6 * Math.exp(-(k / FPS - 2.2)))));
  const r = ok(w.call("add_sfx", { comp_id: 1, path: "/sfx/impact-long.wav", time: 2.5, lead_in: 0.1, max_duration: 0.4 }));
  near(r.peak_offset, 2.2, "peak measured", 1 / FPS); near(r.hit, 2.5, "hit");
  near(r.in, 2.4, "only 0.1 s before the hit plays", 1 / FPS + 1e-6);
  near(r.out, 2.9, "the end is counted from the hit, so the hit is kept", 1 / FPS + 1e-6);
  assert.ok(r.in < r.hit && r.hit < r.out);
});

t("volume alias: a number sets both channels, in set_property and set_keyframes", () => {
  const w = makeWorld([]), m = w.audioLayer("music.wav");
  ok(w.call("set_property", { layer_id: m.id, path: "volume", value: -10 }));
  assert.deepEqual(plainArr(m.levels.value), [-10, -10]);
  ok(w.call("set_keyframes", { layer_id: m.id, path: "volume", keys: [{ t: 0, v: -48 }, { t: 1, v: 0 }] }));
  assert.deepEqual(m.levels.keys.map((k) => plainArr(k.v)), [[-48, -48], [0, 0]]);
});

t("duck_music: under a voice-over only where it is heard, under short effects for their length; markers + one expression", () => {
  // voice-over 1-7 s that talks 1-3 s and 5-7 s (a pause in between); a 0.5 s effect at 3.6 s; music under both
  const vo = Array.from({ length: 240 }, (_, k) => ((k >= 30 && k < 90) || (k >= 150 && k < 210) ? 20 + (k % 3) : 0.2));
  const w = makeWorld((name) => (name === "voice.wav" ? vo : [])), music = w.audioLayer("music.wav"), voice = w.audioLayer("voice.wav"), sfx = w.audioLayer("SFX: pop.wav");
  voice.inPoint = 0; voice.outPoint = 8; sfx.inPoint = 3.6; sfx.outPoint = 4.1;
  music.levels.keys = [{ t: 0, v: [-48, -48] }, { t: 1, v: [0, 0] }]; // an existing fade-in
  const r = ok(w.call("duck_music", { music_layer_id: music.id, amount: -12 }));
  const spans = r.spans.map(([a, b]) => [+a.toFixed(3), +b.toFixed(3)]);
  assert.deepEqual(spans, [[1, 3], [3.6, 4.1], [5, 7]], "voice ducked only while talking; the effect for its length");
  assert.equal(r.valid, true);
  assert.deepEqual(music.markers.keys.map((k) => [+k.t.toFixed(3), k.v.comment, +k.v.duration.toFixed(3)]), [[1, "duck", 2], [3.6, "duck", 0.5], [5, "duck", 2]]);
  const ex = music.levels.expression;
  assert.match(ex, /^\/\/ ae-motion duck\n/); assert.match(ex, /d = -12, att = 0\.15, rel = 0\.4/);
  assert.equal(music.levels.keys.length, 2, "the fade-in keys are kept");
  // re-run with span mode: the voice counts as a whole, close ducks merge, old duck markers are replaced but others kept
  music.markers.setValueAtTime(7.5, Object.assign(Object.create(null), { comment: "outro" }));
  const r2 = ok(w.call("duck_music", { music_layer_id: music.id, mode: "span" }));
  assert.deepEqual(r2.spans.map(([a, b]) => [+a.toFixed(3), +b.toFixed(3)]), [[0, 8]]);
  assert.equal(r2.replaced, 3);
  assert.deepEqual(music.markers.keys.map((k) => k.v.comment), ["duck", "outro"]);
  fails(w.call("duck_music", { music_layer_id: music.id, amount: 6 }), "BAD_ARGS");
  const w2 = makeWorld([]), lone = w2.audioLayer("music.wav");
  fails(w2.call("duck_music", { music_layer_id: lone.id }), "BAD_ARGS");
});

for (const [name, pass, msg] of results) console.log((pass ? "PASS" : "FAIL") + "  " + name + (pass ? "" : "\n      " + msg));
console.log(`\n${results.filter((r) => r[1]).length}/${results.length} passed`);
process.exit(results.every((r) => r[1]) ? 0 : 1);
