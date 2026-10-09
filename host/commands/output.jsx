// Preview frames, render preparation and the run_jsx escape hatch. (src/tools/output.ts, src/tools/scripting.ts)

// The server waits for the PNG afterwards: saveFrameToPng can return before the file is fully written.
C.preview_frame = function (a) {
  need(a, ["comp_id", "time", "output_path"]);
  var comp = getComp(a.comp_id), f = new File(a.output_path), rf;
  if (typeof comp.saveFrameToPng !== "function") fail("UNSUPPORTED", "comp.saveFrameToPng is not available in this After Effects version", "Update After Effects");
  if (!f.parent.exists) f.parent.create();
  try { comp.openInViewer(); } catch (e) {}
  // saveFrameToPng renders at the comp's viewer resolution (After Effects drops it to half or a quarter on heavy
  // comps), which makes text look broken in the preview: render full resolution and put the setting back
  rf = safe(function () { return comp.resolutionFactor; });
  if (rf && (rf[0] !== 1 || rf[1] !== 1)) comp.resolutionFactor = [1, 1];
  try { comp.saveFrameToPng(a.time, f); } finally { if (rf && (rf[0] !== 1 || rf[1] !== 1)) comp.resolutionFactor = rf; }
  return { path: f.fsName, exists: f.exists };
};

// The first GPU renderer this machine offers (Metal, CUDA or OpenCL), or the current one if there is none.
function gpuRenderer() {
  var ts = safe(function () { return app.availableGPUAccelTypes; }) || [], i;
  for (i = 0; i < ts.length; i++) { if (ts[i] !== GpuAccelType.SOFTWARE) return ts[i]; }
  return app.project.gpuAccelType;
}

// Called by render_start (not a tool): save the project and report what aerender needs.
C.prepare_render = function (a) {
  need(a, ["comp_id"]);
  var comp = getComp(a.comp_id);
  if (!app.project.file) fail("BAD_ARGS", "Project has never been saved", "Save the project in After Effects first");
  // aerender reads the renderer from the saved project: software avoids GPU out-of-memory failures (black frames)
  if (has(a, "software")) app.project.gpuAccelType = a.software ? GpuAccelType.SOFTWARE : gpuRenderer();
  app.project.save();
  return {
    project_path: app.project.file.fsName, comp_name: comp.name,
    total_frames: Math.round(comp.duration * comp.frameRate), aerender_dir: appDir(),
    software: app.project.gpuAccelType === GpuAccelType.SOFTWARE
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
