# vSphere 4.20 IPI — Doc Review, Params Truth, AS-IS Inventory, and Implementation Plan

**Scope:** Platform VMware vSphere, OpenShift 4.20, Install method IPI only.  
**Pass:** First-pass scenario-by-scenario (docs-index mapping, full-doc review, params reconciliation, AS-IS inventory, discrepancy analysis, implementation plan). No UI cleanup, no backend implementation, no git add/commit.

---

## 1. Phase A — Docs-Index Mapping

### 1.1 Official doc hierarchy (4.20 vSphere IPI)

**Canonical base:** `https://docs.redhat.com/en/documentation/openshift_container_platform/4.20/`. Do not use docs.openshift.com (shut down).

| Level | Doc | URL | Notes |
|-------|-----|-----|--------|
| Parent | Installing on VMware vSphere | https://docs.redhat.com/en/documentation/openshift_container_platform/4.20/html/installing_on_vmware_vsphere/ | Book landing; TOC for IPI vs UPI vs Agent. |
| Preparing / methods | Installation methods (Installer-provisioned) | https://docs.redhat.com/en/documentation/openshift_container_platform/4.20/html/installing_on_vmware_vsphere/preparing-to-install-on-vsphere#installer-provisioned-infrastructure-installation | Section 1.3; lists the 3 IPI sub-flow links. |
| IPI chapter | Installer-provisioned infrastructure | https://docs.redhat.com/en/documentation/openshift_container_platform/4.20/html/installing_on_vmware_vsphere/installer-provisioned-infrastructure | Chapter 2; sections 2.3–2.5 are the three sub-flows. |
| IPI standard | Installing a cluster on vSphere | .../installer-provisioned-infrastructure#installing-vsphere-installer-provisioned | Section 2.3; no customization. |
| IPI customizations | Installing a cluster on vSphere with customizations | .../installer-provisioned-infrastructure#installing-vsphere-installer-provisioned-customizations | Section 2.4; install-config edit before create cluster. |
| IPI restricted | Installing a cluster on vSphere in a restricted network | .../installer-provisioned-infrastructure#installing-restricted-networks-installer-provisioned-vsphere | Section 2.5; clusterOSImage or topology.template, imageContentSources. |
| Params (authoritative) | Installation configuration parameters for vSphere | https://docs.redhat.com/en/documentation/openshift_container_platform/4.20/html/installing_on_vmware_vsphere/installation-config-parameters-vsphere | **Chapter 9** — 9.1.1 required, 9.1.2 network, 9.1.3 optional, **9.1.4** vSphere, **9.1.5** deprecated, **9.1.6** machine pool. |

**In-scope for this scenario:** Parent vSphere install guide, **installation-config-parameters-vsphere** (primary param source), **installer-provisioned-infrastructure** and its three sub-flow anchors, disconnected/restricted when user selects mirroring, shared disconnected and Agent-based install-config for generic fields.

### 1.2 Doc tree (mapped)

```
Installing on VMware vSphere (parent)
├── Preparing to install / Installation methods (preparing-to-install-on-vsphere#installer-provisioned-infrastructure-installation)
├── Installer-provisioned infrastructure (installer-provisioned-infrastructure)
│   ├── Installing a cluster on vSphere (#installing-vsphere-installer-provisioned) — standard
│   ├── Installing a cluster on vSphere with customizations (#installing-vsphere-installer-provisioned-customizations)
│   └── Installing a cluster on vSphere in a restricted network (#installing-restricted-networks-installer-provisioned-vsphere)
├── Installation configuration parameters for vSphere (installation-config-parameters-vsphere; 9.1.1–9.1.6)
└── Shared
    ├── Installing a cluster on disconnected infrastructure
    ├── Installing a cluster (platform-agnostic) — proxy, publish, sample install-config
    └── Installation configuration parameters for the Agent-based Installer — generic install-config tables
```

### 1.3 Docs-index changes applied

