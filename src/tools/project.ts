/** Project and composition tools. Host side: host/commands/project.jsx. */
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { AeToolError } from "../errors.js";
import { assertAllowed, toAe } from "../sandbox.js";
import { fromBridge, json, type ToolRegistry } from "./registry.js";
import { Color, FolderRef, id, InterpretShape } from "./schemas.js";

// Factories rather than shared instances: a zod schema reused within one object is emitted as a JSON Schema $ref.
const dimension = () => z.number().int().min(1).max(30000);
const fps = () => z.number().min(1).max(120);

/** Copy the saved project to snapshots/<name>_NNN[_note].aep next to it; the number counts up from the last copy. */
export function snapshot(proj: string, note?: string): { snapshot: string; snapshots: number } {
  const dir = path.join(path.dirname(proj), "snapshots");
  fs.mkdirSync(dir, { recursive: true });
  const ext = path.extname(proj), base = path.basename(proj, ext);
  const nums = fs.readdirSync(dir)
    .filter((f) => f.startsWith(base + "_"))
    .map((f) => Number(/^(\d+)/.exec(f.slice(base.length + 1))?.[1] ?? NaN))
    .filter((x) => Number.isFinite(x));
  const n = (nums.length ? Math.max(...nums) : 0) + 1;
  const slug = note ? "_" + note.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) : "";
  const dest = assertAllowed(path.join(dir, `${base}_${String(n).padStart(3, "0")}${slug}${ext}`));
  fs.copyFileSync(proj, dest);
  return { snapshot: dest, snapshots: nums.length + 1 };
}

export function registerProjectTools(r: ToolRegistry): void {
  r.tool(
    "save_project",
    "Save the project. With path it does Save As (.aep or .aepx, inside the allowed folders; pass overwrite to replace an existing file). Without path it saves in place, which needs a project that has been saved once. render_start needs a saved project. clean: true first removes footage no comp uses (removed_footage counts it). snapshot: true also keeps a numbered copy in snapshots/ next to the project (note labels it); open_project on that copy goes back to it exactly.",
    { path: z.string().optional(), overwrite: z.boolean().optional(), clean: z.boolean().optional(), snapshot: z.boolean().optional(), note: z.string().max(60).optional() },
    async (a) => {
      const args: Record<string, unknown> = {};
      if (a.path !== undefined) args.path = toAe(assertAllowed(a.path));
      if (a.overwrite !== undefined) args.overwrite = a.overwrite;
      if (a.clean !== undefined) args.clean = a.clean;
      const res = await r.deps.bridge.run("save_project", args);
      if (!res.ok || a.snapshot !== true) return fromBridge(res);
      const proj = (res.result as { project_path: string | null }).project_path;
      if (!proj || !fs.existsSync(proj)) throw new AeToolError("AE_ERROR", "The project was saved but its file was not found", "Save it with a path first");
      return json({ ...(res.result as object), ...snapshot(proj, a.note) });
    },
    { idempotent: false },
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
    "Import a file, or several (paths), into the project. as: sequence (path is its first frame), comp / comp_cropped (a layered PSD or Illustrator file as a comp of its layers). fps, loop and alpha set the footage's interpretation (set_item changes them later). folder files the imports. All files are checked before any is imported.",
    {
      path: z.string().optional(), paths: z.array(z.string()).min(1).max(50).optional(),
      as: z.enum(["footage", "sequence", "comp", "comp_cropped"]).optional(), ...InterpretShape, folder: FolderRef.optional(), name: z.string().optional(),
    },
    { paths: ["path", "paths"], destructive: false },
  );

  r.bridged(
    "set_item",
    "Change a project item (comp, footage or folder): name, comment, label (0-16), folder (null: top level); footage interpretation (fps, loop, alpha); file swaps the footage's file for every layer that uses it (sequence: file is a sequence's first frame).",
    {
      item_id: id("Item"), name: z.string().optional(), comment: z.string().optional(), label: z.number().int().min(0).max(16).optional(),
      folder: FolderRef.nullable().optional(), ...InterpretShape, file: z.string().optional(), sequence: z.boolean().optional(),
    },
    { paths: ["file"], idempotent: true },
  );

  r.bridged(
    "delete_item",
    "Delete a project item (comp, footage or folder) by id. Refuses items that are used in comps, and non-empty folders, unless force is true (force also deletes the layers that use the item).",
    { item_id: id("Item"), force: z.boolean().optional() },
    { idempotent: true },
  );
}
