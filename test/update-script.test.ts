// scripts/update.ts (the panel's Update button) must install the newest release tag, never unreleased work on main.
// Runs against throwaway git repos with a local "origin"; skipped when git is missing.
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { latestTag } from "../scripts/update.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPT = path.join(ROOT, "scripts", "update.ts");
const results: [name: string, pass: boolean, msg?: string][] = [];
const errText = (e: unknown): string => (e instanceof Error ? e.message : String(e));
const t = (name: string, fn: () => void): void => { try { fn(); results.push([name, true]); } catch (e) { results.push([name, false, errText(e)]); } };
const eq = (a: unknown, b: unknown, what: string): void => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${what}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); };

t("latestTag compares versions numerically and ignores other tags", () => {
  eq(latestTag(["v2.9.1", "v2.10.0", "v2.2.0"]), "v2.10.0", "minor 10 > 9");
  eq(latestTag(["v1.0.0", "v1.0.10", "v1.0.9"]), "v1.0.10", "patch");
  eq(latestTag(["v3.0.0-beta", "nightly", "v2.0.0", ""]), "v2.0.0", "pre-release and other names ignored");
  eq(latestTag([]), undefined, "none");
});

const hasGit = spawnSync("git", ["--version"]).status === 0;
if (hasGit) {
  const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "ae-motion-update-")));
  const env = { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t", GIT_CONFIG_NOSYSTEM: "1", HOME: tmp };
  const git = (cwd: string, ...args: string[]): string => execFileSync("git", args, { cwd, env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  const commit = (cwd: string, file: string, text: string): void => { fs.writeFileSync(path.join(cwd, file), text); git(cwd, "add", "."); git(cwd, "commit", "-q", "-m", text); };
  const update = (cwd: string): { status: number | null; out: string } => {
    const r = spawnSync(process.execPath, [SCRIPT, "--no-install"], { cwd, env, encoding: "utf8" });
    return { status: r.status, out: r.stdout + r.stderr };
  };

  // origin: v1.0.0, v1.1.0, then an unreleased commit on main
  const origin = path.join(tmp, "origin");
  fs.mkdirSync(origin);
  git(origin, "init", "-q", "-b", "main");
  commit(origin, "package-lock.json", "{}");
  commit(origin, "VERSION", "1.0.0"); git(origin, "tag", "v1.0.0");
  commit(origin, "VERSION", "1.1.0"); git(origin, "tag", "v1.1.0");
  commit(origin, "VERSION", "unreleased");
  const clone = path.join(tmp, "clone");
  git(tmp, "clone", "-q", origin, clone);

  t("checks out the newest release tag, not unreleased commits on main", () => {
    const r = update(clone);
    eq(r.status, 0, "exit code\n" + r.out);
    eq(fs.readFileSync(path.join(clone, "VERSION"), "utf8"), "1.1.0", "VERSION");
    eq(git(clone, "describe", "--tags", "--exact-match", "HEAD"), "v1.1.0", "HEAD");
    if (!/was on branch main/.test(r.out)) throw new Error("does not say how to go back to the branch:\n" + r.out);
  });

  t("picks up a release made after the first update (fetches tags while detached)", () => {
    git(origin, "tag", "v1.2.0");
    const r = update(clone);
    eq(r.status, 0, "exit code\n" + r.out);
    eq(fs.readFileSync(path.join(clone, "VERSION"), "utf8"), "unreleased", "v1.2.0 is the tagged unreleased commit");
    eq(update(clone).out.includes("Already on v1.2.0"), true, "second run is a no-op");
  });

  t("refuses to run over local changes", () => {
    fs.writeFileSync(path.join(clone, "VERSION"), "edited");
    const r = update(clone);
    eq(r.status, 1, "exit code");
    if (!/Local changes in VERSION/.test(r.out)) throw new Error("message: " + r.out);
    git(clone, "checkout", "--", "VERSION");
  });

  t("a package-lock.json rewritten by npm does not block the update", () => {
    git(origin, "tag", "v1.3.0");
    fs.writeFileSync(path.join(clone, "package-lock.json"), '{"rewritten":true}');
    const r = update(clone);
    eq(r.status, 0, "exit code\n" + r.out);
    eq(fs.readFileSync(path.join(clone, "VERSION"), "utf8"), "unreleased", "still on the tagged commit");
    eq(fs.readFileSync(path.join(clone, "package-lock.json"), "utf8"), "{}", "lock restored");
  });

  fs.rmSync(tmp, { recursive: true, force: true });
} else results.push(["git not installed: update script tests skipped", true]);

let failed = 0;
for (const [name, pass, msg] of results) { console.log((pass ? "PASS  " : "FAIL  ") + name + (msg ? "\n      " + msg : "")); if (!pass) failed++; }
process.exit(failed ? 1 : 0);
