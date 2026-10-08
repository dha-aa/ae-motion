/**
 * 3D tools: cameras (setup, moves, shake, rigs), 3D layers, lights and the viewer's 3D view.
 * Host side: host/commands/scene3d.jsx (helpers in host/core/scene3d.jsx and host/core/vector.jsx).
 */
import { z } from "zod";
import type { ToolRegistry } from "./registry.js";
import { Color, id, LightType, Rot3, Time, V3 } from "./schemas.js";

const Xform = {
  position: V3.optional(),
  point_of_interest: V3.optional().describe("Where a two-node camera looks, [x,y,z]"),
  orientation: V3.optional().describe("Orientation in degrees [x,y,z]"),
  rotation: Rot3.optional(),
};

const Material = z.object({
  casts_shadows: z.enum(["off", "on", "only"]).optional(), accepts_shadows: z.boolean().optional(), accepts_lights: z.boolean().optional(),
  light_transmission: z.number().optional(), ambient: z.number().optional(), diffuse: z.number().optional(), specular_intensity: z.number().optional(),
  specular_shininess: z.number().optional(), metal: z.number().optional(), reflection_intensity: z.number().optional(), reflection_sharpness: z.number().optional(),
  reflection_rolloff: z.number().optional(), transparency: z.number().optional(), transparency_rolloff: z.number().optional(), index_of_refraction: z.number().optional(),
});

