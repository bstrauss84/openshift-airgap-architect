/**
 * Tranche 6 §7 — the D3 architecture guard holds on the CRAFTED HTTP route.
 *
 * `t4-d3-generation-matrix.test.js` already exercises all 144 cells (4.20, 4.21
 * and 4.22) through the exported builders, including hidden-cell rejection and
 * the stale/imported v2.0.0-era combination. The one route it does not take is
 * the HTTP one: a client that POSTs a state directly, bypassing the UI that
 * would never have offered the architecture in the first place.
 *
 * That is the route finding **G2** was really about — the UI was never the
 * problem, the unguarded non-UI boundary was. This file proves the guard is
 * still closed there after 4.22 became supported.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { app } from "../src/index.js";
import { setState } from "../src/utils.js";
import { createTestServer, closeTestServer } from "./helpers/httpServerLifecycle.js";
import { SUPPORTED_MINORS } from "../src/versionPolicy.js";
import { ARCHITECTURES } from "../../shared/archSupport.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = join(__dirname, "..", "..");

const archSupport = Object.fromEntries(
  SUPPORTED_MINORS.map((m) => [
    m,
    JSON.parse(readFileSync(join(REPO, "data", "arch-support", `${m}.json`), "utf8")),
  ])
);

const cellsAt = (minor, disposition) => {
  const out = [];
  for (const row of archSupport[minor].matrix) {
    for (const arch of ARCHITECTURES) {
      if (row.architectures[arch].disposition === disposition) out.push([row.scenarioId, arch]);
    }
  }
  return out;
};

const PLATFORM_FOR = {
  "bare-metal-ipi": ["Bare Metal", "IPI"],
  "bare-metal-agent": ["Bare Metal", "Agent-Based Installer"],
  "bare-metal-upi": ["Bare Metal", "UPI"],
  "vsphere-ipi": ["VMware vSphere", "IPI"],
  "vsphere-agent": ["VMware vSphere", "Agent-Based Installer"],
  "vsphere-upi": ["VMware vSphere", "UPI"],
  "nutanix-ipi": ["Nutanix", "IPI"],
  "aws-govcloud-ipi": ["AWS GovCloud", "IPI"],
  "aws-govcloud-upi": ["AWS GovCloud", "UPI"],
  "azure-government-ipi": ["Azure Government", "IPI"],
  "azure-government-upi": ["Azure Government", "UPI"],
  "ibm-cloud-ipi": ["IBM Cloud", "IPI"],
};

function craftedState(scenarioId, minor, patch, arch) {
  const [platform, method] = PLATFORM_FOR[scenarioId];
  return {
    _schemaVersion: 3,
    version: { _schemaVersion: 3, selectedMinor: minor, selectedPatch: patch, selectedChannel: `stable-${minor}`, locked: true },
    release: { channel: minor, patchVersion: patch, confirmed: true },
    blueprint: { platform, arch, clusterName: "crafted", baseDomain: "example.com", confirmed: true },
    methodology: { method },
    credentials: { sshPublicKey: "ssh-rsa AAAA test" },
    globalStrategy: {
      networking: {
        networkType: "OVNKubernetes",
        machineNetworkV4: "10.90.0.0/24",
        clusterNetworkCidr: "10.128.0.0/14",
        clusterNetworkHostPrefix: 23,
        serviceNetworkCidr: "172.30.0.0/16",
      },
      mirroring: { registryFqdn: "registry.local:5000", sources: [] },
    },
    hostInventory: { nodes: [] },
    exportOptions: { includeCredentials: false },
  };
}

/** A handful of hidden 4.22 cells, chosen to span platforms and architectures. */
const HIDDEN_422_SAMPLE = [
  ["vsphere-ipi", "aarch64"],
  ["aws-govcloud-ipi", "aarch64"],
  ["bare-metal-ipi", "ppc64le"],
  ["bare-metal-ipi", "s390x"],
  ["nutanix-ipi", "aarch64"],
];

