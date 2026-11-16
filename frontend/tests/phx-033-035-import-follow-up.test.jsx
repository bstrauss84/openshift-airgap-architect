/**
 * PHX-033 / PHX-035 — post-import credential and certificate follow-up.
 *
 * The previous notice (commit c91e43f) rendered only on the Blueprint step —
 * which a locked import never lands on — and listed a fixed set of items, two
 * of them false: the SSH public key and (by default) certificates ARE kept in a
 * run export. The replacement is derived from the imported state, shown above
 * every step, lists only what this run needs, resolves as values are
 * re-entered, never shows a value, and shows nothing when nothing is needed.
 */
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor, fireEvent } from "@testing-library/react";
import { getImportFollowUps } from "../src/importFollowUp.js";
import ImportFollowUpNotice from "../src/components/ImportFollowUpNotice.jsx";

vi.mock("../src/api.js", async () => ({ apiFetch: vi.fn(() => Promise.resolve({})) }));
const { apiFetch } = await import("../src/api.js");
const { default: App } = await import("../src/App.jsx");

const SECRET = "OAA_SYNTH_PHX_SECRET_DO_NOT_RENDER";
const CA_PEM = "-----BEGIN CERTIFICATE-----\nPHX\n-----END CERTIFICATE-----";

/** An imported state that needs nothing: anonymous mirror, no BMC, no proxy. */
const quiet = () => ({
  blueprint: { arch: "x86_64", platform: "Bare Metal", clusterName: "phx", baseDomain: "example.com", confirmed: true },
  release: { channel: "4.22", patchVersion: "4.22.16", confirmed: true },
  version: { _schemaVersion: 3, selectedMinor: "4.22", selectedPatch: "4.22.16", locked: true },
  methodology: { method: "Agent-Based Installer" },
  globalStrategy: { networking: {}, proxyEnabled: false },
  platformConfig: {},
  hostInventory: { nodes: [{ role: "master", hostname: "m0", bmc: { address: "" } }] },
  operators: { selected: [] },
  credentials: { usingMirrorRegistry: true, mirrorRegistryUnauthenticated: true, sshPublicKey: "ssh-ed25519 AAAA test" },
  trust: { mirrorRegistryUsesPrivateCa: false },
  exportOptions: { includeCredentials: false, includeCertificates: true },
  ui: { isImported: true }
});

/** An imported state that needs every class of follow-up. */
const busy = () => ({
  ...quiet(),
  blueprint: { ...quiet().blueprint, platform: "VMware vSphere" },
  methodology: { method: "IPI" },
  platformConfig: { vsphere: { vcenter: "vcenter.example.com", username: "" } },
  hostInventory: { nodes: [{ role: "master", hostname: "m0", bmc: { address: "redfish://10.0.0.5" } }, { role: "master", hostname: "m1", bmc: { address: "redfish://10.0.0.6" } }] },
  globalStrategy: { networking: {}, proxyEnabled: true, proxies: { httpProxy: "http://proxy.example:3128" } },
  credentials: { usingMirrorRegistry: true, mirrorRegistryUnauthenticated: false, mirrorRegistryPullSecret: "", sshPublicKey: "ssh-ed25519 AAAA test" },
  trust: { mirrorRegistryUsesPrivateCa: true, mirrorRegistryCaPem: "", proxyCaPem: "" },
  exportOptions: { includeCredentials: false, includeCertificates: false, inclusion: { trustBundleAndCertificates: false } }
});

const ids = (r) => [...r.credentials, ...r.certificates].map((i) => i.id);

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("getImportFollowUps — derived from the imported state", () => {
  it("nothing needed -> nothing listed", () => {
    expect(ids(getImportFollowUps(quiet()))).toEqual([]);
  });

  it("not an import -> nothing listed, whatever is missing", () => {
    expect(ids(getImportFollowUps({ ...busy(), ui: {} }))).toEqual([]);
  });

  it("lists exactly what a busy run needs", () => {
    const r = getImportFollowUps(busy());
    expect(r.credentials.map((i) => i.id)).toEqual(["mirror-pull-secret", "vsphere", "bmc", "proxy"]);
    expect(r.certificates.map((i) => i.id)).toEqual(["mirror-ca", "proxy-ca"]);
    expect(r.credentials.find((i) => i.id === "bmc").label).toMatch(/2 hosts/);
  });

  it("Red Hat pull secret is needed when no mirror registry is used", () => {
    const st = { ...quiet(), credentials: { usingMirrorRegistry: false } };
    expect(ids(getImportFollowUps(st))).toEqual(["pull-secret"]);
    st.credentials.pullSecretPlaceholder = '{"auths":{"quay.io":{"auth":"x"}}}';
    expect(ids(getImportFollowUps(st))).toEqual([]);
  });

  it("each item resolves once re-entered", () => {
    const st = busy();
    st.credentials.mirrorRegistryPullSecret = '{"auths":{"r":{"auth":"x"}}}';
    st.platformConfig.vsphere.password = SECRET;
    st.hostInventory.nodes.forEach((n) => { n.bmc.password = SECRET; });
    st.trust.mirrorRegistryCaPem = CA_PEM;
    st.trust.proxyCaPem = CA_PEM;
    expect(ids(getImportFollowUps(st))).toEqual(["proxy"]); // proxy userinfo is never recorded, so stays conditional
    st.globalStrategy.proxyEnabled = false;
    expect(ids(getImportFollowUps(st))).toEqual([]);
  });

  it("multi-vCenter: every configured vCenter needs its password", () => {
    const st = busy();
    st.platformConfig.vsphere = { vcenters: [{ server: "vc1.example", password: SECRET }, { server: "vc2.example", password: "" }] };
    expect(ids(getImportFollowUps(st))).toContain("vsphere");
    st.platformConfig.vsphere.vcenters[1].password = SECRET;
    expect(ids(getImportFollowUps(st))).not.toContain("vsphere");
  });

  it("does not repeat the old false claims: SSH public key and kept certificates", () => {
    const st = { ...busy(), exportOptions: { includeCertificates: true } };
    const all = ids(getImportFollowUps(st));
    expect(all).not.toContain("ssh");
    expect(all).not.toContain("proxy-ca"); // certificates were included in the export
    expect(all).toContain("mirror-ca"); // flagged private CA but no PEM is still a real gap
  });
});

