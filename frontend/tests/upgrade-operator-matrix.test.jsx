/**
 * v2.3.0 owner QA (2026-11-07): the "Operators across the route" matrix.
 *  - Root cause found: every operator without a recorded classification was shown as
 *    "New: requested for installation" by a hardcoded fallback. Now: "Not classified yet", with
 *    the reason the operator is in the stage (added by you, Quick Pick, copied, imported).
 *  - Root cause found: stage cells showed the selected channel (often copied verbatim, e.g.
 *    stable-4.20 in the 4.21/4.22 stages) as if it were catalog data. Now each cell shows what that
 *    stage's catalog actually says: live check, scanned default channel, not checked, not scanned.
 *  - Bulk classification with filter, preservation of existing categories, overwrite and Undo.
 *  - Coordinated catalog scans across the route (bounded fixtures; no real downloads).
 */
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, within, cleanup, act } from "@testing-library/react";
import { apiFetch } from "../src/api.js";
import ContentTab from "../src/upgrade/ContentTab.jsx";
import { buildScanPlan, cellEvidence } from "../src/upgrade/routeCatalogs.js";
import { scanTiming, _resetAutoScanForTests } from "../src/upgrade/RouteCatalogScan.jsx";
import { _resetSourceCredentialsForTests, setSourceCredential, planCredentialKey } from "../src/mirroring/sourceCredentialSession.js";
import { _resetScanSessionsForTests } from "../src/mirroring/useProfileCatalogs.js";

vi.mock("../src/api.js", () => ({ apiFetch: vi.fn(), API_BASE: "" }));
vi.mock("../src/mirroring/MirroringRunPanel.jsx", () => ({ default: () => null }));

const img = (m) => `registry.redhat.io/redhat/redhat-operator-index:v${m}`;
const op = (name, minor, channel, sources, extra = {}) => ({ id: `${img(minor)}::${name}`, name, catalog: "redhat", catalogImage: img(minor), defaultChannel: channel, sources, ...extra });
const profile = (id, minor, selected) => ({
  id, name: id, updatedAt: 1, ownedBy: { workflow: "upgrade", planId: "u-matrix00001", stageId: id.slice(2) },
  content: { platform: true, operators: true, additionalImages: false },
  platform: { release: { channel: minor, patchVersion: `${minor}.1` }, version: { selectedMinor: minor, locked: true } },
  operators: { catalogMinor: minor, catalogMinorSource: "platform", selected }, additionalImages: [],
  catalogReconciliation: { platformMinor: minor, catalogMinor: minor, source: "platform", conflict: false }, paths: {}
});
const view = (id, release, minor) => ({ id, release, minor, linkedProfileId: `p-${id}`, content: { state: "planned", evidence: [] }, clusterUpdated: "none" });
// Synthetic credential, built at runtime (no credential-like literal in the repository).
const CANARY_AUTH = btoa(["u", "matrix-canary"].join(":"));
const RH = JSON.stringify({ auths: { "registry.redhat.io": { auth: CANARY_AUTH } } });
const cachedStatus = (list) => ({ redhat: { results: list, updatedAt: Date.now() - 3600000 }, certified: { results: [], updatedAt: Date.now() - 3600000 }, community: { results: [], updatedAt: Date.now() - 3600000 } });

