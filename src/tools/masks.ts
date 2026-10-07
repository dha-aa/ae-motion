/** Mask and track matte tools. Host side: host/commands/masks.jsx. */
import { z } from "zod";
import type { ToolRegistry } from "./registry.js";
import { id, Pt } from "./schemas.js";

const MaskShape = z.object({
  type: z.enum(["rect", "ellipse", "polygon", "path"]),
  position: Pt.optional().describe("Center in layer pixels (rect/ellipse; default: layer center)"),
  size: Pt.optional().describe("[width,height] in pixels (rect/ellipse; default: full layer)"),
  points: Pt.array().min(3).optional().describe("Corner points in layer pixels (polygon)"),
  vertices: Pt.array().min(2).optional().describe("Path vertices in layer pixels (path)"),
  in_tangents: Pt.array().optional(), out_tangents: Pt.array().optional(), closed: z.boolean().optional(),
});

export function registerMaskTools(r: ToolRegistry): void {
  r.bridged(
    "add_mask",
    "Add a mask to a layer. shape: rect or ellipse (position and size in layer pixels, default full layer), polygon (points) or path (vertices with optional tangents). mode: add | subtract | intersect | lighten | darken | difference | none. feather is a uniform blur in pixels (feather_xy sets x and y separately). Returns the mask's property path; animate its ADBE Mask Shape, ADBE Mask Feather, ADBE Mask Opacity or ADBE Mask Offset with set_keyframes using that path plus the match name.",
    {
      layer_id: id("Layer"), shape: MaskShape, mode: z.enum(["add", "subtract", "intersect", "lighten", "darken", "difference", "none"]).optional(),
      inverted: z.boolean().optional(), feather: z.number().min(0).optional(), feather_xy: Pt.optional(), opacity: z.number().min(0).max(100).optional(),
      expansion: z.number().optional(), name: z.string().optional(),
    },
  );

  r.bridged(
    "set_track_matte",
    "Use one layer as the track matte of another. matte_layer_id is the layer that acts as the matte, or null to remove the matte. type: alpha (default) | alpha_inverted | luma | luma_inverted.",
    {
      layer_id: id("Layer"), matte_layer_id: z.number().int().nullable().describe("Matte layer id, or null to remove the matte"),
      type: z.enum(["alpha", "alpha_inverted", "luma", "luma_inverted"]).optional(),
    },
  );
}
