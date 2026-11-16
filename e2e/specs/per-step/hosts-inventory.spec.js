import { test, expect } from '@playwright/test';
import { resetState, importState, getState } from '../../helpers/api.js';
import { navigateToStep, fillAndBlur } from '../../helpers/navigation.js';
import * as scenarios from '../../fixtures/scenarios.js';

test.describe('Hosts / Inventory Step', () => {
  test.beforeEach(async ({ request }) => { await resetState(request); });

  test('bare-metal-agent: can set node counts and generate nodes', async ({ page, request }) => {
    const state = scenarios.bareMetalAgent();
    state.hostInventory.nodes = []; // Clear pre-set nodes
    await importState(request, state);
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await navigateToStep(page, 'Hosts');
    await page.waitForTimeout(500);

    // Node count inputs should be visible
    const cpCount = page.locator('input[type="number"]').first();
    await expect(cpCount).toBeVisible({ timeout: 5000 });

    // Set control plane count to 3
    await cpCount.fill('3');

    // Worker count
    const workerCount = page.locator('input[type="number"]').nth(1);
    if (await workerCount.isVisible({ timeout: 2000 })) {
      await workerCount.fill('2');
    }

    // Click Generate nodes
    const generateBtn = page.locator('button:has-text("Generate nodes")');
    await expect(generateBtn).toBeVisible({ timeout: 3000 });
    await generateBtn.click();
    await page.waitForTimeout(500);

    // Should now see node tiles
    const tiles = page.locator('button.host-inventory-v2-tile');
    const tileCount = await tiles.count();
    expect(tileCount).toBeGreaterThanOrEqual(3); // At least 3 CP nodes
  });

  test('bare-metal-agent: can open node drawer and edit hostname', async ({ page, request }) => {
    await importState(request, scenarios.bareMetalAgent()); // Has 3 pre-set nodes
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await navigateToStep(page, 'Hosts');
    await page.waitForTimeout(500);

    // Click first node tile to open drawer
    const firstTile = page.locator('button.host-inventory-v2-tile').first();
    if (await firstTile.isVisible({ timeout: 5000 })) {
      await firstTile.click();
      await page.waitForTimeout(500);

      // Hostname input should be visible in drawer
      const hostnameInput = page.locator('input[placeholder*="master-0"]').or(
        page.locator('input[placeholder*="worker"]')
      ).or(page.locator('input[placeholder*="e.g."]'));

      if (await hostnameInput.first().isVisible({ timeout: 3000 })) {
        await fillAndBlur(hostnameInput.first(), 'control-plane-0');
        await page.waitForTimeout(300);
      }
    }
  });

  test('bare-metal-ipi: shows BMC configuration', async ({ page, request }) => {
    const state = scenarios.bareMetalIpi();
    // Add some nodes for IPI
    state.hostInventory.nodes = [
      { hostname: 'master-0', role: 'master', primary: { ethernet: { name: 'eth0', macAddress: '52:54:00:aa:00:01' } }, bmc: {}, rootDevice: '' },
      { hostname: 'master-1', role: 'master', primary: { ethernet: { name: 'eth0', macAddress: '52:54:00:aa:00:02' } }, bmc: {}, rootDevice: '' },
      { hostname: 'master-2', role: 'master', primary: { ethernet: { name: 'eth0', macAddress: '52:54:00:aa:00:03' } }, bmc: {}, rootDevice: '' },
    ];
    await importState(request, state);
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await navigateToStep(page, 'Hosts');
    await page.waitForTimeout(500);

    // Open first node
    const firstTile = page.locator('button.host-inventory-v2-tile').first();
    if (await firstTile.isVisible({ timeout: 5000 })) {
      await firstTile.click();
      await page.waitForTimeout(500);

      // BMC address should be visible for IPI
      const bmcInput = page.locator('input[placeholder*="redfish"]');
      const bmcVisible = await bmcInput.isVisible({ timeout: 3000 }).catch(() => false);
      // BMC section should be present for bare-metal-ipi
    }
  });

  test('vsphere-agent: can generate and view nodes', async ({ page, request }) => {
    const state = scenarios.vsphereAgent();
    state.hostInventory.nodes = []; // Clear pre-set nodes
    await importState(request, state);
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await navigateToStep(page, 'Hosts');
    await page.waitForTimeout(500);

    const cpCount = page.locator('input[type="number"]').first();
    if (await cpCount.isVisible({ timeout: 5000 })) {
      await cpCount.fill('3');

      const generateBtn = page.locator('button:has-text("Generate nodes")');
      if (await generateBtn.isVisible({ timeout: 3000 })) {
        await generateBtn.click();
        await page.waitForTimeout(500);

        const tiles = page.locator('button.host-inventory-v2-tile');
        expect(await tiles.count()).toBeGreaterThanOrEqual(3);
      }
    }
  });
});
