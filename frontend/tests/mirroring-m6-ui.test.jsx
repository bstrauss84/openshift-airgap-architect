/**
 * v2.2.0 Mirroring M6 — workflow choice, destination registry, disk to mirror
 * from a received transfer, transfer preparation and the receive form, through
 * the real components.
 */
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup, within } from "@testing-library/react";
import MirroringRunPanel from "../src/mirroring/MirroringRunPanel.jsx";
import ProfileWorkspace from "../src/mirroring/ProfileWorkspace.jsx";
import { ReceiveTransferForm, modeAvailability } from "../src/mirroring/HighSideControls.jsx";
import { findSupportPlacementViolations, findBandOrderViolations } from "./helpers/fieldSupportStructure.js";
import { apiFetch } from "../src/api.js";

vi.mock("../src/api.js", () => ({ apiFetch: vi.fn(), API_BASE: "" }));

const RH = '{"auths":{"registry.redhat.io":{"auth":"c3ludGhldGljOnVp"}}}';
const MIRROR = '{"auths":{"mirror.example.com:8443":{"auth":"c3ludGhldGljOnVp"}}}';
const PLAN = "plan-20261027T120000Z-abcdef";
const paths = (id) => ({ root: `/data/oc-mirror/profiles/${id}`, archivePath: `/data/oc-mirror/profiles/${id}/archives`, workspacePath: `/data/oc-mirror/profiles/${id}/workspace`, cachePath: `/data/oc-mirror/profiles/${id}/cache`, receivedPath: `/data/oc-mirror/profiles/${id}/received` });
const receivedRecord = { planId: PLAN, origin: { profileId: "p-low0000001", profileName: "Site A", planId: PLAN, planSha256: "a".repeat(64), jobId: "job-low-1" }, configSha256: "c".repeat(64), manifestSha256: "m".repeat(64), receivedAt: 1, summary: "1 additional image(s)", archives: [{ file: "mirror_000001.tar", bytes: 1024, sha256: "d".repeat(64) }] };
const planned = (extra = {}) => ({
  id: "p-ui00000006", name: "Planned", updatedAt: 1, kind: "planned",
  content: { platform: false, operators: false, additionalImages: true },
  platform: { release: {}, version: {} }, operators: { catalogMinor: null, selected: [] },
  additionalImages: [{ id: "img-aaaa", name: "registry.example.invalid/a:1", source: "user" }],
  options: {}, execution: { mode: "mirrorToDisk", registryUrl: "", options: {} }, history: [], transfers: [], received: [],
  readiness: [], paths: paths("p-ui00000006"), ...extra
});
const receivedProfile = (extra = {}) => planned({ id: "p-ui00000007", name: "Received: Site A", kind: "received", origin: receivedRecord.origin, received: [receivedRecord], execution: { mode: "diskToMirror", registryUrl: "", options: {} }, paths: paths("p-ui00000007"), ...extra });

