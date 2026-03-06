import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import App, { shouldShowUpdateBanner } from "../src/App.jsx";
import ToolsDrawer from "../src/components/ToolsDrawer.jsx";
import { apiFetch } from "../src/api.js";
import { stateWithBlueprintCompleteMethodologyIncomplete } from "./fixtures/minimalState.js";

vi.mock("../src/api.js", () => ({ apiFetch: vi.fn() }));

describe("ToolsDrawer About section", () => {
  const defaultProps = {
    isOpen: true,
    onClose: () => {},
    theme: "light",
    setTheme: () => {},
    onExportRun: () => {},
    onImportClick: () => {},
    onStartOver: () => {},
    jobsCount: 0,
    onNavigateToOperations: () => {},
    isLocked: false,
    logAction: () => {}
  };

  it("shows build info when buildInfo is provided", () => {
    render(
      <ToolsDrawer
        {...defaultProps}
        buildInfo={{ gitSha: "abc1234", buildTime: "2025-03-03T12:00:00Z", branch: "main", repo: "owner/repo" }}
      />
    );
    expect(screen.getByText(/Build abc1234 • 2025-03-03T12:00:00Z • main/)).toBeInTheDocument();
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

  it("shows Update available and link when updateInfo is enabled and outdated", () => {
    render(
      <ToolsDrawer
        {...defaultProps}
        updateInfo={{
          enabled: true,
          isOutdated: true,
          error: null,
          checkedAt: "2025-03-03T12:00:00Z",
          repo: "bstrauss84/openshift-airgap-architect"
        }}
      />
    );
    const link = screen.getByRole("link", { name: /Update available/i });
    expect(link).toBeInTheDocument();
    expect(link.href).toContain("github.com");
    expect(link.href).toContain("UPDATING.md");
  });

  it("shows Update check unavailable when updateInfo has error", () => {
    render(
      <ToolsDrawer
        {...defaultProps}
        updateInfo={{
          enabled: true,
          isOutdated: false,
          error: "network error",
          checkedAt: "2025-03-03T12:00:00Z"
        }}
      />
    );
    expect(screen.getByText(/Update check unavailable/)).toBeInTheDocument();
  });

  it("shows Up to date when updateInfo is enabled and not outdated", () => {
    render(
      <ToolsDrawer
        {...defaultProps}
        updateInfo={{
          enabled: true,
          isOutdated: false,
          error: null,
          checkedAt: "2025-03-03T12:00:00Z"
        }}
      />
    );
    expect(screen.getByText(/Up to date/)).toBeInTheDocument();
  });
});

describe("Landing update banner", () => {
  beforeEach(() => {
    vi.mocked(apiFetch).mockImplementation((path) => {
      if (path === "/api/state") return Promise.resolve(stateWithBlueprintCompleteMethodologyIncomplete());
      if (path === "/api/schema/stepMap") return Promise.resolve({ version: "1", mvpSteps: [] });
      if (path === "/api/build-info") return Promise.resolve({ gitSha: "abc1234", buildTime: "2025-03-03", repo: "owner/repo", branch: "main" });
      if (path === "/api/update-info") {
        return Promise.resolve({
          enabled: true,
          isOutdated: true,
          error: null,
          currentSha: "abc1234",
          latestSha: "def5678",
          branch: "main",
          repo: "owner/repo",
          checkedAt: "2025-03-03T12:00:00Z"
        });
      }
      return Promise.resolve({});
    });
  });

  it("shows update banner on Landing when enabled, outdated, and no error", async () => {
    render(<App />);
    await waitFor(() => {
      expect(screen.getByText(/Update available/)).toBeInTheDocument();
    });
    expect(screen.getByText(/See Tools → About for update steps/)).toBeInTheDocument();
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

  it("returns true when enabled, outdated, no error, and SHAs are known", () => {
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
    ).toBe(true);
  });

  it("returns false when not enabled or not outdated", () => {
    expect(shouldShowUpdateBanner({ enabled: false, isOutdated: true, error: null, currentSha: "abc", latestSha: "def", branch: "main", repo: "r" })).toBe(false);
    expect(shouldShowUpdateBanner({ enabled: true, isOutdated: false, error: null, currentSha: "abc", latestSha: "def", branch: "main", repo: "r" })).toBe(false);
  });
});
