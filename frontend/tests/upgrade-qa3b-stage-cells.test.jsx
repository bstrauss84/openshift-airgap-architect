/**
 * v2.3.0 owner QA round 3b (2026-11-17) — the owner's plan, replayed: stage 1's ODF selection
 * (stable-4.20) was copied into the 4.21 and 4.22 stages. All three minors are scanned (ODF's
 * default is stable-4.20 / stable-4.21 / stable-4.22); stage 2 also has a Live catalog check, which
 * confirms stable-4.20 still EXISTS in the 4.21 catalog; stage 3 has none. The table showed
 * "stable-4.20 ✓ verified" (stage 2) and "stable-4.20 ? channel not checked" (stage 3), hiding each
 * stage's own default. Each cell now keeps the selected channel, this catalog's default and the
 * verdict apart, and the copied defaults are flagged and suggested (pre-ticked), never changed
 * silently.
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
const ls = (name) => op(name, "4.20", "stable", ["manual"]);
beforeEach(() => {
  const verified = (minor, ch) => ({ verification: { status: "verified", catalogImage: img(minor), channel: ch, minVersion: "", maxVersion: "" } });
  fake = {
    profiles: {
      "p-s1": prof("p-s1", "4.20", [{ ...op("odf-operator", "4.20", "stable-4.20", ["manual"]), ...verified("4.20", "stable-4.20") }, ls("local-storage-operator")]),
      "p-s2": prof("p-s2", "4.21", [{ ...op("odf-operator", "4.21", "stable-4.20"), ...verified("4.21", "stable-4.20") }, op("local-storage-operator", "4.21", "stable")]),
      "p-s3": prof("p-s3", "4.22", [op("odf-operator", "4.22", "stable-4.20"), op("local-storage-operator", "4.22", "stable")])
    },
    evidence: [
      { stageId: "s1", name: "odf-operator", catalogImage: img("4.20"), selected: "stable-4.20", listing: { defaultChannel: "stable-4.20", channels: [{ name: "stable-4.19" }, { name: "stable-4.20" }] }, checkedAt: 1 },
      { stageId: "s2", name: "odf-operator", catalogImage: img("4.21"), selected: "stable-4.20", listing: { defaultChannel: "stable-4.21", channels: [{ name: "stable-4.20" }, { name: "stable-4.21" }] }, checkedAt: 1 }
    ],
    status: {
      "4.20": full([{ name: "odf-operator", defaultChannel: "stable-4.20" }, { name: "local-storage-operator", defaultChannel: "stable" }]),
      "4.21": full([{ name: "odf-operator", defaultChannel: "stable-4.21" }, { name: "local-storage-operator", defaultChannel: "stable" }]),
      "4.22": full([{ name: "odf-operator", defaultChannel: "stable-4.22" }, { name: "local-storage-operator", defaultChannel: "stable" }])
    },
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

describe("stage cells after every catalog is scanned (owner QA 3b)", () => {
  it("each later stage shows its own catalog default next to the copied channel; nothing claims the copy is that stage's result", async () => {
    mount();
    await waitFor(() => expect(cells("odf-operator")[2].textContent).toMatch(/Catalog default: stable-4\.22 \(scan\)/));
    const [c1, c2, c3] = cells("odf-operator");
    expect(c1.textContent).toMatch(/stable-4\.20.*verified · default/);
    expect(c1.textContent).not.toMatch(/Catalog default/);
    expect(c2.dataset.state).toBe("WARNING");
    expect(c2.textContent).toMatch(/stable-4\.20.*not this catalog's default.*Catalog default: stable-4\.21 \(live check\)/);
    expect(c2.querySelector(".upgrade-cell-channel").title).toMatch(/copied from stage 1/);
    expect(c2.textContent).not.toMatch(/✓/);
    expect(c3.textContent).toMatch(/stable-4\.20.*not confirmed here.*Catalog default: stable-4\.22 \(scan\)/);
    expect(c3.textContent).not.toMatch(/channel not checked/);
    // A channel that is every catalog's default is simply the default in each stage.
    for (const c of cells("local-storage-operator")) expect(c.textContent).toMatch(/stable.*(catalog default|default)/);
  });

  it("the copied defaults are flagged, pre-ticked and applied only on request — each stage gets its own catalog's default", async () => {
    mount();
    expect(await screen.findByText(/2 channels were copied from an earlier stage and are not this stage's catalog default/)).toBeInTheDocument();
    const box = (await screen.findByText(/Channel suggestions \(2\)/)).closest("details");
    const s2 = await within(box).findByRole("checkbox", { name: /Stage 2 · odf-operator ?: stable-4\.20 → stable-4\.21/ });
    const s3 = within(box).getByRole("checkbox", { name: /Stage 3 · odf-operator ?: stable-4\.20 → stable-4\.22/ });
    expect(s2).toBeChecked();
    expect(s3).toBeChecked();
    // (Stage 1's embedded Mirroring editor may record its own verified minor; stages 2 and 3 are untouched.)
    const later = () => fake.updates.filter(([id]) => id !== "p-s1");
    expect(later()).toEqual([]);
    fireEvent.click(within(box).getByRole("button", { name: "Apply 2 channel change(s)" }));
    await waitFor(() => expect(later().length).toBe(2));
    const byProfile = Object.fromEntries(later().map(([id, b]) => [id, b.operators.selected.find((o) => o.name === "odf-operator").defaultChannel]));
    expect(byProfile).toEqual({ "p-s2": "stable-4.21", "p-s3": "stable-4.22" });
  });

  it("the toolbar: find first; the optional note and its bulk panel appear only when asked for (owner QA 4)", async () => {
    mount();
    const find = await screen.findByRole("search", { name: "Find operators" });
    expect(within(find).getByRole("searchbox", { name: "Filter operators" })).toBeInTheDocument();
    expect(within(find).getByText("2 operators")).toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "Note several operators at once" })).toBeNull();
    fireEvent.click(screen.getByRole("switch", { name: "Note which operators are already installed" }));
    expect(within(find).getByRole("combobox", { name: "Show note" })).toBeInTheDocument();
    const bulk = screen.getByRole("group", { name: "Note several operators at once" });
    expect(within(bulk).getByText(/Tick operators in the table/)).toBeInTheDocument();
    expect(within(bulk).getByRole("combobox", { name: "Note for the selected operators" })).toBeDisabled();
    expect(within(bulk).getByRole("button", { name: "Note 0 selected" })).toBeDisabled();
    fireEvent.click(within(bulk).getByRole("button", { name: "Select shown (2)" }));
    expect(within(bulk).getByText("2 selected")).toBeInTheDocument();
    expect(within(bulk).getByRole("button", { name: "Note 2 selected" })).toBeEnabled();
  });

  it("each operator is one row: every stage cell has the same three lines, and explanations open in one detail row", async () => {
    mount();
    await waitFor(() => expect(cells("odf-operator")[2].textContent).toMatch(/Catalog default/));
    for (const c of [...cells("odf-operator"), ...cells("local-storage-operator")]) expect(c.querySelector(".upgrade-cell").children.length).toBe(3);
    expect(document.querySelector("details.upgrade-cell-why")).toBeNull();
    const btn = screen.getByRole("button", { name: "Show details for odf-operator" });
    expect(btn).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(btn);
    const detail = document.getElementById(btn.getAttribute("aria-controls"));
    expect(detail.tagName).toBe("TR");
    expect(detail.textContent).toMatch(/Stage 3 · 4\.22\.22.*not the 4\.22 catalog's default/);
    expect(screen.getByRole("button", { name: "Hide details for odf-operator" })).toHaveAttribute("aria-expanded", "true");
  });
});
