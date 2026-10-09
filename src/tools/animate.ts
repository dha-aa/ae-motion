/**
 * Animation and styling tools: properties, keyframes, expressions, effects, presets, text and shape modifiers.
 * Host side: host/commands/animate.jsx and host/commands/text.jsx.
 */
import { z } from "zod";
import type { ToolRegistry } from "./registry.js";
import { Ease, id, LayerIds, PropPath, Size, TextStyleShape, Value, ValueOrShape } from "./schemas.js";

// spring / bounce: the segment to the next key is a spring (an expression on linear keys)
const Interp = z.enum(["linear", "bezier", "hold", "spring", "bounce"]);

export function registerAnimateTools(r: ToolRegistry): void {
  r.bridged(
    "set_property",
    "Set a static value, or a value at `time` (creates/updates a keyframe). Animated properties need `time`. Use set_text for text.",
    { layer_id: id("Layer"), path: PropPath, value: ValueOrShape, time: z.number().min(0).optional() },
    { idempotent: true },
  );

  r.bridged(
    "set_keyframes",
    "Replace all keys on a property. Path properties (ADBE Mask Shape, ADBE Vector Shape) take a shape spec as v; keep the vertex count the same across keys for clean morphs. interp spring/bounce springs the segment to the next key (works on any property). Fails if another expression is active.",
    {
      layer_id: id("Layer"), path: PropPath,
      keys: z.array(z.object({ t: z.number().min(0), v: ValueOrShape, interp: Interp.optional(), ease_in: Ease.optional(), ease_out: Ease.optional() })).min(1),
    },
    { idempotent: true },
  );

  r.bridged(
    "edit_keyframes",
    "Edit single keys on one property, in order, leaving the others. Address a key by t (within half a frame) or index (1-based). set creates a key at t (v or the current value) or updates one; spatial_in/out are motion-path tangents relative to the key. move keeps every setting. Returns the edited keys (get_keyframes lists all).",
    {
      layer_id: id("Layer"), path: PropPath,
      edits: z.array(z.object({
        action: z.enum(["set", "move", "delete"]),
        t: z.number().min(0).optional().describe("Key time in seconds (set creates a key here if none exists)"),
        index: z.number().int().min(1).optional().describe("1-based key index from get_keyframes (instead of t)"),
        to: z.number().min(0).optional().describe("move: new time in seconds"),
        v: ValueOrShape.optional(), interp: Interp.optional(), ease_in: Ease.optional(), ease_out: Ease.optional(),
        spatial_in: z.array(z.number()).min(2).max(3).optional().describe("Incoming motion-path tangent [x,y(,z)], relative to the key (turns auto_bezier off)"),
        spatial_out: z.array(z.number()).min(2).max(3).optional().describe("Outgoing motion-path tangent [x,y(,z)], relative to the key"),
        auto_bezier: z.boolean().optional(), continuous: z.boolean().optional(),
        roving: z.boolean().optional().describe("Let the key's time float for an even speed (not the first or last key)"),
      })).min(1),
    },
  );

  r.bridged(
    "copy_animation",
    "Copy a property's keys (with easing and tangents) or static value, plus any expression, to other layers, replacing their keys. to_path targets another property of the same type. offset_seconds shifts the keys; the i-th target also gets i * stagger_seconds.",
    {
      from_layer_id: id("Source layer"), path: PropPath, to_layer_ids: LayerIds, to_path: PropPath.optional(),
      offset_seconds: z.number().optional(), stagger_seconds: z.number().optional(),
    },
  );

  r.bridged(
    "add_property",
    "Add a property or group that set_property cannot reach until it exists. Text animator: group_path ['ADBE Text Properties','ADBE Text Animators'], match_name 'ADBE Text Animator'; then add properties under returned path + 'ADBE Text Animator Properties' (e.g. ADBE Text Opacity, ADBE Text Position 3D, ADBE Text Fill Color) and a selector under returned path + 'ADBE Text Selectors' (ADBE Text Selector). Returns the new property path.",
    { layer_id: id("Layer"), match_name: z.string(), group_path: PropPath.optional() },
    { destructive: false },
  );

  r.bridged(
    "set_expression",
    "Set an expression on a property (empty string clears it), on one layer or the same property of many (layer_ids: send a shared expression once). Returns whether After Effects accepted the syntax.",
    { layer_id: id("Layer").optional(), layer_ids: LayerIds.optional(), path: PropPath, expression: z.string() },
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
    "Set text and character/paragraph styling on a whole text layer; only the fields you pass change, and the result reads them back (skipped lists what After Effects refused). font is the PostScript name (find_fonts lists them; an uninstalled font is refused). leading turns auto leading off; stroke_color turns the stroke on; horizontal/vertical_scale in percent. box_size resizes box text (point text cannot become box text: use add_layer options.box_size). time sets a keyframe. Per-character styling: text animators (add_property).",
    {
      layer_id: id("Layer"), time: z.number().min(0).optional(), text: z.string().optional(), ...TextStyleShape,
      box_size: Size.optional(),
    },
    { idempotent: true },
  );

  r.bridged(
    "find_fonts",
    "Search the installed fonts by family, style or PostScript name (e.g. \"montserrat\", \"bold italic\"); returns PostScript names for set_text font. Needs After Effects 24.0+.",
    { query: z.string().optional().describe("Words that must all match (default: list every font)"), limit: z.number().int().min(1).max(200).default(30) },
    { readOnly: true, tooLargeHint: "Narrow the query or lower limit" },
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
    "Add trim_paths, repeater or round_corners to a shape group (group_index, default 1). params maps property names or match names to values. Returns the modifier's path and property names for set_keyframes.",
    { layer_id: id("Layer"), modifier: z.enum(["trim_paths", "repeater", "round_corners"]), group_index: z.number().int().min(1).optional(), params: z.record(Value).optional() },
    { destructive: false },
  );
}
