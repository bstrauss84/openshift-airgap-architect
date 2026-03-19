# VMware vSphere + OpenShift 4.20 + Agent-Based Installer — doc review, scenario truth, and implementation

**Status:** Closed for **current scope** (first-class `vsphere-agent` scenario in UI, catalogs, generator, docs-index, tests, e2e matrix).  
**Date:** 2026-03-19  
**Do not treat as substitute for reading Red Hat docs before production installs.**

---

## Phase 0 — Repo grounding (verified paths)

| Artifact | Path | Present |
|----------|------|--------|
| Canonical params | `data/params/4.20/vsphere-agent.json` | **Yes** (created this pass) |
| Frontend catalog | `frontend/src/data/catalogs/vsphere-agent.json` | **Yes** (copy of canonical) |
| Docs index (canonical) | `data/docs-index/4.20.json` | **Yes** — `scenarios.vsphere-agent` added |
| Docs index (frontend) | `frontend/src/data/docs-index/4.20.json` | **Yes** (synced copy) |
| Duplication rules | `docs/DATA_AND_FRONTEND_COPIES.md` | Yes |
| Catalog rules | `docs/PARAMS_CATALOG_RULES.md` | Yes |
| E2E matrix | `backend/scripts/e2e-matrix.js` | Yes — `vsphere-agent` added |
| E2E examples | `docs/e2e-examples/` | Yes (unchanged; no vsphere-agent-specific example files) |

**Relevant code:** `frontend/src/steps/MethodologyStep.jsx`, `NetworkingV2Step.jsx`, `PlatformSpecificsStep.jsx`, `HostInventoryV2Step.jsx`, `HostInventoryStep.jsx` (legacy wizard visibility), `HostsInventorySegmentStep.jsx`, `hostInventoryV2Helpers.js`, `catalogPaths.js`, `catalogFieldMeta.js`, `validation.js`, `backend/src/generate.js`, `backend/src/index.js`, `backend/src/docs.js`, `frontend/src/components/ScenarioHeaderPanel.jsx`.

---

## Phase A — Doc scrub summary (OpenShift 4.20, sources actually opened)

Sources used (fetched/read in this pass):

1. **Installing an on-premise cluster with the Agent-based Installer** — HTML single-page index:  
   `https://docs.redhat.com/en/documentation/openshift_container_platform/4.20/html-single/installing_an_on-premise_cluster_with_the_agent-based_installer/index`  
   - **§1.11 Validation checks before agent ISO creation:** `apiVIPs` and `ingressVIPs` **must** be set for **bare metal and vSphere** platforms; platforms supported: `baremetal`, `vsphere`, `none`.  
   - **Sample install-config note (platform):** Single-node → **platform `none`**; multi-node → `vsphere`, `baremetal`, or `none`. Dual-stack example uses `platform.baremetal` with `apiVIPs` / `ingressVIPs` lists (analogous structure for `platform.vsphere`).

2. **Chapter 9 — Installation configuration parameters for the Agent-based Installer** (`installation-config-parameters-agent`):  
   `https://docs.redhat.com/en/documentation/openshift_container_platform/4.20/html/installing_an_on-premise_cluster_with_the_agent-based_installer/installation-config-parameters-agent`  
   - **§9.1.5** Additional VMware vSphere configuration parameters (failure domains, vcenters, topology fields, etc.).  
   - **§9.1.6** Deprecated flat vSphere parameters.  
   - Page includes **Expand / Show more** regions; this pass relied on the single-page HTML export for contiguous text plus the multipage chapter for structure. **If Red Hat changes collapsed content without updating the single-page bundle, re-verify.**

3. **Installation configuration parameters for vSphere** (vSphere book): used for cross-reference and docs-index; **topology.template** is documented as **IPI-only** in Agent §9.1.5 table text.

**Explicit uncertainty (&lt; 95% confidence) — do not over-interpret:**

