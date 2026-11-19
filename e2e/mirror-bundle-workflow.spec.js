/**
 * E2E Test: Mirror Bundle Workflow
 *
 * Tests the mirror operator collection bundle workflow where the wizard
 * runs on an air-gapped (high-side) network with pre-loaded IDMS/ITMS
 * mirror sources from oc-mirror v2.
 *
 * Prerequisites:
 *   Backend must be running with MIRROR_REGISTRY_CONFIG env var pointing
 *   to a mirror-registry-config.json that references IDMS/ITMS YAML files.
 *   Tests skip cleanly when mirror config is not loaded.
 *
 * Verifies:
 *   - IDMS mirror sources flow correctly to the UI and generated YAML
 *   - Mirror paths use actual IDMS values (e.g. /openshift/release-images),
 *     NOT the default fallback pattern (/ocp-release)
 *   - Source editor fields are locked in bundle mode
 *   - Operators and Run oc-mirror steps are hidden
 */

import { test, expect } from "@playwright/test";

const BACKEND_URL = "http://localhost:4000";

let mirrorConfigPreloaded = false;
let mirrorState = null;

test.beforeEach(async ({ page }) => {
  try {
    const res = await page.request.get(`${BACKEND_URL}/api/state`, { timeout: 5000 });
    if (res.ok()) {
      const state = await res.json();
      mirrorConfigPreloaded = state?.ui?.mirrorConfigPreloaded === true;
      mirrorState = state;
    }
  } catch {
    // Backend not reachable
  }
  if (!mirrorConfigPreloaded) {
    test.skip(true, "Backend not running with MIRROR_REGISTRY_CONFIG — skipping mirror bundle tests");
  }
});

/** Click the "Install" card on the landing page to enter the wizard. */
async function enterWizard(page) {
  await page.goto("/");
  // Landing page shows Install/Upgrade/Operator cards; click Install to enter wizard
  const installCard = page.locator("button.landing-card-install");
  await expect(installCard).toBeVisible({ timeout: 5000 });
  await installCard.click();
  // handleInstallClick calls startOver (POST /api/start-over) then setShowLanding(false);
  // wait for the sidebar step-list to appear (React re-render after state update)
  await expect(page.locator("nav.step-list")).toBeVisible({ timeout: 15000 });
}

/** Lock foundational selections so all sidebar steps become clickable. */
async function lockFoundational(page) {
  // Click "Confirm & Proceed" footer button
  const confirmButton = page.locator('button:has-text("Confirm & Proceed")');
  if (await confirmButton.isVisible({ timeout: 3000 }).catch(() => false)) {
    await confirmButton.click();
    // A confirmation modal appears — click "Yes, lock selections"
    const lockButton = page.locator('button:has-text("Yes, lock selections")');
    await expect(lockButton).toBeVisible({ timeout: 3000 });
    await lockButton.click();
    // Wait for sidebar steps to become enabled
    await page.waitForTimeout(1000);
  }
}

/** Click a sidebar step by its exact label text. */
function sidebarStep(page, label) {
  return page.locator(".step-item").filter({ has: page.locator(".step-label", { hasText: label }) });
}

