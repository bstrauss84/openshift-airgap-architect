# vSphere 4.20 IPI — Doc Review, Params Truth, AS-IS Inventory, and Implementation Plan

> Authority: Working doc (scenario deep-dive)
> Canonical status source: `docs/BACKLOG_STATUS.md`
> Canonical navigation source: `docs/SCENARIOS_GUIDE.md`

**Scope:** Platform VMware vSphere, OpenShift 4.20, Install method IPI only.  
**Pass:** First-pass scenario-by-scenario (docs-index mapping, full-doc review, params reconciliation, AS-IS inventory, discrepancy analysis, implementation plan). No UI cleanup, no backend implementation, no git add/commit.

---

## Current code truth (vSphere 4.20 IPI — sync reference)

The following reflects the **actual implemented state** of the app (source of truth for tracking/docs sync). Historical plan text that described a since-removed loadBalancer.type path is preserved below but labeled as historical.

| Fact | Status |
|------|--------|
| **loadBalancer.type** | **Not in app.** No UI dropdown; no catalog param; no backend emission. Doc note satisfied by Networking UI: "Leave blank if using an external load balancer." |
| **API/Ingress VIPs** | On **Networking** tab (NetworkingV2Step); note to leave blank when using external LB. Emitted when vSphere IPI and non-empty. |
| **Topology: Networks comma handling** | **Fixed.** Input no longer strips trailing commas (onChange uses split+trim only; backend filters empty strings on emit). |
| **Legacy global folder/resourcePool** | **Gated.** Shown only when `placementMode === "legacy"` (showVsphereLegacyFolderResourcePool). |
| **clusterOSImage vs topology.template** | **Mutual-exclusivity UX.** Both visible; one disabled when the other has a value; hints explain "choose one strategy only." Backend emits only one. |
| **VIP-in-machine-network validation** | **Implemented.** `validateVipsInMachineNetwork` in validation.js; called on networking-v2, review, review-generate; fieldErrors for apiVip/ingressVip. |
| **Machine-pool (advanced) and zone placement** | **Implemented.** Machine pool: clusterOSImage, osDisk.diskSizeGB, cpus, coresPerSocket, memoryMB. Zone placement (compute/controlPlane zones) when ≥2 failure domains. Backend emits when set. |
| **featureSet / arbiter.*** | **Intentionally deferred.** In catalog; no UI or backend emission for vSphere IPI. (Table: featureSet, arbiter.name, arbiter.replicas.) |

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

**Verification (review question):** The distinction above is incorporated: “choose one” framing, clusterOSImage at `platform.vsphere.clusterOSImage` with example URL (including optional `?sha256=...`), and topology.template with full procedural steps (download OVA → Deploy OVF Template → Select OVF tab → name and folder → compute resource → storage → do not customize → set `topology.template` in install-config to the vCenter path). Doc order may vary slightly; all steps are captured.

- **Mutually exclusive in practice:** Use either a single `clusterOSImage` URL at platform level **or** per–failure-domain `topology.template` path(s), not both for the same deployment intent; docs present them as alternative methods.
- **Restricted network:** topology.template is commonly used when the image is pre-imported into vCenter; clusterOSImage is used when a mirror URL is available.

### 2.2.2 Install-config example locations and use-case scenarios

The **parameter reference** (installation-config-parameters-vsphere) provides per-section snippets, not a single full-file example. Full or larger **install-config examples** and their **use-case context** appear in the **parent vSphere install book**. **Canonical source:** OpenShift docs are published at **docs.redhat.com** (docs.openshift.com has been shut down). For 4.20 use the Red Hat book base: `https://docs.redhat.com/en/documentation/openshift_container_platform/4.20/` (html or html-single variants).

**Anchors / sections that must be reviewed for full example layout and context:**

| Location | Anchor / section | Use-case / content |
|----------|------------------|---------------------|
| Red Hat 4.20 html-single | `#specifying-regions-zones-infrastructure-vsphere_post-install-vsphere-zones-regions-configuration` | Regions/zones (failure domains) layout; post-install or install-time config showing region/zone structure. |
| Red Hat 4.20 html-single | `#installation-vsphere-regions-zones-host-groups_installing-restricted-networks-installer-provisioned-vsphere` | Regions/zones and **host groups** in restricted-network context; install-config layout and use-case for host-group scenario. |
| Red Hat 4.20 html-single | `#installation-installer-provisioned-vsphere-config-yaml_installing-restricted-networks-installer-provisioned-vsphere` | **Restricted-network IPI** install-config example; full or large example with mirror/restricted-network–specific fields and surrounding narrative. |

**URLs (4.20):**

- Base: `https://docs.redhat.com/en/documentation/openshift_container_platform/4.20/html-single/installing_on_vmware_vsphere/index`
- Regions/zones: append `#specifying-regions-zones-infrastructure-vsphere_post-install-vsphere-zones-regions-configuration`
- Regions/zones/host-groups (restricted): append `#installation-vsphere-regions-zones-host-groups_installing-restricted-networks-installer-provisioned-vsphere`
- Restricted-network IPI config (large example): append `#installation-installer-provisioned-vsphere-config-yaml_installing-restricted-networks-installer-provisioned-vsphere`

**First-pass gap:** The initial review relied on the parameter page; the docs.redhat.com 4.20 pages were not fully scraped (timeouts). A **line-by-line scan** of the Red Hat 4.20 install book (docs.redhat.com) is required to:

1. Capture the **exact layout** (key hierarchy, required vs optional blocks) of every install-config example in that scenario.
2. Record the **surrounding use-case scenario** (e.g. "restricted network IPI", "regions and zones") for each example.
3. Reconcile any structural or field differences between the parameter reference and these full examples.

**Prompt / process safeguard (future passes):** To avoid missing distinctions or example layouts in future scenario reviews, the following must be explicitly required in the review instructions:

1. **“Choose one” / mutually exclusive options:** For every doc “choose one of the following methods” (e.g. clusterOSImage vs topology.template), capture the **full narrative** for each path: (a) the exact install-config key and example value or snippet, and (b) **all numbered procedural steps** from the doc for each method (e.g. for topology.template: download OVA → Deploy OVF Template → Select OVF tab → name and folder → compute resource → storage → do not customize → set topology.template to path). Do not summarize procedural steps; list them so layout and order are traceable.

2. **Install-config example locations:** For every install-config example or snippet in the scenario, record: (a) **exact docs.redhat.com URL + anchor** for **both** the multipage HTML and the **html-single** variant when the same content exists (anchor IDs differ between html and html-single). (b) Whether the example is full or partial. (c) The **exact key hierarchy** (e.g. platform.vsphere.apiVIPs, failureDomains[].topology.template). (d) The **use-case scenario** from the surrounding text. Check the **html-single** index for the version (e.g. `.../html-single/installing_on_vmware_vsphere/index#...`) and resolve every scenario-specific anchor (e.g. specifying-regions-zones, installation-vsphere-regions-zones-host-groups, installation-installer-provisioned-vsphere-config-yaml) so no example section is missed.

3. **Completion check:** The scenario doc review is not complete until every “choose one” has both paths fully narrated (including procedural steps) and every install-config example in the book for that scenario has a recorded URL+anchor, layout, and use-case (and html-single anchors are explicitly checked when the book is available in that form).

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

## 2.4 Phase B Finalization — Structural Validation

This section records the Phase B finalization pass: extraction of every install-config example structure from the 4.20 vSphere docs, structural diff against the params catalog and backend emission, explicit mutual-exclusivity checks, and completion status.

### STEP 1 — Extract Example Structures

Source: `https://docs.redhat.com/en/documentation/openshift_container_platform/4.20/html/installing_on_vmware_vsphere/` (installer-provisioned-infrastructure, installation-config-parameters-vsphere). HTML chapter content was reviewed; installer-provisioned page is the same book in multi-page HTML form.

