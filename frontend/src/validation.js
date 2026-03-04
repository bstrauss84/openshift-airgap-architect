/**
 * Step and field validation for both legacy and segmented flows.
 * Validates Blueprint, credentials, networking (format + overlaps), trust/proxy, platform config, and host inventory.
 * validateStep(state, stepId) is the main entry; stepId matches App.jsx (e.g. identity-access, networking-v2, platform-specifics).
 */

import { getTrustBundlePolicies } from "./shared/versionPolicy.js";
import { getScenarioId } from "./hostInventoryV2Helpers.js";
import { getRequiredParamsForOutput } from "./catalogResolver.js";
import { getCatalogValidationForInventoryV2 } from "./hostInventoryV2Validation.js";
import { normalizeMAC } from "./formatUtils.js";

const isValidIpv4 = (value) => {
  const parts = value.split(".");
  if (parts.length !== 4) return false;
  return parts.every((part) => {
    if (!/^\d+$/.test(part)) return false;
    const num = Number(part);
    return num >= 0 && num <= 255;
  });
};

const isValidIpv4Cidr = (value) => {
  if (!value || !value.includes("/")) return false;
  const [ip, prefix] = value.split("/");
  if (!isValidIpv4(ip)) return false;
  const bits = Number(prefix);
  return !Number.isNaN(bits) && bits >= 0 && bits <= 32;
};

const isValidIpv6Cidr = (value) => {
  if (!value || !value.includes("/")) return false;
  const [ip, prefix] = value.split("/");
  if (!ip.includes(":")) return false;
  const bits = Number(prefix);
  return !Number.isNaN(bits) && bits >= 0 && bits <= 128;
};

const isValidMac = (value) => {
  const normalized = normalizeMAC(value || "");
  return normalized.length === 17 && /^([0-9a-f]{2}:){5}[0-9a-f]{2}$/.test(normalized);
};

const isValidSshPublicKey = (value) => {
  if (!value) return false;
  const trimmed = value.trim();
  const parts = trimmed.split(/\s+/);
  if (parts.length < 2) return false;
  const type = parts[0];
  const allowed = [
    "ssh-rsa",
    "ssh-ed25519",
    "ecdsa-sha2-nistp256",
    "ecdsa-sha2-nistp384",
    "ecdsa-sha2-nistp521"
  ];
  if (!allowed.includes(type)) return false;
  return /^[A-Za-z0-9+/=]+$/.test(parts[1]);
};

const isValidPullSecret = (value) => {
  if (!value) return { valid: false, error: "Pull secret is required for install-config." };
  try {
    const parsed = JSON.parse(value);
    if (parsed.auths && typeof parsed.auths === "object") return { valid: true, error: "" };
    return { valid: false, error: "Pull secret must include an auths object." };
  } catch {
    return { valid: false, error: "Pull secret must be valid JSON." };
  }
};

/** Optional Red Hat pull secret: empty is valid; if present must be valid JSON with auths. */
const validateBlueprintPullSecretOptional = (value) => {
  const trimmed = (value || "").trim();
  if (!trimmed) return { valid: true, error: "" };
  return isValidPullSecret(trimmed);
};

