// Text content and styling. (src/tools/animate.ts: set_text, get_text)
// Styling applies to the whole layer; ranges style part of it through TextDocument.characterRange (After Effects
// 24.3+). Verified in AE 26.3: a range takes font, size, colours, faux styles, caps, tracking, scale and baseline
// shift; its stroke shows only with applyStroke set explicitly; superscript / subscript are read-only on a range; a
// whole-layer setter applies that one attribute to every character; and new text drops all part styling.

// tool field -> TextDocument attribute, for plain numeric and boolean attributes
var TEXT_NUM: { [field: string]: string } = {
  size: "fontSize", tracking: "tracking", leading: "leading", baseline_shift: "baselineShift",
  stroke_width: "strokeWidth",
  first_line_indent: "firstLineIndent", left_indent: "leftIndent", right_indent: "rightIndent",
  space_before: "spaceBefore", space_after: "spaceAfter", tsume: "tsume"
};
var TEXT_BOOL: { [field: string]: string } = {
  faux_bold: "fauxBold", faux_italic: "fauxItalic", ligatures: "ligature", auto_leading: "autoLeading",
  stroke: "applyStroke", fill: "applyFill", stroke_over_fill: "strokeOverFill"
};
var TEXT_JUST: { [name: string]: string } = {
  left: "LEFT_JUSTIFY", center: "CENTER_JUSTIFY", right: "RIGHT_JUSTIFY", justify: "FULL_JUSTIFY_LASTLINE_LEFT",
  justify_center: "FULL_JUSTIFY_LASTLINE_CENTER", justify_right: "FULL_JUSTIFY_LASTLINE_RIGHT", justify_all: "FULL_JUSTIFY_LASTLINE_FULL"
};

// FontBaselineOption member names differ between versions; find the one containing n.
function baseEnum(n: string): number {
  var E = FontBaselineOption, k, list: string[] = [];
  if (typeof E[n] !== "undefined") return E[n];
  if (typeof E["FONT_" + n] !== "undefined") return E["FONT_" + n];
  for (k in E) { list.push(k); if (String(k).toUpperCase().indexOf(n) !== -1 && typeof E[k] === "number") return E[k]; }
  throw new Error("FontBaselineOption has no " + n + " (found: " + list.join(", ") + ")");
}

// doc: a TextDocument (any: several of the attributes read here only exist in newer After Effects versions)
function baselineOf(doc: any): number | undefined {
  if (typeof doc.fontBaselineOption !== "undefined") return doc.fontBaselineOption;
  if (typeof doc.baselineOption !== "undefined") return doc.baselineOption;
  return undefined;
}

