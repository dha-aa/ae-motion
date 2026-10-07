// AE Motion MCP: host script (ExtendScript, ES3). Loaded by the CEP panel.
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

var AEM = (function () {
  var ALIAS = {
    position: ["ADBE Transform Group", "ADBE Position"],
    scale: ["ADBE Transform Group", "ADBE Scale"],
    rotation: ["ADBE Transform Group", "ADBE Rotate Z"],
    opacity: ["ADBE Transform Group", "ADBE Opacity"],
    anchor: ["ADBE Transform Group", "ADBE Anchor Point"]
  };
  var READONLY = { get_project: 1, get_selection: 1, get_comp: 1, get_layer: 1, list_properties: 1, find_effects: 1, preview_frame: 1, prepare_render: 1, list_markers: 1, get_keyframes: 1, set_playhead: 1, save_project: 1 };

  function fail(code, message, hint) { throw { aem: true, code: code, message: message, hint: hint || "" }; }
  function has(o, k) { return o[k] !== undefined && o[k] !== null; }
  function need(a, names) {
    for (var i = 0; i < names.length; i++) if (!has(a, names[i])) fail("BAD_ARGS", "Missing argument: " + names[i]);
  }
  function copyArr(v) { var o = [], i; for (i = 0; i < v.length; i++) o.push(v[i]); return o; }
  function rgba(c) { return c.length === 3 ? [c[0], c[1], c[2], 1] : c; }

  // ---------- lookup ----------
  function getItem(id) {
    var it = null;
    try { it = app.project.itemByID(id); } catch (e) {}
    if (!it) fail("NOT_FOUND", "Item id " + id + " not found", "Use get_project");
    return it;
  }
  function getComp(id) {
    var it = getItem(id);
    if (!(it instanceof CompItem)) fail("BAD_ARGS", "Item " + id + " is not a composition");
    return it;
  }
  function getLayer(id) {
    var p = app.project, i, j, it, l;
    if (typeof p.layerByID === "function") { try { l = p.layerByID(id); if (l) return l; } catch (e) {} }
    for (i = 1; i <= p.numItems; i++) {
      it = p.item(i);
      if (it instanceof CompItem) {
        for (j = 1; j <= it.numLayers; j++) { l = it.layer(j); if (l.id === id) return l; }
      }
    }
    fail("NOT_FOUND", "Layer id " + id + " not found", "Use get_comp to list layer ids");
  }
  function resolvePath(layer, path) {
    if (typeof path === "string") path = ALIAS[path] ? ALIAS[path] : [path];
    if (!(path instanceof Array) || !path.length) fail("BAD_ARGS", "path must be an alias or a non-empty array of match names");
    var p = layer, i, nxt;
    for (i = 0; i < path.length; i++) {
      nxt = null;
      try { nxt = p.property(path[i]); } catch (e) { nxt = null; }
      if (!nxt) fail("NOT_FOUND", "Property not found at '" + path[i] + "'", "Use list_properties to see valid match names");
      p = nxt;
    }
    return p;
  }

  // ---------- describe ----------
  function layerKind(l) {
    if (l instanceof TextLayer) return "text";
    if (l instanceof ShapeLayer) return "shape";
    if (l instanceof CameraLayer) return "camera";
    if (l instanceof LightLayer) return "light";
    if (l.nullLayer) return "null";
    if (l.adjustmentLayer) return "adjustment";
    if (l.source instanceof CompItem) return "precomp";
    if (l.source && l.source.mainSource instanceof SolidSource) return "solid";
    return "footage";
  }
  function layerInfo(l) {
    return {
      id: l.id, index: l.index, name: l.name, kind: layerKind(l),
      "in": l.inPoint, "out": l.outPoint, start: l.startTime,
      parent_id: l.parent ? l.parent.id : null, enabled: l.enabled, comp_id: l.containingComp.id,
      locked: l.locked, shy: l.shy, solo: l.solo, label: l.label,
      three_d: safe(function () { return l.threeDLayer; }), stretch: safe(function () { return l.stretch; })
    };
  }
  function compInfo(c, withLayers) {
    var o = {
      id: c.id, name: c.name, width: c.width, height: c.height, fps: c.frameRate, duration: c.duration,
      pixel_aspect: c.pixelAspect, bg_color: [c.bgColor[0], c.bgColor[1], c.bgColor[2]], num_layers: c.numLayers,
      work_area_start: c.workAreaStart, work_area_duration: c.workAreaDuration, time: c.time,
      num_markers: safe(function () { return c.markerProperty.numKeys; })
    };
    if (withLayers) { o.layers = []; for (var i = 1; i <= c.numLayers; i++) o.layers.push(layerInfo(c.layer(i))); }
    return o;
  }
  function itemInfo(it) {
    var o = { id: it.id, name: it.name, type: it instanceof CompItem ? "comp" : (it instanceof FolderItem ? "folder" : "footage") };
    if (it instanceof CompItem || it instanceof FootageItem) { o.width = it.width; o.height = it.height; o.duration = it.duration; }
    return o;
  }
  function vt(p) {
    var t = p.propertyValueType, V = PropertyValueType;
    if (t === V.OneD) return "1d"; if (t === V.TwoD) return "2d"; if (t === V.ThreeD) return "3d";
    if (t === V.COLOR) return "color"; if (t === V.TwoD_SPATIAL) return "2d_spatial"; if (t === V.ThreeD_SPATIAL) return "3d_spatial";
    if (t === V.SHAPE) return "shape"; if (t === V.TEXT_DOCUMENT) return "text"; if (t === V.NO_VALUE) return "none";
    if (t === V.MARKER) return "marker"; if (t === V.LAYER_INDEX) return "layer_index"; if (t === V.MASK_INDEX) return "mask_index";
    return "custom";
  }
  function safeVal(p, time) {
    var t = p.propertyValueType, V = PropertyValueType, v;
    try {
      if (t === V.TEXT_DOCUMENT) return p.value.text;
      if (t === V.OneD || t === V.TwoD || t === V.ThreeD || t === V.COLOR || t === V.TwoD_SPATIAL || t === V.ThreeD_SPATIAL || t === V.LAYER_INDEX || t === V.MASK_INDEX) {
        v = p.canVaryOverTime ? p.valueAtTime(time, false) : p.value;
        return v instanceof Array ? copyArr(v) : v;
      }
    } catch (e) {}
    return undefined;
  }
  function walk(g, depth, maxDepth, time) {
    var out = [], i, p, node, v;
    for (i = 1; i <= g.numProperties; i++) {
      p = g.property(i);
      node = { name: p.name, match_name: p.matchName, index: i };
      if (p.propertyType === PropertyType.PROPERTY) {
        node.type = "property"; node.value_type = vt(p); node.num_keys = p.numKeys;
        if (p.canSetExpression && p.expressionEnabled) node.expression = p.expression;
        v = safeVal(p, time); if (v !== undefined) node.value = v;
      } else {
        node.type = p.propertyType === PropertyType.INDEXED_GROUP ? "indexed_group" : "group";
        if (depth < maxDepth) node.children = walk(p, depth + 1, maxDepth, time); else node.num_children = p.numProperties;
      }
      out.push(node);
    }
    return out;
  }

  // ---------- values / keys ----------
  function coerce(prop, v) {
    var t = prop.propertyValueType, V = PropertyValueType;
    if (t === V.TEXT_DOCUMENT) fail("BAD_ARGS", "Text properties are set with set_text");
    if (t === V.SHAPE || t === V.NO_VALUE || t === V.CUSTOM_VALUE || t === V.MARKER) fail("BAD_ARGS", "Property type '" + vt(prop) + "' cannot be set with this tool", "Use run_jsx if AE_MCP_ALLOW_JSX=1");
    if (t === V.COLOR && v instanceof Array && v.length === 3) return rgba(v);
    return v;
  }
  function mkEase(spec) {
    if (spec === "easy") return new KeyframeEase(0, 33.333333);
    var inf = spec.influence === undefined ? 33.333333 : spec.influence;
    inf = Math.max(0.1, Math.min(100, inf));
    return new KeyframeEase(spec.speed === undefined ? 0 : spec.speed, inf);
  }
  function applyKeyMeta(prop, idx, k) {
    var interp = k.interp, typ, dims, inE, outE, e, d;
    if ((k.ease_in || k.ease_out) && !interp) interp = "bezier";
    if (interp) {
      typ = interp === "linear" ? KeyframeInterpolationType.LINEAR : (interp === "hold" ? KeyframeInterpolationType.HOLD : KeyframeInterpolationType.BEZIER);
      prop.setInterpolationTypeAtKey(idx, typ, typ);
    }
    if (k.ease_in || k.ease_out) {
      dims = prop.isSpatial ? 1 : (prop.value instanceof Array ? prop.value.length : 1);
      inE = prop.keyInTemporalEase(idx); outE = prop.keyOutTemporalEase(idx);
      if (k.ease_in) { e = mkEase(k.ease_in); inE = []; for (d = 0; d < dims; d++) inE.push(e); }
      if (k.ease_out) { e = mkEase(k.ease_out); outE = []; for (d = 0; d < dims; d++) outE.push(e); }
      prop.setTemporalEaseAtKey(idx, inE, outE);
    }
  }
  function keyList(prop) {
    var out = [], i, v;
    for (i = 1; i <= prop.numKeys && i <= 200; i++) {
      v = prop.keyValue(i);
      out.push({ t: prop.keyTime(i), v: v instanceof Array ? copyArr(v) : v });
    }
    return out;
  }
  function shiftKeys(p, dt) {
    var n = p.numKeys, ks = [], i, k, idx;
    for (i = 1; i <= n; i++) {
      k = { t: p.keyTime(i), v: p.keyValue(i), ii: p.keyInInterpolationType(i), oi: p.keyOutInterpolationType(i) };
      try { k.ie = p.keyInTemporalEase(i); k.oe = p.keyOutTemporalEase(i); } catch (e) {}
      ks.push(k);
    }
    for (i = n; i >= 1; i--) p.removeKey(i);
    for (i = 0; i < ks.length; i++) p.setValueAtTime(ks[i].t + dt, ks[i].v);
    for (i = 0; i < ks.length; i++) {
      idx = p.nearestKeyIndex(ks[i].t + dt);
      try { p.setInterpolationTypeAtKey(idx, ks[i].ii, ks[i].oi); } catch (e1) {}
      if (ks[i].ie) { try { p.setTemporalEaseAtKey(idx, ks[i].ie, ks[i].oe); } catch (e2) {} }
    }
  }

  // ---------- shape helper ----------
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

  // ---------- commands ----------
  var C = {};

  C.get_project = function () {
    var p = app.project, items = [], i, ai = p.activeItem;
    for (i = 1; i <= p.numItems && i <= 500; i++) items.push(itemInfo(p.item(i)));
    return {
      ae_version: app.version, project_path: p.file ? p.file.fsName : null,
      active_comp_id: (ai instanceof CompItem) ? ai.id : null, num_items: p.numItems, items: items, truncated: p.numItems > 500
    };
  };
  C.get_selection = function () {
    var ai = app.project.activeItem, out = [], i;
    if (!(ai instanceof CompItem)) return { comp_id: null, layers: [] };
    for (i = 0; i < ai.selectedLayers.length; i++) out.push(layerInfo(ai.selectedLayers[i]));
    return { comp_id: ai.id, layers: out };
  };
  C.get_comp = function (a) { need(a, ["comp_id"]); return compInfo(getComp(a.comp_id), true); };
  C.get_layer = function (a) {
    need(a, ["layer_id"]);
    var l = getLayer(a.layer_id), time = a.time || 0, o = layerInfo(l), names = ["anchor", "position", "scale", "rotation", "opacity"], i, p, v, fx, eff, e;
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
    return o;
  };
  C.list_properties = function (a) {
    need(a, ["layer_id"]);
    var l = getLayer(a.layer_id), root = l, maxDepth = a.depth === undefined ? 3 : a.depth;
    if (a.group_path) root = resolvePath(l, a.group_path);
    return { properties: walk(root, 1, maxDepth, a.time || 0) };
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
  C.create_comp = function (a) {
    need(a, ["name", "width", "height", "fps", "duration"]);
    var c = app.project.items.addComp(a.name, a.width, a.height, 1, a.duration, a.fps);
    if (a.bg_color) c.bgColor = [a.bg_color[0], a.bg_color[1], a.bg_color[2]];
    try { c.openInViewer(); } catch (e) {}
    return compInfo(c, false);
  };
  C.import_footage = function (a) {
    need(a, ["path"]);
    var f = new File(a.path), io, it;
    if (!f.exists) fail("NOT_FOUND", "File not found: " + a.path);
    io = new ImportOptions(f);
    if (a.as === "sequence") io.sequence = true;
    if (!io.canImportAs(ImportAsType.FOOTAGE)) fail("BAD_ARGS", "File cannot be imported as footage");
    io.importAs = ImportAsType.FOOTAGE;
    it = app.project.importFile(io);
    return itemInfo(it);
  };
  C.add_layer = function (a) {
    need(a, ["comp_id", "kind"]);
    var comp = getComp(a.comp_id), o = a.options || {}, kind = a.kind, dur = has(o, "duration") ? o.duration : comp.duration, l, item, col, size, lt;
    if (kind === "shape" && o.shape && o.shape.type && " rect ellipse star polygon path ".indexOf(" " + o.shape.type + " ") === -1) fail("BAD_ARGS", "shape.type must be rect, ellipse, star, polygon or path");
    if (kind === "footage" || kind === "precomp") { need(o, ["item_id"]); item = getItem(o.item_id); }
    if (kind === "solid" || kind === "adjustment") {
      col = o.color || [1, 1, 1]; size = o.size || [comp.width, comp.height];
      l = comp.layers.addSolid([col[0], col[1], col[2]], o.name || (kind === "solid" ? "Solid" : "Adjustment Layer"), size[0], size[1], 1, dur);
      if (kind === "adjustment") l.adjustmentLayer = true;
    } else if (kind === "text") { l = comp.layers.addText(has(o, "text") ? o.text : "Text");
    } else if (kind === "shape") { l = comp.layers.addShape(); l.name = "Shape Layer"; if (o.shape) addShapeContent(l, o.shape);
    } else if (kind === "null") { l = comp.layers.addNull(dur);
    } else if (kind === "footage" || kind === "precomp") { l = comp.layers.add(item);
    } else if (kind === "camera") { l = comp.layers.addCamera(o.name || "Camera 1", o.center || [comp.width / 2, comp.height / 2]);
    } else if (kind === "light") {
      l = comp.layers.addLight(o.name || "Light 1", o.center ? [o.center[0], o.center[1]] : [comp.width / 2, comp.height / 2]);
      if (o.light_type) {
        lt = LightType[String(o.light_type).toUpperCase()];
        if (lt === undefined) fail("BAD_ARGS", "light_type must be point, spot, parallel or ambient");
        l.lightType = lt;
      }
    } else { fail("BAD_ARGS", "Unknown layer kind: " + kind); }
    if (o.name) l.name = o.name;
    if (has(o, "start")) l.startTime = o.start;
    if (has(o, "in")) l.inPoint = o["in"];
    if (has(o, "out")) l.outPoint = o.out;
    return layerInfo(l);
  };
  C.set_layer = function (a) {
    need(a, ["layer_id"]);
    var l = getLayer(a.layer_id), par, bm;
    if (has(a, "blend_mode")) {
      bm = BlendingMode[String(a.blend_mode).toUpperCase().replace(/ /g, "_")];
      if (bm === undefined) fail("BAD_ARGS", "Unknown blend mode: " + a.blend_mode);
    }
    if (has(a, "parent_id")) par = getLayer(a.parent_id);
    if (a.locked === false) l.locked = false;
    if (has(a, "name")) l.name = a.name;
    if (has(a, "stretch")) { if (!a.stretch) fail("BAD_ARGS", "stretch cannot be 0"); l.stretch = a.stretch; }
    if (has(a, "three_d")) l.threeDLayer = a.three_d;
    if (has(a, "shy")) l.shy = a.shy;
    if (has(a, "solo")) l.solo = a.solo;
    if (has(a, "label")) l.label = a.label;
    if (has(a, "motion_blur")) l.motionBlur = a.motion_blur;
    if (has(a, "time_remap")) { if (!l.canSetTimeRemapEnabled) fail("BAD_ARGS", "This layer cannot use time remapping"); l.timeRemapEnabled = a.time_remap; }
    if (has(a, "start")) l.startTime = a.start;
    if (has(a, "in")) l.inPoint = a["in"];
    if (has(a, "out")) l.outPoint = a.out;
    if (has(a, "enabled")) l.enabled = a.enabled;
    if (bm !== undefined) l.blendingMode = bm;
    if (a.parent_id === null) l.parent = null; else if (par) l.parent = par;
    if (a.locked === true) l.locked = true;
    return layerInfo(l);
  };
  C.delete_layer = function (a) {
    need(a, ["layer_id"]);
    var l = getLayer(a.layer_id), info = layerInfo(l);
    l.remove();
    return { deleted: info };
  };
  C.precompose = function (a) {
    need(a, ["layer_ids", "name"]);
    var ls = [], idx = [], i, comp, nc;
    for (i = 0; i < a.layer_ids.length; i++) ls.push(getLayer(a.layer_ids[i]));
    comp = ls[0].containingComp;
    for (i = 0; i < ls.length; i++) {
      if (ls[i].containingComp.id !== comp.id) fail("BAD_ARGS", "All layers must be in the same composition");
      idx.push(ls[i].index);
    }
    idx.sort(function (x, y) { return x - y; });
    nc = comp.layers.precompose(idx, a.name, true);
    return compInfo(nc, true);
  };
  C.set_property = function (a) {
    need(a, ["layer_id", "path", "value"]);
    var l = getLayer(a.layer_id), p = resolvePath(l, a.path), v = coerce(p, a.value), rv;
    if (has(a, "time")) {
      if (!p.canVaryOverTime) fail("BAD_ARGS", "Property is not keyframable");
      p.setValueAtTime(a.time, v);
    } else {
      if (p.numKeys > 0) fail("BAD_ARGS", "Property is animated; pass time to set a value at a time, or use set_keyframes");
      p.setValue(v);
    }
    rv = safeVal(p, has(a, "time") ? a.time : 0);
    return { value: rv === undefined ? null : rv, num_keys: p.numKeys };
  };
  C.set_keyframes = function (a) {
    need(a, ["layer_id", "path", "keys"]);
    var l = getLayer(a.layer_id), p = resolvePath(l, a.path), vals = [], i, k, idx;
    if (!p.canVaryOverTime) fail("BAD_ARGS", "Property is not keyframable");
    if (!(a.keys instanceof Array) || !a.keys.length) fail("BAD_ARGS", "keys must be a non-empty array");
    if (p.expressionEnabled) fail("BAD_ARGS", "Property has an active expression", "Clear it with set_expression and an empty expression");
    for (i = 0; i < a.keys.length; i++) {
      k = a.keys[i];
      if (typeof k.t !== "number" || !has(k, "v")) fail("BAD_ARGS", "Each key needs numeric t and a v");
      vals.push(coerce(p, k.v));
    }
    for (i = p.numKeys; i >= 1; i--) p.removeKey(i);
    for (i = 0; i < a.keys.length; i++) p.setValueAtTime(a.keys[i].t, vals[i]);
    for (i = 0; i < a.keys.length; i++) { idx = p.nearestKeyIndex(a.keys[i].t); applyKeyMeta(p, idx, a.keys[i]); }
    return { num_keys: p.numKeys, keys: keyList(p) };
  };
  C.set_expression = function (a) {
    need(a, ["layer_id", "path"]);
    var l = getLayer(a.layer_id), p = resolvePath(l, a.path), ex = a.expression || "", err;
    if (!p.canSetExpression) fail("BAD_ARGS", "Property does not support expressions");
    p.expression = ex;
    if (!ex) return { valid: true, enabled: false };
    err = p.expressionError;
    return { valid: !err, error: err || null, enabled: p.expressionEnabled };
  };
  C.apply_effect = function (a) {
    need(a, ["layer_id", "match_name"]);
    var l = getLayer(a.layer_id), parade = l.property("ADBE Effect Parade"), fx, key, p, errs = [];
    if (!parade) fail("BAD_ARGS", "Layer does not support effects");
    if (!parade.canAddProperty(a.match_name)) fail("NOT_FOUND", "Unknown effect match name: " + a.match_name, "Use find_effects");
    fx = parade.addProperty(a.match_name);
    if (a.name) fx.name = a.name;
    if (a.params) {
      for (key in a.params) {
        if (!a.params.hasOwnProperty(key)) continue;
        try {
          p = fx.property(/^\d+$/.test(key) ? parseInt(key, 10) : key);
          if (!p) throw new Error("no such parameter");
          p.setValue(coerce(p, a.params[key]));
        } catch (e) { errs.push(key + ": " + (e && e.message ? e.message : String(e))); }
      }
      if (errs.length) { fx.remove(); fail("BAD_ARGS", "Effect params failed: " + errs.join("; "), "Use list_properties on an existing effect to see parameter names"); }
    }
    return { effect_index: fx.propertyIndex, name: fx.name, match_name: fx.matchName };
  };
  C.apply_preset = function (a) {
    need(a, ["layer_id", "ffx_path"]);
    var l = getLayer(a.layer_id), f = new File(a.ffx_path);
    if (!f.exists) fail("NOT_FOUND", "Preset not found: " + a.ffx_path);
    l.applyPreset(f);
    return layerInfo(l);
  };
  C.set_text = function (a) {
    need(a, ["layer_id"]);
    var l = getLayer(a.layer_id), prop, doc, J = ParagraphJustification;
    if (!(l instanceof TextLayer)) fail("BAD_ARGS", "Layer is not a text layer");
    prop = l.property("ADBE Text Properties").property("ADBE Text Document");
    doc = prop.value;
    if (has(a, "text")) doc.text = a.text;
    if (a.font) doc.font = a.font;
    if (has(a, "size")) doc.fontSize = a.size;
    if (a.color) { doc.fillColor = [a.color[0], a.color[1], a.color[2]]; doc.applyFill = true; }
    if (has(a, "tracking")) doc.tracking = a.tracking;
    if (a.justification) {
      doc.justification = a.justification === "center" ? J.CENTER_JUSTIFY : (a.justification === "right" ? J.RIGHT_JUSTIFY : J.LEFT_JUSTIFY);
    }
    prop.setValue(doc);
    return { text: prop.value.text, font: prop.value.font, size: prop.value.fontSize };
  };
  C.stagger = function (a) {
    need(a, ["layer_ids", "path", "offset_seconds"]);
    var ids = copyArr(a.layer_ids), props = [], i, p;
    if (a.order === "reverse") ids.reverse();
    for (i = 0; i < ids.length; i++) {
      p = resolvePath(getLayer(ids[i]), a.path);
      if (!p.numKeys) fail("BAD_ARGS", "Layer " + ids[i] + " has no keyframes on that property");
      props.push(p);
    }
    for (i = 1; i < props.length; i++) shiftKeys(props[i], i * a.offset_seconds);
    return { staggered: ids.length, note: "Spatial tangents are not preserved" };
  };
  C.preview_frame = function (a) {
    need(a, ["comp_id", "time", "output_path"]);
    var comp = getComp(a.comp_id), f = new File(a.output_path);
    if (typeof comp.saveFrameToPng !== "function") fail("UNSUPPORTED", "comp.saveFrameToPng is not available in this After Effects version", "Update After Effects");
    if (!f.parent.exists) f.parent.create();
    try { comp.openInViewer(); } catch (e) {}
    comp.saveFrameToPng(a.time, f);
    return { path: f.fsName, exists: f.exists };
  };
  C.prepare_render = function (a) {
    need(a, ["comp_id"]);
    var comp = getComp(a.comp_id);
    if (!app.project.file) fail("BAD_ARGS", "Project has never been saved", "Save the project in After Effects first");
    app.project.save();
    return {
      project_path: app.project.file.fsName, comp_name: comp.name,
      total_frames: Math.round(comp.duration * comp.frameRate), fps: comp.frameRate, aerender_dir: new Folder(app.path).fsName
    };
  };
  // ---------- helpers: editing, timeline, shapes ----------
  var EPS = 1e-6;
  var MASKMODES = { none: "NONE", add: "ADD", subtract: "SUBTRACT", intersect: "INTERSECT", lighten: "LIGHTEN", darken: "DARKEN", difference: "DIFFERENCE" };
  var MATTES = { alpha: "ALPHA", alpha_inverted: "ALPHA_INVERTED", luma: "LUMA", luma_inverted: "LUMA_INVERTED" };
  var MODIFIERS = { trim_paths: "ADBE Vector Filter - Trim", repeater: "ADBE Vector Filter - Repeater", round_corners: "ADBE Vector Filter - RC" };

  function safe(fn) { try { return fn(); } catch (e) { return undefined; } }
  function snapT(comp, t) { var fd = comp.frameDuration; return Math.round(t / fd) * fd; }
  function layersOf(comp) { var out = [], i; for (i = 1; i <= comp.numLayers; i++) out.push(comp.layer(i)); return out; }
  function pickLayers(ids, comp) {
    var out = [], i, l;
    if (!(ids instanceof Array) || !ids.length) fail("BAD_ARGS", "layer_ids must be a non-empty array");
    for (i = 0; i < ids.length; i++) {
      l = getLayer(ids[i]);
      if (comp && l.containingComp.id !== comp.id) fail("BAD_ARGS", "Layer " + ids[i] + " is not in comp " + comp.id);
      out.push(l);
    }
    return out;
  }
  function sameComp(layers) {
    var comp = layers[0].containingComp, i;
    for (i = 1; i < layers.length; i++) if (layers[i].containingComp.id !== comp.id) fail("BAD_ARGS", "All layers must be in the same composition");
    return comp;
  }
  function assertUnlocked(layers) {
    var i;
    for (i = 0; i < layers.length; i++) if (layers[i].locked) fail("BAD_ARGS", "Layer " + layers[i].id + " is locked", "Unlock it with set_layer locked:false");
  }
  function shiftLayer(l, dt) {
    var i0 = l.inPoint, o0 = l.outPoint;
    l.startTime = l.startTime + dt;
    if (Math.abs(l.inPoint - (i0 + dt)) > 1e-5 || Math.abs(l.outPoint - (o0 + dt)) > 1e-5) {
      if (dt > 0) { l.outPoint = o0 + dt; l.inPoint = i0 + dt; } else { l.inPoint = i0 + dt; l.outPoint = o0 + dt; }
    }
  }
  function splitAt(l, t) {
    var d = l.duplicate();
    l.outPoint = t;
    d.inPoint = t;
    return d;
  }
  function zeros(n) { var o = [], i; for (i = 0; i < n; i++) o.push([0, 0]); return o; }
  function mkShape(v, it, ot, closed) {
    if (!(v instanceof Array) || v.length < 2) fail("BAD_ARGS", "A path needs at least 2 vertices");
    var s = new Shape();
    s.vertices = v;
    s.inTangents = it && it.length === v.length ? it : zeros(v.length);
    s.outTangents = ot && ot.length === v.length ? ot : zeros(v.length);
    s.closed = closed !== false;
    return s;
  }
  function boxShape(type, cx, cy, w, h) {
    var rx = w / 2, ry = h / 2, k = 0.5522847498;
    if (type === "ellipse") {
      return mkShape([[cx, cy - ry], [cx + rx, cy], [cx, cy + ry], [cx - rx, cy]],
        [[-k * rx, 0], [0, -k * ry], [k * rx, 0], [0, k * ry]],
        [[k * rx, 0], [0, k * ry], [-k * rx, 0], [0, -k * ry]], true);
    }
    return mkShape([[cx - rx, cy - ry], [cx + rx, cy - ry], [cx + rx, cy + ry], [cx - rx, cy + ry]], null, null, true);
  }
  function keyVal(p, i) {
    var t = p.propertyValueType, V = PropertyValueType, v;
    if (t === V.TEXT_DOCUMENT) return p.keyValue(i).text;
    if (t === V.SHAPE || t === V.NO_VALUE || t === V.CUSTOM_VALUE || t === V.MARKER) return undefined;
    v = p.keyValue(i);
    return v instanceof Array ? copyArr(v) : v;
  }
  function interpName(t) {
    if (t === KeyframeInterpolationType.LINEAR) return "linear";
    if (t === KeyframeInterpolationType.HOLD) return "hold";
    return "bezier";
  }
  function easeList(arr) { var o = [], i; for (i = 0; i < arr.length; i++) o.push({ speed: arr[i].speed, influence: arr[i].influence }); return o; }
  function markerProp(a) {
    var hasL = has(a, "layer_id"), hasC = has(a, "comp_id");
    if (hasL === hasC) fail("BAD_ARGS", "Pass exactly one of layer_id or comp_id");
    if (hasC) return getComp(a.comp_id).markerProperty;
    return getLayer(a.layer_id).property("ADBE Marker");
  }
  function markerInfo(prop, i) {
    var v = prop.keyValue(i);
    return { index: i, time: prop.keyTime(i), comment: v.comment, duration: v.duration, chapter: v.chapter, url: v.url, label: safe(function () { return v.label; }) };
  }

  // ---------- project / composition / items ----------
  C.save_project = function (a) {
    var p = app.project, f;
    if (has(a, "path")) {
      if (!/\.aepx?$/i.test(a.path)) fail("BAD_ARGS", "Project path must end in .aep or .aepx");
      f = new File(a.path);
      if (f.exists && !a.overwrite) fail("EXISTS", "File already exists: " + a.path, "Pass overwrite: true or choose another path");
      if (!f.parent.exists) f.parent.create();
      p.save(f);
    } else {
      if (!p.file) fail("BAD_ARGS", "Project has never been saved", "Pass a path to Save As");
      p.save();
    }
    return { project_path: p.file ? p.file.fsName : null };
  };
  C.set_comp = function (a) {
    need(a, ["comp_id"]);
    var c = getComp(a.comp_id), wa = a.work_area, ws, wd;
    if (has(a, "name")) c.name = a.name;
    if (has(a, "width")) c.width = a.width;
    if (has(a, "height")) c.height = a.height;
    if (has(a, "fps")) c.frameRate = a.fps;
    if (has(a, "pixel_aspect")) c.pixelAspect = a.pixel_aspect;
    if (a.bg_color) c.bgColor = [a.bg_color[0], a.bg_color[1], a.bg_color[2]];
    if (has(a, "duration")) c.duration = a.duration;
    if (wa) {
      ws = has(wa, "start") ? wa.start : c.workAreaStart;
      wd = has(wa, "duration") ? wa.duration : c.workAreaDuration;
      if (ws < 0 || wd <= 0 || ws + wd > c.duration + EPS) fail("BAD_ARGS", "work_area must fit inside the comp (0 to " + c.duration + " s)");
      try { c.workAreaStart = ws; c.workAreaDuration = wd; } catch (e1) { c.workAreaDuration = wd; c.workAreaStart = ws; }
    }
    return compInfo(c, false);
  };
  C.delete_item = function (a) {
    need(a, ["item_id"]);
    var it = getItem(a.item_id), info = itemInfo(it), used = 0;
    if (!a.force) {
      if (it instanceof FolderItem) { if (it.numItems > 0) fail("BAD_ARGS", "Folder is not empty (" + it.numItems + " items)", "Pass force: true to delete it with its contents"); }
      else { used = it.usedIn ? it.usedIn.length : 0; if (used > 0) fail("BAD_ARGS", "Item is used in " + used + " comp(s)", "Pass force: true to delete it and the layers that use it"); }
    }
    it.remove();
    return { deleted: info };
  };

  // ---------- layers: duplicate / reorder ----------
  C.duplicate_layer = function (a) {
    need(a, ["layer_id"]);
    var l = getLayer(a.layer_id), n = has(a, "count") ? a.count : 1, out = [], i, d;
    if (n < 1 || n > 50) fail("BAD_ARGS", "count must be 1 to 50");
    for (i = 0; i < n; i++) {
      d = l.duplicate();
      if (a.name) d.name = n === 1 ? a.name : a.name + " " + (i + 1);
      if (has(a, "offset_seconds")) shiftLayer(d, a.offset_seconds * (i + 1));
      out.push(layerInfo(d));
    }
    return { layers: out };
  };
  C.reorder_layer = function (a) {
    need(a, ["layer_id"]);
    var l = getLayer(a.layer_id), comp = l.containingComp, n = 0, ref, to = a.to;
    if (to !== undefined && to !== null) n++;
    if (has(a, "index")) n++;
    if (has(a, "before_layer_id")) n++;
    if (has(a, "after_layer_id")) n++;
    if (n !== 1) fail("BAD_ARGS", "Pass exactly one of: to, index, before_layer_id, after_layer_id");
    if (has(a, "before_layer_id") || has(a, "after_layer_id")) {
      ref = getLayer(has(a, "before_layer_id") ? a.before_layer_id : a.after_layer_id);
      if (ref.containingComp.id !== comp.id) fail("BAD_ARGS", "Reference layer is in a different comp");
      if (ref.id === l.id) fail("BAD_ARGS", "Reference layer is the same layer");
      if (has(a, "before_layer_id")) l.moveBefore(ref); else l.moveAfter(ref);
    } else if (has(a, "index")) {
      if (a.index < 1 || a.index > comp.numLayers) fail("BAD_ARGS", "index must be 1 to " + comp.numLayers);
      ref = comp.layer(a.index);
      if (ref.id !== l.id) { if (a.index < l.index) l.moveBefore(ref); else l.moveAfter(ref); }
    } else if (to === "top") { l.moveToBeginning();
    } else if (to === "bottom") { l.moveToEnd();
    } else if (to === "up") { if (l.index > 1) l.moveBefore(comp.layer(l.index - 1));
    } else if (to === "down") { if (l.index < comp.numLayers) l.moveAfter(comp.layer(l.index + 1));
    } else { fail("BAD_ARGS", "to must be top, bottom, up or down"); }
    return layerInfo(l);
  };

  // ---------- timeline editing ----------
  C.split_layer = function (a) {
    need(a, ["layer_ids", "time"]);
    var ls = pickLayers(a.layer_ids), comp = sameComp(ls), t = a.snap === false ? a.time : snapT(comp, a.time), out = [], i, d;
    assertUnlocked(ls);
    for (i = 0; i < ls.length; i++) {
      if (!(t > ls[i].inPoint + EPS && t < ls[i].outPoint - EPS)) fail("BAD_ARGS", "Time " + t + " is not inside layer " + ls[i].id + " (" + ls[i].inPoint + " to " + ls[i].outPoint + ")");
    }
    for (i = 0; i < ls.length; i++) { d = splitAt(ls[i], t); out.push({ first: layerInfo(ls[i]), second: layerInfo(d) }); }
    return { time: t, splits: out };
  };
  C.shift_layers = function (a) {
    need(a, ["layer_ids", "offset_seconds"]);
    var ls = pickLayers(a.layer_ids), out = [], i;
    assertUnlocked(ls);
    for (i = 0; i < ls.length; i++) shiftLayer(ls[i], a.offset_seconds);
    for (i = 0; i < ls.length; i++) out.push(layerInfo(ls[i]));
    return { layers: out };
  };
  C.sequence_layers = function (a) {
    need(a, ["layer_ids"]);
    var ls = pickLayers(a.layer_ids), ov = has(a, "overlap") ? a.overlap : 0, out = [], i, t;
    if (ls.length < 2) fail("BAD_ARGS", "Need at least two layers");
    if (ov < 0) fail("BAD_ARGS", "overlap must be 0 or more");
    sameComp(ls);
    assertUnlocked(ls);
    t = has(a, "start") ? a.start : ls[0].inPoint;
    for (i = 0; i < ls.length; i++) {
      shiftLayer(ls[i], t - ls[i].inPoint);
      t = ls[i].outPoint - ov;
      out.push(layerInfo(ls[i]));
    }
    return { layers: out };
  };
  C.delete_range = function (a) {
    need(a, ["comp_id", "start", "end"]);
    var comp = getComp(a.comp_id), s = snapT(comp, a.start), e = snapT(comp, a.end), ripple = a.ripple !== false, span = e - s,
      all = a.layer_ids ? pickLayers(a.layer_ids, comp) : layersOf(comp), targets = [],
      res = { range: [s, e], ripple: ripple, deleted: [], trimmed: [], split: [], shifted: [], skipped_locked: [] }, i, l, li, lo, d;
    if (!(e > s + EPS)) fail("BAD_ARGS", "end must be after start (times snap to whole frames)");
    for (i = 0; i < all.length; i++) { if (all[i].locked) res.skipped_locked.push(all[i].id); else targets.push(all[i]); }
    for (i = 0; i < targets.length; i++) {
      l = targets[i]; li = l.inPoint; lo = l.outPoint;
      if (lo <= s + EPS) continue;
      if (li >= e - EPS) { if (ripple) { shiftLayer(l, -span); res.shifted.push(l.id); } continue; }
      if (li >= s - EPS && lo <= e + EPS) { res.deleted.push(l.id); l.remove(); continue; }
      if (li < s - EPS && lo > e + EPS) {
        d = splitAt(l, s);
        d.inPoint = e;
        res.split.push({ first: l.id, second: d.id });
        if (ripple) { shiftLayer(d, -span); res.shifted.push(d.id); }
        continue;
      }
      if (li < s - EPS) { l.outPoint = s; res.trimmed.push(l.id); continue; }
      l.inPoint = e; res.trimmed.push(l.id);
      if (ripple) { shiftLayer(l, -span); res.shifted.push(l.id); }
    }
    if (ripple && a.shorten_comp) { comp.duration = Math.max(comp.frameDuration, comp.duration - span); res.comp_duration = comp.duration; }
    return res;
  };
  C.set_playhead = function (a) {
    need(a, ["comp_id", "time"]);
    var c = getComp(a.comp_id), t = a.snap === false ? a.time : snapT(c, a.time);
    if (t < 0 || t > c.duration + EPS) fail("BAD_ARGS", "time must be within the comp (0 to " + c.duration + " s)");
    c.time = t;
    return { time: c.time, frame: Math.round(c.time * c.frameRate) };
  };

  // ---------- masks and mattes ----------
  C.add_mask = function (a) {
    need(a, ["layer_id", "shape"]);
    var l = getLayer(a.layer_id), masks = l.property("ADBE Mask Parade"), s = a.shape, W, H, m, shp, mode, cx, cy;
    if (!masks) fail("BAD_ARGS", "Layer does not support masks");
    W = l.width || l.containingComp.width; H = l.height || l.containingComp.height;
    if (s.type === "rect" || s.type === "ellipse") {
      cx = s.position ? s.position[0] : W / 2; cy = s.position ? s.position[1] : H / 2;
      shp = boxShape(s.type, cx, cy, s.size ? s.size[0] : W, s.size ? s.size[1] : H);
    } else if (s.type === "polygon") {
      if (!(s.points instanceof Array) || s.points.length < 3) fail("BAD_ARGS", "polygon needs at least 3 points");
      shp = mkShape(s.points, null, null, s.closed);
    } else if (s.type === "path") {
      shp = mkShape(s.vertices, s.in_tangents, s.out_tangents, s.closed);
    } else { fail("BAD_ARGS", "shape.type must be rect, ellipse, polygon or path"); }
    if (has(a, "mode")) { mode = MASKMODES[a.mode]; if (!mode) fail("BAD_ARGS", "Unknown mask mode: " + a.mode); }
    m = masks.addProperty("ADBE Mask Atom");
    m.property("ADBE Mask Shape").setValue(shp);
    if (mode) m.maskMode = MaskMode[mode];
    if (has(a, "inverted")) m.inverted = a.inverted;
    if (has(a, "feather")) m.property("ADBE Mask Feather").setValue(a.feather instanceof Array ? a.feather : [a.feather, a.feather]);
    if (has(a, "opacity")) m.property("ADBE Mask Opacity").setValue(a.opacity);
    if (has(a, "expansion")) m.property("ADBE Mask Offset").setValue(a.expansion);
    if (a.name) m.name = a.name;
    return { mask_index: m.propertyIndex, name: m.name, path: ["ADBE Mask Parade", m.propertyIndex] };
  };
  C.set_track_matte = function (a) {
    need(a, ["layer_id"]);
    var l = getLayer(a.layer_id), comp = l.containingComp, mt = a.type || "alpha", tm = MATTES[mt], matte;
    if (!tm) fail("BAD_ARGS", "type must be alpha, alpha_inverted, luma or luma_inverted");
    if (!has(a, "matte_layer_id")) {
      l.trackMatteType = TrackMatteType.NO_TRACK_MATTE;
      return { layer: layerInfo(l), matte_layer_id: null };
    }
    matte = getLayer(a.matte_layer_id);
    if (matte.containingComp.id !== comp.id) fail("BAD_ARGS", "Matte layer is in a different comp");
    if (matte.id === l.id) fail("BAD_ARGS", "A layer cannot be its own matte");
    if (typeof l.setTrackMatte === "function") {
      l.setTrackMatte(matte, TrackMatteType[tm]);
    } else {
      if (l.index === 1 || comp.layer(l.index - 1).id !== matte.id) fail("UNSUPPORTED", "This After Effects version needs the matte layer directly above the target layer", "Use reorder_layer to place the matte directly above it, then retry");
      l.trackMatteType = TrackMatteType[tm];
    }
    return { layer: layerInfo(l), matte_layer_id: matte.id, type: mt };
  };

  // ---------- markers ----------
  C.add_marker = function (a) {
    need(a, ["time"]);
    var prop = markerProp(a), mv = new MarkerValue(has(a, "comment") ? a.comment : "");
    if (has(a, "duration")) mv.duration = a.duration;
    if (has(a, "chapter")) mv.chapter = a.chapter;
    if (has(a, "url")) mv.url = a.url;
    if (has(a, "label")) mv.label = a.label;
    prop.setValueAtTime(a.time, mv);
    return markerInfo(prop, prop.nearestKeyIndex(a.time));
  };
  C.list_markers = function (a) {
    var prop = markerProp(a), out = [], i;
    for (i = 1; i <= prop.numKeys && i <= 500; i++) out.push(markerInfo(prop, i));
    return { markers: out, total: prop.numKeys };
  };
  C.delete_marker = function (a) {
    var prop = markerProp(a), idx, info;
    if (has(a, "index")) idx = a.index;
    else if (has(a, "time")) idx = prop.numKeys ? prop.nearestKeyIndex(a.time) : 0;
    else fail("BAD_ARGS", "Pass index or time");
    if (!prop.numKeys || idx < 1 || idx > prop.numKeys) fail("NOT_FOUND", "No such marker", "Use list_markers");
    if (!has(a, "index") && Math.abs(prop.keyTime(idx) - a.time) > 0.05) fail("NOT_FOUND", "No marker within 0.05 s of " + a.time, "Use list_markers");
    info = markerInfo(prop, idx);
    prop.removeKey(idx);
    return { deleted: info };
  };

  // ---------- shapes, effects, keyframes ----------
  C.add_shape_modifier = function (a) {
    need(a, ["layer_id", "modifier"]);
    var l = getLayer(a.layer_id), mn = MODIFIERS[a.modifier], gi = has(a, "group_index") ? a.group_index : 1, root, g, m, key, p, errs = [], props = [], i;
    if (!mn) fail("BAD_ARGS", "modifier must be trim_paths, repeater or round_corners");
    if (!(l instanceof ShapeLayer)) fail("BAD_ARGS", "Layer is not a shape layer");
    root = l.property("ADBE Root Vectors Group");
    if (gi < 1 || gi > root.numProperties) fail("NOT_FOUND", "Shape group " + gi + " not found", "Add a shape with add_layer first");
    g = root.property(gi).property("ADBE Vectors Group");
    m = g.addProperty(mn);
    if (a.params) {
      for (key in a.params) {
        if (!a.params.hasOwnProperty(key)) continue;
        try {
          p = m.property(key);
          if (!p) throw new Error("no such property");
          p.setValue(coerce(p, a.params[key]));
        } catch (e) { errs.push(key + ": " + (e && e.message ? e.message : String(e))); }
      }
      if (errs.length) { m.remove(); fail("BAD_ARGS", "Modifier params failed: " + errs.join("; "), "Use list_properties on an existing modifier to see property names"); }
    }
    for (i = 1; i <= m.numProperties; i++) props.push({ name: m.property(i).name, match_name: m.property(i).matchName });
    return { path: ["ADBE Root Vectors Group", gi, "ADBE Vectors Group", m.propertyIndex], match_name: m.matchName, properties: props };
  };
  C.get_keyframes = function (a) {
    need(a, ["layer_id", "path"]);
    var l = getLayer(a.layer_id), p = resolvePath(l, a.path), out = [], i, k, n;
    if (p.propertyType !== PropertyType.PROPERTY) fail("BAD_ARGS", "path must point to a property, not a group", "Use list_properties");
    n = p.numKeys;
    for (i = 1; i <= n && i <= 500; i++) {
      k = { index: i, t: p.keyTime(i), v: keyVal(p, i), interp_in: interpName(p.keyInInterpolationType(i)), interp_out: interpName(p.keyOutInterpolationType(i)) };
      try { k.ease_in = easeList(p.keyInTemporalEase(i)); k.ease_out = easeList(p.keyOutTemporalEase(i)); } catch (e) {}
      out.push(k);
    }
    return { num_keys: n, keys: out, expression: (p.canSetExpression && p.expressionEnabled) ? p.expression : null };
  };
  C.edit_effect = function (a) {
    need(a, ["layer_id", "effect_index", "action"]);
    var l = getLayer(a.layer_id), fx = l.property("ADBE Effect Parade"), e, info;
    if (!fx || a.effect_index < 1 || a.effect_index > fx.numProperties) fail("NOT_FOUND", "No effect at index " + a.effect_index, "Use get_layer to list effects");
    e = fx.property(a.effect_index);
    info = { index: a.effect_index, name: e.name, match_name: e.matchName };
    if (a.action === "remove") e.remove();
    else if (a.action === "enable") e.enabled = true;
    else if (a.action === "disable") e.enabled = false;
    else fail("BAD_ARGS", "action must be remove, enable or disable");
    return { effect: info, action: a.action, remaining: fx.numProperties };
  };

  C.run_jsx = function (a) {
    need(a, ["code"]);
    var r = eval(a.code);
    if (r === undefined) r = null;
    if (typeof r === "object" && r !== null && !(r instanceof Array) && r.constructor !== Object) r = String(r);
    return { result: r };
  };

  function dispatch(s) {
    var out, msg, fn, ro;
    try {
      msg = JSON.parse(s);
      fn = C[msg.cmd];
      if (!fn) fail("BAD_ARGS", "Unknown command: " + msg.cmd);
      ro = READONLY[msg.cmd] === 1;
      if (!ro) app.beginUndoGroup("MCP: " + msg.cmd);
      try { out = { ok: true, result: fn(msg.args || {}) }; } finally { if (!ro) app.endUndoGroup(); }
    } catch (e) {
      if (e && e.aem) out = { ok: false, error: { code: e.code, message: e.message, hint: e.hint } };
      else out = { ok: false, error: { code: "AE_ERROR", message: String(e && e.message ? e.message : e), hint: "ExtendScript line " + (e && e.line ? e.line : "?") } };
    }
    return JSON.stringify(out);
  }

  return { dispatch: dispatch };
})();
