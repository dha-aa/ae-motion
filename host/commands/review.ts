// review_motion: what makes animation look amateur (linear keys, holds, unison starts, small text, cut-off moves) and,
// from the active camera's view, layers off screen, hidden or covered. Read-only: nothing is added to the project.
// (src/tools/motion.ts; the moves, reveals and transitions it reviews are in commands/motion.ts)

/** A keyframe segment review_motion looks at (or a text reveal's span). */
type Seg = { p: Prop; k: number; t0: number; t1: number; linear: boolean; sampled: boolean; spring: boolean; reveal?: boolean };
/** A camera's view: position, forward / right / down axes and zoom. */
type CamView = { P: Vec; f: Vec; r: Vec; d: Vec; zoom: number };
/** A layer's box on screen, and whether it is 3D and how far along the view. */
type ScreenBox = { x0: number; y0: number; x1: number; y1: number; three: boolean; z: number };
type SceneItem = { l: AVLayer; kind: string; t: number };

// ---------- review ----------

var REVIEW_SKIP: { [matchName: string]: number } = { "ADBE Marker": 1, "ADBE Audio Group": 1 };
// expressions that keep moving all the time (springs only reshape their keys; reveals are timed: revealSpan)
var REVIEW_LIVE = /wiggle|loopOut|loopIn|time\s*\*|ae-motion (rig|shake)/;

// The time a text_reveal expression moves over: [t0, t0 + d + (units - 1) * st].
function revealSpan(p: Prop, l: Layer): number[] | null {
  var m = /var t0=([\d.]+),d=([\d.]+),st=([\d.]+)(?:,o=\d+)?(?:,k=(\d+))?/.exec(p.expression), n;
  if (!m) return null;
  // k: the unit count text_reveal wrote; older reveals fall back to the text's length (an upper bound)
  n = m[4] ? parseInt(m[4], 10) : (safe(function () { return l.property("ADBE Text Properties").property("ADBE Text Document").value.text.length; }) || 1);
  return [parseFloat(m[1]), parseFloat(m[1]) + parseFloat(m[2]) + Math.max(0, n - 1) * parseFloat(m[3])];
}

// Motion segments of a layer: every pair of neighbouring keys whose values differ, on any property.
function motionSegments(g: any, out: Seg[], live: { on: boolean }, l: Layer): Seg[] {
  var i, p: any, k: number, v0, v1, rs;
  for (i = 1; i <= g.numProperties; i++) {
    p = g.property(i);
    if (!p || REVIEW_SKIP[p.matchName]) continue;
    if (p.propertyType === PropertyType.PROPERTY) {
      if (safe(function () { return p.expressionEnabled && REVIEW_LIVE.test(p.expression); })) live.on = true;
      if (safe(function () { return p.expressionEnabled && p.expression.indexOf(REVEAL_TAG) === 0; })) {
        rs = revealSpan(p, l);
        if (rs) out.push({ p: p, k: 0, t0: rs[0], t1: rs[1], linear: false, sampled: false, spring: false, reveal: true });
      }
      if (!p.numKeys || p.numKeys < 2) continue;
      for (k = 1; k < p.numKeys; k++) {
        v0 = safe(function () { return p.keyValue(k); }); v1 = safe(function () { return p.keyValue(k + 1); });
        if (v0 !== undefined && v1 !== undefined && typeof v0 !== "object" && v0 === v1) continue;
        if (v0 instanceof Array && v1 instanceof Array && dist(v0, v1) < 1e-6) continue;
        out.push({ p: p, k: k, t0: p.keyTime(k), t1: p.keyTime(k + 1),
          linear: p.keyOutInterpolationType(k) === KeyframeInterpolationType.LINEAR && p.keyInInterpolationType(k + 1) === KeyframeInterpolationType.LINEAR,
          sampled: p.numKeys > 8, spring: safe(function () { return p.expressionEnabled && p.expression.indexOf(SPRING_TAG) === 0; }) === true });
      }
    } else motionSegments(p, out, live, l);
  }
  return out;
}

