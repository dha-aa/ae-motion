/** Mask and track matte tools. Host side: host/commands/masks.jsx. */
import { z } from "zod";
import type { ToolRegistry } from "./registry.js";
import { id, Pt, ShapeSpec } from "./schemas.js";

export function registerMaskTools(r: ToolRegistry): void {
  r.bridged(
    "add_mask",
    "Add a mask. rect/ellipse use position and size in layer px (default full layer). feather in px (feather_xy for x and y). Returns the mask's path; animate ADBE Mask Shape / Feather / Opacity / Offset under it with set_keyframes.",
    {
      layer_id: id("Layer"), shape: ShapeSpec, mode: z.enum(["add", "subtract", "intersect", "lighten", "darken", "difference", "none"]).optional(),
      inverted: z.boolean().optional(), feather: z.number().min(0).optional(), feather_xy: Pt.optional(), opacity: z.number().min(0).max(100).optional(),
      expansion: z.number().optional(), name: z.string().optional(),
    },
    { destructive: false },
  );

  r.bridged(
    "set_track_matte",
    "Use one layer as the track matte of another. matte_layer_id is the layer that acts as the matte, or null to remove the matte. type: alpha (default) | alpha_inverted | luma | luma_inverted.",
    {
      layer_id: id("Layer"), matte_layer_id: z.number().int().nullable().describe("Matte layer id, or null to remove the matte"),
      type: z.enum(["alpha", "alpha_inverted", "luma", "luma_inverted"]).optional(),
    },
    { idempotent: true },
  );
}
