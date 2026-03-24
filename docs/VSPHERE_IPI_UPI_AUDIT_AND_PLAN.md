# vSphere IPI / UPI Doc-Truth Audit and Implementation Plan

> Authority: Working scenario synthesis
> Canonical status source: `docs/BACKLOG_STATUS.md`
> Canonical navigation source: `docs/SCENARIOS_GUIDE.md`

**Scope:** OpenShift 4.20 disconnected vSphere IPI and vSphere UPI only.  
**Date:** 2026-03.  
**Status:** Audit, plan, and **implementation complete** (params metadata, Platform Specifics redesign, backend alignment, tests). Machine-pool params deferred.

---

## 1. Docs and Tables Reviewed

### Primary source (install-config parameters)

- **URL:** https://docs.redhat.com/en/documentation/openshift_container_platform/4.20/html/installing_on_vmware_vsphere/installation-config-parameters-vsphere  
- **Title:** Chapter 9. Installation configuration parameters for vSphere  
- **Sections used:**
  - 9.1.1 Required configuration parameters (apiVersion, baseDomain, metadata, platform, pullSecret)
  - 9.1.2 Network configuration parameters (networking.*, machineNetwork, clusterNetwork, serviceNetwork, ovnKubernetesConfig)
  - 9.1.3 Optional configuration parameters (additionalTrustBundle, capabilities, compute, controlPlane, credentialsMode, fips, imageContentSources, publish, sshKey, etc.)
  - **9.1.4 Additional VMware vSphere configuration parameters** — main vSphere-specific table (platform.vsphere.*)
  - 9.1.5 Deprecated VMware vSphere configuration parameters (cluster, datacenter, defaultDatastore, folder, apiVIP, ingressVIP, network, password, resourcePool, username, vCenter)
  - 9.1.6 Optional VMware vSphere machine pool parameters (clusterOSImage, osDisk.diskSizeGB, cpus, coresPerSocket, memoryMB, dataDisks)

### Scenario docs (index only; install-config params are in the link above)

- vSphere IPI: `installing_on_vmware_vsphere` (docs-index 4.20.json)  
- vSphere UPI: same book, user-provisioned path  
- Disconnected: `disconnected_environments` (shared)  
- Agent-based install config (shared): used for generic install-config params; vSphere-specific params come from installation-config-parameters-vsphere.

### Important doc notes

- **Dual-stack:** On vSphere, dual-stack can specify IPv4 or IPv6 as primary (doc 9.1.2).
- **apiVIPs / ingressVIPs:** Apply **only to IPI without external load balancer**. Must **not** be specified in UPI (doc 9.1.4).
- **failureDomains[].topology.template:** **IPI only**; RHCOS image template path (doc 9.1.4).
- **Deprecated (4.13+):** cluster, datacenter, defaultDatastore, folder, apiVIP, ingressVIP, network, password, resourcePool, username, vCenter. Still supported; preferred model is `vcenters[]` + `failureDomains[]`.
- **Tech Preview (not in scope for this app):** regionType, zoneType, hostGroup (host groups).

---

## 2. Install-Config Parameters Captured from Docs (vSphere-Specific)

