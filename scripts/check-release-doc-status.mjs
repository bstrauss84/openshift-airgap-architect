#!/usr/bin/env node
// Release-documentation lifecycle check for the version in VERSION.
//
//   node scripts/check-release-doc-status.mjs --phase pre    # while the release is being prepared
//   node scripts/check-release-doc-status.mjs --phase post [--tag-date YYYY-MM-DD]
//                                                           # release-closeout gate, after the GitHub Release is public
//
// Lifecycle-aware on purpose: before publication, "Coming in vX", "not yet released" and a CHANGELOG
// "Unreleased" heading are CORRECT, so the pre phase only requires the release notes and a CHANGELOG
// section to exist and reports the wording that the closeout must switch. The post phase fails on any
// stale pre-release wording for the current version and on missing release-history entries. Neither
// phase asserts a status for any other version, and historical records (CHANGELOG history, docs/releases,
// the backlog and the roadmap) are never scanned for wording.
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Current-state documents whose wording must change at release. Historical records are excluded.
const EXCLUDED = [/^CHANGELOG\.md$/, /^docs\/releases\//, /^docs\/BACKLOG_STATUS\.md$/, /^docs\/IMPLEMENTATION_ROADMAP/,
  /^docs\/minor-release\//, /^docs\/archive\//];

function listDocs(root) {
  const out = [];
  if (existsSync(join(root, "README.md"))) out.push("README.md");
  const walk = (dir) => {
    for (const name of readdirSync(join(root, dir))) {
      const rel = `${dir}/${name}`;
      if (statSync(join(root, rel)).isDirectory()) walk(rel);
      else if (name.endsWith(".md")) out.push(rel);
    }
  };
  if (existsSync(join(root, "docs"))) walk("docs");
  return out.filter((rel) => !EXCLUDED.some((re) => re.test(rel)));
}

export function checkReleaseDocStatus(root, { phase, tagDate = null } = {}) {
  if (phase !== "pre" && phase !== "post") throw new Error('phase must be "pre" or "post"');
  const version = readFileSync(join(root, "VERSION"), "utf-8").trim();
  const v = escape(version);
  const errors = [];
  const pending = [];
  const read = (rel) => (existsSync(join(root, rel)) ? readFileSync(join(root, rel), "utf-8") : null);

  if (!existsSync(join(root, `docs/releases/v${version}.md`))) errors.push(`docs/releases/v${version}.md is missing`);

  const changelog = read("CHANGELOG.md") ?? "";
  const heading = changelog.split("\n").find((l) => new RegExp(`^## \\[${v}\\]`).test(l));
  if (!heading) errors.push(`CHANGELOG.md has no "## [${version}]" section`);
  else {
    const dated = heading.match(new RegExp(`^## \\[${v}\\] - (\\d{4}-\\d{2}-\\d{2})\\s*$`));
    if (!dated) pending.push(`CHANGELOG.md: "${heading.trim()}" is not dated (set the tag date at release)`);
    else if (tagDate && dated[1] !== tagDate) errors.push(`CHANGELOG.md: ${version} is dated ${dated[1]}, but the tag is dated ${tagDate}`);
  }

  // Stale pre-release wording about THIS version, anywhere in the current-state documents.
  const stale = new RegExp(`(coming in v?${v}|v?${v}[^\\n]{0,80}(pre-release|in testing|not yet released|unreleased)|` +
    `(pre-release|not yet released|unreleased)[^\\n]{0,80}v?${v})`, "i");
  for (const rel of listDocs(root)) {
    read(rel).split("\n").forEach((line, i) => {
      if (stale.test(line)) pending.push(`${rel}:${i + 1}: ${line.trim().slice(0, 120)}`);
    });
  }
  const readme = read("README.md") ?? "";
  if (/^\*\*Status:\*\* not yet released/m.test(readme)) pending.push("README.md: the release notice still says **Status:** not yet released");

  // Release history: the README must link the release notes and list the version in "At a glance".
  const link = `docs/releases/v${version}.md`;
  const links = readme.split(link).length - 1;
  if (links < 2) pending.push(`README.md: v${version} release notes linked ${links} time(s); expected in the release-notes list and the documentation table`);
  if (!new RegExp(`^- \\*\\*v${v}\\*\\* — `, "m").test(readme)) pending.push(`README.md: "At a glance" has no "- **v${version}** — " entry`);

  if (phase === "post") errors.push(...pending);
  return { version, phase, ok: errors.length === 0, errors, pending: phase === "pre" ? pending : [] };
}

if (resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const arg = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
  const phase = arg("--phase");
  const tagDate = arg("--tag-date");
  const root = resolve(arg("--root") ?? join(fileURLToPath(import.meta.url), "..", ".."));
  if (!phase) { console.error("usage: check-release-doc-status.mjs --phase pre|post [--tag-date YYYY-MM-DD] [--root DIR]"); process.exit(2); }
  const r = checkReleaseDocStatus(root, { phase, tagDate });
  for (const p of r.pending) console.log(`pending (switch at release): ${p}`);
  for (const e of r.errors) console.error(`FAIL: ${e}`);
  console.log(r.ok ? `release docs ${phase}-release check passed for ${r.version} (${relative(process.cwd(), root) || "."})` : `release docs ${phase}-release check FAILED for ${r.version}`);
  process.exit(r.ok ? 0 : 1);
}
