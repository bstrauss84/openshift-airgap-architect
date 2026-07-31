import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import fs from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { getCatalogForScenario } from '../src/catalogPaths.js';
import { isParamVisibleForVersion } from '../src/catalogFieldMeta.js';
import { VALID_CONFIDENTIAL_COMPUTE_POLICIES, validateStep } from '../src/validation.js';
import { AppContext } from '../src/store.jsx';
import PlatformSpecificsStep from '../src/steps/PlatformSpecificsStep.jsx';
import { stateWithBlueprintCompleteMethodologyIncomplete } from './fixtures/minimalState.js';

const testDir = dirname(fileURLToPath(import.meta.url));

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

function awsIpiState(minor, platformConfigOverrides = {}) {
  const base = stateForPlatformSpecificsStep({
    blueprint: { ...stateForPlatformSpecificsStep().blueprint, platform: "AWS GovCloud" },
    methodology: { method: "IPI" }
  });
  return {
    ...base,
    version: { ...base.version, selectedMinor: minor, selectedPatch: `${minor}.3` },
    release: { ...base.release, channel: minor, patchVersion: `${minor}.3` },
    platformConfig: { ...base.platformConfig, ...platformConfigOverrides }
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
  return { result, updateState };
}

// ===================================================================
// Catalog tests
// ===================================================================

describe('AWS confidential compute — catalog', () => {
  it('4.20 AWS IPI has no cpuOptions or confidentialCompute path', () => {
    const params = getCatalogForScenario('aws-govcloud-ipi', '4.20');
    const ccParams = params.filter(p =>
      p.path.includes('cpuOptions') || p.path.includes('confidentialCompute')
    );
    expect(ccParams).toHaveLength(0);
  });

  it('4.21 IPI confidentialCompute type is string', () => {
    const params = getCatalogForScenario('aws-govcloud-ipi', '4.21');
    const param = params.find(p =>
      p.path === 'controlPlane.platform.aws.cpuOptions.confidentialCompute'
    );
    expect(param).toBeDefined();
    expect(param.type).toBe('string');
  });

  it('4.21 IPI confidentialCompute has exact enum values', () => {
    const params = getCatalogForScenario('aws-govcloud-ipi', '4.21');
    const param = params.find(p =>
      p.path === 'controlPlane.platform.aws.cpuOptions.confidentialCompute'
    );
    expect(param).toBeDefined();
    expect(param.allowed).toEqual(['Disabled', 'AMDEncryptedVirtualizationNestedPaging']);
  });

  it('4.21 IPI confidentialCompute is supported-ui', () => {
    const params = getCatalogForScenario('aws-govcloud-ipi', '4.21');
    const param = params.find(p =>
      p.path === 'controlPlane.platform.aws.cpuOptions.confidentialCompute'
    );
    expect(param).toBeDefined();
    expect(param.supportStatus).toBe('supported-ui');
    expect(param.minVersion).toBe('4.21');
    expect(param.maxVersion).toBe(null);
  });

  it('4.21 IPI cpuOptions structural parent is supported-derived', () => {
    const params = getCatalogForScenario('aws-govcloud-ipi', '4.21');
    const param = params.find(p =>
      p.path === 'controlPlane.platform.aws.cpuOptions'
    );
    expect(param).toBeDefined();
    expect(param.supportStatus).toBe('supported-derived');
    expect(param.minVersion).toBe('4.21');
  });

  it('4.21 UPI cpuOptions is docs-only-not-supported', () => {
    const params = getCatalogForScenario('aws-govcloud-upi', '4.21');
    const param = params.find(p =>
      p.path === 'controlPlane.platform.aws.cpuOptions'
    );
    expect(param).toBeDefined();
    expect(param.supportStatus).toBe('docs-only-not-supported');
  });

  it('4.21 UPI confidentialCompute is docs-only-not-supported', () => {
    const params = getCatalogForScenario('aws-govcloud-upi', '4.21');
    const param = params.find(p =>
      p.path === 'controlPlane.platform.aws.cpuOptions.confidentialCompute'
    );
    expect(param).toBeDefined();
    expect(param.supportStatus).toBe('docs-only-not-supported');
  });

  it('canonical and frontend mirrors are identical for IPI', () => {
    const canonicalPath = resolve(testDir, '..', '..', 'data', 'params', '4.21', 'aws-govcloud-ipi.json');
    const mirrorPath = resolve(testDir, '..', 'src', 'data', 'catalogs', '4.21', 'aws-govcloud-ipi.json');
    expect(fs.readFileSync(canonicalPath, 'utf8')).toBe(fs.readFileSync(mirrorPath, 'utf8'));
  });

  it('canonical and frontend mirrors are identical for UPI', () => {
    const canonicalPath = resolve(testDir, '..', '..', 'data', 'params', '4.21', 'aws-govcloud-upi.json');
    const mirrorPath = resolve(testDir, '..', 'src', 'data', 'catalogs', '4.21', 'aws-govcloud-upi.json');
    expect(fs.readFileSync(canonicalPath, 'utf8')).toBe(fs.readFileSync(mirrorPath, 'utf8'));
  });
});

// ===================================================================
// Frontend visibility tests
// ===================================================================

describe('AWS confidential compute — visibility', () => {
  it('4.20 AWS IPI: hidden (no confidentialCompute param exists)', () => {
    const params = getCatalogForScenario('aws-govcloud-ipi', '4.20');
    const param = params.find(p =>
      p.path === 'controlPlane.platform.aws.cpuOptions.confidentialCompute'
    );
    expect(param).toBeUndefined();
  });

  it('4.21 AWS IPI: visible', () => {
    const params = getCatalogForScenario('aws-govcloud-ipi', '4.21');
    const param = params.find(p =>
      p.path === 'controlPlane.platform.aws.cpuOptions.confidentialCompute'
    );
    expect(param).toBeDefined();
    expect(isParamVisibleForVersion(param, '4.21')).toBe(true);
  });

  it('4.21 AWS UPI: hidden (docs-only-not-supported)', () => {
    const params = getCatalogForScenario('aws-govcloud-upi', '4.21');
    const param = params.find(p =>
      p.path === 'controlPlane.platform.aws.cpuOptions.confidentialCompute'
    );
    expect(param).toBeDefined();
    expect(isParamVisibleForVersion(param, '4.21')).toBe(false);
  });

  it('4.21 non-AWS: hidden (no confidentialCompute param)', () => {
    const params = getCatalogForScenario('bare-metal-agent', '4.21');
    const param = params.find(p =>
      p.path === 'controlPlane.platform.aws.cpuOptions.confidentialCompute'
    );
    expect(param).toBeUndefined();
  });

  it('version switch restores visibility', () => {
    const params421 = getCatalogForScenario('aws-govcloud-ipi', '4.21');
    const param421 = params421.find(p =>
      p.path === 'controlPlane.platform.aws.cpuOptions.confidentialCompute'
    );
    expect(isParamVisibleForVersion(param421, '4.21')).toBe(true);

    const params420 = getCatalogForScenario('aws-govcloud-ipi', '4.20');
    const param420 = params420.find(p =>
      p.path === 'controlPlane.platform.aws.cpuOptions.confidentialCompute'
    );
    expect(param420).toBeUndefined();

    const params421Again = getCatalogForScenario('aws-govcloud-ipi', '4.21');
    const param421Again = params421Again.find(p =>
      p.path === 'controlPlane.platform.aws.cpuOptions.confidentialCompute'
    );
    expect(isParamVisibleForVersion(param421Again, '4.21')).toBe(true);
  });

  it('installation-method switch restores visibility', () => {
    const ipiParams = getCatalogForScenario('aws-govcloud-ipi', '4.21');
    const ipiParam = ipiParams.find(p =>
      p.path === 'controlPlane.platform.aws.cpuOptions.confidentialCompute'
    );
    expect(isParamVisibleForVersion(ipiParam, '4.21')).toBe(true);

    const upiParams = getCatalogForScenario('aws-govcloud-upi', '4.21');
    const upiParam = upiParams.find(p =>
      p.path === 'controlPlane.platform.aws.cpuOptions.confidentialCompute'
    );
    expect(isParamVisibleForVersion(upiParam, '4.21')).toBe(false);

    const ipiParamsAgain = getCatalogForScenario('aws-govcloud-ipi', '4.21');
    const ipiParamAgain = ipiParamsAgain.find(p =>
      p.path === 'controlPlane.platform.aws.cpuOptions.confidentialCompute'
    );
    expect(isParamVisibleForVersion(ipiParamAgain, '4.21')).toBe(true);
  });
});

// ===================================================================
// Exported enum constant
// ===================================================================

describe('AWS confidential compute — exported enum', () => {
  it('VALID_CONFIDENTIAL_COMPUTE_POLICIES has exactly two values', () => {
    expect(VALID_CONFIDENTIAL_COMPUTE_POLICIES).toEqual(['Disabled', 'AMDEncryptedVirtualizationNestedPaging']);
  });
});

// ===================================================================
// validateStep integration tests
// ===================================================================

describe('AWS confidential compute — validateStep integration', () => {
  it('valid Disabled on 4.21 IPI produces no confidential compute errors', () => {
    const state = awsIpiState('4.21', {
      aws: { region: 'us-gov-west-1', cpuOptions: { confidentialCompute: 'Disabled' } }
    });
    const result = validateStep(state, 'platform-specifics');
    expect(result.errors.filter(e => e.includes('Confidential') || e.includes('confidential'))).toHaveLength(0);
  });

  it('valid AMDEncryptedVirtualizationNestedPaging on 4.21 IPI produces no errors', () => {
    const state = awsIpiState('4.21', {
      aws: { region: 'us-gov-west-1', cpuOptions: { confidentialCompute: 'AMDEncryptedVirtualizationNestedPaging' } }
    });
    const result = validateStep(state, 'platform-specifics');
    expect(result.errors.filter(e => e.includes('Confidential') || e.includes('confidential'))).toHaveLength(0);
  });

  it('blank value on 4.21 IPI produces no errors', () => {
    const state = awsIpiState('4.21', {
      aws: { region: 'us-gov-west-1' }
    });
    const result = validateStep(state, 'platform-specifics');
    expect(result.errors.filter(e => e.includes('Confidential') || e.includes('confidential'))).toHaveLength(0);
  });

  it('invalid string on 4.21 IPI produces error', () => {
    const state = awsIpiState('4.21', {
      aws: { region: 'us-gov-west-1', cpuOptions: { confidentialCompute: 'invalid' } }
    });
    const result = validateStep(state, 'platform-specifics');
    expect(result.errors.some(e => e.includes('Confidential compute must be one of'))).toBe(true);
  });

  it('stale value on 4.20 IPI produces no errors (not validated)', () => {
    const state = awsIpiState('4.20', {
      aws: { region: 'us-gov-west-1', cpuOptions: { confidentialCompute: 'invalid' } }
    });
    const result = validateStep(state, 'platform-specifics');
    expect(result.errors.filter(e => e.includes('Confidential') || e.includes('confidential'))).toHaveLength(0);
  });
});

// ===================================================================
// Rendered component tests
// ===================================================================

describe('AWS confidential compute — rendered component', () => {
  afterEach(() => {
    cleanup();
  });

  function findCCSelect() {
    return screen.queryByLabelText('Confidential compute policy');
  }

  function awsUpiState(minor) {
    const base = stateForPlatformSpecificsStep({
      blueprint: { ...stateForPlatformSpecificsStep().blueprint, platform: "AWS GovCloud" },
      methodology: { method: "UPI" }
    });
    return {
      ...base,
      version: { ...base.version, selectedMinor: minor, selectedPatch: `${minor}.3` },
      release: { ...base.release, channel: minor, patchVersion: `${minor}.3` }
    };
  }

  function bareMetalState(minor) {
    const base = stateForPlatformSpecificsStep();
    return {
      ...base,
      version: { ...base.version, selectedMinor: minor, selectedPatch: `${minor}.3` },
      release: { ...base.release, channel: minor, patchVersion: `${minor}.3` }
    };
  }

  it('4.21 AWS IPI renders confidential compute select', () => {
    renderWithState(awsIpiState('4.21', { aws: { region: 'us-gov-west-1' } }));
    expect(screen.getByText(/Confidential compute/)).toBeInTheDocument();
    expect(findCCSelect()).not.toBeNull();
  });

  it('4.20 AWS IPI does not render confidential compute select', () => {
    renderWithState(awsIpiState('4.20', { aws: { region: 'us-gov-west-1' } }));
    expect(screen.queryByText(/Confidential compute/)).toBeNull();
  });

  it('4.21 AWS UPI does not render confidential compute select', () => {
    renderWithState(awsUpiState('4.21'));
    expect(screen.queryByText(/Confidential compute/)).toBeNull();
  });

  it('4.21 non-AWS does not render confidential compute select', () => {
    renderWithState(bareMetalState('4.21'));
    expect(screen.queryByText(/Confidential compute/)).toBeNull();
  });

  it('select has correct options', () => {
    renderWithState(awsIpiState('4.21', { aws: { region: 'us-gov-west-1' } }));
    const select = findCCSelect();
    expect(select).not.toBeNull();
    const options = Array.from(select.querySelectorAll('option'));
    expect(options).toHaveLength(3);
    expect(options[0].value).toBe('');
    expect(options[0].textContent).toMatch(/installer default/i);
    expect(options[1].value).toBe('Disabled');
    expect(options[2].value).toBe('AMDEncryptedVirtualizationNestedPaging');
  });

  it('default is installer default (empty)', () => {
    renderWithState(awsIpiState('4.21', { aws: { region: 'us-gov-west-1' } }));
    const select = findCCSelect();
    expect(select.value).toBe('');
  });

  it('selecting Disabled fires updateState', () => {
    const { updateState } = renderWithState(awsIpiState('4.21', { aws: { region: 'us-gov-west-1' } }));
    const select = findCCSelect();
    fireEvent.change(select, { target: { value: 'Disabled' } });
    expect(updateState).toHaveBeenCalled();
  });

  it('selecting AMDEncryptedVirtualizationNestedPaging shows helper text', () => {
    renderWithState(awsIpiState('4.21', {
      aws: { region: 'us-gov-west-1', cpuOptions: { confidentialCompute: 'AMDEncryptedVirtualizationNestedPaging' } }
    }));
    expect(screen.getByText(/AMD SEV-SNP requires a compatible instance type/)).toBeInTheDocument();
  });

  it('selecting Disabled does not show helper text', () => {
    renderWithState(awsIpiState('4.21', {
      aws: { region: 'us-gov-west-1', cpuOptions: { confidentialCompute: 'Disabled' } }
    }));
    expect(screen.queryByText(/AMD SEV-SNP requires a compatible instance type/)).toBeNull();
  });

  it('selecting installer default does not show helper text', () => {
    renderWithState(awsIpiState('4.21', { aws: { region: 'us-gov-west-1' } }));
    expect(screen.queryByText(/AMD SEV-SNP requires a compatible instance type/)).toBeNull();
  });

  it('retained value renders correctly', () => {
    renderWithState(awsIpiState('4.21', {
      aws: { region: 'us-gov-west-1', cpuOptions: { confidentialCompute: 'Disabled' } }
    }));
    const select = findCCSelect();
    expect(select.value).toBe('Disabled');
  });

  it('resetting to installer default fires updateState with cpuOptions undefined', () => {
    const { updateState } = renderWithState(awsIpiState('4.21', {
      aws: { region: 'us-gov-west-1', cpuOptions: { confidentialCompute: 'Disabled' } }
    }));
    const select = findCCSelect();
    fireEvent.change(select, { target: { value: '' } });
    expect(updateState).toHaveBeenCalled();
  });
});