| # | URL / location | Full or partial | Exact key hierarchy | Strategy | machine-pool | VIPs | publish | hostGroups | vcenters |
|---|----------------|-----------------|---------------------|----------|--------------|------|--------|------------|----------|
| 1 | installation-config-parameters-vsphere §9.1.2 | partial | networking.clusterNetwork[], serviceNetwork[] (dual-stack) | — | no | no | no | no | no |
| 2 | installation-config-parameters-vsphere §9.1.4 | plaintext paths | platform.vsphere: apiVIPs, diskType, failureDomains, ingressVIPs, vcenters; failureDomains[].name, region, zone, server, topology; topology.computeCluster, datacenter, datastore, folder, hostGroup, networks, resourcePool, template; vcenters[].datacenters, password, port, server, user | failureDomains | — | yes | — | hostGroup in topology | yes |
| 3 | installation-config-parameters-vsphere §9.1.5 | plaintext paths | platform.vsphere (flat): apiVIP, cluster, datacenter, defaultDatastore, folder, ingressVIP, network, password, resourcePool, username, vCenter | legacy (deprecated) | — | yes (single) | — | no | no |
| 4 | installation-config-parameters-vsphere §9.1.6 | plaintext paths | platform.vsphere: clusterOSImage, osDisk.diskSizeGB, cpus, coresPerSocket, memoryMB, dataDisks[] (name, sizeGiB, provisioningMode) | machine-pool at platform | yes | no | no | no | no |
| 5 | installer-provisioned §2.3 / 2.4.5.1 — “Sample install-config” (standard) | full (fragmented) | platform.vsphere: apiVIPs, failureDomains (name, region, zone, server, topology: computeCluster, datacenter, datastore, networks, resourcePool, folder, tagIDs), ingressVIPs, vcenters (datacenters, password, port, server, user), diskType | failureDomains; no clusterOSImage/template | no | yes | no | no (tagIDs in topology) | yes |
| 6 | installer-provisioned §2.4.5.4 — “Sample with multiple data centers” | partial | compute/controlPlane: platform.vsphere.zones: [zone1, zone2]; platform.vsphere: vcenters.datacenters: [dc1, dc2], failureDomains[] (name, region, zone, server, topology: datacenter, computeCluster, networks, datastore, resourcePool, folder) | failureDomains, regions/zones | no | not in snippet | no | no | yes |
| 7 | installer-provisioned §2.4.5.5 — “Host groups” | partial | failureDomains[].regionType, zoneType; topology.hostGroup | failureDomains + hostGroup (Tech Preview) | no | no | no | yes | yes |
| 8 | installer-provisioned §2.4.5.6 — “Multiple NICs” | partial | platform.vsphere.vcenters, failureDomains[].topology.networks: [n1, n2, ...] | failureDomains, multi-NIC | no | no | no | no | yes |
| 9 | installer-provisioned §2.5 — “Choose one” RHCOS | partial | platform.vsphere.clusterOSImage: &lt;URL&gt; | clusterOSImage | no | no | no | no | no |
| 10 | installer-provisioned §2.5 — topology.template method | narrative | failureDomains[].topology.template: &lt;path&gt; (no YAML block in doc) | topology.template | no | no | no | no | — |
| 11 | installer-provisioned §2.5.7.1 — “Sample install-config for restricted network” | full (fragmented) | Same as #5 plus platform.vsphere.clusterOSImage. So: apiVIPs, failureDomains (no template in sample), ingressVIPs, vcenters, diskType, clusterOSImage | failureDomains + clusterOSImage | no | yes | no | no | yes |
| 12 | installer-provisioned §2.4.5.3 / user-managed LB | partial | platform.vsphere.loadBalancer.type: UserManaged; apiVIPs; ingressVIPs | UserManaged LB | no | yes | no | no | — |

**Summary of structures:**

