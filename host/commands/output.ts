// Preview frames, render preparation and the run_jsx escape hatch. (src/tools/output.ts, src/tools/scripting.ts)

// The server waits for the PNG afterwards: saveFrameToPng can return before the file is fully written.
C.preview_frame = function (a: HostArgs["preview_frame"]) {
  need(a, ["comp_id", "time", "output_path"]);
  var comp = getComp(a.comp_id), f = new File(a.output_path), rf, want, out: Obj, scene;
  if (typeof comp.saveFrameToPng !== "function") fail("UNSUPPORTED", "comp.saveFrameToPng is not available in this After Effects version", "Update After Effects");
  if (!f.parent.exists) f.parent.create();
  try { comp.openInViewer(); } catch (e) {}
  // saveFrameToPng renders at the comp's resolution factor, which After Effects itself lowers on heavy comps (text
  // then looks broken once scaled up). Set it to what the preview needs instead: the coarsest factor (up to 1/4)
  // that still renders at least max_edge px on the long side, so nothing is upscaled and fewer pixels are rendered
  // (a 768 px preview of a 1920 px comp renders at half resolution). The factor is read when the call is made, so it
  // can be put back right away.
  want = a.max_edge ? Math.max(1, Math.min(4, Math.floor(Math.max(comp.width, comp.height) / a.max_edge))) : 1;
  rf = safe(function () { return comp.resolutionFactor; });
  if (rf && (rf[0] !== want || rf[1] !== want)) comp.resolutionFactor = [want, want];
  try { comp.saveFrameToPng(a.time, f); } finally { if (rf && (rf[0] !== want || rf[1] !== want)) comp.resolutionFactor = rf; }
  out = { path: f.fsName, exists: f.exists };
  scene = sceneAt(comp, a.time);
  if (scene) out.scene = scene;
  return out;
};

// The scene a time shows in an edit: the name of the top enabled precomp layer playing then (null when none), so a
// preview of a master comp says which scene comp to change.
function sceneAt(comp: CompItem, t: number): string | null {
  var i, l;
  for (i = 1; i <= comp.numLayers; i++) {
    l = comp.layer(i) as AVLayer;
    if (l.enabled && l.source instanceof CompItem && t >= l.inPoint - 1e-6 && t < l.outPoint - 1e-6) return l.name;
  }
  return null;
}

// The first GPU renderer this machine offers (Metal, CUDA or OpenCL), or the current one if there is none.
function gpuRenderer(): GpuAccelType {
  var ts = safe(function () { return app.availableGPUAccelTypes as unknown as GpuAccelType[]; }) || [], i;
  for (i = 0; i < ts.length; i++) { if (ts[i] !== GpuAccelType.SOFTWARE) return ts[i]; }
  return app.project.gpuAccelType;
}

// Called by render_start (not a tool): save the project and report what aerender needs.
C.prepare_render = function (a: HostArgs["prepare_render"]) {
  need(a, ["comp_id"]);
  var comp = getComp(a.comp_id);
  if (!app.project.file) fail("BAD_ARGS", "Project has never been saved", "Save the project in After Effects first");
  // aerender reads the renderer from the saved project: software avoids GPU out-of-memory failures (black frames)
  if (has(a, "software")) app.project.gpuAccelType = a.software ? GpuAccelType.SOFTWARE : gpuRenderer();
  app.project.save();
  return {
    project_path: app.project.file.fsName, comp_name: comp.name,
    total_frames: Math.round(comp.duration * comp.frameRate), aerender_dir: appDir(),
    frame_rate: comp.frameRate, display_start_frame: Math.round(comp.displayStartTime * comp.frameRate),
    software: app.project.gpuAccelType === GpuAccelType.SOFTWARE
  };
};

// The server refuses this unless AE_MCP_ALLOW_JSX=1.
C.run_jsx = function (a: Args["run_jsx"]) {
  need(a, ["code"]);
  var r = eval(a.code);
  if (r === undefined) r = null;
  if (typeof r === "object" && r !== null && !(r instanceof Array) && r.constructor !== Object) r = String(r);
  return { result: r };
};
