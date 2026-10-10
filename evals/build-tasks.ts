// Build tasks for `node evals/run.ts --build`: each asks the model to change the fixture project (evals/build-fixture.ts),
// then `check` reads the result through ae-motion's tools and lists what is wrong (an empty list passes). Tasks are
// independent: the fixture is rebuilt before each one. Keep checks to what the task states, with a frame of tolerance.

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
];