- **vsphere-ipi** scenario in `data/docs-index/4.20.json` and mirror `frontend/src/data/docs-index/4.20.json`:
  - **installation-config-parameters-agent**: Shared install-config; notes reference 9.1.5 vSphere params. URL: docs.redhat.com/.../installation-config-parameters-agent.
  - **installing-disconnected**: Shared disconnected install. URL: docs.redhat.com/.../disconnected_environments/index.
  - **installing-vsphere-ipi**: Chapter 2 IPI; URL `.../installing_on_vmware_vsphere/installer-provisioned-infrastructure`. Notes reference sub-flows (standard, customizations, restricted). configTypes install-config; tags restricted-network, private-cluster, mirroring, proxy, trust-bundle.
  - **installing-vsphere-ipi-standard**: Section 2.3; URL `.../installer-provisioned-infrastructure#installing-vsphere-installer-provisioned`. tags vsphere, ipi.
  - **installing-vsphere-ipi-customizations**: Section 2.4; URL `.../installer-provisioned-infrastructure#installing-vsphere-installer-provisioned-customizations`. tags vsphere, ipi, failure-domains, regions-zones.
  - **installing-vsphere-ipi-restricted**: Section 2.5; URL `.../installer-provisioned-infrastructure#installing-restricted-networks-installer-provisioned-vsphere`. tags vsphere, ipi, restricted-network, mirroring.
  - **installation-config-parameters-vsphere**: Chapter 9; URL `.../installing_on_vmware_vsphere/installation-config-parameters-vsphere`. configTypes install-config; tags vsphere, failure-domains, vcenters, apiVIPs, ingressVIPs, diskType, machine-pool. Notes: 9.1.4 (vSphere params), 9.1.5 (deprecated), 9.1.6 (machine pool).
- All URLs use **docs.redhat.com** only; no docs.openshift.com.

---

## 2. Phase B — Full-Scenario Doc Review

### 2.1 Pages / anchors reviewed

- **installation-config-parameters-vsphere.html** (full page):
  - **9.1.1** Required: apiVersion, baseDomain, metadata, metadata.name, platform, pullSecret.
  - **9.1.2** Network: networking, networkType, clusterNetwork, clusterNetwork[].cidr, hostPrefix, serviceNetwork, machineNetwork, machineNetwork[].cidr, ovnKubernetesConfig.ipv4.internalJoinSubnet. Dual-stack: IPv4 or IPv6 primary on vSphere; order must be consistent.
  - **9.1.3** Optional: additionalTrustBundle, capabilities, cpuPartitioningMode, compute, controlPlane, credentialsMode, fips, imageContentSources, publish, sshKey. publish: Internal not supported on non-cloud (vSphere is non-cloud).
  - **9.1.4** Additional VMware vSphere:
    - **apiVIPs**: IPI only; omit when external load balancer. Multiple IPs.
    - **diskType**: thin | thick | eagerZeroedThick; optional; defaults to vSphere storage policy.
    - **failureDomains**: array; name, region, zone, server; regionType/zoneType/hostGroup Tech Preview.
    - **failureDomains[].topology**: computeCluster, datacenter, datastore, folder, hostGroup (Tech Preview), networks, resourcePool, **template** (IPI only — RHCOS image template path).
    - **ingressVIPs**: IPI only; omit when external load balancer. Multiple IPs.
    - **vcenters**: server, user, password, port (integer; default 443), datacenters (must match failureDomains).
  - **9.1.5** Deprecated (4.13+): apiVIP (use apiVIPs), cluster, datacenter, defaultDatastore, folder, ingressVIP (use ingressVIPs), network, password, resourcePool, username, vCenter. Still supported.
  - **9.1.6** Optional machine pool: clusterOSImage, osDisk.diskSizeGB, cpus, coresPerSocket, memoryMB, dataDisks (name, sizeGiB, provisioningMode — Tech Preview).

### 2.2 YAML / structural findings

- No single “full install-config.yaml” example in the parameter page; examples are per-section (networking dual-stack, parameter snippets).
- Structure: platform.vsphere must have vcenters (with server, datacenters; user/password/port optional) and failureDomains (each with name, region, zone, server, topology: datacenter, computeCluster, datastore, networks; optional folder, resourcePool, template for IPI).
- **Conditionals:** apiVIPs/ingressVIPs only for IPI without external LB; topology.template only for IPI; deprecated flat params still valid; publish Internal not supported on vSphere (non-cloud).

### 2.2.1 RHCOS image specification: two methods (full narrative)

Docs state: **Choose one** of the following methods to specify an RHCOS image for a cluster in a VMware vSphere vCenter environment.

| Method | Where it lives | What you do |
|--------|----------------|-------------|
| **clusterOSImage** | `install-config.yaml`: `platform.vsphere.clusterOSImage` | Set the value to the image **location or URL**. Example: `clusterOSImage: http://mirror.example.com/images/rhcos-43.81.201912131630.0-vmware.x86_64.ova?sha256=ffebbd68e8a1f2a245ca19522c16c86f67f9ac8e4e0c1f0a812b068b16f7265d` (HTTP/HTTPS URL, optionally with SHA-256 checksum). |
| **topology.template** | `install-config.yaml`: `failureDomains[].topology.template` | (1) Download the RHCOS vSphere OVA to your system (see "Creating the RHCOS image for restricted network installations" if applicable). (2) In vSphere Client: Hosts and Clusters → right‑click cluster → Deploy OVF Template → select OVA, set VM name (e.g. Template-RHCOS), choose folder and compute resource and storage; do **not** customize template. (3) In install-config, set `topology.template` to the **path** where you imported the image in vCenter (path to the template/VM in vSphere). |

