/**
 * Vendor inherited-risk accounting — the scope must hold under pressure.
 *
 * The owner approved inherited risk for unmodified official Red Hat binaries
 * ONLY. The dangerous failure is not that a vendor CVE gets accepted; it is
 * that a UBI RPM or an npm dependency gets accepted ALONGSIDE it and nobody
 * notices, because the summary only shows totals.
 *
 * So most of this file attacks the scope boundary rather than confirming the
 * happy path: a package name that merely resembles a vendor one, a path that
 * is a prefix of a vendor path, an OS package, a language package, and a
 * finding with no target at all. Every one of them must be attributed to the
 * project.
 *
 * @author Bill Strauss
 * Developed with AI assistance from Claude (Anthropic) and Cursor AI.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";

import {
  RISK_OWNER,
  VENDORED_BINARIES,
  ownerOf,
  attributeFindings,
  vendorRiskDisposition,
  assertNoProjectFindingAccepted,
  identitiesFromInventory,
  vendorRiskRecord,
} from "./vendorInheritedRisk.mjs";

const vuln = (id, severity, pkgName, fixedVersion = null) => ({
  VulnerabilityID: id,
  Severity: severity,
  PkgName: pkgName,
  InstalledVersion: "1.0.0",
  ...(fixedVersion ? { FixedVersion: fixedVersion } : {}),
});

const IDENTITY = [
  {
    tool: "oc-mirror",
    version: "4.22.18",
    architecture: "x86_64",
    sha256: "a".repeat(64),
    sourceUrl: "https://mirror.openshift.com/pub/openshift-v4/clients/ocp/latest/oc-mirror.tar.gz",
  },
];

describe("ownership is decided by path, never by name", () => {
  test("attributes a finding inside the vendored oc-mirror binary to Red Hat", () => {
    const r = ownerOf("usr/local/bin/oc-mirror");
    assert.equal(r.owner, RISK_OWNER.VENDOR_REDHAT);
    assert.equal(r.binary, "oc-mirror");
  });

  test("tolerates a leading slash and a Trivy suffix", () => {
    assert.equal(ownerOf("/usr/local/bin/oc").owner, RISK_OWNER.VENDOR_REDHAT);
    assert.equal(ownerOf("usr/local/bin/oc (gobinary)").owner, RISK_OWNER.VENDOR_REDHAT);
  });

  test("REFUSES a path that merely starts with a vendor path", () => {
    // `usr/local/bin/oc-mirror-wrapper` is not the vendored binary. A prefix
    // or substring match here would accept a project-owned file.
    const r = ownerOf("usr/local/bin/oc-mirror-wrapper");
    assert.equal(r.owner, RISK_OWNER.PROJECT);
  });

  test("REFUSES a package merely NAMED like a vendor tool", () => {
    // The catastrophic case: matching on package name rather than path.
    const r = ownerOf("registry.access.redhat.com/ubi9/nodejs-22-minimal (redhat 9.8)");
    assert.equal(r.owner, RISK_OWNER.PROJECT);
  });

  test("attributes an unknown path to the PROJECT, which is the fail-closed direction", () => {
    const r = ownerOf("usr/local/bin/some-new-tool");
    assert.equal(r.owner, RISK_OWNER.PROJECT);
    assert.match(r.reason, /not a declared vendored Red Hat binary path/);
  });

  test("attributes an empty target to the project rather than guessing", () => {
    assert.equal(ownerOf("").owner, RISK_OWNER.PROJECT);
    assert.equal(ownerOf(undefined).owner, RISK_OWNER.PROJECT);
  });

  test("mirror-registry declares no in-image path, so it can never match an image scan", () => {
    const mr = VENDORED_BINARIES.find((b) => b.tool === "mirror-registry");
    assert.equal(mr.inImage, false);
    assert.deepEqual(mr.paths, []);
  });
});

describe("attribution preserves every finding", () => {
  const report = {
    Results: [
      {
        Target: "usr/local/bin/oc-mirror",
        Class: "lang-pkgs",
        Vulnerabilities: [vuln("CVE-2026-33186", "CRITICAL", "google.golang.org/grpc", "1.79.3"), vuln("CVE-X", "HIGH", "golang.org/x/net")],
      },
      {
        Target: "registry.access.redhat.com/ubi9/nodejs-22-minimal (redhat 9.8)",
        Class: "os-pkgs",
        Vulnerabilities: [vuln("CVE-UBI-1", "HIGH", "util-linux"), vuln("CVE-UBI-2", "MEDIUM", "expat")],
      },
      {
        Target: "app/node_modules",
        Class: "lang-pkgs",
        Vulnerabilities: [vuln("CVE-NPM-1", "HIGH", "express", "4.22.4")],
      },
    ],
  };

  test("counts every finding, and splits them by owner without losing any", () => {
    const a = attributeFindings(report);
    assert.equal(a.all.total, 5);
    assert.equal(a.vendor.total, 2);
    assert.equal(a.project.total, 3);
    assert.equal(a.vendor.total + a.project.total, a.all.total, "no finding may fall between the two buckets");
  });

  test("UBI OS packages stay with the project", () => {
    const a = attributeFindings(report);
    const ubi = a.findings.filter((f) => f.id.startsWith("CVE-UBI"));
    assert.equal(ubi.length, 2);
    for (const f of ubi) assert.equal(f.owner, RISK_OWNER.PROJECT, `${f.id} must remain this project's obligation`);
  });

  test("npm dependencies stay with the project", () => {
    const a = attributeFindings(report);
    const npm = a.findings.find((f) => f.id === "CVE-NPM-1");
    assert.equal(npm.owner, RISK_OWNER.PROJECT);
  });

  test("every finding records WHY it was attributed where it was", () => {
    for (const f of attributeFindings(report).findings) {
      assert.ok(f.attributionReason && f.attributionReason.length > 10, `${f.id} must carry its reason`);
    }
  });

  test("the scope guard passes on a correct attribution", () => {
    assert.equal(assertNoProjectFindingAccepted(attributeFindings(report)), true);
  });

  test("the scope guard CATCHES a UBI finding smuggled into the vendor bucket", () => {
    // Simulates the exact regression the approval forbids.
    const tampered = attributeFindings(report);
    const ubi = tampered.findings.find((f) => f.id === "CVE-UBI-1");
    ubi.owner = RISK_OWNER.VENDOR_REDHAT;
    assert.throws(() => assertNoProjectFindingAccepted(tampered), /scope violation/);
  });

  test("the scope guard CATCHES a vendor-marked finding with no named binary", () => {
    const tampered = attributeFindings(report);
    tampered.findings[0].vendorBinary = null;
    assert.throws(() => assertNoProjectFindingAccepted(tampered), /scope violation/);
  });
});

describe("the disposition is per-artifact or it does not exist", () => {
  const findings = attributeFindings({
    Results: [{ Target: "usr/local/bin/oc-mirror", Class: "lang-pkgs", Vulnerabilities: [vuln("CVE-1", "CRITICAL", "grpc")] }],
  }).findings;

  test("records the immutable identity the acceptance is scoped to", () => {
    const d = vendorRiskDisposition({ toolIdentity: IDENTITY, findings, decidedOn: "2026-10-16" });
    assert.equal(d.decision, "inherited-risk-accepted");
    assert.equal(d.appliesTo[0].sha256, "a".repeat(64));
    assert.ok(d.appliesTo[0].version && d.appliesTo[0].architecture && d.appliesTo[0].sourceUrl);
  });

  test("REFUSES an acceptance that does not name the exact artifact", () => {
    // Without identity this is a blanket tool exception, which was withheld.
    assert.throws(
      () => vendorRiskDisposition({ toolIdentity: [{ tool: "oc-mirror", version: "4.22.18" }], findings }),
      /blanket tool exception/
    );
  });

  test("states plainly that it suppresses nothing", () => {
    const d = vendorRiskDisposition({ toolIdentity: IDENTITY, findings });
    assert.equal(d.effect.suppressesFindings, false);
    assert.equal(d.effect.reducesCounts, false);
    assert.equal(d.effect.changesAxisVerdict, false);
  });

  test("names what is OUT of scope, not only what is in", () => {
    const d = vendorRiskDisposition({ toolIdentity: IDENTITY, findings });
    const text = d.excludedFromScope.join(" ");
    assert.match(text, /UBI base-image OS packages/);
    assert.match(text, /npm dependencies/);
    assert.match(text, /code in this repository/);
  });

  test("carries a human-readable risk statement, not just a code", () => {
    const d = vendorRiskDisposition({ toolIdentity: IDENTITY, findings });
    assert.ok(d.riskStatement.length > 200, "an accepted risk must be explainable to a reader");
    assert.match(d.riskStatement, /unmodified/);
    assert.match(d.riskStatement, /expires the moment the artifact changes/);
  });

  test("retains the full finding detail rather than a count", () => {
    const d = vendorRiskDisposition({ toolIdentity: IDENTITY, findings });
    assert.equal(d.findingCount, 1);
    assert.equal(d.findings[0].id, "CVE-1");
    assert.equal(d.findings[0].vendorBinary, "oc-mirror");
  });
});

describe("EVIDENCE-01 — the acceptance must COVER the findings it accepts", () => {
  /**
   * THE DEFECT. The previous implementation iterated `toolIdentity` and
   * checked each member's fields. An empty array has no members, so
   * `vendorRiskDisposition({toolIdentity: [], findings: vendorFindings})`
   * returned a full acceptance record for findings whose artifact was never
   * named — the blanket tool exception the module's own header refuses. And
   * because nothing related identities to findings, an identity for one tool
   * silently covered accepted findings in another.
   *
   * These are attacks on that boundary, not confirmations of the happy path.
   */
  const findingsIn = (target, binaryId = "CVE-X") =>
    attributeFindings({
      Results: [{ Target: target, Class: "lang-pkgs", Vulnerabilities: [vuln(binaryId, "HIGH", "golang.org/x/net")] }],
    }).findings;

  const ocMirrorFindings = findingsIn("usr/local/bin/oc-mirror");
  const ocFindings = findingsIn("usr/local/bin/oc", "CVE-OC-1");

  const identityFor = (tool, over = {}) => ({
    tool,
    version: "4.22.18",
    architecture: "x86_64",
    sha256: "b".repeat(64),
    sourceUrl: `https://mirror.openshift.com/pub/openshift-v4/clients/ocp/latest/${tool}.tar.gz`,
    ...over,
  });

  test("REFUSES an empty identity list — the exact call that used to succeed", () => {
    assert.throws(
      () => vendorRiskDisposition({ toolIdentity: [], findings: ocMirrorFindings }),
      /at least one per-artifact identity/
    );
  });

  test("REFUSES a missing identity list entirely", () => {
    assert.throws(() => vendorRiskDisposition({ findings: ocMirrorFindings }), /at least one per-artifact identity/);
    assert.throws(() => vendorRiskDisposition(), /at least one per-artifact identity/);
  });

  test("REFUSES accepting findings in a binary no identity names", () => {
    // An `oc` identity does not license accepting `oc-mirror` findings.
    assert.throws(
      () => vendorRiskDisposition({ toolIdentity: [identityFor("oc")], findings: ocMirrorFindings }),
      /accepting findings in oc-mirror with no identity/
    );
  });

  test("accepts when every affected binary is covered, including more than one", () => {
    const d = vendorRiskDisposition({
      toolIdentity: [identityFor("oc"), identityFor("oc-mirror")],
      findings: [...ocFindings, ...ocMirrorFindings],
    });
    assert.deepEqual(d.coversBinaries, ["oc", "oc-mirror"]);
    assert.equal(d.findingCount, 2);
  });

  test("allows an identity for a declared artifact with no findings", () => {
    // mirror-registry ships in the export bundle and has no in-image path, so
    // it can never match an image scan — but it is inside the acceptance and
    // must still be nameable.
    const d = vendorRiskDisposition({
      toolIdentity: [identityFor("oc-mirror"), identityFor("mirror-registry")],
      findings: ocMirrorFindings,
    });
    assert.equal(d.appliesTo.length, 2);
  });

  test("REFUSES an identity for a tool that is not a declared vendored binary", () => {
    assert.throws(
      () =>
        vendorRiskDisposition({
          toolIdentity: [identityFor("oc-mirror"), identityFor("curl")],
          findings: ocMirrorFindings,
        }),
      /not declared vendored Red Hat binaries: curl/
    );
  });

  test("REFUSES two identities for the same tool, conflicting or not", () => {
    assert.throws(
      () =>
        vendorRiskDisposition({
          toolIdentity: [identityFor("oc-mirror"), identityFor("oc-mirror", { sha256: "c".repeat(64) })],
          findings: ocMirrorFindings,
        }),
      /oc-mirror \(conflicting\)/
    );
    assert.throws(
      () =>
        vendorRiskDisposition({
          toolIdentity: [identityFor("oc-mirror"), identityFor("oc-mirror")],
          findings: ocMirrorFindings,
        }),
      /oc-mirror \(repeated\)/
    );
  });

  test("REFUSES a value that is present but identifies nothing", () => {
    for (const [over, pattern] of [
      [{ sha256: "TBD" }, /not 64 hex characters/],
      [{ sha256: "a".repeat(63) }, /not 64 hex characters/],
      [{ sourceUrl: "mirror.openshift.com/oc-mirror.tar.gz" }, /not an absolute https URL/],
      [{ sourceUrl: "http://mirror.openshift.com/oc-mirror.tar.gz" }, /not an absolute https URL/],
    ]) {
      assert.throws(
        () => vendorRiskDisposition({ toolIdentity: [identityFor("oc-mirror", over)], findings: ocMirrorFindings }),
        pattern,
        `expected rejection for ${JSON.stringify(over)}`
      );
    }
  });

  test("REFUSES an identity still carrying the template placeholders", () => {
    // VENDORED_BINARIES.source is written with <arch>/<version>. Copying it
    // into an acceptance records the template, not the artifact fetched.
    assert.throws(
      () =>
        vendorRiskDisposition({
          toolIdentity: [
            identityFor("oc-mirror", {
              sourceUrl: "https://mirror.openshift.com/pub/openshift-v4/<arch>/clients/ocp/<version>/oc-mirror.tar.gz",
            }),
          ],
          findings: ocMirrorFindings,
        }),
      /unresolved placeholder/
    );
    assert.throws(
      () =>
        vendorRiskDisposition({
          toolIdentity: [identityFor("oc-mirror", { version: "<version>" })],
          findings: ocMirrorFindings,
        }),
      /unresolved placeholder/
    );
  });

  test("REFUSES a finding whose vendor attribution does not re-derive from its target", () => {
    // The UBI smuggling case, caught at the moment of acceptance rather than
    // only by the axis guard — acceptance is what would make it permanent.
    const tampered = attributeFindings({
      Results: [
        {
          Target: "registry.access.redhat.com/ubi9/nodejs-22-minimal (redhat 9.8)",
          Class: "os-pkgs",
          Vulnerabilities: [vuln("CVE-UBI-9", "HIGH", "util-linux")],
        },
      ],
    }).findings;
    tampered[0].owner = RISK_OWNER.VENDOR_REDHAT;
    tampered[0].vendorBinary = "oc-mirror";

    assert.throws(
      () => vendorRiskDisposition({ toolIdentity: [identityFor("oc-mirror")], findings: tampered }),
      /scope violation at acceptance/
    );
  });

  test("a UBI finding alongside a genuine vendor one is still not accepted", () => {
    // Nothing about tightening identity may change attribution: the project's
    // own findings stay the project's.
    const mixed = attributeFindings({
      Results: [
        { Target: "usr/local/bin/oc-mirror", Class: "lang-pkgs", Vulnerabilities: [vuln("CVE-V", "HIGH", "grpc")] },
        {
          Target: "registry.access.redhat.com/ubi9/nodejs-22-minimal (redhat 9.8)",
          Class: "os-pkgs",
          Vulnerabilities: [vuln("CVE-P", "CRITICAL", "expat")],
        },
      ],
    }).findings;

    const d = vendorRiskDisposition({ toolIdentity: [identityFor("oc-mirror")], findings: mixed });
    assert.equal(d.findingCount, 1, "only the vendor-owned finding is in the disposition");
    assert.equal(d.findings[0].id, "CVE-V");
    assert.equal(d.effect.reducesCounts, false);
    assert.equal(d.effect.changesAxisVerdict, false);
  });

  test("still suppresses nothing once the identity rules are satisfied", () => {
    const d = vendorRiskDisposition({ toolIdentity: [identityFor("oc-mirror")], findings: ocMirrorFindings });
    assert.equal(d.effect.suppressesFindings, false);
    assert.equal(d.decision, "inherited-risk-accepted");
    assert.match(d.effect.note, /non-waivable/);
  });
});

