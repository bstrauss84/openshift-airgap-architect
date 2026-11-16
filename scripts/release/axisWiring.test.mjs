/**
 * Tests for the 8D task-B rewiring of the three container axes.
 *
 * NO podman, NO scanner, NO network. Container engines are recorded fakes and
 * every scan artifact is a fixture written to a temp directory, so each test
 * asserts a BEHAVIOUR of the axis — which verdict it returns, and which argv
 * it built to get there — rather than the presence of a string.
 *
 * The emphasis is on the fail-closed branches, because those are the ones a
 * rewiring quietly breaks: an input the scanner could not read, a report that
 * describes a different image, a database whose identity was established from
 * a different cache than the scan used, an SBOM nobody tied to an image.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test, describe, afterEach } from "node:test";

import containersAxis, { crossCheckBinding } from "./axes/containers.mjs";
import vulnAxis, {
  NO_SCANNER_DIGEST_REASON,
  describeDatabase,
  reconcileNativeScannerIdentity,
  resolveCacheDir,
  resolveNativeScanner,
  scanPrepared,
  selectStrategy,
} from "./axes/image-vulnerabilities.mjs";
import inventoryAxis, { bindSbomToImage, selectGenerator, selectImageSbomGenerator } from "./axes/sbom.mjs";
import { REQUIRED_ROLES } from "./lib/images.mjs";

const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..");

const HEAD = "2e4c7aa8bdd7a00a370c0c5a95710eb30d0e422d";
const UBI_REV = "e573c6075f71cca94d900cafd032ccfa0f871961";
const ID_BACKEND = "a".repeat(64);
const ID_FRONTEND = "b".repeat(64);

const tempDirs = [];
function tmp(prefix) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(d);
  return d;
}
afterEach(() => {
  while (tempDirs.length) fs.rmSync(tempDirs.pop(), { recursive: true, force: true });
});

function candidateFixture({ clean = false, candidateId = "c".repeat(64) } = {}) {
  return {
    candidateId,
    exact: `${HEAD}${clean ? " (clean)" : "+dirty"}`,
    git: { head: HEAD, branch: "b", clean, modifiedPaths: clean ? [] : ["x"], untrackedPaths: [] },
    timestamp: "2026-10-14T00:00:00.000Z",
  };
}

/** The real local images: an INHERITED UBI revision label and nothing else. */
function inheritedLabelImages() {
  return [
    { role: "backend", ref: "localhost/be:latest", present: true, id: ID_BACKEND, os: "linux", architecture: "amd64", repoDigests: [`localhost/be@sha256:${"d".repeat(64)}`], labels: { "org.opencontainers.image.revision": UBI_REV, "vcs-ref": UBI_REV, name: "ubi9/nodejs-22", version: "9.8", release: "1", vendor: "Red Hat, Inc." } },
    { role: "frontend", ref: "localhost/fe:latest", present: true, id: ID_FRONTEND, os: "linux", architecture: "amd64", repoDigests: [], labels: { "org.opencontainers.image.revision": UBI_REV, "vcs-ref": UBI_REV, name: "ubi9/nginx-124", version: "9.8", release: "1", vendor: "Red Hat, Inc." } },
  ];
}

function manifestFor(images, candidate) {
  return { present: true, manifest: { candidateId: candidate.candidateId, images: images.map((i) => ({ role: i.role, id: i.id })) } };
}

/** Minimal EvidenceStore: real files in a temp directory, real relative paths. */
function fakeStore() {
  const root = tmp("oaa-axis-store-");
  return {
    root,
    artifactPath(axisId, filename) {
      const dir = path.join(root, axisId);
      fs.mkdirSync(dir, { recursive: true });
      return path.join(dir, filename);
    },
    writeArtifact(axisId, filename, contents) {
      const abs = this.artifactPath(axisId, filename);
      fs.writeFileSync(abs, typeof contents === "string" ? contents : `${JSON.stringify(contents, null, 2)}\n`);
      return path.relative(root, abs);
    },
  };
}

const okArchives = (dir) => ({ archiveFor: (img) => ({ ok: true, path: path.join(dir, `${img.role}.oci.tar`) }) });
const okLayouts = (dir) => ({ layoutFor: (key) => ({ ok: true, path: path.join(dir, key.slice(0, 8)), layoutVersion: "1.0.0", blobs: { verified: 5 } }) });

// ---------------------------------------------------------------------------
// containers: two provenance implementations, both consulted
// ---------------------------------------------------------------------------

