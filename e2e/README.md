# End-to-End (E2E) Tests

Playwright-based E2E tests for critical user workflows in OpenShift Airgap Architect.

---

## Prerequisites

**Required:**
1. **Application running** - Frontend at `:5173` and backend at `:4000`
2. **Playwright installed** - `npm install` (already in `package.json`)

**Start the application:**
```bash
# From project root
docker compose up --build

# OR with Podman
podman compose up --build
```

Wait for both services to be ready:
- Frontend: http://localhost:5173
- Backend: http://localhost:4000

---

## Running E2E Tests

### Run all tests (headless)
```bash
npm run test:e2e
```

### Run with browser visible (headed mode)
```bash
npm run test:e2e:headed
```

### Interactive UI mode (best for development)
```bash
npm run test:e2e:ui
```

### Debug mode (step through tests)
```bash
npm run test:e2e:debug
```

### Run specific test file
```bash
npx playwright test e2e/wizard-completion.spec.js
```

### Run specific test by name
```bash
npx playwright test -g "should complete bare-metal IPI wizard"
```

---

## Test Suites

### 1. Wizard Completion (`wizard-completion.spec.js`)

**Tests the complete user journey from blueprint configuration to export.**

**Coverage:**
- ✅ Landing page → Start wizard
- ✅ Blueprint configuration (platform, method, version, cluster name, base domain)
- ✅ Blueprint lock-in
- ✅ Navigation through wizard steps (Identity, Networking)
- ✅ Asset generation
- ✅ Export bundle creation
- ✅ Validation errors for incomplete configuration
- ✅ State persistence across page reload

**Critical assertions:**
- Blueprint fields accept input and persist
- Platform/method selection works correctly
- Lock button prevents further blueprint changes
- Assets generate successfully
- Export initiates download

---

### 2. Import/Export Workflow (`import-export.spec.js`)

**Tests configuration export and re-import to restore wizard state.**

**Coverage:**
- ✅ Export current wizard configuration as JSON
- ✅ Start over (clear state)
- ✅ Import previously exported configuration
- ✅ Verify state matches original after import
- ✅ Reject invalid JSON imports with error messages
- ✅ Export with various inclusion options (credentials, certificates, etc.)

**Critical assertions:**
- Export downloads JSON file with correct structure
- Import restores exact configuration state
- Invalid files trigger validation errors
- Inclusion toggles affect export content

---

### 3. Operations and Background Jobs (`operations.spec.js`)

**Tests the Operations tab and background job tracking.**

**Coverage:**
- ✅ Operations tab visibility (pre-lock access)
- ✅ Job history display
- ✅ Cincinnati refresh job triggering and tracking
- ✅ Job status updates (running → completed/failed)
- ✅ Job log viewing
- ✅ Job log download with timestamped filenames
- ✅ Clear completed jobs functionality
- ✅ Real-time job status updates
- ✅ Error handling for failed jobs

**Critical assertions:**
- Operations tab accessible before blueprint lock
- Cincinnati refresh creates tracked job
- Job status transitions correctly
- Logs are visible and downloadable
- Clear button removes completed jobs
- Failed jobs show error details

---

## Test Configuration

**File:** `playwright.config.js` (project root)

**Key settings:**
- **Base URL:** http://localhost:5173
- **Timeout:** 90 seconds per test
- **Viewport:** 1280x720 (desktop)
- **Retries:** 1 retry in CI, 0 in local dev
- **Screenshots:** Only on failure
- **Video:** Retained on failure
- **Trace:** On first retry

**Browsers tested:**
- Chromium (default)
- Firefox (optional, uncomment in config)
- WebKit/Safari (optional, uncomment in config)

---

## CI/CD Integration

E2E tests are designed to run in CI pipelines where the application is already running.

**GitHub Actions example:**
```yaml
- name: Start application
  run: docker compose up --build -d

- name: Wait for services
  run: |
    timeout 60 bash -c 'until curl -f http://localhost:5173; do sleep 2; done'
    timeout 60 bash -c 'until curl -f http://localhost:4000/api/health; do sleep 2; done'

- name: Run E2E tests
  run: npm run test:e2e

- name: Upload test artifacts
  if: failure()
  uses: actions/upload-artifact@v3
  with:
    name: playwright-results
    path: test-results/
```

---

## Writing New E2E Tests

### Test Structure

