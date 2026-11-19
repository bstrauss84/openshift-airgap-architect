/**
 * v2.3.0 owner QA (2026-11-17), P2 — channels in later stages showed the selected (often copied)
 * channel and stayed "channel not checked" after scans: a scan records only each package's default
 * channel. The Live catalog check's cached package listing (every channel and the default, per
 * catalog image) is now used per stage; suggestions come from that evidence and change nothing
 * until applied; "Check channels in every stage" runs the existing Live catalog check per stage.
 */
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, within, cleanup } from "@testing-library/react";
import { apiFetch } from "../src/api.js";
import ContentTab, { checkTiming } from "../src/upgrade/ContentTab.jsx";
import { _resetAutoScanForTests } from "../src/upgrade/RouteCatalogScan.jsx";
import { _resetSourceCredentialsForTests, setSourceCredential, planCredentialKey } from "../src/mirroring/sourceCredentialSession.js";
import { _resetScanSessionsForTests } from "../src/mirroring/useProfileCatalogs.js";

vi.mock("../src/api.js", () => ({ apiFetch: vi.fn(), API_BASE: "" }));
vi.mock("../src/mirroring/MirroringRunPanel.jsx", () => ({ default: () => null }));

const img = (m) => `registry.redhat.io/redhat/redhat-operator-index:v${m}`;
const op = (name, minor, ch, sources = ["upgrade:copied-from-s1"]) => ({ id: `${img(minor)}::${name}`, name, catalog: "redhat", catalogImage: img(minor), defaultChannel: ch, sources });
const prof = (id, minor, selected) => ({
  id, name: id, updatedAt: 1, ownedBy: { workflow: "upgrade", planId: "u-chan000001", stageId: id.slice(2) },
  content: { platform: true, operators: true, additionalImages: false },
  platform: { release: { channel: minor, patchVersion: `${minor}.1` }, version: { selectedMinor: minor, locked: true } },
  operators: { catalogMinor: minor, catalogMinorSource: "platform", selected }, additionalImages: [],
  catalogReconciliation: { platformMinor: minor, catalogMinor: minor, source: "platform", conflict: false }, paths: {}
});
const view = (id, release, minor) => ({ id, release, minor, linkedProfileId: `p-${id}`, content: { state: "planned", evidence: [] }, clusterUpdated: "none" });
const full = (list) => ({ redhat: { results: list, updatedAt: Date.now() }, certified: { results: [], updatedAt: Date.now() }, community: { results: [], updatedAt: Date.now() } });
const plan = {
  id: "u-chan000001", name: "Prod", kind: "planned", path: { path: ["4.20.8", "4.20.46", "4.21.42", "4.22.22"], hops: [] },
  stages: [{ id: "s1", release: "4.20.46" }, { id: "s2", release: "4.21.42" }, { id: "s3", release: "4.22.22" }],
  stageViews: [view("s1", "4.20.46", "4.20"), view("s2", "4.21.42", "4.21"), view("s3", "4.22.22", "4.22")], operatorIntent: []
};
let fake;
beforeEach(() => {
  fake = {
    profiles: {
      "p-s1": prof("p-s1", "4.20", [op("odf-operator", "4.20", "stable-4.20", ["manual"])]),
      "p-s2": prof("p-s2", "4.21", [op("odf-operator", "4.21", "stable-4.20"), op("kiali-ossm", "4.21", "candidate")]),
      "p-s3": prof("p-s3", "4.22", [op("odf-operator", "4.22", "stable-4.22")])
    },
    // Live-check listings: 4.21 lists stable-4.21 / stable-4.20? no — only stable-4.21 (default) and stable-4.20 absent; 4.22 lists stable-4.22.
    evidence: [
      { stageId: "s2", name: "odf-operator", catalogImage: img("4.21"), selected: "stable-4.20", listing: { defaultChannel: "stable-4.21", channels: [{ name: "stable-4.21", head: "odf-operator.v4.21.3" }] }, checkedAt: 1 },
      { stageId: "s3", name: "odf-operator", catalogImage: img("4.22"), selected: "stable-4.22", listing: { defaultChannel: "stable-4.22", channels: [{ name: "stable-4.21" }, { name: "stable-4.22" }] }, checkedAt: 1 }
    ],
    status: { "4.21": full([{ name: "odf-operator", defaultChannel: "stable-4.21" }, { name: "kiali-ossm", defaultChannel: "stable" }]) },
    updates: [], verifies: [], jobs: {}
  };
  sessionStorage.clear();
  _resetSourceCredentialsForTests();
  _resetAutoScanForTests();
  _resetScanSessionsForTests();
  checkTiming.pollMs = 5;
  vi.mocked(apiFetch).mockReset();
  vi.mocked(apiFetch).mockImplementation((p, opts = {}) => {
    const body = opts.body ? JSON.parse(opts.body) : undefined;
    if (p === "/api/mirroring") return Promise.resolve({ profiles: Object.values(fake.profiles) });
    if (p.endsWith("/channel-evidence")) return Promise.resolve({ evidence: fake.evidence });
    let m = p.match(/^\/api\/operators\/status\?version=(.+)$/);
    if (m) return Promise.resolve(fake.status[decodeURIComponent(m[1])] || {});
    m = p.match(/^\/api\/mirroring\/profiles\/([^/]+)\/verify-catalogs$/);
    if (m) { fake.verifies.push([decodeURIComponent(m[1]), body]); const id = `v-${fake.verifies.length}`; fake.jobs[id] = 0; return Promise.resolve({ jobId: id }); }
    m = p.match(/^\/api\/jobs\/([^/]+)$/);
    if (m) { fake.jobs[m[1]] += 1; return Promise.resolve({ status: fake.jobs[m[1]] < 2 ? "running" : "completed" }); }
    m = p.match(/^\/api\/mirroring\/profiles\/([^/]+)$/);
    if (m && opts.method === "POST") {
      const id = decodeURIComponent(m[1]);
      fake.updates.push([id, body]);
      fake.profiles[id] = { ...fake.profiles[id], operators: { ...fake.profiles[id].operators, ...(body.operators || {}) }, updatedAt: fake.profiles[id].updatedAt + 1 };
      return Promise.resolve(fake.profiles[id]);
    }
    if (/\/runs$/.test(p)) return Promise.resolve({ runs: [], activeVerification: null });
    return Promise.resolve({});
  });
});
afterEach(cleanup);

