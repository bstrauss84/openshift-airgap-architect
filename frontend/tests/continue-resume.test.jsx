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

describe("Continue Install resumes at first incomplete step", () => {
  beforeEach(() => {
    vi.mocked(apiFetch).mockImplementation((path, opts) => {
      if (path === "/api/state") {
        return Promise.resolve(opts?.body ? JSON.parse(opts.body) : stateWithBlueprintCompleteMethodologyIncomplete());
      }
      return Promise.resolve({});
    });
  });

  it("lands on Methodology when only Blueprint is complete", async () => {
    render(<App />);
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Continue install/i })).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole("button", { name: /Continue install/i }));
    await waitFor(() => {
      expect(screen.getByRole("heading", { name: /Installation Methodology/i })).toBeInTheDocument();
    });
  });
});
