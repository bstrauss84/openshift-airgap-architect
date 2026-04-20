/**
 * Pure wizard step ordering (no React components). Used by App.jsx and import navigation
 * so run imports use the same visible step list as the live wizard.
 */

import { getScenarioId } from "./catalogResolver.js";
import { SCENARIO_IDS_WITH_HOST_INVENTORY } from "./hostInventoryV2Helpers.js";
import { validateStep } from "./validation.js";

const FALLBACK_WIZARD_ROWS = [
  { id: "blueprint", label: "Blueprint", subSteps: [] },
  { id: "methodology", label: "Methodology", subSteps: [] },
  {
    id: "global",
    label: "Global Strategy",
    subSteps: [
      { id: "network-wide", label: "Network-wide" },
      { id: "vips-ingress", label: "VIPs and ingress" },
      { id: "dhcp-static", label: "DHCP vs Static plan" },
      { id: "advanced-networking", label: "Advanced networking", collapsedByDefault: true }
    ]
  },
  { id: "inventory", label: "Host Inventory", subSteps: [] },
  { id: "operators", label: "Operators", subSteps: [] },
  { id: "review", label: "Assets & Guide", subSteps: [] },
  { id: "run-oc-mirror", label: "Run oc-mirror", subSteps: [] },
  { id: "operations", label: "Operations", subSteps: [] }
];

const SEGMENTED_REPLACEMENT_ROWS = [
  { id: "identity-access", label: "Identity & Access" },
  { id: "networking-v2", label: "Networking" },
  { id: "connectivity-mirroring", label: "Connectivity & Mirroring" },
  { id: "trust-proxy", label: "Trust & Proxy" },
  { id: "platform-specifics", label: "Platform Specifics" },
  { id: "hosts-inventory", label: "Hosts / Inventory" }
];

function buildWizardRowsFromMap(stepMap) {
  if (!stepMap?.mvpSteps?.length) return FALLBACK_WIZARD_ROWS.slice();
  const wizard = stepMap.mvpSteps
    .filter((s) => s.stepNumber >= 1)
    .map((s) => ({
      id: s.id,
      label: s.label,
      subSteps: s.subSteps || []
    }));
  return wizard.length ? wizard : FALLBACK_WIZARD_ROWS.slice();
}

/**
 * @param {object} state - app state
 * @param {object} stepMap - API step map (may be empty before load)
 * @returns {{ id: string, label: string, subSteps: object[] }[]}
 */
export function computeVisibleWizardRows(state, stepMap) {
  const map = stepMap || {};
  const segmentedFlowV1 = state?.ui?.segmentedFlowV1 === true;
  const hostInventoryV2Enabled = state?.ui?.hostInventoryV2 === true;
  const scenarioId = getScenarioId(state);
  const showHostInventory = Boolean(scenarioId && SCENARIO_IDS_WITH_HOST_INVENTORY.includes(scenarioId));
  const base = buildWizardRowsFromMap(map);

  if (segmentedFlowV1) {
    const blueprintStep = base.find((s) => s.id === "blueprint");
    const methodologyStep = base.find((s) => s.id === "methodology");
    const operatorsStep = base.find((s) => s.id === "operators");
    const reviewStep = base.find((s) => s.id === "review");
    const runOcMirrorStep = base.find((s) => s.id === "run-oc-mirror");
    const operationsStep = base.find((s) => s.id === "operations");
    const showHostsStep = scenarioId && SCENARIO_IDS_WITH_HOST_INVENTORY.includes(scenarioId);
    const replacementRows = SEGMENTED_REPLACEMENT_ROWS.filter(
      (def) => def.id !== "hosts-inventory" || showHostsStep
    ).map((def) => ({
      id: def.id,
      label: def.label,
      subSteps: []
    }));
    const steps = [
      blueprintStep || FALLBACK_WIZARD_ROWS[0],
      methodologyStep || FALLBACK_WIZARD_ROWS[1],
      ...replacementRows,
      operatorsStep || FALLBACK_WIZARD_ROWS[4],
      reviewStep || FALLBACK_WIZARD_ROWS[5],
      runOcMirrorStep || FALLBACK_WIZARD_ROWS[6],
      operationsStep || FALLBACK_WIZARD_ROWS[7]
    ];
    return steps.map((s, i) => ({
      id: s.id,
      label: s.label,
      subSteps: s.subSteps || [],
      stepNumber: i + 1
    }));
  }

  let visible = showHostInventory ? base : base.filter((s) => s.id !== "inventory");
  if (showHostInventory && hostInventoryV2Enabled) {
    const invIdx = visible.findIndex((s) => s.id === "inventory");
    const v2Step = { id: "inventory-v2", label: "Hosts (New)", subSteps: [] };
    visible =
      invIdx >= 0
        ? [...visible.slice(0, invIdx + 1), v2Step, ...visible.slice(invIdx + 1)]
        : [...visible, v2Step];
  }
  return visible.map((s, i) => ({
    id: s.id,
    label: s.label,
    subSteps: s.subSteps || [],
    stepNumber: i + 1
  }));
}

/**
 * First step index that has validation errors or a stale review flag (sidebar “needs review”).
 * @param {{ id: string }[]} visibleRows
 * @param {object} state
 * @returns {number} index or -1 if none
 */
export function findFirstAttentionStepIndex(visibleRows, state) {
  if (!visibleRows?.length || !state) return -1;
  for (let i = 0; i < visibleRows.length; i++) {
    const id = visibleRows[i].id;
    const errs = validateStep(state, id).errors || [];
    if (errs.length) return i;
    if (state.reviewFlags?.[id]) return i;
  }
  return -1;
}
