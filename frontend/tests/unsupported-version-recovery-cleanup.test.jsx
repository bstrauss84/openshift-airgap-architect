/**
 * Unsupported Version Recovery - State Cleanup Test
 *
 * DOC-102 Slice 5F.13: After recovery, no canonical, derived, or legacy version field may retain 4.22.
 * Tests that "Switch to 4.21" produces clean canonical v3 state without legacy field pollution.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '../src/App.jsx';

// Mock fetch for all API calls
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('Unsupported Version Recovery - State Cleanup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();

    // Default mock responses
    mockFetch.mockImplementation((url) => {
      if (url === '/api/state') {
        // Return polluted 4.22 state with ALL legacy fields present
        return Promise.resolve({
          ok: true,
          status: 200,
          statusText: 'OK',
          json: () => Promise.resolve({
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
          }),
          text: () => Promise.resolve('{}')
        });
      }

      if (url === '/api/schema/stepMap') {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ mvpSteps: [] }),
          text: () => Promise.resolve('{}')
        });
      }

      if (url === '/api/build-info') {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ version: '1.7.0' }),
          text: () => Promise.resolve('{}')
        });
      }

      if (url === '/api/update-info') {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({}),
          text: () => Promise.resolve('{}')
        });
      }

      if (url === '/api/feedback/config') {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ visible: false, enabled: false }),
          text: () => Promise.resolve('{}')
        });
      }

      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({}),
        text: () => Promise.resolve('{}')
      });
    });
  });

  it('removes all legacy version fields after recovery', async () => {
    render(<App />);

    // Wait for recovery UI
    await waitFor(() => {
      expect(screen.queryByText(/Unsupported OpenShift Version/i)).toBeInTheDocument();
    });

    // Capture the POST /api/state call when Switch to 4.21 is clicked
    let capturedState = null;
    mockFetch.mockImplementation((url, options) => {
      if (url === '/api/state' && options?.method === 'POST') {
        const body = JSON.parse(options.body);
        capturedState = body;
        return Promise.resolve({
          ok: true,
          status: 200,
          statusText: 'OK',
          json: () => Promise.resolve(body),
          text: () => Promise.resolve(JSON.stringify(body))
        });
      }

      // Default responses for other calls
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({}),
        text: () => Promise.resolve('{}')
      });
    });

    // Click "Switch to 4.21" button
    const switchButton = screen.getByRole('button', { name: /Switch to 4\.21/i });
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
    expect(capturedState.release.followLatestMinor).toBe(false);
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
      if (url === '/api/state' && options?.method === 'POST') {
        capturedState = JSON.parse(options.body);
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve(capturedState),
          text: () => Promise.resolve(JSON.stringify(capturedState))
        });
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({}),
        text: () => Promise.resolve('{}')
      });
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
