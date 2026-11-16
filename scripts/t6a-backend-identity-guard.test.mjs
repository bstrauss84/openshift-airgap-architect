/**
 * Tranche 6A §6 — the E2E harness must refuse to certify the wrong build.
 *
 * Finding F4: Tranche 6 ran the version-awareness suite against a container
 * built from old `main` (version 2.0.0, buildTime 2026-10-06, supported minors
 * [4.20, 4.21]) and could not tell, because `global-setup.js` only checked
 * `/api/health`. The 4.20/4.21 assertions passed against the pre-flip build,
 * so the run looked healthy while certifying nothing about this worktree.
 *
 * These tests use the ACTUAL stale identity observed in Tranche 6 as a fixture,
 * so the guard is proven against the real failure rather than a hypothetical.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import {
  compareIdentity,
  expectedVersion,
  expectedSupportedMinors,
  expectedGitSha,
  probeSupportedMinors,
  assertBackendMatchesWorktree,
} from "../e2e/helpers/backend-identity.mjs";

const REPO = path.resolve(import.meta.dirname, "..");

/** Exactly what the stale container reported during Tranche 6. */
const STALE_CONTAINER = {
  version: "2.0.0",
  gitSha: "unknown",
  buildTime: "2026-10-06T21:06:53Z",
  repo: "bstrauss84/openshift-airgap-architect",
  branch: "main",
};
const STALE_SUPPORTED = ["4.20", "4.21"];

const WORKTREE = () => ({
  version: expectedVersion(),
  supportedMinors: expectedSupportedMinors(),
  gitSha: expectedGitSha(),
});

describe("T6A §6 — expectations are derived from the worktree, never hardcoded", () => {
  test("the expected version comes from backend/package.json", () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(REPO, "backend", "package.json"), "utf8"));
    assert.equal(expectedVersion(), pkg.version);
  });

  test("the expected supported minors come from the backend's own SUPPORTED_MINORS", () => {
    assert.deepEqual(expectedSupportedMinors(), ["4.20", "4.21", "4.22"]);
  });

  test("the expected revision is read from git, not written down", () => {
    const sha = expectedGitSha();
    assert.ok(sha === null || /^[0-9a-f]{40}$/.test(sha), `unexpected sha: ${sha}`);
  });

  test("no commit SHA is hardcoded in the guard's source", () => {
    const src = fs.readFileSync(path.join(REPO, "e2e", "helpers", "backend-identity.mjs"), "utf8");
    assert.doesNotMatch(src, /\b[0-9a-f]{40}\b/, "a pinned SHA would go stale on the next commit");
  });
});

describe("T6A §6 — the guard REFUSES the build that actually fooled Tranche 6", () => {
  const result = compareIdentity({
    buildInfo: STALE_CONTAINER,
    supportedMinors: STALE_SUPPORTED,
    expected: WORKTREE(),
  });

  test("it is rejected", () => {
    assert.equal(result.ok, false);
  });

  test("it names the stale version identity", () => {
    assert.ok(result.problems.some((p) => /version mismatch/.test(p)), result.problems.join("; "));
    assert.ok(result.problems.some((p) => p.includes("2.0.0")));
  });

  test("it names the wrong supported-minor set", () => {
    const p = result.problems.find((x) => /supported-minor mismatch/.test(x));
    assert.ok(p, result.problems.join("; "));
    assert.ok(p.includes("4.20,4.21"), p);
    assert.ok(p.includes("4.20,4.21,4.22"), p);
  });
});

describe("T6A §6 — each failure mode is detected independently", () => {
  test("stale version alone is refused", () => {
    const r = compareIdentity({
      buildInfo: { ...STALE_CONTAINER, version: "2.0.0" },
      supportedMinors: expectedSupportedMinors(),
      expected: WORKTREE(),
    });
    assert.equal(r.ok, false);
    assert.ok(r.problems.some((p) => /version mismatch/.test(p)));
  });

  test("wrong supported-minor set alone is refused", () => {
    const r = compareIdentity({
      buildInfo: { ...STALE_CONTAINER, version: expectedVersion() },
      supportedMinors: ["4.20", "4.21"],
      expected: WORKTREE(),
    });
    assert.equal(r.ok, false);
    assert.ok(r.problems.some((p) => /supported-minor mismatch/.test(p)));
  });

  test("a supported set that is a SUPERSET is still refused", () => {
    const r = compareIdentity({
      buildInfo: { ...STALE_CONTAINER, version: expectedVersion() },
      supportedMinors: ["4.20", "4.21", "4.22", "4.23"],
      expected: WORKTREE(),
    });
    assert.equal(r.ok, false);
  });

  test("wrong source revision is refused when the backend reports one", () => {
    const r = compareIdentity({
      buildInfo: { ...STALE_CONTAINER, version: expectedVersion(), gitSha: "a".repeat(40) },
      supportedMinors: expectedSupportedMinors(),
      expected: { ...WORKTREE(), gitSha: "b".repeat(40) },
    });
    assert.equal(r.ok, false);
    assert.ok(r.problems.some((p) => /source revision mismatch/.test(p)));
  });

  test('gitSha "unknown" is not treated as a mismatch — a dev server reports that', () => {
    const r = compareIdentity({
      buildInfo: { ...STALE_CONTAINER, version: expectedVersion(), gitSha: "unknown" },
      supportedMinors: expectedSupportedMinors(),
      expected: WORKTREE(),
    });
    assert.equal(r.ok, true, r.problems.join("; "));
    assert.ok(!r.checked.includes("gitSha"), "an unknown SHA must be skipped, not compared");
  });
});

