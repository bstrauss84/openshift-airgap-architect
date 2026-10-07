"use strict";

/**
 * Tests for the catalog citation minor guard.
 *
 * Proves the six properties the guard must have:
 *   1. a same-minor OCP citation is accepted;
 *   2. a wrong-minor OCP citation is detected;
 *   3. the known 4.20/4.21 debt is REPORTED without failing the tooling job;
 *   4. an explicit enforcement mode exits nonzero on the same condition;
 *   5. the report/strict distinction is explicit, with no permissive default;
 *   6. URLs that are not versioned OCP documentation are never classified as
 *      wrong-minor merely for lacking a /4.xx/ segment.
 *
 * Hermetic: fixture trees under os.tmpdir(), plus one read-only pass over the
 * real repository. No network — the guard compares URL text only.
 */

const { test, describe } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const { auditCitationMinors } = require("./validate-catalog-citation-minor.js");

const SCRIPT = path.join(__dirname, "validate-catalog-citation-minor.js");
const REPO_ROOT = path.join(__dirname, "..");

function docUrl(minor, slug = "installing_on_vsphere/installation-config-parameters-vsphere") {
  return `https://docs.redhat.com/en/documentation/openshift_container_platform/${minor}/html/${slug}`;
}

/** Build a fixture repo containing data/params/<minor>/<scenario>.json. */
function fixture(byMinor) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "oaa-cite-"));
  for (const [minor, files] of Object.entries(byMinor)) {
    const dir = path.join(root, "data", "params", minor);
    fs.mkdirSync(dir, { recursive: true });
    for (const [name, params] of Object.entries(files)) {
      fs.writeFileSync(
        path.join(dir, name),
        JSON.stringify({ version: minor, scenarioId: name.replace(/\.json$/, ""), parameters: params }, null, 2),
        "utf-8"
      );
    }
  }
  return root;
}

const paramWith = (urls) => ({
  path: "baseDomain",
  citations: urls.map((u, i) => ({ docId: `d${i}`, docTitle: "T", sectionHeading: "S", url: u })),
});

function cli(args) {
  return spawnSync(process.execPath, [SCRIPT, ...args], { encoding: "utf-8" });
}

