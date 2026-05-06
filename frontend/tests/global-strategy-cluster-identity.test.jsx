/**
 * OpenShift Airgap Architect - Test Suite
 *
 * @author Bill Strauss
 *
 * Developed with AI assistance from Claude (Anthropic) and Cursor AI.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import App from "../src/App.jsx";
import { apiFetch } from "../src/api.js";
import { stateWithBlueprintCompleteMethodologyIncomplete } from "./fixtures/minimalState.js";

vi.mock("../src/api.js", () => ({ apiFetch: vi.fn() }));

describe("Global Strategy: Cluster Identity at top", () => {
  beforeEach(() => {
    vi.mocked(apiFetch).mockImplementation((path) => {
      if (path === "/api/state") return Promise.resolve(stateWithBlueprintCompleteMethodologyIncomplete());
      return Promise.resolve({});
    });
  });

  it("renders Cluster Identity section", async () => {
    render(<App />);
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Continue install/i })).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole("button", { name: /Continue install/i }));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Global Strategy/i })).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole("button", { name: /Global Strategy/i }));
    await waitFor(() => {
      expect(screen.getByRole("heading", { name: /Cluster Identity/i })).toBeInTheDocument();
    });
    expect(screen.getByText(/Cluster name and base domain/i)).toBeInTheDocument();
  });
});
