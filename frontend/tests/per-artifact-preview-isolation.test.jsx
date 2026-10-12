/**
 * DOC-227 — per-artifact preview isolation, at the UI.
 *
 * REPORTED DEFECT. The YAML Preview showing `imageset-config.yaml` was
 * labelled "Preview not updated: NMState interface name must not be empty."
 * Operator and Quick Pick work could not be seen in the imageset preview while
 * an unrelated Agent host-networking error existed, and the imageset Download
 * was disabled for someone else's reason.
 *
 * Two mechanisms produced that, and both are covered here:
 *
 *   1. BACKEND (covered in backend/test/per-artifact-generation-isolation.test.js):
 *      one generator throwing aborted the whole `/api/generate` response.
 *   2. FRONTEND (here): a single global `error` prop was rendered into EVERY
 *      pane and disabled EVERY Download, so even an error that belonged to one
 *      document was presented as every document's problem.
 *
 * PRE-FIX PROOF. `YamlDrawer` had no `fileErrors` prop at all; the only way to
 * express "this generation failed" was the global `error`, which every pane
 * read. The first describe block below asserts that global behaviour is still
 * intact (DOC-160/7C.4), and then asserts the per-artifact behaviour that is
 * unreachable in the pre-fix component — an unknown prop is ignored by React,
 * so against the pre-fix drawer every `fileErrors` test fails: the error never
 * appears in the pane it belongs to, and, in the cases that matter, the
 * unaffected pane's Download stays disabled instead of becoming available.
 * Verified by running this file against the pre-fix component; see the report.
 */

import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, within, cleanup, waitFor, fireEvent } from "@testing-library/react";

/* ------------------------------------------------------------------ */
/* Controlled generation endpoint, for the App-level half              */
/* ------------------------------------------------------------------ */

const api = vi.hoisted(() => ({ calls: [] }));
vi.mock("../src/api.js", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    apiFetch: (path, opts = {}) => {
      if (typeof path === "string" && path.includes("/api/generate")) {
        const body = opts.body ? JSON.parse(opts.body) : {};
        let resolve;
        let reject;
        const promise = new Promise((res, rej) => {
          resolve = res;
          reject = rej;
        });
        api.calls.push({ body, state: body.state, resolve, reject });
        return promise;
      }
      return Promise.resolve({});
    },
  };
});

const harness = vi.hoisted(() => ({ initialState: null }));
vi.mock("../src/store.jsx", async (importOriginal) => {
  const actual = await importOriginal();
  const { makeStoreMock } = await import("./helpers/store-harness.jsx");
  return makeStoreMock(actual, harness);
});

const { default: YamlDrawer } = await import("../src/components/YamlDrawer.jsx");
const { default: App } = await import("../src/App.jsx");

/* ------------------------------------------------------------------ */
/* Documents                                                           */
/* ------------------------------------------------------------------ */

const INSTALL = (tag) => `apiVersion: v1\nbaseDomain: example.com\nmetadata:\n  name: install-${tag}\n`;
const AGENT = (tag) => `apiVersion: v1beta1\nkind: AgentConfig\nmetadata:\n  name: agent-${tag}\n`;
const IMAGESET = (...operators) =>
  `apiVersion: mirror.openshift.io/v2alpha1\nkind: ImageSetConfiguration\nmirror:\n  operators:\n` +
  operators.map((name) => `    - name: ${name}\n`).join("");

const NMSTATE = "NMState interface name must not be empty.";
const AGENT_SCENARIO = { isAgentBased: true, method: "Agent-Based Installer", platform: "Bare Metal" };

const text = () => document.body.textContent;
const pane = (artifact) => document.querySelector(`[data-artifact="${artifact}"]`);
const paneDownload = (artifact) => within(pane(artifact)).getByRole("button", { name: /^Download$/i });

