/**
 * v2.2.0 M4 — secure ImageSetConfiguration import through the real API.
 *
 * Genuine files (Red Hat 4.22 documentation, openshift/oc-mirror) and the
 * binary-probe fixtures drive it: mapping never invents data, unrepresentable
 * parts are kept as unresolved items, unsupported minors are reported (No
 * Fallback), multi-file merges need explicit conflict resolution, user rows
 * survive, originals are preserved and hashed, failures roll back, oc-mirror
 * is never run, and Install's external-config preflight rejects exactly the
 * documents Mirroring import rejects.
 */
import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";
import { app } from "../src/index.js";
import { createTestServer, closeTestServer } from "./helpers/httpServerLifecycle.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FX = path.join(__dirname, "fixtures", "imageset-config");
const DATA_DIR = process.env.DATA_DIR;
let server;
let baseUrl;
const api = async (method, url, body) => {
  const res = await fetch(`${baseUrl}${url}`, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, json: await res.json().catch(() => null), text: null };
};
const b64 = (text) => Buffer.from(text, "utf8").toString("base64");
const file = (name, text) => ({ name, contentBase64: b64(text) });
const genuine = (name) => file(name, fs.readFileSync(path.join(FX, "genuine", name), "utf8"));
const analyze = (files, extra = {}) => api("POST", "/api/mirroring/import/analyze", { files, ...extra });
const apply = (files, extra = {}) => api("POST", "/api/mirroring/import/apply", { files, ...extra });
const slice = async () => (await api("GET", "/api/mirroring")).json;
const H = "apiVersion: mirror.openshift.io/v2alpha1\nkind: ImageSetConfiguration\n";

before(async () => {
  ({ server, baseUrl } = await createTestServer(app));
  await api("POST", "/api/mirroring/start-over", {});
});
after(async () => closeTestServer(server));

