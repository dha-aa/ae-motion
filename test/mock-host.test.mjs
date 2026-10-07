// Logic tests for panel/host/host.jsx (timeline, reorder, markers, comp and item tools) against a minimal fake After Effects DOM.
// They cannot check real After Effects behavior; see "Test status" in the README.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import assert from "node:assert/strict";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const HOST = path.join(ROOT, "panel", "host", "host.jsx");
const SRC = fs.readFileSync(HOST, "utf8");
const FD = 1 / 30;
const near = (a, b, m = "") => assert.ok(Math.abs(a - b) < 1e-4, `${m} expected ${b}, got ${a}`);

class FakeProp {
  constructor() { this.keys = []; }
  get numKeys() { return this.keys.length; }
  setValueAtTime(t, v) { this.keys.push({ t, v }); this.keys.sort((a, b) => a.t - b.t); }
  keyTime(i) { return this.keys[i - 1].t; }
  keyValue(i) { return this.keys[i - 1].v; }
  removeKey(i) { this.keys.splice(i - 1, 1); }
  nearestKeyIndex(t) { let best = 1, bd = Infinity; this.keys.forEach((k, i) => { const d = Math.abs(k.t - t); if (d < bd) { bd = d; best = i + 1; } }); return best; }
}

function makeWorld({ startShiftsInOut = true } = {}) {
  let nextId = 100;
  const world = { items: [] };
  class Item { constructor() { this.id = nextId++; this.name = "item"; this.usedIn = []; } remove() { world.items = world.items.filter((i) => i !== this); } }
  class FolderItem extends Item { constructor() { super(); this.numItems = 0; } }
  class FootageItem extends Item {}
  class CompItem extends Item {
    constructor(name) {
      super(); this.name = name; this.width = 1920; this.height = 1080; this.frameRate = 30; this.frameDuration = FD; this.duration = 10;
      this.pixelAspect = 1; this.bgColor = [0, 0, 0]; this._layers = []; this.time = 0; this._wa = [0, 10]; this.markerProperty = new FakeProp();
    }
    get numLayers() { return this._layers.length; }
    layer(i) { return this._layers[i - 1]; }
    get workAreaStart() { return this._wa[0]; }
    set workAreaStart(v) { if (v + this._wa[1] > this.duration + 1e-9) throw new Error("work area too long"); this._wa[0] = v; }
    get workAreaDuration() { return this._wa[1]; }
    set workAreaDuration(v) { if (this._wa[0] + v > this.duration + 1e-9) throw new Error("work area too long"); this._wa[1] = v; }
    addLayer(name, i, o) { const l = new Layer(this, name, i, o); this._layers.push(l); return l; }
  }
  class Layer {
    constructor(comp, name, i, o) {
      this.comp = comp; this.id = nextId++; this.name = name; this._in = i; this._out = o; this._start = i; this.locked = false; this.enabled = true;
      this.shy = false; this.solo = false; this.label = 0; this.parent = null; this.nullLayer = false; this.adjustmentLayer = false; this.source = null; this.stretch = 100;
      this.marker = new FakeProp();
    }
    get inPoint() { return this._in; } set inPoint(v) { this._in = v; }
    get outPoint() { return this._out; } set outPoint(v) { this._out = v; }
    get startTime() { return this._start; }
    set startTime(v) { const d = v - this._start; this._start = v; if (startShiftsInOut) { this._in += d; this._out += d; } }
    get containingComp() { return this.comp; }
    get index() { return this.comp._layers.indexOf(this) + 1; }
    duplicate() { const d = new Layer(this.comp, this.name, this._in, this._out); d._start = this._start; this.comp._layers.splice(this.index - 1, 0, d); return d; }
    remove() { this.comp._layers.splice(this.index - 1, 1); }
    moveBefore(r) { this.comp._layers.splice(this.index - 1, 1); this.comp._layers.splice(r.index - 1, 0, this); }
    moveAfter(r) { this.comp._layers.splice(this.index - 1, 1); this.comp._layers.splice(r.index, 0, this); }
    moveToBeginning() { this.comp._layers.splice(this.index - 1, 1); this.comp._layers.unshift(this); }
    moveToEnd() { this.comp._layers.splice(this.index - 1, 1); this.comp._layers.push(this); }
    property(n) { return n === "ADBE Marker" ? this.marker : undefined; }
  }
  class Stub {}
  const app = {
    project: {
      get numItems() { return world.items.length; },
      item(i) { return world.items[i - 1]; },
      itemByID(id) { return world.items.find((i) => i.id === id) || null; },
      file: null,
    },
    beginUndoGroup() {}, endUndoGroup() {},
  };
  class MarkerValue { constructor(c) { this.comment = c; this.duration = 0; this.chapter = ""; this.url = ""; this.label = 0; } }
  const ctx = { app, CompItem, FolderItem, FootageItem, TextLayer: Stub, ShapeLayer: Stub, CameraLayer: Stub, LightLayer: Stub, SolidSource: Stub, MarkerValue, console };
  vm.createContext(ctx);
  vm.runInContext(SRC, ctx);
  const call = (cmd, args = {}) => JSON.parse(ctx.AEM.dispatch(JSON.stringify({ cmd, args })));
  const comp = (name = "Comp") => { const c = new CompItem(name); world.items.push(c); return c; };
  const layer = (c, name, i, o) => c.addLayer(name, i, o);
  const names = (c) => c._layers.map((l) => l.name);
  return { call, comp, layer, names, world, FolderItem, FootageItem, CompItem };
}