beforeEach(() => {
  localStorage.clear();
  api.calls.length = 0;
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

/* ------------------------------------------------------------------ */
/* Drawer: an error reaches exactly one pane                           */
/* ------------------------------------------------------------------ */

describe("DOC-227: the drawer routes a per-artifact error to that artifact only", () => {
  const renderSplit = (props = {}) =>
    render(
      <YamlDrawer
        isOpen
        onClose={() => {}}
        previewFiles={{ "install-config.yaml": INSTALL("A"), "agent-config.yaml": AGENT("A") }}
        activeStepId="networking"
        scenario={AGENT_SCENARIO}
        loading={false}
        error=""
        {...props}
      />
    );

  it("renders both panes with an identifiable artifact, so routing is observable", () => {
    renderSplit();
    expect(pane("install-config.yaml")).toBeTruthy();
    expect(pane("agent-config.yaml")).toBeTruthy();
  });

  it("an agent-config error appears in the agent pane", () => {
    renderSplit({ fileErrors: { "agent-config.yaml": NMSTATE } });
    expect(within(pane("agent-config.yaml")).getByText(new RegExp(NMSTATE))).toBeInTheDocument();
  });

  it("the same error does NOT appear in the install-config pane", () => {
    renderSplit({ fileErrors: { "agent-config.yaml": NMSTATE } });
    expect(within(pane("install-config.yaml")).queryByText(new RegExp(NMSTATE))).toBeNull();
    expect(pane("install-config.yaml").textContent).not.toMatch(/last configuration that generated successfully/i);
  });

  it("the unaffected pane keeps its Download; the failed pane loses its own", () => {
    renderSplit({ fileErrors: { "agent-config.yaml": NMSTATE } });
    expect(paneDownload("install-config.yaml")).toBeEnabled();
    expect(paneDownload("agent-config.yaml")).toBeDisabled();
  });

  it("the failed pane still honours the 7C.4 contract — document kept, labelled superseded", () => {
    renderSplit({ fileErrors: { "agent-config.yaml": NMSTATE } });
    const agentPane = pane("agent-config.yaml");
    expect(agentPane.textContent).toContain("agent-A");
    expect(agentPane.textContent).toMatch(/last configuration that generated successfully/i);
    expect(agentPane.textContent).toMatch(/does not reflect your current entry/i);
    expect(agentPane.querySelector('[data-preview-superseded="true"]')).toBeTruthy();
  });

  it("routing works in the other direction too — it is not an agent special case", () => {
    renderSplit({ fileErrors: { "install-config.yaml": "Virtual network name is required." } });
    expect(within(pane("install-config.yaml")).getByText(/Virtual network name is required/)).toBeInTheDocument();
    expect(pane("agent-config.yaml").textContent).not.toMatch(/Virtual network/);
    expect(paneDownload("install-config.yaml")).toBeDisabled();
    expect(paneDownload("agent-config.yaml")).toBeEnabled();
  });

  it("a GLOBAL error — nothing generated — still reaches every pane (DOC-160 intact)", () => {
    renderSplit({ error: "Failed to fetch", stale: true });
    expect(screen.getByText(/Failed to fetch/)).toBeInTheDocument();
    for (const button of screen.getAllByRole("button", { name: /^Download$/i })) {
      expect(button).toBeDisabled();
    }
  });
});

/* ------------------------------------------------------------------ */
/* Drawer: the reported pane — imageset, during someone else's failure */
/* ------------------------------------------------------------------ */

describe("DOC-227: the imageset pane during an unrelated NMState failure", () => {
  const renderImageSet = (props = {}) =>
    render(
      <YamlDrawer
        isOpen
        onClose={() => {}}
        previewFiles={{ "imageset-config.yaml": IMAGESET("web-terminal") }}
        activeStepId="operators"
        scenario={AGENT_SCENARIO}
        loading={false}
        error=""
        {...props}
      />
    );

  it("shows the imageset document, unlabelled, with Download available", () => {
    // The exact user report: this pane was labelled "Preview not updated:
    // NMState interface name must not be empty." and its Download was dead.
    renderImageSet({ fileErrors: { "agent-config.yaml": NMSTATE } });
    expect(text()).toContain("web-terminal");
    expect(text()).not.toContain("Preview not updated");
    expect(text()).not.toMatch(/last configuration that generated successfully/i);
    expect(screen.getByRole("button", { name: /^Download$/i })).toBeEnabled();
  });

  it("the Run oc-mirror view behaves the same way", () => {
    renderImageSet({ activeStepId: "run-oc-mirror", fileErrors: { "agent-config.yaml": NMSTATE } });
    expect(text()).toContain("web-terminal");
    expect(text()).not.toContain("Preview not updated");
    expect(screen.getByRole("button", { name: /^Download$/i })).toBeEnabled();
  });

  it("an imageset-SPECIFIC failure does label this pane and disable its Download", () => {
    renderImageSet({
      fileErrors: {
        "agent-config.yaml": NMSTATE,
        "imageset-config.yaml": 'Target cluster architecture "s390x" is not supported.'
      }
    });
    expect(screen.getByText(/s390x/)).toBeInTheDocument();
    expect(text()).not.toContain(NMSTATE);
    expect(text()).toMatch(/last configuration that generated successfully/i);
    expect(screen.getByRole("button", { name: /^Download$/i })).toBeDisabled();
  });

  it("the drawer-level incomplete-configuration indicator is untouched", () => {
    // Overall blueprint validity is a separate concept and must survive.
    renderImageSet({ showIncompleteWarning: true, fileErrors: { "agent-config.yaml": NMSTATE } });
    expect(text()).toMatch(/Incomplete Configuration/i);
    expect(screen.getByRole("button", { name: /^Download$/i })).toBeEnabled();
  });
});

/* ------------------------------------------------------------------ */
/* App: the request, the merge, and the end-to-end result              */
/* ------------------------------------------------------------------ */

const PATCH = "4.22.16";

const lockedAgentRun = () => ({
  _schemaVersion: 3,
  version: {
    _schemaVersion: 3,
    selectedMinor: "4.22",
    selectedPatch: PATCH,
    selectedChannel: "stable-4.22",
    locked: true,
  },
  release: { channel: "4.22", patchVersion: PATCH, confirmed: true },
  blueprint: {
    platform: "Bare Metal",
    arch: "x86_64",
    clusterName: "airgap-cluster",
    baseDomain: "example.com",
    confirmed: true,
  },
  methodology: { method: "Agent-Based Installer" },
  /* The wizard resumes on the Global Strategy step, which reads these
     unguarded. Present so the test exercises the real shell rather than an
     ErrorBoundary fallback. */
  globalStrategy: {
    mirroring: { registryFqdn: "", sources: [] },
    networking: {},
    ntpServers: "",
  },
  credentials: { sshPublicKey: "", pullSecret: "" },
  hostInventory: { nodes: [] },
  operators: { selected: [] },
  reviewFlags: {},
  ui: {
    activeStepId: "networking",
    visitedSteps: { blueprint: true, methodology: true },
    completedSteps: { blueprint: true, methodology: true },
  },
});

async function flush(fn) {
  const { act: reactAct } = await import("@testing-library/react");
  await reactAct(async () => {
    await fn();
    await Promise.resolve();
  });
}

async function openPreview() {
  harness.initialState = lockedAgentRun();
  render(<App />);
  const cta = await screen.findByRole("button", { name: /Continue install|Start new install/i });
  fireEvent.click(cta);
  const toggle = await screen.findByRole("button", { name: /^Show YAML$/i });
  fireEvent.click(toggle);
  await waitFor(() => expect(api.calls.length).toBeGreaterThan(0));
}

const latest = () => api.calls[api.calls.length - 1];

describe("DOC-227: App asks for per-artifact results and reconciles them", () => {
  it("every preview generation requests artifact isolation", async () => {
    await openPreview();
    expect(latest().body.isolateArtifacts).toBe(true);
    expect(latest().body.state).toBeTruthy();
  });

  it("a per-artifact failure updates only that pane; the others go current", async () => {
    await openPreview();
    await flush(() =>
      latest().resolve({
        files: { "install-config.yaml": INSTALL("A"), "agent-config.yaml": AGENT("A") },
        fileErrors: {},
      })
    );
    await waitFor(() => expect(text()).toContain("install-A"));

    // The user now breaks host networking and edits something else; the
    // backend returns a fresh install-config and an agent-config error.
    const before = api.calls.length;
    harness.setState((prev) => ({ ...prev, blueprint: { ...prev.blueprint, clusterName: "renamed-cluster" } }));
    await waitFor(() => expect(api.calls.length).toBeGreaterThan(before));
    await flush(() =>
      latest().resolve({
        files: { "install-config.yaml": INSTALL("B") },
        fileErrors: { "agent-config.yaml": { message: NMSTATE, artifact: "agent-config.yaml" } },
      })
    );

    await waitFor(() => expect(text()).toContain("install-B"));
    // install-config is current: fresh content, no banner, Download live.
    expect(pane("install-config.yaml").textContent).not.toMatch(/Preview not updated/);
    expect(paneDownload("install-config.yaml")).toBeEnabled();
    // agent-config kept its last good document, labelled, Download dead.
    expect(pane("agent-config.yaml").textContent).toContain("agent-A");
    expect(pane("agent-config.yaml").textContent).toMatch(/last configuration that generated successfully/i);
    expect(paneDownload("agent-config.yaml")).toBeDisabled();
  });

  it("a recovered artifact drops its banner and its retained document", async () => {
    await openPreview();
    await flush(() =>
      latest().resolve({
        files: { "install-config.yaml": INSTALL("A"), "agent-config.yaml": AGENT("A") },
        fileErrors: {},
      })
    );
    const first = api.calls.length;
    harness.setState((prev) => ({ ...prev, blueprint: { ...prev.blueprint, clusterName: "c2" } }));
    await waitFor(() => expect(api.calls.length).toBeGreaterThan(first));
    await flush(() =>
      latest().resolve({
        files: { "install-config.yaml": INSTALL("B") },
        fileErrors: { "agent-config.yaml": { message: NMSTATE } },
      })
    );
    await waitFor(() => expect(text()).toMatch(/last configuration that generated successfully/i));

    const second = api.calls.length;
    harness.setState((prev) => ({ ...prev, blueprint: { ...prev.blueprint, clusterName: "c3" } }));
    await waitFor(() => expect(api.calls.length).toBeGreaterThan(second));
    await flush(() =>
      latest().resolve({
        files: { "install-config.yaml": INSTALL("C"), "agent-config.yaml": AGENT("C") },
        fileErrors: {},
      })
    );

    await waitFor(() => expect(text()).toContain("agent-C"));
    expect(text()).not.toContain("agent-A");
    expect(text()).not.toMatch(/last configuration that generated successfully/i);
    expect(paneDownload("agent-config.yaml")).toBeEnabled();
  });

  it("a transport failure is still global — every pane, as DOC-160 requires", async () => {
    await openPreview();
    await flush(() =>
      latest().resolve({
        files: { "install-config.yaml": INSTALL("A"), "agent-config.yaml": AGENT("A") },
        fileErrors: {},
      })
    );
    const before = api.calls.length;
    harness.setState((prev) => ({ ...prev, blueprint: { ...prev.blueprint, clusterName: "c4" } }));
    await waitFor(() => expect(api.calls.length).toBeGreaterThan(before));
    await flush(() => latest().reject(new Error("Failed to fetch")));

    await waitFor(() => expect(text()).toMatch(/Failed to fetch/));
    for (const button of screen.getAllByRole("button", { name: /^Download$/i })) {
      expect(button).toBeDisabled();
    }
  });
});
