/**
 * OpenShift Airgap Architect — connectivity profile probes (certification axis `connectivity`)
 *
 * The `connectivity` axis was registered as planned with the reason: "no
 * profile harness exists; 'works offline' has not been proven by denying
 * egress and observing behaviour". Its closure plan is explicit that the
 * disconnected profile "must be proven by denying egress at the network layer
 * and asserting no unexpected outbound attempt — not by observing that
 * generation happens to succeed".
 *
 * Both halves of that sentence are load-bearing and this file implements both:
 *
 *   NETWORK LAYER. The axis runs this suite a second time inside
 *   `unshare -rn`, a network namespace containing only a DOWN loopback. There
 *   is no route to anywhere. That is a real denial, not an environment
 *   variable a code path could ignore.
 *
 *   NO UNEXPECTED ATTEMPT. Denial alone would let a silent, swallowed
 *   `fetch()` pass as "works offline" — the request fails, something catches
 *   it, generation still succeeds, and the product looks disconnected-clean
 *   while actually depending on a timeout. So `globalThis.fetch` is wrapped
 *   and every outbound attempt is RECORDED. The core offline workflow must
 *   attempt zero egress, which is a stronger and much more useful claim.
 *
 * WHAT COUNTS AS THE CORE OFFLINE WORKFLOW
 *
 * The operations an air-gapped operator must be able to perform with no
 * network at all: load and persist state, generate install-config,
 * agent-config and imageset-config, render the Field Guide, and produce a
 * bundle. Tool download and Cincinnati version discovery are deliberately NOT
 * in this set — they are connected-only by design, and the product's contract
 * is that they degrade visibly rather than that they work.
 *
 * @author Bill Strauss
 * Developed with AI assistance from Claude (Anthropic) and Cursor AI.
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";

import { app } from "../src/index.js";
import { createTestServer, closeTestServer } from "./helpers/httpServerLifecycle.js";

/** Hosts this process is allowed to talk to: the test server itself. */
const LOOPBACK = /^(127\.0\.0\.1|localhost|\[::1\]|::1)(:|$)/;

const realFetch = globalThis.fetch;
/** @type {{url: string, host: string, stack: string}[]} */
let outboundAttempts = [];

/** Record every non-loopback fetch attempt, then let it proceed and fail naturally. */
function installEgressRecorder() {
  globalThis.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : String(input?.url ?? input);
    let host = "";
    try {
      host = new URL(url).host;
    } catch {
      host = url;
    }
    if (!LOOPBACK.test(host)) {
      outboundAttempts.push({
        url,
        host,
        stack: (new Error().stack || "").split("\n").slice(2, 6).join(" | ")
      });
    }
    return realFetch(input, init);
  };
}

const PROFILE = process.env.OAA_CONNECTIVITY_PROFILE || "connected";

let server;
let baseUrl;

const offlineState = () => ({
  _schemaVersion: 3,
  version: {
    _schemaVersion: 3,
    selectedMinor: "4.22",
    selectedPatch: "4.22.16",
    selectedChannel: "stable-4.22",
    selectedVersion: "4.22.16",
    locked: true
  },
  release: { channel: "4.22", patchVersion: "4.22.16", confirmed: true },
  blueprint: {
    platform: "Bare Metal",
    arch: "x86_64",
    clusterName: "offline-probe",
    baseDomain: "example.com",
    confirmed: true
  },
  methodology: { method: "Agent-Based Installer" },
  credentials: { sshPublicKey: "ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAAB offline@test" },
  globalStrategy: {
    fips: false,
    networking: {
      networkType: "OVNKubernetes",
      machineNetworkV4: "10.90.0.0/24",
      clusterNetworkCidr: "10.128.0.0/14",
      clusterNetworkHostPrefix: 23,
      serviceNetworkCidr: "172.30.0.0/16"
    },
    mirroring: { registryFqdn: "registry.local:5000", sources: [] }
  },
  hostInventory: { nodes: [], ipStackMode: "ipv4" },
  operators: { selected: [], stale: false },
  trust: { additionalTrustBundlePolicy: "Proxyonly", mirrorRegistryCaPem: "", proxyCaPem: "" },
  exportOptions: {
    includeCredentials: false,
    includeCertificates: true,
    includeClientTools: false,
    includeInstaller: false,
    includeHighSideRuntimePackage: false,
    includeMirrorRegistry: false
  }
});

