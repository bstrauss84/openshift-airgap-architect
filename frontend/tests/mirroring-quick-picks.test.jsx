/**
 * v2.2.0 R-UX07 — Scenario Quick Picks in Mirroring, from Install's shared
 * definitions and selection logic: version-aware, scanned catalogs only,
 * ownership by source (removing a pick keeps operators chosen otherwise).
 */
import React, { useState } from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor, within } from "@testing-library/react";
import { apiFetch } from "../src/api.js";
import OperatorsSection from "../src/mirroring/OperatorsSection.jsx";
import { _resetScanSessionsForTests } from "../src/mirroring/useProfileCatalogs.js";
import { _resetSourceCredentialsForTests } from "../src/mirroring/sourceCredentialSession.js";
import { applyScenarioPicks, removeScenarioPicks, scenarios } from "../src/shared/operatorQuickPicks.js";

vi.mock("../src/api.js", () => ({ apiFetch: vi.fn(), API_BASE: "" }));

const entry = (catalog, name, displayName = name) => ({ id: `${catalog}:${name}`, name, displayName, defaultChannel: "stable", catalog });
let fake;
function api(path, opts = {}) {
  if (/\/runs$/.test(path)) return Promise.resolve({ runs: [], activeVerification: null });
  if (path === "/api/secrets/rh-pull-secret") return Promise.resolve({ available: false });
  const m = path.match(/^\/api\/operators\/status\?version=(.+)$/);
  if (m) return Promise.resolve(fake.cache[decodeURIComponent(m[1])] || {});
  if (path.startsWith("/api/mirroring/profiles/") && opts.method === "POST") {
    const body = JSON.parse(opts.body);
    fake.writes.push(body);
    fake.profile = { ...fake.profile, operators: { ...fake.profile.operators, ...(body.operators || {}) } };
    return Promise.resolve(fake.profile);
  }
  return Promise.reject(new Error(`unexpected ${path}`));
}
const profileFor = (minor, selected = []) => ({
  id: "p-picks000001", name: "picks", updatedAt: 1,
  content: { platform: false, operators: true, additionalImages: false },
  platform: { release: {}, version: {} },
  operators: { catalogMinor: minor, catalogMinorSource: "user", selected },
  additionalImages: [], paths: {}, catalogReconciliation: null
});
function Host({ initial }) {
  const [p, setP] = useState(initial);
  return <OperatorsSection profile={p} onProfileChanged={setP} />;
}
const picks = () => screen.getByRole("group", { name: "Scenario Quick Picks" });
const selectedNames = () => within(screen.getByRole("list", { name: "Selected operators" })).queryAllByRole("listitem").map((li) => li.querySelector(".mirroring-selected-name").textContent);

beforeEach(() => {
  _resetScanSessionsForTests();
  _resetSourceCredentialsForTests();
  fake = { cache: {}, writes: [], profile: null };
  vi.mocked(apiFetch).mockReset();
  vi.mocked(apiFetch).mockImplementation(api);
});
afterEach(cleanup);

