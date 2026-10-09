// @ts-nocheck -- the fake After Effects DOM here is deliberately loose (untyped fakes patched per test); these tests are checked by running them.
// Logic tests for the 3D camera, light and 3D layer commands in panel/host/host.jsx against a minimal fake After Effects DOM.
// They check the camera maths and the bookkeeping (keys, expressions, rigs). They cannot prove After Effects accepts the calls;
// see "Test status" in the README.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import assert from "node:assert/strict";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC = fs.readFileSync(path.join(ROOT, "panel", "host", "host.jsx"), "utf8");
const near = (a, b, m = "", tol = 1e-3) => assert.ok(Math.abs(a - b) < tol, `${m} expected ${b}, got ${a}`);
const nearV = (a, b, m = "", tol = 1e-3) => { for (let i = 0; i < 3; i++) near(a[i], b[i], `${m}[${i}]`, tol); };
const norm = (v) => { const l = Math.hypot(...v); return v.map((x) => x / l); };

class Prop {
  constructor(value, spatial = false) {
    this._v = value; this.keys = []; this._expr = ""; this.expressionError = ""; this.canSetExpression = true; this.canVaryOverTime = true;
    this.isSpatial = spatial; this.propertyType = 1;
  }
  get value() { return this._v; }
  setValue(v) { this._v = v; }
  get numKeys() { return this.keys.length; }
  get expression() { return this._expr; }
  set expression(v) { this._expr = v; }
  get expressionEnabled() { return this._expr !== ""; }
  setValueAtTime(t, v) {
    const k = this.keys.find((x) => Math.abs(x.t - t) < 1e-9);
    if (k) k.v = v; else { this.keys.push({ t, v, interp: ["bezier", "bezier"], ease: null }); this.keys.sort((a, b) => a.t - b.t); }
  }
  keyTime(i) { return this.keys[i - 1].t; }
  keyValue(i) { return this.keys[i - 1].v; }
  setValueAtKey(i, v) { this.keys[i - 1].v = v; }
  get dimensionsSeparated() { return false; }
  removeKey(i) { this.keys.splice(i - 1, 1); }
  nearestKeyIndex(t) { let best = 1, bd = Infinity; this.keys.forEach((k, i) => { const d = Math.abs(k.t - t); if (d < bd) { bd = d; best = i + 1; } }); return best; }
  valueAtTime(t) {
    if (!this.keys.length) return this._v;
    const ks = this.keys;
    if (t <= ks[0].t) return ks[0].v;
    if (t >= ks[ks.length - 1].t) return ks[ks.length - 1].v;
    for (let i = 0; i < ks.length - 1; i++) {
      if (t >= ks[i].t && t <= ks[i + 1].t) {
        const u = (t - ks[i].t) / (ks[i + 1].t - ks[i].t), a = ks[i].v, b = ks[i + 1].v;
        return Array.isArray(a) ? a.map((x, j) => x + (b[j] - x) * u) : a + (b - a) * u;
      }
    }
    return this._v;
  }
  setInterpolationTypeAtKey(i, a, b) { this.keys[i - 1].interp = [a, b]; }
  // new spatial keys are auto-bezier in After Effects (the path curves between them)
  setSpatialAutoBezierAtKey(i, b) { this.keys[i - 1].auto = b; }
  setSpatialContinuousAtKey(i, b) { this.keys[i - 1].cont = b; }
  setSpatialTangentsAtKey(i, a, b) { this.keys[i - 1].tan = [a, b]; }
  keyInInterpolationType(i) { return this.keys[i - 1].interp[0]; }
  keyOutInterpolationType(i) { return this.keys[i - 1].interp[1]; }
  setTemporalEaseAtKey(i, ine, oute) { this.keys[i - 1].ease = { in: ine, out: oute }; }
  keyInTemporalEase(i) { return this.keys[i - 1].ease ? this.keys[i - 1].ease.in : [{ speed: 0, influence: 16.67 }]; }
  keyOutTemporalEase(i) { return this.keys[i - 1].ease ? this.keys[i - 1].ease.out : [{ speed: 0, influence: 16.67 }]; }
}
class Group { constructor(props) { this.props = props; } property(n) { return this.props[n]; } }
const transformGroup = () => new Group({
  "ADBE Position": new Prop([0, 0, 0], true), "ADBE Anchor Point": new Prop([0, 0, 0], true), "ADBE Scale": new Prop([100, 100, 100]),
  "ADBE Orientation": new Prop([0, 0, 0], true), "ADBE Rotate X": new Prop(0), "ADBE Rotate Y": new Prop(0), "ADBE Rotate Z": new Prop(0),
});

