// @ts-nocheck -- the fake After Effects DOM here is deliberately loose (untyped fakes); these tests are checked by running them.
// The motion tools (host/commands/motion.jsx: animate, text_reveal, transition, review_motion) against a fake After
// Effects whose properties evaluate the expressions the tools write, so the spring and reveal maths (overshoot,
// exact landing, stagger order) is checked on real values, not just on the expression text.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import assert from "node:assert/strict";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC = fs.readFileSync(path.join(ROOT, "panel", "host", "host.jsx"), "utf8");
const FPS = 30;
const LIN = 6612, BEZ = 6613, HOLD = 6614;
const PT = { PROPERTY: 1, INDEXED_GROUP: 2, NAMED_GROUP: 3 };
const SPATIAL = new Set(["ADBE Position", "ADBE Vector Position"]);

const vadd = (a, b) => (Array.isArray(a) ? a.map((x, i) => x + b[i]) : a + b);
const vsub = (a, b) => (Array.isArray(a) ? a.map((x, i) => x - b[i]) : a - b);
const vmul = (a, s) => (Array.isArray(a) ? a.map((x) => x * s) : a * s);

/** Run an After Effects expression: the last statement's value, with the expression globals of one property. */
function evalExpr(code, scope) {
  return new Function("ctx", "with (ctx) { return eval(ctx.__code); }")({ ...scope, __code: code, Math });
}

class Prop {
  constructor(matchName, v = 0) {
    this.matchName = matchName; this.name = matchName; this._v = v; this.keys = []; this.expression = ""; this.propertyType = PT.PROPERTY;
    this.dimensionsSeparated = false; this.isSpatial = SPATIAL.has(matchName); this.canVaryOverTime = true; this.canSetExpression = true; this.text = null;
  }
  get expressionEnabled() { return this.expression !== ""; }
  get expressionError() { return ""; }
  get value() { return this._v; }
  setValue(v) { this._v = v; }
  get numKeys() { return this.keys.length; }
  keyTime(i) { return this.keys[i - 1].t; }
  keyValue(i) { return this.keys[i - 1].v; }
  removeKey(i) { this.keys.splice(i - 1, 1); }
  nearestKeyIndex(t) { let b = 1; this.keys.forEach((k, i) => { if (Math.abs(k.t - t) < Math.abs(this.keys[b - 1].t - t)) b = i + 1; }); return b; }
  setValueAtTime(t, v) {
    const i = this.keys.findIndex((k) => Math.abs(k.t - t) < 1e-9);
    if (i >= 0) this.keys[i].v = v;
    else { this.keys.push({ t, v, ii: LIN, oi: LIN, ie: [], oe: [] }); this.keys.sort((a, b) => a.t - b.t); }
  }
  keyInInterpolationType(i) { return this.keys[i - 1].ii; }
  keyOutInterpolationType(i) { return this.keys[i - 1].oi; }
  keyInTemporalEase(i) { return this.keys[i - 1].ie; }
  keyOutTemporalEase(i) { return this.keys[i - 1].oe; }
  // like After Effects: setting an ease switches the key to bezier
  setTemporalEaseAtKey(i, a, b) { const k = this.keys[i - 1]; k.ie = a; k.oe = b; k.ii = BEZ; k.oi = BEZ; }
  setInterpolationTypeAtKey(i, a, b) { const k = this.keys[i - 1]; k.ii = a; k.oi = b === undefined ? a : b; }
  /** Keyed value (linear between keys; easing is not modelled), then the expression unless pre is true. */
  valueAtTime(t, pre, extra = {}) {
    const k = this.keys;
    let v = this._v;
    if (k.length) {
      if (t <= k[0].t) v = k[0].v;
      else if (t >= k[k.length - 1].t) v = k[k.length - 1].v;
      else { const i = k.findIndex((x) => x.t > t), a = k[i - 1], b = k[i]; v = vadd(a.v, vmul(vsub(b.v, a.v), (t - a.t) / (b.t - a.t))); }
    }
    if (pre || !this.expression) return v;
    const self = this;
    return evalExpr(this.expression, {
      time: t, value: v, numKeys: k.length, add: vadd, sub: vsub, mul: vmul,
      key: (n) => ({ time: k[n - 1].t, value: k[n - 1].v }),
      nearestKey: (tt) => ({ index: self.nearestKeyIndex(tt) }),
      ...extra,
    });
  }
}