describe("a genuine oc-mirror v2 file (Red Hat 4.22 docs)", () => {
  let profile;
  const docs = genuine("11-oc-mirror-building-image-set-config-v2.yaml");

  test("analyze: valid, mapped without inventing anything", async () => {
    const r = await analyze([docs]);
    assert.equal(r.status, 200, JSON.stringify(r.json));
    const f = r.json.files[0];
    assert.equal(f.status, "valid");
    assert.match(f.sha256, /^[a-f0-9]{64}$/);
    assert.deepEqual(f.summary.content, { platform: true, operators: true, additionalImages: true });
    assert.equal(f.summary.platformRelease, "4.22.0");
    assert.equal(f.summary.catalogMinor, "4.22");
    assert.equal(f.summary.operators, 3);
    assert.equal(f.summary.operatorsWithoutChannel, 2, "packages without a channel get none invented");
    assert.deepEqual(f.unresolved, []);
    assert.equal(r.json.applicable, true);
  });

  test("apply: one profile, release unlocked, operators and images with provenance, original stored", async () => {
    const jobsBefore = (await api("GET", "/api/jobs")).json;
    const r = await apply([docs]);
    assert.equal(r.status, 200, JSON.stringify(r.json));
    profile = r.json.profiles.find((p) => p.id === r.json.imported[0]);
    assert.equal(profile.name, "11-oc-mirror-building-image-set-config-v2");
    assert.equal(profile.platform.release.patchVersion, "4.22.0");
    assert.equal(profile.platform.version.locked, false, "an imported release is not locked for the user");
    assert.equal(profile.platform.graph, true);
    assert.equal(profile.operators.catalogMinor, "4.22");
    const byName = Object.fromEntries(profile.operators.selected.map((o) => [o.name, o]));
    assert.equal(byName["node-observability-operator"].defaultChannel, "stable");
    assert.equal(byName["3scale-operator"].defaultChannel, null);
    assert.equal(byName["3scale-operator"].catalogImage, "registry.redhat.io/redhat/redhat-operator-index:v4.22");
    assert.ok(profile.operators.selected.every((o) => o.sources[0].startsWith("import:imp-")));
    assert.deepEqual(profile.additionalImages.map((i) => i.name), ["registry.redhat.io/ubi8/ubi:latest", "registry.redhat.io/ubi9/ubi@sha256:20f695d2a91352d4eaa25107535126727b5945bff38ed36a3e59590f495046f0"]);
    assert.ok(profile.additionalImages.every((i) => i.source.startsWith("import:")));
    const rec = profile.imports[0];
    const original = fs.readFileSync(path.join(profile.paths.root || path.dirname(profile.paths.archivePath), "imports", `${rec.sha256}.yaml`));
    assert.equal(crypto.createHash("sha256").update(original).digest("hex"), rec.sha256);
    assert.equal(fs.statSync(path.join(path.dirname(profile.paths.archivePath), "imports", `${rec.sha256}.yaml`)).mode & 0o777, 0o600);
    const jobsAfter = (await api("GET", "/api/jobs")).json;
    assert.equal(JSON.stringify(jobsAfter), JSON.stringify(jobsBefore), "import never starts oc-mirror or any job");
  });

  test("the original is viewable, byte-for-byte, and verified against its hash", async () => {
    const r = await api("GET", `/api/mirroring/profiles/${profile.id}/imports/${profile.imports[0].id}`);
    assert.equal(r.status, 200);
    assert.equal(r.json.content, Buffer.from(docs.contentBase64, "base64").toString("utf8"));
    // Tamper with the stored copy: it is refused rather than shown.
    const p = path.join(path.dirname(profile.paths.archivePath), "imports", `${profile.imports[0].sha256}.yaml`);
    const keep = fs.readFileSync(p);
    fs.chmodSync(p, 0o600);
    fs.writeFileSync(p, "tampered");
    assert.equal((await api("GET", `/api/mirroring/profiles/${profile.id}/imports/${profile.imports[0].id}`)).status, 409);
    fs.writeFileSync(p, keep);
  });

  test("after locking, the preview contains only what the file stated (no channel invented)", async () => {
    assert.equal((await api("POST", `/api/mirroring/profiles/${profile.id}/lock`, {})).status, 200);
    const r = await api("POST", `/api/mirroring/profiles/${profile.id}/preview`, {});
    assert.equal(r.status, 200, JSON.stringify(r.json));
    const doc = yaml.load(r.json.imagesetConfig);
    assert.deepEqual(doc.mirror.platform.channels, [{ name: "stable-4.22", minVersion: "4.22.0", maxVersion: "4.22.0" }]);
    assert.deepEqual(doc.mirror.operators[0].packages, [{ name: "node-observability-operator", channels: [{ name: "stable" }] }]);
    assert.equal(r.json.content.operators.unresolved, 2, "the two channel-less packages wait for the catalogs");
  });

  test("importing the same file again says where it already is", async () => {
    const r = await analyze([docs]);
    assert.deepEqual(r.json.files[0].alreadyImportedInto, ["11-oc-mirror-building-image-set-config-v2"]);
  });
});

describe("invalid and unsupported files are never applied", () => {
  test("an oc-mirror v1 example from the 4.22 docs: invalid with reasons; apply changes nothing", async () => {
    const before = await slice();
    const f = genuine("01-oc-mirror-image-set-config-examples.yaml");
    const r = await analyze([f]);
    assert.equal(r.json.files[0].status, "invalid");
    assert.equal(r.json.files[0].stage, "structure");
    assert.ok(r.json.files[0].errors.some((e) => e.path === "storageConfig"));
    assert.equal(r.json.applicable, false);
    const a = await apply([f]);
    assert.equal(a.status, 400);
    assert.equal(a.json.code, "IMPORT_NOT_APPLICABLE");
    assert.deepEqual((await slice()).profiles.map((p) => p.id), before.profiles.map((p) => p.id));
  });

  test("malformed YAML, several documents and binary data are refused with actionable messages", async () => {
    const r = await analyze([
      file("broken.yaml", "kind: ImageSetConfiguration\nmirror: [\n"),
      file("two.yaml", `${H}mirror:\n  additionalImages:\n  - name: quay.io/a/b:1\n---\n${H}mirror: {}\n`),
      { name: "blob.bin", contentBase64: Buffer.from([0x00, 0xff, 0x10, 0x80]).toString("base64") }
    ]);
    assert.deepEqual(r.json.files.map((f) => [f.status, f.stage, f.errors[0].code]), [
      ["invalid", "parse", "INVALID_YAML"],
      ["invalid", "parse", "MULTIPLE_DOCUMENTS"],
      ["invalid", "parse", "ENCODING"]
    ]);
    assert.ok(Number.isInteger(r.json.files[0].errors[0].line));
  });

  test("an unsupported minor is reported, never replaced (No Fallback)", async () => {
    const r = await analyze([genuine("16-oc-mirror-imageset-config-parameters-v2.yaml")]);
    const f = r.json.files[0];
    assert.equal(f.status, "valid", "structurally fine");
    assert.equal(f.representable, false);
    assert.equal(f.unresolved[0].code, "UNSUPPORTED_VERSION");
    assert.match(f.unresolved[0].message, /OpenShift 4\.16 is not supported.*no other release was substituted/);
    assert.equal((await apply([genuine("16-oc-mirror-imageset-config-parameters-v2.yaml")])).status, 400);
  });

  test("credentials in a URL make the file invalid and are never echoed", async () => {
    const r = await analyze([file("creds.yaml", `${H}mirror:\n  helm:\n    repositories:\n    - name: r\n      url: https://alice:TopSecret9@charts.example.com\n      charts:\n      - name: c\n`)]);
    assert.equal(r.json.files[0].status, "invalid");
    assert.doesNotMatch(JSON.stringify(r.json), /TopSecret9/);
  });

  test("size bounds", async () => {
    const files = Array.from({ length: 11 }, (_, i) => file(`f${i}.yaml`, `${H}mirror: {}\n`));
    assert.equal((await analyze(files)).status, 400);
  });
});

