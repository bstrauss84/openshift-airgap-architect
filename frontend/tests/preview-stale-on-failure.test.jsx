/**
 * OpenShift Airgap Architect - Test Suite
 *
 * @author Bill Strauss
 *
 * Developed with AI assistance from Claude (Anthropic) and Cursor AI.
 */

/**
 * DOC-160 — generated preview must never present a stale document as current.
 *
 * Found while root-causing DOC-159. `setPreviewFiles` only ran on success, so
 * when generation failed for the CURRENT state the previously generated files
 * stayed rendered and read as though they described it. The agent-based split
 * view made it worse: unlike `renderSingleConfig` it had no error or loading
 * gate at all, so it kept painting the old install-config/agent-config, and its
 * per-pane Download handed that stale YAML to the user as current output.
 *
 * Contract now: a failed generation for the current state invalidates the
 * generated files and surfaces the error; user-entered state is untouched; the
 * next success repopulates normally.
 *
 * REFINED IN TRANCHE 7C.4. Blanking the document closed the hazard but created
 * a new one: a single validation sentence replaced the whole YAML document, so
 * entering a bad gateway turned the YAML preview into an error-review panel.
 * The human rejected that — it is a YAML preview drawer, not a validation
 * drawer.
 *
 * DOC-160's actual hazard was a stale document PASSING AS CURRENT, on screen
 * and through Download. Both halves are still closed, by labelling instead of
 * deletion:
 *   - the document stays on screen, with a banner stating plainly that it is
 *     the last generation that succeeded and does not reflect current entry;
 *   - Download stays disabled for every pane while generation is failing, so
 *     stale YAML still cannot leave the app as current output.
 * The tests below were updated to the refined contract. Every safety property
 * DOC-160 established is still asserted; only "the document must disappear"
 * changed, and it changed to "the document must be labelled".
 *
 * Normal field-level validation is a different thing and is deliberately NOT
 * routed through this path — see the incomplete-configuration test below.
 */
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, within, cleanup, fireEvent } from "@testing-library/react";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import YamlDrawer from "../src/components/YamlDrawer.jsx";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appJsx = fs.readFileSync(path.join(__dirname, "../src/App.jsx"), "utf8");

const AGENT_A = "apiVersion: v1beta1\nkind: AgentConfig\nmetadata:\n  name: cluster-A\n";
const INSTALL_A = "apiVersion: v1\nbaseDomain: example.com\nmetadata:\n  name: cluster-A\n";
const AGENT_B = "apiVersion: v1beta1\nkind: AgentConfig\nmetadata:\n  name: cluster-B\n";
const INSTALL_B = "apiVersion: v1\nbaseDomain: example.com\nmetadata:\n  name: cluster-B\n";

const filesA = { "install-config.yaml": INSTALL_A, "agent-config.yaml": AGENT_A };
const filesB = { "install-config.yaml": INSTALL_B, "agent-config.yaml": AGENT_B };

/** Agent-based scenario renders the split view — the path that had no gate. */
function renderDrawer(props = {}) {
  return render(
    <YamlDrawer
      isOpen
      onClose={() => {}}
      previewFiles={filesA}
      activeStepId="review"
      scenario={{ isAgentBased: true, method: "Agent-Based Installer", platform: "Bare Metal" }}
      loading={false}
      error=""
      {...props}
    />
  );
}

const shownText = () => document.body.textContent;

beforeEach(() => {
  localStorage.clear();
});
afterEach(() => {
  cleanup();
});

