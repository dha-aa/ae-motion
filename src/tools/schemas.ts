/**
 * Zod schemas shared by several tool modules. Conventions: time in seconds, sizes in pixels,
 * colors [r,g,b] floats 0-1, scale in percent, coordinates x right / y down / z into the screen.
 */
import { z } from "zod";

export const id = (what: string) => z.number().int().describe(`${what} id (from get_project / get_comp)`);
export const Color = z.array(z.number().min(0).max(1)).min(3).max(4).describe("[r,g,b] floats 0-1");
export const Pt = z.array(z.number()).length(2).describe("[x,y]");
export const Size = z.tuple([z.number().positive(), z.number().positive()]);
export const Time = z.number().min(0);
export const V3 = z
  .array(z.number())
  .min(2)
  .max(3)
  .describe("[x,y] or [x,y,z] in pixels (x right, y down, z into the screen; a camera in front of the comp has negative z)");
export const Rot3 = z.object({ x: z.number().optional(), y: z.number().optional(), z: z.number().optional() }).describe("Rotation in degrees per axis");
export const LayerIds = z.array(z.number().int()).min(1).describe("Layer ids, all from the same comp");
export const PropPath = z
  .union([z.string(), z.array(z.union([z.string(), z.number()])).min(1)])
  .describe(
    'Alias (position|scale|rotation|opacity|anchor) or an array of match names, e.g. ["ADBE Effect Parade","ADBE Gaussian Blur 2","ADBE Gaussian Blur 2-0001"]. Use list_properties to discover paths.',
  );
export const Value = z
  .union([z.number(), z.string(), z.boolean(), z.array(z.number())])
  .describe("Number, boolean, or number array (position [x,y], scale [x,y] in percent, color [r,g,b] 0-1)");
export const Ease = z
  .union([z.literal("easy"), z.object({ speed: z.number().default(0), influence: z.number().min(0.1).max(100).default(33.33) })])
  .describe('"easy" (easy ease) or {speed, influence}');
export const Label = z.number().int().min(0).max(16);
export const LightType = z.enum(["point", "spot", "parallel", "ambient"]);
