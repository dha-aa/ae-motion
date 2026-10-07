// Find project items, layers and properties from the ids and paths the MCP tools send.

var ALIAS = {
  position: ["ADBE Transform Group", "ADBE Position"],
  scale: ["ADBE Transform Group", "ADBE Scale"],
  rotation: ["ADBE Transform Group", "ADBE Rotate Z"],
  opacity: ["ADBE Transform Group", "ADBE Opacity"],
  anchor: ["ADBE Transform Group", "ADBE Anchor Point"]
};

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

// Layer ids and project.layerByID both arrived in After Effects 22.0, the minimum version in the manifest.
function getLayer(id) {
  var l = null;
  try { l = app.project.layerByID(id); } catch (e) {}
  if (!l) fail("NOT_FOUND", "Layer id " + id + " not found", "Use get_comp to list layer ids");
  return l;
}

// path: an ALIAS name, a single match name, or an array of match names / 1-based indexes.
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

function layersOf(comp) { var out = [], i; for (i = 1; i <= comp.numLayers; i++) out.push(comp.layer(i)); return out; }

// Look up several layers; with comp, every layer must belong to it.
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

// Return the comp shared by all layers, or fail.
function sameComp(layers) {
  var comp = layers[0].containingComp, i;
  for (i = 1; i < layers.length; i++) if (layers[i].containingComp.id !== comp.id) fail("BAD_ARGS", "All layers must be in the same composition");
  return comp;
}

function assertUnlocked(layers) {
  var i;
  for (i = 0; i < layers.length; i++) if (layers[i].locked) fail("BAD_ARGS", "Layer " + layers[i].id + " is locked", "Unlock it with set_layer locked:false");
}

// Shorthand for a layer's transform property by match name.
function tp(l, match) { return l.property("ADBE Transform Group").property(match); }
