// Timeline editing and markers. (src/tools/timeline.ts)
// Times snap to whole frames (snapT) unless a command takes snap: false.

C.split_layer = function (a) {
  need(a, ["layer_ids", "time"]);
  var ls = pickLayers(a.layer_ids), comp = sameComp(ls), t = a.snap === false ? a.time : snapT(comp, a.time), out = [], i, d;
  assertUnlocked(ls);
  for (i = 0; i < ls.length; i++) {
    if (!(t > ls[i].inPoint + EPS && t < ls[i].outPoint - EPS)) fail("BAD_ARGS", "Time " + t + " is not inside layer " + ls[i].id + " (" + ls[i].inPoint + " to " + ls[i].outPoint + ")");
  }
  for (i = 0; i < ls.length; i++) { d = splitAt(ls[i], t); out.push({ first: layerTiming(ls[i]), second: layerTiming(d) }); }
  return { time: t, splits: out };
};

C.shift_layers = function (a) {
  need(a, ["layer_ids", "offset_seconds"]);
  var ls = pickLayers(a.layer_ids), out = [], i;
  assertUnlocked(ls);
  for (i = 0; i < ls.length; i++) shiftLayer(ls[i], a.offset_seconds);
  for (i = 0; i < ls.length; i++) out.push(layerTiming(ls[i]));
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
    out.push(layerTiming(ls[i]));
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
  if (ripple && a.move_markers) res.markers = rippleCompMarkers(comp, s, -span, e);
  if (ripple && a.shorten_comp) { comp.duration = Math.max(comp.frameDuration, comp.duration - span); res.comp_duration = comp.duration; }
  return res;
};

// Ripple insert, the counterpart of delete_range: open a gap of duration seconds at time at.
// Layers starting at or after it move later, layers spanning it are split and their second part moves.
C.insert_time = function (a) {
  need(a, ["comp_id", "at", "duration"]);
  var comp = getComp(a.comp_id), snap = a.snap !== false, t = snap ? snapT(comp, a.at) : a.at, d = snap ? snapT(comp, a.duration) : a.duration,
    all = a.layer_ids ? pickLayers(a.layer_ids, comp) : layersOf(comp), targets = [],
    res = { at: t, duration: d, shifted: [], split: [], skipped_locked: [] }, i, l, nd;
  if (!(d > EPS)) fail("BAD_ARGS", "duration must be at least one frame");
  if (t < 0 || t > comp.duration + EPS) fail("BAD_ARGS", "at must be within the comp (0 to " + comp.duration + " s)");
  for (i = 0; i < all.length; i++) { if (all[i].locked) res.skipped_locked.push(all[i].id); else targets.push(all[i]); }
  if (a.extend_comp !== false) { comp.duration = comp.duration + d; res.comp_duration = comp.duration; }
  for (i = 0; i < targets.length; i++) {
    l = targets[i];
    if (l.outPoint <= t + EPS) continue;
    if (l.inPoint >= t - EPS) { shiftLayer(l, d); res.shifted.push(l.id); continue; }
    nd = splitAt(l, t);
    shiftLayer(nd, d);
    res.split.push({ first: l.id, second: nd.id });
    res.shifted.push(nd.id);
  }
  if (a.move_markers) res.markers = rippleCompMarkers(comp, t, d);
  return res;
};

