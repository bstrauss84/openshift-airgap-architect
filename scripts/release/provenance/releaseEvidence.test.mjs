/**
 * Tests for the production release-evidence bundle.
 *
 * Written as BEHAVIOUR tests against the shapes the real workflow actually
 * produced on 2026-10-14, not against invented fixtures. Where a fixture
 * stands in for real output, it is a reduced copy of the real output and the
 * observation it encodes is named in the test.
 *
 * The emphasis is deliberately on the fail-closed direction: for each way
 * evidence can be missing or inconsistent there is a test asserting the gate
 * REFUSES, because a gate that only has passing tests has not been tested.
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  ARTIFACT_KIND,
  BLOCKER,
  EVIDENCE_SCHEMA_VERSION,
  GATE_EXIT,
  SEVERITIES,
  assembleEvidenceBundle,
  assertReleaseArtifact,
  assessSbomReproducibility,
  canonicalDigest,
  canonicalJson,
  canonicalRef,
  canonicalizeCycloneDx,
  componentKey,
  evaluateReleaseGate,
  evidenceManifest,
  gateExitCode,
  hashEvidenceFile,
  reportSubjectConsistency,
  sbomSubjectConsistency,
  sha256Hex,
  summarizeFindings,
  topFindings,
} from "./releaseEvidence.mjs";

// ---------------------------------------------------------------------------
// Helpers producing evidence that WOULD pass, so each test can remove exactly
// one thing and prove that removal alone is what blocks.
// ---------------------------------------------------------------------------

const goodScanner = () => ({
  present: true,
  name: "trivy",
  version: "0.75.0",
  image: {
    ref: "docker.io/aquasec/trivy@sha256:af6acf9a",
    pinnedDigest: "sha256:af6acf9a",
    manifestDigest: "sha256:af6acf9a",
    configDigest: "sha256:6d93f1ec",
  },
});

const goodDb = () => ({
  identified: true,
  expired: false,
  schemaVersion: 2,
  updatedAt: "2026-10-13T19:11:46Z",
  nextUpdate: "2026-10-14T19:11:46Z",
});

const goodImage = (role = "backend") => ({
  role,
  present: true,
  configDigest: `sha256:cfg-${role}`,
  reportConsistency: { consistent: true },
  sbomConsistency: { consistent: true },
  binding: { bound: true, method: "oci-label:candidate-id" },
});

const goodInputs = () => ({
  candidate: { candidateId: "cand-1", head: "a".repeat(40), clean: true, dirtyCount: 0 },
  images: [goodImage("backend"), goodImage("frontend")],
  scanner: goodScanner(),
  database: goodDb(),
  sbomReproducibility: { ok: true },
  evidence: { complete: true, files: [], manifestDigest: "sha256:deadbeef" },
});

// ---------------------------------------------------------------------------
// Canonical JSON and hashing (item 9)
// ---------------------------------------------------------------------------

test("canonical JSON and evidence hashing", async (t) => {
  await t.test("key order does not change the digest", () => {
    assert.equal(canonicalJson({ b: 1, a: 2 }), canonicalJson({ a: 2, b: 1 }));
    assert.equal(canonicalDigest({ b: 1, a: 2 }), canonicalDigest({ a: 2, b: 1 }));
  });

  await t.test("nested key order does not change the digest", () => {
    assert.equal(canonicalDigest({ x: { p: 1, q: 2 } }), canonicalDigest({ x: { q: 2, p: 1 } }));
  });

  await t.test("array order DOES change the digest: order is content", () => {
    assert.notEqual(canonicalDigest([1, 2]), canonicalDigest([2, 1]));
  });

  await t.test("a changed value changes the digest", () => {
    assert.notEqual(canonicalDigest({ a: 1 }), canonicalDigest({ a: 2 }));
  });

  await t.test("an unreadable evidence file is reported, never skipped", () => {
    const h = hashEvidenceFile("/definitely/not/here.json");
    assert.equal(h.ok, false);
    assert.equal(h.sha256, null);
    assert.match(h.reason, /ENOENT|no such file/i);
  });

  await t.test("evidence manifest marks the set incomplete when any file is unreadable", () => {
    const fsImpl = {
      readFileSync(p) {
        if (p === "/ok.json") return Buffer.from("{}");
        throw new Error("ENOENT");
      },
    };
    const m = evidenceManifest(["/ok.json", "/missing.json"], { fsImpl });
    assert.equal(m.complete, false);
    assert.deepEqual(m.unreadable, ["/missing.json"]);
  });

  await t.test("the manifest digest covers the SET: adding a file changes it", () => {
    const fsImpl = { readFileSync: (p) => Buffer.from(p) };
    const one = evidenceManifest(["/a"], { fsImpl });
    const two = evidenceManifest(["/a", "/b"], { fsImpl });
    assert.equal(one.complete, true);
    assert.notEqual(one.manifestDigest, two.manifestDigest);
  });

  await t.test("the manifest digest is stable under input ordering", () => {
    const fsImpl = { readFileSync: (p) => Buffer.from(p) };
    assert.equal(
      evidenceManifest(["/a", "/b"], { fsImpl }).manifestDigest,
      evidenceManifest(["/b", "/a"], { fsImpl }).manifestDigest,
    );
  });

  await t.test("changing one byte of one file changes the manifest digest", () => {
    const a = { readFileSync: () => Buffer.from("x") };
    const b = { readFileSync: () => Buffer.from("y") };
    assert.notEqual(evidenceManifest(["/f"], { fsImpl: a }).manifestDigest, evidenceManifest(["/f"], { fsImpl: b }).manifestDigest);
  });

  await t.test("sha256Hex matches a known vector", () => {
    assert.equal(sha256Hex(""), "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  });
});

// ---------------------------------------------------------------------------
// CycloneDX canonicalisation (item 6)
// ---------------------------------------------------------------------------

/** Reduced copy of the real trivy CycloneDX shape, with the real variance. */
function cdxRun({ serial, timestamp, refs, order }) {
  const comps = [
    { "bom-ref": refs[0], type: "library", name: "buffer", version: "5.7.1", purl: "pkg:npm/buffer@5.7.1",
      properties: [{ name: "aquasecurity:trivy:FilePath", value: "app/node_modules/compress-commons/node_modules/buffer/package.json" }] },
    { "bom-ref": refs[1], type: "library", name: "buffer", version: "5.7.1", purl: "pkg:npm/buffer@5.7.1",
      properties: [{ name: "aquasecurity:trivy:FilePath", value: "app/node_modules/crc32-stream/node_modules/buffer/package.json" }] },
    { "bom-ref": refs[2], type: "library", name: "zod", version: "3.0.0", purl: "pkg:npm/zod@3.0.0", properties: [] },
  ];
  return {
    bomFormat: "CycloneDX",
    specVersion: "1.6",
    serialNumber: serial,
    metadata: {
      timestamp,
      component: { "bom-ref": refs[3], type: "container", name: "/scan",
        properties: [{ name: "aquasecurity:trivy:ImageID", value: "sha256:cfgbackend" }] },
    },
    components: order.map((i) => comps[i]),
    dependencies: order.map((i) => ({ ref: refs[i], dependsOn: [] })),
  };
}

