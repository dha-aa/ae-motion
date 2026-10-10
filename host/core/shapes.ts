// Shape-layer contents and bezier paths (shared by add_layer and add_mask).

type Pts = number[][];
type Pt2s = [number, number][];
/** A path spec (add_mask's shape, a path keyframe value): rect / ellipse box, polygon points, or bezier vertices. */
interface PathSpec { type?: string; position?: number[]; size?: number[]; points?: Pts; vertices?: Pts; in_tangents?: Pts; out_tangents?: Pts; closed?: boolean }
/** A shape-layer shape (add_layer options.shape, add_shape). */
type LayerShapeSpec = NonNullable<NonNullable<Args["add_layer"]["options"]>["shape"]>;

function zeros(n: number): Pt2s { var o: Pt2s = [], i; for (i = 0; i < n; i++) o.push([0, 0]); return o; }

// Build a Shape from vertices with optional tangents (default: straight segments). Closed unless closed === false.
function mkShape(v: Pts | undefined, it: Pts | null | undefined, ot: Pts | null | undefined, closed: boolean | undefined): Shape {
  if (!(v instanceof Array) || v.length < 2) fail("BAD_ARGS", "A path needs at least 2 vertices");
  var s = new Shape();
  s.vertices = v as Pt2s;
  s.inTangents = it && it.length === v!.length ? it as Pt2s : zeros(v!.length);
  s.outTangents = ot && ot.length === v!.length ? ot as Pt2s : zeros(v!.length);
  s.closed = closed !== false;
  return s;
}

// A rect or ellipse as a 4-vertex bezier path centered on (cx, cy), vertices clockwise from the top-left.
// The ellipse's vertices sit on the diagonals, matching the rect's corners, so rect <-> ellipse keyframes
// morph without twisting (a 4-point bezier circle is equally accurate at any rotation).
function boxShape(type: string, cx: number, cy: number, w: number, h: number): Shape {
  var rx = w / 2, ry = h / 2, k = 0.5522847498, v: Pts = [], it: Pts = [], ot: Pts = [], i, a, c, s; // k: bezier circle constant
  if (type === "ellipse") {
    for (i = 0; i < 4; i++) {
      a = (i * 90 - 135) * Math.PI / 180; c = Math.cos(a); s = Math.sin(a); // -135 = top-left (y down)
      v.push([cx + rx * c, cy + ry * s]);
      ot.push([-k * rx * s, k * ry * c]);
      it.push([k * rx * s, -k * ry * c]);
    }
    return mkShape(v, it, ot, true);
  }
  return mkShape([[cx - rx, cy - ry], [cx + rx, cy - ry], [cx + rx, cy + ry], [cx - rx, cy + ry]], null, null, true);
}

// A shape spec as a Shape. Specs are the same as add_mask's: {type: rect | ellipse, position?, size?},
// {type: polygon, points}, or {type: path (default when vertices are given), vertices, in_tangents?, out_tangents?, closed?}.
// rect / ellipse default to the box W x H centered in it (the full layer).
function shapeFromSpec(s: PathSpec, W: number, H: number): Shape {
  var type = s.type || (s.vertices ? "path" : "");
  if (type === "rect" || type === "ellipse") {
    return boxShape(type, s.position ? s.position[0] : W / 2, s.position ? s.position[1] : H / 2, s.size ? s.size[0] : W, s.size ? s.size[1] : H);
  }
  if (type === "polygon") {
    if (!(s.points instanceof Array) || s.points.length < 3) fail("BAD_ARGS", "polygon needs at least 3 points");
    return mkShape(s.points, null, null, s.closed);
  }
  if (type === "path") return mkShape(s.vertices, s.in_tangents, s.out_tangents, s.closed);
  fail("BAD_ARGS", "shape.type must be rect, ellipse, polygon or path");
}

function copyPts(a: ArrayLike<ArrayLike<number>>): Pts { var o: Pts = [], i; for (i = 0; i < a.length; i++) o.push([a[i][0], a[i][1]]); return o; }

// A Shape as JSON, in the path spec format shapeFromSpec accepts.
function shapeToJson(v: Shape): PathSpec {
  return { type: "path", vertices: copyPts(v.vertices), in_tangents: copyPts(v.inTangents), out_tangents: copyPts(v.outTangents), closed: v.closed };
}

var LINE_CAPS: { [name: string]: number } = { butt: 1, round: 2, square: 3 };
var LINE_JOINS: { [name: string]: number } = { miter: 1, round: 2, bevel: 3 };

