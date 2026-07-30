/**
 * OpenShift Airgap Architect - IDMS/ITMS Parser
 *
 * **Feature:** Run inside mirror operator collection bundle
 *
 * Parses ImageDigestMirrorSet (IDMS) and ImageTagMirrorSet (ITMS) YAML files generated
 * by oc-mirror during the mirroring process on the low-side. These files define which
 * upstream container images were mirrored to the local registry and where they're located.
 *
 * Extracted mirror sources are written to install-config.yaml's imageDigestSources field,
 * ensuring the OpenShift installer and cluster know where to pull images from the local
 * mirror registry instead of trying to reach the internet.
 *
 * **IDMS (ImageDigestMirrorSet):**
 * - Maps digest-based upstream sources to mirror registry paths
 * - Used for OpenShift release images and core components
 * - Example: quay.io/openshift-release-dev/ocp-release → registry.local:8443/openshift/release
 *
 * **ITMS (ImageTagMirrorSet):**
 * - Maps tag-based upstream sources to mirror registry paths
 * - Used for operator images and Red Hat UBI/RHEL images
 * - Example: registry.redhat.io/ubi9 → registry.local:8443/ubi9
 *
 * Both IDMS and ITMS sources are combined into a single array for install-config.yaml.
 *
 * @see docs/MIRROR_OPERATOR_BUNDLE_WORKFLOW.md - Complete user guide
 * @see CLAUDE.md - Developer documentation (Mirror Operator Bundle Workflow section)
 *
 * @author Bill Strauss
 *
 * Developed with AI assistance from Claude (Anthropic) and Cursor AI.
 */

import fs from 'node:fs';
import yaml from 'js-yaml';
import logger from './logger.js';

/**
 * Parses IDMS (ImageDigestMirrorSet) YAML file and extracts mirror sources.
 *
 * IDMS format:
 * ```yaml
 * apiVersion: config.openshift.io/v1
 * kind: ImageDigestMirrorSet
 * metadata:
 *   name: oc-mirror
 * spec:
 *   imageDigestMirrors:
 *     - source: quay.io/openshift-release-dev/ocp-release
 *       mirrors:
 *         - registry.example.com:8443/openshift/release
 * ```
 *
 * @param {string} filePath - Path to IDMS YAML file
 * @returns {Array<{source: string, mirrors: string[]}>} Array of mirror sources
 */
export function parseIdmsFile(filePath) {
  if (!filePath) return [];

  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const docs = yaml.loadAll(raw);

    const sources = [];
    for (const doc of docs) {
      if (doc?.kind !== 'ImageDigestMirrorSet') continue;
      const mirrors = doc?.spec?.imageDigestMirrors;
      if (!Array.isArray(mirrors)) continue;
      for (const m of mirrors) {
        sources.push({
          source: m.source,
          mirrors: Array.isArray(m.mirrors) ? m.mirrors : []
        });
      }
    }

    if (sources.length === 0) {
      logger.warn({ tag: 'startup', filePath }, 'IDMS file has no ImageDigestMirrorSet documents with imageDigestMirrors');
      return [];
    }

    logger.info({ tag: 'startup', filePath, count: sources.length }, 'Parsed IDMS file successfully');
    return sources;
  } catch (err) {
    if (err.code === 'ENOENT') {
      logger.warn({ tag: 'startup', filePath }, 'IDMS file not found');
    } else if (err instanceof yaml.YAMLException) {
      logger.warn({ tag: 'startup', err: err.message, filePath }, 'IDMS file is not valid YAML');
    } else {
      logger.warn({ tag: 'startup', err, filePath }, 'Failed to parse IDMS file');
    }
    return [];
  }
}

/**
 * Parses ITMS (ImageTagMirrorSet) YAML file and extracts mirror sources.
 *
 * ITMS format:
 * ```yaml
 * apiVersion: config.openshift.io/v1
 * kind: ImageTagMirrorSet
 * metadata:
 *   name: oc-mirror
 * spec:
 *   imageTagMirrors:
 *     - source: registry.redhat.io/...
 *       mirrors:
 *         - registry.example.com:8443/...
 * ```
 *
 * @param {string} filePath - Path to ITMS YAML file
 * @returns {Array<{source: string, mirrors: string[]}>} Array of mirror sources
 */
export function parseItmsFile(filePath) {
  if (!filePath) return [];

  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const docs = yaml.loadAll(raw);

    const sources = [];
    for (const doc of docs) {
      if (doc?.kind !== 'ImageTagMirrorSet') continue;
      const mirrors = doc?.spec?.imageTagMirrors;
      if (!Array.isArray(mirrors)) continue;
      for (const m of mirrors) {
        sources.push({
          source: m.source,
          mirrors: Array.isArray(m.mirrors) ? m.mirrors : []
        });
      }
    }

    if (sources.length === 0) {
      logger.warn({ tag: 'startup', filePath }, 'ITMS file has no ImageTagMirrorSet documents with imageTagMirrors');
      return [];
    }

    logger.info({ tag: 'startup', filePath, count: sources.length }, 'Parsed ITMS file successfully');
    return sources;
  } catch (err) {
    if (err.code === 'ENOENT') {
      logger.warn({ tag: 'startup', filePath }, 'ITMS file not found');
    } else if (err instanceof yaml.YAMLException) {
      logger.warn({ tag: 'startup', err: err.message, filePath }, 'ITMS file is not valid YAML');
    } else {
      logger.warn({ tag: 'startup', err, filePath }, 'Failed to parse ITMS file');
    }
    return [];
  }
}

/**
 * Loads mirror sources from IDMS and ITMS files.
 * Combines both into a single array of sources.
 *
 * @param {string} idmsPath - Path to IDMS YAML file (optional)
 * @param {string} itmsPath - Path to ITMS YAML file (optional)
 * @returns {Array<{source: string, mirrors: string[]}>} Combined array of mirror sources
 */
export function loadMirrorSources(idmsPath, itmsPath) {
  const idmsSources = parseIdmsFile(idmsPath);
  const itmsSources = parseItmsFile(itmsPath);

  const combined = [...idmsSources, ...itmsSources];

  if (combined.length > 0) {
    logger.info({ tag: 'startup', idmsCount: idmsSources.length, itmsCount: itmsSources.length, total: combined.length }, 'Loaded mirror sources from IDMS/ITMS files');
  }

  return combined;
}
