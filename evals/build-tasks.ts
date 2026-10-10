// Build tasks for `node evals/run.ts --build`: each asks the model to change the fixture project (evals/build-fixture.ts),
// then `check` reads the result through ae-motion's tools and lists what is wrong (an empty list passes). Tasks are
// independent: the fixture is rebuilt before each one. Keep checks to what the task states, with a frame of tolerance.

import { MUSIC_BEATS } from "./build-fixture.ts";

type Json = Record<string, any>;
export type Call = (tool: string, args?: Json) => Promise<any>;
export type BuildTask = { n: number; task: string; check: (call: Call) => Promise<string[]> };

const FRAME = 1 / 30;
const near = (a: number, b: number, tol: number): boolean => typeof a === "number" && Math.abs(a - b) <= tol;

async function comp(call: Call, name: string): Promise<Json> {
  const item = (await call("get_project")).items.find((i: Json) => i.name === name && i.type === "comp");
  if (!item) throw new Error(`no comp named ${name}`);
  return call("get_comp", { comp_id: item.id });
}
/** The original fixture layers of Main, so a check can find what the model added. */
const MAIN_LAYERS = new Set(["BG", "Title", "Subtitle", "Scene A", "Scene B", "Scene C", "Rig", "Cam", "Music"]);
async function layer(call: Call, compName: string, layerName: string, time?: number): Promise<Json | null> {
  const l = (await comp(call, compName)).layers.find((x: Json) => x.name === layerName);
  return l ? call("get_layer", { layer_id: l.id, ...(time === undefined ? {} : { time }) }) : null;
}

