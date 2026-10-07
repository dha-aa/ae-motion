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
const V3 = z.array(z.number()).min(2).max(3).describe("[x,y] or [x,y,z] in pixels (x right, y down, z into the screen; a camera in front of the comp has negative z)");
const Rot3 = z.object({ x: z.number().optional(), y: z.number().optional(), z: z.number().optional() }).describe("Rotation in degrees per axis");
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
  "Add a layer (text layers take options.box_size [w,h] for box text). kind: solid | text | shape | null | adjustment | footage | precomp | camera | light. options: name, color, size, duration, text, item_id (footage/precomp), center (camera/light), position ([x,y] or [x,y,z]; three values turn 3D on), three_d, light_type (point|spot|parallel|ambient), start/in/out, shape {type: rect|ellipse|star|polygon|path, size, fill, stroke, stroke_width, roundness, points, outer_radius, inner_radius (star/polygon), vertices/in_tangents/out_tangents/closed (path)}.",
  {
    comp_id: id("Comp"),
    kind: z.enum(["solid", "text", "shape", "null", "adjustment", "footage", "precomp", "camera", "light"]),
    options: z
      .object({
        name: z.string().optional(), color: Color.optional(), size: z.array(z.number()).length(2).optional(), duration: z.number().positive().optional(),
        text: z.string().optional(), item_id: z.number().int().optional(), center: z.array(z.number()).min(2).max(3).optional(), light_type: z.enum(["point", "spot", "parallel", "ambient"]).optional(),
        start: z.number().optional(), in: z.number().optional(), out: z.number().optional(), position: V3.optional(), three_d: z.boolean().optional(), box_size: z.tuple([z.number().positive(), z.number().positive()]).optional(),
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
bridged(
  "link_layers",
  "Link (parent) layers so they follow another layer. Pass parent_id to make an existing layer the parent of every layer in layer_ids, or parent_id null to unlink them, or new_null {name?, position?, three_d?} to create a null object and parent them all to it. The null goes at the average of the layers' position values by default, is 3D if any of them is (or if position has 3 values), and is stacked above the top-most of them. Moving, rotating or scaling the parent then moves the children, so one null can drive a whole group. jump true uses setParentWithJump (the child keeps its own transform values, so it can visibly move). Everything is checked first: a self-link, a cycle, a locked layer or mixed comps change nothing.",
  {
    layer_ids: LayerIds, parent_id: z.number().int().nullable().optional(),
    new_null: z.object({ name: z.string().optional(), position: V3.optional(), three_d: z.boolean().optional() }).optional(), jump: z.boolean().optional(),
  }
);
bridged(
  "set_3d_view",
  "Switch the 3D view in the comp viewer, the one you pick from the 3D View menu: active_camera, default, front, left, top, back, right, bottom, or custom_1 to custom_3. comp_id opens that comp in the viewer first; without it the active comp is used. This only changes what the editor shows: preview_frame and renders always use the active camera. It runs the menu command, so it cannot be undone from the script.",
  {
    view: z.enum(["active_camera", "default", "front", "left", "top", "back", "right", "bottom", "custom_1", "custom_2", "custom_3"]),
    comp_id: id("Comp").optional(),
  }
);
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
bridged("add_property", "Add a property or group to a layer, for things set_property cannot reach until they exist. Text animator: group_path ['ADBE Text Properties','ADBE Text Animators'], match_name ADBE Text Animator; then add properties with group_path = returned path + 'ADBE Text Animator Properties' (match_name ADBE Text Position 3D, ADBE Text Opacity, ADBE Text Fill Color, ADBE Text Tracking Amount...) and a range selector with group_path = returned path + 'ADBE Text Selectors', match_name ADBE Text Selector. Layer styles cannot be created by scripts in After Effects, so they are not supported. Returns the new property path for set_property / set_keyframes.", { layer_id: id("Layer"), match_name: z.string(), group_path: PropPath.optional() }, ["match_name"]);
bridged("set_expression", "Set an expression on a property (empty string clears it). Returns whether After Effects accepted the syntax.", { layer_id: id("Layer"), path: PropPath, expression: z.string() });
bridged("apply_effect", "Add an effect by match name (see find_effects) and set parameters by name, match name or 1-based index. If any parameter fails the effect is removed.", {
  layer_id: id("Layer"), match_name: z.string(), name: z.string().optional(), params: z.record(Value).optional(),
});
bridged("apply_preset", "Apply an .ffx animation preset to a layer. Path must be inside the allowed folders.", { layer_id: id("Layer"), ffx_path: z.string() }, ["ffx_path"]);
bridged(
  "set_text",
  "Set text content and any character or paragraph styling on a text layer; only the fields you pass change, and the result reads the values back (skipped lists anything After Effects refused). font is the PostScript name. Character: size, color, tracking, leading (turns auto leading off), auto_leading, baseline_shift, horizontal_scale and vertical_scale (percent, 100 = normal), faux_bold, faux_italic, all_caps, small_caps, superscript, subscript, ligatures, tsume. Stroke: stroke_color (turns the stroke on), stroke_width, stroke (on/off), stroke_over_fill, fill (on/off). Paragraph: justification (left, center, right, justify, justify_center, justify_right, justify_all), first_line_indent, left_indent, right_indent, space_before, space_after, box_size [w,h] (resizes box text; point text cannot be converted, create box text with add_layer options.box_size). Pass time to set the text at a time as a keyframe. Styling applies to the whole layer; for per-character changes use text animators (add_property).",
  {
    layer_id: id("Layer"), time: z.number().min(0).optional(), text: z.string().optional(), font: z.string().optional(),
    size: z.number().positive().optional(), color: Color.optional(), tracking: z.number().optional(),
    leading: z.number().positive().optional(), auto_leading: z.boolean().optional(), baseline_shift: z.number().optional(),
    horizontal_scale: z.number().positive().optional(), vertical_scale: z.number().positive().optional(),
    faux_bold: z.boolean().optional(), faux_italic: z.boolean().optional(), all_caps: z.boolean().optional(), small_caps: z.boolean().optional(),
    superscript: z.boolean().optional(), subscript: z.boolean().optional(), ligatures: z.boolean().optional(), tsume: z.number().min(0).max(100).optional(),
    stroke_color: Color.optional(), stroke_width: z.number().min(0).optional(), stroke: z.boolean().optional(), stroke_over_fill: z.boolean().optional(), fill: z.boolean().optional(),
    justification: z.enum(["left", "center", "right", "justify", "justify_center", "justify_right", "justify_all"]).optional(),
    first_line_indent: z.number().optional(), left_indent: z.number().optional(), right_indent: z.number().optional(),
    space_before: z.number().optional(), space_after: z.number().optional(),
    box_size: z.tuple([z.number().positive(), z.number().positive()]).optional(),
  }
);
bridged("get_text", "Read a text layer's content and styling (font, size, colors, stroke, leading, tracking, scale, caps, indents, justification, box size), at `time` (default: now).", { layer_id: id("Layer"), time: z.number().min(0).optional() });
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

// ---------- 3D cameras, lights and 3D layers ----------
const CameraXform = {
  position: V3.optional(), point_of_interest: V3.optional().describe("Where a two-node camera looks, [x,y,z]"), orientation: V3.optional().describe("Orientation in degrees [x,y,z]"),
  rotation: Rot3.optional(),
};
bridged("get_camera", "Read a camera: lens (zoom px, focal length mm on a 36 mm film width, horizontal and vertical field of view), depth of field, focus distance, aperture, blur level, iris, position, point of interest, orientation, rotation, whether it is two-node, and what drives each property (static, keyframes, rig, shake, look-at or an expression). time defaults to 0.", {
  layer_id: id("Camera layer"), time: Time.optional(),
});
bridged(
  "set_camera",
  "Set up a camera. Lens: pass one of zoom (px), focal_length (mm, 36 mm film width) or fov (horizontal degrees). Depth of field: depth_of_field on/off, focus_distance (px) or focus_on_layer_id (distance along the view axis), aperture, blur_level, and the iris controls (iris_shape, iris_rotation, iris_roundness, iris_aspect_ratio, iris_diffraction_fringe, highlight_gain, highlight_threshold, highlight_saturation). two_node true/false switches between a camera with a point of interest and a one-node camera. position, point_of_interest, orientation and rotation place it; look_at_layer_id aims it at a layer (follow: true keeps it aimed with an expression). Without time values are static; with time they become keyframes. Returns the camera as get_camera does. Use camera_move for animated moves.",
  {
    layer_id: id("Camera layer"), name: z.string().optional(), two_node: z.boolean().optional(),
    zoom: z.number().positive().optional(), focal_length: z.number().positive().optional(), fov: z.number().gt(0).lt(180).optional(),
    depth_of_field: z.boolean().optional(), focus_distance: z.number().min(0).optional(), focus_on_layer_id: z.number().int().optional(),
    aperture: z.number().min(0).optional(), blur_level: z.number().min(0).optional(),
    iris_shape: z.number().int().min(1).optional(), iris_rotation: z.number().optional(), iris_roundness: z.number().optional(), iris_aspect_ratio: z.number().optional(),
    iris_diffraction_fringe: z.number().optional(), highlight_gain: z.number().optional(), highlight_threshold: z.number().optional(), highlight_saturation: z.number().optional(),
    ...CameraXform, look_at_layer_id: z.number().int().optional(), follow: z.boolean().optional(), time: Time.optional(),
  }
);
bridged(
  "camera_move",
  "Animate a camera with keyframes you can edit afterwards. type: dolly (distance px toward the point of interest, or factor = new distance as a multiple of the current one), truck (distance px to the right; camera and target move together), pedestal (distance px up; camera and target), crane (distance px up; camera moves, target stays), pan (degrees to the right) and tilt (degrees up), both turning the point of interest, roll (degrees), orbit (degrees around the target to the right, vertical_degrees up, optional target [x,y,z]), zoom (to_zoom, factor, to_focal_length or to_fov), rack_focus (to_focus_distance or to_layer_id; turns depth of field on), and path (waypoints [{t, position?, point_of_interest?}] with absolute times). start and duration are in seconds; easing is linear, ease_in, ease_out or ease_in_out (default). Moves start from the camera's value at start. Existing keyframes inside the move's time range are replaced. Moves that change position or point of interest need a two-node camera. A camera with a rig has its control layers keyed instead.",
  {
    layer_id: id("Camera layer"),
    type: z.enum(["dolly", "truck", "pedestal", "crane", "pan", "tilt", "roll", "orbit", "zoom", "rack_focus", "path"]),
    start: Time.optional(), duration: z.number().positive().optional(), easing: z.enum(["linear", "ease_in", "ease_out", "ease_in_out"]).optional(),
    distance: z.number().optional(), factor: z.number().positive().optional(), degrees: z.number().optional(), vertical_degrees: z.number().optional(),
    target: V3.optional(), step_degrees: z.number().min(1).max(45).optional().describe("Degrees between keyframes for orbit, pan and tilt (default 5)"),
    to_zoom: z.number().positive().optional(), to_focal_length: z.number().positive().optional(), to_fov: z.number().gt(0).lt(180).optional(),
    to_focus_distance: z.number().min(0).optional(), to_layer_id: z.number().int().optional(), enable_dof: z.boolean().optional(),
    waypoints: z.array(z.object({ t: Time, position: V3.optional(), point_of_interest: V3.optional() })).min(2).optional(),
  }
);
bridged(
  "camera_shake",
  "Add handheld shake to a camera with wiggle expressions (so it works on top of any keyframes). target: position (default; translation), point_of_interest (aim shake), rotation (roll) or all. amount is in pixels, rotation_amount in degrees, frequency in shakes per second, octaves adds finer detail, include_depth also shakes z, seed changes the pattern. remove: true takes the shake off again.",
  {
    layer_id: id("Camera layer"), target: z.enum(["position", "point_of_interest", "rotation", "all"]).optional(), amount: z.number().min(0).optional(),
    rotation_amount: z.number().min(0).optional(), frequency: z.number().positive().optional(), octaves: z.number().int().min(1).max(8).optional(),
    include_depth: z.boolean().optional(), seed: z.number().int().optional(), remove: z.boolean().optional(),
  }
);
bridged(
  "camera_rig",
  "Create or remove a camera rig. create adds two 3D null control layers, one for the camera position and one for its target, and links the camera to them with expressions; existing keyframes move onto the controls. Animate the controls (camera_move does it for you) to drive the camera, and parent other layers to them if you like. remove puts the animation back on the camera and deletes the controls (delete_controls: false keeps them). Needs a two-node camera. Do not rename the control layers.",
  { layer_id: id("Camera layer"), action: z.enum(["create", "remove"]), delete_controls: z.boolean().optional() }
);
bridged(
  "set_3d",
  "Make a layer 3D and set its 3D transform and material. position, anchor, scale ([x,y,z], scale in percent), orientation and rotation ({x,y,z} degrees) are set statically, or as keyframes when time is given. material: casts_shadows (off | on | only), accepts_shadows, accepts_lights, light_transmission, ambient, diffuse, specular_intensity, specular_shininess, metal, reflection_intensity, reflection_sharpness, reflection_rolloff, transparency, transparency_rolloff, index_of_refraction. Not for cameras and lights (use set_camera and set_light). Any 3D field turns 3D on unless three_d is false.",
  {
    layer_id: id("Layer"), three_d: z.boolean().optional(), position: V3.optional(), anchor: V3.optional(), scale: V3.optional(), orientation: V3.optional(), rotation: Rot3.optional(),
    material: z.object({
      casts_shadows: z.enum(["off", "on", "only"]).optional(), accepts_shadows: z.boolean().optional(), accepts_lights: z.boolean().optional(),
      light_transmission: z.number().optional(), ambient: z.number().optional(), diffuse: z.number().optional(), specular_intensity: z.number().optional(),
      specular_shininess: z.number().optional(), metal: z.number().optional(), reflection_intensity: z.number().optional(), reflection_sharpness: z.number().optional(),
      reflection_rolloff: z.number().optional(), transparency: z.number().optional(), transparency_rolloff: z.number().optional(), index_of_refraction: z.number().optional(),
    }).optional(),
    time: Time.optional(),
  }
);
bridged(
  "set_light",
  "Edit a light layer: light_type (point | spot | parallel | ambient), intensity (percent), color [r,g,b], cone_angle and cone_feather (spot only), falloff (none | smooth | inverse_square_clamped) with falloff_radius and falloff_distance, casts_shadows with shadow_darkness and shadow_diffusion, and position, point_of_interest, orientation or rotation. Static, or keyframes when time is given. Returns the light's settings.",
  {
    layer_id: id("Light layer"), name: z.string().optional(), light_type: z.enum(["point", "spot", "parallel", "ambient"]).optional(), intensity: z.number().min(0).optional(),
    color: Color.optional(), cone_angle: z.number().min(0).max(180).optional(), cone_feather: z.number().min(0).max(100).optional(),
    falloff: z.enum(["none", "smooth", "inverse_square_clamped"]).optional(), falloff_radius: z.number().min(0).optional(), falloff_distance: z.number().min(0).optional(),
    casts_shadows: z.boolean().optional(), shadow_darkness: z.number().min(0).max(100).optional(), shadow_diffusion: z.number().min(0).optional(),
    ...CameraXform, time: Time.optional(),
  }
);

// ---------- preview ----------
/** After Effects can still be writing the PNG when saveFrameToPng returns (heavy 3D frames), so wait for it to appear and stop growing. */
async function waitForFile(p: string, timeoutMs = 10_000): Promise<boolean> {
  const end = Date.now() + timeoutMs;
  let last = -1;
  while (Date.now() < end) {
    try {
      const size = fs.statSync(p).size;
      if (size > 0 && size === last) return true;
      last = size;
    } catch {
      last = -1;
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  return false;
}

tool("preview_frame", "Render a single frame of a comp to a PNG and return it as an image. Needs a recent After Effects version (comp.saveFrameToPng).", { comp_id: id("Comp"), time: z.number().min(0) }, async (a) => {
  const dir = path.join(os.tmpdir(), "ae-motion-mcp");
  fs.mkdirSync(dir, { recursive: true });
  const out = path.join(dir, `preview_${a.comp_id}_${String(a.time).replace(".", "_")}_${Date.now()}.png`);
  const r = await bridge.run("preview_frame", { comp_id: a.comp_id, time: a.time, output_path: toAe(out) }, 60_000);
  if (!r.ok) return fromBridge(r);
  if (!(await waitForFile(out))) return text({ error: { code: "AE_ERROR", message: "After Effects reported success but no PNG was written within 10 seconds", hint: "Heavy 3D scenes can take a while; try again, or preview a simpler time" } }, true);
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
