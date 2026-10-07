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
  var READONLY = { get_project: 1, get_selection: 1, get_comp: 1, get_layer: 1, list_properties: 1, find_effects: 1, preview_frame: 1, prepare_render: 1 };

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
      parent_id: l.parent ? l.parent.id : null, enabled: l.enabled, comp_id: l.containingComp.id
    };
  }
  function compInfo(c, withLayers) {
    var o = {
      id: c.id, name: c.name, width: c.width, height: c.height, fps: c.frameRate, duration: c.duration,
      pixel_aspect: c.pixelAspect, bg_color: [c.bgColor[0], c.bgColor[1], c.bgColor[2]], num_layers: c.numLayers
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
    if (s.type === "ellipse") {
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
    var comp = getComp(a.comp_id), o = a.options || {}, kind = a.kind, dur = has(o, "duration") ? o.duration : comp.duration, l, item, col, size;
    if (kind === "shape" && o.shape && o.shape.type && o.shape.type !== "rect" && o.shape.type !== "ellipse") fail("BAD_ARGS", "shape.type must be rect or ellipse");
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
    if (has(a, "name")) l.name = a.name;
    if (has(a, "start")) l.startTime = a.start;
    if (has(a, "in")) l.inPoint = a["in"];
    if (has(a, "out")) l.outPoint = a.out;
    if (has(a, "enabled")) l.enabled = a.enabled;
    if (bm !== undefined) l.blendingMode = bm;
    if (a.parent_id === null) l.parent = null; else if (par) l.parent = par;
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
