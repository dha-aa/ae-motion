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

function layerInfo(l) {
  return {
    id: l.id, index: l.index, name: l.name, kind: layerKind(l),
    "in": l.inPoint, "out": l.outPoint, start: l.startTime,
    parent_id: l.parent ? l.parent.id : null, enabled: l.enabled, comp_id: l.containingComp.id,
    locked: l.locked, shy: l.shy, solo: l.solo, label: l.label,
    three_d: safe(function () { return l.threeDLayer; }), stretch: safe(function () { return l.stretch; }),
    // cameras and lights have neither
    blend_mode: safe(function () { return blendModeName(l.blendingMode); }), motion_blur: safe(function () { return l.motionBlur; })
  };
}

function compInfo(c, withLayers) {
  var o = {
    id: c.id, name: c.name, width: c.width, height: c.height, fps: c.frameRate, duration: c.duration,
    pixel_aspect: c.pixelAspect, bg_color: [c.bgColor[0], c.bgColor[1], c.bgColor[2]], num_layers: c.numLayers,
    work_area_start: c.workAreaStart, work_area_duration: c.workAreaDuration, time: c.time,
    motion_blur: c.motionBlur, shutter_angle: c.shutterAngle, shutter_phase: c.shutterPhase, frame_blending: c.frameBlending,
    num_markers: safe(function () { return c.markerProperty.numKeys; })
  };
  if (withLayers) { o.layers = []; for (var i = 1; i <= c.numLayers; i++) o.layers.push(layerInfo(c.layer(i))); }
  return o;
}

function itemInfo(it) {
  var o = { id: it.id, name: it.name, type: it instanceof CompItem ? "comp" : (it instanceof FolderItem ? "folder" : "footage") };
  if (it instanceof CompItem || it instanceof FootageItem) { o.width = it.width; o.height = it.height; o.duration = it.duration; }
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
function safeVal(p, time) {
  var t = p.propertyValueType, V = PropertyValueType, v;
  try {
    if (t === V.TEXT_DOCUMENT) return p.value.text;
    if (t === V.SHAPE) return shapeToJson(p.valueAtTime(time, false));
    if (t === V.OneD || t === V.TwoD || t === V.ThreeD || t === V.COLOR || t === V.TwoD_SPATIAL || t === V.ThreeD_SPATIAL || t === V.LAYER_INDEX || t === V.MASK_INDEX) {
      v = p.canVaryOverTime ? p.valueAtTime(time, false) : p.value;
      return v instanceof Array ? copyArr(v) : v;
    }
  } catch (e) {}
  return undefined;
}

// Walk a property group down to maxDepth (list_properties).
function walk(g, depth, maxDepth, time) {
  var out = [], i, p, node, v;
  for (i = 1; i <= g.numProperties; i++) {
    p = g.property(i);
    node = { name: p.name, match_name: p.matchName, index: i };
    if (p.propertyType === PropertyType.PROPERTY) {
      node.type = "property"; node.value_type = vt(p); node.num_keys = p.numKeys;
      if (p.canSetExpression && p.expressionEnabled) node.expression = p.expression;
      v = safeVal(p, time); if (v !== undefined) node.value = v;
    } else {
      node.type = p.propertyType === PropertyType.INDEXED_GROUP ? "indexed_group" : "group";
      if (depth < maxDepth) node.children = walk(p, depth + 1, maxDepth, time); else node.num_children = p.numProperties;
    }
    out.push(node);
  }
  return out;
}

function maskModeName(mode) { var k; for (k in MASKMODES) { if (MASKMODES.hasOwnProperty(k) && MaskMode[MASKMODES[k]] === mode) return k; } return "unknown"; }
function matteTypeName(t) { var k; for (k in MATTES) { if (MATTES.hasOwnProperty(k) && TrackMatteType[MATTES[k]] === t) return k; } return "none"; }
