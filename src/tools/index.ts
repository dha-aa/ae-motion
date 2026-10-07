/**
 * Registers every tool. Each module covers one group and has a matching host file:
 *
 *   src/tools/inspect.ts   <-> host/commands/inspect.jsx
 *   src/tools/project.ts   <-> host/commands/project.jsx
 *   src/tools/layers.ts    <-> host/commands/layers.jsx
 *   src/tools/timeline.ts  <-> host/commands/timeline.jsx   (incl. markers)
 *   src/tools/masks.ts     <-> host/commands/masks.jsx
 *   src/tools/animate.ts   <-> host/commands/animate.jsx, host/commands/text.jsx
 *   src/tools/scene3d.ts   <-> host/commands/scene3d.jsx
 *   src/tools/design.ts    <-> host/commands/design.jsx    (layout, shapes, layer styles)
 *   src/tools/output.ts    <-> host/commands/output.jsx    (preview, render)
 *   src/tools/scripting.ts <-> host/commands/output.jsx    (run_jsx)
 *   src/tools/meta.ts      (server only: check_for_updates)
 */
import { enabledToolsets, type Toolset } from "../config.js";
import { registerAnimateTools } from "./animate.js";
import { registerDesignTools } from "./design.js";
import { registerInspectTools } from "./inspect.js";
import { registerLayerTools } from "./layers.js";
import { registerMetaTools } from "./meta.js";
import { registerMaskTools } from "./masks.js";
import { registerOutputTools } from "./output.js";
import { registerProjectTools } from "./project.js";
import type { ToolRegistry } from "./registry.js";
import { registerScene3dTools } from "./scene3d.js";
import { registerScriptingTools } from "./scripting.js";
import { registerTimelineTools } from "./timeline.js";

/** Register the tool groups enabled by AE_MCP_TOOLSETS (default: all). */
export function registerAllTools(r: ToolRegistry): void {
  const on = enabledToolsets();
  const groups: [Toolset, (r: ToolRegistry) => void][] = [
    ["inspect", registerInspectTools], ["project", registerProjectTools], ["layers", registerLayerTools],
    ["timeline", registerTimelineTools], ["masks", registerMaskTools], ["animate", registerAnimateTools],
    ["scene3d", registerScene3dTools], ["design", registerDesignTools], ["output", registerOutputTools],
    ["scripting", registerScriptingTools], ["meta", registerMetaTools],
  ];
  for (const [name, register] of groups) if (on.has(name)) register(r);
}
