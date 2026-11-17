/**
 * v2.3.0 correction pass — earlier ImageSetConfigurations as optional,
 * editable presets for an Upgrade plan.
 *
 *  - several files at once, v2 (validated) and v1 (field-by-field); invalid,
 *    oversized and unknown files reported, never applied;
 *  - per-file provenance; duplicates merged; conflicting channels surfaced;
 *    unsupported minors shown but never used;
 *  - presets are labelled unverified; accepting them never replaces an entry
 *    confirmed by the user or a cluster export without explicit consent;
 *  - applying to stages adds packages at each stage's catalog minor and never
 *    changes existing selections; nothing is stored by the analysis.
 *
 * Developed with AI assistance from Claude (Anthropic).
 */
import { test, describe, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { app } from "../src/index.js";
import { getState } from "../src/utils.js";
import { db } from "../src/db.js";
import { createTestServer, closeTestServer } from "./helpers/httpServerLifecycle.js";
import { resetMirroringForTests, resetUpgradeForTests } from "./helpers/resetWorkflowsForTests.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixtureText = (name) => JSON.stringify(JSON.parse(fs.readFileSync(path.join(here, "fixtures", "upgrade-graph", `${name}.json`), "utf8")).body);

const V2_A = `apiVersion: mirror.openshift.io/v2alpha1
kind: ImageSetConfiguration
mirror:
  platform:
    channels:
      - name: stable-4.20
        minVersion: 4.20.14
        maxVersion: 4.20.14
  operators:
    - catalog: registry.redhat.io/redhat/redhat-operator-index:v4.20
      packages:
        - name: kubevirt-hyperconverged
          channels:
            - name: stable
        - name: odf-operator
          channels:
            - name: stable-4.20
  additionalImages:
    - name: registry.example.com/tools/probe:1.0
`;
const V2_B = `apiVersion: mirror.openshift.io/v2alpha1
kind: ImageSetConfiguration
mirror:
  operators:
    - catalog: registry.redhat.io/redhat/redhat-operator-index:v4.20
      packages:
        - name: odf-operator
          channels:
            - name: stable-4.19
        - name: kubevirt-hyperconverged
          channels:
            - name: stable
  additionalImages:
    - name: registry.example.com/tools/probe:1.0
`;
const V1 = `apiVersion: mirror.openshift.io/v1alpha2
kind: ImageSetConfiguration
storageConfig:
  registry:
    imageURL: mirror.example.com/metadata
mirror:
  platform:
    channels:
      - name: eus-4.14
        minVersion: 4.14.9
        shortestPath: true
  operators:
    - catalog: registry.redhat.io/redhat/certified-operator-index:v4.14
      packages:
        - name: some-certified-operator
`;

let server;
let baseUrl;
const api = async (method, url, body) => {
  const res = await fetch(`${baseUrl}${url}`, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  let json = null;
  try { json = await res.json(); } catch { json = null; }
  return { status: res.status, json };
};
before(async () => {
  ({ server, baseUrl } = await createTestServer(app));
  for (const ch of ["stable-4.22", "stable-4.21", "stable-4.20"]) await api("POST", "/api/upgrade/graph/import", { channel: ch, arch: "amd64", origin: "snapshot", text: fixtureText(`${ch}-amd64`) });
});
after(async () => { await resetMirroringForTests(); await resetUpgradeForTests(); await closeTestServer(server); });
beforeEach(async () => { await resetMirroringForTests(); await resetUpgradeForTests(); });

const newPlan = async () => (await api("POST", "/api/upgrade/plans", { name: "presets" })).json;

describe("analysis", () => {
  test("several files: provenance, duplicates merged, channel conflict surfaced, nothing stored", async () => {
    const p = await newPlan();
    const before = JSON.stringify(getState().upgrade);
    const r = await api("POST", `/api/upgrade/plans/${p.id}/presets/analyze`, { files: [{ name: "a.yaml", text: V2_A }, { name: "b.yaml", text: V2_B }] });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.deepEqual(r.json.files.map((f) => f.status), ["valid", "valid"]);
    const cnv = r.json.operators.find((o) => o.name === "kubevirt-hyperconverged");
    assert.equal(cnv.duplicates, 2);
    assert.equal(cnv.suggestedChannel, "stable");
    assert.deepEqual(cnv.sources.map((s) => s.file), ["a.yaml", "b.yaml"]);
    const odf = r.json.operators.find((o) => o.name === "odf-operator");
    assert.deepEqual(odf.channelOptions.sort(), ["stable-4.19", "stable-4.20"]);
    assert.equal(odf.suggestedChannel, null);
    assert.match(odf.conflicts[0], /different channels/);
    assert.equal(r.json.images[0].duplicates, 2);
    assert.equal(r.json.releases[0].channel, "stable-4.20");
    assert.equal(r.json.releases[0].supported, true);
    assert.match(r.json.releases[0].note, /not the cluster's current release/);
    assert.match(r.json.confidence, /unverified/);
    assert.equal(JSON.stringify(getState().upgrade), before, "analysis stores nothing");
  });

  test("oc-mirror v1 is read field by field; its unsupported minors are shown but never used", async () => {
    const p = await newPlan();
    const r = (await api("POST", `/api/upgrade/plans/${p.id}/presets/analyze`, { files: [{ name: "old.yaml", text: V1 }] })).json;
    assert.match(r.files[0].format, /v1alpha2/);
    assert.equal(r.releases[0].supported, false);
    assert.match(r.releases[0].note, /outside the supported minors/);
    const op = r.operators[0];
    assert.equal(op.catalogKind, "certified");
    assert.match(op.conflicts.join(" "), /not supported/);
  });

  test("invalid, unknown and oversized input is reported, never applied", async () => {
    const p = await newPlan();
    const r = (await api("POST", `/api/upgrade/plans/${p.id}/presets/analyze`, { files: [
      { name: "../../etc/passwd", text: "not: [valid" },
      { name: "other.yaml", text: "apiVersion: v1\nkind: ConfigMap\n" },
      { name: "v3.yaml", text: "apiVersion: mirror.openshift.io/v9\nkind: ImageSetConfiguration\nmirror: {}\n" }
    ] })).json;
    assert.deepEqual(r.files.map((f) => f.status), ["invalid", "invalid", "invalid"]);
    assert.equal(r.files[0].fileName, "passwd", "only the base name is kept");
    assert.equal(r.operators.length, 0);
    const big = await api("POST", `/api/upgrade/plans/${p.id}/presets/analyze`, { files: Array.from({ length: 11 }, (_, i) => ({ name: `${i}.yaml`, text: V2_A })) });
    assert.equal(big.status, 400, "more than ten files is refused by the schema");
  });
});

describe("accepting and applying", () => {
  test("presets stay unverified; they never replace a confirmed entry without consent", async () => {
    const p = await newPlan();
    const installed = { name: "odf-operator", catalogKind: "redhat", channel: "stable-4.20", category: "installed", confidence: "cluster-export", sources: [] };
    assert.equal((await api("POST", `/api/upgrade/plans/${p.id}/operator-intent`, { entries: [installed] })).status, 200);
    const preset = { name: "odf-operator", catalogKind: "redhat", channel: "stable-4.19", category: "preset-mirrored", confidence: "imported-preset", sources: [{ file: "b.yaml" }] };
    const cnv = { name: "kubevirt-hyperconverged", catalogKind: "redhat", channel: "stable", category: "requested", confidence: "imported-preset", sources: [{ file: "a.yaml" }] };
    const r = await api("POST", `/api/upgrade/plans/${p.id}/operator-intent`, { entries: [preset, cnv], images: [{ name: "registry.example.com/tools/probe:1.0", sources: [{ file: "a.yaml" }] }] });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.equal(r.json.skipped.length, 1);
    const intent = r.json.plan.operatorIntent;
    assert.equal(intent.find((e) => e.name === "odf-operator").confidence, "cluster-export", "the confirmed entry is kept");
    assert.equal(intent.find((e) => e.name === "kubevirt-hyperconverged").confidence, "imported-preset");
    const forced = await api("POST", `/api/upgrade/plans/${p.id}/operator-intent`, { entries: [preset], replaceConfirmed: true });
    assert.equal(forced.json.plan.operatorIntent.find((e) => e.name === "odf-operator").channel, "stable-4.19", "explicit consent replaces it");
  });

  test("apply to stages: added at each stage's catalog minor; existing selections untouched; images on the last stage", async () => {
    // No cached scans for these minors (another test file may leave some): each stage's channel then
    // stays the entry's own, and nothing is withheld as "not in the scanned catalog".
    db.prepare("DELETE FROM operator_results WHERE version IN ('4.20', '4.21', '4.22')").run();
    const p = await newPlan();
    await api("POST", `/api/upgrade/plans/${p.id}`, { arch: "amd64", graphSource: "imported", current: "4.20.14", target: "4.22.22" });
    await api("POST", `/api/upgrade/plans/${p.id}/solve`, {});
    const stages = (await api("POST", `/api/upgrade/plans/${p.id}/stages`, {})).json.plan.stages;
    // A selection the user already made in stage 2 must survive.
    const s2 = stages[1];
    const existing = { id: `registry.redhat.io/redhat/redhat-operator-index:v${s2.minor}::kubevirt-hyperconverged`, name: "kubevirt-hyperconverged", catalog: "redhat", catalogImage: `registry.redhat.io/redhat/redhat-operator-index:v${s2.minor}`, defaultChannel: "candidate" };
    assert.equal((await api("POST", `/api/mirroring/profiles/${s2.profileId}`, { content: { platform: true, operators: true, additionalImages: false }, operators: { selected: [existing] } })).status, 200);
    await api("POST", `/api/upgrade/plans/${p.id}/operator-intent`, { entries: [{ name: "kubevirt-hyperconverged", catalogKind: "redhat", channel: "stable", category: "installed", confidence: "user-confirmed" }], images: [{ name: "registry.example.com/tools/probe:1.0" }] });
    const r = await api("POST", `/api/upgrade/plans/${p.id}/operator-intent/apply-to-stages`, { keys: ["redhat|kubevirt-hyperconverged"], includeImages: true });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.deepEqual(r.json.report.map((x) => x.added.length), [1, 0, 1]);
    assert.deepEqual(r.json.report[1].kept, ["kubevirt-hyperconverged"]);
    const profiles = (await api("GET", "/api/mirroring")).json.profiles;
    const s1p = profiles.find((x) => x.id === stages[0].profileId);
    assert.equal(s1p.operators.selected[0].catalogImage, `registry.redhat.io/redhat/redhat-operator-index:v${stages[0].minor}`);
    assert.equal(profiles.find((x) => x.id === s2.profileId).operators.selected[0].defaultChannel, "candidate", "the user's own selection is never changed");
    assert.deepEqual(r.json.report[2].imagesAdded, ["registry.example.com/tools/probe:1.0"]);
    assert.deepEqual(r.json.report[0].imagesAdded, []);
  });
});
