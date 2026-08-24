/**
 * Field Guide Version Resolution (FG-4.21-B)
 *
 * Sole version policy and resolution module for Field Guide rendering.
 * Collects, validates, and reconciles all recognized version sources
 * from application state before any Field Guide rendering occurs.
 *
 * @module backend/src/fieldGuide/versionResolution
 */

import { getMinorVersion, normalizeVersion } from '../../../shared/versionUtils.js';

const FIELD_GUIDE_SUPPORTED_MINORS = Object.freeze(["4.20", "4.21"]);

const CHANNEL_PREFIX_RE = /^stable-/i;

function extractMinorFromStableChannel(channel) {
  if (typeof channel !== 'string') return null;
  const trimmed = channel.trim();
  if (!trimmed) return null;
  if (!CHANNEL_PREFIX_RE.test(trimmed)) return null;
  const versionPart = trimmed.replace(CHANNEL_PREFIX_RE, '');
  return getMinorVersion(versionPart);
}

function extractMinorFromLegacyChannel(channel) {
  if (typeof channel !== 'string') return null;
  const trimmed = channel.trim();
  if (!trimmed) return null;
  let versionPart = trimmed;
  if (CHANNEL_PREFIX_RE.test(trimmed)) {
    versionPart = trimmed.replace(CHANNEL_PREFIX_RE, '');
  }
  try {
    return getMinorVersion(versionPart);
  } catch {
    return null;
  }
}

function validateMinorField(value) {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') {
    throw new FieldGuideVersionError(
      `Field Guide version field has invalid type: expected string, got ${typeof value}`
    );
  }
  const trimmed = value.trim();
  if (!trimmed) return null;
  const minor = getMinorVersion(trimmed);
  if (minor !== trimmed) {
    throw new FieldGuideVersionError(
      `Field Guide version minor field "${value}" is not a minor version form`
    );
  }
  return minor;
}

function validatePatchField(value) {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') {
    throw new FieldGuideVersionError(
      `Field Guide version patch field has invalid type: expected string, got ${typeof value}`
    );
  }
  const trimmed = value.trim();
  if (!trimmed) return null;
  const normalized = normalizeVersion(trimmed);
  const parts = normalized.split('.');
  if (parts.length !== 3 || parts[2] === undefined) {
    throw new FieldGuideVersionError(
      `Field Guide version patch field "${value}" is not a valid patch version`
    );
  }
  return normalized;
}

function validateChannelField(value) {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') {
    throw new FieldGuideVersionError(
      `Field Guide version channel field has invalid type: expected string, got ${typeof value}`
    );
  }
  const trimmed = value.trim();
  if (!trimmed) return null;
  const minor = extractMinorFromStableChannel(trimmed);
  if (!minor) {
    throw new FieldGuideVersionError(
      `Field Guide version channel "${value}" is not a valid stable-<minor> channel`
    );
  }
  return { channel: `stable-${minor}`, minor };
}

function validateLegacyChannelField(value) {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') {
    throw new FieldGuideVersionError(
      `Field Guide version channel field has invalid type: expected string, got ${typeof value}`
    );
  }
  const trimmed = value.trim();
  if (!trimmed) return null;
  const minor = extractMinorFromLegacyChannel(trimmed);
  if (!minor) {
    throw new FieldGuideVersionError(
      `Field Guide release.channel "${value}" is not a valid channel`
    );
  }
  return { channel: `stable-${minor}`, minor };
}

class FieldGuideVersionError extends Error {
  constructor(message) {
    super(message);
    this.name = 'FieldGuideVersionError';
    this.code = 'FIELD_GUIDE_VERSION_ERROR';
  }
}

function collectSources(state) {
  const version = state?.version;
  const release = state?.release;

  const canonical = {
    selectedMinor: version?.selectedMinor !== undefined ? version.selectedMinor : null,
    selectedPatch: version?.selectedPatch !== undefined ? version.selectedPatch : null,
    selectedChannel: version?.selectedChannel !== undefined ? version.selectedChannel : null,
  };

  const legacy = {
    patchVersion: release?.patchVersion !== undefined ? release.patchVersion : null,
    channel: release?.channel !== undefined ? release.channel : null,
    selectedVersion: version?.selectedVersion !== undefined ? version.selectedVersion : null,
    releaseSelectedVersion: release?.selectedVersion !== undefined ? release.selectedVersion : null,
  };

  return { canonical, legacy };
}

function hasCanonicalState(state) {
  const version = state?.version;
  if (!version || typeof version !== 'object') return false;
  return (
    version.selectedMinor !== undefined ||
    version.selectedPatch !== undefined ||
    version.selectedChannel !== undefined ||
    version.locked !== undefined
  );
}

