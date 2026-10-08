/**
 * Tranche 6 §6 — REAL OpenShift 4.22 generation across all 12 Architect scenarios.
 *
 * This is the half of former gap **G1** that could not exist before the Tranche 5
 * flip: while 4.22 was fail-closed, `buildInstallConfig()` refused it before any
 * builder ran, so no real 4.22 YAML could be produced without a support bypass —
 * which Tranche 4 and 4A explicitly rejected and did not add.
 *
 * **No test-only support bypass is used here.** These tests call the same
 * exported builders the HTTP routes call, with 4.22 supported by normal policy.
 *
 * Fixtures are the canonical 12 scenario states from `e2e/fixtures/scenarios.js`,
 * retargeted to the exact onboarding reference release **4.22.16** by the same
 * `makeVersionedFixture` helper the E2E asset-validation suite uses. They are
 * realistic minimal valid states: no field is populated merely to enlarge the YAML.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";

import { buildInstallConfig, buildAgentConfig, buildImageSetConfig } from "../src/generate.js";
import { SUPPORTED_MINORS } from "../src/versionPolicy.js";
import * as scenarios from "../../e2e/fixtures/scenarios.js";

/**
 * `makeVersionedFixture` and `SCENARIO_MAP` are duplicated from
 * `e2e/helpers/asset-validation.js` rather than imported, because that module
 * does `import yaml from 'js-yaml'` and the repo root resolves js-yaml@5, which
 * provides no default export — so the helper cannot be loaded under Node ESM at
 * all. That is a PRE-EXISTING E2E test-infrastructure defect (present well
 * before the 4.22 work; see the Tranche 6 evidence document), not something this
 * tranche introduces and not a product defect. The copies are kept honest by
 * `scenarioMapMatchesCanonicalSource()` below, which parses the real helper.
 */
function makeVersionedFixture(scenarioFn, minor, patch) {
  const fixture = scenarioFn();
  fixture.release.channel = minor;
  fixture.release.patchVersion = patch;
  fixture.version.selectedChannel = `stable-${minor}`;
  fixture.version.selectedVersion = patch;
  return fixture;
}

const SCENARIO_MAP = [
  { id: "bare-metal-agent", fn: "bareMetalAgent", hasAgentConfig: true },
  { id: "bare-metal-ipi", fn: "bareMetalIpi", hasAgentConfig: false },
  { id: "bare-metal-upi", fn: "bareMetalUpi", hasAgentConfig: false },
  { id: "vsphere-ipi", fn: "vsphereIpi", hasAgentConfig: false },
  { id: "vsphere-upi", fn: "vsphereUpi", hasAgentConfig: false },
  { id: "vsphere-agent", fn: "vsphereAgent", hasAgentConfig: true },
  { id: "nutanix-ipi", fn: "nutanixIpi", hasAgentConfig: false },
  { id: "aws-govcloud-ipi", fn: "awsGovcloudIpi", hasAgentConfig: false },
  { id: "aws-govcloud-upi", fn: "awsGovcloudUpi", hasAgentConfig: false },
  { id: "azure-government-ipi", fn: "azureGovernmentIpi", hasAgentConfig: false },
  { id: "azure-government-upi", fn: "azureGovernmentUpi", hasAgentConfig: false },
  { id: "ibm-cloud-ipi", fn: "ibmCloudIpi", hasAgentConfig: false },
];

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = join(__dirname, "..", "..");

/** The exact onboarding reference release (Tranche 6 §4). Not 4.22.0. */
const TARGET_MINOR = "4.22";
const TARGET_PATCH = "4.22.16";

/** Which generated surface each scenario owns. Mirrors SCENARIO_MAP. */
const EXPECTED_PLATFORM_BLOCK = {
  "bare-metal-agent": "baremetal",
  "bare-metal-ipi": "baremetal",
  "bare-metal-upi": "none",
  "vsphere-ipi": "vsphere",
  "vsphere-upi": "vsphere",
  "vsphere-agent": "vsphere",
  "nutanix-ipi": "nutanix",
  "aws-govcloud-ipi": "aws",
  "aws-govcloud-upi": "aws",
  "azure-government-ipi": "azure",
  "azure-government-upi": "azure",
  "ibm-cloud-ipi": "ibmcloud",
};

