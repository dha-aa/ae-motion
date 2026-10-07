// Properties, keyframes, expressions, effects, presets and shape modifiers. (src/tools/animate.ts)

var MODIFIERS = { trim_paths: "ADBE Vector Filter - Trim", repeater: "ADBE Vector Filter - Repeater", round_corners: "ADBE Vector Filter - RC" };

C.set_property = function (a) {
  need(a, ["layer_id", "path", "value"]);
  var l = getLayer(a.layer_id), p = resolvePath(l, a.path), v = coerce(p, a.value), rv;
  if (has(a, "time")) {
    if (!p.canVaryOverTime) fail("BAD_ARGS", "Property is not keyframable");
    p.setValueAtTime(a.time, v);
  } else {
    if (p.numKeys > 0) fail("BAD_ARGS", "Property is animated; pass time to set a value at a time, or use set_keyframes");
    p.setValue(v);
  }
  rv = safeVal(p, has(a, "time") ? a.time : 0);
  return { value: rv === undefined ? null : rv, num_keys: p.numKeys };
};

C.set_keyframes = function (a) {
  need(a, ["layer_id", "path", "keys"]);
  var l = getLayer(a.layer_id), p = resolvePath(l, a.path), vals = [], i, j, k, idx, oldT, ix, same;
  if (!p.canVaryOverTime) fail("BAD_ARGS", "Property is not keyframable");
  if (!(a.keys instanceof Array) || !a.keys.length) fail("BAD_ARGS", "keys must be a non-empty array");
  if (p.expressionEnabled) fail("BAD_ARGS", "Property has an active expression", "Clear it with set_expression and an empty expression");
  for (i = 0; i < a.keys.length; i++) {
    k = a.keys[i];
    if (typeof k.t !== "number" || !has(k, "v")) fail("BAD_ARGS", "Each key needs numeric t and a v");
    vals.push(coerce(p, k.v));
  }
  if (p.matchName === "ADBE Time Remapping") {
    // removing every key switches time remapping off, so add the new keys first and drop the old ones afterwards
    oldT = [];
    for (i = 1; i <= p.numKeys; i++) oldT.push(p.keyTime(i));
    for (i = 0; i < a.keys.length; i++) p.setValueAtTime(a.keys[i].t, vals[i]);
    for (j = 0; j < oldT.length; j++) {
      same = false;
      for (i = 0; i < a.keys.length; i++) if (Math.abs(a.keys[i].t - oldT[j]) < 0.0001) same = true;
      if (same) continue;
      ix = p.nearestKeyIndex(oldT[j]);
      if (Math.abs(p.keyTime(ix) - oldT[j]) < 0.0001) p.removeKey(ix);
    }
  } else {
    for (i = p.numKeys; i >= 1; i--) p.removeKey(i);
    for (i = 0; i < a.keys.length; i++) p.setValueAtTime(a.keys[i].t, vals[i]);
  }
  for (i = 0; i < a.keys.length; i++) { idx = p.nearestKeyIndex(a.keys[i].t); applyKeyMeta(p, idx, a.keys[i]); }
  return { num_keys: p.numKeys, keys: keyList(p) };
};

C.set_expression = function (a) {
  need(a, ["layer_id", "path"]);
  var l = getLayer(a.layer_id), p = resolvePath(l, a.path), ex = a.expression || "", err;
  if (!p.canSetExpression) fail("BAD_ARGS", "Property does not support expressions");
  p.expression = ex;
  if (!ex) return { valid: true, enabled: false };
  err = p.expressionError;
  return { valid: !err, error: err || null, enabled: p.expressionEnabled };
};

// Returns the new property's path: indexed groups (e.g. text animators) are addressed by index, others by match name.
C.add_property = function (a) {
  need(a, ["layer_id", "match_name"]);
  var l = getLayer(a.layer_id), hasGroup = has(a, "group_path") && a.group_path.length, g = hasGroup ? resolvePath(l, a.group_path) : l, np, path;
  if (!g.canAddProperty(a.match_name)) fail("BAD_ARGS", "Cannot add '" + a.match_name + "' there", "Check the group_path and match name with list_properties (text animators: group ADBE Text Animators, match ADBE Text Animator; selectors ADBE Text Selectors / ADBE Text Selector; animator properties such as ADBE Text Position 3D, ADBE Text Opacity)");
  np = g.addProperty(a.match_name);
  path = hasGroup ? (typeof a.group_path === "string" ? [a.group_path] : a.group_path.slice(0)) : [];
  path.push(g.propertyType === PropertyType.INDEXED_GROUP ? np.propertyIndex : np.matchName);
  return { name: np.name, match_name: np.matchName, path: path };
};

