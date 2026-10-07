// AE Motion MCP panel (CEP, Node enabled): localhost HTTP bridge (token-protected) -> serial queue -> ExtendScript.
//
//   POST /cmd   {cmd, args}  -> AEM.dispatch(...) in panel/host/host.jsx -> {ok, result} | {ok:false, error}
//   GET /health              -> {ok:true}
// Every request needs the x-ae-token header. Port and token are written to the bridge file, which the MCP
// server reads on every call. See docs/architecture.md ("Wire protocol").
(function () {
  var http = require("http");
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

  window.addEventListener("unload", function () {
    try {
      var cur = JSON.parse(fs.readFileSync(bridgeFile, "utf8"));
      if (cur.token === token) fs.unlinkSync(bridgeFile);
    } catch (e) {}
  });

  listen(47670, 20);
})();
