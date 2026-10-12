/**
 * App-level cover for the operator cross-minor transition contract (R5).
 *
 * FIXTURE NOTE. The quick pick used throughout is `gitops`, a REAL shipped
 * Quick Pick whose package set is exactly one operator and does not vary by
 * minor. That matters since reconciliation began re-evaluating Quick Pick
 * MEMBERSHIP against the destination minor's row: a fixture naming a
 * many-package pick (such as `odf`) while supplying a one-package catalog
 * would now be an incoherent state — the pick would legitimately stay pending
 * because ten of its eleven 4.20 packages are missing from the fixture. Using
 * a pick whose real membership matches the fixture keeps every assertion in
 * this file meaning exactly what it meant before. Membership variation across
 * minors is covered by
 * `operator-quick-pick-cross-minor-membership.test.js`.
 *
 * The live path is: unlock release → pick another minor → re-lock via the Core
 * Lock modal ("Yes, lock selections"). That path previously left the Operators
 * step unflagged and left quick picks rendered as actively selected, even though
 * the generator already dropped the stale catalog from the ImageSet output.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent, act } from '@testing-library/react';
import React from 'react';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import App from '../src/App.jsx';

const mockFetch = vi.fn();
global.fetch = mockFetch;

const V421_CATALOG = 'registry.redhat.io/redhat/redhat-operator-index:v4.21';

/**
 * Release already changed to 4.20 and awaiting re-lock, while every piece of
 * operator metadata is still resolved against 4.21.
 */
const STATE_RELOCKING_ONTO_420 = {
  _schemaVersion: 3,
  version: {
    _schemaVersion: 3,
    selectedMinor: '4.20',
    selectedPatch: '4.20.15',
    selectedChannel: 'stable-4.20',
    locked: false,
    confirmedByUser: false,
  },
  release: { channel: '4.20', patchVersion: '4.20.15', confirmed: false, followLatestMinor: false },
  blueprint: { platform: 'Bare Metal', arch: 'x86_64', confirmed: false },
  methodology: { method: 'IPI' },
  operators: {
    selected: [
      {
        name: 'openshift-gitops-operator',
        id: 'openshift-gitops-operator-redhat',
        displayName: 'Red Hat OpenShift GitOps',
        catalogImage: V421_CATALOG,
        defaultChannel: 'stable-4.21',
        sources: ['gitops'],
      },
    ],
    catalogs: { redhat: [{ id: 'openshift-gitops-operator-redhat', name: 'openshift-gitops-operator' }], certified: [], community: [] },
    version: '4.21',
    scenarios: { gitops: true },
    scenarioAdded: { 'openshift-gitops-operator-redhat': { gitops: true } },
    scanJobs: { redhat: 'job-421' },
    cachedAt: 1700000000000,
    stale: true,
    fastMode: false,
  },
  reviewFlags: {},
  ui: {
    showLanding: false,
    activeStepId: 'blueprint',
    visitedSteps: { blueprint: true, operators: true },
    completedSteps: {},
  },
};

let persistedStates = [];

function mockResponse(data, ok = true, status = 200) {
  return {
    ok,
    status,
    statusText: ok ? 'OK' : 'Not Found',
    json: async () => data,
    text: async () => JSON.stringify(data),
  };
}

/** Mirror-image fixture: resolved on 4.20, re-locking onto 4.21. */
function stateRelockingOnto(targetMinor, targetPatch, resolvedMinor) {
  const base = JSON.parse(JSON.stringify(STATE_RELOCKING_ONTO_420));
  base.version.selectedMinor = targetMinor;
  base.version.selectedPatch = targetPatch;
  base.version.selectedChannel = `stable-${targetMinor}`;
  base.release.channel = targetMinor;
  base.release.patchVersion = targetPatch;
  base.operators.version = resolvedMinor;
  base.operators.selected[0].catalogImage = `registry.redhat.io/redhat/redhat-operator-index:v${resolvedMinor}`;
  base.operators.selected[0].defaultChannel = `stable-${resolvedMinor}`;
  return base;
}

