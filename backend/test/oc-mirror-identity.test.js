/**
 * Option B (v2.2.0): oc-mirror identity comparison — unit level.
 *
 * @author Bill Strauss
 *
 * Developed with AI assistance from Claude (Anthropic).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { recordedToolIdentity, compareToolIdentity, versionedSourceUrl, localToolIdentity } from "../src/ocMirrorIdentity.js";

const A = "a".repeat(64);
const B = "b".repeat(64);

test("recorded identity keeps only well-formed values; uppercase SHA-256 is normalized", () => {
  const r = recordedToolIdentity({ sha256: A.toUpperCase(), version: "4.22.0-202610161337.p2.g5b31abd.assembly.stream.el9-5b31abd", gitCommit: "5b31abd", arch: "amd64", channelRelease: "4.22.19" });
  assert.equal(r.sha256, A);
  assert.equal(versionedSourceUrl(r), "https://mirror.openshift.com/pub/openshift-v4/x86_64/clients/ocp/4.22.19/");
  const bad = recordedToolIdentity({ sha256: "zz", arch: "../x", channelRelease: "latest", gitCommit: "not hex!" });
  assert.equal(bad.sha256, null);
  assert.equal(bad.malformedSha256, true);
  assert.equal(bad.arch, null);
  assert.equal(bad.channelRelease, null);
  assert.equal(bad.gitCommit, null);
  assert.equal(versionedSourceUrl(bad), null);
  assert.equal(versionedSourceUrl(recordedToolIdentity({ sha256: A, arch: "arm64", channelRelease: "4.22.19" })), "https://mirror.openshift.com/pub/openshift-v4/aarch64/clients/ocp/4.22.19/");
});

test("statuses: match, different (with versioned source when known), local-missing, not-recorded, invalid-recorded", () => {
  const rec = recordedToolIdentity({ sha256: A, version: "v1", arch: "amd64", channelRelease: "4.22.19" });
  assert.equal(compareToolIdentity(rec, { available: true, sha256: A }).status, "match");
  const diff = compareToolIdentity(rec, { available: true, sha256: B, version: "v2" });
  assert.equal(diff.status, "different");
  assert.match(diff.text, /clients\/ocp\/4\.22\.19\/ \(a versioned directory, not latest\)/);
  assert.doesNotMatch(diff.text, /corrupt|damaged copy|incompatible/i);
  assert.equal(compareToolIdentity(rec, { available: false, problem: "none is installed or configured" }).status, "local-missing");
  assert.equal(compareToolIdentity(recordedToolIdentity(null), { available: true, sha256: A }).status, "not-recorded");
  assert.equal(compareToolIdentity(recordedToolIdentity({ version: "v1" }), { available: true, sha256: A }).status, "not-recorded");
  assert.equal(compareToolIdentity(recordedToolIdentity({ sha256: "nope" }), { available: true, sha256: A }).status, "invalid-recorded");
  // A version string never decides: same version, different bytes = different.
  assert.equal(compareToolIdentity(recordedToolIdentity({ sha256: A, version: "same" }), { available: true, sha256: B, version: "same" }).status, "different");
});

test("a match makes no FIPS or suitability claim", () => {
  const t = compareToolIdentity(recordedToolIdentity({ sha256: A }), { available: true, sha256: A }).text;
  assert.match(t, /proves identical bytes only — not FIPS capability/);
  assert.doesNotMatch(t, /FIPS (certified|capable build)/i);
});

test("local identity: real file, symlink to it, empty file, directory, missing, describe failure", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "oaa-idlocal-"));
  try {
    const bin = path.join(dir, "oc-mirror"); fs.writeFileSync(bin, "#!/bin/sh\n", { mode: 0o755 });
    const link = path.join(dir, "link"); fs.symlinkSync(bin, link);
    const empty = path.join(dir, "empty"); fs.writeFileSync(empty, "");
    const describe = async (r) => ({ sha256: A, version: "v1", path: r.path });
    assert.equal((await localToolIdentity(() => ({ path: bin, source: "env" }), describe)).available, true);
    assert.equal((await localToolIdentity(() => ({ path: link, source: "env" }), describe)).available, true);
    assert.equal((await localToolIdentity(() => ({ path: empty, source: "env" }), describe)).problem, "the binary is empty");
    assert.equal((await localToolIdentity(() => ({ path: dir, source: "env" }), describe)).problem, "the configured path is not a regular file");
    assert.equal((await localToolIdentity(() => null, describe)).available, false);
    assert.equal((await localToolIdentity(() => ({ error: "x" }), describe)).available, false);
    assert.equal((await localToolIdentity(() => ({ path: bin }), async () => { throw new Error("EACCES"); })).problem, "it could not be read");
    assert.equal((await localToolIdentity(() => ({ path: bin, source: "env" }), describe)).source, "OC_MIRROR_BIN");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
