/**
 * OpenShift Airgap Architect - Test Suite
 *
 * The update banner must be truthful about what the app actually knows, and must
 * tell the operator to back up BEFORE updating.
 *
 * 1. Release identity (v2.1.1 contract). The banner is raised only when the
 *    backend found a PUBLISHED, stable GitHub Release semantically newer than the
 *    installed package version. v1.7.1 fired on a branch-commit difference (which
 *    could point backwards); v2.1.0 then made the banner unreachable by
 *    hardcoding `releaseIdentity: null` and refusing to evaluate when the Git SHA
 *    was unknown. Neither the SHA nor a branch is consulted now.
 *
 * 2. Backup guidance. The banner names Tools -> Export Run before updating,
 *    Tools -> Import Run after, states that credentials are excluded and must be
 *    re-entered, and distinguishes the run JSON from the generated bundle ZIP.
 *
 * @author Bill Strauss
 *
 * Developed with AI assistance from Claude (Anthropic) and Cursor AI.
 */

import React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, waitFor, within, cleanup } from "@testing-library/react";
import App, { shouldShowUpdateBanner } from "../src/App.jsx";
import { apiFetch } from "../src/api.js";
import { UPDATE_STATUS } from "../../shared/updateStatus.js";
import { stateWithBlueprintCompleteMethodologyIncomplete } from "./fixtures/minimalState.js";

vi.mock("../src/api.js", () => ({ apiFetch: vi.fn(), API_BASE: "http://localhost:4000" }));

const RUNNING_SHA = "e0944b5904c4824e22ac188b2069b498781bab99";
const BRANCH_SHA = "ffed74d0807d7a3bfcd321b660d7145b6d43b44d";
const REPO = "owner/repo";

const identity = (version) => ({
  verified: true,
  source: "github-releases-api",
  repo: REPO,
  latest: version
    ? { version, tag: `v${version}`, url: `https://github.com/${REPO}/releases/tag/v${version}`, publishedAt: "2026-11-01T00:00:00Z" }
    : null
});

/** A realistic v2.1.1 /api/update-info payload. Git SHA is unknown (Compose default). */
const payload = (overrides) => ({
  enabled: true, error: null, installedVersion: "2.1.0", currentSha: "unknown", latestSha: null,
  repo: REPO, checkedAt: "2026-10-21T12:00:00Z", ...overrides
});

/** Mount App with a given /api/update-info payload; returns the update-info mock. */
function mockApp(updateInfo, buildInfo = { version: "2.1.0", gitSha: "unknown", buildTime: "2026-10-21", repo: REPO, branch: "main" }) {
  vi.mocked(apiFetch).mockImplementation((path) => {
    if (path === "/api/state") return Promise.resolve(stateWithBlueprintCompleteMethodologyIncomplete());
    if (path === "/api/schema/stepMap") return Promise.resolve({ version: "1", mvpSteps: [] });
    if (path === "/api/build-info") return Promise.resolve(buildInfo);
    if (path === "/api/feedback/config") {
      return Promise.resolve({
        visible: true, enabled: true, mode: "offline", reason: "", challengeRequired: true, minDwellMs: 0,
        limits: { summaryMaxChars: 200, detailsMaxChars: 4000, contactMaxChars: 200, maxPayloadBytes: 32768 },
        enums: { categories: ["bug"], severities: ["low"] }
      });
    }
    if (path === "/api/update-info") return Promise.resolve(updateInfo);
    return Promise.resolve({});
  });
}

