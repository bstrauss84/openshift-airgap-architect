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
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import App from '../src/App.jsx';
import { validateManualOpenShiftRelease } from '../src/validation.js';
import { classifyChannels, getNewestSupportedChannel } from '../src/shared/cincinnatiChannels.js';
import { SUPPORTED_MINORS } from '../src/shared/versionPolicy.js';

// Mock API with proper fetch response structure
// Track which test is running to return correct state
let testContext = 'default';

global.fetch = async (url) => {
  const mockResponse = (data, ok = true, status = 200) => ({
    ok,
    status,
    statusText: ok ? 'OK' : 'Not Found',
    json: async () => data,
    text: async () => JSON.stringify(data)
  });

  if (url.includes('/api/state')) {
    // Return 4.22 state for the persistence test
    if (testContext === 'persisted-4.22') {
      return mockResponse({
        version: {
          _schemaVersion: 3,
          selectedMinor: '4.22',
          selectedPatch: '4.22.0',
          selectedChannel: 'stable-4.22',
          locked: true
        },
        release: { channel: '4.22', patchVersion: '4.22.0', confirmed: true },
        blueprint: { platform: 'Bare Metal', arch: 'x86_64' },
        methodology: { method: 'IPI' }
      });
    }
    // Return 4.21 state for supported version test
    if (testContext === 'supported-4.21') {
      return mockResponse({
        version: {
          _schemaVersion: 3,
          selectedMinor: '4.21',
          selectedPatch: '4.21.5',
          selectedChannel: 'stable-4.21',
          locked: false
        },
        release: { channel: '4.21', patchVersion: '4.21.5', confirmed: false },
        blueprint: { platform: 'Bare Metal', arch: 'x86_64' },
        methodology: { method: 'IPI' }
      });
    }
    return mockResponse({});
  }
  if (url.includes('/api/schema/stepMap')) {
    return mockResponse({ mvpSteps: [] });
  }
  if (url.includes('/api/build-info')) {
    return mockResponse({ version: '1.7.0' });
  }
  if (url.includes('/api/update-info')) {
    return mockResponse({});
  }
  if (url.includes('/api/cincinnati')) {
    return mockResponse({
      channels: ['4.20', '4.21', '4.22'],
      timestamp: Date.now(),
    });
  }
  if (url.includes('/api/feedback/config')) {
    return mockResponse({ visible: false, enabled: false });
  }
  return mockResponse({}, false, 404);
};

describe('Complete unsupported version recovery', () => {
  beforeEach(() => {
    localStorage.clear();
    testContext = 'default';
    vi.clearAllTimers();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
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
    // Set test context so fetch mock returns 4.22 state
    testContext = 'persisted-4.22';

    render(<App />);

    // Wait for app to finish loading state
    await waitFor(() => {
      expect(screen.queryByText(/Loading Airgap Architect/i)).toBeNull();
    }, { timeout: 3000 });

    // Should show VersionSupportGate recovery UI as an alert
    const alert = await screen.findByRole('alert');
    expect(alert).toBeInTheDocument();

    // Check alert contains expected content
    expect(alert).toHaveTextContent(/Unsupported OpenShift Version/i);
    expect(alert).toHaveTextContent(/4\.22/);
    expect(alert).toHaveTextContent(/Supported versions:/i);
    expect(alert).toHaveTextContent(/4\.20/);
    expect(alert).toHaveTextContent(/4\.21/);

    // Should NOT show generic "Something went wrong"
    expect(screen.queryByText(/Something went wrong/i)).toBeNull();

    // Should show recovery buttons - verify they are enabled and usable
    const startOverButton = screen.getByRole('button', { name: /Start Over/i });
    const switchButton = screen.getByRole('button', { name: /Switch to 4\.21/i });

    expect(startOverButton).toBeInTheDocument();
    expect(switchButton).toBeInTheDocument();

    // CRITICAL: Buttons must NOT be disabled (fixes manual screenshot problem)
    expect(startOverButton).not.toBeDisabled();
    expect(switchButton).not.toBeDisabled();

    // Buttons must have proper CSS classes (not undefined/secondary)
    expect(startOverButton.className).toContain('primary');
    expect(switchButton.className).toContain('ghost');
  });

  it('Supported 4.21 state does NOT trigger recovery UI', async () => {
    testContext = 'supported-4.21';

    render(<App />);

    // Wait for positive normal application signal after hydration (landing page)
    await screen.findByText(/disconnected install/i);

    // Recovery UI should be absent
    expect(screen.queryByText(/Unsupported OpenShift Version/i)).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();

    // Generic error should be absent
    expect(screen.queryByText(/Something went wrong/i)).toBeNull();
  });
});