describe("DOC-160: a failed generation must not leave stale YAML on screen", () => {
  it("renders the generated document when generation succeeded", () => {
    renderDrawer();
    expect(shownText()).toContain("cluster-A");
  });

  it("keeps the previous document on screen rather than blanking the preview", () => {
    // 7C.4: the drawer must not become an error panel. The YAML stays.
    renderDrawer({ error: "NMState interface name must not be empty.", stale: true });
    expect(shownText()).toContain("cluster-A");
    expect(document.querySelector("pre.yaml-preview")).toBeTruthy();
  });

  it("surfaces the generation error alongside the document", () => {
    renderDrawer({ error: "NMState interface name must not be empty.", stale: true });
    expect(screen.getByText(/NMState interface name must not be empty/)).toBeInTheDocument();
  });

  it("says plainly that the document shown is the last successful generation", () => {
    // The replacement for DOC-160's "no longer shown". Stale YAML must never
    // be able to read as though it describes the current, invalid input.
    renderDrawer({ error: "generation failed", stale: true });
    expect(shownText()).toMatch(/last configuration that generated successfully/i);
    expect(shownText()).toMatch(/does not reflect your current entry/i);
  });

  it("marks the retained document as superseded for assistive tech and tests", () => {
    renderDrawer({ error: "generation failed", stale: true });
    expect(document.querySelector('[data-preview-superseded="true"]')).toBeTruthy();
  });

  it("disables every Download while generation is failing", () => {
    // The real DOC-160 hazard: stale YAML leaving the app as current output.
    // The panes render again now, so each Download must be individually gated.
    renderDrawer({ error: "generation failed", stale: true });
    const downloads = screen.getAllByRole("button", { name: /^Download$/i });
    expect(downloads.length).toBeGreaterThan(0);
    for (const button of downloads) expect(button).toBeDisabled();
  });

  it("disables Download in the single-config view during a failure", () => {
    // That view does render an error, but its Download was still bound to the
    // stale content and enabled — stale output one click away.
    render(
      <YamlDrawer
        isOpen
        onClose={() => {}}
        previewFiles={{ "install-config.yaml": INSTALL_A }}
        activeStepId="global"
        scenario={{ method: "IPI", platform: "AWS" }}
        loading={false}
        error="generation failed"
      />
    );
    expect(screen.getByRole("button", { name: /^Download$/i })).toBeDisabled();
  });

  it("offers Download again once generation succeeds", () => {
    renderDrawer();
    expect(screen.getAllByRole("button", { name: /^Download$/i }).length).toBeGreaterThan(0);
  });

  it("shows the repaired document, not the previous one, after recovery", () => {
    const { rerender } = renderDrawer();
    expect(shownText()).toContain("cluster-A");

    /* App keeps the last successful files now, so the realistic failure state
       is "filesA still present, flagged stale" — not an empty set. */
    rerender(
      <YamlDrawer
        isOpen
        onClose={() => {}}
        previewFiles={filesA}
        activeStepId="review"
        scenario={{ isAgentBased: true, method: "Agent-Based Installer", platform: "Bare Metal" }}
        loading={false}
        error="generation failed"
        stale
      />
    );
    expect(shownText()).toMatch(/last configuration that generated successfully/i);

    rerender(
      <YamlDrawer
        isOpen
        onClose={() => {}}
        previewFiles={filesB}
        activeStepId="review"
        scenario={{ isAgentBased: true, method: "Agent-Based Installer", platform: "Bare Metal" }}
        loading={false}
        error=""
      />
    );
    expect(shownText()).toContain("cluster-B");
    expect(shownText()).not.toContain("cluster-A");
  });

  it("applies the same guarantee to a transport failure", () => {
    renderDrawer({ error: "Failed to fetch", stale: true });
    expect(screen.getByText(/Failed to fetch/)).toBeInTheDocument();
    expect(shownText()).toMatch(/last configuration that generated successfully/i);
    for (const button of screen.getAllByRole("button", { name: /^Download$/i })) {
      expect(button).toBeDisabled();
    }
  });

  it("gates the single-config view the same way", () => {
    render(
      <YamlDrawer
        isOpen
        onClose={() => {}}
        previewFiles={{ "install-config.yaml": INSTALL_A }}
        activeStepId="global"
        scenario={{ method: "IPI", platform: "AWS" }}
        loading={false}
        error="generation failed"
        stale
      />
    );
    expect(shownText()).toContain("cluster-A");
    expect(screen.getByText(/generation failed/)).toBeInTheDocument();
    expect(shownText()).toMatch(/last configuration that generated successfully/i);
    expect(screen.getByRole("button", { name: /^Download$/i })).toBeDisabled();
  });

  it("treats an incomplete configuration as its own UX, not a transport failure", () => {
    // showIncompleteWarning is the normal validation affordance and must not
    // blank the preview: a partially generatable document still renders.
    renderDrawer({ showIncompleteWarning: true, error: "" });
    expect(shownText()).toContain("cluster-A");
    expect(screen.queryByText(/no longer shown/i)).toBeNull();
  });
});

