# vSphere Hardening Pass — Doc Verification Findings

> Authority: Working verification note
> Canonical status source: `docs/BACKLOG_STATUS.md`
> Canonical navigation source: `docs/SCENARIOS_GUIDE.md`

**Date:** 2026-03.  
**Scope:** OpenShift 4.20 vSphere IPI/UPI; no UI changes in Phase 1.

---

## Phase 1 — Doc Verification

### 1. Dual-stack IPv6 support (vSphere IPI / vSphere UPI)

**Finding:** **Dual-stack IPv6 is supported** for OpenShift 4.20 on vSphere (IPI and UPI).

- **Source:** `docs/VSPHERE_IPI_UPI_AUDIT_AND_PLAN.md` (audit): *"Dual-stack: On vSphere, dual-stack can specify IPv4 or IPv6 as primary (doc 9.1.2)."*
- **Source:** OpenShift 4.20 installation configuration parameters (network section 9.1.2) apply to vSphere; dual-stack with OVNKubernetes is documented for the platform.
- **Implication:** **No Networking tab gating** for vSphere. Do **not** hide or disable the IPv6 / dual-stack controls for vSphere IPI or vSphere UPI (unlike AWS GovCloud, which is IPv4-only per 4.20 and is already gated in `NetworkingV2Step.jsx` via `isAwsGovCloud`).

**Networking gating plan (if it had been unsupported):** Would mirror AWS GovCloud: set `showIpv6ForPlatform = enableIpv6 && !isAwsGovCloud && !isVsphere` and add a note that vSphere install-config supports IPv4 only. **Not applied** — vSphere supports dual-stack.

---

### 2. diskType allowed values

**Finding:** The allowed values for `platform.vsphere.diskType` are **complete and correct** per OpenShift 4.20 vSphere docs.

- **Allowed values:** `thin` | `thick` | `eagerZeroedThick`
- **Source:** `docs/VSPHERE_IPI_UPI_AUDIT_AND_PLAN.md` (parameter table): *"platform.vsphere.diskType … thin, thick, eagerZeroedThick; defaults to vSphere storage policy"*
- **Source:** Official 4.20 install-config parameters for vSphere (section 9.1.4 Additional VMware vSphere configuration parameters).
- **Implication:** No change to allowed values. Validation and dropdown should only offer these three (plus a non-selectable “Not set” placeholder).

---

## References

- `docs/VSPHERE_IPI_UPI_AUDIT_AND_PLAN.md` — audit and parameter table
- https://docs.redhat.com/en/documentation/openshift_container_platform/4.20/html/installing_on_vmware_vsphere/installation-config-parameters-vsphere (sections 9.1.2, 9.1.4)

---

## Hardening implementation (Phases 2–7)

- **Phase 2:** Explicit placement selector: “Use failure domains (recommended)” vs “Use legacy single placement (deprecated)”. Only the selected path is rendered; both stored in state. Backend uses `placementMode === "legacy"` to emit only flat path and ignores `failureDomains` array when legacy.
- **Phase 3:** diskType placeholder option is `disabled`; frontend test asserts placeholder is not selectable.
- **Phase 4:** vCenter password has Show/Hide toggle (pull-secret style), `autoComplete="off"`, `data-form-type="other"` to discourage save.
- **Phase 5:** vSphere folder/resource pool moved into the step-level Advanced section; single Advanced block when vSphere or other advanced content is present.
- **Phase 6:** Tooltips upgraded for diskType (thin/thick/eagerZeroedThick), failureDomains region/zone, template (IPI), apiVIPs/ingressVIPs (external LB caveat).
- **Phase 7:** Backend test added: `placementMode === "legacy"` with state failureDomains present still emits only the flat-built single FD (fd-0), not the array entries.
