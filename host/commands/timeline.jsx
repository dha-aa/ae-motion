// Timeline editing and markers. (src/tools/timeline.ts)
// Times snap to whole frames (snapT) unless a command takes snap: false.

C.split_layer = function (a) {
  need(a, ["layer_ids", "time"]);
  var ls = pickLayers(a.layer_ids), comp = sameComp(ls), t = a.snap === false ? a.time : snapT(comp, a.time), out = [], i, d;
  assertUnlocked(ls);
  for (i = 0; i < ls.length; i++) {
    if (!(t > ls[i].inPoint + EPS && t < ls[i].outPoint - EPS)) fail("BAD_ARGS", "Time " + t + " is not inside layer " + ls[i].id + " (" + ls[i].inPoint + " to " + ls[i].outPoint + ")");
  }
  for (i = 0; i < ls.length; i++) { d = splitAt(ls[i], t); out.push({ first: layerInfo(ls[i]), second: layerInfo(d) }); }
  return { time: t, splits: out };
};

C.shift_layers = function (a) {
  need(a, ["layer_ids", "offset_seconds"]);
  var ls = pickLayers(a.layer_ids), out = [], i;
  assertUnlocked(ls);
  for (i = 0; i < ls.length; i++) shiftLayer(ls[i], a.offset_seconds);
  for (i = 0; i < ls.length; i++) out.push(layerInfo(ls[i]));
  return { layers: out };
};

C.sequence_layers = function (a) {
  need(a, ["layer_ids"]);
  var ls = pickLayers(a.layer_ids), ov = has(a, "overlap") ? a.overlap : 0, out = [], i, t;
  if (ls.length < 2) fail("BAD_ARGS", "Need at least two layers");
  if (ov < 0) fail("BAD_ARGS", "overlap must be 0 or more");
  sameComp(ls);
  assertUnlocked(ls);
  t = has(a, "start") ? a.start : ls[0].inPoint;
  for (i = 0; i < ls.length; i++) {
    shiftLayer(ls[i], t - ls[i].inPoint);
    t = ls[i].outPoint - ov;
    out.push(layerInfo(ls[i]));
  }
  return { layers: out };
};

// Per layer, relative to the range [s, e]: before it -> untouched; after it -> shifted (ripple); inside -> deleted;
// spanning it -> split with the middle removed; crossing one edge -> trimmed.
C.delete_range = function (a) {
  need(a, ["comp_id", "start", "end"]);
  var comp = getComp(a.comp_id), s = snapT(comp, a.start), e = snapT(comp, a.end), ripple = a.ripple !== false, span = e - s,
    all = a.layer_ids ? pickLayers(a.layer_ids, comp) : layersOf(comp), targets = [],
    res = { range: [s, e], ripple: ripple, deleted: [], trimmed: [], split: [], shifted: [], skipped_locked: [] }, i, l, li, lo, d;
  if (!(e > s + EPS)) fail("BAD_ARGS", "end must be after start (times snap to whole frames)");
  for (i = 0; i < all.length; i++) { if (all[i].locked) res.skipped_locked.push(all[i].id); else targets.push(all[i]); }
  for (i = 0; i < targets.length; i++) {
    l = targets[i]; li = l.inPoint; lo = l.outPoint;
    if (lo <= s + EPS) continue;
    if (li >= e - EPS) { if (ripple) { shiftLayer(l, -span); res.shifted.push(l.id); } continue; }
    if (li >= s - EPS && lo <= e + EPS) { res.deleted.push(l.id); l.remove(); continue; }
    if (li < s - EPS && lo > e + EPS) {
      d = splitAt(l, s);
      setIn(d, e);
      res.split.push({ first: l.id, second: d.id });
      if (ripple) { shiftLayer(d, -span); res.shifted.push(d.id); }
      continue;
    }
    if (li < s - EPS) { l.outPoint = s; res.trimmed.push(l.id); continue; }
    setIn(l, e); res.trimmed.push(l.id);
    if (ripple) { shiftLayer(l, -span); res.shifted.push(l.id); }
  }
  if (ripple && a.shorten_comp) { comp.duration = Math.max(comp.frameDuration, comp.duration - span); res.comp_duration = comp.duration; }
  return res;
};

C.set_playhead = function (a) {
  need(a, ["comp_id", "time"]);
  var c = getComp(a.comp_id), t = a.snap === false ? a.time : snapT(c, a.time);
  if (t < 0 || t > c.duration + EPS) fail("BAD_ARGS", "time must be within the comp (0 to " + c.duration + " s)");
  c.time = t;
  return { time: c.time, frame: Math.round(c.time * c.frameRate) };
};

// ---------- markers ----------

// The marker property of a layer (layer_id) or a comp (comp_id).
function markerProp(a) {
  var hasL = has(a, "layer_id"), hasC = has(a, "comp_id");
  if (hasL === hasC) fail("BAD_ARGS", "Pass exactly one of layer_id or comp_id");
  if (hasC) return getComp(a.comp_id).markerProperty;
  return getLayer(a.layer_id).property("ADBE Marker");
}

function markerInfo(prop, i) {
  var v = prop.keyValue(i);
  return { index: i, time: prop.keyTime(i), comment: v.comment, duration: v.duration, chapter: v.chapter, url: v.url, label: safe(function () { return v.label; }) };
}

C.add_marker = function (a) {
  need(a, ["time"]);
  var prop = markerProp(a), mv = new MarkerValue(has(a, "comment") ? a.comment : "");
  if (has(a, "duration")) mv.duration = a.duration;
  if (has(a, "chapter")) mv.chapter = a.chapter;
  if (has(a, "url")) mv.url = a.url;
  if (has(a, "label")) mv.label = a.label;
  prop.setValueAtTime(a.time, mv);
  return markerInfo(prop, prop.nearestKeyIndex(a.time));
};

C.list_markers = function (a) {
  var prop = markerProp(a), out = [], i;
  for (i = 1; i <= prop.numKeys && i <= 500; i++) out.push(markerInfo(prop, i));
  return { markers: out, total: prop.numKeys };
};

C.delete_marker = function (a) {
  var prop = markerProp(a), idx, info;
  if (has(a, "index")) idx = a.index;
  else if (has(a, "time")) idx = prop.numKeys ? prop.nearestKeyIndex(a.time) : 0;
  else fail("BAD_ARGS", "Pass index or time");
  if (!prop.numKeys || idx < 1 || idx > prop.numKeys) fail("NOT_FOUND", "No such marker", "Use list_markers");
  if (!has(a, "index") && Math.abs(prop.keyTime(idx) - a.time) > 0.05) fail("NOT_FOUND", "No marker within 0.05 s of " + a.time, "Use list_markers");
  info = markerInfo(prop, idx);
  prop.removeKey(idx);
  return { deleted: info };
};