- **clusterOSImage:** Appears at `platform.vsphere.clusterOSImage` (examples #4, #9, #11). Never shown in the same YAML block as `topology.template`; doc narrative says “choose one.”
- **topology.template:** Appears at `failureDomains[].topology.template` (example #2, #10). Parameter page §9.1.4 defines it; no full YAML example in doc shows both template and clusterOSImage.
- **Region/zone:** failureDomains[].region, zone in all failure-domain examples; multi-DC example (#6) also shows compute/controlPlane.platform.vsphere.zones.
- **Host-group:** failureDomains[].regionType, zoneType, topology.hostGroup (Tech Preview; #7).
- **Restricted-network full:** #11 — vcenters, failureDomains, apiVIPs, ingressVIPs, diskType, clusterOSImage; no template in that sample.
- **Legacy flat:** #3 — deprecated flat keys at platform.vsphere.
- **Machine-pool (9.1.6):** All at platform.vsphere (clusterOSImage, osDisk.diskSizeGB, cpus, coresPerSocket, memoryMB, dataDisks); doc does not show compute/controlPlane.platform.vsphere for these.

### STEP 2 — Structural Diff vs Params Catalog

**Reference:** `frontend/src/data/catalogs/vsphere-ipi.json`.

| Question | Answer |
|----------|--------|
| Are all keys represented? | **Almost.** Catalog has platform.vsphere.{apiVIPs, diskType, failureDomains, ingressVIPs, vcenters, clusterOSImage, osDisk.diskSizeGB, cpus, coresPerSocket, memoryMB}, failureDomains[].{name, region, server, zone, topology.*}, topology.{computeCluster, datacenter, datastore, folder, networks, resourcePool, template}, vcenters[].{server, user, password, port, datacenters}, plus deprecated flat (datacenter, defaultDatastore, vcenter, etc.). **Missing:** platform.vsphere.loadBalancer.type (UserManaged). **Missing (Tech Preview, out of scope):** failureDomains[].regionType, zoneType, topology.hostGroup; dataDisks[]. |
| Nesting levels modeled? | **Yes.** Paths match doc: platform.vsphere.failureDomains[].topology.template, platform.vsphere.vcenters[].datacenters, etc. |
| Conditional paths explicitly encoded? | **Partially.** apiVIPs/ingressVIPs have ipi_only: true; template has ipi_only: true. No explicit “when external LB omit VIPs” or “UserManaged LB” path. No placementMode or “legacy vs failureDomains” in catalog. |
| clusterOSImage mutually exclusive with topology.template? | **Not encoded.** Both params exist; no conditionals.mutuallyExclusiveWith or equivalent. Doc says “choose one.” |
| Legacy and failureDomains mutually exclusive? | **Not encoded in catalog.** Backend uses placementMode; catalog does not define or reference placement strategy. |
| Region/zone/host-group relationships modeled? | **Region/zone yes** (failureDomains[].region, zone). **Host-group no** (Tech Preview; regionType, zoneType, hostGroup not in catalog). |
| Machine-pool parameters placed correctly? | **Yes.** Catalog places clusterOSImage, osDisk.diskSizeGB, cpus, coresPerSocket, memoryMB at platform.vsphere; matches 9.1.6. |
| Publish modeled correctly? | **Yes.** publish at root; description notes Internal not supported on non-cloud. |

**Exact mismatches:**

1. **platform.vsphere.loadBalancer.type** — Doc shows UserManaged with apiVIPs/ingressVIPs; catalog has no loadBalancer param.
2. **compute/controlPlane.platform.vsphere.zones** — Doc §2.4.5.4 shows zones array for machine-pool placement; catalog has no such path.
3. **Mutual exclusivity (clusterOSImage vs template)** — Implied by doc; not encoded in param metadata.
4. **Mutual exclusivity (legacy vs failureDomains)** — Enforced by backend via placementMode; not stated in catalog.
5. **tagIDs** — Appears in standard sample (#5) inside topology; not in param table 9.1.4 (likely Tech Preview or omitted from reference); catalog does not have it.

### STEP 3 — Structural Diff vs Backend Emission

**Reference:** `backend/src/generate.js` (vSphere block ~L300–418).

| Question | Answer |
|----------|--------|
| Could backend produce each example structure? | **Partially.** Produces: vcenters, failureDomains (with optional topology.template), diskType, apiVIPs, ingressVIPs; legacy path → vcenters + one failureDomain. **Cannot produce:** platform.vsphere.clusterOSImage; platform.vsphere.loadBalancer.type; compute/controlPlane.platform.vsphere.zones; any machine-pool params (osDisk, cpus, coresPerSocket, memoryMB). |
| Nesting correct? | **Yes.** failureDomains[].topology.template, vcenters[].datacenters, etc. are emitted with correct nesting. |
| Could both clusterOSImage and template appear? | **No.** Backend never emits clusterOSImage; only emits template inside failureDomains[].topology when provided. So both cannot appear; structure matches “choose one.” |
| Could both legacy and failureDomains appear? | **No.** Backend branches on placementMode; only one path is taken. Correct. |
| Region/zone mis-modeled? | **No.** failureDomains[].region, zone are emitted from vs.failureDomains. |
| Machine-pool emitted in correct location? | **N/A.** Backend does not emit platform.vsphere.clusterOSImage nor osDisk/cpus/coresPerSocket/memoryMB; cannot produce 9.1.6 or restricted full sample (#11) as documented. |

**Backend structural gaps:**

1. **clusterOSImage** — Not read from platformConfig.vsphere.clusterOSImage; never written to installConfig.platform.vsphere.clusterOSImage.
2. **Machine-pool (9.1.6)** — osDisk.diskSizeGB, cpus, coresPerSocket, memoryMB not emitted at platform.vsphere.
3. **loadBalancer.type** — Not read or emitted; UserManaged LB structure cannot be produced.
4. **compute/controlPlane.platform.vsphere.zones** — No vSphere-specific machine-pool placement; zones array not emitted.

### STEP 4 — Explicit Mutual Exclusivity Declaration

| Topic | Are they mutually exclusive? | Does the doc ever show both? | Encoded in metadata? |
|-------|------------------------------|------------------------------|------------------------|
| **clusterOSImage vs topology.template** | **Yes.** Doc: “Choose one of the following methods” for RHCOS image. | **No.** No single example shows both. Restricted sample (#11) shows clusterOSImage + failureDomains without template. | **No.** Catalog has both params; no conditionals.mutuallyExclusiveWith or equivalent. |
| **Legacy vs failureDomains** | **Yes.** Legacy flat params (9.1.5) vs vcenters + failureDomains (9.1.4); doc implies one placement model. | **No.** Examples are either legacy or failureDomains. | **Partially.** Backend encodes via placementMode; catalog does not declare. |
| **VIPs vs external load balancer** | **Conditional.** Doc: apiVIPs/ingressVIPs “omit when external load balancer.” User-managed LB example shows loadBalancer.type: UserManaged *with* apiVIPs/ingressVIPs (VIPs point to LB). So: “omit” when using pre-existing external LB; when UserManaged, VIPs still set. | Doc shows UserManaged + apiVIPs + ingressVIPs. | **No.** Catalog says “omit when using an external load balancer” but does not define loadBalancer.type or the UserManaged case. |

**Explicit statement:** Mutual exclusivity of clusterOSImage and topology.template is **implied by docs but not encoded** in params metadata. Legacy vs failureDomains is **encoded in backend only** (placementMode), not in catalog. VIP/external-LB relationship is **not fully encoded** (loadBalancer.type missing).

### STEP 5 — Close Phase B

**Structural reconciliation complete?** **No.** Gaps remain.

**Structural mismatches (catalog vs docs):**

1. Missing param: `platform.vsphere.loadBalancer.type` (UserManaged).
2. Missing param: `compute[].platform.vsphere.zones` / `controlPlane.platform.vsphere.zones` (machine-pool zone placement).
3. Doc-only in sample: `failureDomains[].topology.tagIDs` (not in 9.1.4 table; catalog does not model).

**Metadata deficiencies:**

1. clusterOSImage and topology.template: mutual exclusivity not encoded (no conditionals or mutuallyExclusiveWith).
2. Legacy vs failureDomains: not declared in catalog; only backend placementMode.
3. VIPs vs external LB: loadBalancer.type and “omit when external LB” not modeled.

**Backend structural gaps:**

1. clusterOSImage not emitted.
2. Machine-pool params (osDisk.diskSizeGB, cpus, coresPerSocket, memoryMB) not emitted.
3. loadBalancer.type not emitted.
4. compute/controlPlane.platform.vsphere.zones not emitted.

**Statement:** **Phase B incomplete due to the following gaps:** (1) Params catalog does not model loadBalancer.type or machine-pool zones; (2) mutual exclusivity (clusterOSImage vs template, legacy vs failureDomains) is not encoded in param metadata; (3) backend cannot emit clusterOSImage, machine-pool params, loadBalancer.type, or zones — therefore cannot produce the full restricted-network install-config example (#11) or the user-managed LB or multi-zone placement examples. Phase B structural validation is **complete as a review**; reconciliation (catalog + backend changes) is left to implementation.

---

## 2.5 Phase B Deep Reconciliation (Plan-Level Pass)

This section records the **Phase B deep reconciliation + Phase C metadata hardening** pass: full doc coverage verification, complete example inventory with exact URLs, structural diff vs params and backend, and metadata hardening. No UI or backend implementation; working doc and catalog metadata only.

### Phase B.1 — Full doc coverage verification

**Source:** docs.redhat.com only. Base: `https://docs.redhat.com/en/documentation/openshift_container_platform/4.20/`.

| Page / section | URL | Reviewed | Notes |
|----------------|-----|----------|--------|
| Parent vSphere install guide | .../html/installing_on_vmware_vsphere/ | Yes (TOC / links) | Book landing; IPI/UPI/Agent split. |
| Preparing to install | .../preparing-to-install-on-vsphere#installer-provisioned-infrastructure-installation | Yes | Section 1.3; links to 3 IPI sub-flows. |
| Installer-provisioned infrastructure (Chapter 2) | .../html/installing_on_vmware_vsphere/installer-provisioned-infrastructure | Yes (content fetched) | §§2.1–2.5; requirements, standard, customizations, restricted; sample install-config fragments; clusterOSImage/topology.template “choose one”; user-managed LB; multi-DC; host groups; multi-NIC. |
| Installation config parameters (Chapter 9) | .../html/installing_on_vmware_vsphere/installation-config-parameters-vsphere | Yes (content fetched) | 9.1.1–9.1.6; required, network, optional, vSphere (§9.1.4), deprecated (§9.1.5), machine pool (§9.1.6). |
| html-single (full book) | .../html-single/installing_on_vmware_vsphere/index | Not line-by-line | Anchors (e.g. #specifying-regions-zones-..., #installation-installer-provisioned-vsphere-config-yaml_...) listed in §2.2.2; content overlaps multipage chapter; full line-by-line scrape not re-run this pass (timeout risk). |

**Contextual conditionals captured from narrative:**

- apiVIPs/ingressVIPs: IPI only; omit when external load balancer; UserManaged LB example shows loadBalancer.type: UserManaged with apiVIPs/ingressVIPs still set.
- clusterOSImage vs topology.template: choose one for RHCOS image; never both in one example.
- Legacy flat (9.1.5) vs vcenters + failureDomains (9.1.4): one placement model per install-config; deprecated flat still supported.
- publish: Internal not supported on non-cloud (vSphere).
- topology.template: IPI only (9.1.4).
- regionType/zoneType/hostGroup, dataDisks: Tech Preview; out of scope.

**Gaps / incomplete:** (1) html-single was not re-fetched line-by-line this pass; example layouts at html-single anchors are as documented in §2.2.2 and §2.4. (2) Any “Show more” or collapsed blocks on live docs were not re-expanded this pass; prior pass used saved/fetched content.

### Phase B.2 — Example inventory (structural, with exact URLs)

Every install-config example or snippet relevant to vSphere IPI is listed below with exact URL, anchor, full/partial, use-case, key hierarchy, and which strategy it represents.

| # | Exact URL | Anchor | Multipage / html-single | Full / partial | Use-case | Key hierarchy | Legacy | FD | clusterOSImage | template | restricted | regions/zones | host-groups | machine-pool | VIPs | publish | LB type | vcenters |
|---|-----------|--------|--------------------------|----------------|----------|---------------|--------|----|----|----|----|----|----|----|----|----|----|----|
| 1 | installation-config-parameters-vsphere | §9.1.2 | multipage | partial | dual-stack networking | networking.clusterNetwork[], serviceNetwork[] | no | no | no | no | no | no | no | no | no | no | no | no |
| 2 | installation-config-parameters-vsphere | §9.1.4 | multipage | plaintext | vSphere params reference | platform.vsphere: apiVIPs, diskType, failureDomains, ingressVIPs, vcenters; failureDomains[].name, region, zone, server, topology.*; vcenters[].* | no | yes | — | topology | — | yes | hostGroup | — | yes | — | — | yes |
| 3 | installation-config-parameters-vsphere | §9.1.5 | multipage | plaintext | deprecated flat | platform.vsphere (flat): apiVIP, cluster, datacenter, defaultDatastore, folder, ingressVIP, network, password, resourcePool, username, vCenter | yes | no | no | no | no | no | no | no | yes | no | no | no |
| 4 | installation-config-parameters-vsphere | §9.1.6 | multipage | plaintext | machine-pool optional | platform.vsphere: clusterOSImage, osDisk.diskSizeGB, cpus, coresPerSocket, memoryMB, dataDisks[] | no | no | yes | no | no | no | no | yes | no | no | no | no |
| 5 | installer-provisioned-infrastructure | §2.4.5.1 (Sample install-config) | multipage | full (fragmented) | standard IPI | platform.vsphere: apiVIPs, failureDomains, ingressVIPs, vcenters, diskType | no | yes | no | no | no | no | no | no | yes | no | no | yes |
| 6 | installer-provisioned-infrastructure | §2.4.5.4 (multiple data centers) | multipage | partial | multi-DC, zones | compute/controlPlane.platform.vsphere.zones; platform.vsphere.vcenters.datacenters[], failureDomains[] | no | yes | no | no | no | yes | no | no | — | no | no | yes |
| 7 | installer-provisioned-infrastructure | §2.4.5.5 (host groups) | multipage | partial | host groups (Tech Preview) | failureDomains[].regionType, zoneType; topology.hostGroup | no | yes | no | no | no | yes | yes | no | no | no | no | yes |
| 8 | installer-provisioned-infrastructure | §2.4.5.6 (multiple NICs) | multipage | partial | multi-NIC | failureDomains[].topology.networks[] | no | yes | no | no | no | no | no | no | no | no | no | yes |
| 9 | installer-provisioned-infrastructure | §2.5 (RHCOS “choose one”) | multipage | partial | RHCOS image method | platform.vsphere.clusterOSImage: &lt;URL&gt; | no | no | yes | no | — | no | no | no | no | no | no | no |
| 10 | installer-provisioned-infrastructure | §2.5 (topology.template) | multipage | narrative | RHCOS image method | failureDomains[].topology.template: &lt;path&gt; | no | yes | no | yes | — | no | no | no | no | no | no | — |
| 11 | installer-provisioned-infrastructure | §2.5.7.1 (restricted sample) | multipage | full (fragmented) | restricted-network IPI | platform.vsphere: apiVIPs, failureDomains, ingressVIPs, vcenters, diskType, clusterOSImage | no | yes | yes | no | yes | no | no | no | yes | no | no | yes |
| 12 | installer-provisioned-infrastructure | §2.4.5.3 (user-managed LB) | multipage | partial | external LB | platform.vsphere.loadBalancer.type: UserManaged; apiVIPs; ingressVIPs | no | — | no | no | no | no | no | no | yes | no | UserManaged | — |

**Full URLs (4.20):**

- Multipage base: `https://docs.redhat.com/en/documentation/openshift_container_platform/4.20/html/installing_on_vmware_vsphere/`
- Parameters: `.../installation-config-parameters-vsphere`
- IPI chapter: `.../installer-provisioned-infrastructure`
- html-single base: `https://docs.redhat.com/en/documentation/openshift_container_platform/4.20/html-single/installing_on_vmware_vsphere/index`
- Regions/zones: `.../index#specifying-regions-zones-infrastructure-vsphere_post-install-vsphere-zones-regions-configuration`
- Regions/zones/host-groups: `.../index#installation-vsphere-regions-zones-host-groups_installing-restricted-networks-installer-provisioned-vsphere`
- Restricted large example: `.../index#installation-installer-provisioned-vsphere-config-yaml_installing-restricted-networks-installer-provisioned-vsphere`

### Phase B.3 — Structural diff vs params catalog (summary)

- **Keys represented:** All §9.1.4/9.1.6 keys except loadBalancer.type and compute/controlPlane.platform.vsphere.zones; Tech Preview (hostGroup, dataDisks) out of scope.
- **Nesting:** Correct (failureDomains[].topology.template, vcenters[].datacenters, etc.).
- **Requiredness:** Modeled per param (required true/false).
- **Deprecation:** Described in text for datacenter, defaultDatastore, vcenter; **structural** `deprecated` and `replacement` added in Phase C below.
- **Mutual exclusivity:** clusterOSImage vs template and legacy vs failureDomains were not structurally encoded; **Phase C** adds conditionals.
- **Scenario applicability:** ipi_only on apiVIPs, ingressVIPs, template; applies_to on all.
- **Topology:** region/zone in failureDomains; host-group Tech Preview not in catalog.
- **Replacement paths:** In description only; Phase C adds `replacement` where applicable.
- **Publish/LB/VIP:** publish at root; apiVIPs/ingressVIPs “omit when external LB” in description; loadBalancer.type not in catalog; Phase C adds conditionals.omitWhen for VIPs.
- **Machine-pool:** At platform.vsphere; placement (zones) not in catalog.

**Missing or shallow (catalog):** loadBalancer.type; zones; tagIDs; structural mutuallyExclusiveWith and omitWhen (addressed in Phase C as far as schema allows).

### Phase C — Metadata hardening (plan-level, structural)

**Applied to** `frontend/src/data/catalogs/vsphere-ipi.json`. Schema allows extra keys; validator does not reject `deprecated`, `replacement`, `conditionals`.

| Param(s) | Change |
|----------|--------|
| platform.vsphere.datacenter | `deprecated: true`, `replacement: "failureDomains[].topology.datacenter and vcenters[].datacenters"`, `conditionals.placementPath: "legacy"`, `conditionals.mutuallyExclusiveWith: ["platform.vsphere.vcenters", "platform.vsphere.failureDomains"]` |
| platform.vsphere.defaultDatastore | `deprecated: true`, `replacement: "failureDomains[].topology.datastore"`, `conditionals.placementPath: "legacy"`, `conditionals.mutuallyExclusiveWith: ["platform.vsphere.failureDomains"]` |
| platform.vsphere.vcenter | `deprecated: true`, `replacement: "vcenters[].server"`, `conditionals.placementPath: "legacy"`, `conditionals.mutuallyExclusiveWith: ["platform.vsphere.vcenters"]` |
| platform.vsphere.clusterOSImage | `conditionals.mutuallyExclusiveWith: ["platform.vsphere.failureDomains[].topology.template"]`, `conditionals.narrative` (choose one with template). Description tightened. |
| platform.vsphere.failureDomains[].topology.template | `conditionals.mutuallyExclusiveWith: ["platform.vsphere.clusterOSImage"]`, `conditionals.narrative`. Description tightened. |
| platform.vsphere.apiVIPs | `conditionals.omitWhen: "external load balancer (platform.vsphere.loadBalancer.type: UserManaged or pre-existing LB)"`, `conditionals.visibility: "IPI only; not for UPI"` |
| platform.vsphere.ingressVIPs | Same conditionals as apiVIPs. |

**Explicitly addressed:**

1. **clusterOSImage vs topology.template** — Structurally encoded via `conditionals.mutuallyExclusiveWith` and narrative on both params.
2. **Legacy flat vs failureDomains** — Structurally encoded via `deprecated`, `replacement`, and `conditionals.placementPath: "legacy"` and `mutuallyExclusiveWith` on datacenter, defaultDatastore, vcenter.
3. **VIPs vs external LB** — Structurally encoded via `conditionals.omitWhen` on apiVIPs and ingressVIPs; loadBalancer.type not in catalog (doc-supported structure; catalog does not yet have that key — schema limitation).
4. **Publish restrictions for vSphere** — Already in description for root-level publish (Internal not supported on non-cloud); no new key.
5. **Machine-pool optionality and placement** — Machine-pool params at platform.vsphere are optional (required: false); compute/controlPlane.platform.vsphere.zones not in catalog (schema/scope limitation).
6. **Regions/zones/host-groups** — failureDomains[].region, zone modeled; host-group (regionType, zoneType, hostGroup) Tech Preview, out of scope.
7. **Deprecated flat-field replacement** — replacement paths and mutuallyExclusiveWith added on deprecated params.

**Schema limitations (documented):** (1) Catalog does not define `platform.vsphere.loadBalancer.type` (UserManaged); adding it would require a new param entry. (2) Catalog does not define `compute[].platform.vsphere.zones` or `controlPlane.platform.vsphere.zones`; adding would require new param entries. (3) No single “placementMode” param; legacy vs failureDomains is inferred from which set of params is used (legacy flat vs vcenters/failureDomains).

### Phase D — Structural diff vs backend (summary)

**Reference:** `backend/src/generate.js` (vSphere block ~L300–418).

| Structural path | Backend can generate? | Nesting correct? | Both paths at once? | Omit required? | Doc-valid example? |
|-----------------|------------------------|------------------|----------------------|---------------|---------------------|
| clusterOSImage | No | N/A | No (never emits both) | — | No (cannot produce #11 with clusterOSImage) |
| topology.template | Yes | Yes | No | No | Yes |
| Legacy path | Yes (→ vcenters + one FD) | Yes | No (placementMode branch) | No | Yes |
| failureDomains path | Yes | Yes | No | No | Yes |
| Machine-pool (osDisk, cpus, etc.) | No | N/A | — | — | No |
| VIPs | Yes (when IPI and non-empty) | Yes | — | No | Yes |
| Omit VIPs when external LB | No (no loadBalancer.type; always emits if set) | — | — | — | Partial (no UserManaged path) |
| publish | Handled at root; not vSphere-specific | — | — | — | Yes |
| region/zone | Yes (from failureDomains) | Yes | No | No | Yes |
| loadBalancer.type | No | N/A | — | — | No |

**Backend structural gaps (unchanged):** clusterOSImage not emitted; machine-pool (osDisk, cpus, coresPerSocket, memoryMB) not emitted; loadBalancer.type not read or emitted; compute/controlPlane.platform.vsphere.zones not emitted.

### Phase E — Phase B closure decision (superseded by §2.6)

*This section recorded the status as of the plan-level pass. The final closure decision is in **§2.6 Phase 4**: **Phase B structural reconciliation complete.***

### Phase B deep + Phase C pass — Deliverables

- **Test/build/validation:** `node scripts/validate-catalog.js frontend/src/data/catalogs/vsphere-ipi.json` — passed. No backend or frontend code changed; no build run required.
- **Manual validation checklist (this pass):** (1) Working doc §2.5 has exact pages/anchors and example inventory with URLs. (2) Catalog has deprecated, replacement, conditionals on designated params. (3) Phase E closure decision recorded. (4) Backlog #49 updated with Phase B deep + Phase C status.
- **Git commands (do not run):** LOCAL_BACKLOG.md is gitignored; commit only the working doc and catalog.
  ```bash
  git status
  git diff docs/VSPHERE_4_20_IPI_DOC_REVIEW_AND_PLAN.md
  git diff frontend/src/data/catalogs/vsphere-ipi.json
  git add docs/VSPHERE_4_20_IPI_DOC_REVIEW_AND_PLAN.md frontend/src/data/catalogs/vsphere-ipi.json
  git commit -m "vSphere 4.20 IPI: Phase B deep reconciliation + Phase C metadata hardening (plan-level)"
  git push
  ```

---

## 2.6 Phase B Closure + Phase C Metadata Completion (Final Pass)

This section records the **Phase B closure + Phase C metadata completion** pass: full html-single verification, complete metadata modeling (loadBalancer.type, zones, publish, machine-pool), hard structural assertions, and binary closure decision.

### Phase 1 — Full html-single verification

**Source:** `https://docs.redhat.com/en/documentation/openshift_container_platform/4.20/html-single/installing_on_vmware_vsphere/` (full book fetched; 15,403 lines in converted output).

**Review performed:** Line-by-line search for install-config, platform.vsphere, clusterOSImage, topology.template, loadBalancer, failureDomains, apiVIPs, ingressVIPs, zones, compute, controlPlane. All YAML code blocks and narrative sections covering install-config were inspected.

**Examples found in html-single (all already recorded in §2.5):**

| Section (html-single) | Key hierarchy | Strategy | vcenters | failureDomains | clusterOSImage | template | publish | loadBalancer.type | zones | hostGroups | machine-pool |
|----------------------|---------------|----------|----------|----------------|----------------|----------|---------|-------------------|-------|------------|---------------|
| 2.4.5.1 Sample install-config | platform.vsphere: apiVIPs, failureDomains, ingressVIPs, vcenters, diskType | failureDomains | yes | yes | no | no | no | no | no | no | no |
| 2.4.5.4 Multiple data centers | compute/controlPlane.platform.vsphere.zones; platform.vsphere.vcenters.datacenters[], failureDomains[] | failureDomains, zones | yes | yes | no | no | no | no | yes | no | no |
| 2.4.5.5 Host groups | failureDomains[].regionType, zoneType; topology.hostGroup | host-groups (Tech Preview) | yes | yes | no | no | no | no | no | yes | no |
| 2.4.5.6 Multiple NICs | failureDomains[].topology.networks[] | failureDomains | yes | yes | no | no | no | no | no | no | no |
| 2.4.5.3 User-managed LB | platform.vsphere.loadBalancer.type: UserManaged; apiVIPs; ingressVIPs | UserManaged LB | — | — | no | no | no | yes | no | no | no |
| 2.5 “Choose one” RHCOS | platform.vsphere.clusterOSImage: &lt;URL&gt; | clusterOSImage | no | no | yes | no | no | no | no | no | no |
| 2.5 topology.template | failureDomains[].topology.template (narrative) | topology.template | — | yes | no | yes | no | no | no | no | no |
| 2.5.7.1 Restricted sample | platform.vsphere: apiVIPs, failureDomains, ingressVIPs, vcenters, diskType, clusterOSImage; publish: Internal (separate snippet) | failureDomains + clusterOSImage, restricted | yes | yes | yes | no | Internal (snippet) | no | no | no | no |

**Structural difference multipage vs html-single:** None. Content is the same; html-single is the single-page rendering of the same book. No additional install-config examples or key hierarchies appear in html-single that are not already in §2.5.

**Explicit statement:** **html-single review confirmed no additional structural examples beyond those recorded in §2.5.**

### Phase 3 — Hard structural assertions

| Question | Answer | Citation |
|----------|--------|----------|
| Does any example in docs show both clusterOSImage and topology.template together? | **No.** | Restricted sample (2.5.7.1) shows clusterOSImage with failureDomains; no topology.template in that sample. “Choose one” narrative (2.5) presents two separate methods; no single YAML block contains both. html-single lines 4104–4118, 4195–4296. |
| Does any example show both legacy and failureDomains? | **No.** | Legacy flat (9.1.5) and vcenters+failureDomains (9.1.4) are documented as separate placement models; no example combines flat platform.vsphere keys (vcenter, datacenter, cluster, …) with failureDomains array in the same config. |
| Does any example show VIPs when loadBalancer.type = UserManaged? | **Yes.** | User-managed LB section (2.4.5.3) shows loadBalancer.type: UserManaged in the same install-config snippet as apiVIPs and ingressVIPs. Doc: “Specify the following configuration… loadBalancer: type: UserManaged; apiVIPs: - &lt;api_ip&gt;; ingressVIPs: - &lt;ingress_ip&gt;.” html-single lines 3324–3341. |
| Does any example show zones without failureDomains? | **No.** | Multi-DC/zones example (2.4.5.4) shows compute/controlPlane.platform.vsphere.zones together with platform.vsphere.failureDomains; zones are zone names that match failureDomains[].name. No example shows zones in isolation. html-single lines 2194–2245. |
| Does any example place machine-pool fields somewhere other than platform.vsphere? | **No.** | Doc 9.1.6 and all examples place clusterOSImage, osDisk.diskSizeGB, cpus, coresPerSocket, memoryMB at platform.vsphere. compute[].platform.vsphere.zones is placement, not machine-pool sizing; sizing stays at platform.vsphere. |

### Phase 4 — Closure decision

**Phase B structural reconciliation complete.**

All doc-supported structural fields relevant to vSphere IPI are represented in the catalog (loadBalancer.type and compute/controlPlane.platform.vsphere.zones added this pass). Mutually exclusive strategies (clusterOSImage vs topology.template, legacy vs failureDomains) and VIP/LB/publish/machine-pool conditionals are structurally encoded. html-single verification confirmed no additional structural examples beyond §2.5. No unresolved structural gaps remain for Phase B (catalog and working doc); backend emission of new fields is out of scope for this pass.

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
| **Conditionals not implemented** | **Historical (reverted):** loadBalancer.type was planned then **removed**. App has no loadBalancer dropdown; UI note "Leave blank if using an external load balancer" covers external-LB case. VIPs remain on Networking; no emission of loadBalancer.type. |
| **Mutually exclusive** | Legacy vs failure-domains — app uses placementMode; only one path emitted. OK. |
| **Doc-valid asset fields impossible today** | clusterOSImage, osDisk.diskSizeGB, cpus, coresPerSocket, memoryMB (machine pool) — not emitted. Plan: optional advanced section. |
| **App not doc-aligned** | Publish Internal: doc says not supported on non-cloud; app may still allow selection — verify Global Strategy step and validation. |

---

## 6. Phase F — Implementation Plan (Plan Only)

**Locked truth (Phase B complete):** clusterOSImage vs topology.template are mutually exclusive (choose one). Legacy vs failureDomains are mutually exclusive (placementMode). Machine-pool fields live at platform.vsphere; zones at compute/controlPlane.platform.vsphere when multiple failure domains. Publish: Internal not supported on vSphere (External only). **Current implementation:** loadBalancer.type is **not** in the app (no dropdown, no emission); doc note for external LB is satisfied by the Networking UI note to leave VIPs blank when using an external load balancer.

### 6.1 Current state summary

- Docs-index: vsphere-ipi has parent, params page, Agent generic, disconnected; sub-scenario links (preparing, restricted-network) not explicitly listed.
- Params: Frontend catalog has full vSphere + generic install-config; diskType, apiVIPs, ingressVIPs, template (IPI); deprecated flat params; machine-pool params; **compute/controlPlane.platform.vsphere.zones**; conditionals for clusterOSImage/template, legacy, VIPs, publish. **No loadBalancer.type** in catalog (removed).
- Wizard: Placement (legacy vs failure domains), legacy fields (folder/resourcePool only when legacy), failure domain rows with topology and template (IPI), diskType, **API/Ingress VIPs on Networking** (note: leave blank if external LB); **Machine pool (advanced)** and **Zone placement** (when ≥2 FDs); publish vSphere: External only.
- Backend: Emits vcenters, failureDomains, diskType, apiVIPs/ingressVIPs (IPI), template (IPI), clusterOSImage when set (mutual exclusivity with template), machine-pool (osDisk, cpus, coresPerSocket, memoryMB), zones when ≥2 FDs; port 443; credentials when includeCredentials; publish External for vSphere. **Does not emit:** loadBalancer.type.

### 6.2 Desired end state (aligned to locked truth)

- **loadBalancer.type:** **Historical (not implemented).** The plan once included a dropdown; it was **removed**. Current behavior: no loadBalancer.type in UI or backend; API/Ingress VIPs on Networking with note "Leave blank if using an external load balancer"; backend emits apiVIPs/ingressVIPs when IPI and non-empty.
- **clusterOSImage vs topology.template:** UI enforces choose-one (e.g. radio or mutually exclusive sections); backend emits at most one (clusterOSImage at platform.vsphere OR template in failureDomains[].topology).
- **Legacy vs failureDomains:** Unchanged; placementMode selects path; only one path emitted.
- **Machine-pool:** Optional section (platform.vsphere: clusterOSImage, osDisk.diskSizeGB, cpus, coresPerSocket, memoryMB); backend emits when provided.
- **Zones:** When failureDomains has multiple entries, optional compute[].platform.vsphere.zones and controlPlane.platform.vsphere.zones (arrays of failure-domain names); backend emits when provided.
- **Publish:** For vSphere, only External allowed; Internal disabled or validation error with message (Internal not supported on non-cloud, BZ#1953035).
- **Preview/download:** Reflect all emitted fields; no deprecated flat keys in output.

### 6.3 Proposed docs-index changes

- Add optional doc entries for vsphere-ipi: preparing-to-install, installing-vsphere-ipi-standard, installing-restricted-networks-vsphere-ipi with correct URLs under **docs.redhat.com** (e.g. `https://docs.redhat.com/en/documentation/openshift_container_platform/4.20/...`) and tags. Do not use docs.openshift.com (shut down).
- Ensure installation-config-parameters-vsphere has notes: “9.1.4 vSphere cluster params; 9.1.5 deprecated; 9.1.6 machine pool.”

### 6.4 Proposed params metadata changes

- Add deprecated, replacement, and conditionals to deprecated flat params.
- Add machine-pool params with optional/advanced and Tech Preview where applicable.
- Encode “omit when external LB” for apiVIPs/ingressVIPs in conditionals.

### 6.5 Proposed tab-by-tab wizard changes

- **Platform Specifics (vSphere IPI):** **No Load balancer dropdown** (removed). Optional **Machine pool (advanced)** collapsible: clusterOSImage URL **or** (mutually exclusive) use topology.template per failure domain; osDisk.diskSizeGB, cpus, coresPerSocket, memoryMB. When multiple failure domains, add optional **Zone placement**: compute zones array, controlPlane zones array (names matching failureDomains[].name). Global folder/resourcePool only when legacy placement. Keep: Placement (legacy vs failure domains), Storage (diskType), Advanced (template per FD when failure-domains path).
- **Networking:** API/Ingress VIPs section visible for vSphere IPI; note: "Leave blank if using an external load balancer."
- **Global Strategy / Publish:** For platform vSphere, only External allowed; Internal disabled or validation error with message: “Internal publish is not supported on non-cloud platforms (vSphere). See BZ#1953035.”

### 6.6 Proposed gates / conditionals

- **loadBalancer.type:** **Not in app** (removed). No dropdown; no emission.
- **apiVIPs/ingressVIPs:** Visible on Networking when vSphere IPI; optional per doc (leave blank when using external LB). Validation: VIPs must be within machineNetwork when set.
- **clusterOSImage vs topology.template:** Mutually exclusive; UI must prevent both. If clusterOSImage set, hide/disable template in failure-domain rows and suppress template from emission. If any topology.template set, hide/disable clusterOSImage and suppress clusterOSImage from emission.
- **topology.template:** Visible only for vsphere-ipi when failure-domains path and when clusterOSImage not chosen.
- **Machine-pool section:** Visible for vSphere IPI when “Machine pool (advanced)” expanded; optional.
- **Zones:** Visible only when vSphere IPI and failureDomains length ≥ 2; optional.
- **Publish:** Internal disabled or invalid for vSphere.

### 6.7 Deprecation/replacement handling

- Legacy flat params: Keep in UI for legacy path; labels “Deprecated; prefer failure domains.” Backend emits only vcenters/failureDomains (no deprecated keys in YAML).
- apiVIP/ingressVIP: Not used in app; only apiVIPs/ingressVIPs. No change.

### 6.8 Backend emission changes

- **loadBalancer.type:** **Not emitted** (removed from implementation). No key in install-config.
- **apiVIPs/ingressVIPs:** Emit when vSphere IPI and arrays non-empty. Frontend validates VIPs within machineNetwork.
- **clusterOSImage:** Emit platform.vsphere.clusterOSImage when platformConfig.vsphere.clusterOSImage is set and topology.template is not used (mutual exclusivity enforced in UI; backend emits whichever path is set).
- **topology.template:** Emit in failureDomains[].topology when set and clusterOSImage not set (current behavior).
- **Machine-pool:** Emit platform.vsphere.osDisk.diskSizeGB, cpus, coresPerSocket, memoryMB when provided from platformConfig.vsphere.
- **Zones:** Emit compute[0].platform.vsphere.zones and controlPlane.platform.vsphere.zones when provided (arrays of zone names matching failureDomains[].name), only when failureDomains length ≥ 2.

### 6.9 Preview/download changes

- Same as backend; preview YAML and download bundle reflect emitted fields (no loadBalancer; VIPs when set; optional machine-pool and zones when set).

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

### 6.13 Implementation-grade field/gate matrix

| Field/path | Source | Required | Scenario path | Visible when | Required when | Suppress from preview/export when | Backend emit path | Replaces/conflicts | Tab | Control type |
|------------|--------|----------|---------------|--------------|---------------|-------------------------------------|-------------------|---------------------|-----|---------------|
| *(removed)* platform.vsphere.loadBalancer.type | — | — | — | — | — | — | — | **Not in app;** doc note satisfied by VIP helper text. | — | — |
| platform.vsphere.apiVIPs | 9.1.4 | when no pre-existing external LB | IPI | vSphere IPI | optional (leave blank if external LB) | when set, must be in machineNetwork | platform.vsphere.apiVIPs | — | Networking | text/array input |
| platform.vsphere.ingressVIPs | 9.1.4 | same as apiVIPs | IPI | vSphere IPI | vSphere IPI | never | platform.vsphere.ingressVIPs | — | Networking | text/array input |
| platform.vsphere.clusterOSImage | 9.1.6 | no | IPI | vSphere IPI, RHCOS method = URL | when chosen as RHCOS method | when topology.template used | platform.vsphere.clusterOSImage | mutually exclusive with topology.template | Platform Specifics > Machine pool (advanced) | text input |
| failureDomains[].topology.template | 9.1.4 | no | IPI, failure-domains path | vSphere IPI, failure-domains path, RHCOS method = template | when chosen per FD | when clusterOSImage set | failureDomains[].topology.template | mutually exclusive with clusterOSImage | Platform Specifics > FD row Advanced | text input |
| platform.vsphere.diskType | 9.1.4 | no | both | vSphere IPI | — | never | platform.vsphere.diskType | — | Platform Specifics > Storage | dropdown (thin, thick, eagerZeroedThick) |
| compute[].platform.vsphere.zones | Doc 2.4.5.4 | no | IPI, multi-FD | vSphere IPI, failureDomains.length ≥ 2 | — | when single FD or not set | compute[0].platform.vsphere.zones | — | Platform Specifics > Zone placement | array of zone names |
| controlPlane.platform.vsphere.zones | Doc 2.4.5.4 | no | IPI, multi-FD | vSphere IPI, failureDomains.length ≥ 2 | — | when single FD or not set | controlPlane.platform.vsphere.zones | — | Platform Specifics > Zone placement | array of zone names |
| platform.vsphere.osDisk.diskSizeGB, cpus, coresPerSocket, memoryMB | 9.1.6 | no | IPI | vSphere IPI, Machine pool expanded | — | when not set | platform.vsphere.* | — | Platform Specifics > Machine pool | number inputs |
| publish | 9.1.3 | no | both | always | — | — | root publish | — | Global Strategy | dropdown; vSphere: External only |
| platform.vsphere.datacenter, defaultDatastore, vcenter, … (legacy) | 9.1.5 | when legacy path | legacy | placementMode = legacy | placementMode = legacy | when failure-domains path | converted to vcenters+FD | deprecated; replaced by vcenters+failureDomains | Platform Specifics | inputs (legacy block) |
| platform.vsphere.vcenters, failureDomains | 9.1.4 | when failure-domains path | failure-domains | placementMode = failure-domains | placementMode = failure-domains, ≥1 FD | when legacy path | platform.vsphere.vcenters, failureDomains | mutually exclusive with legacy flat | Platform Specifics | add/remove rows, topology inputs |

### 6.14 Exact UI behavior (implementation spec)

1. **Section order (Platform Specifics, vSphere IPI):** (1) Placement (legacy vs failure domains); (2) Legacy block (iff legacy); (3) Failure domains block (iff failure-domains); (4) Storage — diskType; (5) Zone placement (iff failureDomains.length ≥ 2); (6) Machine pool (advanced) collapsible; (7) Advanced per-FD (template, folder, resourcePool).
2. **Default visible:** Placement, diskType. Failure domains or legacy block per placementMode. API/Ingress VIPs on **Networking** (vSphere IPI) with note to leave blank if external LB.
3. **Gated:** Zone placement only when failureDomains.length >= 2. Global folder/resourcePool only when placementMode = legacy. topology.template in each FD row; clusterOSImage in Machine pool; one disabled when the other has a value.
4. **Advanced:** Machine pool (clusterOSImage, osDisk, cpus, coresPerSocket, memoryMB); per-FD folder, resourcePool, template (when template method).
5. **Mutually exclusive choices:** (a) RHCOS image: clusterOSImage URL **or** topology.template per FD — radio or equivalent; only one path active. (b) Placement: legacy **or** failure-domains — existing placementMode.
6. **Hide entirely:** Legacy block when placementMode = failure-domains. Failure domains block when placementMode = legacy. Global folder/resourcePool when not legacy. Zone placement when single FD or no FDs.
7. **Helper text:** Networking VIPs: "Leave blank if using an external load balancer." Publish: for vSphere, "Internal is not supported on non-cloud platforms (vSphere)." Template: "(IPI only) Path to RHCOS template/VM in vCenter. Use this OR clusterOSImage URL, not both."

### 6.15 Exact backend emission rules

| Path | Emit when | Suppress when | YAML location | Default / conflict |
|------|-----------|---------------|---------------|--------------------|
| *(removed)* loadBalancer.type | — | — | — | Not in app. |
| apiVIPs | vSphere IPI and array non-empty | not IPI or empty | platform.vsphere.apiVIPs | — |
| ingressVIPs | vSphere IPI and array non-empty | not IPI or empty | platform.vsphere.ingressVIPs | — |
| clusterOSImage | platformConfig.vsphere.clusterOSImage set and no topology.template in use | topology.template used in any FD | platform.vsphere.clusterOSImage | Mutual exclusivity: emit only one of clusterOSImage vs template |
| topology.template | per FD when set and clusterOSImage not set | clusterOSImage set | failureDomains[i].topology.template | Same |
| osDisk.diskSizeGB, cpus, coresPerSocket, memoryMB | platformConfig.vsphere.* set | not set | platform.vsphere.* | Omit key if not set |
| compute[0].platform.vsphere.zones | platformConfig.vsphere.computeZones set, length ≥ 2 FDs | single FD or not set | compute[0].platform.vsphere.zones | — |
| controlPlane.platform.vsphere.zones | platformConfig.vsphere.controlPlaneZones set, length ≥ 2 FDs | single FD or not set | controlPlane.platform.vsphere.zones | — |
| publish | user selection | — | root publish | vSphere: only External valid; backend may receive only External if UI blocks Internal |
| vcenters, failureDomains | placementMode and inputs as today | — | platform.vsphere | Legacy path → build one vcenter + one FD from flat; FD path → use vs.failureDomains and/or vs.vcenters |

**Intentionally unsupported after implementation (callout):** dataDisks (Tech Preview) — not in scope for this pass. regionType/zoneType/hostGroup (Tech Preview) — not in scope.

### 6.16 Test plan (implementation pass)

**Frontend tests to add/update:**

- vSphere IPI: No loadBalancer dropdown. API/Ingress VIPs on Networking; note to leave blank if external LB; validateVipsInMachineNetwork when set.
- vSphere IPI: RHCOS method — when clusterOSImage has value, topology.template inputs disabled in FD rows; when any template set, clusterOSImage disabled; both visible, mutual exclusivity enforced.
- vSphere IPI: Zone placement section visible only when failureDomains.length ≥ 2.
- vSphere IPI: Machine pool (advanced) — clusterOSImage, osDisk, cpus, coresPerSocket, memoryMB visible when expanded; optional.
- Publish: when platform vSphere, Internal disabled or validation error; External selectable.
- Legacy vs failure-domains: legacy block hidden when failure-domains; FD block hidden when legacy.

**Backend tests to add/update:**

- (No loadBalancer.type emission.)
- Emit clusterOSImage when set and no template; do not emit template in that case.
- Emit template in FD when set and clusterOSImage not set; do not emit clusterOSImage.
- Emit osDisk.diskSizeGB, cpus, coresPerSocket, memoryMB when provided.
- Emit compute[0].platform.vsphere.zones and controlPlane.platform.vsphere.zones when provided and ≥2 FDs.
- apiVIPs/ingressVIPs emitted when IPI and non-empty. VIP-in-machine-network validation on frontend.

**Scenario matrix:**

- Legacy path → one vcenter, one failureDomain; no zones; no machine-pool unless set.
- Failure-domains path, single FD → no zones section; machine-pool optional.
- Failure-domains path, multi-FD → zones optional; machine-pool optional.
- No loadBalancer.type in app; VIPs emitted when IPI and set.
- clusterOSImage set → clusterOSImage emitted; no template in any FD.
- template set in one FD → template emitted there; clusterOSImage not emitted.

**Regression:**

- Existing legacy and failure-domains flows still produce correct vcenters/failureDomains.
- diskType, credentials, port 443 unchanged.

**Preview vs download parity:**

- Preview YAML and downloaded install-config.yaml must match: same keys emitted/suppressed (clusterOSImage, template, machine-pool, zones, VIPs; no loadBalancer).

### 6.17 Open questions / blockers

- **None** for the in-scope implementation. dataDisks (Tech Preview) and host-group (Tech Preview) are explicitly out of scope; no blocker.
- **Product decision (non-blocking):** Whether to show “Internal not supported” as disabled option with tooltip vs. hide Internal entirely for vSphere — both satisfy doc.

### 6.18 Implementation status (vSphere 4.20 IPI implementation pass)

| Item | Status | Notes |
|------|--------|-------|
| loadBalancer.type | **Removed** | No dropdown; no catalog param; no backend emission. UI note on Networking covers external-LB case. |
| apiVIPs/ingressVIPs | **Done** | On Networking tab; note "Leave blank if using an external load balancer." Backend emits when IPI and non-empty. validateVipsInMachineNetwork enforces VIPs in machineNetwork. |
| clusterOSImage vs topology.template | **Done** | UI: both visible; one disabled when the other has a value; hints explain choose-one. Backend: emits only one. Validation: error if both set. |
| Machine-pool (osDisk, cpus, coresPerSocket, memoryMB) | **Done** | Platform Specifics: Machine pool (advanced) collapsible. Backend: emits when provided. |
| compute/controlPlane.platform.vsphere.zones | **Done** | Platform Specifics: Zone placement when ≥2 FDs; comma-separated inputs. Backend: emits when provided and ≥2 FDs. |
| publish External only for vSphere | **Done** | Global Strategy: vSphere shows publish External only; useEffect normalizes Internal to External. Backend: forces publish External when vSphere. Validation: error if publish Internal. |
| Tests | **Done** | Backend: clusterOSImage/template, machine-pool, zones, publish (no loadBalancer). Frontend: Machine pool, Zone placement when ≥2 FDs; validation rejects publish Internal, both RHCOS methods; VIP-in-machine-network. |

### 6.19 Implementation notes

- When both clusterOSImage and template in an FD are in state, backend emits clusterOSImage and omits template from topology.
- dataDisks (Tech Preview) and regionType/zoneType/hostGroup (Tech Preview) are intentionally not implemented.

---

## Implementation complete (vSphere 4.20 IPI)

The implementation pass for vSphere 4.20 IPI per §6, §6.13–6.17 is complete. **loadBalancer.type was implemented then removed** (no dropdown, no emission; doc note satisfied by VIP helper text). Implemented: clusterOSImage vs topology.template mutual-exclusivity UX, machine-pool (advanced) fields, zone placement (≥2 FDs), publish External-only for vSphere, VIP-in-machine-network validation, legacy global folder/resourcePool gated to legacy placement, Topology: Networks comma handling fixed. featureSet and arbiter.* remain intentionally deferred (catalog only). Tests updated accordingly.

---

## 7. Phase G — Automation Foundation

### 7.1 Proposal

- **Script: docs-index discovery** — For a given version (e.g. 4.20) and platform (e.g. vsphere), fetch the platform install book TOC from **docs.redhat.com** (canonical; docs.openshift.com is shut down). Base URL: `https://docs.redhat.com/en/documentation/openshift_container_platform/<version>/`. Parse sections “Preparing to install,” “Installer-provisioned,” “User-provisioned,” “Restricted network,” and output a suggested doc tree (IDs, titles, URLs). Manual review before merging into docs-index.
- **Script: scenario doc mapping** — Input: scenarioId (e.g. vsphere-ipi). Output: list of doc IDs from docs-index for that scenario + sharedDocs that have install-config; optionally fetch each URL and check live.
- **Params reconciliation support** — Validate catalog against a “required param list” per scenario (e.g. from doc table scrape or hand-maintained list); report missing path, wrong required, or wrong type. No auto-edit.
- **Version-specific scenario truth** — Single source: data/docs-index/<version>.json and data/params/<version>/<scenario>.json. When adding 4.21, copy 4.20 scenario entries and update URLs/version; run refresh-doc-index and validate-catalog.

### 7.2 First-pass automation created (Phase G complete)

- **scripts/docs-index-discovery.js**: For a given version (default 4.20) and optional platform (vsphere, bare-metal-agent, aws-govcloud, or all), outputs suggested doc tree (IDs, path segments, full URLs) from known install-book path segments. Manual review before merging into docs-index. Usage: `node scripts/docs-index-discovery.js [version] [platform]`.
- **scripts/scenario-doc-mapping.js**: Reads data/docs-index/<version>.json, accepts scenarioId as arg, prints doc IDs and URLs for that scenario. **Extended with `--check-urls`**: fetches each doc URL (HEAD) and reports ok/fail. Usage: `node scripts/scenario-doc-mapping.js [scenarioId] [path/to/docs-index/4.20.json] [--check-urls]`.
- **scripts/validate-catalog-vs-doc-params.js**: Compares a scenario catalog to an optional hand-maintained "doc params" JSON (array of path strings or `{ path, required }`). Reports: in doc list not in catalog, required mismatch, in catalog not in doc list. No auto-edit. Usage: `node scripts/validate-catalog-vs-doc-params.js <catalog.json> [doc-params.json]`.
- **docs/PARAMS_RECONCILIATION_CHECKLIST.md**: Checklist for each scenario: (1) list params from doc tables, (2) list params in catalog, (3) diff; (4) list conditionals/deprecated from docs; (5) verify metadata. Use with validate-catalog-vs-doc-params.js when a doc-params list is maintained.
- **docs/PHASE_G_ADDING_A_VERSION.md**: Steps for adding a new version (e.g. 4.21): copy docs-index, update version/baseUrl/URLs, sync frontend copy, params/catalogs, validate, optional discovery and scenario-doc-mapping --check-urls. References DOC_INDEX_RULES, CANONICAL_DOC_SOURCE_AND_EXAMPLE_CAPTURE_RULES, PARAMS_RECONCILIATION_CHECKLIST.

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
- [ ] VIPs: API/Ingress VIPs on Networking tab; note "Leave blank if using an external load balancer." No loadBalancer.type in app. When set, VIPs must be in machineNetwork (validation). Emitted when IPI and non-empty.
- [ ] Publish: Internal not selectable or blocked for vSphere with clear message.
- [ ] clusterOSImage vs template: only one path in config; UI disables one when the other has a value; backend emits only one.
- [ ] Machine pool / zones: optional; emit when set per §6.15. Legacy global folder/resourcePool only when placementMode = legacy.

---

## 10. Test/Build Results (This Pass)

- **Implementation-plan tightening pass:** No code changes; working doc and backlog updated only. No build/validate required for this pass.
- (For prior passes: catalog validation `node scripts/validate-catalog.js frontend/src/data/catalogs/vsphere-ipi.json`; docs-index `node scripts/validate-docs-index.js` when docs-index edited.)

---

## 11. Git Commands (Do Not Run)

```bash
# Review (this pass: working doc only)
git status
git diff docs/VSPHERE_4_20_IPI_DOC_REVIEW_AND_PLAN.md

# Commit (when ready) — implementation-plan tightening pass
git add docs/VSPHERE_4_20_IPI_DOC_REVIEW_AND_PLAN.md
git commit -m "vSphere 4.20 IPI: implementation-plan tightening (field/gate matrix, UI/backend spec, test plan)"

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

## Doc clarifications (post-audit)

### vcenter port (9.1.4)

The parameter table for `platform.vsphere.vcenters[].port` in doc 9.1.4 states: "The port number used to communicate with the vCenter server" and "Value: Integer." The doc does **not** say that port is non-configurable or that it must be 443. So port is doc-supported as a **user-configurable integer** (default 443). The earlier audit statement that port was "not user-configurable" referred to **our app’s UI** (we do not currently expose a port field for vcenter entries), not to the documentation. Backend correctly emits `port` (443 or `vc.port` when provided). To align fully with the doc, the app could add an optional Port input per vCenter (default 443).

### apiVIPs / ingressVIPs — parameter table Note (no dropdown)

The 9.1.4 parameter table includes a **Note** for both `apiVIPs` and `ingressVIPs`:

> "This parameter applies only to installer-provisioned infrastructure without an external load balancer configured. You must not specify this parameter in user-provisioned infrastructure."

So when the user has an **external/self-managed load balancer**, they leave apiVIPs/ingressVIPs **blank**; the doc says these parameters are only included when the user does *not* have an external LB. We do **not** implement a load balancer type dropdown (UserManaged vs OpenShiftManagedDefault). The existing UI note is sufficient: **"Virtual IPs for API and ingress (vSphere IPI). Leave blank if using an external load balancer."** and the card note **"If using an external load balancer, leave API VIP and Ingress VIP blank."** That matches the doc: user leaves the fields blank when using external LB; when they provide VIPs, we emit them. No loadBalancer.type in UI or in emitted install-config from this app. Catalog: apiVIPs/ingressVIPs describe "leave blank when using an external load balancer"; no platform.vsphere.loadBalancer.type param entry.

### Machine pool: compute vs controlPlane (9.1.3 / 9.1.6)

**Are machine pool objects compute vs controlPlane specific?** Yes in the install-config schema: `compute` is an array of MachinePool objects (workers) and `controlPlane` is a MachinePool object (masters). Each has `architecture`, `name`, `platform`, `replicas`, and platform-specific sub-keys (e.g. `platform.vsphere`).

**For vSphere 9.1.6 (optional machine pool):** The parameter table describes clusterOSImage, osDisk.diskSizeGB, cpus, coresPerSocket, memoryMB at **platform.vsphere** only. The doc does **not** show these under `compute[].platform.vsphere` or `controlPlane.platform.vsphere`. So the documented shape is a **single set** at platform level that applies to the platform (installer may apply to all VMs or to a default pool depending on implementation).

**Different values for control plane vs compute (e.g. CPUs)?** The 4.20 vSphere param table (9.1.6) we reviewed does not document per-pool overrides for these fields. If the installer accepts `compute[0].platform.vsphere.cpus` and `controlPlane.platform.vsphere.cpus` separately, that would be an undocumented or platform-default behavior. We are **not** currently set up to support different machine-pool sizing for control plane vs compute: we have one set of fields (osDisk.diskSizeGB, cpus, coresPerSocket, memoryMB) and emit them only at **platform.vsphere**. So we match the documented 9.1.6 shape. To support per-pool values we would need separate state and backend emission for `compute[0].platform.vsphere.*` and `controlPlane.platform.vsphere.*` for those keys (and doc confirmation that the installer accepts them there).

**What we do emit per-pool today:** Only **zones** are emitted per-pool: `compute[0].platform.vsphere.zones` and `controlPlane.platform.vsphere.zones` when ≥2 failure domains. Replicas, architecture, and name are set on compute/controlPlane from blueprint/global strategy (worker/master, replicas, arch).

---

### Optional parameters (Table 9.3) — UI coverage

For the optional installation configuration parameters (Table 9.3 / 9.1.3), the following is where we account for them in the web UI when/where valid for the scenario:

| Parameter | In catalog (vsphere-ipi) | In UI / Step | Notes |
|-----------|--------------------------|--------------|--------|
| additionalTrustBundle | Yes | Trust & Proxy | PEM bundle + additionalTrustBundlePolicy |
| capabilities (baselineCapabilitySet, additionalEnabledCapabilities) | Yes | Platform Specifics > Advanced | Catalog-driven; shown when scenario has param |
| cpuPartitioningMode | Yes | Platform Specifics > Advanced | None / AllNodes |
| compute (architecture, name, platform, replicas) | Yes | Architecture: Blueprint. Replicas: Platform Specifics (control plane replicas, compute replicas). name: default worker/master in backend. platform: set from blueprint + platform-specific (e.g. vsphere zones) |
| controlPlane (architecture, name, platform, replicas) | Yes | Same as compute for arch/replicas/name/platform |
| featureSet | Yes | Not currently exposed in UI for vSphere IPI | Catalog has it; no step control for this scenario |
| arbiter (name, replicas) | Yes | Not currently exposed in UI for vSphere IPI | Catalog has it; typically used for specific topologies (e.g. some UPI); no step control for vSphere IPI |
| credentialsMode | Yes | Platform Specifics (and Global Strategy for some flows) | Mint / Passthrough / Manual |
| fips | Yes | Global Strategy / Identity & Access | Checkbox |
| imageContentSources | Yes | Connectivity & Mirroring | source + mirrors |
| publish | Yes | Global Strategy | External / Internal (vSphere: External only) |
| sshKey | Yes | Identity & Access | SSH public key |

So we cover most of Table 9.3 in the UI where they apply; **featureSet** and **arbiter** are in the catalog but not currently surfaced as controls for vSphere IPI (they could be added if needed). Machine-pool **replicas** and **architecture** are covered; **name** is defaulted in the backend.

---

## Appendix: Prompt addition for scenario first-pass

Use **`docs/CANONICAL_DOC_SOURCE_AND_EXAMPLE_CAPTURE_RULES.md`** in full. Copy or reference it in Phase B / full-doc-review (and docs-index) instructions so future scenario passes use the canonical doc source, full-scenario review requirements, either/or rules, config example coverage, docs-index and params cleanup requirements, and the completion rule (including the canonical docs normalization summary).

---
