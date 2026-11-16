/**
 * OpenShift Airgap Architect - operator catalog browser (v2.2.0 M3)
 *
 * The Red Hat / Certified / Community tabs and the operator card grid that the
 * Install Operators step has always shown, extracted so Mirroring shares them,
 * plus interactive search (A14). Presentation only: the host owns catalogs,
 * selection and what "Add" does.
 *
 * Search matches display name and package name. Each tab shows its own match
 * count while a query is active, and an "All matches" view groups hits by
 * catalog, so a package that exists in more than one catalog is visible as
 * such. Already-selected operators are listed by the host's selected panel and
 * are never removed by searching.
 *
 * @author Bill Strauss
 *
 * Developed with AI assistance from Claude (Anthropic).
 */
import React, { useMemo, useState } from "react";
import FieldLabelWithInfo from "../FieldLabelWithInfo.jsx";
import {
  OPERATOR_CATALOG_IDS,
  OPERATOR_CATALOG_LABELS,
  filterOperatorCatalogs
} from "../../shared/operatorSearch.js";

const SEARCH_HINT = `Filter the operator list by display name or package name.

**What it matches:**
The human-readable name (for example "Web Terminal") and the canonical package name used in the ImageSetConfiguration (for example web-terminal). Every word you type must appear.

**Scope:**
While you type, each catalog tab shows how many operators match, and "All matches" lists the hits from every catalog grouped by catalog. The same package can exist in more than one catalog with different publishers.

**Important notes:**
• Searching only changes what is listed. Selected operators stay selected and stay in the Selected list.
• The list comes from the scanned catalogs for the current OpenShift minor; an operator that is not in those catalogs cannot be found here.`;

const OperatorCard = ({ op, onSelect }) => (
  <button type="button" className="operator-card" onClick={() => onSelect(op)}>
    {/* Human-readable displayName leads; `op.name` stays the canonical
        package identifier used for selection, state and generation. */}
    <div className="operator-name">{op.displayName || op.name}</div>
    {op.displayName ? <div className="subtle">Package: {op.name}</div> : null}
    <div className="subtle">Default channel: {op.defaultChannel || "unknown"}</div>
    <span className="operator-add">Add</span>
  </button>
);

const OperatorCatalogBrowser = ({ catalogs, selectedIds = new Set(), onSelect, loading = false, idPrefix = "operators", title = "Available operators" }) => {
  const [activeTab, setActiveTab] = useState("redhat");
  const [query, setQuery] = useState("");
  const searching = query.trim().length > 0;
  const filtered = useMemo(() => filterOperatorCatalogs(catalogs, query, selectedIds), [catalogs, query, selectedIds]);
  const totalMatches = OPERATOR_CATALOG_IDS.reduce((n, id) => n + filtered[id].length, 0);
  const tab = !searching && activeTab === "all" ? "redhat" : activeTab;
  const tabs = searching ? [...OPERATOR_CATALOG_IDS, "all"] : OPERATOR_CATALOG_IDS;
  const label = (id) => (id === "all" ? "All matches" : OPERATOR_CATALOG_LABELS[id]);
  const count = (id) => (id === "all" ? totalMatches : filtered[id].length);

  return (
    <div className="operator-catalog-browser" role="group" aria-labelledby={`${idPrefix}-browser-title`}>
      <h4 className="operator-browser-title" id={`${idPrefix}-browser-title`}>{title}</h4>
      {/* Search sits with the catalog results it filters (owner M3 feedback):
          a short placeholder that never clips, and a width that grows with the card. */}
      <div className="operator-search-field">
        <FieldLabelWithInfo label="Search operators" hint={SEARCH_HINT}>
          <input
            type="search"
            id={`${idPrefix}-operator-search`}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by name or package"
            autoComplete="off"
          />
        </FieldLabelWithInfo>
      </div>
      <div className="tabs" role="tablist" aria-label="Operator catalogs">
        {tabs.map((id) => (
          <button
            key={id}
            type="button"
            role="tab"
            id={`${idPrefix}-tab-${id}`}
            aria-selected={tab === id}
            aria-controls={`${idPrefix}-tabpanel`}
            className={`tab ${tab === id ? "active" : ""}`}
            onClick={() => setActiveTab(id)}
          >
            {label(id)}
            {searching ? ` (${count(id)})` : ""}
          </button>
        ))}
      </div>
      <div className="operator-scroll" role="tabpanel" id={`${idPrefix}-tabpanel`} aria-labelledby={`${idPrefix}-tab-${tab}`}>
        {loading && !(catalogs?.[tab] || []).length ? <div className="loading" role="status">Loading operators…</div> : null}
        {searching && count(tab) === 0 ? (
          <div className="subtle" role="status">No operators match &ldquo;{query.trim()}&rdquo; in {tab === "all" ? "any catalog" : label(tab)}.</div>
        ) : null}
        {tab === "all" ? (
          OPERATOR_CATALOG_IDS.filter((id) => filtered[id].length).map((id) => (
            <div key={id} className="operator-match-group">
              <h4 className="operator-match-group-title">{OPERATOR_CATALOG_LABELS[id]} ({filtered[id].length})</h4>
              <div className="operator-grid">
                {filtered[id].map((op) => <OperatorCard key={op.id} op={op} onSelect={onSelect} />)}
              </div>
            </div>
          ))
        ) : (
          <div className="operator-grid">
            {filtered[tab].map((op) => <OperatorCard key={op.id} op={op} onSelect={onSelect} />)}
          </div>
        )}
      </div>
    </div>
  );
};

export default OperatorCatalogBrowser;
