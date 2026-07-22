/**
 * OpenShift Airgap Architect - Test Suite
 *
 * @author Bill Strauss
 *
 * Developed with AI assistance from Claude (Anthropic) and Cursor AI.
 */

import { describe, it, expect } from "vitest";
import {
  generateNodesFromCounts,
  applyReplicateSettings,
  getAvailableReplicateKeys,
  emptyNode,
  getScenarioId,
  getAgentBasedTopologyErrors,
  SCENARIO_IDS_WITH_HOST_INVENTORY
} from "../src/hostInventoryV2Helpers.js";
import { getCatalogForScenario } from "../src/catalogPaths.js";
import { isParamVisibleForVersion } from "../src/catalogFieldMeta.js";

describe("getScenarioId / SCENARIO_IDS_WITH_HOST_INVENTORY", () => {
  it("maps VMware vSphere + Agent-Based Installer to vsphere-agent", () => {
    expect(getScenarioId("VMware vSphere", "Agent-Based Installer")).toBe("vsphere-agent");
  });
  it("includes vsphere-agent in host inventory scenarios", () => {
    expect(SCENARIO_IDS_WITH_HOST_INVENTORY).toContain("vsphere-agent");
  });
  it("maps IBM Cloud + IPI to ibm-cloud-ipi and does not include it in host inventory scenarios", () => {
    expect(getScenarioId("IBM Cloud", "IPI")).toBe("ibm-cloud-ipi");
    expect(SCENARIO_IDS_WITH_HOST_INVENTORY).not.toContain("ibm-cloud-ipi");
  });
});

describe("getAgentBasedTopologyErrors", () => {
  it("returns no errors for empty inventory", () => {
    expect(getAgentBasedTopologyErrors([])).toEqual([]);
  });
  it("allows 3 masters and workers with no arbiter", () => {
    expect(getAgentBasedTopologyErrors(generateNodesFromCounts(3, 1, 0))).toEqual([]);
  });
  it("rejects 1 master with workers (SNO)", () => {
    const nodes = generateNodesFromCounts(1, 1, 0);
    expect(getAgentBasedTopologyErrors(nodes).length).toBeGreaterThan(0);
    expect(getAgentBasedTopologyErrors(nodes).some((e) => e.includes("zero workers"))).toBe(true);
  });
  it("rejects 2 masters without arbiter", () => {
    const nodes = generateNodesFromCounts(2, 0, 0);
    expect(getAgentBasedTopologyErrors(nodes).some((e) => e.includes("arbiter"))).toBe(true);
  });
  it("allows 2 masters + 1 arbiter", () => {
    const nodes = [...generateNodesFromCounts(2, 0, 0), emptyNode("arbiter", 0)];
    expect(getAgentBasedTopologyErrors(nodes)).toEqual([]);
  });
  it("rejects invalid master count", () => {
    const nodes = generateNodesFromCounts(6, 0, 0);
    expect(getAgentBasedTopologyErrors(nodes).some((e) => e.includes("6 control plane"))).toBe(true);
  });
});

describe("generateNodesFromCounts", () => {
  it("creates correct number of control plane and worker nodes", () => {
    const nodes = generateNodesFromCounts(3, 2, 0);
    expect(nodes).toHaveLength(5);
    const masters = nodes.filter((n) => n.role === "master");
    const workers = nodes.filter((n) => n.role === "worker");
    expect(masters).toHaveLength(3);
    expect(workers).toHaveLength(2);
    expect(masters.map((n) => n.hostname)).toEqual(["master-0", "master-1", "master-2"]);
    expect(workers.map((n) => n.hostname)).toEqual(["worker-0", "worker-1"]);
  });

  it("creates infra nodes as worker role with infra hostname prefix", () => {
    const nodes = generateNodesFromCounts(1, 0, 2);
    expect(nodes).toHaveLength(3);
    expect(nodes[0].role).toBe("master");
    expect(nodes[0].hostname).toBe("master-0");
    expect(nodes[1].role).toBe("worker");
    expect(nodes[1].hostname).toBe("infra-0");
    expect(nodes[2].role).toBe("worker");
    expect(nodes[2].hostname).toBe("infra-1");
  });

  it("produces nodes with shape consumed by backend (role, hostname, primary, bmc)", () => {
    const nodes = generateNodesFromCounts(1, 1, 0);
    expect(nodes).toHaveLength(2);
    nodes.forEach((node) => {
      expect(node).toHaveProperty("role");
      expect(node).toHaveProperty("hostname");
      expect(node).toHaveProperty("primary");
      expect(node.primary).toHaveProperty("type", "ethernet");
      expect(node.primary).toHaveProperty("mode", "dhcp");
      expect(node.primary).toHaveProperty("ethernet");
      expect(node.primary).toHaveProperty("bond");
      expect(node.primary).toHaveProperty("vlan");
      expect(node.primary).toHaveProperty("advanced");
      expect(node).toHaveProperty("bmc");
      expect(node.bmc).toHaveProperty("address", "");
      expect(node.bmc).toHaveProperty("disableCertificateVerification", false);
      expect(node).toHaveProperty("dnsServers", "");
      expect(node).toHaveProperty("dnsSearch", "");
    });
  });
});

