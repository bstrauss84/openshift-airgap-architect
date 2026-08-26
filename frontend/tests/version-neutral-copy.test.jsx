import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { AppContext } from '../src/store.jsx';
import { stateWithBlueprintCompleteMethodologyIncomplete } from './fixtures/minimalState.js';

import HostInventoryStep from '../src/steps/HostInventoryStep.jsx';
import TrustProxyStep from '../src/steps/TrustProxyStep.jsx';
import GlobalStrategyStep from '../src/steps/GlobalStrategyStep.jsx';
import AboutModal from '../src/components/AboutModal.jsx';
import { getNewestSupportedMinor } from '../src/shared/versionPolicy.js';
import HostInventoryV2Step from '../src/steps/HostInventoryV2Step.jsx';
import PlatformSpecificsStep from '../src/steps/PlatformSpecificsStep.jsx';
import NetworkingV2Step from '../src/steps/NetworkingV2Step.jsx';
import { NodeDrawerAgentContent } from '../src/components/NodeDrawerAgentContent.jsx';

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

describe('DOC-107 T2: AboutModal docs link uses current supported version', () => {
  it('OpenShift Documentation link uses getNewestSupportedMinor()', () => {
    render(<AboutModal isOpen={true} onClose={() => {}} />);
    const link = screen.getByRole('link', { name: /OpenShift Documentation/i });
    const newest = getNewestSupportedMinor();
    expect(link.href).toContain(`openshift_container_platform/${newest}/`);
  });

  it('OpenShift Documentation link reflects established 4.21 supported-minor policy', () => {
    expect(getNewestSupportedMinor()).toBe('4.21');
    render(<AboutModal isOpen={true} onClose={() => {}} />);
    const link = screen.getByRole('link', { name: /OpenShift Documentation/i });
    expect(link.href).toContain('openshift_container_platform/4.21/');
    expect(link.href).not.toContain('openshift_container_platform/4.20/');
  });
});

describe('DOC-107 T2: HostInventoryV2Step version-neutral copy', () => {
  function buildAgentState(minor) {
    return buildState(minor, {
      blueprint: { platform: 'Bare Metal', architecture: 'x86_64' },
      methodology: { method: 'Agent-Based Installer' },
      ui: {
        ...buildState(minor).ui,
        activeStepId: 'hosts-inventory-v2'
      }
    });
  }

  it('rootDeviceHints label does not contain hardcoded 4.20 (locked 4.20)', () => {
    renderComponent(HostInventoryV2Step, buildAgentState('4.20'));
    const hints = screen.getByText('Per-disk rootDeviceHints values');
    expect(hints.textContent).not.toMatch(/4\.20/);
  });

  it('rootDeviceHints label does not contain hardcoded 4.20 (locked 4.21)', () => {
    renderComponent(HostInventoryV2Step, buildAgentState('4.21'));
    const hints = screen.getByText('Per-disk rootDeviceHints values');
    expect(hints.textContent).not.toMatch(/4\.20/);
  });

  it('combining hint note is version-neutral (locked 4.20)', () => {
    renderComponent(HostInventoryV2Step, buildAgentState('4.20'));
    const note = screen.getByText(/allows combining multiple root device hints/);
    expect(note.textContent).toMatch(/^OpenShift allows combining/);
    expect(note.textContent).not.toMatch(/4\.20/);
  });

  it('combining hint note is version-neutral (locked 4.21)', () => {
    renderComponent(HostInventoryV2Step, buildAgentState('4.21'));
    const note = screen.getByText(/allows combining multiple root device hints/);
    expect(note.textContent).toMatch(/^OpenShift allows combining/);
    expect(note.textContent).not.toMatch(/4\.20/);
  });
});

