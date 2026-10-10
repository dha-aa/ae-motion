// Updates an ae-motion checkout to the newest release tag (vX.Y.Z), then runs the installer. The panel's Update button
// runs this in the repo named by install.json; by hand: `node scripts/update.ts` from the repo folder.
//
// Releases are tags, and the update check (src/update.ts) compares against the newest tag, so this checks out that tag
// instead of pulling main, which can hold merged but unreleased work. It leaves the checkout on a detached tag;
// `git switch main` goes back. Refuses to run over local changes (except package-lock.json, which npm can rewrite).
//
//   node scripts/update.ts [--no-install]
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

/** The newest vX.Y.Z tag, compared numerically ("v2.10.0" > "v2.9.1"); other tag names are ignored. */
export function latestTag(tags: string[]): string | undefined {
  const parse = (t: string): number[] | null => { const m = /^v(\d+)\.(\d+)\.(\d+)$/.exec(t.trim()); return m ? [+m[1], +m[2], +m[3]] : null; };
  const cmp = (a: number[], b: number[]): number => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
  let best: string | undefined, bestV: number[] | null = null;
  for (const t of tags) {
    const v = parse(t);
    if (v && (!bestV || cmp(v, bestV) > 0)) { best = t.trim(); bestV = v; }
  }
  return best;
}

function main(): number {
  const repo = process.cwd();
  const git = (...args: string[]): string => execFileSync("git", args, { cwd: repo, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  const tryGit = (...args: string[]): string | null => { try { return git(...args); } catch { return null; } };

  if (fs.existsSync(path.join(repo, ".git"))) {
    // npm can rewrite package-lock.json on install; that alone must not block updates
    const status = execFileSync("git", ["status", "--porcelain", "--untracked-files=no"], { cwd: repo, encoding: "utf8" });
    const dirty = status.split("\n").filter(Boolean).map((l) => l.slice(3));
    if (dirty.length === 1 && dirty[0] === "package-lock.json") { git("checkout", "--", "package-lock.json"); dirty.length = 0; }
    if (dirty.length) {
      console.error(`Local changes in ${dirty.join(", ")}: commit or stash them, or update by hand (README, Updating).`);
      return 1;
    }
    console.log("Fetching release tags...");
    try { git("fetch", "--tags", "--force", "--quiet"); } catch (e) {
      console.error("git fetch failed: " + String((e as { stderr?: string }).stderr ?? e).trim());
      return 1;
    }
    const tag = latestTag(git("tag", "--list", "v*").split("\n"));
    if (!tag) { console.error("No release tags (vX.Y.Z) found."); return 1; }
    const onTag = tryGit("describe", "--tags", "--exact-match", "HEAD");
    if (onTag === tag) console.log(`Already on ${tag}.`);
    else {
      const branch = tryGit("symbolic-ref", "--short", "-q", "HEAD");
      git("-c", "advice.detachedHead=false", "checkout", "--quiet", tag);
      console.log(`Checked out ${tag}` + (branch ? ` (was on branch ${branch}; \`git switch ${branch}\` goes back).` : "."));
    }
  } else console.log("Not a git checkout: reinstalling the files as they are.");

  if (process.argv.includes("--no-install")) return 0;
  const win = process.platform === "win32";
  const r = win
    ? spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", path.join("scripts", "install.ps1")], { cwd: repo, stdio: "inherit" })
    : spawnSync("/bin/bash", [path.join("scripts", "install.sh")], { cwd: repo, stdio: "inherit" });
  if (r.error) { console.error("Could not run the installer: " + r.error.message); return 1; }
  return r.status ?? 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) process.exit(main());