test("CycloneDX canonicalisation", async (t) => {
  const runA = cdxRun({
    serial: "urn:uuid:aaaa", timestamp: "2026-10-14T15:00:55+00:00",
    refs: ["r-a0", "r-a1", "r-a2", "r-a3"], order: [0, 1, 2],
  });
  const runB = cdxRun({
    serial: "urn:uuid:bbbb", timestamp: "2026-10-14T15:00:56+00:00",
    refs: ["r-b0", "r-b1", "r-b2", "r-b3"], order: [2, 1, 0],
  });

  await t.test("raw runs differ (this is the real observed behaviour)", () => {
    assert.notEqual(canonicalDigest(runA), canonicalDigest(runB));
  });

  await t.test("canonical forms of two runs are identical", () => {
    const a = canonicalizeCycloneDx(runA);
    const b = canonicalizeCycloneDx(runB);
    assert.equal(a.ok, true);
    assert.equal(b.ok, true);
    assert.equal(a.digest, b.digest);
  });

  await t.test("per-run header fields are removed", () => {
    const { document } = canonicalizeCycloneDx(runA);
    assert.equal(document.serialNumber, undefined);
    assert.equal(document.metadata.timestamp, undefined);
  });

  await t.test("duplicate purls get DISTINCT refs when their content differs", () => {
    // The regression that purl-only keying missed: two `buffer` entries with
    // different FilePath must not collide, or their order stays arbitrary.
    const { document } = canonicalizeCycloneDx(runA);
    const buffers = document.components.filter((c) => c.purl === "pkg:npm/buffer@5.7.1");
    assert.equal(buffers.length, 2, "both buffer copies must survive");
    assert.notEqual(buffers[0]["bom-ref"], buffers[1]["bom-ref"]);
  });

  await t.test("components are sorted by the canonical ref", () => {
    const refs = canonicalizeCycloneDx(runA).document.components.map((c) => c["bom-ref"]);
    assert.deepEqual(refs, [...refs].sort());
  });

  await t.test("content-identical components collapse to one", () => {
    const dup = {
      components: [
        { "bom-ref": "x", name: "a", version: "1", purl: "pkg:npm/a@1" },
        { "bom-ref": "y", name: "a", version: "1", purl: "pkg:npm/a@1" },
      ],
      dependencies: [{ ref: "x", dependsOn: [] }, { ref: "y", dependsOn: [] }],
    };
    const { document } = canonicalizeCycloneDx(dup);
    assert.equal(document.components.length, 1);
    assert.equal(document.dependencies.length, 1, "collapsed refs must not leave duplicate dependency entries");
  });

  await t.test("dependency edges are remapped onto rewritten refs", () => {
    const doc = {
      components: [{ "bom-ref": "old", name: "a", version: "1", purl: "pkg:npm/a@1" }],
      dependencies: [{ ref: "old", dependsOn: ["old"] }],
    };
    const { document } = canonicalizeCycloneDx(document0(doc));
    const ref = document.components[0]["bom-ref"];
    assert.notEqual(ref, "old");
    assert.deepEqual(document.dependencies[0].dependsOn, [ref]);
  });

  await t.test("property order does not affect the canonical form", () => {
    const mk = (props) => ({ components: [{ "bom-ref": "r", name: "a", version: "1", purl: "pkg:npm/a@1", properties: props }] });
    const p1 = [{ name: "x", value: "1" }, { name: "y", value: "2" }];
    const p2 = [{ name: "y", value: "2" }, { name: "x", value: "1" }];
    assert.equal(canonicalizeCycloneDx(mk(p1)).digest, canonicalizeCycloneDx(mk(p2)).digest);
  });

  await t.test("a REAL content change still changes the canonical digest", () => {
    const changed = JSON.parse(JSON.stringify(runA));
    changed.components[2].version = "3.0.1";
    changed.components[2].purl = "pkg:npm/zod@3.0.1";
    assert.notEqual(canonicalizeCycloneDx(runA).digest, canonicalizeCycloneDx(changed).digest);
  });

  await t.test("canonicalising a non-object fails closed", () => {
    assert.equal(canonicalizeCycloneDx(null).ok, false);
    assert.equal(canonicalizeCycloneDx("nope").ok, false);
  });

  await t.test("componentKey falls back when there is no purl", () => {
    assert.equal(componentKey({ purl: "pkg:npm/a@1" }), "pkg:npm/a@1");
    assert.equal(componentKey({ name: "a", version: "1", type: "library" }), "library:a@1");
    assert.match(componentKey({}), /unnamed/);
  });

  await t.test("canonicalRef is total: same coordinate, different content, different ref", () => {
    const a = { purl: "pkg:npm/a@1", properties: [{ name: "p", value: "1" }] };
    const b = { purl: "pkg:npm/a@1", properties: [{ name: "p", value: "2" }] };
    assert.notEqual(canonicalRef(a), canonicalRef(b));
  });

  await t.test("canonicalRef ignores the random bom-ref itself", () => {
    assert.equal(canonicalRef({ purl: "pkg:npm/a@1", "bom-ref": "r1" }), canonicalRef({ purl: "pkg:npm/a@1", "bom-ref": "r2" }));
  });
});

