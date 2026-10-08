/**
 * Tranche 6 §14, §15, §17, §19 — HTTP boundaries, state import/export, generated
 * bundles and trust-bundle policy, across all three supported minors.
 *
 * The positive half is what the flip made possible: the same requests that
 * returned 422 for 4.22 before Tranche 5 must now succeed, produce a bundle
 * whose manifest reports 4.22.16, and carry no other minor's content.
 *
 * The negative half must be unchanged: 4.23 fails closed everywhere, persists
 * nothing, generates nothing, and leaks nothing.
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import yaml from "js-yaml";

import { app } from "../src/index.js";
import { setState } from "../src/utils.js";
import { createTestServer, closeTestServer } from "./helpers/httpServerLifecycle.js";
import { SUPPORTED_MINORS, getTrustBundlePolicies } from "../src/versionPolicy.js";
import { readFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { buildVersionManifest } from "../src/exportIntegrity.js";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

const PATCH = { "4.20": "4.20.40", "4.21": "4.21.35", "4.22": "4.22.16" };
const UNSUPPORTED = "4.23";

/** A complete, confirmed, generatable state at `minor`. */
function validState(minor, patch = PATCH[minor]) {
  return {
    _schemaVersion: 3,
    // `selectedVersion` is set deliberately. POST /api/state MERGES into the
    // persisted state, so a fixture that omits a version field inherits the
    // previous test's value and trips the Field Guide's version-coherence
    // guard. That guard is correct; see the recorded finding below.
    version: { _schemaVersion: 3, selectedMinor: minor, selectedPatch: patch, selectedChannel: `stable-${minor}`, selectedVersion: patch, locked: true },
    release: { channel: minor, patchVersion: patch, confirmed: true },
    blueprint: { platform: "Bare Metal", arch: "x86_64", clusterName: "cert-cluster", baseDomain: "example.com", confirmed: true },
    methodology: { method: "Agent-Based Installer" },
    credentials: { sshPublicKey: "ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAAB cert@test" },
    globalStrategy: {
      fips: false,
      networking: {
        networkType: "OVNKubernetes",
        machineNetworkV4: "10.90.0.0/24",
        clusterNetworkCidr: "10.128.0.0/14",
        clusterNetworkHostPrefix: 23,
        serviceNetworkCidr: "172.30.0.0/16",
      },
      mirroring: { registryFqdn: "registry.local:5000", sources: [] },
    },
    hostInventory: { nodes: [], ipStackMode: "ipv4" },
    operators: { selected: [], stale: false },
    trust: { additionalTrustBundlePolicy: "Proxyonly", mirrorRegistryCaPem: "", proxyCaPem: "" },
    exportOptions: { includeCredentials: false, includeCertificates: true },
  };
}

let server, baseUrl;
before(async () => { ({ server, baseUrl } = await createTestServer(app)); });
after(async () => { await closeTestServer(server); });

const postJson = (path, body) =>
  fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

/* ------------------------------------------------------------------ */
/* §19 — HTTP positive controls                                         */
/* ------------------------------------------------------------------ */

describe("T6 §19 — supported minors are ACCEPTED at every HTTP boundary", () => {
  for (const minor of SUPPORTED_MINORS) {
    describe(minor, () => {
      it("POST /api/state persists the state", async () => {
        const res = await postJson("/api/state", validState(minor));
        assert.ok(res.status < 400, `POST /api/state returned ${res.status}`);
        const back = await (await fetch(`${baseUrl}/api/state`)).json();
        assert.equal(back.version?.selectedMinor, minor);
        assert.equal(back.version?.selectedPatch, PATCH[minor]);
      });

      it("POST /api/generate returns artifacts naming this minor only", async () => {
        const res = await postJson("/api/generate", { state: validState(minor) });
        assert.equal(res.status, 200);
        const body = await res.text();
        assert.match(body, new RegExp(`stable-${minor.replace(".", "\\.")}`));
        for (const other of SUPPORTED_MINORS.filter((m) => m !== minor)) {
          assert.doesNotMatch(body, new RegExp(`stable-${other.replace(".", "\\.")}`), `leaked ${other}`);
        }
      });

      it("GET /api/generate works from persisted state", async () => {
        await postJson("/api/state", validState(minor));
        const res = await fetch(`${baseUrl}/api/generate`);
        assert.equal(res.status, 200);
      });

      it("POST /api/bundle.prepare is accepted", async () => {
        const res = await postJson("/api/bundle.prepare", { state: validState(minor) });
        assert.ok(res.status < 400, `bundle.prepare returned ${res.status}`);
      });

      it("POST /api/operators/confirm is accepted", async () => {
        await postJson("/api/state", validState(minor));
        const res = await postJson("/api/operators/confirm", { confirmed: true });
        assert.notEqual(res.status, 422, "a supported minor must not be refused as unsupported");
      });
    });
  }
});

