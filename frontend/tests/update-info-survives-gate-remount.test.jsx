/**
 * OpenShift Airgap Architect - Test Suite
 *
 * Tools → About must keep its update status after AppShell remounts.
 *
 * `VersionSupportGate` unmounts AppShell while a newly selected minor's catalogs
 * load (see tests/t7c-minor-switch-view-state.test.jsx). `updateInfo` lives in
 * AppShell, and the /api/update-info request used to run only while the landing
 * page was showing — so after any remount inside the wizard (a minor switch, an
 * import, a reload that resumes the wizard) the update line vanished entirely,
 * including a genuine "Update available". The request now runs on every mount;
 * the backend caches it.
 *
 * @author Bill Strauss
 *
 * Developed with AI assistance from Claude (Anthropic) and Cursor AI.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, cleanup, waitFor, fireEvent } from "@testing-library/react";
import React from "react";

import {
  __resetCatalogCacheForTests,
  ensureCatalogsForMinor,
  areCatalogsLoadedForMinor,
} from "../src/catalogPaths.js";
import { SUPPORTED_MINORS } from "../src/shared/versionPolicy.js";

const harness = vi.hoisted(() => ({ initialState: null }));
vi.mock("../src/store.jsx", async (importOriginal) => {
  const actual = await importOriginal();
  const { makeStoreMock } = await import("./helpers/store-harness.jsx");
  return makeStoreMock(actual, harness);
});

const UPDATE_INFO = {
  enabled: true,
  error: null,
  installedVersion: "2.1.0",
  currentSha: "unknown",
  latestSha: null,
  repo: "bstrauss84/openshift-airgap-architect",
  updateStatus: "published-supported-update",
  urgent: true,
  isOutdated: true,
  releaseIdentity: {
    verified: true,
    source: "github-releases-api",
    repo: "bstrauss84/openshift-airgap-architect",
    latest: {
      version: "2.2.0",
      tag: "v2.2.0",
      url: "https://github.com/bstrauss84/openshift-airgap-architect/releases/tag/v2.2.0",
      publishedAt: "2026-11-01T00:00:00Z"
    }
  }
};

vi.mock("../src/api.js", () => ({
  apiFetch: vi.fn((path) => {
    if (path === "/api/update-info") return Promise.resolve(UPDATE_INFO);
    if (path === "/api/build-info") {
      return Promise.resolve({ version: "2.1.0", gitSha: "unknown", buildTime: "2026-10-21T17:41:16Z", repo: "r", branch: "main" });
    }
    return Promise.resolve({});
  }),
}));
const { default: App } = await import("../src/App.jsx");

const PATCH = { "4.20": "4.20.40", "4.22": "4.22.16" };
const runAt = (minor) => ({
  _schemaVersion: 3,
  version: { _schemaVersion: 3, selectedMinor: minor, selectedPatch: PATCH[minor], selectedChannel: `stable-${minor}`, locked: true },
  release: { channel: minor, patchVersion: PATCH[minor], confirmed: true },
  blueprint: { platform: "Bare Metal", arch: "x86_64", clusterName: "c", baseDomain: "example.com", confirmed: true },
  methodology: { method: "Agent-Based Installer" },
  hostInventory: { nodes: [] },
  operators: { selected: [] },
  reviewFlags: {},
  ui: { activeStepId: "blueprint", visitedSteps: { blueprint: true }, completedSteps: { blueprint: true } },
});

describe("update status survives the version gate remounting AppShell", () => {
  beforeEach(() => { __resetCatalogCacheForTests(); });
  afterEach(async () => {
    cleanup();
    __resetCatalogCacheForTests();
    await Promise.all(SUPPORTED_MINORS.map((m) => ensureCatalogsForMinor(m)));
  });

  it("Tools → About still shows the published update after a minor switch", async () => {
    harness.initialState = runAt("4.20");
    render(<App />);
    await waitFor(() => expect(screen.queryByText(/Loading OpenShift/i)).toBeNull());
    fireEvent.click(screen.getByRole("button", { name: /Start new install|Continue install/i }));
    await waitFor(() => expect(screen.queryByRole("button", { name: /Start new install|Continue install/i })).toBeNull());

    // Precondition: the target minor is not resident, so the gate genuinely blocks.
    expect(areCatalogsLoadedForMinor("4.22")).toBe(false);
    harness.setState((prev) => ({
      ...prev,
      version: { ...prev.version, selectedMinor: "4.22", selectedPatch: PATCH["4.22"], selectedChannel: "stable-4.22" },
      release: { ...prev.release, channel: "4.22", patchVersion: PATCH["4.22"] },
    }));
    await waitFor(() => expect(areCatalogsLoadedForMinor("4.22")).toBe(true));
    await waitFor(() => expect(screen.queryByText(/Loading OpenShift/i)).toBeNull());

    fireEvent.click(await screen.findByRole("button", { name: /open tools/i }));
    await waitFor(() => {
      const line = document.querySelector(".about-update-info");
      expect(line, "update status vanished after the AppShell remount").toBeTruthy();
      expect(line.textContent).toContain("Update available: version 2.2.0");
    });
  });
});