// Merge issues of one type (and property) across layers into one entry with layer_ids and times; info-level issues
// become counts in stats.info unless all.
function groupIssues(list: Obj[], all: boolean, stats: Obj): Obj[] {
  var out: Obj[] = [], by: { [key: string]: Obj } = {}, i, x, k, g: Obj;
  for (i = 0; i < list.length; i++) {
    x = list[i];
    if (x.severity === "info" && !all) { stats.info = stats.info || {}; stats.info[x.type] = (stats.info[x.type] || 0) + 1; continue; }
    if (!has(x, "layer_id")) { out.push(x); continue; }
    k = x.type + "|" + (x.property || "") + "|" + (x.by || "");
    g = by[k];
    if (!g) {
      g = { type: x.type, severity: x.severity, msg: x.msg, layer_ids: [], t: [] };
      if (x.property) g.property = x.property;
      if (has(x, "size")) g.size = x.size;
      if (x.by) g.by = x.by;
      by[k] = g; out.push(g);
    }
    g.layer_ids.push(x.layer_id); if (has(x, "t")) g.t.push(x.t);
  }
  for (i = 0; i < out.length; i++) {
    g = out[i];
    if (g.layer_ids && g.layer_ids.length === 1) { g.layer_id = g.layer_ids[0]; delete g.layer_ids; g.t = g.t[0]; }
    else if (g.t && g.t.length) g.t = g.t[0]; // the first time; get the rest from the layers
  }
  return out;
}

// ---- scene checks: what the camera actually sees (review_motion) ----
// Read-only maths, nothing added to the project: each layer's content box is carried through its transform chain
// (2D matrices, or 4x4 for 3D) and, for 3D, projected through the active camera (or After Effects' default camera).

// 4x4 matrices as 16 numbers, row-major; points are columns [x, y, z, 1].
function m4mul(a: number[], b: number[]): number[] {
  var o: number[] = [], i, j, k, s;
  for (i = 0; i < 4; i++) for (j = 0; j < 4; j++) { s = 0; for (k = 0; k < 4; k++) s += a[i * 4 + k] * b[k * 4 + j]; o.push(s); }
  return o;
}
function m4pt(m: number[], v: number[]): Vec { return [m[0] * v[0] + m[1] * v[1] + m[2] * v[2] + m[3], m[4] * v[0] + m[5] * v[1] + m[6] * v[2] + m[7], m[8] * v[0] + m[9] * v[1] + m[10] * v[2] + m[11]]; }
function m4t(x: number, y: number, z: number): number[] { return [1, 0, 0, x, 0, 1, 0, y, 0, 0, 1, z, 0, 0, 0, 1]; }
function m4s(x: number, y: number, z: number): number[] { return [x, 0, 0, 0, 0, y, 0, 0, 0, 0, z, 0, 0, 0, 0, 1]; }
function m4rx(d: number): number[] { var c = Math.cos(rad(d)), s = Math.sin(rad(d)); return [1, 0, 0, 0, 0, c, -s, 0, 0, s, c, 0, 0, 0, 0, 1]; }
function m4ry(d: number): number[] { var c = Math.cos(rad(d)), s = Math.sin(rad(d)); return [c, 0, s, 0, 0, 1, 0, 0, -s, 0, c, 0, 0, 0, 0, 1]; }
function m4rz(d: number): number[] { var c = Math.cos(rad(d)), s = Math.sin(rad(d)); return [c, -s, 0, 0, s, c, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]; }

// A transform value at t after expressions; position is read per axis when its dimensions are separated.
function xval(l: Layer, match: string, t: number): Vec {
  var P = tp(l, match);
  if (match === "ADBE Position" && P.dimensionsSeparated) return [tp(l, "ADBE Position_0").valueAtTime(t, false), tp(l, "ADBE Position_1").valueAtTime(t, false), (l as AVLayer).threeDLayer ? tp(l, "ADBE Position_2").valueAtTime(t, false) : 0];
  return v3(copyArr(P.valueAtTime(t, false)));
}