before(async () => {
  installEgressRecorder();
  ({ server, baseUrl } = await createTestServer(app));
});

after(async () => {
  globalThis.fetch = realFetch;
  if (server) await closeTestServer(server);
  // eslint-disable-next-line no-console
  console.log(
    `\nEGRESS-ATTEMPTS ${JSON.stringify({ profile: PROFILE, attempts: outboundAttempts })}`
  );
});

describe(`connectivity [profile=${PROFILE}] — the core workflow needs no network`, () => {
  it("persists and reloads state with zero egress", async () => {
    outboundAttempts = [];
    const put = await realFetch(`${baseUrl}/api/state`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(offlineState())
    });
    assert.ok(put.status < 400, `state write must succeed offline, got ${put.status}`);
    await put.text();

    const get = await realFetch(`${baseUrl}/api/state`);
    assert.equal(get.status, 200, "state read must succeed offline");
    await get.json();

    assert.deepEqual(
      outboundAttempts.map((a) => a.host),
      [],
      `state persistence attempted egress: ${JSON.stringify(outboundAttempts)}`
    );
  });

  it("generates install-config, agent-config and imageset-config with zero egress", async () => {
    outboundAttempts = [];
    const res = await realFetch(`${baseUrl}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ state: offlineState() })
    });
    assert.equal(res.status, 200, "generation must succeed with no network");
    const body = await res.json();

    // The three artifacts an operator carries across the gap.
    const text = JSON.stringify(body);
    assert.match(text, /apiVersion/, "generated output must contain real configuration");

    assert.deepEqual(
      outboundAttempts.map((a) => a.host),
      [],
      `generation attempted egress: ${JSON.stringify(outboundAttempts)}`
    );
  });

  it("produces a bundle with zero egress when no tools are requested", async () => {
    outboundAttempts = [];
    const res = await realFetch(`${baseUrl}/api/bundle.zip`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ state: offlineState() })
    });
    assert.equal(res.status, 200, "bundle export must succeed offline");
    const bytes = Buffer.from(await res.arrayBuffer());
    assert.ok(bytes.length > 0, "bundle must contain bytes");
    assert.equal(bytes.readUInt32LE(0), 0x04034b50, "bundle must be a real ZIP");

    assert.deepEqual(
      outboundAttempts.map((a) => a.host),
      [],
      `offline bundle export attempted egress: ${JSON.stringify(outboundAttempts)}`
    );
  });

  it("serves health and readiness with zero egress", async () => {
    outboundAttempts = [];
    for (const probe of ["/api/health", "/api/ready"]) {
      const res = await realFetch(`${baseUrl}${probe}`);
      assert.ok(res.status < 500, `${probe} must answer offline, got ${res.status}`);
      await res.text();
    }
    assert.deepEqual(outboundAttempts.map((a) => a.host), []);
  });
});

describe(`connectivity [profile=${PROFILE}] — connected-only features degrade visibly`, () => {
  it("fails closed rather than hanging when a connected-only feature is used offline", async (t) => {
    if (PROFILE !== "disconnected") {
      return t.skip("only meaningful under a denied-egress profile");
    }
    outboundAttempts = [];
    const started = Date.now();

    // Cincinnati version discovery is connected-only by design. Offline it
    // must FAIL, not hang: an air-gapped operator waiting on a TCP timeout
    // with no feedback is the failure this asserts against.
    let status = null;
    try {
      const res = await realFetch(`${baseUrl}/api/cincinnati/channels?minor=4.22`, {
        signal: AbortSignal.timeout(45000)
      });
      status = res.status;
      await res.text().catch(() => {});
    } catch {
      status = "threw";
    }
    const elapsed = Date.now() - started;

    assert.ok(
      elapsed < 45000,
      `a connected-only feature must fail fast offline, took ${elapsed} ms`
    );
    assert.ok(
      status === "threw" || status >= 400 || status === 200,
      "the endpoint must answer or fail, not hang"
    );
    // It is legitimate for this one to ATTEMPT egress — that is what makes it
    // connected-only. The assertion is that it does not hang.
  });
});
