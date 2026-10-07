// Values, keyframes and easing.

// The layer a property belongs to.
function layerOf(prop) { return prop.propertyGroup(prop.propertyDepth); }

// Check a value can be set on prop and convert it (3-value colors get an alpha; shape specs become Shapes).
/** @param {Property<any>} prop @param {any} v @returns {any} */
function coerce(prop, v) {
  var t = prop.propertyValueType, V = PropertyValueType, l;
  if (t === V.TEXT_DOCUMENT) fail("BAD_ARGS", "Text properties are set with set_text");
  if (t === V.SHAPE) {
    if (!v || typeof v !== "object" || v instanceof Array) fail("BAD_ARGS", "A path property takes a shape: {type: rect|ellipse, position?, size?}, {type: polygon, points} or {type: path, vertices, in_tangents?, out_tangents?, closed?}");
    l = layerOf(prop);
    return shapeFromSpec(v, l.width || l.containingComp.width, l.height || l.containingComp.height);
  }
  if (t === V.NO_VALUE || t === V.CUSTOM_VALUE || t === V.MARKER) fail("BAD_ARGS", "Property type '" + vt(prop) + "' cannot be set with this tool", "Use run_jsx if AE_MCP_ALLOW_JSX=1");
  if (t === V.COLOR && v instanceof Array && v.length === 3) return rgba(v);
  return v;
}

// "easy" (After Effects' Easy Ease) or {speed, influence}.
function mkEase(spec) {
  if (spec === "easy") return new KeyframeEase(0, 33.333333);
  var inf = spec.influence === undefined ? 33.333333 : spec.influence;
  inf = Math.max(0.1, Math.min(100, inf));
  return new KeyframeEase(spec.speed === undefined ? 0 : spec.speed, inf);
}

// Apply a key spec's interp / ease_in / ease_out to the key at idx. Easing implies bezier.
function applyKeyMeta(prop, idx, k) {
  var interp = k.interp, typ, dims, inE, outE, e, d;
  if ((k.ease_in || k.ease_out) && !interp) interp = "bezier";
  if (interp) {
    typ = interp === "linear" ? KeyframeInterpolationType.LINEAR : (interp === "hold" ? KeyframeInterpolationType.HOLD : KeyframeInterpolationType.BEZIER);
    prop.setInterpolationTypeAtKey(idx, typ, typ);
  }
  if (k.ease_in || k.ease_out) {
    // spatial properties take one ease; other multi-dimensional properties take one per dimension
    dims = prop.isSpatial ? 1 : (prop.value instanceof Array ? prop.value.length : 1);
    inE = prop.keyInTemporalEase(idx); outE = prop.keyOutTemporalEase(idx);
    if (k.ease_in) { e = mkEase(k.ease_in); inE = []; for (d = 0; d < dims; d++) inE.push(e); }
    if (k.ease_out) { e = mkEase(k.ease_out); outE = []; for (d = 0; d < dims; d++) outE.push(e); }
    prop.setTemporalEaseAtKey(idx, inE, outE);
  }
}

// Compact {t, v} list (first 200 keys), returned by set_keyframes.
function keyList(prop) {
  var out = [], i, v;
  for (i = 1; i <= prop.numKeys && i <= 200; i++) {
    v = prop.keyValue(i);
    out.push({ t: prop.keyTime(i), v: v instanceof Array ? copyArr(v) : v });
  }
  return out;
}

// ---------- full-fidelity key snapshots ----------
// A snapshot holds everything about a key: value, interpolation, temporal ease and continuity, and for spatial
// properties the motion-path tangents, auto-bezier, continuity and roving. Each read and write is guarded because
// not every property type supports every attribute.

