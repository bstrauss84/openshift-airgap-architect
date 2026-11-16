/**
 * v2.2.0 R-UX01 / R-UX08 — the profile workspace: one row of contextual tabs,
 * visible blockers with "Go to" links, every panel kept mounted, a Latest
 * activity line instead of the activity and storage cards.
 */
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor, within } from "@testing-library/react";
import { apiFetch } from "../src/api.js";
import ProfileWorkspace, { workspaceTabs } from "../src/mirroring/ProfileWorkspace.jsx";
import { _resetSourceCredentialsForTests } from "../src/mirroring/sourceCredentialSession.js";
import { _resetScanSessionsForTests } from "../src/mirroring/useProfileCatalogs.js";

vi.mock("../src/api.js", () => ({ apiFetch: vi.fn(), API_BASE: "" }));

let operations;
const paths = { root: "/d", archivePath: "/d/a", workspacePath: "/d/w", cachePath: "/d/c", receivedPath: "/d/r" };
const profileOf = (content, extra = {}) => ({
  id: "p-tabs0000001", name: "Tabs", updatedAt: 1, kind: "planned", content,
  platform: { release: { channel: "4.22", patchVersion: "4.22.20" }, version: { selectedMinor: "4.22", locked: false }, graph: true },
  operators: { catalogMinor: "4.22", catalogMinorSource: "platform", selected: [] },
  additionalImages: [{ id: "i1", name: "quay.io/a/b:1", source: "user" }],
  options: {}, execution: { mode: "mirrorToDisk", registryUrl: "", options: {} }, history: [], transfers: [], received: [], imports: [],
  readiness: [], paths, catalogReconciliation: null, ...extra
});
beforeEach(() => {
  _resetSourceCredentialsForTests();
  _resetScanSessionsForTests();
  operations = [];
  vi.mocked(apiFetch).mockReset();
  vi.mocked(apiFetch).mockImplementation((path) => {
    if (path === "/api/mirroring/operations") return Promise.resolve({ operations });
    if (path === "/api/secrets/rh-pull-secret") return Promise.resolve({ available: false });
    if (/\/runs$/.test(path)) return Promise.resolve({ runs: [], activeVerification: null });
    if (path.startsWith("/api/operators/status")) return Promise.resolve({});
    if (path.startsWith("/api/mirroring/storage")) return Promise.resolve({ configured: { base: "/d", source: "default", ok: true }, profile: { base: "/d", source: "default", ok: true, paths } });
    return Promise.resolve({});
  });
});
afterEach(cleanup);

const mount = (profile, props = {}) => render(<ProfileWorkspace profile={profile} onEditContent={vi.fn()} onDelete={vi.fn()} onProfileChanged={vi.fn()} onProfilesChanged={vi.fn()} onShowOperation={props.onShowOperation || vi.fn()} />);
const tabNames = () => screen.getAllByRole("tab").map((t) => t.textContent);

describe("tabs (R-UX01)", () => {
  it("one tab per selected content type plus Run & transfers; arrow keys move between them; panels stay mounted", async () => {
    mount(profileOf({ platform: true, operators: true, additionalImages: true }));
    expect(tabNames()).toEqual(["Platform", "Operators · 0", "Additional images · 1", "Run & transfers"]);
    const [platform, operators] = screen.getAllByRole("tab");
    expect(platform).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(platform, { key: "ArrowRight" });
    expect(operators).toHaveAttribute("aria-selected", "true");
    expect(document.activeElement).toBe(operators);
    fireEvent.keyDown(operators, { key: "End" });
    expect(screen.getByRole("tab", { name: "Run & transfers" })).toHaveAttribute("aria-selected", "true");
    // Hidden panels are still in the document (state and polling survive switching).
    expect(screen.getByRole("heading", { name: "Operators", hidden: true })).toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: "Preflight and run" })).toBeVisible();
  });

  it("a single content type gets Content | Run & transfers; a received profile has no tabs", () => {
    expect(workspaceTabs(profileOf({ platform: false, operators: false, additionalImages: true })).map((t) => t.label)).toEqual(["Content", "Run & transfers"]);
    expect(workspaceTabs(profileOf({ platform: false, operators: false, additionalImages: true }, { kind: "received" }))).toEqual([]);
  });

  it("what was typed survives a tab switch", async () => {
    mount(profileOf({ platform: false, operators: false, additionalImages: true }));
    fireEvent.click(screen.getByRole("tab", { name: "Run & transfers" }));
    const creds = (await screen.findByRole("heading", { name: /^Credentials/ })).closest("section");
    const box = within(creds).getByRole("textbox", { name: /pull secret/i });
    fireEvent.change(box, { target: { value: '{"auths":{"quay.io":{"auth":"eDp5"}}}' } });
    fireEvent.click(screen.getByRole("tab", { name: "Content" }));
    fireEvent.click(screen.getByRole("tab", { name: "Run & transfers" }));
    expect(within(creds).getByRole("textbox", { name: /pull secret/i }).value).not.toBe("");
  });
});

describe("blockers stay visible (R-UX01)", () => {
  it("the tab with a blocker says so, and Go to release lock opens Platform and focuses the lock", async () => {
    const p = profileOf({ platform: true, operators: true, additionalImages: false }, { readiness: [{ path: "platform.version.locked", message: "Lock the selected OpenShift release before generating platform content." }] });
    mount(p);
    fireEvent.click(screen.getByRole("tab", { name: /^Operators/ }));
    expect(screen.getByRole("tab", { name: "Platform · 1 to fix" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Go to release lock" }));
    expect(screen.getByRole("tab", { name: /^Platform/ })).toHaveAttribute("aria-selected", "true");
    // The Lock button when it can take focus, otherwise the release section that holds it.
    await waitFor(() => expect(["mirroring-lock-p-tabs0000001", "mirroring-release-p-tabs0000001"]).toContain(document.activeElement?.id));
  });
});

describe("less duplication (R-UX08)", () => {
  it("Latest activity names the newest operation of this profile and links to it; the activity and storage cards are gone", async () => {
    operations = [
      { jobId: "j-other", kind: "run", status: "running", title: "Mirror to disk", profileId: "p-someone-else", createdAt: 3 },
      { jobId: "j-mine", kind: "catalog-check", status: "completed_with_warnings", title: "Live catalog check", profileId: "p-tabs0000001", createdAt: 2 }
    ];
    const onShowOperation = vi.fn();
    mount(profileOf({ platform: false, operators: true, additionalImages: true }), { onShowOperation });
    const line = await screen.findByText(/Latest activity:/);
    expect(line.closest("p")).toHaveTextContent(/Live catalog check · Completed with warnings/);
    fireEvent.click(within(line.closest("p")).getByRole("button", { name: "View in Operations" }));
    expect(onShowOperation).toHaveBeenCalledWith("j-mine");
    expect(screen.queryByRole("heading", { name: "Mirroring activity", hidden: true })).toBeNull();
    expect(screen.queryByRole("heading", { name: "Storage on the server", hidden: true })).toBeNull();
  });

  it("no activity yet: says what will appear there", async () => {
    mount(profileOf({ platform: false, operators: false, additionalImages: true }));
    expect(await screen.findByText(/No activity yet\. Scans, catalog checks, runs and transfers of this profile are listed in Operations/)).toBeInTheDocument();
  });
});