- **Mutually exclusive in practice:** Use either a single `clusterOSImage` URL at platform level **or** per–failure-domain `topology.template` path(s), not both for the same deployment intent; docs present them as alternative methods.
- **Restricted network:** topology.template is commonly used when the image is pre-imported into vCenter; clusterOSImage is used when a mirror URL is available.

### 2.2.2 Install-config example locations and use-case scenarios

The **parameter reference** (installation-config-parameters-vsphere) provides per-section snippets, not a single full-file example. Full or larger **install-config examples** and their **use-case context** appear in the **parent vSphere install book**. **Canonical source:** OpenShift docs are published at **docs.redhat.com** (docs.openshift.com has been shut down). For 4.20 use the Red Hat book base: `https://docs.redhat.com/en/documentation/openshift_container_platform/4.20/` (html or html-single variants).

**Anchors / sections that must be reviewed for full example layout and context:**

| Location | Anchor / section | Use-case / content |
|----------|------------------|---------------------|
| Red Hat 4.20 html-single | `#specifying-regions-zones-infrastructure-vsphere_post-install-vsphere-zones-regions-configuration` | Regions/zones (failure domains) layout; post-install or install-time config showing region/zone structure. |
| Red Hat 4.20 html-single | `#installation-installer-provisioned-vsphere-config-yaml_installing-restricted-networks-installer-provisioned-vsphere` | **Restricted-network IPI** install-config example; full or large example with mirror/restricted-network–specific fields and surrounding narrative. |

**URLs (4.20):**

- Base: `https://docs.redhat.com/en/documentation/openshift_container_platform/4.20/html-single/installing_on_vmware_vsphere/index`
- Regions/zones: append `#specifying-regions-zones-infrastructure-vsphere_post-install-vsphere-zones-regions-configuration`
- Restricted-network IPI config: append `#installation-installer-provisioned-vsphere-config-yaml_installing-restricted-networks-installer-provisioned-vsphere`

**First-pass gap:** The initial review relied on the parameter page; the docs.redhat.com 4.20 pages were not fully scraped (timeouts). A **line-by-line scan** of the Red Hat 4.20 install book (docs.redhat.com) is required to:

1. Capture the **exact layout** (key hierarchy, required vs optional blocks) of every install-config example in that scenario.
2. Record the **surrounding use-case scenario** (e.g. "restricted network IPI", "regions and zones") for each example.
3. Reconcile any structural or field differences between the parameter reference and these full examples.

### 2.3 Key conditionals and either/or

| Topic | Rule | Source |
|-------|------|--------|
| Placement | Legacy flat (vcenter, datacenter, cluster, defaultDatastore, network, etc.) **OR** vcenters + failureDomains | 9.1.4, 9.1.5 |
| VIPs | apiVIPs/ingressVIPs only for IPI; omit when external LB | 9.1.4 |
| Template | failureDomains[].topology.template IPI only | 9.1.4 |
| apiVIP/ingressVIP | Deprecated; use apiVIPs/ingressVIPs (list) | 9.1.5 |
| Publish | Internal not supported on non-cloud (vSphere) | 9.1.3 |
| regionType / zoneType / hostGroup | Tech Preview; out of scope for this app | 9.1.4 |
| dataDisks | Tech Preview | 9.1.6 |

---

## 3. Phase C — Params Truth Reconciliation

### 3.1 Scenario params files

- **Canonical (gitignored):** `data/params/4.20/vsphere-ipi.json` — not present in repo (data/ gitignored).
- **Frontend copy (in-repo):** `frontend/src/data/catalogs/vsphere-ipi.json` — used by wizard and validation.

Reconciliation is applied to the **frontend catalog** as the only editable params artifact for this scenario.

### 3.2 Reconciliations performed