describe("parts the guided editor cannot represent are kept and reviewed, not transformed", () => {
  test("multi-channel platform from the docs: unresolved, nothing guessed", async () => {
    const r = await analyze([genuine("09-oc-mirror-image-set-config-examples.yaml")]);
    const f = r.json.files[0];
    assert.equal(f.representable, false);
    assert.match(f.unresolved[0].message, /2 release channels \(stable-4\.12, eus-4\.14\)/);
  });

  test("helm and a retargeted image are listed; the profile is not ready until each is left out", async () => {
    const text = `${H}mirror:\n  additionalImages:\n  - name: quay.io/org/tool:v1\n  - name: quay.io/org/other:v2\n    targetRepo: mirror/other\n  helm:\n    repositories:\n    - name: podinfo\n      url: https://stefanprodan.github.io/podinfo\n      charts:\n      - name: podinfo\n        version: 5.0.0\n`;
    const a = await apply([file("partial.yaml", text)]);
    assert.equal(a.status, 200, JSON.stringify(a.json));
    const p = a.json.profiles.find((x) => x.id === a.json.imported[0]);
    assert.deepEqual(p.additionalImages.map((i) => i.name), ["quay.io/org/tool:v1"]);
    assert.equal(p.imports[0].unresolved.length, 2);
    assert.ok(p.readiness.some((x) => x.code === "IMPORT_REVIEW_REQUIRED"));
    assert.equal((await api("POST", `/api/mirroring/profiles/${p.id}/preview`, {})).status, 400);
    const one = await api("POST", `/api/mirroring/profiles/${p.id}/imports/${p.imports[0].id}/review`, { action: "omit", itemIds: [p.imports[0].unresolved[0].id] });
    assert.ok(one.json.readiness.some((x) => x.code === "IMPORT_REVIEW_REQUIRED"), "one item still open");
    const all = await api("POST", `/api/mirroring/profiles/${p.id}/imports/${p.imports[0].id}/review`, { action: "omit", itemIds: "all" });
    assert.deepEqual(all.json.readiness, []);
    const prev = await api("POST", `/api/mirroring/profiles/${p.id}/preview`, {});
    assert.equal(prev.status, 200);
    assert.doesNotMatch(prev.json.imagesetConfig, /helm|other/);
    // The original still holds everything.
    const orig = await api("GET", `/api/mirroring/profiles/${p.id}/imports/${p.imports[0].id}`);
    assert.match(orig.json.content, /helm:/);
  });

  test("a file whose catalogs and platform differ is imported as written and asks to reconcile", async () => {
    const text = `${H}mirror:\n  platform:\n    channels:\n    - name: stable-4.22\n      minVersion: 4.22.18\n      maxVersion: 4.22.18\n  operators:\n  - catalog: registry.redhat.io/redhat/redhat-operator-index:v4.21\n    packages:\n    - name: web-terminal\n      channels:\n      - name: fast\n`;
    const an = await analyze([file("mixed.yaml", text)]);
    assert.deepEqual(an.json.files[0].summary.catalogPlatformMismatch, { platformMinor: "4.22", catalogMinor: "4.21" });
    const a = await apply([file("mixed.yaml", text)]);
    const p = a.json.profiles.find((x) => x.id === a.json.imported[0]);
    assert.equal(p.operators.catalogMinor, "4.21");
    assert.equal(p.operators.catalogMinorSource, "import");
    assert.equal(p.operators.selected[0].catalogImage, "registry.redhat.io/redhat/redhat-operator-index:v4.21");
    assert.deepEqual(p.catalogReconciliation, { platformMinor: "4.22", catalogMinor: "4.21", source: "import", conflict: true });
    const split = await api("POST", `/api/mirroring/profiles/${p.id}/reconcile-catalog`, { action: "split" });
    assert.equal(split.json.newProfile.operators.selected[0].defaultChannel, "fast", "the imported channel travels intact");
    assert.equal(split.json.newProfile.imports[0].sha256, p.imports[0].sha256, "provenance travels with the operators");
  });
});

