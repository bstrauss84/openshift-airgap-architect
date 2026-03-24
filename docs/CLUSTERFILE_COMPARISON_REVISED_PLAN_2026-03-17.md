# Clusterfile Comparison, Gap Analysis, and Revised Implementation Plan

> Authority: Working comparative analysis
> Canonical status source: `docs/BACKLOG_STATUS.md`
> Canonical navigation source: `docs/INDEX.md`

Date: 2026-03-17
Scope: OpenShift Airgap Architect current snapshot vs https://github.com/purefield/clusterfile
Pass type: Research and plan only. No code changes.

## 1. Bottom line

Clusterfile is not just "another install-config tool". It is a broader cluster modeling system:
- one declarative YAML model
- JSON Schema-backed editor
- Jinja2 rendering pipeline
- multiple output families
- CLI + editor usage modes
- pre-flight scripts
- ACM / SiteConfig / KubeVirt / operator artifacts

OpenShift Airgap Architect is stronger in a different way:
- scenario-aware wizard UX
- docs-reconciled parameter catalogs
- explicit per-scenario gating
- safer secret handling defaults
- curated export bundle
- FIELD_MANUAL guidance
- stronger alignment with the project's current "docs truth before UX redesign" workflow

That means the right outcome is **not** to copy clusterfile. The right outcome is to selectively absorb the concepts that materially improve our app while preserving our current product shape.

## 2. What clusterfile is doing that we are not

### 2.1 Strongest differentiators

1. **Single cluster model driving many outputs**
   - install-config
   - agent-config
   - operator manifests
   - ACM ZTP resources
   - ACM CAPI resources
   - SiteConfig / ClusterInstance transforms
   - KubeVirt resources
   - pre-check scripts

2. **Schema-first editing model**
   - JSON Schema with rich primitive validation
   - field grouping metadata
   - collapsible group metadata
   - per-field doc URLs
   - file-path semantics for imported inputs

3. **Per-field doc linking directly in metadata**
   - `x-doc-url` on schema fields
   - editor can surface docs near the field itself

4. **Extra manifests as a first-class concept**
   - user can reference additional manifest files in the cluster model

5. **Pre-flight checks as generated artifacts**
   - DNS
   - BMC
   - files
   - network
   - NTP
   - registry

6. **Disconnected/operator concepts modeled more explicitly**
   - mirrors
   - release digest
   - catalogSources
   - disconnected toggle
   - operator plugin overrides

7. **Multiple usage modes**
   - browser editor
   - CLI rendering
   - parameter override mode
   - containerized usage

## 3. What our app is doing better right now

1. **Scenario-aware guardrails**
   The current app is explicitly built around scenario-specific docs, params truth, and gating. That is a strength, not a weakness.

2. **Safer handling of credentials and exports**
   Credentials are intentionally excluded from exports unless explicitly included. Pull secrets are not casually persisted. This is better aligned with the project's guardrails.

3. **Guided workflow for real users**
   The stepwise model reduces cognitive load for people who are not going to hand-author one giant YAML file.

4. **Curated output bundle and runbook**
   FIELD_MANUAL plus preview/export is a practical differentiator.

5. **Project process maturity around docs truth**
   The app already has a living workflow for docs-index, params reconciliation, discrepancy analysis, and implementation planning.

## 4. Areas where clusterfile exposes real gaps for us

### 4.1 Per-field documentation links

This is the most obvious near-term gap.

We already carry citations in our scenario catalogs. We are not surfacing them next to the actual controls. That means the underlying data exists, but the UX benefit is currently trapped in JSON.

Recommendation:
- add per-field "Open docs" support driven from existing catalog citations
- keep scenario-level docs links too
- prefer canonical docs.redhat.com links only

### 4.2 User-supplied extra manifests

This is a real gap, but the implementation detail matters.

Clusterfile models manifests as cluster data. That is useful. But for us, the best implementation is **not** to pretend this is an install-config field.

