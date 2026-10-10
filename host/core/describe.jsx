// Turn After Effects objects into the plain JSON objects tools return.

var MASKMODES = { none: "NONE", add: "ADD", subtract: "SUBTRACT", intersect: "INTERSECT", lighten: "LIGHTEN", darken: "DARKEN", difference: "DIFFERENCE" };
var MATTES = { alpha: "ALPHA", alpha_inverted: "ALPHA_INVERTED", luma: "LUMA", luma_inverted: "LUMA_INVERTED" };

function layerKind(l) {
  if (l instanceof TextLayer) return "text";
  if (l instanceof ShapeLayer) return "shape";
  if (l instanceof CameraLayer) return "camera";
  if (l instanceof LightLayer) return "light";
  if (l.nullLayer) return "null";
  if (l.adjustmentLayer) return "adjustment";
  if (l.source instanceof CompItem) return "precomp";
  if (l.source && l.source.mainSource instanceof SolidSource) return "solid";
  return "footage";
}

/** @param {Layer} l @returns {any} */
// BlendingMode enum value -> its name (NORMAL, ADD, SCREEN and so on), the same names set_layer blend_mode takes.
function blendModeName(v) {
  var k;
  for (k in BlendingMode) { if (BlendingMode.hasOwnProperty(k) && BlendingMode[k] === v) return k; }
  return undefined;
}

// A layer as JSON. Only non-default values are included, to keep get_comp and every result that describes a layer
// small (the server instructions tell clients a missing flag means false, blend NORMAL, stretch 100, enabled true).
function layerInfo(l) {
  var o = { id: l.id, index: l.index, name: l.name, kind: layerKind(l), "in": l.inPoint, "out": l.outPoint, start: l.startTime, comp_id: l.containingComp.id, label: l.label },
    bm = safe(function () { return blendModeName(l.blendingMode); }), st = safe(function () { return l.stretch; });
  if ((o.kind === "precomp" || o.kind === "footage") && l.source) o.source_id = l.source.id; // the comp / footage item it plays
  if (l.parent) o.parent_id = l.parent.id;
  if (l.enabled === false) o.enabled = false;
  if (l.locked) o.locked = true;
  if (l.shy) o.shy = true;
  if (l.solo) o.solo = true;
  if (safe(function () { return l.threeDLayer; })) o.three_d = true;
  if (st !== undefined && st !== 100) o.stretch = st;
  if (bm && bm !== "NORMAL") o.blend_mode = bm; // cameras and lights have no blend mode or motion blur
  if (safe(function () { return l.motionBlur; })) o.motion_blur = true;
  return o;
}

// What tools that change layers return: enough to address the layer again (get_layer has the rest).
function layerRef(l) { return { id: l.id, index: l.index, name: l.name }; }

// layerRef plus timing, for the timeline tools.
function layerTiming(l) {
  var o = layerRef(l), st = safe(function () { return l.stretch; });
  o["in"] = l.inPoint; o.out = l.outPoint; o.start = l.startTime;
  if (st !== undefined && st !== 100) o.stretch = st;
  return o;
}

var LAYER_FIELDS = {
  name: function (l) { return l.name; }, start: function (l) { return l.startTime; }, "in": function (l) { return l.inPoint; },
  out: function (l) { return l.outPoint; }, stretch: function (l) { return l.stretch; }, parent_id: function (l) { return l.parent ? l.parent.id : null; },
  enabled: function (l) { return l.enabled; }, locked: function (l) { return l.locked; }, shy: function (l) { return l.shy; },
  solo: function (l) { return l.solo; }, label: function (l) { return l.label; }, three_d: function (l) { return l.threeDLayer; },
  blend_mode: function (l) { return blendModeName(l.blendingMode); }, motion_blur: function (l) { return l.motionBlur; }
};

