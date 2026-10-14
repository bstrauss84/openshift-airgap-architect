/**
 * Tests for the candidate-binding contract and the digest taxonomy.
 *
 * The two tests the task names explicitly — a FALSE inherited-label identity
 * and a GENUINE candidate-bound identity — are the first two cases in
 * "the inherited-label trap". Fixtures are transcribed from real
 * `podman image inspect` output taken on 2026-10-14; no engine is used.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { REVISION_LABEL, CANDIDATE_LABEL, verifyImageProvenance } from "../lib/provenance.mjs";
import { revisionLabelProvenance } from "./imageIdentity.mjs";
import {
  BUILD_SUPPLIED_REVISION_LABEL,
  DIGEST_KINDS,
  bindImageToCandidate,
  classifyDigests,
  isLocalOnlyRepository,
} from "./candidateBinding.mjs";

/** Real inherited label block from localhost/openshift-airgap-architect-backend:latest. */
const UBI_INHERITED_LABELS = Object.freeze({
  architecture: "x86_64",
  "build-date": "2026-10-08T06:54:26Z",
  "com.redhat.component": "nodejs-22-container",
  cpe: "cpe:/a:redhat:enterprise_linux:9::appstream",
  name: "ubi9/nodejs-22",
  release: "1791442403",
  url: "https://catalog.redhat.com/en/search?searchType=containers",
  vendor: "Red Hat, Inc.",
  version: "1",
  "vcs-type": "git",
  "vcs-ref": "e573c6075f71cca94d900cafd032ccfa0f871961",
  [REVISION_LABEL]: "e573c6075f71cca94d900cafd032ccfa0f871961",
});

const BACKEND_ID = "7252836047c2978cee0a8f71626e8e774cc7897b048a3defb079a0dc88d789e5";
const OAA_HEAD = "7b8c745bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

const cleanCandidate = { candidateId: `clean-${OAA_HEAD}`, git: { head: OAA_HEAD, clean: true } };
const dirtyCandidate = { candidateId: "dirty-abc123def456", git: { head: OAA_HEAD, clean: false } };

function image(labels, extra = {}) {
  return { role: "backend", ref: "localhost/openshift-airgap-architect-backend:latest", present: true, id: BACKEND_ID, labels, ...extra };
}