For OpenShift 4.20, the documented install-time customization pattern is to create additional manifest files in the install directory, typically under the `openshift/` subdirectory after generating manifests, especially in agent-based and bare-metal flows. The docs explicitly describe additional/custom manifests in that file-based form, not as a standard top-level install-config key. Therefore, we should support **install-time manifest assets**, not invent a fake install-config parameter. citeturn103718search0turn103718search3turn103718search6turn411459search0

Recommendation:
- add an optional "Custom manifests" section for scenarios where docs support the pattern
- collect metadata like name, filename, and content or file reference
- emit those as exported files in an `openshift/` folder in the bundle
- describe exactly when the user should run `create manifests` / `agent create ...` and where to place the files
- do **not** add a bogus install-config YAML key for this

### 4.3 Pre-flight checks

Clusterfile is ahead here in a practical way.

Our FIELD_MANUAL already contains operational guidance, but it is prose-heavy. Clusterfile turns that into directly runnable checks. That is genuinely useful.

Recommendation:
- phase 1: enrich FIELD_MANUAL with tighter command-level checks
- phase 2: optionally export a generated `preflight-checks.sh` for supported scenarios
- keep it scenario-aware and state-derived
- do not add this until command safety and assumptions are explicitly documented

### 4.4 Stronger disconnected/operator framing

Clusterfile is more explicit about disconnected state, catalog sources, and release digest usage. Some of that goes beyond our current scope, but some of it should influence our UX and guidance.

Recommendation:
- improve disconnected guidance in Connectivity & Mirroring and FIELD_MANUAL
- explain relationship between mirrored content, cluster-resources, and operator sources more clearly
- consider an explicit disconnected intent flag only if it materially changes guidance or outputs

### 4.5 Schema-backed validation discipline

Clusterfile benefits from having a single schema contract. Our app has rich validation, but it is spread across hand-written UI logic and backend generation assumptions.

Recommendation:
- do not pivot to schema-generated forms
- do consider a schema or contract layer for backend payload validation later
- this is a robustness play, not a UX redesign

## 5. Things clusterfile has that we should probably NOT adopt

1. **Single giant YAML as the primary UX**
   This would throw away one of our best differentiators.

2. **Jinja2/template-centered generation**
   Our current generator is easier to reason about with our scenario-specific guardrails.

3. **Schema-driven generic form generation**
   Good for editor speed, but weaker for the curated scenario UX we are trying to achieve.

4. **Broad ACM / CAPI / SiteConfig / KubeVirt surface area**
   Valuable, but outside current product focus.

5. **File-path-oriented secret handling as the main mode**
   Not aligned with our existing secret handling principles.

## 6. Specific call on "Location"

Clusterfile's `location` field is useful as a logical metadata label, but it is not an official install-config concept.

Recommendation:
- do **not** prioritize this as a top-tier gap
- if added, make it an optional metadata/helper field only
- use it in FIELD_MANUAL, export metadata, or future labeling helpers
- do not emit it into install-config unless an official scenario-specific doc path calls for it

Priority: low.

## 7. Specific call on "manifests"

This is the most important correction to make relative to the earlier analysis.

### What clusterfile does
- stores manifests as part of the cluster model
- references them as additional install-time manifests

### What we should do
- support optional custom manifest assets for supported scenarios
- export them into the bundle in the correct directory structure
- document the install flow around them

### What we should not do
- we should **not** invent a top-level install-config field named manifests or similar
- we should **not** imply that custom manifests are a normal install-config parameter

Priority: high.

## 8. Specific call on doc links in tooltips/icons

This is a clear yes.

We already have the source data. Adding field-level docs is low-risk, high-value, and consistent with our current product direction.

Implementation shape:
- extend field metadata resolver to expose first citation URL/title
- extend FieldLabelWithInfo to optionally render a small docs link/icon
- only show it where a real citation exists
- open in new tab
- preserve current tooltip behavior
- canonicalize to docs.redhat.com where needed

Priority: highest.

## 9. Revised implementation plan

### Phase 1 — Surface field-level docs from existing citations

Goal:
- expose catalog citations in the UI near the actual controls

