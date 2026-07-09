/**
 * OpenShift Airgap Architect - Mirror Registry Config Loader
 *
 * **Feature:** Run inside mirror operator collection bundle
 *
 * Loads mirror registry configuration from mounted file at backend startup for high-side
 * (air-gapped) deployments. This enables a two-side workflow:
 *
 * Low-side (connected): Mirror OpenShift content, generate config files
 * High-side (air-gapped): Deploy wizard with mounted configs, wizard auto-populates everything
 *
 * When MIRROR_REGISTRY_CONFIG environment variable is set:
 * - Auto-generates pull secret from username/password (base64 encoded)
 * - Auto-loads CA certificate from caCertPath file
 * - Extracts mirror sources from IDMS/ITMS YAML files
 * - Returns {pullSecret, state} to separate ephemeral credential from persisted state
 *
 * Pull secret is stored in memory-only (mountedMirrorPullSecret variable in index.js),
 * never persisted to database, and injected at runtime when serving state or generating YAML.
 *
 * Follows pattern similar to mounted Red Hat pull secret detection (index.js lines 247-269).
 *
 * @see docs/MIRROR_OPERATOR_BUNDLE_WORKFLOW.md - Complete user guide
 * @see CLAUDE.md - Developer documentation (Mirror Operator Bundle Workflow section)
 *
 * @author Bill Strauss
 *
 * Developed with AI assistance from Claude (Anthropic) and Cursor AI.
 */

import fs from 'node:fs';
import logger from './logger.js';
import { loadMirrorSources } from './idmsParser.js';

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
 *   "idmsPath": "/path/to/idms-oc-mirror.yaml",
 *   "itmsPath": "/path/to/itms-oc-mirror.yaml",
 *   "sslType": "self-signed",
 *   "installedAt": "2026-07-08T15:58:54Z",
 *   "dataPath": "/opt/quay",
 *   "type": "quay"
 * }
 *
 * @returns {Object|null} Object with {state, pullSecret} or null if config not found/invalid
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

    // Load mirror sources from IDMS/ITMS files if provided
    const sources = loadMirrorSources(config.idmsPath, config.itmsPath);
    const hasMirrorSources = sources.length > 0;

    // If no IDMS/ITMS files, use default sources with actual registry FQDN
    const mirrorSources = hasMirrorSources ? sources : [
      { source: "quay.io/openshift-release-dev/ocp-release", mirrors: [`${registryFqdn}/ocp-release`] },
      { source: "quay.io/openshift-release-dev/ocp-v4.0-art-dev", mirrors: [`${registryFqdn}/ocp-v4.0-art-dev`] }
    ];

    logger.info({
      tag: 'startup',
      registryFqdn,
      username: config.username,
      hasCaCert: !!caPem,
      tlsVerify: config.tlsVerify !== false, // Log if TLS verification is disabled
      sourcesCount: mirrorSources.length,
      sourcesFrom: hasMirrorSources ? 'IDMS/ITMS' : 'defaults'
    }, 'Mirror registry config loaded successfully');

    return {
      pullSecret: pullSecret, // Return separately to store in memory, not in database
      state: {
        credentials: {
          usingMirrorRegistry: true,
          mirrorRegistryUnauthenticated: false
          // mirrorRegistryPullSecret intentionally omitted - stored in memory only
        },
        trust: {
          mirrorRegistryUsesPrivateCa: !!caPem,
          mirrorRegistryCaPem: caPem
        },
        globalStrategy: {
          mirroring: {
            registryFqdn: registryFqdn,
            sources: mirrorSources
          }
        },
        ui: {
          mirrorConfigPreloaded: true
        }
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
