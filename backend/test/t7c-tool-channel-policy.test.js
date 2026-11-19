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
 *   1. oc-mirror channel is `latest-<newest SUPPORTED minor>`, independent of
 *      the selected target minor, because operator discovery (`--v2 list
 *      operators`) does not exist in 4.21.x. It was the GLOBAL `latest` until
 *      2026-11-19, when that channel moved to OpenShift 5.0.1, which publishes
 *      no oc-mirror, and every image build failed with "no SHA256 for
 *      oc-mirror.tar.gz". Asserted in both the image and the runtime.
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
import { ocChannelForMinor, OC_MIRROR_CHANNEL } from "../src/ocMirrorRuntime.js";

const CONTAINERFILE = fs.readFileSync(new URL("../Containerfile", import.meta.url), "utf8");
/** Directive lines only — the comments discuss the old idiom by name. */
const DIRECTIVES = CONTAINERFILE.split("\n")
  .filter((l) => !l.trim().startsWith("#"))
  .join("\n");

/**
 * The Containerfile RUN that acquires the tools, located by content (it calls
 * the resolver script), so assertions do not police unrelated layers (the
 * `useradd ... || true` idempotency line further down is legitimate).
 */
const TOOL_RUN = (() => {
  const lines = DIRECTIVES.split("\n");
  for (let start = 0; start < lines.length; start++) {
    if (!lines[start].startsWith("RUN ")) continue;
    let end = start;
    while (end < lines.length && lines[end].trimEnd().endsWith("\\")) end += 1;
    const block = lines.slice(start, end + 1).join("\n");
    if (block.includes("resolve-ocp-tool.sh")) return block;
  }
  assert.fail("tool-acquisition RUN not found");
})();

/**
 * Since the 2026-11-19 fix the fetch/verify/extract logic lives in
 * backend/scripts/resolve-ocp-tool.sh (executable lines only; its comments
 * discuss the old idioms by name). Every fetch-hygiene assertion below now
 * polices this script, which is where the curl calls are.
 */
