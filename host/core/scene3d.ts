// Shared helpers for cameras, lights and 3D layers.
//
// Rigs, shake and look-at are expressions this code adds, marked on their first line so they can be recognised later.
// keyTarget sends keyframes to a rig's control layers, lets keys sit under a shake, and refuses any other expression.

var RIGMARK = "// ae-motion rig";
var SHAKEMARK = "// ae-motion shake";
var LOOKMARK = "// ae-motion look-at";

/** The transform arguments set_camera, set_light and set_3d share. */
interface XformArgs {
  position?: number[]; point_of_interest?: number[]; anchor?: number[]; scale?: number[]; orientation?: number[];
  rotation?: { x?: number; y?: number; z?: number };
}
/** A camera's position and point of interest. */
interface CamState { P: Vec; T: Vec }

var LIGHTTYPES: { [name: string]: string } = { point: "POINT", spot: "SPOT", parallel: "PARALLEL", ambient: "AMBIENT" };
var IRIS: { [field: string]: string } = {
  iris_shape: "ADBE Iris Shape", iris_rotation: "ADBE Iris Rotation", iris_roundness: "ADBE Iris Roundness", iris_aspect_ratio: "ADBE Iris Aspect Ratio",
  iris_diffraction_fringe: "ADBE Iris Diffraction Fringe", highlight_gain: "ADBE Iris Highlight Gain", highlight_threshold: "ADBE Iris Highlight Threshold",
  highlight_saturation: "ADBE Iris Hightlight Saturation" // sic: After Effects' match name has the typo
};

// addCamera / addLight leave x and y at 0 even when given a center, so put the layer over c explicitly.
function centerLayer(l: Layer, c: number[]): void {
  var p = tp(l, "ADBE Position"), v = p.value;
  if (Math.abs(v[0] - c[0]) > 1e-6 || Math.abs(v[1] - c[1]) > 1e-6) p.setValue([c[0], c[1], v[2]]);
}

function camLayer(id: number): CameraLayer {
  var l = getLayer(id);
  if (!(l instanceof CameraLayer)) fail("BAD_ARGS", "Layer " + id + " is not a camera", "Add one with add_layer kind camera");
  return l as unknown as CameraLayer;
}
function camOpt(l: Layer, match: string): Prop { return l.property("ADBE Camera Options Group").property(match); }
function isTwoNode(l: Layer): boolean { return l.autoOrient === AutoOrientType.CAMERA_OR_POINT_OF_INTEREST; }
function needTwoNode(l: Layer): void { if (!isTwoNode(l)) fail("BAD_ARGS", "This camera is one-node (it has no point of interest)", "Call set_camera with two_node: true first"); }
// Layer names are embedded in expressions inside double quotes.
function cleanName(n: string): string { if (String(n).indexOf('"') !== -1) fail("BAD_ARGS", "Layer names used by rigs and look-at cannot contain double quotes"); return n; }

// Where to put keyframes for a camera's position or point of interest: the property itself, or the rig control that drives it.
function keyTarget(l: Layer, match: string, label: string): Prop {
  var p = tp(l, match), m, ctrl: Layer | null = null;
  if (p.expressionEnabled) {
    if (p.expression.indexOf(RIGMARK) === 0) {
      m = /thisComp\.layer\("([^"]+)"\)/.exec(p.expression);
      if (m) { try { ctrl = l.containingComp.layer(m[1]); } catch (e) { ctrl = null; } }
      if (!ctrl) fail("NOT_FOUND", "The rig control layer for " + label + " is missing", "Use camera_rig remove, then create the rig again");
      return ctrl!.property("ADBE Transform Group").property("ADBE Position");
    }
    if (p.expression.indexOf(SHAKEMARK) !== 0) fail("BAD_ARGS", label + " is driven by an expression", "Clear it with set_expression and an empty expression");
  }
  return p;
}

