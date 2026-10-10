// Motion vocabulary: entrance and exit moves with spring physics, per-unit text reveals and shape transitions.
// review_motion, which flags what makes animation look amateur, is in commands/review.ts. (src/tools/motion.ts)
//
// Springs and reveals are expressions whose values are pure functions of time (closed-form step responses over a
// key interval), so they scrub, render and preview the same everywhere. Line 1 marks them: // ae-motion spring,
// // ae-motion reveal.

/** One part of a move: [property, axis, rest value -> off-state value, fraction of the duration, springs?]. */
type MovePart = [string, string, (v: any) => any, number, boolean];

var REVEAL_TAG = "// ae-motion reveal";
var MOVES: { [move: string]: number } = { fade: 1, pop: 1, grow: 1, slide: 1, drop: 1, spin: 1 };
var MOVE_STYLES: { [style: string]: number } = { snappy: 1, smooth: 1, spring: 1, bounce: 1, linear: 1 };

// One side of a key: "linear", or bezier with speed 0 and the given influence.
function keySide(p: Prop, idx: number, side: string, influence: number | null): void {
  var dims = p.isSpatial ? 1 : (p.value instanceof Array ? p.value.length : 1), inE: KeyframeEase[] = p.keyInTemporalEase(idx), outE: KeyframeEase[] = p.keyOutTemporalEase(idx),
    inT = p.keyInInterpolationType(idx), outT = p.keyOutInterpolationType(idx), e: KeyframeEase[] = [], d, B = KeyframeInterpolationType.BEZIER, L = KeyframeInterpolationType.LINEAR;
  if (influence !== null) {
    for (d = 0; d < dims; d++) e.push(new KeyframeEase(0, influence));
    if (side === "in") inE = e; else outE = e;
    p.setTemporalEaseAtKey(idx, inE as [KeyframeEase], outE as [KeyframeEase]); // switches the key to bezier: set the interpolation types after
  }
  if (side === "in") inT = influence === null ? L : B; else outT = influence === null ? L : B;
  p.setInterpolationTypeAtKey(idx, inT, outT);
}

// Curve of the segment from key i0 to key i1. Entrances decelerate (snappy: fast start, long settle), exits
// accelerate, smooth eases both ends. Springs keep linear keys: the expression shapes the motion.
function shapeSegment(p: Prop, i0: number, i1: number, curve: string): void {
  var c = ({ snappy: [null, 85], smooth: [70, 70], accelerate: [85, null], linear: [null, null] } as { [curve: string]: (number | null)[] })[curve] || [70, 70];
  keySide(p, i0, "out", c[0]);
  keySide(p, i1, "in", c[1]);
}

// The property a move animates; position is split into x / y when its dimensions are separated.
function moveProp(l: AVLayer, what: string, axis: string): Prop {
  var pos;
  if (what !== "position") return tp(l, ({ scale: "ADBE Scale", rotation: "ADBE Rotate Z", opacity: "ADBE Opacity" } as { [what: string]: string })[what]);
  pos = tp(l, "ADBE Position");
  if (pos.dimensionsSeparated) return tp(l, axis === "y" ? "ADBE Position_1" : "ADBE Position_0");
  return pos;
}

