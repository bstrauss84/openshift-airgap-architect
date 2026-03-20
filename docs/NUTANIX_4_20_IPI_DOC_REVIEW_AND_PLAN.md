# Nutanix + OpenShift 4.20 + IPI — doc review, scenario truth, and implementation

**Status:** **In-app scope = Nutanix IPI only** (`nutanix-ipi`). The Methodology step exposes **Nutanix → IPI** only; there is **no** Nutanix UPI or Nutanix Agent scenario in this repo today.  
**Date:** 2026-03-19  
**Do not treat as substitute for reading Red Hat docs before production installs.**

---

## Phase 0 — Repo grounding

| Artifact | Path | Notes |
|----------|------|--------|
| Frontend catalog | `frontend/src/data/catalogs/nutanix-ipi.json` | **Source for this scenario in UI** (no `data/params/4.20/nutanix-ipi.json` in repo). |
| Docs index (canonical) | `data/docs-index/4.20.json` → `scenarios.nutanix-ipi` | Synced with frontend copy. |
| Docs index (frontend) | `frontend/src/data/docs-index/4.20.json` | Same entries as canonical. |
| Generator | `backend/src/generate.js` | `platform.nutanix` block. |
| UI | `PlatformSpecificsStep.jsx`, `NetworkingV2Step.jsx`, `GlobalStrategyStep.jsx` | Prism + subnet + cluster; **API/Ingress VIPs on Networking (v2)**. |
| Validation | `frontend/src/validation.js` | `validatePlatformConfig`, `validateNetworkingFormat`, `validateVipsInMachineNetwork`, `networking-v2` step. |
| Defaults | `backend/src/index.js` → `platformConfig.nutanix` | Includes `apiVIP` / `ingressVIP`. |
| E2E | `backend/scripts/e2e-matrix.js`, `docs/e2e-examples/install-config/nutanix-ipi_minimal.yaml` | Updated for nested `prismCentral.endpoint` + VIPs. |

---

## Phase 1 — Doc scrub (sources intended)

Primary (4.20):

1. **Installing a cluster on Nutanix with installer-provisioned infrastructure** — `installing-nutanix-ipi` / installing_on_nutanix book.  
2. **Nutanix configuration parameters** — `installation-config-parameters-nutanix` (install-config parameter table for `platform.nutanix`).

**Note:** This pass could not reliably fetch the multipage parameter chapter over the network from the automation environment; assertions below follow the **published parameter table shape** (nested `prismCentral.endpoint.address` / `port`, `apiVIP`, `ingressVIP`, `subnetUUIDs`, etc.) and should be re-checked after any doc site change.

---

## Phase 2 — Scenario truth implemented

| Topic | App behavior |
|--------|----------------|
| **Install method in repo** | **IPI only** for Nutanix. |
| **prismCentral** | YAML: `prismCentral.endpoint.address` + `endpoint.port` (UI still uses flat `platformConfig.nutanix.endpoint` + `port`). |
| **apiVIP / ingressVIP** | Required in catalog + `validatePlatformConfig` + Networking v2 catalog-driven required paths + emitted in `generate.js`. |
| **VIP vs machine network** | `validateVipsInMachineNetwork` for `nutanix-ipi` when machine IPv4 CIDR is set (IPv4 VIPs checked; IPv6 VIPs skip IPv4 CIDR check — same pattern as other scenarios). |
| **Topology (CP replicas)** | Catalog still lists agent-style `arbiter.*` entries from an older merge; **Nutanix IPI control plane replica rules** (e.g. 3 vs 1 SNO) are **not** fully enforced in a dedicated UI path in this app — **&lt;95%** for arbiter-on-Nutanix-IPI without re-reading the full Nutanix parameter table. |
| **Dual-stack** | VIP fields allow IPv4 or IPv6 strings per validation; full dual-stack matrix for Nutanix IPI is **not** separately certified in this pass. |

---

## Phase 3 — Docs-index

`nutanix-ipi` docs order (canonical + frontend):

1. `installing-nutanix-ipi`  
2. `installation-config-parameters-nutanix`  
3. `installing-disconnected`  

The **Agent-based Installer** install-config chapter was **removed** from this scenario’s list (it was misleading as the first entry).

---

## Phase 4 — Tests / scripts to run

```bash
cd frontend && npm test
node scripts/validate-docs-index.js
cd backend && node --test test/smoke.test.js
cd backend && node scripts/e2e-matrix.js
```

(`validate-catalog.js` targets `data/params/` — no Nutanix file there; frontend catalog is covered by frontend tests.)

---

## Remaining items

1. Add **`data/params/4.20/nutanix-ipi.json`** and sync to `frontend/src/data/catalogs/` per `DATA_AND_FRONTEND_COPIES.md` if product wants canonical params validation.  
2. Re-verify **controlPlane.replicas** (3 vs 1 SNO) and **compute.replicas** minimums against **installation-config-parameters-nutanix** and trim catalog noise (`arbiter.*` if not applicable).  
3. Optional: deduplicate Nutanix Prism fields between **Global Strategy** and **Platform Specifics** (currently both show similar inputs).

---

## Git (review only — do not run unless you intend to commit)

```bash
git status
git diff
```
