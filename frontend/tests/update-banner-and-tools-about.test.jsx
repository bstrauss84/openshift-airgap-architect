/**
 * OpenShift Airgap Architect - Test Suite
 *
 * @author Bill Strauss
 *
 * Developed with AI assistance from Claude (Anthropic) and Cursor AI.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, within, cleanup } from "@testing-library/react";
import App, { shouldShowUpdateBanner } from "../src/App.jsx";
import ToolsDrawer from "../src/components/ToolsDrawer.jsx";
import { apiFetch } from "../src/api.js";
import { stateWithBlueprintCompleteMethodologyIncomplete } from "./fixtures/minimalState.js";

vi.mock("../src/api.js", () => ({ apiFetch: vi.fn() }));

describe("ToolsDrawer About section", () => {
  afterEach(() => { cleanup(); });

  const defaultProps = {
    isOpen: true,
    onClose: () => {},
    theme: "light",
    setTheme: () => {},
    onExportRun: () => {},
    onImportClick: () => {},
    onStartOver: () => {},
    logAction: () => {}
  };

  it("shows build info when buildInfo is provided", () => {
    render(
      <ToolsDrawer
        {...defaultProps}
        buildInfo={{ version: "2.1.0", gitSha: "abc1234", buildTime: "2025-03-03T12:00:00Z", branch: "main", repo: "owner/repo" }}
      />
    );
    // Build info is split across multiple <span> elements
    // ToolsDrawer is portaled to document.body, so use screen instead of container
    const buildInfo = document.querySelector('.about-build-info');
    expect(buildInfo).toBeTruthy();
    // v2.1.1: the drawer now names the version explicitly, and labels the commit
    // "Revision" rather than "Build" — the latter read as a build number.
    expect(buildInfo.textContent).toContain('Version 2.1.0');
    expect(buildInfo.textContent).toContain('Revision abc1234');
    expect(buildInfo.textContent).toContain('2025-03-03T12:00:00Z');
    // APP_BRANCH is configuration, not build provenance: not displayed.
    expect(buildInfo.textContent).not.toContain('main');
  });

  it("shows Update checks disabled when updateInfo.enabled is false", () => {
    render(
      <ToolsDrawer
        {...defaultProps}
        updateInfo={{ enabled: false }}
      />
    );
    expect(screen.getByText(/Update checks disabled/)).toBeInTheDocument();
  });

  // v2.1.1 contract: installed package version vs newest published GitHub
  // Release. The Git SHA is provenance only and deliberately "unknown" here.
  it("shows Update available with both versions for a newer published release", () => {
    render(
      <ToolsDrawer
        {...defaultProps}
        updateInfo={{
          enabled: true,
          isOutdated: true,
          error: null,
          installedVersion: "2.1.0",
          currentSha: "unknown",
          latestSha: null,
          updateStatus: "published-supported-update",
          releaseIdentity: {
            verified: true,
            source: "github-releases-api",
            repo: "bstrauss84/openshift-airgap-architect",
            latest: { version: "2.2.0", tag: "v2.2.0", url: "https://github.com/bstrauss84/openshift-airgap-architect/releases/tag/v2.2.0", publishedAt: "2026-11-01T00:00:00Z" }
          },
          checkedAt: "2025-03-03T12:00:00Z",
          repo: "bstrauss84/openshift-airgap-architect"
        }}
      />
    );
    const link = screen.getByRole("link", { name: /Update available/i });
    expect(link).toBeInTheDocument();
    expect(link.textContent).toContain("2.2.0");
    expect(link.textContent).toContain("installed 2.1.0");
    expect(link.href).toContain("github.com");
    expect(link.href).toContain("UPDATING.md");
  });

  it("shows no update link when only a legacy branch-commit difference is reported", () => {
    render(
      <ToolsDrawer
        {...defaultProps}
        updateInfo={{
          enabled: true,
          isOutdated: true,
          error: null,
          currentSha: "abc1234",
          latestSha: "def5678",
          branch: "main",
          checkedAt: "2025-03-03T12:00:00Z"
        }}
      />
    );
    expect(screen.queryByRole("link", { name: /Update available/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/Up to date/)).not.toBeInTheDocument();
  });

  it("reads an unrecognised status as unavailable, never as up to date", () => {
    render(<ToolsDrawer {...defaultProps} updateInfo={{ enabled: true, updateStatus: "development-branch-ahead" }} />);
    expect(screen.getByText(/Update status unavailable/)).toBeInTheDocument();
    expect(screen.queryByText(/Up to date/)).not.toBeInTheDocument();
  });

  it("shows Update check unavailable when updateInfo has error", () => {
    render(
      <ToolsDrawer
        {...defaultProps}
        updateInfo={{
          enabled: true,
          isOutdated: false,
          error: "network error",
          installedVersion: "2.1.0",
          currentSha: "abc1234",
          checkedAt: "2025-03-03T12:00:00Z"
        }}
      />
    );
    expect(screen.getByText(/Update check unavailable/)).toBeInTheDocument();
  });

  it("shows Up to date when the newest published release is the installed one", () => {
    render(
      <ToolsDrawer
        {...defaultProps}
        updateInfo={{
          enabled: true,
          isOutdated: false,
          error: null,
          installedVersion: "2.1.0",
          currentSha: "unknown",
          updateStatus: "up-to-date",
          releaseIdentity: { verified: true, latest: { version: "2.1.0", tag: "v2.1.0" } },
          checkedAt: "2025-03-03T12:00:00Z"
        }}
      />
    );
    expect(screen.getByText(/Up to date: no published release is newer than 2\.1\.0/)).toBeInTheDocument();
  });

  it("passes 2.0.0-dev through View Details to About modal", async () => {
    const { default: userEvent } = await import("@testing-library/user-event");
    const user = userEvent.setup();
    render(
      <ToolsDrawer
        {...defaultProps}
        buildInfo={{ version: "2.0.0-dev", gitSha: "abc1234", buildTime: "2026-08-18T12:00:00Z", branch: "main", repo: "owner/repo" }}
      />
    );
    await user.click(screen.getByRole("button", { name: /View Details/i }));
    const modal = document.querySelector(".about-modal");
    expect(modal.textContent).toContain("2.0.0-dev");
  });

  it("About modal shows explicit fallback when buildInfo has no version", async () => {
    const { default: userEvent } = await import("@testing-library/user-event");
    const user = userEvent.setup();
    render(
      <ToolsDrawer
        {...defaultProps}
        buildInfo={{ gitSha: "abc1234", buildTime: "2026-08-18T12:00:00Z", branch: "main", repo: "owner/repo" }}
      />
    );
    await user.click(screen.getByRole("button", { name: /View Details/i }));
    const modal = document.querySelector(".about-modal");
    expect(modal.textContent).toContain("Version unavailable");
  });
});

describe("Landing update banner", () => {
  afterEach(() => { cleanup(); });

  beforeEach(() => {
    vi.mocked(apiFetch).mockImplementation((path) => {
      if (path === "/api/state") return Promise.resolve(stateWithBlueprintCompleteMethodologyIncomplete());
      if (path === "/api/schema/stepMap") return Promise.resolve({ version: "1", mvpSteps: [] });
      if (path === "/api/build-info") return Promise.resolve({ gitSha: "abc1234", buildTime: "2025-03-03", repo: "owner/repo", branch: "main" });
      if (path === "/api/feedback/config") {
        return Promise.resolve({
          visible: true,
          enabled: true,
          mode: "offline",
          reason: "",
          challengeRequired: true,
          minDwellMs: 0,
          limits: { summaryMaxChars: 200, detailsMaxChars: 4000, contactMaxChars: 200, maxPayloadBytes: 32768 },
          enums: { categories: ["bug", "docs", "ux", "request", "security", "other"], severities: ["low", "medium", "high", "critical"] }
        });
      }
      if (path === "/api/update-info") {
        // A newer published release is the only thing that raises the urgent
        // banner. See tests/update-banner-truthful-states.test.jsx.
        return Promise.resolve({
          enabled: true,
          isOutdated: true,
          error: null,
          installedVersion: "2.1.0",
          currentSha: "unknown",
          latestSha: null,
          updateStatus: "published-supported-update",
          releaseIdentity: { verified: true, latest: { version: "2.2.0", tag: "v2.2.0", url: "https://github.com/owner/repo/releases/tag/v2.2.0" } },
          branch: "main",
          repo: "owner/repo",
          checkedAt: "2025-03-03T12:00:00Z"
        });
      }
      return Promise.resolve({});
    });
  });

  it("shows update banner on Landing for a verified published release", async () => {
    const { container } = render(<App />);
    const view = within(container);
    await waitFor(() => {
      expect(view.getByText(/Update available/)).toBeInTheDocument();
    });
    // The banner now carries the approved backup guidance rather than deferring
    // to Tools -> About, which never had update steps in it.
    expect(view.getByText(/Tools → Export Run/)).toBeInTheDocument();
  });

  it("renders Feedback button to the right of Tools in wizard header", async () => {
    render(<App />);
    const startButton = await screen.findByRole("button", { name: /continue install|start new install/i });
    startButton.click();
    const tools = await screen.findByRole("button", { name: /open tools/i });
    const feedback = await screen.findByRole("button", { name: /open feedback/i });
    const toolsPos = tools.getBoundingClientRect().left;
    const feedbackPos = feedback.getBoundingClientRect().left;
    expect(feedbackPos).toBeGreaterThanOrEqual(toolsPos);
  });
});

describe("App-level version identity regression", () => {
  afterEach(() => { cleanup(); document.body.innerHTML = ""; });

  beforeEach(() => {
    vi.mocked(apiFetch).mockImplementation((path) => {
      if (path === "/api/state") return Promise.resolve(stateWithBlueprintCompleteMethodologyIncomplete());
      if (path === "/api/schema/stepMap") return Promise.resolve({ version: "1", mvpSteps: [] });
      if (path === "/api/build-info") return Promise.resolve({ version: "2.0.0-dev", gitSha: "abc1234", buildTime: "2026-08-18T12:00:00Z", repo: "owner/repo", branch: "main" });
      if (path === "/api/feedback/config") {
        return Promise.resolve({
          visible: true,
          enabled: true,
          mode: "offline",
          reason: "",
          challengeRequired: true,
          minDwellMs: 0,
          limits: { summaryMaxChars: 200, detailsMaxChars: 4000, contactMaxChars: 200, maxPayloadBytes: 32768 },
          enums: { categories: ["bug", "docs", "ux", "request", "security", "other"], severities: ["low", "medium", "high", "critical"] }
        });
      }
      if (path === "/api/update-info") {
        return Promise.resolve({ enabled: false });
      }
      return Promise.resolve({});
    });
  });

  it("fetches /api/build-info and displays 2.0.0-dev in Tools → About → View Details", async () => {
    const { default: userEvent } = await import("@testing-library/user-event");
    const user = userEvent.setup();

    render(<App />);

    const startButton = await screen.findByRole("button", { name: /continue install|start new install/i });
    await user.click(startButton);

    expect(vi.mocked(apiFetch)).toHaveBeenCalledWith("/api/build-info");

    const toolsButton = await screen.findByRole("button", { name: /open tools/i });
    await user.click(toolsButton);

    const viewDetails = await screen.findByRole("button", { name: /View Details/i });
    await user.click(viewDetails);

    await waitFor(() => {
      const modal = document.querySelector(".about-modal");
      expect(modal).toBeTruthy();
      expect(modal.textContent).toContain("2.0.0-dev");
    });
  });
});

describe("Landing update banner visibility (shouldShowUpdateBanner)", () => {
  it("returns false when updateInfo has error", () => {
    expect(
      shouldShowUpdateBanner({
        enabled: true,
        isOutdated: true,
        error: "network error",
        currentSha: "abc",
        latestSha: "def",
        branch: "main",
        repo: "r"
      })
    ).toBe(false);
  });

  it("returns false when currentSha or latestSha is unknown", () => {
    expect(shouldShowUpdateBanner({ enabled: true, isOutdated: true, error: null, currentSha: "unknown", latestSha: "def", branch: "main", repo: "r" })).toBe(false);
    expect(shouldShowUpdateBanner({ enabled: true, isOutdated: true, error: null, currentSha: "abc", latestSha: "unknown", branch: "main", repo: "r" })).toBe(false);
  });

  it("returns FALSE for a bare SHA difference, which is not a published release", () => {
    // This assertion is inverted on purpose. It previously expected `true`,
    // encoding the v1.7.1 defect: `isOutdated` only meant the branch head
    // differed, which can point users backwards. Urgency now requires a newer
    // published release — see tests/update-banner-truthful-states.test.jsx.
    expect(
      shouldShowUpdateBanner({
        enabled: true,
        isOutdated: true,
        error: null,
        currentSha: "abc1234",
        latestSha: "def5678",
        branch: "main",
        repo: "r"
      })
    ).toBe(false);
  });

  it("returns false when not enabled or not outdated", () => {
    expect(shouldShowUpdateBanner({ enabled: false, isOutdated: true, error: null, currentSha: "abc", latestSha: "def", branch: "main", repo: "r" })).toBe(false);
    expect(shouldShowUpdateBanner({ enabled: true, isOutdated: false, error: null, currentSha: "abc", latestSha: "def", branch: "main", repo: "r" })).toBe(false);
  });
});
