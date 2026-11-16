/**
 * POST /api/state must be able to CLEAR a map, not only add to it.
 *
 * WHAT A HUMAN SAW. Three catalog scan job ids returning `404 Job not found`
 * on every visit to the Operators step. The frontend fix drops a provably gone
 * job id by writing `operators.scanJobs = {}` — and that write was silently
 * undone here: `deepMerge` recursed into nested objects and could only ever
 * add or overwrite keys, so an explicitly EMPTY object was indistinguishable
 * from "key omitted, leave alone". The next `GET /api/state` after a reload
 * handed the stale ids straight back and the 404 loop resumed.
 *
 * The same hole sat under the cross-minor invalidation in
 * `frontend/src/shared/operatorMinorReconciliation.js`, which writes
 * `scanJobs: {}`, `catalogs: {}` and `scenarios: {}`.
 *
 * CONTRACT. An explicitly provided empty object REPLACES. An omitted key still
 * means "leave alone", which is what keeps genuine partial patches working.
 *
 * @author Bill Strauss
 *
 * Developed with AI assistance from Claude (Anthropic) and Cursor AI.
 */

import { test } from "node:test";
import assert from "node:assert";
import { app } from "../src/index.js";
import { createTestServer, closeTestServer } from "./helpers/httpServerLifecycle.js";

const postState = async (baseUrl, patch) => {
  const res = await fetch(`${baseUrl}/api/state`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch)
  });
  return res;
};

const getState = async (baseUrl) => (await fetch(`${baseUrl}/api/state`)).json();

/** The persisted state is process-wide, so each test starts from defaults. */
const reset = async (baseUrl) => {
  await fetch(`${baseUrl}/api/start-over`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ cancelRunningOcMirror: false })
  });
};

test("POST /api/state clearing operators.scanJobs survives a subsequent GET", async () => {
  const { server, baseUrl } = await createTestServer(app);
  try {
    await reset(baseUrl);
    const seeded = await postState(baseUrl, {
      operators: {
        scanJobs: { redhat: "job-rh", certified: "job-ct", community: "job-cm" },
        version: "4.22"
      }
    });
    assert.strictEqual(seeded.status, 200);
    assert.deepStrictEqual((await getState(baseUrl)).operators.scanJobs, {
      redhat: "job-rh",
      certified: "job-ct",
      community: "job-cm"
    });

    // The step has learned all three jobs are gone.
    const cleared = await postState(baseUrl, { operators: { scanJobs: {}, stale: true } });
    assert.strictEqual(cleared.status, 200);

    const after = (await getState(baseUrl)).operators;
    assert.deepStrictEqual(
      after.scanJobs,
      {},
      "the stale job ids came back, so the step will 404 them again on the next mount"
    );
    assert.strictEqual(after.stale, true);
    // Sibling keys in the same object are untouched by the clear.
    assert.strictEqual(after.version, "4.22");
  } finally {
    await closeTestServer(server);
  }
});

test("POST /api/state clearing the cross-minor invalidation maps survives a GET", async () => {
  const { server, baseUrl } = await createTestServer(app);
  try {
    await reset(baseUrl);
    await postState(baseUrl, {
      operators: {
        scanJobs: { redhat: "job-rh" },
        catalogs: { redhat: [{ id: "op-1", name: "cluster-logging" }] },
        scenarios: { logging: true },
        scenarioAdded: { "op-1": { logging: true } }
      }
    });

    // Exactly what buildInvalidatedOperatorState writes on a minor change.
    await postState(baseUrl, {
      operators: { scanJobs: {}, catalogs: {}, scenarios: {}, pendingScenarios: { logging: true } }
    });

    const after = (await getState(baseUrl)).operators;
    assert.deepStrictEqual(after.scanJobs, {});
    assert.deepStrictEqual(after.catalogs, {});
    assert.deepStrictEqual(after.scenarios, {});
    assert.deepStrictEqual(after.pendingScenarios, { logging: true });
  } finally {
    await closeTestServer(server);
  }
});

