// Layer geometry for layout: content bounds and 2D transforms (align_layers, set_anchor, get_layer bounds).
// TypeScript, compiled to ES5 by tsconfig.host.json; only ES3 runtime APIs are available (no map or forEach).
//
// A 2D affine matrix is [a, b, c, d, e, f], mapping (x, y) to (a*x + c*y + e, b*x + d*y + f). A layer's matrix maps
// layer space to its parent's space: translate(position) * rotate(rotation) * scale(scale / 100) * translate(-anchor).
// Coordinates are y down, so a positive rotation turns clockwise on screen, as in After Effects.

// Type names avoid globals from the After Effects / ScriptUI declarations (Bounds, Rect and others): in a script
// (module: none) every declaration is global, and interfaces with the same name silently merge.
type Affine = [number, number, number, number, number, number];
type Vec2 = [number, number];
interface LayerRect { left: number; top: number; width: number; height: number }
interface LayerBounds { left: number; top: number; right: number; bottom: number; width: number; height: number; center: Vec2 }

function mMul(m: Affine, n: Affine): Affine {
  return [m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1], m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]];
}
function mApply(m: Affine, x: number, y: number): Vec2 { return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]; }
// Apply only the linear part (for offsets).
function mApplyLinear(m: Affine, x: number, y: number): Vec2 { return [m[0] * x + m[2] * y, m[1] * x + m[3] * y]; }
function mInvertLinear(m: Affine): Affine {
  const det = m[0] * m[3] - m[1] * m[2];
  if (Math.abs(det) < 1e-12) fail("BAD_ARGS", "The layer or a parent has zero scale");
  return [m[3] / det, -m[1] / det, -m[2] / det, m[0] / det, 0, 0];
}

// Layers whose on-screen position depends on a camera or 3D rotation have no 2D matrix.
function is2D(l: Layer): l is AVLayer {
  return !(l instanceof CameraLayer) && !(l instanceof LightLayer) && (l as AVLayer).threeDLayer !== true;
}

function layerMatrix(l: Layer, t: number): Affine {
  const p = tp(l, "ADBE Position").valueAtTime(t, false), an = tp(l, "ADBE Anchor Point").valueAtTime(t, false),
    sc = tp(l, "ADBE Scale").valueAtTime(t, false), r = tp(l, "ADBE Rotate Z").valueAtTime(t, false) * Math.PI / 180,
    c = Math.cos(r), s = Math.sin(r), sx = sc[0] / 100, sy = sc[1] / 100;
  return mMul([c * sx, s * sx, -s * sy, c * sy, p[0], p[1]], [1, 0, 0, 1, -an[0], -an[1]]);
}

// Layer space -> comp space through the parent chain, or null when any layer in the chain is 3D.
function toCompMatrix(l: Layer, t: number): Affine | null {
  if (!is2D(l)) return null;
  let m = layerMatrix(l, t);
  for (let q = l.parent; q; q = q.parent) {
    if (!is2D(q)) return null;
    m = mMul(layerMatrix(q, t), m);
  }
  return m;
}

// The layer's content rectangle in its own space, or null (cameras, lights).
function contentRect(l: Layer, t: number): LayerRect | null {
  if (l instanceof CameraLayer || l instanceof LightLayer) return null;
  const r = (l as AVLayer).sourceRectAtTime(t, false);
  return { left: r.left, top: r.top, width: r.width, height: r.height };
}

// The axis-aligned box the layer's content covers in the comp, or null when it cannot be computed in 2D.
function compBounds(l: Layer, t: number): LayerBounds | null {
  const r = contentRect(l, t), m = toCompMatrix(l, t);
  if (!r || !m) return null;
  const pts: Vec2[] = [[r.left, r.top], [r.left + r.width, r.top], [r.left + r.width, r.top + r.height], [r.left, r.top + r.height]];
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let i = 0; i < 4; i++) {
    const p = mApply(m, pts[i][0], pts[i][1]);
    x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]);
  }
  return { left: x0, top: y0, right: x1, bottom: y1, width: x1 - x0, height: y1 - y0, center: [(x0 + x1) / 2, (y0 + y1) / 2] };
}

// Add d to a value (number or number array).
function addTo(v: number | number[], d: number[]): number | number[] {
  if (!(v instanceof Array)) return v + d[0];
  const o = copyArr(v);
  for (let j = 0; j < d.length && j < o.length; j++) o[j] += d[j];
  return o;
}

// Add d to a position property: every keyframe if animated (the motion is kept), else the static value.
function offsetProp(p: Property<any>, d: number[]): void {
  if (p.expressionEnabled) fail("BAD_ARGS", "Position is driven by an expression", "Clear it with set_expression first");
  if (p.numKeys === 0) { p.setValue(addTo(p.value, d)); return; }
  for (let i = 1; i <= p.numKeys; i++) p.setValueAtKey(i, addTo(p.keyValue(i), d));
}

// Move a layer by (dx, dy) in its parent's space (handles separated dimensions).
function offsetPosition(l: Layer, dx: number, dy: number): void {
  if (tp(l, "ADBE Position").dimensionsSeparated) {
    if (dx) offsetProp(tp(l, "ADBE Position_0"), [dx]);
    if (dy) offsetProp(tp(l, "ADBE Position_1"), [dy]);
  } else offsetProp(tp(l, "ADBE Position"), [dx, dy]);
}

// Move a layer so its content moves by (dx, dy) on screen, whatever its parents' rotation and scale.
function moveOnScreen(l: Layer, dx: number, dy: number, t: number): void {
  let d: Vec2 = [dx, dy];
  if (l.parent) {
    const pm = toCompMatrix(l.parent, t);
    if (!pm) fail("UNSUPPORTED", "Layer " + l.id + " has a 3D parent");
    d = mApplyLinear(mInvertLinear(pm), dx, dy);
  }
  offsetPosition(l, d[0], d[1]);
}