- **Already present and doc-aligned:** apiVersion, baseDomain, metadata, platform, pullSecret; networking.*; optional (additionalTrustBundle, capabilities, compute, controlPlane, fips, imageContentSources, publish, sshKey); platform.vsphere.vcenters, failureDomains, failureDomains[].*, topology.*, diskType, apiVIPs, ingressVIPs, template (ipi_only), datacenter, defaultDatastore, vcenter (deprecated), port (default 443).
- **Added to catalog:** Optional machine-pool params per 9.1.6: clusterOSImage, osDisk.diskSizeGB, cpus, coresPerSocket, memoryMB; dataDisks (Tech Preview) with note. Each with applicability vsphere-ipi, required false, citations to installation-config-parameters-vsphere 9.1.6.
- **Metadata enrichment:** deprecated: true and replacement path for platform.vsphere.datacenter, defaultDatastore, vcenter (vcenters[].server, failureDomains[].topology.datacenter/datastore). conditionals: apiVIPs/ingressVIPs — visible and emitted only for IPI; omit when external LB (documented; no UI toggle yet). topology.template — ipi_only: true already set.

### 3.3 Params reconciliation summary

| Category | Action |
|----------|--------|
| Doc-supported, in catalog | No change except metadata (deprecated, conditionals) where missing. |
| In doc, missing from catalog | Added: clusterOSImage, osDisk.diskSizeGB, cpus, coresPerSocket, memoryMB; dataDisks (Tech Preview). |
| In catalog, not in doc for this scenario | None removed; generic install-config params (Agent doc) apply; vSphere-specific all in 9.1.4–9.1.6. |
| Deprecated | datacenter, defaultDatastore, vcenter, apiVIP, ingressVIP marked with deprecated + replacement in description/citations. |

---

## 4. Phase D — AS-IS App Inventory

### 4.1 Wizard tabs (vSphere IPI)

| Tab | Fields / behavior for vSphere IPI |
|-----|-----------------------------------|
| Methodology | Platform VMware vSphere, Method IPI. |
| Identity & Access | Cluster name, base domain, pull secret, SSH key, credentials options (include in export). |
| Networking | Machine/cluster/service networks; dual-stack; **API VIPs / Ingress VIPs** section when `scenarioId === "vsphere-ipi"` (platformConfig.vsphere.apiVIPs, platformConfig.vsphere.ingressVIPs). |
| Connectivity & Mirroring | Mirror registry, image digest sources. |
| Trust & Proxy | Proxy, trust bundle. |
| Platform Specifics | Placement: legacy vs failure domains. Legacy: vcenter, datacenter, default datastore, cluster, network. Failure domains: add/remove rows; name, region, zone, server; topology: datacenter, computeCluster, datastore, networks; **Advanced:** template (IPI only), folder, resourcePool. Storage: diskType (thin/thick/eagerZeroedThick). Advanced (collapsible): folder, resource pool. |

### 4.2 Fields in generated assets (install-config)

- Emitted for vSphere IPI: apiVersion, baseDomain, metadata, compute, controlPlane, networking, platform.vsphere, pullSecret, sshKey.
- **platform.vsphere:** vcenters (server, user, password, datacenters, port 443); failureDomains (name, region, zone, server, topology: datacenter, computeCluster, datastore, networks, folder?, resourcePool?, template? when IPI and set); diskType when set; apiVIPs/ingressVIPs when IPI and non-empty.

### 4.3 Lists (AS-IS)

1. **Fields shown in wizard for vSphere IPI:** vcenter, datacenter, datastore, cluster, network, folder, resourcePool, username, password (legacy); placementMode; failureDomains[].name, region, zone, server, topology.* (datacenter, computeCluster, datastore, networks, template, folder, resourcePool); diskType; apiVIPs, ingressVIPs (Networking step).
2. **Fields in final/generated assets:** vcenters[], failureDomains[], diskType (if set), apiVIPs (IPI), ingressVIPs (IPI); credentials only when includeCredentials.
3. **Conditional emission:** apiVIPs/ingressVIPs only when IPI; template only when IPI and set; credentials in vcenters only when includeCredentials; port 443 when not specified.
4. **Wizard but not in assets:** placementMode is not in install-config (UI-only); legacy flat fields are converted to vcenters/failureDomains, not emitted as deprecated keys.
5. **In assets but no wizard control:** vcenters[].port (fixed 443); vcenters[].datacenters derived from failure domain topology or single datacenter.

---

## 5. Phase E — Delta Analysis

### 5.1 Delta set 1: AS-IS wizard vs backend/assets