describe("DOC-160: App invalidates generated files on failure", () => {
  it("flags the generated files stale in the failure branch, not just on success", () => {
    // Behavioural coverage of the drawer is above; this pins the lines in the
    // effect that make the drawer's superseded state reachable at all.
    const catchIdx = appJsx.indexOf("if (error.name === 'AbortError') return;");
    expect(catchIdx).toBeGreaterThan(-1);
    const branch = appJsx.slice(catchIdx, catchIdx + 1800);
    expect(branch).toContain("setPreviewStale(true)");
    expect(branch).toContain("setPreviewError(");
  });

  it("clears the stale flag on a successful generation", () => {
    // Otherwise the banner would outlive the problem it describes.
    // DOC-227: the success branch now merges per-artifact results before it
    // commits them, so the committed value is `merged`, not `data.files`.
    const successIdx = appJsx.indexOf("setPreviewFiles(merged)");
    expect(successIdx).toBeGreaterThan(-1);
    expect(appJsx.slice(successIdx, successIdx + 200)).toContain("setPreviewStale(false)");
  });

  it("does not flag files stale when a request is merely superseded", () => {
    // An abort means a newer request is already in flight; flagging there
    // would banner the preview on every keystroke.
    const catchIdx = appJsx.indexOf("if (error.name === 'AbortError') return;");
    const beforeReturn = appJsx.slice(catchIdx - 200, catchIdx);
    expect(beforeReturn).not.toContain("setPreviewStale(true)");
  });

  it("preserves user-entered state across a generation failure", () => {
    // The failure branch touches generated output only; it must never reset
    // the wizard state the user typed.
    const catchIdx = appJsx.indexOf("if (error.name === 'AbortError') return;");
    const branch = appJsx.slice(catchIdx, catchIdx + 1800);
    expect(branch).not.toMatch(/setState\(|updateState\(|startOver\(/);
  });
});

describe("DOC-160: out-of-order generation responses", () => {
  /* The race was checked rather than assumed. Each request takes a monotonic
     id before it is sent and both the success and failure branches ignore a
     response whose id is no longer current; the effect cleanup also aborts the
     in-flight controller. A slow older response therefore cannot overwrite a
     newer one. Pinned here so the guard cannot be dropped. */

  const effect = () => {
    const i = appJsx.indexOf("previewRequestIdRef.current += 1");
    expect(i).toBeGreaterThan(-1);
    // Window widened for DOC-227: the success branch grew when it started
    // reconciling per-artifact results. The guards asserted below are the
    // point, not the byte count.
    return appJsx.slice(i, i + 6000);
  };

  it("stamps every request with a monotonic id", () => {
    expect(effect()).toContain("const currentRequestId = previewRequestIdRef.current");
  });

  it("ignores a stale success response", () => {
    const body = effect();
    const successIdx = body.indexOf("setPreviewFiles(merged)");
    const guard = body.lastIndexOf("currentRequestId === previewRequestIdRef.current", successIdx);
    expect(guard).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(successIdx);
  });

  it("ignores a stale failure response, so it cannot supersede a newer success", () => {
    const body = effect();
    const failIdx = body.indexOf("setPreviewStale(true)");
    expect(failIdx).toBeGreaterThan(-1);
    const guard = body.lastIndexOf("currentRequestId === previewRequestIdRef.current", failIdx);
    expect(guard).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(failIdx);
  });

  it("aborts the superseded request on cleanup", () => {
    expect(appJsx).toContain("controller.abort()");
  });
});
