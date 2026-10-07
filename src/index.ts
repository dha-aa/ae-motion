#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { AeToolError, BridgeResult, HttpBridge } from "./bridge.js";
import { RenderManager } from "./render.js";
import { assertAllowed, toAe } from "./sandbox.js";

const bridge = new HttpBridge();
const renders = new RenderManager(bridge);
const server = new McpServer({ name: "ae-motion-mcp", version: "1.0.0" });

const text = (o: unknown, isError = false) => ({ content: [{ type: "text" as const, text: JSON.stringify(o, null, 2) }], isError });
const fromBridge = (r: BridgeResult) => (r.ok ? text(r.result) : text({ error: r.error }, true));

function tool(name: string, description: string, shape: z.ZodRawShape, run: (a: any) => Promise<any>) {
  server.registerTool(name, { description, inputSchema: shape }, (async (args: any) => {
    try {
      return await run(args);
    } catch (e: any) {
      return text({ error: { code: e.code ?? "AE_ERROR", message: e.message ?? String(e), hint: e.hint } }, true);
    }
  }) as any);
}

/** Tool that forwards its args to a bridge command. `pathArgs` are sandboxed and slash-normalised first. */
function bridged(name: string, description: string, shape: z.ZodRawShape, pathArgs: string[] = [], timeoutMs?: number) {
  tool(name, description, shape, async (a) => {
    const args = { ...a };
    for (const k of pathArgs) if (typeof args[k] === "string") args[k] = toAe(assertAllowed(args[k]));
    return fromBridge(await bridge.run(name, args, timeoutMs));
  });
}

// ---------- shared schemas ----------
const id = (what: string) => z.number().int().describe(`${what} id (from get_project / get_comp)`);
const Color = z.array(z.number().min(0).max(1)).min(3).max(4).describe("[r,g,b] floats 0-1");
const Pt = z.array(z.number()).length(2).describe("[x,y]");
const Time = z.number().min(0);
const LayerIds = z.array(z.number().int()).min(1).describe("Layer ids, all from the same comp");
const PropPath = z
  .union([z.string(), z.array(z.union([z.string(), z.number()])).min(1)])
  .describe('Alias (position|scale|rotation|opacity|anchor) or an array of match names, e.g. ["ADBE Effect Parade","ADBE Gaussian Blur 2","ADBE Gaussian Blur 2-0001"]. Use list_properties to discover paths.');
const Value = z.union([z.number(), z.string(), z.boolean(), z.array(z.number())]).describe("Number, boolean, or number array (position [x,y], scale [x,y] in percent, color [r,g,b] 0-1)");
const Ease = z
  .union([z.literal("easy"), z.object({ speed: z.number().default(0), influence: z.number().min(0.1).max(100).default(33.33) })])
  .describe('"easy" (easy ease) or {speed, influence}');

// ---------- inspect ----------
bridged("get_project", "List project items (comps, footage, folders), the active comp id, AE version and project path.", {});
bridged("get_comp", "Get composition settings (size, fps, duration, work area, playhead time, marker count) and its layers (id, name, kind, in/out/start, parent, flags).", { comp_id: id("Comp") });
bridged("get_layer", "Get a layer's transform values, effects, layers with expressions, marker count, masks (mode, inverted) and track matte. Values are read at `time` (default 0).", { layer_id: id("Layer"), time: z.number().min(0).optional() });
bridged(
  "list_properties",
  "Walk a layer's property tree and return names, match names, value types, values, keyframe counts and expressions. Use it to find property paths before set_property / set_keyframes.",
  { layer_id: id("Layer"), group_path: PropPath.optional(), depth: z.number().int().min(1).max(6).optional(), time: z.number().min(0).optional() }
);
bridged("find_effects", "Search installed effects by display name, match name or category (max 50).", { query: z.string() });

