# vSphere IPI/UPI Corrective Follow-up — Doc and Code Findings

> Authority: Working verification note
> Canonical status source: `docs/BACKLOG_STATUS.md`
> Canonical navigation source: `docs/SCENARIOS_GUIDE.md`

**Date:** 2026-03.  
**Scope:** Final corrective pass before using vSphere as replication template for other platforms.

---

## Phase 1 — Doc / Code Truth Verification

### A. Placement mode ownership

- **vSphere IPI and UPI (4.20):** The deprecated flat fields (vCenter server, datacenter, defaultDatastore, cluster, network) are **replaced by** the `vcenters[]` + `failureDomains[]` model (docs 9.1.4, 9.1.5). Both paths are still supported; preferred is failure domains.
- **Requiredness by path:**
  - **Legacy path:** vCenter server, datacenter, default datastore, compute cluster, and VM network are all required to emit a single failure domain. No requirement for the `failureDomains` array in state.
  - **Failure-domains path:** At least one failure domain with server, topology.datacenter, computeCluster, datastore, and networks is required for IPI. Top-level vcenter/datacenter are **not** required (they are legacy-only).
- **Implementation:** Validation and UI now require only the fields that belong to the selected path. Legacy fields are shown and required only when "Use legacy single placement" is selected; failure-domain fields only when "Use failure domains" is selected.

### B. NTP applicability

- **Finding:** NTP is **applicable** to vSphere IPI and UPI. The app emits NTP via **MachineConfig** (`99-chrony-ntp-master.yaml`, `99-chrony-ntp-worker.yaml`), which is platform-agnostic. OpenShift 4.20 does not put NTP in install-config for vSphere; time sync is applied via Machine Config Operator.
- **Conclusion:** Do **not** hide or gate the NTP section in Connectivity & Mirroring for vSphere. Leave it visible. AWS GovCloud is gated for other reasons (e.g. environment-specific time sync); vSphere follows the standard path.

### C. API/Ingress VIP placement

- **Decision:** vSphere IPI API/Ingress VIPs are implemented in the **shared Networking tab** with scenario gating, not in Platform Specifics.
- **Rationale:** One "API and Ingress VIPs" section that shows for (1) bare metal, (2) vSphere IPI. For vSphere IPI the section shows comma-separated inputs bound to `platformConfig.vsphere.apiVIPs` and `platformConfig.vsphere.ingressVIPs`. No duplicated controls; backend emission remains IPI-only. vSphere UPI does not show the VIP section (catalog has no platform.vsphere.apiVIPs for UPI; `showVsphereIpiVips = scenarioId === "vsphere-ipi"`).

### D. Port 443

- **Finding:** OpenShift 4.20 installation configuration parameters for vSphere (9.1.4) document `vcenters[].port` as optional with **default 443**.
- **Conclusion:** Emitting `port: 443` implicitly when the user does not specify a port is **correct and doc-aligned**. No user-facing control is required; the backend and `generate.js` comment document this.

---

## Corrective changes implemented

1. **Password layout:** vCenter password label is above the field; input and Show/Hide toggle are on one row. Matches standard app pattern (label above field).
2. **Placement ownership:** Connection shows "vCenter server" and "Datacenter" only when legacy placement is selected. Failure-domains path shows only username/password in Connection (credentials used when deriving vcenters from FDs).
3. **Validation:** Legacy path requires vcenter, datacenter, defaultDatastore, cluster, network. Failure-domains path requires at least one valid failure domain for IPI only; no top-level vcenter/datacenter requirement.
4. **Preview/download emission:** Backend uses a single decision branch: `useLegacyPlacement` → only flat path (never read `state.failureDomains`). When not legacy, only `failureDomains`/`vcenters` path (never build from flat). FD mode with zero FDs emits only explicit `vcenters` if provided, no legacy-derived failureDomains.
5. **NTP:** No gating for vSphere; NTP section remains visible.
6. **VIP location:** vSphere IPI API/Ingress VIPs moved to Networking step; removed from Platform Specifics. Same state (`platformConfig.vsphere.apiVIPs` / `ingressVIPs`); backend unchanged.

---

## Reusable rule for future platform work

**Cross-tab scenario validation:** For every platform/scenario, validate that fields and emitted assets (install-config, MachineConfig, etc.) align with official docs and that visibility/requiredness are consistent across tabs (e.g. NTP, VIPs, placement). Document applicability before gating or hiding.
