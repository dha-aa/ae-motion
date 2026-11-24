/**
 * Motion vocabulary: entrance/exit moves with springs, text reveals, shape transitions and a motion review.
 * Host side: host/commands/motion.jsx.
 */
import { z } from "zod";
import type { BridgeResult } from "../bridge.js";
import { fromBridge, json, type ToolRegistry } from "./registry.js";
import { Color, id, LayerIds, Pt, Time } from "./schemas.js";

type Issue = { severity?: string; t?: unknown };
type Review = { issues: Issue[]; stats: Record<string, unknown> };

/** An issue's sort time as the host's comparator reads it: a number, the first of a list, else 0. */
const issueTime = (x: Issue): number => (typeof x.t === "number" ? x.t : Array.isArray(x.t) && typeof x.t[0] === "number" ? x.t[0] : 0);

/** The host answered "Unknown command": After Effects still runs a host.jsx from before that command (the installer
 * not re-run, or the panel not reopened). */
const unknownCommand = (r: BridgeResult): boolean => !r.ok && r.error.code === "BAD_ARGS" && /^Unknown command/.test(r.error.message);

/**
 * review_motion's result with review_text's issues merged in, in the host's order (warnings first, then by
 * time) and cut to max, with the rest counted in stats.more_issues as the host does.
 */
export function withSmallText(review: Review, small: Issue[], max: number): Review {
  if (!small.length) return review;
  const rank = (x: Issue) => (x.severity === "warn" ? 0 : 1);
  const issues = [...review.issues, ...small].sort((x, y) => rank(x) - rank(y) || issueTime(x) - issueTime(y));
  const stats = { ...review.stats };
  if (issues.length > max) { stats.more_issues = (typeof stats.more_issues === "number" ? stats.more_issues : 0) + issues.length - max; issues.length = max; }
  return { issues, stats };
}

const Curve = z.enum(["snappy", "smooth", "spring", "bounce", "linear"]);
const Dir = z.enum(["up", "down", "left", "right"]);

export function registerMotionTools(r: ToolRegistry): void {
  r.bridged(
    "animate",
    "Animate layers with a named move, keyed from their current values. In/out: fade, pop (scale from 0), grow (from 80%), slide (direction of travel, default up), drop, spin; style snappy (default), smooth, spring (default pop/spin), bounce (default drop), linear; exits accelerate; springs are expressions on the keys; time defaults to the in point (out: out point - duration). Through a hold, so the frame never freezes: push (slow scale-up by amount %, default 4) and drift (slow float by distance px, default 2% of the comp height, toward direction); they start where the layer's animation lands (keeping its landing ease) and run to its out point; style smooth (default) or linear. Layer i starts i * stagger later.",
    {
      layer_ids: LayerIds, move: z.enum(["fade", "pop", "grow", "slide", "drop", "spin", "push", "drift"]), phase: z.enum(["in", "out"]).optional(),
      time: Time.optional(), duration: z.number().positive().optional(), amount: z.number().positive().max(50).optional(),
      style: Curve.optional(), direction: Dir.optional(), distance: z.number().positive().optional(),
      stagger: z.number().min(0).optional(), order: z.enum(["forward", "reverse"]).optional(),
    },
  );

  r.bridged(
    "text_reveal",
    "Reveal (phase out: hide) a text layer unit by unit (text animator + expression selector). Each unit takes duration and starts stagger after the previous. mask clips rise/drop at a line so letters slide out from behind it. Returns the end time.",
    {
      layer_id: id("Text layer"), style: z.enum(["rise", "drop", "fade", "pop", "blur", "typewriter"]).optional(), by: z.enum(["chars", "words", "lines"]).optional(),
      phase: z.enum(["in", "out"]).optional(), time: Time.optional(), duration: z.number().min(0).optional(),
      stagger: z.number().min(0).optional(),
      ease: Curve.optional(), order: z.enum(["forward", "reverse", "center", "random"]).optional(), distance: z.number().positive().optional(), mask: z.boolean().optional(),
    },
  );

  r.bridged(
    "transition",
    "Add a shape transition on top that covers the frame at time (cut scenes there) and clears by time + duration/2: wipe, bars (staggered stripes) or iris (disc grows, then opens from its centre).",
    {
      comp_id: id("Comp"), time: Time, type: z.enum(["wipe", "bars", "iris"]).optional(), duration: z.number().positive().optional(),
      color: Color.optional(), direction: Dir.optional(), bars: z.number().int().min(2).max(20).optional(), center: Pt.optional().describe("iris centre in comp px"),
    },
    { destructive: false },
  );

  // Two host calls: review_text (the small-text check and old reveals' lengths), then the review. Reading
  // TextDocuments inside the review's call corrupted ExtendScript's memory in After Effects 27.0 and crashed it soon
  // after (host/CLAUDE.md); in a call of their own they are safe. A host.jsx from before review_text does the whole
  // review in its review_motion.
  r.tool(
    "review_motion",
    "Critique a comp's animation without rendering (cheap, no image): linear easing, holds over max_hold (changes too small to see don't count as motion: fix holds with animate push / drift), a first move later than 0.3 s, layers moving in unison, entrances with no animation, moves cut off by out points, jumps, text under min_text px (default 3% of the comp's short side), share of moves on beat markers; layers hidden behind opaque ones (3D: by depth), off screen, a background that stops filling the frame, text partly covered, text crossing the 5% title-safe margin (vertical comps: the top 10% and bottom 20% social apps cover) (scene false skips). Run after each scene and fix every warning.",
    {
      comp_id: id("Comp"), max_hold: z.number().positive().optional(), min_text: z.number().positive().optional(),
      max: z.number().int().min(1).max(100).optional().describe("Issues listed (default 30; more_issues counts the rest)"), all: z.boolean().optional().describe("List info notes too (default: counted in stats.info)"), scene: z.boolean().optional(),
    },
    async (a, extra) => {
      const signal = extra?.mcpReq?.signal;
      const text = await r.deps.bridge.run("review_text", a.min_text === undefined ? { comp_id: a.comp_id } : { comp_id: a.comp_id, min_text: a.min_text }, undefined, signal);
      if (!text.ok && !unknownCommand(text)) return fromBridge(text);
      const found = text.ok ? (text.result as { issues: Issue[]; reveal_units?: Record<string, number> }) : undefined;
      const review = await r.deps.bridge.run("review_motion", found?.reveal_units ? { ...a, reveal_units: found.reveal_units } : { ...a }, undefined, signal);
      if (!review.ok || !found) return fromBridge(review);
      return json(withSmallText(review.result as Review, found.issues, a.max ?? 30));
    },
    { readOnly: true },
  );
}
