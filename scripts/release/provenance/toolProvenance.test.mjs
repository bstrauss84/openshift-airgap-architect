/**
 * Deterministic tests for external-binary provenance.
 *
 * FIXTURES ONLY. The provenance text is the verbatim content of
 * `/app/tools-provenance.env` read out of the shipping backend image, and the
 * measured hashes are the real `sha256sum /usr/local/bin/oc{,-mirror}` values
 * from that same image. That pairing is what makes the central assertion —
 * recorded tarball checksum MUST NOT equal measured binary checksum — a
 * property of the real artifact rather than of invented data.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";

import {
  CHECKSUM_SUBJECT,
  REQUIRED_ENV_FIELDS,
  BAKED_TOOLS,
  RUNTIME_ACQUIRED_TOOLS,
  RUNTIME_PROVENANCE_FIELDS,
  parseProvenanceEnv,
  mirrorArchDir,
  tarballUrl,
  toProvenanceRecords,
  parseSha256Sums,
  parseSizes,
  reconcileMeasured,
  inventoryBakedTools,
  externalBinaryInventory,
} from "./toolProvenance.mjs";

/** Verbatim from the shipping backend image. */
const REAL_ENV = `OC_RESOLVED_VERSION=4.22.17
OC_RESOLVED_SHA256=466f6c5d060479fca2096b85367c88759ecabe3d12e1328e7debbbd60e3420a7
OC_RESOLVED_CHANNEL=latest-4.22
OC_MIRROR_RESOLVED_VERSION=4.22.17
OC_MIRROR_RESOLVED_SHA256=7bad7aeeb27f6fee911599fcab000587d4066eafb58a7c88aed366676599bb73
OC_MIRROR_RESOLVED_CHANNEL=latest
TOOLS_RESOLVED_ARCH=x86_64
`;

/** Verbatim `sha256sum` output from the same image. */
const REAL_SUMS = `d3c21a0d2ab0be00e9967b81747f4d29981732c72c0c2327cd233d86479500fd  /usr/local/bin/oc
7f995715680a560d75bca9dda3b39e6c236600b95d9413ee683d5374aee82baa  /usr/local/bin/oc-mirror
`;

const REAL_SIZES = `/usr/local/bin/oc 150000000
/usr/local/bin/oc-mirror 180000000
`;

/** A fake engine runner keyed on the in-image command. */
function fakeImageRunner({ env = REAL_ENV, sums = REAL_SUMS, sizes = REAL_SIZES, envStatus = 0 } = {}) {
  return (_cmd, args) => {
    const entrypoint = args[args.indexOf("--entrypoint") + 1];
    if (entrypoint === "cat") return { status: envStatus, stdout: envStatus === 0 ? env : "", stderr: "", spawnError: null, timedOut: false };
    if (entrypoint === "sha256sum") return { status: 0, stdout: sums, stderr: "", spawnError: null, timedOut: false };
    if (entrypoint === "stat") return { status: 0, stdout: sizes, stderr: "", spawnError: null, timedOut: false };
    return { status: 127, stdout: "", stderr: `unexpected entrypoint ${entrypoint}`, spawnError: null, timedOut: false };
  };
}

describe("provenance env parsing", () => {
  test("parses the real image's provenance file completely", () => {
    const parsed = parseProvenanceEnv(REAL_ENV);
    assert.equal(parsed.ok, true);
    assert.deepEqual(parsed.missing, []);
    assert.equal(parsed.entries.OC_RESOLVED_VERSION, "4.22.17");
    assert.equal(parsed.entries.OC_MIRROR_RESOLVED_CHANNEL, "latest");
  });

  test("each required field, removed alone, makes the parse fail and names itself", () => {
    for (const field of REQUIRED_ENV_FIELDS) {
      const text = REAL_ENV.split("\n").filter((l) => !l.startsWith(`${field}=`)).join("\n");
      const parsed = parseProvenanceEnv(text);
      assert.equal(parsed.ok, false, `${field} removal should fail the parse`);
      assert.ok(parsed.missing.includes(field), `${field} should be named as missing`);
    }
  });

  test("a non-hex or short sha256 is rejected rather than carried into the inventory", () => {
    const parsed = parseProvenanceEnv(REAL_ENV.replace(/OC_RESOLVED_SHA256=.*/, "OC_RESOLVED_SHA256=not-a-hash"));
    assert.equal(parsed.ok, false);
    assert.equal(parsed.malformed.length, 1);
    assert.match(parsed.malformed[0], /OC_RESOLVED_SHA256/);
  });

  test("an uppercase sha256 is rejected — the comparison surface is lowercase hex only", () => {
    const upper = "466F6C5D060479FCA2096B85367C88759ECABE3D12E1328E7DEBBBD60E3420A7";
    const parsed = parseProvenanceEnv(REAL_ENV.replace(/OC_RESOLVED_SHA256=.*/, `OC_RESOLVED_SHA256=${upper}`));
    assert.equal(parsed.ok, false);
  });

  test("blank lines and comments are ignored, not treated as malformed fields", () => {
    assert.equal(parseProvenanceEnv(`# a comment\n\n${REAL_ENV}`).ok, true);
  });

  test("empty input fails with every field named", () => {
    const parsed = parseProvenanceEnv("");
    assert.equal(parsed.ok, false);
    assert.equal(parsed.missing.length, REQUIRED_ENV_FIELDS.length);
  });
});