// Layer space -> world (comp) space at t: position * orientation * rotation x/y/z * scale * -anchor, through parents.
function worldMatrix(l: Layer, t: number): number[] {
  var m: number[] | null = null, q: Layer | null, p, an, sc, o, r;
  for (q = l; q; q = q.parent) {
    p = xval(q, "ADBE Position", t); an = xval(q, "ADBE Anchor Point", t); sc = v3(copyArr(tp(q, "ADBE Scale").valueAtTime(t, false)));
    if (!(q as AVLayer).threeDLayer) { p[2] = 0; an[2] = 0; sc[2] = 100; }
    r = m4t(p[0], p[1], p[2]);
    if ((q as AVLayer).threeDLayer) {
      o = tp(q, "ADBE Orientation").valueAtTime(t, false);
      r = m4mul(r, m4mul(m4rx(o[0]), m4mul(m4ry(o[1]), m4rz(o[2]))));
      r = m4mul(r, m4mul(m4rx(tp(q, "ADBE Rotate X").valueAtTime(t, false)), m4ry(tp(q, "ADBE Rotate Y").valueAtTime(t, false))));
    }
    r = m4mul(r, m4mul(m4rz(tp(q, "ADBE Rotate Z").valueAtTime(t, false)), m4mul(m4s(sc[0] / 100, sc[1] / 100, sc[2] / 100), m4t(-an[0], -an[1], -an[2]))));
    m = m ? m4mul(r, m) : r;
  }
  return m!;
}

// The camera that sees the comp at t: its position, forward / right / down axes and zoom (After Effects' default
// camera when there is none). One-node cameras look along their orientation.
function viewAt(c: CompItem, t: number): CamView {
  var cam: CameraLayer | null = null, i, l, P, f, m, z;
  for (i = 1; i <= c.numLayers; i++) { l = c.layer(i); if (l instanceof CameraLayer && l.enabled && l.inPoint <= t && l.outPoint > t) { cam = l; break; } }
  if (!cam) { z = c.width * 50 / 36; return { P: [c.width / 2, c.height / 2, -z], f: [0, 0, 1], r: [1, 0, 0], d: [0, 1, 0], zoom: z }; }
  P = v3(copyArr(tp(cam, "ADBE Position").valueAtTime(t, false)));
  if (cam.autoOrient === AutoOrientType.CAMERA_OR_POINT_OF_INTEREST) f = vnorm(vsub(v3(copyArr(tp(cam, "ADBE Anchor Point").valueAtTime(t, false))), P));
  else { m = worldMatrix(cam, t); f = vnorm(vsub(m4pt(m, [0, 0, 1]), m4pt(m, [0, 0, 0]))); }
  var r = rightOf(f);
  return { P: P, f: f, r: r, d: [f[1] * r[2] - f[2] * r[1], f[2] * r[0] - f[0] * r[2], f[0] * r[1] - f[1] * r[0]], zoom: camOpt(cam, "ADBE Camera Zoom").valueAtTime(t, false) };
}

// A layer's box on screen at t, and its depth along the camera's view (0 for 2D layers, which are not seen through it).
function screenBox(l: AVLayer, c: CompItem, v: CamView, t: number): ScreenBox | null {
  var r = l.sourceRectAtTime(t, false), xs = [r.left, r.left + r.width], ys = [r.top, r.top + r.height], m = worldMatrix(l, t), three = false, q: Layer | null, i, j, w, d, k, x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9, ctr;
  for (q = l; q; q = q.parent) if ((q as AVLayer).threeDLayer) three = true;
  for (i = 0; i < 2; i++) for (j = 0; j < 2; j++) {
    w = m4pt(m, [xs[i], ys[j], 0]);
    if (three) {
      d = vsub(w, v.P); k = vdot(d, v.f);
      if (k < 1) return null; // behind the camera
      w = [c.width / 2 + v.zoom * vdot(d, v.r) / k, c.height / 2 + v.zoom * vdot(d, v.d) / k];
    }
    x0 = Math.min(x0, w[0]); y0 = Math.min(y0, w[1]); x1 = Math.max(x1, w[0]); y1 = Math.max(y1, w[1]);
  }
  ctr = m4pt(m, [r.left + r.width / 2, r.top + r.height / 2, 0]);
  return { x0: x0, y0: y0, x1: x1, y1: y1, three: three, z: three ? vdot(vsub(ctr, v.P), v.f) : 0 };
}

