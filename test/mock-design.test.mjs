// Logic tests for the design commands in panel/host/host.jsx (bounds, align_layers, set_anchor, layer switches,
// solids, precompose "leave attributes", add_layer_style and add_shape validation) against a fake After Effects DOM.
// The geometry is checked against hand-computed transforms; see "Tests" in docs/development.md.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import assert from "node:assert/strict";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC = fs.readFileSync(path.join(ROOT, "panel", "host", "host.jsx"), "utf8");
const near = (a, b, m = "", tol = 1e-6) => assert.ok(Math.abs(a - b) < tol, `${m} expected ${b}, got ${a}`);
// Values must be arrays of the script's own realm: the host checks `v instanceof Array`, which fails across vm contexts.
let inner = (v) => v;
const plain = (v) => JSON.parse(JSON.stringify(v));

class Prop {
  constructor(v) { this._v = inner(v); this.keys = []; this.expression = ""; this.dimensionsSeparated = false; }
  get expressionEnabled() { return this.expression !== ""; }
  get value() { return this._v; }
  setValue(v) { this._v = v; }
  get numKeys() { return this.keys.length; }
  keyValue(i) { return this.keys[i - 1].v; }
  setValueAtKey(i, v) { this.keys[i - 1].v = v; }
  valueAtTime(t) {
    if (!this.keys.length) return this._v;
    const k = this.keys, u = Math.max(0, Math.min(1, (t - k[0].t) / (k[k.length - 1].t - k[0].t || 1))), a = k[0].v, b = k[k.length - 1].v;
    return Array.isArray(a) ? a.map((x, i) => x + (b[i] - x) * u) : a + (b - a) * u;
  }
}

function makeWorld() {
  let nextId = 10;
  const comp = { id: 1, width: 640, height: 360, frameDuration: 1 / 30, numLayers: 0, _layers: [], layer: (i) => comp._layers[i - 1], openInViewer() {} };
  class TextLayer {} class ShapeLayer {} class CameraLayer {} class LightLayer {} class SolidSource {} class Stub {}
  const layers = new Map();
  const make = (Kind, { name = "L", rect = [0, 0, 100, 50], pos = [0, 0], anchor = [0, 0], scale = [100, 100], rot = 0, solid = false } = {}) => {
    const l = Kind ? new Kind() : {};
    Object.assign(l, {
      id: nextId++, name, containingComp: comp, locked: false, enabled: true, parent: null, threeDLayer: false, inPoint: 0, outPoint: 2, startTime: 0,
      shy: false, solo: false, label: 0, guideLayer: false, adjustmentLayer: false, effectsActive: true, audioEnabled: true, preserveTransparency: false,
    });
    l.source = solid ? { mainSource: new SolidSource(), width: 100, height: 50 } : null;
    if (solid) l.source.mainSource.color = [1, 0, 0];
    const tg = { "ADBE Position": new Prop([...pos, 0]), "ADBE Anchor Point": new Prop([...anchor, 0]), "ADBE Scale": new Prop([...scale, 100]), "ADBE Rotate Z": new Prop(rot),
      "ADBE Rotate X": new Prop(0), "ADBE Rotate Y": new Prop(0), "ADBE Orientation": new Prop([0, 0, 0]), "ADBE Position_0": new Prop(pos[0]), "ADBE Position_1": new Prop(pos[1]) };
    l.property = (n) => (n === "ADBE Transform Group" ? { property: (m) => tg[m] } : null);
    l.sourceRectAtTime = () => ({ left: rect[0], top: rect[1], width: rect[2], height: rect[3] });
    comp._layers.push(l); comp.numLayers = comp._layers.length; l.index = comp.numLayers;
    layers.set(l.id, l);
    return l;
  };
  const app = { project: { itemByID: () => null, layerByID: (id) => layers.get(id) || null }, beginUndoGroup() {}, endUndoGroup() {}, executeCommand() {}, findMenuCommandId: () => 0 };
  const ctx = { app, TextLayer, ShapeLayer, CameraLayer, LightLayer, SolidSource, CompItem: Stub, FolderItem: Stub, FootageItem: Stub, PropertyValueType: {}, PropertyType: {} };
  vm.createContext(ctx);
  const toInner = vm.runInContext("(function (v) { return Array.prototype.slice.call(v); })", ctx);
  inner = (v) => (Array.isArray(v) ? toInner(v) : v);
  vm.runInContext(SRC, ctx);
  const call = (cmd, args = {}) => JSON.parse(ctx.AEM.dispatch(JSON.stringify({ cmd, args })));
  const tp = (l, m) => l.property("ADBE Transform Group").property(m);
  return { call, make, tp, comp, TextLayer, ShapeLayer, CameraLayer };
}