describe("shouldShowUpdateBanner follows the published-release contract", () => {
  it("is TRUE for a newer published release even though the Git SHA is unknown", () => {
    expect(shouldShowUpdateBanner(payload({
      updateStatus: UPDATE_STATUS.PUBLISHED_SUPPORTED_UPDATE, urgent: true, releaseIdentity: identity("2.2.0")
    }))).toBe(true);
  });

  it("is TRUE when recomputed from raw fields (no updateStatus) for a newer release", () => {
    expect(shouldShowUpdateBanner(payload({ releaseIdentity: identity("2.2.0") }))).toBe(true);
  });

  it.each([
    ["same version", identity("2.1.0")],
    ["older release (no downgrade)", identity("2.0.0")],
    ["no eligible release", identity(null)],
    ["unverified identity", { ...identity("9.9.9"), verified: false }],
    ["prerelease version", identity("2.2.0-rc.1")]
  ])("is FALSE when recomputed for %s", (_label, releaseIdentity) => {
    expect(shouldShowUpdateBanner(payload({ releaseIdentity }))).toBe(false);
  });

  it("is FALSE for a legacy branch-commit difference (the v1.7.1 false prompt)", () => {
    expect(shouldShowUpdateBanner({
      enabled: true, isOutdated: true, error: null,
      currentSha: RUNNING_SHA, latestSha: BRANCH_SHA, branch: "main", repo: REPO
    })).toBe(false);
  });

  it("is FALSE when the installed version is unknown, whatever the release says", () => {
    expect(shouldShowUpdateBanner(payload({ installedVersion: "unknown", releaseIdentity: identity("9.9.9") }))).toBe(false);
  });

  it.each([
    [UPDATE_STATUS.OFFLINE, { error: "Request timed out" }],
    [UPDATE_STATUS.UNKNOWN, { installedVersion: "unknown" }],
    [UPDATE_STATUS.DISABLED, { enabled: false }],
    [UPDATE_STATUS.UP_TO_DATE, { releaseIdentity: identity("2.1.0") }]
  ])("is FALSE for %s", (updateStatus, extra) => {
    expect(shouldShowUpdateBanner(payload({ updateStatus, releaseIdentity: null, ...extra }))).toBe(false);
  });
});

describe("Landing banner rendering", () => {
  afterEach(() => { cleanup(); });

  it.each([
    ["up to date", { updateStatus: UPDATE_STATUS.UP_TO_DATE, releaseIdentity: identity("2.1.0") }],
    ["offline", { updateStatus: UPDATE_STATUS.OFFLINE, error: "Request timed out", releaseIdentity: null }],
    ["unknown", { updateStatus: UPDATE_STATUS.UNKNOWN, installedVersion: "unknown", releaseIdentity: null }],
    ["disabled", { updateStatus: UPDATE_STATUS.DISABLED, enabled: false, releaseIdentity: null }],
    ["legacy branch diff", { isOutdated: true, currentSha: RUNNING_SHA, latestSha: BRANCH_SHA, installedVersion: undefined }]
  ])("renders no update notice when %s", async (_label, extra) => {
    mockApp(payload(extra));
    const { container } = render(<App />);
    await waitFor(() => expect(container.querySelector(".landing-view")).toBeTruthy());
    expect(container.querySelector(".update-available-banner")).toBeNull();
    expect(container.querySelector(".update-development-note")).toBeNull();
  });

  it("raises the banner for a newer published release with an unknown Git SHA, naming both versions", async () => {
    mockApp(payload({
      updateStatus: UPDATE_STATUS.PUBLISHED_SUPPORTED_UPDATE, urgent: true, isOutdated: true,
      releaseIdentity: identity("2.2.0")
    }));
    const { container } = render(<App />);
    const view = within(container);

    const banner = await waitFor(() => {
      const el = container.querySelector(".update-available-banner");
      expect(el).toBeTruthy();
      return el;
    });

    const text = banner.textContent;
    expect(text).toContain("Version 2.2.0 has been published");
    expect(text).toContain("installed: 2.1.0");
    // A Git SHA is neither required nor printed.
    expect(text).not.toMatch(/current build|unknown/i);

    // Approved backup guidance.
    expect(text).toMatch(/update recommended as soon as practical/i);
    expect(text).toMatch(/Tools\s*→\s*Export Run/);
    expect(text).toMatch(/Tools\s*→\s*Import Run/);
    expect(text).toMatch(/credential/i);
    expect(text).toMatch(/re-enter/i);
    expect(text).toMatch(/ZIP/i);
    expect(text).not.toMatch(/all your (data|jobs|work) (is|are) preserved/i);

    expect(banner.getAttribute("role")).toBe("alert");
    const guide = view.getByRole("link", { name: /update guide/i });
    expect(guide.getAttribute("href")).toMatch(/UPDATING\.md/);
    expect(guide.getAttribute("rel")).toMatch(/noopener/);
    const notes = view.getByRole("link", { name: /release notes/i });
    expect(notes.getAttribute("href")).toBe(`https://github.com/${REPO}/releases/tag/v2.2.0`);
    expect(notes.getAttribute("rel")).toMatch(/noopener/);
  });

  it("does not render a release-notes link for a non-GitHub URL", async () => {
    const releaseIdentity = identity("2.2.0");
    releaseIdentity.latest.url = "javascript:alert(1)";
    mockApp(payload({ updateStatus: UPDATE_STATUS.PUBLISHED_SUPPORTED_UPDATE, releaseIdentity }));
    const { container } = render(<App />);
    await waitFor(() => expect(container.querySelector(".update-available-banner")).toBeTruthy());
    expect(within(container).queryByRole("link", { name: /release notes/i })).toBeNull();
  });
});

