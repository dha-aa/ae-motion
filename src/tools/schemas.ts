/**
 * Zod schemas shared by several tool modules. Conventions: time in seconds, sizes in pixels,
 * colors [r,g,b] floats 0-1, scale in percent, coordinates x right / y down / z into the screen.
 *
 * Field descriptions are kept short on purpose: they are repeated in every tool's schema (tokens on every request).
 * The conventions themselves are stated once, in the server instructions (src/prompts.ts).
 */
import { z } from "zod";

// A missing argument says "Required" (zod 4's default is "Invalid input: expected number, received undefined").
z.config({ customError: (iss) => (iss.code === "invalid_type" && iss.input === undefined ? "Required" : undefined) });

/** An id argument; its name (layer_id, comp_id ...) says what it is, so it carries no description. */
export const id = (_what: string) => z.number().int();
export const Color = z.array(z.number().min(0).max(1)).min(3).max(4); // [r,g,b] 0-1 (server instructions)
export const Pt = z.array(z.number()).length(2); // [x,y]
export const Size = z.tuple([z.number().positive(), z.number().positive()]);
export const Time = z.number().min(0);
export const V3 = z.array(z.number()).min(2).max(3); // [x,y] or [x,y,z] px (server instructions)
export const Rot3 = z.strictObject({ x: z.number().optional(), y: z.number().optional(), z: z.number().optional() }).describe("Rotation in degrees per axis");
export const LayerIds = z.array(z.number().int()).min(1).describe("Same comp");
// an alias or a match-name path (server instructions; list_properties finds paths)
export const PropPath = z.union([z.string(), z.array(z.union([z.string(), z.number()])).min(1)]);
/** A mask or shape-layer path: rect / ellipse (position, size), polygon (points) or path (vertices + tangents). Same format get_keyframes returns. */
export const ShapeSpec = z.strictObject({
  type: z.enum(["rect", "ellipse", "polygon", "path"]),
  position: Pt.optional().describe("rect/ellipse center (default: layer center)"),
  size: Pt.optional().describe("rect/ellipse [w,h] (default: full layer)"),
  points: Pt.array().min(3).optional().describe("polygon corners"),
  vertices: Pt.array().min(2).optional().describe("path vertices"),
  in_tangents: Pt.array().optional(), out_tangents: Pt.array().optional(), closed: z.boolean().optional(),
});

/** A property value: number, boolean, string or number array (positions, scale in percent, colors 0-1). */
export const Value = z.union([z.number(), z.string(), z.boolean(), z.array(z.number())]);
/** Value, or a shape spec for path properties; only the tools that can set paths take it (it is large). */
// The shape spec is advertised by reference to add_mask (writing it out costs ~700 characters per use) but still
// fully validated: the custom check runs ShapeSpec, strict, and reports its issues.
const ShapeRef = z.record(z.string(), z.unknown()).superRefine((v, ctx) => {
  const r = ShapeSpec.safeParse(v);
  if (!r.success) for (const issue of r.error.issues) ctx.addIssue({ code: "custom", path: issue.path, message: `shape spec: ${issue.message}` });
});
export const ValueOrShape = z
  .union([z.number(), z.string(), z.boolean(), z.array(z.number()), ShapeRef])
  .describe("number, boolean, number array, or for path properties a shape spec as add_mask's shape");
export const Ease = z
  .union([z.literal("easy"), z.strictObject({ speed: z.number().default(0), influence: z.number().min(0.1).max(100).default(33.33) })])
  .describe('"easy" (easy ease) or {speed, influence}');
export const Label = z.number().int().min(0).max(16);
export const LightType = z.enum(["point", "spot", "parallel", "ambient"]);

/** A shape-layer shape (add_layer options.shape, add_shape). Stroke extras need a stroke color. */
export const ShapeLayerSpec = z.strictObject({
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

/** Anchor positions on a layer's content (set_anchor, add_layer options.anchor). */
export const Anchor = z.enum(["center", "top_left", "top", "top_right", "left", "right", "bottom_left", "bottom", "bottom_right"]);

/** set_text's character and paragraph styling (everything but the layer, time, text and box size). */
export const TextStyleShape = {
  font: z.string().optional(), size: z.number().positive().optional(), color: Color.optional(), tracking: z.number().optional(),
  leading: z.number().positive().optional(), auto_leading: z.boolean().optional(), baseline_shift: z.number().optional(),
  horizontal_scale: z.number().positive().optional(), vertical_scale: z.number().positive().optional(),
  faux_bold: z.boolean().optional(), faux_italic: z.boolean().optional(), all_caps: z.boolean().optional(), small_caps: z.boolean().optional(),
  superscript: z.boolean().optional(), subscript: z.boolean().optional(), ligatures: z.boolean().optional(), tsume: z.number().min(0).max(100).optional(),
  stroke_color: Color.optional(), stroke_width: z.number().min(0).optional(), stroke: z.boolean().optional(), stroke_over_fill: z.boolean().optional(), fill: z.boolean().optional(),
  justification: z.enum(["left", "center", "right", "justify", "justify_center", "justify_right", "justify_all"]).optional(),
  first_line_indent: z.number().optional(), left_indent: z.number().optional(), right_indent: z.number().optional(),
  space_before: z.number().optional(), space_after: z.number().optional(),
};
// Advertised by reference to set_text (writing the fields out again would cost ~1,200 characters in add_layer) but
// validated strictly against them, like ShapeRef.
const TextStyleStrict = z.strictObject(TextStyleShape);
export const TextStyleRef = z
  .record(z.string(), z.unknown())
  .superRefine((v, ctx) => {
    const r = TextStyleStrict.safeParse(v);
    if (!r.success) for (const issue of r.error.issues) ctx.addIssue({ code: "custom", path: issue.path, message: `text_style: ${issue.message}` });
  })
  .describe("set_text's styling fields (font, size, color, justification, tracking and so on)");