function makeWorld() {
  let nextId = 100;
  const world = { items: [], executed: [], noMenu: false };
  const MENU = {}; ["Active Camera", "Active Camera (Cam)", "Default", "Front", "Left", "Top", "Back", "Right", "Bottom", "Custom View 1", "Custom View 2", "Custom View 3"].forEach((n, i) => { MENU[n] = 2000 + i; });
  class Item { constructor() { this.id = nextId++; this.name = "item"; this.usedIn = []; } }
  class CompItem extends Item {
    constructor(name) {
      super(); this.name = name; this.width = 1280; this.height = 720; this.frameRate = 30; this.frameDuration = 1 / 30; this.duration = 10; this._layers = [];
      const comp = this;
      this.layers = {
        addNull() { const l = new Layer(comp, "Null " + (comp._layers.length + 1)); l.nullLayer = true; comp._layers.unshift(l); return l; },
        addCamera(name, c) { const l = new CameraLayer(comp, name); l.groups["ADBE Transform Group"].property("ADBE Position").setValue([0, 0, -1777.78]); l.groups["ADBE Transform Group"].property("ADBE Anchor Point").setValue([c[0], c[1], 0]); comp._layers.unshift(l); return l; },
        addSolid() { const l = new Layer(comp, "Solid"); comp._layers.unshift(l); return l; },
      };
    }
    get numLayers() { return this._layers.length; }
    openInViewer() { app.project.activeItem = this; return {}; }
    get activeCamera() { return this._layers.find((l) => l instanceof CameraLayer) || null; }
    layer(i) {
      if (typeof i === "string") { const l = this._layers.find((x) => x.name === i); if (!l) throw new Error("layer not found: " + i); return l; }
      return this._layers[i - 1];
    }
  }
  class Layer {
    constructor(comp, name) {
      this.comp = comp; this.id = nextId++; this.name = name; this.inPoint = 0; this.outPoint = comp.duration; this.startTime = 0; this.locked = false; this.enabled = true;
      this.shy = false; this.solo = false; this.label = 0; this.parent = null; this.nullLayer = false; this.adjustmentLayer = false; this.source = null; this.stretch = 100;
      this.threeDLayer = false; this.groups = { "ADBE Transform Group": transformGroup() };
    }
    property(n) { return this.groups[n]; }
    get containingComp() { return this.comp; }
    get index() { return this.comp._layers.indexOf(this) + 1; }
    remove() { this.comp._layers.splice(this.index - 1, 1); }
    setParentWithJump(p) { this.parent = p; this.jumped = true; }
    moveBefore(o) { const arr = this.comp._layers; arr.splice(arr.indexOf(this), 1); arr.splice(arr.indexOf(o), 0, this); }
  }
  class CameraLayer extends Layer {
    constructor(comp, name) {
      super(comp, name); this.autoOrient = AutoOrientType.CAMERA_OR_POINT_OF_INTEREST;
      this.groups["ADBE Camera Options Group"] = new Group({
        "ADBE Camera Zoom": new Prop(1777.78), "ADBE Camera Depth of Field": new Prop(0), "ADBE Camera Focus Distance": new Prop(1777.78), "ADBE Camera Aperture": new Prop(25),
        "ADBE Camera Blur Level": new Prop(100), "ADBE Iris Shape": new Prop(1), "ADBE Iris Rotation": new Prop(0), "ADBE Iris Roundness": new Prop(0), "ADBE Iris Aspect Ratio": new Prop(1),
        "ADBE Iris Diffraction Fringe": new Prop(0), "ADBE Iris Highlight Gain": new Prop(0), "ADBE Iris Highlight Threshold": new Prop(1), "ADBE Iris Hightlight Saturation": new Prop(0),
      });
    }
  }
  class LightLayer extends Layer {
    constructor(comp, name) {
      super(comp, name); this.lightType = LightType.SPOT;
      this.groups["ADBE Light Options Group"] = new Group({
        "ADBE Light Intensity": new Prop(100), "ADBE Light Color": new Prop([1, 1, 1, 1]), "ADBE Light Cone Angle": new Prop(90), "ADBE Light Cone Feather 2": new Prop(50),
        "ADBE Light Falloff Type": new Prop(1), "ADBE Light Falloff Start": new Prop(500), "ADBE Light Falloff Distance": new Prop(500), "ADBE Casts Shadows": new Prop(0),
        "ADBE Light Shadow Darkness": new Prop(100), "ADBE Light Shadow Diffusion": new Prop(0),
      });
    }
  }
  class SolidLayer extends Layer {
    constructor(comp, name) {
      super(comp, name);
      this.groups["ADBE Material Options Group"] = new Group({
        "ADBE Casts Shadows": new Prop(0), "ADBE Accepts Shadows": new Prop(1), "ADBE Accepts Lights": new Prop(1), "ADBE Light Transmission": new Prop(0), "ADBE Ambient Coefficient": new Prop(100),
        "ADBE Diffuse Coefficient": new Prop(50), "ADBE Specular Coefficient": new Prop(50), "ADBE Shininess Coefficient": new Prop(5), "ADBE Metal Coefficient": new Prop(100),
      });
    }
  }
  class Stub {}
  class KeyframeEase { constructor(speed, influence) { this.speed = speed; this.influence = influence; } }
  const AutoOrientType = { CAMERA_OR_POINT_OF_INTEREST: 4212, NO_AUTO_ORIENT: 4213 };
  const LightType = { POINT: 1, SPOT: 2, PARALLEL: 3, AMBIENT: 4 };
  const app = {
    project: { get numItems() { return world.items.length; }, item(i) { return world.items[i - 1]; }, itemByID(id) { return world.items.find((x) => x.id === id) || null; },
      layerByID(id) { for (const c of world.items) for (let j = 1; j <= (c.numLayers || 0); j++) if (c.layer(j).id === id) return c.layer(j); return null; }, file: null, activeItem: null },
    beginUndoGroup() {}, endUndoGroup() {},
    findMenuCommandId(n) { return world.noMenu ? 0 : (MENU[n] || 0); }, executeCommand(id) { world.executed.push(id); },
  };
  const ctx = {
    app, CompItem, CameraLayer, LightLayer, TextLayer: Stub, ShapeLayer: Stub, FolderItem: Stub, FootageItem: Stub, SolidSource: Stub, KeyframeEase, AutoOrientType, LightType,
    KeyframeInterpolationType: { LINEAR: 6612, BEZIER: 6613, HOLD: 6614 }, PropertyType: { PROPERTY: 1, INDEXED_GROUP: 2, NAMED_GROUP: 3 },
    PropertyValueType: { OneD: 1, TwoD: 2, ThreeD: 3, COLOR: 4, TwoD_SPATIAL: 5, ThreeD_SPATIAL: 6, SHAPE: 7, TEXT_DOCUMENT: 8, NO_VALUE: 9, MARKER: 10, LAYER_INDEX: 11, MASK_INDEX: 12, CUSTOM_VALUE: 13 },
    console,
  };
  vm.createContext(ctx);
  vm.runInContext(SRC, ctx);
  const call = (cmd, args = {}) => JSON.parse(ctx.AEM.dispatch(JSON.stringify({ cmd, args })));
  const comp = () => { const c = new CompItem("Comp"); world.items.push(c); return c; };
  const camera = (c, pos = [0, 0, -1000], poi = [0, 0, 0], name = "Cam") => {
    const l = new CameraLayer(c, name); c._layers.unshift(l);
    l.groups["ADBE Transform Group"].property("ADBE Position").setValue(pos); l.groups["ADBE Transform Group"].property("ADBE Anchor Point").setValue(poi); return l;
  };
  const light = (c, name = "Light") => { const l = new LightLayer(c, name); c._layers.unshift(l); return l; };
  const solid = (c, name = "Solid") => { const l = new SolidLayer(c, name); c._layers.unshift(l); return l; };
  const prop = (l, g, n) => l.groups[g].property(n);
  const pos = (l) => prop(l, "ADBE Transform Group", "ADBE Position");
  const poi = (l) => prop(l, "ADBE Transform Group", "ADBE Anchor Point");
  const opt = (l, n) => prop(l, "ADBE Camera Options Group", n);
  return { call, comp, camera, light, solid, pos, poi, opt, prop, world, SolidLayer };
}

