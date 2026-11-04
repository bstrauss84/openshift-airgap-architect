/**
 * v2.2.0 M3 — Mirroring content through the real API: every valid content
 * combination generates only its own groups; operator intent survives a
 * catalog-minor change without fabricated metadata; additional-image rows keep
 * identity and ownership; the preview explains what is included.
 */
import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import yaml from "js-yaml";
import { app } from "../src/index.js";
import { createTestServer, closeTestServer } from "./helpers/httpServerLifecycle.js";

let server;
let baseUrl;
const api = async (method, url, body) => {
  const res = await fetch(`${baseUrl}${url}`, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, json: await res.json().catch(() => null) };
};
const resolvedOp = (minor, name = "web-terminal") => ({
  id: `redhat:${name}`, name, displayName: "Web Terminal", catalog: "redhat",
  catalogImage: `registry.redhat.io/redhat/redhat-operator-index:v${minor}`, defaultChannel: "fast"
});
const platform = { release: { channel: "4.22", patchVersion: "4.22.16" }, architecture: "x86_64" };
const image = { id: "img-abcd1234", name: "quay.io/org/tool:v1", source: "user" };

const create = async (body, lock = false) => {
  const r = await api("POST", "/api/mirroring/profiles", body);
  assert.equal(r.status, 201, JSON.stringify(r.json));
  if (lock) assert.equal((await api("POST", `/api/mirroring/profiles/${r.json.id}/lock`, {})).status, 200);
  return r.json;
};
const preview = async (id) => api("POST", `/api/mirroring/profiles/${id}/preview`, {});

before(async () => {
  ({ server, baseUrl } = await createTestServer(app));
  await api("POST", "/api/mirroring/start-over", {});
});
after(async () => closeTestServer(server));

describe("every content combination generates only its own groups", () => {
  const combos = [
    ["platform", { platform: true }, true],
    ["operators", { operators: true }, false],
    ["images", { additionalImages: true }, false],
    ["platform+operators", { platform: true, operators: true }, true],
    ["platform+images", { platform: true, additionalImages: true }, true],
    ["operators+images", { operators: true, additionalImages: true }, false],
    ["all three", { platform: true, operators: true, additionalImages: true }, true]
  ];
  for (const [label, content, needsLock] of combos) {
    test(label, async () => {
      // With platform content the catalogs follow the platform minor (4.22,
      // revised owner decision); operators-only profiles choose their own (4.21).
      const catMinor = content.platform ? "4.22" : "4.21";
      const p = await create({
        name: label, content,
        platform,
        operators: content.platform
          ? { selected: [resolvedOp("4.22")] }
          : { catalogMinor: "4.21", catalogMinorSource: "user", selected: [resolvedOp("4.21")] },
        additionalImages: [image]
      }, needsLock);
      const r = await preview(p.id);
      assert.equal(r.status, 200, JSON.stringify(r.json));
      const doc = yaml.load(r.json.imagesetConfig);
      const keys = Object.keys(doc.mirror).sort();
      const want = [content.additionalImages && "additionalImages", content.operators && "operators", content.platform && "platform"].filter(Boolean).sort();
      assert.deepEqual(keys, want);
      if (!content.platform) assert.doesNotMatch(r.json.imagesetConfig, /stable-4\./, "no fabricated platform channel");
      if (content.operators) assert.equal(doc.mirror.operators[0].catalog, `registry.redhat.io/redhat/redhat-operator-index:v${catMinor}`);
      for (const k of ["platform", "operators", "additionalImages"]) {
        const sel = content[k] === true;
        assert.equal(r.json.content[k].status, sel ? "included" : "not-selected", k);
      }
    });
  }
});

describe("operator intent and catalog minor", () => {
  test("intent-only operators are stored without fabricated metadata and left out of the file", async () => {
    const p = await create({
      name: "intent", content: { operators: true },
      operators: { catalogMinor: "4.22", catalogMinorSource: "user", selected: [resolvedOp("4.22", "local-storage-operator"), { id: "redhat:web-terminal", name: "web-terminal", displayName: "Web Terminal" }] }
    });
    const intent = p.operators.selected.find((o) => o.name === "web-terminal");
    assert.equal(intent.catalogImage, null);
    assert.equal(intent.defaultChannel, null);
    assert.equal(p.operators.catalogMinorSource, "user");
    assert.ok(p.warnings.some((w) => w.code === "OPERATORS_UNRESOLVED"));
    const r = await preview(p.id);
    assert.equal(r.status, 200);
    const names = yaml.load(r.json.imagesetConfig).mirror.operators[0].packages.map((x) => x.name);
    assert.deepEqual(names, ["local-storage-operator"]);
    assert.deepEqual(r.json.content.operators, { status: "included", catalogMinor: "4.22", included: 1, unresolved: 1 });
  });

  test("only intent: the preview refuses with the reason instead of an empty operators list", async () => {
    const p = await create({ name: "only intent", content: { operators: true }, operators: { catalogMinor: "4.22", selected: [{ id: "x", name: "web-terminal" }] } });
    const r = await preview(p.id);
    assert.equal(r.status, 400);
    assert.equal(r.json.code, "PROFILE_NOT_READY");
    assert.match(r.json.details.map((d) => d.message).join(" "), /None of the selected operators is resolved for catalog 4\.22/);
  });

  test("catalog minor source accepts platform|user only; unsupported catalog minor is 422", async () => {
    assert.equal((await api("POST", "/api/mirroring/profiles", { operators: { catalogMinorSource: "magic" } })).status, 400);
    assert.equal((await api("POST", "/api/mirroring/profiles", { content: { operators: true }, operators: { catalogMinor: "4.23" } })).status, 422);
  });

  test("with platform content a different catalog minor is refused (catalogs follow the platform; M4 revision)", async () => {
    const r = await api("POST", "/api/mirroring/profiles", { name: "mix", content: { platform: true, operators: true }, platform, operators: { catalogMinor: "4.21", selected: [resolvedOp("4.21")] } });
    assert.equal(r.status, 400);
    assert.equal(r.json.code, "CATALOG_MINOR_FOLLOWS_PLATFORM");
  });
});

describe("additional image rows", () => {
  test("rows keep identity, owner and the user-modified mark; duplicates of a row id are refused", async () => {
    const p = await create({
      name: "images", content: { additionalImages: true },
      additionalImages: [image, { id: "img-sugg0001", name: "quay.io/vendor/disk:9", source: "operator:kubevirt-hyperconverged", userModified: true }]
    });
    assert.deepEqual(p.additionalImages, [
      image,
      { id: "img-sugg0001", name: "quay.io/vendor/disk:9", source: "operator:kubevirt-hyperconverged", userModified: true }
    ]);
    const dup = await api("POST", `/api/mirroring/profiles/${p.id}`, { additionalImages: [image, { ...image, name: "quay.io/x/y:2" }] });
    assert.equal(dup.status, 400);
    const r = await preview(p.id);
    assert.deepEqual(yaml.load(r.json.imagesetConfig).mirror.additionalImages, [{ name: "quay.io/org/tool:v1" }, { name: "quay.io/vendor/disk:9" }]);
  });
});