describe("the inherited-label trap", () => {
  test("FALSE IDENTITY: the real backend image's inherited UBI revision must NOT bind it", () => {
    const r = bindImageToCandidate(image(UBI_INHERITED_LABELS), cleanCandidate);
    assert.equal(r.bound, false, "an inherited Red Hat build commit is not OAA provenance");
    assert.equal(r.observed.revisionClassification, "inherited-base");
    // And the operator must be told it was INHERITED, not sent hunting for an
    // OAA revision that does not exist.
    assert.match(r.reason, /INHERITED/);
    assert.match(r.reason, /ubi9\/nodejs-22/);
  });

  test("REGRESSION, the ordering defect: a correct build manifest binds the image", () => {
    const manifestResult = {
      present: true,
      manifest: { candidateId: cleanCandidate.candidateId, images: [{ role: "backend", id: BACKEND_ID }] },
    };

    // The shipped validator used to return from the revision-label branch and
    // never reach the manifest, reporting a Red Hat build commit that does not
    // exist in this repository. It now discards an inherited label and falls
    // through, so BOTH implementations reach proof B and agree. This test was
    // written while the defect was still present and asserted that
    // `verifyImageProvenance` failed here; it is inverted now that
    // lib/provenance.mjs is fixed, which is the point of keeping it.
    const shipped = verifyImageProvenance(image(UBI_INHERITED_LABELS), cleanCandidate, manifestResult);
    assert.equal(shipped.bound, true, "an inherited label must no longer short-circuit proof B");
    assert.equal(shipped.observed.revisionLabelInherited, true, "and it must say why it was disregarded");

    const reference = bindImageToCandidate(image(UBI_INHERITED_LABELS), cleanCandidate, manifestResult);
    assert.equal(reference.bound, true);
    assert.equal(reference.method, "build-manifest");
  });

  test("GENUINE IDENTITY: a build-supplied candidate label binds the image", () => {
    const labels = { ...UBI_INHERITED_LABELS, [CANDIDATE_LABEL]: cleanCandidate.candidateId };
    const r = bindImageToCandidate(image(labels), cleanCandidate);
    assert.equal(r.bound, true);
    assert.equal(r.method, "oci-label:candidate-id");
  });

  test("GENUINE IDENTITY: a build-supplied revision on a clean candidate binds it", () => {
    const labels = { ...UBI_INHERITED_LABELS, [REVISION_LABEL]: OAA_HEAD, [BUILD_SUPPLIED_REVISION_LABEL]: "true" };
    const r = bindImageToCandidate(image(labels), cleanCandidate);
    assert.equal(r.bound, true);
    assert.equal(r.method, "oci-label:revision");
    assert.equal(r.observed.revisionDeclaredBuildSupplied, true);
  });

  test("a build-supplied revision from a DIFFERENT commit does not bind", () => {
    const labels = { ...UBI_INHERITED_LABELS, [REVISION_LABEL]: "c".repeat(40), [BUILD_SUPPLIED_REVISION_LABEL]: "true" };
    const r = bindImageToCandidate(image(labels), cleanCandidate);
    assert.equal(r.bound, false);
    assert.match(r.reason, /different revision/);
  });

  test("a revision label can never bind a DIRTY candidate", () => {
    const labels = { ...UBI_INHERITED_LABELS, [REVISION_LABEL]: OAA_HEAD, [BUILD_SUPPLIED_REVISION_LABEL]: "true" };
    const r = bindImageToCandidate(image(labels), dirtyCandidate);
    assert.equal(r.bound, false);
    assert.match(r.reason, /candidate is dirty/);
  });

  test("a candidate label for a DIFFERENT candidate does not bind, and does not fall through", () => {
    const labels = { ...UBI_INHERITED_LABELS, [CANDIDATE_LABEL]: "some-other-candidate" };
    const manifestResult = { present: true, manifest: { candidateId: cleanCandidate.candidateId, images: [{ role: "backend", id: BACKEND_ID }] } };
    const r = bindImageToCandidate(image(labels), cleanCandidate, manifestResult);
    assert.equal(r.bound, false);
    assert.match(r.reason, /DIFFERENT candidate/);
  });

  test("a manifest listing a different image id for the role does not bind", () => {
    const manifestResult = { present: true, manifest: { candidateId: cleanCandidate.candidateId, images: [{ role: "backend", id: "sha256:stale" }] } };
    const r = bindImageToCandidate(image(UBI_INHERITED_LABELS), cleanCandidate, manifestResult);
    assert.equal(r.bound, false);
    assert.match(r.reason, /different image id/);
  });

  test("an absent image never binds", () => {
    const r = bindImageToCandidate({ role: "backend", present: false }, cleanCandidate);
    assert.equal(r.bound, false);
    assert.match(r.reason, /not present/);
  });

  test("no labels and no manifest yields the plain no-provenance reason", () => {
    const r = bindImageToCandidate(image({}), cleanCandidate);
    assert.equal(r.bound, false);
    assert.match(r.reason, /no provenance/);
  });
});

