// 3D vector maths for the camera tools.
// After Effects has x to the right, y DOWN and z into the screen: a camera in front of the comp has negative z,
// and "up" on screen is negative y.

type Vec = number[];
function v3(a: number[]): Vec { return [a[0], a[1], a.length > 2 ? a[2] : 0]; }
function vadd(a: Vec, b: Vec): Vec { return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]; }
function vsub(a: Vec, b: Vec): Vec { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
function vmul(a: Vec, k: number): Vec { return [a[0] * k, a[1] * k, a[2] * k]; }
function vdot(a: Vec, b: Vec): number { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
function vlen(a: Vec): number { return Math.sqrt(vdot(a, a)); }
function vnorm(a: Vec): Vec {
  var n = vlen(a);
  if (n < 1e-9) fail("BAD_ARGS", "The camera and its point of interest are at the same position");
  return vmul(a, 1 / n);
}
function rad(d: number): number { return d * Math.PI / 180; }

// yaw turns the +z direction toward +x (a camera at -z swings to the right; a view direction turns right with yaw(w, -deg)).
function yaw(v: Vec, deg: number): Vec { var a = rad(deg), c = Math.cos(a), s = Math.sin(a); return [v[0] * c - v[2] * s, v[1], v[0] * s + v[2] * c]; }

// elevate raises a vector toward the top of the screen (y decreases) while keeping its length; clamped short of vertical.
function elevate(v: Vec, deg: number): Vec {
  var r = vlen(v), rho = Math.sqrt(v[0] * v[0] + v[2] * v[2]), phi = Math.atan2(-v[1], rho), phi2 = phi + rad(deg), rho2, k;
  phi2 = Math.max(-1.5533, Math.min(1.5533, phi2));
  rho2 = r * Math.cos(phi2);
  k = rho > 1e-9 ? rho2 / rho : 0;
  return [v[0] * k, -r * Math.sin(phi2), v[2] * k];
}

// Unit vector to the right of view direction f, in the horizontal plane.
function rightOf(f: Vec): Vec {
  var h = Math.sqrt(f[0] * f[0] + f[2] * f[2]);
  if (h < 1e-9) fail("BAD_ARGS", "The camera looks straight up or down, so truck is undefined");
  return [f[2] / h, 0, -f[0] / h];
}

// Easing curve for sampled moves: u in 0..1 -> eased 0..1.
function easeU(name: string, u: number): number {
  if (name === "ease_in") return u * u;
  if (name === "ease_out") return 1 - (1 - u) * (1 - u);
  if (name === "ease_in_out") return u * u * (3 - 2 * u);
  return u;
}

// Number of keyframe intervals for a sampled rotation of deg degrees, step degrees apart (2 to 180).
function sampleCount(deg: number, step?: number): number { var n = Math.ceil(Math.abs(deg) / (step || 5)); return Math.max(2, Math.min(180, n)); }