const mount = () => render(<ContentTab plan={plan} onPlanChanged={() => {}} credentialKey={planCredentialKey(plan.id)} />);
const matrix = () => screen.getByRole("table", { name: /Operators on each stage of the route/ });
const cells = (name) => within(within(matrix()).getByRole("rowheader", { name: new RegExp(name) }).closest("tr")).getAllByRole("cell").filter((td) => td.classList.contains("upgrade-matrix-cell"));

describe("per-stage channel evidence", () => {
  it("uses each stage catalog's listing: listed, missing (with the catalog default suggested), or not checked", async () => {
    mount();
    await waitFor(() => expect(cells("odf-operator")[1].textContent).toMatch(/stable-4\.20.*channel missing/));
    expect(cells("odf-operator")[2].textContent).toMatch(/stable-4\.22.*listed · default/);
    expect(cells("kiali-ossm")[1].textContent).toMatch(/candidate.*not confirmed here.*Catalog default: stable/);
    expect(cells("odf-operator")[1].querySelector(".sr-only").textContent).toMatch(/does not list odf-operator channel stable-4\.20 \(channels: stable-4\.21\)/);
  });

  it("suggestions change nothing until applied; only proven-missing channels are pre-ticked; Undo restores", async () => {
    mount();
    const panel = await screen.findByText(/Channel suggestions \(2\)/);
    const box = panel.closest("details");
    await waitFor(() => expect(within(box).queryAllByRole("checkbox").length).toBe(2));
    const odf = await within(box).findByRole("checkbox", { name: /Stage 2 · odf-operator ?: stable-4\.20 → stable-4\.21/ });
    await waitFor(() => expect(odf).toBeChecked());
    const kiali = within(box).getByRole("checkbox", { name: /Stage 2 · kiali-ossm ?: candidate → stable/ });
    expect(odf).toBeChecked();
    expect(kiali).not.toBeChecked();
    expect(fake.updates).toEqual([]);
    fireEvent.click(within(box).getByRole("button", { name: "Apply 1 channel change(s)" }));
    await waitFor(() => expect(fake.updates.length).toBe(1));
    expect(fake.updates[0][0]).toBe("p-s2");
    expect(fake.updates[0][1].operators.selected.map((o) => [o.name, o.defaultChannel])).toEqual([["odf-operator", "stable-4.21"], ["kiali-ossm", "candidate"]]);
    fireEvent.click(await within(box).findByRole("button", { name: "Undo" }));
    await waitFor(() => expect(fake.updates.length).toBe(2));
    expect(fake.updates[1][1].operators.selected.find((o) => o.name === "odf-operator").defaultChannel).toBe("stable-4.20");
    expect(fake.updates.every(([id]) => id === "p-s2"), "no other stage is touched").toBe(true);
  });

  it("“Check channels in every stage” runs each stage's Live catalog check in turn with the plan's credential", async () => {
    setSourceCredential(planCredentialKey(plan.id), { secret: JSON.stringify({ auths: { "registry.redhat.io": { auth: btoa(["u", "chan-canary"].join(":")) } } }) }, "check");
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Check channels in every stage" }));
    await waitFor(() => expect(fake.verifies.map(([id]) => id)).toEqual(["p-s1", "p-s2", "p-s3"]));
    expect(fake.verifies[0][1]).toMatchObject({ rhAuthSource: "inline" });
    expect(fake.verifies[0][1].rhPullSecret).toMatch(/registry\.redhat\.io/);
    await waitFor(() => expect(screen.getByRole("button", { name: "Check channels in every stage" })).toBeEnabled());
  });
});
