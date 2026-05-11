/**
 * OpenShift Airgap Architect - Scenario Header Panel Component
 *
 * Collapsible scenario header for segmented flow: scenario name, OCP version,
 * live-updating configuration summary, "This will generate" list, and dynamic
 * documentation links based on confirmed wizard tabs.
 * Uses frontend copy from frontend/src/data/docs-index/.
 *
 * @author Bill Strauss
 *
 * Developed with AI assistance from Claude (Anthropic) and Cursor AI.
 */
import React, { useState, useMemo } from "react";
import { getScenarioId } from "../hostInventoryV2Helpers.js";
import {
  getConfirmedTabs,
  buildIdentitySummary,
  buildNetworkingSummary,
  buildConnectivitySummary,
  buildTrustProxySummary,
  buildPlatformSummary,
  buildHostInventorySummary,
  buildOperatorsSummary,
  buildDocumentationSources
} from "../scenarioSummaryHelpers.js";

import docsIndex420 from "../data/docs-index/4.20.json";

/**
 * Scenario header panel for the segmented flow: scenario name, OCP version,
 * live-updating configuration summary, "This will generate" list, and dynamic
 * doc links based on confirmed tabs.
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

  // Track which tabs are confirmed (visited, not flagged for review, validation passes)
  const confirmedTabs = useMemo(() => getConfirmedTabs(state), [state]);

  // Build configuration summaries (only for confirmed tabs)
  const identitySummary = useMemo(() =>
    confirmedTabs.includes('identity-access') ? buildIdentitySummary(state) : null,
    [state, confirmedTabs]
  );

  const networkingSummary = useMemo(() =>
    confirmedTabs.includes('networking-v2') ? buildNetworkingSummary(state) : null,
    [state, confirmedTabs]
  );

  const connectivitySummary = useMemo(() =>
    confirmedTabs.includes('connectivity-mirroring') ? buildConnectivitySummary(state) : null,
    [state, confirmedTabs]
  );

  const trustProxySummary = useMemo(() =>
    confirmedTabs.includes('trust-proxy') ? buildTrustProxySummary(state) : null,
    [state, confirmedTabs]
  );

  const platformSummary = useMemo(() =>
    confirmedTabs.includes('platform-specifics') ? buildPlatformSummary(state) : null,
    [state, confirmedTabs]
  );

  const hostInventorySummary = useMemo(() =>
    confirmedTabs.includes('hosts-inventory') || confirmedTabs.includes('platform-specifics') ? buildHostInventorySummary(state) : null,
    [state, confirmedTabs]
  );

  const operatorsSummary = useMemo(() =>
    confirmedTabs.includes('operators') ? buildOperatorsSummary(state) : null,
    [state, confirmedTabs]
  );

  // Check if we have any configuration summaries to display
  const hasConfigSummary = !!(
    identitySummary || networkingSummary || connectivitySummary ||
    trustProxySummary || platformSummary || hostInventorySummary || operatorsSummary
  );

  const generates = [];
  generates.push("install-config.yaml");
  if (scenarioId === "bare-metal-agent" || scenarioId === "vsphere-agent") generates.push("agent-config.yaml");
  if (scenarioId === "bare-metal-ipi") {
    // IPI uses install-config only for cluster-level; hosts in install-config
  }
  generates.push("imageset-config.yaml (if mirroring)");

  // Build dynamic documentation sources based on confirmed configuration
  const docs = useMemo(() =>
    buildDocumentationSources(state, confirmedTabs, docsIndex),
    [state, confirmedTabs, docsIndex]
  );

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

          {hasConfigSummary ? (
            <>
              <dt>Configuration Summary</dt>
              <dd>
                <div className="scenario-summary-scroll-container">
                  {identitySummary ? (
                    <div className="scenario-summary-section">
                      <strong>Identity &amp; Security</strong>
                      <ul className="list-inline">
                        {identitySummary.map((item, idx) => (
                          <li key={idx}>{item}</li>
                        ))}
                      </ul>
                    </div>
                  ) : null}

                  {networkingSummary ? (
                    <div className="scenario-summary-section">
                      <strong>Networking</strong>
                      <ul className="list-inline">
                        {networkingSummary.map((item, idx) => (
                          <li key={idx}>{item}</li>
                        ))}
                      </ul>
                    </div>
                  ) : null}

                  {connectivitySummary ? (
                    <div className="scenario-summary-section">
                      <strong>Connectivity &amp; Mirroring</strong>
                      <ul className="list-inline">
                        {connectivitySummary.map((item, idx) => (
                          <li key={idx}>{item}</li>
                        ))}
                      </ul>
                    </div>
                  ) : null}

                  {trustProxySummary ? (
                    <div className="scenario-summary-section">
                      <strong>Trust &amp; Proxy</strong>
                      <ul className="list-inline">
                        {trustProxySummary.map((item, idx) => (
                          <li key={idx}>{item}</li>
                        ))}
                      </ul>
                    </div>
                  ) : null}

                  {platformSummary ? (
                    <div className="scenario-summary-section">
                      <strong>Platform Configuration</strong>
                      <ul className="list-inline">
                        {platformSummary.map((item, idx) => (
                          <li key={idx}>{item}</li>
                        ))}
                      </ul>
                    </div>
                  ) : null}

                  {hostInventorySummary ? (
                    <div className="scenario-summary-section">
                      <strong>Hosts &amp; Inventory</strong>
                      <ul className="list-inline">
                        {hostInventorySummary.map((item, idx) => (
                          <li key={idx}>{item}</li>
                        ))}
                      </ul>
                    </div>
                  ) : null}

                  {operatorsSummary ? (
                    <div className="scenario-summary-section">
                      <strong>Operators</strong>
                      <ul className="list-inline">
                        {operatorsSummary.map((item, idx) => (
                          <li key={idx}>{item}</li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                </div>
              </dd>
            </>
          ) : null}

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
                  {docs.map((doc, idx) => (
                    <li key={doc.id || doc.url || idx}>
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
