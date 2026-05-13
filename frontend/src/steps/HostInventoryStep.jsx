/**
 * OpenShift Airgap Architect - Host Inventory Configuration Step (Legacy)
 *
 * Legacy host inventory step for bare metal deployments.
 * Manages host nodes, network interfaces (ethernet, bond, VLAN), BMC configuration,
 * and root device hints. Replaced by HostInventoryV2Step in newer flows.
 *
 * @author Bill Strauss
 *
 * Developed with AI assistance from Claude (Anthropic) and Cursor AI.
 */
import React from "react";
import { useApp } from "../store.jsx";
import { validateNode } from "../validation.js";
import { getScenarioId, SCENARIO_IDS_WITH_HOST_INVENTORY } from "../hostInventoryV2Helpers.js";

const PRIMARY_TYPES = [
  { id: "ethernet", label: "Single NIC ethernet" },
  { id: "bond", label: "Bond (LACP or active-backup)" },
  { id: "vlan-on-ethernet", label: "VLAN on ethernet" },
  { id: "vlan-on-bond", label: "VLAN on bond" }
];

const BOND_MODES = ["active-backup", "802.3ad"];

const createInterfaceConfig = (overrides = {}) => ({
  type: "ethernet",
  mode: "dhcp",
  ipv4Cidr: "",
  ipv4Gateway: "",
  ipv6Cidr: "",
  ipv6Gateway: "",
  ethernet: { name: "eth0", macAddress: "" },
  bond: {
    name: "bond0",
    mode: "active-backup",
    slaves: [
      { name: "eth0", macAddress: "" },
      { name: "eth1", macAddress: "" }
    ]
  },
  vlan: { id: "", baseIface: "", name: "" },
  advanced: {
    mtu: "1500",
    sriov: { enabled: false, totalVfs: "" },
    vrf: { enabled: false, name: "vrf0", tableId: "100", ports: "" },
    routes: []
  },
  ...overrides
});

const emptyNode = (role, index) => ({
  role,
  hostname: `${role}-${index}`,
  rootDevice: "",
  dnsServers: "",
  dnsSearch: "",
  bmc: { address: "", username: "", password: "", bootMACAddress: "" },
  primary: createInterfaceConfig(),
  additionalInterfaces: []
});

const toInt = (addr) => addr.split(".").reduce((acc, oct) => (acc << 8) + Number(oct), 0) >>> 0;
const toIp = (value) =>
  [value >>> 24, (value >>> 16) & 255, (value >>> 8) & 255, value & 255].join(".");

const deriveNetworkHints = (cidr) => {
  if (!cidr || !cidr.includes("/")) return null;
  const [ip, prefix] = cidr.split("/");
  if (!/^\d+\.\d+\.\d+\.\d+$/.test(ip)) return null;
  const bits = Number(prefix);
  if (Number.isNaN(bits) || bits < 16 || bits > 30) return null;
  const mask = bits === 0 ? 0 : (-1 << (32 - bits)) >>> 0;
  const base = toInt(ip) & mask;
  return {
    base,
    gateway: toIp(base + 1),
    apiVip: toIp(base + 4),
    ingressVip: toIp(base + 5),
    dnsServers: `${toIp(base + 10)},${toIp(base + 11)}`
  };
};

