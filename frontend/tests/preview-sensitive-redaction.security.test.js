/**
 * OpenShift Airgap Architect - Test Suite
 *
 * @author Bill Strauss
 *
 * Developed with AI assistance from Claude (Anthropic) and Cursor AI.
 */

/**
 * CANONICAL SECURITY AUTOMATION — YAML preview redaction.
 *
 * Tranche 7C.4 P0. With "Show sensitive values" OFF the preview collapsed to a
 * four-line fragment and displayed the user's real Red Hat pull secret inside
 * what looked like a comment. Two defects in `obfuscateYaml` combined:
 *
 *  1. The proxy-credential rule `/(https?:\/\/)[^:@]+:[^@]+@/gi` used negated
 *     character classes, which match newlines. It anchored on the `# https://`
 *     attribution comment that `buildInstallConfig` prepends to every document
 *     and consumed everything up to the first `@` anywhere downstream — which,
 *     for a Red Hat pull secret, is inside `"email":"user@domain"`. The whole
 *     body was deleted and the tail of the secret was spliced onto the
 *     surviving `# ` prefix.
 *  2. `yaml.dump(..., { lineWidth: 120 })` emits a long pull secret as a FOLDED
 *     block scalar (`pullSecret: >-`). `/pullSecret:\s*.+$/gm` matched only the
 *     `>-` line, so the credential on the continuation lines was never touched.
 *
 * Why no existing test caught it: every fixture in `yaml-obfuscation.test.js` is
 * a hand-written single-line string. None is `yaml.dump` output, so no block
 * scalar was ever exercised; none carries the attribution header, so the
 * cross-line collapse never fired.
 *
 * This suite therefore refuses hand-written YAML. It drives the REAL backend
 * generator over the REAL canonical scenario fixtures, so the documents under
 * test are byte-for-byte what the preview renders. Two properties are asserted
 * for every scenario:
 *
 *   SECURITY   — no sentinel credential survives anywhere in the OFF view.
 *   USABILITY  — the document is still a usable, complete YAML document.
 *
 * Both halves matter. Redacting by destroying the document would satisfy the
 * first and is exactly the regression being fixed.
 */
import { describe, it, expect } from "vitest";
/* The backend's own js-yaml (v4) is imported by path on purpose: a bare
   `js-yaml` specifier resolves to the repo root's v5, which ships no default
   export and no `load`. This is the same copy that produced the documents under
   test, so a parse here means the real preview document parses. */
import yaml from "../../backend/node_modules/js-yaml/index.js";
import { obfuscateYaml } from "../src/utils/yamlObfuscation.js";
import { buildInstallConfig, buildAgentConfig } from "../../backend/src/generate.js";
import * as scenarios from "../../e2e/fixtures/scenarios.js";

/**
 * One sentinel per credential class. Any appearance of any of these in a
 * sensitive-OFF render is a security failure, so they are deliberately
 * unmistakable and share a common prefix for a catch-all sweep.
 */
const SENTINEL = "OAA_TEST_SECRET_MUST_NEVER_RENDER";
const S = {
  redhatAuth: `${SENTINEL}_RH_AUTH`,
  quayAuth: `${SENTINEL}_QUAY_AUTH`,
  mirrorAuth: `${SENTINEL}_MIRROR_AUTH`,
  sshKey: `${SENTINEL}_SSH`,
  bmcPassword: `${SENTINEL}_BMC_PW`,
  bmcUsername: `${SENTINEL}_BMC_USER`,
  vcenterPassword: `${SENTINEL}_VCENTER_PW`,
  vcenterUser: `${SENTINEL}_VCENTER_USER`,
  prismPassword: `${SENTINEL}_PRISM_PW`,
  prismUsername: `${SENTINEL}_PRISM_USER`,
  proxyPassword: `${SENTINEL}_PROXY_PW`
};

/**
 * A Red Hat-shaped pull secret: several registries, long base64 auth values and
 * an `email` on every entry. Both properties are load-bearing — the length
 * forces the `lineWidth: 120` fold, and the `@` in the email is what the broken
 * proxy rule latched onto.
 */
function redHatShapedPullSecret() {
  const pad = "QUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVowMTIzNDU2Nzg5";
  return JSON.stringify({
    auths: {
      "cloud.openshift.com": { auth: `${pad}${S.redhatAuth}${pad}`, email: "tester@redhat.com" },
      "quay.io": { auth: `${pad}${S.quayAuth}${pad}`, email: "tester@redhat.com" },
      "registry.redhat.io": { auth: `${pad}${S.redhatAuth}${pad}`, email: "tester@redhat.com" },
      "registry.connect.redhat.com": { auth: `${pad}${S.quayAuth}${pad}`, email: "tester@redhat.com" }
    }
  });
}

