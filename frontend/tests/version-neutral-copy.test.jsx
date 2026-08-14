import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { AppContext } from '../src/store.jsx';
import { stateWithBlueprintCompleteMethodologyIncomplete } from './fixtures/minimalState.js';

import HostInventoryStep from '../src/steps/HostInventoryStep.jsx';
import TrustProxyStep from '../src/steps/TrustProxyStep.jsx';
import GlobalStrategyStep from '../src/steps/GlobalStrategyStep.jsx';

vi.mock('../src/api.js', () => ({ apiFetch: vi.fn(() => Promise.resolve({})) }));

function buildState(minor, overrides = {}) {
  const base = stateWithBlueprintCompleteMethodologyIncomplete();
  return {
    ...base,
    version: { ...base.version, selectedMinor: minor, selectedPatch: `${minor}.0` },
    release: { ...base.release, channel: minor, patchVersion: `${minor}.0` },
    credentials: {
      pullSecretPlaceholder: '{"auths":{"quay.io":{}}}',
      sshPublicKey: "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAI test"
    },
    ui: {
      ...base.ui,
      segmentedFlowV1: true,
      activeStepId: "hosts-inventory",
      visitedSteps: {
        ...base.ui?.visitedSteps,
        blueprint: true,
        methodology: true,
        "identity-access": true,
        "networking-v2": true,
        "connectivity-mirroring": true,
        "trust-proxy": true,
        "platform-specifics": true,
        "hosts-inventory": true
      },
      completedSteps: {
        ...base.ui?.completedSteps,
        blueprint: true,
        methodology: true,
        "identity-access": true,
        "networking-v2": true,
        "connectivity-mirroring": true,
        "trust-proxy": true,
        "platform-specifics": true
      }
    },
    hostInventory: {
      ...base.hostInventory,
      nodes: [
        {
          role: "master",
          hostname: "m0",
          rootDevice: "",
          dnsServers: "",
          dnsSearch: "",
          bmc: { address: "", username: "", password: "", bootMACAddress: "" },
          primary: {
            type: "ethernet",
            mode: "dhcp",
            ipv4Cidr: "",
            ipv4Gateway: "",
            ipv6Cidr: "",
            ipv6Gateway: "",
            ethernet: { name: "eno1", macAddress: "52:54:00:aa:bb:01" },
            bond: { name: "bond0", mode: "active-backup", slaves: [{ name: "eth0", macAddress: "" }, { name: "eth1", macAddress: "" }] },
            vlan: { id: "", baseIface: "", name: "" },
            advanced: { mtu: "1500", sriov: { enabled: false, totalVfs: "" }, vrf: { enabled: false, name: "vrf0", tableId: "100", ports: "" }, routes: [] }
          },
          additionalInterfaces: [],
          rootDeviceHints: {}
        }
      ],
      apiVip: "10.90.0.2",
      ingressVip: "10.90.0.3",
      machineNetworkCidr: "10.90.0.0/24",
      ipStackMode: "ipv4"
    },
    ...overrides
  };
}

function renderComponent(Component, state) {
  const updateState = vi.fn();
  return render(
    <AppContext.Provider value={{ state, updateState, loading: false, startOver: vi.fn(), setState: vi.fn() }}>
      <Component />
    </AppContext.Provider>
  );
}

afterEach(cleanup);

