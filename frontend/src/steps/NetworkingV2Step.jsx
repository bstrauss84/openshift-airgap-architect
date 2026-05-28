/**
 * OpenShift Airgap Architect - Networking Configuration Step
 *
 * Network configuration for segmented flow: IPv4/IPv6/dual-stack support,
 * machine/cluster/service network CIDRs, API/Ingress VIPs, OVN advanced options.
 *
 * @author Bill Strauss
 *
 * Developed with AI assistance from Claude (Anthropic) and Cursor AI.
 */
import React, { useState, useEffect } from "react";
import { useApp } from "../store.jsx";
import { getScenarioId, getParamMeta, getRequiredParamsForOutput, getCatalogForScenario } from "../catalogResolver.js";
import { formatIpv4Cidr, formatIpv6Cidr } from "../formatUtils.js";
import { ipv6CidrOverlaps } from "../validation.js";
import OptionRow from "../components/OptionRow.jsx";
import Switch from "../components/Switch.jsx";
import Banner from "../components/Banner.jsx";
import Button from "../components/Button.jsx";
import FieldLabelWithInfo from "../components/FieldLabelWithInfo.jsx";

const INSTALL_CONFIG = "install-config.yaml";

const cidrToRange = (cidr) => {
  if (!cidr || !cidr.includes("/")) return null;
  const [ip, prefix] = cidr.split("/");
  if (!/^\d+\.\d+\.\d+\.\d+$/.test(ip)) return null;
  const bits = Number(prefix);
  if (Number.isNaN(bits) || bits < 0 || bits > 32) return null;
  const toInt = (addr) => addr.split(".").reduce((acc, oct) => (acc << 8) + Number(oct), 0) >>> 0;
  const mask = bits === 0 ? 0 : (-1 << (32 - bits)) >>> 0;
  const base = toInt(ip) & mask;
  const size = 2 ** (32 - bits);
  return { start: base, end: base + size - 1 };
};

const cidrOverlaps = (cidrA, cidrB) => {
  const a = cidrToRange(cidrA);
  const b = cidrToRange(cidrB);
  if (!a || !b) return false;
  return a.start <= b.end && b.start <= a.end;
};

/** Generate example VIP placeholders from machine network CIDR */
const getVipPlaceholders = (machineNetworkCidr) => {
  if (!machineNetworkCidr) {
    return { apiVip: "e.g. 10.90.0.2", ingressVip: "e.g. 10.90.0.3" };
  }

  const range = cidrToRange(machineNetworkCidr);
  if (!range) {
    return { apiVip: "e.g. 10.90.0.2", ingressVip: "e.g. 10.90.0.3" };
  }

  // Convert int to IP string
  const intToIp = (num) => {
    return [
      (num >>> 24) & 255,
      (num >>> 16) & 255,
      (num >>> 8) & 255,
      num & 255
    ].join(".");
  };

  // Suggest start+2 for API VIP, start+3 for Ingress VIP
  // (avoid .0 network address and .1 gateway)
  const apiIp = intToIp(range.start + 2);
  const ingressIp = intToIp(range.start + 3);

  return {
    apiVip: `e.g. ${apiIp}`,
    ingressVip: `e.g. ${ingressIp}`
  };
};

/** Generate example IPv6 VIP placeholders from machine network IPv6 CIDR */
const getVipPlaceholdersV6 = (machineNetworkCidrV6) => {
  if (!machineNetworkCidrV6 || !machineNetworkCidrV6.includes("/")) {
    return { apiVipV6: "e.g. fd00::2", ingressVipV6: "e.g. fd00::3" };
  }

  // Parse IPv6 CIDR (e.g., "fd10:90::/64")
  const [ipv6Base] = machineNetworkCidrV6.split("/");

  // Expand abbreviated IPv6 to full form for manipulation
  const expandIpv6 = (ip) => {
    if (!ip.includes("::")) {
      const parts = ip.split(":");
      return parts.map(p => p.padStart(4, "0")).join(":");
    }

    const [left, right] = ip.split("::");
    const leftParts = left ? left.split(":") : [];
    const rightParts = right ? right.split(":") : [];
    const missingParts = 8 - leftParts.length - rightParts.length;

    const expanded = [
      ...leftParts.map(p => p.padStart(4, "0")),
      ...Array(missingParts).fill("0000"),
      ...rightParts.map(p => p.padStart(4, "0"))
    ];

    return expanded.join(":");
  };

  // Compress IPv6 by removing leading zeros and using :: for longest zero run
  const compressIpv6 = (expanded) => {
    // Remove leading zeros from each segment
    const parts = expanded.split(":").map(p => p.replace(/^0+/, "") || "0");

    // Find longest consecutive run of "0" segments
    let maxZeroStart = -1;
    let maxZeroLen = 0;
    let currentZeroStart = -1;
    let currentZeroLen = 0;

    for (let i = 0; i < parts.length; i++) {
      if (parts[i] === "0") {
        if (currentZeroStart === -1) {
          currentZeroStart = i;
          currentZeroLen = 1;
        } else {
          currentZeroLen++;
        }
      } else {
        if (currentZeroLen > maxZeroLen) {
          maxZeroStart = currentZeroStart;
          maxZeroLen = currentZeroLen;
        }
        currentZeroStart = -1;
        currentZeroLen = 0;
      }
    }

    // Check final run
    if (currentZeroLen > maxZeroLen) {
      maxZeroStart = currentZeroStart;
      maxZeroLen = currentZeroLen;
    }

    // Replace longest zero run with ::
    if (maxZeroLen > 1) {
      const before = parts.slice(0, maxZeroStart);
      const after = parts.slice(maxZeroStart + maxZeroLen);

      if (before.length === 0 && after.length === 0) {
        return "::";
      } else if (before.length === 0) {
        return "::" + after.join(":");
      } else if (after.length === 0) {
        return before.join(":") + "::";
      } else {
        return before.join(":") + "::" + after.join(":");
      }
    }

    return parts.join(":");
  };

  const expanded = expandIpv6(ipv6Base);
  const parts = expanded.split(":");

  // Increment last segment by 2 for API VIP, 3 for Ingress VIP
  const getVipFromBase = (increment) => {
    const lastSegment = parseInt(parts[7], 16) + increment;
    const newParts = [...parts.slice(0, 7), lastSegment.toString(16).padStart(4, "0")];
    const newExpanded = newParts.join(":");
    return compressIpv6(newExpanded);
  };

  return {
    apiVipV6: `e.g. ${getVipFromBase(2)}`,
    ingressVipV6: `e.g. ${getVipFromBase(3)}`
  };
};