const results = [];
const t = (name, fn) => { try { fn(); results.push([name, true]); } catch (e) { results.push([name, false, e.message]); } };
const ok = (r, m = "") => assert.equal(r.ok, true, `${m} ${JSON.stringify(r.error)}`);
const fails = (r, code, m = "") => { assert.equal(r.ok, false, m + " should fail"); if (code) assert.equal(r.error.code, code, m + " " + JSON.stringify(r.error)); };
const lastKey = (p) => p.keys[p.keys.length - 1];

t("dolly moves along the view axis by distance or factor, keeping the target fixed", () => {
  const w = makeWorld(); const c = w.comp(); const cam = w.camera(c);
  const r = w.call("camera_move", { layer_id: cam.id, type: "dolly", distance: 400, duration: 2, easing: "linear" }); ok(r);
  assert.equal(w.pos(cam).keys.length, 2); nearV(lastKey(w.pos(cam)).v, [0, 0, -600]); assert.equal(w.poi(cam).keys.length, 0);
  assert.deepEqual(w.pos(cam).keys.map((k) => k.interp[0]), [6612, 6612], "linear easing sets linear interpolation");
  const w2 = makeWorld(); const c2 = w2.comp(); const cam2 = w2.camera(c2);
  ok(w2.call("camera_move", { layer_id: cam2.id, type: "dolly", factor: 0.5, duration: 1 })); nearV(lastKey(w2.pos(cam2)).v, [0, 0, -500]);
  fails(w2.call("camera_move", { layer_id: cam2.id, type: "dolly", distance: 5000, duration: 1 }), "BAD_ARGS");
  fails(w2.call("camera_move", { layer_id: cam2.id, type: "dolly", duration: 1 }), "BAD_ARGS");
});

t("combine layers a move over existing animation: dolly + truck over the same seconds add up, later keys keep the offset", () => {
  const w = makeWorld(); const c = w.comp(); const cam = w.camera(c);
  ok(w.call("camera_move", { layer_id: cam.id, type: "dolly", distance: 400, start: 0, duration: 2, easing: "linear" }));
  ok(w.call("camera_move", { layer_id: cam.id, type: "pedestal", distance: 50, start: 2, duration: 1, easing: "linear" })); // a later key to carry
  const r = w.call("camera_move", { layer_id: cam.id, type: "truck", distance: 300, start: 0, duration: 2, easing: "linear", combine: true }); ok(r);
  assert.equal(r.result.combined, true);
  const at = (t) => w.pos(cam).valueAtTime(t, true);
  nearV(at(0), [0, 0, -1000], "start unchanged");
  nearV(at(1), [150, 0, -800], "halfway: half the dolly and half the truck");
  nearV(at(2), [300, 0, -600], "end: both");
  nearV(at(3), [300, -50, -600], "the later pedestal key keeps the truck offset");
  nearV(r.result.final_position, [300, 0, -600]);
  // without combine the truck replaces the dolly inside its range (the old behaviour)
  const w2 = makeWorld(); const c2 = w2.comp(); const cam2 = w2.camera(c2);
  ok(w2.call("camera_move", { layer_id: cam2.id, type: "dolly", distance: 400, start: 0, duration: 2, easing: "linear" }));
  ok(w2.call("camera_move", { layer_id: cam2.id, type: "truck", distance: 300, start: 0, duration: 2, easing: "linear" }));
  nearV(w2.pos(cam2).valueAtTime(2, true), [300, 0, -1000], "replaced");
});

t("easing: ease_in_out eases both ends, ease_in only the start, ease_out only the end", () => {
  for (const [easing, firstEased, lastEased] of [["ease_in_out", true, true], ["ease_in", true, false], ["ease_out", false, true]]) {
    const w = makeWorld(); const c = w.comp(); const cam = w.camera(c);
    ok(w.call("camera_move", { layer_id: cam.id, type: "dolly", distance: 100, duration: 2, easing }));
    const ks = w.pos(cam).keys;
    assert.equal(!!ks[0].ease, firstEased, easing + " first key"); assert.equal(!!ks[1].ease, lastEased, easing + " last key");
    if (firstEased) assert.ok(ks[0].ease.out[0].influence > 33, "easy ease influence");
  }
});

t("orbit keeps the radius, follows the eased angle, and ends where asked", () => {
  const w = makeWorld(); const c = w.comp(); const cam = w.camera(c);
  const r = w.call("camera_move", { layer_id: cam.id, type: "orbit", degrees: 90, duration: 4, easing: "ease_in_out" }); ok(r);
  const ks = w.pos(cam).keys; assert.ok(ks.length >= 19, "sampled densely: " + ks.length);
  ks.forEach((k, i) => {
    near(Math.hypot(...k.v), 1000, "radius " + i, 1e-2);
    const ang = Math.atan2(k.v[0], -k.v[2]) * 180 / Math.PI, u = (k.t - 0) / 4;
    near(ang, 90 * (u * u * (3 - 2 * u)), "angle " + i, 1e-2);
  });
  nearV(lastKey(w.pos(cam)).v, [1000, 0, 0], "end", 1e-2);
  assert.ok(ks.every((k) => k.interp[0] === 6612), "sampled keys use linear timing");
  const w2 = makeWorld(); const c2 = w2.comp(); const cam2 = w2.camera(c2);
  ok(w2.call("camera_move", { layer_id: cam2.id, type: "orbit", degrees: -90, duration: 2, easing: "linear" })); nearV(lastKey(w2.pos(cam2)).v, [-1000, 0, 0], "left", 1e-2);
  const w3 = makeWorld(); const c3 = w3.comp(); const cam3 = w3.camera(c3);
  ok(w3.call("camera_move", { layer_id: cam3.id, type: "orbit", vertical_degrees: 30, duration: 2, easing: "linear" })); nearV(lastKey(w3.pos(cam3)).v, [0, -500, -866.025], "up", 1e-2);
  fails(w3.call("camera_move", { layer_id: cam3.id, type: "orbit", duration: 2 }), "BAD_ARGS");
});

