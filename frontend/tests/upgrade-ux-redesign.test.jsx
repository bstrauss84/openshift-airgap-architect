/**
 * v2.3.0 UX correction — behaviour of the redesigned Upgrade workflow (owner design review).
 *
 * The confirmation says exactly what will run (jobs, output, credentials, failure rule, what will
 * not happen) and never calls proposed jobs "work that will be stopped"; single-stage and
 * all-stage actions send exactly that scope; existing catalog tags need one acknowledgement each;
 * the plan registry is validated before it is saved; the import panel toggles; EUS badges come
 * only from EUS-channel membership; one credential context per plan; Mirroring offers the way back.
 */
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, within, cleanup } from "@testing-library/react";
import { apiFetch } from "../src/api.js";
import UpgradeShell from "../src/upgrade/UpgradeShell.jsx";
import UpgradeTimeline from "../src/upgrade/UpgradeTimeline.jsx";
import ExploreHistory from "../src/upgrade/ExploreHistory.jsx";
import MirrorTab, { MirrorJobsDialog } from "../src/upgrade/MirrorTab.jsx";
import MirroringRunPanel from "../src/mirroring/MirroringRunPanel.jsx";
import MirroringShell from "../src/mirroring/MirroringShell.jsx";
import {
  _resetSourceCredentialsForTests, setSourceCredential, getSourceCredential, planCredentialKey,
  setDestinationCredential
} from "../src/mirroring/sourceCredentialSession.js";
import { useSourceCredential } from "../src/mirroring/sourceCredentialSession.js";
import { RETURN_KEY, readUpgradeReturn } from "../src/upgrade/upgradeReturn.js";

vi.mock("../src/api.js", () => ({ apiFetch: vi.fn(), API_BASE: "" }));

const RH = JSON.stringify({ auths: { "registry.redhat.io": { auth: "dTpw" } } });
const stage = (id, release, minor, extra = {}) => ({ id, release, minor, linkedProfileId: `p-${id}`, content: { state: "planned", evidence: [] }, clusterUpdated: "none", operatorsSelected: 2, ...extra });
const plan = (extra = {}) => ({
  id: "u-uxplan00001", name: "Prod", kind: "planned", arch: "amd64", channelPolicy: "stable", current: "4.20.14", target: "4.22.22",
  path: { path: ["4.20.14", "4.20.44", "4.21.40", "4.22.22"], hops: [{ from: "4.20.14", to: "4.20.44", kind: "z-stream", channel: "stable-4.20", risks: [] }, { from: "4.20.44", to: "4.21.40", kind: "minor", channel: "stable-4.21", risks: [] }, { from: "4.21.40", to: "4.22.22", kind: "minor", channel: "stable-4.22", risks: [] }], graphSources: [] },
  stages: [{ id: "s1", release: "4.20.44", minor: "4.20" }, { id: "s2", release: "4.21.40", minor: "4.21" }, { id: "s3", release: "4.22.22", minor: "4.22" }],
  stageViews: [stage("s1", "4.20.44", "4.20"), stage("s2", "4.21.40", "4.21"), stage("s3", "4.22.22", "4.22")],
  mirror: { registryUrl: "mirror.example.com:8443/ocp", method: "mirrorToDisk", catalogTag: "source" },
  operatorIntent: [], updatedAt: "2026-11-07T00:00:00.000Z",
  ...extra
});
const previewFor = (mode, ids) => ({
  mode, token: "t".repeat(64), stopsOnFirstFailure: true,
  stages: ids.map((id, i) => ({ stageId: id, release: ["4.20.44", "4.21.40", "4.22.22"][Number(id.slice(1)) - 1], operators: 2, catalogMinor: `4.2${Number(id.slice(1)) - 1}`, destination: mode === "mirrorToMirror" ? "mirror.example.com:8443/ocp" : `/data/oc-mirror/profiles/p-${id}/archives`, profileId: `p-${id}`, index: i }))
});

let calls;
const mockApi = (handlers = {}) => {
  calls = [];
  vi.mocked(apiFetch).mockImplementation((p, opts = {}) => {
    const body = opts.body ? JSON.parse(opts.body) : undefined;
    calls.push([p, opts.method || "GET", body]);
    for (const [k, fn] of Object.entries(handlers)) if (p.includes(k)) return Promise.resolve(fn(body, p));
    if (p === "/api/mirroring") return Promise.resolve({ profiles: [] });
    if (/\/runs$/.test(p)) return Promise.resolve({ runs: [], activeVerification: null });
    return Promise.resolve({});
  });
};
beforeEach(() => { sessionStorage.clear(); _resetSourceCredentialsForTests(); vi.mocked(apiFetch).mockReset(); });
afterEach(cleanup);