describe("several files", () => {
  const A = `${H}mirror:\n  platform:\n    channels:\n    - name: stable-4.22\n      minVersion: 4.22.18\n      maxVersion: 4.22.18\n  operators:\n  - catalog: registry.redhat.io/redhat/redhat-operator-index:v4.22\n    packages:\n    - name: web-terminal\n      channels:\n      - name: fast\n  additionalImages:\n  - name: quay.io/org/shared:v1\n`;
  const B = `${H}archiveSize: 8\nmirror:\n  platform:\n    channels:\n    - name: stable-4.21\n      minVersion: 4.21.9\n      maxVersion: 4.21.9\n  operators:\n  - catalog: registry.redhat.io/redhat/redhat-operator-index:v4.21\n    packages:\n    - name: web-terminal\n      channels:\n      - name: stable\n    - name: local-storage-operator\n  additionalImages:\n  - name: quay.io/org/shared:v1\n  - name: quay.io/org/only-b:v1\n`;

  test("separate (default): one profile per file, no conflicts", async () => {
    const r = await apply([file("a.yaml", A), file("b.yaml", B)]);
    assert.equal(r.status, 200);
    assert.equal(r.json.imported.length, 2);
  });

  test("merge: conflicts are listed, apply refuses until each is resolved", async () => {
    const an = await analyze([file("a.yaml", A), file("b.yaml", B)], { mode: "merge" });
    assert.deepEqual(an.json.conflicts.map((c) => c.kind).sort(), ["catalog-minor", "package", "platform"]);
    assert.equal(an.json.applicable, false);
    const refused = await apply([file("a.yaml", A), file("b.yaml", B)], { mode: "merge" });
    assert.equal(refused.status, 409);
    assert.equal(refused.json.code, "IMPORT_CONFLICTS_UNRESOLVED");
    const resolutions = Object.fromEntries(an.json.conflicts.map((c) => [c.id, c.options[0].id])); // file A everywhere
    const ok = await apply([file("a.yaml", A), file("b.yaml", B)], { mode: "merge", resolutions, names: ["merged"] });
    assert.equal(ok.status, 200, JSON.stringify(ok.json));
    const p = ok.json.profiles.find((x) => x.id === ok.json.imported[0]);
    assert.equal(p.name, "merged");
    assert.equal(p.platform.release.patchVersion, "4.22.18");
    assert.equal(p.operators.catalogMinor, "4.22");
    const wt = p.operators.selected.find((o) => o.name === "web-terminal");
    assert.equal(wt.defaultChannel, "fast");
    const lso = p.operators.selected.find((o) => o.name === "local-storage-operator");
    assert.equal(lso.catalogImage, null, "from the other minor: kept as intent, re-resolved from 4.22 catalogs");
    assert.deepEqual(p.additionalImages.map((i) => i.name), ["quay.io/org/shared:v1", "quay.io/org/only-b:v1"], "duplicates listed once");
    assert.equal(p.options.archiveSize, 8);
    assert.equal(p.imports.length, 2);
  });

  test("into an existing profile: user-typed and user-edited rows are untouched; conflicts need a choice", async () => {
    const created = await api("POST", "/api/mirroring/profiles", {
      name: "existing", content: { operators: true, additionalImages: true },
      operators: { catalogMinor: "4.22", catalogMinorSource: "user", selected: [{ id: "x", name: "web-terminal", catalog: "redhat", catalogImage: "registry.redhat.io/redhat/redhat-operator-index:v4.22", defaultChannel: "candidate" }] },
      additionalImages: [
        { id: "img-user0001", name: "quay.io/org/shared:v1", source: "user" },
        { id: "img-sugg0001", name: "quay.io/vendor/disk:9", source: "operator:kubevirt-hyperconverged", userModified: true }
      ]
    });
    const id = created.json.id;
    const an = await analyze([file("a.yaml", A)], { mode: "into", profileId: id });
    const pkg = an.json.conflicts.find((c) => c.kind === "package");
    assert.ok(pkg, JSON.stringify(an.json.conflicts));
    assert.equal((await apply([file("a.yaml", A)], { mode: "into", profileId: id })).status, 409);
    const keepExisting = Object.fromEntries(an.json.conflicts.map((c) => [c.id, "0"]));
    const ok = await apply([file("a.yaml", A)], { mode: "into", profileId: id, resolutions: keepExisting });
    assert.equal(ok.status, 200, JSON.stringify(ok.json));
    const p = ok.json.profiles.find((x) => x.id === id);
    assert.deepEqual(p.additionalImages.slice(0, 2), [
      { id: "img-user0001", name: "quay.io/org/shared:v1", source: "user" },
      { id: "img-sugg0001", name: "quay.io/vendor/disk:9", source: "operator:kubevirt-hyperconverged", userModified: true }
    ]);
    assert.equal(p.additionalImages.length, 2, "the imported duplicate did not replace the user's row");
    assert.equal(p.operators.selected.find((o) => o.name === "web-terminal").defaultChannel, "candidate", "existing choice kept");
    assert.equal(p.content.platform, true, "the file's platform release was added");
    assert.equal(p.platform.version.locked, false);
  });
});