// What a move changes: [property, axis, function(rest value) -> off-state value, fraction of the duration, springs?]
function movePlan(l: AVLayer, move: string, dir: string, dist: number): MovePart[] {
  var dx = dir === "left" ? -dist : (dir === "right" ? dist : 0), dy = dir === "up" ? -dist : (dir === "down" ? dist : 0), sep, out: MovePart[] = [];
  function scaled(f: number) { return function (v: number[]) { var o: number[] = [], i; for (i = 0; i < v.length; i++) o.push(v[i] * f); return o; }; }
  function zero() { return 0; }
  // the off-state sits behind the direction of travel: moving up, the layer comes from below
  function offset(v: number[]) { var o = copyArr(v); o[0] -= dx; o[1] -= dy; return o; }
  if (move === "fade") out.push(["opacity", "", zero, 1, false]);
  if (move === "pop" || move === "spin") { out.push(["scale", "", scaled(0), 1, true]); out.push(["opacity", "", zero, 0.35, false]); }
  if (move === "spin") out.push(["rotation", "", function (v) { return v - 90; }, 1, true]);
  if (move === "grow") { out.push(["scale", "", scaled(0.8), 1, true]); out.push(["opacity", "", zero, 0.6, false]); }
  if (move === "slide" || move === "drop") {
    sep = tp(l, "ADBE Position").dimensionsSeparated;
    if (sep) {
      if (dx) out.push(["position", "x", function (v) { return v - dx; }, 1, true]);
      if (dy) out.push(["position", "y", function (v) { return v - dy; }, 1, true]);
    } else out.push(["position", "", offset, 1, true]);
    out.push(["opacity", "", zero, move === "drop" ? 0.25 : 0.5, false]);
  }
  return out;
}

// Key one part of a move between t0 and t1 (rest -> off for exits, off -> rest for entrances), replacing keys
// inside that span.
function keyMove(p: Prop, part: MovePart, t0: number, t1: number, phase: string, curve: string): void {
  var tRest = phase === "in" ? t1 : t0, rest = p.valueAtTime(tRest, true), off = part[2](rest), ta = t0, tb, a, b, i0, i1;
  tb = phase === "in" ? t0 + (t1 - t0) * part[3] : t1;
  if (phase === "out") ta = t1 - (t1 - t0) * part[3];
  a = phase === "in" ? off : rest; b = phase === "in" ? rest : off;
  clearKeysBetween(p, ta, tb);
  p.setValueAtTime(ta, a); p.setValueAtTime(tb, b);
  i0 = p.nearestKeyIndex(ta); i1 = p.nearestKeyIndex(tb);
  if (SPRINGS[curve] && part[4] && phase === "in") { shapeSegment(p, i0, i1, "linear"); addSpring(p, ta, curve); }
  else shapeSegment(p, i0, i1, SPRINGS[curve] ? (phase === "in" ? "snappy" : "accelerate") : curve);
}

C.animate = function (a: Args["animate"]) {
  need(a, ["layer_ids", "move"]);
  var ls = pickLayers(a.layer_ids), c = sameComp(ls), phase = a.phase || "in", move = a.move, i, j, l, plan, t0, dur, curve, list: { l: AVLayer; plan: MovePart[]; t0: number }[] = [], p, out: Obj[] = [], order;
  if (!MOVES[move]) fail("BAD_ARGS", "move must be fade, pop, grow, slide, drop or spin");
  if (phase !== "in" && phase !== "out") fail("BAD_ARGS", "phase must be in or out");
  curve = a.style || (move === "pop" || move === "spin" ? "spring" : (move === "drop" ? "bounce" : (phase === "in" ? "snappy" : "accelerate")));
  if (!MOVE_STYLES[curve] && curve !== "accelerate") fail("BAD_ARGS", "style must be snappy, smooth, spring, bounce or linear");
  dur = has(a, "duration") ? a.duration : (phase === "in" ? 0.6 : 0.4);
  if (!(dur > 0)) fail("BAD_ARGS", "duration must be above 0");
  assertUnlocked(ls);
  order = copyArr(ls); if (a.order === "reverse") order.reverse();
  // check every property before changing anything: another expression on it would fight the keys
  for (i = 0; i < order.length; i++) {
    l = order[i];
    if (!l.property("ADBE Transform Group")) fail("BAD_ARGS", "Layer " + l.id + " has no transform");
    plan = movePlan(l, move, a.direction || (move === "drop" ? "down" : "up"), has(a, "distance") ? a.distance : (move === "drop" ? c.height * 0.25 : c.height * 0.08));
    for (j = 0; j < plan.length; j++) {
      p = moveProp(l, plan[j][0], plan[j][1]);
      if (springList(p) === null) fail("BAD_ARGS", "Layer " + l.id + ": " + p.name + " has an expression", "Clear it with set_expression and an empty expression");
    }
    t0 = has(a, "time") ? a.time : (phase === "in" ? l.inPoint : l.outPoint - dur);
    t0 = snapT(c, t0 + i * (a.stagger || 0));
    if (t0 < 0) fail("BAD_ARGS", "The move would start before 0 s");
    list.push({ l: l, plan: plan, t0: t0 });
  }
  for (i = 0; i < list.length; i++) {
    for (j = 0; j < list[i].plan.length; j++) keyMove(moveProp(list[i].l, list[i].plan[j][0], list[i].plan[j][1]), list[i].plan[j], list[i].t0, snapT(c, list[i].t0 + dur), phase, curve);
    out.push({ id: list[i].l.id, start: list[i].t0, end: snapT(c, list[i].t0 + dur) });
  }
  return { move: move, phase: phase, style: curve, layers: out };
};

