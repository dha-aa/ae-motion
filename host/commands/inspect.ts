// Read-only commands: project, comp, layer, property tree, keyframes, effects. (src/tools/inspect.ts)

// Project items in panel order. On big projects, name / type narrow the list and limit / offset page it (the same
// fields as get_comp: matched and next_offset only when not everything was returned). The comps on the page include
// their layers (as in get_comp's list) unless the page holds too many, so a model can go straight from here to the
// layer it needs (get_project, get_comp, get_layer was the usual start: two turns more).
var PROJECT_LAYERS_MAX = 300;
C.get_project = function (a?: Args["get_project"]) {
  var p = app.project, page: _ItemClasses[] = [], items: Obj[] = [], i, j, it, ai = p.activeItem, o: Obj, n = 0, q, lim, off, total = 0, withLayers;
  a = a || {};
  q = a.name ? String(a.name).toLowerCase() : ""; lim = a.limit || 200; off = a.offset || 0;
  for (i = 1; i <= p.numItems; i++) {
    it = p.item(i);
    if (q && it.name.toLowerCase().indexOf(q) === -1) continue;
    if (a.type && itemType(it) !== a.type) continue;
    if (n++ < off || page.length >= lim) continue;
    page.push(it);
    if (it instanceof CompItem) total += it.numLayers;
  }
  withLayers = total <= PROJECT_LAYERS_MAX;
  for (i = 0; i < page.length; i++) {
    it = page[i]; o = itemInfo(it);
    if (withLayers && it instanceof CompItem) { o.layers = []; for (j = 1; j <= it.numLayers; j++) o.layers.push(layerBrief(it.layer(j) as AVLayer, it)); }
    items.push(o);
  }
  o = {
    ae_version: app.version, project_path: p.file ? p.file.fsName : null, active_comp_id: (ai instanceof CompItem) ? ai.id : null,
    num_items: p.numItems, items: items, layers_listed: withLayers
  };
  if (n !== items.length) { o.matched = n; if (off + items.length < n) o.next_offset = off + items.length; }
  return o;
};

// Backs the ae://selection resource (not a tool).
C.get_selection = function () {
  var ai = app.project.activeItem, out = [], i;
  if (!(ai instanceof CompItem)) return { comp_id: null, layers: [] };
  for (i = 0; i < ai.selectedLayers.length; i++) out.push(layerInfo(ai.selectedLayers[i] as AVLayer));
  return { comp_id: ai.id, layers: out };
};

// A comp and its layers (top of the stack first). On big comps, name / kind / at narrow the list and limit / offset
// page it; kinds counts every layer by kind.
C.get_comp = function (a: Args["get_comp"]) {
  need(a, ["comp_id"]);
  var c = getComp(a.comp_id), o = compInfo(c, false), q = a.name ? String(a.name).toLowerCase() : "", lim = a.limit || 150, off = a.offset || 0,
    rows = [], kinds: { [kind: string]: number } = {}, i, l, k, n = 0;
  for (i = 1; i <= c.numLayers; i++) {
    l = c.layer(i); k = layerKind(l); kinds[k] = (kinds[k] || 0) + 1;
    if (q && l.name.toLowerCase().indexOf(q) === -1) continue;
    if (a.kind && k !== a.kind) continue;
    if (has(a, "at") && (a.at < l.inPoint - 1e-6 || a.at >= l.outPoint - 1e-6)) continue;
    if (n++ < off || rows.length >= lim) continue;
    rows.push(layerBrief(l as AVLayer, c));
  }
  o.layers = rows;
  if (c.numLayers > 20) o.kinds = kinds;
  if (n !== rows.length) { o.matched = n; if (off + rows.length < n) o.next_offset = off + rows.length; }
  return o;
};

C.get_layer = function (a: Args["get_layer"]) {
  var many = has(a, "layer_ids"), out = [], i;
  if (many === has(a, "layer_id")) fail("BAD_ARGS", "Pass layer_id or layer_ids (not both)", "layer_ids reads several layers in one call");
  if (!many) return layerDetail(getLayer(a.layer_id!), a.time || 0);
  if (!(a.layer_ids instanceof Array) || a.layer_ids.length === 0) fail("BAD_ARGS", "layer_ids must list at least one layer");
  for (i = 0; i < a.layer_ids.length; i++) out.push(layerDetail(getLayer(a.layer_ids[i]), a.time || 0));
  return { layers: out };
};