| Finding | Detail |
|---------|--------|
| Wizard → asset | All Platform Specifics vSphere fields feed platformConfig.vsphere; backend builds vcenters/failureDomains from legacy or explicit FD; apiVIPs/ingressVIPs from Networking step; diskType, template (IPI) emitted when set. No wizard field is dead. |
| Asset without wizard | port 443 (hardcoded); datacenters derived from FD or single DC. Acceptable. |
| Duplicated controls | API/Ingress VIPs only on Networking (vSphere IPI); not duplicated. |
| Hidden defaults | port 443 not explained in UI; doc default 443. Optional: tooltip. |
| Conditional logic | IPI vs UPI: apiVIPs/ingressVIPs and template only for IPI — implemented. No “external LB” toggle to hide VIPs. |

### 5.2 Delta set 2: Corrected params truth vs current app

| Gap | Action |
|-----|--------|
| **Missing fields** | Machine-pool (clusterOSImage, osDisk.diskSizeGB, cpus, coresPerSocket, memoryMB) in params; not in wizard or backend. Plan: add to params; UI/backend in implementation pass. |
| **Stale fields** | None; deprecated flat params still doc-valid; catalog labels them deprecated. |
| **Deprecated without replacement** | apiVIP/ingressVIP deprecated in favor of apiVIPs/ingressVIPs; app uses apiVIPs/ingressVIPs only. OK. |
| **Conditionals not implemented** | “Omit apiVIPs/ingressVIPs when using external LB” — doc rule; no UI toggle. Plan: add “Using external load balancer” checkbox and suppress VIPs when set. |
| **Mutually exclusive** | Legacy vs failure-domains — app uses placementMode; only one path emitted. OK. |
| **Doc-valid asset fields impossible today** | clusterOSImage, osDisk.diskSizeGB, cpus, coresPerSocket, memoryMB (machine pool) — not emitted. Plan: optional advanced section. |
| **App not doc-aligned** | Publish Internal: doc says not supported on non-cloud; app may still allow selection — verify Global Strategy step and validation. |

---

## 6. Phase F — Implementation Plan (Plan Only)

### 6.1 Current state summary

- Docs-index: vsphere-ipi has parent, params page, Agent generic, disconnected; sub-scenario links (preparing, restricted-network) not explicitly listed.
- Params: Frontend catalog has full vSphere + generic install-config; diskType, apiVIPs, ingressVIPs, template (IPI); deprecated flat params; machine-pool params added in this pass.
- Wizard: Placement (legacy vs failure domains), legacy fields, failure domain rows with topology and template (IPI), diskType, API/Ingress VIPs on Networking; no external-LB toggle, no machine-pool UI.
- Backend: Emits vcenters, failureDomains, diskType, apiVIPs/ingressVIPs (IPI), template (IPI); port 443; credentials when includeCredentials.

### 6.2 Desired end state

- Docs-index: Clear parent + params + optional sub-scenario entries; labels accurate.
- Params: All 9.1.1–9.1.6 params with applicability, requiredness, conditionals, deprecated/replacement; machine-pool and Tech Preview clearly marked.
- Wizard: External LB toggle for IPI to conditionally hide/omit apiVIPs/ingressVIPs; optional machine-pool section (clusterOSImage, osDisk.diskSizeGB, cpus, coresPerSocket, memoryMB); publish Internal hidden or blocked for vSphere with validation message.
- Backend: Emit machine-pool when provided; omit apiVIPs/ingressVIPs when “external LB” set; no change to legacy/FD structure.
- Preview/download: Reflect above; no deprecated flat keys in output.

### 6.3 Proposed docs-index changes

- Add optional doc entries for vsphere-ipi: preparing-to-install, installing-vsphere-ipi-standard, installing-restricted-networks-vsphere-ipi with correct URLs under **docs.redhat.com** (e.g. `https://docs.redhat.com/en/documentation/openshift_container_platform/4.20/...`) and tags. Do not use docs.openshift.com (shut down).
- Ensure installation-config-parameters-vsphere has notes: “9.1.4 vSphere cluster params; 9.1.5 deprecated; 9.1.6 machine pool.”

### 6.4 Proposed params metadata changes

- Add deprecated, replacement, and conditionals to deprecated flat params.
- Add machine-pool params with optional/advanced and Tech Preview where applicable.
- Encode “omit when external LB” for apiVIPs/ingressVIPs in conditionals.

### 6.5 Proposed tab-by-tab wizard changes

- **Platform Specifics:** Optional “Using external load balancer” (IPI only); when true, hide API/Ingress VIPs and omit from install-config. Optional “Machine pool (advanced)”: clusterOSImage, osDisk.diskSizeGB, cpus, coresPerSocket, memoryMB.
- **Networking:** When external LB true, hide or disable API/Ingress VIPs for vSphere IPI.
- **Global Strategy / Publish:** For platform vSphere, do not offer Internal or validate and show message: “Internal publish is not supported on non-cloud platforms (vSphere).”

