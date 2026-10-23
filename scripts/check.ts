// Checks an ae-motion install and names the step still missing. Without --ae: the built server starts and lists its
// tools (the installers run this, so a broken build fails the install instead of the first tool call). With --ae, also
// After Effects: the scripting setting (read from AE's own prefs file, never written) and the panel (get_project).
//
//   node scripts/check.ts [--ae]
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { startClient } from "./mcp-client.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** The prefs file of the newest After Effects version that has one (folders are named by version: "26.5"). */
export function aePrefsFile(platform: string, home: string, appData?: string): string | null {
  const base = platform === "darwin" ? path.join(home, "Library", "Preferences", "Adobe", "After Effects")
    : platform === "win32" ? path.join(appData || path.join(home, "AppData", "Roaming"), "Adobe", "After Effects") : null;
  if (!base || !fs.existsSync(base)) return null;
  const num = (v: string): number[] => v.split(".").map(Number);
  const cmp = (a: string, b: string): number => { const x = num(a), y = num(b); return (y[0] - x[0]) || ((y[1] || 0) - (x[1] || 0)); };
  for (const v of fs.readdirSync(base).filter((d) => /^\d+\.\d+$/.test(d)).sort(cmp)) {
    const f = path.join(base, v, `Adobe After Effects ${v} Prefs.txt`);
    if (fs.existsSync(f)) return f;
  }
  return null;
}

/** "Allow Scripts to Write Files and Access Network" from a prefs file's text: true / false, null when not listed. */
export function scriptingAllowed(prefs: string): boolean | null {
  const m = /"Pref_SCRIPTING_FILE_NETWORK_SECURITY"\s*=\s*"(\d+)"/.exec(prefs);
  return m ? m[1] !== "0" : null;
}

async function main(): Promise<number> {
  const version = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8")).version;
  let client;
  try {
    client = await startClient();
    console.log(`Server: starts and lists ${(await client.tools()).length} tools (v${version}).`);
  } catch (e) {
    console.error(`Server: does not start (${(e as Error).message}). Re-run the installer and read its build output.`);
    client?.close();
    return 1;
  }
  if (!process.argv.includes("--ae")) { client.close(); return 0; }

  let ok = true;
  const prefs = aePrefsFile(process.platform, os.homedir(), process.env.APPDATA);
  const allowed = prefs ? scriptingAllowed(fs.readFileSync(prefs, "utf8")) : null;
  if (allowed === true) console.log("After Effects setting: Allow Scripts to Write Files and Access Network is on.");
  else {
    ok = false;
    console.log("After Effects setting: Allow Scripts to Write Files and Access Network is " + (allowed === false ? "off" : "not set yet") +
      ". Turn it on in Settings > Scripting & Expressions (After Effects saves it when it quits, so restart After Effects after changing it)." +
      (prefs ? "" : " No After Effects prefs found: is After Effects installed and started once?"));
  }
  const r = await client.call("get_project", { limit: 1 });
  client.close();
  if (r.isError) {
    const err = r.value?.error ?? {};
    console.log(`Panel: not reachable (${err.message ?? r.value}). ${err.hint ?? ""}`.trim());
    return 1;
  }
  console.log(`Panel: connected to After Effects ${r.value.ae_version}, project ${r.value.project_path ?? "(unsaved)"}.`);
  return ok ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) process.exitCode = await main();
