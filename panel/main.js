// AE Motion MCP panel (CEP, Node enabled): localhost HTTP bridge (token-protected) -> serial queue -> ExtendScript.
//
//   POST /cmd   {cmd, args}  -> AEM.dispatch(...) in panel/host/host.jsx -> {ok, result} | {ok:false, error}
//   GET /health              -> {ok:true}
// Every request needs the x-ae-token header. Port and token are written to the bridge file, which the MCP
// server reads on every call. See docs/architecture.md ("Wire protocol").
//
// Updates: the MCP server checks for new releases (at most daily) and caches the answer in update.json next to the
// bridge file; this panel only reads that file (no network) and shows a line when a newer version exists. Its Update
// button runs `git pull` and the installer in the repo named by install.json (written by the installer), then loads
// the new host script and restarts the panel.
//
// Tokens: the MCP server estimates what it adds to the model's context (tool results, images, tool definitions) and
// writes usage/<pid>.json next to the bridge file (src/usage.ts); this panel reads those files every 2 s.
(function () {
  var http = require("http");
  var childProcess = require("child_process");
  var fs = require("fs");
  var os = require("os");
  var path = require("path");
  var crypto = require("crypto");

  var cep = window.__adobe_cep__;
  var token = crypto.randomBytes(24).toString("hex");
  var bridgeFile = process.env.AE_MCP_BRIDGE_FILE || path.join(os.homedir(), ".ae-motion-mcp", "bridge.json");
  var stats = { count: 0 };
  var chain = Promise.resolve();

  function $(id) { return document.getElementById(id); }
  function setStatus(text, ok) { var s = $("status"); s.textContent = text; s.className = ok ? "ok" : "bad"; }

  function evalHost(cmd, args) {
    return new Promise(function (resolve) {
      var payload = JSON.stringify({ cmd: cmd, args: args || {} });
      var literal = JSON.stringify(payload).replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
      cep.evalScript("AEM.dispatch(" + literal + ")", function (res) { resolve(res); });
    });
  }

  function enqueue(fn) {
    var p = chain.then(fn);
    chain = p.catch(function () {});
    return p;
  }

  var server = http.createServer(function (req, res) {
    function send(code, obj) {
      res.writeHead(code, { "content-type": "application/json" });
      res.end(JSON.stringify(obj));
    }
    if (req.headers["x-ae-token"] !== token) return send(401, { ok: false, error: { code: "FORBIDDEN", message: "bad token" } });
    if (req.method === "GET" && req.url === "/health") return send(200, { ok: true, result: { panel: "ae-motion-mcp" } });
    if (req.method !== "POST" || req.url !== "/cmd") return send(404, { ok: false, error: { code: "BAD_ARGS", message: "not found" } });

    var body = "";
    req.on("data", function (c) { body += c; if (body.length > 5e6) req.destroy(); });
    req.on("end", function () {
      var msg;
      try { msg = JSON.parse(body); } catch (e) { return send(400, { ok: false, error: { code: "BAD_ARGS", message: "invalid JSON" } }); }
      enqueue(function () { return evalHost(msg.cmd, msg.args); }).then(function (r) {
        var out;
        try { out = JSON.parse(r); } catch (e) { out = { ok: false, error: { code: "AE_ERROR", message: "Host returned: " + String(r) } }; }
        stats.count++;
        $("count").textContent = stats.count;
        $("last").textContent = msg.cmd;
        $("err").textContent = out.ok ? "-" : out.error.code + ": " + out.error.message;
        send(200, out);
      });
    });
  });

  function writeBridge(port) {
    var dir = path.dirname(bridgeFile);
    try { fs.mkdirSync(dir); } catch (e) {}
    fs.writeFileSync(bridgeFile, JSON.stringify({ port: port, token: token, pid: process.pid }), { mode: 384 });
  }

  function listen(port, tries) {
    var onErr = function (e) {
      if (e.code === "EADDRINUSE" && tries > 0) listen(port + 1, tries - 1);
      else setStatus("Error: " + e.message, false);
    };
    server.once("error", onErr);
    server.listen(port, "127.0.0.1", function () {
      server.removeListener("error", onErr);
      try { writeBridge(port); setStatus("127.0.0.1:" + port, true); }
      catch (e) { setStatus("Cannot write bridge file: " + e.message, false); }
    });
  }

  // ----- Update button -----
  var panelDir = (function () {
    var p = decodeURIComponent(window.location.pathname);
    if (/^\/[A-Za-z]:/.test(p)) p = p.slice(1); // Windows: /C:/... -> C:/...
    return path.dirname(p);
  })();
  var updating = false, armed = null;

  function readInstall() {
    try { return JSON.parse(fs.readFileSync(path.join(panelDir, "install.json"), "utf8").replace(/^\uFEFF/, "")); } catch (e) { return null; }
  }
  function showLog(text, ok) {
    var el = $("update-log");
    el.style.display = "";
    el.className = ok === false ? "bad" : "";
    el.textContent = text.split("\n").filter(function (l) { return l.trim(); }).slice(-8).join("\n");
  }

  // Load the freshly installed host script, close the bridge and reload the panel (main.js and index.html).
  function restartPanel() {
    var host = path.join(panelDir, "host", "host.jsx");
    cep.evalScript("$.evalFile(" + JSON.stringify(host) + ")", function () {
      var done = false, go = function () { if (!done) { done = true; window.location.reload(); } };
      try { server.close(go); } catch (e) {}
      setTimeout(go, 1500); // close waits for open connections; do not wait forever
    });
  }

  function runUpdate() {
    var inst = readInstall(), win = process.platform === "win32", cmd, args, child, out = "";
    if (!inst || !inst.repo || !fs.existsSync(inst.repo)) {
      return showLog("Cannot find the ae-motion folder: re-run the installer once from it (scripts/install.sh or install.ps1) to enable this button.", false);
    }
    var git = fs.existsSync(path.join(inst.repo, ".git"));
    if (win) {
      cmd = "powershell.exe";
      args = ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command",
        (git ? "git pull --ff-only; if ($LASTEXITCODE -ne 0) { exit 1 }; " : "") + "& ./scripts/install.ps1"];
    } else {
      cmd = "/bin/bash";
      args = ["-c", (git ? "git pull --ff-only && " : "") + "bash scripts/install.sh"];
    }
    updating = true;
    $("update-btn").disabled = true;
    showLog((git ? "git pull, then " : "") + "installing... (about a minute)");
    var env = {}, k;
    for (k in process.env) env[k] = process.env[k];
    if (inst.path) env.PATH = inst.path + (win ? ";" : ":") + (env.PATH || "");
    try {
      child = childProcess.spawn(cmd, args, { cwd: inst.repo, env: env });
    } catch (e) {
      updating = false; $("update-btn").disabled = false;
      return showLog("Could not start the update: " + e.message, false);
    }
    child.stdout.on("data", function (d) { out += d; showLog(out); });
    child.stderr.on("data", function (d) { out += d; showLog(out); });
    child.on("error", function (e) { out += "\n" + e.message; });
    child.on("close", function (code) {
      updating = false;
      $("update-btn").disabled = false;
      if (code !== 0) return showLog(out + "\nUpdate failed (exit " + code + "). Fix the error above, or update by hand (README, Updating).", false);
      try { window.localStorage.setItem("aem-updated", "1"); } catch (e) {}
      showLog("Installed. Restarting the panel...");
      setTimeout(restartPanel, 800);
    });
  }

  // Two clicks: the first arms the button for a few seconds, so a stray click does not start an install.
  function onUpdateClick() {
    if (updating) return;
    var b = $("update-btn");
    if (!armed) {
      b.textContent = "Click again to confirm";
      armed = setTimeout(function () { armed = null; b.textContent = b.getAttribute("data-label"); }, 4000);
      return;
    }
    clearTimeout(armed); armed = null;
    b.textContent = b.getAttribute("data-label");
    runUpdate();
  }
  function setButton(label) { var b = $("update-btn"); b.setAttribute("data-label", label); if (!armed && !updating) b.textContent = label; }
  $("update-btn").addEventListener("click", onUpdateClick);
  try {
    if (window.localStorage.getItem("aem-updated")) {
      window.localStorage.removeItem("aem-updated");
      showLog("Updated. Restart your AI client (Claude Code / Claude Desktop) so it uses the new MCP server.");
    }
  } catch (e) {}

  // "2.10.0" > "2.9.1"
  function newer(a, b) {
    var x = String(a).split("."), y = String(b).split("."), i;
    for (i = 0; i < 3; i++) { if ((+x[i] || 0) !== (+y[i] || 0)) return (+x[i] || 0) > (+y[i] || 0); }
    return false;
  }
  var version = null;
  function checkUpdate() {
    var info = null, row = $("update-row");
    if (!version) return;
    try { info = JSON.parse(fs.readFileSync(path.join(path.dirname(bridgeFile), "update.json"), "utf8")); } catch (e) {}
    if (info && info.latest && newer(info.latest, version)) {
      $("update").textContent = "v" + info.latest + " available";
      setButton("Update to v" + info.latest);
      row.style.display = "";
    } else {
      row.style.display = "none";
      setButton("Reinstall");
    }
  }
  // Token meter: each MCP server process writes usage/<pid>.json next to the bridge file (src/usage.ts); this shows
  // the most recently active session, today's total and the costliest tools. Estimates of what ae-motion sends.
  var usageDir = path.join(path.dirname(bridgeFile), "usage");
  function kTok(n) { return n >= 100000 ? Math.round(n / 1000) + "k" : (n >= 1000 ? (n / 1000).toFixed(1) + "k" : String(n)); }
  // One row per session (a running MCP server that has made tool calls), newest first; servers that never made a
  // call (tests, helper scripts) are left out. The live one (updated in the last 30 minutes) is marked.
  function readUsage() {
    var files = [], list = [], today = 0, day = new Date().toDateString(), i, u, tot, top = [], k, box = $("tok-sessions"), cur, row, t, live;
    try { files = fs.readdirSync(usageDir); } catch (e) { return; }
    for (i = 0; i < files.length; i++) {
      if (!/\.json$/.test(files[i])) continue;
      try { u = JSON.parse(fs.readFileSync(path.join(usageDir, files[i]), "utf8")); } catch (e) { continue; }
      if (!u.calls) continue;
      u.total = (u.result_text_tokens || 0) + (u.image_tokens || 0);
      if (new Date(u.updated).toDateString() === day) today += u.total;
      list.push(u);
    }
    list.sort(function (a, b) { return a.updated < b.updated ? 1 : -1; });
    while (box.firstChild) box.removeChild(box.firstChild);
    if (!list.length) { row = document.createElement("div"); row.className = "k"; row.textContent = "No sessions yet"; box.appendChild(row); }
    for (i = 0; i < list.length && i < 6; i++) {
      u = list[i]; t = new Date(u.started);
      live = Date.now() - Date.parse(u.updated) < 30 * 60 * 1000;
      row = document.createElement("div"); row.className = "row";
      row.title = (u.client || "client") + ", started " + t.toLocaleString() + ": " + u.calls + " calls, ~" + kTok(u.result_text_tokens || 0) + " text, ~" + kTok(u.image_tokens || 0) + " images";
      row.innerHTML = '<span class="k"></span><span></span>';
      row.firstChild.textContent = (live ? "\u25cf " : "") + (u.client || "session") + " \u00b7 " + (t.toDateString() === day ? "" : (t.getMonth() + 1) + "/" + t.getDate() + " ") + ("0" + t.getHours()).slice(-2) + ":" + ("0" + t.getMinutes()).slice(-2);
      if (live) row.firstChild.className = "k live";
      row.lastChild.textContent = "~" + kTok(u.total) + "  (" + u.calls + ")";
      if (i === 0) row.lastChild.className = "big";
      box.appendChild(row);
    }
    cur = list[0];
    $("tok-defs").textContent = cur && cur.definitions_tokens ? "~" + kTok(cur.definitions_tokens) + " / request" : "-";
    $("tok-today").textContent = "~" + kTok(today);
    if (cur) for (k in cur.tools) { if (cur.tools.hasOwnProperty(k)) top.push([k, cur.tools[k].text + cur.tools[k].image, cur.tools[k].calls]); }
    top.sort(function (a, b) { return b[1] - a[1]; });
    $("tok-top").textContent = top.length ? "Costliest (latest session): " + top.slice(0, 3).map(function (t) { return t[0] + " " + kTok(t[1]) + " (" + t[2] + "\u00d7)"; }).join(" \u00b7 ") : "";
  }
  readUsage();
  setInterval(readUsage, 2000);

  cep.evalScript("AEM.version", function (v) {
    version = v && v !== "undefined" && v.indexOf("Error") === -1 ? v : null;
    $("version").textContent = version ? "v" + version : "unknown (old host script)";
    checkUpdate();
  });
  setInterval(checkUpdate, 5 * 60 * 1000);

  window.addEventListener("unload", function () {
    try {
      var cur = JSON.parse(fs.readFileSync(bridgeFile, "utf8"));
      if (cur.token === token) fs.unlinkSync(bridgeFile);
    } catch (e) {}
  });

  listen(47670, 20);
})();
