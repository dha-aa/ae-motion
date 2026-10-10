// Cameras, camera moves / shake / rigs, 3D layers, lights and the 3D viewer. (src/tools/scene3d.ts)
// Helpers live in core/scene3d.ts and core/vector.ts.

/** A move's keys before they are set: a number (zoom, roll, focus) or a vector (position, point of interest) per time. */
type PlanKey = { t: number; v: any };

var EASE_NAMES: { [name: string]: number } = { linear: 1, ease_in: 1, ease_out: 1, ease_in_out: 1 };
var FALLOFFS: { [name: string]: number } = { none: 1, smooth: 2, inverse_square_clamped: 3 };
var CASTS: { [name: string]: number } = { off: 0, on: 1, only: 2 };
var MATERIAL: { [field: string]: string } = {
  light_transmission: "ADBE Light Transmission", ambient: "ADBE Ambient Coefficient", diffuse: "ADBE Diffuse Coefficient",
  specular_intensity: "ADBE Specular Coefficient", specular_shininess: "ADBE Shininess Coefficient", metal: "ADBE Metal Coefficient",
  reflection_intensity: "ADBE Reflection Coefficient", reflection_sharpness: "ADBE Glossiness Coefficient", reflection_rolloff: "ADBE Fresnel Coefficient",
  transparency: "ADBE Transparency Coefficient", transparency_rolloff: "ADBE Transp Rolloff", index_of_refraction: "ADBE Index of Refraction"
};
// Menu item names under View > Switch 3D View. Verify a new name there before adding it.
var VIEWS: { [view: string]: string } = {
  "active_camera": "Active Camera", "default": "Default", "front": "Front", "left": "Left", "top": "Top", "back": "Back", "right": "Right", "bottom": "Bottom",
  "custom_1": "Custom View 1", "custom_2": "Custom View 2", "custom_3": "Custom View 3"
};

C.get_camera = function (a: Args["get_camera"]) {
  need(a, ["layer_id"]);
  return camInfo(camLayer(a.layer_id), has(a, "time") ? a.time : 0);
};

C.set_camera = function (a: Args["set_camera"]) {
  need(a, ["layer_id"]);
  var l = camLayer(a.layer_id), W = l.containingComp.width, t = has(a, "time") ? a.time : null, nlens = 0, z, k, other, p;
  if (has(a, "zoom")) nlens++;
  if (has(a, "focal_length")) nlens++;
  if (has(a, "fov")) nlens++;
  if (nlens > 1) fail("BAD_ARGS", "Pass only one of zoom, focal_length and fov");
  if (has(a, "focus_distance") && has(a, "focus_on_layer_id")) fail("BAD_ARGS", "Pass only one of focus_distance and focus_on_layer_id");
  if (has(a, "name")) l.name = a.name;
  if (has(a, "two_node")) l.autoOrient = a.two_node ? AutoOrientType.CAMERA_OR_POINT_OF_INTEREST : AutoOrientType.NO_AUTO_ORIENT;
  if (has(a, "zoom")) z = a.zoom;
  else if (has(a, "focal_length")) z = a.focal_length * W / 36;
  else if (has(a, "fov")) { if (!(a.fov > 0 && a.fov < 180)) fail("BAD_ARGS", "fov must be between 0 and 180 degrees"); z = W / (2 * Math.tan(rad(a.fov) / 2)); }
  if (z !== undefined) { if (!(z > 0)) fail("BAD_ARGS", "The lens must be greater than 0"); setAt(camOpt(l, "ADBE Camera Zoom"), z, t); }
  if (has(a, "depth_of_field")) setAt(camOpt(l, "ADBE Camera Depth of Field"), a.depth_of_field ? 1 : 0, t);
  if (has(a, "focus_distance")) setAt(camOpt(l, "ADBE Camera Focus Distance"), a.focus_distance, t);
  else if (has(a, "focus_on_layer_id")) {
    other = getLayer(a.focus_on_layer_id);
    if (other.containingComp.id !== l.containingComp.id) fail("BAD_ARGS", "That layer is in a different comp");
    setAt(camOpt(l, "ADBE Camera Focus Distance"), axisDistance(l, other, t === null ? 0 : t), t);
  }
  if (has(a, "aperture")) setAt(camOpt(l, "ADBE Camera Aperture"), a.aperture, t);
  if (has(a, "blur_level")) setAt(camOpt(l, "ADBE Camera Blur Level"), a.blur_level, t);
  for (k in IRIS) { if (IRIS.hasOwnProperty(k) && has(a as Obj, k)) setAt(camOpt(l, IRIS[k]), (a as Obj)[k], t); }
  applyXform(l, a, t);
  if (has(a, "look_at_layer_id")) {
    needTwoNode(l);
    other = getLayer(a.look_at_layer_id);
    if (other.containingComp.id !== l.containingComp.id) fail("BAD_ARGS", "That layer is in a different comp");
    p = tp(l, "ADBE Anchor Point");
    if (a.follow) {
      if (p.expressionEnabled) fail("BAD_ARGS", "Point of interest is already driven by an expression", "Clear it with set_expression and an empty expression");
      p.expression = LOOKMARK + '\nthisComp.layer("' + cleanName(other.name) + '").transform.position';
      if (p.expressionError) { p.expression = ""; fail("AE_ERROR", "Look-at expression failed: " + p.expressionError); }
    } else {
      setAt(xformProp(l, "ADBE Anchor Point"), v3(copyArr(tp(other, "ADBE Position").valueAtTime(t === null ? 0 : t, false))), t);
    }
  }
  return camInfo(l, t === null ? 0 : t);
};