// Shift a whole comp so [s, e] becomes [0, e - s]: layers and comp markers move by -s, markers left outside are removed.
C.trim_comp = function (a) {
  need(a, ["comp_id", "to"]);
  var c = getComp(a.comp_id), ls = layersOf(c), s, e, i, locked = [], mp = c.markerProperty, removed = 0, keep = [];
  if (a.to === "work_area") { s = c.workAreaStart; e = s + c.workAreaDuration; }
  else if (a.to === "layers") {
    if (!ls.length) fail("BAD_ARGS", "The comp has no layers");
    s = ls[0].inPoint; e = ls[0].outPoint;
    for (i = 1; i < ls.length; i++) { s = Math.min(s, ls[i].inPoint); e = Math.max(e, ls[i].outPoint); }
  } else fail("BAD_ARGS", "to must be work_area or layers");
  if (!(e - s > EPS)) fail("BAD_ARGS", "Nothing to trim to (empty range)");
  // shifting needs unlocked layers; locks are put back afterwards
  for (i = 0; i < ls.length; i++) if (ls[i].locked) { ls[i].locked = false; locked.push(ls[i]); }
  for (i = 0; i < ls.length; i++) shiftLayer(ls[i], -s);
  for (i = 0; i < locked.length; i++) locked[i].locked = true;
  for (i = mp.numKeys; i >= 1; i--) {
    if (mp.keyTime(i) >= s - EPS && mp.keyTime(i) <= e + EPS) keep.push({ t: mp.keyTime(i) - s, v: mp.keyValue(i) }); else removed++;
    mp.removeKey(i);
  }
  for (i = 0; i < keep.length; i++) mp.setValueAtTime(Math.max(0, keep[i].t), keep[i].v);
  // work area start first: the work area must fit the comp after every assignment
  c.workAreaStart = 0;
  c.duration = e - s;
  c.workAreaDuration = c.duration;
  return { trimmed_to: a.to, removed_range: [s, e], offset: -s, duration: c.duration, markers_removed: removed, layers_moved: ls.length };
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

// Move comp markers at or after from by dt. With removeTo, markers in [from, removeTo) are deleted instead (ripple delete).
function rippleCompMarkers(comp, from, dt, removeTo) {
  var mp = comp.markerProperty, ks = [], removed = 0, i, t;
  for (i = mp.numKeys; i >= 1; i--) {
    t = mp.keyTime(i);
    if (t < from - EPS) continue;
    if (removeTo !== undefined && t < removeTo - EPS) { mp.removeKey(i); removed++; continue; }
    ks.push({ t: t, v: mp.keyValue(i) });
    mp.removeKey(i);
  }
  for (i = 0; i < ks.length; i++) mp.setValueAtTime(ks[i].t + dt, ks[i].v);
  return { moved: ks.length, removed: removed };
}

// The marker an edit addresses: by 1-based index, or by time (within 0.05 s).
function findMarker(prop, a) {
  var idx;
  if (has(a, "index")) idx = a.index;
  else if (has(a, "time")) idx = prop.numKeys ? prop.nearestKeyIndex(a.time) : 0;
  else fail("BAD_ARGS", "Pass index or time");
  if (!prop.numKeys || idx < 1 || idx > prop.numKeys) fail("NOT_FOUND", "No such marker", "Use list_markers");
  if (!has(a, "index") && Math.abs(prop.keyTime(idx) - a.time) > 0.05) fail("NOT_FOUND", "No marker within 0.05 s of " + a.time, "Use list_markers");
  return idx;
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

// Change a marker in place; only the fields passed change. to_time moves it.
C.update_marker = function (a) {
  var prop = markerProp(a), idx = findMarker(prop, a), v = prop.keyValue(idx), t = prop.keyTime(idx), nt;
  if (has(a, "comment")) v.comment = a.comment;
  if (has(a, "duration")) v.duration = a.duration;
  if (has(a, "chapter")) v.chapter = a.chapter;
  if (has(a, "url")) v.url = a.url;
  if (has(a, "label")) v.label = a.label;
  nt = has(a, "to_time") ? a.to_time : t;
  if (Math.abs(nt - t) > EPS) {
    if (prop.numKeys > 1 && Math.abs(prop.keyTime(prop.nearestKeyIndex(nt)) - nt) < EPS) fail("EXISTS", "There is already a marker at " + nt);
    prop.removeKey(idx);
  }
  prop.setValueAtTime(nt, v); // a MarkerValue is a copy: write it back
  return markerInfo(prop, prop.nearestKeyIndex(nt));
};

// Put layers' in points on consecutive markers (layer i on marker from_index + i), e.g. to cut to a beat.
C.align_to_markers = function (a) {
  need(a, ["layer_ids"]);
  var ls = pickLayers(a.layer_ids), comp = sameComp(ls), prop, first = has(a, "from_index") ? a.from_index : 1, out = [], i, mt, next;
  if (has(a, "marker_layer_id")) { prop = getLayer(a.marker_layer_id).property("ADBE Marker"); if (getLayer(a.marker_layer_id).containingComp.id !== comp.id) fail("BAD_ARGS", "The marker layer is in a different comp"); }
  else prop = comp.markerProperty;
  if (first < 1 || first - 1 + ls.length > prop.numKeys) fail("BAD_ARGS", "Need " + ls.length + " markers from marker " + first + ", found " + prop.numKeys, "Add markers with add_marker or pass fewer layers");
  assertUnlocked(ls);
  for (i = 0; i < ls.length; i++) {
    mt = prop.keyTime(first + i);
    shiftLayer(ls[i], mt - ls[i].inPoint);
    if (a.trim_to_next && first + i < prop.numKeys) {
      next = prop.keyTime(first + i + 1);
      if (ls[i].outPoint > next + EPS) ls[i].outPoint = next;
    }
    out.push(layerTiming(ls[i]));
  }
  return { layers: out };
};

C.list_markers = function (a) {
  var prop = markerProp(a), out = [], i;
  for (i = 1; i <= prop.numKeys && i <= 500; i++) out.push(markerInfo(prop, i));
  return { markers: out, total: prop.numKeys };
};

C.delete_marker = function (a) {
  var prop = markerProp(a), idx = findMarker(prop, a), info;
  info = markerInfo(prop, idx);
  prop.removeKey(idx);
  return { deleted: info };
};