/** A short, single-registry mirror secret with no email — the case that masked the bug. */
function mirrorShapedPullSecret() {
  return JSON.stringify({ auths: { "registry.local:5000": { auth: S.mirrorAuth, email: "" } } });
}

/** Injects a sentinel into every credential class the scenario actually carries. */
function withSentinelCredentials(state, { pullSecret = redHatShapedPullSecret() } = {}) {
  const next = structuredClone(state);

  next.exportOptions = { ...(next.exportOptions || {}), includeCredentials: true };
  next.credentials = {
    ...(next.credentials || {}),
    pullSecretPlaceholder: pullSecret,
    redHatPullSecretConfigured: true,
    sshPublicKey: `ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAA${S.sshKey} tester@workstation`
  };

  for (const node of next.hostInventory?.nodes || []) {
    if (!node.bmc) continue;
    node.bmc.username = S.bmcUsername;
    node.bmc.password = S.bmcPassword;
  }

  const platform = next.platformSpecifics || {};
  if (platform.vsphere) {
    platform.vsphere.vcenterPassword = S.vcenterPassword;
    platform.vsphere.vcenterUsername = S.vcenterUser;
    platform.vsphere.username = S.vcenterUser;
    platform.vsphere.password = S.vcenterPassword;
  }
  if (platform.nutanix) {
    platform.nutanix.username = S.prismUsername;
    platform.nutanix.password = S.prismPassword;
  }

  return next;
}

/** Every sentinel that appears in the unredacted document — i.e. what is actually at risk. */
function sentinelsPresentIn(text) {
  return Object.entries(S).filter(([, value]) => text.includes(value)).map(([name]) => name);
}

function leakedSentinelsIn(text) {
  const leaked = Object.entries(S).filter(([, value]) => text.includes(value)).map(([name]) => name);
  // Catch-all: a sentinel variant we forgot to enumerate must still fail the test.
  if (text.includes(SENTINEL) && leaked.length === 0) leaked.push("<unenumerated sentinel>");
  return leaked;
}

const SCENARIOS = [
  "bareMetalAgent", "bareMetalIpi", "bareMetalUpi",
  "vsphereIpi", "vsphereUpi", "vsphereAgent",
  "nutanixIpi", "awsGovcloudIpi", "awsGovcloudUpi",
  "azureGovernmentIpi", "azureGovernmentUpi", "ibmCloudIpi"
];

/** Generates the documents the drawer would render for a scenario. */
function previewDocumentsFor(fixtureName, transform = (s) => s) {
  const state = withSentinelCredentials(transform(scenarios[fixtureName]()));
  const docs = { "install-config.yaml": buildInstallConfig(state) };
  if (state.methodology?.method === "Agent-Based Installer") {
    docs["agent-config.yaml"] = buildAgentConfig(state);
  }
  return docs;
}

describe("preview redaction — no credential may render while sensitive values are hidden", () => {
  for (const name of SCENARIOS) {
    it(`${name}: redacts every sentinel in every generated document`, () => {
      const docs = previewDocumentsFor(name);

      // Guard the guard: if no sentinel reached any document for this scenario,
      // the leak assertions below would pass vacuously. Not every file carries
      // credentials (a vSphere agent-config does not), so this is per scenario.
      const atRisk = Object.values(docs).flatMap((raw) => sentinelsPresentIn(raw));
      expect(atRisk.length, `${name}: fixture injected no credential`).toBeGreaterThan(0);

      for (const [filename, raw] of Object.entries(docs)) {
        const hidden = obfuscateYaml(raw, false);
        expect(leakedSentinelsIn(hidden), `${name}/${filename} leaked`).toEqual([]);
      }
    });

    it(`${name}: keeps the document complete and parseable while hidden`, () => {
      const docs = previewDocumentsFor(name);

      for (const [filename, raw] of Object.entries(docs)) {
        const hidden = obfuscateYaml(raw, false);

        // Still valid YAML, not a fragment.
        const parsed = yaml.load(hidden);
        expect(parsed, `${filename} did not parse`).toBeTruthy();
        expect(parsed.apiVersion, `${filename} lost apiVersion`).toBeTruthy();

        // The regression collapsed a ~30-line document to 4 lines. Redaction
        // removes only folded credential continuation lines, so the structure
        // must survive essentially intact.
        const rawLines = raw.split("\n").length;
        const hiddenLines = hidden.split("\n").length;
        expect(hiddenLines, `${filename} lost most of the document`).toBeGreaterThan(rawLines * 0.7);

        // The attribution header is ordinary content and must be untouched.
        expect(hidden).toContain("# https://github.com/bstrauss84/openshift-airgap-architect");
      }
    });
  }

  it("shows every value unchanged when sensitive values are revealed", () => {
    const raw = previewDocumentsFor("bareMetalAgent")["install-config.yaml"];
    expect(obfuscateYaml(raw, true)).toBe(raw);
    expect(obfuscateYaml(raw, true)).toContain(S.redhatAuth);
  });
});

