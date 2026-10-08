/**
 * Blueprint CPU Architecture control — rendered behaviour after the D3 migration.
 *
 * The resolver is unit-tested in `arch-support-resolver.test.jsx`. This file
 * proves the STEP actually consults it, by asserting the rendered buttons.
 *
 * Three of these assertions fail against the constant this replaced:
 *   - vSphere aarch64 was ENABLED by `PLATFORM_ARCH_SUPPORT` and is documented
 *     by no supported minor's platform book;
 *   - AWS GovCloud aarch64, likewise;
 *   - an unrecognised platform fell through `|| archOptions.map(...)` and
 *     enabled ALL FOUR architectures.
 *
 * The tooltip assertions pin the other half of DOC-156: the old copy was
 * `Not supported on ${platform}`, which is structurally incapable of citing an
 * OpenShift version. Every closed cell now names the minor and the source.
 */

import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";

import { AppContext } from "../src/store.jsx";
import BlueprintStep from "../src/steps/BlueprintStep.jsx";

vi.mock("../src/api.js", () => ({ apiFetch: vi.fn(() => new Promise(() => {})) }));

function baseState({ platform, method, minor, locked = false }) {
  return {
    _schemaVersion: 3,
    blueprint: {
      arch: "x86_64",
      platform,
      clusterName: "test-cluster",
      baseDomain: "example.com",
      confirmed: locked,
    },
    methodology: { method },
    release: minor ? { channel: `stable-${minor}`, patchVersion: `${minor}.1` } : { channel: null, patchVersion: null },
    version: minor
      ? { selectedMinor: minor, selectedPatch: `${minor}.1`, selectedChannel: `stable-${minor}`, locked: false }
      : {},
    globalStrategy: { networking: {} },
  };
}

function renderStep(stateArgs) {
  const state = baseState(stateArgs);
  const updateState = vi.fn();
  render(
    <AppContext.Provider value={{ state, updateState, setState: updateState }}>
      <BlueprintStep />
    </AppContext.Provider>
  );
  return { state, updateState };
}

/** The architecture card for one value, from inside the CPU Architecture section. */
function archButton(label) {
  const heading = screen.getByRole("heading", { name: /CPU Architecture/i });
  const section = heading.closest("section");
  return within(section).getByRole("button", { name: new RegExp(`^${label}`) });
}

describe("Blueprint architecture control is driven by the D3 matrix", () => {
  it("bare metal IPI at 4.21 offers x86_64 and aarch64, and closes the IBM architectures", () => {
    renderStep({ platform: "Bare Metal", method: "IPI", minor: "4.21" });
    expect(archButton("x86_64")).toBeEnabled();
    expect(archButton("aarch64")).toBeEnabled();
    expect(archButton("ppc64le")).toBeDisabled();
    expect(archButton("s390x")).toBeDisabled();
  });

  it("vSphere IPI at 4.21 CLOSES aarch64 — the replaced table wrongly enabled it", () => {
    renderStep({ platform: "VMware vSphere", method: "IPI", minor: "4.21" });
    expect(archButton("x86_64")).toBeEnabled();
    const arm = archButton("aarch64");
    expect(arm).toBeDisabled();
    expect(arm.getAttribute("title")).toMatch(/OCP 4\.21 Installing on VMware vSphere book documents amd64/);
  });

  it("AWS GovCloud IPI at 4.21 CLOSES aarch64 and says GovCloud is unaddressed", () => {
    renderStep({ platform: "AWS GovCloud", method: "IPI", minor: "4.21" });
    const arm = archButton("aarch64");
    expect(arm).toBeDisabled();
    expect(arm.getAttribute("title")).toMatch(/no statement covers AWS GovCloud regions/);
  });

  it("the disabled tooltip names the OpenShift minor, which the old copy could not", () => {
    renderStep({ platform: "Nutanix", method: "IPI", minor: "4.20" });
    const title = archButton("s390x").getAttribute("title");
    expect(title).toMatch(/4\.20/);
    expect(title).not.toMatch(/^Not supported on /);
  });

  it("distinguishes install methods on the same platform", () => {
    renderStep({ platform: "Bare Metal", method: "Agent-Based Installer", minor: "4.21" });
    const s390x = archButton("s390x");
    expect(s390x).toBeDisabled();
    // The agent row's reason is IBM Z specific; the IPI row's is not.
    expect(s390x.getAttribute("title")).toMatch(/IBM Z/);
  });

  it("an unrecognised platform no longer opens all four architectures", () => {
    renderStep({ platform: "Totally Unknown Platform", method: "IPI", minor: "4.21" });
    for (const a of ["x86_64", "aarch64", "ppc64le", "s390x"]) {
      expect(archButton(a), a).toBeDisabled();
    }
  });

  it("before a release is chosen, the intersection across supported minors is used", () => {
    renderStep({ platform: "Bare Metal", method: "IPI", minor: null });
    expect(archButton("x86_64")).toBeEnabled();
    expect(archButton("aarch64")).toBeEnabled();
    expect(archButton("ppc64le")).toBeDisabled();
  });

  it("a locked blueprint disables every architecture regardless of support", () => {
    renderStep({ platform: "Bare Metal", method: "IPI", minor: "4.21", locked: true });
    for (const a of ["x86_64", "aarch64", "ppc64le", "s390x"]) {
      expect(archButton(a), a).toBeDisabled();
    }
  });

  it("the control still describes the TARGET-CLUSTER axis, not the download axis", () => {
    renderStep({ platform: "Bare Metal", method: "IPI", minor: "4.21" });
    expect(
      screen.getByText(/Target cluster host\/node architecture .* Not your local workstation or browser machine\./i)
    ).toBeInTheDocument();
  });
});
