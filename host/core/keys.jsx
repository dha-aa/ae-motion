// Values, keyframes and easing.

// The layer a property belongs to.
function layerOf(prop) { return prop.propertyGroup(prop.propertyDepth); }

// Check a value can be set on prop and convert it (3-value colors get an alpha; shape specs become Shapes).
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

// Move every key on p by dt seconds, keeping interpolation and temporal ease (spatial tangents are lost).
function shiftKeys(p, dt) {
  var n = p.numKeys, ks = [], i, k, idx;
  for (i = 1; i <= n; i++) {
    k = { t: p.keyTime(i), v: p.keyValue(i), ii: p.keyInInterpolationType(i), oi: p.keyOutInterpolationType(i) };
    try { k.ie = p.keyInTemporalEase(i); k.oe = p.keyOutTemporalEase(i); } catch (e) {}
    ks.push(k);
  }
  for (i = n; i >= 1; i--) p.removeKey(i);
  for (i = 0; i < ks.length; i++) p.setValueAtTime(ks[i].t + dt, ks[i].v);
  for (i = 0; i < ks.length; i++) {
    idx = p.nearestKeyIndex(ks[i].t + dt);
    try { p.setInterpolationTypeAtKey(idx, ks[i].ii, ks[i].oi); } catch (e1) {}
    if (ks[i].ie) { try { p.setTemporalEaseAtKey(idx, ks[i].ie, ks[i].oe); } catch (e2) {} }
  }
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

// Copy src's keys (with interpolation and ease), or its static value, onto dst.
function copyAnimation(src, dst) {
  var i, n = src.numKeys;
  if (n === 0) { dst.setValue(src.value); return; }
  for (i = 1; i <= n; i++) dst.setValueAtTime(src.keyTime(i), src.keyValue(i));
  for (i = 1; i <= n; i++) {
    try { dst.setInterpolationTypeAtKey(i, src.keyInInterpolationType(i), src.keyOutInterpolationType(i)); } catch (e1) {}
    try { dst.setTemporalEaseAtKey(i, src.keyInTemporalEase(i), src.keyOutTemporalEase(i)); } catch (e2) {}
  }
}
