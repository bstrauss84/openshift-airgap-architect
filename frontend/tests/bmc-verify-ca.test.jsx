import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { getCatalogForScenario } from '../src/catalogPaths.js';
import { isParamVisibleForVersion } from '../src/catalogFieldMeta.js';
import { isAgentSingleNodeTopology } from '../src/hostInventoryV2Helpers.js';
import { AppContext } from '../src/store.jsx';
import PlatformSpecificsStep from '../src/steps/PlatformSpecificsStep.jsx';
import { stateWithBlueprintCompleteMethodologyIncomplete } from './fixtures/minimalState.js';

function stateForPlatformSpecificsStep(overrides = {}) {
  const base = stateWithBlueprintCompleteMethodologyIncomplete();
  return {
    ...base,
    credentials: {
      pullSecretPlaceholder: '{"auths":{"quay.io":{}}}',
      sshPublicKey: "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAI test"
    },
    ui: {
      ...base.ui,
      segmentedFlowV1: true,
      activeStepId: "platform-specifics",
      visitedSteps: {
        ...base.ui?.visitedSteps,
        blueprint: true,
        methodology: true,
        "identity-access": true,
        "networking-v2": true,
        "connectivity-mirroring": true,
        "trust-proxy": true,
        "platform-specifics": true
      },
      completedSteps: {
        ...base.ui?.completedSteps,
        blueprint: true,
        methodology: true,
        "identity-access": true,
        "networking-v2": true,
        "connectivity-mirroring": true,
        "trust-proxy": true
      }
    },
    ...overrides
  };
}

function bmState(minor, method, hiOverrides = {}) {
  const base = stateForPlatformSpecificsStep({
    blueprint: { ...stateForPlatformSpecificsStep().blueprint, platform: "Bare Metal" },
    methodology: { method }
  });
  return {
    ...base,
    version: { ...base.version, selectedMinor: minor, selectedPatch: `${minor}.0` },
    release: { ...base.release, channel: minor, patchVersion: `${minor}.0` },
    hostInventory: {
      ...base.hostInventory,
      nodes: [
        { role: "master", hostname: "m0", primary: { type: "ethernet", name: "eno1", macAddress: "52:54:00:aa:bb:01" } },
        { role: "master", hostname: "m1", primary: { type: "ethernet", name: "eno1", macAddress: "52:54:00:aa:bb:02" } },
        { role: "master", hostname: "m2", primary: { type: "ethernet", name: "eno1", macAddress: "52:54:00:aa:bb:03" } },
      ],
      apiVip: "10.90.0.2",
      ingressVip: "10.90.0.3",
      machineNetworkCidr: "10.90.0.0/24",
      ipStackMode: "ipv4",
      ...hiOverrides,
    },
  };
}

function bmSNOState(minor) {
  const base = stateForPlatformSpecificsStep({
    blueprint: { ...stateForPlatformSpecificsStep().blueprint, platform: "Bare Metal" },
    methodology: { method: "Agent-Based Installer" }
  });
  return {
    ...base,
    version: { ...base.version, selectedMinor: minor, selectedPatch: `${minor}.0` },
    release: { ...base.release, channel: minor, patchVersion: `${minor}.0` },
    hostInventory: {
      ...base.hostInventory,
      nodes: [
        { role: "master", hostname: "sno-0", primary: { type: "ethernet", name: "eno1", macAddress: "52:54:00:aa:bb:01" } },
      ],
      apiVip: "10.90.0.2",
      ingressVip: "10.90.0.3",
      machineNetworkCidr: "10.90.0.0/24",
      ipStackMode: "ipv4",
    },
  };
}

function renderWithState(state) {
  const updateState = vi.fn();
  const value = {
    state,
    updateState,
    loading: false,
    startOver: vi.fn(),
    setState: vi.fn()
  };
  const result = render(
    <AppContext.Provider value={value}>
      <PlatformSpecificsStep />
    </AppContext.Provider>
  );
  const rerenderWithState = (nextState) => {
    const nextUpdateState = vi.fn();
    const nextValue = {
      state: nextState,
      updateState: nextUpdateState,
      loading: false,
      startOver: vi.fn(),
      setState: vi.fn()
    };
    result.rerender(
      <AppContext.Provider value={nextValue}>
        <PlatformSpecificsStep />
      </AppContext.Provider>
    );
    return { updateState: nextUpdateState };
  };
  return { result, updateState, rerenderWithState };
}

// ===================================================================
// Catalog tests
// ===================================================================