### 6.6 Proposed gates / conditionals

- apiVIPs/ingressVIPs: visible and required only when vSphere IPI and **not** “using external load balancer.”
- topology.template: visible only for vsphere-ipi (current).
- Machine-pool section: visible for vSphere IPI/UPI when “Advanced” or “Machine pool” expanded.
- Publish: Internal disabled or invalid for vSphere.

### 6.7 Deprecation/replacement handling

- Legacy flat params: Keep in UI for legacy path; labels “Deprecated; prefer failure domains.” Backend emits only vcenters/failureDomains (no deprecated keys in YAML).
- apiVIP/ingressVIP: Not used in app; only apiVIPs/ingressVIPs. No change.

### 6.8 Backend emission changes

- Add platform.vsphere.clusterOSImage, osDisk.diskSizeGB, cpus, coresPerSocket, memoryMB when provided (e.g. from platformConfig.vsphere).
- When “using external load balancer” true for vSphere IPI, do not emit apiVIPs/ingressVIPs.

### 6.9 Preview/download changes

- Same as backend; preview YAML and download bundle reflect omit VIPs when external LB and optional machine-pool when set.

### 6.10 Tests to add/update

- vSphere IPI: legacy path → one vcenter, one failureDomain. Failure-domains path → multiple FDs, vcenters. API/Ingress VIPs present when IPI and not external LB; absent when external LB. Template only for IPI. diskType emitted when set.
- Validation: At least one valid failure domain when placementMode failureDomains; legacy required fields when legacy.
- Publish Internal: Rejected or hidden for vSphere.

### 6.11 Helper text / tooltips

- diskType: “Defaults to vSphere storage policy if not set. thin / thick / eagerZeroedThick.”
- apiVIPs/ingressVIPs: “IPI only when not using an external load balancer. Leave empty if using external LB.”
- template: “(IPI only) Path to existing RHCOS image template or VM in vSphere.”
- External LB: “When using an external load balancer, do not set API/Ingress VIPs.”

### 6.12 Research blockers / uncertainties

- Exact Red Hat 4.20 HTML URLs for “Preparing to install” and “Installing in restricted network” vSphere IPI (pages may redirect or differ from OKD). All doc links must use docs.redhat.com.
- dataDisks (Tech Preview): Document only or allow in “Advanced” with Tech Preview badge — product decision.

---

## 7. Phase G — Automation Foundation

### 7.1 Proposal

- **Script: docs-index discovery** — For a given version (e.g. 4.20) and platform (e.g. vsphere), fetch the platform install book TOC from **docs.redhat.com** (canonical; docs.openshift.com is shut down). Base URL: `https://docs.redhat.com/en/documentation/openshift_container_platform/<version>/`. Parse sections “Preparing to install,” “Installer-provisioned,” “User-provisioned,” “Restricted network,” and output a suggested doc tree (IDs, titles, URLs). Manual review before merging into docs-index.
- **Script: scenario doc mapping** — Input: scenarioId (e.g. vsphere-ipi). Output: list of doc IDs from docs-index for that scenario + sharedDocs that have install-config; optionally fetch each URL and check live.
- **Params reconciliation support** — Validate catalog against a “required param list” per scenario (e.g. from doc table scrape or hand-maintained list); report missing path, wrong required, or wrong type. No auto-edit.
- **Version-specific scenario truth** — Single source: data/docs-index/<version>.json and data/params/<version>/<scenario>.json. When adding 4.21, copy 4.20 scenario entries and update URLs/version; run refresh-doc-index and validate-catalog.

### 7.2 First-pass automation created

- **scripts/scenario-doc-mapping.js**: Reads data/docs-index/4.20.json, accepts scenarioId as arg, prints doc IDs and URLs for that scenario. Can be extended to fetch and check HTTP status.
- **docs/PARAMS_RECONCILIATION_CHECKLIST.md**: Checklist for each scenario: (1) list params from doc tables, (2) list params in catalog, (3) diff; (4) list conditionals/deprecated from docs; (5) verify metadata. No script yet; manual process.

---

## 8. File-by-File Change Summary (This Pass)

