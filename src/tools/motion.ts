/**
 * Motion vocabulary: entrance/exit moves with springs, text reveals, shape transitions and a motion review.
 * Host side: host/commands/motion.jsx.
 */
import { z } from "zod";
import type { ToolRegistry } from "./registry.js";
import { Color, id, LayerIds, Pt, Time } from "./schemas.js";

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

  r.bridged(
    "review_motion",
    "Critique a comp's animation without rendering (cheap, no image): linear easing, holds over max_hold (changes too small to see don't count as motion: fix holds with animate push / drift), a first move later than 0.3 s, layers moving in unison, entrances with no animation, moves cut off by out points, jumps, text under min_text px (default 3% of the comp's short side), share of moves on beat markers; layers hidden behind opaque ones (3D: by depth), off screen, text partly covered, text crossing the 5% title-safe margin (vertical comps: the top 10% and bottom 20% social apps cover) (scene false skips). Run after each scene and fix every warning.",
    {
      comp_id: id("Comp"), max_hold: z.number().positive().optional(), min_text: z.number().positive().optional(),
      max: z.number().int().min(1).max(100).optional(), all: z.boolean().optional().describe("List info notes too (default: counted in stats.info)"), scene: z.boolean().optional(),
    },
    { readOnly: true },
  );
}
