// Audio: beats as markers, and properties driven by loudness. Both read After Effects' own analysis
// (Animation > Keyframe Assistant > Convert Audio to Keyframes): a null with Left / Right / Both Channels sliders,
// keyed once per frame. (src/tools/timeline.ts)

/** A slider's keys (one per frame): times and values. */
type Series = { t: number[]; v: number[] };
/** Adds one sound cue (find_sound_cues): the layer, time, event, suggested sound, strength 0-1, and its duration. */
type PushCue = (layer: Layer, t: number, event: string, sound: string, strength: number, duration?: number) => void;

var AUDIO_NULL_PREFIX = "Audio Amplitude: ";

function hasAudioOn(l: AVLayer): boolean { return safe(function () { return l.hasAudio === true && l.audioEnabled === true; }) === true; }

// The slider of an amplitude null's channel effect (1 left, 2 right, 3 both). Effect names are localized, so by index.
function channelSlider(l: Layer, ch: number): Prop | null {
  var fx = safe(function () { return l.property("ADBE Effect Parade"); });
  if (!fx || fx.numProperties < 3) return null;
  return safe(function () { return fx.property(ch).property(1); }) || null;
}

// The amplitude null for an audio layer. With reuse, an existing one (by name) is returned. Otherwise the menu
// command runs with only this layer audible and the work area set to it (it analyses the comp's audio in the work
// area); other layers' audio and the work area are restored afterwards, even on failure.
function amplitudeNull(audio: AVLayer, reuse: boolean): AVLayer {
  var c = audio.containingComp, name = AUDIO_NULL_PREFIX + audio.name, before: { [id: number]: boolean } = {}, muted: AVLayer[] = [], made: AVLayer | null = null,
    ws = c.workAreaStart, wd = c.workAreaDuration, s = Math.max(0, audio.inPoint), e = Math.min(c.duration, audio.outPoint), i, l: AVLayer;
  if (reuse) for (i = 1; i <= c.numLayers; i++) { if (c.layer(i).name === name && channelSlider(c.layer(i), 3)) return c.layer(i) as AVLayer; }
  if (!safe(function () { return audio.hasAudio === true; })) fail("BAD_ARGS", "Layer " + audio.name + " has no audio", "Pass an audio (or video with sound) layer");
  if (e - s < c.frameDuration) fail("BAD_ARGS", "The audio layer is not inside the comp's duration", "Move it into the comp (shift_layers) or lengthen the comp (set_comp duration)");
  for (i = 1; i <= c.numLayers; i++) {
    l = c.layer(i) as AVLayer;
    before[l.id] = true;
    if (l !== audio && hasAudioOn(l)) { l.audioEnabled = false; muted.push(l); }
  }
  try {
    if (!audio.audioEnabled) audio.audioEnabled = true;
    setWorkArea(c, s, e - s);
    selectOnly(audio);
    runMenu("Convert Audio to Keyframes", 0);
    for (i = 1; i <= c.numLayers; i++) { if (!before[c.layer(i).id]) { made = c.layer(i) as AVLayer; break; } }
  } finally {
    for (i = 0; i < muted.length; i++) muted[i].audioEnabled = true;
    setWorkArea(c, ws, wd);
  }
  if (!made || !channelSlider(made, 3)) fail("AE_ERROR", "Convert Audio to Keyframes did not create its amplitude layer", "Check that the layer's audio switch is on and the track is not silent");
  made!.name = name;
  return made!;
}

// Delete a temporary amplitude null and its source item (the null's solid would stay in the project otherwise).
function removeAmplitude(amp: AVLayer): void {
  var src = safe(function () { return amp.source; });
  amp.remove();
  if (src && safe(function () { return src.usedIn.length === 0; })) src.remove();
}

// Key times and values of a slider (one key per frame).
function keySeries(p: Prop): Series {
  var ts: number[] = [], vs: number[] = [], i;
  for (i = 1; i <= p.numKeys; i++) { ts.push(p.keyTime(i)); vs.push(p.keyValue(i)); }
  return { t: ts, v: vs };
}