/**
 * The production path.
 *
 * `vendorRiskDisposition` was correct and unreachable: nothing outside this
 * file imported it, so the owner's per-artifact acceptance never reached
 * release evidence. These tests cover the bridge that gives it a caller, and
 * they lean on the failure directions, because the dangerous outcome is not a
 * missing record — it is a record that LOOKS like an acceptance when the run
 * could not actually name the artifacts it accepted.
 */
describe("vendorRiskRecord — the production caller", () => {
  const bakedRecord = (tool, over = {}) => ({
    tool,
    version: "4.22.18",
    sha256: "a".repeat(64),
    url: `https://mirror.openshift.com/pub/openshift-v4/x86_64/clients/ocp/latest/${tool}.tar.gz`,
    arch: "x86_64",
    path: `/usr/local/bin/${tool}`,
    checksumSubject: "distribution-tarball",
    checksumCovers: `${tool}.tar.gz`,
    checksumAuthority: "https://mirror.openshift.com/.../sha256sum.txt",
    ...over,
  });

  const inventory = (over = {}) => ({
    complete: true,
    reason: null,
    baked: [bakedRecord("oc"), bakedRecord("oc-mirror")],
    runtimeAcquired: [{ tool: "openshift-install" }, { tool: "mirror-registry" }],
    ...over,
  });

  const vendorAttribution = () =>
    attributeFindings({
      Results: [{ Target: "usr/local/bin/oc-mirror", Class: "lang-pkgs", Vulnerabilities: [vuln("CVE-V", "HIGH", "grpc")] }],
    });

  const mixedAttribution = () =>
    attributeFindings({
      Results: [
        { Target: "usr/local/bin/oc-mirror", Class: "lang-pkgs", Vulnerabilities: [vuln("CVE-V", "HIGH", "grpc")] },
        { Target: "registry.access.redhat.com/ubi9/nodejs-22-minimal (redhat 9.8)", Class: "os-pkgs", Vulnerabilities: [vuln("CVE-P", "CRITICAL", "expat")] },
      ],
    });

  test("produces an accepted per-artifact record naming every covered binary", () => {
    const rec = vendorRiskRecord({
      inventory: inventory(),
      attributions: [{ role: "backend", attribution: vendorAttribution() }],
      decidedOn: "2026-10-16",
    });

    assert.equal(rec.accepted, true);
    assert.equal(rec.state, "accepted");
    assert.equal(rec.disposition.decision, "inherited-risk-accepted");
    assert.deepEqual(rec.disposition.coversBinaries, ["oc-mirror"]);
    // The point of the whole record: the artifact is NAMED, exactly.
    const ocMirror = rec.disposition.appliesTo.find((t) => t.tool === "oc-mirror");
    assert.equal(ocMirror.version, "4.22.18");
    assert.equal(ocMirror.architecture, "x86_64");
    assert.match(ocMirror.sha256, /^[0-9a-f]{64}$/);
    assert.match(ocMirror.sourceUrl, /^https:\/\//);
    // And it still suppresses nothing.
    assert.equal(rec.disposition.effect.suppressesFindings, false);
    assert.equal(rec.disposition.effect.changesAxisVerdict, false);
  });

  test("records which image each accepted finding came from", () => {
    const rec = vendorRiskRecord({ inventory: inventory(), attributions: [{ role: "backend", attribution: vendorAttribution() }] });
    assert.equal(rec.disposition.findings[0].imageRole, "backend");
  });

  test("an unreadable inventory is NOT VERIFIED, never a fabricated acceptance", () => {
    const rec = vendorRiskRecord({
      inventory: { complete: false, reason: "tools-provenance.env unreadable in image" },
      attributions: [{ role: "backend", attribution: vendorAttribution() }],
    });

    assert.equal(rec.accepted, false);
    assert.equal(rec.state, "NOT VERIFIED");
    assert.match(rec.reason, /tools-provenance\.env unreadable/);
    assert.equal(rec.findingCount, 1, "the findings are still counted and reported");
    assert.equal(rec.disposition, undefined, "no disposition object exists to be mistaken for one");
  });

  test("a missing inventory is NOT VERIFIED too", () => {
    const rec = vendorRiskRecord({ inventory: null, attributions: [{ role: "backend", attribution: vendorAttribution() }] });
    assert.equal(rec.state, "NOT VERIFIED");
    assert.equal(rec.accepted, false);
  });

  test("no vendor findings is not-applicable, and says it is not an acceptance", () => {
    const projectOnly = attributeFindings({
      Results: [{ Target: "registry.access.redhat.com/ubi9/nodejs-22-minimal (redhat 9.8)", Class: "os-pkgs", Vulnerabilities: [vuln("CVE-P", "HIGH", "expat")] }],
    });
    const rec = vendorRiskRecord({ inventory: inventory(), attributions: [{ role: "backend", attribution: projectOnly }] });

    assert.equal(rec.accepted, false);
    assert.equal(rec.state, "not-applicable");
    assert.match(rec.reason, /must not be read as one/);
  });

  test("an uncovered binary is REJECTED with the reason, not quietly accepted", () => {
    // Inventory knows about `oc` only; the findings are in `oc-mirror`.
    const rec = vendorRiskRecord({
      inventory: inventory({ baked: [bakedRecord("oc")] }),
      attributions: [{ role: "backend", attribution: vendorAttribution() }],
    });

    assert.equal(rec.accepted, false);
    assert.equal(rec.state, "rejected");
    assert.match(rec.reason, /oc-mirror/);
    assert.deepEqual(rec.identitiesOffered, ["oc"]);
  });

  test("a malformed inventory digest is REJECTED rather than recorded", () => {
    const rec = vendorRiskRecord({
      inventory: inventory({ baked: [bakedRecord("oc-mirror", { sha256: "TBD" })] }),
      attributions: [{ role: "backend", attribution: vendorAttribution() }],
    });
    assert.equal(rec.accepted, false);
    assert.equal(rec.state, "rejected");
    // `sha256: "TBD"` is falsy-free but meaningless, so it is dropped as an
    // incomplete identity before the digest rule even sees it; either refusal
    // is correct, and neither may produce an acceptance.
    assert.match(rec.reason, /oc-mirror/);
  });

  test("never throws — a refusal is evidence, not a crashed certification run", () => {
    assert.doesNotThrow(() => vendorRiskRecord());
    assert.doesNotThrow(() => vendorRiskRecord({ inventory: inventory(), attributions: [{ role: "backend", attribution: mixedAttribution() }] }));
  });

  test("a project-owned finding never reaches the acceptance", () => {
    const rec = vendorRiskRecord({ inventory: inventory(), attributions: [{ role: "backend", attribution: mixedAttribution() }] });
    assert.equal(rec.accepted, true);
    assert.equal(rec.disposition.findingCount, 1);
    assert.equal(rec.disposition.findings[0].id, "CVE-V");
    assert.ok(!rec.disposition.findings.some((f) => f.id === "CVE-P"), "the UBI finding is not in the accepted set");
  });
});

describe("identitiesFromInventory", () => {
  test("excludes runtime-acquired tools with a stated reason", () => {
    const { identities, excluded } = identitiesFromInventory({
      baked: [{ tool: "oc", version: "1", arch: "x86_64", sha256: "a".repeat(64), url: "https://x/y" }],
      runtimeAcquired: [{ tool: "mirror-registry" }],
    });
    assert.deepEqual(identities.map((i) => i.tool), ["oc"]);
    const mr = excluded.find((e) => e.tool === "mirror-registry");
    assert.match(mr.reason, /never match an image-scan finding/);
  });

  test("an incomplete baked record is excluded, not emitted half-filled", () => {
    const { identities, excluded } = identitiesFromInventory({ baked: [{ tool: "oc", version: "1", arch: "x86_64" }] });
    assert.deepEqual(identities, []);
    assert.match(excluded.find((e) => e.tool === "oc").reason, /missing sha256, sourceUrl/);
  });

  test("tolerates an empty or absent inventory", () => {
    assert.deepEqual(identitiesFromInventory(null), { identities: [], excluded: [] });
    assert.deepEqual(identitiesFromInventory({}), { identities: [], excluded: [] });
  });
});
