/**
 * v2.2.0 M4 — operator scan recovery after a full browser reload.
 *
 * M3 kept scan sessions in module memory only, so a reload detached the UI
 * from a scan the server was still running. Sessions are now also kept in
 * sessionStorage (identity only, never a credential) and reattached through
 * the same /api/jobs endpoints. Same rule as before: results only for the
 * minor the profile still has.
 */
import React, { useState } from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup, act } from "@testing-library/react";
import { apiFetch } from "../src/api.js";
import OperatorsSection from "../src/mirroring/OperatorsSection.jsx";
import { scanTiming, _resetScanSessionsForTests, _simulatePageReloadForTests } from "../src/mirroring/useProfileCatalogs.js";

vi.mock("../src/api.js", () => ({ apiFetch: vi.fn(), API_BASE: "" }));
import { _resetSourceCredentialsForTests } from "../src/mirroring/sourceCredentialSession.js";
beforeEach(() => _resetSourceCredentialsForTests());

/** The mounted pull secret is used only when switched on (FQ-SCAN-1): switch it on when the server has one. */
const armMounted = async () => {
  const sw = await screen.findByRole("switch", { name: /mounted into the container/ }, { timeout: 300 }).catch(() => null);
  if (sw && sw.getAttribute("aria-checked") !== "true") fireEvent.click(sw);
};

const SECRET = '{"auths":{"registry.example.invalid":{"auth":"dGVzdDp0ZXN0"}}}';
const catalogs = (minor) => ({
  redhat: [{ id: `redhat:only-${minor}`, name: `only-${minor}`, displayName: `Only In ${minor}`, defaultChannel: "stable", catalog: "redhat" }],
  certified: [], community: []
});
let fake;
function api(path, options = {}) {
  if (/\/runs$/.test(path)) return Promise.resolve({ runs: [], activeVerification: null });
  const body = options.body ? JSON.parse(options.body) : undefined;
  if (path === "/api/secrets/rh-pull-secret") return Promise.resolve({ available: fake.auth });
  let m = path.match(/^\/api\/operators\/status\?version=(.+)$/);
  if (m) {
    const c = fake.cache[decodeURIComponent(m[1])];
    return Promise.resolve(c ? Object.fromEntries(Object.entries(c).map(([k, v]) => [k, { results: v }])) : {});
  }
  if (path === "/api/operators/scan") {
    fake.scanBodies.push(body);
    const jobs = {};
    for (const c of ["redhat", "certified", "community"]) {
      // Real job ids are nanoids ([A-Za-z0-9_-]); keep the fakes in that alphabet.
      const id = `job-${body.catalogMinor.replace(".", "_")}-${c}-${++fake.seq}`;
      fake.jobs[id] = { id, status: "running", progress: 20, minor: body.catalogMinor };
      jobs[c] = id;
    }
    return Promise.resolve({ jobs });
  }
  m = path.match(/^\/api\/jobs\/([^/]+)\/stop$/);
  if (m) {
    fake.stops.push(m[1]);
    const j = fake.jobs[m[1]];
    if (!j || j.status !== "running") return Promise.reject(Object.assign(new Error("not running"), { status: 404 }));
    j.status = "cancelled";
    return Promise.resolve({ ok: true });
  }
  m = path.match(/^\/api\/jobs\/([^/]+)$/);
  if (m) return fake.jobs[m[1]] ? Promise.resolve(fake.jobs[m[1]]) : Promise.reject(Object.assign(new Error("gone"), { status: 404 }));
  if (path.startsWith("/api/mirroring/profiles/")) {
    fake.profile = { ...fake.profile, operators: { ...fake.profile.operators, ...(body.operators || {}) } };
    return Promise.resolve(fake.profile);
  }
  return Promise.reject(new Error(`unexpected ${path}`));
}

const opsOnly = (minor) => ({
  id: "p-reload", name: "reload", updatedAt: 1,
  content: { platform: false, operators: true, additionalImages: false },
  platform: { release: {}, version: {} },
  operators: { catalogMinor: minor, catalogMinorSource: "user", selected: [] },
  additionalImages: [], paths: {}, catalogReconciliation: null
});
function Host({ initial }) {
  const [p, setP] = useState(initial);
  return <OperatorsSection profile={p} onProfileChanged={setP} />;
}
const mount = (p) => { fake.profile = p; return render(<Host initial={p} />); };
const reload = (p) => { cleanup(); _simulatePageReloadForTests(); return mount(p); };
const finish = (minor) => {
  fake.cache[minor] = catalogs(minor);
  for (const j of Object.values(fake.jobs)) if (j.minor === minor && j.status === "running") { j.status = "completed"; j.progress = 100; }
};

beforeEach(() => {
  fake = { cache: {}, jobs: {}, seq: 0, scanBodies: [], stops: [], profile: null, auth: true };
  _resetScanSessionsForTests();
  sessionStorage.clear();
  scanTiming.pollMs = 15;
  vi.mocked(apiFetch).mockReset();
  vi.mocked(apiFetch).mockImplementation(api);
});
afterEach(cleanup);

