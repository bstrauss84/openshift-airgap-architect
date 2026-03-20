# VMware vSphere + OpenShift 4.20 + Agent-Based Installer — doc review, scenario truth, and implementation

**Status:** **Not “fully closed” as a doc-truth claim** — implementation for `vsphere-agent` is aligned for the items below; explicit caveats remain where the 4.20 Agent guide is terse or internally inconsistent (see **Pass: final targeted cleanup**).  
**Date:** 2026-03-19 (updated same day — dual-stack + arbiter + doc-tightening pass)  
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

**Doc-backed conclusions (this pass, OpenShift 4.20 Agent html-single, verified in-repo fetch):**

- **§1.11 Validation checks before agent ISO creation:** For `install-config`, `apiVIPs` and `ingressVIPs` **must** be set for **bare metal and vSphere** platforms (no exception stated there for user-managed LB). The app keeps **multi-node** VIP requirement for vSphere Agent to match this bullet.  
- **Sample install-config note (IPv4 / IPv6 / dual-stack):** The guide lists **three** endpoint styles for `vsphere`/`baremetal`: IPv4, **IPv6**, and dual-stack, with a dual-stack YAML sample (`networking` lists + `platform.baremetal` VIP lists — analogous for `platform.vsphere`). **IPv6-only is listed as a named style**; the app does **not** add separate “IPv6-only” UX beyond the existing IPv6 toggle + optional IPv6 CIDR/VIP fields (no extra claim of full IPv6-only matrix testing).  
- **§1.11 `agent-config` validation bullet** says host `role` must be `master` or `worker` only — this **conflicts** with **Chapter 4.2.9** (local arbiter) and with **installation-config-parameters-agent §9.2.2** (`hosts[].role` allowed values in our catalog include **arbiter**). **Resolution for this repo:** we treat **§9.2.2 + arbiter chapter** as authoritative for agent-config `role` when using 2 CP + arbiter; §1.11 is noted as **oversimplified / stale** for that bullet.  
- **Arbiter (2 CP + 1 arbiter):** Chapter **4.2.9** describes local arbiter; the **example** uses `platform.baremetal.hosts` with `role: arbiter` — same **topology** applies to Agent-based multi-node on vSphere in this app (install-config `arbiter` + agent-config hosts). vSphere Agent shares **bare-metal-agent** arbiter validation and generator branches.

**Remaining nuance (&lt; 95% if you need legalistic certainty):**

- **External / user-managed LB vs §1.11 mandatory VIPs:** Still **not** reconciled in a single paragraph in the Agent guide; other chapters discuss LB infrastructure generally. **Do not** assume omission of VIPs is supported for Agent+vSphere without Red Hat confirmation.  
- **IPv6-only end-to-end:** Listed as a style; **not** every subsection was re-proven for IPv6-only in this pass.

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
| `cd frontend && npm test` (vitest) | Pass (see **Pass: final targeted cleanup** for latest count) |

---

## Pass: final targeted cleanup (dual-stack, arbiter, doc tightening) — 2026-03-19

**Goal:** vSphere Agent inherits the **same shared Networking (v2) + Global Strategy** dual-stack **field visibility** as bare-metal-agent; arbiter UX/validation/replicate is **role-correct**; doc caveats tightened where the 4.20 Agent guide allows.

### 1A–1E Dual-stack / VIP consistency (code proof)

| Concern | Where | Behavior (after pass) |
|--------|--------|------------------------|
| IPv6 toggle | `hostInventory.enableIpv6` | Drives `showIpv6ForPlatform` in `NetworkingV2Step.jsx` (still excludes AWS GovCloud). |
| Machine IPv6 | `NetworkingV2Step.jsx`, `GlobalStrategyStep.jsx` | Shown when `enableIpv6` / `hostInventory.enableIpv6`. |
| Cluster + service IPv6 | Same files | Shown when IPv6 is enabled **without** requiring `machineNetworkV6` to be non-empty first (aligned with Agent guide listing IPv4 / IPv6 / dual-stack styles). |
| VIP IPv6 | `NetworkingV2Step.jsx` | For bare-metal-agent and vSphere-agent with IPv6 enabled, **split** IPv4/IPv6 VIP fields; vSphere Agent **IPv4-only** path uses IPv4-only hints (no stale comma-separated dual-stack copy on that path). |
| Bare-metal-agent VIP note | `NetworkingV2Step.jsx` | When IPv6 enabled, note points to **split fields**, not comma-separated lines. |

