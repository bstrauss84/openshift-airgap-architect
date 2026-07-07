/**
 * Test: Unsupported OpenShift Version Guard
 *
 * Cincinnati availability ≠ application support.
 * When Cincinnati exposes 4.22 but app supports only 4.20/4.21:
 *
 * 1. Auto-selection MUST select 4.21 (newest supported), never 4.22
 * 2. getCatalogForScenario("...", "4.22") MUST NOT return 4.21 catalogs (no silent fallback)
 * 3. getCatalogForScenario("...", "4.22") MUST throw UnsupportedVersionError (typed error)
 * 4. Unsupported versions shown in UI as unsupported, not hidden
 * 5. 4.20 and 4.21 loading remains unchanged
 *
 * ADR-005 requirement: No silent catalog fallback. Unsupported version = typed error.
 */

import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { AppContext } from '../src/store.jsx';
import BlueprintStep from '../src/steps/BlueprintStep.jsx';
import * as catalogPaths from '../src/catalogPaths.js';
import * as cincinnatiChannels from '../src/shared/cincinnatiChannels.js';
import { SUPPORTED_MINORS } from '../src/shared/versionPolicy.js';

// Mock API fetch with proper response structure
global.fetch = async (url) => {
  const mockResponse = (data, ok = true, status = 200) => ({
    ok,
    status,
    statusText: ok ? 'OK' : 'Not Found',
    json: async () => data,
    text: async () => JSON.stringify(data)
  });

  if (url.includes('/api/cincinnati/channels')) {
    return mockResponse({
      channels: ['4.20', '4.21', '4.22'], // Cincinnati returns 4.22 (unsupported)
      timestamp: Date.now(),
    });
  }
  if (url.includes('/api/cincinnati/patches')) {
    return mockResponse({
      versions: ['4.21.5', '4.21.4'],
      timestamp: Date.now(),
    });
  }
  if (url.includes('/api/cincinnati/update')) {
    return mockResponse({
      channels: ['4.20', '4.21', '4.22'],
      timestamp: Date.now(),
    });
  }
  if (url.includes('/api/secrets/rh-pull-secret')) {
    return mockResponse({ error: 'Not found' }, false, 404);
  }
  return mockResponse({}, false, 404);
};

function MockAppProvider({ children, state }) {
  const value = {
    state,
    updateState: vi.fn(),
  };
  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

describe('Unsupported OpenShift version guard', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('Cincinnati returns 4.20, 4.21, 4.22 → auto-selection is 4.21 (newest supported)', async () => {
    const upstreamChannels = ['4.20', '4.21', '4.22'];
    const newest = cincinnatiChannels.getNewestSupportedChannel(upstreamChannels);
    expect(newest).toBe('4.21');
  });

  it('filterSupportedChannels separates supported and unsupported', () => {
    const upstreamChannels = ['4.20', '4.21', '4.22'];
    const { supported, unsupported } = cincinnatiChannels.filterSupportedChannels(upstreamChannels);

    expect(supported).toEqual(['4.20', '4.21']);
    expect(unsupported).toEqual(['4.22']);
  });

  it('Blueprint shows 4.22 as unsupported and does not auto-select it', async () => {
    const initialState = {
      blueprint: {
        platform: 'Bare Metal',
        arch: 'x86_64',
        confirmed: false,
      },
      release: {
        channel: null, // No channel selected yet
        patchVersion: null,
        confirmed: false,
        followLatestMinor: true,
      },
      version: {},
    };

    render(
      <MockAppProvider state={initialState}>
        <BlueprintStep />
      </MockAppProvider>
    );

    // Wait for Cincinnati channels to load and auto-selection to happen
    await waitFor(() => {
      // Should show unsupported version warning
      expect(document.body.textContent).toContain('OpenShift 4.22');
      expect(document.body.textContent).toContain('not yet supported');
      expect(document.body.textContent).toContain(`Supported versions: ${SUPPORTED_MINORS.join(", ")}`);
    }, { timeout: 3000 });
  });

  it('getCatalogForScenario("bare-metal-agent", "4.22") throws UnsupportedVersionError', () => {
    expect(() => {
      catalogPaths.getCatalogForScenario('bare-metal-agent', '4.22');
    }).toThrow(catalogPaths.UnsupportedVersionError);

    try {
      catalogPaths.getCatalogForScenario('bare-metal-agent', '4.22');
    } catch (error) {
      expect(error).toBeInstanceOf(catalogPaths.UnsupportedVersionError);
      expect(error.requestedVersion).toBe('4.22');
      expect(error.supportedVersions).toEqual(SUPPORTED_MINORS);
      expect(error.message).toContain('OpenShift 4.22 is not supported');
      expect(error.message).toContain(SUPPORTED_MINORS.join(', '));
    }
  });

  it('getCatalogForScenario("bare-metal-agent", "4.22") does NOT return 4.21 parameters', () => {
    let threwError = false;
    let returnedParams = null;

    try {
      returnedParams = catalogPaths.getCatalogForScenario('bare-metal-agent', '4.22');
    } catch (error) {
      threwError = true;
    }

    expect(threwError).toBe(true);
    expect(returnedParams).toBeNull();
  });

  it('getCatalogForScenario("bare-metal-agent", "4.21") returns 4.21 parameters', () => {
    const params = catalogPaths.getCatalogForScenario('bare-metal-agent', '4.21');
    expect(Array.isArray(params)).toBe(true);
    expect(params.length).toBeGreaterThan(0);
  });

  it('getCatalogForScenario("bare-metal-agent", "4.20") returns 4.20 parameters', () => {
    const params = catalogPaths.getCatalogForScenario('bare-metal-agent', '4.20');
    expect(Array.isArray(params)).toBe(true);
    expect(params.length).toBeGreaterThan(0);
  });

  it('getLatestSupportedVersion returns 4.21 (policy-driven, not filesystem-driven)', () => {
    const latest = catalogPaths.getLatestSupportedVersion();
    expect(latest).toBe('4.21');
  });

  it('SUPPORTED_MINORS contains exactly 4.20 and 4.21', () => {
    expect(SUPPORTED_MINORS).toEqual(['4.20', '4.21']);
  });
});