function document0(d) {
  return d;
}

test("SBOM reproducibility assessment", async (t) => {
  const mk = (serial, ts, order) =>
    cdxRun({ serial, timestamp: ts, refs: [`${serial}0`, `${serial}1`, `${serial}2`, `${serial}3`], order });

  await t.test("a single run cannot demonstrate reproducibility", () => {
    const r = assessSbomReproducibility([{ bytes: Buffer.from("{}"), document: {} }]);
    assert.equal(r.ok, false);
    assert.match(r.reason, /at least two/);
  });

  await t.test("two runs differing only in per-run fields are canonically reproducible", () => {
    const a = mk("a", "2026-10-14T15:00:55+00:00", [0, 1, 2]);
    const b = mk("b", "2026-10-14T15:00:56+00:00", [2, 0, 1]);
    const r = assessSbomReproducibility([
      { bytes: Buffer.from(JSON.stringify(a)), document: a },
      { bytes: Buffer.from(JSON.stringify(b)), document: b },
    ]);
    assert.equal(r.ok, true);
    assert.equal(r.canonicallyIdentical, true);
    assert.equal(r.byteIdentical, false, "the real scanner is NOT byte-reproducible; the report must say so");
    assert.ok(r.canonicalDigest);
  });

  await t.test("byte-identical runs are reported as byte-identical", () => {
    const a = mk("a", "2026-10-14T15:00:55+00:00", [0, 1, 2]);
    const bytes = Buffer.from(JSON.stringify(a));
    const r = assessSbomReproducibility([{ bytes, document: a }, { bytes, document: a }]);
    assert.equal(r.byteIdentical, true);
    assert.match(r.reason, /byte-identical/);
  });

  await t.test("genuinely different content is NOT reported reproducible", () => {
    const a = mk("a", "2026-10-14T15:00:55+00:00", [0, 1, 2]);
    const b = JSON.parse(JSON.stringify(mk("b", "2026-10-14T15:00:56+00:00", [0, 1, 2])));
    b.components[2].version = "9.9.9";
    const r = assessSbomReproducibility([
      { bytes: Buffer.from(JSON.stringify(a)), document: a },
      { bytes: Buffer.from(JSON.stringify(b)), document: b },
    ]);
    assert.equal(r.ok, false);
    assert.equal(r.canonicallyIdentical, false);
    assert.equal(r.canonicalDigest, null);
  });
});

