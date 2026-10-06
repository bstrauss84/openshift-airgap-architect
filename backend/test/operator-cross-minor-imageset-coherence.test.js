/**
 * OpenShift Airgap Architect - Operator Cross-Minor ImageSet Coherence
 *
 * The generated ImageSetConfiguration must agree with the reconciled operator
 * state the UI presents as currently selected:
 *
 *   - a reconciled operator (current-minor catalog + channel) IS emitted;
 *   - preserved-but-unreconciled intent is NOT emitted and is never fabricated;
 *   - a stale previous-minor catalog tag can never survive into output.
 *
 * Together with frontend/tests/selected-operators-visibility.test.jsx and the
 * App-level cross-minor test, this pins all three representations — Quick Pick,
 * Selected Operators, generated ImageSet — to the same canonical state.
 *
 * @author Bill Strauss
 *
 * Developed with AI assistance from Claude (Anthropic) and Cursor AI.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildImageSetConfig } from "../src/generate.js";
import yaml from "js-yaml";

const catalogFor = (minor) => `registry.redhat.io/redhat/redhat-operator-index:v${minor}`;

/** State shape the frontend persists after reconciling onto `minor`. */
const reconciledState = (minor) => ({
  release: { patchVersion: `${minor}.8`, channel: minor },
  version: { _schemaVersion: 3, selectedMinor: minor, selectedPatch: `${minor}.8`, locked: true },
  operators: {
    selected: [
      {
        name: "odf-operator",
        id: "odf-operator-redhat",
        displayName: "OpenShift Data Foundation",
        catalogImage: catalogFor(minor),
        defaultChannel: `stable-${minor}`,
        sources: ["odf"],
      },
    ],
    version: minor,
    scenarios: { odf: true },
    pendingScenarios: {},
  },
});

/** State shape right after a cross-minor invalidation, before any rescan. */
const intentOnlyState = (minor) => ({
  release: { patchVersion: `${minor}.8`, channel: minor },
  version: { _schemaVersion: 3, selectedMinor: minor, selectedPatch: `${minor}.8`, locked: true },
  operators: {
    selected: [
      { name: "odf-operator", id: "odf-operator-redhat", displayName: "OpenShift Data Foundation", sources: ["odf"] },
    ],
    version: null,
    scenarios: {},
    pendingScenarios: { odf: true },
  },
});

for (const minor of ["4.20", "4.21"]) {
  test(`buildImageSetConfig: emits a reconciled operator under the ${minor} catalog`, () => {
    const config = yaml.load(buildImageSetConfig(reconciledState(minor)));
    assert.equal(config.mirror.operators.length, 1);
    const entry = config.mirror.operators[0];
    assert.equal(entry.catalog, catalogFor(minor));
    assert.equal(entry.packages.length, 1);
    assert.equal(entry.packages[0].name, "odf-operator");
    assert.equal(entry.packages[0].channels[0].name, `stable-${minor}`);
  });

  test(`buildImageSetConfig: platform channel matches the reconciled minor (${minor})`, () => {
    const config = yaml.load(buildImageSetConfig(reconciledState(minor)));
    assert.equal(config.mirror.platform.channels[0].name, `stable-${minor}`);
  });

  test(`buildImageSetConfig: no other minor's catalog tag appears (${minor})`, () => {
    const out = buildImageSetConfig(reconciledState(minor));
    const otherMinor = minor === "4.20" ? "4.21" : "4.20";
    assert.ok(!out.includes(`operator-index:v${otherMinor}`), `must not contain v${otherMinor} catalog`);
  });

  test(`buildImageSetConfig: unreconciled intent is omitted, not fabricated (${minor})`, () => {
    const config = yaml.load(buildImageSetConfig(intentOnlyState(minor)));
    assert.deepEqual(config.mirror.operators, []);
  });
}

test("buildImageSetConfig: a stale previous-minor catalog tag is dropped", () => {
  // Locked on 4.20 while the selection still carries 4.21-resolved metadata.
  const state = reconciledState("4.20");
  state.operators.selected[0].catalogImage = catalogFor("4.21");
  state.operators.selected[0].defaultChannel = "stable-4.21";

  const out = buildImageSetConfig(state);
  const config = yaml.load(out);
  assert.deepEqual(config.mirror.operators, [], "stale cross-minor operator must not be emitted");
  assert.ok(!out.includes("operator-index:v4.21"), "stale 4.21 catalog must not appear");
});

test("buildImageSetConfig: mixed reconciled + unreconciled emits only the reconciled one", () => {
  const state = reconciledState("4.20");
  state.operators.selected.push({
    name: "unavailable-operator",
    id: "unavailable-operator-redhat",
    sources: ["odf"],
  });

  const config = yaml.load(buildImageSetConfig(state));
  assert.equal(config.mirror.operators.length, 1);
  assert.deepEqual(
    config.mirror.operators[0].packages.map((p) => p.name),
    ["odf-operator"]
  );
});