describe("T6 §7 — the 4.22 D3 dataset is the authority and it is intact", () => {
  it("4.22 declares 12 scenarios and 48 cells", () => {
    assert.equal(archSupport["4.22"].matrix.length, 12);
    assert.equal(archSupport["4.22"].matrix.length * ARCHITECTURES.length, 48);
  });

  it("4.22 splits 15 supported / 33 hidden / 0 locked, with nothing unresolved", () => {
    assert.equal(cellsAt("4.22", "supported").length, 15);
    assert.equal(cellsAt("4.22", "hidden").length, 33);
    assert.equal(cellsAt("4.22", "locked").length, 0);
    assert.equal(cellsAt("4.22", "unknown").length, 0);
  });

  it("the sampled hidden cells really are hidden at 4.22", () => {
    const hidden = new Set(cellsAt("4.22", "hidden").map(([s, a]) => `${s}/${a}`));
    for (const [s, a] of HIDDEN_422_SAMPLE) {
      assert.ok(hidden.has(`${s}/${a}`), `${s}/${a} is not hidden at 4.22`);
    }
  });

  it("there are no LOCKED cells at any supported minor, so locked-override is vacuous", () => {
    // Recorded rather than asserted as a pass: the D3 contract has a `locked`
    // disposition, the dataset declares none, so "a locked cell cannot be
    // overridden" has nothing to exercise. If a locked cell is ever added this
    // test fails and the override contract must be certified for real.
    for (const m of SUPPORTED_MINORS) assert.equal(cellsAt(m, "locked").length, 0, m);
  });
});

describe("T6 §7 — crafted HTTP state cannot smuggle a hidden 4.22 architecture", () => {
  for (const [scenarioId, arch] of HIDDEN_422_SAMPLE) {
    it(`POST /api/generate refuses ${scenarioId} + ${arch} at 4.22`, async () => {
      const { server, baseUrl } = await createTestServer(app);
      try {
        const res = await fetch(`${baseUrl}/api/generate`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ state: craftedState(scenarioId, "4.22", "4.22.16", arch) }),
        });
        assert.notEqual(res.status, 200, "a hidden architecture must not generate");
        const body = await res.text();
        // No YAML may be produced for a refused architecture.
        assert.doesNotMatch(body, /apiVersion: v1/, "install-config leaked for a hidden cell");
        assert.doesNotMatch(body, /imageDigestSources/);
      } finally {
        await closeTestServer(server);
      }
    });
  }

  it("GET /api/generate refuses a seeded hidden-architecture 4.22 state", async () => {
    const { server, baseUrl } = await createTestServer(app);
    try {
      setState(craftedState("vsphere-ipi", "4.22", "4.22.16", "aarch64"));
      const res = await fetch(`${baseUrl}/api/generate`);
      assert.notEqual(res.status, 200);
      const body = await res.text();
      assert.doesNotMatch(body, /apiVersion: v1/);
    } finally {
      await closeTestServer(server);
    }
  });

  it("the refusal names the decision and dumps no state", async () => {
    const { server, baseUrl } = await createTestServer(app);
    try {
      const res = await fetch(`${baseUrl}/api/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ state: craftedState("vsphere-ipi", "4.22", "4.22.16", "aarch64") }),
      });
      const body = await res.text();
      assert.match(body, /aarch64/, "the error should name the architecture");
      assert.doesNotMatch(body, /ssh-rsa/, "no credential material in the error body");
      assert.doesNotMatch(body, /registry\.local:5000/, "no unrelated state dumped");
    } finally {
      await closeTestServer(server);
    }
  });
});

describe("T6 §7 — the same HTTP route still ACCEPTS supported 4.22 architectures", () => {
  // Without this the guard above could be passing for the wrong reason.
  const supported422 = cellsAt("4.22", "supported");

  it("4.22 offers exactly 15 supported cells", () => {
    assert.equal(supported422.length, 15);
  });

  it("POST /api/generate accepts a supported 4.22 cell and emits that architecture", async () => {
    const { server, baseUrl } = await createTestServer(app);
    try {
      const res = await fetch(`${baseUrl}/api/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ state: craftedState("bare-metal-ipi", "4.22", "4.22.16", "aarch64") }),
      });
      assert.equal(res.status, 200, "bare-metal-ipi + aarch64 is supported at 4.22");
      const body = await res.text();
      assert.match(body, /architecture: arm64/);
    } finally {
      await closeTestServer(server);
    }
  });

  it("every architecture offered at 4.22 is also offered at 4.20 and 4.21", () => {
    // The dataset is identical across minors; asserted so a future divergence
    // is a deliberate, visible change rather than a silent one.
    const key = (m) => cellsAt(m, "supported").map(([s, a]) => `${s}/${a}`).sort().join(",");
    assert.equal(key("4.22"), key("4.21"));
    assert.equal(key("4.22"), key("4.20"));
  });
});
