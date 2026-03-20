# Nutanix + OpenShift 4.20 — platform-family closeout (app scope)

**Date:** 2026-03-19  
**Status:** **App-scope closed** for Nutanix **IPI** (`nutanix-ipi`). The Nutanix **documentation family** includes **Agent-based Installer** on Nutanix; this app **does not** implement a Nutanix Agent scenario (see Part 1).  
**Do not treat this file as a substitute for reading Red Hat documentation before production installs.**

---

## Part 1 — Methodology discovery (official docs vs repo)

### Official OpenShift 4.20 Nutanix methodologies (verified)

Sources fetched/inspected in this pass:

- [Chapter 1. Installation methods — Installing on Nutanix](https://docs.redhat.com/en/documentation/openshift_container_platform/4.20/html/installing_on_nutanix/preparing-to-install-on-nutanix) — §1.2 documents **Agent-based Installer** on Nutanix and links to the Agent-based book.
- Same chapter describes **installer-provisioned** resource expectations (e.g. bootstrap + 3 control plane + 3 compute for a standard install), **two static VIPs** for IPI, **NTP** recommendation (DHCP-discoverable NTP; install possible without).
- [Chapter 7. Installation configuration parameters for Nutanix](https://docs.redhat.com/en/documentation/openshift_container_platform/4.20/html/installing_on_nutanix/installation-config-parameters-nutanix) — `platform.nutanix` fields (`prismCentral.endpoint`, `apiVIP`, `ingressVIP`, `subnetUUIDs`, optional `failureDomains`, `defaultMachinePlatform`, etc.), plus **shared** install-config rows (e.g. `controlPlane.replicas` 3 or 1 for SNO, `compute.replicas` described as ≥2 with default 3, global `arbiter` block in the same table).
- [Installing a cluster (platform-agnostic)](https://docs.redhat.com/en/documentation/openshift_container_platform/4.20/html/installing_on_any_platform/installing-platform-agnostic) — cross-cutting install-config (proxy, trust, etc.) referenced from Nutanix flows.

**Implemented in this app:** **Nutanix IPI only** (`nutanix-ipi`). Evidence: `frontend/src/steps/MethodologyStep.jsx` → `supportedMethods.Nutanix: ["IPI"]`; scenario id `nutanix-ipi` in catalogs, generator, and tests.

**In official docs but not implemented here:** **Agent-based Installer on Nutanix** (and any distinct UPI-style Nutanix path the product documents outside IPI — not exposed as a selectable methodology for Nutanix in this UI).

**In scope for this pass:** **`nutanix-ipi` only**, because it is the only Nutanix scenario the app can select and generate.

**Honest uncertainty (&lt;95% — do not treat as settled product law without your own doc read):**

1. **Arbiter:** The Nutanix install-config parameter chapter includes the **generic** `arbiter` machine pool rows. This pass **does not** add arbiter UI or generator output for Nutanix IPI because **Nutanix-specific IPI procedures** for 2 control-plane + arbiter were not verified in this session, and the app has no host-inventory path for Nutanix to express that topology.
2. **`compute.replicas` minimum:** The same parameter table states workers are a positive integer **≥2** (default 3). **Compact / three-node** patterns often use **0** workers with 3 control-plane nodes; the app catalog documents `0` for compact when `controlPlane.replicas` is 3. **Whether every Nutanix IPI doc sample agrees** with `0` workers should be re-checked against the full IPI install guide samples.
3. **Dual-stack VIP list shape (`apiVIPs` / `ingressVIPs`):** A 2026-03-19 fetch of the 4.20 **Installation configuration parameters for Nutanix** page shows **`apiVIP` / `ingressVIP`** only (singular) in the `platform.nutanix` section; no `apiVIPs` / `ingressVIPs` rows appeared in that HTML. The backend still emits **lists** when dual-stack machine network + IPv6 VIP fields are set (same pattern as other IPI paths in this repo). **Installer acceptance of plural VIP fields on Nutanix** should be verified against your target 4.20 release notes or a test install if you rely on that shape.

---

## Part 2 — `nutanix-ipi` (in-scope methodology)

### Root cause / findings summary

Earlier drift: catalog mixed agent-only concepts, wrong machine-pool platform shapes, and missing canonical `data/params` parity. This pass aligns **catalog ↔ canonical params ↔ UI ↔ backend ↔ tests ↔ docs-index ↔ e2e example** for the **only** Nutanix scenario in the app.

### Repo grounding

| Area | Path |
|------|------|
| Canonical params | `data/params/4.20/nutanix-ipi.json` |
| Frontend catalog (must match canonical) | `frontend/src/data/catalogs/nutanix-ipi.json` |
| Docs index (canonical + frontend copy) | `data/docs-index/4.20.json`, `frontend/src/data/docs-index/4.20.json` → `scenarios["nutanix-ipi"]` |
| Duplication policy | `docs/DATA_AND_FRONTEND_COPIES.md` |
| Generator | `backend/src/generate.js` (Nutanix IPI branch) |
| Defaults | `backend/src/index.js` → `platformConfig.nutanix` (incl. `apiVIPV6` / `ingressVIPV6`) |
| Validation | `frontend/src/validation.js` (platform, networking v2 VIPs, topology helpers) |
| UI | `frontend/src/steps/PlatformSpecificsStep.jsx`, `NetworkingV2Step.jsx`, `GlobalStrategyStep.jsx` (as applicable) |
| E2E matrix | `backend/scripts/e2e-matrix.js` |
| Example YAML | `docs/e2e-examples/install-config/nutanix-ipi_minimal.yaml` |
| Optional maintenance script | `scripts/patch-nutanix-ipi-catalog.mjs` (if present; used to reconcile catalog fields) |

### Docs / pages reviewed (this pass)

- `installing_on_nutanix/preparing-to-install-on-nutanix` (installation methods, IPI networking/VIP/NTP notes, standard resource counts).
- `installing_on_nutanix/installation-config-parameters-nutanix` (platform and shared install-config rows; expand/show-more tables in the live doc should still be scanned before production).
- `installing_on_any_platform/installing-platform-agnostic` (added to docs-index for shared proxy/trust topics).

### Params / catalog reconciliation summary

- **Machine pools:** `controlPlane[].platform` / `compute[].platform` → **`nutanix` / `{}`** in emitted YAML; catalog text matches.
- **Replicas:** Catalog documents **1 or 3** control-plane nodes (SNO vs standard/compact); **compute** includes **0** for compact three-node narrative; UI clamps **1–3** control plane, **0–100** workers with defaults **3 / 3**.
- **Agent / arbiter noise:** **Arbiter catalog entries removed** for this scenario; see uncertainty note above for doc vs app on arbiter.
- **VIPs:** Required **IPv4** VIPs in UI/validation; **IPv6** VIP fields when dual-stack UI path is active (`showIpv6ForPlatform` / host inventory IPv6); backend switches to **`apiVIPs` / `ingressVIPs`** when IPv6 machine network + IPv6 VIPs are present.
- **Prism Central:** UI uses flat `platformConfig.nutanix` fields; generator maps to **`prismCentral.endpoint.address` / `port`**, credentials, **`subnetUUIDs`**.

### AS-IS inventory (summary)

| Deliverable | Nutanix IPI content |
|-------------|---------------------|
| `install-config.yaml` | `platform.nutanix` (prismCentral, subnetUUIDs, apiVIP[s], ingressVIP[s], optional cluster name, etc.), `controlPlane` / `compute` with `platform.nutanix`, replicas from `platformConfig`, networking, pull secret, mirrors (`imageDigestSources`), proxy/trust when set |
| `agent-config.yaml` | **Not generated** (IPI) |
| NTP MachineConfigs | **Global wizard** only when user sets NTP (not Nutanix-specific) |
| Host inventory | **Not used** for Nutanix IPI in segmented flow (no agent hosts) |

### Delta analysis (summary)

1. **UI vs assets:** Platform fields and Networking VIPs map to install-config; **Internal** publish is rejected for Nutanix (non-cloud) in validation.
2. **Doc vs app:** Arbiter and strict `compute.replicas ≥ 2` table row vs compact `0` workers — **called out** as ambiguous above. Dual-stack VIP **list** emission **not** proven from Nutanix-only parameter text.

### Implementation / alignment summary (this closeout)

- **CCO / publish:** `backend/src/generate.js` Nutanix IPI branch always sets **`credentialsMode: Manual`** (Installing on Nutanix §1.4) and **`publish`**: Internal in UI state is **coerced to External** in install-config; validation already rejects Internal for Nutanix. Smoke tests assert Manual + External.
- **Platform Specifics:** Read-only **Credentials mode** field (Manual) with doc hint; no `useEffect` auto-mutation of `platformConfig` (avoids dependency churn; generator is source of truth for emitted YAML).
- **Catalog / canonical params:** `credentialsMode` narrowed to **Manual** only with citation to **preparing-to-install-on-nutanix** §1.4; **`publish`** description documents Internal rejection + generator coercion. **`data/params/4.20/nutanix-ipi.json`** kept in sync with **`frontend/src/data/catalogs/nutanix-ipi.json`**.
- **Docs-index:** Canonical + frontend copies include a **reference** entry for **Agent-based Installer on Nutanix** (Ch.1 §1.2 link to the Agent-based book), tagged **not-in-wizard**, plus existing IPI / parameter / platform-agnostic / disconnected entries.
- **E2E matrix:** Nutanix defaults include **IPv6 VIP keys** and explicit **replica** defaults for the scenario override.
- **E2E example** `nutanix-ipi_minimal.yaml`: includes **`credentialsMode: Manual`**, **`publish: External`**, **3 workers**, **`platform.nutanix: {}`** on pools.
- **`docs/DATA_AND_FRONTEND_COPIES.md`:** example list includes **`nutanix-ipi`** (prior pass).
- **Run oc-mirror step:** Footer uses **Back to Blueprint** and **Continue to Operations** instead of a generic **Proceed** (`frontend/src/App.jsx`).
- **Frontend test:** Nutanix platform-specifics fixture includes **replica** fields (prior pass).

### Topology / node-count truth (as implemented)

- **SNO:** `controlPlaneReplicas === 1` → validation requires **`computeReplicas === 0`**.
- **Standard HA:** defaults **3 / 3** in UI and matrix.
- **Compact three-node:** **3** control plane, **0** workers — allowed by UI range + catalog text; **doc table “≥2”** conflict noted under uncertainty.
- **2 control plane + arbiter:** **Not implemented** for Nutanix IPI.
- **4+ control plane:** **Not** offered (UI clamp **1–3**).

### VIP / NTP / IP families (as implemented)

- **VIPs:** Two static VIPs required for IPI per Nutanix prep doc; mirrored in app (Networking v2 + validation + generator).
- **NTP:** Doc recommends NTP via DHCP; app does not add Nutanix-specific NTP fields — optional global NTP MachineConfigs only.
- **IPv4 / IPv6 / dual-stack:** Machine/cluster/service dual-stack follows shared networking steps; **IPv6 VIP in-CIDR check** not enforced (same class of gap noted elsewhere in code comments). **List VIP emission** for dual-stack — see uncertainty.

### Tests / scripts run (2026-03-19)

```bash
node scripts/validate-catalog.js data/params/4.20/nutanix-ipi.json
node scripts/validate-docs-index.js
cd frontend && npm test -- --run
cd backend && node --test test/smoke.test.js
cd backend && node scripts/e2e-matrix.js
cd backend && node scripts/validate-e2e-examples.js
```

**Results (2026-03-19, post–catalog/docs-index sync):** `validate-catalog.js` and `validate-docs-index.js` passed; frontend **205 passed / 2 skipped** (`npm test -- --run`); backend smoke **63/63**; e2e matrix **97/97**; `validate-e2e-examples.js` completed. One parallel full-suite run earlier timed out waiting for the Run oc-mirror heading (flaky under load); re-run passed—if CI sees this, consider serializing that spec or increasing `waitFor` timeout.

### Manual validation checklist (operator)

- [ ] Walk **Methodology → … → Review** for **Nutanix / IPI** with segmented flow on.
- [ ] Confirm **Prism + subnet + credentials** on Platform Specifics and **API/Ingress VIP** on Networking match downloaded `install-config.yaml`.
- [ ] Toggle **dual-stack** (if used): confirm IPv6 VIP fields appear and YAML uses expected VIP shape.
- [ ] **Disconnected** path: confirm `imageDigestSources` / mirror settings match expectations.
- [ ] Re-read **live** Nutanix 4.20 docs (including collapsed tables) before production.

### File-by-file touch list (this pass)

- `data/params/4.20/nutanix-ipi.json` — canonical catalog (synced from frontend).
- `frontend/src/data/catalogs/nutanix-ipi.json` — `credentialsMode` / `publish` truth and citations.
- `data/docs-index/4.20.json` — Agent-based-on-Nutanix reference entry under `nutanix-ipi`.
- `frontend/src/data/docs-index/4.20.json` — same.
- `backend/src/generate.js` — Nutanix IPI: `credentialsMode`, `publish` coercion.
- `backend/test/smoke.test.js` — Nutanix Manual + External assertions.
- `frontend/src/validation.js` — Nutanix credentialsMode / Internal publish.
- `frontend/src/steps/PlatformSpecificsStep.jsx` — read-only Manual; removed credentials `useEffect`.
- `frontend/src/steps/NetworkingV2Step.jsx` — Nutanix dual-stack / VIP copy (prior).
- `frontend/src/App.jsx` — Run oc-mirror footer buttons.
- `backend/scripts/e2e-matrix.js` — Nutanix default state / overrides.
- `docs/e2e-examples/install-config/nutanix-ipi_minimal.yaml` — `credentialsMode` / `publish`, structure vs generator.
- `docs/DATA_AND_FRONTEND_COPIES.md` — catalog sync example.
- `frontend/tests/platform-specifics-step.test.jsx` — Nutanix fixture replicas.
- `docs/NUTANIX_4_20_IPI_DOC_REVIEW_AND_PLAN.md` — this document.

*(Use `git diff` for the exact delta in your tree.)*

---

## Part 3 — Family closure statement

- **Nutanix documentation family (4.20):** Includes **Agent-based** and **IPI** (and shared install-config topics).
- **This repository / app:** **Only Nutanix IPI** is selectable and generatable.
- **Closure type:** **App-scope closed** for **`nutanix-ipi`**. **Not** “full Nutanix family closed” in the product sense because **Agent-based on Nutanix** is documented but **not implemented** here.
- **Remaining (by design or uncertainty):**
  - **Nutanix Agent-based** scenario (install-config + agent-config + host inventory patterns) — **out of scope** until product/UI adds it.
  - **Arbiter / 2+1 topology** on Nutanix IPI — **not implemented**; doc ambiguity noted.
  - **Dual-stack VIP list** — implemented by analogy to other IPI; **Nutanix-specific doc quote** not captured in fetched parameter chapter.

---

## Part 4 — Prompt-compliance checklist

| Category | Status |
|----------|--------|
| Methodology discovery | **Completed** (docs + `MethodologyStep.jsx` / scenario ids) |
| Full doc scrub | **Completed** for fetched Nutanix chapters; **open** for “every collapsed row” without a human clicking through the entire multipage table in a browser |
| Docs-index check | **Completed** (canonical + frontend synced) |
| Params/catalog reconciliation | **Completed** for `nutanix-ipi` (canonical + frontend match) |
| AS-IS inventory | **Completed** (this doc) |
| Delta analysis | **Completed** (this doc + uncertainty section) |
| Implementation / alignment | **Completed** for in-scope scenario |
| Testing / validation | **Completed** (commands above) |
| Working doc updates | **Completed** (this file) |

### Git commands (review only — do not run per user request)

```bash
git status
git diff

# When you choose to commit (user asked for comprehensive commentary; adjust if some files are unchanged):
# git add \
#   data/params/4.20/nutanix-ipi.json \
#   frontend/src/data/catalogs/nutanix-ipi.json \
#   data/docs-index/4.20.json \
#   frontend/src/data/docs-index/4.20.json \
#   backend/src/generate.js \
#   backend/test/smoke.test.js \
#   frontend/src/validation.js \
#   frontend/src/steps/PlatformSpecificsStep.jsx \
#   frontend/src/steps/NetworkingV2Step.jsx \
#   frontend/src/App.jsx \
#   backend/scripts/e2e-matrix.js \
#   docs/e2e-examples/install-config/nutanix-ipi_minimal.yaml \
#   docs/DATA_AND_FRONTEND_COPIES.md \
#   frontend/tests/platform-specifics-step.test.jsx \
#   docs/NUTANIX_4_20_IPI_DOC_REVIEW_AND_PLAN.md
#
# git commit -m "Nutanix 4.20 IPI: CCO Manual/publish alignment, catalog+canonical sync, docs-index agent ref, run-oc-mirror footer, working doc"
# git push
```

---

## Answers (required)

1. **Which Nutanix installation methodologies are supported in the official 4.20 docs?** — At minimum **Agent-based Installer on Nutanix** and **installer-provisioned (IPI) on Nutanix**, per *Installing on Nutanix* Chapter 1 and related chapters; plus shared platform-agnostic install-config topics.
2. **Which Nutanix methodologies are implemented in this app?** — **Nutanix IPI** (`nutanix-ipi`) only.
3. **Which are closed for current scope?** — **`nutanix-ipi`** (app-scope).
4. **What remains?** — **Nutanix Agent-based** (and any other doc-only methodology not wired in `MethodologyStep`); **arbiter** topology for Nutanix IPI; **doc-vs-app** clarity on **compute.replicas** minimum vs compact **0** workers; **Nutanix-specific** confirmation of **dual-stack VIP list** fields.
5. **Did scenario truth updates flow through params, catalog, UI, backend, tests, docs?** — **Yes** for the **`nutanix-ipi`** line (including canonical `data/params/4.20/nutanix-ipi.json`, frontend catalog, generator, validation, steps, smoke tests, e2e matrix/example, docs-index, this working doc). **Not applicable** for Nutanix Agent (not implemented).
