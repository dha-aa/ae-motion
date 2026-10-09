/**
 * Token meter: an estimate of what ae-motion adds to the model's context, shown in the After Effects panel.
 *
 * The server never sees the client's real token counts (the model runs in the client), so this measures what it
 * does control: the tool results it returns (text at about 3.6 characters per token, images at width x height / 750,
 * Anthropic's formula) and the size of its tool definitions, which the client sends with every request. Each server
 * process writes usage/<pid>.json next to the bridge file (as update.json is shared); the panel reads them. Files
 * older than a week are pruned at startup. Writing never throws: a read-only home only loses the meter.
 */
import fs from "node:fs";
import path from "node:path";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { bridgeFile, SERVER_VERSION } from "./config.js";

const CHARS_PER_TOKEN = 3.6;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export const textTokens = (chars: number): number => Math.ceil(chars / CHARS_PER_TOKEN);

/** Image tokens from a base64 PNG's IHDR size (Anthropic: width * height / 750); a rough fallback otherwise. */
export function imageTokens(base64: string): number {
  try {
    const head = Buffer.from(base64.slice(0, 44), "base64");
    if (head.length >= 24 && head.toString("ascii", 1, 4) === "PNG") {
      const w = head.readUInt32BE(16), h = head.readUInt32BE(20);
      return Math.ceil((Math.min(w, 8000) * Math.min(h, 8000)) / 750);
    }
  } catch { /* fall through */ }
  return Math.ceil((base64.length * 0.75) / 750); // unknown format: about 1 token per 750 bytes
}

interface ToolTally { calls: number; text: number; image: number }

export interface UsageSnapshot {
  pid: number;
  version: string;
  client: string | null;
  started: string;
  updated: string;
  calls: number;
  errors: number;
  /** Estimated tokens of tool results: text and images. */
  result_text_tokens: number;
  image_tokens: number;
  /** Estimated tokens of the tool definitions (sent with every request; most clients cache them). */
  definitions_tokens: number;
  tools: Record<string, ToolTally>;
}

export class UsageMeter {
  private s: UsageSnapshot;
  private timer: NodeJS.Timeout | null = null;
  /** Reports the MCP client's name once it is known (after initialize). */
  clientName: () => string | null = () => null;

  constructor(private readonly dir = path.join(path.dirname(bridgeFile()), "usage")) {
    const now = new Date().toISOString();
    this.s = { pid: process.pid, version: SERVER_VERSION, client: null, started: now, updated: now, calls: 0, errors: 0, result_text_tokens: 0, image_tokens: 0, definitions_tokens: 0, tools: {} };
    this.prune();
  }

  get snapshot(): UsageSnapshot { return this.s; }

  /** Count one tool call's result. */
  record(tool: string, result: CallToolResult): void {
    let text = 0, image = 0;
    for (const c of result.content) {
      if (c.type === "text") text += textTokens(c.text.length);
      else if (c.type === "image") image += imageTokens(c.data);
    }
    const t = (this.s.tools[tool] ??= { calls: 0, text: 0, image: 0 });
    t.calls++; t.text += text; t.image += image;
    this.s.calls++; this.s.result_text_tokens += text; this.s.image_tokens += image;
    if (result.isError) this.s.errors++;
    this.save();
  }

  /** The tools/list the client receives (its size is what every request carries). */
  definitions(toolsJson: string): void {
    this.s.definitions_tokens = textTokens(toolsJson.length);
    this.save();
  }

  /** Write soon (calls come in bursts; one write per burst). */
  private save(): void {
    if (this.timer) return;
    this.timer = setTimeout(() => { this.timer = null; this.flush(); }, 150);
    this.timer.unref?.();
  }

  flush(): void {
    try {
      this.s.updated = new Date().toISOString();
      this.s.client ??= this.clientName();
      fs.mkdirSync(this.dir, { recursive: true });
      fs.writeFileSync(path.join(this.dir, `${process.pid}.json`), JSON.stringify(this.s));
    } catch { /* no meter rather than a failed tool call */ }
  }

  private prune(): void {
    try {
      for (const f of fs.readdirSync(this.dir)) {
        const p = path.join(this.dir, f);
        if (f.endsWith(".json") && Date.now() - fs.statSync(p).mtimeMs > WEEK_MS) fs.unlinkSync(p);
      }
    } catch { /* nothing to prune */ }
  }
}

/** The meter of this server process. */
export const usage = new UsageMeter();
