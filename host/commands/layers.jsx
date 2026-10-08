// Layer commands: add, edit, link, delete, duplicate, reorder, precompose, replace source. (src/tools/layers.ts)

var FRAMEBLEND = { off: "NO_FRAME_BLEND", frame_mix: "FRAME_MIX", pixel_motion: "PIXEL_MOTION" };
var QUALITY = { best: "BEST", draft: "DRAFT", wireframe: "WIREFRAME" };

C.add_layer = function (a) {
  need(a, ["comp_id", "kind"]);
  var comp = getComp(a.comp_id), o = a.options || {}, kind = a.kind, dur = has(o, "duration") ? o.duration : comp.duration,
    center = o.center || [comp.width / 2, comp.height / 2], l, item, col, size, lt;
  if (kind === "shape" && o.shape && o.shape.type && " rect ellipse star polygon path ".indexOf(" " + o.shape.type + " ") === -1) fail("BAD_ARGS", "shape.type must be rect, ellipse, star, polygon or path");
  if (kind === "light" && o.light_type) {
    lt = LIGHTTYPES[o.light_type];
    if (!lt) fail("BAD_ARGS", "light_type must be point, spot, parallel or ambient");
  }
  if (kind === "footage" || kind === "precomp") { need(o, ["item_id"]); item = getItem(o.item_id); }
  if (kind === "shape" && o.shape) checkShapeSpec(o.shape);
  if (kind === "solid" || kind === "adjustment") {
    col = o.color || [1, 1, 1]; size = o.size || [comp.width, comp.height];
    l = comp.layers.addSolid([col[0], col[1], col[2]], o.name || (kind === "solid" ? "Solid" : "Adjustment Layer"), size[0], size[1], 1, dur);
    if (kind === "adjustment") l.adjustmentLayer = true;
  } else if (kind === "text") {
    l = o.box_size ? comp.layers.addBoxText([o.box_size[0], o.box_size[1]], has(o, "text") ? o.text : "Text") : comp.layers.addText(has(o, "text") ? o.text : "Text");
  } else if (kind === "shape") {
    l = comp.layers.addShape(); l.name = "Shape Layer";
    if (o.shape) addShapeContent(l, o.shape);
  } else if (kind === "null") {
    l = comp.layers.addNull(dur);
  } else if (kind === "footage" || kind === "precomp") {
    l = comp.layers.add(item);
  } else if (kind === "camera") {
    l = comp.layers.addCamera(o.name || "Camera 1", center);
    centerLayer(l, center);
  } else if (kind === "light") {
    l = comp.layers.addLight(o.name || "Light 1", [center[0], center[1]]);
    centerLayer(l, center);
    if (lt) l.lightType = LightType[lt];
  } else { fail("BAD_ARGS", "Unknown layer kind: " + kind); }
  if (o.name) l.name = o.name;
  if (has(o, "three_d")) l.threeDLayer = o.three_d;
  if (has(o, "position")) setLayerPosition(l, o.position);
  if (has(o, "start")) l.startTime = o.start;
  if (has(o, "in")) setIn(l, o["in"]);
  if (has(o, "out")) l.outPoint = o.out;
  return layerRef(l);
};