describe('DOC-107 T1: HostInventoryStep version-neutral copy', () => {
  function renderAndExpand(minor) {
    const { container } = renderComponent(HostInventoryStep, buildState(minor));
    const heading = screen.getByText('How to gather host info (recommended)');
    const expandBtn = heading.closest('.card-header').querySelector('button');
    fireEvent.click(expandBtn);
  }

  it('rootDeviceHints label does not contain hardcoded 4.20 (locked 4.20)', () => {
    renderAndExpand('4.20');
    const hints = screen.getByText('Per-disk rootDeviceHints values');
    expect(hints.textContent).not.toMatch(/4\.20/);
  });

  it('rootDeviceHints label does not contain hardcoded 4.20 (locked 4.21)', () => {
    renderAndExpand('4.21');
    const hints = screen.getByText('Per-disk rootDeviceHints values');
    expect(hints.textContent).not.toMatch(/4\.20/);
  });

  it('rootDeviceHints label is identical for 4.20 and 4.21', () => {
    renderAndExpand('4.20');
    const text420 = screen.getByText('Per-disk rootDeviceHints values').textContent;
    cleanup();

    renderAndExpand('4.21');
    const text421 = screen.getByText('Per-disk rootDeviceHints values').textContent;
    expect(text420).toBe(text421);
  });

  it('combining hint note does not contain hardcoded 4.20 (locked 4.21)', () => {
    renderAndExpand('4.21');
    const note = screen.getByText(/allows combining multiple root device hints/);
    expect(note.textContent).not.toMatch(/4\.20/);
  });

  it('combining hint note is version-neutral', () => {
    renderAndExpand('4.20');
    const note = screen.getByText(/allows combining multiple root device hints/);
    expect(note.textContent).toMatch(/^OpenShift allows combining/);
  });
});

describe('DOC-107 T1: TrustProxyStep version-neutral copy', () => {
  function trustState(minor) {
    return buildState(minor, {
      ui: {
        ...buildState(minor).ui,
        activeStepId: "trust-proxy"
      },
      trust: {}
    });
  }

  it('additionalTrustBundlePolicy note does not contain hardcoded "(OpenShift 4.20)" (locked 4.20)', () => {
    renderComponent(TrustProxyStep, trustState('4.20'));
    const notes = screen.queryAllByText(/additionalTrustBundlePolicy/);
    for (const el of notes) {
      expect(el.textContent).not.toMatch(/\(OpenShift 4\.20\)/);
    }
  });

  it('additionalTrustBundlePolicy note does not contain hardcoded "(OpenShift 4.20)" (locked 4.21)', () => {
    renderComponent(TrustProxyStep, trustState('4.21'));
    const notes = screen.queryAllByText(/additionalTrustBundlePolicy/);
    for (const el of notes) {
      expect(el.textContent).not.toMatch(/\(OpenShift 4\.20\)/);
    }
  });
});

describe('DOC-107 T1: GlobalStrategyStep version-neutral copy', () => {
  function globalState(minor) {
    return buildState(minor, {
      ui: {
        ...buildState(minor).ui,
        activeStepId: "global-strategy"
      },
      globalStrategy: {
        ...buildState(minor).globalStrategy,
        proxyEnabled: true,
        proxies: { httpProxy: "http://proxy:8080", httpsProxy: "", noProxy: "" }
      },
      trust: {
        proxyCaPem: "-----BEGIN CERTIFICATE-----\nMOCK\n-----END CERTIFICATE-----",
        additionalTrustBundlePolicy: "Proxyonly"
      }
    });
  }

  it('trust bundle policy note does not contain "OpenShift 4.20 default" (locked 4.20)', () => {
    renderComponent(GlobalStrategyStep, globalState('4.20'));
    const proxyOnly = screen.queryAllByText(/Proxyonly/);
    for (const el of proxyOnly) {
      expect(el.textContent).not.toMatch(/OpenShift 4\.20 default/);
    }
  });

  it('trust bundle policy note does not contain "OpenShift 4.20 default" (locked 4.21)', () => {
    renderComponent(GlobalStrategyStep, globalState('4.21'));
    const proxyOnly = screen.queryAllByText(/Proxyonly/);
    for (const el of proxyOnly) {
      expect(el.textContent).not.toMatch(/OpenShift 4\.20 default/);
    }
  });

  it('trust bundle policy note uses version-neutral wording', () => {
    renderComponent(GlobalStrategyStep, globalState('4.20'));
    const noteContainer = screen.getByText(/default for many proxy-only CA cases/);
    expect(noteContainer.textContent).toMatch(/\(default for many proxy-only CA cases\)/);
  });
});