t("orbit around a different target glides the point of interest there", () => {
  const w = makeWorld(); const c = w.comp(); const cam = w.camera(c);
  ok(w.call("camera_move", { layer_id: cam.id, type: "orbit", degrees: 60, duration: 2, target: [500, 0, 0], easing: "linear" }));
  w.pos(cam).keys.forEach((k) => near(Math.hypot(k.v[0] - 500, k.v[1], k.v[2]), Math.hypot(500, 1000), "radius about target", 1e-2));
  assert.equal(w.poi(cam).keys.length, 2); nearV(lastKey(w.poi(cam)).v, [500, 0, 0]);
});

t("truck and pedestal move camera and target together; crane moves only the camera", () => {
  const w = makeWorld(); const c = w.comp(); const cam = w.camera(c);
  ok(w.call("camera_move", { layer_id: cam.id, type: "truck", distance: 100, duration: 1, easing: "linear" }));
  nearV(lastKey(w.pos(cam)).v, [100, 0, -1000]); nearV(lastKey(w.poi(cam)).v, [100, 0, 0]);
  const w2 = makeWorld(); const c2 = w2.comp(); const cam2 = w2.camera(c2);
  ok(w2.call("camera_move", { layer_id: cam2.id, type: "pedestal", distance: 50, duration: 1, easing: "linear" }));
  nearV(lastKey(w2.pos(cam2)).v, [0, -50, -1000]); nearV(lastKey(w2.poi(cam2)).v, [0, -50, 0]);
  const w3 = makeWorld(); const c3 = w3.comp(); const cam3 = w3.camera(c3);
  ok(w3.call("camera_move", { layer_id: cam3.id, type: "crane", distance: 50, duration: 1, easing: "linear" }));
  nearV(lastKey(w3.pos(cam3)).v, [0, -50, -1000]); assert.equal(w3.poi(cam3).keys.length, 0);
  const w4 = makeWorld(); const c4 = w4.comp(); const cam4 = w4.camera(c4, [0, 0, 0], [1000, 0, 0]);
  ok(w4.call("camera_move", { layer_id: cam4.id, type: "truck", distance: 100, duration: 1, easing: "linear" }));
  nearV(lastKey(w4.pos(cam4)).v, [0, 0, -100], "truck is to the camera's right when looking along +x");
});

t("pan turns the point of interest right, tilt turns it up, both on an arc", () => {
  const w = makeWorld(); const c = w.comp(); const cam = w.camera(c);
  ok(w.call("camera_move", { layer_id: cam.id, type: "pan", degrees: 90, duration: 2, easing: "linear" }));
  nearV(lastKey(w.poi(cam)).v, [1000, 0, -1000], "pan end", 1e-2);
  w.poi(cam).keys.forEach((k) => near(Math.hypot(k.v[0], k.v[1], k.v[2] + 1000), 1000, "stays on the arc", 1e-2));
  assert.equal(w.pos(cam).keys.length, 0);
  const w2 = makeWorld(); const c2 = w2.comp(); const cam2 = w2.camera(c2);
  ok(w2.call("camera_move", { layer_id: cam2.id, type: "tilt", degrees: 45, duration: 2, easing: "linear" }));
  nearV(lastKey(w2.poi(cam2)).v, [0, -707.107, -292.893], "tilt end", 1e-2);
});

t("roll, zoom and rack focus animate the right properties", () => {
  const w = makeWorld(); const c = w.comp(); const cam = w.camera(c);
  ok(w.call("camera_move", { layer_id: cam.id, type: "roll", degrees: 15, duration: 1 }));
  const rz = w.prop(cam, "ADBE Transform Group", "ADBE Rotate Z"); assert.equal(rz.keys.length, 2); near(lastKey(rz).v, 15);
  ok(w.call("camera_move", { layer_id: cam.id, type: "zoom", to_focal_length: 100, duration: 1 })); near(lastKey(w.opt(cam, "ADBE Camera Zoom")).v, 1280 * 100 / 36, "to_focal_length", 0.01);
  const w2 = makeWorld(); const c2 = w2.comp(); const cam2 = w2.camera(c2);
  ok(w2.call("camera_move", { layer_id: cam2.id, type: "zoom", to_fov: 90, duration: 1 })); near(lastKey(w2.opt(cam2, "ADBE Camera Zoom")).v, 640, "to_fov", 0.01);
  ok(w2.call("camera_move", { layer_id: cam2.id, type: "zoom", factor: 2, start: 2, duration: 1 })); near(lastKey(w2.opt(cam2, "ADBE Camera Zoom")).v, 1280, "factor", 0.01);
  const w3 = makeWorld(); const c3 = w3.comp(); const cam3 = w3.camera(c3); const target = w3.solid(c3, "Subject"); w3.pos(target).setValue([0, 0, 300]);
  const r = w3.call("camera_move", { layer_id: cam3.id, type: "rack_focus", to_layer_id: target.id, duration: 1 }); ok(r);
  near(lastKey(w3.opt(cam3, "ADBE Camera Focus Distance")).v, 1300, "distance along the view axis"); assert.equal(w3.opt(cam3, "ADBE Camera Depth of Field").value, 1); assert.equal(r.result.depth_of_field_enabled, true);
  const behind = w3.solid(c3, "Behind"); w3.pos(behind).setValue([0, 0, -2000]);
  fails(w3.call("camera_move", { layer_id: cam3.id, type: "rack_focus", to_layer_id: behind.id, duration: 1 }), "BAD_ARGS");
});