// Beat onsets from per-frame loudness: frames where the loudness rises sharply compared with the rises around them
// (an adaptive threshold, so quiet and loud passages both work) and by a real fraction of the track's loud level.
// A beat is reported at the first frame of its rise.
// sensitivity 0-1 (higher finds more, softer beats); minGap in seconds between beats.
function pickBeats(ts: number[], vs: number[], fps: number, sensitivity: number, minGap: number): number[] {
  var n = vs.length, o: number[] = [], beats: number[] = [], mx = 0, last = -1e9, w = Math.max(2, Math.round(fps * 0.4)),
    k = 1 + 3 * (1 - sensitivity), floor, i, j, sum, cnt, t;
  for (i = 0; i < n; i++) { o[i] = i ? Math.max(0, vs[i] - vs[i - 1]) : 0; if (o[i] > mx) mx = o[i]; }
  if (mx <= 0) return beats;
  // a beat must also rise by a real fraction of the track's loud level, or noise and hiss would count
  floor = Math.max(mx * 0.12, quantile(vs, 0.9) * 0.2) * (1.5 - sensitivity);
  for (i = 1; i < n; i++) {
    if (o[i] <= 0 || o[i] < o[i - 1] || (i + 1 < n && o[i] < o[i + 1])) continue; // the steepest frame of a rise
    sum = 0; cnt = 0;
    for (j = Math.max(0, i - w); j <= Math.min(n - 1, i + w); j++) { sum += o[j]; cnt++; }
    if (o[i] < Math.max(k * sum / cnt, floor)) continue;
    j = i;
    while (j > 1 && o[j - 1] > o[i] * 0.25) j--; // back to where the rise starts
    t = ts[j];
    if (t - last < minGap) continue;
    beats.push(t);
    last = t;
  }
  return beats;
}

// Tempo from beat spacing: the mean of the gaps near the median gap (beats sit on whole frames, so single gaps are
// a frame off), folded into 70-180 BPM.
function estimateBpm(beats: number[]): number | null {
  var g: number[] = [], i, m, sum = 0, cnt = 0, bpm;
  for (i = 1; i < beats.length; i++) g.push(beats[i] - beats[i - 1]);
  if (!g.length) return null;
  g.sort(function (x, y) { return x - y; });
  m = g[Math.floor(g.length / 2)];
  if (m <= 0) return null;
  for (i = 0; i < g.length; i++) { if (Math.abs(g[i] - m) <= m * 0.2) { sum += g[i]; cnt++; } }
  bpm = 60 / (sum / cnt);
  while (bpm < 70) bpm *= 2;
  while (bpm > 180) bpm /= 2;
  return Math.round(bpm * 10) / 10;
}

// Value at fraction q (0-1) of the sorted values.
function quantile(vs: number[], q: number): number {
  var s = vs.slice(0);
  s.sort(function (x, y) { return x - y; });
  return s.length ? s[Math.min(s.length - 1, Math.max(0, Math.round(q * (s.length - 1))))] : 0;
}

