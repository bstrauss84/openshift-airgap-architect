# Doc index rules (data/docs-index)

## Purpose

Machine-readable index for OpenShift Container Platform docs that maps (platform × install method) **scenarios** and connectivity/variant **tags** to official doc pages. Used by the params catalog and wizard to drive which docs apply to each scenario.

## Base URL and sources

- **Canonical source:** HTML docs on **docs.redhat.com** only. Base URL for 4.20: `https://docs.redhat.com/en/documentation/openshift_container_platform/4.20/`. docs.openshift.com is shut down; do not add or retain docs.openshift.com URLs. If an equivalent 4.20 page is not yet located on docs.redhat.com, document the gap in the doc entry `notes` and in the scenario working doc.

## Inclusion criteria

- Only **official** OpenShift installation/configuration docs for the given version (4.17–4.20).
- Each doc must have a **stable URL** (prefer docs.redhat.com HTML; no internal or draft links).
- Include both platform/method install guides and shared docs (disconnected, mirroring, custom PKI, platform-agnostic) that apply across scenarios.
- For each doc entry, set **configTypes** based on what it covers: `install-config`, `agent-config`, `imageset-config`, or `other`.
- Use the 4.20 Install documentation TOC as the discovery starting point when adding or updating entries.

## Scenario mapping

- **Scenario ID** = one (platform, install method) pair.
- Current 4.20 docs-index scenarios (authoritative list): `bare-metal-agent`, `bare-metal-ipi`, `bare-metal-upi`, `vsphere-ipi`, `vsphere-upi`, `vsphere-agent`, `nutanix-ipi`, `aws-govcloud-ipi`, `aws-govcloud-upi`, `azure-government-ipi`.
- `schema/scenarios.json` includes Azure Government UPI as a supported install method. If/when `azure-government-upi` is added to docs-index, update this list and keep scenario IDs aligned across schema, docs-index, and catalogs.
- Do **not** invent ad-hoc scenario IDs outside the canonical list in `data/docs-index/<version>.json`.
- **Connectivity/variant** is metadata on doc entries via **tags**, not a new scenario ID. Tags include: `restricted-network`, `gov-region`, `secret-region`, `top-secret-region`, `private-cluster`, `existing-vpc`, `existing-vnet`, `fully-disconnected`, `jumpbox`, `mirroring`, `proxy`, `trust-bundle`. Only add tags when the docs explicitly distinguish that variant.
- Each file `data/docs-index/<version>.json` has a **scenarios** object: keys are scenario IDs, each value is `{ "docs": [ ... ] }`. Each doc in the array has: `id`, `title`, `url`, `configTypes` (array), `tags` (array), and optional `notes`.

## sharedDocs

- **sharedDocs** is a top-level array of docs that apply across scenarios (e.g. mirroring/oc-mirror, custom PKI, platform-agnostic install).
- List each shared doc once. The UI or params pipeline can reference them for all scenarios that use mirroring, custom PKI, etc.
- Standard shared doc IDs: `about-oc-mirror-v2`, `configuring-custom-pki`, `installing-platform-agnostic`.
- Each entry has the same shape as scenario docs: `id`, `title`, `url`, `configTypes`, `tags`, optional `notes`.

## Schema summary (Phase 1)

- **version**, **baseUrl**, **generatedAt**, **scenarios**, **sharedDocs** are required at the top level.
- **scenarios**: object (map). Key = scenarioId (string), value = `{ "docs": [ { "id", "title", "url", "configTypes", "tags", "notes"? } ] }`.
- **sharedDocs**: array of doc objects with the same fields.
- **configTypes** allowed: `install-config`, `agent-config`, `imageset-config`, `other`.

## Refresh commands

- **Refresh (validate URLs, prune dead):** from repo root:
  ```bash
  node scripts/refresh-doc-index.js
  ```
  Reads `data/docs-index/4.20.json` (or path as first argument), fetches each URL, and overwrites the file with only live URLs. Deterministic output (sorted by scenarioId, then by doc title).
- **Dry run (summary only, no write):**
  ```bash
  node scripts/refresh-doc-index.js --dry-run
  ```
  Prints docs per scenario, shared docs count, and live/dead URL counts. Exit non-zero if any URL is dead or unreachable.
- **Validate schema:** from repo root:
  ```bash
  node scripts/validate-docs-index.js
  ```
  Checks required keys, scenarios object shape, and doc shape (id, title, url, configTypes, tags).

## Adding 4.19 / 4.18 / 4.17

- Copy `data/docs-index/4.20.json` to `data/docs-index/4.19.json` (and 4.18, 4.17).
- Update top-level `version` and `baseUrl` for that release (e.g. `https://docs.redhat.com/en/documentation/openshift_container_platform/4.19/`).
- Replace doc URLs with the equivalent 4.19/4.18/4.17 paths on docs.redhat.com. Do not use docs.openshift.com (shut down); if a path is not yet available on docs.redhat.com, add a note.
- Run the refresh script for that version (when supported) or hand-edit URLs; then run the docs-index validator. No implementation of auto-discovery for 4.19/4.18/4.17 is required for Phase 1.
