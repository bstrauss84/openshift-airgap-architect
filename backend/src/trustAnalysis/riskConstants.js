export const TRUST_ANALYSIS_SCHEMA_VERSION = 1;

// Warn-only heuristic defaults; tune with real-world usage data.
export const RISK_SCORING_DEFAULTS = {
  certCount: { medium: 10, high: 25, dangerous: 50 },
  bundleBytes: { medium: 32 * 1024, high: 96 * 1024, dangerous: 256 * 1024 },
  lineCount: { medium: 600, high: 1800 },
  unrelatedClusterCount: { medium: 2, high: 4 },
  malformedCount: { any: 1, high: 5 },
  leafCount: { medium: 1, high: 5 },
  chainAmbiguityCount: { medium: 1, high: 3 },
  duplicateNoiseCount: { noisy: 5 }
};

export const RISK_BANDS = {
  minimal: { min: 0, max: 2 },
  moderate: { min: 3, max: 6 },
  oversized: { min: 7, max: 11 },
  dangerous: { min: 12, max: Number.POSITIVE_INFINITY }
};

// UI interaction tuning defaults, intentionally centralized and adjustable.
export const ANALYSIS_TRIGGER_DEFAULTS = {
  explicitAnalyzeBytesThreshold: 128 * 1024,
  explicitAnalyzeCertsThreshold: 40,
  debounceMs: 1000
};

/**
 * Selected reduced bundle guardrails.
 *
 * Background: Kubernetes ConfigMap limit is ~1MB (1048576 bytes).
 * install-config.yaml includes other fields (~10-20KB overhead).
 * The trust bundle field is base64-encoded when stored in YAML, adding ~33% size overhead.
 *
 * Calculation for safe maximum:
 * - ConfigMap limit: 1024KB
 * - install-config.yaml overhead: ~20KB (cluster config, networking, etc.)
 * - Available for trust bundle: ~1000KB
 * - After base64 encoding (33% overhead): ~1000KB / 1.33 = ~750KB raw PEM safe max
 * - Conservative hard limit to prevent edge cases: 650KB
 *
 * Thresholds:
 * - caution: warn user + require explicit acknowledgment (still allows export)
 * - hardMax: backend-enforced rejection for reduced-mode generation (prevents install failure)
 */
export const REDUCED_SELECTION_THRESHOLDS = {
  cautionBytes: 256 * 1024,    // 256KB - warn user to review bundle
  hardMaxBytes: 650 * 1024,    // 650KB - reject to prevent ConfigMap overflow & install failure
  cautionCertCount: 60,         // Typical enterprise CA chains: 20-40 certs; warn above this
  hardMaxCertCount: 200         // Extreme outlier cases only
};

/**
 * Calculate safe maximum bytes accounting for ConfigMap limit and encoding overhead.
 * @param {number} installConfigOverhead - Estimated size of other install-config.yaml fields (default 20KB)
 * @returns {number} Safe maximum bytes for raw PEM trust bundle
 */
export const calculateSafeMaxBytes = (installConfigOverhead = 20 * 1024) => {
  const configMapLimit = 1024 * 1024; // 1MB Kubernetes ConfigMap limit
  const base64Overhead = 1.33; // Base64 encoding adds ~33% size
  return Math.floor((configMapLimit - installConfigOverhead) / base64Overhead);
};