**Shared scenarios:** `NetworkingV2Step` applies to all non–AWS-GovCloud segmented networking; `GlobalStrategyStep` networking card updated the same way for **legacy** flow parity.

### 2A–2F Arbiter (vSphere Agent)

| Item | Implementation |
|------|----------------|
| Scenario support | `hostInventoryV2Validation.js` (2 masters, 0 arbiter → error) includes `vsphere-agent`; `generate.js` emits `installConfig.arbiter` for Bare Metal **or** VMware vSphere Agent with 2 masters + 1 arbiter. |
| Drawer | `HostInventoryV2Step.jsx`: arbiter drawer **hides** Additional Interfaces, **Advanced** (MTU/routes); **keeps** root device hint (still emitted as `rootDeviceHints` in generator). |
| Replicate | No “Apply settings to other nodes” when editing arbiter; modal **disables** arbiter targets; `applyReplicate` filters arbiter indices; role checks use **trim**. |
| Validation | `validation.js` `validateNode`: **skips** additional-interface validation when `role` is arbiter (trimmed). |

### 3A–3B VIP requiredness / IPv6-only (final wording)

- **VIP requiredness:** **§1.11** states VIPs **must** be set for vSphere — app matches for multi-node Agent. **LB exception** not documented in §1.11 → remain conservative.  
- **IPv6-only:** **Named** as a configuration style in the Agent install-config sample note; app does **not** claim full IPv6-only certification beyond exposing IPv6 fields when enabled.

### Tests / scripts (this pass)

| Command | Result |
|---------|--------|
| `cd frontend && npm test` | Pass (**198** passed, 2 skipped) |
| `node scripts/validate-catalog.js frontend/src/data/catalogs` | Pass |
| `node scripts/validate-docs-index.js` | Pass |
| `cd backend && node --test test/smoke.test.js` | Pass (62 tests) |

**Also re-run (regression):** `cd backend && node scripts/e2e-matrix.js` — Pass (97 cells).  
**Not re-run:** `validate-e2e-examples.js` (no example doc edits).

### YAML proof (2 control plane + arbiter vs invalid)

- **Invalid (app validation):** Two nodes with `role: master`, zero `role: arbiter` → `getCatalogValidationForInventoryV2` error: *“Two control plane nodes require one arbiter node…”* (applies to `vsphere-agent` and `bare-metal-agent`).  
- **Valid shape (generator, multi-node vSphere Agent):** `install-config.yaml` includes `controlPlane.replicas: 2`, `arbiter: { name: "arbiter", replicas: 1 }`, `platform.vsphere` (with VIP lists from inventory when not SNO); `agent-config.yaml` hosts include two masters and one host with `role: arbiter` (catalog §9.2.2).

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
git add docs/VSPHERE_4_20_AGENT_DOC_REVIEW_AND_PLAN.md frontend/src/steps/NetworkingV2Step.jsx frontend/src/steps/GlobalStrategyStep.jsx frontend/src/steps/HostInventoryV2Step.jsx frontend/src/validation.js frontend/tests/networking-v2-step.test.jsx frontend/tests/hostInventoryV2Validation.test.js frontend/tests/validation-catalog-alignment.test.js frontend/tests/HostInventoryV2Phase43.test.jsx
git commit -m "feat: vsphere-agent scenario (4.20 Agent-based on VMware)"
git push origin <your-branch>
```

(Add any generated `e2e-artifacts/` / report changes only if you intend to commit them.)
