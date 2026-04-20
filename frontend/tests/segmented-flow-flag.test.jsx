import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, render, screen, waitFor, fireEvent } from "@testing-library/react";
import App from "../src/App.jsx";
import { apiFetch } from "../src/api.js";
import { stateWithBlueprintCompleteMethodologyIncomplete } from "./fixtures/minimalState.js";

vi.mock("../src/api.js", () => ({ apiFetch: vi.fn() }));

function stateWithSegmentedFlow(segmentedFlowV1) {
  const base = stateWithBlueprintCompleteMethodologyIncomplete();
  return {
    ...base,
    ui: { ...base.ui, segmentedFlowV1 }
  };
}

describe("Segmented flow stabilization", () => {
  beforeEach(() => {
    vi.mocked(apiFetch).mockImplementation((path, opts) => {
      if (path === "/api/state") {
        const body = opts?.body ? JSON.parse(opts.body) : stateWithBlueprintCompleteMethodologyIncomplete();
        return Promise.resolve(body);
      }
      return Promise.resolve({});
    });
  });
  afterEach(() => {
    cleanup();
  });

  it("when flag OFF from persisted state, legacy wizard (Global Strategy) follows Methodology", async () => {
    vi.mocked(apiFetch).mockImplementation((path, opts) => {
      if (path === "/api/state") {
        return Promise.resolve(opts?.body ? JSON.parse(opts.body) : stateWithSegmentedFlow(false));
      }
      return Promise.resolve({});
    });
    render(<App />);
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Continue install/i })).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole("button", { name: /Continue install/i }));
    await waitFor(() => {
      expect(screen.getByRole("heading", { name: /Installation Methodology/i })).toBeInTheDocument();
    });
    const proceedButtons = screen.getAllByRole("button", { name: /Proceed/i });
    fireEvent.click(proceedButtons[proceedButtons.length - 1]);
    await waitFor(() => {
      expect(screen.getByRole("heading", { name: /Global Strategy/i })).toBeInTheDocument();
    });
    expect(screen.getByRole("heading", { name: /Cluster Identity/i })).toBeInTheDocument();
  });

  it("when flag ON shows six replacement steps and scenario header", async () => {
    vi.mocked(apiFetch).mockImplementation((path, opts) => {
      if (path === "/api/state") {
        return Promise.resolve(opts?.body ? JSON.parse(opts.body) : stateWithSegmentedFlow(true));
      }
      return Promise.resolve({});
    });
    render(<App />);
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Continue install/i })).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole("button", { name: /Continue install/i }));
    await waitFor(() => {
      expect(screen.getByRole("heading", { name: /Installation Methodology/i })).toBeInTheDocument();
    });
    const proceedButtons = screen.getAllByRole("button", { name: /Proceed/i });
    fireEvent.click(proceedButtons[proceedButtons.length - 1]);
    await waitFor(() => {
      expect(screen.getAllByText(/Identity & Access/i).length).toBeGreaterThanOrEqual(1);
    });
    expect(screen.getAllByText(/Networking/i).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/Connectivity & Mirroring/i).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/Trust & Proxy/i).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/Platform Specifics/i).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/Hosts \/ Inventory/i).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByRole("region", { name: /Scenario summary/i })).toBeInTheDocument();
  });

  it("default flow (segmentedFlowV1 true): path through replacement steps to generate/download is available", async () => {
    vi.mocked(apiFetch).mockImplementation((path, opts) => {
      if (path === "/api/state") {
        return Promise.resolve(opts?.body ? JSON.parse(opts.body) : stateWithSegmentedFlow(true));
      }
      return Promise.resolve({});
    });
    render(<App />);
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Continue install/i })).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole("button", { name: /Continue install/i }));
    await waitFor(() => {
      expect(screen.getByRole("heading", { name: /Installation Methodology/i })).toBeInTheDocument();
    });
    const proceedButtons = screen.getAllByRole("button", { name: /Proceed/i });
    fireEvent.click(proceedButtons[proceedButtons.length - 1]);
    await waitFor(() => {
      expect(screen.getAllByRole("heading", { name: /Identity & Access/i }).length).toBeGreaterThanOrEqual(1);
    });
    expect(screen.getAllByRole("button", { name: /Assets & Guide/i }).length).toBeGreaterThanOrEqual(1);
  });

  it("legacy persisted activeStepId global resumes into legacy flow after Methodology", async () => {
    vi.mocked(apiFetch).mockImplementation((path, opts) => {
      if (path === "/api/state") {
        const legacy = stateWithSegmentedFlow(false);
        legacy.ui.activeStepId = "global";
        return Promise.resolve(opts?.body ? JSON.parse(opts.body) : legacy);
      }
      return Promise.resolve({});
    });
    render(<App />);
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Continue install/i })).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole("button", { name: /Continue install/i }));
    await waitFor(() => {
      expect(screen.getByRole("heading", { name: /Installation Methodology/i })).toBeInTheDocument();
    });
    const proceedButtons = screen.getAllByRole("button", { name: /Proceed/i });
    fireEvent.click(proceedButtons[proceedButtons.length - 1]);
    await waitFor(() => {
      expect(screen.getByRole("heading", { name: /Global Strategy/i })).toBeInTheDocument();
    });
  });
});

