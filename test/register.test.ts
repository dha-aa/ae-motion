// scripts/register.ts (run by the installers, and so by the panel's Update button) must add ae-motion to Claude Desktop
// and Claude Code without losing anything the user set, and do nothing when it is already there.
// The end-to-end checks run with a throwaway HOME and a fake `claude` on PATH (macOS / Linux only).
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { desktopConfigPath, findNode, mergeDesktopConfig } from "../scripts/register.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPT = path.join(ROOT, "scripts", "register.ts");
const SERVER = path.join(ROOT, "dist", "index.js");
const results: [name: string, pass: boolean, msg?: string][] = [];
const errText = (e: unknown): string => (e instanceof Error ? e.message : String(e));
const t = (name: string, fn: () => void): void => { try { fn(); results.push([name, true]); } catch (e) { results.push([name, false, errText(e)]); } };
const eq = (a: unknown, b: unknown, what: string): void => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${what}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); };

t("desktopConfigPath per platform", () => {
  eq(desktopConfigPath("darwin", "/Users/u"), path.join("/Users/u", "Library", "Application Support", "Claude", "claude_desktop_config.json"), "macOS");
  eq(desktopConfigPath("win32", "C:\\Users\\u", "C:\\Users\\u\\AppData\\Roaming"), path.join("C:\\Users\\u\\AppData\\Roaming", "Claude", "claude_desktop_config.json"), "Windows");
  eq(desktopConfigPath("linux", "/home/u"), null, "Linux has no Claude Desktop");
});

t("mergeDesktopConfig keeps other servers, app settings and the entry's env", () => {
  const before = { mcpServers: { other: { command: "python", args: ["x.py"] }, "ae-motion": { command: "node", args: ["/old/index.js"], env: { AE_MCP_ALLOW_JSX: "1" } } }, preferences: { theme: "dark" } };
  const r = mergeDesktopConfig(JSON.stringify(before), "/usr/local/bin/node", ["/new/index.js"]);
  eq(r.changed, true, "changed");
  const after = JSON.parse(r.text);
  eq(after.mcpServers.other, before.mcpServers.other, "other server");
  eq(after.preferences, before.preferences, "app settings");
  eq(after.mcpServers["ae-motion"], { command: "/usr/local/bin/node", args: ["/new/index.js"], env: { AE_MCP_ALLOW_JSX: "1" } }, "entry");
  const again = mergeDesktopConfig(r.text, "/usr/local/bin/node", ["/new/index.js"]);
  eq(again, { text: r.text, changed: false }, "second run is a no-op");
});

t("mergeDesktopConfig starts a missing or empty file, refuses broken JSON", () => {
  for (const text of [null, "", "  \n"]) eq(JSON.parse(mergeDesktopConfig(text, "node", ["s.js"]).text), { mcpServers: { "ae-motion": { command: "node", args: ["s.js"] } } }, `from ${JSON.stringify(text)}`);
  for (const text of ['{"mcpServers": {', "[1]", "null"]) {
    let threw = false;
    try { mergeDesktopConfig(text, "node", ["s.js"]); } catch { threw = true; }
    eq(threw, true, `throws on ${text}`);
  }
});

t("findNode takes the first node on PATH, else the fallback", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ae-motion-node-"));
  const exe = process.platform === "win32" ? "node.exe" : "node";
  fs.mkdirSync(path.join(tmp, "a")); fs.mkdirSync(path.join(tmp, "b")); fs.mkdirSync(path.join(tmp, "b", exe));
  fs.mkdirSync(path.join(tmp, "c")); fs.writeFileSync(path.join(tmp, "c", exe), "");
  const sep = process.platform === "win32" ? ";" : ":";
  eq(findNode(["", path.join(tmp, "a"), path.join(tmp, "b"), path.join(tmp, "c")].join(sep), process.platform, "fb"), path.join(tmp, "c", exe), "skips missing and directories");
  eq(findNode(path.join(tmp, "a"), process.platform, "fb"), "fb", "fallback");
  fs.rmSync(tmp, { recursive: true, force: true });
});

