// Sound effects: placing sound files on their loudest moment (add_sfx) and finding where the animation wants a
// sound (find_sound_cues). (src/tools/audio.ts; the amplitude analysis they share is in commands/audio.ts)

/** Adds one sound cue (find_sound_cues): the layer, time, event, suggested sound, strength 0-1, and its duration. */
type PushCue = (layer: Layer, t: number, event: string, sound: string, strength: number, duration?: number) => void;

// ---- Sound effects ----

var SFX_SILENT = -48; // dB used for the ends of fades
var SFX_PEAKS: { [path: string]: number } = {}; // file path -> seconds from the file's start to its loudest frame (cached per session)

// The footage item for a sound file: an existing import of the same file is reused.
function soundItem(path: string): FootageItem {
  var f = new File(path), i, it: _ItemClasses, io;
  if (!f.exists) fail("NOT_FOUND", "Sound file not found: " + path);
  for (i = 1; i <= app.project.numItems; i++) {
    it = app.project.item(i);
    if (it instanceof FootageItem && safe(function () { return (it as FootageItem).file && (it as FootageItem).file!.fsName === f.fsName; })) return it;
  }
  io = new ImportOptions(f);
  if (!io.canImportAs(ImportAsType.FOOTAGE)) fail("BAD_ARGS", "File cannot be imported: " + path);
  io.importAs = ImportAsType.FOOTAGE;
  it = app.project.importFile(io);
  if (!(it as FootageItem).hasAudio) { it.remove(); fail("BAD_ARGS", "File has no audio: " + path); }
  return it as FootageItem;
}

// Seconds from the start of an audio layer's source to its loudest frame (the layer starts at 0 while measured).
function loudestOffset(l: AVLayer, key: string): number {
  var amp, ser, i, best = 0;
  if (SFX_PEAKS.hasOwnProperty(key)) return SFX_PEAKS[key];
  amp = amplitudeNull(l, false);
  ser = keySeries(channelSlider(amp, 3)!);
  removeAmplitude(amp);
  for (i = 1; i < ser.v.length; i++) { if (ser.v[i] > ser.v[best]) best = i; }
  SFX_PEAKS[key] = ser.t.length ? ser.t[best] - l.startTime : 0;
  return SFX_PEAKS[key];
}

C.add_sfx = function (a: Args["add_sfx"]) {
  need(a, ["comp_id", "path", "time"]);
  var c = getComp(a.comp_id), it = soundItem(a.path), l = c.layers.add(it), align = a.align || "peak",
    vol = has(a, "volume") ? a.volume : -6, fi = a.fade_in || 0, fo = a.fade_out || 0, peak = 0, lv, s, e, hit = snapT(c, a.time);
  if (align !== "peak" && align !== "start") fail("BAD_ARGS", "align must be peak or start");
  l.name = a.name || "SFX: " + it.name;
  l.startTime = 0;
  if (align === "peak") peak = loudestOffset(l, new File(a.path).fsName);
  l.startTime = snapT(c, a.time - peak);
  // lead_in: how much of the sound to keep before the hit (a long build-up can swamp what comes before); a cut head
  // gets a short fade so it does not click. max_duration counts from the hit when aligning a peak, so a trim never
  // removes the moment the sound was placed for.
  if (has(a, "lead_in") && hit - a.lead_in > l.inPoint + 1e-6) {
    setIn(l, Math.max(0, snapT(c, hit - a.lead_in)));
    if (!fi) fi = Math.min(0.02, a.lead_in);
  }
  if (has(a, "max_duration")) l.outPoint = Math.min(l.outPoint, (align === "peak" ? hit : l.inPoint) + a.max_duration);
  s = l.inPoint; e = l.outPoint;
  if (fi + fo > e - s) fail("BAD_ARGS", "fade_in + fade_out is longer than the sound");
  lv = l.property("ADBE Audio Group").property("ADBE Audio Levels");
  if (fi > 0 || fo > 0) {
    lv.setValueAtTime(fi > 0 ? s + fi : s, [vol, vol]);
    lv.setValueAtTime(fo > 0 ? e - fo : e, [vol, vol]);
    if (fi > 0) lv.setValueAtTime(s, [SFX_SILENT, SFX_SILENT]);
    if (fo > 0) lv.setValueAtTime(e, [SFX_SILENT, SFX_SILENT]);
  } else lv.setValue([vol, vol]);
  return { layer: layerRef(l), start: l.startTime, peak_offset: peak, hit: hit, "in": s, out: e, volume: vol };
};