describe("containers: the two provenance implementations are compared, not silently merged", () => {
  test("on TODAY'S real images both refuse, and they agree", () => {
    const images = inheritedLabelImages();
    const cc = crossCheckBinding(images, candidateFixture(), { present: false }, REQUIRED_ROLES);
    assert.equal(cc.ok, false);
    assert.equal(cc.disagreements.length, 0, "the inherited UBI label is treated as absent by both");
    assert.ok(cc.rows.every((r) => !r.gate.bound && !r.strict.bound));
  });

  test("with a build manifest both bind, by the same method", () => {
    const images = inheritedLabelImages();
    const candidate = candidateFixture();
    const cc = crossCheckBinding(images, candidate, manifestFor(images, candidate), REQUIRED_ROLES);
    assert.equal(cc.ok, true);
    assert.equal(cc.disagreements.length, 0);
    assert.deepEqual(cc.rows.map((r) => r.gate.method), ["build-manifest", "build-manifest"]);
  });

  test("DISAGREEMENT 1: no vcs-ref, four base labels — lib calls the label ours and never reaches the manifest", () => {
    // lib/provenance.mjs has ONE inherited signal (revision === vcs-ref).
    // Without a vcs-ref it treats the base's revision as this build's, reports
    // "built from a different revision", and returns BEFORE the manifest.
    // candidateBinding's three-signal classifier calls it inherited and falls
    // through, so the manifest binds. The strict implementation is the more
    // permissive one here.
    const images = inheritedLabelImages().map((i) => {
      const labels = { ...i.labels };
      delete labels["vcs-ref"];
      return { ...i, labels: { ...labels, "com.redhat.component": "nodejs-22-container", cpe: "cpe:/a:redhat:x" } };
    });
    const candidate = candidateFixture({ clean: true });
    const cc = crossCheckBinding(images, candidate, manifestFor(images, candidate), REQUIRED_ROLES);

    assert.equal(cc.disagreements.length, 2, "both roles diverge");
    assert.equal(cc.rows[0].gate.bound, false);
    assert.match(cc.rows[0].gate.reason, /built from a different revision/);
    assert.equal(cc.rows[0].strict.bound, true);
    assert.equal(cc.rows[0].strict.method, "build-manifest");
    assert.equal(cc.ok, false, "the conjunction keeps the conservative answer");
  });

  test("DISAGREEMENT 2: a base vcs-ref equal to HEAD — lib binds on the label, the strict one refuses", () => {
    // The direction that makes the conjunction worth having. lib's inherited
    // test needs revision !== head, so a coincidence here flips it to
    // "build-supplied" and it binds. candidateBinding sees revision === vcs-ref
    // and refuses.
    const images = inheritedLabelImages().map((i) => ({ ...i, labels: { ...i.labels, "org.opencontainers.image.revision": HEAD, "vcs-ref": HEAD } }));
    const candidate = candidateFixture({ clean: true });
    const cc = crossCheckBinding(images, candidate, { present: false }, REQUIRED_ROLES);

    assert.equal(cc.rows[0].gate.bound, true);
    assert.equal(cc.rows[0].gate.method, "oci-label:revision");
    assert.equal(cc.rows[0].strict.bound, false);
    assert.equal(cc.ok, false);
    assert.match(cc.reason, /the two provenance implementations disagree and the stricter one refuses/);
  });

  test("the axis reports INCOMPLETE rather than resolving a disagreement in its own favour", async () => {
    const images = inheritedLabelImages().map((i) => ({ ...i, labels: { ...i.labels, "org.opencontainers.image.revision": HEAD, "vcs-ref": HEAD } }));
    const res = await containersAxis.run({
      store: fakeStore(),
      shippingImages: { engine: "podman", images },
      candidate: candidateFixture({ clean: true }),
      buildManifest: { present: false },
    });
    assert.equal(res.status, "INCOMPLETE");
    assert.match(res.detail, /provenance implementations disagree/);
  });

  test("no engine is INCOMPLETE, never a skip", async () => {
    const res = await containersAxis.run({ store: fakeStore(), shippingImages: { engine: null, images: [] }, candidate: candidateFixture(), buildManifest: { present: false } });
    assert.equal(res.status, "INCOMPLETE");
    assert.match(res.detail, /no container engine/);
  });
});

// ---------------------------------------------------------------------------
// image-vulnerabilities: transport, cache, subject
// ---------------------------------------------------------------------------

describe("image-vulnerabilities: one cache, both calls", () => {
  test("a containerized scanner always gets a host directory to mount", () => {
    const c = resolveCacheDir({ kind: "containerized-trivy" }, { OAA_SCANNER_CACHE: "/var/tmp/db" });
    assert.deepEqual({ dir: c.dir, mounted: c.mounted, explicit: c.explicit }, { dir: "/var/tmp/db", mounted: true, explicit: true });
    assert.equal(c.containerPath, "/root/.cache/trivy");
  });

  test("a native scanner is left on the tool's own default unless the operator named one", () => {
    assert.deepEqual(resolveCacheDir({ kind: "native-trivy" }, {}), { dir: null, explicit: false, mounted: false, containerPath: null });
    const named = resolveCacheDir({ kind: "native-trivy" }, { TRIVY_CACHE_DIR: "/c" });
    assert.deepEqual({ dir: named.dir, explicit: named.explicit, mounted: named.mounted }, { dir: "/c", explicit: true, mounted: false });
  });

  test("THE IDENTITY CALL AND THE SCAN CALL RECEIVE THE SAME CACHE — containerized", () => {
    // Mounting for only one of them is the subtler form of the original bug:
    // the reported database would not be the database consulted.
    const calls = [];
    const runner = (cmd, argv) => {
      calls.push(argv);
      return { status: 0, stdout: JSON.stringify({ Version: "0.75.0", VulnerabilityDB: { Version: 2, UpdatedAt: "2026-10-13T00:00:00Z", NextUpdate: "2099-01-01T00:00:00Z" } }), stderr: "", spawnError: null, timedOut: false };
    };
    const cache = { dir: "/cache/x", explicit: true, mounted: true, containerPath: "/root/.cache/trivy" };
    const strategy = { kind: "containerized-trivy", tool: "trivy" };
    const layoutDir = tmp("oaa-layout-");
    const out = tmp("oaa-out-");

    describeDatabase(strategy, "podman", cache, new Date(), { runner });
    scanPrepared(strategy, "podman", { layoutPath: path.join(layoutDir, "img"), archivePath: "/n/a" }, path.join(out, "r.json"), cache, { runner });

    const mountArg = "/cache/x:/root/.cache/trivy:z";
    assert.ok(calls[0].includes(mountArg), `version call must mount the cache: ${calls[0].join(" ")}`);
    assert.ok(calls[1].includes(mountArg), `scan call must mount the SAME cache: ${calls[1].join(" ")}`);
  });

  test("THE IDENTITY CALL AND THE SCAN CALL RECEIVE THE SAME CACHE — native", () => {
    const calls = [];
    const runner = (cmd, argv) => {
      calls.push(argv);
      return { status: 0, stdout: JSON.stringify({ Version: "0.75.0", VulnerabilityDB: { Version: 2, UpdatedAt: "2026-10-13T00:00:00Z", NextUpdate: "2099-01-01T00:00:00Z" } }), stderr: "", spawnError: null, timedOut: false };
    };
    const cache = resolveCacheDir({ kind: "native-trivy" }, { OAA_SCANNER_CACHE: "/c" });
    const out = tmp("oaa-out-");
    fs.writeFileSync(path.join(out, "r.json"), "{}");

    describeDatabase({ kind: "native-trivy", tool: "trivy" }, null, cache, new Date(), { runner });
    scanPrepared({ kind: "native-trivy", tool: "trivy" }, null, { layoutPath: "/layout/x", archivePath: "/n/a" }, path.join(out, "r.json"), cache, { runner });

    for (const argv of calls) {
      assert.equal(argv[argv.indexOf("--cache-dir") + 1], "/c", `both calls carry the same --cache-dir: ${argv.join(" ")}`);
    }
  });
});

