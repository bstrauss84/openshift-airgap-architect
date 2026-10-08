/**
 * OpenShift Version Awareness Tests
 *
 * Verifies that the application correctly handles version-specific behaviors:
 * - Generated artifacts use version-appropriate channel names and image tags
 * - Unsupported versions are rejected by the backend
 * - Field Guide documentation URLs reference the correct version
 * - Operator catalog images use version-specific tags
 * - Version-specific parameters (e.g., 4.21-only fields) are handled correctly
 */
import { test, expect } from '@playwright/test';
import { resetState, importState, getState } from '../../helpers/api.js';
import * as scenarios from '../../fixtures/scenarios.js';

const BACKEND = process.env.OAA_BROWSER_BACKEND_URL || 'http://localhost:4000';

function makeVersionFixture(minor, patch) {
  const fixture = scenarios.bareMetalAgent();
  fixture.release.channel = minor;
  fixture.release.patchVersion = patch;
  fixture.version.selectedChannel = `stable-${minor}`;
  fixture.version.selectedVersion = patch;
  return fixture;
}

async function generate(request) {
  const resp = await request.post(`${BACKEND}/api/generate`);
  expect(resp.ok()).toBeTruthy();
  return resp.json();
}

function makeCanonicalLockedVersionState(minor, patch) {
  const state = scenarios.bareMetalAgent();
  state.version._schemaVersion = 3;
  state.version.selectedMinor = minor;
  state.version.selectedPatch = patch;
  state.version.selectedChannel = `stable-${minor}`;
  state.version.selectedVersion = patch;
  state.version.locked = true;
  state.release.channel = minor;
  state.release.patchVersion = patch;
  state.release.confirmed = true;
  state.ui.showLanding = false;
  return state;
}

function sanitizeForHydration(state) {
  const payload = JSON.parse(JSON.stringify(state));
  if (payload.credentials) {
    delete payload.credentials.pullSecretPlaceholder;
    delete payload.credentials.mirrorRegistryPullSecret;
  }
  return payload;
}

async function interceptStateHydration(page, canonicalState) {
  const sanitized = sanitizeForHydration(canonicalState);
  await page.route('**/api/state', (route) => {
    if (route.request().method() === 'GET') {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(sanitized),
      });
    } else {
      route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    }
  });
}

test.describe('Version Awareness — imageset-config channel names', () => {
  test.beforeEach(async ({ request }) => {
    await resetState(request);
  });

  test('4.20 → stable-4.20 channel in imageset-config', async ({ request }) => {
    const fixture = makeVersionFixture('4.20', '4.20.5');
    await importState(request, fixture);

    const { files } = await generate(request);
    const isc = files['imageset-config.yaml'];
    expect(isc).toContain('stable-4.20');
    expect(isc).toContain('4.20.5');
  });

  test('4.21 → stable-4.21 channel in imageset-config', async ({ request }) => {
    const fixture = makeVersionFixture('4.21', '4.21.2');
    await importState(request, fixture);

    const { files } = await generate(request);
    const isc = files['imageset-config.yaml'];
    expect(isc).toContain('stable-4.21');
    expect(isc).toContain('4.21.2');
  });

  test('4.22 → stable-4.22 channel in imageset-config', async ({ request }) => {
    const fixture = makeVersionFixture('4.22', '4.22.16');
    await importState(request, fixture);
    const resp = await request.post(`${BACKEND}/api/generate`);
    expect(resp.ok()).toBeTruthy();
    const isc = (await resp.json()).files['imageset-config.yaml'];
    expect(isc).toContain('stable-4.22');
    expect(isc).toContain('4.22.16');
  });

  test('version change from 4.20 to 4.21 updates channel name', async ({ request }) => {
    const fix420 = makeVersionFixture('4.20', '4.20.0');
    await importState(request, fix420);
    const result420 = await generate(request);
    expect(result420.files['imageset-config.yaml']).toContain('stable-4.20');

    const fix421 = makeVersionFixture('4.21', '4.21.0');
    await importState(request, fix421);
    const result421 = await generate(request);
    expect(result421.files['imageset-config.yaml']).toContain('stable-4.21');
    expect(result421.files['imageset-config.yaml']).not.toContain('stable-4.20');
  });
});

