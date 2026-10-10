// Values, keyframes and easing.

/** A keyframable property. Its value type depends on the property, so values are "any" here. */
type Prop = Property<any>;
/** "easy" (After Effects' Easy Ease) or a temporal ease. */
type EaseSpec = "easy" | { speed?: number; influence?: number };
/** The key options set_keyframes / edit_keyframes take. */
interface KeyMeta { interp?: string; ease_in?: EaseSpec; ease_out?: EaseSpec }
/** A sprung segment in a spring expression: [start time, a, b, fold]. */
type SpringSeg = number[];
/** Everything about one key (snapKey), to put it back exactly (restoreKey). */
interface KeySnap {
  t: number; v: any; ii?: KeyframeInterpolationType; oi?: KeyframeInterpolationType; ie?: KeyframeEase[]; oe?: KeyframeEase[];
  tc?: boolean; ta?: boolean; si?: number[]; so?: number[]; sc?: boolean; sa?: boolean; rov?: boolean;
  /** edit_keyframes move: the segment's spring kind, to move it with the key. */
  spring?: string;
}
/** A key as JSON (get_keyframes, edit_keyframes). */
interface KeyInfo {
  index: number; t: number; v: any; interp_in: string; interp_out: string; ease_in?: EaseJson; ease_out?: EaseJson;
  spatial_in?: number[]; spatial_out?: number[]; auto_bezier?: boolean; continuous?: boolean; roving?: boolean;
}
type EaseJson = "easy" | { speed: number; influence: number } | { speed: number; influence: number }[];

// The layer a property belongs to.
function layerOf(prop: PropertyBase): AVLayer { return prop.propertyGroup(prop.propertyDepth) as AVLayer; }

// Check a value can be set on prop and convert it (3-value colors get an alpha; shape specs become Shapes).
function coerce(prop: Prop, v: any): any {
  var t = prop.propertyValueType, V = PropertyValueType, l;
  if (t === V.TEXT_DOCUMENT) fail("BAD_ARGS", "Text properties are set with set_text");
  if (t === V.SHAPE) {
    if (!v || typeof v !== "object" || v instanceof Array) fail("BAD_ARGS", "A path property takes a shape: {type: rect|ellipse, position?, size?}, {type: polygon, points} or {type: path, vertices, in_tangents?, out_tangents?, closed?}");
    l = layerOf(prop);
    return shapeFromSpec(v, l.width || l.containingComp.width, l.height || l.containingComp.height);
  }
  if (t === V.NO_VALUE || t === V.CUSTOM_VALUE || t === V.MARKER) fail("BAD_ARGS", "Property type '" + vt(prop) + "' cannot be set with this tool", "Use run_jsx if AE_MCP_ALLOW_JSX=1");
  if (t === V.COLOR && v instanceof Array && v.length === 3) return rgba(v);
  if (typeof v === "number" && prop.matchName === "ADBE Audio Levels") return [v, v];
  return v;
}

// ---------- springs ----------
// A spring (or bounce) segment runs from a key to the next one as a closed-form step response, in one expression
// per property marked // ae-motion spring; its S list names the sprung segments by their first key's time. Values
// are pure functions of time, the keys stay linear, and other segments keep their own easing.

var SPRING_TAG = "// ae-motion spring";
// Step responses: x(u) = 1 - e^(-a u) cos(b u), normalised so x(1) = 1. spring overshoots about 13 % once and
// settles; bounce folds the cosine (|.|) so the value hits the target and bounces back off it, like a dropped object
// (b = 4.5 pi puts cos(b) = 0 at the end, so it lands exactly and never passes the target).
var SPRINGS: { [kind: string]: number[] } = { spring: [6, 9.42, 0], bounce: [5, 14.137, 1] };

