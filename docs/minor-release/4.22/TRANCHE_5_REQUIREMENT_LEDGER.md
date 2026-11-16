# Tranche 5 — Requirement Ledger (atomic 4.22 support flip)

Baseline `TRANCHE_5_BASELINE` = `7b0cf3961027b535ffc0a7c2baf5c6ab88c00dd4`, all six
`develop` / work-branch refs equal, clean worktree, empty index.

Authority for the flip checklist:
[`TRANCHE_4_PRE_FLIP_VERIFICATION.md`](TRANCHE_4_PRE_FLIP_VERIFICATION.md) §5.
No flip surface is added that that inventory does not prove is required.

| # | Current behavior | Authoritative evidence | Planned change | Deterministic test | Manual verification |
|---|---|---|---|---|---|
| S1 | `backend/src/versionPolicy.js` `SUPPORTED_MINORS = ["4.20","4.21"]`; every backend gate rejects 4.22 | T4 §5 S1, §11 | append `"4.22"` | `t4-flip-surface-inventory` S1 post-flip pin; `validate-supported-minors` | direct `buildInstallConfig` at 4.22 |
| S2 | `frontend/src/shared/versionPolicy.js` same list | T4 §5 S2 | append `"4.22"` | `validate-supported-minors` backend/frontend equality | frontend catalog resolve at 4.22 |
| S3 | `FIELD_GUIDE_SUPPORTED_MINORS = ["4.20","4.21"]` | T4 §5 S3 | append `"4.22"` | `fieldGuide-4.22.test.js` post-flip pin | `resolveFieldGuideVersion("4.22")` |
| S4 | `assembler.js` imports v4.20/v4.21 only; no 4.22 branch | T4 §5 S4, §7 "Field Guide READY" | import `compartments_v422`, add the `"4.22"` branch | `fieldGuide-4.22.test.js` assembly | render a 4.22 Field Guide |
| S5 | `getAuthoritativeExport("4.22") === null` | T4 §5 S5, §11 | return `compartments_v422` for `"4.22"` | provenance certification at 4.22 | `getAuthoritativeExport("4.22")` non-null |
| S6 | `previouslyReleasedMinors: ["4.20","4.21"]` | T4 §5 S6, G3 | append `"4.22"`, keep 4.20/4.21 and `baselineMinor: "4.20"` | `check:supported-minors` bidirectional invariant | `npm run check:supported-minors` |
| S7 | no `"4.22"` trust-bundle row; 4.22 resolves `source:"forward"` and shows a false "not yet fully reflected" caveat | T4 §5 S7, §6 P9 | add `"4.22": ["Proxyonly","Always"]` to **both** policy modules | inverted P9 | `getTrustBundlePolicySupport("4.22").source === "explicit"` |
| S8 | `e2e/helpers/asset-validation.js SUPPORTED_VERSIONS` lists 4.20/4.21 | T4 §5 S8 | add `{ minor: '4.22', patch: '4.22.0' }` | inventory S8 post-flip pin | — (full E2E is Tranche 6) |
| S9 | 5 version-aware Quick Picks; no `"4.22"` row; `"default"` live | T4 §5 S9, ODF evidence §1–§2 | add `"4.22"` rows to all five; remove every `"default"` key **and** the `\|\| versionPicks?.["default"]` resolution fallback | `operator-quick-pick-flip-atomicity` | Quick Pick renders `4.22` at 4.22 |
| S10 | `openshift-ai` is flat and names `rhods-prometheus-operator`, absent at 4.22 | T4 §4 B1, `rhoai-package-evidence-4.22.json` | convert to `versionPicks`; 4.20/4.21 preserved byte-exact; 4.22 = `rhods-operator`, `nfd`, `gpu-operator-certified` | `t4-quick-pick-catalog-verification` final version-aware invariant | — |
| S11 | ~32 files match `["4.20","4.21"]` | T4 §5 S11 | update only those asserting **what the supported set is**; leave coverage loops, mocks, adversarial fixtures and historical snapshots | the suites themselves | — |

## Out of scope, by instruction

- **B2 / DOC-184** — `jaeger-product` is absent at 4.20, 4.21 and 4.22 alike. Not a
  4.22 regression, not a flip blocker. No substitution; Tempo/OpenTelemetry are **not**
  inferred as replacements.
- **`rhods-prometheus-operator` at 4.20/4.21** — human decision recorded in the Tranche 5
  prompt: **preserve**. Independent pre-release cleanup, not part of this flip.
- **G1** — full post-flip real-output certification is Tranche 6. Tranche 5 runs only
  enough focused deterministic tests to prove the newly reachable 4.22 generation path
  does not fail immediately.
- Field delta research (4.21.35 → 4.22.16) is frozen and not reopened.