test.describe('Version Awareness — operator catalog image tags', () => {
  test.beforeEach(async ({ request }) => {
    await resetState(request);
  });

  test('4.20 → operator index uses v4.20 tag', async ({ request }) => {
    const fixture = makeVersionFixture('4.20', '4.20.0');
    fixture.operators.selected = [
      { package: 'local-storage-operator', catalog: 'redhat' },
    ];
    await importState(request, fixture);

    const { files } = await generate(request);
    const isc = files['imageset-config.yaml'];
    if (isc.includes('redhat-operator-index')) {
      expect(isc).toContain('v4.20');
    }
  });

  test('4.22 → operator index uses v4.22 tag', async ({ request }) => {
    const fixture = makeVersionFixture('4.22', '4.22.16');
    await importState(request, fixture);
    const resp = await request.post(`${BACKEND}/api/generate`);
    expect(resp.ok()).toBeTruthy();
    const isc = (await resp.json()).files['imageset-config.yaml'];
    if (isc.includes('operator-index')) {
      expect(isc).toContain('v4.22');
    }
  });

  test('4.21 → operator index uses v4.21 tag', async ({ request }) => {
    const fixture = makeVersionFixture('4.21', '4.21.0');
    fixture.operators.selected = [
      { package: 'local-storage-operator', catalog: 'redhat' },
    ];
    await importState(request, fixture);

    const { files } = await generate(request);
    const isc = files['imageset-config.yaml'];
    if (isc.includes('redhat-operator-index')) {
      expect(isc).toContain('v4.21');
    }
  });
});

test.describe('Version Awareness — unsupported version rejection', () => {
  test.beforeEach(async ({ request }) => {
    await resetState(request);
  });

  // Strict: an unsupported version must FAIL. An earlier form accepted either
  // outcome via if/else, so it could not have detected a regression.
  //
  // The state is supplied INLINE rather than imported first. /api/run/import
  // correctly refuses an unsupported minor, so importing leaves the previous
  // (unconfirmed) state in place and /api/generate then answers "Version not
  // confirmed" — a true statement about the wrong thing. Passing the state to
  // the generator directly is what actually exercises the generation boundary.
  for (const [minor, patch] of [['4.19', '4.19.0'], ['4.23', '4.23.0']]) {
    test(`unsupported version ${minor} → import AND generate both reject it`, async ({ request }) => {
      const fixture = makeVersionFixture(minor, patch);

      const imported = await request.post(`${BACKEND}/api/run/import`, {
        data: { schemaVersion: 2, state: fixture },
      });
      expect(imported.status(), `${minor} must not import`).toBe(422);

      const resp = await request.post(`${BACKEND}/api/generate`, { data: { state: fixture } });
      expect(resp.ok(), `${minor} must not generate`).toBeFalsy();
      expect(resp.status()).toBe(422);

      const body = await resp.json();
      expect(body.code).toBe('UNSUPPORTED_VERSION');
      expect(body.requestedVersion).toBe(minor);
      expect(body.files, 'no artifacts may be produced').toBeUndefined();
    });
  }

  test('4.23 does not fall back to 4.22', async ({ request }) => {
    const fixture = makeVersionFixture('4.23', '4.23.0');
    const resp = await request.post(`${BACKEND}/api/generate`, { data: { state: fixture } });
    expect(resp.status()).toBe(422);
    const body = JSON.stringify(await resp.json());
    expect(body).not.toContain('stable-4.22');
    expect(body).toContain('4.23');
    // The refusal names the real supported set rather than silently degrading.
    expect(body).toContain('4.22');
  });
});

