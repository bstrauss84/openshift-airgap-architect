/**
 * OpenShift Airgap Architect - State Sanitizer
 *
 * Sanitizes state for backend persistence to prevent credential storage in SQLite.
 *
 * @author Bill Strauss
 *
 * Developed with AI assistance from Claude (Anthropic) and Cursor AI.
 */

/**
 * Strips credentials embedded in proxy URLs (http://user:pass@host:port)
 * Preserves scheme, host, port, and path but removes authentication.
 *
 * @param {string} proxyUrl - Proxy URL that may contain credentials
 * @returns {string} Sanitized URL without credentials, or empty string if invalid
 */
export function stripProxyCredentials(proxyUrl) {
  if (!proxyUrl || typeof proxyUrl !== "string") return "";

  const trimmed = proxyUrl.trim();
  if (!trimmed) return "";

  try {
    const url = new URL(trimmed);
    // If credentials exist, remove them
    if (url.username || url.password) {
      url.username = "";
      url.password = "";
    }
    return url.toString();
  } catch {
    // Not a valid URL, return as-is (may be empty string or placeholder)
    return trimmed;
  }
}

/**
 * Recursively sanitizes an object by removing credential fields.
 * Does NOT mutate the input object.
 *
 * Strips keys (case-insensitive):
 * - password, passwd, secret, token, accessToken, refreshToken, clientSecret
 * - privateKey, pullSecret, pullSecretPlaceholder, mirrorRegistryPullSecret
 * - operatorPullSecret, sshPrivateKey, bmcPassword, bmcUsername
 * - vcenterPassword, vCenterPassword, prismPassword, registryPassword, proxyPassword
 * - auth, auths (exact match only, not authenticationMode)
 *
 * @param {any} obj - Object to sanitize
 * @returns {any} Sanitized deep copy
 */
export function sanitizeCredentialFields(obj) {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj !== "object") return obj;
  if (Array.isArray(obj)) return obj.map(sanitizeCredentialFields);

  // Exact sensitive keys (case-insensitive exact match only)
  const sensitiveKeys = new Set([
    "password",
    "passwd",
    "secret",
    "token",
    "accesstoken",
    "refreshtoken",
    "clientsecret",
    "privatekey",
    "pullsecret",
    "pullsecretplaceholder",
    "mirrorregistrypullsecret",
    "operatorpullsecret",
    "sshprivatekey",
    "bmcpassword",
    "bmcusername",
    "vcenterpassword",
    "prismpassword",
    "registrypassword",
    "proxypassword",
    "auth",
    "auths",
    "accesskeyid",
    "secretaccesskey",
    "apikey",
  ]);

  const result = {};
  for (const [key, value] of Object.entries(obj)) {
    const lowerKey = key.toLowerCase();

    // Skip exact-match sensitive keys (case-insensitive)
    if (sensitiveKeys.has(lowerKey)) continue;

    // Recursively sanitize nested objects
    result[key] = sanitizeCredentialFields(value);
  }
  return result;
}

/**
 * Sanitizes state for backend persistence.
 * Strips credentials from known paths and recursively removes sensitive fields.
 * Does NOT mutate the input state.
 *
 * @param {object} state - State object to sanitize
 * @returns {object} Sanitized deep copy safe for SQLite persistence
 */
export function sanitizeStateForPersistence(state) {
  if (!state || typeof state !== "object") return state;

  // Deep clone to avoid mutation
  const next = JSON.parse(JSON.stringify(state));

  // Strip pull secrets (ephemeral fields)
  if (next?.blueprint && "blueprintPullSecretEphemeral" in next.blueprint) {
    delete next.blueprint.blueprintPullSecretEphemeral;
  }
  if (next?.credentials) {
    delete next.credentials.pullSecretPlaceholder;
    delete next.credentials.mirrorRegistryPullSecret;
    delete next.credentials.operatorPullSecret;
  }

  // Strip SSH private key (public key is not a secret)
  if (next?.credentials && "sshPrivateKey" in next.credentials) {
    delete next.credentials.sshPrivateKey;
  }

  // Strip platform credentials (vSphere, Nutanix, AWS, Azure, etc.)
  if (next?.platformConfig) {
    // vSphere
    if (next.platformConfig.vsphere) {
      delete next.platformConfig.vsphere.username;
      delete next.platformConfig.vsphere.password;

      if (Array.isArray(next.platformConfig.vsphere.vcenters)) {
        next.platformConfig.vsphere.vcenters = next.platformConfig.vsphere.vcenters.map((vc) => {
          const sanitized = { ...vc };
          delete sanitized.user;
          delete sanitized.username;
          delete sanitized.password;
          return sanitized;
        });
      }
    }

    // Nutanix/Prism
    if (next.platformConfig.nutanix) {
      delete next.platformConfig.nutanix.username;
      delete next.platformConfig.nutanix.password;
      delete next.platformConfig.nutanix.prismUsername;
      delete next.platformConfig.nutanix.prismPassword;
    }

    // AWS
    if (next.platformConfig.aws) {
      delete next.platformConfig.aws.accessKeyId;
      delete next.platformConfig.aws.secretAccessKey;
    }

    // Azure
    if (next.platformConfig.azure) {
      delete next.platformConfig.azure.clientSecret;
    }

    // IBM Cloud
    if (next.platformConfig.ibmcloud) {
      delete next.platformConfig.ibmcloud.apiKey;
    }
  }

  // Strip BMC credentials from host inventory
  if (next?.hostInventory?.nodes && Array.isArray(next.hostInventory.nodes)) {
    next.hostInventory.nodes = next.hostInventory.nodes.map((node) => {
      const sanitized = { ...node };
      if (sanitized.bmc) {
        const bmcSanitized = { ...sanitized.bmc };
        delete bmcSanitized.username;
        delete bmcSanitized.password;
        sanitized.bmc = bmcSanitized;
      }
      // Also check top-level BMC fields
      delete sanitized.bmcUsername;
      delete sanitized.bmcPassword;
      return sanitized;
    });
  }

  // Strip proxy credentials from URLs
  if (next?.globalStrategy?.proxies) {
    const proxies = next.globalStrategy.proxies;
    if (proxies.httpProxy) {
      proxies.httpProxy = stripProxyCredentials(proxies.httpProxy);
    }
    if (proxies.httpsProxy) {
      proxies.httpsProxy = stripProxyCredentials(proxies.httpsProxy);
    }
  }

  // Strip registry credentials
  if (next?.mirrorRegistry) {
    delete next.mirrorRegistry.username;
    delete next.mirrorRegistry.password;
    delete next.mirrorRegistry.auth;
    delete next.mirrorRegistry.auths;
  }

  // Recursive sanitization to catch any other credential fields
  // This is defense in depth for nested or unknown credential structures
  return sanitizeCredentialFields(next);
}
