/**
 * v2.2.0 M4 — Mirroring operators UI under the revised catalog rule
 * (M3 acceptance, 2026-10-26): with platform content the catalogs follow the
 * platform minor; a preserved conflict offers align / split; a platform-minor
 * change during a scan never applies that scan's results. Plus the compact
 * Remove controls and the search layout the owner asked for.
 */
import React, { useState } from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup, act } from "@testing-library/react";
import { apiFetch } from "../src/api.js";
import OperatorsSection from "../src/mirroring/OperatorsSection.jsx";
import AdditionalImagesEditor from "../src/mirroring/AdditionalImagesEditor.jsx";
import { scanTiming, _resetScanSessionsForTests } from "../src/mirroring/useProfileCatalogs.js";

vi.mock("../src/api.js", () => ({ apiFetch: vi.fn(), API_BASE: "" }));
import { _resetSourceCredentialsForTests } from "../src/mirroring/sourceCredentialSession.js";
beforeEach(() => _resetSourceCredentialsForTests());

/** The mounted pull secret is used only when switched on (FQ-SCAN-1): switch it on when the server has one. */
const armMounted = async () => {
  const sw = await screen.findByRole("switch", { name: /mounted into the container/ }, { timeout: 300 }).catch(() => null);
  if (sw && sw.getAttribute("aria-checked") !== "true") fireEvent.click(sw);
};

const catalogs = (minor) => ({
  redhat: [
    { id: "redhat:web-terminal", name: "web-terminal", displayName: "Web Terminal", defaultChannel: "fast", catalog: "redhat" },
    { id: `redhat:only-${minor}`, name: `only-${minor}`, displayName: `Only In ${minor}`, defaultChannel: "stable", catalog: "redhat" }
  ],
  certified: [],
  community: []
});
const wrap = (r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, { results: v, updatedAt: "2026-10-26T12:00:00Z" }]));