test("an OMITTED nested key is still left alone — partial patches keep working", async () => {
  const { server, baseUrl } = await createTestServer(app);
  try {
    await reset(baseUrl);
    await postState(baseUrl, {
      operators: { scanJobs: { redhat: "job-rh" }, version: "4.22", fastMode: true }
    });

    // No `operators` key at all.
    await postState(baseUrl, { methodology: { method: "IPI" } });

    const after = await getState(baseUrl);
    assert.deepStrictEqual(after.operators.scanJobs, { redhat: "job-rh" });
    assert.strictEqual(after.operators.version, "4.22");
    assert.strictEqual(after.operators.fastMode, true);
    assert.strictEqual(after.methodology.method, "IPI");
  } finally {
    await closeTestServer(server);
  }
});

test("a non-empty nested patch still MERGES rather than replacing", async () => {
  const { server, baseUrl } = await createTestServer(app);
  try {
    await reset(baseUrl);
    await postState(baseUrl, {
      operators: { scanJobs: { redhat: "job-rh", certified: "job-ct" }, version: "4.22" }
    });

    await postState(baseUrl, { operators: { scanJobs: { community: "job-cm" } } });

    const after = (await getState(baseUrl)).operators;
    assert.deepStrictEqual(after.scanJobs, {
      redhat: "job-rh",
      certified: "job-ct",
      community: "job-cm"
    });
    assert.strictEqual(after.version, "4.22");
  } finally {
    await closeTestServer(server);
  }
});

/* ---------------------------------------------------------------------------
 * Tranche 7C.4A — BLAST RADIUS of the deepMerge semantic change.
 *
 * The change above is GLOBAL: every caller of `deepMerge` now treats an
 * explicitly empty object as a replacement. It was kept global rather than
 * special-cased to `scanJobs` on purpose. `frontend/src/store.jsx` POSTs the
 * WHOLE sanitised state on every change, so under the old semantics the server
 * could never be told that ANY nested map had become empty — not just scan
 * jobs. Clearing every selected operator, clearing visited steps, clearing a
 * quick-pick map were all equally unpersistable. A scanJobs-only special case
 * would have left that latent everywhere else.
 *
 * Because the change is global it has to be proven safe for the other
 * callers, not merely sufficient for the stale-job symptom.
 * ------------------------------------------------------------------------ */

test("clearing one map removes ONLY that map — siblings at the same level survive", async () => {
  const { baseUrl, server } = await createTestServer(app);
  try {
    await reset(baseUrl);
    await postState(baseUrl, {
      operators: {
        scanJobs: { redhat: "j1", certified: "j2" },
        selected: [{ id: "redhat:nfd", name: "nfd" }],
        scenarios: { "openshift-ai": true },
        stale: false,
        version: "4.22"
      }
    });

    await postState(baseUrl, { operators: { scanJobs: {} } });

    const after = (await getState(baseUrl)).operators;
    assert.deepEqual(after.scanJobs, {}, "the targeted map is cleared");
    assert.equal(after.selected.length, 1, "a sibling ARRAY survives");
    assert.equal(after.selected[0].name, "nfd");
    assert.deepEqual(after.scenarios, { "openshift-ai": true }, "a sibling MAP survives");
    assert.equal(after.version, "4.22", "a sibling SCALAR survives");
    assert.equal(after.stale, false, "a falsy sibling scalar survives");
  } finally {
    await closeTestServer(server);
  }
});

test("clearing a nested map does not disturb a DIFFERENT top-level section", async () => {
  const { baseUrl, server } = await createTestServer(app);
  try {
    await reset(baseUrl);
    await postState(baseUrl, {
      operators: { scanJobs: { redhat: "j1" } },
      hostInventory: { provisioningNetwork: "Managed", provisioningNetworkCIDR: "172.22.0.0/24" },
      globalStrategy: { networking: { ipStackMode: "dual-stack" } }
    });

    await postState(baseUrl, { operators: { scanJobs: {} } });

    const after = await getState(baseUrl);
    assert.deepEqual(after.operators.scanJobs, {});
    assert.equal(after.hostInventory.provisioningNetwork, "Managed", "unrelated section intact");
    assert.equal(after.hostInventory.provisioningNetworkCIDR, "172.22.0.0/24");
    assert.equal(after.globalStrategy.networking.ipStackMode, "dual-stack", "deeply nested sibling intact");
  } finally {
    await closeTestServer(server);
  }
});

