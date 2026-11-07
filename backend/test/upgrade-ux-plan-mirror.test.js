/**
 * v2.3.0 UX correction (U2) — one registry for the plan, validated so it can never carry a
 * credential (owner refinement 5), and protection for mirror-to-mirror catalog tags
 * (owner refinement 4: oc-mirror v2 replaces a catalog tag's content — verified on the exact
 * binary — so an existing tag is never replaced without an explicit, per-tag acknowledgement,
 * or the plan writes catalogs under its own tag).
 *
 * Developed with AI assistance from Claude (Anthropic).
 */
import { test, describe, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { app } from "../src/index.js";
import { db } from "../src/db.js";
import { normalizeRegistryReference } from "../../shared/registryReference.js";
import { createTestServer, closeTestServer } from "./helpers/httpServerLifecycle.js";
import { resetMirroringForTests, resetUpgradeForTests } from "./helpers/resetWorkflowsForTests.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixtureText = (name) => JSON.stringify(JSON.parse(fs.readFileSync(path.join(here, "fixtures", "upgrade-graph", `${name}.json`), "utf8")).body);
const CANARY = "reg-canary-77ab";
const RH = JSON.stringify({ auths: { "registry.redhat.io": { auth: Buffer.from(`u:${CANARY}rh`).toString("base64") } } });
const DEST = JSON.stringify({ auths: { "mirror.example.invalid:8443": { auth: Buffer.from(`u:${CANARY}dest`).toString("base64") } } });

let server;
let baseUrl;
let stubDir;
const originalBin = process.env.OC_MIRROR_BIN;
const api = async (method, url, body) => {
  const res = await fetch(`${baseUrl}${url}`, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { json = null; }
  return { status: res.status, json, text };
};

before(async () => {
  stubDir = fs.mkdtempSync(path.join(os.tmpdir(), "oaa-ux-mirror-stub-"));
  const p = path.join(stubDir, "oc-mirror");
  fs.writeFileSync(p, `#!${process.execPath}\nconst a = process.argv.slice(2);\nif (a.includes("version")) console.log(JSON.stringify({ clientVersion: { gitVersion: "4.22.0-stub-ux", gitCommit: "0" } }));\n`);
  fs.chmodSync(p, 0o755);
  process.env.OC_MIRROR_BIN = p;
  ({ server, baseUrl } = await createTestServer(app));
  for (const ch of ["stable-4.22", "stable-4.21", "stable-4.20"]) {
    assert.equal((await api("POST", "/api/upgrade/graph/import", { channel: ch, arch: "amd64", origin: "snapshot", text: fixtureText(`${ch}-amd64`) })).status, 200);
  }
});
after(async () => {
  await resetMirroringForTests();
  await resetUpgradeForTests();
  await closeTestServer(server);
  if (originalBin === undefined) delete process.env.OC_MIRROR_BIN; else process.env.OC_MIRROR_BIN = originalBin;
  fs.rmSync(stubDir, { recursive: true, force: true });
});
beforeEach(async () => {
  await resetMirroringForTests();
  await resetUpgradeForTests();
});

const stagedPlan = async () => {
  const p = (await api("POST", "/api/upgrade/plans", { name: "ux" })).json;
  await api("POST", `/api/upgrade/plans/${p.id}`, { arch: "amd64", graphSource: "imported", current: "4.20.14", target: "4.22.22" });
  assert.equal((await api("POST", `/api/upgrade/plans/${p.id}/solve`, {})).status, 200);
  const staged = await api("POST", `/api/upgrade/plans/${p.id}/stages`, {});
  assert.equal(staged.status, 200, JSON.stringify(staged.json));
  return staged.json.plan;
};
const stageProfiles = async (plan) => {
  const m = (await api("GET", "/api/mirroring")).json;
  return plan.stages.map((s) => m.profiles.find((p) => p.id === s.profileId));
};
const addOperatorToEveryStage = async (plan) => {
  const saved = await api("POST", `/api/upgrade/plans/${plan.id}/operator-intent`, { entries: [{ name: "kiali-ossm", catalogKind: "redhat", channel: "stable", category: "requested", confidence: "user-entered", sources: [] }] });
  assert.equal(saved.status, 200, saved.text);
  const applied = await api("POST", `/api/upgrade/plans/${plan.id}/operator-intent/apply-to-stages`, { keys: ["redhat|kiali-ossm"] });
  assert.equal(applied.status, 200, applied.text);
};

describe("registry reference validation (shared)", () => {
  test("accepts host[:port]/path and normalizes it", () => {
    assert.equal(normalizeRegistryReference("docker://Mirror.Example.com:8443/ocp/").value, "mirror.example.com:8443/ocp");
    assert.equal(normalizeRegistryReference("10.0.0.5:5000").value, "10.0.0.5:5000");
    assert.equal(normalizeRegistryReference("registry.local/a/b-c_d.e").value, "registry.local/a/b-c_d.e");
  });
  test("refuses anything that could carry a credential or is not a registry reference", () => {
    for (const bad of [
      `user:${CANARY}@mirror.example.com/ocp`, `https://mirror.example.com/ocp`, `https://u:p@mirror.example.com`,
      `mirror.example.com/ocp?token=${CANARY}`, `mirror.example.com/ocp#x`, "mirror.example.com/OCP", "mirror example.com",
      `mirror.example.com/${"a1".repeat(24)}`, `mirror.example.com/${"deadbeef".repeat(5)}`, "mirror.example.com:99999/x", "", "   "
    ]) {
      const r = normalizeRegistryReference(bad);
      assert.equal(r.ok, false, bad);
      assert.equal(String(r.reason).includes(CANARY), false, "the value is never echoed");
    }
  });
});

describe("plan mirror registry: entered once, validated, reused", () => {
  test("a credential-bearing value is refused without echo and nothing is stored", async () => {
    const plan = await stagedPlan();
    for (const bad of [`u:${CANARY}@mirror.example.com/ocp`, `https://mirror.example.com/ocp?access_token=${CANARY}`]) {
      const r = await api("POST", `/api/upgrade/plans/${plan.id}/mirror`, { registryUrl: bad });
      assert.equal(r.status, 400);
      assert.equal(r.json.code, "REGISTRY_REFERENCE_INVALID");
      assert.equal(r.text.includes(CANARY), false);
    }
    const dump = JSON.stringify(db.prepare("SELECT * FROM app_state").all());
    assert.equal(dump.includes(CANARY), false);
    assert.equal((await api("GET", "/api/upgrade")).json.plans[0].mirror.registryUrl, null);
  });

  test("a valid value is normalized, reaches every stage that follows the plan, and keeps a stage's own registry", async () => {
    const plan = await stagedPlan();
    const set = await api("POST", `/api/upgrade/plans/${plan.id}/mirror`, { registryUrl: "docker://Mirror.Example.invalid:8443/ocp/", method: "mirrorToMirror" });
    assert.equal(set.status, 200, set.text);
    assert.equal(set.json.plan.mirror.registryUrl, "mirror.example.invalid:8443/ocp");
    assert.equal(set.json.plan.mirror.method, "mirrorToMirror");
    let profiles = await stageProfiles(plan);
    assert.ok(profiles.every((p) => p.execution.registryUrl === "mirror.example.invalid:8443/ocp"));
    // Stage 2 deliberately gets its own registry; a later plan change leaves it alone.
    assert.equal((await api("POST", `/api/mirroring/profiles/${profiles[1].id}`, { execution: { registryUrl: "other.example.invalid/stage2" } })).status, 200);
    assert.equal((await api("POST", `/api/upgrade/plans/${plan.id}/mirror`, { registryUrl: "mirror2.example.invalid/ocp" })).status, 200);
    profiles = await stageProfiles(plan);
    assert.deepEqual(profiles.map((p) => p.execution.registryUrl), ["mirror2.example.invalid/ocp", "other.example.invalid/stage2", "mirror2.example.invalid/ocp"]);
  });

  test("instructions use the plan registry without asking again; an explicit credential-bearing override is refused", async () => {
    const plan = await stagedPlan();
    await api("POST", `/api/upgrade/plans/${plan.id}/mirror`, { registryUrl: "mirror.example.invalid:8443/ocp" });
    const ins = await api("GET", `/api/upgrade/plans/${plan.id}/instructions`);
    assert.equal(ins.status, 200, ins.text);
    assert.ok(ins.text.includes("mirror.example.invalid:8443/ocp"));
    const bad = await api("GET", `/api/upgrade/plans/${plan.id}/instructions?registry=${encodeURIComponent(`u:${CANARY}@x.example/ocp`)}`);
    assert.equal(bad.status, 400);
    assert.equal(bad.text.includes(CANARY), false);
  });

  test("Mirroring destinations and run requests refuse credential-bearing registry references too", async () => {
    const plan = await stagedPlan();
    const [p1] = await stageProfiles(plan);
    const r = await api("POST", `/api/mirroring/profiles/${p1.id}`, { execution: { registryUrl: `u:${CANARY}@mirror.example.invalid/ocp` } });
    assert.equal(r.status, 400);
    assert.equal(r.text.includes(CANARY), false);
    const run = await api("POST", `/api/mirroring/profiles/${p1.id}/run`, { mode: "mirrorToMirror", registryUrl: `https://u:${CANARY}@mirror.example.invalid/ocp`, rhPullSecret: RH });
    assert.equal(run.status, 400);
    assert.equal(run.text.includes(CANARY), false);
  });
});

describe("mirror to mirror: catalog tags are never replaced silently", () => {
  test("the preview lists what each stage writes, with the catalog's destination tag", async () => {
    const plan = await stagedPlan();
    await addOperatorToEveryStage(plan);
    await api("POST", `/api/upgrade/plans/${plan.id}/mirror`, { registryUrl: "mirror.example.invalid:8443/ocp" });
    const pv = await api("POST", `/api/upgrade/plans/${plan.id}/sequence/preview`, { mode: "mirrorToMirror" });
    assert.equal(pv.status, 200, pv.text);
    const w = pv.json.stages.map((s) => s.writes);
    assert.deepEqual(w.map((x) => x.catalogs.map((c) => c.destination)), [
      ["mirror.example.invalid:8443/ocp/redhat/redhat-operator-index:v4.20"],
      ["mirror.example.invalid:8443/ocp/redhat/redhat-operator-index:v4.21"],
      ["mirror.example.invalid:8443/ocp/redhat/redhat-operator-index:v4.22"]
    ]);
    assert.ok(w[0].releases[0].startsWith("mirror.example.invalid:8443/ocp/openshift/release-images:4.20.44"));
  });

  test("starting needs every existing-or-unchecked catalog tag acknowledged by name; the check is repeated at start", async () => {
    const plan = await stagedPlan();
    await addOperatorToEveryStage(plan);
    await api("POST", `/api/upgrade/plans/${plan.id}/mirror`, { registryUrl: "mirror.example.invalid:8443/ocp" });
    const body = { mode: "mirrorToMirror" };
    const pv = (await api("POST", `/api/upgrade/plans/${plan.id}/sequence/preview`, body)).json;
    const check = await api("POST", `/api/upgrade/plans/${plan.id}/sequence/destination-check`, { ...body, mirrorPullSecret: DEST });
    assert.equal(check.status, 200, check.text);
    assert.equal(check.json.catalogs.length, 3);
    // The destination cannot be reached here: "could not check" must be acknowledged like "exists".
    assert.ok(check.json.catalogs.every((c) => c.exists === "unknown"));
    const refused = await api("POST", `/api/upgrade/plans/${plan.id}/sequence`, { ...body, rhPullSecret: RH, mirrorPullSecret: DEST, previewToken: pv.token });
    assert.equal(refused.status, 409);
    assert.equal(refused.json.code, "CATALOG_OVERWRITE_NOT_ACKNOWLEDGED");
    const partial = await api("POST", `/api/upgrade/plans/${plan.id}/sequence`, { ...body, rhPullSecret: RH, mirrorPullSecret: DEST, previewToken: pv.token, acknowledgedOverwrites: [check.json.catalogs[0].destination] });
    assert.equal(partial.status, 409, "every tag, not just one");
    const ok = await api("POST", `/api/upgrade/plans/${plan.id}/sequence`, { ...body, rhPullSecret: RH, mirrorPullSecret: DEST, previewToken: pv.token, acknowledgedOverwrites: check.json.catalogs.map((c) => c.destination) });
    assert.equal(ok.status, 202, ok.text);
    const dump = JSON.stringify(db.prepare("SELECT * FROM jobs").all()) + JSON.stringify(db.prepare("SELECT * FROM app_state").all());
    assert.equal(dump.includes(CANARY), false, "no credential stored");
    for (let i = 0; i < 400; i++) {
      const j = (await api("GET", `/api/jobs/${ok.json.jobId}`)).json;
      if (!["queued", "running"].includes(j.status)) break;
      await new Promise((r) => setTimeout(r, 25));
    }
  });

  test("a plan-specific catalog tag goes into each stage's configuration and the listed destination", async () => {
    const plan = await stagedPlan();
    await addOperatorToEveryStage(plan);
    const set = await api("POST", `/api/upgrade/plans/${plan.id}/mirror`, { registryUrl: "mirror.example.invalid:8443/ocp", catalogTag: "plan" });
    assert.equal(set.status, 200, set.text);
    const profiles = await stageProfiles(plan);
    const tag = profiles[0].operators.catalogTargetTag;
    assert.match(tag, /^v4\.20-oaa-[a-z0-9]+$/);
    const pv = await api("POST", `/api/mirroring/profiles/${profiles[0].id}/preview`, {});
    assert.equal(pv.status, 200, pv.text);
    assert.match(pv.json.imagesetConfig, new RegExp(`targetTag: ${tag.replace(/\./g, "\\.")}`));
    const seq = (await api("POST", `/api/upgrade/plans/${plan.id}/sequence/preview`, { mode: "mirrorToMirror" })).json;
    assert.equal(seq.stages[0].writes.catalogs[0].destination, `mirror.example.invalid:8443/ocp/redhat/redhat-operator-index:${tag}`);
    assert.equal(seq.stages[0].writes.catalogs[0].planSpecific, true);
    // Back to source tags: the targetTag is removed again.
    await api("POST", `/api/upgrade/plans/${plan.id}/mirror`, { catalogTag: "source" });
    assert.equal((await stageProfiles(plan))[0].operators.catalogTargetTag, null);
  });
});

describe("copying a stage's operators to later stages", () => {
  test("each later stage gets the packages from its own minor's catalog; existing selections and the source are untouched", async () => {
    const plan = await stagedPlan();
    const [p1, p2] = await stageProfiles(plan);
    // Stage 1 selects two operators; stage 2 already has one of them with its own channel.
    assert.equal((await api("POST", `/api/mirroring/profiles/${p1.id}`, { content: { platform: true, operators: true, additionalImages: false }, operators: { selected: [
      { id: "registry.redhat.io/redhat/redhat-operator-index:v4.20::kiali-ossm", name: "kiali-ossm", catalog: "redhat", catalogImage: "registry.redhat.io/redhat/redhat-operator-index:v4.20", defaultChannel: "stable" },
      { id: "registry.redhat.io/redhat/redhat-operator-index:v4.20::web-terminal", name: "web-terminal", catalog: "redhat", catalogImage: "registry.redhat.io/redhat/redhat-operator-index:v4.20", defaultChannel: "fast" }
    ] } })).status, 200);
    assert.equal((await api("POST", `/api/mirroring/profiles/${p2.id}`, { content: { platform: true, operators: true, additionalImages: false }, operators: { selected: [
      { id: "registry.redhat.io/redhat/redhat-operator-index:v4.21::web-terminal", name: "web-terminal", catalog: "redhat", catalogImage: "registry.redhat.io/redhat/redhat-operator-index:v4.21", defaultChannel: "candidate" }
    ] } })).status, 200);
    const r = await api("POST", `/api/upgrade/plans/${plan.id}/stages/s1/copy-operators`, {});
    assert.equal(r.status, 200, r.text);
    assert.deepEqual(r.json.report.map((x) => [x.stageId, x.added, x.kept]), [["s2", ["kiali-ossm"], ["web-terminal"]], ["s3", ["kiali-ossm", "web-terminal"], []]]);
    const [a, b, c] = await stageProfiles(plan);
    assert.deepEqual(a.operators.selected.map((o) => o.catalogImage), ["registry.redhat.io/redhat/redhat-operator-index:v4.20", "registry.redhat.io/redhat/redhat-operator-index:v4.20"], "source unchanged");
    assert.equal(b.operators.selected.find((o) => o.name === "web-terminal").defaultChannel, "candidate", "an existing selection is never changed");
    assert.ok(b.operators.selected.every((o) => o.catalogImage.endsWith(":v4.21")));
    assert.ok(c.operators.selected.every((o) => o.catalogImage.endsWith(":v4.22")));
  });

  test("the copy reports what each target catalog's scan says about the copied channel, and never changes it", async () => {
    const plan = await stagedPlan();
    const [p1] = await stageProfiles(plan);
    assert.equal((await api("POST", `/api/mirroring/profiles/${p1.id}`, { content: { platform: true, operators: true, additionalImages: false }, operators: { selected: [
      { id: "registry.redhat.io/redhat/redhat-operator-index:v4.20::kiali-ossm", name: "kiali-ossm", catalog: "redhat", catalogImage: "registry.redhat.io/redhat/redhat-operator-index:v4.20", defaultChannel: "stable" },
      { id: "registry.redhat.io/redhat/redhat-operator-index:v4.20::odf-operator", name: "odf-operator", catalog: "redhat", catalogImage: "registry.redhat.io/redhat/redhat-operator-index:v4.20", defaultChannel: "stable-4.20" }
    ] } })).status, 200);
    // Synthetic scan evidence: 4.21 lists both (odf's default is stable-4.21); 4.22 is not scanned.
    const seed = db.prepare("INSERT INTO operator_results (version, catalog, results_json, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(version, catalog) DO UPDATE SET results_json = excluded.results_json, updated_at = excluded.updated_at");
    db.prepare("DELETE FROM operator_results WHERE version IN ('4.21', '4.22')").run();
    seed.run("4.21", "redhat", JSON.stringify([{ name: "kiali-ossm", defaultChannel: "stable" }, { name: "odf-operator", defaultChannel: "stable-4.21" }]), Date.now());
    try {
      const r = await api("POST", `/api/upgrade/plans/${plan.id}/stages/s1/copy-operators`, {});
      assert.equal(r.status, 200, r.text);
      const by = Object.fromEntries(r.json.report.map((x) => [x.stageId, Object.fromEntries(x.checks.map((c) => [c.name, c]))]));
      assert.equal(by.s2["kiali-ossm"].status, "default-channel");
      assert.equal(by.s2["odf-operator"].status, "channel-not-checked", "a different default is not evidence the copied channel exists, nor that it does not");
      assert.equal(by.s3["kiali-ossm"].status, "not-scanned");
      const [, b] = await stageProfiles(plan);
      assert.equal(b.operators.selected.find((o) => o.name === "odf-operator").defaultChannel, "stable-4.20", "the copied channel is never silently replaced");
    } finally {
      db.prepare("DELETE FROM operator_results WHERE version IN ('4.21', '4.22')").run();
    }
  });
});

describe("readiness: every check says what to do next", () => {
  test("missing evidence names the import; stages not yet mirrored are a to-do, not a block", async () => {
    const plan = await stagedPlan();
    const r = (await api("GET", `/api/upgrade/plans/${plan.id}/readiness`)).json;
    const by = Object.fromEntries(r.checks.map((c) => [c.id, c]));
    assert.deepEqual(by["mcp-health"].action, { kind: "import", inventoryKind: "mcp" });
    assert.deepEqual(by["cvo-health"].action, { kind: "import", inventoryKind: "clusterversion" });
    assert.equal(by["content-s1"].state, "PENDING");
    assert.deepEqual(by["content-s1"].action, { kind: "step", step: "mirror" });
    assert.equal(by["content-s1"].group, "content");
    assert.equal(by["etcd-backup"].group, "cluster");
    assert.equal(r.summary.pending, 3);
    assert.equal(r.summary.blocked, 0, "nothing here is evidence of a problem");
  });
});

describe("YAML preview parity with the Handoff package (owner QA, 2026-11-07)", () => {
  test("each stage's live preview is byte-for-byte the configuration in the artifacts list and the package", async () => {
    const plan = await stagedPlan();
    await addOperatorToEveryStage(plan);
    await api("POST", `/api/upgrade/plans/${plan.id}/mirror`, { catalogTag: "plan" });
    const check = async (label) => {
      const profiles = await stageProfiles(plan);
      const artifacts = (await api("GET", `/api/upgrade/plans/${plan.id}/artifacts`)).json.files;
      const pkg = (await api("GET", `/api/upgrade/plans/${plan.id}/package.json`)).json;
      for (const [i, st] of plan.stages.entries()) {
        const pv = await api("POST", `/api/mirroring/profiles/${profiles[i].id}/preview`, {});
        assert.equal(pv.status, 200, pv.text);
        const art = artifacts.find((f) => f.stageId === st.id);
        assert.equal(art.label, "VALIDATED");
        assert.equal(pv.json.imagesetConfig, art.content, `${label}: stage ${st.id} preview = artifact`);
        assert.equal(pv.json.imagesetConfig, pkg.content.stages[i].imagesetConfig, `${label}: stage ${st.id} preview = package`);
        assert.equal(pv.text.includes(CANARY), false);
      }
      return profiles;
    };
    const profiles = await check("initial");
    // A change to one stage's operators changes that stage's preview, and parity still holds.
    const before = (await api("POST", `/api/mirroring/profiles/${profiles[1].id}/preview`, {})).json.imagesetConfig;
    const sel = [...profiles[1].operators.selected, { id: "registry.redhat.io/redhat/redhat-operator-index:v4.21::web-terminal", name: "web-terminal", catalog: "redhat", catalogImage: "registry.redhat.io/redhat/redhat-operator-index:v4.21", defaultChannel: "fast" }];
    assert.equal((await api("POST", `/api/mirroring/profiles/${profiles[1].id}`, { operators: { selected: sel } })).status, 200);
    const after = (await api("POST", `/api/mirroring/profiles/${profiles[1].id}/preview`, {})).json.imagesetConfig;
    assert.notEqual(after, before);
    assert.match(after, /web-terminal/);
    await check("after an operator change");
  });
});