function snapKey(p, i) {
  var k = { t: p.keyTime(i), v: p.keyValue(i) };
  try { k.ii = p.keyInInterpolationType(i); k.oi = p.keyOutInterpolationType(i); } catch (e1) {}
  try { k.ie = p.keyInTemporalEase(i); k.oe = p.keyOutTemporalEase(i); } catch (e2) {}
  try { k.tc = p.keyTemporalContinuous(i); k.ta = p.keyTemporalAutoBezier(i); } catch (e3) {}
  if (p.isSpatial) {
    try { k.si = p.keyInSpatialTangent(i); k.so = p.keyOutSpatialTangent(i); } catch (e4) {}
    try { k.sc = p.keySpatialContinuous(i); k.sa = p.keySpatialAutoBezier(i); } catch (e5) {}
    try { k.rov = p.keyRoving(i); } catch (e6) {}
  }
  return k;
}

function snapAll(p) { var out = [], i; for (i = 1; i <= p.numKeys; i++) out.push(snapKey(p, i)); return out; }

// Apply a snapshot's settings (not its value or time) to key idx. Roving is applied separately (restoreRoving),
// after every key exists, because After Effects only allows it between other keys.
// Ease goes before the interpolation type: setting an ease switches a linear key to bezier.
function restoreKey(p, idx, k) {
  if (k.ie) { try { p.setTemporalEaseAtKey(idx, k.ie, k.oe); } catch (e2) {} }
  if (k.ii !== undefined) { try { p.setInterpolationTypeAtKey(idx, k.ii, k.oi); } catch (e1) {} }
  if (k.tc !== undefined) { try { p.setTemporalContinuousAtKey(idx, k.tc); p.setTemporalAutoBezierAtKey(idx, k.ta); } catch (e3) {} }
  if (p.isSpatial) {
    if (k.sc !== undefined) { try { p.setSpatialContinuousAtKey(idx, k.sc); p.setSpatialAutoBezierAtKey(idx, k.sa); } catch (e4) {} }
    // explicit tangents only when the key was not auto-bezier (setting tangents switches auto-bezier off)
    if (k.si && !k.sa) { try { p.setSpatialTangentsAtKey(idx, k.si, k.so); } catch (e5) {} }
  }
}

function restoreRoving(p, idx, k) {
  if (k.rov) { try { p.setRovingAtKey(idx, true); } catch (e) {} }
}

// Make keys the only keys on p, moved by dt seconds, with all their settings. New keys are added before old ones
// are removed, because removing every key switches some properties off (time remapping).
function replaceKeys(p, keys, dt) {
  var oldT = [], i, j, same, ix, idx = [];
  // roving keys re-time themselves whenever other keys change, so pin them first or they cannot be found again
  if (p.isSpatial) for (i = 1; i <= p.numKeys; i++) { try { if (p.keyRoving(i)) p.setRovingAtKey(i, false); } catch (e) {} }
  for (i = 1; i <= p.numKeys; i++) oldT.push(p.keyTime(i));
  for (i = 0; i < keys.length; i++) p.setValueAtTime(keys[i].t + dt, keys[i].v);
  for (j = 0; j < oldT.length; j++) {
    same = false;
    for (i = 0; i < keys.length; i++) if (Math.abs(keys[i].t + dt - oldT[j]) < 0.0001) same = true;
    if (same) continue;
    ix = p.nearestKeyIndex(oldT[j]);
    if (Math.abs(p.keyTime(ix) - oldT[j]) < 0.0001) p.removeKey(ix);
  }
  for (i = 0; i < keys.length; i++) { idx.push(p.nearestKeyIndex(keys[i].t + dt)); restoreKey(p, idx[i], keys[i]); }
  for (i = 0; i < keys.length; i++) restoreRoving(p, idx[i], keys[i]);
}

// Move every key on p by dt seconds, keeping all key settings.
function shiftKeys(p, dt) { replaceKeys(p, snapAll(p), dt); }