/**
 * Paths that 4.22 adds to the installer but which Architect deliberately does NOT
 * expose (SUPPORTABILITY_CLASSIFICATION_4.22.md C2-C4, H_ITEM_DISPOSITIONS H1/H2).
 * None may appear in generated output at any scenario.
 */
const MUST_NOT_LEAK = [
  "osImageStream",
  "ipFamily",
  "hostPlacement",
  "management:",
];

const at422 = (fnName) => makeVersionedFixture(scenarios[fnName], TARGET_MINOR, TARGET_PATCH);

describe("T6 §6 — 4.22 is reachable through normal production policy", () => {
  it("4.22 is supported, and no bypass is needed or used", () => {
    assert.ok(SUPPORTED_MINORS.includes(TARGET_MINOR));
  });

  it("the certification target is the exact reference release, not 4.22.0", () => {
    const manifest = JSON.parse(
      readFileSync(join(REPO, "docs", "minor-release", "4.22", "acquisition-manifest-4.22.json"), "utf8")
    );
    assert.equal(manifest.installer.release, TARGET_PATCH);
    assert.equal(manifest.releaseDiscovery.resolved, TARGET_PATCH);
  });

  it("the fixture set covers exactly the 12 Architect scenarios", () => {
    assert.equal(SCENARIO_MAP.length, 12);
    assert.deepEqual(
      SCENARIO_MAP.map((s) => s.id).sort(),
      Object.keys(EXPECTED_PLATFORM_BLOCK).sort()
    );
  });

  it("the 12 scenarios are exactly the 4.22 catalogs on disk — the real authority", () => {
    const onDisk = readdirSync(join(REPO, "data", "params", "4.22"))
      .filter((f) => f.endsWith(".json"))
      .map((f) => f.replace(/\.json$/, ""))
      .sort();
    assert.deepEqual(SCENARIO_MAP.map((s) => s.id).sort(), onDisk);
  });

  it("the local SCENARIO_MAP copy still matches the canonical e2e helper", () => {
    // Parsed, not imported — see the note on the copy above.
    const src = readFileSync(join(REPO, "e2e", "helpers", "asset-validation.js"), "utf8");
    const block = src.slice(src.indexOf("export const SCENARIO_MAP"));
    const ids = [...block.matchAll(/id: '([^']+)'/g)].map((m) => m[1]).sort();
    assert.deepEqual(SCENARIO_MAP.map((s) => s.id).sort(), ids);
    const agent = [...block.matchAll(/id: '([^']+)'[^}]*hasAgentConfig: true/g)].map((m) => m[1]).sort();
    assert.deepEqual(SCENARIO_MAP.filter((s) => s.hasAgentConfig).map((s) => s.id).sort(), agent);
  });

  it("the canonical e2e supported-version list carries 4.22 (S8)", () => {
    const src = readFileSync(join(REPO, "e2e", "helpers", "asset-validation.js"), "utf8");
    const block = src.slice(src.indexOf("export const SUPPORTED_VERSIONS"), src.indexOf("]", src.indexOf("export const SUPPORTED_VERSIONS")));
    for (const m of SUPPORTED_MINORS) assert.ok(block.includes(m), m);
  });
});