C.set_layer = function (a) {
  need(a, ["layer_id"]);
  var l = getLayer(a.layer_id), par, bm;
  // validate before changing anything
  if (has(a, "blend_mode")) {
    bm = BlendingMode[String(a.blend_mode).toUpperCase().replace(/ /g, "_")];
    if (bm === undefined) fail("BAD_ARGS", "Unknown blend mode: " + a.blend_mode);
  }
  if (has(a, "parent_id")) par = getLayer(a.parent_id);
  if (has(a, "auto_orient") && a.auto_orient !== "path" && a.auto_orient !== "off") fail("BAD_ARGS", "auto_orient must be path or off");
  if (has(a, "auto_orient") && (l instanceof CameraLayer || l instanceof LightLayer)) fail("BAD_ARGS", "For cameras and lights use set_camera two_node / point_of_interest");
  if (has(a, "frame_blending") && !FRAMEBLEND[a.frame_blending]) fail("BAD_ARGS", "frame_blending must be off, frame_mix or pixel_motion");
  if (has(a, "quality") && !QUALITY[a.quality]) fail("BAD_ARGS", "quality must be best, draft or wireframe");
  if ((has(a, "solid_color") || has(a, "solid_size")) && !(l.source && l.source.mainSource instanceof SolidSource)) fail("BAD_ARGS", "solid_color and solid_size need a solid (or adjustment / null) layer");
  // unlock first and lock last, so the other edits in the same call can be applied
  if (a.locked === false) l.locked = false;
  if (has(a, "name")) l.name = a.name;
  if (has(a, "stretch")) { if (!a.stretch) fail("BAD_ARGS", "stretch cannot be 0"); l.stretch = a.stretch; }
  if (has(a, "three_d")) l.threeDLayer = a.three_d;
  if (has(a, "shy")) l.shy = a.shy;
  if (has(a, "solo")) l.solo = a.solo;
  if (has(a, "label")) l.label = a.label;
  if (has(a, "motion_blur")) l.motionBlur = a.motion_blur;
  if (has(a, "time_remap")) { if (!l.canSetTimeRemapEnabled) fail("BAD_ARGS", "This layer cannot use time remapping"); l.timeRemapEnabled = a.time_remap; }
  if (has(a, "start")) l.startTime = a.start;
  if (has(a, "in")) setIn(l, a["in"]);
  if (has(a, "out")) l.outPoint = a.out;
  if (has(a, "enabled")) l.enabled = a.enabled;
  // separated position is addressed as x_position / y_position / z_position (ADBE Position_0/1/2)
  if (has(a, "separate_dimensions")) tp(l, "ADBE Position").dimensionsSeparated = a.separate_dimensions;
  if (has(a, "frame_blending")) { try { l.frameBlendingType = FrameBlendingType[FRAMEBLEND[a.frame_blending]]; } catch (e1) { fail("BAD_ARGS", "This layer has no frame blending (only footage and precomp layers do)"); } }
  if (has(a, "quality")) l.quality = LayerQuality[QUALITY[a.quality]];
  if (has(a, "collapse")) { try { l.collapseTransformation = a.collapse; } catch (e2) { fail("BAD_ARGS", "This layer cannot collapse transformations (only precomp and vector layers can)"); } }
  if (has(a, "guide")) l.guideLayer = a.guide;
  if (has(a, "adjustment")) l.adjustmentLayer = a.adjustment;
  if (has(a, "effects")) l.effectsActive = a.effects;
  if (has(a, "audio")) { try { l.audioEnabled = a.audio; } catch (e3) { fail("BAD_ARGS", "This layer has no audio"); } }
  if (has(a, "preserve_transparency")) l.preserveTransparency = a.preserve_transparency;
  // a solid's color and size live on its source item, so every layer using that solid changes
  if (has(a, "solid_color")) l.source.mainSource.color = [a.solid_color[0], a.solid_color[1], a.solid_color[2]];
  if (has(a, "solid_size")) { l.source.width = a.solid_size[0]; l.source.height = a.solid_size[1]; }
  if (has(a, "auto_orient")) l.autoOrient = a.auto_orient === "path" ? AutoOrientType.ALONG_PATH : AutoOrientType.NO_AUTO_ORIENT;
  if (bm !== undefined) l.blendingMode = bm;
  if (a.parent_id === null) l.parent = null; else if (par) l.parent = par;
  if (a.locked === true) l.locked = true;
  return layerFieldsSet(l, a);
};

// parent = x keeps the layer where it is on screen (After Effects compensates); setParentWithJump keeps its own values.
C.link_layers = function (a) {
  need(a, ["layer_ids"]);
  var ids = a.layer_ids, layers = [], seen = {}, i, l, comp = null, par = null, nn = null, byId = has(a, "parent_id"), unlink = (a.parent_id === null),
    anc, top, sum = [0, 0, 0], v, any3 = false, pos, made = null, out = [];
  if (!(ids instanceof Array) || ids.length === 0) fail("BAD_ARGS", "layer_ids must be a non-empty array");
  if (has(a, "new_null")) nn = a.new_null === true ? {} : a.new_null;
  if (((byId || unlink) ? 1 : 0) + (nn ? 1 : 0) !== 1) fail("BAD_ARGS", "Pass exactly one of parent_id (a layer id, or null to unlink) and new_null");
  for (i = 0; i < ids.length; i++) {
    if (seen[ids[i]]) continue;
    seen[ids[i]] = true;
    l = getLayer(ids[i]);
    if (comp === null) comp = l.containingComp;
    else if (l.containingComp.id !== comp.id) fail("BAD_ARGS", "All layers must be in the same composition");
    if (l.locked) fail("BAD_ARGS", "Layer " + l.name + " is locked", "Unlock it with set_layer locked: false");
    layers.push(l);
  }
  // validate everything before changing anything
  if (byId) {
    par = getLayer(a.parent_id);
    if (par.containingComp.id !== comp.id) fail("BAD_ARGS", "The parent is in a different composition");
    if (seen[par.id]) fail("BAD_ARGS", "A layer cannot be its own parent");
    for (anc = par.parent; anc; anc = anc.parent) {
      if (seen[anc.id]) fail("BAD_ARGS", "That would link " + anc.name + " to its own child " + par.name);
    }
  }
  if (nn) {
    top = layers[0];
    for (i = 0; i < layers.length; i++) {
      l = layers[i];
      if (l.threeDLayer === true) any3 = true;
      v = tp(l, "ADBE Position").value;
      sum[0] += v[0]; sum[1] += v[1]; sum[2] += (v.length > 2 ? v[2] : 0);
      if (l.index < top.index) top = l;
    }
    pos = has(nn, "position") ? v3(nn.position) : [sum[0] / layers.length, sum[1] / layers.length, sum[2] / layers.length];
    made = comp.layers.addNull(comp.duration);
    made.name = nn.name || "Link Null";
    if (has(nn, "three_d") ? nn.three_d : (any3 || (has(nn, "position") && nn.position.length > 2))) made.threeDLayer = true;
    setLayerPosition(made, made.threeDLayer ? pos : [pos[0], pos[1]]);
    made.moveBefore(top);
    par = made;
  }
  for (i = 0; i < layers.length; i++) {
    if (par === null) layers[i].parent = null;
    else if (a.jump === true) layers[i].setParentWithJump(par);
    else layers[i].parent = par;
  }
  for (i = 0; i < layers.length; i++) out.push(layerRef(layers[i]));
  return { parent: par ? layerRef(par) : null, created_null: made !== null, layers: out };
};