describe('bmcVerifyCA — catalog (frontend)', () => {
  it('4.20 IPI has no bmcVerifyCA param', () => {
    const params = getCatalogForScenario('bare-metal-ipi', '4.20');
    const param = params.find(p => p.path === 'platform.baremetal.bmcVerifyCA');
    expect(param).toBeUndefined();
  });

  it('4.20 Agent has no bmcVerifyCA param', () => {
    const params = getCatalogForScenario('bare-metal-agent', '4.20');
    const param = params.find(p => p.path === 'platform.baremetal.bmcVerifyCA');
    expect(param).toBeUndefined();
  });

  it('4.21 IPI bmcVerifyCA is supported-ui with minVersion 4.21', () => {
    const params = getCatalogForScenario('bare-metal-ipi', '4.21');
    const param = params.find(p => p.path === 'platform.baremetal.bmcVerifyCA');
    expect(param).toBeDefined();
    expect(param.supportStatus).toBe('supported-ui');
    expect(param.minVersion).toBe('4.21');
  });

  it('4.21 Agent bmcVerifyCA is supported-ui with minVersion 4.21', () => {
    const params = getCatalogForScenario('bare-metal-agent', '4.21');
    const param = params.find(p => p.path === 'platform.baremetal.bmcVerifyCA');
    expect(param).toBeDefined();
    expect(param.supportStatus).toBe('supported-ui');
    expect(param.minVersion).toBe('4.21');
  });

  it('4.21 UPI bmcVerifyCA is hidden-not-applicable', () => {
    const params = getCatalogForScenario('bare-metal-upi', '4.21');
    const param = params.find(p => p.path === 'platform.baremetal.bmcVerifyCA');
    expect(param).toBeDefined();
    expect(param.supportStatus).toBe('hidden-not-applicable');
  });

  it('4.21 IPI bmcVerifyCA is visible via isParamVisibleForVersion', () => {
    const params = getCatalogForScenario('bare-metal-ipi', '4.21');
    const param = params.find(p => p.path === 'platform.baremetal.bmcVerifyCA');
    expect(isParamVisibleForVersion(param, '4.21')).toBe(true);
  });

  it('4.21 IPI bmcVerifyCA is NOT visible for 4.20', () => {
    const params = getCatalogForScenario('bare-metal-ipi', '4.21');
    const param = params.find(p => p.path === 'platform.baremetal.bmcVerifyCA');
    expect(isParamVisibleForVersion(param, '4.20')).toBe(false);
  });
});

// ===================================================================
// Visibility tests
// ===================================================================

describe('bmcVerifyCA — UI visibility', () => {
  afterEach(() => { cleanup(); vi.restoreAllMocks(); });

  it('visible for IPI 4.21', () => {
    renderWithState(bmState('4.21', 'IPI'));
    expect(screen.queryByLabelText('BMC verify CA certificate')).not.toBeNull();
  });

  it('visible for Agent multi-node 4.21', () => {
    renderWithState(bmState('4.21', 'Agent-Based Installer'));
    expect(screen.queryByLabelText('BMC verify CA certificate')).not.toBeNull();
  });

  it('hidden for IPI 4.20', () => {
    renderWithState(bmState('4.20', 'IPI'));
    expect(screen.queryByLabelText('BMC verify CA certificate')).toBeNull();
  });

  it('hidden for UPI 4.21', () => {
    renderWithState(bmState('4.21', 'UPI'));
    expect(screen.queryByLabelText('BMC verify CA certificate')).toBeNull();
  });

  it('hidden for Agent SNO 4.21 (topology suppression via centralized helper)', () => {
    const snoState = bmSNOState('4.21');
    expect(isAgentSingleNodeTopology(snoState.hostInventory.nodes)).toBe(true);
    renderWithState(snoState);
    expect(screen.queryByLabelText('BMC verify CA certificate')).toBeNull();
  });

  it('isAgentSingleNodeTopology returns false for multi-node', () => {
    const state = bmState('4.21', 'Agent-Based Installer');
    expect(isAgentSingleNodeTopology(state.hostInventory.nodes)).toBe(false);
  });

  it('isAgentSingleNodeTopology returns false for empty nodes', () => {
    expect(isAgentSingleNodeTopology([])).toBe(false);
    expect(isAgentSingleNodeTopology(undefined)).toBe(false);
  });

  it('hidden when canonical version is missing', () => {
    const state = bmState('4.21', 'IPI');
    state.version.selectedMinor = '';
    state.version.selectedPatch = '';
    state.release.channel = '';
    state.release.patchVersion = '';
    renderWithState(state);
    expect(screen.queryByLabelText('BMC verify CA certificate')).toBeNull();
  });

  it('hidden when catalog marks field hidden-not-applicable (UPI)', () => {
    const params = getCatalogForScenario('bare-metal-upi', '4.21');
    const param = params.find(p => p.path === 'platform.baremetal.bmcVerifyCA');
    expect(param.supportStatus).toBe('hidden-not-applicable');
    renderWithState(bmState('4.21', 'UPI'));
    expect(screen.queryByLabelText('BMC verify CA certificate')).toBeNull();
  });
});