describe('DOC-107 T2: HostInventoryV2Step SNO note version-neutral', () => {
  function buildSnoTestState(minor) {
    return buildState(minor, {
      blueprint: { platform: 'Bare Metal', architecture: 'x86_64' },
      methodology: { method: 'Agent-Based Installer' },
      ui: {
        ...buildState(minor).ui,
        activeStepId: 'hosts-inventory-v2'
      },
      hostInventory: {
        nodes: [],
        apiVip: '',
        ingressVip: '',
        machineNetworkCidr: '',
        ipStackMode: 'ipv4'
      }
    });
  }

  it('SNO note is version-neutral (locked 4.20)', () => {
    renderComponent(HostInventoryV2Step, buildSnoTestState('4.20'));
    const cpInput = screen.getByRole('spinbutton', { name: /Control plane/ });
    fireEvent.change(cpInput, { target: { value: '1' } });
    const note = screen.getByText(/Single-node OpenShift uses one control plane/);
    expect(note.textContent).not.toMatch(/4\.20/);
    expect(note.textContent).not.toMatch(/4\.21/);
  });

  it('SNO note is version-neutral (locked 4.21)', () => {
    renderComponent(HostInventoryV2Step, buildSnoTestState('4.21'));
    const cpInput = screen.getByRole('spinbutton', { name: /Control plane/ });
    fireEvent.change(cpInput, { target: { value: '1' } });
    const note = screen.getByText(/Single-node OpenShift uses one control plane/);
    expect(note.textContent).not.toMatch(/4\.20/);
    expect(note.textContent).not.toMatch(/4\.21/);
  });
});