t("path keys waypoints at absolute times and validates them", () => {
  const w = makeWorld(); const c = w.comp(); const cam = w.camera(c);
  const wp = [{ t: 1, position: [0, 0, -1000], point_of_interest: [0, 0, 0] }, { t: 3, position: [300, 0, -900] }, { t: 5, position: [600, 100, -800], point_of_interest: [100, 0, 0] }];
  const r = w.call("camera_move", { layer_id: cam.id, type: "path", waypoints: wp }); ok(r);
  assert.deepEqual(w.pos(cam).keys.map((k) => k.t), [1, 3, 5]); assert.deepEqual(w.poi(cam).keys.map((k) => k.t), [1, 5]); assert.equal(r.result.start, 1); assert.equal(r.result.end, 5);
  fails(w.call("camera_move", { layer_id: cam.id, type: "path", waypoints: [{ t: 2, position: [0, 0, 0] }, { t: 1, position: [1, 1, 1] }] }), "BAD_ARGS");
  fails(w.call("camera_move", { layer_id: cam.id, type: "path", waypoints: [{ t: 1 }, { t: 2 }] }), "BAD_ARGS");
  assert.ok(w.pos(cam).keys.every((k) => k.tan === undefined), "smooth (default) leaves After Effects' curved path");
  ok(w.call("camera_move", { layer_id: cam.id, type: "path", waypoints: wp, spatial: "linear" }));
  for (const p of [w.pos(cam), w.poi(cam)]) assert.ok(p.keys.every((k) => k.auto === false && k.cont === false && JSON.stringify(k.tan) === "[[0,0,0],[0,0,0]]"), "linear: straight between the waypoints");
  fails(w.call("camera_move", { layer_id: cam.id, type: "path", waypoints: wp, spatial: "curvy" }), "BAD_ARGS");
});

t("a move replaces keys inside its range and keeps the others", () => {
  const w = makeWorld(); const c = w.comp(); const cam = w.camera(c);
  [[0, -1000], [1, -900], [2, -800], [8, -300]].forEach(([tt, z]) => w.pos(cam).setValueAtTime(tt, [0, 0, z]));
  ok(w.call("camera_move", { layer_id: cam.id, type: "dolly", distance: 100, start: 1, duration: 2, easing: "linear" }));
  assert.deepEqual(w.pos(cam).keys.map((k) => k.t), [0, 1, 3, 8]); nearV(w.pos(cam).keys[1].v, [0, 0, -900]); nearV(w.pos(cam).keys[2].v, [0, 0, -800]);
});

t("moves are validated: one-node camera, bad type, bad times, non-camera layers", () => {
  const w = makeWorld(); const c = w.comp(); const cam = w.camera(c);
  fails(w.call("camera_move", { layer_id: cam.id, type: "wobble", duration: 1 }), "BAD_ARGS");
  fails(w.call("camera_move", { layer_id: cam.id, type: "dolly", distance: 1, duration: 0 }), "BAD_ARGS");
  fails(w.call("camera_move", { layer_id: cam.id, type: "dolly", distance: 1, duration: 20 }), "BAD_ARGS", "past the end of the comp");
  fails(w.call("camera_move", { layer_id: cam.id, type: "dolly", distance: 1, duration: 1, easing: "bouncy" }), "BAD_ARGS");
  ok(w.call("set_camera", { layer_id: cam.id, two_node: false })); assert.equal(cam.autoOrient, 4213);
  fails(w.call("camera_move", { layer_id: cam.id, type: "orbit", degrees: 10, duration: 1 }), "BAD_ARGS", "orbit needs two-node");
  ok(w.call("camera_move", { layer_id: cam.id, type: "roll", degrees: 5, duration: 1 }), "roll and zoom do not");
  const s = w.solid(c); fails(w.call("camera_move", { layer_id: s.id, type: "roll", degrees: 5, duration: 1 }), "BAD_ARGS");
});

t("camera_shake adds marked wiggle expressions, works with moves, and can be removed", () => {
  const w = makeWorld(); const c = w.comp(); const cam = w.camera(c);
  const r = w.call("camera_shake", { layer_id: cam.id, target: "all", amount: 8, frequency: 3, rotation_amount: 0.5 }); ok(r);
  assert.deepEqual(r.result.applied, ["position", "point_of_interest", "roll"]);
  assert.ok(w.pos(cam).expression.startsWith("// ae-motion shake")); assert.ok(w.pos(cam).expression.includes("wiggle(3, 8, 2)")); assert.ok(w.pos(cam).expression.includes("value[2]"));
  assert.ok(w.prop(cam, "ADBE Transform Group", "ADBE Rotate Z").expression.includes("wiggle(3, 0.5, 2)"));
  ok(w.call("camera_move", { layer_id: cam.id, type: "dolly", distance: 100, duration: 1 }), "moves work under a shake");
  const rm = w.call("camera_shake", { layer_id: cam.id, target: "all", remove: true }); ok(rm); assert.equal(rm.result.applied.length, 3); assert.equal(w.pos(cam).expression, "");
  w.pos(cam).expression = "value * 1"; fails(w.call("camera_shake", { layer_id: cam.id }), "BAD_ARGS"); fails(w.call("camera_move", { layer_id: cam.id, type: "dolly", distance: 10, duration: 1 }), "BAD_ARGS");
  const w2 = makeWorld(); const c2 = w2.comp(); const cam2 = w2.camera(c2); w2.call("set_camera", { layer_id: cam2.id, two_node: false });
  fails(w2.call("camera_shake", { layer_id: cam2.id, target: "point_of_interest" }), "BAD_ARGS");
});

