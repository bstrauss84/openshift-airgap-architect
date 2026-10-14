/**
 * Semantic classification of package.json / package-lock.json changes.
 *
 * ── WHY A REGEX IS NOT ENOUGH ──────────────────────────────────────────────
 *
 * The security gate treats any change to a `package*.json` as a change to the
 * shipping-image surface, and therefore demands a container scan. That is the
 * right DEFAULT — a dependency edit really does change what ships — but it is
 * decided purely on the FILE NAME, so it fires identically for:
 *
 *     "test:tooling": "node --test scripts/*.test.mjs"      <- a test glob
 *     "express": "^4.18.2"  ->  "^5.0.0"                    <- a shipped dep
 *
 * Tranche 8D hit exactly this: Unit B's only `package.json` change is one line
 * adding two directories to the `test:tooling` glob, with zero dependency
 * lines touched, and it still forced `Container scan: INCOMPLETE`. A gate that
 * cries wolf on comment-and-glob edits trains people to wave it through, which
 * is how the real dependency bump gets waved through too.
 *
 * ── WHAT THIS DOES INSTEAD ─────────────────────────────────────────────────
 *
 * Compare the two manifests as PARSED JSON and ask one question: can this
 * delta change the bytes installed into, or executed while building, the
 * image? That is reproducible semantic evidence rather than a filename guess,
 * and it is deliberately asymmetric — unknown or unparseable input is
 * IMAGE-AFFECTING, never waved through. The gate can only ever become
 * stricter than a filename match, never looser, because the filename match is
 * still what selects a manifest for inspection in the first place.
 *
 * ── WHAT COUNTS, AND WHY EACH ONE ──────────────────────────────────────────
 *
 *   dependencies, optionalDependencies, peerDependencies
 *       Installed into the image. npm 7+ installs peers automatically, so a
 *       peer edit is not inert.
 *   bundleDependencies / bundledDependencies
 *       Shipped inside a published tarball.
 *   overrides, resolutions
 *       Do not name a dependency but silently change which VERSION resolves,
 *       which is precisely the kind of change a scan needs to see.
 *   engines
 *       Can change which Node the build selects.
 *   type
 *       Flips CJS/ESM resolution for the shipped source.
 *   install-time lifecycle scripts
 *       preinstall/install/postinstall/prepare/prepack/postprepare EXECUTE
 *       during `npm ci`. An edit there is arbitrary code execution in the
 *       build, so it is image-affecting even though it is "just a script".
 *   devDependencies
 *       ONLY when the image installs them, i.e. shipped scope "all". Under
 *       `--omit=dev` they never reach the image. The scope comes from the
 *       Containerfile classifier, not from a guess here.
 *
 * Everything else — name, version, description, license, repository, and
 * non-install scripts such as `test`, `lint`, `test:tooling` — cannot change
 * the installed surface.
 *
 * `version` deserves a word: it IS baked into the image and surfaced at
 * runtime, so it is not "nothing". But it cannot change which packages are
 * installed, and image VULNERABILITY applicability is what this gate decides.
 * Release-identity concerns are handled by candidate binding, not here.
 */

/** Dependency maps that always describe installed content. */
const ALWAYS_INSTALLED_MAPS = [
  "dependencies",
  "optionalDependencies",
  "peerDependencies",
  "bundleDependencies",
  "bundledDependencies",
];

/** Keys that change resolution or execution without naming a package. */
const RESOLUTION_KEYS = ["overrides", "resolutions", "engines", "type", "packageManager"];

/** Scripts npm executes as part of an install. */
const INSTALL_LIFECYCLE = ["preinstall", "install", "postinstall", "prepare", "prepack", "postprepare"];

const stable = (v) => JSON.stringify(v ?? null);

/**
 * Does this package.json delta affect the shipping image?
 *
 * @param {object|null} before  parsed baseline manifest (null = absent)
 * @param {object|null} after   parsed candidate manifest (null = absent)
 * @param {{scope?: "prod"|"all"|"none"}} opts shipped install scope
 * @returns {{affecting: boolean, reasons: string[]}}
 */
export function manifestDelta(before, after, { scope = "all" } = {}) {
  const reasons = [];

  // Absence is not evidence of harmlessness. A manifest that appeared or
  // vanished changes the build; an unparseable one cannot be reasoned about.
  if (!before && !after) return { affecting: false, reasons: [] };
  if (!before) return { affecting: true, reasons: ["manifest did not exist at the baseline"] };
  if (!after) return { affecting: true, reasons: ["manifest was removed"] };

  const maps = [...ALWAYS_INSTALLED_MAPS];
  // devDependencies reach the image only when the final stage installs them.
  // "none" means the image ships no npm surface at all, but a dev edit can
  // still change a BUILD that produces shipped artifacts, so it is only
  // excluded for an explicit prod-only install.
  if (scope !== "prod") maps.push("devDependencies");

  for (const key of maps) {
    const b = before[key] ?? {};
    const a = after[key] ?? {};
    for (const name of new Set([...Object.keys(b), ...Object.keys(a)])) {
      if (stable(b[name]) !== stable(a[name])) {
        const from = b[name] === undefined ? "(absent)" : String(b[name]);
        const to = a[name] === undefined ? "(removed)" : String(a[name]);
        reasons.push(`${key}.${name}: ${from} -> ${to}`);
      }
    }
  }

  for (const key of RESOLUTION_KEYS) {
    if (stable(before[key]) !== stable(after[key])) reasons.push(`${key} changed`);
  }

  const bs = before.scripts ?? {};
  const as = after.scripts ?? {};
  for (const name of INSTALL_LIFECYCLE) {
    if (stable(bs[name]) !== stable(as[name])) {
      reasons.push(`scripts.${name} changed (runs during npm install)`);
    }
  }

  return { affecting: reasons.length > 0, reasons };
}

