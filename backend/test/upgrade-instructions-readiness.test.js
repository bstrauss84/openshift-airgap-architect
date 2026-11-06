/**
 * v2.3.0 P5/P6 — instructions, documentation versions, readiness, inventory
 * import and artifacts, through the real API.
 *
 * Developed with AI assistance from Claude (Anthropic).
 */
import { test, describe, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";

import { app } from "../src/index.js";
import { getState } from "../src/utils.js";
import { createTestServer, closeTestServer } from "./helpers/httpServerLifecycle.js";
import { resetMirroringForTests, resetUpgradeForTests } from "./helpers/resetWorkflowsForTests.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixtureText = (name) => JSON.stringify(JSON.parse(fs.readFileSync(path.join(here, "fixtures", "upgrade-graph", `${name}.json`), "utf8")).body);
const SECRET = JSON.stringify({ auths: { "registry.redhat.io": { auth: Buffer.from("u:p").toString("base64") } } });
const DEST = JSON.stringify({ auths: { "mirror.example.invalid:8443": { auth: Buffer.from("d:p").toString("base64") } } });
const FORBIDDEN = ["--force", "--allow-upgrade-with-warnings", "--allow-not-recommended", "upgrade accept"];

let server;
let baseUrl;
let stubDir;
const originalBin = process.env.OC_MIRROR_BIN;
const api = async (method, url, body) => {
  const res = await fetch(`${baseUrl}${url}`, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  let json = null;
  try { json = await res.json(); } catch { json = null; }
  return { status: res.status, json };
};
const settle = async (id) => {
  for (let i = 0; i < 800; i++) {
    const j = (await api("GET", `/api/jobs/${id}`)).json;
    if (j && !["queued", "running"].includes(j.status)) return j;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error("not settled");
};
const allCommands = (ins) => JSON.stringify(ins.methods);

before(async () => {
  stubDir = fs.mkdtempSync(path.join(os.tmpdir(), "oaa-ins-stub-"));
  const p = path.join(stubDir, "oc-mirror");
  // Mirror to mirror: writes the cluster resources oc-mirror v2 writes into <workspace>/working-dir/cluster-resources.
  fs.writeFileSync(p, `#!${process.execPath}
const fs = require("fs"); const path = require("path");
const args = process.argv.slice(2);
if (args.includes("version")) { console.log(JSON.stringify({ clientVersion: { gitVersion: "4.22.0-stub-ins", gitCommit: "0" } })); }
else {
  const i = args.indexOf("--workspace");
  if (i >= 0) {
    const dir = path.join(args[i + 1].replace(/^file:\\/\\//, ""), "working-dir", "cluster-resources");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "idms-oc-mirror.yaml"), "apiVersion: config.openshift.io/v1\\nkind: ImageDigestMirrorSet\\nmetadata:\\n  name: idms-release-0\\n");
    if (!process.env.STUB_NO_SIGNATURES) fs.writeFileSync(path.join(dir, "signature-configmap.json"), JSON.stringify({ kind: "ConfigMap", metadata: { name: "mirrored-release-signatures", namespace: "openshift-config-managed" } }));
  }
}
`);
  fs.chmodSync(p, 0o755);
  process.env.OC_MIRROR_BIN = p;
  ({ server, baseUrl } = await createTestServer(app));
  for (const ch of ["stable-4.22", "stable-4.21", "stable-4.20", "eus-4.22"]) {
    assert.equal((await api("POST", "/api/upgrade/graph/import", { channel: ch, arch: "amd64", origin: "snapshot", text: fixtureText(`${ch}-amd64`) })).status, 200);
  }
});
after(async () => {
  delete process.env.STUB_NO_SIGNATURES;
  await resetMirroringForTests();
  await resetUpgradeForTests();
  await closeTestServer(server);
  if (originalBin === undefined) delete process.env.OC_MIRROR_BIN; else process.env.OC_MIRROR_BIN = originalBin;
  fs.rmSync(stubDir, { recursive: true, force: true });
});
beforeEach(async () => {
  delete process.env.STUB_NO_SIGNATURES;
  await resetMirroringForTests();
  await resetUpgradeForTests();
});

const stagedPlan = async (patch = {}) => {
  const p = (await api("POST", "/api/upgrade/plans", { name: "ins" })).json;
  await api("POST", `/api/upgrade/plans/${p.id}`, { arch: "amd64", graphSource: "imported", current: "4.20.14", target: "4.22.22", ...patch });
  assert.equal((await api("POST", `/api/upgrade/plans/${p.id}/solve`, {})).status, 200);
  return (await api("POST", `/api/upgrade/plans/${p.id}/stages`, {})).json.plan;
};

describe("instructions", () => {
  test("three methods, OSUS recommended; no forbidden flag anywhere; CLI uses the graph digest; per-minor channel changes", async () => {
    const plan = await stagedPlan();
    const r = await api("GET", `/api/upgrade/plans/${plan.id}/instructions?registry=mirror.example.com:8443/ocp`);
    assert.equal(r.status, 200, JSON.stringify(r.json));
    const ins = r.json;
    assert.deepEqual(Object.keys(ins.methods).sort(), ["cli", "osus", "web"]);
    assert.equal(ins.methods.osus.recommended, true);
    for (const f of FORBIDDEN) assert.equal(allCommands(ins).includes(f), false, `never ${f}`);
    const cliStarts = ins.methods.cli.hops.flatMap((h) => h.steps.flatMap((s) => s.commands || [])).filter((c) => c.label === "Start the update").map((c) => c.text);
    assert.equal(cliStarts.length, 3);
    for (const c of cliStarts) assert.match(c, /^oc adm upgrade --allow-explicit-upgrade --to-image mirror\.example\.com:8443\/ocp\/openshift\/release-images@sha256:[a-f0-9]{64}$/);
    const osusStarts = ins.methods.osus.hops.flatMap((h) => h.steps.flatMap((s) => s.commands || [])).filter((c) => c.label === "Start the update").map((c) => c.text);
    assert.deepEqual(osusStarts, ["oc adm upgrade --to=4.20.44", "oc adm upgrade --to=4.21.40", "oc adm upgrade --to=4.22.22"]);
    const channelCmds = ins.methods.osus.hops.flatMap((h) => h.steps.flatMap((s) => s.commands || [])).filter((c) => c.label === "Set the channel").map((c) => c.text);
    assert.deepEqual(channelCmds, ["oc adm upgrade channel stable-4.20", "oc adm upgrade channel stable-4.21", "oc adm upgrade channel stable-4.22"]);
    assert.match(ins.tieBreakNote, /not a safety ranking/);
    assert.equal(ins.status.state === "ready-to-proceed", false, "without evidence the procedure is conditional");
  });

  test("every documentation link is docs.redhat.com for the minor the step updates INTO; never 5.0", async () => {
    const plan = await stagedPlan();
    const ins = (await api("GET", `/api/upgrade/plans/${plan.id}/instructions`)).json;
    const text = JSON.stringify(ins);
    assert.equal(text.includes("/5.0/"), false);
    for (const hop of ins.methods.osus.hops) {
      const minor = hop.to.split(".").slice(0, 2).join(".");
      for (const d of hop.docs) assert.ok(d.url.startsWith(`https://docs.redhat.com/en/documentation/openshift_container_platform/${minor}/html/`), d.url);
    }
    const urls = [...text.matchAll(/https:\/\/[^"]+/g)].map((m) => m[0]);
    for (const u of urls) assert.match(u, /^https:\/\/docs\.redhat\.com\/en\/documentation\/openshift_container_platform\/4\.2[012]\/html\//);
  });

  test("a conditional hop gets no executable update command, only risk review and the read-only evaluation", async () => {
    const p = (await api("POST", "/api/upgrade/plans", { name: "cond" })).json;
    const g = (await api("GET", "/api/upgrade/graph?channel=stable-4.22&arch=amd64&source=imported")).json.normalized;
    const c = g.conditional.find((x) => x.from === "4.20.14" && x.to.startsWith("4.21."));
    await api("POST", `/api/upgrade/plans/${p.id}`, { arch: "amd64", graphSource: "imported", current: c.from, target: c.to, conditionalReview: { enabled: true, acknowledgedRisks: c.risks.map((r) => r.name) } });
    const solved = await api("POST", `/api/upgrade/plans/${p.id}/solve`, { route: [c.from, c.to] });
    assert.equal(solved.status, 200, JSON.stringify(solved.json));
    const ins = (await api("GET", `/api/upgrade/plans/${p.id}/instructions`)).json;
    for (const m of ["osus", "cli", "web"]) {
      const hop = ins.methods[m].hops[0];
      assert.equal(hop.conditional, true);
      const cmds = hop.steps.flatMap((s) => s.commands || []).map((x) => x.text);
      assert.equal(cmds.some((t) => /oc adm upgrade --to|--to-image/.test(t)), false, m);
      assert.ok(cmds.includes(`oc adm upgrade recommend --version ${c.to}`));
      assert.ok(hop.steps.find((s) => s.kind === "risk").risks.length > 0);
    }
    const readiness = (await api("GET", `/api/upgrade/plans/${p.id}/readiness`)).json;
    const risk = readiness.checks.find((x) => x.id.startsWith("risk-"));
    assert.ok(risk.layers.graph && risk.layers.clusterEvidence && risk.layers.administratorJudgment);
    assert.match(risk.layers.administratorJudgment, /not proof/);
  });

  test("Control Plane Only steps are withheld until their prerequisites are verified or attested", async () => {
    const plan = await stagedPlan({ channelPolicy: "eus", strategy: "cpo" });
    let ins = (await api("GET", `/api/upgrade/plans/${plan.id}/instructions`)).json;
    assert.equal(ins.methods.osus.cpo.state, "withheld");
    assert.deepEqual(ins.methods.osus.before, []);
    assert.equal(allCommands(ins).includes("\"paused\":true"), false);
    const mcp = { kind: "List", items: [
      { kind: "MachineConfigPool", metadata: { name: "master" }, spec: { paused: false }, status: { conditions: [{ type: "Updated", status: "True" }, { type: "Degraded", status: "False" }] } },
      { kind: "MachineConfigPool", metadata: { name: "worker" }, spec: { paused: false }, status: { conditions: [{ type: "Updated", status: "True" }, { type: "Degraded", status: "False" }] } }
    ] };
    assert.equal((await api("POST", `/api/upgrade/plans/${plan.id}/inventory`, { kind: "mcp", text: JSON.stringify(mcp) })).status, 200);
    for (const id of ["cpo-pause-window", "eus-entitlement", "operator-compat"]) assert.equal((await api("POST", `/api/upgrade/plans/${plan.id}/attest`, { checkId: id, attested: true })).status, 200);
    ins = (await api("GET", `/api/upgrade/plans/${plan.id}/instructions`)).json;
    assert.equal(ins.methods.osus.cpo.state, "included");
    assert.match(allCommands(ins), /\\"paused\\":true/);
  });

  test("single-node/compact topology blocks Control Plane Only", async () => {
    const plan = await stagedPlan({ channelPolicy: "eus", strategy: "cpo" });
    const mcp = { kind: "List", items: [{ kind: "MachineConfigPool", metadata: { name: "master" }, spec: {}, status: { conditions: [{ type: "Updated", status: "True" }] } }] };
    await api("POST", `/api/upgrade/plans/${plan.id}/inventory`, { kind: "mcp", text: JSON.stringify(mcp) });
    const r = (await api("GET", `/api/upgrade/plans/${plan.id}/readiness`)).json;
    assert.equal(r.checks.find((c) => c.id === "cpo-topology").state, "BLOCKED");
    assert.equal(r.cpo.eligible, false);
  });
});

describe("readiness and inventory", () => {
  test("without cluster evidence nothing about the cluster is verified", async () => {
    const plan = await stagedPlan();
    const r = (await api("GET", `/api/upgrade/plans/${plan.id}/readiness`)).json;
    assert.equal(r.summary.clusterReadiness, "not verified (no cluster evidence)");
    for (const id of ["cvo-health", "cvo-upgradeable", "mcp-health", "etcd-backup"]) assert.equal(r.checks.find((c) => c.id === id).state, "NOT_CHECKED", id);
    assert.equal(r.checks.find((c) => c.id === "route").state, "VERIFIED");
    assert.equal(r.checks.find((c) => c.id === "graph-freshness").state, "WARNING", "a snapshot is 'as of', not current");
    assert.ok(r.checks.filter((c) => c.id.startsWith("content-")).every((c) => c.state === "BLOCKED"), "nothing is in the registry yet");
  });

  test("ClusterVersion import: projected, cluster ID dropped; Upgradeable=False blocks a minor route; version mismatch blocks", async () => {
    const plan = await stagedPlan();
    const cv = { apiVersion: "config.openshift.io/v1", kind: "ClusterVersion", metadata: { name: "version", annotations: { secret: "do-not-keep" } },
      spec: { clusterID: "11111111-2222-3333-4444-555555555555", channel: "stable-4.20", upstream: "https://user:pass@osus.example/graph" },
      status: { desired: { version: "4.20.10" }, history: [{ state: "Completed", version: "4.20.10" }], conditions: [{ type: "Available", status: "True" }, { type: "Failing", status: "False" }, { type: "Upgradeable", status: "False", reason: "AdminAckRequired", message: "ack needed" }] } };
    const r = await api("POST", `/api/upgrade/plans/${plan.id}/inventory`, { kind: "clusterversion", text: JSON.stringify(cv) });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    const stored = JSON.stringify(getState().upgrade);
    for (const leak of ["11111111-2222", "user:pass", "do-not-keep"]) assert.equal(stored.includes(leak), false, `${leak} is not stored`);
    assert.equal(r.json.inventory.clusterVersion.upstreamConfigured, true);
    const ready = (await api("GET", `/api/upgrade/plans/${plan.id}/readiness`)).json;
    assert.equal(ready.checks.find((c) => c.id === "cvo-upgradeable").state, "BLOCKED");
    assert.equal(ready.checks.find((c) => c.id === "current-version").state, "BLOCKED");
    assert.equal(ready.checks.find((c) => c.id === "cvo-health").state, "VERIFIED");
  });

  test("kubeconfigs and Secrets are refused; attestation is only for checks Architect cannot observe", async () => {
    const plan = await stagedPlan();
    const kc = { apiVersion: "v1", kind: "Config", clusters: [], users: [{ name: "x", user: { token: "t" } }], contexts: [] };
    assert.equal((await api("POST", `/api/upgrade/plans/${plan.id}/inventory`, { kind: "clusterversion", text: JSON.stringify(kc) })).json.code, "INVENTORY_KUBECONFIG_REFUSED");
    const sec = { kind: "List", items: [{ kind: "Secret", data: { a: "b" } }] };
    assert.equal((await api("POST", `/api/upgrade/plans/${plan.id}/inventory`, { kind: "csv", text: JSON.stringify(sec) })).json.code, "INVENTORY_SECRET_REFUSED");
    assert.equal((await api("POST", `/api/upgrade/plans/${plan.id}/attest`, { checkId: "cvo-health", attested: true })).json.code, "NOT_ATTESTABLE");
    const att = await api("POST", `/api/upgrade/plans/${plan.id}/attest`, { checkId: "etcd-backup", attested: true, note: "backup 2026-11-06" });
    assert.equal(att.json.checks.find((c) => c.id === "etcd-backup").state, "ATTESTED");
  });
});

describe("artifacts and run evidence", () => {
  test("stage ISCs are VALIDATED with one pinned release; templates are labelled; nothing is PRODUCED_BY_RUN before a run", async () => {
    const plan = await stagedPlan();
    const a = (await api("GET", `/api/upgrade/plans/${plan.id}/artifacts`)).json;
    const iscs = a.files.filter((f) => f.label === "VALIDATED");
    assert.equal(iscs.length, 3);
    for (const f of iscs) assert.equal(yaml.load(f.content).mirror.platform.channels.length, 1);
    assert.ok(a.files.some((f) => f.name === "updateservice.yaml" && f.label === "TEMPLATE"));
    assert.ok(a.files.some((f) => f.name === "osus-operator.yaml" && /installPlanApproval: Manual/.test(f.content)));
    assert.equal(a.files.some((f) => f.label === "PRODUCED_BY_RUN"), false, "no fabricated oc-mirror output");
  });

  test("after a stage's mirror-to-mirror run, its cluster resources are PRODUCED_BY_RUN and its signatures are evidence", async () => {
    const plan = await stagedPlan();
    const s1 = plan.stages[0];
    const run = await api("POST", `/api/mirroring/profiles/${s1.profileId}/run`, { mode: "mirrorToMirror", registryUrl: "mirror.example.invalid:8443/ocp", rhPullSecret: SECRET, mirrorAuthSource: "inline", mirrorPullSecret: DEST });
    assert.equal(run.status, 200, JSON.stringify(run.json));
    assert.equal((await settle(run.json.jobId)).status, "completed");
    const a = (await api("GET", `/api/upgrade/plans/${plan.id}/artifacts`)).json;
    const produced = a.files.filter((f) => f.label === "PRODUCED_BY_RUN").map((f) => f.name).sort();
    assert.deepEqual(produced, ["stage-1-idms-oc-mirror.yaml", "stage-1-signature-configmap.json"]);
    const ready = (await api("GET", `/api/upgrade/plans/${plan.id}/readiness`)).json;
    assert.equal(ready.checks.find((c) => c.id === "signatures-s1").state, "VERIFIED");
    assert.equal(ready.checks.find((c) => c.id === "content-s1").state, "WARNING", "in the registry but not confirmed by a destination check");
    const ins = (await api("GET", `/api/upgrade/plans/${plan.id}/instructions`)).json;
    assert.match(allCommands(ins), /working-dir\/cluster-resources\//);
  });

  test("a run that produced no signature ConfigMap is a blocker, not a silent pass", async () => {
    process.env.STUB_NO_SIGNATURES = "1";
    const plan = await stagedPlan();
    const s1 = plan.stages[0];
    const run = await api("POST", `/api/mirroring/profiles/${s1.profileId}/run`, { mode: "mirrorToMirror", registryUrl: "mirror.example.invalid:8443/ocp", rhPullSecret: SECRET, mirrorAuthSource: "inline", mirrorPullSecret: DEST });
    await settle(run.json.jobId);
    const ready = (await api("GET", `/api/upgrade/plans/${plan.id}/readiness`)).json;
    assert.equal(ready.checks.find((c) => c.id === "signatures-s1").state, "BLOCKED");
  });
});
