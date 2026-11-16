/**
 * Tests for PROOF B: the release build manifest and the build that emits it.
 *
 * Every test runs with NO container engine and NO network. The engine is a
 * recorded fake, so the assertions are about what the emitter DOES — which
 * argv it builds, which image id it trusts, what it refuses — rather than
 * about strings in a document.
 *
 * The behaviour that actually matters is the last group: a manifest this
 * module emits must be ACCEPTED by `verifyShippingSet()`, the consumer, and
 * must stop being accepted the instant the candidate or the image moves.
 * Asserting the document's shape would not prove that.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test, describe } from "node:test";

import {
  MANIFEST_SCHEMA_VERSION,
  bareImageId,
  buildManifestDocument,
  buildOneImage,
  declaredBuildArgs,
  declaredLabels,
  defaultBuildSpecs,
  emitBuildManifest,
  inspectBuiltImage,
  manifestPath,
  validateBuildManifest,
  writeBuildManifest,
} from "./lib/buildManifest.mjs";
import { verifyShippingSet, verifyImageProvenance } from "./lib/provenance.mjs";
import { REQUIRED_ROLES } from "./lib/images.mjs";

const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..");

const ID_BACKEND = "a".repeat(64);
const ID_FRONTEND = "b".repeat(64);
const HEAD = "2e4c7aa8bdd7a00a370c0c5a95710eb30d0e422d";
const CANDIDATE_ID = "c".repeat(64);

function candidateFixture({ clean = false, candidateId = CANDIDATE_ID } = {}) {
  return {
    candidateId,
    exact: clean ? `${HEAD} (clean)` : `${HEAD}+dirty:${candidateId.slice(0, 12)}`,
    git: { head: HEAD, branch: "work/x", clean, modifiedPaths: clean ? [] : ["a"], untrackedPaths: [] },
    timestamp: "2026-10-14T00:00:00.000Z",
  };
}

/**
 * A fake engine. `build` writes the id it was told to produce into whatever
 * `--iidfile` path the emitter chose, exactly as podman does, so the emitter's
 * real file handling is exercised.
 */
function fakeEngine({ ids = { backend: ID_BACKEND, frontend: ID_FRONTEND }, buildExit = {}, inspectId = null, inspectExit = {} } = {}) {
  const calls = [];
  const runner = (cmd, argv) => {
    calls.push({ cmd, argv });
    if (argv[0] === "build") {
      const role = argv.includes("backend/Containerfile") || argv.some((a) => a.endsWith("backend/Containerfile")) ? "backend" : "frontend";
      const exit = buildExit[role] ?? 0;
      if (exit === 0) {
        const iidFile = argv[argv.indexOf("--iidfile") + 1];
        fs.writeFileSync(iidFile, `sha256:${ids[role]}\n`);
      }
      return { status: exit, stdout: "", stderr: exit === 0 ? "" : "simulated build failure", spawnError: null, timedOut: false };
    }
    if (argv[0] === "image" && argv[1] === "inspect") {
      const requested = argv[2];
      const exit = inspectExit[requested] ?? 0;
      if (exit !== 0) return { status: exit, stdout: "", stderr: "no such image", spawnError: null, timedOut: false };
      return {
        status: 0,
        stdout: JSON.stringify([
          {
            Id: inspectId ?? requested,
            Digest: "sha256:manifestdigestmanifestdigestmanifestdigestmanifestdigestmanifest",
            RepoDigests: [`localhost/openshift-airgap-architect-backend@sha256:${"d".repeat(64)}`],
            Created: "2026-10-14T00:00:00Z",
            Size: 1234,
            Os: "linux",
            Architecture: "amd64",
            Config: { Labels: {} },
          },
        ]),
        stderr: "",
        spawnError: null,
        timedOut: false,
      };
    }
    return { status: 0, stdout: "podman version 5.8.7", stderr: "", spawnError: null, timedOut: false };
  };
  return { runner, calls };
}

