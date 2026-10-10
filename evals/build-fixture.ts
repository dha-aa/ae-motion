// Writes evals/fixture.jsonl: the driver script that builds the fixed After Effects project the evaluation
// questions are about. Run with `node evals/build-fixture.ts`, then build it in AE with
// `node .claude/skills/run-ae-motion/driver.ts script evals/fixture.jsonl` (evals/run.ts does both).
// Changing anything here can change answers in evals/evaluation.xml: re-verify them.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

type Step = { tool: string; args: Record<string, unknown> };
const steps: Step[] = [];
const step = (tool: string, args: Record<string, unknown>): number => steps.push({ tool, args }) - 1;
const id = (i: number): string => `$${i}.id`;
const text = (comp: number, name: string, txt: string, size: number, extra: Record<string, unknown> = {}): number =>
  step("add_layer", { comp_id: id(comp), kind: "text", options: { name, text: txt, text_style: { size }, ...extra } });
const blur = (layer: number, amount: number): number =>
  step("apply_effect", { layer_id: id(layer), match_name: "ADBE Gaussian Blur 2", params: { "ADBE Gaussian Blur 2-0001": amount } });

step("open_project", { new: true, discard_unsaved: true });

// Logo Lockup: 25 fps, nested two levels below Main (Main > Scene C > Logo Lockup)
const lockup = step("create_comp", { name: "Logo Lockup", width: 800, height: 800, fps: 25, duration: 4 });
const logo = step("add_layer", { comp_id: id(lockup), kind: "shape", options: { name: "Logo", in: 0.5, shape: { type: "ellipse", size: [300, 300], fill: [0.95, 0.55, 0.15] } } });
step("set_keyframes", { layer_id: id(logo), path: "scale", keys: [{ t: 0.5, v: [0, 0], interp: "spring" }, { t: 1.1, v: [100, 100] }] });
text(lockup, "Wordmark", "NORTHWIND", 96, { in: 1.2, position: [400, 650] });

// Scene A: five cards entering in reverse order (Card 5 first, Card 1 last); Card 3 shakes, Card 4 is blurred
const sceneA = step("create_comp", { name: "Scene A", width: 1920, height: 1080, fps: 30, duration: 6 });
for (let n = 1; n <= 5; n++) {
  const card = step("add_layer", { comp_id: id(sceneA), kind: "shape", options: { name: `Card ${n}`, in: 2.4 - 0.4 * n, position: [320 * n, 540], shape: { type: "rect", size: [260, 360], roundness: 24, fill: [0.2, 0.3 + 0.1 * n, 0.8] } } });
  if (n === 3) step("set_expression", { layer_id: id(card), path: "rotation", expression: "wiggle(3, 15)" });
  if (n === 4) blur(card, 12);
}

// Scene B: words appearing out of their stacking order; a matte layer whose name differs from its text
const sceneB = step("create_comp", { name: "Scene B", width: 1920, height: 1080, fps: 30, duration: 6 });
const plate = step("add_layer", { comp_id: id(sceneB), kind: "solid", options: { name: "Plate", color: [0.1, 0.1, 0.12] } });
blur(plate, 30);
for (const [name, word, t, y] of [["Line A", "BUILD", 0.3, 300], ["Line B", "SHIP", 1.0, 450], ["Line C", "WINS", 2.4, 600], ["Line D", "DISTRIBUTE", 1.7, 750]] as const)
  text(sceneB, name, word, 110, { in: t, position: [960, y] });
const fill = step("add_layer", { comp_id: id(sceneB), kind: "solid", options: { name: "Fill", color: [0.9, 0.2, 0.3] } });
const cutout = text(sceneB, "Cutout", "REACH", 300, { position: [960, 560] });
step("set_track_matte", { layer_id: id(fill), matte_layer_id: id(cutout), type: "alpha" });

// Scene C: the lockup starts 1.5 s in (so the logo shows at 1.5 + 0.5 = 2 s of Scene C)
const sceneC = step("create_comp", { name: "Scene C", width: 1920, height: 1080, fps: 30, duration: 6 });
step("add_layer", { comp_id: id(sceneC), kind: "precomp", options: { name: "Lockup", item_id: id(lockup), start: 1.5 } });

// Main: scenes at 2, 8 and 14 s (logo first visible at 14 + 2 = 16 s), section markers, a camera, a null with three children
const main = step("create_comp", { name: "Main", width: 1920, height: 1080, fps: 30, duration: 20 });
step("add_layer", { comp_id: id(main), kind: "solid", options: { name: "BG", color: [0.05, 0.05, 0.07] } });
const title = text(main, "Title", "THE NEXT MOAT", 140, { position: [960, 480] });
step("set_keyframes", { layer_id: id(title), path: "position", keys: [{ t: 0, v: [960, 560], ease_out: "easy" }, { t: 1, v: [960, 480], ease_in: "easy" }] });
const subtitle = text(main, "Subtitle", "Distribution beats features", 64, { position: [960, 600] });
step("add_layer", { comp_id: id(main), kind: "precomp", options: { name: "Scene A", item_id: id(sceneA), start: 2 } });
const layerB = step("add_layer", { comp_id: id(main), kind: "precomp", options: { name: "Scene B", item_id: id(sceneB), start: 8 } });
step("add_layer", { comp_id: id(main), kind: "precomp", options: { name: "Scene C", item_id: id(sceneC), start: 14 } });
step("link_layers", { layer_ids: [id(title), id(subtitle), id(layerB)], new_null: { name: "Rig", position: [960, 540] } });
const cam = step("add_layer", { comp_id: id(main), kind: "camera", options: { name: "Cam" } });
step("set_keyframes", { layer_id: id(cam), path: "position", keys: [{ t: 0, v: [960, 540, -2200] }, { t: 4, v: [900, 520, -1900] }, { t: 9.5, v: [960, 540, -1500] }] });
for (const [t, comment] of [[0, "Cold open"], [6.5, "Problem"], [12, "Turn"], [18, "Outro"]] as const) step("add_marker", { comp_id: id(main), time: t, comment });

const out = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixture.jsonl");
fs.writeFileSync(out, steps.map((s) => JSON.stringify(s)).join("\n") + "\n");
console.log(`${steps.length} steps -> ${path.relative(process.cwd(), out)}`);
