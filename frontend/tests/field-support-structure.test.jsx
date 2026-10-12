/**
 * OpenShift Airgap Architect - Test Suite
 *
 * STRUCTURAL ENFORCEMENT: field supporting-content placement.
 *
 * This is the permanent, DATA-DRIVEN generalisation of
 * `vsphere-server-error-presentation.test.jsx`, which guarded exactly one field
 * (vSphere "Server") against exactly this defect and therefore did not stop it
 * recurring on the 4.22 bare-metal `provisioningNetworkGateway` field.
 *
 * The contract it enforces (docs/DESIGN_SYSTEM.md, "Field layout contract";
 * docs/VERSION_AWARE_UI_FIELD_CHECKLIST.md §4/§6/§8/§10) is:
 *
 *     <div className="field-control-stack">        <- THE grid cell
 *       <FieldLabelWithInfo ...>                   <- label row + control row
 *         <input/select/textarea />
 *       </FieldLabelWithInfo>
 *       <div className="field-control-support">    <- support row
 *         {error  && <span className="field-error" role="alert">}
 *         {isNew  && <div data-version-annotation="introduced">New in OpenShift X.Y</div>}
 *         {helper && <div className="field-helper">}
 *       </div>
 *     </div>
 *
 * Why this must be mechanical rather than prose: `.platform-specifics
 * .field-grid` is `repeat(auto-fit, minmax(min(100%, 220px), 1fr))`, so EVERY
 * direct child consumes a COLUMN. An error span or a "New in OpenShift X.Y"
 * badge rendered as a direct child of the grid therefore appears to the RIGHT
 * of its own field and pushes every neighbouring control sideways. A React
 * fragment (`<>...</>`) emits no DOM node, so a field "wrapped" in a fragment
 * is NOT wrapped at all — that is precisely how the 4.22 gateway field broke.
 *
 * The checks below sweep the WHOLE rendered step for every modelled scenario,
 * variant and supported minor. They are not keyed to a field list, so a field
 * added for 4.23 is covered the moment it renders — no test edit required.
 *
 * @author Bill Strauss
 *
 * Developed with AI assistance from Claude (Anthropic) and Cursor AI.
 */

import React from "react";
import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup, fireEvent } from "@testing-library/react";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import PlatformSpecificsStep from "../src/steps/PlatformSpecificsStep.jsx";
import { AppContext } from "../src/store.jsx";
import { SUPPORTED_MINORS } from "../src/shared/versionPolicy.js";
import { SCENARIO_BY_PLATFORM_METHOD } from "../../shared/scenarioId.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STEP_PATH = path.join(__dirname, "../src/steps/PlatformSpecificsStep.jsx");
const stepSrc = fs.readFileSync(STEP_PATH, "utf8");
const css = fs.readFileSync(path.join(__dirname, "../src/styles.css"), "utf8");

/* ------------------------------------------------------------------ *
 * 1. The structural checkers (pure, so they can be negative-controlled)
 * ------------------------------------------------------------------ */

/** Anything that is supporting content and must therefore never be a grid item. */
const SUPPORT_SELECTOR = ".field-error, .field-control-support, [data-version-annotation]";

function describeNode(el) {
  const cls = el.getAttribute("class") || "";
  const ann = el.getAttribute("data-version-annotation");
  const text = (el.textContent || "").trim().slice(0, 70);
  return `<${el.tagName.toLowerCase()} class="${cls}"${ann ? ` data-version-annotation="${ann}"` : ""}> "${text}"`;
}

/**
 * Sweep a rendered subtree for supporting content that escaped its field
 * wrapper. Returns a list of human-readable violations (empty === conformant).
 */
