/**
 * Tranche 7C — external tool channel policy, and the build-time fetch idiom.
 *
 * TWO REPORTED OBSERVATIONS FROM ONE BUILD LOG:
 *
 *   F. "OC_RESOLVED_CHANNEL=latest-4.21 / OC_RESOLVED_VERSION=4.21.36" while
 *      oc-mirror resolved "latest" / 4.22.17. ("Any idea why this is
 *      downloading oc version 4.21.36? is there no 4.22.x version of oc?")
 *   +  "curl: (23) Failure writing output to destination", twice, on an
 *      otherwise successful build.
 *
 * THREE SEPARATE CONTRACTS, deliberately NOT conflated here. CLAUDE.md's
 * external tool version policy makes `oc` and `oc-mirror` different on purpose,
 * and a third axis — which tool a USER receives — is different again:
 *
 *   1. oc-mirror channel is GLOBAL `latest`, independent of target minor,
 *      because operator discovery (`--v2 list operators`) does not exist in
 *      4.21.x. Asserted in both the image and the runtime.
 *   2. oc channel is per-target-minor `latest-<minor>`, because oc carries a
 *      client/server compatibility expectation. At RUNTIME this is resolved
 *      from the user's selected minor, which is the only place it can be
 *      correct — a single build-time binary cannot serve three supported
 *      minors.
 *   3. The image's baked oc is a build-time convenience only. Its channel was
 *      `latest-4.21`, a default that predated 4.22 support, which is why the
 *      log said 4.21.36. The answer to "is there no 4.22.x oc" is that there
 *      is: `clients/ocp/latest-4.22` resolves, and the default now tracks the
 *      highest supported minor.
 *
 * The build-time channel is derived from SUPPORTED_MINORS below rather than
 * written as a literal, so onboarding a new minor cannot leave it stale again
 * — which is exactly how this one went stale.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import { SUPPORTED_MINORS } from "../src/versionPolicy.js";
import { ocChannelForMinor } from "../src/ocMirrorRuntime.js";

const CONTAINERFILE = fs.readFileSync(new URL("../Containerfile", import.meta.url), "utf8");
/** Directive lines only — the comments discuss the old idiom by name. */
const DIRECTIVES = CONTAINERFILE.split("\n")
  .filter((l) => !l.trim().startsWith("#"))
  .join("\n");

/**
 * Just the tool-acquisition RUN, so assertions about fetch hygiene do not
 * accidentally police unrelated layers (the `useradd ... || true` idempotency
 * line further down is legitimate and must not be caught here).
 */
const TOOL_BLOCK = (() => {
  const lines = DIRECTIVES.split("\n");
  const start = lines.findIndex((l) => l.startsWith("RUN set -e &&"));
  assert.ok(start >= 0, "tool-acquisition RUN not found");
  let end = start;
  while (end < lines.length && lines[end].trimEnd().endsWith("\\")) end += 1;
  return lines.slice(start, end + 1).join("\n");
})();

/** Highest supported minor, by numeric comparison rather than sort order. */
const HIGHEST = [...SUPPORTED_MINORS].sort((a, b) => {
  const [am, an] = a.split(".").map(Number);
  const [bm, bn] = b.split(".").map(Number);
  return am - bm || an - bn;
})[SUPPORTED_MINORS.length - 1];

/* ------------------------------------------------------------------ */
/* Contract 1 + 3: the image                                            */
/* ------------------------------------------------------------------ */

describe("T7C — the image's baked tool channels", () => {
  it("oc-mirror is pinned to the GLOBAL latest channel, with no minor", () => {
    assert.match(DIRECTIVES, /^ARG OC_MIRROR_CHANNEL=latest$/m);
  });

  it("oc tracks the highest SUPPORTED minor, not a frozen one", () => {
    // Was latest-4.21 after 4.22 was onboarded, which produced the reported
    // OC_RESOLVED_VERSION=4.21.36.
    assert.match(DIRECTIVES, new RegExp(`^ARG OC_CHANNEL=latest-${HIGHEST.replace(".", "\\.")}$`, "m"));
  });

  it("the oc channel names a minor the product actually supports", () => {
    const m = DIRECTIVES.match(/^ARG OC_CHANNEL=latest-(\d+\.\d+)$/m);
    assert.ok(m, "no OC_CHANNEL default found");
    assert.ok(
      SUPPORTED_MINORS.includes(m[1]),
      `OC_CHANNEL names ${m[1]}, which is not in SUPPORTED_MINORS (${SUPPORTED_MINORS.join(", ")})`
    );
  });

  it("the two channels are not collapsed into one value", () => {
    const oc = DIRECTIVES.match(/^ARG OC_CHANNEL=(.+)$/m)?.[1];
    const mirror = DIRECTIVES.match(/^ARG OC_MIRROR_CHANNEL=(.+)$/m)?.[1];
    assert.notEqual(oc, mirror, "oc and oc-mirror channel policies are deliberately different");
  });

  it("no hardcoded z-stream appears in either channel", () => {
    // CLAUDE.md forbids a hardcoded z-stream default; the patch must be
    // resolved from the mirror at build time.
    for (const name of ["OC_CHANNEL", "OC_MIRROR_CHANNEL"]) {
      const v = DIRECTIVES.match(new RegExp(`^ARG ${name}=(.+)$`, "m"))?.[1] ?? "";
      assert.equal(/\d+\.\d+\.\d+/.test(v), false, `${name}=${v} pins a z-stream`);
    }
  });
});

