/**
 * v2.3.0 owner QA (2026-11-17), P4 — one read-only readiness evidence bundle.
 *
 * The collector script (src/assets/oaa-readiness-collector.sh) is run for real against a fake `oc`
 * whose objects carry credential-like canaries in the places a real cluster can (Subscription
 * spec.config env, CSV annotations, ClusterVersion clusterID/upstream URL, APIRequestCount user
 * names, error text). The bundle must keep none of them, record an unreadable section only as a
 * classification, and populate every applicable readiness check when uploaded — and nothing else.
 *
 * Developed with AI assistance from Claude (Anthropic).
 */
import { test, describe, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { app } from "../src/index.js";
import { createTestServer, closeTestServer } from "./helpers/httpServerLifecycle.js";
import { resetMirroringForTests, resetUpgradeForTests } from "./helpers/resetWorkflowsForTests.js";
import { projectBundle, redactText } from "../src/upgradeInventory.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.join(here, "..", "src", "assets", "oaa-readiness-collector.sh");
const fixture = (name) => JSON.parse(fs.readFileSync(path.join(here, "fixtures", "upgrade-graph", `${name}.json`), "utf8")).body;
const hasJq = spawnSync("jq", ["--version"]).status === 0;
// Canaries built at run time (never literal credentials in the source).
const CANARY = ["cz", "canary", Date.now().toString(36)].join("-");
const B64 = Buffer.from(["user", CANARY].join(":")).toString("base64");

let server;
let baseUrl;
const api = async (method, url, body) => {
  const res = await fetch(`${baseUrl}${url}`, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { json = null; }
  return { status: res.status, json, text, headers: res.headers };
};
before(async () => {
  ({ server, baseUrl } = await createTestServer(app));
  for (const ch of ["stable-4.22", "stable-4.21", "stable-4.20"]) {
    assert.equal((await api("POST", "/api/upgrade/graph/import", { channel: ch, arch: "amd64", origin: "snapshot", text: JSON.stringify(fixture(`${ch}-amd64`)) })).status, 200);
  }
});
after(async () => { await resetMirroringForTests(); await resetUpgradeForTests(); await closeTestServer(server); });
beforeEach(async () => { await resetMirroringForTests(); await resetUpgradeForTests(); });

const cond = (type, status, reason = "", message = "") => ({ type, status, reason, message, lastTransitionTime: "2026-11-17T00:00:00Z" });
const rawCluster = () => ({
  clusterversion: { apiVersion: "config.openshift.io/v1", kind: "ClusterVersion", metadata: { name: "version", annotations: { secretish: CANARY } },
    spec: { clusterID: `id-${CANARY}`, channel: "stable-4.20", upstream: `https://osus.example.invalid/${CANARY}/graph` },
    status: { desired: { version: "4.20.14", image: "quay.io/x@sha256:abc" }, history: [{ version: "4.20.14", state: "Completed", completionTime: "2026-11-01T00:00:00Z" }],
      conditions: [cond("Available", "True"), cond("Failing", "False"), cond("Progressing", "False"), cond("Upgradeable", "True", "", `see https://admin:${CANARY}@internal.invalid/ token=${CANARY}`)] } },
  clusteroperators: { kind: "List", items: [
    { kind: "ClusterOperator", metadata: { name: "etcd" }, status: { conditions: [cond("Available", "True"), cond("Degraded", "False")], versions: [{ name: "operator", version: "4.20.14" }], relatedObjects: [{ name: CANARY }] } },
    { kind: "ClusterOperator", metadata: { name: "olm" }, status: { conditions: [cond("Available", "True"), cond("Degraded", "False"), cond("Upgradeable", "False", "IncompatibleOperatorsInstalled", "ClusterServiceVersions blocking minor version upgrades to 4.21.0 or higher: example.v1.0.0")], versions: [{ name: "operator", version: "4.20.14" }] } }
  ] },
  mcp: { kind: "List", items: ["master", "worker"].map((n) => ({ kind: "MachineConfigPool", metadata: { name: n, uid: CANARY }, spec: { paused: false, configuration: { name: CANARY } }, status: { conditions: [cond("Updated", "True"), cond("Degraded", "False"), cond("Updating", "False")], machineCount: 3, updatedMachineCount: 3, degradedMachineCount: 0 } })) },
  subscriptions: { kind: "List", items: [{ kind: "Subscription", metadata: { name: "example", namespace: "example-ns" }, spec: { name: "example", channel: "stable", source: "redhat-operators", installPlanApproval: "Manual", config: { env: [{ name: "API_TOKEN", value: CANARY }] } }, status: { installedCSV: "example.v1.0.0", currentCSV: "example.v1.0.0", state: "AtLatestKnown" } }] },
  csv: { kind: "List", items: [
    { kind: "ClusterServiceVersion", metadata: { name: "example.v1.0.0", namespace: "example-ns", annotations: { "alm-examples": `[{"spec":{"password":"${CANARY}"}}]`, "olm.properties": JSON.stringify([{ type: "olm.maxOpenShiftVersion", value: "4.20" }]) } }, spec: { version: "1.0.0", install: { spec: { deployments: [{ name: CANARY }] } } }, status: { phase: "Succeeded" } },
    { kind: "ClusterServiceVersion", metadata: { name: "example.v1.0.0", namespace: "other-ns", labels: { "olm.copiedFrom": "example-ns" } }, spec: { version: "1.0.0" }, status: { phase: "Succeeded" } }
  ] },
  apirequestcounts: { kind: "List", items: [
    { kind: "APIRequestCount", metadata: { name: "flowschemas.v1beta3.flowcontrol.apiserver.k8s.io" }, status: { removedInRelease: "1.34", requestCount: 42, last24h: [{ byNode: [{ byUser: [{ username: `system:serviceaccount:${CANARY}` }] }] }] } },
    { kind: "APIRequestCount", metadata: { name: "pods.v1" }, status: { requestCount: 9999 } }
  ] },
  admingates: { kind: "ConfigMap", metadata: { name: "admin-gates" }, data: { "ack-4.20-kube-1.34-api-removals-in-4.21": "Kubernetes 1.34 removes v1beta3 flowschemas; see the 4.21 release notes." } }
});

/** A fake `oc` that serves the raw objects; admin-acks is forbidden (with names in the error). */
const fakeOc = (dir, raw) => {
  for (const [k, v] of Object.entries(raw)) fs.writeFileSync(path.join(dir, `${k}.json`), JSON.stringify(v));
  fs.writeFileSync(path.join(dir, "oc"), `#!/usr/bin/env bash
D="${dir}"
case "$*" in
  whoami*) echo "user-${CANARY}" ;;
  "get clusterversion version -o json") cat "$D/clusterversion.json" ;;
  "get clusteroperators -o json") cat "$D/clusteroperators.json" ;;
  "get machineconfigpools -o json") cat "$D/mcp.json" ;;
  "get subscriptions.operators.coreos.com -A -o json") cat "$D/subscriptions.json" ;;
  "get clusterserviceversions.operators.coreos.com -A -o json") cat "$D/csv.json" ;;
  "get apirequestcounts.apiserver.openshift.io -o json") cat "$D/apirequestcounts.json" ;;
  "get configmap admin-gates -n openshift-config-managed -o json") cat "$D/admingates.json" ;;
  "get configmap admin-acks -n openshift-config -o json") echo "Error from server (Forbidden): configmaps \\"admin-acks\\" is forbidden: User \\"user-${CANARY}\\" cannot get" >&2; exit 1 ;;
  *) echo "unexpected oc call: $*" >&2; echo "$*" >> "$D/unexpected"; exit 1 ;;
esac
`, { mode: 0o755 });
};
const runCollector = (raw = rawCluster()) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "oaa-collector-"));
  fakeOc(dir, raw);
  const out = path.join(dir, "bundle.json");
  const r = spawnSync("bash", [SCRIPT, out], { env: { ...process.env, PATH: `${dir}:${process.env.PATH}` }, encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(fs.existsSync(path.join(dir, "unexpected")), false, "only the documented read-only calls");
  const text = fs.readFileSync(out, "utf8");
  const mode = fs.statSync(out).mode & 0o777;
  fs.rmSync(dir, { recursive: true, force: true });
  return { text, mode, stderr: r.stderr };
};
const newPlan = async () => {
  const p = (await api("POST", "/api/upgrade/plans", { name: "bundle" })).json;
  await api("POST", `/api/upgrade/plans/${p.id}`, { arch: "amd64", graphSource: "imported", currentChannel: "stable-4.20", current: "4.20.14", target: "4.22.22" });
  assert.equal((await api("POST", `/api/upgrade/plans/${p.id}/solve`, {})).status, 200);
  return p;
};
const byId = (checks) => Object.fromEntries(checks.map((c) => [c.id, c]));

describe("the collector script", () => {
  test("jq is available (the collector and these tests need it, like the release tooling and CI)", () => {
    assert.ok(hasJq, "install jq to run the collector tests");
  });

  test("contains only read-only oc calls", () => {
    // Executable lines only (comments and messages printed to the user are not commands).
    const code = fs.readFileSync(SCRIPT, "utf8").split("\n").filter((l) => !/^\s*#/.test(l) && !/\becho\b/.test(l)).join("\n");
    const verbs = [...code.matchAll(/\boc\s+([a-z-]+)/g)].map((m) => m[1]);
    assert.ok(verbs.length >= 1 && verbs.every((v) => v === "get" || v === "whoami"), verbs.join(","));
    assert.doesNotMatch(code, /curl|wget|https?:\/\//, "never sends anything anywhere");
    // The resources read are exactly the argument lines after each collect filter: never Secrets.
    const resources = [...code.matchAll(/^\s{2}([a-z][a-z.]+)(?:\s+[a-z-]+)*\s*(?:-A|-n\s+\S+)?\s*$/gm)].map((m) => m[1]).filter((w) => !["else", "fi", "then", "done"].includes(w));
    assert.deepEqual(resources, ["clusterversion", "clusteroperators", "machineconfigpools", "subscriptions.operators.coreos.com", "clusterserviceversions.operators.coreos.com", "apirequestcounts.apiserver.openshift.io", "configmap"].flatMap((r) => (r === "configmap" ? [] : [r])));
    assert.deepEqual([...code.matchAll(/configmap ([a-z-]+) -n ([a-z-]+)/g)].map((m) => `${m[2]}/${m[1]}`), ["openshift-config-managed/admin-gates", "openshift-config/admin-acks"]);
  });

  test("is served as a download, unchanged", async () => {
    const r = await api("GET", "/api/upgrade/readiness-collector");
    assert.equal(r.status, 200);
    assert.match(r.headers.get("content-disposition"), /oaa-readiness-collector\.sh/);
    assert.equal(r.text, fs.readFileSync(SCRIPT, "utf8"));
  });

  test("keeps no credential-bearing or identifying values, and classifies an unreadable section", () => {
    const { text, mode, stderr } = runCollector();
    assert.equal(mode, 0o600, "written readable by the owner only");
    assert.ok(!text.includes(CANARY), "no canary from env values, annotations, cluster ID, upstream, user names, error text");
    assert.ok(!stderr.includes(CANARY));
    const b = JSON.parse(text);
    assert.equal(b.kind, "OAAReadinessBundle");
    assert.ok(Date.parse(b.collectedAt));
    assert.deepEqual(b.sections.adminacks, { error: "forbidden" });
    assert.equal(b.sections.clusterversion.spec.upstream, "configured");
    assert.equal(b.sections.clusterversion.spec.clusterID, undefined);
    assert.equal(b.sections.subscriptions.items[0].spec.config, undefined);
    assert.equal(b.sections.csv.items.length, 1, "copied CSVs skipped");
    assert.equal(b.sections.csv.items[0].maxOpenShiftVersion, "4.20");
    assert.equal(b.sections.csv.items[0].metadata.annotations, undefined);
    assert.deepEqual(b.sections.apirequestcounts.items.map((a) => a.metadata.name), ["flowschemas.v1beta3.flowcontrol.apiserver.k8s.io"]);
  });
});

describe("uploading one bundle", () => {
  test("populates every applicable check from evidence, reports what it could not read, and invents nothing", async () => {
    const p = await newPlan();
    const { text } = runCollector();
    const r = await api("POST", `/api/upgrade/plans/${p.id}/inventory/bundle`, { text });
    assert.equal(r.status, 200, r.text);
    assert.equal(r.json.sections.adminacks.state, "unavailable");
    assert.equal(r.json.sections.adminacks.reason, "forbidden");
    assert.equal(r.json.sections.clusteroperators.state, "imported");
    assert.ok(!JSON.stringify(r.json).includes(CANARY));
    const ready = (await api("GET", `/api/upgrade/plans/${p.id}/readiness`)).json;
    const c = byId(ready.checks);
    assert.equal(c["cvo-health"].state, "VERIFIED");
    assert.equal(c["current-version"].state, "VERIFIED");
    assert.equal(c["mcp-health"].state, "VERIFIED");
    assert.equal(c["evidence-age"].state, "VERIFIED");
    assert.equal(c["cluster-operators"].state, "BLOCKED", "olm Upgradeable=False blocks the minor update");
    assert.match(c["cluster-operators"].detail, /olm \(IncompatibleOperatorsInstalled\)/);
    assert.equal(c["operator-compat"].state, "BLOCKED");
    assert.match(c["operator-compat"].detail, /example\.v1\.0\.0 \(maximum 4\.20; blocks the update to 4\.21\)/);
    assert.equal(c["api-removals"].state, "BLOCKED");
    assert.match(c["api-removals"].detail, /flowschemas\.v1beta3.*removed in 1\.34, 42 requests/);
    assert.equal(c["admin-acks"].state, "NOT_CHECKED", "admin-acks was unreadable: required, but not claimed unacknowledged");
    assert.match(c["admin-acks"].detail, /could not read admin-acks/);
    assert.equal(c["etcd-backup"].state, "NOT_CHECKED", "etcd is never derived from a bundle");
    assert.ok(!JSON.stringify(ready).includes(CANARY));
    // Persisted plan state carries no canary either.
    assert.ok(!JSON.stringify((await api("GET", "/api/upgrade")).json).includes(CANARY));
  });

  test("a healthy cluster's bundle verifies; an operator without a declared maximum is not claimed supported", async () => {
    const raw = rawCluster();
    raw.clusteroperators.items[1].status.conditions = [cond("Available", "True"), cond("Degraded", "False"), cond("Upgradeable", "True")];
    raw.csv.items[0].metadata.annotations = {};
    raw.apirequestcounts.items[0].status.requestCount = 0;
    const p = await newPlan();
    assert.equal((await api("POST", `/api/upgrade/plans/${p.id}/inventory/bundle`, { text: runCollector(raw).text })).status, 200);
    const c = byId((await api("GET", `/api/upgrade/plans/${p.id}/readiness`)).json.checks);
    assert.equal(c["cluster-operators"].state, "VERIFIED");
    assert.equal(c["api-removals"].state, "VERIFIED");
    assert.equal(c["operator-compat"].state, "NOT_CHECKED");
    assert.match(c["operator-compat"].detail, /does not prove each operator is supported/);
  });

  test("an old bundle is flagged by its own collection time", () => {
    const at = new Date(Date.now() - 3 * 24 * 3600000).toISOString();
    const { inventory } = projectBundle(JSON.stringify({ kind: "OAAReadinessBundle", apiVersion: "v1", collectedAt: at, sections: { mcp: rawCluster().mcp } }));
    assert.equal(inventory.collectedAt, at);
    assert.equal(inventory.sections.clusterversion.state, "missing");
  });

  test("kubeconfigs, Secrets, other documents and impossible times are refused", async () => {
    const p = await newPlan();
    const up = (doc) => api("POST", `/api/upgrade/plans/${p.id}/inventory/bundle`, { text: JSON.stringify(doc) });
    const ok = { kind: "OAAReadinessBundle", apiVersion: "v1", collectedAt: new Date().toISOString() };
    assert.equal((await up({ ...ok, sections: { mcp: { kind: "List", items: [{ kind: "Secret", data: { x: B64 } }] } } })).json.code, "INVENTORY_SECRET_REFUSED");
    assert.equal((await up({ kind: "Config", clusters: [], users: [{ user: { token: B64 } }], contexts: [] })).json.code, "INVENTORY_KUBECONFIG_REFUSED");
    assert.equal((await up(rawCluster().clusterversion)).json.code, "BUNDLE_KIND_MISMATCH");
    assert.equal((await up({ ...ok, collectedAt: new Date(Date.now() + 86400000).toISOString(), sections: { mcp: rawCluster().mcp } })).json.code, "BUNDLE_TIME_FUTURE");
    assert.equal((await up({ ...ok, sections: { mcp: { error: "forbidden" } } })).json.code, "BUNDLE_EMPTY");
    assert.equal((await api("GET", "/api/upgrade")).json.plans[0].inventory, null, "nothing saved");
  });

  test("an individual import after a bundle starts the evidence over instead of mixing timestamps", async () => {
    const p = await newPlan();
    await api("POST", `/api/upgrade/plans/${p.id}/inventory/bundle`, { text: runCollector().text });
    const r = await api("POST", `/api/upgrade/plans/${p.id}/inventory`, { kind: "mcp", text: JSON.stringify(rawCluster().mcp) });
    assert.equal(r.status, 200, r.text);
    assert.equal(r.json.inventory.source, undefined);
    assert.equal(r.json.inventory.clusterVersion, null);
    assert.equal(r.json.inventory.machineConfigPools.length, 2);
  });

  test("condition text is redacted of credential-like values", () => {
    const out = redactText(`pull from https://u:${CANARY}@r.invalid/x with Bearer ${CANARY}abcdef password=${CANARY} ${B64}${B64}${B64}`);
    assert.ok(!out.includes(CANARY));
  });
});