- **User-managed / external load balancer vs VIP fields:** vSphere IPI UI elsewhere allows “leave VIPs blank” when using an external LB; Agent §1.11 states `apiVIPs`/`ingressVIPs` must be set for vSphere. The app follows **§1.11** for Agent (required in catalog + validation for multi-node). If your design uses an external LB only, confirm with current Red Hat release notes or support whether VIP fields can be omitted for Agent on vSphere.  
- **IPv6-only vs dual-stack vs IPv4:** The Agent guide lists IPv4, IPv6, and dual-stack as endpoint configuration styles for vSphere/bare metal; this pass did **not** re-validate every IPv6-only edge case across all subsections. Dual-stack paths in the app follow the same pattern as bare-metal-agent (machine networks + VIP ordering).

**Topology (doc-proven for Agent installer):** Control plane replicas **3, 4, 5, or 1** (SNO) per install-config parameter table; **2 masters + 1 arbiter** pattern is aligned with existing bare-metal-agent handling and extended to vSphere Agent in the generator.

---

## Phase B — Docs-index / scenario mapping

**`vsphere-agent`** entry added to **both** `data/docs-index/4.20.json` and `frontend/src/data/docs-index/4.20.json` with:

- `installation-config-parameters-agent` (primary)  
- `installing-disconnected`  
- `installing-agent-based-on-prem` (same book URL as bare-metal agent scenario; title reflects full on-prem Agent guide)  
- `installation-config-parameters-vsphere` (cross-ref; notes IPI-only items)  
- `installing-vsphere-upi` (environment / DNS / LB context)

`node scripts/validate-docs-index.js` — **passed**.

---

## Phase C — Params / catalog reconciliation

- **`data/params/4.20/vsphere-agent.json`:** Built from **bare-metal-agent** minus `platform.baremetal.*`, plus **`platform.vsphere.*`** from **vsphere-ipi** (excluding `topology.template` path — IPI-only per doc note), plus explicit **`platform.vsphere.apiVIPs`** / **`platform.vsphere.ingressVIPs`** with citations to §1.11 validation + §9.1.5.  
- **`applies_to`:** `["vsphere-agent"]` on all parameters.  
- **Frontend:** `frontend/src/data/catalogs/vsphere-agent.json` kept in sync.  
- **`catalogPaths.js` / `catalogFieldMeta.js`:** Registered `vsphere-agent`.

`node scripts/validate-catalog.js data/params/4.20` — **passed**.

---

## Phase D — AS-IS → TO-BE (inventory summary)

**Before:** VMware vSphere had no Agent-Based method; no `vsphere-agent` scenario; generator never emitted `platform.vsphere` for Agent; no `agent-config` for vSphere; VIPs only on Networking for vSphere **IPI** (platformConfig arrays), not Agent.

**After:**

| Area | Behavior |
|------|----------|
| **Methodology** | vSphere can select **Agent-Based Installer**; helper text describes ISO/PXE + install-config + agent-config. |
| **Networking** | For `vsphere-agent`, API/Ingress VIPs use **host inventory** fields (same as bare-metal-agent), emitted to **`platform.vsphere.apiVIPs` / `ingressVIPs`**; SNO exempt. |
| **Platform Specifics** | vSphere card titled **Agent-based**; IPI-only controls remain gated by `scenarioId === "vsphere-ipi"`; agent options (boot artifacts, minimal ISO) when in catalog. |
| **Hosts / Inventory** | Full v2 inventory for `vsphere-agent` (agent options, node counts, NMState, arbiter rule). |
| **install-config** | Multi-node: `platform.vsphere` (placement + VIPs); SNO: **`platform.none`**. |
| **agent-config** | Generated for **Bare Metal** or **VMware vSphere** when method is Agent-Based. |
| **Field manual / doc links** | `docs.js` adds Agent parameter links when platform is vSphere and method is Agent-Based. |

---

## Phase E — Delta analysis (high level)

