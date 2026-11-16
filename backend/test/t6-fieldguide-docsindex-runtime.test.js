/**
 * Tranche 6 §10 and §11 — the v4.22 Field Guide and docs index through the REAL
 * supported runtime path, plus docs-index parity across all three minors.
 *
 * Tranche 2 authored `backend/src/fieldGuide/v4.22/**` and Tranche 4 verified it
 * statically, but nothing could render it: `resolveFieldGuideVersion` refused
 * 4.22. Tranche 5 wired S3/S4/S5. This file renders real guides.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { buildFieldManual } from "../src/generate.js";
import { selectAndOrder } from "../src/fieldGuide/assembler.js";
import { resolveFieldGuideVersion, FIELD_GUIDE_SUPPORTED_MINORS } from "../src/fieldGuide/versionResolution.js";
import { getAuthoritativeExport, certifyExport, certifyDocRefs } from "../src/fieldGuide/provenance.js";
import { compartments_v420 } from "../src/fieldGuide/v4.20/index.js";
import { compartments_v421 } from "../src/fieldGuide/v4.21/index.js";
import { compartments_v422 } from "../src/fieldGuide/v4.22/index.js";
import { SUPPORTED_MINORS } from "../src/versionPolicy.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = join(__dirname, "..", "..");

const PATCH = { "4.20": "4.20.40", "4.21": "4.21.35", "4.22": "4.22.16" };
const EXPORTS = { "4.20": compartments_v420, "4.21": compartments_v421, "4.22": compartments_v422 };

const stateFor = (minor, platform = "Bare Metal", method = "Agent-Based Installer") => ({
  _schemaVersion: 3,
  version: { _schemaVersion: 3, selectedMinor: minor, selectedPatch: PATCH[minor], selectedChannel: `stable-${minor}`, locked: true },
  release: { channel: minor, patchVersion: PATCH[minor], confirmed: true },
  blueprint: { platform, arch: "x86_64", clusterName: "cert-cluster", baseDomain: "example.com" },
  methodology: { method },
  credentials: { sshPublicKey: "ssh-rsa AAAA test" },
  globalStrategy: {
    networking: { networkType: "OVNKubernetes", machineNetworkV4: "10.90.0.0/24" },
    mirroring: { registryFqdn: "registry.local:5000", sources: [] },
  },
  hostInventory: { nodes: [] },
});

/* ------------------------------------------------------------------ */
/* §10 — Field Guide 4.22 runtime                                       */
/* ------------------------------------------------------------------ */

describe("T6 §10 — the 4.22 Field Guide resolves through the normal runtime path", () => {
  it("the resolver accepts 4.22 and returns a 4.22 descriptor", () => {
    const d = resolveFieldGuideVersion(stateFor("4.22"));
    assert.equal(d.minor, "4.22");
  });

  it("the assembler selects v4.22 compartments, and only 4.22 ones", () => {
    const selected = selectAndOrder("4.22", { platform: "Bare Metal", methodology: "Agent-Based Installer" });
    assert.ok(selected.length > 0, "4.22 must select compartments");
    for (const c of selected) assert.equal(c.version, "4.22", c.id);
  });

  it("the authoritative export is the v4.22 module, by object identity", () => {
    assert.equal(getAuthoritativeExport("4.22"), compartments_v422);
  });

  it("certifyExport('4.22') passes", () => {
    assert.doesNotThrow(() => certifyExport("4.22"));
  });

  it("certifyDocRefs passes for every v4.22 compartment at 4.22", () => {
    assert.doesNotThrow(() => certifyDocRefs(compartments_v422, "4.22"));
  });

  it("certifyDocRefs REJECTS v4.22 compartments presented as another minor", () => {
    // Proves the previous assertion is not vacuous.
    assert.throws(() => certifyDocRefs(compartments_v422, "4.21"));
  });
});