// A key as JSON for get_keyframes / edit_keyframes (the same field names edit_keyframes accepts).
function keyInfo(p, i) {
  var k = { index: i, t: p.keyTime(i), v: keyVal(p, i), interp_in: interpName(p.keyInInterpolationType(i)), interp_out: interpName(p.keyOutInterpolationType(i)) };
  try { k.ease_in = easeList(p.keyInTemporalEase(i)); k.ease_out = easeList(p.keyOutTemporalEase(i)); } catch (e1) {}
  if (p.isSpatial) {
    try { k.spatial_in = copyArr(p.keyInSpatialTangent(i)); k.spatial_out = copyArr(p.keyOutSpatialTangent(i)); } catch (e2) {}
    try { k.auto_bezier = p.keySpatialAutoBezier(i); k.continuous = p.keySpatialContinuous(i); } catch (e3) {}
    try { k.roving = p.keyRoving(i); } catch (e4) {}
  }
  return k;
}

// A key's value as JSON (text documents become their text; unserializable types become undefined).
function keyVal(p, i) {
  var t = p.propertyValueType, V = PropertyValueType, v;
  if (t === V.TEXT_DOCUMENT) return p.keyValue(i).text;
  if (t === V.SHAPE) return shapeToJson(p.keyValue(i));
  if (t === V.NO_VALUE || t === V.CUSTOM_VALUE || t === V.MARKER) return undefined;
  v = p.keyValue(i);
  return v instanceof Array ? copyArr(v) : v;
}

function interpName(t) {
  if (t === KeyframeInterpolationType.LINEAR) return "linear";
  if (t === KeyframeInterpolationType.HOLD) return "hold";
  return "bezier";
}

function easeList(arr) { var o = [], i; for (i = 0; i < arr.length; i++) o.push({ speed: arr[i].speed, influence: arr[i].influence }); return o; }

// Set a static value (time null/undefined) or a keyframe at time.
function setAt(p, v, t) {
  if (t !== null && t !== undefined) {
    if (!p.canVaryOverTime) fail("BAD_ARGS", "Property is not keyframable");
    p.setValueAtTime(t, v);
  } else {
    if (p.numKeys > 0) fail("BAD_ARGS", "Property is animated; pass time to set a keyframe", "Use camera_move or set_keyframes to change animation");
    p.setValue(v);
  }
}

function clearKeysBetween(p, t0, t1) {
  var i;
  for (i = p.numKeys; i >= 1; i--) if (p.keyTime(i) >= t0 - EPS && p.keyTime(i) <= t1 + EPS) p.removeKey(i);
}

// Insert keys {t, v} (replacing any existing keys inside their time range).
// Sampled keys use linear timing because the easing is already in the values.
function putKeys(p, keys, easing, sampled) {
  var i, idx, n = keys.length, lin = KeyframeInterpolationType.LINEAR;
  clearKeysBetween(p, keys[0].t, keys[n - 1].t);
  for (i = 0; i < n; i++) p.setValueAtTime(keys[i].t, keys[i].v);
  for (i = 0; i < n; i++) {
    idx = p.nearestKeyIndex(keys[i].t);
    if (sampled || easing === "linear") {
      p.setInterpolationTypeAtKey(idx, lin, lin);
    } else if (n >= 2) {
      if (i === 0 && (easing === "ease_in" || easing === "ease_in_out")) applyKeyMeta(p, idx, { ease_out: "easy" });
      if (i === n - 1 && (easing === "ease_out" || easing === "ease_in_out")) applyKeyMeta(p, idx, { ease_in: "easy" });
    }
  }
  return n;
}

// Copy src's keys (with every key setting), or its static value, onto dst, moved by dt seconds (default 0).
// dst's own keys are replaced.
function copyAnimation(src, dst, dt) {
  if (src.numKeys === 0) {
    while (dst.numKeys > 0) dst.removeKey(dst.numKeys);
    dst.setValue(src.value);
    return;
  }
  replaceKeys(dst, snapAll(src), dt || 0);
}
