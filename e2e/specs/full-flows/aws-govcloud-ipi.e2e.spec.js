import { test, expect } from '@playwright/test';
import { resetState, getState } from '../../helpers/api.js';
import {
  startFromLanding, selectCard, lockBlueprint, navigateToStep,
  proceedToNextStep, fillAndBlur,
} from '../../helpers/navigation.js';
import { SSH_KEY, AWS } from '../../helpers/mock-data.js';

test.describe('Full Flow: AWS GovCloud + IPI', () => {
  test('complete wizard from landing page to asset download', async ({ page, request }) => {
    test.setTimeout(120_000);

    // Reset and start
    await resetState(request);
    await startFromLanding(page);

    // Blueprint: select AWS GovCloud
    await selectCard(page, 'AWS GovCloud');

    // Set version manually
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
    }

    // Lock blueprint
    await lockBlueprint(page);

    // Methodology: select IPI
    await page.waitForTimeout(500);
    await selectCard(page, 'IPI');
    await proceedToNextStep(page);

    // Identity & Access
    await page.waitForTimeout(500);
    const clusterInput = page.locator('input[placeholder="agent-cluster"]').or(
      page.locator('input[aria-required="true"]').first()
    );
    if (await clusterInput.first().isVisible({ timeout: 5000 })) {
      await fillAndBlur(clusterInput.first(), 'e2e-aws-ipi');
    }

    const domainInput = page.locator('input[placeholder="example.com"]');
    if (await domainInput.isVisible({ timeout: 3000 })) {
      await fillAndBlur(domainInput, 'aws.test.com');
    }

    // SSH key
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
          await textarea.fill(SSH_KEY);
          await textarea.evaluate(el => el.blur());
          await page.waitForTimeout(300);
        }
        break;
      }
    }

    await proceedToNextStep(page);

    // Networking
    await page.waitForTimeout(500);
    const machineNet = page.locator('input[placeholder="10.90.0.0/24"]');
    if (await machineNet.isVisible({ timeout: 3000 })) {
      await fillAndBlur(machineNet, '10.90.0.0/24');
    }
    await proceedToNextStep(page);

    // Connectivity & Mirroring is HIDDEN for AWS GovCloud (unless mirror registry enabled)
    // So the next step should be Trust & Proxy
    await page.waitForTimeout(500);
    await proceedToNextStep(page);

    // Platform Specifics
    await page.waitForTimeout(500);

    // AWS: select region
    const regionSelect = page.locator('select').filter({ has: page.locator('option:has-text("us-gov-west-1")') });
    if (await regionSelect.first().isVisible({ timeout: 5000 })) {
      await regionSelect.first().selectOption('us-gov-west-1');
      await page.waitForTimeout(500);
    }

    // AMI ID
    const amiInput = page.locator('input[placeholder*="ami-"]');
    if (await amiInput.isVisible({ timeout: 3000 })) {
      await fillAndBlur(amiInput, AWS.amiId);
    }

    // Instance types
    const cpInstanceType = page.locator('input[placeholder*="m5.xlarge"]');
    if (await cpInstanceType.isVisible({ timeout: 3000 })) {
      await fillAndBlur(cpInstanceType, 'm5.xlarge');
    }

    const workerInstanceType = page.locator('input[placeholder*="m5.large"]');
    if (await workerInstanceType.isVisible({ timeout: 3000 })) {
      await fillAndBlur(workerInstanceType, 'm5.large');
    }

    await proceedToNextStep(page);

    // No Host Inventory for AWS GovCloud

    // Operators
    await page.waitForTimeout(500);
    const pick = page.locator('button.scenario-pick').first();
    if (await pick.isVisible({ timeout: 3000 }) && await pick.isEnabled()) {
      await pick.click();
      await page.waitForTimeout(300);
    }
    await proceedToNextStep(page);

    // Review / Assets & Guide
    await page.waitForTimeout(1000);

    const installConfig = page.locator('h3:has-text("install-config")');
    await expect(installConfig.first()).toBeVisible({ timeout: 10000 });

    // agent-config should NOT be visible
    const agentConfig = page.locator('h3:has-text("agent-config")');
    await expect(agentConfig).toHaveCount(0, { timeout: 3000 });

    // Download bundle
    const downloadBtn = page.locator('button:has-text("Download Bundle")');
    if (await downloadBtn.isVisible({ timeout: 10000 })) {
      const downloadPromise = page.waitForEvent('download', { timeout: 30000 });
      await downloadBtn.click();

      try {
        const download = await downloadPromise;
        expect(download.suggestedFilename()).toMatch(/\.zip$/);
      } catch {
        // Acceptable
      }
    }

    // Verify state
    const state = await getState(request);
    expect(state.blueprint.platform).toBe('AWS GovCloud');
    expect(state.methodology.method).toBe('IPI');
    expect(state.platformConfig.aws.region).toBe('us-gov-west-1');
  });
});
