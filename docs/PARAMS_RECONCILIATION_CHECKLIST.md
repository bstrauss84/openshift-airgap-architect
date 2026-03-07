# Params reconciliation checklist (scenario-by-scenario)

Use this checklist when reconciling a scenario’s params catalog against official OpenShift install-config (or agent-config) documentation.

**Scope:** One (platform, version, install method) scenario per run (e.g. vSphere 4.20 IPI).

---

## 1. Doc source

- [ ] Identify the **authoritative parameter page** for the scenario (e.g. installation-config-parameters-vsphere for vSphere).
- [ ] Identify **shared doc** pages that contribute generic params (e.g. platform-agnostic, Agent-based install-config tables).
- [ ] Note **sections** that apply: required, network, optional, platform-specific, deprecated, machine-pool.

---

## 2. Params from docs

- [ ] List every **parameter path** mentioned in the doc tables (e.g. platform.vsphere.vcenters, platform.vsphere.failureDomains[].topology.template).
- [ ] For each, record: **required** (yes/no), **allowed values** or type, **default** if stated, **conditional** (e.g. “IPI only”, “omit when external LB”), **deprecated** and **replacement** if any.

---

## 3. Params in catalog

- [ ] Open the scenario’s params file: `data/params/<version>/<scenario>.json` or frontend copy `frontend/src/data/catalogs/<scenario>.json`.
- [ ] List every **path** in the catalog that applies to this scenario (filter by applies_to or scenarioId).

---

## 4. Diff

- [ ] **In doc, not in catalog:** Add new param entries with path, outputFile, type, allowed, default, required, description, applies_to, citations (docId, docTitle, sectionHeading, url). Encode conditionals (e.g. ipi_only, deprecated, replacement) in description or metadata if supported.
- [ ] **In catalog, not in doc:** Remove or mark as out-of-scope only if the doc explicitly does not support that param for this scenario. If the param is generic (e.g. from shared install-config), keep and cite the shared doc.
- [ ] **Metadata mismatch:** Update required, allowed, default, description to match the doc.

---

## 5. Conditionals and deprecations

- [ ] **Visibility rules:** Document when a param is shown only for a given install method (e.g. IPI vs UPI) or when another option is set (e.g. “omit when external LB”).
- [ ] **Requiredness rules:** Document when a param becomes required based on another choice (e.g. legacy path vs failure-domains).
- [ ] **Mutually exclusive / replacement:** Document deprecated params and their replacements (e.g. apiVIP → apiVIPs); ensure catalog descriptions or metadata reflect this.

---

## 6. Validation

- [ ] Run `node scripts/validate-catalog.js <path-to-catalog>` and fix any schema errors.
- [ ] Optionally run `node scripts/validate-docs-index.js` if docs-index was updated.

---

**No automation script edits the catalog;** this checklist is manual. Use `scripts/scenario-doc-mapping.js` to list doc URLs for a scenario before step 1. Optionally maintain a hand-written `doc-params.json` (array of `{ "path": "...", "required": true|false }` or path strings) and run `node scripts/validate-catalog-vs-doc-params.js <catalog.json> doc-params.json` to report missing paths and required mismatches.