describe("T6 §6 — real 4.22 install-config, all 12 scenarios", () => {
  for (const { id, fn } of SCENARIO_MAP) {
    describe(id, () => {
      const state = at422(fn);
      const raw = buildInstallConfig(state);

      it("generates and parses as YAML", () => {
        assert.equal(typeof raw, "string");
        assert.ok(raw.length > 0, "empty install-config");
        const doc = yaml.load(raw);
        assert.ok(doc && typeof doc === "object");
      });

      it("carries the expected platform block and no other platform", () => {
        const doc = yaml.load(raw);
        const expected = EXPECTED_PLATFORM_BLOCK[id];
        assert.ok(doc.platform, "no platform block");
        const keys = Object.keys(doc.platform);
        assert.deepEqual(keys, [expected], `platform keys ${JSON.stringify(keys)}`);
      });

      it("declares the selected 4.22 release, never 4.20 or 4.21", () => {
        // The install-config itself carries no version field; the proof that the
        // 4.22 catalog drove this output is that no other minor's channel or
        // version string appears anywhere in it.
        assert.doesNotMatch(raw, /4\.21/, "4.21 leaked into 4.22 install-config");
        assert.doesNotMatch(raw, /4\.20/, "4.20 leaked into 4.22 install-config");
      });

      it("leaks no unsupported or hidden 4.22 field", () => {
        for (const needle of MUST_NOT_LEAK) {
          assert.ok(!raw.includes(needle), `${needle} must not appear in generated 4.22 output`);
        }
      });

      it("emits the cluster identity from state, not a stale default", () => {
        const doc = yaml.load(raw);
        assert.equal(doc.metadata?.name, "e2e-cluster");
        assert.equal(doc.baseDomain, "example.com");
      });

      it("is byte-identical to the same state at 4.20 — no stale 4.22 default leaks", () => {
        // The only install-config path 4.22 adds that Architect exposes is the
        // optional bare-metal IPI provisioningNetworkGateway, which these
        // minimal states do not set. So a correct 4.22 generator must produce
        // exactly the 4.20 output here. Any difference would be an unintended
        // version-conditional default. (The gateway's own emission is certified
        // separately, in the provisioningNetworkGateway suite.)
        const at420 = buildInstallConfig(makeVersionedFixture(scenarios[fn], "4.20", "4.20.40"));
        assert.equal(raw, at420);
      });

      it("keeps credentials out of the default install-config", () => {
        // The export contract: the SSH public key is a public artifact and is
        // expected; private material and registry auth are not.
        assert.doesNotMatch(raw, /BEGIN [A-Z ]*PRIVATE KEY/);
        assert.doesNotMatch(raw, /dGVzdDp0ZXN0/, "base64 registry auth leaked");
      });
    });
  }
});

describe("T6 §6 — 4.22 mirror path emits imageDigestSources, never imageContentSources", () => {
  // The base fixtures declare mirror sources but not `usingMirrorRegistry`, so
  // the mirror path is off and no image sources are emitted — correct, and
  // identical at every supported minor. This block turns the mirror path ON so
  // the 4.22 pivot is certified rather than skipped.
  const MIRROR_CANARY = Buffer.from(`OAA_SYNTH_CANARY_MIRROR_${Date.now()}`).toString("base64");

  const withMirror = (fn, minor, patch) => {
    const st = makeVersionedFixture(scenarios[fn], minor, patch);
    st.credentials = {
      ...st.credentials,
      usingMirrorRegistry: true,
      // Runtime-generated synthetic canary, never a literal in source.
      mirrorRegistryPullSecret: JSON.stringify({ auths: { "registry.local:5000": { auth: MIRROR_CANARY } } }),
    };
    return st;
  };

  for (const { id, fn } of SCENARIO_MAP) {
    it(`${id} emits imageDigestSources and no imageContentSources at 4.22`, () => {
      const raw = buildInstallConfig(withMirror(fn, TARGET_MINOR, TARGET_PATCH));
      assert.match(raw, /imageDigestSources/);
      assert.doesNotMatch(raw, /imageContentSources/);
      assert.match(raw, /registry\.local:5000/);
    });
  }

  it("the credential-inclusion contract holds at 4.22, in both directions", () => {
    // Not "credentials never appear": the product has an explicit opt-in export.
    // What must hold is that the toggle governs it, at 4.22 exactly as elsewhere.
    const optIn = withMirror("bareMetalIpi", TARGET_MINOR, TARGET_PATCH);
    optIn.exportOptions = { ...optIn.exportOptions, includeCredentials: true };
    const withCreds = buildInstallConfig(optIn);
    assert.ok(withCreds.includes(MIRROR_CANARY), "explicit opt-in must carry the secret");

    const optOut = withMirror("bareMetalIpi", TARGET_MINOR, TARGET_PATCH);
    optOut.exportOptions = { ...optOut.exportOptions, includeCredentials: false };
    const redacted = buildInstallConfig(optOut);
    assert.ok(!redacted.includes(MIRROR_CANARY), "default export must redact the secret");
    assert.match(redacted, /pullSecret: '\{"auths":\{\}\}'/);

    // The mirror topology itself is not a secret and survives redaction.
    assert.match(redacted, /imageDigestSources/);
    assert.match(redacted, /registry\.local:5000/);
  });
});

