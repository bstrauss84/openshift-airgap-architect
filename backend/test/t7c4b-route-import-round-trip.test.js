/**
 * Tranche 7C.4B — a saved run carrying BOTH route kinds survives import and
 * regeneration.
 *
 * Human QA B3 could not complete: the tester had no old saved run containing a
 * genuine ADDITIONAL route, only runs with a default gateway. Rather than ask
 * them to hand-craft one, the fixture is synthesised here and driven through
 * the real `/api/run/import` endpoint and the real generator.
 *
 * It also settles the question they raised. A DEFAULT route is not stored in
 * `primary.advanced.routes` at all — it is derived from `primary.ipv4Gateway`
 * / `ipv6Gateway`. The node editor's Advanced group auto-expands on the
 * presence of entries in `advanced.routes`, so a run carrying only a default
 * gateway correctly does NOT auto-open the Additional Routes group. That is
 * the intended behaviour, not a defect, and it is why their observation looked
 * inconclusive.
 *
 * Two route kinds, two different mechanisms:
 *   default route      — from `primary.ipv4Gateway`, emitted as 0.0.0.0/0
 *   additional route   — from `advanced.routes[]`, emitted verbatim
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import yaml from "js-yaml";

import { app } from "../src/index.js";
import { buildAgentConfig } from "../src/generate.js";
import { createTestServer, closeTestServer } from "./helpers/httpServerLifecycle.js";

/**
 * A saved run of the shape the export path produces: 4.22 bare-metal Agent,
 * one host with a default gateway, one primary additional route, and one route
 * on a secondary interface.
 */
function savedRunWithRoutes() {
  return {
    _schemaVersion: 3,
    release: { channel: "4.22", patchVersion: "4.22.16" },
    version: {
      selectedMinor: "4.22",
      selectedPatch: "4.22.16",
      selectedChannel: "stable-4.22",
      locked: true
    },
    blueprint: {
      platform: "Bare Metal",
      clusterName: "route-import",
      baseDomain: "example.com",
      arch: "x86_64"
    },
    methodology: { method: "Agent-Based Installer" },
    globalStrategy: { networking: { ipStackMode: "ipv4", machineNetworkV4: "192.168.111.0/24" } },
    hostInventory: {
      ipStackMode: "ipv4",
      nodes: [
        {
          name: "master-0",
          hostname: "master-0",
          role: "master",
          bmc: {},
          primary: {
            type: "ethernet",
            mode: "static",
            ethernet: { name: "eno1", macAddress: "52:54:00:00:00:01" },
            ipv4Cidr: "192.168.111.80/24",
            // The DEFAULT route lives here, not in advanced.routes.
            ipv4Gateway: "192.168.111.1",
            advanced: {
              mtu: "1500",
              sriov: { enabled: false, totalVfs: "" },
              vrf: { enabled: false, name: "vrf0", tableId: "100", ports: "" },
              // A genuine ADDITIONAL route on the primary.
              routes: [
                {
                  destination: "10.20.0.0/16",
                  nextHopAddress: "192.168.111.254",
                  nextHopInterface: "eno1"
                }
              ]
            }
          },
          additionalInterfaces: [
            {
              type: "ethernet",
              mode: "static",
              ethernet: { name: "eno9", macAddress: "52:54:00:00:00:09" },
              ipv4Cidr: "10.10.5.10/24",
              bond: { name: "bond9", mode: "active-backup", slaves: [] },
              vlan: { id: "", baseIface: "", name: "" },
              advanced: {
                mtu: "1500",
                sriov: { enabled: false, totalVfs: "" },
                vrf: { enabled: false, name: "vrf9", tableId: "100", ports: "" },
                // A genuine ADDITIONAL route on a SECONDARY interface — the
                // case that was dead on both ends before Tranche 7C.4.
                routes: [
                  {
                    destination: "203.0.113.0/24",
                    nextHopAddress: "10.10.5.1",
                    nextHopInterface: "eno9"
                  }
                ]
              }
            }
          ]
        }
      ]
    },
    exportOptions: { includeCredentials: true },
    credentials: {}
  };
}

const routesOf = (agentConfigYaml) =>
  yaml.load(agentConfigYaml).hosts[0].networkConfig.routes.config;

/**
 * Import once, regenerate once, reuse across assertions.
 *
 * A memoised promise rather than a `before` hook: node:test cancels a
 * suite's children when an async hook has not settled, which silently turns
 * every assertion below into "did not finish before its parent".
 */