function layerDetail(l: AVLayer, time: number): Obj {
  var o: Obj = layerInfo(l), names = ["anchor", "position", "scale", "rotation", "opacity"], i, p, v, fx, eff;
  o.transform = {}; o.expressions = [];
  for (i = 0; i < names.length; i++) {
    try {
      p = resolvePath(l, names[i]); v = safeVal(p, time);
      if (v !== undefined) o.transform[names[i]] = v;
      if (p.expressionEnabled) o.expressions.push(names[i]);
    } catch (e1) {}
  }
  if (o.kind === "text") o.text = safe(function () {
    var d = l.property("ADBE Text Properties").property("ADBE Text Document");
    return (d.numKeys ? d.valueAtTime(time, false) : d.value).text;
  });
  o.effects = []; fx = l.property("ADBE Effect Parade");
  if (fx) for (i = 1; i <= fx.numProperties; i++) { eff = fx.property(i); o.effects.push({ index: i, name: eff.name, match_name: eff.matchName, enabled: eff.enabled }); }
  try { o.num_markers = l.property("ADBE Marker").numKeys; } catch (e2) { o.num_markers = 0; }
  o.masks = safe(function () {
    var ms = l.property("ADBE Mask Parade"), out: Obj[] = [], k, m;
    if (!ms) return out;
    for (k = 1; k <= ms.numProperties; k++) { m = ms.property(k); out.push({ index: k, name: m.name, mode: maskModeName(m.maskMode), inverted: m.inverted, locked: m.locked }); }
    return out;
  });
  o.bounds = safe(function () {
    var r = contentRect(l, time);
    return r ? { content: r, comp: compBounds(l, time) } : null;
  });
  o.track_matte = safe(function () {
    if (!l.hasTrackMatte) return null;
    return { type: matteTypeName(l.trackMatteType), matte_layer_id: safe(function () { return l.trackMatteLayer!.id; }) };
  });
  return o;
}

C.list_properties = function (a: Args["list_properties"]) {
  need(a, ["layer_id"]);
  var l = getLayer(a.layer_id), root: PropertyGroup = l, maxDepth = a.depth === undefined ? 3 : a.depth;
  if (a.group_path) root = resolvePath<PropertyGroup>(l, a.group_path);
  // a group_path straight into a skipped group (e.g. Material Options) lists it
  return { properties: walk(root, 1, maxDepth, a.time || 0, a.all === true || (a.group_path && WALK_SKIP[root.matchName] === 1)) };
};

// The length of v as the server will send it (compact JSON, numbers at 6 significant digits), a little over.
function jsonSize(v: any): number {
  var n = 2, i, k;
  if (v === null || v === undefined) return 4;
  if (typeof v === "number") return String(v % 1 === 0 ? v : Number(v.toPrecision(6))).length;
  if (typeof v === "string") return v.length + 2 + (v.split(/["\\\n\r\t]/).length - 1); // each of these takes two characters
  if (typeof v === "boolean") return v ? 4 : 5;
  if (v instanceof Array) { for (i = 0; i < v.length; i++) n += jsonSize(v[i]) + 1; return n; }
  for (k in v) { if (v.hasOwnProperty(k) && v[k] !== undefined) n += k.length + 4 + jsonSize(v[k]); }
  return n;
}

// What one get_keyframes reply holds of keys (and its expression), in characters: under the server's 25,000 limit.
var KEYS_ROOM = 24000;

// Every key in one reply when they fit, which is the usual case; otherwise as many as fit, with next_offset for the
// rest. Sending them all whatever their size passed the response limit (a sampled 3D camera path from about 150
// keys) and nothing could read them; a fixed page size made short keys take several calls for no reason.
C.get_keyframes = function (a: Args["get_keyframes"]) {
  need(a, ["layer_id", "path"]);
  var l = getLayer(a.layer_id), p = resolvePath(l, a.path), out: KeyInfo[] = [], i, n, v, res: Obj, lim = a.limit || 1e9, off = a.offset || 0, ex: string | null, room, k;
  if (p.propertyType !== PropertyType.PROPERTY) fail("BAD_ARGS", "path must point to a property, not a group", "Use list_properties");
  n = p.numKeys;
  ex = (p.canSetExpression && p.expressionEnabled) ? p.expression : null;
  room = KEYS_ROOM - (ex ? Math.round(ex.length * 1.1) : 0);
  for (i = off + 1; i <= n && out.length < lim; i++) {
    k = keyInfo(p, i); room -= jsonSize(k) + 1;
    if (room < 0 && out.length) break; // always at least one key, so paging moves on
    out.push(k);
  }
  res = { num_keys: n };
  if (off + out.length < n) res.next_offset = off + out.length;
  if (n === 0) { v = safeVal(p, 0, true); if (v !== undefined) res.value = v; } // unanimated: its value, before any expression
  res.keys = out; res.expression = ex;
  return res;
};

C.find_effects = function (a: Args["find_effects"]) {
  var qs = String(a.query || "").toLowerCase(), out = [], i, e;
  for (i = 0; i < app.effects.length && out.length < 50; i++) {
    e = app.effects[i];
    if ((e.displayName + " " + e.matchName + " " + e.category).toLowerCase().indexOf(qs) !== -1)
      out.push({ display_name: e.displayName, match_name: e.matchName, category: e.category });
  }
  return { effects: out };
};
