// Audio: beats as markers, and properties driven by loudness. Both read After Effects' own analysis
// (Animation > Keyframe Assistant > Convert Audio to Keyframes): a null with Left / Right / Both Channels sliders,
// keyed once per frame. (src/tools/timeline.ts)

var AUDIO_NULL_PREFIX = "Audio Amplitude: ";

function hasAudioOn(l) { return safe(function () { return l.hasAudio === true && l.audioEnabled === true; }) === true; }

// The slider of an amplitude null's channel effect (1 left, 2 right, 3 both). Effect names are localized, so by index.
function channelSlider(l, ch) {
  var fx = safe(function () { return l.property("ADBE Effect Parade"); });
  if (!fx || fx.numProperties < 3) return null;
  return safe(function () { return fx.property(ch).property(1); }) || null;
}

function setWorkArea(c, s, d) {
  c.workAreaDuration = c.frameDuration; // shrink first, so the new start always fits
  c.workAreaStart = s;
  c.workAreaDuration = d;
}

// The amplitude null for an audio layer. With reuse, an existing one (by name) is returned. Otherwise the menu
// command runs with only this layer audible and the work area set to it (it analyses the comp's audio in the work
// area); other layers' audio and the work area are restored afterwards, even on failure.
function amplitudeNull(audio, reuse) {
  var c = audio.containingComp, name = AUDIO_NULL_PREFIX + audio.name, before = {}, muted = [], made = null,
    ws = c.workAreaStart, wd = c.workAreaDuration, s = Math.max(0, audio.inPoint), e = Math.min(c.duration, audio.outPoint), i, l;
  if (reuse) for (i = 1; i <= c.numLayers; i++) { if (c.layer(i).name === name && channelSlider(c.layer(i), 3)) return c.layer(i); }
  if (!safe(function () { return audio.hasAudio === true; })) fail("BAD_ARGS", "Layer " + audio.name + " has no audio", "Pass an audio (or video with sound) layer");
  if (e - s < c.frameDuration) fail("BAD_ARGS", "The audio layer is not inside the comp's duration");
  for (i = 1; i <= c.numLayers; i++) {
    l = c.layer(i);
    before[l.id] = true;
    if (l !== audio && hasAudioOn(l)) { l.audioEnabled = false; muted.push(l); }
  }
  try {
    if (!audio.audioEnabled) audio.audioEnabled = true;
    setWorkArea(c, s, e - s);
    selectOnly(audio);
    runMenu("Convert Audio to Keyframes", 0);
    for (i = 1; i <= c.numLayers; i++) { if (!before[c.layer(i).id]) { made = c.layer(i); break; } }
  } finally {
    for (i = 0; i < muted.length; i++) muted[i].audioEnabled = true;
    setWorkArea(c, ws, wd);
  }
  if (!made || !channelSlider(made, 3)) fail("AE_ERROR", "Convert Audio to Keyframes did not create its amplitude layer", "Check that the layer's audio switch is on and the track is not silent");
  made.name = name;
  return made;
}

// Key times and values of a slider (one key per frame).
function keySeries(p) {
  var ts = [], vs = [], i;
  for (i = 1; i <= p.numKeys; i++) { ts.push(p.keyTime(i)); vs.push(p.keyValue(i)); }
  return { t: ts, v: vs };
}

// Beat onsets from per-frame loudness: frames where the loudness rises sharply compared with the rises around them
// (an adaptive threshold, so quiet and loud passages both work) and by a real fraction of the track's loud level.
// A beat is reported at the first frame of its rise.
// sensitivity 0-1 (higher finds more, softer beats); minGap in seconds between beats.
function pickBeats(ts, vs, fps, sensitivity, minGap) {
  var n = vs.length, o = [], beats = [], mx = 0, last = -1e9, w = Math.max(2, Math.round(fps * 0.4)),
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
function estimateBpm(beats) {
  var g = [], i, m, sum = 0, cnt = 0, bpm;
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
function quantile(vs, q) {
  var s = vs.slice(0);
  s.sort(function (x, y) { return x - y; });
  return s.length ? s[Math.min(s.length - 1, Math.max(0, Math.round(q * (s.length - 1))))] : 0;
}

C.beat_markers = function (a) {
  need(a, ["audio_layer_id"]);
  var audio = getLayer(a.audio_layer_id), c = audio.containingComp, fps = c.frameRate, every = a.every || 1,
    s = has(a, "start") ? a.start : Math.max(0, audio.inPoint), e = has(a, "end") ? a.end : Math.min(c.duration, audio.outPoint),
    times = [], picked = [], prop = a.on === "layer" ? audio.property("ADBE Marker") : c.markerProperty, amp, ser, bpm, t, i, step, removed = 0;
  if (e <= s) fail("BAD_ARGS", "end must be after start");
  if (has(a, "bpm")) {
    if (!(a.bpm > 0)) fail("BAD_ARGS", "bpm must be positive");
    step = 60 / a.bpm;
    for (t = has(a, "offset") ? a.offset : s; t < e - 1e-6; t += step) { if (t >= s - 1e-6) times.push(t); }
    bpm = a.bpm;
  } else {
    amp = amplitudeNull(audio, false);
    ser = keySeries(channelSlider(amp, 3));
    if (!a.keep_amplitude) amp.remove();
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

C.audio_react = function (a) {
  need(a, ["audio_layer_id", "layer_ids", "path", "from", "to"]);
  var audio = getLayer(a.audio_layer_id), ch = { left: 1, right: 2, both: 3 }[a.channel || "both"], n = a.smoothing || 2,
    amp, vs, lo, hi, ex, r;
  if (!ch) fail("BAD_ARGS", "channel must be left, right or both");
  amp = amplitudeNull(audio, true);
  vs = keySeries(channelSlider(amp, ch)).v;
  // the quiet floor and loud ceiling of this track, so from/to span what the music actually does
  lo = quantile(vs, 0.05); hi = quantile(vs, 0.97);
  if (hi - lo < 1e-6) fail("BAD_ARGS", "The track is (almost) silent: nothing to react to");
  ex = "// ae-motion audio\n" +
    "var a = thisComp.layer(" + JSON.stringify(amp.name) + ").effect(" + ch + ")(1), n = " + n + ", s = 0;\n" +
    "for (var i = 0; i < n; i++) s += a.valueAtTime(time - i * thisComp.frameDuration);\n" +
    "linear(s / n, " + (Math.round(lo * 1000) / 1000) + ", " + (Math.round(hi * 1000) / 1000) + ", " + JSON.stringify(a.from) + ", " + JSON.stringify(a.to) + ");";
  r = C.set_expression({ layer_ids: a.layer_ids, path: a.path, expression: ex });
  return { amplitude_layer: layerRef(amp), range: [lo, hi], set: r.set, valid: r.valid, errors: r.errors };
};
