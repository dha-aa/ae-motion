// Layer geometry for layout: content bounds and 2D transforms (align_layers, set_anchor, get_layer bounds).
//
// A 2D affine matrix is [a, b, c, d, e, f], mapping (x, y) to (a*x + c*y + e, b*x + d*y + f). A layer's matrix maps
// layer space to its parent's space: translate(position) * rotate(rotation) * scale(scale / 100) * translate(-anchor).
// Coordinates are y down, so a positive rotation turns clockwise on screen, as in After Effects.

function mMul(m, n) {
  return [m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1], m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]];
}
function mApply(m, x, y) { return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]; }
// Apply only the linear part (for offsets).
function mApplyLinear(m, x, y) { return [m[0] * x + m[2] * y, m[1] * x + m[3] * y]; }
function mInvertLinear(m) {
  var det = m[0] * m[3] - m[1] * m[2];
  if (Math.abs(det) < 1e-12) fail("BAD_ARGS", "The layer or a parent has zero scale");
  return [m[3] / det, -m[1] / det, -m[2] / det, m[0] / det, 0, 0];
}

// Layers whose on-screen position depends on a camera or 3D rotation have no 2D matrix.
function is2D(l) { return !(l instanceof CameraLayer) && !(l instanceof LightLayer) && l.threeDLayer !== true; }

function layerMatrix(l, t) {
  var p = tp(l, "ADBE Position").valueAtTime(t, false), an = tp(l, "ADBE Anchor Point").valueAtTime(t, false),
    sc = tp(l, "ADBE Scale").valueAtTime(t, false), r = tp(l, "ADBE Rotate Z").valueAtTime(t, false) * Math.PI / 180,
    c = Math.cos(r), s = Math.sin(r), sx = sc[0] / 100, sy = sc[1] / 100;
  return mMul([c * sx, s * sx, -s * sy, c * sy, p[0], p[1]], [1, 0, 0, 1, -an[0], -an[1]]);
}

// Layer space -> comp space through the parent chain, or null when any layer in the chain is 3D.
function toCompMatrix(l, t) {
  var m, q;
  if (!is2D(l)) return null;
  m = layerMatrix(l, t);
  for (q = l.parent; q; q = q.parent) {
    if (!is2D(q)) return null;
    m = mMul(layerMatrix(q, t), m);
  }
  return m;
}

// The layer's content rectangle in its own space ({left, top, width, height}), or null (cameras, lights).
function contentRect(l, t) {
  if (l instanceof CameraLayer || l instanceof LightLayer) return null;
  var r = l.sourceRectAtTime(t, false);
  return { left: r.left, top: r.top, width: r.width, height: r.height };
}

// The axis-aligned box the layer's content covers in the comp, or null when it cannot be computed in 2D.
function compBounds(l, t) {
  var r = contentRect(l, t), m = toCompMatrix(l, t), pts, i, x0, y0, x1, y1, p;
  if (!r || !m) return null;
  pts = [[r.left, r.top], [r.left + r.width, r.top], [r.left + r.width, r.top + r.height], [r.left, r.top + r.height]];
  for (i = 0; i < 4; i++) {
    p = mApply(m, pts[i][0], pts[i][1]);
    if (i === 0) { x0 = x1 = p[0]; y0 = y1 = p[1]; } else { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]); }
  }
  return { left: x0, top: y0, right: x1, bottom: y1, width: x1 - x0, height: y1 - y0, center: [(x0 + x1) / 2, (y0 + y1) / 2] };
}

// Add (dx, dy) to a position property: every keyframe if animated (the motion is kept), else the static value.
function offsetProp(p, d) {
  var i, v, j;
  if (p.expressionEnabled) fail("BAD_ARGS", "Position is driven by an expression", "Clear it with set_expression first");
  if (p.numKeys === 0) {
    v = p.value;
    if (v instanceof Array) { v = copyArr(v); for (j = 0; j < d.length && j < v.length; j++) v[j] += d[j]; } else v += d[0];
    p.setValue(v);
    return;
  }
  for (i = 1; i <= p.numKeys; i++) {
    v = p.keyValue(i);
    if (v instanceof Array) { v = copyArr(v); for (j = 0; j < d.length && j < v.length; j++) v[j] += d[j]; } else v += d[0];
    p.setValueAtKey(i, v);
  }
}

// Move a layer by (dx, dy) in its parent's space (handles separated dimensions).
function offsetPosition(l, dx, dy) {
  var pos = tp(l, "ADBE Position");
  if (pos.dimensionsSeparated) {
    if (dx) offsetProp(tp(l, "ADBE Position_0"), [dx]);
    if (dy) offsetProp(tp(l, "ADBE Position_1"), [dy]);
  } else offsetProp(pos, [dx, dy]);
}

// Move a layer so its content moves by (dx, dy) on screen, whatever its parents' rotation and scale.
function moveOnScreen(l, dx, dy, t) {
  var d = [dx, dy];
  if (l.parent) d = mApplyLinear(mInvertLinear(toCompMatrix(l.parent, t)), dx, dy);
  offsetPosition(l, d[0], d[1]);
}
