// Preview frames, render preparation and the run_jsx escape hatch. (src/tools/output.ts, src/tools/scripting.ts)

// The server waits for the PNG afterwards: saveFrameToPng can return before the file is fully written.
C.preview_frame = function (a) {
  need(a, ["comp_id", "time", "output_path"]);
  var comp = getComp(a.comp_id), f = new File(a.output_path);
  if (typeof comp.saveFrameToPng !== "function") fail("UNSUPPORTED", "comp.saveFrameToPng is not available in this After Effects version", "Update After Effects");
  if (!f.parent.exists) f.parent.create();
  try { comp.openInViewer(); } catch (e) {}
  comp.saveFrameToPng(a.time, f);
  return { path: f.fsName, exists: f.exists };
};

// Called by render_start (not a tool): save the project and report what aerender needs.
C.prepare_render = function (a) {
  need(a, ["comp_id"]);
  var comp = getComp(a.comp_id);
  if (!app.project.file) fail("BAD_ARGS", "Project has never been saved", "Save the project in After Effects first");
  app.project.save();
  return {
    project_path: app.project.file.fsName, comp_name: comp.name,
    total_frames: Math.round(comp.duration * comp.frameRate), aerender_dir: appDir()
  };
};

// The server refuses this unless AE_MCP_ALLOW_JSX=1.
C.run_jsx = function (a) {
  need(a, ["code"]);
  var r = eval(a.code);
  if (r === undefined) r = null;
  if (typeof r === "object" && r !== null && !(r instanceof Array) && r.constructor !== Object) r = String(r);
  return { result: r };
};