const cidrToRange = (cidr) => {
  if (!isValidIpv4Cidr(cidr)) return null;
  const [ip, prefix] = cidr.split("/");
  const bits = Number(prefix);
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

/** IPv6 CIDR to 128-bit range for overlap check. Returns { start, end } as BigInt or null if invalid. */
const ipv6CidrToRange = (cidr) => {
  if (!cidr || !cidr.includes("/")) return null;
  const [addr, prefixStr] = cidr.split("/");
  const prefix = Number(prefixStr);
  if (Number.isNaN(prefix) || prefix < 0 || prefix > 128) return null;
  const parts = addr.trim().split(":");
  if (parts.length < 2) return null;
  const expanded = [];
  let i = 0;
  while (i < parts.length) {
    if (parts[i] === "") {
      const before = expanded.length;
      const after = parts.slice(i + 1).filter((s) => s !== "").length;
      const total = before + after;
      if (total > 8) return null;
      for (let z = 0; z < 8 - total; z++) expanded.push(0);
      i++;
      continue;
    }
    const n = parseInt(parts[i], 16);
    if (Number.isNaN(n) || n < 0 || n > 0xffff) return null;
    expanded.push(n);
    i++;
  }
  if (expanded.length !== 8) return null;
  let big = 0n;
  for (const w of expanded) big = (big << 16n) + BigInt(w);
  const maskBits = BigInt(prefix);
  const size = 128 - prefix;
  const mask = size <= 0 ? -1n : (1n << BigInt(size)) - 1n;
  const start = big & ~mask;
  const end = start + ((1n << BigInt(size)) - 1n);
  return { start, end };
};

const ipv6CidrOverlaps = (cidrA, cidrB) => {
  const a = ipv6CidrToRange(cidrA);
  const b = ipv6CidrToRange(cidrB);
  if (!a || !b) return false;
  return a.start <= b.end && b.start <= a.end;
};

const ipInCidr = (ipCidr, cidr) => {
  const ip = ipCidr.split("/")[0];
  if (!ip || !cidr || !cidr.includes("/")) return true;
  if (ip.includes(":")) return true;
  const [range, bits] = cidr.split("/");
  const mask = -1 << (32 - Number(bits));
  const toInt = (addr) => addr.split(".").reduce((acc, oct) => (acc << 8) + Number(oct), 0) >>> 0;
  return (toInt(ip) & mask) === (toInt(range) & mask);
};

/** Validates a single host-inventory node: hostname, BMC (bare-metal IPI), primary interface (ethernet/bond/vlan), static IP/MAC. */
const validateNode = ({ node, enableIpv6, machineCidr, platform, method, includeCredentials }) => {
  const errors = [];
  const warnings = [];
  const fieldErrors = {};

  const addError = (field, message) => {
    errors.push(message);
    fieldErrors[field] = message;
  };
  const addWarning = (field, message) => {
    warnings.push(message);
    if (!fieldErrors[field]) fieldErrors[field] = message;
  };

  if (!node.hostname) addError("hostname", "Hostname is required.");
  if (!node.rootDevice) addWarning("rootDevice", "Root device hint is missing (by-id/by-path recommended).");
  // Bare-metal IPI: BMC address, credentials (error if includeCredentials; else warning), boot MAC required.
  if (platform === "Bare Metal" && method === "IPI") {
    if (!node.bmc?.address) addError("bmc.address", "BMC address is required for bare metal IPI.");
    if (!node.bmc?.username) {
      (includeCredentials ? addError : addWarning)("bmc.username", "BMC username is required for bare metal IPI.");
    }
    if (!node.bmc?.password) {
      (includeCredentials ? addError : addWarning)("bmc.password", "BMC password is required for bare metal IPI.");
    }
    if (!node.bmc?.bootMACAddress) addError("bmc.bootMACAddress", "Boot MAC address is required for bare metal IPI.");
  }

  const primary = node.primary || {};
  if (!primary.type) addError("primary.type", "Primary interface type is required.");
  if (!primary.mode) addError("primary.mode", "Primary interface IP assignment is required.");

  // Primary interface: ethernet/bond/vlan shape and MAC; static mode requires IPv4 CIDR/gateway.
  const requireEthernet = primary.type === "ethernet" || primary.type === "vlan-on-ethernet";
  const requireBond = primary.type === "bond" || primary.type === "vlan-on-bond";
  if (requireEthernet) {
    if (!primary.ethernet?.name) addError("primary.ethernet.name", "Ethernet interface name is required.");
    if (!primary.ethernet?.macAddress) {
      addError("primary.ethernet.macAddress", "Ethernet MAC address is required.");
    } else if (!isValidMac(primary.ethernet.macAddress)) {
      addError("primary.ethernet.macAddress", "Ethernet MAC address format is invalid.");
    }
  }
  if (requireBond) {
    if (!primary.bond?.name) addError("primary.bond.name", "Bond name is required.");
    if (!primary.bond?.mode) addError("primary.bond.mode", "Bond mode is required.");
    const slaves = primary.bond?.slaves || [];
    if (slaves.length < 2) addError("primary.bond.slaves", "Bond requires at least 2 member interfaces.");
    slaves.forEach((slave, idx) => {
      if (!slave.name) addError(`primary.bond.slaves.${idx}.name`, "Bond member interface name is required.");
      if (!slave.macAddress) {
        addError(`primary.bond.slaves.${idx}.macAddress`, "Bond member MAC address is required.");
      } else if (!isValidMac(slave.macAddress)) {
        addError(`primary.bond.slaves.${idx}.macAddress`, "Bond member MAC address format is invalid.");
      }
    });
  }

  const requireVlan = primary.type === "vlan-on-ethernet" || primary.type === "vlan-on-bond";
  if (requireVlan) {
    if (!primary.vlan?.id) addError("primary.vlan.id", "VLAN ID is required.");
    const derivedBase =
      primary.vlan?.baseIface
      || (primary.type === "vlan-on-bond" ? primary.bond?.name : primary.ethernet?.name);
    if (!derivedBase) addError("primary.vlan.baseIface", "VLAN base interface is required.");
  }

  if (primary.mode === "static") {
    if (!primary.ipv4Cidr) addError("primary.ipv4Cidr", "IPv4 address/CIDR is required for static mode.");
    if (primary.ipv4Cidr && !isValidIpv4Cidr(primary.ipv4Cidr)) addError("primary.ipv4Cidr", "IPv4 CIDR is invalid.");
    if (!primary.ipv4Gateway) addError("primary.ipv4Gateway", "IPv4 default gateway is required.");
    if (primary.ipv4Gateway && !isValidIpv4(primary.ipv4Gateway)) addError("primary.ipv4Gateway", "IPv4 gateway must be a valid IPv4 address.");
    if (primary.ipv4Cidr && machineCidr && !ipInCidr(primary.ipv4Cidr, machineCidr)) {
      addWarning("primary.ipv4Cidr", `IPv4 is outside machine network (${machineCidr}).`);
    }
    if (enableIpv6 && primary.ipv6Cidr && !isValidIpv6Cidr(primary.ipv6Cidr)) {
      addError("primary.ipv6Cidr", "IPv6 CIDR is invalid.");
    }
    if (enableIpv6 && primary.ipv6Gateway && !primary.ipv6Cidr) {
      addError("primary.ipv6Cidr", "IPv6 CIDR is required when IPv6 gateway is provided.");
    }
  }

  const additional = node.additionalInterfaces || [];
  additional.forEach((iface, idx) => {
    const prefix = `additional.${idx}`;
    const requireEthernet = iface.type === "ethernet" || iface.type === "vlan-on-ethernet";
    const requireBond = iface.type === "bond" || iface.type === "vlan-on-bond";
    if (requireEthernet) {
      if (!iface.ethernet?.name) addError(`${prefix}.ethernet.name`, "Additional ethernet interface name is required.");
      if (!iface.ethernet?.macAddress) {
        addError(`${prefix}.ethernet.macAddress`, "Additional ethernet MAC address is required.");
      } else if (!isValidMac(iface.ethernet.macAddress)) {
        addError(`${prefix}.ethernet.macAddress`, "Additional ethernet MAC address format is invalid.");
      }
    }
    if (requireBond) {
      if (!iface.bond?.name) addError(`${prefix}.bond.name`, "Additional bond name is required.");
      if (!iface.bond?.mode) addError(`${prefix}.bond.mode`, "Additional bond mode is required.");
      const slaves = iface.bond?.slaves || [];
      if (slaves.length < 2) addError(`${prefix}.bond.slaves`, "Additional bond requires at least 2 member interfaces.");
      slaves.forEach((slave, sidx) => {
        if (!slave.name) addError(`${prefix}.bond.slaves.${sidx}.name`, "Additional bond member name is required.");
        if (!slave.macAddress) {
          addError(`${prefix}.bond.slaves.${sidx}.macAddress`, "Additional bond member MAC address is required.");
        } else if (!isValidMac(slave.macAddress)) {
          addError(`${prefix}.bond.slaves.${sidx}.macAddress`, "Additional bond member MAC address format is invalid.");
        }
      });
    }
    const requireVlan = iface.type === "vlan-on-ethernet" || iface.type === "vlan-on-bond";
    if (requireVlan) {
      if (!iface.vlan?.id) addError(`${prefix}.vlan.id`, "Additional VLAN ID is required.");
      const derivedBase =
        iface.vlan?.baseIface
        || (iface.type === "vlan-on-bond" ? iface.bond?.name : iface.ethernet?.name);
      if (!derivedBase) addError(`${prefix}.vlan.baseIface`, "Additional VLAN base interface is required.");
    }
    if (iface.mode === "static") {
      if (!iface.ipv4Cidr) addError(`${prefix}.ipv4Cidr`, "Additional IPv4 address/CIDR is required for static mode.");
      if (iface.ipv4Cidr && !isValidIpv4Cidr(iface.ipv4Cidr)) addError(`${prefix}.ipv4Cidr`, "Additional IPv4 CIDR is invalid.");
      if (enableIpv6 && iface.ipv6Cidr && !isValidIpv6Cidr(iface.ipv6Cidr)) {
        addError(`${prefix}.ipv6Cidr`, "Additional IPv6 CIDR is invalid.");
      }
    }
  });

  return { errors, warnings, fieldErrors };
};

/** Validates all host-inventory nodes; aggregates per-node errors/warnings. API/Ingress VIPs are validated on Networking step. */
const validateHostInventory = (state) => {
  const errors = [];
  const warnings = [];
  const perNode = [];
  const inventory = state.hostInventory || {};
  const enableIpv6 = Boolean(inventory.enableIpv6);
  const machineCidr = state.globalStrategy?.networking?.machineNetworkV4 || "";

  // API/Ingress VIPs are validated on the Networking step (or Global Strategy); not on Hosts page.

  const includeCredentials = Boolean(state.exportOptions?.includeCredentials);
  (inventory.nodes || []).forEach((node, idx) => {
    const result = validateNode({
      node,
      enableIpv6,
      machineCidr,
      platform: state.blueprint?.platform,
      method: state.methodology?.method,
      includeCredentials
    });
    perNode[idx] = result;
    errors.push(...result.errors.map((msg) => `Node ${idx + 1}: ${msg}`));
    warnings.push(...result.warnings.map((msg) => `Node ${idx + 1}: ${msg}`));
  });

  return { errors, warnings, perNode };
};

const validateVersionConfirmed = (state) => {
  const confirmed = state.version?.versionConfirmed ?? state.release?.confirmed;
  if (!confirmed) {
    return { errors: ["Version selection is not confirmed."], warnings: [] };
  }
  return { errors: [], warnings: [] };
};

const extractPemBlocks = (pem) =>
  (pem || "").match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g)?.map((block) => block.trim()) || [];