describe("the reviewed confirmation (replaces “Running work that will be stopped”)", () => {
  it("lists jobs, output, credentials, the failure rule and what will not happen — and nothing about stopping work", () => {
    const onConfirm = vi.fn();
    render(<MirrorJobsDialog plan={plan()} review={{ preview: previewFor("mirrorToDisk", ["s1", "s2", "s3"]), catalogs: [] }} sourceReady destReady={false} busy={false} error="" onCancel={() => {}} onConfirm={onConfirm} />);
    const d = screen.getByRole("dialog");
    expect(within(d).getByRole("heading", { name: "Mirror 3 stages to disk?" })).toBeInTheDocument();
    for (const h of ["Jobs that will run (one after another)", "Where the output goes", "Credentials used", "If a job fails", "What will not happen"]) {
      expect(within(d).getByRole("heading", { name: h })).toBeInTheDocument();
    }
    expect(d.textContent).not.toMatch(/will be stopped|Running work/);
    // It is a real dialog box (the shared .modal surface), not text floating over the page.
    expect(document.querySelector(".modal.upgrade-jobs-dialog")).not.toBeNull();
    expect(d.textContent).toMatch(/Your cluster is not updated or contacted/);
    expect(d.textContent).toMatch(/The remaining jobs do not start/);
    fireEvent.click(within(d).getByRole("button", { name: "Show paths" }));
    expect(within(d).getByText("/data/oc-mirror/profiles/p-s2/archives")).toBeInTheDocument();
    fireEvent.click(within(d).getByRole("button", { name: "Start 3 mirror-to-disk jobs" }));
    expect(onConfirm).toHaveBeenCalledWith([]);
  });

  it("one stage reads as one job", () => {
    render(<MirrorJobsDialog plan={plan()} review={{ preview: previewFor("mirrorToDisk", ["s2"]), catalogs: [] }} sourceReady destReady={false} busy={false} error="" onCancel={() => {}} onConfirm={() => {}} />);
    expect(screen.getByRole("heading", { name: "Mirror stage 2 to disk?" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Job that will run" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Start 1 mirror-to-disk job" })).toBeEnabled();
  });

  it("mirror to mirror: every catalog tag that exists or could not be checked needs its own acknowledgement", () => {
    const onConfirm = vi.fn();
    const catalogs = [
      { stageId: "s1", destination: "mirror.example.com:8443/ocp/redhat/redhat-operator-index:v4.20", exists: true },
      { stageId: "s2", destination: "mirror.example.com:8443/ocp/redhat/redhat-operator-index:v4.21", exists: "unknown", problem: "TLS" },
      { stageId: "s3", destination: "mirror.example.com:8443/ocp/redhat/redhat-operator-index:v4.22", exists: false }
    ];
    render(<MirrorJobsDialog plan={plan()} review={{ preview: previewFor("mirrorToMirror", ["s1", "s2", "s3"]), catalogs }} sourceReady destReady busy={false} error="" onCancel={() => {}} onConfirm={onConfirm} />);
    const start = screen.getByRole("button", { name: "Start 3 mirror-to-mirror jobs" });
    expect(start).toBeDisabled();
    expect(screen.getByText(/Content placed in the registry is not activated in any cluster/)).toBeInTheDocument();
    const boxes = screen.getAllByRole("checkbox");
    expect(boxes).toHaveLength(2); // the absent tag needs nothing
    fireEvent.click(boxes[0]);
    expect(start).toBeDisabled();
    fireEvent.click(boxes[1]);
    expect(start).toBeEnabled();
    fireEvent.click(start);
    expect(onConfirm).toHaveBeenCalledWith([catalogs[0].destination, catalogs[1].destination]);
  });
});

