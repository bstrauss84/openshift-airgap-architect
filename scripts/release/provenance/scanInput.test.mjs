/**
 * Tests for scanner input conversion.
 *
 * Offline and engine-free: real OCI layouts are small enough to build from
 * fs primitives, so the whole validation surface — including the corruption
 * path, which cannot be produced on demand from a real export — is covered
 * without podman, trivy or a network.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  SUPPORTED_LAYOUT_VERSION,
  TRANSPORTS,
  ScanInputs,
  convertArchiveToLayout,
  extractArchive,
  validateOciLayout,
  verifyBlobDigests,
} from "./scanInput.mjs";

function tmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "oaa-scaninput-test-"));
}

/** Write a minimal but structurally valid OCI layout with content-addressed blobs. */
function writeLayout(dir, { layoutVersion = SUPPORTED_LAYOUT_VERSION, manifests, blobs = ["config-bytes", "layer-bytes"] } = {}) {
  fs.mkdirSync(path.join(dir, "blobs", "sha256"), { recursive: true });
  fs.writeFileSync(path.join(dir, "oci-layout"), JSON.stringify({ imageLayoutVersion: layoutVersion }));

  const written = blobs.map((content) => {
    const digest = createHash("sha256").update(content).digest("hex");
    fs.writeFileSync(path.join(dir, "blobs", "sha256", digest), content);
    return digest;
  });

  const index = {
    schemaVersion: 2,
    manifests: manifests ?? [{ mediaType: "application/vnd.oci.image.manifest.v1+json", digest: `sha256:${written[0]}`, size: 1 }],
  };
  fs.writeFileSync(path.join(dir, "index.json"), JSON.stringify(index));
  return written;
}

describe("OCI layout validation", () => {
  test("accepts a well-formed layout directory", () => {
    const dir = tmp();
    writeLayout(dir);
    const v = validateOciLayout(dir);
    assert.equal(v.ok, true);
    assert.equal(v.layoutVersion, SUPPORTED_LAYOUT_VERSION);
    assert.equal(v.manifests.length, 1);
  });

  test("a FILE is rejected with the shape error, which is the real-world failure", () => {
    // This is exactly what the current code hands Trivy: a tar, not a dir.
    const dir = tmp();
    const file = path.join(dir, "image.oci.tar");
    fs.writeFileSync(file, "not a directory");
    const v = validateOciLayout(file);
    assert.equal(v.ok, false);
    assert.match(v.reason, /is a file, not an OCI layout directory/);
  });

  test("a missing oci-layout marker is refused", () => {
    const dir = tmp();
    writeLayout(dir);
    fs.rmSync(path.join(dir, "oci-layout"));
    assert.match(validateOciLayout(dir).reason, /oci-layout marker file is absent/);
  });

  test("an unrecognised imageLayoutVersion is refused rather than attempted", () => {
    const dir = tmp();
    writeLayout(dir, { layoutVersion: "2.0.0" });
    const v = validateOciLayout(dir);
    assert.equal(v.ok, false);
    assert.match(v.reason, /unsupported imageLayoutVersion "2\.0\.0"/);
  });

  test("a missing or unparseable index.json is refused", () => {
    const a = tmp();
    writeLayout(a);
    fs.rmSync(path.join(a, "index.json"));
    assert.match(validateOciLayout(a).reason, /index\.json is absent/);

    const b = tmp();
    writeLayout(b);
    fs.writeFileSync(path.join(b, "index.json"), "{not json");
    assert.match(validateOciLayout(b).reason, /unparseable index\.json/);
  });

  test("an index listing zero manifests is refused: there is nothing to scan", () => {
    const dir = tmp();
    writeLayout(dir, { manifests: [] });
    assert.match(validateOciLayout(dir).reason, /zero manifests/);
  });
});

describe("blob content-address verification", () => {
  test("verifies every blob against its own filename", () => {
    const dir = tmp();
    const written = writeLayout(dir);
    const v = verifyBlobDigests(dir);
    assert.equal(v.ok, true);
    assert.equal(v.verified, written.length);
    assert.ok(v.bytes > 0);
  });

  test("a corrupted blob is a hard failure, not a warning", () => {
    const dir = tmp();
    const [first] = writeLayout(dir);
    // Truncate one blob, simulating an incomplete export.
    fs.writeFileSync(path.join(dir, "blobs", "sha256", first), "tampered");
    const v = verifyBlobDigests(dir);
    assert.equal(v.ok, false);
    assert.match(v.reason, /do not match their content address/);
    assert.equal(v.mismatches.length, 1);
    assert.equal(v.mismatches[0].expected, first);
    assert.notEqual(v.mismatches[0].actual, first);
  });

  test("blobs under an unsupported algorithm are reported unverified, never silently passed", () => {
    const dir = tmp();
    writeLayout(dir);
    fs.mkdirSync(path.join(dir, "blobs", "md5"), { recursive: true });
    fs.writeFileSync(path.join(dir, "blobs", "md5", "abc123"), "x");
    const v = verifyBlobDigests(dir);
    assert.equal(v.ok, true);
    assert.equal(v.unverified.length, 1);
    assert.match(v.unverified[0].reason, /unsupported digest algorithm/);
  });

  test("a layout with no blobs directory is refused", () => {
    const dir = tmp();
    assert.match(verifyBlobDigests(dir).reason, /no blobs\/ directory/);
  });
});

