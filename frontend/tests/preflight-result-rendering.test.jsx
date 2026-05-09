/**
 * Tests for preflight result message rendering logic.
 * Ensures success/warning messages don't conflict.
 *
 * @author Bill Strauss
 * Developed with AI assistance from Claude (Anthropic) and Cursor AI.
 */

import { describe, it, expect } from 'vitest';

describe('Preflight result rendering logic', () => {
  it('should show success message when ok=true and no warnings', () => {
    const preflightResult = {
      ok: true,
      blockers: [],
      warnings: [],
      checks: {},
      fieldErrors: {}
    };

    const shouldShowSuccess = preflightResult.ok && (!preflightResult.warnings || preflightResult.warnings.length === 0);
    const shouldShowWarningAck = preflightResult.ok && preflightResult.warnings?.length > 0;

    expect(shouldShowSuccess).toBe(true);
    expect(shouldShowWarningAck).toBe(false);
  });

  it('should show warning acknowledgment when ok=true but has warnings', () => {
    const preflightResult = {
      ok: true,
      blockers: [],
      warnings: ['Red Hat pull secret is required to pull from registry.redhat.io / quay.io.'],
      checks: {},
      fieldErrors: {}
    };

    const shouldShowSuccess = preflightResult.ok && (!preflightResult.warnings || preflightResult.warnings.length === 0);
    const shouldShowWarningAck = preflightResult.ok && preflightResult.warnings?.length > 0;

    expect(shouldShowSuccess).toBe(false);
    expect(shouldShowWarningAck).toBe(true);
  });

  it('should show neither message when ok=false with blockers', () => {
    const preflightResult = {
      ok: false,
      blockers: ['Archive path is required.'],
      warnings: [],
      checks: {},
      fieldErrors: {}
    };

    const shouldShowSuccess = preflightResult.ok && (!preflightResult.warnings || preflightResult.warnings.length === 0);
    const shouldShowWarningAck = preflightResult.ok && preflightResult.warnings?.length > 0;

    expect(shouldShowSuccess).toBe(false);
    expect(shouldShowWarningAck).toBe(false);
  });

  it('should show neither message when ok=false with both blockers and warnings', () => {
    const preflightResult = {
      ok: false,
      blockers: ['Archive path is required.'],
      warnings: ['Red Hat pull secret is required to pull from registry.redhat.io / quay.io.'],
      checks: {},
      fieldErrors: {}
    };

    const shouldShowSuccess = preflightResult.ok && (!preflightResult.warnings || preflightResult.warnings.length === 0);
    const shouldShowWarningAck = preflightResult.ok && preflightResult.warnings?.length > 0;

    expect(shouldShowSuccess).toBe(false);
    expect(shouldShowWarningAck).toBe(false);
  });

  it('should handle undefined warnings array gracefully', () => {
    const preflightResult = {
      ok: true,
      blockers: [],
      warnings: undefined,
      checks: {},
      fieldErrors: {}
    };

    const shouldShowSuccess = preflightResult.ok && (!preflightResult.warnings || preflightResult.warnings.length === 0);
    const shouldShowWarningAck = preflightResult.ok && preflightResult.warnings?.length > 0;

    expect(shouldShowSuccess).toBe(true);
    expect(shouldShowWarningAck).toBe(false);
  });
});
