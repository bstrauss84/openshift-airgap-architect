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
   - Official UPI sample shows `platform: none: {}` only.  
   - **No** `platform.baremetal` block in the UPI sample.  
   - Doc wording (section 2.1.12.1): *"`platform` Specifies the platform. You must set the platform to `none`. **You cannot provide additional platform configuration variables for your platform.**"*  
   - User must provision API and application Ingress load balancers; DNS points to those LBs.

2. **API / Ingress:**  
   - UPI doc describes external API and Ingress load balancers (DNS, HAProxy example).  
   - Sample install-config does not show apiVIPs/ingressVIPs; VIPs are typically implied by LB/DNS.  
   - Agent-based param table (9.1.4) documents `platform.baremetal.apiVIPs` / `ingressVIPs`; shared table does not restrict them to IPI-only; optional VIPs in install-config for bare metal UPI are supported by the app and backend.

3. **IPI-only vs UPI (doc proof):**  
   - The UPI sample has **no** `platform.baremetal` at all; the only platform key is `none`.  
   - **hosts** and **provisioning*** (provisioningNetwork, provisioningNetworkCIDR, provisioningNetworkInterface, provisioningDHCPRange, clusterProvisioningIP, provisioningMACAddress) are used in **installer-provisioned** flows where the installer provisions hosts and runs the provisioning network. The UPI chapter states that for user-provisioned infrastructure you must deploy all required machines yourself and the sample shows `platform: none` with no baremetal block—so these fields are **not valid for Bare Metal UPI** scenario truth.  
   - **Conclusion:** For bare-metal-upi, canonical params and frontend catalog must **not** include hosts or provisioning*; they are **IPI-only**. apiVIPs/ingressVIPs remain **allowed** (optional) for bare-metal-upi per agent table and app behavior.

4. **Conditionals / deprecations:**  
   - apiVIP/ingressVIP deprecated in 4.12+; use apiVIPs/ingressVIPs (list).  
   - Same as IPI for VIP shape.

## Field-by-field classification (disputed UPI fields)

| Field path | Allowed in UPI? | Doc proof | Final repo treatment |
|------------|-----------------|-----------|----------------------|
| platform.baremetal.apiVIPs | Yes (optional) | Agent param table documents; UPI sample does not show but does not forbid; app/backend support optional VIPs. | **Keep** in bare-metal-upi params/catalog. |
| platform.baremetal.ingressVIPs | Yes (optional) | Same as apiVIPs. | **Keep** in bare-metal-upi params/catalog. |
| platform.baremetal.hosts | **No (IPI-only)** | UPI sample: `platform: none: {}` only; "You cannot provide additional platform configuration variables for your platform." Hosts are installer-provisioned. | **Removed** from bare-metal-upi canonical params and frontend catalog. |
| platform.baremetal.hosts[].* | **No (IPI-only)** | Same as hosts. | **Removed** from bare-metal-upi canonical params and frontend catalog. |
| platform.baremetal.provisioningNetwork | **No (IPI-only)** | UPI has no provisioning network block; provisioning network is installer-managed. | **Removed** from bare-metal-upi canonical params and frontend catalog. |
| platform.baremetal.provisioningNetworkCIDR | **No (IPI-only)** | Same. | **Removed**. |
| platform.baremetal.provisioningNetworkInterface | **No (IPI-only)** | Same. | **Removed**. |
| platform.baremetal.provisioningDHCPRange | **No (IPI-only)** | Same. | **Removed**. |
| platform.baremetal.clusterProvisioningIP | **No (IPI-only)** | Same. | **Removed**. |
| platform.baremetal.provisioningMACAddress | **No (IPI-only)** | Same. | **Removed**. |

## Repo grounding (Phase 0)

| Item | Path | Exists |
|------|------|--------|
| Canonical scenario params | `data/params/4.20/bare-metal-upi.json` | Yes |
| Frontend catalog | `frontend/src/data/catalogs/bare-metal-upi.json` | Yes |
| Docs-index (canonical) | `data/docs-index/4.20.json` | Yes |
| Docs-index (frontend) | `frontend/src/data/docs-index/4.20.json` | Yes |
| DATA_AND_FRONTEND_COPIES.md | `docs/DATA_AND_FRONTEND_COPIES.md` | Yes |
| Bare Metal UPI working doc | `docs/BARE_METAL_4_20_UPI_DOC_REVIEW_AND_PLAN.md` | Yes (this file) |

## Params / catalog reconciliation (Phase B) — final resolved

