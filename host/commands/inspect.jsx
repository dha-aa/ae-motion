// Read-only commands: project, comp, layer, property tree, keyframes, effects. (src/tools/inspect.ts)

C.get_project = function () {
  var p = app.project, items = [], i, ai = p.activeItem;
  for (i = 1; i <= p.numItems && i <= 500; i++) items.push(itemInfo(p.item(i)));
  return {
    ae_version: app.version, project_path: p.file ? p.file.fsName : null,
    active_comp_id: (ai instanceof CompItem) ? ai.id : null, num_items: p.numItems, items: items, truncated: p.numItems > 500
  };
};

// Backs the ae://selection resource (not a tool).
C.get_selection = function () {
  var ai = app.project.activeItem, out = [], i;
  if (!(ai instanceof CompItem)) return { comp_id: null, layers: [] };
  for (i = 0; i < ai.selectedLayers.length; i++) out.push(layerInfo(ai.selectedLayers[i]));
  return { comp_id: ai.id, layers: out };
};

// A comp and its layers (top of the stack first). On big comps, name / kind / at narrow the list and limit / offset
// page it; kinds counts every layer by kind.
C.get_comp = function (a) {
  need(a, ["comp_id"]);
  var c = getComp(a.comp_id), o = compInfo(c, false), q = a.name ? String(a.name).toLowerCase() : "", lim = a.limit || 150, off = a.offset || 0,
    rows = [], kinds = {}, i, l, k, n = 0;
  for (i = 1; i <= c.numLayers; i++) {
    l = c.layer(i); k = layerKind(l); kinds[k] = (kinds[k] || 0) + 1;
    if (q && l.name.toLowerCase().indexOf(q) === -1) continue;
    if (a.kind && k !== a.kind) continue;
    if (has(a, "at") && (a.at < l.inPoint - 1e-6 || a.at >= l.outPoint - 1e-6)) continue;
    if (n++ < off || rows.length >= lim) continue;
    rows.push(layerBrief(l, c));
  }
  o.layers = rows;
  if (c.numLayers > 20) o.kinds = kinds;
  if (n !== rows.length) { o.matched = n; if (off + rows.length < n) o.next_offset = off + rows.length; }
  return o;
};

C.get_layer = function (a) {
  need(a, ["layer_id"]);
  var l = getLayer(a.layer_id), time = a.time || 0, o = layerInfo(l), names = ["anchor", "position", "scale", "rotation", "opacity"], i, p, v, fx, eff;
  o.transform = {}; o.expressions = [];
  for (i = 0; i < names.length; i++) {
    try {
      p = resolvePath(l, names[i]); v = safeVal(p, time);
      if (v !== undefined) o.transform[names[i]] = v;
      if (p.expressionEnabled) o.expressions.push(names[i]);
    } catch (e1) {}
  }
  o.effects = []; fx = l.property("ADBE Effect Parade");
  if (fx) for (i = 1; i <= fx.numProperties; i++) { eff = fx.property(i); o.effects.push({ index: i, name: eff.name, match_name: eff.matchName, enabled: eff.enabled }); }
  try { o.num_markers = l.property("ADBE Marker").numKeys; } catch (e2) { o.num_markers = 0; }
  o.masks = safe(function () {
    var ms = l.property("ADBE Mask Parade"), out = [], k, m;
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
    return { type: matteTypeName(l.trackMatteType), matte_layer_id: safe(function () { return l.trackMatteLayer.id; }) };
  });
  return o;
};

C.list_properties = function (a) {
  need(a, ["layer_id"]);
  var l = getLayer(a.layer_id), root = l, maxDepth = a.depth === undefined ? 3 : a.depth;
  if (a.group_path) root = resolvePath(l, a.group_path);
  // a group_path straight into a skipped group (e.g. Material Options) lists it
  return { properties: walk(root, 1, maxDepth, a.time || 0, a.all === true || (a.group_path && WALK_SKIP[root.matchName] === 1)) };
};

C.get_keyframes = function (a) {
  need(a, ["layer_id", "path"]);
  var l = getLayer(a.layer_id), p = resolvePath(l, a.path), out = [], i, n;
  if (p.propertyType !== PropertyType.PROPERTY) fail("BAD_ARGS", "path must point to a property, not a group", "Use list_properties");
  n = p.numKeys;
  for (i = 1; i <= n && i <= 500; i++) out.push(keyInfo(p, i));
  return { num_keys: n, keys: out, expression: (p.canSetExpression && p.expressionEnabled) ? p.expression : null };
};

C.find_effects = function (a) {
  var qs = String(a.query || "").toLowerCase(), out = [], i, e;
  for (i = 0; i < app.effects.length && out.length < 50; i++) {
    e = app.effects[i];
    if ((e.displayName + " " + e.matchName + " " + e.category).toLowerCase().indexOf(qs) !== -1)
      out.push({ display_name: e.displayName, match_name: e.matchName, category: e.category });
  }
  return { effects: out };
};
