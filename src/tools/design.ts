/**
 * Design tools: layout (align, distribute, anchor points), shapes, layer styles and text-to-shapes.
 * Host side: host/commands/design.jsx (geometry in host/core/layout.jsx).
 */
import { z } from "zod";
import type { ToolRegistry } from "./registry.js";
import { id, LayerIds, Pt, ShapeLayerSpec, Time, Value } from "./schemas.js";

export function registerDesignTools(r: ToolRegistry): void {
  r.bridged(
    "align_layers",
    "Align and/or distribute 2D layers by their visible content, like the Align panel. to: comp (default), selection (box around the layers) or layer (to_layer_id). margin insets from the target's edges. distribute spaces centers evenly between the outermost two (3+ layers). Animated positions keep their motion. Bounds measured at time (default 0). 3D layers are refused. Returns the new bounds.",
    {
      layer_ids: LayerIds,
      align: z.enum(["left", "h_center", "right", "top", "v_center", "bottom", "center"]).optional(),
      to: z.enum(["comp", "selection", "layer"]).optional(), to_layer_id: z.number().int().optional(),
      distribute: z.enum(["horizontal", "vertical"]).optional(), margin: z.number().optional(), time: Time.optional(),
    },
    { idempotent: true },
  );

  r.bridged(
    "set_anchor",
    "Move a layer's anchor point onto its content (anchor: center by default, top_left and so on) or to point [x,y] in layer px. keep_position (default true) keeps it in place on screen. Refuses an animated anchor; 3D layers need zero X/Y rotation unless keep_position is false.",
    {
      layer_id: id("Layer"),
      anchor: z.enum(["center", "top_left", "top", "top_right", "left", "right", "bottom_left", "bottom", "bottom_right"]).optional(),
      point: Pt.optional(), keep_position: z.boolean().optional(), time: Time.optional(),
    },
    { idempotent: true },
  );

  r.bridged(
    "add_shape",
    "Add a shape group on top of an existing shape layer's shapes, with fill and/or stroke. position is the offset inside the layer. Returns the group's path (and a path shape's property, to animate with set_keyframes). Gradients cannot be set by script.",
    { layer_id: id("Shape layer"), shape: ShapeLayerSpec },
    { destructive: false },
  );

  r.bridged(
    "text_to_shapes",
    "Convert a text layer into a shape layer of letter outlines (Layer > Create > Create Shapes from Text): the new layer appears above and the text layer is turned off. Each character becomes a group whose paths can be animated with set_keyframes / add_shape_modifier. Opens the comp in the viewer and changes the layer selection.",
    { layer_id: id("Text layer") },
    { destructive: false },
  );

  r.bridged(
    "add_layer_style",
    "Turn on a layer style and set its params (names without the style prefix, e.g. distance, size, opacity, color). The response lists every param name; path + '<style>/<name>' is the property path for set_property / set_keyframes. enabled false turns it off (styles cannot be deleted). Opens the comp in the viewer and changes the selection.",
    {
      layer_id: id("Layer"),
      style: z.enum(["drop_shadow", "inner_shadow", "outer_glow", "inner_glow", "bevel_emboss", "satin", "color_overlay", "gradient_overlay", "stroke"]),
      params: z.record(Value).optional(), enabled: z.boolean().optional(),
    },
    { idempotent: true },
  );
}
