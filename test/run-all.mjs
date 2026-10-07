// Runs every test script in this folder, in order, and fails if any of them fails.
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const scripts = ["static-checks.mjs", "mock-host.test.mjs", "render.test.mjs"];
let failed = 0;
for (const s of scripts) {
  console.log("\n=== " + s);
  const r = spawnSync(process.execPath, [path.join(here, s)], { stdio: "inherit" });
  if (r.status !== 0) { failed++; console.log("--- " + s + " FAILED"); }
}
console.log("\n" + (failed ? failed + " of " + scripts.length + " test files failed" : "all " + scripts.length + " test files passed"));
process.exit(failed ? 1 : 0);
