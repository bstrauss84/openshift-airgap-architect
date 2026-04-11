import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, render, screen, waitFor, fireEvent } from "@testing-library/react";
import App, { normalizeActiveStepIdForFlow } from "../src/App.jsx";
import Switch from "../src/components/Switch.jsx";
import { apiFetch } from "../src/api.js";
import { canonicalizeExportOptions } from "../src/exportInclusion.js";
import { stateWithBlueprintCompleteMethodologyIncomplete } from "./fixtures/minimalState.js";

vi.mock("../src/api.js", () => ({ apiFetch: vi.fn() }));

function reviewReadyState() {
  const base = stateWithBlueprintCompleteMethodologyIncomplete();
  return {
    ...base,
    credentials: {
      pullSecretPlaceholder: "{\"auths\":{\"example.com\":{}}}",
      usingMirrorRegistry: false
    },
    ui: {
      ...base.ui,
      segmentedFlowV1: true,
      activeStepId: "identity-access",
      visitedSteps: { blueprint: true, methodology: true, "identity-access": true },
      completedSteps: { blueprint: true, methodology: true }
    }
  };
}

function installDefaultApiMocks(state) {
  vi.mocked(apiFetch).mockImplementation((path, opts) => {
    if (path === "/api/state") {
      return Promise.resolve(opts?.body ? JSON.parse(opts.body) : state);
    }
    if (path === "/api/schema/stepMap") return Promise.resolve({});
    if (path === "/api/build-info") return Promise.resolve({});
    if (path === "/api/profile/capabilities") return Promise.resolve({ profile: "connected-authoring", capabilities: {} });
    if (path === "/api/update-info") return Promise.resolve({ enabled: false });
    if (path === "/api/jobs/count") return Promise.resolve({ count: 0 });
    if (path === "/api/feedback/config") return Promise.resolve({ visible: false, enabled: false, mode: "disabled", reason: "" });
    if (path === "/api/runtime-info") return Promise.resolve({});
    if (path === "/api/generate") return Promise.resolve({ files: {} });
    return Promise.resolve({});
  });
}

describe("Review step stabilization", () => {
  beforeEach(() => {
    installDefaultApiMocks(reviewReadyState());
  });
  afterEach(() => {
    cleanup();
  });

  it("renders switch as explicit switch-role button", () => {
    render(<Switch checked={false} onChange={() => {}} aria-label="Test switch" />);
    const toggle = screen.getByRole("switch", { name: /test switch/i });
    expect(toggle).toHaveClass("switch-wrap");
    expect(toggle).toHaveAttribute("data-checked", "false");
    expect(toggle.querySelector(".switch-slider")).toBeTruthy();
  });

  it("uses per-class export controls as single source of truth with pull-secret warning parity", async () => {
    render(<App />);
    await waitFor(() => expect(screen.getByRole("button", { name: /Continue install/i })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /Continue install/i }));
    await waitFor(() => expect(screen.getByRole("heading", { name: /Identity & Access/i })).toBeInTheDocument());
    fireEvent.click(screen.getAllByRole("button", { name: /Assets & Guide/i })[0]);
    await waitFor(() => expect(screen.getByRole("heading", { name: /Architecture Assets/i })).toBeInTheDocument());

    expect(screen.queryByRole("switch", { name: /Include credentials in export/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("switch", { name: /Include certificates in export/i })).not.toBeInTheDocument();
    expect(screen.getByRole("switch", { name: /Include pull secret/i })).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: /Include trust bundle and certificates/i })).toBeInTheDocument();

    expect(screen.queryByText(/Treat the bundle as sensitive/i)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("switch", { name: /Include pull secret/i }));
    expect(screen.getByText(/Treat the bundle as sensitive/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /(Expand|Collapse) Advanced \/ Tools/i }));
    expect(screen.getByRole("switch", { name: /Include high-side runtime package artifacts/i })).toBeInTheDocument();
  });

  it("keeps review step active and scroll stable while toggling advanced controls", async () => {
    render(<App />);
    await waitFor(() => expect(screen.getByRole("button", { name: /Continue install/i })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /Continue install/i }));
    await waitFor(() => expect(screen.getByRole("heading", { name: /Identity & Access/i })).toBeInTheDocument());
    fireEvent.click(screen.getAllByRole("button", { name: /Assets & Guide/i })[0]);
    await waitFor(() => expect(screen.getByRole("heading", { name: /Architecture Assets/i })).toBeInTheDocument());

    const main = document.querySelector(".main");
    expect(main).toBeTruthy();
    if (main) main.scrollTop = 480;

    fireEvent.click(screen.getByRole("button", { name: /Expand Advanced \/ Tools/i }));
    fireEvent.click(screen.getByRole("switch", { name: /Include high-side runtime package artifacts/i }));
    fireEvent.click(screen.getByRole("switch", { name: /Include oc and oc-mirror binaries/i }));
    fireEvent.click(screen.getByRole("switch", { name: /Include version-specific openshift-install/i }));

    expect(screen.getByRole("heading", { name: /Architecture Assets/i })).toBeInTheDocument();
    expect(screen.queryByText(/Something went wrong in this step/i)).not.toBeInTheDocument();
    expect(main?.scrollTop).toBe(480);
  });

  it("canonicalizes legacy export flags from per-class inclusion", () => {
    const next = canonicalizeExportOptions({
      inclusion: {
        pullSecret: true,
        platformCredentials: false,
        mirrorRegistryCredentials: false,
        bmcCredentials: false,
        trustBundleAndCertificates: true,
        sshPublicKey: true,
        proxyValues: true
      }
    });
    expect(next.includeCredentials).toBe(true);
    expect(next.includeCertificates).toBe(true);
  });

  it("normalizes legacy combined-step ids when segmented flow is enabled", () => {
    expect(normalizeActiveStepIdForFlow({
      activeStepId: "global",
      segmentedFlowV1: true,
      hasHostsInventoryStep: true
    })).toBe("identity-access");
    expect(normalizeActiveStepIdForFlow({
      activeStepId: "inventory",
      segmentedFlowV1: true,
      hasHostsInventoryStep: false
    })).toBe("operators");
  });
});
