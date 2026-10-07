/**
 * Preview and render tools. preview_frame renders one PNG through the bridge; render_* run aerender in the
 * background (src/render/manager.ts). Host side: host/commands/output.jsx (preview_frame, prepare_render).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { z } from "zod";
import { TIMEOUTS } from "../config.js";
import { toAe } from "../sandbox.js";
import { errorResult, fromBridge, json, type ToolRegistry } from "./registry.js";
import { id } from "./schemas.js";

const PREVIEW_DIR = path.join(os.tmpdir(), "ae-motion-mcp");

/**
 * Wait until a file exists and its size is stable across two polls. After Effects can still be writing the PNG
 * when saveFrameToPng returns (heavy 3D frames).
 */
async function waitForFile(p: string, timeoutMs: number): Promise<boolean> {
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

export function registerOutputTools(r: ToolRegistry): void {
  const { bridge, renders } = r.deps;

  r.tool(
    "preview_frame",
    "Render a single frame of a comp to a PNG and return it as an image. Needs a recent After Effects version (comp.saveFrameToPng).",
    { comp_id: id("Comp"), time: z.number().min(0) },
    async (a) => {
      fs.mkdirSync(PREVIEW_DIR, { recursive: true });
      const out = path.join(PREVIEW_DIR, `preview_${a.comp_id}_${String(a.time).replace(".", "_")}_${Date.now()}.png`);
      const res = await bridge.run("preview_frame", { comp_id: a.comp_id, time: a.time, output_path: toAe(out) }, TIMEOUTS.preview);
      if (!res.ok) return fromBridge(res);
      if (!(await waitForFile(out, TIMEOUTS.previewFile))) {
        return errorResult({
          code: "AE_ERROR",
          message: `After Effects reported success but no PNG was written within ${TIMEOUTS.previewFile / 1000} seconds`,
          hint: "Heavy 3D scenes can take a while; try again, or preview a simpler time",
        });
      }
      return {
        content: [
          { type: "text", text: JSON.stringify({ path: out }) },
          { type: "image", data: fs.readFileSync(out).toString("base64"), mimeType: "image/png" },
        ],
      };
    },
    { readOnly: true },
  );

  r.tool(
    "render_start",
    "Save the project and start a background aerender job. Returns a job_id; poll render_status. om_template / rs_template are After Effects output-module / render-settings template names. The project must have been saved once. After Effects picks the file extension from the output module, so the file can differ from output_path; render_status reports the file actually written.",
    { comp_id: id("Comp"), output_path: z.string(), om_template: z.string().optional(), rs_template: z.string().optional(), overwrite: z.boolean().optional() },
    async (a) => json(await renders.start(a)),
  );

  r.tool(
    "render_status",
    "Get state (running|done|failed|canceled), percent, a log tail and the file actually written (its extension can differ from the requested output_path) for a render job.",
    { job_id: z.string() },
    async (a) => json(renders.status(a.job_id)),
    { readOnly: true },
  );

  r.tool("render_cancel", "Cancel a running render job.", { job_id: z.string() }, async (a) => json(renders.cancel(a.job_id)), { destructive: false, idempotent: true });
}
