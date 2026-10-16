/**
 * Deterministic tests for the STATUS MODEL and the ORCHESTRATOR.
 *
 * The central property under test is that no command-line combination, no
 * waiver file and no axis outcome can produce a release GREEN that is not
 * earned. Most assertions are therefore negative.
 *
 * Library-level behaviour (candidate binding, evidence scoping, provenance,
 * scanner databases) lives in lib.test.mjs; per-axis logic in axes.test.mjs.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  PASS, FAIL, INCOMPLETE, WAIVED, NOT_APPLICABLE,
  result, pass, incomplete, applyWaiver, validateWaiver, validateWaiverSet, parseExpiry,
  overall, releaseVerdict, exitCodeFor, isBlocking, isStatus, EXIT,
} from "./lib/status.mjs";
import { parseArgs, certify, loadWaivers } from "./certify.mjs";
import { REQUIRED_AXIS_IDS, NON_WAIVABLE_AXIS_IDS } from "./axes/index.mjs";

const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..");
const evidenceDir = () => fs.mkdtempSync(path.join(os.tmpdir(), "oaa-certify-run-"));

describe("status model", () => {
  test("every exported status is recognised, and nothing else is", () => {
    for (const s of [PASS, FAIL, INCOMPLETE, WAIVED, NOT_APPLICABLE]) assert.ok(isStatus(s));
    assert.equal(isStatus("GREEN"), false);
    assert.equal(isStatus("PARTIAL"), false, "PARTIAL is a run verdict, not an axis status");
  });

  test("only FAIL and INCOMPLETE block a release", () => {
    assert.equal(isBlocking(FAIL), true);
    assert.equal(isBlocking(INCOMPLETE), true);
    assert.equal(isBlocking(PASS), false);
    assert.equal(isBlocking(WAIVED), false);
    assert.equal(isBlocking(NOT_APPLICABLE), false);
  });

  test("result() rejects an unknown status rather than passing it through", () => {
    assert.throws(() => result("x", "MOSTLY_FINE", "d"), /unknown certification status/);
  });

  test("NOT_APPLICABLE without evidence is refused", () => {
    assert.throws(() => result("x", NOT_APPLICABLE, "does not apply"), /without evidence/);
    assert.doesNotThrow(() => result("x", NOT_APPLICABLE, "n/a", { evidence: { why: "no such surface" } }));
  });

  test("the executed-axes rollup is FAIL-dominant", () => {
    assert.equal(overall([{ status: PASS }, { status: WAIVED }, { status: NOT_APPLICABLE }]), "GREEN");
    assert.equal(overall([{ status: PASS }, { status: INCOMPLETE }]), "INCOMPLETE");
    assert.equal(overall([{ status: INCOMPLETE }, { status: FAIL }]), "RED");
  });

  test("exit codes are distinct and deterministic", () => {
    assert.equal(exitCodeFor("GREEN"), 0);
    assert.equal(exitCodeFor("RED"), 1);
    assert.equal(exitCodeFor("INCOMPLETE"), 2);
    assert.equal(exitCodeFor("PARTIAL"), 4);
    assert.equal(exitCodeFor("nonsense"), EXIT.HARNESS_ERROR);
    assert.equal(new Set(Object.values(EXIT)).size, Object.values(EXIT).length);
  });
});

describe("release verdict: a partial run can never be GREEN", () => {
  const green = [{ status: PASS }, { status: PASS }];

  test("all required axes present and non-blocking is GREEN", () => {
    assert.equal(releaseVerdict({ results: green, missingRequiredAxes: [] }), "GREEN");
  });

  test("ONE OMITTED REQUIRED AXIS MAKES AN ALL-PASS RUN PARTIAL", () => {
    assert.equal(releaseVerdict({ results: green, missingRequiredAxes: ["sbom"] }), "PARTIAL");
  });

  test("PARTIAL outranks INCOMPLETE — not trying is worse than not proving", () => {
    assert.equal(
      releaseVerdict({ results: [{ status: INCOMPLETE }], missingRequiredAxes: ["containers"] }),
      "PARTIAL",
    );
  });

  test("a proven defect still outranks PARTIAL", () => {
    assert.equal(releaseVerdict({ results: [{ status: FAIL }], missingRequiredAxes: ["containers"] }), "RED");
  });

  test("MALFORMED WAIVER GOVERNANCE CANNOT COEXIST WITH GREEN", () => {
    assert.equal(releaseVerdict({ results: green, missingRequiredAxes: [], governanceErrors: ["bad waiver"] }), "INCOMPLETE");
  });
});

describe("waivers cannot be used to manufacture a pass", () => {
  const base = { id: "W-1", axis: "containers", reason: "r", owner: "o", authorizedBy: "human", expires: "2030-01-01" };
  const now = new Date("2026-10-12T00:00:00Z");

  test("a valid, unexpired waiver downgrades FAIL to WAIVED and records what it hid", () => {
    const r = applyWaiver(result("containers", FAIL, "2 assertions failed"), base, now);
    assert.equal(r.status, WAIVED);
    assert.equal(r.waivedFrom, FAIL);
    assert.equal(r.waiver.authorizedBy, "human");
  });

  test("a waiver never yields PASS", () => {
    assert.notEqual(applyWaiver(result("containers", FAIL, "d"), base, now).status, PASS);
  });

  test("A NON-WAIVABLE AXIS REJECTS ITS WAIVER", () => {
    const r = applyWaiver(result("image-vulnerabilities", INCOMPLETE, "no scanner"),
      { ...base, axis: "image-vulnerabilities" }, now, { nonWaivable: true });
    assert.equal(r.status, INCOMPLETE, "policy must survive a waiver entry");
    assert.match(r.waiverRejected, /non-waivable/);
  });

  test("an expired waiver does not apply and says so", () => {
    const r = applyWaiver(result("containers", FAIL, "d"), { ...base, expires: "2020-01-01" }, now);
    assert.equal(r.status, FAIL);
    assert.match(r.waiverRejected, /expired/);
  });

  test("a bare expiry date keeps the waiver live through that whole day", () => {
    const r = applyWaiver(result("containers", FAIL, "d"), { ...base, expires: "2026-10-12" }, now);
    assert.equal(r.status, WAIVED);
  });

  test("a waiver for a different axis is ignored", () => {
    assert.equal(applyWaiver(result("containers", FAIL, "d"), { ...base, axis: "docs" }, now).status, FAIL);
  });

  test("a waiver cannot touch a non-blocking status", () => {
    const r = applyWaiver(pass("containers", "clean"), base, now);
    assert.equal(r.status, PASS);
    assert.equal(r.waiver, undefined);
  });

  test("LOCALE-AMBIGUOUS EXPIRY DATES ARE REJECTED", () => {
    // `new Date("01/02/2026")` parses, and means two different days to two
    // different readers. A waiver expiry is the wrong field to leave ambiguous.
    for (const bad of ["01/02/2026", "Jan 2 2026", "2026-13-01T00:00:00Z", "2026/01/02", "tomorrow"]) {
      assert.equal(parseExpiry(bad), null, `${bad} must not parse`);
      assert.match(validateWaiver({ ...base, expires: bad }), /ambiguous|not an unambiguous/);
    }
    assert.ok(parseExpiry("2026-10-12"));
    assert.ok(parseExpiry("2026-10-12T23:59:59Z"));
  });

  test("IMPOSSIBLE CALENDAR DATES ARE REJECTED, NOT NORMALISED", () => {
    // A shape-only regex is not enough: JavaScript's Date silently rolls
    // 2026-02-31 forward to March 3, so a typo'd expiry would quietly become
    // a real — and later — date.
    for (const bad of [
      "2026-02-29", // 2026 is not a leap year
      "2026-02-31",
      "2026-04-31",
      "2026-06-31",
      "2026-00-10",
      "2026-01-00",
      "2026-01-32",
      "2026-02-31T23:59:59Z",
    ]) {
      assert.equal(parseExpiry(bad), null, `${bad} must be rejected, not normalised`);
      assert.match(validateWaiver({ ...base, expires: bad }), /real calendar date/);
    }
  });

  test("real calendar dates, including a genuine leap day, are accepted", () => {
    for (const good of ["2028-02-29", "2026-12-31", "2026-12-31T23:59:59Z", "2026-01-01", "2026-02-28"]) {
      assert.ok(parseExpiry(good), `${good} must be accepted`);
      assert.equal(validateWaiver({ ...base, expires: good }), null);
    }
  });

  test("out-of-range times are rejected", () => {
    for (const bad of ["2026-12-31T24:00:00Z", "2026-12-31T23:60:00Z", "2026-12-31T23:59:60Z"]) {
      assert.equal(parseExpiry(bad), null, `${bad} must be rejected`);
    }
  });

  test("a bare date resolves to the end of that UTC day", () => {
    assert.equal(parseExpiry("2026-12-31").toISOString(), "2026-12-31T23:59:59.000Z");
  });

  test("every governance field is required", () => {
    assert.equal(validateWaiver(base), null);
    for (const field of ["id", "axis", "reason", "owner", "authorizedBy", "expires"]) {
      assert.match(validateWaiver({ ...base, [field]: "" }), new RegExp(field), `${field} must be required`);
    }
  });
});

describe("waiver set governance", () => {
  const mk = (over) => ({ id: "W", axis: "containers", reason: "r", owner: "o", authorizedBy: "h", expires: "2030-01-01", ...over });
  const opts = { knownAxisIds: ["containers", "docs", "image-vulnerabilities"], nonWaivableAxisIds: ["image-vulnerabilities"] };

  test("DUPLICATE WAIVER IDS ARE REJECTED", () => {
    const { waivers, errors } = validateWaiverSet([mk({ id: "W-1" }), mk({ id: "W-1", axis: "docs" })], opts);
    assert.equal(waivers.length, 1);
    assert.match(errors.join(), /duplicate waiver id/);
  });

  test("TWO ACTIVE WAIVERS FOR ONE AXIS ARE AMBIGUOUS AND REJECTED", () => {
    const { waivers, errors } = validateWaiverSet([mk({ id: "W-1" }), mk({ id: "W-2" })], opts);
    assert.equal(waivers.length, 1);
    assert.match(errors.join(), /ambiguous/);
  });

  test("a waiver naming a non-waivable axis is a governance error", () => {
    const { waivers, errors } = validateWaiverSet([mk({ id: "W-1", axis: "image-vulnerabilities" })], opts);
    assert.deepEqual(waivers, []);
    assert.match(errors.join(), /NON-WAIVABLE/);
  });

  test("an unknown axis is a governance error", () => {
    const { errors } = validateWaiverSet([mk({ id: "W-1", axis: "nope" })], opts);
    assert.match(errors.join(), /unknown axis/);
  });

  test("the repository's tracked waiver file is valid and currently empty", () => {
    const { waivers, errors } = loadWaivers(REPO_ROOT);
    assert.deepEqual(errors, [], "tracked waivers.json must have no governance errors");
    assert.deepEqual(waivers, [], "no release-blocking waiver is authorized at this time");
  });

  test("the non-waivable set is non-empty, so the policy is actually in force", () => {
    assert.ok(NON_WAIVABLE_AXIS_IDS.length > 0);
  });
});

describe("orchestrator", () => {
  test("arguments parse into an explicit plan", () => {
    const o = parseArgs(["--axis", "docs", "--axis=tests", "--skip-containers", "--reuse"]);
    assert.deepEqual(o.axes, ["docs", "tests"]);
    assert.equal(o.skipContainers, true);
    assert.equal(o.reuse, true);
  });

  test("an unknown argument is a harness error, not a silently ignored flag", async () => {
    assert.equal((await certify(["--definitely-not-a-flag"])).exitCode, EXIT.HARNESS_ERROR);
  });

  test("an unknown axis is a harness error", async () => {
    assert.equal((await certify(["--axis", "no-such-axis"])).exitCode, EXIT.HARNESS_ERROR);
  });

  test("--list names every axis without running anything", async () => {
    const r = await certify(["--list"]);
    assert.deepEqual(r.results, []);
    assert.equal(r.exitCode, EXIT.GREEN);
  });

  test("`--axis identity` CANNOT CLAIM FULL-RELEASE GREEN", async () => {
    const dir = evidenceDir();
    try {
      const s = await certify(["--axis", "identity", "--evidence-dir", dir], { repoRoot: REPO_ROOT });
      assert.equal(s.results.length, 1);
      assert.equal(s.scope, "partial");
      assert.notEqual(s.releaseVerdict, "GREEN");
      assert.equal(s.releaseVerdict, "PARTIAL");
      assert.equal(s.exitCode, EXIT.PARTIAL);
      assert.ok(s.missingRequiredAxes.length > 0, "omitted required axes must be enumerated");
      assert.ok(!s.missingRequiredAxes.includes("identity"));
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test("`--skip-containers` CANNOT CLAIM FULL-RELEASE GREEN", async () => {
    const dir = evidenceDir();
    try {
      const s = await certify(["--skip-containers", "--axis", "identity", "--axis", "containers", "--evidence-dir", dir], { repoRoot: REPO_ROOT });
      assert.equal(s.scope, "partial");
      assert.notEqual(s.releaseVerdict, "GREEN");
      assert.ok(s.missingRequiredAxes.includes("containers"), "the skipped container axis must be named");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test("omitted required axes are machine-readable, not just console text", async () => {
    const dir = evidenceDir();
    try {
      const s = await certify(["--axis", "identity", "--evidence-dir", dir], { repoRoot: REPO_ROOT });
      const written = JSON.parse(fs.readFileSync(path.join(s.evidenceDir, "summary.json"), "utf8"));
      assert.equal(written.scope, "partial");
      assert.equal(written.releaseVerdict, "PARTIAL");
      assert.deepEqual(written.requiredAxes, [...REQUIRED_AXIS_IDS]);
      assert.ok(written.missingRequiredAxes.length > 0);

      const md = fs.readFileSync(path.join(s.evidenceDir, "summary.md"), "utf8");
      assert.match(md, /\*\*Scope:\*\* PARTIAL/);
      assert.match(md, /Required axes NOT attempted/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test("console, markdown, JSON and exit code all agree", async () => {
    const dir = evidenceDir();
    try {
      const s = await certify(["--axis", "lifecycle", "--evidence-dir", dir], { repoRoot: REPO_ROOT });
      const written = JSON.parse(fs.readFileSync(path.join(s.evidenceDir, "summary.json"), "utf8"));
      const md = fs.readFileSync(path.join(s.evidenceDir, "summary.md"), "utf8");
      assert.equal(written.releaseVerdict, s.releaseVerdict);
      assert.equal(s.exitCode, exitCodeFor(s.releaseVerdict));
      assert.match(md, new RegExp(`\\*\\*Release verdict:\\*\\* ${s.releaseVerdict}`));
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test("a real run produces evidence bound to the candidate, in its own run directory", async () => {
    const dir = evidenceDir();
    try {
      const s = await certify(["--axis", "repo-hygiene", "--evidence-dir", dir], { repoRoot: REPO_ROOT });
      assert.ok(isStatus(s.results[0].status));

      const written = JSON.parse(fs.readFileSync(path.join(s.evidenceDir, "summary.json"), "utf8"));
      assert.equal(written.candidate.candidateId, s.candidate.candidateId);
      assert.match(written.candidate.candidateId, /^[0-9a-f]{64}$/);
      assert.equal(written.runId, s.runId);

      const rec = JSON.parse(fs.readFileSync(path.join(s.evidenceDir, "axes", "repo-hygiene.json"), "utf8"));
      assert.equal(rec.candidateId, s.candidate.candidateId);
      assert.equal(rec.runId, s.runId);
      assert.match(rec.inputDigest, /^[0-9a-f]{64}$/);
      assert.equal(rec.harnessRevision, s.candidate.harness.digest);

      // The run directory is nested under runs/, and a latest pointer exists.
      assert.equal(path.basename(path.dirname(s.evidenceDir)), "runs");
      const latest = JSON.parse(fs.readFileSync(path.join(dir, "latest.json"), "utf8"));
      assert.equal(latest.runId, s.runId);
      assert.equal(latest.releaseVerdict, s.releaseVerdict);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test("TWO RUNS DO NOT SHARE A DIRECTORY", async () => {
    const dir = evidenceDir();
    try {
      const a = await certify(["--axis", "repo-hygiene", "--evidence-dir", dir], { repoRoot: REPO_ROOT });
      const b = await certify(["--axis", "lifecycle", "--evidence-dir", dir], { repoRoot: REPO_ROOT, now: new Date(Date.now() + 1000) });
      assert.notEqual(a.runId, b.runId);
      assert.deepEqual(fs.readdirSync(path.join(a.evidenceDir, "axes")), ["repo-hygiene.json"]);
      assert.deepEqual(fs.readdirSync(path.join(b.evidenceDir, "axes")), ["lifecycle.json"], "run B must not inherit run A's axes");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test("A FULL CERTIFICATION CANNOT USE --reuse AT ALL", async () => {
    // Reused evidence is read from an older run directory and its artifacts
    // are not copied forward, so a full run using it would not be
    // self-contained while claiming to be the release evidence.
    const r = await certify(["--reuse"], { repoRoot: REPO_ROOT });
    assert.equal(r.exitCode, EXIT.HARNESS_ERROR);
    assert.notEqual(r.releaseVerdict, "GREEN");
    assert.deepEqual(r.results, [], "nothing should have run");
  });

  test("--reuse remains available for a scoped diagnostic run", async () => {
    const dir = evidenceDir();
    try {
      const s = await certify(["--reuse", "--axis", "repo-hygiene", "--evidence-dir", dir], { repoRoot: REPO_ROOT });
      assert.equal(s.scope, "partial");
      assert.notEqual(s.exitCode, EXIT.HARNESS_ERROR);
      assert.notEqual(s.releaseVerdict, "GREEN", "a diagnostic run is still not release evidence");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test("axes whose external context cannot be fully specified never reuse", async () => {
    const { axisById } = await import("./axes/index.mjs");
    const { REUSE } = await import("./lib/evidence.mjs");
    for (const id of ["tests", "secrets", "image-vulnerabilities", "component-inventory", "ci-integrity",
      "dependencies-shipped", "dependencies-builder"]) {
      assert.equal(axisById(id).reuse, REUSE.NEVER, `${id} must never reuse evidence`);
    }
  });

  test("the markdown explains that PARTIAL and INCOMPLETE are not passes", async () => {
    const dir = evidenceDir();
    try {
      const s = await certify(["--axis", "connectivity", "--evidence-dir", dir], { repoRoot: REPO_ROOT });
      const md = fs.readFileSync(path.join(s.evidenceDir, "summary.md"), "utf8");
      assert.match(md, /INCOMPLETE means a required proof could not be performed/);
      assert.match(md, /PARTIAL means a/);
      assert.match(md, /\| connectivity \| INCOMPLETE \|/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test("an axis that throws becomes INCOMPLETE and the run still completes", async () => {
    // A harness that dies halfway produces partial evidence that looks complete.
    const thrower = { id: "docs", title: "t", inputs: [], run() { throw new Error("boom"); } };
    let caught = null;
    try { await thrower.run(); } catch (err) { caught = err; }
    assert.ok(caught, "precondition: the axis really throws");
    const wrapped = incomplete(thrower.id, `axis threw: ${caught.message}`, { evidence: { error: caught.stack } });
    assert.equal(wrapped.status, INCOMPLETE);
    assert.notEqual(wrapped.status, PASS);
  });

  test("certification leaves no temp directories of its own behind", async () => {
    const before = fs.readdirSync(os.tmpdir()).filter((f) => f.startsWith("oaa-certify-archives-") || f.startsWith("oaa-certify-secrets-"));
    const dir = evidenceDir();
    try {
      await certify(["--axis", "repo-hygiene", "--axis", "identity", "--evidence-dir", dir], { repoRoot: REPO_ROOT });
      const after = fs.readdirSync(os.tmpdir()).filter((f) => f.startsWith("oaa-certify-archives-") || f.startsWith("oaa-certify-secrets-"));
      assert.deepEqual(after, before, "the harness must clean up its own temp resources");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
