#!/usr/bin/env node
/**
 * Repository-wide stale version-list guard.
 *
 * Any tracked JSON file carrying a `supportedVersions` or `versionRange` ARRAY
 * of OpenShift minors must agree with the live SUPPORTED_MINORS, or be
 * explicitly allowlisted here with a reason.
 *
 * Why this exists. schema/scenarios.json sat in the repository for months
 * declaring supportedVersions ["4.17","4.18","4.19","4.20"] plus six
 * versionRange copies of the same stale list. Nothing read the file and nothing
 * checked it, so the staleness was invisible until a manual audit found it.
 * Deleting that one file does not prevent the next one.
 *
 * Deliberately a RULE, not a filename check: the next dead list with a version
 * array is caught regardless of what it is called. (OCP-4.22 v2.1 plan §1.1,
 * O10 guard requirement.)
 *
 * Scope and non-goals:
 *   - Only tracked files, only *.json, only the two key names above.
 *   - Only ARRAY values. A string such as "*" or ">=4.20" is a range expression,
 *     not an enumerated list, and is out of scope.
 *   - Only arrays whose entries all look like OpenShift minors ("4.21"). An
 *     array of semver dependency pins is not an OpenShift support list.
 *
 * Usage:
 *   node scripts/validate-version-lists.mjs
 *   node scripts/validate-version-lists.mjs --list     # show every hit, pass or fail
 *
 * No network access. Exit 0 pass, 1 fail.
 */
import { readFileSync } from "node:fs";
import { join, resolve, relative, sep } from "node:path";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const KEYS = new Set(["supportedVersions", "versionRange"]);
const MINOR_RE = /^\d+\.\d+$/;

/**
 * Files permitted to carry a version array that does not match SUPPORTED_MINORS.
 *
 * Currently empty, and that is the goal state. Every entry must carry a reason,
 * and an entry is a standing invitation to delete the file or fix the list
 * instead. An allowlist entry is not a resting place.
 *
 * Note scripts/lib/released-minor-support.json is deliberately NOT listed: it
 * records historical support under its own key names (previouslyReleasedMinors,
 * baselineMinor) precisely so it never collides with this rule. If someone
 * renames those keys, this guard should fire — that is the correct behaviour.
 *
 * @type {{path: string, reason: string}[]}
 */
const ALLOWLIST = [];

function isMinorArray(value) {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((v) => typeof v === "string" && MINOR_RE.test(v))
  );
}

/** Walk a parsed JSON document, collecting supportedVersions/versionRange minor arrays. */
function collectHits(node, pointer, out) {
  if (Array.isArray(node)) {
    node.forEach((child, i) => collectHits(child, `${pointer}/${i}`, out));
    return;
  }
  if (node && typeof node === "object") {
    for (const [key, value] of Object.entries(node)) {
      const childPointer = `${pointer}/${key}`;
      if (KEYS.has(key) && isMinorArray(value)) {
        out.push({ pointer: childPointer, key, value });
      }
      collectHits(value, childPointer, out);
    }
  }
}

function trackedJsonFiles(root) {
  const out = execFileSync("git", ["ls-files", "-z", "*.json"], {
    cwd: root,
    encoding: "utf-8",
    maxBuffer: 64 * 1024 * 1024,
  });
  return out.split("\0").filter(Boolean);
}

/**
 * @param {string} root
 * @param {object} [opts]
 * @param {string[]} [opts.supportedMinors] override the live list (tests)
 * @param {string[]} [opts.files] explicit repo-relative file list instead of
 *   `git ls-files` (lets fixture trees be scanned without being git repos)
 * @param {{path: string, reason: string}[]} [opts.allowlist] override (tests)
 */
export async function validateVersionLists(root, { supportedMinors, files, allowlist } = {}) {
  let supported = supportedMinors;
  if (!supported) {
    const mod = await import(
      pathToFileURL(join(root, "backend", "src", "versionPolicy.js")).href
    );
    supported = mod.SUPPORTED_MINORS;
  }
  const expected = [...supported].join(",");

  const allowed = new Map((allowlist ?? ALLOWLIST).map((e) => [e.path, e.reason]));
  const errors = [];
  const hits = [];

  for (const rel of files ?? trackedJsonFiles(root)) {
    const normalized = rel.split(sep).join("/");
    let parsed;
    try {
      parsed = JSON.parse(readFileSync(join(root, rel), "utf-8"));
    } catch {
      // Malformed or non-UTF8 JSON is not this guard's concern; schema
      // validators own that. Skipping keeps the guard single-purpose.
      continue;
    }

    const fileHits = [];
    collectHits(parsed, "", fileHits);

    for (const hit of fileHits) {
      const actual = hit.value.join(",");
      const matches = actual === expected;
      const allowReason = allowed.get(normalized);
      hits.push({ file: normalized, ...hit, matches, allowlisted: Boolean(allowReason) });

      if (matches || allowReason) continue;

      errors.push(
        `${normalized}${hit.pointer}: ${hit.key} = [${hit.value.join(", ")}]\n` +
          `    does not match SUPPORTED_MINORS = [${supported.join(", ")}]\n` +
          "    Either update the list, delete the dead file, or add an allowlist entry with a reason\n" +
          "    in scripts/validate-version-lists.mjs."
      );
    }
  }

  return { ok: errors.length === 0, errors, hits, supported };
}

function isCLI() {
  try {
    return process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename);
  } catch {
    return false;
  }
}

if (isCLI()) {
  const root = resolve(import.meta.dirname, "..");
  const result = await validateVersionLists(root);

  if (process.argv.includes("--list")) {
    console.log(`SUPPORTED_MINORS = [${result.supported.join(", ")}]`);
    if (result.hits.length === 0) console.log("No tracked JSON declares a version list.");
    for (const h of result.hits) {
      const state = h.matches ? "match" : h.allowlisted ? "allowlisted" : "STALE";
      console.log(`  [${state}] ${h.file}${h.pointer} = [${h.value.join(", ")}]`);
    }
    console.log("");
  }

  if (!result.ok) {
    console.error("Stale version-list guard FAILED:");
    for (const e of result.errors) console.error(`  - ${e}`);
    process.exit(1);
  }

  const checked = result.hits.length;
  console.log(
    `Stale version-list guard passed (${checked} version list(s) in tracked JSON, ` +
      `all matching [${result.supported.join(", ")}] or allowlisted).`
  );
  process.exit(0);
}
