/**
 * Host Inventory v2 helpers. Used only when hostInventoryV2 flag is on.
 * Node shape matches what backend generation expects (state.hostInventory.nodes).
 */

/** Section IDs for scenario-aware layout (Phase 4.2). API/Ingress VIPs are on the Networking tab only. */
export const SECTION_IDS = {
  AGENT_OPTIONS: "agentOptions",
  NODE_COUNTS: "nodeCounts",
  NODE_GRID: "nodeGrid",
  NODE_DRAWER_BASIC: "nodeDrawerBasic",
  NODE_DRAWER_ADVANCED: "nodeDrawerAdvanced",
  REPLICATE_MODAL: "replicateModal"
};

/** Legacy (default) section order: all sections in current display order. */
export const DEFAULT_SECTION_ORDER = [
  SECTION_IDS.AGENT_OPTIONS,
  SECTION_IDS.NODE_COUNTS,
  SECTION_IDS.NODE_GRID,
  SECTION_IDS.NODE_DRAWER_BASIC,
  SECTION_IDS.NODE_DRAWER_ADVANCED,
  SECTION_IDS.REPLICATE_MODAL
];

/** Scenario id -> ordered section list (hand-authored). Only these sections are rendered when scenarioAwareLayout is ON. */
export const SCENARIO_SECTION_ORDER = {
  "bare-metal-agent": [
    SECTION_IDS.AGENT_OPTIONS,
    SECTION_IDS.NODE_COUNTS,
    SECTION_IDS.NODE_GRID,
    SECTION_IDS.NODE_DRAWER_BASIC,
    SECTION_IDS.NODE_DRAWER_ADVANCED,
    SECTION_IDS.REPLICATE_MODAL
  ],
  "bare-metal-ipi": [
    SECTION_IDS.NODE_COUNTS,
    SECTION_IDS.NODE_GRID,
    SECTION_IDS.NODE_DRAWER_BASIC,
    SECTION_IDS.NODE_DRAWER_ADVANCED,
    SECTION_IDS.REPLICATE_MODAL
  ],
  "vsphere-agent": [
    SECTION_IDS.AGENT_OPTIONS,
    SECTION_IDS.NODE_COUNTS,
    SECTION_IDS.NODE_GRID,
    SECTION_IDS.NODE_DRAWER_BASIC,
    SECTION_IDS.NODE_DRAWER_ADVANCED,
    SECTION_IDS.REPLICATE_MODAL
  ]
};

/** Scenario ids for which the Hosts / Inventory step shows full UI (have host inventory in this app). */
export const SCENARIO_IDS_WITH_HOST_INVENTORY = ["bare-metal-agent", "bare-metal-ipi", "vsphere-agent"];

/**
 * Derive scenarioId from platform and methodology.
 * @param {string} platform - e.g. "Bare Metal", "VMware vSphere"
 * @param {string} method - e.g. "Agent-Based Installer", "IPI", "UPI"
 * @returns {string|null} "bare-metal-agent" | "bare-metal-ipi" | "bare-metal-upi" | "vsphere-agent" | "vsphere-ipi" | "vsphere-upi" | "aws-govcloud-ipi" | "aws-govcloud-upi" | "azure-government-ipi" | "ibm-cloud-ipi" | "nutanix-ipi" | null
 */
export function getScenarioId(platform, method) {
  if (platform === "Bare Metal") {
    if (method === "Agent-Based Installer") return "bare-metal-agent";
    if (method === "IPI") return "bare-metal-ipi";
    if (method === "UPI") return "bare-metal-upi";
    return null;
  }
  if (platform === "VMware vSphere") {
    if (method === "Agent-Based Installer") return "vsphere-agent";
    if (method === "IPI") return "vsphere-ipi";
    if (method === "UPI") return "vsphere-upi";
    return null;
  }
  if (platform === "AWS GovCloud") {
    if (method === "IPI") return "aws-govcloud-ipi";
    if (method === "UPI") return "aws-govcloud-upi";
    return null;
  }
  if (platform === "Azure Government") {
    if (method === "IPI") return "azure-government-ipi";
    return null;
  }
  if (platform === "IBM Cloud") {
    if (method === "IPI") return "ibm-cloud-ipi";
    return null;
  }
  if (platform === "Nutanix") {
    if (method === "IPI") return "nutanix-ipi";
    return null;
  }
  return null;
}

