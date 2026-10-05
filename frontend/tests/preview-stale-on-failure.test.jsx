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

  it("stops presenting the previous document once generation fails", () => {
    renderDrawer({ error: "NMState interface name must not be empty." });
    expect(shownText()).not.toContain("cluster-A");
  });

  it("surfaces the generation error instead", () => {
    renderDrawer({ error: "NMState interface name must not be empty." });
    expect(screen.getByText(/NMState interface name must not be empty/)).toBeInTheDocument();
    // And says plainly that the old files are no longer being shown.
    expect(shownText()).toMatch(/no longer shown/i);
  });

  it("offers no Download while there is nothing current to download", () => {
    renderDrawer({ error: "generation failed" });
    // Split view drops its panes entirely, so no Download is even rendered.
    expect(screen.queryByRole("button", { name: /^Download$/i })).toBeNull();
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

    rerender(
      <YamlDrawer
        isOpen
        onClose={() => {}}
        previewFiles={{}}
        activeStepId="review"
        scenario={{ isAgentBased: true, method: "Agent-Based Installer", platform: "Bare Metal" }}
        loading={false}
        error="generation failed"
      />
    );
    expect(shownText()).not.toContain("cluster-A");

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
    renderDrawer({ error: "Failed to fetch" });
    expect(shownText()).not.toContain("cluster-A");
    expect(screen.getByText(/Failed to fetch/)).toBeInTheDocument();
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
      />
    );
    expect(shownText()).not.toContain("cluster-A");
    expect(screen.getByText(/generation failed/)).toBeInTheDocument();
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
  it("clears previewFiles in the failure branch, not just on success", () => {
    // Behavioural coverage of the drawer is above; this pins the one line in
    // the effect that makes the drawer's error state reachable at all.
    const catchIdx = appJsx.indexOf("if (error.name === 'AbortError') return;");
    expect(catchIdx).toBeGreaterThan(-1);
    const branch = appJsx.slice(catchIdx, catchIdx + 1800);
    expect(branch).toContain("setPreviewFiles({})");
    expect(branch).toContain("setPreviewError(");
  });

  it("does not clear generated files when a request is merely superseded", () => {
    // An abort means a newer request is already in flight; clearing there
    // would blank the preview on every keystroke.
    const catchIdx = appJsx.indexOf("if (error.name === 'AbortError') return;");
    const beforeReturn = appJsx.slice(catchIdx - 200, catchIdx);
    expect(beforeReturn).not.toContain("setPreviewFiles({})");
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
    return appJsx.slice(i, i + 2600);
  };

  it("stamps every request with a monotonic id", () => {
    expect(effect()).toContain("const currentRequestId = previewRequestIdRef.current");
  });

  it("ignores a stale success response", () => {
    const body = effect();
    const successIdx = body.indexOf("setPreviewFiles(data.files");
    const guard = body.lastIndexOf("currentRequestId === previewRequestIdRef.current", successIdx);
    expect(guard).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(successIdx);
  });

  it("ignores a stale failure response, so it cannot blank a newer success", () => {
    const body = effect();
    const failIdx = body.indexOf("setPreviewFiles({})");
    expect(failIdx).toBeGreaterThan(-1);
    const guard = body.lastIndexOf("currentRequestId === previewRequestIdRef.current", failIdx);
    expect(guard).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(failIdx);
  });

  it("aborts the superseded request on cleanup", () => {
    expect(appJsx).toContain("controller.abort()");
  });
});
