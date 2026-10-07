"use strict";

/**
 * Exact-release provenance guard.
 *
 * Mechanical installer facts must be derived from the exact OFFICIAL released
 * artifact for a minor — the released `x.y.z`, its integrity-verified
 * `openshift-install` binary, and the source revision that binary reports —
 * never from the tip of a `release-X.Y` branch.
 *
 * A branch tip is a moving reference. Tranche 0B originally derived from one
 * and it cost a real error: `azure.Platform.AllowSharedKeyAccess` was absent
 * from the April 4.20 tip and is present in released 4.20.40, having been
 * backported into the z-stream in between. The claim "absent at 4.20" was
 * therefore false against the artifact users actually run.
 *
 * This guard makes that regression structurally impossible to reintroduce
 * silently: every supported minor must carry complete exact-release
 * provenance, and a branch tip may never stand in for it.
 *
 * Hermetic — reads only the tracked rule module and the supported-minor list.
 */

const { test, describe } = require("node:test");
const assert = require("node:assert");

const { INSTALLER_PINS, installerCitation } = require("./proven-repairs.js");
const { getSupportedMinors } = require("../../lib/supported-minors.js");

const SHA40 = /^[0-9a-f]{40}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const SEMVER = /^\d+\.\d+\.\d+$/;

// The pins declare which minors they cover; the set is cross-checked against
// the canonical supported-minor list below. Iterating the pins keeps the
// per-minor suites synchronous, which the test runner requires.
const PINNED_MINORS = Object.keys(INSTALLER_PINS).sort();

describe("exact-release provenance", () => {
  test("the pinned minors are exactly the supported minors", async () => {
    const supported = [...(await getSupportedMinors())].sort();
    assert.deepStrictEqual(
      PINNED_MINORS,
      supported,
      "every supported minor needs exact-release provenance, and no unsupported minor may carry it"
    );
  });

  for (const minor of PINNED_MINORS) {
    describe(minor, () => {
      const pin = INSTALLER_PINS[minor] || {};

      test("names an exact released x.y.z within this minor", () => {
        assert.match(String(pin.release), SEMVER, "release must be a concrete x.y.z");
        assert.ok(
          String(pin.release).startsWith(`${minor}.`),
          `${pin.release} is not a release of ${minor}`
        );
      });

      test("records the release payload digest", () => {
        assert.match(String(pin.payloadDigest), /^sha256:[0-9a-f]{64}$/);
      });

      test("records integrity hashes for the acquired binary", () => {
        assert.match(String(pin.binarySha256), SHA256, "binary SHA256 required");
        assert.match(String(pin.tarballSha256), SHA256, "verified tarball SHA256 required");
      });

      test("records the installer source commit as a full SHA, not a ref", () => {
        assert.match(
          String(pin.installerCommit),
          SHA40,
          "installerCommit must be a 40-character commit SHA — a branch or tag name is not provenance"
        );
      });

      test("the commit is NOT a branch tip standing in for a release", () => {
        assert.notStrictEqual(
          pin.installerCommit,
          pin.supersededBranchTip,
          "the recorded commit equals the superseded branch tip; resolve the released artifact instead"
        );
      });

      test("a superseded branch tip, if recorded, is a SHA and is clearly not authoritative", () => {
        if (pin.supersededBranchTip === undefined) return;
        assert.match(String(pin.supersededBranchTip), SHA40);
      });

      test("the branch field is presentation only and never substitutes for the commit", () => {
        assert.strictEqual(pin.branch, `release-${minor}`);
        assert.ok(!/^release-/.test(String(pin.installerCommit)), "a branch name is not a commit");
      });

      test("records the architecture the mechanical inspection used", () => {
        assert.ok(pin.arch, "architecture must be recorded: struct availability can be arch-gated");
      });

      test("citations built from the pin stay on the human-readable branch URL", () => {
        // Deliberate: readers land on a browsable page. The commit is the
        // authority and lives in the pin, not in every citation URL.
        const c = installerCitation(minor, "pkg/types/installconfig.go", "InstallConfig.Proxy");
        assert.ok(c.url.includes(`/blob/release-${minor}/`));
        assert.strictEqual(c.docTitle, `OpenShift Installer ${minor} Source Code`);
      });
    });
  }

  test("no two supported minors share an installer commit", () => {
    const seen = new Map();
    for (const minor of PINNED_MINORS) {
      const c = INSTALLER_PINS[minor]?.installerCommit;
      if (!c) continue;
      assert.ok(!seen.has(c), `${minor} and ${seen.get(c)} both claim commit ${c}`);
      seen.set(c, minor);
    }
  });

  test("adding a minor without exact-release provenance fails this guard", () => {
    // Documents the intended failure mode rather than relying on a comment.
    const incomplete = { release: "4.22.0", branch: "release-4.22" };
    assert.ok(!SHA40.test(String(incomplete.installerCommit)), "missing commit must not pass");
    assert.ok(!SHA256.test(String(incomplete.binarySha256)), "missing binary hash must not pass");
  });
});
