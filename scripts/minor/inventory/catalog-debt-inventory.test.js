"use strict";

/**
 * Tests for the catalog debt inventory.
 *
 * Fixtures are built in a temporary directory, so the test asserts behaviour
 * against real files without depending on the repository's own catalog content
 * (which Tranche 0B is actively changing) or on any local documentation assets.
 *
 * No network access.
 */

const { test, describe, before, after } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  inventoryMinor,
  citationShape,
  citationMinorSignals,
  isProductDocCitation,
  normalizeHeadingTitle,
  locateHeading,
  bookSlugFromUrl,
  bookSlugFromFilename,
  TYPE_ALIASES,
} = require("./catalog-debt-inventory.js");

const DOC_CITATION = Object.freeze({
  docId: "installation-config-parameters-agent",
  docTitle: "Installation configuration parameters for the Agent-based Installer",
  sectionHeading: "9.1.3. Optional configuration parameters",
  url: "https://docs.redhat.com/en/documentation/openshift_container_platform/4.21/html/installing_an_on-premise_cluster_with_the_agent-based_installer/installation-config-parameters-agent",
});

function param(overrides = {}) {
  return {
    path: "baseDomain",
    outputFile: "install-config.yaml",
    type: "string",
    allowed: "not specified in docs",
    default: "not specified in docs",
    required: true,
    description: "Base DNS domain.",
    applies_to: ["agent"],
    citations: [{ ...DOC_CITATION }],
    supportStatus: "supported-ui",
    minVersion: "4.20",
    maxVersion: null,
    ...overrides,
  };
}

let root;

function writeCatalog(minor, scenarioId, parameters) {
  const dir = path.join(root, "data", "params", minor);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, `${scenarioId}.json`),
    JSON.stringify({ version: minor, scenarioId, parameters }, null, 1)
  );
}

function writeEvidence(evidenceRoot, minor, bookSuffix, lines) {
  const dir = path.join(evidenceRoot, `ocp-${minor}`, "docs", "extracted");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, `OpenShift_Container_Platform-${minor}-${bookSuffix}-en-US.txt`),
    lines.join("\n")
  );
}

before(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "oaa-inv-"));
});

