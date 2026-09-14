import React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent, cleanup, act } from "@testing-library/react";
import App from "../src/App.jsx";
import { apiFetch } from "../src/api.js";
import { getVersionLocked } from "../src/shared/versionHelpers.js";

vi.mock("../src/api.js", () => ({ apiFetch: vi.fn() }));

const STORAGE_KEY = "airgap-architect-state";

function lockedState(overrides = {}) {
  return {
    blueprint: {
      platform: "AWS GovCloud",
      arch: "x86_64",
      clusterName: "test",
      baseDomain: "example.com",
      confirmed: true,
      ...overrides.blueprint,
    },
    release: {
      channel: "4.21",
      patchVersion: "4.21.3",
      confirmed: true,
      followLatestMinor: false,
      ...overrides.release,
    },
    version: {
      selectedMinor: "4.21",
      selectedPatch: "4.21.3",
      selectedChannel: "stable-4.21",
      locked: true,
      lockTimestamp: 1700000000000,
      selectionTimestamp: 1700000000000,
      confirmedByUser: true,
      _schemaVersion: 3,
      ...overrides.version,
    },
    methodology: { method: "IPI" },
    credentials: {},
    platformConfig: {},
    operators: {
      selected: [{ name: "test-op" }],
      stale: false,
      ...overrides.operators,
    },
    ui: { segmentedFlowV1: true, activeStepId: "blueprint", visitedSteps: { blueprint: true }, completedSteps: {} },
    reviewFlags: {},
  };
}

function mockApis(overrides = {}) {
  const st = lockedState(overrides);
  vi.mocked(apiFetch).mockImplementation((path, opts) => {
    if (path === "/api/state") return Promise.resolve(st);
    if (path === "/api/schema/stepMap") return Promise.resolve({});
    if (path === "/api/build-info") return Promise.resolve({ gitSha: "test", buildTime: "test" });
    if (path === "/api/update-info") return Promise.resolve({ enabled: false });
    if (path === "/api/jobs/count") return Promise.resolve({ count: 0 });
    if (path === "/api/cincinnati/channels") return Promise.resolve({ channels: ["4.20", "4.21"] });
    if (path === "/api/cincinnati/update" && opts?.method === "POST")
      return Promise.resolve({ channels: ["4.20", "4.21"] });
    if (String(path).startsWith("/api/cincinnati/patches?")) {
      const m = path.match(/channel=([^&]+)/);
      const ch = m ? decodeURIComponent(m[1]) : "4.20";
      return Promise.resolve({ versions: [`${ch}.8`, `${ch}.3`] });
    }
    if (path === "/api/secrets/rh-pull-secret") return Promise.resolve({ available: false });
    if (path === "/api/operators/confirm" && opts?.method === "POST") {
      return Promise.resolve({
        release: { channel: "4.21", patchVersion: "4.21.3", confirmed: true },
        version: { locked: true, lockTimestamp: Date.now(), confirmedByUser: true },
      });
    }
    if (path === "/api/aws/warm-installer") return Promise.resolve({});
    return Promise.resolve({});
  });
  return st;
}

async function navigateToBlueprint() {
  await waitFor(() => {
    expect(screen.getByRole("button", { name: /Continue install/i })).toBeTruthy();
  });
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: /Continue install/i }));
  });
  await waitFor(() => {
    expect(screen.getAllByRole("button", { name: /Blueprint/i }).length).toBeGreaterThan(0);
  });
  await act(async () => {
    fireEvent.click(screen.getAllByRole("button", { name: /Blueprint/i })[0]);
  });
  await waitFor(() => {
    expect(screen.getByRole("heading", { name: /Target Platform/i })).toBeTruthy();
  });
}

async function renderBlueprint(overrides = {}) {
  mockApis(overrides);
  render(<App />);
  await navigateToBlueprint();
}

function getPersistedState() {
  const raw = localStorage.getItem(STORAGE_KEY);
  return raw ? JSON.parse(raw) : null;
}

async function unlockRelease() {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Change release" }));
  });
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Yes, unlock release" }));
  });
}

