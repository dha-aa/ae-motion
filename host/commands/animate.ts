// Properties, keyframes, expressions, effects, presets and shape modifiers. (src/tools/animate.ts)

var MODIFIERS = { trim_paths: "ADBE Vector Filter - Trim", repeater: "ADBE Vector Filter - Repeater", round_corners: "ADBE Vector Filter - RC" };

// One layer (layer_id) or the same property of many (layer_ids). Every layer is resolved and checked before any
// value changes, so a bad path on layer 7 leaves layers 1-6 untouched.
C.set_property = function (a: Args["set_property"]) {
  need(a, ["path", "value"]);
  var many = has(a, "layer_ids"), ids: number[], props: Prop[] = [], vals: any[] = [], i, p, rv;
  if (many === has(a, "layer_id")) fail("BAD_ARGS", "Pass layer_id or layer_ids (not both)", "layer_ids sets the same property on many layers");
  ids = many ? a.layer_ids! : [a.layer_id!];
  if (!(ids instanceof Array) || ids.length === 0) fail("BAD_ARGS", "layer_ids must list at least one layer");
  for (i = 0; i < ids.length; i++) {
    p = resolvePath(getLayer(ids[i]), a.path);
    var at = many ? " (layer " + ids[i] + ")" : "";
    if (has(a, "time") && !p.canVaryOverTime) fail("BAD_ARGS", "Property is not keyframable" + at, "Leave out time to set a static value");
    if (!has(a, "time") && p.numKeys > 0) fail("BAD_ARGS", "Property is animated" + at + "; pass time to set a value at a time, or use set_keyframes");
    props.push(p); vals.push(coerce(p, a.value));
  }
  for (i = 0; i < props.length; i++) {
    if (has(a, "time")) props[i].setValueAtTime(a.time, vals[i]); else props[i].setValue(vals[i]);
  }
  if (many) return { set: ids.length };
  rv = safeVal(props[0], has(a, "time") ? a.time! : 0);
  return { value: rv === undefined ? null : rv, num_keys: props[0].numKeys };
};

C.set_keyframes = function (a: Args["set_keyframes"]) {
  need(a, ["layer_id", "path", "keys"]);
  var l = getLayer(a.layer_id), p = resolvePath(l, a.path), keys = [], i, j, k, idx, merge = a.merge === true, replaced = 0,
    tol = l.containingComp.frameDuration / 2, res: Obj;
  if (!p.canVaryOverTime) fail("BAD_ARGS", "Property is not keyframable", "Set it with set_property (no time); list_properties shows which properties have keys");
  if (!(a.keys instanceof Array) || !a.keys.length) fail("BAD_ARGS", "keys must be a non-empty array");
  // keys go under a duck expression (it adds to them); any other expression is refused
  if (isDuck(p)) { for (i = 0; i < a.keys.length; i++) { if (SPRINGS[a.keys[i].interp!]) fail("BAD_ARGS", "interp " + a.keys[i].interp + " would replace the music's ducking expression", "Use bezier or linear keys on a ducked volume"); } }
  else if (springList(p) === null) fail("BAD_ARGS", "Property has an active expression", "Clear it with set_expression and an empty expression");
  if (p.expressionEnabled && !merge && !isDuck(p)) p.expression = ""; // a spring expression is rebuilt from the new keys
  for (i = 0; i < a.keys.length; i++) {
    k = a.keys[i];
    if (typeof k.t !== "number" || !has(k, "v")) fail("BAD_ARGS", "Each key needs numeric t and a v");
    keys.push({ t: k.t, v: coerce(p, k.v) });
  }
  if (merge) {
    // keys at other times stay (with their springs); a key within half a frame of a new one is replaced
    for (i = 0; i < keys.length; i++) {
      for (j = p.numKeys; j >= 1; j--) { if (Math.abs(p.keyTime(j) - keys[i].t) <= tol) { p.removeKey(j); replaced++; } }
      removeSpring(p, keys[i].t);
      p.setValueAtTime(keys[i].t, keys[i].v);
    }
  } else if (p.matchName === "ADBE Time Remapping") {
    replaced = p.numKeys;
    replaceKeys(p, keys, 0); // adds the new keys before removing old ones: removing every key switches time remapping off
  } else {
    // remove first, so no old key's interpolation or ease survives on a key at the same time
    replaced = p.numKeys;
    for (i = p.numKeys; i >= 1; i--) p.removeKey(i);
    for (i = 0; i < keys.length; i++) p.setValueAtTime(keys[i].t, keys[i].v);
  }
  for (i = 0; i < a.keys.length; i++) { idx = p.nearestKeyIndex(a.keys[i].t); applyKeyMeta(p, idx, a.keys[i]); }
  // the keys as they are now (values, interpolation, ease, springs), so no get_keyframes is needed to check them
  res = { num_keys: p.numKeys, keys: [] };
  for (i = 0; i < a.keys.length; i++) res.keys.push(keyInfo(p, p.nearestKeyIndex(a.keys[i].t)));
  echoIfFits(res);
  // say when earlier keys went: replacing a property's whole animation by accident is easy to miss
  if (replaced) res.replaced = replaced;
  return res;
};

