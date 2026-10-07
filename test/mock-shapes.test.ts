// @ts-nocheck -- the fake After Effects DOM here is deliberately loose (untyped fakes patched per test); these tests are checked by running them.
// Logic tests for path (shape) values and comp motion blur in panel/host/host.jsx, against a minimal fake After Effects DOM:
// mask and path keyframes from shape specs, the ellipse vertex order (rect <-> ellipse morphs without twisting),
// round-tripping through get_keyframes, and set_comp's motion blur settings. See "Tests" in docs/development.md.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import assert from "node:assert/strict";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC = fs.readFileSync(path.join(ROOT, "panel", "host", "host.jsx"), "utf8");
const near = (a, b, m = "") => assert.ok(Math.abs(a - b) < 1e-6, `${m} expected ${b}, got ${a}`);

const PVT = { OneD: 1, TwoD: 2, ThreeD: 3, COLOR: 4, TwoD_SPATIAL: 5, ThreeD_SPATIAL: 6, SHAPE: 7, TEXT_DOCUMENT: 8, NO_VALUE: 9, MARKER: 10, LAYER_INDEX: 11, MASK_INDEX: 12, CUSTOM_VALUE: 13 };

function makeWorld() {
  class Shape { constructor() { this.vertices = []; this.inTangents = []; this.outTangents = []; this.closed = true; } }
  class PathProp {
    constructor(owner, depth) { this.owner = owner; this.propertyDepth = depth; this.keys = []; this._v = new Shape(); }
    get propertyValueType() { return PVT.SHAPE; }
    get propertyType() { return 1; }
    get canVaryOverTime() { return true; }
    get expressionEnabled() { return false; }
    get canSetExpression() { return true; }
    get isSpatial() { return false; }
    get value() { return this._v; }
    get numKeys() { return this.keys.length; }
    propertyGroup(n) { assert.equal(n, this.propertyDepth, "propertyGroup(propertyDepth) must reach the layer"); return this.owner; }
    setValue(v) { assert.ok(v instanceof Shape, "setValue needs a Shape"); this._v = v; }
    setValueAtTime(t, v) { assert.ok(v instanceof Shape, "keys need a Shape"); this.keys.push({ t, v }); this.keys.sort((a, b) => a.t - b.t); }
    valueAtTime() { return this._v; }
    keyTime(i) { return this.keys[i - 1].t; }
    keyValue(i) { return this.keys[i - 1].v; }
    removeKey(i) { this.keys.splice(i - 1, 1); }
    nearestKeyIndex(t) { let b = 1, d = Infinity; this.keys.forEach((k, i) => { if (Math.abs(k.t - t) < d) { d = Math.abs(k.t - t); b = i + 1; } }); return b; }
    setInterpolationTypeAtKey() {}
    keyInInterpolationType() { return 6613; }
    keyOutInterpolationType() { return 6613; }
    keyInTemporalEase() { return [{ speed: 0, influence: 16.7 }]; }
    keyOutTemporalEase() { return [{ speed: 0, influence: 16.7 }]; }
    setTemporalEaseAtKey() {}
  }
  class Plain { constructor(v) { this.value = v; } setValue(v) { this.value = v; } }
  class Mask {
    constructor(layer, index) {
      this.propertyIndex = index; this.name = "Mask " + index; this.maskMode = 0; this.inverted = false;
      this.props = { "ADBE Mask Shape": new PathProp(layer, 3), "ADBE Mask Feather": new Plain([0, 0]), "ADBE Mask Opacity": new Plain(100), "ADBE Mask Offset": new Plain(0) };
    }
    property(n) { return this.props[n]; }
  }
  class MaskParade {
    constructor(layer) { this.layer = layer; this.masks = []; }
    addProperty(mn) { assert.equal(mn, "ADBE Mask Atom"); const m = new Mask(this.layer, this.masks.length + 1); this.masks.push(m); return m; }
    property(i) { return this.masks[i - 1]; }
  }
  class CompItem {
    constructor() {
      this.id = 1; this.name = "C"; this.width = 640; this.height = 360; this.frameRate = 30; this.duration = 2; this.pixelAspect = 1;
      this.bgColor = [0, 0, 0]; this.workAreaStart = 0; this.workAreaDuration = 2; this.time = 0; this.numLayers = 1;
      this.markerProperty = { numKeys: 0 }; this.motionBlur = false; this.shutterAngle = 180; this.shutterPhase = -90;
    }
  }
  const comp = new CompItem();
  const layer = { id: 10, index: 1, name: "Solid", width: 400, height: 200, containingComp: comp, inPoint: 0, outPoint: 2, startTime: 0, enabled: true, locked: false, shy: false, solo: false, label: 1 };
  layer.parade = new MaskParade(layer);
  layer.property = (n) => (n === "ADBE Mask Parade" ? layer.parade : null);
  comp.layer = () => layer;
  class Stub {}
  const app = {
    project: { itemByID: (id) => (id === 1 ? comp : null), layerByID: (id) => (id === 10 ? layer : null) },
    beginUndoGroup() {}, endUndoGroup() {},
  };
  const ctx = {
    app, CompItem, Shape, PropertyValueType: PVT, PropertyType: { PROPERTY: 1, INDEXED_GROUP: 2, NAMED_GROUP: 3 },
    KeyframeInterpolationType: { LINEAR: 6612, BEZIER: 6613, HOLD: 6614 }, KeyframeEase: class { constructor(s, i) { this.speed = s; this.influence = i; } },
    MaskMode: { NONE: 0, ADD: 1 }, TrackMatteType: {}, TextLayer: Stub, ShapeLayer: Stub, CameraLayer: Stub, LightLayer: Stub, SolidSource: Stub,
    FolderItem: Stub, FootageItem: Stub,
  };
  vm.createContext(ctx);
  vm.runInContext(SRC, ctx);
  const call = (cmd, args = {}) => JSON.parse(ctx.AEM.dispatch(JSON.stringify({ cmd, args })));
  return { call, comp, layer };
}

