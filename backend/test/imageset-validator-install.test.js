/**
 * v2.2.0 M4 / DOC-166 — the Install workflow on the shared validator.
 *
 *  - Every Install-generated imageset-config.yaml shape, for every fixture
 *    scenario and supported minor, passes the runtime validator UNCHANGED
 *    (the checked path returns the generator's own bytes).
 *  - Newly detected defect (recorded in docs/MIRRORING_WORKFLOW.md §3b): the
 *    Install archive-size field accepted fractions and negatives, and the
 *    generator emitted them; oc-mirror refuses `archiveSize: 4.5`. Such a
 *    configuration is now refused with the findings instead of being shown,
 *    exported or run as if it were valid.
 *  - The Install external-config preflight and a generated-config preflight
 *    both report structural findings.
 */
import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { app } from "../src/index.js";
import { buildImageSetConfig } from "../src/generate.js";
import { validateImageSetConfigText } from "../src/imagesetConfigValidator.js";
import { baseStates, builders } from "./fixtures/index.js";
import { createTestServer, closeTestServer } from "./helpers/httpServerLifecycle.js";

let server;
let baseUrl;
const api = async (method, url, body) => {
  const res = await fetch(`${baseUrl}${url}`, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, json: await res.json().catch(() => null) };
};
before(async () => { ({ server, baseUrl } = await createTestServer(app)); });
after(async () => closeTestServer(server));

const MINORS = [["4.20", "4.20.12"], ["4.21", "4.21.9"], ["4.22", "4.22.16"]];
const withMinor = (s, minor, patch) => ({
  ...s,
  release: { ...(s.release || {}), channel: minor, patchVersion: patch, confirmed: true },
  version: { ...(s.version || {}), _schemaVersion: 3, selectedMinor: minor, selectedPatch: patch, selectedChannel: `stable-${minor}`, selectedVersion: patch, locked: true }
});

describe("every Install-generated ImageSetConfiguration is structurally valid", () => {
  const names = Object.keys(baseStates).filter((n) => typeof baseStates[n] === "function");
  test("the sweep is not vacuous", () => assert.ok(names.length >= 5));
  for (const name of names) {
    for (const [minor, patch] of MINORS) {
      test(`${name} @ ${minor} (+ variants)`, () => {
        const s = withMinor(baseStates[name](), minor, patch);
        const variants = [
          s,
          builders.withMirroring(builders.withProxy(builders.withFips(s))),
          { ...s, operators: { selected: [{ id: "a", name: "web-terminal", catalogImage: `registry.redhat.io/redhat/redhat-operator-index:v${minor}`, defaultChannel: "fast", minVersion: "1.0.0" }] },
            imagesetConfig: { additionalImages: `quay.io/a/b:1\nquay.io/c/d@sha256:${"0".repeat(64)}`, kubeVirtContainer: true, archiveSize: "4", graph: false } }
        ];
        for (const v of variants) {
          let text;
          try { text = buildImageSetConfig(v); } catch (e) { if (/architecture/i.test(e.message)) continue; throw e; }
          const r = validateImageSetConfigText(text);
          assert.equal(r.ok, true, `${name}@${minor}: ${JSON.stringify(r.errors)}`);
        }
      });
    }
  }
});

describe("newly detected Install defect: archive size", () => {
  const state = (archiveSize) => ({
    ...withMinor(baseStates.bareMetalAgent(), "4.22", "4.22.16"),
    imagesetConfig: { archiveSize }
  });

  test("a whole number is unchanged: the preview returns the generator's own bytes", async () => {
    const r = await api("POST", "/api/generate", { state: state("4"), isolateArtifacts: true });
    assert.equal(r.status, 200);
    assert.equal(r.json.files["imageset-config.yaml"], buildImageSetConfig(state("4")));
    assert.equal(r.json.fileErrors["imageset-config.yaml"], undefined);
  });

  test("4.5 (oc-mirror refuses it) is reported for that file only, never shown as a file", async () => {
    const r = await api("POST", "/api/generate", { state: state("4.5"), isolateArtifacts: true });
    assert.equal(r.status, 200);
    assert.equal(r.json.files["imageset-config.yaml"], undefined);
    assert.equal(r.json.fileErrors["imageset-config.yaml"].code, "IMAGESET_CONFIG_INVALID");
    assert.ok(r.json.files["install-config.yaml"], "other artifacts are unaffected");
  });

  test("whole-request callers (Review/export) get 422 with the finding", async () => {
    const r = await api("POST", "/api/generate", { state: state("4.5") });
    assert.equal(r.status, 422);
    assert.equal(r.json.code, "IMAGESET_CONFIG_INVALID");
    assert.ok(r.json.details.some((d) => d.path === "archiveSize" && d.code === "WRONG_TYPE"));
  });

  test("a negative size is refused too (oc-mirror would accept a meaningless value)", async () => {
    const r = await api("POST", "/api/generate", { state: state("-2") });
    assert.equal(r.status, 422);
    assert.ok(r.json.details.some((d) => d.path === "archiveSize" && d.code === "OUT_OF_RANGE"));
  });

  test("the export bundle is not built from an invalid configuration", async () => {
    const r = await api("POST", "/api/bundle.zip", { state: state("4.5") });
    assert.equal(r.status, 422);
    assert.equal(r.json.code, "IMAGESET_CONFIG_INVALID");
  });
});

describe("preflight reports structural findings", () => {
  test("Install external config: an oc-mirror v1 file from the 4.22 docs is blocked with the reason", async () => {
    const dir = path.join(process.env.DATA_DIR, "m4-ext");
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, "v1.yaml");
    fs.copyFileSync(path.join(path.dirname(new URL(import.meta.url).pathname), "fixtures", "imageset-config", "genuine", "01-oc-mirror-image-set-config-examples.yaml"), file);
    const r = await api("POST", "/api/ocmirror/preflight", { mode: "mirrorToDisk", archivePath: path.join(dir, "a"), configSourceType: "uploaded", configPath: file, rhPullSecret: "{\"auths\":{\"registry.example.invalid\":{\"auth\":\"dGVzdDp0ZXN0\"}}}" });
    assert.equal(r.status, 200);
    assert.ok(r.json.blockers.some((b) => /storageConfig is not an oc-mirror v2 ImageSetConfiguration field/.test(b)), JSON.stringify(r.json.blockers));
    assert.ok(r.json.blockers.some((b) => /apiVersion/.test(b)));
  });
});
