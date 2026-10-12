// Project and composition commands. (src/tools/project.ts)
// Paths arrive already sandboxed and slash-normalised by the server.

// Open a project file. Refuses to throw away unsaved changes unless discard_unsaved is true; then the current project
// is closed without saving first, so After Effects never shows a "save changes?" dialog (which would block the bridge).
C.open_project = function (a: Args["open_project"]) {
  var f, p = app.project, fresh = a["new"] === true;
  if (fresh === has(a, "path")) fail("BAD_ARGS", "Pass path to open a project, or new: true for an empty one");
  if (!fresh) {
    f = new File(a.path);
    if (!/\.(aep|aepx)$/i.test(a.path!)) fail("BAD_ARGS", "Project path must end in .aep or .aepx");
    if (!f.exists) fail("NOT_FOUND", "Project file not found: " + a.path);
  }
  if (p && p.dirty && a.discard_unsaved !== true) fail("BAD_ARGS", "The open project has unsaved changes", "Save them with save_project first, or pass discard_unsaved: true to throw them away");
  // closing first keeps After Effects from asking about unsaved changes in a dialog
  if (p && p.dirty) p.close(CloseOptions.DO_NOT_SAVE_CHANGES);
  if (fresh) { if (!app.newProject()) fail("AE_ERROR", "After Effects did not create a new project"); }
  else if (!app.open(f)) fail("AE_ERROR", "After Effects could not open " + a.path);
  return C.get_project();
};