// Each move type builds "plans" (lists of {t, v}) for the properties it changes, then writes them with putKeys.
// Rotational moves (pan, tilt, orbit) are sampled every step_degrees with the easing baked into the values.
// Numbers or vectors, for combining moves on any camera property.
function addAny(a: any, b: any): any { var o: number[] = [], i; if (typeof a === "number") return a + b; for (i = 0; i < a.length; i++) o.push(a[i] + b[i]); return o; }
function subAny(a: any, b: any): any { var o: number[] = [], i; if (typeof a === "number") return a - b; for (i = 0; i < a.length; i++) o.push(a[i] - b[i]); return o; }

// A move plan's value at t: its keys with the move's easing (sampled plans are already eased, so linear between).
function planAt(plan: PlanKey[], easing: string, sampled: boolean, t: number): any {
  var n = plan.length, i, u;
  if (t <= plan[0].t) return plan[0].v;
  if (t >= plan[n - 1].t) return plan[n - 1].v;
  for (i = 0; i < n - 1 && plan[i + 1].t < t; i++) {}
  u = (t - plan[i].t) / (plan[i + 1].t - plan[i].t);
  if (!sampled) u = easeU(easing, u);
  return addAny(plan[i].v, (typeof plan[i].v === "number") ? (plan[i + 1].v - plan[i].v) * u : vmul(subAny(plan[i + 1].v, plan[i].v), u));
}