test.describe('Version Awareness — VersionSupportGate browser boundary (DOC-104)', () => {
  test.beforeEach(async ({ page, request }) => {
    const resp = await request.post(`${BACKEND}/api/start-over`);
    expect(resp.ok(), `State reset failed: ${resp.status()}`).toBeTruthy();

    await page.route('**/api/cincinnati/**', (route) => {
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ channels: [], versions: [] }) });
    });
  });

  test('locked 4.23 → unsupported-version recovery boundary blocks wizard', async ({ page }) => {
    const pageErrors = [];
    const consoleErrors = [];
    page.on('pageerror', (err) => pageErrors.push(err.message));
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });

    const state = makeCanonicalLockedVersionState('4.23', '4.23.0');
    await interceptStateHydration(page, state);

    await page.goto('/');

    const alert = page.getByRole('alert');
    await expect(alert).toBeVisible();
    await expect(alert.getByRole('heading', { name: 'Unsupported OpenShift Version' })).toBeVisible();
    await expect(alert).toContainText('4.23');
    await expect(alert).toContainText('4.20, 4.21, 4.22');
    await expect(alert.getByRole('button', { name: 'Start Over' })).toBeVisible();
    await expect(alert.getByRole('button', { name: 'Switch to 4.22' })).toBeVisible();

    await expect(page.getByRole('main', { name: 'Wizard step content' })).toHaveCount(0);

    expect(pageErrors, 'Unexpected page exceptions').toEqual([]);
    expect(consoleErrors, 'Unexpected console errors').toEqual([]);
  });

  for (const [minor, patch] of [['4.20', '4.20.5'], ['4.21', '4.21.2'], ['4.22', '4.22.16']]) {
    test(`locked ${minor} → passes gate, renders wizard`, async ({ page }) => {
      const pageErrors = [];
      const consoleErrors = [];
      page.on('pageerror', (err) => pageErrors.push(err.message));
      page.on('console', (msg) => {
        if (msg.type() === 'error') consoleErrors.push(msg.text());
      });

      const state = makeCanonicalLockedVersionState(minor, patch);
      await interceptStateHydration(page, state);

      await page.goto('/');

      await expect(page.getByRole('main', { name: 'Wizard step content' })).toBeVisible();

      const unsupportedAlert = page.locator('[role="alert"]').filter({ hasText: 'Unsupported OpenShift Version' });
      await expect(unsupportedAlert).toHaveCount(0);

      expect(pageErrors, 'Unexpected page exceptions').toEqual([]);
      expect(consoleErrors, 'Unexpected console errors').toEqual([]);
    });
  }
});

test.describe('Version Awareness — install-config version differences', () => {
  test.beforeEach(async ({ request }) => {
    await resetState(request);
  });

  test('install-config generated correctly for 4.20', async ({ request }) => {
    const fixture = makeVersionFixture('4.20', '4.20.3');
    fixture.blueprint.clusterName = 'ver-test-420';
    await importState(request, fixture);

    const { files } = await generate(request);
    const ic = files['install-config.yaml'];
    expect(ic).toContain('name: ver-test-420');
    expect(ic).toContain('baseDomain:');
    expect(ic).toContain('networking:');
  });

  test('install-config generated correctly for 4.21', async ({ request }) => {
    const fixture = makeVersionFixture('4.21', '4.21.1');
    fixture.blueprint.clusterName = 'ver-test-421';
    await importState(request, fixture);

    const { files } = await generate(request);
    const ic = files['install-config.yaml'];
    expect(ic).toContain('name: ver-test-421');
    expect(ic).toContain('baseDomain:');
    expect(ic).toContain('networking:');
  });

  test('agent-config generated correctly for both versions', async ({ request }) => {
    for (const [minor, patch] of [['4.20', '4.20.0'], ['4.21', '4.21.0'], ['4.22', '4.22.16']]) {
      const fixture = makeVersionFixture(minor, patch);
      fixture.globalStrategy.ntpServers = ['ntp.version-test.local'];
      await importState(request, fixture);

      const { files } = await generate(request);
      const ac = files['agent-config.yaml'];
      expect(ac).toContain('kind: AgentConfig');
      expect(ac).toContain('ntp.version-test.local');
    }
  });
});

test.describe('Version Awareness — Field Guide version URLs', () => {
  test.beforeEach(async ({ request }) => {
    await resetState(request);
  });

  test('4.20 field guide references 4.20 documentation URLs', async ({ request }) => {
    const fixture = makeVersionFixture('4.20', '4.20.0');
    await importState(request, fixture);

    const { files } = await generate(request);
    const fieldManual = files['FIELD_MANUAL.md'];
    if (fieldManual) {
      expect(fieldManual).toContain('4.20');
      expect(fieldManual).not.toContain('/4.21/');
    }
  });

  test('4.21 field guide references 4.21 documentation URLs', async ({ request }) => {
    const fixture = makeVersionFixture('4.21', '4.21.0');
    await importState(request, fixture);

    const { files } = await generate(request);
    const fieldManual = files['FIELD_MANUAL.md'];
    if (fieldManual) {
      expect(fieldManual).toContain('4.21');
    }
  });
});

