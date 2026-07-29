import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import fs from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { getCatalogForScenario } from '../src/catalogPaths.js';
import { isParamVisibleForVersion } from '../src/catalogFieldMeta.js';
import { validateAwsRootVolumeThroughput, validateStep } from '../src/validation.js';
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

describe('AWS root volume throughput — catalog', () => {
  it('4.20 AWS IPI has no supported throughput UI path', () => {
    const params = getCatalogForScenario('aws-govcloud-ipi', '4.20');
    const throughputParams = params.filter(p =>
      p.path.includes('rootVolume.throughput')
    );
    expect(throughputParams).toHaveLength(0);
  });

  it('4.21 AWS IPI control-plane path is supported-ui', () => {
    const params = getCatalogForScenario('aws-govcloud-ipi', '4.21');
    const param = params.find(p =>
      p.path === 'controlPlane.platform.aws.rootVolume.throughput'
    );
    expect(param).toBeDefined();
    expect(param.supportStatus).toBe('supported-ui');
    expect(param.minVersion).toBe('4.21');
    expect(param.maxVersion).toBe(null);
  });

  it('4.21 AWS IPI compute path is supported-derived', () => {
    const params = getCatalogForScenario('aws-govcloud-ipi', '4.21');
    const param = params.find(p =>
      p.path === 'compute[].platform.aws.rootVolume.throughput'
    );
    expect(param).toBeDefined();
    expect(param.supportStatus).toBe('supported-derived');
    expect(param.minVersion).toBe('4.21');
    expect(param.maxVersion).toBe(null);
  });

  it('4.21 AWS UPI controlPlane path is docs-only-not-supported', () => {
    const params = getCatalogForScenario('aws-govcloud-upi', '4.21');
    const param = params.find(p =>
      p.path === 'controlPlane.platform.aws.rootVolume.throughput'
    );
    expect(param).toBeDefined();
    expect(param.supportStatus).toBe('docs-only-not-supported');
  });

  it('4.21 AWS UPI compute path is docs-only-not-supported', () => {
    const params = getCatalogForScenario('aws-govcloud-upi', '4.21');
    const param = params.find(p =>
      p.path === 'compute[].platform.aws.rootVolume.throughput'
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

describe('AWS root volume throughput — visibility', () => {
  it('4.20 AWS IPI: hidden (no throughput param exists)', () => {
    const params = getCatalogForScenario('aws-govcloud-ipi', '4.20');
    const param = params.find(p =>
      p.path === 'controlPlane.platform.aws.rootVolume.throughput'
    );
    expect(param).toBeUndefined();
  });

  it('4.21 AWS IPI: visible', () => {
    const params = getCatalogForScenario('aws-govcloud-ipi', '4.21');
    const param = params.find(p =>
      p.path === 'controlPlane.platform.aws.rootVolume.throughput'
    );
    expect(param).toBeDefined();
    expect(isParamVisibleForVersion(param, '4.21')).toBe(true);
  });

  it('4.21 AWS UPI: hidden (docs-only-not-supported)', () => {
    const params = getCatalogForScenario('aws-govcloud-upi', '4.21');
    const param = params.find(p =>
      p.path === 'controlPlane.platform.aws.rootVolume.throughput'
    );
    expect(param).toBeDefined();
    expect(isParamVisibleForVersion(param, '4.21')).toBe(false);
  });

  it('4.21 non-AWS: hidden (no throughput param)', () => {
    const params = getCatalogForScenario('bare-metal-agent', '4.21');
    const param = params.find(p =>
      p.path === 'controlPlane.platform.aws.rootVolume.throughput'
    );
    expect(param).toBeUndefined();
  });

  it('version switch restores visibility and retained state', () => {
    const params421 = getCatalogForScenario('aws-govcloud-ipi', '4.21');
    const param421 = params421.find(p =>
      p.path === 'controlPlane.platform.aws.rootVolume.throughput'
    );
    expect(isParamVisibleForVersion(param421, '4.21')).toBe(true);

    const params420 = getCatalogForScenario('aws-govcloud-ipi', '4.20');
    const param420 = params420.find(p =>
      p.path === 'controlPlane.platform.aws.rootVolume.throughput'
    );
    expect(param420).toBeUndefined();

    const params421Again = getCatalogForScenario('aws-govcloud-ipi', '4.21');
    const param421Again = params421Again.find(p =>
      p.path === 'controlPlane.platform.aws.rootVolume.throughput'
    );
    expect(isParamVisibleForVersion(param421Again, '4.21')).toBe(true);
  });

  it('installation-method switch restores visibility and retained state', () => {
    const ipiParams = getCatalogForScenario('aws-govcloud-ipi', '4.21');
    const ipiParam = ipiParams.find(p =>
      p.path === 'controlPlane.platform.aws.rootVolume.throughput'
    );
    expect(isParamVisibleForVersion(ipiParam, '4.21')).toBe(true);

    const upiParams = getCatalogForScenario('aws-govcloud-upi', '4.21');
    const upiParam = upiParams.find(p =>
      p.path === 'controlPlane.platform.aws.rootVolume.throughput'
    );
    expect(isParamVisibleForVersion(upiParam, '4.21')).toBe(false);

    const ipiParamsAgain = getCatalogForScenario('aws-govcloud-ipi', '4.21');
    const ipiParamAgain = ipiParamsAgain.find(p =>
      p.path === 'controlPlane.platform.aws.rootVolume.throughput'
    );
    expect(isParamVisibleForVersion(ipiParamAgain, '4.21')).toBe(true);
  });
});

// ===================================================================
// Production validation tests (validateAwsRootVolumeThroughput)
// ===================================================================

describe('AWS root volume throughput — production validation', () => {
  it('125 accepted', () => {
    const result = validateAwsRootVolumeThroughput(125, 'gp3');
    expect(result.valid).toBe(true);
    expect(result.value).toBe(125);
  });

  it('2000 accepted', () => {
    const result = validateAwsRootVolumeThroughput(2000, 'gp3');
    expect(result.valid).toBe(true);
    expect(result.value).toBe(2000);
  });

  it('124 rejected', () => {
    const result = validateAwsRootVolumeThroughput(124, 'gp3');
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/at least 125/);
  });

  it('2001 rejected', () => {
    const result = validateAwsRootVolumeThroughput(2001, 'gp3');
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/at most 2000/);
  });

  it('fraction rejected', () => {
    const result = validateAwsRootVolumeThroughput(125.5, 'gp3');
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/integer/);
  });

  it('non-number rejected', () => {
    const result = validateAwsRootVolumeThroughput('abc', 'gp3');
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/number/);
  });

  it('NaN rejected', () => {
    const result = validateAwsRootVolumeThroughput(NaN, 'gp3');
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/number/);
  });

  it('gp3 accepted', () => {
    const result = validateAwsRootVolumeThroughput(500, 'gp3');
    expect(result.valid).toBe(true);
  });

  it('omitted effective gp3 accepted', () => {
    expect(validateAwsRootVolumeThroughput(500, undefined).valid).toBe(true);
    expect(validateAwsRootVolumeThroughput(500, '').valid).toBe(true);
  });

  it('gp2 rejected', () => {
    const result = validateAwsRootVolumeThroughput(500, 'gp2');
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/only valid for gp3/);
  });

  it('io1 rejected', () => {
    const result = validateAwsRootVolumeThroughput(500, 'io1');
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/only valid for gp3/);
  });

  it('io2 rejected', () => {
    const result = validateAwsRootVolumeThroughput(500, 'io2');
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/only valid for gp3/);
  });

  it('blank value returns valid+blank', () => {
    expect(validateAwsRootVolumeThroughput(undefined, 'gp3')).toEqual({ valid: true, blank: true });
    expect(validateAwsRootVolumeThroughput(null, 'gp3')).toEqual({ valid: true, blank: true });
    expect(validateAwsRootVolumeThroughput('', 'gp3')).toEqual({ valid: true, blank: true });
  });
});