// The expression a spring property carries; S lists the springy segments as [start time, a, b, fold].
function springExpr(S: SpringSeg[]): string {
  return SPRING_TAG + "\nvar S=" + JSON.stringify(S) + ";\n" +
    "var n=0,y=value;\n" +
    "if(numKeys>1){n=nearestKey(time).index;if(key(n).time>time)n--;}\n" +
    "if(n>=1&&n<numKeys){var t0=key(n).time,t1=key(n+1).time,j,m=-1;\n" +
    "for(j=0;j<S.length;j++)if(Math.abs(S[j][0]-t0)<0.001)m=j;\n" +
    "if(m>=0){var a=S[m][1],b=S[m][2],u=(time-t0)/(t1-t0),e=Math.exp(-a*u)*Math.cos(b*u),E=Math.exp(-a)*Math.cos(b);\n" +
    "if(S[m][3]){e=Math.abs(e);E=Math.abs(E);}\n" +
    "y=add(key(n).value,mul(sub(key(n+1).value,key(n).value),(1-e)/(1-E)));}}\ny";
}

// The spring segments already on p (from its expression), or null if p has some other expression.
function springList(p: Prop): SpringSeg[] | null {
  var m;
  if (!p.expressionEnabled || !p.expression) return [];
  if (p.expression.indexOf(SPRING_TAG) !== 0) return null;
  m = /var S=(\[.*\]);/.exec(p.expression);
  return m ? JSON.parse(m[1]) : [];
}

function addSpring(p: Prop, t0: number, kind: string): void {
  var S = springList(p) || [], out: SpringSeg[] = [], i, sp = SPRINGS[kind];
  for (i = 0; i < S.length; i++) if (Math.abs(S[i][0] - t0) >= 0.001) out.push(S[i]);
  out.push([Math.round(t0 * 1e6) / 1e6, sp[0], sp[1], sp[2]]);
  out.sort(function (x, y) { return x[0] - y[0]; });
  p.expression = springExpr(out);
}

// Stop the segment starting at t0 from springing (the expression goes when no segment is left).
function removeSpring(p: Prop, t0: number): void {
  var S = springList(p), out: SpringSeg[] = [], i;
  if (!S || !S.length) return;
  for (i = 0; i < S.length; i++) if (Math.abs(S[i][0] - t0) >= 0.001) out.push(S[i]);
  p.expression = out.length ? springExpr(out) : "";
}

// "spring" / "bounce" if the segment starting at t0 springs, else "".
function springAt(p: Prop, t0: number): string {
  var S = springList(p), i;
  for (i = 0; S && i < S.length; i++) if (Math.abs(S[i][0] - t0) < 0.001) return S[i][3] ? "bounce" : "spring";
  return "";
}

// "easy" (After Effects' Easy Ease) or {speed, influence}.
function mkEase(spec: EaseSpec): KeyframeEase {
  if (spec === "easy") return new KeyframeEase(0, 33.333333);
  var inf = spec.influence === undefined ? 33.333333 : spec.influence;
  inf = Math.max(0.1, Math.min(100, inf));
  return new KeyframeEase(spec.speed === undefined ? 0 : spec.speed, inf);
}

// Apply a key spec's interp / ease_in / ease_out to the key at idx. Easing implies bezier.
function applyKeyMeta(prop: Prop, idx: number, k: KeyMeta): void {
  var interp = k.interp, typ, dims, inE: KeyframeEase[], outE: KeyframeEase[], e, d;
  if (SPRINGS[interp!]) {
    if (springList(prop) === null) fail("BAD_ARGS", "interp " + interp + " needs the property's expression slot, which holds another expression", "Clear it with set_expression and an empty expression");
    prop.setInterpolationTypeAtKey(idx, KeyframeInterpolationType.LINEAR, KeyframeInterpolationType.LINEAR);
    if (idx < prop.numKeys) prop.setInterpolationTypeAtKey(idx + 1, prop.keyInInterpolationType(idx + 1) === KeyframeInterpolationType.HOLD ? KeyframeInterpolationType.HOLD : KeyframeInterpolationType.LINEAR, prop.keyOutInterpolationType(idx + 1));
    addSpring(prop, prop.keyTime(idx), interp!);
    return;
  }
  if (interp && springAt(prop, prop.keyTime(idx))) removeSpring(prop, prop.keyTime(idx));
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
    prop.setTemporalEaseAtKey(idx, inE as [KeyframeEase], outE as [KeyframeEase]);
  }
  // the end of a sprung segment stays linear coming in (the spring shapes that side)
  if ((interp || k.ease_in || k.ease_out) && idx > 1 && springAt(prop, prop.keyTime(idx - 1))) prop.setInterpolationTypeAtKey(idx, KeyframeInterpolationType.LINEAR, prop.keyOutInterpolationType(idx));
}