// ===================================================================
// Value editing tests
// ===================================================================

describe('bmcVerifyCA — value editing', () => {
  afterEach(() => { cleanup(); vi.restoreAllMocks(); });

  it('editing textarea and blurring calls updateState with bmcVerifyCA', () => {
    const { updateState } = renderWithState(bmState('4.21', 'IPI'));
    const textarea = screen.getByLabelText('BMC verify CA certificate');
    fireEvent.change(textarea, { target: { value: '-----BEGIN CERTIFICATE-----\ntest\n-----END CERTIFICATE-----' } });
    fireEvent.blur(textarea);
    expect(updateState).toHaveBeenCalled();
    const lastCall = updateState.mock.calls[updateState.mock.calls.length - 1][0];
    expect(lastCall.hostInventory.bmcVerifyCA).toBe('-----BEGIN CERTIFICATE-----\ntest\n-----END CERTIFICATE-----');
  });

  it('clearing textarea sets bmcVerifyCA to undefined', () => {
    const state = bmState('4.21', 'IPI', { bmcVerifyCA: 'old-value' });
    const { updateState } = renderWithState(state);
    const textarea = screen.getByLabelText('BMC verify CA certificate');
    fireEvent.change(textarea, { target: { value: '' } });
    fireEvent.blur(textarea);
    expect(updateState).toHaveBeenCalled();
    const lastCall = updateState.mock.calls[updateState.mock.calls.length - 1][0];
    expect(lastCall.hostInventory.bmcVerifyCA).toBeUndefined();
  });

  it('existing value is displayed in textarea', () => {
    const state = bmState('4.21', 'IPI', { bmcVerifyCA: 'my-ca-content' });
    renderWithState(state);
    const textarea = screen.getByLabelText('BMC verify CA certificate');
    expect(textarea.value).toBe('my-ca-content');
  });

  it('content with leading/trailing whitespace is preserved exactly', () => {
    const { updateState } = renderWithState(bmState('4.21', 'IPI'));
    const textarea = screen.getByLabelText('BMC verify CA certificate');
    const value = '  \n-----BEGIN CERTIFICATE-----\ndata\n-----END CERTIFICATE-----\n  ';
    fireEvent.change(textarea, { target: { value } });
    fireEvent.blur(textarea);
    expect(updateState).toHaveBeenCalled();
    const lastCall = updateState.mock.calls[updateState.mock.calls.length - 1][0];
    expect(lastCall.hostInventory.bmcVerifyCA).toBe(value);
  });

  it('NUL byte shows blocking error and does not store', () => {
    const { updateState } = renderWithState(bmState('4.21', 'IPI'));
    const textarea = screen.getByLabelText('BMC verify CA certificate');
    fireEvent.change(textarea, { target: { value: 'cert\0data' } });
    fireEvent.blur(textarea);
    expect(screen.queryByRole('alert')).not.toBeNull();
    expect(screen.getByRole('alert').textContent).toMatch(/NUL byte/);
    const bmcCalls = updateState.mock.calls.filter(c => c[0]?.hostInventory?.hasOwnProperty('bmcVerifyCA'));
    expect(bmcCalls.length).toBe(0);
  });

  it('oversize content shows blocking error and does not store', () => {
    const { updateState } = renderWithState(bmState('4.21', 'IPI'));
    const textarea = screen.getByLabelText('BMC verify CA certificate');
    fireEvent.change(textarea, { target: { value: 'A'.repeat(262145) } });
    fireEvent.blur(textarea);
    expect(screen.queryByRole('alert')).not.toBeNull();
    expect(screen.getByRole('alert').textContent).toMatch(/exceeds 256 KiB/);
    const bmcCalls = updateState.mock.calls.filter(c => c[0]?.hostInventory?.hasOwnProperty('bmcVerifyCA'));
    expect(bmcCalls.length).toBe(0);
  });
});

// ===================================================================
// PEM advisory tests
// ===================================================================

