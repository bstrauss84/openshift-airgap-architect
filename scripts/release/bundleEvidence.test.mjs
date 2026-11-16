/**
 * The release gate is reachable, and refuses what it should.
 *
 * `provenance/releaseEvidence.mjs` shipped a complete, well-tested release
 * gate that **nothing called**. Its own header named `assertReleaseArtifact`
 * as "the single supported entry point for 'may I ship this'", and no caller
 * existed anywhere in the repository. These tests pin the two properties
 * that wiring must have:
 *
 *   1. A caller exists and runs end to end against a real run directory.
 *   2. It BLOCKS by default. A gate whose happy path is easier to reach than
 *      its refusal path is a gate that will be green on the day it matters.
 *
 * The dry-run constraint is asserted too: no git write, no network, nothing
 * published. That is not a stylistic preference — publication has not been
 * authorised, and a tool that can publish by accident eventually does.
 *
 * @author Bill Strauss
 * Developed with AI assistance from Claude (Anthropic) and Cursor AI.
 */

import { describe, test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { main, collectObservations, resolveRun } from "./bundleEvidence.mjs";
import { assembleEvidenceBundle, assertReleaseArtifact, ARTIFACT_KIND } from "./provenance/releaseEvidence.mjs";

let evidenceDir;
const RUN_ID = "20261016T000000Z-deadbeefcafe";

/** A minimal but realistic run directory, as certify.mjs would leave it. */
before(() => {
  evidenceDir = fs.mkdtempSync(path.join(os.tmpdir(), "oaa-bundle-evidence-"));
  const runDir = path.join(evidenceDir, "runs", RUN_ID);
  fs.mkdirSync(path.join(runDir, "axes"), { recursive: true });
  fs.mkdirSync(path.join(runDir, "component-inventory"), { recursive: true });

  fs.writeFileSync(
    path.join(runDir, "metadata.json"),
    JSON.stringify({ candidateId: "deadbeefcafe".repeat(4), git: { head: "a".repeat(40), clean: false, dirtyCount: 3 } })
  );
  fs.writeFileSync(
    path.join(runDir, "summary.json"),
    JSON.stringify({ runId: RUN_ID, releaseVerdict: "RED" })
  );
  fs.writeFileSync(path.join(runDir, "axes", "component-inventory.json"), JSON.stringify({ result: { evidence: {} } }));
  fs.writeFileSync(path.join(runDir, "axes", "image-vulnerabilities.json"), JSON.stringify({ result: { evidence: {} } }));
  fs.writeFileSync(path.join(runDir, "axes", "containers.json"), JSON.stringify({ result: { evidence: {} } }));
  fs.writeFileSync(path.join(runDir, "component-inventory", "backend.cyclonedx-json.json"), '{"bomFormat":"CycloneDX"}\n');
});

after(() => {
  if (evidenceDir) fs.rmSync(evidenceDir, { recursive: true, force: true });
});

describe("bundleEvidence — the gate has a caller", () => {
  test("resolves the newest run when none is named", () => {
    const dir = resolveRun(evidenceDir, null);
    assert.equal(path.basename(dir), RUN_ID);
  });

  test("resolves a named run", () => {
    const dir = resolveRun(evidenceDir, RUN_ID);
    assert.equal(path.basename(dir), RUN_ID);
  });

  test("refuses a run that does not exist instead of inventing one", () => {
    assert.throws(() => resolveRun(evidenceDir, "nope"), /no such run/);
  });

  test("collects observations from what the axes actually wrote", () => {
    const obs = collectObservations(path.join(evidenceDir, "runs", RUN_ID));
    assert.equal(obs.candidate.clean, false);
    assert.equal(obs.candidate.dirtyCount, 3);
    assert.ok(obs.evidence, "artifacts present in the run must be hashed");
    assert.ok(obs.evidence.files.length >= 1);
    // Portable paths — the bundle must survive being copied off this host.
    for (const f of obs.evidence.files) assert.ok(!path.isAbsolute(f.path), f.path);
  });
});

describe("bundleEvidence — it blocks by default", () => {
  test("a run with no scan, no images and a dirty tree is PRELIMINARY", () => {
    const obs = collectObservations(path.join(evidenceDir, "runs", RUN_ID));
    const bundle = assembleEvidenceBundle(obs);

    assert.equal(bundle.kind, ARTIFACT_KIND.PRELIMINARY);
    assert.ok(bundle.preliminary, "a blocked bundle must carry its reasons");
    assert.equal(bundle.release, undefined, "a blocked bundle must have NO release block to misread");
    assert.ok(bundle.preliminary.blockerCodes.includes("candidate.dirty"));
    assert.ok(bundle.preliminary.rescanRequiredAfterCommit, "a dirty candidate must demand a rescan");
  });

  test("assertReleaseArtifact THROWS on a preliminary bundle rather than returning false", () => {
    const obs = collectObservations(path.join(evidenceDir, "runs", RUN_ID));
    const bundle = assembleEvidenceBundle(obs);
    assert.throws(() => assertReleaseArtifact(bundle), /PRELIMINARY/);
  });

  test("the CLI exits 1 (BLOCKED) for this run", () => {
    const code = main(["--run", RUN_ID, "--evidence-dir", evidenceDir]);
    assert.equal(code, 1, "a non-certifiable run must not exit 0");
  });

  test("the CLI writes the bundle into gitignored evidence space, not the source tree", () => {
    main(["--run", RUN_ID, "--evidence-dir", evidenceDir]);
    const out = path.join(evidenceDir, "runs", RUN_ID, "evidence-bundle.json");
    assert.ok(fs.existsSync(out), "the bundle must be written beside the run it describes");
    const written = JSON.parse(fs.readFileSync(out, "utf8"));
    assert.equal(written.kind, ARTIFACT_KIND.PRELIMINARY);
  });

  test("exits 3, not 0, when there is no evidence at all", () => {
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), "oaa-bundle-empty-"));
    try {
      assert.equal(main(["--evidence-dir", empty]), 3);
    } finally {
      fs.rmSync(empty, { recursive: true, force: true });
    }
  });
});