t("camera_rig moves keys onto control layers, keys them for moves, and restores on remove", () => {
  const w = makeWorld(); const c = w.comp(); const cam = w.camera(c, [0, 0, -1000], [0, 0, 0], "Main Cam");
  w.pos(cam).setValueAtTime(0, [0, 0, -1000]); w.pos(cam).setValueAtTime(2, [0, 0, -800]);
  const before = c.numLayers; const r = w.call("camera_rig", { layer_id: cam.id, action: "create" }); ok(r);
  assert.equal(c.numLayers, before + 2); const posCtrl = c.layer("Main Cam Position"), tgtCtrl = c.layer("Main Cam Target");
  assert.equal(posCtrl.threeDLayer, true); assert.equal(w.pos(posCtrl).keys.length, 2); assert.equal(w.pos(cam).keys.length, 0);
  assert.ok(w.pos(cam).expression.startsWith("// ae-motion rig")); assert.ok(w.pos(cam).expression.includes('thisComp.layer("Main Cam Position")'));
  nearV(w.pos(tgtCtrl).value, [0, 0, 0]);
  ok(w.call("camera_move", { layer_id: cam.id, type: "truck", distance: 200, start: 3, duration: 1, easing: "linear" }));
  assert.equal(w.pos(cam).keys.length, 0, "camera itself stays unkeyed"); nearV(lastKey(w.pos(posCtrl)).v, [200, 0, -800]); nearV(lastKey(w.pos(tgtCtrl)).v, [200, 0, 0]);
  fails(w.call("camera_rig", { layer_id: cam.id, action: "create" }), "BAD_ARGS", "already rigged");
  const rm = w.call("camera_rig", { layer_id: cam.id, action: "remove" }); ok(rm);
  assert.equal(c.numLayers, before); assert.equal(w.pos(cam).expression, ""); assert.ok(w.pos(cam).keys.length >= 3, "animation restored onto the camera");
  fails(w.call("camera_rig", { layer_id: cam.id, action: "remove" }), "BAD_ARGS", "no rig left");
  const w2 = makeWorld(); const c2 = w2.comp(); const q = w2.camera(c2, [0, 0, -1000], [0, 0, 0], 'Bad "Name"');
  fails(w2.call("camera_rig", { layer_id: q.id, action: "create" }), "BAD_ARGS", "quotes in names");
  const w3 = makeWorld(); const c3 = w3.comp(); const k = w3.camera(c3); const keep = w3.call("camera_rig", { layer_id: k.id, action: "create" }); ok(keep);
  ok(w3.call("camera_rig", { layer_id: k.id, action: "remove", delete_controls: false })); assert.ok(c3.layer("Cam Position"));
});

t("set_camera sets the lens in any unit, validates conflicts, and keys with time", () => {
  const w = makeWorld(); const c = w.comp(); const cam = w.camera(c);
  ok(w.call("set_camera", { layer_id: cam.id, focal_length: 100 })); near(w.opt(cam, "ADBE Camera Zoom").value, 1280 * 100 / 36, "zoom", 0.01);
  const g = w.call("get_camera", { layer_id: cam.id }); ok(g); near(g.result.focal_length_mm, 100, "round trip", 1e-3); near(g.result.fov_horizontal, 2 * Math.atan(640 / (1280 * 100 / 36)) * 180 / Math.PI, "fov", 1e-3);
  ok(w.call("set_camera", { layer_id: cam.id, fov: 90 })); near(w.opt(cam, "ADBE Camera Zoom").value, 640, "fov to zoom", 0.01);
  fails(w.call("set_camera", { layer_id: cam.id, zoom: 500, fov: 60 }), "BAD_ARGS");
  fails(w.call("set_camera", { layer_id: cam.id, fov: 200 }), "BAD_ARGS");
  ok(w.call("set_camera", { layer_id: cam.id, zoom: 2000, time: 1 })); assert.equal(w.opt(cam, "ADBE Camera Zoom").keys.length, 1);
  fails(w.call("set_camera", { layer_id: cam.id, zoom: 100 }), "BAD_ARGS", "animated property needs time");
  ok(w.call("set_camera", { layer_id: cam.id, depth_of_field: true, aperture: 40, blur_level: 150, iris_shape: 5, highlight_gain: 20, position: [10, 20, -900], rotation: { z: 5 } }));
  assert.equal(w.opt(cam, "ADBE Camera Depth of Field").value, 1); assert.equal(w.opt(cam, "ADBE Camera Aperture").value, 40); assert.equal(w.opt(cam, "ADBE Iris Shape").value, 5);
  nearV(w.pos(cam).value, [10, 20, -900]); near(w.prop(cam, "ADBE Transform Group", "ADBE Rotate Z").value, 5);
  const s = w.solid(c); fails(w.call("set_camera", { layer_id: s.id, zoom: 1 }), "BAD_ARGS", "not a camera");
});

t("set_camera focus and look-at use other layers", () => {
  const w = makeWorld(); const c = w.comp(); const cam = w.camera(c); const subject = w.solid(c, "Subject"); w.pos(subject).setValue([200, 100, 300]);
  ok(w.call("set_camera", { layer_id: cam.id, focus_on_layer_id: subject.id })); near(w.opt(cam, "ADBE Camera Focus Distance").value, 1300, "distance along the axis");
  fails(w.call("set_camera", { layer_id: cam.id, focus_distance: 500, focus_on_layer_id: subject.id }), "BAD_ARGS");
  ok(w.call("set_camera", { layer_id: cam.id, look_at_layer_id: subject.id })); nearV(w.poi(cam).value, [200, 100, 300]);
  ok(w.call("set_camera", { layer_id: cam.id, look_at_layer_id: subject.id, follow: true, time: undefined }));
});

t("look-at follow adds a marked expression once", () => {
  const w = makeWorld(); const c = w.comp(); const cam = w.camera(c); const subject = w.solid(c, "Subject");
  ok(w.call("set_camera", { layer_id: cam.id, look_at_layer_id: subject.id, follow: true }));
  assert.ok(w.poi(cam).expression.startsWith("// ae-motion look-at")); assert.ok(w.poi(cam).expression.includes('thisComp.layer("Subject")'));
  fails(w.call("set_camera", { layer_id: cam.id, look_at_layer_id: subject.id, follow: true }), "BAD_ARGS");
  fails(w.call("camera_move", { layer_id: cam.id, type: "pan", degrees: 10, duration: 1 }), "BAD_ARGS", "look-at expression blocks pan");
  assert.equal(w.call("get_camera", { layer_id: cam.id }).result.driven_by.point_of_interest, "look-at");
});

t("add_layer centers new cameras over the comp", () => {
  const w = makeWorld(); const c = w.comp();
  const r = w.call("add_layer", { comp_id: c.id, kind: "camera", options: { name: "New Cam" } }); ok(r);
  const cam = c.layer("New Cam"); nearV(w.pos(cam).value, [640, 360, -1777.78]);
  const r2 = w.call("add_layer", { comp_id: c.id, kind: "camera", options: { name: "Offset Cam", center: [100, 50] } }); ok(r2);
  nearV(w.pos(c.layer("Offset Cam")).value, [100, 50, -1777.78]);
});

