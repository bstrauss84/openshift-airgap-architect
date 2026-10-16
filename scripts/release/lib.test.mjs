/**
 * Deterministic tests for the certification harness LIBRARIES.
 *
 * Candidate binding, evidence scoping and reuse, image-to-candidate
 * provenance, and scanner-database evidence. Nothing here touches the
 * network, builds an image, or mutates the repository; git-dependent
 * behaviour runs against throwaway repositories under the OS temp directory.
 *
 * The properties asserted are mostly negative, because the instrument's value
 * is that it cannot be talked into reporting a pass.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

import { describeCandidate, harnessRevision } from "./lib/candidate.mjs";
import {
  EvidenceStore, REUSE, inputDigest, contextDigest, evaluateStaleness, findReusableEvidence, makeRunId, priorRuns,
} from "./lib/evidence.mjs";
import {
  verifyImageProvenance, verifyShippingSet, loadBuildManifest, manifestAltersCandidate,
  REVISION_LABEL, CANDIDATE_LABEL, DEFAULT_MANIFEST_RELPATH, MANIFEST_FILENAME,
} from "./lib/provenance.mjs";
import { parseTrivyDb, parseGrypeDb, evaluateDb, ageDays, GRYPE_FRESHNESS_POLICY } from "./lib/scannerdb.mjs";
import { pass } from "./lib/status.mjs";

const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..");

/** A throwaway git repository with one commit. */
function tempRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "oaa-lib-test-"));
  const git = (...args) => execFileSync("git", ["-C", dir, ...args], { stdio: "ignore" });
  git("init", "-q", "-b", "main");
  git("config", "user.email", "test@example.invalid");
  git("config", "user.name", "Test");
  git("config", "commit.gpgsign", "false");
  fs.writeFileSync(path.join(dir, "a.txt"), "one\n");
  fs.writeFileSync(path.join(dir, "b.txt"), "two\n");
  git("add", "a.txt", "b.txt");
  git("commit", "-qm", "initial");
  return { dir, git, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

const tmpdir = (tag) => fs.mkdtempSync(path.join(os.tmpdir(), `oaa-${tag}-`));

describe("candidate binding", () => {
  test("a clean tree and a dirty tree are different candidates", () => {
    const repo = tempRepo();
    try {
      const clean = describeCandidate(repo.dir);
      assert.equal(clean.git.clean, true);
      assert.match(clean.exact, /\(clean\)$/);

      fs.writeFileSync(path.join(repo.dir, "a.txt"), "one modified\n");
      const dirty = describeCandidate(repo.dir);

      assert.equal(dirty.git.head, clean.git.head, "same commit");
      assert.notEqual(dirty.candidateId, clean.candidateId, "but must not be the same candidate");
      assert.match(dirty.exact, /\+dirty:/);
    } finally {
      repo.cleanup();
    }
  });

  test("TWO DIFFERENT BINARY CONTENTS at one path give different candidate ids", () => {
    // Regression for the 8A defect: a plain `git diff` renders any binary
    // change as the single line "Binary files a/x and b/x differ", which is
    // identical for two completely different replacement contents. Candidate
    // identity must use `--binary` so the bytes actually move the digest.
    const repo = tempRepo();
    try {
      const bin = path.join(repo.dir, "logo.png");
      // A real PNG header, so git's binary heuristic certainly fires.
      const header = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
      fs.writeFileSync(bin, Buffer.concat([header, Buffer.alloc(64, 0x01)]));
      repo.git("add", "logo.png");
      repo.git("commit", "-qm", "add binary");

      fs.writeFileSync(bin, Buffer.concat([header, Buffer.alloc(64, 0xaa)]));
      const first = describeCandidate(repo.dir);

      fs.writeFileSync(bin, Buffer.concat([header, Buffer.alloc(64, 0xbb)]));
      const second = describeCandidate(repo.dir);

      assert.equal(first.git.head, second.git.head, "precondition: same commit");
      assert.equal(first.git.clean, false);
      assert.notEqual(
        first.candidateId,
        second.candidateId,
        "different binary contents at the same path MUST be different candidates",
      );
    } finally {
      repo.cleanup();
    }
  });

  test("a file mode change moves the candidate id", () => {
    const repo = tempRepo();
    try {
      const before = describeCandidate(repo.dir).candidateId;
      fs.chmodSync(path.join(repo.dir, "a.txt"), 0o755);
      assert.notEqual(describeCandidate(repo.dir).candidateId, before);
    } finally {
      repo.cleanup();
    }
  });

  test("a deletion moves the candidate id", () => {
    const repo = tempRepo();
    try {
      const before = describeCandidate(repo.dir).candidateId;
      fs.rmSync(path.join(repo.dir, "b.txt"));
      assert.notEqual(describeCandidate(repo.dir).candidateId, before);
    } finally {
      repo.cleanup();
    }
  });

  test("an untracked file changes the candidate id", () => {
    const repo = tempRepo();
    try {
      const before = describeCandidate(repo.dir).candidateId;
      fs.writeFileSync(path.join(repo.dir, "new.txt"), "added\n");
      assert.notEqual(describeCandidate(repo.dir).candidateId, before);
    } finally {
      repo.cleanup();
    }
  });

  test("re-describing an unchanged tree is stable", () => {
    const repo = tempRepo();
    try {
      assert.equal(describeCandidate(repo.dir).candidateId, describeCandidate(repo.dir).candidateId);
    } finally {
      repo.cleanup();
    }
  });

  test("the harness digests itself, so changing the instrument is visible", () => {
    const rev = harnessRevision(path.join(REPO_ROOT, "scripts", "release"));
    assert.match(rev.digest, /^[0-9a-f]{64}$/);
    assert.ok(rev.fileCount > 5, "should have found the harness modules");
  });
});

describe("input digests", () => {
  test("an input digest moves only when a declared input moves", () => {
    const repo = tempRepo();
    try {
      const before = inputDigest(repo.dir, ["a.txt"]).digest;
      fs.writeFileSync(path.join(repo.dir, "b.txt"), "two changed\n");
      assert.equal(inputDigest(repo.dir, ["a.txt"]).digest, before, "b.txt is not a declared input of this axis");

      fs.writeFileSync(path.join(repo.dir, "a.txt"), "one changed\n");
      assert.notEqual(inputDigest(repo.dir, ["a.txt"]).digest, before);
    } finally {
      repo.cleanup();
    }
  });

  test("an axis declaring no inputs depends on the whole candidate", () => {
    const repo = tempRepo();
    try {
      const before = inputDigest(repo.dir, []).digest;
      fs.writeFileSync(path.join(repo.dir, "b.txt"), "two changed\n");
      assert.notEqual(inputDigest(repo.dir, []).digest, before, "conservative invalidation is the documented preference");
    } finally {
      repo.cleanup();
    }
  });

  test("prefix matching does not match a sibling by name prefix", () => {
    const repo = tempRepo();
    try {
      fs.mkdirSync(path.join(repo.dir, "src"));
      fs.mkdirSync(path.join(repo.dir, "srcgen"));
      fs.writeFileSync(path.join(repo.dir, "src", "x.js"), "x\n");
      fs.writeFileSync(path.join(repo.dir, "srcgen", "y.js"), "y\n");
      assert.equal(inputDigest(repo.dir, ["src"]).fileCount, 1, "'src' must not select 'srcgen/'");
    } finally {
      repo.cleanup();
    }
  });

  test("context digests are key-order independent but value sensitive", () => {
    assert.equal(contextDigest({ a: 1, b: 2 }), contextDigest({ b: 2, a: 1 }));
    assert.notEqual(contextDigest({ a: 1 }), contextDigest({ a: 2 }));
    assert.equal(contextDigest(null), null);
  });
});

describe("evidence reuse safety", () => {
  const base = { candidateId: "c1", inputDigest: "d1", contextDigest: "x1" };

  test("a never-reusable axis is never reused, even on an exact match", () => {
    const r = evaluateStaleness(base, { ...base, reuseClass: REUSE.NEVER });
    assert.equal(r.usable, false);
    assert.match(r.reason, /never-reusable/);
  });

  test("a candidate-only axis reuses on candidate and inputs alone", () => {
    assert.equal(evaluateStaleness(base, { candidateId: "c1", inputDigest: "d1", reuseClass: REUSE.CANDIDATE }).usable, true);
    assert.equal(evaluateStaleness(base, { candidateId: "c2", inputDigest: "d1", reuseClass: REUSE.CANDIDATE }).usable, false);
    assert.equal(evaluateStaleness(base, { candidateId: "c1", inputDigest: "d2", reuseClass: REUSE.CANDIDATE }).usable, false);
  });

  test("CONTEXT-BOUND evidence is stale when only the external context moved", () => {
    // Same source, same inputs, newer scanner database. This is the whole
    // reason the context class exists.
    const r = evaluateStaleness(base, { candidateId: "c1", inputDigest: "d1", contextDigest: "x2", reuseClass: REUSE.CONTEXT });
    assert.equal(r.usable, false);
    assert.match(r.reason, /external context changed/);
  });

  test("context-bound evidence with no recorded context cannot be reused", () => {
    const stored = { candidateId: "c1", inputDigest: "d1" }; // produced before context was recorded
    assert.equal(evaluateStaleness(stored, { ...base, reuseClass: REUSE.CONTEXT }).usable, false);
  });

  test("context-bound evidence reuses only on a full three-way match", () => {
    assert.equal(evaluateStaleness(base, { ...base, reuseClass: REUSE.CONTEXT }).usable, true);
  });

  test("absent evidence is not reusable", () => {
    assert.equal(evaluateStaleness(null, { ...base, reuseClass: REUSE.CANDIDATE }).usable, false);
  });
});

describe("run-scoped evidence", () => {
  test("each run gets its own directory and an explicit colliding run id is refused", () => {
    const root = tmpdir("evidence");
    try {
      const cand = { candidateId: "a".repeat(64) };
      const s1 = new EvidenceStore(root, cand, { runId: "run-1" });
      assert.ok(fs.existsSync(path.join(root, "runs", "run-1", "axes")));
      assert.throws(() => new EvidenceStore(root, cand, { runId: "run-1" }), /already exists/);
      assert.ok(s1.root.endsWith(path.join("runs", "run-1")));
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test("TWO RUNS IN THE SAME SECOND GET SEPARATE DIRECTORIES", () => {
    // Run ids are second-granular. Merging the two runs' evidence would be
    // wrong, and aborting the second over a clock coincidence would be worse.
    const root = tmpdir("evidence-sameclock");
    try {
      const cand = { candidateId: "b".repeat(64) };
      const at = new Date("2026-10-12T23:32:14Z");
      const a = new EvidenceStore(root, cand, { now: at });
      const b = new EvidenceStore(root, cand, { now: at });
      assert.notEqual(a.runId, b.runId);
      assert.notEqual(a.root, b.root);
      assert.ok(fs.existsSync(path.join(a.root, "axes")));
      assert.ok(fs.existsSync(path.join(b.root, "axes")));
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test("A PARTIAL RUN CANNOT LEAVE STALE ARTIFACTS beside a newer summary", () => {
    // The 8A defect: one shared directory meant a later partial run
    // overwrote summary.json while the previous run's per-axis files stayed
    // beside it, producing a directory that mixed candidates.
    const root = tmpdir("evidence-mix");
    try {
      const first = new EvidenceStore(root, { candidateId: "c1" }, { runId: "run-1" });
      first.recordAxis("docs", { inputDigest: "d1", result: pass("docs", "ok") });
      first.recordAxis("identity", { inputDigest: "d1", result: pass("identity", "ok") });

      const second = new EvidenceStore(root, { candidateId: "c2" }, { runId: "run-2" });
      second.recordAxis("docs", { inputDigest: "d2", result: pass("docs", "newer") });

      const secondAxes = fs.readdirSync(path.join(second.root, "axes"));
      assert.deepEqual(secondAxes, ["docs.json"], "run-2 must contain only run-2's axes");

      const firstAxes = fs.readdirSync(path.join(first.root, "axes")).sort();
      assert.deepEqual(firstAxes, ["docs.json", "identity.json"], "run-1's evidence is untouched, not overwritten");

      assert.equal(JSON.parse(fs.readFileSync(path.join(second.root, "axes", "docs.json"), "utf8")).candidateId, "c2");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test("artifacts are addressed relative to their own run", () => {
    const root = tmpdir("evidence-artifacts");
    try {
      const store = new EvidenceStore(root, { candidateId: "c1" }, { runId: "run-1" });
      const rel = store.writeArtifact("docs", "checks.json", { a: 1 });
      assert.equal(rel, path.join("docs", "checks.json"));
      assert.ok(fs.existsSync(path.join(root, "runs", "run-1", "docs", "checks.json")));
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test("reuse searches prior runs newest-first and honours the reuse class", () => {
    const root = tmpdir("evidence-reuse");
    try {
      const old = new EvidenceStore(root, { candidateId: "c1" }, { runId: "20260101T000000Z-aaa" });
      old.recordAxis("docs", { inputDigest: "d1", contextDigest: "x1", result: pass("docs", "from old run") });

      const criteria = { candidateId: "c1", inputDigest: "d1", contextDigest: "x1", reuseClass: REUSE.CONTEXT };
      const hit = findReusableEvidence(root, "docs", criteria);
      assert.equal(hit.found, true);
      assert.equal(hit.stored.result.detail, "from old run");

      assert.equal(findReusableEvidence(root, "docs", { ...criteria, contextDigest: "x2" }).found, false);
      assert.equal(findReusableEvidence(root, "docs", { ...criteria, reuseClass: REUSE.NEVER }).found, false);
      assert.equal(findReusableEvidence(root, "tests", criteria).found, false);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test("run ids sort chronologically and name their candidate", () => {
    const id = makeRunId({ candidateId: "abcdef0123456789" }, new Date("2026-10-12T23:15:00Z"));
    assert.equal(id, "20261012T231500Z-abcdef012345");
    const root = tmpdir("evidence-order");
    try {
      new EvidenceStore(root, { candidateId: "c" }, { runId: "20260101T000000Z-a" });
      new EvidenceStore(root, { candidateId: "c" }, { runId: "20260202T000000Z-b" });
      assert.deepEqual(priorRuns(root), ["20260202T000000Z-b", "20260101T000000Z-a"], "newest first");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("image-to-candidate provenance", () => {
  const cleanCandidate = { candidateId: "c".repeat(64), git: { head: "a".repeat(40), clean: true } };
  const dirtyCandidate = { candidateId: "d".repeat(64), git: { head: "a".repeat(40), clean: false } };
  const img = (labels = {}, extra = {}) => ({ role: "backend", ref: "localhost/x:latest", present: true, id: "sha256:1", labels, ...extra });

  test("AN UNLABELLED IMAGE IS NEVER BOUND — the 8A gap", () => {
    // A stale local image with the right tag satisfied every structural check
    // while containing none of the certified source.
    const r = verifyImageProvenance(img(), cleanCandidate);
    assert.equal(r.bound, false);
    assert.match(r.reason, /no provenance/);
  });

  test("a revision label matching HEAD binds a CLEAN candidate", () => {
    const r = verifyImageProvenance(img({ [REVISION_LABEL]: "a".repeat(40) }), cleanCandidate);
    assert.equal(r.bound, true);
    assert.equal(r.method, "oci-label:revision");
  });

  test("A WRONG-REVISION IMAGE CANNOT BIND", () => {
    const r = verifyImageProvenance(img({ [REVISION_LABEL]: "b".repeat(40) }), cleanCandidate);
    assert.equal(r.bound, false);
    assert.match(r.reason, /different revision/);
  });

  test("a revision label cannot bind a DIRTY candidate", () => {
    // The commit does not describe the bytes on disk.
    const r = verifyImageProvenance(img({ [REVISION_LABEL]: "a".repeat(40) }), dirtyCandidate);
    assert.equal(r.bound, false);
    assert.match(r.reason, /dirty/);
  });

  test("a matching candidate-id label binds even a dirty candidate", () => {
    const r = verifyImageProvenance(img({ [CANDIDATE_LABEL]: dirtyCandidate.candidateId }), dirtyCandidate);
    assert.equal(r.bound, true);
    assert.equal(r.method, "oci-label:candidate-id");
  });

  test("a mismatched candidate-id label is rejected outright", () => {
    const r = verifyImageProvenance(img({ [CANDIDATE_LABEL]: "e".repeat(64) }), dirtyCandidate);
    assert.equal(r.bound, false);
    assert.match(r.reason, /DIFFERENT candidate/);
  });

  test("a build manifest binds when it names this candidate and this image id", () => {
    const manifest = { present: true, manifest: { candidateId: dirtyCandidate.candidateId, images: [{ role: "backend", id: "sha256:1" }] } };
    const r = verifyImageProvenance(img(), dirtyCandidate, manifest);
    assert.equal(r.bound, true);
    assert.equal(r.method, "build-manifest");
  });

  test("a build manifest for another candidate does not bind", () => {
    const manifest = { present: true, manifest: { candidateId: "f".repeat(64), images: [{ role: "backend", id: "sha256:1" }] } };
    assert.equal(verifyImageProvenance(img(), dirtyCandidate, manifest).bound, false);
  });

  test("a build manifest listing a different image id does not bind", () => {
    const manifest = { present: true, manifest: { candidateId: dirtyCandidate.candidateId, images: [{ role: "backend", id: "sha256:OTHER" }] } };
    const r = verifyImageProvenance(img(), dirtyCandidate, manifest);
    assert.equal(r.bound, false);
    assert.match(r.reason, /different image id/);
  });

  test("ONE MISSING SHIPPING IMAGE BLOCKS THE WHOLE SET", () => {
    // The 8A bug: axes filtered to `present` images and could PASS on one of two.
    const images = [
      { role: "backend", present: true, id: "sha256:1", ref: "be", labels: { [CANDIDATE_LABEL]: cleanCandidate.candidateId } },
      { role: "frontend", present: false, ref: "fe", reason: "not found" },
    ];
    const set = verifyShippingSet(images, cleanCandidate, { present: false }, ["backend", "frontend"]);
    assert.equal(set.ok, false);
    assert.deepEqual(set.missingRoles, ["frontend"]);
    assert.match(set.reason, /not present locally/);
  });

  test("the complete, bound set is accepted", () => {
    const images = ["backend", "frontend"].map((role) => ({
      role, present: true, id: `sha256:${role}`, ref: role, labels: { [CANDIDATE_LABEL]: cleanCandidate.candidateId },
    }));
    const set = verifyShippingSet(images, cleanCandidate, { present: false }, ["backend", "frontend"]);
    assert.equal(set.ok, true);
    assert.equal(set.unbound.length, 0);
  });

  test("a present but unbound image blocks the set", () => {
    const images = ["backend", "frontend"].map((role) => ({ role, present: true, id: `sha256:${role}`, ref: role, labels: {} }));
    const set = verifyShippingSet(images, cleanCandidate, { present: false }, ["backend", "frontend"]);
    assert.equal(set.ok, false);
    assert.match(set.reason, /not provably built from this candidate/);
  });

  test("an absent build manifest is reported, not thrown", () => {
    const r = loadBuildManifest(tmpdir("no-manifest"), {});
    assert.equal(r.present, false);
  });
});

describe("the build manifest must not change the candidate it describes", () => {
  /** A repo with release-certification/ ignored, matching the real .gitignore. */
  function repoWithIgnore() {
    const repo = tempRepo();
    fs.writeFileSync(path.join(repo.dir, ".gitignore"), "release-certification/\n");
    repo.git("add", ".gitignore");
    repo.git("commit", "-qm", "ignore evidence");
    return repo;
  }

  test("the DEFAULT location is inside ignored evidence space, not the repo root", () => {
    // The 8A.1 defect: defaulting to <repo>/release-build-manifest.json made
    // the proof self-referential, because untracked files are part of the
    // candidate id.
    assert.equal(DEFAULT_MANIFEST_RELPATH, path.join("release-certification", MANIFEST_FILENAME));
  });

  test("WRITING THE MANIFEST AT THE DEFAULT PATH DOES NOT MUTATE THE CANDIDATE ID", () => {
    const repo = repoWithIgnore();
    try {
      const before = describeCandidate(repo.dir).candidateId;

      const file = path.join(repo.dir, DEFAULT_MANIFEST_RELPATH);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, JSON.stringify({ candidateId: before, images: [{ role: "backend", id: "sha256:1" }] }));

      const after = describeCandidate(repo.dir).candidateId;
      assert.equal(after, before, "the proof must not alter the thing it proves");

      // And it is actually loadable and binds the candidate it names.
      const loaded = loadBuildManifest(repo.dir, {});
      assert.equal(loaded.present, true);
      assert.equal(loaded.manifest.candidateId, before);
    } finally {
      repo.cleanup();
    }
  });

  test("a manifest at the repository root WOULD alter the candidate, and is refused", () => {
    const repo = repoWithIgnore();
    try {
      const rootManifest = path.join(repo.dir, MANIFEST_FILENAME);
      assert.equal(manifestAltersCandidate(repo.dir, rootManifest), true);

      const before = describeCandidate(repo.dir).candidateId;
      fs.writeFileSync(rootManifest, JSON.stringify({ candidateId: before, images: [] }));
      assert.notEqual(describeCandidate(repo.dir).candidateId, before, "precondition: it really is self-referential");

      const loaded = loadBuildManifest(repo.dir, { OAA_CERT_BUILD_MANIFEST: rootManifest });
      assert.equal(loaded.present, false, "a self-referential manifest must not be used");
      assert.match(loaded.error, /participates in candidate identity/);
    } finally {
      repo.cleanup();
    }
  });

  test("an override outside the repository is accepted", () => {
    const repo = repoWithIgnore();
    const outside = tmpdir("outside-manifest");
    try {
      const file = path.join(outside, MANIFEST_FILENAME);
      fs.writeFileSync(file, JSON.stringify({ candidateId: "c1", images: [] }));
      assert.equal(manifestAltersCandidate(repo.dir, file), false);
      const loaded = loadBuildManifest(repo.dir, { OAA_CERT_BUILD_MANIFEST: file });
      assert.equal(loaded.present, true);
      assert.equal(loaded.manifest.candidateId, "c1");
    } finally {
      repo.cleanup();
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });

  test("untracked-file candidate binding is NOT weakened to achieve this", () => {
    // The fix is where the manifest lives, not which untracked files count.
    const repo = repoWithIgnore();
    try {
      const before = describeCandidate(repo.dir).candidateId;
      fs.writeFileSync(path.join(repo.dir, "some-new-source.js"), "export const x = 1;\n");
      assert.notEqual(describeCandidate(repo.dir).candidateId, before, "ordinary untracked files must still bind");
    } finally {
      repo.cleanup();
    }
  });

  test("the real repository ignores the default manifest location", () => {
    assert.equal(manifestAltersCandidate(REPO_ROOT, path.join(REPO_ROOT, DEFAULT_MANIFEST_RELPATH)), false);
  });
});

describe("scanner database evidence", () => {
  test("trivy DB identity is parsed from its version output", () => {
    const db = parseTrivyDb(
      { Version: "0.75.0", VulnerabilityDB: { Version: 2, UpdatedAt: "2026-10-12T06:00:00Z", NextUpdate: "2026-10-13T06:00:00Z", DownloadedAt: "2026-10-12T07:00:00Z" } },
      new Date("2026-10-12T12:00:00Z"),
    );
    assert.equal(db.identified, true);
    assert.equal(db.scannerVersion, "0.75.0");
    assert.equal(db.expiredByToolDeclaration, false);
    assert.equal(evaluateDb(db).acceptable, true);
  });

  test("a trivy DB past its own NextUpdate is not acceptable evidence", () => {
    // The tool's own declaration of staleness, not a threshold invented here.
    const db = parseTrivyDb(
      { Version: "0.75.0", VulnerabilityDB: { Version: 2, UpdatedAt: "2026-09-01T06:00:00Z", NextUpdate: "2026-09-02T06:00:00Z" } },
      new Date("2026-10-12T12:00:00Z"),
    );
    assert.equal(db.expiredByToolDeclaration, true);
    const v = evaluateDb(db);
    assert.equal(v.acceptable, false);
    assert.match(v.reason, /due for update/);
  });

  test("trivy output without a VulnerabilityDB block is unidentified", () => {
    const db = parseTrivyDb({ Version: "0.75.0" });
    assert.equal(db.identified, false);
    assert.equal(evaluateDb(db).acceptable, false);
  });

  test("grype DB identity is parsed, and an invalid DB is refused", () => {
    const ok = parseGrypeDb({ schemaVersion: "v6.1.9", built: "2026-10-11T00:00:00Z", from: "https://example/db.tar.zst", path: "/c/vulnerability.db", valid: true });
    assert.equal(ok.identified, true);
    assert.equal(ok.dbSchemaVersion, "v6.1.9");
    assert.equal(ok.source, "https://example/db.tar.zst");
    // No vendor-declared horizon exists for grype, so none is invented.
    assert.equal(ok.expiredByToolDeclaration, null);
    assert.match(ok.freshnessPolicy, /no vendor-declared expiry/);

    const bad = parseGrypeDb({ schemaVersion: "v6.1.9", built: "2026-10-11T00:00:00Z", valid: false, error: "corrupt" });
    const v = evaluateDb(bad);
    assert.equal(v.acceptable, false);
    assert.match(v.reason, /not valid/, "an invalid DB is refused on its own terms, before the policy question");
  });

  test("grype's documented `valid` unreliability is carried in the evidence", () => {
    const db = parseGrypeDb({ schemaVersion: "v6", built: "2026-10-11T00:00:00Z", valid: true });
    assert.match(db.caveat, /necessary, not sufficient/);
  });

  test("A VALID BUT ARBITRARILY OLD GRYPE DB CANNOT MANUFACTURE RELEASE EVIDENCE", () => {
    // The 8A.1 contradiction: the module documented `valid` as "necessary but
    // not sufficient" and then treated valid + builtAt as sufficient, which
    // let a years-old database produce a release PASS.
    const ancient = parseGrypeDb({ schemaVersion: "v6.1.9", built: "2019-01-01T00:00:00Z", valid: true, from: "https://example/db" });
    const v = evaluateDb(ancient);
    assert.equal(v.acceptable, false, "no approved freshness policy exists for grype");
    assert.equal(v.diagnosticOnly, true);
    assert.match(v.reason, /diagnostic-only/);
    // Identity is still recorded — it is sufficiency that is refused.
    assert.equal(ancient.builtAt, "2019-01-01T00:00:00Z");
    assert.equal(ancient.dbSchemaVersion, "v6.1.9");
  });

  test("even a freshly built grype DB is diagnostic-only while no policy is approved", () => {
    const fresh = parseGrypeDb({ schemaVersion: "v6.1.9", built: new Date().toISOString(), valid: true });
    assert.equal(evaluateDb(fresh).acceptable, false, "recency cannot be inferred without a vendor horizon");
  });

  test("grype becomes acceptable only when a human approves a freshness policy", () => {
    // Proves the refusal is policy, not a hard-coded dead end — and that
    // approving it is a code change, not a config toggle.
    const db = parseGrypeDb({ schemaVersion: "v6.1.9", built: "2026-10-11T00:00:00Z", valid: true });
    assert.equal(GRYPE_FRESHNESS_POLICY.approved, false, "v2.1 ships with no approved grype policy");
    const v = evaluateDb(db, { grypePolicy: { approved: true, owner: "8D", reason: "approved" } });
    assert.equal(v.acceptable, true);
  });

  test("trivy is unaffected: it still gates on its own declared horizon", () => {
    const db = parseTrivyDb(
      { Version: "0.75.0", VulnerabilityDB: { Version: 2, UpdatedAt: "2026-10-12T06:00:00Z", NextUpdate: "2026-10-13T06:00:00Z" } },
      new Date("2026-10-12T12:00:00Z"),
    );
    assert.equal(evaluateDb(db).acceptable, true);
  });

  test("an unidentifiable database is never acceptable", () => {
    assert.equal(evaluateDb(null).acceptable, false);
    assert.equal(evaluateDb({ identified: false, reason: "nope" }).acceptable, false);
  });

  test("age is reported in whole days, and tolerates unknown input", () => {
    assert.equal(ageDays("2026-10-02T00:00:00Z", new Date("2026-10-12T00:00:00Z")), 10);
    assert.equal(ageDays(null), null);
    assert.equal(ageDays("not a date"), null);
  });
});