// Layer a move over the property's existing animation instead of replacing it: inside the move every value gets
// the move's offset (sampled so the easing survives), and keys after the move keep its final offset. So a dolly
// and a truck over the same seconds add up.
function combineKeys(p: Prop, plan: PlanKey[], easing: string, sampled: boolean): number {
  var t0 = plan[0].t, t1 = plan[plan.length - 1].t, base = planAt(plan, easing, sampled, t0), dEnd = subAny(planAt(plan, easing, sampled, t1), base),
    times: number[] = [], vals: any[] = [], after: PlanKey[] = [], i, j, t, lin = KeyframeInterpolationType.LINEAR, N = 12;
  for (i = 0; i <= N; i++) times.push(t0 + (t1 - t0) * i / N);
  for (i = 0; i < plan.length; i++) times.push(plan[i].t);
  for (i = 1; i <= p.numKeys; i++) {
    t = p.keyTime(i);
    if (t > t0 + EPS && t < t1 - EPS) times.push(t);
    else if (t >= t1 - EPS && t > t0 + EPS && Math.abs(t - t1) >= EPS) after.push({ t: t, v: p.keyValue(i) });
  }
  times.sort(function (x, y) { return x - y; });
  for (i = 0, j = 0; i < times.length; i++) if (!j || times[i] - times[j - 1] > EPS) times[j++] = times[i];
  times.length = j;
  for (i = 0; i < times.length; i++) vals.push(addAny(p.valueAtTime(times[i], true), subAny(planAt(plan, easing, sampled, times[i]), base)));
  clearKeysBetween(p, t0, t1);
  for (i = 0; i < times.length; i++) p.setValueAtTime(times[i], vals[i]);
  for (i = 0; i < times.length; i++) { j = p.nearestKeyIndex(times[i]); p.setInterpolationTypeAtKey(j, lin, lin); }
  for (i = 0; i < after.length; i++) p.setValueAtTime(after[i].t, addAny(after[i].v, dEnd));
  return times.length;
}

// Straight lines between the keys in t0..t1 of a spatial property: After Effects gives new spatial keys auto-bezier
// tangents, so a path through waypoints curves and overshoots between them (the framing drifts off what was asked).
function straightPath(p: Prop, t0: number, t1: number): void {
  var i, z: [number, number, number] = [0, 0, 0];
  for (i = 1; i <= p.numKeys; i++) {
    if (p.keyTime(i) < t0 - EPS || p.keyTime(i) > t1 + EPS) continue;
    p.setSpatialAutoBezierAtKey(i, false);
    p.setSpatialContinuousAtKey(i, false);
    p.setSpatialTangentsAtKey(i, z, z);
  }
}