function sceneLayer(l: AVLayer, kind: string): boolean {
  if (!l.enabled || kind === "camera" || kind === "light" || kind === "null" || kind === "adjustment") return false;
  if (safe(function () { return l.guideLayer; }) || safe(function () { return l.hasAudio && !l.hasVideo; })) return false;
  return typeof l.sourceRectAtTime === "function";
}

// Solid colour that hides what is behind it: a solid, or a shape layer with a full-strength fill; normal blending,
// full opacity, no matte.
function opaqueAt(l: AVLayer, kind: string, t: number): boolean {
  if (kind !== "solid" && kind !== "shape") return false;
  if (l.blendingMode !== BlendingMode.NORMAL || safe(function () { return l.isTrackMatte || l.trackMatteType !== TrackMatteType.NO_TRACK_MATTE; })) return false;
  if ((safe(function () { return tp(l, "ADBE Opacity").valueAtTime(t, false); }) as number) < 99.5) return false;
  if (kind === "shape") return safe(function () { return shapeHasFill(l.property("ADBE Root Vectors Group")); }) === true;
  return true;
}

function shapeHasFill(g: any): boolean {
  var i, p;
  for (i = 1; i <= g.numProperties; i++) {
    p = g.property(i);
    if (p.matchName === "ADBE Vector Graphic - Fill" && p.enabled && p.property("ADBE Vector Fill Opacity").value >= 99.5) return true;
    if (p.matchName === "ADBE Vector Group" && p.enabled && shapeHasFill(p.property("ADBE Vectors Group"))) return true;
  }
  return false;
}

function sceneChecks(c: CompItem, issue: (o: Obj) => void): void {
  var ls: SceneItem[] = [], views: { [t: number]: CamView } = {}, boxes: { [key: string]: ScreenBox | null } = {}, i, j, l, kind, t: number, L: SceneItem, O, X, front, tt;
  if (c.numLayers > 400) return;
  function boxOf(x: SceneItem, at: number): ScreenBox | null {
    var k = x.l.id + "@" + at;
    if (!has(boxes, k)) boxes[k] = safe(function () { return screenBox(x.l, c, views[at] || (views[at] = viewAt(c, at)), at); }) || null;
    return boxes[k];
  }
  for (i = 1; i <= c.numLayers; i++) {
    l = c.layer(i) as AVLayer; kind = layerKind(l);
    if (sceneLayer(l, kind)) ls.push({ l: l, kind: kind, t: Math.round(Math.max(0, Math.min(c.duration - c.frameDuration, (l.inPoint + l.outPoint) / 2)) / c.frameDuration) * c.frameDuration });
  }
  for (i = 0; i < ls.length; i++) {
    L = ls[i]; t = L.t; tt = Math.round(t * 1000) / 1000;
    if ((safe(function () { return tp(L.l, "ADBE Opacity").valueAtTime(t, false); }) as number) < 1) continue;
    O = boxOf(L, t);
    if (!O) continue;
    if (O.x1 < 0 || O.x0 > c.width || O.y1 < 0 || O.y0 > c.height) {
      issue({ type: "off_screen", severity: "warn", layer_id: L.l.id, layer: L.l.name, t: tt, msg: "Entirely outside the frame (as the camera sees it)" });
      continue;
    }
    for (j = 0; j < ls.length; j++) {
      if (j === i || ls[j].l.inPoint > t || ls[j].l.outPoint <= t || !opaqueAt(ls[j].l, ls[j].kind, t)) continue;
      X = boxOf(ls[j], t);
      if (!X) continue;
      // in front: closer to the camera when both are 3D, otherwise higher in the layer stack
      front = X.three && O.three ? X.z < O.z - 1 : ls[j].l.index < L.l.index;
      if (!front) continue;
      if (X.x0 <= O.x0 + 1 && X.y0 <= O.y0 + 1 && X.x1 >= O.x1 - 1 && X.y1 >= O.y1 - 1) {
        issue({ type: "hidden", severity: "warn", layer_id: L.l.id, layer: L.l.name, t: tt, by: ls[j].l.name, msg: "Hidden behind " + ls[j].l.name + (X.three && O.three ? " (it is closer to the camera)" : "") });
        break;
      }
      if (L.kind === "text" && X.x0 < O.x1 && X.x1 > O.x0 && X.y0 < O.y1 && X.y1 > O.y0) {
        issue({ type: "covered", severity: "warn", layer_id: L.l.id, layer: L.l.name, t: tt, by: ls[j].l.name, msg: "Text partly covered by " + ls[j].l.name });
        break;
      }
    }
  }
}

