/**
 * OpenShift Airgap Architect - Test Suite
 *
 * @author Bill Strauss
 *
 * Developed with AI assistance from Claude (Anthropic) and Cursor AI.
 */

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import LandingPage from "./LandingPage.jsx";

describe("LandingPage smoke", () => {
  it("renders landing heading and Install card", () => {
    render(<LandingPage hasProgress={false} onStartInstall={() => {}} />);
    expect(screen.getByText(/What would you like to do\?/)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /Install/i })).toBeInTheDocument();
  });
});