describe("Containerfile parsing drives what the build can claim", () => {
  test("ARG declarations are collected across every stage", () => {
    const args = declaredBuildArgs(`
FROM a AS one
ARG APP_GIT_SHA=unknown
FROM b
  ARG OCP_CLIENT_URL=""
ARG OC_CHANNEL=latest-4.22
# ARG COMMENTED_OUT
`);
    assert.deepEqual([...args].sort(), ["APP_GIT_SHA", "OCP_CLIENT_URL", "OC_CHANNEL"]);
    assert.equal(args.has("COMMENTED_OUT"), false, "a commented ARG is not declared");
  });

  test("THE REAL CONTAINERFILES AND PROOF A ARE CONSISTENT, whether or not the patch has landed", () => {
    // Written to hold in BOTH worlds rather than to fail the day someone
    // lands the label patch. Today both branches take the `else`: the
    // emitter records `argsNotDeclared` and the build manifest is the only
    // binding. Once a Containerfile declares the candidate ARG, the same test
    // demands the matching LABEL, so a half-applied patch — an ARG that is
    // accepted and then never stamped — cannot pass unnoticed.
    for (const rel of ["backend/Containerfile", "frontend/Containerfile"]) {
      const text = fs.readFileSync(path.join(REPO_ROOT, rel), "utf8");
      const args = declaredBuildArgs(text);
      const labels = declaredLabels(text);
      if (args.has("OAA_CANDIDATE_ID")) {
        assert.ok(labels.has("io.oaa.candidate-id"), `${rel} accepts OAA_CANDIDATE_ID but never stamps it as a label`);
        assert.ok(labels.has("org.opencontainers.image.revision"), `${rel} must stamp the revision label alongside the candidate id`);
      } else {
        assert.deepEqual([...labels], [], `${rel} sets no LABEL, so proof A is unavailable and the manifest is the only binding`);
      }
    }
  });

  test("the backend already declares APP_GIT_SHA, so that one arg IS applied", () => {
    assert.equal(declaredBuildArgs(fs.readFileSync(path.join(REPO_ROOT, "backend", "Containerfile"), "utf8")).has("APP_GIT_SHA"), true);
  });

  test("a multi-line LABEL patch is parsed in full, not just its first key", () => {
    const labels = declaredLabels(`
FROM a
LABEL org.opencontainers.image.revision="$APP_GIT_SHA" \\
      io.oaa.candidate-id="$OAA_CANDIDATE_ID" \\
      io.oaa.build-supplied-revision="true"
`);
    assert.deepEqual([...labels].sort(), ["io.oaa.build-supplied-revision", "io.oaa.candidate-id", "org.opencontainers.image.revision"]);
  });

  test("image ids normalise across podman (bare hex) and docker (sha256: prefixed)", () => {
    assert.equal(bareImageId(`sha256:${ID_BACKEND}`), ID_BACKEND);
    assert.equal(bareImageId(` ${ID_BACKEND}\n`), ID_BACKEND);
    assert.equal(bareImageId("not-a-digest"), null);
    assert.equal(bareImageId(null), null);
  });
});

