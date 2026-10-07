// Design commands: alignment, anchor points, shapes, layer styles, text to shapes. (src/tools/design.ts)
// Geometry helpers live in core/layout.jsx; shape building in core/shapes.jsx.

// Layer styles: tool name -> [menu command id (Layer > Layer Styles), property group match name]. Scripts cannot add
// styles directly, so the menu command runs on the selected layer; the ids were checked in After Effects 26.3.
var LAYER_STYLES = {
  drop_shadow: [9000, "dropShadow"], inner_shadow: [9001, "innerShadow"], outer_glow: [9002, "outerGlow"], inner_glow: [9003, "innerGlow"],
  bevel_emboss: [9004, "bevelEmboss"], satin: [9005, "chromeFX"], color_overlay: [9006, "solidFill"], gradient_overlay: [9007, "gradientFill"],
  stroke: [9008, "frameFX"]
};
var ANCHORS = {
  top_left: [0, 0], top: [0.5, 0], top_right: [1, 0], left: [0, 0.5], center: [0.5, 0.5], right: [1, 0.5],
  bottom_left: [0, 1], bottom: [0.5, 1], bottom_right: [1, 1]
};

// Select exactly this layer (menu commands act on the selection) in its comp, opened in the viewer.
function selectOnly(l) {
  var c = l.containingComp, i;
  c.openInViewer();
  for (i = 1; i <= c.numLayers; i++) c.layer(i).selected = false;
  l.selected = true;
}

function runMenu(name, fallbackId) {
  var id = app.findMenuCommandId(name) || fallbackId; // names are localized; the id is the fallback
  if (!id) fail("UNSUPPORTED", "This After Effects version has no menu command named " + name);
  app.executeCommand(id);
}

C.align_layers = function (a) {
  need(a, ["layer_ids"]);
  var ls = pickLayers(a.layer_ids), comp = sameComp(ls), t = has(a, "time") ? a.time : 0, m = has(a, "margin") ? a.margin : 0,
    al = a.align, dist = a.distribute, b = [], tr, i, o, dx, dy, order, first, last, out = [];
  if (!al && !dist) fail("BAD_ARGS", "Pass align and/or distribute");
  if (al && " left right h_center top bottom v_center center ".indexOf(" " + al + " ") === -1) fail("BAD_ARGS", "align must be left, h_center, right, top, v_center, bottom or center");
  if (dist && dist !== "horizontal" && dist !== "vertical") fail("BAD_ARGS", "distribute must be horizontal or vertical");
  if (dist && ls.length < 3) fail("BAD_ARGS", "distribute needs at least 3 layers");
  assertUnlocked(ls);
  for (i = 0; i < ls.length; i++) {
    b.push(compBounds(ls[i], t));
    if (!b[i]) fail("UNSUPPORTED", "Layer " + ls[i].id + " is 3D (or a camera/light, or has a 3D parent): its screen position depends on the camera", "Align 2D layers, or place 3D layers with set_3d");
  }
  if (a.to === "layer") {
    need(a, ["to_layer_id"]);
    o = getLayer(a.to_layer_id);
    if (o.containingComp.id !== comp.id) fail("BAD_ARGS", "to_layer_id is in a different comp");
    tr = compBounds(o, t);
    if (!tr) fail("UNSUPPORTED", "The target layer is 3D, a camera or a light");
  } else if (a.to === "selection") {
    tr = { left: b[0].left, top: b[0].top, right: b[0].right, bottom: b[0].bottom };
    for (i = 1; i < b.length; i++) { tr.left = Math.min(tr.left, b[i].left); tr.top = Math.min(tr.top, b[i].top); tr.right = Math.max(tr.right, b[i].right); tr.bottom = Math.max(tr.bottom, b[i].bottom); }
  } else {
    tr = { left: 0, top: 0, right: comp.width, bottom: comp.height };
  }
  for (i = 0; i < ls.length; i++) {
    dx = 0; dy = 0;
    if (al === "left") dx = tr.left + m - b[i].left;
    else if (al === "right") dx = tr.right - m - b[i].right;
    else if (al === "h_center" || al === "center") dx = (tr.left + tr.right) / 2 - b[i].center[0];
    if (al === "top") dy = tr.top + m - b[i].top;
    else if (al === "bottom") dy = tr.bottom - m - b[i].bottom;
    else if (al === "v_center" || al === "center") dy = (tr.top + tr.bottom) / 2 - b[i].center[1];
    if (dx || dy) { moveOnScreen(ls[i], dx, dy, t); b[i] = compBounds(ls[i], t); }
  }
  if (dist) {
    o = dist === "horizontal" ? 0 : 1;
    order = [];
    for (i = 0; i < ls.length; i++) order.push(i);
    order.sort(function (x, y) { return b[x].center[o] - b[y].center[o]; });
    first = b[order[0]].center[o]; last = b[order[order.length - 1]].center[o];
    // even spacing of centers between the outermost layers, which stay put
    for (i = 1; i < order.length - 1; i++) {
      dx = first + (last - first) * i / (order.length - 1) - b[order[i]].center[o];
      if (Math.abs(dx) > 1e-9) moveOnScreen(ls[order[i]], o === 0 ? dx : 0, o === 1 ? dx : 0, t);
    }
  }
  for (i = 0; i < ls.length; i++) out.push({ layer_id: ls[i].id, name: ls[i].name, bounds: compBounds(ls[i], t) });
  return { time: t, layers: out };
};

