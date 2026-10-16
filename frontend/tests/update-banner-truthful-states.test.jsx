/**
 * OpenShift Airgap Architect - Test Suite
 *
 * The update banner must be truthful about what the app actually knows, and must
 * tell the operator to back up BEFORE updating.
 *
 * Two separate defects are pinned here.
 *
 * 1. Release identity. The old banner fired on `isOutdated`, which is just
 *    `branchHeadSha !== runningSha`. There are no published GitHub Releases for
 *    this repository, and `APP_BRANCH` defaults to `main`, which points at the
 *    v1.7.1 commit — so a running v2.1 build was told an "update" was available
 *    and pointed five months BACKWARDS. Only a verified published release may
 *    raise the urgent banner, and no trusted source for that exists yet, so the
 *    urgent state must be unreachable from a real backend response.
 *
 * 2. Backup guidance. The approved contract requires the banner to name
 *    Tools -> Export Run before updating, Tools -> Import Run after, state that
 *    credentials are excluded and must be re-entered, and distinguish the run
 *    JSON from the generated bundle ZIP. The old copy said only "See Tools ->
 *    About for update steps".
 *
 * @author Bill Strauss
 *
 * Developed with AI assistance from Claude (Anthropic) and Cursor AI.
 */

import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, within, cleanup } from "@testing-library/react";
import App, { shouldShowUpdateBanner } from "../src/App.jsx";
import { apiFetch } from "../src/api.js";
import { UPDATE_STATUS } from "../../shared/updateStatus.js";
import { stateWithBlueprintCompleteMethodologyIncomplete } from "./fixtures/minimalState.js";

vi.mock("../src/api.js", () => ({ apiFetch: vi.fn(), API_BASE: "http://localhost:4000" }));

const RUNNING_SHA = "e0944b5904c4824e22ac188b2069b498781bab99";
const BRANCH_SHA = "ffed74d0807d7a3bfcd321b660d7145b6d43b44d";

