/** Layer tools: add, edit, link, delete, duplicate, reorder, precompose. Host side: host/commands/layers.jsx. */
import { z } from "zod";
import type { ToolRegistry } from "./registry.js";
import { Anchor, Color, id, Label, LayerIds, LightType, ShapeLayerSpec, Size, TextStyleRef, V3 } from "./schemas.js";

export function registerLayerTools(r: ToolRegistry): void {
  r.bridged(
    "add_layer",
    "Add a layer. item_id: footage/precomp source. center: camera/light. position with 3 values turns 3D on. box_size: box text; text_style as set_text. anchor moves the anchor onto the content (as set_anchor) before position, so position places e.g. the text's center. shape: a shape layer's first shape (as add_shape). fit_to (shape): a rect that keeps fitting that layer's content + padding (a highlight behind text).",
    {
      comp_id: id("Comp"),
      kind: z.enum(["solid", "text", "shape", "null", "adjustment", "footage", "precomp", "camera", "light"]),
      options: z
        .object({
          name: z.string().optional(), color: Color.optional(), size: z.array(z.number()).length(2).optional(), duration: z.number().positive().optional(),
          text: z.string().optional(), item_id: z.number().int().optional(), center: z.array(z.number()).min(2).max(3).optional(), light_type: LightType.optional(),
          start: z.number().optional(), in: z.number().optional(), out: z.number().optional(), position: V3.optional(), three_d: z.boolean().optional(),
          box_size: Size.optional(), text_style: TextStyleRef.optional(), anchor: Anchor.optional(), shape: ShapeLayerSpec.optional(),
          fit_to: z.object({ layer_id: z.number().int(), padding: z.union([z.number(), z.array(z.number()).length(2)]).optional() }).optional(),
        })
        .default({}),
    },
    { destructive: false },
  );

  r.bridged(
    "set_layer",
    "Edit a layer; only the fields you pass change. stretch: percent (200 = half speed, negative reverses). parent_id null unparents. blend_mode: e.g. ADD, SCREEN. motion_blur / frame_blending need the switch in set_comp too. separate_dimensions: x_position / y_position / z_position. auto_orient path: along the motion path. collapse: continuously rasterize. guide: not rendered. sampling bicubic: sharper scaled images. solid_color / solid_size change the solid item (every layer using it).",
    {
      layer_id: id("Layer"), name: z.string().optional(), start: z.number().optional(), in: z.number().optional(), out: z.number().optional(),
      parent_id: z.number().int().nullable().optional(), blend_mode: z.string().optional(), enabled: z.boolean().optional(),
      stretch: z.number().refine((n) => n !== 0, "stretch cannot be 0").optional(), three_d: z.boolean().optional(), shy: z.boolean().optional(), solo: z.boolean().optional(),
      locked: z.boolean().optional(), label: Label.optional(), motion_blur: z.boolean().optional(), time_remap: z.boolean().optional(),
      separate_dimensions: z.boolean().optional(), auto_orient: z.enum(["path", "off"]).optional(),
      frame_blending: z.enum(["off", "frame_mix", "pixel_motion"]).optional(), quality: z.enum(["best", "draft", "wireframe"]).optional(), sampling: z.enum(["bilinear", "bicubic"]).optional(), collapse: z.boolean().optional(),
      guide: z.boolean().optional(), adjustment: z.boolean().optional(), effects: z.boolean().optional(), audio: z.boolean().optional(), preserve_transparency: z.boolean().optional(),
      solid_color: Color.optional(), solid_size: Size.optional(),
    },
    { idempotent: true },
  );

  r.bridged(
    "link_layers",
    "Parent layer_ids to parent_id (null unlinks), or to a new_null created at their average position (3D if any of them is), stacked above them. jump true keeps each child's own transform values (it can visibly move). Self-links, cycles, locked layers or mixed comps are refused before anything changes.",
    {
      layer_ids: LayerIds, parent_id: z.number().int().nullable().optional(),
      new_null: z.object({ name: z.string().optional(), position: V3.optional(), three_d: z.boolean().optional() }).optional(), jump: z.boolean().optional(),
    },
  );

  r.bridged(
    "replace_source",
    "Swap the footage, comp or solid a layer shows for another project item (like Alt/Option-dragging onto it), keeping the layer's timing, keyframes, masks and effects. fix_expressions (default true) updates expressions that referred to the old source. Works on footage, precomp, solid and null layers.",
    { layer_id: id("Layer"), item_id: id("Footage or comp item"), fix_expressions: z.boolean().optional() },
    { idempotent: true },
  );

  r.bridged("delete_layer", "Delete a layer.", { layer_id: id("Layer") }, { idempotent: true });

  r.bridged(
    "duplicate_layer",
    "Duplicate a layer (the copy sits above the original). count makes several copies; offset_seconds shifts copy N later in time by N * offset_seconds.",
    { layer_id: id("Layer"), count: z.number().int().min(1).max(50).optional(), name: z.string().optional(), offset_seconds: z.number().optional() },
    { destructive: false },
  );

  r.bridged(
    "reorder_layer",
    "Change a layer's stacking order. Pass exactly one of: to (top | bottom | up | down), index (1 = top), before_layer_id, after_layer_id. Before means above in the stack.",
    {
      layer_id: id("Layer"), to: z.enum(["top", "bottom", "up", "down"]).optional(), index: z.number().int().min(1).optional(),
      before_layer_id: z.number().int().optional(), after_layer_id: z.number().int().optional(),
    },
  );

  r.bridged(
    "precompose",
    "Precompose layers from the same comp into a new comp. move_attributes (default true) moves their transforms, effects and masks into the new comp; false (\"leave all attributes\", one footage, solid or precomp layer only) keeps them on the layer in the current comp.",
    { layer_ids: LayerIds, name: z.string(), move_attributes: z.boolean().optional() },
  );
}