| Parameter | IPI | UPI | Required | Notes |
|-----------|-----|-----|----------|--------|
| platform.vsphere.diskType | ✓ | ✓ | No | thin, thick, eagerZeroedThick; defaults to vSphere storage policy |
| platform.vsphere.apiVIPs | ✓ | **No** | Conditional | IPI only; omit when external LB |
| platform.vsphere.ingressVIPs | ✓ | **No** | Conditional | IPI only; omit when external LB |
| platform.vsphere.failureDomains | ✓ | ✓ | No | Array; defines placement |
| platform.vsphere.failureDomains[].name | ✓ | ✓ | No | String |
| platform.vsphere.failureDomains[].region | ✓ | ✓ | No | openshift-region tag or alphanumeric (e.g. datacenter) |
| platform.vsphere.failureDomains[].regionType | ✓ | ✓ | No | Tech Preview (ComputeCluster for host groups) |
| platform.vsphere.failureDomains[].server | ✓ | ✓ | No | vCenter FQDN or IP |
| platform.vsphere.failureDomains[].zone | ✓ | ✓ | No | openshift-zone tag or alphanumeric (e.g. cluster) |
| platform.vsphere.failureDomains[].zoneType | ✓ | ✓ | No | Tech Preview (HostGroup) |
| platform.vsphere.failureDomains[].topology.computeCluster | ✓ | ✓ | No | Path to compute cluster |
| platform.vsphere.failureDomains[].topology.datacenter | ✓ | ✓ | No | Must match vcenters[].datacenters |
| platform.vsphere.failureDomains[].topology.datastore | ✓ | ✓ | No | Datastore path for this FD |
| platform.vsphere.failureDomains[].topology.folder | ✓ | ✓ | No | Optional VM folder path |
| platform.vsphere.failureDomains[].topology.hostGroup | ✓ | ✓ | No | Tech Preview |
| platform.vsphere.failureDomains[].topology.networks | ✓ | ✓ | No | Network(s) with VIPs/DNS (array of strings in practice) |
| platform.vsphere.failureDomains[].topology.resourcePool | ✓ | ✓ | No | Optional resource pool path |
| platform.vsphere.failureDomains[].topology.template | **IPI only** | No | No | RHCOS image template path |
| platform.vsphere.vcenters | ✓ | ✓ | No | Array of connection objects |
| platform.vsphere.vcenters[].server | ✓ | ✓ | No | vCenter FQDN or IP |
| platform.vsphere.vcenters[].user | ✓ | ✓ | No | Username |
| platform.vsphere.vcenters[].password | ✓ | ✓ | No | Password |
| platform.vsphere.vcenters[].port | ✓ | ✓ | No | Integer; default 443 |
| platform.vsphere.vcenters[].datacenters | ✓ | ✓ | No | Array; must match failureDomains topology.datacenter |
| **Deprecated (still supported)** |
| platform.vsphere.vcenter | ✓ | ✓ | Legacy | Use vcenters[].server |
| platform.vsphere.datacenter | ✓ | ✓ | Legacy | Use failureDomains[].topology.datacenter / vcenters[].datacenters |
| platform.vsphere.defaultDatastore | ✓ | (✓) | Legacy | Use failureDomains[].topology.datastore |
| platform.vsphere.cluster | ✓ | ✓ | Legacy | Use failureDomains[].topology.computeCluster |
| platform.vsphere.folder | ✓ | ✓ | Legacy | Use failureDomains[].topology.folder |
| platform.vsphere.network | ✓ | ✓ | Legacy | Use failureDomains[].topology.networks |
| platform.vsphere.resourcePool | ✓ | ✓ | Legacy | Use failureDomains[].topology.resourcePool |
| platform.vsphere.username | ✓ | ✓ | Legacy | Use vcenters[].user |
| platform.vsphere.password | ✓ | ✓ | Legacy | Use vcenters[].password |
| platform.vsphere.apiVIP | ✓ | No | Deprecated | Use apiVIPs (list) |
| platform.vsphere.ingressVIP | ✓ | No | Deprecated | Use ingressVIPs (list) |
| **Machine pool (optional)** |
| platform.vsphere.clusterOSImage | ✓ | ✓ | No | HTTP(S) URL for RHCOS image |
| platform.vsphere.osDisk.diskSizeGB | ✓ | ✓ | No | Integer |
| platform.vsphere.cpus | ✓ | ✓ | No | Integer; multiple of coresPerSocket |
| platform.vsphere.coresPerSocket | ✓ | ✓ | No | Integer |
| platform.vsphere.memoryMB | ✓ | ✓ | No | Integer |
| platform.vsphere.dataDisks | ✓ | ✓ | No | Tech Preview; name, sizeGiB, provisioningMode |

---

## 3. Params File Audit Summary

### Files

- `frontend/src/data/catalogs/vsphere-ipi.json`
- `frontend/src/data/catalogs/vsphere-upi.json`

### Findings

