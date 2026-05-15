/**
 * OpenShift Airgap Architect - Host Inventory Configuration Step
 *
 * Node configuration for bare metal and vSphere: node counts, hardware inventory,
 * BMC settings, network interfaces (ethernet/bond/VLAN), static IP configuration.
 * Scenario-aware validation and field requirements.
 *
 * @author Bill Strauss
 *
 * Developed with AI assistance from Claude (Anthropic) and Cursor AI.
 */
import React, { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { useApp } from "../store.jsx";
import { validateNode } from "../validation.js";
import {
  generateNodesFromCounts,
  emptyNode,
  applyReplicateSettings,
  getScenarioId,
  getSectionOrderForRender,
  SECTION_IDS,
  DEFAULT_SECTION_ORDER,
  SCENARIO_SECTION_ORDER,
  createInterfaceConfig,
  getNextEnoName
} from "../hostInventoryV2Helpers.js";
import { getCatalogPaths } from "../catalogPaths.js";
import { getFieldMeta } from "../catalogFieldMeta.js";
import {
  getCatalogValidationForInventoryV2,
  mergeNodeValidation
} from "../hostInventoryV2Validation.js";
import { normalizeMAC, formatMACAsYouType } from "../formatUtils.js";
import CollapsibleSection from "../components/CollapsibleSection.jsx";
import FieldLabelWithInfo from "../components/FieldLabelWithInfo.jsx";
import { applyPlaceholderValuesToHostInventory } from "../placeholderValuesHelpers.js";
import { NodeDrawerAgentContent } from "../components/NodeDrawerAgentContent.jsx";
import { NodeDrawerIpiContent } from "../components/NodeDrawerIpiContent.jsx";

const PRIMARY_TYPES = [
  { id: "ethernet", label: "Single NIC ethernet" },
  { id: "bond", label: "Bond (LACP or active-backup)" },
  { id: "vlan-on-ethernet", label: "VLAN on ethernet" },
  { id: "vlan-on-bond", label: "VLAN on bond" }
];

const BOND_MODES = ["active-backup", "802.3ad"];

const REPLICATE_OPTIONS = [
  { key: "dnsServers", label: "DNS servers" },
  { key: "dnsSearch", label: "DNS search domains" },
  { key: "primary.type", label: "Primary interface type" },
  { key: "primary.mode", label: "IP assignment (DHCP/static)" },
  { key: "primary.ipv4Cidr", label: "IPv4 CIDR" },
  { key: "primary.ipv6Cidr", label: "IPv6 CIDR" },
  { key: "primary.ipv4Gateway", label: "IPv4 gateway" },
  { key: "primary.ipv6Gateway", label: "IPv6 gateway" },
  { key: "primary.vlan", label: "VLAN settings" },
  { key: "primary.bond", label: "Bond mode and structure (not MACs)" },
  { key: "primary.advanced", label: "MTU, routes, advanced" },
  { key: "primary.ethernet.macAddress", label: "Primary ethernet MAC (usually leave unchecked)" },
  { key: "primary.bond.slaves.macAddress", label: "Bond member MACs (usually leave unchecked)" },
  { key: "hostname", label: "Hostname (usually leave unchecked)" },
  { key: "hostnameUseFqdn", label: "Use FQDN for hostname" },
  { key: "rootDevice", label: "Root device hints (usually leave unchecked)" },
  { key: "bmc", label: "BMC credentials (usually leave unchecked)" }
];

/** Compare mode badge: annotates section/field when "Compare legacy vs scenario-aware" is ON. Non-mutating. */
function CompareBadge({ kind }) {
  if (!kind) return null;
  const label = kind === "wouldBeHidden" ? "Would be hidden" : "Scenario-only";
  return <span className="host-inventory-v2-compare-badge" data-badge={kind} title={label}>{label}</span>;
}

const INSTALL_CONFIG = "install-config.yaml";
const AGENT_CONFIG = "agent-config.yaml";
const ROLE_PATH_AGENT = "hosts[].role";

function isScenarioSupported(platform, method) {
  if (platform === "Bare Metal" && (method === "Agent-Based Installer" || method === "IPI")) return true;
  if (platform === "VMware vSphere" && method === "Agent-Based Installer") return true;
  return false;
}

function nodeCompletionLabel(node, validation) {
  if (!node?.hostname?.trim()) return "Incomplete";
  if (validation?.errors?.length) return "Errors";
  if (validation?.warnings?.length) return "Warnings";
  return "OK";
}

/** Hostname is still the auto-generated default if it matches role-N (e.g. master-0, worker-1, arbiter-0). */
function isDefaultHostname(node) {
  if (!node?.hostname?.trim() || !node?.role) return false;
  const n = node.hostname.trim();
  const re = new RegExp(`^${node.role}-\\d+$`);
  return re.test(n);
}

/** Default hostname for a node at nodeIndex when it has role `role` (used when role changes and hostname was default). */
function getDefaultHostnameForRole(role, nodeIndex, nodes) {
  const sameRoleBefore = nodes.slice(0, nodeIndex).filter((n) => n.role === role).length;
  return `${role}-${sameRoleBefore}`;
}

const HostInventoryV2Step = ({ previewControls, previewEnabled, highlightErrors }) => {
  const { state, updateState } = useApp();
  const inventory = state.hostInventory || {};
  const nodes = inventory.nodes || [];
  const platform = state.blueprint?.platform;
  const method = state.methodology?.method;
  const scenarioId = getScenarioId(platform, method);
  const showBmc = platform === "Bare Metal" && method === "IPI";
  /** Drawer content: only show IPI-specific form when user chose Bare Metal + IPI; otherwise show full agent-oriented form. */
  const showIpiDrawer = platform === "Bare Metal" && method === "IPI";
  const isIpiScenario = scenarioId === "bare-metal-ipi";
  const isAgentInventoryScenario = scenarioId === "bare-metal-agent" || scenarioId === "vsphere-agent";
  const masterCountForDay2 = nodes.filter((n) => (n.role || "").trim() === "master").length;
  const workerCountForDay2 = nodes.filter((n) => (n.role || "").trim() === "worker").length;
  const isBareMetalAgentSnoTopology =
    scenarioId === "bare-metal-agent" && masterCountForDay2 === 1 && workerCountForDay2 === 0;
  const showAgentDay2InstallConfigBmc =
    scenarioId === "bare-metal-agent" && !isBareMetalAgentSnoTopology && !!inventory.includeBareMetalDay2InInstallConfig;
  const supported = isScenarioSupported(platform, method);
  const machineCidr = state.globalStrategy?.networking?.machineNetworkV4 || "";
  const enableIpv6 = !!inventory.enableIpv6;

  const sectionOrder = useMemo(
    () => getSectionOrderForRender(true, scenarioId),
    [scenarioId]
  );
  const catalogPaths = useMemo(() => getCatalogPaths(scenarioId), [scenarioId]);
  const sectionOrderSet = useMemo(() => new Set(sectionOrder), [sectionOrder]);

  const roleMeta = useMemo(() => getFieldMeta(scenarioId, AGENT_CONFIG, ROLE_PATH_AGENT), [scenarioId]);
  const ROLE_LABELS = { master: "Control plane", worker: "Worker", arbiter: "Arbiter" };
  const roleOptions = useMemo(() => {
    if (Array.isArray(roleMeta?.allowed) && roleMeta.allowed.length > 0) {
      return roleMeta.allowed.map((v) => ({ value: v, label: ROLE_LABELS[v] || v }));
    }
    return [
      { value: "master", label: "Control plane" },
      { value: "worker", label: "Worker" }
    ];
  }, [roleMeta]);

  const [countControlPlane, setCountControlPlane] = useState(3);
  const [countWorker, setCountWorker] = useState(2);
  const [countInfra, setCountInfra] = useState(0);
  const [selectedIndex, setSelectedIndex] = useState(null);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [additionalAdvancedOpen, setAdditionalAdvancedOpen] = useState({});
  const [showReplicate, setShowReplicate] = useState(false);
  const [replicateSelectedFields, setReplicateSelectedFields] = useState(() =>
    new Set(["dnsServers", "dnsSearch", "primary.type", "primary.mode", "primary.vlan", "primary.bond", "primary.advanced", "primary.ipv4Gateway", "primary.ipv6Gateway"])
  );
  const [replicateTargetIndices, setReplicateTargetIndices] = useState(() => new Set());
  const [panelWidthPx, setPanelWidthPx] = useState(() => Math.min(420, typeof window !== "undefined" ? Math.max(280, window.innerWidth * 0.33) : 380));
  const [isResizing, setIsResizing] = useState(false);
  const [copiedGatherCommand, setCopiedGatherCommand] = useState("");
  const containerRef = useRef(null);

  const copyGatherCommand = useCallback((key, text) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopiedGatherCommand(key);
      setTimeout(() => setCopiedGatherCommand(""), 1500);
    });
  }, []);

  const MIN_PANEL_PX = 400;
  const MAX_PANEL_PX = 800;

  const handleResizeMove = useCallback(
    (e) => {
      if (!isResizing || !containerRef.current) return;
      // Use container width instead of window width to account for YAML drawer
      const containerRect = containerRef.current.getBoundingClientRect();
      const containerRight = containerRect.right;
      const distanceFromContainerRight = containerRight - e.clientX;
      const next = Math.min(MAX_PANEL_PX, Math.max(MIN_PANEL_PX, distanceFromContainerRight));
      setPanelWidthPx(next);
    },
    [isResizing]
  );
  const handleResizeEnd = useCallback(() => setIsResizing(false), []);

  useEffect(() => {
    if (!isResizing) return;
    window.addEventListener("mousemove", handleResizeMove);
    window.addEventListener("mouseup", handleResizeEnd);
    return () => {
      window.removeEventListener("mousemove", handleResizeMove);
      window.removeEventListener("mouseup", handleResizeEnd);
    };
  }, [isResizing, handleResizeMove, handleResizeEnd]);

  useEffect(() => {
    setAdditionalAdvancedOpen({});
  }, [selectedIndex]);

  /** Agent-based install-config: single-node OpenShift is one control plane and zero workers/infra (4.20). */
  useEffect(() => {
    if (!isAgentInventoryScenario) return;
    if (countControlPlane === 1 && (countWorker > 0 || countInfra > 0)) {
      setCountWorker(0);
      setCountInfra(0);
    }
  }, [isAgentInventoryScenario, countControlPlane, countWorker, countInfra]);

  useEffect(() => {
    if (!showReplicate) return;
    const onKeyDown = (e) => {
      if (e.key === "Escape") setShowReplicate(false);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [showReplicate]);

  const updateInventory = (patch) => updateState({ hostInventory: { ...inventory, ...patch } });

  const handleGenerateFromCounts = () => {
    let next = generateNodesFromCounts(countControlPlane, countWorker, countInfra);
    // Bare metal Agent: 2 control plane nodes require 1 arbiter (4.20 doc). Auto-add one when user generates with CP=2.
    if (isAgentInventoryScenario && countControlPlane === 2) {
      next = [...next, emptyNode("arbiter", 0)];
    }
    if (state?.ui?.placeholderValuesEnabled) {
      const nextHostInventory = applyPlaceholderValuesToHostInventory(
        { ...inventory, nodes: next },
        { platform: state.blueprint?.platform, method: state.methodology?.method }
      );
      updateInventory(nextHostInventory);
    } else {
      updateInventory({ nodes: next });
    }
    setSelectedIndex(null);
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
  const addBondMember = (nodeIndex) =>
    updateNode(nodeIndex, (node) => ({
      ...node,
      primary: {
        ...node.primary,
        bond: { ...node.primary.bond, slaves: [...(node.primary.bond?.slaves || []), { name: "", macAddress: "" }] }
      }
    }));
  const removeBondMember = (nodeIndex, memberIndex) =>
    updateNode(nodeIndex, (node) => ({
      ...node,
      primary: {
        ...node.primary,
        bond: { ...node.primary.bond, slaves: (node.primary.bond?.slaves || []).filter((_, i) => i !== memberIndex) }
      }
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
      const routes = (node.primary?.advanced?.routes || []).map((route, i) => (i === routeIndex ? { ...route, ...patch } : route));
      return { ...node, primary: { ...node.primary, advanced: { ...node.primary.advanced, routes } } };
    });

  const addPrimaryRoute = (nodeIndex) =>
    updateNode(nodeIndex, (node) => ({
      ...node,
      primary: {
        ...node.primary,
        advanced: {
          ...node.primary.advanced,
          routes: [...(node.primary?.advanced?.routes || []), { destination: "", nextHopAddress: "", nextHopInterface: "" }]
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
          routes: (node.primary?.advanced?.routes || []).filter((_, i) => i !== routeIndex)
        }
      }
    }));

  const updateAdditionalInterface = (nodeIndex, ifaceIndex, patch) =>
    updateNode(nodeIndex, (node) => {
      const nextIfaces = (node.additionalInterfaces || []).map((iface, i) => (i === ifaceIndex ? { ...iface, ...patch } : iface));
      return { ...node, additionalInterfaces: nextIfaces };
    });

  const addAdditionalInterface = (nodeIndex) =>
    updateNode(nodeIndex, (node) => {
      const nextName = getNextEnoName(node);
      return {
        ...node,
        additionalInterfaces: [
          ...(node.additionalInterfaces || []),
          createInterfaceConfig({ type: "ethernet", ethernet: { name: nextName, macAddress: "" } })
        ]
      };
    });

  const removeAdditionalInterface = (nodeIndex, ifaceIndex) =>
    updateNode(nodeIndex, (node) => ({
      ...node,
      additionalInterfaces: (node.additionalInterfaces || []).filter((_, i) => i !== ifaceIndex)
    }));

  const primaryBaseIface = (node) => {
    if (node.primary?.type === "bond" || node.primary?.type === "vlan-on-bond") return node.primary.bond?.name || "bond0";
    return node.primary?.ethernet?.name || "eno0";
  };
  const suggestedVlanName = (baseIface, vlanId) => (baseIface && vlanId ? `${baseIface}.${vlanId}` : "");

  const selectedNode = selectedIndex != null ? nodes[selectedIndex] : null;
  const isArbiterDrawer = (selectedNode?.role || "").trim() === "arbiter";
  /** Bulk replicate must not target arbiter nodes (role-specific inventory). */
  const replicateEligibleTargetIndices = useMemo(() => {
    if (selectedIndex == null) return [];
    return nodes.map((_, i) => i).filter((i) => i !== selectedIndex && (nodes[i]?.role || "").trim() !== "arbiter");
  }, [nodes, selectedIndex]);
  const baseDomain = (state.blueprint?.baseDomain || "").trim();
  const effectiveHostname = (node) => {
    let short = (node?.hostname || "").trim();
    if (!short) return "";
    if (node?.hostnameUseFqdn && baseDomain) {
      const suffix = `.${baseDomain}`;
      if (short.endsWith(suffix)) short = short.slice(0, -suffix.length).trim() || short;
      return `${short}.${baseDomain}`;
    }
    return short;
  };
  const drawerOpen = selectedIndex != null && nodes.length > 0;
  const showBasicDrawer = sectionOrderSet.has(SECTION_IDS.NODE_DRAWER_BASIC);
  const showAdvancedDrawer = sectionOrderSet.has(SECTION_IDS.NODE_DRAWER_ADVANCED);
  const badgeBasicDrawer = null;
  const badgeAdvancedDrawer = null;

  const nodeValidation = useMemo(() => {
    const out = {};
    nodes.forEach((node, idx) => {
      const result = validateNode({
        node,
        enableIpv6,
        machineCidr,
        platform,
        method
      });
      out[idx] = result;
    });
    return out;
  }, [nodes, enableIpv6, machineCidr, platform, method]);

  const catalogValidation = useMemo(
    () => getCatalogValidationForInventoryV2(state, scenarioId),
    [state, scenarioId]
  );

  const mergedNodeValidation = useMemo(() => {
    const out = {};
    nodes.forEach((_, idx) => {
      out[idx] = mergeNodeValidation(nodeValidation[idx], catalogValidation.perNode[idx]);
    });
    return out;
  }, [nodes, nodeValidation, catalogValidation]);

  const applyReplicate = () => {
    if (selectedIndex == null || !nodes[selectedIndex]) return;
    if ((nodes[selectedIndex]?.role || "").trim() === "arbiter") return;
    const source = nodes[selectedIndex];
    const eligible = (i) => i !== selectedIndex && (nodes[i]?.role || "").trim() !== "arbiter";
    const targetIndices = (replicateTargetIndices.size ? Array.from(replicateTargetIndices) : nodes.map((_, i) => i).filter(eligible)).filter(
      (i) => eligible(i)
    );
    if (!targetIndices.length) {
      setShowReplicate(false);
      return;
    }
    const targetNodes = targetIndices.map((i) => nodes[i]);
    const nextNodes = applyReplicateSettings(source, targetNodes, replicateSelectedFields);
    const next = nodes.map((node, i) => (targetIndices.includes(i) ? nextNodes[targetIndices.indexOf(i)] : node));
    updateInventory({ nodes: next });
    setShowReplicate(false);
  };

  const resolvedReplicateTargetIndices = replicateTargetIndices.size
    ? Array.from(replicateTargetIndices)
    : selectedIndex != null
      ? nodes.map((_, i) => i).filter((i) => i !== selectedIndex)
      : [];
  const resolvedReplicateTargetNodes = resolvedReplicateTargetIndices.map((i) => nodes[i]).filter(Boolean);
  const arbiterTargetsSelected = resolvedReplicateTargetNodes.some((n) => n.role === "arbiter");

  const goPrev = () => {
    if (nodes.length === 0) return;
    setSelectedIndex((prev) => (prev == null ? 0 : (prev - 1 + nodes.length) % nodes.length));
  };
  const goNext = () => {
    if (nodes.length === 0) return;
    setSelectedIndex((prev) => (prev == null ? 0 : (prev + 1) % nodes.length));
  };

  if (!supported) {
    return (
      <div className="step">
        <div className="step-header sticky">
          <h2>Hosts (New)</h2>
          <p className="subtle">Node-based host inventory.</p>
        </div>
        <div className="step-body">
          <div className="card">
            <p className="note">Host Inventory v2 is not supported for this scenario yet. Use the standard Host Inventory step, or choose Bare Metal (Agent-Based or IPI) or VMware vSphere with Agent-Based Installer.</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="step host-inventory-v2">
      <div className="step-header sticky">
        <div className="step-header-main">
          <h2>Hosts (New)</h2>
          <p className="subtle">Set node counts, then edit each host in the grid.</p>
        </div>
      </div>

      <div ref={containerRef} className={`step-body host-inventory-v2-body ${drawerOpen ? "host-inventory-v2-body-with-drawer" : ""}`}>
        <div className="host-inventory-v2-main">
        <CollapsibleSection title="How to gather host info from nodes" defaultCollapsed={false}>
              <p className="note">
                Boot each target machine with a RHEL 9+ (or Fedora) live ISO (bare metal or VMware VM), log in, and run the commands
                below to record interface names/MACs/MTU and stable disk IDs before installing OpenShift.
                {scenarioId === "vsphere-agent" ? " On vSphere, you can use a live ISO in the VM console or a temporary helper VM on the same port group if attaching ISOs to every node is awkward." : ""}
              </p>
              <div className="host-inventory-v2-gather-info-list">
                <div className="host-inventory-v2-gather-hint">Interfaces (name, state, MTU, MAC):</div>
                <div className="code-block">
                  <div className="code-header">
                    <span>List interfaces and MACs</span>
                    <button
                      type="button"
                      className="ghost copy-button"
                      onClick={() =>
                        copyGatherCommand(
                          "ifaces",
                          "for i in /sys/class/net/*; do iface=$(basename \"$i\"); [ \"$iface\" = \"lo\" ] && continue; state=$(cat \"/sys/class/net/$iface/operstate\"); mtu=$(cat \"/sys/class/net/$iface/mtu\"); mac=$(cat \"/sys/class/net/$iface/address\"); printf \"%s\\t%s\\tmtu=%s\\t%s\\n\" \"$iface\" \"$state\" \"$mtu\" \"$mac\"; done"
                        )
                      }
                    >
                      {copiedGatherCommand === "ifaces" ? "Copied" : "Copy"}
                    </button>
                  </div>
                  <pre className="code">{`for i in /sys/class/net/*; do
  iface=$(basename "$i")
  [ "$iface" = "lo" ] && continue
  state=$(cat "/sys/class/net/$iface/operstate")
  mtu=$(cat "/sys/class/net/$iface/mtu")
  mac=$(cat "/sys/class/net/$iface/address")
  printf "%s\\t%s\\tmtu=%s\\t%s\\n" "$iface" "$state" "$mtu" "$mac"
done`}</pre>
                </div>

                <div className="host-inventory-v2-gather-hint">Root device hints inventory (all supported subfields):</div>
                <div className="code-block">
                  <div className="code-header">
                    <span>Per-disk rootDeviceHints values (4.20)</span>
                    <button
                      type="button"
                      className="ghost copy-button"
                      onClick={() =>
                        copyGatherCommand(
                          "rdh",
                          "for name in $(lsblk -dn -o NAME,TYPE | awk '$2==\"disk\"{print $1}'); do dev=\"/dev/$name\"; props=$(udevadm info --query=property --name=\"$dev\" 2>/dev/null); id_path=$(printf \"%s\\n\" \"$props\" | awk -F= '/^ID_PATH=/{print $2; exit}'); model=$(printf \"%s\\n\" \"$props\" | awk -F= '/^ID_MODEL=/{print $2; exit}'); vendor=$(printf \"%s\\n\" \"$props\" | awk -F= '/^ID_VENDOR=/{print $2; exit}'); serial=$(printf \"%s\\n\" \"$props\" | awk -F= '/^ID_SERIAL_SHORT=/{print $2; exit}'); [ -z \"$serial\" ] && serial=$(printf \"%s\\n\" \"$props\" | awk -F= '/^ID_SERIAL=/{print $2; exit}'); wwn=$(printf \"%s\\n\" \"$props\" | awk -F= '/^ID_WWN_WITH_EXTENSION=/{print $2; exit}'); [ -z \"$wwn\" ] && wwn=$(printf \"%s\\n\" \"$props\" | awk -F= '/^ID_WWN=/{print $2; exit}'); hctl=$(cat \"/sys/block/$name/device/hctl\" 2>/dev/null || true); rota=$(cat \"/sys/block/$name/queue/rotational\" 2>/dev/null || echo \"\"); size_bytes=$(lsblk -dn -b -o SIZE \"$dev\" 2>/dev/null || echo \"\"); size_gb=\"\"; [ -n \"$size_bytes\" ] && size_gb=$((size_bytes / 1024 / 1024 / 1024)); printf \"\\n=== %s ===\\n\" \"$dev\"; printf \"deviceName (preferred): %s\\n\" \"${id_path:+/dev/disk/by-path/$id_path}\"; [ -z \"$id_path\" ] && printf \"deviceName (fallback): %s\\n\" \"$dev\"; printf \"hctl: %s\\n\" \"${hctl:-not found}\"; printf \"model: %s\\n\" \"${model:-not found}\"; printf \"vendor: %s\\n\" \"${vendor:-not found}\"; printf \"serialNumber: %s\\n\" \"${serial:-not found}\"; printf \"wwn: %s\\n\" \"${wwn:-not found}\"; printf \"rotational: %s\\n\" \"$( [ \"$rota\" = \"1\" ] && echo true || [ \"$rota\" = \"0\" ] && echo false || echo not\\ found )\"; printf \"minSizeGigabytes: %s\\n\" \"${size_gb:-not found}\"; done"
                        )
                      }
                    >
                      {copiedGatherCommand === "rdh" ? "Copied" : "Copy"}
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
                <p className="note subtle">
                  OpenShift 4.20 allows combining multiple root device hints; the selected disk must satisfy all provided hints. For
                  <code>wwn</code>, use the value from <code>ID_WWN_WITH_EXTENSION</code> when present.
                </p>

                <div className="host-inventory-v2-gather-hint">Check if a disk has existing data/signatures:</div>
                <div className="code-block">
                  <div className="code-header">
                    <span>Check for signatures (non-destructive)</span>
                    <button
                      type="button"
                      className="ghost copy-button"
                      onClick={() => copyGatherCommand("wipefs", "wipefs -n /dev/sdX")}
                    >
                      {copiedGatherCommand === "wipefs" ? "Copied" : "Copy"}
                    </button>
                  </div>
                  <pre className="code">wipefs -n /dev/sdX</pre>
                </div>

                <p className="note warning host-inventory-v2-gather-wipe-warning" role="alert">
                  <strong>Warning: Wiping a disk is destructive and irreversible.</strong> Double-check the device name before running the commands below.
                </p>
                <div className="host-inventory-v2-gather-hint">Wipe a target disk (destructive):</div>
                <div className="code-block">
                  <div className="code-header">
                    <span>Remove all partition/signature data</span>
                    <button
                      type="button"
                      className="ghost copy-button"
                      onClick={() => copyGatherCommand("zap", "sgdisk --zap-all /dev/sdX\nwipefs -a /dev/sdX")}
                    >
                      {copiedGatherCommand === "zap" ? "Copied" : "Copy"}
                    </button>
                  </div>
                  <pre className="code">{`sgdisk --zap-all /dev/sdX
wipefs -a /dev/sdX`}</pre>
                </div>
              </div>
        </CollapsibleSection>

        {sectionOrder.map((sectionId) => {
          if (!sectionOrderSet.has(sectionId)) return null;
          if (sectionId === SECTION_IDS.NODE_DRAWER_BASIC || sectionId === SECTION_IDS.NODE_DRAWER_ADVANCED) return null;
          const sectionCompareBadge = null;

          if (sectionId === SECTION_IDS.AGENT_OPTIONS) {
            if (state?.ui?.segmentedFlowV1 === true) return null;
            if (!isAgentInventoryScenario) return null;
            return (
              <section key={sectionId} className="card host-inventory-v2-section" data-section={sectionId}>
                <div className="host-inventory-v2-section-heading">
                  <h3>Agent options</h3>
                  <CompareBadge kind={sectionCompareBadge} />
                </div>
                <p className="note subtle">Optional agent-config settings.</p>
                <div className="field-grid" style={{ marginTop: 12 }}>
                  <label>
                    Boot artifacts base URL
                    <input
                      value={inventory.bootArtifactsBaseURL || ""}
                      onChange={(e) => updateInventory({ bootArtifactsBaseURL: e.target.value })}
                      placeholder="https://example.com/agent-artifacts or leave empty"
                    />
                  </label>
                </div>
              </section>
            );
          }

          if (sectionId === SECTION_IDS.NODE_COUNTS && nodes.length === 0) {
            return (
              <section key={sectionId} className="card host-inventory-v2-section" data-section={sectionId}>
                <div className="host-inventory-v2-section-heading">
                  <h3>Node counts</h3>
                  <CompareBadge kind={sectionCompareBadge} />
                </div>
                <p className="note subtle">Generate nodes from counts. You can edit each node in the grid after.</p>
                {isAgentInventoryScenario && countControlPlane === 2 && (
                  <p className="note">Two control plane nodes require one arbiter for this topology. Clicking Generate nodes will add one arbiter automatically.</p>
                )}
                {isAgentInventoryScenario && countControlPlane === 1 && (
                  <p className="note">Single-node OpenShift uses one control plane and no worker or infra nodes. Worker and infra counts are kept at zero (OpenShift 4.20 Agent-based install-config).</p>
                )}
                {isAgentInventoryScenario && (countControlPlane === 4 || countControlPlane === 5) && (
                  <p className="note subtle">Four or five control plane replicas are supported for Agent-based installs when documented for your environment; ensure total topology matches the installation guide.</p>
                )}
                {isIpiScenario && (
                  <p className="note">For bare metal IPI, these hosts populate install-config <code>platform.baremetal.hosts[]</code>. Each host needs BMC and boot MAC for provisioning.</p>
                )}
                <div className="field-grid">
                  <label>
                    Control plane{" "}
                    <input
                      type="number"
                      min={scenarioId === "bare-metal-ipi" ? 3 : 1}
                      max={isAgentInventoryScenario ? 5 : scenarioId === "bare-metal-ipi" ? 3 : 9}
                      step={1}
                      value={countControlPlane}
                      onChange={(e) => {
                        const cpMin = scenarioId === "bare-metal-ipi" ? 3 : 1;
                        const cpMax = isAgentInventoryScenario ? 5 : scenarioId === "bare-metal-ipi" ? 3 : 9;
                        const nextRaw = Number(e.target.value);
                        const next = Number.isFinite(nextRaw) ? nextRaw : cpMin;
                        const clamped = Math.min(cpMax, Math.max(cpMin, next));
                        setCountControlPlane(clamped);
                        if (isAgentInventoryScenario && clamped === 1) {
                          setCountWorker(0);
                          setCountInfra(0);
                        }
                      }}
                    />
                  </label>
                  <label>
                    Worker{" "}
                    <input
                      type="number"
                      min={0}
                      max={99}
                      value={countWorker}
                      disabled={isAgentInventoryScenario && countControlPlane === 1}
                      onChange={(e) => setCountWorker(Number(e.target.value) || 0)}
                    />
                  </label>
                  <label>
                    Infra (optional){" "}
                    <input
                      type="number"
                      min={0}
                      max={99}
                      value={countInfra}
                      disabled={isAgentInventoryScenario && countControlPlane === 1}
                      onChange={(e) => setCountInfra(Number(e.target.value) || 0)}
                    />
                  </label>
                </div>
                <div className="actions" style={{ marginTop: 12 }}>
                  <button type="button" className="primary" onClick={handleGenerateFromCounts}>
                    Generate nodes
                  </button>
                </div>
              </section>
            );
          }

          if (sectionId === SECTION_IDS.NODE_GRID && nodes.length > 0) {
            return (
              <section key={sectionId} className="card host-inventory-v2-section" data-section={sectionId}>
                <div className="host-inventory-v2-section-heading">
                  <div className="card-header">
                    <h3>Nodes</h3>
                    <button type="button" className="ghost" onClick={() => { updateInventory({ nodes: [] }); setSelectedIndex(null); }}>Clear and set counts again</button>
                  </div>
                  <CompareBadge kind={sectionCompareBadge} />
                </div>
                {isIpiScenario && (
                  <p className="note subtle">These hosts populate install-config <code>platform.baremetal.hosts[]</code>. Click a node to set BMC and boot MAC.</p>
                )}
                <div className="host-inventory-v2-grid">
                  {nodes.map((node, idx) => {
                    const validation = mergedNodeValidation[idx];
                    const status = nodeCompletionLabel(node, validation);
                    const isSelected = selectedIndex === idx;
                    const statusTitle =
                      (validation?.errors?.length || validation?.warnings?.length) &&
                      [
                        ...(validation.errors?.length ? [`Errors: ${validation.errors.join(". ")}`] : []),
                        ...(validation.warnings?.length ? [`Warnings: ${validation.warnings.join(". ")}`] : [])
                      ].join("\n");
                    const roleLabel = node.role === "master" ? "Control plane" : node.role === "arbiter" ? "Arbiter" : "Worker";
                    const tileRoleClass = node.role === "master" ? "node-master" : node.role === "arbiter" ? "node-arbiter" : "node-worker";
                    return (
                      <button
                        key={idx}
                        type="button"
                        className={`host-inventory-v2-tile ${tileRoleClass} ${isSelected ? "selected" : ""}`}
                        onClick={() => setSelectedIndex(idx)}
                        title={statusTitle || undefined}
                      >
                        <span className="host-inventory-v2-tile-hostname">{effectiveHostname(node) || `Node ${idx + 1}`}</span>
                        <span className="host-inventory-v2-tile-role">{roleLabel}</span>
                        <span className={`host-inventory-v2-tile-status ${validation?.errors?.length ? "error" : ""}`}>{status}</span>
                      </button>
                    );
                  })}
                </div>
              </section>
            );
          }

          if (sectionId === SECTION_IDS.REPLICATE_MODAL) {
            return null;
          }
          return null;
        })}
        </div>

        {drawerOpen && (
          <>
            <div
              role="separator"
              aria-label="Resize panel"
              className={`host-inventory-v2-drawer-resize-handle ${isResizing ? "resizing" : ""}`}
              onMouseDown={(e) => { e.preventDefault(); setIsResizing(true); }}
            />
            <aside
              className="host-inventory-v2-drawer host-inventory-v2-section"
              role="dialog"
              aria-label="Edit node"
              data-section="drawer"
              style={{ width: panelWidthPx, minWidth: MIN_PANEL_PX, maxWidth: MAX_PANEL_PX }}
            >
              <div className="host-inventory-v2-drawer-inner card">
                <div className="host-inventory-v2-drawer-header">
                  <div className="card-header">
                    <h3>Edit: {effectiveHostname(selectedNode) || `Node ${selectedIndex + 1}`}</h3>
                    <button type="button" className="ghost" onClick={() => setSelectedIndex(null)} aria-label="Close">×</button>
                  </div>
                  <div className="host-inventory-v2-drawer-nav">
                    <button type="button" className="ghost" onClick={goPrev} disabled={nodes.length <= 1} aria-label={`Previous node (${selectedIndex + 1} of ${nodes.length})`}>← Previous</button>
                    <span className="subtle" aria-live="polite" aria-atomic="true">{selectedIndex + 1} / {nodes.length}</span>
                    <button type="button" className="ghost" onClick={goNext} disabled={nodes.length <= 1} aria-label={`Next node (${selectedIndex + 1} of ${nodes.length})`}>Next →</button>
                  </div>
                  {!isArbiterDrawer ? (
                    <button type="button" className="ghost" style={{ marginBottom: 8 }} onClick={() => setShowReplicate(true)}>Apply settings to other nodes…</button>
                  ) : (
                    <p className="note subtle" style={{ marginBottom: 8 }}>
                      Bulk “Apply settings to other nodes” is not available while editing an arbiter. Configure the arbiter directly; other nodes can copy from a control plane or worker.
                    </p>
                  )}
                  {mergedNodeValidation[selectedIndex] && (mergedNodeValidation[selectedIndex].errors?.length > 0 || mergedNodeValidation[selectedIndex].warnings?.length > 0) && (
                    <details className="host-inventory-v2-validation-summary host-inventory-v2-validation-details">
                      <summary className="host-inventory-v2-validation-summary-summary">
                        <strong>Validation for this node</strong>
                        <span className="subtle"> ({mergedNodeValidation[selectedIndex].errors?.length || 0} error(s), {mergedNodeValidation[selectedIndex].warnings?.length || 0} warning(s))</span>
                      </summary>
                      <div className="host-inventory-v2-validation-summary-inner">
                        {mergedNodeValidation[selectedIndex].errors?.length > 0 && (
                          <div className="host-inventory-v2-validation-errors">
                            <strong>Errors:</strong>
                            <ul>{mergedNodeValidation[selectedIndex].errors.map((msg, i) => <li key={i}>{msg}</li>)}</ul>
                          </div>
                        )}
                        {mergedNodeValidation[selectedIndex].warnings?.length > 0 && (
                          <div className="host-inventory-v2-validation-warnings">
                            <strong>Warnings:</strong>
                            <ul>{mergedNodeValidation[selectedIndex].warnings.map((msg, i) => <li key={i}>{msg}</li>)}</ul>
                          </div>
                        )}
                      </div>
                    </details>
                  )}
                </div>
                <div className="host-inventory-v2-drawer-body">
                <div className="host-inventory-v2-editor">
                  {showBasicDrawer && (
                    <>
                      {showIpiDrawer ? (
                        <NodeDrawerIpiContent
                          node={selectedNode}
                          updateNode={updateNode}
                          selectedIndex={selectedIndex}
                          mergedNodeValidation={mergedNodeValidation}
                          roleOptions={roleOptions}
                          roleMeta={roleMeta}
                          formatMACAsYouType={formatMACAsYouType}
                          normalizeMAC={normalizeMAC}
                          isDefaultHostname={isDefaultHostname}
                          getDefaultHostnameForRole={getDefaultHostnameForRole}
                          nodes={nodes}
                        />
                      ) : (
                        <NodeDrawerAgentContent
                          node={selectedNode}
                          scenarioId={scenarioId}
                          isAgentInventoryScenario={isAgentInventoryScenario}
                          updateNode={updateNode}
                          selectedIndex={selectedIndex}
                          mergedNodeValidation={mergedNodeValidation}
                          enableIpv6={enableIpv6}
                          showAgentDay2InstallConfigBmc={showAgentDay2InstallConfigBmc}
                          showAdvancedDrawer={showAdvancedDrawer}
                          advancedOpen={advancedOpen}
                          setAdvancedOpen={setAdvancedOpen}
                          additionalAdvancedOpen={additionalAdvancedOpen}
                          setAdditionalAdvancedOpen={setAdditionalAdvancedOpen}
                          roleOptions={roleOptions}
                          roleMeta={roleMeta}
                          badgeBasicDrawer={badgeBasicDrawer}
                          badgeAdvancedDrawer={badgeAdvancedDrawer}
                          updatePrimary={updatePrimary}
                          updatePrimaryEthernet={updatePrimaryEthernet}
                          updatePrimaryBond={updatePrimaryBond}
                          updatePrimaryVlan={updatePrimaryVlan}
                          updatePrimaryAdvanced={updatePrimaryAdvanced}
                          updatePrimaryRoute={updatePrimaryRoute}
                          addPrimaryRoute={addPrimaryRoute}
                          removePrimaryRoute={removePrimaryRoute}
                          addBondMember={addBondMember}
                          removeBondMember={removeBondMember}
                          updateAdditionalInterface={updateAdditionalInterface}
                          addAdditionalInterface={addAdditionalInterface}
                          removeAdditionalInterface={removeAdditionalInterface}
                          primaryBaseIface={primaryBaseIface}
                          suggestedVlanName={suggestedVlanName}
                          formatMACAsYouType={formatMACAsYouType}
                          normalizeMAC={normalizeMAC}
                          isDefaultHostname={isDefaultHostname}
                          getDefaultHostnameForRole={getDefaultHostnameForRole}
                          nodes={nodes}
                        />
                      )}
                    </>
                  )}
                </div>
                </div>
              </div>
            </aside>
          </>
        )}
      </div>

      {showReplicate && sectionOrderSet.has(SECTION_IDS.REPLICATE_MODAL) && (
        <div className="modal-backdrop" role="dialog" aria-modal="true" onClick={() => setShowReplicate(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>Apply settings to other nodes</h3>
            <p className="subtle">Choose which settings to copy and which nodes to apply to. Hostname, BMC, and MACs are not copied by default. Arbiter nodes are excluded from targets.</p>
            <div className="host-inventory-v2-replicate-two-cols">
              <div className="list">
                <h4 style={{ marginTop: 0, marginBottom: "0.75rem", fontSize: "0.9375rem", fontWeight: 600, color: "var(--text-primary)" }}>Settings to copy</h4>
                {REPLICATE_OPTIONS.filter((opt) => (opt.key === "bmc" ? showBmc || showAgentDay2InstallConfigBmc : true)).map((opt) => {
                  const inputId = `replicate-field-${opt.key}`;
                  const isDisabled = arbiterTargetsSelected && (opt.key === "rootDevice" || opt.key === "primary.advanced");
                  return (
                    <div key={opt.key} style={{ marginBottom: "0.5rem", padding: "0.625rem 0.75rem", background: "var(--surface-raised)", borderRadius: "6px", display: "flex", alignItems: "center", gap: "0.5rem", opacity: isDisabled ? 0.5 : 1 }}>
                      <input
                        type="checkbox"
                        id={inputId}
                        disabled={isDisabled}
                        checked={replicateSelectedFields.has(opt.key)}
                        onChange={(e) => setReplicateSelectedFields((prev) => { const next = new Set(prev); if (e.target.checked) next.add(opt.key); else next.delete(opt.key); return next; })}
                        style={{ margin: 0, cursor: isDisabled ? "not-allowed" : "pointer" }}
                      />
                      <label htmlFor={inputId} style={{ margin: 0, cursor: isDisabled ? "not-allowed" : "pointer", fontSize: "0.875rem", fontWeight: 500, flex: 1 }}>
                        {opt.label}
                      </label>
                    </div>
                  );
                })}
              </div>
              <div className="list">
                <h4 style={{ marginTop: 0, marginBottom: "0.75rem", fontSize: "0.9375rem", fontWeight: 600, color: "var(--text-primary)" }}>Apply to nodes</h4>
                <div style={{ marginBottom: "0.75rem", padding: "0.625rem 0.75rem", background: "var(--surface-raised)", borderRadius: "6px", display: "flex", alignItems: "center", gap: "0.5rem" }}>
                  <input
                    type="checkbox"
                    id="replicate-all-nodes"
                    checked={
                      selectedIndex != null &&
                      replicateEligibleTargetIndices.length > 0 &&
                      replicateEligibleTargetIndices.every((idx) => replicateTargetIndices.has(idx))
                    }
                    onChange={(e) => {
                      if (selectedIndex == null || replicateEligibleTargetIndices.length === 0) return;
                      if (e.target.checked) {
                        setReplicateTargetIndices(new Set(replicateEligibleTargetIndices));
                      } else {
                        setReplicateTargetIndices(new Set());
                      }
                    }}
                    style={{ margin: 0, cursor: "pointer" }}
                  />
                  <label htmlFor="replicate-all-nodes" style={{ margin: 0, cursor: "pointer", fontSize: "0.875rem", fontWeight: 500, flex: 1 }}>
                    Apply to all other eligible nodes
                  </label>
                </div>
                {nodes.map((node, idx) => {
                  const inputId = `replicate-node-${idx}`;
                  const isDisabled = idx === selectedIndex || (node.role || "").trim() === "arbiter";
                  return (
                    <div key={idx} style={{ marginBottom: "0.5rem", padding: "0.625rem 0.75rem", background: "var(--surface-raised)", borderRadius: "6px", display: "flex", alignItems: "center", gap: "0.5rem", opacity: isDisabled ? 0.5 : 1 }}>
                      <input
                        type="checkbox"
                        id={inputId}
                        disabled={isDisabled}
                        checked={replicateTargetIndices.has(idx)}
                        onChange={(e) => setReplicateTargetIndices((prev) => { const next = new Set(prev); if (e.target.checked) next.add(idx); else next.delete(idx); return next; })}
                        style={{ margin: 0, cursor: isDisabled ? "not-allowed" : "pointer" }}
                      />
                      <label htmlFor={inputId} style={{ margin: 0, cursor: isDisabled ? "not-allowed" : "pointer", fontSize: "0.875rem", fontWeight: 500, flex: 1 }}>
                        {effectiveHostname(node) || `Node ${idx + 1}`} ({node.role}
                        {(node.role || "").trim() === "arbiter" ? "; not eligible for bulk copy" : ""})
                      </label>
                    </div>
                  );
                })}
              </div>
            </div>
            <div className="actions">
              <button type="button" className="ghost" onClick={() => setShowReplicate(false)}>Cancel</button>
              <button type="button" className="primary" onClick={applyReplicate}>Apply</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default HostInventoryV2Step;
