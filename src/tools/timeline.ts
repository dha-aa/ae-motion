/** Timeline editing and marker tools. Host side: host/commands/timeline.jsx. */
import { z } from "zod";
import type { ToolRegistry } from "./registry.js";
import { id, Label, LayerIds, Time } from "./schemas.js";

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
    "Remove a time range from a comp's layers. Layers fully inside are deleted, layers crossing an edge are trimmed, layers spanning the range are split and the middle removed. ripple (default true) closes the gap by moving later material earlier; ripple false leaves the gap (a lift). layer_ids limits the edit (default: all unlocked layers). shorten_comp also shortens the comp duration when rippling. Times snap to frames. Markers are not moved.",
    {
      comp_id: id("Comp"), start: Time, end: Time, ripple: z.boolean().optional(), layer_ids: z.array(z.number().int()).min(1).optional(),
      shorten_comp: z.boolean().optional(), move_markers: z.boolean().optional().describe("Also ripple comp markers: delete those inside the range, move later ones earlier (needs ripple)"),
    },
  );

  r.bridged(
    "insert_time",
    "Ripple insert, the counterpart of delete_range: open a gap of duration seconds at comp time at. Layers starting at or after it move later, layers spanning it are split there and their second part moves. extend_comp (default true) lengthens the comp by the same amount. layer_ids limits the edit (default: all unlocked layers). move_markers also moves comp markers at or after the point (layer markers always move with their layer). Times snap to frames unless snap is false.",
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
