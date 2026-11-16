/**
 * v2.2.0 Mirroring M5 — run options, credentials, catalog check, preflight,
 * mirror to disk, Stop, history and plans, through the real components.
 *
 * Validation timing (design system): no error on first render; a field's
 * message appears after blur, after Run preflight (an attempted action), or
 * when the server reports it. Credentials are only ever sent to the preflight,
 * run and catalog-check endpoints, never in a profile write. Statuses are
 * spelled out in text.
 */
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup, within, act } from "@testing-library/react";
import MirroringRunPanel from "../src/mirroring/MirroringRunPanel.jsx";
import SelectedOperatorsPanel from "../src/mirroring/SelectedOperatorsPanel.jsx";
import { _resetSourceCredentialsForTests } from "../src/mirroring/sourceCredentialSession.js";
import PreflightChecklist, { summarizePreflight } from "../src/components/PreflightChecklist.jsx";
import { findSupportPlacementViolations, findBandOrderViolations } from "./helpers/fieldSupportStructure.js";
import { apiFetch } from "../src/api.js";

vi.mock("../src/api.js", () => ({ apiFetch: vi.fn(), API_BASE: "" }));

const SECRET = '{"auths":{"registry.redhat.io":{"auth":"c3ludGhldGljOnVp"}}}';
const CATALOG = "registry.redhat.io/redhat/redhat-operator-index:v4.22";

const baseProfile = (extra = {}) => ({
  id: "p-ui00000005",
  name: "M5 profile",
  updatedAt: 1,
  content: { platform: false, operators: false, additionalImages: true },
  platform: { release: {}, version: {} },
  operators: { catalogMinor: null, selected: [] },
  additionalImages: [{ id: "img-aaaa", name: "registry.example.invalid/a:1", source: "user" }],
  options: {},
  execution: { mode: "mirrorToDisk", registryUrl: "", options: {} },
  history: [],
  paths: { root: "/data/oc-mirror/profiles/p-ui00000005", archivePath: "/data/oc-mirror/profiles/p-ui00000005/archives", workspacePath: "/data/oc-mirror/profiles/p-ui00000005/workspace", cachePath: "/data/oc-mirror/profiles/p-ui00000005/cache" },
  ...extra
});

const passItems = [
  { id: "profile", status: "pass", label: "Profile content", detail: "M5 profile: 1 additional image(s)." },
  { id: "catalogs", status: "unverified", label: "Live catalog check", detail: "1 of 1 operator(s) have not been checked." },
  { id: "tool", status: "pass", label: "oc-mirror binary", detail: "4.22.0 · SHA-256 abc" }
];

let server;
const calls = (pathRe, method) => vi.mocked(apiFetch).mock.calls.filter(([p, o]) => pathRe.test(p) && (o?.method || "GET") === method);

