/**
 * DOC-227 — per-artifact generation isolation.
 *
 * THE DEFECT, as reported by a human. The YAML Preview showing
 * `imageset-config.yaml` was labelled "Preview not updated: NMState interface
 * name must not be empty." Operator and Quick Pick work could not be seen in
 * the imageset preview while an unrelated Agent host-networking error existed.
 *
 * ROOT CAUSE. `buildPreviewFiles` built the preview set as one straight
 * sequence (backend/src/index.js, pre-fix lines 3206-3220):
 *
 *     const installConfig  = buildInstallConfig(previewState);
 *     const agentConfig    = wantsAgentConfig ? buildAgentConfig(previewState) : null;
 *     const imageSetConfig = buildImageSetConfig(previewState);   // never reached
 *
 * `buildAgentConfig` → `buildNmState` throws "NMState interface name must not
 * be empty." (backend/src/generate.js:1989), the exception escapes the whole
 * function, POST /api/generate returns a single global error with NO files,
 * and App.jsx renders that one sentence over every pane.
 *
 * WHY THAT IS WRONG. `buildImageSetConfig` (generate.js:2070) reads
 * release/version, blueprint.arch, state.imagesetConfig and
 * state.operators.selected. It reads no interface name, no host IP, no bond,
 * no VLAN and no BMC field. There is no dependency to justify the coupling.
 *
 * THE FIX. `PREVIEW_ARTIFACTS` declares each previewed output with the state
 * slices it consumes, and `buildPreviewArtifacts(state, { isolate: true })`
 * builds each one inside its own boundary: success with content, or failure
 * with ITS OWN error. It is a general mechanism — nothing here keys off a
 * filename or an error string.
 *
 * PRE-FIX PROOF, in-suite and deterministic. `{ isolate: false }` is the
 * pre-fix code path, kept verbatim for Review/export and every existing API
 * consumer: same artifact order, first error rethrown unchanged, no files.
 * Every case below asserts BOTH modes on the SAME state, so the pre-fix
 * behaviour ("throws, no imageset at all") and the fixed behaviour ("imageset
 * present") are proven side by side rather than asserted from memory.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import yaml from "js-yaml";

import {
  PREVIEW_ARTIFACTS,
  buildPreviewArtifacts,
  buildPreviewFiles,
  app
} from "../src/index.js";
import { azureGovernmentIpi, bareMetalAgent } from "./fixtures/base-states.js";
import { createTestServer, closeTestServer } from "./helpers/httpServerLifecycle.js";

/* ------------------------------------------------------------------ */
/* Fixtures                                                            */
/* ------------------------------------------------------------------ */

const MINOR = "4.20";
const PATCH = "4.20.8";
const CATALOG = `registry.redhat.io/redhat/redhat-operator-index:v${MINOR}`;

const OPERATORS = {
  webTerminal: { name: "web-terminal", defaultChannel: "fast", catalogImage: CATALOG },
  nmstate: { name: "kubernetes-nmstate-operator", defaultChannel: "stable", catalogImage: CATALOG },
  serviceMesh: { name: "servicemeshoperator3", defaultChannel: "stable", catalogImage: CATALOG }
};

/**
 * One master whose PRIMARY interface is fine.
 *
 * The broken row is an ADDITIONAL `vlan-on-ethernet` with a blank VLAN id and
 * blank VLAN name, which is exactly how a half-filled host-networking row
 * reaches the generator from the node drawer. Verified against the shipped
 * generator (not assumed): it resolves to an empty interface name and
 * `buildNmState` raises the reported sentence verbatim.
 */
const brokenNmStateNode = () => ({
  role: "master",
  hostname: "master-0",
  primary: { type: "ethernet", mode: "dhcp", ethernet: { name: "eno1", macAddress: "52:54:00:aa:bb:01" } },
  additionalInterfaces: [
    { type: "vlan-on-ethernet", ethernet: { name: "eno2" }, vlan: { id: "", name: "" } }
  ]
});

const healthyNode = () => ({
  role: "master",
  hostname: "master-0",
  primary: { type: "ethernet", mode: "dhcp", ethernet: { name: "eno1", macAddress: "52:54:00:aa:bb:01" } },
  additionalInterfaces: [
    { type: "vlan-on-ethernet", ethernet: { name: "eno2" }, vlan: { id: "100", name: "eno2.100" } }
  ]
});