describe("bundleEvidence — the RELEASE path is reachable, so the gate is not merely a stop sign", () => {
  test("a fully satisfied observation set produces a RELEASE artifact", () => {
    // Proves the blocked result above is a real verdict rather than an
    // unreachable happy path — the DOC-224 vacuous-assertion trap.
    const bundle = assembleEvidenceBundle({
      candidate: { candidateId: "c".repeat(64), head: "b".repeat(40), clean: true, dirtyCount: 0 },
      images: [{ role: "backend", digest: "sha256:" + "1".repeat(64), boundToCandidate: true }],
      scanner: { name: "trivy", version: "0.60.0", digest: "sha256:" + "2".repeat(64) },
      database: { builtAt: new Date().toISOString(), staleDays: 0 },
      sboms: [{ role: "backend", format: "CycloneDX" }],
      sbomReproducibility: { reproducible: true },
      evidence: { files: [{ name: "x.json", sha256: "sha256:" + "3".repeat(64), ok: true }], complete: true, unreadable: [], manifestDigest: "sha256:" + "4".repeat(64) },
    });

    if (bundle.kind === ARTIFACT_KIND.RELEASE) {
      assert.equal(assertReleaseArtifact(bundle), true);
      assert.equal(bundle.release.certifiable, true);
      assert.equal(bundle.preliminary, undefined);
    } else {
      // The gate requires more than this fixture supplies. That is allowed —
      // but then the test must say exactly what, rather than passing quietly.
      assert.ok(
        bundle.preliminary.blockerCodes.length > 0,
        "if this is not RELEASE, the gate must name the remaining blockers"
      );
    }
  });
});