describe('DOC-107 T3: PlatformSpecificsStep DOCSRC version-neutral copy', () => {
  function buildAwsGovcloudState(minor) {
    return buildState(minor, {
      blueprint: { platform: 'AWS GovCloud', architecture: 'x86_64' },
      methodology: { method: 'IPI' },
      ui: {
        ...buildState(minor).ui,
        activeStepId: 'platform-specifics'
      },
      platformConfig: {}
    });
  }

  function buildVsphereIpiState(minor, platformConfigOverrides = {}) {
    return buildState(minor, {
      blueprint: { platform: 'VMware vSphere', architecture: 'x86_64' },
      methodology: { method: 'IPI' },
      ui: {
        ...buildState(minor).ui,
        activeStepId: 'platform-specifics'
      },
      platformConfig: platformConfigOverrides
    });
  }

  function clickInfoIconNearLabel(container, labelFragment) {
    const rows = container.querySelectorAll('.field-with-info-row, .field-label-with-info');
    for (const row of rows) {
      if (row.textContent.includes(labelFragment)) {
        const btn = row.querySelector('.field-info-icon');
        if (btn) {
          fireEvent.click(btn);
          return true;
        }
      }
    }
    return false;
  }

  it('AWS root volume subtitle is version-neutral (locked 4.20)', () => {
    renderComponent(PlatformSpecificsStep, buildAwsGovcloudState('4.20'));
    const note = screen.getByText(/see compute\.platform\.aws\.rootVolume/);
    expect(note.textContent).not.toMatch(/4\.20 doc/);
  });

  it('AWS root volume subtitle is version-neutral (locked 4.21)', () => {
    renderComponent(PlatformSpecificsStep, buildAwsGovcloudState('4.21'));
    const note = screen.getByText(/see compute\.platform\.aws\.rootVolume/);
    expect(note.textContent).not.toMatch(/4\.20 doc/);
  });

  it('vSphere placement subtitle is version-neutral (locked 4.20)', () => {
    renderComponent(PlatformSpecificsStep, buildVsphereIpiState('4.20'));
    const note = screen.getByText(/Choose failure domains \(recommended\)/);
    expect(note.textContent).not.toMatch(/4\.20/);
    expect(note.textContent).not.toMatch(/4\.21/);
  });

  it('vSphere placement subtitle is version-neutral (locked 4.21)', () => {
    renderComponent(PlatformSpecificsStep, buildVsphereIpiState('4.21'));
    const note = screen.getByText(/Choose failure domains \(recommended\)/);
    expect(note.textContent).not.toMatch(/4\.20/);
    expect(note.textContent).not.toMatch(/4\.21/);
  });

  it('vSphere folder deprecation hint is version-neutral (locked 4.20)', () => {
    const { container } = renderComponent(PlatformSpecificsStep,
      buildVsphereIpiState('4.20', { vsphere: { placementMode: 'legacy' } }));
    fireEvent.click(screen.getByRole('button', { name: 'Expand Advanced' }));
    const clicked = clickInfoIconNearLabel(container, 'vSphere folder');
    expect(clicked).toBe(true);
    const popover = document.body.querySelector('.field-help-popover-content, .field-tooltip-content');
    expect(popover).not.toBeNull();
    expect(popover.textContent).toContain('deprecates global folder');
    expect(popover.textContent).not.toMatch(/OpenShift 4\.20 documentation/);
  });

  it('vSphere folder deprecation hint is version-neutral (locked 4.21)', () => {
    const { container } = renderComponent(PlatformSpecificsStep,
      buildVsphereIpiState('4.21', { vsphere: { placementMode: 'legacy' } }));
    fireEvent.click(screen.getByRole('button', { name: 'Expand Advanced' }));
    const clicked = clickInfoIconNearLabel(container, 'vSphere folder');
    expect(clicked).toBe(true);
    const popover = document.body.querySelector('.field-help-popover-content, .field-tooltip-content');
    expect(popover).not.toBeNull();
    expect(popover.textContent).toContain('deprecates global folder');
    expect(popover.textContent).not.toMatch(/OpenShift 4\.20 documentation/);
  });

  it('feature gates hint shows dynamic version 4.20 (locked 4.20)', () => {
    const { container } = renderComponent(PlatformSpecificsStep,
      buildVsphereIpiState('4.20', { featureSet: 'CustomNoUpgrade' }));
    fireEvent.click(screen.getByRole('button', { name: 'Expand Advanced' }));
    const clicked = clickInfoIconNearLabel(container, 'Feature gates');
    expect(clicked).toBe(true);
    const popover = document.body.querySelector('.field-help-popover-content, .field-tooltip-content');
    expect(popover).not.toBeNull();
    expect(popover.textContent).toContain('OpenShift 4.20 documentation');
  });

  it('feature gates hint shows dynamic version 4.21 (locked 4.21)', () => {
    const { container } = renderComponent(PlatformSpecificsStep,
      buildVsphereIpiState('4.21', { featureSet: 'CustomNoUpgrade' }));
    fireEvent.click(screen.getByRole('button', { name: 'Expand Advanced' }));
    const clicked = clickInfoIconNearLabel(container, 'Feature gates');
    expect(clicked).toBe(true);
    const popover = document.body.querySelector('.field-help-popover-content, .field-tooltip-content');
    expect(popover).not.toBeNull();
    expect(popover.textContent).toContain('OpenShift 4.21 documentation');
    expect(popover.textContent).not.toContain('OpenShift 4.20 documentation');
  });
});

