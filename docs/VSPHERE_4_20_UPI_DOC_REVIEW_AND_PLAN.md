# vSphere 4.20 UPI — Doc Review, Params Truth, AS-IS Inventory, and Implementation Plan

**Scope:** Platform VMware vSphere, OpenShift 4.20, Install method **User-provisioned infrastructure (UPI)** only.  
**Pass:** Scenario-by-scenario truth (Phases A–J). No implementation in this pass.

**Canonical base:** `https://docs.redhat.com/en/documentation/openshift_container_platform/4.20/`. Do not use docs.openshift.com (shut down).

---

## Phase A — Docs-index and scenario document mapping

### A.1 Automation used

- `node scripts/docs-index-discovery.js 4.20 vsphere` — Outputs suggested doc tree for vsphere (IPI-focused path segments). Does **not** list UPI-specific page; manual verification required.
- `node scripts/scenario-doc-mapping.js vsphere-upi` — Listed 4 docs for vsphere-upi: installation-config-parameters-agent, installing-disconnected, installing-vsphere-upi, installation-config-parameters-vsphere.
- `--check-urls` not run in this pass (optional).

### A.2 Manual verification: full vSphere UPI doc tree

| Level | Doc | URL / anchor | Notes |
|-------|-----|--------------|--------|
| Parent | Installing on VMware vSphere | .../html/installing_on_vmware_vsphere/ | Book landing; Chapter 3 = UPI. |
| UPI chapter | User-provisioned infrastructure | .../user-provisioned-infrastructure | Chapter 3; sections 3.1–3.5 (requirements, DNS, install-config, create manifests, create cluster; restricted-network variant). |
| UPI sample (standard) | Sample install-config.yaml | .../user-provisioned-infrastructure#... (3.3.4.1) | Section 3.3.4.1 Sample install-config.yaml for VMware vSphere. |
| UPI sample (restricted) | Sample install-config (restricted) | Section 3.4.4.1 / 3.5.5.1 | Same structure; imageContentSources when restricted. |
| Params (authoritative) | Installation configuration parameters for vSphere | .../installation-config-parameters-vsphere | **Chapter 9** — 9.1.1 required, 9.1.2 network, 9.1.3 optional, **9.1.4** vSphere, **9.1.5** deprecated, **9.1.6** machine pool. **apiVIPs/ingressVIPs:** "applies only to installer-provisioned infrastructure… You must not specify this parameter in user-provisioned infrastructure." **topology.template:** "available for use only on installer-provisioned infrastructure." |
| Shared | installation-config-parameters-agent | .../installation-config-parameters-agent | Generic 9.1 required/optional; used for baseDomain, metadata, pullSecret, etc. |
| Shared | Installing disconnected | .../disconnected_environments/index | When restricted-network / mirroring. |

### A.3 Docs-index current state (4.20)

**vsphere-upi** in `data/docs-index/4.20.json` has:

1. installation-config-parameters-agent (shared)
2. installing-disconnected (shared)
3. installing-vsphere-upi — URL: `.../user-provisioned-infrastructure#installing-vsphere`
4. installation-config-parameters-vsphere

**Assessment:** Doc IDs and URLs align with UPI chapter and parameter page. Parent guide and section anchors (e.g. 3.3.4.1 for sample) are not separate entries; acceptable as long as installing-vsphere-upi note or URL points to the UPI chapter. **Recommendation:** Add a docs-index note for installing-vsphere-upi: "Chapter 3 UPI; sample install-config §3.3.4.1, §3.4.4.1, §3.5.5.1; no apiVIPs/ingressVIPs/topology.template for UPI."

---

## Phase B — Full-scenario document review

### B.1 Pages / anchors reviewed

- **user-provisioned-infrastructure** (full chapter): 3.1 requirements, 3.1.3.1 vCenter privileges, 3.3.4.1 Sample install-config.yaml, 3.4.4.1 / 3.5.5.1 restricted variants, proxy, deprecated default config.
- **installation-config-parameters-vsphere**: 9.1.1 Required, 9.1.2 Network, 9.1.3 Optional, 9.1.4 Additional VMware vSphere (apiVIPs, ingressVIPs, failureDomains, topology.*, vcenters, diskType), 9.1.5 Deprecated, 9.1.6 Machine pool.

### B.2 UPI-specific structural findings