// ---------- text reveals ----------

var REVEAL_BASED: { [by: string]: number } = { chars: 1, words: 3, lines: 4 };
// The curve u (0-1) -> e (0-1) as expression code.
var REVEAL_CURVES: { [curve: string]: string } = {
  linear: "u",
  smooth: "u<.5?4*u*u*u:1-Math.pow(-2*u+2,3)/2",
  snappy: "(1-Math.pow(2,-10*u))/(1-Math.pow(2,-10))",
  accelerate: "u*u*u",
  spring: "(1-Math.exp(-6*u)*Math.cos(9.42*u))/(1-Math.exp(-6)*Math.cos(9.42))",
  bounce: "1-Math.abs(Math.exp(-5*u)*Math.cos(14.137*u))"
};
var REVEAL_ORDERS: { [order: string]: number } = { forward: 0, reverse: 1, center: 2, random: 3 };

// The Amount expression of a reveal's expression selector: 100 = the animator's off state, 0 = at rest.
function revealExpr(t0: number, d: number, st: number, out: boolean, ord: number, curve: string, k: number): string {
  return REVEAL_TAG + "\nvar t0=" + t0 + ",d=" + d + ",st=" + st + ",o=" + ord + ",k=" + k + ";\n" +
    "var i=textIndex-1,n=textTotal;\n" +
    "if(o==1)i=n-1-i;else if(o==2)i=Math.abs(i-(n-1)/2);else if(o==3){var r=Math.sin((i+1)*12.9898)*43758.5453;i=Math.floor((r-Math.floor(r))*n);}\n" +
    "var u=d>0?Math.min(Math.max((time-t0-i*st)/d,0),1):(time>=t0+i*st?1:0);\n" +
    "var e=" + REVEAL_CURVES[curve] + ";\n" + (out ? "100*e" : "100*(1-e)");
}

// How many units a reveal staggers over (textTotal's count for the chosen basis).
function unitCount(txt: string, by: string): number {
  var parts, n = 0, i;
  if (by === "chars") return txt.length;
  parts = txt.split(by === "lines" ? /[\r\n]+/ : /\s+/);
  for (i = 0; i < parts.length; i++) if (parts[i] !== "") n++;
  return n;
}