describe("reload during an active scan", () => {
  it("reattaches: progress and Stop come back, results apply for the same minor", async () => {
    mount(opsOnly("4.21"));
    await armMounted();
    fireEvent.click(await screen.findByRole("button", { name: /Scan catalogs/ }));
    await screen.findByRole("button", { name: "Stop scan" });
    reload(opsOnly("4.21"));
    await screen.findByText(/Reconnected to the scan that was running before the page reloaded/);
    expect(screen.getByRole("button", { name: "Stop scan" })).toBeTruthy();
    expect(fake.scanBodies).toHaveLength(1); // no second scan started
    finish("4.21");
    await screen.findByText("Only In 4.21");
    expect(sessionStorage.getItem("oaa.mirroring.scan.p-reload")).toBeNull();
  });

  it("the minor changed meanwhile: stale banner on return, results never applied", async () => {
    mount(opsOnly("4.21"));
    await armMounted();
    fireEvent.click(await screen.findByRole("button", { name: /Scan catalogs/ }));
    await screen.findByRole("button", { name: "Stop scan" });
    reload(opsOnly("4.22"));
    await screen.findByRole("button", { name: "Stop the 4.21 scan" });
    finish("4.21");
    await screen.findByText(/finished after the catalog minor changed to 4\.22/);
    expect(screen.queryByText("Only In 4.21")).toBeNull();
  });

  it("the server restarted (jobs unknown): reported, nothing applied, session dropped", async () => {
    mount(opsOnly("4.21"));
    await armMounted();
    fireEvent.click(await screen.findByRole("button", { name: /Scan catalogs/ }));
    await screen.findByRole("button", { name: "Stop scan" });
    fake.jobs = {};
    fake.cache["4.21"] = catalogs("4.21"); // even if something is cached, a vanished scan applies nothing new
    reload(opsOnly("4.21"));
    await screen.findByText(/no longer known to the server/);
    expect(sessionStorage.getItem("oaa.mirroring.scan.p-reload")).toBeNull();
    expect(screen.queryByRole("button", { name: "Stop scan" })).toBeNull();
  });

  it("Stop after a reload stops the original jobs", async () => {
    mount(opsOnly("4.21"));
    await armMounted();
    fireEvent.click(await screen.findByRole("button", { name: /Scan catalogs/ }));
    await screen.findByRole("button", { name: "Stop scan" });
    const ids = Object.keys(fake.jobs);
    reload(opsOnly("4.21"));
    fireEvent.click(await screen.findByRole("button", { name: "Stop scan" }));
    await screen.findByText(/was stopped\. Nothing from it will be applied/);
    expect(fake.stops.sort()).toEqual(ids.sort());
  });

  it("the stored session never contains the scan's pull secret", async () => {
    fake.auth = false;
    mount(opsOnly("4.21"));
    const box = await screen.findByRole("textbox", { name: /pull secret JSON for operator discovery/ });
    const show = screen.queryAllByRole("button", { name: "Show" })[0];
    if (show) fireEvent.click(show);
    fireEvent.change(box, { target: { value: SECRET } });
    fireEvent.blur(box);
    await armMounted();
    fireEvent.click(screen.getByRole("button", { name: /Scan catalogs/ }));
    await screen.findByRole("button", { name: "Stop scan" });
    expect(fake.scanBodies[0].pullSecret).toBe(SECRET);
    const stored = Object.keys(sessionStorage).map((k) => sessionStorage.getItem(k)).join("\n");
    expect(stored).toContain("job-4_21");
    expect(stored).not.toContain("dGVzdDp0ZXN0");
  });

  it("a tampered or foreign stored session is ignored", async () => {
    sessionStorage.setItem("oaa.mirroring.scan.p-reload", JSON.stringify({ profileId: "p-other", minor: "4.21", jobs: { redhat: "job-x" } }));
    mount(opsOnly("4.21"));
    await screen.findByRole("button", { name: /Scan catalogs/ });
    expect(screen.queryByText(/Reconnected/)).toBeNull();
    sessionStorage.setItem("oaa.mirroring.scan.p-reload", "{not json");
    reload(opsOnly("4.21"));
    await screen.findByRole("button", { name: /Scan catalogs/ });
  });
});

describe("imported packages resolve within their own catalog", () => {
  it("a channel-less certified package is not moved to the Red Hat catalog", async () => {
    fake.cache["4.22"] = {
      redhat: [{ id: "redhat:dup", name: "dup-operator", displayName: "Dup (Red Hat)", defaultChannel: "rh", catalog: "redhat" }],
      certified: [{ id: "certified:dup", name: "dup-operator", displayName: "Dup (Partner)", defaultChannel: "partner", catalog: "certified" }],
      community: []
    };
    const p = { ...opsOnly("4.22"), operators: { catalogMinor: "4.22", catalogMinorSource: "import", selected: [{ id: "c::dup", name: "dup-operator", catalog: "certified", catalogImage: "registry.redhat.io/redhat/certified-operator-index:v4.22", defaultChannel: null, sources: ["import:imp-0123456789ab"] }] } };
    mount(p);
    await waitFor(() => expect(fake.profile.operators.selected[0].defaultChannel).toBe("partner"));
    expect(fake.profile.operators.selected[0].catalogImage).toBe("registry.redhat.io/redhat/certified-operator-index:v4.22");
    expect(fake.profile.operators.selected[0].verifiedMinor).toBe("4.22");
  });
});
