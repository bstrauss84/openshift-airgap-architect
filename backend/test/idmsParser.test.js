/**
 * OpenShift Airgap Architect - IDMS/ITMS Parser Tests
 *
 * Tests for ImageDigestMirrorSet and ImageTagMirrorSet YAML parsing.
 * Validates mirror source extraction for install-config.yaml generation.
 *
 * @author Bill Strauss
 *
 * Developed with AI assistance from Claude (Anthropic) and Cursor AI.
 */
import { test, describe } from "node:test";
import assert from "node:assert";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import os from "node:os";
import { parseIdmsFile, parseItmsFile, loadMirrorSources } from "../src/idmsParser.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe("IDMS Parser", () => {
  test("parseIdmsFile extracts sources from valid IDMS YAML", () => {
    const fixtureFile = path.join(__dirname, "fixtures", "test-idms.yaml");
    const sources = parseIdmsFile(fixtureFile);

    assert.strictEqual(sources.length, 2);
    assert.strictEqual(sources[0].source, "quay.io/openshift-release-dev/ocp-release");
    assert.deepStrictEqual(sources[0].mirrors, ["registry.example.com:8443/openshift/release"]);
    assert.strictEqual(sources[1].source, "quay.io/openshift-release-dev/ocp-v4.0-art-dev");
    assert.deepStrictEqual(sources[1].mirrors, ["registry.example.com:8443/openshift/art-dev"]);
  });

  test("parseIdmsFile returns empty array when file not found", () => {
    const nonExistentFile = path.join(__dirname, "fixtures", "does-not-exist.yaml");
    const sources = parseIdmsFile(nonExistentFile);
    assert.deepStrictEqual(sources, []);
  });

  test("parseIdmsFile returns empty array when path is null/undefined", () => {
    assert.deepStrictEqual(parseIdmsFile(null), []);
    assert.deepStrictEqual(parseIdmsFile(undefined), []);
    assert.deepStrictEqual(parseIdmsFile(""), []);
  });

  test("parseIdmsFile returns empty array for invalid YAML", () => {
    const tmpFile = path.join(os.tmpdir(), `test-invalid-${Date.now()}.yaml`);
    fs.writeFileSync(tmpFile, "invalid: yaml: content: {{{");

    try {
      const sources = parseIdmsFile(tmpFile);
      assert.deepStrictEqual(sources, []);
    } finally {
      fs.unlinkSync(tmpFile);
    }
  });

  test("parseIdmsFile returns empty array for wrong kind", () => {
    const tmpFile = path.join(os.tmpdir(), `test-wrong-kind-${Date.now()}.yaml`);
    fs.writeFileSync(tmpFile, `
apiVersion: config.openshift.io/v1
kind: ConfigMap
metadata:
  name: not-an-idms
`);

    try {
      const sources = parseIdmsFile(tmpFile);
      assert.deepStrictEqual(sources, []);
    } finally {
      fs.unlinkSync(tmpFile);
    }
  });

  test("parseIdmsFile returns empty array when spec.imageDigestMirrors is missing", () => {
    const tmpFile = path.join(os.tmpdir(), `test-no-mirrors-${Date.now()}.yaml`);
    fs.writeFileSync(tmpFile, `
apiVersion: config.openshift.io/v1
kind: ImageDigestMirrorSet
metadata:
  name: oc-mirror
spec:
  somethingElse: true
`);

    try {
      const sources = parseIdmsFile(tmpFile);
      assert.deepStrictEqual(sources, []);
    } finally {
      fs.unlinkSync(tmpFile);
    }
  });

  test("parseIdmsFile handles multi-document YAML from oc-mirror v2", () => {
    const fixtureFile = path.join(__dirname, "fixtures", "test-idms-multidoc.yaml");
    const sources = parseIdmsFile(fixtureFile);

    // 2 from idms-release-0 + 13 from idms-operator-0
    assert.strictEqual(sources.length, 15);

    // Release mirrors use correct paths (not ocp-release / ocp-v4.0-art-dev defaults)
    const ocpRelease = sources.find(s => s.source === "quay.io/openshift-release-dev/ocp-release");
    assert.ok(ocpRelease, "ocp-release source should be present");
    assert.deepStrictEqual(ocpRelease.mirrors, ["mirror.example.com:8443/openshift/release-images"]);

    const artDev = sources.find(s => s.source === "quay.io/openshift-release-dev/ocp-v4.0-art-dev");
    assert.ok(artDev, "ocp-v4.0-art-dev source should be present");
    assert.deepStrictEqual(artDev.mirrors, ["mirror.example.com:8443/openshift/release"]);

    // Operator mirrors from second document
    const openshift4 = sources.find(s => s.source === "registry.redhat.io/openshift4");
    assert.ok(openshift4, "openshift4 source should be present");
    assert.deepStrictEqual(openshift4.mirrors, ["mirror.example.com:8443/openshift4"]);

    const rhacm2 = sources.find(s => s.source === "registry.redhat.io/rhacm2");
    assert.ok(rhacm2, "rhacm2 source should be present");
    assert.deepStrictEqual(rhacm2.mirrors, ["mirror.example.com:8443/rhacm2"]);
  });

  test("parseIdmsFile skips non-IDMS documents in multi-doc YAML", () => {
    const tmpFile = path.join(os.tmpdir(), `test-mixed-docs-${Date.now()}.yaml`);
    fs.writeFileSync(tmpFile, `---
apiVersion: config.openshift.io/v1
kind: ConfigMap
metadata:
  name: not-idms
data:
  foo: bar
---
apiVersion: config.openshift.io/v1
kind: ImageDigestMirrorSet
metadata:
  name: idms-release-0
spec:
  imageDigestMirrors:
  - mirrors:
    - registry.local:8443/openshift/release
    source: quay.io/openshift-release-dev/ocp-release
`);

    try {
      const sources = parseIdmsFile(tmpFile);
      assert.strictEqual(sources.length, 1);
      assert.strictEqual(sources[0].source, "quay.io/openshift-release-dev/ocp-release");
      assert.deepStrictEqual(sources[0].mirrors, ["registry.local:8443/openshift/release"]);
    } finally {
      fs.unlinkSync(tmpFile);
    }
  });
});

