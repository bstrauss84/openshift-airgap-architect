import React, { useState } from "react";
import { getScenarioId } from "../hostInventoryV2Helpers.js";

import docsIndex420 from "../data/docs-index/4.20.json";

/**
 * Scenario header panel for the segmented flow: scenario name, OCP version,
 * "This will generate" list, and doc links from the docs index.
 * Collapsible: default collapsed; click bar to expand/collapse.
 * Uses frontend copy from frontend/src/data/docs-index/ (see docs/DATA_AND_FRONTEND_COPIES.md).
 */
export default function ScenarioHeaderPanel({ state }) {
  const [expanded, setExpanded] = useState(false);
  const docsIndex = docsIndex420;
  const platform = state?.blueprint?.platform || "";
  const method = state?.methodology?.method || "";
  const scenarioName = [platform, method].filter(Boolean).join(", ") || "—";
  const version = state?.version?.selectedVersion || state?.release?.patchVersion || docsIndex?.version || "4.20";
  const scenarioId = getScenarioId(platform, method);
  const scenarioMeta = scenarioId && docsIndex?.scenarios?.[scenarioId];

  const generates = [];
  generates.push("install-config.yaml");
  if (scenarioId === "bare-metal-agent" || scenarioId === "vsphere-agent") generates.push("agent-config.yaml");
  if (scenarioId === "bare-metal-ipi") {
    // IPI uses install-config only for cluster-level; hosts in install-config
  }
  generates.push("imageset-config.yaml (if mirroring)");

  const docs = scenarioMeta?.docs || [];

  return (
    <div className="card scenario-header-panel host-inventory-v2-gather-info" role="region" aria-label="Scenario summary">
      <button
        type="button"
        className="host-inventory-v2-gather-info-header"
        onClick={() => setExpanded((e) => !e)}
        aria-expanded={expanded}
        aria-label={expanded ? "Collapse scenario summary" : "Expand scenario summary"}
      >
        <span className="host-inventory-v2-gather-info-title">
          <span className="host-inventory-v2-gather-info-chevron" aria-hidden>{expanded ? "▼" : "▶"}</span>
          Scenario summary
        </span>
        <span className="host-inventory-v2-gather-info-expand-label" aria-hidden>
          {expanded ? "Collapse" : "Expand"}
        </span>
      </button>
      {expanded ? (
        <div className="host-inventory-v2-gather-info-body">
        <dl className="scenario-header-dl">
          <dt>Scenario</dt>
          <dd>{scenarioName}</dd>
          <dt>Target OCP version</dt>
          <dd>{version}</dd>
          <dt>This will generate</dt>
          <dd>
            <ul className="list-inline">
              {generates.map((g) => (
                <li key={g}>{g}</li>
              ))}
            </ul>
          </dd>
          {docs.length > 0 ? (
            <>
              <dt>Documentation</dt>
              <dd>
                <ul className="list-inline">
                  {docs.map((doc) => (
                    <li key={doc.id}>
                      <a href={doc.url} target="_blank" rel="noopener noreferrer">
                        {doc.title}
                      </a>
                    </li>
                  ))}
                </ul>
              </dd>
            </>
          ) : null}
        </dl>
        </div>
      ) : null}
    </div>
  );
}
