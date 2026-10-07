// Shape-layer contents and bezier paths (shared by add_layer and add_mask).

function zeros(n) { var o = [], i; for (i = 0; i < n; i++) o.push([0, 0]); return o; }

// Build a Shape from vertices with optional tangents (default: straight segments). Closed unless closed === false.
function mkShape(v, it, ot, closed) {
  if (!(v instanceof Array) || v.length < 2) fail("BAD_ARGS", "A path needs at least 2 vertices");
  var s = new Shape();
  s.vertices = v;
  s.inTangents = it && it.length === v.length ? it : zeros(v.length);
  s.outTangents = ot && ot.length === v.length ? ot : zeros(v.length);
  s.closed = closed !== false;
  return s;
}

// A rect or ellipse as a 4-vertex bezier path centered on (cx, cy), vertices clockwise from the top-left.
// The ellipse's vertices sit on the diagonals, matching the rect's corners, so rect <-> ellipse keyframes
// morph without twisting (a 4-point bezier circle is equally accurate at any rotation).
function boxShape(type, cx, cy, w, h) {
  var rx = w / 2, ry = h / 2, k = 0.5522847498, v = [], it = [], ot = [], i, a, c, s; // k: bezier circle constant
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
function shapeFromSpec(s, W, H) {
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

function copyPts(a) { var o = [], i; for (i = 0; i < a.length; i++) o.push([a[i][0], a[i][1]]); return o; }

// A Shape as JSON, in the path spec format shapeFromSpec accepts.
function shapeToJson(v) {
  return { type: "path", vertices: copyPts(v.vertices), in_tangents: copyPts(v.inTangents), out_tangents: copyPts(v.outTangents), closed: v.closed };
}

// Add one shape group (rect | ellipse | star | polygon | path) with optional fill and stroke to a shape layer.
function addShapeContent(l, s) {
  var root = l.property("ADBE Root Vectors Group"), grp = root.addProperty("ADBE Vector Group"), g = grp.property("ADBE Vectors Group"), sh, f, st;
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
  if (s.fill) { f = g.addProperty("ADBE Vector Graphic - Fill"); f.property("ADBE Vector Fill Color").setValue(rgba(s.fill)); }
  if (s.stroke) {
    st = g.addProperty("ADBE Vector Graphic - Stroke");
    st.property("ADBE Vector Stroke Color").setValue(rgba(s.stroke));
    st.property("ADBE Vector Stroke Width").setValue(s.stroke_width || 4);
  }
}