describe("revision classification strengthening", () => {
  test("the shipped heuristic alone misclassifies a genuine clean-build revision", () => {
    // Base labels are always present on a UBI-derived image, so the
    // >=4-base-signals rule fires even when the revision really is ours.
    const labels = { ...UBI_INHERITED_LABELS, [REVISION_LABEL]: OAA_HEAD };
    assert.equal(revisionLabelProvenance(labels).classification, "inherited-base");
  });

  test("positive candidate-revision context corrects it to build-supplied", () => {
    const labels = { ...UBI_INHERITED_LABELS, [REVISION_LABEL]: OAA_HEAD };
    const v = revisionLabelProvenance(labels, { candidateRevisions: [OAA_HEAD] });
    assert.equal(v.classification, "build-supplied");
    assert.equal(v.basis, "positive-candidate-match");
  });

  test("the context never rescues a revision that equals the base vcs-ref", () => {
    const v = revisionLabelProvenance(UBI_INHERITED_LABELS, {
      candidateRevisions: ["e573c6075f71cca94d900cafd032ccfa0f871961"],
    });
    assert.equal(v.classification, "inherited-base", "equality with vcs-ref always wins: fail closed");
  });

  test("an inherited revision beside a candidate label says the image is still bindable", () => {
    const v = revisionLabelProvenance({ ...UBI_INHERITED_LABELS, [CANDIDATE_LABEL]: "cand-1" });
    assert.equal(v.classification, "inherited-base");
    assert.equal(v.supersededByCandidateLabel, true);
    assert.match(v.consequence, /binds it independently/);
  });

  test("backward compatible: omitting context preserves the previous behaviour exactly", () => {
    assert.equal(revisionLabelProvenance(UBI_INHERITED_LABELS).classification, "inherited-base");
    assert.equal(revisionLabelProvenance({}).classification, "absent");
    assert.equal(revisionLabelProvenance({ [REVISION_LABEL]: "a".repeat(40) }).classification, "build-supplied");
  });
});

describe("digest taxonomy", () => {
  test("config, manifest and registry digests are three different things", () => {
    const d = classifyDigests({
      id: "7252836047c2978cee0a8f71626e8e774cc7897b048a3defb079a0dc88d789e5",
      digest: "sha256:eeec74ed006fc9ab5e43ccbc21a4f67b19ca1157f559d41f1fb628a94bda231f",
      repoDigests: ["localhost/openshift-airgap-architect-backend@sha256:eeec74ed006fc9ab5e43ccbc21a4f67b19ca1157f559d41f1fb628a94bda231f"],
    });
    assert.equal(d.config, "sha256:7252836047c2978cee0a8f71626e8e774cc7897b048a3defb079a0dc88d789e5");
    assert.equal(d.manifest, "sha256:eeec74ed006fc9ab5e43ccbc21a4f67b19ca1157f559d41f1fb628a94bda231f");
    assert.notEqual(d.config, d.manifest);
  });

  test("a never-pushed local image has NO registry digest, whatever RepoDigests says", () => {
    const d = classifyDigests({
      id: "7252836047c2",
      digest: "sha256:eeec74ed",
      repoDigests: ["localhost/openshift-airgap-architect-backend@sha256:eeec74ed"],
    });
    assert.deepEqual(d.registry, [], "podman synthesises this; it is not a registry digest");
    assert.equal(d.published, false);
    assert.equal(d.localOnlyRepoDigests.length, 1);
    assert.match(d.note, /never been pushed/);
  });

  test("a pulled image can carry SEVERAL registry digests", () => {
    const d = classifyDigests({
      id: "6d93f1ec925b",
      digest: "sha256:af6acf9a",
      repoDigests: ["docker.io/aquasec/trivy@sha256:9db09910", "docker.io/aquasec/trivy@sha256:af6acf9a"],
    });
    assert.equal(d.registry.length, 2);
    assert.equal(d.published, true);
    assert.equal(d.note, null);
  });

  test("local-only repository detection", () => {
    assert.equal(isLocalOnlyRepository("localhost/foo@sha256:a"), true);
    assert.equal(isLocalOnlyRepository("myimage@sha256:a"), true);
    assert.equal(isLocalOnlyRepository("docker.io/aquasec/trivy@sha256:a"), false);
    assert.equal(isLocalOnlyRepository("registry.access.redhat.com/ubi9/ubi@sha256:a"), false);
  });

  test("the export digest is documented as distinct from the manifest digest", () => {
    // Verified in practice: re-exporting aquasec/trivy yields OCI manifest
    // digest sha256:6b0c412d…, while podman .Digest is sha256:af6acf9a….
    assert.match(DIGEST_KINDS.export.isNot, /DIFFERENT from \.Digest/);
    assert.equal(DIGEST_KINDS.registry.existsForLocalBuild, false);
    assert.equal(DIGEST_KINDS.config.existsForLocalBuild, true);
  });
});