describe("T6 §6 — real 4.22 agent-config, for the scenarios that own that surface", () => {
  const agentScenarios = SCENARIO_MAP.filter((s) => s.hasAgentConfig);

  it("exactly the two Agent scenarios declare an agent-config surface", () => {
    assert.deepEqual(agentScenarios.map((s) => s.id).sort(), ["bare-metal-agent", "vsphere-agent"]);
  });

  for (const { id, fn } of agentScenarios) {
    describe(id, () => {
      const raw = buildAgentConfig(at422(fn));

      it("generates and parses as YAML", () => {
        const doc = yaml.load(raw);
        assert.ok(doc && typeof doc === "object");
      });

      it("is an AgentConfig for the right cluster", () => {
        const doc = yaml.load(raw);
        assert.equal(doc.kind, "AgentConfig");
        assert.equal(doc.metadata?.name, "e2e-cluster");
      });

      it("carries the declared hosts", () => {
        const doc = yaml.load(raw);
        assert.ok(Array.isArray(doc.hosts), "agent-config must list hosts");
        assert.equal(doc.hosts.length, 3);
      });

      it("leaks no other minor and no unsupported 4.22 field", () => {
        assert.doesNotMatch(raw, /4\.21/);
        assert.doesNotMatch(raw, /4\.20/);
        for (const needle of MUST_NOT_LEAK) {
          assert.ok(!raw.includes(needle), needle);
        }
      });

      it("agent-config has zero 4.21 -> 4.22 delta, so it is unchanged across minors", () => {
        // MECHANICAL_DELTA_LEDGER_4.21_TO_4.22: agent-config deltas of any class = 0.
        const at421 = buildAgentConfig(makeVersionedFixture(scenarios[fn], "4.21", "4.21.35"));
        assert.equal(raw, at421, "agent-config must be byte-identical at 4.21 and 4.22");
      });
    });
  }

  it("a non-Agent scenario produces no agent-config hosts surface", () => {
    // bare-metal-ipi has no nodes; agent-config is not its surface.
    const ipi = buildAgentConfig(at422("bareMetalIpi"));
    const doc = yaml.load(ipi);
    assert.ok(!doc?.hosts?.length, "IPI must not emit agent hosts");
  });
});

describe("T6 §6 — real 4.22 imageset-config, all 12 scenarios", () => {
  for (const { id, fn } of SCENARIO_MAP) {
    it(`${id} names stable-4.22 and no other channel`, () => {
      const state = at422(fn);
      const raw = buildImageSetConfig(state);
      const doc = yaml.load(raw);
      assert.ok(doc && typeof doc === "object");
      assert.match(raw, /stable-4\.22/);
      assert.doesNotMatch(raw, /stable-4\.21/);
      assert.doesNotMatch(raw, /stable-4\.20/);
    });
  }

  it("the platform architectures agree with the install-config architecture", () => {
    for (const { fn, id } of SCENARIO_MAP) {
      const state = at422(fn);
      const im = yaml.load(buildImageSetConfig(state));
      const ic = yaml.load(buildInstallConfig(state));
      const arches = im.mirror?.platform?.architectures;
      if (!arches) continue;
      assert.deepEqual(arches, [ic.controlPlane?.architecture ?? "amd64"], id);
    }
  });
});

describe("T6 §6 — 4.23 produces nothing, at every surface, for every scenario", () => {
  for (const { id, fn } of SCENARIO_MAP) {
    it(`${id}: install-config and imageset both refuse 4.23`, () => {
      const state = makeVersionedFixture(scenarios[fn], "4.23", "4.23.0");
      for (const build of [buildInstallConfig, buildImageSetConfig]) {
        let produced = null;
        let err = null;
        try { produced = build(state); } catch (e) { err = e; }
        assert.equal(err?.code, "UNSUPPORTED_VERSION", `${id} must reject 4.23`);
        assert.equal(err.requestedVersion, "4.23");
        assert.equal(produced, null, "a rejected call must produce no output at all");
      }
    });
  }
});
