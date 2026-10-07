// findAerender must find aerender whatever folder After Effects reports (it once reported a bogus temp path).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { findAerender } = await import(pathToFileURL(path.join(ROOT, "dist", "render", "aerender.js")).href);
const exe = process.platform === "win32" ? "aerender.exe" : "aerender";
const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "ae-motion-aerender-")));
const saved = process.env.AE_AERENDER;
const results: [name: string, pass: boolean, msg?: string][] = [];
const errText = (e: unknown): string => (e instanceof Error ? e.message : String(e));
const t = (name: string, fn: () => void): void => { try { fn(); results.push([name, true]); } catch (e) { results.push([name, false, errText(e)]); } };
const touch = (p: string): void => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, "#!/bin/sh\n"); };

t("finds aerender next to the .app bundle when AE reports a folder inside it (macOS layout)", () => {
  delete process.env.AE_AERENDER;
  const root = path.join(tmp, "mac");
  touch(path.join(root, exe));
  const inside = path.join(root, "Adobe After Effects 2026.app", "Contents", "MacOS");
  fs.mkdirSync(inside, { recursive: true });
  if (findAerender(inside) !== path.join(root, exe)) throw new Error("not found from inside the bundle");
  if (findAerender(path.join(root, "Adobe After Effects 2026.app")) !== path.join(root, exe)) throw new Error("not found from the bundle folder");
});

t("finds aerender in Support Files (Windows layout)", () => {
  delete process.env.AE_AERENDER;
  const root = path.join(tmp, "win");
  touch(path.join(root, "Support Files", exe));
  if (findAerender(root) !== path.join(root, "Support Files", exe)) throw new Error("not found in Support Files");
});

t("AE_AERENDER wins over everything", () => {
  const custom = path.join(tmp, "custom", exe);
  touch(custom);
  process.env.AE_AERENDER = custom;
  if (findAerender(path.join(tmp, "mac")) !== custom) throw new Error("env override ignored");
});

t("a bogus reported folder does not crash the search", () => {
  delete process.env.AE_AERENDER;
  try { findAerender("/tmp00000001"); } catch (e) { if (!/aerender not found/.test(errText(e))) throw e; }
});

if (saved === undefined) delete process.env.AE_AERENDER; else process.env.AE_AERENDER = saved;
fs.rmSync(tmp, { recursive: true, force: true });
for (const [name, pass, msg] of results) console.log((pass ? "PASS" : "FAIL") + "  " + name + (pass ? "" : "\n      " + msg));
process.exit(results.every((x) => x[1]) ? 0 : 1);