1. **UI/backend drift (fixed):** vSphere + Agent was impossible; now scenario id resolves, catalogs load, YAML previews can include agent-config.  
2. **Doc alignment:** Generator matches §1.11 / § sample for SNO (`none`) and multi-node vSphere + VIP lists from host inventory (consistent with dual-stack handling used for bare metal agent).  
3. **Remaining catalog nuance:** `vsphere-agent` catalog merges **vsphere-ipi**-sourced params; some optional IPI machine-pool-related platform keys may still appear in JSON though UI hides IPI-only sections — generator does not emit them for Agent. Acceptable for gating; could trim in a future catalog-only pass if desired.

---

## Phase F — Implementation summary

Files touched (conceptual): params, frontend catalogs, docs-index (×2), Methodology, scenario helpers, Host Inventory v2, Networking v2, Platform Specifics, validation, Scenario header, Connectivity hint, App `showHostInventory`, backend `generate.js`, `index.js`, `docs.js`, e2e matrix, smoke tests, `hostInventoryV2Helpers` unit tests.

---

## Phase G — Tests / validation run (results)

| Command | Result |
|---------|--------|
| `node scripts/validate-catalog.js data/params/4.20` | Pass |
| `node scripts/validate-docs-index.js` | Pass |
| `cd backend && node --test test/smoke.test.js` | Pass (62 tests) |
| `cd backend && node scripts/e2e-matrix.js` | Pass (97 cells) |
| `cd backend && node scripts/validate-e2e-examples.js` | Pass |
| `cd frontend && npm test` (vitest) | Pass (192 tests, 2 skipped) |

---

## Phase H — Remaining items (if any)

None **required** for declared scope. Optional follow-ups:

1. Dedicated Red Hat **vSphere + Agent** install procedure chapter (if/when distinct URL stabilizes) — add as first-class docs-index entry.  
2. Trim **vsphere-agent** catalog entries that are never emitted for Agent to reduce noise.  
3. **validate-e2e-examples** curated YAML cells for `vsphere-agent_*` if product wants example parity with bare-metal-agent.

---

## Manual validation checklist (operator)

- [ ] Select VMware vSphere → Agent-Based → confirm six segmented steps and **Hosts / Inventory** visible.  
- [ ] Multi-node: set Networking VIPs, Platform vSphere placement, three masters → preview **install-config** shows `platform.vsphere` with `apiVIPs`/`ingressVIPs` and **agent-config** with hosts.  
- [ ] SNO: one master, zero workers → **platform.none**, no VIP requirement.  
- [ ] Dual-stack: enable IPv6, set machine v6 + VIP v6 fields → YAML order IPv4 then IPv6.  
- [ ] Export bundle includes **agent-config.yaml** when Agent-Based + vSphere.

---

## Git (review only — not run)

```bash
git status
git diff --stat
git add data/params/4.20/vsphere-agent.json frontend/src/data/catalogs/vsphere-agent.json data/docs-index/4.20.json frontend/src/data/docs-index/4.20.json docs/VSPHERE_4_20_AGENT_DOC_REVIEW_AND_PLAN.md backend/src/generate.js backend/src/index.js backend/src/docs.js backend/scripts/e2e-matrix.js backend/test/smoke.test.js frontend/src/catalogPaths.js frontend/src/catalogFieldMeta.js frontend/src/hostInventoryV2Helpers.js frontend/src/App.jsx frontend/src/validation.js frontend/src/hostInventoryV2Validation.js frontend/src/components/ScenarioHeaderPanel.jsx frontend/src/steps/MethodologyStep.jsx frontend/src/steps/NetworkingV2Step.jsx frontend/src/steps/PlatformSpecificsStep.jsx frontend/src/steps/HostInventoryV2Step.jsx frontend/src/steps/HostInventoryStep.jsx frontend/src/steps/ConnectivityMirroringStep.jsx frontend/tests/hostInventoryV2Helpers.test.js
git commit -m "feat: vsphere-agent scenario (4.20 Agent-based on VMware)"
git push origin <your-branch>
```

(Add any generated `e2e-artifacts/` / report changes only if you intend to commit them.)