// The keys a call set are echoed so no get_keyframes is needed, unless the echo would pass the response limit: the
// keys are in After Effects by then, and an error for the size of the reply read as a failed call (it was retried).
function echoIfFits(res: Obj): Obj {
  if (jsonSize(res) > KEYS_ROOM) { res.keys_set = res.keys.length; delete res.keys; res.note = "Keys set; too many to list here (get_keyframes reads them)"; }
  return res;
}

// Find the key an edit addresses: by 1-based index, or by time (the key within half a frame of t).
type KeyEdit = Args["edit_keyframes"]["edits"][number];

function findKey(p: Prop, e: { index?: number; t?: number }, tol: number): number {
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
function tangentFor(p: Prop, v: number[]): number[] {
  var n = p.value.length, o: number[] = [], i;
  for (i = 0; i < n; i++) o.push(i < v.length ? v[i] : 0);
  return o;
}

// Settings an edit may change on key idx.
function applyEdit(p: Prop, idx: number, e: KeyEdit): void {
  var spatial = has(e, "spatial_in") || has(e, "spatial_out") || has(e, "auto_bezier") || has(e, "continuous") || has(e, "roving"), si, so;
  applyKeyMeta(p, idx, e);
  if (!spatial) return;
  if (!p.isSpatial) fail("BAD_ARGS", "spatial_in, spatial_out, auto_bezier, continuous and roving only apply to spatial properties (position, anchor point, point of interest)");
  if (has(e, "continuous")) p.setSpatialContinuousAtKey(idx, e.continuous);
  if (has(e, "auto_bezier")) p.setSpatialAutoBezierAtKey(idx, e.auto_bezier);
  if (has(e, "spatial_in") || has(e, "spatial_out")) {
    si = has(e, "spatial_in") ? tangentFor(p, e.spatial_in) : p.keyInSpatialTangent(idx);
    so = has(e, "spatial_out") ? tangentFor(p, e.spatial_out) : p.keyOutSpatialTangent(idx);
    p.setSpatialTangentsAtKey(idx, si as [number, number], so as [number, number]);
  }
  if (has(e, "roving")) {
    if (e.roving && (idx === 1 || idx === p.numKeys)) fail("BAD_ARGS", "The first and last keys cannot rove");
    p.setRovingAtKey(idx, e.roving);
  }
}

// Edit single keys without rewriting the rest: set (create or update), move (keeps every setting) and delete.
C.edit_keyframes = function (a: Args["edit_keyframes"]) {
  need(a, ["layer_id", "path", "edits"]);
  var l = getLayer(a.layer_id), p = resolvePath(l, a.path), tol = l.containingComp.frameDuration / 2, done: Obj[] = [], i, e, idx, k: any, v: { [index: number]: boolean };
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
      k = snapKey(p, idx); k.spring = springAt(p, k.t);
      if (k.spring) removeSpring(p, k.t);
      p.removeKey(idx);
      p.setValueAtTime(e.to, k.v);
      idx = p.nearestKeyIndex(e.to);
      restoreKey(p, idx, k);
      restoreRoving(p, idx, k);
      if (k.spring) addSpring(p, e.to, k.spring);
      done.push({ edit: i, action: "move", index: idx, t: p.keyTime(idx) });
    } else if (e.action === "delete") {
      if (!idx) fail("NOT_FOUND", "Edit " + i + ": no key at t " + e.t, "Use get_keyframes for key times");
      done.push({ edit: i, action: "delete", t: p.keyTime(idx) });
      removeSpring(p, p.keyTime(idx));
      p.removeKey(idx);
    } else {
      fail("BAD_ARGS", "Edit " + i + ": action must be set, move or delete");
    }
  }
  // the keys that were set or moved, as they are now (get_keyframes lists all of them)
  // (found again by time: later edits can shift indices). Each key is listed once.
  k = []; v = {};
  for (i = 0; i < done.length; i++) {
    if (done[i].action === "delete" || p.numKeys === 0) continue;
    idx = p.nearestKeyIndex(done[i].t); done[i].index = idx;
    if (!v[idx]) { v[idx] = true; k.push(keyInfo(p, idx)); }
  }
  return echoIfFits({ edits: done, num_keys: p.numKeys, keys: k, expression_active: p.expressionEnabled === true });
};