const TOOL_BLOCK = fs.readFileSync(new URL("../scripts/resolve-ocp-tool.sh", import.meta.url), "utf8")
  .split("\n")
  .filter((l) => !l.trim().startsWith("#"))
  .join("\n");

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
  it("oc-mirror tracks the newest SUPPORTED minor, never the global latest (OpenShift 5.0 publishes no oc-mirror)", () => {
    assert.match(DIRECTIVES, new RegExp(`^ARG OC_MIRROR_CHANNEL=latest-${HIGHEST.replace(".", "\\.")}$`, "m"));
    assert.doesNotMatch(DIRECTIVES, /^ARG OC_MIRROR_CHANNEL=latest$/m);
    assert.equal(OC_MIRROR_CHANNEL, `latest-${HIGHEST}`, "the runtime follows the same rule");
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

  it("the two policies are not collapsed: separate build args, and different runtime behaviour", () => {
    // Since 2026-11-19 both IMAGE defaults are latest-<newest supported minor>,
    // so the values coincide there. The policies still differ, and must stay two
    // separately overridable args: at runtime oc follows the user's selected
    // minor, oc-mirror does not.
    const oc = DIRECTIVES.match(/^ARG OC_CHANNEL=(.+)$/m)?.[1];
    const mirror = DIRECTIVES.match(/^ARG OC_MIRROR_CHANNEL=(.+)$/m)?.[1];
    assert.ok(oc && mirror, "both OC_CHANNEL and OC_MIRROR_CHANNEL are declared");
    assert.match(TOOL_RUN, /--channel "\$\{OC_CHANNEL\}"/);
    assert.match(TOOL_RUN, /--channel "\$\{OC_MIRROR_CHANNEL\}"/);
    const oldest = SUPPORTED_MINORS.find((m) => m !== HIGHEST);
    assert.notEqual(ocChannelForMinor(oldest), OC_MIRROR_CHANNEL, "an older selected minor changes oc, never oc-mirror");
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

  it("every fetch in the tool-acquisition block either captures or writes to a file", () => {
    // Since M7 curl runs inside one `fetch` wrapper (bounded retries, failure
    // classification). The wrapper must hand back curl's own status, and every
    // call site must be a capture or a -o download — never a pipeline.
    // An invocation is `curl -…`; "(curl $rc)" in the failure messages is text.
    const wrapper = TOOL_BLOCK.split("\n").filter((l) => /(^|[\s;&|({])curl\s+-/.test(l));
    assert.equal(wrapper.length, 1, "curl is called only by the fetch wrapper");
    // Since 2026-11-19 the wrapper (in resolve-ocp-tool.sh) always downloads to
    // a file: `curl … "$1" -o "$2" || { rc=$?`.
    assert.match(wrapper[0], /curl [^|]*"\$1" -o "\$2" \|\| \{ rc=\$\?/, "the wrapper keeps curl's exit status");
    assert.match(TOOL_BLOCK, /return \$rc; \}/, "and returns it");
    const calls = TOOL_BLOCK.split("\n").filter((l) => /^\s*fetch "/.test(l));
    const offenders = calls.filter((l) => !/^\s*fetch "[^"]+" "\$WORK\/[^"]+"\s*$/.test(l));
    assert.deepEqual(offenders, [], "a fetch whose status cannot be observed (not a plain download to a work file)");
    assert.ok(calls.length >= 3, "checksum, release and tarball fetches all go through it");
    // Both tools are acquired through it.
    assert.match(TOOL_RUN, /--artifact openshift-client-linux\.tar\.gz/);
    assert.match(TOOL_RUN, /--artifact oc-mirror\.tar\.gz/);
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
    // Resolver variables: release.txt's own checksum, the version, the artifact checksum.
    for (const v of ["rel_sha", "VERSION"]) {
      assert.match(TOOL_BLOCK, new RegExp(`\\[ -n "\\$${v}" \\] \\|\\| die`), `missing guard for ${v}`);
    }
    assert.match(TOOL_BLOCK, /if \[ -z "\$SHA" \]; then\s*\n\s*die "no SHA256 for/, "missing guard for the artifact checksum");
    assert.match(TOOL_BLOCK, /grep -Eq '\^\[0-9a-f\]\{64\}\$'/, "the checksum must be 64 lowercase hex digits");
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

describe("v2.2.1: the baked tools are readable by the app user", () => {
  // Red Hat's oc-mirror tarball stores the binary as 0640, uid 984. Extracted as
  // root with the archive's owner kept, `chmod +x` gave 0751: uid 1001 could run
  // it but not read it, and hashing it for the execution plan failed (EACCES),
  // so every Mirroring run in the v2.2.0 container stopped before oc-mirror.
  // Since 2026-11-19 extraction happens in resolve-ocp-tool.sh: the same rules,
  // checked there, plus each tool must be installed to /usr/local/bin by it and
  // must run as UID 1001 during the build.
  it("the resolver extracts without the archive's owner and installs 0755 (never just +x)", () => {
    assert.match(TOOL_BLOCK, /tar --no-same-owner /, "extract with --no-same-owner");
    assert.match(TOOL_BLOCK, /install -m 0755 "\$bin" "\$DEST"/, "mode 0755, not just +x");
    assert.doesNotMatch(TOOL_BLOCK, /chmod \+x/, "+x keeps the tarball's unreadable 0640 base");
  });
  for (const tool of ["oc", "oc-mirror"]) {
    it(`${tool} is installed by the resolver into /usr/local/bin and runs as UID 1001 at build time`, () => {
      assert.match(TOOL_RUN, new RegExp(`--member ${tool} --dest /usr/local/bin/${tool}\\b`));
      assert.match(DIRECTIVES, new RegExp(`setpriv --reuid=1001 --regid=0 --clear-groups /usr/local/bin/${tool}\\b`));
    });
  }
});
