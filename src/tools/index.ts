/**
 * Registers every tool. Each module covers one group and has a matching host file:
 *
 *   src/tools/inspect.ts   <-> host/commands/inspect.ts
 *   src/tools/project.ts   <-> host/commands/project.ts
 *   src/tools/layers.ts    <-> host/commands/layers.ts
 *   src/tools/timeline.ts  <-> host/commands/timeline.ts   (incl. markers)
 *   src/tools/audio.ts     <-> host/commands/audio.ts      (beats, audio_react, sound effects)
 *   src/tools/masks.ts     <-> host/commands/masks.ts
 *   src/tools/animate.ts   <-> host/commands/animate.ts, host/commands/text.ts
 *   src/tools/motion.ts    <-> host/commands/motion.ts     (moves, springs, text reveals, transitions, review)
 *   src/tools/scene3d.ts   <-> host/commands/scene3d.ts
 *   src/tools/design.ts    <-> host/commands/design.ts    (layout, shapes, layer styles)
 *   src/tools/output.ts    <-> host/commands/output.ts    (preview, render)
 *   src/tools/scripting.ts <-> host/commands/output.ts    (run_jsx)
 *   src/tools/meta.ts      (server only: check_for_updates)
 *   src/tools/batch.ts     (server only: batch, always on)
 *   load_tools (below)     (server only: present when AE_MCP_TOOLSETS leaves groups out, e.g. core)
 */
import { z } from "zod";
import { enabledToolsets, TOOLSETS, type Toolset } from "../config.js";
import { registerAnimateTools } from "./animate.js";
import { registerDesignTools } from "./design.js";
import { registerInspectTools } from "./inspect.js";
import { registerLayerTools } from "./layers.js";
import { registerAudioTools } from "./audio.js";
import { registerBatchTool } from "./batch.js";
import { registerMetaTools } from "./meta.js";
import { registerMotionTools } from "./motion.js";
import { registerMaskTools } from "./masks.js";
import { registerOutputTools } from "./output.js";
import { registerProjectTools } from "./project.js";
import { json, type ToolRegistry } from "./registry.js";
import { registerScene3dTools } from "./scene3d.js";
import { registerScriptingTools } from "./scripting.js";
import { registerTimelineTools } from "./timeline.js";

const GROUPS: Record<Toolset, (r: ToolRegistry) => void> = {
  inspect: registerInspectTools, project: registerProjectTools, layers: registerLayerTools, timeline: registerTimelineTools,
  masks: registerMaskTools, animate: registerAnimateTools, motion: registerMotionTools, scene3d: registerScene3dTools, design: registerDesignTools,
  output: registerOutputTools, audio: registerAudioTools, scripting: registerScriptingTools, meta: registerMetaTools,
};

/** What each group that can be loaded later holds, for load_tools' description: the tool names, so the model knows a
 * ready-made tool exists before it rebuilds one from keyframes. */
const GROUP_SUMMARY: Partial<Record<Toolset, string>> = {
  project: "create_comp, set_comp, open/save_project, import_footage, delete_item",
  layers: "add_layer, set_layer, link_layers, duplicate/delete/reorder_layer, precompose, replace_source",
  timeline: "markers (add/update/list/delete_marker), align_to_markers, split_layer, shift/sequence_layers, insert_time, delete_range, trim_comp, set_playhead",
  masks: "add_mask, set_track_matte",
  animate: "set_property, set_keyframes, edit_keyframes, set_expression, effects, set_text, stagger, copy_animation, shape modifiers",
  motion: "animate (moves with springs), text_reveal, transition, review_motion",
  scene3d: "camera_move (dolly, truck, pedestal, orbit, pan, zoom, rack focus, path), camera_shake, camera_rig, set_camera, get_camera, set_3d, set_light, set_3d_view",
  design: "align_layers (align, distribute), set_anchor, add_shape, add_layer_style, text_to_shapes",
  output: "preview_frame, render_start / status / cancel",
  audio: "beat_markers, audio_react, find_sound_cues, add_sfx, duck_music",
  scripting: "run_jsx (also needs AE_MCP_ALLOW_JSX=1)",
};

/**
 * Register the tool groups in `on` (default: those AE_MCP_TOOLSETS enables, all when unset), then batch, and, when some
 * groups are left out, load_tools to add them later (the SDK tells the client with tools/list_changed).
 */
export function registerAllTools(r: ToolRegistry, on: Set<Toolset> = enabledToolsets()): void {
  for (const name of TOOLSETS) if (on.has(name)) GROUPS[name](r);
  registerBatchTool(r); // after the groups: it runs the bridged tools registered so far
  const later = TOOLSETS.filter((g) => !on.has(g));
  if (later.length) registerLoadTools(r, on, later);
}

function registerLoadTools(r: ToolRegistry, loaded: Set<Toolset>, later: Toolset[]): void {
  r.tool(
    "load_tools",
    "Load tool groups not loaded yet: " + later.map((g) => `${g}: ${GROUP_SUMMARY[g]}`).join("; ") + ". Load the group when a task needs one of these instead of rebuilding it from keyframes; the new tools can also run through batch.",
    { groups: z.array(z.enum(later as [Toolset, ...Toolset[]])).min(1) },
    async (a) => {
      const before = r.names.length, added: Toolset[] = [];
      for (const g of a.groups) if (!loaded.has(g)) { GROUPS[g](r); loaded.add(g); added.push(g); }
      return json({
        loaded: added,
        tools: r.names.slice(before),
        ...(added.length ? { note: "If your client does not show the new tools yet, run them through batch" } : {}),
      });
    },
    { readOnly: true }, // changes the tool list, not the project
  );
}
