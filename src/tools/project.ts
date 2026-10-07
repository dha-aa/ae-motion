/** Project and composition tools. Host side: host/commands/project.jsx. */
import { z } from "zod";
import type { ToolRegistry } from "./registry.js";
import { Color, id } from "./schemas.js";

// Factories rather than shared instances: a zod schema reused within one object is emitted as a JSON Schema $ref.
const dimension = () => z.number().int().min(1).max(30000);
const fps = () => z.number().min(1).max(120);

export function registerProjectTools(r: ToolRegistry): void {
  r.bridged(
    "save_project",
    "Save the project. With path it does Save As (.aep or .aepx, inside the allowed folders; pass overwrite to replace an existing file). Without path it saves in place, which needs a project that has been saved once. render_start needs a saved project.",
    { path: z.string().optional(), overwrite: z.boolean().optional() },
    { paths: ["path"], idempotent: true },
  );

  r.bridged("create_comp", "Create a composition and open it in the viewer.", {
    name: z.string(), width: dimension(), height: dimension(), fps: fps(), duration: z.number().positive(), bg_color: Color.optional(),
  },
    { destructive: false });

  r.bridged(
    "set_comp",
    "Change composition settings. Only the fields you pass change: name, width, height, fps, duration, bg_color, pixel_aspect and work_area ({start, duration} in seconds, must fit inside the comp).",
    {
      comp_id: id("Comp"), name: z.string().optional(), width: dimension().optional(), height: dimension().optional(),
      fps: fps().optional(), duration: z.number().positive().optional(), bg_color: Color.optional(), pixel_aspect: z.number().positive().optional(),
      work_area: z.object({ start: z.number().min(0).optional(), duration: z.number().positive().optional() }).optional(),
    },
    { idempotent: true },
  );

  r.bridged(
    "import_footage",
    "Import a file (or an image sequence) into the project. Path must be inside the allowed folders.",
    { path: z.string(), as: z.enum(["footage", "sequence"]).optional() },
    { paths: ["path"], destructive: false },
  );

  r.bridged(
    "delete_item",
    "Delete a project item (comp, footage or folder) by id. Refuses items that are used in comps, and non-empty folders, unless force is true (force also deletes the layers that use the item).",
    { item_id: id("Item"), force: z.boolean().optional() },
    { idempotent: true },
  );
}