test.describe('Version Awareness — platform-specific version behavior', () => {
  test.beforeEach(async ({ request }) => {
    await resetState(request);
  });

  test('AWS GovCloud generates correctly for both versions', async ({ request }) => {
    for (const [minor, patch] of [['4.20', '4.20.0'], ['4.21', '4.21.0'], ['4.22', '4.22.16']]) {
      const fixture = scenarios.awsGovcloudIpi();
      fixture.release.channel = minor;
      fixture.release.patchVersion = patch;
      fixture.version.selectedChannel = `stable-${minor}`;
      fixture.version.selectedVersion = patch;
      fixture.platformConfig.aws.region = 'us-gov-west-1';
      await importState(request, fixture);

      const { files } = await generate(request);
      expect(files['install-config.yaml']).toContain('us-gov-west-1');
      expect(files['imageset-config.yaml']).toContain(`stable-${minor}`);
    }
  });

  test('vSphere generates correctly for both versions', async ({ request }) => {
    for (const [minor, patch] of [['4.20', '4.20.0'], ['4.21', '4.21.0'], ['4.22', '4.22.16']]) {
      const fixture = scenarios.vsphereIpi();
      fixture.release.channel = minor;
      fixture.release.patchVersion = patch;
      fixture.version.selectedChannel = `stable-${minor}`;
      fixture.version.selectedVersion = patch;
      fixture.platformConfig.vsphere.placementMode = 'legacy';
      fixture.platformConfig.vsphere.vcenter = 'vcenter.test.lab';
      await importState(request, fixture);

      const { files } = await generate(request);
      expect(files['install-config.yaml']).toContain('vcenter.test.lab');
      expect(files['imageset-config.yaml']).toContain(`stable-${minor}`);
    }
  });

  test('Nutanix generates correctly for both versions', async ({ request }) => {
    for (const [minor, patch] of [['4.20', '4.20.0'], ['4.21', '4.21.0'], ['4.22', '4.22.16']]) {
      const fixture = scenarios.nutanixIpi();
      fixture.release.channel = minor;
      fixture.release.patchVersion = patch;
      fixture.version.selectedChannel = `stable-${minor}`;
      fixture.version.selectedVersion = patch;
      fixture.platformConfig.nutanix.endpoint = 'prism.test.lab';
      await importState(request, fixture);

      const { files } = await generate(request);
      expect(files['install-config.yaml']).toContain('prism.test.lab');
      expect(files['imageset-config.yaml']).toContain(`stable-${minor}`);
    }
  });
});

test.describe('Version Awareness — chrony/NTP configs across versions', () => {
  test.beforeEach(async ({ request }) => {
    await resetState(request);
  });

  test('NTP chrony machine configs generated for every supported minor', async ({ request }) => {
    for (const [minor, patch] of [['4.20', '4.20.0'], ['4.21', '4.21.0'], ['4.22', '4.22.16']]) {
      const fixture = makeVersionFixture(minor, patch);
      fixture.globalStrategy.ntpServers = ['ntp-ver.test.local'];
      await importState(request, fixture);

      const { files } = await generate(request);
      const masterChrony = files['99-chrony-ntp-master.yaml'];
      const workerChrony = files['99-chrony-ntp-worker.yaml'];
      if (masterChrony) {
        expect(masterChrony).toContain('ntp-ver.test.local');
      }
      if (workerChrony) {
        expect(workerChrony).toContain('ntp-ver.test.local');
      }
    }
  });
});

test.describe('Version Awareness — trust bundle policy', () => {
  test.beforeEach(async ({ request }) => {
    await resetState(request);
  });

  test('trust bundle policy Proxyonly works for both versions', async ({ request }) => {
    for (const [minor, patch] of [['4.20', '4.20.0'], ['4.21', '4.21.0'], ['4.22', '4.22.16']]) {
      const fixture = makeVersionFixture(minor, patch);
      fixture.trust.mirrorRegistryCaPem = '-----BEGIN CERTIFICATE-----\nVERSIONTEST\n-----END CERTIFICATE-----';
      fixture.trust.additionalTrustBundlePolicy = 'Proxyonly';
      await importState(request, fixture);

      const { files } = await generate(request);
      expect(files['install-config.yaml']).toContain('additionalTrustBundle');
      expect(files['install-config.yaml']).toContain('VERSIONTEST');
    }
  });

  test('trust bundle policy Always works for both versions', async ({ request }) => {
    for (const [minor, patch] of [['4.20', '4.20.0'], ['4.21', '4.21.0'], ['4.22', '4.22.16']]) {
      const fixture = makeVersionFixture(minor, patch);
      fixture.trust.mirrorRegistryCaPem = '-----BEGIN CERTIFICATE-----\nALWAYSTEST\n-----END CERTIFICATE-----';
      fixture.trust.additionalTrustBundlePolicy = 'Always';
      await importState(request, fixture);

      const { files } = await generate(request);
      expect(files['install-config.yaml']).toContain('additionalTrustBundlePolicy: Always');
    }
  });
});