/**
 * Ordered list of section ids to render. When scenarioAwareLayout is ON uses scenario order; otherwise legacy order.
 * @param {boolean} scenarioAwareLayout
 * @param {string|null} scenarioId
 * @returns {string[]}
 */
export function getSectionOrderForRender(scenarioAwareLayout, scenarioId) {
  if (scenarioAwareLayout && scenarioId && SCENARIO_SECTION_ORDER[scenarioId]) {
    return SCENARIO_SECTION_ORDER[scenarioId];
  }
  return DEFAULT_SECTION_ORDER;
}

/** Collect all interface names (eno0, eno1, bond0, etc.) from primary and additionalInterfaces to compute next enoN. */
export function getNextEnoName(node) {
  const names = new Set();
  const primary = node?.primary;
  if (primary?.type === "ethernet" || primary?.type === "vlan-on-ethernet") {
    if (primary.ethernet?.name) names.add(primary.ethernet.name);
  }
  if (primary?.bond?.name) names.add(primary.bond.name);
  if (Array.isArray(primary?.bond?.slaves)) {
    primary.bond.slaves.forEach((s) => { if (s?.name) names.add(s.name); });
  }
  (node?.additionalInterfaces || []).forEach((iface) => {
    if (iface?.ethernet?.name) names.add(iface.ethernet.name);
    if (iface?.bond?.name) names.add(iface.bond.name);
    if (Array.isArray(iface?.bond?.slaves)) {
      iface.bond.slaves.forEach((s) => { if (s?.name) names.add(s.name); });
    }
  });
  let n = 0;
  while (names.has(`eno${n}`)) n++;
  return `eno${n}`;
}

