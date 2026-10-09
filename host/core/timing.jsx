// Layer timing helpers that work around After Effects' in/out point behavior (see CLAUDE.md "After Effects quirks").

// Move a layer in time. Changing startTime moves in and out with it; check anyway and put them right if not.
function shiftLayer(l, dt) {
  var i0 = l.inPoint, o0 = l.outPoint;
  l.startTime = l.startTime + dt;
  if (Math.abs(l.inPoint - (i0 + dt)) > 1e-5 || Math.abs(l.outPoint - (o0 + dt)) > 1e-5) {
    l.inPoint = i0 + dt; l.outPoint = o0 + dt;
  }
}

// Setting inPoint also moves outPoint (the layer keeps its length), so put outPoint back. Never assign inPoint directly.
function setIn(l, t) {
  var o = l.outPoint;
  l.inPoint = t;
  if (Math.abs(l.outPoint - o) > 1e-6) l.outPoint = o;
}

// Set a comp's work area. Setting workAreaStart keeps the end where it is (in After Effects 26.3; a start past the
// end moves the end instead and leaves the start), so open it to the whole comp first, then set start and duration,
// and check: a work area set wrong silently analyses the wrong audio (Convert Audio to Keyframes).
function setWorkArea(c, s, d) {
  var fd = c.frameDuration;
  c.workAreaStart = 0;
  c.workAreaDuration = c.duration;
  c.workAreaStart = s;
  c.workAreaDuration = d;
  if (Math.abs(c.workAreaStart - s) > fd / 2 || Math.abs(c.workAreaDuration - d) > fd / 2) {
    fail("AE_ERROR", "Could not set the work area to " + s + " s + " + d + " s (got " + c.workAreaStart + " s + " + c.workAreaDuration + " s)", "Check that it fits inside the comp");
  }
}

// Split l at t: l keeps the first part and the returned duplicate (above it) holds the second.
function splitAt(l, t) {
  var d = l.duplicate();
  l.outPoint = t;
  setIn(d, t);
  return d;
}

// Set a layer's position; a three-value position turns 3D on (cameras and lights are always 3D).
function setLayerPosition(l, v) {
  var is3 = (l instanceof CameraLayer || l instanceof LightLayer || l.threeDLayer === true);
  if (v.length > 2 && !is3) { l.threeDLayer = true; is3 = true; }
  tp(l, "ADBE Position").setValue(is3 ? v3(v) : [v[0], v[1]]);
}
