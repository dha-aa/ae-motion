/**
 * Animation and styling tools: properties, keyframes, expressions, effects, presets, text and shape modifiers.
 * Host side: host/commands/animate.jsx and host/commands/text.jsx.
 */
import { z } from "zod";
import type { ToolRegistry } from "./registry.js";
import { Color, Ease, id, LayerIds, PropPath, Size, Value, ValueOrShape } from "./schemas.js";

export function registerAnimateTools(r: ToolRegistry): void {
  r.bridged(
    "set_property",
    "Set a static value, or a value at `time` (creates/updates a keyframe). Animated properties need `time`. Use set_text for text.",
    { layer_id: id("Layer"), path: PropPath, value: ValueOrShape, time: z.number().min(0).optional() },
    { idempotent: true },
  );

  r.bridged(
    "set_keyframes",
    "Replace all keyframes on a property. Each key: {t, v, interp?: linear|bezier|hold, ease_in?, ease_out?}. For path properties (ADBE Mask Shape, a shape layer's ADBE Vector Shape) v is a shape spec ({type: rect|ellipse, position?, size?}, {type: polygon, points} or {type: path, vertices, in_tangents?, out_tangents?, closed?}); keep the same vertex count across keys for a clean morph. Fails if the property has an active expression.",
    {
      layer_id: id("Layer"), path: PropPath,
      keys: z.array(z.object({ t: z.number().min(0), v: ValueOrShape, interp: z.enum(["linear", "bezier", "hold"]).optional(), ease_in: Ease.optional(), ease_out: Ease.optional() })).min(1),
    },
    { idempotent: true },
  );

  r.bridged(
    "edit_keyframes",
    "Edit single keys on one property without rewriting the others; edits run in order. Address a key by t (seconds; matches a key within half a frame) or index (1-based, from get_keyframes). action set: create a key at t (v, or the current value) or update one (v, interp, ease_in, ease_out; spatial properties such as position also take spatial_in / spatial_out motion-path tangents relative to the key, auto_bezier, continuous and roving). action move: move a key to `to` seconds, keeping every setting. action delete: remove a key. Returns all keys as get_keyframes does.",
    {
      layer_id: id("Layer"), path: PropPath,
      edits: z.array(z.object({
        action: z.enum(["set", "move", "delete"]),
        t: z.number().min(0).optional().describe("Key time in seconds (set creates a key here if none exists)"),
        index: z.number().int().min(1).optional().describe("1-based key index from get_keyframes (instead of t)"),
        to: z.number().min(0).optional().describe("move: new time in seconds"),
        v: ValueOrShape.optional(), interp: z.enum(["linear", "bezier", "hold"]).optional(), ease_in: Ease.optional(), ease_out: Ease.optional(),
        spatial_in: z.array(z.number()).min(2).max(3).optional().describe("Incoming motion-path tangent [x,y(,z)], relative to the key (turns auto_bezier off)"),
        spatial_out: z.array(z.number()).min(2).max(3).optional().describe("Outgoing motion-path tangent [x,y(,z)], relative to the key"),
        auto_bezier: z.boolean().optional(), continuous: z.boolean().optional(),
        roving: z.boolean().optional().describe("Let the key's time float for an even speed (not the first or last key)"),
      })).min(1),
    },
  );

  r.bridged(
    "copy_animation",
    "Copy one property's animation from a layer to other layers: every key with its interpolation, easing and motion-path tangents (or the static value), plus any expression. The targets' existing keys on that property are replaced. to_path copies onto a different property of the same value type (default: the same path). offset_seconds moves the keys in time; stagger_seconds adds i * stagger_seconds for the i-th target.",
    {
      from_layer_id: id("Source layer"), path: PropPath, to_layer_ids: LayerIds, to_path: PropPath.optional(),
      offset_seconds: z.number().optional(), stagger_seconds: z.number().optional(),
    },
  );

  r.bridged(
    "add_property",
    "Add a property or group to a layer, for things set_property cannot reach until they exist. Text animator: group_path ['ADBE Text Properties','ADBE Text Animators'], match_name ADBE Text Animator; then add properties with group_path = returned path + 'ADBE Text Animator Properties' (match_name ADBE Text Position 3D, ADBE Text Opacity, ADBE Text Fill Color, ADBE Text Tracking Amount...) and a range selector with group_path = returned path + 'ADBE Text Selectors', match_name ADBE Text Selector. Layer styles cannot be created by scripts in After Effects, so they are not supported. Returns the new property path for set_property / set_keyframes.",
    { layer_id: id("Layer"), match_name: z.string(), group_path: PropPath.optional() },
    { destructive: false },
  );

  r.bridged(
    "set_expression",
    "Set an expression on a property (empty string clears it). Returns whether After Effects accepted the syntax.",
    { layer_id: id("Layer"), path: PropPath, expression: z.string() },
    { idempotent: true },
  );

  r.bridged(
    "apply_effect",
    "Add an effect by match name (see find_effects) and set parameters by name, match name or 1-based index. If any parameter fails the effect is removed.",
    { layer_id: id("Layer"), match_name: z.string(), name: z.string().optional(), params: z.record(Value).optional() },
    { destructive: false },
  );

  r.bridged(
    "edit_effect",
    "Remove, enable or disable an effect on a layer by its 1-based index (see get_layer for the list).",
    { layer_id: id("Layer"), effect_index: z.number().int().min(1), action: z.enum(["remove", "enable", "disable"]) },
    { idempotent: true },
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
    { idempotent: true },
  );

  r.bridged(
    "get_text",
    "Read a text layer's content and styling (font, size, colors, stroke, leading, tracking, scale, caps, indents, justification, box size), at `time` (default: now).",
    { layer_id: id("Layer"), time: z.number().min(0).optional() },
    { readOnly: true },
  );

  r.bridged(
    "stagger",
    "Offset existing keyframes of one property across layers: layer i is shifted by i * offset_seconds. Every key setting (easing, motion-path tangents) is kept.",
    { layer_ids: z.array(z.number().int()).min(2), path: PropPath, offset_seconds: z.number(), order: z.enum(["forward", "reverse"]).optional() },
  );

  r.bridged(
    "add_shape_modifier",
    "Add a modifier to a shape layer's group: trim_paths (ADBE Vector Trim Start / End / Offset), repeater (ADBE Vector Repeater Copies / Offset, plus a Transform group) or round_corners (ADBE Vector RoundCorner Radius). params maps a property name or match name to a value. group_index is the 1-based shape group (default 1). Returns the modifier's property path and property names, ready for set_keyframes and list_properties.",
    { layer_id: id("Layer"), modifier: z.enum(["trim_paths", "repeater", "round_corners"]), group_index: z.number().int().min(1).optional(), params: z.record(Value).optional() },
    { destructive: false },
  );
}