describe("archive conversion", () => {
  /** A fake `run` that extracts by copying a prepared layout, so no tar is needed. */
  function fakeTar(sourceLayout, { status = 0, stderr = "" } = {}) {
    return (cmd, args) => {
      const destIdx = args.indexOf("-C");
      const dest = args[destIdx + 1];
      if (status === 0) fs.cpSync(sourceLayout, dest, { recursive: true });
      return { command: `${cmd} ${args.join(" ")}`, argv: [cmd, ...args], status, stderr, stdout: "", spawnError: null, timedOut: false, durationMs: 1 };
    };
  }

  test("converts an archive into a verified layout directory", () => {
    const src = tmp();
    writeLayout(src);
    const archive = path.join(tmp(), "backend.oci");
    fs.writeFileSync(archive, "pretend tar");
    const dest = path.join(tmp(), "out");

    const r = convertArchiveToLayout(archive, dest, { runner: fakeTar(src) });
    assert.equal(r.ok, true);
    assert.equal(r.path, dest);
    assert.equal(r.blobs.verified, 2);
    assert.equal(r.manifests.length, 1);
  });

  test("a missing archive fails closed before anything is extracted", () => {
    const r = convertArchiveToLayout("/nonexistent/backend.oci", path.join(tmp(), "out"), { runner: fakeTar(tmp()) });
    assert.equal(r.ok, false);
    assert.match(r.reason, /does not exist/);
  });

  test("a non-zero tar exit fails closed with tar's own message", () => {
    const archive = path.join(tmp(), "backend.oci");
    fs.writeFileSync(archive, "x");
    const r = convertArchiveToLayout(archive, path.join(tmp(), "out"), {
      runner: fakeTar(tmp(), { status: 2, stderr: "tar: Unexpected EOF in archive" }),
    });
    assert.equal(r.ok, false);
    assert.match(r.reason, /Unexpected EOF/);
  });

  test("an extracted tree that is not an OCI layout fails closed", () => {
    const src = tmp();
    fs.writeFileSync(path.join(src, "manifest.json"), "[]"); // docker-archive shape
    const archive = path.join(tmp(), "backend.oci");
    fs.writeFileSync(archive, "x");
    const r = convertArchiveToLayout(archive, path.join(tmp(), "out"), { runner: fakeTar(src) });
    assert.equal(r.ok, false);
    assert.match(r.reason, /not a usable OCI layout/);
  });

  test("corruption surfaces through conversion, so no scanner ever reads it", () => {
    const src = tmp();
    const [first] = writeLayout(src);
    fs.writeFileSync(path.join(src, "blobs", "sha256", first), "corrupt");
    const archive = path.join(tmp(), "backend.oci");
    fs.writeFileSync(archive, "x");
    const r = convertArchiveToLayout(archive, path.join(tmp(), "out"), { runner: fakeTar(src) });
    assert.equal(r.ok, false);
    assert.match(r.reason, /content address/);
  });

  test("extractArchive reports a spawn failure rather than pretending it worked", () => {
    const archive = path.join(tmp(), "a.oci");
    fs.writeFileSync(archive, "x");
    const r = extractArchive(archive, path.join(tmp(), "out"), {
      runner: () => ({ status: null, stderr: "", stdout: "", spawnError: "tar not found", timedOut: false, durationMs: 0 }),
    });
    assert.equal(r.ok, false);
    assert.match(r.reason, /could not execute tar/);
  });
});

describe("transports", () => {
  test("trivy takes the bare directory and is marked verified", () => {
    assert.equal(TRANSPORTS.trivy.build("/scan/backend"), "/scan/backend");
    assert.equal(TRANSPORTS.trivy.flag, "--input");
    assert.equal(TRANSPORTS.trivy.verified, true);
  });

  test("syft and grype oci-dir transports are present but explicitly NOT verified", () => {
    assert.equal(TRANSPORTS.grype.build("/scan/backend"), "oci-dir:/scan/backend");
    assert.equal(TRANSPORTS.syft.build("/scan/backend"), "oci-dir:/scan/backend");
    assert.equal(TRANSPORTS.grype.verified, false);
    assert.equal(TRANSPORTS.syft.verified, false);
  });
});

describe("run-scoped ScanInputs store", () => {
  function store(src) {
    return new ScanInputs({
      tmpRoot: os.tmpdir(),
      runner: (cmd, args) => {
        const dest = args[args.indexOf("-C") + 1];
        fs.cpSync(src, dest, { recursive: true });
        return { status: 0, stderr: "", stdout: "", spawnError: null, timedOut: false, durationMs: 1, argv: [cmd, ...args], command: cmd };
      },
    });
  }

  test("converts once per image id and reuses the result", () => {
    const src = tmp();
    writeLayout(src);
    const archive = path.join(tmp(), "backend.oci");
    fs.writeFileSync(archive, "x");

    const s = store(src);
    const first = s.layoutFor("sha256:abc", archive);
    const second = s.layoutFor("sha256:abc", archive);
    assert.equal(first.ok, true);
    assert.equal(first.reused, false);
    assert.equal(second.ok, true);
    assert.equal(second.reused, true);
    assert.equal(second.path, first.path);
    s.cleanup();
    assert.equal(fs.existsSync(first.path), false);
  });

  test("a failure is cached as a failure: the second caller gets the same hard error", () => {
    const s = new ScanInputs({
      runner: () => ({ status: 2, stderr: "tar: broken", stdout: "", spawnError: null, timedOut: false, durationMs: 1, argv: [], command: "tar" }),
    });
    const archive = path.join(tmp(), "backend.oci");
    fs.writeFileSync(archive, "x");
    assert.equal(s.layoutFor("sha256:abc", archive).ok, false);
    const second = s.layoutFor("sha256:abc", archive);
    assert.equal(second.ok, false);
    assert.equal(second.reused, true);
    s.cleanup();
  });

  test("cleanup is safe to call twice", () => {
    const s = new ScanInputs({});
    s.cleanup();
    assert.doesNotThrow(() => s.cleanup());
  });
});
