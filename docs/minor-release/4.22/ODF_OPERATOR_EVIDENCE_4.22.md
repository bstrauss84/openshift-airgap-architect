# ODF 4.22 and operator Quick Pick evidence

> **Tranche 1 deliverable 5 of 10.** Research only. **No operator product data is mutated.**
> `frontend/src/steps/OperatorsStep.jsx` is unchanged.

Source: Red Hat OpenShift Data Foundation **4.22**, *Planning your deployment →
Disconnected environment*, retrieved **2026-10-07**.
`https://docs.redhat.com/en/documentation/red_hat_openshift_data_foundation/4.22/html/planning_your_deployment/disconnected-environment_rhodf`

Lesson **L3** is the standing warning here: the 4.21 ODF research *"missed 7-10 operators
per version"*. 4.21's list was not carried forward; the 4.22 chapter was read directly.

---

## 1. Documented ODF 4.22 package set

**Base — always required (12):**

`ocs-operator` · `odf-operator` · `mcg-operator` · `odf-csi-addons-operator` ·
`ocs-client-operator` · `odf-prometheus-operator` · `recipe` · `rook-ceph-operator` ·
`cephcsi-operator` · `odf-dependencies` · `odf-external-snapshotter-operator` ·
**`ocs-tls-profiles`**

**Local Storage deployments add (1):** `local-storage-operator` → **13**

**Regional-DR / Metro-DR add (4):** `odf-multicluster-orchestrator` ·
`odr-cluster-operator` · `odr-hub-operator` · **`odr-volsync-plugin-operator`** → **16**

Also documented: *"Make sure to name the `CatalogSource` as `redhat-operators`."*
Channel pattern `stable-<odf-version>`; versions carry the `-rhodf` suffix.

## 2. Delta against what the app ships for 4.21

| Quick Pick | 4.21 packages | 4.22 required | Missing at 4.22 |
|---|---|---|---|
| `odf` | 11 | **12** | `ocs-tls-profiles` |
| `odf-local-storage` | 12 | **13** | `ocs-tls-profiles` |
| `odf-disaster-recovery` | 14 | **16** | `ocs-tls-profiles`, `odr-volsync-plugin-operator` |
| `platform-plus` (contains the ODF base stack) | ODF base 11 + 4 | ODF base 12 + 4 | `ocs-tls-profiles` |

Both genuine deltas predicted in the plan (`ocs-tls-profiles`, `odr-volsync-plugin-operator`)
are **confirmed** against the ODF 4.22 chapter, and the resulting totals (12 / 13 / 16)
match the planned targets exactly.

`platform-plus` was not in the plan's ODF table and would have been missed by a
check that only looked at the three `odf*` picks. It embeds the ODF base stack and needs
the same addition.

## 3. IBM FlashSystem / external storage — resolves plan decision O9

`ibm-storage-odf-operator` and `ibm-block-csi-operator` are **NOT PRESENT** in the ODF 4.22
disconnected-environment chapter.

Stated precisely: they are *not listed in that chapter at 4.22*. That is **not** the same
as "removed from the product", and this tranche does not claim it is. Establishing removal
would need the ODF 4.22 external-mode / IBM FlashSystem deployment guide.

**The accepted product boundary is preserved regardless**, as the prompt requires:

- recorded here, not folded into the normal ODF Quick Pick;
- **no** topology-specific Quick Pick added;
- neither package appears in any current `versionPicks` row, so there is nothing to remove.

O9 outcome: no action in v2.1; the boundary stands; the absence is recorded so a future
reader does not read silence as an oversight.

## 4. All Quick Picks against 4.22 — inventory

`OperatorsStep.jsx` defines **21** Quick Picks. Five are version-aware (`versionPicks`), **16**
are flat `picks`.

> **Corrected in Tranche 4A.** This section originally said "20 … 15 flat". The
> `scenarios` array is byte-identical to its state when that sentence was written, so the
> original figure was an off-by-one in the evidence, not a code change. Counting only 15
> would have left one flat Quick Pick unverified. The count is now derived from the array
> rather than asserted in prose — see
> `frontend/tests/t4-quick-pick-catalog-verification.test.js`.

| Group | Picks | 4.22 status |
|---|---|---|
| Version-aware | `odf`, `odf-local-storage`, `odf-disaster-recovery`, `platform-plus`, `app-dev-suite` | need an explicit `"4.22"` row. The first four need package additions per §2; `app-dev-suite` defines only `default`. |
| Version-independent | the remaining 16 (incl. `logging`) | **verified against the real `:v4.22` catalog in Tranche 4** (findings B1 and B2). Per plan **O5** each needs a package-presence check; `applyScenario` currently skips not-found packages silently (`OperatorsStep.jsx:434`). |

### The `default` key is the live hazard

Every `versionPicks` object carries a `"default"` key, and resolution is
`versionPicks?.[version] || versionPicks?.["default"] || picks`
(`OperatorsStep.jsx:427, 506, 671`, render `:1063`).

**The moment 4.22 is enabled without a `"4.22"` row, every ODF Quick Pick silently serves
the 4.21 package list** — 11 packages instead of 12 — and the user gets a mirror set
missing `ocs-tls-profiles` with no warning. This is lesson **L11** and it is exactly what
plan **O5** removes: undefined version-specific Quick Picks must fail closed with
*"Quick Pick not defined for OpenShift X.Y"*.

It is also why the existing test is no protection: `version-aware-operator-quick-picks.test.js:14-56`
re-declares a **mock** `scenarios` array with a 4-package ODF, and both its tests assert
*the fallback is correct* (lesson **L10**). Adding `"4.22"` rows would not make that test
fail if they were wrong.

**Ordering requirement for Tranche 5:** removing `default` and adding the `"4.22"` rows
must land in the same atomic enablement commit as widening `SUPPORTED_MINORS`. Adding rows
first leaves the fallback live; removing `default` first breaks 4.20/4.21.

## 5. Unverified against a real catalog scan

Everything in §1 is **documentation** evidence. None of it has been checked against an
actual `oc-mirror --v2 list operators --catalog=registry.redhat.io/redhat/redhat-operator-index:v4.22`
scan, which needs registry credentials and was out of scope here.

The acquired oc-mirror binary **does** support that command (DOC-166 §1), so the check is
available to Tranche 2. Per **O5** it is required before any Quick Pick is declared correct
for 4.22 — documentation says which packages *should* exist; only a scan says which *do*.

## 6. Other 4.22 operator-relevant findings

| Finding | Source | Relevance |
|---|---|---|
| **Red Hat Marketplace removed** in 4.22 | 4.22 release notes, Operator Lifecycle removed features | Architect's catalog sources are `redhat`/`certified`/`community` (`operators.js:19-21`), so marketplace was never used. But `backend/src/index.js:2380` pushes `registry.marketplace.redhat.com` into a hostname allowlist — review. |
| **SQLite catalog format** deprecated | same | file-based catalogs only; no app change identified |
| **`ImageContentSourcePolicy` (ICSP) objects** deprecated | 4.22 release notes, Node deprecated features | Architect emits `imageDigestSources` (IDMS), not ICSP, so the generated install-config is on the right side of this. Worth a Field Guide note. Interacts with `DOC-168` (`imageDigestSources` supportedness). |
| `oc adm release mirror` deprecated; oc-mirror v1 deprecated; Docker v2 registries deprecated | 4.22 release notes, OpenShift CLI | confirms the v2-only direction; Field Guide Class B statements must match |
