/**
 * Tranche 6 §9 and §16 — the accepted 4.21.35 -> 4.22.16 field delta still
 * matches what the repository actually ships, and every supported minor carries
 * exact-release installer provenance.
 *
 * This is RECONCILIATION, not research. The delta ledger is frozen accepted
 * evidence; these assertions prove the committed catalogs have not drifted away
 * from it. The research program is not re-run — per the tranche contract it
 * would only reopen if the current files contradicted the ledger, and they
 * do not.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const REPO = path.resolve(import.meta.dirname, "..");
const read = (...p) => fs.readFileSync(path.join(REPO, ...p), "utf8");
const readJson = (...p) => JSON.parse(read(...p));

const DELTA = readJson("docs", "minor-release", "4.22", "mechanical-delta-4.21-to-4.22.json");
const MANIFEST = readJson("docs", "minor-release", "4.22", "acquisition-manifest-4.22.json");
const { INSTALLER_PINS } = require(path.join(REPO, "scripts", "minor", "repair", "proven-repairs.js"));
const SUPPORTED = readJson("scripts", "lib", "released-minor-support.json").previouslyReleasedMinors;

const scenarioFiles = (minor) =>
  fs
    .readdirSync(path.join(REPO, "data", "params", minor))
    .filter((f) => f.endsWith(".json") && f !== "oc-mirror-v2.json");

const allParams = (minor) =>
  scenarioFiles(minor).flatMap((f) => readJson("data", "params", minor, f).parameters);

/* ------------------------------------------------------------------ */
/* §9 — mechanical delta, exactly as accepted                           */
/* ------------------------------------------------------------------ */

describe("T6 §9 — the accepted mechanical delta is unchanged", () => {
  test("install-config paths 1104 -> 1127", () => {
    assert.equal(DELTA.surfaces["install-config"].baselineCount, 1104);
    assert.equal(DELTA.surfaces["install-config"].targetCount, 1127);
  });

  test("23 added, 0 removed", () => {
    assert.equal(DELTA.counts.added, 23);
    assert.equal(DELTA.counts.removed, 0);
    assert.equal(
      DELTA.surfaces["install-config"].targetCount - DELTA.surfaces["install-config"].baselineCount,
      23,
      "the path counts and the add/remove counts must agree"
    );
  });

  test("0 type changes, 0 requiredness changes", () => {
    assert.equal(DELTA.counts.typeChanges, 0);
    assert.equal(DELTA.counts.requirednessChanges, 0);
  });

  test("1 enum change, 2 source-level deprecation markers", () => {
    assert.equal(DELTA.counts.enumChanges, 1);
    const blob = JSON.stringify(DELTA);
    assert.match(blob, /bootstrapOSImage/);
    assert.match(blob, /clusterOSImage/);
  });

  test("agent-config delta is zero, of any class", () => {
    assert.equal(DELTA.surfaces["agent-config"].baselineCount, 21);
    assert.equal(DELTA.surfaces["agent-config"].targetCount, 21);
    assert.equal(DELTA.counts.agentConfigDeltas, 0);
  });

  test("the exact releases diffed are 4.21.35 and 4.22.16", () => {
    const blob = JSON.stringify(DELTA);
    assert.match(blob, /4\.21\.35/);
    assert.match(blob, /4\.22\.16/);
  });
});

describe("T6 §9 — the shipped catalogs still match the normalized Architect delta", () => {
  test("scenario rows: 4.21 = 1051, 4.22 = 1097", () => {
    assert.equal(allParams("4.21").length, 1051);
    assert.equal(allParams("4.22").length, 1097);
  });

  test("the row delta is exactly +46", () => {
    assert.equal(allParams("4.22").length - allParams("4.21").length, 46);
  });

  test("9 distinct newly modelled paths, 0 removed", () => {
    const at = (m) => new Set(allParams(m).map((p) => p.path));
    const a21 = at("4.21");
    const a22 = at("4.22");
    const added = [...a22].filter((p) => !a21.has(p)).sort();
    const removed = [...a21].filter((p) => !a22.has(p)).sort();
    assert.equal(added.length, 9, `added: ${added.join(", ")}`);
    assert.deepEqual(removed, [], "no modelled path may be removed");
  });

  test("all 12 scenarios are modelled at every supported minor", () => {
    for (const m of SUPPORTED) assert.equal(scenarioFiles(m).length, 12, m);
  });
});