Work:
- add citation accessors in frontend metadata helpers
- add optional `docUrl` / `docTitle` support to FieldLabelWithInfo
- wire into Platform Specifics, Host Inventory V2, Networking, Connectivity & Mirroring, Trust & Proxy, Identity & Access where fields map cleanly to catalog entries
- canonical-doc normalization check for any stale docs.openshift.com references encountered in catalogs

Why first:
- immediate usability gain
- minimal architectural risk
- leverages data we already maintain

### Phase 2 — Add custom manifest asset support

Goal:
- support doc-aligned install-time custom manifests

Work:
- add state model for custom manifests as bundle assets, not install-config fields
- define supported scenarios explicitly, starting with agent-based and bare metal flows where docs clearly describe the pattern
- UI for adding/removing manifest entries
- export bundle writes manifests into `openshift/` subdirectory or scenario-appropriate path
- FIELD_MANUAL gains exact workflow steps for when and where to place/use the manifests
- validate filenames, size, extension policy, and path safety

Why second:
- high value
- doc-aligned
- still keeps us inside current product scope

### Phase 3 — Improve pre-flight guidance

Goal:
- move from generic prose to execution-ready checks

Work:
- enrich FIELD_MANUAL sections with more deterministic checks
- optionally add generated `preflight-checks.sh`
- scope initial coverage to DNS, VIP, NTP, registry reachability, and selected scenario-specific checks
- keep secret-safe and assumption-light

Why third:
- useful, but benefits from the state model cleanup in earlier phases

### Phase 4 — Clarify disconnected/operator source guidance

Goal:
- make disconnected intent and operator catalog expectations clearer

Work:
- improve explanatory text in Connectivity & Mirroring and Operators
- add FIELD_MANUAL sections on cluster-resources, mirrored operator content, and custom catalog behavior
- avoid promising generated CatalogSource YAML until there is an approved design

### Phase 5 — Optional metadata helpers like Location

Goal:
- add optional non-output metadata only if it materially helps users

Work:
- optional location/environment label
- use only in FIELD_MANUAL or export metadata initially

### Phase 6 — Backend contract validation

Goal:
- improve structural robustness without abandoning wizard UX

Work:
- define schema or validation contract for backend generation input
- keep frontend UI hand-authored
- use contract for preview/export safety checks

## 10. Where Cursor and this analysis align

1. Per-field doc links are worth doing.
2. Extra/custom manifests are a real capability gap worth addressing.
3. Pre-flight guidance is a meaningful opportunity.
4. Location is optional and not an install-config core field.
5. We should not clone clusterfile's editor or whole architecture.
6. ACM/SiteConfig/KubeVirt are out of current scope.

## 11. Where this analysis disagrees with Cursor

### 11.1 Biggest disagreement: manifests implementation

Cursor framed manifests as something we should add by emitting "the right install-config structure".

I disagree.

For the official OpenShift flows relevant here, custom/additional manifests are documented as **files placed in the install assets/manifests workflow**, especially under the `openshift/` subdirectory for agent-based customization, not as a standard top-level install-config parameter. So the right design is exported manifest assets plus runbook guidance, not a new install-config YAML field. citeturn103718search0turn103718search3turn103718search6turn411459search0

### 11.2 Canonical docs discipline

Clusterfile's schema examples use `docs.openshift.com` URLs in multiple places, while this repo's own current rules require canonical `docs.redhat.com` usage. That means we can copy the concept of per-field doc links, but we should not copy their raw URL practice. citeturn630619view0turn2file0

### 11.3 Priority of location

Cursor treated location as a fairly visible improvement. I see it as low-priority metadata. Useful, but nowhere near as important as field-level docs, manifest asset support, or pre-flight checks.

### 11.4 Validation direction

Cursor's schema-validation suggestion is reasonable, but I would keep it much later. The bigger immediate win is surfacing existing citations and adding asset-level manifest support.

## 12. Final recommendation

If we only do three things from this comparison, they should be:

1. **Per-field doc links from existing citations**
2. **Doc-aligned custom manifest asset support**
3. **Better pre-flight guidance, eventually exportable checks**

That gets the biggest benefit from clusterfile's ideas without abandoning what makes OpenShift Airgap Architect better for its intended use.