describe("source URL reconstruction", () => {
  test("rebuilds the exact mirror.openshift.com URL the Containerfile fetched", () => {
    assert.equal(
      tarballUrl({ arch: "x86_64", channel: "latest-4.22", tarball: "openshift-client-linux.tar.gz" }),
      "https://mirror.openshift.com/pub/openshift-v4/x86_64/clients/ocp/latest-4.22/openshift-client-linux.tar.gz",
    );
  });

  test("normalises architecture aliases the way the Containerfile's case statement does", () => {
    assert.equal(mirrorArchDir("amd64"), "x86_64");
    assert.equal(mirrorArchDir("arm64"), "aarch64");
    assert.equal(mirrorArchDir("s390x"), "s390x");
  });

  test("an unsupported architecture yields no URL, and no URL fails the record build", () => {
    assert.equal(mirrorArchDir("riscv64"), null);
    const parsed = parseProvenanceEnv(REAL_ENV.replace("TOOLS_RESOLVED_ARCH=x86_64", "TOOLS_RESOLVED_ARCH=riscv64"));
    const built = toProvenanceRecords(parsed);
    assert.equal(built.ok, false);
    assert.match(built.reason, /not reconstructible/);
  });
});

describe("record shape", () => {
  test("records carry every field of the runtime getResolvedToolProvenance() vocabulary", () => {
    const built = toProvenanceRecords(parseProvenanceEnv(REAL_ENV));
    assert.equal(built.ok, true);
    for (const r of built.records) {
      for (const f of RUNTIME_PROVENANCE_FIELDS) assert.ok(f in r, `record for ${r.tool} is missing ${f}`);
    }
  });

  test("the recorded sha256 is explicitly labelled as covering the TARBALL", () => {
    const built = toProvenanceRecords(parseProvenanceEnv(REAL_ENV));
    const oc = built.records.find((r) => r.tool === "oc");
    assert.equal(oc.checksumSubject, CHECKSUM_SUBJECT.TARBALL);
    assert.equal(oc.checksumCovers, "openshift-client-linux.tar.gz");
    assert.match(oc.checksumAuthority, /sha256sum\.txt$/);
  });

  test("the measured binary hash starts null and is never pre-filled from the tarball hash", () => {
    const built = toProvenanceRecords(parseProvenanceEnv(REAL_ENV));
    for (const r of built.records) assert.equal(r.installedSha256, null);
  });

  test("each baked tool records the CLAUDE.md version policy it follows, and they differ", () => {
    const built = toProvenanceRecords(parseProvenanceEnv(REAL_ENV));
    const oc = built.records.find((r) => r.tool === "oc");
    const mirror = built.records.find((r) => r.tool === "oc-mirror");
    assert.match(oc.versionPolicy, /WITHIN the selected supported target minor/);
    assert.match(mirror.versionPolicy, /GLOBALLY/);
    assert.notEqual(oc.versionPolicy, mirror.versionPolicy);
  });
});

describe("measured-vs-recorded reconciliation", () => {
  test("the real image reconciles: tarball and binary hashes are recorded and differ", () => {
    const built = toProvenanceRecords(parseProvenanceEnv(REAL_ENV));
    const rec = reconcileMeasured(built.records, { sums: parseSha256Sums(REAL_SUMS), sizes: parseSizes(REAL_SIZES) });
    assert.equal(rec.ok, true);
    const oc = rec.records.find((r) => r.tool === "oc");
    assert.equal(oc.sha256, "466f6c5d060479fca2096b85367c88759ecabe3d12e1328e7debbbd60e3420a7");
    assert.equal(oc.installedSha256, "d3c21a0d2ab0be00e9967b81747f4d29981732c72c0c2327cd233d86479500fd");
    assert.notEqual(oc.sha256, oc.installedSha256);
    assert.equal(oc.installedSizeBytes, 150000000);
  });

  test("EQUAL tarball and binary hashes are a defect, not a match", () => {
    const built = toProvenanceRecords(parseProvenanceEnv(REAL_ENV));
    const sums = { "/usr/local/bin/oc": built.records[0].sha256, "/usr/local/bin/oc-mirror": built.records[1].sha256 };
    const rec = reconcileMeasured(built.records, { sums });
    assert.equal(rec.ok, false);
    assert.equal(rec.problems.length, 2);
    assert.match(rec.problems[0], /cover different artifacts and cannot match/);
  });

  test("a binary missing from the image fails the reconciliation and names the path", () => {
    const built = toProvenanceRecords(parseProvenanceEnv(REAL_ENV));
    const rec = reconcileMeasured(built.records, { sums: { "/usr/local/bin/oc": "a".repeat(64) } });
    assert.equal(rec.ok, false);
    assert.match(rec.problems.join(" "), /\/usr\/local\/bin\/oc-mirror/);
  });

  test("sha256sum and stat output parse, and junk lines are ignored rather than mis-parsed", () => {
    assert.deepEqual(parseSha256Sums("notahash /x\n"), {});
    assert.deepEqual(parseSizes("garbage\n/a/b 12\n"), { "/a/b": 12 });
  });
});