function resolveFieldGuideVersion(state) {
  const { canonical, legacy } = collectSources(state);
  const canonicalPresent = hasCanonicalState(state);

  if (canonicalPresent) {
    const version = state.version;
    if (version.locked !== true) {
      throw new FieldGuideVersionError(
        'Field Guide requires a locked version selection (version.locked must be true)'
      );
    }
  }

  const resolvedMinors = [];
  let resolvedPatch = null;
  let resolvedChannel = null;

  // --- Canonical sources ---
  if (canonical.selectedMinor != null) {
    const minor = validateMinorField(canonical.selectedMinor);
    if (minor) {
      if (!FIELD_GUIDE_SUPPORTED_MINORS.includes(minor)) {
        throw new FieldGuideVersionError(
          `OpenShift ${minor} is not supported for Field Guide generation. ` +
          `Supported versions: ${FIELD_GUIDE_SUPPORTED_MINORS.join(', ')}`
        );
      }
      resolvedMinors.push({ source: 'version.selectedMinor', minor });
    }
  }

  if (canonical.selectedPatch != null) {
    const patch = validatePatchField(canonical.selectedPatch);
    if (patch) {
      const minor = getMinorVersion(patch);
      if (!FIELD_GUIDE_SUPPORTED_MINORS.includes(minor)) {
        throw new FieldGuideVersionError(
          `OpenShift ${minor} (from patch ${patch}) is not supported for Field Guide generation. ` +
          `Supported versions: ${FIELD_GUIDE_SUPPORTED_MINORS.join(', ')}`
        );
      }
      resolvedMinors.push({ source: 'version.selectedPatch', minor });
      resolvedPatch = patch;
    }
  }

  if (canonical.selectedChannel != null) {
    const channelResult = validateChannelField(canonical.selectedChannel);
    if (channelResult) {
      if (!FIELD_GUIDE_SUPPORTED_MINORS.includes(channelResult.minor)) {
        throw new FieldGuideVersionError(
          `OpenShift ${channelResult.minor} (from channel ${channelResult.channel}) is not supported for Field Guide generation. ` +
          `Supported versions: ${FIELD_GUIDE_SUPPORTED_MINORS.join(', ')}`
        );
      }
      resolvedMinors.push({ source: 'version.selectedChannel', minor: channelResult.minor });
      resolvedChannel = channelResult.channel;
    }
  }

  // --- Legacy sources ---
  if (legacy.patchVersion != null) {
    const patch = validatePatchField(legacy.patchVersion);
    if (patch) {
      const minor = getMinorVersion(patch);
      if (!FIELD_GUIDE_SUPPORTED_MINORS.includes(minor)) {
        throw new FieldGuideVersionError(
          `OpenShift ${minor} (from release.patchVersion ${patch}) is not supported for Field Guide generation. ` +
          `Supported versions: ${FIELD_GUIDE_SUPPORTED_MINORS.join(', ')}`
        );
      }
      resolvedMinors.push({ source: 'release.patchVersion', minor });
      if (!resolvedPatch) resolvedPatch = patch;
    }
  }

  if (legacy.channel != null) {
    const channelResult = validateLegacyChannelField(legacy.channel);
    if (channelResult) {
      if (!FIELD_GUIDE_SUPPORTED_MINORS.includes(channelResult.minor)) {
        throw new FieldGuideVersionError(
          `OpenShift ${channelResult.minor} (from release.channel) is not supported for Field Guide generation. ` +
          `Supported versions: ${FIELD_GUIDE_SUPPORTED_MINORS.join(', ')}`
        );
      }
      resolvedMinors.push({ source: 'release.channel', minor: channelResult.minor });
      if (!resolvedChannel) resolvedChannel = channelResult.channel;
    }
  }

  if (legacy.selectedVersion != null) {
    const patch = validatePatchField(legacy.selectedVersion);
    if (patch) {
      const minor = getMinorVersion(patch);
      if (!FIELD_GUIDE_SUPPORTED_MINORS.includes(minor)) {
        throw new FieldGuideVersionError(
          `OpenShift ${minor} (from version.selectedVersion ${patch}) is not supported for Field Guide generation. ` +
          `Supported versions: ${FIELD_GUIDE_SUPPORTED_MINORS.join(', ')}`
        );
      }
      resolvedMinors.push({ source: 'version.selectedVersion', minor });
      if (!resolvedPatch) resolvedPatch = patch;
    }
  }

  if (legacy.releaseSelectedVersion != null) {
    const patch = validatePatchField(legacy.releaseSelectedVersion);
    if (patch) {
      const minor = getMinorVersion(patch);
      if (!FIELD_GUIDE_SUPPORTED_MINORS.includes(minor)) {
        throw new FieldGuideVersionError(
          `OpenShift ${minor} (from release.selectedVersion ${patch}) is not supported for Field Guide generation. ` +
          `Supported versions: ${FIELD_GUIDE_SUPPORTED_MINORS.join(', ')}`
        );
      }
      resolvedMinors.push({ source: 'release.selectedVersion', minor });
      if (!resolvedPatch) resolvedPatch = patch;
    }
  }

  // --- No sources at all ---
  if (resolvedMinors.length === 0) {
    throw new FieldGuideVersionError(
      'Field Guide generation requires a version selection. No recognized version source found in state.'
    );
  }

  // --- Reconciliation: all sources must agree on one minor ---
  const uniqueMinors = [...new Set(resolvedMinors.map(r => r.minor))];
  if (uniqueMinors.length > 1) {
    const details = resolvedMinors.map(r => `${r.source}=${r.minor}`).join(', ');
    throw new FieldGuideVersionError(
      `Field Guide version conflict: sources resolve to different minors (${details}). ` +
      `All version sources must agree.`
    );
  }

  const minor = uniqueMinors[0];
  const channel = resolvedChannel || `stable-${minor}`;
  const displayVersion = resolvedPatch || minor;

  return Object.freeze({
    minor,
    patch: resolvedPatch || null,
    channel,
    displayVersion,
  });
}

export { FIELD_GUIDE_SUPPORTED_MINORS, resolveFieldGuideVersion, FieldGuideVersionError };