const HostInventoryStep = ({ previewControls, previewEnabled, highlightErrors }) => {
  const { state, updateState } = useApp();
  const inventory = state.hostInventory || {};
  const nodes = inventory.nodes || [];
  const platform = state.blueprint?.platform;
  const method = state.methodology?.method;
  const showBmc = platform === "Bare Metal" && method === "IPI";
  const scenarioIdLegacy = getScenarioId(platform, method);
  const showInventory = Boolean(scenarioIdLegacy && SCENARIO_IDS_WITH_HOST_INVENTORY.includes(scenarioIdLegacy));
  const machineCidr = state.globalStrategy?.networking?.machineNetworkV4 || "";
  const networkHints = deriveNetworkHints(machineCidr);
  const nodeIpv4Placeholder = (role, index) => {
    if (!networkHints) return "192.168.1.20/24";
    const baseOffset = role === "master" ? 20 : 30;
    return `${toIp(networkHints.base + baseOffset + index)}/${machineCidr.split("/")[1]}`;
  };
  const enableIpv6 = !!inventory.enableIpv6;
  const [showHostInfo, setShowHostInfo] = React.useState(false);
  const [copiedCommand, setCopiedCommand] = React.useState("");
  const [showReplicate, setShowReplicate] = React.useState(false);
  const [replicateSource, setReplicateSource] = React.useState(0);
  const [advancedOpen, setAdvancedOpen] = React.useState({});
  const [nodeValidation, setNodeValidation] = React.useState({});
  const needsReview = state.reviewFlags?.inventory && state.ui?.visitedSteps?.inventory;

  // Local state for VIP fields
  const [localApiVip, setLocalApiVip] = React.useState("");
  const [localIngressVip, setLocalIngressVip] = React.useState("");

  // Local state for all node text fields (indexed by node index)
  const [localNodeFields, setLocalNodeFields] = React.useState({});

  // Sync local VIP state with store
  React.useEffect(() => {
    setLocalApiVip(inventory.apiVip || "");
    setLocalIngressVip(inventory.ingressVip || "");
  }, [inventory.apiVip, inventory.ingressVip]);

  // Sync local node fields with store
  React.useEffect(() => {
    const newLocalFields = {};
    nodes.forEach((node, index) => {
      newLocalFields[index] = {
        hostname: node.hostname || "",
        rootDevice: node.rootDevice || "",
        dnsServers: node.dnsServers || "",
        dnsSearch: node.dnsSearch || "",
        bmc: {
          address: node.bmc?.address || "",
          username: node.bmc?.username || "",
          password: node.bmc?.password || "",
          bootMACAddress: node.bmc?.bootMACAddress || ""
        },
        primary: {
          ipv4Cidr: node.primary?.ipv4Cidr || "",
          ipv4Gateway: node.primary?.ipv4Gateway || "",
          ipv6Cidr: node.primary?.ipv6Cidr || "",
          ipv6Gateway: node.primary?.ipv6Gateway || "",
          ethernet: {
            name: node.primary?.ethernet?.name || "",
            macAddress: node.primary?.ethernet?.macAddress || ""
          },
          bond: {
            name: node.primary?.bond?.name || "",
            slaves: (node.primary?.bond?.slaves || []).map(s => ({
              name: s.name || "",
              macAddress: s.macAddress || ""
            }))
          },
          vlan: {
            id: node.primary?.vlan?.id || "",
            name: node.primary?.vlan?.name || ""
          },
          advanced: {
            mtu: node.primary?.advanced?.mtu || "",
            sriov: {
              totalVfs: node.primary?.advanced?.sriov?.totalVfs || ""
            },
            vrf: {
              name: node.primary?.advanced?.vrf?.name || "vrf0",
              tableId: node.primary?.advanced?.vrf?.tableId || "100",
              ports: node.primary?.advanced?.vrf?.ports || ""
            },
            routes: (node.primary?.advanced?.routes || []).map(r => ({
              destination: r.destination || "",
              nextHopAddress: r.nextHopAddress || "",
              nextHopInterface: r.nextHopInterface || ""
            }))
          }
        },
        additionalInterfaces: (node.additionalInterfaces || []).map(iface => ({
          ethernet: {
            name: iface.ethernet?.name || "",
            macAddress: iface.ethernet?.macAddress || ""
          },
          bond: {
            name: iface.bond?.name || "",
            slaves: (iface.bond?.slaves || []).map(s => ({
              name: s.name || "",
              macAddress: s.macAddress || ""
            }))
          },
          vlan: {
            id: iface.vlan?.id || "",
            name: iface.vlan?.name || ""
          },
          ipv4Cidr: iface.ipv4Cidr || "",
          ipv6Cidr: iface.ipv6Cidr || "",
          advanced: {
            mtu: iface.advanced?.mtu || "",
            sriov: {
              totalVfs: iface.advanced?.sriov?.totalVfs || ""
            },
            vrf: {
              name: iface.advanced?.vrf?.name || "vrf0",
              tableId: iface.advanced?.vrf?.tableId || "100",
              ports: iface.advanced?.vrf?.ports || ""
            }
          }
        }))
      };
    });
    setLocalNodeFields(newLocalFields);
  }, [nodes]);
  const copyCommand = (key, text) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopiedCommand(key);
      setTimeout(() => setCopiedCommand(""), 1500);
    });
  };

  const updateInventory = (patch) => updateState({ hostInventory: { ...inventory, ...patch } });

  const countRole = (role) => nodes.filter((node) => node.role === role).length;

  const addControlPlane = () => {
    const index = countRole("master");
    updateInventory({ nodes: [...nodes, { ...emptyNode("master", index), role: "master" }] });
  };

  const addWorker = () => {
    const index = countRole("worker");
    updateInventory({ nodes: [...nodes, { ...emptyNode("worker", index), role: "worker" }] });
  };

  const updateNode = (idx, patch) => {
    const next = nodes.map((node, i) => {
      if (i !== idx) return node;
      if (typeof patch === "function") return patch(node);
      return { ...node, ...patch };
    });
    updateInventory({ nodes: next });
  };

  const updatePrimary = (nodeIndex, patch) =>
    updateNode(nodeIndex, (node) => ({ ...node, primary: { ...node.primary, ...patch } }));

  const updatePrimaryEthernet = (nodeIndex, patch) =>
    updateNode(nodeIndex, (node) => ({
      ...node,
      primary: { ...node.primary, ethernet: { ...node.primary.ethernet, ...patch } }
    }));

  const updatePrimaryBond = (nodeIndex, patch) =>
    updateNode(nodeIndex, (node) => ({
      ...node,
      primary: { ...node.primary, bond: { ...node.primary.bond, ...patch } }
    }));

  const updatePrimaryVlan = (nodeIndex, patch) =>
    updateNode(nodeIndex, (node) => ({
      ...node,
      primary: { ...node.primary, vlan: { ...node.primary.vlan, ...patch } }
    }));

  const updatePrimaryAdvanced = (nodeIndex, patch) =>
    updateNode(nodeIndex, (node) => ({
      ...node,
      primary: { ...node.primary, advanced: { ...node.primary.advanced, ...patch } }
    }));

  const updatePrimaryRoute = (nodeIndex, routeIndex, patch) =>
    updateNode(nodeIndex, (node) => {
      const routes = (node.primary.advanced.routes || []).map((route, i) => (i === routeIndex ? { ...route, ...patch } : route));
      return { ...node, primary: { ...node.primary, advanced: { ...node.primary.advanced, routes } } };
    });

  const addPrimaryRoute = (nodeIndex) =>
    updateNode(nodeIndex, (node) => ({
      ...node,
      primary: {
        ...node.primary,
        advanced: {
          ...node.primary.advanced,
          routes: [...(node.primary.advanced.routes || []), { destination: "", nextHopAddress: "", nextHopInterface: "" }]
        }
      }
    }));

  const removePrimaryRoute = (nodeIndex, routeIndex) =>
    updateNode(nodeIndex, (node) => ({
      ...node,
      primary: {
        ...node.primary,
        advanced: {
          ...node.primary.advanced,
          routes: (node.primary.advanced.routes || []).filter((_, i) => i !== routeIndex)
        }
      }
    }));

  const updateBondSlave = (nodeIndex, slaveIndex, patch) =>
    updateNode(nodeIndex, (node) => {
      const slaves = node.primary.bond.slaves.map((slave, i) => (i === slaveIndex ? { ...slave, ...patch } : slave));
      return { ...node, primary: { ...node.primary, bond: { ...node.primary.bond, slaves } } };
    });

  const addBondSlave = (nodeIndex) =>
    updateNode(nodeIndex, (node) => ({
      ...node,
      primary: {
        ...node.primary,
        bond: { ...node.primary.bond, slaves: [...node.primary.bond.slaves, { name: "", macAddress: "" }] }
      }
    }));

  const removeBondSlave = (nodeIndex, slaveIndex) =>
    updateNode(nodeIndex, (node) => ({
      ...node,
      primary: { ...node.primary, bond: { ...node.primary.bond, slaves: node.primary.bond.slaves.filter((_, i) => i !== slaveIndex) } }
    }));

  const updateAdditionalInterface = (nodeIndex, ifaceIndex, patch) =>
    updateNode(nodeIndex, (node) => {
      const nextIfaces = (node.additionalInterfaces || []).map((iface, i) => (i === ifaceIndex ? { ...iface, ...patch } : iface));
      return { ...node, additionalInterfaces: nextIfaces };
    });

  const addAdditionalInterface = (nodeIndex) =>
    updateNode(nodeIndex, (node) => ({
      ...node,
      additionalInterfaces: [...(node.additionalInterfaces || []), createInterfaceConfig({ type: "ethernet" })]
    }));

  const removeAdditionalInterface = (nodeIndex, ifaceIndex) =>
    updateNode(nodeIndex, (node) => ({
      ...node,
      additionalInterfaces: (node.additionalInterfaces || []).filter((_, i) => i !== ifaceIndex)
    }));

  const removeNode = (idx) => updateInventory({ nodes: nodes.filter((_, i) => i !== idx) });
  const sortedNodes = nodes
    .map((node, index) => ({ node, index }))
    .sort((a, b) => {
      if (a.node.role !== b.node.role) return a.node.role === "master" ? -1 : 1;
      const aMatch = a.node.hostname?.match(/-(\d+)$/);
      const bMatch = b.node.hostname?.match(/-(\d+)$/);
      if (aMatch && bMatch) return Number(aMatch[1]) - Number(bMatch[1]);
      return a.node.hostname.localeCompare(b.node.hostname);
    });

  const ipInCidr = (ipCidr, cidr) => {
    const ip = ipCidr.split("/")[0];
    if (!ip || !cidr || !cidr.includes("/")) return true;
    if (ip.includes(":")) return true;
    const [range, bits] = cidr.split("/");
    const mask = -1 << (32 - Number(bits));
    const toInt = (addr) => addr.split(".").reduce((acc, oct) => (acc << 8) + Number(oct), 0) >>> 0;
    return (toInt(ip) & mask) === (toInt(range) & mask);
  };

  const normalizeInventory = (inv) => {
    if (!inv || inv.schemaVersion === 2) return inv;
    const nodes = (inv.nodes || []).map((node, index) => {
      if (node.primary) return node;
      const macList = (node.macAddresses || node.macAddress || "")
        .split(",")
        .map((entry) => entry.trim())
        .filter(Boolean);
      const primaryType = node.bonding?.enabled && node.vlanId
        ? "vlan-on-bond"
        : node.bonding?.enabled
          ? "bond"
          : node.vlanId
            ? "vlan-on-ethernet"
            : "ethernet";
      const primary = createInterfaceConfig({
        type: primaryType,
        mode: node.netMode || "dhcp",
        ipv4Cidr: node.staticIP || "",
        ipv4Gateway: node.defaultRouteGateway || "",
        ipv6Cidr: node.staticIPv6 || "",
        ipv6Gateway: node.defaultRouteGatewayV6 || ""
      });
      primary.ethernet = {
        name: node.primaryNic || "eth0",
        macAddress: macList[0] || ""
      };
      primary.bond = {
        name: node.bonding?.name || "bond0",
        mode: node.bonding?.mode || "active-backup",
        slaves: (node.bonding?.slaves || ["eth0", "eth1"]).map((name, idx) => ({ name, macAddress: macList[idx] || "" }))
      };
      primary.vlan = {
        id: node.vlanId || "",
        baseIface: node.vlanBaseIface || "",
        name: ""
      };
      primary.advanced = {
        ...primary.advanced,
        mtu: node.mtu || node.vlanMtu || "",
        sriov: node.sriov || primary.advanced.sriov,
        vrf: node.vrf || primary.advanced.vrf,
        routes: (node.staticRoutes || []).map((route) => ({
          destination: route.destination || "",
          nextHopAddress: route.nextHopAddress || "",
          nextHopInterface: route.nextHopInterface || ""
        }))
      };
      return {
        role: node.role || "worker",
        hostname: node.hostname || `${node.role || "node"}-${index}`,
        rootDevice: node.rootDevice || "",
        dnsServers: node.dnsServers || "",
        dnsSearch: node.dnsSearch || "",
        bmc: node.bmc || { address: "", username: "", password: "", bootMACAddress: "" },
        primary,
        additionalInterfaces: []
      };
    });
    return { ...inv, schemaVersion: 2, enableIpv6: Boolean(inv.enableIpv6), nodes };
  };

  React.useEffect(() => {
    const normalized = normalizeInventory(inventory);
    if (normalized !== inventory) {
      updateState({ hostInventory: normalized });
    }
  }, []);

  const suggestedVlanName = (baseIface, vlanId) => (baseIface && vlanId ? `${baseIface}.${vlanId}` : "");
  const primaryBaseIface = (node) => {
    if (node.primary.type === "bond" || node.primary.type === "vlan-on-bond") return node.primary.bond.name || "bond0";
    return node.primary.ethernet.name || "eth0";
  };

  const applyReplicate = () => {
    const source = nodes[replicateSource];
    if (!source) return;
    const next = nodes.map((node, idx) => {
      if (idx === replicateSource) return node;
      return {
        ...node,
        dnsServers: source.dnsServers,
        dnsSearch: source.dnsSearch,
        primary: {
          ...node.primary,
          type: source.primary.type,
          mode: source.primary.mode,
          ipv4Gateway: source.primary.ipv4Gateway,
          ipv6Gateway: source.primary.ipv6Gateway,
          vlan: {
            ...node.primary.vlan,
            id: source.primary.vlan.id,
            baseIface: source.primary.vlan.baseIface
          },
          bond: {
            ...node.primary.bond,
            mode: source.primary.bond.mode,
            slaves: source.primary.bond.slaves.map((slave) => ({ ...slave, macAddress: "" }))
          },
          advanced: {
            ...node.primary.advanced,
            mtu: source.primary.advanced.mtu
          }
        }
      };
    });
    updateInventory({ nodes: next });
    setShowReplicate(false);
  };

  const runNodeValidation = (nodeIndex, node) => {
    const result = validateNode({
      node,
      enableIpv6,
      machineCidr,
      platform,
      method
    });

    // Check for duplicate hostnames across all nodes
    const hostname = (node.hostname || "").trim();
    if (hostname) {
      const duplicateIndices = nodes
        .map((n, idx) => ({ hostname: (n.hostname || "").trim(), idx }))
        .filter(({ hostname: h, idx }) => h === hostname && idx !== nodeIndex)
        .map(({ idx }) => idx);

      if (duplicateIndices.length > 0) {
        const duplicateMsg = `Duplicate hostname "${hostname}" (also used by node ${duplicateIndices.map(i => i + 1).join(", ")})`;
        result.errors.push(duplicateMsg);
        result.fieldErrors.hostname = duplicateMsg;
      }
    }

    setNodeValidation((prev) => ({ ...prev, [nodeIndex]: result }));
  };

  const runAllValidations = () => {
    nodes.forEach((node, idx) => runNodeValidation(idx, node));
  };

  // Helper to update local node field
  const updateLocalNodeField = (nodeIndex, path, value) => {
    setLocalNodeFields(prev => {
      const newFields = { ...prev };
      if (!newFields[nodeIndex]) return prev;

      const pathParts = path.split('.');
      let current = newFields[nodeIndex];

      for (let i = 0; i < pathParts.length - 1; i++) {
        const part = pathParts[i];
        if (!current[part]) return prev;
        current = current[part];
      }

      current[pathParts[pathParts.length - 1]] = value;
      return newFields;
    });
  };

  // Helper to normalize MAC addresses
  const normalizeMAC = (mac) => {
    const cleaned = mac.replace(/[^0-9a-fA-F]/g, "");
    if (cleaned.length === 0) return "";
    if (cleaned.length !== 12) return mac;
    return cleaned.match(/.{1,2}/g).join(":").toLowerCase();
  };

  return (
    <div className="step">
      <div className="step-header sticky">
        <div className="step-header-main">
          <h2>Host Inventory</h2>
          <p className="subtle">Add nodes and networking details for agent-based bare metal installs.</p>
        </div>
        <div className="header-actions">
          <button className="primary control-plane" onClick={addControlPlane}>Add Control Plane Node</button>
          <button className="primary worker" onClick={addWorker}>Add Worker Node</button>
          <button className="ghost" onClick={runAllValidations} disabled={!nodes.length}>
            Validate All Nodes
          </button>
          <button className="ghost" onClick={() => setShowReplicate(true)} disabled={!nodes.length}>
            Replicate Shared Networking Settings
          </button>
        </div>
      </div>

      <div className="step-body">
        {!showInventory ? (
          <div className="banner">
            Host Inventory applies to bare metal agent-based installs (and bare metal IPI for BMC details). Select Bare Metal to configure hosts.
          </div>
        ) : null}
        {!showInventory ? null : (
        <>
        {needsReview ? (
          <div className="banner warning">
            Version or upstream selections changed. Review this page to ensure settings are still valid.
            <div className="actions">
              <button
                className="ghost"
                onClick={() => updateState({ reviewFlags: { ...state.reviewFlags, inventory: false } })}
              >
                Re-evaluate this page
              </button>
            </div>
          </div>
        ) : null}
        <section className={`card ${highlightErrors ? "highlight-errors" : ""}`}>
          <h3>Cluster VIPs</h3>
          <div className="field-grid">
            <label>
              API VIP
              <input
                value={localApiVip}
                onChange={(e) => setLocalApiVip(e.target.value)}
                onBlur={(e) => {
                  const newValue = e.target.value.trim();
                  if (newValue !== (inventory.apiVip || "")) {
                    updateInventory({ apiVip: newValue });
                  }
                }}
                placeholder={networkHints?.apiVip || "192.168.1.5"}
              />
            </label>
            <label>
              Ingress VIP
              <input
                value={localIngressVip}
                onChange={(e) => setLocalIngressVip(e.target.value)}
                onBlur={(e) => {
                  const newValue = e.target.value.trim();
                  if (newValue !== (inventory.ingressVip || "")) {
                    updateInventory({ ingressVip: newValue });
                  }
                }}
                placeholder={networkHints?.ingressVip || "192.168.1.7"}
              />
            </label>
            {showBmc ? (
              <label>
                Provisioning network (IPI)
                <select
                  value={inventory.provisioningNetwork || "Managed"}
                  onChange={(e) => updateInventory({ provisioningNetwork: e.target.value })}
                >
                  <option value="Managed">Managed (installer provisions DHCP)</option>
                  <option value="Unmanaged">Unmanaged (you provide DHCP)</option>
                  <option value="Disabled">Disabled (e.g. static provisioning)</option>
                </select>
                <div className="note">For disconnected, Unmanaged or Disabled is often used with pre-provisioned RHCOS.</div>
              </label>
            ) : null}
          </div>
        </section>

        <section className="card">
          <div className="card-header">
            <h3>How to gather host info (recommended)</h3>
            <button className="ghost" onClick={() => setShowHostInfo((prev) => !prev)}>
              {showHostInfo ? "Collapse" : "Expand"}
            </button>
          </div>
          {showHostInfo ? (
            <div className="list">
              <div className="note">
                Boot each bare metal host with a RHEL 9+ (or Fedora) live ISO first. Log in and run the commands
                below to record interface names/MACs/MTU and stable disk IDs before installing OpenShift.
              </div>
              <div className="list">
                <div className="subtle">Interfaces (name, state, MTU, MAC):</div>
                <div className="code-block">
                  <div className="code-header">
                    <span>List interfaces and MACs</span>
                    <button
                      className="ghost copy-button"
                      onClick={() =>
                        copyCommand(
                          "ifaces",
                          "for i in /sys/class/net/*; do iface=$(basename \"$i\"); [ \"$iface\" = \"lo\" ] && continue; state=$(cat \"/sys/class/net/$iface/operstate\"); mtu=$(cat \"/sys/class/net/$iface/mtu\"); mac=$(cat \"/sys/class/net/$iface/address\"); printf \"%s\\t%s\\tmtu=%s\\t%s\\n\" \"$iface\" \"$state\" \"$mtu\" \"$mac\"; done"
                        )
                      }
                    >
                      {copiedCommand === "ifaces" ? "Copied" : "Copy"}
                    </button>
                  </div>
                  <pre className="code">for i in /sys/class/net/*; do
  iface=$(basename "$i")
  [ "$iface" = "lo" ] && continue
  state=$(cat "/sys/class/net/$iface/operstate")
  mtu=$(cat "/sys/class/net/$iface/mtu")
  mac=$(cat "/sys/class/net/$iface/address")
  printf "%s\t%s\tmtu=%s\t%s\n" "$iface" "$state" "$mtu" "$mac"
done</pre>
                </div>

                <div className="subtle">Root device hints inventory (all supported subfields):</div>
                <div className="code-block">
                  <div className="code-header">
                    <span>Per-disk rootDeviceHints values (4.20)</span>
                    <button
                      className="ghost copy-button"
                      onClick={() =>
                        copyCommand(
                          "rdh",
                          "for name in $(lsblk -dn -o NAME,TYPE | awk '$2==\"disk\"{print $1}'); do dev=\"/dev/$name\"; props=$(udevadm info --query=property --name=\"$dev\" 2>/dev/null); id_path=$(printf \"%s\\n\" \"$props\" | awk -F= '/^ID_PATH=/{print $2; exit}'); model=$(printf \"%s\\n\" \"$props\" | awk -F= '/^ID_MODEL=/{print $2; exit}'); vendor=$(printf \"%s\\n\" \"$props\" | awk -F= '/^ID_VENDOR=/{print $2; exit}'); serial=$(printf \"%s\\n\" \"$props\" | awk -F= '/^ID_SERIAL_SHORT=/{print $2; exit}'); [ -z \"$serial\" ] && serial=$(printf \"%s\\n\" \"$props\" | awk -F= '/^ID_SERIAL=/{print $2; exit}'); wwn=$(printf \"%s\\n\" \"$props\" | awk -F= '/^ID_WWN_WITH_EXTENSION=/{print $2; exit}'); [ -z \"$wwn\" ] && wwn=$(printf \"%s\\n\" \"$props\" | awk -F= '/^ID_WWN=/{print $2; exit}'); hctl=$(cat \"/sys/block/$name/device/hctl\" 2>/dev/null || true); rota=$(cat \"/sys/block/$name/queue/rotational\" 2>/dev/null || echo \"\"); size_bytes=$(lsblk -dn -b -o SIZE \"$dev\" 2>/dev/null || echo \"\"); size_gb=\"\"; [ -n \"$size_bytes\" ] && size_gb=$((size_bytes / 1024 / 1024 / 1024)); printf \"\\n=== %s ===\\n\" \"$dev\"; printf \"deviceName (preferred): %s\\n\" \"${id_path:+/dev/disk/by-path/$id_path}\"; [ -z \"$id_path\" ] && printf \"deviceName (fallback): %s\\n\" \"$dev\"; printf \"hctl: %s\\n\" \"${hctl:-not found}\"; printf \"model: %s\\n\" \"${model:-not found}\"; printf \"vendor: %s\\n\" \"${vendor:-not found}\"; printf \"serialNumber: %s\\n\" \"${serial:-not found}\"; printf \"wwn: %s\\n\" \"${wwn:-not found}\"; printf \"rotational: %s\\n\" \"$( [ \"$rota\" = \"1\" ] && echo true || [ \"$rota\" = \"0\" ] && echo false || echo not\\ found )\"; printf \"minSizeGigabytes: %s\\n\" \"${size_gb:-not found}\"; done"
                        )
                      }
                    >
                      {copiedCommand === "rdh" ? "Copied" : "Copy"}
                    </button>
                  </div>
                  <pre className="code">{`for name in $(lsblk -dn -o NAME,TYPE | awk '$2=="disk"{print $1}'); do
  dev="/dev/$name"
  props=$(udevadm info --query=property --name="$dev" 2>/dev/null)
  id_path=$(printf "%s\n" "$props" | awk -F= '/^ID_PATH=/{print $2; exit}')
  model=$(printf "%s\n" "$props" | awk -F= '/^ID_MODEL=/{print $2; exit}')
  vendor=$(printf "%s\n" "$props" | awk -F= '/^ID_VENDOR=/{print $2; exit}')
  serial=$(printf "%s\n" "$props" | awk -F= '/^ID_SERIAL_SHORT=/{print $2; exit}')
  [ -z "$serial" ] && serial=$(printf "%s\n" "$props" | awk -F= '/^ID_SERIAL=/{print $2; exit}')
  wwn=$(printf "%s\n" "$props" | awk -F= '/^ID_WWN_WITH_EXTENSION=/{print $2; exit}')
  [ -z "$wwn" ] && wwn=$(printf "%s\n" "$props" | awk -F= '/^ID_WWN=/{print $2; exit}')
  hctl=$(cat "/sys/block/$name/device/hctl" 2>/dev/null || true)
  rota=$(cat "/sys/block/$name/queue/rotational" 2>/dev/null || echo "")
  size_bytes=$(lsblk -dn -b -o SIZE "$dev" 2>/dev/null || echo "")
  size_gb=""
  [ -n "$size_bytes" ] && size_gb=$((size_bytes / 1024 / 1024 / 1024))
  printf "\n=== %s ===\n" "$dev"
  printf "deviceName (preferred): %s\n" "\${id_path:+/dev/disk/by-path/$id_path}"
  [ -z "$id_path" ] && printf "deviceName (fallback): %s\n" "$dev"
  printf "hctl: %s\n" "\${hctl:-not found}"
  printf "model: %s\n" "\${model:-not found}"
  printf "vendor: %s\n" "\${vendor:-not found}"
  printf "serialNumber: %s\n" "\${serial:-not found}"
  printf "wwn: %s\n" "\${wwn:-not found}"
  printf "rotational: %s\n" "$( [ "$rota" = "1" ] && echo true || [ "$rota" = "0" ] && echo false || echo not\ found )"
  printf "minSizeGigabytes: %s\n" "\${size_gb:-not found}"
done`}</pre>
                </div>
                <div className="note">
                  OpenShift 4.20 allows combining multiple root device hints; the selected disk must satisfy all provided hints. For
                  <code>wwn</code>, use <code>ID_WWN_WITH_EXTENSION</code> when present.
                </div>

                <div className="subtle">Check if a disk has existing data/signatures:</div>
                <div className="code-block">
                  <div className="code-header">
                    <span>Check for signatures (non-destructive)</span>
                    <button
                      className="ghost copy-button"
                      onClick={() =>
                        copyCommand(
                          "wipefs",
                          "wipefs -n /dev/sdX"
                        )
                      }
                    >
                      {copiedCommand === "wipefs" ? "Copied" : "Copy"}
                    </button>
                  </div>
                  <pre className="code">wipefs -n /dev/sdX</pre>
                </div>

                <div className="subtle">Wipe a target disk (destructive):</div>
                <div className="code-block">
                  <div className="code-header">
                    <span>Remove all partition/signature data</span>
                    <button
                      className="ghost copy-button"
                      onClick={() =>
                        copyCommand(
                          "zap",
                          "sgdisk --zap-all /dev/sdX\nwipefs -a /dev/sdX"
                        )
                      }
                    >
                      {copiedCommand === "zap" ? "Copied" : "Copy"}
                    </button>
                  </div>
                  <pre className="code">sgdisk --zap-all /dev/sdX
wipefs -a /dev/sdX</pre>
                </div>
                <div className="note warning">
                  Warning: Wiping a disk is destructive and irreversible. Double-check the device name.
                </div>
              </div>
            </div>
          ) : null}
        </section>

        {sortedNodes.map(({ node, index }, displayIndex) => {
          const baseIface = primaryBaseIface(node);
          const vlanNameSuggestion = suggestedVlanName(node.primary.vlan.baseIface || baseIface, node.primary.vlan.id);
          const vlanName = node.primary.vlan.name || vlanNameSuggestion;
          const advKey = `${index}`;
          const advOpen = Boolean(advancedOpen[advKey]);
          const primaryMode = node.primary.mode;
          const showIpv6 = enableIpv6;
          const primaryStatic = primaryMode === "static";
          const primaryIpv4 = node.primary.ipv4Cidr;

          const validation = nodeValidation[index];
          const fieldError = (field) => validation?.fieldErrors?.[field];
          const statusLabel = validation
            ? validation.errors.length
              ? "Errors"
              : validation.warnings.length
                ? "Warnings"
                : "Valid"
            : "Not validated";

          return (
            <section
              key={index}
              className={`card node-card ${node.role === "master" ? "node-master" : "node-worker"} ${
                highlightErrors && validation?.errors?.length ? "highlight-errors" : ""
              }`}
            >
              <div className="card-header">
                <h3>{node.role === "master" ? "Control Plane" : "Worker"} Node {displayIndex + 1}</h3>
                <div className="header-actions">
                  <div className={`badge ${validation?.errors?.length ? "warning" : ""}`}>{statusLabel}</div>
                  <button className="ghost" onClick={() => runNodeValidation(index, node)}>Validate this node</button>
                  <button className="ghost" onClick={() => removeNode(index)}>Remove</button>
                </div>
              </div>
              {validation ? (
                <div className="list">
                  {validation.errors.map((item, idx) => (
                    <div key={`node-error-${idx}`} className="note warning">{item}</div>
                  ))}
                  {validation.warnings.map((item, idx) => (
                    <div key={`node-warning-${idx}`} className="note">{item}</div>
                  ))}
                </div>
              ) : null}
              <div className="field-grid">
                <label>
                  Role
                  <select value={node.role} onChange={(e) => updateNode(index, { role: e.target.value })}>
                    <option value="master">master</option>
                    <option value="worker">worker</option>
                  </select>
                </label>
                <label>
                  Hostname
                  <input
                    value={localNodeFields[index]?.hostname ?? node.hostname}
                    onChange={(e) => updateLocalNodeField(index, 'hostname', e.target.value)}
                    onBlur={(e) => {
                      const newValue = e.target.value.trim();
                      if (newValue !== node.hostname) {
                        updateNode(index, { hostname: newValue });
                      }
                      runNodeValidation(index, node);
                    }}
                    className={fieldError("hostname") ? "input-error" : ""}
                    title={fieldError("hostname") || ""}
                  />
                  {fieldError("hostname") ? <div className="note warning">{fieldError("hostname")}</div> : null}
                </label>
                <label>
                  Root Device Hint
                  <input
                    value={localNodeFields[index]?.rootDevice ?? node.rootDevice}
                    onChange={(e) => updateLocalNodeField(index, 'rootDevice', e.target.value)}
                    onBlur={(e) => {
                      const newValue = e.target.value.trim();
                      if (newValue !== node.rootDevice) {
                        updateNode(index, { rootDevice: newValue });
                      }
                    }}
                    placeholder="/dev/disk/by-path/..."
                    className={fieldError("rootDevice") ? "input-error" : ""}
                    title={fieldError("rootDevice") || ""}
                  />
                  {fieldError("rootDevice") ? <div className="note warning">{fieldError("rootDevice")}</div> : null}
                </label>
                <label>
                  Primary Interface Type
                  <select
                    value={node.primary.type}
                    onChange={(e) => updatePrimary(index, { type: e.target.value })}
                    className={fieldError("primary.type") ? "input-error" : ""}
                    title={fieldError("primary.type") || ""}
                  >
                    {PRIMARY_TYPES.map((type) => (
                      <option key={type.id} value={type.id}>{type.label}</option>
                    ))}
                  </select>
                  <div className="note">Primary network is used for install/cluster networking.</div>
                  {fieldError("primary.type") ? <div className="note warning">{fieldError("primary.type")}</div> : null}
                </label>
              </div>
              <div className="divider" />
              {showBmc ? (
                <>
                  <h4>BMC / Provisioning</h4>
                  <div className="field-grid">
                    <label>
                      BMC Address
                      <input
                        value={localNodeFields[index]?.bmc?.address ?? node.bmc?.address ?? ""}
                        onChange={(e) => updateLocalNodeField(index, 'bmc.address', e.target.value)}
                        onBlur={(e) => {
                          const newValue = e.target.value.trim();
                          if (newValue !== (node.bmc?.address || "")) {
                            updateNode(index, { bmc: { ...node.bmc, address: newValue } });
                          }
                        }}
                        placeholder="redfish://10.10.10.10/redfish/v1/Systems/1"
                        className={fieldError("bmc.address") ? "input-error" : ""}
                        title={fieldError("bmc.address") || ""}
                      />
                      {fieldError("bmc.address") ? <div className="note warning">{fieldError("bmc.address")}</div> : null}
                    </label>
                    <label>
                      BMC Username
                      <input
                        autoComplete="off"
                        value={localNodeFields[index]?.bmc?.username ?? node.bmc?.username ?? ""}
                        onChange={(e) => updateLocalNodeField(index, 'bmc.username', e.target.value)}
                        onBlur={(e) => {
                          const newValue = e.target.value.trim();
                          if (newValue !== (node.bmc?.username || "")) {
                            updateNode(index, { bmc: { ...node.bmc, username: newValue } });
                          }
                        }}
                        className={fieldError("bmc.username") ? "input-error" : ""}
                        title={fieldError("bmc.username") || ""}
                      />
                      {fieldError("bmc.username") ? <div className="note warning">{fieldError("bmc.username")}</div> : null}
                    </label>
                    <label>
                      BMC Password
                      <input
                        type="password"
                        autoComplete="new-password"
                        value={localNodeFields[index]?.bmc?.password ?? node.bmc?.password ?? ""}
                        onChange={(e) => updateLocalNodeField(index, 'bmc.password', e.target.value)}
                        onBlur={(e) => {
                          const newValue = e.target.value;
                          if (newValue !== (node.bmc?.password || "")) {
                            updateNode(index, { bmc: { ...node.bmc, password: newValue } });
                          }
                        }}
                        className={fieldError("bmc.password") ? "input-error" : ""}
                        title={fieldError("bmc.password") || ""}
                      />
                      {fieldError("bmc.password") ? <div className="note warning">{fieldError("bmc.password")}</div> : null}
                    </label>
                    <label>
                      Boot MAC Address
                      <input
                        value={localNodeFields[index]?.bmc?.bootMACAddress ?? node.bmc?.bootMACAddress ?? ""}
                        onChange={(e) => updateLocalNodeField(index, 'bmc.bootMACAddress', e.target.value)}
                        onBlur={(e) => {
                          const normalized = normalizeMAC(e.target.value);
                          if (normalized !== (node.bmc?.bootMACAddress || "")) {
                            updateNode(index, { bmc: { ...node.bmc, bootMACAddress: normalized } });
                          }
                        }}
                        placeholder="52:54:00:aa:11:01"
                        className={fieldError("bmc.bootMACAddress") ? "input-error" : ""}
                        title={fieldError("bmc.bootMACAddress") || ""}
                      />
                      {fieldError("bmc.bootMACAddress") ? <div className="note warning">{fieldError("bmc.bootMACAddress")}</div> : null}
                    </label>
                  </div>
                  <div className="divider" />
                </>
              ) : null}
              <h4>Primary Network</h4>
              <div className="field-grid">
                <label>
                  IP Assignment
                  <select value={primaryMode} onChange={(e) => updatePrimary(index, { mode: e.target.value })}>
                    <option value="dhcp">DHCP</option>
                    <option value="static">Static</option>
                  </select>
                </label>
                {node.primary.type === "ethernet" || node.primary.type === "vlan-on-ethernet" ? (
                  <>
                    <label>
                      Ethernet Interface Name
                      <input
                        value={localNodeFields[index]?.primary?.ethernet?.name ?? node.primary.ethernet.name}
                        onChange={(e) => updateLocalNodeField(index, 'primary.ethernet.name', e.target.value)}
                        onBlur={(e) => {
                          const newValue = e.target.value.trim();
                          if (newValue !== node.primary.ethernet.name) {
                            updatePrimaryEthernet(index, { name: newValue });
                          }
                        }}
                        placeholder="eth0"
                        className={fieldError("primary.ethernet.name") ? "input-error" : ""}
                        title={fieldError("primary.ethernet.name") || ""}
                      />
                      {fieldError("primary.ethernet.name") ? <div className="note warning">{fieldError("primary.ethernet.name")}</div> : null}
                    </label>
                    <label>
                      Ethernet MAC Address
                      <input
                        value={localNodeFields[index]?.primary?.ethernet?.macAddress ?? node.primary.ethernet.macAddress}
                        onChange={(e) => updateLocalNodeField(index, 'primary.ethernet.macAddress', e.target.value)}
                        onBlur={(e) => {
                          const normalized = normalizeMAC(e.target.value);
                          if (normalized !== node.primary.ethernet.macAddress) {
                            updatePrimaryEthernet(index, { macAddress: normalized });
                          }
                        }}
                        placeholder="52:54:00:aa:11:01"
                        className={fieldError("primary.ethernet.macAddress") ? "input-error" : ""}
                        title={fieldError("primary.ethernet.macAddress") || ""}
                      />
                      {fieldError("primary.ethernet.macAddress") ? <div className="note warning">{fieldError("primary.ethernet.macAddress")}</div> : null}
                    </label>
                  </>
                ) : null}
                {node.primary.type === "bond" || node.primary.type === "vlan-on-bond" ? (
                  <>
                    <label>
                      Bond Name
                      <input
                        value={localNodeFields[index]?.primary?.bond?.name ?? node.primary.bond.name}
                        onChange={(e) => updateLocalNodeField(index, 'primary.bond.name', e.target.value)}
                        onBlur={(e) => {
                          const newValue = e.target.value.trim();
                          if (newValue !== node.primary.bond.name) {
                            updatePrimaryBond(index, { name: newValue });
                          }
                        }}
                        placeholder="bond0"
                        className={fieldError("primary.bond.name") ? "input-error" : ""}
                        title={fieldError("primary.bond.name") || ""}
                      />
                      {fieldError("primary.bond.name") ? <div className="note warning">{fieldError("primary.bond.name")}</div> : null}
                    </label>
                    <label>
                      Bond Mode
                      <select
                        value={node.primary.bond.mode}
                        onChange={(e) => updatePrimaryBond(index, { mode: e.target.value })}
                        className={fieldError("primary.bond.mode") ? "input-error" : ""}
                        title={fieldError("primary.bond.mode") || ""}
                      >
                        {BOND_MODES.map((mode) => (
                          <option key={mode} value={mode}>{mode}</option>
                        ))}
                      </select>
                      {fieldError("primary.bond.mode") ? <div className="note warning">{fieldError("primary.bond.mode")}</div> : null}
                    </label>
                    <div className="field-grid">
                      <div className="note">Bond member interfaces require name and MAC.</div>
                      {node.primary.bond.slaves.map((slave, slaveIndex) => (
                        <React.Fragment key={`slave-${slaveIndex}`}>
                          <label>
                            Bond Member Interface
                            <input
                              value={localNodeFields[index]?.primary?.bond?.slaves?.[slaveIndex]?.name ?? slave.name}
                              onChange={(e) => {
                                setLocalNodeFields(prev => {
                                  const updated = { ...prev };
                                  if (!updated[index]?.primary?.bond?.slaves?.[slaveIndex]) return prev;
                                  updated[index].primary.bond.slaves[slaveIndex].name = e.target.value;
                                  return updated;
                                });
                              }}
                              onBlur={(e) => {
                                const newValue = e.target.value.trim();
                                if (newValue !== slave.name) {
                                  updateBondSlave(index, slaveIndex, { name: newValue });
                                }
                              }}
                              placeholder={`eth${slaveIndex}`}
                              className={fieldError(`primary.bond.slaves.${slaveIndex}.name`) ? "input-error" : ""}
                              title={fieldError(`primary.bond.slaves.${slaveIndex}.name`) || ""}
                            />
                            {fieldError(`primary.bond.slaves.${slaveIndex}.name`) ? (
                              <div className="note warning">{fieldError(`primary.bond.slaves.${slaveIndex}.name`)}</div>
                            ) : null}
                          </label>
                          <label>
                            Bond Member MAC
                            <input
                              value={localNodeFields[index]?.primary?.bond?.slaves?.[slaveIndex]?.macAddress ?? slave.macAddress}
                              onChange={(e) => {
                                setLocalNodeFields(prev => {
                                  const updated = { ...prev };
                                  if (!updated[index]?.primary?.bond?.slaves?.[slaveIndex]) return prev;
                                  updated[index].primary.bond.slaves[slaveIndex].macAddress = e.target.value;
                                  return updated;
                                });
                              }}
                              onBlur={(e) => {
                                const normalized = normalizeMAC(e.target.value);
                                if (normalized !== slave.macAddress) {
                                  updateBondSlave(index, slaveIndex, { macAddress: normalized });
                                }
                              }}
                              placeholder="52:54:00:aa:11:02"
                              className={fieldError(`primary.bond.slaves.${slaveIndex}.macAddress`) ? "input-error" : ""}
                              title={fieldError(`primary.bond.slaves.${slaveIndex}.macAddress`) || ""}
                            />
                            {fieldError(`primary.bond.slaves.${slaveIndex}.macAddress`) ? (
                              <div className="note warning">{fieldError(`primary.bond.slaves.${slaveIndex}.macAddress`)}</div>
                            ) : null}
                          </label>
                          <label>
                            Remove
                            <button className="ghost" onClick={() => removeBondSlave(index, slaveIndex)} disabled={node.primary.bond.slaves.length < 2}>
                              Remove Member
                            </button>
                          </label>
                        </React.Fragment>
                      ))}
                      <button className="ghost" onClick={() => addBondSlave(index)}>Add Bond Member</button>
                    </div>
                  </>
                ) : null}
                {node.primary.type === "vlan-on-ethernet" || node.primary.type === "vlan-on-bond" ? (
                  <>
                    <label>
                      VLAN ID
                      <input
                        value={localNodeFields[index]?.primary?.vlan?.id ?? node.primary.vlan.id}
                        onChange={(e) => updateLocalNodeField(index, 'primary.vlan.id', e.target.value)}
                        onBlur={(e) => {
                          const newValue = e.target.value.trim();
                          if (newValue !== node.primary.vlan.id) {
                            updatePrimaryVlan(index, { id: newValue });
                          }
                        }}
                        placeholder="100"
                        className={fieldError("primary.vlan.id") ? "input-error" : ""}
                        title={fieldError("primary.vlan.id") || ""}
                      />
                      {fieldError("primary.vlan.id") ? <div className="note warning">{fieldError("primary.vlan.id")}</div> : null}
                    </label>
                    <div className="note">
                      VLAN base interface is derived from the selected primary interface ({baseIface}).
                    </div>
                    <label>
                      VLAN Interface Name (auto)
                      <input
                        value={localNodeFields[index]?.primary?.vlan?.name ?? vlanName}
                        onChange={(e) => updateLocalNodeField(index, 'primary.vlan.name', e.target.value)}
                        onBlur={(e) => {
                          const newValue = e.target.value.trim();
                          if (newValue !== (node.primary.vlan.name || "")) {
                            updatePrimaryVlan(index, { name: newValue });
                          }
                        }}
                        placeholder={vlanNameSuggestion || "bond0.100"}
                      />
                    </label>
                  </>
                ) : null}
                {primaryStatic ? (
                  <>
                    <label>
                      IPv4 Address/CIDR
                      <input
                        value={localNodeFields[index]?.primary?.ipv4Cidr ?? node.primary.ipv4Cidr}
                        onChange={(e) => updateLocalNodeField(index, 'primary.ipv4Cidr', e.target.value)}
                        onBlur={(e) => {
                          const newValue = e.target.value.trim();
                          if (newValue !== node.primary.ipv4Cidr) {
                            updatePrimary(index, { ipv4Cidr: newValue });
                          }
                        }}
                        placeholder={nodeIpv4Placeholder(node.role, index)}
                        className={fieldError("primary.ipv4Cidr") ? "input-error" : ""}
                        title={fieldError("primary.ipv4Cidr") || ""}
                      />
                      {machineCidr && primaryIpv4 && !ipInCidr(primaryIpv4, machineCidr) ? (
                        <div className="note warning">IP is outside machine network ({machineCidr}).</div>
                      ) : null}
                      {fieldError("primary.ipv4Cidr") ? <div className="note warning">{fieldError("primary.ipv4Cidr")}</div> : null}
                    </label>
                    <label>
                      IPv4 Default Gateway
                      <input
                        value={localNodeFields[index]?.primary?.ipv4Gateway ?? node.primary.ipv4Gateway}
                        onChange={(e) => updateLocalNodeField(index, 'primary.ipv4Gateway', e.target.value)}
                        onBlur={(e) => {
                          const newValue = e.target.value.trim();
                          if (newValue !== node.primary.ipv4Gateway) {
                            updatePrimary(index, { ipv4Gateway: newValue });
                          }
                        }}
                        placeholder={networkHints?.gateway || "192.168.1.1"}
                        className={fieldError("primary.ipv4Gateway") ? "input-error" : ""}
                        title={fieldError("primary.ipv4Gateway") || ""}
                      />
                      {fieldError("primary.ipv4Gateway") ? <div className="note warning">{fieldError("primary.ipv4Gateway")}</div> : null}
                    </label>
                  </>
                ) : null}
                {showIpv6 && primaryStatic ? (
                  <>
                    <label>
                      IPv6 Address/CIDR
                      <input
                        value={localNodeFields[index]?.primary?.ipv6Cidr ?? node.primary.ipv6Cidr}
                        onChange={(e) => updateLocalNodeField(index, 'primary.ipv6Cidr', e.target.value)}
                        onBlur={(e) => {
                          const newValue = e.target.value.trim();
                          if (newValue !== node.primary.ipv6Cidr) {
                            updatePrimary(index, { ipv6Cidr: newValue });
                          }
                        }}
                        placeholder="fd10:90::20/64"
                        className={fieldError("primary.ipv6Cidr") ? "input-error" : ""}
                        title={fieldError("primary.ipv6Cidr") || ""}
                      />
                      {fieldError("primary.ipv6Cidr") ? <div className="note warning">{fieldError("primary.ipv6Cidr")}</div> : null}
                    </label>
                    <label>
                      IPv6 Default Gateway
                      <input
                        value={localNodeFields[index]?.primary?.ipv6Gateway ?? node.primary.ipv6Gateway}
                        onChange={(e) => updateLocalNodeField(index, 'primary.ipv6Gateway', e.target.value)}
                        onBlur={(e) => {
                          const newValue = e.target.value.trim();
                          if (newValue !== node.primary.ipv6Gateway) {
                            updatePrimary(index, { ipv6Gateway: newValue });
                          }
                        }}
                        placeholder="fd10:90::1"
                        className={fieldError("primary.ipv6Gateway") ? "input-error" : ""}
                        title={fieldError("primary.ipv6Gateway") || ""}
                      />
                      {fieldError("primary.ipv6Gateway") ? <div className="note warning">{fieldError("primary.ipv6Gateway")}</div> : null}
                    </label>
                  </>
                ) : null}
                <label>
                  DNS Servers (comma-separated)
                  <input
                    value={localNodeFields[index]?.dnsServers ?? node.dnsServers}
                    onChange={(e) => updateLocalNodeField(index, 'dnsServers', e.target.value)}
                    onBlur={(e) => {
                      const newValue = e.target.value.trim();
                      if (newValue !== node.dnsServers) {
                        updateNode(index, { dnsServers: newValue });
                      }
                    }}
                    placeholder={networkHints?.dnsServers || "192.168.1.10,192.168.1.11"}
                  />
                </label>
                <label>
                  DNS Search Domains (comma-separated)
                  <input
                    value={localNodeFields[index]?.dnsSearch ?? node.dnsSearch ?? ""}
                    onChange={(e) => updateLocalNodeField(index, 'dnsSearch', e.target.value)}
                    onBlur={(e) => {
                      const newValue = e.target.value.trim();
                      if (newValue !== (node.dnsSearch || "")) {
                        updateNode(index, { dnsSearch: newValue });
                      }
                    }}
                    placeholder="example.com,corp.local"
                  />
                </label>
              </div>
              <div className="card-header">
                <h4>Advanced Networking</h4>
                <button className="ghost" onClick={() => setAdvancedOpen((prev) => ({ ...prev, [advKey]: !prev[advKey] }))}>
                  {advOpen ? "Collapse" : "Expand"}
                </button>
              </div>
              {advOpen ? (
                <>
                  <div className="field-grid">
                    <label>
                      MTU (optional)
                      <input
                        value={localNodeFields[index]?.primary?.advanced?.mtu ?? node.primary.advanced.mtu ?? ""}
                        onChange={(e) => updateLocalNodeField(index, 'primary.advanced.mtu', e.target.value)}
                        onBlur={(e) => {
                          const newValue = e.target.value.trim();
                          if (newValue !== (node.primary.advanced.mtu || "")) {
                            updatePrimaryAdvanced(index, { mtu: newValue });
                          }
                        }}
                        placeholder="1500"
                      />
                      <div className="note">Applies to physical and VLAN interfaces for this host. Default 1500.</div>
                    </label>
                    <label>
                      SR-IOV
                      <input
                        type="checkbox"
                        checked={node.primary.advanced.sriov?.enabled || false}
                        onChange={(e) => updatePrimaryAdvanced(index, { sriov: { ...node.primary.advanced.sriov, enabled: e.target.checked } })}
                      />
                      <div className="note">Only use SR-IOV if it is part of your documented install plan.</div>
                    </label>
                    {node.primary.advanced.sriov?.enabled ? (
                      <label>
                        SR-IOV Total VFs
                        <input
                          value={localNodeFields[index]?.primary?.advanced?.sriov?.totalVfs ?? node.primary.advanced.sriov?.totalVfs ?? ""}
                          onChange={(e) => {
                            setLocalNodeFields(prev => {
                              const updated = { ...prev };
                              if (!updated[index]?.primary?.advanced?.sriov) return prev;
                              updated[index].primary.advanced.sriov.totalVfs = e.target.value;
                              return updated;
                            });
                          }}
                          onBlur={(e) => {
                            const newValue = e.target.value.trim();
                            if (newValue !== (node.primary.advanced.sriov?.totalVfs || "")) {
                              updatePrimaryAdvanced(index, { sriov: { ...node.primary.advanced.sriov, totalVfs: newValue } });
                            }
                          }}
                          placeholder="8"
                        />
                      </label>
                    ) : null}
                    <label>
                      VRF
                      <input
                        type="checkbox"
                        checked={node.primary.advanced.vrf?.enabled || false}
                        onChange={(e) => updatePrimaryAdvanced(index, { vrf: { ...node.primary.advanced.vrf, enabled: e.target.checked } })}
                      />
                      <div className="note">Use VRF only if required for routing isolation.</div>
                    </label>
                    {node.primary.advanced.vrf?.enabled ? (
                      <>
                        <label>
                          VRF Name
                          <input
                            value={localNodeFields[index]?.primary?.advanced?.vrf?.name ?? node.primary.advanced.vrf?.name ?? "vrf0"}
                            onChange={(e) => {
                              setLocalNodeFields(prev => {
                                const updated = { ...prev };
                                if (!updated[index]?.primary?.advanced?.vrf) return prev;
                                updated[index].primary.advanced.vrf.name = e.target.value;
                                return updated;
                              });
                            }}
                            onBlur={(e) => {
                              const newValue = e.target.value.trim();
                              if (newValue !== (node.primary.advanced.vrf?.name || "vrf0")) {
                                updatePrimaryAdvanced(index, { vrf: { ...node.primary.advanced.vrf, name: newValue } });
                              }
                            }}
                          />
                        </label>
                        <label>
                          VRF Table ID
                          <input
                            value={localNodeFields[index]?.primary?.advanced?.vrf?.tableId ?? node.primary.advanced.vrf?.tableId ?? "100"}
                            onChange={(e) => {
                              setLocalNodeFields(prev => {
                                const updated = { ...prev };
                                if (!updated[index]?.primary?.advanced?.vrf) return prev;
                                updated[index].primary.advanced.vrf.tableId = e.target.value;
                                return updated;
                              });
                            }}
                            onBlur={(e) => {
                              const newValue = e.target.value.trim();
                              if (newValue !== (node.primary.advanced.vrf?.tableId || "100")) {
                                updatePrimaryAdvanced(index, { vrf: { ...node.primary.advanced.vrf, tableId: newValue } });
                              }
                            }}
                            placeholder="100"
                          />
                        </label>
                        <label>
                          VRF Ports (comma-separated)
                          <input
                            value={localNodeFields[index]?.primary?.advanced?.vrf?.ports ?? node.primary.advanced.vrf?.ports ?? ""}
                            onChange={(e) => {
                              setLocalNodeFields(prev => {
                                const updated = { ...prev };
                                if (!updated[index]?.primary?.advanced?.vrf) return prev;
                                updated[index].primary.advanced.vrf.ports = e.target.value;
                                return updated;
                              });
                            }}
                            onBlur={(e) => {
                              const newValue = e.target.value.trim();
                              if (newValue !== (node.primary.advanced.vrf?.ports || "")) {
                                updatePrimaryAdvanced(index, { vrf: { ...node.primary.advanced.vrf, ports: newValue } });
                              }
                            }}
                            placeholder={`${baseIface},${vlanName}`}
                          />
                        </label>
                      </>
                    ) : null}
                  </div>
                  <div className="divider" />
                  <h4>Additional Routes</h4>
                  <div className="note">Optional static routes beyond the default gateway.</div>
                  <div className="list">
                    {(node.primary.advanced.routes || []).map((route, routeIndex) => (
                      <div key={`route-${routeIndex}`} className="field-grid">
                        <label>
                          Destination
                          <input
                            value={localNodeFields[index]?.primary?.advanced?.routes?.[routeIndex]?.destination ?? route.destination}
                            onChange={(e) => {
                              setLocalNodeFields(prev => {
                                const updated = { ...prev };
                                if (!updated[index]?.primary?.advanced?.routes?.[routeIndex]) return prev;
                                updated[index].primary.advanced.routes[routeIndex].destination = e.target.value;
                                return updated;
                              });
                            }}
                            onBlur={(e) => {
                              const newValue = e.target.value.trim();
                              if (newValue !== route.destination) {
                                updatePrimaryRoute(index, routeIndex, { destination: newValue });
                              }
                            }}
                            placeholder="10.0.0.0/24"
                          />
                        </label>
                        <label>
                          Next Hop Address
                          <input
                            value={localNodeFields[index]?.primary?.advanced?.routes?.[routeIndex]?.nextHopAddress ?? route.nextHopAddress}
                            onChange={(e) => {
                              setLocalNodeFields(prev => {
                                const updated = { ...prev };
                                if (!updated[index]?.primary?.advanced?.routes?.[routeIndex]) return prev;
                                updated[index].primary.advanced.routes[routeIndex].nextHopAddress = e.target.value;
                                return updated;
                              });
                            }}
                            onBlur={(e) => {
                              const newValue = e.target.value.trim();
                              if (newValue !== route.nextHopAddress) {
                                updatePrimaryRoute(index, routeIndex, { nextHopAddress: newValue });
                              }
                            }}
                            placeholder="192.168.1.1"
                          />
                        </label>
                        <label>
                          Next Hop Interface (optional)
                          <input
                            value={localNodeFields[index]?.primary?.advanced?.routes?.[routeIndex]?.nextHopInterface ?? route.nextHopInterface ?? ""}
                            onChange={(e) => {
                              setLocalNodeFields(prev => {
                                const updated = { ...prev };
                                if (!updated[index]?.primary?.advanced?.routes?.[routeIndex]) return prev;
                                updated[index].primary.advanced.routes[routeIndex].nextHopInterface = e.target.value;
                                return updated;
                              });
                            }}
                            onBlur={(e) => {
                              const newValue = e.target.value.trim();
                              if (newValue !== (route.nextHopInterface || "")) {
                                updatePrimaryRoute(index, routeIndex, { nextHopInterface: newValue });
                              }
                            }}
                            placeholder={vlanName || baseIface}
                          />
                        </label>
                        <label>
                          Remove
                          <button className="ghost" onClick={() => removePrimaryRoute(index, routeIndex)}>Remove Route</button>
                        </label>
                      </div>
                    ))}
                    <button className="ghost" onClick={() => addPrimaryRoute(index)}>Add Route</button>
                  </div>
                </>
              ) : null}
              <div className="divider" />
              <h4>Additional Interfaces</h4>
              <div className="note">Use this for extra NIC networks or additional VLANs.</div>
              <div className="list">
                {(node.additionalInterfaces || []).map((iface, ifaceIndex) => (
                  <section key={`iface-${ifaceIndex}`} className="card">
                    <div className="card-header">
                      <h4>Interface {ifaceIndex + 1}</h4>
                      <button className="ghost" onClick={() => removeAdditionalInterface(index, ifaceIndex)}>Remove</button>
                    </div>
                    <div className="field-grid">
                      <label>
                        Type
                        <select
                          value={iface.type}
                          onChange={(e) => updateAdditionalInterface(index, ifaceIndex, { type: e.target.value })}
                        >
                          {PRIMARY_TYPES.map((type) => (
                            <option key={type.id} value={type.id}>{type.label}</option>
                          ))}
                        </select>
                      </label>
                      <label>
                        IP Assignment
                        <select
                          value={iface.mode}
                          onChange={(e) => updateAdditionalInterface(index, ifaceIndex, { mode: e.target.value })}
                        >
                          <option value="dhcp">DHCP</option>
                          <option value="static">Static</option>
                        </select>
                      </label>
                      {(iface.type === "ethernet" || iface.type === "vlan-on-ethernet") ? (
                        <>
                          <label>
                            Ethernet Interface Name
                            <input
                              value={localNodeFields[index]?.additionalInterfaces?.[ifaceIndex]?.ethernet?.name ?? iface.ethernet.name}
                              onChange={(e) => {
                                setLocalNodeFields(prev => {
                                  const updated = { ...prev };
                                  if (!updated[index]?.additionalInterfaces?.[ifaceIndex]?.ethernet) return prev;
                                  updated[index].additionalInterfaces[ifaceIndex].ethernet.name = e.target.value;
                                  return updated;
                                });
                              }}
                              onBlur={(e) => {
                                const newValue = e.target.value.trim();
                                if (newValue !== iface.ethernet.name) {
                                  updateAdditionalInterface(index, ifaceIndex, { ethernet: { ...iface.ethernet, name: newValue } });
                                }
                              }}
                              placeholder="eth2"
                            />
                          </label>
                          <label>
                            Ethernet MAC Address
                            <input
                              value={localNodeFields[index]?.additionalInterfaces?.[ifaceIndex]?.ethernet?.macAddress ?? iface.ethernet.macAddress}
                              onChange={(e) => {
                                setLocalNodeFields(prev => {
                                  const updated = { ...prev };
                                  if (!updated[index]?.additionalInterfaces?.[ifaceIndex]?.ethernet) return prev;
                                  updated[index].additionalInterfaces[ifaceIndex].ethernet.macAddress = e.target.value;
                                  return updated;
                                });
                              }}
                              onBlur={(e) => {
                                const normalized = normalizeMAC(e.target.value);
                                if (normalized !== iface.ethernet.macAddress) {
                                  updateAdditionalInterface(index, ifaceIndex, { ethernet: { ...iface.ethernet, macAddress: normalized } });
                                }
                              }}
                              placeholder="52:54:00:aa:11:03"
                            />
                          </label>
                        </>
                      ) : null}
                      {(iface.type === "bond" || iface.type === "vlan-on-bond") ? (
                        <>
                          <label>
                            Bond Name
                            <input
                              value={localNodeFields[index]?.additionalInterfaces?.[ifaceIndex]?.bond?.name ?? iface.bond.name}
                              onChange={(e) => {
                                setLocalNodeFields(prev => {
                                  const updated = { ...prev };
                                  if (!updated[index]?.additionalInterfaces?.[ifaceIndex]?.bond) return prev;
                                  updated[index].additionalInterfaces[ifaceIndex].bond.name = e.target.value;
                                  return updated;
                                });
                              }}
                              onBlur={(e) => {
                                const newValue = e.target.value.trim();
                                if (newValue !== iface.bond.name) {
                                  updateAdditionalInterface(index, ifaceIndex, { bond: { ...iface.bond, name: newValue } });
                                }
                              }}
                            />
                          </label>
                          <label>
                            Bond Mode
                            <select
                              value={iface.bond.mode}
                              onChange={(e) =>
                                updateAdditionalInterface(index, ifaceIndex, { bond: { ...iface.bond, mode: e.target.value } })
                              }
                            >
                              {BOND_MODES.map((mode) => (
                                <option key={mode} value={mode}>{mode}</option>
                              ))}
                            </select>
                          </label>
                          {iface.bond.slaves.map((slave, slaveIndex) => (
                            <React.Fragment key={`iface-${ifaceIndex}-slave-${slaveIndex}`}>
                              <label>
                                Bond Member Interface
                                <input
                                  value={localNodeFields[index]?.additionalInterfaces?.[ifaceIndex]?.bond?.slaves?.[slaveIndex]?.name ?? slave.name}
                                  onChange={(e) => {
                                    setLocalNodeFields(prev => {
                                      const updated = { ...prev };
                                      if (!updated[index]?.additionalInterfaces?.[ifaceIndex]?.bond?.slaves?.[slaveIndex]) return prev;
                                      updated[index].additionalInterfaces[ifaceIndex].bond.slaves[slaveIndex].name = e.target.value;
                                      return updated;
                                    });
                                  }}
                                  onBlur={(e) => {
                                    const newValue = e.target.value.trim();
                                    if (newValue !== slave.name) {
                                      const next = iface.bond.slaves.map((entry, i) =>
                                        i === slaveIndex ? { ...entry, name: newValue } : entry
                                      );
                                      updateAdditionalInterface(index, ifaceIndex, { bond: { ...iface.bond, slaves: next } });
                                    }
                                  }}
                                  placeholder={`eth${slaveIndex}`}
                                />
                              </label>
                              <label>
                                Bond Member MAC
                                <input
                                  value={localNodeFields[index]?.additionalInterfaces?.[ifaceIndex]?.bond?.slaves?.[slaveIndex]?.macAddress ?? slave.macAddress}
                                  onChange={(e) => {
                                    setLocalNodeFields(prev => {
                                      const updated = { ...prev };
                                      if (!updated[index]?.additionalInterfaces?.[ifaceIndex]?.bond?.slaves?.[slaveIndex]) return prev;
                                      updated[index].additionalInterfaces[ifaceIndex].bond.slaves[slaveIndex].macAddress = e.target.value;
                                      return updated;
                                    });
                                  }}
                                  onBlur={(e) => {
                                    const normalized = normalizeMAC(e.target.value);
                                    if (normalized !== slave.macAddress) {
                                      const next = iface.bond.slaves.map((entry, i) =>
                                        i === slaveIndex ? { ...entry, macAddress: normalized } : entry
                                      );
                                      updateAdditionalInterface(index, ifaceIndex, { bond: { ...iface.bond, slaves: next } });
                                    }
                                  }}
                                />
                              </label>
                            </React.Fragment>
                          ))}
                        </>
                      ) : null}
                      {(iface.type === "vlan-on-ethernet" || iface.type === "vlan-on-bond") ? (
                        <>
                          <label>
                            VLAN ID
                            <input
                              value={localNodeFields[index]?.additionalInterfaces?.[ifaceIndex]?.vlan?.id ?? iface.vlan.id}
                              onChange={(e) => {
                                setLocalNodeFields(prev => {
                                  const updated = { ...prev };
                                  if (!updated[index]?.additionalInterfaces?.[ifaceIndex]?.vlan) return prev;
                                  updated[index].additionalInterfaces[ifaceIndex].vlan.id = e.target.value;
                                  return updated;
                                });
                              }}
                              onBlur={(e) => {
                                const newValue = e.target.value.trim();
                                if (newValue !== iface.vlan.id) {
                                  updateAdditionalInterface(index, ifaceIndex, { vlan: { ...iface.vlan, id: newValue } });
                                }
                              }}
                            />
                          </label>
                          <div className="note">
                            VLAN base interface is derived from the selected interface.
                          </div>
                          <label>
                            VLAN Interface Name (auto)
                            <input
                              value={localNodeFields[index]?.additionalInterfaces?.[ifaceIndex]?.vlan?.name ?? iface.vlan.name ?? suggestedVlanName(iface.vlan.baseIface || iface.ethernet.name || iface.bond.name, iface.vlan.id)}
                              onChange={(e) => {
                                setLocalNodeFields(prev => {
                                  const updated = { ...prev };
                                  if (!updated[index]?.additionalInterfaces?.[ifaceIndex]?.vlan) return prev;
                                  updated[index].additionalInterfaces[ifaceIndex].vlan.name = e.target.value;
                                  return updated;
                                });
                              }}
                              onBlur={(e) => {
                                const newValue = e.target.value.trim();
                                if (newValue !== (iface.vlan.name || "")) {
                                  updateAdditionalInterface(index, ifaceIndex, { vlan: { ...iface.vlan, name: newValue } });
                                }
                              }}
                            />
                          </label>
                        </>
                      ) : null}
                      {iface.mode === "static" ? (
                        <>
                          <label>
                            IPv4 Address/CIDR
                            <input
                              value={localNodeFields[index]?.additionalInterfaces?.[ifaceIndex]?.ipv4Cidr ?? iface.ipv4Cidr}
                              onChange={(e) => {
                                setLocalNodeFields(prev => {
                                  const updated = { ...prev };
                                  if (!updated[index]?.additionalInterfaces?.[ifaceIndex]) return prev;
                                  updated[index].additionalInterfaces[ifaceIndex].ipv4Cidr = e.target.value;
                                  return updated;
                                });
                              }}
                              onBlur={(e) => {
                                const newValue = e.target.value.trim();
                                if (newValue !== iface.ipv4Cidr) {
                                  updateAdditionalInterface(index, ifaceIndex, { ipv4Cidr: newValue });
                                }
                              }}
                            />
                          </label>
                          {showIpv6 ? (
                            <label>
                              IPv6 Address/CIDR
                              <input
                                value={localNodeFields[index]?.additionalInterfaces?.[ifaceIndex]?.ipv6Cidr ?? iface.ipv6Cidr}
                                onChange={(e) => {
                                  setLocalNodeFields(prev => {
                                    const updated = { ...prev };
                                    if (!updated[index]?.additionalInterfaces?.[ifaceIndex]) return prev;
                                    updated[index].additionalInterfaces[ifaceIndex].ipv6Cidr = e.target.value;
                                    return updated;
                                  });
                                }}
                                onBlur={(e) => {
                                  const newValue = e.target.value.trim();
                                  if (newValue !== iface.ipv6Cidr) {
                                    updateAdditionalInterface(index, ifaceIndex, { ipv6Cidr: newValue });
                                  }
                                }}
                              />
                            </label>
                          ) : null}
                        </>
                      ) : null}
                    </div>
                    <div className="card-header">
                      <h4>Advanced Networking</h4>
                      <button
                        className="ghost"
                        onClick={() =>
                          setAdvancedOpen((prev) => ({ ...prev, [`${index}-${ifaceIndex}`]: !prev[`${index}-${ifaceIndex}`] }))
                        }
                      >
                        {advancedOpen[`${index}-${ifaceIndex}`] ? "Collapse" : "Expand"}
                      </button>
                    </div>
                    {advancedOpen[`${index}-${ifaceIndex}`] ? (
                      <div className="field-grid">
                        <label>
                          MTU (optional)
                          <input
                            value={localNodeFields[index]?.additionalInterfaces?.[ifaceIndex]?.advanced?.mtu ?? iface.advanced?.mtu ?? ""}
                            onChange={(e) => {
                              setLocalNodeFields(prev => {
                                const updated = { ...prev };
                                if (!updated[index]?.additionalInterfaces?.[ifaceIndex]?.advanced) return prev;
                                updated[index].additionalInterfaces[ifaceIndex].advanced.mtu = e.target.value;
                                return updated;
                              });
                            }}
                            onBlur={(e) => {
                              const newValue = e.target.value.trim();
                              if (newValue !== (iface.advanced?.mtu || "")) {
                                updateAdditionalInterface(index, ifaceIndex, {
                                  advanced: { ...iface.advanced, mtu: newValue }
                                });
                              }
                            }}
                            placeholder="1500"
                          />
                        </label>
                        <label>
                          SR-IOV
                          <input
                            type="checkbox"
                            checked={iface.advanced?.sriov?.enabled || false}
                            onChange={(e) =>
                              updateAdditionalInterface(index, ifaceIndex, {
                                advanced: {
                                  ...iface.advanced,
                                  sriov: { ...iface.advanced?.sriov, enabled: e.target.checked }
                                }
                              })
                            }
                          />
                        </label>
                        {iface.advanced?.sriov?.enabled ? (
                          <label>
                            SR-IOV Total VFs
                            <input
                              value={localNodeFields[index]?.additionalInterfaces?.[ifaceIndex]?.advanced?.sriov?.totalVfs ?? iface.advanced?.sriov?.totalVfs ?? ""}
                              onChange={(e) => {
                                setLocalNodeFields(prev => {
                                  const updated = { ...prev };
                                  if (!updated[index]?.additionalInterfaces?.[ifaceIndex]?.advanced?.sriov) return prev;
                                  updated[index].additionalInterfaces[ifaceIndex].advanced.sriov.totalVfs = e.target.value;
                                  return updated;
                                });
                              }}
                              onBlur={(e) => {
                                const newValue = e.target.value.trim();
                                if (newValue !== (iface.advanced?.sriov?.totalVfs || "")) {
                                  updateAdditionalInterface(index, ifaceIndex, {
                                    advanced: {
                                      ...iface.advanced,
                                      sriov: { ...iface.advanced?.sriov, totalVfs: newValue }
                                    }
                                  });
                                }
                              }}
                              placeholder="8"
                            />
                          </label>
                        ) : null}
                        <label>
                          VRF
                          <input
                            type="checkbox"
                            checked={iface.advanced?.vrf?.enabled || false}
                            onChange={(e) =>
                              updateAdditionalInterface(index, ifaceIndex, {
                                advanced: {
                                  ...iface.advanced,
                                  vrf: { ...iface.advanced?.vrf, enabled: e.target.checked }
                                }
                              })
                            }
                          />
                        </label>
                        {iface.advanced?.vrf?.enabled ? (
                          <>
                            <label>
                              VRF Name
                              <input
                                value={localNodeFields[index]?.additionalInterfaces?.[ifaceIndex]?.advanced?.vrf?.name ?? iface.advanced?.vrf?.name ?? "vrf0"}
                                onChange={(e) => {
                                  setLocalNodeFields(prev => {
                                    const updated = { ...prev };
                                    if (!updated[index]?.additionalInterfaces?.[ifaceIndex]?.advanced?.vrf) return prev;
                                    updated[index].additionalInterfaces[ifaceIndex].advanced.vrf.name = e.target.value;
                                    return updated;
                                  });
                                }}
                                onBlur={(e) => {
                                  const newValue = e.target.value.trim();
                                  if (newValue !== (iface.advanced?.vrf?.name || "vrf0")) {
                                    updateAdditionalInterface(index, ifaceIndex, {
                                      advanced: { ...iface.advanced, vrf: { ...iface.advanced?.vrf, name: newValue } }
                                    });
                                  }
                                }}
                              />
                            </label>
                            <label>
                              VRF Table ID
                              <input
                                value={localNodeFields[index]?.additionalInterfaces?.[ifaceIndex]?.advanced?.vrf?.tableId ?? iface.advanced?.vrf?.tableId ?? "100"}
                                onChange={(e) => {
                                  setLocalNodeFields(prev => {
                                    const updated = { ...prev };
                                    if (!updated[index]?.additionalInterfaces?.[ifaceIndex]?.advanced?.vrf) return prev;
                                    updated[index].additionalInterfaces[ifaceIndex].advanced.vrf.tableId = e.target.value;
                                    return updated;
                                  });
                                }}
                                onBlur={(e) => {
                                  const newValue = e.target.value.trim();
                                  if (newValue !== (iface.advanced?.vrf?.tableId || "100")) {
                                    updateAdditionalInterface(index, ifaceIndex, {
                                      advanced: { ...iface.advanced, vrf: { ...iface.advanced?.vrf, tableId: newValue } }
                                    });
                                  }
                                }}
                              />
                            </label>
                            <label>
                              VRF Ports (comma-separated)
                              <input
                                value={localNodeFields[index]?.additionalInterfaces?.[ifaceIndex]?.advanced?.vrf?.ports ?? iface.advanced?.vrf?.ports ?? ""}
                                onChange={(e) => {
                                  setLocalNodeFields(prev => {
                                    const updated = { ...prev };
                                    if (!updated[index]?.additionalInterfaces?.[ifaceIndex]?.advanced?.vrf) return prev;
                                    updated[index].additionalInterfaces[ifaceIndex].advanced.vrf.ports = e.target.value;
                                    return updated;
                                  });
                                }}
                                onBlur={(e) => {
                                  const newValue = e.target.value.trim();
                                  if (newValue !== (iface.advanced?.vrf?.ports || "")) {
                                    updateAdditionalInterface(index, ifaceIndex, {
                                      advanced: { ...iface.advanced, vrf: { ...iface.advanced?.vrf, ports: newValue } }
                                    });
                                  }
                                }}
                              />
                            </label>
                          </>
                        ) : null}
                      </div>
                    ) : null}
                  </section>
                ))}
                <button className="ghost" onClick={() => addAdditionalInterface(index)}>Add Interface</button>
              </div>
            </section>
          );
        })}
        </>
        )}
      </div>
      {showReplicate ? (
        <div className="modal-backdrop" role="dialog" aria-modal="true">
          <div className="modal">
            <h3>Replicate Shared Networking Settings</h3>
            <p className="subtle">
              This will copy DNS, default gateways, interface type, bond mode and member interface names (not MACs), VLAN settings, and MTU values.
              Hostnames, MACs, static IPs, and root device hints are not copied.
            </p>
            <label>
              Source Node
              <select value={replicateSource} onChange={(e) => setReplicateSource(Number(e.target.value))}>
                {nodes.map((node, idx) => (
                  <option key={`source-${idx}`} value={idx}>{node.hostname || `Node ${idx + 1}`}</option>
                ))}
              </select>
            </label>
            <div className="actions">
              <button className="ghost" onClick={() => setShowReplicate(false)}>Cancel</button>
              <button className="primary" onClick={applyReplicate}>Replicate</button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
};

export default HostInventoryStep;