C.beat_markers = function (a: Args["beat_markers"]) {
  need(a, ["audio_layer_id"]);
  var audio = getLayer(a.audio_layer_id), c = audio.containingComp, fps = c.frameRate, every = a.every || 1,
    s = has(a, "start") ? a.start : Math.max(0, audio.inPoint), e = has(a, "end") ? a.end : Math.min(c.duration, audio.outPoint),
times: number[] = [], picked: number[] = [], prop = a.on === "layer" ? audio.property("ADBE Marker") : c.markerProperty, amp, ser, bpm, t, i, step, removed = 0;
  if (e <= s) fail("BAD_ARGS", "end must be after start");
  if (has(a, "bpm")) {
    if (!(a.bpm > 0)) fail("BAD_ARGS", "bpm must be positive");
    step = 60 / a.bpm;
    for (t = has(a, "offset") ? a.offset : s; t < e - 1e-6; t += step) { if (t >= s - 1e-6) times.push(t); }
    bpm = a.bpm;
  } else {
    amp = amplitudeNull(audio, false);
    ser = keySeries(channelSlider(amp, 3)!);
    if (!a.keep_amplitude) removeAmplitude(amp);
    times = pickBeats(ser.t, ser.v, fps, has(a, "sensitivity") ? a.sensitivity : 0.5, has(a, "min_gap") ? a.min_gap : 0.2);
    bpm = estimateBpm(times);
    for (i = times.length - 1; i >= 0; i--) { if (times[i] < s - 1e-6 || times[i] > e + 1e-6) times.splice(i, 1); }
  }
  for (i = 0; i < times.length; i += every) picked.push(snapT(c, times[i]));
  if (a.replace !== false) {
    for (i = prop.numKeys; i >= 1; i--) {
      t = prop.keyTime(i);
      if (t >= s - 1e-6 && t <= e + 1e-6 && prop.keyValue(i).comment === "beat") { prop.removeKey(i); removed++; }
    }
  }
  for (i = 0; i < picked.length; i++) prop.setValueAtTime(picked[i], new MarkerValue("beat"));
  return { count: picked.length, bpm: bpm, on: a.on === "layer" ? "layer" : "comp", times: picked.slice(0, 300), replaced: removed };
};

C.audio_react = function (a: Args["audio_react"]) {
  need(a, ["audio_layer_id", "layer_ids", "path", "from", "to"]);
  var audio = getLayer(a.audio_layer_id), ch = { left: 1, right: 2, both: 3 }[a.channel || "both"], n = a.smoothing || 2,
    amp, vs, lo, hi, ex, r;
  if (!ch) fail("BAD_ARGS", "channel must be left, right or both");
  amp = amplitudeNull(audio, true);
  vs = keySeries(channelSlider(amp, ch)!).v;
  // the quiet floor and loud ceiling of this track, so from/to span what the music actually does
  lo = quantile(vs, 0.05); hi = quantile(vs, 0.97);
  if (hi - lo < 1e-6) fail("BAD_ARGS", "The track is (almost) silent: nothing to react to", "Check the layer is not muted (set_layer audio) and its volume is up");
  ex = "// ae-motion audio\n" +
    "var a = thisComp.layer(" + JSON.stringify(amp.name) + ").effect(" + ch + ")(1), n = " + n + ", s = 0;\n" +
    "for (var i = 0; i < n; i++) s += a.valueAtTime(time - i * thisComp.frameDuration);\n" +
    "linear(s / n, " + (Math.round(lo * 1000) / 1000) + ", " + (Math.round(hi * 1000) / 1000) + ", " + JSON.stringify(a.from) + ", " + JSON.stringify(a.to) + ");";
  r = C.set_expression({ layer_ids: a.layer_ids, path: a.path, expression: ex });
  return { amplitude_layer: layerRef(amp), range: [lo, hi], set: r.set, valid: r.valid, errors: r.errors };
};

// ---- Sound effects ----

var SFX_SILENT = -48; // dB used for the ends of fades
var SFX_PEAKS: { [path: string]: number } = {}; // file path -> seconds from the file's start to its loudest frame (cached per session)

