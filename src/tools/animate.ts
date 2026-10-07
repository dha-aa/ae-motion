/**
 * Animation and styling tools: properties, keyframes, expressions, effects, presets, text and shape modifiers.
 * Host side: host/commands/animate.jsx and host/commands/text.jsx.
 */
import { z } from "zod";
import type { ToolRegistry } from "./registry.js";
import { Color, Ease, id, PropPath, Size, Value } from "./schemas.js";

export function registerAnimateTools(r: ToolRegistry): void {
  r.bridged(
    "set_property",
    "Set a static value, or a value at `time` (creates/updates a keyframe). Animated properties need `time`. Use set_text for text.",
    { layer_id: id("Layer"), path: PropPath, value: Value, time: z.number().min(0).optional() },
  );

  r.bridged(
    "set_keyframes",
    "Replace all keyframes on a property. Each key: {t, v, interp?: linear|bezier|hold, ease_in?, ease_out?}. Fails if the property has an active expression.",
    {
      layer_id: id("Layer"), path: PropPath,
      keys: z.array(z.object({ t: z.number().min(0), v: Value, interp: z.enum(["linear", "bezier", "hold"]).optional(), ease_in: Ease.optional(), ease_out: Ease.optional() })).min(1),
    },
  );

  r.bridged(
    "add_property",
    "Add a property or group to a layer, for things set_property cannot reach until they exist. Text animator: group_path ['ADBE Text Properties','ADBE Text Animators'], match_name ADBE Text Animator; then add properties with group_path = returned path + 'ADBE Text Animator Properties' (match_name ADBE Text Position 3D, ADBE Text Opacity, ADBE Text Fill Color, ADBE Text Tracking Amount...) and a range selector with group_path = returned path + 'ADBE Text Selectors', match_name ADBE Text Selector. Layer styles cannot be created by scripts in After Effects, so they are not supported. Returns the new property path for set_property / set_keyframes.",
    { layer_id: id("Layer"), match_name: z.string(), group_path: PropPath.optional() },
  );

  r.bridged(
    "set_expression",
    "Set an expression on a property (empty string clears it). Returns whether After Effects accepted the syntax.",
    { layer_id: id("Layer"), path: PropPath, expression: z.string() },
  );

  r.bridged(
    "apply_effect",
    "Add an effect by match name (see find_effects) and set parameters by name, match name or 1-based index. If any parameter fails the effect is removed.",
    { layer_id: id("Layer"), match_name: z.string(), name: z.string().optional(), params: z.record(Value).optional() },
  );

  r.bridged(
    "edit_effect",
    "Remove, enable or disable an effect on a layer by its 1-based index (see get_layer for the list).",
    { layer_id: id("Layer"), effect_index: z.number().int().min(1), action: z.enum(["remove", "enable", "disable"]) },
  );

  r.bridged(
    "apply_preset",
    "Apply an .ffx animation preset to a layer. Path must be inside the allowed folders.",
    { layer_id: id("Layer"), ffx_path: z.string() },
    { paths: ["ffx_path"] },
  );

  r.bridged(
    "set_text",
    "Set text content and any character or paragraph styling on a text layer; only the fields you pass change, and the result reads the values back (skipped lists anything After Effects refused). font is the PostScript name. Character: size, color, tracking, leading (turns auto leading off), auto_leading, baseline_shift, horizontal_scale and vertical_scale (percent, 100 = normal), faux_bold, faux_italic, all_caps, small_caps, superscript, subscript, ligatures, tsume. Stroke: stroke_color (turns the stroke on), stroke_width, stroke (on/off), stroke_over_fill, fill (on/off). Paragraph: justification (left, center, right, justify, justify_center, justify_right, justify_all), first_line_indent, left_indent, right_indent, space_before, space_after, box_size [w,h] (resizes box text; point text cannot be converted, create box text with add_layer options.box_size). Pass time to set the text at a time as a keyframe. Styling applies to the whole layer; for per-character changes use text animators (add_property).",
    {
      layer_id: id("Layer"), time: z.number().min(0).optional(), text: z.string().optional(), font: z.string().optional(),
      size: z.number().positive().optional(), color: Color.optional(), tracking: z.number().optional(),
      leading: z.number().positive().optional(), auto_leading: z.boolean().optional(), baseline_shift: z.number().optional(),
      horizontal_scale: z.number().positive().optional(), vertical_scale: z.number().positive().optional(),
      faux_bold: z.boolean().optional(), faux_italic: z.boolean().optional(), all_caps: z.boolean().optional(), small_caps: z.boolean().optional(),
      superscript: z.boolean().optional(), subscript: z.boolean().optional(), ligatures: z.boolean().optional(), tsume: z.number().min(0).max(100).optional(),
      stroke_color: Color.optional(), stroke_width: z.number().min(0).optional(), stroke: z.boolean().optional(), stroke_over_fill: z.boolean().optional(), fill: z.boolean().optional(),
      justification: z.enum(["left", "center", "right", "justify", "justify_center", "justify_right", "justify_all"]).optional(),
      first_line_indent: z.number().optional(), left_indent: z.number().optional(), right_indent: z.number().optional(),
      space_before: z.number().optional(), space_after: z.number().optional(),
      box_size: Size.optional(),
    },
  );

  r.bridged(
    "get_text",
    "Read a text layer's content and styling (font, size, colors, stroke, leading, tracking, scale, caps, indents, justification, box size), at `time` (default: now).",
    { layer_id: id("Layer"), time: z.number().min(0).optional() },
    { readOnly: true },
  );

  r.bridged(
    "stagger",
    "Offset existing keyframes of one property across layers: layer i is shifted by i * offset_seconds. Spatial tangents are not preserved.",
    { layer_ids: z.array(z.number().int()).min(2), path: PropPath, offset_seconds: z.number(), order: z.enum(["forward", "reverse"]).optional() },
  );

  r.bridged(
    "add_shape_modifier",
    "Add a modifier to a shape layer's group: trim_paths (ADBE Vector Trim Start / End / Offset), repeater (ADBE Vector Repeater Copies / Offset, plus a Transform group) or round_corners (ADBE Vector RoundCorner Radius). params maps a property name or match name to a value. group_index is the 1-based shape group (default 1). Returns the modifier's property path and property names, ready for set_keyframes and list_properties.",
    { layer_id: id("Layer"), modifier: z.enum(["trim_paths", "repeater", "round_corners"]), group_index: z.number().int().min(1).optional(), params: z.record(Value).optional() },
  );
}
