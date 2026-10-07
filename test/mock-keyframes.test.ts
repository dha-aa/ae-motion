// @ts-nocheck -- the fake After Effects DOM here is deliberately loose (untyped fakes patched per test); these tests are checked by running them.
// Logic tests for the keyframe editor in panel/host/host.jsx (edit_keyframes, copy_animation, stagger, separate
// dimensions, auto-orient) against a fake After Effects DOM. The fake property models two After Effects behaviors
// found in live testing: setting a temporal ease switches a key to bezier, and roving keys re-time themselves
// whenever other keys change. See "Tests" in docs/development.md.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import assert from "node:assert/strict";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC = fs.readFileSync(path.join(ROOT, "panel", "host", "host.jsx"), "utf8");
const PVT = { OneD: 1, TwoD: 2, ThreeD: 3, COLOR: 4, TwoD_SPATIAL: 5, ThreeD_SPATIAL: 6, SHAPE: 7, TEXT_DOCUMENT: 8, NO_VALUE: 9, MARKER: 10, LAYER_INDEX: 11, MASK_INDEX: 12, CUSTOM_VALUE: 13 };
const KIT = { LINEAR: 6612, BEZIER: 6613, HOLD: 6614 };
const near = (a, b, m = "") => assert.ok(Math.abs(a - b) < 1e-6, `${m} expected ${b}, got ${a}`);

class Prop {
  constructor(value, { spatial = false, type = spatial ? PVT.ThreeD_SPATIAL : PVT.OneD, matchName = "X" } = {}) {
    this._v = value; this.keys = []; this.isSpatial = spatial; this.propertyValueType = type; this.matchName = matchName;
    this.propertyType = 1; this.canVaryOverTime = true; this.canSetExpression = true; this.expression = ""; this.expressionError = "";
  }
  get expressionEnabled() { return this.expression !== ""; }
  get value() { return this.keys.length ? this.keys[0].v : this._v; }
  get numKeys() { return this.keys.length; }
  setValue(v) { assert.equal(this.keys.length, 0, "setValue on an animated property"); this._v = v; }
  newKey(t, v) {
    const z = this.isSpatial ? [0, 0, 0] : null;
    return { t, v, ii: KIT.LINEAR, oi: KIT.LINEAR, ie: [{ speed: 0, influence: 16.67 }], oe: [{ speed: 0, influence: 16.67 }], tc: false, ta: false, si: z, so: z, sc: false, sa: false, rov: false };
  }
  setValueAtTime(t, v) {
    const k = this.keys.find((x) => Math.abs(x.t - t) < 1e-9);
    if (k) k.v = v; else { this.keys.push(this.newKey(t, v)); this.keys.sort((a, b) => a.t - b.t); }
    this.rove();
  }
  removeKey(i) { this.keys.splice(i - 1, 1); this.rove(); }
  // After Effects re-times roving keys between their neighbours whenever keys change
  rove() { for (let i = 1; i < this.keys.length - 1; i++) if (this.keys[i].rov) this.keys[i].t = (this.keys[i - 1].t + this.keys[i + 1].t) / 2; }
  valueAtTime(t) { const k = this.keys.find((x) => Math.abs(x.t - t) < 1e-9); return k ? k.v : this.value; }
  keyTime(i) { return this.keys[i - 1].t; }
  keyValue(i) { return this.keys[i - 1].v; }
  nearestKeyIndex(t) { let b = 1, d = Infinity; this.keys.forEach((k, i) => { if (Math.abs(k.t - t) < d) { d = Math.abs(k.t - t); b = i + 1; } }); return b; }
  key(i) { assert.ok(i >= 1 && i <= this.keys.length, `key ${i} out of range`); return this.keys[i - 1]; }
  setInterpolationTypeAtKey(i, a, b) { Object.assign(this.key(i), { ii: a, oi: b }); }
  keyInInterpolationType(i) { return this.key(i).ii; }
  keyOutInterpolationType(i) { return this.key(i).oi; }
  // After Effects switches a key to bezier when its temporal ease is set
  setTemporalEaseAtKey(i, a, b) { Object.assign(this.key(i), { ie: a, oe: b, ii: KIT.BEZIER, oi: KIT.BEZIER }); }
  keyInTemporalEase(i) { return this.key(i).ie; }
  keyOutTemporalEase(i) { return this.key(i).oe; }
  setTemporalContinuousAtKey(i, v) { this.key(i).tc = v; }
  keyTemporalContinuous(i) { return this.key(i).tc; }
  setTemporalAutoBezierAtKey(i, v) { this.key(i).ta = v; }
  keyTemporalAutoBezier(i) { return this.key(i).ta; }
  spatial() { if (!this.isSpatial) throw new Error("not spatial"); }
  setSpatialTangentsAtKey(i, a, b) { this.spatial(); Object.assign(this.key(i), { si: a, so: b, sa: false }); }
  keyInSpatialTangent(i) { this.spatial(); return this.key(i).si; }
  keyOutSpatialTangent(i) { this.spatial(); return this.key(i).so; }
  setSpatialContinuousAtKey(i, v) { this.spatial(); this.key(i).sc = v; }
  keySpatialContinuous(i) { this.spatial(); return this.key(i).sc; }
  setSpatialAutoBezierAtKey(i, v) { this.spatial(); this.key(i).sa = v; }
  keySpatialAutoBezier(i) { this.spatial(); return this.key(i).sa; }
  setRovingAtKey(i, v) { this.spatial(); if (v && (i === 1 || i === this.keys.length)) throw new Error("cannot rove"); this.key(i).rov = v; this.rove(); }
  keyRoving(i) { this.spatial(); return this.key(i).rov; }
}

