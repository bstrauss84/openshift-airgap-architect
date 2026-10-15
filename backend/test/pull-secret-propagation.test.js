/**
 * The retained pull secret still reaches the generated install-config.
 *
 * Withdrawing the unauthenticated mounted-secret endpoint changed where the
 * Blueprint field's initial value comes from (the operator, not the server).
 * It must not change what happens to that value afterwards. This file pins
 * the downstream half of the chain:
 *
 *   Blueprint field (blueprintPullSecretEphemeral)
 *     -> on lock, when "Retain pull secret..." is ticked, App.jsx copies it to
 *        credentials.pullSecretPlaceholder
 *     -> buildInstallConfig emits it as install-config `pullSecret:`
 *
 * The frontend half of the chain is covered by
 * frontend/tests/pull-secret-manual-workflow-preserved.test.jsx.
 *
 * The three pull-secret concepts are kept apart deliberately: a manually
 * entered secret and a session-retained secret are the SAME value at
 * different points in the wizard, and both are distinct from the
 * backend-mounted credential, which is used server-side and never travels to
 * the browser. Only the mounted one changed.
 *
 * @author Bill Strauss
 *
 * Developed with AI assistance from Claude (Anthropic) and Cursor AI.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import yaml from "js-yaml";
import { buildInstallConfig } from "../src/generate.js";
import { baseStates } from "./fixtures/index.js";

// Generated at runtime, never written to tracked source. A realistic
// credential-shaped literal in the repository is itself a finding and makes
// the project's own gitleaks scan noisy — the same convention
// backend/test/credential-canary-surfaces.test.js follows.
const MARKER = `OAA_SYNTH_RETAINED_${crypto.randomBytes(9).toString("hex").toUpperCase()}`;
const RETAINED = JSON.stringify({
  auths: { "registry.redhat.io": { auth: MARKER, email: "op@example.invalid" } }
});

test("a retained pull secret is emitted into install-config when credentials are included", () => {
  const state = baseStates.minimal({
    credentials: { pullSecretPlaceholder: RETAINED },
    exportOptions: { includeCredentials: true }
  });

  const out = yaml.load(buildInstallConfig(state));
  const emitted = typeof out.pullSecret === "string" ? out.pullSecret : JSON.stringify(out.pullSecret);

  assert.ok(emitted.includes(MARKER),
    "the retained pull secret must reach install-config pullSecret");
  assert.ok(emitted.includes("registry.redhat.io"),
    "the Red Hat registry entry must be preserved");
});

test("the same secret is withheld when credentials are not included", () => {
  // The non-vacuity control for the test above: if pullSecret were always
  // populated, the assertion there would prove nothing about propagation.
  const state = baseStates.minimal({
    credentials: { pullSecretPlaceholder: RETAINED },
    exportOptions: { includeCredentials: false }
  });

  const out = yaml.load(buildInstallConfig(state));
  const emitted = typeof out.pullSecret === "string" ? out.pullSecret : JSON.stringify(out.pullSecret);

  assert.ok(!emitted.includes(MARKER),
    "a default export must not carry the operator's credential");
  assert.ok(emitted.includes("auths"),
    "install-config still needs a structurally valid empty pullSecret");
});

test("an empty retained secret yields a placeholder rather than malformed YAML", () => {
  const state = baseStates.minimal({
    credentials: { pullSecretPlaceholder: "" },
    exportOptions: { includeCredentials: true }
  });

  const out = yaml.load(buildInstallConfig(state));
  assert.ok(out.pullSecret, "pullSecret must always be present in install-config");
});