// Groups make any child they are asked for: a group if the match name is a known group, else a property.
const GROUPS = new Set(["ADBE Transform Group", "ADBE Text Properties", "ADBE Text Animators", "ADBE Text Animator", "ADBE Text Animator Properties", "ADBE Text Selectors",
  "ADBE Text Expressible Selector", "ADBE Mask Parade", "ADBE Mask Atom", "ADBE Root Vectors Group", "ADBE Vector Group", "ADBE Vectors Group", "ADBE Vector Transform Group",
  "ADBE Vector Shape - Rect", "ADBE Vector Shape - Ellipse", "ADBE Vector Graphic - Fill", "ADBE Vector Graphic - Stroke", "ADBE Effect Parade"]);
const INDEXED = new Set(["ADBE Text Animators", "ADBE Text Selectors", "ADBE Mask Parade", "ADBE Root Vectors Group", "ADBE Vectors Group", "ADBE Text Animator Properties", "ADBE Effect Parade"]);
class Group {
  constructor(matchName) { this.matchName = matchName; this.name = matchName; this.children = []; this.propertyType = INDEXED.has(matchName) ? PT.INDEXED_GROUP : PT.NAMED_GROUP; }
  get numProperties() { return this.children.length; }
  make(m) { const c = GROUPS.has(m) ? new Group(m) : new Prop(m); this.children.push(c); c.propertyIndex = this.children.length; const parent = this; c.moveTo = (i) => parent.moveChild(c, i); return c; }
  property(k) { if (typeof k === "number") return this.children[k - 1]; return this.children.find((c) => c.matchName === k) || this.make(k); }
  addProperty(m) { return this.make(m); }
  /** Like After Effects: move a child to a 1-based index (the others shift). */
  moveChild(c, i) { this.children.splice(this.children.indexOf(c), 1); this.children.splice(i - 1, 0, c); this.children.forEach((x, k) => (x.propertyIndex = k + 1)); }
  canAddProperty() { return true; }
}

function makeWorld() {
  let nextId = 10;
  class CompItem {} class AVLayer {} class TextLayer {} class ShapeLayer {} class CameraLayer {} class LightLayer {} class Stub {}
  class Shape {} class KeyframeEase { constructor(speed, influence) { this.speed = speed; this.influence = influence; } }
  class MarkerValue { constructor(c) { this.comment = c; } }
  const layers = new Map();
  const comp = Object.assign(new CompItem(), {
    id: 1, name: "Main", width: 1920, height: 1080, duration: 6, frameRate: FPS, frameDuration: 1 / FPS, numLayers: 0, _layers: [],
    markerProperty: new Prop("ADBE Marker", null), layer: (i) => comp._layers[i - 1],
  });
  const reindex = () => { comp._layers.forEach((x, i) => (x.index = i + 1)); comp.numLayers = comp._layers.length; };
  const add = (l, top = false) => {
    const root = new Group("root"), tg = root.property("ADBE Transform Group");
    tg.property("ADBE Anchor Point").setValue([0, 0, 0]);
    tg.property("ADBE Position").setValue([960, 540, 0]);
    tg.property("ADBE Scale").setValue([100, 100, 100]);
    tg.property("ADBE Rotate Z").setValue(0);
    tg.property("ADBE Opacity").setValue(100);
    Object.assign(l, { id: nextId++, containingComp: comp, enabled: true, locked: false, parent: null, startTime: 0, label: 0, inPoint: 0, outPoint: comp.duration, hasAudio: false, hasVideo: true });
    l.root = root; l.tg = tg;
    l.property = (k) => root.property(k);
    Object.defineProperty(l, "numProperties", { get: () => root.numProperties });
    if (top) comp._layers.unshift(l); else comp._layers.push(l);
    layers.set(l.id, l); reindex();
    return l;
  };
  const solid = (name, extra = {}) => add(Object.assign(new AVLayer(), { name, source: { mainSource: new Stub() } }, extra));
  const text = (name, txt, size = 80) => {
    const l = add(Object.assign(new TextLayer(), { name }));
    const doc = l.property("ADBE Text Properties").property("ADBE Text Document");
    doc.setValue({ text: txt, fontSize: size });
    l.sourceRectAtTime = () => ({ top: -60, left: -300, width: 600, height: 80 });
    return l;
  };
  comp.layers = { addShape: () => add(Object.assign(new ShapeLayer(), { name: "Shape Layer" }), true) };
  const app = { project: { itemByID: (id) => (id === 1 ? comp : null), layerByID: (id) => layers.get(id) || null }, beginUndoGroup() {}, endUndoGroup() {} };
  const ctx = { app, MarkerValue, CompItem, AVLayer, TextLayer, ShapeLayer, CameraLayer, LightLayer, FolderItem: Stub, FootageItem: Stub, SolidSource: Stub, Shape, KeyframeEase,
    KeyframeInterpolationType: { LINEAR: LIN, BEZIER: BEZ, HOLD }, PropertyType: PT,
    PropertyValueType: { OneD: 1, TwoD: 2, ThreeD: 3, COLOR: 4, TwoD_SPATIAL: 5, ThreeD_SPATIAL: 6, SHAPE: 7, TEXT_DOCUMENT: 8, NO_VALUE: 9, MARKER: 10, CUSTOM_VALUE: 11 } };
  vm.createContext(ctx);
  vm.runInContext(SRC, ctx);
  const call = (cmd, args = {}) => JSON.parse(ctx.AEM.dispatch(JSON.stringify({ cmd, args })));
  return { call, comp, solid, text, MarkerValue };
}