/** Trust bundles (mirror + proxy CA PEMs): when present, additionalTrustBundlePolicy is required and must be allowed for version. */
const validateTrust = (state) => {
  const trust = state.trust || {};
  const errors = [];
  const warnings = [];
  const mirrorBlocks = extractPemBlocks(trust.mirrorRegistryCaPem);
  const proxyBlocks = extractPemBlocks(trust.proxyCaPem);
  const effective = [...mirrorBlocks, ...proxyBlocks];
  const policies = getTrustBundlePolicies(state.version?.selectedVersion || state.release?.patchVersion || "");

  if (trust.mirrorRegistryUsesPrivateCa && !mirrorBlocks.length) {
    errors.push("Mirror registry CA bundle is required when the mirror registry uses a private or self-signed CA. Add the CA certificate(s) in Trust and Certificates.");
  }
  if (effective.length && !trust.additionalTrustBundlePolicy) {
    errors.push("additionalTrustBundlePolicy is required when a trust bundle is provided.");
  }
  if (effective.length && trust.additionalTrustBundlePolicy && !policies.includes(trust.additionalTrustBundlePolicy)) {
    errors.push("additionalTrustBundlePolicy is not allowed for the selected version.");
  }
  if (effective.length && !policies.length) {
    warnings.push("Selected version is not supported for trust bundle policy; default behavior may be conservative.");
  }
  return { errors, warnings };
};