function makeWorld() {
  let nextId = 10;
  const comp = { id: 1, frameDuration: 1 / 30, width: 640, height: 360 };
  const layers = new Map();
  class Group { constructor(props) { this.props = props; } property(n) { return this.props[n]; } }
  class Position extends Prop {
    constructor(layer) { super([0, 0, 0], { spatial: true, matchName: "ADBE Position" }); this.layer = layer; this._sep = false; }
    get dimensionsSeparated() { return this._sep; }
    set dimensionsSeparated(v) { this._sep = v; }
  }
  const layer = (name) => {
    const l = { id: nextId++, name, index: layers.size + 1, containingComp: comp, locked: false, enabled: true, inPoint: 0, outPoint: 5, startTime: 0, autoOrient: 0, shy: false, solo: false, label: 0 };
    const pos = new Position(l);
    const tg = new Group({
      "ADBE Position": pos, "ADBE Position_0": new Prop(0, { matchName: "ADBE Position_0" }), "ADBE Position_1": new Prop(0, { matchName: "ADBE Position_1" }),
      "ADBE Position_2": new Prop(0, { matchName: "ADBE Position_2" }), "ADBE Opacity": new Prop(100, { matchName: "ADBE Opacity" }),
      "ADBE Scale": new Prop([100, 100, 100], { type: PVT.ThreeD, matchName: "ADBE Scale" }),
    });
    l.property = (n) => (n === "ADBE Transform Group" ? tg : null);
    layers.set(l.id, l);
    return l;
  };
  class Stub {}
  const AutoOrientType = { NO_AUTO_ORIENT: 4212, ALONG_PATH: 4213, CAMERA_OR_POINT_OF_INTEREST: 4214 };
  const app = { project: { itemByID: () => null, layerByID: (id) => layers.get(id) || null }, beginUndoGroup() {}, endUndoGroup() {} };
  const ctx = {
    app, PropertyValueType: PVT, PropertyType: { PROPERTY: 1, INDEXED_GROUP: 2, NAMED_GROUP: 3 }, KeyframeInterpolationType: KIT,
    KeyframeEase: class { constructor(s, i) { this.speed = s; this.influence = i; } }, AutoOrientType, BlendingMode: {},
    CompItem: Stub, TextLayer: Stub, ShapeLayer: Stub, CameraLayer: Stub, LightLayer: Stub, SolidSource: Stub, FolderItem: Stub, FootageItem: Stub,
  };
  vm.createContext(ctx);
  vm.runInContext(SRC, ctx);
  const call = (cmd, args = {}) => JSON.parse(ctx.AEM.dispatch(JSON.stringify({ cmd, args })));
  const pos = (l) => l.property("ADBE Transform Group").property("ADBE Position");
  return { call, layer, pos, AutoOrientType };
}