let setupPromise = null;
function importedRun() {
  if (!setupPromise) {
    setupPromise = (async () => {
      const { baseUrl, server } = await createTestServer(app);
      try {
        await fetch(`${baseUrl}/api/start-over`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ cancelRunningOcMirror: false })
        });

        // The real supported import path.
        const res = await fetch(`${baseUrl}/api/run/import`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ state: savedRunWithRoutes() })
        });
        /* Read the body ONCE. `assert.equal(res.status, 200, await res.text())`
           evaluates the message eagerly and consumes the stream, so the
           following `res.json()` throws "Body has already been read". */
        const importBody = await res.json().catch(() => null);
        assert.equal(res.status, 200, `import failed: ${JSON.stringify(importBody)}`);
        const imported = importBody.state;

        // Regenerate from the imported state, the way the preview does.
        const gen = await fetch(`${baseUrl}/api/generate`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ state: imported })
        });
        const genBody = await gen.json().catch(() => null);
        assert.equal(gen.status, 200, `generate failed: ${JSON.stringify(genBody)}`);
        const generated = genBody.files["agent-config.yaml"];
        return { imported, generated };
      } finally {
        await closeTestServer(server);
      }
    })();
  }
  return setupPromise;
}

test("7C.4B import: restores the default gateway into its canonical location", async () => {
  const { imported } = await importedRun();
  assert.equal(imported.hostInventory.nodes[0].primary.ipv4Gateway, "192.168.111.1");
});

test("7C.4B import: restores the primary's additional route", async () => {
  const { imported } = await importedRun();
  const routes = imported.hostInventory.nodes[0].primary.advanced.routes;
  assert.equal(routes.length, 1);
  assert.equal(routes[0].destination, "10.20.0.0/16");
  assert.equal(routes[0].nextHopAddress, "192.168.111.254");
});

test("7C.4B import: restores the SECONDARY interface's additional route", async () => {
  const { imported } = await importedRun();
  const routes = imported.hostInventory.nodes[0].additionalInterfaces[0].advanced.routes;
  assert.equal(routes.length, 1);
  assert.equal(routes[0].destination, "203.0.113.0/24");
  assert.equal(routes[0].nextHopInterface, "eno9");
});

test("7C.4B import: regenerates the default route from the gateway", async () => {
  const { generated } = await importedRun();
  const def = routesOf(generated).find((r) => r.destination === "0.0.0.0/0");
  assert.ok(def, "the default route must be regenerated");
  assert.equal(def["next-hop-address"], "192.168.111.1");
  assert.equal(def["next-hop-interface"], "eno1");
});

test("7C.4B import: regenerates the primary's additional route", async () => {
  const { generated } = await importedRun();
  const r = routesOf(generated).find((x) => x.destination === "10.20.0.0/16");
  assert.ok(r, "the imported primary route must survive regeneration");
  assert.equal(r["next-hop-interface"], "eno1");
});

test("7C.4B import: regenerates the SECONDARY interface's additional route", async () => {
  const { generated } = await importedRun();
  const r = routesOf(generated).find((x) => x.destination === "203.0.113.0/24");
  assert.ok(r, "the imported secondary route must survive regeneration");
  assert.equal(r["next-hop-interface"], "eno9");
});

test("7C.4B import: emits all three routes and invents none", async () => {
  const { generated } = await importedRun();
  assert.deepEqual(
    routesOf(generated).map((r) => r.destination).sort(),
    ["0.0.0.0/0", "10.20.0.0/16", "203.0.113.0/24"]
  );
});

test("7C.4B import: an edited route round-trips — the imported value is not frozen", async () => {
  const { imported } = await importedRun();
  const edited = JSON.parse(JSON.stringify(imported));
  edited.hostInventory.nodes[0].primary.advanced.routes[0].destination = "10.30.0.0/16";
  const regenerated = yaml.load(buildAgentConfig(edited));
  assert.deepEqual(
    regenerated.hosts[0].networkConfig.routes.config.map((r) => r.destination).sort(),
    ["0.0.0.0/0", "10.30.0.0/16", "203.0.113.0/24"]
  );
});

test("7C.4B: a run with ONLY a default gateway carries no advanced.routes entry", async () => {
  /* Settles the human's B3 question. A default route is derived from
     `primary.ipv4Gateway`, not stored in `advanced.routes`, so the node
     editor's Advanced group — which auto-expands on `advanced.routes` having
     entries — correctly does NOT auto-open for such a run. Their observation
     was the intended behaviour. */
  const run = savedRunWithRoutes();
  run.hostInventory.nodes[0].primary.advanced.routes = [];
  run.hostInventory.nodes[0].additionalInterfaces = [];
  const doc = yaml.load(buildAgentConfig(run));
  assert.deepEqual(
    doc.hosts[0].networkConfig.routes.config.map((r) => r.destination),
    ["0.0.0.0/0"],
    "the default route is still generated from the gateway alone"
  );
  assert.equal(run.hostInventory.nodes[0].primary.advanced.routes.length, 0);
});
