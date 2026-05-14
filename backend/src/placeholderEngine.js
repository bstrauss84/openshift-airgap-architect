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

const parsePlaceholderToken = (value) => {
  if (!isPlaceholderToken(value)) return null;
  const parts = value.split("::");
  if (parts.length < 4) return null;
  const [, type, id, encodedLabel] = parts;
  let label = "";
  try {
    label = decodeURIComponent(encodedLabel || "");
  } catch {
    label = encodedLabel || "";
  }
  return { token: value, type, id, label };
};

const getPlaceholderMetadata = (state, tokenDetails) => {
  const fromState = state?.placeholders?.entries?.[tokenDetails.token];
  const fallback = PLACEHOLDER_ALLOWLIST[tokenDetails.type] || null;
  if (!fromState && !fallback) return null;
  return {
    ...fallback,
    ...(fromState || {}),
    token: tokenDetails.token,
    type: tokenDetails.type,
    displayLabel: fromState?.displayLabel || tokenDetails.label || fallback?.displayLabel || "Marked for later completion"
  };
};

const collectPlaceholderUsage = (state) => {
  const found = [];
  const seen = new Set();
  const walk = (value, path = "") => {
    if (value == null) return;
    if (typeof value === "string") {
      if (isPlaceholderToken(value)) {
        const token = parsePlaceholderToken(value);
        if (token && !seen.has(token.token)) {
          seen.add(token.token);
          found.push({
            path,
            token: token.token,
            type: token.type,
            metadata: getPlaceholderMetadata(state, token)
          });
        }
      }
      return;
    }
    if (Array.isArray(value)) {
      value.forEach((entry, idx) => walk(entry, `${path}[${idx}]`));
      return;
    }
    if (typeof value === "object") {
      Object.entries(value).forEach(([key, nested]) => {
        const nextPath = path ? `${path}.${key}` : key;
        walk(nested, nextPath);
      });
    }
  };
  walk(state || {});
  return found;
};

const toUserVisiblePlaceholder = (metadata) => {
  const label = metadata?.displayLabel || "value";
  return `<<MARK FOR LATER COMPLETION: ${label}>>`;
};

const replacePlaceholderTokensInText = (text, state) => {
  if (typeof text !== "string" || !text.includes(PLACEHOLDER_PREFIX)) return text;
  const usage = collectPlaceholderUsage(state);
  let out = text;
  for (const item of usage) {
    const replacement = toUserVisiblePlaceholder(item.metadata);
    out = out.split(item.token).join(replacement);
  }
  return out;
};

export {
  PLACEHOLDER_ALLOWLIST,
  PLACEHOLDER_PREFIX,
  collectPlaceholderUsage,
  isPlaceholderToken,
  parsePlaceholderToken,
  replacePlaceholderTokensInText,
  toUserVisiblePlaceholder
};