```javascript
import { test, expect } from '@playwright/test';

test.describe('Feature Name', () => {
  test('should perform specific action', async ({ page }) => {
    // Navigate
    await page.goto('/');

    // Interact
    const button = page.locator('button:has-text("Click Me")');
    await button.click();

    // Assert
    await expect(page.locator('h1')).toContainText('Success');
  });
});
```

### Locator Best Practices

**Prefer (in order):**
1. **Data test IDs:** `page.locator('[data-testid="export-button"]')`
2. **Accessible roles:** `page.locator('button[role="dialog"]')`
3. **Visible text:** `page.locator('button:has-text("Export")')`
4. **Form IDs:** `page.locator('input#clusterName')`
5. **Placeholders:** `page.locator('input[placeholder*="cluster"]')`

**Avoid:**
- CSS classes (brittle, change frequently)
- XPath (hard to read, slow)
- Nth selectors (fragile)

### Waiting Strategies

```javascript
// Wait for element to be visible
await expect(page.locator('h1')).toBeVisible({ timeout: 5000 });

// Wait for network idle (after navigation)
await page.goto('/', { waitUntil: 'networkidle' });

// Wait for specific condition
await page.waitForFunction(() => document.querySelector('.ready'));

// Explicit timeout (last resort)
await page.waitForTimeout(500); // Only when necessary
```

---

## Debugging Failed Tests

### 1. Run in headed mode
```bash
npm run test:e2e:headed
```

Watch the browser as the test runs to see where it fails.

### 2. Use debug mode
```bash
npm run test:e2e:debug
```

Step through the test line-by-line with Playwright Inspector.

### 3. Check screenshots
After a failure, screenshots are saved to `test-results/`:
```bash
ls -lh test-results/
```

### 4. View trace
Traces are recorded on first retry. Open with:
```bash
npx playwright show-trace test-results/.../trace.zip
```

### 5. Increase timeout
If tests fail due to slow operations:
```javascript
test('slow operation', async ({ page }) => {
  test.setTimeout(120000); // 2 minutes

  // ... test code
});
```

---

## Known Issues and Workarounds

### Issue: Tests fail with "locator not found"

**Cause:** Element may not be visible yet or selector is incorrect.

**Solutions:**
- Add explicit wait: `await expect(locator).toBeVisible({ timeout: 10000 })`
- Use more robust selectors (data-testid, accessible roles)
- Check if element is conditionally rendered

### Issue: Tests pass locally but fail in CI

**Cause:** Timing differences, environment variables, or state pollution.

**Solutions:**
- Ensure application is fully started before running tests
- Use explicit waits instead of arbitrary timeouts
- Clear state between tests (`test.beforeEach` hooks)
- Check CI logs for network or service startup errors

### Issue: Download assertions fail

**Cause:** Download events may not trigger in headless mode in some browsers.

**Solution:**
```javascript
// Set up download listener before clicking
const downloadPromise = page.waitForEvent('download', { timeout: 10000 });
await downloadButton.click();
const download = await downloadPromise;
```

---

## Test Coverage Goals

**Current coverage (v1.7.0):**
- ✅ Wizard completion (bare-metal IPI flow)
- ✅ Export/import run configuration
- ✅ Operations tab and job tracking
- ✅ State persistence

**Future additions:**
- vSphere IPI/UPI flows
- Agent-based installer flows
- Cloud platform flows (AWS, Azure, GovCloud)
- oc-mirror execution end-to-end
- Operator scanning workflow
- Dark mode toggle
- Feedback drawer submission
- YAML drawer visibility and download

---

## Performance

**Target test execution times:**
- Full suite (headless): < 5 minutes
- Single test file: < 90 seconds
- Single test: < 30 seconds

**Optimization tips:**
- Use `page.goto('/', { waitUntil: 'domcontentloaded' })` instead of `networkidle` when possible
- Minimize `page.waitForTimeout()` - use explicit assertions instead
- Run tests in parallel (Playwright default)
- Skip slow tests in smoke test suites

---

## Resources

- [Playwright Documentation](https://playwright.dev/docs/intro)
- [Best Practices](https://playwright.dev/docs/best-practices)
- [Debugging Guide](https://playwright.dev/docs/debug)
- [Trace Viewer](https://playwright.dev/docs/trace-viewer)

---

**Last Updated:** 2026-05-28  
**Playwright Version:** ^1.60.0