/** Platform-specific required fields: AWS GovCloud (region), vSphere (vcenter, datacenter, cluster, datastore, network; creds by includeCredentials), Nutanix, Azure Government. */
const validatePlatformConfig = (state) => {
  const errors = [];
  const warnings = [];
  const platform = state.blueprint?.platform;
  const method = state.methodology?.method;
  const cfg = state.platformConfig || {};

  if ((method === "IPI" || method === "UPI") && platform === "AWS GovCloud") {
    if (!cfg.aws?.region) errors.push("AWS region is required for GovCloud installs.");
  }
  const includeCredentials = Boolean(state.exportOptions?.includeCredentials);
  if (method === "IPI" && platform === "VMware vSphere") {
    if (!cfg.vsphere?.vcenter) errors.push("vCenter server is required for vSphere IPI.");
    if (!cfg.vsphere?.datacenter) errors.push("Datacenter is required for vSphere IPI.");
    if (!cfg.vsphere?.cluster) errors.push("Cluster is required for vSphere IPI.");
    if (!cfg.vsphere?.datastore) errors.push("Datastore is required for vSphere IPI.");
    if (!cfg.vsphere?.network) errors.push("Network is required for vSphere IPI.");
    if (!cfg.vsphere?.username) {
      (includeCredentials ? errors : warnings).push("vCenter username is required for vSphere IPI.");
    }
    if (!cfg.vsphere?.password) {
      (includeCredentials ? errors : warnings).push("vCenter password is required for vSphere IPI.");
    }
  }
  if (method === "IPI" && platform === "Nutanix") {
    if (!cfg.nutanix?.endpoint) errors.push("Prism Central endpoint is required for Nutanix IPI.");
    if (!cfg.nutanix?.username) {
      (includeCredentials ? errors : warnings).push("Prism Central username is required for Nutanix IPI.");
    }
    if (!cfg.nutanix?.password) {
      (includeCredentials ? errors : warnings).push("Prism Central password is required for Nutanix IPI.");
    }
    if (!cfg.nutanix?.subnet) errors.push("Subnet UUID is required for Nutanix IPI.");
  }
  if (method === "IPI" && platform === "Azure Government") {
    if (!cfg.azure?.cloudName) errors.push("Azure cloud name is required for Azure Government IPI.");
    if (!cfg.azure?.region) errors.push("Azure region is required for Azure Government IPI.");
    if (!cfg.azure?.resourceGroupName) errors.push("Resource group name is required for Azure Government IPI.");
    if (!cfg.azure?.baseDomainResourceGroupName) errors.push("Base domain resource group is required for Azure Government IPI.");
  }
  return { errors, warnings };
};

/** Proxy: when proxy enabled, http/https must start with http:// or https://; jumpbox connectivity requires at least one proxy. */
const validateProxy = (state) => {
  const errors = [];
  const strategy = state.globalStrategy || {};
  const connectivity = state.docs?.connectivity || "fully-disconnected";
  const proxyRequired = connectivity === "jumpbox";
  if (!strategy.proxyEnabled) return { errors, warnings: [] };
  const httpProxy = strategy.proxies?.httpProxy || "";
  const httpsProxy = strategy.proxies?.httpsProxy || "";
  if (proxyRequired && !httpProxy && !httpsProxy) {
    errors.push("Proxy is required for jumpbox connectivity.");
  }
  if (httpProxy && !httpProxy.startsWith("http://")) {
    errors.push("HTTP proxy must start with http://");
  }
  if (httpsProxy && !httpsProxy.startsWith("http://") && !httpsProxy.startsWith("https://")) {
    errors.push("HTTPS proxy must start with http:// or https:// (use the scheme your proxy supports).");
  }
  return { errors, warnings: [] };
};