describe("image-vulnerabilities: the scanner reads the LAYOUT DIRECTORY, never the archive tar", () => {
  test("native trivy is given the converted layout directory", () => {
    // `--input <oci-archive tar>` cannot work: trivy stats <input>/index.json
    // and looks for a root manifest.json. Reproduced against the pinned
    // binary. This is the regression test for that.
    let argv = null;
    const runner = (cmd, a) => {
      argv = a;
      return { status: 0, stdout: "", stderr: "", spawnError: null, timedOut: false };
    };
    const out = tmp("oaa-out-");
    fs.writeFileSync(path.join(out, "r.json"), JSON.stringify({ Results: [] }));
    scanPrepared({ kind: "native-trivy", tool: "trivy" }, null, { layoutPath: "/inputs/abc", archivePath: "/archives/backend.oci.tar" }, path.join(out, "r.json"), { dir: null }, { runner });

    assert.equal(argv[argv.indexOf("--input") + 1], "/inputs/abc");
    assert.ok(!argv.join(" ").includes(".oci.tar"), "the archive tar must never reach trivy");
  });

  test("containerized trivy is given the layout directory inside the mount, read-only", () => {
    let argv = null;
    const runner = (cmd, a) => {
      argv = a;
      return { status: 0, stdout: JSON.stringify({ Results: [] }), stderr: "", spawnError: null, timedOut: false };
    };
    const out = tmp("oaa-out-");
    scanPrepared(
      { kind: "containerized-trivy", tool: "t" },
      "podman",
      { layoutPath: "/inputs/abc", archivePath: "/archives/backend.oci.tar" },
      path.join(out, "r.json"),
      { dir: "/c", mounted: true, containerPath: "/root/.cache/trivy" },
      { runner },
    );
    assert.equal(argv[argv.indexOf("--input") + 1], "/scan/abc");
    assert.ok(argv.includes("/inputs:/scan:ro,z"), "the artifact under certification is mounted read-only");
    assert.ok(!argv.join(" ").includes(".oci.tar"));
  });

  test("grype keeps the oci-archive transport, because oci-dir is unverified for it", () => {
    let argv = null;
    const runner = (cmd, a) => {
      argv = a;
      return { status: 0, stdout: JSON.stringify({ matches: [] }), stderr: "", spawnError: null, timedOut: false };
    };
    const out = tmp("oaa-out-");
    scanPrepared({ kind: "native-grype", tool: "grype" }, null, { layoutPath: "/inputs/abc", archivePath: "/archives/backend.oci.tar" }, path.join(out, "r.json"), { dir: null }, { runner });
    assert.ok(argv.includes("oci-archive:/archives/backend.oci.tar"));
  });
});