// Move the anchor point onto the content (center, a corner or an edge) or to a point, keeping the layer in place.
C.set_anchor = function (a) {
  need(a, ["layer_id"]);
  var l = getLayer(a.layer_id), t = has(a, "time") ? a.time : 0, an = tp(l, "ADBE Anchor Point"), r, f, na, oa, d;
  if (l instanceof CameraLayer || l instanceof LightLayer) fail("BAD_ARGS", "Cameras and lights have no anchor point");
  if (an.numKeys > 0 || an.expressionEnabled) fail("BAD_ARGS", "The anchor point is animated or driven by an expression");
  if (has(a, "point")) na = [a.point[0], a.point[1]];
  else {
    f = ANCHORS[a.anchor || "center"];
    if (!f) fail("BAD_ARGS", "anchor must be center, top_left, top, top_right, left, right, bottom_left, bottom or bottom_right");
    r = contentRect(l, t);
    na = [r.left + r.width * f[0], r.top + r.height * f[1]];
  }
  oa = an.value;
  if (a.keep_position !== false) {
    if (l.threeDLayer && (tp(l, "ADBE Rotate X").value || tp(l, "ADBE Rotate Y").value || tp(l, "ADBE Orientation").value.toString() !== "0,0,0")) {
      fail("UNSUPPORTED", "keep_position on a 3D layer with X/Y rotation or orientation is not supported", "Pass keep_position: false, or zero those rotations first");
    }
    // the layer moves by the anchor change mapped through its own rotation and scale (in its parent's space)
    d = mApplyLinear(layerMatrix(l, t), na[0] - oa[0], na[1] - oa[1]);
    offsetPosition(l, d[0], d[1]);
  }
  an.setValue(oa.length > 2 ? [na[0], na[1], oa[2]] : na);
  return { layer: layerInfo(l), anchor: copyArr(an.value), position: copyArr(tp(l, "ADBE Position").value), bounds: compBounds(l, t) };
};

// Add a shape group (on top of the existing ones) to a shape layer.
C.add_shape = function (a) {
  need(a, ["layer_id", "shape"]);
  var l = getLayer(a.layer_id), root, g, base = ["ADBE Root Vectors Group", 1, "ADBE Vectors Group"], res;
  if (!(l instanceof ShapeLayer)) fail("BAD_ARGS", "Layer is not a shape layer", "Create one with add_layer kind shape");
  root = l.property("ADBE Root Vectors Group");
  g = addShapeContent(l, a.shape);
  res = { group_index: 1, name: g.name, groups: root.numProperties, path_group: base };
  g.moveTo(1); // moving invalidates g: read everything needed first
  if (a.shape.type === "path") res.path = base.concat([1, "ADBE Vector Shape"]);
  return res;
};

// Run Layer > Create > Create Shapes from Text: a new shape layer with the outlines appears above; the text layer is turned off.
C.text_to_shapes = function (a) {
  need(a, ["layer_id"]);
  var l = getLayer(a.layer_id), c = l.containingComp, n0 = c.numLayers, made;
  if (!(l instanceof TextLayer)) fail("BAD_ARGS", "Layer is not a text layer");
  selectOnly(l);
  runMenu("Create Shapes from Text", 3781);
  if (c.numLayers !== n0 + 1 || l.index < 2) fail("AE_ERROR", "After Effects did not create the outline layer");
  made = c.layer(l.index - 1);
  return { shape_layer: layerInfo(made), groups: made.property("ADBE Root Vectors Group").numProperties, text_layer: layerInfo(l) };
};

// Turn on a layer style and set its parameters (property names without the style prefix, e.g. distance, color).
C.add_layer_style = function (a) {
  need(a, ["layer_id", "style"]);
  var l = getLayer(a.layer_id), s = LAYER_STYLES[a.style], ls, g, key, p, names = [], i, errs = [];
  if (!s) fail("BAD_ARGS", "style must be one of drop_shadow, inner_shadow, outer_glow, inner_glow, bevel_emboss, satin, color_overlay, gradient_overlay, stroke");
  ls = l.property("ADBE Layer Styles");
  if (!ls) fail("BAD_ARGS", "This layer cannot have layer styles");
  g = ls.property(s[1] + "/enabled");
  for (i = 1; i <= g.numProperties; i++) names.push(g.property(i).matchName.replace(s[1] + "/", ""));
  // check parameter names first (the style's properties exist even while it is off), so a typo changes nothing
  if (a.params) {
    for (key in a.params) {
      if (a.params.hasOwnProperty(key) && !safe(function () { return g.property(s[1] + "/" + key); })) errs.push(key);
    }
    if (errs.length) fail("BAD_ARGS", "Unknown " + a.style + " parameter(s): " + errs.join(", "), "Valid names: " + names.join(", "));
  }
  if (!g.enabled || !ls.enabled) {
    selectOnly(l);
    app.executeCommand(s[0]);
    ls = l.property("ADBE Layer Styles"); g = ls.property(s[1] + "/enabled"); // menu commands can invalidate references
  }
  if (!g.enabled) fail("AE_ERROR", "After Effects did not turn on the " + a.style + " style");
  if (a.params) {
    for (key in a.params) {
      if (!a.params.hasOwnProperty(key)) continue;
      p = g.property(s[1] + "/" + key);
      try { p.setValue(coerce(p, a.params[key])); } catch (e) { errs.push(key + ": " + (e && e.message ? e.message : String(e))); }
    }
    if (errs.length) fail("BAD_ARGS", "Style params failed: " + errs.join("; "), "Valid names: " + names.join(", "));
  }
  if (a.enabled === false) g.enabled = false;
  return { style: a.style, enabled: g.enabled, path: ["ADBE Layer Styles", s[1] + "/enabled"], parameters: names };
};
