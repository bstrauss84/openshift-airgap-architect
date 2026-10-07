"use strict";

/**
 * Fixture tests for the bounded catalog repair engine.
 *
 * Every case is built in a temporary directory, so the suite asserts the
 * engine's behaviour rather than the current contents of data/params/** (which
 * Tranche 0B is changing). No network, no dependency on local-docs.
 *
 * The emphasis is on what the engine must REFUSE to do: invent a citation,
 * touch an H3 row, cross a minor boundary, or empty a citations array.
 */

const { test, describe, before, after } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { repairCitation, repairParameter, repairMinor, orderKeys, CANONICAL_KEY_ORDER } = require("./apply-catalog-repairs.js");
const R = require("./proven-repairs.js");

const ctx420 = { minor: "4.20", scenarioId: "vsphere-upi", paramPath: "controlPlane.platform" };
const ctx421 = { minor: "4.21", scenarioId: "vsphere-upi", paramPath: "controlPlane.platform" };

let root;
before(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "oaa-repair-"));
});
after(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

function writeCatalog(minor, scenarioId, parameters) {
  const dir = path.join(root, "data", "params", minor);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, `${scenarioId}.json`),
    `${JSON.stringify({ version: minor, scenarioId, parameters }, null, 2)}\n`
  );
}