/**
 * Bare Metal / Agent-Based state with selectable host networking and
 * selectable operators — the two sides of the reported defect.
 */
const agentState = ({ node = brokenNmStateNode(), operators = [OPERATORS.webTerminal], arch = "x86_64", imagesetConfig } = {}) =>
  bareMetalAgent({
    version: { selectedMinor: MINOR, selectedPatch: PATCH, selectedChannel: `stable-${MINOR}`, locked: true },
    release: { channel: MINOR, patchVersion: PATCH, confirmed: true },
    blueprint: { arch },
    hostInventory: { nodes: [node], ipStackMode: "ipv4" },
    operators: { selected: operators },
    ...(imagesetConfig ? { imagesetConfig } : {})
  });

const isolated = (state) => buildPreviewArtifacts(state, { isolate: true });

/** Operator package names actually written into imageset-config.yaml. */
const imagesetOperatorNames = (files) => {
  const doc = yaml.load(files["imageset-config.yaml"]);
  return (doc?.mirror?.operators || []).flatMap((entry) => (entry.packages || []).map((p) => p.name));
};

const NMSTATE_SENTENCE = /NMState interface name must not be empty/;

/* ------------------------------------------------------------------ */
/* The mechanism itself                                                */
/* ------------------------------------------------------------------ */

