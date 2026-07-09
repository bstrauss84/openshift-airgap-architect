/**
 * OpenShift Airgap Architect - Mirror Registry Config Loader
 *
 * Loads mirror registry configuration from mounted file at backend startup.
 * Auto-generates pull secret from username/password and loads CA certificate PEM.
 * Follows pattern similar to mounted Red Hat pull secret detection (index.js lines 247-269).
 *
 * @author Bill Strauss
 *
 * Developed with AI assistance from Claude (Anthropic) and Cursor AI.
 */

import fs from 'node:fs';
import logger from './logger.js';

/**
 * Loads mirror registry configuration from mounted file.
 * Returns augmented state fields or null if config not found/invalid.
 *
 * Config file format (JSON):
 * {
 *   "url": "https://registry.example.com:8443",
 *   "hostname": "registry.example.com",
 *   "port": 8443,
 *   "username": "admin",
 *   "password": "secret",
 *   "tlsVerify": false,
 *   "caCertPath": "/path/to/ca.pem",
 *   "sslType": "self-signed",
 *   "installedAt": "2026-07-08T15:58:54Z",
 *   "dataPath": "/opt/quay",
 *   "type": "quay"
 * }
 *
 * @returns {Object|null} State augmentation object or null if config not found/invalid
 */
export function loadMirrorRegistryConfig() {
  const configPath = process.env.MIRROR_REGISTRY_CONFIG;
  if (!configPath) {
    logger.debug({ tag: 'startup' }, 'MIRROR_REGISTRY_CONFIG not set, skipping mirror config preload');
    return null;
  }

  try {
    const raw = fs.readFileSync(configPath, 'utf8');
    const config = JSON.parse(raw);

    // Validate required fields
    if (!config.hostname || !config.port) {
      logger.warn({ tag: 'startup', configPath }, 'Mirror registry config missing required fields (hostname, port)');
      return null;
    }

    // Username/password required for pull secret generation
    if (!config.username || !config.password) {
      logger.warn({ tag: 'startup', configPath }, 'Mirror registry config missing credentials (username, password)');
      return null;
    }

    // Auto-generate pull secret from credentials
    const pullSecret = generatePullSecretFromConfig(config);

    // Auto-load CA certificate if path provided
    let caPem = "";
    if (config.caCertPath) {
      try {
        caPem = fs.readFileSync(config.caCertPath, 'utf8').trim();
        logger.info({ tag: 'startup', caCertPath: config.caCertPath, bytes: caPem.length }, 'Loaded mirror registry CA certificate');
      } catch (err) {
        logger.warn({ tag: 'startup', err, caCertPath: config.caCertPath }, 'Failed to load CA certificate, proceeding without it');
        // Don't fail the entire config load if CA cert is missing - it might be trusted via system roots
      }
    }

    // Build registry FQDN from hostname:port
    const registryFqdn = `${config.hostname}:${config.port}`;

    logger.info({
      tag: 'startup',
      registryFqdn,
      username: config.username,
      hasCaCert: !!caPem,
      tlsVerify: config.tlsVerify !== false // Log if TLS verification is disabled
    }, 'Mirror registry config loaded successfully');

    return {
      credentials: {
        usingMirrorRegistry: true,
        mirrorRegistryPullSecret: pullSecret,
        mirrorRegistryUnauthenticated: false
      },
      trust: {
        mirrorRegistryUsesPrivateCa: !!caPem,
        mirrorRegistryCaPem: caPem
      },
      globalStrategy: {
        mirroring: {
          registryFqdn: registryFqdn
        }
      },
      ui: {
        mirrorConfigPreloaded: true
      }
    };
  } catch (err) {
    if (err.code === 'ENOENT') {
      logger.warn({ tag: 'startup', configPath }, 'Mirror registry config file not found');
    } else if (err instanceof SyntaxError) {
      logger.warn({ tag: 'startup', err, configPath }, 'Mirror registry config is not valid JSON');
    } else {
      logger.warn({ tag: 'startup', err, configPath }, 'Failed to load mirror registry config');
    }
    return null;
  }
}

/**
 * Generates a pull secret JSON from mirror registry config credentials.
 * Pull secret format matches Docker/Podman config.json format.
 *
 * @param {Object} config - Mirror registry config object
 * @param {string} config.hostname - Registry hostname
 * @param {number} config.port - Registry port
 * @param {string} config.username - Registry username
 * @param {string} config.password - Registry password
 * @param {string} [config.email] - Optional email for pull secret
 * @returns {string} Pull secret JSON string
 */
function generatePullSecretFromConfig(config) {
  // Base64 encode username:password for auth field
  const auth = Buffer.from(`${config.username}:${config.password}`).toString('base64');

  const registryKey = `${config.hostname}:${config.port}`;

  const pullSecret = {
    auths: {
      [registryKey]: {
        auth: auth,
        email: config.email || ""
      }
    }
  };

  return JSON.stringify(pullSecret);
}
