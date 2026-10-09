// Preview images are shrunk before they reach the model (dist/render/image.js): sizes, contact sheet layout, colors.
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { PNG } from "pngjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { shrinkPng, contactSheet } = await import(pathToFileURL(path.join(ROOT, "dist", "render", "image.js")).href);
const { imageTokens, textTokens, UsageMeter } = await import(pathToFileURL(path.join(ROOT, "dist", "usage.js")).href);
const results: [name: string, pass: boolean, msg?: string][] = [];
const errText = (e: unknown): string => (e instanceof Error ? e.message : String(e));
const t = (name: string, fn: () => void): void => { try { fn(); results.push([name, true]); } catch (e) { results.push([name, false, errText(e)]); } };

/** A solid-color PNG. */
function png(w: number, h: number, rgb: [number, number, number]): Buffer {
  const p = new PNG({ width: w, height: h });
  for (let i = 0; i < w * h; i++) p.data.set([...rgb, 255], i * 4);
  return PNG.sync.write(p);
}
const read = (b: Buffer): PNG => PNG.sync.read(b);
const px = (p: PNG, x: number, y: number): number[] => [...p.data.subarray((y * p.width + x) * 4, (y * p.width + x) * 4 + 4)];

t("a full HD frame shrinks to 768 px on its longest edge, keeping its aspect and color", () => {
  const out = read(shrinkPng(png(1920, 1080, [200, 40, 10]), 768));
  assert.deepEqual([out.width, out.height], [768, 432]);
  assert.deepEqual(px(out, 100, 100), [200, 40, 10, 255]);
});

t("token meter: image tokens from the PNG size (w * h / 750), text at ~3.6 chars per token, tallies per tool", () => {
  assert.equal(imageTokens(png(768, 432, [1, 2, 3]).toString("base64")), Math.ceil(768 * 432 / 750)); // ~443, the default preview
  assert.equal(textTokens(360), 100);
  const m = new UsageMeter(path.join(ROOT, "build", "usage-test"));
  m.record("preview_frame", { content: [{ type: "text", text: "x".repeat(36) }, { type: "image", data: png(768, 432, [0, 0, 0]).toString("base64"), mimeType: "image/png" }] });
  m.record("get_comp", { content: [{ type: "text", text: "y".repeat(72) }], isError: true });
  const s = m.snapshot;
  assert.deepEqual([s.calls, s.errors, s.result_text_tokens, s.image_tokens], [2, 1, 30, 443]);
  assert.deepEqual(s.tools.preview_frame, { calls: 1, text: 10, image: 443 });
});

t("small images and non-PNG bytes are returned unchanged", () => {
  const small = png(300, 200, [0, 0, 0]);
  assert.equal(shrinkPng(small, 768), small);
  const junk = Buffer.from("not a png");
  assert.equal(shrinkPng(junk, 768), junk);
});

t("a contact sheet tiles frames left to right, top to bottom, within the size", () => {
  const colors: [number, number, number][] = [[255, 0, 0], [0, 255, 0], [0, 0, 255], [255, 255, 0]];
  const out = read(contactSheet(colors.map((c) => png(1920, 1080, c)), 1152));
  assert.ok(Math.max(out.width, out.height) <= 1152, `${out.width}x${out.height}`);
  const cw = (out.width - 4) / 2, ch = (out.height - 4) / 2;
  assert.deepEqual(px(out, 10, 10).slice(0, 3), [255, 0, 0]);
  assert.deepEqual(px(out, cw + 14, 10).slice(0, 3), [0, 255, 0]);
  assert.deepEqual(px(out, 10, ch + 14).slice(0, 3), [0, 0, 255]);
  assert.deepEqual(px(out, cw + 14, ch + 14).slice(0, 3), [255, 255, 0]);
});

for (const [name, pass, msg] of results) console.log((pass ? "PASS" : "FAIL") + "  " + name + (pass ? "" : "\n      " + msg));
process.exit(results.every((x) => x[1]) ? 0 : 1);