describe("Mirroring Quick Picks (R-UX07)", () => {
  it("disabled with an explanation until the catalogs for the profile's minor are scanned", async () => {
    fake.profile = profileFor("4.22");
    render(<Host initial={fake.profile} />);
    const btn = await within(picks()).findByRole("button", { name: /^Local Storage/ });
    expect(btn).toBeDisabled();
    expect(screen.getByText(/Quick Picks become available once the OpenShift 4\.22 catalogs are scanned/)).toBeInTheDocument();
  });

  it("adds only what the scanned catalogs contain, reports the rest, and marks the operators as Quick Pick", async () => {
    fake.cache["4.22"] = { redhat: { results: [entry("redhat", "lvms-operator", "LVM Storage")] } };
    fake.profile = profileFor("4.22");
    render(<Host initial={fake.profile} />);
    const btn = await within(picks()).findByRole("button", { name: /^Local Storage/ });
    await waitFor(() => expect(btn).toBeEnabled());
    fireEvent.click(btn);
    expect(selectedNames()).toEqual(["LVM Storage"]);
    expect(screen.getByText(/local-storage-operator is not in the scanned OpenShift 4\.22 catalogs, so it was not added/)).toBeInTheDocument();
    expect(btn).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText(/· Quick Pick/)).toBeInTheDocument();
    await waitFor(() => expect(fake.writes.at(-1)?.operators?.selected?.[0]).toMatchObject({ name: "lvms-operator", sources: ["local-storage"] }));
  });

  it("removing a pick keeps an operator you chose yourself", async () => {
    fake.cache["4.22"] = { redhat: { results: [entry("redhat", "lvms-operator", "LVM Storage"), entry("redhat", "local-storage-operator", "Local Storage")] } };
    const images = "registry.redhat.io/redhat/redhat-operator-index:v4.22";
    fake.profile = profileFor("4.22", [{ ...entry("redhat", "lvms-operator", "LVM Storage"), catalogImage: images, sources: ["manual"], verifiedMinor: "4.22" }]);
    render(<Host initial={fake.profile} />);
    const btn = await within(picks()).findByRole("button", { name: /^Local Storage/ });
    await waitFor(() => expect(btn).toBeEnabled());
    fireEvent.click(btn);
    expect(selectedNames().sort()).toEqual(["LVM Storage", "Local Storage"]);
    fireEvent.click(btn);
    expect(selectedNames()).toEqual(["LVM Storage"]);
  });

  it("version-aware: OpenShift AI resolves per minor, never another minor's list", () => {
    const ai = scenarios.find((s) => s.id === "openshift-ai");
    const catalogs = { redhat: ["rhods-operator", "rhods-prometheus-operator", "nfd"].map((n) => entry("redhat", n)), certified: [entry("certified", "gpu-operator-certified")] };
    const at422 = applyScenarioPicks({ selected: [], scenario: ai, minor: "4.22", catalogs, catalogImages: {} });
    const at421 = applyScenarioPicks({ selected: [], scenario: ai, minor: "4.21", catalogs, catalogImages: {} });
    expect(at422.selected.map((o) => o.name)).not.toContain("rhods-prometheus-operator");
    expect(at421.selected.map((o) => o.name)).toContain("rhods-prometheus-operator");
    expect(applyScenarioPicks({ selected: [], scenario: ai, minor: "4.23", catalogs, catalogImages: {} })).toBeNull();
  });
});

describe("shared selection logic keeps Install's semantics", () => {
  const pick = { id: "s1", label: "S1", picks: { redhat: ["a-op", "b-op"] } };
  const catalogs = { redhat: [entry("redhat", "a-op"), entry("redhat", "b-op")] };

  it("Install (scenarioAdded): an operator selected manually before the pick stays when the pick is removed", () => {
    const manual = { ...entry("redhat", "a-op"), sources: ["manual"] };
    const applied = applyScenarioPicks({ selected: [manual], scenarioAdded: {}, scenario: pick, minor: "4.22", catalogs, catalogImages: { redhat: "img" } });
    expect(applied.selected.find((o) => o.name === "a-op").sources).toEqual(["manual", "s1"]);
    expect(applied.scenarioAdded).toEqual({ "redhat:a-op": { s1: true }, "redhat:b-op": { s1: true } });
    const removed = removeScenarioPicks({ selected: applied.selected, scenarioAdded: applied.scenarioAdded, scenarioId: "s1" });
    expect(removed.selected.map((o) => [o.name, o.sources])).toEqual([["a-op", ["manual"]]]);
    expect(removed.scenarioAdded).toEqual({});
  });

  it("two picks holding one operator: removing one keeps it", () => {
    const p2 = { id: "s2", label: "S2", picks: { redhat: ["a-op"] } };
    let r = applyScenarioPicks({ selected: [], scenario: pick, minor: "4.22", catalogs, catalogImages: {} });
    r = applyScenarioPicks({ selected: r.selected, scenarioAdded: r.scenarioAdded, scenario: p2, minor: "4.22", catalogs, catalogImages: {} });
    const out = removeScenarioPicks({ selected: r.selected, scenarioId: "s1" });
    expect(out.selected.map((o) => [o.name, o.sources])).toEqual([["a-op", ["s2"]]]);
  });
});