1. **Citations:** Both catalogs cite Agent-based installer and platform-agnostic docs for generic params; vSphere-specific params cite `installation-config-parameters-vsphere` (docs.redhat.com) or `installing-vsphere-ipi` / `installing-vsphere-upi`. URLs are valid; the 4.20 vSphere parameter page was successfully fetched.
2. **vsphere-ipi:** Contains both deprecated flat params (platform.vsphere.datacenter, defaultDatastore, vcenter) and structured (vcenters, failureDomains with full topology). No explicit “deprecated” note in descriptions. **Missing from catalog:** platform.vsphere.diskType, apiVIPs, ingressVIPs, failureDomains[].topology.template (IPI-only), machine pool (clusterOSImage, osDisk.diskSizeGB, cpus, coresPerSocket, memoryMB, dataDisks).
3. **vsphere-upi:** Has platform.vsphere.datacenter and vcenter; **does not** list platform.vsphere.defaultDatastore. Backend and UI still use `datastore` (maps to defaultDatastore when emitting legacy flat); so the param is effectively used but not in UPI catalog. **Missing from catalog:** same as IPI except template (IPI-only); plus defaultDatastore if we want to document legacy/deprecated behavior for UPI.
4. **Applicability:** Params do not distinguish “IPI only” (apiVIPs, ingressVIPs, topology.template) vs “both” in a machine-readable way; applies_to is only scenario id (vsphere-ipi / vsphere-upi).
5. **Recommended params metadata changes (for implementation pass):**
   - Add to both: platform.vsphere.diskType (optional; thin | thick | eagerZeroedThick).
   - Add to vsphere-ipi only: platform.vsphere.apiVIPs, platform.vsphere.ingressVIPs (optional; IPI without external LB); platform.vsphere.failureDomains[].topology.template (optional; IPI only).
   - Add to vsphere-upi: platform.vsphere.defaultDatastore with description noting deprecated, prefer failureDomains[].topology.datastore.
   - Optionally add machine-pool params (clusterOSImage, osDisk.diskSizeGB, cpus, coresPerSocket, memoryMB) to both with “optional machine pool” note; dataDisks as Tech Preview.
   - Add short “Deprecated in 4.13+” to descriptions for datacenter, defaultDatastore, vcenter where kept.

---

## 4. Discrepancy Report

### 4.1 vSphere IPI

| Category | Finding |
|----------|---------|
| **Wizard fields not in params** | UI has vcenter, datacenter, datastore, cluster, network, folder, resourcePool, username, password; all have param coverage except “Default datastore” is defaultDatastore in params (present). diskType, apiVIPs, ingressVIPs, template, machine-pool fields not in params and not in wizard. |
| **Params not in wizard** | Most of catalog (generic install-config + vSphere) are not per-field in Platform Specifics; Identity/Networking/Connectivity/Trust cover others. Platform Specifics does not expose: diskType, apiVIPs, ingressVIPs, failureDomains[].topology.template, clusterOSImage, osDisk.diskSizeGB, cpus, coresPerSocket, memoryMB, dataDisks. |
| **Params in preview/download** | Backend emits vcenters and failureDomains (from flat or explicit arrays); credentials only when includeCredentials. Preview and download use same buildInstallConfig path — aligned. |
| **Params in metadata but absent from preview** | N/A; backend emits what it has from platformConfig. Optional params not collected (diskType, apiVIPs, etc.) are simply not emitted. |
| **Preview/download not in params** | None; emitted structure matches documented vcenters/failureDomains. |
| **Wizard fields with no output effect** | All vSphere fields in Platform Specifics feed platformConfig.vsphere and are used by generate.js (flat → vcenters/failureDomains or explicit arrays). |
| **Output without UI control** | port (hardcoded 443); vcenters[].datacenters derived from failure domain or single datacenter. |
| **Incorrectly shown for scenario** | apiVIPs/ingressVIPs are IPI-only and not shown in wizard at all (so no wrong exposure). NTP/API-VIP/Ingress-VIP gating in other steps follow generic logic; vSphere-specific gating in Platform Specifics is N/A except we could show apiVIPs/ingressVIPs only for IPI in a redesign. |
| **Conditional sections** | Failure domains section is optional (add/remove rows). No “external LB” toggle to conditionally hide apiVIPs/ingressVIPs (not yet in UI). |

### 4.2 vSphere UPI

| Category | Finding |
|----------|---------|
| **Wizard fields not in params** | Same flat fields as IPI. UPI catalog lacks defaultDatastore; UI still shows “Default datastore” and backend uses it for legacy flat build. |
| **Params not in wizard** | Same as IPI; diskType, machine-pool, etc. not in wizard. apiVIPs/ingressVIPs must not be used for UPI (doc); correctly not exposed. |
| **Params in preview/download** | Same backend path; vcenters/failureDomains. Aligned. |
| **Params in metadata but absent from preview** | defaultDatastore not in vsphere-upi.json; if we add it, it would be emitted when using legacy flat (backend already uses vs.datastore). |
| **Preview/download not in params** | None. |
| **Wizard fields with no output effect** | All used. |
| **Output without UI control** | Same as IPI (port 443, datacenters derivation). |
| **Incorrectly shown for scenario** | “Default datastore” is shown for UPI; doc says defaultDatastore is deprecated but still valid; no wrong exposure. |
| **Conditional sections** | Same as IPI. |