// Keyframe segments [t0, t1] of a property with their start and end values.
function segments(p: Prop): { t0: number; t1: number; v0: any; v1: any }[] {
  var out: { t0: number; t1: number; v0: any; v1: any }[] = [], i;
  for (i = 1; i < p.numKeys; i++) out.push({ t0: p.keyTime(i), t1: p.keyTime(i + 1), v0: p.keyValue(i), v1: p.keyValue(i + 1) });
  return out;
}

function dist(a: any, b: any): number {
  var s = 0, i;
  if (typeof a === "number") return Math.abs(b - a);
  for (i = 0; i < a.length; i++) s += (b[i] - a[i]) * (b[i] - a[i]);
  return Math.sqrt(s);
}

// The frame of fastest change in [t0, t1], and the speed there compared with the speed into t1.
function fastest(p: Prop, t0: number, t1: number, fd: number): { t: number; speed: number; end: number } {
  var best = t0, top = 0, t, d, prev = p.valueAtTime(t0, false), endSpeed = 0;
  for (t = t0 + fd; t <= t1 + 1e-6; t += fd) {
    d = dist(prev, p.valueAtTime(t, false)) / fd;
    if (d > top) { top = d; best = t - fd / 2; }
    endSpeed = d;
    prev = p.valueAtTime(t, false);
  }
  return { t: best, speed: top, end: endSpeed };
}

// Every keyframed property under a group whose match name is in names (text selectors, trim paths and so on).
function keyedUnder(g: any, names: { [matchName: string]: number }, out: Prop[]): Prop[] {
  var i, p;
  if (!g) return out;
  for (i = 1; i <= g.numProperties; i++) {
    p = g.property(i);
    if (p.propertyType === PropertyType.PROPERTY) { if (names[p.matchName] && p.numKeys >= 2) out.push(p); }
    else keyedUnder(p, names, out);
  }
  return out;
}

var CUE_TYPE_ON: { [matchName: string]: number } = { "ADBE Text Percent Start": 1, "ADBE Text Percent End": 1, "ADBE Text Index Start": 1, "ADBE Text Index End": 1 };
var CUE_DRAW_ON: { [matchName: string]: number } = { "ADBE Vector Trim Start": 1, "ADBE Vector Trim End": 1 };

// The sound cues of one layer, from its keyframes.
function layerCues(l: AVLayer, c: CompItem, push: PushCue): void {
  var fd = c.frameDuration, small = Math.min(c.width, c.height), kind = layerKind(l), segs, i, s, f, p, ps: Prop[], k, v0, v1, mx;
  if (l.inPoint > 0.05) push(l, l.inPoint, "appear", "pop", 0.35);
  p = safe(function () { return tp(l, "ADBE Position"); });
  if (p && !p.dimensionsSeparated && p.numKeys >= 2) {
    segs = segments(p);
    for (i = 0; i < segs.length; i++) {
      s = segs[i];
      if (dist(s.v0, s.v1) < small * 0.12 || s.t1 - s.t0 > 1.5) continue;
      f = fastest(p, s.t0, s.t1, fd);
      push(l, f.t, kind === "camera" ? "camera_move" : "move", "whoosh", Math.min(1, f.speed / (c.width * 2)));
      if (f.end > f.speed * 0.6) push(l, s.t1, "land", "impact", Math.min(1, f.end / (c.width * 2)));
    }
  }
  p = safe(function () { return tp(l, "ADBE Scale"); });
  if (p && p.numKeys >= 2) {
    segs = segments(p);
    for (i = 0; i < segs.length; i++) {
      s = segs[i];
      v0 = typeof s.v0 === "number" ? s.v0 : s.v0[0]; v1 = typeof s.v1 === "number" ? s.v1 : s.v1[0];
      if (s.t1 - s.t0 > 0.8) continue;
      if (v0 <= 20 && v1 >= 60) push(l, s.t1, "pop_in", "pop", 0.7);
      else if (v0 >= 60 && v1 <= 20) push(l, s.t0, "pop_out", "pop", 0.5);
    }
  }
  p = safe(function () { return tp(l, "ADBE Rotate Z"); });
  if (p && p.numKeys >= 2) {
    segs = segments(p);
    for (i = 0; i < segs.length; i++) {
      s = segs[i];
      if (Math.abs(s.v1 - s.v0) >= 90 && s.t1 - s.t0 <= 1) { f = fastest(p, s.t0, s.t1, fd); push(l, f.t, "spin", "whoosh", 0.6); }
    }
  }
  p = safe(function () { return tp(l, "ADBE Opacity"); });
  if (p && p.numKeys >= 2) {
    segs = segments(p);
    for (i = 0; i < segs.length; i++) {
      s = segs[i];
      if (s.v0 <= 10 && s.v1 >= 80 && s.t1 - s.t0 <= 0.25) push(l, s.t1, "flash_in", "pop", 0.4);
    }
  }
  if (kind === "text") revealCues(l, push);
  ps = [];
  if (kind === "text") keyedUnder(l.property("ADBE Text Properties"), CUE_TYPE_ON, ps);
  if (kind === "shape") keyedUnder(l.property("ADBE Root Vectors Group"), CUE_DRAW_ON, ps);
  for (i = 0; i < ps.length; i++) {
    k = ps[i];
    mx = k.keyTime(k.numKeys) - k.keyTime(1);
    push(l, k.keyTime(1), kind === "text" ? "type_on" : "draw_on", kind === "text" ? "typing" : "swipe", 0.5, mx);
  }
}