C.camera_move = function (a: Args["camera_move"]) {
  need(a, ["layer_id", "type"]);
  var l = camLayer(a.layer_id), comp = l.containingComp, type = a.type, easing = a.easing || "ease_in_out", t0 = has(a, "start") ? a.start : 0, dur = a.duration as number, t1!: number,
    st, f, d, delta, n, i, u, e, w, v, target, deg, vdeg, p, z0, z1, other, wp,
    planPos: PlanKey[] | null = null, planPoi: PlanKey[] | null = null, planRoll: PlanKey[] | null = null, planZoom: PlanKey[] | null = null, planFocus: PlanKey[] | null = null,
    posSampled = false, poiSampled = false, res: Obj = { type: type, keyframes: {} };
  if (!EASE_NAMES[easing]) fail("BAD_ARGS", "easing must be linear, ease_in, ease_out or ease_in_out");
  if (t0 < 0) fail("BAD_ARGS", "start must be 0 or more");
  if (type !== "path") {
    if (!(dur > 0)) fail("BAD_ARGS", "duration must be greater than 0");
    t1 = t0 + dur;
  }

  if (type === "dolly") {
    needTwoNode(l); st = stateAt(l, t0); f = vsub(st.T, st.P); d = vlen(f);
    if (has(a, "factor")) { if (!(a.factor > 0)) fail("BAD_ARGS", "factor must be greater than 0"); z1 = d * a.factor; }
    else if (has(a, "distance")) z1 = d - a.distance;
    else fail("BAD_ARGS", "dolly needs distance (px toward the point of interest) or factor (new distance as a multiple of the current one)");
    if (z1 < 1) fail("BAD_ARGS", "The dolly would reach the point of interest (it is " + Math.round(d) + " px away)");
    planPos = [{ t: t0, v: st.P }, { t: t1, v: vsub(st.T, vmul(vnorm(f), z1)) }];
  } else if (type === "truck" || type === "pedestal") {
    need(a, ["distance"]); needTwoNode(l); st = stateAt(l, t0);
    delta = type === "truck" ? vmul(rightOf(vnorm(vsub(st.T, st.P))), a.distance) : [0, -a.distance, 0];
    planPos = [{ t: t0, v: st.P }, { t: t1, v: vadd(st.P, delta) }];
    planPoi = [{ t: t0, v: st.T }, { t: t1, v: vadd(st.T, delta) }];
  } else if (type === "crane") {
    need(a, ["distance"]); needTwoNode(l); st = stateAt(l, t0);
    planPos = [{ t: t0, v: st.P }, { t: t1, v: vadd(st.P, [0, -a.distance, 0]) }];
  } else if (type === "pan" || type === "tilt") {
    need(a, ["degrees"]); needTwoNode(l); st = stateAt(l, t0); w = vsub(st.T, st.P);
    n = sampleCount(a.degrees, a.step_degrees); planPoi = []; poiSampled = true;
    for (i = 0; i <= n; i++) {
      u = i / n; e = easeU(easing, u);
      v = type === "pan" ? yaw(w, -a.degrees * e) : elevate(w, a.degrees * e);
      planPoi.push({ t: t0 + dur * u, v: vadd(st.P, v) });
    }
  } else if (type === "roll") {
    need(a, ["degrees"]); p = tp(l, "ADBE Rotate Z"); z0 = p.valueAtTime(t0, true);
    planRoll = [{ t: t0, v: z0 }, { t: t1, v: z0 + a.degrees }];
  } else if (type === "orbit") {
    needTwoNode(l); st = stateAt(l, t0);
    deg = has(a, "degrees") ? a.degrees : 0; vdeg = has(a, "vertical_degrees") ? a.vertical_degrees : 0;
    if (deg === 0 && vdeg === 0) fail("BAD_ARGS", "orbit needs degrees (left/right) or vertical_degrees (up/down)");
    target = has(a, "target") ? v3(a.target) : st.T; v = vsub(st.P, target);
    if (vlen(v) < 1) fail("BAD_ARGS", "The camera is at the orbit target");
    n = sampleCount(Math.max(Math.abs(deg), Math.abs(vdeg)), a.step_degrees); planPos = []; posSampled = true;
    for (i = 0; i <= n; i++) {
      u = i / n; e = easeU(easing, u);
      planPos.push({ t: t0 + dur * u, v: vadd(target, elevate(yaw(v, deg * e), vdeg * e)) });
    }
    if (has(a, "target") && vlen(vsub(target, st.T)) > 1e-6) planPoi = [{ t: t0, v: st.T }, { t: t1, v: target }];
  } else if (type === "zoom") {
    p = camOpt(l, "ADBE Camera Zoom"); z0 = p.valueAtTime(t0, true);
    if (has(a, "to_zoom")) z1 = a.to_zoom;
    else if (has(a, "factor")) z1 = z0 * a.factor;
    else if (has(a, "to_focal_length")) z1 = a.to_focal_length * comp.width / 36;
    else if (has(a, "to_fov")) { if (!(a.to_fov > 0 && a.to_fov < 180)) fail("BAD_ARGS", "to_fov must be between 0 and 180 degrees"); z1 = comp.width / (2 * Math.tan(rad(a.to_fov) / 2)); }
    else fail("BAD_ARGS", "zoom needs to_zoom, factor, to_focal_length or to_fov");
    if (!(z1 > 0)) fail("BAD_ARGS", "The target lens must be greater than 0");
    planZoom = [{ t: t0, v: z0 }, { t: t1, v: z1 }];
  } else if (type === "rack_focus") {
    p = camOpt(l, "ADBE Camera Focus Distance"); z0 = p.valueAtTime(t0, true);
    if (has(a, "to_focus_distance")) z1 = a.to_focus_distance;
    else if (has(a, "to_layer_id")) {
      other = getLayer(a.to_layer_id);
      if (other.containingComp.id !== comp.id) fail("BAD_ARGS", "That layer is in a different comp");
      z1 = axisDistance(l, other, t1);
    } else fail("BAD_ARGS", "rack_focus needs to_focus_distance or to_layer_id");
    planFocus = [{ t: t0, v: z0 }, { t: t1, v: z1 }];
    p = camOpt(l, "ADBE Camera Depth of Field");
    if (a.enable_dof !== false && p.numKeys === 0 && !p.value) { p.setValue(1); res.depth_of_field_enabled = true; }
  } else if (type === "path") {
    wp = a.waypoints;
    if (!(wp instanceof Array) || wp.length < 2) fail("BAD_ARGS", "path needs at least 2 waypoints");
    planPos = []; planPoi = [];
    for (i = 0; i < wp.length; i++) {
      if (!has(wp[i], "t")) fail("BAD_ARGS", "Every waypoint needs a time t");
      if (i > 0 && !(wp[i].t > wp[i - 1].t)) fail("BAD_ARGS", "Waypoint times must increase");
      if (has(wp[i], "position")) planPos.push({ t: wp[i].t, v: v3(wp[i].position!) });
      if (has(wp[i], "point_of_interest")) planPoi.push({ t: wp[i].t, v: v3(wp[i].point_of_interest!) });
    }
    if (planPoi.length) needTwoNode(l);
    if (!planPos.length) planPos = null;
    if (!planPoi.length) planPoi = null;
    if (!planPos && !planPoi) fail("BAD_ARGS", "Waypoints need position and/or point_of_interest");
    if (wp[0].t < 0) fail("BAD_ARGS", "Waypoint times must be 0 or more");
    t0 = wp[0].t; t1 = wp[wp.length - 1].t;
  } else {
    fail("BAD_ARGS", "type must be dolly, truck, pedestal, crane, pan, tilt, roll, orbit, zoom, rack_focus or path");
  }
  if (t1 > comp.duration + EPS) fail("BAD_ARGS", "The move ends at " + t1 + " s, after the comp does (" + comp.duration + " s)", "Shorten it or lengthen the comp with set_comp");

  // combine layers the move over what is already animated; otherwise its keys replace the keys in its range
  function put(p: Prop, plan: PlanKey[], sampled: boolean): number { return a.combine === true ? combineKeys(p, plan, easing, sampled) : putKeys(p, plan, easing, sampled); }
  if (has(a, "spatial") && a.spatial !== "linear" && a.spatial !== "smooth") fail("BAD_ARGS", "spatial must be linear or smooth");
  if (planPos) { p = keyTarget(l, "ADBE Position", "Position"); res.keyframes.position = put(p, planPos, posSampled); if (a.spatial === "linear") straightPath(p, t0, t1); res.final_position = copyArr(p.valueAtTime(t1, true)); }
  if (planPoi) { p = keyTarget(l, "ADBE Anchor Point", "Point of Interest"); res.keyframes.point_of_interest = put(p, planPoi, poiSampled); if (a.spatial === "linear") straightPath(p, t0, t1); res.final_point_of_interest = copyArr(p.valueAtTime(t1, true)); }
  if (planRoll) res.keyframes.roll = put(tp(l, "ADBE Rotate Z"), planRoll, false);
  if (planZoom) { p = camOpt(l, "ADBE Camera Zoom"); res.keyframes.zoom = put(p, planZoom, false); res.final_zoom = p.valueAtTime(t1, true); }
  if (planFocus) { p = camOpt(l, "ADBE Camera Focus Distance"); res.keyframes.focus_distance = put(p, planFocus, false); res.final_focus_distance = p.valueAtTime(t1, true); }
  if (a.combine === true) res.combined = true;
  res.start = t0; res.end = t1;
  return res;
};

