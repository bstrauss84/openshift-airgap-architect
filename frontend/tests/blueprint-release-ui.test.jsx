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

describe("Blueprint step: Release selection moved in", () => {
  beforeEach(() => {
    vi.mocked(apiFetch).mockImplementation((path) => {
      if (path === "/api/state") return Promise.resolve(stateWithBlueprintCompleteMethodologyIncomplete());
      if (path === "/api/cincinnati/channels") return Promise.resolve({ channels: ["4.15", "4.16"] });
      if (path === "/api/cincinnati/patches") return Promise.resolve({ patches: [{ version: "4.15.0" }] });
      return Promise.resolve({});
    });
  });

  it("renders OpenShift release section with Update button", async () => {
    render(<App />);
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Continue install/i })).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole("button", { name: /Continue install/i }));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Blueprint/i })).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole("button", { name: /Blueprint/i }));
    await waitFor(() => {
      expect(screen.getByRole("heading", { name: /OpenShift release/i })).toBeInTheDocument();
    });
    expect(screen.getByRole("button", { name: /Update/i })).toBeInTheDocument();
  });
});
