/**
 * DOC-115 (GitHub issue #18) — zone lists reach install-config.yaml as YAML arrays.
 *
 * Acceptance criterion 11: the canonical state array must be emitted as a YAML
 * sequence, never collapsed into one comma-joined string, for every provider
 * the item names (criterion 12), at every supported minor. Azure zone names are
 * strings ("1", "2", "3") and must stay strings, not become integers.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import yaml from "js-yaml";
import { buildInstallConfig } from "../src/generate.js";
import { SUPPORTED_MINORS } from "../src/versionPolicy.js";

const PATCH = { "4.20": "4.20.40", "4.21": "4.21.35", "4.22": "4.22.16" };

const PROVIDERS = [
  { platform: "AWS GovCloud", key: "aws", base: { region: "us-gov-west-1" }, zones: ["us-gov-west-1a", "us-gov-west-1b", "us-gov-west-1c"], at: (ic) => ic.platform.aws.defaultMachinePlatform?.zones },
  { platform: "Azure Government", key: "azure", base: { region: "usgovvirginia", baseDomainResourceGroupName: "rg" }, zones: ["1", "2", "3"], at: (ic) => ic.platform.azure.defaultMachinePlatform?.zones },
  { platform: "IBM Cloud", key: "ibmcloud", base: { region: "us-east" }, zones: ["us-east-1", "us-east-2"], at: (ic) => ic.platform.ibmcloud.defaultMachinePlatform?.zones },
];

const stateFor = (minor, p, zones) => ({
  version: { selectedMinor: minor, selectedPatch: PATCH[minor], selectedChannel: `stable-${minor}`, selectedVersion: PATCH[minor], locked: true },
  release: { channel: minor, patchVersion: PATCH[minor], confirmed: true },
  blueprint: { platform: p.platform, arch: "x86_64", clusterName: "doc115", baseDomain: "example.com", confirmed: true },
  methodology: { method: "IPI" },
  globalStrategy: { networking: { machineNetworkV4: "10.0.0.0/16" } },
  hostInventory: { nodes: [] },
  platformConfig: { [p.key]: { ...p.base, ...(zones === undefined ? {} : { defaultMachinePlatformZones: zones }) } },
  credentials: {},
  exportOptions: { includeCredentials: false },
});

describe("DOC-115 zone lists are emitted as YAML sequences", () => {
  for (const minor of SUPPORTED_MINORS) {
    for (const p of PROVIDERS) {
      it(`${minor} ${p.platform}: a ${p.zones.length}-element sequence, element for element`, () => {
        const text = buildInstallConfig(stateFor(minor, p, p.zones));
        const zones = p.at(yaml.load(text));
        assert.ok(Array.isArray(zones), `zones is ${typeof zones}, not a YAML sequence`);
        assert.deepEqual(zones, p.zones);
        for (const z of zones) assert.equal(typeof z, "string", `zone ${z} lost its string type`);
        assert.ok(!text.includes(p.zones.join(",")), "zones were emitted as one comma-joined string");
      });
    }
  }

  for (const p of PROVIDERS) {
    it(`${p.platform}: no zones configured -> no zones key is invented`, () => {
      assert.equal(p.at(yaml.load(buildInstallConfig(stateFor("4.22", p, undefined)))), undefined);
    });
  }
});