const validateCredentials = (state) => {
  const errors = [];
  const warnings = [];
  const creds = state.credentials || {};
  if (creds.sshPublicKey) {
    if (!isValidSshPublicKey(creds.sshPublicKey)) {
      warnings.push("SSH public key format is invalid.");
    }
  } else {
    warnings.push("SSH public key is missing.");
  }
  // When mirror registry allows anonymous pulls, backend injects dummy; treat as valid.
  if (creds.usingMirrorRegistry && creds.mirrorRegistryUnauthenticated) {
    return { errors, warnings };
  }
  const pullSecret = creds.usingMirrorRegistry
    ? (creds.mirrorRegistryPullSecret || "")
    : (creds.pullSecretPlaceholder || "");
  const pullSecretResult = isValidPullSecret(pullSecret);
  if (!pullSecretResult.valid) {
    errors.push(pullSecretResult.error);
  }
  return { errors, warnings };
};

const validateMirrorRegistrySecret = (state) => {
  const errors = [];
  const warnings = [];
  const creds = state.credentials || {};
  if (creds.mirrorRegistryUnauthenticated) {
    return { errors, warnings };
  }
  if (!creds.mirrorRegistryPullSecret) {
    warnings.push("Mirror registry pull secret is missing.");
    return { errors, warnings };
  }
  const result = isValidPullSecret(creds.mirrorRegistryPullSecret);
  if (!result.valid) {
    errors.push(`Mirror registry pull secret: ${result.error}`);
  }
  return { errors, warnings };
};

/** Networking format: machine/cluster/service CIDRs, API/Ingress VIPs, provisioning CIDR and cluster provisioning IP must be valid IPv4/CIDR. */
const validateNetworkingFormat = (state) => {
  const errors = [];
  const networking = state.globalStrategy?.networking || {};
  const hostInventory = state.hostInventory || {};
  const machine = (networking.machineNetworkV4 || "").trim();
  const cluster = (networking.clusterNetworkCidr || "").trim();
  const service = (networking.serviceNetworkCidr || "").trim();
  const clusterV6 = (networking.clusterNetworkCidrV6 || "").trim();
  const serviceV6 = (networking.serviceNetworkCidrV6 || "").trim();
  const ovnSubnet = (networking.ovnInternalJoinSubnet || "").trim();
  const apiVip = (hostInventory.apiVip || "").trim();
  const ingressVip = (hostInventory.ingressVip || "").trim();
  const provisioningCIDR = (hostInventory.provisioningNetworkCIDR || "").trim();
  const clusterProvisioningIP = (hostInventory.clusterProvisioningIP || "").trim();
  if (machine && !isValidIpv4Cidr(machine)) errors.push("Machine network (IPv4) must be a valid CIDR (e.g. 10.90.0.0/24).");
  if (cluster && !isValidIpv4Cidr(cluster)) errors.push("Cluster network CIDR must be valid (e.g. 10.128.0.0/14).");
  if (service && !isValidIpv4Cidr(service)) errors.push("Service network CIDR must be valid (e.g. 172.30.0.0/16).");
  if (clusterV6 && !isValidIpv6Cidr(clusterV6)) errors.push("Cluster network IPv6 CIDR must be a valid IPv6 CIDR (e.g. fd01::/48).");
  if (serviceV6 && !isValidIpv6Cidr(serviceV6)) errors.push("Service network IPv6 CIDR must be a valid IPv6 CIDR (e.g. fd02::/112).");
  if (ovnSubnet && !isValidIpv4Cidr(ovnSubnet)) errors.push("OVN internal join subnet must be a valid CIDR.");
  if (apiVip && !isValidIpv4(apiVip)) errors.push("API VIP must be a valid IPv4 address.");
  if (ingressVip && !isValidIpv4(ingressVip)) errors.push("Ingress VIP must be a valid IPv4 address.");
  if (provisioningCIDR && !isValidIpv4Cidr(provisioningCIDR)) errors.push("Provisioning network CIDR must be a valid CIDR.");
  if (clusterProvisioningIP && !isValidIpv4(clusterProvisioningIP)) errors.push("Cluster provisioning IP must be a valid IPv4 address.");
  return { errors, warnings: [] };
};