describe("Tools → About update status inside the wizard", () => {
  afterEach(() => { cleanup(); document.body.innerHTML = ""; });

  /** Resume directly into the wizard (as after a reload), never visiting landing. */
  function mockWizardResume(updateInfoImpl) {
    vi.mocked(apiFetch).mockImplementation((path) => {
      if (path === "/api/state") {
        const s = stateWithBlueprintCompleteMethodologyIncomplete();
        return Promise.resolve({ ...s, ui: { ...(s.ui || {}), showLanding: false } });
      }
      if (path === "/api/schema/stepMap") return Promise.resolve({ version: "1", mvpSteps: [] });
      if (path === "/api/build-info") return Promise.resolve({ version: "2.1.0", gitSha: "unknown", buildTime: "2026-10-21", repo: REPO, branch: "main" });
      if (path === "/api/feedback/config") {
        return Promise.resolve({
          visible: true, enabled: true, mode: "offline", reason: "", challengeRequired: true, minDwellMs: 0,
          limits: { summaryMaxChars: 200, detailsMaxChars: 4000, contactMaxChars: 200, maxPayloadBytes: 32768 },
          enums: { categories: ["bug"], severities: ["low"] }
        });
      }
      if (path === "/api/update-info") return updateInfoImpl();
      return Promise.resolve({});
    });
  }

  async function openToolsUpdateLine() {
    const { default: userEvent } = await import("@testing-library/user-event");
    const user = userEvent.setup();
    render(<App />);
    const { findByRole } = within(document.body);
    await user.click(await findByRole("button", { name: /open tools/i }));
    return waitFor(() => {
      const el = document.querySelector(".about-update-info");
      expect(el).toBeTruthy();
      return el.textContent;
    });
  }

  // The AppShell-remount regression itself is pinned in
  // tests/update-info-survives-gate-remount.test.jsx, which forces a real gate block.
  it("shows the published update in Tools → About for a run resumed into the wizard", async () => {
    mockWizardResume(() => Promise.resolve(payload({
      updateStatus: UPDATE_STATUS.PUBLISHED_SUPPORTED_UPDATE, urgent: true, releaseIdentity: identity("2.2.0")
    })));
    const text = await openToolsUpdateLine();
    expect(text).toContain("Update available: version 2.2.0");
    expect(text).toContain("installed 2.1.0");
    // The configured branch is never presented as build provenance.
    expect(document.querySelector(".about-build-info").textContent).not.toContain("main");
  });

  it("reports a failed update-info request as unavailable, not disabled or up to date", async () => {
    mockWizardResume(() => Promise.reject(new Error("backend unreachable")));
    const text = await openToolsUpdateLine();
    expect(text).toMatch(/Update check unavailable/);
    expect(text).not.toMatch(/disabled|Up to date/i);
  });
});
