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

export { defaultSecretInclusion, resolveSecretInclusion, deriveLegacyFlagsFromInclusion, canonicalizeExportOptions };