// ---------------------------------------------------------------------------
// Subject consistency (item 7)
// ---------------------------------------------------------------------------

test("scan report subject consistency", async (t) => {
  const identity = { configDigest: "sha256:7252836047c2" };

  await t.test("matching Metadata.ImageID is consistent", () => {
    const r = reportSubjectConsistency({ ArtifactName: "/scan", Metadata: { ImageID: "sha256:7252836047c2" } }, identity);
    assert.equal(r.consistent, true);
  });

  await t.test("ArtifactName is NEVER treated as evidence of identity", () => {
    // The real reports carry ArtifactName "/scan" — a mount path. A report
    // that merely claims the right NAME but carries the wrong ImageID must
    // still be refused.
    const r = reportSubjectConsistency(
      { ArtifactName: "localhost/openshift-airgap-architect-backend:latest", Metadata: { ImageID: "sha256:deadbeef" } },
      identity,
    );
    assert.equal(r.consistent, false);
    assert.equal(r.artifactNameTrusted, false);
    assert.match(r.reason, /DIFFERENT image/);
  });

  await t.test("a report with no ImageID fails closed", () => {
    const r = reportSubjectConsistency({ ArtifactName: "/scan", Metadata: {} }, identity);
    assert.equal(r.consistent, false);
    assert.match(r.reason, /no Metadata\.ImageID/);
  });

  await t.test("a missing expected digest fails closed rather than matching anything", () => {
    const r = reportSubjectConsistency({ Metadata: { ImageID: "sha256:abc" } }, {});
    assert.equal(r.consistent, false);
  });

  await t.test("an unprefixed digest is normalised, not rejected", () => {
    const r = reportSubjectConsistency({ Metadata: { ImageID: "7252836047c2" } }, identity);
    assert.equal(r.consistent, true);
  });

  await t.test("an empty report object fails closed", () => {
    assert.equal(reportSubjectConsistency({}, identity).consistent, false);
    assert.equal(reportSubjectConsistency(null, identity).consistent, false);
  });
});

