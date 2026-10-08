// Text content and styling. (src/tools/animate.ts: set_text, get_text)
// Styling applies to the whole layer; per-character changes go through text animators (add_property).

// tool field -> TextDocument attribute, for plain numeric and boolean attributes
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

// FontBaselineOption member names differ between versions; find the one containing n.
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

function errText(e) { return String(e.message || e); }

C.get_text = function (a) {
  need(a, ["layer_id"]);
  var prop = textProp(a);
  return readText(has(a, "time") ? prop.valueAtTime(a.time, false) : prop.value);
};

// Attributes After Effects refuses are reported in "skipped" instead of failing the whole call.
// app.fonts (After Effects 24.0+) as a flat list of Font objects (allFonts groups them by family).
function allFonts() {
  var out = [], groups, i, j;
  if (!app.fonts || !app.fonts.allFonts) fail("UNSUPPORTED", "Listing fonts needs After Effects 24.0 or later", "Pass the font's PostScript name to set_text directly");
  groups = app.fonts.allFonts;
  for (i = 0; i < groups.length; i++) {
    if (groups[i] instanceof Array || (groups[i] && typeof groups[i].length === "number" && !groups[i].postScriptName)) { for (j = 0; j < groups[i].length; j++) out.push(groups[i][j]); }
    else out.push(groups[i]);
  }
  return out;
}

// Refuse a font that is not installed: After Effects would silently keep the old one. Older versions cannot check.
function checkFont(name) {
  var found;
  if (!app.fonts || !app.fonts.getFontsByPostScriptName) return;
  found = app.fonts.getFontsByPostScriptName(name);
  if (!found || found.length === 0) fail("NOT_FOUND", "Font not installed: " + name, "Use a PostScript name from find_fonts (e.g. find_fonts query \"" + name.split("-")[0] + "\")");
}

C.find_fonts = function (a) {
  var fonts = allFonts(), words = String(a.query || "").toLowerCase().split(" "), limit = a.limit || 30, out = [], total = 0, i, j, f, hay, ok;
  for (i = 0; i < fonts.length; i++) {
    f = fonts[i];
    hay = (f.familyName + " " + f.styleName + " " + f.postScriptName).toLowerCase();
    ok = true;
    for (j = 0; j < words.length; j++) { if (words[j] && hay.indexOf(words[j]) === -1) { ok = false; break; } }
    if (!ok) continue;
    total++;
    if (out.length < limit) out.push({ font: f.postScriptName, family: f.familyName, style: f.styleName });
  }
  return { total: total, fonts: out };
};

C.set_text = function (a) {
  need(a, ["layer_id"]);
  var prop = textProp(a), doc, k, skipped = {}, hasKeys = prop.numKeys > 0, rb, out;
  doc = has(a, "time") ? prop.valueAtTime(a.time, false) : prop.value;
  if (has(a, "text")) doc.text = a.text;
  if (a.font) { checkFont(a.font); doc.font = a.font; }
  if (a.color) { doc.fillColor = [a.color[0], a.color[1], a.color[2]]; doc.applyFill = true; }
  if (a.stroke_color) { doc.strokeColor = [a.stroke_color[0], a.stroke_color[1], a.stroke_color[2]]; doc.applyStroke = true; }
  if (has(a, "stroke_width") && !has(a, "stroke")) doc.applyStroke = true;
  for (k in TEXT_NUM) {
    if (TEXT_NUM.hasOwnProperty(k) && has(a, k)) {
      try { doc[TEXT_NUM[k]] = a[k]; } catch (e1) { skipped[k] = errText(e1); }
    }
  }
  // an explicit leading only sticks with auto leading off
  if (has(a, "leading") && !has(a, "auto_leading")) { try { doc.autoLeading = false; } catch (e2) {} try { doc.leading = a.leading; } catch (e3) { skipped.leading = errText(e3); } }
  for (k in TEXT_BOOL) {
    if (TEXT_BOOL.hasOwnProperty(k) && has(a, k)) {
      try { doc[TEXT_BOOL[k]] = a[k]; } catch (e4) { skipped[k] = errText(e4); }
    }
  }
  if (has(a, "horizontal_scale")) { try { doc.horizontalScale = a.horizontal_scale / 100; } catch (e5) { skipped.horizontal_scale = errText(e5); } }
  if (has(a, "vertical_scale")) { try { doc.verticalScale = a.vertical_scale / 100; } catch (e6) { skipped.vertical_scale = errText(e6); } }
  if (has(a, "all_caps") || has(a, "small_caps")) {
    try { doc.fontCapsOption = (a.all_caps === true) ? FontCapsOption.FONT_ALL_CAPS : ((a.small_caps === true) ? FontCapsOption.FONT_SMALL_CAPS : FontCapsOption.FONT_NORMAL_CAPS); } catch (e7) { skipped.caps = errText(e7); }
  }
  if (has(a, "superscript") || has(a, "subscript")) {
    try { doc.fontBaselineOption = (a.superscript === true) ? baseEnum("SUPERSCRIPT") : ((a.subscript === true) ? baseEnum("SUBSCRIPT") : baseEnum("NORMAL_BASELINE")); } catch (e8) { skipped.baseline = errText(e8); }
  }
  if (a.justification) {
    if (!TEXT_JUST.hasOwnProperty(a.justification)) fail("BAD_ARGS", "justification must be left, center, right, justify, justify_center, justify_right or justify_all");
    try { doc.justification = ParagraphJustification[TEXT_JUST[a.justification]]; } catch (e9) { skipped.justification = errText(e9); }
  }
  if (a.box_size) {
    try {
      if (!doc.boxText) throw new Error("This is point text; After Effects can only make box text when the layer is created (add_layer with options.box_size)");
      doc.boxTextSize = [a.box_size[0], a.box_size[1]];
    } catch (e10) { skipped.box_size = errText(e10); }
  }
  if (has(a, "time")) prop.setValueAtTime(a.time, doc);
  else if (hasKeys) fail("BAD_ARGS", "Source text is animated; pass time to set the text at a time");
  else prop.setValue(doc);
  // read back only the fields that were set (get_text returns everything); skipped lists what After Effects refused
  rb = readText(has(a, "time") ? prop.valueAtTime(a.time, false) : prop.value);
  out = {};
  for (k in a) { if (a.hasOwnProperty(k) && rb.hasOwnProperty(k)) out[k] = rb[k]; }
  for (k in skipped) { if (skipped.hasOwnProperty(k)) { out.skipped = skipped; break; } }
  return out;
};
