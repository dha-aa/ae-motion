// Masks and track mattes. (src/tools/masks.ts)

C.add_mask = function (a) {
  need(a, ["layer_id", "shape"]);
  var l = getLayer(a.layer_id), masks = l.property("ADBE Mask Parade"), s = a.shape, W, H, m, shp, mode, cx, cy;
  if (!masks) fail("BAD_ARGS", "Layer does not support masks");
  W = l.width || l.containingComp.width; H = l.height || l.containingComp.height;
  if (s.type === "rect" || s.type === "ellipse") {
    cx = s.position ? s.position[0] : W / 2; cy = s.position ? s.position[1] : H / 2;
    shp = boxShape(s.type, cx, cy, s.size ? s.size[0] : W, s.size ? s.size[1] : H);
  } else if (s.type === "polygon") {
    if (!(s.points instanceof Array) || s.points.length < 3) fail("BAD_ARGS", "polygon needs at least 3 points");
    shp = mkShape(s.points, null, null, s.closed);
  } else if (s.type === "path") {
    shp = mkShape(s.vertices, s.in_tangents, s.out_tangents, s.closed);
  } else { fail("BAD_ARGS", "shape.type must be rect, ellipse, polygon or path"); }
  if (has(a, "mode")) { mode = MASKMODES[a.mode]; if (!mode) fail("BAD_ARGS", "Unknown mask mode: " + a.mode); }
  m = masks.addProperty("ADBE Mask Atom");
  m.property("ADBE Mask Shape").setValue(shp);
  if (mode) m.maskMode = MaskMode[mode];
  if (has(a, "inverted")) m.inverted = a.inverted;
  if (has(a, "feather_xy")) m.property("ADBE Mask Feather").setValue(a.feather_xy);
  else if (has(a, "feather")) m.property("ADBE Mask Feather").setValue([a.feather, a.feather]);
  if (has(a, "opacity")) m.property("ADBE Mask Opacity").setValue(a.opacity);
  if (has(a, "expansion")) m.property("ADBE Mask Offset").setValue(a.expansion);
  if (a.name) m.name = a.name;
  return { mask_index: m.propertyIndex, name: m.name, path: ["ADBE Mask Parade", m.propertyIndex] };
};

// Using a layer as a matte hides it (its enabled flag becomes false), as in the timeline UI.
C.set_track_matte = function (a) {
  need(a, ["layer_id"]);
  var l = getLayer(a.layer_id), comp = l.containingComp, mt = a.type || "alpha", tm = MATTES[mt], matte;
  if (!tm) fail("BAD_ARGS", "type must be alpha, alpha_inverted, luma or luma_inverted");
  if (!has(a, "matte_layer_id")) {
    l.trackMatteType = TrackMatteType.NO_TRACK_MATTE;
    return { layer: layerInfo(l), matte_layer_id: null };
  }
  matte = getLayer(a.matte_layer_id);
  if (matte.containingComp.id !== comp.id) fail("BAD_ARGS", "Matte layer is in a different comp");
  if (matte.id === l.id) fail("BAD_ARGS", "A layer cannot be its own matte");
  if (typeof l.setTrackMatte === "function") {
    l.setTrackMatte(matte, TrackMatteType[tm]); // After Effects 23+
  } else {
    // older versions use the layer directly above as the matte
    if (l.index === 1 || comp.layer(l.index - 1).id !== matte.id) fail("UNSUPPORTED", "This After Effects version needs the matte layer directly above the target layer", "Use reorder_layer to place the matte directly above it, then retry");
    l.trackMatteType = TrackMatteType[tm];
  }
  return { layer: layerInfo(l), matte_layer_id: matte.id, type: mt };
};