// ===================================================================
// validateStep integration tests
// ===================================================================

describe('AWS root volume throughput — validateStep integration', () => {
  it('valid 500 throughput on 4.21 IPI produces no errors', () => {
    const state = awsIpiState('4.21', {
      aws: { region: 'us-gov-west-1', rootVolumeThroughput: 500 }
    });
    const result = validateStep(state, 'platform-specifics');
    expect(result.errors).toHaveLength(0);
  });

  it('invalid 124 throughput on 4.21 IPI produces error', () => {
    const state = awsIpiState('4.21', {
      aws: { region: 'us-gov-west-1', rootVolumeThroughput: 124 }
    });
    const result = validateStep(state, 'platform-specifics');
    expect(result.errors.some(e => e.includes('125'))).toBe(true);
  });

  it('invalid 2001 throughput on 4.21 IPI produces error', () => {
    const state = awsIpiState('4.21', {
      aws: { region: 'us-gov-west-1', rootVolumeThroughput: 2001 }
    });
    const result = validateStep(state, 'platform-specifics');
    expect(result.errors.some(e => e.includes('2000'))).toBe(true);
  });

  it('gp2 with throughput on 4.21 IPI produces error', () => {
    const state = awsIpiState('4.21', {
      aws: { region: 'us-gov-west-1', rootVolumeThroughput: 500, rootVolumeType: 'gp2' }
    });
    const result = validateStep(state, 'platform-specifics');
    expect(result.errors.some(e => e.includes('gp3'))).toBe(true);
  });

  it('blank throughput on 4.21 IPI produces no errors', () => {
    const state = awsIpiState('4.21', {
      aws: { region: 'us-gov-west-1' }
    });
    const result = validateStep(state, 'platform-specifics');
    expect(result.errors).toHaveLength(0);
  });

  it('stale throughput on 4.20 IPI produces no errors (not validated)', () => {
    const state = awsIpiState('4.20', {
      aws: { region: 'us-gov-west-1', rootVolumeThroughput: 124 }
    });
    const result = validateStep(state, 'platform-specifics');
    expect(result.errors.filter(e => e.includes('throughput') || e.includes('125'))).toHaveLength(0);
  });
});