let plan;
let fake;
const setup = () => {
  plan = {
    id: "u-matrix00001", name: "Prod", kind: "planned",
    path: { path: ["4.20.14", "4.20.44", "4.21.42", "4.22.22"], hops: [] },
    stages: [{ id: "s1", release: "4.20.44" }, { id: "s2", release: "4.21.42" }, { id: "s3", release: "4.22.22" }],
    stageViews: [view("s1", "4.20.44", "4.20"), view("s2", "4.21.42", "4.21"), view("s3", "4.22.22", "4.22")],
    operatorIntent: [{ key: "redhat|kiali-ossm", name: "kiali-ossm", catalogKind: "redhat", channel: "stable", category: "installed", confidence: "cluster-export", sources: [{ file: "cluster export" }] }]
  };
  fake = {
    profiles: {
      "p-s1": profile("p-s1", "4.20", [op("kiali-ossm", "4.20", "stable", ["manual"]), op("odf-operator", "4.20", "stable-4.20", ["virtualization"])]),
      "p-s2": profile("p-s2", "4.21", [op("kiali-ossm", "4.21", "stable", ["upgrade:copied-from-s1"]), op("odf-operator", "4.21", "stable-4.20", ["upgrade:copied-from-s1"])]),
      "p-s3": profile("p-s3", "4.22", [op("kiali-ossm", "4.22", "stable", ["upgrade:copied-from-s1"], { verification: { status: "verified", message: "ok", checkedAt: 1, catalogImage: img("4.22"), channel: "stable", minVersion: "", maxVersion: "", source: "live" } })])
    },
    status: { "4.21": cachedStatus([{ name: "kiali-ossm", defaultChannel: "stable" }, { name: "odf-operator", defaultChannel: "stable-4.21" }]) },
    intentPosts: [],
    scanPosts: [],
    jobs: {},
    stops: [],
    failMinor: null,
    seq: 0
  };
};
const api = (p, opts = {}) => {
  const body = opts.body ? JSON.parse(opts.body) : undefined;
  if (p === "/api/mirroring") return Promise.resolve({ profiles: Object.values(fake.profiles) });
  let m = p.match(/^\/api\/operators\/status\?version=(.+)$/);
  if (m) return Promise.resolve(fake.status[decodeURIComponent(m[1])] || {});
  if (p.endsWith("/operator-intent")) {
    fake.intentPosts.push(body);
    const map = new Map(plan.operatorIntent.map((e) => [e.key, e]));
    for (const k of body.remove || []) map.delete(k);
    for (const e of body.entries || []) map.set(`${e.catalogKind}|${e.name}`, { ...e, key: `${e.catalogKind}|${e.name}` });
    plan = { ...plan, operatorIntent: [...map.values()] };
    return Promise.resolve({ plan, skipped: [] });
  }
  if (p === "/api/operators/scan") {
    fake.scanPosts.push(body);
    const jobs = {};
    for (const k of ["redhat", "certified", "community"]) { const id = `job-${body.catalogMinor}-${k}-${++fake.seq}`; fake.jobs[id] = { id, polls: 0, minor: body.catalogMinor }; jobs[k] = id; }
    return Promise.resolve({ jobs });
  }
  m = p.match(/^\/api\/jobs\/([^/]+)\/stop$/);
  if (m) { fake.stops.push(m[1]); fake.jobs[m[1]].stopped = true; return Promise.resolve({ ok: true }); }
  m = p.match(/^\/api\/jobs\/([^/]+)$/);
  if (m) {
    const j = fake.jobs[decodeURIComponent(m[1])];
    if (!j) return Promise.reject(Object.assign(new Error("gone"), { status: 404 }));
    j.polls += 1;
    if (j.stopped) return Promise.resolve({ id: j.id, status: "cancelled" });
    if (j.polls < 2) return Promise.resolve({ id: j.id, status: "running", progress: 40 });
    if (fake.failMinor === j.minor) return Promise.resolve({ id: j.id, status: "failed", message: "registry unreachable" });
    // A completed scan leaves cached results for its minor.
    fake.status[j.minor] = cachedStatus([{ name: "kiali-ossm", defaultChannel: "stable" }, { name: "odf-operator", defaultChannel: `stable-${j.minor}` }]);
    return Promise.resolve({ id: j.id, status: "completed", progress: 100 });
  }
  if (/\/runs$/.test(p)) return Promise.resolve({ runs: [], activeVerification: null });
  return Promise.resolve({});
};

beforeEach(() => {
  setup();
  sessionStorage.clear();
  _resetSourceCredentialsForTests();
  _resetAutoScanForTests();
  _resetScanSessionsForTests();
  scanTiming.pollMs = 10;
  vi.mocked(apiFetch).mockReset();
  vi.mocked(apiFetch).mockImplementation(api);
});
afterEach(cleanup);

function Host() {
  const [p, setP] = React.useState(plan);
  return <ContentTab plan={p} onPlanChanged={(next) => { if (next) setP(next); }} credentialKey={planCredentialKey(p.id)} />;
}
const mount = () => render(<Host />);
const matrix = () => screen.getByRole("table", { name: /Operators on each stage of the route/ });
const row = (name) => within(matrix()).getByRole("rowheader", { name: new RegExp(name) }).closest("tr");
const cells = (name) => within(row(name)).getAllByRole("cell").slice(1);

describe("default classification and provenance", () => {
  it("never asserts “New” by default: unknown operators are “Not classified yet”, with the reason they are in the stage", async () => {
    mount();
    await waitFor(() => expect(within(matrix()).getAllByRole("row").length).toBe(3));
    const odf = row("odf-operator");
    expect(within(odf).getByRole("combobox", { name: /odf-operator category/ })).toHaveValue("");
    expect(within(odf).getByRole("combobox", { name: /odf-operator category/ }).selectedOptions[0].textContent).toBe("Not classified yet");
    expect(odf.textContent).toMatch(/Quick Pick · copied from stage 1/);
    const kiali = row("kiali-ossm");
    expect(within(kiali).getByRole("combobox", { name: /kiali-ossm category/ })).toHaveValue("installed");
    expect(kiali.textContent).toMatch(/imported cluster export/);
    expect(kiali.textContent).toMatch(/added by you/);
    expect(matrix().textContent).not.toMatch(/chosen here/);
  });
});

