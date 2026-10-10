/** Read-only inspection tools. Host side: host/commands/inspect.jsx. */
import { z } from "zod";
import { knownUpdate } from "../update.js";
import { fromBridge, json, type ToolRegistry } from "./registry.js";
import { id, PropPath } from "./schemas.js";

export function registerInspectTools(r: ToolRegistry): void {
  const ro = { readOnly: true };

  r.tool(
    "get_project",
    "List project items (comps, footage, folders), the active comp id, AE version and project path. When a newer ae-motion-mcp version is known, the result also has an update field (current, latest, how to update): tell the user.",
    {},
    async () => {
      const res = await r.deps.bridge.run("get_project", {});
      const update = knownUpdate();
      return res.ok && update?.update_available ? json({ ...res.result, update }) : fromBridge(res);
    },
    ro,
  );

  r.bridged(
    "get_comp",
    "Get composition settings and its layers, top first (id, name, kind, non-default in/out/start, parent, blend mode, flags). Big comps: filter by name (substring), kind or at (seconds: layers visible then), page with limit (default 150) / offset; kinds counts all layers.",
    {
      comp_id: id("Comp"), name: z.string().optional(), kind: z.enum(["text", "shape", "solid", "footage", "precomp", "null", "adjustment", "camera", "light"]).optional(),
      at: z.number().min(0).optional(), limit: z.number().int().min(1).max(500).optional(), offset: z.number().int().min(0).optional(),
    },
    ro,
  );

  r.bridged(
    "get_layer",
    "Get a layer (or several: layer_ids): transform values, text, effects, expressions, marker count, masks, track matte, bounds (content: its layer-space box; comp: its place in the comp, null for 3D). Values at `time` (default 0).",
    { layer_id: id("Layer").optional(), layer_ids: z.array(z.number().int()).min(1).optional(), time: z.number().min(0).optional() },
    { ...ro, tooLargeHint: "Pass fewer layer_ids" },
  );

  r.bridged(
    "list_properties",
    "Walk a layer's property tree and return names, match names, value types, values, keyframe counts and expressions. Use it to find property paths before set_property / set_keyframes.",
    { layer_id: id("Layer"), group_path: PropPath.optional(), depth: z.number().int().min(1).max(6).optional(), time: z.number().min(0).optional(), all: z.boolean().optional().describe("Also markers, empty groups, unused layer styles, 3D options on 2D layers, full expressions") },
    { ...ro, tooLargeHint: "Pass group_path to list one group (e.g. [\"ADBE Transform Group\"]) and/or a smaller depth" },
  );

  r.bridged(
    "get_keyframes",
    "Read all keyframes of one property: time, value, in/out interpolation and temporal ease, plus any active expression; unanimated, its value. Use list_properties to find the path.",
    { layer_id: id("Layer"), path: PropPath },
    ro,
  );

  r.bridged("find_effects", "Search installed effects by display name, match name or category (max 50).", { query: z.string() }, ro);
}
