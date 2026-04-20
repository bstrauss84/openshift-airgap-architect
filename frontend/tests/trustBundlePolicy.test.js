import { describe, it, expect } from "vitest";
import {
  extractPemCertificateBlocks,
  getTrustPolicyOptionsForScenario,
  inferDefaultAdditionalTrustBundlePolicy,
  withAutoTrustBundlePolicy,
  hasEffectiveTrustBundle
} from "../src/shared/trustBundlePolicy.js";
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

  it("getTrustPolicyOptionsForScenario prefers catalog over empty version policy", () => {
    const opts = getTrustPolicyOptionsForScenario("bare-metal-agent", "");
    expect(opts).toContain("Proxyonly");
    expect(opts).toContain("Always");
  });

  it("inferDefaultAdditionalTrustBundlePolicy matches mirror vs proxy toggle", () => {
    expect(inferDefaultAdditionalTrustBundlePolicy({ mirrorRegistryCaPem: "x" }, { proxyEnabled: false })).toBe("Always");
    expect(inferDefaultAdditionalTrustBundlePolicy({ mirrorRegistryCaPem: "" }, { proxyEnabled: true })).toBe("Proxyonly");
    expect(inferDefaultAdditionalTrustBundlePolicy({ mirrorRegistryCaPem: "" }, { proxyEnabled: false })).toBe("Always");
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
});
