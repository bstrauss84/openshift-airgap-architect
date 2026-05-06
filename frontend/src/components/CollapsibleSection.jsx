/**
 * OpenShift Airgap Architect - Collapsible Section Component
 *
 * Unified collapsible section with consistent header styling, chevron, and hover states.
 * Used for all collapsible sections app-wide.
 *
 * @author Bill Strauss
 *
 * Developed with AI assistance from Claude (Anthropic) and Cursor AI.
 */
import React, { useState } from "react";

/**
 * Unified collapsible: matches "How to gather host info from nodes" exactly (header row, chevron, hover, spacing).
 * Use for all collapsible sections app-wide. Renders section.card.host-inventory-v2-gather-info by default.
 */
function CollapsibleSection({
  title,
  subtitle,
  defaultCollapsed = true,
  children,
  "aria-label": ariaLabel,
  wrapInCard = true,
  className = ""
}) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed);
  const expanded = !collapsed;

  const content = (
    <>
      <button
        type="button"
        className="host-inventory-v2-gather-info-header"
        onClick={() => setCollapsed((c) => !c)}
        aria-expanded={expanded}
        aria-label={ariaLabel || (expanded ? `Collapse ${title}` : `Expand ${title}`)}
      >
        <span className="host-inventory-v2-gather-info-title">
          <span className="host-inventory-v2-gather-info-chevron" aria-hidden>
            {expanded ? "▼" : "▶"}
          </span>
          {title}
        </span>
        <span className="host-inventory-v2-gather-info-expand-label" aria-hidden>
          {expanded ? "Collapse" : "Expand"}
        </span>
      </button>
      {expanded ? (
        <div className="host-inventory-v2-gather-info-body">
          {subtitle ? <p className="card-subtitle" style={{ marginTop: 0, marginBottom: 12 }}>{subtitle}</p> : null}
          {children}
        </div>
      ) : null}
    </>
  );

  if (wrapInCard) {
    return (
      <section className={`card host-inventory-v2-gather-info ${className}`.trim()} style={{ marginBottom: 20 }}>
        {content}
      </section>
    );
  }

  return (
    <div className={`host-inventory-v2-gather-info ${className}`.trim()} style={{ marginTop: 16, marginBottom: 0 }}>
      {content}
    </div>
  );
}

export default CollapsibleSection;
