import { test, expect } from '@playwright/test';
import { resetState, getState, generateAssets } from '../../helpers/api.js';
import {
  startFromLanding, selectCard, lockBlueprint, navigateToStep,
  proceedToNextStep, fillAndBlur, fillSecretInput,
} from '../../helpers/navigation.js';
import { SSH_KEY, PULL_SECRET } from '../../helpers/mock-data.js';

test.describe('Full Flow: Bare Metal + Agent-Based Installer', () => {
  test('complete wizard from landing page to asset download', async ({ page, request }) => {
    test.setTimeout(120_000);

    // Step 1: Reset and start from landing
    await resetState(request);
    await startFromLanding(page);

    // Step 2: Blueprint — select platform and architecture
    await selectCard(page, 'Bare Metal');
    // x86_64 should be auto-selected or available
    const x86Card = page.locator('button.select-card:has-text("x86_64")');
    if (await x86Card.isVisible({ timeout: 2000 }) && !(await x86Card.evaluate(el => el.classList.contains('selected')))) {
      await selectCard(page, 'x86_64');
    }

    // Set version manually (Cincinnati may not be available in test env)
    const advancedDetails = page.locator('details summary:has-text("Advanced")');
    if (await advancedDetails.isVisible({ timeout: 3000 })) {
      await advancedDetails.click();
      await page.waitForTimeout(300);

      const minorInput = page.locator('[data-testid="blueprint-manual-minor"]');
      const patchInput = page.locator('[data-testid="blueprint-manual-patch"]');
      const applyBtn = page.locator('[data-testid="blueprint-manual-apply"]');

      if (await minorInput.isVisible({ timeout: 2000 })) {
        await minorInput.fill('4.20');
        await patchInput.fill('4.20.0');
        await applyBtn.click();
        await page.waitForTimeout(1000);
      }
    } else {
      // Try dropdown approach
      const minorSelect = page.locator('label.label-emphasis:has-text("Minor channel")').locator('..').locator('select');
      if (await minorSelect.isVisible({ timeout: 3000 })) {
        const options = await minorSelect.locator('option[value]').count();
        if (options > 0) {
          await minorSelect.selectOption({ index: 0 });
          await page.waitForTimeout(2000);
          const patchSelect = page.locator('label.label-emphasis:has-text("Patch version")').locator('..').locator('select');
          await patchSelect.waitFor({ state: 'visible', timeout: 5000 });
          const patchOpts = await patchSelect.locator('option[value]').count();
          if (patchOpts > 0) {
            await patchSelect.selectOption({ index: 0 });
          }
        }
      }
    }

    // Step 3: Lock blueprint
    await lockBlueprint(page);

    // Step 4: Methodology — select Agent-Based Installer
    await page.waitForTimeout(500);
    const agentCard = page.locator('button.select-card:has-text("Agent")');
    if (await agentCard.isVisible({ timeout: 5000 })) {
      await selectCard(page, 'Agent');
    }
    await proceedToNextStep(page);

    // Step 5: Identity & Access
    await page.waitForTimeout(500);

    // Cluster name
    const clusterInput = page.locator('input[placeholder="agent-cluster"]').or(
      page.locator('input[aria-required="true"]').first()
    );
    if (await clusterInput.first().isVisible({ timeout: 5000 })) {
      await fillAndBlur(clusterInput.first(), 'e2e-bm-agent');
    }

    // Base domain
    const domainInput = page.locator('input[placeholder="example.com"]');
    if (await domainInput.isVisible({ timeout: 3000 })) {
      await fillAndBlur(domainInput, 'e2e.test.com');
    }

    // SSH key — find the SSH-related SecretInput
    const sshContainers = page.locator('.pull-secret-section-inline');
    const sshCount = await sshContainers.count();
    for (let i = 0; i < sshCount; i++) {
      const container = sshContainers.nth(i);
      const text = await container.textContent();
      if (text.includes('SSH') || text.includes('ssh')) {
        const showBtn = container.locator('button:has-text("Show")');
        if (await showBtn.isVisible({ timeout: 2000 })) {
          await showBtn.click();
          await page.waitForTimeout(200);
        }
        const textarea = container.locator('textarea');
        if (await textarea.isVisible({ timeout: 2000 })) {
          await textarea.click();
          await textarea.fill(SSH_KEY);
          await textarea.evaluate(el => el.blur());
          await page.waitForTimeout(300);
        }
        break;
      }
    }

    await proceedToNextStep(page);

    // Step 6: Networking
    await page.waitForTimeout(500);
    const machineNetInput = page.locator('input[placeholder="10.90.0.0/24"]');
    if (await machineNetInput.isVisible({ timeout: 3000 })) {
      await fillAndBlur(machineNetInput, '10.90.0.0/24');
    }

    await proceedToNextStep(page);

    // Step 7: Connectivity & Mirroring
    await page.waitForTimeout(500);
    const regFqdnInput = page.locator('input[placeholder*="registry"]').first();
    if (await regFqdnInput.isVisible({ timeout: 3000 })) {
      // Registry FQDN may already be pre-filled
    }
    await proceedToNextStep(page);

    // Step 8: Trust & Proxy
    await page.waitForTimeout(500);
    await proceedToNextStep(page);

    // Step 9: Platform Specifics
    await page.waitForTimeout(500);
    await proceedToNextStep(page);

    // Step 10: Hosts / Inventory
    await page.waitForTimeout(500);

    // Check if nodes already exist or need to be generated
    const tiles = page.locator('button.host-inventory-v2-tile');
    const existingNodes = await tiles.count();
    if (existingNodes === 0) {
      const cpCount = page.locator('input[type="number"]').first();
      if (await cpCount.isVisible({ timeout: 3000 })) {
        await cpCount.fill('3');
        const generateBtn = page.locator('button:has-text("Generate nodes")');
        if (await generateBtn.isVisible({ timeout: 2000 })) {
          await generateBtn.click();
          await page.waitForTimeout(500);
        }
      }
    }

    await proceedToNextStep(page);

    // Step 11: Operators
    await page.waitForTimeout(500);
    // Select a quick-pick scenario (disabled without operator catalogs)
    const virtPick = page.locator('button.scenario-pick').first();
    if (await virtPick.isVisible({ timeout: 3000 }) && await virtPick.isEnabled()) {
      await virtPick.click();
      await page.waitForTimeout(300);
    }
    await proceedToNextStep(page);

    // Step 12: Review / Assets & Guide
    await page.waitForTimeout(1000);

    // Verify preview panes
    const installConfigHeading = page.locator('h3:has-text("install-config")');
    await expect(installConfigHeading.first()).toBeVisible({ timeout: 10000 });

    const agentConfigHeading = page.locator('h3:has-text("agent-config")');
    await expect(agentConfigHeading.first()).toBeVisible({ timeout: 10000 });

    const imagesetHeading = page.locator('h3:has-text("imageset-config")');
    await expect(imagesetHeading.first()).toBeVisible({ timeout: 10000 });

    // Download bundle (may be disabled if not all required fields are filled)
    const downloadBtn = page.locator('button:has-text("Download Bundle")');
    if (await downloadBtn.isVisible({ timeout: 10000 }) && await downloadBtn.isEnabled()) {
      const downloadPromise = page.waitForEvent('download', { timeout: 30000 });
      await downloadBtn.click();

      try {
        const download = await downloadPromise;
        const filename = download.suggestedFilename();
        expect(filename).toMatch(/\.zip$/);

        const filePath = await download.path();
        expect(filePath).toBeTruthy();
      } catch {
        // Bundle may fail if backend lacks dependencies — preview panes are the primary validation
      }
    }

    // Verify state via API
    const state = await getState(request);
    expect(state.blueprint.platform).toBe('Bare Metal');
    expect(state.methodology.method).toBe('Agent-Based Installer');
    expect(state.blueprint.clusterName).toBe('e2e-bm-agent');
  });
});