/** Mount App with a given /api/update-info payload. */
function mockApp(updateInfo) {
  vi.mocked(apiFetch).mockImplementation((path) => {
    if (path === "/api/state") return Promise.resolve(stateWithBlueprintCompleteMethodologyIncomplete());
    if (path === "/api/schema/stepMap") return Promise.resolve({ version: "1", mvpSteps: [] });
    if (path === "/api/build-info") {
      return Promise.resolve({ gitSha: RUNNING_SHA, buildTime: "2026-10-16", repo: "owner/repo", branch: "main" });
    }
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

describe("shouldShowUpdateBanner is driven by release identity, not a SHA diff", () => {
  it("is FALSE for a differing branch commit (the real main=v1.7.1 vs running v2.1 case)", () => {
    expect(
      shouldShowUpdateBanner({
        enabled: true,
        isOutdated: true, // legacy flag says "outdated" - it must not be believed
        error: null,
        currentSha: RUNNING_SHA,
        latestSha: BRANCH_SHA,
        updateStatus: UPDATE_STATUS.DEVELOPMENT_BRANCH_AHEAD,
        releaseIdentity: null,
        branch: "main",
        repo: "bstrauss84/openshift-airgap-architect"
      })
    ).toBe(false);
  });

  it("is FALSE when the backend omits updateStatus but only a SHA differs", () => {
    // Older backend payload. Must fail closed rather than trusting isOutdated.
    expect(
      shouldShowUpdateBanner({
        enabled: true,
        isOutdated: true,
        error: null,
        currentSha: RUNNING_SHA,
        latestSha: BRANCH_SHA,
        branch: "main",
        repo: "r"
      })
    ).toBe(false);
  });

  it.each([
    [UPDATE_STATUS.OFFLINE, { error: "Request timed out" }],
    [UPDATE_STATUS.UNKNOWN, { currentSha: "unknown" }],
    [UPDATE_STATUS.DISABLED, { enabled: false }],
    [UPDATE_STATUS.UP_TO_DATE, {}]
  ])("is FALSE for %s", (updateStatus, extra) => {
    expect(
      shouldShowUpdateBanner({
        enabled: true, error: null, currentSha: RUNNING_SHA, latestSha: RUNNING_SHA,
        updateStatus, releaseIdentity: null, branch: "main", repo: "r", ...extra
      })
    ).toBe(false);
  });

  it("is TRUE only for a verified published supported release", () => {
    // Synthetic fixture. No production backend can currently produce this.
    expect(
      shouldShowUpdateBanner({
        enabled: true,
        error: null,
        currentSha: RUNNING_SHA,
        latestSha: BRANCH_SHA,
        updateStatus: UPDATE_STATUS.PUBLISHED_SUPPORTED_UPDATE,
        releaseIdentity: { verified: true, isNewer: true, version: "2.2.0", tag: "v2.2.0" },
        branch: "main",
        repo: "r"
      })
    ).toBe(true);
  });
});

describe("Landing banner rendering", () => {
  afterEach(() => { cleanup(); });

  it("shows NO urgent banner when the branch merely moved", async () => {
    mockApp({
      enabled: true, isOutdated: true, error: null,
      currentSha: RUNNING_SHA, latestSha: BRANCH_SHA,
      updateStatus: UPDATE_STATUS.DEVELOPMENT_BRANCH_AHEAD, releaseIdentity: null,
      branch: "main", repo: "owner/repo", checkedAt: "2026-10-16T12:00:00Z"
    });
    const { container } = render(<App />);
    const view = within(container);
    await waitFor(() => expect(view.queryByRole("alert")).not.toBeInTheDocument());
    expect(view.queryByText(/update recommended as soon as practical/i)).not.toBeInTheDocument();
  });

  it("shows an honest, non-urgent note that the source branch differs", async () => {
    mockApp({
      enabled: true, isOutdated: true, error: null,
      currentSha: RUNNING_SHA, latestSha: BRANCH_SHA,
      updateStatus: UPDATE_STATUS.DEVELOPMENT_BRANCH_AHEAD, releaseIdentity: null,
      branch: "main", repo: "owner/repo", checkedAt: "2026-10-16T12:00:00Z"
    });
    const { container } = render(<App />);
    const view = within(container);
    await waitFor(() => {
      expect(view.getByText(/different commit/i)).toBeInTheDocument();
    });
    // It must NOT claim a release is available.
    const note = container.querySelector(".update-development-note");
    expect(note).toBeTruthy();
    expect(note.textContent).not.toMatch(/update available/i);
  });

  it.each([
    ["offline", { updateStatus: UPDATE_STATUS.OFFLINE, error: "Request timed out" }],
    ["unknown", { updateStatus: UPDATE_STATUS.UNKNOWN, currentSha: "unknown" }],
    ["disabled", { updateStatus: UPDATE_STATUS.DISABLED, enabled: false }]
  ])("renders no update notice at all when %s", async (_label, extra) => {
    mockApp({
      enabled: true, isOutdated: false, error: null,
      currentSha: RUNNING_SHA, latestSha: null, releaseIdentity: null,
      branch: "main", repo: "owner/repo", checkedAt: "2026-10-16T12:00:00Z", ...extra
    });
    const { container } = render(<App />);
    await waitFor(() => expect(container.querySelector(".landing-view")).toBeTruthy());
    expect(container.querySelector(".update-available-banner")).toBeNull();
    expect(container.querySelector(".update-development-note")).toBeNull();
  });

  it("the urgent banner carries the approved backup guidance and is accessible", async () => {
    // Synthetic verified-release fixture: the ONLY way to reach this UI.
    mockApp({
      enabled: true, isOutdated: true, error: null,
      currentSha: RUNNING_SHA, latestSha: BRANCH_SHA,
      updateStatus: UPDATE_STATUS.PUBLISHED_SUPPORTED_UPDATE,
      releaseIdentity: { verified: true, isNewer: true, version: "2.2.0", tag: "v2.2.0" },
      branch: "main", repo: "owner/repo", checkedAt: "2026-10-16T12:00:00Z"
    });
    const { container } = render(<App />);
    const view = within(container);

    const banner = await waitFor(() => {
      const el = container.querySelector(".update-available-banner");
      expect(el).toBeTruthy();
      return el;
    });

    const text = banner.textContent;
    // Approved contract wording.
    expect(text).toMatch(/update recommended as soon as practical/i);
    expect(text).toMatch(/Tools\s*→\s*Export Run/);
    expect(text).toMatch(/Tools\s*→\s*Import Run/);
    expect(text).toMatch(/credential/i);
    expect(text).toMatch(/re-enter/i);
    // Must distinguish the run JSON from the generated bundle ZIP.
    expect(text).toMatch(/ZIP/i);

    // Must NOT overpromise.
    expect(text).not.toMatch(/all your (data|jobs|work) (is|are) preserved/i);

    // Accessibility: announced, and the guide link is reachable by role+name.
    expect(banner.getAttribute("role")).toBe("alert");
    const link = view.getByRole("link", { name: /update guide/i });
    expect(link.getAttribute("href")).toMatch(/UPDATING\.md/);
    expect(link.getAttribute("rel")).toMatch(/noopener/);
  });
});