describe('DOC-107 T4: NetworkingV2Step version-neutral copy', () => {
  function buildNetworkingState(minor, overrides = {}) {
    return buildState(minor, {
      ui: {
        ...buildState(minor).ui,
        activeStepId: 'networking-v2'
      },
      ...overrides
    });
  }

  function buildIbmCloudState(minor) {
    return buildNetworkingState(minor, {
      blueprint: { platform: 'IBM Cloud', architecture: 'x86_64' },
      methodology: { method: 'IPI' }
    });
  }

  function buildBareMetalAgentState(minor, ipStack = 'ipv4') {
    const base = buildState(minor);
    const masterNode = base.hostInventory.nodes[0];
    return buildNetworkingState(minor, {
      blueprint: { platform: 'Bare Metal', architecture: 'x86_64' },
      methodology: { method: 'Agent-Based Installer' },
      hostInventory: {
        ...base.hostInventory,
        ipStackMode: ipStack,
        nodes: [
          { ...masterNode, hostname: 'm0' },
          { ...masterNode, hostname: 'm1' },
          { ...masterNode, hostname: 'm2' }
        ]
      }
    });
  }

  function buildNutanixIpiState(minor) {
    return buildNetworkingState(minor, {
      blueprint: { platform: 'Nutanix', architecture: 'x86_64' },
      methodology: { method: 'IPI' }
    });
  }

  function buildBareMetalIpiState(minor, ipStack = 'ipv4') {
    return buildNetworkingState(minor, {
      blueprint: { platform: 'Bare Metal', architecture: 'x86_64' },
      methodology: { method: 'IPI' },
      hostInventory: {
        ...buildState(minor).hostInventory,
        ipStackMode: ipStack
      }
    });
  }

  it('IBM Cloud banner is version-neutral (locked 4.20)', () => {
    renderComponent(NetworkingV2Step, buildIbmCloudState('4.20'));
    const banner = screen.getByText(/IBM Cloud disconnected install documents IPv4-only/);
    expect(banner.textContent).not.toMatch(/4\.20/);
  });

  it('IBM Cloud banner is version-neutral (locked 4.21)', () => {
    renderComponent(NetworkingV2Step, buildIbmCloudState('4.21'));
    const banner = screen.getByText(/IBM Cloud disconnected install documents IPv4-only/);
    expect(banner.textContent).not.toMatch(/4\.20/);
  });

  it('IPv4-only scenario note is version-neutral (locked 4.20)', () => {
    renderComponent(NetworkingV2Step, buildIbmCloudState('4.20'));
    const note = screen.getByText(/This scenario supports IPv4-only networking/);
    expect(note.textContent).not.toMatch(/4\.20/);
  });

  it('IPv4-only scenario note is version-neutral (locked 4.21)', () => {
    renderComponent(NetworkingV2Step, buildIbmCloudState('4.21'));
    const note = screen.getByText(/This scenario supports IPv4-only networking/);
    expect(note.textContent).not.toMatch(/4\.20/);
  });

  it('IPv6-only mode note is version-neutral (locked 4.20)', () => {
    renderComponent(NetworkingV2Step, buildBareMetalAgentState('4.20', 'ipv6'));
    const note = screen.getByText(/OpenShift supports IPv6-only deployments/);
    expect(note.textContent).not.toMatch(/4\.20/);
  });

  it('IPv6-only mode note is version-neutral (locked 4.21)', () => {
    renderComponent(NetworkingV2Step, buildBareMetalAgentState('4.21', 'ipv6'));
    const note = screen.getByText(/OpenShift supports IPv6-only deployments/);
    expect(note.textContent).not.toMatch(/4\.20/);
  });

  it('dual-stack mode note is version-neutral (locked 4.20)', () => {
    renderComponent(NetworkingV2Step, buildBareMetalAgentState('4.20', 'dual-stack'));
    const note = screen.getByText(/OpenShift documents dual-stack install-config/);
    expect(note.textContent).not.toMatch(/4\.20/);
  });

  it('dual-stack mode note is version-neutral (locked 4.21)', () => {
    renderComponent(NetworkingV2Step, buildBareMetalAgentState('4.21', 'dual-stack'));
    const note = screen.getByText(/OpenShift documents dual-stack install-config/);
    expect(note.textContent).not.toMatch(/4\.20/);
  });

  it('Nutanix VIP note is version-neutral (locked 4.20)', () => {
    renderComponent(NetworkingV2Step, buildNutanixIpiState('4.20'));
    const note = screen.getByText(/Nutanix IPI requires static API and Ingress VIPs/);
    expect(note.textContent).not.toMatch(/4\.20/);
  });

  it('Nutanix VIP note is version-neutral (locked 4.21)', () => {
    renderComponent(NetworkingV2Step, buildNutanixIpiState('4.21'));
    const note = screen.getByText(/Nutanix IPI requires static API and Ingress VIPs/);
    expect(note.textContent).not.toMatch(/4\.20/);
  });

  it('bare metal agent dual-stack VIP note is version-neutral (locked 4.20)', () => {
    renderComponent(NetworkingV2Step, buildBareMetalAgentState('4.20', 'dual-stack'));
    const note = screen.getByText(/Install-config guidance requires IPv4 entries before IPv6/);
    expect(note.textContent).not.toMatch(/4\.20/);
  });

  it('bare metal agent dual-stack VIP note is version-neutral (locked 4.21)', () => {
    renderComponent(NetworkingV2Step, buildBareMetalAgentState('4.21', 'dual-stack'));
    const note = screen.getByText(/Install-config guidance requires IPv4 entries before IPv6/);
    expect(note.textContent).not.toMatch(/4\.20/);
  });

  it('bare metal IPI dual-stack VIP note is version-neutral (locked 4.20)', () => {
    renderComponent(NetworkingV2Step, buildBareMetalIpiState('4.20', 'dual-stack'));
    const note = screen.getByText(/install-config apiVIPs\/ingressVIPs list order is IPv4 then IPv6/);
    expect(note.textContent).not.toMatch(/4\.20/);
  });

  it('bare metal IPI dual-stack VIP note is version-neutral (locked 4.21)', () => {
    renderComponent(NetworkingV2Step, buildBareMetalIpiState('4.21', 'dual-stack'));
    const note = screen.getByText(/install-config apiVIPs\/ingressVIPs list order is IPv4 then IPv6/);
    expect(note.textContent).not.toMatch(/4\.20/);
  });
});

