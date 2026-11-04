/**
 * v2.2.0 M4 — revised owner decision (M3 acceptance, 2026-10-26): with
 * platform AND operators content, operator catalogs follow the platform
 * release minor. Operators without platform choose a catalog minor explicitly;
 * images-only needs no minor. A stored catalog minor that differs from the
 * platform (an override saved before the revision, or an import) is preserved,
 * never silently rewritten, and blocks generation until the user reconciles it.
 */
import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import yaml from "js-yaml";
import { app } from "../src/index.js";
import { deriveCatalogMinor, normalizeProfile, catalogMinorReconciliation, generationReadiness } from "../src/mirroringState.js";
import { createTestServer, closeTestServer } from "./helpers/httpServerLifecycle.js";

let server;
let baseUrl;
const api = async (method, url, body) => {
  const res = await fetch(`${baseUrl}${url}`, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, json: await res.json().catch(() => null) };
};
const op = (minor, name = "web-terminal") => ({
  id: `redhat:${name}`, name, displayName: name, catalog: "redhat",
  catalogImage: `registry.redhat.io/redhat/redhat-operator-index:v${minor}`, defaultChannel: "fast"
});
const release = (minor, patch) => ({ release: { channel: minor, patchVersion: patch }, architecture: "x86_64" });
const create = async (body) => {
  const r = await api("POST", "/api/mirroring/profiles", body);
  assert.equal(r.status, 201, JSON.stringify(r.json));
  return r.json;
};
const update = (id, body) => api("POST", `/api/mirroring/profiles/${id}`, body);

before(async () => {
  ({ server, baseUrl } = await createTestServer(app));
  await api("POST", "/api/mirroring/start-over", {});
});
after(async () => closeTestServer(server));

describe("platform + operators: catalogs follow the platform minor", () => {
  test("platform 4.22 + operators -> catalog v4.22 automatically, before and after locking", async () => {
    const p = await create({ name: "p422", content: { platform: true, operators: true }, platform: release("4.22", "4.22.18"), operators: { selected: [op("4.22")] } });
    assert.equal(p.operators.catalogMinor, "4.22");
    assert.equal(p.operators.catalogMinorSource, "platform");
    assert.equal(p.catalogReconciliation.conflict, false);
    assert.equal(p.warnings.length, 0, "no mismatch warning in an aligned state");
    const locked = await api("POST", `/api/mirroring/profiles/${p.id}/lock`, {});
    assert.equal(locked.json.operators.catalogMinor, "4.22");
    const r = await api("POST", `/api/mirroring/profiles/${p.id}/preview`, {});
    assert.equal(r.status, 200, JSON.stringify(r.json));
    const doc = yaml.load(r.json.imagesetConfig);
    assert.equal(doc.mirror.platform.channels[0].name, "stable-4.22");
    assert.equal(doc.mirror.operators[0].catalog, "registry.redhat.io/redhat/redhat-operator-index:v4.22");
    const unlocked = await api("POST", `/api/mirroring/profiles/${p.id}/unlock`, {});
    assert.equal(unlocked.json.operators.catalogMinor, "4.22");
  });

  test("switching the platform 4.21 -> 4.22 moves the catalogs and returns old-minor selections to intent", async () => {
    const p = await create({ name: "switch", content: { platform: true, operators: true }, platform: release("4.21", "4.21.9"), operators: { selected: [op("4.21"), op("4.21", "local-storage-operator")] } });
    assert.equal(p.operators.catalogMinor, "4.21");
    assert.ok(p.operators.selected.every((o) => o.catalogImage.endsWith(":v4.21")));
    const r = await update(p.id, { platform: release("4.22", "4.22.18") });
    assert.equal(r.status, 200);
    assert.equal(r.json.operators.catalogMinor, "4.22");
    assert.deepEqual(r.json.operators.selected.map((o) => [o.name, o.catalogImage, o.defaultChannel]), [
      ["web-terminal", null, null], ["local-storage-operator", null, null]
    ], "nothing re-tagged or fabricated: intent until the 4.22 catalogs resolve it");
  });

  test("a write that tries to set another catalog minor is refused; the stored minor is unchanged", async () => {
    const p = await create({ name: "refuse", content: { platform: true, operators: true }, platform: release("4.22", "4.22.18") });
    const r = await update(p.id, { operators: { catalogMinor: "4.20", catalogMinorSource: "user" } });
    assert.equal(r.status, 400);
    assert.equal(r.json.code, "CATALOG_MINOR_FOLLOWS_PLATFORM");
    const after = (await api("GET", "/api/mirroring")).json.profiles.find((x) => x.id === p.id);
    assert.equal(after.operators.catalogMinor, "4.22");
  });

  test("platform selected without a release: no catalog minor is invented", async () => {
    const p = await create({ name: "norelease", content: { platform: true, operators: true } });
    assert.equal(p.operators.catalogMinor, null);
    assert.match(p.readiness.map((x) => x.message).join(" "), /Select the OpenShift platform release first; operator catalogs follow its minor/);
  });
});