describe("applyReplicateSettings", () => {
  const ALL_KEYS = new Set([
    "dnsServers", "dnsSearch", "hostname", "hostnameUseFqdn", "rootDevice",
    "bmc", "bootMACAddress",
    "primary.type", "primary.mode", "primary.ipv4Cidr", "primary.ipv6Cidr",
    "primary.ipv4Gateway", "primary.ipv6Gateway", "primary.vlan", "primary.bond",
    "primary.advanced", "primary.ethernet.macAddress", "primary.bond.slaves.macAddress"
  ]);

  it("copies only selected fields and does not copy hostname/bmc/MACs by default", () => {
    const source = {
      hostname: "source-node",
      dnsServers: "8.8.8.8",
      dnsSearch: "example.com",
      bmc: { address: "bmc://x", username: "u", password: "p", bootMACAddress: "52:54:00:11:11:11" },
      primary: {
        type: "ethernet",
        mode: "static",
        ethernet: { name: "eth0", macAddress: "52:54:00:aa:aa:aa" },
        ipv4Gateway: "192.168.1.1"
      }
    };
    const targetNodes = [
      { ...emptyNode("worker", 0), hostname: "worker-0", primary: { ...emptyNode("worker", 0).primary, ethernet: { name: "eth1", macAddress: "52:54:00:bb:bb:bb" } } }
    ];
    const selectedFields = new Set(["dnsServers", "dnsSearch", "primary.type", "primary.mode", "primary.ipv4Gateway"]);
    const result = applyReplicateSettings(source, targetNodes, selectedFields, ALL_KEYS);
    expect(result).toHaveLength(1);
    expect(result[0].hostname).toBe("worker-0");
    expect(result[0].dnsServers).toBe("8.8.8.8");
    expect(result[0].dnsSearch).toBe("example.com");
    expect(result[0].primary.type).toBe("ethernet");
    expect(result[0].primary.mode).toBe("static");
    expect(result[0].primary.ipv4Gateway).toBe("192.168.1.1");
    expect(result[0].primary.ethernet.macAddress).toBe("52:54:00:bb:bb:bb");
    expect(result[0].bmc?.address).toBe("");
  });

  it("when hostname is selected, copies hostname to target", () => {
    const source = { ...emptyNode("master", 0), hostname: "my-master" };
    const targetNodes = [{ ...emptyNode("worker", 0), hostname: "worker-0" }];
    const result = applyReplicateSettings(source, targetNodes, new Set(["hostname"]), ALL_KEYS);
    expect(result[0].hostname).toBe("my-master");
  });

  it("when primary.bond is selected, copies bond mode/name but clears slave MACs unless selected", () => {
    const source = {
      ...emptyNode("master", 0),
      primary: {
        ...emptyNode("master", 0).primary,
        type: "bond",
        bond: { name: "bond0", mode: "802.3ad", slaves: [{ name: "eth0", macAddress: "aa:aa:aa" }, { name: "eth1", macAddress: "bb:bb:bb" }] }
      }
    };
    const targetNodes = [{ ...emptyNode("worker", 0), primary: { ...emptyNode("worker", 0).primary, type: "bond", bond: { name: "bond1", mode: "active-backup", slaves: [{ name: "e0", macAddress: "cc:cc:cc" }] } } }];
    const result = applyReplicateSettings(source, targetNodes, new Set(["primary.bond"]), ALL_KEYS);
    expect(result[0].primary.bond.name).toBe("bond0");
    expect(result[0].primary.bond.mode).toBe("802.3ad");
    expect(result[0].primary.bond.slaves[0].macAddress).toBe("");
    expect(result[0].primary.bond.slaves[1].macAddress).toBe("");
  });

  it("does not copy Root device hint or Advanced fields into arbiter targets", () => {
    const source = {
      hostname: "source-node",
      rootDevice: "/dev/disk/by-id/source",
      primary: {
        type: "ethernet",
        mode: "static",
        ethernet: { name: "eth0", macAddress: "52:54:00:aa:aa:aa" },
        ipv4Cidr: "192.0.2.10/24",
        ipv4Gateway: "192.0.2.1",
        ipv6Cidr: "fd00::10/64",
        ipv6Gateway: "fd00::1",
        advanced: { mtu: "1500", routes: [{ destination: "0.0.0.0/0", nextHopAddress: "192.0.2.254" }] }
      }
    };

    const arbiterTarget = emptyNode("arbiter", 0);
    arbiterTarget.primary = { ...arbiterTarget.primary, ethernet: { ...arbiterTarget.primary.ethernet, name: "eth1", macAddress: "52:54:00:bb:bb:bb" } };
    arbiterTarget.rootDevice = "";
    arbiterTarget.primary.advanced = { mtu: "", routes: [] };

    const result = applyReplicateSettings(
      source,
      [arbiterTarget],
      new Set(["rootDevice", "primary.advanced"]),
      ALL_KEYS
    );

    expect(result).toHaveLength(1);
    expect(result[0].rootDevice).toBe("");
    expect(result[0].primary.advanced.mtu).toBe("");
    expect(result[0].primary.advanced.routes).toEqual([]);
  });
});