test("SBOM subject consistency", async (t) => {
  const identity = { configDigest: "sha256:6154276a8ba0" };
  const doc = (imageId) => ({
    metadata: {
      component: {
        type: "container",
        name: "/scan",
        properties: imageId ? [{ name: "aquasecurity:trivy:ImageID", value: imageId }] : [],
      },
    },
  });

  await t.test("the BOM names the image via its ImageID property", () => {
    const r = sbomSubjectConsistency(doc("sha256:6154276a8ba0"), identity);
    assert.equal(r.consistent, true);
    assert.equal(r.componentType, "container");
  });

  await t.test("a BOM describing a different image is refused", () => {
    const r = sbomSubjectConsistency(doc("sha256:ffffffffffff"), identity);
    assert.equal(r.consistent, false);
    assert.match(r.reason, /DIFFERENT image/);
  });

  await t.test("a BOM naming no image at all is refused", () => {
    const r = sbomSubjectConsistency(doc(null), identity);
    assert.equal(r.consistent, false);
    assert.match(r.reason, /names no image/);
  });

  await t.test("component.name '/scan' is recorded but is not the identity", () => {
    const r = sbomSubjectConsistency(doc("sha256:6154276a8ba0"), identity);
    assert.equal(r.componentName, "/scan");
    assert.equal(r.repoDigestProperty, null, "the real SBOMs carry no RepoDigest: --input erases it");
  });
});

// ---------------------------------------------------------------------------
// Findings (item 8)
// ---------------------------------------------------------------------------

test("vulnerability summarisation", async (t) => {
  const report = {
    Results: [
      {
        Target: "/scan (redhat 9.8)",
        Class: "os-pkgs",
        Type: "redhat",
        Vulnerabilities: [
          { VulnerabilityID: "CVE-1", Severity: "CRITICAL", PkgName: "openssl", InstalledVersion: "1", FixedVersion: "2", Status: "fixed" },
          { VulnerabilityID: "CVE-2", Severity: "HIGH", PkgName: "glibc", InstalledVersion: "1", Status: "will_not_fix" },
          { VulnerabilityID: "CVE-3", Severity: "LOW", PkgName: "bash", InstalledVersion: "1", Status: "end_of_life" },
        ],
      },
      { Target: "Node.js", Class: "lang-pkgs", Type: "node-pkg", Vulnerabilities: [] },
    ],
  };

  await t.test("counts by severity", () => {
    const s = summarizeFindings(report);
    assert.equal(s.total, 3);
    assert.equal(s.bySeverity.CRITICAL, 1);
    assert.equal(s.bySeverity.HIGH, 1);
    assert.equal(s.bySeverity.LOW, 1);
    assert.equal(s.bySeverity.MEDIUM, 0);
  });

  await t.test("fix availability comes from FixedVersion, not from Status", () => {
    const s = summarizeFindings(report);
    assert.equal(s.fixAvailable, 1);
    assert.equal(s.fixUnavailable, 2);
  });

  await t.test("vendor applicability is reported separately and not collapsed", () => {
    const s = summarizeFindings(report);
    assert.equal(s.byVendorStatus.will_not_fix, 1);
    assert.equal(s.byVendorStatus.end_of_life, 1);
    assert.equal(s.byVendorStatus.fixed, 1);
  });

  await t.test("will_not_fix is still a finding, never dropped", () => {
    const s = summarizeFindings(report);
    assert.equal(s.total, 3, "suppressing will_not_fix would make this 2");
  });

  await t.test("an unknown severity is bucketed as UNKNOWN rather than lost", () => {
    const s = summarizeFindings({ Results: [{ Target: "t", Vulnerabilities: [{ Severity: "WEIRD" }] }] });
    assert.equal(s.total, 1);
    assert.equal(s.bySeverity.UNKNOWN, 1);
  });

  await t.test("an empty report summarises to zero without throwing", () => {
    const s = summarizeFindings({});
    assert.equal(s.total, 0);
    assert.deepEqual(Object.keys(s.bySeverity).sort(), [...SEVERITIES].sort());
  });

  await t.test("top findings are severity-ordered and deterministic", () => {
    const top = topFindings(report, 2);
    assert.equal(top.length, 2);
    assert.equal(top[0].severity, "CRITICAL");
    assert.equal(top[1].severity, "HIGH");
    assert.deepEqual(top, topFindings(report, 2));
  });

  await t.test("each finding carries package, fix and applicability", () => {
    const [first] = topFindings(report, 1);
    assert.equal(first.pkgName, "openssl");
    assert.equal(first.fixedVersion, "2");
    assert.equal(first.fixAvailable, true);
    assert.equal(first.vendorStatus, "fixed");
  });
});

