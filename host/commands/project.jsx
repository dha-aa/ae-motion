// Project and composition commands. (src/tools/project.ts)
// Paths arrive already sandboxed and slash-normalised by the server.

// Open a project file. Refuses to throw away unsaved changes unless discard_unsaved is true; then the current project
// is closed without saving first, so After Effects never shows a "save changes?" dialog (which would block the bridge).
C.open_project = function (a) {
  var f, p = app.project, fresh = a["new"] === true;
  if (fresh === has(a, "path")) fail("BAD_ARGS", "Pass path to open a project, or new: true for an empty one");
  if (!fresh) {
    f = new File(a.path);
    if (!/\.(aep|aepx)$/i.test(a.path)) fail("BAD_ARGS", "Project path must end in .aep or .aepx");
    if (!f.exists) fail("NOT_FOUND", "Project file not found: " + a.path);
  }
  if (p && p.dirty && a.discard_unsaved !== true) fail("BAD_ARGS", "The open project has unsaved changes", "Save them with save_project first, or pass discard_unsaved: true to throw them away");
  // closing first keeps After Effects from asking about unsaved changes in a dialog
  if (p && p.dirty) p.close(CloseOptions.DO_NOT_SAVE_CHANGES);
  if (fresh) { if (!app.newProject()) fail("AE_ERROR", "After Effects did not create a new project"); }
  else if (!app.open(f)) fail("AE_ERROR", "After Effects could not open " + a.path);
  return C.get_project();
};

C.save_project = function (a) {
  var p = app.project, f;
  if (has(a, "path")) {
    if (!/\.aepx?$/i.test(a.path)) fail("BAD_ARGS", "Project path must end in .aep or .aepx");
    f = new File(a.path);
    if (f.exists && !a.overwrite) fail("EXISTS", "File already exists: " + a.path, "Pass overwrite: true or choose another path");
    if (!f.parent.exists) f.parent.create();
    p.save(f);
  } else {
    if (!p.file) fail("BAD_ARGS", "Project has never been saved", "Pass a path to Save As");
    p.save();
  }
  return { project_path: p.file ? p.file.fsName : null };
};

C.create_comp = function (a) {
  need(a, ["name", "width", "height", "fps", "duration"]);
  var c = app.project.items.addComp(a.name, a.width, a.height, 1, a.duration, a.fps);
  if (a.bg_color) c.bgColor = [a.bg_color[0], a.bg_color[1], a.bg_color[2]];
  try { c.openInViewer(); } catch (e) {}
  return compInfo(c, false);
};

C.set_comp = function (a) {
  need(a, ["comp_id"]);
  var c = getComp(a.comp_id), wa = a.work_area, ws, wd;
  if (has(a, "name")) c.name = a.name;
  if (has(a, "width")) c.width = a.width;
  if (has(a, "height")) c.height = a.height;
  if (has(a, "fps")) c.frameRate = a.fps;
  if (has(a, "pixel_aspect")) c.pixelAspect = a.pixel_aspect;
  if (a.bg_color) c.bgColor = [a.bg_color[0], a.bg_color[1], a.bg_color[2]];
  if (has(a, "duration")) c.duration = a.duration;
  // the comp switch: layers with motion_blur (set_layer) only render blurred while this is on
  if (has(a, "motion_blur")) c.motionBlur = a.motion_blur;
  if (has(a, "shutter_angle")) c.shutterAngle = a.shutter_angle;
  if (has(a, "shutter_phase")) c.shutterPhase = a.shutter_phase;
  // likewise the comp switch for layer frame blending (set_layer frame_blending)
  if (has(a, "frame_blending")) c.frameBlending = a.frame_blending;
  if (wa) {
    ws = has(wa, "start") ? wa.start : c.workAreaStart;
    wd = has(wa, "duration") ? wa.duration : c.workAreaDuration;
    if (ws < 0 || wd <= 0 || ws + wd > c.duration + EPS) fail("BAD_ARGS", "work_area must fit inside the comp (0 to " + c.duration + " s)");
    setWorkArea(c, ws, wd);
  }
  return compInfo(c, false);
};

C.import_footage = function (a) {
  need(a, ["path"]);
  var f = new File(a.path), io, it;
  if (!f.exists) fail("NOT_FOUND", "File not found: " + a.path);
  io = new ImportOptions(f);
  if (a.as === "sequence") io.sequence = true;
  if (!io.canImportAs(ImportAsType.FOOTAGE)) fail("BAD_ARGS", "File cannot be imported as footage");
  io.importAs = ImportAsType.FOOTAGE;
  it = app.project.importFile(io);
  return itemInfo(it);
};

C.delete_item = function (a) {
  need(a, ["item_id"]);
  var it = getItem(a.item_id), info = itemInfo(it), used = 0;
  if (!a.force) {
    if (it instanceof FolderItem) { if (it.numItems > 0) fail("BAD_ARGS", "Folder is not empty (" + it.numItems + " items)", "Pass force: true to delete it with its contents"); }
    else { used = it.usedIn ? it.usedIn.length : 0; if (used > 0) fail("BAD_ARGS", "Item is used in " + used + " comp(s)", "Pass force: true to delete it and the layers that use it"); }
  }
  it.remove();
  return { deleted: info };
};