describe("image-vulnerabilities: scanner identity", () => {
  test("a native binary is identified by the sha256 of the file that will run", () => {
    const dir = tmp("oaa-bin-");
    const bin = path.join(dir, "trivy");
    fs.writeFileSync(bin, "#!/bin/sh\n");
    const runner = () => ({ status: 0, stdout: `${bin}\n`, stderr: "", spawnError: null, timedOut: false });
    const r = resolveNativeScanner("trivy", { runner });
    assert.equal(r.ok, true);
    assert.equal(r.path, bin);
    assert.match(r.sha256, /^[0-9a-f]{64}$/);
  });

  test("an unresolvable native scanner is a refusal", () => {
    const runner = () => ({ status: 1, stdout: "", stderr: "", spawnError: null, timedOut: false });
    assert.equal(resolveNativeScanner("trivy", { runner }).ok, false);
  });

  test("a binary digest substitutes for an image digest AND NOTHING ELSE", () => {
    const sha = "e".repeat(64);
    const before = { acceptable: false, reasons: [NO_SCANNER_DIGEST_REASON, "no scanner version was recorded"] };
    const after = reconcileNativeScannerIdentity(before, { path: "/usr/bin/trivy", sha256: sha });
    assert.deepEqual(after.reasons, ["no scanner version was recorded"]);
    assert.equal(after.acceptable, false, "the other blocker survives");

    const only = reconcileNativeScannerIdentity({ acceptable: false, reasons: [NO_SCANNER_DIGEST_REASON] }, { path: "/usr/bin/trivy", sha256: sha });
    assert.equal(only.acceptable, true);
    assert.match(only.identifiedBy, /native scanner binary/);
  });

  test("no binary digest means no substitution", () => {
    const before = { acceptable: false, reasons: [NO_SCANNER_DIGEST_REASON] };
    assert.deepEqual(reconcileNativeScannerIdentity(before, null), before);
    assert.deepEqual(reconcileNativeScannerIdentity(before, { sha256: "short" }), before);
  });

  test("an unpinned containerized scanner is still not a strategy", () => {
    // Injected fixture, NOT the live constant. Asserting this against
    // CONTAINERIZED_SCANNER only held while that happened to be unpinned, so
    // the guarantee stopped being tested the moment a digest was approved —
    // precisely when an accidental un-pinning would matter most.
    const unpinned = { tool: "trivy", image: "docker.io/aquasec/trivy", tag: null, digest: null };
    const s = selectStrategy({ nativeTrivy: false, nativeGrype: false, engine: "podman", scanner: unpinned });
    assert.equal(s.kind, null);
    assert.match(s.reason, /no approved pinned digest yet/);
  });

  test("a pinned containerized scanner IS a strategy, and names its digest", () => {
    const pinned = { tool: "trivy", image: "docker.io/aquasec/trivy", tag: "0.75.0", digest: "sha256:" + "a".repeat(64) };
    const s = selectStrategy({ nativeTrivy: false, nativeGrype: false, engine: "podman", scanner: pinned });
    assert.equal(s.kind, "containerized-trivy");
    assert.equal(s.tool, `${pinned.image}@${pinned.digest}`);
  });

  test("no container engine means no containerized fallback, pinned or not", () => {
    const pinned = { tool: "trivy", image: "docker.io/aquasec/trivy", tag: "0.75.0", digest: "sha256:" + "a".repeat(64) };
    assert.equal(selectStrategy({ nativeTrivy: false, nativeGrype: false, engine: null, scanner: pinned }).kind, null);
  });
});