| Topic | Doc rule | UPI impact |
|-------|----------|------------|
| **apiVIPs / ingressVIPs** | 9.1.4: "applies only to installer-provisioned infrastructure… You must not specify this parameter in user-provisioned infrastructure." | **Must not** appear in UPI install-config. |
| **topology.template** | 9.1.4: "available for use only on installer-provisioned infrastructure." | **Must not** appear for UPI. |
| **clusterOSImage** | 9.1.6 machine pool; UPI sample does not include it. | User provisions VMs; not used in UPI flow. |
| **vcenters / failureDomains** | Same structure as IPI; required for platform.vsphere. | UPI sample has vcenters (server, user, password, port, datacenters), failureDomains (name, region, zone, server, topology: computeCluster, datacenter, datastore, networks, resourcePool, folder). |
| **diskType** | Optional; thin | thick | eagerZeroedThick. | Applies to UPI. |
| **Legacy deprecated (9.1.5)** | apiVIP, cluster, datacenter, defaultDatastore, folder, ingressVIP, network, password, resourcePool, username, vCenter. Replacement: vcenters + failureDomains. | UPI can use legacy flat or failureDomains path; same as IPI. |
| **publish** | 9.1.3: Internal not supported on non-cloud. | vSphere UPI: External only. |
| **compute.replicas** | UPI: set to 0 (user provisions workers). | Generic compute; not platform.vsphere. |
| **NTP** | Doc: ensure ESXi host time synchronized (VMware doc link). | No install-config NTP field in vSphere table; operational. |
| **Port** | vcenters[].port: integer; default 443. | Applies to UPI. |
| **Credentials** | user/password in vcenters; optional (include when needed). | Same as IPI. |

### B.3 Install-config examples captured (UPI)

| # | Location | URL / anchor | Content |
|---|----------|--------------|---------|
| 1 | UPI standard | user-provisioned-infrastructure §3.3.4.1 | platform.vsphere: failureDomains (name, region, server, zone, topology: computeCluster, datacenter, datastore, networks, resourcePool, folder), vcenters (datacenters, password, port, server, user), diskType. No apiVIPs, ingressVIPs, template, clusterOSImage. |
| 2 | UPI multi-DC | §3.3.x Sample with multiple data centers | vcenters and failureDomains arrays; same structure. |
| 3 | Parameter table 9.1.4 | installation-config-parameters-vsphere | Snippets per param; apiVIPs/ingressVIPs/template explicitly IPI-only. |

---

## Phase C — Params truth reconciliation

### C.1 Catalog reviewed

**File:** `frontend/src/data/catalogs/vsphere-upi.json`

### C.2 Params from docs (UPI-relevant)

- **Required (9.1.1):** apiVersion, baseDomain, metadata, metadata.name, platform, pullSecret.
- **Network (9.1.2):** networking.* (shared).
- **Optional (9.1.3):** additionalTrustBundle, publish, sshKey, compute, controlPlane, etc. publish: Internal not supported on non-cloud.
- **vSphere (9.1.4) — UPI:** vcenters (server, user, password, port, datacenters), failureDomains (name, region, zone, server, topology: computeCluster, datacenter, datastore, networks, folder, resourcePool). **Not for UPI:** apiVIPs, ingressVIPs, topology.template.
- **Deprecated (9.1.5):** datacenter, vcenter, defaultDatastore, folder, resourcePool (flat); replacement vcenters + failureDomains.
- **diskType:** Optional; thin | thick | eagerZeroedThick.

### C.3 Params in catalog (vsphere-upi)

- Generic: apiVersion, baseDomain, metadata, pullSecret, publish, networking-related, proxy, capabilities, fips, sshKey, compute, controlPlane, etc.
- **platform.vsphere:** failureDomains, failureDomains[].name, region, server, zone, topology.computeCluster, topology.datacenter, topology.datastore, topology.folder, topology.networks, topology.resourcePool; vcenters, vcenters[].server, user, password, port, datacenters; **legacy:** datacenter, vcenter, defaultDatastore; diskType.
- **No** apiVIPs, ingressVIPs, clusterOSImage, failureDomains[].topology.template in catalog for vsphere-upi (correct).

### C.4 Diff and conditionals

| In doc for UPI | In catalog | Action |
|----------------|------------|--------|
| vcenters, failureDomains, topology.* (no template) | Yes | OK. |
| diskType | Yes | OK. |
| Legacy flat (datacenter, vcenter, defaultDatastore) | Yes; deprecated noted | OK. |
| apiVIPs, ingressVIPs | Not in vsphere-upi catalog | Correct — must not specify for UPI. |
| topology.template | Not in vsphere-upi catalog | Correct — IPI only. |
| publish External only | publish in catalog; description "Internal not supported on non-cloud" | OK. Add conditionals if desired: vSphereAllowed External only. |
| vcenters[].port | Yes; default 443 | OK. |