describe("T6 §9 — the six upstream capability families are handled as accepted", () => {
  const params22 = allParams("4.22");
  const byPath = (needle) => params22.filter((p) => p.path.includes(needle));
  const statuses = (needle) => [...new Set(byPath(needle).map((p) => p.supportStatus))].sort();

  test("provisioningNetworkGateway: supported-ui on bare-metal-ipi, hidden on the Agent book", () => {
    const ipi = readJson("data", "params", "4.22", "bare-metal-ipi.json").parameters
      .find((p) => p.path === "platform.baremetal.provisioningNetworkGateway");
    const agent = readJson("data", "params", "4.22", "bare-metal-agent.json").parameters
      .find((p) => p.path === "platform.baremetal.provisioningNetworkGateway");
    assert.equal(ipi.supportStatus, "supported-ui");
    assert.equal(ipi.minVersion, "4.22");
    assert.equal(agent.supportStatus, "hidden-not-applicable");
  });

  test("osImageStream: docs-only-not-supported, never supported-ui", () => {
    assert.deepEqual(statuses("osImageStream"), ["docs-only-not-supported"]);
  });

  test("AWS ipFamily: docs-only-not-supported (H2 — Technology Preview is not supported UI)", () => {
    const aws = byPath("aws.ipFamily");
    assert.ok(aws.length > 0, "the AWS ipFamily row must exist to carry the disposition");
    for (const p of aws) assert.equal(p.supportStatus, "docs-only-not-supported", p.path);
  });

  test("Azure ipFamily: hidden-not-applicable (H1 — mechanically present, undocumented)", () => {
    const az = byPath("azure.ipFamily");
    assert.ok(az.length > 0);
    for (const p of az) assert.equal(p.supportStatus, "hidden-not-applicable", p.path);
  });

  test("AWS hostPlacement / Dedicated Hosts: docs-only-not-supported", () => {
    const hp = byPath("hostPlacement");
    assert.ok(hp.length > 0);
    for (const p of hp) assert.equal(p.supportStatus, "docs-only-not-supported", p.path);
  });

  test("machine-pool management: hidden-not-applicable (C4 — DevPreview only)", () => {
    const mgmt = params22.filter((p) => /(^|\.)management$/.test(p.path));
    assert.ok(mgmt.length > 0);
    for (const p of mgmt) assert.equal(p.supportStatus, "hidden-not-applicable", p.path);
  });

  test("EXACTLY ONE new 4.22 path is ordinary editable UI", () => {
    // The headline claim of the whole onboarding, asserted against the shipped
    // catalogs rather than against prose.
    const a21 = new Set(allParams("4.21").map((p) => p.path));
    const newSupportedUi = [
      ...new Set(
        params22.filter((p) => !a21.has(p.path) && p.supportStatus === "supported-ui").map((p) => p.path)
      ),
    ];
    assert.deepEqual(newSupportedUi, ["platform.baremetal.provisioningNetworkGateway"]);
  });

  test("the two deprecated bare-metal OS-image fields are still present and NOT badged", () => {
    // H4: installer-only deprecation evidence does not become a user-facing
    // `deprecated: true` badge without same-minor product documentation.
    for (const p of ["platform.baremetal.bootstrapOSImage", "platform.baremetal.clusterOSImage"]) {
      const rows = params22.filter((x) => x.path === p);
      assert.ok(rows.length > 0, `${p} must still be modelled at 4.22`);
      for (const r of rows) assert.notEqual(r.deprecated, true, `${p} must not carry the deprecated badge`);
    }
  });
});

/* ------------------------------------------------------------------ */
/* §16 — installer / tool provenance                                    */
/* ------------------------------------------------------------------ */

