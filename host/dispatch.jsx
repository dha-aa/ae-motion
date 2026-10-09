// Entry point called by the panel: AEM.dispatch(json) where json is '{"cmd": name, "args": {}}'; returns a JSON string.

// Commands that change nothing undoable, so they skip the undo group.
var READONLY = {
  get_project: 1, get_selection: 1, get_comp: 1, get_layer: 1, list_properties: 1, get_keyframes: 1, find_effects: 1,
  get_text: 1, find_fonts: 1, find_sound_cues: 1, review_motion: 1, get_camera: 1, list_markers: 1, preview_frame: 1, prepare_render: 1, set_playhead: 1, save_project: 1,
  open_project: 1 // switches projects: an undo group around it would belong to the closed one
};

// Every mutating command runs inside one undo group, so a call is one undo step (including any partial
// changes left by a command that fails midway).
function dispatch(s) {
  var out, msg, fn, ro;
  try {
    msg = JSON.parse(s);
    fn = C[msg.cmd];
    if (!fn) fail("BAD_ARGS", "Unknown command: " + msg.cmd);
    ro = READONLY[msg.cmd] === 1;
    if (!ro) app.beginUndoGroup("MCP: " + msg.cmd);
    try { out = { ok: true, result: fn(msg.args || {}) }; } finally { if (!ro) app.endUndoGroup(); }
  } catch (e) {
    if (e && e.aem) out = { ok: false, error: { code: e.code, message: e.message, hint: e.hint } };
    else out = { ok: false, error: { code: "AE_ERROR", message: String(e && e.message ? e.message : e), hint: "ExtendScript line " + (e && e.line ? e.line : "?") + " of panel/host/host.jsx" } };
  }
  return JSON.stringify(out);
}