describe("T6A §6 — the guard ACCEPTS a matching build, so it is not vacuous", () => {
  test("a backend reporting this worktree's identity passes", () => {
    const r = compareIdentity({
      buildInfo: { version: expectedVersion(), gitSha: "unknown", branch: "main" },
      supportedMinors: expectedSupportedMinors(),
      expected: WORKTREE(),
    });
    assert.equal(r.ok, true, r.problems.join("; "));
    assert.ok(r.checked.includes("version"));
    assert.ok(r.checked.includes("supportedMinors"));
  });

  test("a matching gitSha passes and IS compared", () => {
    const sha = "c".repeat(40);
    const r = compareIdentity({
      buildInfo: { version: expectedVersion(), gitSha: sha },
      supportedMinors: expectedSupportedMinors(),
      expected: { ...WORKTREE(), gitSha: sha },
    });
    assert.equal(r.ok, true);
    assert.ok(r.checked.includes("gitSha"));
  });
});

describe("T6A §6 — the supported-minor probe is behavioural and side-effect free", () => {
  test("it reads supportedVersions from a refusal, and persists nothing", async () => {
    const calls = [];
    const fakeFetch = async (url, opts) => {
      calls.push({ url, method: opts?.method, body: JSON.parse(opts?.body ?? "{}") });
      return { status: 422, json: async () => ({ code: "UNSUPPORTED_VERSION", supportedVersions: ["4.20", "4.21", "4.22"] }) };
    };
    const got = await probeSupportedMinors("http://backend.test", fakeFetch);
    assert.deepEqual(got, ["4.20", "4.21", "4.22"]);

    assert.equal(calls.length, 1);
    assert.match(calls[0].url, /\/api\/generate$/, "the probe must not write state");
    assert.equal(calls[0].method, "POST");
    assert.ok(calls[0].body.state, "the state is supplied inline, not persisted first");
    assert.equal(calls[0].body.state.version.selectedMinor, "4.99");
  });

  test("a backend that cannot report supportedVersions is refused, not assumed good", async () => {
    const fakeFetch = async () => ({ status: 500, json: async () => ({ error: "boom" }) });
    await assert.rejects(
      () => probeSupportedMinors("http://backend.test", fakeFetch),
      /cannot be identified, so it must not be certified/
    );
  });
});

describe("T6A §6 — assertBackendMatchesWorktree throws with an actionable message", () => {
  test("the stale container produces a refusal naming both mismatches", async () => {
    const fakeFetch = async (url, opts) => {
      if (String(url).endsWith("/api/build-info")) {
        return { status: 200, json: async () => STALE_CONTAINER };
      }
      return { status: 422, json: async () => ({ supportedVersions: STALE_SUPPORTED }) };
    };
    await assert.rejects(
      () => assertBackendMatchesWorktree("http://stale.test", fakeFetch),
      (err) => {
        assert.match(err.message, /REFUSING TO CERTIFY/);
        assert.match(err.message, /version mismatch/);
        assert.match(err.message, /supported-minor mismatch/);
        assert.match(err.message, /Liveness is not identity/);
        return true;
      }
    );
  });

  test("a matching backend resolves and reports what it verified", async () => {
    const fakeFetch = async (url) => {
      if (String(url).endsWith("/api/build-info")) {
        return { status: 200, json: async () => ({ version: expectedVersion(), gitSha: "unknown" }) };
      }
      return { status: 422, json: async () => ({ supportedVersions: expectedSupportedMinors() }) };
    };
    const r = await assertBackendMatchesWorktree("http://good.test", fakeFetch);
    assert.deepEqual(r.supportedMinors, expectedSupportedMinors());
    assert.ok(r.checked.includes("supportedMinors"));
  });
});

describe("T6A §6 — global-setup actually calls the guard", () => {
  test("it is wired in, not merely available", () => {
    const src = fs.readFileSync(path.join(REPO, "e2e", "global-setup.mjs"), "utf8");
    // Invoked as a child process: Playwright transpiles files under e2e/, and
    // the helper must stay plain Node ESM so this suite can import it directly.
    assert.match(src, /backend-identity\.mjs/);
    assert.match(src, /execFileSync/);
    // A failed identity check must abort the run, not warn and continue.
    assert.match(src, /throw new Error/);
  });

  test("playwright.config points at the ESM global setup that runs the guard", () => {
    const cfg = fs.readFileSync(path.join(REPO, "playwright.config.js"), "utf8");
    assert.match(cfg, /globalSetup:\s*['"]\.\/e2e\/global-setup\.mjs['"]/);
  });

  test("the helper exposes a CLI entry for that invocation", () => {
    const src = fs.readFileSync(path.join(REPO, "e2e", "helpers", "backend-identity.mjs"), "utf8");
    assert.match(src, /process\.argv\[1\]/);
    assert.match(src, /process\.exit\(1\)/, "a refusal must exit non-zero");
  });

  test("the api helper's backend URL is overridable too", () => {
    // Same stale-target hazard: a hardcoded URL pins the suite to whatever is
    // listening on 4000, which in Tranche 6 was the stale container.
    const src = fs.readFileSync(path.join(REPO, "e2e", "helpers", "api.js"), "utf8");
    assert.match(src, /process\.env\.(OAA_BROWSER_BACKEND_URL|E2E_BACKEND_URL)/);
  });

  test("the backend URL is overridable, so an isolated worktree server can be targeted", () => {
    const src = fs.readFileSync(path.join(REPO, "e2e", "global-setup.mjs"), "utf8");
    assert.match(src, /E2E_BACKEND_URL/);
  });
});