const installApi = () => {
  vi.mocked(apiFetch).mockImplementation((path, opts = {}) => {
    const method = opts.method || "GET";
    const body = opts.body ? JSON.parse(opts.body) : undefined;
    if (path === "/api/secrets/rh-pull-secret") return Promise.resolve({ available: server.mounted });
    if (/\/runs$/.test(path)) return Promise.resolve({ runs: server.runs, activeVerification: null });
    if (/\/preflight$/.test(path)) return Promise.resolve(server.preflight);
    if (/\/run$/.test(path)) return Promise.resolve({ jobId: "job-run-1" });
    if (/\/verify-catalogs$/.test(path)) return Promise.resolve({ jobId: "job-verify-1" });
    if (/\/plans\//.test(path)) return Promise.resolve(server.plan);
    if (/^\/api\/jobs\/[^/]+\/stop$/.test(path)) { server.jobs[path.split("/")[3]].status = "cancelled"; return Promise.resolve({ ok: true }); }
    if (/^\/api\/jobs\//.test(path)) return Promise.resolve({ ...server.jobs[path.split("/")[3]] }); // a fresh object per response, as over HTTP
    if (/^\/api\/mirroring\/profiles\/[^/]+$/.test(path) && method === "POST") {
      server.writes.push(body);
      return Promise.resolve(baseProfile({ ...(body.options ? { options: body.options } : {}), execution: { mode: "mirrorToDisk", registryUrl: "", options: body.execution?.options || {} }, updatedAt: 2 }));
    }
    return Promise.reject(new Error(`unexpected ${method} ${path}`));
  });
};

beforeEach(() => {
  server = {
    mounted: false,
    runs: [],
    writes: [],
    preflight: { ok: true, blockers: [], warnings: [], fieldErrors: {}, items: passItems },
    jobs: {
      "job-run-1": { id: "job-run-1", status: "running", progress: 0, message: "oc-mirror running.", output: "ARGV: --config /plan/imageset-config.yaml\n2026/10/27 \u001b[1;94m [INFO] \u001b[0m  : line two" },
      "job-verify-1": { id: "job-verify-1", status: "completed_with_warnings", progress: 100, message: "Checked 1 of 1 operator(s): 0 verified, 0 not found, 0 with no version in range, 1 not checked." }
    },
    plan: { plan: { planId: "plan-20261027T120000Z-abcdef", createdAt: "2026-10-27T12:00:00.000Z", workflow: { mode: "mirrorToDisk", dryRun: false }, imagesetConfig: { sha256: "f".repeat(64) }, tool: { version: "4.22.0", sha256: "a".repeat(64) }, execution: { archiveDir: "/data/a" } }, imagesetConfig: "kind: ImageSetConfiguration\n" }
  };
  vi.mocked(apiFetch).mockReset();
  installApi();
  _resetSourceCredentialsForTests();
});
afterEach(cleanup);

const renderPanel = (profile = baseProfile(), handlers = {}) => {
  const onProfileChanged = handlers.onProfileChanged || vi.fn();
  const onProfilesChanged = handlers.onProfilesChanged || vi.fn();
  const utils = render(<MirroringRunPanel profile={profile} onProfileChanged={onProfileChanged} onProfilesChanged={onProfilesChanged} />);
  return { ...utils, onProfileChanged, onProfilesChanged };
};

describe("run options", () => {
  it("no error on first render; an invalid value shows its message after blur, in its own support band", async () => {
    const { container } = renderPanel(baseProfile({ execution: { mode: "mirrorToDisk", options: { parallelImages: 16 } } }));
    expect(container.querySelectorAll(".field-error")).toHaveLength(0);
    const archive = screen.getByLabelText(/Archive size \(GiB\)/);
    fireEvent.change(archive, { target: { value: "4.5" } });
    expect(container.querySelectorAll(".field-error")).toHaveLength(0);
    fireEvent.blur(archive);
    expect(await screen.findByText("Archive size must be a whole number of GiB, at least 1.")).toBeInTheDocument();
    expect(archive).toHaveAttribute("aria-invalid", "true");
    expect(server.writes).toHaveLength(0);
    fireEvent.blur(screen.getByLabelText(/Parallel images/));
    expect(screen.getByText("Parallel images must be a whole number from 1 to 10.")).toBeInTheDocument();
    expect(findSupportPlacementViolations(container)).toEqual([]);
    expect(findBandOrderViolations(container)).toEqual([]);
  });

  it("every error visible at once (after an attempted preflight): structure holds", async () => {
    const { container } = renderPanel();
    for (const [label, value] of [[/Archive size/, "0"], [/Retry times/, "11"], [/Retry delay/, "soon"], [/Image timeout/, "ten"]]) {
      fireEvent.change(screen.getByLabelText(label), { target: { value } });
    }
    fireEvent.change(screen.getByLabelText(/Parallel layers/), { target: { value: "0" } });
    fireEvent.click(screen.getByRole("button", { name: "Run preflight" }));
    await waitFor(() => expect(container.querySelectorAll(".field-error").length).toBeGreaterThanOrEqual(5));
    expect(findSupportPlacementViolations(container)).toEqual([]);
    expect(findBandOrderViolations(container)).toEqual([]);
  });

  it("a valid value is saved on blur — and a pull secret never travels with a profile write", async () => {
    const { onProfileChanged } = renderPanel();
    fireEvent.change(screen.getByLabelText(/pull secret/i), { target: { value: SECRET } });
    fireEvent.blur(screen.getByLabelText(/pull secret/i));
    fireEvent.change(screen.getByLabelText(/Archive size/), { target: { value: "8" } });
    fireEvent.blur(screen.getByLabelText(/Archive size/));
    await waitFor(() => expect(server.writes).toHaveLength(1));
    expect(server.writes[0]).toEqual({ options: { archiveSize: 8 } });
    fireEvent.change(screen.getByLabelText(/Parallel images/), { target: { value: "8" } });
    fireEvent.blur(screen.getByLabelText(/Parallel images/));
    await waitFor(() => expect(server.writes).toHaveLength(2));
    expect(server.writes[1]).toEqual({ execution: { options: { parallelImages: 8 } } });
    expect(JSON.stringify(server.writes)).not.toContain("auths");
    expect(onProfileChanged).toHaveBeenCalled();
  });

  it("parallelism inputs advertise the binary's range, 1–10", () => {
    renderPanel();
    for (const label of [/Parallel images/, /Parallel layers/]) {
      const input = screen.getByLabelText(label);
      expect(input).toHaveAttribute("min", "1");
      expect(input).toHaveAttribute("max", "10");
    }
  });
});

describe("preflight and run", () => {
  it("preflight sends the credentials for this run only; results read as text; then confirm, run, live log, Stop", async () => {
    const { onProfilesChanged } = renderPanel();
    expect(screen.getByRole("button", { name: "Mirror to disk" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/pull secret/i), { target: { value: SECRET } });
    fireEvent.blur(screen.getByLabelText(/pull secret/i));
    fireEvent.click(screen.getByRole("button", { name: "Run preflight" }));
    await screen.findByText("Ready to run.");
    const [, opts] = calls(/\/preflight$/, "POST")[0];
    expect(JSON.parse(opts.body)).toEqual({ mode: "mirrorToDisk", dryRun: false, rhAuthSource: "inline", rhPullSecret: SECRET });
    const list = screen.getByRole("list", { name: "" });
    expect(within(list).getAllByText("Passed")).toHaveLength(2);
    expect(within(list).getByText("Not verified")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Mirror to disk" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Mirror to Disk")).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: /Confirm|Run/ }));
    await waitFor(() => expect(calls(/\/run$/, "POST")).toHaveLength(1));
    expect(JSON.parse(calls(/\/run$/, "POST")[0][1].body)).toMatchObject({ mode: "mirrorToDisk", rhPullSecret: SECRET });
    expect(await screen.findByText(/line two/)).toBeInTheDocument();
    const log = screen.getByLabelText("oc-mirror output (latest lines)");
    expect(log.textContent).toContain("[INFO]");
    expect(log.textContent).not.toContain("\u001b");
    expect(screen.getByText("Running")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Stop" }));
    await waitFor(() => expect(calls(/\/api\/jobs\/job-run-1\/stop$/, "POST")).toHaveLength(1));
    await waitFor(() => expect(screen.getByText("Stopped")).toBeInTheDocument(), { timeout: 4000 });
    expect(onProfilesChanged).toHaveBeenCalled();
  });

  it("a blocked preflight keeps Mirror to disk disabled", async () => {
    server.preflight = { ok: false, blockers: ["Red Hat pull secret is required."], warnings: [], fieldErrors: {}, items: [{ id: "credentials", status: "block", label: "Red Hat pull secret", detail: "Red Hat pull secret is required." }] };
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "Run preflight" }));
    await screen.findByText("Not ready to run.");
    expect(screen.getByText("Blocked")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Mirror to disk" })).toBeDisabled();
  });

  it("changing the run after a preflight makes it stale", async () => {
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "Run preflight" }));
    await screen.findByText("Ready to run.");
    fireEvent.click(screen.getByRole("switch", { name: "Dry run" }));
    expect(screen.getByText(/changed after the last preflight/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Start dry run" })).toBeDisabled();
  });

  it("a run still going for this profile is picked up again (reload), with Stop", async () => {
    server.runs = [{ jobId: "job-run-1", status: "running", mode: "mirrorToDisk", plan: null }];
    renderPanel();
    expect(await screen.findByRole("button", { name: "Stop" })).toBeInTheDocument();
    expect(await screen.findByText(/line two/)).toBeInTheDocument();
  });

  it("the mounted secret is offered when available and replaces pasting", async () => {
    server.mounted = true;
    renderPanel();
    const toggle = await screen.findByRole("switch", { name: /mounted into the container/ });
    fireEvent.click(toggle);
    expect(screen.queryByRole("textbox", { name: /pull secret/i })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Run preflight" }));
    await screen.findByText("Ready to run.");
    expect(JSON.parse(calls(/\/preflight$/, "POST")[0][1].body)).toEqual({ mode: "mirrorToDisk", dryRun: false, rhAuthSource: "mounted" });
  });
});

