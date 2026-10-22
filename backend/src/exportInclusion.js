const defaultSecretInclusion = () => ({
  pullSecret: false,
  platformCredentials: false,
  mirrorRegistryCredentials: false,
  bmcCredentials: false,
  trustBundleAndCertificates: true,
  sshPublicKey: true,
  proxyValues: true
});

const resolveSecretInclusion = (exportOptions = {}) => {
  const base = defaultSecretInclusion();
  const hasLegacyCreds = Object.prototype.hasOwnProperty.call(exportOptions, "includeCredentials");
  const hasLegacyCerts = Object.prototype.hasOwnProperty.call(exportOptions, "includeCertificates");
  const legacyIncludeCredentials = Boolean(exportOptions.includeCredentials);
  const legacyIncludeCertificates = exportOptions.includeCertificates === true;
  const fromState = exportOptions.inclusion || {};
  return {
    ...base,
    ...fromState,
    pullSecret: fromState.pullSecret ?? (hasLegacyCreds ? legacyIncludeCredentials : base.pullSecret),
    platformCredentials: fromState.platformCredentials ?? (hasLegacyCreds ? legacyIncludeCredentials : base.platformCredentials),
    mirrorRegistryCredentials: fromState.mirrorRegistryCredentials ?? (hasLegacyCreds ? legacyIncludeCredentials : base.mirrorRegistryCredentials),
    bmcCredentials: fromState.bmcCredentials ?? (hasLegacyCreds ? legacyIncludeCredentials : base.bmcCredentials),
    trustBundleAndCertificates: fromState.trustBundleAndCertificates ?? (hasLegacyCerts ? legacyIncludeCertificates : base.trustBundleAndCertificates),
    sshPublicKey: fromState.sshPublicKey ?? true,
    proxyValues: fromState.proxyValues ?? true
  };
};

const deriveLegacyFlagsFromInclusion = (inclusion) => ({
  includeCredentials: Boolean(
    inclusion.pullSecret
    || inclusion.platformCredentials
    || inclusion.mirrorRegistryCredentials
    || inclusion.bmcCredentials
  ),
  includeCertificates: Boolean(inclusion.trustBundleAndCertificates)
});

const canonicalizeExportOptions = (exportOptions = {}) => {
  const inclusion = resolveSecretInclusion(exportOptions);
  return {
    ...exportOptions,
    inclusion,
    ...deriveLegacyFlagsFromInclusion(inclusion)
  };
};

// DOC-177. The "Proxy values" export switch. When it is off, every proxy value the
// user configured is replaced by an explicit marker in the exported bundle's
// generated files (install-config.yaml and the Field Manual). The proxy block is
// deliberately NOT omitted: an install-config without it silently describes a
// cluster with no proxy, which is a different cluster. A marker keeps the
// requirement visible and is not a proxy URL, so it cannot be mistaken for one.
// Values the user never set stay empty, so no proxy is invented.
//
// This governs proxy ENDPOINTS only. Userinfo embedded in a proxy URL is a
// credential and stays under the credential-inclusion contract (DOC-176), which
// still applies when this switch is on.
const PROXY_VALUE_MARKERS = Object.freeze({
  httpProxy: "REPLACE_WITH_HTTP_PROXY_URL",
  httpsProxy: "REPLACE_WITH_HTTPS_PROXY_URL",
  noProxy: "REPLACE_WITH_NO_PROXY_LIST"
});

const applyProxyValueInclusion = (state) => {
  if (resolveSecretInclusion(state?.exportOptions || {}).proxyValues !== false) return state;
  const proxies = state?.globalStrategy?.proxies;
  if (!proxies || typeof proxies !== "object") return state;
  const redacted = { ...proxies };
  for (const [key, marker] of Object.entries(PROXY_VALUE_MARKERS)) {
    if (typeof proxies[key] === "string" && proxies[key].trim()) redacted[key] = marker;
  }
  return { ...state, globalStrategy: { ...state.globalStrategy, proxies: redacted } };
};

export {
  defaultSecretInclusion,
  resolveSecretInclusion,
  deriveLegacyFlagsFromInclusion,
  canonicalizeExportOptions,
  PROXY_VALUE_MARKERS,
  applyProxyValueInclusion
};
