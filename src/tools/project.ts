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

  r.bridged(
    "open_project",
    "Open an After Effects project (.aep or .aepx, inside the allowed folders), or new: true for an empty one, replacing the open one. If the open project has unsaved changes it refuses, unless discard_unsaved is true (those changes are then lost; use save_project first to keep them). Returns the new project like get_project. Cannot be undone.",
    { path: z.string().optional(), new: z.boolean().optional(), discard_unsaved: z.boolean().optional() },
    { paths: ["path"] },
  );

  r.bridged("create_comp", "Create a composition and open it in the viewer.", {
    name: z.string(), width: dimension(), height: dimension(), fps: fps(), duration: z.number().positive(), bg_color: Color.optional(),
  },
    { destructive: false });

  r.bridged(
    "set_comp",
    "Change comp settings; only the fields you pass change. work_area must fit inside the comp. motion_blur and frame_blending are the comp switches the layer switches need to render; shutter_angle default 180.",
    {
      comp_id: id("Comp"), name: z.string().optional(), width: dimension().optional(), height: dimension().optional(),
      fps: fps().optional(), duration: z.number().positive().optional(), bg_color: Color.optional(), pixel_aspect: z.number().positive().optional(),
      work_area: z.strictObject({ start: z.number().min(0).optional(), duration: z.number().positive().optional() }).optional(),
      motion_blur: z.boolean().optional(), shutter_angle: z.number().min(0).max(720).optional(), shutter_phase: z.number().min(-360).max(360).optional(), frame_blending: z.boolean().optional(),
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
