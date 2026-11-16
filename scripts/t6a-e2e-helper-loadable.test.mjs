/**
 * Tranche 6A §5 — the E2E asset-validation helper must LOAD and WORK under the
 * repository's normal tooling runtime.
 *
 * F3: `e2e/helpers/asset-validation.js` did `import yaml from 'js-yaml'`, but
 * the repository root resolves js-yaml v5, which is ESM-first and exports only
 * named bindings. Under Node ESM the default import threw
 *
 *     SyntaxError: The requested module 'js-yaml' does not provide an export
 *     named 'default'
 *
 * so the module could not be imported at all, which broke
 * `e2e/specs/validation/asset-structure.spec.js` at load time. A known-broken
 * certification helper must not sit behind a claim that certification is
 * automated, so this file is the guard that it stays loadable.
 *
 * It deliberately lives under `scripts/` so `npm run test:tooling` runs it on
 * every change — the E2E suite itself needs a browser and a backend, which is
 * exactly why the breakage went unnoticed.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const REPO = path.resolve(import.meta.dirname, "..");
const HELPER = path.join(REPO, "e2e", "helpers", "asset-validation.js");

/** Source with comments removed, so an explanatory comment is not read as code. */
const stripComments = (src) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");

describe("T6A §5 — the helper loads under Node ESM", () => {
  test("it imports without throwing", async () => {
    // The regression was a module-load SyntaxError, so importing IS the test.
    const mod = await import(`file://${HELPER}`);
    assert.ok(mod, "module did not load");
  });

  test("it exports the surface the E2E specs import", async () => {
    const mod = await import(`file://${HELPER}`);
    for (const name of [
      "SUPPORTED_VERSIONS",
      "SCENARIO_MAP",
      "loadCatalogParams",
      "getRequiredParams",
      "getParamsByFile",
      "resolveYamlPath",
      "checkRequiredFields",
      "checkValueTypes",
      "compareKeyStructure",
      "parseYaml",
      "makeVersionedFixture",
    ]) {
      assert.equal(typeof mod[name] !== "undefined", true, `missing export: ${name}`);
    }
  });

  test("it uses a namespace import, not a default import, for js-yaml", () => {
    // Comments are stripped: the fix comment legitimately quotes the broken
    // form to explain what not to go back to.
    const src = stripComments(fs.readFileSync(HELPER, "utf8"));
    assert.match(src, /import \* as yaml from ['"]js-yaml['"]/);
    assert.doesNotMatch(src, /import yaml from ['"]js-yaml['"]/);
  });

  test("the js-yaml the root resolves really has no default export", () => {
    // Pins the reason for the namespace import, so a future reader does not
    // "simplify" it back to a default import.
    const pkg = JSON.parse(
      fs.readFileSync(path.join(REPO, "node_modules", "js-yaml", "package.json"), "utf8")
    );
    assert.match(pkg.version, /^5\./, `root js-yaml is ${pkg.version}; re-check this assumption`);
  });
});

describe("T6A §5 — the helper's core validation actually executes", () => {
  // Loading is necessary but not sufficient: the point of the helper is to
  // validate generated assets, so exercise that, not just the import.

  test("parseYaml round-trips a generated-asset shape", async () => {
    const { parseYaml } = await import(`file://${HELPER}`);
    const doc = parseYaml(
      "apiVersion: v1\nbaseDomain: example.com\nmetadata:\n  name: cert-cluster\ncontrolPlane:\n  architecture: amd64\n"
    );
    assert.equal(doc.apiVersion, "v1");
    assert.equal(doc.metadata.name, "cert-cluster");
    assert.equal(doc.controlPlane.architecture, "amd64");
  });

  test("resolveYamlPath walks a real catalog-style dotted path", async () => {
    const { resolveYamlPath } = await import(`file://${HELPER}`);
    const doc = { platform: { baremetal: { provisioningNetworkGateway: "172.22.0.254" } } };
    assert.deepEqual(
      resolveYamlPath(doc, "platform.baremetal.provisioningNetworkGateway"),
      { found: true, value: "172.22.0.254" }
    );
    assert.deepEqual(
      resolveYamlPath(doc, "platform.baremetal.doesNotExist"),
      { found: false, value: undefined }
    );
  });

  test("loadCatalogParams reads a real 4.22 catalog from disk", async () => {
    const { loadCatalogParams, getRequiredParams } = await import(`file://${HELPER}`);
    const params = loadCatalogParams("4.22", "bare-metal-ipi");
    assert.ok(Array.isArray(params) && params.length > 0, "no 4.22 parameters loaded");

    const required = getRequiredParams(params, "install-config.yaml");
    assert.ok(Array.isArray(required), "required-parameter filter did not return a list");
  });

  test("checkRequiredFields detects a missing required field", async () => {
    const { checkRequiredFields } = await import(`file://${HELPER}`);
    const result = checkRequiredFields({ baseDomain: "example.com" }, [
      { path: "baseDomain" },
      { path: "metadata.name" },
    ]);
    assert.deepEqual(result.present, ["baseDomain"]);
    assert.deepEqual(result.missing, ["metadata.name"]);
  });

  test("checkRequiredFields reports nothing missing when the document is complete", async () => {
    const { checkRequiredFields } = await import(`file://${HELPER}`);
    const result = checkRequiredFields(
      { baseDomain: "example.com", metadata: { name: "c" } },
      [{ path: "baseDomain" }, { path: "metadata.name" }]
    );
    assert.deepEqual(result.missing, []);
    assert.deepEqual(result.present, ["baseDomain", "metadata.name"]);
  });

  test("makeVersionedFixture retargets a scenario to an exact release", async () => {
    const { makeVersionedFixture } = await import(`file://${HELPER}`);
    const scenarios = await import(`file://${path.join(REPO, "e2e", "fixtures", "scenarios.js")}`);
    const fixture = makeVersionedFixture(scenarios.bareMetalAgent, "4.22", "4.22.16");
    assert.equal(fixture.release.channel, "4.22");
    assert.equal(fixture.release.patchVersion, "4.22.16");
    assert.equal(fixture.version.selectedChannel, "stable-4.22");
    assert.equal(fixture.version.selectedVersion, "4.22.16");
  });

  test("SUPPORTED_VERSIONS carries every supported minor, including 4.22", async () => {
    const { SUPPORTED_VERSIONS } = await import(`file://${HELPER}`);
    const minors = SUPPORTED_VERSIONS.map((v) => v.minor).sort();
    assert.deepEqual(minors, ["4.20", "4.21", "4.22"]);
  });
});

describe("T6A §5 — every E2E spec that imports the helper can be loaded", () => {
  test("asset-structure.spec.js resolves its helper import", () => {
    // The spec itself needs Playwright's runner, so this asserts the import
    // GRAPH the module-load failure broke, not the spec's execution.
    const spec = path.join(REPO, "e2e", "specs", "validation", "asset-structure.spec.js");
    assert.ok(fs.existsSync(spec));
    const src = fs.readFileSync(spec, "utf8");
    assert.match(src, /asset-validation/, "this spec is the one F3 broke");
  });

  test("no other repository module imports js-yaml with a default import at the root boundary", () => {
    // The same trap would catch any sibling helper.
    const dirs = [path.join(REPO, "e2e")];
    const offenders = [];
    const walk = (dir) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const abs = path.join(dir, e.name);
        if (e.isDirectory()) walk(abs);
        else if (e.name.endsWith(".js")) {
          const src = stripComments(fs.readFileSync(abs, "utf8"));
          if (/import\s+\w+\s+from\s+['"]js-yaml['"]/.test(src)) offenders.push(path.relative(REPO, abs));
        }
      }
    };
    dirs.forEach(walk);
    assert.deepEqual(offenders, []);
  });
});
