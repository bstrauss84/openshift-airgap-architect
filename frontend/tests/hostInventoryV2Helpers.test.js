import { describe, it, expect } from "vitest";
import {
  generateNodesFromCounts,
  applyReplicateSettings,
  emptyNode,
  getScenarioId,
  SCENARIO_IDS_WITH_HOST_INVENTORY
} from "../src/hostInventoryV2Helpers.js";

describe("getScenarioId / SCENARIO_IDS_WITH_HOST_INVENTORY", () => {
  it("maps VMware vSphere + Agent-Based Installer to vsphere-agent", () => {
    expect(getScenarioId("VMware vSphere", "Agent-Based Installer")).toBe("vsphere-agent");
  });
  it("includes vsphere-agent in host inventory scenarios", () => {
    expect(SCENARIO_IDS_WITH_HOST_INVENTORY).toContain("vsphere-agent");
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
    const result = applyReplicateSettings(source, targetNodes, selectedFields);
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
    const result = applyReplicateSettings(source, targetNodes, new Set(["hostname"]));
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
    const result = applyReplicateSettings(source, targetNodes, new Set(["primary.bond"]));
    expect(result[0].primary.bond.name).toBe("bond0");
    expect(result[0].primary.bond.mode).toBe("802.3ad");
    expect(result[0].primary.bond.slaves[0].macAddress).toBe("");
    expect(result[0].primary.bond.slaves[1].macAddress).toBe("");
  });
});