describe("image-vulnerabilities: fail-closed end to end", () => {
  const FRESH_DB = { identified: true, scanner: "trivy", scannerVersion: "0.75.0", dbVersion: 2, builtAt: "2026-10-13T00:00:00Z", nextUpdate: "2099-01-01T00:00:00Z", expiredByToolDeclaration: false };

  function harness({ layouts, report, database = FRESH_DB, images = inheritedLabelImages(), manifest = true } = {}) {
    const candidate = candidateFixture();
    const archiveDir = tmp("oaa-arch-");
    const binDir = tmp("oaa-bin-");
    const bin = path.join(binDir, "trivy");
    fs.writeFileSync(bin, "#!/bin/sh\n");

    const runner = (cmd, argv) => {
      if (cmd === "sh") return { status: 0, stdout: `${bin}\n`, stderr: "", spawnError: null, timedOut: false };
      // native trivy scan: write the fixture report to --output
      const out = argv[argv.indexOf("--output") + 1];
      fs.writeFileSync(out, JSON.stringify(report));
      return { status: 0, stdout: "", stderr: "", spawnError: null, timedOut: false };
    };

    return {
      candidate,
      ctx: {
        store: fakeStore(),
        shippingImages: { engine: "podman", images },
        candidate,
        buildManifest: manifest ? manifestFor(images, candidate) : { present: false },
        archives: okArchives(archiveDir),
        scanInputs: layouts ?? okLayouts(tmp("oaa-layouts-")),
        now: new Date("2026-10-14T00:00:00Z"),
          // Hermetic by default. Without this the axis reads the external-binary
        // inventory out of the image, which means `podman run` through the fake
        // runner above — and that runner writes to `argv[indexOf("--output")+1]`,
        // which for an argv with no `--output` is `argv[0]`, i.e. a file called
        // `run` in the repository root. Tests do not write into the tree.
        // Individual tests override this with a real fixture.
      inject: { runner, strategy: { kind: "native-trivy", tool: "trivy" }, database, env: {}, externalBinaries: null },
      },
    };
  }

  const cleanReport = (id) => ({ ArtifactName: "/scan", Metadata: { ImageID: `sha256:${id}` }, Results: [{ Target: "t", Vulnerabilities: [{ Severity: "LOW", VulnerabilityID: "CVE-0", PkgName: "p" }] }] });

  test("no provenance is INCOMPLETE before any scanner is even selected", async () => {
    const { ctx } = harness({ manifest: false });
    const res = await vulnAxis.run(ctx);
    assert.equal(res.status, "INCOMPLETE");
    assert.match(res.detail, /not provably built from this candidate/);
  });

  test("a clean scan of bound images PASSES and records the converted input", async () => {
    const { ctx } = harness({ report: cleanReport(ID_BACKEND) });
    // Both roles are scanned; make the fixture match whichever image is asked for.
    ctx.inject.runner = (cmd, argv) => {
      if (cmd === "sh") return { status: 0, stdout: "/bin/true\n", stderr: "", spawnError: null, timedOut: false };
      const out = argv[argv.indexOf("--output") + 1];
      const id = path.basename(out).startsWith("backend") ? ID_BACKEND : ID_FRONTEND;
      fs.writeFileSync(out, JSON.stringify(cleanReport(id)));
      return { status: 0, stdout: "", stderr: "", spawnError: null, timedOut: false };
    };
    const res = await vulnAxis.run(ctx);
    assert.equal(res.status, "PASS", res.detail);
    assert.match(res.detail, /no critical\/high findings/);
    assert.equal(res.evidence.perImage[0].scanInput.blobsVerified, 5);
    assert.match(res.evidence.perImage[0].scannedArtifact, /OCI layout directory/);
    assert.equal(res.evidence.cache.sameCacheForBothCalls, true);
  });

  test("a CRITICAL finding FAILS", async () => {
    const { ctx } = harness({});
    ctx.inject.runner = (cmd, argv) => {
      if (cmd === "sh") return { status: 0, stdout: "/bin/true\n", stderr: "", spawnError: null, timedOut: false };
      const out = argv[argv.indexOf("--output") + 1];
      const id = path.basename(out).startsWith("backend") ? ID_BACKEND : ID_FRONTEND;
      fs.writeFileSync(out, JSON.stringify({ Metadata: { ImageID: `sha256:${id}` }, Results: [{ Vulnerabilities: [{ Severity: "CRITICAL", VulnerabilityID: "CVE-9", PkgName: "p" }] }] }));
      return { status: 0, stdout: "", stderr: "", spawnError: null, timedOut: false };
    };
    const res = await vulnAxis.run(ctx);
    assert.equal(res.status, "FAIL");
    assert.match(res.detail, /1 critical/);
  });

  test("AN UNCONVERTIBLE SCAN INPUT IS INCOMPLETE, NEVER A SKIP AND NEVER A PASS", async () => {
    const { ctx } = harness({
      report: cleanReport(ID_BACKEND),
      layouts: { layoutFor: () => ({ ok: false, reason: "3 blob(s) do not match their content address; the exported artifact is corrupt" }) },
    });
    const res = await vulnAxis.run(ctx);
    assert.equal(res.status, "INCOMPLETE");
    assert.match(res.detail, /scan input unusable/);
    assert.match(res.detail, /content address/);
  });

  test("A REPORT THAT DESCRIBES A DIFFERENT IMAGE IS INCONSISTENT, NOT ASSUMED TO MATCH", async () => {
    const { ctx } = harness({ report: cleanReport("9".repeat(64)) });
    const res = await vulnAxis.run(ctx);
    assert.equal(res.status, "INCOMPLETE");
    assert.match(res.detail, /does not describe this image/);
    assert.match(res.detail, /DIFFERENT image/);
  });

  test("a report with no subject at all is INCONSISTENT — ArtifactName is never accepted as a name", async () => {
    const { ctx } = harness({ report: { ArtifactName: "/scan", Results: [] } });
    const res = await vulnAxis.run(ctx);
    assert.equal(res.status, "INCOMPLETE");
    assert.match(res.detail, /carries no Metadata.ImageID/);
  });

  test("an expired database is INCOMPLETE even when the scan itself is clean", async () => {
    const { ctx } = harness({
      report: cleanReport(ID_BACKEND),
      database: { ...FRESH_DB, nextUpdate: "2020-01-01T00:00:00Z", expiredByToolDeclaration: true },
    });
    const res = await vulnAxis.run(ctx);
    assert.equal(res.status, "INCOMPLETE");
    assert.match(res.detail, /database unusable as evidence/);
  });

  test("an unidentifiable database — the empty-cache symptom — is INCOMPLETE", async () => {
    const { ctx } = harness({ report: cleanReport(ID_BACKEND), database: { identified: false, reason: "trivy version output carried no VulnerabilityDB block" } });
    const res = await vulnAxis.run(ctx);
    assert.equal(res.status, "INCOMPLETE");
    assert.match(res.detail, /no VulnerabilityDB block/);
  });

  test("a scanner that cannot be identified at all is INCOMPLETE, not PASS", async () => {
    const { ctx } = harness({ report: cleanReport(ID_BACKEND) });
    // `command -v` fails, so there is no binary digest and no image digest.
    ctx.inject.runner = (cmd, argv) => {
      if (cmd === "sh") return { status: 1, stdout: "", stderr: "", spawnError: null, timedOut: false };
      const out = argv[argv.indexOf("--output") + 1];
      const id = path.basename(out).startsWith("backend") ? ID_BACKEND : ID_FRONTEND;
      fs.writeFileSync(out, JSON.stringify(cleanReport(id)));
      return { status: 0, stdout: "", stderr: "", spawnError: null, timedOut: false };
    };
    const res = await vulnAxis.run(ctx);
    assert.equal(res.status, "INCOMPLETE");
    assert.match(res.detail, /scan provenance insufficient/);
    assert.match(res.detail, /cannot be identified by image digest/);
  });

  // -------------------------------------------------------------------------
  // The owner's inherited-risk acceptance must REACH the evidence.
  //
  // `vendorRiskDisposition` was correct and had no production caller: the axis
  // imported the attribution helpers and never the disposition, so the record
  // naming which binary the risk was accepted for was never written anywhere.
  // These assert the caller exists on the real path — remove the wiring and
  // every one of them fails.
  // -------------------------------------------------------------------------

  /** A report whose findings sit in the vendored oc-mirror binary. */
  const vendorReport = (id) => ({
    ArtifactName: "/scan",
    Metadata: { ImageID: `sha256:${id}` },
    Results: [{ Target: "usr/local/bin/oc-mirror", Class: "lang-pkgs", Vulnerabilities: [{ Severity: "HIGH", VulnerabilityID: "CVE-V", PkgName: "grpc", InstalledVersion: "1.0.0" }] }],
  });

  const bakedInventory = () => ({
    complete: true,
    reason: null,
    baked: ["oc", "oc-mirror"].map((tool) => ({
      tool,
      version: "4.22.18",
      arch: "x86_64",
      sha256: "a".repeat(64),
      url: `https://mirror.openshift.com/pub/openshift-v4/x86_64/clients/ocp/latest/${tool}.tar.gz`,
      path: `/usr/local/bin/${tool}`,
    })),
    runtimeAcquired: [{ tool: "mirror-registry" }],
  });

  function vendorHarness(inventory) {
    const { ctx } = harness({});
    ctx.inject.runner = (cmd, argv) => {
      if (cmd === "sh") return { status: 0, stdout: "/bin/true\n", stderr: "", spawnError: null, timedOut: false };
      const out = argv[argv.indexOf("--output") + 1];
      const id = path.basename(out).startsWith("backend") ? ID_BACKEND : ID_FRONTEND;
      fs.writeFileSync(out, JSON.stringify(vendorReport(id)));
      return { status: 0, stdout: "", stderr: "", spawnError: null, timedOut: false };
    };
    if (inventory !== undefined) ctx.inject.externalBinaries = inventory;
    return ctx;
  }

  test("the vendor acceptance is produced on the production path and written as its own artifact", async () => {
    const ctx = vendorHarness(bakedInventory());
    const res = await vulnAxis.run(ctx);

    // Still a FAIL. The acceptance changes nothing about the verdict.
    assert.equal(res.status, "FAIL", res.detail);
    assert.match(res.detail, /1 high/);

    const vr = res.evidence.vendorRisk;
    assert.ok(vr, "the axis emitted a vendor-risk record");
    assert.equal(vr.accepted, true);
    assert.deepEqual(vr.disposition.coversBinaries, ["oc-mirror"]);
    assert.equal(vr.disposition.decidedOn, "2026-10-16");
    assert.equal(vr.disposition.effect.changesAxisVerdict, false);

    // Portable: on disk, on its own, readable without the scan summary.
    const rel = res.artifacts.find((a) => a.endsWith("vendor-risk-disposition.json"));
    assert.ok(rel, `vendor-risk-disposition.json is among ${JSON.stringify(res.artifacts)}`);
    const onDisk = JSON.parse(fs.readFileSync(path.join(ctx.store.root, rel), "utf8"));
    assert.equal(onDisk.disposition.appliesTo.find((t) => t.tool === "oc-mirror").sha256, "a".repeat(64));
  });

  test("an unreadable tool inventory records NOT VERIFIED and still FAILS on the findings", async () => {
    const ctx = vendorHarness({ complete: false, reason: "tools-provenance.env unreadable" });
    const res = await vulnAxis.run(ctx);

    assert.equal(res.status, "FAIL", res.detail);
    assert.equal(res.evidence.vendorRisk.state, "NOT VERIFIED");
    assert.equal(res.evidence.vendorRisk.accepted, false);
    assert.equal(res.evidence.vendorRisk.findingCount, 2, "both images' vendor findings are still counted");
  });

  test("injecting a null inventory means 'none', and does not fall through to reading the image", async () => {
    // Regression guard. This was `inject.externalBinaries ?? <read the image>`,
    // so injecting `null` silently reached the real reader and shelled out
    // through the fake runner, which wrote a file named `run` into the repo
    // root. The sentinel is `in`, not `??`.
    const ctx = vendorHarness(null);
    const before = fs.readdirSync(REPO_ROOT).length;
    const res = await vulnAxis.run(ctx);

    assert.equal(res.evidence.vendorRisk.state, "NOT VERIFIED", "a null inventory is an absent one");
    assert.match(res.evidence.vendorRisk.reason, /no inventory was produced/);
    assert.equal(fs.readdirSync(REPO_ROOT).length, before, "the axis must not create files in the repository root");
  });

  test("a run with no vendor findings records not-applicable, not an acceptance", async () => {
    const { ctx } = harness({ report: cleanReport(ID_BACKEND) });
    ctx.inject.runner = (cmd, argv) => {
      if (cmd === "sh") return { status: 0, stdout: "/bin/true\n", stderr: "", spawnError: null, timedOut: false };
      const out = argv[argv.indexOf("--output") + 1];
      const id = path.basename(out).startsWith("backend") ? ID_BACKEND : ID_FRONTEND;
      fs.writeFileSync(out, JSON.stringify(cleanReport(id)));
      return { status: 0, stdout: "", stderr: "", spawnError: null, timedOut: false };
    };
    ctx.inject.externalBinaries = bakedInventory();
    const res = await vulnAxis.run(ctx);

    assert.equal(res.status, "PASS", res.detail);
    assert.equal(res.evidence.vendorRisk.state, "not-applicable");
    assert.equal(res.evidence.vendorRisk.accepted, false);
  });
});