// ---------------------------------------------------------------------------
// The fail-closed gate (item 11)
// ---------------------------------------------------------------------------

test("release gate: the passing baseline", async (t) => {
  await t.test("complete, consistent evidence is release-certifiable", () => {
    const g = evaluateReleaseGate(goodInputs());
    assert.deepEqual(g.blockers, [], "baseline must pass, or every negative test below proves nothing");
    assert.equal(g.releaseCertifiable, true);
  });
});

test("release gate: fail-closed matrix", async (t) => {
  const cases = [
    ["missing scanner", (i) => { i.scanner = null; }, BLOCKER.NO_SCANNER],
    ["scanner present but not identifiable by digest", (i) => { i.scanner.image = {}; }, BLOCKER.NO_SCANNER_DIGEST],
    ["scanner reports no version", (i) => { i.scanner.version = null; }, BLOCKER.NO_SCANNER_DIGEST],
    ["absent database", (i) => { i.database = null; }, BLOCKER.DB_ABSENT],
    ["unidentified database", (i) => { i.database = { identified: false, reason: "empty cache" }; }, BLOCKER.DB_UNIDENTIFIED],
    ["expired database", (i) => { i.database.expired = true; }, BLOCKER.DB_EXPIRED],
    ["absent image", (i) => { i.images[0].present = false; }, BLOCKER.IMAGE_ABSENT],
    ["no images at all", (i) => { i.images = []; }, BLOCKER.IMAGE_ABSENT],
    ["mismatched scan report identity", (i) => { i.images[0].reportConsistency = { consistent: false, reason: "describes a DIFFERENT image" }; }, BLOCKER.IMAGE_MISMATCH],
    ["mismatched SBOM subject", (i) => { i.images[0].sbomConsistency = { consistent: false, reason: "names no image" }; }, BLOCKER.SUBJECT_INCONSISTENT],
    ["image unbound from candidate", (i) => { i.images[0].binding = { bound: false, reason: "inherited label only" }; }, BLOCKER.UNBOUND_CANDIDATE],
    ["dirty candidate", (i) => { i.candidate.clean = false; i.candidate.dirtyCount = 28; }, BLOCKER.DIRTY_CANDIDATE],
    ["SBOM reproducibility never demonstrated", (i) => { i.sbomReproducibility = null; }, BLOCKER.SBOM_NONREPRODUCIBLE],
    ["SBOM not reproducible", (i) => { i.sbomReproducibility = { ok: false, reason: "canonical forms differ" }; }, BLOCKER.SBOM_NONREPRODUCIBLE],
    ["evidence manifest absent", (i) => { i.evidence = null; }, BLOCKER.EVIDENCE_UNHASHED],
    ["an evidence file could not be hashed", (i) => { i.evidence = { complete: false, unreadable: ["/x.json"] }; }, BLOCKER.EVIDENCE_UNHASHED],
  ];

  for (const [name, mutate, expected] of cases) {
    await t.test(`${name} => blocks with ${expected}`, () => {
      const inputs = goodInputs();
      mutate(inputs);
      const g = evaluateReleaseGate(inputs);
      assert.equal(g.releaseCertifiable, false, `"${name}" must NOT be certifiable`);
      assert.ok(g.blockerCodes.includes(expected), `expected blocker ${expected}, got ${g.blockerCodes.join(",")}`);
    });
  }

  await t.test("an entirely empty input set blocks rather than passing by default", () => {
    const g = evaluateReleaseGate({});
    assert.equal(g.releaseCertifiable, false);
    assert.ok(g.blockerCodes.length >= 4, "a default-constructed gate must not be nearly-passing");
  });

  await t.test("no-argument invocation also blocks", () => {
    assert.equal(evaluateReleaseGate().releaseCertifiable, false);
  });

  await t.test("multiple simultaneous defects are ALL reported, not just the first", () => {
    const i = goodInputs();
    i.scanner = null;
    i.database = null;
    i.evidence = null;
    const g = evaluateReleaseGate(i);
    assert.ok(g.blockerCodes.includes(BLOCKER.NO_SCANNER));
    assert.ok(g.blockerCodes.includes(BLOCKER.DB_ABSENT));
    assert.ok(g.blockerCodes.includes(BLOCKER.EVIDENCE_UNHASHED));
  });
});

