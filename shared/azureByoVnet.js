function validateAzureByoVnet(azure, selectedMinor) {
  if (!azure || azure.vnetMode !== "existing-vnet") return { valid: true, errors: [] };

  const errors = [];
  const vnet = (azure.virtualNetwork || "").trim();
  const netRg = (azure.networkResourceGroupName || "").trim();
  const cpSubnet = (azure.controlPlaneSubnet || "").trim();

  if (azure.nodeSubnets !== undefined && azure.nodeSubnets !== null && !Array.isArray(azure.nodeSubnets)) {
    return { valid: false, errors: ["Node subnets must be an array."] };
  }
  const nodeSubnets = Array.isArray(azure.nodeSubnets) ? azure.nodeSubnets : [];

  if (!vnet) errors.push("Virtual network name is required when using an existing VNet.");
  if (!netRg) errors.push("Network resource group is required when using an existing VNet.");
  if (!cpSubnet) errors.push("Control plane subnet is required when using an existing VNet.");

  if (nodeSubnets.length === 0) {
    errors.push("At least one node subnet is required when using an existing VNet.");
  } else {
    for (let i = 0; i < nodeSubnets.length; i++) {
      if (!(nodeSubnets[i] || "").trim()) {
        errors.push(`Node subnet ${i + 1} is blank. Every node subnet entry must have a name.`);
      }
    }
  }

  const trimmedNodes = nodeSubnets.map(s => (s || "").trim()).filter(Boolean);
  const allNames = cpSubnet ? [cpSubnet, ...trimmedNodes] : [...trimmedNodes];
  const seen = new Set();
  for (const name of allNames) {
    if (seen.has(name)) {
      errors.push(`Duplicate subnet name: "${name}". All subnet names must be unique.`);
      break;
    }
    seen.add(name);
  }

  if (selectedMinor === "4.20" && nodeSubnets.length > 1) {
    errors.push(`OpenShift 4.20 supports only one node subnet. You have ${nodeSubnets.length} node subnets configured. Switch back to OpenShift 4.21 or remove extras.`);
  }

  return { valid: errors.length === 0, errors };
}

export { validateAzureByoVnet };
