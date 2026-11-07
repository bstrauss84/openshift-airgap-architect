/**
 * v2.3.0 — Upgrade workspace UI (jsdom, mocked API).
 *
 * Design-system contract (field structure, structured hints), dependent
 * selectors with reasons, route timeline with its graph's provenance and
 * the tie-break note, conditional targets only inside the review, the
 * accessible graph table, instructions without forbidden flags, readiness in
 * words, and the layered plan deletion.
 *
 * Developed with AI assistance from Claude (Anthropic).
 */
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent, within, cleanup } from "@testing-library/react";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { apiFetch } from "../src/api.js";
import UpgradeShell from "../src/upgrade/UpgradeShell.jsx";
import UpgradeGraphView from "../src/upgrade/UpgradeGraphView.jsx";
import { StageProgress } from "../src/upgrade/ContentTab.jsx";
import { findSupportPlacementViolations, findFragmentWrappedSupport, findBandOrderViolations } from "./helpers/fieldSupportStructure.js";

vi.mock("../src/api.js", () => ({ apiFetch: vi.fn(), API_BASE: "" }));

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(__dirname, "../src");
const UPGRADE_SOURCES = ["upgrade/UpgradeShell.jsx", "upgrade/PathTab.jsx", "upgrade/OperatorsTab.jsx", "upgrade/ContentTab.jsx", "upgrade/InstructionsTab.jsx", "upgrade/ReadinessTab.jsx", "upgrade/ReviewTab.jsx", "upgrade/UpgradeTimeline.jsx", "upgrade/UpgradeGraphView.jsx", "components/ScopedConfirmModal.jsx", "InstallResetDialog.jsx", "LandingPage.jsx"];
const read = (rel) => fs.readFileSync(path.join(SRC, rel), "utf8");

const DIGEST = `quay.io/openshift-release-dev/ocp-release@sha256:${"b".repeat(64)}`;
const GRAPH = {
  channel: "stable-4.22", arch: "amd64", versions: ["4.20.14", "4.20.44", "4.21.40", "4.22.1", "4.22.22"],
  nodes: Object.fromEntries(["4.20.14", "4.20.44", "4.21.40", "4.22.1", "4.22.22"].map((v) => [v, { payload: DIGEST, errataUrl: "https://access.redhat.com/errata/RHSA-2026:1", channels: ["stable-4.22"] }])),
  edges: [["4.20.14", "4.20.44"], ["4.20.44", "4.21.40"], ["4.21.40", "4.22.22"]],
  conditional: [{ from: "4.21.40", to: "4.22.1", risks: [{ name: "SomeRisk", url: "https://issues.redhat.com/x", message: "m", ruleTypes: ["PromQL"] }] }],
  excludedUnsupported: 0, invalidNodes: 0
};
const FRESH = { source: "imported", origin: "snapshot", channel: "stable-4.22", arch: "amd64", sourceUrl: null, fetchedAt: "2026-11-06T16:50:00.000Z", capturedAtKnown: true, bodySha256: "c".repeat(64), stale: true, counts: { versions: 5, edges: 3, conditional: 1, excludedUnsupported: 0 } };
const hop = (from, to, channel, kind) => ({ from, to, kind, conditional: false, risks: [], payload: DIGEST, errataUrl: null, channel, channelCheck: "recommended" });
const basePlan = (extra = {}) => ({
  id: "u-testplan0001", name: "Prod", kind: "planned", arch: "amd64", currentChannel: "stable-4.20", planningChannel: "stable-4.22", channelPolicy: "stable",
  current: "4.20.14", target: "4.22.22", strategy: "standard", channelStrategy: "per-minor", method: "osus", graphSource: "imported",
  conditionalReview: { enabled: false, acknowledgedRisks: [] }, stages: [], stageViews: [], inventory: null, readiness: { attestations: {} },
  updatedAt: "2026-11-06T17:00:00.000Z", graph: FRESH, pathStatus: "as-of",
  path: { solver: "x", computedAt: "2026-11-06T17:00:00.000Z", conditional: false, selectedBy: "default-convention", path: ["4.20.14", "4.20.44", "4.21.40", "4.22.22"],
    hops: [hop("4.20.14", "4.20.44", "stable-4.20", "z-stream"), hop("4.20.44", "4.21.40", "stable-4.21", "minor"), hop("4.21.40", "4.22.22", "stable-4.22", "minor")],
    alternativesTotal: 0, graphSources: [{ channel: "stable-4.22", arch: "amd64", source: "imported", origin: "snapshot", fetchedAt: FRESH.fetchedAt, bodySha256: FRESH.bodySha256 }], reasons: [] },
  ...extra
});

