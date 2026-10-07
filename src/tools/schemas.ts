/**
 * Zod schemas shared by several tool modules. Conventions: time in seconds, sizes in pixels,
 * colors [r,g,b] floats 0-1, scale in percent, coordinates x right / y down / z into the screen.
 *
 * Field descriptions are kept short on purpose: they are repeated in every tool's schema (tokens on every request).
 * The conventions themselves are stated once, in the server instructions (src/prompts.ts).
 */
import { z } from "zod";

export const id = (what: string) => z.number().int().describe(`${what} id`);
export const Color = z.array(z.number().min(0).max(1)).min(3).max(4).describe("[r,g,b] floats 0-1");
export const Pt = z.array(z.number()).length(2).describe("[x,y]");
export const Size = z.tuple([z.number().positive(), z.number().positive()]);
export const Time = z.number().min(0);
export const V3 = z
  .array(z.number())
  .min(2)
  .max(3)
  .describe("[x,y] or [x,y,z] px");
export const Rot3 = z.object({ x: z.number().optional(), y: z.number().optional(), z: z.number().optional() }).describe("Rotation in degrees per axis");
export const LayerIds = z.array(z.number().int()).min(1).describe("Layer ids, all from the same comp");
export const PropPath = z
  .union([z.string(), z.array(z.union([z.string(), z.number()])).min(1)])
  .describe("Property alias or match-name path (see list_properties)");
/** A mask or shape-layer path: rect / ellipse (position, size), polygon (points) or path (vertices + tangents). Same format get_keyframes returns. */
export const ShapeSpec = z.object({
  type: z.enum(["rect", "ellipse", "polygon", "path"]),
  position: Pt.optional().describe("rect/ellipse center (default: layer center)"),
  size: Pt.optional().describe("rect/ellipse [w,h] (default: full layer)"),
  points: Pt.array().min(3).optional().describe("polygon corners"),
  vertices: Pt.array().min(2).optional().describe("path vertices"),
  in_tangents: Pt.array().optional(), out_tangents: Pt.array().optional(), closed: z.boolean().optional(),
});

/** A property value: number, boolean, string or number array (positions, scale in percent, colors 0-1). */
export const Value = z.union([z.number(), z.string(), z.boolean(), z.array(z.number())]).describe("number, boolean or number array");
/** Value, or a shape spec for path properties; only the tools that can set paths take it (it is large). */
export const ValueOrShape = z
  .union([z.number(), z.string(), z.boolean(), z.array(z.number()), ShapeSpec])
  .describe("number, boolean, number array, or a shape spec for path properties (mask / shape paths)");
export const Ease = z
  .union([z.literal("easy"), z.object({ speed: z.number().default(0), influence: z.number().min(0.1).max(100).default(33.33) })])
  .describe('"easy" (easy ease) or {speed, influence}');
export const Label = z.number().int().min(0).max(16);
export const LightType = z.enum(["point", "spot", "parallel", "ambient"]);

/** A shape-layer shape (add_layer options.shape, add_shape). Stroke extras need a stroke color. */
export const ShapeLayerSpec = z.object({
  type: z.enum(["rect", "ellipse", "star", "polygon", "path"]).default("rect"),
  points: z.number().int().min(3).max(100).optional(), outer_radius: z.number().positive().optional(), inner_radius: z.number().positive().optional(),
  vertices: Pt.array().min(2).optional(), in_tangents: Pt.array().optional(), out_tangents: Pt.array().optional(), closed: z.boolean().optional(),
  size: z.array(z.number()).length(2).optional(), fill: Color.optional(), stroke: Color.optional(), stroke_width: z.number().positive().optional(),
  roundness: z.number().min(0).optional(),
  fill_opacity: z.number().min(0).max(100).optional(), stroke_opacity: z.number().min(0).max(100).optional(),
  dashes: z.array(z.number().min(0)).min(1).max(6).optional().describe("Dash pattern [dash, gap, dash, gap, ...] in pixels, up to 3 pairs"),
  line_cap: z.enum(["butt", "round", "square"]).optional(), line_join: z.enum(["miter", "round", "bevel"]).optional(),
  name: z.string().optional(), position: Pt.optional().describe("Offset of the shape inside the layer, [x,y]"),
  rotation: z.number().optional(), opacity: z.number().min(0).max(100).optional(),
});