describe("getAvailableReplicateKeys", () => {
  const AGENT_ALL_VISIBLE = {
    showIpiDrawer: false,
    showAgentHostname: true,
    showAgentDns: true,
    showAgentRootDeviceHints: true,
    showAgentPrimaryNetwork: true,
    showBmc: false,
    showAgentDay2InstallConfigBmc: true,
    showAgentBmcCore: true,
    showAgentBootMac: true,
  };

  it("returns all replication keys when all agent sections are visible", () => {
    const keys = getAvailableReplicateKeys(AGENT_ALL_VISIBLE);
    expect(keys.has("hostname")).toBe(true);
    expect(keys.has("hostnameUseFqdn")).toBe(true);
    expect(keys.has("dnsServers")).toBe(true);
    expect(keys.has("dnsSearch")).toBe(true);
    expect(keys.has("rootDevice")).toBe(true);
    expect(keys.has("primary.type")).toBe(true);
    expect(keys.has("primary.mode")).toBe(true);
    expect(keys.has("primary.ipv4Cidr")).toBe(true);
    expect(keys.has("primary.ipv6Cidr")).toBe(true);
    expect(keys.has("primary.ipv4Gateway")).toBe(true);
    expect(keys.has("primary.ipv6Gateway")).toBe(true);
    expect(keys.has("primary.vlan")).toBe(true);
    expect(keys.has("primary.bond")).toBe(true);
    expect(keys.has("primary.advanced")).toBe(true);
    expect(keys.has("primary.ethernet.macAddress")).toBe(true);
    expect(keys.has("primary.bond.slaves.macAddress")).toBe(true);
    expect(keys.has("bmc")).toBe(true);
    expect(keys.has("bootMACAddress")).toBe(true);
  });

  it("hides DNS options when showAgentDns is false (catalog-hidden)", () => {
    const keys = getAvailableReplicateKeys({ ...AGENT_ALL_VISIBLE, showAgentDns: false });
    expect(keys.has("dnsServers")).toBe(false);
    expect(keys.has("dnsSearch")).toBe(false);
    expect(keys.has("hostname")).toBe(true);
    expect(keys.has("primary.type")).toBe(true);
  });

  it("hides hostname options when showAgentHostname is false (catalog-hidden)", () => {
    const keys = getAvailableReplicateKeys({ ...AGENT_ALL_VISIBLE, showAgentHostname: false });
    expect(keys.has("hostname")).toBe(false);
    expect(keys.has("hostnameUseFqdn")).toBe(false);
  });

  it("hides rootDevice when showAgentRootDeviceHints is false (catalog-hidden)", () => {
    const keys = getAvailableReplicateKeys({ ...AGENT_ALL_VISIBLE, showAgentRootDeviceHints: false });
    expect(keys.has("rootDevice")).toBe(false);
    expect(keys.has("primary.type")).toBe(true);
  });

  it("hides all primary networking options when showAgentPrimaryNetwork is false (scenario-hidden)", () => {
    const keys = getAvailableReplicateKeys({ ...AGENT_ALL_VISIBLE, showAgentPrimaryNetwork: false });
    expect(keys.has("primary.type")).toBe(false);
    expect(keys.has("primary.mode")).toBe(false);
    expect(keys.has("primary.ipv4Cidr")).toBe(false);
    expect(keys.has("primary.ipv6Cidr")).toBe(false);
    expect(keys.has("primary.ipv4Gateway")).toBe(false);
    expect(keys.has("primary.ipv6Gateway")).toBe(false);
    expect(keys.has("primary.vlan")).toBe(false);
    expect(keys.has("primary.bond")).toBe(false);
    expect(keys.has("primary.advanced")).toBe(false);
    expect(keys.has("primary.ethernet.macAddress")).toBe(false);
    expect(keys.has("primary.bond.slaves.macAddress")).toBe(false);
    expect(keys.has("dnsServers")).toBe(true);
    expect(keys.has("hostname")).toBe(true);
  });

  it("primary and DNS visibility are independent", () => {
    const keys = getAvailableReplicateKeys({
      ...AGENT_ALL_VISIBLE, showAgentPrimaryNetwork: false, showAgentDns: true
    });
    expect(keys.has("dnsServers")).toBe(true);
    expect(keys.has("dnsSearch")).toBe(true);
    expect(keys.has("primary.type")).toBe(false);

    const keys2 = getAvailableReplicateKeys({
      ...AGENT_ALL_VISIBLE, showAgentPrimaryNetwork: true, showAgentDns: false
    });
    expect(keys2.has("dnsServers")).toBe(false);
    expect(keys2.has("primary.type")).toBe(true);
  });

  it("hides BMC and Boot MAC when showAgentDay2InstallConfigBmc is false (topology-hidden)", () => {
    const keys = getAvailableReplicateKeys({ ...AGENT_ALL_VISIBLE, showAgentDay2InstallConfigBmc: false });
    expect(keys.has("bmc")).toBe(false);
    expect(keys.has("bootMACAddress")).toBe(false);
    expect(keys.has("hostname")).toBe(true);
  });

  it("IPI scenario exposes hostname, hostnameUseFqdn, rootDevice, bmc, and bootMACAddress", () => {
    const keys = getAvailableReplicateKeys({
      showIpiDrawer: true, showAgentHostname: false, showAgentDns: false,
      showAgentRootDeviceHints: false, showAgentPrimaryNetwork: false,
      showBmc: true, showAgentDay2InstallConfigBmc: false,
      showAgentBmcCore: false, showAgentBootMac: false,
    });
    expect(keys.has("hostname")).toBe(true);
    expect(keys.has("hostnameUseFqdn")).toBe(true);
    expect(keys.has("rootDevice")).toBe(true);
    expect(keys.has("bmc")).toBe(true);
    expect(keys.has("bootMACAddress")).toBe(true);
    expect(keys.has("dnsServers")).toBe(false);
    expect(keys.has("dnsSearch")).toBe(false);
    expect(keys.has("primary.type")).toBe(false);
    expect(keys.has("primary.mode")).toBe(false);
  });

  it("IPI scenario without showBmc hides bmc and bootMACAddress", () => {
    const keys = getAvailableReplicateKeys({
      showIpiDrawer: true, showAgentHostname: false, showAgentDns: false,
      showAgentRootDeviceHints: false, showAgentPrimaryNetwork: false,
      showBmc: false, showAgentDay2InstallConfigBmc: false,
      showAgentBmcCore: false, showAgentBootMac: false,
    });
    expect(keys.has("bmc")).toBe(false);
    expect(keys.has("bootMACAddress")).toBe(false);
    expect(keys.has("hostname")).toBe(true);
  });

  it("BMC visible, Boot MAC hidden: bmc available, bootMACAddress absent", () => {
    const keys = getAvailableReplicateKeys({
      ...AGENT_ALL_VISIBLE, showAgentBmcCore: true, showAgentBootMac: false,
    });
    expect(keys.has("bmc")).toBe(true);
    expect(keys.has("bootMACAddress")).toBe(false);
  });

  it("BMC hidden, Boot MAC visible: bmc absent, bootMACAddress available", () => {
    const keys = getAvailableReplicateKeys({
      ...AGENT_ALL_VISIBLE, showAgentBmcCore: false, showAgentBootMac: true,
    });
    expect(keys.has("bmc")).toBe(false);
    expect(keys.has("bootMACAddress")).toBe(true);
  });

  it("both BMC and Boot MAC hidden: neither available", () => {
    const keys = getAvailableReplicateKeys({
      ...AGENT_ALL_VISIBLE, showAgentBmcCore: false, showAgentBootMac: false,
    });
    expect(keys.has("bmc")).toBe(false);
    expect(keys.has("bootMACAddress")).toBe(false);
  });

  it("both BMC and Boot MAC visible: both available", () => {
    const keys = getAvailableReplicateKeys(AGENT_ALL_VISIBLE);
    expect(keys.has("bmc")).toBe(true);
    expect(keys.has("bootMACAddress")).toBe(true);
  });

  it("primary Ethernet MAC and Bond-member MAC are independent of BMC/Boot MAC", () => {
    const keys = getAvailableReplicateKeys({
      ...AGENT_ALL_VISIBLE, showAgentDay2InstallConfigBmc: false,
    });
    expect(keys.has("bmc")).toBe(false);
    expect(keys.has("bootMACAddress")).toBe(false);
    expect(keys.has("primary.ethernet.macAddress")).toBe(true);
    expect(keys.has("primary.bond.slaves.macAddress")).toBe(true);
  });
});