describe("ITMS Parser", () => {
  test("parseItmsFile extracts sources from valid ITMS YAML", () => {
    const fixtureFile = path.join(__dirname, "fixtures", "test-itms.yaml");
    const sources = parseItmsFile(fixtureFile);

    assert.strictEqual(sources.length, 2);
    assert.strictEqual(sources[0].source, "registry.redhat.io/ubi9");
    assert.deepStrictEqual(sources[0].mirrors, ["registry.example.com:8443/ubi9"]);
    assert.strictEqual(sources[1].source, "registry.redhat.io/rhel9");
    assert.deepStrictEqual(sources[1].mirrors, ["registry.example.com:8443/rhel9"]);
  });

  test("parseItmsFile returns empty array when file not found", () => {
    const nonExistentFile = path.join(__dirname, "fixtures", "does-not-exist.yaml");
    const sources = parseItmsFile(nonExistentFile);
    assert.deepStrictEqual(sources, []);
  });

  test("parseItmsFile returns empty array when path is null/undefined", () => {
    assert.deepStrictEqual(parseItmsFile(null), []);
    assert.deepStrictEqual(parseItmsFile(undefined), []);
    assert.deepStrictEqual(parseItmsFile(""), []);
  });

  test("parseItmsFile returns empty array for wrong kind", () => {
    const tmpFile = path.join(os.tmpdir(), `test-wrong-kind-itms-${Date.now()}.yaml`);
    fs.writeFileSync(tmpFile, `
apiVersion: config.openshift.io/v1
kind: ImageDigestMirrorSet
metadata:
  name: wrong-kind
`);

    try {
      const sources = parseItmsFile(tmpFile);
      assert.deepStrictEqual(sources, []);
    } finally {
      fs.unlinkSync(tmpFile);
    }
  });

  test("parseItmsFile handles multi-document YAML from oc-mirror v2", () => {
    const fixtureFile = path.join(__dirname, "fixtures", "test-itms-multidoc.yaml");
    const sources = parseItmsFile(fixtureFile);

    // 1 from itms-release-0 + 4 from itms-generic-0
    assert.strictEqual(sources.length, 5);

    const ocpRelease = sources.find(s => s.source === "quay.io/openshift-release-dev/ocp-release");
    assert.ok(ocpRelease, "ocp-release tag source should be present");
    assert.deepStrictEqual(ocpRelease.mirrors, ["mirror.example.com:8443/openshift/release-images"]);

    const mathianasj = sources.find(s => s.source === "quay.io/mathianasj");
    assert.ok(mathianasj, "mathianasj source should be present");
    assert.deepStrictEqual(mathianasj.mirrors, ["mirror.example.com:8443/mathianasj"]);

    const amazon = sources.find(s => s.source === "docker.io/amazon");
    assert.ok(amazon, "docker.io/amazon source should be present");
    assert.deepStrictEqual(amazon.mirrors, ["mirror.example.com:8443/amazon"]);
  });
});

