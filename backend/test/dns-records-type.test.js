import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildInstallConfig } from "../src/generate.js";
import { bareMetalIpi, bareMetalAgent, vsphereIpi, vsphereAgent, nutanixIpi, minimal } from "./fixtures/base-states.js";
import yaml from "js-yaml";

function parseInstallConfig(yamlStr) {
  return yaml.load(yamlStr);
}

describe("dnsRecordsType generation non-emission (DOC-102)", () => {
  const scenarios = [
    { name: "bare-metal-ipi", factory: bareMetalIpi, platformKey: "baremetal" },
    { name: "bare-metal-agent", factory: bareMetalAgent, platformKey: "baremetal" },
    { name: "vsphere-ipi", factory: vsphereIpi, platformKey: "vsphere" },
    { name: "vsphere-agent", factory: vsphereAgent, platformKey: "vsphere" },
    { name: "nutanix-ipi", factory: nutanixIpi, platformKey: "nutanix" },
  ];

  describe("4.21 non-emission", () => {
    for (const { name, factory, platformKey } of scenarios) {
      describe(name, () => {
        it("does not emit dnsRecordsType in generated install-config", () => {
          const state = factory({
            version: { selectedMinor: "4.21", selectedPatch: "4.21.8" },
            release: { channel: "4.21", patchVersion: "4.21.8" },
          });
          const result = buildInstallConfig(state);
          const config = parseInstallConfig(result);
          const platformSection = config.platform?.[platformKey];
          assert.ok(platformSection, `platform.${platformKey} must exist for ${name}`);
          assert.equal(
            platformSection.dnsRecordsType,
            undefined,
            `platform.${platformKey}.dnsRecordsType must not be emitted`
          );
        });

        it("does not contain the string dnsRecordsType anywhere in output", () => {
          const state = factory({
            version: { selectedMinor: "4.21", selectedPatch: "4.21.8" },
            release: { channel: "4.21", patchVersion: "4.21.8" },
          });
          const result = buildInstallConfig(state);
          assert.equal(
            result.includes("dnsRecordsType"),
            false,
            "dnsRecordsType string must not appear in generated YAML"
          );
        });
      });
    }
  });

  describe("4.20 non-emission", () => {
    for (const { name, factory, platformKey } of scenarios) {
      it(`${name} at 4.20 does not emit dnsRecordsType`, () => {
        const state = factory({
          version: { selectedMinor: "4.20", selectedPatch: "4.20.8" },
          release: { channel: "4.20", patchVersion: "4.20.8" },
        });
        const result = buildInstallConfig(state);
        assert.equal(
          result.includes("dnsRecordsType"),
          false,
          `dnsRecordsType must not appear in ${name} at 4.20`
        );
      });
    }
  });

  describe("bare-metal-upi", () => {
    it("4.21 generates platform: none (no baremetal section at all)", () => {
      const state = minimal({
        blueprint: { platform: "Bare Metal", baseDomain: "example.com", clusterName: "test" },
        methodology: { method: "UPI" },
        version: { selectedMinor: "4.21", selectedPatch: "4.21.8" },
        release: { channel: "4.21", patchVersion: "4.21.8" },
      });
      const result = buildInstallConfig(state);
      const config = parseInstallConfig(result);
      assert.equal(config.platform?.baremetal, undefined, "bare-metal UPI must not have platform.baremetal");
      assert.deepStrictEqual(config.platform?.none, {}, "bare-metal UPI must have platform.none: {}");
      assert.equal(result.includes("dnsRecordsType"), false, "dnsRecordsType must not appear");
    });

    it("4.20 generates platform: none with no dnsRecordsType", () => {
      const state = minimal({
        blueprint: { platform: "Bare Metal", baseDomain: "example.com", clusterName: "test" },
        methodology: { method: "UPI" },
        version: { selectedMinor: "4.20", selectedPatch: "4.20.8" },
        release: { channel: "4.20", patchVersion: "4.20.8" },
      });
      const result = buildInstallConfig(state);
      const config = parseInstallConfig(result);
      assert.equal(config.platform?.baremetal, undefined, "bare-metal UPI 4.20 must not have platform.baremetal");
      assert.deepStrictEqual(config.platform?.none, {}, "bare-metal UPI 4.20 must have platform.none: {}");
      assert.equal(result.includes("dnsRecordsType"), false, "dnsRecordsType must not appear at 4.20");
    });
  });

  describe("Agent SNO representative", () => {
    it("bare-metal Agent SNO generates platform: none with no dnsRecordsType", () => {
      const state = bareMetalAgent({
        version: { selectedMinor: "4.21", selectedPatch: "4.21.8" },
        release: { channel: "4.21", patchVersion: "4.21.8" },
        hostInventory: {
          nodes: [
            {
              role: "master",
              hostname: "sno-0",
              primary: { type: "ethernet", name: "eno1", macAddress: "52:54:00:aa:bb:01" }
            }
          ],
          apiVip: "10.90.0.2",
          ingressVip: "10.90.0.3",
          machineNetworkCidr: "10.90.0.0/24",
          ipStackMode: "ipv4",
        },
      });
      const result = buildInstallConfig(state);
      const config = parseInstallConfig(result);
      assert.deepStrictEqual(config.platform?.none, {}, "Agent SNO must have platform.none: {}");
      assert.equal(config.platform?.baremetal, undefined, "Agent SNO must not have platform.baremetal");
      assert.equal(result.includes("dnsRecordsType"), false, "dnsRecordsType must not appear");
    });
  });

  describe("no loadBalancer.type emission", () => {
    for (const { name, factory } of scenarios) {
      it(`${name} does not emit loadBalancer.type`, () => {
        const state = factory({
          version: { selectedMinor: "4.21", selectedPatch: "4.21.8" },
          release: { channel: "4.21", patchVersion: "4.21.8" },
        });
        const result = buildInstallConfig(state);
        assert.equal(
          result.includes("loadBalancer"),
          false,
          `loadBalancer must not appear in ${name} output`
        );
      });
    }
  });
});
