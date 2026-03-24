# vSphere 4.20 IPI — Structural Integrity Audit

> Authority: Working verification note
> Canonical status source: `docs/BACKLOG_STATUS.md`
> Canonical navigation source: `docs/SCENARIOS_GUIDE.md`

**Scope:** Code-level truth validation of completed implementation. No planning, no code changes, no commit.

**Update (post-audit):** The load balancer type dropdown was **removed**. The doc Note (“parameter applies only to IPI without an external load balancer”) is satisfied by the existing UI note: “Virtual IPs for API and ingress (vSphere IPI). Leave blank if using an external load balancer.” No `platform.vsphere.loadBalancer.type` in UI or emitted install-config; user leaves VIPs blank when using external LB.

---

## ITEM 1 — loadBalancer.type vs API/Ingress VIPs

**Question:** What structural capability does `platform.vsphere.loadBalancer.type` add that is not already encoded by the presence or absence of apiVIPs/ingressVIPs?

### 1. Exact doc examples where loadBalancer.type appears

- **Working doc:** Example #12, installer-provisioned-infrastructure §2.4.5.3 (user-managed LB). Key hierarchy: `platform.vsphere.loadBalancer.type: UserManaged; apiVIPs; ingressVIPs`.
- **Citation:** `docs/VSPHERE_4_20_IPI_DOC_REVIEW_AND_PLAN.md` §2.2.2 / §2.5 Phase B.2 table row #12: "platform.vsphere.loadBalancer.type: UserManaged; apiVIPs; ingressVIPs".
- **Doc URL:** `https://docs.redhat.com/en/documentation/openshift_container_platform/4.20/html/installing_on_vmware_vsphere/installer-provisioned-infrastructure` (section 2.4.5.3 Deploying with user-managed load balancer).

### 2. Exact examples where VIPs appear

