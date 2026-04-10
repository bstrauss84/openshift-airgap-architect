import { describe, it, expect } from "vitest";
import { resolveSecretInclusion } from "../src/exportInclusion.js";

describe("resolveSecretInclusion", () => {
  it("defaults to secret-stripped credential classes with cert/proxy/ssh included", () => {
    const inclusion = resolveSecretInclusion({});
    expect(inclusion.pullSecret).toBe(false);
    expect(inclusion.platformCredentials).toBe(false);
    expect(inclusion.mirrorRegistryCredentials).toBe(false);
    expect(inclusion.bmcCredentials).toBe(false);
    expect(inclusion.trustBundleAndCertificates).toBe(true);
    expect(inclusion.sshPublicKey).toBe(true);
    expect(inclusion.proxyValues).toBe(true);
  });

  it("respects per-class overrides", () => {
    const inclusion = resolveSecretInclusion({
      inclusion: { pullSecret: true, sshPublicKey: false }
    });
    expect(inclusion.pullSecret).toBe(true);
    expect(inclusion.sshPublicKey).toBe(false);
  });
});