const results = [];
function t(name, fn) {
  try { fn(); results.push([name, true]); } catch (e) { results.push([name, false, e.message]); }
}
const ok = (r, m = "") => assert.equal(r.ok, true, `${m} ${JSON.stringify(r.error)}`);
const fails = (r, code, m = "") => { assert.equal(r.ok, false, m + " should fail"); if (code) assert.equal(r.error.code, code, m + " " + JSON.stringify(r.error)); };

for (const mode of [true, false]) {
  const tag = mode ? "start moves in/out" : "start leaves in/out";

  t(`split_layer splits at a frame-snapped time (${tag})`, () => {
    const w = makeWorld({ startShiftsInOut: mode }); const c = w.comp(); const A = w.layer(c, "A", 0, 10);
    const r = w.call("split_layer", { layer_ids: [A.id], time: 4.04 }); ok(r);
    near(r.result.time, 121 / 30, "snapped time");
    assert.equal(c.numLayers, 2);
    near(c.layer(2).outPoint, 121 / 30); near(c.layer(1).inPoint, 121 / 30); near(c.layer(1).outPoint, 10);
    assert.equal(c.layer(2), A, "original stays below, keeps first part");
  });

  t(`split_layer is all-or-nothing and respects locks (${tag})`, () => {
    const w = makeWorld({ startShiftsInOut: mode }); const c = w.comp(); const A = w.layer(c, "A", 0, 10); const B = w.layer(c, "B", 5, 8);
    fails(w.call("split_layer", { layer_ids: [A.id, B.id], time: 2 }), "BAD_ARGS", "time outside B");
    assert.equal(c.numLayers, 2, "no partial change");
    A.locked = true;
    fails(w.call("split_layer", { layer_ids: [A.id], time: 2 }), "BAD_ARGS", "locked");
    assert.equal(c.numLayers, 2);
  });

  t(`delete_range ripple handles every overlap case (${tag})`, () => {
    const w = makeWorld({ startShiftsInOut: mode }); const c = w.comp();
    const A = w.layer(c, "A", 0, 10), B = w.layer(c, "B", 3.5, 4.5), C = w.layer(c, "C", 4, 8), D = w.layer(c, "D", 6, 9), E = w.layer(c, "E", 0, 2), F = w.layer(c, "F", 1, 4), G = w.layer(c, "G", 0, 10);
    G.locked = true;
    const r = w.call("delete_range", { comp_id: c.id, start: 3, end: 5 }); ok(r);
    assert.deepEqual(r.result.deleted, [B.id]); assert.ok(!c._layers.includes(B));
    near(A.inPoint, 0); near(A.outPoint, 3);
    const second = c._layers.find((l) => l.id === r.result.split[0].second); near(second.inPoint, 3); near(second.outPoint, 8);
    near(C.inPoint, 3); near(C.outPoint, 6);
    near(D.inPoint, 4); near(D.outPoint, 7);
    near(E.inPoint, 0); near(E.outPoint, 2);
    near(F.inPoint, 1); near(F.outPoint, 3);
    near(G.inPoint, 0); near(G.outPoint, 10); assert.deepEqual(r.result.skipped_locked, [G.id]);
  });

  t(`delete_range without ripple leaves the gap (${tag})`, () => {
    const w = makeWorld({ startShiftsInOut: mode }); const c = w.comp();
    const A = w.layer(c, "A", 0, 10), C = w.layer(c, "C", 4, 8), D = w.layer(c, "D", 6, 9);
    const r = w.call("delete_range", { comp_id: c.id, start: 3, end: 5, ripple: false }); ok(r);
    near(A.outPoint, 3); const second = c._layers.find((l) => l.id === r.result.split[0].second); near(second.inPoint, 5); near(second.outPoint, 10);
    near(C.inPoint, 5); near(C.outPoint, 8); near(D.inPoint, 6); near(D.outPoint, 9);
    assert.equal(r.result.shifted.length, 0);
  });

  t(`shift_layers moves in/out together (${tag})`, () => {
    const w = makeWorld({ startShiftsInOut: mode }); const c = w.comp(); const A = w.layer(c, "A", 2, 5);
    ok(w.call("shift_layers", { layer_ids: [A.id], offset_seconds: 1.5 })); near(A.inPoint, 3.5); near(A.outPoint, 6.5);
    ok(w.call("shift_layers", { layer_ids: [A.id], offset_seconds: -3 })); near(A.inPoint, 0.5); near(A.outPoint, 3.5);
  });

  t(`sequence_layers chains layers with overlap (${tag})`, () => {
    const w = makeWorld({ startShiftsInOut: mode }); const c = w.comp();
    const L1 = w.layer(c, "1", 0, 2), L2 = w.layer(c, "2", 5, 8), L3 = w.layer(c, "3", 9, 10);
    ok(w.call("sequence_layers", { layer_ids: [L1.id, L2.id, L3.id], overlap: 0.5 }));
    near(L1.inPoint, 0); near(L1.outPoint, 2); near(L2.inPoint, 1.5); near(L2.outPoint, 4.5); near(L3.inPoint, 4); near(L3.outPoint, 5);
    ok(w.call("sequence_layers", { layer_ids: [L1.id, L2.id], start: 3 })); near(L1.inPoint, 3); near(L2.inPoint, 5);
  });
}

