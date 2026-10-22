/**
 * DOC-115 (GitHub issue #18) — cloud availability-zone fields, regression protection.
 *
 * The fix shipped in 6e54610: the AWS GovCloud, Azure Government and IBM Cloud
 * zone fields use the shared CommaListInput. This suite drives the REAL step
 * component with user-event keystrokes (not fireEvent value replacement), so a
 * regression to an input that strips commas while typing fails here. It covers
 * the canonical acceptance criteria that a component test can observe: commas
 * survive sequential typing (1), raw text is preserved while typing (2), the
 * canonical array is committed and normalized on blur (3, 10), paste (5),
 * whitespace trimming (6), trailing commas (7), editing one value (8), and
 * empty elements (9), for all three providers (12). YAML output (11) is pinned
 * in backend/test/doc-115-zone-yaml.test.js, and real-browser keyboard entry
 * (4) in e2e/specs/validation/doc-115-zone-fields.spec.js.
 */
import React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AppContext } from "../src/store.jsx";
import PlatformSpecificsStep from "../src/steps/PlatformSpecificsStep.jsx";

vi.mock("../src/api.js", () => ({ apiFetch: vi.fn(() => Promise.resolve({})), API_BASE: "" }));

const PROVIDERS = [
  { name: "AWS GovCloud", platform: "AWS GovCloud", key: "aws", placeholder: /us-gov-west-1a,us-gov-west-1b/, a: "us-gov-west-1a", b: "us-gov-west-1b", c: "us-gov-west-1c" },
  { name: "Azure Government", platform: "Azure Government", key: "azure", placeholder: /^e\.g\. 1,2,3$/, a: "1", b: "2", c: "3" },
  { name: "IBM Cloud", platform: "IBM Cloud", key: "ibmcloud", placeholder: /us-east-1,us-east-2/, a: "us-east-1", b: "us-east-2", c: "us-east-3" }
];

function Harness({ initial, onState }) {
  const [state, setState] = React.useState(initial);
  React.useEffect(() => { onState(state); }, [state, onState]);
  const updateState = (patch) => setState((prev) => ({ ...prev, ...patch }));
  return (
    <AppContext.Provider value={{ state, updateState, setState, loading: false, startOver: vi.fn() }}>
      <PlatformSpecificsStep />
    </AppContext.Provider>
  );
}

function renderProvider(p) {
  const seen = { state: null };
  const initial = {
    _schemaVersion: 3,
    version: { _schemaVersion: 3, selectedMinor: "4.22", selectedPatch: "4.22.16", selectedChannel: "stable-4.22", selectedVersion: "4.22.16", locked: true },
    release: { channel: "4.22", patchVersion: "4.22.16", confirmed: true },
    blueprint: { platform: p.platform, arch: "x86_64", clusterName: "doc115", baseDomain: "example.com", confirmed: true },
    methodology: { method: "IPI" },
    platformConfig: { aws: { region: "us-gov-west-1" }, azure: { region: "usgovvirginia" }, ibmcloud: { region: "us-east" } },
    globalStrategy: { networking: {} },
    hostInventory: { nodes: [] },
    ui: { segmentedFlowV1: true }
  };
  render(<Harness initial={initial} onState={(s) => { seen.state = s; }} />);
  const input = screen.getByPlaceholderText(p.placeholder);
  const zones = () => seen.state.platformConfig?.[p.key]?.defaultMachinePlatformZones;
  return { input, zones };
}

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("DOC-115 zone fields accept and normalize comma-separated keyboard input", () => {
  for (const p of PROVIDERS) {
    describe(p.name, () => {
      it("commas survive sequential typing; raw text is kept until blur", async () => {
        const user = userEvent.setup();
        const { input, zones } = renderProvider(p);
        await user.click(input);
        await user.keyboard(`${p.a},${p.b},`);
        expect(input.value).toBe(`${p.a},${p.b},`); // trailing comma kept while typing
        expect(zones()).toEqual([p.a, p.b]);
        await user.keyboard(p.c);
        expect(input.value).toBe(`${p.a},${p.b},${p.c}`);
        await user.tab();
        expect(zones()).toEqual([p.a, p.b, p.c]);
        expect(input.value).toBe(`${p.a},${p.b},${p.c}`);
      });

      it("normalizes on blur: trims whitespace, drops empty and trailing elements", async () => {
        const user = userEvent.setup();
        const { input, zones } = renderProvider(p);
        await user.click(input);
        await user.keyboard(`  ${p.a} , ,${p.b} ,`);
        await user.tab();
        expect(zones()).toEqual([p.a, p.b]);
        expect(input.value).toBe(`${p.a},${p.b}`);
      });

      it("paste keeps every value", async () => {
        const user = userEvent.setup();
        const { input, zones } = renderProvider(p);
        await user.click(input);
        await user.paste(`${p.a},${p.b},${p.c}`);
        expect(input.value).toBe(`${p.a},${p.b},${p.c}`);
        await user.tab();
        expect(zones()).toEqual([p.a, p.b, p.c]);
      });

      it("one value can be deleted and corrected without losing the others", async () => {
        const user = userEvent.setup();
        const { input, zones } = renderProvider(p);
        await user.click(input);
        await user.keyboard(`${p.a},${p.b},${p.c}`);
        await user.tab();
        // Delete the last value and its comma, then type a correction.
        await user.click(input);
        await user.keyboard(`{End}${"{Backspace}".repeat(p.c.length + 1)}`);
        expect(input.value).toBe(`${p.a},${p.b}`);
        await user.keyboard(`,${p.a}`);
        await user.tab();
        expect(zones()).toEqual([p.a, p.b, p.a]);
      });

      it("clearing the field removes the setting rather than storing an empty entry", async () => {
        const user = userEvent.setup();
        const { input, zones } = renderProvider(p);
        await user.click(input);
        await user.keyboard(`${p.a},${p.b}`);
        await user.tab();
        await user.clear(input);
        await act(async () => { await user.tab(); });
        expect(zones()).toBeUndefined();
      });
    });
  }
});