// layerRef plus the layer fields named in args, read back (set_layer). Changing any timing field reports all three
// (setting in moves out, and so on).
function layerFieldsSet(l, args) {
  var o = layerRef(l), k;
  for (k in args) {
    if (!args.hasOwnProperty(k) || !LAYER_FIELDS.hasOwnProperty(k)) continue;
    if (k === "start" || k === "in" || k === "out" || k === "stretch") { o.start = l.startTime; o["in"] = l.inPoint; o.out = l.outPoint; }
    o[k] = safe(function () { return LAYER_FIELDS[k](l); });
  }
  return o;
}

// A comp as JSON, leaving out settings at their defaults (square pixels, work area = whole comp, playhead at 0,
// motion blur and frame blending off, no markers; the shutter only when motion blur is on).
function compInfo(c, withLayers) {
  var o = {
    id: c.id, name: c.name, width: c.width, height: c.height, fps: c.frameRate, duration: c.duration,
    bg_color: [c.bgColor[0], c.bgColor[1], c.bgColor[2]], num_layers: c.numLayers
  }, nm = safe(function () { return c.markerProperty.numKeys; });
  if (c.pixelAspect !== 1) o.pixel_aspect = c.pixelAspect;
  if (c.workAreaStart !== 0 || Math.abs(c.workAreaDuration - c.duration) > 1e-6) { o.work_area_start = c.workAreaStart; o.work_area_duration = c.workAreaDuration; }
  if (c.time !== 0) o.time = c.time;
  if (c.motionBlur) o.motion_blur = true;
  if (c.motionBlur) { o.shutter_angle = c.shutterAngle; o.shutter_phase = c.shutterPhase; } // they only matter with blur on
  if (c.frameBlending) o.frame_blending = true;
  if (nm) o.num_markers = nm;
  if (withLayers) { o.layers = []; for (var i = 1; i <= c.numLayers; i++) o.layers.push(layerBrief(c.layer(i), c)); }
  return o;
}

// A layer in a comp's layer list (get_comp): what layerInfo says minus what the list already tells (the comp, the
// stacking order) and the defaults: in is left out at 0, out at the comp's end, start at 0 or when it equals in.
// The label color is only in get_layer.
function layerBrief(l, c) {
  var o = layerInfo(l), fd = c.frameDuration;
  delete o.index; delete o.comp_id; delete o.label;
  if (o.start === 0 || Math.abs(o.start - o["in"]) < fd / 2) delete o.start;
  if (o["in"] < fd / 2) delete o["in"];
  if (o.out > c.duration - fd / 2) delete o.out;
  return o;
}

function itemInfo(it) {
  var o = { id: it.id, name: it.name, type: it instanceof CompItem ? "comp" : (it instanceof FolderItem ? "folder" : "footage") };
  if (it instanceof CompItem || it instanceof FootageItem) {
    if (it.width) { o.width = it.width; o.height = it.height; } // audio has no frame size
    o.duration = it.duration;
  }
  return o;
}

// Short name for a property's value type.
function vt(p) {
  var t = p.propertyValueType, V = PropertyValueType;
  if (t === V.OneD) return "1d"; if (t === V.TwoD) return "2d"; if (t === V.ThreeD) return "3d";
  if (t === V.COLOR) return "color"; if (t === V.TwoD_SPATIAL) return "2d_spatial"; if (t === V.ThreeD_SPATIAL) return "3d_spatial";
  if (t === V.SHAPE) return "shape"; if (t === V.TEXT_DOCUMENT) return "text"; if (t === V.NO_VALUE) return "none";
  if (t === V.MARKER) return "marker"; if (t === V.LAYER_INDEX) return "layer_index"; if (t === V.MASK_INDEX) return "mask_index";
  return "custom";
}

