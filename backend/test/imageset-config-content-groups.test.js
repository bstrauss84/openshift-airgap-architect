/**
 * buildImageSetConfig content groups (v2.2.0 Mirroring M1).
 *
 * Without `options.content` the generator must keep producing the Install
 * workflow's combined configuration exactly as before (the byte-identity of
 * Install output is additionally proven by a golden comparison recorded in the
 * M1 checkpoint). With it, only the selected groups are emitted and each keeps
 * its own version rule: platform → supported platform minor; operators →
 * supported catalog minor, independent of the platform; additional images →
 * no OpenShift version at all.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import yaml from "js-yaml";
import { buildImageSetConfig } from "../src/generate.js";

const op = (minor, name = "web-terminal") => ({
  id: name, name, catalogImage: `registry.redhat.io/redhat/redhat-operator-index:v${minor}`, defaultChannel: "fast"
});

const installState = {
  release: { channel: "4.22", patchVersion: "4.22.16", confirmed: true },
  version: { _schemaVersion: 3, selectedMinor: "4.22", selectedPatch: "4.22.16", locked: true },
  blueprint: { arch: "x86_64" },
  operators: { selected: [op("4.22")] },
  imagesetConfig: { additionalImages: "quay.io/a/b:1" }
};

test("no content option: Install's combined configuration (platform, operators, additionalImages)", () => {
  const doc = yaml.load(buildImageSetConfig(installState));
  assert.deepEqual(Object.keys(doc.mirror), ["platform", "operators", "additionalImages"]);
  assert.equal(doc.mirror.platform.channels[0].name, "stable-4.22");
  assert.equal(buildImageSetConfig(installState), buildImageSetConfig(installState, {}), "an empty options object is the Install path");
});

test("additional images only: no platform, no operators, no OpenShift version required", () => {
  const out = buildImageSetConfig({ imagesetConfig: { additionalImages: "quay.io/a/b:1\nquay.io/c/d:2" } },
    { content: { additionalImages: true } });
  const doc = yaml.load(out);
  assert.deepEqual(Object.keys(doc.mirror), ["additionalImages"]);
  assert.deepEqual(doc.mirror.additionalImages, [{ name: "quay.io/a/b:1" }, { name: "quay.io/c/d:2" }]);
});

test("operators only: needs an exact, supported catalog minor and fails closed otherwise", () => {
  const state = { operators: { selected: [op("4.21")] } };
  const doc = yaml.load(buildImageSetConfig(state, { content: { operators: true }, catalogMinor: "4.21" }));
  assert.deepEqual(Object.keys(doc.mirror), ["operators"]);
  assert.equal(doc.mirror.operators[0].catalog, "registry.redhat.io/redhat/redhat-operator-index:v4.21");

  for (const catalogMinor of [undefined, null, "4.21.3", "stable-4.21", "4.23", "4.19"]) {
    assert.throws(
      () => buildImageSetConfig(state, { content: { operators: true }, catalogMinor }),
      (err) => err.code === "UNSUPPORTED_VERSION",
      `catalogMinor ${catalogMinor} must be refused`
    );
  }
});

test("platform + operators: the catalog minor may differ from the platform minor", () => {
  const state = { ...installState, operators: { selected: [op("4.21"), op("4.22", "other")] } };
  const doc = yaml.load(buildImageSetConfig(state, { content: { platform: true, operators: true }, catalogMinor: "4.21" }));
  assert.equal(doc.mirror.platform.channels[0].name, "stable-4.22");
  assert.deepEqual(doc.mirror.operators.map((o) => o.catalog), ["registry.redhat.io/redhat/redhat-operator-index:v4.21"],
    "operators are taken from the selected catalog minor only");
});

test("platform content keeps the supported-minor guard", () => {
  const state = { ...installState, release: { channel: "4.23", patchVersion: "4.23.1" }, version: { selectedMinor: "4.23" } };
  assert.throws(() => buildImageSetConfig(state, { content: { platform: true } }), (err) => err.code === "UNSUPPORTED_VERSION");
});

test("an empty content selection is refused", () => {
  assert.throws(() => buildImageSetConfig({}, { content: {} }), /at least one content group/);
});