const results = [];
const t = (name, fn) => { try { fn(); results.push([name, true]); } catch (e) { results.push([name, false, e.stack]); } };
const ok = (r) => { assert.equal(r.ok, true, JSON.stringify(r.error)); return r.result; };
const fails = (r, code) => { assert.equal(r.ok, false, "should fail"); if (code) assert.equal(r.error.code, code, JSON.stringify(r.error)); return r.error; };
const near = (a, b, m = "", tol = 1e-6) => assert.ok(Math.abs(a - b) <= tol, `${m}: expected ${b}, got ${a}`);
const plain = (v) => JSON.parse(JSON.stringify(v));
const P = (l, m) => l.tg.property(m);

t("animate pop: scale springs from 0, overshoots once and lands exactly; opacity is quick and eased", () => {
  const w = makeWorld(), a = w.solid("Card");
  const r = ok(w.call("animate", { layer_ids: [a.id], move: "pop", time: 1 }));
  assert.equal(r.style, "spring");
  const sc = P(a, "ADBE Scale"), op = P(a, "ADBE Opacity");
  assert.deepEqual(sc.keys.map((k) => [+k.t.toFixed(4), plain(k.v)]), [[1, [0, 0, 0]], [1.6, [100, 100, 100]]]);
  assert.ok(sc.expression.startsWith("// ae-motion spring"));
  near(sc.valueAtTime(1)[0], 0, "starts at 0");
  let peak = 0;
  for (let x = 1; x <= 1.6; x += 1 / FPS) peak = Math.max(peak, sc.valueAtTime(x)[0]);
  assert.ok(peak > 108 && peak < 120, "overshoots about 13 %: " + peak);
  near(sc.valueAtTime(1.6)[0], 100, "lands exactly", 1e-9);
  near(sc.valueAtTime(3)[0], 100, "stays");
  // the springy keys are linear (the expression shapes the motion)
  assert.equal(sc.keys[0].oi, LIN); assert.equal(sc.keys[1].ii, LIN);
  // opacity: 0 -> 100 over the first 35 %, snappy: linear out of the first key, long ease into the last
  assert.deepEqual(op.keys.map((k) => +k.t.toFixed(3)), [1, 1.21]);
  assert.equal(op.keys[0].oi, LIN); assert.equal(op.keys[1].ii, BEZ); near(op.keys[1].ie[0].influence, 85);
  assert.equal(op.expression, "");
});

