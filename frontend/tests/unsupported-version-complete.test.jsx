/**
 * Test: Complete Unsupported Version Recovery (DOC-102 Slice 5F.13)
 *
 * Verifies all unsupported version boundaries work correctly:
 * 1. VersionSupportGate blocks AppShell mount for 4.22
 * 2. Manual 4.22 entry is rejected with clear error
 * 3. Cincinnati channel classification separates newer vs older
 * 4. Auto-selection never picks 4.22
 * 5. Persisted 4.22 shows recovery UI (not generic error)
 */

import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import App from '../src/App.jsx';
import { validateManualOpenShiftRelease } from '../src/validation.js';
import { classifyChannels, getNewestSupportedChannel } from '../src/shared/cincinnatiChannels.js';
import { SUPPORTED_MINORS } from '../src/shared/versionPolicy.js';

// Mock API
global.fetch = async (url) => {
  if (url.includes('/api/state')) {
    return {
      ok: true,
      json: async () => ({}),
    };
  }
  if (url.includes('/api/cincinnati')) {
    return {
      ok: true,
      json: async () => ({
        channels: ['4.20', '4.21', '4.22'],
        timestamp: Date.now(),
      }),
    };
  }
  if (url.includes('/api/secrets')) {
    return { ok: false, status: 404 };
  }
  if (url.includes('/api/feedback/config')) {
    return {
      ok: true,
      json: async () => ({ enabled: false }),
    };
  }
  return { ok: false, status: 404 };
};

describe('Complete unsupported version recovery', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('Cincinnati classification: 4.17-4.19 = older, 4.20-4.21 = supported, 4.22 = newer', () => {
    const upstream = ['4.17', '4.18', '4.19', '4.20', '4.21', '4.22'];
    const { supported, newerUnsupported, olderOutOfScope } = classifyChannels(upstream);

    expect(supported).toEqual(['4.20', '4.21']);
    expect(newerUnsupported).toEqual(['4.22']);
    expect(olderOutOfScope).toEqual(['4.17', '4.18', '4.19']);
  });

  it('Auto-selection picks 4.21 (newest supported), never 4.22', () => {
    const upstream = ['4.20', '4.21', '4.22'];
    const newest = getNewestSupportedChannel(upstream);
    expect(newest).toBe('4.21');
  });

  it('Manual 4.22 entry rejected with clear error', () => {
    const result = validateManualOpenShiftRelease('4.22', '4.22.0');
    expect(result.ok).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]).toContain('OpenShift 4.22 is not supported');
    expect(result.errors[0]).toContain(SUPPORTED_MINORS.join(', '));
  });

  it('Manual 4.21 entry succeeds', () => {
    const result = validateManualOpenShiftRelease('4.21', '4.21.5');
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('Manual 4.20 entry succeeds', () => {
    const result = validateManualOpenShiftRelease('4.20', '4.20.15');
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('Persisted 4.22 state shows recovery UI (not generic error)', async () => {
    // Set up localStorage with 4.22 state
    const persistedState = {
      blueprint: { platform: 'Bare Metal', arch: 'x86_64' },
      release: { channel: '4.22', patchVersion: '4.22.0', confirmed: true },
      version: { locked: true },
    };
    localStorage.setItem('airgap-architect-state', JSON.stringify(persistedState));

    render(<App />);

    // Should show VersionSupportGate recovery UI
    await waitFor(() => {
      expect(screen.getByText(/Unsupported OpenShift Version/i)).toBeInTheDocument();
      expect(screen.getByText(/4\.22/)).toBeInTheDocument();
      expect(screen.getByText(new RegExp(`Supported versions.*${SUPPORTED_MINORS.join(', ')}`))).toBeInTheDocument();
    }, { timeout: 3000 });

    // Should NOT show generic "Something went wrong"
    expect(screen.queryByText(/Something went wrong/i)).toBeNull();

    // Should show recovery buttons
    expect(screen.getByRole('button', { name: /Start Over/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Switch to 4\.21/i })).toBeInTheDocument();
  });

  it('Supported 4.21 state does NOT trigger recovery UI', async () => {
    const persistedState = {
      blueprint: { platform: 'Bare Metal', arch: 'x86_64' },
      release: { channel: '4.21', patchVersion: '4.21.5', confirmed: false },
    };
    localStorage.setItem('airgap-architect-state', JSON.stringify(persistedState));

    render(<App />);

    // Wait for app to load
    await waitFor(() => {
      expect(screen.queryByText(/Unsupported OpenShift Version/i)).toBeNull();
    }, { timeout: 3000 });

    // App should render normally
    expect(screen.queryByText(/Something went wrong/i)).toBeNull();
  });
});