const PRESET_ANALYSIS = {
  confidence: "imported preset (unverified): what a configuration file asked to mirror, not what is installed or mirrored",
  files: [{ index: 0, fileName: "a.yaml", status: "valid", format: "oc-mirror v2 (v2alpha1)", notes: [] }, { index: 1, fileName: "b.yaml", status: "valid", format: "oc-mirror v2 (v2alpha1)", notes: [] }],
  releases: [{ channel: "stable-4.20", minVersion: "4.20.10", maxVersion: "4.20.10", supported: true, note: "A hint only: it is what a file mirrored, not the cluster's current release.", sources: [{ file: "a.yaml" }] }],
  operators: [
    { key: "redhat|kubevirt-hyperconverged", name: "kubevirt-hyperconverged", catalogKind: "redhat", catalogMinors: ["4.20"], channelOptions: ["stable"], suggestedChannel: "stable", duplicates: 2, conflicts: [], sources: [{ file: "a.yaml", sha256: "a".repeat(64) }, { file: "b.yaml", sha256: "b".repeat(64) }] },
    { key: "redhat|odf-operator", name: "odf-operator", catalogKind: "redhat", catalogMinors: ["4.20"], channelOptions: ["stable-4.19", "stable-4.20"], suggestedChannel: null, duplicates: 2, conflicts: ["Files name different channels: stable-4.19, stable-4.20. Choose one."], sources: [{ file: "a.yaml" }, { file: "b.yaml" }] }
  ],
  images: []
};
let calls;
const mock = (plan, { deletion = { stageProfiles: [] }, instructions = null, readiness = null } = {}) => {
  calls = [];
  vi.mocked(apiFetch).mockImplementation((p, opts = {}) => {
    calls.push([p, opts.method || "GET", opts.body]);
    if (p === "/api/upgrade") return Promise.resolve({ _schema: "oaa.upgrade.slice/v1", activePlanId: plan?.id || null, plans: plan ? [plan] : [], supportedMinors: ["4.20", "4.21", "4.22"], highSide: false });
    if (p.startsWith("/api/upgrade/graph?")) return Promise.resolve({ graph: FRESH, normalized: GRAPH });
    if (p.includes("/targets")) return Promise.resolve({ targets: [{ version: "4.22.22", status: "recommended", hops: 3 }, { version: "4.22.1", status: "conditional-only", hops: 3 }] });
    if (p.includes("/deletion-preview")) return Promise.resolve(deletion);
    if (p.includes("/instructions")) return Promise.resolve(instructions);
    if (p.includes("/readiness")) return Promise.resolve(readiness);
    if (p.includes("/artifacts")) return Promise.resolve({ files: [] });
    if (p.startsWith("/api/upgrade/plans/") && opts.method === "DELETE") return Promise.resolve({ ok: true });
    if (p === "/api/upgrade/active") return Promise.resolve({});
    if (p === "/api/mirroring") return Promise.resolve({ profiles: [] });
    if (p.includes("/presets/analyze")) return Promise.resolve(PRESET_ANALYSIS);
    if (p.endsWith("/operator-intent")) {
      const body = JSON.parse(opts.body);
      return Promise.resolve({ plan: { ...plan, operatorIntent: (body.entries || []).map((e) => ({ ...e, key: `${e.catalogKind}|${e.name}` })) }, skipped: [] });
    }
    return Promise.resolve({});
  });
};

beforeEach(() => { sessionStorage.clear(); vi.mocked(apiFetch).mockReset(); });
afterEach(cleanup);

