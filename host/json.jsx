// JSON polyfill. ExtendScript has no built-in JSON object, so define the two functions the bridge needs.
// This file sits outside the AEM closure (it is emitted before it by scripts/build-host.ts).
if (typeof JSON !== "object") { JSON = {}; }
(function () {
  function q(s) {
    return '"' + s.replace(/[\\"\u0000-\u001f\u2028\u2029]/g, function (c) {
      var m = { '"': '\\"', "\\": "\\\\", "\b": "\\b", "\f": "\\f", "\n": "\\n", "\r": "\\r", "\t": "\\t" };
      return m[c] || "\\u" + ("0000" + c.charCodeAt(0).toString(16)).slice(-4);
    }) + '"';
  }
  function str(v) {
    var t = typeof v, i, a, k;
    if (v === null || v === undefined) return "null";
    if (t === "number") return isFinite(v) ? String(v) : "null";
    if (t === "boolean") return String(v);
    if (t === "string") return q(v);
    if (v instanceof Array) { a = []; for (i = 0; i < v.length; i++) a.push(str(v[i])); return "[" + a.join(",") + "]"; }
    a = [];
    for (k in v) { if (v.hasOwnProperty(k) && typeof v[k] !== "function" && v[k] !== undefined) a.push(q(k) + ":" + str(v[k])); }
    return "{" + a.join(",") + "}";
  }
  if (typeof JSON.stringify !== "function") JSON.stringify = function (v) { return str(v); };
  if (typeof JSON.parse !== "function") JSON.parse = function (s) { return eval("(" + s + ")"); };
})();
