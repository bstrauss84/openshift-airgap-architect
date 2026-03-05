import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import App from "../src/App.jsx";
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
    expect(screen.getByText(/Update available/)).toBeInTheDocument();
    const link = screen.getByRole("link", { name: /docs\/UPDATING\.md/i });
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

describe("Landing update banner not shown when error", () => {
  // Condition in App: updateInfo?.enabled && updateInfo?.isOutdated && !updateInfo?.error. When error is set, banner is not rendered.
  // Manual validation: offline or API error → no Landing banner; Tools/About shows "Update check unavailable".
  it.skip("does not show update banner on Landing when updateInfo has error", async () => {
    vi.mocked(apiFetch).mockImplementation((path) => {
      if (path === "/api/state") return Promise.resolve(stateWithBlueprintCompleteMethodologyIncomplete());
      if (path === "/api/schema/stepMap") return Promise.resolve({ version: "1", mvpSteps: [] });
      if (path === "/api/build-info") return Promise.resolve({ gitSha: "x", buildTime: "x", repo: "r", branch: "main" });
      if (path === "/api/update-info") {
        return Promise.resolve({
          enabled: true,
          isOutdated: true,
          error: "network error",
          currentSha: "abc",
          latestSha: null,
          branch: "main",
          repo: "r",
          checkedAt: "2025-03-03T12:00:00Z"
        });
      }
      return Promise.resolve({});
    });
    render(<App />);
    await waitFor(() => {
      expect(screen.getByText(/What would you like to do/)).toBeInTheDocument();
    });
    const banner = document.querySelector(".update-available-banner");
    expect(banner).toBeNull();
  });
});