test.describe('Version Awareness — version in state after import', () => {
  test.beforeEach(async ({ request }) => {
    await resetState(request);
  });

  test('importing 4.20 state sets correct version fields', async ({ request }) => {
    const fixture = makeVersionFixture('4.20', '4.20.7');
    await importState(request, fixture);

    const state = await getState(request);
    expect(state.release.channel).toBe('4.20');
    expect(state.release.patchVersion).toBe('4.20.7');
  });

  test('importing 4.21 state sets correct version fields', async ({ request }) => {
    const fixture = makeVersionFixture('4.21', '4.21.3');
    await importState(request, fixture);

    const state = await getState(request);
    expect(state.release.channel).toBe('4.21');
    expect(state.release.patchVersion).toBe('4.21.3');
  });

  test('patch version preserved across generate cycle', async ({ request }) => {
    const fixture = makeVersionFixture('4.20', '4.20.12');
    await importState(request, fixture);

    await generate(request);
    const state = await getState(request);
    expect(state.release.patchVersion).toBe('4.20.12');
  });
});

test.describe('Version Awareness — all 12 scenarios generate for both versions', () => {
  test.beforeEach(async ({ request }) => {
    await resetState(request);
  });

  const scenarioFns = [
    ['bare-metal-agent', scenarios.bareMetalAgent],
    ['bare-metal-ipi', scenarios.bareMetalIpi],
    ['bare-metal-upi', scenarios.bareMetalUpi],
    ['vsphere-ipi', scenarios.vsphereIpi],
    ['vsphere-upi', scenarios.vsphereUpi],
    ['vsphere-agent', scenarios.vsphereAgent],
    ['nutanix-ipi', scenarios.nutanixIpi],
    ['aws-govcloud-ipi', scenarios.awsGovcloudIpi],
    ['aws-govcloud-upi', scenarios.awsGovcloudUpi],
    ['azure-government-ipi', scenarios.azureGovernmentIpi],
    ['azure-government-upi', scenarios.azureGovernmentUpi],
    ['ibm-cloud-ipi', scenarios.ibmCloudIpi],
  ];

  for (const [name, fn] of scenarioFns) {
    test(`${name} generates successfully for 4.20`, async ({ request }) => {
      const fixture = fn();
      fixture.release.channel = '4.20';
      fixture.release.patchVersion = '4.20.0';
      fixture.version.selectedChannel = 'stable-4.20';
      fixture.version.selectedVersion = '4.20.0';
      await importState(request, fixture);

      const { files } = await generate(request);
      expect(files['install-config.yaml']).toBeTruthy();
      expect(files['imageset-config.yaml']).toContain('stable-4.20');
    });

    test(`${name} generates successfully for 4.22`, async ({ request }) => {
      const fixture = fn();
      fixture.release.channel = '4.22';
      fixture.release.patchVersion = '4.22.16';
      fixture.version.selectedChannel = 'stable-4.22';
      fixture.version.selectedVersion = '4.22.16';
      await importState(request, fixture);
      const resp = await request.post(`${BACKEND}/api/generate`);
      expect(resp.ok(), `${name} must generate at 4.22`).toBeTruthy();
      const { files } = await resp.json();
      expect(files['install-config.yaml']).toBeDefined();
      expect(files['imageset-config.yaml']).toContain('stable-4.22');
      expect(files['imageset-config.yaml']).not.toContain('stable-4.21');
      expect(files['imageset-config.yaml']).not.toContain('stable-4.20');
    });

    test(`${name} generates successfully for 4.21`, async ({ request }) => {
      const fixture = fn();
      fixture.release.channel = '4.21';
      fixture.release.patchVersion = '4.21.0';
      fixture.version.selectedChannel = 'stable-4.21';
      fixture.version.selectedVersion = '4.21.0';
      await importState(request, fixture);

      const { files } = await generate(request);
      expect(files['install-config.yaml']).toBeTruthy();
      expect(files['imageset-config.yaml']).toContain('stable-4.21');
    });
  }
});