export function registerScene3dTools(r: ToolRegistry): void {
  r.bridged(
    "get_camera",
    "Read a camera: lens (zoom px, focal length mm on a 36 mm film width, horizontal and vertical field of view), depth of field, focus distance, aperture, blur level, iris, position, point of interest, orientation, rotation, whether it is two-node, and what drives each property (static, keyframes, rig, shake, look-at or an expression). time defaults to 0.",
    { layer_id: id("Camera layer"), time: Time.optional() },
    { readOnly: true },
  );

  r.bridged(
    "set_camera",
    "Set up a camera; static values, or keyframes when time is given. Lens: one of zoom (px), focal_length (mm, 36 mm film) or fov (horizontal degrees). Focus: focus_distance (px) or focus_on_layer_id. two_node switches point-of-interest / one-node. look_at_layer_id aims it (follow keeps it aimed with an expression). Returns get_camera's result. For animated moves use camera_move.",
    {
      layer_id: id("Camera layer"), name: z.string().optional(), two_node: z.boolean().optional(),
      zoom: z.number().positive().optional(), focal_length: z.number().positive().optional(), fov: z.number().gt(0).lt(180).optional(),
      depth_of_field: z.boolean().optional(), focus_distance: z.number().min(0).optional(), focus_on_layer_id: z.number().int().optional(),
      aperture: z.number().min(0).optional(), blur_level: z.number().min(0).optional(),
      iris_shape: z.number().int().min(1).optional(), iris_rotation: z.number().optional(), iris_roundness: z.number().optional(), iris_aspect_ratio: z.number().optional(),
      iris_diffraction_fringe: z.number().optional(), highlight_gain: z.number().optional(), highlight_threshold: z.number().optional(), highlight_saturation: z.number().optional(),
      ...Xform, look_at_layer_id: z.number().int().optional(), follow: z.boolean().optional(), time: Time.optional(),
    },
    { idempotent: true },
  );

  r.bridged(
    "camera_move",
    "Animate a camera with editable keyframes, starting from its value at start; replaces keys inside the move's range. dolly: distance px toward the target (or factor of the current distance). truck/pedestal: px right/up, camera and target together. crane: px up, target stays. pan/tilt: degrees right/up (turns the target). roll: degrees. orbit: degrees right around the target (+ vertical_degrees up). zoom: to_zoom, factor, to_focal_length or to_fov. rack_focus: to_focus_distance or to_layer_id (turns depth of field on). path: waypoints with absolute times. Position/target moves need a two-node camera; a rigged camera has its controls keyed.",
    {
      layer_id: id("Camera layer"),
      type: z.enum(["dolly", "truck", "pedestal", "crane", "pan", "tilt", "roll", "orbit", "zoom", "rack_focus", "path"]),
      start: Time.optional(), duration: z.number().positive().optional(), easing: z.enum(["linear", "ease_in", "ease_out", "ease_in_out"]).optional(),
      distance: z.number().optional(), factor: z.number().positive().optional(), degrees: z.number().optional(), vertical_degrees: z.number().optional(),
      target: V3.optional(), step_degrees: z.number().min(1).max(45).optional().describe("Degrees between keyframes for orbit, pan and tilt (default 5)"),
      to_zoom: z.number().positive().optional(), to_focal_length: z.number().positive().optional(), to_fov: z.number().gt(0).lt(180).optional(),
      to_focus_distance: z.number().min(0).optional(), to_layer_id: z.number().int().optional(), enable_dof: z.boolean().optional(),
      waypoints: z.array(z.object({ t: Time, position: V3.optional(), point_of_interest: V3.optional() })).min(2).optional(),
    },
  );

  r.bridged(
    "camera_shake",
    "Add handheld shake (wiggle expressions, works over keyframes). amount in px, rotation_amount in degrees, frequency per second, octaves adds detail, include_depth shakes z, seed changes the pattern. remove true takes it off.",
    {
      layer_id: id("Camera layer"), target: z.enum(["position", "point_of_interest", "rotation", "all"]).optional(), amount: z.number().min(0).optional(),
      rotation_amount: z.number().min(0).optional(), frequency: z.number().positive().optional(), octaves: z.number().int().min(1).max(8).optional(),
      include_depth: z.boolean().optional(), seed: z.number().int().optional(), remove: z.boolean().optional(),
    },
    { idempotent: true },
  );

  r.bridged(
    "camera_rig",
    "create: add two 3D null controls (camera position and target) that drive a two-node camera by expressions; its keys move onto them. Animate the controls (camera_move does) or parent layers to them; do not rename them. remove: put the animation back on the camera (delete_controls false keeps the nulls).",
    { layer_id: id("Camera layer"), action: z.enum(["create", "remove"]), delete_controls: z.boolean().optional() },
  );

  r.bridged(
    "set_3d",
    "Make a layer 3D and set its transform (scale in percent, rotation/orientation in degrees) and material; static, or keyframes when time is given. Any field turns 3D on unless three_d is false. Not for cameras/lights (set_camera, set_light).",
    {
      layer_id: id("Layer"), three_d: z.boolean().optional(), position: V3.optional(), anchor: V3.optional(), scale: V3.optional(), orientation: V3.optional(),
      rotation: Rot3.optional(), material: Material.optional(), time: Time.optional(),
    },
    { idempotent: true },
  );

  r.bridged(
    "set_light",
    "Edit a light; static, or keyframes when time is given. intensity in percent; cone_angle/cone_feather for spot lights. Returns the light's settings.",
    {
      layer_id: id("Light layer"), name: z.string().optional(), light_type: LightType.optional(), intensity: z.number().min(0).optional(),
      color: Color.optional(), cone_angle: z.number().min(0).max(180).optional(), cone_feather: z.number().min(0).max(100).optional(),
      falloff: z.enum(["none", "smooth", "inverse_square_clamped"]).optional(), falloff_radius: z.number().min(0).optional(), falloff_distance: z.number().min(0).optional(),
      casts_shadows: z.boolean().optional(), shadow_darkness: z.number().min(0).max(100).optional(), shadow_diffusion: z.number().min(0).optional(),
      ...Xform, time: Time.optional(),
    },
    { idempotent: true },
  );

  r.bridged(
    "set_3d_view",
    "Switch the comp viewer's 3D view (editor only: previews and renders use the active camera). comp_id opens that comp first. Runs a menu command, so it cannot be undone.",
    {
      view: z.enum(["active_camera", "default", "front", "left", "top", "back", "right", "bottom", "custom_1", "custom_2", "custom_3"]),
      comp_id: id("Comp").optional(),
    },
    { idempotent: true },
  );
}