// ---------------------------------------------------------------------------
// The bundle and the preliminary/release separation (items 10 and 12)
// ---------------------------------------------------------------------------

test("evidence bundle: structural separation of preliminary and release", async (t) => {
  const preliminaryInputs = () => {
    const i = goodInputs();
    i.candidate.clean = false;
    i.candidate.dirtyCount = 28;
    i.images[0].binding = { bound: false, reason: "only an INHERITED revision label" };
    return i;
  };

  await t.test("a clean, complete run produces a RELEASE artifact", () => {
    const b = assembleEvidenceBundle(goodInputs());
    assert.equal(b.kind, ARTIFACT_KIND.RELEASE);
    assert.equal(b.release.certifiable, true);
    assert.equal(b.preliminary, undefined);
  });

  await t.test("the real current situation produces a PRELIMINARY artifact", () => {
    const b = assembleEvidenceBundle(preliminaryInputs());
    assert.equal(b.kind, ARTIFACT_KIND.PRELIMINARY);
  });

  await t.test("a preliminary bundle has NO release block at all", () => {
    const b = assembleEvidenceBundle(preliminaryInputs());
    assert.equal(b.release, undefined, "a release block with certifiable:false could be misread; it must be absent");
    assert.equal(
      b.preliminary.blockerCodes.includes(BLOCKER.DIRTY_CANDIDATE) ||
        b.preliminary.blockerCodes.includes(BLOCKER.UNBOUND_CANDIDATE),
      true,
    );
  });

  await t.test("reading release.certifiable on a preliminary bundle THROWS", () => {
    const b = assembleEvidenceBundle(preliminaryInputs());
    assert.throws(() => b.release.certifiable, TypeError);
  });

  await t.test("a preliminary bundle records that a rescan is required after commit", () => {
    const b = assembleEvidenceBundle(preliminaryInputs());
    assert.equal(b.preliminary.rescanRequiredAfterCommit, true);
  });

  await t.test("the two kinds are different strings", () => {
    assert.notEqual(ARTIFACT_KIND.PRELIMINARY, ARTIFACT_KIND.RELEASE);
    assert.match(ARTIFACT_KIND.PRELIMINARY, /preliminary/);
  });

  await t.test("the bundle digest covers the bundle content", () => {
    const a = assembleEvidenceBundle({ ...goodInputs(), generatedAt: "2026-10-14T00:00:00Z" });
    const b = assembleEvidenceBundle({ ...goodInputs(), generatedAt: "2026-10-14T00:00:00Z" });
    assert.equal(a.bundleDigest, b.bundleDigest, "same inputs must give the same digest");
    const c = assembleEvidenceBundle({ ...preliminaryInputs(), generatedAt: "2026-10-14T00:00:00Z" });
    assert.notEqual(a.bundleDigest, c.bundleDigest);
  });

  await t.test("the bundle declares its schema version", () => {
    assert.equal(assembleEvidenceBundle(goodInputs()).schemaVersion, EVIDENCE_SCHEMA_VERSION);
  });
});