describe("per-stage catalog evidence", () => {
  it("each cell says what THAT stage's catalog shows: not scanned, default channel, not checked, live-verified", async () => {
    mount();
    await waitFor(() => expect(cells("kiali-ossm")[1].textContent).toMatch(/catalog default/));
    expect(cells("kiali-ossm")[0].textContent).toMatch(/stable.*not scanned/);
    // Owner QA 3b: the selected channel, the stage catalog's default and the verdict are kept apart.
    expect(cells("odf-operator")[1].textContent).toMatch(/stable-4\.20.*copied from stage 1.*not confirmed here.*Catalog default: stable-4\.21 \(scan\)/);
    expect(cells("odf-operator")[2].textContent).toMatch(/—/);
    expect(cells("kiali-ossm")[2].textContent).toMatch(/verified/);
    expect(cells("odf-operator")[1].querySelector(".sr-only").textContent).toMatch(/not the 4\.21 catalog's default \(stable-4\.21\).*whether stable-4\.20 exists in the 4\.21 catalog is not known/);
  });
  it("a live check for a different channel is stale and is not shown as verification", () => {
    const o = op("kiali-ossm", "4.22", "fast", [], { verification: { status: "verified", catalogImage: img("4.22"), channel: "stable", minVersion: "", maxVersion: "" } });
    expect(cellEvidence(o, "4.22", undefined, undefined).label).toBe("not scanned");
  });
});

describe("bulk classification", () => {
  it("applies to the selected operators, keeps categories already set, reports the count, and can be undone", async () => {
    mount();
    await waitFor(() => expect(within(matrix()).getAllByRole("row").length).toBe(3));
    fireEvent.click(screen.getByRole("button", { name: "Select shown (2)" }));
    fireEvent.change(screen.getByRole("combobox", { name: "Category for the selected operators" }), { target: { value: "requested" } });
    fireEvent.click(screen.getByRole("button", { name: "Set for 2 selected" }));
    expect(await screen.findByText(/1 operator\(s\) set to “New: requested for installation”\. 1 kept \(already classified\)/)).toBeInTheDocument();
    expect(fake.intentPosts.at(-1).entries.map((e) => [e.name, e.category, e.confidence])).toEqual([["odf-operator", "requested", "user-entered"]]);
    await waitFor(() => expect(within(row("kiali-ossm")).getByRole("combobox", { name: /category/ })).toHaveValue("installed"));
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    await waitFor(() => expect(fake.intentPosts.at(-1)).toEqual({ remove: ["redhat|odf-operator"], replaceConfirmed: true }));
    await waitFor(() => expect(within(row("odf-operator")).getByRole("combobox", { name: /category/ })).toHaveValue(""));
  });
  it("replaces existing categories only when asked, keeping how each was known", async () => {
    mount();
    await waitFor(() => expect(within(matrix()).getAllByRole("row").length).toBe(3));
    fireEvent.click(screen.getByRole("checkbox", { name: "Select kiali-ossm" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Also replace categories already set" }));
    fireEvent.change(screen.getByRole("combobox", { name: "Category for the selected operators" }), { target: { value: "retained" } });
    fireEvent.click(screen.getByRole("button", { name: "Set for 1 selected" }));
    await screen.findByText(/1 operator\(s\) set to “Installed, kept without an update”/);
    expect(fake.intentPosts.at(-1).entries[0]).toMatchObject({ name: "kiali-ossm", category: "retained", confidence: "cluster-export" });
  });
  it("the selection never includes rows a filter hides", async () => {
    mount();
    await waitFor(() => expect(within(matrix()).getAllByRole("row").length).toBe(3));
    fireEvent.click(screen.getByRole("button", { name: "Select shown (2)" }));
    fireEvent.change(screen.getByRole("searchbox", { name: "Filter operators" }), { target: { value: "odf" } });
    expect(screen.getByRole("button", { name: "Set for 1 selected" })).toBeInTheDocument();
    expect(screen.getByText(/1 operator\(s\) hidden by the filter/)).toBeInTheDocument();
  });
});

describe("coordinated catalog scans", () => {
  it("the plan is deduplicated by catalog minor and records what is cached", () => {
    const views = [view("s1", "4.20.30", "4.20"), view("s2", "4.20.44", "4.20"), view("s3", "4.21.42", "4.21"), view("s4", "4.22.22", "4.22")];
    const plan2 = buildScanPlan(views, { "p-s1": fake.profiles["p-s1"] }, { "4.21": fake.status["4.21"] });
    expect(plan2.map((e) => [e.minor, e.stages.map((s) => s.id), e.cached])).toEqual([["4.20", ["s1", "s2"], false], ["4.21", ["s3"], true], ["4.22", ["s4"], false]]);
    expect(plan2[0].catalogs.redhat).toBe(img("4.20"));
  });
  it("nothing is scanned without an explicit action", async () => {
    setSourceCredential(planCredentialKey(plan.id), { secret: RH }, "scan");
    mount();
    await screen.findByRole("heading", { name: "Catalogs for this route" });
    await act(() => new Promise((r) => setTimeout(r, 80)));
    expect(fake.scanPosts).toEqual([]);
  });
  it("scans the not-yet-scanned minors one at a time with the plan's credential, and updates the matrix as each finishes", async () => {
    setSourceCredential(planCredentialKey(plan.id), { secret: RH }, "scan");
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Scan 2 catalog sets not yet scanned" }));
    await waitFor(() => expect(fake.scanPosts.map((b) => b.catalogMinor)).toEqual(["4.20", "4.22"]));
    expect(fake.scanPosts[0]).toMatchObject({ catalogMinor: "4.20", profileId: "p-s1", rhAuthSource: "inline", pullSecret: RH });
    await waitFor(() => expect(cells("kiali-ossm")[0].textContent).toMatch(/default channel/));
    expect(cells("odf-operator")[0].textContent).toMatch(/stable-4\.20.*default channel/);
    await waitFor(() => expect(screen.getByRole("button", { name: "Every catalog on the route is scanned" })).toBeDisabled());
    expect(JSON.stringify({ ...sessionStorage })).not.toContain(CANARY_AUTH);
    expect(JSON.stringify({ ...localStorage })).not.toContain(CANARY_AUTH);
  });
  it("one minor's failure does not stop the next; it can be rescanned on its own", async () => {
    setSourceCredential(planCredentialKey(plan.id), { secret: RH }, "scan");
    fake.failMinor = "4.20";
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Scan 2 catalog sets not yet scanned" }));
    await waitFor(() => expect(fake.scanPosts.map((b) => b.catalogMinor)).toEqual(["4.20", "4.22"]));
    await waitFor(() => expect(screen.getByText(/Failed: 3 catalog\(s\) did not finish/)).toBeInTheDocument());
    await waitFor(() => expect(cells("kiali-ossm")[0].textContent).toMatch(/scan failed/));
    fake.failMinor = null;
    const panel = screen.getByRole("heading", { name: "Catalogs for this route" }).closest("section");
    const r420 = within(panel).getByText("OpenShift 4.20").closest("li");
    await waitFor(() => expect(within(r420).getByRole("button", { name: "Scan" })).toBeEnabled());
    fireEvent.click(within(r420).getByRole("button", { name: "Scan" }));
    await waitFor(() => expect(fake.scanPosts.map((b) => b.catalogMinor)).toEqual(["4.20", "4.22", "4.20"]));
    await waitFor(() => expect(cells("kiali-ossm")[0].textContent).toMatch(/default channel/));
  });
  it("Stop cancels the running jobs and does not start the remaining minors", async () => {
    setSourceCredential(planCredentialKey(plan.id), { secret: RH }, "scan");
    scanTiming.pollMs = 60;
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Scan 2 catalog sets not yet scanned" }));
    await waitFor(() => expect(fake.scanPosts.length).toBe(1));
    fireEvent.click(screen.getByRole("button", { name: "Stop scanning" }));
    await waitFor(() => expect(fake.stops.length).toBe(3));
    await waitFor(() => expect(screen.getByText("Not started (stopped).")).toBeInTheDocument());
    expect(fake.scanPosts.map((b) => b.catalogMinor)).toEqual(["4.20"]);
  });
  it("automatic scanning happens only after the user allows it for this plan", async () => {
    setSourceCredential(planCredentialKey(plan.id), { secret: RH }, "scan");
    mount();
    await screen.findByRole("heading", { name: "Catalogs for this route" });
    expect(fake.scanPosts).toEqual([]);
    fireEvent.click(screen.getByRole("switch", { name: "Scan new stage catalogs automatically" }));
    await waitFor(() => expect(fake.scanPosts.map((b) => b.catalogMinor)).toEqual(["4.20", "4.22"]));
  });
});