C.text_reveal = function (a: Args["text_reveal"]) {
  need(a, ["layer_id"]);
  var l = getLayer(a.layer_id), c = l.containingComp, style = a.style || "rise", by = a.by || "chars", phase = a.phase || "in",
    curve = a.ease || (style === "pop" ? "spring" : (phase === "in" ? "snappy" : "accelerate")), d, st, t0, n, an, props, sel: any, dist, r, m, pad, ms, amount, end;
  if (!(l instanceof TextLayer)) fail("BAD_ARGS", "Layer " + l.id + " is not a text layer");
  if (!REVEAL_BASED[by]) fail("BAD_ARGS", "by must be chars, words or lines");
  if (!REVEAL_CURVES[curve]) fail("BAD_ARGS", "ease must be snappy, smooth, spring, bounce or linear");
  if (" rise drop fade pop blur typewriter ".indexOf(" " + style + " ") === -1) fail("BAD_ARGS", "style must be rise, drop, fade, pop, blur or typewriter");
  if (!has(REVEAL_ORDERS, a.order || "forward")) fail("BAD_ARGS", "order must be forward, reverse, center or random");
  d = style === "typewriter" ? 0 : (has(a, "duration") ? a.duration : 0.5);
  st = has(a, "stagger") ? a.stagger : (style === "typewriter" ? 0.05 : { chars: 0.03, words: 0.08, lines: 0.15 }[by]);
  n = unitCount(l.property("ADBE Text Properties").property("ADBE Text Document").value.text, by);
  t0 = has(a, "time") ? a.time : (phase === "in" ? l.inPoint : l.outPoint - d - Math.max(0, n - 1) * st);
  if (t0 < 0) fail("BAD_ARGS", "The reveal would start before 0 s");
  dist = has(a, "distance") ? a.distance : Math.round(c.height * 0.05);
  an = l.property("ADBE Text Properties").property("ADBE Text Animators").addProperty("ADBE Text Animator");
  an.name = "Reveal (" + style + ")";
  props = an.property("ADBE Text Animator Properties");
  props.addProperty("ADBE Text Opacity").setValue(0);
  if (style === "rise" || style === "drop") props.addProperty("ADBE Text Position 3D").setValue([0, style === "rise" ? dist : -dist, 0]);
  if (style === "pop") props.addProperty("ADBE Text Scale 3D").setValue([0, 0, 0]);
  if (style === "blur") props.addProperty("ADBE Text Blur").setValue([24, 24]);
  sel = an.property("ADBE Text Selectors").addProperty("ADBE Text Expressible Selector");
  safe(function () { sel.property("ADBE Text Range Type2").setValue(REVEAL_BASED[by]); });
  amount = sel.property("ADBE Text Expressible Amount");
  amount.expression = revealExpr(Math.round(t0 * 1e4) / 1e4, d, st, phase === "out", REVEAL_ORDERS[a.order || "forward"], curve, n);
  if (amount.expressionError) fail("AE_ERROR", "After Effects rejected the reveal expression: " + amount.expressionError);
  end = t0 + d + Math.max(0, n - 1) * st;
  // a mask along the text's baseline (rise) or cap line (drop) so letters slide out from behind a line
  if (a.mask && (style === "rise" || style === "drop")) {
    r = l.sourceRectAtTime(phase === "in" ? end : t0, false); pad = Math.max(r.height, dist) * 1.5;
    m = l.property("ADBE Mask Parade").addProperty("ADBE Mask Atom"); m.name = "Reveal line";
    ms = style === "rise" ? [r.top - pad, r.top + r.height + r.height * 0.12] : [r.top - r.height * 0.05, r.top + r.height + pad];
    m.property("ADBE Mask Shape").setValue(boxShape("rect", r.left + r.width / 2, (ms[0] + ms[1]) / 2, r.width + pad * 2, ms[1] - ms[0]));
  }
  return { layer: layerRef(l), animator: an.propertyIndex, units: n, start: t0, end: Math.round(end * 1e4) / 1e4 };
};

// ---------- transitions ----------

function fdHalf(c: CompItem): number { return c.frameDuration / 2; }