export function findSupportPlacementViolations(root) {
  const violations = [];

  // (a) A .field-control-support is only ever a direct child of a stack.
  for (const support of root.querySelectorAll(".field-control-support")) {
    const parent = support.parentElement;
    if (!parent || !parent.classList.contains("field-control-stack")) {
      violations.push(
        `field-control-support is not a direct child of .field-control-stack: ${describeNode(support)}`
      );
    }
  }

  // (b) Every inline validation message sits in its own field's support band.
  for (const error of root.querySelectorAll(".field-error")) {
    const support = error.closest(".field-control-support");
    if (!support) {
      violations.push(`inline .field-error is outside any .field-control-support: ${describeNode(error)}`);
      continue;
    }
    if (!support.parentElement?.classList.contains("field-control-stack")) {
      violations.push(`inline .field-error is in a support band with no .field-control-stack: ${describeNode(error)}`);
    }
  }

  // (c) Every "New in OpenShift X.Y" badge sits in its own field's support band.
  for (const badge of root.querySelectorAll("[data-version-annotation]")) {
    const support = badge.closest(".field-control-support");
    if (!support) {
      violations.push(`version annotation badge is outside any .field-control-support: ${describeNode(badge)}`);
      continue;
    }
    if (!support.parentElement?.classList.contains("field-control-stack")) {
      violations.push(`version annotation badge is in a support band with no .field-control-stack: ${describeNode(badge)}`);
    }
  }

  // (d) Nothing supporting may become an independent grid column.
  for (const grid of root.querySelectorAll(".field-grid")) {
    for (const child of Array.from(grid.children)) {
      if (child.matches(SUPPORT_SELECTOR)) {
        violations.push(
          `supporting content is a direct child of .field-grid (it will steal a column and push neighbouring fields): ${describeNode(child)}`
        );
      }
    }
  }

  return violations;
}

/**
 * Source-level companion check. A React fragment produces no DOM node, so a
 * conditionally rendered field "wrapped" in `<>...</>` leaves its support
 * content as a bare grid child — the exact idiom that broke the 4.22 gateway
 * field. This catches it even in branches no render scenario reaches.
 *
 * Rule, evaluated per fragment body: every `.field-control-support` needs a
 * `.field-control-stack` to live in, and every `.field-error` needs a
 * `.field-control-support` to live in. A fragment that carries more support
 * content than it carries wrappers is, by construction, leaking that content
 * into whatever grid encloses the fragment.
 */
export function findFragmentWrappedSupport(src) {
  const violations = [];
  const tokens = [];
  const re = /<>|<\/>/g;
  let m;
  while ((m = re.exec(src)) !== null) tokens.push({ tok: m[0], idx: m.index });

  const open = [];
  const count = (body, needle) => body.split(needle).length - 1;

  for (const { tok, idx } of tokens) {
    if (tok === "<>") {
      open.push(idx);
      continue;
    }
    const start = open.pop();
    if (start === undefined) continue;
    const body = src.slice(start, idx);
    const line = src.slice(0, start).split("\n").length;
    const stacks = count(body, 'className="field-control-stack"');
    const supports = count(body, 'className="field-control-support"');
    const errors = count(body, 'className="field-error"');

    if (supports > stacks) {
      violations.push(
        `React fragment opened at line ${line}: ${supports} .field-control-support but only ${stacks} .field-control-stack — a fragment emits no DOM node, so the support content becomes a bare .field-grid child. Use <div className="field-control-stack"> instead of <>.`
      );
    }
    if (errors > supports) {
      violations.push(
        `React fragment opened at line ${line}: ${errors} .field-error but only ${supports} .field-control-support — the inline validation message will render as its own grid column beside the field instead of underneath it.`
      );
    }
  }
  return violations;
}

/* ------------------------------------------------------------------ *
 * 2. Negative controls — proof the checkers actually detect the defect
 * ------------------------------------------------------------------ */

