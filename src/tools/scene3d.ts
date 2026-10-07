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
    "Set up a camera. Lens: pass one of zoom (px), focal_length (mm, 36 mm film width) or fov (horizontal degrees). Depth of field: depth_of_field on/off, focus_distance (px) or focus_on_layer_id (distance along the view axis), aperture, blur_level, and the iris controls (iris_shape, iris_rotation, iris_roundness, iris_aspect_ratio, iris_diffraction_fringe, highlight_gain, highlight_threshold, highlight_saturation). two_node true/false switches between a camera with a point of interest and a one-node camera. position, point_of_interest, orientation and rotation place it; look_at_layer_id aims it at a layer (follow: true keeps it aimed with an expression). Without time values are static; with time they become keyframes. Returns the camera as get_camera does. Use camera_move for animated moves.",
    {
      layer_id: id("Camera layer"), name: z.string().optional(), two_node: z.boolean().optional(),
      zoom: z.number().positive().optional(), focal_length: z.number().positive().optional(), fov: z.number().gt(0).lt(180).optional(),
      depth_of_field: z.boolean().optional(), focus_distance: z.number().min(0).optional(), focus_on_layer_id: z.number().int().optional(),
      aperture: z.number().min(0).optional(), blur_level: z.number().min(0).optional(),
      iris_shape: z.number().int().min(1).optional(), iris_rotation: z.number().optional(), iris_roundness: z.number().optional(), iris_aspect_ratio: z.number().optional(),
      iris_diffraction_fringe: z.number().optional(), highlight_gain: z.number().optional(), highlight_threshold: z.number().optional(), highlight_saturation: z.number().optional(),
      ...Xform, look_at_layer_id: z.number().int().optional(), follow: z.boolean().optional(), time: Time.optional(),
    },
  );

  r.bridged(
    "camera_move",
    "Animate a camera with keyframes you can edit afterwards. type: dolly (distance px toward the point of interest, or factor = new distance as a multiple of the current one), truck (distance px to the right; camera and target move together), pedestal (distance px up; camera and target), crane (distance px up; camera moves, target stays), pan (degrees to the right) and tilt (degrees up), both turning the point of interest, roll (degrees), orbit (degrees around the target to the right, vertical_degrees up, optional target [x,y,z]), zoom (to_zoom, factor, to_focal_length or to_fov), rack_focus (to_focus_distance or to_layer_id; turns depth of field on), and path (waypoints [{t, position?, point_of_interest?}] with absolute times). start and duration are in seconds; easing is linear, ease_in, ease_out or ease_in_out (default). Moves start from the camera's value at start. Existing keyframes inside the move's time range are replaced. Moves that change position or point of interest need a two-node camera. A camera with a rig has its control layers keyed instead.",
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
    "Add handheld shake to a camera with wiggle expressions (so it works on top of any keyframes). target: position (default; translation), point_of_interest (aim shake), rotation (roll) or all. amount is in pixels, rotation_amount in degrees, frequency in shakes per second, octaves adds finer detail, include_depth also shakes z, seed changes the pattern. remove: true takes the shake off again.",
    {
      layer_id: id("Camera layer"), target: z.enum(["position", "point_of_interest", "rotation", "all"]).optional(), amount: z.number().min(0).optional(),
      rotation_amount: z.number().min(0).optional(), frequency: z.number().positive().optional(), octaves: z.number().int().min(1).max(8).optional(),
      include_depth: z.boolean().optional(), seed: z.number().int().optional(), remove: z.boolean().optional(),
    },
  );

  r.bridged(
    "camera_rig",
    "Create or remove a camera rig. create adds two 3D null control layers, one for the camera position and one for its target, and links the camera to them with expressions; existing keyframes move onto the controls. Animate the controls (camera_move does it for you) to drive the camera, and parent other layers to them if you like. remove puts the animation back on the camera and deletes the controls (delete_controls: false keeps them). Needs a two-node camera. Do not rename the control layers.",
    { layer_id: id("Camera layer"), action: z.enum(["create", "remove"]), delete_controls: z.boolean().optional() },
  );

  r.bridged(
    "set_3d",
    "Make a layer 3D and set its 3D transform and material. position, anchor, scale ([x,y,z], scale in percent), orientation and rotation ({x,y,z} degrees) are set statically, or as keyframes when time is given. material: casts_shadows (off | on | only), accepts_shadows, accepts_lights, light_transmission, ambient, diffuse, specular_intensity, specular_shininess, metal, reflection_intensity, reflection_sharpness, reflection_rolloff, transparency, transparency_rolloff, index_of_refraction. Not for cameras and lights (use set_camera and set_light). Any 3D field turns 3D on unless three_d is false.",
    {
      layer_id: id("Layer"), three_d: z.boolean().optional(), position: V3.optional(), anchor: V3.optional(), scale: V3.optional(), orientation: V3.optional(),
      rotation: Rot3.optional(), material: Material.optional(), time: Time.optional(),
    },
  );

  r.bridged(
    "set_light",
    "Edit a light layer: light_type (point | spot | parallel | ambient), intensity (percent), color [r,g,b], cone_angle and cone_feather (spot only), falloff (none | smooth | inverse_square_clamped) with falloff_radius and falloff_distance, casts_shadows with shadow_darkness and shadow_diffusion, and position, point_of_interest, orientation or rotation. Static, or keyframes when time is given. Returns the light's settings.",
    {
      layer_id: id("Light layer"), name: z.string().optional(), light_type: LightType.optional(), intensity: z.number().min(0).optional(),
      color: Color.optional(), cone_angle: z.number().min(0).max(180).optional(), cone_feather: z.number().min(0).max(100).optional(),
      falloff: z.enum(["none", "smooth", "inverse_square_clamped"]).optional(), falloff_radius: z.number().min(0).optional(), falloff_distance: z.number().min(0).optional(),
      casts_shadows: z.boolean().optional(), shadow_darkness: z.number().min(0).max(100).optional(), shadow_diffusion: z.number().min(0).optional(),
      ...Xform, time: Time.optional(),
    },
  );

  r.bridged(
    "set_3d_view",
    "Switch the 3D view in the comp viewer, the one you pick from the 3D View menu: active_camera, default, front, left, top, back, right, bottom, or custom_1 to custom_3. comp_id opens that comp in the viewer first; without it the active comp is used. This only changes what the editor shows: preview_frame and renders always use the active camera. It runs the menu command, so it cannot be undone from the script.",
    {
      view: z.enum(["active_camera", "default", "front", "left", "top", "back", "right", "bottom", "custom_1", "custom_2", "custom_3"]),
      comp_id: id("Comp").optional(),
    },
  );
}
