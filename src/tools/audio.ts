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
    "List the moments in a comp's animation that want a sound effect, from its keyframes: fast moves and spins (whoosh, at peak speed), abrupt landings (impact), scale pops (pop), type-ons (typing) and draw-ons (swipe, with duration), entrances (pop). Each cue's t is when the sound should hit: pass it to add_sfx.",
    { comp_id: id("Comp"), layer_ids: LayerIds.optional(), start: Time.optional(), end: Time.optional(), max: z.number().int().min(1).max(200).optional() },
    { readOnly: true, tooLargeHint: "Narrow start/end or layer_ids, or lower max" },
  );

  r.bridged(
    "add_sfx",
    "Place a sound file so it hits at time: align peak (default) lines up the sound's loudest moment (a whoosh's middle, a pop's attack), start its first frame. volume in dB (default -6), fade_in/fade_out seconds, max_duration trims. Repeated files are imported once.",
    {
      comp_id: id("Comp"), path: z.string(), time: Time, align: z.enum(["peak", "start"]).optional(), volume: z.number().max(24).optional(),
      fade_in: z.number().min(0).optional(), fade_out: z.number().min(0).optional(), max_duration: z.number().positive().optional(), name: z.string().optional(),
    },
    { paths: ["path"], destructive: false },
  );

  r.bridged(
    "duck_music",
    'Lower the music under voice-over and sound effects (default: every other audio layer): by amount dB (default -10), easing down over attack (0.15 s) before each sound and back up over release (0.4 s). Long layers duck only where they are actually heard (mode auto; span = whole layer, loudness = always measure). Ducks are "duck" markers on the music read by one expression, so its volume keys keep working; re-running replaces them.',
    {
      music_layer_id: id("Music layer"), under_layer_ids: LayerIds.optional(), amount: z.number().max(0).optional(),
      attack: z.number().min(0).optional(), release: z.number().min(0).optional(), mode: z.enum(["auto", "span", "loudness"]).optional(),
    },
    { idempotent: true },
  );
}
