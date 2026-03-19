/**
 * Placeholder-values mode for sensitive disconnected-environment inputs.
 *
 * This pass intentionally focuses on the host-inventory-driven bare metal flows:
 * - hostInventory.nodes[] (hostname, MACs, rootDevice, static IPs/gateways, BMC for IPI)
 * - hostInventory VIPs (apiVip/ingressVip and v6 variants)
 *
 * The placeholder patterns are deterministic and valid enough to satisfy the app-side
 * validation required for "connected-side" workflows to continue.
 */

const pad2 = (n) => String(n).padStart(2, "0");

export function placeholderMac(nodeIndex, salt = 0) {
  // Locally administered MAC range (52:54:* commonly used in docs/testing).
  const a = (0x10 + salt + nodeIndex) & 0xff;
  const b = (0x20 + salt + nodeIndex * 3) & 0xff;
  return `52:54:00:${pad2(a)}:${pad2(b)}:${pad2((0x30 + salt + nodeIndex * 7) & 0xff)}`;
}

export function placeholderV4(nodeIndex, hostOffset = 10) {
  // Use TEST-NET-1/2/3 style addresses to avoid collisions with real networks.
  return `192.0.2.${hostOffset + nodeIndex}`;
}

export function placeholderV6(nodeIndex, hostOffset = 10) {
  return `fd00::${hostOffset + nodeIndex}`;
}

function placeholderRootDevice(nodeIndex) {
  return `/dev/disk/by-id/placeholder-disk-${nodeIndex}`;
}

function placeholderBmcAddress(nodeIndex) {
  return `redfish+http://${placeholderV4(nodeIndex, 201)}/redfish/v1`;
}

function placeholderVipV4(kind) {
  // kind: "api" | "ingress"
  return kind === "api" ? "192.0.2.10" : "192.0.2.11";
}

function placeholderVipV6(kind) {
  return kind === "api" ? "fd00::10" : "fd00::11";
}

export function applyPlaceholderValuesToHostInventory(hostInventory, { platform, method }) {
  const hi = hostInventory || {};
  const enableIpv6 = Boolean(hi.enableIpv6);

  const nextNodes = (hi.nodes || []).map((node, idx) => {
    const n = { ...node };

    n.hostname = `placeholder-${node.role || "node"}-${idx}`;
    n.hostnameUseFqdn = false;
    n.rootDevice = placeholderRootDevice(idx);
    n.dnsServers = "192.0.2.53";
    n.dnsSearch = "example.local";
    n.additionalInterfaces = [];

    // MACs + static addressing for the primary interface.
    const primary = { ...(n.primary || {}) };
    if (primary?.ethernet) {
      primary.ethernet = {
        ...primary.ethernet,
        name: primary.ethernet.name || "eno0",
        macAddress: placeholderMac(idx, 1)
      };
    }
    if (primary?.bond) {
      const slaves = Array.isArray(primary.bond.slaves) && primary.bond.slaves.length >= 2
        ? primary.bond.slaves
        : [{ name: "eno0", macAddress: "" }, { name: "eno1", macAddress: "" }];
      primary.bond = {
        ...primary.bond,
        slaves: slaves.map((s, si) => ({
          ...s,
          name: s.name || `eno${si}`,
          macAddress: placeholderMac(idx, 2 + si)
        }))
      };
    }

    // Keep modes as the user selected (dhcp vs static), but ensure static fields validate when needed.
    primary.ipv4Cidr = primary.ipv4Cidr || `${placeholderV4(idx, 20)}/24`;
    primary.ipv4Gateway = primary.ipv4Gateway || `${placeholderV4(idx, 1)}`;
    if (enableIpv6) {
      primary.ipv6Cidr = primary.ipv6Cidr || `${placeholderV6(idx, 20)}/64`;
      primary.ipv6Gateway = primary.ipv6Gateway || placeholderV6(idx, 1);
    } else {
      // Avoid injecting IPv6 values when IPv6 is disabled in the run.
      primary.ipv6Cidr = "";
      primary.ipv6Gateway = "";
    }

    n.primary = primary;

    // Bare metal IPI provisioning needs BMC address + boot MAC (errors in app-side validation).
    if (platform === "Bare Metal" && method === "IPI" && n.bmc) {
      n.bmc = {
        ...n.bmc,
        address: placeholderBmcAddress(idx),
        username: n.bmc.username || "placeholder-user",
        password: n.bmc.password || "placeholder-pass",
        bootMACAddress: placeholderMac(idx, 9),
        disableCertificateVerification: false
      };
    }

    return n;
  });

  const next = {
    ...hi,
    nodes: nextNodes,
    apiVip: placeholderVipV4("api"),
    ingressVip: placeholderVipV4("ingress"),
    ...(enableIpv6
      ? { apiVipV6: placeholderVipV6("api"), ingressVipV6: placeholderVipV6("ingress") }
      : { apiVipV6: "", ingressVipV6: "" })
  };

  return next;
}

export function clearPlaceholderValuesFromHostInventory(hostInventory) {
  const hi = hostInventory || {};
  return {
    ...hi,
    nodes: (hi.nodes || []).map((node) => ({
      ...node,
      hostname: "",
      hostnameUseFqdn: false,
      rootDevice: "",
      dnsServers: "",
      dnsSearch: "",
      additionalInterfaces: [],
      bmc: node.bmc
        ? {
            ...node.bmc,
            address: "",
            username: "",
            password: "",
            bootMACAddress: ""
          }
        : node.bmc,
      primary: {
        ...(node.primary || {}),
        ipv4Cidr: "",
        ipv4Gateway: "",
        ipv6Cidr: "",
        ipv6Gateway: "",
        ethernet: node.primary?.ethernet ? { ...node.primary.ethernet, macAddress: "" } : node.primary?.ethernet,
        bond: node.primary?.bond
          ? {
              ...node.primary.bond,
              slaves: (node.primary.bond.slaves || []).map((s) => ({ ...s, macAddress: "" }))
            }
          : node.primary?.bond
      }
    })),
    apiVip: "",
    ingressVip: "",
    apiVipV6: "",
    ingressVipV6: ""
  };
}

