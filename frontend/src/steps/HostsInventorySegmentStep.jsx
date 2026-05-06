/**
 * OpenShift Airgap Architect - Host Inventory Segment Step
 *
 * Sixth step in the segmented flow: Hosts / Inventory.
 * Renders Hosts v2 when the scenario has host inventory (e.g. bare-metal-agent, bare-metal-ipi);
 * otherwise shows placeholder that host inventory is not applicable.
 *
 * @author Bill Strauss
 *
 * Developed with AI assistance from Claude (Anthropic) and Cursor AI.
 */
import React from "react";
import { useApp } from "../store.jsx";
import HostInventoryV2Step from "./HostInventoryV2Step.jsx";
import { getScenarioId, SCENARIO_IDS_WITH_HOST_INVENTORY } from "../hostInventoryV2Helpers.js";

/**
 * Sixth step in the segmented flow: Hosts / Inventory.
 * Renders Hosts v2 when the scenario has host inventory in this app (e.g. bare-metal-agent, bare-metal-ipi);
 * otherwise a placeholder that host inventory is not applicable.
 */
export default function HostsInventorySegmentStep(props) {
  const { state } = useApp();
  const platform = state?.blueprint?.platform;
  const method = state?.methodology?.method;
  const scenarioId = getScenarioId(platform, method);
  const hasHostInventory = Boolean(scenarioId && SCENARIO_IDS_WITH_HOST_INVENTORY.includes(scenarioId));

  if (hasHostInventory) {
    return <HostInventoryV2Step {...props} />;
  }

  return (
    <div className="card">
      <div className="card-header">
        <h2>Hosts / Inventory</h2>
      </div>
      <p className="note">Host inventory not applicable for this scenario.</p>
    </div>
  );
}
