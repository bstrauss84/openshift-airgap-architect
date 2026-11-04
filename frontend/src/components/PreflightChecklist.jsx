/**
 * OpenShift Airgap Architect - oc-mirror preflight checklist (v2.2.0 M5)
 *
 * Renders the structured `items` the shared preflight service returns, for
 * Install "Run oc-mirror" and Mirroring alike: every check that ran, not only
 * the failures. Each status is spelled out in text ("Passed", "Blocked", …)
 * next to a symbol, so nothing depends on colour; "Not verified" is shown as
 * its own state and never as a pass.
 *
 * @author Bill Strauss
 *
 * Developed with AI assistance from Claude (Anthropic).
 */
import React from "react";

export const PREFLIGHT_STATUS_META = {
  block: { label: "Blocked", symbol: "✕", tone: "error" },
  warn: { label: "Warning", symbol: "!", tone: "warning" },
  unverified: { label: "Not verified", symbol: "?", tone: "unverified" },
  pass: { label: "Passed", symbol: "✓", tone: "ok" },
  info: { label: "Info", symbol: "i", tone: "info" }
};

const ORDER = ["block", "warn", "unverified", "pass", "info"];

/** "2 blocked, 1 warning, 7 passed" — counts in reading order. */
export const summarizePreflight = (items) => ORDER
  .map((st) => [st, items.filter((i) => i.status === st).length])
  .filter(([, n]) => n)
  .map(([st, n]) => `${n} ${PREFLIGHT_STATUS_META[st].label.toLowerCase()}`)
  .join(", ");

/**
 * @param {{ items: Array<{ id: string, status: string, label: string, detail: string }>, ok: boolean, title?: string }} props
 */
export default function PreflightChecklist({ items = [], ok, title = "Preflight results" }) {
  if (!items.length) return null;
  const headingId = `preflight-checklist-${items[0].id}`;
  return (
    <section className="preflight-checklist" aria-labelledby={headingId}>
      <h4 id={headingId} className="preflight-checklist-title">{title}</h4>
      <p className="preflight-checklist-summary" role="status">
        <strong>{ok ? "Ready to run." : "Not ready to run."}</strong> {summarizePreflight(items)}.
      </p>
      <ul className="preflight-checklist-items">
        {items.map((it) => {
          const meta = PREFLIGHT_STATUS_META[it.status] || PREFLIGHT_STATUS_META.info;
          return (
            <li key={it.id} className={`preflight-item tone-${meta.tone}`}>
              <span className="preflight-item-status">
                <span aria-hidden="true" className="preflight-item-symbol">{meta.symbol}</span> {meta.label}
              </span>
              <span className="preflight-item-body">
                <span className="preflight-item-label">{it.label}</span>
                <span className="preflight-item-detail">{it.detail}</span>
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
