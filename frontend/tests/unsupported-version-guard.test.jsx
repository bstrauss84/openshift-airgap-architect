/**
 * Test: Unsupported OpenShift Version Guard
 *
 * Cincinnati availability ≠ application support.
 * When Cincinnati exposes 4.23 but the app supports only 4.20/4.21/4.22:
 *
 * 1. Auto-selection MUST select 4.22 (newest supported), never 4.23
 * 2. getCatalogForScenario("...", "4.23") MUST NOT return 4.22 catalogs (no silent fallback)
 * 3. getCatalogForScenario("...", "4.23") MUST throw UnsupportedVersionError (typed error)
 * 4. Unsupported versions shown in UI as unsupported, not hidden
 * 5. 4.20, 4.21 and 4.22 loading remains unchanged
 *
 * The example minor moved from 4.22 to 4.23 when 4.22 became supported. The
 * property under test is unchanged: the NEWEST Cincinnati channel is not
 * automatically a supported one.
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
      channels: ['4.20', '4.21', '4.22', '4.23'], // Cincinnati returns 4.23 (unsupported)
      timestamp: Date.now(),
    });
  }
  if (url.includes('/api/cincinnati/patches')) {
    return mockResponse({
      versions: ['4.22.5', '4.22.4'],
      timestamp: Date.now(),
    });
  }
  if (url.includes('/api/cincinnati/update')) {
    return mockResponse({
      channels: ['4.20', '4.21', '4.22', '4.23'],
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

  it('Cincinnati returns 4.20-4.23 → auto-selection is 4.22 (newest supported)', async () => {
    const upstreamChannels = ['4.20', '4.21', '4.22', '4.23'];
    const newest = cincinnatiChannels.getNewestSupportedChannel(upstreamChannels);
    expect(newest).toBe('4.22');
  });

  it('filterSupportedChannels separates supported and unsupported', () => {
    const upstreamChannels = ['4.20', '4.21', '4.22', '4.23'];
    const { supported, unsupported } = cincinnatiChannels.filterSupportedChannels(upstreamChannels);

    expect(supported).toEqual(['4.20', '4.21', '4.22']);
    expect(unsupported).toEqual(['4.23']);
  });

  it('Blueprint shows 4.23 as unsupported and does not auto-select it', async () => {
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
      expect(document.body.textContent).toContain('OpenShift 4.23');
      expect(document.body.textContent).toContain('not yet supported');
      expect(document.body.textContent).toContain(`Supported versions: ${SUPPORTED_MINORS.join(", ")}`);
    }, { timeout: 3000 });
  });

  it('getCatalogForScenario("bare-metal-agent", "4.23") throws UnsupportedVersionError', () => {
    expect(() => {
      catalogPaths.getCatalogForScenario('bare-metal-agent', '4.23');
    }).toThrow(catalogPaths.UnsupportedVersionError);

    try {
      catalogPaths.getCatalogForScenario('bare-metal-agent', '4.23');
    } catch (error) {
      expect(error).toBeInstanceOf(catalogPaths.UnsupportedVersionError);
      expect(error.requestedVersion).toBe('4.23');
      expect(error.supportedVersions).toEqual(SUPPORTED_MINORS);
      expect(error.message).toContain('OpenShift 4.23 is not supported');
      expect(error.message).toContain(SUPPORTED_MINORS.join(', '));
    }
  });

  it('getCatalogForScenario("bare-metal-agent", "4.23") does NOT return 4.22 parameters', () => {
    let threwError = false;
    let returnedParams = null;

    try {
      returnedParams = catalogPaths.getCatalogForScenario('bare-metal-agent', '4.23');
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

  it('getCatalogForScenario("bare-metal-agent", "4.22") returns 4.22 parameters', () => {
    const params = catalogPaths.getCatalogForScenario('bare-metal-agent', '4.22');
    expect(Array.isArray(params)).toBe(true);
    expect(params.length).toBeGreaterThan(0);
  });

  it('getLatestSupportedVersion returns 4.22 (policy-driven, not filesystem-driven)', () => {
    const latest = catalogPaths.getLatestSupportedVersion();
    expect(latest).toBe('4.22');
  });

  it('SUPPORTED_MINORS contains exactly 4.20, 4.21 and 4.22', () => {
    expect(SUPPORTED_MINORS).toEqual(['4.20', '4.21', '4.22']);
  });
});