describe("ImportFollowUpNotice", () => {
  it("renders nothing when nothing is needed", () => {
    const { container } = render(<ImportFollowUpNotice state={quiet()} onDismiss={() => {}} />);
    expect(container.innerHTML).toBe("");
  });

  it("names items and where to fix them, but never shows a value", () => {
    const st = busy();
    st.platformConfig.vsphere.password = "";
    st.credentials.mirrorRegistryPullSecret = SECRET; // present -> resolved, and must not be echoed
    render(<ImportFollowUpNotice state={st} onDismiss={() => {}} />);
    const notice = screen.getByTestId("import-follow-up-notice");
    expect(notice.textContent).toMatch(/vCenter username and password — Platform Specifics/);
    expect(notice.textContent).toMatch(/Mirror registry CA certificate — Trust & Proxy/);
    expect(notice.textContent).not.toContain(SECRET);
    expect(notice.querySelector('[data-import-follow-up="mirror-pull-secret"]')).toBeNull();
  });

  it("Dismiss calls back", () => {
    const onDismiss = vi.fn();
    render(<ImportFollowUpNotice state={busy()} onDismiss={onDismiss} />);
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});

describe("the real import path shows the notice wherever the import lands", () => {
  if (typeof File.prototype.text !== "function") {
    File.prototype.text = function () {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(reader.error);
        reader.readAsText(this);
      });
    };
  }

  const live = {
    ...quiet(),
    credentials: { pullSecretPlaceholder: '{"auths":{"quay.io":{}}}', sshPublicKey: "ssh-ed25519 AAAA test" },
    ui: { segmentedFlowV1: true, showLanding: false, activeStepId: "blueprint", visitedSteps: { blueprint: true }, completedSteps: {} }
  };

  function setupMock() {
    vi.mocked(apiFetch).mockImplementation((path, options) => {
      if (path === "/api/state") return Promise.resolve(live);
      if (path === "/api/schema/stepMap") return Promise.resolve({});
      if (path === "/api/build-info") return Promise.resolve({ gitSha: "test", buildTime: "2026-01-01T00:00:00Z", repo: "t/r", branch: "develop" });
      if (path === "/api/update-info") return Promise.resolve({ enabled: false });
      if (path === "/api/feedback/config") return Promise.resolve({ mode: "disabled" });
      if (path === "/api/generate") return Promise.resolve({ files: {} });
      if (path === "/api/run/import") return Promise.resolve({ state: JSON.parse(options.body).state });
      return Promise.resolve({});
    });
  }

  async function importFile(stateToImport) {
    const fileInput = document.querySelector('input[type="file"][accept=".json"]');
    const file = new File([JSON.stringify({ schemaVersion: 2, state: stateToImport })], "run.json", { type: "application/json" });
    fireEvent.change(fileInput, { target: { files: [file] } });
  }

  beforeEach(() => { localStorage.clear(); vi.mocked(apiFetch).mockReset(); });

  it("a locked import that needs follow-up shows the notice (not only on Blueprint)", async () => {
    setupMock();
    render(<App />);
    await waitFor(() => expect(apiFetch).toHaveBeenCalledWith("/api/state", expect.anything()));
    const { ui, ...imported } = busy();
    await importFile({ ...imported, ui: { segmentedFlowV1: true, activeStepId: "hosts-inventory" } });
    const notice = await screen.findByTestId("import-follow-up-notice", {}, { timeout: 3000 });
    expect(notice.textContent).toMatch(/BMC username and password \(2 hosts\)/);
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByTestId("import-follow-up-notice")).toBeNull();
  });

  it("an import that needs nothing shows no notice", async () => {
    setupMock();
    render(<App />);
    await waitFor(() => expect(apiFetch).toHaveBeenCalledWith("/api/state", expect.anything()));
    const { ui, ...imported } = quiet();
    await importFile({ ...imported, ui: { segmentedFlowV1: true } });
    await waitFor(() => expect(vi.mocked(apiFetch).mock.calls.some((c) => c[0] === "/api/run/import")).toBe(true));
    await new Promise((r) => setTimeout(r, 250));
    expect(screen.queryByTestId("import-follow-up-notice")).toBeNull();
  });
});
