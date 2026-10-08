/**
 * Update check: is there a newer version of ae-motion-mcp than the one running?
 *
 * Versions are git tags `vX.Y.Z` on the GitHub repository. The check runs at most once a day (the result is cached
 * next to the bridge file, where the After Effects panel also reads it), in the background, with a short timeout,
 * and never throws: a failed check just means "unknown". Turn it off with AE_MCP_UPDATE_CHECK=0.
 */
import fs from "node:fs";
import path from "node:path";
import { bridgeFile, REPO_ROOT, SERVER_VERSION, updateCheckEnabled, updateTagsUrl } from "./config.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const TIMEOUT_MS = 4000;

export interface UpdateInfo {
  current: string;
  /** Newest released version, or null if unknown. */
  latest: string | null;
  update_available: boolean;
  checked_at: string | null;
  /** How to update, when an update is available. */
  how?: string;
  error?: string;
}

interface Cache { checked_at: string; latest: string | null; current: string }

/** Where the last result is kept (the panel reads it too to show its "update available" line). */
export function cacheFile(): string {
  return path.join(path.dirname(bridgeFile()), "update.json");
}

/** Parse "v1.2.3" / "1.2.3" into numbers, or null. */
export function parseVersion(v: string): [number, number, number] | null {
  const m = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(v.trim());
  return m ? [+m[1], +m[2], +m[3]] : null;
}

/** a > b for x.y.z versions. */
export function isNewer(a: string, b: string): boolean {
  const x = parseVersion(a), y = parseVersion(b);
  if (!x || !y) return false;
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i];
  return false;
}

export function updateCommand(): string {
  return `click Update in the After Effects panel (or: cd "${REPO_ROOT}" && git pull && bash scripts/install.sh; Windows: git pull; ./scripts/install.ps1, then reopen the panel), then restart your MCP client`;
}

function readCache(): Cache | null {
  try { return JSON.parse(fs.readFileSync(cacheFile(), "utf8")) as Cache; } catch { return null; }
}

function writeCache(c: Cache): void {
  try {
    fs.mkdirSync(path.dirname(cacheFile()), { recursive: true });
    fs.writeFileSync(cacheFile(), JSON.stringify(c));
  } catch { /* a read-only home folder only loses the cache */ }
}

function toInfo(latest: string | null, checkedAt: string | null, error?: string): UpdateInfo {
  const available = latest !== null && isNewer(latest, SERVER_VERSION);
  return {
    current: SERVER_VERSION, latest, update_available: available, checked_at: checkedAt,
    ...(available ? { how: updateCommand() } : {}), ...(error ? { error } : {}),
  };
}

/** The newest `vX.Y.Z` tag of the repository (GitHub's tags API). */
async function fetchLatest(): Promise<string> {
  const r = await fetch(updateTagsUrl(), {
    headers: { accept: "application/vnd.github+json", "user-agent": `ae-motion-mcp/${SERVER_VERSION}` },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!r.ok) throw new Error(`GitHub answered ${r.status}`);
  const tags = (await r.json()) as { name: string }[];
  let best: string | null = null;
  for (const t of tags) if (parseVersion(t.name) && (!best || isNewer(t.name, best))) best = t.name;
  if (!best) throw new Error("No version tags (vX.Y.Z) found");
  return best.replace(/^v/, "");
}

let inflight: Promise<UpdateInfo> | null = null;

/**
 * Check for a newer version. Uses the cached result if it is less than a day old (and was made by this version),
 * unless force is true. Resolves to null when the check is turned off.
 */
export function checkForUpdates(force = false): Promise<UpdateInfo | null> {
  if (!updateCheckEnabled()) return Promise.resolve(null);
  const cached = readCache();
  if (!force && cached && cached.current === SERVER_VERSION && Date.now() - Date.parse(cached.checked_at) < DAY_MS) {
    return Promise.resolve(toInfo(cached.latest, cached.checked_at));
  }
  inflight ??= fetchLatest()
    .then((latest) => {
      const checkedAt = new Date().toISOString();
      writeCache({ checked_at: checkedAt, latest, current: SERVER_VERSION });
      return toInfo(latest, checkedAt);
    })
    .catch((e: unknown) => toInfo(cached?.latest ?? null, cached?.checked_at ?? null, e instanceof Error ? e.message : String(e)))
    .finally(() => { inflight = null; });
  return inflight;
}

/** The last known result without waiting or touching the network (for get_project). */
export function knownUpdate(): UpdateInfo | null {
  if (!updateCheckEnabled()) return null;
  const c = readCache();
  return c ? toInfo(c.latest, c.checked_at) : null;
}