describe("DOC-227: the preview set is built per artifact, not all-or-nothing", () => {
  it("declares every previewed output with the state it consumes", () => {
    const ids = PREVIEW_ARTIFACTS.map((a) => a.id);
    assert.deepStrictEqual(ids, [
      "install-config.yaml",
      "agent-config.yaml",
      "imageset-config.yaml",
      "ntp-machine-configs",
      "FIELD_MANUAL.md"
    ]);
    for (const artifact of PREVIEW_ARTIFACTS) {
      assert.ok(Array.isArray(artifact.outputs) && artifact.outputs.length, `${artifact.id} must name its outputs`);
      assert.ok(Array.isArray(artifact.dependsOn) && artifact.dependsOn.length, `${artifact.id} must declare dependencies`);
      assert.strictEqual(typeof artifact.build, "function");
    }
  });

  it("isolation is generic, not a rule about one filename or one error string", () => {
    /* A mechanism that special-cased imageset-config.yaml, or matched on the
       NMState sentence, would close the reported symptom and leave the defect.
       Neither appears in the isolation path. */
    const source = PREVIEW_ARTIFACTS.map((a) => String(a.build)).join("\n") + String(buildPreviewArtifacts);
    assert.ok(!/NMState/.test(source), "isolation must not mention a specific error");
    assert.ok(!/if\s*\(\s*[^)]*===\s*["']imageset-config\.yaml["']/.test(source), "isolation must not special-case a filename");
  });

  it("declared dependencies hold: imageset ignores host networking entirely", () => {
    /* How the dependency table was derived, asserted rather than asserted-to.
       Swapping the whole host inventory — interfaces, VLANs, addresses — must
       not move a byte of imageset-config.yaml. */
    const withBroken = isolated(agentState({ node: brokenNmStateNode() }));
    const withHealthy = isolated(agentState({ node: healthyNode() }));
    assert.strictEqual(
      withBroken.files["imageset-config.yaml"],
      withHealthy.files["imageset-config.yaml"]
    );
  });

  it("declared dependencies hold: install-config ignores operator selection", () => {
    const withOne = isolated(agentState({ node: healthyNode(), operators: [OPERATORS.webTerminal] }));
    const withThree = isolated(agentState({
      node: healthyNode(),
      operators: [OPERATORS.webTerminal, OPERATORS.nmstate, OPERATORS.serviceMesh]
    }));
    assert.strictEqual(
      withOne.files["install-config.yaml"],
      withThree.files["install-config.yaml"]
    );
    assert.notStrictEqual(
      withOne.files["imageset-config.yaml"],
      withThree.files["imageset-config.yaml"]
    );
  });
});

/* ------------------------------------------------------------------ */
/* CASE 1                                                              */
/* ------------------------------------------------------------------ */

describe("DOC-227 CASE 1: invalid Agent NMState + valid imageset state", () => {
  const state = agentState();

  it("PRE-FIX: the legacy all-or-nothing path throws and returns no files at all", () => {
    assert.throws(() => buildPreviewFiles(state), NMSTATE_SENTENCE);
  });

  it("imageset-config.yaml generates", () => {
    const { files } = isolated(state);
    assert.ok(files["imageset-config.yaml"], "imageset must be produced");
    const doc = yaml.load(files["imageset-config.yaml"]);
    assert.strictEqual(doc.kind, "ImageSetConfiguration");
    assert.strictEqual(doc.mirror.platform.channels[0].name, `stable-${MINOR}`);
  });

  it("the agent artifact is the one reported invalid, with its own error", () => {
    const { files, fileErrors } = isolated(state);
    assert.match(fileErrors["agent-config.yaml"].message, NMSTATE_SENTENCE);
    assert.strictEqual(fileErrors["agent-config.yaml"].artifact, "agent-config.yaml");
    assert.ok(!files["agent-config.yaml"], "a failed artifact must not be returned as content");
  });

  it("no other artifact inherits the NMState error", () => {
    const { fileErrors } = isolated(state);
    assert.deepStrictEqual(Object.keys(fileErrors), ["agent-config.yaml"]);
  });

  it("install-config.yaml also survives — it does not read NMState either", () => {
    const { files } = isolated(state);
    assert.ok(files["install-config.yaml"]);
  });
});

/* ------------------------------------------------------------------ */
/* CASES 2 and 3 — the user-visible point of the whole change          */
/* ------------------------------------------------------------------ */

describe("DOC-227 CASE 2: invalid NMState + add an operator", () => {
  const before = agentState({ operators: [OPERATORS.webTerminal] });
  const after = agentState({ operators: [OPERATORS.webTerminal, OPERATORS.serviceMesh] });

  it("PRE-FIX: neither selection produced an imageset at all", () => {
    assert.throws(() => buildPreviewFiles(before), NMSTATE_SENTENCE);
    assert.throws(() => buildPreviewFiles(after), NMSTATE_SENTENCE);
  });

  it("the imageset operators list updates while the NMState error stands", () => {
    assert.deepStrictEqual(imagesetOperatorNames(isolated(before).files), ["web-terminal"]);
    assert.deepStrictEqual(
      imagesetOperatorNames(isolated(after).files).sort(),
      ["servicemeshoperator3", "web-terminal"]
    );
    assert.match(isolated(after).fileErrors["agent-config.yaml"].message, NMSTATE_SENTENCE);
  });
});

describe("DOC-227 CASE 3: invalid NMState + remove an operator", () => {
  const before = agentState({ operators: [OPERATORS.webTerminal, OPERATORS.serviceMesh] });
  const after = agentState({ operators: [OPERATORS.serviceMesh] });

  it("PRE-FIX: neither selection produced an imageset at all", () => {
    assert.throws(() => buildPreviewFiles(before), NMSTATE_SENTENCE);
    assert.throws(() => buildPreviewFiles(after), NMSTATE_SENTENCE);
  });

  it("the removed operator leaves the imageset while the NMState error stands", () => {
    assert.ok(imagesetOperatorNames(isolated(before).files).includes("web-terminal"));
    const names = imagesetOperatorNames(isolated(after).files);
    assert.deepStrictEqual(names, ["servicemeshoperator3"]);
    assert.match(isolated(after).fileErrors["agent-config.yaml"].message, NMSTATE_SENTENCE);
  });
});

/* ------------------------------------------------------------------ */
/* CASE 4                                                              */
/* ------------------------------------------------------------------ */

describe("DOC-227 CASE 4: an invalid install/platform field unrelated to imageset", () => {
  /* Azure Government 4.21 BYO VNet with `virtualNetwork` missing. This is an
     install-config validation failure — nothing to do with mirroring. */
  const state = azureGovernmentIpi({
    version: { selectedMinor: "4.21", selectedPatch: "4.21.3", selectedChannel: "stable-4.21", locked: true },
    release: { channel: "4.21", patchVersion: "4.21.3", confirmed: true },
    platformConfig: {
      region: "usgovvirginia",
      azure: {
        region: "usgovvirginia",
        baseDomainResourceGroupName: "dns-rg",
        vnetMode: "existing-vnet",
        networkResourceGroupName: "net-rg",
        controlPlaneSubnet: "cp-subnet",
        nodeSubnets: ["worker"]
      }
    },
    operators: { selected: [{ ...OPERATORS.webTerminal, catalogImage: "registry.redhat.io/redhat/redhat-operator-index:v4.21" }] }
  });

  it("PRE-FIX: the install-config failure took the imageset down with it", () => {
    assert.throws(() => buildPreviewFiles(state), /Virtual network name is required/i);
  });

  it("imageset-config.yaml still generates", () => {
    const { files, fileErrors } = isolated(state);
    assert.ok(fileErrors["install-config.yaml"], "install-config must report its own failure");
    assert.ok(files["imageset-config.yaml"], "imageset must still be produced");
    assert.deepStrictEqual(imagesetOperatorNames(files), ["web-terminal"]);
  });

  it("the imageset pane is not told about a virtual network", () => {
    const { fileErrors } = isolated(state);
    assert.strictEqual(fileErrors["imageset-config.yaml"], undefined);
  });
});

/* ------------------------------------------------------------------ */
/* CASE 5                                                              */
/* ------------------------------------------------------------------ */

describe("DOC-227 CASE 5: genuinely invalid imageset-specific state", () => {
  /* `blueprint.arch` IS an imageset dependency: it becomes
     `mirror.platform.architectures`, and mirroring the wrong release payload
     is precisely the failure the architecture gate exists to prevent. The
     host networking is ALSO broken here on purpose, so the test proves the
     imageset pane reports its OWN reason rather than the loudest one. */
  const state = agentState({ arch: "s390x", node: brokenNmStateNode() });

  it("imageset generation fails", () => {
    const { files, fileErrors } = isolated(state);
    assert.ok(!files["imageset-config.yaml"]);
    assert.ok(fileErrors["imageset-config.yaml"]);
  });

  it("the error is the imageset's own, not a neighbour's", () => {
    const { fileErrors } = isolated(state);
    const message = fileErrors["imageset-config.yaml"].message;
    assert.match(message, /architecture/i);
    assert.match(message, /s390x/);
    assert.doesNotMatch(message, NMSTATE_SENTENCE);
    assert.strictEqual(fileErrors["imageset-config.yaml"].code, "UNSUPPORTED_ARCHITECTURE");
    assert.strictEqual(fileErrors["imageset-config.yaml"].artifact, "imageset-config.yaml");
  });

  it("the agent artifact still reports the NMState problem as its own", () => {
    const { fileErrors } = isolated(state);
    assert.match(fileErrors["agent-config.yaml"].message, NMSTATE_SENTENCE);
  });
});

/* ------------------------------------------------------------------ */
/* CASE 6                                                              */
/* ------------------------------------------------------------------ */

describe("DOC-227 CASE 6: repairing the NMState error", () => {
  const broken = agentState({ node: brokenNmStateNode() });
  const repaired = agentState({ node: healthyNode() });

  it("install and agent artifacts recover", () => {
    const after = isolated(repaired);
    assert.deepStrictEqual(after.fileErrors, {});
    assert.ok(after.files["agent-config.yaml"]);
    assert.ok(after.files["install-config.yaml"]);
    const doc = yaml.load(after.files["agent-config.yaml"].replace(/^#.*$/gm, ""));
    assert.strictEqual(doc.kind, "AgentConfig");
  });

  it("imageset content is unchanged, because none of its dependencies changed", () => {
    assert.strictEqual(
      isolated(broken).files["imageset-config.yaml"],
      isolated(repaired).files["imageset-config.yaml"]
    );
  });

  it("imageset content DOES change when one of its real dependencies changes", () => {
    const withMoreOperators = agentState({
      node: healthyNode(),
      operators: [OPERATORS.webTerminal, OPERATORS.nmstate]
    });
    assert.notStrictEqual(
      isolated(repaired).files["imageset-config.yaml"],
      isolated(withMoreOperators).files["imageset-config.yaml"]
    );
  });

  it("the legacy all-or-nothing path succeeds again once NMState is valid", () => {
    const files = buildPreviewFiles(repaired);
    assert.ok(files["agent-config.yaml"]);
    assert.ok(files["imageset-config.yaml"]);
  });
});

/* ------------------------------------------------------------------ */
/* Boundaries that must STILL fail closed for everything               */
/* ------------------------------------------------------------------ */

describe("DOC-227: global boundaries are not artifact-level and still fail the whole response", () => {
  it("an unsupported target minor fails every artifact, in both modes", () => {
    const state = agentState({ node: healthyNode() });
    state.version = { selectedMinor: "4.23", selectedPatch: "4.23.1", selectedChannel: "stable-4.23", locked: true };
    state.release = { channel: "4.23", patchVersion: "4.23.1", confirmed: true };
    assert.throws(() => buildPreviewFiles(state), (e) => e.code === "UNSUPPORTED_VERSION");
    assert.throws(() => buildPreviewArtifacts(state, { isolate: true }), (e) => e.code === "UNSUPPORTED_VERSION");
  });

  it("an unknown state schema fails every artifact, in both modes", () => {
    const base = agentState({ node: healthyNode() });
    const state = { ...base, version: { ...base.version, _schemaVersion: 99 } };
    assert.throws(() => buildPreviewFiles(state), /Generation failed/);
    assert.throws(() => buildPreviewArtifacts(state, { isolate: true }), /Generation failed/);
  });

  it("an unconfirmed version still returns null in both modes", () => {
    const state = agentState({ node: healthyNode() });
    state.version = { ...state.version, locked: false };
    state.release = { ...state.release, confirmed: false };
    assert.strictEqual(buildPreviewFiles(state), null);
    assert.strictEqual(buildPreviewArtifacts(state, { isolate: true }), null);
  });
});

/* ------------------------------------------------------------------ */
/* HTTP contract                                                       */
/* ------------------------------------------------------------------ */

describe("DOC-227: POST /api/generate contract", () => {
  const post = async (baseUrl, body) => {
    const res = await fetch(`${baseUrl}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    return { status: res.status, body: await res.json() };
  };

  it("without the flag, an NMState failure still fails the whole request (unchanged)", async () => {
    const { server, baseUrl } = await createTestServer(app);
    try {
      const { status, body } = await post(baseUrl, { state: agentState() });
      assert.strictEqual(status, 500);
      assert.ok(!body.files, "legacy callers must still get no files");
      assert.match(body.error, NMSTATE_SENTENCE);
      assert.strictEqual(body.fileErrors, undefined, "legacy response shape must be unchanged");
    } finally {
      await closeTestServer(server);
    }
  });

  it("with isolateArtifacts, the imageset comes back and the error is scoped", async () => {
    const { server, baseUrl } = await createTestServer(app);
    try {
      const { status, body } = await post(baseUrl, { state: agentState(), isolateArtifacts: true });
      assert.strictEqual(status, 200);
      assert.ok(body.files["imageset-config.yaml"]);
      assert.match(body.fileErrors["agent-config.yaml"].message, NMSTATE_SENTENCE);
      assert.strictEqual(body.fileErrors["imageset-config.yaml"], undefined);
      assert.strictEqual(body.fileErrors["install-config.yaml"], undefined);
    } finally {
      await closeTestServer(server);
    }
  });

  it("a fully valid state returns no fileErrors", async () => {
    const { server, baseUrl } = await createTestServer(app);
    try {
      const { status, body } = await post(baseUrl, { state: agentState({ node: healthyNode() }), isolateArtifacts: true });
      assert.strictEqual(status, 200);
      assert.deepStrictEqual(body.fileErrors, {});
      assert.ok(body.files["agent-config.yaml"]);
    } finally {
      await closeTestServer(server);
    }
  });

  it("isolation does not weaken the unsupported-target-version refusal", async () => {
    const { server, baseUrl } = await createTestServer(app);
    try {
      const state = agentState({ node: healthyNode() });
      state.version = { selectedMinor: "4.23", selectedPatch: "4.23.1", selectedChannel: "stable-4.23", locked: true };
      state.release = { channel: "4.23", patchVersion: "4.23.1", confirmed: true };
      const { status, body } = await post(baseUrl, { state, isolateArtifacts: true });
      assert.strictEqual(status, 422);
      assert.strictEqual(body.code, "UNSUPPORTED_VERSION");
      assert.ok(!body.files);
    } finally {
      await closeTestServer(server);
    }
  });
});

/* ------------------------------------------------------------------ */
/* The complete bundle must STAY blocked                               */
/* ------------------------------------------------------------------ */

describe("DOC-227: the multi-file bundle export stays all-or-nothing", () => {
  it("POST /api/bundle.zip still refuses a state whose NMState is invalid", async () => {
    const { server, baseUrl } = await createTestServer(app);
    try {
      const res = await fetch(`${baseUrl}/api/bundle.zip`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ state: agentState() })
      });
      assert.ok(res.status >= 400, `bundle must not be produced (got ${res.status})`);
      assert.ok(
        !String(res.headers.get("content-type") || "").includes("zip"),
        "no archive may be streamed for an invalid configuration"
      );
    } finally {
      await closeTestServer(server);
    }
  });
});
