/**
 * OpenShift Airgap Architect - post-import follow-up detection (PHX-033, PHX-035)
 *
 * A run export never carries credentials, and carries certificates only when
 * the exporting user left "Trust bundles / cert material" on. After an import,
 * this works out — from the imported state alone — which of those the run
 * still needs, and where to re-enter each one.
 *
 * Every item is derived from configuration that survives import (a mirror
 * registry in use, a BMC address, a vCenter, a private-CA flag), so the list
 * names only what THIS run needs, and an item disappears as soon as the value
 * is re-entered. Nothing here restores, invents or reveals a secret.
 */

const hasContent = (value) => {
  const v = typeof value === "string" ? value.trim() : "";
  return Boolean(v) && v !== '{"auths":{}}';
};

/** True when the exporting user excluded certificate material from the file. */
const certificatesWereExcluded = (exportOptions = {}) =>
  exportOptions.inclusion?.trustBundleAndCertificates === false || exportOptions.includeCertificates === false;

/**
 * @returns {{ credentials: {id: string, label: string, where: string}[],
 *             certificates: {id: string, label: string, where: string}[] }}
 */
const getImportFollowUps = (state) => {
  const credentials = [];
  const certificates = [];
  if (!state?.ui?.isImported) return { credentials, certificates };

  const creds = state.credentials || {};
  const platform = state.blueprint?.platform;
  const method = state.methodology?.method;
  const platformConfig = state.platformConfig || {};
  const strategy = state.globalStrategy || {};
  const trust = state.trust || {};

  // Pull secret — the same choice validateCredentials and generation make.
  if (!(creds.usingMirrorRegistry && creds.mirrorRegistryUnauthenticated)) {
    if (creds.usingMirrorRegistry) {
      if (!hasContent(creds.mirrorRegistryPullSecret)) {
        credentials.push({ id: "mirror-pull-secret", label: "Mirror registry pull secret", where: "Identity & Access" });
      }
    } else if (!hasContent(creds.pullSecretPlaceholder)) {
      credentials.push({ id: "pull-secret", label: "Red Hat pull secret", where: "Identity & Access" });
    }
  }

  if (platform === "VMware vSphere" && (method === "IPI" || method === "UPI")) {
    const vs = platformConfig.vsphere || {};
    const configured = Boolean(vs.vcenter || (vs.vcenters || []).some((vc) => vc?.server));
    const hasPassword = Boolean(vs.password || (vs.vcenters || []).some((vc) => vc?.password));
    if (configured && !hasPassword) {
      credentials.push({ id: "vsphere", label: "vCenter username and password", where: "Platform Specifics" });
    }
  }

  if (platform === "Nutanix") {
    const nx = platformConfig.nutanix || {};
    if ((nx.endpoint || nx.prismCentral) && !nx.password) {
      credentials.push({ id: "nutanix", label: "Prism Central username and password", where: "Platform Specifics" });
    }
  }

  const bmcMissing = (state.hostInventory?.nodes || []).filter(
    (node) => (node?.bmc?.address || "").trim() && !node?.bmc?.password
  ).length;
  if (bmcMissing > 0) {
    credentials.push({
      id: "bmc",
      label: `BMC username and password (${bmcMissing} ${bmcMissing === 1 ? "host" : "hosts"})`,
      where: "Hosts / Inventory"
    });
  }

  if (strategy.proxyEnabled) {
    // A proxy URL's user:password is always stripped and its former presence is
    // not recorded, so this can only be conditional.
    credentials.push({ id: "proxy", label: "Proxy username and password, if your proxy requires them", where: "Trust & Proxy" });
  }

  if (trust.mirrorRegistryUsesPrivateCa && !hasContent(trust.mirrorRegistryCaPem)) {
    certificates.push({ id: "mirror-ca", label: "Mirror registry CA certificate", where: "Trust & Proxy" });
  }
  if (certificatesWereExcluded(state.exportOptions) && strategy.proxyEnabled && !hasContent(trust.proxyCaPem)) {
    certificates.push({ id: "proxy-ca", label: "Proxy CA certificate, if your proxy uses one", where: "Trust & Proxy" });
  }

  return { credentials, certificates };
};

export { getImportFollowUps, certificatesWereExcluded };
