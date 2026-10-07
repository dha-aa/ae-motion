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
  var l = getLayer(a.layer_id), p = resolvePath(l, a.path), keys = [], i, k, idx;
  if (!p.canVaryOverTime) fail("BAD_ARGS", "Property is not keyframable");
  if (!(a.keys instanceof Array) || !a.keys.length) fail("BAD_ARGS", "keys must be a non-empty array");
  if (p.expressionEnabled) fail("BAD_ARGS", "Property has an active expression", "Clear it with set_expression and an empty expression");
  for (i = 0; i < a.keys.length; i++) {
    k = a.keys[i];
    if (typeof k.t !== "number" || !has(k, "v")) fail("BAD_ARGS", "Each key needs numeric t and a v");
    keys.push({ t: k.t, v: coerce(p, k.v) });
  }
  if (p.matchName === "ADBE Time Remapping") {
    replaceKeys(p, keys, 0); // adds the new keys before removing old ones: removing every key switches time remapping off
  } else {
    // remove first, so no old key's interpolation or ease survives on a key at the same time
    for (i = p.numKeys; i >= 1; i--) p.removeKey(i);
    for (i = 0; i < keys.length; i++) p.setValueAtTime(keys[i].t, keys[i].v);
  }
  for (i = 0; i < a.keys.length; i++) { idx = p.nearestKeyIndex(a.keys[i].t); applyKeyMeta(p, idx, a.keys[i]); }
  return { num_keys: p.numKeys, keys: keyList(p) };
};

// Find the key an edit addresses: by 1-based index, or by time (the key within half a frame of t).
function findKey(p, e, tol) {
  var i;
  if (has(e, "index")) {
    if (e.index < 1 || e.index > p.numKeys) fail("NOT_FOUND", "No key " + e.index + " (the property has " + p.numKeys + ")", "Use get_keyframes");
    return e.index;
  }
  if (!has(e, "t")) fail("BAD_ARGS", "Each edit needs t or index");
  if (!p.numKeys) return 0;
  i = p.nearestKeyIndex(e.t);
  return Math.abs(p.keyTime(i) - e.t) <= tol ? i : 0;
}

// Tangent arrays must match the property's dimensions ([x,y] for 2D position, [x,y,z] for 3D).
function tangentFor(p, v) {
  var n = p.value.length, o = [], i;
  for (i = 0; i < n; i++) o.push(i < v.length ? v[i] : 0);
  return o;
}

// Settings an edit may change on key idx.
function applyEdit(p, idx, e) {
  var spatial = has(e, "spatial_in") || has(e, "spatial_out") || has(e, "auto_bezier") || has(e, "continuous") || has(e, "roving"), si, so;
  applyKeyMeta(p, idx, e);
  if (!spatial) return;
  if (!p.isSpatial) fail("BAD_ARGS", "spatial_in, spatial_out, auto_bezier, continuous and roving only apply to spatial properties (position, anchor point, point of interest)");
  if (has(e, "continuous")) p.setSpatialContinuousAtKey(idx, e.continuous);
  if (has(e, "auto_bezier")) p.setSpatialAutoBezierAtKey(idx, e.auto_bezier);
  if (has(e, "spatial_in") || has(e, "spatial_out")) {
    si = has(e, "spatial_in") ? tangentFor(p, e.spatial_in) : p.keyInSpatialTangent(idx);
    so = has(e, "spatial_out") ? tangentFor(p, e.spatial_out) : p.keyOutSpatialTangent(idx);
    p.setSpatialTangentsAtKey(idx, si, so);
  }
  if (has(e, "roving")) {
    if (e.roving && (idx === 1 || idx === p.numKeys)) fail("BAD_ARGS", "The first and last keys cannot rove");
    p.setRovingAtKey(idx, e.roving);
  }
}

