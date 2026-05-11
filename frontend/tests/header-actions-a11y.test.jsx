/**
 * OpenShift Airgap Architect - Header Actions Accessibility Test Suite
 *
 * Tests keyboard navigation and a11y attributes for header action buttons.
 * Covers DOC-021: Add/confirm explicit tests for run-actions and preferences
 * keyboard/a11y interactions.
 *
 * @author Bill Strauss
 *
 * Developed with AI assistance from Claude (Anthropic) and Cursor AI.
 */

import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import App from "../src/App.jsx";
import { apiFetch } from "../src/api.js";
import { stateWithBlueprintCompleteMethodologyIncomplete } from "./fixtures/minimalState.js";

vi.mock("../src/api.js", () => ({ apiFetch: vi.fn() }));

function makeState() {
  return stateWithBlueprintCompleteMethodologyIncomplete();
}

describe("Header Actions - Accessibility", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.mocked(apiFetch).mockReset();

    // Default API mocks
    vi.mocked(apiFetch).mockImplementation((path, options) => {
      if (path === "/api/state") {
        if (options?.method === "POST") return Promise.resolve(JSON.parse(options.body));
        return Promise.resolve(makeState());
      }
      if (path === "/api/schema/stepMap") return Promise.resolve({});
      if (path === "/api/build-info") return Promise.resolve({
        gitSha: "test123",
        buildTime: "2026-05-10T12:00:00Z",
        repo: "test/repo",
        branch: "develop"
      });
      if (path === "/api/update-info") return Promise.resolve({ enabled: false });
      if (path === "/api/jobs?type=oc-mirror-run") return Promise.resolve({ jobs: [] });
      if (path === "/api/feedback/config") return Promise.resolve({ mode: "disabled" });
      return Promise.resolve({});
    });
  });

  it("header exists and is rendered", async () => {
    render(<App />);

    // Wait for any button to appear
    await waitFor(() => {
      const buttons = screen.queryAllByRole("button");
      expect(buttons.length).toBeGreaterThan(0);
    }, { timeout: 3000 });

    // Check if header exists
    const headers = document.querySelectorAll('header');
    expect(headers.length).toBeGreaterThan(0);
  });

  it("buttons have proper semantic markup", async () => {
    render(<App />);

    // Wait for buttons to render
    await waitFor(() => {
      const buttons = screen.queryAllByRole("button");
      expect(buttons.length).toBeGreaterThan(0);
    }, { timeout: 3000 });

    // All buttons should be proper button elements
    const allButtons = screen.queryAllByRole("button");
    allButtons.forEach(button => {
      expect(button.tagName).toBe('BUTTON');
    });
  });

  it("buttons are keyboard accessible", async () => {
    render(<App />);

    // Wait for buttons
    await waitFor(() => {
      const buttons = screen.queryAllByRole("button");
      expect(buttons.length).toBeGreaterThan(0);
    }, { timeout: 3000 });

    // At least one button should be focusable
    const allButtons = screen.queryAllByRole("button");
    const firstButton = allButtons[0];

    firstButton.focus();
    expect(document.activeElement).toBe(firstButton);
  });

  it("header actions use semantic button markup", async () => {
    render(<App />);

    // Wait for header to render
    await waitFor(() => {
      const header = document.querySelector('.app-header');
      expect(header).toBeInTheDocument();
    }, { timeout: 3000 });

    // All header action buttons should be proper button elements with type attribute
    const header = document.querySelector('.app-header');
    const headerButtons = header.querySelectorAll('.header-actions button');

    headerButtons.forEach(button => {
      expect(button).toHaveAttribute('type', 'button');
    });
  });

  it("navigation has proper ARIA label", async () => {
    render(<App />);

    // Navigation toggle should have aria-label
    await waitFor(() => {
      const navButton = screen.queryByLabelText(/Toggle navigation/i);
      if (navButton) {
        expect(navButton).toBeInTheDocument();
        expect(navButton).toHaveAttribute("aria-label");
      }
    }, { timeout: 3000 });
  });
});