function installFetchMock({ loadedState = STATE_RELOCKING_ONTO_420, catalogStatus = null } = {}) {
  mockFetch.mockImplementation((url, options) => {
    const pathname = new URL(String(url), 'http://localhost').pathname;

    if (pathname === '/api/state' && options?.method === 'POST') {
      persistedStates.push(JSON.parse(options.body));
      return Promise.resolve(mockResponse({}));
    }
    if (pathname === '/api/state') return Promise.resolve(mockResponse(loadedState));
    if (pathname === '/api/operators/confirm') {
      return Promise.resolve(
        mockResponse({
          version: { ...loadedState.version, locked: true, confirmedByUser: true },
          release: { ...loadedState.release, confirmed: true },
        })
      );
    }
    if (pathname === '/api/operators/credentials') return Promise.resolve(mockResponse({ available: false }));
    if (pathname === '/api/operators/status') {
      return Promise.resolve(
        mockResponse(catalogStatus || { redhat: [], certified: [], community: [] })
      );
    }
    if (pathname === '/api/schema/stepMap') return Promise.resolve(mockResponse({ mvpSteps: [] }));
    if (pathname === '/api/build-info') return Promise.resolve(mockResponse({ version: '2.0.0' }));
    if (pathname === '/api/update-info') return Promise.resolve(mockResponse({}));
    if (pathname === '/api/feedback/config') return Promise.resolve(mockResponse({ visible: false, enabled: false }));
    // Cincinnati must return real patch data: an empty `versions` list makes
    // BlueprintStep null out release.patchVersion, which disables the lock.
    if (pathname.startsWith('/api/cincinnati/patches')) {
      return Promise.resolve(
        mockResponse({ versions: [loadedState.release.patchVersion], timestamp: Date.now() })
      );
    }
    if (pathname.startsWith('/api/cincinnati')) {
      return Promise.resolve(mockResponse({ channels: ['4.20', '4.21'], timestamp: Date.now() }));
    }
    return Promise.resolve(mockResponse({}));
  });
}

/**
 * Drive the real Core Lock path that re-locks the newly chosen minor.
 * fireEvent rather than userEvent: the sticky footer fails userEvent's
 * pointer-events check under jsdom, which has no layout.
 */
async function lockOntoNewMinor() {
  await waitFor(() => expect(screen.getByRole('button', { name: /Confirm & Proceed/i })).toBeEnabled());
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: /Confirm & Proceed/i }));
  });
  const lockButton = await screen.findByRole('button', { name: /Yes, lock selections/i });
  await act(async () => {
    fireEvent.click(lockButton);
  });
  await waitFor(() =>
    expect(screen.queryByRole('button', { name: /Yes, lock selections/i })).not.toBeInTheDocument()
  );
}

async function openOperatorsStep() {
  const operatorsNav = await screen.findByRole('button', { name: /Operators/i });
  await act(async () => {
    fireEvent.click(operatorsNav);
  });
  return operatorsNav;
}

function latestPersisted() {
  return persistedStates[persistedStates.length - 1];
}

/**
 * Wait until the cross-minor invalidation has actually been persisted.
 *
 * `operators` is present in the initial loaded state too, so waiting merely for
 * it to be defined waits for nothing and races the debounced persist. The
 * unambiguous marker is `operators.version === null`, which only
 * buildInvalidatedOperatorState sets. Returns that settled snapshot.
 */
async function waitForInvalidationPersisted() {
  await waitFor(() => {
    expect(latestPersisted()?.operators?.version).toBeNull();
  });
  return latestPersisted();
}