C.camera_shake = function (a: Args["camera_shake"]) {
  need(a, ["layer_id"]);
  var l = camLayer(a.layer_id), target = a.target || "position", amount = has(a, "amount") ? a.amount : 10, freq = has(a, "frequency") ? a.frequency : 2,
    oct = has(a, "octaves") ? a.octaves : 2, rotAmt = has(a, "rotation_amount") ? a.rotation_amount : 0.3, seed = has(a, "seed") ? a.seed : 1,
    props = [], applied = [], i, p, ex;
  if (target !== "position" && target !== "point_of_interest" && target !== "rotation" && target !== "all") fail("BAD_ARGS", "target must be position, point_of_interest, rotation or all");
  if (!(freq > 0) || amount < 0) fail("BAD_ARGS", "frequency must be greater than 0 and amount 0 or more");
  if (target === "position" || target === "all") props.push({ name: "position", p: tp(l, "ADBE Position"), rot: false });
  if (target === "point_of_interest" || target === "all") { needTwoNode(l); props.push({ name: "point_of_interest", p: tp(l, "ADBE Anchor Point"), rot: false }); }
  if (target === "rotation" || target === "all") props.push({ name: "roll", p: tp(l, "ADBE Rotate Z"), rot: true });
  for (i = 0; i < props.length; i++) {
    p = props[i].p;
    if (a.remove) {
      if (p.expressionEnabled && p.expression.indexOf(SHAKEMARK) === 0) { p.expression = ""; applied.push(props[i].name); }
      continue;
    }
    if (p.expressionEnabled && p.expression.indexOf(SHAKEMARK) !== 0) fail("BAD_ARGS", props[i].name + " is already driven by an expression", "Remove the rig or clear the expression first");
    ex = SHAKEMARK + "\nseedRandom(" + (seed + i) + ", true);\n";
    if (props[i].rot) ex += "wiggle(" + freq + ", " + rotAmt + ", " + oct + ")";
    else if (a.include_depth === true) ex += "wiggle(" + freq + ", " + amount + ", " + oct + ")";
    else ex += "w = wiggle(" + freq + ", " + amount + ", " + oct + ");\n[w[0], w[1], value[2]]";
    p.expression = ex;
    if (p.expressionError) { p.expression = ""; fail("AE_ERROR", "Shake expression failed: " + p.expressionError); }
    applied.push(props[i].name);
  }
  return { removed: a.remove === true, applied: applied, amount: amount, rotation_amount: rotAmt, frequency: freq, octaves: oct, seed: seed };
};