// ---------------------------------------------------------------------------
// component-inventory
// ---------------------------------------------------------------------------

describe("component-inventory: generator selection", () => {
  test("syft selection is unchanged and does not consider trivy", () => {
    assert.equal(selectGenerator({ nativeSyft: true }).kind, "native-syft");
    assert.equal(selectGenerator({ nativeSyft: false, engine: "podman" }).kind, null);
  });

  test("the axis prefers syft, falls back to trivy, and refuses when neither is pinned", () => {
    // Unpinned fixture, not the live constant — see the matching note in the
    // scanner-selection test. A pinned production digest must not silently
    // retire this guarantee.
    const unpinned = { tool: "trivy", image: "docker.io/aquasec/trivy", tag: null, digest: null };
    assert.equal(selectImageSbomGenerator({ nativeSyft: true, nativeTrivy: true, generator: unpinned }).kind, "native-syft");
    assert.equal(selectImageSbomGenerator({ nativeSyft: false, nativeTrivy: true, generator: unpinned }).kind, "native-trivy");
    const none = selectImageSbomGenerator({ nativeSyft: false, nativeTrivy: false, engine: "podman", generator: unpinned });
    assert.equal(none.kind, null);
    assert.match(none.reason, /image-walked SBOM is the one document a lockfile cannot stand in for/);
  });

  test("a pinned containerized generator claims a verified subject binding", () => {
    const pinned = { tool: "trivy", image: "docker.io/aquasec/trivy", tag: "0.75.0", digest: "sha256:" + "b".repeat(64) };
    const g = selectImageSbomGenerator({ nativeSyft: false, nativeTrivy: false, engine: "podman", generator: pinned });
    assert.equal(g.kind, "containerized-trivy");
    assert.equal(g.subjectBindingVerified, true);
    assert.deepEqual(g.formats, ["cyclonedx-json"]);
  });

  test("only the trivy paths claim a verified subject binding", () => {
    assert.equal(selectImageSbomGenerator({ nativeSyft: true }).subjectBindingVerified, false);
    assert.equal(selectImageSbomGenerator({ nativeSyft: false, nativeTrivy: true }).subjectBindingVerified, true);
  });
});

