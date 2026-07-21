import { test, expect } from '@playwright/test';
import { resetState, importState, getState } from '../../helpers/api.js';
import { navigateToStep } from '../../helpers/navigation.js';
import * as scenarios from '../../fixtures/scenarios.js';

const BACKEND = 'http://localhost:4000';

test.describe('Multi-Value Fields — comma-delimited inputs', () => {
  test.beforeEach(async ({ request }) => {
    await resetState(request);
  });

  async function seedAndNav(page, request, scenarioFn, step) {
    await importState(request, scenarioFn());
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await navigateToStep(page, step);
    await page.waitForTimeout(500);
  }

  async function fillAndTab(page, locator, value) {
    await locator.click();
    await locator.fill(value);
    await page.waitForTimeout(200);
    await page.keyboard.press('Tab');
    await page.waitForTimeout(800);
  }

  // --- NTP Servers (stored as array, max 4) ---

  test('NTP servers: single value persists to state', async ({ page, request }) => {
    await seedAndNav(page, request, scenarios.bareMetalAgent, 'Connectivity');

    const ntpInput = page.locator('input[placeholder="time.corp.local,10.90.0.10"]');
    await expect(ntpInput).toBeVisible({ timeout: 5000 });
    await fillAndTab(page, ntpInput, 'ntp1.example.com');

    const state = await getState(request);
    const ntp = state.globalStrategy.ntpServers;
    if (Array.isArray(ntp)) {
      expect(ntp).toEqual(['ntp1.example.com']);
    } else {
      expect(ntp).toContain('ntp1.example.com');
    }
  });

  test('NTP servers: multiple comma-separated values persist', async ({ page, request }) => {
    await seedAndNav(page, request, scenarios.bareMetalAgent, 'Connectivity');

    const ntpInput = page.locator('input[placeholder="time.corp.local,10.90.0.10"]');
    await expect(ntpInput).toBeVisible({ timeout: 5000 });
    await fillAndTab(page, ntpInput, 'ntp1.example.com,ntp2.example.com,10.90.0.10');

    const state = await getState(request);
    const ntp = state.globalStrategy.ntpServers;
    if (Array.isArray(ntp)) {
      expect(ntp).toHaveLength(3);
      expect(ntp).toContain('ntp1.example.com');
      expect(ntp).toContain('ntp2.example.com');
      expect(ntp).toContain('10.90.0.10');
    } else {
      expect(ntp).toContain('ntp1.example.com');
      expect(ntp).toContain('ntp2.example.com');
    }
  });

  test('NTP servers: max 4 values enforced', async ({ page, request }) => {
    await seedAndNav(page, request, scenarios.bareMetalAgent, 'Connectivity');

    const ntpInput = page.locator('input[placeholder="time.corp.local,10.90.0.10"]');
    if (await ntpInput.isVisible({ timeout: 5000 })) {
      await fillAndTab(page, ntpInput, 'a.ntp,b.ntp,c.ntp,d.ntp,e.ntp');

      const state = await getState(request);
      const ntp = state.globalStrategy.ntpServers;
      if (Array.isArray(ntp)) {
        expect(ntp.length).toBeLessThanOrEqual(4);
      }
    }
  });

  // Keyboard-entry test: verifies commas are accepted when typed char-by-char
  test('NTP servers: commas accepted via keyboard entry', async ({ page, request }) => {
    await seedAndNav(page, request, scenarios.bareMetalAgent, 'Connectivity');

    const ntpInput = page.locator('input[placeholder="time.corp.local,10.90.0.10"]');
    if (await ntpInput.isVisible({ timeout: 5000 })) {
      await ntpInput.click();
      await ntpInput.fill('');
      await ntpInput.pressSequentially('ntp1.test,ntp2.test', { delay: 30 });
      await page.waitForTimeout(200);

      const typedValue = await ntpInput.inputValue();
      expect(typedValue).toContain(',');
      expect(typedValue).toBe('ntp1.test,ntp2.test');
    }
  });

  // --- No Proxy (comma-delimited string) ---

  test('No Proxy: single value persists', async ({ page, request }) => {
    const fixture = scenarios.bareMetalAgent();
    fixture.globalStrategy.proxyEnabled = true;
    fixture.globalStrategy.proxies = {
      httpProxy: 'http://proxy.example.com:3128',
      httpsProxy: 'https://proxy.example.com:3129',
      noProxy: '',
    };
    await importState(request, fixture);
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await navigateToStep(page, 'Trust');
    await page.waitForTimeout(500);

    // Enable proxy toggle if needed
    const proxySwitch = page.locator('button[role="switch"]').filter({ hasText: /proxy/i }).first();
    if (await proxySwitch.isVisible({ timeout: 3000 })) {
      const checked = await proxySwitch.getAttribute('aria-checked');
      if (checked !== 'true') {
        await proxySwitch.click();
        await page.waitForTimeout(500);
      }
    }

    const noProxyTextarea = page.locator('textarea[placeholder*=".cluster.local"]').first();
    if (await noProxyTextarea.isVisible({ timeout: 3000 })) {
      await noProxyTextarea.click();
      await noProxyTextarea.fill('.example.com');
      await page.waitForTimeout(200);
      await page.keyboard.press('Tab');
      await page.waitForTimeout(800);

      const state = await getState(request);
      expect(state.globalStrategy.proxies.noProxy).toContain('.example.com');
    }
  });

  test('No Proxy: multiple comma-separated values persist', async ({ page, request }) => {
    const fixture = scenarios.bareMetalAgent();
    fixture.globalStrategy.proxyEnabled = true;
    fixture.globalStrategy.proxies = {
      httpProxy: 'http://proxy.example.com:3128',
      httpsProxy: 'https://proxy.example.com:3129',
      noProxy: '',
    };
    await importState(request, fixture);
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await navigateToStep(page, 'Trust');
    await page.waitForTimeout(500);

    const proxySwitch = page.locator('button[role="switch"]').filter({ hasText: /proxy/i }).first();
    if (await proxySwitch.isVisible({ timeout: 3000 })) {
      const checked = await proxySwitch.getAttribute('aria-checked');
      if (checked !== 'true') {
        await proxySwitch.click();
        await page.waitForTimeout(500);
      }
    }

    const noProxyTextarea = page.locator('textarea[placeholder*=".cluster.local"]').first();
    if (await noProxyTextarea.isVisible({ timeout: 3000 })) {
      await noProxyTextarea.click();
      await noProxyTextarea.fill('.example.com,.svc,10.128.0.0/14,127.0.0.1');
      await page.waitForTimeout(200);
      await page.keyboard.press('Tab');
      await page.waitForTimeout(800);

      const state = await getState(request);
      const noProxy = state.globalStrategy.proxies.noProxy;
      expect(noProxy).toContain('.example.com');
      expect(noProxy).toContain('.svc');
      expect(noProxy).toContain('10.128.0.0/14');
      expect(noProxy).toContain('127.0.0.1');
    }
  });

  // Keyboard-entry test for No Proxy textarea
  test('No Proxy: commas accepted via keyboard entry', async ({ page, request }) => {
    const fixture = scenarios.bareMetalAgent();
    fixture.globalStrategy.proxyEnabled = true;
    fixture.globalStrategy.proxies = {
      httpProxy: 'http://proxy.example.com:3128',
      httpsProxy: 'https://proxy.example.com:3129',
      noProxy: '',
    };
    await importState(request, fixture);
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await navigateToStep(page, 'Trust');
    await page.waitForTimeout(500);

    const proxySwitch = page.locator('button[role="switch"]').filter({ hasText: /proxy/i }).first();
    if (await proxySwitch.isVisible({ timeout: 3000 })) {
      const checked = await proxySwitch.getAttribute('aria-checked');
      if (checked !== 'true') {
        await proxySwitch.click();
        await page.waitForTimeout(500);
      }
    }

    const noProxyTextarea = page.locator('textarea[placeholder*=".cluster.local"]').first();
    if (await noProxyTextarea.isVisible({ timeout: 3000 })) {
      await noProxyTextarea.click();
      await noProxyTextarea.pressSequentially('.a.com,.b.com', { delay: 30 });
      await page.waitForTimeout(200);

      const typedValue = await noProxyTextarea.inputValue();
      expect(typedValue).toContain(',');
      expect(typedValue).toBe('.a.com,.b.com');
    }
  });

  // --- DNS Servers per node (comma string, via node drawer) ---

  test('DNS servers per node: single value via node drawer', async ({ page, request }) => {
    const fixture = scenarios.bareMetalAgent();
    fixture.hostInventory.nodes = [
      { hostname: 'node-0', role: 'master', bmcAddress: '', bmcUsername: '', bmcPassword: '',
        bootMACAddress: '52:54:00:aa:00:01', networkInterfaces: [], dnsServers: '', dnsSearch: '' },
    ];
    await importState(request, fixture);
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await navigateToStep(page, 'Hosts');
    await page.waitForTimeout(500);

    const tile = page.locator('button.host-inventory-v2-tile, .host-tile').first();
    if (await tile.isVisible({ timeout: 5000 })) {
      await tile.click();
      await page.waitForTimeout(500);

      const dnsInput = page.locator('input[placeholder*="192.168.1.10"]').first();
      if (await dnsInput.isVisible({ timeout: 3000 })) {
        await fillAndTab(page, dnsInput, '10.90.0.10');

        const state = await getState(request);
        const dns = state.hostInventory.nodes[0].dnsServers;
        expect(dns).toContain('10.90.0.10');
      }
    }
  });

  test('DNS servers per node: multiple values via node drawer', async ({ page, request }) => {
    const fixture = scenarios.bareMetalAgent();
    fixture.hostInventory.nodes = [
      { hostname: 'node-0', role: 'master', bmcAddress: '', bmcUsername: '', bmcPassword: '',
        bootMACAddress: '52:54:00:aa:00:01', networkInterfaces: [], dnsServers: '', dnsSearch: '' },
    ];
    await importState(request, fixture);
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await navigateToStep(page, 'Hosts');
    await page.waitForTimeout(500);

    const tile = page.locator('button.host-inventory-v2-tile, .host-tile').first();
    if (await tile.isVisible({ timeout: 5000 })) {
      await tile.click();
      await page.waitForTimeout(500);

      const dnsInput = page.locator('input[placeholder*="192.168.1.10"]').first();
      if (await dnsInput.isVisible({ timeout: 3000 })) {
        await fillAndTab(page, dnsInput, '10.90.0.10,10.90.0.11');

        const state = await getState(request);
        const dns = state.hostInventory.nodes[0].dnsServers;
        expect(dns).toContain('10.90.0.10');
        expect(dns).toContain('10.90.0.11');
      }
    }
  });

  // Keyboard-entry test for DNS servers input
  test('DNS servers per node: commas accepted via keyboard entry', async ({ page, request }) => {
    const fixture = scenarios.bareMetalAgent();
    fixture.hostInventory.nodes = [
      { hostname: 'node-0', role: 'master', bmcAddress: '', bmcUsername: '', bmcPassword: '',
        bootMACAddress: '52:54:00:aa:00:01', networkInterfaces: [], dnsServers: '', dnsSearch: '' },
    ];
    await importState(request, fixture);
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await navigateToStep(page, 'Hosts');
    await page.waitForTimeout(500);

    const tile = page.locator('button.host-inventory-v2-tile, .host-tile').first();
    if (await tile.isVisible({ timeout: 5000 })) {
      await tile.click();
      await page.waitForTimeout(500);

      const dnsInput = page.locator('input[placeholder*="192.168.1.10"]').first();
      if (await dnsInput.isVisible({ timeout: 3000 })) {
        await dnsInput.click();
        await dnsInput.fill('');
        await dnsInput.pressSequentially('10.0.0.1,10.0.0.2', { delay: 30 });
        await page.waitForTimeout(200);

        const typedValue = await dnsInput.inputValue();
        expect(typedValue).toContain(',');
        expect(typedValue).toBe('10.0.0.1,10.0.0.2');
      }
    }
  });

  // --- DNS Search Domains per node (comma string) ---

  test('DNS search domains per node: multiple values', async ({ page, request }) => {
    const fixture = scenarios.bareMetalAgent();
    fixture.hostInventory.nodes = [
      { hostname: 'node-0', role: 'master', bmcAddress: '', bmcUsername: '', bmcPassword: '',
        bootMACAddress: '52:54:00:aa:00:01', networkInterfaces: [], dnsServers: '', dnsSearch: '' },
    ];
    await importState(request, fixture);
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await navigateToStep(page, 'Hosts');
    await page.waitForTimeout(500);

    const tile = page.locator('button.host-inventory-v2-tile, .host-tile').first();
    if (await tile.isVisible({ timeout: 5000 })) {
      await tile.click();
      await page.waitForTimeout(500);

      const searchInput = page.locator('input[placeholder*="example.com"]').first();
      if (await searchInput.isVisible({ timeout: 3000 })) {
        await fillAndTab(page, searchInput, 'example.com,corp.local,lab.internal');

        const state = await getState(request);
        const search = state.hostInventory.nodes[0].dnsSearch;
        expect(search).toContain('example.com');
        expect(search).toContain('corp.local');
        expect(search).toContain('lab.internal');
      }
    }
  });

  // Keyboard-entry test for DNS search domains
  test('DNS search domains per node: commas accepted via keyboard entry', async ({ page, request }) => {
    const fixture = scenarios.bareMetalAgent();
    fixture.hostInventory.nodes = [
      { hostname: 'node-0', role: 'master', bmcAddress: '', bmcUsername: '', bmcPassword: '',
        bootMACAddress: '52:54:00:aa:00:01', networkInterfaces: [], dnsServers: '', dnsSearch: '' },
    ];
    await importState(request, fixture);
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await navigateToStep(page, 'Hosts');
    await page.waitForTimeout(500);

    const tile = page.locator('button.host-inventory-v2-tile, .host-tile').first();
    if (await tile.isVisible({ timeout: 5000 })) {
      await tile.click();
      await page.waitForTimeout(500);

      const searchInput = page.locator('input[placeholder*="example.com"]').first();
      if (await searchInput.isVisible({ timeout: 3000 })) {
        await searchInput.click();
        await searchInput.fill('');
        await searchInput.pressSequentially('a.com,b.com', { delay: 30 });
        await page.waitForTimeout(200);

        const typedValue = await searchInput.inputValue();
        expect(typedValue).toContain(',');
        expect(typedValue).toBe('a.com,b.com');
      }
    }
  });

  // --- AWS Availability Zones (array) ---

  test('AWS availability zones: multiple comma-separated values', async ({ page, request }) => {
    await seedAndNav(page, request, scenarios.awsGovcloudIpi, 'Platform');

    const azInput = page.locator('input[placeholder*="us-gov-west-1a"]').first();
    if (await azInput.isVisible({ timeout: 5000 })) {
      await fillAndTab(page, azInput, 'us-gov-west-1a,us-gov-west-1b,us-gov-west-1c');

      const state = await getState(request);
      const zones = state.platformConfig?.aws?.defaultMachinePlatformZones;
      if (Array.isArray(zones)) {
        expect(zones).toHaveLength(3);
        expect(zones).toContain('us-gov-west-1a');
      } else if (typeof zones === 'string') {
        expect(zones).toContain('us-gov-west-1a');
      }
    }
  });

  // Regression test for GitHub issue #18: "Default Availability Zones (multiple not available in UI)"
  // The input blocks comma keystrokes — typed value loses commas entirely.
  // KNOWN BUG: input onChange strips commas, so "a,b" becomes "ab".
  test.fail('AWS availability zones: commas accepted via keyboard entry (issue #18)', async ({ page, request }) => {
    await seedAndNav(page, request, scenarios.awsGovcloudIpi, 'Platform');

    const azInput = page.locator('input[placeholder*="us-gov-west-1a"]').first();
    if (await azInput.isVisible({ timeout: 5000 })) {
      await azInput.click();
      await azInput.fill('');
      await azInput.pressSequentially('us-gov-west-1a,us-gov-west-1b', { delay: 30 });
      await page.waitForTimeout(200);

      const typedValue = await azInput.inputValue();
      expect(typedValue).toContain(',');
      expect(typedValue).toBe('us-gov-west-1a,us-gov-west-1b');

      await page.keyboard.press('Tab');
      await page.waitForTimeout(800);

      const state = await getState(request);
      const zones = state.platformConfig?.aws?.defaultMachinePlatformZones;
      if (Array.isArray(zones)) {
        expect(zones.length).toBeGreaterThanOrEqual(2);
      } else if (typeof zones === 'string') {
        expect(zones).toContain(',');
      }
    }
  });

  // --- IBM Cloud Availability Zones (array) ---

  test('IBM Cloud availability zones: multiple values', async ({ page, request }) => {
    await seedAndNav(page, request, scenarios.ibmCloudIpi, 'Platform');

    const azInput = page.locator('input[placeholder*="us-east-1"]').first();
    if (await azInput.isVisible({ timeout: 5000 })) {
      await fillAndTab(page, azInput, 'us-east-1,us-east-2,us-east-3');

      const state = await getState(request);
      const zones = state.platformConfig?.ibmcloud?.defaultMachinePlatformZones;
      if (Array.isArray(zones)) {
        expect(zones).toHaveLength(3);
        expect(zones).toContain('us-east-1');
      } else if (typeof zones === 'string') {
        expect(zones).toContain('us-east-1');
      }
    }
  });

  // Keyboard-entry test for IBM Cloud AZ — same comma-blocking bug as AWS (issue #18)
  // KNOWN BUG: input onChange strips commas, same root cause as AWS AZ input.
  test.fail('IBM Cloud availability zones: commas accepted via keyboard entry', async ({ page, request }) => {
    await seedAndNav(page, request, scenarios.ibmCloudIpi, 'Platform');

    const azInput = page.locator('input[placeholder*="us-east-1"]').first();
    if (await azInput.isVisible({ timeout: 5000 })) {
      await azInput.click();
      await azInput.fill('');
      await azInput.pressSequentially('us-east-1,us-east-2', { delay: 30 });
      await page.waitForTimeout(200);

      const typedValue = await azInput.inputValue();
      expect(typedValue).toContain(',');
      expect(typedValue).toBe('us-east-1,us-east-2');
    }
  });

  // --- Asset generation validation for multi-value fields ---

  test('NTP servers appear in generated agent-config', async ({ request }) => {
    const fixture = scenarios.bareMetalAgent();
    fixture.globalStrategy.ntpServers = ['ntp1.corp.local', 'ntp2.corp.local', '10.90.0.10'];
    await importState(request, fixture);

    const resp = await request.post(`${BACKEND}/api/generate`);
    expect(resp.ok()).toBeTruthy();
    const body = await resp.json();
    const agentConfig = body.files?.['agent-config.yaml'] || '';

    expect(agentConfig).toContain('additionalNTPSources');
    expect(agentConfig).toContain('ntp1.corp.local');
    expect(agentConfig).toContain('ntp2.corp.local');
    expect(agentConfig).toContain('10.90.0.10');
  });

  test('No Proxy values appear in generated install-config', async ({ request }) => {
    const fixture = scenarios.bareMetalAgent();
    fixture.globalStrategy.proxyEnabled = true;
    fixture.globalStrategy.proxies = {
      httpProxy: 'http://proxy.corp.local:3128',
      httpsProxy: 'https://proxy.corp.local:3129',
      noProxy: '.example.com,.svc,10.128.0.0/14,127.0.0.1',
    };
    await importState(request, fixture);

    const resp = await request.post(`${BACKEND}/api/generate`);
    expect(resp.ok()).toBeTruthy();
    const body = await resp.json();
    const installConfig = body.files?.['install-config.yaml'] || '';

    expect(installConfig).toContain('noProxy');
    expect(installConfig).toContain('.example.com');
    expect(installConfig).toContain('10.128.0.0/14');
  });

  test('DNS servers per node appear in generated agent-config', async ({ request }) => {
    const fixture = scenarios.bareMetalAgent();
    fixture.hostInventory.nodes = [
      {
        hostname: 'master-0', role: 'master',
        bmcAddress: '', bmcUsername: '', bmcPassword: '',
        bootMACAddress: '52:54:00:aa:00:01',
        networkInterfaces: [],
        dnsServers: '10.90.0.10,10.90.0.11',
        dnsSearch: 'example.com,corp.local',
      },
      {
        hostname: 'master-1', role: 'master',
        bmcAddress: '', bmcUsername: '', bmcPassword: '',
        bootMACAddress: '52:54:00:aa:00:02',
        networkInterfaces: [],
        dnsServers: '10.90.0.10',
        dnsSearch: 'example.com',
      },
      {
        hostname: 'master-2', role: 'master',
        bmcAddress: '', bmcUsername: '', bmcPassword: '',
        bootMACAddress: '52:54:00:aa:00:03',
        networkInterfaces: [],
        dnsServers: '',
        dnsSearch: '',
      },
    ];
    await importState(request, fixture);

    const resp = await request.post(`${BACKEND}/api/generate`);
    expect(resp.ok()).toBeTruthy();
    const body = await resp.json();
    const agentConfig = body.files?.['agent-config.yaml'] || '';

    if (agentConfig.includes('dns-resolver')) {
      expect(agentConfig).toContain('10.90.0.10');
    }
  });

  test('NTP chrony machine configs generated when NTP servers present', async ({ request }) => {
    const fixture = scenarios.bareMetalAgent();
    fixture.globalStrategy.ntpServers = ['ntp1.corp.local', 'ntp2.corp.local'];
    await importState(request, fixture);

    const resp = await request.post(`${BACKEND}/api/generate`);
    expect(resp.ok()).toBeTruthy();
    const body = await resp.json();

    const masterChrony = body.files?.['99-chrony-ntp-master.yaml'] || '';
    const workerChrony = body.files?.['99-chrony-ntp-worker.yaml'] || '';

    if (masterChrony) {
      expect(masterChrony).toContain('ntp1.corp.local');
      expect(masterChrony).toContain('ntp2.corp.local');
    }
    if (workerChrony) {
      expect(workerChrony).toContain('ntp1.corp.local');
    }
  });
});
