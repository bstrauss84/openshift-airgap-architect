/**
 * R3: AWS root-volume throughput must commit to canonical state as the value
 * changes, so the live YAML preview tracks it without needing a blur — matching
 * the established live-preview contract that the replica spinners already honour.
 */
import React, { useState } from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import PlatformSpecificsStep from '../src/steps/PlatformSpecificsStep.jsx';
import { AppContext } from '../src/store.jsx';
import { apiFetch } from '../src/api.js';

vi.mock('../src/api.js', () => ({ apiFetch: vi.fn() }));

function mockApis() {
  vi.mocked(apiFetch).mockImplementation((path, opts) => {
    if (path === '/api/cincinnati/channels') return Promise.resolve({ channels: ['4.20', '4.21'] });
    if (path === '/api/cincinnati/update' && opts?.method === 'POST') {
      return Promise.resolve({ channels: ['4.20', '4.21'] });
    }
    if (String(path).startsWith('/api/cincinnati/patches?')) {
      return Promise.resolve({ versions: ['4.21.9'] });
    }
    if (path === '/api/secrets/rh-pull-secret') return Promise.resolve({ available: false });
    return Promise.resolve({});
  });
}

function baseState() {
  return {
    blueprint: {
      platform: 'AWS GovCloud',
      arch: 'x86_64',
      clusterName: 'test',
      baseDomain: 'example.com',
      confirmed: true,
    },
    release: { channel: '4.21', patchVersion: '4.21.9', confirmed: true },
    version: {
      versionConfirmed: true,
      selectedMinor: '4.21',
      selectedPatch: '4.21.9',
      selectedChannel: 'stable-4.21',
      selectedVersion: '4.21.9',
      locked: true,
      confirmedByUser: true,
      _schemaVersion: 3,
    },
    methodology: { method: 'IPI' },
    credentials: {
      pullSecretPlaceholder: '{"auths":{"quay.io":{}}}',
      sshPublicKey: 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAI test',
    },
    platformConfig: { aws: { region: 'us-gov-west-1', rootVolumeType: 'gp3' } },
    hostInventory: { nodes: [] },
    operators: {},
    ui: {
      segmentedFlowV1: true,
      activeStepId: 'platform-specifics',
      visitedSteps: { 'platform-specifics': true },
      completedSteps: {},
    },
  };
}

/**
 * Real reducer wiring: canonical state actually changes, so assertions read the
 * value the YAML preview generator would read rather than a spy argument.
 */
function Harness({ onState }) {
  const [state, setState] = useState(baseState);
  const updateState = (patch) => {
    setState((prev) => {
      const next = { ...prev, ...patch };
      onState(next);
      return next;
    });
  };
  return (
    <AppContext.Provider value={{ state, setState, updateState, dispatch: () => {} }}>
      <PlatformSpecificsStep />
    </AppContext.Provider>
  );
}

function renderStep() {
  mockApis();
  const states = [];
  render(<Harness onState={(s) => states.push(s)} />);
  const input = screen.getByRole('spinbutton', { name: /Root volume throughput/i });
  return { input, states, latest: () => states[states.length - 1] };
}

const throughputOf = (state) => state?.platformConfig?.aws?.rootVolumeThroughput;

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('AWS root volume throughput live preview', () => {
  it('renders the throughput control at 4.21', () => {
    const { input } = renderStep();
    expect(input).toBeDefined();
  });

  it('commits a valid value to canonical state on change, without a blur', () => {
    const { input, latest } = renderStep();
    fireEvent.change(input, { target: { value: '500' } });
    expect(throughputOf(latest())).toBe(500);
  });

  it('tracks successive valid edits so the preview keeps up', () => {
    const { input, latest } = renderStep();
    fireEvent.change(input, { target: { value: '500' } });
    expect(throughputOf(latest())).toBe(500);
    fireEvent.change(input, { target: { value: '750' } });
    expect(throughputOf(latest())).toBe(750);
  });

  it('commits a number, not a string, so generated YAML stays well typed', () => {
    const { input, latest } = renderStep();
    fireEvent.change(input, { target: { value: '1000' } });
    expect(typeof throughputOf(latest())).toBe('number');
  });

  it('clears the value from canonical state when the field is emptied', () => {
    const { input, latest } = renderStep();
    fireEvent.change(input, { target: { value: '500' } });
    fireEvent.change(input, { target: { value: '' } });
    expect(throughputOf(latest())).toBeUndefined();
  });

  it('does not corrupt canonical state with an out-of-range intermediate value', () => {
    const { input, latest } = renderStep();
    fireEvent.change(input, { target: { value: '500' } });
    // Typing toward "1250": "1" and "12" are below the 125 minimum.
    fireEvent.change(input, { target: { value: '1' } });
    expect(throughputOf(latest())).toBe(500);
    fireEvent.change(input, { target: { value: '12' } });
    expect(throughputOf(latest())).toBe(500);
    fireEvent.change(input, { target: { value: '1250' } });
    expect(throughputOf(latest())).toBe(1250);
  });

  it('does not flash a range error while a partial value is being typed', () => {
    const { input } = renderStep();
    fireEvent.change(input, { target: { value: '1' } });
    expect(screen.queryByRole('alert')).toBeNull();
    expect(input.getAttribute('aria-invalid')).not.toBe('true');
  });

  it('still surfaces the range error on blur', () => {
    const { input } = renderStep();
    fireEvent.change(input, { target: { value: '1' } });
    fireEvent.blur(input);
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(input.getAttribute('aria-invalid')).toBe('true');
  });

  it('clears the error once a valid value is typed again', () => {
    const { input, latest } = renderStep();
    fireEvent.change(input, { target: { value: '1' } });
    fireEvent.blur(input);
    expect(screen.getByRole('alert')).toBeInTheDocument();
    fireEvent.change(input, { target: { value: '400' } });
    expect(screen.queryByRole('alert')).toBeNull();
    expect(throughputOf(latest())).toBe(400);
  });
});
