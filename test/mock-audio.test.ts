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
  constructor(v) { this._v = v; this.keys = []; this.expression = ""; }
  get canSetExpression() { return true; }
  get expressionEnabled() { return this.expression !== ""; }
  get expressionError() { return ""; }
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
  const layers = new Map(), log = { menuRuns: 0, audibleDuringRun: null, workAreaDuringRun: null };
  const comp = Object.assign(new CompItem(), {
    id: 1, name: "Main", width: 1280, height: 720, duration: 10, frameRate: FPS, frameDuration: 1 / FPS, workAreaStart: 2, workAreaDuration: 5,
    numLayers: 0, _layers: [], markerProperty: new Prop(null), layer: (i) => comp._layers[i - 1], openInViewer() {},
  });
  const add = (l, top = false) => {
    Object.assign(l, { id: nextId++, containingComp: comp, selected: false, enabled: true, parent: null, startTime: 0, label: 0, locked: false });
    const tg = { "ADBE Scale": new Prop([100, 100, 100]), "ADBE Opacity": new Prop(100), "ADBE Position": new Prop([0, 0, 0]) };
    const markers = new Prop(null), effects = l.effects || [];
    l.property = (n) => n === "ADBE Transform Group" ? { property: (m) => tg[m] } : n === "ADBE Marker" ? markers : n === "ADBE Effect Parade" ? { numProperties: effects.length, property: (i) => effects[i - 1] } : null;
    l.tg = tg; l.markers = markers;
    l.remove = () => { comp._layers.splice(comp._layers.indexOf(l), 1); layers.delete(l.id); reindex(); };
    if (top) comp._layers.unshift(l); else comp._layers.push(l);
    layers.set(l.id, l); reindex();
    return l;
  };
  const reindex = () => { comp._layers.forEach((x, i) => (x.index = i + 1)); comp.numLayers = comp._layers.length; };
  const audioLayer = (name) => add(Object.assign(new AVLayer(), { name, hasAudio: true, audioEnabled: true, inPoint: 0, outPoint: 8 }));
  const plain = (name) => add(Object.assign(new AVLayer(), { name, hasAudio: false, audioEnabled: false, inPoint: 0, outPoint: 8 }));
  const app = {
    project: { itemByID: (id) => (id === 1 ? comp : null), layerByID: (id) => layers.get(id) || null },
    beginUndoGroup() {}, endUndoGroup() {},
    findMenuCommandId: (n) => (menu && n === "Convert Audio to Keyframes" ? 5015 : 0),
    executeCommand(id) {
      assert.equal(id, 5015);
      log.menuRuns++;
      log.audibleDuringRun = comp._layers.filter((l) => l.hasAudio && l.audioEnabled).map((l) => l.name);
      log.workAreaDuringRun = [comp.workAreaStart, comp.workAreaDuration];
      // the slider keys After Effects writes: one per frame of the work area, for left, right and both channels
      const slider = () => { const p = new Prop(0); amplitude.forEach((v, k) => { const t = k / FPS; if (t >= comp.workAreaStart - 1e-9 && t < comp.workAreaStart + comp.workAreaDuration - 1e-9) p.keys.push({ t, v }); }); return p; };
      const fx = [1, 2, 3].map(() => { const s = slider(); return { property: () => s }; });
      add(Object.assign(new AVLayer(), { name: "Audio Amplitude", hasAudio: false, audioEnabled: false, inPoint: 0, outPoint: 10, effects: fx }), true);
    },
  };
  const ctx = { app, MarkerValue, CompItem, AVLayer, TextLayer, ShapeLayer, CameraLayer, LightLayer, FolderItem: Stub, FootageItem: Stub, SolidSource: Stub, PropertyValueType: {}, PropertyType: {} };
  vm.createContext(ctx);
  vm.runInContext(SRC, ctx);
  const call = (cmd, args = {}) => JSON.parse(ctx.AEM.dispatch(JSON.stringify({ cmd, args })));
  return { call, comp, audioLayer, plain, log };
}

const results = [];
const t = (name, fn) => { try { fn(); results.push([name, true]); } catch (e) { results.push([name, false, e.message]); } };
const ok = (r) => { assert.equal(r.ok, true, JSON.stringify(r.error)); return r.result; };
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

for (const [name, pass, msg] of results) console.log((pass ? "PASS" : "FAIL") + "  " + name + (pass ? "" : "\n      " + msg));
console.log(`\n${results.filter((r) => r[1]).length}/${results.length} passed`);
process.exit(results.every((r) => r[1]) ? 0 : 1);
