import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { AppContext } from "../src/store.jsx";
import OperatorsStep from "../src/steps/OperatorsStep.jsx";
import { apiFetch } from "../src/api.js";
import { stateWithBlueprintCompleteMethodologyIncomplete } from "./fixtures/minimalState.js";

vi.mock("../src/api.js", () => ({ apiFetch: vi.fn() }));

function buildState() {
  const base = stateWithBlueprintCompleteMethodologyIncomplete();
  return {
    ...base,
    release: { channel: "stable-4.19", patchVersion: "4.19.8", confirmed: true },
    version: { versionConfirmed: true },
    operators: {
      selected: [],
      version: "stable-4.20",
      catalogs: {
        redhat: [{ id: "redhat:openshift-gitops-operator", name: "openshift-gitops-operator", defaultChannel: "latest", catalog: "redhat" }],
        certified: [],
        community: []
      },
      stale: false
    },
    continuation: {
      importedRun: true,
      mode: "start-over-from-import",
      operatorCacheScope: { channel: "stable-4.20", patchVersion: "4.20.12" },
      locks: {
        releaseMinor: false,
        releasePatch: false,
        operatorSelections: false,
        operatorChannelsPackages: false,
        mirroredAssumptions: false
      }
    },
    statusModel: {
      continuationLocked: false,
      cacheLimited: true,
      reviewNeeded: false,
      secretsOmitted: true
    }
  };
}

describe("Operators cache-scope mismatch behavior", () => {
  it("disables normal operator selection when selected release is outside imported cache scope", async () => {
    const initial = buildState();
    vi.mocked(apiFetch).mockImplementation((path) => {
      if (path === "/api/operators/credentials") return Promise.resolve({ available: false });
      if (String(path).startsWith("/api/jobs/")) return Promise.resolve({ status: "completed", progress: 100 });
      return Promise.resolve({});
    });

    render(
      <AppContext.Provider value={{ state: initial, updateState: vi.fn(), setState: vi.fn() }}>
        <OperatorsStep />
      </AppContext.Provider>
    );

    await waitFor(() => {
      expect(screen.getByRole("heading", { level: 2, name: /Operator Catalog Strategy/i })).toBeInTheDocument();
    });

    expect(screen.getByText(/outside imported operator cache scope/i)).toBeInTheDocument();
    const addButtons = screen.getAllByRole("button", { name: /Add/i });
    expect(addButtons.length).toBeGreaterThan(0);
    addButtons.forEach((btn) => expect(btn).toBeDisabled());
  });
});

