/**
 * Host Inventory v2: node counts, node grid, BMC/interface/network config for bare-metal-agent, vsphere-agent, and bare-metal-ipi.
 * Section order is scenario-aware (hostInventoryV2Helpers). Validates nodes via validateNode and catalog-driven required paths.
 */
import React, { useState, useMemo, useCallback, useEffect } from "react";
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
  { key: "rootDevice", label: "Root device (usually leave unchecked)" },
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

  const copyGatherCommand = useCallback((key, text) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopiedGatherCommand(key);
      setTimeout(() => setCopiedGatherCommand(""), 1500);
    });
  }, []);

  const MIN_PANEL_PX = 280;
  const MAX_PANEL_PX = 600;

  const handleResizeMove = useCallback(
    (e) => {
      if (!isResizing) return;
      const rightEdge = typeof window !== "undefined" ? window.innerWidth - e.clientX : 0;
      const next = Math.min(MAX_PANEL_PX, Math.max(MIN_PANEL_PX, rightEdge));
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
    updateInventory({ nodes: next });
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
        <div className="header-actions">
          {previewEnabled ? (
            <button className="ghost" onClick={() => previewControls?.setShowPreview((prev) => !prev)}>
              {previewControls?.showPreview ? "Hide YAML" : "Show YAML"}
            </button>
          ) : null}
        </div>
      </div>

      <div className={`step-body host-inventory-v2-body ${drawerOpen ? "host-inventory-v2-body-with-drawer" : ""}`}>
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

                <div className="host-inventory-v2-gather-hint">Stable disk IDs and drive characteristics:</div>
                <div className="code-block">
                  <div className="code-header">
                    <span>Disk inventory (size, type, speed)</span>
                    <button
                      type="button"
                      className="ghost copy-button"
                      onClick={() => copyGatherCommand("disks", "lsblk -d -o NAME,SIZE,MODEL,SERIAL,TYPE,ROTA,TRAN")}
                    >
                      {copiedGatherCommand === "disks" ? "Copied" : "Copy"}
                    </button>
                  </div>
                  <pre className="code">lsblk -d -o NAME,SIZE,MODEL,SERIAL,TYPE,ROTA,TRAN</pre>
                </div>
                <p className="note subtle">
                  ROTA=0 means SSD/NVMe, ROTA=1 means spinning disk. Prefer NVMe &gt; SSD &gt; HDD.
                  Target disks should be at least 300GB when possible.
                </p>

                <div className="host-inventory-v2-gather-hint">Find stable by-id paths (use these as Root Device Hint):</div>
                <div className="code-block">
                  <div className="code-header">
                    <span>List /dev/disk/by-id</span>
                    <button
                      type="button"
                      className="ghost copy-button"
                      onClick={() => copyGatherCommand("byid", "ls -l /dev/disk/by-id/ | grep -v part")}
                    >
                      {copiedGatherCommand === "byid" ? "Copied" : "Copy"}
                    </button>
                  </div>
                  <pre className="code">ls -l /dev/disk/by-id/ | grep -v part</pre>
                </div>

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
                      min={1}
                      max={isAgentInventoryScenario ? 5 : 9}
                      value={countControlPlane}
                      onChange={(e) => setCountControlPlane(Number(e.target.value) || 1)}
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
                    <button type="button" className="ghost" onClick={goPrev} disabled={nodes.length <= 1}>← Previous</button>
                    <span className="subtle">{selectedIndex + 1} / {nodes.length}</span>
                    <button type="button" className="ghost" onClick={goNext} disabled={nodes.length <= 1}>Next →</button>
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
                        <>
                          <div className="host-inventory-v2-section-heading">
                            <h4>Host (Bare metal IPI)</h4>
                          </div>
                          <p className="note subtle">These fields populate install-config <code>platform.baremetal.hosts[]</code>. Each host needs BMC and boot MAC for provisioning.</p>
                          <div className="field-grid">
                            <label>Role {roleMeta?.required ? <span className="required-marker" aria-label="required">*</span> : null}
                              <select
                                value={selectedNode.role}
                                onChange={(e) => {
                                  const newRole = e.target.value;
                                  const patch = { role: newRole };
                                  if (isDefaultHostname(selectedNode)) patch.hostname = getDefaultHostnameForRole(newRole, selectedIndex, nodes);
                                  updateNode(selectedIndex, patch);
                                }}
                              >
                                {roleOptions.map((opt) => (
                                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                                ))}
                              </select>
                              {mergedNodeValidation[selectedIndex]?.fieldErrors?.role ? (
                                <div className="note warning">{mergedNodeValidation[selectedIndex].fieldErrors.role}</div>
                              ) : null}
                            </label>
                            <label>Hostname <input value={selectedNode.hostname || ""} onChange={(e) => updateNode(selectedIndex, { hostname: e.target.value })} placeholder="master-0 or worker-0" /></label>
                            <label className="host-inventory-v2-checkbox-label">
                              <input type="checkbox" checked={!!selectedNode.hostnameUseFqdn} onChange={(e) => updateNode(selectedIndex, { hostnameUseFqdn: e.target.checked })} aria-label="Use FQDN for hostname" />
                              {" "}Use FQDN (shortname.baseDomain)
                            </label>
                            <label>Root device hint <input value={selectedNode.rootDevice || ""} onChange={(e) => updateNode(selectedIndex, { rootDevice: e.target.value })} placeholder="/dev/disk/by-id/..." /></label>
                          </div>
                          <div className="divider" />
                          <h4><FieldLabelWithInfo label="BMC (IPI)" hint="Baseboard management controller. Required for installer-provisioned deployment." /></h4>
                          <div className="field-grid">
                            <label>BMC address <input value={selectedNode.bmc?.address || ""} onChange={(e) => updateNode(selectedIndex, { bmc: { ...selectedNode.bmc, address: e.target.value } })} placeholder="redfish+http://192.168.1.1/..." /></label>
                            <label>BMC username <input autoComplete="off" value={selectedNode.bmc?.username || ""} onChange={(e) => updateNode(selectedIndex, { bmc: { ...selectedNode.bmc, username: e.target.value } })} /></label>
                            <label>BMC password <input type="password" autoComplete="new-password" value={selectedNode.bmc?.password || ""} onChange={(e) => updateNode(selectedIndex, { bmc: { ...selectedNode.bmc, password: e.target.value } })} /></label>
                            <label>Boot MAC <input value={selectedNode.bmc?.bootMACAddress || ""} onChange={(e) => updateNode(selectedIndex, { bmc: { ...selectedNode.bmc, bootMACAddress: formatMACAsYouType(e.target.value) } })} onBlur={(e) => { const v = normalizeMAC(e.target.value); if (v && v !== e.target.value) updateNode(selectedIndex, { bmc: { ...selectedNode.bmc, bootMACAddress: v } }); }} placeholder="52:54:00:aa:bb:cc" /></label>
                            <label className="host-inventory-v2-checkbox-label">
                              <input
                                type="checkbox"
                                checked={selectedNode.bmc?.disableCertificateVerification === true}
                                onChange={(e) => updateNode(selectedIndex, { bmc: { ...selectedNode.bmc, disableCertificateVerification: e.target.checked } })}
                              />
                              {" "}Disable BMC certificate verification (e.g. self-signed)
                            </label>
                          </div>
                        </>
                      ) : (
                        <>
                      <div className="host-inventory-v2-section-heading">
                        <h4>{isAgentInventoryScenario ? "Host (Agent)" : "Basic"}</h4>
                        <CompareBadge kind={badgeBasicDrawer} />
                      </div>
                      {isAgentInventoryScenario && (
                        <p className="note subtle">These fields are used for agent-config and node configuration. Set primary interface and network for each host.</p>
                      )}
                      <div className="field-grid">
                        <label>Role {roleMeta?.required ? <span className="required-marker" aria-label="required">*</span> : null}
                          <select
                            value={selectedNode.role}
                            onChange={(e) => {
                              const newRole = e.target.value;
                              const patch = { role: newRole };
                              if (isDefaultHostname(selectedNode)) patch.hostname = getDefaultHostnameForRole(newRole, selectedIndex, nodes);
                              updateNode(selectedIndex, patch);
                            }}
                          >
                            {roleOptions.map((opt) => (
                              <option key={opt.value} value={opt.value}>{opt.label}</option>
                            ))}
                          </select>
                          {mergedNodeValidation[selectedIndex]?.fieldErrors?.role ? (
                            <div className="note warning">{mergedNodeValidation[selectedIndex].fieldErrors.role}</div>
                          ) : null}
                        </label>
                        <label>Hostname <input value={selectedNode.hostname || ""} onChange={(e) => updateNode(selectedIndex, { hostname: e.target.value })} placeholder="e.g. master-0, arbiter-0" /></label>
                        <label className="host-inventory-v2-checkbox-label">
                          <input type="checkbox" checked={!!selectedNode.hostnameUseFqdn} onChange={(e) => updateNode(selectedIndex, { hostnameUseFqdn: e.target.checked })} aria-label="Use FQDN for hostname" />
                          {" "}Use FQDN (shortname.baseDomain)
                        </label>
                        <label>Root device hint <input value={selectedNode.rootDevice || ""} onChange={(e) => updateNode(selectedIndex, { rootDevice: e.target.value })} placeholder="/dev/disk/by-id/..." /></label>
                        <FieldLabelWithInfo label="Primary Interface Type" hint="Primary network is used for install/cluster networking.">
                          <select value={selectedNode.primary?.type || "ethernet"} onChange={(e) => updatePrimary(selectedIndex, { type: e.target.value })}>
                            {PRIMARY_TYPES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
                          </select>
                        </FieldLabelWithInfo>
                        <h4>Primary Network</h4>
                        <label>IP assignment
                          <select value={selectedNode.primary?.mode || "dhcp"} onChange={(e) => updatePrimary(selectedIndex, { mode: e.target.value })}>
                            <option value="dhcp">DHCP</option>
                            <option value="static">Static</option>
                          </select>
                        </label>
                        {(selectedNode.primary?.type === "ethernet" || selectedNode.primary?.type === "vlan-on-ethernet") && (
                          <>
                            <label>Ethernet interface <input value={selectedNode.primary?.ethernet?.name || ""} onChange={(e) => updatePrimaryEthernet(selectedIndex, { name: e.target.value })} placeholder="eno0" /></label>
                            <label>Ethernet MAC <input value={selectedNode.primary?.ethernet?.macAddress || ""} onChange={(e) => updatePrimaryEthernet(selectedIndex, { macAddress: formatMACAsYouType(e.target.value) })} onBlur={(e) => { const v = normalizeMAC(e.target.value); if (v && v !== e.target.value) updatePrimaryEthernet(selectedIndex, { macAddress: v }); }} placeholder="52:54:00:aa:11:01" /></label>
                          </>
                        )}
                        {(selectedNode.primary?.type === "bond" || selectedNode.primary?.type === "vlan-on-bond") && (
                          <>
                            <label>Bond name <input value={selectedNode.primary?.bond?.name || ""} onChange={(e) => updatePrimaryBond(selectedIndex, { name: e.target.value })} placeholder="bond0" /></label>
                            <FieldLabelWithInfo label="Bond mode" hint="Bond members: at least 2 required. Add or remove as needed.">
                              <select value={selectedNode.primary?.bond?.mode || "active-backup"} onChange={(e) => updatePrimaryBond(selectedIndex, { mode: e.target.value })}>
                                {BOND_MODES.map((m) => <option key={m} value={m}>{m}</option>)}
                              </select>
                            </FieldLabelWithInfo>
                            {(selectedNode.primary?.bond?.slaves || []).map((member, mi) => (
                              <React.Fragment key={mi}>
                                <label>Member interface <input value={member.name} onChange={(e) => updateNode(selectedIndex, (n) => ({ ...n, primary: { ...n.primary, bond: { ...n.primary.bond, slaves: (n.primary.bond?.slaves || []).map((m, i) => i === mi ? { ...m, name: e.target.value } : m) } } }))} placeholder={`eth${mi}`} /></label>
                                <label>Member MAC <input value={member.macAddress} onChange={(e) => updateNode(selectedIndex, (n) => ({ ...n, primary: { ...n.primary, bond: { ...n.primary.bond, slaves: (n.primary.bond?.slaves || []).map((m, i) => i === mi ? { ...m, macAddress: formatMACAsYouType(e.target.value) } : m) } } }))} onBlur={(e) => { const v = normalizeMAC(e.target.value); if (v && v !== e.target.value) updateNode(selectedIndex, (n) => ({ ...n, primary: { ...n.primary, bond: { ...n.primary.bond, slaves: (n.primary.bond?.slaves || []).map((m, i) => i === mi ? { ...m, macAddress: v } : m) } } })); }} placeholder="52:54:00:aa:11:02" /></label>
                                {(selectedNode.primary?.bond?.slaves?.length || 0) > 2 && mi >= 2 ? (
                                  <label>
                                    Remove member
                                    <button type="button" className="ghost" onClick={() => removeBondMember(selectedIndex, mi)}>Remove</button>
                                  </label>
                                ) : null}
                              </React.Fragment>
                            ))}
                            <div className="actions">
                              <button type="button" className="ghost" onClick={() => addBondMember(selectedIndex)}>Add bond member</button>
                            </div>
                          </>
                        )}
                        {(selectedNode.primary?.type === "vlan-on-ethernet" || selectedNode.primary?.type === "vlan-on-bond") && (
                          <>
                            <label>VLAN ID <input value={selectedNode.primary?.vlan?.id || ""} onChange={(e) => updatePrimaryVlan(selectedIndex, { id: e.target.value })} placeholder="100" /></label>
                            <label>VLAN name <input value={selectedNode.primary?.vlan?.name || suggestedVlanName(primaryBaseIface(selectedNode), selectedNode.primary?.vlan?.id)} onChange={(e) => updatePrimaryVlan(selectedIndex, { name: e.target.value })} /></label>
                          </>
                        )}
                        {selectedNode.primary?.mode === "static" && (
                          <>
                            <label>IPv4 CIDR <input value={selectedNode.primary?.ipv4Cidr || ""} onChange={(e) => updatePrimary(selectedIndex, { ipv4Cidr: e.target.value.trim() })} placeholder="192.168.1.20/24" /></label>
                            <label>IPv4 gateway <input value={selectedNode.primary?.ipv4Gateway || ""} onChange={(e) => updatePrimary(selectedIndex, { ipv4Gateway: e.target.value.trim() })} /></label>
                            {enableIpv6 && (
                              <>
                                <label>IPv6 CIDR <input value={selectedNode.primary?.ipv6Cidr || ""} onChange={(e) => updatePrimary(selectedIndex, { ipv6Cidr: e.target.value })} /></label>
                                <label>IPv6 gateway <input value={selectedNode.primary?.ipv6Gateway || ""} onChange={(e) => updatePrimary(selectedIndex, { ipv6Gateway: e.target.value })} /></label>
                              </>
                            )}
                          </>
                        )}
                        <label>DNS servers <input value={selectedNode.dnsServers || ""} onChange={(e) => updateNode(selectedIndex, { dnsServers: e.target.value })} placeholder="192.168.1.10,192.168.1.11" /></label>
                        <label>DNS search <input value={selectedNode.dnsSearch || ""} onChange={(e) => updateNode(selectedIndex, { dnsSearch: e.target.value })} /></label>
                        {isArbiterDrawer ? (
                          <p className="note subtle" style={{ gridColumn: "1 / -1" }}>
                            Arbiter: primary interface, DNS, and root device hint are what this app emits to agent-config. Extra interfaces and primary advanced MTU/routes are hidden for this role to match the simplified arbiter workflow.
                          </p>
                        ) : null}
                      </div>

                      {!isArbiterDrawer ? (
                      <>
                      <div className="divider" />
                      <h4><FieldLabelWithInfo label="Additional Interfaces" hint="Use this for extra NIC networks or additional VLANs." /></h4>
                      <div className="list">
                        {(selectedNode.additionalInterfaces || []).map((iface, ifaceIndex) => (
                          <section key={`iface-${ifaceIndex}`} className="card">
                            <div className="card-header">
                              <h4>Interface {ifaceIndex + 1}</h4>
                              <button type="button" className="ghost" onClick={() => removeAdditionalInterface(selectedIndex, ifaceIndex)}>Remove</button>
                            </div>
                            <div className="field-grid">
                              <label>
                                Type
                                <select value={iface.type} onChange={(e) => updateAdditionalInterface(selectedIndex, ifaceIndex, { type: e.target.value })}>
                                  {PRIMARY_TYPES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
                                </select>
                              </label>
                              <label>
                                IP Assignment
                                <select value={iface.mode} onChange={(e) => updateAdditionalInterface(selectedIndex, ifaceIndex, { mode: e.target.value })}>
                                  <option value="dhcp">DHCP</option>
                                  <option value="static">Static</option>
                                </select>
                              </label>
                              {(iface.type === "ethernet" || iface.type === "vlan-on-ethernet") && (
                                <>
                                  <label>
                                    Ethernet Interface Name
                                    <input
                                      value={iface.ethernet?.name || ""}
                                      onChange={(e) => updateAdditionalInterface(selectedIndex, ifaceIndex, { ethernet: { ...iface.ethernet, name: e.target.value } })}
                                      placeholder="eth2"
                                    />
                                  </label>
                                  <label>
                                    Ethernet MAC Address
                                    <input
                                      value={iface.ethernet?.macAddress || ""}
                                      onChange={(e) => updateAdditionalInterface(selectedIndex, ifaceIndex, { ethernet: { ...iface.ethernet, macAddress: formatMACAsYouType(e.target.value) } })}
                                      onBlur={(e) => { const v = normalizeMAC(e.target.value); if (v && v !== e.target.value) updateAdditionalInterface(selectedIndex, ifaceIndex, { ethernet: { ...iface.ethernet, macAddress: v } }); }}
                                      placeholder="52:54:00:aa:11:03"
                                    />
                                  </label>
                                </>
                              )}
                              {(iface.type === "bond" || iface.type === "vlan-on-bond") && (
                                <>
                                  <label>Bond Name <input value={iface.bond?.name || ""} onChange={(e) => updateAdditionalInterface(selectedIndex, ifaceIndex, { bond: { ...iface.bond, name: e.target.value } })} /></label>
                                  <label>
                                    Bond Mode
                                    <select value={iface.bond?.mode || "active-backup"} onChange={(e) => updateAdditionalInterface(selectedIndex, ifaceIndex, { bond: { ...iface.bond, mode: e.target.value } })}>
                                      {BOND_MODES.map((m) => <option key={m} value={m}>{m}</option>)}
                                    </select>
                                  </label>
                                  {(iface.bond?.slaves || []).map((slave, slaveIndex) => (
                                    <React.Fragment key={`iface-${ifaceIndex}-slave-${slaveIndex}`}>
                                      <label>
                                        Bond Member Interface
                                        <input
                                          value={slave.name}
                                          onChange={(e) => {
                                            const next = (iface.bond?.slaves || []).map((entry, i) => (i === slaveIndex ? { ...entry, name: e.target.value } : entry));
                                            updateAdditionalInterface(selectedIndex, ifaceIndex, { bond: { ...iface.bond, slaves: next } });
                                          }}
                                          placeholder={`eth${slaveIndex}`}
                                        />
                                      </label>
                                      <label>
                                        Bond Member MAC
                                        <input
                                          value={slave.macAddress}
                                          onChange={(e) => {
                                            const next = (iface.bond?.slaves || []).map((entry, i) => (i === slaveIndex ? { ...entry, macAddress: formatMACAsYouType(e.target.value) } : entry));
                                            updateAdditionalInterface(selectedIndex, ifaceIndex, { bond: { ...iface.bond, slaves: next } });
                                          }}
                                          onBlur={(e) => {
                                            const v = normalizeMAC(e.target.value);
                                            if (v && v !== e.target.value) {
                                              const next = (iface.bond?.slaves || []).map((entry, i) => (i === slaveIndex ? { ...entry, macAddress: v } : entry));
                                              updateAdditionalInterface(selectedIndex, ifaceIndex, { bond: { ...iface.bond, slaves: next } });
                                            }
                                          }}
                                        />
                                      </label>
                                    </React.Fragment>
                                  ))}
                                </>
                              )}
                              {(iface.type === "vlan-on-ethernet" || iface.type === "vlan-on-bond") && (
                                <>
                                  <FieldLabelWithInfo label="VLAN ID" hint="VLAN base interface is derived from the selected interface.">
                                    <input value={iface.vlan?.id || ""} onChange={(e) => updateAdditionalInterface(selectedIndex, ifaceIndex, { vlan: { ...iface.vlan, id: e.target.value } })} />
                                  </FieldLabelWithInfo>
                                  <label>
                                    VLAN Interface Name (auto)
                                    <input
                                      value={iface.vlan?.name || suggestedVlanName(iface.vlan?.baseIface || iface.ethernet?.name || iface.bond?.name, iface.vlan?.id)}
                                      onChange={(e) => updateAdditionalInterface(selectedIndex, ifaceIndex, { vlan: { ...iface.vlan, name: e.target.value } })}
                                    />
                                  </label>
                                </>
                              )}
                              {iface.mode === "static" && (
                                <>
                                  <label>
                                    IPv4 Address/CIDR
                                    <input value={iface.ipv4Cidr || ""} onChange={(e) => updateAdditionalInterface(selectedIndex, ifaceIndex, { ipv4Cidr: e.target.value.trim() })} />
                                  </label>
                                  {enableIpv6 && (
                                    <label>
                                      IPv6 Address/CIDR
                                      <input value={iface.ipv6Cidr || ""} onChange={(e) => updateAdditionalInterface(selectedIndex, ifaceIndex, { ipv6Cidr: e.target.value })} />
                                    </label>
                                  )}
                                </>
                              )}
                            </div>
                            <div className="card-header">
                              <h4>Advanced Networking</h4>
                              <button type="button" className="card-header-collapse-btn" onClick={() => setAdditionalAdvancedOpen((prev) => ({ ...prev, [ifaceIndex]: !prev[ifaceIndex] }))} aria-expanded={additionalAdvancedOpen[ifaceIndex]} aria-label={additionalAdvancedOpen[ifaceIndex] ? "Collapse Advanced Networking" : "Expand Advanced Networking"}>
                                <span className="host-inventory-v2-gather-info-expand-label" aria-hidden>{additionalAdvancedOpen[ifaceIndex] ? "Collapse" : "Expand"}</span>
                              </button>
                            </div>
                            {additionalAdvancedOpen[ifaceIndex] ? (
                              <div className="field-grid">
                                <label>
                                  Base MTU (optional)
                                  <input
                                    value={iface.advanced?.mtu || ""}
                                    onChange={(e) => updateAdditionalInterface(selectedIndex, ifaceIndex, { advanced: { ...iface.advanced, mtu: e.target.value } })}
                                    placeholder="1500"
                                  />
                                </label>
                                {(iface.type === "vlan-on-ethernet" || iface.type === "vlan-on-bond") && (
                                  <label>
                                    VLAN MTU (optional)
                                    <input
                                      value={iface.advanced?.vlanMtu || ""}
                                      onChange={(e) => updateAdditionalInterface(selectedIndex, ifaceIndex, { advanced: { ...iface.advanced, vlanMtu: e.target.value } })}
                                      placeholder="1500"
                                    />
                                  </label>
                                )}
                                <label>
                                  SR-IOV
                                  <input
                                    type="checkbox"
                                    checked={iface.advanced?.sriov?.enabled || false}
                                    onChange={(e) => updateAdditionalInterface(selectedIndex, ifaceIndex, { advanced: { ...iface.advanced, sriov: { ...iface.advanced?.sriov, enabled: e.target.checked } } })}
                                  />
                                </label>
                                {iface.advanced?.sriov?.enabled && (
                                  <label>
                                    SR-IOV Total VFs
                                    <input
                                      value={iface.advanced?.sriov?.totalVfs || ""}
                                      onChange={(e) => updateAdditionalInterface(selectedIndex, ifaceIndex, { advanced: { ...iface.advanced, sriov: { ...iface.advanced?.sriov, totalVfs: e.target.value } } })}
                                      placeholder="8"
                                    />
                                  </label>
                                )}
                                <label>
                                  VRF
                                  <input
                                    type="checkbox"
                                    checked={iface.advanced?.vrf?.enabled || false}
                                    onChange={(e) => updateAdditionalInterface(selectedIndex, ifaceIndex, { advanced: { ...iface.advanced, vrf: { ...iface.advanced?.vrf, enabled: e.target.checked } } })}
                                  />
                                </label>
                                {iface.advanced?.vrf?.enabled && (
                                  <>
                                    <label>
                                      VRF Name
                                      <input value={iface.advanced?.vrf?.name || "vrf0"} onChange={(e) => updateAdditionalInterface(selectedIndex, ifaceIndex, { advanced: { ...iface.advanced, vrf: { ...iface.advanced?.vrf, name: e.target.value } } })} />
                                    </label>
                                    <label>
                                      VRF Table ID
                                      <input value={iface.advanced?.vrf?.tableId || "100"} onChange={(e) => updateAdditionalInterface(selectedIndex, ifaceIndex, { advanced: { ...iface.advanced, vrf: { ...iface.advanced?.vrf, tableId: e.target.value } } })} />
                                    </label>
                                    <label>
                                      VRF Ports (comma-separated)
                                      <input value={iface.advanced?.vrf?.ports || ""} onChange={(e) => updateAdditionalInterface(selectedIndex, ifaceIndex, { advanced: { ...iface.advanced, vrf: { ...iface.advanced?.vrf, ports: e.target.value } } })} />
                                    </label>
                                  </>
                                )}
                              </div>
                            ) : null}
                          </section>
                        ))}
                        <button type="button" className="ghost" onClick={() => addAdditionalInterface(selectedIndex)}>Add Interface</button>
                      </div>
                      </>
                      ) : null}

                      {showBmc && (
                        <>
                          <h4>BMC (IPI)</h4>
                          <div className="field-grid">
                            <label>BMC address <input value={selectedNode.bmc?.address || ""} onChange={(e) => updateNode(selectedIndex, { bmc: { ...selectedNode.bmc, address: e.target.value } })} /></label>
                            <label>BMC username <input autoComplete="off" value={selectedNode.bmc?.username || ""} onChange={(e) => updateNode(selectedIndex, { bmc: { ...selectedNode.bmc, username: e.target.value } })} /></label>
                            <label>BMC password <input type="password" autoComplete="new-password" value={selectedNode.bmc?.password || ""} onChange={(e) => updateNode(selectedIndex, { bmc: { ...selectedNode.bmc, password: e.target.value } })} /></label>
                            <label>Boot MAC <input value={selectedNode.bmc?.bootMACAddress || ""} onChange={(e) => updateNode(selectedIndex, { bmc: { ...selectedNode.bmc, bootMACAddress: formatMACAsYouType(e.target.value) } })} onBlur={(e) => { const v = normalizeMAC(e.target.value); if (v && v !== e.target.value) updateNode(selectedIndex, { bmc: { ...selectedNode.bmc, bootMACAddress: v } }); }} /></label>
                            <label className="host-inventory-v2-checkbox-label">
                              <input
                                type="checkbox"
                                checked={selectedNode.bmc?.disableCertificateVerification === true}
                                onChange={(e) => updateNode(selectedIndex, { bmc: { ...selectedNode.bmc, disableCertificateVerification: e.target.checked } })}
                              />
                              {" "}Disable BMC certificate verification (e.g. self-signed)
                            </label>
                          </div>
                        </>
                      )}

                      {showAdvancedDrawer && !isArbiterDrawer && (
                        <>
                          <div className="card-header host-inventory-v2-section-heading host-inventory-v2-advanced-header">
                            <h4>Advanced</h4>
                            <CompareBadge kind={badgeAdvancedDrawer} />
                            <button type="button" className="card-header-collapse-btn" onClick={() => setAdvancedOpen((o) => !o)} aria-expanded={advancedOpen} aria-label={advancedOpen ? "Collapse Advanced" : "Expand Advanced"}>
                              <span className="host-inventory-v2-gather-info-expand-label" aria-hidden>{advancedOpen ? "Collapse" : "Expand"}</span>
                            </button>
                          </div>
                          {advancedOpen && (
                            <>
                              <div className="field-grid">
                                <label>MTU <input value={selectedNode.primary?.advanced?.mtu || ""} onChange={(e) => updatePrimaryAdvanced(selectedIndex, { mtu: e.target.value })} placeholder="1500" /></label>
                                {(selectedNode.primary?.type === "vlan-on-ethernet" || selectedNode.primary?.type === "vlan-on-bond") && (
                                  <label>VLAN MTU <input value={selectedNode.primary?.advanced?.vlanMtu || ""} onChange={(e) => updatePrimaryAdvanced(selectedIndex, { vlanMtu: e.target.value })} placeholder="1500" /></label>
                                )}
                              </div>
                              <p className="note subtle host-inventory-v2-advanced-mtu-note" style={{ marginTop: 6, marginBottom: 0 }}>
                                MTU applies to the base interface; VLAN MTU applies to the VLAN subinterface (if present). VLAN MTU cannot exceed the base MTU. Each additional interface has its own Advanced section with per-interface MTU.
                              </p>
                              <div className="list">
                                <h4><FieldLabelWithInfo label="Additional Routes" hint="Optional static routes beyond the default gateway." /></h4>
                                {(selectedNode.primary?.advanced?.routes || []).map((route, ri) => {
                                  const baseIface = primaryBaseIface(selectedNode);
                                  const vlanName = selectedNode.primary?.vlan?.name || suggestedVlanName(selectedNode.primary?.vlan?.baseIface || baseIface, selectedNode.primary?.vlan?.id);
                                  return (
                                    <div key={ri} className="field-grid">
                                      <label>
                                        Destination
                                        <input
                                          value={route.destination}
                                          onChange={(e) => updatePrimaryRoute(selectedIndex, ri, { destination: e.target.value })}
                                          placeholder="10.0.0.0/24"
                                        />
                                      </label>
                                      <label>
                                        Next Hop Address
                                        <input
                                          value={route.nextHopAddress}
                                          onChange={(e) => updatePrimaryRoute(selectedIndex, ri, { nextHopAddress: e.target.value })}
                                          placeholder="192.168.1.1"
                                        />
                                      </label>
                                      <label>
                                        Next Hop Interface (optional)
                                        <input
                                          value={route.nextHopInterface || ""}
                                          onChange={(e) => updatePrimaryRoute(selectedIndex, ri, { nextHopInterface: e.target.value })}
                                          placeholder={vlanName || baseIface}
                                        />
                                      </label>
                                      <label>
                                        Remove
                                        <button type="button" className="ghost" onClick={() => removePrimaryRoute(selectedIndex, ri)}>Remove Route</button>
                                      </label>
                                    </div>
                                  );
                                })}
                                <button type="button" className="ghost" onClick={() => addPrimaryRoute(selectedIndex)}>Add Route</button>
                              </div>
                            </>
                          )}
                        </>
                          )}
                        </>
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
                <h4>Settings to copy</h4>
                {REPLICATE_OPTIONS.filter((opt) => (opt.key === "bmc" ? showBmc : true)).map((opt) => (
                  <label key={opt.key} className="toggle-row">
                    <input
                      type="checkbox"
                      checked={replicateSelectedFields.has(opt.key)}
                      onChange={(e) => setReplicateSelectedFields((prev) => { const next = new Set(prev); if (e.target.checked) next.add(opt.key); else next.delete(opt.key); return next; })}
                    />
                    <span>{opt.label}</span>
                  </label>
                ))}
              </div>
              <div className="list">
                <h4>Apply to nodes</h4>
                <label className="toggle-row" style={{ marginBottom: 8 }}>
                  <input
                    type="checkbox"
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
                  />
                  <span>Apply to all other eligible nodes</span>
                </label>
                {nodes.map((node, idx) => (
                  <label key={idx} className="toggle-row">
                    <input
                      type="checkbox"
                      disabled={idx === selectedIndex || (node.role || "").trim() === "arbiter"}
                      checked={replicateTargetIndices.has(idx)}
                      onChange={(e) => setReplicateTargetIndices((prev) => { const next = new Set(prev); if (e.target.checked) next.add(idx); else next.delete(idx); return next; })}
                    />
                    <span>
                      {effectiveHostname(node) || `Node ${idx + 1}`} ({node.role}
                      {(node.role || "").trim() === "arbiter" ? "; not eligible for bulk copy" : ""})
                    </span>
                  </label>
                ))}
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