// The footage item for a sound file: an existing import of the same file is reused.
function soundItem(path: string): FootageItem {
  var f = new File(path), i, it: _ItemClasses, io;
  if (!f.exists) fail("NOT_FOUND", "Sound file not found: " + path, "Check the path; paths must be inside the allowed folders (AE_MCP_ALLOWED_DIRS)");
  for (i = 1; i <= app.project.numItems; i++) {
    it = app.project.item(i);
    if (it instanceof FootageItem && safe(function () { return (it as FootageItem).file && (it as FootageItem).file!.fsName === f.fsName; })) return it;
  }
  io = new ImportOptions(f);
  if (!io.canImportAs(ImportAsType.FOOTAGE)) fail("BAD_ARGS", "File cannot be imported: " + path, "Use WAV, AIFF, MP3 or another format After Effects imports");
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
  if (fi + fo > e - s) fail("BAD_ARGS", "fade_in + fade_out is longer than the sound", "Shorten fade_in / fade_out, or raise max_duration");
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

// The first frame in [t0, t1] where p has covered share of its change from v0 to v1 (t1 if it never does). A pop is
// heard when the layer arrives: with a spring or a snappy ease that is well before the last key, where it only settles.
function reached(p: Prop, t0: number, t1: number, v0: number, v1: number, share: number, fd: number): number {
  var t, v;
  for (t = t0; t <= t1 + 1e-6; t += fd) {
    v = p.valueAtTime(t, false); v = typeof v === "number" ? v : v[0];
    if ((v - v0) / (v1 - v0) >= share) return t;
  }
  return t1;
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
      if (v0 <= 20 && v1 >= 60) push(l, reached(p, s.t0, s.t1, v0, v1, 0.97, fd), "pop_in", "pop", 0.7);
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
// A cut is weighted low: a hit on every cut is the over-edited sound; story events (find_sound_cues events) raise the
// ones that matter.
var CUE_WEIGHT: { [event: string]: number } = { land: 1, cut: 0.4, camera_move: 0.8, move: 0.65, pop_in: 0.6, reveal: 0.55, spin: 0.5, draw_on: 0.5, type_on: 0.5, pop_out: 0.4, flash_in: 0.35, appear: 0.3 };
// how far (s) a story event reaches to the motion cue it is about
var EVENT_WINDOW = 0.5;
// cues per second and the minimum spacing between cues at each density
var CUE_DENSITY: { [density: string]: number[] } = { sparse: [1, 0.45], normal: [1.6, 0.25], dense: [3.5, 0.12] };

C.find_sound_cues = function (a: Args["find_sound_cues"]) {
  need(a, ["comp_id"]);
  var c = getComp(a.comp_id), fd = c.frameDuration, s = has(a, "start") ? a.start : 0, e = has(a, "end") ? a.end : c.duration,
    dens = CUE_DENSITY[a.density || "normal"], pick: { [id: number]: boolean } = {}, cues: Obj[] = [], own: Obj[] = [], groups: Obj[] = [], out: Obj[] = [],
    ends: { [frame: number]: boolean } = {}, i, l: any, j, q, g, kept, max, gap, chosen: Obj[], kind, ev;
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
  // 3. story events (what the moment means, from the model): the nearest motion cue within EVENT_WINDOW takes the
  // event's importance (and keeps its frame-exact time); an event with no motion near it is a cue of its own;
  // importance 0 mutes the cues near it
  if (has(a, "events")) {
    for (i = 0; i < a.events.length; i++) {
      ev = a.events[i];
      if (ev.t < s - 1e-6 || ev.t > e + 1e-6) continue;
      if (ev.importance === 0) { for (j = out.length - 1; j >= 0; j--) if (Math.abs(out[j].t - ev.t) <= EVENT_WINDOW + 1e-6) out.splice(j, 1); continue; }
      q = null;
      for (j = 0; j < out.length; j++) if (Math.abs(out[j].t - ev.t) <= EVENT_WINDOW + 1e-6 && (!q || Math.abs(out[j].t - ev.t) < Math.abs(q.t - ev.t))) q = out[j];
      if (!q) { q = { t: snapT(c, ev.t), event: "story", sound: ev.importance >= 0.8 ? "impact" : "accent", strength: ev.importance }; out.push(q); }
      q.priority = ev.importance;
      if (ev.label) q.story = ev.label;
      if (ev.sound) q.sound = ev.sound;
      q.tier = q.priority >= 0.6 ? "hero" : (q.priority >= 0.4 ? "major" : "minor");
    }
  }
  // 4. the budget: the most important cues first, each at least gap from the ones already kept
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

// ---- Ducking ----

// When a layer's audio is actually audible, as [start, end] comp times: frames above a tenth of its loud level,
// with gaps under 0.3 s bridged (pauses between words).
function audibleSpans(l: AVLayer): number[][] {
  var amp = amplitudeNull(l, false), ser = keySeries(channelSlider(amp, 3)!), thr, out: number[][] = [], i, on = -1, last = -1, fd = l.containingComp.frameDuration;
  removeAmplitude(amp);
  thr = quantile(ser.v, 0.9) * 0.1;
  for (i = 0; i < ser.v.length; i++) {
    if (ser.v[i] <= thr || ser.v[i] <= 0) continue;
    if (on < 0 || ser.t[i] - last > 0.3) { if (on >= 0) out.push([on, last + fd]); on = ser.t[i]; }
    last = ser.t[i];
  }
  if (on >= 0) out.push([on, last + fd]);
  return out;
}

// Spans sorted and merged when closer than gap (so the music does not pump between close sounds).
function mergeSpans(spans: number[][], gap: number): number[][] {
  var out: number[][] = [], i, s;
  spans.sort(function (x, y) { return x[0] - y[0]; });
  for (i = 0; i < spans.length; i++) {
    s = spans[i];
    if (out.length && s[0] - out[out.length - 1][1] < gap) out[out.length - 1][1] = Math.max(out[out.length - 1][1], s[1]);
    else out.push([s[0], s[1]]);
  }
  return out;
}

// A layer's loudest volume setting in dB (its audio levels' keys, or its static level).
function layerLevel(l: Layer): number {
  var lv = safe(function () { return l.property("ADBE Audio Group").property("ADBE Audio Levels"); }), mx = -1e9, i, v;
  if (!lv) return 0;
  if (!lv.numKeys) { v = lv.value; return typeof v === "number" ? v : Math.max(v[0], v[1]); }
  for (i = 1; i <= lv.numKeys; i++) { v = lv.keyValue(i); mx = Math.max(mx, typeof v === "number" ? v : Math.max(v[0], v[1])); }
  return mx;
}

// ---- Fades (set_layer audio_fade, sequence_layers audio_crossfade) ----

// A fade ends this far down (After Effects goes to -192 dB; -96 is inaudible).
var FADE_FLOOR = -96;

// Equal-power fade keys on a layer's audio levels over [t0, t0 + dur]: gain sin(u * pi / 2) in, cos out, in dB on top
// of the level at the fade's loud end. Two layers crossfading this way keep the mix's power, where straight dB ramps
// leave a hole in the middle. Keys already inside the span are replaced; returns how many.
function audioFade(l: AVLayer, t0: number, dur: number, out: boolean): number {
  var lv = l.property("ADBE Audio Group").property("ADBE Audio Levels"), loud = lv.valueAtTime(out ? t0 : t0 + dur, true),
    half = l.containingComp.frameDuration / 2, removed = 0, i, u, g, db;
  for (i = lv.numKeys; i >= 1; i--) { if (lv.keyTime(i) >= t0 - half && lv.keyTime(i) <= t0 + dur + half) { lv.removeKey(i); removed++; } }
  for (i = 0; i <= 4; i++) {
    u = i / 4; g = out ? Math.cos(u * Math.PI / 2) : Math.sin(u * Math.PI / 2);
    db = g <= 1e-6 ? FADE_FLOOR : Math.max(FADE_FLOOR, 20 * Math.log(g) / Math.LN10);
    lv.setValueAtTime(t0 + u * dur, [loud[0] + db, loud[1] + db]);
  }
  return removed;
}

// A layer that can fade: it has audio (fails otherwise, naming the layer).
function needAudio(l: Layer): AVLayer {
  if (!safe(function () { return (l as AVLayer).hasAudio === true; })) fail("BAD_ARGS", "Layer " + l.id + " (" + l.name + ") has no audio to fade");
  return l as AVLayer;
}

// The duck expression's settings, from an earlier duck_music run on this property (a dips-only run keeps them).
function duckSettings(lv: Prop): number[] | null {
  var m = isDuck(lv) ? /d = (-?[0-9.]+), att = ([0-9.]+), rel = ([0-9.]+)/.exec(lv.expression) : null;
  return m ? [parseFloat(m[1]), parseFloat(m[2]), parseFloat(m[3])] : null;
}

C.duck_music = function (a: Args["duck_music"]) {
  need(a, ["music_layer_id"]);
  var music = getLayer(a.music_layer_id), c = music.containingComp, lv = music.property("ADBE Audio Group").property("ADBE Audio Levels"),
    prev = duckSettings(lv), dipsOnly = has(a, "dips") && !has(a, "under_layer_ids"),
    amount = has(a, "amount") ? a.amount : (dipsOnly && prev ? prev[0] : -6),
    att = has(a, "attack") ? a.attack : (dipsOnly && prev ? prev[1] : 0.15), rel = has(a, "release") ? a.release : (dipsOnly && prev ? prev[2] : 0.4), mode = a.mode || "auto",
    minLevel = has(a, "min_level") ? a.min_level : -9, triggers: AVLayer[] = [], quiet = 0, spans: number[][] = [], i, l: AVLayer, sp, j, mk = music.property("ADBE Marker"), mv, removed = 0, ex, cover = 0, res: Obj,
    dips: number[][] = [], dp, dipsRemoved = 0;
  if (amount >= 0) fail("BAD_ARGS", "amount is the drop in dB and must be negative (e.g. -6)");
  if (mode !== "auto" && mode !== "span" && mode !== "loudness") fail("BAD_ARGS", "mode must be auto, span or loudness");
  if (!safe(function () { return music.hasAudio === true; })) fail("BAD_ARGS", "The music layer has no audio", "Pass the music's layer id (get_comp lists the layers)");
  // dips: a stretch of near-silence (a dramatic pause before a reveal), checked before anything changes
  if (has(a, "dips")) {
    for (i = 0; i < a.dips.length; i++) {
      dp = a.dips[i];
      if (!(dp.end > dp.start) || dp.start < 0 || dp.end > c.duration + EPS) fail("BAD_ARGS", "dips[" + i + "]: start " + dp.start + " / end " + dp.end + " must be a span inside the comp (0 to " + c.duration + " s)");
      if (has(dp, "amount") && dp.amount! >= 0) fail("BAD_ARGS", "dips[" + i + "]: amount is the drop in dB and must be negative (-60 is silence)");
      dips.push([dp.start, dp.end, has(dp, "amount") ? dp.amount! : -60, has(dp, "fade") ? dp.fade! : 0.05]);
    }
  }
  if (!dipsOnly) {
    if (has(a, "under_layer_ids")) { for (i = 0; i < a.under_layer_ids.length; i++) triggers.push(getLayer(a.under_layer_ids[i])); }
    else {
      for (i = 1; i <= c.numLayers; i++) {
        l = c.layer(i) as AVLayer;
        if (l === music || !hasAudioOn(l) || l.name.indexOf(AUDIO_NULL_PREFIX) === 0) continue;
        // quiet effects sit under the music anyway: ducking for each of them only pumps the music
        if (layerLevel(l) < minLevel) { quiet++; continue; }
        triggers.push(l);
      }
    }
    if (!triggers.length) fail("BAD_ARGS", "Nothing to duck under: no other audio layers" + (quiet ? " louder than " + minLevel + " dB (" + quiet + " quieter ones are ignored)" : ""), "Add voice-over or sound effects first, lower min_level, or pass under_layer_ids");
    for (i = 0; i < triggers.length; i++) {
      l = triggers[i];
      if (l.containingComp !== c) fail("BAD_ARGS", "under_layer_ids must be in the music's comp");
      if (mode === "loudness" || (mode === "auto" && l.outPoint - l.inPoint > 2)) {
        sp = audibleSpans(l); // long layers (voice-over): only where they are actually heard
        for (j = 0; j < sp.length; j++) spans.push(sp[j]);
      } else spans.push([Math.max(0, l.inPoint), Math.min(c.duration, l.outPoint)]);
    }
    spans = mergeSpans(spans, att + rel);
    // the ducks are markers on the music, read by one expression: volume keys keep working under it, and a duck is
    // moved or removed by editing its marker
    for (i = mk.numKeys; i >= 1; i--) { if (mk.keyValue(i).comment === "duck") { mk.removeKey(i); removed++; } }
    for (i = 0; i < spans.length; i++) {
      mv = new MarkerValue("duck");
      mv.duration = Math.max(c.frameDuration, spans[i][1] - spans[i][0]);
      mk.setValueAtTime(spans[i][0], mv);
    }
  }
  // a dip marker carries its own depth and fade: "dip -60 0.05"
  if (dips.length) {
    for (i = mk.numKeys; i >= 1; i--) { if (String(mk.keyValue(i).comment).indexOf("dip ") === 0) { mk.removeKey(i); dipsRemoved++; } }
    for (i = 0; i < dips.length; i++) {
      mv = new MarkerValue("dip " + dips[i][2] + " " + dips[i][3]);
      mv.duration = dips[i][1] - dips[i][0];
      mk.setValueAtTime(dips[i][0], mv);
    }
  }
  ex = DUCK_TAG + "\n" +
    "var m = thisLayer.marker, d = " + amount + ", att = " + att + ", rel = " + rel + ", g = 0, i, k, c, p, dd, a1, r1, s, e, w;\n" +
    "for (i = 1; i <= m.numKeys; i++) {\n" +
    "  k = m.key(i); c = k.comment;\n" +
    "  if (c == \"duck\") { dd = d; a1 = att; r1 = rel; }\n" +
    "  else if (c.indexOf(\"dip \") == 0) { p = c.split(\" \"); dd = parseFloat(p[1]); a1 = parseFloat(p[2]); r1 = a1; }\n" +
    "  else continue;\n" +
    "  s = k.time; e = k.time + k.duration;\n" +
    "  if (time < s - a1 || time > e + r1) continue;\n" +
    "  w = time < s ? (a1 > 0 ? (time - s + a1) / a1 : 1) : (time <= e ? 1 : (r1 > 0 ? 1 - (time - e) / r1 : 0));\n" +
    "  g = Math.min(g, ease(w, 0, 1, 0, dd));\n" +
    "}\n" +
    "value + [g, g];";
  lv.expression = ex;
  res = { music_layer: layerRef(music) };
  if (!dipsOnly) {
    // how much of the music is ducked: past half, ducking is just a lower level that pumps
    for (i = 0; i < spans.length; i++) cover += Math.min(spans[i][1], music.outPoint) - Math.max(spans[i][0], music.inPoint);
    cover = Math.max(0, Math.min(1, cover / Math.max(c.frameDuration, music.outPoint - music.inPoint)));
    res.ducks = spans.length; res.spans = spans.slice(0, 100); res.coverage = Math.round(cover * 100) / 100; res.amount = amount; res.replaced = removed;
    if (quiet) res.ignored_quiet = quiet;
    if (cover > 0.5) res.note = "The ducks cover " + Math.round(cover * 100) + "% of the music: set its volume lower instead, or duck only under the hero sounds (under_layer_ids, or a higher min_level)";
  }
  if (dips.length) { res.dips = dips.length; if (dipsRemoved) res.dips_replaced = dipsRemoved; }
  res.valid = !lv.expressionError;
  if (lv.expressionError) res.error = lv.expressionError;
  return res;
};