describe("catalog citation minor guard", () => {
  describe("(1) same-minor citations are accepted", () => {
    test("a 4.21 catalog citing 4.21 docs produces no findings", () => {
      const root = fixture({ "4.21": { "vsphere-ipi.json": [paramWith([docUrl("4.21")])] } });
      const { findings, scanned } = auditCitationMinors({ root });
      assert.deepStrictEqual(findings, []);
      assert.strictEqual(scanned.citations, 1);
      assert.deepStrictEqual(scanned.minors, ["4.21"]);
    });

    test("multiple minors each citing themselves produce no findings", () => {
      const root = fixture({
        "4.20": { "a.json": [paramWith([docUrl("4.20")])] },
        "4.21": { "a.json": [paramWith([docUrl("4.21")])] },
      });
      const { findings } = auditCitationMinors({ root });
      assert.deepStrictEqual(findings, []);
    });

    test("a future minor citing itself is accepted (no hardcoded minor set)", () => {
      const root = fixture({ "4.22": { "a.json": [paramWith([docUrl("4.22")])] } });
      assert.deepStrictEqual(auditCitationMinors({ root }).findings, []);
    });
  });

  describe("(2) wrong-minor citations are detected", () => {
    test("a 4.21 catalog citing 4.20 docs is flagged", () => {
      const root = fixture({ "4.21": { "vsphere-ipi.json": [paramWith([docUrl("4.20")])] } });
      const { findings } = auditCitationMinors({ root });
      assert.strictEqual(findings.length, 1);
      assert.strictEqual(findings[0].kind, "wrong-minor");
      assert.strictEqual(findings[0].minor, "4.21");
      assert.strictEqual(findings[0].urlMinor, "4.20");
      assert.strictEqual(findings[0].path, "baseDomain");
    });

    test("a newer-minor citation in an older catalog is equally flagged", () => {
      // Drift is not only backwards; cross-minor backfill goes both ways.
      const root = fixture({ "4.20": { "a.json": [paramWith([docUrl("4.22")])] } });
      const { findings } = auditCitationMinors({ root });
      assert.strictEqual(findings.length, 1);
      assert.strictEqual(findings[0].urlMinor, "4.22");
    });

    test("each offending citation is reported separately", () => {
      const root = fixture({
        "4.21": { "a.json": [paramWith([docUrl("4.20"), docUrl("4.21"), docUrl("4.19")])] },
      });
      const { findings } = auditCitationMinors({ root });
      assert.strictEqual(findings.length, 2);
      assert.deepStrictEqual(findings.map((f) => f.urlMinor).sort(), ["4.19", "4.20"]);
    });

    test("--minor narrows the scan", () => {
      const root = fixture({
        "4.20": { "a.json": [paramWith([docUrl("4.19")])] },
        "4.21": { "a.json": [paramWith([docUrl("4.20")])] },
      });
      const only = auditCitationMinors({ root, onlyMinor: "4.21" });
      assert.strictEqual(only.findings.length, 1);
      assert.deepStrictEqual(only.scanned.minors, ["4.21"]);
    });
  });

  describe("(6) non-versioned / non-OCP URLs are never false positives", () => {
    const benign = [
      "https://kubernetes.io/docs/concepts/services-networking/service/",
      "https://docs.redhat.com/en/documentation/red_hat_openshift_data_foundation/4.18/html/planning/index",
      "https://access.redhat.com/solutions/1234567",
      "https://github.com/openshift/installer/blob/master/docs/user/customization.md",
      "https://docs.openshift.com/container-platform/latest/welcome/index.html",
      "https://www.rfc-editor.org/rfc/rfc1918",
      "https://docs.redhat.com/en/documentation/openshift_container_platform/latest/html/index",
      "https://example.com/path/4.20/not-ocp-docs",
    ];

    for (const url of benign) {
      test(`ignores ${url.slice(0, 62)}...`, () => {
        const root = fixture({ "4.21": { "a.json": [paramWith([url])] } });
        const { findings, scanned } = auditCitationMinors({ root });
        assert.deepStrictEqual(
          findings,
          [],
          "absence of an openshift_container_platform/<minor> segment is not drift"
        );
        assert.strictEqual(scanned.citations, 1, "the URL is still counted as scanned");
      });
    }

    test("an ODF doc URL with its own 4.x version is not judged against the OCP minor", () => {
      // ODF versions independently of OCP; only the OCP doc segment is in scope.
      const root = fixture({
        "4.21": { "a.json": [paramWith(["https://docs.redhat.com/en/documentation/red_hat_openshift_data_foundation/4.22/html/planning/index"])] },
      });
      assert.deepStrictEqual(auditCitationMinors({ root }).findings, []);
    });

    test("a benign URL alongside a genuine violation does not mask it", () => {
      const root = fixture({
        "4.21": { "a.json": [paramWith(["https://kubernetes.io/docs/", docUrl("4.20")])] },
      });
      const { findings } = auditCitationMinors({ root });
      assert.strictEqual(findings.length, 1);
      assert.strictEqual(findings[0].urlMinor, "4.20");
    });

    test("parameters with no citations array are skipped without error", () => {
      const root = fixture({ "4.21": { "a.json": [{ path: "x" }] } });
      const { findings, scanned } = auditCitationMinors({ root });
      assert.deepStrictEqual(findings, []);
      assert.strictEqual(scanned.citations, 0);
    });
  });

  describe("(5) mode is explicit — no permissive default", () => {
    test("omitting a mode exits 2 and explains", () => {
      const root = fixture({ "4.21": { "a.json": [paramWith([docUrl("4.21")])] } });
      const r = cli(["--root", root]);
      assert.strictEqual(r.status, 2, "a missing mode must not resolve to the permissive one");
      assert.match(r.stderr, /a mode is required/);
      assert.match(r.stderr, /--report/);
      assert.match(r.stderr, /--strict/);
    });

    test("passing both modes exits 2", () => {
      const root = fixture({ "4.21": { "a.json": [paramWith([docUrl("4.21")])] } });
      const r = cli(["--report", "--strict", "--root", root]);
      assert.strictEqual(r.status, 2);
      assert.match(r.stderr, /mutually exclusive/);
    });
  });

  describe("(3)(4) report vs strict on the same condition", () => {
    function driftedFixture() {
      return fixture({ "4.21": { "a.json": [paramWith([docUrl("4.20")])] } });
    }

    test("--report detects the drift but exits 0", () => {
      const r = cli(["--report", "--root", driftedFixture()]);
      assert.strictEqual(r.status, 0, "report mode must not fail the tooling job");
      assert.match(r.stdout, /1 citation URL\(s\) reference the wrong minor/);
      assert.match(r.stdout, /--report MODE \(exit 0\)/);
      assert.match(r.stdout, /check:citation-minor:strict/, "must name the 0B cutover action");
    });

    test("--strict detects the same drift and exits 1", () => {
      const r = cli(["--strict", "--root", driftedFixture()]);
      assert.strictEqual(r.status, 1);
      assert.match(r.stdout, /1 citation URL\(s\) reference the wrong minor/);
      assert.match(r.stderr, /FAIL \(--strict\)/);
      assert.match(r.stderr, /blind string replacement is NOT acceptable/);
    });

    test("both modes exit 0 on clean data — strict is not failing for its own sake", () => {
      const clean = fixture({ "4.21": { "a.json": [paramWith([docUrl("4.21")])] } });
      assert.strictEqual(cli(["--report", "--root", clean]).status, 0);
      const strict = cli(["--strict", "--root", clean]);
      assert.strictEqual(strict.status, 0);
      assert.match(strict.stdout, /All citation URLs reference their own minor/);
    });

    test("fails closed when data/params is absent", () => {
      const empty = fs.mkdtempSync(path.join(os.tmpdir(), "oaa-cite-empty-"));
      const r = cli(["--report", "--root", empty]);
      assert.strictEqual(r.status, 1);
      assert.match(r.stderr, /Canonical params directory not found/);
    });
  });

  describe("live repository (read-only)", () => {
    test("reports exactly the known 0B debt: 810 in 4.21, 0 in 4.20", () => {
      const { findings, scanned } = auditCitationMinors({ root: REPO_ROOT });
      const byMinor = findings.reduce((acc, f) => {
        acc[f.minor] = (acc[f.minor] || 0) + 1;
        return acc;
      }, {});
      assert.deepStrictEqual(scanned.minors, ["4.20", "4.21"]);
      assert.strictEqual(byMinor["4.20"] ?? 0, 0, "4.20 cites its own minor correctly");
      assert.strictEqual(byMinor["4.21"] ?? 0, 810, "the known 0B citation debt");
      assert.ok(findings.every((f) => f.urlMinor === "4.20"), "all 4.21 drift points at 4.20");
    });

    test("report mode keeps the tooling job green against that debt", () => {
      assert.strictEqual(cli(["--report"]).status, 0);
    });

    test("strict mode would fail today, which is why 0B owns the cutover", () => {
      assert.strictEqual(cli(["--strict"]).status, 1);
    });
  });
});