### 4.3 Wizard vs backend (both scenarios)

- **Single vCenter flat path:** vcenter + datacenter → vcenters; vcenter + datacenter + cluster + datastore + network → one failure domain; folder/resourcePool optional; username/password when includeCredentials.
- **Explicit failureDomains + vcenters:** Backend maps UI failureDomains[] and optional vcenters[] to install-config; vcenters derived from failure domains if not provided.
- **Gaps:** diskType never emitted. apiVIPs/ingressVIPs not collected or emitted. template not collected. Machine-pool (cpus, memoryMB, etc.) not in UI or backend.

---

## 5. Proposed Platform Specifics Redesign Plan (vSphere) — NOT IMPLEMENTED

Goal: Same overall look/feel, organization, and UX consistency as the AWS GovCloud IPI overhaul (grouping, spacing, hierarchy, helper text, gating, progressive disclosure).

### 5.1 Top-level section breakdown

**vSphere IPI**

1. **Connection** — vCenter server(s): single (legacy) or multi (vcenters list); credentials (optional; only emitted when “include credentials in export”).
2. **Placement** — Single-datacenter (legacy): datacenter, default datastore, compute cluster, VM network, folder, resource pool. **Or** Failure domains (add/remove rows; name, region, zone, server, topology: datacenter, computeCluster, datastore, networks, folder, resourcePool).
3. **IPI-only** — API VIPs, Ingress VIPs (with helper: only when no external load balancer); optional RHCOS template path (failureDomains[].topology.template).
4. **Storage / disk** — diskType (dropdown: thin | thick | eagerZeroedThick); optional machine-pool (advanced): osDisk.diskSizeGB, cpus, coresPerSocket, memoryMB.
5. **Advanced** (collapsible) — Same as today’s optional fields (folder, resource pool); plus any Tech Preview or rarely used (dataDisks deferred).

**vSphere UPI**

1. **Connection** — Same as IPI (vCenter server(s), credentials).
2. **Placement** — Same as IPI (legacy single or failure domains). No API/Ingress VIPs, no template.
3. **Storage / disk** — diskType; optional machine-pool (advanced) same as IPI.
4. **Advanced** — Same optional topology/credential options.

**Shared between IPI and UPI**

- Connection (vcenters / legacy single server).
- Placement (legacy single-datacenter vs failure domains).
- Storage: diskType; machine-pool optional in advanced.
- Credentials (optional; gated by export option).

**Different**

- IPI: apiVIPs, ingressVIPs, failureDomains[].topology.template; helper text that these are IPI-only and (for VIPs) “only without external LB”.
- UPI: Do not show apiVIPs, ingressVIPs, or template.

### 5.2 Field types

- **Text inputs:** vCenter server, datacenter, datastore, cluster, network, folder, resourcePool, username, password; failure domain name, region, zone, server, topology fields; template path; clusterOSImage URL.
- **Dropdown:** diskType (thin | thick | eagerZeroedThick).
- **Add/remove rows:** Failure domains; optionally vcenters (if we support multi-vCenter beyond deriving from FDs).
- **Conditional subsections:** “API / Ingress VIPs” only for vsphere-ipi; “RHCOS template” only for vsphere-ipi; “Failure domains” when user chooses “multiple failure domains” or add first row.
- **Toggles:** None required for vSphere per doc; “Include credentials” is global export option.

### 5.3 Gating / hiding (proposed)

| Field/section | Trigger | Reason | Source |
|---------------|---------|--------|--------|
| apiVIPs, ingressVIPs | scenarioId === "vsphere-ipi" | Doc: IPI only; must not be in UPI | Doc 9.1.4 |
| failureDomains[].topology.template | scenarioId === "vsphere-ipi" | Doc: IPI only | Doc 9.1.4 |
| API/Ingress VIPs subsection | Future: “External load balancer” unchecked | Doc: only when no external LB | Doc 9.1.4 |
| NTP / API-VIP / Ingress-VIP (other steps) | Already gated by platform/scenario where applicable | vSphere uses API/Ingress in install-config only for IPI; keep generic step gating as today | UX + doc |

