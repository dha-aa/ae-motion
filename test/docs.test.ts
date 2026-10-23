// The docs must stay findable after edits (CONTRIBUTING.md section 6): INSTALL.md, the panel and the scripts send
// people and agents to exact files and sections, and a renamed heading broke nothing visible. Checks every relative
// link and #section in the repo's Markdown, "(docs/<file>.md, <Section>)" references in messages, and that every AE_*
// environment variable the code reads is documented in docs/setup.md.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { startClient } from "../scripts/mcp-client.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const results: [name: string, pass: boolean, msg?: string][] = [];
const t = (name: string, fn: () => void): void => { try { fn(); results.push([name, true]); } catch (e) { results.push([name, false, e instanceof Error ? e.message : String(e)]); } };

/** GitHub's anchor for a heading: lower case, punctuation dropped, spaces to hyphens. */
const slug = (heading: string): string => heading.trim().toLowerCase().replace(/[^\w\- ]/g, "").replace(/ /g, "-");
const headings = (file: string): Set<string> => {
  const out = new Set<string>();
  let fenced = false;
  // split on \r\n too: git on Windows checks the docs out with CRLF, and "." never matches the \r
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    if (line.startsWith("```")) fenced = !fenced;
    const m = !fenced && /^#{1,6} (.+)$/.exec(line);
    if (m) out.add(slug(m[1]));
  }
  return out;
};
/** Problems with the relative links in Markdown files under `root` (files given relative to it). */
export function brokenLinks(root: string, files: string[]): string[] {
  const bad: string[] = [];
  for (const f of files) {
    const text = fs.readFileSync(path.join(root, f), "utf8").replace(/```[\s\S]*?```/g, "");
    for (const [, link] of text.matchAll(/\]\(([^)\s]+)\)/g)) {
      if (/^[a-z]+:/i.test(link)) continue; // https:, mailto:
      const [p, frag] = link.split("#");
      const target = p ? path.resolve(path.dirname(path.join(root, f)), p) : path.join(root, f);
      if (!fs.existsSync(target)) { bad.push(`${f}: ${link} (no such file)`); continue; }
      if (frag && target.endsWith(".md") && !headings(target).has(frag)) bad.push(`${f}: ${link} (no such section)`);
    }
  }
  return bad;
}

const mdFiles = [...fs.readdirSync(ROOT).filter((f) => f.endsWith(".md")), ...fs.readdirSync(path.join(ROOT, "docs")).filter((f) => f.endsWith(".md")).map((f) => "docs/" + f)];
const codeFiles = (dir: string): string[] => fs.readdirSync(path.join(ROOT, dir), { recursive: true, encoding: "utf8" })
  .filter((f) => /\.(ts|js)$/.test(f)).map((f) => path.join(dir, f));
const sources = [...codeFiles("src"), ...codeFiles("scripts"), "panel/main.js"];

t("the checker finds a missing file and a missing section, with LF or CRLF line ends", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ae-motion-docs-"));
  const doc = "# Real Part\n[ok](#real-part) [gone](b.md) [moved](#old-part)\n```\n[in code](nowhere.md)\n```\n";
  fs.writeFileSync(path.join(tmp, "a.md"), doc);
  fs.writeFileSync(path.join(tmp, "crlf.md"), doc.replace(/\n/g, "\r\n"));
  const bad = brokenLinks(tmp, ["a.md"]), badCrlf = brokenLinks(tmp, ["crlf.md"]).map((b) => b.replace("crlf.md", "a.md"));
  fs.rmSync(tmp, { recursive: true, force: true });
  if (bad.length !== 2 || !/b\.md \(no such file\)/.test(bad[0]) || !/#old-part \(no such section\)/.test(bad[1])) throw new Error(JSON.stringify(bad));
  if (JSON.stringify(badCrlf) !== JSON.stringify(bad)) throw new Error("CRLF: " + JSON.stringify(badCrlf));
});

t(`every relative link and #section in the Markdown resolves (${mdFiles.length} files)`, () => {
  const bad = brokenLinks(ROOT, mdFiles);
  if (bad.length) throw new Error(bad.join("\n      "));
});

t("messages that point to a docs section name one that exists", () => {
  const bad: string[] = [];
  for (const f of sources) {
    for (const [, doc, section] of fs.readFileSync(path.join(ROOT, f), "utf8").matchAll(/\((docs\/[\w-]+\.md), ([^)]+)\)/g)) {
      const file = path.join(ROOT, doc);
      if (!fs.existsSync(file) || !headings(file).has(slug(section))) bad.push(`${f}: (${doc}, ${section})`);
    }
  }
  if (bad.length) throw new Error(bad.join("\n      "));
});

t("every AE_* environment variable the code reads is documented in docs/setup.md", () => {
  const setup = fs.readFileSync(path.join(ROOT, "docs", "setup.md"), "utf8");
  const vars = new Set<string>();
  for (const f of sources) for (const [, v] of fs.readFileSync(path.join(ROOT, f), "utf8").matchAll(/env\.(AE_[A-Z_]+)/g)) vars.add(v);
  if (vars.size < 5) throw new Error("found only " + [...vars].join(", ") + ": is the pattern still right?");
  const missing = [...vars].filter((v) => !setup.includes("`" + v + "`"));
  if (missing.length) throw new Error("add to the Configuration table: " + missing.join(", "));
});

// the README's tool table is for people, so it must match what the server really offers (needs the built server)
try {
  const client = await startClient();
  const served = (await client.tools()).map((x) => x.name);
  client.close();
  const readme = fs.readFileSync(path.join(ROOT, "README.md"), "utf8");
  const start = readme.indexOf("## What Claude can do in After Effects");
  const section = start < 0 ? "" : readme.slice(start, readme.indexOf("\n## ", start + 1));
  const listed = new Set([...section.matchAll(/`([a-z][a-z0-9_]*)`/g)].map((m) => m[1]));
  t(`the README's tool table lists exactly the server's ${served.length} tools`, () => {
    if (!section) throw new Error('README has no "## What Claude can do in After Effects" section');
    const missing = served.filter((n) => !listed.has(n)), extra = [...listed].filter((n) => !served.includes(n));
    if (missing.length || extra.length) throw new Error(`missing from the README: ${missing.join(", ") || "none"}; not a tool: ${extra.join(", ") || "none"}`);
    const count = /(\d+) tools/.exec(section)?.[1];
    if (count !== String(served.length)) throw new Error(`the README says ${count} tools, the server has ${served.length}`);
  });
} catch (e) { results.push(["start the built server for the tool table check (npm run build)", false, e instanceof Error ? e.message : String(e)]); }

let failed = 0;
for (const [name, pass, msg] of results) { console.log((pass ? "PASS  " : "FAIL  ") + name + (msg ? "\n      " + msg : "")); if (!pass) failed++; }
process.exit(failed ? 1 : 0);