t("animate slide: offsets against the direction of travel, staggers layers, keeps rest values", () => {
  const w = makeWorld(), ls = [w.solid("A"), w.solid("B"), w.solid("C")];
  P(ls[1], "ADBE Position").setValue([500, 300, 0]);
  const r = ok(w.call("animate", { layer_ids: ls.map((l) => l.id), move: "slide", direction: "left", distance: 200, time: 0.5, stagger: 0.1, style: "smooth" }));
  assert.deepEqual(r.layers.map((x) => +x.start.toFixed(4)), [0.5, 0.6, 0.7]);
  const p = P(ls[1], "ADBE Position");
  assert.deepEqual(p.keys.map((k) => plain(k.v)), [[700, 300, 0], [500, 300, 0]], "comes from the right, moving left, to its rest");
  near(p.keys[0].t, 0.6); near(p.keys[1].t, 1.2);
  assert.equal(p.keys[0].oi, BEZ); near(p.keys[0].oe[0].influence, 70); near(p.keys[1].ie[0].influence, 70);
  assert.equal(p.expression, "", "smooth uses keys only");
});

t("animate out after a spring entrance: one spring segment, the exit accelerates", () => {
  const w = makeWorld(), a = w.solid("Card");
  ok(w.call("animate", { layer_ids: [a.id], move: "pop", time: 1 }));
  ok(w.call("animate", { layer_ids: [a.id], move: "pop", phase: "out", time: 4 }));
  const sc = P(a, "ADBE Scale");
  assert.deepEqual(sc.keys.map((k) => +k.t.toFixed(4)), [1, 1.6, 4, 4.4]);
  assert.equal((sc.expression.match(/var S=(\[.*\]);/) || [])[1], "[[1,6,9.42,0]]");
  near(sc.valueAtTime(4.2)[0], 50, "exit segment is keyed, not sprung"); // linear in the mock
  assert.equal(sc.keys[2].oi, BEZ); assert.equal(sc.keys[3].ii, LIN, "exits leave fast");
  // re-running the entrance replaces its spring entry instead of adding a second
  ok(w.call("animate", { layer_ids: [a.id], move: "pop", time: 1 }));
  assert.equal((sc.expression.match(/var S=(\[.*\]);/) || [])[1], "[[1,6,9.42,0]]");
});

t("animate drop bounces to rest without passing it; refuses foreign expressions before changing anything", () => {
  const w = makeWorld(), a = w.solid("Ball"), b = w.solid("Other");
  ok(w.call("animate", { layer_ids: [a.id], move: "drop", time: 0 }));
  const p = P(a, "ADBE Position");
  let below = 0, bounced = false, prev = -1e9;
  for (let x = 0; x <= 0.6; x += 1 / FPS) { const y = p.valueAtTime(x)[1]; below = Math.max(below, y - 540); if (y < prev - 0.5) bounced = true; prev = y; }
  assert.ok(below < 1e-6, "never passes the rest position: " + below);
  assert.ok(bounced, "bounces back up at least once");
  near(p.valueAtTime(0.6)[1], 540, "lands", 1e-9);
  P(b, "ADBE Opacity").expression = "wiggle(2, 10)";
  fails(w.call("animate", { layer_ids: [a.id, b.id], move: "fade", phase: "out" }), "BAD_ARGS");
  assert.equal(P(a, "ADBE Opacity").keys.length, 2, "the first layer was not touched by the failed call (only its drop keys)");
});

t("text_reveal: an expression selector staggers units in order; amounts run 100 -> 0 and the end time is right", () => {
  const w = makeWorld(), l = w.text("Title", "HELLO WORLD");
  const r = ok(w.call("text_reveal", { layer_id: l.id, style: "rise", by: "words", time: 1, duration: 0.5, stagger: 0.2, mask: true }));
  assert.equal(r.units, 2); near(r.end, 1.7);
  const an = l.property("ADBE Text Properties").property("ADBE Text Animators").property(1);
  const props = an.property("ADBE Text Animator Properties");
  assert.equal(props.property("ADBE Text Opacity").value, 0);
  assert.deepEqual(plain(props.property("ADBE Text Position 3D").value), [0, 54, 0]);
  const sel = an.property("ADBE Text Selectors").property(1);
  assert.equal(sel.matchName, "ADBE Text Expressible Selector");
  assert.equal(sel.property("ADBE Text Range Type2").value, 3, "based on words");
  const amt = sel.property("ADBE Text Expressible Amount");
  const at = (time, i) => amt.valueAtTime(time, false, { textIndex: i, textTotal: 2 });
  near(at(1, 1), 100, "word 1 starts hidden"); near(at(1.2, 2), 100, "word 2 waits for its stagger");
  assert.ok(at(1.2, 1) < 30, "snappy: most of the way after 40 %");
  near(at(1.5, 1), 0, "word 1 at rest"); near(at(1.7, 2), 0, "word 2 at rest by the end");
  // the mask line sits at the text's baseline, so letters rise out from behind it
  const mask = l.property("ADBE Mask Parade").property(1);
  assert.equal(mask.name, "Reveal line");
  const ys = mask.property("ADBE Mask Shape").value.vertices.map((v) => v[1]);
  near(Math.max(...ys), 20 + 80 * 0.12, "mask bottom just under the text box");
});