- Same example (#12): loadBalancer.type: UserManaged **with** apiVIPs and ingressVIPs in the same install-config.
- Working doc: "Doc shows UserManaged + apiVIPs + ingressVIPs." (e.g. §2.3 table, §2.5 B.2).
- Catalog: `frontend/src/data/catalogs/vsphere-ipi.json` paths `platform.vsphere.apiVIPs`, `platform.vsphere.ingressVIPs` (lines 1378, 1394).

### 3. Whether loadBalancer.type changes requiredness of VIPs

- **Doc:** User-managed LB example shows loadBalancer.type: UserManaged **and** apiVIPs/ingressVIPs set (VIPs are the LB endpoints). Requiredness of VIPs is not reduced when UserManaged.
- **Backend:** `backend/src/generate.js` lines 441–445: apiVIPs and ingressVIPs are emitted when `isVsphereIpi && Array.isArray(vs.apiVIPs) && vs.apiVIPs.length > 0` (and same for ingressVIPs). There is no condition on `loadBalancerType`. VIP emission is independent of loadBalancer.type.
- **Conclusion:** loadBalancer.type does **not** change requiredness of VIPs in code or in the doc example.

### 4. Whether backend behavior differs based on loadBalancer.type

- **Backend:** Lines 417–418: when `vs.loadBalancerType === "UserManaged"` or `"OpenShiftManagedDefault"`, `vsphere.loadBalancer = { type: vs.loadBalancerType }` is set. Lines 441–445: VIPs are emitted solely based on IPI + non-empty arrays. No branch on loadBalancerType for VIPs.
- **Conclusion:** Backend differs only in that it **adds** the `loadBalancer` block when loadBalancerType is set; it does not suppress or require VIPs based on loadBalancer.type.

### 5. Whether the dropdown is redundant

- **No.** Without the dropdown, the app cannot emit `platform.vsphere.loadBalancer: type: UserManaged` (or OpenShiftManagedDefault). The doc example #12 includes this key. Presence or absence of apiVIPs/ingressVIPs does not express "user-managed LB" vs "installer-managed default"; only the loadBalancer block does.

### 6. If redundant, explain structurally why

- Not redundant (see 5).

### 7. If not redundant, what structural state it controls

- It controls whether the install-config contains `platform.vsphere.loadBalancer.type` (OpenShiftManagedDefault or UserManaged). That is the structural distinction documented in §2.4.5.3 for user-managed load balancer.

### Conclusion ITEM 1

**Is this dropdown structurally necessary? YES.**

Without it, the YAML cannot match the documented user-managed LB example (example #12). VIPs alone do not encode that distinction.

---

## ITEM 2 — Missing vcenter port field

**Docs show vcenters[].port.**

### 1. Exact doc reference for port

- **Working doc:** §2.2.2 table row #2 (installation-config-parameters-vsphere §9.1.4): "vcenters[].datacenters, password, **port**, server, user". Row #5: "vcenters (datacenters, password, **port**, server, user)".
- **Catalog:** `frontend/src/data/catalogs/vsphere-ipi.json` line 1233: `"path": "platform.vsphere.vcenters[].port"`, type int, default 443, description "Port for vCenter server. Default 443.", sectionHeading "9.1.4. VMware vSphere cluster parameters".

### 2. Search codebase for "port" under platform.vsphere

- **backend/src/generate.js:**  
  - Line 305 (comment): "vcenters[].port: 4.20 doc default 443 (installation-config-parameters-vsphere 9.1.4); emit 443 when not specified."  
  - Line 328: legacy path single vcenter: `port: 443`.  
  - Line 381: explicit vcenters: `port: Number(vc.port) || 443`.  
  - Line 395: vcenters derived from FDs: `port: 443`.  
  - Line 408: explicit vcenters (FD mode, no FDs): `port: Number(vc.port) || 443`.

### 3. Whether port is hardcoded / emitted unconditionally / user-configurable / missing

- **Emitted:** Always. Every vcenter object has a port.
- **Value:** 443 when building from legacy or from failure-domains (derived vcenters); `Number(vc.port) || 443` when explicit `vs.vcenters` is used. So it is **hardcoded 443** for legacy and FD-derived vcenters; **user-configurable only when** the state has explicit vcenters with `vc.port` (no UI in the current app for vcenter port).
- **Not missing:** Port is present in emitted YAML.

### 4. If hardcoded, exact line

- **Hardcoded 443:** Lines 328, 395 (and effectively 381, 408 when vc.port is absent or 0).

### 5. If missing, why previous plan claimed full coverage

- Port is not missing. Plan correctly noted vcenters[].port in catalog and backend (working doc §2.4 table "vcenters[].*" includes port).

### Conclusion ITEM 2

**Is port structurally implemented correctly? YES.**

Port is documented (9.1.4), in the catalog (`vcenters[].port`, default 443), and emitted for every vcenter (443 or `vc.port`). It is not user-configurable in the UI when using legacy or FD-derived vcenters; only when using explicit vcenters with a port property.

---

## ITEM 3 — Failure domain networks comma blocking

**UI label says comma-separated. User cannot type comma.**

### 1. Exact code for Topology: Networks input

- **File:** `frontend/src/steps/PlatformSpecificsStep.jsx`
- **Line 906–907:**  
  - Label/hint: "Topology: Networks" — "4.20 doc: array of network name strings. Enter one or more VM network names separated by commas; e.g. VM Network or VM Network, DPG-1."  
  - Value: `Array.isArray(fd.topology?.networks) ? fd.topology.networks.join(", ") : (fd.topology?.networks || "")`  
  - onChange: `(e) => updateFailureDomainTopology(index, { networks: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })`
- **No** onKeyDown, pattern, maxLength, or preventDefault found on this input that would block comma. No wrapper component found in this file that strips commas.

### 2. Backend expectation

- **backend/src/generate.js** lines 354–360: `networks` from `top.networks`; `networksArray = Array.isArray(networks) ? networks : (networks ? [networks] : [])`; emitted as `networks: networksArray` when length > 0. Backend expects an **array** of strings.

### 3. Catalog metadata

- **frontend/src/data/catalogs/vsphere-ipi.json** line 1094: `"path": "platform.vsphere.failureDomains[].topology.networks"`, type "array", allowed "array of network name strings".

### 4. Multiple values supported?

- **Yes.** Doc and catalog describe an array; UI stores array via split(","); backend emits array.

### Conclusion ITEM 3

**Is this a validation/input-handling bug? NO.**

No code found that prevents comma entry. The Networks input explicitly uses comma as delimiter (`.split(",")` in onChange). Value is displayed as `networks.join(", ")`. If the user cannot type comma, the cause is not in the identified PlatformSpecificsStep input (e.g. could be browser/IME, another component, or a different build). **No offending line identified** in this codebase.

---

## ITEM 4 — Global vSphere folder / vSphere resource pool (bottom Advanced)

**Global fields:** "vSphere folder", "vSphere resource pool" in bottom Advanced. **Not** failureDomains[].topology.folder / resourcePool.

### 1. Doc citations for global platform.vsphere.folder and resourcePool

- **Working doc** §2.2.2 table row #3 (installation-config-parameters-vsphere §9.1.5): "platform.vsphere (flat): apiVIP, cluster, datacenter, defaultDatastore, **folder**, ingressVIP, network, password, **resourcePool**, username, vCenter" — **deprecated** flat params.
- **docs/VSPHERE_IPI_UPI_AUDIT_AND_PLAN.md:** "platform.vsphere.folder | ✓ | ✓ | Legacy | Use failureDomains[].topology.folder"; "platform.vsphere.resourcePool | ✓ | ✓ | Legacy | Use failureDomains[].topology.resourcePool".

### 2. Applicability (IPI/UPI, legacy only, FD path, both)

- Doc 9.1.5: deprecated **flat** params at platform.vsphere. Flat params are the **legacy** placement model. So platform.vsphere.folder and platform.vsphere.resourcePool apply to **legacy placement only** in the doc.

### 3. Whether deprecated

- **Yes.** 9.1.5 lists folder and resourcePool as deprecated; replacement is failureDomains[].topology.folder and failureDomains[].topology.resourcePool.

### 4. Whether in current params/catalog for vSphere IPI

- **Catalog:** No top-level `platform.vsphere.folder` or `platform.vsphere.resourcePool` entries. Catalog has only `platform.vsphere.failureDomains[].topology.folder` and `platform.vsphere.failureDomains[].topology.resourcePool` (lines 1074, 1114).

### 5. Catalog-backed vs stale/manual

- The global "vSphere folder" and "vSphere resource pool" in the UI are **not** backed by a catalog entry for platform.vsphere.folder or platform.vsphere.resourcePool. They are effectively the deprecated flat params implemented as manual/hardcoded fields in the Advanced section.

### 6. Whether backend consumes global folder/resourcePool and under which path(s)

- **backend/src/generate.js** lines 343–345: in **legacy** path only, `...(vs.folder ? { folder: vs.folder } : {}), ...(vs.resourcePool ? { resourcePool: vs.resourcePool } : {})` are added to the **single** failureDomain’s topology. So backend **does** consume `platformConfig.vsphere.folder` and `platformConfig.vsphere.resourcePool` when `placementMode === "legacy"`. When placementMode is failureDomains, backend does **not** read vs.folder or vs.resourcePool; it only reads per-FD topology.folder and topology.resourcePool.

### Conclusion ITEM 4

**Are the global bottom-Advanced "vSphere folder" and "vSphere resource pool" structurally valid for this scenario? PARTIALLY.**

- **Legacy path:** Valid. They map to deprecated flat platform.vsphere.folder/resourcePool; backend emits them into the single FD’s topology (lines 343–345). Doc 9.1.5 supports these for legacy.
- **Failure-domains path:** Not used. Backend does not read or emit them; only per-FD topology.folder and topology.resourcePool are used. So for FD mode the global fields are **stale** (no emission).
- **Catalog:** Does not define platform.vsphere.folder or platform.vsphere.resourcePool; only topology.folder and topology.resourcePool. So the global fields are not catalog-backed; they are legacy-only and deprecated.

**Addressed:** Global "vSphere folder" and "vSphere resource pool" are now **gated to legacy placement only** (PlatformSpecificsStep). They appear in Advanced only when `placementMode === "legacy"`. Labels/hints state "(optional, legacy)" and reference 9.1.5 deprecation and per-FD topology for failure-domains path. Advanced subtitle shows "vSphere folder/resource pool (legacy placement only)" only when legacy. In failure-domains mode the global fields are hidden; user uses Topology: Folder and Topology: Resource pool in each failure domain's Advanced section.

---

## ITEM 5 — RHCOS strategy modeling depth

### 1. Exact doc wording for clusterOSImage method

- **Working doc** §2.2.1: "Set the value to the image **location or URL**. Example: clusterOSImage: http://mirror.example.com/images/rhcos-43.81.201912131630.0-vmware.x86_64.ova?sha256=..." (from Red Hat 4.20 doc "Choose one of the following methods" for RHCOS image).

### 2. Exact doc wording for topology.template method

- **Working doc** §2.2.1: "(1) Download the RHCOS vSphere OVA to your system (see 'Creating the RHCOS image for restricted network installations' if applicable). (2) In vSphere Client: Hosts and Clusters → right‑click cluster → Deploy OVF Template → select OVA, set VM name (e.g. Template-RHCOS), choose folder and compute resource and storage; do **not** customize template. (3) In install-config, set topology.template to the **path** where you imported the image in vCenter."

### 3. Procedural steps difference

- **clusterOSImage:** Config-only — set URL in install-config.
- **topology.template:** OVA download → Deploy OVF Template in vSphere Client (name, folder, compute, storage; do not customize) → set topology.template to the vCenter path in install-config.

### 4. How UI explains the difference

- **PlatformSpecificsStep.jsx** lines 1013–1033: Machine pool (advanced) note: "Choose one RHCOS image strategy: clusterOSImage URL or topology.template per failure domain. Do not set both." clusterOSImage hint: "URL for RHCOS image. Use this OR topology.template per failure domain, not both." When clusterOSImage is set, note: "clusterOSImage is set; template per failure domain is omitted." Per-FD template hint (line 913): "Absolute path to a pre-existing RHCOS image template or VM in vSphere. Use this OR clusterOSImage URL, not both."
- **Missing in UI:** The doc’s **procedural** steps for topology.template (download OVA, Deploy OVF Template, do not customize) are not repeated in the UI; only the either/or and path vs URL distinction is stated.

### 5. How backend enforces difference

- **backend/src/generate.js:** clusterOSImage emitted when set (lines 421–423). Template in FD topology emitted only when clusterOSImage is not set (line 364: `!(vs.clusterOSImage && String(vs.clusterOSImage).trim() !== "")`). So at most one of clusterOSImage or template is emitted; backend enforces mutual exclusivity.

### Conclusion ITEM 5

**Does the current UI accurately reflect the documented structural distinction? YES for structure; PARTIAL for narrative.**

- **Structure:** Choose-one (URL vs path), mutual exclusivity, and placement (platform.vsphere vs failureDomains[].topology) are reflected. Backend enforces one path only.
- **Narrative:** The documented procedural steps for topology.template (OVA download, Deploy OVF, do not customize) are not reproduced in the UI; only the parameter-level distinction (URL vs path, do not set both) is explained.

---

## ITEM 6 — Region / zone / tag relationship

### 1. Doc references (region, zone, tag, host-group)

- **Working doc:** failureDomains[].region, zone in §2.2.2 (rows #2, #5, #6, #8). topology.tagIDs in sample #5 (not in 9.1.4 table; catalog does not model). regionType, zoneType, topology.hostGroup in §2.4.5.5 / example #7 (Tech Preview).
- **Catalog:** failureDomains[].region (line 954), failureDomains[].zone (line 994); compute[].platform.vsphere.zones, controlPlane.platform.vsphere.zones (lines 1476, 1491). No tagIDs, regionType, zoneType, or hostGroup in catalog (Tech Preview / out of scope).

### 2. Relevant YAML examples

- **Working doc** §2.2.2: #5 — failureDomains (name, region, zone, server, topology: ... tagIDs); #6 — compute/controlPlane.platform.vsphere.zones; #7 — failureDomains[].regionType, zoneType; topology.hostGroup.

### 3. Documented relationship model

- **Region/zone:** failureDomains[].name, region, zone define failure domains; for multi-DC, compute/controlPlane.platform.vsphere.zones (arrays of zone names matching failureDomains[].name) control placement. Doc §2.4.5.4.
- **Tags:** Sample #5 shows topology.tagIDs; not in 9.1.4 param table; not modeled in app.
- **Host-group:** regionType, zoneType, hostGroup (Tech Preview); doc §2.4.5.5; out of scope for app.

### 4. Catalog representation

- **Catalog:** failureDomains[].region, zone (description: openshift-region / openshift-zone tag for multiple FDs). compute[].platform.vsphere.zones, controlPlane.platform.vsphere.zones (zone names matching failureDomains[].name). No tagIDs, regionType, zoneType, hostGroup.

### 5. Backend emission

- **backend/src/generate.js:** failureDomains[].region and zone emitted from fd.region, fd.zone (lines 367–368). compute[0].platform.vsphere.zones and controlPlane.platform.vsphere.zones emitted when fdCount >= 2 and vs.computeZones / vs.controlPlaneZones provided (lines 448–458). No emission of tagIDs, regionType, zoneType, or hostGroup.

### 6. Current UI capability

- **UI:** Per-FD text inputs for region and zone. When ≥2 FDs, Zone placement section with comma-separated compute zones and control plane zones (stored as arrays). No UI for tagIDs, regionType, zoneType, or hostGroup.

### Conclusion ITEM 6

**Does the current implementation fully model documented region/zone/tag relationships? NO.**

- **Modeled:** failureDomains[].region and zone (free text); compute/controlPlane.platform.vsphere.zones (arrays of names matching FD names) when ≥2 FDs. This matches the multi-DC/zones placement model in the doc.
- **Not modeled:** failureDomains[].topology.tagIDs (in sample #5; not in 9.1.4 table); failureDomains[].regionType, zoneType; topology.hostGroup (all Tech Preview, explicitly out of scope). So the app does not support tag linkage or host-group linkage; it supports region/zone as text and zones arrays for placement only.

---

## Final summary table

| Item | Status | Root cause | Required fix category |
|------|--------|------------|------------------------|
| 1 — loadBalancer.type vs VIPs | **Correct** | Dropdown is structurally necessary to emit loadBalancer block per doc example #12; VIP requiredness unchanged. | None. |
| 2 — vcenter port | **Correct** | port is in catalog (vcenters[].port, default 443) and emitted (443 or vc.port) in backend. | None. |
| 3 — FD networks comma | **Correct** | No code found that blocks comma; input uses comma as delimiter and backend expects array. | None (unless bug is outside this codebase). |
| 4 — Global folder/resourcePool | **Incomplete** | Global fields are legacy-only and deprecated; backend uses them only for legacy path. For FD path they are not emitted and are stale. Catalog does not define platform.vsphere.folder/resourcePool. | Catalog change (optional: add deprecated flat folder/resourcePool for legacy); Frontend change (optional: show global folder/resourcePool only when legacy, or label as legacy-only). |
| 5 — RHCOS strategy depth | **Incomplete** | Structural distinction (choose one, URL vs path) and backend enforcement are correct. Doc procedural steps for topology.template are not in UI. | Frontend change (optional: add helper text with procedural steps for template method). |
| 6 — Region/zone/tag | **Incomplete** | region, zone, and compute/controlPlane zones are modeled; tagIDs, regionType, zoneType, hostGroup are not (Tech Preview / out of scope). | Doc correction (clarify tagIDs/host-group as Tech Preview); no code fix required for current scope. |

---

**No code was modified. No commit. No staging.**