function readText(doc: any): Obj {
  var o: Obj = {}, k: string;
  o.text = doc.text; o.font = doc.font; o.size = doc.fontSize;
  o.color = safe(function () { return doc.fillColor; });
  o.stroke_color = safe(function () { return doc.strokeColor; });
  o.justification = null;
  for (k in TEXT_JUST) { if (TEXT_JUST.hasOwnProperty(k) && safe(function () { return doc.justification === (ParagraphJustification as any)[TEXT_JUST[k]]; })) { o.justification = k; break; } }
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

function textProp(a: { layer_id: number }): Prop {
  var l = getLayer(a.layer_id);
  if (!(l instanceof TextLayer)) fail("BAD_ARGS", "Layer is not a text layer");
  return l.property("ADBE Text Properties").property("ADBE Text Document");
}

function errText(e: any): string { return String(e.message || e); }

// ----- part styling (characterRange) -----

function canRange(doc: any): boolean { return typeof doc.characterRange === "function"; }

function rnd4(v: any): any {
  var o: number[] = [], i;
  if (typeof v === "number") return Math.round(v * 10000) / 10000;
  if (v && typeof v === "object" && typeof v.length === "number") { for (i = 0; i < v.length; i++) o.push(Math.round(v[i] * 10000) / 10000); return o; }
  return v;
}

// One character range's styling in tool field names (undefined: mixed across the range, or unreadable).
function rangeStyle(r: any): Obj {
  var o: Obj = {}, caps;
  o.font = safe(function () { return r.font; });
  o.size = rnd4(safe(function () { return r.fontSize; }));
  o.fill = safe(function () { return r.applyFill; });
  if (o.fill === true) o.color = rnd4(safe(function () { return r.fillColor; }));
  o.stroke = safe(function () { return r.applyStroke; });
  if (o.stroke === true) { o.stroke_color = rnd4(safe(function () { return r.strokeColor; })); o.stroke_width = rnd4(safe(function () { return r.strokeWidth; })); }
  o.faux_bold = safe(function () { return r.fauxBold; });
  o.faux_italic = safe(function () { return r.fauxItalic; });
  o.tracking = rnd4(safe(function () { return r.tracking; }));
  o.baseline_shift = rnd4(safe(function () { return r.baselineShift; }));
  o.horizontal_scale = rnd4(safe(function () { return r.horizontalScale * 100; }));
  o.vertical_scale = rnd4(safe(function () { return r.verticalScale * 100; }));
  caps = safe(function () { return r.fontCapsOption; });
  if (caps !== undefined) { o.all_caps = caps === FontCapsOption.FONT_ALL_CAPS; o.small_caps = caps === FontCapsOption.FONT_SMALL_CAPS; }
  return o;
}

// Whether the text has part styling: some attribute reads as mixed over the whole text.
function mixedStyle(doc: any): boolean {
  var n = String(doc.text).length, st, k;
  if (!canRange(doc) || n < 2) return false;
  st = rangeStyle(doc.characterRange(0, n));
  for (k in st) { if (st.hasOwnProperty(k) && st[k] === undefined) return true; }
  return false;
}

// Runs of characters styled differently from the first one, each with only the fields that differ.
var RUNS_MAX = 100;
function styledRuns(doc: any): Obj {
  var text = String(doc.text), n = text.length, base = rangeStyle(doc.characterRange(0, 1)), baseSig = JSON.stringify(base);
  var runs: Obj[] = [], i = 0, j, st, sig, nextSig, diff: Obj, k, more = 0;
  while (i < n) {
    st = rangeStyle(doc.characterRange(i, i + 1)); sig = JSON.stringify(st); j = i + 1;
    while (j < n) { nextSig = JSON.stringify(rangeStyle(doc.characterRange(j, j + 1))); if (nextSig !== sig) break; j++; }
    if (sig !== baseSig) {
      if (runs.length >= RUNS_MAX) more++;
      else {
        diff = { start: i, end: j, text: text.substring(i, j) };
        for (k in st) { if (st.hasOwnProperty(k) && JSON.stringify(st[k]) !== JSON.stringify(base[k])) diff[k] = st[k]; }
        runs.push(diff);
      }
    }
    i = j;
  }
  return more > 0 ? { ranges: runs, ranges_more: more } : { ranges: runs };
}

type RangeArg = NonNullable<Args["set_text"]["ranges"]>[number];

// The [start, end) spans a range argument covers in text; fails (before anything changes) when it covers none.
function rangeSpans(r: RangeArg, text: string, idx: number): number[][] {
  var out: number[][] = [], at = 0, n = text.length, s, e, where = "ranges[" + idx + "]";
  if (has(r, "match")) {
    if (has(r, "start") || has(r, "end")) fail("BAD_ARGS", where + ": pass match or start/end, not both", "match styles every occurrence; for one of them pass its start/end (get_text ranges shows the indexes)");
    while ((at = text.indexOf(r.match, at)) !== -1) { out.push([at, at + r.match.length]); at += r.match.length; }
    if (out.length === 0) fail("NOT_FOUND", where + ": \"" + r.match + "\" is not in the text", "match is case-sensitive; the text is: " + text.substring(0, 200));
    return out;
  }
  s = has(r, "start") ? r.start : 0; e = has(r, "end") ? r.end : n;
  if (e > n || s >= e) fail("BAD_ARGS", where + ": start " + s + " / end " + e + " outside the text (" + n + " characters)", "Indexes start at 0 and end is exclusive; end defaults to the text's end");
  return [[s, e]];
}

// Apply one range argument's fields to a characterRange; refused attributes go into skipped.
function styleRange(cr: any, r: RangeArg, skipped: Obj, where: string): void {
  function put(field: string, fn: () => void): void { try { fn(); } catch (e) { skipped[where + "." + field] = errText(e); } }
  if (r.font) put("font", function () { cr.font = r.font; });
  if (has(r, "size")) put("size", function () { cr.fontSize = r.size; });
  if (has(r, "fill")) put("fill", function () { cr.applyFill = r.fill; });
  if (r.color) put("color", function () { cr.applyFill = true; cr.fillColor = [r.color![0], r.color![1], r.color![2]]; });
  // the stroke only shows with applyStroke set explicitly (a colour alone does not turn it on)
  if (has(r, "stroke")) put("stroke", function () { cr.applyStroke = r.stroke; });
  else if (r.stroke_color || has(r, "stroke_width")) put("stroke", function () { cr.applyStroke = true; });
  if (r.stroke_color) put("stroke_color", function () { cr.strokeColor = [r.stroke_color![0], r.stroke_color![1], r.stroke_color![2]]; });
  if (has(r, "stroke_width")) put("stroke_width", function () { cr.strokeWidth = r.stroke_width; });
  if (has(r, "faux_bold")) put("faux_bold", function () { cr.fauxBold = r.faux_bold; });
  if (has(r, "faux_italic")) put("faux_italic", function () { cr.fauxItalic = r.faux_italic; });
  if (has(r, "tracking")) put("tracking", function () { cr.tracking = r.tracking; });
  if (has(r, "baseline_shift")) put("baseline_shift", function () { cr.baselineShift = r.baseline_shift; });
  if (has(r, "horizontal_scale")) put("horizontal_scale", function () { cr.horizontalScale = r.horizontal_scale! / 100; });
  if (has(r, "vertical_scale")) put("vertical_scale", function () { cr.verticalScale = r.vertical_scale! / 100; });
  if (has(r, "all_caps") || has(r, "small_caps")) {
    put("caps", function () { cr.fontCapsOption = (r.all_caps === true) ? FontCapsOption.FONT_ALL_CAPS : ((r.small_caps === true) ? FontCapsOption.FONT_SMALL_CAPS : FontCapsOption.FONT_NORMAL_CAPS); });
  }
}

C.get_text = function (a: Args["get_text"]) {
  need(a, ["layer_id"]);
  var prop = textProp(a), doc = has(a, "time") ? prop.valueAtTime(a.time, false) : prop.value, o = readText(doc), runs: Obj, k;
  if (mixedStyle(doc)) { runs = styledRuns(doc); for (k in runs) { if (runs.hasOwnProperty(k)) o[k] = runs[k]; } }
  return o;
};

// Attributes After Effects refuses are reported in "skipped" instead of failing the whole call.
// app.fonts (After Effects 24.0+) as a flat list of Font objects (allFonts groups them by family).
function allFonts(): FontObject[] {
  var out: FontObject[] = [], groups: any, i, j;
  if (!app.fonts || !app.fonts.allFonts) fail("UNSUPPORTED", "Listing fonts needs After Effects 24.0 or later", "Pass the font's PostScript name to set_text directly");
  groups = app.fonts!.allFonts;
  for (i = 0; i < groups.length; i++) {
    if (groups[i] instanceof Array || (groups[i] && typeof groups[i].length === "number" && !groups[i].postScriptName)) { for (j = 0; j < groups[i].length; j++) out.push(groups[i][j]); }
    else out.push(groups[i]);
  }
  return out;
}

// Refuse a font that is not installed: After Effects would silently keep the old one. Older versions cannot check.
function checkFont(name: string): void {
  var found;
  if (!app.fonts || !app.fonts.getFontsByPostScriptName) return;
  found = app.fonts!.getFontsByPostScriptName(name);
  if (!found || found.length === 0) fail("NOT_FOUND", "Font not installed: " + name, "Use a PostScript name from find_fonts (e.g. find_fonts query \"" + name.split("-")[0] + "\")");
}

C.find_fonts = function (a: Args["find_fonts"]) {
  var fonts = allFonts(), words = String(a.query || "").toLowerCase().split(" "), limit = a.limit || 30, out: Obj[] = [], total = 0, i, j, f, hay, ok;
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

C.set_text = function (a: Args["set_text"]) {
  need(a, ["layer_id"]);
  var prop = textProp(a), doc, k: string, skipped: Obj = {}, hasKeys = prop.numKeys > 0, rb, out: Obj, cleared = false;
  var spans: number[][][] = [], i, j;
  doc = has(a, "time") ? prop.valueAtTime(a.time, false) : prop.value;
  if (a.ranges && !canRange(doc)) fail("UNSUPPORTED", "Styling part of a text needs After Effects 24.3 or later", "Use a text animator with a range selector (add_property) instead");
  if (a.font) checkFont(a.font);
  if (a.ranges) { for (i = 0; i < a.ranges.length; i++) { if (a.ranges[i].font) checkFont(a.ranges[i].font!); } }
  // new text drops every part style (After Effects keeps the first character's); unchanged text keeps them
  if (has(a, "text") && a.text !== String(doc.text)) { cleared = mixedStyle(doc); doc.text = a.text; }
  // resolve every range against the final text before anything changes
  if (a.ranges) { for (i = 0; i < a.ranges.length; i++) spans.push(rangeSpans(a.ranges[i], String(doc.text), i)); }
  if (a.font) doc.font = a.font;
  if (a.color) { doc.fillColor = [a.color[0], a.color[1], a.color[2]]; doc.applyFill = true; }
  if (a.stroke_color) { doc.strokeColor = [a.stroke_color[0], a.stroke_color[1], a.stroke_color[2]]; doc.applyStroke = true; }
  if (has(a, "stroke_width") && !has(a, "stroke")) doc.applyStroke = true;
  for (k in TEXT_NUM) {
    if (TEXT_NUM.hasOwnProperty(k) && has(a as Obj, k)) {
      try { doc[TEXT_NUM[k]] = (a as Obj)[k]; } catch (e1) { skipped[k] = errText(e1); }
    }
  }
  // an explicit leading only sticks with auto leading off
  if (has(a, "leading") && !has(a, "auto_leading")) { try { doc.autoLeading = false; } catch (e2) {} try { doc.leading = a.leading; } catch (e3) { skipped.leading = errText(e3); } }
  for (k in TEXT_BOOL) {
    if (TEXT_BOOL.hasOwnProperty(k) && has(a as Obj, k)) {
      try { doc[TEXT_BOOL[k]] = (a as Obj)[k]; } catch (e4) { skipped[k] = errText(e4); }
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
    try { doc.justification = (ParagraphJustification as any)[TEXT_JUST[a.justification]]; } catch (e9) { skipped.justification = errText(e9); }
  }
  if (a.box_size) {
    try {
      if (!doc.boxText) throw new Error("This is point text; After Effects can only make box text when the layer is created (add_layer with options.box_size)");
      doc.boxTextSize = [a.box_size[0], a.box_size[1]];
    } catch (e10) { skipped.box_size = errText(e10); }
  }
  // part styling after the whole-layer fields (those apply to every character)
  if (a.ranges) {
    for (i = 0; i < a.ranges.length; i++) {
      for (j = 0; j < spans[i].length; j++) styleRange(doc.characterRange(spans[i][j][0], spans[i][j][1]), a.ranges[i], skipped, "ranges." + i);
    }
  }
  if (!has(a, "time") && hasKeys) fail("BAD_ARGS", "Source text is animated; pass time to set the text at a time");
  if (has(a, "time")) prop.setValueAtTime(a.time, doc);
  else prop.setValue(doc);
  // read back only the fields that were set (get_text returns everything); skipped lists what After Effects refused
  rb = readText(has(a, "time") ? prop.valueAtTime(a.time, false) : prop.value);
  out = {};
  for (k in a) { if (a.hasOwnProperty(k) && rb.hasOwnProperty(k)) out[k] = rb[k]; }
  if (a.ranges) {
    out.ranges = [];
    for (i = 0; i < spans.length; i++) { for (j = 0; j < spans[i].length; j++) out.ranges.push({ start: spans[i][j][0], end: spans[i][j][1], text: String(doc.text).substring(spans[i][j][0], spans[i][j][1]) }); }
  }
  if (cleared) out.ranges_cleared = true;
  for (k in skipped) { if (skipped.hasOwnProperty(k)) { out.skipped = skipped; break; } }
  return out;
};