describe("component-inventory: an SBOM must name the image it describes", () => {
  const doc = (id) => ({ metadata: { component: { name: "/scan/layout", properties: [{ name: "aquasecurity:trivy:ImageID", value: `sha256:${id}` }] } } });

  test("trivy's ImageID property binds to the CONFIG digest", () => {
    const r = bindSbomToImage({ kind: "native-trivy" }, doc(ID_BACKEND), `sha256:${ID_BACKEND}`);
    assert.equal(r.consistent, true);
    assert.equal(r.componentName, "/scan/layout", "the mount path is recorded but is never the evidence");
  });

  test("a document naming another image is refused", () => {
    const r = bindSbomToImage({ kind: "native-trivy" }, doc("9".repeat(64)), `sha256:${ID_BACKEND}`);
    assert.equal(r.consistent, false);
    assert.match(r.reason, /DIFFERENT image/);
  });

  test("SYFT OUTPUT IS UNBOUND UNTIL SOMEONE VERIFIES ITS SUBJECT FIELD", () => {
    // Deliberately stricter than the previous revision, which would have
    // PASSED on a syft SBOM with no subject check at all.
    const r = bindSbomToImage({ kind: "native-syft" }, doc(ID_BACKEND), `sha256:${ID_BACKEND}`);
    assert.equal(r.consistent, false);
    assert.match(r.reason, /not implemented for native-syft/);
  });
});