t("text_reveal: reverse / center orders, typewriter steps, out phase, refusals", () => {
  const w = makeWorld(), l = w.text("T", "ABCDE");
  ok(w.call("text_reveal", { layer_id: l.id, style: "fade", order: "reverse", time: 0, duration: 0.3, stagger: 0.1 }));
  const amt = (k) => l.property("ADBE Text Properties").property("ADBE Text Animators").property(k).property("ADBE Text Selectors").property(1).property("ADBE Text Expressible Amount");
  const a1 = (time, i) => amt(1).valueAtTime(time, false, { textIndex: i, textTotal: 5 });
  assert.ok(a1(0.2, 5) < a1(0.2, 1), "reverse: the last letter goes first");
  ok(w.call("text_reveal", { layer_id: l.id, style: "typewriter", time: 0 }));
  const a2 = (time, i) => amt(2).valueAtTime(time, false, { textIndex: i, textTotal: 5 });
  assert.equal(a2(0.06, 1), 0); assert.equal(a2(0.06, 2), 0); assert.equal(a2(0.06, 3), 100, "typewriter: letters snap on one by one");
  ok(w.call("text_reveal", { layer_id: l.id, style: "fade", phase: "out", time: 3, duration: 0.2, stagger: 0 }));
  const a3 = (time) => amt(3).valueAtTime(time, false, { textIndex: 1, textTotal: 5 });
  near(a3(2.9), 0); near(a3(3.2), 100);
  fails(w.call("text_reveal", { layer_id: w.solid("S").id }), "BAD_ARGS");
  fails(w.call("text_reveal", { layer_id: l.id, by: "letters" }), "BAD_ARGS");
});

t("transition bars: every bar covers the frame at time, arriving and leaving in order", () => {
  const w = makeWorld();
  const r = ok(w.call("transition", { comp_id: 1, time: 2, type: "bars", bars: 4, duration: 0.8, direction: "right" }));
  near(r.covered_at, 2); near(r.layer.in, 1.6); assert.ok(r.layer.out >= 2.4);
  const l = w.comp._layers[0], root = l.property("ADBE Root Vectors Group");
  assert.equal(root.numProperties, 4);
  const firstMove = [];
  for (let i = 1; i <= 4; i++) {
    const pos = root.property(i).property("ADBE Vector Transform Group").property("ADBE Vector Position");
    const v = pos.valueAtTime(2, true);
    near(v[0], 0, "bar " + i + " centred at the cut", 1e-6);
    assert.ok(pos.keys[0].v[0] < -1920, "starts off the left edge");
    assert.ok(pos.keys[pos.keys.length - 1].v[0] > 1920, "leaves off the right edge");
    firstMove.push(pos.keys[0].t);
  }
  assert.ok(firstMove.every((x, i) => i === 0 || x > firstMove[i - 1]), "staggered");
});

t("transition iris: a disc grows to cover, then a hole opens from the centre", () => {
  const w = makeWorld();
  ok(w.call("transition", { comp_id: 1, time: 1, type: "iris", duration: 1 }));
  const g = w.comp._layers[0].property("ADBE Root Vectors Group").property(1).property("ADBE Vectors Group");
  const size = g.property(1).property("ADBE Vector Ellipse Size"), width = g.property(2).property("ADBE Vector Stroke Width");
  const R = Math.hypot(960, 540);
  assert.deepEqual(size.keys.map((k) => +plain(k.v)[0].toFixed(3)), [0, +R.toFixed(3), +(2 * R).toFixed(3)]);
  assert.deepEqual(width.keys.map((k) => +k.v.toFixed(3)), [0, +R.toFixed(3), 0]);
  // outer edge (size/2 + width/2) / 2 ... in radius terms: covered radius at the cut is R from the centre
  near(size.keys[1].v[0] / 2 + width.keys[1].v / 2, R, "covers the corners");
  fails(w.call("transition", { comp_id: 1, time: 0.1, duration: 1 }), "BAD_ARGS");
});