describe("applyReplicateSettings with availableKeys (HB-004)", () => {
  const makeSource = () => ({
    ...emptyNode("master", 0),
    hostname: "source-host",
    dnsServers: "8.8.8.8",
    dnsSearch: "example.com",
    rootDevice: "/dev/sda",
    rootDeviceHintWwn: "0x123",
    bmc: { address: "bmc://x", username: "u", password: "p", bootMACAddress: "52:54:00:11:11:11" },
    primary: {
      ...emptyNode("master", 0).primary,
      type: "ethernet",
      mode: "static",
      ethernet: { name: "eth0", macAddress: "52:54:00:aa:aa:aa" },
      ipv4Gateway: "192.168.1.1",
      ipv4Cidr: "192.168.1.10/24",
      advanced: { mtu: "9000", routes: [{ destination: "10.0.0.0/8", nextHopAddress: "192.168.1.254" }] },
    },
  });

  it("three-argument call (no availableKeys) cannot apply any selected field", () => {
    const source = makeSource();
    const target = [{ ...emptyNode("worker", 0), dnsServers: "" }];
    const selected = new Set(["dnsServers", "primary.type", "hostname"]);
    const result = applyReplicateSettings(source, target, selected);
    expect(result[0].dnsServers).toBe("");
    expect(result[0].primary.type).toBe("ethernet");
    expect(result[0].hostname).toBe("worker-0");
  });

  it("invalid availability value (string) cannot apply any selected field", () => {
    const source = makeSource();
    const target = [{ ...emptyNode("worker", 0), dnsServers: "" }];
    const selected = new Set(["dnsServers"]);
    const result = applyReplicateSettings(source, target, selected, "dnsServers");
    expect(result[0].dnsServers).toBe("");
  });

  it("invalid availability value (null) cannot apply any selected field", () => {
    const source = makeSource();
    const target = [{ ...emptyNode("worker", 0), dnsServers: "" }];
    const selected = new Set(["dnsServers"]);
    const result = applyReplicateSettings(source, target, selected, null);
    expect(result[0].dnsServers).toBe("");
  });

  it("invalid availability value (array) cannot apply any selected field", () => {
    const source = makeSource();
    const target = [{ ...emptyNode("worker", 0), dnsServers: "" }];
    const selected = new Set(["dnsServers"]);
    const result = applyReplicateSettings(source, target, selected, ["dnsServers"]);
    expect(result[0].dnsServers).toBe("");
  });

  it("empty availability set cannot apply any selected field", () => {
    const source = makeSource();
    const target = [{ ...emptyNode("worker", 0), dnsServers: "" }];
    const selected = new Set(["dnsServers", "hostname", "primary.type"]);
    const result = applyReplicateSettings(source, target, selected, new Set());
    expect(result[0].dnsServers).toBe("");
    expect(result[0].hostname).toBe("worker-0");
    expect(result[0].primary.type).toBe("ethernet");
  });

  it("explicit full availability set preserves legitimate replication behavior", () => {
    const source = makeSource();
    const target = [{ ...emptyNode("worker", 0), dnsServers: "", hostname: "worker-0" }];
    const selected = new Set(["dnsServers", "hostname", "primary.type", "primary.mode"]);
    const available = new Set(["dnsServers", "hostname", "primary.type", "primary.mode"]);
    const result = applyReplicateSettings(source, target, selected, available);
    expect(result[0].dnsServers).toBe("8.8.8.8");
    expect(result[0].hostname).toBe("source-host");
    expect(result[0].primary.type).toBe("ethernet");
    expect(result[0].primary.mode).toBe("static");
  });

  it("stale selected hidden option cannot be applied", () => {
    const source = makeSource();
    const target = [{ ...emptyNode("worker", 0), hostname: "worker-0", dnsServers: "", rootDevice: "" }];
    const selected = new Set(["dnsServers", "rootDevice", "hostname"]);
    const available = new Set(["hostname"]);
    const result = applyReplicateSettings(source, target, selected, available);
    expect(result[0].hostname).toBe("source-host");
    expect(result[0].dnsServers).toBe("");
    expect(result[0].rootDevice).toBe("");
  });

  it("direct helper call with hidden option cannot apply it", () => {
    const source = makeSource();
    const target = [{ ...emptyNode("worker", 0), dnsServers: "1.1.1.1" }];
    const selected = new Set(["dnsServers", "primary.type", "primary.mode"]);
    const available = new Set(["dnsServers"]);
    const result = applyReplicateSettings(source, target, selected, available);
    expect(result[0].dnsServers).toBe("8.8.8.8");
    expect(result[0].primary.type).toBe("ethernet");
    expect(result[0].primary.mode).toBe("dhcp");
  });

  it("hiding an option does not clear the source node's stored field value", () => {
    const source = makeSource();
    const target = [{ ...emptyNode("worker", 0) }];
    const selected = new Set(["dnsServers", "rootDevice"]);
    const available = new Set(["dnsServers"]);
    applyReplicateSettings(source, target, selected, available);
    expect(source.rootDevice).toBe("/dev/sda");
    expect(source.rootDeviceHintWwn).toBe("0x123");
    expect(source.dnsServers).toBe("8.8.8.8");
  });

  it("re-exposing an option allows the preserved value to be replicated", () => {
    const source = makeSource();
    const target = [{ ...emptyNode("worker", 0), rootDevice: "" }];
    const selected = new Set(["rootDevice"]);
    const restrictedAvailable = new Set(["dnsServers"]);
    const r1 = applyReplicateSettings(source, target, selected, restrictedAvailable);
    expect(r1[0].rootDevice).toBe("");

    const fullAvailable = new Set(["rootDevice", "dnsServers"]);
    const r2 = applyReplicateSettings(source, target, selected, fullAvailable);
    expect(r2[0].rootDevice).toBe("/dev/sda");
    expect(r2[0].rootDeviceHintWwn).toBe("0x123");
  });

  it("arbiter filtering composes with availableKeys filtering", () => {
    const source = makeSource();
    const arbiter = { ...emptyNode("arbiter", 0), rootDevice: "", primary: { ...emptyNode("arbiter", 0).primary, advanced: { mtu: "", routes: [] } } };
    const selected = new Set(["rootDevice", "primary.advanced", "dnsServers"]);
    const available = new Set(["rootDevice", "primary.advanced", "dnsServers"]);
    const result = applyReplicateSettings(source, [arbiter], selected, available);
    expect(result[0].rootDevice).toBe("");
    expect(result[0].primary.advanced.mtu).toBe("");
    expect(result[0].dnsServers).toBe("8.8.8.8");
  });
});