describe("loadMirrorSources", () => {
  test("loadMirrorSources combines IDMS and ITMS sources", () => {
    const idmsFile = path.join(__dirname, "fixtures", "test-idms.yaml");
    const itmsFile = path.join(__dirname, "fixtures", "test-itms.yaml");
    const sources = loadMirrorSources(idmsFile, itmsFile);

    assert.strictEqual(sources.length, 4); // 2 from IDMS + 2 from ITMS

    // Check IDMS sources
    assert.strictEqual(sources[0].source, "quay.io/openshift-release-dev/ocp-release");
    assert.strictEqual(sources[1].source, "quay.io/openshift-release-dev/ocp-v4.0-art-dev");

    // Check ITMS sources
    assert.strictEqual(sources[2].source, "registry.redhat.io/ubi9");
    assert.strictEqual(sources[3].source, "registry.redhat.io/rhel9");
  });

  test("loadMirrorSources works with only IDMS file", () => {
    const idmsFile = path.join(__dirname, "fixtures", "test-idms.yaml");
    const sources = loadMirrorSources(idmsFile, null);

    assert.strictEqual(sources.length, 2);
    assert.strictEqual(sources[0].source, "quay.io/openshift-release-dev/ocp-release");
  });

  test("loadMirrorSources works with only ITMS file", () => {
    const itmsFile = path.join(__dirname, "fixtures", "test-itms.yaml");
    const sources = loadMirrorSources(null, itmsFile);

    assert.strictEqual(sources.length, 2);
    assert.strictEqual(sources[0].source, "registry.redhat.io/ubi9");
  });

  test("loadMirrorSources returns empty array when both paths are null", () => {
    const sources = loadMirrorSources(null, null);
    assert.deepStrictEqual(sources, []);
  });

  test("loadMirrorSources handles missing files gracefully", () => {
    const sources = loadMirrorSources("/nonexistent/idms.yaml", "/nonexistent/itms.yaml");
    assert.deepStrictEqual(sources, []);
  });

  test("loadMirrorSources combines multi-document IDMS and ITMS (oc-mirror v2 output)", () => {
    const idmsFile = path.join(__dirname, "fixtures", "test-idms-multidoc.yaml");
    const itmsFile = path.join(__dirname, "fixtures", "test-itms-multidoc.yaml");
    const sources = loadMirrorSources(idmsFile, itmsFile);

    // 15 from IDMS (2 release + 13 operator) + 5 from ITMS (1 release + 4 generic)
    assert.strictEqual(sources.length, 20);

    // Verify the critical release mirror paths are correct (NOT /ocp-release defaults)
    const digestRelease = sources.find(
      s => s.source === "quay.io/openshift-release-dev/ocp-release" && s.mirrors[0].includes("/openshift/release-images")
    );
    assert.ok(digestRelease, "IDMS should have ocp-release → openshift/release-images");

    const digestArtDev = sources.find(
      s => s.source === "quay.io/openshift-release-dev/ocp-v4.0-art-dev" && s.mirrors[0].includes("/openshift/release")
    );
    assert.ok(digestArtDev, "IDMS should have ocp-v4.0-art-dev → openshift/release");

    // Verify no sources use the old default pattern
    const wrongDefaults = sources.filter(
      s => s.mirrors.some(m => m.endsWith("/ocp-release") || m.endsWith("/ocp-v4.0-art-dev"))
    );
    assert.strictEqual(wrongDefaults.length, 0, "No sources should use default /ocp-release or /ocp-v4.0-art-dev suffixes");
  });
});