**Reconciliation:** Catalog aligns with doc. No UPI-only params missing. Optional: add explicit conditionals on publish (e.g. allowed values External only for vSphere) and note on legacy flat "replacement: vcenters + failureDomains" where missing.

### C.5 Validation

- `node scripts/validate-catalog.js frontend/src/data/catalogs/vsphere-upi.json` — **Passed.**

---

## Phase D — Automation assessment

- **Automation helped with:** (1) Listing scenario docs and URLs for vsphere-upi. (2) Suggesting vsphere doc tree from discovery script (version + platform). (3) Catalog schema validation.
- **Manual work required:** (1) Confirm UPI chapter and section numbers (3.3.4.1, etc.) and that apiVIPs/ingressVIPs/template are IPI-only in param table. (2) Full read of user-provisioned-infrastructure and installation-config-parameters-vsphere. (3) Reconciliation of catalog to doc (no script for UPI doc-params list). (4) AS-IS app behavior (code read). (5) Delta and implementation plan.

---

## Phase E — AS-IS app inventory (vSphere 4.20 UPI)

### E.1 Wizard tabs (vsphere-upi)

| Tab | Shown | Notes |
|-----|--------|------|
| Methodology | Yes | Platform VMware vSphere, method UPI. |
| Identity & Access | Yes | Generic. |
| Networking | Yes | No API/Ingress VIPs (showVsphereIpiVips = scenarioId === "vsphere-ipi" only). |
| Connectivity & Mirroring | Yes | Generic. |
| Trust & Proxy | Yes | Generic. |
| Platform Specifics | Yes | Card "vSphere UPI"; Placement (legacy vs failure domains); legacy block or failure domain rows; diskType; **no** Zone placement, **no** Machine pool (advanced), **no** Topology: RHCOS template (all gated to scenarioId === "vsphere-ipi"). Global folder/resourcePool only when placementMode === "legacy" (showVsphereLegacyFolderResourcePool). |
| Host Inventory | No | SCENARIO_IDS_WITH_HOST_INVENTORY does not include vsphere-upi. |
| Operators | Yes | Generic. |
| Review / Generate | Yes | Generic. |

### E.2 Backend emission (generate.js)

- **vSphere block** runs for both IPI and UPI (`state.methodology?.method === "IPI" || state.methodology?.method === "UPI"`).
- **apiVIPs / ingressVIPs:** Emitted only when `isVsphereIpi` (IPI). **UPI: not emitted.** ✓
- **clusterOSImage, topology.template, zones, machine-pool (osDisk, cpus, etc.):** Only when `isVsphereIpi`. **UPI: not emitted.** ✓
- **vcenters, failureDomains, diskType:** Emitted for both. Legacy path: flat → one vcenter + one failureDomain. **UPI: emitted.** ✓
- **publish:** For VMware vSphere (IPI or UPI), forced to External if Internal. ✓
- **Credentials:** includeCredentials controls user/password in vcenters. ✓

### E.3 Preview / download assets

- install-config.yaml: Same backend path; reflects above (no apiVIPs/ingressVIPs/template/clusterOSImage/zones for UPI).

### E.4 Conditional-only emitted fields

- vcenters[].user, password: only when includeCredentials.
- failureDomains[].topology.folder, resourcePool: when set (legacy or per-FD).

### E.5 Fields with no UI control

- vcenters[].port: default 443 in backend; not in UI for vsphere-upi (same as IPI; optional to expose later).
- metadata.creationTimestamp: generated.

### E.6 Fields shown in UI but not used in final assets (UPI)

- None identified; UPI-specific sections (Zone placement, Machine pool, template) are hidden for vsphere-upi.

---

## Phase F — Delta analysis

### F.1 Current app vs emitted assets

- **Consistency:** Backend does not emit apiVIPs/ingressVIPs for UPI; UI does not show API/Ingress VIPs for vsphere-upi. Emitted vcenters/failureDomains/diskType match UI state. **No mismatch.**

### F.2 Corrected UPI truth vs current app

| Item | Doc truth | Current app | Status |
|------|-----------|-------------|--------|
| apiVIPs/ingressVIPs must not be specified for UPI | 9.1.4 Note | Not in catalog; not shown; not emitted | ✓ |
| topology.template IPI only | 9.1.4 | Not in vsphere-upi catalog; template field only in IPI FD rows | ✓ |
| vcenters, failureDomains structure | UPI sample | Emitted; legacy path builds one vcenter + one FD | ✓ |
| publish External only | 9.1.3 | Backend forces External for vSphere (IPI and UPI) | ✓ |
| diskType optional | 9.1.4 | Emitted when set | ✓ |
| Legacy flat deprecated | 9.1.5 | Catalog labels deprecated; UI shows when legacy | ✓ |
| vcenters[].port default 443 | 9.1.4 | Backend emits 443; not in UI | Minor: no UI for port. |
| Docs-index note for UPI sample sections | — | Not present | Optional: add note to docs-index. |