t("delete_range can shorten the comp and rejects bad ranges", () => {
  const w = makeWorld(); const c = w.comp(); w.layer(c, "A", 0, 10);
  const r = w.call("delete_range", { comp_id: c.id, start: 3, end: 5, shorten_comp: true }); ok(r); near(c.duration, 8);
  fails(w.call("delete_range", { comp_id: c.id, start: 5, end: 5 }), "BAD_ARGS");
});

t("reorder_layer covers to/index/before/after and validates input", () => {
  const w = makeWorld(); const c = w.comp(); const a = w.layer(c, "a", 0, 1), b = w.layer(c, "b", 0, 1), d = w.layer(c, "c", 0, 1);
  ok(w.call("reorder_layer", { layer_id: d.id, to: "top" })); assert.deepEqual(w.names(c), ["c", "a", "b"]);
  ok(w.call("reorder_layer", { layer_id: a.id, to: "bottom" })); assert.deepEqual(w.names(c), ["c", "b", "a"]);
  ok(w.call("reorder_layer", { layer_id: a.id, to: "up" })); assert.deepEqual(w.names(c), ["c", "a", "b"]);
  ok(w.call("reorder_layer", { layer_id: d.id, to: "down" })); assert.deepEqual(w.names(c), ["a", "c", "b"]);
  ok(w.call("reorder_layer", { layer_id: a.id, index: 3 })); assert.deepEqual(w.names(c), ["c", "b", "a"]);
  ok(w.call("reorder_layer", { layer_id: a.id, index: 1 })); assert.deepEqual(w.names(c), ["a", "c", "b"]);
  ok(w.call("reorder_layer", { layer_id: b.id, before_layer_id: a.id })); assert.deepEqual(w.names(c), ["b", "a", "c"]);
  ok(w.call("reorder_layer", { layer_id: b.id, after_layer_id: d.id })); assert.deepEqual(w.names(c), ["a", "c", "b"]);
  fails(w.call("reorder_layer", { layer_id: a.id }), "BAD_ARGS");
  fails(w.call("reorder_layer", { layer_id: a.id, to: "top", index: 2 }), "BAD_ARGS");
  fails(w.call("reorder_layer", { layer_id: a.id, index: 9 }), "BAD_ARGS");
  fails(w.call("reorder_layer", { layer_id: a.id, before_layer_id: a.id }), "BAD_ARGS");
});

t("duplicate_layer makes offset copies", () => {
  const w = makeWorld(); const c = w.comp(); const a = w.layer(c, "a", 0, 2);
  const r = w.call("duplicate_layer", { layer_id: a.id, count: 2, name: "copy", offset_seconds: 1 }); ok(r);
  assert.equal(c.numLayers, 3); assert.deepEqual(r.result.layers.map((l) => l.name), ["copy 1", "copy 2"]);
  near(r.result.layers[0].in, 1); near(r.result.layers[1].in, 2);
  fails(w.call("duplicate_layer", { layer_id: a.id, count: 99 }), "BAD_ARGS");
});

