# Bare Metal 4.20 UPI — Working Doc

Working record for the Bare Metal / 4.20 / UPI scenario truth and implementation alignment.

## Snapshot

- **Scenario ID:** `bare-metal-upi`
- **Version:** 4.20
- **Install method:** User-provisioned infrastructure (UPI)
- **Primary docs (verified):**
  - Bare metal install book (parent):  
    `https://docs.redhat.com/en/documentation/openshift_container_platform/4.20/html/installing_on_bare_metal/`
  - Bare metal UPI chapter (Chapter 2):  
    `https://docs.redhat.com/en/documentation/openshift_container_platform/4.20/html/installing_on_bare_metal/user-provisioned-infrastructure`
  - Installation config parameters (Agent-based installer, shared):  
    `https://docs.redhat.com/en/documentation/openshift_container_platform/4.20/html/installing_an_on-premise_cluster_with_the_agent-based_installer/installation-config-parameters-agent`
  - Disconnected / mirroring (shared):  
    `https://docs.redhat.com/en/documentation/openshift_container_platform/4.20/html/disconnected_environments/index`
  - Platform-agnostic (proxy, trust bundle):  
    `https://docs.redhat.com/en/documentation/openshift_container_platform/4.20/html/installing_on_any_platform/installing-platform-agnostic`

## Doc tree / mapping

| Doc | Purpose |
|-----|--------|
| installing_on_bare_metal (root) | Parent bare metal install guide |
| user-provisioned-infrastructure | UPI chapter: prerequisites, DNS, load balancer, sample install-config, RHCOS install, bootstrap, add workers |
| installation-config-parameters-agent | Shared install-config param tables; 9.1.4 bare metal params (apiVIPs/ingressVIPs, etc.) |
| installing-disconnected | Restricted network / mirroring |
| installing-platform-agnostic | Proxy, additionalTrustBundle, sample install-config |

**docs-index:** `data/docs-index/4.20.json` and `frontend/src/data/docs-index/4.20.json` both define `bare-metal-upi` with:
- `installation-config-parameters-agent`
- `installing-disconnected`
- `installing-bare-metal-upi` → URL `.../installing_on_bare_metal/user-provisioned-infrastructure`

## Doc findings (Phase B scrub)

1. **Sample install-config (2.1.12.1):**  
   - `platform: none: {}` — UPI uses platform type `none`.  
   - No `platform.baremetal` in the doc sample.  
   - User must provision API and application Ingress load balancers; DNS points to those LBs.

2. **API / Ingress:**  
   - UPI doc describes external API and Ingress load balancers (DNS, HAProxy example).  
   - Sample install-config does not show apiVIPs/ingressVIPs; VIPs are typically implied by LB/DNS.  
   - Agent-based param table (9.1.4) still documents `platform.baremetal.apiVIPs` / `ingressVIPs`; applicability to UPI vs IPI is shared in that table.

3. **IPI-only vs UPI:**  
   - `platform.baremetal.hosts` and provisioning network (provisioningNetwork, provisioningNetworkCIDR, provisioningDHCPRange, clusterProvisioningIP, provisioningMACAddress, provisioningNetworkInterface) are **IPI-only** (installer-provisioned hosts and provisioning network).  
   - UPI: user provisions machines; controlPlane and compute use `platform: none`.  
   - App behavior: for bare-metal-upi we emit `platform.baremetal` with **only** apiVIPs/ingressVIPs when provided; we do **not** emit hosts or any provisioning fields (backend and smoke tests enforce this).

4. **Conditionals / deprecations:**  
   - apiVIP/ingressVIP deprecated in 4.12+; use apiVIPs/ingressVIPs (list).  
   - Same as IPI for VIP shape.

## Repo grounding (Phase 0)