// Camera position P and target T at time t (from the rig controls if rigged, ignoring shake).
function stateAt(l: Layer, t: number): CamState {
  return {
    P: v3(copyArr(keyTarget(l, "ADBE Position", "Position").valueAtTime(t, true))),
    T: v3(copyArr(keyTarget(l, "ADBE Anchor Point", "Point of Interest").valueAtTime(t, true)))
  };
}

// What drives a property: static, keyframes, rig, shake, look-at or expression.
function driveOf(p: Prop): string {
  if (p.expressionEnabled) {
    if (p.expression.indexOf(RIGMARK) === 0) return "rig";
    if (p.expression.indexOf(SHAKEMARK) === 0) return "shake";
    if (p.expression.indexOf(LOOKMARK) === 0) return "look-at";
    return "expression";
  }
  return p.numKeys > 0 ? "keyframes" : "static";
}

function xformProp(l: Layer, match: string): Prop {
  if (l instanceof CameraLayer && (match === "ADBE Position" || match === "ADBE Anchor Point")) return keyTarget(l, match, match === "ADBE Position" ? "Position" : "Point of Interest");
  return tp(l, match);
}
function vN(a: number[], dims: number): number[] { var v = v3(a); return dims === 2 ? [v[0], v[1]] : v; }
function scaleN(a: number[], dims: number): number[] { return dims === 2 ? [a[0], a[1]] : [a[0], a[1], a.length > 2 ? a[2] : 100]; }

// Apply position / point_of_interest (or anchor) / scale / orientation / rotation from args a, statically or at time t.
function applyXform(l: Layer, a: XformArgs, t?: number | null): void {
  var r = a.rotation, dims = (l instanceof CameraLayer || l instanceof LightLayer || (l as AVLayer).threeDLayer) ? 3 : 2;
  if (has(a, "position")) setAt(xformProp(l, "ADBE Position"), vN(a.position!, dims), t);
  if (has(a, "point_of_interest")) setAt(xformProp(l, "ADBE Anchor Point"), vN(a.point_of_interest!, dims), t);
  else if (has(a, "anchor")) setAt(xformProp(l, "ADBE Anchor Point"), vN(a.anchor!, dims), t);
  if (has(a, "scale")) setAt(xformProp(l, "ADBE Scale"), scaleN(a.scale!, dims), t);
  if (has(a, "orientation")) setAt(xformProp(l, "ADBE Orientation"), v3(a.orientation!), t);
  if (r) {
    if (has(r, "x")) setAt(xformProp(l, "ADBE Rotate X"), r.x, t);
    if (has(r, "y")) setAt(xformProp(l, "ADBE Rotate Y"), r.y, t);
    if (has(r, "z")) setAt(xformProp(l, "ADBE Rotate Z"), r.z, t);
  }
}

function xformInfo(l: Layer, t: number): Obj {
  var o: Obj = {};
  o.position = safe(function () { return copyArr(tp(l, "ADBE Position").valueAtTime(t, false)); });
  o.point_of_interest = (l instanceof CameraLayer || l instanceof LightLayer) ? safe(function () { return copyArr(tp(l, "ADBE Anchor Point").valueAtTime(t, false)); }) : undefined;
  o.orientation = safe(function () { return copyArr(tp(l, "ADBE Orientation").valueAtTime(t, false)); });
  o.rotation = {
    x: safe(function () { return tp(l, "ADBE Rotate X").valueAtTime(t, false); }),
    y: safe(function () { return tp(l, "ADBE Rotate Y").valueAtTime(t, false); }),
    z: safe(function () { return tp(l, "ADBE Rotate Z").valueAtTime(t, false); })
  };
  return o;
}

// Distance from camera l to layer other along the view axis (two-node) or straight-line (one-node).
function axisDistance(l: Layer, other: Layer, t: number): number {
  var P = v3(copyArr(tp(l, "ADBE Position").valueAtTime(t, false))), L = v3(copyArr(tp(other, "ADBE Position").valueAtTime(t, false))), d = vsub(L, P), f, r;
  if (isTwoNode(l)) {
    f = vnorm(vsub(v3(copyArr(tp(l, "ADBE Anchor Point").valueAtTime(t, false))), P));
    r = vdot(d, f);
  } else {
    r = vlen(d);
  }
  if (!(r > 0)) fail("BAD_ARGS", "That layer is behind the camera");
  return r;
}