t("markers: add, list, delete on layers and comps", () => {
  const w = makeWorld(); const c = w.comp(); const a = w.layer(c, "a", 0, 5);
  ok(w.call("add_marker", { layer_id: a.id, time: 2, comment: "hit", duration: 0.5 }));
  ok(w.call("add_marker", { layer_id: a.id, time: 1, comment: "intro" }));
  let r = w.call("list_markers", { layer_id: a.id }); ok(r); assert.equal(r.result.total, 2); assert.deepEqual(r.result.markers.map((m) => m.comment), ["intro", "hit"]);
  fails(w.call("delete_marker", { layer_id: a.id, time: 4 }), "NOT_FOUND");
  ok(w.call("delete_marker", { layer_id: a.id, time: 2.01 }));
  r = w.call("list_markers", { layer_id: a.id }); assert.equal(r.result.total, 1);
  ok(w.call("add_marker", { comp_id: c.id, time: 3, comment: "scene" }));
  r = w.call("list_markers", { comp_id: c.id }); assert.equal(r.result.markers[0].comment, "scene");
  ok(w.call("delete_marker", { comp_id: c.id, index: 1 }));
  fails(w.call("list_markers", {}), "BAD_ARGS"); fails(w.call("list_markers", { layer_id: a.id, comp_id: c.id }), "BAD_ARGS");
  fails(w.call("delete_marker", { comp_id: c.id, index: 1 }), "NOT_FOUND");
});

t("set_comp changes settings and handles the work area order", () => {
  const w = makeWorld(); const c = w.comp();
  const r = w.call("set_comp", { comp_id: c.id, name: "Main", width: 1080, height: 1350, work_area: { start: 2, duration: 3 } }); ok(r);
  assert.equal(c.name, "Main"); assert.equal(c.width, 1080); near(c.workAreaStart, 2); near(c.workAreaDuration, 3);
  assert.equal(r.result.work_area_start, 2);
  fails(w.call("set_comp", { comp_id: c.id, work_area: { start: 9, duration: 5 } }), "BAD_ARGS");
});

t("delete_item guards used items and non-empty folders", () => {
  const w = makeWorld(); const c = w.comp(); const f = new w.FootageItem(); w.world.items.push(f); f.usedIn = [c];
  fails(w.call("delete_item", { item_id: f.id }), "BAD_ARGS");
  ok(w.call("delete_item", { item_id: f.id, force: true })); assert.ok(!w.world.items.includes(f));
  const fo = new w.FolderItem(); fo.numItems = 2; w.world.items.push(fo);
  fails(w.call("delete_item", { item_id: fo.id }), "BAD_ARGS");
  fails(w.call("delete_item", { item_id: 99999 }), "NOT_FOUND");
});

t("set_playhead snaps and validates; get_comp reports timeline fields", () => {
  const w = makeWorld(); const c = w.comp();
  const r = w.call("set_playhead", { comp_id: c.id, time: 2.01 }); ok(r); near(r.result.time, 2 + 0 / 30 + 0, "snapped"); assert.equal(r.result.frame, 60);
  fails(w.call("set_playhead", { comp_id: c.id, time: 99 }), "BAD_ARGS");
  const g = w.call("get_comp", { comp_id: c.id }); ok(g);
  assert.ok("work_area_start" in g.result && "work_area_duration" in g.result && "time" in g.result && "num_markers" in g.result);
});

t("set_layer flags and stretch validation", () => {
  const w = makeWorld(); const c = w.comp(); const a = w.layer(c, "a", 0, 5);
  fails(w.call("set_layer", { layer_id: a.id, stretch: 0 }), "BAD_ARGS");
  ok(w.call("set_layer", { layer_id: a.id, shy: true, solo: true, label: 5, locked: true })); assert.equal(a.shy, true); assert.equal(a.label, 5); assert.equal(a.locked, true);
  ok(w.call("set_layer", { layer_id: a.id, locked: false, name: "renamed" })); assert.equal(a.locked, false); assert.equal(a.name, "renamed");
});

for (const [name, pass, msg] of results) console.log((pass ? "PASS" : "FAIL") + "  " + name + (pass ? "" : "\n      " + msg));
const failed = results.filter((r) => !r[1]).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