| Item | Path | Exists |
|------|------|--------|
| Canonical scenario params | `data/params/4.20/bare-metal-upi.json` | Yes |
| Frontend catalog | `frontend/src/data/catalogs/bare-metal-upi.json` | Yes |
| Docs-index (canonical) | `data/docs-index/4.20.json` | Yes |
| Docs-index (frontend) | `frontend/src/data/docs-index/4.20.json` | Yes |
| DATA_AND_FRONTEND_COPIES.md | `docs/DATA_AND_FRONTEND_COPIES.md` | Yes |
| Bare Metal UPI working doc | `docs/BARE_METAL_4_20_UPI_DOC_REVIEW_AND_PLAN.md` | Yes (this file) |

## Params / catalog reconciliation (Phase C)

- **Canonical:** `data/params/4.20/bare-metal-upi.json` contains shared install-config params plus platform.baremetal.* (apiVIP, apiVIPs, ingressVIP, ingressVIPs, hosts, provisioning*, etc.) from the agent/9.1.4 source.  
- **Frontend catalog:** `frontend/src/data/catalogs/bare-metal-upi.json` is a copy; includes same platform.baremetal paths.  
- **UPI-specific:** Catalog includes platform.baremetal fields; UI and backend **hide or omit** IPI-only fields for UPI (provisioning section hidden in Platform Specifics; backend does not emit hosts or provisioning for UPI).  
- **VIP:** apiVIPs/ingressVIPs are the canonical 4.12+ shape; catalog documents deprecated singular and plural; backend emits lists.

## AS-IS app inventory (Phase D)

- **Methodology:** Bare Metal + UPI → scenarioId `bare-metal-upi`.
- **Networking:** API/Ingress VIPs card shown for bare metal (IPI and UPI) from NetworkingV2Step; bound to hostInventory.apiVip / hostInventory.ingressVip; comma-separated allowed; backend emits apiVIPs/ingressVIPs arrays.
- **Platform Specifics:** Provisioning network section **not** shown for bare-metal-upi (showProvisioningNetworkSection = bare-metal-ipi only). Advanced section (hyperthreading, capabilities, cpuPartitioningMode, minimal ISO) shown when catalog has those params; bare-metal-upi shows "UPI: no platform-specific options" message when no other sections apply.
- **Host Inventory:** For UPI, host inventory nodes are not emitted into install-config (no platform.baremetal.hosts).
- **Backend:** Emits controlPlane.platform = "none", compute[0].platform = "none"; platform.baremetal = { apiVIPs, ingressVIPs } when provided; never emits hosts or provisioning* for UPI.
- **Outputs:** install-config.yaml only (no agent-config for bare-metal-upi).

## Delta analysis (Phase E)

**Delta set 1 (UI/backend/assets):**  
- No duplicate VIP or provisioning controls in the active (segmented) flow for UPI.  
- E2E example `docs/e2e-examples/install-config/bare-metal-upi_minimal.yaml` uses singular `apiVIP`/`ingressVIP`; backend emits `apiVIPs`/`ingressVIPs` (list). Example could be updated for 4.12+ consistency (optional).

**Delta set 2 (doc truth vs app):**  
- Doc sample shows `platform: none` only; app emits `platform.baremetal` with apiVIPs/ingressVIPs when user supplies them. This is an acceptable extension: some flows may accept VIPs in install-config for bare metal UPI; app does not emit platform.baremetal at all when user leaves VIPs blank (object still present but empty).  
- All IPI-only params correctly excluded from UPI emission and from UPI provisioning UI.

## Implementation / alignment (Phase F)

- No code changes required in this pass for bare-metal-upi scenario logic.  
- Provisioning dropdown overlap fix (Part A) and Disabled-mode hints apply to IPI only.  
- UPI already: no provisioning section; VIPs from Networking; backend and tests aligned.

## Canonical vs frontend (two-place model)

See `docs/DATA_AND_FRONTEND_COPIES.md`. Canonical params live in `data/params/4.20/`; frontend copy in `frontend/src/data/catalogs/`. Sync when canonical params change.