t("set_3d turns 3D on, sets the transform and material, and rejects cameras and lights", () => {
  const w = makeWorld(); const c = w.comp(); const s = w.solid(c, "Card");
  const r = w.call("set_3d", { layer_id: s.id, position: [100, 200, 300], rotation: { x: 10, y: 20 }, orientation: [1, 2, 3], scale: [50, 50, 50], material: { casts_shadows: "only", accepts_shadows: false, ambient: 80, metal: 20 } }); ok(r);
  assert.equal(s.threeDLayer, true); assert.equal(r.result.three_d, true); nearV(w.pos(s).value, [100, 200, 300]);
  near(w.prop(s, "ADBE Transform Group", "ADBE Rotate X").value, 10); near(w.prop(s, "ADBE Transform Group", "ADBE Rotate Y").value, 20);
  assert.equal(w.prop(s, "ADBE Material Options Group", "ADBE Casts Shadows").value, 2); assert.equal(w.prop(s, "ADBE Material Options Group", "ADBE Accepts Shadows").value, 0);
  assert.equal(w.prop(s, "ADBE Material Options Group", "ADBE Ambient Coefficient").value, 80); assert.equal(w.prop(s, "ADBE Material Options Group", "ADBE Metal Coefficient").value, 20);
  ok(w.call("set_3d", { layer_id: s.id, position: [0, 0, 500], time: 2 })); assert.equal(w.pos(s).keys.length, 1);
  fails(w.call("set_3d", { layer_id: s.id, material: { casts_shadows: "sometimes" } }), "BAD_ARGS");
  ok(w.call("set_3d", { layer_id: s.id, three_d: false })); assert.equal(s.threeDLayer, false);
  fails(w.call("set_3d", { layer_id: w.camera(c).id, position: [0, 0, 0] }), "BAD_ARGS"); fails(w.call("set_3d", { layer_id: w.light(c).id, position: [0, 0, 0] }), "BAD_ARGS");
});

t("set_3d z sets only the depth: x/y stay, and a moving layer keeps every key (each gets the new z)", () => {
  const w = makeWorld(); const c = w.comp(); const still = w.solid(c, "Still"); const moving = w.solid(c, "Moving");
  w.pos(still).setValue([300, 200, 0]);
  ok(w.call("set_3d", { layer_id: still.id, z: 900 })); assert.equal(still.threeDLayer, true); nearV(w.pos(still).value, [300, 200, 900]);
  w.pos(moving).setValueAtTime(1, [0, 0, 0]); w.pos(moving).setValueAtTime(2, [500, 100, 0]); w.pos(moving).keys[1].interp = ["hold", "hold"];
  ok(w.call("set_3d", { layer_id: moving.id, z: -250 }));
  assert.equal(JSON.stringify(w.pos(moving).keys.map((k) => k.v)), "[[0,0,-250],[500,100,-250]]");
  assert.equal(JSON.stringify(w.pos(moving).keys[1].interp), '["hold","hold"]', "key settings kept");
  fails(w.call("set_3d", { layer_id: still.id, z: 1, position: [0, 0, 0] }), "BAD_ARGS");
});

t("set_light edits a light, maps falloff, and checks spot-only fields", () => {
  const w = makeWorld(); const c = w.comp(); const lt = w.light(c);
  const r = w.call("set_light", { layer_id: lt.id, intensity: 150, color: [1, 0.5, 0.2], cone_angle: 60, cone_feather: 20, falloff: "smooth", falloff_radius: 100, falloff_distance: 900, casts_shadows: true, shadow_darkness: 70, shadow_diffusion: 5, position: [300, -200, -500], point_of_interest: [0, 0, 0] }); ok(r);
  const g = (n) => w.prop(lt, "ADBE Light Options Group", n).value;
  assert.equal(g("ADBE Light Intensity"), 150); assert.deepEqual(Array.from(g("ADBE Light Color")).slice(0, 3), [1, 0.5, 0.2]); assert.equal(g("ADBE Light Cone Angle"), 60); assert.equal(g("ADBE Light Falloff Type"), 2);
  assert.equal(g("ADBE Casts Shadows"), 1); assert.equal(r.result.light_type, "spot"); assert.equal(r.result.falloff, "smooth"); nearV(w.pos(lt).value, [300, -200, -500]);
  ok(w.call("set_light", { layer_id: lt.id, light_type: "point" })); fails(w.call("set_light", { layer_id: lt.id, cone_angle: 30 }), "BAD_ARGS", "cone on a point light");
  fails(w.call("set_light", { layer_id: lt.id, falloff: "weird" }), "BAD_ARGS");
  ok(w.call("set_light", { layer_id: lt.id, intensity: 50, time: 1 })); assert.equal(w.prop(lt, "ADBE Light Options Group", "ADBE Light Intensity").keys.length, 1);
  fails(w.call("set_light", { layer_id: w.solid(c).id, intensity: 1 }), "BAD_ARGS");
});

t("link_layers parents several layers to an existing layer, ignores duplicates, and unlinks", () => {
  const w = makeWorld(); const c = w.comp(); const boss = w.solid(c, "Boss"); const a = w.solid(c, "A"); const b = w.solid(c, "B");
  const r = w.call("link_layers", { layer_ids: [a.id, b.id, a.id], parent_id: boss.id }); ok(r);
  assert.equal(a.parent, boss); assert.equal(b.parent, boss); assert.equal(r.result.layers.length, 2); assert.equal(r.result.created_null, false); assert.equal(r.result.parent.id, boss.id);
  assert.equal(a.jumped, undefined, "default does not use setParentWithJump");
  const u = w.call("link_layers", { layer_ids: [a.id], parent_id: null }); ok(u); assert.equal(a.parent, null); assert.equal(b.parent, boss); assert.equal(u.result.parent, null);
  ok(w.call("link_layers", { layer_ids: [a.id], parent_id: boss.id, jump: true })); assert.equal(a.jumped, true); assert.equal(a.parent, boss);
});

