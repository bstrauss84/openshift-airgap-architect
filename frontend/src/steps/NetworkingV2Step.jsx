/**
 * Networking replacement step (segmented flow). Network type, machine/cluster/service CIDRs, optional API/Ingress VIPs and OVN internal join subnet.
 * Grouped: cluster-level, machine network, service network, advanced (OVN). IPv6 toggle; red only on cards with actual errors.
 */
import React, { useState } from "react";
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

  const requiredPaths = getRequiredParamsForOutput(scenarioId, INSTALL_CONFIG) || [];
  const isRequired = (path) => requiredPaths.includes(path);
  const nodes = hostInventory.nodes || [];
  const masterCount = nodes.filter((n) => n.role === "master").length;
  const workerCount = nodes.filter((n) => n.role === "worker").length;
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
  const enableIpv6 = Boolean(hostInventory.enableIpv6);
  const isAwsGovCloud = scenarioId === "aws-govcloud-ipi" || scenarioId === "aws-govcloud-upi";
  /** AWS install-config supports IPv4 only (4.20); dual-stack is not available for this platform. */
  const showIpv6ForPlatform = enableIpv6 && !isAwsGovCloud;

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
            {isAwsGovCloud ? (
              <p className="note" style={{ marginTop: 0, marginBottom: 8 }}>
                AWS install-config supports IPv4 only (OpenShift 4.20). Dual-stack and IPv6 are not available for this platform.
              </p>
            ) : (
              <>
                <OptionRow
                  title="Enable IPv6 (cluster-wide)"
                  description="Show IPv6 machine and optional cluster/service fields for dual-stack."
                >
                  <Switch
                    checked={enableIpv6}
                    onChange={(checked) => updateHostInventory({ enableIpv6: checked })}
                    aria-label="Enable IPv6"
                  />
                </OptionRow>
                {enableIpv6 ? (
                  <p className="note" style={{ marginTop: 8, marginBottom: 0 }}>
                    When IPv6 is enabled, IPv6 fields for machine, cluster, and service networks appear together. OpenShift 4.20 documents IPv4, IPv6, and dual-stack install-config styles for several on-prem platforms (e.g. Agent-based on vSphere/bare metal); Nutanix IPI supports dual-stack networking and VIP lists when you set an IPv6 machine CIDR and IPv6 API/Ingress VIPs (see Installing on Nutanix and installation-config-parameters-nutanix). Defaults apply for optional IPv6 CIDRs when left blank. Machine CIDRs are used for node and VIP validation.
                  </p>
                ) : null}
              </>
            )}

            {showMachineNetwork ? (
            <div className="networking-group">
              <h4 className="networking-group-title">Machine network</h4>
              <div className="field-grid">
                <FieldLabelWithInfo
                  label="Machine Network (IPv4 CIDR)"
                  hint="Node IPs; most installs only customize this."
                  required={isRequired("networking.machineNetwork[].cidr")}
                  className={fieldErrors.machineNetworkV4 ? "input-error" : ""}
                >
                  <input
                    className={fieldErrors.machineNetworkV4 ? "input-error" : ""}
                    value={networking.machineNetworkV4 || ""}
                    onChange={(e) => updateNetworking({ machineNetworkV4: formatIpv4Cidr(e.target.value) })}
                    placeholder="10.90.0.0/24"
                  />
                </FieldLabelWithInfo>
                {cidrOverlaps(networking.machineNetworkV4, networking.clusterNetworkCidr) ? (
                  <span className="note warning inline">Overlaps with cluster network.</span>
                ) : null}
                {cidrOverlaps(networking.machineNetworkV4, networking.serviceNetworkCidr) ? (
                  <span className="note warning inline">Overlaps with service network.</span>
                ) : null}
                {showIpv6ForPlatform ? (
                  <FieldLabelWithInfo
                    label="Machine Network (IPv6 CIDR)"
                    hint="Only for dual-stack."
                    className={fieldErrors.machineNetworkV6 ? "input-error" : ""}
                  >
                    <input
                      className={fieldErrors.machineNetworkV6 ? "input-error" : ""}
                      value={networking.machineNetworkV6 || ""}
                      onChange={(e) =>
                        updateNetworking({ machineNetworkV6: formatIpv6Cidr(e.target.value) })
                      }
                      placeholder="fd10:90::/64"
                    />
                  </FieldLabelWithInfo>
                ) : null}
              </div>
            </div>
            ) : null}

            {showClusterNetwork ? (
            <div className="networking-group">
              <h4 className="networking-group-title">Cluster-level</h4>
              <div className="field-grid">
                <FieldLabelWithInfo
                  label="Cluster Network CIDR"
                  hint="Pod network; usually keep default."
                  required={isRequired("networking.clusterNetwork[].cidr")}
                  className={fieldErrors.clusterNetworkCidr ? "input-error" : ""}
                >
                  <input
                    className={fieldErrors.clusterNetworkCidr ? "input-error" : ""}
                    value={networking.clusterNetworkCidr || ""}
                    onChange={(e) => updateNetworking({ clusterNetworkCidr: formatIpv4Cidr(e.target.value) })}
                    placeholder="10.128.0.0/14"
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
                  hint="Per-node pod CIDR size."
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
                {showIpv6ForPlatform ? (
                  <>
                    <FieldLabelWithInfo
                      label="Cluster Network IPv6 CIDR (optional)"
                      hint="Pod network IPv6 (dual-stack or IPv6 data plane). Default fd01::/48 if blank."
                      className={fieldErrors.clusterNetworkCidrV6 ? "input-error" : ""}
                    >
                      <input
                        className={fieldErrors.clusterNetworkCidrV6 ? "input-error" : ""}
                        value={networking.clusterNetworkCidrV6 || ""}
                        onChange={(e) =>
                          updateNetworking({ clusterNetworkCidrV6: formatIpv6Cidr(e.target.value) || undefined })
                        }
                        placeholder="fd01::/48"
                      />
                    </FieldLabelWithInfo>
                    <FieldLabelWithInfo label="Cluster Network IPv6 Host Prefix (optional)">
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
                ) : null}
              </div>
            </div>
            ) : null}

            {showServiceNetwork ? (
            <div className="networking-group">
              <h4 className="networking-group-title">Service network</h4>
              <div className="field-grid">
                <FieldLabelWithInfo
                  label="Service Network CIDR"
                  hint="ClusterIP range; usually keep default."
                  required={isRequired("networking.serviceNetwork")}
                  className={fieldErrors.serviceNetworkCidr ? "input-error" : ""}
                >
                  <input
                    className={fieldErrors.serviceNetworkCidr ? "input-error" : ""}
                    value={networking.serviceNetworkCidr || ""}
                    onChange={(e) => updateNetworking({ serviceNetworkCidr: formatIpv4Cidr(e.target.value) })}
                    placeholder="172.30.0.0/16"
                  />
                </FieldLabelWithInfo>
                {cidrOverlaps(networking.machineNetworkV4, networking.serviceNetworkCidr) ? (
                  <span className="note warning inline">Overlaps with machine network.</span>
                ) : null}
                {cidrOverlaps(networking.clusterNetworkCidr, networking.serviceNetworkCidr) ? (
                  <span className="note warning inline">Overlaps with cluster network.</span>
                ) : null}
                {showIpv6ForPlatform ? (
                  <FieldLabelWithInfo
                    label="Service Network IPv6 CIDR (optional)"
                    hint="Service (ClusterIP) IPv6. Default fd02::/112 if blank."
                    className={fieldErrors.serviceNetworkCidrV6 ? "input-error" : ""}
                  >
                    <input
                      className={fieldErrors.serviceNetworkCidrV6 ? "input-error" : ""}
                      value={networking.serviceNetworkCidrV6 || ""}
                      onChange={(e) =>
                        updateNetworking({ serviceNetworkCidrV6: formatIpv6Cidr(e.target.value) || undefined })
                      }
                      placeholder="fd02::/112"
                    />
                  </FieldLabelWithInfo>
                ) : null}
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
                      ? "Required for Bare Metal Agent-based multi-node installs. Use separate IPv4 and IPv6 fields below for dual-stack; the generator orders VIPs to match machine networks."
                      : "Required for Bare Metal Agent-based multi-node installs. IPv4-only: one IP per field. If IPv6 is disabled here but you use dual-stack, enable “Enable IPv6 (cluster-wide)” above for split VIP fields."
                    : "Single-node (SNO) uses platform.none; API/Ingress VIPs are not used. Optional to leave blank."}
                </p>
              ) : (
                <p className="note">If using an external load balancer, leave API VIP and Ingress VIP blank.</p>
              )}
              <div className="field-grid">
                {showNutanixIpiVips ? (
                  showIpv6ForPlatform ? (
                    <>
                      <FieldLabelWithInfo
                        label="API VIP (IPv4)"
                        hint={metaNutanixApiVIP?.description || "Primary API VIP; required with IPv4 machine network."}
                        required={metaNutanixApiVIP?.required || isRequired("platform.nutanix.apiVIP")}
                      >
                        <input
                          className={fieldErrors.nutanixApiVIP ? "input-error" : ""}
                          value={platformConfig.nutanix?.apiVIP || ""}
                          onChange={(e) => updateNutanix({ apiVIP: e.target.value })}
                          placeholder="e.g. 10.0.0.5"
                        />
                      </FieldLabelWithInfo>
                      <FieldLabelWithInfo label="API VIP (IPv6)" hint="Second API VIP for dual-stack; generator emits apiVIPs when set.">
                        <input
                          className={fieldErrors.nutanixApiVIPV6 ? "input-error" : ""}
                          value={platformConfig.nutanix?.apiVIPV6 || ""}
                          onChange={(e) => updateNutanix({ apiVIPV6: e.target.value })}
                          placeholder="e.g. fd00::5"
                        />
                      </FieldLabelWithInfo>
                      <FieldLabelWithInfo
                        label="Ingress VIP (IPv4)"
                        hint={metaNutanixIngressVIP?.description || "Primary Ingress VIP."}
                        required={metaNutanixIngressVIP?.required || isRequired("platform.nutanix.ingressVIP")}
                      >
                        <input
                          className={fieldErrors.nutanixIngressVIP ? "input-error" : ""}
                          value={platformConfig.nutanix?.ingressVIP || ""}
                          onChange={(e) => updateNutanix({ ingressVIP: e.target.value })}
                          placeholder="e.g. 10.0.0.6"
                        />
                      </FieldLabelWithInfo>
                      <FieldLabelWithInfo label="Ingress VIP (IPv6)" hint="Second Ingress VIP for dual-stack; generator emits ingressVIPs when set.">
                        <input
                          className={fieldErrors.nutanixIngressVIPV6 ? "input-error" : ""}
                          value={platformConfig.nutanix?.ingressVIPV6 || ""}
                          onChange={(e) => updateNutanix({ ingressVIPV6: e.target.value })}
                          placeholder="e.g. fd00::6"
                        />
                      </FieldLabelWithInfo>
                    </>
                  ) : (
                    <>
                      <FieldLabelWithInfo
                        label="API VIP"
                        hint={metaNutanixApiVIP?.description || "platform.nutanix.apiVIP"}
                        required={metaNutanixApiVIP?.required || isRequired("platform.nutanix.apiVIP")}
                      >
                        <input
                          className={fieldErrors.nutanixApiVIP ? "input-error" : ""}
                          value={platformConfig.nutanix?.apiVIP || ""}
                          onChange={(e) => updateNutanix({ apiVIP: e.target.value })}
                          placeholder="e.g. 10.0.0.5"
                        />
                      </FieldLabelWithInfo>
                      <FieldLabelWithInfo
                        label="Ingress VIP"
                        hint={metaNutanixIngressVIP?.description || "platform.nutanix.ingressVIP"}
                        required={metaNutanixIngressVIP?.required || isRequired("platform.nutanix.ingressVIP")}
                      >
                        <input
                          className={fieldErrors.nutanixIngressVIP ? "input-error" : ""}
                          value={platformConfig.nutanix?.ingressVIP || ""}
                          onChange={(e) => updateNutanix({ ingressVIP: e.target.value })}
                          placeholder="e.g. 10.0.0.6"
                        />
                      </FieldLabelWithInfo>
                    </>
                  )
                ) : showVsphereIpiVips ? (
                  <>
                    <FieldLabelWithInfo
                      label="API VIPs (comma-separated)"
                      hint="Virtual IP(s) for the Kubernetes API. Required for vSphere IPI when not using an external load balancer."
                    >
                      <input
                        value={Array.isArray(platformConfig.vsphere?.apiVIPs) ? platformConfig.vsphere.apiVIPs.join(", ") : ""}
                        onChange={(e) => updateVsphere({ apiVIPs: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })}
                        placeholder="e.g. 192.168.1.10"
                      />
                    </FieldLabelWithInfo>
                    <FieldLabelWithInfo
                      label="Ingress VIPs (comma-separated)"
                      hint="Virtual IP(s) for the default Ingress controller. Required for vSphere IPI when not using an external load balancer."
                    >
                      <input
                        value={Array.isArray(platformConfig.vsphere?.ingressVIPs) ? platformConfig.vsphere.ingressVIPs.join(", ") : ""}
                        onChange={(e) => updateVsphere({ ingressVIPs: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })}
                        placeholder="e.g. 192.168.1.11"
                      />
                    </FieldLabelWithInfo>
                  </>
                ) : showVsphereAgentVips ? (
                  showIpv6ForPlatform ? (
                    <>
                      <FieldLabelWithInfo
                        label="API VIP (IPv4)"
                        hint="Primary API VIP for vSphere Agent-based. With dual-stack, set IPv6 below; generator orders VIPs to match machine networks."
                        required={vipsRequiredForBareMetalAgent && (metaApiVipsVsphere?.required || metaApiVip?.required)}
                      >
                        <input
                          className={fieldErrors.apiVip ? "input-error" : ""}
                          value={hostInventory.apiVip || ""}
                          onChange={(e) => updateHostInventory({ apiVip: e.target.value })}
                          placeholder="e.g. 10.90.0.1"
                        />
                      </FieldLabelWithInfo>
                      <FieldLabelWithInfo label="API VIP (IPv6)" hint="Secondary API VIP for dual-stack. Leave blank for IPv4-only.">
                        <input
                          className={fieldErrors.apiVipV6 ? "input-error" : ""}
                          value={hostInventory.apiVipV6 ?? ""}
                          onChange={(e) => updateHostInventory({ apiVipV6: e.target.value })}
                          placeholder="e.g. fd00::1"
                        />
                      </FieldLabelWithInfo>
                      <FieldLabelWithInfo
                        label="Ingress VIP (IPv4)"
                        hint="Primary Ingress VIP."
                        required={vipsRequiredForBareMetalAgent && (metaIngressVipsVsphere?.required || metaIngressVip?.required)}
                      >
                        <input
                          className={fieldErrors.ingressVip ? "input-error" : ""}
                          value={hostInventory.ingressVip || ""}
                          onChange={(e) => updateHostInventory({ ingressVip: e.target.value })}
                          placeholder="e.g. 10.90.0.2"
                        />
                      </FieldLabelWithInfo>
                      <FieldLabelWithInfo label="Ingress VIP (IPv6)" hint="Secondary Ingress VIP for dual-stack. Leave blank for IPv4-only.">
                        <input
                          className={fieldErrors.ingressVipV6 ? "input-error" : ""}
                          value={hostInventory.ingressVipV6 ?? ""}
                          onChange={(e) => updateHostInventory({ ingressVipV6: e.target.value })}
                          placeholder="e.g. fd00::2"
                        />
                      </FieldLabelWithInfo>
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
                          value={hostInventory.apiVip || ""}
                          onChange={(e) => updateHostInventory({ apiVip: e.target.value })}
                          placeholder="e.g. 10.90.0.1"
                        />
                      </FieldLabelWithInfo>
                      <FieldLabelWithInfo
                        label="Ingress VIPs"
                        hint={metaIngressVipsVsphere?.description || "One IPv4 address for single-stack. Enable IPv6 above for a separate IPv6 Ingress VIP field."}
                        required={vipsRequiredForBareMetalAgent && (metaIngressVipsVsphere?.required || metaIngressVip?.required)}
                      >
                        <input
                          className={fieldErrors.ingressVip ? "input-error" : ""}
                          value={hostInventory.ingressVip || ""}
                          onChange={(e) => updateHostInventory({ ingressVip: e.target.value })}
                          placeholder="e.g. 10.90.0.2"
                        />
                      </FieldLabelWithInfo>
                    </>
                  )
                ) : showBareMetalVips ? (
                  showIpv6ForPlatform ? (
                    <>
                      <FieldLabelWithInfo
                        label="API VIP (IPv4)"
                        hint="Primary API VIP. For dual-stack, also set API VIP (IPv6) below; order in install-config is IPv4 then IPv6."
                        required={vipsRequiredForBareMetalAgent && (metaApiVips?.required || metaApiVip?.required)}
                      >
                        <input
                          className={fieldErrors.apiVip ? "input-error" : ""}
                          value={hostInventory.apiVip || ""}
                          onChange={(e) => updateHostInventory({ apiVip: e.target.value })}
                          placeholder="e.g. 10.90.0.1"
                        />
                      </FieldLabelWithInfo>
                      <FieldLabelWithInfo
                        label="API VIP (IPv6)"
                        hint="Secondary API VIP for dual-stack. Leave blank for IPv4-only."
                      >
                        <input
                          className={fieldErrors.apiVipV6 ? "input-error" : ""}
                          value={hostInventory.apiVipV6 ?? ""}
                          onChange={(e) => updateHostInventory({ apiVipV6: e.target.value })}
                          placeholder="e.g. fd00::1"
                        />
                      </FieldLabelWithInfo>
                      <FieldLabelWithInfo
                        label="Ingress VIP (IPv4)"
                        hint="Primary Ingress VIP. For dual-stack, also set Ingress VIP (IPv6) below."
                        required={vipsRequiredForBareMetalAgent && (metaIngressVips?.required || metaIngressVip?.required)}
                      >
                        <input
                          className={fieldErrors.ingressVip ? "input-error" : ""}
                          value={hostInventory.ingressVip || ""}
                          onChange={(e) => updateHostInventory({ ingressVip: e.target.value })}
                          placeholder="e.g. 10.90.0.2"
                        />
                      </FieldLabelWithInfo>
                      <FieldLabelWithInfo
                        label="Ingress VIP (IPv6)"
                        hint="Secondary Ingress VIP for dual-stack. Leave blank for IPv4-only."
                      >
                        <input
                          className={fieldErrors.ingressVipV6 ? "input-error" : ""}
                          value={hostInventory.ingressVipV6 ?? ""}
                          onChange={(e) => updateHostInventory({ ingressVipV6: e.target.value })}
                          placeholder="e.g. fd00::2"
                        />
                      </FieldLabelWithInfo>
                    </>
                  ) : (
                    <>
                      <FieldLabelWithInfo
                        label="API VIPs"
                        hint={metaApiVips?.description || metaApiVip?.description || "One IP = single-stack. Two comma-separated IPs = dual-stack (order: primary, then secondary). Omit when using a user-managed load balancer."}
                        required={vipsRequiredForBareMetalAgent && (metaApiVips?.required || metaApiVip?.required)}
                      >
                        <input
                          className={fieldErrors.apiVip ? "input-error" : ""}
                          value={hostInventory.apiVip || ""}
                          onChange={(e) => updateHostInventory({ apiVip: e.target.value })}
                          placeholder="e.g. 10.90.0.1 or 10.90.0.1,fd00::1 for dual-stack"
                        />
                      </FieldLabelWithInfo>
                      <FieldLabelWithInfo
                        label="Ingress VIPs"
                        hint={metaIngressVips?.description || metaIngressVip?.description || "One IP = single-stack. Two comma-separated IPs = dual-stack (order: primary, then secondary). Omit when using a user-managed load balancer."}
                        required={vipsRequiredForBareMetalAgent && (metaIngressVips?.required || metaIngressVip?.required)}
                      >
                        <input
                          className={fieldErrors.ingressVip ? "input-error" : ""}
                          value={hostInventory.ingressVip || ""}
                          onChange={(e) => updateHostInventory({ ingressVip: e.target.value })}
                          placeholder="e.g. 10.90.0.2 or 10.90.0.2,fd00::2 for dual-stack"
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