t("review_motion: flags linear keys, unison starts, holds, pop-ons and small text; reports beat sync", () => {
  const w = makeWorld(), ls = [w.solid("A"), w.solid("B"), w.solid("C")];
  for (const l of ls) { const p = P(l, "ADBE Opacity"); p.setValueAtTime(0, 0); p.setValueAtTime(0.5, 100); } // linear by default
  const late = w.solid("Late"); late.inPoint = 4;
  const small = w.text("Caption", "fine print", 14);
  for (const b of [0, 0.5, 1, 1.5]) w.comp.markerProperty.setValueAtTime(b, new w.MarkerValue("beat"));
  const r = ok(w.call("review_motion", { comp_id: 1 }));
  const types = (x) => r.issues.filter((i) => i.type === x);
  assert.equal(types("linear").length, 1, "one entry for the same problem on three layers"); assert.equal(types("linear")[0].layer_ids.length, 3);
  assert.equal(types("unison").length, 1); assert.equal(types("unison")[0].layer_ids.length, 3);
  assert.ok(types("hold").some((h) => Math.abs(h.t - 0.5) < 1e-6 && Math.abs(h.duration - 3.5) < 1e-6), JSON.stringify(types("hold")));
  assert.equal(types("pops_on").length, 0, "info notes are counted, not listed"); assert.equal(r.stats.info.pops_on, 1);
  const full = ok(w.call("review_motion", { comp_id: 1, all: true }));
  assert.equal(full.issues.find((i) => i.type === "pops_on").layer_id, late.id);
  assert.equal(types("small_text")[0].layer_id, small.id);
  assert.equal(r.stats.on_beat, 1);
  assert.equal(r.issues[0].severity, "warn", "warnings first");
  // after animate with springs and a stagger, the same layers are clean
  for (const l of ls) P(l, "ADBE Opacity").keys = [];
  ok(w.call("animate", { layer_ids: ls.map((l) => l.id), move: "pop", time: 0, stagger: 0.05 }));
  const r2 = ok(w.call("review_motion", { comp_id: 1, max_hold: 10 }));
  assert.equal(r2.issues.filter((i) => i.type === "linear" || i.type === "unison").length, 0, JSON.stringify(r2.issues));
});