- **Doc proof:** Official 4.20 Bare Metal UPI doc, section **2.1.12.1 "Sample install-config.yaml file for bare metal"**, shows only `platform: none: {}`. It states: *"You must set the platform to `none`. You cannot provide additional platform configuration variables for your platform."* So the UPI install-config does not include a `platform.baremetal` block in the sample; hosts and provisioning network are installer-provisioned concepts and do not apply to UPI.
- **Canonical:** `data/params/4.20/bare-metal-upi.json` — **removed** all IPI-only platform.baremetal entries: hosts, hosts[].*, provisioningNetwork, provisioningNetworkCIDR, provisioningNetworkInterface, provisioningDHCPRange, clusterProvisioningIP, provisioningMACAddress (14 entries). **Retained** only apiVIP, apiVIPs, ingressVIP, ingressVIPs for bare-metal-upi.
- **Frontend catalog:** `frontend/src/data/catalogs/bare-metal-upi.json` — synced: same 14 entries removed; only apiVIP, apiVIPs, ingressVIP, ingressVIPs remain under platform.baremetal for this scenario.
- **UI/backend:** No code change required. Provisioning section was already gated by scenarioId === "bare-metal-ipi"; backend already does not emit hosts or provisioning* for UPI. Catalog now matches scenario truth so getParamMeta/getCatalogForScenario no longer expose IPI-only paths for bare-metal-upi.
- **VIP:** apiVIPs/ingressVIPs are the canonical 4.12+ shape; catalog documents deprecated singular and plural; backend emits lists.

## AS-IS app inventory (Phase D)

- **Methodology:** Bare Metal + UPI → scenarioId `bare-metal-upi`.
- **Networking:** API/Ingress VIPs card shown for bare metal (IPI and UPI) from NetworkingV2Step; bound to hostInventory.apiVip / hostInventory.ingressVip; comma-separated allowed; backend emits apiVIPs/ingressVIPs arrays.
- **Platform Specifics:** Provisioning network section **not** shown for bare-metal-upi (showProvisioningNetworkSection = bare-metal-ipi only). Advanced section (hyperthreading, capabilities, cpuPartitioningMode, minimal ISO) shown when catalog has those params; bare-metal-upi shows "UPI: no platform-specific options" message when no other sections apply.
- **Host Inventory:** For UPI, host inventory nodes are not emitted into install-config (no platform.baremetal.hosts).
- **Backend:** Emits controlPlane.platform = "none", compute[0].platform = "none"; platform.baremetal = { apiVIPs, ingressVIPs } when provided; never emits hosts or provisioning* for UPI.
- **Outputs:** install-config.yaml only (no agent-config for bare-metal-upi).

## AS-IS inventory (Phase C) — summary

- **Wizard:** Blueprint Bare Metal + Methodology UPI → scenarioId `bare-metal-upi`. Identity & Access, Networking (API/Ingress VIPs card), Connectivity & Mirroring, Trust & Proxy, Platform Specifics (no provisioning; Advanced when catalog has advanced params; “UPI: no platform-specific options” when applicable), Host Inventory (nodes not emitted for UPI).  
- **Emitted:** install-config only; platform.baremetal = { apiVIPs?, ingressVIPs? }; controlPlane.platform = "none"; compute[0].platform = "none"; no hosts; no provisioning*.

## Delta analysis (Phase C)

**Delta set 1 (current app vs emitted assets):**  
- No duplicate VIP or provisioning controls in the active flow. All wizard fields that affect output are reflected in emitted install-config.

**Delta set 2 (corrected UPI truth vs current app):**  
- Doc sample shows `platform: none` only; app emits `platform.baremetal` with apiVIPs/ingressVIPs when user supplies them—acceptable (optional VIPs in install-config).  
- IPI-only params correctly excluded from UPI emission and from UPI provisioning UI.  
- E2E example `docs/e2e-examples/install-config/bare-metal-upi_minimal.yaml` was updated in a prior pass to use apiVIPs/ingressVIPs (list format).

## Implementation / alignment (Phase D)

- No further code changes required for bare-metal-upi in this pass.  
- UPI: no provisioning section; VIPs from Networking; backend and tests aligned. Working doc updated to reflect Phase 0–C and test results.

## Test results (Phase E)

- Backend smoke tests: 57 passed (includes bare-metal-upi apiVIPs/ingressVIPs, no hosts, platform none, must NOT emit IPI-only params).  
- Frontend tests: 189 passed, 2 skipped.  
- validate-catalog.js: Validated 9 file(s).  
- validate-docs-index.js: Docs index validation passed.

## Remaining items

- None for current scope. Bare Metal 4.20 UPI is closed: scenario truth, params/catalog, UI gating, backend emission, and tests are aligned with docs.

## Canonical vs frontend (two-place model)

See `docs/DATA_AND_FRONTEND_COPIES.md`. Canonical params live in `data/params/4.20/`; frontend copy in `frontend/src/data/catalogs/`. Sync when canonical params change.