// ---------- build ----------
bridged("create_comp", "Create a composition and open it in the viewer.", {
  name: z.string(), width: z.number().int().min(1).max(30000), height: z.number().int().min(1).max(30000),
  fps: z.number().min(1).max(120), duration: z.number().positive(), bg_color: Color.optional(),
});
bridged("import_footage", "Import a file (or an image sequence) into the project. Path must be inside the allowed folders.", { path: z.string(), as: z.enum(["footage", "sequence"]).optional() }, ["path"]);
bridged(
  "add_layer",
  "Add a layer. kind: solid | text | shape | null | adjustment | footage | precomp | camera | light. options: name, color, size, duration, text, item_id (footage/precomp), center (camera/light), light_type (point|spot|parallel|ambient), start/in/out, shape {type: rect|ellipse|star|polygon|path, size, fill, stroke, stroke_width, roundness, points, outer_radius, inner_radius (star/polygon), vertices/in_tangents/out_tangents/closed (path)}.",
  {
    comp_id: id("Comp"),
    kind: z.enum(["solid", "text", "shape", "null", "adjustment", "footage", "precomp", "camera", "light"]),
    options: z
      .object({
        name: z.string().optional(), color: Color.optional(), size: z.array(z.number()).length(2).optional(), duration: z.number().positive().optional(),
        text: z.string().optional(), item_id: z.number().int().optional(), center: z.array(z.number()).min(2).max(3).optional(), light_type: z.enum(["point", "spot", "parallel", "ambient"]).optional(),
        start: z.number().optional(), in: z.number().optional(), out: z.number().optional(),
        shape: z.object({
          type: z.enum(["rect", "ellipse", "star", "polygon", "path"]).default("rect"),
          points: z.number().int().min(3).max(100).optional(), outer_radius: z.number().positive().optional(), inner_radius: z.number().positive().optional(),
          vertices: Pt.array().min(2).optional(), in_tangents: Pt.array().optional(), out_tangents: Pt.array().optional(), closed: z.boolean().optional(), size: z.array(z.number()).length(2).optional(), fill: Color.optional(),
          stroke: Color.optional(), stroke_width: z.number().positive().optional(), roundness: z.number().min(0).optional(),
        }).optional(),
      })
      .default({}),
  }
);
bridged("set_layer", "Edit a layer: name, timing (start/in/out in seconds), time stretch (percent; 200 = half speed, negative reverses), parent (parent_id, or null to unparent), blend mode name (e.g. ADD, SCREEN, MULTIPLY), visibility, and flags: three_d, shy, solo, locked, label (0-16), motion_blur, time_remap.", {
  layer_id: id("Layer"), name: z.string().optional(), start: z.number().optional(), in: z.number().optional(), out: z.number().optional(),
  parent_id: z.number().int().nullable().optional(), blend_mode: z.string().optional(), enabled: z.boolean().optional(),
  stretch: z.number().refine((n) => n !== 0, "stretch cannot be 0").optional(), three_d: z.boolean().optional(), shy: z.boolean().optional(), solo: z.boolean().optional(),
  locked: z.boolean().optional(), label: z.number().int().min(0).max(16).optional(), motion_blur: z.boolean().optional(), time_remap: z.boolean().optional(),
});
bridged("delete_layer", "Delete a layer.", { layer_id: id("Layer") });
bridged("precompose", "Precompose layers from the same comp into a new comp.", { layer_ids: z.array(z.number().int()).min(1), name: z.string() });

// ---------- style and animate ----------
bridged("set_property", "Set a static value, or a value at `time` (creates/updates a keyframe). Animated properties need `time`. Use set_text for text.", { layer_id: id("Layer"), path: PropPath, value: Value, time: z.number().min(0).optional() });
bridged(
  "set_keyframes",
  "Replace all keyframes on a property. Each key: {t, v, interp?: linear|bezier|hold, ease_in?, ease_out?}. Fails if the property has an active expression.",
  {
    layer_id: id("Layer"), path: PropPath,
    keys: z.array(z.object({ t: z.number().min(0), v: Value, interp: z.enum(["linear", "bezier", "hold"]).optional(), ease_in: Ease.optional(), ease_out: Ease.optional() })).min(1),
  }
);
bridged("set_expression", "Set an expression on a property (empty string clears it). Returns whether After Effects accepted the syntax.", { layer_id: id("Layer"), path: PropPath, expression: z.string() });
bridged("apply_effect", "Add an effect by match name (see find_effects) and set parameters by name, match name or 1-based index. If any parameter fails the effect is removed.", {
  layer_id: id("Layer"), match_name: z.string(), name: z.string().optional(), params: z.record(Value).optional(),
});
bridged("apply_preset", "Apply an .ffx animation preset to a layer. Path must be inside the allowed folders.", { layer_id: id("Layer"), ffx_path: z.string() }, ["ffx_path"]);
bridged("set_text", "Set text content and basic styling on a text layer. font is the PostScript name.", {
  layer_id: id("Layer"), text: z.string().optional(), font: z.string().optional(), size: z.number().positive().optional(),
  color: Color.optional(), tracking: z.number().optional(), justification: z.enum(["left", "center", "right"]).optional(),
});
bridged("stagger", "Offset existing keyframes of one property across layers: layer i is shifted by i * offset_seconds. Spatial tangents are not preserved.", {
  layer_ids: z.array(z.number().int()).min(2), path: PropPath, offset_seconds: z.number(), order: z.enum(["forward", "reverse"]).optional(),
});