const results = [];
const t = (name, fn) => { try { fn(); results.push([name, true]); } catch (e) { results.push([name, false, e.message]); } };
const ok = (r) => { assert.equal(r.ok, true, JSON.stringify(r.error)); return r.result; };
const SHAPE_PATH = ["ADBE Mask Parade", 1, "ADBE Mask Shape"];

t("ellipse vertices sit on the diagonals, in the same clockwise order as a rect's corners", () => {
  const w = makeWorld();
  ok(w.call("add_mask", { layer_id: 10, shape: { type: "rect", position: [100, 50], size: [80, 40] } }));
  ok(w.call("add_mask", { layer_id: 10, shape: { type: "ellipse", position: [100, 50], size: [80, 40] } }));
  const rect = w.layer.parade.property(1).property("ADBE Mask Shape").value;
  const ell = w.layer.parade.property(2).property("ADBE Mask Shape").value;
  assert.equal(ell.vertices.length, 4);
  for (let i = 0; i < 4; i++) {
    const [x, y] = ell.vertices[i];
    near(((x - 100) / 40) ** 2 + ((y - 50) / 20) ** 2, 1, `vertex ${i} on the ellipse`);
    // same quadrant as the matching rect corner (top-left, top-right, bottom-right, bottom-left)
    assert.equal(Math.sign(x - 100), Math.sign(rect.vertices[i][0] - 100), `vertex ${i} x side`);
    assert.equal(Math.sign(y - 50), Math.sign(rect.vertices[i][1] - 50), `vertex ${i} y side`);
    // tangents are tangent to the ellipse: perpendicular to the scaled radius
    const [tx, ty] = ell.outTangents[i];
    near(((x - 100) / 40 ** 2) * tx + ((y - 50) / 20 ** 2) * ty, 0, `tangent ${i}`);
    near(ell.inTangents[i][0], -tx, `in tangent ${i} mirrors out`);
  }
});

t("set_keyframes on a mask shape takes shape specs and get_keyframes returns them as paths", () => {
  const w = makeWorld();
  ok(w.call("add_mask", { layer_id: 10, shape: { type: "rect" } }));
  const r = ok(w.call("set_keyframes", { layer_id: 10, path: SHAPE_PATH, keys: [
    { t: 0, v: { type: "rect", position: [200, 100], size: [100, 100] } },
    { t: 1, v: { type: "ellipse", size: [300, 150] }, ease_in: "easy" },
    { t: 2, v: { type: "path", vertices: [[0, 0], [50, 0], [25, 40]], closed: true } },
  ] }));
  assert.equal(r.num_keys, 3);
  const k = ok(w.call("get_keyframes", { layer_id: 10, path: SHAPE_PATH })).keys;
  assert.equal(k[0].v.type, "path");
  assert.deepEqual(k[0].v.vertices, [[150, 50], [250, 50], [250, 150], [150, 150]]);
  near(k[1].v.vertices[0][0], 200 - 150 * Math.SQRT1_2, "ellipse defaults to the layer center"); // layer is 400 x 200
  assert.deepEqual(k[2].v.vertices, [[0, 0], [50, 0], [25, 40]]);
  assert.deepEqual(k[2].v.in_tangents, [[0, 0], [0, 0], [0, 0]]);
});

t("a get_keyframes path value can be written back unchanged", () => {
  const w = makeWorld();
  ok(w.call("add_mask", { layer_id: 10, shape: { type: "ellipse" } }));
  ok(w.call("set_keyframes", { layer_id: 10, path: SHAPE_PATH, keys: [{ t: 0, v: { type: "ellipse", size: [10, 20] } }] }));
  const v = ok(w.call("get_keyframes", { layer_id: 10, path: SHAPE_PATH })).keys[0].v;
  ok(w.call("set_keyframes", { layer_id: 10, path: SHAPE_PATH, keys: [{ t: 0, v }] }));
  assert.deepEqual(ok(w.call("get_keyframes", { layer_id: 10, path: SHAPE_PATH })).keys[0].v, v);
});

t("a path property refuses a non-shape value with a format hint", () => {
  const w = makeWorld();
  ok(w.call("add_mask", { layer_id: 10, shape: { type: "rect" } }));
  const r = w.call("set_property", { layer_id: 10, path: SHAPE_PATH, value: [1, 2] });
  assert.equal(r.ok, false);
  assert.equal(r.error.code, "BAD_ARGS");
  assert.match(r.error.message, /takes a shape/);
  const bad = w.call("set_property", { layer_id: 10, path: SHAPE_PATH, value: { type: "star" } });
  assert.equal(bad.ok, false);
});

t("set_comp sets and reports motion blur, shutter angle and phase", () => {
  const w = makeWorld();
  const r = ok(w.call("set_comp", { comp_id: 1, motion_blur: true, shutter_angle: 360, shutter_phase: 0 }));
  assert.equal(w.comp.motionBlur, true);
  assert.equal(w.comp.shutterAngle, 360);
  assert.equal(w.comp.shutterPhase, 0);
  assert.deepEqual([r.motion_blur, r.shutter_angle, r.shutter_phase], [true, 360, 0]);
});

for (const [name, pass, msg] of results) console.log((pass ? "PASS" : "FAIL") + "  " + name + (pass ? "" : "\n      " + msg));
console.log(`\n${results.filter((r) => r[1]).length}/${results.length} passed`);
process.exit(results.every((r) => r[1]) ? 0 : 1);
