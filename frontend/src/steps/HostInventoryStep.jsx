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
    mtu: "",
    vlanMtu: "",
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
        mtu: node.mtu || "",
        vlanMtu: node.vlanMtu || "",
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
            mtu: source.primary.advanced.mtu,
            vlanMtu: source.primary.advanced.vlanMtu
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
    setNodeValidation((prev) => ({ ...prev, [nodeIndex]: result }));
  };

  const runAllValidations = () => {
    nodes.forEach((node, idx) => runNodeValidation(idx, node));
  };

  return (
    <div className="step">
      <div className="step-header sticky">
        <div className="step-header-main">
          <h2>Host Inventory</h2>
          <p className="subtle">Add nodes and networking details for agent-based bare metal installs.</p>
        </div>
        <div className="header-actions">
          {previewEnabled ? (
            <button className="ghost" onClick={() => previewControls?.setShowPreview((prev) => !prev)}>
              {previewControls?.showPreview ? "Hide YAML" : "Show YAML"}
            </button>
          ) : null}
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
                value={inventory.apiVip}
                onChange={(e) => updateInventory({ apiVip: e.target.value })}
                placeholder={networkHints?.apiVip || "192.168.1.5"}
              />
            </label>
            <label>
              Ingress VIP
              <input
                value={inventory.ingressVip}
                onChange={(e) => updateInventory({ ingressVip: e.target.value })}
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
                    value={node.hostname}
                    onChange={(e) => updateNode(index, { hostname: e.target.value })}
                    className={fieldError("hostname") ? "input-error" : ""}
                  />
                  {fieldError("hostname") ? <div className="note warning">{fieldError("hostname")}</div> : null}
                </label>
                <label>
                  Root Device Hint
                  <input
                    value={node.rootDevice}
                    onChange={(e) => updateNode(index, { rootDevice: e.target.value })}
                    placeholder="/dev/disk/by-path/..."
                    className={fieldError("rootDevice") ? "input-error" : ""}
                  />
                  {fieldError("rootDevice") ? <div className="note warning">{fieldError("rootDevice")}</div> : null}
                </label>
                <label>
                  Primary Interface Type
                  <select
                    value={node.primary.type}
                    onChange={(e) => updatePrimary(index, { type: e.target.value })}
                    className={fieldError("primary.type") ? "input-error" : ""}
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
                        value={node.bmc?.address || ""}
                        onChange={(e) => updateNode(index, { bmc: { ...node.bmc, address: e.target.value } })}
                        placeholder="redfish://10.10.10.10/redfish/v1/Systems/1"
                        className={fieldError("bmc.address") ? "input-error" : ""}
                      />
                      {fieldError("bmc.address") ? <div className="note warning">{fieldError("bmc.address")}</div> : null}
                    </label>
                    <label>
                      BMC Username
                      <input
                        autoComplete="off"
                        value={node.bmc?.username || ""}
                        onChange={(e) => updateNode(index, { bmc: { ...node.bmc, username: e.target.value } })}
                        className={fieldError("bmc.username") ? "input-error" : ""}
                      />
                      {fieldError("bmc.username") ? <div className="note warning">{fieldError("bmc.username")}</div> : null}
                    </label>
                    <label>
                      BMC Password
                      <input
                        type="password"
                        autoComplete="new-password"
                        value={node.bmc?.password || ""}
                        onChange={(e) => updateNode(index, { bmc: { ...node.bmc, password: e.target.value } })}
                        className={fieldError("bmc.password") ? "input-error" : ""}
                      />
                      {fieldError("bmc.password") ? <div className="note warning">{fieldError("bmc.password")}</div> : null}
                    </label>
                    <label>
                      Boot MAC Address
                      <input
                        value={node.bmc?.bootMACAddress || ""}
                        onChange={(e) => updateNode(index, { bmc: { ...node.bmc, bootMACAddress: e.target.value } })}
                        placeholder="52:54:00:aa:11:01"
                        className={fieldError("bmc.bootMACAddress") ? "input-error" : ""}
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
                        value={node.primary.ethernet.name}
                        onChange={(e) => updatePrimaryEthernet(index, { name: e.target.value })}
                        placeholder="eth0"
                        className={fieldError("primary.ethernet.name") ? "input-error" : ""}
                      />
                      {fieldError("primary.ethernet.name") ? <div className="note warning">{fieldError("primary.ethernet.name")}</div> : null}
                    </label>
                    <label>
                      Ethernet MAC Address
                      <input
                        value={node.primary.ethernet.macAddress}
                        onChange={(e) => updatePrimaryEthernet(index, { macAddress: e.target.value })}
                        placeholder="52:54:00:aa:11:01"
                        className={fieldError("primary.ethernet.macAddress") ? "input-error" : ""}
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
                        value={node.primary.bond.name}
                        onChange={(e) => updatePrimaryBond(index, { name: e.target.value })}
                        placeholder="bond0"
                        className={fieldError("primary.bond.name") ? "input-error" : ""}
                      />
                      {fieldError("primary.bond.name") ? <div className="note warning">{fieldError("primary.bond.name")}</div> : null}
                    </label>
                    <label>
                      Bond Mode
                      <select
                        value={node.primary.bond.mode}
                        onChange={(e) => updatePrimaryBond(index, { mode: e.target.value })}
                        className={fieldError("primary.bond.mode") ? "input-error" : ""}
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
                              value={slave.name}
                              onChange={(e) => updateBondSlave(index, slaveIndex, { name: e.target.value })}
                              placeholder={`eth${slaveIndex}`}
                              className={fieldError(`primary.bond.slaves.${slaveIndex}.name`) ? "input-error" : ""}
                            />
                            {fieldError(`primary.bond.slaves.${slaveIndex}.name`) ? (
                              <div className="note warning">{fieldError(`primary.bond.slaves.${slaveIndex}.name`)}</div>
                            ) : null}
                          </label>
                          <label>
                            Bond Member MAC
                            <input
                              value={slave.macAddress}
                              onChange={(e) => updateBondSlave(index, slaveIndex, { macAddress: e.target.value })}
                              placeholder="52:54:00:aa:11:02"
                              className={fieldError(`primary.bond.slaves.${slaveIndex}.macAddress`) ? "input-error" : ""}
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
                        value={node.primary.vlan.id}
                        onChange={(e) => updatePrimaryVlan(index, { id: e.target.value })}
                        placeholder="100"
                        className={fieldError("primary.vlan.id") ? "input-error" : ""}
                      />
                      {fieldError("primary.vlan.id") ? <div className="note warning">{fieldError("primary.vlan.id")}</div> : null}
                    </label>
                    <div className="note">
                      VLAN base interface is derived from the selected primary interface ({baseIface}).
                    </div>
                    <label>
                      VLAN Interface Name (auto)
                      <input
                        value={vlanName}
                        onChange={(e) => updatePrimaryVlan(index, { name: e.target.value })}
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
                        value={node.primary.ipv4Cidr}
                        onChange={(e) => updatePrimary(index, { ipv4Cidr: e.target.value })}
                        placeholder={nodeIpv4Placeholder(node.role, index)}
                        className={fieldError("primary.ipv4Cidr") ? "input-error" : ""}
                      />
                      {machineCidr && primaryIpv4 && !ipInCidr(primaryIpv4, machineCidr) ? (
                        <div className="note warning">IP is outside machine network ({machineCidr}).</div>
                      ) : null}
                      {fieldError("primary.ipv4Cidr") ? <div className="note warning">{fieldError("primary.ipv4Cidr")}</div> : null}
                    </label>
                    <label>
                      IPv4 Default Gateway
                      <input
                        value={node.primary.ipv4Gateway}
                        onChange={(e) => updatePrimary(index, { ipv4Gateway: e.target.value })}
                        placeholder={networkHints?.gateway || "192.168.1.1"}
                        className={fieldError("primary.ipv4Gateway") ? "input-error" : ""}
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
                        value={node.primary.ipv6Cidr}
                        onChange={(e) => updatePrimary(index, { ipv6Cidr: e.target.value })}
                        placeholder="fd10:90::20/64"
                        className={fieldError("primary.ipv6Cidr") ? "input-error" : ""}
                      />
                      {fieldError("primary.ipv6Cidr") ? <div className="note warning">{fieldError("primary.ipv6Cidr")}</div> : null}
                    </label>
                    <label>
                      IPv6 Default Gateway
                      <input
                        value={node.primary.ipv6Gateway}
                        onChange={(e) => updatePrimary(index, { ipv6Gateway: e.target.value })}
                        placeholder="fd10:90::1"
                        className={fieldError("primary.ipv6Gateway") ? "input-error" : ""}
                      />
                      {fieldError("primary.ipv6Gateway") ? <div className="note warning">{fieldError("primary.ipv6Gateway")}</div> : null}
                    </label>
                  </>
                ) : null}
                <label>
                  DNS Servers (comma-separated)
                  <input
                    value={node.dnsServers}
                    onChange={(e) => updateNode(index, { dnsServers: e.target.value })}
                    placeholder={networkHints?.dnsServers || "192.168.1.10,192.168.1.11"}
                  />
                </label>
                <label>
                  DNS Search Domains (comma-separated)
                  <input
                    value={node.dnsSearch || ""}
                    onChange={(e) => updateNode(index, { dnsSearch: e.target.value })}
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
                      Base MTU (optional)
                      <input
                        value={node.primary.advanced.mtu || ""}
                        onChange={(e) => updatePrimaryAdvanced(index, { mtu: e.target.value })}
                        placeholder="1500"
                      />
                      <div className="note">Set only if non-default MTU is required.</div>
                    </label>
                    {(node.primary.type === "vlan-on-ethernet" || node.primary.type === "vlan-on-bond") ? (
                      <label>
                        VLAN MTU (optional)
                        <input
                          value={node.primary.advanced.vlanMtu || ""}
                          onChange={(e) => updatePrimaryAdvanced(index, { vlanMtu: e.target.value })}
                          placeholder="1500"
                        />
                        <div className="note">Override VLAN MTU only when required. VLAN MTU cannot exceed the base interface MTU.</div>
                      </label>
                    ) : null}
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
                          value={node.primary.advanced.sriov?.totalVfs || ""}
                          onChange={(e) =>
                            updatePrimaryAdvanced(index, { sriov: { ...node.primary.advanced.sriov, totalVfs: e.target.value } })
                          }
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
                            value={node.primary.advanced.vrf?.name || "vrf0"}
                            onChange={(e) => updatePrimaryAdvanced(index, { vrf: { ...node.primary.advanced.vrf, name: e.target.value } })}
                          />
                        </label>
                        <label>
                          VRF Table ID
                          <input
                            value={node.primary.advanced.vrf?.tableId || "100"}
                            onChange={(e) => updatePrimaryAdvanced(index, { vrf: { ...node.primary.advanced.vrf, tableId: e.target.value } })}
                            placeholder="100"
                          />
                        </label>
                        <label>
                          VRF Ports (comma-separated)
                          <input
                            value={node.primary.advanced.vrf?.ports || ""}
                            onChange={(e) => updatePrimaryAdvanced(index, { vrf: { ...node.primary.advanced.vrf, ports: e.target.value } })}
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
                            value={route.destination}
                            onChange={(e) => updatePrimaryRoute(index, routeIndex, { destination: e.target.value })}
                            placeholder="10.0.0.0/24"
                          />
                        </label>
                        <label>
                          Next Hop Address
                          <input
                            value={route.nextHopAddress}
                            onChange={(e) => updatePrimaryRoute(index, routeIndex, { nextHopAddress: e.target.value })}
                            placeholder="192.168.1.1"
                          />
                        </label>
                        <label>
                          Next Hop Interface (optional)
                          <input
                            value={route.nextHopInterface || ""}
                            onChange={(e) => updatePrimaryRoute(index, routeIndex, { nextHopInterface: e.target.value })}
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
                              value={iface.ethernet.name}
                              onChange={(e) =>
                                updateAdditionalInterface(index, ifaceIndex, { ethernet: { ...iface.ethernet, name: e.target.value } })
                              }
                              placeholder="eth2"
                            />
                          </label>
                          <label>
                            Ethernet MAC Address
                            <input
                              value={iface.ethernet.macAddress}
                              onChange={(e) =>
                                updateAdditionalInterface(index, ifaceIndex, { ethernet: { ...iface.ethernet, macAddress: e.target.value } })
                              }
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
                              value={iface.bond.name}
                              onChange={(e) =>
                                updateAdditionalInterface(index, ifaceIndex, { bond: { ...iface.bond, name: e.target.value } })
                              }
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
                                  value={slave.name}
                                  onChange={(e) => {
                                    const next = iface.bond.slaves.map((entry, i) =>
                                      i === slaveIndex ? { ...entry, name: e.target.value } : entry
                                    );
                                    updateAdditionalInterface(index, ifaceIndex, { bond: { ...iface.bond, slaves: next } });
                                  }}
                                  placeholder={`eth${slaveIndex}`}
                                />
                              </label>
                              <label>
                                Bond Member MAC
                                <input
                                  value={slave.macAddress}
                                  onChange={(e) => {
                                    const next = iface.bond.slaves.map((entry, i) =>
                                      i === slaveIndex ? { ...entry, macAddress: e.target.value } : entry
                                    );
                                    updateAdditionalInterface(index, ifaceIndex, { bond: { ...iface.bond, slaves: next } });
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
                              value={iface.vlan.id}
                              onChange={(e) =>
                                updateAdditionalInterface(index, ifaceIndex, { vlan: { ...iface.vlan, id: e.target.value } })
                              }
                            />
                          </label>
                          <div className="note">
                            VLAN base interface is derived from the selected interface.
                          </div>
                          <label>
                            VLAN Interface Name (auto)
                            <input
                              value={iface.vlan.name || suggestedVlanName(iface.vlan.baseIface || iface.ethernet.name || iface.bond.name, iface.vlan.id)}
                              onChange={(e) =>
                                updateAdditionalInterface(index, ifaceIndex, { vlan: { ...iface.vlan, name: e.target.value } })
                              }
                            />
                          </label>
                        </>
                      ) : null}
                      {iface.mode === "static" ? (
                        <>
                          <label>
                            IPv4 Address/CIDR
                            <input
                              value={iface.ipv4Cidr}
                              onChange={(e) => updateAdditionalInterface(index, ifaceIndex, { ipv4Cidr: e.target.value })}
                            />
                          </label>
                          {showIpv6 ? (
                            <label>
                              IPv6 Address/CIDR
                              <input
                                value={iface.ipv6Cidr}
                                onChange={(e) => updateAdditionalInterface(index, ifaceIndex, { ipv6Cidr: e.target.value })}
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
                          Base MTU (optional)
                          <input
                            value={iface.advanced?.mtu || ""}
                            onChange={(e) =>
                              updateAdditionalInterface(index, ifaceIndex, {
                                advanced: { ...iface.advanced, mtu: e.target.value }
                              })
                            }
                            placeholder="1500"
                          />
                        </label>
                        {(iface.type === "vlan-on-ethernet" || iface.type === "vlan-on-bond") ? (
                          <label>
                            VLAN MTU (optional)
                            <input
                              value={iface.advanced?.vlanMtu || ""}
                              onChange={(e) =>
                                updateAdditionalInterface(index, ifaceIndex, {
                                  advanced: { ...iface.advanced, vlanMtu: e.target.value }
                                })
                              }
                              placeholder="1500"
                            />
                          </label>
                        ) : null}
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
                              value={iface.advanced?.sriov?.totalVfs || ""}
                              onChange={(e) =>
                                updateAdditionalInterface(index, ifaceIndex, {
                                  advanced: {
                                    ...iface.advanced,
                                    sriov: { ...iface.advanced?.sriov, totalVfs: e.target.value }
                                  }
                                })
                              }
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
                                value={iface.advanced?.vrf?.name || "vrf0"}
                                onChange={(e) =>
                                  updateAdditionalInterface(index, ifaceIndex, {
                                    advanced: { ...iface.advanced, vrf: { ...iface.advanced?.vrf, name: e.target.value } }
                                  })
                                }
                              />
                            </label>
                            <label>
                              VRF Table ID
                              <input
                                value={iface.advanced?.vrf?.tableId || "100"}
                                onChange={(e) =>
                                  updateAdditionalInterface(index, ifaceIndex, {
                                    advanced: { ...iface.advanced, vrf: { ...iface.advanced?.vrf, tableId: e.target.value } }
                                  })
                                }
                              />
                            </label>
                            <label>
                              VRF Ports (comma-separated)
                              <input
                                value={iface.advanced?.vrf?.ports || ""}
                                onChange={(e) =>
                                  updateAdditionalInterface(index, ifaceIndex, {
                                    advanced: { ...iface.advanced, vrf: { ...iface.advanced?.vrf, ports: e.target.value } }
                                  })
                                }
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