describe("a build is the only thing allowed to produce an entry", () => {
  test("the image id comes from --iidfile, and the inspect that follows is addressed BY THAT ID", () => {
    const { runner, calls } = fakeEngine();
    const built = buildOneImage(
      { role: "backend", ref: "localhost/x:latest", containerfile: "backend/Containerfile", context: "." },
      { engine: "podman", repoRoot: REPO_ROOT, buildArgs: { APP_GIT_SHA: HEAD, OAA_CANDIDATE_ID: CANDIDATE_ID }, runner },
    );

    assert.equal(built.ok, true, built.reason);
    assert.equal(built.builtImageId, ID_BACKEND);

    const argv = calls[0].argv;
    assert.ok(argv.includes("--iidfile"), "the engine must report the id it produced");
    // The tag is only an input to the build; nothing downstream resolves it.
    const inspect = inspectBuiltImage("podman", built.builtImageId, { runner });
    assert.equal(inspect.ok, true, inspect.reason);
    assert.equal(calls[1].argv[2], ID_BACKEND, "inspect is addressed by the built id, never by the tag");
  });

  test("only build args the Containerfile DECLARES are passed; the rest are recorded as skipped", () => {
    // Uses a name no Containerfile will ever declare for the negative half.
    // This previously used OAA_CANDIDATE_ID, which WAS undeclared at the
    // time — so the day the provenance labels landed and the arg became
    // real, the test failed for a reason that had nothing to do with the
    // behaviour it guards. The invariant is "undeclared args are skipped",
    // not "this particular arg is undeclared".
    const { runner, calls } = fakeEngine();
    const built = buildOneImage(
      { role: "backend", ref: "localhost/x:latest", containerfile: "backend/Containerfile", context: "." },
      {
        engine: "podman",
        repoRoot: REPO_ROOT,
        buildArgs: { APP_GIT_SHA: HEAD, OAA_NOT_A_REAL_ARG: "x" },
        runner,
      },
    );
    const argv = calls[0].argv.join(" ");
    assert.match(argv, /--build-arg APP_GIT_SHA=/);
    assert.ok(!argv.includes("OAA_NOT_A_REAL_ARG"), "an undeclared arg is not passed and must not be implied");
    assert.deepEqual(built.argsNotDeclared, ["OAA_NOT_A_REAL_ARG"]);
    assert.ok(built.containerfileSha256.startsWith("sha256:"));
  });

  test("the real Containerfiles declare the provenance args, so proof A is reachable", () => {
    // The other half of the pair, and the reason the case above had to be
    // rewritten rather than deleted: an image cannot carry a candidate id the
    // Containerfile never accepts, so a silently-undeclared ARG would leave
    // every container axis INCOMPLETE with no visible cause.
    for (const [role, containerfile] of [["backend", "backend/Containerfile"], ["frontend", "frontend/Containerfile"]]) {
      const { runner, calls } = fakeEngine();
      buildOneImage(
        { role, ref: `localhost/${role}:latest`, containerfile, context: "." },
        {
          engine: "podman",
          repoRoot: REPO_ROOT,
          buildArgs: { APP_GIT_SHA: HEAD, OAA_CANDIDATE_ID: CANDIDATE_ID, OAA_BUILD_SUPPLIED_REVISION: "true" },
          runner,
        },
      );
      const argv = calls[0].argv.join(" ");
      assert.match(argv, /--build-arg APP_GIT_SHA=/, `${containerfile} must accept APP_GIT_SHA`);
      assert.match(argv, /--build-arg OAA_CANDIDATE_ID=/, `${containerfile} must accept OAA_CANDIDATE_ID`);
      assert.match(argv, /--build-arg OAA_BUILD_SUPPLIED_REVISION=/, `${containerfile} must accept OAA_BUILD_SUPPLIED_REVISION`);
    }
  });

  test("a non-zero build produces no image id and no entry", () => {
    const { runner } = fakeEngine({ buildExit: { backend: 1 } });
    const built = buildOneImage(
      { role: "backend", ref: "localhost/x:latest", containerfile: "backend/Containerfile" },
      { engine: "podman", repoRoot: REPO_ROOT, runner },
    );
    assert.equal(built.ok, false);
    assert.match(built.reason, /exited 1/);
    assert.equal(built.builtImageId, undefined);
  });

  test("a zero exit that wrote no image id is NOT a successful build", () => {
    const runner = (cmd, argv) => (argv[0] === "build" ? { status: 0, stdout: "", stderr: "", spawnError: null, timedOut: false } : { status: 1, stdout: "", stderr: "", spawnError: null, timedOut: false });
    const built = buildOneImage(
      { role: "backend", ref: "localhost/x:latest", containerfile: "backend/Containerfile" },
      { engine: "podman", repoRoot: REPO_ROOT, runner },
    );
    assert.equal(built.ok, false);
    assert.match(built.reason, /wrote no usable image id/);
  });

  test("an inspect that resolves a DIFFERENT image than the build produced is refused", () => {
    const { runner } = fakeEngine({ inspectId: ID_FRONTEND });
    const inspect = inspectBuiltImage("podman", ID_BACKEND, { runner });
    assert.equal(inspect.ok, false);
    assert.match(inspect.reason, /DIFFERENT image/);
  });

  test("a missing Containerfile is a refusal, not an empty build", () => {
    const { runner } = fakeEngine();
    const built = buildOneImage({ role: "x", ref: "r", containerfile: "no/such/Containerfile" }, { engine: "podman", repoRoot: REPO_ROOT, runner });
    assert.equal(built.ok, false);
    assert.match(built.reason, /not readable/);
  });

  test("no engine is a refusal", () => {
    assert.equal(buildOneImage({ role: "x", ref: "r", containerfile: "backend/Containerfile" }, { engine: null, repoRoot: REPO_ROOT }).ok, false);
    assert.equal(emitBuildManifest({ repoRoot: REPO_ROOT, candidate: candidateFixture(), engine: null }).ok, false);
  });
});