// ---------- project and composition ----------
bridged(
  "save_project",
  "Save the project. With path it does Save As (.aep or .aepx, inside the allowed folders; pass overwrite to replace an existing file). Without path it saves in place, which needs a project that has been saved once. render_start needs a saved project.",
  { path: z.string().optional(), overwrite: z.boolean().optional() },
  ["path"]
);
bridged("set_comp", "Change composition settings. Only the fields you pass change: name, width, height, fps, duration, bg_color, pixel_aspect and work_area ({start, duration} in seconds, must fit inside the comp).", {
  comp_id: id("Comp"), name: z.string().optional(), width: z.number().int().min(1).max(30000).optional(), height: z.number().int().min(1).max(30000).optional(),
  fps: z.number().min(1).max(120).optional(), duration: z.number().positive().optional(), bg_color: Color.optional(), pixel_aspect: z.number().positive().optional(),
  work_area: z.object({ start: z.number().min(0).optional(), duration: z.number().positive().optional() }).optional(),
});
bridged("delete_item", "Delete a project item (comp, footage or folder) by id. Refuses items that are used in comps, and non-empty folders, unless force is true (force also deletes the layers that use the item).", { item_id: id("Item"), force: z.boolean().optional() });

// ---------- layers: duplicate and reorder ----------
bridged("duplicate_layer", "Duplicate a layer (the copy sits above the original). count makes several copies; offset_seconds shifts copy N later in time by N * offset_seconds.", {
  layer_id: id("Layer"), count: z.number().int().min(1).max(50).optional(), name: z.string().optional(), offset_seconds: z.number().optional(),
});
bridged("reorder_layer", "Change a layer's stacking order. Pass exactly one of: to (top | bottom | up | down), index (1 = top), before_layer_id, after_layer_id. Before means above in the stack.", {
  layer_id: id("Layer"), to: z.enum(["top", "bottom", "up", "down"]).optional(), index: z.number().int().min(1).optional(),
  before_layer_id: z.number().int().optional(), after_layer_id: z.number().int().optional(),
});

// ---------- timeline editing ----------
bridged("split_layer", "Split layers at a comp time, like Edit > Split Layer (Cmd/Ctrl+Shift+D). Each layer keeps its first part; a copy above it holds the second part. Times snap to whole frames unless snap is false. Fails if the time is outside any layer or a layer is locked, and then changes nothing.", {
  layer_ids: LayerIds, time: Time, snap: z.boolean().optional(),
});
bridged("shift_layers", "Move layers in time by offset_seconds (positive = later). Keyframes and in/out points move with the layer.", { layer_ids: LayerIds, offset_seconds: z.number() });
bridged("sequence_layers", "Place layers one after another in the given order (like Animation > Keyframe Assistant > Sequence Layers). overlap is the seconds each layer overlaps the previous one. start sets where the first layer begins (default: where it already is).", {
  layer_ids: z.array(z.number().int()).min(2).describe("Layer ids in playback order, all from the same comp"), overlap: z.number().min(0).optional(), start: z.number().optional(),
});
bridged("delete_range", "Remove a time range from a comp's layers. Layers fully inside are deleted, layers crossing an edge are trimmed, layers spanning the range are split and the middle removed. ripple (default true) closes the gap by moving later material earlier; ripple false leaves the gap (a lift). layer_ids limits the edit (default: all unlocked layers). shorten_comp also shortens the comp duration when rippling. Times snap to frames. Markers are not moved.", {
  comp_id: id("Comp"), start: Time, end: Time, ripple: z.boolean().optional(), layer_ids: z.array(z.number().int()).min(1).optional(), shorten_comp: z.boolean().optional(),
});
bridged("set_playhead", "Move a comp's current-time indicator (playhead) to a time in seconds. Snaps to a whole frame unless snap is false.", { comp_id: id("Comp"), time: Time, snap: z.boolean().optional() });