describe("applyReplicateSettings BMC/Boot MAC field separation (HB-004)", () => {
  const makeSource = () => ({
    ...emptyNode("master", 0),
    bmc: { address: "bmc://x", username: "u", password: "p", bootMACAddress: "52:54:00:11:11:11", disableCertificateVerification: true },
  });

  it("BMC option copies only BMC credentials, not bootMACAddress", () => {
    const source = makeSource();
    const target = [{ ...emptyNode("worker", 0), bmc: { address: "", username: "", password: "", bootMACAddress: "52:54:00:22:22:22", disableCertificateVerification: false } }];
    const result = applyReplicateSettings(source, target, new Set(["bmc"]), new Set(["bmc"]));
    expect(result[0].bmc.address).toBe("bmc://x");
    expect(result[0].bmc.username).toBe("u");
    expect(result[0].bmc.password).toBe("p");
    expect(result[0].bmc.disableCertificateVerification).toBe(true);
    expect(result[0].bmc.bootMACAddress).toBe("52:54:00:22:22:22");
  });

  it("bootMACAddress option copies only bootMACAddress, preserves BMC credentials", () => {
    const source = makeSource();
    const target = [{ ...emptyNode("worker", 0), bmc: { address: "bmc://old", username: "old-u", password: "old-p", bootMACAddress: "", disableCertificateVerification: false } }];
    const result = applyReplicateSettings(source, target, new Set(["bootMACAddress"]), new Set(["bootMACAddress"]));
    expect(result[0].bmc.bootMACAddress).toBe("52:54:00:11:11:11");
    expect(result[0].bmc.address).toBe("bmc://old");
    expect(result[0].bmc.username).toBe("old-u");
    expect(result[0].bmc.password).toBe("old-p");
    expect(result[0].bmc.disableCertificateVerification).toBe(false);
  });

  it("both BMC and bootMACAddress selected copies all fields", () => {
    const source = makeSource();
    const target = [{ ...emptyNode("worker", 0), bmc: { address: "", username: "", password: "", bootMACAddress: "", disableCertificateVerification: false } }];
    const result = applyReplicateSettings(source, target, new Set(["bmc", "bootMACAddress"]), new Set(["bmc", "bootMACAddress"]));
    expect(result[0].bmc.address).toBe("bmc://x");
    expect(result[0].bmc.username).toBe("u");
    expect(result[0].bmc.password).toBe("p");
    expect(result[0].bmc.bootMACAddress).toBe("52:54:00:11:11:11");
    expect(result[0].bmc.disableCertificateVerification).toBe(true);
  });

  it("BMC visible + Boot MAC hidden: applying BMC preserves target bootMACAddress", () => {
    const source = makeSource();
    const target = [{ ...emptyNode("worker", 0), bmc: { address: "", username: "", password: "", bootMACAddress: "52:54:00:99:99:99", disableCertificateVerification: false } }];
    const available = new Set(["bmc"]);
    const result = applyReplicateSettings(source, target, new Set(["bmc", "bootMACAddress"]), available);
    expect(result[0].bmc.address).toBe("bmc://x");
    expect(result[0].bmc.bootMACAddress).toBe("52:54:00:99:99:99");
  });

  it("BMC hidden + Boot MAC visible: applying bootMACAddress preserves target BMC credentials", () => {
    const source = makeSource();
    const target = [{ ...emptyNode("worker", 0), bmc: { address: "bmc://keep", username: "keep-u", password: "keep-p", bootMACAddress: "", disableCertificateVerification: false } }];
    const available = new Set(["bootMACAddress"]);
    const result = applyReplicateSettings(source, target, new Set(["bmc", "bootMACAddress"]), available);
    expect(result[0].bmc.bootMACAddress).toBe("52:54:00:11:11:11");
    expect(result[0].bmc.address).toBe("bmc://keep");
    expect(result[0].bmc.username).toBe("keep-u");
    expect(result[0].bmc.password).toBe("keep-p");
  });

  it("both hidden: stale selections for either cannot apply", () => {
    const source = makeSource();
    const target = [{ ...emptyNode("worker", 0), bmc: { address: "keep", username: "keep-u", password: "keep-p", bootMACAddress: "52:54:00:99:99:99", disableCertificateVerification: false } }];
    const available = new Set(["dnsServers"]);
    const result = applyReplicateSettings(source, target, new Set(["bmc", "bootMACAddress"]), available);
    expect(result[0].bmc.address).toBe("keep");
    expect(result[0].bmc.username).toBe("keep-u");
    expect(result[0].bmc.bootMACAddress).toBe("52:54:00:99:99:99");
  });

  it("hiding BMC/Boot MAC does not clear source values", () => {
    const source = makeSource();
    const target = [{ ...emptyNode("worker", 0) }];
    applyReplicateSettings(source, target, new Set(["bmc", "bootMACAddress"]), new Set());
    expect(source.bmc.address).toBe("bmc://x");
    expect(source.bmc.username).toBe("u");
    expect(source.bmc.password).toBe("p");
    expect(source.bmc.bootMACAddress).toBe("52:54:00:11:11:11");
  });

  it("re-exposing BMC permits preserved source values to be copied", () => {
    const source = makeSource();
    const target = [{ ...emptyNode("worker", 0), bmc: { address: "", username: "", password: "", bootMACAddress: "", disableCertificateVerification: false } }];
    const r1 = applyReplicateSettings(source, target, new Set(["bmc"]), new Set());
    expect(r1[0].bmc.address).toBe("");

    const r2 = applyReplicateSettings(source, target, new Set(["bmc"]), new Set(["bmc"]));
    expect(r2[0].bmc.address).toBe("bmc://x");
    expect(r2[0].bmc.username).toBe("u");
  });

  it("re-exposing bootMACAddress permits preserved source value to be copied", () => {
    const source = makeSource();
    const target = [{ ...emptyNode("worker", 0), bmc: { address: "", username: "", password: "", bootMACAddress: "", disableCertificateVerification: false } }];
    const r1 = applyReplicateSettings(source, target, new Set(["bootMACAddress"]), new Set());
    expect(r1[0].bmc.bootMACAddress).toBe("");

    const r2 = applyReplicateSettings(source, target, new Set(["bootMACAddress"]), new Set(["bootMACAddress"]));
    expect(r2[0].bmc.bootMACAddress).toBe("52:54:00:11:11:11");
  });
});

