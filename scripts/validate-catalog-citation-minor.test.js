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

const { auditCitationMinors, citationMinorSignals } = require("./validate-catalog-citation-minor.js");

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
      assert.match(r.stdout, /1 citation\(s\) carry another minor's provenance/);
      assert.match(r.stdout, /--report MODE \(exit 0\)/);
      assert.match(r.stdout, /CI enforces --strict/, "report mode must not read as the enforced path");
    });

    test("--strict detects the same drift and exits 1", () => {
      const r = cli(["--strict", "--root", driftedFixture()]);
      assert.strictEqual(r.status, 1);
      assert.match(r.stdout, /1 citation\(s\) carry another minor's provenance/);
      assert.match(r.stderr, /FAIL \(--strict\)/);
      assert.match(r.stderr, /blind string replacement is NOT acceptable/);
    });

    test("both modes exit 0 on clean data — strict is not failing for its own sake", () => {
      const clean = fixture({ "4.21": { "a.json": [paramWith([docUrl("4.21")])] } });
      assert.strictEqual(cli(["--report", "--root", clean]).status, 0);
      const strict = cli(["--strict", "--root", clean]);
      assert.strictEqual(strict.status, 0);
      assert.match(strict.stdout, /All citations carry only their own minor's provenance/);
    });

    test("fails closed when data/params is absent", () => {
      const empty = fs.mkdtempSync(path.join(os.tmpdir(), "oaa-cite-empty-"));
      const r = cli(["--report", "--root", empty]);
      assert.strictEqual(r.status, 1);
      assert.match(r.stderr, /Canonical params directory not found/);
    });
  });

  describe("(7) every structurally identifiable cross-minor class", () => {
    const sig = (c) => citationMinorSignals(c).map((s) => `${s.signal}:${s.minor}`).sort();

    test("current docs.redhat.com documentation URL", () => {
      assert.deepStrictEqual(
        sig({ url: "https://docs.redhat.com/en/documentation/openshift_container_platform/4.20/html/x/y" }),
        ["doc-url:4.20"]
      );
    });

    test("retired docs.openshift.com documentation URL", () => {
      assert.deepStrictEqual(
        sig({ url: "https://docs.openshift.com/container-platform/4.20/installing/x.html" }),
        ["legacy-doc-url:4.20"]
      );
    });

    test("openshift/installer release branch permalink", () => {
      assert.deepStrictEqual(
        sig({ url: "https://github.com/openshift/installer/blob/release-4.20/pkg/types/installconfig.go" }),
        ["installer-branch:4.20"]
      );
    });

    test("minor-labelled installer source citation title", () => {
      assert.deepStrictEqual(sig({ docTitle: "OpenShift Installer 4.20 Source Code" }), ["installer-title:4.20"]);
    });

    test("a single citation can declare several signals at once", () => {
      assert.deepStrictEqual(
        sig({
          docTitle: "OpenShift Installer 4.20 Source Code",
          url: "https://github.com/openshift/installer/blob/release-4.20/pkg/types/installconfig.go",
        }),
        ["installer-branch:4.20", "installer-title:4.20"]
      );
    });

    test("a wrong-minor installer permalink is detected in a catalog", () => {
      const root = fixture({
        "4.21": {
          "a.json": [
            {
              path: "x",
              citations: [
                {
                  docId: "installer-source-code",
                  docTitle: "OpenShift Installer 4.20 Source Code",
                  sectionHeading: "pkg/types/installconfig.go - Platform.AWS",
                  url: "https://github.com/openshift/installer/blob/release-4.20/pkg/types/installconfig.go",
                },
              ],
            },
          ],
        },
      });
      const { findings } = auditCitationMinors({ root });
      assert.strictEqual(findings.length, 2, "branch and title are both defects");
      assert.ok(findings.every((f) => f.urlMinor === "4.20"));
    });
  });

  describe("(8) precision — the guard is not 'any 4.xx is drift'", () => {
    const none = (c) => assert.deepStrictEqual(citationMinorSignals(c), [], JSON.stringify(c));

    test("an unversioned external schema reference carries no minor", () => {
      none({ docTitle: "NMState state examples", url: "https://nmstate.io/examples.html" });
    });

    test("a version number in prose is not provenance", () => {
      none({ docTitle: "Upgrading from 4.20 to 4.21", url: "https://example.com/guide" });
    });

    test("an installer permalink pinned to a SHA rather than a release branch is not judged", () => {
      none({ url: "https://github.com/openshift/installer/blob/1accb6487cf3784561665c08048dde20ad672c39/pkg/types/installconfig.go" });
    });

    test("a non-installer GitHub release-4.20 path is not judged", () => {
      none({ url: "https://github.com/someone/other-repo/blob/release-4.20/file.go" });
    });

    test("a CIDR or port that happens to look like a minor is not judged", () => {
      none({ docTitle: "Networking", url: "https://example.com/10.4.20/ports/4.21" });
    });

    test("a differently-worded installer title is not matched", () => {
      none({ docTitle: "Notes about OpenShift Installer 4.20 Source Code and more" });
    });
  });

  describe("live repository (read-only)", () => {
    test("4.20 carries no foreign provenance at all", () => {
      const { findings, scanned } = auditCitationMinors({ root: REPO_ROOT });
      assert.deepStrictEqual(scanned.minors, ["4.20", "4.21"]);
      assert.strictEqual(
        findings.filter((f) => f.minor === "4.20").length,
        0,
        "data/params/4.20/** must carry only 4.20 provenance"
      );
    });

    test("no catalog carries another minor's provenance", () => {
      const { findings } = auditCitationMinors({ root: REPO_ROOT });
      assert.deepStrictEqual(
        findings,
        [],
        "Tranche 0B repaired all 939 cross-minor references; strict is enforced in CI"
      );
    });

    test("report mode exits 0", () => {
      assert.strictEqual(cli(["--report"]).status, 0);
    });

    test("strict mode exits 0 — with no suppression list in the guard", () => {
      assert.strictEqual(cli(["--strict"]).status, 0, "strict passes because the data is correct");
      // Structural, not textual: the guard's own comments legitimately say
      // that no suppression list exists, which a substring scan would flag.
      const code = fs
        .readFileSync(SCRIPT, "utf-8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/^\s*\/\/.*$/gm, "");
      const declaration = /\b(?:const|let|var)\s+\w*(?:suppress|allowlist|whitelist|ignorelist|exception|waiver)\w*/i;
      assert.ok(
        !declaration.test(code),
        "the guard must not declare a suppression/allowlist structure"
      );
    });
  });
});
