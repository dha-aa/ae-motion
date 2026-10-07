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
      shorten_comp: z.boolean().optional(),
    },
  );

  r.bridged(
    "set_playhead",
    "Move a comp's current-time indicator (playhead) to a time in seconds. Snaps to a whole frame unless snap is false.",
    { comp_id: id("Comp"), time: Time, snap: z.boolean().optional() },
  );

  r.bridged(
    "add_marker",
    "Add a marker to a layer (layer_id) or a comp (comp_id) at a time. Optional comment, duration in seconds, chapter, url and label color (0-16).",
    {
      ...MarkerTarget, time: Time, comment: z.string().optional(), duration: z.number().min(0).optional(), chapter: z.string().optional(),
      url: z.string().optional(), label: Label.optional(),
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
