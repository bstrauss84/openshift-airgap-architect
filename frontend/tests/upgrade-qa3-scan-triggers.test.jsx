/**
 * v2.3.0 owner QA (2026-11-17), P1 — catalog scans restarted repeatedly. Root causes:
 *  1. automatic scanning ran before each minor's cache status had loaded, so cached catalogs looked
 *     unscanned and were downloaded again on every visit to Content;
 *  2. no in-flight guard: React StrictMode's double effect (dev) or a second start launched an
 *     identical scan ~60 ms later;
 *  3. a partly failed minor was retried on every mount.
 */
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, within, cleanup, act } from "@testing-library/react";
import { apiFetch } from "../src/api.js";
import ContentTab from "../src/upgrade/ContentTab.jsx";
import { scanTiming, _resetAutoScanForTests } from "../src/upgrade/RouteCatalogScan.jsx";
import { _resetSourceCredentialsForTests, setSourceCredential, planCredentialKey } from "../src/mirroring/sourceCredentialSession.js";
import { _resetScanSessionsForTests } from "../src/mirroring/useProfileCatalogs.js";

vi.mock("../src/api.js", () => ({ apiFetch: vi.fn(), API_BASE: "" }));
vi.mock("../src/mirroring/MirroringRunPanel.jsx", () => ({ default: () => null }));

const RH = JSON.stringify({ auths: { "registry.redhat.io": { auth: btoa(["u", "triggers-canary"].join(":")) } } });
const img = (m) => `registry.redhat.io/redhat/redhat-operator-index:v${m}`;
const op = (name, minor) => ({ id: `${img(minor)}::${name}`, name, catalog: "redhat", catalogImage: img(minor), defaultChannel: "stable", sources: ["manual"] });
const profile = (id, minor) => ({
  id, name: id, updatedAt: 1, ownedBy: { workflow: "upgrade", planId: "u-trigger0001", stageId: id.slice(2) },
  content: { platform: true, operators: true, additionalImages: false },
  platform: { release: { channel: minor, patchVersion: `${minor}.1` }, version: { selectedMinor: minor, locked: true } },
  operators: { catalogMinor: minor, catalogMinorSource: "platform", selected: [op("kiali-ossm", minor)] }, additionalImages: [],
  catalogReconciliation: { platformMinor: minor, catalogMinor: minor, source: "platform", conflict: false }, paths: {}
});
const view = (id, release, minor) => ({ id, release, minor, linkedProfileId: `p-${id}`, content: { state: "planned", evidence: [] }, clusterUpdated: "none" });
const full = () => ({ redhat: { results: [{ name: "kiali-ossm", defaultChannel: "stable" }], updatedAt: Date.now() }, certified: { results: [], updatedAt: Date.now() }, community: { results: [], updatedAt: Date.now() } });
const plan = {
  id: "u-trigger0001", name: "Prod", kind: "planned", path: { path: ["4.20.8", "4.20.46", "4.21.42", "4.22.22"], hops: [] },
  stages: [{ id: "s1", release: "4.20.46" }, { id: "s2", release: "4.21.42" }, { id: "s3", release: "4.22.22" }],
  stageViews: [view("s1", "4.20.46", "4.20"), view("s2", "4.21.42", "4.21"), view("s3", "4.22.22", "4.22")], operatorIntent: []
};
let fake;
beforeEach(() => {
  fake = { status: { "4.20": full(), "4.21": full() }, statusDelay: 0, scanPosts: [], jobs: {}, seq: 0, intentPosts: [] };
  sessionStorage.clear();
  _resetSourceCredentialsForTests();
  _resetAutoScanForTests();
  _resetScanSessionsForTests();
  scanTiming.pollMs = 10;
  setSourceCredential(planCredentialKey(plan.id), { secret: RH }, "scan");
  vi.mocked(apiFetch).mockReset();
  vi.mocked(apiFetch).mockImplementation((p, opts = {}) => {
    const body = opts.body ? JSON.parse(opts.body) : undefined;
    if (p === "/api/mirroring") return Promise.resolve({ profiles: [profile("p-s1", "4.20"), profile("p-s2", "4.21"), profile("p-s3", "4.22")] });
    let m = p.match(/^\/api\/operators\/status\?version=(.+)$/);
    if (m) { const v = decodeURIComponent(m[1]); return new Promise((r) => setTimeout(() => r(fake.status[v] || {}), fake.statusDelay)); }
    if (p === "/api/operators/scan") {
      fake.scanPosts.push(body);
      const jobs = {};
      for (const k of body.catalogs || ["redhat", "certified", "community"]) { const id = `j-${body.catalogMinor}-${k}-${++fake.seq}`; fake.jobs[id] = { minor: body.catalogMinor, polls: 0 }; jobs[k] = id; }
      return Promise.resolve({ jobs, reused: [] });
    }
    m = p.match(/^\/api\/jobs\/([^/]+)$/);
    if (m) {
      const j = fake.jobs[m[1]];
      j.polls += 1;
      if (j.polls < 2) return Promise.resolve({ status: "running", progress: 50 });
      fake.status[j.minor] = full();
      return Promise.resolve({ status: "completed", progress: 100 });
    }
    if (p.endsWith("/operator-intent")) { fake.intentPosts.push(body); return Promise.resolve({ plan: { ...plan, operatorIntent: (body.entries || []).map((e) => ({ ...e, key: `${e.catalogKind}|${e.name}` })) }, skipped: [] }); }
    if (/\/runs$/.test(p)) return Promise.resolve({ runs: [], activeVerification: null });
    return Promise.resolve({});
  });
});
afterEach(cleanup);

