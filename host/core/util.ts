// Small helpers used everywhere: errors, argument checks, arrays, time snapping.

var EPS = 1e-6;

// Throw a structured error; dispatch() turns it into {ok:false, error:{code,message,hint}}.
// code is one of NOT_FOUND, BAD_ARGS, AE_ERROR, UNSUPPORTED, EXISTS (see src/errors.ts).
function fail(code: string, message: string, hint?: string): never { throw { aem: true, code: code, message: message, hint: hint || "" }; }

/** T with the fields K present (not undefined or null): what has() and need() prove. */
type With<T, K extends keyof T> = T & { [P in K]-?: NonNullable<T[P]> };

// A type guard, so if (has(a, "time")) lets the code use a.time as a number; k must be one of o's fields.
function has<T, K extends keyof T>(o: T, k: K): o is With<T, K> { return o[k] !== undefined && o[k] !== null; }

function need<T, K extends keyof T & string>(a: T, names: K[]): asserts a is With<T, K> {
  for (var i = 0; i < names.length; i++) if (!has(a, names[i])) fail("BAD_ARGS", "Missing argument: " + names[i]);
}

// Run fn and return its result, or undefined if it throws (for optional DOM reads that differ between versions).
function safe<T>(fn: () => T): T | undefined { try { return fn(); } catch (e) { return undefined; } }

// After Effects returns array-like values; copy them into plain arrays so they serialize.
function copyArr<T>(v: ArrayLike<T>): T[] { var o: T[] = [], i; for (i = 0; i < v.length; i++) o.push(v[i]); return o; }

// Colors arrive as [r,g,b] (0-1); After Effects color properties want [r,g,b,a].
function rgba(c: number[]): number[] { return c.length === 3 ? [c[0], c[1], c[2], 1] : c; }

// Snap a time to the nearest whole frame of comp.
function snapT(comp: CompItem, t: number): number { var fd = comp.frameDuration; return Math.round(t / fd) * fd; }

// The After Effects install folder (render_start looks for aerender near it).
// app.path is a Folder object; new Folder(app.path) gives a bogus temp path, so read fsName directly.
function appDir(): string { var p = app.path; return p && p.fsName ? p.fsName : new Folder(String(p)).fsName; }