describe("design-system contract", () => {
  it.each(UPGRADE_SOURCES)("%s: no fragment-wrapped support content, no plain hint strings", (rel) => {
    expect(findFragmentWrappedSupport(read(rel))).toEqual([]);
    expect(read(rel)).not.toMatch(/hint="/);
  });
  it("the guard is not vacuous: it reports a support element placed outside its stack", () => {
    const div = document.createElement("div");
    div.innerHTML = '<div class="field-grid"><label>x</label><input /><div class="field-control-support"><span class="field-error">bad</span></div></div>';
    expect(findSupportPlacementViolations(div).length).toBeGreaterThan(0);
  });
  it("the Path tab's fields keep their support content in their own stack", async () => {
    mock(basePlan());
    const { container } = render(<UpgradeShell onExit={() => {}} />);
    await screen.findByRole("heading", { name: "Current and target release" });
    expect(findSupportPlacementViolations(container)).toEqual([]);
    expect(findBandOrderViolations(container)).toEqual([]);
  });
});

describe("Path", () => {
  it("dependent selectors say why they are disabled", async () => {
    mock(basePlan({ currentChannel: null, current: null, target: null, path: null, pathStatus: "none", graph: null }));
    render(<UpgradeShell onExit={() => {}} />);
    const current = await screen.findByLabelText("Current release", { selector: "select" });
    expect(current).toBeDisabled();
    expect(screen.getByText("Choose the current channel first.")).toBeInTheDocument();
    expect(screen.getByLabelText("Target release", { selector: "select" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Compute the update route" })).toBeDisabled();
  });

  it("route: timeline, step channels, provenance 'as of', integrity-only checksum and the tie-break note", async () => {
    mock(basePlan());
    render(<UpgradeShell onExit={() => {}} />);
    const timeline = await screen.findByRole("list", { name: /Update route: 4.20.14 to 4.20.44 to 4.21.40 to 4.22.22/ });
    expect(within(timeline).getByRole("button", { name: /Step 2: 4.20.44 to 4.21.40, channel stable-4.21, minor update/ })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Recommended route (as of its graph)" })).toBeInTheDocument();
    expect(screen.getAllByText(/imported snapshot \(not fetched by Architect\)/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/integrity of this copy only; the graph is not signed/).length).toBeGreaterThan(0);
    expect(screen.getByText(/That is not a safety ranking/)).toBeInTheDocument();
    fireEvent.click(within(timeline).getByRole("button", { name: /Step 3/ }));
    expect(await screen.findByRole("heading", { name: "Step 3: 4.21.40 → 4.22.22" })).toBeInTheDocument();
  });

  it("conditional-only targets appear only inside the deliberate review", async () => {
    mock(basePlan());
    render(<UpgradeShell onExit={() => {}} />);
    const target = await screen.findByLabelText("Target release", { selector: "select" });
    await waitFor(() => expect(within(target).getByRole("option", { name: /4.22.22/ })).toBeInTheDocument());
    expect(within(target).queryByRole("option", { name: /4.22.1 \(conditional\)/ })).toBeNull();
    expect(screen.getByText(/1 more release\(s\) are reachable only through conditional updates/)).toBeInTheDocument();
    cleanup();
    mock(basePlan({ conditionalReview: { enabled: true, acknowledgedRisks: [] } }));
    render(<UpgradeShell onExit={() => {}} />);
    const t2 = await screen.findByLabelText("Target release", { selector: "select" });
    await waitFor(() => expect(within(t2).getByRole("option", { name: /4.22.1 \(conditional\)/ })).toBeInTheDocument());
  });

  it("the channel graph has an accessible table and keyboard zoom", () => {
    render(<UpgradeGraphView graph={GRAPH} path={basePlan().path} />);
    const svg = screen.getByRole("group", { name: /stable-4.22 update graph/ });
    fireEvent.keyDown(svg, { key: "+" });
    fireEvent.click(screen.getByRole("button", { name: "Accessible table" }));
    const table = screen.getByRole("table");
    const row = within(table).getByRole("rowheader", { name: "4.21.40" }).closest("tr");
    expect(row).toHaveTextContent("yes");
    expect(row).toHaveTextContent("4.22.22");
    expect(row).toHaveTextContent("4.22.1");
  });
});

describe("Instructions and readiness", () => {
  const INS = {
    ok: true, status: { state: "incomplete", message: "This procedure is conditional: 2 readiness check(s) are blocked or not checked (etcd-backup, cvo-health).", clusterReadiness: "not verified (no cluster evidence)" },
    target: "4.22.22", targetMinor: "4.22", route: ["4.20.14", "4.20.44"], selectedBy: "default-convention", tieBreakNote: "Among equally short recommended routes, the one with the highest release at each step is shown by convention. That is not a safety ranking; you may choose another route.",
    never: ["--force", "--allow-upgrade-with-warnings", "--allow-not-recommended", "oc adm upgrade accept"],
    methods: Object.fromEntries(["osus", "cli", "web"].map((m) => [m, { method: m, recommended: m === "osus", note: `${m} note`, setup: [], before: [], after: [], cpo: null,
      hops: [{ index: 0, from: "4.20.14", to: "4.20.44", channel: "stable-4.20", kind: "z-stream", conditional: false, docs: [], steps: [{ title: "Update to 4.20.44", kind: "command", requires: ["etcd-backup"], commands: [{ label: "Start the update", text: m === "cli" ? `oc adm upgrade --allow-explicit-upgrade --to-image r/openshift/release-images@sha256:${"b".repeat(64)}` : "oc adm upgrade --to=4.20.44" }], doc: { title: "Updating a cluster in a disconnected environment (OpenShift 4.20)", url: "https://docs.redhat.com/en/documentation/openshift_container_platform/4.20/html/disconnected_environments/updating-a-cluster-in-a-disconnected-environment", humanVerified: false } }] }] }]))
  };
  it("three methods, OSUS first; conditional status and open checks are spelled out", async () => {
    sessionStorage.setItem("oaa.upgrade.tab.v1", "instructions");
    mock(basePlan(), { instructions: INS });
    render(<UpgradeShell onExit={() => {}} />);
    expect(await screen.findByRole("tab", { name: "OpenShift Update Service (recommended)" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText(/This procedure is conditional/)).toBeInTheDocument();
    expect(screen.getByText(/Run only after these readiness checks are confirmed: etcd-backup/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "CLI without OSUS" }));
    expect(screen.getByText(/--to-image r\/openshift\/release-images@sha256:/)).toBeInTheDocument();
    expect(screen.getByText(/link not yet confirmed by a person/)).toBeInTheDocument();
  });
  it("readiness states are words and icons; attested is never 'verified'", async () => {
    sessionStorage.setItem("oaa.upgrade.tab.v1", "readiness");
    const readiness = { summary: { state: "incomplete", blocked: 0, notChecked: 1, warnings: 0, attested: 1, clusterReadiness: "not verified (no cluster evidence)" }, cpo: null,
      checks: [{ id: "etcd-backup", state: "ATTESTED", title: "etcd backup", detail: "Stated by the administrator.", attestable: true }, { id: "cvo-health", state: "NOT_CHECKED", title: "Cluster version operator", detail: "Import it." }],
      attestable: { "etcd-backup": "A current etcd backup exists." }, inventoryCommands: { clusterversion: "oc get clusterversion version -o json", csv: "c", subscription: "s", mcp: "m" } };
    mock(basePlan(), { readiness });
    render(<UpgradeShell onExit={() => {}} />);
    expect(await screen.findByText("✎ Attested")).toBeInTheDocument();
    expect(screen.getByText("? Not checked")).toBeInTheDocument();
    expect(screen.getByText(/Cluster readiness: not verified/)).toBeInTheDocument();
    expect(screen.getByText(/never as verified/)).toBeInTheDocument();
    expect(screen.getByText("oc get clusterversion version -o json")).toBeInTheDocument();
  });
});

describe("plan deletion (layered consent)", () => {
  it("the plan record by default; stage profile records only when ticked; disk data always kept", async () => {
    sessionStorage.setItem("oaa.upgrade.tab.v1", "review");
    mock(basePlan(), { deletion: { planRecord: { id: "u-testplan0001" }, stageProfiles: [{ id: "p-s1", name: "Prod · stage 1 · 4.20.44", running: false, retainedPaths: { archivePath: "/data/oc-mirror/profiles/p-s1/archives", workspacePath: "/w", cachePath: "/c" } }] } });
    render(<UpgradeShell onExit={() => {}} />);
    fireEvent.click(await screen.findByRole("button", { name: "Delete plan…" }));
    const dialog = await screen.findByRole("dialog");
    await waitFor(() => expect(within(dialog).getByText(/kept as an ordinary Mirroring profile/)).toBeInTheDocument());
    expect(within(dialog).getByText(/\/data\/oc-mirror\/profiles\/p-s1\/archives/)).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("checkbox"));
    expect(within(dialog).getByText(/Stage profile record “Prod · stage 1 · 4.20.44”/)).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete the plan and its stage profile records" }));
    await waitFor(() => expect(calls.some(([p, m]) => m === "DELETE" && p === "/api/upgrade/plans/u-testplan0001?removeStageProfiles=true")).toBe(true));
  });
  it("refused while a stage runs", async () => {
    sessionStorage.setItem("oaa.upgrade.tab.v1", "review");
    mock(basePlan(), { deletion: { stageProfiles: [{ id: "p-s1", name: "s1", running: true, retainedPaths: {} }] } });
    render(<UpgradeShell onExit={() => {}} />);
    fireEvent.click(await screen.findByRole("button", { name: "Delete plan…" }));
    const dialog = await screen.findByRole("dialog");
    await waitFor(() => expect(within(dialog).getByText(/A stage of this plan is running/)).toBeInTheDocument());
    expect(within(dialog).getByRole("button", { name: "Delete the plan" })).toBeDisabled();
  });
});


describe("sticky tabs and tab-change scrolling (correction pass)", () => {
  it("the Upgrade layout lets its columns shrink, so narrow screens scroll the tab row, not the whole area", () => {
    // Layout is not computed in jsdom; the rendered 390 px check (Playwright probe) found #upgrade-main 700 px wide
    // without these rules. They mirror .mirroring-layout > * { min-width: 0 }.
    const css = read("styles.css");
    expect(css).toMatch(/\.upgrade-layout > \* \{ min-width: 0; \}/);
    expect(css).toMatch(/@media \(max-width: 900px\) \{\s*\.upgrade-layout \{\s*grid-template-columns: minmax\(0, 1fr\);/);
  });
  it("the tab row sits after an anchor, the header height is measured, and a deep scroll returns to the new tab's start", async () => {
    mock(basePlan());
    const { container } = render(<UpgradeShell onExit={() => {}} />);
    const tabs = await screen.findByRole("tablist", { name: /Prod: sections/ });
    const anchor = tabs.previousElementSibling;
    expect(anchor.classList.contains("mirroring-tabs-anchor")).toBe(true);
    expect(container.querySelector(".upgrade-shell").style.getPropertyValue("--mirroring-header-h")).toMatch(/px$/);
    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual(["Path", "Operators", "Content & runs", "Instructions", "Readiness", "Review & export"]);
    const main = document.getElementById("upgrade-main");
    Object.defineProperty(main, "scrollHeight", { value: 5000, configurable: true });
    Object.defineProperty(main, "clientHeight", { value: 800, configurable: true });
    main.scrollTop = 1200;
    anchor.getBoundingClientRect = () => ({ top: -700, bottom: -700, left: 0, right: 0, width: 0, height: 0 });
    main.getBoundingClientRect = () => ({ top: 0, bottom: 800, left: 0, right: 0, width: 0, height: 800 });
    fireEvent.click(screen.getByRole("tab", { name: "Readiness" }));
    expect(main.scrollTop).toBe(500);
    // Keyboard activation reveals too; panels stay mounted (entered state is kept).
    main.scrollTop = 1200;
    fireEvent.keyDown(screen.getByRole("tab", { name: "Readiness" }), { key: "ArrowLeft" });
    expect(screen.getByRole("tab", { name: "Instructions" })).toHaveAttribute("aria-selected", "true");
    expect(main.scrollTop).toBe(500);
    expect(document.getElementById("upgrade-tabpanel-path").hidden).toBe(true);
    expect(within(document.getElementById("upgrade-tabpanel-path")).getByLabelText("Current release", { selector: "select" })).toBeInTheDocument();
  });
  it("near the top nothing moves", async () => {
    mock(basePlan());
    render(<UpgradeShell onExit={() => {}} />);
    const tabs = await screen.findByRole("tablist", { name: /Prod: sections/ });
    const main = document.getElementById("upgrade-main");
    main.scrollTop = 40;
    tabs.previousElementSibling.getBoundingClientRect = () => ({ top: 120, bottom: 120, left: 0, right: 0, width: 0, height: 0 });
    main.getBoundingClientRect = () => ({ top: 0, bottom: 800, left: 0, right: 0, width: 0, height: 800 });
    fireEvent.click(screen.getByRole("tab", { name: "Operators" }));
    expect(main.scrollTop).toBe(40);
  });
});

describe("ImageSetConfiguration presets (correction pass)", () => {
  it("reviewed per file, conflicts shown, accepted as unverified presets with their sources", async () => {
    sessionStorage.setItem("oaa.upgrade.tab.v1", "operators");
    mock(basePlan());
    render(<UpgradeShell onExit={() => {}} />);
    const input = await screen.findByLabelText("ImageSetConfiguration files", { selector: "input" });
    const f1 = new File(["apiVersion: mirror.openshift.io/v2alpha1"], "a.yaml", { type: "text/yaml" });
    const f2 = new File(["apiVersion: mirror.openshift.io/v2alpha1"], "b.yaml", { type: "text/yaml" });
    fireEvent.change(input, { target: { files: [f1, f2] } });
    await screen.findByRole("heading", { name: "Operators found" });
    expect(screen.getByText(/hint · unverified/)).toBeInTheDocument();
    expect(screen.getByText(/not the cluster's current release/)).toBeInTheDocument();
    expect(screen.getByText(/Files name different channels/)).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Add odf-operator" })).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Add kubevirt-hyperconverged" })).toBeChecked();
    fireEvent.click(screen.getByRole("button", { name: "Add the ticked items to the plan" }));
    await waitFor(() => expect(calls.some(([p, m]) => p.endsWith("/operator-intent") && m === "POST")).toBe(true));
    const body = JSON.parse(calls.find(([p]) => p.endsWith("/operator-intent"))[2]);
    expect(body.entries).toHaveLength(1);
    expect(body.entries[0]).toMatchObject({ name: "kubevirt-hyperconverged", confidence: "imported-preset", category: "preset-mirrored", channel: "stable" });
    expect(body.entries[0].sources.map((x) => x.file)).toEqual(["a.yaml", "b.yaml"]);
    expect(await screen.findByText("imported preset — unverified")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Confirm installed" })).toBeInTheDocument();
  });
  it("a release hint never replaces the current release without confirmation", async () => {
    sessionStorage.setItem("oaa.upgrade.tab.v1", "operators");
    mock(basePlan());
    render(<UpgradeShell onExit={() => {}} />);
    const input = await screen.findByLabelText("ImageSetConfiguration files", { selector: "input" });
    fireEvent.change(input, { target: { files: [new File(["x"], "a.yaml")] } });
    fireEvent.click(await screen.findByRole("button", { name: /Use 4.20.10 as the current release/ }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/not evidence of what the cluster runs/)).toBeInTheDocument();
    expect(calls.some(([p, m, b]) => m === "POST" && p === "/api/upgrade/plans/u-testplan0001" && String(b).includes("4.20.10"))).toBe(false);
  });
});

describe("stage progress (correction pass)", () => {
  it("steps come from evidence only; mirror to mirror marks disk/transfer as not needed; no percentages", () => {
    render(<StageProgress view={{ id: "s2", clusterUpdated: "none", content: { state: "in-registry-unverified", evidence: [{ kind: "mirrored-to-registry" }] } }} />);
    const list = screen.getByRole("list", { name: "Stage 2 progress" });
    expect(within(list).getByText("Mirrored to disk (not needed)")).toBeInTheDocument();
    expect(within(list).getByText("In the registry").closest("li")).toHaveAttribute("data-state", "done");
    expect(within(list).getByText("Registry verified").closest("li")).toHaveAttribute("aria-current", "step");
    expect(list.textContent).not.toMatch(/%/);
  });
  it("a running stage marks only its next step as in progress", () => {
    render(<StageProgress view={{ id: "s1", clusterUpdated: "none", content: { state: "running", evidence: [] } }} />);
    expect(screen.getByText("Mirrored to disk (in progress)").closest("li")).toHaveAttribute("data-state", "active");
  });
});
