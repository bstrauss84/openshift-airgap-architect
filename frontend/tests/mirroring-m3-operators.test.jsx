/**
 * v2.2.0 M3 — Mirroring operators: catalog minor rules, search, selection and
 * the scan lifecycle contract, against a stateful fake of the real endpoints
 * (/api/operators/scan|status|credentials, /api/jobs/:id[/stop], profile update).
 *
 * Race scenarios required by the owner:
 *   scan begins → minor changes → old scan completes (results NOT applied);
 *   scan begins → stop → change minor; stop arriving after completion;
 *   repeated scans for the same minor (one request);
 *   navigating away during a scan (remount resumes, applies for same minor);
 *   switching profiles during a scan (no leakage).
 */
import React, { useState } from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup, within, act } from "@testing-library/react";
import { apiFetch } from "../src/api.js";
import OperatorsSection from "../src/mirroring/OperatorsSection.jsx";
import { scanTiming, _resetScanSessionsForTests } from "../src/mirroring/useProfileCatalogs.js";
import { filterOperatorCatalogs, operatorMatches } from "../src/shared/operatorSearch.js";

vi.mock("../src/api.js", () => ({ apiFetch: vi.fn(), API_BASE: "" }));
import { _resetSourceCredentialsForTests } from "../src/mirroring/sourceCredentialSession.js";
beforeEach(() => _resetSourceCredentialsForTests());

/** The mounted pull secret is used only when switched on (FQ-SCAN-1): switch it on when the server has one. */
const armMounted = async () => {
  const sw = await screen.findByRole("switch", { name: /mounted into the container/ }, { timeout: 300 }).catch(() => null);
  if (sw && sw.getAttribute("aria-checked") !== "true") fireEvent.click(sw);
};

const cat = (minor) => ({
  redhat: [
    { id: "redhat:web-terminal", name: "web-terminal", displayName: "Web Terminal", defaultChannel: "fast", catalog: "redhat" },
    { id: "redhat:local-storage-operator", name: "local-storage-operator", displayName: "Local Storage", defaultChannel: "stable", catalog: "redhat" },
    ...(minor === "4.22" ? [{ id: "redhat:only-in-422", name: "only-in-422", displayName: "Only In 4.22", defaultChannel: "stable", catalog: "redhat" }] : [])
  ],
  certified: [{ id: "certified:web-terminal", name: "web-terminal", displayName: "Web Terminal (Partner)", defaultChannel: "stable", catalog: "certified" }],
  community: [{ id: "community:argocd-operator", name: "argocd-operator", displayName: "Argo CD", defaultChannel: "alpha", catalog: "community" }]
});

let fake;
const reset = () => {
  fake = { cache: {}, jobs: {}, seq: 0, scanPosts: [], stops: [], profileWrites: [], profiles: {} };
};
const wrap = (results) => Object.fromEntries(Object.entries(results).map(([k, v]) => [k, { results: v, updatedAt: "2026-10-23T12:00:00Z" }]));

function api(path, options = {}) {
  if (/\/runs$/.test(path)) return Promise.resolve({ runs: [], activeVerification: null });
  const method = options.method || "GET";
  const body = options.body ? JSON.parse(options.body) : undefined;
  if (path === "/api/secrets/rh-pull-secret") return Promise.resolve({ available: true });
  let m = path.match(/^\/api\/operators\/status\?version=(.+)$/);
  if (m) {
    const minor = decodeURIComponent(m[1]);
    return Promise.resolve(fake.cache[minor] ? wrap(fake.cache[minor]) : {});
  }
  if (path === "/api/operators/scan" && method === "POST") {
    fake.scanPosts.push(body);
    const jobs = {};
    for (const c of ["redhat", "certified", "community"]) {
      const id = `job-${body.catalogMinor}-${c}-${++fake.seq}`;
      fake.jobs[id] = { id, status: "running", progress: 10, minor: body.catalogMinor };
      jobs[c] = id;
    }
    return Promise.resolve({ jobs });
  }
  m = path.match(/^\/api\/jobs\/([^/]+)\/stop$/);
  if (m) {
    fake.stops.push(m[1]);
    const j = fake.jobs[m[1]];
    if (!j || j.status !== "running") return Promise.reject(Object.assign(new Error("Job not running."), { status: 404 }));
    j.status = "cancelled";
    return Promise.resolve({ ok: true });
  }
  m = path.match(/^\/api\/jobs\/([^/]+)$/);
  if (m) return fake.jobs[m[1]] ? Promise.resolve(fake.jobs[m[1]]) : Promise.reject(Object.assign(new Error("Job not found"), { status: 404 }));
  m = path.match(/^\/api\/mirroring\/profiles\/([^/]+)$/);
  if (m && method === "POST") {
    const id = decodeURIComponent(m[1]);
    fake.profileWrites.push({ id, body });
    const p = fake.profiles[id];
    if (body.operators) p.operators = { ...p.operators, ...body.operators };
    p.updatedAt = Date.now();
    return Promise.resolve({ ...p });
  }
  return Promise.reject(new Error(`unexpected ${method} ${path}`));
}