describe("the H3 freeze mechanism", () => {
  // H3_CITATIONS is empty after 0B. The mechanism is still the thing that
  // stops the next minor's unplaceable citations from being guessed, so it is
  // tested against a synthetic entry rather than against live data.
  const SYNTHETIC = { docId: "some-doc", sectionHeading: "A heading no authority places" };

  test("a registered citation is matched on docId AND heading together", () => {
    const citation = { ...SYNTHETIC, docTitle: "whatever", url: "https://example.com/x" };
    assert.strictEqual(R.isH3Citation(citation, [SYNTHETIC]), true);
    assert.strictEqual(R.isH3Citation(citation, []), false, "an empty register freezes nothing");
    assert.strictEqual(
      R.isH3Citation({ ...citation, docId: "other-doc" }, [SYNTHETIC]),
      false,
      "the same heading under a different docId is NOT frozen"
    );
    assert.strictEqual(
      R.isH3Citation({ ...citation, sectionHeading: "Other" }, [SYNTHETIC]),
      false
    );
  });

  test("the register is empty after 0B — nothing is suppressed", () => {
    assert.deepStrictEqual(
      R.H3_CITATIONS,
      [],
      "strict passes because the data is correct, not because rows are excused"
    );
  });

  test("freezing is keyed on docId AND heading, not the heading alone", () => {
    // The proxy heading is also used by 48 correct citations against a
    // different docId. Those must still be repaired.
    const correct = {
      docId: "installing-platform-agnostic",
      docTitle: "Installing a cluster (platform-agnostic)",
      sectionHeading: "1.11.2. Configuring the cluster-wide proxy during installation",
      url: "https://docs.redhat.com/en/documentation/openshift_container_platform/4.20/html/installing_on_any_platform/installing-platform-agnostic",
    };
    const r = repairCitation(correct, ctx421);
    assert.strictEqual(r.frozen, false);
    assert.ok(r.change, "a correct citation sharing an H3 heading must still be minor-aligned");
    assert.match(r.citation.url, /\/4\.21\//);
  });
});

describe("documentation URL minor alignment", () => {
  test("a proven 4.21 target is swapped and the fragment preserved", () => {
    const r = repairCitation(
      {
        docId: "installing-bare-metal-agent",
        docTitle: "Installing an on-premise cluster with the Agent-based Installer",
        sectionHeading: "1.5.2. About root device hints",
        url: "https://docs.redhat.com/en/documentation/openshift_container_platform/4.20/html/installing_an_on-premise_cluster_with_the_agent-based_installer/preparing-to-install-with-agent-based-installer#root-device-hints_preparing-to-install-with-agent-based-installer",
      },
      ctx421
    );
    assert.match(r.citation.url, /\/4\.21\//);
    assert.match(r.citation.url, /#root-device-hints_preparing-to-install-with-agent-based-installer$/);
    assert.strictEqual(
      r.citation.sectionHeading,
      "1.4.2. About root device hints",
      "chapter 1 was renumbered at 4.21; the URL alone is not the repair"
    );
  });

  test("an UNPROVEN target is refused, not swapped", () => {
    const citation = {
      docId: "whatever",
      docTitle: "Whatever",
      sectionHeading: "Some section",
      url: "https://docs.redhat.com/en/documentation/openshift_container_platform/4.20/html/some_unverified_book/some-page",
    };
    const r = repairCitation(citation, ctx421);
    assert.strictEqual(r.change, null);
    assert.ok(r.unmatched, "an unverified target must be reported");
    assert.deepStrictEqual(r.citation, citation);
  });

  test("a 4.20 citation in a 4.20 catalog is left alone", () => {
    const citation = {
      docId: "installation-config-parameters-agent",
      docTitle: "Installation configuration parameters for the Agent-based Installer",
      sectionHeading: "9.1.3. Optional configuration parameters",
      url: "https://docs.redhat.com/en/documentation/openshift_container_platform/4.20/html/installing_an_on-premise_cluster_with_the_agent-based_installer/installation-config-parameters-agent",
    };
    const r = repairCitation(citation, ctx420);
    assert.strictEqual(r.change, null);
    assert.deepStrictEqual(r.citation, citation);
  });
});

describe("installer-source citations", () => {
  test("a wrong file is corrected and the branch and title aligned to the row's own minor", () => {
    const r = repairCitation(
      {
        docId: "installer-source-code",
        docTitle: "OpenShift Installer 4.20 Source Code",
        sectionHeading: "pkg/types/installconfig.go - MachinePoolPlatform.VSphere",
        url: "https://github.com/openshift/installer/blob/release-4.20/pkg/types/installconfig.go",
      },
      ctx421
    );
    assert.strictEqual(r.citation.sectionHeading, "pkg/types/machinepools.go - MachinePoolPlatform.VSphere");
    assert.strictEqual(r.citation.url, "https://github.com/openshift/installer/blob/release-4.21/pkg/types/machinepools.go");
    assert.strictEqual(r.citation.docTitle, "OpenShift Installer 4.21 Source Code");
  });

  test("the same citation in a 4.20 catalog is corrected but stays on release-4.20", () => {
    const r = repairCitation(
      {
        docId: "installer-source-code",
        docTitle: "OpenShift Installer 4.20 Source Code",
        sectionHeading: "pkg/types/installconfig.go - MachinePoolPlatform.VSphere",
        url: "https://github.com/openshift/installer/blob/release-4.20/pkg/types/installconfig.go",
      },
      ctx420
    );
    assert.match(r.citation.url, /release-4\.20/, "a 4.20 row must never be pointed at release-4.21");
    assert.strictEqual(r.citation.docTitle, "OpenShift Installer 4.20 Source Code");
  });

  test("an already-correct installer citation produces no change", () => {
    const citation = {
      docId: "installer-source-code",
      docTitle: "OpenShift Installer 4.20 Source Code",
      sectionHeading: "pkg/types/aws/platform.go - Subnet.ID",
      url: "https://github.com/openshift/installer/blob/release-4.20/pkg/types/aws/platform.go",
    };
    const r = repairCitation(citation, ctx420);
    assert.strictEqual(r.change, null);
  });
});

describe("legacy provenance citations", () => {
  test("a mapped legacy installer URL is normalized onto the schema shape", () => {
    const r = repairCitation(
      {
        source: "installer_source",
        url: "github.com/openshift/installer/pkg/types/installconfig.go ControlPlane.Platform",
        note: "Go struct definition",
      },
      ctx420
    );
    assert.strictEqual(r.citation.docId, "installer-source-code");
    assert.strictEqual(r.citation.sectionHeading, "pkg/types/machinepools.go - MachinePool.Platform");
    assert.ok(!("source" in r.citation) && !("note" in r.citation));
  });

  test("a 4.21-only legacy URL is NOT mapped in a 4.20 catalog", () => {
    const citation = {
      source: "installer_source",
      url: "github.com/openshift/installer release-4.21 pkg/types/azure/platform.go Subnets",
      note: "Added in 4.21",
    };
    const r = repairCitation(citation, ctx420);
    assert.ok(r.unmatched, "4.21 evidence must never be applied to a 4.20 row");
    assert.deepStrictEqual(r.citation, citation);
  });

  test("an unknown legacy URL is reported, never guessed", () => {
    const citation = { source: "installer_source", url: "github.com/openshift/installer/pkg/types/made_up.go Nope", note: "x" };
    const r = repairCitation(citation, ctx420);
    assert.ok(r.unmatched);
    assert.match(r.unmatched.detail, /no approved mapping/);
  });

  test("internal analysis provenance is removed", () => {
    const r = repairCitation(
      { source: "delta_analysis", url: "local-docs/ocp-4.21/analysis/delta-installer-params.json", note: "x" },
      ctx421
    );
    assert.strictEqual(r.citation, null);
    assert.strictEqual(r.change.rule, "internal-analysis-removed");
  });

  test("an unknown legacy source is reported, not dropped", () => {
    const citation = { source: "some_new_source", url: "x", note: "y" };
    const r = repairCitation(citation, ctx420);
    assert.ok(r.unmatched);
    assert.deepStrictEqual(r.citation, citation, "an unrecognised source must survive untouched");
  });
});

describe("ocp_docs stubs", () => {
  test("a documented parameter gets a real same-minor documentation citation", () => {
    const r = repairCitation({ source: "ocp_docs", note: "OpenShift 4.20 install-config reference" }, {
      minor: "4.20",
      scenarioId: "nutanix-ipi",
      paramPath: "controlPlane.replicas",
    });
    assert.strictEqual(r.citation.docId, "installation-config-parameters-nutanix");
    assert.strictEqual(r.citation.sectionHeading, "7.1.3. Optional configuration parameters");
    assert.match(r.citation.url, /\/4\.20\/.*installation-config-parameters-nutanix$/);
  });

  test("the same stub in a 4.21 catalog points at the 4.21 page", () => {
    const r = repairCitation({ source: "ocp_docs", note: "x" }, {
      minor: "4.21",
      scenarioId: "nutanix-ipi",
      paramPath: "controlPlane.replicas",
    });
    assert.match(r.citation.url, /\/4\.21\//);
  });

  test("an undocumented parameter loses the stub rather than gaining an invented citation", () => {
    const r = repairCitation({ source: "ocp_docs", note: "x" }, {
      minor: "4.20",
      scenarioId: "bare-metal-ipi",
      paramPath: "platform.baremetal.libvirtURI",
    });
    assert.strictEqual(r.citation, null);
    assert.strictEqual(r.change.rule, "ocp-docs-stub-removed");
  });
});

describe("parameter-level repairs", () => {
  test("type aliases normalize and are classified metadata-only", () => {
    const { param, changes } = repairParameter(
      { path: "x", type: "int", citations: [] },
      { minor: "4.20", scenarioId: "vsphere-upi" }
    );
    assert.strictEqual(param.type, "integer");
    assert.strictEqual(changes[0].kind, "metadata");
  });

  test("a null default normalizes to the sentinel", () => {
    const { param } = repairParameter(
      { path: "x", type: "string", default: null, citations: [] },
      { minor: "4.21", scenarioId: "vsphere-upi" }
    );
    assert.strictEqual(param.default, R.NOT_SPECIFIED);
  });

  test("field fills use the scenario's own id and are classified behaviour-affecting", () => {
    const { param, changes } = repairParameter(
      { path: "controlPlane.platform", type: "object", required: false, citations: [] },
      { minor: "4.20", scenarioId: "nutanix-ipi" }
    );
    assert.strictEqual(param.outputFile, "install-config.yaml");
    assert.deepStrictEqual(param.applies_to, ["nutanix-ipi"]);
    assert.strictEqual(param.allowed, "MachinePoolPlatform object");
    assert.strictEqual(param.default, R.NOT_SPECIFIED);
    assert.ok(changes.filter((c) => c.rule === "field-fill").every((c) => c.kind === "behaviour"));
  });

  test("an installer default is used where the defaults package sets one", () => {
    const { param } = repairParameter(
      { path: "platform.baremetal.externalBridge", type: "string", required: false, citations: [] },
      { minor: "4.20", scenarioId: "bare-metal-ipi" }
    );
    assert.strictEqual(param.default, "baremetal");
  });

  test("a missing field with no approved fill is reported, not invented", () => {
    const { param, unmatched } = repairParameter(
      { path: "some.unknown.path", type: "string", required: false, citations: [] },
      { minor: "4.20", scenarioId: "vsphere-upi" }
    );
    assert.ok(unmatched.length);
    assert.strictEqual(param.outputFile, undefined);
  });

  test("a repair that would empty the citations array is refused", () => {
    const { param, unmatched } = repairParameter(
      {
        path: "x",
        type: "string",
        outputFile: "install-config.yaml",
        allowed: "a",
        default: "b",
        required: false,
        applies_to: ["vsphere-upi"],
        citations: [{ source: "delta_analysis", url: "local-docs/x.json", note: "y" }],
      },
      { minor: "4.21", scenarioId: "vsphere-upi" }
    );
    assert.strictEqual(param.citations.length, 1, "the only citation must survive");
    assert.ok(unmatched.some((u) => /empty/.test(u.detail)));
  });

  test("repaired rows are emitted in the catalogs' canonical key order", () => {
    const { param } = repairParameter(
      { citations: [], required: false, type: "int", path: "controlPlane.platform" },
      { minor: "4.20", scenarioId: "nutanix-ipi" }
    );
    const keys = Object.keys(param);
    const expected = CANONICAL_KEY_ORDER.filter((k) => keys.includes(k));
    assert.deepStrictEqual(keys, expected);
  });

  test("orderKeys never drops an unrecognised key", () => {
    const out = orderKeys({ zzCustom: 1, path: "p" });
    assert.strictEqual(out.zzCustom, 1);
    assert.strictEqual(Object.keys(out)[0], "path");
  });
});

describe("minor isolation and scope", () => {
  test("repairMinor reads and writes only the named minor", () => {
    writeCatalog("4.20", "iso", [{ path: "x", type: "int", citations: [] }]);
    writeCatalog("4.21", "iso", [{ path: "x", type: "bool", citations: [] }]);

    const r = repairMinor({ root, minor: "4.20" });
    assert.ok(r.changes.every((c) => c.minor === "4.20"));
    assert.ok(r.files.every((f) => f.path.startsWith("data/params/4.20/")));
  });

  test("an absent minor directory fails closed", () => {
    assert.throws(() => repairMinor({ root, minor: "9.99" }), /not found/);
  });

  test("a clean catalog yields no changes and no files to write", () => {
    writeCatalog("4.22", "clean", [
      {
        path: "baseDomain",
        outputFile: "install-config.yaml",
        type: "string",
        allowed: R.NOT_SPECIFIED,
        default: R.NOT_SPECIFIED,
        required: true,
        description: "d",
        applies_to: ["clean"],
        citations: [
          {
            docId: "installation-config-parameters-agent",
            docTitle: "Installation configuration parameters for the Agent-based Installer",
            sectionHeading: "9.1.1. Required configuration parameters",
            url: "https://docs.redhat.com/en/documentation/openshift_container_platform/4.22/html/x/y",
          },
        ],
        supportStatus: "supported-ui",
        minVersion: "4.20",
        maxVersion: null,
      },
    ]);
    const r = repairMinor({ root, minor: "4.22" });
    assert.deepStrictEqual(r.changes, []);
    assert.deepStrictEqual(r.files, []);
  });
});