describe("rollback", () => {
  test("if the originals cannot be stored, nothing is imported", async () => {
    const before = await slice();
    const profilesDir = path.join(DATA_DIR, "oc-mirror", "profiles");
    const aside = `${profilesDir}.aside`;
    const existed = fs.existsSync(profilesDir);
    if (existed) fs.renameSync(profilesDir, aside);
    fs.mkdirSync(path.dirname(profilesDir), { recursive: true });
    fs.writeFileSync(profilesDir, "not a directory");
    try {
      const r = await apply([file("x.yaml", `${H}mirror:\n  additionalImages:\n  - name: quay.io/a/rollback:1\n`)]);
      assert.equal(r.status, 500);
      assert.equal(r.json.code, "IMPORT_FAILED");
      assert.deepEqual((await slice()).profiles.map((p) => p.id), before.profiles.map((p) => p.id));
    } finally {
      fs.unlinkSync(profilesDir);
      if (existed) fs.renameSync(aside, profilesDir);
    }
  });
});

describe("Install and Mirroring reject the same documents (shared authority)", () => {
  const probes = JSON.parse(fs.readFileSync(path.join(FX, "binary-probes.json"), "utf8")).probes;
  const dir = path.join(DATA_DIR, "m4-parity");
  before(() => fs.mkdirSync(dir, { recursive: true }));

  test("every probe: Install external-config preflight and Mirroring import agree", async () => {
    let compared = 0;
    for (const probe of probes) {
      const p = path.join(dir, `${probe.id}.yaml`);
      fs.writeFileSync(p, probe.yaml);
      const pre = await api("POST", "/api/ocmirror/preflight", {
        mode: "mirrorToDisk", archivePath: path.join(dir, "archive"), configSourceType: "uploaded", configPath: p,
        rhPullSecret: "{\"auths\":{\"registry.example.invalid\":{\"auth\":\"dGVzdDp0ZXN0\"}}}"
      });
      const installRejects = pre.json.blockers.some((b) => b.startsWith("Config file"));
      const imp = await analyze([file(`${probe.id}.yaml`, probe.yaml)]);
      const mirroringRejects = imp.json.files[0].status === "invalid";
      assert.equal(installRejects, mirroringRejects, `${probe.id}: Install ${installRejects ? "rejects" : "accepts"}, Mirroring ${mirroringRejects ? "rejects" : "accepts"}`);
      assert.equal(mirroringRejects, probe.architect.verdict !== "valid", probe.id);
      compared += 1;
    }
    assert.equal(compared, probes.length);
    assert.ok(probes.filter((x) => x.architect.verdict !== "valid").length >= 25, "non-vacuous: most probes are deliberately broken");
  });
});