export const TASKS: BuildTask[] = [
  {
    n: 1,
    task: "In the Main comp, add a text layer named \"Lower Third\" that reads \"Jane Doe, Founder\". It should slide in from off the left edge of the frame to x = 300 between 3 and 3.6 seconds, eased (not linear), staying at y = 900 the whole time.",
    async check(call) {
      const bad: string[] = [];
      const l = await layer(call, "Main", "Lower Third");
      if (!l) return ["no layer named Lower Third in Main"];
      if (l.kind !== "text") bad.push(`kind ${l.kind}, not text`);
      if (l.text !== "Jane Doe, Founder") bad.push(`text ${JSON.stringify(l.text)}`);
      const k = (await call("get_keyframes", { layer_id: l.id, path: "position" })).keys;
      const first = k[0], last = k[k.length - 1];
      if (!first || !near(first.t, 3, FRAME) || !(first.v[0] < 0)) bad.push(`first position key should be at 3 s with x < 0: ${JSON.stringify(first)}`);
      if (!last || !near(last.t, 3.6, FRAME) || !near(last.v[0], 300, 1)) bad.push(`last position key should be at 3.6 s with x = 300: ${JSON.stringify(last)}`);
      if (k.some((x: Json) => !near(x.v[1], 900, 1))) bad.push("y is not 900 at every key");
      if (first && first.interp_out === "linear" && last.interp_in === "linear") bad.push("linear, not eased");
      return bad;
    },
  },
  {
    n: 2,
    task: "In the Scene A comp, fade every card out over the last second of the comp: fully visible one second before the comp ends, fully transparent at its end.",
    async check(call) {
      const bad: string[] = [];
      const c = await comp(call, "Scene A");
      for (let n = 1; n <= 5; n++) {
        const id = c.layers.find((x: Json) => x.name === `Card ${n}`)?.id;
        if (!id) { bad.push(`Card ${n} missing`); continue; }
        const at = async (t: number): Promise<number> => (await call("get_layer", { layer_id: id, time: t })).transform.opacity;
        const a = await at(c.duration - 1), b = await at(c.duration - FRAME);
        if (!near(a, 100, 0.5)) bad.push(`Card ${n} opacity ${a} one second before the end`);
        if (!(b <= 5)) bad.push(`Card ${n} opacity ${b} on the last frame`);
      }
      return bad;
    },
  },
  {
    n: 3,
    task: "In the Scene A comp, make the cards come on screen in order from Card 1 to Card 5, 0.2 seconds apart, with Card 1 appearing at 0.5 seconds.",
    async check(call) {
      const bad: string[] = [];
      const c = await comp(call, "Scene A");
      const ids = [1, 2, 3, 4, 5].map((n) => c.layers.find((x: Json) => x.name === `Card ${n}`)?.id);
      if (ids.some((x) => !x)) return ["a card is missing"];
      const ls = (await call("get_layer", { layer_ids: ids })).layers;
      ls.forEach((l: Json, i: number) => { const want = 0.5 + 0.2 * i; if (!near(l.in ?? 0, want, FRAME)) bad.push(`Card ${i + 1} appears at ${l.in ?? 0}, not ${want}`); });
      return bad;
    },
  },
  {
    n: 4,
    task: "In the Main comp, add a comp marker at the moment each scene layer starts, with the marker's comment set to that scene layer's name. Keep the existing markers.",
    async check(call) {
      const bad: string[] = [];
      const c = await comp(call, "Main");
      const markers = (await call("list_markers", { comp_id: c.id })).markers;
      for (const [name, t] of [["Scene A", 2], ["Scene B", 8], ["Scene C", 14]] as const) {
        if (!markers.some((m: Json) => near(m.time, t, FRAME) && m.comment === name)) bad.push(`no marker "${name}" at ${t} s`);
      }
      for (const [name, t] of [["Cold open", 0], ["Problem", 6.5], ["Turn", 12], ["Outro", 18]] as const) {
        if (!markers.some((m: Json) => near(m.time, t, FRAME) && m.comment === name)) bad.push(`existing marker "${name}" lost`);
      }
      return bad;
    },
  },
  {
    n: 5,
    task: "The background plate in Scene B is blurred too little: set its blur to 50.",
    async check(call) {
      const l = await layer(call, "Scene B", "Plate");
      if (!l) return ["Plate missing"];
      const p = await call("list_properties", { layer_id: l.id, group_path: ["ADBE Effect Parade", 1], depth: 1 });
      const v = JSON.stringify(p);
      if (!/Gaussian/.test(v)) return ["the Plate's first effect is no longer Gaussian Blur: " + v.slice(0, 200)];
      return /"value":50\b/.test(v) ? [] : ["blurriness is not 50: " + v.slice(0, 300)];
    },
  },
  {
    n: 6,
    task: "In the Main comp, make the camera finish its move earlier: it should reach its final position at 7.5 seconds instead of 9.5. Keep its other keyframes where they are.",
    async check(call) {
      const bad: string[] = [];
      const l = await layer(call, "Main", "Cam");
      if (!l) return ["Cam missing"];
      const k = (await call("get_keyframes", { layer_id: l.id, path: "position" })).keys;
      const want = [[0, [960, 540, -2200]], [4, [900, 520, -1900]], [7.5, [960, 540, -1500]]] as const;
      if (k.length !== 3) bad.push(`${k.length} position keys, not 3`);
      want.forEach(([t, v], i) => {
        const key = k[i];
        if (!key || !near(key.t, t, FRAME) || v.some((x, j) => !near(key.v[j], x, 0.5))) bad.push(`key ${i + 1} should be ${JSON.stringify(v)} at ${t} s: ${JSON.stringify(key)}`);
      });
      return bad;
    },
  },
  {
    n: 7,
    task: "In the Logo Lockup comp, centre the Wordmark text horizontally in the frame, keeping its vertical position.",
    async check(call) {
      const l = await layer(call, "Logo Lockup", "Wordmark", 2);
      if (!l) return ["Wordmark missing"];
      const bad: string[] = [];
      const b = l.bounds.comp;
      if (!near(b.center[0], 400, 1.5)) bad.push(`text centre x ${b.center[0]}, not 400`);
      if (!near(l.transform.position[1], 650, 1)) bad.push(`y moved to ${l.transform.position[1]}`);
      return bad;
    },
  },
  {
    n: 8,
    task: "In the Main comp, after the camera's current move ends, add a slow push-in: from 10 to 13 seconds the camera should move 400 px closer to the comp, eased. Keep its earlier keyframes.",
    async check(call) {
      const bad: string[] = [];
      const l = await layer(call, "Main", "Cam");
      if (!l) return ["Cam missing"];
      const k = (await call("get_keyframes", { layer_id: l.id, path: "position" })).keys;
      for (const [t, v] of [[0, [960, 540, -2200]], [4, [900, 520, -1900]], [9.5, [960, 540, -1500]]] as const) {
        if (!k.some((x: Json) => near(x.t, t, FRAME) && v.every((c, j) => near(x.v[j], c, 0.5)))) bad.push(`the key at ${t} s changed or went`);
      }
      const at = async (t: number): Promise<number[]> => (await call("get_camera", { layer_id: l.id, time: t })).position;
      const p10 = await at(10), p13 = await at(13), q = await at(10.75); // a quarter in: linear is at -1400 (half way, ease-in-out matches linear)
      if (![960, 540, -1500].every((c, j) => near(p10[j], c, 1))) bad.push(`at 10 s the camera is at ${JSON.stringify(p10)}, not where the first move ended`);
      if (!near(p13[2], -1100, 2) || !near(p13[0], 960, 1) || !near(p13[1], 540, 1)) bad.push(`at 13 s the camera is at ${JSON.stringify(p13)}, not 400 px closer ([960, 540, -1100])`);
      if (near(q[2], -1400, 1)) bad.push("linear between 10 and 13 s, not eased");
      return bad;
    },
  },
  {
    n: 9,
    task: "In the Main comp, make the Title text reveal word by word, starting at 0.5 seconds.",
    async check(call) {
      const l = await layer(call, "Main", "Title");
      if (!l) return ["Title missing"];
      const props = JSON.stringify(await call("list_properties", { layer_id: l.id, group_path: ["ADBE Text Properties", "ADBE Text Animators"], depth: 4, all: true }));
      const bad: string[] = [];
      if (!/ae-motion reveal/.test(props) && !/"match_name":"ADBE Text Selector"/.test(props)) return ["no reveal animator on the Title"];
      // text_reveal: an expression selector timed from t0, based on words (3); or a hand-made range selector keyed from 0.5
      if (/ae-motion reveal/.test(props)) {
        if (!/t0=0\.5\b/.test(props)) bad.push("the reveal does not start at 0.5 s");
        if (!/"match_name":"ADBE Text Range Type2"[^}]*"value":3\b/.test(props)) bad.push("the reveal is not based on words");
      } else bad.push("not a reveal the checker understands (no text_reveal expression)");
      return bad;
    },
  },
  {
    n: 10,
    task: "In the Main comp, add a wipe transition that fully covers the frame exactly when Scene B starts, to hide the cut.",
    async check(call) {
      const c = await comp(call, "Main");
      const added = c.layers.filter((x: Json) => !MAIN_LAYERS.has(x.name));
      if (!added.length) return ["no transition layer added"];
      for (const a of added) {
        const g = await call("get_layer", { layer_id: a.id, time: 8 });
        const b = g.bounds?.comp;
        if ((g.in ?? 0) <= 8 && (g.out ?? 20) > 8 && b && b.left <= 0.5 && b.top <= 0.5 && b.right >= 1919.5 && b.bottom >= 1079.5 && g.transform.opacity >= 99) return [];
      }
      return [`no added layer covers the whole frame at 8 s (added: ${added.map((x: Json) => x.name).join(", ")})`];
    },
  },
  {
    n: 11,
    task: "The Main comp has a music track. Put a comp marker on each of its beats.",
    async check(call) {
      const c = await comp(call, "Main");
      const markers = (await call("list_markers", { comp_id: c.id })).markers;
      const sections = ["Cold open", "Problem", "Turn", "Outro"];
      const others = markers.filter((m: Json) => !sections.includes(m.comment));
      const hit = MUSIC_BEATS.filter((b) => others.some((m: Json) => near(m.time, b, 1.5 * FRAME))).length;
      const stray = others.filter((m: Json) => !MUSIC_BEATS.some((b) => near(m.time, b, 1.5 * FRAME))).length;
      const bad: string[] = [];
      if (hit < 15) bad.push(`${hit} of the 16 beats have a comp marker`);
      if (stray > 1) bad.push(`${stray} markers are not on a beat`);
      if (markers.filter((m: Json) => sections.includes(m.comment)).length !== 4) bad.push("a section marker went");
      return bad;
    },
  },
  {
    n: 12,
    task: "In the Scene A comp, make every card pop in with a springy scale-up when it appears, each at its own start time.",
    async check(call) {
      const bad: string[] = [];
      const c = await comp(call, "Scene A");
      for (let n = 1; n <= 5; n++) {
        const id = c.layers.find((x: Json) => x.name === `Card ${n}`)?.id;
        if (!id) { bad.push(`Card ${n} missing`); continue; }
        const inT = 2.4 - 0.4 * n;
        const k = await call("get_keyframes", { layer_id: id, path: "scale" });
        const first = k.keys[0];
        if (!first || !near(first.t, inT, FRAME) || !(first.v[0] <= 5)) bad.push(`Card ${n} does not scale up from about 0 at ${inT} s`);
        const v = (t: number): Promise<number> => call("get_layer", { layer_id: id, time: t }).then((g: Json) => g.transform.scale[0]);
        const samples = await Promise.all([0.15, 0.25, 0.35, 0.45].map((d) => v(inT + d)));
        if (!(Math.max(...samples) > 100.5)) bad.push(`Card ${n} has no spring overshoot (${samples.map((x) => Math.round(x)).join(", ")})`);
      }
      return bad;
    },
  },
  {
    n: 13,
    task: "In the Scene A comp, turn Card 3 into a 3D layer and push it 300 px further away from the viewer, keeping its place on screen otherwise.",
    async check(call) {
      const l = await layer(call, "Scene A", "Card 3");
      if (!l) return ["Card 3 missing"];
      const bad: string[] = [];
      if (l.three_d !== true) bad.push("not 3D");
      if (!near(l.transform.position[2], 300, 0.5)) bad.push(`z is ${l.transform.position[2]}, not 300`);
      if (!near(l.transform.position[0], 960, 0.5) || !near(l.transform.position[1], 540, 0.5)) bad.push(`x/y moved to ${l.transform.position.slice(0, 2)}`);
      return bad;
    },
  },
];