/** Completes every running job of a scan for `minor` and seeds the cache like a real scan. */
const finishScan = (minor) => {
  fake.cache[minor] = cat(minor);
  for (const j of Object.values(fake.jobs)) if (j.minor === minor && j.status === "running") { j.status = "completed"; j.progress = 100; }
};

const makeProfile = (id, over = {}) => ({
  id,
  name: id,
  updatedAt: 1,
  content: { platform: false, operators: true, additionalImages: false, ...(over.content || {}) },
  platform: over.platform || { release: {}, version: {} },
  operators: { catalogMinor: null, catalogMinorSource: null, selected: [], ...(over.operators || {}) },
  additionalImages: [],
  paths: {}
});

/** Host that mimics MirroringShell: holds the profile, keys the section by profile id. */
function Host({ initial }) {
  const [profiles, setProfiles] = useState(initial);
  const [activeId, setActiveId] = useState(initial[0].id);
  const active = profiles.find((p) => p.id === activeId);
  return (
    <div>
      {profiles.map((p) => <button key={p.id} type="button" onClick={() => setActiveId(p.id)}>open {p.id}</button>)}
      <button type="button" onClick={() => setActiveId(null)}>navigate away</button>
      {active ? (
        <OperatorsSection
          key={active.id}
          profile={active}
          onProfileChanged={(u) => setProfiles((ps) => ps.map((p) => (p.id === u.id ? { ...p, ...u } : p)))}
        />
      ) : <div>away</div>}
    </div>
  );
}

const mount = (...profiles) => {
  for (const p of profiles) fake.profiles[p.id] = p;
  return render(<Host initial={profiles} />);
};
const minorSelect = () => screen.getByRole("combobox", { name: /Operator catalog minor/ });
const lastOpsWrite = (id) => [...fake.profileWrites].reverse().find((w) => w.id === id && w.body.operators)?.body.operators;

beforeEach(() => {
  reset();
  _resetScanSessionsForTests();
  scanTiming.pollMs = 15;
  vi.mocked(apiFetch).mockReset();
  vi.mocked(apiFetch).mockImplementation(api);
});
afterEach(cleanup);

describe("search helpers", () => {
  it("match display name and package name, every word, case-insensitive", () => {
    const op = { name: "web-terminal", displayName: "Web Terminal" };
    expect(operatorMatches(op, "terminal")).toBe(true);
    expect(operatorMatches(op, "WEB-term")).toBe(true);
    expect(operatorMatches(op, "web storage")).toBe(false);
    const f = filterOperatorCatalogs(cat("4.21"), "web", new Set(["redhat:web-terminal"]));
    expect(f.redhat).toHaveLength(0); // selected ids are excluded from the browser
    expect(f.certified.map((o) => o.id)).toEqual(["certified:web-terminal"]);
  });
});

