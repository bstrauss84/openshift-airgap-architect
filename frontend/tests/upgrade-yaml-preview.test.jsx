/**
 * v2.3.0 owner QA (2026-11-07): the Upgrade YAML drawer showed "No ImageSet configuration available
 * yet." because it passed stage-named files to an imageset-mode drawer that reads only
 * imageset-config.yaml. It now previews the selected stage live, through Mirroring's own preview
 * hook and route (the same validated generator as the stage's download and the Handoff package).
 */
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, within, cleanup, act } from "@testing-library/react";
import { apiFetch } from "../src/api.js";
import UpgradeShell from "../src/upgrade/UpgradeShell.jsx";
import { _resetSourceCredentialsForTests } from "../src/mirroring/sourceCredentialSession.js";

vi.mock("../src/api.js", () => ({ apiFetch: vi.fn(), API_BASE: "" }));

const stage = (id, release, minor) => ({ id, release, minor, linkedProfileId: `p-${id}`, content: { state: "planned", evidence: [] }, clusterUpdated: "none" });
const plan = {
  id: "u-yamlplan001", name: "Prod", kind: "planned", arch: "amd64", channelPolicy: "stable", current: "4.20.14", target: "4.21.42", updatedAt: "x",
  path: { path: ["4.20.14", "4.20.44", "4.21.42"], hops: [{ from: "4.20.14", to: "4.20.44", kind: "z-stream", channel: "stable-4.20", risks: [] }, { from: "4.20.44", to: "4.21.42", kind: "minor", channel: "stable-4.21", risks: [] }], graphSources: [] },
  stages: [{ id: "s1", release: "4.20.44", minor: "4.20" }, { id: "s2", release: "4.21.42", minor: "4.21" }],
  stageViews: [stage("s1", "4.20.44", "4.20"), stage("s2", "4.21.42", "4.21")],
  mirror: { registryUrl: null, method: "mirrorToDisk", catalogTag: "source" }, operatorIntent: []
};
const profile = (id, minor, updatedAt, operators = false) => ({
  id, name: id, updatedAt, ownedBy: { workflow: "upgrade", planId: plan.id, stageId: id.slice(2) },
  content: { platform: true, operators, additionalImages: false },
  platform: { release: { channel: minor, patchVersion: `${minor}.1` }, version: { selectedMinor: minor, locked: true } },
  operators: { catalogMinor: minor, catalogMinorSource: "platform", selected: [] }, additionalImages: [],
  catalogReconciliation: { platformMinor: minor, catalogMinor: minor, source: "platform", conflict: false }, paths: {}, execution: { mode: "mirrorToDisk", registryUrl: "" }
});

let profiles;
let delays;
let previewCalls;
let notReady;
beforeEach(() => {
  sessionStorage.clear();
  _resetSourceCredentialsForTests();
  profiles = { "p-s1": profile("p-s1", "4.20", 1), "p-s2": profile("p-s2", "4.21", 1) };
  delays = {};
  previewCalls = [];
  notReady = {};
  vi.mocked(apiFetch).mockReset();
  vi.mocked(apiFetch).mockImplementation((p, opts = {}) => {
    const body = opts.body ? JSON.parse(opts.body) : undefined;
    if (p === "/api/upgrade") return Promise.resolve({ activePlanId: plan.id, plans: [plan], supportedMinors: ["4.20", "4.21", "4.22"], highSide: false });
    if (p === "/api/mirroring") return Promise.resolve({ profiles: Object.values(profiles) });
    let m = p.match(/^\/api\/mirroring\/profiles\/([^/]+)\/preview$/);
    if (m) {
      const id = decodeURIComponent(m[1]);
      previewCalls.push(id);
      if (notReady[id]) return Promise.reject(Object.assign(new Error("not ready"), { payload: { code: "PROFILE_NOT_READY", details: [{ message: notReady[id] }] } }));
      const yaml = `kind: ImageSetConfiguration\n# ${id} v${profiles[id].updatedAt}\n`;
      return new Promise((r) => setTimeout(() => r({ imagesetConfig: yaml, validation: { summary: "Checked against the oc-mirror v2 schema." } }), delays[id] || 0));
    }
    m = p.match(/^\/api\/mirroring\/profiles\/([^/]+)\/preview-draft$/);
    if (m) return Promise.resolve({ imagesetConfig: "", blockers: [{ message: notReady[decodeURIComponent(m[1])], path: "x" }], omitted: [] });
    m = p.match(/^\/api\/mirroring\/profiles\/([^/]+)$/);
    if (m && opts.method === "POST") {
      const id = decodeURIComponent(m[1]);
      profiles[id] = { ...profiles[id], ...(body.content ? { content: body.content } : {}), updatedAt: profiles[id].updatedAt + 1 };
      return Promise.resolve(profiles[id]);
    }
    if (/\/runs$/.test(p)) return Promise.resolve({ runs: [], activeVerification: null });
    return Promise.resolve({});
  });
});
afterEach(cleanup);

