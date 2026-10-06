/**
 * App-level cover for the operator cross-minor transition contract (R5).
 *
 * The live path is: unlock release → pick another minor → re-lock via the Core
 * Lock modal ("Yes, lock selections"). That path previously left the Operators
 * step unflagged and left quick picks rendered as actively selected, even though
 * the generator already dropped the stale catalog from the ImageSet output.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent, act } from '@testing-library/react';
import React from 'react';
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
        name: 'odf-operator',
        id: 'odf-operator-redhat',
        displayName: 'OpenShift Data Foundation',
        catalogImage: V421_CATALOG,
        defaultChannel: 'stable-4.21',
        sources: ['odf'],
      },
    ],
    catalogs: { redhat: [{ id: 'odf-operator-redhat', name: 'odf-operator' }], certified: [], community: [] },
    version: '4.21',
    scenarios: { odf: true },
    scenarioAdded: { 'odf-operator-redhat': { odf: true } },
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
    expect(operators.pendingScenarios).toEqual({ odf: true });
    expect(operators.selected.map((op) => op.name)).toEqual(['odf-operator']);
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
    expect(persisted.operators.pendingScenarios).toEqual({ odf: true });
    for (const op of persisted.operators.selected) {
      expect(op.catalogImage).toBeUndefined();
    }
  });

  it('restores the quick pick to an active selection after a successful current-minor scan', async () => {
    installFetchMock({
      catalogStatus: {
        redhat: [
          {
            id: 'odf-operator-redhat',
            name: 'odf-operator',
            displayName: 'OpenShift Data Foundation',
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
      expect(operators?.scenarios).toEqual({ odf: true });
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
          id: 'odf-operator-redhat',
          name: 'odf-operator',
          displayName: 'OpenShift Data Foundation',
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
        expect(latestPersisted()?.operators?.scenarios).toEqual({ odf: true });
      });
    }

    it('shows the reconciled operator in the Selected Operators section', async () => {
      await reconcileAndOpen();
      expect(await screen.findByText('OpenShift Data Foundation')).toBeInTheDocument();
    });

    it('does not leave the Selected Operators section collapsed', async () => {
      await reconcileAndOpen();
      await screen.findByText('OpenShift Data Foundation');
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
      expect(selected[0].name).toBe('odf-operator');
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
    // 4.20 catalogs return results, but odf-operator is not among them. Results
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
    expect(operators.pendingScenarios).toEqual({ odf: true });
    expect(operators.selected.every((op) => !op.catalogImage)).toBe(true);
    expect(document.querySelector('.scenario-pick[data-selection-state="active"]')).toBeNull();

    // And the conflict is surfaced rather than silently dropped. The banner text
    // spans several nodes, so assert on the rendered text content.
    await waitFor(() => {
      const text = document.body.textContent.replace(/\s+/g, ' ');
      expect(text).toContain('not available in the OpenShift 4.20 catalogs');
      expect(text).toContain('OpenShift Data Foundation');
      expect(text).toContain('excluded from the generated ImageSet configuration');
    });
  });
});
