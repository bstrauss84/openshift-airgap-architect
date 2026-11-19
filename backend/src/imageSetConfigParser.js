/**
 * OpenShift Airgap Architect - ImageSet Config Parser
 *
 * Loads imageset-config.yaml and extracts OpenShift version information.
 * Parses mirror.platform.channels to pre-populate Blueprint step version selection.
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