// Lens maths assumes a 36 mm film width: zoom px = focal length x comp width / 36.
function camInfo(l: CameraLayer, t: number): Obj {
  var comp = l.containingComp, W = comp.width, H = comp.height, z = camOpt(l, "ADBE Camera Zoom").valueAtTime(t, false), o: Obj = {}, k: any, iris: Obj = {};
  o.layer = layerInfo(l as unknown as AVLayer);
  o.two_node = isTwoNode(l);
  o.zoom = z;
  o.focal_length_mm = z * 36 / W;
  o.fov_horizontal = 2 * Math.atan(W / (2 * z)) * 180 / Math.PI;
  o.fov_vertical = 2 * Math.atan(H / (2 * z)) * 180 / Math.PI;
  o.depth_of_field = camOpt(l, "ADBE Camera Depth of Field").valueAtTime(t, false) ? true : false;
  o.focus_distance = camOpt(l, "ADBE Camera Focus Distance").valueAtTime(t, false);
  o.aperture = camOpt(l, "ADBE Camera Aperture").valueAtTime(t, false);
  o.blur_level = camOpt(l, "ADBE Camera Blur Level").valueAtTime(t, false);
  for (k in IRIS) {
    if (IRIS.hasOwnProperty(k)) iris[k] = safe(function () { return camOpt(l, IRIS[k]).valueAtTime(t, false); });
  }
  o.iris = iris;
  k = xformInfo(l, t);
  o.position = k.position; o.point_of_interest = k.point_of_interest; o.orientation = k.orientation; o.rotation = k.rotation;
  o.driven_by = {
    position: driveOf(tp(l, "ADBE Position")), point_of_interest: driveOf(tp(l, "ADBE Anchor Point")), roll: driveOf(tp(l, "ADBE Rotate Z")),
    zoom: driveOf(camOpt(l, "ADBE Camera Zoom")), focus_distance: driveOf(camOpt(l, "ADBE Camera Focus Distance"))
  };
  return o;
}

function lightInfo(l: LightLayer, t: number): Obj {
  var g = l.property("ADBE Light Options Group"), o: Obj = {}, k: any, name = "unknown", ft = safe(function () { return g.property("ADBE Light Falloff Type").valueAtTime(t, false); });
  for (k in LIGHTTYPES) { if (LIGHTTYPES.hasOwnProperty(k) && (LightType as any)[LIGHTTYPES[k]] === l.lightType) name = k; }
  o.layer = layerInfo(l as unknown as AVLayer);
  o.light_type = name;
  o.intensity = safe(function () { return g.property("ADBE Light Intensity").valueAtTime(t, false); });
  o.color = safe(function () { return copyArr(g.property("ADBE Light Color").valueAtTime(t, false)); });
  o.cone_angle = safe(function () { return g.property("ADBE Light Cone Angle").valueAtTime(t, false); });
  o.cone_feather = safe(function () { return g.property("ADBE Light Cone Feather 2").valueAtTime(t, false); });
  o.falloff = ft === 3 ? "inverse_square_clamped" : (ft === 2 ? "smooth" : "none");
  o.falloff_radius = safe(function () { return g.property("ADBE Light Falloff Start").valueAtTime(t, false); });
  o.falloff_distance = safe(function () { return g.property("ADBE Light Falloff Distance").valueAtTime(t, false); });
  o.casts_shadows = safe(function () { return g.property("ADBE Casts Shadows").valueAtTime(t, false) ? true : false; });
  o.shadow_darkness = safe(function () { return g.property("ADBE Light Shadow Darkness").valueAtTime(t, false); });
  o.shadow_diffusion = safe(function () { return g.property("ADBE Light Shadow Diffusion").valueAtTime(t, false); });
  k = xformInfo(l, t);
  o.position = k.position; o.point_of_interest = k.point_of_interest; o.orientation = k.orientation; o.rotation = k.rotation;
  return o;
}
