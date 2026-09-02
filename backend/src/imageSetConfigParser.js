/**
 * OpenShift Airgap Architect - ImageSet Config Parser
 *
 * **Feature:** Run inside mirror operator collection bundle
 *
 * Loads imageset-config.yaml from mirror operator collection bundle and extracts OpenShift
 * version information. This pre-populates the Blueprint step with the mirrored version,
 * ensuring the wizard generates configs for the exact OpenShift version that was mirrored
 * on the low-side.
 *
 * When IMAGESET_CONFIG environment variable is set:
 * - Parses mirror.platform.channels array to extract channel name and version
 * - Supports minVersion, maxVersion, or shortestPath version fields
 * - Uses first channel if multiple channels are defined
 * - Sets blueprint.mirrorBundleDetected flag to show "Pre-configured" badge
 *
 * **Example imageset-config.yaml structure:**
 * ```yaml
 * kind: ImageSetConfiguration
 * apiVersion: mirror.openshift.io/v1alpha2
 * mirror:
 *   platform:
 *     channels:
 *       - name: stable-4.14
 *         minVersion: 4.14.10
 *         maxVersion: 4.14.15
 * ```
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
 * Loads imageset-config.yaml and extracts OpenShift version information.
 * Returns state augmentation object or null if config not found/invalid.
 *
 * ImageSet config format (YAML):
 * ```yaml
 * apiVersion: mirror.openshift.io/v1alpha2
 * kind: ImageSetConfiguration
 * mirror:
 *   platform:
 *     channels:
 *       - name: stable-4.14
 *         minVersion: 4.14.20
 *         maxVersion: 4.14.30
 * ```
 *
 * @returns {Object|null} State augmentation object or null if config not found/invalid
 */
export function loadImageSetConfig() {
  const configPath = process.env.IMAGESET_CONFIG;
  if (!configPath) {
    logger.debug({ tag: 'startup' }, 'IMAGESET_CONFIG not set, skipping imageset config preload');
    return null;
  }

  try {
    const raw = fs.readFileSync(configPath, 'utf8');
    const config = yaml.load(raw);

    // Validate structure
    if (!config || typeof config !== 'object') {
      logger.warn({ tag: 'startup', configPath }, 'ImageSet config is not a valid YAML object');
      return null;
    }

    // Extract version from mirror.platform.channels
    const channels = config?.mirror?.platform?.channels;
    if (!Array.isArray(channels) || channels.length === 0) {
      logger.warn({ tag: 'startup', configPath }, 'ImageSet config has no platform channels');
      return null;
    }

    // Use the first channel and extract version information
    const channel = channels[0];
    const channelName = channel.name; // e.g., "stable-4.14"

    if (!channelName || typeof channelName !== 'string') {
      logger.warn({ tag: 'startup', configPath }, 'ImageSet config channel missing name field');
      return null;
    }

    // Extract version - prefer minVersion, fallback to maxVersion or shortestPath
    const version = channel.minVersion || channel.maxVersion || channel.shortestPath;

    if (!version) {
      logger.warn({ tag: 'startup', configPath, channelName }, 'ImageSet config channel has no version specified');
      return null;
    }

    logger.info({
      tag: 'startup',
      configPath,
      channelName,
      version,
      channelCount: channels.length
    }, 'ImageSet config loaded successfully');

    return {
      release: {
        channel: channelName,
        patchVersion: version
      },
      version: {
        selectedChannel: channelName,
        selectedVersion: version
      },
      blueprint: {
        mirrorBundleDetected: true
      },
      mirrorWorkflow: {
        configSourceType: 'custom',
        configPath: configPath
      }
    };
  } catch (err) {
    if (err.code === 'ENOENT') {
      logger.warn({ tag: 'startup', configPath }, 'ImageSet config file not found');
    } else if (err instanceof yaml.YAMLException) {
      logger.warn({ tag: 'startup', err: err.message, configPath }, 'ImageSet config is not valid YAML');
    } else {
      logger.warn({ tag: 'startup', err, configPath }, 'Failed to load ImageSet config');
    }
    return null;
  }
}