// A rig is two 3D nulls ("<camera> Position", "<camera> Target") whose positions drive the camera through expressions.
C.camera_rig = function (a: Args["camera_rig"]) {
  need(a, ["layer_id", "action"]);
  var l = camLayer(a.layer_id), comp = l.containingComp, posP = tp(l, "ADBE Position"), poiP = tp(l, "ADBE Anchor Point"), names: string[] = [], pairs: [Prop, string][], i, ctrl, ctrlPos, m, existing, info: Obj = { action: a.action, controls: [] };
  if (a.action === "create") {
    needTwoNode(l);
    if (posP.expressionEnabled || poiP.expressionEnabled) fail("BAD_ARGS", "The camera position or point of interest already has an expression", "Use camera_rig remove first, or clear the expression");
    names = [cleanName(l.name + " Position"), cleanName(l.name + " Target")];
    for (i = 0; i < names.length; i++) {
      existing = null;
      try { existing = comp.layer(names[i]); } catch (e) { existing = null; }
      if (existing) fail("BAD_ARGS", "A layer named " + names[i] + " already exists", "Rename the camera or that layer");
    }
    pairs = [[posP, names[0]], [poiP, names[1]]];
    for (i = 0; i < pairs.length; i++) {
      ctrl = comp.layers.addNull(comp.duration);
      ctrl.name = pairs[i][1];
      ctrl.threeDLayer = true;
      ctrlPos = ctrl.property("ADBE Transform Group").property("ADBE Position");
      copyAnimation(pairs[i][0], ctrlPos);
      while (pairs[i][0].numKeys > 0) pairs[i][0].removeKey(pairs[i][0].numKeys);
      pairs[i][0].expression = RIGMARK + '\nthisComp.layer("' + pairs[i][1] + '").transform.position';
      if (pairs[i][0].expressionError) { pairs[i][0].expression = ""; fail("AE_ERROR", "Rig expression failed: " + pairs[i][0].expressionError); }
      info.controls.push({ name: pairs[i][1], layer_id: ctrl.id, drives: i === 0 ? "position" : "point_of_interest" });
    }
    info.note = "Animate the control layers (or use camera_move, which keys them for you). Renaming a control layer breaks the link.";
    return info;
  }
  if (a.action === "remove") {
    pairs = [[posP, "position"], [poiP, "point_of_interest"]];
    for (i = 0; i < pairs.length; i++) {
      if (!(pairs[i][0].expressionEnabled && pairs[i][0].expression.indexOf(RIGMARK) === 0)) continue;
      m = /thisComp\.layer\("([^"]+)"\)/.exec(pairs[i][0].expression);
      ctrl = null;
      if (m) { try { ctrl = comp.layer(m[1]); } catch (e2) { ctrl = null; } }
      pairs[i][0].expression = "";
      if (ctrl) {
        copyAnimation(ctrl.property("ADBE Transform Group").property("ADBE Position"), pairs[i][0]);
        info.controls.push({ name: ctrl.name, layer_id: ctrl.id, restored: pairs[i][1] });
        if (a.delete_controls !== false) ctrl.remove();
      }
    }
    if (!info.controls.length) fail("BAD_ARGS", "This camera has no rig");
    info.controls_deleted = a.delete_controls !== false;
    return info;
  }
  fail("BAD_ARGS", "action must be create or remove");
};