describe('Operator cross-minor transition — review state and quick-pick semantics', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    persistedStates = [];
    installFetchMock();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('flags the Operators step for review after re-locking onto a different minor', async () => {
    render(<App />);
    await lockOntoNewMinor();

    // Asserted on canonical state, not the sidebar badge: that badge also
    // renders for errorFlags, so it cannot prove the review flag was set.
    const persisted = await waitForInvalidationPersisted();
    expect(persisted.reviewFlags.operators).toBe(true);
  });

  it('invalidates 4.21-resolved operator metadata on the new lock', async () => {
    render(<App />);
    await lockOntoNewMinor();

    const operators = (await waitForInvalidationPersisted()).operators;
    expect(operators.version).toBeNull();
    expect(operators.catalogs).toEqual({});
    expect(operators.scanJobs).toEqual({});
    for (const op of operators.selected) {
      expect(op.catalogImage).toBeUndefined();
      expect(op.defaultChannel).toBeUndefined();
    }
  });

  it('stops presenting the old quick pick as an active selection but keeps the intent', async () => {
    render(<App />);
    await lockOntoNewMinor();

    const operators = (await waitForInvalidationPersisted()).operators;
    expect(operators.scenarios).toEqual({});
    expect(operators.pendingScenarios).toEqual({ gitops: true });
    expect(operators.selected.map((op) => op.name)).toEqual(['openshift-gitops-operator']);
  });

  it('renders the preserved quick pick as pending, not selected, on the Operators step', async () => {
    render(<App />);
    await lockOntoNewMinor();
    await openOperatorsStep();

    const storagePick = await waitFor(() => {
      const pick = document.querySelector('.scenario-pick[data-selection-state="pending"]');
      expect(pick).not.toBeNull();
      return pick;
    });
    expect(storagePick.className).not.toContain('selected');
    expect(storagePick.getAttribute('aria-pressed')).toBe('false');
    expect(storagePick.textContent).toContain('Pending review');
    // No quick pick may read as a current selection while reconciliation is pending.
    expect(document.querySelector('.scenario-pick.selected')).toBeNull();
  });

  it('a late response from the old minor cannot restore active quick-pick state', async () => {
    render(<App />);
    await lockOntoNewMinor();
    // Confirm the invalidation landed before navigating: opening the Operators
    // step re-sets operators.version for the new minor, so this marker is only
    // observable beforehand.
    await waitForInvalidationPersisted();

    await openOperatorsStep();

    // /api/operators/status for the NEW minor resolves with empty catalogs; the
    // stale 4.21 scan identity was cleared, so nothing can re-activate the pick.
    await waitFor(() => {
      const operators = latestPersisted().operators;
      expect(operators.version).toBe('4.20');
      expect(operators.scenarios).toEqual({});
      expect(operators.selected.every((op) => !op.catalogImage)).toBe(true);
    });
  });

  it('applies the same contract in the reverse 4.20 → 4.21 direction', async () => {
    installFetchMock({ loadedState: stateRelockingOnto('4.21', '4.21.9', '4.20') });
    render(<App />);
    await lockOntoNewMinor();

    const persisted = await waitForInvalidationPersisted();
    expect(persisted.reviewFlags.operators).toBe(true);
    expect(persisted.operators.scenarios).toEqual({});
    expect(persisted.operators.pendingScenarios).toEqual({ gitops: true });
    for (const op of persisted.operators.selected) {
      expect(op.catalogImage).toBeUndefined();
    }
  });

  it('restores the quick pick to an active selection after a successful current-minor scan', async () => {
    installFetchMock({
      catalogStatus: {
        redhat: [
          {
            id: 'openshift-gitops-operator-redhat',
            name: 'openshift-gitops-operator',
            displayName: 'Red Hat OpenShift GitOps',
            defaultChannel: 'stable-4.20',
          },
        ],
        certified: [],
        community: [],
      },
    });
    render(<App />);
    await lockOntoNewMinor();
    await openOperatorsStep();

    // Wait for reconciliation to be persisted, then assert that same snapshot
    // rather than re-reading a value that may have advanced since the wait.
    const reconciledOperators = await waitFor(() => {
      const operators = latestPersisted()?.operators;
      expect(operators?.scenarios).toEqual({ gitops: true });
      expect(operators?.pendingScenarios).toEqual({});
      return operators;
    });

    const reconciled = reconciledOperators.selected[0];
    expect(reconciled.catalogImage).toBe('registry.redhat.io/redhat/redhat-operator-index:v4.20');
    expect(reconciled.defaultChannel).toBe('stable-4.20');

    await waitFor(() => {
      expect(document.querySelector('.scenario-pick[data-selection-state="pending"]')).toBeNull();
    });
  });

  /**
   * Display coherence: once reconciliation succeeds, the three representations
   * of "currently selected" must agree — the Quick Pick, the Selected Operators
   * section, and the operator state handed to the ImageSet generator. The
   * Selected Operators section previously stayed collapsed after a cross-minor
   * reconciliation because its row count was memoised from a ref, so it only
   * recovered if the user toggled a selection and changed the count.
   */
  describe.each([
    ['4.21 → 4.20', '4.20', STATE_RELOCKING_ONTO_420],
    ['4.20 → 4.21', '4.21', stateRelockingOnto('4.21', '4.21.9', '4.20')],
  ])('display coherence after reconciliation (%s)', (_label, targetMinor, loadedState) => {
    const catalogStatus = {
      redhat: [
        {
          id: 'openshift-gitops-operator-redhat',
          name: 'openshift-gitops-operator',
          displayName: 'Red Hat OpenShift GitOps',
          defaultChannel: `stable-${targetMinor}`,
        },
      ],
      certified: [],
      community: [],
    };

    async function reconcileAndOpen() {
      installFetchMock({ loadedState, catalogStatus });
      render(<App />);
      await lockOntoNewMinor();
      await openOperatorsStep();
      await waitFor(() => {
        expect(latestPersisted()?.operators?.scenarios).toEqual({ gitops: true });
      });
    }

    it('shows the reconciled operator in the Selected Operators section', async () => {
      await reconcileAndOpen();
      expect(await screen.findByText('Red Hat OpenShift GitOps')).toBeInTheDocument();
    });

    it('does not leave the Selected Operators section collapsed', async () => {
      await reconcileAndOpen();
      await screen.findByText('Red Hat OpenShift GitOps');
      // No unselect/reselect cycle anywhere in this test.
      await waitFor(() => {
        const wrapper = document.querySelector('.selected-grid-wrapper');
        expect(wrapper).not.toBeNull();
        expect(Number.parseFloat(String(wrapper.style.maxHeight))).toBeGreaterThan(0);
      });
    });

    it('presents the Quick Pick as active, not pending', async () => {
      await reconcileAndOpen();
      await waitFor(() => {
        expect(document.querySelector('.scenario-pick[data-selection-state="active"]')).not.toBeNull();
        expect(document.querySelector('.scenario-pick[data-selection-state="pending"]')).toBeNull();
      });
    });

    it('hands the generator the same operator with current-minor metadata', async () => {
      await reconcileAndOpen();
      const selected = latestPersisted().operators.selected;
      expect(selected).toHaveLength(1);
      expect(selected[0].name).toBe('openshift-gitops-operator');
      expect(selected[0].catalogImage).toBe(
        `registry.redhat.io/redhat/redhat-operator-index:v${targetMinor}`
      );
      expect(selected[0].defaultChannel).toBe(`stable-${targetMinor}`);
    });

    it('shows the current-minor channel on the visible card', async () => {
      await reconcileAndOpen();
      expect(await screen.findByText(`Default channel: stable-${targetMinor}`)).toBeInTheDocument();
    });
  });

  it('does not fabricate a Selected Operator for intent unavailable in the new minor', async () => {
    // 4.20 catalogs return results, but openshift-gitops-operator is not among
    // them. Results
    // must be non-empty: an empty scan cannot distinguish "unavailable" from
    // "not scanned yet", and the conflict banner is correctly gated on results.
    installFetchMock({
      catalogStatus: {
        redhat: [{ id: 'other-operator-redhat', name: 'other-operator', defaultChannel: 'stable' }],
        certified: [],
        community: [],
      },
    });
    render(<App />);
    await lockOntoNewMinor();
    await openOperatorsStep();

    await waitFor(() => {
      expect(latestPersisted()?.operators?.version).toBe('4.20');
    });
    const operators = latestPersisted().operators;

    // Intent is retained and explicitly pending — never promoted to active.
    expect(operators.scenarios).toEqual({});
    expect(operators.pendingScenarios).toEqual({ gitops: true });
    expect(operators.selected.every((op) => !op.catalogImage)).toBe(true);
    expect(document.querySelector('.scenario-pick[data-selection-state="active"]')).toBeNull();

    // And the conflict is surfaced rather than silently dropped. The banner text
    // spans several nodes, so assert on the rendered text content.
    await waitFor(() => {
      const text = document.body.textContent.replace(/\s+/g, ' ');
      expect(text).toContain('not available in the OpenShift 4.20 catalogs');
      expect(text).toContain('Red Hat OpenShift GitOps');
      expect(text).toContain('excluded from the generated ImageSet configuration');
    });
  });
});