test("a DEEPLY nested empty object clears only at its own level", async () => {
  const { baseUrl, server } = await createTestServer(app);
  try {
    await reset(baseUrl);
    await postState(baseUrl, {
      globalStrategy: {
        networking: { ipStackMode: "dual-stack", machineNetworkV4: "10.0.0.0/24" },
        mirroring: { registryFqdn: "registry.local:5000" }
      }
    });

    await postState(baseUrl, { globalStrategy: { mirroring: {} } });

    const after = (await getState(baseUrl)).globalStrategy;
    assert.deepEqual(after.mirroring, {}, "the targeted nested map is cleared");
    assert.equal(after.networking.ipStackMode, "dual-stack", "its sibling subtree is untouched");
    assert.equal(after.networking.machineNetworkV4, "10.0.0.0/24");
  } finally {
    await closeTestServer(server);
  }
});

test("import replaces wholesale and never goes through deepMerge", async () => {
  /* The highest-risk caller would have been import: if it merged, a previously
     persisted section absent from the imported run could survive and
     contaminate it. It does not — `/api/run/import` calls `setState()`
     directly. Pinned here so a future refactor cannot quietly route import
     through the merge path and inherit these semantics. */
  const { baseUrl, server } = await createTestServer(app);
  try {
    await reset(baseUrl);
    await postState(baseUrl, {
      operators: { scanJobs: { redhat: "stale-job" }, selected: [{ id: "redhat:nfd", name: "nfd" }] }
    });

    const imported = {
      _schemaVersion: 3,
      release: { channel: "4.22", patchVersion: "4.22.16" },
      version: {
        selectedMinor: "4.22",
        selectedPatch: "4.22.16",
        selectedChannel: "stable-4.22",
        locked: true
      },
      blueprint: { platform: "Bare Metal", clusterName: "imported", baseDomain: "example.com" },
      methodology: { method: "IPI" }
    };

    const res = await fetch(`${baseUrl}/api/run/import`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ state: imported })
    });
    assert.equal(res.status, 200, await res.text());

    const after = await getState(baseUrl);
    assert.equal(after.blueprint.clusterName, "imported");
    assert.ok(
      !after.operators?.scanJobs?.redhat,
      "the pre-import stale job id must not survive an import"
    );
  } finally {
    await closeTestServer(server);
  }
});

test("an empty ARRAY still replaces, exactly as before the change", async () => {
  // Arrays were always replaced wholesale. The change touched objects only.
  const { baseUrl, server } = await createTestServer(app);
  try {
    await reset(baseUrl);
    await postState(baseUrl, { operators: { selected: [{ id: "redhat:nfd", name: "nfd" }] } });
    await postState(baseUrl, { operators: { selected: [] } });
    const after = await getState(baseUrl);
    assert.deepEqual(after.operators.selected, []);
  } finally {
    await closeTestServer(server);
  }
});

test("clearing every selected operator now persists — the same hole, elsewhere", async () => {
  /* Demonstrates why the fix was kept global. `scenarios` is a map, so before
     the change a user who deselected their last Quick Pick could not have that
     persisted either; it came back on reload exactly like the scan jobs did. */
  const { baseUrl, server } = await createTestServer(app);
  try {
    await reset(baseUrl);
    await postState(baseUrl, {
      operators: { scenarios: { "openshift-ai": true }, scenarioAdded: { "redhat:nfd": { "openshift-ai": true } } }
    });
    await postState(baseUrl, { operators: { scenarios: {}, scenarioAdded: {} } });
    const after = (await getState(baseUrl)).operators;
    assert.deepEqual(after.scenarios, {});
    assert.deepEqual(after.scenarioAdded, {});
  } finally {
    await closeTestServer(server);
  }
});