/* ------------------------------------------------------------------ */
/* Contract 2: the runtime, which is what a user receives               */
/* ------------------------------------------------------------------ */

describe("T7C — the runtime resolves oc per selected target minor", () => {
  for (const minor of SUPPORTED_MINORS) {
    it(`${minor} maps to clients/ocp/latest-${minor}`, () => {
      assert.equal(ocChannelForMinor(minor), `latest-${minor}`);
    });
  }

  it("every supported minor gets its own distinct channel", () => {
    const channels = SUPPORTED_MINORS.map(ocChannelForMinor);
    assert.equal(new Set(channels).size, SUPPORTED_MINORS.length);
  });

  it("the runtime oc channel is never the global latest", () => {
    // Conflating them would hand a user an oc from an arbitrary minor.
    for (const minor of SUPPORTED_MINORS) {
      assert.notEqual(ocChannelForMinor(minor), "latest");
    }
  });

  it("the runtime channel does not depend on the image's build-time default", () => {
    // The build-time ARG tracks the highest supported minor; a user who
    // selects an older one must still get that older one.
    const oldest = SUPPORTED_MINORS.find((m) => m !== HIGHEST);
    assert.equal(ocChannelForMinor(oldest), `latest-${oldest}`);
    assert.notEqual(ocChannelForMinor(oldest), `latest-${HIGHEST}`);
  });
});

/* ------------------------------------------------------------------ */
/* The curl: (23) idiom                                                 */
/* ------------------------------------------------------------------ */

describe("T7C — build-time fetches let curl finish and honour its exit status", () => {
  /**
   * `curl ... | awk '/^Name:/{print $2; exit}'` made awk close the pipe after
   * the first match. curl died with EPIPE and printed "curl: (23) Failure
   * writing output to destination" on every build (measured: passed 8192,
   * returned 3583, against a 33 KB release.txt). Worse, a pipeline without
   * pipefail reports awk's status, so curl's 23 — and any genuine 404, TLS or
   * DNS failure — was discarded before `set -e` could see it.
   *
   * The sha256sum.txt fetches used the same idiom and escaped (23) only
   * because those files fit in the 64 KiB pipe buffer: latent, not safe.
   */
  const earlyExitIdioms = [
    [/curl[^\n|]*\|\s*awk[^\n]*\bexit\b/, "curl piped into awk that exits early"],
    [/curl[^\n|]*\|\s*head\b/, "curl piped into head"],
    [/curl[^\n|]*\|\s*grep[^\n]*-m\s*1/, "curl piped into grep -m1"],
    [/curl[^\n|]*\|\s*sed[^\n]*\bq\b/, "curl piped into sed with q"],
  ];

  for (const [pattern, label] of earlyExitIdioms) {
    it(`does not use ${label}`, () => {
      assert.equal(pattern.test(TOOL_BLOCK), false, `${label} closes the pipe early and recreates curl: (23)`);
    });
  }

  it("every curl in the tool-acquisition block either captures or writes to a file", () => {
    // Capturing into a variable makes the assignment take curl's own exit
    // status; -o writes to disk and is likewise not a pipeline.
    const offenders = TOOL_BLOCK.split("\n")
      .filter((l) => l.includes("curl "))
      .filter((l) => !/-o\s+\S+/.test(l))
      .filter((l) => !/="\$\(curl[^|]*\)"/.test(l));
    assert.deepEqual(offenders, [], "a curl whose status cannot be observed");
  });

  it("the parsers consume the whole stream (END-block form)", () => {
    // `{v=$2} END{print v}` reads to EOF; `{print $2; exit}` does not.
    const parsers = TOOL_BLOCK.split("\n").filter((l) => l.includes("awk "));
    assert.ok(parsers.length >= 4, `expected the four release/sha parsers, found ${parsers.length}`);
    for (const line of parsers) {
      assert.match(line, /END\s*\{\s*print/, `parser does not use an END block: ${line.trim()}`);
    }
  });

  it("the emptiness guards are kept — an exit code cannot catch a 200 with junk", () => {
    for (const v of ["_oc_ver", "_mirror_ver", "_oc_check", "_mirror_check"]) {
      assert.match(TOOL_BLOCK, new RegExp(`\\[ -n "\\$\\{${v}\\}" \\] \\|\\|`), `missing guard for ${v}`);
    }
  });

  it("the downloaded tarballs are still checksum-verified strictly", () => {
    const strict = TOOL_BLOCK.match(/sha256sum --check --strict/g) || [];
    assert.equal(strict.length, 2, "both oc and oc-mirror must be strictly verified");
  });

  it("no failure is suppressed", () => {
    // Forbidden remediations: hiding stderr, swallowing status, or tolerating 23.
    assert.equal(/2>\s*\/dev\/null/.test(TOOL_BLOCK), false, "stderr suppressed");
    assert.equal(/\|\|\s*true/.test(TOOL_BLOCK), false, "|| true swallows a failure");
    assert.equal(/-\s*eq\s*23|==\s*23/.test(TOOL_BLOCK), false, "exit 23 special-cased");
  });
});
