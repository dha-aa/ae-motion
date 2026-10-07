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
    "Align and/or distribute 2D layers by their visible content (text glyphs, shape bounds), like the Align panel. align: left | h_center | right | top | v_center | bottom | center (both axes). to: comp (default), selection (the box around all the given layers) or layer (to_layer_id). margin insets from the target's edges in pixels. distribute: horizontal | vertical spaces the layers' centers evenly between the outermost two (3+ layers). Animated positions keep their motion (every key moves). Bounds are measured at time (default 0). 3D layers are refused (their screen position depends on the camera). Returns each layer's new bounds.",
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
    "Move a layer's anchor point onto its content: center (default), top_left, top, top_right, left, right, bottom_left, bottom or bottom_right, or point [x,y] in layer pixels. keep_position (default true) moves the layer so nothing shifts on screen. Use it before scaling or rotating text and shapes around their middle. Refuses an animated anchor point; 3D layers need zero X/Y rotation and orientation unless keep_position is false.",
    {
      layer_id: id("Layer"),
      anchor: z.enum(["center", "top_left", "top", "top_right", "left", "right", "bottom_left", "bottom", "bottom_right"]).optional(),
      point: Pt.optional(), keep_position: z.boolean().optional(), time: Time.optional(),
    },
    { idempotent: true },
  );

  r.bridged(
    "add_shape",
    "Add another shape group to an existing shape layer, on top of its other shapes: rect, ellipse, star, polygon or path, with fill and/or stroke, fill_opacity / stroke_opacity, dashes [dash, gap, ...], line_cap (butt|round|square), line_join (miter|round|bevel), and a group name, position (offset inside the layer), rotation and opacity. Returns the group's path (and, for paths, the path property to animate with set_keyframes). Gradient colors cannot be set from scripts, so gradients are not offered.",
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
    "Turn on a layer style and set its parameters: drop_shadow, inner_shadow, outer_glow, inner_glow, bevel_emboss, satin, color_overlay, gradient_overlay or stroke. params maps parameter names (without the style prefix, e.g. distance, size, opacity, color, blur) to values; the response lists every parameter name, and path + \"<style>/<name>\" is the property path for set_property / set_keyframes. enabled: false turns the style off again (styles cannot be deleted by script). Uses the Layer Styles menu, so it opens the comp in the viewer and changes the selection.",
    {
      layer_id: id("Layer"),
      style: z.enum(["drop_shadow", "inner_shadow", "outer_glow", "inner_glow", "bevel_emboss", "satin", "color_overlay", "gradient_overlay", "stroke"]),
      params: z.record(Value).optional(), enabled: z.boolean().optional(),
    },
    { idempotent: true },
  );
}