/* ------------------------------------------------------------------ */
/* §15 — generated bundle identity                                      */
/* ------------------------------------------------------------------ */

describe("T6 §15 — real ZIP bundles for every supported minor", () => {
  for (const minor of SUPPORTED_MINORS) {
    it(`${minor} bundle builds, and its manifest reports ${PATCH[minor]}`, async () => {
      const res = await postJson("/api/bundle.zip", { state: validState(minor) });
      assert.equal(res.status, 200, `bundle.zip returned ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      assert.ok(buf.length > 0, "empty bundle");
      // PK zip local-file-header magic.
      assert.equal(buf.subarray(0, 2).toString("latin1"), "PK");

      const text = buf.toString("latin1");
      assert.ok(text.includes("version-manifest.json"), "manifest entry missing from the archive");
      assert.ok(text.includes("install-config.yaml"), "install-config missing from the archive");
    });
  }

  it("the manifest records the exact selected minor and patch, not a default", () => {
    // Built directly so the assertion is on content rather than on bytes inside
    // a compressed archive. This is the same function the ZIP route calls.
    const m = buildVersionManifest(validState("4.22"), { "install-config.yaml": "a".repeat(64) });
    assert.equal(m.openshift.selectedMinor, "4.22");
    assert.equal(m.openshift.selectedPatch, "4.22.16");
    assert.equal(m.openshift.lockedVersion, true);
    assert.equal(m.integrity.algorithm, "sha-256");
    assert.equal(m.integrity.format, "lowercase-hex");
  });

  it("checksums cover the files the manifest claims, and verify", () => {
    const content = "apiVersion: v1\n";
    const digest = createHash("sha256").update(content).digest("hex");
    const m = buildVersionManifest(validState("4.22"), { "install-config.yaml": digest });
    assert.equal(m.integrity.files["install-config.yaml"], digest);
    assert.match(m.integrity.files["install-config.yaml"], /^[0-9a-f]{64}$/);
  });

  it("a 4.22 manifest never reports another minor", () => {
    const m = JSON.stringify(buildVersionManifest(validState("4.22"), {}));
    assert.doesNotMatch(m, /4\.21/);
    assert.doesNotMatch(m, /4\.20/);
  });

  it("the default bundle carries no credential material", async () => {
    // The canary is generated at RUNTIME with an unmistakably synthetic marker,
    // following the convention in credential-canary-surfaces.test.js. A literal
    // base64 credential in source would be flagged by the secret scanner — and
    // correctly so, which is the point of the scanner.
    const canary = Buffer.from(`OAA_SYNTH_CANARY_BUNDLE_${Date.now()}`).toString("base64");
    const st = validState("4.22");
    st.credentials = {
      ...st.credentials,
      usingMirrorRegistry: true,
      mirrorRegistryPullSecret: JSON.stringify({ auths: { "registry.local:5000": { auth: canary } } }),
    };
    st.exportOptions = { includeCredentials: false, includeCertificates: true };
    const res = await postJson("/api/bundle.zip", { state: st });
    assert.equal(res.status, 200);
    const text = Buffer.from(await res.arrayBuffer()).toString("latin1");
    assert.ok(!text.includes(canary), "credential canary leaked into the default bundle");
  });
});

/* ------------------------------------------------------------------ */
/* §14 — state import / export                                          */
/* ------------------------------------------------------------------ */

describe("T6 §14 — state export/import round-trips at every supported minor", () => {
  for (const minor of SUPPORTED_MINORS) {
    it(`${minor}: export, re-import and generate again`, async () => {
      await postJson("/api/state", validState(minor));
      const exported = await (await fetch(`${baseUrl}/api/run/export`)).json();
      assert.ok(exported, "export produced nothing");

      const payload = exported.state ? exported : { state: exported };
      const imp = await postJson("/api/run/import", payload);
      assert.ok(imp.status < 400, `re-import returned ${imp.status}`);

      const back = await (await fetch(`${baseUrl}/api/state`)).json();
      assert.equal(back.version?.selectedMinor, minor, "round-trip changed the minor");

      const gen = await fetch(`${baseUrl}/api/generate`);
      assert.equal(gen.status, 200, "generation must still work after a round trip");
    });
  }

  it("an exported 4.22 state declares 4.22 and nothing older", async () => {
    await postJson("/api/state", validState("4.22"));
    const exported = await (await fetch(`${baseUrl}/api/run/export`)).json();
    const blob = JSON.stringify(exported.state ?? exported);
    assert.match(blob, /4\.22/);
    assert.doesNotMatch(blob, /"selectedMinor":"4\.21"/);
    assert.doesNotMatch(blob, /"selectedMinor":"4\.20"/);
  });
});

describe("T6 §14 — a legacy v2-shaped import that declares 4.22", () => {
  /**
   * The shape the E2E suite and real saved runs use: `schemaVersion: 2` with
   * `release.channel` / `version.selectedChannel` / `version.selectedVersion`
   * but NO canonical `version.selectedMinor`. Migration must resolve the minor
   * from those legacy sources and arrive at 4.22 — not fall back, not refuse.
   */
  const legacyShaped = (minor, patch) => {
    const st = validState(minor, patch);
    delete st.version.selectedMinor;
    delete st.version.selectedPatch;
    delete st.version._schemaVersion;
    st.version.selectedVersion = patch;
    return st;
  };

  const importLegacy = (st) => postJson("/api/run/import", { schemaVersion: 2, state: st });

  for (const minor of SUPPORTED_MINORS) {
    it(`${minor}: migrates, persists and generates its own channel`, async () => {
      const res = await importLegacy(legacyShaped(minor, PATCH[minor]));
      assert.equal(res.status, 200, `legacy import of ${minor} returned ${res.status}`);

      const back = await (await fetch(`${baseUrl}/api/state`)).json();
      const resolved = back.version?.selectedMinor ?? back.release?.channel;
      assert.equal(resolved, minor, "migration resolved the wrong minor");

      const gen = await postJson("/api/generate", {});
      assert.equal(gen.status, 200);
      const body = await gen.text();
      assert.match(body, new RegExp(`stable-${minor.replace(".", "\\.")}`));
      for (const other of SUPPORTED_MINORS.filter((m) => m !== minor)) {
        assert.doesNotMatch(body, new RegExp(`stable-${other.replace(".", "\\.")}`), `leaked ${other}`);
      }
    });
  }

  it("a legacy-shaped 4.23 import is refused and the prior state survives", async () => {
    await importLegacy(legacyShaped("4.22", "4.22.16"));
    const res = await importLegacy(legacyShaped(UNSUPPORTED, "4.23.0"));
    assert.equal(res.status, 422);
    const back = await (await fetch(`${baseUrl}/api/state`)).json();
    const resolved = back.version?.selectedMinor ?? back.release?.channel;
    assert.equal(resolved, "4.22", "a rejected legacy import overwrote good state");
  });
});

/* ------------------------------------------------------------------ */
/* §14 / §19 — 4.23 negative controls                                   */
/* ------------------------------------------------------------------ */

describe("T6 §19 — 4.23 fails closed, persists nothing, generates nothing", () => {
  it("a good 4.22 state survives every rejected 4.23 attempt", async () => {
    await postJson("/api/state", validState("4.22"));

    const attempts = [
      ["/api/state", validState(UNSUPPORTED, "4.23.0")],
      ["/api/generate", { state: validState(UNSUPPORTED, "4.23.0") }],
      ["/api/bundle.prepare", { state: validState(UNSUPPORTED, "4.23.0") }],
      ["/api/bundle.zip", { state: validState(UNSUPPORTED, "4.23.0") }],
    ];

    for (const [path, body] of attempts) {
      const res = await postJson(path, body);
      assert.equal(res.status, 422, `${path} must return 422 for 4.23, got ${res.status}`);
      const text = await res.text();
      assert.match(text, /UNSUPPORTED_VERSION/, `${path} must use the stable error code`);
      assert.doesNotMatch(text, /apiVersion: v1/, `${path} produced YAML for an unsupported minor`);
      assert.doesNotMatch(text, /ssh-rsa AAAAB3/, `${path} echoed credential material`);
    }

    const back = await (await fetch(`${baseUrl}/api/state`)).json();
    assert.equal(back.version?.selectedMinor, "4.22", "a rejected 4.23 attempt polluted the database");
    assert.equal(back.version?.selectedPatch, "4.22.16");
  });

  it("4.23 never falls back to 4.22 in an error body", async () => {
    const res = await postJson("/api/generate", { state: validState(UNSUPPORTED, "4.23.0") });
    const body = await res.json();
    assert.equal(body.code, "UNSUPPORTED_VERSION");
    assert.equal(body.requestedVersion, "4.23");
    assert.deepEqual([...body.supportedVersions].sort(), [...SUPPORTED_MINORS].sort());
  });

  it("a future state schema version is blocked at the persistence boundary", async () => {
    // The canonical marker is `version._schemaVersion` (CLAUDE.md, Version
    // State Invariants). shared/stateMigration.js keys off exactly that.
    await postJson("/api/state", validState("4.22"));
    const bad = validState("4.22");
    bad.version = { ...bad.version, _schemaVersion: 99 };
    const res = await postJson("/api/state", bad);
    assert.ok(res.status >= 400, `a future schema version must not persist (got ${res.status})`);
    const body = await res.text();
    assert.match(body, /migration|schema/i);

    const back = await (await fetch(`${baseUrl}/api/state`)).json();
    assert.equal(back.version?._schemaVersion, 3, "the rejected schema version polluted the state");
    assert.equal(back.version?.selectedMinor, "4.22");
  });

  it("an imported bundle declaring 4.23 is rejected and persists nothing", async () => {
    await postJson("/api/state", validState("4.21"));
    const res = await postJson("/api/run/import", { state: validState(UNSUPPORTED, "4.23.0") });
    assert.ok(res.status >= 400, `import of a 4.23 state returned ${res.status}`);
    const back = await (await fetch(`${baseUrl}/api/state`)).json();
    assert.equal(back.version?.selectedMinor, "4.21", "rejected import polluted the state");
  });
});

/* ------------------------------------------------------------------ */
/* §17 — trust-bundle policy                                            */
/* ------------------------------------------------------------------ */

describe("T6 §17 — trust-bundle policy across the three supported minors", () => {
  // The backend module owns the POLICY LIST. The `source` / "not yet fully
  // reflected" notice is a UI concern and lives only in the frontend twin,
  // where it is certified separately (trustBundlePolicy.test.js and the
  // flip-surface inventory P9). Here the backend half is certified: the
  // explicit per-minor row exists in BOTH modules, and the policies resolve.
  const policySrc = {
    backend: readFileSync(join(REPO_ROOT, "backend", "src", "versionPolicy.js"), "utf8"),
    frontend: readFileSync(join(REPO_ROOT, "frontend", "src", "shared", "versionPolicy.js"), "utf8"),
  };
  const allowlistBlock = (src) =>
    src.slice(src.indexOf("TRUST_BUNDLE_POLICY_ALLOWLIST"), src.indexOf("};", src.indexOf("TRUST_BUNDLE_POLICY_ALLOWLIST")));

  for (const minor of SUPPORTED_MINORS) {
    it(`${minor} carries an EXPLICIT allowlist row in both policy modules`, () => {
      for (const [which, src] of Object.entries(policySrc)) {
        assert.match(allowlistBlock(src), new RegExp(`"${minor.replace(".", "\\.")}": \\["Proxyonly", "Always"\\]`), which);
      }
      assert.deepEqual(getTrustBundlePolicies(PATCH[minor]), ["Proxyonly", "Always"]);
    });
  }

  it("4.23 has NO explicit row and does not inherit 4.22's", () => {
    for (const [which, src] of Object.entries(policySrc)) {
      assert.doesNotMatch(allowlistBlock(src), /"4\.23"/, which);
    }
    // The >=4.17 forward rule still returns the right policy LIST for 4.23;
    // what 4.23 must not get is the explicit/supported treatment.
    assert.deepEqual(getTrustBundlePolicies("4.23.0"), ["Proxyonly", "Always"]);
  });

  it("a 4.22 generated artifact honours the selected trust policy", async () => {
    const st = validState("4.22");
    st.trust = { additionalTrustBundlePolicy: "Always", mirrorRegistryCaPem: "", proxyCaPem: "" };
    const res = await postJson("/api/generate", { state: st });
    assert.equal(res.status, 200);
    const body = await res.text();
    if (body.includes("additionalTrustBundlePolicy")) {
      assert.match(body, /additionalTrustBundlePolicy[^\n]*Always/);
    }
  });
});

/* ------------------------------------------------------------------ */
/* Recorded finding — version-source coherence, NOT a 4.22 issue        */
/* ------------------------------------------------------------------ */

describe("T6A §4 — a version-incoherent state is a CLIENT error, not a server fault", () => {
  /**
   * F1, corrected in Tranche 6A.
   *
   * `POST /api/state` merges. A client that posts a partial version block can
   * leave `version.selectedVersion` pointing at a different minor than
   * `selectedMinor`. The Field Guide's coherence guard refuses — correctly: no
   * YAML, no guide, no silent pick between the two minors.
   *
   * Tranche 6 recorded that this surfaced as **HTTP 500**. `FIELD_GUIDE_VERSION_ERROR`
   * was simply absent from each route's error-mapping chain and fell through to
   * the default. It now maps to 400 alongside `CONFIGURATION_VALIDATION`, the
   * existing validation convention — no new taxonomy, and the error keeps its
   * own stable code.
   *
   * Reachability, measured: NOT reachable through a normal version transition
   * (a coherent patch is written) and NOT through import (migration produces a
   * coherent state). Reachable through a partial `/api/state` POST and through
   * a directly supplied incoherent `/api/generate` body — both client-controlled.
   */
  const incoherent = (minor, strayPatch) => {
    const st = validState(minor);
    st.version = { ...st.version, selectedVersion: strayPatch };
    return st;
  };

  const STRAY = { "4.20": "4.22.16", "4.21": "4.20.40", "4.22": "4.21.35" };

  for (const minor of SUPPORTED_MINORS) {
    it(`${minor}: POST /api/generate returns 400 with the stable code, not 500`, async () => {
      const res = await postJson("/api/generate", { state: incoherent(minor, STRAY[minor]) });
      assert.equal(res.status, 400, `expected 400, got ${res.status}`);
      const body = await res.json();
      assert.equal(body.code, "FIELD_GUIDE_VERSION_ERROR");
      assert.match(body.error, /version conflict/i);
    });

    it(`${minor}: the response is deterministic and leaks nothing`, async () => {
      const first = await (await postJson("/api/generate", { state: incoherent(minor, STRAY[minor]) })).text();
      const second = await (await postJson("/api/generate", { state: incoherent(minor, STRAY[minor]) })).text();
      assert.equal(first, second, "the same bad input must produce the same response");
      assert.doesNotMatch(first, /ssh-rsa/, "no credential material");
      assert.doesNotMatch(first, /registry\.local:5000/, "no unrelated state dumped");
      assert.doesNotMatch(first, /\bat \/|node_modules|\.js:\d+/, "no stack trace");
    });

    it(`${minor}: no artifact is produced`, async () => {
      const body = await (await postJson("/api/generate", { state: incoherent(minor, STRAY[minor]) })).text();
      assert.doesNotMatch(body, /apiVersion: v1/);
      assert.doesNotMatch(body, /imageDigestSources/);
      assert.ok(!JSON.parse(body).files, "no files key may be returned");
    });

    it(`${minor}: bundle.zip — the artifact-producing route — uses the same convention`, async () => {
      const res = await postJson("/api/bundle.zip", { state: incoherent(minor, STRAY[minor]) });
      assert.equal(res.status, 400, `bundle.zip returned ${res.status}`);
      assert.equal((await res.json()).code, "FIELD_GUIDE_VERSION_ERROR");
    });

    it(`${minor}: bundle.prepare issues only a token and never an artifact`, async () => {
      // prepare is the token-issuing phase: it migrates and checks SUPPORT,
      // then hands back a token. It does not generate, so it does not reach
      // the coherence guard — and correctly returns 200 while producing
      // nothing. The fail-closed boundary is bundle.zip, above, which is where
      // artifacts are actually built.
      const res = await postJson("/api/bundle.prepare", { state: incoherent(minor, STRAY[minor]) });
      const body = await res.text();
      assert.doesNotMatch(body, /apiVersion: v1/, "prepare must never emit an artifact");
      assert.doesNotMatch(body, /imageDigestSources/);
      if (res.status === 200) assert.match(body, /"token"/, "a 200 from prepare is a token, nothing more");
    });
  }

  it("the merge path that creates this state returns 400, and persists no artifact", async () => {
    await postJson("/api/state", validState("4.21"));
    const partial = validState("4.20");
    delete partial.version.selectedVersion; // inherit the stale 4.21.35
    await postJson("/api/state", partial);

    const res = await fetch(`${baseUrl}/api/generate`);
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.code, "FIELD_GUIDE_VERSION_ERROR");
    assert.ok(!body.files);
  });

  it("no 500 is reachable from any incoherent client state on these routes", async () => {
    const shapes = [
      incoherent("4.22", "4.21.35"),
      incoherent("4.20", "4.22.16"),
      { ...validState("4.22"), release: { ...validState("4.22").release, channel: "4.20" } },
    ];
    for (const st of shapes) {
      // Every route: never a server fault. Artifact-producing routes
      // additionally must refuse with a 4xx.
      for (const route of ["/api/generate", "/api/bundle.prepare", "/api/bundle.zip"]) {
        const res = await postJson(route, { state: st });
        assert.notEqual(res.status, 500, `${route} returned a server fault for client input`);
      }
      for (const route of ["/api/generate", "/api/bundle.zip"]) {
        const res = await postJson(route, { state: st });
        assert.ok(res.status >= 400 && res.status < 500, `${route} returned ${res.status}`);
      }
    }
  });

  it("a coherent state at every supported minor still generates normally", async () => {
    // The fix must not turn a good state into a client error.
    for (const minor of SUPPORTED_MINORS) {
      await postJson("/api/state", validState(minor));
      const res = await fetch(`${baseUrl}/api/generate`);
      assert.equal(res.status, 200, `${minor} must generate from a coherent state`);
    }
  });

  it("UNSUPPORTED_VERSION still maps to 422 — the conventions stay distinct", () => {
    // Guards the obvious over-correction: collapsing everything into 400.
    return postJson("/api/generate", { state: validState(UNSUPPORTED, "4.23.0") }).then(async (res) => {
      assert.equal(res.status, 422);
      assert.equal((await res.json()).code, "UNSUPPORTED_VERSION");
    });
  });
});