// A property's value at time as JSON (paths as shape specs), or undefined for types that do not serialize (markers, custom).
// pre: the value before any expression (keyframes or the static value).
function safeVal(p, time, pre) {
  var t = p.propertyValueType, V = PropertyValueType, v;
  try {
    if (t === V.TEXT_DOCUMENT) return p.value.text;
    if (t === V.SHAPE) return shapeToJson(p.valueAtTime(time, pre === true));
    if (t === V.OneD || t === V.TwoD || t === V.ThreeD || t === V.COLOR || t === V.TwoD_SPATIAL || t === V.ThreeD_SPATIAL || t === V.LAYER_INDEX || t === V.MASK_INDEX) {
      v = p.canVaryOverTime ? p.valueAtTime(time, pre === true) : p.value;
      return v instanceof Array ? copyArr(v) : v;
    }
  } catch (e) {}
  return undefined;
}

// Groups list_properties leaves out unless asked (all, or a group_path into them): the layer marker, and the shape
// "Material Options" groups (48 3D-only properties each, repeated in every shape group).
var WALK_SKIP = { "ADBE Marker": 1, "ADBE Vector Materials Group": 1 };
// 3D-only groups, listed for 3D layers only
var WALK_3D = { "ADBE Material Options Group": 1, "ADBE Extrsn Options Group": 1, "ADBE Plane Options Group": 1 };
var WALK_EXPR = 160; // longer expressions are cut (get_keyframes returns them whole)

// Is any layer style turned on? (the Layer Styles group lists all nine styles' settings even when none is)
function stylesOn(g) {
  var i;
  for (i = 1; i <= g.numProperties; i++) if (g.property(i).matchName !== "ADBE Blend Options Group" && safe(function () { return g.property(i).enabled; }) === true) return true;
  return false;
}

// Should walk list p? Hidden splits (X/Y/Z position while not separated), 3D groups on 2D layers and unused layer
// styles are left out by default too.
function walkShows(p, layer) {
  var m = p.matchName;
  if (WALK_SKIP[m]) return false;
  if (WALK_3D[m] && !safe(function () { return layer.threeDLayer; })) return false;
  if (m === "ADBE Layer Styles" && !stylesOn(p)) return false;
  if (/^ADBE Position_\d$/.test(m) && !safe(function () { return p.propertyGroup(1).property("ADBE Position").dimensionsSeparated; })) return false;
  if (p.propertyType !== PropertyType.PROPERTY && p.numProperties === 0) return false;
  return true;
}

// Walk a property group down to maxDepth (list_properties). Groups have type group | indexed_group. Children of an
// indexed group carry their index (paths address them by it); others are addressed by match name. Empty groups and
// the WALK_SKIP groups are left out unless all is set.
function walk(g, depth, maxDepth, time, all) {
  var out = [], i, p, node, v, indexed = g.propertyType === PropertyType.INDEXED_GROUP;
  for (i = 1; i <= g.numProperties; i++) {
    p = g.property(i);
    if (!all && !walkShows(p, layerOf(p))) continue;
    node = { name: p.name, match_name: p.matchName };
    if (indexed) node.index = i;
    if (p.propertyType === PropertyType.PROPERTY) {
      // a property is the node with a value_type (no type field); num_keys only when it is animated
      node.value_type = vt(p); if (p.numKeys) node.num_keys = p.numKeys;
      if (p.canSetExpression && p.expressionEnabled) node.expression = all || p.expression.length <= WALK_EXPR ? p.expression : p.expression.substr(0, 120) + " [cut: " + p.expression.length + " chars, get_keyframes has it all]";
      v = safeVal(p, time); if (v !== undefined) node.value = v;
    } else {
      node.type = p.propertyType === PropertyType.INDEXED_GROUP ? "indexed_group" : "group";
      if (depth < maxDepth) node.children = walk(p, depth + 1, maxDepth, time, all); else node.num_children = p.numProperties;
    }
    out.push(node);
  }
  return out;
}

function maskModeName(mode) { var k; for (k in MASKMODES) { if (MASKMODES.hasOwnProperty(k) && MaskMode[MASKMODES[k]] === mode) return k; } return "unknown"; }
function matteTypeName(t) { var k; for (k in MATTES) { if (MATTES.hasOwnProperty(k) && TrackMatteType[MATTES[k]] === t) return k; } return "none"; }