test("assertReleaseArtifact is the only ship gate", async (t) => {
  await t.test("accepts a release artifact", () => {
    assert.equal(assertReleaseArtifact(assembleEvidenceBundle(goodInputs())), true);
  });

  await t.test("THROWS on a preliminary artifact rather than returning false", () => {
    const i = goodInputs();
    i.candidate.clean = false;
    const b = assembleEvidenceBundle(i);
    assert.throws(() => assertReleaseArtifact(b), /PRELIMINARY/);
  });

  await t.test("throws on a missing bundle", () => {
    assert.throws(() => assertReleaseArtifact(null), /no evidence bundle/);
    assert.throws(() => assertReleaseArtifact(undefined), /no evidence bundle/);
  });

  await t.test("throws on an unknown schema version", () => {
    assert.throws(() => assertReleaseArtifact({ schemaVersion: 99, kind: ARTIFACT_KIND.RELEASE }), /unknown evidence schema/);
  });

  await t.test("throws on an unrecognised kind", () => {
    assert.throws(
      () => assertReleaseArtifact({ schemaVersion: EVIDENCE_SCHEMA_VERSION, kind: "something-else" }),
      /unrecognised artifact kind/,
    );
  });

  await t.test("a forged release kind without the assertion still throws", () => {
    assert.throws(
      () => assertReleaseArtifact({ schemaVersion: EVIDENCE_SCHEMA_VERSION, kind: ARTIFACT_KIND.RELEASE, release: { certifiable: false } }),
      /does not assert certifiability/,
    );
  });

  await t.test("renaming a preliminary bundle's kind does not make it shippable", () => {
    const i = goodInputs();
    i.candidate.clean = false;
    const b = assembleEvidenceBundle(i);
    b.kind = ARTIFACT_KIND.RELEASE; // tamper
    assert.throws(() => assertReleaseArtifact(b), /does not assert certifiability/);
  });
});

test("CI gate exit codes", async (t) => {
  await t.test("a release artifact exits 0", () => {
    assert.equal(gateExitCode(assembleEvidenceBundle(goodInputs())), GATE_EXIT.RELEASE);
  });

  await t.test("a preliminary artifact exits 2, distinct from a harness error", () => {
    const i = goodInputs();
    i.candidate.clean = false;
    assert.equal(gateExitCode(assembleEvidenceBundle(i)), GATE_EXIT.PRELIMINARY);
    assert.notEqual(GATE_EXIT.PRELIMINARY, GATE_EXIT.HARNESS_ERROR);
  });

  await t.test("a malformed bundle exits 3 (harness error), never 0", () => {
    assert.equal(gateExitCode(null), GATE_EXIT.HARNESS_ERROR);
    assert.equal(gateExitCode({ kind: "junk" }), GATE_EXIT.HARNESS_ERROR);
  });

  await t.test("no exit path returns 0 without a certifiable release artifact", () => {
    for (const b of [null, undefined, {}, { kind: "junk" }, assembleEvidenceBundle({ ...goodInputs(), candidate: { clean: false } })]) {
      assert.notEqual(gateExitCode(b), GATE_EXIT.RELEASE);
    }
  });
});