---

## Phase G — Implementation plan (plan only)

### G.1 Current state summary

- vSphere 4.20 UPI is supported: docs-index has vsphere-upi; catalog vsphere-upi.json has platform.vsphere params (no apiVIPs/ingressVIPs/template); UI shows vSphere UPI card with placement and failure domains; backend emits vcenters, failureDomains, diskType; publish forced to External.
- No structural gaps for UPI-only params (must-not-specify apiVIPs/ingressVIPs/template are satisfied).

### G.2 Desired end state (minimal delta)

1. **Docs-index:** Add optional note to installing-vsphere-upi entry: e.g. "Chapter 3 UPI; sample §3.3.4.1; apiVIPs/ingressVIPs/template not for UPI."
2. **Catalog:** Optional metadata: publish conditionals (External only for vSphere); legacy flat explicit replacement text where missing.
3. **UI:** No change required for UPI-only behavior (VIPs and IPI-only sections already gated).
4. **Backend:** No change (UPI already excluded from apiVIPs/ingressVIPs/template/clusterOSImage/zones).
5. **Tests:** Ensure backend test "must NOT emit apiVIPs or ingressVIPs" for vsphere-upi remains; optional frontend test that API/Ingress VIPs section is not shown for vsphere-upi.

### G.3 Proposed changes (if any)

- **Docs-index:** Optional note on vsphere-upi installing-vsphere-upi doc entry.
- **Catalog:** Optional: add `conditionals` or description for publish (External only on non-cloud) and legacy params (replacement: vcenters + failureDomains). No removal of params.
- **No** new UI or backend logic for UPI beyond what exists.

### G.4 Test plan

- Backend: vsphere-upi must not emit apiVIPs, ingressVIPs (existing smoke test).
- Frontend: Platform Specifics for vsphere-upi shows "vSphere UPI", placement, failure domains; no Zone placement, no Machine pool (advanced), no Topology: RHCOS template (existing test that VIPs not shown for vsphere-upi).
- Optional: validate-catalog-vs-doc-params with a hand-maintained UPI doc-params list to catch drift.

---

## Phase H — Open questions / blockers

- **None** for establishing source of truth. Optional: whether to expose vcenters[].port in UI for UPI (doc allows integer; default 443).

---

## Phase I — Deliverables summary

- **Docs/pages/anchors reviewed:** user-provisioned-infrastructure (Ch 3), §3.3.4.1, §3.4.4.1, §3.5.5.1; installation-config-parameters-vsphere 9.1.1–9.1.6; installation-config-parameters-agent (shared).
- **Docs-index:** Current vsphere-upi entries correct; optional note on installing-vsphere-upi.
- **Params/catalog:** Reconciled; no UPI-invalid params; optional metadata for publish and legacy.
- **AS-IS inventory:** Documented above (E.1–E.6).
- **Discrepancy analysis:** No structural gaps; optional docs-index note and catalog conditionals.
- **Implementation plan:** Minimal (docs-index note, optional catalog metadata, tests as above).
- **Automation vs manual:** Automation used for scenario doc list and discovery; manual for full review, reconciliation, inventory, delta, plan.

---

## Phase J — Backlog and git commands

### Backlog text (vSphere 4.20 UPI scenario truth)

**Suggested backlog entry:**

- **vSphere 4.20 UPI first-pass (scenario truth):** Docs-index and params aligned to docs.redhat.com 4.20. UPI: no apiVIPs/ingressVIPs/topology.template (doc 9.1.4); vcenters, failureDomains, diskType, legacy flat supported; publish External only. AS-IS: UI and backend already correct (no VIPs for UPI; IPI-only sections gated). Optional: docs-index note for UPI sample sections; catalog conditionals for publish and legacy. See `docs/VSPHERE_4_20_UPI_DOC_REVIEW_AND_PLAN.md`.

### Exact git review commands (do not run)

```bash
git status
git diff docs/VSPHERE_4_20_UPI_DOC_REVIEW_AND_PLAN.md
git diff data/docs-index/4.20.json
git diff frontend/src/data/catalogs/vsphere-upi.json
git diff LOCAL_BACKLOG.md
```

**Do NOT run:** `git add`, `git commit`, `git push`.
