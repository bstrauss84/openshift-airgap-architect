/**
 * OpenShift Airgap Architect - Card Header Component
 *
 * Card header with optional subtitle and optional collapse icon (top-right).
 * Supports collapsible sections with accessibility attributes.
 *
 * @author Bill Strauss
 *
 * Developed with AI assistance from Claude (Anthropic) and Cursor AI.
 */
import React from "react";

/**
 * Card header with optional subtitle and optional collapse icon (top-right).
 * Use with card-header-with-collapse when collapsible; collapse control is icon-only.
 */
function CardHeader({
  title,
  subtitle,
  collapsed,
  onToggleCollapse,
  ariaLabel,
  children,
}) {
  const hasCollapse = typeof collapsed === "boolean" && typeof onToggleCollapse === "function";

  return (
    <div className={hasCollapse ? "card-header-with-collapse" : "card-header"}>
      <div className="card-header-main">
        {title ? <h3 className="card-title">{title}</h3> : null}
        {subtitle ? <p className="card-subtitle">{subtitle}</p> : null}
        {children}
      </div>
      {hasCollapse ? (
        <button
          type="button"
          className="card-header-collapse-btn"
          onClick={onToggleCollapse}
          aria-expanded={!collapsed}
          aria-label={ariaLabel || (collapsed ? `Expand ${title}` : `Collapse ${title}`)}
        >
          <span className="card-header-chevron" aria-hidden>
            {collapsed ? "▶" : "▼"}
          </span>
        </button>
      ) : null}
    </div>
  );
}

export default CardHeader;
