// Design commands: alignment, anchor points, shapes, layer styles, text to shapes. (src/tools/design.ts)
// Geometry helpers live in core/layout.ts; shape building in core/shapes.ts.

// Arguments: Args["<tool>"] (host/args.d.ts, generated from the server's schemas in src/tools/design.ts).
type AnchorName = NonNullable<Args["set_anchor"]["anchor"]>;
type StyleName = Args["add_layer_style"]["style"];

// Layer styles: [menu command id (Layer > Layer Styles), property group match name]. Scripts cannot add styles
// directly, so the menu command runs on the selected layer; the ids were checked in After Effects 26.3.
const LAYER_STYLES: { [K in StyleName]: [number, string] } = {
  drop_shadow: [9000, "dropShadow"], inner_shadow: [9001, "innerShadow"], outer_glow: [9002, "outerGlow"], inner_glow: [9003, "innerGlow"],
  bevel_emboss: [9004, "bevelEmboss"], satin: [9005, "chromeFX"], color_overlay: [9006, "solidFill"], gradient_overlay: [9007, "gradientFill"],
  stroke: [9008, "frameFX"],
};
const ANCHORS: { [K in AnchorName]: [number, number] } = {
  top_left: [0, 0], top: [0.5, 0], top_right: [1, 0], left: [0, 0.5], center: [0.5, 0.5], right: [1, 0.5],
  bottom_left: [0, 1], bottom: [0.5, 1], bottom_right: [1, 1],
};
const ALIGNS = " left right h_center top bottom v_center center ";

// property() returns a union of every property kind; these name what the call site expects.
function group(owner: Layer | PropertyGroup, name: string | number): PropertyGroup { return owner.property(name as string) as PropertyGroup; }
function prop(owner: Layer | PropertyGroup, name: string | number): Property<any> { return owner.property(name as string) as Property<any>; }

// Select exactly this layer (menu commands act on the selection) in its comp, opened in the viewer.
function selectOnly(l: Layer): void {
  const c = l.containingComp;
  c.openInViewer();
  for (let i = 1; i <= c.numLayers; i++) c.layer(i).selected = false;
  l.selected = true;
}

function runMenu(name: string, fallbackId: number): void {
  const id = app.findMenuCommandId(name) || fallbackId; // names are localized; the id is the fallback
  if (!id) fail("UNSUPPORTED", "This After Effects version has no menu command named " + name);
  app.executeCommand(id);
}