/**
 * Does this lockfile delta affect the shipping image?
 *
 * A lockfile is noisy by nature, so the same question is asked of the thing
 * that actually matters: the resolved set of NON-DEV packages, keyed by path
 * (npm installs the same name at several nested paths) and compared on
 * version AND integrity. Integrity is included deliberately — a re-resolved
 * artifact at an unchanged version is still different bytes entering the
 * image, and that is exactly what a scan exists to look at.
 */
export function lockDelta(before, after, { scope = "all" } = {}) {
  if (!before && !after) return { affecting: false, reasons: [] };
  if (!before) return { affecting: true, reasons: ["lockfile did not exist at the baseline"] };
  if (!after) return { affecting: true, reasons: ["lockfile was removed"] };

  const v = (l) => l?.lockfileVersion;
  if (v(before) !== v(after)) {
    return { affecting: true, reasons: [`lockfileVersion ${v(before)} -> ${v(after)}`] };
  }
  // Only v2/v3 expose the `packages` map this reasoning needs. Anything else
  // is treated as affecting rather than parsed optimistically.
  if (v(after) !== 2 && v(after) !== 3) {
    return { affecting: true, reasons: [`unsupported lockfileVersion ${JSON.stringify(v(after))}; cannot classify`] };
  }

  const shipped = (lock) => {
    const out = new Map();
    for (const [path, entry] of Object.entries(lock.packages ?? {})) {
      if (path === "") continue;
      if (entry?.link === true) continue;
      const isDev = entry?.dev === true || entry?.devOptional === true;
      if (scope === "prod" && isDev) continue;
      out.set(path, `${entry?.version ?? "?"}|${entry?.integrity ?? "-"}`);
    }
    return out;
  };

  const b = shipped(before);
  const a = shipped(after);
  const reasons = [];
  for (const path of new Set([...b.keys(), ...a.keys()])) {
    if (b.get(path) !== a.get(path)) {
      reasons.push(`${path}: ${b.get(path) ?? "(absent)"} -> ${a.get(path) ?? "(removed)"}`);
    }
  }
  return { affecting: reasons.length > 0, reasons };
}

/** Parse, treating unreadable/invalid content as unknown rather than empty. */
export function parseOrNull(text) {
  if (text === null || text === undefined || text === "") return null;
  try {
    const v = JSON.parse(text);
    return v && typeof v === "object" ? v : null;
  } catch {
    return null;
  }
}

/**
 * CLI, used by scripts/security/image-surface.sh.
 *
 *   package-surface.mjs <kind> <baseline-file|-> <candidate-file|-> [scope]
 *
 * kind is "manifest" or "lock". A missing file is passed as "-".
 * Exit 0 = NOT image-affecting. Exit 1 = image-affecting (reasons on stdout).
 * Exit 2 = could not classify; the caller must treat this as affecting.
 */
export function main(argv, { readFile, log }) {
  const [kind, beforePath, afterPath, scope = "all"] = argv;
  if (!kind || !beforePath || !afterPath) {
    log("usage: package-surface.mjs <manifest|lock> <before|-> <after|-> [scope]");
    return 2;
  }
  const read = (p) => (p === "-" ? null : readFile(p));
  let before, after;
  try {
    before = parseOrNull(read(beforePath));
    after = parseOrNull(read(afterPath));
  } catch (err) {
    log(`could not read inputs: ${err.message}`);
    return 2;
  }
  // Content present but unparseable must not read as "absent, therefore
  // unchanged". Distinguish the two before classifying.
  for (const [label, p, parsed] of [["baseline", beforePath, before], ["candidate", afterPath, after]]) {
    if (p !== "-" && parsed === null) {
      log(`${label} ${p} is not parseable JSON; cannot classify`);
      return 2;
    }
  }

  const fn = kind === "lock" ? lockDelta : manifestDelta;
  const { affecting, reasons } = fn(before, after, { scope });
  for (const r of reasons) log(r);
  return affecting ? 1 : 0;
}

// CLI entry. Guarded so importing this module from a test never reads a file
// or sets an exit code.
if (process.argv[1] && process.argv[1].endsWith("package-surface.mjs")) {
  const fs = await import("node:fs");
  process.exitCode = main(process.argv.slice(2), {
    readFile: (p) => fs.readFileSync(p, "utf8"),
    log: (m) => console.log(m),
  });
}
