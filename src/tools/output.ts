/**
 * Preview and render tools. preview_frame renders one PNG through the bridge; render_* run aerender in the
 * background (src/render/manager.ts). Host side: host/commands/output.jsx (preview_frame, prepare_render).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { z } from "zod";
import { TIMEOUTS } from "../config.js";
import { contactSheet, shrinkPng } from "../render/image.js";
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
    "Render comp frames and return them as one image (several times are tiled left to right, top to bottom). Images cost tokens by size: keep the default size, and pass several times in one call rather than calling once per time.",
    {
      comp_id: id("Comp"),
      time: z.union([z.number().min(0), z.array(z.number().min(0)).min(1).max(9)]).describe("Seconds, or up to 9 times for a contact sheet"),
      size: z.number().int().min(64).max(4096).optional().describe("Longest edge of the returned image in px (default 768, or 1152 for several times)"),
    },
    async (a) => {
      fs.mkdirSync(PREVIEW_DIR, { recursive: true });
      const times = Array.isArray(a.time) ? a.time : [a.time];
      const files: string[] = [];
      for (const t of times) {
        const out = path.join(PREVIEW_DIR, `preview_${a.comp_id}_${String(t).replace(".", "_")}_${Date.now()}.png`);
        const res = await bridge.run("preview_frame", { comp_id: a.comp_id, time: t, output_path: toAe(out) }, TIMEOUTS.preview);
        if (!res.ok) return fromBridge(res);
        if (!(await waitForFile(out, TIMEOUTS.previewFile))) {
          return errorResult({
            code: "AE_ERROR",
            message: `After Effects reported success but no PNG was written within ${TIMEOUTS.previewFile / 1000} seconds`,
            hint: "Heavy 3D scenes can take a while; try again, or preview a simpler time",
          });
        }
        files.push(out);
      }
      const pngs = files.map((f) => fs.readFileSync(f));
      // the files on disk stay full size; only the copy sent to the model is shrunk
      const img = pngs.length === 1 ? shrinkPng(pngs[0], a.size ?? 768) : contactSheet(pngs, a.size ?? 1152);
      const info = pngs.length === 1 ? { path: files[0] } : { times, dir: PREVIEW_DIR };
      return {
        content: [
          { type: "text", text: JSON.stringify(info) },
          { type: "image", data: img.toString("base64"), mimeType: "image/png" },
        ],
      };
    },
    { readOnly: true },
  );

  r.tool(
    "render_start",
    "Save the project (saved once before) and start a background aerender job; poll render_status with the job_id. om_template / rs_template: output-module / render-settings template names (the output module picks the file extension). software: Mercury Software Only (fixes GPU failures). With ffmpeg the result is checked (black/frozen/silent spans, loudness; verify false skips); deliver: H.264 MP4 at loudness (-14 LUFS); audio_only: the mix.",
    {
      comp_id: id("Comp"), output_path: z.string(), om_template: z.string().optional(), rs_template: z.string().optional(), overwrite: z.boolean().optional(), software: z.boolean().optional(),
      verify: z.boolean().optional(), deliver: z.boolean().optional(), loudness: z.number().min(-40).max(-5).optional(), audio_only: z.boolean().optional(),
    },
    async (a) => json(await renders.start(a)),
  );

  r.tool(
    "render_status",
    "Get state (running|done|failed|canceled), percent, frames, eta_s, poll_after_s (wait that long), phase, check (issues in the file), errors + hint, log tail, file written.",
    { job_id: z.string() },
    async (a) => json(renders.status(a.job_id)),
    { readOnly: true },
  );

  r.tool("render_cancel", "Cancel a running render job.", { job_id: z.string() }, async (a) => json(renders.cancel(a.job_id)), { destructive: false, idempotent: true });
}