describe("preview redaction — the exact shapes that defeated the previous implementation", () => {
  it("redacts a pull secret that js-yaml folded across lines", () => {
    const raw = previewDocumentsFor("bareMetalIpi")["install-config.yaml"];
    // Prove the fixture really does trigger the fold this test exists for.
    expect(raw).toMatch(/pullSecret:\s*[>|]-?/);

    const hidden = obfuscateYaml(raw, false);
    expect(hidden).toContain("pullSecret: '***REDACTED***'");
    expect(hidden).not.toContain(S.redhatAuth);
    expect(hidden).not.toContain('"auths"');
  });

  it("does not let the attribution URL swallow the document", () => {
    const raw = previewDocumentsFor("bareMetalIpi")["install-config.yaml"];
    const hidden = obfuscateYaml(raw, false);

    // The header line must survive intact rather than absorbing the body.
    const headerLine = hidden
      .split("\n")
      .find((line) => line.includes("github.com/bstrauss84"));
    expect(headerLine).toBe("# https://github.com/bstrauss84/openshift-airgap-architect");

    // Body keys that used to be consumed.
    expect(hidden).toContain("baseDomain:");
    expect(hidden).toContain("metadata:");
    expect(hidden).toContain("networking:");
  });

  it("redacts a short mirror-registry secret too (the case that masked the bug)", () => {
    const state = withSentinelCredentials(scenarios.bareMetalIpi(), {
      pullSecret: mirrorShapedPullSecret()
    });
    const hidden = obfuscateYaml(buildInstallConfig(state), false);
    expect(hidden).not.toContain(S.mirrorAuth);
    expect(hidden).toContain("pullSecret: '***REDACTED***'");
  });

  it("redacts proxy credentials without crossing lines", () => {
    const base = scenarios.withProxy
      ? scenarios.withProxy(scenarios.bareMetalIpi())
      : scenarios.bareMetalIpi();
    const state = withSentinelCredentials(base);
    state.globalStrategy = state.globalStrategy || {};
    state.globalStrategy.proxy = {
      ...(state.globalStrategy.proxy || {}),
      enabled: true,
      httpProxy: `http://pxyuser:${S.proxyPassword}@proxy.corp:8080`,
      httpsProxy: `https://pxyuser:${S.proxyPassword}@proxy.corp:8443`
    };

    const raw = buildInstallConfig(state);
    const hidden = obfuscateYaml(raw, false);

    expect(leakedSentinelsIn(hidden)).toEqual([]);
    // Structure intact — the old rule deleted everything between the header and
    // the first `@`.
    expect(hidden).toContain("apiVersion:");
    expect(yaml.load(hidden)).toBeTruthy();
  });

  it("redacts BMC credentials on every bare-metal host", () => {
    const docs = previewDocumentsFor("bareMetalIpi");
    for (const raw of Object.values(docs)) {
      if (!raw.includes(S.bmcPassword) && !raw.includes(S.bmcUsername)) continue;
      const hidden = obfuscateYaml(raw, false);
      expect(hidden).not.toContain(S.bmcPassword);
      expect(hidden).not.toContain(S.bmcUsername);
    }
  });

  it("redacts the SSH key per its established preview classification", () => {
    const raw = previewDocumentsFor("bareMetalIpi")["install-config.yaml"];
    const hidden = obfuscateYaml(raw, false);
    expect(hidden).toContain("sshKey: '***REDACTED***'");
    expect(hidden).not.toContain(S.sshKey);
  });

  it("redacts an incomplete configuration without destroying it", () => {
    // An incomplete config is the state the drawer spends most of its time in.
    const state = withSentinelCredentials(scenarios.bareMetalIpi());
    state.blueprint = { ...(state.blueprint || {}), clusterName: "", baseDomain: "" };

    const hidden = obfuscateYaml(buildInstallConfig(state), false);
    expect(leakedSentinelsIn(hidden)).toEqual([]);
    expect(yaml.load(hidden)).toBeTruthy();
  });

  it("is idempotent — redacting an already-redacted document changes nothing", () => {
    const raw = previewDocumentsFor("bareMetalIpi")["install-config.yaml"];
    const once = obfuscateYaml(raw, false);
    expect(obfuscateYaml(once, false)).toBe(once);
  });
});