describe("catalog minor rules", () => {
  it("operators only: a catalog minor is required and never invented; choosing one saves it as the user's", async () => {
    mount(makeProfile("p-a"));
    const sel = minorSelect();
    expect(sel.value).toBe("");
    expect(screen.queryByRole("combobox", { name: "Minor channel" })).toBeNull(); // no platform selector here
    expect(Array.from(sel.querySelectorAll("option")).map((o) => o.value).filter(Boolean)).toEqual(["4.22", "4.21", "4.20"]);
    fireEvent.change(sel, { target: { value: "4.21" } });
    await waitFor(() => expect(lastOpsWrite("p-a")).toMatchObject({ catalogMinor: "4.21", catalogMinorSource: "user" }));
    expect(fake.scanPosts).toHaveLength(0); // choosing a minor never starts a scan
  });

  it("platform + operators: no selector; the catalogs follow the platform minor (revised at M3 acceptance)", async () => {
    // Full coverage of the revised rule lives in mirroring-m4-catalog-ui.test.jsx.
    const p = makeProfile("p-b", {
      content: { platform: true, operators: true },
      platform: { release: { channel: "4.22", patchVersion: "4.22.16" }, version: { selectedMinor: "4.22", locked: true } },
      operators: { catalogMinor: "4.22", catalogMinorSource: "platform" }
    });
    mount(p);
    expect(screen.queryByRole("combobox", { name: /Operator catalog minor/ })).toBeNull();
    expect(screen.getByText(/Operator catalogs follow the selected OpenShift platform minor\./)).toBeTruthy();
    expect(screen.queryByText(/has not verified/)).toBeNull();
  });
});

describe("search and selection", () => {
  it("searching by display or package name never removes a selected operator", async () => {
    fake.cache["4.21"] = cat("4.21");
    mount(makeProfile("p-c", { operators: { catalogMinor: "4.21", catalogMinorSource: "user" } }));
    const search = await screen.findByRole("searchbox", { name: /Search operators/ });
    fireEvent.click(screen.getByRole("button", { name: /Web Terminal Package: web-terminal/ }));
    await waitFor(() => expect(lastOpsWrite("p-c")?.selected?.[0]).toMatchObject({
      name: "web-terminal", catalogImage: "registry.redhat.io/redhat/redhat-operator-index:v4.21", defaultChannel: "fast"
    }));
    fireEvent.change(search, { target: { value: "argo" } });
    expect(screen.getByRole("tab", { name: "Red Hat (0)" })).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: "Community (1)" }));
    expect(screen.getByText("Argo CD")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Remove Web Terminal" })).toBeTruthy(); // still selected
    fireEvent.change(search, { target: { value: "web-terminal" } });
    fireEvent.click(screen.getByRole("tab", { name: "All matches (1)" }));
    expect(screen.getByRole("heading", { name: "Certified (1)" })).toBeTruthy(); // grouped by catalog
  });
});