export const createInterfaceConfig = (overrides = {}) => ({
  type: "ethernet",
  mode: "dhcp",
  ipv4Cidr: "",
  ipv4Gateway: "",
  ipv6Cidr: "",
  ipv6Gateway: "",
  ethernet: { name: "eno0", macAddress: "" },
  bond: {
    name: "bond0",
    mode: "active-backup",
    slaves: [
      { name: "eno0", macAddress: "" },
      { name: "eno1", macAddress: "" }
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

export const emptyNode = (role, index, hostnamePrefix = null) => {
  const prefix = hostnamePrefix != null ? hostnamePrefix : role;
  return {
    role: role === "control-plane" ? "master" : role,
    hostname: `${prefix}-${index}`,
    hostnameUseFqdn: false,
    rootDevice: "",
    rootDeviceHintHctl: "",
    rootDeviceHintModel: "",
    rootDeviceHintVendor: "",
    rootDeviceHintSerialNumber: "",
    rootDeviceHintWwn: "",
    rootDeviceHintMinSizeGb: "",
    rootDeviceHintRotational: "",
    dnsServers: "",
    dnsSearch: "",
    bmc: { address: "", username: "", password: "", bootMACAddress: "", disableCertificateVerification: false },
    primary: createInterfaceConfig(),
    additionalInterfaces: []
  };
};

/**
 * Generate node array from counts. Writes into same state shape as backend consumes.
 * @param {number} controlPlaneCount
 * @param {number} workerCount
 * @param {number} [infraCount=0] - optional; created as worker role with hostname infra-0, infra-1, ...
 * @returns {Array<object>} nodes for state.hostInventory.nodes
 */
export function generateNodesFromCounts(controlPlaneCount, workerCount, infraCount = 0) {
  const nodes = [];
  for (let i = 0; i < controlPlaneCount; i++) {
    nodes.push(emptyNode("master", i));
  }
  for (let i = 0; i < workerCount; i++) {
    nodes.push(emptyNode("worker", i));
  }
  for (let i = 0; i < (infraCount || 0); i++) {
    nodes.push(emptyNode("worker", i, "infra"));
  }
  return nodes;
}

/**
 * OpenShift 4.20 Agent-based install-config: controlPlane.replicas may be 1 (SNO only), 3, 4, or 5,
 * or 2 with exactly one arbiter (installation-config-parameters-agent).
 * @param {Array<{ role?: string }>} nodes
 * @returns {string[]} topology errors (empty if valid or nodes empty)
 */
export function getAgentBasedTopologyErrors(nodes) {
  const list = Array.isArray(nodes) ? nodes : [];
  if (list.length === 0) return [];

  const masters = list.filter((n) => (n?.role || "").trim() === "master").length;
  const arbiters = list.filter((n) => (n?.role || "").trim() === "arbiter").length;
  const workers = list.filter((n) => (n?.role || "").trim() === "worker").length;
  const errors = [];

  if (![1, 2, 3, 4, 5].includes(masters)) {
    errors.push(
      `Agent-based install-config allows control plane replicas 1 (single-node only), 2 (with one arbiter), 3, 4, or 5 (OpenShift 4.20). Inventory has ${masters} control plane node(s).`
    );
  }
  if (masters === 1) {
    if (workers > 0) {
      errors.push(
        "Single-node OpenShift uses one control plane node and zero workers. Set workers and infra to zero, or use three or more control plane nodes."
      );
    }
    if (arbiters > 0) {
      errors.push("Arbiter is only used with exactly two control plane nodes.");
    }
  }
  if (masters === 2) {
    if (arbiters !== 1) {
      errors.push("Two control plane nodes require exactly one arbiter node (OpenShift 4.20 Agent-based).");
    }
  } else if (arbiters > 0) {
    errors.push("Arbiter is only valid when there are exactly two control plane nodes.");
  }
  return errors;
}

/** Keys that should NOT be copied by default when replicating (hostname, BMC, MACs). */
export const REPLICATE_EXCLUDE_DEFAULT = new Set([
  "hostname",
  "bmc",
  "primary.ethernet.macAddress",
  "primary.bond.slaves"
]);

/**
 * Apply selected settings from source node to target nodes.
 * Only copies fields that are in selectedFields; never copies hostname/bmc/MACs unless explicitly selected.
 * @param {object} sourceNode
 * @param {object[]} targetNodes
 * @param {Set<string>} selectedFields - e.g. new Set(["dnsServers", "dnsSearch", "primary.type", "primary.mode", "primary.vlan", "primary.bond", "primary.advanced", "primary.ipv4Gateway", "primary.ipv6Gateway"])
 * @returns {object[]} new array of target nodes with applied settings
 */
export function applyReplicateSettings(sourceNode, targetNodes, selectedFields) {
  if (!sourceNode || !targetNodes?.length) return targetNodes;

  const copyPrimaryShape = (destPrimary, srcPrimary, selectedFieldsForNode) => {
    if (selectedFieldsForNode.has("primary.type")) destPrimary.type = srcPrimary.type;
    if (selectedFieldsForNode.has("primary.mode")) destPrimary.mode = srcPrimary.mode;
    if (selectedFieldsForNode.has("primary.ipv4Cidr")) destPrimary.ipv4Cidr = srcPrimary.ipv4Cidr;
    if (selectedFieldsForNode.has("primary.ipv4Gateway")) destPrimary.ipv4Gateway = srcPrimary.ipv4Gateway;
    if (selectedFieldsForNode.has("primary.ipv6Cidr")) destPrimary.ipv6Cidr = srcPrimary.ipv6Cidr;
    if (selectedFieldsForNode.has("primary.ipv6Gateway")) destPrimary.ipv6Gateway = srcPrimary.ipv6Gateway;
    if (selectedFieldsForNode.has("primary.vlan")) {
      destPrimary.vlan = { ...destPrimary.vlan, ...srcPrimary.vlan };
    }
    if (selectedFieldsForNode.has("primary.bond")) {
      destPrimary.bond = {
        ...destPrimary.bond,
        mode: srcPrimary.bond?.mode ?? destPrimary.bond.mode,
        name: srcPrimary.bond?.name ?? destPrimary.bond.name,
        slaves: (srcPrimary.bond?.slaves ?? []).map((s) => ({
          ...s,
          macAddress: selectedFieldsForNode.has("primary.bond.slaves.macAddress") ? s.macAddress : ""
        }))
      };
    }
    if (selectedFieldsForNode.has("primary.advanced")) {
      destPrimary.advanced = {
        ...destPrimary.advanced,
        mtu: srcPrimary.advanced?.mtu ?? "",
        vlanMtu: srcPrimary.advanced?.vlanMtu ?? "",
        routes: Array.isArray(srcPrimary.advanced?.routes) ? srcPrimary.advanced.routes.map((r) => ({ ...r })) : []
      };
    }
    if (
      selectedFieldsForNode.has("primary.ethernet") ||
      selectedFieldsForNode.has("primary.ethernet.macAddress")
    ) {
      destPrimary.ethernet = {
        name: srcPrimary.ethernet?.name ?? destPrimary.ethernet?.name,
        macAddress: selectedFieldsForNode.has("primary.ethernet.macAddress")
          ? (srcPrimary.ethernet?.macAddress ?? "")
          : (destPrimary.ethernet?.macAddress ?? "")
      };
    }
  };

  return targetNodes.map((node) => {
    const next = { ...node };
    // Arbiter nodes in bare-metal-agent intentionally hide Root device hints and Advanced (MTU/routes).
    // Even if the modal user checked those copy options, do not apply them to arbiter targets.
    const isArbiterTarget = node?.role === "arbiter";
    const selectedFieldsForNode = isArbiterTarget
      ? new Set(
        Array.from(selectedFields).filter((k) => k !== "rootDevice" && k !== "primary.advanced")
      )
      : selectedFields;
    if (selectedFieldsForNode.has("dnsServers")) next.dnsServers = sourceNode.dnsServers ?? "";
    if (selectedFieldsForNode.has("dnsSearch")) next.dnsSearch = sourceNode.dnsSearch ?? "";
    if (selectedFieldsForNode.has("hostname")) next.hostname = sourceNode.hostname ?? node.hostname;
    if (selectedFieldsForNode.has("hostnameUseFqdn")) next.hostnameUseFqdn = !!sourceNode.hostnameUseFqdn;
    if (selectedFieldsForNode.has("rootDevice")) {
      next.rootDevice = sourceNode.rootDevice ?? "";
      next.rootDeviceHintHctl = sourceNode.rootDeviceHintHctl ?? "";
      next.rootDeviceHintModel = sourceNode.rootDeviceHintModel ?? "";
      next.rootDeviceHintVendor = sourceNode.rootDeviceHintVendor ?? "";
      next.rootDeviceHintSerialNumber = sourceNode.rootDeviceHintSerialNumber ?? "";
      next.rootDeviceHintWwn = sourceNode.rootDeviceHintWwn ?? "";
      next.rootDeviceHintMinSizeGb = sourceNode.rootDeviceHintMinSizeGb ?? "";
      next.rootDeviceHintRotational = sourceNode.rootDeviceHintRotational ?? "";
    }
    if (selectedFieldsForNode.has("bmc")) next.bmc = sourceNode.bmc ? { ...sourceNode.bmc } : node.bmc;
    if (
      [
        "primary.type",
        "primary.mode",
        "primary.vlan",
        "primary.bond",
        "primary.advanced",
        "primary.ipv4Cidr",
        "primary.ipv6Cidr",
        "primary.ipv4Gateway",
        "primary.ipv6Gateway",
        "primary.ethernet",
        "primary.ethernet.macAddress"
      ].some((k) => selectedFieldsForNode.has(k))
    ) {
      next.primary = { ...node.primary };
      copyPrimaryShape(next.primary, sourceNode.primary || {}, selectedFieldsForNode);
    }
    return next;
  });
}