// Swap the footage / precomp / solid a layer shows, keeping its timing, keyframes and effects.
C.replace_source = function (a) {
  need(a, ["layer_id", "item_id"]);
  var l = getLayer(a.layer_id), it = getItem(a.item_id);
  if (!l.source || l instanceof TextLayer || l instanceof ShapeLayer) fail("BAD_ARGS", "Layer " + l.id + " has no source to replace (only footage, precomp, solid and null layers do)");
  if (!(it instanceof FootageItem || it instanceof CompItem)) fail("BAD_ARGS", "Item " + it.id + " is not footage or a composition");
  if (it === l.containingComp) fail("BAD_ARGS", "A comp cannot contain itself");
  try { l.replaceSource(it, a.fix_expressions !== false); }
  catch (e) { fail("BAD_ARGS", "After Effects refused the replacement: " + (e.message || e), "A precomp cannot contain the comp it is placed in"); }
  return layerRef(l);
};

C.delete_layer = function (a) {
  need(a, ["layer_id"]);
  var l = getLayer(a.layer_id), info = layerRef(l);
  l.remove();
  return { deleted: info };
};

C.duplicate_layer = function (a) {
  need(a, ["layer_id"]);
  var l = getLayer(a.layer_id), n = has(a, "count") ? a.count : 1, out = [], i, d;
  if (n < 1 || n > 50) fail("BAD_ARGS", "count must be 1 to 50");
  for (i = 0; i < n; i++) {
    d = l.duplicate();
    if (a.name) d.name = n === 1 ? a.name : a.name + " " + (i + 1);
    if (has(a, "offset_seconds")) shiftLayer(d, a.offset_seconds * (i + 1));
    out.push(layerTiming(d));
  }
  return { layers: out };
};

C.reorder_layer = function (a) {
  need(a, ["layer_id"]);
  var l = getLayer(a.layer_id), comp = l.containingComp, n = 0, ref, to = a.to;
  if (to !== undefined && to !== null) n++;
  if (has(a, "index")) n++;
  if (has(a, "before_layer_id")) n++;
  if (has(a, "after_layer_id")) n++;
  if (n !== 1) fail("BAD_ARGS", "Pass exactly one of: to, index, before_layer_id, after_layer_id");
  if (has(a, "before_layer_id") || has(a, "after_layer_id")) {
    ref = getLayer(has(a, "before_layer_id") ? a.before_layer_id : a.after_layer_id);
    if (ref.containingComp.id !== comp.id) fail("BAD_ARGS", "Reference layer is in a different comp");
    if (ref.id === l.id) fail("BAD_ARGS", "Reference layer is the same layer");
    if (has(a, "before_layer_id")) l.moveBefore(ref); else l.moveAfter(ref);
  } else if (has(a, "index")) {
    if (a.index < 1 || a.index > comp.numLayers) fail("BAD_ARGS", "index must be 1 to " + comp.numLayers);
    ref = comp.layer(a.index);
    if (ref.id !== l.id) { if (a.index < l.index) l.moveBefore(ref); else l.moveAfter(ref); }
  } else if (to === "top") { l.moveToBeginning();
  } else if (to === "bottom") { l.moveToEnd();
  } else if (to === "up") { if (l.index > 1) l.moveBefore(comp.layer(l.index - 1));
  } else if (to === "down") { if (l.index < comp.numLayers) l.moveAfter(comp.layer(l.index + 1));
  } else { fail("BAD_ARGS", "to must be top, bottom, up or down"); }
  return layerRef(l);
};

C.precompose = function (a) {
  need(a, ["layer_ids", "name"]);
  var ls = pickLayers(a.layer_ids), comp = sameComp(ls), idx = [], i, move = a.move_attributes !== false;
  // "leave all attributes" keeps transforms, effects and masks on the layer; After Effects only allows it for one layer
  if (!move && ls.length !== 1) fail("BAD_ARGS", "move_attributes: false works on a single layer only");
  if (!move && (!ls[0].source || ls[0] instanceof TextLayer || ls[0] instanceof ShapeLayer)) fail("BAD_ARGS", "move_attributes: false needs a layer with a source (footage, solid or precomp); text and shape layers can only move their attributes");
  for (i = 0; i < ls.length; i++) idx.push(ls[i].index);
  idx.sort(function (x, y) { return x - y; });
  return compInfo(comp.layers.precompose(idx, a.name, move), true);
};