// ===================================================================
// Rendered component tests
// ===================================================================

describe('AWS root volume throughput — rendered component', () => {
  afterEach(() => {
    cleanup();
  });

  it('4.21 AWS IPI renders throughput input', () => {
    const state = awsIpiState('4.21', {
      aws: { region: 'us-gov-west-1' }
    });
    renderWithState(state);
    expect(screen.getByText(/Root volume throughput/)).toBeInTheDocument();
  });

  it('4.20 AWS IPI does not render throughput input', () => {
    const state = awsIpiState('4.20', {
      aws: { region: 'us-gov-west-1' }
    });
    renderWithState(state);
    expect(screen.queryByText(/Root volume throughput/)).toBeNull();
  });

  it('4.21 AWS IPI renders helper text', () => {
    const state = awsIpiState('4.21', {
      aws: { region: 'us-gov-west-1' }
    });
    renderWithState(state);
    expect(screen.getByText(/125.*2000 MiB\/s/)).toBeInTheDocument();
  });

  it('4.21 AWS IPI shows error on blur with invalid value', () => {
    const state = awsIpiState('4.21', {
      aws: { region: 'us-gov-west-1' }
    });
    renderWithState(state);
    const throughputInputs = screen.getAllByPlaceholderText('omit');
    const throughputInput = throughputInputs.find(el => {
      const label = el.closest('.field-with-info-row, .field-label-with-info');
      return label && label.textContent.includes('Root volume throughput');
    });
    expect(throughputInput).toBeDefined();
    fireEvent.change(throughputInput, { target: { value: '50' } });
    fireEvent.blur(throughputInput);
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByRole('alert').textContent).toMatch(/at least 125/);
  });

  it('4.21 AWS IPI retains value across re-render', () => {
    const state = awsIpiState('4.21', {
      aws: { region: 'us-gov-west-1', rootVolumeThroughput: 750 }
    });
    renderWithState(state);
    const throughputInputs = screen.getAllByPlaceholderText('omit');
    const throughputInput = throughputInputs.find(el => {
      const label = el.closest('.field-with-info-row, .field-label-with-info');
      return label && label.textContent.includes('Root volume throughput');
    });
    expect(throughputInput).toBeDefined();
    expect(throughputInput.value).toBe('750');
  });
});