t("link_layers refuses self-links, cycles, locked layers, mixed comps and bad arguments without changing anything", () => {
  const w = makeWorld(); const c = w.comp(); const p = w.solid(c, "P"); const k = w.solid(c, "K"); const other = w.comp(); const x = w.solid(other, "X");
  k.parent = p;
  fails(w.call("link_layers", { layer_ids: [p.id], parent_id: p.id }), "BAD_ARGS", "self");
  fails(w.call("link_layers", { layer_ids: [p.id], parent_id: k.id }), "BAD_ARGS", "cycle"); assert.equal(p.parent, null);
  fails(w.call("link_layers", { layer_ids: [k.id, x.id], parent_id: p.id }), "BAD_ARGS", "mixed comps");
  fails(w.call("link_layers", { layer_ids: [x.id], parent_id: p.id }), "BAD_ARGS", "parent in another comp");
  const lk = w.solid(c, "Locked"); lk.locked = true; const free = w.solid(c, "Free");
  fails(w.call("link_layers", { layer_ids: [free.id, lk.id], parent_id: p.id }), "BAD_ARGS", "locked"); assert.equal(free.parent, null, "nothing changed");
  fails(w.call("link_layers", { layer_ids: [free.id] }), "BAD_ARGS", "no target");
  fails(w.call("link_layers", { layer_ids: [free.id], parent_id: p.id, new_null: {} }), "BAD_ARGS", "both targets");
  fails(w.call("link_layers", { layer_ids: [], parent_id: p.id }), "BAD_ARGS", "empty");
  fails(w.call("link_layers", { layer_ids: [free.id], parent_id: 99999 }), "NOT_FOUND", "missing parent");
});

t("link_layers new_null makes a null at the layers' centre, above them, and links them", () => {
  const w = makeWorld(); const c = w.comp(); const a = w.solid(c, "A"); const b = w.solid(c, "B"); const d = w.solid(c, "D");
  w.pos(a).setValue([0, 0, 0]); w.pos(b).setValue([300, 0, 0]); w.pos(d).setValue([600, 300, 300]); d.threeDLayer = true;
  const r = w.call("link_layers", { layer_ids: [a.id, b.id, d.id], new_null: { name: "Group" } }); ok(r);
  const n = c.layer("Group"); assert.equal(r.result.created_null, true); assert.equal(n.nullLayer, true); assert.equal(n.threeDLayer, true, "3D because a child is 3D");
  nearV(w.pos(n).value, [300, 100, 100]); [a, b, d].forEach((l) => assert.equal(l.parent, n));
  assert.ok(n.index < Math.min(a.index, b.index, d.index), "the null sits above its children");
  const w2 = makeWorld(); const c2 = w2.comp(); const e = w2.solid(c2, "E"); const f = w2.solid(c2, "F");
  w2.pos(e).setValue([100, 100, 0]); w2.pos(f).setValue([300, 200, 0]);
  ok(w2.call("link_layers", { layer_ids: [e.id, f.id], new_null: {} })); const n2 = c2.layer("Link Null");
  assert.equal(n2.threeDLayer, false); assert.deepEqual(Array.from(w2.pos(n2).value), [200, 150]);
  const w3 = makeWorld(); const c3 = w3.comp(); const g = w3.solid(c3, "G");
  ok(w3.call("link_layers", { layer_ids: [g.id], new_null: { name: "P3", position: [50, 60, 70] } })); assert.equal(c3.layer("P3").threeDLayer, true); assert.deepEqual(Array.from(w3.pos(c3.layer("P3")).value), [50, 60, 70]);
  ok(w3.call("link_layers", { layer_ids: [g.id], new_null: { name: "P2", position: [50, 60, 70], three_d: false } })); assert.equal(c3.layer("P2").threeDLayer, false); assert.deepEqual(Array.from(w3.pos(c3.layer("P2")).value), [50, 60]);
  ok(w3.call("link_layers", { layer_ids: [g.id], new_null: { name: "PJ" }, jump: true })); assert.equal(g.jumped, true);
});

t("add_layer null takes a position and three_d", () => {
  const w = makeWorld(); const c = w.comp();
  ok(w.call("add_layer", { comp_id: c.id, kind: "null", options: { name: "Ctrl", position: [100, 200] } }));
  const n = c.layer("Ctrl"); assert.equal(n.threeDLayer, false); assert.deepEqual(Array.from(w.pos(n).value), [100, 200]);
  ok(w.call("add_layer", { comp_id: c.id, kind: "null", options: { name: "Ctrl3", position: [1, 2, 3] } }));
  const n3 = c.layer("Ctrl3"); assert.equal(n3.threeDLayer, true); assert.deepEqual(Array.from(w.pos(n3).value), [1, 2, 3]);
  ok(w.call("add_layer", { comp_id: c.id, kind: "null", options: { name: "Ctrl4", three_d: true } })); assert.equal(c.layer("Ctrl4").threeDLayer, true);
});

t("set_3d_view runs the matching View menu command and validates", () => {
  const w = makeWorld(); const c = w.comp();
  const r = w.call("set_3d_view", { view: "front", comp_id: c.id }); ok(r); assert.equal(r.result.menu_item, "Front"); assert.deepEqual(w.world.executed, [r.result.command_id]);
  const r2 = w.call("set_3d_view", { view: "custom_2", comp_id: c.id }); ok(r2); assert.equal(r2.result.menu_item, "Custom View 2"); assert.equal(w.world.executed.length, 2);
  const rc = w.call("set_3d_view", { view: "active_camera" }); ok(rc, "uses the active comp once one is open"); assert.equal(rc.result.menu_item, "Active Camera", "no camera yet"); assert.equal(w.world.executed.length, 3);
  w.camera(c); const rc2 = w.call("set_3d_view", { view: "active_camera" }); ok(rc2); assert.equal(rc2.result.menu_item, "Active Camera (Cam)", "the menu item carries the camera name"); assert.equal(w.world.executed.length, 4);
  fails(w.call("set_3d_view", { view: "sideways", comp_id: c.id }), "BAD_ARGS"); fails(w.call("set_3d_view", { view: "constructor", comp_id: c.id }), "BAD_ARGS");
  const w2 = makeWorld(); fails(w2.call("set_3d_view", { view: "top" }), "BAD_ARGS", "no active comp");
  const w3 = makeWorld(); const c3 = w3.comp(); w3.world.noMenu = true; fails(w3.call("set_3d_view", { view: "top", comp_id: c3.id }), "UNSUPPORTED");
});

for (const [name, pass, msg] of results) console.log((pass ? "PASS" : "FAIL") + "  " + name + (pass ? "" : "\n      " + msg));
const failed = results.filter((r) => !r[1]).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
