/**
 * OpenShift Airgap Architect - Test Suite
 *
 * @author Bill Strauss
 *
 * Developed with AI assistance from Claude (Anthropic) and Cursor AI.
 */

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import LandingPage from "../src/LandingPage.jsx";

describe("Landing CTA (Continue vs Start new install)", () => {
  it("shows Start new install when hasProgress is false", () => {
    render(<LandingPage hasProgress={false} onStartInstall={() => {}} />);
    expect(screen.getByRole("button", { name: /Start new install/i })).toBeInTheDocument();
  });

  it("shows Continue install when hasProgress is true", () => {
    render(<LandingPage hasProgress={true} onStartInstall={() => {}} />);
    expect(screen.getByRole("button", { name: /Continue install/i })).toBeInTheDocument();
  });
});