/** Networking overlaps: machine, cluster, and service CIDRs must not overlap (IPv4 and, when set, IPv6). */
const validateNetworkingOverlaps = (state) => {
  const errors = [];
  const networking = state.globalStrategy?.networking || {};
  const machine = networking.machineNetworkV4;
  const cluster = networking.clusterNetworkCidr;
  const service = networking.serviceNetworkCidr;
  if (machine && cluster && cidrOverlaps(machine, cluster)) {
    errors.push("Machine network overlaps with cluster network CIDR.");
  }
  if (machine && service && cidrOverlaps(machine, service)) {
    errors.push("Machine network overlaps with service network CIDR.");
  }
  if (cluster && service && cidrOverlaps(cluster, service)) {
    errors.push("Cluster network overlaps with service network CIDR.");
  }
  const machineV6 = (networking.machineNetworkV6 || "").trim();
  const clusterV6 = (networking.clusterNetworkCidrV6 || "").trim();
  const serviceV6 = (networking.serviceNetworkCidrV6 || "").trim();
  if (machineV6 && clusterV6 && ipv6CidrOverlaps(machineV6, clusterV6)) {
    errors.push("Machine network (IPv6) overlaps with cluster network IPv6 CIDR.");
  }
  if (machineV6 && serviceV6 && ipv6CidrOverlaps(machineV6, serviceV6)) {
    errors.push("Machine network (IPv6) overlaps with service network IPv6 CIDR.");
  }
  if (clusterV6 && serviceV6 && ipv6CidrOverlaps(clusterV6, serviceV6)) {
    errors.push("Cluster network IPv6 CIDR overlaps with service network IPv6 CIDR.");
  }
  return { errors, warnings: [] };
};

const validateBlueprint = (state) => {
  const errors = [];
  if (!state.blueprint?.confirmed) {
    errors.push("Blueprint selection is not confirmed.");
  }
  return { errors, warnings: [] };
};