describe("preserved conflicts (persisted override or import) need an explicit choice", () => {
  const conflicted = async (name) => {
    // An operators-only profile with an explicit 4.21 choice, then platform
    // 4.22 added: the same stored shape an override saved before the revision has.
    const p = await create({ name, content: { operators: true }, operators: { catalogMinor: "4.21", catalogMinorSource: "user", selected: [op("4.21")] } });
    const r = await update(p.id, { content: { platform: true, operators: true }, platform: release("4.22", "4.22.18") });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    return r.json;
  };

  test("the stored 4.21 catalogs are kept, flagged and block generation", async () => {
    const p = await conflicted("legacy");
    assert.equal(p.operators.catalogMinor, "4.21");
    assert.equal(p.operators.catalogMinorSource, "user");
    assert.equal(p.operators.selected[0].catalogImage, "registry.redhat.io/redhat/redhat-operator-index:v4.21");
    assert.deepEqual(p.catalogReconciliation, { platformMinor: "4.22", catalogMinor: "4.21", source: "user", conflict: true });
    const blocker = p.readiness.find((x) => x.code === "CATALOG_PLATFORM_MINOR_CONFLICT");
    assert.match(blocker.message, /catalogs are for OpenShift 4\.21, but the platform release is 4\.22/);
    assert.doesNotMatch(blocker.message, /\b(in)?compatible\b/, "no compatibility claim either way");
    // An unrelated write (rename) keeps the conflict as it is.
    const renamed = await update(p.id, { name: "legacy renamed" });
    assert.equal(renamed.json.operators.catalogMinor, "4.21");
    assert.equal(renamed.json.catalogReconciliation.conflict, true);
  });

  test("align: catalogs follow 4.22 and old-minor selections become intent", async () => {
    const p = await conflicted("align");
    const r = await api("POST", `/api/mirroring/profiles/${p.id}/reconcile-catalog`, { action: "align" });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.equal(r.json.profile.operators.catalogMinor, "4.22");
    assert.equal(r.json.profile.operators.catalogMinorSource, "platform");
    assert.equal(r.json.profile.operators.selected[0].catalogImage, null);
    assert.equal(r.json.profile.catalogReconciliation.conflict, false);
  });

  test("split: operators move unchanged into a new operators-only profile; platform stays", async () => {
    const p = await conflicted("split");
    const r = await api("POST", `/api/mirroring/profiles/${p.id}/reconcile-catalog`, { action: "split" });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.equal(r.json.profile.content.operators, false);
    assert.equal(r.json.profile.content.platform, true);
    assert.deepEqual(r.json.newProfile.content, { platform: false, operators: true, additionalImages: false });
    assert.equal(r.json.newProfile.operators.catalogMinor, "4.21");
    assert.equal(r.json.newProfile.operators.selected[0].catalogImage, "registry.redhat.io/redhat/redhat-operator-index:v4.21");
    const slice = (await api("GET", "/api/mirroring")).json;
    assert.ok(slice.profiles.some((x) => x.id === r.json.newProfile.id));
  });

  test("choosing a platform release with the same minor resolves the conflict without a rewrite", async () => {
    const p = await conflicted("match");
    const r = await update(p.id, { platform: release("4.21", "4.21.9") });
    assert.equal(r.json.operators.catalogMinor, "4.21");
    assert.equal(r.json.catalogReconciliation.conflict, false);
    assert.equal(r.json.operators.selected[0].catalogImage, "registry.redhat.io/redhat/redhat-operator-index:v4.21");
  });

  test("reconcile on a profile without a conflict is refused", async () => {
    const p = await create({ name: "noconflict", content: { platform: true, operators: true }, platform: release("4.22", "4.22.18") });
    const r = await api("POST", `/api/mirroring/profiles/${p.id}/reconcile-catalog`, { action: "align" });
    assert.equal(r.status, 409);
  });

  test("pure derivation: a legacy stored override is preserved; an import-sourced one too", () => {
    for (const source of ["user", "import"]) {
      const prev = normalizeProfile({ content: { platform: true, operators: true }, platform: release("4.22", "4.22.18"), operators: { catalogMinor: "4.20", catalogMinorSource: source, selected: [op("4.20")] } }, "p-legacy0001");
      const out = deriveCatalogMinor(prev, prev).profile;
      assert.equal(out.operators.catalogMinor, "4.20");
      assert.equal(catalogMinorReconciliation(out).conflict, true);
      assert.ok(generationReadiness(out).some((x) => x.code === "CATALOG_PLATFORM_MINOR_CONFLICT"));
    }
  });
});

describe("operators without platform, and images only", () => {
  test("operators-only requires an explicit catalog minor and keeps it", async () => {
    const p = await create({ name: "opsonly", content: { operators: true } });
    assert.equal(p.operators.catalogMinor, null, "no fabricated default");
    assert.match(p.readiness.map((x) => x.message).join(" "), /Select the operator catalog minor/);
    const r = await update(p.id, { operators: { catalogMinor: "4.20", catalogMinorSource: "user" } });
    assert.equal(r.json.operators.catalogMinor, "4.20");
    assert.equal((await update(p.id, { operators: { catalogMinor: "4.23" } })).status, 422, "No-Fallback");
  });

  test("operators + images behaves like operators-only", async () => {
    const p = await create({ name: "opsimg", content: { operators: true, additionalImages: true }, operators: { catalogMinor: "4.21", catalogMinorSource: "user" } });
    assert.equal(p.operators.catalogMinor, "4.21");
    assert.equal(p.catalogReconciliation, null);
  });

  test("images-only needs no OpenShift minor at all", async () => {
    const p = await create({ name: "img", content: { additionalImages: true }, additionalImages: [{ id: "img-aaaa0001", name: "quay.io/a/b:1", source: "user" }] });
    assert.deepEqual(p.readiness, []);
    const r = await api("POST", `/api/mirroring/profiles/${p.id}/preview`, {});
    assert.equal(r.status, 200);
    assert.doesNotMatch(r.json.imagesetConfig, /4\.\d+/);
  });
});