C.align_layers = function (a: Args["align_layers"]) {
  need(a, ["layer_ids"]);
  const ls = pickLayers(a.layer_ids), comp = sameComp(ls), t = has(a, "time") ? a.time! : 0, m = has(a, "margin") ? a.margin! : 0, al = a.align, dist = a.distribute;
  if (!al && !dist) fail("BAD_ARGS", "Pass align and/or distribute");
  if (al && ALIGNS.indexOf(" " + al + " ") === -1) fail("BAD_ARGS", "align must be left, h_center, right, top, v_center, bottom or center");
  if (dist && dist !== "horizontal" && dist !== "vertical") fail("BAD_ARGS", "distribute must be horizontal or vertical");
  if (dist && ls.length < 3) fail("BAD_ARGS", "distribute needs at least 3 layers");
  assertUnlocked(ls);
  const b: LayerBounds[] = [];
  for (let i = 0; i < ls.length; i++) {
    const bi = compBounds(ls[i], t);
    if (!bi) return fail("UNSUPPORTED", "Layer " + ls[i].id + " is 3D (or a camera/light, or has a 3D parent): its screen position depends on the camera", "Align 2D layers, or place 3D layers with set_3d");
    b.push(bi);
  }
  let tr: { left: number; top: number; right: number; bottom: number };
  if (a.to === "layer") {
    need(a, ["to_layer_id"]);
    const o = getLayer(a.to_layer_id!);
    if (o.containingComp.id !== comp.id) fail("BAD_ARGS", "to_layer_id is in a different comp");
    const ob = compBounds(o, t);
    if (!ob) return fail("UNSUPPORTED", "The target layer is 3D, a camera or a light");
    tr = ob;
  } else if (a.to === "selection") {
    tr = { left: b[0].left, top: b[0].top, right: b[0].right, bottom: b[0].bottom };
    for (let i = 1; i < b.length; i++) {
      tr.left = Math.min(tr.left, b[i].left); tr.top = Math.min(tr.top, b[i].top); tr.right = Math.max(tr.right, b[i].right); tr.bottom = Math.max(tr.bottom, b[i].bottom);
    }
  } else {
    tr = { left: 0, top: 0, right: comp.width, bottom: comp.height };
  }
  for (let i = 0; i < ls.length; i++) {
    let dx = 0, dy = 0;
    if (al === "left") dx = tr.left + m - b[i].left;
    else if (al === "right") dx = tr.right - m - b[i].right;
    else if (al === "h_center" || al === "center") dx = (tr.left + tr.right) / 2 - b[i].center[0];
    if (al === "top") dy = tr.top + m - b[i].top;
    else if (al === "bottom") dy = tr.bottom - m - b[i].bottom;
    else if (al === "v_center" || al === "center") dy = (tr.top + tr.bottom) / 2 - b[i].center[1];
    if (dx || dy) { moveOnScreen(ls[i], dx, dy, t); b[i] = compBounds(ls[i], t)!; }
  }
  if (dist) {
    const axis = dist === "horizontal" ? 0 : 1, order: number[] = [];
    for (let i = 0; i < ls.length; i++) order.push(i);
    order.sort((x, y) => b[x].center[axis] - b[y].center[axis]);
    const first = b[order[0]].center[axis], last = b[order[order.length - 1]].center[axis];
    // even spacing of centers between the outermost layers, which stay put
    for (let i = 1; i < order.length - 1; i++) {
      const d = first + (last - first) * i / (order.length - 1) - b[order[i]].center[axis];
      if (Math.abs(d) > 1e-9) moveOnScreen(ls[order[i]], axis === 0 ? d : 0, axis === 1 ? d : 0, t);
    }
  }
  const out: { layer_id: number; name: string; bounds: LayerBounds | null }[] = [];
  for (let i = 0; i < ls.length; i++) out.push({ layer_id: ls[i].id, name: ls[i].name, bounds: compBounds(ls[i], t) });
  return { time: t, layers: out };
};

// Move the anchor point onto the content (center, a corner or an edge) or to a point, keeping the layer in place.
C.set_anchor = function (a: Args["set_anchor"]) {
  need(a, ["layer_id"]);
  const l = getLayer(a.layer_id), t = has(a, "time") ? a.time! : 0, an = tp(l, "ADBE Anchor Point");
  if (!is2D(l) && !(l as AVLayer).threeDLayer) fail("BAD_ARGS", "Cameras and lights have no anchor point");
  if (an.numKeys > 0 || an.expressionEnabled) fail("BAD_ARGS", "The anchor point is animated or driven by an expression");
  let na: [number, number];
  if (a.point) na = [a.point[0], a.point[1]];
  else {
    const f = ANCHORS[a.anchor || "center"];
    if (!f) return fail("BAD_ARGS", "anchor must be center, top_left, top, top_right, left, right, bottom_left, bottom or bottom_right");
    const r = contentRect(l, t)!;
    na = [r.left + r.width * f[0], r.top + r.height * f[1]];
  }
  const oa: number[] = an.value;
  if (a.keep_position !== false) {
    if ((l as AVLayer).threeDLayer && (tp(l, "ADBE Rotate X").value || tp(l, "ADBE Rotate Y").value || tp(l, "ADBE Orientation").value.toString() !== "0,0,0")) {
      fail("UNSUPPORTED", "keep_position on a 3D layer with X/Y rotation or orientation is not supported", "Pass keep_position: false, or zero those rotations first");
    }
    // the layer moves by the anchor change mapped through its own rotation and scale (in its parent's space)
    const d = mApplyLinear(layerMatrix(l, t), na[0] - oa[0], na[1] - oa[1]);
    offsetPosition(l, d[0], d[1]);
  }
  an.setValue(oa.length > 2 ? [na[0], na[1], oa[2]] : na);
  return { layer: layerRef(l), anchor: copyArr(an.value), position: copyArr(tp(l, "ADBE Position").value), bounds: compBounds(l, t) };
};