const results = [];
const t = (name, fn) => { try { fn(); results.push([name, true]); } catch (e) { results.push([name, false, e.message]); } };
const ok = (r) => { assert.equal(r.ok, true, JSON.stringify(r.error)); return r.result; };
const fails = (r, code) => { assert.equal(r.ok, false, "should fail"); if (code) assert.equal(r.error.code, code, JSON.stringify(r.error)); return r.error; };
const bounds = (w, l) => ok(w.call("get_layer", { layer_id: l.id })).bounds.comp;

t("comp bounds follow position, anchor, scale and rotation", () => {
  const w = makeWorld();
  const l = w.make(null, { rect: [0, 0, 100, 50], pos: [300, 200], anchor: [50, 25], scale: [200, 100], rot: 90 });
  const b = bounds(w, l);
  // scaled to 200 x 50 around the anchor, then turned 90 degrees: 50 wide, 200 tall, centered on the position
  near(b.width, 50); near(b.height, 200); near(b.center[0], 300); near(b.center[1], 200);
});

t("align center puts the content (not the anchor) in the middle of the comp", () => {
  const w = makeWorld();
  const text = w.make(w.TextLayer, { rect: [10, -90, 280, 94], pos: [100, 100] }); // text: glyphs above the baseline anchor
  ok(w.call("align_layers", { layer_ids: [text.id], align: "center" }));
  const b = bounds(w, text);
  near(b.center[0], 320); near(b.center[1], 180);
});

t("align right with a margin works through a rotated, scaled parent", () => {
  const w = makeWorld();
  const parent = w.make(null, { rect: [0, 0, 100, 100], pos: [150, 90], scale: [50, 50], rot: 30 });
  const child = w.make(w.ShapeLayer, { rect: [-60, -60, 120, 120], pos: [10, 20] });
  child.parent = parent;
  ok(w.call("align_layers", { layer_ids: [child.id], align: "right", margin: 20 }));
  near(bounds(w, child).right, 620);
});

t("align top to the selection and distribute horizontally", () => {
  const w = makeWorld();
  const a = w.make(null, { rect: [-20, -20, 40, 40], pos: [90, 300] }), b = w.make(null, { rect: [-30, -15, 60, 30], pos: [200, 270] }), c = w.make(null, { rect: [-25, -25, 50, 50], pos: [560, 310] });
  ok(w.call("align_layers", { layer_ids: [a.id, b.id, c.id], align: "top", to: "selection", distribute: "horizontal" }));
  const [ba, bb, bc] = [a, b, c].map((l) => bounds(w, l));
  near(ba.top, 255); near(bb.top, 255); near(bc.top, 255);
  near(bb.center[0], (ba.center[0] + bc.center[0]) / 2, "middle center evenly spaced");
  fails(w.call("align_layers", { layer_ids: [a.id, b.id], distribute: "horizontal" }), "BAD_ARGS");
  fails(w.call("align_layers", { layer_ids: [a.id], align: "middle" }), "BAD_ARGS");
});

t("align keeps an animated layer's motion (every key moves) and handles separated position", () => {
  const w = makeWorld();
  const l = w.make(null, { rect: [-15, -15, 30, 30], pos: [300, 40] });
  w.tp(l, "ADBE Position").keys = [{ t: 0, v: inner([300, 40, 0]) }, { t: 1, v: inner([400, 60, 0]) }];
  ok(w.call("align_layers", { layer_ids: [l.id], align: "left", margin: 10 }));
  assert.deepEqual(plain(w.tp(l, "ADBE Position").keys.map((k) => k.v.slice(0, 2))), [[25, 40], [125, 60]]);
  const s = w.make(null, { rect: [0, 0, 20, 20], pos: [50, 50] });
  w.tp(s, "ADBE Position").dimensionsSeparated = true;
  ok(w.call("align_layers", { layer_ids: [s.id], align: "top" }));
  assert.equal(w.tp(s, "ADBE Position_1").value, 0, "y moved on the separated Y property");
  assert.equal(w.tp(s, "ADBE Position_0").value, 50, "x untouched");
});

t("3D layers, cameras and locked layers are refused; a position expression is refused", () => {
  const w = makeWorld();
  const d3 = w.make(null); d3.threeDLayer = true;
  fails(w.call("align_layers", { layer_ids: [d3.id], align: "center" }), "UNSUPPORTED");
  const cam = w.make(w.CameraLayer);
  fails(w.call("align_layers", { layer_ids: [cam.id], align: "center" }), "UNSUPPORTED");
  const locked = w.make(null); locked.locked = true;
  fails(w.call("align_layers", { layer_ids: [locked.id], align: "center" }), "BAD_ARGS");
  const ex = w.make(null); w.tp(ex, "ADBE Position").expression = "wiggle(2,5)";
  fails(w.call("align_layers", { layer_ids: [ex.id], align: "center" }), "BAD_ARGS");
});

