/**
 * Audio: beats as markers, audio-reactive expressions, sound-effect cues and placement. Host side:
 * host/commands/audio.jsx (After Effects' Convert Audio to Keyframes does the loudness analysis).
 */
import { z } from "zod";
import type { ToolRegistry } from "./registry.js";
import { id, LayerIds, PropPath, Time, Value } from "./schemas.js";

export function registerAudioTools(r: ToolRegistry): void {
  r.bridged(
    "beat_markers",
    'Mark the beats of an audio layer (comp markers, or the layer\'s with on: "layer"; comment "beat") for align_to_markers or keyframes. Detected from loudness (clear drums work best; sensitivity 0-1), or a bpm grid from offset; every: 4 = one per bar. Replaces earlier "beat" markers in range. Returns times and tempo.',
    {
      audio_layer_id: id("Audio layer"), bpm: z.number().positive().optional(), offset: Time.optional().describe("First bpm beat (default: in point)"),
      every: z.number().int().min(1).optional(), sensitivity: z.number().min(0).max(1).optional(), min_gap: z.number().min(0).optional().describe("Min seconds between beats (0.2)"),
      start: Time.optional(), end: Time.optional(), on: z.enum(["comp", "layer"]).optional(), replace: z.boolean().optional(),
      keep_amplitude: z.boolean().optional(),
    },
    { tooLargeHint: "Limit start/end or use every" },
  );

  r.bridged(
    "audio_react",
    "Drive a property with an audio layer's loudness (pulse, bounce, glow): from at the quiet level, to at the peaks, smoothed over smoothing frames. One expression on every layer, via a shared amplitude null.",
    {
      audio_layer_id: id("Audio layer"), layer_ids: LayerIds, path: PropPath, from: Value, to: Value,
      channel: z.enum(["both", "left", "right"]).optional(), smoothing: z.number().int().min(1).max(30).optional(),
    },
  );

  r.bridged(
    "find_sound_cues",
    "Pick where a comp wants sound effects, as a sound designer would: landings (impact), cuts (hit), big moves and spins (whoosh at peak speed), pops, reveals, type-ons, draw-ons. One frame is one cue (layer_ids). Cues are ranked (priority, tier hero|major|minor); the most important are kept, spaced out: density sparse|normal|dense (~1 / 1.6 / 3.5 per s) or max, min_gap. Few sounds read better than many. events: what moments mean to the story (importance 0-1): the nearest motion cue within 0.5 s takes it, keeping its exact frame (story: label); an event with no motion is its own cue; importance 0 mutes that moment. Pass each t to add_sfx.",
    {
      comp_id: id("Comp"), layer_ids: LayerIds.optional(), start: Time.optional(), end: Time.optional(), max: z.number().int().min(1).max(200).optional(),
      density: z.enum(["sparse", "normal", "dense"]).optional(), min_gap: z.number().min(0).optional(),
      events: z.array(z.strictObject({ t: Time, importance: z.number().min(0).max(1), label: z.string().optional(), sound: z.string().optional() })).max(100).optional(),
    },
    { readOnly: true, tooLargeHint: "Narrow start/end or layer_ids, or lower max" },
  );

  r.bridged(
    "add_sfx",
    "Place a sound file so it hits at time: align peak (default) lines up the sound's loudest moment (a whoosh's middle, a pop's attack), start its first frame. volume in dB (default -6), fade_in/fade_out seconds. lead_in keeps only that much of the sound before the hit (cuts a long build-up); max_duration trims the end (from the hit with peak, from the start with start). Repeated files are imported once.",
    {
      comp_id: id("Comp"), path: z.string(), time: Time, align: z.enum(["peak", "start"]).optional(), volume: z.number().max(24).optional(),
      fade_in: z.number().min(0).optional(), fade_out: z.number().min(0).optional(), max_duration: z.number().positive().optional(), lead_in: z.number().min(0).optional(), name: z.string().optional(),
    },
    { paths: ["path"], destructive: false },
  );

  r.bridged(
    "duck_music",
    'Lower the music under voice-over and sound effects (default: every other audio layer): by amount dB (default -6), easing over attack (0.15 s) and release (0.4 s). Long layers duck only where they are actually heard (mode auto; span = whole layer, loudness = always measure). Effects quieter than min_level (-9 dB) are ignored; coverage = share of the music ducked. dips: near-silence over start-end (amount default -60, fade 0.05 s), e.g. a pause before a reveal; dips without under_layer_ids leave the ducks as they are. Ducks and dips are markers read by one expression; volume keys (fades) work under it; re-running replaces each kind it sets.',
    {
      music_layer_id: id("Music layer"), under_layer_ids: LayerIds.optional(), amount: z.number().max(0).optional(),
      attack: z.number().min(0).optional(), release: z.number().min(0).optional(), mode: z.enum(["auto", "span", "loudness"]).optional(), min_level: z.number().optional(),
      dips: z.array(z.strictObject({ start: z.number().min(0), end: z.number().positive(), amount: z.number().max(0).optional(), fade: z.number().min(0).optional() })).min(1).max(50).optional(),
    },
    { idempotent: true },
  );
}