### 5.4 Helper text and validation

- **diskType:** “Provisioning method for disks; defaults to vSphere storage policy if not set. thin / thick / eagerZeroedThick.”
- **apiVIPs/ingressVIPs:** “For IPI only when you are not using an external load balancer. Leave empty if using an external LB.”
- **template:** “(IPI only) Path to existing RHCOS image template or VM in vSphere for faster provisioning.”
- **Failure domains:** Keep and expand short note that “if you add any, they are used instead of the single vCenter/datacenter fields” and that datacenters must match vcenters.
- **Validation:** Require at least one of (legacy single: vcenter + datacenter + cluster + datastore + network) or (failureDomains with each FD having server, topology.datacenter, topology.computeCluster, topology.datastore, topology.networks). If failureDomains present, require vcenters (or derived) and matching datacenters.

### 5.5 Layout and consistency (AWS-style)

- Single card per major group (Connection, Placement, IPI-only if applicable, Storage, Advanced).
- Subsection titles and spacing consistent with AWS GovCloud step.
- Field-grid and label/help icon alignment; minimalistic first view; progressive disclosure (Advanced collapsed by default).
- No duplicate “vCenter server” in two places without clear “single” vs “multiple” choice.

---

## 6. Preview / Download Alignment Plan

- **Required:** platform.vsphere.vcenters (with server, datacenters) and failureDomains (with server, topology at least datacenter, computeCluster, datastore, networks) when user provides placement. Backend already emits these from flat or explicit arrays.
- **Optional:** diskType; apiVIPs/ingressVIPs (IPI only); template (IPI only); folder; resourcePool; credentials in vcenters when includeCredentials.
- **Conditional:** Omit apiVIPs/ingressVIPs when “external LB” (future). Emit credentials only when includeCredentials.
- **Unsupported for now (document only):** regionType, zoneType, hostGroup (Tech Preview); dataDisks (Tech Preview); clusterOSImage, osDisk, cpus, coresPerSocket, memoryMB until UI supports them.

---

## 7. Test Strategy Plan (for Implementation Pass)

- **Frontend:** Scenario-specific visibility: vSphere IPI shows apiVIPs/ingressVIPs and template; vSphere UPI does not. Platform Specifics structure: Connection, Placement, Storage, Advanced; failure domain add/remove.
- **Backend:** Preview and download: vSphere IPI and UPI emit vcenters and failureDomains; no apiVIPs/ingressVIPs for UPI; credentials only when includeCredentials; diskType when added.
- **Scenario matrix:** vsphere-ipi: flat path and explicit failureDomains path; vsphere-upi: same; both with and without credentials.
- **Regression:** Fields that must be hidden for one scenario (apiVIPs/ingressVIPs for UPI) never appear in generated install-config for UPI.
- **Params coverage:** Every param in catalog that is wired to UI has a test that exercises that path; optional params (diskType, apiVIPs, ingressVIPs, template) covered when implemented.

---

## 8. File-by-File Change Summary (Audit Pass Only)

- **No code or params changes** were made in this audit pass.
- **Added:** `docs/VSPHERE_IPI_UPI_AUDIT_AND_PLAN.md` (this file).
- **Updated:** `LOCAL_BACKLOG.md` with new item #44 (vSphere IPI/UPI audit and Platform Specifics redesign) and findings summary.

---

## 9. Manual Validation Checklist (for Later Implementation)

- [ ] vSphere IPI: Choose Blueprint + Methodology → vSphere IPI; Platform Specifics shows Connection, Placement, (IPI-only VIPs/template if implemented), Storage, Advanced.
- [ ] vSphere UPI: Same but no apiVIPs/ingressVIPs, no template.
- [ ] Legacy flat: vcenter, datacenter, datastore, cluster, network → preview/download has one vcenter and one failure domain.
- [ ] Explicit failure domains: Add 2 FDs with distinct topology → preview/download has 2 failureDomains and vcenters.
- [ ] Credentials: Include credentials in export → vcenters[].user/password present; otherwise omitted.
- [ ] apiVIPs/ingressVIPs: (When implemented) Only for IPI; not in UPI install-config.