describe("HB-004 catalog-driven replication safety", () => {
  function catalogVisibility(scenarioId, version) {
    const params = getCatalogForScenario(scenarioId, version);
    const find = (path, file) => params.find((p) => p.path === path && p.outputFile === file);
    const isIpi = scenarioId === "bare-metal-ipi";
    const day2 = isParamVisibleForVersion(find("platform.baremetal.hosts[].bmc", "install-config.yaml"), version);
    return {
      showIpiDrawer: isIpi,
      showAgentHostname: isParamVisibleForVersion(find("hosts[].hostname", "agent-config.yaml"), version),
      showAgentDns: isParamVisibleForVersion(find("hosts[].networkConfig.dns-resolver", "agent-config.yaml"), version),
      showAgentRootDeviceHints: isParamVisibleForVersion(find("hosts[].rootDeviceHints", "agent-config.yaml"), version),
      showAgentPrimaryNetwork: isParamVisibleForVersion(find("hosts[].networkConfig", "agent-config.yaml"), version),
      showBmc: isIpi,
      showAgentDay2InstallConfigBmc: day2,
      showAgentBmcCore: isParamVisibleForVersion(find("platform.baremetal.hosts[].bmc", "install-config.yaml"), version),
      showAgentBootMac: isParamVisibleForVersion(find("platform.baremetal.hosts[].bootMACAddress", "install-config.yaml"), version),
    };
  }

  it("4.20 bare-metal-agent exposes all expected options including Boot MAC", () => {
    const keys = getAvailableReplicateKeys(catalogVisibility("bare-metal-agent", "4.20"));
    expect(keys.has("hostname")).toBe(true);
    expect(keys.has("hostnameUseFqdn")).toBe(true);
    expect(keys.has("dnsServers")).toBe(true);
    expect(keys.has("dnsSearch")).toBe(true);
    expect(keys.has("rootDevice")).toBe(true);
    expect(keys.has("primary.type")).toBe(true);
    expect(keys.has("primary.mode")).toBe(true);
    expect(keys.has("primary.vlan")).toBe(true);
    expect(keys.has("primary.bond")).toBe(true);
    expect(keys.has("primary.advanced")).toBe(true);
    expect(keys.has("bmc")).toBe(true);
    expect(keys.has("bootMACAddress")).toBe(true);
  });

  it("4.21 bare-metal-agent exposes all expected options including Boot MAC", () => {
    const keys = getAvailableReplicateKeys(catalogVisibility("bare-metal-agent", "4.21"));
    expect(keys.has("hostname")).toBe(true);
    expect(keys.has("hostnameUseFqdn")).toBe(true);
    expect(keys.has("dnsServers")).toBe(true);
    expect(keys.has("dnsSearch")).toBe(true);
    expect(keys.has("rootDevice")).toBe(true);
    expect(keys.has("primary.type")).toBe(true);
    expect(keys.has("primary.mode")).toBe(true);
    expect(keys.has("primary.vlan")).toBe(true);
    expect(keys.has("primary.bond")).toBe(true);
    expect(keys.has("primary.advanced")).toBe(true);
    expect(keys.has("bmc")).toBe(true);
    expect(keys.has("bootMACAddress")).toBe(true);
  });

  it("4.20 vsphere-agent hides BMC and Boot MAC (no catalog entry)", () => {
    const keys = getAvailableReplicateKeys(catalogVisibility("vsphere-agent", "4.20"));
    expect(keys.has("bmc")).toBe(false);
    expect(keys.has("bootMACAddress")).toBe(false);
    expect(keys.has("hostname")).toBe(true);
    expect(keys.has("hostnameUseFqdn")).toBe(true);
    expect(keys.has("dnsServers")).toBe(true);
    expect(keys.has("dnsSearch")).toBe(true);
    expect(keys.has("rootDevice")).toBe(true);
    expect(keys.has("primary.type")).toBe(true);
    expect(keys.has("primary.mode")).toBe(true);
  });

  it("4.21 vsphere-agent hides BMC and Boot MAC (no catalog entry)", () => {
    const keys = getAvailableReplicateKeys(catalogVisibility("vsphere-agent", "4.21"));
    expect(keys.has("bmc")).toBe(false);
    expect(keys.has("bootMACAddress")).toBe(false);
    expect(keys.has("hostname")).toBe(true);
    expect(keys.has("hostnameUseFqdn")).toBe(true);
    expect(keys.has("dnsServers")).toBe(true);
    expect(keys.has("rootDevice")).toBe(true);
    expect(keys.has("primary.type")).toBe(true);
  });

  it("4.22 unsupported version throws deterministically from getCatalogForScenario", () => {
    expect(() => getCatalogForScenario("bare-metal-agent", "4.22")).toThrow(/not supported/);
  });

  it("4.22 getAvailableReplicateKeys with all-false visibility returns empty set", () => {
    const keys = getAvailableReplicateKeys({
      showIpiDrawer: false, showAgentHostname: false, showAgentDns: false,
      showAgentRootDeviceHints: false, showAgentPrimaryNetwork: false,
      showBmc: false, showAgentDay2InstallConfigBmc: false,
      showAgentBmcCore: false, showAgentBootMac: false,
    });
    expect(keys.size).toBe(0);
  });

  it("4.20 bare-metal-ipi exposes IPI options only (hostname, rootDevice, bmc, bootMACAddress)", () => {
    const keys = getAvailableReplicateKeys(catalogVisibility("bare-metal-ipi", "4.20"));
    expect(keys.has("hostname")).toBe(true);
    expect(keys.has("hostnameUseFqdn")).toBe(true);
    expect(keys.has("rootDevice")).toBe(true);
    expect(keys.has("bmc")).toBe(true);
    expect(keys.has("bootMACAddress")).toBe(true);
    expect(keys.has("dnsServers")).toBe(false);
    expect(keys.has("primary.type")).toBe(false);
  });
});