const enableAuto = () => fireEvent.click(screen.getByRole("switch", { name: "Scan new stage catalogs automatically" }));
const settle = (ms = 250) => act(() => new Promise((r) => setTimeout(r, ms)));

describe("scans start only when they should", () => {
  it("automatic scanning waits for the cache status and never rescans cached minors", async () => {
    fake.statusDelay = 150;
    const first = render(<ContentTab plan={plan} onPlanChanged={() => {}} credentialKey={planCredentialKey(plan.id)} />);
    await screen.findByRole("heading", { name: "Catalogs for this route" });
    enableAuto();
    await waitFor(() => expect(fake.scanPosts.map((b) => b.catalogMinor)).toEqual(["4.22"]));
    await settle(400);
    expect(fake.scanPosts.map((b) => b.catalogMinor)).toEqual(["4.22"]);
    // Navigating away and back (remount, auto still on): nothing is downloaded again.
    first.unmount();
    render(<ContentTab plan={plan} onPlanChanged={() => {}} credentialKey={planCredentialKey(plan.id)} />);
    await screen.findByRole("heading", { name: "Catalogs for this route" });
    await settle(500);
    expect(fake.scanPosts.length).toBe(1);
  });

  it("StrictMode's double effect does not start the same scan twice", async () => {
    fake.status = {};
    render(<React.StrictMode><ContentTab plan={plan} onPlanChanged={() => {}} credentialKey={planCredentialKey(plan.id)} /></React.StrictMode>);
    await screen.findByRole("heading", { name: "Catalogs for this route" });
    enableAuto();
    await waitFor(() => expect(fake.scanPosts.length).toBe(3));
    await settle(400);
    expect(fake.scanPosts.map((b) => b.catalogMinor)).toEqual(["4.20", "4.21", "4.22"]);
  });

  it("a failed minor is not retried automatically on later visits; Scan still works on request", async () => {
    fake.status = { "4.20": full(), "4.21": full() };
    const first = render(<ContentTab plan={plan} onPlanChanged={() => {}} credentialKey={planCredentialKey(plan.id)} />);
    await screen.findByRole("heading", { name: "Catalogs for this route" });
    // The 4.22 scan fails: jobs never complete because they report failure.
    vi.mocked(apiFetch).mockImplementation(((orig) => (p, opts) => (/^\/api\/jobs\/j-4\.22/.test(p) ? Promise.resolve({ status: "failed", message: "boom" }) : orig(p, opts)))(vi.mocked(apiFetch).getMockImplementation()));
    enableAuto();
    await waitFor(() => expect(screen.getByText(/Failed:/)).toBeInTheDocument());
    first.unmount();
    render(<ContentTab plan={plan} onPlanChanged={() => {}} credentialKey={planCredentialKey(plan.id)} />);
    await screen.findByRole("heading", { name: "Catalogs for this route" });
    await settle(400);
    expect(fake.scanPosts.length).toBe(1);
    const panel = screen.getByRole("heading", { name: "Catalogs for this route" }).closest("section");
    fireEvent.click(within(within(panel).getByText("OpenShift 4.22").closest("li")).getByRole("button", { name: "Scan" }));
    await waitFor(() => expect(fake.scanPosts.length).toBe(2));
  });

  it("a partly scanned minor rescans only its missing catalogs", async () => {
    fake.status = { "4.20": full(), "4.21": full(), "4.22": { ...full(), community: { results: [], updatedAt: null } } };
    render(<ContentTab plan={plan} onPlanChanged={() => {}} credentialKey={planCredentialKey(plan.id)} />);
    const panel = (await screen.findByRole("heading", { name: "Catalogs for this route" })).closest("section");
    await waitFor(() => expect(within(panel).getByText(/Partly scanned — Community missing/)).toBeInTheDocument());
    fireEvent.click(within(within(panel).getByText("OpenShift 4.22").closest("li")).getByRole("button", { name: "Scan missing" }));
    await waitFor(() => expect(fake.scanPosts[0]).toMatchObject({ catalogMinor: "4.22", catalogs: ["community"] }));
  });

  it("changing an operator's “on the cluster” note never starts a scan", async () => {
    fake.status = {};
    render(<ContentTab plan={plan} onPlanChanged={() => {}} credentialKey={planCredentialKey(plan.id)} />);
    fireEvent.click(await screen.findByRole("switch", { name: "Note which operators are already installed" }));
    const sel = await screen.findByRole("combobox", { name: /kiali-ossm on the cluster/ });
    fireEvent.change(sel, { target: { value: "installed" } });
    await waitFor(() => expect(fake.intentPosts.length).toBe(1));
    await settle(300);
    expect(fake.scanPosts).toEqual([]);
  });
});