/** Main entry: validate a step by stepId. Replacement steps (identity-access, networking-v2, trust-proxy, connectivity-mirroring, platform-specifics, hosts-inventory) each have their own branch. */
const validateStep = (state, stepId) => {
  if (stepId === "core-lock-in") {
    const blueprint = validateBlueprint(state);
    const release = validateVersionConfirmed(state);
    return {
      errors: [...blueprint.errors, ...release.errors],
      warnings: [...(blueprint.warnings || []), ...(release.warnings || [])]
    };
  }
  if (stepId === "install-method") return { errors: [], warnings: [] };
  if (stepId === "cluster-identity") return { errors: [], warnings: [] };
  if (stepId === "networking") {
    const proxy = validateProxy(state);
    const platform = validatePlatformConfig(state);
    const format = validateNetworkingFormat(state);
    const networking = validateNetworkingOverlaps(state);
    const credentials = validateCredentials(state);
    const mirrorSecret = validateMirrorRegistrySecret(state);
    return {
      errors: [...proxy.errors, ...platform.errors, ...format.errors, ...networking.errors, ...credentials.errors, ...mirrorSecret.errors],
      warnings: [...platform.warnings, ...networking.warnings, ...credentials.warnings, ...mirrorSecret.warnings]
    };
  }
  if (stepId === "disconnected-proxy") {
    const proxy = validateProxy(state);
    const platform = validatePlatformConfig(state);
    const format = validateNetworkingFormat(state);
    const networking = validateNetworkingOverlaps(state);
    const credentials = validateCredentials(state);
    const mirrorSecret = validateMirrorRegistrySecret(state);
    return {
      errors: [...proxy.errors, ...platform.errors, ...format.errors, ...networking.errors, ...credentials.errors, ...mirrorSecret.errors],
      warnings: [...platform.warnings, ...networking.warnings, ...credentials.warnings, ...mirrorSecret.warnings]
    };
  }
  if (stepId === "review-generate") {
    const version = validateVersionConfirmed(state);
    const inventory = validateStep(state, "inventory");
    const trust = validateTrust(state);
    const proxy = validateProxy(state);
    const platform = validatePlatformConfig(state);
    const format = validateNetworkingFormat(state);
    const networking = validateNetworkingOverlaps(state);
    const credentials = validateCredentials(state);
    const mirrorSecret = validateMirrorRegistrySecret(state);
    return {
      errors: [
        ...version.errors,
        ...inventory.errors,
        ...trust.errors,
        ...proxy.errors,
        ...platform.errors,
        ...format.errors,
        ...networking.errors,
        ...credentials.errors,
        ...mirrorSecret.errors
      ],
      warnings: [
        ...version.warnings,
        ...inventory.warnings,
        ...trust.warnings,
        ...proxy.warnings,
        ...platform.warnings,
        ...networking.warnings,
        ...credentials.warnings,
        ...mirrorSecret.warnings
      ]
    };
  }
  if (stepId === "blueprint") {
    const blueprintResult = validateBlueprint(state);
    const ephemeral = (state.blueprint?.blueprintPullSecretEphemeral || "").trim();
    const pullResult = validateBlueprintPullSecretOptional(ephemeral);
    const pullErrors = pullResult.valid ? [] : [pullResult.error];
    return {
      errors: [...blueprintResult.errors, ...pullErrors],
      warnings: blueprintResult.warnings || []
    };
  }
  if (stepId === "inventory") {
    const platform = state.blueprint?.platform;
    const method = state.methodology?.method;
    const showInventory = platform === "Bare Metal" && (method === "Agent-Based Installer" || method === "IPI");
    return showInventory ? validateHostInventory(state) : { errors: [], warnings: [] };
  }
  if (stepId === "inventory-v2") {
    const base = validateStep(state, "inventory");
    const platform = state.blueprint?.platform;
    const method = state.methodology?.method;
    const scenarioId = getScenarioId(platform, method);
    const catalog = getCatalogValidationForInventoryV2(state, scenarioId);
    return {
      errors: [...(base.errors || []), ...(catalog.errors || [])],
      warnings: [...(base.warnings || []), ...(catalog.warnings || [])]
    };
  }
  if (stepId === "review") {
    const version = validateVersionConfirmed(state);
    const inventory = validateStep(state, "inventory");
    const trust = validateTrust(state);
    const proxy = validateProxy(state);
    const platform = validatePlatformConfig(state);
    const format = validateNetworkingFormat(state);
    const networking = validateNetworkingOverlaps(state);
    const credentials = validateCredentials(state);
    const mirrorSecret = validateMirrorRegistrySecret(state);
    return {
      errors: [
        ...version.errors,
        ...inventory.errors,
        ...trust.errors,
        ...proxy.errors,
        ...platform.errors,
        ...format.errors,
        ...networking.errors,
        ...credentials.errors,
        ...mirrorSecret.errors
      ],
      warnings: [
        ...version.warnings,
        ...inventory.warnings,
        ...trust.warnings,
        ...proxy.warnings,
        ...platform.warnings,
        ...networking.warnings,
        ...credentials.warnings,
        ...mirrorSecret.warnings
      ]
    };
  }
  if (stepId === "operators") return validateVersionConfirmed(state);
  if (stepId === "release") return validateVersionConfirmed(state);
  if (stepId === "operations") return { errors: [], warnings: [] };
  if (stepId === "identity-access") {
    const credentials = validateCredentials(state);
    const clusterIdentityErrors = [];
    const fieldErrors = {};
    if (!state.blueprint?.clusterName?.trim()) {
      clusterIdentityErrors.push("Cluster name is required.");
      fieldErrors.clusterName = "Cluster name is required.";
    }
    if (!state.blueprint?.baseDomain?.trim()) {
      clusterIdentityErrors.push("Base domain is required.");
      fieldErrors.baseDomain = "Base domain is required.";
    }
    if (credentials.errors?.length) fieldErrors.pullSecret = credentials.errors[0] || "Pull secret is required.";
    return {
      errors: [...clusterIdentityErrors, ...credentials.errors],
      warnings: credentials.warnings,
      fieldErrors
    };
  }
  if (stepId === "networking-v2") {
    const format = validateNetworkingFormat(state);
    const networking = validateNetworkingOverlaps(state);
    const fieldErrors = {};
    format.errors.forEach((msg) => {
      if (msg.includes("Machine network")) fieldErrors.machineNetworkV4 = msg;
      else if (msg.includes("Cluster network")) fieldErrors.clusterNetworkCidr = msg;
      else if (msg.includes("Service network")) fieldErrors.serviceNetworkCidr = msg;
      else if (msg.includes("API VIP")) fieldErrors.apiVip = msg;
      else if (msg.includes("Ingress VIP")) fieldErrors.ingressVip = msg;
    });
    networking.errors.forEach((msg) => {
      if (msg.includes("Machine network (IPv6)")) fieldErrors.machineNetworkV6 = msg;
      else if (msg.includes("cluster network IPv6")) fieldErrors.clusterNetworkCidrV6 = msg;
      else if (msg.includes("service network IPv6")) fieldErrors.serviceNetworkCidrV6 = msg;
    });
    return {
      errors: [...format.errors, ...networking.errors],
      warnings: networking.warnings || [],
      fieldErrors
    };
  }
  if (stepId === "trust-proxy") {
    const proxy = validateProxy(state);
    const trust = validateTrust(state);
    return {
      errors: [...proxy.errors, ...trust.errors],
      warnings: [...(proxy.warnings || []), ...(trust.warnings || [])]
    };
  }
  if (stepId === "connectivity-mirroring") {
    const errors = [];
    const fieldErrors = {};
    const sources = state.globalStrategy?.mirroring?.sources || [];
    for (const row of sources) {
      const mirrors = row.mirrors || [];
      const hasMirrors = mirrors.some((m) => typeof m === "string" && m.trim() !== "");
      if (hasMirrors && !(row.source && String(row.source).trim())) {
        errors.push("Source repository is required when mirror URL(s) are set.");
        fieldErrors.mirrorSources = "Source repository is required when mirror URL(s) are set.";
      }
    }
    return { errors, warnings: [], fieldErrors };
  }
  // platform-specifics: required fields per scenario (Azure, vSphere, AWS GovCloud, Nutanix) from catalog required paths.
  if (stepId === "platform-specifics") {
    const platform = state.blueprint?.platform;
    const method = state.methodology?.method;
    const scenarioId = getScenarioId(platform, method);
    const vsphere = state.platformConfig?.vsphere || {};
    const aws = state.platformConfig?.aws || {};
    const azure = state.platformConfig?.azure || {};
    if (scenarioId === "azure-government-ipi") {
      const errors = [];
      const requiredPaths = getRequiredParamsForOutput(scenarioId, "install-config.yaml") || [];
      if (requiredPaths.includes("platform.azure.cloudName") && !(azure.cloudName || "").trim()) {
        errors.push("Azure cloud name is required for Azure Government IPI.");
      }
      if (requiredPaths.includes("platform.azure.region") && !(azure.region || "").trim()) {
        errors.push("Azure region is required for Azure Government IPI.");
      }
      if (requiredPaths.includes("platform.azure.resourceGroupName") && !(azure.resourceGroupName || "").trim()) {
        errors.push("Resource group name is required for Azure Government IPI.");
      }
      if (requiredPaths.includes("platform.azure.baseDomainResourceGroupName") && !(azure.baseDomainResourceGroupName || "").trim()) {
        errors.push("Base domain resource group is required for Azure Government IPI.");
      }
      return { errors, warnings: [] };
    }
    if (scenarioId === "vsphere-ipi" || scenarioId === "vsphere-upi") {
      const errors = [];
      const label = scenarioId === "vsphere-upi" ? "vSphere UPI" : "vSphere IPI";
      const requiredPaths = getRequiredParamsForOutput(scenarioId, "install-config.yaml") || [];
      if (requiredPaths.includes("platform.vsphere.vcenter") && !(vsphere.vcenter || "").trim()) {
        errors.push(`vCenter server is required for ${label}.`);
      }
      if (requiredPaths.includes("platform.vsphere.datacenter") && !(vsphere.datacenter || "").trim()) {
        errors.push(`Datacenter is required for ${label}.`);
      }
      if (requiredPaths.includes("platform.vsphere.defaultDatastore") && !(vsphere.datastore || "").trim()) {
        errors.push(`Default datastore is required for ${label}.`);
      }
      return { errors, warnings: [] };
    }
    if (scenarioId === "aws-govcloud-ipi" || scenarioId === "aws-govcloud-upi") {
      const errors = [];
      const label = scenarioId === "aws-govcloud-upi" ? "AWS GovCloud UPI" : "AWS GovCloud IPI";
      const requiredPaths = getRequiredParamsForOutput(scenarioId, "install-config.yaml") || [];
      if (requiredPaths.includes("platform.aws.region") && !(aws.region || "").trim()) {
        errors.push(`AWS GovCloud region is required for ${label}.`);
      }
      return { errors, warnings: [] };
    }
    if (scenarioId === "nutanix-ipi") {
      return validatePlatformConfig(state);
    }
    return { errors: [], warnings: [] };
  }
  // hosts-inventory: only bare-metal agent and bare-metal IPI have host inventory in this app.
  if (stepId === "hosts-inventory") {
    const platform = state.blueprint?.platform;
    const method = state.methodology?.method;
    const hasHostInventory = platform === "Bare Metal" && (method === "Agent-Based Installer" || method === "IPI");
    return hasHostInventory ? validateStep(state, "inventory-v2") : { errors: [], warnings: [] };
  }
  if (stepId === "global") {
    const proxy = validateProxy(state);
    const platform = validatePlatformConfig(state);
    const format = validateNetworkingFormat(state);
    const networking = validateNetworkingOverlaps(state);
    const credentials = validateCredentials(state);
    const mirrorSecret = validateMirrorRegistrySecret(state);
    const clusterIdentityErrors = [];
    const fieldErrors = {};
    if (!state.blueprint?.clusterName?.trim()) {
      clusterIdentityErrors.push("Cluster name is required.");
      fieldErrors.clusterName = "Cluster name is required.";
    }
    if (!state.blueprint?.baseDomain?.trim()) {
      clusterIdentityErrors.push("Base domain is required.");
      fieldErrors.baseDomain = "Base domain is required.";
    }
    if (proxy.errors?.length) fieldErrors.proxy = proxy.errors[0];
    if (platform.errors?.length) fieldErrors.platform = platform.errors[0];
    if (format.errors?.length || networking.errors?.length) fieldErrors.networking = true;
    if (credentials.errors?.length) fieldErrors.pullSecret = credentials.errors[0];
    if (mirrorSecret.errors?.length) fieldErrors.mirrorSecret = mirrorSecret.errors[0];
    return {
      errors: [...clusterIdentityErrors, ...proxy.errors, ...platform.errors, ...format.errors, ...networking.errors, ...credentials.errors, ...mirrorSecret.errors],
      warnings: [...platform.warnings, ...networking.warnings, ...credentials.warnings, ...mirrorSecret.warnings],
      fieldErrors
    };
  }
  return { errors: [], warnings: [] };
};

export {
  validateHostInventory,
  validateNode,
  validateStep,
  validateCredentials,
  isValidSshPublicKey,
  isValidPullSecret,
  validateBlueprintPullSecretOptional,
  validateMirrorRegistrySecret,
  validateBlueprint,
  ipv6CidrOverlaps
};