describe("the manifest covers the whole shipping set or it does not exist", () => {
  test("one failed build refuses the WHOLE manifest", () => {
    const { runner } = fakeEngine({ buildExit: { frontend: 2 } });
    const out = emitBuildManifest({ repoRoot: REPO_ROOT, candidate: candidateFixture(), engine: "podman", runner });
    assert.equal(out.ok, false);
    assert.equal(out.manifest, null, "a partial manifest would let the container axes bind half a release");
    assert.match(out.reason, /refusing to emit a partial manifest/);
    assert.match(out.reason, /frontend/);
  });

  test("a spec set missing a required role is refused BEFORE anything is built", () => {
    const { runner, calls } = fakeEngine();
    const out = emitBuildManifest({
      repoRoot: REPO_ROOT,
      candidate: candidateFixture(),
      specs: defaultBuildSpecs().filter((s) => s.role === "backend"),
      engine: "podman",
      runner,
    });
    assert.equal(out.ok, false);
    assert.match(out.reason, /no build spec for required role\(s\): frontend/);
    assert.equal(calls.length, 0, "nothing is built when the set is known to be incomplete");
  });

  test("a candidate with no id binds nothing and is refused", () => {
    const { runner } = fakeEngine();
    const out = emitBuildManifest({ repoRoot: REPO_ROOT, candidate: {}, engine: "podman", runner });
    assert.equal(out.ok, false);
    assert.match(out.reason, /no candidate/);
  });

  test("a complete build yields one entry per role with the config digest and platform", () => {
    const { runner } = fakeEngine();
    const out = emitBuildManifest({ repoRoot: REPO_ROOT, candidate: candidateFixture(), engine: "podman", runner, now: new Date("2026-10-14T12:00:00Z") });
    assert.equal(out.ok, true, out.reason);
    assert.deepEqual(out.manifest.images.map((i) => i.role), ["backend", "frontend"]);

    const be = out.manifest.images.find((i) => i.role === "backend");
    assert.equal(be.id, ID_BACKEND, "recorded verbatim, so string equality with inspect holds");
    assert.equal(be.configDigest, `sha256:${ID_BACKEND}`);
    assert.equal(be.platform.architecture, "amd64");
    assert.equal(be.platform.os, "linux");
    assert.match(be.build.command, /podman build/);
    assert.ok(be.inputs.containerfileSha256);
    assert.equal(out.manifest.candidateId, CANDIDATE_ID);
    assert.equal(out.manifest.schemaVersion, MANIFEST_SCHEMA_VERSION);

    // PROOF A HAS LANDED. This block previously asserted the opposite — that
    // only APP_GIT_SHA was declared and the other two were skipped on every
    // role — as the machine-readable form of "the manifest is the only
    // binding". Both Containerfiles now declare all three, so the manifest
    // and the OCI labels agree, and an image can carry its own candidate id.
    //
    // Asserted for BOTH roles on purpose: certifying one of two shipping
    // images would certify half a release, and a half-applied patch (args
    // accepted but never stamped, or stamped on the backend only) is exactly
    // the failure this pins down.
    const fe = out.manifest.images.find((i) => i.role === "frontend");
    for (const [role, entry] of [["backend", be], ["frontend", fe]]) {
      assert.deepEqual(
        entry.inputs.buildArgs,
        { APP_GIT_SHA: HEAD, OAA_CANDIDATE_ID: CANDIDATE_ID, OAA_BUILD_SUPPLIED_REVISION: "true" },
        `${role}/Containerfile must declare and receive all three proof-A args`,
      );
      assert.deepEqual(entry.inputs.argsNotDeclared, [], `${role} should skip no proof-A arg`);
    }
  });
});