// ---------- masks and mattes ----------
const MaskShape = z.object({
  type: z.enum(["rect", "ellipse", "polygon", "path"]),
  position: Pt.optional().describe("Center in layer pixels (rect/ellipse; default: layer center)"),
  size: Pt.optional().describe("[width,height] in pixels (rect/ellipse; default: full layer)"),
  points: Pt.array().min(3).optional().describe("Corner points in layer pixels (polygon)"),
  vertices: Pt.array().min(2).optional().describe("Path vertices in layer pixels (path)"),
  in_tangents: Pt.array().optional(), out_tangents: Pt.array().optional(), closed: z.boolean().optional(),
});
bridged(
  "add_mask",
  "Add a mask to a layer. shape: rect or ellipse (position and size in layer pixels, default full layer), polygon (points) or path (vertices with optional tangents). mode: add | subtract | intersect | lighten | darken | difference | none. feather is a uniform blur in pixels (feather_xy sets x and y separately). Returns the mask's property path; animate its ADBE Mask Shape, ADBE Mask Feather, ADBE Mask Opacity or ADBE Mask Offset with set_keyframes using that path plus the match name.",
  {
    layer_id: id("Layer"), shape: MaskShape, mode: z.enum(["add", "subtract", "intersect", "lighten", "darken", "difference", "none"]).optional(), inverted: z.boolean().optional(),
    feather: z.number().min(0).optional(), feather_xy: Pt.optional(), opacity: z.number().min(0).max(100).optional(), expansion: z.number().optional(), name: z.string().optional(),
  }
);
bridged("set_track_matte", "Use one layer as the track matte of another. matte_layer_id is the layer that acts as the matte, or null to remove the matte. type: alpha (default) | alpha_inverted | luma | luma_inverted.", {
  layer_id: id("Layer"), matte_layer_id: z.number().int().nullable().describe("Matte layer id, or null to remove the matte"),
  type: z.enum(["alpha", "alpha_inverted", "luma", "luma_inverted"]).optional(),
});

// ---------- markers ----------
const MarkerTarget = {
  layer_id: z.number().int().optional().describe("Layer id (omit for a comp marker)"),
  comp_id: z.number().int().optional().describe("Comp id (omit for a layer marker)"),
};
bridged("add_marker", "Add a marker to a layer (layer_id) or a comp (comp_id) at a time. Optional comment, duration in seconds, chapter, url and label color (0-16).", {
  ...MarkerTarget, time: Time, comment: z.string().optional(), duration: z.number().min(0).optional(), chapter: z.string().optional(), url: z.string().optional(),
  label: z.number().int().min(0).max(16).optional(),
});
bridged("list_markers", "List the markers of a layer (layer_id) or a comp (comp_id): index, time, comment, duration, chapter, url, label.", { ...MarkerTarget });
bridged("delete_marker", "Delete a marker from a layer (layer_id) or a comp (comp_id), by index (1-based, from list_markers) or by time (must be within 0.05 s of a marker).", {
  ...MarkerTarget, index: z.number().int().min(1).optional(), time: Time.optional(),
});

// ---------- shapes, keyframes, effects ----------
bridged(
  "add_shape_modifier",
  "Add a modifier to a shape layer's group: trim_paths (ADBE Vector Trim Start / End / Offset), repeater (ADBE Vector Repeater Copies / Offset, plus a Transform group) or round_corners (ADBE Vector RoundCorner Radius). params maps a property name or match name to a value. group_index is the 1-based shape group (default 1). Returns the modifier's property path and property names, ready for set_keyframes and list_properties.",
  { layer_id: id("Layer"), modifier: z.enum(["trim_paths", "repeater", "round_corners"]), group_index: z.number().int().min(1).optional(), params: z.record(Value).optional() }
);
bridged("get_keyframes", "Read all keyframes of one property: time, value, in/out interpolation and temporal ease, plus any active expression. Use list_properties to find the path.", { layer_id: id("Layer"), path: PropPath });
bridged("edit_effect", "Remove, enable or disable an effect on a layer by its 1-based index (see get_layer for the list).", {
  layer_id: id("Layer"), effect_index: z.number().int().min(1), action: z.enum(["remove", "enable", "disable"]),
});