describe('bmcVerifyCA — PEM advisory', () => {
  afterEach(() => { cleanup(); vi.restoreAllMocks(); });

  it('no advisory when empty', () => {
    renderWithState(bmState('4.21', 'IPI'));
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('no advisory when valid PEM', () => {
    const state = bmState('4.21', 'IPI', { bmcVerifyCA: '-----BEGIN CERTIFICATE-----\ndata\n-----END CERTIFICATE-----' });
    renderWithState(state);
    const textarea = screen.getByLabelText('BMC verify CA certificate');
    fireEvent.change(textarea, { target: { value: '-----BEGIN CERTIFICATE-----\ndata\n-----END CERTIFICATE-----' } });
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('shows advisory when no PEM block present', () => {
    renderWithState(bmState('4.21', 'IPI'));
    const textarea = screen.getByLabelText('BMC verify CA certificate');
    fireEvent.change(textarea, { target: { value: 'not-a-pem-cert' } });
    expect(screen.queryByRole('status')).not.toBeNull();
  });
});

// ===================================================================
// Hidden-state preservation tests
// ===================================================================

describe('bmcVerifyCA — hidden-state preservation', () => {
  afterEach(() => { cleanup(); vi.restoreAllMocks(); });

  it('hidden controls at 4.20 do not clear stored bmcVerifyCA', () => {
    const state = bmState('4.20', 'IPI', { bmcVerifyCA: 'retained-ca' });
    const { updateState } = renderWithState(state);
    expect(screen.queryByLabelText('BMC verify CA certificate')).toBeNull();
    expect(updateState).not.toHaveBeenCalledWith(
      expect.objectContaining({ hostInventory: expect.objectContaining({ bmcVerifyCA: undefined }) })
    );
    expect(state.hostInventory.bmcVerifyCA).toBe('retained-ca');
  });

  it('mounted version transition: 4.21 visible → 4.20 hidden → 4.21 restored', () => {
    const state421 = bmState('4.21', 'IPI', { bmcVerifyCA: 'version-cert' });
    const { rerenderWithState } = renderWithState(state421);
    expect(screen.queryByLabelText('BMC verify CA certificate')).not.toBeNull();
    expect(screen.getByLabelText('BMC verify CA certificate').value).toBe('version-cert');

    const state420 = {
      ...state421,
      version: { ...state421.version, selectedMinor: '4.20', selectedPatch: '4.20.8' },
      release: { ...state421.release, channel: '4.20', patchVersion: '4.20.8' },
    };
    rerenderWithState(state420);
    expect(screen.queryByLabelText('BMC verify CA certificate')).toBeNull();
    expect(state420.hostInventory.bmcVerifyCA).toBe('version-cert');

    const stateBack = {
      ...state420,
      version: { ...state420.version, selectedMinor: '4.21', selectedPatch: '4.21.0' },
      release: { ...state420.release, channel: '4.21', patchVersion: '4.21.0' },
    };
    rerenderWithState(stateBack);
    expect(screen.queryByLabelText('BMC verify CA certificate')).not.toBeNull();
    expect(screen.getByLabelText('BMC verify CA certificate').value).toBe('version-cert');
  });

  it('topology transition preserves bmcVerifyCA in state', () => {
    const agentState = bmState('4.21', 'Agent-Based Installer', { bmcVerifyCA: 'agent-cert' });
    const { rerenderWithState } = renderWithState(agentState);
    expect(screen.queryByLabelText('BMC verify CA certificate')).not.toBeNull();

    const upiState = {
      ...agentState,
      methodology: { method: 'UPI' },
    };
    rerenderWithState(upiState);
    expect(screen.queryByLabelText('BMC verify CA certificate')).toBeNull();
    expect(upiState.hostInventory.bmcVerifyCA).toBe('agent-cert');
  });

  it('mounted Agent topology transition: multi-node → SNO → multi-node', () => {
    const multiNodeState = bmState('4.21', 'Agent-Based Installer', { bmcVerifyCA: 'topo-cert' });
    const { rerenderWithState } = renderWithState(multiNodeState);
    expect(screen.queryByLabelText('BMC verify CA certificate')).not.toBeNull();
    expect(screen.getByLabelText('BMC verify CA certificate').value).toBe('topo-cert');

    const snoState = {
      ...multiNodeState,
      hostInventory: {
        ...multiNodeState.hostInventory,
        nodes: [
          { role: 'master', hostname: 'sno-0', primary: { type: 'ethernet', name: 'eno1', macAddress: '52:54:00:aa:bb:01' } },
        ],
      },
    };
    rerenderWithState(snoState);
    expect(screen.queryByLabelText('BMC verify CA certificate')).toBeNull();
    expect(snoState.hostInventory.bmcVerifyCA).toBe('topo-cert');

    rerenderWithState(multiNodeState);
    expect(screen.queryByLabelText('BMC verify CA certificate')).not.toBeNull();
    expect(screen.getByLabelText('BMC verify CA certificate').value).toBe('topo-cert');
  });
});
