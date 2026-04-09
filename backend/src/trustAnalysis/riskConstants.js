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

// Selected reduced bundle guardrails.
// caution: warn + explicit user acknowledgment
// hardMax: backend-enforced rejection for reduced-mode generation
export const REDUCED_SELECTION_THRESHOLDS = {
  cautionBytes: 128 * 1024,
  hardMaxBytes: 512 * 1024,
  cautionCertCount: 40,
  hardMaxCertCount: 160
};