// Add a shape group to a shape layer: on top (group 1, earlier groups move down one) or at the bottom (at: "bottom",
// earlier groups keep their indexes, which suits scripts that key groups by index as they add them).
C.add_shape = function (a: Args["add_shape"]) {
  need(a, ["layer_id", "shape"]);
  const l = getLayer(a.layer_id), at = a.at || "top";
  if (at !== "top" && at !== "bottom") fail("BAD_ARGS", "at must be top or bottom");
  if (!(l instanceof ShapeLayer)) fail("BAD_ARGS", "Layer is not a shape layer", "Create one with add_layer kind shape");
  const root = group(l, "ADBE Root Vectors Group"), g = addShapeContent(l, a.shape), n = root.numProperties, gi = at === "top" ? 1 : n;
  const base: (string | number)[] = ["ADBE Root Vectors Group", gi, "ADBE Vectors Group"];
  const res: { group_index: number; name: string; groups: number; path_group: (string | number)[]; path?: (string | number)[] } =
    { group_index: gi, name: g.name, groups: n, path_group: base };
  if (at === "top") g.moveTo(1); // moving invalidates g: read everything needed first
  if (a.shape.type === "path") res.path = base.concat([1, "ADBE Vector Shape"]);
  return res;
};

// Run Layer > Create > Create Shapes from Text: a new shape layer with the outlines appears above; the text layer is turned off.
C.text_to_shapes = function (a: Args["text_to_shapes"]) {
  need(a, ["layer_id"]);
  const l = getLayer(a.layer_id), c = l.containingComp, n0 = c.numLayers;
  if (!(l instanceof TextLayer)) fail("BAD_ARGS", "Layer is not a text layer");
  selectOnly(l);
  runMenu("Create Shapes from Text", 3781);
  if (c.numLayers !== n0 + 1 || l.index < 2) fail("AE_ERROR", "After Effects did not create the outline layer");
  const made = c.layer(l.index - 1);
  return { shape_layer: layerRef(made), groups: group(made, "ADBE Root Vectors Group").numProperties, text_layer: layerRef(l) };
};

// Turn on a layer style and set its parameters (property names without the style prefix, e.g. distance, color).
C.add_layer_style = function (a: Args["add_layer_style"]) {
  need(a, ["layer_id", "style"]);
  const l = getLayer(a.layer_id), s = LAYER_STYLES[a.style], names: string[] = [], errs: string[] = [];
  if (!s) fail("BAD_ARGS", "style must be one of drop_shadow, inner_shadow, outer_glow, inner_glow, bevel_emboss, satin, color_overlay, gradient_overlay, stroke");
  let ls = group(l, "ADBE Layer Styles");
  if (!ls) fail("BAD_ARGS", "This layer cannot have layer styles");
  let g = group(ls, s[1] + "/enabled");
  for (let i = 1; i <= g.numProperties; i++) names.push(g.property(i).matchName.replace(s[1] + "/", ""));
  // check parameter names first (the style's properties exist even while it is off), so a typo changes nothing
  if (a.params) {
    for (const key in a.params) {
      if (a.params.hasOwnProperty(key) && !safe(() => g.property(s[1] + "/" + key))) errs.push(key);
    }
    if (errs.length) fail("BAD_ARGS", "Unknown " + a.style + " parameter(s): " + errs.join(", "), "Valid names: " + names.join(", "));
  }
  if (!g.enabled || !ls.enabled) {
    selectOnly(l);
    app.executeCommand(s[0]);
    ls = group(l, "ADBE Layer Styles"); g = group(ls, s[1] + "/enabled"); // menu commands can invalidate references
  }
  if (!g.enabled) fail("AE_ERROR", "After Effects did not turn on the " + a.style + " style");
  if (a.params) {
    for (const key in a.params) {
      if (!a.params.hasOwnProperty(key)) continue;
      const p = prop(g, s[1] + "/" + key);
      try { p.setValue(coerce(p, a.params[key])); } catch (e) { errs.push(key + ": " + ((e as { message?: string }).message || String(e))); }
    }
    if (errs.length) fail("BAD_ARGS", "Style params failed: " + errs.join("; "), "Valid names: " + names.join(", "));
  }
  if (a.enabled === false) g.enabled = false;
  return { style: a.style, enabled: g.enabled, path: ["ADBE Layer Styles", s[1] + "/enabled"], parameters: names };
};
