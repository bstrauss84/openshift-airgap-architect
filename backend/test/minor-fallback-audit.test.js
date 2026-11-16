/**
 * Support-flip fallback audit (Tranche 3, Workstream D).
 *
 * Enabling a new OpenShift minor has to be ATOMIC: every boundary flips in one
 * commit, and until it does, the new minor is rejected everywhere. A
 * hard-coded minor default undermines that, because an unresolvable version
 * stops being an error and quietly becomes an older minor's semantics.
 *
 * Not every `|| "4.20"` in the tree is that defect, and this file does not
 * pretend otherwise — the audit's classification is recorded in
 * `docs/minor-release/4.22/TRANCHE_3_RUNTIME_PREREQUISITES.md`. What is pinned
 * here is the set of boundaries where a default would be actively harmful:
 *
 *   - state migration, where an imported state's target minor is established;
 *   - generation, which must throw rather than pick a minor;
 *   - the Field Guide, which silently fell back to 4.20 once already;
 *   - the docs-index and catalog resolvers.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { migrateStateToV3 } from "../../shared/stateMigration.js";
import { buildInstallConfig, buildImageSetConfig, buildAgentConfig } from "../src/generate.js";
import { SUPPORTED_MINORS } from "../src/versionPolicy.js";
import { selectAndOrder } from "../src/fieldGuide/assembler.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, "..", "..");

describe("state migration does not default an unreadable minor", () => {
  const v1 = (channel) => ({ release: { channel }, blueprint: { platform: "Bare Metal" } });

  test("a malformed channel is REJECTED, not defaulted to a minor", () => {
    for (const bad of ["latest", "4.x", "stable-mars", "4", "4.20.15"]) {
      const r = migrateStateToV3(v1(bad));
      assert.equal(r.migrated, null, `channel=${bad} must not migrate`);
      assert.match(r.error, /Invalid channel format/);
    }
  });

  test("a well-formed channel migrates to exactly that minor", () => {
    assert.equal(migrateStateToV3(v1("stable-4.21")).migrated.version.selectedMinor, "4.21");
    assert.equal(migrateStateToV3(v1("eus-4.20")).migrated.version.selectedMinor, "4.20");
  });

  test("migration PARSES an unsupported minor rather than rewriting it — support is enforced elsewhere", () => {
    // Rewriting 4.23 to a supported minor here would be the worst possible
    // fallback: an import would be silently retargeted. Migration records what
    // the state says; the generation and resolver boundaries reject it.
    assert.equal(migrateStateToV3(v1("stable-4.23")).migrated.version.selectedMinor, "4.23");
  });

  test("BEHAVIOURAL: an unsupported minor is never rewritten to 4.20 anywhere in the migrated state", () => {
    // The runnable counterpart to the source-grep below. The removed tail was
    // unreachable, so only a grep can prove its absence — but the property that
    // actually matters is behavioural, and this proves it: no part of a
    // migrated 4.23 state may come back as a supported minor.
    const out = migrateStateToV3(v1("stable-4.23")).migrated;
    assert.equal(out.version.selectedMinor, "4.23");
    const serialized = JSON.stringify(out);
    assert.doesNotMatch(serialized, /4\.20/, "no 4.20 may appear in a migrated 4.23 state");
    assert.doesNotMatch(serialized, /4\.21/, "nor 4.21");
  });

  test("BEHAVIOURAL: a malformed channel yields no state at all, rather than a defaulted one", () => {
    for (const bad of ["latest", "4.x", "stable-mars"]) {
      const r = migrateStateToV3(v1(bad));
      assert.equal(r.migrated, null, `${bad} must produce no migrated state`);
      // The message does mention 4.20, as a FORMAT EXAMPLE ("Expected format:
      // \"4.20\" or \"stable-4.20\""). That is not a default being applied —
      // the same distinction the versioned-copy guard draws with its FMT
      // category — so what is asserted is the absence of a state, not the
      // absence of the string.
      assert.match(String(r.error), /Invalid channel format/);
    }
  });

  test("the unreachable `|| '4.20'` tail is gone from the channel normalizer", () => {
    const src = fs.readFileSync(path.join(REPO, "shared", "stateMigration.js"), "utf8");
    const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    assert.doesNotMatch(code, /\|\|\s*['"]4\.\d+['"]/);
  });

  test("RETAINED, documented: a legacy state with NO channel at all still migrates to 4.20", () => {
    // Audited and deliberately left alone in Tranche 3. It is not flip-blocking:
    // it fires only when a v1/v2 state carries neither a channel nor a
    // selectedMinor, so a 4.23 state can never reach it, and 4.23 therefore
    // cannot inherit 4.20 semantics through this path. Removing it would change
    // which legacy bundles import successfully — 4.20/4.21 behaviour this
    // tranche must not alter. Pinned here so the pre-flip review sees it as a
    // decision rather than discovering it as a surprise.
    assert.equal(migrateStateToV3(v1(undefined)).migrated.version.selectedMinor, "4.20");
  });

  test("...but a v2 state's own selectedMinor always wins over that default", () => {
    const v2 = { _schemaVersion: 2, version: { selectedMinor: "4.21" }, release: {}, blueprint: {} };
    assert.equal(migrateStateToV3(v2).migrated.version.selectedMinor, "4.21");
  });
});

describe("generation throws rather than choosing a minor", () => {
  const noVersion = { _schemaVersion: 3, blueprint: { platform: "Bare Metal" }, operators: { selected: [] } };

  test("buildInstallConfig throws UNSUPPORTED_VERSION with a null requestedVersion", () => {
    assert.throws(
      () => buildInstallConfig(noVersion),
      (e) => e.code === "UNSUPPORTED_VERSION" && e.requestedVersion === null
    );
  });

  test("buildImageSetConfig throws UNSUPPORTED_VERSION with a null requestedVersion", () => {
    assert.throws(
      () => buildImageSetConfig({ ...noVersion, imagesetConfig: {} }),
      (e) => e.code === "UNSUPPORTED_VERSION" && e.requestedVersion === null
    );
  });

  test("agent-config is gated at the HTTP boundary, not inside the builder", () => {
    // AUDITED, and correct as-is. buildAgentConfig() carries no version
    // assertion and no version-dependent content — the accepted 4.21 -> 4.22
    // mechanical delta records ZERO agent-config deltas of any class. It is an
    // internal builder: both callers in index.js run
    // assertSupportedOpenShiftMinorForGeneration() first, so an unsupported
    // minor is rejected before it is reached. Pinned so that contract stays
    // visible if a third caller is ever added.
    assert.doesNotThrow(() => buildAgentConfig(noVersion), "builder itself is version-agnostic");
    const src = fs.readFileSync(path.join(REPO, "backend", "src", "index.js"), "utf8");
    for (const m of src.matchAll(/buildAgentConfig\(/g)) {
      const before = src.slice(0, m.index);
      assert.ok(
        /assertSupportedOpenShiftVersion\(|assertSupportedOpenShiftMinorForGeneration\(/.test(before.slice(-6000)),
        "every buildAgentConfig call site must be preceded by a supported-minor assertion"
      );
    }
  });

  test("an unsupported minor is rejected, not downgraded", () => {
    for (const minor of ["4.19", "4.23", "4.24"]) {
      const state = { _schemaVersion: 3, version: { selectedMinor: minor, selectedPatch: `${minor}.1` }, operators: { selected: [] }, imagesetConfig: {} };
      assert.throws(
        () => buildImageSetConfig(state),
        (e) => e.code === "UNSUPPORTED_VERSION" && e.requestedVersion === minor,
        `${minor} must be rejected by name`
      );
    }
  });
});

describe("the Field Guide has no default branch", () => {
  test("an unsupported minor throws instead of resolving", () => {
    for (const minor of ["4.19", "4.23", "4.24"]) {
      assert.throws(() => selectAndOrder(minor, {}), new RegExp(minor.replace(".", "\\.")));
    }
  });

  test("assembler.js contains no default case and no hard-coded minor default", () => {
    const src = fs.readFileSync(path.join(REPO, "backend", "src", "fieldGuide", "assembler.js"), "utf8");
    const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    assert.doesNotMatch(code, /\|\|\s*['"]4\.\d+['"]/);
    assert.doesNotMatch(code, /\?\?\s*['"]4\.\d+['"]/);
    assert.doesNotMatch(code, /\bdefault\s*:/);
  });

  test("every supported minor resolves, so the guard is not vacuous", () => {
    for (const minor of SUPPORTED_MINORS) {
      assert.ok(selectAndOrder(minor, {}).length > 0, `${minor} must resolve compartments`);
    }
  });
});

describe("versionPolicy itself carries no fallback", () => {
  test("backend versionPolicy has no hard-coded minor default", () => {
    const src = fs.readFileSync(path.join(REPO, "backend", "src", "versionPolicy.js"), "utf8");
    const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    assert.doesNotMatch(code, /\|\|\s*['"]4\.\d+['"]/);
  });

  test("the architecture resolver has no hard-coded minor default", () => {
    const src = fs.readFileSync(path.join(REPO, "shared", "archSupport.js"), "utf8");
    const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    assert.doesNotMatch(code, /\|\|\s*['"]4\.\d+['"]/);
    assert.doesNotMatch(code, /\?\?\s*['"]4\.\d+['"]/);
  });

  test("the provisioning-gateway validator has no hard-coded minor default", () => {
    const src = fs.readFileSync(path.join(REPO, "shared", "provisioningNetworkGateway.js"), "utf8");
    const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    assert.doesNotMatch(code, /\|\|\s*['"]4\.\d+['"]/);
  });
});