export default function NetworkingV2Step({ highlightErrors, fieldErrors = {} }) {
  const { state, updateState } = useApp();
  const scenarioId = getScenarioId(state);
  const strategy = state.globalStrategy || {};
  const networking = strategy.networking || {};
  const hostInventory = state.hostInventory || {};
  const platformConfig = state.platformConfig || {};
  const updateStrategy = (patch) => updateState({ globalStrategy: { ...strategy, ...patch } });
  const updateNetworking = (patch) =>
    updateStrategy({ networking: { ...networking, ...patch } });
  const updateHostInventory = (patch) =>
    updateState({ hostInventory: { ...hostInventory, ...patch } });
  const updateVsphere = (patch) =>
    updateState({ platformConfig: { ...platformConfig, vsphere: { ...platformConfig.vsphere, ...patch } } });
  const updateNutanix = (patch) =>
    updateState({ platformConfig: { ...platformConfig, nutanix: { ...platformConfig.nutanix, ...patch } } });

  // Local state for onBlur pattern (23 text input fields)
  const [localMachineNetworkV4, setLocalMachineNetworkV4] = useState(networking.machineNetworkV4 || "");
  const [localMachineNetworkV6, setLocalMachineNetworkV6] = useState(networking.machineNetworkV6 || "");
  const [localClusterNetworkCidr, setLocalClusterNetworkCidr] = useState(networking.clusterNetworkCidr || "");
  const [localClusterNetworkCidrV6, setLocalClusterNetworkCidrV6] = useState(networking.clusterNetworkCidrV6 || "");
  const [localServiceNetworkCidr, setLocalServiceNetworkCidr] = useState(networking.serviceNetworkCidr || "");
  const [localServiceNetworkCidrV6, setLocalServiceNetworkCidrV6] = useState(networking.serviceNetworkCidrV6 || "");
  const [localNutanixApiVIP, setLocalNutanixApiVIP] = useState(platformConfig.nutanix?.apiVIP || "");
  const [localNutanixApiVIPV6, setLocalNutanixApiVIPV6] = useState(platformConfig.nutanix?.apiVIPV6 || "");
  const [localNutanixIngressVIP, setLocalNutanixIngressVIP] = useState(platformConfig.nutanix?.ingressVIP || "");
  const [localNutanixIngressVIPV6, setLocalNutanixIngressVIPV6] = useState(platformConfig.nutanix?.ingressVIPV6 || "");
  const [localVsphereApiVIPs, setLocalVsphereApiVIPs] = useState(
    Array.isArray(platformConfig.vsphere?.apiVIPs) ? platformConfig.vsphere.apiVIPs.join(", ") : ""
  );
  const [localVsphereIngressVIPs, setLocalVsphereIngressVIPs] = useState(
    Array.isArray(platformConfig.vsphere?.ingressVIPs) ? platformConfig.vsphere.ingressVIPs.join(", ") : ""
  );
  const [localApiVip, setLocalApiVip] = useState(hostInventory.apiVip || "");
  const [localApiVipV6, setLocalApiVipV6] = useState(hostInventory.apiVipV6 ?? "");
  const [localIngressVip, setLocalIngressVip] = useState(hostInventory.ingressVip || "");
  const [localIngressVipV6, setLocalIngressVipV6] = useState(hostInventory.ingressVipV6 ?? "");

  // Sync local state with store changes
  useEffect(() => {
    setLocalMachineNetworkV4(networking.machineNetworkV4 || "");
  }, [networking.machineNetworkV4]);

  useEffect(() => {
    setLocalMachineNetworkV6(networking.machineNetworkV6 || "");
  }, [networking.machineNetworkV6]);

  useEffect(() => {
    setLocalClusterNetworkCidr(networking.clusterNetworkCidr || "");
  }, [networking.clusterNetworkCidr]);

  useEffect(() => {
    setLocalClusterNetworkCidrV6(networking.clusterNetworkCidrV6 || "");
  }, [networking.clusterNetworkCidrV6]);

  useEffect(() => {
    setLocalServiceNetworkCidr(networking.serviceNetworkCidr || "");
  }, [networking.serviceNetworkCidr]);

  useEffect(() => {
    setLocalServiceNetworkCidrV6(networking.serviceNetworkCidrV6 || "");
  }, [networking.serviceNetworkCidrV6]);

  useEffect(() => {
    setLocalNutanixApiVIP(platformConfig.nutanix?.apiVIP || "");
  }, [platformConfig.nutanix?.apiVIP]);

  useEffect(() => {
    setLocalNutanixApiVIPV6(platformConfig.nutanix?.apiVIPV6 || "");
  }, [platformConfig.nutanix?.apiVIPV6]);

  useEffect(() => {
    setLocalNutanixIngressVIP(platformConfig.nutanix?.ingressVIP || "");
  }, [platformConfig.nutanix?.ingressVIP]);

  useEffect(() => {
    setLocalNutanixIngressVIPV6(platformConfig.nutanix?.ingressVIPV6 || "");
  }, [platformConfig.nutanix?.ingressVIPV6]);

  useEffect(() => {
    setLocalVsphereApiVIPs(
      Array.isArray(platformConfig.vsphere?.apiVIPs) ? platformConfig.vsphere.apiVIPs.join(", ") : ""
    );
  }, [platformConfig.vsphere?.apiVIPs]);

  useEffect(() => {
    setLocalVsphereIngressVIPs(
      Array.isArray(platformConfig.vsphere?.ingressVIPs) ? platformConfig.vsphere.ingressVIPs.join(", ") : ""
    );
  }, [platformConfig.vsphere?.ingressVIPs]);

  useEffect(() => {
    setLocalApiVip(hostInventory.apiVip || "");
  }, [hostInventory.apiVip]);

  useEffect(() => {
    setLocalApiVipV6(hostInventory.apiVipV6 ?? "");
  }, [hostInventory.apiVipV6]);

  useEffect(() => {
    setLocalIngressVip(hostInventory.ingressVip || "");
  }, [hostInventory.ingressVip]);

  useEffect(() => {
    setLocalIngressVipV6(hostInventory.ingressVipV6 ?? "");
  }, [hostInventory.ingressVipV6]);

  const requiredPaths = getRequiredParamsForOutput(scenarioId, INSTALL_CONFIG) || [];
  const isRequired = (path) => requiredPaths.includes(path);
  const nodes = hostInventory.nodes || [];
  const masterCount = nodes.filter((n) => n.role === "master").length;
  const workerCount = nodes.filter((n) => n.role === "worker").length;

  // Generate dynamic VIP placeholders from machine network CIDRs
  const vipPlaceholders = getVipPlaceholders(localMachineNetworkV4);
  const vipPlaceholdersV6 = getVipPlaceholdersV6(localMachineNetworkV6);

  const isAgentSno =
    (scenarioId === "bare-metal-agent" || scenarioId === "vsphere-agent") && masterCount === 1 && workerCount === 0;
  const vipsRequiredForBareMetalAgent = !isAgentSno;

  const metaApiVip = getParamMeta(scenarioId, "platform.baremetal.apiVIP", INSTALL_CONFIG);
  const metaIngressVip = getParamMeta(scenarioId, "platform.baremetal.ingressVIP", INSTALL_CONFIG);
  const metaApiVips = getParamMeta(scenarioId, "platform.baremetal.apiVIPs", INSTALL_CONFIG);
  const metaIngressVips = getParamMeta(scenarioId, "platform.baremetal.ingressVIPs", INSTALL_CONFIG);
  const metaApiVipsVsphere = getParamMeta(scenarioId, "platform.vsphere.apiVIPs", INSTALL_CONFIG);
  const metaIngressVipsVsphere = getParamMeta(scenarioId, "platform.vsphere.ingressVIPs", INSTALL_CONFIG);
  const metaNutanixApiVIP = getParamMeta(scenarioId, "platform.nutanix.apiVIP", INSTALL_CONFIG);
  const metaNutanixIngressVIP = getParamMeta(scenarioId, "platform.nutanix.ingressVIP", INSTALL_CONFIG);

  const overlapMessages = [];
  if (cidrOverlaps(networking.machineNetworkV4, networking.clusterNetworkCidr)) {
    overlapMessages.push("Machine network overlaps with cluster network CIDR.");
  }
  if (cidrOverlaps(networking.machineNetworkV4, networking.serviceNetworkCidr)) {
    overlapMessages.push("Machine network overlaps with service network CIDR.");
  }
  if (cidrOverlaps(networking.clusterNetworkCidr, networking.serviceNetworkCidr)) {
    overlapMessages.push("Cluster network overlaps with service network CIDR.");
  }
  const machineV6 = (networking.machineNetworkV6 || "").trim();
  const clusterV6 = (networking.clusterNetworkCidrV6 || "").trim();
  const serviceV6 = (networking.serviceNetworkCidrV6 || "").trim();
  if (machineV6 && clusterV6 && ipv6CidrOverlaps(machineV6, clusterV6)) {
    overlapMessages.push("Machine network (IPv6) overlaps with cluster network IPv6 CIDR.");
  }
  if (machineV6 && serviceV6 && ipv6CidrOverlaps(machineV6, serviceV6)) {
    overlapMessages.push("Machine network (IPv6) overlaps with service network IPv6 CIDR.");
  }
  if (clusterV6 && serviceV6 && ipv6CidrOverlaps(clusterV6, serviceV6)) {
    overlapMessages.push("Cluster network IPv6 CIDR overlaps with service network IPv6 CIDR.");
  }

  const catalogParams = getCatalogForScenario(scenarioId) || [];
  const hasNetworkingParam = (path) =>
    catalogParams.some((p) => p.path === path && p.outputFile === INSTALL_CONFIG);
  const showBareMetalVips = catalogParams.some(
    (p) =>
      (p.path === "platform.baremetal.apiVIP" ||
        p.path === "platform.baremetal.ingressVIP" ||
        p.path === "platform.baremetal.apiVIPs" ||
        p.path === "platform.baremetal.ingressVIPs") &&
      p.outputFile === INSTALL_CONFIG
  );
  const showVsphereIpiVips = scenarioId === "vsphere-ipi";
  const showVsphereAgentVips = catalogParams.some(
    (p) => p.path === "platform.vsphere.apiVIPs" && p.outputFile === INSTALL_CONFIG
  );
  const showNutanixIpiVips = catalogParams.some(
    (p) => p.path === "platform.nutanix.apiVIP" && p.outputFile === INSTALL_CONFIG
  );
  const showApiIngressVips = showBareMetalVips || showVsphereIpiVips || showVsphereAgentVips || showNutanixIpiVips;
  const showMachineNetwork = hasNetworkingParam("networking.machineNetwork[].cidr");
  const showClusterNetwork = hasNetworkingParam("networking.clusterNetwork[].cidr");
  const showServiceNetwork = hasNetworkingParam("networking.serviceNetwork");
  // Support both ipStackMode (current) and enableIpv6 (legacy) for backward compatibility
  const ipStackMode = hostInventory.ipStackMode || (hostInventory.enableIpv6 ? 'dual-stack' : 'ipv4');
  const enableIpv6 = ipStackMode === 'ipv6' || ipStackMode === 'dual-stack';
  const isAwsGovCloud = scenarioId === "aws-govcloud-ipi" || scenarioId === "aws-govcloud-upi";
  const isIbmCloudIpi = scenarioId === "ibm-cloud-ipi";
  /** AWS GovCloud and IBM Cloud install-config support IPv4-only in 4.20. */
  const isIpv4OnlyScenario = isAwsGovCloud || isIbmCloudIpi;
  const showIpv6ForPlatform = enableIpv6 && !isIpv4OnlyScenario;

  /** IPv6-only mode supported on: bare-metal (all methods), vSphere (all methods) */
  const ipv6OnlySupported = [
    'bare-metal-ipi',
    'bare-metal-agent',
    'bare-metal-upi',
    'vsphere-ipi',
    'vsphere-agent',
    'vsphere-upi'
  ].includes(scenarioId);

  const clusterCardHasErrors = Boolean(
    highlightErrors &&
    (fieldErrors.machineNetworkV4 || fieldErrors.machineNetworkV6 || fieldErrors.clusterNetworkCidr ||
      fieldErrors.clusterNetworkCidrV6 || fieldErrors.serviceNetworkCidr || fieldErrors.serviceNetworkCidrV6)
  );

  return (
    <div className="step">
      <div className="step-header">
        <div className="step-header-main">
          <h2>Networking</h2>
          <p className="subtle">Address pools for nodes, pods, and services.</p>
        </div>
      </div>

      <div className="step-body">
        {state.reviewFlags?.["networking-v2"] && state.ui?.visitedSteps?.["networking-v2"] ? (
          <Banner variant="warning">
            Version or upstream selections changed. Review this page to ensure settings are still valid.
            <div className="actions">
              <Button variant="secondary" onClick={() => updateState({ reviewFlags: { ...state.reviewFlags, "networking-v2": false } })}>
                Re-evaluate this page
              </Button>
            </div>
          </Banner>
        ) : null}
        {isAwsGovCloud ? (
          <Banner variant="info">
            For AWS GovCloud, cluster and service networks are in install-config; machine network is typically derived from your VPC subnets. These CIDRs define address ranges for the cluster; they do not define AWS subnet IDs (subnet IDs are set in Platform Specifics).
          </Banner>
        ) : null}
        {isIbmCloudIpi ? (
          <Banner variant="info">
            IBM Cloud disconnected install in OpenShift 4.20 documents IPv4-only networking. Use machine, cluster, and service IPv4 CIDRs; dual-stack and IPv6 fields are intentionally disabled for this scenario.
          </Banner>
        ) : null}
        {scenarioId === "nutanix-ipi" ? (
          <Banner variant="info">
            Machine, cluster, and service network CIDRs define IP address ranges for cluster components. In Platform Specifics, the Nutanix subnet UUID identifies the Nutanix network segment (VLAN) where the installer creates VMs — these operate at different layers. The UUID selects the virtual network; the CIDR defines the address range within it.
          </Banner>
        ) : null}
        {(scenarioId === "vsphere-ipi" || scenarioId === "vsphere-upi" || scenarioId === "vsphere-agent") ? (
          <Banner variant="info">
            Machine, cluster, and service network CIDRs define IP address ranges for cluster components. In Platform Specifics, vSphere topology network names are vCenter port group or Distributed Port Group names used to attach VM NICs to the correct virtual switch — these are not IP ranges. The port group name selects the virtual switch; the CIDR defines the address range.
          </Banner>
        ) : null}

        <section className={`card ${clusterCardHasErrors ? "highlight-errors" : ""}`}>
          <div className="card-header">
            <div>
              <h3 className="card-title">Cluster Networking</h3>
              <p className="card-subtitle">Machine, cluster, and service networks must not overlap.</p>
            </div>
          </div>
          {overlapMessages.length > 0 ? (
            <Banner variant="error">{overlapMessages.join(" ")} Overlapping networks are not supported.</Banner>
          ) : null}
          <div className="card-body">
            {isIpv4OnlyScenario ? (
              <p className="note" style={{ marginTop: 0, marginBottom: 8 }}>
                This scenario supports IPv4-only networking in OpenShift 4.20. Dual-stack and IPv6 are not available.
              </p>
            ) : (
              <>
                <OptionRow
                  title="IP Stack Mode"
                  description="Choose network stack configuration for the cluster."
                >
                  <select
                    value={ipStackMode}
                    onChange={(e) => updateHostInventory({ ipStackMode: e.target.value })}
                    className="form-select"
                    aria-label="IP Stack Mode"
                  >
                    <option value="ipv4">IPv4 only</option>
                    {ipv6OnlySupported && <option value="ipv6">IPv6 only</option>}
                    <option value="dual-stack">Dual-stack (IPv4 + IPv6)</option>
                  </select>
                </OptionRow>
                {ipStackMode === 'ipv6' ? (
                  <p className="note" style={{ marginTop: 8, marginBottom: 0 }}>
                    IPv6-only mode: Only IPv6 networks and VIPs will be configured. OpenShift 4.20 supports IPv6-only deployments on bare metal and vSphere platforms (Agent, IPI, and UPI methods). All cluster components will use IPv6 addressing exclusively.
                  </p>
                ) : ipStackMode === 'dual-stack' ? (
                  <p className="note" style={{ marginTop: 8, marginBottom: 0 }}>
                    Dual-stack mode: Both IPv4 and IPv6 fields for machine, cluster, and service networks appear together. OpenShift 4.20 documents dual-stack install-config styles for several on-prem platforms (e.g. Agent-based on vSphere/bare metal); Nutanix IPI supports dual-stack networking and VIP lists when you set both IPv4 and IPv6 machine CIDRs and VIPs (see Installing on Nutanix and installation-config-parameters-nutanix). Defaults apply for optional IPv6 CIDRs when left blank. Machine CIDRs are used for node and VIP validation.
                  </p>
                ) : null}
              </>
            )}

            {showMachineNetwork ? (
            <div className="networking-group">
              <h4 className="networking-group-title">Machine network</h4>
              <div className="field-grid">
                {(ipStackMode === 'ipv4' || ipStackMode === 'dual-stack') && (
                <FieldLabelWithInfo
                  label={ipStackMode === 'dual-stack' ? "Machine Network (IPv4 CIDR)" : "Machine Network (IPv4 CIDR)"}
                  hint={`IPv4 network range where cluster nodes live.

**What is this:**
The physical network for control plane and worker nodes (VMs/bare metal hosts)

**Requirements:**
• Must be routable
• Sufficient IPs for all nodes (typically 6+ for minimal cluster: 3 CP + 3 workers)

**When to customize:**
This is often the **main network you customize** - other networks (cluster/service) usually keep defaults unless conflicts exist

**Example:**
192.168.1.0/24 or 10.0.0.0/16`}
                  required={isRequired("networking.machineNetwork[].cidr")}
                >
                  <input
                    className={fieldErrors.machineNetworkV4 ? "input-error" : ""}
                      title={fieldErrors.machineNetworkV4 || ""}
                    value={localMachineNetworkV4}
                    onChange={(e) => setLocalMachineNetworkV4(e.target.value)}
                    onBlur={(e) => {
                      const formatted = formatIpv4Cidr(e.target.value.trim());
                      if (formatted !== networking.machineNetworkV4) {
                        updateNetworking({ machineNetworkV4: formatted });
                      }
                    }}
                    placeholder="10.90.0.0/24"
                    aria-required="true"
                    aria-invalid={fieldErrors.machineNetworkV4 ? "true" : "false"}
                  />
                </FieldLabelWithInfo>
                )}
                {(ipStackMode === 'ipv4' || ipStackMode === 'dual-stack') && cidrOverlaps(networking.machineNetworkV4, networking.clusterNetworkCidr) ? (
                  <span className="note warning inline">Overlaps with cluster network.</span>
                ) : null}
                {(ipStackMode === 'ipv4' || ipStackMode === 'dual-stack') && cidrOverlaps(networking.machineNetworkV4, networking.serviceNetworkCidr) ? (
                  <span className="note warning inline">Overlaps with service network.</span>
                ) : null}
                {showIpv6ForPlatform && (
                  <FieldLabelWithInfo
                    label="Machine Network (IPv6 CIDR)"
                    hint={`IPv6 network range where cluster nodes live.

**When is this required:**
Only for dual-stack deployments (IPv4 + IPv6)

**When to leave blank:**
IPv4-only clusters

**Example:**
fd10:90::/64`}
                  >
                    <input
                      className={fieldErrors.machineNetworkV6 ? "input-error" : ""}
                      title={fieldErrors.machineNetworkV6 || ""}
                      value={localMachineNetworkV6}
                      onChange={(e) => setLocalMachineNetworkV6(e.target.value)}
                      onBlur={(e) => {
                        const formatted = formatIpv6Cidr(e.target.value.trim());
                        if (formatted !== networking.machineNetworkV6) {
                          updateNetworking({ machineNetworkV6: formatted });
                        }
                      }}
                      placeholder="fd10:90::/64"
                    />
                  </FieldLabelWithInfo>
                )}
              </div>
            </div>
            ) : null}

            {showClusterNetwork ? (
            <div className="networking-group">
              <h4 className="networking-group-title">Cluster-level</h4>
              <div className="field-grid">
                {(ipStackMode === 'ipv4' || ipStackMode === 'dual-stack') && (
                <>
                  <FieldLabelWithInfo
                    label="Cluster Network CIDR"
                    hint={`IPv4 network range for pod-to-pod communication.

**What is this:**
Software-defined network (SDN) for containers running in the cluster

**How it works:**
Each node is allocated a subnet from this range based on Host Prefix (below)

**Default:**
10.128.0.0/14 (~16,000 pod IPs)

**When to change:**
Only if this range conflicts with existing infrastructure networks

**Network isolation:**
Cluster network is **completely isolated** from external networks - pods communicate externally through NAT or load balancers

**Example:**
If your datacenter uses 10.x.x.x, change to 172.30.0.0/16`}
                    required={isRequired("networking.clusterNetwork[].cidr")}
                  >
                    <input
                      className={fieldErrors.clusterNetworkCidr ? "input-error" : ""}
                        title={fieldErrors.clusterNetworkCidr || ""}
                      value={localClusterNetworkCidr}
                      onChange={(e) => setLocalClusterNetworkCidr(e.target.value)}
                      onBlur={(e) => {
                        const formatted = formatIpv4Cidr(e.target.value.trim());
                        if (formatted !== networking.clusterNetworkCidr) {
                          updateNetworking({ clusterNetworkCidr: formatted });
                        }
                      }}
                      placeholder="10.128.0.0/14"
                      aria-required={isRequired("networking.clusterNetwork[].cidr") ? "true" : "false"}
                      aria-invalid={fieldErrors.clusterNetworkCidr ? "true" : "false"}
                    />
                  </FieldLabelWithInfo>
                  {cidrOverlaps(networking.clusterNetworkCidr, networking.serviceNetworkCidr) ? (
                    <span className="note warning inline">Overlaps with service network.</span>
                  ) : null}
                  {cidrOverlaps(networking.machineNetworkV4, networking.clusterNetworkCidr) ? (
                    <span className="note warning inline">Overlaps with machine network.</span>
                  ) : null}
                  <FieldLabelWithInfo
                    label="Cluster Network Host Prefix"
                    hint={`Subnet prefix length for per-node pod IP allocation.

**What this controls:**
How many pods each node can run

**Default:**
/23 = 512 pod IPs per node

**Tradeoff:**
• Lower numbers = more IPs per node, fewer total nodes supported
• Higher numbers = fewer IPs per node, more total nodes supported

**Example calculation:**
/23 with /14 cluster CIDR supports ~16,000 nodes with 512 pods each

**When to adjust:**
• Need more pods per node: use /22 (1024 pods)
• Very large cluster: use higher prefix

**Valid range:**
/16 (65k pods/node) to /28 (16 pods/node)`}
                    required={isRequired("networking.clusterNetwork[].hostPrefix")}
                  >
                    <input
                      type="number"
                      value={networking.clusterNetworkHostPrefix ?? 23}
                      onChange={(e) =>
                        updateNetworking({ clusterNetworkHostPrefix: Number(e.target.value) })
                      }
                      min={16}
                      max={28}
                    />
                  </FieldLabelWithInfo>
                </>
                )}
                {showIpv6ForPlatform && (
                  <>
                    <FieldLabelWithInfo
                      label={ipStackMode === 'ipv6' ? "Cluster Network CIDR (optional)" : "Cluster Network IPv6 CIDR (optional)"}
                      hint={`IPv6 network range for pod-to-pod communication.

**Use case:**
Dual-stack or IPv6-only data plane

**Default behavior:**
If left blank, defaults to fd01::/48

**Example:**
fd01::/48`}
                    >
                      <input
                        className={fieldErrors.clusterNetworkCidrV6 ? "input-error" : ""}
                      title={fieldErrors.clusterNetworkCidrV6 || ""}
                        value={localClusterNetworkCidrV6}
                        onChange={(e) => setLocalClusterNetworkCidrV6(e.target.value)}
                        onBlur={(e) => {
                          const formatted = formatIpv6Cidr(e.target.value.trim()) || undefined;
                          if (formatted !== networking.clusterNetworkCidrV6) {
                            updateNetworking({ clusterNetworkCidrV6: formatted });
                          }
                        }}
                        placeholder="fd01::/48"
                        aria-required="false"
                        aria-invalid={fieldErrors.clusterNetworkCidrV6 ? "true" : "false"}
                      />
                    </FieldLabelWithInfo>
                    <FieldLabelWithInfo
                      label="Cluster Network IPv6 Host Prefix (optional)"
                      hint={`Subnet prefix length for per-node IPv6 pod IP allocation.

**What this controls:**
How many IPv6 addresses each node gets for pod networking

**Default:**
/64 = 18 quintillion pod IPs per node (IPv6's abundance makes this practical)

**Tradeoff:**
• Lower numbers (e.g. /56) = more IPs per node, fewer total nodes supported
• Higher numbers (e.g. /80) = fewer IPs per node, more total nodes supported

**IPv6 vs IPv4:**
IPv6 uses larger prefixes than IPv4 due to address abundance - /64 is standard

**Example calculation:**
/64 with /48 cluster CIDR supports ~65,000 nodes with 18 quintillion pods each

**When to adjust:**
Rarely needed - /64 is standard and supports massive pod counts per node

**Valid range:**
/48 (huge per-node allocation) to /128 (single IP per node)`}
                    >
                      <input
                        type="number"
                        value={networking.clusterNetworkHostPrefixV6 ?? 64}
                        onChange={(e) =>
                          updateNetworking({
                            clusterNetworkHostPrefixV6: e.target.value === "" ? undefined : Number(e.target.value)
                          })
                        }
                        min={48}
                        max={128}
                        placeholder="64"
                      />
                    </FieldLabelWithInfo>
                  </>
                )}
              </div>
            </div>
            ) : null}

            {showServiceNetwork ? (
            <div className="networking-group">
              <h4 className="networking-group-title">Service network</h4>
              <div className="field-grid">
                {(ipStackMode === 'ipv4' || ipStackMode === 'dual-stack') && (
                <>
                  <FieldLabelWithInfo
                    label="Service Network CIDR"
                    hint={`IPv4 network range for Kubernetes ClusterIP services.

**What is this:**
Virtual IP addresses for stable service endpoints

**How it works:**
When you create a Service, Kubernetes assigns it an IP from this range

**Default:**
172.30.0.0/16 (65,536 service IPs - far more than most clusters need)

**Network isolation:**
This is **purely internal** - service IPs never leave the cluster, only used for internal load balancing

**When to change:**
Only if this range conflicts with existing infrastructure networks

**Example:**
If datacenter uses 172.x.x.x, change to 10.96.0.0/12`}
                    required={isRequired("networking.serviceNetwork")}
                  >
                    <input
                      className={fieldErrors.serviceNetworkCidr ? "input-error" : ""}
                        title={fieldErrors.serviceNetworkCidr || ""}
                      value={localServiceNetworkCidr}
                      onChange={(e) => setLocalServiceNetworkCidr(e.target.value)}
                      onBlur={(e) => {
                        const formatted = formatIpv4Cidr(e.target.value.trim());
                        if (formatted !== networking.serviceNetworkCidr) {
                          updateNetworking({ serviceNetworkCidr: formatted });
                        }
                      }}
                      placeholder="172.30.0.0/16"
                      aria-required={isRequired("networking.serviceNetwork") ? "true" : "false"}
                      aria-invalid={fieldErrors.serviceNetworkCidr ? "true" : "false"}
                    />
                  </FieldLabelWithInfo>
                  {cidrOverlaps(networking.machineNetworkV4, networking.serviceNetworkCidr) ? (
                    <span className="note warning inline">Overlaps with machine network.</span>
                  ) : null}
                  {cidrOverlaps(networking.clusterNetworkCidr, networking.serviceNetworkCidr) ? (
                    <span className="note warning inline">Overlaps with cluster network.</span>
                  ) : null}
                </>
                )}
                {showIpv6ForPlatform && (
                  <FieldLabelWithInfo
                    label={ipStackMode === 'ipv6' ? "Service Network CIDR (optional)" : "Service Network IPv6 CIDR (optional)"}
                    hint={`IPv6 network range for Kubernetes ClusterIP services.

**Use case:**
Dual-stack or IPv6-only service networking

**Default behavior:**
If left blank, defaults to fd02::/112

**Example:**
fd02::/112`}
                  >
                    <input
                      className={fieldErrors.serviceNetworkCidrV6 ? "input-error" : ""}
                      title={fieldErrors.serviceNetworkCidrV6 || ""}
                      value={localServiceNetworkCidrV6}
                      onChange={(e) => setLocalServiceNetworkCidrV6(e.target.value)}
                      onBlur={(e) => {
                        const formatted = formatIpv6Cidr(e.target.value.trim()) || undefined;
                        if (formatted !== networking.serviceNetworkCidrV6) {
                          updateNetworking({ serviceNetworkCidrV6: formatted });
                        }
                      }}
                      placeholder="fd02::/112"
                      aria-required="false"
                      aria-invalid={fieldErrors.serviceNetworkCidrV6 ? "true" : "false"}
                    />
                  </FieldLabelWithInfo>
                )}
              </div>
            </div>
            ) : null}
          </div>
        </section>

        {showApiIngressVips ? (
          <section className="card">
            <div className="card-header">
              <div>
                <h3 className="card-title">API and Ingress VIPs</h3>
                <p className="card-subtitle">
                  {showNutanixIpiVips
                    ? "Virtual IPs for API and ingress (Nutanix IPI). Single-stack: platform.nutanix.apiVIP / ingressVIP. With IPv6 machine network and IPv6 VIP fields set, emitted as apiVIPs / ingressVIPs lists ordered IPv4 then IPv6 (per Nutanix install-config examples)."
                    : showVsphereIpiVips
                      ? "Virtual IPs for API and ingress (vSphere IPI). Leave blank if using an external load balancer."
                      : showVsphereAgentVips
                        ? "Virtual IPs for API and ingress (vSphere Agent-based). Required for multi-node when platform is vSphere; omitted when single-node (platform none). Same fields as bare metal agent—written to platform.vsphere.apiVIPs / ingressVIPs in install-config."
                        : "Virtual IPs for API and ingress traffic (bare metal)."}
                </p>
              </div>
            </div>
            <div className="card-body">
              {showNutanixIpiVips ? (
                <p className="note">
                  OpenShift 4.20 Nutanix IPI requires static API and Ingress VIPs on the installer-provisioned path (Installing on Nutanix §1.3.5.1). Match address family to your machine network; with dual-stack networking enabled below, set IPv6 VIPs to emit apiVIPs/ingressVIPs lists. NTP via DHCP is recommended for all nodes (§1.3.5).
                </p>
              ) : showVsphereIpiVips ? (
                <p className="note">Leave blank if you use an external load balancer.</p>
              ) : showVsphereAgentVips ? (
                <p className="note">
                  {vipsRequiredForBareMetalAgent
                    ? "Required for vSphere Agent-based multi-node (OpenShift 4.20 validation before agent ISO creation). One IP per field for single-stack; with IPv6 enabled, use separate IPv4 and IPv6 fields so install-config lists match machine networks in order."
                    : "Single-node OpenShift on vSphere Agent-based uses platform.none per the Agent guide; API/Ingress VIPs are not used. You can leave these blank."}
                </p>
              ) : scenarioId === "bare-metal-agent" ? (
                <p className="note">
                  {vipsRequiredForBareMetalAgent
                    ? showIpv6ForPlatform
                      ? "Required for Bare Metal Agent-based multi-node installs when using dual-stack (IPv4 + IPv6): use the separate IPv4 and IPv6 fields below—do not comma-separate in one box. Official 4.20 install-config guidance requires IPv4 entries before IPv6 in apiVIPs/ingressVIPs lists; this app emits that order."
                      : "Required for Bare Metal Agent-based multi-node installs (single-stack IPv4 in this flow): set API VIP and Ingress VIP."
                    : showIpv6ForPlatform
                      ? "Single-node (SNO) uses platform.none; API/Ingress VIPs are not used in install-config. Optional: you may still record VIPs here. With IPv6 enabled, use the IPv4 and IPv6 fields separately for dual-stack documentation alignment."
                      : "Single-node (SNO) uses platform.none; API/Ingress VIPs are not used in install-config. Optional: you may still record IPv4 VIPs here."}
                </p>
              ) : scenarioId === "bare-metal-ipi" ? (
                <p className="note">
                  {showIpv6ForPlatform
                    ? "Bare metal IPI: set API and Ingress VIPs, or leave blank if using an external load balancer. With IPv6 enabled, use the separate IPv4 and IPv6 fields (install-config apiVIPs/ingressVIPs list order is IPv4 then IPv6 per 4.20 docs)."
                    : "Bare metal IPI: set API VIP and Ingress VIP (IPv4), or leave blank if using an external load balancer."}
                </p>
              ) : (
                <p className="note">If using an external load balancer, leave API VIP and Ingress VIP blank.</p>
              )}
              <div className="vip-field-grid">
                {showNutanixIpiVips ? (
                  showIpv6ForPlatform ? (
                    <>
                      <div className="vip-group">
                        <h5 className="vip-group-header">API Virtual IP</h5>
                        <FieldLabelWithInfo
                          label="IPv4"
                          hint={metaNutanixApiVIP?.description || `Virtual IP address for the Kubernetes API server load balancer.

**What is this:**
The IP address that clients use to communicate with the cluster API (kubectl, oc, CI/CD)

**Requirements:**
• Must be an **unused IP** on the same network as cluster nodes
• Must **not be in DHCP range** - reserve it

**DNS requirement:**
api.<cluster-name>.<base-domain> → this VIP

**IPI vs UPI:**
• IPI: installer creates the load balancer automatically
• UPI: you must configure external load balancing

**Example:**
If machine network is 192.168.1.0/24, use 192.168.1.10`}
                          required={metaNutanixApiVIP?.required || isRequired("platform.nutanix.apiVIP")}
                        >
                          <input
                            className={fieldErrors.nutanixApiVIP ? "input-error" : ""}
                      title={fieldErrors.nutanixApiVIP || ""}
                            value={localNutanixApiVIP}
                            onChange={(e) => setLocalNutanixApiVIP(e.target.value)}
                            onBlur={(e) => {
                              const newValue = e.target.value.trim();
                              if (newValue !== platformConfig.nutanix?.apiVIP) {
                                updateNutanix({ apiVIP: newValue });
                              }
                            }}
                            placeholder={vipPlaceholders.apiVip}
                          />
                        </FieldLabelWithInfo>
                        {fieldErrors.nutanixApiVIP && <span className="note warning inline">{fieldErrors.nutanixApiVIP}</span>}
                        <FieldLabelWithInfo label="IPv6" hint={`Second API VIP for dual-stack (IPv4 + IPv6).

**When to set:**
Only for dual-stack deployments

**Generator behavior:**
When both IPv4 and IPv6 are set, emits apiVIPs list

**Example:**
fd00::5`}>
                          <input
                            className={fieldErrors.nutanixApiVIPV6 ? "input-error" : ""}
                      title={fieldErrors.nutanixApiVIPV6 || ""}
                            value={localNutanixApiVIPV6}
                            onChange={(e) => setLocalNutanixApiVIPV6(e.target.value)}
                            onBlur={(e) => {
                              const newValue = e.target.value.trim();
                              if (newValue !== platformConfig.nutanix?.apiVIPV6) {
                                updateNutanix({ apiVIPV6: newValue });
                              }
                            }}
                            placeholder={vipPlaceholdersV6.apiVipV6}
                          />
                        </FieldLabelWithInfo>
                        {fieldErrors.nutanixApiVIPV6 && <span className="note warning inline">{fieldErrors.nutanixApiVIPV6}</span>}
                      </div>
                      <div className="vip-group">
                        <h5 className="vip-group-header">Ingress Virtual IP</h5>
                        <FieldLabelWithInfo
                          label="IPv4"
                          hint={metaNutanixIngressVIP?.description || `Virtual IP address for the default ingress router load balancer (HAProxy).

**What is this:**
The IP address where external HTTP/HTTPS traffic enters the cluster to reach your applications

**Requirements:**
• Must be an **unused IP** on the same network as cluster nodes
• Must be **different from API VIP** (but on same network)
• Must **not be in DHCP range** - reserve it

**DNS requirement:**
*.apps.<cluster-name>.<base-domain> → this VIP (wildcard)

**IPI vs UPI:**
• IPI: installer creates the ingress load balancer automatically
• UPI: you must configure external load balancing

**Example:**
If machine network is 192.168.1.0/24, use 192.168.1.11`}
                          required={metaNutanixIngressVIP?.required || isRequired("platform.nutanix.ingressVIP")}
                        >
                          <input
                            className={fieldErrors.nutanixIngressVIP ? "input-error" : ""}
                      title={fieldErrors.nutanixIngressVIP || ""}
                            value={localNutanixIngressVIP}
                            onChange={(e) => setLocalNutanixIngressVIP(e.target.value)}
                            onBlur={(e) => {
                              const newValue = e.target.value.trim();
                              if (newValue !== platformConfig.nutanix?.ingressVIP) {
                                updateNutanix({ ingressVIP: newValue });
                              }
                            }}
                            placeholder={vipPlaceholders.ingressVip}
                          />
                        </FieldLabelWithInfo>
                        {fieldErrors.nutanixIngressVIP && <span className="note warning inline">{fieldErrors.nutanixIngressVIP}</span>}
                        <FieldLabelWithInfo label="IPv6" hint={`Second Ingress VIP for dual-stack (IPv4 + IPv6).

**When to set:**
Only for dual-stack deployments

**Generator behavior:**
When both IPv4 and IPv6 are set, emits ingressVIPs list

**Example:**
fd00::6`}>
                          <input
                            className={fieldErrors.nutanixIngressVIPV6 ? "input-error" : ""}
                      title={fieldErrors.nutanixIngressVIPV6 || ""}
                            value={localNutanixIngressVIPV6}
                            onChange={(e) => setLocalNutanixIngressVIPV6(e.target.value)}
                            onBlur={(e) => {
                              const newValue = e.target.value.trim();
                              if (newValue !== platformConfig.nutanix?.ingressVIPV6) {
                                updateNutanix({ ingressVIPV6: newValue });
                              }
                            }}
                            placeholder={vipPlaceholdersV6.ingressVipV6}
                          />
                        </FieldLabelWithInfo>
                        {fieldErrors.nutanixIngressVIPV6 && <span className="note warning inline">{fieldErrors.nutanixIngressVIPV6}</span>}
                      </div>
                    </>
                  ) : (
                    <>
                      <FieldLabelWithInfo
                        label="API VIP"
                        hint={metaNutanixApiVIP?.description || `Virtual IP address for the Kubernetes API server load balancer.

**Where this goes:**
platform.nutanix.apiVIP in install-config.yaml

**What is this:**
The IP address clients use to communicate with the cluster API

**See Also:**
Full details available in the dual-stack IPv4/IPv6 tooltips above`}
                        required={metaNutanixApiVIP?.required || isRequired("platform.nutanix.apiVIP")}
                      >
                        <input
                          className={fieldErrors.nutanixApiVIP ? "input-error" : ""}
                      title={fieldErrors.nutanixApiVIP || ""}
                          value={localNutanixApiVIP}
                          onChange={(e) => setLocalNutanixApiVIP(e.target.value)}
                          onBlur={(e) => {
                            const newValue = e.target.value.trim();
                            if (newValue !== platformConfig.nutanix?.apiVIP) {
                              updateNutanix({ apiVIP: newValue });
                            }
                          }}
                          placeholder={vipPlaceholders.apiVip}
                        />
                      </FieldLabelWithInfo>
                      {fieldErrors.nutanixApiVIP && <span className="note warning inline">{fieldErrors.nutanixApiVIP}</span>}
                      <FieldLabelWithInfo
                        label="Ingress VIP"
                        hint={metaNutanixIngressVIP?.description || `Virtual IP address for the default ingress router load balancer.

**Where this goes:**
platform.nutanix.ingressVIP in install-config.yaml

**What is this:**
The IP address where external HTTP/HTTPS traffic enters the cluster

**See Also:**
Full details available in the dual-stack IPv4/IPv6 tooltips above`}
                        required={metaNutanixIngressVIP?.required || isRequired("platform.nutanix.ingressVIP")}
                      >
                        <input
                          className={fieldErrors.nutanixIngressVIP ? "input-error" : ""}
                      title={fieldErrors.nutanixIngressVIP || ""}
                          value={localNutanixIngressVIP}
                          onChange={(e) => setLocalNutanixIngressVIP(e.target.value)}
                          onBlur={(e) => {
                            const newValue = e.target.value.trim();
                            if (newValue !== platformConfig.nutanix?.ingressVIP) {
                              updateNutanix({ ingressVIP: newValue });
                            }
                          }}
                          placeholder={vipPlaceholders.ingressVip}
                        />
                      </FieldLabelWithInfo>
                      {fieldErrors.nutanixIngressVIP && <span className="note warning inline">{fieldErrors.nutanixIngressVIP}</span>}
                    </>
                  )
                ) : showVsphereIpiVips ? (
                  showIpv6ForPlatform ? (
                    <>
                      <div className="vip-group">
                        <h5 className="vip-group-header">API Virtual IP</h5>
                        <FieldLabelWithInfo
                          label="IPv4"
                          hint={`API VIP for vSphere IPI (IPv4).

**When required:**
Required when **not using an external load balancer**

**Dual-stack:**
Set IPv6 below for dual-stack deployments

**Example:**
10.90.0.2`}
                        >
                          <input
                            className={fieldErrors.apiVip ? "input-error" : ""}
                            title={fieldErrors.apiVip || ""}
                            value={localVsphereApiVIPs}
                            onChange={(e) => setLocalVsphereApiVIPs(e.target.value)}
                            onBlur={(e) => {
                              const newArray = e.target.value.split(",").map((s) => s.trim()).filter(Boolean);
                              const currentArray = platformConfig.vsphere?.apiVIPs || [];
                              if (JSON.stringify(newArray) !== JSON.stringify(currentArray)) {
                                updateVsphere({ apiVIPs: newArray });
                              }
                            }}
                            placeholder={vipPlaceholders.apiVip}
                          />
                        </FieldLabelWithInfo>
                        <FieldLabelWithInfo
                          label="IPv6"
                          hint={`Second API VIP for dual-stack (IPv6).

**When to set:**
Only for dual-stack deployments (IPv4 + IPv6)

**Example:**
fd00::2`}
                        >
                          <input
                            value={localVsphereApiVIPs}
                            onChange={(e) => setLocalVsphereApiVIPs(e.target.value)}
                            placeholder={vipPlaceholdersV6.apiVipV6}
                          />
                        </FieldLabelWithInfo>
                      </div>
                      <div className="vip-group">
                        <h5 className="vip-group-header">Ingress Virtual IP</h5>
                        <FieldLabelWithInfo
                          label="IPv4"
                          hint={`Ingress VIP for vSphere IPI (IPv4).

**When required:**
Required when **not using an external load balancer**

**Dual-stack:**
Set IPv6 below for dual-stack deployments

**Example:**
10.90.0.3`}
                        >
                          <input
                            className={fieldErrors.ingressVip ? "input-error" : ""}
                            title={fieldErrors.ingressVip || ""}
                            value={localVsphereIngressVIPs}
                            onChange={(e) => setLocalVsphereIngressVIPs(e.target.value)}
                            onBlur={(e) => {
                              const newArray = e.target.value.split(",").map((s) => s.trim()).filter(Boolean);
                              const currentArray = platformConfig.vsphere?.ingressVIPs || [];
                              if (JSON.stringify(newArray) !== JSON.stringify(currentArray)) {
                                updateVsphere({ ingressVIPs: newArray });
                              }
                            }}
                            placeholder={vipPlaceholders.ingressVip}
                          />
                        </FieldLabelWithInfo>
                        <FieldLabelWithInfo
                          label="IPv6"
                          hint={`Second Ingress VIP for dual-stack (IPv6).

**When to set:**
Only for dual-stack deployments (IPv4 + IPv6)

**Example:**
fd00::3`}
                        >
                          <input
                            value={localVsphereIngressVIPs}
                            onChange={(e) => setLocalVsphereIngressVIPs(e.target.value)}
                            placeholder={vipPlaceholdersV6.ingressVipV6}
                          />
                        </FieldLabelWithInfo>
                      </div>
                    </>
                  ) : (
                    <>
                      <FieldLabelWithInfo
                        label="API VIPs (comma-separated)"
                        hint={`Virtual IP address(es) for the Kubernetes API load balancer.

**When required:**
Required for vSphere IPI when **not using an external load balancer**

**Format:**
Comma-separated if multiple (rare)

**Example:**
192.168.1.10`}
                      >
                        <input
                          className={fieldErrors.apiVip ? "input-error" : ""}
                          title={fieldErrors.apiVip || ""}
                          value={localVsphereApiVIPs}
                          onChange={(e) => setLocalVsphereApiVIPs(e.target.value)}
                          onBlur={(e) => {
                            const newArray = e.target.value.split(",").map((s) => s.trim()).filter(Boolean);
                            const currentArray = platformConfig.vsphere?.apiVIPs || [];
                            if (JSON.stringify(newArray) !== JSON.stringify(currentArray)) {
                              updateVsphere({ apiVIPs: newArray });
                            }
                          }}
                          placeholder={vipPlaceholders.apiVip}
                        />
                      </FieldLabelWithInfo>
                      <FieldLabelWithInfo
                        label="Ingress VIPs (comma-separated)"
                        hint={`Virtual IP address(es) for the default Ingress controller load balancer.

**When required:**
Required for vSphere IPI when **not using an external load balancer**

**Format:**
Comma-separated if multiple (rare)

**Example:**
192.168.1.11`}
                      >
                        <input
                          className={fieldErrors.ingressVip ? "input-error" : ""}
                          title={fieldErrors.ingressVip || ""}
                          value={localVsphereIngressVIPs}
                          onChange={(e) => setLocalVsphereIngressVIPs(e.target.value)}
                          onBlur={(e) => {
                            const newArray = e.target.value.split(",").map((s) => s.trim()).filter(Boolean);
                            const currentArray = platformConfig.vsphere?.ingressVIPs || [];
                            if (JSON.stringify(newArray) !== JSON.stringify(currentArray)) {
                              updateVsphere({ ingressVIPs: newArray });
                            }
                          }}
                          placeholder={vipPlaceholders.ingressVip}
                        />
                      </FieldLabelWithInfo>
                    </>
                  )
                ) : showVsphereAgentVips ? (
                  showIpv6ForPlatform ? (
                    <>
                      <div className="vip-group">
                        <h5 className="vip-group-header">API Virtual IP</h5>
                        <FieldLabelWithInfo
                          label="IPv4"
                          hint={`Primary API VIP for vSphere Agent-based (IPv4).

**Dual-stack:**
With dual-stack, set IPv6 below

**Generator behavior:**
Orders VIPs to match machine networks (IPv4 first, then IPv6)

**Example:**
10.90.0.1`}
                          required={vipsRequiredForBareMetalAgent && (metaApiVipsVsphere?.required || metaApiVip?.required)}
                        >
                          <input
                            className={fieldErrors.apiVip ? "input-error" : ""}
                      title={fieldErrors.apiVip || ""}
                            value={localApiVip}
                            onChange={(e) => setLocalApiVip(e.target.value)}
                            onBlur={(e) => {
                              const newValue = e.target.value.trim();
                              if (newValue !== hostInventory.apiVip) {
                                updateHostInventory({ apiVip: newValue });
                              }
                            }}
                            placeholder={vipPlaceholders.apiVip}
                          />
                        </FieldLabelWithInfo>
                        <FieldLabelWithInfo label="IPv6" hint={`Secondary API VIP for dual-stack (IPv6).

**When to set:**
Only for dual-stack deployments (IPv4 + IPv6)

**When to leave blank:**
IPv4-only clusters

**Example:**
fd00::1`}>
                          <input
                            className={fieldErrors.apiVipV6 ? "input-error" : ""}
                      title={fieldErrors.apiVipV6 || ""}
                            value={localApiVipV6}
                            onChange={(e) => setLocalApiVipV6(e.target.value)}
                            onBlur={(e) => {
                              const newValue = e.target.value.trim();
                              if (newValue !== (hostInventory.apiVipV6 ?? "")) {
                                updateHostInventory({ apiVipV6: newValue });
                              }
                            }}
                            placeholder={vipPlaceholdersV6.apiVipV6}
                          />
                        </FieldLabelWithInfo>
                      </div>
                      <div className="vip-group">
                        <h5 className="vip-group-header">Ingress Virtual IP</h5>
                        <FieldLabelWithInfo
                          label="IPv4"
                          hint={`Primary Ingress VIP for vSphere Agent-based (IPv4).

**What is this:**
Virtual IP address for the default ingress router load balancer

**Dual-stack:**
Set IPv6 below for dual-stack deployments

**Example:**
10.90.0.2`}
                          required={vipsRequiredForBareMetalAgent && (metaIngressVipsVsphere?.required || metaIngressVip?.required)}
                        >
                          <input
                            className={fieldErrors.ingressVip ? "input-error" : ""}
                      title={fieldErrors.ingressVip || ""}
                            value={localIngressVip}
                            onChange={(e) => setLocalIngressVip(e.target.value)}
                            onBlur={(e) => {
                              const newValue = e.target.value.trim();
                              if (newValue !== hostInventory.ingressVip) {
                                updateHostInventory({ ingressVip: newValue });
                              }
                            }}
                            placeholder={vipPlaceholders.ingressVip}
                          />
                        </FieldLabelWithInfo>
                        <FieldLabelWithInfo label="IPv6" hint={`Secondary Ingress VIP for dual-stack (IPv6).

**When to set:**
Only for dual-stack deployments (IPv4 + IPv6)

**When to leave blank:**
IPv4-only clusters

**Example:**
fd00::2`}>
                          <input
                            className={fieldErrors.ingressVipV6 ? "input-error" : ""}
                      title={fieldErrors.ingressVipV6 || ""}
                            value={localIngressVipV6}
                            onChange={(e) => setLocalIngressVipV6(e.target.value)}
                            onBlur={(e) => {
                              const newValue = e.target.value.trim();
                              if (newValue !== (hostInventory.ingressVipV6 ?? "")) {
                                updateHostInventory({ ingressVipV6: newValue });
                              }
                            }}
                            placeholder={vipPlaceholdersV6.ingressVipV6}
                          />
                        </FieldLabelWithInfo>
                      </div>
                    </>
                  ) : (
                    <>
                      <FieldLabelWithInfo
                        label="API VIPs"
                        hint={metaApiVipsVsphere?.description || "One IPv4 address for single-stack vSphere Agent-based (enable IPv6 above for dual-stack VIP fields)."}
                        required={vipsRequiredForBareMetalAgent && (metaApiVipsVsphere?.required || metaApiVip?.required)}
                      >
                        <input
                          className={fieldErrors.apiVip ? "input-error" : ""}
                      title={fieldErrors.apiVip || ""}
                          value={localApiVip}
                          onChange={(e) => setLocalApiVip(e.target.value)}
                          onBlur={(e) => {
                            const newValue = e.target.value.trim();
                            if (newValue !== hostInventory.apiVip) {
                              updateHostInventory({ apiVip: newValue });
                            }
                          }}
                          placeholder={vipPlaceholders.apiVip}
                        />
                      </FieldLabelWithInfo>
                      <FieldLabelWithInfo
                        label="Ingress VIPs"
                        hint={metaIngressVipsVsphere?.description || "One IPv4 address for single-stack. Enable IPv6 above for a separate IPv6 Ingress VIP field."}
                        required={vipsRequiredForBareMetalAgent && (metaIngressVipsVsphere?.required || metaIngressVip?.required)}
                      >
                        <input
                          className={fieldErrors.ingressVip ? "input-error" : ""}
                      title={fieldErrors.ingressVip || ""}
                          value={localIngressVip}
                          onChange={(e) => setLocalIngressVip(e.target.value)}
                          onBlur={(e) => {
                            const newValue = e.target.value.trim();
                            if (newValue !== hostInventory.ingressVip) {
                              updateHostInventory({ ingressVip: newValue });
                            }
                          }}
                          placeholder={vipPlaceholders.ingressVip}
                        />
                      </FieldLabelWithInfo>
                    </>
                  )
                ) : showBareMetalVips ? (
                  ipStackMode === 'dual-stack' ? (
                    <>
                      <div className="vip-group">
                        <h5 className="vip-group-header">API Virtual IP</h5>
                        <FieldLabelWithInfo
                          label="IPv4"
                          hint={`API VIP for IPv4 (bare metal Agent-based or IPI).

**Dual-stack:**
When dual-stack is enabled, add API VIP (IPv6) in the next field

**Generator behavior:**
Emitted apiVIPs order is IPv4 then IPv6 (4.20 doc alignment)

**Example:**
10.90.0.1`}
                          required={vipsRequiredForBareMetalAgent && (metaApiVips?.required || metaApiVip?.required)}
                        >
                        <input
                          className={fieldErrors.apiVip ? "input-error" : ""}
                      title={fieldErrors.apiVip || ""}
                          value={localApiVip}
                          onChange={(e) => setLocalApiVip(e.target.value)}
                          onBlur={(e) => {
                            const newValue = e.target.value.trim();
                            if (newValue !== hostInventory.apiVip) {
                              updateHostInventory({ apiVip: newValue });
                            }
                          }}
                          placeholder={vipPlaceholders.apiVip}
                        />
                      </FieldLabelWithInfo>
                      <FieldLabelWithInfo
                        label="IPv6"
                        hint={`Second API VIP for dual-stack (IPv6).

**When to set:**
Only for dual-stack (IPv4 + IPv6)

**When to leave blank:**
IPv4-only single-stack

**Important:**
IPv6-only bare metal is not verified in the reviewed 4.20 agent docs - use dual-stack or IPv4-only unless your own doc review confirms otherwise

**Example:**
fd00::1`}
                      >
                        <input
                          className={fieldErrors.apiVipV6 ? "input-error" : ""}
                      title={fieldErrors.apiVipV6 || ""}
                          value={localApiVipV6}
                          onChange={(e) => setLocalApiVipV6(e.target.value)}
                          onBlur={(e) => {
                            const newValue = e.target.value.trim();
                            if (newValue !== (hostInventory.apiVipV6 ?? "")) {
                              updateHostInventory({ apiVipV6: newValue });
                            }
                          }}
                          placeholder={vipPlaceholdersV6.apiVipV6}
                        />
                      </FieldLabelWithInfo>
                    </div>
                    <div className="vip-group">
                      <h5 className="vip-group-header">Ingress Virtual IP</h5>
                      <FieldLabelWithInfo
                        label="IPv4"
                        hint={`Ingress VIP for IPv4 (bare metal Agent-based or IPI).

**Dual-stack:**
When dual-stack is enabled, set Ingress VIP (IPv6) below

**Generator behavior:**
Emitted ingressVIPs order is IPv4 then IPv6

**Example:**
10.90.0.2`}
                        required={vipsRequiredForBareMetalAgent && (metaIngressVips?.required || metaIngressVip?.required)}
                      >
                        <input
                          className={fieldErrors.ingressVip ? "input-error" : ""}
                      title={fieldErrors.ingressVip || ""}
                          value={localIngressVip}
                          onChange={(e) => setLocalIngressVip(e.target.value)}
                          onBlur={(e) => {
                            const newValue = e.target.value.trim();
                            if (newValue !== hostInventory.ingressVip) {
                              updateHostInventory({ ingressVip: newValue });
                            }
                          }}
                          placeholder={vipPlaceholders.ingressVip}
                        />
                      </FieldLabelWithInfo>
                      <FieldLabelWithInfo
                        label="IPv6"
                        hint={`Second Ingress VIP for dual-stack (IPv6).

**When to set:**
Only for dual-stack (IPv4 + IPv6)

**When to leave blank:**
IPv4-only single-stack

**Example:**
fd00::2`}
                      >
                        <input
                          className={fieldErrors.ingressVipV6 ? "input-error" : ""}
                      title={fieldErrors.ingressVipV6 || ""}
                          value={localIngressVipV6}
                          onChange={(e) => setLocalIngressVipV6(e.target.value)}
                          onBlur={(e) => {
                            const newValue = e.target.value.trim();
                            if (newValue !== (hostInventory.ingressVipV6 ?? "")) {
                              updateHostInventory({ ingressVipV6: newValue });
                            }
                          }}
                          placeholder={vipPlaceholdersV6.ingressVipV6}
                        />
                      </FieldLabelWithInfo>
                    </div>
                    </>
                  ) : ipStackMode === 'ipv6' ? (
                    <>
                      <FieldLabelWithInfo
                        label="API VIP"
                        hint={`Virtual IP address for the Kubernetes API server load balancer (IPv6-only).

**What is this:**
The IPv6 address clients use to communicate with the cluster API

**Format:**
Single IPv6 address

**Example:**
fd00::1`}
                        required={vipsRequiredForBareMetalAgent && (metaApiVips?.required || metaApiVip?.required)}
                      >
                        <input
                          className={fieldErrors.apiVipV6 ? "input-error" : ""}
                          title={fieldErrors.apiVipV6 || ""}
                          value={localApiVipV6}
                          onChange={(e) => setLocalApiVipV6(e.target.value)}
                          onBlur={(e) => {
                            const newValue = e.target.value.trim();
                            if (newValue !== (hostInventory.apiVipV6 ?? "")) {
                              updateHostInventory({ apiVipV6: newValue });
                            }
                          }}
                          placeholder={vipPlaceholdersV6.apiVipV6}
                        />
                      </FieldLabelWithInfo>
                      <FieldLabelWithInfo
                        label="Ingress VIP"
                        hint={`Virtual IP address for the default ingress router load balancer (IPv6-only).

**What is this:**
The IPv6 address where external HTTP/HTTPS traffic enters the cluster

**Format:**
Single IPv6 address

**Example:**
fd00::2`}
                        required={vipsRequiredForBareMetalAgent && (metaIngressVips?.required || metaIngressVip?.required)}
                      >
                        <input
                          className={fieldErrors.ingressVipV6 ? "input-error" : ""}
                          title={fieldErrors.ingressVipV6 || ""}
                          value={localIngressVipV6}
                          onChange={(e) => setLocalIngressVipV6(e.target.value)}
                          onBlur={(e) => {
                            const newValue = e.target.value.trim();
                            if (newValue !== (hostInventory.ingressVipV6 ?? "")) {
                              updateHostInventory({ ingressVipV6: newValue });
                            }
                          }}
                          placeholder={vipPlaceholdersV6.ingressVipV6}
                        />
                      </FieldLabelWithInfo>
                    </>
                  ) : (
                    <>
                      <FieldLabelWithInfo
                        label="API VIP"
                        hint={`Virtual IP address for the Kubernetes API server load balancer.

**What is this:**
The IP address clients use to communicate with the cluster API

**Format:**
Single IPv4 address (not comma-separated)

**Example:**
10.90.0.1`}
                        required={vipsRequiredForBareMetalAgent && (metaApiVips?.required || metaApiVip?.required)}
                      >
                        <input
                          className={fieldErrors.apiVip ? "input-error" : ""}
                      title={fieldErrors.apiVip || ""}
                          value={localApiVip}
                          onChange={(e) => setLocalApiVip(e.target.value)}
                          onBlur={(e) => {
                            const newValue = e.target.value.trim();
                            if (newValue !== hostInventory.apiVip) {
                              updateHostInventory({ apiVip: newValue });
                            }
                          }}
                          placeholder={vipPlaceholders.apiVip}
                        />
                      </FieldLabelWithInfo>
                      <FieldLabelWithInfo
                        label="Ingress VIP"
                        hint={`Virtual IP address for the default ingress router load balancer.

**What is this:**
The IP address where external HTTP/HTTPS traffic enters the cluster

**Format:**
Single IPv4 address (not comma-separated)

**Example:**
10.90.0.2`}
                        required={vipsRequiredForBareMetalAgent && (metaIngressVips?.required || metaIngressVip?.required)}
                      >
                        <input
                          className={fieldErrors.ingressVip ? "input-error" : ""}
                      title={fieldErrors.ingressVip || ""}
                          value={localIngressVip}
                          onChange={(e) => setLocalIngressVip(e.target.value)}
                          onBlur={(e) => {
                            const newValue = e.target.value.trim();
                            if (newValue !== hostInventory.ingressVip) {
                              updateHostInventory({ ingressVip: newValue });
                            }
                          }}
                          placeholder={vipPlaceholders.ingressVip}
                        />
                      </FieldLabelWithInfo>
                    </>
                  )
                ) : null}
              </div>
            </div>
          </section>
        ) : null}
      </div>
    </div>
  );
}
