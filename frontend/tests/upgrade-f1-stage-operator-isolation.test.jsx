/**
 * v2.3.0 UX correction — F1 (data integrity, owner priority): the Upgrade Content
 * step embeds Mirroring's OperatorsSection for one stage at a time. Switching
 * stages must never let one stage's operator selection be written into another
 * stage's profile — not by a later edit, not by a catalog load, not by a flush.
 *
 * Reproduced first on fc7db81: the embedded section had no key, so its local
 * selection survived a stage switch between two stages on the same catalog minor.
 */
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { apiFetch } from "../src/api.js";
import { _resetScanSessionsForTests } from "../src/mirroring/useProfileCatalogs.js";
import { _resetSourceCredentialsForTests } from "../src/mirroring/sourceCredentialSession.js";
import ContentStep from "../src/upgrade/ContentTab.jsx";
import OperatorsSection from "../src/mirroring/OperatorsSection.jsx";

vi.mock("../src/api.js", () => ({ apiFetch: vi.fn(), API_BASE: "" }));
// The run panel is not under test here; keep it out of the way.
vi.mock("../src/mirroring/MirroringRunPanel.jsx", () => ({ default: () => <div data-testid="run-panel-stub" /> }));

const MINOR = "4.21";
const catalogs = {
  redhat: [
    { id: "redhat:web-terminal", name: "web-terminal", displayName: "Web Terminal", defaultChannel: "fast", catalog: "redhat" },
    { id: "redhat:kiali-ossm", name: "kiali-ossm", displayName: "Kiali Operator", defaultChannel: "stable", catalog: "redhat" }
  ],
  certified: [],
  community: []
};
const wrap = (r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, { results: v, updatedAt: "2026-11-07T00:00:00Z" }]));

const stageProfile = (id, release, selected) => ({
  id,
  name: `plan · ${id}`,
  updatedAt: 1,
  ownedBy: { workflow: "upgrade", planId: "u-1", stageId: id === "p-a" ? "s1" : "s2" },
  content: { platform: true, operators: true, additionalImages: false },
  platform: { release: { channel: `stable-${MINOR}`, patchVersion: release }, version: { selectedMinor: MINOR, locked: true } },
  operators: { catalogMinor: MINOR, catalogMinorSource: "platform", selected },
  additionalImages: [],
  catalogReconciliation: { platformMinor: MINOR, catalogMinor: MINOR, source: "platform", conflict: false },
  paths: {}
});

let fake;
function api(path, options = {}) {
  const method = options.method || "GET";
  const body = options.body ? JSON.parse(options.body) : undefined;
  if (path === "/api/mirroring") return Promise.resolve({ profiles: Object.values(fake.profiles) });
  if (/\/runs$/.test(path)) return Promise.resolve({ runs: [], activeVerification: null });
  if (path === "/api/secrets/rh-pull-secret") return Promise.resolve({ available: false });
  const st = path.match(/^\/api\/operators\/status\?version=(.+)$/);
  if (st) return Promise.resolve(decodeURIComponent(st[1]) === MINOR ? wrap(catalogs) : {});
  const m = path.match(/^\/api\/mirroring\/profiles\/([^/]+)$/);
  if (m && method === "POST") {
    const id = decodeURIComponent(m[1]);
    fake.writes.push({ id, body });
    const p = fake.profiles[id];
    fake.profiles[id] = { ...p, operators: { ...p.operators, ...(body.operators || {}) } };
    return Promise.resolve(fake.profiles[id]);
  }
  return Promise.resolve({});
}

const plan = {
  id: "u-1", name: "Same-minor plan", kind: "planned",
  path: { path: ["4.21.2", "4.21.10", "4.21.40"], hops: [] },
  stages: [{ id: "s1", release: "4.21.10" }, { id: "s2", release: "4.21.40" }],
  stageViews: [
    { id: "s1", release: "4.21.10", minor: MINOR, linkedProfileId: "p-a", content: { state: "planned", evidence: [] }, clusterUpdated: "none" },
    { id: "s2", release: "4.21.40", minor: MINOR, linkedProfileId: "p-b", content: { state: "planned", evidence: [] }, clusterUpdated: "none" }
  ]
};

const wt = { id: "redhat:web-terminal", name: "web-terminal", displayName: "Web Terminal", catalog: "redhat", defaultChannel: "fast", sources: ["manual"] };

