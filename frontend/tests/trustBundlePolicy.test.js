import { describe, it, expect } from "vitest";
import {
  extractPemCertificateBlocks,
  getTrustPolicyOptionsForScenario,
  inferDefaultAdditionalTrustBundlePolicy,
  withAutoTrustBundlePolicy,
  hasEffectiveTrustBundle,
  trustBundleInferTier
} from "../src/shared/trustBundlePolicy.js";
import { getTrustBundlePolicySupport, getForwardOpenShiftMinorDocNotice } from "../src/shared/versionPolicy.js";
import { validateStep } from "../src/validation.js";
import { stateWithBlueprintCompleteMethodologyIncomplete } from "./fixtures/minimalState.js";

const MOCK_PEM = "-----BEGIN CERTIFICATE-----\nMOCK\n-----END CERTIFICATE-----";

describe("trustBundlePolicy helpers", () => {
  it("extractPemCertificateBlocks finds blocks", () => {
    expect(extractPemCertificateBlocks(MOCK_PEM)).toHaveLength(1);
    expect(extractPemCertificateBlocks("not pem")).toHaveLength(0);
  });

  it("hasEffectiveTrustBundle is false without valid blocks", () => {
    expect(hasEffectiveTrustBundle({ mirrorRegistryCaPem: "garbage", proxyCaPem: "" })).toBe(false);
  });

  it("getTrustBundlePolicySupport: 4.20 explicit, 4.21 forward, unsupported outside OCP4 range", () => {
    expect(getTrustBundlePolicySupport("4.20.5").source).toBe("explicit");
    expect(getTrustBundlePolicySupport("4.21.9")).toEqual({
      policies: ["Proxyonly", "Always"],
      source: "forward",
      minorVersion: "4.21"
    });
    expect(getTrustBundlePolicySupport("4.16.1").source).toBe("unsupported");
    expect(getTrustBundlePolicySupport("3.11.1").source).toBe("unsupported");
  });

  it("getForwardOpenShiftMinorDocNotice uses minor only and generic wording", () => {
    const n = getForwardOpenShiftMinorDocNotice("4.21.9");
    expect(n).toContain("OpenShift 4.21");
    expect(n).not.toContain("4.21.9");
    expect(getForwardOpenShiftMinorDocNotice("4.20.1")).toBeNull();
  });

  it("getTrustPolicyOptionsForScenario prefers catalog over empty version policy", () => {
    const opts = getTrustPolicyOptionsForScenario("bare-metal-agent", "");
    expect(opts).toContain("Proxyonly");
    expect(opts).toContain("Always");
  });

  it("trustBundleInferTier classifies mirror vs proxy-only", () => {
    expect(trustBundleInferTier({ mirrorRegistryCaPem: MOCK_PEM, proxyCaPem: "" })).toBe("mirror");
    expect(trustBundleInferTier({ mirrorRegistryCaPem: "", proxyCaPem: MOCK_PEM })).toBe("proxy-only");
    expect(trustBundleInferTier({ mirrorRegistryCaPem: "", proxyCaPem: "" })).toBe("none");
  });

  it("inferDefault: mirror PEM blocks → Always; proxy-only → Proxyonly", () => {
    expect(inferDefaultAdditionalTrustBundlePolicy({ mirrorRegistryCaPem: MOCK_PEM }, { proxyEnabled: false })).toBe("Always");
    expect(inferDefaultAdditionalTrustBundlePolicy({ proxyCaPem: MOCK_PEM }, { proxyEnabled: false })).toBe("Proxyonly");
    expect(inferDefaultAdditionalTrustBundlePolicy({ proxyCaPem: MOCK_PEM }, { proxyEnabled: true })).toBe("Proxyonly");
    expect(inferDefaultAdditionalTrustBundlePolicy({ mirrorRegistryCaPem: MOCK_PEM, proxyCaPem: MOCK_PEM }, { proxyEnabled: false })).toBe("Always");
  });

  it("withAutoTrustBundlePolicy sets policy synchronously when PEM blocks exist", () => {
    const out = withAutoTrustBundlePolicy(
      { mirrorRegistryCaPem: MOCK_PEM, additionalTrustBundlePolicy: "" },
      { proxyEnabled: false },
      "bare-metal-agent",
      "4.15.0"
    );
    expect(out.additionalTrustBundlePolicy).toBe("Always");
  });

  it("withAutoTrustBundlePolicy clears policy when no PEM blocks", () => {
    const out = withAutoTrustBundlePolicy(
      { mirrorRegistryCaPem: "nope", additionalTrustBundlePolicy: "Always" },
      {},
      "bare-metal-agent",
      "4.20.1"
    );
    expect(out.additionalTrustBundlePolicy).toBe("");
  });

  it("withAutoTrustBundlePolicy resets policy when tier changes from mirror to proxy-only", () => {
    const prev = { mirrorRegistryCaPem: MOCK_PEM, proxyCaPem: "", additionalTrustBundlePolicy: "Always" };
    const next = { mirrorRegistryCaPem: "", proxyCaPem: MOCK_PEM, additionalTrustBundlePolicy: "Always" };
    const out = withAutoTrustBundlePolicy(next, { proxyEnabled: false }, "bare-metal-agent", "4.20.0", prev);
    expect(out.additionalTrustBundlePolicy).toBe("Proxyonly");
  });
});

describe("validateStep review + trust bundle (regression)", () => {
  it("review step passes trust validation when PEM present, policy unset, catalog supplies allow list", () => {
    const base = stateWithBlueprintCompleteMethodologyIncomplete();
    const state = {
      ...base,
      methodology: { method: "Agent-Based Installer" },
      trust: {
        mirrorRegistryCaPem: MOCK_PEM,
        additionalTrustBundlePolicy: ""
      },
      credentials: {
        pullSecretPlaceholder: '{"auths":{"quay.io":{}}}',
        sshPublicKey: "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAI test"
      }
    };
    const result = validateStep(state, "review");
    const trustPolicyErrors = result.errors.filter((e) => e.includes("additionalTrustBundlePolicy"));
    expect(trustPolicyErrors).toHaveLength(0);
  });

  it("validateStep trust-proxy: OpenShift 4.21 + PEM adds forward underscrubbed warning", () => {
    const base = stateWithBlueprintCompleteMethodologyIncomplete();
    const state = {
      ...base,
      release: { channel: "stable-4.21", patchVersion: "4.21.9", confirmed: true },
      trust: {
        mirrorRegistryCaPem: MOCK_PEM,
        additionalTrustBundlePolicy: "Always"
      },
      globalStrategy: { ...base.globalStrategy, proxyEnabled: false }
    };
    const result = validateStep(state, "trust-proxy");
    expect(result.warnings.some((w) => w.includes("not yet fully reflected"))).toBe(true);
    expect(result.warnings.some((w) => w.includes("OpenShift 4.21"))).toBe(true);
    expect(result.warnings.some((w) => w.includes("4.21.9"))).toBe(false);
    expect(result.errors.filter((e) => e.includes("additionalTrustBundlePolicy"))).toHaveLength(0);
  });
});