describe("component-inventory: fail-closed end to end", () => {
  const PROVENANCE_ENV = [
    "OC_RESOLVED_VERSION=4.22.3",
    `OC_RESOLVED_SHA256=${"1".repeat(64)}`,
    "OC_RESOLVED_CHANNEL=latest-4.22",
    "OC_MIRROR_RESOLVED_VERSION=4.22.1",
    `OC_MIRROR_RESOLVED_SHA256=${"2".repeat(64)}`,
    "OC_MIRROR_RESOLVED_CHANNEL=latest",
    "TOOLS_RESOLVED_ARCH=x86_64",
  ].join("\n");

  const RPM = "bash|(none)|5.1.8|9.el9|x86_64|bash-5.1.8-9.el9.src.rpm\nglibc|2|2.34|125.el9|x86_64|glibc-2.34-125.el9.src.rpm\n";

  /** A fake podman that answers every in-image read the inventory performs. */
  function imageRunner({ provenanceEnv = PROVENANCE_ENV, rpm = RPM } = {}) {
    return (cmd, argv) => {
      const joined = argv.join(" ");
      if (joined.includes("tools-provenance.env")) return { status: 0, stdout: provenanceEnv, stderr: "", spawnError: null, timedOut: false };
      if (joined.includes("sha256sum")) {
        return { status: 0, stdout: `${"3".repeat(64)}  /usr/local/bin/oc\n${"4".repeat(64)}  /usr/local/bin/oc-mirror\n`, stderr: "", spawnError: null, timedOut: false };
      }
      if (joined.includes("stat")) return { status: 0, stdout: "/usr/local/bin/oc 1000\n/usr/local/bin/oc-mirror 2000\n", stderr: "", spawnError: null, timedOut: false };
      if (joined.includes("rpm")) return { status: 0, stdout: rpm, stderr: "", spawnError: null, timedOut: false };
      return { status: 1, stdout: "", stderr: "unexpected call", spawnError: null, timedOut: false };
    };
  }

  function ctxFor({ runner, generator } = {}) {
    const images = inheritedLabelImages();
    const candidate = candidateFixture();
    return {
      repoRoot: REPO_ROOT,
      store: fakeStore(),
      shippingImages: { engine: "podman", images },
      candidate,
      buildManifest: manifestFor(images, candidate),
      archives: okArchives(tmp("oaa-arch-")),
      scanInputs: okLayouts(tmp("oaa-layouts-")),
      inject: { runner: runner ?? imageRunner(), ...(generator ? { generator } : {}) },
    };
  }

  test("no provenance is INCOMPLETE before any document is produced", async () => {
    const ctx = ctxFor();
    ctx.buildManifest = { present: false };
    const res = await inventoryAxis.run(ctx);
    assert.equal(res.status, "INCOMPLETE");
    assert.match(res.detail, /not provably built from this candidate/);
  });

  test("an incomplete external-binary inventory stops the axis", async () => {
    const res = await inventoryAxis.run(ctxFor({ runner: imageRunner({ provenanceEnv: "OC_RESOLVED_VERSION=4.22.3" }) }));
    assert.equal(res.status, "INCOMPLETE");
    assert.match(res.detail, /external-binary provenance is incomplete/);
  });

  test("THE OFFLINE INVENTORY IS PRODUCED AND IS REPRODUCIBLE, even with no SBOM generator", async () => {
    const res = await inventoryAxis.run(ctxFor({ generator: { kind: null, reason: "nothing is installed; the image-walked SBOM is the one document a lockfile cannot stand in for" } }));
    assert.equal(res.status, "INCOMPLETE", "an offline inventory is not an image-walked SBOM and must not read as one");
    assert.match(res.detail, /no image-walking SBOM generator available/);
    // ... but real evidence now exists, where before there was none.
    assert.ok(res.evidence.produced.offlineInventory.components > 100, "the lockfiles alone contribute hundreds of components");
    assert.equal(res.evidence.produced.offlineInventory.reproducible, true);
    assert.equal(res.evidence.produced.externalBinaries.baked, 2);
    assert.ok(res.evidence.produced.offlineInventory.tally["shipped-os"] >= 2, "rpm -qa inside each image contributes shipped-os components");
  });

  test("two independent runs over the same candidate produce the SAME inventory", async () => {
    // The serial number is a digest of the component set, so equality is a
    // statement about content, not about two files happening to look alike.
    const a = await inventoryAxis.run(ctxFor({ generator: { kind: null, reason: "x" } }));
    const b = await inventoryAxis.run(ctxFor({ generator: { kind: null, reason: "x" } }));
    assert.equal(a.evidence.produced.offlineInventory.serialNumber, b.evidence.produced.offlineInventory.serialNumber);
    assert.match(a.evidence.produced.offlineInventory.serialNumber, /^urn:uuid:/);
  });

  test("A SYFT DOCUMENT WITH NO VERIFIED SUBJECT FIELD KEEPS THE AXIS INCOMPLETE", async () => {
    const ctx = ctxFor({ generator: { kind: "native-syft", tool: "syft", formats: ["spdx-json", "cyclonedx-json"], subjectBindingVerified: false } });
    const base = ctx.inject.runner;
    ctx.inject.runner = (cmd, argv) => {
      if (cmd === "syft") {
        const outFlag = argv.find((a) => a.includes("="));
        fs.writeFileSync(outFlag.split("=").slice(1).join("="), JSON.stringify({ metadata: { component: { name: "x" } } }));
        return { status: 0, stdout: "", stderr: "", spawnError: null, timedOut: false };
      }
      return base(cmd, argv);
    };
    const res = await inventoryAxis.run(ctx);
    assert.equal(res.status, "INCOMPLETE");
    assert.match(res.detail, /subject binding/);
  });

  test("a trivy CycloneDX document that names the image PASSES, with an evidence manifest digest", async () => {
    const ctx = ctxFor({ generator: { kind: "native-trivy", tool: "trivy", formats: ["cyclonedx-json"], subjectBindingVerified: true } });
    const base = ctx.inject.runner;
    ctx.inject.runner = (cmd, argv) => {
      if (cmd === "trivy") {
        const out = argv[argv.indexOf("--output") + 1];
        const id = path.basename(out).startsWith("backend") ? ID_BACKEND : ID_FRONTEND;
        fs.writeFileSync(
          out,
          JSON.stringify({
            bomFormat: "CycloneDX",
            metadata: { component: { name: "/scan/layout", properties: [{ name: "aquasecurity:trivy:ImageID", value: `sha256:${id}` }] } },
            components: [{ "bom-ref": "r1", name: "zlib", version: "1.2", purl: "pkg:rpm/zlib@1.2" }],
          }),
        );
        return { status: 0, stdout: "", stderr: "", spawnError: null, timedOut: false };
      }
      return base(cmd, argv);
    };
    const res = await inventoryAxis.run(ctx);
    assert.equal(res.status, "PASS", res.detail);
    assert.match(res.detail, /bound to its image config digest/);
    assert.match(res.evidence.evidence.manifestDigest, /^sha256:[0-9a-f]{64}$/);
    assert.equal(res.evidence.evidence.complete, true);
  });

  test("a generator that exits non-zero is INCOMPLETE, never a partial inventory", async () => {
    const ctx = ctxFor({ generator: { kind: "native-trivy", tool: "trivy", formats: ["cyclonedx-json"], subjectBindingVerified: true } });
    const base = ctx.inject.runner;
    ctx.inject.runner = (cmd, argv) => (cmd === "trivy" ? { status: 1, stdout: "", stderr: "boom", spawnError: null, timedOut: false } : base(cmd, argv));
    const res = await inventoryAxis.run(ctx);
    assert.equal(res.status, "INCOMPLETE");
    assert.match(res.detail, /image-walked SBOM unusable/);
  });

  test("an unparseable rpmdb read refuses the offline inventory rather than shrinking it", async () => {
    const res = await inventoryAxis.run(ctxFor({ runner: imageRunner({ rpm: "this is not a package line\n" }) }));
    assert.equal(res.status, "INCOMPLETE");
    assert.match(res.detail, /offline component inventory refused/);
  });
});