// A full-frame color move that covers the frame at time (cut the scenes there) and clears it again by
// time + duration/2: a wipe or staggered bars travelling across, or an iris circle that grows to a disc and then
// opens from its centre (a ring whose stroke shrinks).
C.transition = function (a: Args["transition"]) {
  need(a, ["comp_id", "time"]);
  var c = getComp(a.comp_id), type = a.type || "wipe", d = has(a, "duration") ? a.duration : 0.8, col = a.color || [0.05, 0.05, 0.06], dir = a.direction || "right",
    W = c.width, H = c.height, ts = snapT(c, a.time - d / 2), tm = snapT(c, a.time), te = snapT(c, a.time + d / 2), l, n, i, horiz, grp: any, pos, st, R, cx, cy, sz: any, sw, g, k;
  if (" wipe bars iris ".indexOf(" " + type + " ") === -1) fail("BAD_ARGS", "type must be wipe, bars or iris");
  if (" left right up down ".indexOf(" " + dir + " ") === -1) fail("BAD_ARGS", "direction must be left, right, up or down");
  if (ts < 0) fail("BAD_ARGS", "The transition would start before 0 s", "Use a later time or a shorter duration");
  l = c.layers.addShape(); l.name = "Transition (" + type + ")";
  setIn(l, ts); l.outPoint = Math.min(c.duration, te + c.frameDuration);
  if (type === "iris") {
    cx = a.center ? a.center[0] - W / 2 : 0; cy = a.center ? a.center[1] - H / 2 : 0;
    // radius that covers the farthest corner from the centre
    R = Math.sqrt(Math.pow(W / 2 + Math.abs(cx), 2) + Math.pow(H / 2 + Math.abs(cy), 2));
    grp = addShapeContent(l, { type: "ellipse", size: [1, 1], stroke: col, stroke_width: 1, name: "Iris" });
    grp.property("ADBE Vector Transform Group").property("ADBE Vector Position").setValue([cx, cy]);
    g = grp.property("ADBE Vectors Group");
    sz = g.property(1).property("ADBE Vector Ellipse Size");
    sw = g.property(2).property("ADBE Vector Stroke Width");
    sz.setValueAtTime(ts, [0, 0]); sz.setValueAtTime(tm, [R, R]); sz.setValueAtTime(te, [2 * R, 2 * R]);
    sw.setValueAtTime(ts, 0); sw.setValueAtTime(tm, R); sw.setValueAtTime(te, 0);
    for (k = 1; k <= 3; k++) { applyKeyMeta(sz, k, { ease_in: { influence: 60 }, ease_out: { influence: 60 } }); applyKeyMeta(sw, k, { ease_in: { influence: 60 }, ease_out: { influence: 60 } }); }
  } else {
    n = type === "bars" ? Math.max(2, Math.min(20, a.bars || 5)) : 1;
    horiz = dir === "left" || dir === "right";
    // bars arrive one after another, all cover the frame at time, then leave in the same order
    st = n > 1 ? d * 0.25 / (n - 1) : 0;
    k = dir === "left" || dir === "up" ? -1 : 1;
    for (i = 0; i < n; i++) {
      grp = addShapeContent(l, { type: "rect", size: horiz ? [W + 4, H / n + 2] : [W / n + 2, H + 4], fill: col, name: "Bar " + (i + 1) });
      pos = grp.property("ADBE Vector Transform Group").property("ADBE Vector Position");
      cx = horiz ? 0 : -W / 2 + (i + 0.5) * W / n; cy = horiz ? -H / 2 + (i + 0.5) * H / n : 0;
      sz = [snapT(c, ts + i * st), snapT(c, tm - (n - 1 - i) * st), snapT(c, tm + i * st)];
      sz.push(snapT(c, sz[2] + (sz[1] - sz[0])));
      pos.setValueAtTime(sz[0], horiz ? [-k * (W + 4), cy] : [cx, -k * (H + 4)]);
      pos.setValueAtTime(sz[1], [cx, cy]);
      if (sz[2] > sz[1] + fdHalf(c)) pos.setValueAtTime(sz[2], [cx, cy]);
      pos.setValueAtTime(sz[3], horiz ? [k * (W + 4), cy] : [cx, k * (H + 4)]);
      shapeSegment(pos, 1, 2, "snappy"); shapeSegment(pos, pos.numKeys - 1, pos.numKeys, "accelerate");
    }
  }
  return { layer: layerTiming(l), covered_at: tm, type: type };
};
