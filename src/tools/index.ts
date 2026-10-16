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
 *   load_tools (below)     (server only: listed while some groups are hidden from tools/list)
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
 * Which tool groups the client is shown. Every tool is registered (batch and direct calls always work); tools/list
 * leaves out the groups not shown, because a client that sends every definition with every request (Claude Desktop)
 * pays for each one each time. Claude Code defers definitions itself, so it is shown everything. load_tools or a
 * batch step naming a hidden tool shows its group and tells the client the list changed.
 */
export class ToolVisibility {
  readonly groupOf = new Map<string, Toolset>();
  constructor(private readonly r: ToolRegistry, readonly shown: Set<Toolset>) {}
  /** Groups registered but not shown, in TOOLSETS order. */
  hidden(): Toolset[] { return TOOLSETS.filter((g) => !this.shown.has(g)); }
  /** Whether tools/list includes this tool (load_tools only while something is hidden). */
  listed(tool: string): boolean {
    if (tool === "load_tools") return this.hidden().length > 0;
    const g = this.groupOf.get(tool);
    return g === undefined || this.shown.has(g);
  }
  /** Show groups; true if any was hidden. notify: send tools/list_changed (not during the handshake). */
  show(groups: Toolset[], notify = true): boolean {
    const added = groups.filter((g) => !this.shown.has(g));
    for (const g of added) this.shown.add(g);
    if (added.length && notify) this.r.listChanged();
    return added.length > 0;
  }
  /** The tools of the hidden groups, for the server instructions: "masks: add_mask, set_track_matte; ...". */
  hiddenText(): string {
    return this.hidden().map((g) => `${g}: ${[...this.groupOf].filter(([, x]) => x === g).map(([t]) => t).join(", ")}`).join("; ");
  }
}

/**
 * Register every tool group, then batch and load_tools. `shown` (default: what AE_MCP_TOOLSETS asks for, core when
 * unset) is what tools/list includes; server.ts widens it to everything for Claude Code during the handshake.
 */
export function registerAllTools(r: ToolRegistry, shown: Set<Toolset> = enabledToolsets()): ToolVisibility {
  const vis = new ToolVisibility(r, new Set(shown));
  for (const g of TOOLSETS) {
    const before = r.names.length;
    GROUPS[g](r);
    for (const t of r.names.slice(before)) vis.groupOf.set(t, g);
  }
  registerBatchTool(r); // after the groups: it runs the bridged tools registered so far
  registerLoadTools(r, vis);
  // a batch step naming a hidden tool shows its group (the tool itself is registered, so the step runs as it is)
  r.autoload = (tool) => {
    const g = vis.groupOf.get(tool);
    return g && vis.show([g]) ? g : null;
  };
  return vis;
}

const OPTIONAL = TOOLSETS.filter((g) => GROUP_SUMMARY[g] !== undefined);

function registerLoadTools(r: ToolRegistry, vis: ToolVisibility): void {
  r.tool(
    "load_tools",
    "Show a tool group that is not listed yet, to see its tools' arguments: " + OPTIONAL.map((g) => `${g} (${GROUP_SUMMARY[g]})`).join("; ") + ". A batch step naming one of their tools shows its group by itself.",
    { groups: z.array(z.enum(OPTIONAL as [Toolset, ...Toolset[]])).min(1) },
    async (a) => {
      const added = a.groups.filter((g) => !vis.shown.has(g));
      vis.show(added);
      return json({
        loaded: added,
        tools: [...vis.groupOf].filter(([, g]) => added.includes(g)).map(([t]) => t),
        ...(added.length ? { note: "If your client does not show the new tools yet, run them through batch" } : {}),
      });
    },
    { readOnly: true }, // changes the tool list, not the project
  );
}