// Set named / match-named / 1-based-index parameters on a newly added effect or modifier; on any failure remove it again.
function setParams(owner, params, what, numericKeys) {
  var key, p, errs = [];
  for (key in params) {
    if (!params.hasOwnProperty(key)) continue;
    try {
      p = owner.property(numericKeys && /^\d+$/.test(key) ? parseInt(key, 10) : key);
      if (!p) throw new Error("no such parameter");
      p.setValue(coerce(p, params[key]));
    } catch (e) { errs.push(key + ": " + (e && e.message ? e.message : String(e))); }
  }
  if (errs.length) { owner.remove(); fail("BAD_ARGS", what + " params failed: " + errs.join("; "), "Use list_properties on an existing " + what.toLowerCase() + " to see parameter names"); }
}

C.apply_effect = function (a) {
  need(a, ["layer_id", "match_name"]);
  var l = getLayer(a.layer_id), parade = l.property("ADBE Effect Parade"), fx;
  if (!parade) fail("BAD_ARGS", "Layer does not support effects");
  if (!parade.canAddProperty(a.match_name)) fail("NOT_FOUND", "Unknown effect match name: " + a.match_name, "Use find_effects");
  fx = parade.addProperty(a.match_name);
  if (a.name) fx.name = a.name;
  if (a.params) setParams(fx, a.params, "Effect", true);
  return { effect_index: fx.propertyIndex, name: fx.name, match_name: fx.matchName };
};

C.edit_effect = function (a) {
  need(a, ["layer_id", "effect_index", "action"]);
  var l = getLayer(a.layer_id), fx = l.property("ADBE Effect Parade"), e, info;
  if (!fx || a.effect_index < 1 || a.effect_index > fx.numProperties) fail("NOT_FOUND", "No effect at index " + a.effect_index, "Use get_layer to list effects");
  e = fx.property(a.effect_index);
  info = { index: a.effect_index, name: e.name, match_name: e.matchName };
  if (a.action === "remove") e.remove();
  else if (a.action === "enable") e.enabled = true;
  else if (a.action === "disable") e.enabled = false;
  else fail("BAD_ARGS", "action must be remove, enable or disable");
  return { effect: info, action: a.action, remaining: fx.numProperties };
};

C.apply_preset = function (a) {
  need(a, ["layer_id", "ffx_path"]);
  var l = getLayer(a.layer_id), f = new File(a.ffx_path);
  if (!f.exists) fail("NOT_FOUND", "Preset not found: " + a.ffx_path);
  l.applyPreset(f);
  return layerInfo(l);
};

C.stagger = function (a) {
  need(a, ["layer_ids", "path", "offset_seconds"]);
  var ids = copyArr(a.layer_ids), props = [], i, p;
  if (a.order === "reverse") ids.reverse();
  for (i = 0; i < ids.length; i++) {
    p = resolvePath(getLayer(ids[i]), a.path);
    if (!p.numKeys) fail("BAD_ARGS", "Layer " + ids[i] + " has no keyframes on that property");
    props.push(p);
  }
  for (i = 1; i < props.length; i++) shiftKeys(props[i], i * a.offset_seconds);
  return { staggered: ids.length, note: "Spatial tangents are not preserved" };
};

C.add_shape_modifier = function (a) {
  need(a, ["layer_id", "modifier"]);
  var l = getLayer(a.layer_id), mn = MODIFIERS[a.modifier], gi = has(a, "group_index") ? a.group_index : 1, root, m, props = [], i;
  if (!mn) fail("BAD_ARGS", "modifier must be trim_paths, repeater or round_corners");
  if (!(l instanceof ShapeLayer)) fail("BAD_ARGS", "Layer is not a shape layer");
  root = l.property("ADBE Root Vectors Group");
  if (gi < 1 || gi > root.numProperties) fail("NOT_FOUND", "Shape group " + gi + " not found", "Add a shape with add_layer first");
  m = root.property(gi).property("ADBE Vectors Group").addProperty(mn);
  if (a.params) setParams(m, a.params, "Modifier", false);
  for (i = 1; i <= m.numProperties; i++) props.push({ name: m.property(i).name, match_name: m.property(i).matchName });
  return { path: ["ADBE Root Vectors Group", gi, "ADBE Vectors Group", m.propertyIndex], match_name: m.matchName, properties: props };
};
