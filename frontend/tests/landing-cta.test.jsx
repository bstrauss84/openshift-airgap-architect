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
    expect(screen.getByRole("button", { name: /Start (new )?install/i })).toBeInTheDocument();
  });

  it("shows Continue install when hasProgress is true", () => {
    render(<LandingPage hasProgress={true} onStartInstall={() => {}} />);
    expect(screen.getByRole("button", { name: /Continue install/i })).toBeInTheDocument();
  });
});

describe("Install card footer actions (v2.3.0 correction pass)", () => {
  it("with progress: Continue install and New Install are two separate buttons in the card's own footer bar", async () => {
    const { fireEvent } = await import("@testing-library/react");
    const onStartInstall = (await import("vitest")).vi.fn();
    const onStartNewInstall = (await import("vitest")).vi.fn();
    render(<LandingPage hasProgress={true} onStartInstall={onStartInstall} onStartNewInstall={onStartNewInstall} />);
    const cont = screen.getByRole("button", { name: "Continue install →" });
    const fresh = screen.getByRole("button", { name: "New Install" });
    expect(cont.parentElement).toBe(fresh.parentElement);
    expect(cont.parentElement.classList.contains("landing-card-footer-rail")).toBe(true);
    expect(cont.closest(".landing-card-install")).not.toBeNull();
    expect(cont.closest("button")).toBe(cont); // no button nested in a button
    fireEvent.click(cont);
    expect(onStartInstall).toHaveBeenCalledTimes(1);
    expect(onStartNewInstall).not.toHaveBeenCalled();
    fireEvent.click(fresh);
    expect(onStartNewInstall).toHaveBeenCalledTimes(1);
  });

  it("without progress: one Start install action and no New Install", () => {
    render(<LandingPage hasProgress={false} onStartInstall={() => {}} onStartNewInstall={() => {}} />);
    expect(screen.getByRole("button", { name: "Start install →" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "New Install" })).toBeNull();
  });
});