describe("Mirror & transfer", () => {
  const key = planCredentialKey("u-uxplan00001");
  it("one credential field for the plan; “Mirror this stage” sends that stage only, “Mirror all” sends every stage", async () => {
    mockApi({ "/sequence/preview": (b) => previewFor(b.mode, b.stageIds || ["s1", "s2", "s3"]) });
    render(<MirrorTab plan={plan()} highSide={false} onPlanChanged={() => {}} credentialKey={key} />);
    expect(await screen.findByRole("heading", { name: "How content gets to the disconnected side" })).toBeInTheDocument();
    expect(screen.getAllByText(/Paste, drag and drop, or upload a Red Hat pull secret/)).toHaveLength(1);
    const row2 = screen.getByText("Stage 2 · 4.21.40").closest("li");
    fireEvent.click(within(row2).getByRole("button", { name: "Mirror this stage…" }));
    await screen.findByRole("heading", { name: "Mirror stage 2 to disk?" });
    expect(calls.find(([p]) => p.endsWith("/sequence/preview"))[2]).toEqual({ mode: "mirrorToDisk", stageIds: ["s2"] });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    fireEvent.click(screen.getByRole("button", { name: "Mirror all 3 stages to disk…" }));
    await screen.findByRole("heading", { name: "Mirror 3 stages to disk?" });
    expect(calls.filter(([p]) => p.endsWith("/sequence/preview"))[1][2]).toEqual({ mode: "mirrorToDisk" });
  });

  it("mirror to mirror uses the plan's registry credentials for the check and sends the acknowledgements", async () => {
    setSourceCredential(key, { secret: RH }, "run");
    setDestinationCredential(key, { secret: "{\"auths\":{\"mirror.example.com:8443\":{\"auth\":\"eDp5\"}}}" });
    const dest = "mirror.example.com:8443/ocp/redhat/redhat-operator-index:v4.21";
    mockApi({
      "/sequence/preview": (b) => previewFor(b.mode, b.stageIds),
      "/sequence/destination-check": () => ({ catalogs: [{ stageId: "s2", destination: dest, exists: true }] }),
      "/sequence": () => ({ jobId: "job-1" })
    });
    render(<MirrorTab plan={plan({ mirror: { registryUrl: "mirror.example.com:8443/ocp", method: "mirrorToMirror", catalogTag: "source" } })} highSide={false} onPlanChanged={() => {}} credentialKey={key} />);
    const row2 = (await screen.findByText("Stage 2 · 4.21.40")).closest("li");
    fireEvent.click(within(row2).getByRole("button", { name: "Mirror this stage…" }));
    await screen.findByRole("heading", { name: "Mirror stage 2 to the registry?" });
    expect(calls.find(([p]) => p.endsWith("/destination-check"))[2]).toMatchObject({ mode: "mirrorToMirror", stageIds: ["s2"], mirrorPullSecret: expect.stringContaining("mirror.example.com:8443") });
    fireEvent.click(screen.getByRole("checkbox", { name: new RegExp(dest.replace(/[.:/]/g, "\\$&")) }));
    fireEvent.click(screen.getByRole("button", { name: "Start 1 mirror-to-mirror job" }));
    await waitFor(() => expect(calls.some(([p, m]) => p.endsWith("/sequence") && m === "POST")).toBe(true));
    const start = calls.find(([p, m]) => p.endsWith("/sequence") && m === "POST")[2];
    expect(start).toMatchObject({ mode: "mirrorToMirror", stageIds: ["s2"], rhAuthSource: "inline", previewToken: "t".repeat(64), acknowledgedOverwrites: [dest] });
    expect(start.mirrorPullSecret).toContain("mirror.example.com:8443");
  });

  it("a registry reference with credentials is refused inline and never saved", async () => {
    mockApi();
    render(<MirrorTab plan={plan({ mirror: { registryUrl: null, method: "mirrorToDisk", catalogTag: "source" } })} highSide={false} onPlanChanged={() => {}} credentialKey={key} />);
    const input = await screen.findByLabelText("Mirror registry", { selector: "input" });
    fireEvent.change(input, { target: { value: "user:secret@mirror.example.com/ocp" } });
    fireEvent.blur(input);
    expect(await screen.findByRole("alert")).toHaveTextContent(/cannot contain "@"/);
    expect(calls.some(([p]) => p.endsWith("/mirror"))).toBe(false);
    fireEvent.change(input, { target: { value: "docker://Mirror.Example.com:8443/ocp" } });
    fireEvent.blur(input);
    await waitFor(() => expect(calls.some(([p]) => p.endsWith("/mirror"))).toBe(true));
    expect(calls.find(([p]) => p.endsWith("/mirror"))[2]).toEqual({ registryUrl: "docker://Mirror.Example.com:8443/ocp" });
  });
});