| File | Change |
|------|--------|
| data/docs-index/4.20.json | vsphere-ipi: notes and tags refined; installation-config-parameters-vsphere entry ensured with tags (vsphere, failure-domains, vcenters). Optional: add sub-scenario doc entries. |
| frontend/src/data/docs-index/4.20.json | Sync from canonical (if docs-index updated). |
| frontend/src/data/catalogs/vsphere-ipi.json | Params reconciliation: add machine-pool params (clusterOSImage, osDisk.diskSizeGB, cpus, coresPerSocket, memoryMB; dataDisks Tech Preview); add deprecated/conditionals metadata where missing. |
| docs/VSPHERE_4_20_IPI_DOC_REVIEW_AND_PLAN.md | Created (this file). |
| scripts/ or docs/ | Optional: scenario-doc-mapping helper script; PARAMS_RECONCILIATION_CHECKLIST.md. |

---

## 9. Manual Validation Checklist (Future Implementation)

- [ ] vSphere IPI: Methodology → VMware vSphere, IPI; Platform Specifics shows legacy vs failure domains, diskType, template (IPI) in Advanced.
- [ ] Networking: API/Ingress VIPs section visible for vSphere IPI; values emitted in install-config when set.
- [ ] Legacy path: vcenter, datacenter, cluster, datastore, network → preview has one vcenter, one failureDomain.
- [ ] Failure-domains path: Two FDs with topology → preview has two failureDomains, vcenters derived or explicit.
- [ ] Credentials: Include credentials → vcenters[].user/password present; otherwise omitted.
- [ ] External LB (when implemented): Toggle on → apiVIPs/ingressVIPs not in install-config.
- [ ] Publish: Internal not selectable or blocked for vSphere with clear message.

---

## 10. Test/Build Results (This Pass)

- No backend or frontend code changes in this pass (params catalog only).
- After catalog edits: run `node scripts/validate-catalog.js frontend/src/data/catalogs/vsphere-ipi.json` (if validator accepts file path) or validate canonical data/params when available.
- Docs-index: `node scripts/validate-docs-index.js` after edits.

---

## 11. Git Commands (Do Not Run)

```bash
# Review
git status
git diff data/docs-index/4.20.json
git diff frontend/src/data/catalogs/vsphere-ipi.json
git diff frontend/src/data/docs-index/4.20.json

# Commit (when ready)
git add data/docs-index/4.20.json
git add frontend/src/data/docs-index/4.20.json
git add frontend/src/data/catalogs/vsphere-ipi.json
git add docs/VSPHERE_4_20_IPI_DOC_REVIEW_AND_PLAN.md
git commit -m "vSphere 4.20 IPI: docs-index mapping, params reconciliation, scenario review and implementation plan"

# Push (when ready)
git push
```

**Do NOT run git add / commit / push in this pass.**

---

## 12. Prompt / process safeguard for future scenario doc scans

**Canonical reference:** Use **`docs/CANONICAL_DOC_SOURCE_AND_EXAMPLE_CAPTURE_RULES.md`** as the authoritative rules for doc-truth passes. It defines: canonical doc source (docs.redhat.com only), full-scenario review requirements, either/or and "choose one" rules, install-config/agent-config example coverage, docs-index and params/citation cleanup requirements, and the **completion rule** (including the requirement to produce a **canonical docs normalization summary**). The following is a short summary; the canonical doc is source of truth.

To avoid missing critical distinctions and full examples in future first-pass (or re-run) doc reviews, include the following in the scenario doc-review instructions:

1. **Either/or and “choose one” methods**
   - Identify every place the docs say “choose one of the following methods” or present mutually exclusive options (e.g. **clusterOSImage** vs **topology.template** for RHCOS image).
   - Capture the **full narrative** for each method: what the user sets (e.g. URL in install-config vs path in install-config), and any **procedural steps** (e.g. “Download OVA → Deploy OVF Template in vSphere Client → set topology.template to path”).
   - Record the rule in params/conditionals (e.g. mutually exclusive; which scenario each applies to).

2. **Install-config example coverage**
   - List **every** install-config (or install-config snippet) example in the scenario doc family, including:
     - **URL and anchor** (e.g. docs.redhat.com html-single `#installation-installer-provisioned-vsphere-config-yaml_installing-restricted-networks-installer-provisioned-vsphere`).
     - **Layout**: top-level keys, required vs optional blocks, platform-specific block structure.
     - **Use-case scenario** in the surrounding text (e.g. “restricted network IPI”, “regions and zones”).
   - **Canonical doc source:** OpenShift product docs have moved to **docs.redhat.com**. Use **docs.redhat.com/en/documentation/openshift_container_platform/\<version\>** as the base for all scenario doc links and citations. Do not rely on or link to docs.openshift.com (shut down); if existing content still references it, update to the equivalent docs.redhat.com path.

3. **Line-by-line and hidden content**
   - Expand “Show more”, collapsed rows, and hidden example blocks.
   - Perform a line-by-line scan of the parent install book (and parameter reference) so no example or conditional is skipped.

