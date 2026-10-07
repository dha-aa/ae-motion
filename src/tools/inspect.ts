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
    "Get composition settings (size, fps, duration, work area, playhead time, marker count) and its layers (id, name, kind, in/out/start, parent, flags).",
    { comp_id: id("Comp") },
    ro,
  );

  r.bridged(
    "get_layer",
    "Get a layer's transform values, effects, layers with expressions, marker count, masks (mode, inverted), track matte and bounds (content: the layer-space box of its text/shapes/pixels; comp: where that box sits in the comp, null for 3D layers). Values are read at `time` (default 0).",
    { layer_id: id("Layer"), time: z.number().min(0).optional() },
    ro,
  );

  r.bridged(
    "list_properties",
    "Walk a layer's property tree and return names, match names, value types, values, keyframe counts and expressions. Use it to find property paths before set_property / set_keyframes.",
    { layer_id: id("Layer"), group_path: PropPath.optional(), depth: z.number().int().min(1).max(6).optional(), time: z.number().min(0).optional() },
    { ...ro, tooLargeHint: "Pass group_path to list one group (e.g. [\"ADBE Transform Group\"]) and/or a smaller depth" },
  );

  r.bridged(
    "get_keyframes",
    "Read all keyframes of one property: time, value, in/out interpolation and temporal ease, plus any active expression. Use list_properties to find the path.",
    { layer_id: id("Layer"), path: PropPath },
    ro,
  );

  r.bridged("find_effects", "Search installed effects by display name, match name or category (max 50).", { query: z.string() }, ro);
}