// text_reveal animations (expression selectors): one cue for the whole reveal, not one per letter.
function revealCues(l: AVLayer, push: PushCue): void {
  var ans = safe(function () { return l.property("ADBE Text Properties").property("ADBE Text Animators"); }), i: number, sel: any, amt, sp;
  for (i = 1; ans && i <= ans.numProperties; i++) {
    sel = safe(function () { return ans.property(i).property("ADBE Text Selectors").property(1); });
    amt = sel ? safe(function () { return sel.property("ADBE Text Expressible Amount"); }) : null;
    if (!amt || !amt.expressionEnabled || amt.expression.indexOf(REVEAL_TAG) !== 0) continue;
    sp = revealSpan(amt, l);
    if (sp) push(l, sp[0] + Math.min(0.12, (sp[1] - sp[0]) / 2), "reveal", "swoosh", 0.5, sp[1] - sp[0]);
  }
}

// How much a sound designer cares about each kind of moment (before strength).
var CUE_WEIGHT: { [event: string]: number } = { land: 1, cut: 0.7, camera_move: 0.8, move: 0.65, pop_in: 0.6, reveal: 0.55, spin: 0.5, draw_on: 0.5, type_on: 0.5, pop_out: 0.4, flash_in: 0.35, appear: 0.3 };
// cues per second and the minimum spacing between cues at each density
var CUE_DENSITY: { [density: string]: number[] } = { sparse: [1, 0.45], normal: [1.6, 0.25], dense: [3.5, 0.12] };

