/** Layer tools: add, edit, link, delete, duplicate, reorder, precompose. Host side: host/commands/layers.jsx. */
import { z } from "zod";
import type { ToolRegistry } from "./registry.js";
import { Color, id, Label, LayerIds, LightType, Pt, Size, V3 } from "./schemas.js";

const ShapeSpec = z.object({
  type: z.enum(["rect", "ellipse", "star", "polygon", "path"]).default("rect"),
  points: z.number().int().min(3).max(100).optional(), outer_radius: z.number().positive().optional(), inner_radius: z.number().positive().optional(),
  vertices: Pt.array().min(2).optional(), in_tangents: Pt.array().optional(), out_tangents: Pt.array().optional(), closed: z.boolean().optional(),
  size: z.array(z.number()).length(2).optional(), fill: Color.optional(), stroke: Color.optional(), stroke_width: z.number().positive().optional(),
  roundness: z.number().min(0).optional(),
});

export function registerLayerTools(r: ToolRegistry): void {
  r.bridged(
    "add_layer",
    "Add a layer (text layers take options.box_size [w,h] for box text). kind: solid | text | shape | null | adjustment | footage | precomp | camera | light. options: name, color, size, duration, text, item_id (footage/precomp), center (camera/light), position ([x,y] or [x,y,z]; three values turn 3D on), three_d, light_type (point|spot|parallel|ambient), start/in/out, shape {type: rect|ellipse|star|polygon|path, size, fill, stroke, stroke_width, roundness, points, outer_radius, inner_radius (star/polygon), vertices/in_tangents/out_tangents/closed (path)}.",
    {
      comp_id: id("Comp"),
      kind: z.enum(["solid", "text", "shape", "null", "adjustment", "footage", "precomp", "camera", "light"]),
      options: z
        .object({
          name: z.string().optional(), color: Color.optional(), size: z.array(z.number()).length(2).optional(), duration: z.number().positive().optional(),
          text: z.string().optional(), item_id: z.number().int().optional(), center: z.array(z.number()).min(2).max(3).optional(), light_type: LightType.optional(),
          start: z.number().optional(), in: z.number().optional(), out: z.number().optional(), position: V3.optional(), three_d: z.boolean().optional(),
          box_size: Size.optional(), shape: ShapeSpec.optional(),
        })
        .default({}),
    },
    { destructive: false },
  );

  r.bridged(
    "set_layer",
    "Edit a layer: name, timing (start/in/out in seconds), time stretch (percent; 200 = half speed, negative reverses), parent (parent_id, or null to unparent), blend mode name (e.g. ADD, SCREEN, MULTIPLY), visibility, and flags: three_d, shy, solo, locked, label (0-16), motion_blur (renders only with set_comp motion_blur on), time_remap, separate_dimensions (position becomes x_position / y_position / z_position, each with its own keys and easing), auto_orient (path: rotate along the motion path, or off), frame_blending (off | frame_mix | pixel_motion; smooths slowed-down footage, renders only with set_comp frame_blending on), quality (best | draft | wireframe), collapse (collapse transformations / continuously rasterize, precomp and vector layers).",
    {
      layer_id: id("Layer"), name: z.string().optional(), start: z.number().optional(), in: z.number().optional(), out: z.number().optional(),
      parent_id: z.number().int().nullable().optional(), blend_mode: z.string().optional(), enabled: z.boolean().optional(),
      stretch: z.number().refine((n) => n !== 0, "stretch cannot be 0").optional(), three_d: z.boolean().optional(), shy: z.boolean().optional(), solo: z.boolean().optional(),
      locked: z.boolean().optional(), label: Label.optional(), motion_blur: z.boolean().optional(), time_remap: z.boolean().optional(),
      separate_dimensions: z.boolean().optional(), auto_orient: z.enum(["path", "off"]).optional(),
      frame_blending: z.enum(["off", "frame_mix", "pixel_motion"]).optional(), quality: z.enum(["best", "draft", "wireframe"]).optional(), collapse: z.boolean().optional(),
    },
    { idempotent: true },
  );

  r.bridged(
    "link_layers",
    "Link (parent) layers so they follow another layer. Pass parent_id to make an existing layer the parent of every layer in layer_ids, or parent_id null to unlink them, or new_null {name?, position?, three_d?} to create a null object and parent them all to it. The null goes at the average of the layers' position values by default, is 3D if any of them is (or if position has 3 values), and is stacked above the top-most of them. Moving, rotating or scaling the parent then moves the children, so one null can drive a whole group. jump true uses setParentWithJump (the child keeps its own transform values, so it can visibly move). Everything is checked first: a self-link, a cycle, a locked layer or mixed comps change nothing.",
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

  r.bridged("precompose", "Precompose layers from the same comp into a new comp.", { layer_ids: LayerIds, name: z.string() });
}
