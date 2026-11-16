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
 *
 * DOC-215 UPDATE. ppc64le and s390x are no longer RENDERED at all: no
 * currently supported OAA scenario offers either, so a permanently disabled
 * card is noise. Assertions that used them as examples of a *closed* card
 * moved to aarch64 (closed on vSphere/Nutanix, open on bare metal), which is
 * the right example anyway — it is closed for the selected scenario, not
 * absent from the product. The per-install-method distinction they used to
 * demonstrate is asserted directly against the matrix here, since no
 * architecture that differs by method on one platform is still rendered.
 * Visibility itself is covered by
 * `doc215-blueprint-architecture-visibility.test.jsx`.
 */

import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";

import { AppContext } from "../src/store.jsx";
import BlueprintStep from "../src/steps/BlueprintStep.jsx";
import { resolveArchSupport } from "../src/archSupportResolver.js";

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

/** Same lookup, but tolerant of a card the authority says must not be drawn. */
function queryArchButton(label) {
  const heading = screen.getByRole("heading", { name: /CPU Architecture/i });
  const section = heading.closest("section");
  return within(section).queryByRole("button", { name: new RegExp(`^${label}`) });
}

describe("Blueprint architecture control is driven by the D3 matrix", () => {
  it("bare metal IPI at 4.21 offers x86_64 and aarch64, and draws no IBM architecture card", () => {
    renderStep({ platform: "Bare Metal", method: "IPI", minor: "4.21" });
    expect(archButton("x86_64")).toBeEnabled();
    expect(archButton("aarch64")).toBeEnabled();
    // DOC-215: no OAA scenario can select these, so they are not drawn.
    expect(queryArchButton("ppc64le")).toBeNull();
    expect(queryArchButton("s390x")).toBeNull();
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
    const title = archButton("aarch64").getAttribute("title");
    expect(title).toMatch(/4\.20/);
    expect(title).not.toMatch(/^Not supported on /);
  });

  it("distinguishes install methods on the same platform", () => {
    // Asserted against the matrix rather than the rendered card: the two
    // architectures whose reason differs by install method on one platform
    // (ppc64le/s390x on bare metal) are no longer drawn (DOC-215), but the
    // install method must still be part of the key.
    const agent = resolveArchSupport({ minor: "4.21", scenarioId: "bare-metal-agent", architecture: "s390x" });
    const ipi = resolveArchSupport({ minor: "4.21", scenarioId: "bare-metal-ipi", architecture: "s390x" });
    expect(agent.offered).toBe(false);
    expect(ipi.offered).toBe(false);
    // The agent row's reason is IBM Z specific; the IPI row's is not.
    expect(agent.reason).toMatch(/IBM Z/);
    expect(agent.reason).not.toBe(ipi.reason);
  });

  it("an unrecognised platform no longer opens the architectures it draws", () => {
    renderStep({ platform: "Totally Unknown Platform", method: "IPI", minor: "4.21" });
    for (const a of ["x86_64", "aarch64"]) {
      expect(archButton(a), a).toBeDisabled();
    }
    for (const a of ["ppc64le", "s390x"]) {
      expect(queryArchButton(a), a).toBeNull();
    }
  });

  it("before a release is chosen, the intersection across supported minors is used", () => {
    renderStep({ platform: "Bare Metal", method: "IPI", minor: null });
    expect(archButton("x86_64")).toBeEnabled();
    expect(archButton("aarch64")).toBeEnabled();
    expect(queryArchButton("ppc64le")).toBeNull();
  });

  it("a locked blueprint disables every architecture it draws, regardless of support", () => {
    renderStep({ platform: "Bare Metal", method: "IPI", minor: "4.21", locked: true });
    for (const a of ["x86_64", "aarch64"]) {
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
