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
    o.masks = safe(function () {
      var ms = l.property("ADBE Mask Parade"), out = [], k, m;
      if (!ms) return out;
      for (k = 1; k <= ms.numProperties; k++) { m = ms.property(k); out.push({ index: k, name: m.name, mode: maskModeName(m.maskMode), inverted: m.inverted, locked: m.locked }); }
      return out;
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
    } else if (kind === "text") { l = o.box_size ? comp.layers.addBoxText([o.box_size[0], o.box_size[1]], has(o, "text") ? o.text : "Text") : comp.layers.addText(has(o, "text") ? o.text : "Text");
    } else if (kind === "shape") { l = comp.layers.addShape(); l.name = "Shape Layer"; if (o.shape) addShapeContent(l, o.shape);
    } else if (kind === "null") { l = comp.layers.addNull(dur);
    } else if (kind === "footage" || kind === "precomp") { l = comp.layers.add(item);
    } else if (kind === "camera") { l = comp.layers.addCamera(o.name || "Camera 1", o.center || [comp.width / 2, comp.height / 2]); centerLayer(l, o.center || [comp.width / 2, comp.height / 2]);
    } else if (kind === "light") {
      l = comp.layers.addLight(o.name || "Light 1", o.center ? [o.center[0], o.center[1]] : [comp.width / 2, comp.height / 2]);
      centerLayer(l, o.center ? o.center : [comp.width / 2, comp.height / 2]);
      if (o.light_type) {
        lt = LightType[String(o.light_type).toUpperCase()];
        if (lt === undefined) fail("BAD_ARGS", "light_type must be point, spot, parallel or ambient");
        l.lightType = lt;
      }
    } else { fail("BAD_ARGS", "Unknown layer kind: " + kind); }
    if (o.name) l.name = o.name;
    if (has(o, "three_d")) l.threeDLayer = o.three_d;
    if (has(o, "position")) setLayerPosition(l, o.position);
    if (has(o, "start")) l.startTime = o.start;
    if (has(o, "in")) setIn(l, o["in"]);
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
    if (has(a, "in")) setIn(l, a["in"]);
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
  C.add_property = function (a) {
    need(a, ["layer_id", "match_name"]);
    var l = getLayer(a.layer_id), g = has(a, "group_path") && a.group_path.length ? resolvePath(l, a.group_path) : l, np, i, path;
    if (!g.canAddProperty(a.match_name)) fail("BAD_ARGS", "Cannot add '" + a.match_name + "' there", "Check the group_path and match name with list_properties (text animators: group ADBE Text Animators, match ADBE Text Animator; selectors ADBE Text Selectors / ADBE Text Selector; animator properties such as ADBE Text Position 3D, ADBE Text Opacity)");
    np = g.addProperty(a.match_name);
    path = (has(a, "group_path") && a.group_path.length ? (typeof a.group_path === "string" ? [a.group_path] : a.group_path.slice(0)) : []);
    path.push(g.propertyType === PropertyType.INDEXED_GROUP ? np.propertyIndex : np.matchName);
    return { name: np.name, match_name: np.matchName, path: path };
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
    if (p.matchName === "ADBE Time Remapping") {
      // removing every key switches time remapping off, so add the new keys first and drop the old ones afterwards
      var oldT = [], j, ix, same;
      for (i = 1; i <= p.numKeys; i++) oldT.push(p.keyTime(i));
      for (i = 0; i < a.keys.length; i++) p.setValueAtTime(a.keys[i].t, vals[i]);
      for (j = 0; j < oldT.length; j++) {
        same = false;
        for (i = 0; i < a.keys.length; i++) if (Math.abs(a.keys[i].t - oldT[j]) < 0.0001) same = true;
        if (same) continue;
        ix = p.nearestKeyIndex(oldT[j]);
        if (Math.abs(p.keyTime(ix) - oldT[j]) < 0.0001) p.removeKey(ix);
      }
    } else {
      for (i = p.numKeys; i >= 1; i--) p.removeKey(i);
      for (i = 0; i < a.keys.length; i++) p.setValueAtTime(a.keys[i].t, vals[i]);
    }
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
  var TEXT_NUM = {
    size: "fontSize", tracking: "tracking", leading: "leading", baseline_shift: "baselineShift",
    stroke_width: "strokeWidth",
    first_line_indent: "firstLineIndent", left_indent: "leftIndent", right_indent: "rightIndent",
    space_before: "spaceBefore", space_after: "spaceAfter", tsume: "tsume"
  };
  var TEXT_BOOL = {
    faux_bold: "fauxBold", faux_italic: "fauxItalic", ligatures: "ligature", auto_leading: "autoLeading",
    stroke: "applyStroke", fill: "applyFill", stroke_over_fill: "strokeOverFill"
  };
  var TEXT_JUST = {
    left: "LEFT_JUSTIFY", center: "CENTER_JUSTIFY", right: "RIGHT_JUSTIFY", justify: "FULL_JUSTIFY_LASTLINE_LEFT",
    justify_center: "FULL_JUSTIFY_LASTLINE_CENTER", justify_right: "FULL_JUSTIFY_LASTLINE_RIGHT", justify_all: "FULL_JUSTIFY_LASTLINE_FULL"
  };
  function baseEnum(n) {
    var E = FontBaselineOption, k, list = [];
    if (typeof E[n] !== "undefined") return E[n];
    if (typeof E["FONT_" + n] !== "undefined") return E["FONT_" + n];
    for (k in E) { list.push(k); if (String(k).toUpperCase().indexOf(n) !== -1 && typeof E[k] === "number") return E[k]; }
    throw new Error("FontBaselineOption has no " + n + " (found: " + list.join(", ") + ")");
  }
  function baselineOf(doc) {
    if (typeof doc.fontBaselineOption !== "undefined") return doc.fontBaselineOption;
    if (typeof doc.baselineOption !== "undefined") return doc.baselineOption;
    return undefined;
  }
  function readText(doc) {
    var o = {}, k;
    o.text = doc.text; o.font = doc.font; o.size = doc.fontSize;
    o.color = safe(function () { return doc.fillColor; });
    o.stroke_color = safe(function () { return doc.strokeColor; });
    o.justification = null;
    for (k in TEXT_JUST) { if (TEXT_JUST.hasOwnProperty(k) && safe(function () { return doc.justification === ParagraphJustification[TEXT_JUST[k]]; })) { o.justification = k; break; } }
    for (k in TEXT_NUM) { if (TEXT_NUM.hasOwnProperty(k)) o[k] = safe(function () { return doc[TEXT_NUM[k]]; }); }
    for (k in TEXT_BOOL) { if (TEXT_BOOL.hasOwnProperty(k)) o[k] = safe(function () { return doc[TEXT_BOOL[k]]; }); }
    o.horizontal_scale = safe(function () { return Math.round(doc.horizontalScale * 10000) / 100; });
    o.vertical_scale = safe(function () { return Math.round(doc.verticalScale * 10000) / 100; });
    o.all_caps = safe(function () { return doc.fontCapsOption === FontCapsOption.FONT_ALL_CAPS; });
    o.small_caps = safe(function () { return doc.fontCapsOption === FontCapsOption.FONT_SMALL_CAPS; });
    o.superscript = safe(function () { var v = baselineOf(doc); return v === undefined ? null : v === baseEnum("SUPERSCRIPT"); });
    o.subscript = safe(function () { var v = baselineOf(doc); return v === undefined ? null : v === baseEnum("SUBSCRIPT"); });
    o.box_size = safe(function () { return doc.boxText ? doc.boxTextSize : null; });
    return o;
  }
  function textProp(a) {
    var l = getLayer(a.layer_id);
    if (!(l instanceof TextLayer)) fail("BAD_ARGS", "Layer is not a text layer");
    return l.property("ADBE Text Properties").property("ADBE Text Document");
  }
  C.get_text = function (a) {
    need(a, ["layer_id"]);
    var prop = textProp(a);
    return readText(has(a, "time") ? prop.valueAtTime(a.time, false) : prop.value);
  };
  C.set_text = function (a) {
    need(a, ["layer_id"]);
    var prop = textProp(a), doc, k, skipped = {}, hasKeys = prop.numKeys > 0, rb;
    doc = has(a, "time") ? prop.valueAtTime(a.time, false) : prop.value;
    if (has(a, "text")) doc.text = a.text;
    if (a.font) doc.font = a.font;
    if (a.color) { doc.fillColor = [a.color[0], a.color[1], a.color[2]]; doc.applyFill = true; }
    if (a.stroke_color) { doc.strokeColor = [a.stroke_color[0], a.stroke_color[1], a.stroke_color[2]]; doc.applyStroke = true; }
    if (has(a, "stroke_width") && !has(a, "stroke")) doc.applyStroke = true;
    for (k in TEXT_NUM) {
      if (TEXT_NUM.hasOwnProperty(k) && has(a, k)) {
        try { doc[TEXT_NUM[k]] = a[k]; } catch (e1) { skipped[k] = String(e1.message || e1); }
      }
    }
    if (has(a, "leading") && !has(a, "auto_leading")) { try { doc.autoLeading = false; } catch (e2) {} try { doc.leading = a.leading; } catch (e3) { skipped.leading = String(e3.message || e3); } }
    for (k in TEXT_BOOL) {
      if (TEXT_BOOL.hasOwnProperty(k) && has(a, k)) {
        try { doc[TEXT_BOOL[k]] = a[k]; } catch (e4) { skipped[k] = String(e4.message || e4); }
      }
    }
    if (has(a, "horizontal_scale")) { try { doc.horizontalScale = a.horizontal_scale / 100; } catch (e7) { skipped.horizontal_scale = String(e7.message || e7); } }
    if (has(a, "vertical_scale")) { try { doc.verticalScale = a.vertical_scale / 100; } catch (e8) { skipped.vertical_scale = String(e8.message || e8); } }
    if (has(a, "all_caps") || has(a, "small_caps")) {
      try { doc.fontCapsOption = (a.all_caps === true) ? FontCapsOption.FONT_ALL_CAPS : ((a.small_caps === true) ? FontCapsOption.FONT_SMALL_CAPS : FontCapsOption.FONT_NORMAL_CAPS); } catch (e9) { skipped.caps = String(e9.message || e9); }
    }
    if (has(a, "superscript") || has(a, "subscript")) {
      try { doc.fontBaselineOption = (a.superscript === true) ? baseEnum("SUPERSCRIPT") : ((a.subscript === true) ? baseEnum("SUBSCRIPT") : baseEnum("NORMAL_BASELINE")); } catch (e10) { skipped.baseline = String(e10.message || e10); }
    }
    if (a.justification) {
      if (!TEXT_JUST.hasOwnProperty(a.justification)) fail("BAD_ARGS", "justification must be left, center, right, justify, justify_center, justify_right or justify_all");
      try { doc.justification = ParagraphJustification[TEXT_JUST[a.justification]]; } catch (e5) { skipped.justification = String(e5.message || e5); }
    }
    if (a.box_size) { try { if (!doc.boxText) throw new Error("This is point text; After Effects can only make box text when the layer is created (add_layer with options.box_size)"); doc.boxTextSize = [a.box_size[0], a.box_size[1]]; } catch (e6) { skipped.box_size = String(e6.message || e6); } }
    if (has(a, "time")) prop.setValueAtTime(a.time, doc); else if (hasKeys) fail("BAD_ARGS", "Source text is animated; pass time to set the text at a time");
    else prop.setValue(doc);
    rb = readText(has(a, "time") ? prop.valueAtTime(a.time, false) : prop.value);
    rb.skipped = skipped;
    return rb;
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
      total_frames: Math.round(comp.duration * comp.frameRate), fps: comp.frameRate, aerender_dir: appDir()
    };
  };
  // ---------- helpers: editing, timeline, shapes ----------
  var EPS = 1e-6;
  var MASKMODES = { none: "NONE", add: "ADD", subtract: "SUBTRACT", intersect: "INTERSECT", lighten: "LIGHTEN", darken: "DARKEN", difference: "DIFFERENCE" };
  var MATTES = { alpha: "ALPHA", alpha_inverted: "ALPHA_INVERTED", luma: "LUMA", luma_inverted: "LUMA_INVERTED" };
  var MODIFIERS = { trim_paths: "ADBE Vector Filter - Trim", repeater: "ADBE Vector Filter - Repeater", round_corners: "ADBE Vector Filter - RC" };

  // app.path is a Folder object in After Effects; new Folder(app.path) does not give the install folder.
  function appDir() {
    var p = app.path;
    if (p && typeof p === "object" && p.fsName) return p.fsName;
    return new Folder(String(p)).fsName;
  }
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
      l.inPoint = i0 + dt; l.outPoint = o0 + dt;
    }
  }
  // In After Effects, setting inPoint can move outPoint too (the layer keeps its length), so put outPoint back.
  function setIn(l, t) {
    var o = l.outPoint;
    l.inPoint = t;
    if (Math.abs(l.outPoint - o) > 1e-6) l.outPoint = o;
  }
  function maskModeName(mode) { var k; for (k in MASKMODES) { if (MASKMODES.hasOwnProperty(k) && MaskMode[MASKMODES[k]] === mode) return k; } return "unknown"; }
  function matteTypeName(t) { var k; for (k in MATTES) { if (MATTES.hasOwnProperty(k) && TrackMatteType[MATTES[k]] === t) return k; } return "none"; }
  function splitAt(l, t) {
    var d = l.duplicate();
    l.outPoint = t;
    setIn(d, t);
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
        setIn(d, e);
        res.split.push({ first: l.id, second: d.id });
        if (ripple) { shiftLayer(d, -span); res.shifted.push(d.id); }
        continue;
      }
      if (li < s - EPS) { l.outPoint = s; res.trimmed.push(l.id); continue; }
      setIn(l, e); res.trimmed.push(l.id);
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
    if (has(a, "feather_xy")) m.property("ADBE Mask Feather").setValue(a.feather_xy);
    else if (has(a, "feather")) m.property("ADBE Mask Feather").setValue([a.feather, a.feather]);
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

  // ---------- 3D cameras, lights and 3D layers ----------
  var RIGMARK = "// ae-motion rig";
  var SHAKEMARK = "// ae-motion shake";
  var LOOKMARK = "// ae-motion look-at";
  var EASE_NAMES = { linear: 1, ease_in: 1, ease_out: 1, ease_in_out: 1 };
  var FALLOFFS = { none: 1, smooth: 2, inverse_square_clamped: 3 };
  var LIGHTTYPES = { point: "POINT", spot: "SPOT", parallel: "PARALLEL", ambient: "AMBIENT" };
  var CASTS = { off: 0, on: 1, only: 2 };
  var MATERIAL = {
    light_transmission: "ADBE Light Transmission", ambient: "ADBE Ambient Coefficient", diffuse: "ADBE Diffuse Coefficient",
    specular_intensity: "ADBE Specular Coefficient", specular_shininess: "ADBE Shininess Coefficient", metal: "ADBE Metal Coefficient",
    reflection_intensity: "ADBE Reflection Coefficient", reflection_sharpness: "ADBE Glossiness Coefficient", reflection_rolloff: "ADBE Fresnel Coefficient",
    transparency: "ADBE Transparency Coefficient", transparency_rolloff: "ADBE Transp Rolloff", index_of_refraction: "ADBE Index of Refraction"
  };
  var IRIS = {
    iris_shape: "ADBE Iris Shape", iris_rotation: "ADBE Iris Rotation", iris_roundness: "ADBE Iris Roundness", iris_aspect_ratio: "ADBE Iris Aspect Ratio",
    iris_diffraction_fringe: "ADBE Iris Diffraction Fringe", highlight_gain: "ADBE Iris Highlight Gain", highlight_threshold: "ADBE Iris Highlight Threshold",
    highlight_saturation: "ADBE Iris Hightlight Saturation"
  };

  // vectors: After Effects has x to the right, y DOWN and z into the screen; a camera in front of the comp has negative z.
  function v3(a) { return [a[0], a[1], a.length > 2 ? a[2] : 0]; }
  function vadd(a, b) { return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]; }
  function vsub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
  function vmul(a, k) { return [a[0] * k, a[1] * k, a[2] * k]; }
  function vdot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
  function vlen(a) { return Math.sqrt(vdot(a, a)); }
  function vnorm(a) {
    var n = vlen(a);
    if (n < 1e-9) fail("BAD_ARGS", "The camera and its point of interest are at the same position");
    return vmul(a, 1 / n);
  }
  function rad(d) { return d * Math.PI / 180; }
  // yaw turns the +z direction toward +x (a camera at -z swings to the right; a view direction turns right with yaw(w, -deg))
  function yaw(v, deg) { var a = rad(deg), c = Math.cos(a), s = Math.sin(a); return [v[0] * c - v[2] * s, v[1], v[0] * s + v[2] * c]; }
  // elevate raises a vector toward the top of the screen (y decreases) while keeping its length
  function elevate(v, deg) {
    var r = vlen(v), rho = Math.sqrt(v[0] * v[0] + v[2] * v[2]), phi = Math.atan2(-v[1], rho), phi2 = phi + rad(deg), rho2, k;
    phi2 = Math.max(-1.5533, Math.min(1.5533, phi2));
    rho2 = r * Math.cos(phi2);
    k = rho > 1e-9 ? rho2 / rho : 0;
    return [v[0] * k, -r * Math.sin(phi2), v[2] * k];
  }
  function rightOf(f) {
    var h = Math.sqrt(f[0] * f[0] + f[2] * f[2]);
    if (h < 1e-9) fail("BAD_ARGS", "The camera looks straight up or down, so truck is undefined");
    return [f[2] / h, 0, -f[0] / h];
  }
  function easeU(name, u) {
    if (name === "ease_in") return u * u;
    if (name === "ease_out") return 1 - (1 - u) * (1 - u);
    if (name === "ease_in_out") return u * u * (3 - 2 * u);
    return u;
  }
  function sampleCount(deg, step) { var n = Math.ceil(Math.abs(deg) / (step || 5)); return Math.max(2, Math.min(180, n)); }

  // New cameras and lights should sit over the comp center; set x and y explicitly instead of trusting addCamera/addLight.
  function centerLayer(l, c) {
    var p = l.property("ADBE Transform Group").property("ADBE Position"), v = p.value;
    if (Math.abs(v[0] - c[0]) > 1e-6 || Math.abs(v[1] - c[1]) > 1e-6) p.setValue([c[0], c[1], v[2]]);
  }
  function camLayer(id) {
    var l = getLayer(id);
    if (!(l instanceof CameraLayer)) fail("BAD_ARGS", "Layer " + id + " is not a camera", "Add one with add_layer kind camera");
    return l;
  }
  function tp(l, match) { return l.property("ADBE Transform Group").property(match); }
  function camOpt(l, match) { return l.property("ADBE Camera Options Group").property(match); }
  function isTwoNode(l) { return l.autoOrient === AutoOrientType.CAMERA_OR_POINT_OF_INTEREST; }
  function needTwoNode(l) { if (!isTwoNode(l)) fail("BAD_ARGS", "This camera is one-node (it has no point of interest)", "Call set_camera with two_node: true first"); }
  function cleanName(n) { if (String(n).indexOf('"') !== -1) fail("BAD_ARGS", "Layer names used by rigs and look-at cannot contain double quotes"); return n; }

  // Where to put keyframes for a camera's position or point of interest: the property itself, or the rig control that drives it.
  function keyTarget(l, match, label) {
    var p = tp(l, match), m, ctrl = null;
    if (p.expressionEnabled) {
      if (p.expression.indexOf(RIGMARK) === 0) {
        m = /thisComp\.layer\("([^"]+)"\)/.exec(p.expression);
        if (m) { try { ctrl = l.containingComp.layer(m[1]); } catch (e) { ctrl = null; } }
        if (!ctrl) fail("NOT_FOUND", "The rig control layer for " + label + " is missing", "Use camera_rig remove, then create the rig again");
        return ctrl.property("ADBE Transform Group").property("ADBE Position");
      }
      if (p.expression.indexOf(SHAKEMARK) !== 0) fail("BAD_ARGS", label + " is driven by an expression", "Clear it with set_expression and an empty expression");
    }
    return p;
  }
  function stateAt(l, t) {
    return {
      P: v3(copyArr(keyTarget(l, "ADBE Position", "Position").valueAtTime(t, true))),
      T: v3(copyArr(keyTarget(l, "ADBE Anchor Point", "Point of Interest").valueAtTime(t, true)))
    };
  }
  function setAt(p, v, t) {
    if (t !== null && t !== undefined) {
      if (!p.canVaryOverTime) fail("BAD_ARGS", "Property is not keyframable");
      p.setValueAtTime(t, v);
    } else {
      if (p.numKeys > 0) fail("BAD_ARGS", "Property is animated; pass time to set a keyframe", "Use camera_move or set_keyframes to change animation");
      p.setValue(v);
    }
  }
  function clearKeysBetween(p, t0, t1) {
    var i;
    for (i = p.numKeys; i >= 1; i--) if (p.keyTime(i) >= t0 - EPS && p.keyTime(i) <= t1 + EPS) p.removeKey(i);
  }
  // Insert keys (replacing any existing keys inside their time range). Sampled keys use linear timing because the easing is already in the values.
  function putKeys(p, keys, easing, sampled) {
    var i, idx, n = keys.length, lin = KeyframeInterpolationType.LINEAR;
    clearKeysBetween(p, keys[0].t, keys[n - 1].t);
    for (i = 0; i < n; i++) p.setValueAtTime(keys[i].t, keys[i].v);
    for (i = 0; i < n; i++) {
      idx = p.nearestKeyIndex(keys[i].t);
      if (sampled || easing === "linear") {
        p.setInterpolationTypeAtKey(idx, lin, lin);
      } else if (n >= 2) {
        if (i === 0 && (easing === "ease_in" || easing === "ease_in_out")) applyKeyMeta(p, idx, { ease_out: "easy" });
        if (i === n - 1 && (easing === "ease_out" || easing === "ease_in_out")) applyKeyMeta(p, idx, { ease_in: "easy" });
      }
    }
    return n;
  }
  function copyAnimation(src, dst) {
    var i, n = src.numKeys;
    if (n === 0) { dst.setValue(src.value); return; }
    for (i = 1; i <= n; i++) dst.setValueAtTime(src.keyTime(i), src.keyValue(i));
    for (i = 1; i <= n; i++) {
      try { dst.setInterpolationTypeAtKey(i, src.keyInInterpolationType(i), src.keyOutInterpolationType(i)); } catch (e1) {}
      try { dst.setTemporalEaseAtKey(i, src.keyInTemporalEase(i), src.keyOutTemporalEase(i)); } catch (e2) {}
    }
  }
  function driveOf(p) {
    if (p.expressionEnabled) {
      if (p.expression.indexOf(RIGMARK) === 0) return "rig";
      if (p.expression.indexOf(SHAKEMARK) === 0) return "shake";
      if (p.expression.indexOf(LOOKMARK) === 0) return "look-at";
      return "expression";
    }
    return p.numKeys > 0 ? "keyframes" : "static";
  }
  function xformProp(l, match) {
    if (l instanceof CameraLayer && (match === "ADBE Position" || match === "ADBE Anchor Point")) return keyTarget(l, match, match === "ADBE Position" ? "Position" : "Point of Interest");
    return tp(l, match);
  }
  function vN(a, dims) { var v = v3(a); return dims === 2 ? [v[0], v[1]] : v; }
  function scaleN(a, dims) { return dims === 2 ? [a[0], a[1]] : [a[0], a[1], a.length > 2 ? a[2] : 100]; }
  function applyXform(l, a, t) {
    var r = a.rotation, dims = (l instanceof CameraLayer || l instanceof LightLayer || l.threeDLayer) ? 3 : 2;
    if (has(a, "position")) setAt(xformProp(l, "ADBE Position"), vN(a.position, dims), t);
    if (has(a, "point_of_interest")) setAt(xformProp(l, "ADBE Anchor Point"), vN(a.point_of_interest, dims), t);
    else if (has(a, "anchor")) setAt(xformProp(l, "ADBE Anchor Point"), vN(a.anchor, dims), t);
    if (has(a, "scale")) setAt(xformProp(l, "ADBE Scale"), scaleN(a.scale, dims), t);
    if (has(a, "orientation")) setAt(xformProp(l, "ADBE Orientation"), v3(a.orientation), t);
    if (r) {
      if (has(r, "x")) setAt(xformProp(l, "ADBE Rotate X"), r.x, t);
      if (has(r, "y")) setAt(xformProp(l, "ADBE Rotate Y"), r.y, t);
      if (has(r, "z")) setAt(xformProp(l, "ADBE Rotate Z"), r.z, t);
    }
  }
  function xformInfo(l, t) {
    var o = {};
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
  function axisDistance(l, other, t) {
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
  function camInfo(l, t) {
    var comp = l.containingComp, W = comp.width, H = comp.height, z = camOpt(l, "ADBE Camera Zoom").valueAtTime(t, false), o = {}, k, iris = {};
    o.layer = layerInfo(l);
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

  C.get_camera = function (a) {
    need(a, ["layer_id"]);
    return camInfo(camLayer(a.layer_id), has(a, "time") ? a.time : 0);
  };

  C.set_camera = function (a) {
    need(a, ["layer_id"]);
    var l = camLayer(a.layer_id), W = l.containingComp.width, t = has(a, "time") ? a.time : null, nlens = 0, z, k, other, p;
    if (has(a, "zoom")) nlens++;
    if (has(a, "focal_length")) nlens++;
    if (has(a, "fov")) nlens++;
    if (nlens > 1) fail("BAD_ARGS", "Pass only one of zoom, focal_length and fov");
    if (has(a, "focus_distance") && has(a, "focus_on_layer_id")) fail("BAD_ARGS", "Pass only one of focus_distance and focus_on_layer_id");
    if (has(a, "name")) l.name = a.name;
    if (has(a, "two_node")) l.autoOrient = a.two_node ? AutoOrientType.CAMERA_OR_POINT_OF_INTEREST : AutoOrientType.NO_AUTO_ORIENT;
    if (has(a, "zoom")) z = a.zoom;
    else if (has(a, "focal_length")) z = a.focal_length * W / 36;
    else if (has(a, "fov")) { if (!(a.fov > 0 && a.fov < 180)) fail("BAD_ARGS", "fov must be between 0 and 180 degrees"); z = W / (2 * Math.tan(rad(a.fov) / 2)); }
    if (z !== undefined) { if (!(z > 0)) fail("BAD_ARGS", "The lens must be greater than 0"); setAt(camOpt(l, "ADBE Camera Zoom"), z, t); }
    if (has(a, "depth_of_field")) setAt(camOpt(l, "ADBE Camera Depth of Field"), a.depth_of_field ? 1 : 0, t);
    if (has(a, "focus_distance")) setAt(camOpt(l, "ADBE Camera Focus Distance"), a.focus_distance, t);
    else if (has(a, "focus_on_layer_id")) {
      other = getLayer(a.focus_on_layer_id);
      if (other.containingComp.id !== l.containingComp.id) fail("BAD_ARGS", "That layer is in a different comp");
      setAt(camOpt(l, "ADBE Camera Focus Distance"), axisDistance(l, other, t === null ? 0 : t), t);
    }
    if (has(a, "aperture")) setAt(camOpt(l, "ADBE Camera Aperture"), a.aperture, t);
    if (has(a, "blur_level")) setAt(camOpt(l, "ADBE Camera Blur Level"), a.blur_level, t);
    for (k in IRIS) { if (IRIS.hasOwnProperty(k) && has(a, k)) setAt(camOpt(l, IRIS[k]), a[k], t); }
    applyXform(l, a, t);
    if (has(a, "look_at_layer_id")) {
      needTwoNode(l);
      other = getLayer(a.look_at_layer_id);
      if (other.containingComp.id !== l.containingComp.id) fail("BAD_ARGS", "That layer is in a different comp");
      p = tp(l, "ADBE Anchor Point");
      if (a.follow) {
        if (p.expressionEnabled) fail("BAD_ARGS", "Point of interest is already driven by an expression", "Clear it with set_expression and an empty expression");
        p.expression = LOOKMARK + '\nthisComp.layer("' + cleanName(other.name) + '").transform.position';
        if (p.expressionError) { p.expression = ""; fail("AE_ERROR", "Look-at expression failed: " + p.expressionError); }
      } else {
        setAt(xformProp(l, "ADBE Anchor Point"), v3(copyArr(tp(other, "ADBE Position").valueAtTime(t === null ? 0 : t, false))), t);
      }
    }
    return camInfo(l, t === null ? 0 : t);
  };

  C.camera_move = function (a) {
    need(a, ["layer_id", "type"]);
    var l = camLayer(a.layer_id), comp = l.containingComp, type = a.type, easing = a.easing || "ease_in_out", t0 = has(a, "start") ? a.start : 0, dur = a.duration, t1,
      st, f, d, delta, n, i, u, e, w, v, target, deg, vdeg, p, z0, z1, other, wp, nPos = 0,
      planPos = null, planPoi = null, planRoll = null, planZoom = null, planFocus = null, posSampled = false, poiSampled = false, res = { type: type, keyframes: {} };
    if (!EASE_NAMES[easing]) fail("BAD_ARGS", "easing must be linear, ease_in, ease_out or ease_in_out");
    if (t0 < 0) fail("BAD_ARGS", "start must be 0 or more");
    if (type !== "path") {
      if (!(dur > 0)) fail("BAD_ARGS", "duration must be greater than 0");
      t1 = t0 + dur;
    }

    if (type === "dolly") {
      needTwoNode(l); st = stateAt(l, t0); f = vsub(st.T, st.P); d = vlen(f);
      if (has(a, "factor")) { if (!(a.factor > 0)) fail("BAD_ARGS", "factor must be greater than 0"); z1 = d * a.factor; }
      else if (has(a, "distance")) z1 = d - a.distance;
      else fail("BAD_ARGS", "dolly needs distance (px toward the point of interest) or factor (new distance as a multiple of the current one)");
      if (z1 < 1) fail("BAD_ARGS", "The dolly would reach the point of interest (it is " + Math.round(d) + " px away)");
      planPos = [{ t: t0, v: st.P }, { t: t1, v: vsub(st.T, vmul(vnorm(f), z1)) }];
    } else if (type === "truck" || type === "pedestal") {
      need(a, ["distance"]); needTwoNode(l); st = stateAt(l, t0);
      delta = type === "truck" ? vmul(rightOf(vnorm(vsub(st.T, st.P))), a.distance) : [0, -a.distance, 0];
      planPos = [{ t: t0, v: st.P }, { t: t1, v: vadd(st.P, delta) }];
      planPoi = [{ t: t0, v: st.T }, { t: t1, v: vadd(st.T, delta) }];
    } else if (type === "crane") {
      need(a, ["distance"]); needTwoNode(l); st = stateAt(l, t0);
      planPos = [{ t: t0, v: st.P }, { t: t1, v: vadd(st.P, [0, -a.distance, 0]) }];
    } else if (type === "pan" || type === "tilt") {
      need(a, ["degrees"]); needTwoNode(l); st = stateAt(l, t0); w = vsub(st.T, st.P);
      n = sampleCount(a.degrees, a.step_degrees); planPoi = []; poiSampled = true;
      for (i = 0; i <= n; i++) {
        u = i / n; e = easeU(easing, u);
        v = type === "pan" ? yaw(w, -a.degrees * e) : elevate(w, a.degrees * e);
        planPoi.push({ t: t0 + dur * u, v: vadd(st.P, v) });
      }
    } else if (type === "roll") {
      need(a, ["degrees"]); p = tp(l, "ADBE Rotate Z"); z0 = p.valueAtTime(t0, true);
      planRoll = [{ t: t0, v: z0 }, { t: t1, v: z0 + a.degrees }];
    } else if (type === "orbit") {
      needTwoNode(l); st = stateAt(l, t0);
      deg = has(a, "degrees") ? a.degrees : 0; vdeg = has(a, "vertical_degrees") ? a.vertical_degrees : 0;
      if (deg === 0 && vdeg === 0) fail("BAD_ARGS", "orbit needs degrees (left/right) or vertical_degrees (up/down)");
      target = has(a, "target") ? v3(a.target) : st.T; v = vsub(st.P, target);
      if (vlen(v) < 1) fail("BAD_ARGS", "The camera is at the orbit target");
      n = sampleCount(Math.max(Math.abs(deg), Math.abs(vdeg)), a.step_degrees); planPos = []; posSampled = true;
      for (i = 0; i <= n; i++) {
        u = i / n; e = easeU(easing, u);
        planPos.push({ t: t0 + dur * u, v: vadd(target, elevate(yaw(v, deg * e), vdeg * e)) });
      }
      if (has(a, "target") && vlen(vsub(target, st.T)) > 1e-6) planPoi = [{ t: t0, v: st.T }, { t: t1, v: target }];
    } else if (type === "zoom") {
      p = camOpt(l, "ADBE Camera Zoom"); z0 = p.valueAtTime(t0, true);
      if (has(a, "to_zoom")) z1 = a.to_zoom;
      else if (has(a, "factor")) z1 = z0 * a.factor;
      else if (has(a, "to_focal_length")) z1 = a.to_focal_length * comp.width / 36;
      else if (has(a, "to_fov")) { if (!(a.to_fov > 0 && a.to_fov < 180)) fail("BAD_ARGS", "to_fov must be between 0 and 180 degrees"); z1 = comp.width / (2 * Math.tan(rad(a.to_fov) / 2)); }
      else fail("BAD_ARGS", "zoom needs to_zoom, factor, to_focal_length or to_fov");
      if (!(z1 > 0)) fail("BAD_ARGS", "The target lens must be greater than 0");
      planZoom = [{ t: t0, v: z0 }, { t: t1, v: z1 }];
    } else if (type === "rack_focus") {
      p = camOpt(l, "ADBE Camera Focus Distance"); z0 = p.valueAtTime(t0, true);
      if (has(a, "to_focus_distance")) z1 = a.to_focus_distance;
      else if (has(a, "to_layer_id")) {
        other = getLayer(a.to_layer_id);
        if (other.containingComp.id !== comp.id) fail("BAD_ARGS", "That layer is in a different comp");
        z1 = axisDistance(l, other, t1);
      } else fail("BAD_ARGS", "rack_focus needs to_focus_distance or to_layer_id");
      planFocus = [{ t: t0, v: z0 }, { t: t1, v: z1 }];
      p = camOpt(l, "ADBE Camera Depth of Field");
      if (a.enable_dof !== false && p.numKeys === 0 && !p.value) { p.setValue(1); res.depth_of_field_enabled = true; }
    } else if (type === "path") {
      wp = a.waypoints;
      if (!(wp instanceof Array) || wp.length < 2) fail("BAD_ARGS", "path needs at least 2 waypoints");
      planPos = []; planPoi = [];
      for (i = 0; i < wp.length; i++) {
        if (!has(wp[i], "t")) fail("BAD_ARGS", "Every waypoint needs a time t");
        if (i > 0 && !(wp[i].t > wp[i - 1].t)) fail("BAD_ARGS", "Waypoint times must increase");
        if (has(wp[i], "position")) planPos.push({ t: wp[i].t, v: v3(wp[i].position) });
        if (has(wp[i], "point_of_interest")) planPoi.push({ t: wp[i].t, v: v3(wp[i].point_of_interest) });
      }
      if (planPoi.length) needTwoNode(l);
      if (!planPos.length) planPos = null;
      if (!planPoi.length) planPoi = null;
      if (!planPos && !planPoi) fail("BAD_ARGS", "Waypoints need position and/or point_of_interest");
      if (wp[0].t < 0) fail("BAD_ARGS", "Waypoint times must be 0 or more");
      t0 = wp[0].t; t1 = wp[wp.length - 1].t;
    } else {
      fail("BAD_ARGS", "type must be dolly, truck, pedestal, crane, pan, tilt, roll, orbit, zoom, rack_focus or path");
    }
    if (t1 > comp.duration + EPS) fail("BAD_ARGS", "The move ends at " + t1 + " s, after the comp does (" + comp.duration + " s)", "Shorten it or lengthen the comp with set_comp");

    if (planPos) { res.keyframes.position = putKeys(keyTarget(l, "ADBE Position", "Position"), planPos, easing, posSampled); res.final_position = planPos[planPos.length - 1].v; }
    if (planPoi) { res.keyframes.point_of_interest = putKeys(keyTarget(l, "ADBE Anchor Point", "Point of Interest"), planPoi, easing, poiSampled); res.final_point_of_interest = planPoi[planPoi.length - 1].v; }
    if (planRoll) res.keyframes.roll = putKeys(tp(l, "ADBE Rotate Z"), planRoll, easing, false);
    if (planZoom) { res.keyframes.zoom = putKeys(camOpt(l, "ADBE Camera Zoom"), planZoom, easing, false); res.final_zoom = planZoom[1].v; }
    if (planFocus) { res.keyframes.focus_distance = putKeys(camOpt(l, "ADBE Camera Focus Distance"), planFocus, easing, false); res.final_focus_distance = planFocus[1].v; }
    res.start = t0; res.end = t1;
    return res;
  };

  C.camera_shake = function (a) {
    need(a, ["layer_id"]);
    var l = camLayer(a.layer_id), target = a.target || "position", amount = has(a, "amount") ? a.amount : 10, freq = has(a, "frequency") ? a.frequency : 2,
      oct = has(a, "octaves") ? a.octaves : 2, rotAmt = has(a, "rotation_amount") ? a.rotation_amount : 0.3, seed = has(a, "seed") ? a.seed : 1,
      props = [], applied = [], i, p, ex, wig;
    if (target !== "position" && target !== "point_of_interest" && target !== "rotation" && target !== "all") fail("BAD_ARGS", "target must be position, point_of_interest, rotation or all");
    if (!(freq > 0) || amount < 0) fail("BAD_ARGS", "frequency must be greater than 0 and amount 0 or more");
    if (target === "position" || target === "all") props.push({ name: "position", p: tp(l, "ADBE Position"), rot: false });
    if (target === "point_of_interest" || target === "all") { needTwoNode(l); props.push({ name: "point_of_interest", p: tp(l, "ADBE Anchor Point"), rot: false }); }
    if (target === "rotation" || target === "all") props.push({ name: "roll", p: tp(l, "ADBE Rotate Z"), rot: true });
    for (i = 0; i < props.length; i++) {
      p = props[i].p;
      if (a.remove) {
        if (p.expressionEnabled && p.expression.indexOf(SHAKEMARK) === 0) { p.expression = ""; applied.push(props[i].name); }
        continue;
      }
      if (p.expressionEnabled && p.expression.indexOf(SHAKEMARK) !== 0) fail("BAD_ARGS", props[i].name + " is already driven by an expression", "Remove the rig or clear the expression first");
      ex = SHAKEMARK + "\nseedRandom(" + (seed + i) + ", true);\n";
      if (props[i].rot) ex += "wiggle(" + freq + ", " + rotAmt + ", " + oct + ")";
      else if (a.include_depth === true) ex += "wiggle(" + freq + ", " + amount + ", " + oct + ")";
      else ex += "w = wiggle(" + freq + ", " + amount + ", " + oct + ");\n[w[0], w[1], value[2]]";
      p.expression = ex;
      if (p.expressionError) { p.expression = ""; fail("AE_ERROR", "Shake expression failed: " + p.expressionError); }
      applied.push(props[i].name);
    }
    return { removed: a.remove === true, applied: applied, amount: amount, rotation_amount: rotAmt, frequency: freq, octaves: oct, seed: seed };
  };

  C.camera_rig = function (a) {
    need(a, ["layer_id", "action"]);
    var l = camLayer(a.layer_id), comp = l.containingComp, posP = tp(l, "ADBE Position"), poiP = tp(l, "ADBE Anchor Point"), names = [], pairs, i, ctrl, ctrlPos, m, existing, info = { action: a.action, controls: [] };
    if (a.action === "create") {
      needTwoNode(l);
      if (posP.expressionEnabled || poiP.expressionEnabled) fail("BAD_ARGS", "The camera position or point of interest already has an expression", "Use camera_rig remove first, or clear the expression");
      names = [cleanName(l.name + " Position"), cleanName(l.name + " Target")];
      for (i = 0; i < names.length; i++) {
        existing = null;
        try { existing = comp.layer(names[i]); } catch (e) { existing = null; }
        if (existing) fail("BAD_ARGS", "A layer named " + names[i] + " already exists", "Rename the camera or that layer");
      }
      pairs = [[posP, names[0]], [poiP, names[1]]];
      for (i = 0; i < pairs.length; i++) {
        ctrl = comp.layers.addNull(comp.duration);
        ctrl.name = pairs[i][1];
        ctrl.threeDLayer = true;
        ctrlPos = ctrl.property("ADBE Transform Group").property("ADBE Position");
        copyAnimation(pairs[i][0], ctrlPos);
        while (pairs[i][0].numKeys > 0) pairs[i][0].removeKey(pairs[i][0].numKeys);
        pairs[i][0].expression = RIGMARK + '\nthisComp.layer("' + pairs[i][1] + '").transform.position';
        if (pairs[i][0].expressionError) { pairs[i][0].expression = ""; fail("AE_ERROR", "Rig expression failed: " + pairs[i][0].expressionError); }
        info.controls.push({ name: pairs[i][1], layer_id: ctrl.id, drives: i === 0 ? "position" : "point_of_interest" });
      }
      info.note = "Animate the control layers (or use camera_move, which keys them for you). Renaming a control layer breaks the link.";
      return info;
    }
    if (a.action === "remove") {
      pairs = [[posP, "position"], [poiP, "point_of_interest"]];
      for (i = 0; i < pairs.length; i++) {
        if (!(pairs[i][0].expressionEnabled && pairs[i][0].expression.indexOf(RIGMARK) === 0)) continue;
        m = /thisComp\.layer\("([^"]+)"\)/.exec(pairs[i][0].expression);
        ctrl = null;
        if (m) { try { ctrl = comp.layer(m[1]); } catch (e2) { ctrl = null; } }
        pairs[i][0].expression = "";
        if (ctrl) {
          copyAnimation(ctrl.property("ADBE Transform Group").property("ADBE Position"), pairs[i][0]);
          info.controls.push({ name: ctrl.name, layer_id: ctrl.id, restored: pairs[i][1] });
          if (a.delete_controls !== false) ctrl.remove();
        }
      }
      if (!info.controls.length) fail("BAD_ARGS", "This camera has no rig");
      info.controls_deleted = a.delete_controls !== false;
      return info;
    }
    fail("BAD_ARGS", "action must be create or remove");
  };

  // ---------- 3D layers and lights ----------
  C.set_3d = function (a) {
    need(a, ["layer_id"]);
    var l = getLayer(a.layer_id), t = has(a, "time") ? a.time : null, m = a.material, grp, k, any;
    if (l instanceof CameraLayer) fail("BAD_ARGS", "Use set_camera for camera layers");
    if (l instanceof LightLayer) fail("BAD_ARGS", "Use set_light for light layers");
    any = has(a, "position") || has(a, "anchor") || has(a, "scale") || has(a, "orientation") || has(a, "rotation") || !!m;
    if (has(a, "three_d")) l.threeDLayer = a.three_d;
    else if (any && !l.threeDLayer) l.threeDLayer = true;
    applyXform(l, a, t);
    if (m) {
      grp = l.property("ADBE Material Options Group");
      if (!grp) fail("BAD_ARGS", "This layer has no material options", "Make it 3D first");
      if (has(m, "casts_shadows")) { if (CASTS[m.casts_shadows] === undefined) fail("BAD_ARGS", "casts_shadows must be off, on or only"); setAt(grp.property("ADBE Casts Shadows"), CASTS[m.casts_shadows], t); }
      if (has(m, "accepts_shadows")) setAt(grp.property("ADBE Accepts Shadows"), m.accepts_shadows ? 1 : 0, t);
      if (has(m, "accepts_lights")) setAt(grp.property("ADBE Accepts Lights"), m.accepts_lights ? 1 : 0, t);
      for (k in MATERIAL) { if (MATERIAL.hasOwnProperty(k) && has(m, k)) setAt(grp.property(MATERIAL[k]), m[k], t); }
    }
    k = xformInfo(l, t === null ? 0 : t);
    return { layer: layerInfo(l), three_d: l.threeDLayer === true, position: k.position, orientation: k.orientation, rotation: k.rotation };
  };

  function lightInfo(l, t) {
    var g = l.property("ADBE Light Options Group"), o = {}, k, name = "unknown", ft = safe(function () { return g.property("ADBE Light Falloff Type").valueAtTime(t, false); });
    for (k in LIGHTTYPES) { if (LIGHTTYPES.hasOwnProperty(k) && LightType[LIGHTTYPES[k]] === l.lightType) name = k; }
    o.layer = layerInfo(l);
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
  C.set_light = function (a) {
    need(a, ["layer_id"]);
    var l = getLayer(a.layer_id), t = has(a, "time") ? a.time : null, g, lt, fo;
    if (!(l instanceof LightLayer)) fail("BAD_ARGS", "Layer is not a light", "Add one with add_layer kind light");
    if (has(a, "name")) l.name = a.name;
    if (has(a, "light_type")) {
      lt = LIGHTTYPES[a.light_type];
      if (!lt) fail("BAD_ARGS", "light_type must be point, spot, parallel or ambient");
      l.lightType = LightType[lt];
    }
    g = l.property("ADBE Light Options Group");
    if ((has(a, "cone_angle") || has(a, "cone_feather")) && l.lightType !== LightType.SPOT) fail("BAD_ARGS", "cone_angle and cone_feather need a spot light");
    if (has(a, "intensity")) setAt(g.property("ADBE Light Intensity"), a.intensity, t);
    if (a.color) setAt(g.property("ADBE Light Color"), rgba(a.color), t);
    if (has(a, "cone_angle")) setAt(g.property("ADBE Light Cone Angle"), a.cone_angle, t);
    if (has(a, "cone_feather")) setAt(g.property("ADBE Light Cone Feather 2"), a.cone_feather, t);
    if (has(a, "falloff")) { fo = FALLOFFS[a.falloff]; if (!fo) fail("BAD_ARGS", "falloff must be none, smooth or inverse_square_clamped"); setAt(g.property("ADBE Light Falloff Type"), fo, t); }
    if (has(a, "falloff_radius")) setAt(g.property("ADBE Light Falloff Start"), a.falloff_radius, t);
    if (has(a, "falloff_distance")) setAt(g.property("ADBE Light Falloff Distance"), a.falloff_distance, t);
    if (has(a, "casts_shadows")) setAt(g.property("ADBE Casts Shadows"), a.casts_shadows ? 1 : 0, t);
    if (has(a, "shadow_darkness")) setAt(g.property("ADBE Light Shadow Darkness"), a.shadow_darkness, t);
    if (has(a, "shadow_diffusion")) setAt(g.property("ADBE Light Shadow Diffusion"), a.shadow_diffusion, t);
    applyXform(l, a, t);
    return lightInfo(l, t === null ? 0 : t);
  };

  // ---------- linking (parenting), nulls and the 3D viewer ----------
  var VIEWS = {
    "active_camera": "Active Camera", "default": "Default", "front": "Front", "left": "Left", "top": "Top", "back": "Back", "right": "Right", "bottom": "Bottom",
    "custom_1": "Custom View 1", "custom_2": "Custom View 2", "custom_3": "Custom View 3"
  };

  // A three-value position needs a 3D layer, so it turns 3D on; cameras and lights are always 3D.
  function setLayerPosition(l, v) {
    var is3 = (l instanceof CameraLayer || l instanceof LightLayer || l.threeDLayer === true);
    if (v.length > 2 && !is3) { l.threeDLayer = true; is3 = true; }
    tp(l, "ADBE Position").setValue(is3 ? v3(v) : [v[0], v[1]]);
  }

  C.link_layers = function (a) {
    need(a, ["layer_ids"]);
    var ids = a.layer_ids, layers = [], seen = {}, i, l, comp = null, par = null, nn = null, byId = has(a, "parent_id"), unlink = (a.parent_id === null),
      anc, top, sum = [0, 0, 0], v, any3 = false, pos, made = null, out = [];
    if (!(ids instanceof Array) || ids.length === 0) fail("BAD_ARGS", "layer_ids must be a non-empty array");
    if (has(a, "new_null")) nn = a.new_null === true ? {} : a.new_null;
    if (((byId || unlink) ? 1 : 0) + (nn ? 1 : 0) !== 1) fail("BAD_ARGS", "Pass exactly one of parent_id (a layer id, or null to unlink) and new_null");
    for (i = 0; i < ids.length; i++) {
      if (seen[ids[i]]) continue;
      seen[ids[i]] = true;
      l = getLayer(ids[i]);
      if (comp === null) comp = l.containingComp;
      else if (l.containingComp.id !== comp.id) fail("BAD_ARGS", "All layers must be in the same composition");
      if (l.locked) fail("BAD_ARGS", "Layer " + l.name + " is locked", "Unlock it with set_layer locked: false");
      layers.push(l);
    }
    // validate everything before changing anything
    if (byId) {
      par = getLayer(a.parent_id);
      if (par.containingComp.id !== comp.id) fail("BAD_ARGS", "The parent is in a different composition");
      if (seen[par.id]) fail("BAD_ARGS", "A layer cannot be its own parent");
      for (anc = par.parent; anc; anc = anc.parent) {
        if (seen[anc.id]) fail("BAD_ARGS", "That would link " + anc.name + " to its own child " + par.name);
      }
    }
    if (nn) {
      top = layers[0];
      for (i = 0; i < layers.length; i++) {
        l = layers[i];
        if (l.threeDLayer === true) any3 = true;
        v = tp(l, "ADBE Position").value;
        sum[0] += v[0]; sum[1] += v[1]; sum[2] += (v.length > 2 ? v[2] : 0);
        if (l.index < top.index) top = l;
      }
      pos = has(nn, "position") ? v3(nn.position) : [sum[0] / layers.length, sum[1] / layers.length, sum[2] / layers.length];
      made = comp.layers.addNull(comp.duration);
      made.name = nn.name || "Link Null";
      if (has(nn, "three_d") ? nn.three_d : (any3 || (has(nn, "position") && nn.position.length > 2))) made.threeDLayer = true;
      setLayerPosition(made, made.threeDLayer ? pos : [pos[0], pos[1]]);
      made.moveBefore(top);
      par = made;
    }
    for (i = 0; i < layers.length; i++) {
      if (par === null) layers[i].parent = null;
      else if (a.jump === true) layers[i].setParentWithJump(par);
      else layers[i].parent = par;
    }
    for (i = 0; i < layers.length; i++) out.push(layerInfo(layers[i]));
    return { parent: par ? layerInfo(par) : null, created_null: made !== null, layers: out };
  };

  C.set_3d_view = function (a) {
    need(a, ["view"]);
    var name, cmd, comp, cam;
    if (!VIEWS.hasOwnProperty(a.view)) fail("BAD_ARGS", "view must be active_camera, default, front, left, top, back, right, bottom, custom_1, custom_2 or custom_3");
    name = VIEWS[a.view];
    if (has(a, "comp_id")) { comp = getComp(a.comp_id); comp.openInViewer(); }
    else {
      comp = app.project.activeItem;
      if (!(comp instanceof CompItem)) fail("BAD_ARGS", "There is no active composition", "Pass comp_id");
    }
    // After Effects puts the active camera's layer name in the menu item: "Active Camera (Camera 1)"
    if (a.view === "active_camera") {
      cam = comp.activeCamera;
      if (cam) name = "Active Camera (" + cam.name + ")";
    }
    cmd = app.findMenuCommandId(name);
    if (!cmd) fail("UNSUPPORTED", "This After Effects version has no menu command named " + name, a.view === "active_camera" ? "The menu item includes the active camera's name; add a camera layer first" : "");
    app.executeCommand(cmd);
    return { view: a.view, menu_item: name, command_id: cmd };
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
