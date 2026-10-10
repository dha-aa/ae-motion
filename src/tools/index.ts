/**
 * Registers every tool. Each module covers one group and has a matching host file:
 *
 *   src/tools/inspect.ts   <-> host/commands/inspect.jsx
 *   src/tools/project.ts   <-> host/commands/project.jsx
 *   src/tools/layers.ts    <-> host/commands/layers.jsx
 *   src/tools/timeline.ts  <-> host/commands/timeline.jsx   (incl. markers)
 *   src/tools/audio.ts     <-> host/commands/audio.jsx      (beats, audio_react, sound effects)
 *   src/tools/masks.ts     <-> host/commands/masks.jsx
 *   src/tools/animate.ts   <-> host/commands/animate.jsx, host/commands/text.jsx
 *   src/tools/motion.ts    <-> host/commands/motion.jsx     (moves, springs, text reveals, transitions, review)
 *   src/tools/scene3d.ts   <-> host/commands/scene3d.jsx
 *   src/tools/design.ts    <-> host/commands/design.jsx    (layout, shapes, layer styles)
 *   src/tools/output.ts    <-> host/commands/output.jsx    (preview, render)
 *   src/tools/scripting.ts <-> host/commands/output.jsx    (run_jsx)
 *   src/tools/meta.ts      (server only: check_for_updates)
 *   src/tools/batch.ts     (server only: batch, always on)
 *   load_tools (below)     (server only: present when AE_MCP_TOOLSETS leaves groups out)
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

/** What each group that can be loaded later holds, for load_tools' description. */
const GROUP_SUMMARY: Partial<Record<Toolset, string>> = {
  project: "comps, import, open/save, delete items",
  layers: "add/set/duplicate/delete/reorder/link layers, precompose, replace source",
  timeline: "split, shift, sequence, trim, insert/delete time, markers",
  masks: "masks, track mattes",
  animate: "properties, keyframes, expressions, effects, presets, text, stagger, shape modifiers",
  motion: "animate (named moves with springs), text_reveal, transition, review_motion",
  scene3d: "3D layers, cameras, lights, camera moves/rigs/shake, 3D views",
  design: "align, anchors, add shapes, layer styles, text to shapes",
  output: "preview_frame, renders",
  audio: "beat markers, audio-reactive expressions, sound-effect cues and placement",
  scripting: "run_jsx (also needs AE_MCP_ALLOW_JSX=1)",
};

/**
 * Register the tool groups in `on` (default: those AE_MCP_TOOLSETS enables, else all), then batch, and, when some
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
    "Add tool groups that are not loaded yet: " + later.map((g) => `${g} (${GROUP_SUMMARY[g]})`).join("; ") + ". Call it when you need one of them; the new tools can also be run through batch.",
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
