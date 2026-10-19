/**
 * Evidence must survive being copied to another machine.
 *
 * The `component-inventory` axis emits a tamper-evidence manifest over its
 * generated SBOMs. That manifest recorded each file by ABSOLUTE path, because
 * `EvidenceStore.artifactPath()` returns absolute paths and
 * `hashEvidenceFile` stored whatever it was handed. Two consequences, both
 * bad for a document whose whole purpose is to be archived and checked later:
 *
 *   1. It disclosed the build host's directory layout and username into
 *      evidence intended for external readers.
 *   2. It described locations the verifying machine does not have, so a
 *      copied bundle pointed at nothing.
 *
 * The fix passes a `root` so paths are recorded relative to the run
 * directory. These tests pin both halves of the contract: paths are portable,
 * AND `manifestDigest` is unchanged by the path form — which is what makes a
 * copied bundle verifiable at all. If the digest depended on the path, the
 * same bytes would verify differently in two places and the manifest would be
 * worthless off-host.
 *
 * @author Bill Strauss
 * Developed with AI assistance from Claude (Anthropic) and Cursor AI.
 */

import { describe, test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { evidenceManifest, hashEvidenceFile } from "./releaseEvidence.mjs";

let root;
let elsewhere;

before(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "oaa-evidence-portable-"));
  fs.mkdirSync(path.join(root, "component-inventory"), { recursive: true });
  fs.writeFileSync(path.join(root, "component-inventory", "backend.cyclonedx-json.json"), '{"bomFormat":"CycloneDX"}\n');
  fs.writeFileSync(path.join(root, "component-inventory", "external-binaries.json"), '{"contract":"REQUIRED"}\n');

  // A second root holding byte-identical files, standing in for the same
  // bundle unpacked on a different machine at a different path.
  elsewhere = fs.mkdtempSync(path.join(os.tmpdir(), "oaa-evidence-copied-"));
  fs.mkdirSync(path.join(elsewhere, "component-inventory"), { recursive: true });
  fs.writeFileSync(path.join(elsewhere, "component-inventory", "backend.cyclonedx-json.json"), '{"bomFormat":"CycloneDX"}\n');
  fs.writeFileSync(path.join(elsewhere, "component-inventory", "external-binaries.json"), '{"contract":"REQUIRED"}\n');
});

after(() => {
  for (const d of [root, elsewhere]) if (d) fs.rmSync(d, { recursive: true, force: true });
});

const files = (base) => [
  path.join(base, "component-inventory", "backend.cyclonedx-json.json"),
  path.join(base, "component-inventory", "external-binaries.json"),
];

describe("evidence manifests are portable", () => {
  test("records paths relative to the run root, not absolute host paths", () => {
    const m = evidenceManifest(files(root), { root });

    for (const f of m.files) {
      assert.ok(!path.isAbsolute(f.path), `recorded path must not be absolute: ${f.path}`);
      assert.ok(!f.path.includes(os.homedir()), `recorded path must not leak the home directory: ${f.path}`);
      assert.ok(!f.path.includes(os.tmpdir()), `recorded path must not leak the temp root: ${f.path}`);
    }

    assert.deepEqual(
      m.files.map((f) => f.path).sort(),
      ["component-inventory/backend.cyclonedx-json.json", "component-inventory/external-binaries.json"]
    );
  });

  test("a bundle copied to a different path produces the identical manifest digest", () => {
    // The property that makes off-host verification possible.
    const here = evidenceManifest(files(root), { root });
    const there = evidenceManifest(files(elsewhere), { root: elsewhere });

    assert.equal(there.manifestDigest, here.manifestDigest, "same bytes must verify identically at a different path");
    assert.deepEqual(there.files.map((f) => f.path), here.files.map((f) => f.path));
  });

  test("changing a byte still moves the digest, so portability did not weaken tamper evidence", () => {
    const before = evidenceManifest(files(root), { root }).manifestDigest;
    const target = path.join(root, "component-inventory", "external-binaries.json");
    const original = fs.readFileSync(target);
    try {
      fs.writeFileSync(target, '{"contract":"TAMPERED"}\n');
      const after = evidenceManifest(files(root), { root }).manifestDigest;
      assert.notEqual(after, before, "a changed evidence file must move the manifest digest");
    } finally {
      fs.writeFileSync(target, original);
    }
  });

  test("an unreadable file is reported by its portable path, not its absolute one", () => {
    const missing = path.join(root, "component-inventory", "does-not-exist.json");
    const m = evidenceManifest([...files(root), missing], { root });

    assert.equal(m.complete, false, "a missing evidence file must not quietly shrink the manifest");
    assert.deepEqual(m.unreadable, ["component-inventory/does-not-exist.json"]);
    for (const p of m.unreadable) assert.ok(!path.isAbsolute(p), `unreadable path must be portable: ${p}`);
  });

  test("a file outside the root degrades to its basename rather than leaking a path", () => {
    const outside = path.join(elsewhere, "component-inventory", "backend.cyclonedx-json.json");
    const entry = hashEvidenceFile(outside, { root });

    assert.equal(entry.path, "backend.cyclonedx-json.json", "must fall back to the basename");
    assert.ok(!entry.path.includes(os.tmpdir()), "must never fall back to the absolute path");
  });

  test("omitting root preserves the previous behaviour for already-relative callers", () => {
    // Backward compatibility: callers that already pass relative paths must
    // keep getting exactly what they passed.
    const entry = hashEvidenceFile("component-inventory/nope.json", {});
    assert.equal(entry.path, "component-inventory/nope.json");
  });
});