C.find_sound_cues = function (a: Args["find_sound_cues"]) {
  need(a, ["comp_id"]);
  var c = getComp(a.comp_id), fd = c.frameDuration, s = has(a, "start") ? a.start : 0, e = has(a, "end") ? a.end : c.duration,
    dens = CUE_DENSITY[a.density || "normal"], pick: { [id: number]: boolean } = {}, cues: Obj[] = [], own: Obj[] = [], groups: Obj[] = [], out: Obj[] = [],
    ends: { [frame: number]: boolean } = {}, i, l: any, j, q, g, kept, max, gap, chosen: Obj[], kind;
  if (!dens) fail("BAD_ARGS", "density must be sparse, normal or dense");
  max = a.max || Math.max(3, Math.round((e - s) * dens[0]));
  gap = has(a, "min_gap") ? a.min_gap : dens[1];
  if (has(a, "layer_ids")) { for (i = 0; i < a.layer_ids.length; i++) pick[a.layer_ids[i]] = true; }
  function push(layer: Layer, t: number, event: string, sound: string, strength: number, duration?: number): void {
    var cue: Obj = { t: snapT(c, t), layer_id: layer.id, layer: layer.name, event: event, sound: sound, strength: Math.round(strength * 100) / 100 };
    if (duration) cue.duration = Math.round(duration * 1000) / 1000;
    cues.push(cue);
  }
  for (i = 1; i <= c.numLayers; i++) {
    l = c.layer(i);
    if (!l.enabled || safe(function () { return l.guideLayer; }) || /^Audio Amplitude/.test(l.name) || l instanceof LightLayer) continue;
    if (safe(function () { return l.hasAudio && !l.hasVideo; })) continue;
    if (l.outPoint < c.duration - fd / 2) ends[Math.round(l.outPoint / fd)] = true;
    if (has(a, "layer_ids") && !pick[l.id]) continue;
    layerCues(l, c, push);
  }
  cues.sort(function (x, y) { return x.t - y.t; });
  // 1. one layer: a plain entrance is covered by its own animated entrance soon after; one sound twice within 0.15 s is one
  for (i = 0; i < cues.length; i++) {
    q = cues[i]; kept = q.t >= s - 1e-6 && q.t <= e + 1e-6;
    for (j = 0; kept && j < cues.length; j++) {
      if (j === i || cues[j].layer_id !== q.layer_id) continue;
      if (q.event === "appear" && cues[j].event !== "appear" && cues[j].t >= q.t - 1e-6 && cues[j].t - q.t <= 0.5) kept = false;
      else if (cues[j].sound === q.sound && Math.abs(cues[j].t - q.t) < 0.15 && (cues[j].strength > q.strength || (cues[j].strength === q.strength && j < i))) kept = false;
    }
    if (kept) own.push(q);
  }
  // 2. across layers: what happens together is one sound (debris flying out, a whole card cutting in). Entrances on the
  // frame where other layers end, or several at once, are a cut: one hit.
  for (i = 0; i < own.length; i++) {
    q = own[i]; g = null; kind = q.event === "appear" ? "appear" : q.sound; // entrances group apart: together they may be a cut
    for (j = 0; j < groups.length && !g; j++) if (groups[j].kind === kind && Math.abs(groups[j].t - q.t) <= fd + 1e-6) g = groups[j];
    if (!g) { g = { t: q.t, kind: kind, cues: [] }; groups.push(g); }
    g.cues.push(q);
  }
  for (i = 0; i < groups.length; i++) {
    g = groups[i]; g.cues.sort(function (x: Obj, y: Obj) { return y.strength - x.strength; });
    q = g.cues[0]; l = { t: q.t, layer_id: q.layer_id, layer: q.layer, event: q.event, sound: q.sound, strength: q.strength };
    if (q.duration) l.duration = q.duration;
    if (g.cues.length > 1) { l.layer_ids = []; for (j = 0; j < g.cues.length; j++) l.layer_ids.push(g.cues[j].layer_id); }
    if (q.event === "appear" && (g.cues.length > 1 || ends[Math.round(q.t / fd)])) { l.event = "cut"; l.sound = "hit"; l.strength = Math.min(1, 0.5 + 0.1 * g.cues.length); }
    l.priority = Math.round((CUE_WEIGHT[l.event] || 0.3) * (0.5 + 0.5 * l.strength) * (1 + 0.1 * Math.min(4, g.cues.length - 1)) * 100) / 100;
    if (l.event === "land") l.priority = Math.max(l.priority, 0.95); // an impact is always the moment to sound
    l.tier = l.priority >= 0.6 ? "hero" : (l.priority >= 0.4 ? "major" : "minor");
    out.push(l);
  }
  // 3. the budget: the most important cues first, each at least gap from the ones already kept
  out.sort(function (x, y) { return y.priority - x.priority || x.t - y.t; });
  chosen = [];
  for (i = 0; i < out.length && chosen.length < max; i++) {
    kept = true;
    for (j = 0; j < chosen.length && kept; j++) if (Math.abs(chosen[j].t - out[i].t) < gap - 1e-6) kept = false;
    if (kept) chosen.push(out[i]);
  }
  chosen.sort(function (x, y) { return x.t - y.t; });
  return { count: chosen.length, skipped: out.length - chosen.length, cues: chosen };
};