/* ------------------------------------------------------------------ */
/* Imported intent reconciles once catalogs exist (v2.1 Tranche 7C.3)   */
/* ------------------------------------------------------------------ */

describe('T7C.3 — preserved operator intent reconciles against available catalogs', () => {
  /**
   * WHAT A HUMAN SAW during the 2026-10-09 blocker retest:
   *
   *   - imported a saved run containing Quick Picks and selected operators;
   *   - the Quick Picks showed the dotted "pending review" state;
   *   - the selected operators read "Default channel: unknown";
   *   - imageset-config.yaml contained none of them;
   *   - after supplying a pull secret and successfully scanning, the catalog
   *     tables populated — but the selections STILL read "unknown" and were
   *     STILL absent from the ImageSet;
   *   - only removing and re-picking each one recovered it.
   *
   * MECHANISM. Reconciliation (`reconcileOperatorsForMinor`) existed and was
   * correct, but had exactly one call site: a `useEffect` keyed on
   * `${version}-${confirmed}`, guarded by
   * `if (operators.version === version && catalogs.redhat.length) return;`.
   * Completing a scan changes neither key, and the scan-completion writer
   * assigned `catalogs` with no reconcile step. So intent was only ever
   * resolved by catalogs that were already present at mount.
   *
   * Two independent locks, hence two fixes: the guard now stays eligible while
   * unresolved intent exists, and the scan-completion writer reconciles too.
   *
   * These tests cover the guard half, which is reachable by mounting. The
   * scan-completion half is covered by a wiring assertion plus item D3 of the
   * human delta retest, because the Scan control sits inside a collapsed
   * section behind credential gating that a mounted test cannot usefully drive.
   */
  beforeEach(() => {
    persistedStates = [];
    vi.clearAllMocks();
  });
  afterEach(() => cleanup());

  /** An imported run: catalogs present for the locked minor, intent unresolved. */
  function importedIntentOnlyState(minor = '4.21') {
    const catalogImage = `registry.redhat.io/redhat/redhat-operator-index:v${minor}`;
    return {
      ...STATE_RELOCKING_ONTO_420,
      version: {
        _schemaVersion: 3,
        selectedMinor: minor,
        selectedPatch: `${minor}.9`,
        selectedChannel: `stable-${minor}`,
        locked: true,
        confirmedByUser: true,
      },
      release: { channel: minor, patchVersion: `${minor}.9`, confirmed: true, followLatestMinor: false },
      blueprint: { platform: 'Bare Metal', arch: 'x86_64', confirmed: true },
      operators: {
        // Intent only: no catalogImage, no defaultChannel. This is exactly what
        // buildInvalidatedOperatorState produces and what an export preserves.
        selected: [{ name: 'openshift-gitops-operator', id: 'openshift-gitops-operator-redhat', sources: ['gitops'] }],
        catalogs: { redhat: [], certified: [], community: [] },
        version: null,
        scenarios: {},
        pendingScenarios: { gitops: true },
        scenarioAdded: { 'openshift-gitops-operator-redhat': { gitops: true } },
        scanJobs: {},
        stale: true,
        fastMode: false,
      },
      ui: { ...STATE_RELOCKING_ONTO_420.ui, activeStepId: 'operators' },
      __catalogImage: catalogImage,
    };
  }

  const scannedCatalog = (minor) => ({
    redhat: {
      results: [
        {
          id: 'openshift-gitops-operator-redhat',
          name: 'openshift-gitops-operator',
          displayName: 'Red Hat OpenShift GitOps',
          defaultChannel: `stable-${minor}`,
        },
      ],
      updatedAt: 1700000001000,
    },
    certified: { results: [], updatedAt: null },
    community: { results: [], updatedAt: null },
  });

  it('resolves intent-only selections when the catalog status returns results', async () => {
    installFetchMock({ loadedState: importedIntentOnlyState('4.21'), catalogStatus: scannedCatalog('4.21') });
    render(<App />);

    await waitFor(() => {
      const ops = latestPersisted()?.operators;
      const sel = ops?.selected?.find((o) => o.name === 'openshift-gitops-operator');
      expect(sel?.defaultChannel, 'defaultChannel was never resolved').toBe('stable-4.21');
    });

    const ops = latestPersisted().operators;
    const sel = ops.selected.find((o) => o.name === 'openshift-gitops-operator');
    // Both fields the ImageSet generator requires.
    expect(sel.catalogImage, 'catalogImage was never stamped').toBeTruthy();
    expect(sel.catalogImage).toContain('v4.21');
    // And the Quick Pick must leave the dotted pending state.
    expect(ops.scenarios?.gitops, 'the Quick Pick stayed pending').toBe(true);
    expect(ops.pendingScenarios?.gitops).toBeFalsy();
  });

  it('a reconciled selection is emitted by the ImageSet generator', async () => {
    // Closes the loop the human actually cared about: the artifact.
    installFetchMock({ loadedState: importedIntentOnlyState('4.21'), catalogStatus: scannedCatalog('4.21') });
    render(<App />);
    await waitFor(() => {
      expect(latestPersisted()?.operators?.selected?.[0]?.defaultChannel).toBe('stable-4.21');
    });
    const sel = latestPersisted().operators.selected[0];
    // buildImageSetConfig skips any operator missing either field.
    expect(Boolean(sel.catalogImage && sel.defaultChannel), 'generator would skip this operator').toBe(true);
  });

  it('an operator that is genuinely gone stays pending rather than being invented', async () => {
    // Fail closed: no fabricated channel, and it must not reach the ImageSet.
    const emptyScan = { redhat: { results: [], updatedAt: 1700000001000 }, certified: { results: [], updatedAt: null }, community: { results: [], updatedAt: null } };
    installFetchMock({ loadedState: importedIntentOnlyState('4.21'), catalogStatus: emptyScan });
    render(<App />);

    await waitFor(() => expect(latestPersisted()?.operators?.version).toBe('4.21'));
    const ops = latestPersisted().operators;
    const sel = ops.selected.find((o) => o.name === 'openshift-gitops-operator');
    expect(sel?.defaultChannel, 'a channel was invented for a missing package').toBeFalsy();
    expect(sel?.catalogImage, 'a catalog image was invented for a missing package').toBeFalsy();
    expect(ops.scenarios?.gitops, 'a Quick Pick was activated without its packages').toBeFalsy();
  });

  it('reconciles even when catalogs for this minor are ALREADY present', async () => {
    /**
     * The guard half, isolated. This is the fixture the old guard skipped:
     *   operators.version === the locked minor  AND  catalogs.redhat is
     *   non-empty  AND  the selections are still intent-only.
     * `if (operators.version === version && catalogs.redhat.length) return;`
     * fired before reconciliation could run, so the run stayed at
     * "Default channel: unknown" with an empty ImageSet forever.
     *
     * Note the other tests in this block use `version: null`, which the old
     * guard did NOT skip — they pass either way and do not prove this fix.
     */
    const base = importedIntentOnlyState('4.21');
    const loadedState = {
      ...base,
      operators: {
        ...base.operators,
        version: '4.21',
        catalogs: {
          redhat: [
            {
              id: 'openshift-gitops-operator-redhat',
              name: 'openshift-gitops-operator',
              displayName: 'Red Hat OpenShift GitOps',
              defaultChannel: 'stable-4.21',
            },
          ],
          certified: [],
          community: [],
        },
      },
    };
    installFetchMock({ loadedState, catalogStatus: scannedCatalog('4.21') });
    render(<App />);

    await waitFor(() => {
      const sel = latestPersisted()?.operators?.selected?.find((o) => o.name === 'openshift-gitops-operator');
      expect(sel?.defaultChannel, 'the stale guard skipped reconciliation again').toBe('stable-4.21');
    });
    const ops = latestPersisted().operators;
    expect(ops.selected[0].catalogImage).toContain('v4.21');
    expect(ops.scenarios?.gitops, 'the Quick Pick stayed pending').toBe(true);
  });

  it('the scan-completion writer reconciles too, not just the mount-time effect', () => {
    // The second lock. Source-level because the Scan control is behind a
    // collapsed section and credential gating; the behaviour is delta-retest D3.
    const src = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '../src/steps/OperatorsStep.jsx'), 'utf8');
    const writer = src.slice(src.indexOf('job.status === "completed" || job.status === "failed"'));
    const block = writer.slice(0, writer.indexOf('const allDone'));
    expect(block, 'the scan-completion writer must reconcile, not just assign catalogs')
      .toMatch(/reconcileOperatorsForMinor\s*\(/);
  });
});
