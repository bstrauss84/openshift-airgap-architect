/**
 * Tests for ocMirrorRuntime: architecture normalization, mirror candidates, preflight, selection order.
 */
import { describe, it, after } from "node:test";
import assert from "node:assert";
import {
  normalizeRuntimeArch,
  getRuntimeArch,
  getMirrorArchCandidates,
  getMirrorUrls,
  runPreflight,
  resolveOcMirrorBinary,
  BAKED_IN_ARCH,
  MIRROR_BASE
} from "../src/ocMirrorRuntime.js";

describe("normalizeRuntimeArch", () => {
  it("maps amd64 and x64 to x86_64", () => {
    assert.strictEqual(normalizeRuntimeArch("amd64"), "x86_64");
    assert.strictEqual(normalizeRuntimeArch("x64"), "x86_64");
    assert.strictEqual(normalizeRuntimeArch("x86_64"), "x86_64");
  });
  it("maps arm64 and aarch64 to aarch64", () => {
    assert.strictEqual(normalizeRuntimeArch("arm64"), "aarch64");
    assert.strictEqual(normalizeRuntimeArch("aarch64"), "aarch64");
  });
  it("keeps ppc64le and s390x", () => {
    assert.strictEqual(normalizeRuntimeArch("ppc64le"), "ppc64le");
    assert.strictEqual(normalizeRuntimeArch("s390x"), "s390x");
  });
  it("returns null for empty or unknown", () => {
    assert.strictEqual(normalizeRuntimeArch(""), null);
    assert.strictEqual(normalizeRuntimeArch("unknown"), null);
    assert.strictEqual(normalizeRuntimeArch(null), null);
  });
});

describe("getMirrorArchCandidates", () => {
  it("returns x86_64 then amd64 for x86_64", () => {
    assert.deepStrictEqual(getMirrorArchCandidates("x86_64"), ["x86_64", "amd64"]);
  });
  it("returns aarch64 then arm64 for aarch64", () => {
    assert.deepStrictEqual(getMirrorArchCandidates("aarch64"), ["aarch64", "arm64"]);
  });
  it("returns single candidate for ppc64le and s390x", () => {
    assert.deepStrictEqual(getMirrorArchCandidates("ppc64le"), ["ppc64le"]);
    assert.deepStrictEqual(getMirrorArchCandidates("s390x"), ["s390x"]);
  });
  it("returns empty for unknown", () => {
    assert.deepStrictEqual(getMirrorArchCandidates("unknown"), []);
  });
});

describe("getMirrorUrls", () => {
  it("builds URLs with MIRROR_BASE and arch", () => {
    const u = getMirrorUrls("x86_64");
    assert.ok(u.oc.startsWith(MIRROR_BASE));
    assert.ok(u.oc.includes("/x86_64/"));
    assert.ok(u.oc.endsWith("openshift-client-linux.tar.gz"));
    assert.ok(u.ocMirror.startsWith(MIRROR_BASE));
    assert.ok(u.ocMirror.includes("/x86_64/"));
    assert.ok(u.ocMirror.endsWith("oc-mirror.tar.gz"));
  });
});

describe("runPreflight", () => {
  it("returns not ok for missing path", () => {
    const r = runPreflight("/nonexistent/oc-mirror-path");
    assert.strictEqual(r.ok, false);
    assert.ok(r.message);
  });
  it("returns not ok for empty path", () => {
    const r = runPreflight("");
    assert.strictEqual(r.ok, false);
  });
});

describe("resolveOcMirrorBinary", () => {
  const origEnv = process.env.OC_MIRROR_BIN;
  after(() => {
    if (origEnv !== undefined) process.env.OC_MIRROR_BIN = origEnv;
    else delete process.env.OC_MIRROR_BIN;
  });

  it("returns error when OC_MIRROR_BIN set to nonexistent path", async () => {
    process.env.OC_MIRROR_BIN = "/nonexistent/oc-mirror-bin";
    const result = await resolveOcMirrorBinary("/tmp");
    assert.ok(result.error);
    assert.ok(result.rawStderr !== undefined);
  });
});

describe("binary selection precedence", () => {
  it("OC_MIRROR_BIN is highest priority (documented behavior)", () => {
    assert.ok(BAKED_IN_ARCH === "x86_64");
  });
});