describe("in-image inventory fails closed", () => {
  test("reads the real provenance and reconciles it against measured binaries", () => {
    const res = inventoryBakedTools("podman", "sha256:deadbeef", { runner: fakeImageRunner() });
    assert.equal(res.ok, true);
    assert.equal(res.baked.length, BAKED_TOOLS.length);
    assert.equal(res.baked.find((t) => t.tool === "oc").version, "4.22.17");
  });

  test("no engine, no image id, and an absent provenance file each fail closed", () => {
    assert.equal(inventoryBakedTools(null, "id").ok, false);
    assert.equal(inventoryBakedTools("podman", null).ok, false);
    const absent = inventoryBakedTools("podman", "id", { runner: fakeImageRunner({ envStatus: 1 }) });
    assert.equal(absent.ok, false);
    assert.match(absent.reason, /absent or empty/);
  });

  test("an incomplete provenance file names the missing field instead of producing a short list", () => {
    const env = REAL_ENV.split("\n").filter((l) => !l.startsWith("OC_MIRROR_RESOLVED_SHA256=")).join("\n");
    const res = inventoryBakedTools("podman", "id", { runner: fakeImageRunner({ env }) });
    assert.equal(res.ok, false);
    assert.match(res.reason, /OC_MIRROR_RESOLVED_SHA256/);
    assert.equal(res.baked, undefined);
  });
});

describe("the binaries no image contains", () => {
  test("openshift-install and mirror-registry are declared, with bakedIntoImage false", () => {
    const names = RUNTIME_ACQUIRED_TOOLS.map((t) => t.tool).sort();
    assert.deepEqual(names, ["mirror-registry", "openshift-install"]);
    for (const t of RUNTIME_ACQUIRED_TOOLS) assert.equal(t.bakedIntoImage, false);
  });

  test("every unverified tool carries a finding; the inventory cannot imply uniform verification", () => {
    for (const t of RUNTIME_ACQUIRED_TOOLS) {
      if (!t.checksumVerified) assert.ok(t.finding && t.finding.length > 10, `${t.tool} lacks a finding`);
    }
  });

  // These three assertions replace a pair that pinned verificationGaps.length
  // === 2. That count was the DEFECT, not the contract: openshift-install and
  // mirror-registry were downloaded with no integrity check at all, and the
  // tests encoded that state as the expected result — the same trap Tranche 7B
  // hit, where a backend test pinned the broken SR-IOV shape. Closing the gaps
  // in backend/src/verifiedDownload.js turned those tests red for the right
  // reason. What is pinned now is the MECHANISM and the HONESTY of the
  // document, neither of which may regress, rather than a number that is only
  // correct while the product is broken.

  test("gap reporting is driven by checksumVerified, so a regression reappears in the document", () => {
    const unverified = RUNTIME_ACQUIRED_TOOLS.filter((t) => !t.checksumVerified);
    const inv = externalBinaryInventory("podman", "sha256:deadbeef", { runner: fakeImageRunner() });
    assert.equal(
      inv.verificationGaps.length,
      unverified.length,
      "verificationGaps must mirror the tools declaring checksumVerified false"
    );
    assert.deepEqual(
      inv.verificationGaps.map((g) => g.tool).sort(),
      unverified.map((t) => t.tool).sort()
    );
  });

  test("every runtime-acquired tool is now checksum-verified, and says how without overclaiming", () => {
    for (const t of RUNTIME_ACQUIRED_TOOLS) {
      assert.equal(t.checksumVerified, true, `${t.tool} is no longer expected to be unverified`);
      assert.ok(t.verificationMethod, `${t.tool} must state how it is verified`);
      // The distinction that matters: a checksum fetched from the artifact's own
      // origin is not a signature. The document must not let a reader infer one.
      assert.match(t.verificationMethod, /SHA256/);
      assert.match(t.verificationMethod, /signature NOT verified/);
    }
  });

  test("the full inventory still carries its companion-document contract", () => {
    const inv = externalBinaryInventory("podman", "sha256:deadbeef", { runner: fakeImageRunner() });
    assert.equal(inv.complete, true);
    assert.equal(inv.baked.length, 2);
    assert.match(inv.contract, /appear in NO generated SBOM/);
    assert.equal(inv.runtimeAcquired.length, 2);
  });

  test("a broken baked inventory makes the whole document incomplete", () => {
    const inv = externalBinaryInventory("podman", "id", { runner: fakeImageRunner({ envStatus: 1 }) });
    assert.equal(inv.complete, false);
    assert.match(inv.reason, /absent or empty/);
    // Gaps are still reported from the declarations regardless of baked state.
    assert.ok(Array.isArray(inv.verificationGaps));
  });
});