// ---------- full-fidelity key snapshots ----------
// A snapshot holds everything about a key: value, interpolation, temporal ease and continuity, and for spatial
// properties the motion-path tangents, auto-bezier, continuity and roving. Each read and write is guarded because
// not every property type supports every attribute.

function snapKey(p: Prop, i: number): KeySnap {
  var k: KeySnap = { t: p.keyTime(i), v: p.keyValue(i) };
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

function snapAll(p: Prop): KeySnap[] { var out: KeySnap[] = [], i; for (i = 1; i <= p.numKeys; i++) out.push(snapKey(p, i)); return out; }

// Apply a snapshot's settings (not its value or time) to key idx. Roving is applied separately (restoreRoving),
// after every key exists, because After Effects only allows it between other keys.
// Ease goes before the interpolation type: setting an ease switches a linear key to bezier.
function restoreKey(p: Prop, idx: number, k: KeySnap): void {
  if (k.ie) { try { p.setTemporalEaseAtKey(idx, k.ie as [KeyframeEase], k.oe as [KeyframeEase]); } catch (e2) {} }
  if (k.ii !== undefined) { try { p.setInterpolationTypeAtKey(idx, k.ii, k.oi); } catch (e1) {} }
  if (k.tc !== undefined) { try { p.setTemporalContinuousAtKey(idx, k.tc); p.setTemporalAutoBezierAtKey(idx, k.ta!); } catch (e3) {} }
  if (p.isSpatial) {
    if (k.sc !== undefined) { try { p.setSpatialContinuousAtKey(idx, k.sc); p.setSpatialAutoBezierAtKey(idx, k.sa!); } catch (e4) {} }
    // explicit tangents only when the key was not auto-bezier (setting tangents switches auto-bezier off)
    if (k.si && !k.sa) { try { p.setSpatialTangentsAtKey(idx, k.si as [number, number], k.so as [number, number]); } catch (e5) {} }
  }
}

function restoreRoving(p: Prop, idx: number, k: KeySnap): void {
  if (k.rov) { try { p.setRovingAtKey(idx, true); } catch (e) {} }
}

// Make keys the only keys on p, moved by dt seconds, with all their settings. New keys are added before old ones
// are removed, because removing every key switches some properties off (time remapping).
function replaceKeys(p: Prop, keys: KeySnap[], dt: number): void {
  var oldT: number[] = [], i, j, same, ix, idx: number[] = [];
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
function shiftKeys(p: Prop, dt: number): void { replaceKeys(p, snapAll(p), dt); }

function nonZero(v: ArrayLike<number>): boolean { var i; for (i = 0; i < v.length; i++) if (Math.abs(v[i]) > 1e-9) return true; return false; }

// A key as JSON for get_keyframes / edit_keyframes (the same field names edit_keyframes accepts). Spatial fields that
// are zero or false are left out.
function keyInfo(p: Prop, i: number): KeyInfo {
  var k: KeyInfo = { index: i, t: p.keyTime(i), v: keyVal(p, i), interp_in: interpName(p.keyInInterpolationType(i)), interp_out: interpName(p.keyOutInterpolationType(i)) }, sp = springAt(p, p.keyTime(i));
  if (sp) k.interp_out = sp;
  // temporal ease only matters on bezier sides; one {speed, influence} when every dimension shares it (the form
  // set_keyframes / edit_keyframes take), "easy" for After Effects' Easy Ease
  try {
    if (k.interp_in === "bezier") k.ease_in = easeOut(p.keyInTemporalEase(i));
    if (k.interp_out === "bezier") k.ease_out = easeOut(p.keyOutTemporalEase(i));
  } catch (e1) {}
  // spatial settings only when they say something (zero tangents and false flags are the common case)
  if (p.isSpatial) {
    try { if (nonZero(p.keyInSpatialTangent(i)) || nonZero(p.keyOutSpatialTangent(i))) { k.spatial_in = copyArr(p.keyInSpatialTangent(i)); k.spatial_out = copyArr(p.keyOutSpatialTangent(i)); } } catch (e2) {}
    try { if (p.keySpatialAutoBezier(i)) k.auto_bezier = true; if (p.keySpatialContinuous(i)) k.continuous = true; } catch (e3) {}
    try { if (p.keyRoving(i)) k.roving = true; } catch (e4) {}
  }
  return k;
}

// A key's value as JSON (text documents become their text; unserializable types become undefined).
function keyVal(p: Prop, i: number): any {
  var t = p.propertyValueType, V = PropertyValueType, v;
  if (t === V.TEXT_DOCUMENT) return p.keyValue(i).text;
  if (t === V.SHAPE) return shapeToJson(p.keyValue(i));
  if (t === V.NO_VALUE || t === V.CUSTOM_VALUE || t === V.MARKER) return undefined;
  v = p.keyValue(i);
  return v instanceof Array ? copyArr(v) : v;
}

function interpName(t: KeyframeInterpolationType): string {
  if (t === KeyframeInterpolationType.LINEAR) return "linear";
  if (t === KeyframeInterpolationType.HOLD) return "hold";
  return "bezier";
}

function easeOut(arr: KeyframeEase[]): EaseJson {
  var l = easeList(arr), i, same = true;
  for (i = 1; i < l.length; i++) if (l[i].speed !== l[0].speed || l[i].influence !== l[0].influence) same = false;
  if (!same) return l;
  if (Math.abs(l[0].speed) < 1e-6 && Math.abs(l[0].influence - 33.333333) < 0.01) return "easy";
  return l[0];
}

function easeList(arr: KeyframeEase[]): { speed: number; influence: number }[] { var o: { speed: number; influence: number }[] = [], i; for (i = 0; i < arr.length; i++) o.push({ speed: arr[i].speed, influence: arr[i].influence }); return o; }

// Set a static value (time null/undefined) or a keyframe at time.
function setAt(p: Prop, v: any, t?: number | null): void {
  if (t !== null && t !== undefined) {
    if (!p.canVaryOverTime) fail("BAD_ARGS", "Property is not keyframable");
    p.setValueAtTime(t, v);
  } else {
    if (p.numKeys > 0) fail("BAD_ARGS", "Property is animated; pass time to set a keyframe", "Use camera_move or set_keyframes to change animation");
    p.setValue(v);
  }
}

function clearKeysBetween(p: Prop, t0: number, t1: number): void {
  var i;
  for (i = p.numKeys; i >= 1; i--) if (p.keyTime(i) >= t0 - EPS && p.keyTime(i) <= t1 + EPS) p.removeKey(i);
}

// Insert keys {t, v} (replacing any existing keys inside their time range).
// Sampled keys use linear timing because the easing is already in the values.
function putKeys(p: Prop, keys: { t: number; v: any }[], easing?: string, sampled?: boolean): number {
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
function copyAnimation(src: Prop, dst: Prop, dt?: number): void {
  if (src.numKeys === 0) {
    while (dst.numKeys > 0) dst.removeKey(dst.numKeys);
    dst.setValue(src.value);
    return;
  }
  replaceKeys(dst, snapAll(src), dt || 0);
}
