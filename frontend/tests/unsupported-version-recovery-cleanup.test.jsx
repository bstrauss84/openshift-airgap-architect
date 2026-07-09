/**
 * Unsupported Version Recovery - State Cleanup Test
 *
 * DOC-102 Slice 5F.13: After recovery, no canonical, derived, or legacy version field may retain 4.22.
 * Tests that "Switch to 4.21" produces clean canonical v3 state without legacy field pollution.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '../src/App.jsx';

// Mock fetch for all API calls
const mockFetch = vi.fn();
global.fetch = mockFetch;

// Canonical v3 4.22 fixture
const POLLUTED_4_22_STATE = {
  version: {
    _schemaVersion: 3,
    selectedMinor: '4.22',
    selectedPatch: '4.22.1',
    selectedChannel: 'stable-4.22',
    selectedVersion: '4.22.1', // Legacy field
    versionConfirmed: true,    // Legacy field
    confirmedByUser: true,     // Legacy field
    locked: true,
    lockTimestamp: 1234567890,
    selectionTimestamp: 1234567890
  },
  release: {
    channel: '4.22',
    patchVersion: '4.22.1',
    selectedVersion: '4.22.1', // Legacy field
    confirmed: true,
    followLatestMinor: true
  },
  blueprint: { platform: 'Bare Metal', arch: 'x86_64' },
  methodology: { method: 'IPI' }
};

describe('Unsupported Version Recovery - State Cleanup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();

    // Default mock responses
    mockFetch.mockImplementation((url) => {
      const pathname = new URL(String(url), 'http://localhost').pathname;

      const mockResponse = (data, ok = true, status = 200) => ({
        ok,
        status,
        statusText: ok ? 'OK' : 'Not Found',
        json: async () => data,
        text: async () => JSON.stringify(data)
      });

      if (pathname === '/api/state') {
        return Promise.resolve(mockResponse(POLLUTED_4_22_STATE));
      }

      if (pathname === '/api/schema/stepMap') {
        return Promise.resolve(mockResponse({ mvpSteps: [] }));
      }

      if (pathname === '/api/build-info') {
        return Promise.resolve(mockResponse({ version: '1.7.0' }));
      }

      if (pathname === '/api/update-info') {
        return Promise.resolve(mockResponse({}));
      }

      if (pathname === '/api/feedback/config') {
        return Promise.resolve(mockResponse({ visible: false, enabled: false }));
      }

      if (pathname.startsWith('/api/cincinnati')) {
        return Promise.resolve(mockResponse({
          channels: ['4.20', '4.21', '4.22'],
          timestamp: Date.now()
        }));
      }

      return Promise.resolve(mockResponse({}, false, 404));
    });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('removes all legacy version fields after recovery', async () => {
    render(<App />);

    // Wait for recovery UI
    await waitFor(() => {
      expect(screen.queryByText(/Unsupported OpenShift Version/i)).toBeInTheDocument();
    });

    // Verify button is enabled and has proper class (not disabled/white)
    const switchButton = screen.getByRole('button', { name: /Switch to 4\.21/i });
    expect(switchButton).not.toBeDisabled();
    expect(switchButton.className).toContain('ghost');

    // Capture the POST /api/state call when Switch to 4.21 is clicked
    let capturedState = null;
    mockFetch.mockImplementation((url, options) => {
      const pathname = new URL(String(url), 'http://localhost').pathname;

      const mockResponse = (data, ok = true, status = 200) => ({
        ok,
        status,
        statusText: ok ? 'OK' : 'Not Found',
        json: async () => data,
        text: async () => JSON.stringify(data)
      });

      if (pathname === '/api/state' && options?.method === 'POST') {
        const body = JSON.parse(options.body);
        capturedState = body;
        return Promise.resolve(mockResponse(body));
      }

      // Default responses for other calls
      if (pathname === '/api/state') {
        return Promise.resolve(mockResponse(POLLUTED_4_22_STATE));
      }
      if (pathname === '/api/schema/stepMap') {
        return Promise.resolve(mockResponse({ mvpSteps: [] }));
      }
      if (pathname === '/api/build-info') {
        return Promise.resolve(mockResponse({ version: '1.7.0' }));
      }
      if (pathname === '/api/update-info') {
        return Promise.resolve(mockResponse({}));
      }
      if (pathname === '/api/feedback/config') {
        return Promise.resolve(mockResponse({ visible: false, enabled: false }));
      }
      if (pathname.startsWith('/api/cincinnati')) {
        return Promise.resolve(mockResponse({
          channels: ['4.20', '4.21', '4.22'],
          timestamp: Date.now()
        }));
      }

      return Promise.resolve(mockResponse({}, false, 404));
    });

    // Click "Switch to 4.21" button
    await userEvent.click(switchButton);

    // Wait for state update POST
    await waitFor(() => {
      expect(capturedState).not.toBeNull();
    });

    // Assert: version object has clean canonical v3 state
    expect(capturedState.version._schemaVersion).toBe(3);
    expect(capturedState.version.selectedMinor).toBe('4.21');
    expect(capturedState.version.selectedPatch).toBeNull();
    expect(capturedState.version.selectedChannel).toBe('stable-4.21');
    expect(capturedState.version.locked).toBe(false);

    // CRITICAL: No legacy fields contain 4.22
    expect(capturedState.version.selectedVersion).toBeNull();
    expect(capturedState.version.versionConfirmed).toBe(false);
    expect(capturedState.version.confirmedByUser).toBe(false);

    // Assert: release object has clean state
    expect(capturedState.release.channel).toBe('4.21');
    expect(capturedState.release.patchVersion).toBeNull();
    expect(capturedState.release.confirmed).toBe(false);
    expect(capturedState.release.selectedVersion).toBeNull();

    // Assert: NO field anywhere contains '4.22'
    const stateJson = JSON.stringify(capturedState);
    expect(stateJson).not.toContain('4.22');
  });

  it('recovery state passes version precedence test', async () => {
    render(<App />);

    await waitFor(() => {
      expect(screen.queryByText(/Unsupported OpenShift Version/i)).toBeInTheDocument();
    });

    let capturedState = null;
    mockFetch.mockImplementation((url, options) => {
      const pathname = new URL(String(url), 'http://localhost').pathname;

      const mockResponse = (data, ok = true, status = 200) => ({
        ok,
        status,
        statusText: ok ? 'OK' : 'Not Found',
        json: async () => data,
        text: async () => JSON.stringify(data)
      });

      if (pathname === '/api/state' && options?.method === 'POST') {
        capturedState = JSON.parse(options.body);
        return Promise.resolve(mockResponse(capturedState));
      }

      if (pathname === '/api/state') {
        return Promise.resolve(mockResponse(POLLUTED_4_22_STATE));
      }
      if (pathname === '/api/schema/stepMap') {
        return Promise.resolve(mockResponse({ mvpSteps: [] }));
      }
      if (pathname === '/api/build-info') {
        return Promise.resolve(mockResponse({ version: '1.7.0' }));
      }
      if (pathname === '/api/update-info') {
        return Promise.resolve(mockResponse({}));
      }
      if (pathname === '/api/feedback/config') {
        return Promise.resolve(mockResponse({ visible: false, enabled: false }));
      }
      if (pathname.startsWith('/api/cincinnati')) {
        return Promise.resolve(mockResponse({
          channels: ['4.20', '4.21', '4.22'],
          timestamp: Date.now()
        }));
      }

      return Promise.resolve(mockResponse({}, false, 404));
    });

    const switchButton = screen.getByRole('button', { name: /Switch to 4\.21/i });
    await userEvent.click(switchButton);

    await waitFor(() => {
      expect(capturedState).not.toBeNull();
    });

    // Test canonical precedence: version.selectedMinor must be authoritative
    // Even if we manually inject conflicting release.channel, selectedMinor should win
    const testState = {
      ...capturedState,
      release: {
        ...capturedState.release,
        channel: '4.20' // Inject conflict for precedence test
      }
    };

    // Import getOpenShiftMinorFromState to verify precedence
    const { getOpenShiftMinorFromState } = await import('../src/shared/openShiftMinor.js');
    const resolvedMinor = getOpenShiftMinorFromState(testState);

    expect(resolvedMinor).toBe('4.21'); // selectedMinor wins over release.channel
  });
});
