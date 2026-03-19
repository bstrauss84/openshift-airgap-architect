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

  const requiredPaths = getRequiredParamsForOutput(scenarioId, INSTALL_CONFIG) || [];
  const isRequired = (path) => requiredPaths.includes(path);
  const nodes = hostInventory.nodes || [];
  const masterCount = nodes.filter((n) => n.role === "master").length;
  const workerCount = nodes.filter((n) => n.role === "worker").length;
  const isAgentSno = scenarioId === "bare-metal-agent" && masterCount === 1 && workerCount === 0;
  const vipsRequiredForBareMetalAgent = !isAgentSno;

  const metaApiVip = getParamMeta(scenarioId, "platform.baremetal.apiVIP", INSTALL_CONFIG);
  const metaIngressVip = getParamMeta(scenarioId, "platform.baremetal.ingressVIP", INSTALL_CONFIG);
  const metaApiVips = getParamMeta(scenarioId, "platform.baremetal.apiVIPs", INSTALL_CONFIG);
  const metaIngressVips = getParamMeta(scenarioId, "platform.baremetal.ingressVIPs", INSTALL_CONFIG);

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
  const showBareMetalVips = scenarioId === "bare-metal-agent" || scenarioId === "bare-metal-ipi";
const showVsphereIpiVips = scenarioId === "vsphere-ipi";
    const showApiIngressVips = showBareMetalVips || showVsphereIpiVips;
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
                    For dual-stack, IPv6 machine network follows IPv4. Machine network is used for node IP validation.
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
                      hint="Dual-stack pod IPv6. Default fd01::/48 if blank. Set when using dual-stack."
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
                    hint="Dual-stack service IPv6. Default fd02::/112 if blank. Set when using dual-stack."
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
                  {showVsphereIpiVips ? "Virtual IPs for API and ingress (vSphere IPI). Leave blank if using an external load balancer." : "Virtual IPs for API and ingress traffic (bare metal)."}
                </p>
              </div>
            </div>
            <div className="card-body">
              {showVsphereIpiVips ? (
                <p className="note">Leave blank if you use an external load balancer.</p>
              ) : scenarioId === "bare-metal-agent" ? (
                <p className="note">
                  {vipsRequiredForBareMetalAgent
                    ? showIpv6ForPlatform
                      ? "Required for Bare Metal Agent-based multi-node installs. Set API VIP (IPv4 and IPv6) and Ingress VIP (IPv4 and IPv6)."
                      : "Required for Bare Metal Agent-based multi-node installs. Set API VIP (IPv4) and Ingress VIP (IPv4)."
                      : showIpv6ForPlatform
                        ? "Single-node (SNO) uses platform.none; API/Ingress VIPs are not used. Optional to leave blank. Set API VIP (IPv4 and IPv6) and Ingress VIP (IPv4 and IPv6) if you set them."
                        : "Single-node (SNO) uses platform.none; API/Ingress VIPs are not used. Optional to leave blank. Set API VIP (IPv4) and Ingress VIP (IPv4) if you set them."}
                </p>
              ) : (
                <p className="note">If using an external load balancer, leave API VIP and Ingress VIP blank.</p>
              )}
              <div className="field-grid">
                {showVsphereIpiVips ? (
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
                        label="API VIP (IPv4)"
                        hint="Primary API VIP (IPv4)."
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
                        label="Ingress VIP (IPv4)"
                        hint="Primary Ingress VIP (IPv4)."
                        required={vipsRequiredForBareMetalAgent && (metaIngressVips?.required || metaIngressVip?.required)}
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
                ) : null}
              </div>
            </div>
          </section>
        ) : null}
      </div>
    </div>
  );
}
