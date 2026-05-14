const PLACEHOLDER_PREFIX = "__AIRA_PLACEHOLDER__";

const PLACEHOLDER_ALLOWLIST = {
  hostname: {
    displayLabel: "Hostname",
    fieldCategory: "identity",
    sensitivityClassification: "environment-specific",
    reviewRequired: true,
    allowedInPreview: true,
    blockedForExecution: true
  },
  ipAddress: {
    displayLabel: "IP address",
    fieldCategory: "networking",
    sensitivityClassification: "environment-specific",
    reviewRequired: true,
    allowedInPreview: true,
    blockedForExecution: true
  },
  subnet: {
    displayLabel: "Subnet",
    fieldCategory: "networking",
    sensitivityClassification: "environment-specific",
    reviewRequired: true,
    allowedInPreview: true,
    blockedForExecution: true
  },
  macAddress: {
    displayLabel: "MAC address",
    fieldCategory: "networking",
    sensitivityClassification: "environment-specific",
    reviewRequired: true,
    allowedInPreview: true,
    blockedForExecution: true
  },
  rootDeviceHint: {
    displayLabel: "Root device hint",
    fieldCategory: "storage",
    sensitivityClassification: "environment-specific",
    reviewRequired: true,
    allowedInPreview: true,
    blockedForExecution: true
  },
  bmcAddress: {
    displayLabel: "BMC address",
    fieldCategory: "management",
    sensitivityClassification: "sensitive-endpoint",
    reviewRequired: true,
    allowedInPreview: true,
    blockedForExecution: true
  },
  bondName: {
    displayLabel: "Bond name",
    fieldCategory: "networking",
    sensitivityClassification: "environment-specific",
    reviewRequired: true,
    allowedInPreview: true,
    blockedForExecution: true
  },
  vlanId: {
    displayLabel: "VLAN ID",
    fieldCategory: "networking",
    sensitivityClassification: "environment-specific",
    reviewRequired: true,
    allowedInPreview: true,
    blockedForExecution: true
  },
  vip: {
    displayLabel: "Virtual IP",
    fieldCategory: "networking",
    sensitivityClassification: "environment-specific",
    reviewRequired: true,
    allowedInPreview: true,
    blockedForExecution: true
  },
  proxyValue: {
    displayLabel: "Proxy value",
    fieldCategory: "connectivity",
    sensitivityClassification: "sensitive-endpoint",
    reviewRequired: true,
    allowedInPreview: true,
    blockedForExecution: true
  },
  trustBundle: {
    displayLabel: "Trust bundle/certificate",
    fieldCategory: "certificates",
    sensitivityClassification: "certificate-material",
    reviewRequired: true,
    allowedInPreview: true,
    blockedForExecution: true
  },
  mirrorRegistryCredential: {
    displayLabel: "Mirror registry credential",
    fieldCategory: "credentials",
    sensitivityClassification: "secret",
    reviewRequired: true,
    allowedInPreview: true,
    blockedForExecution: true
  },
  sshPublicKey: {
    displayLabel: "SSH public key",
    fieldCategory: "credentials",
    sensitivityClassification: "sensitive-identity",
    reviewRequired: true,
    allowedInPreview: true,
    blockedForExecution: true
  },
  pullSecret: {
    displayLabel: "Pull secret",
    fieldCategory: "credentials",
    sensitivityClassification: "secret",
    reviewRequired: true,
    allowedInPreview: true,
    blockedForExecution: true
  }
};

const isPlaceholderToken = (value) => {
  return typeof value === "string" && value.startsWith(`${PLACEHOLDER_PREFIX}::`);
};

const createPlaceholderToken = ({ type, label }) => {
  const safeType = PLACEHOLDER_ALLOWLIST[type] ? type : "hostname";
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const encodedLabel = encodeURIComponent(label || PLACEHOLDER_ALLOWLIST[safeType].displayLabel || "value");
  return `${PLACEHOLDER_PREFIX}::${safeType}::${id}::${encodedLabel}`;
};

const buildPlaceholderEntry = ({ type, label }) => {
  const token = createPlaceholderToken({ type, label });
  const meta = PLACEHOLDER_ALLOWLIST[type] || PLACEHOLDER_ALLOWLIST.hostname;
  return {
    token,
    metadata: {
      ...meta,
      displayLabel: label || meta.displayLabel
    }
  };
};

const registerPlaceholderEntry = (state, entry) => {
  const placeholders = {
    ...(state.placeholders || {}),
    entries: {
      ...(state.placeholders?.entries || {}),
      [entry.token]: entry.metadata
    }
  };
  return placeholders;
};

const countPlaceholders = (value) => {
  let count = 0;
  const walk = (v) => {
    if (v == null) return;
    if (typeof v === "string") {
      if (isPlaceholderToken(v)) count += 1;
      return;
    }
    if (Array.isArray(v)) {
      v.forEach(walk);
      return;
    }
    if (typeof v === "object") {
      Object.values(v).forEach(walk);
    }
  };
  walk(value);
  return count;
};

export {
  PLACEHOLDER_ALLOWLIST,
  PLACEHOLDER_PREFIX,
  buildPlaceholderEntry,
  countPlaceholders,
  createPlaceholderToken,
  isPlaceholderToken,
  registerPlaceholderEntry
};