describe("structural checkers detect the defect they exist to prevent", () => {
  afterEach(cleanup);

  /**
   * Byte-for-byte the shape the 4.22 provisioningNetworkGateway field shipped
   * with: a fragment, so the support div and the error span are siblings of the
   * input inside .field-grid.
   */
  function BrokenGatewayFixture() {
    return (
      <div className="step platform-specifics">
        <div className="field-grid">
          <>
            <div className="field-with-info-row">
              <span className="field-title-line">Provisioning network gateway (optional)</span>
              <input defaultValue="" />
            </div>
            <div className="field-control-support">
              <div className="field-helper" data-version-annotation="introduced">New in OpenShift 4.22</div>
            </div>
            <span className="field-error">Provisioning network gateway must be a valid IP address.</span>
          </>
        </div>
      </div>
    );
  }

  function CanonicalGatewayFixture() {
    return (
      <div className="step platform-specifics">
        <div className="field-grid">
          <div className="field-control-stack">
            <div className="field-with-info-row">
              <span className="field-title-line">Provisioning network gateway (optional)</span>
              <input defaultValue="" />
            </div>
            <div className="field-control-support">
              <span className="field-error" role="alert">Provisioning network gateway must be a valid IP address.</span>
              <div className="field-helper" data-version-annotation="introduced">New in OpenShift 4.22</div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  it("flags the badge, the error AND the support div when the field is fragment-wrapped", () => {
    const { container } = render(<BrokenGatewayFixture />);
    const violations = findSupportPlacementViolations(container);

    expect(violations.join("\n")).toMatch(/field-control-support is not a direct child/);
    expect(violations.join("\n")).toMatch(/inline \.field-error is outside any \.field-control-support/);
    expect(violations.join("\n")).toMatch(/direct child of \.field-grid/);
    // badge + error + support div + two stray grid children
    expect(violations.length).toBeGreaterThanOrEqual(4);
  });

  it("passes the canonical shape unchanged", () => {
    const { container } = render(<CanonicalGatewayFixture />);
    expect(findSupportPlacementViolations(container)).toEqual([]);
  });

  it("the fragment scanner flags fragment-wrapped support content", () => {
    const broken = [
      "{showGateway ? (",
      "  <>",
      "    <FieldLabelWithInfo label=\"Gateway\"><input /></FieldLabelWithInfo>",
      "    <div className=\"field-control-support\" />",
      "  </>",
      ") : null}",
    ].join("\n");
    expect(findFragmentWrappedSupport(broken)).toHaveLength(1);
    expect(findFragmentWrappedSupport(broken)[0]).toMatch(/fragment emits no DOM node/);

    const brokenError = [
      "{showDhcp ? (",
      "  <>",
      "    <FieldLabelWithInfo label=\"DHCP range\"><input /></FieldLabelWithInfo>",
      "    {err && <span className=\"field-error\">{err}</span>}",
      "  </>",
      ") : null}",
    ].join("\n");
    expect(findFragmentWrappedSupport(brokenError)).toHaveLength(1);
    expect(findFragmentWrappedSupport(brokenError)[0]).toMatch(/own grid column beside the field/);
  });

  it("the fragment scanner leaves fragments that carry no support content alone", () => {
    const fine = '{cond ? (<><span>a</span><span>b</span></>) : null}';
    expect(findFragmentWrappedSupport(fine)).toEqual([]);
  });
});

/* ------------------------------------------------------------------ *
 * 3. The real sweep over the production step
 * ------------------------------------------------------------------ */

/**
 * Force EVERY field's inline validation message to render at once. `fieldErrors`
 * is a plain prop read only via property access, so a proxy that answers every
 * string key makes the sweep independent of the error-key naming of any
 * individual field — including fields added in future minors.
 */
const ALL_FIELDS_INVALID = new Proxy(
  {},
  {
    get: (_t, key) => (typeof key === "string" ? "structural-test forced validation message" : undefined),
    has: () => true,
    ownKeys: () => [],
    getOwnPropertyDescriptor: () => ({ configurable: true, enumerable: false }),
  }
);

function baseState(platform, method, minor, overrides = {}) {
  return {
    blueprint: { platform, arch: "x86_64", clusterName: "test", baseDomain: "example.com", confirmed: false },
    release: { channel: minor, patchVersion: `${minor}.8`, confirmed: true },
    version: {
      versionConfirmed: true,
      selectedMinor: minor,
      selectedPatch: `${minor}.8`,
      selectedChannel: `stable-${minor}`,
      selectedVersion: `${minor}.8`,
      locked: false,
    },
    methodology: { method },
    credentials: {
      pullSecretPlaceholder: '{"auths":{"quay.io":{}}}',
      sshPublicKey: "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAI test",
    },
    platformConfig: {
      aws: { region: "us-gov-west-1" },
      azure: { region: "usgovvirginia", baseDomainResourceGroupName: "dns-rg" },
      ...(overrides.platformConfig || {}),
    },
    hostInventory: {
      nodes: [
        { role: "master", hostname: "m0", primary: { type: "ethernet", name: "eno1", macAddress: "52:54:00:aa:bb:01" } },
      ],
      apiVip: "10.90.0.2",
      ingressVip: "10.90.0.3",
      machineNetworkCidr: "10.90.0.0/24",
      ipStackMode: "ipv4",
      ...(overrides.hostInventory || {}),
    },
    operators: {},
    ui: { segmentedFlowV1: true, activeStepId: "platform-specifics", visitedSteps: { "platform-specifics": true }, completedSteps: {} },
  };
}

/**
 * Per-platform render variants. These exist to reach conditional branches that
 * a single default render would miss (provisioning modes, vSphere placement
 * modes, Azure BYO-VNet). Add a variant when a new branch adds fields; the
 * structural assertions themselves never need editing.
 */
const VARIANTS = {
  "Bare Metal": [
    { label: "provisioning Managed", hostInventory: { provisioningNetwork: "Managed" } },
    { label: "provisioning Unmanaged", hostInventory: { provisioningNetwork: "Unmanaged" } },
    { label: "provisioning Disabled", hostInventory: { provisioningNetwork: "Disabled" } },
  ],
  "VMware vSphere": [
    {
      label: "failure domains",
      platformConfig: {
        vsphere: {
          placementMode: "failureDomains",
          failureDomains: [
            { name: "fd-0", region: "r", zone: "z", server: "", topology: { computeCluster: "", datacenter: "", datastore: "", networks: [], folder: "", resourcePool: "", template: "" } },
          ],
        },
      },
    },
    { label: "legacy placement", platformConfig: { vsphere: { placementMode: "legacy" } } },
  ],
  "Azure Government": [
    { label: "installer-managed vnet", platformConfig: { azure: { region: "usgovvirginia", baseDomainResourceGroupName: "dns-rg", vnetMode: "installer-managed" } } },
    {
      label: "existing vnet",
      platformConfig: {
        azure: {
          region: "usgovvirginia",
          baseDomainResourceGroupName: "dns-rg",
          vnetMode: "existing-vnet",
          virtualNetwork: "vnet",
          networkResourceGroupName: "net-rg",
          controlPlaneSubnet: "cp",
          nodeSubnets: ["w1", "w2"],
        },
      },
    },
  ],
  "AWS GovCloud": [
    { label: "default", platformConfig: { aws: { region: "us-gov-west-1", rootVolume: { type: "gp3", throughput: 2001 } } } },
  ],
};

function renderStep(state) {
  const value = { state, updateState: () => {}, loading: false, startOver: () => {}, setState: () => {} };
  return render(
    <AppContext.Provider value={value}>
      <PlatformSpecificsStep highlightErrors fieldErrors={ALL_FIELDS_INVALID} />
    </AppContext.Provider>
  );
}

/**
 * Collapsed sections do not render children, so open everything before sweeping.
 * `.field-info-icon` buttons also carry aria-expanded (long hints render as a
 * click-to-open popover), so they must be excluded or every tooltip in the step
 * opens at once.
 */
function expandEverything(container) {
  for (let pass = 0; pass < 6; pass += 1) {
    const closed = Array.from(container.querySelectorAll('button[aria-expanded="false"]')).filter(
      (btn) => !btn.classList.contains("field-info-icon")
    );
    if (closed.length === 0) return;
    closed.forEach((btn) => fireEvent.click(btn));
  }
}

const SCENARIO_MATRIX = [];
for (const [platform, byMethod] of Object.entries(SCENARIO_BY_PLATFORM_METHOD)) {
  for (const [method, scenarioId] of Object.entries(byMethod)) {
    const variants = VARIANTS[platform] || [{ label: "default" }];
    for (const variant of variants) {
      SCENARIO_MATRIX.push({ platform, method, scenarioId, variant });
    }
  }
}

describe("every rendered field keeps its badge and inline validation inside its own wrapper", () => {
  afterEach(cleanup);

  for (const minor of SUPPORTED_MINORS) {
    for (const { platform, method, scenarioId, variant } of SCENARIO_MATRIX) {
      it(`${scenarioId} @ ${minor} (${variant.label})`, () => {
        const state = baseState(platform, method, minor, variant);
        const { container } = renderStep(state);
        expandEverything(container);
        const violations = findSupportPlacementViolations(container);
        expect(
          violations,
          `${scenarioId} @ ${minor} (${variant.label}) violates the field layout contract:\n  - ${violations.join("\n  - ")}`
        ).toEqual([]);
      });
    }
  }
});

describe("version-gated badges are rendered, and rendered canonically", () => {
  afterEach(cleanup);

  const newestMinor = [...SUPPORTED_MINORS].sort().slice(-1)[0];

  it("the sweep actually exercises badges and errors (guards against a vacuous pass)", () => {
    let badges = 0;
    let errors = 0;
    for (const minor of SUPPORTED_MINORS) {
      for (const { platform, method, variant } of SCENARIO_MATRIX) {
        const { container } = renderStep(baseState(platform, method, minor, variant));
        expandEverything(container);
        badges += container.querySelectorAll("[data-version-annotation]").length;
        errors += container.querySelectorAll(".field-error").length;
        cleanup();
      }
    }
    expect(badges, "no version badge rendered anywhere — the sweep would pass vacuously").toBeGreaterThan(0);
    expect(errors, "no inline error rendered anywhere — the sweep would pass vacuously").toBeGreaterThan(0);
  });

  it(`the ${newestMinor} bare-metal provisioning gateway badge sits under its own control`, () => {
    const state = baseState("Bare Metal", "IPI", newestMinor, { hostInventory: { provisioningNetwork: "Managed" } });
    const { container } = renderStep(state);

    const badge = Array.from(container.querySelectorAll('[data-version-annotation="introduced"]')).find((el) =>
      el.textContent.includes(`New in OpenShift ${newestMinor}`)
    );
    expect(badge, `no "New in OpenShift ${newestMinor}" badge found`).toBeTruthy();

    const stack = badge.closest(".field-control-stack");
    expect(stack).not.toBeNull();
    expect(badge.closest(".field-control-support").parentElement).toBe(stack);

    // Same cell as the control it annotates, and the error sits above it.
    const input = stack.querySelector("input");
    expect(input).not.toBeNull();
    expect(input.getAttribute("placeholder")).toBe("e.g. 172.22.0.254");

    const error = stack.querySelector(".field-error");
    expect(error).not.toBeNull();
    expect(error.closest(".field-control-support")).toBe(badge.closest(".field-control-support"));
    expect(
      error.compareDocumentPosition(badge) & Node.DOCUMENT_POSITION_FOLLOWING,
      "canonical band order is control -> validation message -> New in badge -> helper"
    ).toBeTruthy();

    // The stack is the grid participant; the badge is not.
    const grid = stack.parentElement;
    expect(grid.classList.contains("field-grid")).toBe(true);
    expect(Array.from(grid.children)).toContain(stack);
    expect(Array.from(grid.children)).not.toContain(badge);
  });
});

describe("R5: every badged field's tooltip states its provenance, read from catalog metadata", () => {
  afterEach(cleanup);

  for (const minor of SUPPORTED_MINORS) {
    for (const { platform, method, scenarioId, variant } of SCENARIO_MATRIX) {
      it(`${scenarioId} @ ${minor} (${variant.label})`, () => {
        const { container } = renderStep(baseState(platform, method, minor, variant));
        expandEverything(container);

        const badges = Array.from(container.querySelectorAll('[data-version-annotation="introduced"]'));
        for (const badge of badges) {
          const stack = badge.closest(".field-control-stack");
          expect(stack, `badge has no .field-control-stack: ${describeNode(badge)}`).not.toBeNull();

          const icon = stack.querySelector("button.field-info-icon");
          expect(
            icon,
            `a version-gated field carries a "New in" badge but offers no tooltip: ${describeNode(badge)}`
          ).not.toBeNull();

          fireEvent.click(icon);
          const panels = document.body.querySelectorAll(".field-help-popover-content, .field-tooltip-content");
          expect(panels.length, "expected exactly one open tooltip").toBe(1);
          const text = panels[0].textContent || "";
          expect(
            text.startsWith("Introduced in OpenShift "),
            `tooltip for a version-gated field must open with the provenance prefix read from catalog metadata (R5). Got: "${text.slice(0, 90)}…"`
          ).toBe(true);
          // Provenance must be the field's own introduction minor, supplied by
          // fieldIntroducedIn() — never a literal baked into the copy.
          expect(text).toMatch(/^Introduced in OpenShift \d+\.\d+\./);
          fireEvent.click(icon);
        }
      });
    }
  }
});

describe("source-level and CSS invariants behind the contract", () => {
  it("no field in PlatformSpecificsStep wraps support content in a bare fragment", () => {
    const violations = findFragmentWrappedSupport(stepSrc);
    expect(violations, violations.join("\n")).toEqual([]);
  });

  it("the inline-error colour is attached to the class, not only to its DOM position", () => {
    // Base rule: a misplaced error can never render as plain body text.
    expect(css).toMatch(/\n\.field-error\s*\{[^}]*color:\s*var\(--error-color/);
    // Historical scoped rule kept (vsphere-server-error-presentation.test.jsx relies on it).
    expect(css).toContain(".platform-specifics .field-control-stack .field-error");
  });

  it("the version badge uses the semantic token, not a literal colour", () => {
    const idx = css.indexOf('[data-version-annotation="introduced"] {');
    expect(idx).toBeGreaterThan(-1);
    const body = css.slice(css.indexOf("{", idx), css.indexOf("}", idx));
    expect(body).toMatch(/color:\s*var\(--version-introduced-text/);
  });

  it(".field-control-stack is the subgrid cell that keeps neighbouring fields aligned", () => {
    const idx = css.indexOf("> .field-control-stack {");
    expect(idx).toBeGreaterThan(-1);
    const body = css.slice(css.indexOf("{", idx), css.indexOf("}", idx));
    expect(body).toMatch(/grid-row:\s*span 3/);
    expect(body).toMatch(/grid-template-rows:\s*subgrid/);
  });

  it("no JSX in PlatformSpecificsStep uses an error class that has no CSS rule", () => {
    // `.note.error` shipped for months with no stylesheet rule, so the BMC CA
    // error rendered in neutral grey. Keep that class out unless it is defined.
    const usesNoteError = /className="note error"/.test(stepSrc);
    const definesNoteError = /\.note\.error\b/.test(css);
    expect(usesNoteError && !definesNoteError).toBe(false);
  });
});