describe("HB-004 structural primary networking availability", () => {
  const BASE_VIS = {
    showIpiDrawer: false,
    showAgentHostname: true,
    showAgentDns: true,
    showAgentRootDeviceHints: true,
    showAgentPrimaryNetwork: true,
    showBmc: false,
    showAgentDay2InstallConfigBmc: true,
    showAgentBmcCore: true,
    showAgentBootMac: true,
  };

  function makeSourceNode(type, mode) {
    return { primary: { type, mode } };
  }

  it("ethernet + DHCP: type/mode/advanced + ethernet MAC; no bond/vlan/ipv4Cidr/ipv6Cidr", () => {
    const keys = getAvailableReplicateKeys({
      ...BASE_VIS, sourceNode: makeSourceNode("ethernet", "dhcp"), enableIpv6: false,
    });
    expect(keys.has("primary.type")).toBe(true);
    expect(keys.has("primary.mode")).toBe(true);
    expect(keys.has("primary.advanced")).toBe(true);
    expect(keys.has("primary.ethernet.macAddress")).toBe(true);
    expect(keys.has("primary.bond")).toBe(false);
    expect(keys.has("primary.bond.slaves.macAddress")).toBe(false);
    expect(keys.has("primary.vlan")).toBe(false);
    expect(keys.has("primary.ipv4Cidr")).toBe(false);
    expect(keys.has("primary.ipv4Gateway")).toBe(false);
    expect(keys.has("primary.ipv6Cidr")).toBe(false);
    expect(keys.has("primary.ipv6Gateway")).toBe(false);
  });

  it("bond + DHCP: type/mode/advanced + bond + bond MACs; no ethernet MAC/vlan/ipv4Cidr/ipv6Cidr", () => {
    const keys = getAvailableReplicateKeys({
      ...BASE_VIS, sourceNode: makeSourceNode("bond", "dhcp"), enableIpv6: false,
    });
    expect(keys.has("primary.type")).toBe(true);
    expect(keys.has("primary.mode")).toBe(true);
    expect(keys.has("primary.advanced")).toBe(true);
    expect(keys.has("primary.bond")).toBe(true);
    expect(keys.has("primary.bond.slaves.macAddress")).toBe(true);
    expect(keys.has("primary.ethernet.macAddress")).toBe(false);
    expect(keys.has("primary.vlan")).toBe(false);
    expect(keys.has("primary.ipv4Cidr")).toBe(false);
    expect(keys.has("primary.ipv4Gateway")).toBe(false);
    expect(keys.has("primary.ipv6Cidr")).toBe(false);
    expect(keys.has("primary.ipv6Gateway")).toBe(false);
  });

  it("vlan-on-ethernet + static + IPv4-only: type/mode/advanced + ethernet MAC + vlan + ipv4; no bond/ipv6", () => {
    const keys = getAvailableReplicateKeys({
      ...BASE_VIS, sourceNode: makeSourceNode("vlan-on-ethernet", "static"), enableIpv6: false,
    });
    expect(keys.has("primary.type")).toBe(true);
    expect(keys.has("primary.mode")).toBe(true);
    expect(keys.has("primary.advanced")).toBe(true);
    expect(keys.has("primary.ethernet.macAddress")).toBe(true);
    expect(keys.has("primary.vlan")).toBe(true);
    expect(keys.has("primary.ipv4Cidr")).toBe(true);
    expect(keys.has("primary.ipv4Gateway")).toBe(true);
    expect(keys.has("primary.bond")).toBe(false);
    expect(keys.has("primary.bond.slaves.macAddress")).toBe(false);
    expect(keys.has("primary.ipv6Cidr")).toBe(false);
    expect(keys.has("primary.ipv6Gateway")).toBe(false);
  });

  it("vlan-on-bond + static + dual-stack: type/mode/advanced + bond + vlan + ipv4 + ipv6; no ethernet MAC", () => {
    const keys = getAvailableReplicateKeys({
      ...BASE_VIS, sourceNode: makeSourceNode("vlan-on-bond", "static"), enableIpv6: true,
    });
    expect(keys.has("primary.type")).toBe(true);
    expect(keys.has("primary.mode")).toBe(true);
    expect(keys.has("primary.advanced")).toBe(true);
    expect(keys.has("primary.bond")).toBe(true);
    expect(keys.has("primary.bond.slaves.macAddress")).toBe(true);
    expect(keys.has("primary.vlan")).toBe(true);
    expect(keys.has("primary.ipv4Cidr")).toBe(true);
    expect(keys.has("primary.ipv4Gateway")).toBe(true);
    expect(keys.has("primary.ipv6Cidr")).toBe(true);
    expect(keys.has("primary.ipv6Gateway")).toBe(true);
    expect(keys.has("primary.ethernet.macAddress")).toBe(false);
  });

  it("ethernet + static + IPv4-only: ipv4 fields available, ipv6 fields absent", () => {
    const keys = getAvailableReplicateKeys({
      ...BASE_VIS, sourceNode: makeSourceNode("ethernet", "static"), enableIpv6: false,
    });
    expect(keys.has("primary.ipv4Cidr")).toBe(true);
    expect(keys.has("primary.ipv4Gateway")).toBe(true);
    expect(keys.has("primary.ipv6Cidr")).toBe(false);
    expect(keys.has("primary.ipv6Gateway")).toBe(false);
    expect(keys.has("primary.ethernet.macAddress")).toBe(true);
    expect(keys.has("primary.bond")).toBe(false);
  });

  it("bond + static + dual-stack: ipv4 + ipv6 fields available, ethernet MAC absent", () => {
    const keys = getAvailableReplicateKeys({
      ...BASE_VIS, sourceNode: makeSourceNode("bond", "static"), enableIpv6: true,
    });
    expect(keys.has("primary.ipv4Cidr")).toBe(true);
    expect(keys.has("primary.ipv4Gateway")).toBe(true);
    expect(keys.has("primary.ipv6Cidr")).toBe(true);
    expect(keys.has("primary.ipv6Gateway")).toBe(true);
    expect(keys.has("primary.bond")).toBe(true);
    expect(keys.has("primary.bond.slaves.macAddress")).toBe(true);
    expect(keys.has("primary.ethernet.macAddress")).toBe(false);
  });

  it("no sourceNode falls back to all primary keys (backward compatibility)", () => {
    const keys = getAvailableReplicateKeys(BASE_VIS);
    expect(keys.has("primary.type")).toBe(true);
    expect(keys.has("primary.mode")).toBe(true);
    expect(keys.has("primary.advanced")).toBe(true);
    expect(keys.has("primary.ethernet.macAddress")).toBe(true);
    expect(keys.has("primary.bond")).toBe(true);
    expect(keys.has("primary.bond.slaves.macAddress")).toBe(true);
    expect(keys.has("primary.vlan")).toBe(true);
    expect(keys.has("primary.ipv4Cidr")).toBe(true);
    expect(keys.has("primary.ipv4Gateway")).toBe(true);
    expect(keys.has("primary.ipv6Cidr")).toBe(true);
    expect(keys.has("primary.ipv6Gateway")).toBe(true);
  });

  it("IPI path ignores sourceNode (no primary networking for IPI)", () => {
    const keys = getAvailableReplicateKeys({
      showIpiDrawer: true, showBmc: true,
      showAgentHostname: false, showAgentDns: false,
      showAgentRootDeviceHints: false, showAgentPrimaryNetwork: false,
      showAgentDay2InstallConfigBmc: false, showAgentBmcCore: false, showAgentBootMac: false,
      sourceNode: makeSourceNode("bond", "static"), enableIpv6: true,
    });
    expect(keys.has("primary.type")).toBe(false);
    expect(keys.has("primary.bond")).toBe(false);
    expect(keys.has("hostname")).toBe(true);
    expect(keys.has("bmc")).toBe(true);
  });

  it("showAgentPrimaryNetwork false with sourceNode: no primary keys", () => {
    const keys = getAvailableReplicateKeys({
      ...BASE_VIS, showAgentPrimaryNetwork: false,
      sourceNode: makeSourceNode("ethernet", "dhcp"), enableIpv6: false,
    });
    expect(keys.has("primary.type")).toBe(false);
    expect(keys.has("primary.mode")).toBe(false);
    expect(keys.has("primary.ethernet.macAddress")).toBe(false);
    expect(keys.has("hostname")).toBe(true);
  });
});

