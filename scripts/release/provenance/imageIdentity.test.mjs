/**
 * Deterministic tests for image identity resolution.
 *
 * FIXTURES ONLY. Nothing here starts a container, reads the local image
 * store, or touches the network: the engine is injected as a fake runner, so
 * the suite produces the same result on a host with no podman at all. The
 * inspect fixtures are trimmed copies of real `podman image inspect` output
 * from the two shipping images, which is what makes the inherited-label
 * assertions meaningful rather than hypothetical.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";

import {
  IDENTITY_FIELDS,
  parseInspect,
  describeBaseImage,
  revisionLabelProvenance,
  identityDigest,
  selectEngine,
  resolveImageIdentity,
  resolveIdentitySet,
} from "./imageIdentity.mjs";
import { REVISION_LABEL, CANDIDATE_LABEL } from "../lib/provenance.mjs";

/**
 * Trimmed from the real backend image. The label block is verbatim in the
 * fields that matter: ubi9/nodejs-22 sets BOTH `org.opencontainers.image.
 * revision` and `vcs-ref` to its own build commit, and the derived OAA image
 * inherits them.
 */
const BACKEND_INSPECT = [
  {
    Id: "7252836047c2978cee0a8f71626e8e774cc7897b048a3defb079a0dc88d789e5",
    Digest: "sha256:eeec74ed006fc9ab5e43ccbc21a4f67b19ca1157f559d41f1fb628a94bda231f",
    RepoDigests: ["localhost/openshift-airgap-architect-backend@sha256:eeec74ed006fc9ab5e43ccbc21a4f67b19ca1157f559d41f1fb628a94bda231f"],
    Created: "2026-10-12T18:43:15.270194212Z",
    Size: 1321770337,
    Architecture: "amd64",
    Os: "linux",
    Config: {
      User: "root",
      Cmd: ["/app/entrypoint.sh"],
      ExposedPorts: { "4000/tcp": {} },
      Env: ["NODE_ENV=production", "OAA_CANONICAL_DATA_DIR=/app/data"],
      Labels: {
        name: "ubi9/nodejs-22",
        version: "1",
        release: "1791442403",
        "com.redhat.component": "nodejs-22-container",
        vendor: "Red Hat, Inc.",
        architecture: "x86_64",
        "build-date": "2026-10-08T06:54:26Z",
        cpe: "cpe:/a:redhat:enterprise_linux:9::appstream",
        "vcs-type": "git",
        "vcs-ref": "e573c6075f71cca94d900cafd032ccfa0f871961",
        [REVISION_LABEL]: "e573c6075f71cca94d900cafd032ccfa0f871961",
        "org.opencontainers.image.created": "2026-10-08T06:54:26Z",
      },
    },
  },
];

const FRONTEND_INSPECT = [
  {
    Id: "6154276a8ba0c7f38e4a842db7f03d00d19ddff6214198805578af6e113441b6",
    Digest: "sha256:f69e3ea3f87e9f94212860a5c34ebea9659561e182b9bdd899a79bfec59a641c",
    RepoDigests: [],
    Created: "2026-10-12T18:42:10.589120469Z",
    Size: 347481579,
    Architecture: "amd64",
    Os: "linux",
    Config: {
      User: "1001",
      Cmd: ["/opt/app-root/bin/oaa-entrypoint.sh"],
      ExposedPorts: { "5173/tcp": {} },
      Labels: {
        name: "ubi9/nginx-124",
        version: "1",
        release: "1791288493",
        "com.redhat.component": "nginx-124-container",
        vendor: "Red Hat, Inc.",
        architecture: "x86_64",
        "build-date": "2026-10-06T12:08:47Z",
        cpe: "cpe:/a:redhat:enterprise_linux:9::appstream",
        "vcs-type": "git",
        "vcs-ref": "24d2029ef4cca0becd2733ebfbbc8e901f67f6cb",
        [REVISION_LABEL]: "24d2029ef4cca0becd2733ebfbbc8e901f67f6cb",
      },
    },
  },
];

/** A fake `run` that answers one inspect per ref. */
function fakeRunner(byRef) {
  return (_cmd, args) => {
    const ref = args[2];
    const payload = byRef[ref];
    if (payload === undefined) {
      return { status: 125, stdout: "", stderr: `Error: ${ref}: image not known\n`, spawnError: null, timedOut: false };
    }
    if (payload === "unparseable") {
      return { status: 0, stdout: "{{not json", stderr: "", spawnError: null, timedOut: false };
    }
    return { status: 0, stdout: JSON.stringify(payload), stderr: "", spawnError: null, timedOut: false };
  };
}

