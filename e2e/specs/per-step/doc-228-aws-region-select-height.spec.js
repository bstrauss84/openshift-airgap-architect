/**
 * DOC-228 — the AWS GovCloud region <select> must not stretch.
 *
 * It shares a Platform Specifics subgrid control row with the RHCOS AMI cell.
 * When selecting a region auto-filled the AMI, the "Auto-filled" badge made that
 * cell wrap and the grid's `align-items: stretch` grew the select from 39px to
 * 83px (1440/1366px; already 83px before selection at 1024/768px). This is a
 * real-browser measurement, not a CSS assertion: heights come from
 * getBoundingClientRect, before and after selection, in both themes.
 */
import { test, expect } from '@playwright/test';
import { resetState } from '../../helpers/api.js';

const BACKEND = process.env.OAA_BROWSER_BACKEND_URL || process.env.E2E_BACKEND_URL || 'http://localhost:4000';
const WIDTHS = [1920, 1440, 1366, 1024, 768, 375];

const state = {
  _schemaVersion: 3,
  version: { _schemaVersion: 3, selectedMinor: '4.22', selectedPatch: '4.22.16', selectedChannel: 'stable-4.22', selectedVersion: '4.22.16', locked: true },
  release: { channel: '4.22', patchVersion: '4.22.16', confirmed: true },
  blueprint: { platform: 'AWS GovCloud', arch: 'x86_64', clusterName: 'doc228', baseDomain: 'example.com', confirmed: true },
  methodology: { method: 'IPI' },
  platformConfig: { aws: { region: '' } },
  ui: { segmentedFlowV1: true, showLanding: false, activeStepId: 'platform-specifics', visitedSteps: { 'platform-specifics': true } },
};

for (const theme of ['light', 'dark']) {
  for (const width of WIDTHS) {
    test(`DOC-228 ${theme} ${width}px: region select stays single-line before and after selection`, async ({ page, request }) => {
      await resetState(request);
      expect((await request.post(`${BACKEND}/api/state`, { data: state, headers: { 'X-OAA-Request': '1' } })).status()).toBeLessThan(400);
      await page.setViewportSize({ width, height: 1000 });
      await page.route('**/api/aws/regions**', (r) => r.fulfill({ json: { regions: ['us-gov-east-1', 'us-gov-west-1'] } }));
      await page.route('**/api/aws/ami**', (r) => r.fulfill({ json: { version: '4.22.16', arch: 'x86_64', region: 'us-gov-west-1', ami: 'ami-0123456789abcdef0' } }));
      await page.goto('/');
      await page.waitForLoadState('networkidle');
      await page.evaluate((t) => document.body.setAttribute('data-theme', t), theme);

      const select = page.locator('select', { has: page.locator('option', { hasText: 'Select a region' }) });
      await expect(select).toBeVisible({ timeout: 15000 });
      const height = async () => Math.round((await select.boundingBox()).height);
      const otherSelectHeights = () => page.$$eval('.platform-specifics select', (els) =>
        els.filter((e) => ![...e.options].some((o) => o.text === 'Select a region')).map((e) => Math.round(e.getBoundingClientRect().height)));

      const before = await height();
      const othersBefore = await otherSelectHeights();
      await select.selectOption('us-gov-west-1');
      await expect(page.locator('.platform-specifics-ami-badge')).toBeVisible();
      const after = await height();

      expect(before).toBeLessThanOrEqual(44);
      expect(after).toBe(before);
      expect(await otherSelectHeights()).toEqual(othersBefore);
      await expect(select).toHaveValue('us-gov-west-1');
    });
  }
}