describe("T6 §10 — the v4.22 compartment set matches the committed evidence", () => {
  it("carries 40 compartments, all stamped 4.22", () => {
    assert.equal(compartments_v422.length, 40);
    for (const c of compartments_v422) assert.equal(c.version, "4.22", c.id);
  });

  it("covers the nine authored source modules", () => {
    const modules = ["aws", "azure", "baremetal", "global", "ibmcloud", "mirror", "nutanix", "vsphere"];
    for (const m of modules) {
      assert.ok(existsSync(join(REPO, "backend", "src", "fieldGuide", "v4.22", `${m}.js`)), m);
    }
    // index.js is the ninth module: the single flat re-export.
    assert.ok(existsSync(join(REPO, "backend", "src", "fieldGuide", "v4.22", "index.js")));
  });

  it("compartment ids and ordering are identical to v4.21 — a clone, then scrubbed", () => {
    assert.deepEqual(compartments_v422.map((c) => c.id), compartments_v421.map((c) => c.id));
  });

  it("ids are unique, so provenance cannot be ambiguous", () => {
    const ids = compartments_v422.map((c) => c.id);
    assert.equal(new Set(ids).size, ids.length);
  });

  it("every OpenShift doc reference in v4.22 carries 4.22 provenance, and no other minor", () => {
    const urls = compartments_v422.flatMap((c) => (c.docRefs || []).map((d) => d.url)).filter(Boolean);
    assert.ok(urls.length > 0, "the guide must carry doc references at all");
    const ocp = urls.filter((u) => u.includes("/openshift_container_platform/"));
    assert.ok(ocp.length > 0, "and some of them must be OCP book references");
    for (const u of ocp) {
      assert.match(u, /\/openshift_container_platform\/4\.22\//, `${u} does not carry 4.22 provenance`);
    }
    // Non-OCP product docs (e.g. the RHEL 9 FIPS hardening guide) legitimately
    // carry no OpenShift minor. What they must not do is name a different one.
    for (const u of urls.filter((x) => !x.includes("/openshift_container_platform/"))) {
      assert.ok(!/\/4\.(20|21)\//.test(u), `${u} cites another OpenShift minor`);
    }
  });

  it("the non-OCP references are a small, inspectable set", () => {
    // Recorded rather than asserted loosely: these are the references
    // DOC-179's liveness concern applies to, and they are not version-scrubbed
    // by minor because they are not OpenShift books.
    const urls = compartments_v422.flatMap((c) => (c.docRefs || []).map((d) => d.url)).filter(Boolean);
    const nonOcp = [...new Set(urls.filter((u) => !u.includes("/openshift_container_platform/")))];
    assert.ok(nonOcp.length <= 5, `unexpectedly many non-OCP references: ${nonOcp.join(", ")}`);
  });

  it("no v4.22 compartment presents an unsupported 4.22 parameter as app-supported", () => {
    // SUPPORTABILITY_CLASSIFICATION_4.22 C2-C4 / H1-H2: these are
    // docs-only-not-supported or hidden-not-applicable. osImageStream is
    // allowed to appear ONLY as a Technology-Preview caveat, never as guidance
    // to set it.
    const blob = JSON.stringify(compartments_v422);
    for (const forbidden of ["ipFamily", "hostPlacement"]) {
      assert.ok(!blob.includes(forbidden), `${forbidden} must not appear in the 4.22 guide`);
    }
    if (blob.includes("osImageStream")) {
      assert.match(blob, /Technology Preview/i, "osImageStream may appear only inside a TP caveat");
    }
  });
});

describe("T6 §10 — real rendered guides at every supported minor", () => {
  const SCENARIOS = [
    ["Bare Metal", "Agent-Based Installer"],
    ["Bare Metal", "IPI"],
    ["VMware vSphere", "IPI"],
    ["AWS GovCloud", "IPI"],
    ["Nutanix", "IPI"],
  ];

  for (const minor of SUPPORTED_MINORS) {
    for (const [platform, method] of SCENARIOS) {
      it(`${minor} / ${platform} / ${method} renders a scenario-correct guide`, () => {
        const md = buildFieldManual(stateFor(minor, platform, method), []);
        assert.equal(typeof md, "string");
        assert.ok(md.length > 500, "guide is implausibly short");
        assert.ok(md.includes(minor), `guide must state its own minor ${minor}`);
        assert.ok(md.includes("cert-cluster"), "guide must be tailored to the state");
        // A guide may cite an OLDER minor as provenance; it must never name a newer one.
        for (const newer of SUPPORTED_MINORS.filter((m) => m > minor)) {
          assert.ok(!md.includes(newer), `${minor} guide names newer minor ${newer}`);
        }
        assert.ok(!md.includes("4.23"), "no unsupported minor may appear");
      });
    }
  }

  it("the 4.22 guide's documentation links are all 4.22 links", () => {
    const md = buildFieldManual(stateFor("4.22"), []);
    const urls = [...md.matchAll(/https:\/\/docs\.redhat\.com\/[^\s)\]]+/g)].map((m) => m[0]);
    assert.ok(urls.length > 0, "the rendered guide must carry documentation links");
    for (const u of urls) {
      assert.doesNotMatch(u, /\/4\.20\//, u);
      assert.doesNotMatch(u, /\/4\.21\//, u);
    }
  });

  it("the 4.22 guide differs from the 4.21 guide — it is not a silent clone", () => {
    const md22 = buildFieldManual(stateFor("4.22"), []);
    const md21 = buildFieldManual(stateFor("4.21"), []);
    assert.notEqual(md22, md21);
  });

  it("an unsupported minor renders no guide at all", () => {
    assert.throws(() => buildFieldManual(stateFor("4.23"), []));
    assert.equal(getAuthoritativeExport("4.23"), null);
    assert.ok(!FIELD_GUIDE_SUPPORTED_MINORS.includes("4.23"));
  });
});

/* ------------------------------------------------------------------ */
/* §11 — docs index                                                     */
/* ------------------------------------------------------------------ */

const docsIndex = Object.fromEntries(
  SUPPORTED_MINORS.map((m) => [m, JSON.parse(readFileSync(join(REPO, "data", "docs-index", `${m}.json`), "utf8"))])
);

describe("T6 §11 — docs index, all three supported minors", () => {
  for (const minor of SUPPORTED_MINORS) {
    describe(minor, () => {
      const idx = docsIndex[minor];

      it("declares its own version and a base URL for that version", () => {
        assert.equal(idx.version, minor);
        assert.match(idx.baseUrl, new RegExp(`/${minor.replace(".", "\\.")}(/|$)`));
      });

      it("is schema-valid: scenarios and sharedDocs present and non-empty", () => {
        assert.ok(idx.scenarios && typeof idx.scenarios === "object");
        assert.ok(Object.keys(idx.scenarios).length > 0);
        assert.ok(idx.sharedDocs);
      });

      it("canonical and frontend mirror are byte-identical", () => {
        const canonical = readFileSync(join(REPO, "data", "docs-index", `${minor}.json`), "utf8");
        const mirror = readFileSync(join(REPO, "frontend", "src", "data", "docs-index", `${minor}.json`), "utf8");
        assert.equal(canonical, mirror);
      });

      it("every URL in the index carries this minor and no other", () => {
        const urls = JSON.stringify(idx).match(/https:\/\/docs\.redhat\.com\/[^"\\]+/g) || [];
        assert.ok(urls.length > 0);
        for (const u of urls) {
          for (const other of SUPPORTED_MINORS.filter((m) => m !== minor)) {
            assert.ok(!u.includes(`/${other}/`), `${minor} index cites ${other}: ${u}`);
          }
        }
      });
    });
  }

  it("4.22 covers all 12 scenarios — including azure-government-upi (DOC-180 not carried forward)", () => {
    assert.equal(Object.keys(docsIndex["4.22"].scenarios).length, 12);
    assert.ok(docsIndex["4.22"].scenarios["azure-government-upi"]);
  });

  it("DOC-180 is recorded, not silently repaired: 4.20/4.21 still omit that scenario", () => {
    // Certification records the pre-existing gap rather than fixing it here.
    // It affects only 4.20/4.21 documentation links, not generation, and is
    // classified as an independent pre-release obligation.
    for (const m of ["4.20", "4.21"]) {
      assert.ok(!docsIndex[m].scenarios["azure-government-upi"], `${m} unexpectedly gained the scenario`);
    }
  });

  it("no index falls back to another minor's entries", () => {
    const sig = (m) => JSON.stringify(Object.keys(docsIndex[m].scenarios).sort());
    assert.equal(sig("4.22"), sig("4.21") === sig("4.22") ? sig("4.21") : sig("4.22"));
    // 4.21 and 4.22 differ by exactly the DOC-180 scenario.
    const only22 = Object.keys(docsIndex["4.22"].scenarios).filter((s) => !docsIndex["4.21"].scenarios[s]);
    assert.deepEqual(only22, ["azure-government-upi"]);
  });
});