t("set_keyframes / edit_keyframes interp spring: any property springs; moves, deletes and re-interps keep the expression in step", () => {
  const w = makeWorld(), a = w.solid("Any"), op = P(a, "ADBE Rotate Z");
  ok(w.call("set_keyframes", { layer_id: a.id, path: "rotation", keys: [{ t: 0, v: 0, interp: "spring" }, { t: 1, v: 90, ease_out: "easy" }, { t: 2, v: 0, interp: "bounce" }, { t: 3, v: 45 }] }));
  assert.ok(op.expression.startsWith("// ae-motion spring"));
  assert.equal((op.expression.match(/var S=(\[.*\]);/) || [])[1], "[[0,6,9.42,0],[2,5,14.137,1]]");
  let peak = 0;
  for (let x = 0; x <= 1; x += 1 / FPS) peak = Math.max(peak, op.valueAtTime(x));
  assert.ok(peak > 95, "spring overshoots 90: " + peak);
  near(op.valueAtTime(1), 90, "lands on the key", 1e-9);
  assert.equal(op.keys[0].oi, LIN); assert.equal(op.keys[1].ii, LIN, "the sprung segment's keys are linear");
  const keys = ok(w.call("get_keyframes", { layer_id: a.id, path: "rotation" })).keys;
  assert.deepEqual(keys.map((k) => k.interp_out), ["spring", "bezier", "bounce", "linear"]);
  // move the bounce key: its spring moves with it
  ok(w.call("edit_keyframes", { layer_id: a.id, path: "rotation", edits: [{ action: "move", t: 2, to: 2.5 }] }));
  assert.equal((op.expression.match(/var S=(\[.*\]);/) || [])[1], "[[0,6,9.42,0],[2.5,5,14.137,1]]");
  // a plain interp on the first key stops its spring; deleting the last sprung key drops the expression
  ok(w.call("edit_keyframes", { layer_id: a.id, path: "rotation", edits: [{ action: "set", t: 0, interp: "bezier" }] }));
  assert.equal((op.expression.match(/var S=(\[.*\]);/) || [])[1], "[[2.5,5,14.137,1]]");
  ok(w.call("edit_keyframes", { layer_id: a.id, path: "rotation", edits: [{ action: "delete", t: 2.5 }] }));
  assert.equal(op.expression, "");
  // set_keyframes replaces a spring expression with the new keys' springs (none here)
  ok(w.call("edit_keyframes", { layer_id: a.id, path: "rotation", edits: [{ action: "set", t: 1, interp: "spring" }] }));
  ok(w.call("set_keyframes", { layer_id: a.id, path: "rotation", keys: [{ t: 0, v: 0 }, { t: 1, v: 10 }] }));
  assert.equal(op.expression, "");
  // another expression is never overwritten
  op.expression = "wiggle(1, 5)";
  fails(w.call("edit_keyframes", { layer_id: a.id, path: "rotation", edits: [{ action: "set", t: 0, interp: "spring" }] }), "BAD_ARGS");
  fails(w.call("set_keyframes", { layer_id: a.id, path: "rotation", keys: [{ t: 0, v: 0, interp: "spring" }, { t: 1, v: 1 }] }), "BAD_ARGS");
  assert.equal(op.expression, "wiggle(1, 5)");
});

t("a text_reveal is one sound cue for the whole reveal (not one per letter), and review_motion knows when it ends", () => {
  const w = makeWorld(), l = w.text("Words", "one two three four");
  ok(w.call("text_reveal", { layer_id: l.id, style: "rise", by: "words", time: 1, duration: 0.4, stagger: 0.1 }));
  const r = ok(w.call("find_sound_cues", { comp_id: 1 }));
  const rev = r.cues.filter((c) => c.event === "reveal");
  assert.equal(rev.length, 1, JSON.stringify(r.cues)); near(rev[0].duration, 0.7, "4 words: 0.4 + 3 * 0.1"); assert.equal(rev[0].sound, "swoosh");
  l.outPoint = 1.75; // the reveal (ends 1.7) fits: no cut_off
  assert.ok(!ok(w.call("review_motion", { comp_id: 1 })).issues.some((i) => i.type === "cut_off"));
});

t("add_shape at top (default) becomes group 1 and shifts the others; at bottom keeps their indexes", () => {
  const w = makeWorld(), l = w.comp.layers.addShape();
  const root = l.property("ADBE Root Vectors Group");
  const r1 = ok(w.call("add_shape", { layer_id: l.id, shape: { type: "rect", size: [10, 10], fill: [1, 0, 0], name: "First" } }));
  const r2 = ok(w.call("add_shape", { layer_id: l.id, shape: { type: "rect", size: [10, 10], fill: [0, 1, 0], name: "Second" } }));
  assert.equal(r2.group_index, 1); assert.equal(root.property(1).name, "Second"); assert.equal(root.property(2).name, "First", "the earlier group moved down");
  const r3 = ok(w.call("add_shape", { layer_id: l.id, shape: { type: "rect", size: [10, 10], fill: [0, 0, 1], name: "Third" }, at: "bottom" }));
  assert.equal(r3.group_index, 3); assert.equal(root.property(3).name, "Third"); assert.equal(root.property(1).name, "Second", "indexes kept");
  assert.deepEqual(plain(r3.path_group), ["ADBE Root Vectors Group", 3, "ADBE Vectors Group"]);
  fails(w.call("add_shape", { layer_id: l.id, shape: { type: "rect" }, at: "middle" }), "BAD_ARGS");
});

for (const [name, pass, msg] of results) console.log((pass ? "PASS" : "FAIL") + "  " + name + (pass ? "" : "\n      " + msg));
console.log(`\n${results.filter((r) => r[1]).length}/${results.length} passed`);
process.exit(results.every((r) => r[1]) ? 0 : 1);