describe("HB-004 structural application boundary (oversized selection)", () => {
  const AGENT_VIS = {
    showIpiDrawer: false,
    showAgentHostname: true,
    showAgentDns: true,
    showAgentRootDeviceHints: true,
    showAgentPrimaryNetwork: true,
    showBmc: false,
    showAgentDay2InstallConfigBmc: true,
    showAgentBmcCore: true,
    showAgentBootMac: true,
  };

  const ALL_PRIMARY_SELECTED = new Set([
    "primary.type",
    "primary.mode",
    "primary.advanced",
    "primary.ethernet.macAddress",
    "primary.bond",
    "primary.bond.slaves.macAddress",
    "primary.vlan",
    "primary.ipv4Cidr",
    "primary.ipv4Gateway",
    "primary.ipv6Cidr",
    "primary.ipv6Gateway",
  ]);

  function makeFullSource(typeOverride, modeOverride) {
    return {
      ...emptyNode("master", 0),
      primary: {
        type: typeOverride,
        mode: modeOverride,
        ipv4Cidr: "10.0.0.5/24",
        ipv4Gateway: "10.0.0.1",
        ipv6Cidr: "fd01::5/64",
        ipv6Gateway: "fd01::1",
        ethernet: { name: "eno0", macAddress: "aa:bb:cc:dd:ee:01" },
        bond: {
          name: "bond0", mode: "active-backup",
          slaves: [
            { name: "eno0", macAddress: "aa:bb:cc:dd:ee:02" },
            { name: "eno1", macAddress: "aa:bb:cc:dd:ee:03" },
          ],
        },
        vlan: { id: "100", baseIface: "eno0", name: "eno0.100" },
        advanced: { mtu: "9000", routes: [{ destination: "10.1.0.0/16", nextHop: "10.0.0.1" }] },
      },
    };
  }

  function makeTarget() {
    return {
      ...emptyNode("worker", 0),
      primary: {
        type: "TARGET-TYPE",
        mode: "TARGET-MODE",
        ipv4Cidr: "TARGET-V4CIDR",
        ipv4Gateway: "TARGET-V4GW",
        ipv6Cidr: "TARGET-V6CIDR",
        ipv6Gateway: "TARGET-V6GW",
        ethernet: { name: "TARGET-ENAME", macAddress: "TARGET-EMAC" },
        bond: {
          name: "TARGET-BNAME", mode: "TARGET-BMODE",
          slaves: [{ name: "TARGET-SNAME", macAddress: "TARGET-SMAC" }],
        },
        vlan: { id: "TARGET-VID", baseIface: "TARGET-VBASE", name: "TARGET-VNAME" },
        advanced: { mtu: "TARGET-MTU", routes: [{ destination: "TARGET-DEST", nextHop: "TARGET-NH" }] },
      },
    };
  }

  it("ethernet + DHCP: applies type/mode/advanced/ethernetMAC; blocks bond/vlan/ipv4/ipv6", () => {
    const source = makeFullSource("ethernet", "dhcp");
    const target = [makeTarget()];
    const available = getAvailableReplicateKeys({
      ...AGENT_VIS, sourceNode: source, enableIpv6: false,
    });
    const result = applyReplicateSettings(source, target, ALL_PRIMARY_SELECTED, available);
    expect(result[0].primary.type).toBe("ethernet");
    expect(result[0].primary.mode).toBe("dhcp");
    expect(result[0].primary.advanced.mtu).toBe("9000");
    expect(result[0].primary.advanced.routes[0].destination).toBe("10.1.0.0/16");
    expect(result[0].primary.ethernet.macAddress).toBe("aa:bb:cc:dd:ee:01");
    expect(result[0].primary.bond.name).toBe("TARGET-BNAME");
    expect(result[0].primary.bond.mode).toBe("TARGET-BMODE");
    expect(result[0].primary.bond.slaves[0].macAddress).toBe("TARGET-SMAC");
    expect(result[0].primary.vlan.id).toBe("TARGET-VID");
    expect(result[0].primary.ipv4Cidr).toBe("TARGET-V4CIDR");
    expect(result[0].primary.ipv4Gateway).toBe("TARGET-V4GW");
    expect(result[0].primary.ipv6Cidr).toBe("TARGET-V6CIDR");
    expect(result[0].primary.ipv6Gateway).toBe("TARGET-V6GW");
  });

  it("bond + DHCP: applies type/mode/advanced/bond+MACs; blocks ethernetMAC/vlan/ipv4/ipv6", () => {
    const source = makeFullSource("bond", "dhcp");
    const target = [makeTarget()];
    const available = getAvailableReplicateKeys({
      ...AGENT_VIS, sourceNode: source, enableIpv6: false,
    });
    const result = applyReplicateSettings(source, target, ALL_PRIMARY_SELECTED, available);
    expect(result[0].primary.type).toBe("bond");
    expect(result[0].primary.mode).toBe("dhcp");
    expect(result[0].primary.advanced.mtu).toBe("9000");
    expect(result[0].primary.bond.mode).toBe("active-backup");
    expect(result[0].primary.bond.name).toBe("bond0");
    expect(result[0].primary.bond.slaves).toHaveLength(2);
    expect(result[0].primary.bond.slaves[0].macAddress).toBe("aa:bb:cc:dd:ee:02");
    expect(result[0].primary.bond.slaves[1].macAddress).toBe("aa:bb:cc:dd:ee:03");
    expect(result[0].primary.ethernet.macAddress).toBe("TARGET-EMAC");
    expect(result[0].primary.vlan.id).toBe("TARGET-VID");
    expect(result[0].primary.ipv4Cidr).toBe("TARGET-V4CIDR");
    expect(result[0].primary.ipv4Gateway).toBe("TARGET-V4GW");
    expect(result[0].primary.ipv6Cidr).toBe("TARGET-V6CIDR");
    expect(result[0].primary.ipv6Gateway).toBe("TARGET-V6GW");
  });

  it("vlan-on-ethernet + static + IPv4: applies ethernetMAC/vlan/ipv4; blocks bond/ipv6", () => {
    const source = makeFullSource("vlan-on-ethernet", "static");
    const target = [makeTarget()];
    const available = getAvailableReplicateKeys({
      ...AGENT_VIS, sourceNode: source, enableIpv6: false,
    });
    const result = applyReplicateSettings(source, target, ALL_PRIMARY_SELECTED, available);
    expect(result[0].primary.type).toBe("vlan-on-ethernet");
    expect(result[0].primary.mode).toBe("static");
    expect(result[0].primary.advanced.mtu).toBe("9000");
    expect(result[0].primary.ethernet.macAddress).toBe("aa:bb:cc:dd:ee:01");
    expect(result[0].primary.vlan.id).toBe("100");
    expect(result[0].primary.vlan.baseIface).toBe("eno0");
    expect(result[0].primary.ipv4Cidr).toBe("10.0.0.5/24");
    expect(result[0].primary.ipv4Gateway).toBe("10.0.0.1");
    expect(result[0].primary.bond.name).toBe("TARGET-BNAME");
    expect(result[0].primary.bond.slaves[0].macAddress).toBe("TARGET-SMAC");
    expect(result[0].primary.ipv6Cidr).toBe("TARGET-V6CIDR");
    expect(result[0].primary.ipv6Gateway).toBe("TARGET-V6GW");
  });

  it("vlan-on-bond + static + dual-stack: applies bond/vlan/ipv4/ipv6; blocks ethernetMAC", () => {
    const source = makeFullSource("vlan-on-bond", "static");
    const target = [makeTarget()];
    const available = getAvailableReplicateKeys({
      ...AGENT_VIS, sourceNode: source, enableIpv6: true,
    });
    const result = applyReplicateSettings(source, target, ALL_PRIMARY_SELECTED, available);
    expect(result[0].primary.type).toBe("vlan-on-bond");
    expect(result[0].primary.mode).toBe("static");
    expect(result[0].primary.advanced.mtu).toBe("9000");
    expect(result[0].primary.bond.mode).toBe("active-backup");
    expect(result[0].primary.bond.name).toBe("bond0");
    expect(result[0].primary.bond.slaves[0].macAddress).toBe("aa:bb:cc:dd:ee:02");
    expect(result[0].primary.vlan.id).toBe("100");
    expect(result[0].primary.ipv4Cidr).toBe("10.0.0.5/24");
    expect(result[0].primary.ipv4Gateway).toBe("10.0.0.1");
    expect(result[0].primary.ipv6Cidr).toBe("fd01::5/64");
    expect(result[0].primary.ipv6Gateway).toBe("fd01::1");
    expect(result[0].primary.ethernet.macAddress).toBe("TARGET-EMAC");
  });
});
