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
import React, { useState, useMemo, useRef, useCallback } from "react";
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
 * Resizable: drag handle at bottom to adjust height.
 * Uses frontend copy from frontend/src/data/docs-index/ (see docs/DATA_AND_FRONTEND_COPIES.md).
 */
export default function ScenarioHeaderPanel({ state }) {
  const [expanded, setExpanded] = useState(false);
  const [panelHeight, setPanelHeight] = useState(300); // Default height in pixels
  const [isResizing, setIsResizing] = useState(false);
  const panelRef = useRef(null);
  const startYRef = useRef(0);
  const startHeightRef = useRef(0);

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

  // Resize handle mouse down
  const handleMouseDown = useCallback((e) => {
    e.preventDefault();
    setIsResizing(true);
    startYRef.current = e.clientY;
    startHeightRef.current = panelHeight;
  }, [panelHeight]);

  // Mouse move handler
  const handleMouseMove = useCallback((e) => {
    if (!isResizing) return;
    const delta = e.clientY - startYRef.current;
    const newHeight = Math.max(150, Math.min(800, startHeightRef.current + delta));
    setPanelHeight(newHeight);
  }, [isResizing]);

  // Mouse up handler
  const handleMouseUp = useCallback(() => {
    setIsResizing(false);
  }, []);

  // Add/remove mouse event listeners
  React.useEffect(() => {
    if (isResizing) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      return () => {
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
      };
    }
  }, [isResizing, handleMouseMove, handleMouseUp]);

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
        <>
          <div
            ref={panelRef}
            className="scenario-summary-body-scrollable"
            style={{ height: `${panelHeight}px`, overflow: 'auto' }}
          >
            <dl className="scenario-header-dl">
              <div className="scenario-summary-row">
                <dt>Scenario</dt>
                <dd>{scenarioName}</dd>
              </div>

              <div className="scenario-summary-row">
                <dt>Target OCP version</dt>
                <dd>{version}</dd>
              </div>

              {hasConfigSummary ? (
                <div className="scenario-summary-row">
                  <dt>Configuration</dt>
                  <dd>
                    {identitySummary ? (
                      <div className="scenario-summary-section">
                        <div className="scenario-summary-category">Identity &amp; Security</div>
                        {identitySummary.map((item, idx) => (
                          <div key={idx} className="scenario-summary-item">{item}</div>
                        ))}
                      </div>
                    ) : null}

                    {networkingSummary ? (
                      <div className="scenario-summary-section">
                        <div className="scenario-summary-category">Networking</div>
                        {networkingSummary.map((item, idx) => (
                          <div key={idx} className="scenario-summary-item">{item}</div>
                        ))}
                      </div>
                    ) : null}

                    {connectivitySummary ? (
                      <div className="scenario-summary-section">
                        <div className="scenario-summary-category">Connectivity &amp; Mirroring</div>
                        {connectivitySummary.map((item, idx) => (
                          <div key={idx} className="scenario-summary-item">{item}</div>
                        ))}
                      </div>
                    ) : null}

                    {trustProxySummary ? (
                      <div className="scenario-summary-section">
                        <div className="scenario-summary-category">Trust &amp; Proxy</div>
                        {trustProxySummary.map((item, idx) => (
                          <div key={idx} className="scenario-summary-item">{item}</div>
                        ))}
                      </div>
                    ) : null}

                    {platformSummary ? (
                      <div className="scenario-summary-section">
                        <div className="scenario-summary-category">Platform Configuration</div>
                        {platformSummary.map((item, idx) => (
                          <div key={idx} className="scenario-summary-item">{item}</div>
                        ))}
                      </div>
                    ) : null}

                    {hostInventorySummary ? (
                      <div className="scenario-summary-section">
                        <div className="scenario-summary-category">Hosts &amp; Inventory</div>
                        {hostInventorySummary.map((item, idx) => (
                          <div key={idx} className="scenario-summary-item">{item}</div>
                        ))}
                      </div>
                    ) : null}

                    {operatorsSummary ? (
                      <div className="scenario-summary-section">
                        <div className="scenario-summary-category">Operators</div>
                        {operatorsSummary.map((item, idx) => (
                          <div key={idx} className="scenario-summary-item">{item}</div>
                        ))}
                      </div>
                    ) : null}
                  </dd>
                </div>
              ) : null}

              <div className="scenario-summary-row">
                <dt>Generates</dt>
                <dd>
                  {generates.map((g) => (
                    <div key={g} className="scenario-summary-item">{g}</div>
                  ))}
                </dd>
              </div>

              {docs.length > 0 ? (
                <div className="scenario-summary-row">
                  <dt>Documentation</dt>
                  <dd>
                    {docs.map((doc, idx) => (
                      <div key={doc.id || doc.url || idx} className="scenario-summary-item">
                        <a href={doc.url} target="_blank" rel="noopener noreferrer">
                          {doc.title}
                        </a>
                      </div>
                    ))}
                  </dd>
                </div>
              ) : null}
            </dl>
          </div>
          <div
            className={`scenario-summary-resize-handle ${isResizing ? 'resizing' : ''}`}
            onMouseDown={handleMouseDown}
            role="separator"
            aria-label="Resize scenario summary"
            aria-orientation="horizontal"
          >
            <div className="scenario-summary-resize-grip" aria-hidden></div>
          </div>
        </>
      ) : null}
    </div>
  );
}