// Edit single keys without rewriting the rest: set (create or update), move (keeps every setting) and delete.
C.edit_keyframes = function (a) {
  need(a, ["layer_id", "path", "edits"]);
  var l = getLayer(a.layer_id), p = resolvePath(l, a.path), tol = l.containingComp.frameDuration / 2, done = [], i, e, idx, k, v;
  if (p.propertyType !== PropertyType.PROPERTY || !p.canVaryOverTime) fail("BAD_ARGS", "Property is not keyframable", "Use list_properties");
  if (!(a.edits instanceof Array) || !a.edits.length) fail("BAD_ARGS", "edits must be a non-empty array");
  for (i = 0; i < a.edits.length; i++) {
    e = a.edits[i];
    idx = findKey(p, e, tol);
    if (e.action === "set") {
      if (!idx) {
        if (!has(e, "t")) fail("NOT_FOUND", "Edit " + i + ": no key to update", "Pass t to create one");
        v = has(e, "v") ? coerce(p, e.v) : p.valueAtTime(e.t, true); // new key: given value, or the value already there
        p.setValueAtTime(e.t, v);
        idx = p.nearestKeyIndex(e.t);
      } else if (has(e, "v")) {
        p.setValueAtTime(p.keyTime(idx), coerce(p, e.v));
      }
      applyEdit(p, idx, e);
      done.push({ edit: i, action: "set", index: idx, t: p.keyTime(idx) });
    } else if (e.action === "move") {
      if (!idx) fail("NOT_FOUND", "Edit " + i + ": no key at t " + e.t, "Use get_keyframes for key times");
      if (!has(e, "to") || e.to < 0) fail("BAD_ARGS", "Edit " + i + ": move needs to (a time of 0 or more)");
      if (findKey(p, { t: e.to }, tol) && findKey(p, { t: e.to }, tol) !== idx) fail("EXISTS", "Edit " + i + ": there is already a key at " + e.to, "Delete it first");
      k = snapKey(p, idx);
      p.removeKey(idx);
      p.setValueAtTime(e.to, k.v);
      idx = p.nearestKeyIndex(e.to);
      restoreKey(p, idx, k);
      restoreRoving(p, idx, k);
      done.push({ edit: i, action: "move", index: idx, t: p.keyTime(idx) });
    } else if (e.action === "delete") {
      if (!idx) fail("NOT_FOUND", "Edit " + i + ": no key at t " + e.t, "Use get_keyframes for key times");
      done.push({ edit: i, action: "delete", t: p.keyTime(idx) });
      p.removeKey(idx);
    } else {
      fail("BAD_ARGS", "Edit " + i + ": action must be set, move or delete");
    }
  }
  k = [];
  for (i = 1; i <= p.numKeys && i <= 500; i++) k.push(keyInfo(p, i));
  return { edits: done, num_keys: p.numKeys, keys: k, expression_active: p.expressionEnabled === true };
};

// Copy one property's animation (every key setting, or the static value, and any expression) to other layers.
C.copy_animation = function (a) {
  need(a, ["from_layer_id", "path", "to_layer_ids"]);
  var src = resolvePath(getLayer(a.from_layer_id), a.path), toPath = has(a, "to_path") ? a.to_path : a.path,
    dt = has(a, "offset_seconds") ? a.offset_seconds : 0, step = has(a, "stagger_seconds") ? a.stagger_seconds : 0, targets = [], out = [], i, l, dst;
  if (src.propertyType !== PropertyType.PROPERTY) fail("BAD_ARGS", "path must point to a property, not a group", "Use list_properties");
  if (!(a.to_layer_ids instanceof Array) || !a.to_layer_ids.length) fail("BAD_ARGS", "to_layer_ids must be a non-empty array");
  // validate every target before changing anything
  for (i = 0; i < a.to_layer_ids.length; i++) {
    l = getLayer(a.to_layer_ids[i]);
    if (l.locked) fail("BAD_ARGS", "Layer " + l.id + " is locked", "Unlock it with set_layer locked:false");
    dst = resolvePath(l, toPath);
    if (dst === src) fail("BAD_ARGS", "A layer cannot copy onto its own property");
    if (dst.propertyValueType !== src.propertyValueType) fail("BAD_ARGS", "Layer " + l.id + ": the target property has a different value type (" + vt(dst) + " vs " + vt(src) + ")");
    if (src.numKeys && src.keyTime(1) + dt + i * step < 0) fail("BAD_ARGS", "The offset would move keys before 0 s");
    targets.push({ layer: l, prop: dst });
  }
  for (i = 0; i < targets.length; i++) {
    dst = targets[i].prop;
    if (dst.expressionEnabled && !src.expressionEnabled) dst.expression = "";
    copyAnimation(src, dst, dt + i * step);
    if (src.expressionEnabled) dst.expression = src.expression;
    out.push({ layer_id: targets[i].layer.id, num_keys: dst.numKeys, offset: dt + i * step });
  }
  return { copied: out, keys_per_layer: src.numKeys, expression: src.expressionEnabled ? src.expression : null };
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
  return { staggered: ids.length };
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