if (process.platform !== "win32") {
  const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "ae-motion-register-")));
  const bin = path.join(home, "bin"), log = path.join(home, "claude.log");
  fs.mkdirSync(bin);
  // a fake claude CLI: logs its arguments, one call per line
  fs.writeFileSync(path.join(bin, "claude"), `#!/bin/sh\necho "$*" >> "${log}"\n`, { mode: 0o755 });
  const run = (extra: Record<string, string> = {}): string => {
    const r = spawnSync(process.execPath, [SCRIPT], { encoding: "utf8", env: { ...process.env, HOME: home, PATH: bin + ":" + path.dirname(process.execPath) + ":/usr/bin:/bin", ...extra } });
    if (r.status !== 0) throw new Error(`exit ${r.status}\n${r.stdout}${r.stderr}`);
    return r.stdout;
  };
  const calls = (): string[] => (fs.existsSync(log) ? fs.readFileSync(log, "utf8").trim().split("\n").filter((l) => l !== "--version") : []);
  const desktop = desktopConfigPath(process.platform, home);

  t("AE_MCP_REGISTER=0 touches nothing", () => {
    if (desktop) fs.mkdirSync(path.dirname(desktop), { recursive: true });
    run({ AE_MCP_REGISTER: "0" });
    eq(fs.existsSync(log), false, "claude not called");
    if (desktop) eq(fs.existsSync(desktop), false, "no desktop config");
  });

  t("registers with Claude Code at user scope, keeping the old entry's env", () => {
    fs.writeFileSync(path.join(home, ".claude.json"), JSON.stringify({ mcpServers: { "ae-motion": { type: "stdio", command: "node", args: ["/old/index.js"], env: { AE_MCP_ALLOW_JSX: "1" } } } }));
    const out = run();
    eq(calls(), ["mcp remove -s user ae-motion", `mcp add -s user ae-motion -e AE_MCP_ALLOW_JSX=1 -- node ${SERVER}`], "claude calls\n" + out);
  });

  t("does nothing in Claude Code when already registered", () => {
    fs.rmSync(log);
    fs.writeFileSync(path.join(home, ".claude.json"), JSON.stringify({ mcpServers: { "ae-motion": { type: "stdio", command: "node", args: [SERVER] } } }));
    const out = run();
    eq(calls(), [], "claude calls");
    if (!/Claude Code: already registered/.test(out)) throw new Error(out);
  });

  if (desktop) {
    t("registers with Claude Desktop with an absolute node, keeping the rest of the file", () => {
      fs.writeFileSync(desktop, JSON.stringify({ mcpServers: { other: { command: "x" } }, preferences: { a: 1 } }));
      run();
      const cfg = JSON.parse(fs.readFileSync(desktop, "utf8"));
      eq(cfg.preferences, { a: 1 }, "preferences");
      eq(cfg.mcpServers.other, { command: "x" }, "other server");
      eq(cfg.mcpServers["ae-motion"].args, [SERVER], "args");
      eq(path.isAbsolute(cfg.mcpServers["ae-motion"].command), true, "absolute node: " + cfg.mcpServers["ae-motion"].command);
      if (!/Claude Desktop: already registered/.test(run())) throw new Error("second run rewrote the file");
    });

    t("leaves a broken Claude Desktop config alone", () => {
      fs.writeFileSync(desktop, '{"mcpServers": {');
      const out = run();
      eq(fs.readFileSync(desktop, "utf8"), '{"mcpServers": {', "file unchanged");
      if (!/not valid JSON/.test(out)) throw new Error(out);
    });

    t("skips Claude Desktop when it is not installed", () => {
      fs.rmSync(path.dirname(desktop), { recursive: true });
      if (!/Claude Desktop: not installed/.test(run())) throw new Error("no skip message");
      eq(fs.existsSync(desktop), false, "no config created");
    });
  }

  t("without claude on PATH it prints the command instead of failing", () => {
    fs.rmSync(path.join(bin, "claude"));
    if (!/`claude` not found on PATH/.test(run())) throw new Error("no hint");
  });

  fs.rmSync(home, { recursive: true, force: true });
} else results.push(["Windows: end-to-end register tests skipped (fake claude is a shell script)", true]);

let failed = 0;
for (const [name, pass, msg] of results) { console.log((pass ? "PASS  " : "FAIL  ") + name + (msg ? "\n      " + msg : "")); if (!pass) failed++; }
process.exit(failed ? 1 : 0);