// Put a 3D layer at depth z and keep its x/y: every position key gets the new z (its other settings stay), so a
// layer that already moves keeps moving. Works with position separated into x/y/z too.
function setDepth(l: Layer, z: number): void {
  var P = tp(l, "ADBE Position"), Z, i, v;
  if (P.dimensionsSeparated) {
    Z = tp(l, "ADBE Position_2");
    if (Z.numKeys) { for (i = 1; i <= Z.numKeys; i++) Z.setValueAtKey(i, z); } else Z.setValue(z);
    return;
  }
  if (P.numKeys) { for (i = 1; i <= P.numKeys; i++) { v = P.keyValue(i); P.setValueAtKey(i, [v[0], v[1], z]); } }
  else { v = P.value; P.setValue([v[0], v[1], z]); }
}

C.set_3d = function (a: Args["set_3d"]) {
  need(a, ["layer_id"]);
  var l = getLayer(a.layer_id), t = has(a, "time") ? a.time : null, m = a.material, grp, k, any;
  if (l instanceof CameraLayer) fail("BAD_ARGS", "Use set_camera for camera layers");
  if (l instanceof LightLayer) fail("BAD_ARGS", "Use set_light for light layers");
  any = has(a, "position") || has(a, "z") || has(a, "anchor") || has(a, "scale") || has(a, "orientation") || has(a, "rotation") || !!m;
  if (has(a, "position") && has(a, "z")) fail("BAD_ARGS", "Pass position or z, not both");
  if (has(a, "three_d")) l.threeDLayer = a.three_d;
  else if (any && !l.threeDLayer) l.threeDLayer = true;
  if (has(a, "z")) setDepth(l, a.z);
  applyXform(l, a, t);
  if (m) {
    grp = l.property("ADBE Material Options Group");
    if (!grp) fail("BAD_ARGS", "This layer has no material options", "Make it 3D first");
    if (has(m, "casts_shadows")) { if (CASTS[m.casts_shadows] === undefined) fail("BAD_ARGS", "casts_shadows must be off, on or only"); setAt(grp.property("ADBE Casts Shadows"), CASTS[m.casts_shadows], t); }
    if (has(m, "accepts_shadows")) setAt(grp.property("ADBE Accepts Shadows"), m.accepts_shadows ? 1 : 0, t);
    if (has(m, "accepts_lights")) setAt(grp.property("ADBE Accepts Lights"), m.accepts_lights ? 1 : 0, t);
    for (k in MATERIAL) { if (MATERIAL.hasOwnProperty(k) && has(m as Obj, k)) setAt(grp.property(MATERIAL[k]), (m as Obj)[k], t); }
  }
  k = xformInfo(l, t === null ? 0 : t);
  return { layer: layerRef(l), three_d: l.threeDLayer === true, position: k.position, orientation: k.orientation, rotation: k.rotation };
};

