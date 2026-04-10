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
  const fromState = exportOptions.inclusion || {};
  const hasLegacyCreds = Object.prototype.hasOwnProperty.call(exportOptions, "includeCredentials");
  const hasLegacyCerts = Object.prototype.hasOwnProperty.call(exportOptions, "includeCertificates");
  const legacyCreds = Boolean(exportOptions.includeCredentials);
  const legacyCerts = exportOptions.includeCertificates === true;
  return {
    ...base,
    ...fromState,
    pullSecret: fromState.pullSecret ?? (hasLegacyCreds ? legacyCreds : base.pullSecret),
    platformCredentials: fromState.platformCredentials ?? (hasLegacyCreds ? legacyCreds : base.platformCredentials),
    mirrorRegistryCredentials: fromState.mirrorRegistryCredentials ?? (hasLegacyCreds ? legacyCreds : base.mirrorRegistryCredentials),
    bmcCredentials: fromState.bmcCredentials ?? (hasLegacyCreds ? legacyCreds : base.bmcCredentials),
    trustBundleAndCertificates: fromState.trustBundleAndCertificates ?? (hasLegacyCerts ? legacyCerts : base.trustBundleAndCertificates),
    sshPublicKey: fromState.sshPublicKey ?? true,
    proxyValues: fromState.proxyValues ?? true
  };
};

export { defaultSecretInclusion, resolveSecretInclusion };