C.save_project = function (a: Args["save_project"]) {
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

C.create_comp = function (a: Args["create_comp"]) {
  need(a, ["name", "width", "height", "fps", "duration"]);
  var c = app.project.items.addComp(a.name, a.width, a.height, 1, a.duration, a.fps);
  if (a.bg_color) c.bgColor = [a.bg_color[0], a.bg_color[1], a.bg_color[2]];
  try { c.openInViewer(); } catch (e) {}
  return compInfo(c, false);
};

C.set_comp = function (a: Args["set_comp"]) {
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

// ----- footage interpretation and folders (import_footage, set_item) -----
// Verified in AE 26.3: image sequences import at 30 fps whatever they were rendered at; loop multiplies the duration;
// stills refuse loop and conformFrameRate (thrown, reported in skipped); a new folder lands in the root folder.

var ALPHA_MODES: { [name: string]: string } = { straight: "STRAIGHT", premultiplied: "PREMULTIPLIED", ignore: "IGNORE" };

type Interp = { fps?: number; loop?: number; alpha?: "straight" | "premultiplied" | "ignore" };

function hasInterp(a: Interp): boolean { return has(a, "fps") || has(a, "loop") || has(a, "alpha"); }

// Apply fps / loop / alpha to a footage item; what After Effects refuses goes into skipped as {id, field, reason}.
function interpret(it: _ItemClasses, a: Interp, skipped: Obj[]): void {
  var ms: any;
  function put(field: string, fn: () => void): void { try { fn(); } catch (e) { skipped.push({ id: it.id, field: field, reason: String((e as any).message || e) }); } }
  if (!hasInterp(a) || !(it instanceof FootageItem)) return;
  ms = it.mainSource;
  if (has(a, "fps")) put("fps", function () { ms.conformFrameRate = a.fps; });
  if (has(a, "loop")) put("loop", function () { ms.loop = a.loop; });
  if (has(a, "alpha")) put("alpha", function () {
    if (ms.hasAlpha !== true) throw new Error("The footage has no alpha channel");
    ms.alphaMode = (AlphaMode as any)[ALPHA_MODES[a.alpha!]];
  });
}

// A folder by id, or the top-level folder with that name (created when missing).
function folderFor(ref: number | string): FolderItem {
  var p = app.project, it, i;
  if (typeof ref === "number") {
    it = getItem(ref);
    if (!(it instanceof FolderItem)) fail("BAD_ARGS", "Item " + ref + " is not a folder", "Pass a folder id or a folder name");
    return it as FolderItem;
  }
  for (i = 1; i <= p.numItems; i++) { it = p.item(i); if (it instanceof FolderItem && it.name === ref && it.parentFolder === p.rootFolder) return it; }
  return p.items.addFolder(ref);
}

C.import_footage = function (a: Args["import_footage"]) {
  var list: string[] = [], opts: any[] = [], out: Obj[] = [], skipped: Obj[] = [], missing: string[] = [], i, f, io, it, type, folder: FolderItem | null = null, res: Obj;
  if (has(a, "path") === has(a, "paths")) fail("BAD_ARGS", "Pass path or paths");
  if (has(a, "name") && has(a, "paths")) fail("BAD_ARGS", "name needs a single path", "Rename the others with set_item");
  if (hasInterp(a) && (a.as === "comp" || a.as === "comp_cropped")) fail("BAD_ARGS", "fps, loop and alpha are footage settings; a comp import has none", "Set them on the layers' footage items with set_item");
  list = has(a, "paths") ? a.paths : [a.path!];
  type = a.as === "comp" ? ImportAsType.COMP : (a.as === "comp_cropped" ? ImportAsType.COMP_CROPPED_LAYERS : ImportAsType.FOOTAGE);
  // check every file before importing any
  for (i = 0; i < list.length; i++) { f = new File(list[i]); if (!f.exists) missing.push(list[i]); }
  if (missing.length) fail("NOT_FOUND", "File not found: " + missing.join(", "));
  for (i = 0; i < list.length; i++) {
    io = new ImportOptions(new File(list[i]));
    if (a.as === "sequence") io.sequence = true;
    if (!io.canImportAs(type)) fail("BAD_ARGS", "Cannot import " + list[i] + " as " + (a.as || "footage"), a.as === "comp" || a.as === "comp_cropped" ? "Only layered files (PSD, Illustrator) import as a comp" : "");
    io.importAs = type;
    opts.push(io);
  }
  if (has(a, "folder")) folder = folderFor(a.folder);
  for (i = 0; i < opts.length; i++) {
    it = app.project.importFile(opts[i]);
    if (has(a, "name")) it.name = a.name;
    interpret(it, a, skipped);
    if (folder) it.parentFolder = folder;
    out.push(itemInfo(it));
  }
  res = has(a, "paths") ? { items: out } : out[0];
  if (skipped.length) res.skipped = skipped;
  return res;
};

C.set_item = function (a: Args["set_item"]) {
  need(a, ["item_id"]);
  var it = getItem(a.item_id), skipped: Obj[] = [], f, res: Obj;
  if (hasInterp(a) && !(it instanceof FootageItem)) fail("BAD_ARGS", "fps, loop and alpha are footage settings; item " + a.item_id + " is a " + itemType(it), "Use set_comp to change a comp's frame rate");
  if (has(a, "file")) {
    if (!(it instanceof FootageItem) || it.mainSource instanceof SolidSource) fail("BAD_ARGS", "file swaps a footage item's file; item " + a.item_id + " is not file footage", "Use replace_source to swap a layer's source for another item");
    f = new File(a.file);
    if (!f.exists) fail("NOT_FOUND", "File not found: " + a.file);
    if (a.sequence === true) it.replaceWithSequence(f, false); else it.replace(f);
  } else if (has(a, "sequence")) fail("BAD_ARGS", "sequence goes with file");
  if (has(a, "name")) it.name = a.name;
  if (has(a, "comment")) it.comment = a.comment;
  if (has(a, "label")) it.label = a.label;
  if (a.folder === null) it.parentFolder = app.project.rootFolder;
  else if (has(a, "folder")) {
    if (a.folder === a.item_id || (typeof a.folder === "string" && it instanceof FolderItem && it.name === a.folder && it.parentFolder === app.project.rootFolder)) fail("BAD_ARGS", "A folder cannot go inside itself");
    it.parentFolder = folderFor(a.folder);
  }
  interpret(it, a, skipped);
  res = itemInfo(it);
  if (has(a, "comment")) res.comment = it.comment;
  if (has(a, "label")) res.label = it.label;
  if (skipped.length) res.skipped = skipped;
  return res;
};

C.delete_item = function (a: Args["delete_item"]) {
  need(a, ["item_id"]);
  var it = getItem(a.item_id), info = itemInfo(it), used = 0;
  if (!a.force) {
    if (it instanceof FolderItem) { if (it.numItems > 0) fail("BAD_ARGS", "Folder is not empty (" + it.numItems + " items)", "Pass force: true to delete it with its contents"); }
    else { used = it.usedIn ? it.usedIn.length : 0; if (used > 0) fail("BAD_ARGS", "Item is used in " + used + " comp(s)", "Pass force: true to delete it and the layers that use it"); }
  }
  it.remove();
  return { deleted: info };
};