// Copy one property's animation (every key setting, or the static value, and any expression) to other layers.
C.copy_animation = function (a: Args["copy_animation"]) {
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
    if (dst.propertyValueType !== src.propertyValueType) fail("BAD_ARGS", "Layer " + l.id + ": the target property has a different value type (" + vt(dst) + " vs " + vt(src) + ")", "Pick a to_path of the same type (list_properties shows value_type)");
    if (src.numKeys && src.keyTime(1) + dt + i * step < 0) fail("BAD_ARGS", "The offset would move keys before 0 s", "Use a later offset_seconds");
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

// One layer (layer_id) or many (layer_ids): every property is found and checked before any expression is set.
C.set_expression = function (a: Args["set_expression"]) {
  need(a, ["path"]);
  var many = has(a, "layer_ids"), ids = many ? a.layer_ids! : [a.layer_id as number], ex = a.expression || "", props = [], bad = [], i, p, err;
  if (many === has(a, "layer_id")) fail("BAD_ARGS", "Pass layer_id or layer_ids (not both)");
  if (!(ids instanceof Array) || ids.length === 0) fail("BAD_ARGS", "layer_ids must list at least one layer");
  for (i = 0; i < ids.length; i++) {
    p = resolvePath(getLayer(ids[i]), a.path);
    if (!p.canSetExpression) fail("BAD_ARGS", "Property does not support expressions" + (many ? " (layer " + ids[i] + ")" : ""), "Groups and some settings cannot take one; list_properties shows the property tree");
    props.push(p);
  }
  for (i = 0; i < props.length; i++) {
    props[i].expression = ex;
    err = ex ? props[i].expressionError : "";
    if (err) bad.push({ layer_id: ids[i], error: err });
  }
  if (!many) return ex ? { valid: !err, error: err || null, enabled: props[0].expressionEnabled } : { valid: true, enabled: false };
  return bad.length ? { set: ids.length, valid: false, errors: bad } : { set: ids.length, valid: true };
};

// Returns the new property's path: indexed groups (e.g. text animators) are addressed by index, others by match name.
C.add_property = function (a: Args["add_property"]) {
  need(a, ["layer_id", "match_name"]);
  var l = getLayer(a.layer_id), hasGroup = has(a, "group_path") && a.group_path.length, g = hasGroup ? resolvePath<PropertyGroup>(l, a.group_path!) : l, np, path;
  if (!g.canAddProperty(a.match_name)) fail("BAD_ARGS", "Cannot add '" + a.match_name + "' there", "Check the group_path and match name with list_properties (text animators: group ADBE Text Animators, match ADBE Text Animator; selectors ADBE Text Selectors / ADBE Text Selector; animator properties such as ADBE Text Position 3D, ADBE Text Opacity)");
  np = g.addProperty(a.match_name);
  path = hasGroup ? (typeof a.group_path === "string" ? [a.group_path] : a.group_path!.slice(0)) : [];
  path.push(g.propertyType === PropertyType.INDEXED_GROUP ? np.propertyIndex : np.matchName);
  return { name: np.name, match_name: np.matchName, path: path };
};

// Set named / match-named / 1-based-index parameters on a newly added effect or modifier; on any failure remove it again.
function setParams(owner: PropertyBase, params: { [name: string]: any }, what: string, numericKeys?: boolean): void {
  var key, p, errs: string[] = [];
  for (key in params) {
    if (!params.hasOwnProperty(key)) continue;
    try {
      p = owner.property(numericKeys && /^\d+$/.test(key) ? parseInt(key, 10) : key);
      if (!p) throw new Error("no such parameter");
      p.setValue(coerce(p, params[key]));
    } catch (e: any) { errs.push(key + ": " + (e && e.message ? e.message : String(e))); }
  }
  if (errs.length) { owner.remove(); fail("BAD_ARGS", what + " params failed: " + errs.join("; "), "Use list_properties on an existing " + what.toLowerCase() + " to see parameter names"); }
}

// Change an existing effect's params: every name and value is checked before any changes, and unlike setParams the
// effect stays when one is wrong (it was there before this call).
function setEffectParams(e: PropertyGroup, params: { [name: string]: any }): void {
  var key: string, p: any, errs: string[] = [], todo: { p: any; v: any }[] = [], i;
  for (key in params) {
    if (!params.hasOwnProperty(key)) continue;
    try {
      p = e.property(/^\d+$/.test(key) ? parseInt(key, 10) : key);
      if (!p) throw new Error("no such parameter");
      todo.push({ p: p, v: coerce(p, params[key]) });
    } catch (x: any) { errs.push(key + ": " + (x && x.message ? x.message : String(x))); }
  }
  if (errs.length) fail("BAD_ARGS", "Effect params failed, nothing changed: " + errs.join("; "), "list_properties shows the names");
  for (i = 0; i < todo.length; i++) {
    if (todo[i].p.numKeys > 0) fail("BAD_ARGS", todo[i].p.name + " is keyframed", "Use set_keyframes or edit_keyframes");
  }
  for (i = 0; i < todo.length; i++) todo[i].p.setValue(todo[i].v);
}

// Effects whose "Repeat Edge Pixels" switch (by match name: names are localized) comes on when a script adds them.
// With it on, the blur is cut off at the layer's own box: right for a layer that fills the frame (no dark edges),
// wrong for an element (a blurred glow, cloud or shadow gets hard rectangular edges). Verified in After Effects 26.5.
var REPEAT_EDGE: { [effect: string]: string } = { "ADBE Gaussian Blur 2": "ADBE Gaussian Blur 2-0003" };

// Turn Repeat Edge Pixels off on an effect just added to a layer smaller than the frame (text, shapes, small solids
// and footage), unless the caller set it. True if it was turned off.
function softEdges(l: AVLayer, fx: any, params?: { [name: string]: any }): boolean {
  var m = REPEAT_EDGE[fx.matchName], c = l.containingComp, k, p;
  if (!m) return false;
  if (params) { for (k in params) { if (params.hasOwnProperty(k) && (k === m || k === "3" || /repeat edge/i.test(k))) return false; } }
  if (!(l instanceof TextLayer || l instanceof ShapeLayer || l.width < c.width || l.height < c.height)) return false;
  p = safe(function () { return fx.property(m); });
  if (!p || !p.value) return false;
  p.setValue(0);
  return true;
}

C.apply_effect = function (a: Args["apply_effect"]) {
  need(a, ["layer_id", "match_name"]);
  var l = getLayer(a.layer_id), parade = l.property("ADBE Effect Parade"), fx, res: Obj;
  if (!parade) fail("BAD_ARGS", "Layer does not support effects", "Effects go on solid, footage, text, shape, adjustment and precomp layers");
  if (!parade.canAddProperty(a.match_name)) fail("NOT_FOUND", "Unknown effect match name: " + a.match_name, "Use find_effects");
  fx = parade.addProperty(a.match_name);
  if (a.name) fx.name = a.name;
  if (a.params) setParams(fx, a.params, "Effect", true);
  res = { effect_index: fx.propertyIndex, name: fx.name, match_name: fx.matchName };
  if (softEdges(l, fx, a.params)) res.repeat_edge_pixels = false; // said, because it differs from what After Effects would have left
  return res;
};

C.edit_effect = function (a: Args["edit_effect"]) {
  need(a, ["layer_id", "effect_index", "action"]);
  var l = getLayer(a.layer_id), fx = l.property("ADBE Effect Parade"), e, info;
  if (!fx || a.effect_index < 1 || a.effect_index > fx.numProperties) fail("NOT_FOUND", "No effect at index " + a.effect_index, "Use get_layer to list effects");
  e = fx.property(a.effect_index);
  info = { index: a.effect_index, name: e.name, match_name: e.matchName };
  if (a.action === "set") {
    if (!a.params) fail("BAD_ARGS", "action set needs params", "e.g. params: {Contrast: 150}; list_properties shows the names");
    setEffectParams(e, a.params);
    return { effect: info, action: a.action, params: a.params };
  }
  if (a.action === "remove") e.remove();
  else if (a.action === "enable") e.enabled = true;
  else if (a.action === "disable") e.enabled = false;
  else fail("BAD_ARGS", "action must be remove, enable, disable or set");
  return { effect: info, action: a.action, remaining: fx.numProperties };
};

C.apply_preset = function (a: Args["apply_preset"]) {
  need(a, ["layer_id", "ffx_path"]);
  var l = getLayer(a.layer_id), f = new File(a.ffx_path);
  if (!f.exists) fail("NOT_FOUND", "Preset not found: " + a.ffx_path, "Pass the full path of an existing .ffx file");
  l.applyPreset(f);
  return layerRef(l);
};

C.stagger = function (a: Args["stagger"]) {
  need(a, ["layer_ids", "path", "offset_seconds"]);
  var ids = copyArr(a.layer_ids), props = [], i, p;
  if (a.order === "reverse") ids.reverse();
  for (i = 0; i < ids.length; i++) {
    p = resolvePath(getLayer(ids[i]), a.path);
    if (!p.numKeys) fail("BAD_ARGS", "Layer " + ids[i] + " has no keyframes on that property", "stagger offsets existing keys: animate the property first (set_keyframes or animate)");
    props.push(p);
  }
  for (i = 1; i < props.length; i++) shiftKeys(props[i], i * a.offset_seconds);
  return { staggered: ids.length };
};

C.add_shape_modifier = function (a: Args["add_shape_modifier"]) {
  need(a, ["layer_id", "modifier"]);
  var l = getLayer(a.layer_id), mn = MODIFIERS[a.modifier], gi = has(a, "group_index") ? a.group_index : 1, root, m, props = [], i;
  if (!mn) fail("BAD_ARGS", "modifier must be trim_paths, repeater or round_corners");
  if (!(l instanceof ShapeLayer)) fail("BAD_ARGS", "Layer is not a shape layer", "Shape modifiers go on shape layers (add_layer kind shape)");
  root = l.property("ADBE Root Vectors Group");
  if (gi < 1 || gi > root.numProperties) fail("NOT_FOUND", "Shape group " + gi + " not found", "Add a shape with add_layer first");
  m = root.property(gi).property("ADBE Vectors Group").addProperty(mn);
  if (a.params) setParams(m, a.params, "Modifier", false);
  for (i = 1; i <= m.numProperties; i++) props.push({ name: m.property(i).name, match_name: m.property(i).matchName });
  return { path: ["ADBE Root Vectors Group", gi, "ADBE Vectors Group", m.propertyIndex], match_name: m.matchName, properties: props };
};