describe("T6 §16 — exact-release installer provenance for every supported minor", () => {
  test("the pinned minors are exactly the supported minors", () => {
    assert.deepEqual(Object.keys(INSTALLER_PINS).sort(), [...SUPPORTED].sort());
  });

  test("4.22 resolves to the accepted 4.22.16 provenance, field for field", () => {
    const pin = INSTALLER_PINS["4.22"];
    const acq = MANIFEST.installer;
    assert.equal(pin.release, "4.22.16");
    assert.equal(pin.release, acq.release);
    assert.equal(pin.payloadDigest, acq.payloadDigest);
    assert.equal(pin.binarySha256, acq.binarySha256);
    assert.equal(pin.tarballSha256, acq.tarballSha256);
    assert.equal(pin.installerCommit, acq.installerCommit);
    assert.equal(pin.arch, acq.arch);
    assert.equal(pin.branch, "release-4.22");
  });

  test("the 4.22 release came from the stable channel, not a branch tip or a pre-release", () => {
    assert.equal(MANIFEST.releaseDiscovery.resolved, "4.22.16");
    for (const rejected of ["nightly", "CI", "release-4.22 branch tip"]) {
      assert.ok(MANIFEST.releaseDiscovery.rejectedSources.includes(rejected), rejected);
    }
    assert.equal(MANIFEST.installer.checksumVerifiedBeforeUse, true);
  });

  test("every pin is shaped alike — no minor carries weaker provenance", () => {
    for (const [minor, pin] of Object.entries(INSTALLER_PINS)) {
      assert.match(pin.release, /^\d+\.\d+\.\d+$/, minor);
      assert.match(pin.payloadDigest, /^sha256:[0-9a-f]{64}$/, minor);
      assert.match(pin.binarySha256, /^[0-9a-f]{64}$/, minor);
      assert.match(pin.tarballSha256, /^[0-9a-f]{64}$/, minor);
      assert.match(pin.installerCommit, /^[0-9a-f]{40}$/, minor);
      assert.equal(pin.arch, "amd64", minor);
      assert.equal(pin.branch, `release-${minor}`, minor);
      assert.ok(pin.release.startsWith(`${minor}.`), `${minor} pin names ${pin.release}`);
    }
  });

  test("no pin is a mutable 'latest' reference", () => {
    for (const [minor, pin] of Object.entries(INSTALLER_PINS)) {
      assert.ok(!/latest/i.test(JSON.stringify(pin)), `${minor} pin contains a mutable reference`);
    }
  });

  test("the digests are distinct per minor — no copy-paste between pins", () => {
    const digests = Object.values(INSTALLER_PINS).map((p) => p.payloadDigest);
    assert.equal(new Set(digests).size, digests.length);
    const commits = Object.values(INSTALLER_PINS).map((p) => p.installerCommit);
    assert.equal(new Set(commits).size, commits.length);
  });
});

describe("T6 §16 — installer artifact selection is architecture-aware and FIPS-correct", () => {
  const src = read("backend", "src", "openshiftInstaller.js");

  test("the mirror path is built from the architecture, not hardcoded", () => {
    assert.match(src, /pub\/openshift-v4\/\$\{arch\}\/clients\/ocp\/\$\{version\}/);
  });

  test("the RHEL9 FIPS variant is arch-specific, and Linux only", () => {
    assert.match(src, /openshift-install-rhel9-\$\{fileArch\}\.tar\.gz/);
  });

  test("aarch64 is normalised to the arm64 filename the mirror actually uses", () => {
    assert.match(src, /'aarch64':\s*'arm64'/);
  });

  test("installer-binary FIPS selection is NOT gated on the target cluster's FIPS setting", () => {
    // The FIPS installer variant is a property of the machine RUNNING
    // openshift-install, not of the cluster being installed. Conflating them
    // would deny a FIPS workstation the right binary, or force it on others.
    const fn = src.slice(src.indexOf("function getInstallerUrls"), src.indexOf("async function ensureOpenshiftInstaller"));
    assert.match(fn, /useFips/);
    assert.ok(!/globalStrategy|state\./.test(fn), "installer URL selection must not read cluster state");
  });

  test("no z-stream is hardcoded in installer URL construction", () => {
    const code = src.split("\n").filter((l) => !l.trim().startsWith("*") && !l.trim().startsWith("//")).join("\n");
    assert.ok(!/clients\/ocp\/4\.\d+\.\d+/.test(code), "a hardcoded z-stream path remains");
  });
});

describe("T6 §16 — oc-mirror authority stays global and 4.22 adds no per-minor copy", () => {
  test("no data/params/<minor>/oc-mirror-v2.json exists for 4.21 or 4.22", () => {
    for (const minor of ["4.21", "4.22"]) {
      assert.equal(
        fs.existsSync(path.join(REPO, "data", "params", minor, "oc-mirror-v2.json")),
        false,
        `${minor} must not carry a per-minor ImageSetConfiguration schema`
      );
    }
  });

  test("the legacy 4.20 copy is the only one, and is inert", () => {
    // DOC-166: retiring it is non-blocking and the flip does not depend on it.
    assert.ok(fs.existsSync(path.join(REPO, "data", "params", "4.20", "oc-mirror-v2.json")));
    assert.ok(fs.existsSync(path.join(REPO, "data", "params", "4.22")));
  });
});