describe("scan lifecycle and stale-result isolation", () => {
  it("scan begins → minor changes → old scan completes: its results are not applied", async () => {
    fake.cache["4.22"] = cat("4.22");
    mount(makeProfile("p-d", { operators: { catalogMinor: "4.21", catalogMinorSource: "user" } }));
    await armMounted();
    fireEvent.click(await screen.findByRole("button", { name: /Scan catalogs/ }));
    await screen.findByRole("button", { name: "Stop scan" });
    fireEvent.change(minorSelect(), { target: { value: "4.22" } });
    const dialog = screen.getByRole("dialog");
    expect(dialog.textContent).toMatch(/results become stale/);
    fireEvent.click(within(dialog).getByRole("button", { name: /let it finish in the background/ }));
    await waitFor(() => expect(minorSelect().value).toBe("4.22"));
    await screen.findByText("Only In 4.22"); // current minor's catalogs
    finishScan("4.21");
    expect(await screen.findByText(/catalog scan for OpenShift 4\.21 finished after the catalog minor changed to 4\.22/)).toBeTruthy();
    expect(screen.getByText("Only In 4.22")).toBeTruthy(); // 4.22 catalogs not replaced by 4.21's
    expect(screen.queryByRole("button", { name: "Stop scan" })).toBeNull(); // no forever spinner
  });

  it("stop then change: jobs are stopped, a late completion is ignored", async () => {
    mount(makeProfile("p-e", { operators: { catalogMinor: "4.21", catalogMinorSource: "user" } }));
    await armMounted();
    fireEvent.click(await screen.findByRole("button", { name: /Scan catalogs/ }));
    await screen.findByRole("button", { name: "Stop scan" });
    fireEvent.change(minorSelect(), { target: { value: "4.20" } });
    await act(async () => { fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: /Stop the scan and change/ })); });
    expect(fake.stops).toHaveLength(3);
    await waitFor(() => expect(minorSelect().value).toBe("4.20"));
    expect(screen.getByText(/was stopped\. Nothing from it will be applied/)).toBeTruthy();
    finishScan("4.21");
    await new Promise((r) => setTimeout(r, 80));
    expect(screen.queryByText("Web Terminal")).toBeNull(); // nothing from 4.21 appeared
  });

  it("cancellation arriving after completion is harmless and still applies nothing", async () => {
    mount(makeProfile("p-f", { operators: { catalogMinor: "4.21", catalogMinorSource: "user" } }));
    await armMounted();
    fireEvent.click(await screen.findByRole("button", { name: /Scan catalogs/ }));
    await screen.findByRole("button", { name: "Stop scan" });
    for (const j of Object.values(fake.jobs)) j.status = "completed"; // finished server-side, results not yet read
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Stop scan" })); });
    expect(fake.stops).toHaveLength(3); // all answered 404 "not running"
    expect(screen.getByText(/was stopped\. Nothing from it will be applied/)).toBeTruthy();
  });

  it("repeated scan requests for the same minor start one scan", async () => {
    mount(makeProfile("p-g", { operators: { catalogMinor: "4.21", catalogMinorSource: "user" } }));
    await armMounted();
    const btn = await screen.findByRole("button", { name: /Scan catalogs/ });
    fireEvent.click(btn);
    fireEvent.click(btn);
    await screen.findByRole("button", { name: "Stop scan" });
    expect(fake.scanPosts).toHaveLength(1);
    expect(fake.scanPosts[0]).toEqual({ catalogMinor: "4.21", profileId: "p-g", rhAuthSource: "mounted" });
  });

  it("navigating away during a scan does not cancel it; coming back resumes and applies for the same minor", async () => {
    mount(makeProfile("p-h", { operators: { catalogMinor: "4.21", catalogMinorSource: "user" } }));
    await armMounted();
    fireEvent.click(await screen.findByRole("button", { name: /Scan catalogs/ }));
    await screen.findByRole("button", { name: "Stop scan" });
    fireEvent.click(screen.getByRole("button", { name: "navigate away" }));
    expect(fake.stops).toHaveLength(0);
    finishScan("4.21");
    fireEvent.click(screen.getByRole("button", { name: "open p-h" }));
    expect(await screen.findByText("Web Terminal")).toBeTruthy();
  });

  it("switching profiles during a scan: the other profile gets nothing from it", async () => {
    mount(
      makeProfile("p-i", { operators: { catalogMinor: "4.21", catalogMinorSource: "user" } }),
      makeProfile("p-j", { operators: { catalogMinor: "4.20", catalogMinorSource: "user" } })
    );
    await armMounted();
    fireEvent.click(await screen.findByRole("button", { name: /Scan catalogs/ }));
    await screen.findByRole("button", { name: "Stop scan" });
    fireEvent.click(screen.getByRole("button", { name: "open p-j" }));
    await waitFor(() => expect(minorSelect().value).toBe("4.20"));
    expect(screen.queryByRole("button", { name: "Stop scan" })).toBeNull(); // p-j has no scan
    finishScan("4.21");
    await new Promise((r) => setTimeout(r, 80));
    expect(screen.queryByText("Web Terminal")).toBeNull();
    expect(fake.profileWrites.filter((w) => w.id === "p-j" && w.body.operators?.selected?.length)).toHaveLength(0);
  });
});

describe("minor change keeps intent and re-resolves it", () => {
  it("resolved selections become intent, then resolve against the new minor's catalogs", async () => {
    fake.cache["4.21"] = cat("4.21");
    fake.cache["4.22"] = cat("4.22");
    const sel = { id: "redhat:web-terminal", name: "web-terminal", displayName: "Web Terminal", catalog: "redhat", catalogImage: "registry.redhat.io/redhat/redhat-operator-index:v4.21", defaultChannel: "fast" };
    mount(makeProfile("p-k", { operators: { catalogMinor: "4.21", catalogMinorSource: "user", selected: [sel] } }));
    await screen.findByText("Local Storage");
    fireEvent.change(minorSelect(), { target: { value: "4.22" } });
    await waitFor(() => {
      const w = lastOpsWrite("p-k");
      expect(w.selected[0].catalogImage).toBe("registry.redhat.io/redhat/redhat-operator-index:v4.22");
    });
    const intentWrite = fake.profileWrites.find((w) => w.body.operators?.catalogMinor === "4.22");
    expect(intentWrite.body.operators.selected[0].catalogImage).toBeUndefined(); // intent only, nothing fabricated
  });
});