C.review_motion = function (a: Args["review_motion"]) {
  need(a, ["comp_id"]);
  var c = getComp(a.comp_id), fd = c.frameDuration, maxHold = has(a, "max_hold") ? a.max_hold : 1, minText = has(a, "min_text") ? a.min_text : Math.round(c.height * 0.022),
    issues: Obj[] = [], spans: number[][] = [], events: number[] = [], starts: { [frame: string]: number[] } = {}, beats: number[] = [], lin: { [key: string]: boolean } = {}, i, j, l: AVLayer, segs: Seg[], s: Seg, kind, live: { on: boolean },
    first: number | null, fs: string, sc: any, mk, gap, cur, onBeat = 0, starts2: Obj[] = [], near: any, hold = 0, b, txt: any;
  function issue(o: Obj): void { issues.push(o); }
  mk = c.markerProperty;
  for (i = 1; i <= mk.numKeys; i++) if (mk.keyValue(i).comment === "beat") beats.push(mk.keyTime(i));
  for (i = 1; i <= c.numLayers; i++) {
    l = c.layer(i) as AVLayer; kind = layerKind(l);
    if (!l.enabled || kind === "light" || /^Audio Amplitude/.test(l.name)) continue;
    if (safe(function () { return l.guideLayer; }) || safe(function () { return l.hasAudio && !l.hasVideo; })) continue;
    if (l.inPoint > fd / 2) events.push(l.inPoint);
    if (l.outPoint < c.duration - fd / 2) events.push(l.outPoint);
    live = { on: false };
    segs = motionSegments(l, [], live, l);
    if (live.on || kind === "precomp" || (kind === "footage" && !safe(function () { return l.source.mainSource.isStill; }))) spans.push([l.inPoint, l.outPoint]);
    first = null;
    for (j = 0; j < segs.length; j++) {
      s = segs[j];
      spans.push([Math.max(s.t0, l.inPoint), Math.min(s.t1, l.outPoint)]);
      if (first === null || s.t0 < first) first = s.t0;
      starts2.push({ t: s.t0, layer_id: l.id });
      if (s.linear && !s.sampled && !s.spring && !lin[l.id + s.p.name]) {
        lin[l.id + s.p.name] = true;
        issue({ type: "linear", severity: "warn", layer_id: l.id, layer: l.name, property: s.p.name, t: s.t0, msg: "Linear keys: ease them (style snappy / smooth) or use animate" });
      }
      if (s.t1 > l.outPoint + fd / 2 && s.t0 < l.outPoint) issue({ type: "cut_off", severity: "warn", layer_id: l.id, layer: l.name, property: s.p.name, t: l.outPoint, msg: "The layer ends before this move finishes" });
      if (!s.reveal && s.t1 - s.t0 < 0.1 && s.p.matchName === "ADBE Position" && dist(s.p.keyValue(s.k), s.p.keyValue(s.k + 1)) > Math.min(c.width, c.height) * 0.1) {
        issue({ type: "jump", severity: "info", layer_id: l.id, layer: l.name, t: s.t0, msg: "Moves far in under 0.1 s: reads as a jump" });
      }
    }
    if (first !== null) { fs = String(Math.round(first / fd)); (starts[fs] = starts[fs] || []).push(l.id); }
    if (l.inPoint > fd / 2 && kind !== "adjustment" && kind !== "null" && kind !== "camera") {
      near = false;
      for (j = 0; j < segs.length; j++) if (segs[j].t0 <= l.inPoint + 0.25 && segs[j].t1 >= l.inPoint - fd) near = true;
      if (!near) issue({ type: "pops_on", severity: "info", layer_id: l.id, layer: l.name, t: l.inPoint, msg: "Appears with no entrance (fine for a hard cut; otherwise animate it in)" });
    }
    if (kind === "text") {
      txt = safe(function () { return l.property("ADBE Text Properties").property("ADBE Text Document").valueAtTime(l.inPoint, false); });
      sc = safe(function () { return tp(l, "ADBE Scale").valueAtTime(l.outPoint - fd, false); });
      if (txt && txt.fontSize && sc && txt.fontSize * Math.abs(sc[1]) / 100 < minText) {
        issue({ type: "small_text", severity: "warn", layer_id: l.id, layer: l.name, size: Math.round(txt.fontSize * Math.abs(sc[1]) / 100), msg: "Text under " + minText + " px is hard to read on a phone" });
      }
    }
  }
  for (fs in starts) {
    if (starts.hasOwnProperty(fs) && starts[fs].length >= 3) issue({ type: "unison", severity: "warn", t: parseInt(fs, 10) * fd, layer_ids: starts[fs], msg: starts[fs].length + " layers start moving on the same frame: stagger them 0.03-0.08 s (animate stagger)" });
  }
  // holds: stretches with nothing moving and no cut
  for (i = 0; i < events.length; i++) spans.push([events[i], events[i]]);
  spans.sort(function (x, y) { return x[0] - y[0]; });
  cur = 0;
  for (i = 0; i <= spans.length; i++) {
    b = i < spans.length ? spans[i] : [c.duration, c.duration];
    gap = b[0] - cur;
    if (gap > hold) hold = gap;
    if (gap > maxHold + fd / 2) issue({ type: "hold", severity: gap > maxHold * 2 ? "warn" : "info", t: Math.round(cur * 1000) / 1000, duration: Math.round(gap * 1000) / 1000, msg: "Nothing moves for " + (Math.round(gap * 10) / 10) + " s" });
    if (b[1] > cur) cur = b[1];
  }
  // beat sync: how many moves start within a frame and a half of a beat marker
  if (beats.length >= 4 && starts2.length) {
    for (i = 0; i < starts2.length; i++) {
      near = 1e9;
      for (j = 0; j < beats.length; j++) near = Math.min(near, Math.abs(beats[j] - starts2[i].t));
      if (near <= fd * 1.5) onBeat++;
    }
  }
  if (a.scene !== false) sceneChecks(c, issue);
  // one entry per kind of problem: the same issue on several layers lists them together; info notes are only
  // counted unless all is set
  issues = groupIssues(issues, a.all === true, sc = {});
  issues.sort(function (x, y) { return (x.severity === y.severity ? 0 : (x.severity === "warn" ? -1 : 1)) || ((x.t || 0) - (y.t || 0)); });
  sc.layers = c.numLayers; sc.moves = starts2.length; sc.longest_hold = Math.round(hold * 1000) / 1000;
  if (beats.length >= 4 && starts2.length) sc.on_beat = Math.round(onBeat / starts2.length * 100) / 100;
  if (issues.length > (a.max || 30)) { sc.more_issues = issues.length - (a.max || 30); issues = issues.slice(0, a.max || 30); }
  return { issues: issues, stats: sc };
};