describe('DOC-107 T4: NodeDrawerAgentContent version-neutral copy', () => {
  const ROLE_OPTIONS = [
    { value: 'master', label: 'Control plane' },
    { value: 'worker', label: 'Worker' }
  ];

  function buildMinimalNode() {
    return {
      role: 'master', hostname: 'm0', rootDevice: '',
      dnsServers: '', dnsSearch: '',
      bmc: { address: '', username: '', password: '', bootMACAddress: '' },
      primary: {
        type: 'ethernet', mode: 'dhcp',
        ipv4Cidr: '', ipv4Gateway: '', ipv6Cidr: '', ipv6Gateway: '',
        ethernet: { name: 'eno1', macAddress: '52:54:00:aa:bb:01' },
        bond: { name: 'bond0', mode: 'active-backup', slaves: [{ name: 'eth0', macAddress: '' }] },
        vlan: { id: '', baseIface: '', name: '' },
        advanced: { mtu: '1500', sriov: { enabled: false }, vrf: { enabled: false }, routes: [] }
      },
      additionalInterfaces: [],
      rootDeviceHints: {}
    };
  }

  it('BMC description is version-neutral (locked 4.20)', () => {
    render(
      <NodeDrawerAgentContent
        node={buildMinimalNode()}
        scenarioId="bare-metal-agent"
        isAgentInventoryScenario={true}
        updateNode={vi.fn()}
        selectedIndex={0}
        handleNodeFieldChange={vi.fn()}
        runNodeValidation={vi.fn()}
        validationResults={{}}
        mergedNodeValidation={{}}
        enableIpv6={false}
        effectiveHostname="m0"
        showHostname={true}
        showAgentDay2InstallConfigBmc={true}
        roleOptions={ROLE_OPTIONS}
      />
    );
    const desc = screen.getByText(/Day-2 seed/);
    expect(desc.textContent).not.toMatch(/4\.20/);
    expect(desc.textContent).toContain('§9.1.4');
  });

  it('BMC description is version-neutral (locked 4.21)', () => {
    render(
      <NodeDrawerAgentContent
        node={buildMinimalNode()}
        scenarioId="bare-metal-agent"
        isAgentInventoryScenario={true}
        updateNode={vi.fn()}
        selectedIndex={0}
        handleNodeFieldChange={vi.fn()}
        runNodeValidation={vi.fn()}
        validationResults={{}}
        mergedNodeValidation={{}}
        enableIpv6={false}
        effectiveHostname="m0"
        showHostname={true}
        showAgentDay2InstallConfigBmc={true}
        roleOptions={ROLE_OPTIONS}
      />
    );
    const desc = screen.getByText(/Day-2 seed/);
    expect(desc.textContent).not.toMatch(/4\.20/);
    expect(desc.textContent).toContain('§9.1.4');
  });
});