describe("structural validation refuses what a consumer could not use", () => {
  const good = () => {
    const { runner } = fakeEngine();
    return emitBuildManifest({ repoRoot: REPO_ROOT, candidate: candidateFixture(), engine: "podman", runner }).manifest;
  };

  test("a well-formed manifest validates", () => {
    assert.equal(validateBuildManifest(good()).ok, true);
  });

  for (const [name, mutate, expected] of [
    ["an unknown schema version", (m) => { m.schemaVersion = 99; }, /schemaVersion/],
    ["a non-digest candidate id", (m) => { m.candidateId = "nope"; }, /candidateId/],
    ["a missing required role", (m) => { m.images = m.images.filter((i) => i.role === "backend"); }, /does not cover required role/],
    ["a duplicated role", (m) => { m.images = [m.images[0], { ...m.images[0] }]; }, /appears more than once/],
    ["an unusable image id", (m) => { m.images[0].id = "short"; }, /no usable image id/],
    ["a missing architecture", (m) => { m.images[0].platform.architecture = null; }, /records no architecture/],
    ["a missing build command", (m) => { m.images[0].build.command = null; }, /records no build command/],
  ]) {
    test(`${name} is rejected`, () => {
      const m = good();
      mutate(m);
      const v = validateBuildManifest(m);
      assert.equal(v.ok, false);
      assert.ok(v.problems.some((p) => expected.test(p)), `expected ${expected} in ${JSON.stringify(v.problems)}`);
    });
  }

  test("an invalid manifest is never written", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "oaa-manifest-test-"));
    const file = path.join(dir, "m.json");
    const res = writeBuildManifest(REPO_ROOT, { schemaVersion: 1 }, { env: { OAA_CERT_BUILD_MANIFEST: file } });
    assert.equal(res.ok, false);
    assert.equal(fs.existsSync(file), false, "a refused manifest must not leave a file behind");
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe("the manifest may not live anywhere that changes the candidate", () => {
  test("the default location is the gitignored evidence directory", () => {
    assert.equal(manifestPath(REPO_ROOT, {}), path.join(REPO_ROOT, "release-certification", "release-build-manifest.json"));
  });

  test("A GIT-VISIBLE LOCATION IS REFUSED, not used", () => {
    // Untracked-but-not-ignored files feed the candidate id, so a manifest at
    // the repository root would change the candidate it claims to bind and
    // could never verify. Writing one would manufacture a permanent,
    // unexplainable INCOMPLETE.
    const { runner } = fakeEngine();
    const manifest = emitBuildManifest({ repoRoot: REPO_ROOT, candidate: candidateFixture(), engine: "podman", runner }).manifest;
    const target = path.join(REPO_ROOT, "release-build-manifest.json");
    const res = writeBuildManifest(REPO_ROOT, manifest, { env: { OAA_CERT_BUILD_MANIFEST: target } });
    assert.equal(res.ok, false);
    assert.match(res.reason, /participates in candidate identity/);
    assert.equal(fs.existsSync(target), false);
  });

  test("a location outside the repository is accepted and round-trips", () => {
    const { runner } = fakeEngine();
    const manifest = emitBuildManifest({ repoRoot: REPO_ROOT, candidate: candidateFixture(), engine: "podman", runner }).manifest;
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "oaa-manifest-test-"));
    const file = path.join(dir, "release-build-manifest.json");
    const res = writeBuildManifest(REPO_ROOT, manifest, { env: { OAA_CERT_BUILD_MANIFEST: file } });
    assert.equal(res.ok, true, res.reason);
    assert.deepEqual(JSON.parse(fs.readFileSync(file, "utf8")), manifest);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe("THE CONSUMER ACCEPTS IT — the only claim that matters", () => {
  const images = [
    { role: "backend", ref: "localhost/be:latest", present: true, id: ID_BACKEND, labels: {} },
    { role: "frontend", ref: "localhost/fe:latest", present: true, id: ID_FRONTEND, labels: {} },
  ];
  const emitted = () => {
    const { runner } = fakeEngine();
    return emitBuildManifest({ repoRoot: REPO_ROOT, candidate: candidateFixture(), engine: "podman", runner }).manifest;
  };

  test("verifyShippingSet BINDS every role against a dirty candidate, which labels alone cannot do", () => {
    const candidate = candidateFixture({ clean: false });
    const set = verifyShippingSet(images, candidate, { present: true, manifest: emitted() }, REQUIRED_ROLES);
    assert.equal(set.ok, true, set.reason);
    assert.deepEqual(set.perImage.map((p) => p.method), ["build-manifest", "build-manifest"]);
  });

  test("it binds through the INHERITED UBI revision label, which proof A cannot", () => {
    // Both shipping images carry org.opencontainers.image.revision == vcs-ref
    // from their Red Hat base. That label describes Red Hat's build; the
    // manifest is what actually binds.
    const inherited = images.map((i) => ({
      ...i,
      labels: { "org.opencontainers.image.revision": "e573c6075f71cca94d900cafd032ccfa0f871961", "vcs-ref": "e573c6075f71cca94d900cafd032ccfa0f871961" },
    }));
    const set = verifyShippingSet(inherited, candidateFixture(), { present: true, manifest: emitted() }, REQUIRED_ROLES);
    assert.equal(set.ok, true, set.reason);
    assert.equal(set.perImage[0].observed.revisionLabelInherited, true);
  });

  test("A DIFFERENT CANDIDATE IS REFUSED — the manifest is perishable by design", () => {
    const set = verifyShippingSet(images, candidateFixture({ candidateId: "f".repeat(64) }), { present: true, manifest: emitted() }, REQUIRED_ROLES);
    assert.equal(set.ok, false);
    assert.match(set.reason, /different candidate/);
  });

  test("A REBUILT IMAGE NOT IN THE MANIFEST IS REFUSED", () => {
    const moved = [{ ...images[0], id: "9".repeat(64) }, images[1]];
    const set = verifyShippingSet(moved, candidateFixture(), { present: true, manifest: emitted() }, REQUIRED_ROLES);
    assert.equal(set.ok, false);
    assert.match(set.reason, /different image id/);
  });

  test("a role absent from the manifest is refused rather than skipped", () => {
    const m = emitted();
    m.images = m.images.filter((i) => i.role === "backend");
    const one = verifyImageProvenance(images[1], candidateFixture(), { present: true, manifest: m });
    assert.equal(one.bound, false);
    assert.match(one.reason, /does not list role "frontend"/);
  });
});