let server;
const calls = (re, method) => vi.mocked(apiFetch).mock.calls.filter(([p, o]) => re.test(p) && (o?.method || "GET") === method);
beforeEach(() => {
  server = {
    runs: [],
    preflight: { ok: true, blockers: [], warnings: [], fieldErrors: {}, items: [{ id: "mode", status: "pass", label: "Workflow", detail: "ok" }] },
    jobs: {
      "job-run": { id: "job-run", status: "completed", progress: 100, message: "done", output: "" },
      "job-transfer-unpinned": { id: "job-transfer-unpinned", status: "failed", progress: 100, message: "The transfer could not be prepared: oc-mirror could not pin …", metadata_json: JSON.stringify({ code: "CATALOG_NOT_PINNED", unpinnedCatalogs: ["registry.redhat.io/redhat/redhat-operator-index:v4.22"] }) },
      "job-transfer": { id: "job-transfer", status: "completed", progress: 100, message: "Transfer ready: 1 archive file(s)." },
      "job-receive-ok": { id: "job-receive-ok", status: "completed", progress: 100, message: "Transfer received into \"Received: Site A\": 1 archive file(s) verified and copied; plan plan-20261027T120000Z-abcdef.", metadata_json: JSON.stringify({ profileId: "p-ui00000007", profileName: "Received: Site A", planId: "plan-20261027T120000Z-abcdef", archives: 1, manifestSha256: "m".repeat(64) }) },
      "job-receive": { id: "job-receive", status: "failed", progress: 100, message: "The transfer failed verification: mirror_000001.tar is missing.", metadata_json: JSON.stringify({ problems: ["mirror_000001.tar is missing."], recovery: ["Copy the missing archive file(s) again from the low side, then verify again."] }) }
    }
  };
  vi.mocked(apiFetch).mockReset();
  vi.mocked(apiFetch).mockImplementation((path, opts = {}) => {
    if (path === "/api/secrets/rh-pull-secret") return Promise.resolve({ available: false });
    if (/\/runs$/.test(path)) return Promise.resolve({ runs: server.runs, activeVerification: null });
    if (/\/preflight$/.test(path)) return Promise.resolve(server.preflight);
    if (/\/run$/.test(path)) return Promise.resolve({ jobId: "job-run" });
    if (/\/transfer$/.test(path)) return Promise.resolve({ jobId: JSON.parse(opts.body).acknowledgeUnpinned ? "job-transfer" : (server.transferJob || "job-transfer") });
    if (path === "/api/mirroring/receive") return Promise.resolve({ jobId: server.receiveJob || "job-receive" });
    if (/^\/api\/jobs\//.test(path)) return Promise.resolve({ ...server.jobs[path.split("/")[3]] });
    if (/^\/api\/mirroring\/profiles\/[^/]+$/.test(path) && opts.method === "POST") return Promise.resolve(planned({ execution: { mode: "mirrorToDisk", registryUrl: JSON.parse(opts.body).execution?.registryUrl || "", options: {} } }));
    return Promise.reject(new Error(`unexpected ${opts.method || "GET"} ${path}`));
  });
});
afterEach(cleanup);

const renderPanel = (profile) => render(<MirroringRunPanel profile={profile} onProfileChanged={vi.fn()} onProfilesChanged={vi.fn()} />);
const card = (title) => within(screen.getByRole("group", { name: "Workflow" })).getByRole("button", { name: new RegExp(`^${title}`) });
const registryBox = () => screen.getByRole("textbox", { name: /^Destination registry(?! credentials)/ });
const paste = (label, value) => {
  const box = screen.getByRole("textbox", { name: label });
  fireEvent.change(box, { target: { value } });
  fireEvent.blur(box);
};

describe("workflow availability", () => {
  it("a planned profile without a received transfer: disk to mirror is disabled and says why", () => {
    renderPanel(planned());
    expect(card("Mirror to disk")).toHaveAttribute("aria-pressed", "true");
    expect(card("Mirror to disk")).toHaveTextContent("✓ Selected");
    expect(card("Mirror to mirror")).toBeEnabled();
    expect(card("Disk to mirror")).toBeDisabled();
    expect(card("Disk to mirror")).toHaveTextContent(/Not available: Needs a received transfer/);
  });
  it("a received profile runs disk to mirror only", () => {
    renderPanel(receivedProfile());
    expect(card("Disk to mirror")).toHaveAttribute("aria-pressed", "true");
    expect(card("Mirror to disk")).toBeDisabled();
    expect(card("Mirror to mirror")).toBeDisabled();
    expect(modeAvailability(receivedProfile()).diskToMirror).toBeNull();
  });
});

describe("mirror to mirror", () => {
  it("needs a destination registry (validated on blur) and sends both credentials for this run only", async () => {
    const { container } = renderPanel(planned());
    fireEvent.click(card("Mirror to mirror"));
    const reg = registryBox();
    expect(container.querySelectorAll(".field-error")).toHaveLength(0);
    fireEvent.change(reg, { target: { value: "https://nope" } });
    fireEvent.blur(reg);
    expect(screen.getByText(/Use host\[:port\]\[\/path\]/)).toBeInTheDocument();
    expect(findSupportPlacementViolations(container)).toEqual([]);
    expect(findBandOrderViolations(container)).toEqual([]);
    fireEvent.change(reg, { target: { value: "mirror.example.com:8443/ocp" } });
    fireEvent.blur(reg);
    await waitFor(() => expect(calls(/^\/api\/mirroring\/profiles\/[^/]+$/, "POST")).toHaveLength(1));
    expect(JSON.parse(calls(/^\/api\/mirroring\/profiles\/[^/]+$/, "POST")[0][1].body)).toEqual({ execution: { registryUrl: "mirror.example.com:8443/ocp" } });
    paste(/pull secret/i, RH);
    paste(/Destination registry credentials/, MIRROR);
    fireEvent.click(screen.getByRole("button", { name: "Run preflight" }));
    await screen.findByText("Ready to run.");
    expect(JSON.parse(calls(/\/preflight$/, "POST")[0][1].body)).toEqual({
      mode: "mirrorToMirror", dryRun: false, rhAuthSource: "inline", rhPullSecret: RH,
      registryUrl: "mirror.example.com:8443/ocp", mirrorAuthSource: "inline", mirrorPullSecret: MIRROR
    });
    expect(screen.getByRole("button", { name: "Mirror to mirror" })).toBeEnabled();
  });
});

describe("disk to mirror", () => {
  it("runs a chosen received transfer, confined by default; no Red Hat pull secret is asked for", async () => {
    renderPanel(receivedProfile());
    expect(screen.queryByRole("textbox", { name: /Red Hat pull secret/ })).toBeNull();
    expect(screen.getByText(/no Red Hat pull secret is needed/)).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: /Received transfer/ })).toHaveValue(PLAN);
    expect(screen.getByRole("switch", { name: /Confine the network/ })).toHaveAttribute("aria-checked", "true");
    fireEvent.change(registryBox(), { target: { value: "mirror.example.com:8443" } });
    paste(/Destination registry credentials/, MIRROR);
    fireEvent.click(screen.getByRole("button", { name: "Run preflight" }));
    await screen.findByText("Ready to run.");
    expect(JSON.parse(calls(/\/preflight$/, "POST")[0][1].body)).toEqual({
      mode: "diskToMirror", dryRun: false, registryUrl: "mirror.example.com:8443", mirrorAuthSource: "inline", mirrorPullSecret: MIRROR,
      receivedPlanId: PLAN, isolateNetwork: true
    });
    fireEvent.click(screen.getByRole("button", { name: "Disk to mirror" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Disk to Mirror")).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: /Confirm|Run/ }));
    await waitFor(() => expect(calls(/\/run$/, "POST")).toHaveLength(1));
    expect(JSON.parse(calls(/\/run$/, "POST")[0][1].body)).toMatchObject({ mode: "diskToMirror", receivedPlanId: PLAN, isolateNetwork: true });
  });
  it("received profiles show where they came from and offer no content editing", () => {
    render(<ProfileWorkspace profile={receivedProfile()} onEditContent={vi.fn()} onDelete={vi.fn()} onProfileChanged={vi.fn()} />);
    expect(screen.getByText(/Received — ready for disk to mirror/)).toBeInTheDocument();
    expect(screen.getByText(/Site A \(p-low0000001\)/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Change name or content" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "Additional images" })).toBeNull();
  });
});

describe("transfer preparation and receipt", () => {
  it("the latest completed real mirror to disk offers Prepare transfer", async () => {
    server.runs = [
      { jobId: "job-new", status: "completed", mode: "mirrorToDisk", dryRun: false, plan: { planId: PLAN, planSha256: "a".repeat(64), configSha256: "c".repeat(64) } },
      { jobId: "job-dry", status: "completed", mode: "mirrorToDisk", dryRun: true, plan: { planId: "plan-20261027T110000Z-zzzzzz", planSha256: "b".repeat(64), configSha256: "e".repeat(64) } }
    ];
    renderPanel(planned());
    const button = await screen.findByRole("button", { name: "Prepare transfer" });
    expect(screen.getAllByRole("button", { name: /^Prepare (transfer|again)$/ })).toHaveLength(1);
    fireEvent.click(button);
    await waitFor(() => expect(calls(/\/transfer$/, "POST")).toHaveLength(1));
    expect(JSON.parse(calls(/\/transfer$/, "POST")[0][1].body)).toEqual({ jobId: "job-new" });
    expect(await screen.findByText(/Transfer ready: 1 archive file/)).toBeInTheDocument();
  });
  it("a catalog oc-mirror could not pin: refused with the reason; preparing anyway needs an explicit confirmation", async () => {
    server.transferJob = "job-transfer-unpinned";
    server.runs = [{ jobId: "job-new", status: "completed", mode: "mirrorToDisk", dryRun: false, plan: { planId: PLAN, planSha256: "a".repeat(64), configSha256: "c".repeat(64) } }];
    renderPanel(planned());
    fireEvent.click(await screen.findByRole("button", { name: "Prepare transfer" }));
    expect(await screen.findByText("Transfer not prepared.")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("registry.redhat.io/redhat/redhat-operator-index:v4.22");
    fireEvent.click(screen.getByRole("button", { name: "Prepare anyway…" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Prepare a transfer that is not offline-ready?")).toBeInTheDocument();
    expect(calls(/\/transfer$/, "POST")).toHaveLength(1);
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(calls(/\/transfer$/, "POST")).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Prepare anyway…" }));
    fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Prepare anyway (not offline-ready)" }));
    await waitFor(() => expect(calls(/\/transfer$/, "POST")).toHaveLength(2));
    expect(JSON.parse(calls(/\/transfer$/, "POST")[1][1].body)).toEqual({ jobId: "job-new", acknowledgeUnpinned: true });
  });
  it("the receive form validates on blur and shows each problem with how to fix it", async () => {
    const { container } = render(<ReceiveTransferForm idPrefix="t" onReceived={vi.fn()} />);
    const dir = screen.getByRole("textbox", { name: /Transfer directory/ });
    expect(container.querySelectorAll(".field-error")).toHaveLength(0);
    fireEvent.change(dir, { target: { value: "relative/path" } });
    fireEvent.blur(dir);
    expect(screen.getByText(/Use an absolute path/)).toBeInTheDocument();
    fireEvent.change(dir, { target: { value: "/data/transfer/site-a" } });
    fireEvent.click(screen.getByRole("button", { name: "Verify and receive" }));
    expect(await screen.findByText("Not received.")).toBeInTheDocument();
    expect(screen.getByText("mirror_000001.tar is missing.")).toBeInTheDocument();
    expect(screen.getByText(/Copy the missing archive file\(s\) again/)).toBeInTheDocument();
    expect(JSON.parse(calls(/^\/api\/mirroring\/receive$/, "POST")[0][1].body)).toEqual({ transferDir: "/data/transfer/site-a" });
  });
  it("a successful receipt stays on screen with what was verified and lets the user choose the next step", async () => {
    server.receiveJob = "job-receive-ok";
    const onOpenProfile = vi.fn();
    const onReceived = vi.fn();
    render(<ReceiveTransferForm idPrefix="t" onReceived={onReceived} onOpenProfile={onOpenProfile} currentProfileId="p-other" />);
    fireEvent.change(screen.getByRole("textbox", { name: /Transfer directory/ }), { target: { value: "/data/transfer/site-a" } });
    fireEvent.click(screen.getByRole("button", { name: "Verify and receive" }));
    expect(await screen.findByText("Received.")).toBeInTheDocument();
    await waitFor(() => expect(onReceived).toHaveBeenCalledTimes(1));
    expect(onOpenProfile).not.toHaveBeenCalled();
    expect(screen.getByText("1 archive file(s), every file checked against the manifest")).toBeInTheDocument();
    expect(screen.getByText("m".repeat(64))).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Open “Received: Site A”" }));
    expect(onOpenProfile).toHaveBeenCalledWith(expect.objectContaining({ profileId: "p-ui00000007" }));
    fireEvent.click(screen.getByRole("button", { name: "Receive another transfer" }));
    expect(screen.getByRole("textbox", { name: /Transfer directory/ })).toHaveValue("");
    expect(screen.queryByText("Received.")).toBeNull();
  });
  it("received into the profile already open: no redundant Open action", async () => {
    server.receiveJob = "job-receive-ok";
    render(<ReceiveTransferForm idPrefix="t" onReceived={vi.fn()} onOpenProfile={vi.fn()} currentProfileId="p-ui00000007" />);
    fireEvent.change(screen.getByRole("textbox", { name: /Transfer directory/ }), { target: { value: "/data/transfer/site-a" } });
    fireEvent.click(screen.getByRole("button", { name: "Verify and receive" }));
    expect(await screen.findByText("Received.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Open/ })).toBeNull();
  });
});