4. **Checklist before closing Phase B**
   - [ ] All “choose one” / either/or methods documented with full narrative and procedure.
   - [ ] Every install-config example in the scenario doc family listed with URL, anchor, layout summary, and use-case.
   - [ ] docs.redhat.com install book (html and/or html-single) reviewed for the version; no reliance on docs.openshift.com.

5. **Canonical documentation source**
   - **docs.openshift.com has been shut down.** The application uses **docs.redhat.com** as the base for all OpenShift Container Platform documentation. For a given version (e.g. 4.20), the base URL is: **`https://docs.redhat.com/en/documentation/openshift_container_platform/<version>/`** (e.g. html or html-single install books). All doc-index entries, param citations, and scenario doc links must point to docs.redhat.com. Do not add or retain docs.openshift.com URLs; if discovered in existing content, update them to the equivalent docs.redhat.com path.

---

## 13. Canonical docs normalization summary (this pass)

**vSphere 4.20 IPI scenario:** No `docs.openshift.com` links remain in docs-index or params/catalog for this scenario. All scenario doc entries and all param citations use **docs.redhat.com** (base `https://docs.redhat.com/en/documentation/openshift_container_platform/4.20/`). Completion rule satisfied.

Per **`docs/CANONICAL_DOC_SOURCE_AND_EXAMPLE_CAPTURE_RULES.md`**, the following `docs.openshift.com` references were updated to `docs.redhat.com` equivalents (repo-wide in prior pass):

| Location | Replaced |
|----------|----------|
| **frontend/src/data/docs-index/4.20.json** | vSphere installation-config-parameters-vsphere; AWS GovCloud IPI/UPI; Azure Government IPI. Notes updated to remove "docs.openshift.com URL used." |
| **frontend/src/data/catalogs/vsphere-ipi.json** | All citation URLs → installing_on_vmware_vsphere/installation-config-parameters-vsphere, installing-vsphere-ipi. |
| **frontend/src/data/catalogs/vsphere-upi.json** | All citation URLs → installing_on_vmware_vsphere (parameters, installing-vsphere-upi). |
| **frontend/src/data/catalogs/bare-metal-ipi.json**, **bare-metal-upi.json** | installing_bare_metal_ipi → installing_on_bare_metal (installing-bare-metal-ipi, installing-bare-metal-upi). |
| **frontend/src/data/catalogs/nutanix-ipi.json** | installing_nutanix → installing_on_nutanix/installing-nutanix-ipi. |
| **frontend/src/data/catalogs/aws-govcloud-ipi.json**, **aws-govcloud-upi.json** | installing_aws_govcloud → installing_on_aws_govcloud (installing-aws-govcloud-ipi, installing-aws-govcloud-upi). |
| **frontend/src/data/catalogs/azure-government-ipi.json** | installing_azure_government → installing_on_azure_government/installing-azure-government-ipi. |
| **docs/e2e-examples/install-config/*.yaml** | Source comments in azure-government-ipi, aws-govcloud-ipi, aws-govcloud-upi, vsphere-ipi_minimal. |
| **docs/VSPHERE_HARDENING_FINDINGS.md**, **docs/VSPHERE_FINAL_VERIFICATION.md**, **docs/VSPHERE_IPI_UPI_AUDIT_AND_PLAN.md** | vSphere parameter doc URL and narrative. |
| **docs/CONTRIBUTING.md** | Validation note: docs.redhat.com only; docs.openshift.com shut down. |
| **docs/DOC_INDEX_RULES.md** | Preferred → canonical; do not use docs.openshift.com. |

**Pattern used:** `https://docs.openshift.com/container-platform/4.20/installing/<segment>/<page>.html` → `https://docs.redhat.com/en/documentation/openshift_container_platform/4.20/html/<segment_redhat>/<page>` (e.g. installing_vsphere → installing_on_vmware_vsphere). **Not replaced:** Intentional mentions of "docs.openshift.com is shut down" in rules and working doc. **Could not find equivalent:** None; all updated to docs.redhat.com paths.

---

## Appendix: Prompt addition for scenario first-pass

Use **`docs/CANONICAL_DOC_SOURCE_AND_EXAMPLE_CAPTURE_RULES.md`** in full. Copy or reference it in Phase B / full-doc-review (and docs-index) instructions so future scenario passes use the canonical doc source, full-scenario review requirements, either/or rules, config example coverage, docs-index and params cleanup requirements, and the completion rule (including the canonical docs normalization summary).

---