t("set_anchor moves the anchor to the content center without moving the layer", () => {
  const w = makeWorld();
  const l = w.make(w.TextLayer, { rect: [10, -90, 280, 94], pos: [100, 200], scale: [50, 50], rot: 45 });
  const before = bounds(w, l);
  const r = ok(w.call("set_anchor", { layer_id: l.id }));
  assert.deepEqual(plain(r.anchor.slice(0, 2)), [150, -43]);
  const after = bounds(w, l);
  near(after.center[0], before.center[0]); near(after.center[1], before.center[1]);
  ok(w.call("set_anchor", { layer_id: l.id, anchor: "bottom_left", keep_position: false }));
  assert.deepEqual(plain(w.tp(l, "ADBE Anchor Point").value.slice(0, 2)), [10, 4]);
  w.tp(l, "ADBE Anchor Point").keys = [{ t: 0, v: inner([0, 0, 0]) }];
  fails(w.call("set_anchor", { layer_id: l.id }), "BAD_ARGS");
});

t("set_layer switches and solid color / size", () => {
  const w = makeWorld();
  const s = w.make(null, { solid: true });
  ok(w.call("set_layer", { layer_id: s.id, guide: true, adjustment: true, effects: false, audio: false, preserve_transparency: true, solid_color: [0.1, 0.2, 0.3], solid_size: [700, 400] }));
  assert.deepEqual([s.guideLayer, s.adjustmentLayer, s.effectsActive, s.audioEnabled, s.preserveTransparency], [true, true, false, false, true]);
  assert.deepEqual(plain(s.source.mainSource.color), [0.1, 0.2, 0.3]);
  assert.deepEqual([s.source.width, s.source.height], [700, 400]);
  const shape = w.make(w.ShapeLayer);
  fails(w.call("set_layer", { layer_id: shape.id, solid_color: [1, 1, 1] }), "BAD_ARGS");
});

t("precompose leave-attributes is refused for several layers and for layers without a source", () => {
  const w = makeWorld();
  const a = w.make(w.ShapeLayer), b = w.make(null, { solid: true });
  assert.match(fails(w.call("precompose", { layer_ids: [a.id], name: "x", move_attributes: false }), "BAD_ARGS").message, /source/);
  assert.match(fails(w.call("precompose", { layer_ids: [a.id, b.id], name: "x", move_attributes: false }), "BAD_ARGS").message, /single layer/);
});

t("add_layer_style checks parameter names before turning the style on", () => {
  const w = makeWorld();
  const l = w.make(w.TextLayer);
  let enabled = false;
  const params = { "dropShadow/distance": { value: 5, setValue(v) { this.value = v; }, propertyValueType: undefined }, "dropShadow/blur": { value: 0, setValue(v) { this.value = v; } } };
  const group = { get enabled() { return enabled; }, set enabled(v) { enabled = v; }, numProperties: 2, property: (n) => (typeof n === "number" ? { matchName: Object.keys(params)[n - 1] } : params[n] || null) };
  l.property = ((orig) => (n) => (n === "ADBE Layer Styles" ? { enabled: true, property: () => group } : orig(n)))(l.property);
  const e = fails(w.call("add_layer_style", { layer_id: l.id, style: "drop_shadow", params: { size: 3 } }), "BAD_ARGS");
  assert.match(e.message, /size/); assert.match(e.hint, /distance, blur/);
  assert.equal(enabled, false, "style untouched after a bad name");
});

t("add_shape and add_layer reject bad stroke options before creating anything", () => {
  const w = makeWorld();
  const l = w.make(w.ShapeLayer);
  let added = 0;
  l.property = ((orig) => (n) => (n === "ADBE Root Vectors Group" ? { numProperties: 0, addProperty() { added++; throw new Error("should not be reached"); } } : orig(n)))(l.property);
  fails(w.call("add_shape", { layer_id: l.id, shape: { type: "rect", dashes: [4, 2] } }), "BAD_ARGS"); // dashes without a stroke
  fails(w.call("add_shape", { layer_id: l.id, shape: { type: "rect", stroke: [1, 1, 1], line_cap: "pointy" } }), "BAD_ARGS");
  assert.equal(added, 0);
});

for (const [name, pass, msg] of results) console.log((pass ? "PASS" : "FAIL") + "  " + name + (pass ? "" : "\n      " + msg));
console.log(`\n${results.filter((r) => r[1]).length}/${results.length} passed`);
process.exit(results.every((r) => r[1]) ? 0 : 1);