describe("managed run panel (stage details)", () => {
  it("takes method, credentials and registry from the plan: no second workflow chooser or credential form", async () => {
    mockApi();
    const profile = {
      id: "p-s2", name: "Prod · stage 2", updatedAt: 1, ownedBy: { workflow: "upgrade", planId: "u-uxplan00001", stageId: "s2" },
      content: { platform: true, operators: false, additionalImages: false }, platform: { release: { channel: "4.21", patchVersion: "4.21.40" }, version: { selectedMinor: "4.21", locked: true } },
      operators: { catalogMinor: "4.21", selected: [] }, additionalImages: [], execution: { mode: "mirrorToMirror", registryUrl: "mirror.example.com:8443/ocp", options: {} }, received: [], paths: {}
    };
    render(<MirroringRunPanel profile={profile} onProfileChanged={() => {}} onProfilesChanged={() => {}} managed={{ method: "mirrorToMirror", credentialKey: planCredentialKey("u-uxplan00001"), settingsHint: "From the plan." }} />);
    expect(await screen.findByText("From the plan.")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Choose the mirroring workflow" })).toBeNull();
    expect(screen.queryByText(/Paste, drag and drop, or upload a Red Hat pull secret/)).toBeNull();
    expect(screen.getByText(/Pushes to/)).toHaveTextContent("mirror.example.com:8443/ocp");
    expect(screen.getByRole("heading", { name: "Preflight and run" })).toBeInTheDocument();
  });
});

describe("Route", () => {
  it("the graph source / import panel opens and closes from the same control", async () => {
    mockApi({
      "/api/upgrade/graph?": () => ({ loaded: false }),
      "/targets": () => ({ targets: [] })
    });
    vi.mocked(apiFetch).mockImplementation((p, opts = {}) => {
      if (p === "/api/upgrade") return Promise.resolve({ activePlanId: "u-uxplan00001", plans: [plan({ path: null, stages: [], stageViews: [], currentChannel: "stable-4.20", graphSource: "public" })], supportedMinors: ["4.20", "4.21", "4.22"], highSide: false });
      if (p.startsWith("/api/upgrade/graph?")) return Promise.resolve({ loaded: false });
      if (p === "/api/mirroring") return Promise.resolve({ profiles: [] });
      return Promise.resolve({});
    });
    render(<UpgradeShell onExit={() => {}} />);
    const toggle = await screen.findByRole("button", { name: "Change source or import a graph…" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(toggle);
    expect(screen.getByRole("button", { name: "Close graph source options" })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("heading", { name: "Import an update graph" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Close graph source options" }));
    expect(screen.queryByRole("heading", { name: "Import an update graph" })).toBeNull();
  });

  it("EUS badges come only from EUS-channel membership in the graph, never from an even minor", () => {
    const p = plan().path;
    const nodeInfo = { "4.20.14": { channels: ["stable-4.20"] }, "4.20.44": { channels: ["stable-4.20"] }, "4.21.40": { channels: ["stable-4.21", "eus-4.22"] }, "4.22.22": { channels: ["stable-4.22", "eus-4.22"] } };
    render(<UpgradeTimeline path={p} nodeInfo={nodeInfo} />);
    expect(screen.getAllByText("EUS")).toHaveLength(1);
    expect(screen.getByRole("button", { name: /Update 3: 4.21.40 to 4.22.22.*EUS release/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Update 1: 4.20.14 to 4.20.44/ }).getAttribute("aria-label")).not.toMatch(/EUS/);
    // The minor is written out; colour never carries it alone.
    expect(screen.getAllByText("OpenShift 4.21").length).toBeGreaterThan(0);
  });
});

describe("one credential context per plan (D-2)", () => {
  function Probe({ k, site }) { const c = useSourceCredential(k, site); return <span data-testid={`${k}-${site}`}>{c.usable ? "usable" : "no"}</span>; }
  it("entered once, usable at every place of THAT plan only; never another plan or a Mirroring profile", () => {
    const a = planCredentialKey("u-a"), b = planCredentialKey("u-b");
    setSourceCredential(a, { secret: RH }, "scan");
    render(<>
      <Probe k={a} site="scan" /><Probe k={a} site="check" /><Probe k={a} site="run" />
      <Probe k={b} site="run" /><Probe k="p-mirroring-profile" site="run" />
    </>);
    expect(screen.getByTestId(`${a}-check`)).toHaveTextContent("usable");
    expect(screen.getByTestId(`${a}-run`)).toHaveTextContent("usable");
    expect(screen.getByTestId(`${b}-run`)).toHaveTextContent("no");
    expect(screen.getByTestId("p-mirroring-profile-run")).toHaveTextContent("no");
    expect(getSourceCredential(a).secret).toBe(RH);
    expect(JSON.stringify(sessionStorage)).not.toContain("dTpw");
    expect(JSON.stringify(localStorage)).not.toContain("dTpw");
  });
});

describe("Open in Mirroring and back", () => {
  it("Upgrade restores the plan, step and stage it was left from, and clears the record", async () => {
    sessionStorage.setItem(RETURN_KEY, JSON.stringify({ planId: "u-uxplan00001", planName: "Prod", stageId: "s2", step: "mirror" }));
    vi.mocked(apiFetch).mockImplementation((p) => {
      if (p === "/api/upgrade") return Promise.resolve({ activePlanId: null, plans: [plan()], supportedMinors: ["4.20", "4.21", "4.22"], highSide: false });
      if (p === "/api/mirroring") return Promise.resolve({ profiles: [] });
      return Promise.resolve({});
    });
    render(<UpgradeShell onExit={() => {}} onOpenMirroring={() => {}} />);
    const tab = await screen.findByRole("tab", { name: /Mirror & transfer/ });
    expect(tab).toHaveAttribute("aria-selected", "true");
    const panel = document.getElementById("upgrade-tabpanel-mirror");
    expect(within(within(panel).getByText("Stage 2 · 4.21.40").closest("li")).getByRole("button", { name: "Hide details" })).toHaveAttribute("aria-expanded", "true");
    expect(readUpgradeReturn()).toBeNull();
  });

  it("“Open in Mirroring” records the way back, names the plan and stage, and opens Mirroring at that profile", async () => {
    const opened = vi.fn();
    vi.mocked(apiFetch).mockImplementation((p) => {
      if (p === "/api/upgrade") return Promise.resolve({ activePlanId: "u-uxplan00001", plans: [plan()], supportedMinors: ["4.20", "4.21", "4.22"], highSide: false });
      if (p === "/api/mirroring") return Promise.resolve({ profiles: [] });
      return Promise.resolve({});
    });
    sessionStorage.setItem("oaa.upgrade.step.v2", "mirror");
    render(<UpgradeShell onExit={() => {}} onOpenMirroring={opened} />);
    await screen.findByRole("tab", { name: /Mirror & transfer/ });
    const row = (await within(document.getElementById("upgrade-tabpanel-mirror")).findByText("Stage 3 · 4.22.22")).closest("li");
    fireEvent.click(within(row).getByRole("button", { name: "Open in Mirroring ↗" }));
    await waitFor(() => expect(opened).toHaveBeenCalled());
    expect(vi.mocked(apiFetch).mock.calls.some(([p, o]) => p === "/api/mirroring/active" && JSON.parse(o.body).profileId === "p-s3")).toBe(true);
    expect(readUpgradeReturn()).toEqual({ planId: "u-uxplan00001", planName: "Prod", stageId: "s3", step: "mirror" });
  });

  it("Mirroring shows a prominent way back to the plan and stage (only when it was opened from Upgrade)", async () => {
    vi.mocked(apiFetch).mockImplementation((p) => {
      if (p === "/api/mirroring") return Promise.resolve({ profiles: [], activeProfileId: null });
      return Promise.resolve({});
    });
    const back = vi.fn();
    const { unmount } = render(<MirroringShell onExit={() => {}} onReturnToUpgrade={back} />);
    expect(await screen.findByRole("heading", { name: "Mirroring" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Back to Upgrade plan/ })).toBeNull();
    unmount();
    sessionStorage.setItem(RETURN_KEY, JSON.stringify({ planId: "u-uxplan00001", planName: "Prod", stageId: "s2", step: "mirror" }));
    render(<MirroringShell onExit={() => {}} onReturnToUpgrade={back} />);
    fireEvent.click(await screen.findByRole("button", { name: "← Back to Upgrade plan “Prod” · stage 2" }));
    expect(back).toHaveBeenCalled();
  });
});

describe("Explore older releases (D-1, exploration only)", () => {
  const route = {
    ok: true, exploration: true, path: ["4.19.10", "4.19.55", "4.20.46", "4.21.42", "4.22.22"], firstSupported: "4.20.46",
    hops: [["4.19.10", "4.19.55", "stable-4.19", "z-stream"], ["4.19.55", "4.20.46", "stable-4.20", "minor"], ["4.20.46", "4.21.42", "stable-4.21", "minor"], ["4.21.42", "4.22.22", "stable-4.22", "minor"]].map(([from, to, channel, kind]) => ({ from, to, channel, kind, channelCheck: "recommended", risks: [] })),
    graphSources: [{ channel: "stable-4.19" }, { channel: "stable-4.20" }, { channel: "stable-4.21" }, { channel: "stable-4.22" }],
    docs: [{ minor: "4.19", url: "https://docs.redhat.com/en/documentation/openshift_container_platform/4.19/html/updating_clusters/index", humanVerified: false }],
    nodeInfo: {}
  };
  const open = () => fireEvent.click(screen.getByRole("button", { name: /Explore older releases/ }));
  it("shows a real-edge route labelled as exploration, marks releases before the planning range, and plans only the supported part on request", async () => {
    mockApi({ "/api/upgrade/explore": () => route });
    const onPlan = vi.fn();
    render(<ExploreHistory plan={plan()} supportedMinors={["4.20", "4.21", "4.22"]} highSide={false} onPlanSupportedPart={onPlan} />);
    open();
    fireEvent.change(screen.getByLabelText("Release the cluster runs", { selector: "input" }), { target: { value: "4.19.10" } });
    fireEvent.change(screen.getByLabelText("Release to explore up to", { selector: "input" }), { target: { value: "4.22.22" } });
    fireEvent.click(screen.getByRole("button", { name: "Explore the route" }));
    expect(await screen.findByText(/Shown as Red Hat's update graph lists it today/)).toBeInTheDocument();
    expect(calls.find(([p]) => p === "/api/upgrade/explore")[2]).toEqual({ arch: "amd64", source: "4.19.10", target: "4.22.22" });
    expect(screen.getAllByText("outside planning range")).toHaveLength(2); // 4.19.10 and 4.19.55 only
    expect(screen.getByRole("link", { name: "OpenShift 4.19" })).toHaveAttribute("href", expect.stringContaining("docs.redhat.com"));
    expect(onPlan).not.toHaveBeenCalled(); // exploring changes nothing
    fireEvent.click(screen.getByRole("button", { name: "Plan the supported part: 4.20.46 → 4.22.22" }));
    expect(onPlan).toHaveBeenCalledWith("4.20.46", "4.22.22");
  });
  it("an exploration-only route (no supported release on it) offers no planning action", async () => {
    mockApi({ "/api/upgrade/explore": () => ({ ...route, path: ["4.12.30", "4.13.61", "4.14.58"], firstSupported: null, hops: route.hops.slice(0, 2), docs: [] }) });
    render(<ExploreHistory plan={plan()} supportedMinors={["4.20", "4.21", "4.22"]} highSide={false} onPlanSupportedPart={() => {}} />);
    open();
    fireEvent.change(screen.getByLabelText("Release the cluster runs", { selector: "input" }), { target: { value: "4.12.30" } });
    fireEvent.change(screen.getByLabelText("Release to explore up to", { selector: "input" }), { target: { value: "4.14.58" } });
    fireEvent.click(screen.getByRole("button", { name: "Explore the route" }));
    await screen.findByText(/Shown as Red Hat's update graph lists it today/);
    expect(screen.queryByRole("button", { name: /Plan the supported part/ })).toBeNull();
  });
  it("when no route can be established it says exactly why and what to do", async () => {
    mockApi({ "/api/upgrade/explore": () => ({ ok: false, exploration: true, reasons: [{ code: "SOURCE_NOT_IN_GRAPHS", message: "4.12.3 is not in Red Hat's update graph today (stable-4.12 for amd64). Updates from it are no longer listed." }], nextStep: "Update within 4.12 to a release that is still listed." }) });
    render(<ExploreHistory plan={plan()} supportedMinors={["4.20", "4.21", "4.22"]} highSide={false} onPlanSupportedPart={() => {}} />);
    open();
    fireEvent.change(screen.getByLabelText("Release the cluster runs", { selector: "input" }), { target: { value: "4.12.3" } });
    fireEvent.change(screen.getByLabelText("Release to explore up to", { selector: "input" }), { target: { value: "4.14.58" } });
    fireEvent.click(screen.getByRole("button", { name: "Explore the route" }));
    expect(await screen.findByText(/No complete recommended route can be shown/)).toBeInTheDocument();
    expect(screen.getByText(/no longer listed/)).toBeInTheDocument();
    expect(screen.getByText(/Update within 4.12/)).toBeInTheDocument();
  });
});