const results = [];
const t = (name, fn) => { try { fn(); results.push([name, true]); } catch (e) { results.push([name, false, e.message]); } };
const ok = (r) => { assert.equal(r.ok, true, JSON.stringify(r.error)); return r.result; };
const fails = (r, code) => { assert.equal(r.ok, false, "should fail"); if (code) assert.equal(r.error.code, code, JSON.stringify(r.error)); return r.error; };
const threeKeys = (w, l) => ok(w.call("set_keyframes", { layer_id: l.id, path: "position", keys: [{ t: 0, v: [0, 0, 0] }, { t: 1, v: [100, 0, 0] }, { t: 2, v: [200, 0, 0] }] }));

t("set creates a key with the current value, updates values, and sets motion-path tangents", () => {
  const w = makeWorld(), l = w.layer("A");
  threeKeys(w, l);
  const r = ok(w.call("edit_keyframes", { layer_id: l.id, path: "position", edits: [
    { action: "set", t: 0.5 },
    { action: "set", t: 1, v: [100, -80], spatial_in: [-60, 0], spatial_out: [60, 0] },
  ] }));
  assert.equal(r.num_keys, 4);
  assert.deepEqual(r.edits.map((e) => e.index), [2, 3], "indices are the keys' final ones");
  assert.equal(r.keys.length, 2, "only the edited keys are returned");
  assert.deepEqual(r.keys[1].v.slice(0, 2), [100, -80], "value updated (After Effects itself pads [x,y] on a 3D position)");
  assert.deepEqual(r.keys[1].spatial_in, [-60, 0, 0], "tangent padded to the property's dimensions");
  assert.deepEqual(r.keys[1].spatial_out, [60, 0, 0]);
  assert.equal(r.keys[1].auto_bezier, undefined, "false flags are left out");
  assert.equal(r.keys[0].spatial_in, undefined, "zero tangents are left out");
});

t("a key within half a frame of t is matched; farther away it is not", () => {
  const w = makeWorld(), l = w.layer("A");
  threeKeys(w, l);
  ok(w.call("edit_keyframes", { layer_id: l.id, path: "position", edits: [{ action: "delete", t: 1 + 0.4 / 30 }] }));
  assert.equal(w.pos(l).numKeys, 2);
  fails(w.call("edit_keyframes", { layer_id: l.id, path: "position", edits: [{ action: "delete", t: 1.5 }] }), "NOT_FOUND");
  fails(w.call("edit_keyframes", { layer_id: l.id, path: "position", edits: [{ action: "delete", index: 9 }] }), "NOT_FOUND");
});

t("move keeps every setting (a linear key stays linear) and refuses to land on another key", () => {
  const w = makeWorld(), l = w.layer("A");
  threeKeys(w, l);
  ok(w.call("edit_keyframes", { layer_id: l.id, path: "position", edits: [{ action: "set", t: 2, spatial_in: [-10, 5] }] }));
  const r = ok(w.call("edit_keyframes", { layer_id: l.id, path: "position", edits: [{ action: "move", t: 2, to: 2.5 }] }));
  const k = r.keys[0];
  near(k.t, 2.5);
  assert.equal(k.interp_in, "linear", "restoring the ease must not turn the key bezier");
  assert.deepEqual(k.spatial_in, [-10, 5, 0]);
  fails(w.call("edit_keyframes", { layer_id: l.id, path: "position", edits: [{ action: "move", t: 0, to: 1 }] }), "EXISTS");
});

t("easing via set switches only that key to bezier", () => {
  const w = makeWorld(), l = w.layer("A");
  threeKeys(w, l);
  const r = ok(w.call("edit_keyframes", { layer_id: l.id, path: "position", edits: [{ action: "set", index: 1, ease_out: "easy" }] }));
  assert.deepEqual(r.keys.map((k) => k.interp_out), ["bezier"]);
  const all = ok(w.call("get_keyframes", { layer_id: l.id, path: "position" }));
  assert.deepEqual(all.keys.map((k) => k.interp_out), ["bezier", "linear", "linear"]);
});

t("roving: refused on the first and last key, allowed between", () => {
  const w = makeWorld(), l = w.layer("A");
  threeKeys(w, l);
  fails(w.call("edit_keyframes", { layer_id: l.id, path: "position", edits: [{ action: "set", index: 1, roving: true }] }), "BAD_ARGS");
  const r = ok(w.call("edit_keyframes", { layer_id: l.id, path: "position", edits: [{ action: "set", index: 2, roving: true }] }));
  assert.equal(r.keys[0].roving, true);
});