describe("live catalog check (in Operators, beside Selected — R-UX04)", () => {
  const opsProfile = (verification) => baseProfile({
    content: { platform: false, operators: true, additionalImages: false },
    operators: { catalogMinor: "4.22", selected: [{ id: `${CATALOG}::demo`, name: "demo", displayName: "Demo", catalog: "redhat", catalogImage: CATALOG, defaultChannel: "stable", ...(verification ? { verification } : {}) }] }
  });
  const renderSelected = (profile, onProfilesChanged = vi.fn()) => {
    render(<SelectedOperatorsPanel profile={profile} selected={profile.operators.selected} onRemove={vi.fn()} onProfilesChanged={onProfilesChanged} catalogMinor="4.22" />);
    return { onProfilesChanged };
  };

  it("unchecked operators read Not checked yet; a check runs as a job with the accepted credential and refreshes the profile", async () => {
    const { onProfilesChanged } = renderSelected(opsProfile());
    expect(screen.getByText("Not checked yet")).toBeInTheDocument();
    expect(screen.getByText(/Enter or accept the Red Hat pull secret first/)).toBeInTheDocument();
    const box = screen.getByRole("textbox", { name: /pull secret/i });
    fireEvent.change(box, { target: { value: SECRET } });
    fireEvent.blur(box);
    fireEvent.click(screen.getByRole("button", { name: "Check catalogs" }));
    await waitFor(() => expect(calls(/\/verify-catalogs$/, "POST")).toHaveLength(1));
    expect(JSON.parse(calls(/\/verify-catalogs$/, "POST")[0][1].body)).toEqual({ rhAuthSource: "inline", rhPullSecret: SECRET });
    await waitFor(() => expect(onProfilesChanged).toHaveBeenCalled());
    expect(await screen.findByText(/Checked 1 of 1 operator\(s\).*1 not checked\./)).toBeInTheDocument();
    expect(screen.getByText(/not checked yet \(added after the last check\)/)).toBeInTheDocument();
  });

  it("a definitive miss reads as such, with when it was checked, and says what to do", () => {
    renderSelected(opsProfile({ status: "channel-not-found", message: "demo has no channel stable.", checkedAt: Date.now(), catalogImage: CATALOG, channel: "stable", minVersion: "", maxVersion: "" }));
    expect(screen.getByText("Channel not found")).toBeInTheDocument();
    expect(screen.getByText(/demo has no channel stable\. \(/)).toBeInTheDocument();
    expect(screen.getByText(/runs are blocked until then/)).toBeInTheDocument();
  });

  it("a result for an operator that changed since reads as stale", () => {
    renderSelected(opsProfile({ status: "verified", message: "ok", checkedAt: 1, catalogImage: CATALOG, channel: "fast", minVersion: "", maxVersion: "" }));
    expect(screen.getByText("Changed since its last check")).toBeInTheDocument();
  });

  it("no credentials given is not a refusal: 'Needs credentials' with the action to enter the pull secret", () => {
    renderSelected(opsProfile({ status: "unverified", message: "demo was not checked: the registry needs credentials and none were given for it (enter the Red Hat pull secret, then check again).", checkedAt: 2, catalogImage: CATALOG, channel: "stable", minVersion: "", maxVersion: "" }));
    expect(screen.getByText("Needs credentials")).toBeInTheDocument();
    expect(screen.getByText(/no Red Hat pull secret was given: enter it above/)).toBeInTheDocument();
  });
});

describe("PreflightChecklist", () => {
  it("spells every status out and summarises in reading order", () => {
    const items = [
      { id: "a", status: "pass", label: "A", detail: "a" },
      { id: "b", status: "block", label: "B", detail: "b" },
      { id: "c", status: "unverified", label: "C", detail: "c" },
      { id: "d", status: "warn", label: "D", detail: "d" },
      { id: "e", status: "info", label: "E", detail: "e" }
    ];
    render(<PreflightChecklist items={items} ok={false} />);
    for (const t of ["Passed", "Blocked", "Not verified", "Warning", "Info"]) expect(screen.getByText(t)).toBeInTheDocument();
    expect(summarizePreflight(items)).toBe("1 blocked, 1 warning, 1 not verified, 1 passed, 1 info");
    expect(screen.getByRole("status")).toHaveTextContent("Not ready to run.");
  });
  it("renders nothing without items", () => {
    const { container } = render(<PreflightChecklist items={[]} ok />);
    expect(container.firstChild).toBeNull();
  });
});

describe("F12 in Mirroring — out-of-range values are never saved", () => {
  it("11 shows its message and is not sent to the profile (the server would refuse it)", async () => {
    renderPanel();
    const input = screen.getByLabelText(/Parallel images/);
    fireEvent.change(input, { target: { value: "11" } });
    fireEvent.blur(input);
    expect(screen.getByText("Parallel images must be a whole number from 1 to 10.")).toBeInTheDocument();
    await new Promise((r) => setTimeout(r, 50));
    expect(server.writes).toHaveLength(0);
  });
});