C.set_light = function (a: Args["set_light"]) {
  need(a, ["layer_id"]);
  var l = getLayer(a.layer_id), t = has(a, "time") ? a.time : null, g, lt, fo;
  if (!(l instanceof LightLayer)) fail("BAD_ARGS", "Layer is not a light", "Add one with add_layer kind light");
  if (has(a, "name")) l.name = a.name;
  if (has(a, "light_type")) {
    lt = LIGHTTYPES[a.light_type];
    if (!lt) fail("BAD_ARGS", "light_type must be point, spot, parallel or ambient");
    l.lightType = (LightType as any)[lt];
  }
  g = l.property("ADBE Light Options Group");
  if ((has(a, "cone_angle") || has(a, "cone_feather")) && l.lightType !== LightType.SPOT) fail("BAD_ARGS", "cone_angle and cone_feather need a spot light");
  if (has(a, "intensity")) setAt(g.property("ADBE Light Intensity"), a.intensity, t);
  if (a.color) setAt(g.property("ADBE Light Color"), rgba(a.color), t);
  if (has(a, "cone_angle")) setAt(g.property("ADBE Light Cone Angle"), a.cone_angle, t);
  if (has(a, "cone_feather")) setAt(g.property("ADBE Light Cone Feather 2"), a.cone_feather, t);
  if (has(a, "falloff")) { fo = FALLOFFS[a.falloff]; if (!fo) fail("BAD_ARGS", "falloff must be none, smooth or inverse_square_clamped"); setAt(g.property("ADBE Light Falloff Type"), fo, t); }
  if (has(a, "falloff_radius")) setAt(g.property("ADBE Light Falloff Start"), a.falloff_radius, t);
  if (has(a, "falloff_distance")) setAt(g.property("ADBE Light Falloff Distance"), a.falloff_distance, t);
  if (has(a, "casts_shadows")) setAt(g.property("ADBE Casts Shadows"), a.casts_shadows ? 1 : 0, t);
  if (has(a, "shadow_darkness")) setAt(g.property("ADBE Light Shadow Darkness"), a.shadow_darkness, t);
  if (has(a, "shadow_diffusion")) setAt(g.property("ADBE Light Shadow Diffusion"), a.shadow_diffusion, t);
  applyXform(l, a, t);
  return lightInfo(l, t === null ? 0 : t);
};

// Runs the View > Switch 3D View menu command. It cannot be undone from a script and clears the layer selection.
C.set_3d_view = function (a: Args["set_3d_view"]) {
  need(a, ["view"]);
  var name, cmd, comp, cam;
  if (!VIEWS.hasOwnProperty(a.view)) fail("BAD_ARGS", "view must be active_camera, default, front, left, top, back, right, bottom, custom_1, custom_2 or custom_3");
  name = VIEWS[a.view];
  if (has(a, "comp_id")) { comp = getComp(a.comp_id); comp.openInViewer(); }
  else {
    comp = app.project.activeItem;
    if (!(comp instanceof CompItem)) fail("BAD_ARGS", "There is no active composition", "Pass comp_id");
  }
  // After Effects puts the active camera's layer name in the menu item: "Active Camera (Camera 1)"
  if (a.view === "active_camera") {
    cam = comp.activeCamera;
    if (cam) name = "Active Camera (" + cam.name + ")";
  }
  cmd = app.findMenuCommandId(name);
  if (!cmd) fail("UNSUPPORTED", "This After Effects version has no menu command named " + name, a.view === "active_camera" ? "The menu item includes the active camera's name; add a camera layer first" : "");
  app.executeCommand(cmd);
  return { view: a.view, menu_item: name, command_id: cmd };
};