t("spatial fields on a non-spatial property are refused", () => {
  const w = makeWorld(), l = w.layer("A");
  ok(w.call("set_keyframes", { layer_id: l.id, path: "opacity", keys: [{ t: 0, v: 0 }, { t: 1, v: 100 }] }));
  const e = fails(w.call("edit_keyframes", { layer_id: l.id, path: "opacity", edits: [{ action: "set", t: 0, spatial_out: [1, 1] }] }), "BAD_ARGS");
  assert.match(e.message, /spatial/);
});

t("copy_animation copies keys with tangents and roving, staggered per target, plus the expression", () => {
  const w = makeWorld(), a = w.layer("A"), b = w.layer("B"), c = w.layer("C");
  threeKeys(w, a);
  ok(w.call("edit_keyframes", { layer_id: a.id, path: "position", edits: [{ action: "set", index: 2, spatial_out: [30, 0], roving: true }, { action: "set", index: 1, ease_out: "easy" }] }));
  w.pos(a).expression = "value";
  const r = ok(w.call("copy_animation", { from_layer_id: a.id, path: "position", to_layer_ids: [b.id, c.id], offset_seconds: 0.5, stagger_seconds: 0.25 }));
  assert.deepEqual(r.copied.map((x) => x.offset), [0.5, 0.75]);
  const ck = ok(w.call("get_keyframes", { layer_id: c.id, path: "position" }));
  assert.deepEqual(ck.keys.map((k) => +k.t.toFixed(3)), [0.75, 1.75, 2.75]);
  assert.deepEqual(ck.keys[1].spatial_out, [30, 0, 0]);
  assert.equal(ck.keys[1].roving, true);
  assert.deepEqual(ck.keys.map((k) => k.interp_out), ["bezier", "linear", "linear"]);
  assert.equal(ck.expression, "value");
});

t("copy_animation checks every target before changing any", () => {
  const w = makeWorld(), a = w.layer("A"), b = w.layer("B"), c = w.layer("C");
  threeKeys(w, a);
  c.locked = true;
  fails(w.call("copy_animation", { from_layer_id: a.id, path: "position", to_layer_ids: [b.id, c.id] }), "BAD_ARGS");
  assert.equal(w.pos(b).numKeys, 0, "first target untouched");
  fails(w.call("copy_animation", { from_layer_id: a.id, path: "position", to_layer_ids: [b.id], to_path: "opacity" }), "BAD_ARGS");
});

t("stagger keeps a roving key and does not duplicate keys", () => {
  const w = makeWorld(), a = w.layer("A"), b = w.layer("B");
  for (const l of [a, b]) {
    threeKeys(w, l);
    ok(w.call("edit_keyframes", { layer_id: l.id, path: "position", edits: [{ action: "set", index: 2, spatial_out: [40, 0], roving: true }] }));
  }
  ok(w.call("stagger", { layer_ids: [a.id, b.id], path: "position", offset_seconds: 0.3 }));
  const k = ok(w.call("get_keyframes", { layer_id: b.id, path: "position" })).keys;
  assert.equal(k.length, 3, "no leftover key from the roving re-time");
  assert.deepEqual(k.map((x) => +x.t.toFixed(3)), [0.3, 1.3, 2.3]);
  assert.equal(k[1].roving, true);
  assert.deepEqual(k[1].spatial_out, [40, 0, 0]);
});

t("separate_dimensions exposes x_position / y_position; auto_orient path and off", () => {
  const w = makeWorld(), l = w.layer("A");
  ok(w.call("set_layer", { layer_id: l.id, separate_dimensions: true, auto_orient: "path" }));
  assert.equal(w.pos(l).dimensionsSeparated, true);
  assert.equal(l.autoOrient, w.AutoOrientType.ALONG_PATH);
  ok(w.call("set_keyframes", { layer_id: l.id, path: "y_position", keys: [{ t: 0, v: 10 }, { t: 1, v: 300 }] }));
  assert.equal(l.property("ADBE Transform Group").property("ADBE Position_1").numKeys, 2);
  ok(w.call("set_layer", { layer_id: l.id, auto_orient: "off" }));
  assert.equal(l.autoOrient, w.AutoOrientType.NO_AUTO_ORIENT);
});

for (const [name, pass, msg] of results) console.log((pass ? "PASS" : "FAIL") + "  " + name + (pass ? "" : "\n      " + msg));
console.log(`\n${results.filter((r) => r[1]).length}/${results.length} passed`);
process.exit(results.every((r) => r[1]) ? 0 : 1);