describe("inspect parsing", () => {
  test("normalises a real podman payload into the enumerated identity fields", () => {
    const parsed = parseInspect(BACKEND_INSPECT);
    assert.equal(parsed.ok, true);
    for (const f of IDENTITY_FIELDS) assert.ok(f in parsed.identity, `missing identity field ${f}`);
    assert.equal(parsed.identity.id, BACKEND_INSPECT[0].Id);
    assert.equal(parsed.identity.sizeBytes, 1321770337);
    assert.deepEqual(parsed.identity.exposedPorts, ["4000/tcp"]);
    assert.equal(parsed.identity.user, "root");
  });

  test("a payload with no Id is refused rather than recorded with a null primary key", () => {
    const parsed = parseInspect([{ Digest: "sha256:abc", Config: {} }]);
    assert.equal(parsed.ok, false);
    assert.match(parsed.reason, /no image Id/);
  });

  test("a non-object payload is refused", () => {
    assert.equal(parseInspect(null).ok, false);
    assert.equal(parseInspect("string").ok, false);
  });

  test("identity records only the enumerated fields, so an engine upgrade cannot move the digest", () => {
    const base = parseInspect(BACKEND_INSPECT).identity;
    const withExtra = parseInspect([{ ...BACKEND_INSPECT[0], SomeNewPodmanField: "added in a later release" }]).identity;
    assert.equal(identityDigest(base), identityDigest(withExtra));
  });

  test("a changed image id moves the identity digest", () => {
    const base = parseInspect(BACKEND_INSPECT).identity;
    const rebuilt = parseInspect([{ ...BACKEND_INSPECT[0], Id: "0".repeat(64) }]).identity;
    assert.notEqual(identityDigest(base), identityDigest(rebuilt));
  });

  test("the identity digest is key-order independent and stable across calls", () => {
    const a = parseInspect(BACKEND_INSPECT).identity;
    assert.equal(identityDigest(a), identityDigest({ ...a }));
  });
});

describe("the inherited base-image revision label", () => {
  test("the backend image's revision label is classified as the BASE image's, not this build's", () => {
    const { labels } = parseInspect(BACKEND_INSPECT);
    const verdict = revisionLabelProvenance(labels);
    assert.equal(verdict.classification, "inherited-base");
    assert.equal(verdict.revision, "e573c6075f71cca94d900cafd032ccfa0f871961");
    assert.equal(verdict.baseImage, "ubi9/nodejs-22");
    assert.match(verdict.consequence, /proof B is unreachable/);
  });

  test("the frontend image is classified the same way, from a different base", () => {
    const { labels } = parseInspect(FRONTEND_INSPECT);
    assert.equal(revisionLabelProvenance(labels).classification, "inherited-base");
    assert.equal(revisionLabelProvenance(labels).baseImage, "ubi9/nginx-124");
  });

  test("a revision label with no base-image signals and no vcs-ref is build-supplied", () => {
    const verdict = revisionLabelProvenance({ [REVISION_LABEL]: "a".repeat(40) });
    assert.equal(verdict.classification, "build-supplied");
  });

  test("a build-supplied revision beside an OAA candidate label is NOT reclassified as inherited", () => {
    const verdict = revisionLabelProvenance({
      ...parseInspect(BACKEND_INSPECT).labels,
      "vcs-ref": "e573c6075f71cca94d900cafd032ccfa0f871961",
      [REVISION_LABEL]: "b".repeat(40),
      [CANDIDATE_LABEL]: "deadbeefcafe",
    });
    assert.equal(verdict.classification, "build-supplied");
  });

  test("a revision differing from vcs-ref but surrounded by base labels and no candidate label stays suspect", () => {
    const labels = { ...parseInspect(BACKEND_INSPECT).labels, [REVISION_LABEL]: "b".repeat(40) };
    assert.equal(revisionLabelProvenance(labels).classification, "inherited-base");
  });

  test("no revision label at all is reported as absent, not as a pass", () => {
    assert.equal(revisionLabelProvenance({}).classification, "absent");
    assert.equal(revisionLabelProvenance({}).revision, null);
  });
});