beforeEach(() => {
  fake = { profiles: { "p-a": stageProfile("p-a", "4.21.10", [wt]), "p-b": stageProfile("p-b", "4.21.40", []) }, writes: [] };
  _resetScanSessionsForTests();
  _resetSourceCredentialsForTests();
  sessionStorage.clear();
  vi.mocked(apiFetch).mockReset();
  vi.mocked(apiFetch).mockImplementation(api);
});
afterEach(cleanup);

const stageButton = (n) => screen.getByRole("button", { name: new RegExp(`Stage ${n} · 4\\.21\\.`) });
const settle = () => new Promise((r) => setTimeout(r, 450)); // > the 300 ms selection-save debounce

describe("F1: a stage's operator selection never leaks into another stage", () => {
  it("switching from stage 1 to stage 2 (same catalog minor) writes nothing of stage 1 into stage 2", async () => {
    render(<ContentStep plan={plan} highSide={false} onPlanChanged={() => {}} />);
    await waitFor(() => expect(screen.getAllByText("Web Terminal").length).toBeGreaterThan(0));
    fireEvent.click(stageButton(2));
    await settle();
    const intoB = fake.writes.filter((w) => w.id === "p-b");
    for (const w of intoB) expect(JSON.stringify(w.body)).not.toContain("web-terminal");
    expect(fake.profiles["p-b"].operators.selected.map((o) => o.name)).not.toContain("web-terminal");
  });

  it("after switching, an edit on stage 2 saves only stage 2's own selection", async () => {
    render(<ContentStep plan={plan} highSide={false} onPlanChanged={() => {}} />);
    await waitFor(() => expect(screen.getAllByText("Web Terminal").length).toBeGreaterThan(0));
    fireEvent.click(stageButton(2));
    const kiali = (await screen.findAllByRole("button", { name: /Kiali Operator Package: kiali-ossm/ }))[0];
    fireEvent.click(kiali);
    await settle();
    expect(fake.profiles["p-b"].operators.selected.map((o) => o.name)).toEqual(["kiali-ossm"]);
    // Stage 1 keeps exactly its own selection.
    expect(fake.profiles["p-a"].operators.selected.map((o) => o.name)).toEqual(["web-terminal"]);
  });

  it("an edit made just before switching is saved to the stage it was made on, never the next one", async () => {
    render(<ContentStep plan={plan} highSide={false} onPlanChanged={() => {}} />);
    const kiali = (await screen.findAllByRole("button", { name: /Kiali Operator Package: kiali-ossm/ }))[0];
    fireEvent.click(kiali); // pending (debounced) edit on stage 1
    fireEvent.click(stageButton(2)); // switch before the debounce fires
    await settle();
    expect(fake.profiles["p-a"].operators.selected.map((o) => o.name).sort()).toEqual(["kiali-ossm", "web-terminal"]);
    expect(fake.profiles["p-b"].operators.selected).toEqual([]);
    for (const w of fake.writes.filter((x) => x.id === "p-b")) expect(JSON.stringify(w.body)).not.toMatch(/kiali-ossm|web-terminal/);
  });

  it("renders each stage's sections once (no duplicate React keys between the operator and run sections)", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    render(<ContentStep plan={plan} highSide={false} onPlanChanged={() => {}} />);
    await waitFor(() => expect(screen.getAllByText("Web Terminal").length).toBeGreaterThan(0));
    fireEvent.click(stageButton(2));
    await settle();
    expect(errors.mock.calls.map((c) => String(c[0])).filter((m) => /same key/.test(m))).toEqual([]);
    expect(screen.getAllByRole("heading", { name: /^Selected \(/ })).toHaveLength(1);
    errors.mockRestore();
  });

  it("OperatorsSection itself resets when handed another profile without a key (defence in depth)", async () => {
    const { rerender } = render(<OperatorsSection profile={fake.profiles["p-a"]} onProfileChanged={() => {}} />);
    await waitFor(() => expect(screen.getAllByText("Web Terminal").length).toBeGreaterThan(0));
    rerender(<OperatorsSection profile={fake.profiles["p-b"]} onProfileChanged={() => {}} />);
    const kiali = (await screen.findAllByRole("button", { name: /Kiali Operator Package: kiali-ossm/ }))[0];
    fireEvent.click(kiali);
    await settle();
    expect(fake.profiles["p-b"].operators.selected.map((o) => o.name)).toEqual(["kiali-ossm"]);
    expect(fake.profiles["p-a"].operators.selected.map((o) => o.name)).toEqual(["web-terminal"]);
  });
});