// ---------- preview ----------
tool("preview_frame", "Render a single frame of a comp to a PNG and return it as an image. Needs a recent After Effects version (comp.saveFrameToPng).", { comp_id: id("Comp"), time: z.number().min(0) }, async (a) => {
  const dir = path.join(os.tmpdir(), "ae-motion-mcp");
  fs.mkdirSync(dir, { recursive: true });
  const out = path.join(dir, `preview_${a.comp_id}_${String(a.time).replace(".", "_")}_${Date.now()}.png`);
  const r = await bridge.run("preview_frame", { comp_id: a.comp_id, time: a.time, output_path: toAe(out) }, 60_000);
  if (!r.ok) return fromBridge(r);
  if (!fs.existsSync(out)) return text({ error: { code: "AE_ERROR", message: "After Effects reported success but no PNG was written" } }, true);
  return { content: [{ type: "text" as const, text: JSON.stringify({ path: out }) }, { type: "image" as const, data: fs.readFileSync(out).toString("base64"), mimeType: "image/png" }] };
});

// ---------- render (async via aerender) ----------
tool(
  "render_start",
  "Save the project and start a background aerender job. Returns a job_id; poll render_status. om_template / rs_template are After Effects output-module / render-settings template names. The project must have been saved once. After Effects picks the file extension from the output module, so the file can differ from output_path; render_status reports the file actually written.",
  { comp_id: id("Comp"), output_path: z.string(), om_template: z.string().optional(), rs_template: z.string().optional(), overwrite: z.boolean().optional() },
  async (a) => text(await renders.start(a))
);
tool("render_status", "Get state (running|done|failed|canceled), percent, a log tail and the file actually written (its extension can differ from the requested output_path) for a render job.", { job_id: z.string() }, async (a) => text(renders.status(a.job_id)));
tool("render_cancel", "Cancel a running render job.", { job_id: z.string() }, async (a) => text(renders.cancel(a.job_id)));

// ---------- escape hatch (off by default) ----------
tool("run_jsx", "Run arbitrary ExtendScript in After Effects and return its result. Disabled unless AE_MCP_ALLOW_JSX=1.", { code: z.string() }, async (a) => {
  if (process.env.AE_MCP_ALLOW_JSX !== "1") throw new AeToolError("FORBIDDEN", "run_jsx is disabled", "Set AE_MCP_ALLOW_JSX=1 in the MCP server environment to enable it");
  return fromBridge(await bridge.run("run_jsx", { code: a.code }));
});

// ---------- resources ----------
server.registerResource("project", "ae://project", { description: "Current project summary", mimeType: "application/json" }, async (uri) => {
  const r = await bridge.run("get_project", {});
  return { contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify(r.ok ? r.result : r.error, null, 2) }] };
});
server.registerResource("selection", "ae://selection", { description: "Layers selected in the active comp", mimeType: "application/json" }, async (uri) => {
  const r = await bridge.run("get_selection", {});
  return { contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify(r.ok ? r.result : r.error, null, 2) }] };
});

// ---------- prompt ----------
server.registerPrompt("motion-guide", { description: "Conventions and the recommended build loop for motion graphics" }, () => ({
  messages: [{
    role: "user" as const,
    content: { type: "text" as const, text: [
      "You control After Effects through MCP tools. Conventions:",
      "- Time is in seconds, sizes in pixels, colors are [r,g,b] floats 0-1, scale is in percent.",
      "- Address comps/layers by the numeric ids the tools return. Address properties by alias (position, scale, rotation, opacity, anchor) or match-name arrays; use list_properties to discover paths.",
      "- Every tool call is one undo step in After Effects.",
      "Recommended loop: get_project -> create_comp -> add_layer (background first) -> set_keyframes with ease_in/ease_out (\"easy\") -> preview_frame at key moments -> adjust -> render_start, then poll render_status.",
      "Prefer set_keyframes over many set_property calls. Use stagger for repeated elements. Do not assume effect names: find_effects first.",
    ].join("\n") },
  }],
}));

// Stop running aerender jobs when the client disconnects or the server is terminated.
let shuttingDown = false;
const shutdown = () => {
  if (shuttingDown) return;
  shuttingDown = true;
  renders.dispose();
};
process.on("exit", shutdown);
for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"] as const) process.on(sig, () => { shutdown(); process.exit(0); });
process.stdin.on("end", () => { shutdown(); process.exit(0); });

await server.connect(new StdioServerTransport());