describe("base image description", () => {
  test("infers the base NVR from inherited labels and marks the method as inference", () => {
    const base = describeBaseImage(parseInspect(BACKEND_INSPECT).labels);
    assert.equal(base.identified, true);
    assert.equal(base.method, "inherited-label-inference");
    assert.equal(base.nvr, "ubi9/nodejs-22:1-1791442403");
    assert.match(base.caution, /NOT a verified parent digest/);
  });

  test("an image with no base labels reports that the base cannot be inferred", () => {
    const base = describeBaseImage({});
    assert.equal(base.identified, false);
    assert.match(base.reason, /cannot be inferred/);
  });
});

describe("resolution fails closed", () => {
  test("no engine yields ok:false, never a partial identity", () => {
    const res = resolveImageIdentity("whatever:latest", { engine: null });
    assert.equal(res.ok, false);
    assert.match(res.reason, /no container engine/);
    assert.equal(res.identity, undefined);
  });

  test("an absent image yields ok:false carrying the engine's own message", () => {
    const res = resolveImageIdentity("nope:latest", { engine: "podman", runner: fakeRunner({}) });
    assert.equal(res.ok, false);
    assert.match(res.reason, /image not known/);
  });

  test("unparseable inspect output yields ok:false", () => {
    const res = resolveImageIdentity("x:latest", { engine: "podman", runner: fakeRunner({ "x:latest": "unparseable" }) });
    assert.equal(res.ok, false);
    assert.match(res.reason, /unparseable/);
  });

  test("a spawn failure is distinguished from a non-zero exit", () => {
    const runner = () => ({ status: null, stdout: "", stderr: "", spawnError: "spawn podman ENOENT", timedOut: false });
    const res = resolveImageIdentity("x:latest", { engine: "podman", runner });
    assert.equal(res.ok, false);
    assert.match(res.reason, /could not execute podman/);
  });

  test("a timeout is reported as a timeout, not as an absent image", () => {
    const runner = () => ({ status: null, stdout: "", stderr: "", spawnError: null, timedOut: true });
    const res = resolveImageIdentity("x:latest", { engine: "podman", runner, timeoutMs: 5 });
    assert.equal(res.ok, false);
    assert.match(res.reason, /timed out/);
  });

  test("a resolved image reports identity, digest, base image and label classification together", () => {
    const res = resolveImageIdentity("be:latest", { engine: "podman", runner: fakeRunner({ "be:latest": BACKEND_INSPECT }) });
    assert.equal(res.ok, true);
    assert.equal(res.identity.id, BACKEND_INSPECT[0].Id);
    assert.equal(res.identityDigest.length, 64);
    assert.equal(res.baseImage.name, "ubi9/nodejs-22");
    assert.equal(res.revisionLabel.classification, "inherited-base");
    assert.equal(res.candidateLabel, null);
  });
});

describe("the complete set is required", () => {
  const runner = fakeRunner({ "be:latest": BACKEND_INSPECT, "fe:latest": FRONTEND_INSPECT });

  test("both roles resolving gives ok:true", () => {
    const set = resolveIdentitySet({ backend: "be:latest", frontend: "fe:latest" }, { engine: "podman", runner });
    assert.equal(set.ok, true);
    assert.equal(set.images.length, 2);
  });

  test("ONE role missing makes the whole set not ok — half a release is never an identity record", () => {
    const set = resolveIdentitySet({ backend: "be:latest", frontend: "missing:latest" }, { engine: "podman", runner });
    assert.equal(set.ok, false);
    assert.match(set.reason, /frontend/);
    // The resolved one is still reported, so the operator sees what IS known.
    assert.equal(set.images.find((i) => i.role === "backend").ok, true);
  });

  test("an empty request is refused rather than vacuously ok", () => {
    const set = resolveIdentitySet({}, { engine: "podman", runner });
    assert.equal(set.ok, false);
    assert.match(set.reason, /no image roles/);
  });
});

describe("engine selection", () => {
  test("prefers podman, falls back to docker, and reports null when neither exists", () => {
    assert.equal(selectEngine({ podman: true, docker: true }), "podman");
    assert.equal(selectEngine({ podman: false, docker: true }), "docker");
    assert.equal(selectEngine({ podman: false, docker: false }), null);
  });
});