describe("Release unlock workflow (M02)", () => {
  afterEach(() => { cleanup(); vi.restoreAllMocks(); localStorage.clear(); });

  it("locked Blueprint shows Change release button", async () => {
    await renderBlueprint();
    expect(screen.getByRole("button", { name: "Change release" })).toBeTruthy();
  });

  it("Change release button is absent when release is not locked", async () => {
    await renderBlueprint({ version: { locked: false } });
    expect(screen.queryByRole("button", { name: "Change release" })).toBeNull();
  });

  it("clicking Change release opens the warning dialog", async () => {
    await renderBlueprint();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Change release" }));
    });
    expect(screen.getByText("Change OpenShift release?")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Yes, unlock release" })).toBeTruthy();
  });

  it("cancel leaves state unchanged and locked", async () => {
    await renderBlueprint();
    const before = getPersistedState();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Change release" }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    });

    const after = getPersistedState();
    expect(after.version.locked).toBe(true);
    expect(after.release.confirmed).toBe(true);
    expect(after.version.selectedMinor).toBe(before.version.selectedMinor);
    expect(after.version.selectedPatch).toBe(before.version.selectedPatch);
    expect(after.blueprint.confirmed).toBe(true);
    expect(after.blueprint.platform).toBe(before.blueprint.platform);
    expect(after.blueprint.arch).toBe(before.blueprint.arch);
  });

  it("confirm unlocks release without changing platform, architecture, or selected release", async () => {
    await renderBlueprint();
    await unlockRelease();

    await waitFor(() => {
      const s = getPersistedState();
      expect(s.version.locked).toBe(false);
    });

    const s = getPersistedState();
    expect(s.version.lockTimestamp).toBeNull();
    expect(s.release.confirmed).toBe(false);
    expect(s.version.confirmedByUser).toBe(false);

    expect(s.version.selectedMinor).toBe("4.21");
    expect(s.version.selectedPatch).toBe("4.21.3");
    expect(s.version.selectedChannel).toBe("stable-4.21");
    expect(s.release.channel).toBe("4.21");
    expect(s.release.patchVersion).toBe("4.21.3");

    expect(s.blueprint.confirmed).toBe(true);
    expect(s.blueprint.platform).toBe("AWS GovCloud");
    expect(s.blueprint.arch).toBe("x86_64");
  });

  it("operators become stale after confirming unlock", async () => {
    await renderBlueprint();
    expect(getPersistedState().operators.stale).toBe(false);

    await unlockRelease();

    await waitFor(() => {
      expect(getPersistedState().version.locked).toBe(false);
    });

    expect(getPersistedState().operators.stale).toBe(true);
    expect(getPersistedState().operators.selected).toEqual([{ name: "test-op" }]);
  });

  it("helper failure does not partially mutate state", async () => {
    await renderBlueprint({
      version: { selectedMinor: null, selectedPatch: null, selectedChannel: null },
      release: { channel: null, patchVersion: null },
    });

    const before = getPersistedState();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Change release" }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Yes, unlock release" }));
    });

    const errorEl = screen.getByRole("alert");
    expect(errorEl).toBeTruthy();
    expect(errorEl.textContent).toMatch(/Could not unlock release/);

    const after = getPersistedState();
    expect(after.version.locked).toBe(before.version.locked);
    expect(after.release.confirmed).toBe(before.release.confirmed);
    expect(after.operators.stale).toBe(before.operators.stale);
  });

  it("release inputs become editable while platform/architecture remain locked after unlock", async () => {
    await renderBlueprint();

    const platformButtons = screen.getAllByRole("button").filter(
      (b) => b.textContent.includes("Bare Metal") || b.textContent.includes("AWS GovCloud")
    );
    platformButtons.forEach((b) => expect(b.disabled).toBe(true));

    const channelSelect = screen.getAllByRole("combobox")[0];
    expect(channelSelect.disabled).toBe(true);

    await unlockRelease();

    await waitFor(() => {
      const selects = screen.getAllByRole("combobox");
      expect(selects[0].disabled).toBe(false);
    });

    const platformButtonsAfter = screen.getAllByRole("button").filter(
      (b) => b.textContent.includes("Bare Metal") || b.textContent.includes("AWS GovCloud")
    );
    platformButtonsAfter.forEach((b) => expect(b.disabled).toBe(true));

    const archButtons = screen.getAllByRole("button").filter(
      (b) => b.textContent.includes("x86_64") || b.textContent.includes("aarch64")
    );
    archButtons.forEach((b) => expect(b.disabled).toBe(true));
  });

  it("relock via Confirm & Proceed and core lock modal restores locked state", async () => {
    await renderBlueprint();
    await unlockRelease();

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Confirm & Proceed" })).toBeTruthy();
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Confirm & Proceed" }));
    });

    await waitFor(() => {
      expect(screen.getByText("Lock foundational selections?")).toBeTruthy();
    });
    expect(screen.getByRole("button", { name: "Yes, lock selections" })).toBeTruthy();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Yes, lock selections" }));
    });

    await waitFor(() => {
      const s = getPersistedState();
      expect(s.version.locked).toBe(true);
    });

    const s = getPersistedState();
    expect(s.release.confirmed).toBe(true);
    expect(s.blueprint.confirmed).toBe(true);
    expect(s.version.selectedMinor).toBe("4.21");
    expect(getVersionLocked(s)).toBe(true);
  });

  it("warning dialog shows stale-operator and downstream-review warning text", async () => {
    await renderBlueprint();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Change release" }));
    });

    expect(screen.getByText(/Operator selections and scans will become stale/)).toBeTruthy();
    expect(screen.getByText(/version-dependent downstream work/)).toBeTruthy();
  });

  it("Update button present but disabled alongside Change release when locked", async () => {
    await renderBlueprint();
    expect(screen.getByRole("button", { name: "Change release" })).toBeTruthy();
    const updateBtn = screen.getByRole("button", { name: "Update" });
    expect(updateBtn).toBeTruthy();
    expect(updateBtn.disabled).toBe(true);
  });

  it("locked banner text differentiates fully-locked from release-unlocked state", async () => {
    await renderBlueprint();
    expect(screen.getByText("Foundational selections are locked.")).toBeTruthy();

    await unlockRelease();

    await waitFor(() => {
      expect(screen.getByText("Platform and architecture are locked. Edit the release below and confirm to proceed.")).toBeTruthy();
    });
    expect(screen.queryByText("Foundational selections are locked.")).toBeNull();
  });

  it("version _schemaVersion remains 3 after unlock", async () => {
    await renderBlueprint();
    await unlockRelease();

    await waitFor(() => {
      expect(getPersistedState().version.locked).toBe(false);
    });

    expect(getPersistedState().version._schemaVersion).toBe(3);
  });

  it("canonical patch takes precedence over legacy in divergent state", async () => {
    await renderBlueprint({
      version: { selectedPatch: "4.21.8" },
      release: { patchVersion: "4.21.3" },
    });

    await unlockRelease();

    await waitFor(() => {
      expect(getPersistedState().version.locked).toBe(false);
    });

    const s = getPersistedState();
    expect(s.version.selectedPatch).toBe("4.21.8");
    expect(s.release.patchVersion).toBe("4.21.8");
  });
});
