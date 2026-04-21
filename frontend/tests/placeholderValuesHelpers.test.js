import { describe, it, expect } from "vitest";
import {
  applyPlaceholderValuesToHostInventory,
  clearPlaceholderValuesFromHostInventory
} from "../src/placeholderValuesHelpers.js";

describe("placeholderValuesHelpers", () => {
  it("applyPlaceholderValuesToHostInventory populates sensitive hostInventory fields", () => {
    const hostInventory = {
      enableIpv6: true,
      nodes: [
        {
          role: "master",
          hostname: "",
          hostnameUseFqdn: false,
          rootDevice: "",
          dnsServers: "",
          dnsSearch: "",
          additionalInterfaces: [],
          primary: {
            type: "ethernet",
            mode: "dhcp",
            ethernet: { name: "", macAddress: "" },
            ipv4Cidr: "",
            ipv4Gateway: "",
            ipv6Cidr: "",
            ipv6Gateway: "",
            vlan: {},
            bond: null,
            advanced: { mtu: "", routes: [] }
          },
          bmc: { address: "", username: "", password: "", bootMACAddress: "", disableCertificateVerification: false }
        }
      ],
      apiVip: "",
      ingressVip: "",
      apiVipV6: "",
      ingressVipV6: ""
    };

    const out = applyPlaceholderValuesToHostInventory(hostInventory, { platform: "Bare Metal", method: "IPI" });

    expect(out.nodes).toHaveLength(1);
    expect(out.nodes[0].hostname).toMatch(/^placeholder-/);
    expect(out.nodes[0].rootDevice).toMatch(/^\/dev\/disk\/by-path\/pci-/);
    expect(out.nodes[0].primary.ethernet.name).toBe("eno0");
    expect(out.nodes[0].primary.ethernet.macAddress).toMatch(/^52:54:00:/);
    expect(out.nodes[0].bmc.address).toMatch(/^redfish\+http:\/\//);
    expect(out.nodes[0].bmc.bootMACAddress).toMatch(/^52:54:00:/);
    expect(out.apiVip).toMatch(/^192\.0\.2\./);
    expect(out.ingressVip).toMatch(/^192\.0\.2\./);
    expect(out.apiVipV6).toMatch(/^fd00::/);
    expect(out.ingressVipV6).toMatch(/^fd00::/);
  });

  it("clearPlaceholderValuesFromHostInventory removes placeholders without restoring", () => {
    const hostInventory = {
      enableIpv6: true,
      nodes: [
        {
          role: "master",
          hostname: "placeholder-x",
          hostnameUseFqdn: false,
          rootDevice: "/dev/disk/by-path/pci-0000:00:16.0-ata-1",
          dnsServers: "192.0.2.53",
          dnsSearch: "example.local",
          additionalInterfaces: [],
          primary: {
            type: "ethernet",
            mode: "static",
            ethernet: { name: "eno0", macAddress: "52:54:00:aa:bb:cc" },
            ipv4Cidr: "192.0.2.10/24",
            ipv4Gateway: "192.0.2.1",
            ipv6Cidr: "fd00::10/64",
            ipv6Gateway: "fd00::1",
            vlan: {},
            bond: null,
            advanced: { mtu: "1500", routes: [] }
          },
          bmc: {
            address: "redfish+http://192.0.2.201/redfish/v1",
            username: "placeholder-user",
            password: "placeholder-pass",
            bootMACAddress: "52:54:00:aa:bb:cc",
            disableCertificateVerification: false
          }
        }
      ],
      apiVip: "192.0.2.10",
      ingressVip: "192.0.2.11",
      apiVipV6: "fd00::10",
      ingressVipV6: "fd00::11"
    };

    const out = clearPlaceholderValuesFromHostInventory(hostInventory);
    expect(out.nodes[0].hostname).toBe("");
    expect(out.nodes[0].rootDevice).toBe("");
    expect(out.nodes[0].dnsServers).toBe("");
    expect(out.nodes[0].dnsSearch).toBe("");
    expect(out.nodes[0].primary.ethernet.macAddress).toBe("");
    expect(out.nodes[0].primary.ipv4Cidr).toBe("");
    expect(out.nodes[0].primary.ipv6Cidr).toBe("");
    expect(out.nodes[0].bmc.address).toBe("");
    expect(out.nodes[0].bmc.username).toBe("");
    expect(out.nodes[0].bmc.password).toBe("");
    expect(out.nodes[0].bmc.bootMACAddress).toBe("");
    expect(out.apiVip).toBe("");
    expect(out.ingressVip).toBe("");
    expect(out.apiVipV6).toBe("");
    expect(out.ingressVipV6).toBe("");
  });
});