after(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe("citation shape classification", () => {
  test("a complete schema citation is 'schema'", () => {
    assert.strictEqual(citationShape(DOC_CITATION), "schema");
  });

  test("the legacy {source,url,note} provenance form is recognised, not merely 'incomplete'", () => {
    assert.strictEqual(
      citationShape({ source: "installer_source", url: "github.com/openshift/installer", note: "Go struct" }),
      "legacy-provenance"
    );
  });

  test("a blank string does not satisfy a required sub-field", () => {
    assert.strictEqual(citationShape({ ...DOC_CITATION, docTitle: "   " }), "incomplete");
  });
});

describe("cross-minor signal detection", () => {
  test("a docs.redhat.com URL for another minor is detected and is guard-visible", () => {
    const [sig] = citationMinorSignals({
      url: "https://docs.redhat.com/en/documentation/openshift_container_platform/4.20/html/x/y",
    });
    assert.strictEqual(sig.signal, "doc-url");
    assert.strictEqual(sig.minor, "4.20");
    assert.strictEqual(sig.guardVisible, true);
  });

  test("the retired docs.openshift.com host carries a minor the citation guard cannot see", () => {
    const [sig] = citationMinorSignals({
      url: "https://docs.openshift.com/container-platform/4.20/installing/x.html",
    });
    assert.strictEqual(sig.signal, "doc-url");
    assert.strictEqual(sig.minor, "4.20");
    assert.strictEqual(
      sig.guardVisible,
      false,
      "this host is why the guard's 810 understates the real cross-minor debt"
    );
  });

  test("an installer source permalink carries the release branch minor", () => {
    const signals = citationMinorSignals({
      docTitle: "OpenShift Installer 4.20 Source Code",
      url: "https://github.com/openshift/installer/blob/release-4.20/pkg/types/installconfig.go",
    });
    assert.deepStrictEqual(
      signals.map((s) => [s.signal, s.minor, s.guardVisible]).sort(),
      [
        ["doc-title", "4.20", false],
        ["installer-branch", "4.20", false],
      ].sort()
    );
  });

  test("a citation with no minor anywhere produces no signal", () => {
    assert.deepStrictEqual(citationMinorSignals({ url: "https://nmstate.io/examples.html" }), []);
  });
});

describe("documentation-citation scoping", () => {
  test("installer source and NMState citations are not product documentation", () => {
    assert.strictEqual(
      isProductDocCitation({ url: "https://github.com/openshift/installer/blob/release-4.21/x.go" }),
      false
    );
    assert.strictEqual(isProductDocCitation({ url: "https://nmstate.io/examples.html" }), false);
  });

  test("both Red Hat documentation hosts count as product documentation", () => {
    assert.strictEqual(isProductDocCitation({ url: "https://docs.redhat.com/en/x" }), true);
    assert.strictEqual(isProductDocCitation({ url: "https://docs.openshift.com/container-platform/4.20/x" }), true);
  });
});

describe("heading location against same-minor evidence", () => {
  const AGENT_URL =
    "https://docs.redhat.com/en/documentation/openshift_container_platform/4.21/html/agent/installation-config-parameters-agent";
  const DISCONNECTED_URL =
    "https://docs.redhat.com/en/documentation/openshift_container_platform/4.21/html/disconnected_environments/oc-mirror-v2";

  const evidence = {
    available: true,
    books: {
      "OpenShift_Container_Platform-4.21-agent-en-US.txt": [
        "9.1.3. Optional configuration parameters",
        "1.4.2. About root device hints",
      ].join("\n"),
      "OpenShift_Container_Platform-4.21-disconnected_environments-en-US.txt": [
        "   Table 5.3. ImageSetConfiguration parameters",
      ].join("\n"),
    },
  };

  test("a heading at the cited number is exact", () => {
    assert.strictEqual(
      locateHeading(evidence, "9.1.3. Optional configuration parameters", AGENT_URL).status,
      "exact"
    );
  });

  test("a heading whose title exists under a different number is 'renumbered', not 'absent'", () => {
    const got = locateHeading(evidence, "1.5.2. About root device hints", AGENT_URL);
    assert.strictEqual(got.status, "renumbered");
    assert.deepStrictEqual(got.found, ["agent: 1.4.2. About root device hints"]);
  });

  test("a heading that exists nowhere in the cited book is 'absent'", () => {
    assert.strictEqual(
      locateHeading(evidence, "9.1.4. VMware vSphere cluster parameters", AGENT_URL).status,
      "absent"
    );
  });

  test("with no evidence the status is 'unknown' — never guessed as absent", () => {
    assert.strictEqual(
      locateHeading({ available: false, books: {} }, "9.1.3. Optional configuration parameters", AGENT_URL).status,
      "unknown"
    );
  });

  test("section numbers are ignored when matching titles", () => {
    assert.strictEqual(
      normalizeHeadingTitle("9.1.3. Optional configuration parameters"),
      "optional configuration parameters"
    );
  });

  // --- false-positive classes the checker must not manufacture -------------

  test("a heading is judged ONLY against the book its URL addresses", () => {
    // The title exists in the agent book. Citing it from the disconnected book
    // is still a defect there, and must not be excused by the other book.
    const got = locateHeading(evidence, "1.4.2. About root device hints", DISCONNECTED_URL);
    assert.strictEqual(got.status, "absent");
  });

  test("a book absent from the evidence set is 'unknown', never a finding", () => {
    const got = locateHeading(
      evidence,
      "1.11.2. Configuring the cluster-wide proxy during installation",
      "https://docs.redhat.com/en/documentation/openshift_container_platform/4.21/html/installing_on_any_platform/installing-platform-agnostic"
    );
    assert.strictEqual(got.status, "unknown");
    assert.match(got.reason, /not in the extracted evidence set/);
  });

  test("a URL addressing no book at all is 'unknown', never a finding", () => {
    const got = locateHeading(
      evidence,
      "OCP 4.20 installation configuration docs, networking section",
      "https://docs.redhat.com/en/documentation/openshift_container_platform/4.20/"
    );
    assert.strictEqual(got.status, "unknown");
    assert.match(got.reason, /no specific documentation book/);
  });

  test("a numbered table caption is a valid cited heading, not missing debt", () => {
    const got = locateHeading(evidence, "Table 5.3. ImageSetConfiguration parameters", DISCONNECTED_URL);
    assert.strictEqual(
      got.status,
      "exact",
      "the parameter tables are what a citation sends a reader to; the caption form is correct"
    );
  });

  test("a renumbered table caption is still detected", () => {
    const got = locateHeading(evidence, "Table 7.1. ImageSetConfiguration parameters", DISCONNECTED_URL);
    assert.strictEqual(got.status, "renumbered");
    assert.deepStrictEqual(got.found, ["disconnected_environments: Table 5.3. ImageSetConfiguration parameters"]);
  });

  test("book slugs resolve from both documentation hosts and from filenames", () => {
    assert.strictEqual(bookSlugFromUrl(AGENT_URL), "agent");
    assert.strictEqual(
      bookSlugFromUrl("https://docs.openshift.com/container-platform/4.20/installing/installing_vsphere/x.html"),
      "installing"
    );
    assert.strictEqual(bookSlugFromUrl("https://docs.redhat.com/en/documentation/openshift_container_platform/4.20/"), null);
    assert.strictEqual(
      bookSlugFromFilename("OpenShift_Container_Platform-4.21-Installing_on_VMware_vSphere-en-US.txt"),
      "installing_on_vmware_vsphere"
    );
  });
});

describe("inventoryMinor over canonical catalogs", () => {
  test("reports missing required fields, type aliases and legacy citations together", () => {
    writeCatalog("4.21", "demo", [
      param(),
      param({ path: "controlPlane.replicas", type: "int" }),
      param({
        path: "platform.baremetal.libvirtURI",
        outputFile: undefined,
        applies_to: undefined,
        allowed: undefined,
        citations: [{ source: "installer_source", url: "github.com/openshift/installer/x.go", note: "Go struct" }],
      }),
    ]);

    const result = inventoryMinor({ root, minor: "4.21", evidenceRoot: null });
    const kinds = result.rows.map((r) => `${r.klass}:${r.field}`);

    assert.ok(kinds.includes("field:outputFile"), "missing outputFile must be reported");
    assert.ok(kinds.includes("field:applies_to"), "missing applies_to must be reported");
    assert.ok(kinds.includes("field:allowed"), "missing allowed must be reported");
    assert.ok(kinds.includes("type-alias:type"), "the `int` alias must be reported");

    const alias = result.rows.find((r) => r.klass === "type-alias");
    assert.strictEqual(alias.proposedValue, TYPE_ALIASES.int);
    assert.strictEqual(alias.repairClass, "metadata-only");
    assert.strictEqual(alias.confidence, "PROVEN");

    const legacy = result.rows.find((r) => r.klass === "citation" && /shape/.test(r.failure));
    assert.ok(legacy, "a legacy-provenance citation must be reported");
    assert.match(legacy.failure, /legacy-provenance/);
  });

  test("a clean catalog for its own minor produces no rows", () => {
    writeCatalog("4.22", "clean", [
      param({
        citations: [
          {
            ...DOC_CITATION,
            url: DOC_CITATION.url.replace("/4.21/", "/4.22/"),
          },
        ],
      }),
    ]);
    const result = inventoryMinor({ root, minor: "4.22", evidenceRoot: null });
    assert.deepStrictEqual(result.rows, []);
  });

  test("cross-minor citations are found even when the citation guard cannot see them", () => {
    writeCatalog("4.23", "hidden", [
      param({
        citations: [
          {
            docId: "installer-source-code",
            docTitle: "OpenShift Installer 4.20 Source Code",
            sectionHeading: "pkg/types/installconfig.go - Platform.AWS",
            url: "https://github.com/openshift/installer/blob/release-4.20/pkg/types/installconfig.go",
          },
        ],
      }),
    ]);
    const result = inventoryMinor({ root, minor: "4.23", evidenceRoot: null });
    const signals = result.rows.filter((r) => /cross-minor/.test(r.failure));

    assert.strictEqual(signals.length, 2, "both the branch and the title carry 4.20");
    assert.ok(
      signals.every((r) => r.guardVisible === false),
      "neither signal is visible to validate-catalog-citation-minor.js"
    );
  });

  test("the installer-source heading is NOT checked against documentation text", () => {
    const evidenceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "oaa-ev-"));
    writeEvidence(evidenceRoot, "4.24", "Agent", ["9.1.1. Required configuration parameters"]);
    writeCatalog("4.24", "src", [
      param({
        citations: [
          {
            docId: "installer-source-code",
            docTitle: "OpenShift Installer 4.24 Source Code",
            sectionHeading: "pkg/types/installconfig.go - Platform.AWS",
            url: "https://github.com/openshift/installer/blob/release-4.24/pkg/types/installconfig.go",
          },
        ],
      }),
    ]);
    const result = inventoryMinor({ root, minor: "4.24", evidenceRoot });
    fs.rmSync(evidenceRoot, { recursive: true, force: true });

    assert.deepStrictEqual(
      result.rows.filter((r) => /sectionHeading/.test(r.field)),
      [],
      "a Go symbol is a correct heading for a source citation and must not be hunted for in the docs"
    );
  });

  test("an unknown minor directory fails closed rather than reporting success", () => {
    assert.throws(() => inventoryMinor({ root, minor: "9.99", evidenceRoot: null }), /not found/);
  });
});
