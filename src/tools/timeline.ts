/** Timeline editing, marker and audio tools. Host side: host/commands/timeline.jsx, host/commands/audio.jsx. */
import { z } from "zod";
import type { ToolRegistry } from "./registry.js";
import { id, Label, LayerIds, PropPath, Time, Value } from "./schemas.js";

const MarkerTarget = {
  layer_id: z.number().int().optional().describe("Layer id (omit for a comp marker)"),
  comp_id: z.number().int().optional().describe("Comp id (omit for a layer marker)"),
};

export function registerTimelineTools(r: ToolRegistry): void {
  r.bridged(
    "split_layer",
    "Split layers at a comp time, like Edit > Split Layer (Cmd/Ctrl+Shift+D). Each layer keeps its first part; a copy above it holds the second part. Times snap to whole frames unless snap is false. Fails if the time is outside any layer or a layer is locked, and then changes nothing.",
    { layer_ids: LayerIds, time: Time, snap: z.boolean().optional() },
  );

  r.bridged(
    "shift_layers",
    "Move layers in time by offset_seconds (positive = later). Keyframes and in/out points move with the layer.",
    { layer_ids: LayerIds, offset_seconds: z.number() },
  );

  r.bridged(
    "sequence_layers",
    "Place layers one after another in the given order (like Animation > Keyframe Assistant > Sequence Layers). overlap is the seconds each layer overlaps the previous one. start sets where the first layer begins (default: where it already is).",
    {
      layer_ids: z.array(z.number().int()).min(2).describe("Layer ids in playback order, all from the same comp"),
      overlap: z.number().min(0).optional(), start: z.number().optional(),
    },
  );

  r.bridged(
    "delete_range",
    "Remove a time range: layers inside are deleted, crossing ones trimmed, spanning ones split. ripple (default true) closes the gap; false leaves it. layer_ids limits it (default all unlocked). shorten_comp shortens the comp when rippling. Times snap to frames; markers do not move.",
    {
      comp_id: id("Comp"), start: Time, end: Time, ripple: z.boolean().optional(), layer_ids: z.array(z.number().int()).min(1).optional(),
      shorten_comp: z.boolean().optional(), move_markers: z.boolean().optional().describe("Also ripple comp markers: delete those inside the range, move later ones earlier (needs ripple)"),
    },
  );

  r.bridged(
    "insert_time",
    "Ripple insert (counterpart of delete_range): open a gap of duration seconds at `at`. Layers after it move later; layers spanning it are split and the second part moves. extend_comp (default true) lengthens the comp. layer_ids limits it (default all unlocked). move_markers also moves comp markers. Times snap to frames unless snap is false.",
    {
      comp_id: id("Comp"), at: Time, duration: z.number().positive(), layer_ids: z.array(z.number().int()).min(1).optional(),
      extend_comp: z.boolean().optional(), move_markers: z.boolean().optional(), snap: z.boolean().optional(),
    },
  );

  r.bridged(
    "trim_comp",
    "Trim a comp to its work area (to: work_area) or to the span of its layers (to: layers), like Composition > Trim Comp to Work Area: every layer (locked ones too) and the comp markers move so the range starts at 0, markers outside it are removed, and the duration and work area become the range.",
    { comp_id: id("Comp"), to: z.enum(["work_area", "layers"]) },
    { idempotent: true },
  );

  r.bridged(
    "set_playhead",
    "Move a comp's current-time indicator (playhead) to a time in seconds. Snaps to a whole frame unless snap is false.",
    { comp_id: id("Comp"), time: Time, snap: z.boolean().optional() },
    { idempotent: true },
  );

  r.bridged(
    "add_marker",
    "Add a marker to a layer (layer_id) or a comp (comp_id) at a time. Optional comment, duration in seconds, chapter, url and label color (0-16).",
    {
      ...MarkerTarget, time: Time, comment: z.string().optional(), duration: z.number().min(0).optional(), chapter: z.string().optional(),
      url: z.string().optional(), label: Label.optional(),
    },
    { destructive: false },
  );

  r.bridged(
    "update_marker",
    "Change an existing marker on a layer (layer_id) or comp (comp_id), found by index (1-based, from list_markers) or time (within 0.05 s). Only the fields you pass change: comment, duration, chapter, url, label (0-16); to_time moves it.",
    {
      ...MarkerTarget, index: z.number().int().min(1).optional(), time: Time.optional(), to_time: Time.optional(),
      comment: z.string().optional(), duration: z.number().min(0).optional(), chapter: z.string().optional(), url: z.string().optional(), label: Label.optional(),
    },
    { idempotent: true },
  );

  r.bridged(
    "align_to_markers",
    "Move layers so layer i starts (in point) on marker from_index + i, in the order given, e.g. to cut shots to beat markers. Uses the comp's markers, or a layer's markers with marker_layer_id (e.g. an audio layer). trim_to_next shortens each layer that runs past the next marker so it ends there. Keyframes move with their layers.",
    {
      layer_ids: z.array(z.number().int()).min(1).describe("Layer ids in order, all from the same comp"), marker_layer_id: z.number().int().optional(),
      from_index: z.number().int().min(1).optional(), trim_to_next: z.boolean().optional(),
    },
    { idempotent: true },
  );

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
    "list_markers",
    "List the markers of a layer (layer_id) or a comp (comp_id): index, time, comment, duration, chapter, url, label.",
    { ...MarkerTarget },
    { readOnly: true },
  );

  r.bridged(
    "delete_marker",
    "Delete a marker from a layer (layer_id) or a comp (comp_id), by index (1-based, from list_markers) or by time (must be within 0.05 s of a marker).",
    { ...MarkerTarget, index: z.number().int().min(1).optional(), time: Time.optional() },
  );
}