const drawer = () => screen.getByRole("region", { name: "YAML Preview" });
const openContent = async () => {
  sessionStorage.setItem("oaa.upgrade.step.v2", "content");
  render(<UpgradeShell onExit={() => {}} />);
  await screen.findByRole("heading", { name: "Content for each release on the route" });
};

describe("Upgrade YAML preview", () => {
  it("shows the selected stage's validated configuration, and the stage can be chosen in the drawer", async () => {
    await openContent();
    fireEvent.click(screen.getByRole("button", { name: "Show YAML" }));
    await waitFor(() => expect(drawer().textContent).toContain("# p-s1 v1"));
    expect(drawer().textContent).not.toMatch(/No ImageSet configuration available yet/);
    expect(drawer().textContent).toMatch(/The same file is in the Handoff package/);
    fireEvent.change(within(drawer()).getByRole("combobox"), { target: { value: "s2" } });
    await waitFor(() => expect(drawer().textContent).toContain("# p-s2 v1"));
    expect(drawer().textContent).not.toContain("# p-s1");
  });

  it("follows the stage shown on the Content step", async () => {
    await openContent();
    fireEvent.click(screen.getByRole("button", { name: "Show YAML" }));
    await waitFor(() => expect(drawer().textContent).toContain("# p-s1 v1"));
    fireEvent.click(screen.getByRole("button", { name: /^Stage 2 · 4\.21\.42/ }));
    await waitFor(() => expect(drawer().textContent).toContain("# p-s2 v1"));
    expect(within(drawer()).getByRole("combobox")).toHaveValue("s2");
  });

  it("updates by itself when the stage's content changes", async () => {
    await openContent();
    fireEvent.click(screen.getByRole("button", { name: "Show YAML" }));
    await waitFor(() => expect(drawer().textContent).toContain("# p-s1 v1"));
    fireEvent.click(screen.getByRole("button", { name: /Choose operators for this stage/ }));
    await waitFor(() => expect(drawer().textContent).toContain("# p-s1 v2"));
  });

  it("a slow response for the previous stage never overwrites the newer stage's YAML", async () => {
    delays["p-s1"] = 300;
    await openContent();
    fireEvent.click(screen.getByRole("button", { name: "Show YAML" }));
    await waitFor(() => expect(previewCalls).toContain("p-s1"));
    fireEvent.change(within(drawer()).getByRole("combobox"), { target: { value: "s2" } });
    await waitFor(() => expect(drawer().textContent).toContain("# p-s2 v1"));
    await act(() => new Promise((r) => setTimeout(r, 450)));
    expect(drawer().textContent).toContain("# p-s2 v1");
    expect(drawer().textContent).not.toContain("# p-s1");
  });

  it("Download saves the stage's file name and fetches the same validated route again", async () => {
    const saved = [];
    const origCreate = URL.createObjectURL;
    URL.createObjectURL = vi.fn(() => "blob:x");
    URL.revokeObjectURL = vi.fn();
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function () { saved.push(this.download); });
    await openContent();
    fireEvent.click(screen.getByRole("button", { name: "Show YAML" }));
    fireEvent.change(within(drawer()).getByRole("combobox"), { target: { value: "s2" } });
    await waitFor(() => expect(drawer().textContent).toContain("# p-s2 v1"));
    const before = previewCalls.filter((id) => id === "p-s2").length;
    fireEvent.click(within(drawer()).getByRole("button", { name: "Download" }));
    await waitFor(() => expect(saved).toEqual(["stage-2-4.21.42-imageset-config.yaml"]));
    expect(previewCalls.filter((id) => id === "p-s2").length).toBe(before + 1);
    click.mockRestore();
    URL.createObjectURL = origCreate;
  });

  it("a stage that cannot generate yet says why, and nothing can be downloaded", async () => {
    notReady["p-s1"] = "Choose at least one operator channel.";
    await openContent();
    fireEvent.click(screen.getByRole("button", { name: "Show YAML" }));
    await waitFor(() => expect(drawer().textContent).toMatch(/Choose at least one operator channel/));
    expect(within(drawer()).getByRole("button", { name: "Download" })).toBeDisabled();
    expect(drawer().textContent).not.toMatch(/kind: ImageSetConfiguration/);
  });
});