let fake;
function api(path, options = {}) {
  if (/\/runs$/.test(path)) return Promise.resolve({ runs: [], activeVerification: null });
  const method = options.method || "GET";
  const body = options.body ? JSON.parse(options.body) : undefined;
  if (path === "/api/secrets/rh-pull-secret") return Promise.resolve({ available: true });
  let m = path.match(/^\/api\/operators\/status\?version=(.+)$/);
  if (m) return Promise.resolve(fake.cache[decodeURIComponent(m[1])] ? wrap(fake.cache[decodeURIComponent(m[1])]) : {});
  if (path === "/api/operators/scan") {
    fake.scanPosts.push(body);
    const jobs = {};
    for (const c of ["redhat", "certified", "community"]) {
      const id = `job-${body.catalogMinor}-${c}-${++fake.seq}`;
      fake.jobs[id] = { id, status: "running", progress: 5, minor: body.catalogMinor };
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
  m = path.match(/^\/api\/mirroring\/profiles\/([^/]+)\/reconcile-catalog$/);
  if (m) {
    fake.reconciles.push(body.action);
    const p = fake.profile;
    if (body.action === "align") {
      return Promise.resolve({ profile: { ...p, operators: { ...p.operators, catalogMinor: "4.22", catalogMinorSource: "platform", selected: p.operators.selected.map((o) => ({ id: o.id, name: o.name })) }, catalogReconciliation: { ...p.catalogReconciliation, conflict: false, catalogMinor: "4.22", source: "platform" } } });
    }
    return Promise.resolve({
      profile: { ...p, content: { ...p.content, operators: false }, operators: { catalogMinor: null, catalogMinorSource: null, selected: [] }, catalogReconciliation: null },
      newProfile: { id: "p-new", name: "split" }
    });
  }
  m = path.match(/^\/api\/mirroring\/profiles\/([^/]+)$/);
  if (m) {
    fake.writes.push(body);
    fake.profile = { ...fake.profile, operators: { ...fake.profile.operators, ...(body.operators || {}) } };
    return Promise.resolve(fake.profile);
  }
  return Promise.reject(new Error(`unexpected ${method} ${path}`));
}

const platformProfile = (minor, over = {}) => ({
  id: "p-plat",
  name: "plat",
  updatedAt: 1,
  content: { platform: true, operators: true, additionalImages: false },
  platform: { release: { channel: minor, patchVersion: `${minor}.18` }, version: { selectedMinor: minor, locked: false } },
  operators: { catalogMinor: minor, catalogMinorSource: "platform", selected: [] },
  additionalImages: [],
  catalogReconciliation: { platformMinor: minor, catalogMinor: minor, source: "platform", conflict: false },
  paths: {},
  ...over
});

/** Host that lets a test play "the server re-derived the profile". */
let setHostProfile;
let profilesChanged;
function Host({ initial }) {
  const [p, setP] = useState(initial);
  setHostProfile = setP;
  return <OperatorsSection profile={p} onProfileChanged={setP} onProfilesChanged={profilesChanged} />;
}

beforeEach(() => {
  fake = { cache: {}, jobs: {}, seq: 0, scanPosts: [], stops: [], writes: [], reconciles: [], profile: null };
  _resetScanSessionsForTests();
  sessionStorage.clear();
  scanTiming.pollMs = 15;
  profilesChanged = vi.fn(() => Promise.resolve());
  vi.mocked(apiFetch).mockReset();
  vi.mocked(apiFetch).mockImplementation(api);
});
afterEach(cleanup);

/** The server re-derived the profile (e.g. the platform release changed). */
const serverDerives = (p) => {
  fake.profile = p;
  setHostProfile(p);
};

const mount = (p) => {
  fake.profile = p;
  return render(<Host initial={p} />);
};

describe("platform + operators: catalogs follow the platform minor", () => {
  it("shows the derived minor with the owner's explanation, no selector and no mismatch warning", async () => {
    fake.cache["4.22"] = catalogs("4.22");
    mount(platformProfile("4.22"));
    expect(screen.queryByRole("combobox", { name: /catalog minor/i })).toBeNull();
    expect(screen.getByText("Operator catalogs follow the selected OpenShift platform minor.", { exact: false })).toBeTruthy();
    expect(screen.getByText("OpenShift 4.22")).toBeTruthy();
    await screen.findByText("Only In 4.22");
    expect(screen.queryByText(/differ/)).toBeNull();
    // Choosing an operator never writes a catalog minor: the server derives it.
    fireEvent.click(screen.getByRole("button", { name: /Web Terminal Package: web-terminal/ }));
    await waitFor(() => expect(fake.writes.length).toBeGreaterThan(0));
    expect(fake.writes.every((w) => !("catalogMinor" in (w.operators || {})))).toBe(true);
    expect(fake.writes.at(-1).operators.selected[0].catalogImage).toBe("registry.redhat.io/redhat/redhat-operator-index:v4.22");
  });

  it("platform 4.21 -> 4.22: the section follows, takes the server's intent list and loads 4.22 catalogs", async () => {
    fake.cache["4.21"] = catalogs("4.21");
    fake.cache["4.22"] = catalogs("4.22");
    mount(platformProfile("4.21", { operators: { catalogMinor: "4.21", catalogMinorSource: "platform", selected: [{ id: "redhat:web-terminal", name: "web-terminal", displayName: "Web Terminal", catalogImage: "registry.redhat.io/redhat/redhat-operator-index:v4.21", defaultChannel: "fast", verifiedMinor: "4.21" }] } }));
    await screen.findByText("Only In 4.21");
    // The server derived 4.22 and returned the selection as intent.
    act(() => serverDerives(platformProfile("4.22", { operators: { catalogMinor: "4.22", catalogMinorSource: "platform", selected: [{ id: "redhat:web-terminal", name: "web-terminal", displayName: "Web Terminal" }] } })));
    await screen.findByText("Only In 4.22");
    expect(screen.queryByText("Only In 4.21")).toBeNull();
    // Re-resolved from the 4.22 catalogs (not re-tagged from 4.21).
    await waitFor(() => expect(fake.writes.at(-1)?.operators.selected[0]).toMatchObject({ catalogImage: "registry.redhat.io/redhat/redhat-operator-index:v4.22", defaultChannel: "fast", verifiedMinor: "4.22" }));
  });

  it("platform minor changes during a scan: stale banner, results never applied, Stop offered", async () => {
    mount(platformProfile("4.21"));
    await armMounted();
    fireEvent.click(await screen.findByRole("button", { name: /Scan catalogs/ }));
    await screen.findByRole("button", { name: "Stop scan" });
    act(() => serverDerives(platformProfile("4.22")));
    const stopOld = await screen.findByRole("button", { name: "Stop the 4.21 scan" });
    expect(screen.getByText(/changed to OpenShift 4\.22 while catalogs for OpenShift 4\.21 were being scanned/)).toBeTruthy();
    // The old scan completes anyway...
    fake.cache["4.21"] = catalogs("4.21");
    for (const j of Object.values(fake.jobs)) j.status = "completed";
    await screen.findByText(/finished after the catalog minor changed to 4\.22/);
    expect(screen.queryByText("Only In 4.21")).toBeNull();
    expect(stopOld).toBeTruthy();
  });

  it("stopping the stale scan stops its jobs and applies nothing", async () => {
    mount(platformProfile("4.21"));
    await armMounted();
    fireEvent.click(await screen.findByRole("button", { name: /Scan catalogs/ }));
    await screen.findByRole("button", { name: "Stop scan" });
    act(() => serverDerives(platformProfile("4.22")));
    fireEvent.click(await screen.findByRole("button", { name: "Stop the 4.21 scan" }));
    await screen.findByText(/was stopped\. Nothing from it will be applied/);
    expect(fake.stops).toHaveLength(3);
  });
});

describe("preserved conflict: explicit reconciliation", () => {
  const conflicted = () => platformProfile("4.22", {
    operators: { catalogMinor: "4.21", catalogMinorSource: "import", selected: [{ id: "x", name: "web-terminal", catalogImage: "registry.redhat.io/redhat/redhat-operator-index:v4.21", defaultChannel: "stable-1.x" }] },
    catalogReconciliation: { platformMinor: "4.22", catalogMinor: "4.21", source: "import", conflict: true }
  });

  it("explains the difference without a compatibility claim, offers align and split, and scans nothing", async () => {
    mount(conflicted());
    expect(screen.getByText(/Operator catalogs and platform release differ/)).toBeTruthy();
    expect(screen.getByText(/from an imported file/)).toBeTruthy();
    expect(screen.queryByText(/\bcompatible\b/i)).toBeNull();
    expect(screen.queryByRole("button", { name: /Scan catalogs/ })).toBeNull();
    expect(screen.queryByRole("searchbox")).toBeNull();
    expect(vi.mocked(apiFetch).mock.calls.some(([p]) => String(p).startsWith("/api/operators/status"))).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Use the OpenShift 4.22 catalogs" }));
    await waitFor(() => expect(fake.reconciles).toEqual(["align"]));
    await waitFor(() => expect(screen.queryByText(/Operator catalogs and platform release differ/)).toBeNull());
  });

  it("split refreshes the profile list", async () => {
    mount(conflicted());
    fireEvent.click(screen.getByRole("button", { name: "Move these operators to a new 4.21 profile" }));
    await waitFor(() => expect(fake.reconciles).toEqual(["split"]));
    await waitFor(() => expect(profilesChanged).toHaveBeenCalled());
  });
});

describe("operators only", () => {
  it("requires an explicit catalog minor and writes it as the user's choice", async () => {
    const p = { ...platformProfile("4.22"), content: { platform: false, operators: true, additionalImages: false }, platform: { release: {}, version: {} }, operators: { catalogMinor: null, catalogMinorSource: null, selected: [] }, catalogReconciliation: null };
    mount(p);
    const select = screen.getByRole("combobox", { name: /Operator catalog minor/ });
    expect(select.value).toBe("");
    fireEvent.change(select, { target: { value: "4.20" } });
    await waitFor(() => expect(fake.writes.at(-1).operators).toMatchObject({ catalogMinor: "4.20", catalogMinorSource: "user" }));
  });
});

describe("compact controls and search layout (owner M3 feedback)", () => {
  it("search has a short placeholder and sits with the available operators, above the selected list", async () => {
    fake.cache["4.22"] = catalogs("4.22");
    const { container } = mount(platformProfile("4.22"));
    const search = await screen.findByRole("searchbox", { name: /Search operators/ });
    expect(search.getAttribute("placeholder")).toBe("Search by name or package");
    const browserTitle = screen.getByRole("heading", { name: /Available operators/ });
    const selectedTitle = screen.getByRole("heading", { name: /^Selected \(\d+\)$/ }); // R-UX06 panel beside the browser
    // Document order: available operators (with search) before selected operators.
    expect(browserTitle.compareDocumentPosition(selectedTitle) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(container.querySelector(".operator-search-field input")).toBe(search);
  });

  it("selected-operator and image Remove controls are compact secondary buttons", async () => {
    fake.cache["4.22"] = catalogs("4.22");
    mount(platformProfile("4.22", { operators: { catalogMinor: "4.22", catalogMinorSource: "platform", selected: [{ id: "redhat:web-terminal", name: "web-terminal", displayName: "Web Terminal", catalogImage: "registry.redhat.io/redhat/redhat-operator-index:v4.22", defaultChannel: "fast" }] } }));
    const remove = await screen.findByRole("button", { name: "Remove Web Terminal" });
    expect(remove.className).toMatch(/\bghost\b/);
    expect(remove.className).toMatch(/\bmini\b/);
    cleanup();
    vi.mocked(apiFetch).mockImplementation(() => Promise.resolve({}));
    render(<AdditionalImagesEditor profile={{ id: "p-i", name: "i", content: { additionalImages: true }, additionalImages: [{ id: "img-aaaa0001", name: "quay.io/a/b:1", source: "user" }] }} onProfileChanged={() => {}} />);
    const rm = screen.getByRole("button", { name: "Remove image 1" });
    expect(rm.className).toMatch(/\bmini\b/);
    // Remove is a direct child of the row, next to the field stack, so CSS
    // can anchor it to the input row; the error stays inside the support band.
    const row = rm.closest("li");
    expect(rm.parentElement).toBe(row);
    const input = screen.getByRole("textbox", { name: /Image 1/ });
    fireEvent.change(input, { target: { value: "bad ref" } });
    fireEvent.blur(input);
    const err = row.querySelector(".field-error");
    expect(err.closest(".field-control-support")).toBeTruthy();
    expect(rm.parentElement).toBe(row);
    // The "rows need attention" summary renders BELOW the rows, so its arrival
    // cannot push a row (or its Remove control) down. Found by browser QA.
    const summary = screen.getByText(/image row\(s\) need attention/);
    expect(row.compareDocumentPosition(summary) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

describe("selection-first layout (R-UX06)", () => {
  it("adding shows the operator in Selected at once and announces it; narrow screens switch Browse | Selected (n)", async () => {
    fake.cache["4.22"] = catalogs("4.22");
    const original = window.matchMedia;
    window.matchMedia = (q) => ({ matches: q === "(max-width: 900px)", media: q, addEventListener() {}, removeEventListener() {} });
    try {
      mount(platformProfile("4.22"));
      const browse = await screen.findByRole("button", { name: "Browse" });
      expect(browse).toHaveAttribute("aria-pressed", "true");
      fireEvent.click(await screen.findByRole("button", { name: /^Web Terminal/ }));
      expect(screen.getByText("Added Web Terminal. Selected: 1.")).toBeInTheDocument();
      const selectedBtn = screen.getByRole("button", { name: "Selected (1)" });
      fireEvent.click(selectedBtn);
      expect(selectedBtn).toHaveAttribute("aria-pressed", "true");
      expect(screen.getByRole("list", { name: "Selected operators" })).toBeVisible();
    } finally {
      window.matchMedia = original;
    }
  });
});