test.describe("Mirror Bundle Workflow", () => {
  test("Connectivity & Mirroring shows pre-loaded IDMS sources as read-only", async ({ page }) => {
    await enterWizard(page);
    await lockFoundational(page);

    // Navigate to Connectivity & Mirroring via sidebar
    const connectivityStep = sidebarStep(page, "Connectivity & Mirroring");
    await expect(connectivityStep).toBeVisible({ timeout: 5000 });
    await connectivityStep.click();
    await page.waitForTimeout(500);

    // Verify PreloadedConfigBanner is visible
    const banner = page.locator(".banner.info, .note.info").filter({ hasText: /Pre-configured|pre-loaded/ });
    await expect(banner).toBeVisible({ timeout: 5000 });

    // Verify mirror source mapping inputs are disabled
    const mirrorListInputs = page.locator(".mirror-list input");
    const inputCount = await mirrorListInputs.count();
    expect(inputCount).toBeGreaterThan(0);

    for (let i = 0; i < inputCount; i++) {
      await expect(mirrorListInputs.nth(i)).toBeDisabled();
    }

    // Verify at least one mirror path contains the correct IDMS path
    // (not the fallback /ocp-release pattern)
    const mirrorInputValues = [];
    for (let i = 0; i < inputCount; i++) {
      const val = await mirrorListInputs.nth(i).inputValue();
      if (val) mirrorInputValues.push(val);
    }
    const allValues = mirrorInputValues.join(" ");
    expect(allValues).toContain("openshift/release");

    // Verify the default fallback paths are NOT used as mirror destinations
    const mirrorDestinationInputs = page.locator(".mirror-row input:nth-child(2)");
    const destCount = await mirrorDestinationInputs.count();
    for (let i = 0; i < destCount; i++) {
      const val = await mirrorDestinationInputs.nth(i).inputValue();
      expect(val).not.toMatch(/:\d+\/ocp-release$/);
      expect(val).not.toMatch(/:\d+\/ocp-v4\.0-art-dev$/);
    }

    // Verify "Add Mirror Path" button is hidden in bundle mode
    const addButton = page.locator('button:has-text("Add Mirror Path")');
    await expect(addButton).toHaveCount(0);
  });

  test("Assets & Guide shows install-config.yaml with correct imageDigestSources", async ({ page }) => {
    test.setTimeout(60000);
    await enterWizard(page);
    await lockFoundational(page);

    // Navigate to Assets & Guide via sidebar
    const assetsStep = sidebarStep(page, "Assets & Guide");
    await expect(assetsStep).toBeVisible({ timeout: 5000 });
    await assetsStep.click();
    await page.waitForTimeout(1000);

    // The Assets & Guide step should show generated config previews or
    // have a way to view install-config.yaml. Check the API directly as fallback.
    const res = await page.request.post(`${BACKEND_URL}/api/generate`, {
      headers: { "Content-Type": "application/json" },
      data: JSON.stringify(mirrorState),
      timeout: 15000,
    });
    expect(res.ok()).toBeTruthy();

    const generated = await res.json();
    const installConfig = generated?.files?.["install-config.yaml"] || "";

    // Verify imageDigestSources is present
    expect(installConfig).toContain("imageDigestSources:");

    // Verify correct mirror paths from IDMS (not defaults)
    expect(installConfig).toContain("openshift/release");

    // Verify the wrong default paths are NOT present as mirror destination values
    const lines = installConfig.split("\n");
    const mirrorLines = lines.filter(
      (l) => l.trim().startsWith("- ") && l.includes("/") && !l.includes("source:")
    );
    for (const line of mirrorLines) {
      const trimmed = line.trim().replace(/^- /, "");
      if (trimmed.includes("quay.io") || trimmed.includes("registry.redhat.io") || trimmed.includes("registry.access.redhat.com") || trimmed.includes("docker.io")) continue;
      expect(trimmed).not.toMatch(/:\d+\/ocp-release$/);
      expect(trimmed).not.toMatch(/:\d+\/ocp-v4\.0-art-dev$/);
    }
  });

  test("Operators and Run oc-mirror steps are hidden in bundle mode", async ({ page }) => {
    await enterWizard(page);
    await lockFoundational(page);

    // Verify the Operators step is NOT in the sidebar (exact label match via .step-label)
    const operatorsStep = page.locator('.step-item .step-label').filter({ hasText: /^Operators$/ });
    await expect(operatorsStep).toHaveCount(0);

    // Verify the Run oc-mirror step is NOT in the sidebar
    const ocMirrorStep = page.locator('.step-item .step-label').filter({ hasText: /^Run oc-mirror$/ });
    await expect(ocMirrorStep).toHaveCount(0);
  });
});