// Check a shape spec's stroke options before anything is created (add_layer calls it before adding the layer).
function checkShapeSpec(s: LayerShapeSpec): void {
  if (has(s, "line_cap") && !LINE_CAPS[s.line_cap!]) fail("BAD_ARGS", "line_cap must be butt, round or square");
  if (has(s, "line_join") && !LINE_JOINS[s.line_join!]) fail("BAD_ARGS", "line_join must be miter, round or bevel");
  if (has(s, "dashes") && (!(s.dashes instanceof Array) || s.dashes.length < 1 || s.dashes.length > 6)) fail("BAD_ARGS", "dashes must be 1 to 6 numbers: dash, gap, dash, gap and so on");
  if ((has(s, "dashes") || has(s, "line_cap") || has(s, "line_join") || has(s, "stroke_width") || has(s, "stroke_opacity")) && !s.stroke) fail("BAD_ARGS", "Stroke options need a stroke color");
}

// Add one shape group (rect | ellipse | star | polygon | path) with optional fill and stroke to a shape layer and
// return the group. Stroke extras: stroke_opacity, dashes [dash, gap, dash, gap] (up to 3 pairs), line_cap, line_join.
// Group extras: name, position (offset inside the layer), rotation, opacity; fill_opacity.
// Property groups are reached by match name; "any" because what property() returns depends on the name.
function addShapeContent(l: Layer, s: LayerShapeSpec): PropertyGroup {
  var root: any, grp: any, g: any, sh: any, f: any, st: any, d: any, i, tg: any;
  checkShapeSpec(s);
  root = l.property("ADBE Root Vectors Group"); grp = root.addProperty("ADBE Vector Group"); g = grp.property("ADBE Vectors Group");
  if (s.name) grp.name = s.name;
  if (s.type === "star" || s.type === "polygon") {
    sh = g.addProperty("ADBE Vector Shape - Star");
    sh.property("ADBE Vector Star Type").setValue(s.type === "star" ? 1 : 2);
    sh.property("ADBE Vector Star Points").setValue(has(s, "points") ? s.points : 5);
    sh.property("ADBE Vector Star Outer Radius").setValue(has(s, "outer_radius") ? s.outer_radius : 100);
    if (s.type === "star") sh.property("ADBE Vector Star Inner Radius").setValue(has(s, "inner_radius") ? s.inner_radius : 40);
  } else if (s.type === "path") {
    sh = g.addProperty("ADBE Vector Shape - Group");
    sh.property("ADBE Vector Shape").setValue(mkShape(s.vertices, s.in_tangents, s.out_tangents, s.closed));
  } else if (s.type === "ellipse") {
    sh = g.addProperty("ADBE Vector Shape - Ellipse"); sh.property("ADBE Vector Ellipse Size").setValue(s.size || [100, 100]);
  } else {
    sh = g.addProperty("ADBE Vector Shape - Rect"); sh.property("ADBE Vector Rect Size").setValue(s.size || [100, 100]);
    if (s.roundness !== undefined) sh.property("ADBE Vector Rect Roundness").setValue(s.roundness);
  }
  if (s.fill) {
    f = g.addProperty("ADBE Vector Graphic - Fill"); f.property("ADBE Vector Fill Color").setValue(rgba(s.fill));
    if (has(s, "fill_opacity")) f.property("ADBE Vector Fill Opacity").setValue(s.fill_opacity);
  }
  if (s.stroke) {
    st = g.addProperty("ADBE Vector Graphic - Stroke");
    st.property("ADBE Vector Stroke Color").setValue(rgba(s.stroke));
    st.property("ADBE Vector Stroke Width").setValue(s.stroke_width || 4);
    if (has(s, "stroke_opacity")) st.property("ADBE Vector Stroke Opacity").setValue(s.stroke_opacity);
    if (has(s, "line_cap")) st.property("ADBE Vector Stroke Line Cap").setValue(LINE_CAPS[s.line_cap!]);
    if (has(s, "line_join")) st.property("ADBE Vector Stroke Line Join").setValue(LINE_JOINS[s.line_join!]);
    if (has(s, "dashes")) {
      // adding "Dash n" / "Gap n" activates that pair; After Effects lists all three pairs but only renders active ones
      d = st.property("ADBE Vector Stroke Dashes");
      for (i = 0; i < s.dashes!.length; i++) d.addProperty("ADBE Vector Stroke " + (i % 2 ? "Gap " : "Dash ") + (Math.floor(i / 2) + 1)).setValue(s.dashes![i]);
    }
  }
  tg = grp.property("ADBE Vector Transform Group");
  if (has(s, "position")) tg.property("ADBE Vector Position").setValue([s.position![0], s.position![1]]);
  if (has(s, "rotation")) tg.property("ADBE Vector Rotation").setValue(s.rotation);
  if (has(s, "opacity")) tg.property("ADBE Vector Group Opacity").setValue(s.opacity);
  return grp;
}
