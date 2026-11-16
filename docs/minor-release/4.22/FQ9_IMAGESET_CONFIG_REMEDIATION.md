# FQ-9 — ImageSetConfiguration remediation

> **Tranche 1.5.** Closes the live generated-artifact defect found in Tranche 1 and
> lands the first implementation slice of **DOC-166**.
> 4.22 remains unsupported and fail-closed; no 4.22 asset was created.

---

## 1. Root cause — and a correction to Tranche 1

`backend/src/generate.js` `buildImageSetConfig` emitted operator version filters as:

```yaml
channels:
  - name: stable-4.21
    includeConfig:
      minVersion: 4.21.0
```

oc-mirror v2 rejects this outright:

```
[ERROR] decode ImageSetConfiguration: json: unknown field "includeConfig"
```

**Correction.** Tranche 1 recorded `includeConfig` as *"a v1 construct that v2 rejects"*.
That is **wrong**, and the real cause is more instructive.

In every oc-mirror API version — `v1alpha1`, `v1alpha2` and `v2alpha1` — `Operator`
embeds `IncludeConfig` with `json:",inline"`:

```go
type Operator struct {
    IncludeConfig `json:",inline"`
    Catalog string `json:"catalog"`
    ...
}
```

Inlining means `IncludeConfig`'s only field, `Packages`, surfaces as `packages` at the
operator level. **`includeConfig` has never been a YAML key in any version.** It is a Go
*type* name that was transcribed as if it were a serialized field. Verified by reading
both `v1/pkg/api/v1alpha2/types_config.go` and
`internal/pkg/api/v2alpha1/type_config.go` at the exact commit the shipped binary was
built from.

The correct spelling follows from the same inlining: `IncludeChannel` embeds
`IncludeBundle` inline, so `minVersion`/`maxVersion` are **channel-level keys**.

**Why it survived:** `yamlValidator` validated `imageset-config.yaml` against the
*install* scenario catalog, where zero parameters applied, so validation was vacuously
true (lesson **L18**). And `backend/test/operator-version-constraints.test.js` asserted
`includeConfig` was *present and correct* — the test actively codified the defect, the
same false-confidence pattern as `catalog-validation.test.js:95-112`.

## 2. Schema authority

| | |
|---|---|
| API source | `openshift/oc-mirror` `internal/pkg/api/v2alpha1`, commit `3f66edaf31831b93043b0baa55d02462d4e7ee39` — the commit the shipped binary reports |
| `type_config.go` sha256 | `7e0900621632148bd811d3b40a0c5d763de3e4d139f2db5f1900be36f69beccb` |
| `type_config_include.go` sha256 | `535450b6e7159ef9c9515f1cb6fce428f498e791fac3f4f4a6a6b6e24b3c13cd` |
| Binary | oc-mirror from `clients/ocp/latest` (release `4.22.17`), sha256 `e03f81341d1186a03504a1be8f356265b974004782f07a35123e9cf6e35808d8` |

**Decoding is strict.** `internal/pkg/config/load.go` uses `yaml.UnmarshalStrict` and
`dec.DisallowUnknownFields()`. A deliberately bogus top-level key is rejected, so unknown
fields are hard parse failures, never tolerated extras.

Captured as `data/oc-mirror-v2/imageset-config-schema.json`, which also records the
validator rules read from `internal/pkg/config/validate.go`.

## 3. Every emitted field, audited

All 16 paths `buildImageSetConfig` can emit, probed against the exact binary across 16
generated state shapes.

| Emitted path | Verdict | Action |
|---|---|---|
| `apiVersion` (`mirror.openshift.io/v2alpha1`) | correct, unchanged at 4.22 | keep |
| `kind` | correct | keep |
| `archiveSize` (top level) | accepted | keep |
| `mirror.platform.channels[].name` | accepted | keep |
| `mirror.platform.channels[].minVersion` / `.maxVersion` | accepted | keep |
| `mirror.platform.graph` | accepted | keep |
| `mirror.platform.kubeVirtContainer` | accepted | keep — **generator was already right** |
| `mirror.operators` (incl. empty `[]`) | accepted | keep |
| `mirror.operators[].catalog` | accepted | keep |
| `mirror.operators[].packages[].name` | accepted | keep |
| `mirror.operators[].packages[].channels[].name` | accepted | keep |
| `mirror.operators[].packages[].channels[].includeConfig{,.minVersion,.maxVersion}` | **REJECTED** | **fixed** → channel-level `minVersion`/`maxVersion` |
| `mirror.additionalImages[].name` | accepted | keep |
| `mirror.platform.architectures` | **never emitted** | **fixed** — see §4 |

Pre-fix probe: 4 of 13 shapes rejected (every shape with an operator version filter).
Post-fix probe: **16 of 16 accepted.**

## 4. A second defect found during the audit — silent wrong-architecture mirror

`mirror.platform.architectures` was never emitted. That is **not** harmless:

```go
// internal/pkg/config/defaults.go
func completeReleaseArchitectures(cfg *v2alpha1.ImageSetConfiguration) {
    if len(cfg.Mirror.Platform.Channels) != 0 && len(cfg.Mirror.Platform.Architectures) == 0 {
        cfg.Mirror.Platform.Architectures = []string{v2alpha1.DefaultPlatformArchitecture} // "amd64"
    }
}
```

Binary-confirmed, same config with and without the field:

```
no architectures   -> .../upgrades_info/v1/graph?arch=amd64&channel=stable-4.21
architectures:[arm64] -> .../upgrades_info/v1/graph?arch=arm64&channel=stable-4.21
```

So a user selecting **aarch64**, **ppc64le** or **s390x** in the Blueprint got an
install-config carrying their architecture and a mirror set containing **amd64** release
payloads — and the configuration parsed cleanly, so nothing reported a problem. This is
worse than FQ-9 in kind: FQ-9 failed loudly, this failed silently.

Fixed by emitting `architectures` from `state.blueprint.arch` through
`normalizeBlueprintArch`, now a module-level helper **shared** with install-config
generation so the two artifacts cannot disagree about the target architecture.

Post-fix, binary-confirmed: an aarch64 Blueprint produces `arch=arm64`.

## 5. The `|| "4.20"` fallback, and the generation boundary

`buildImageSetConfig` resolved its minor as `getOpenShiftMinorFromState(state) || "4.20"`
(lesson **L12**). Two of three call sites already asserted support beforehand; the third,
`POST /api/ocmirror/run`, did **not**. There, an unresolvable minor silently produced
`stable-4.20` *and* dropped every operator through the `:v<minor>` catalog filter.

**The guard is now in the generator itself**, not only in its callers.
`buildImageSetConfig` calls `assertSupportedOpenShiftMinorForGeneration(state)` — the
same policy `buildInstallConfig` already applies — so it throws `UNSUPPORTED_VERSION`
for an unresolvable minor **and** for a resolvable but unsupported one. A caller that
forgets to assert can no longer produce an unsupported configuration; route guards are
necessary but not sufficient.

The route also asserts support and returns HTTP 422 like its two siblings, so the failure
surfaces as a proper status rather than a 500.

Direct coverage: `4.20 → allowed`, `4.21 → allowed`, `4.22 → UNSUPPORTED_VERSION` with
`requestedVersion: "4.22"` and the supported list attached, plus `4.19`/`4.23`/`5.0`
rejected and an assertion that **nothing is generated** on rejection.

## 6. Catalog reconciliation — seven wrong rows, not four

Tranche 1 identified four. The new conformance test immediately caught two more, and the
binary audit caught a seventh.

| Catalog claim | Binary verdict | Resolution |
|---|---|---|
| `kubeVirtContainer` (top level) | `unknown field "kubeVirtContainer"` | → `mirror.platform.kubeVirtContainer` |
| `...channels[].includeConfig` + 2 children | `unknown field "includeConfig"` | parent dropped; children → channel-level `minVersion`/`maxVersion` |
| `mirror.blockedImages` as array of strings | `cannot unmarshal string into ... v2alpha1.BlockedImage` | retyped to array of objects; `mirror.blockedImages[].name` added |
| `mirror.helm.local[].charts.imagePaths` | `unknown field "charts"` | → `mirror.helm.local[].imagePaths` |
| `mirror.operators[].targetName` | `unknown field "targetName"` | **removed** — v1alpha2-only, deprecated there in oc-mirror 4.13, gone from v2alpha1 |
| `mirror.platform.channels[].includeMin` | `unknown field "includeMin"` | **removed** |
| `mirror.platform.channels[].includeMax` | `unknown field "includeMax"` | **removed** |

`includeMin`/`includeMax` are the most telling: unlike `targetName` and `includeConfig`
they are not even stale v1 carry-overs — they appear in **no** oc-mirror API version. The
v2alpha1 `ReleaseChannel` carries exactly `name`, `type`, `minVersion`, `maxVersion`,
`shortestPath`, `full`. Neither was ever emitted by the generator, so these two were
catalog-only and affected no artifact.

`data/params/4.20/oc-mirror-v2.json`: **45 → 42 parameters.** Frontend mirror regenerated.

> **On R9 (no cross-minor backfill).** Correcting a file under `data/params/4.20/` from
> the *globally resolved oc-mirror binary* is not a cross-minor backfill. R9 forbids
> using another **OpenShift minor's** evidence. The ImageSetConfiguration schema is not
> OpenShift-minor-scoped at all — it belongs to oc-mirror, which is resolved globally and
> independently of the target minor. That is precisely DOC-166's thesis, and it is why
> these corrections are sound where a 4.21-sourced correction to a 4.20 row would not be.

## 7. Two documentation / binary disagreements, recorded not resolved

Per runbook Rule 2.5: reproduce against the binary, binary wins mechanically, record the
discrepancy.

1. OCP 4.22 *Disconnected environments* §5.13 lists `kubeVirtContainer` among the
   top-level parameters. The binary rejects it there.
2. The same table describes `mirror.blockedImages` as *"Array of strings"*. The binary
   rejects an array of strings.

Both are recorded in the schema fixture's `rejectedPaths` / `valueShapeRules` with the
verbatim errors. Neither was silently resolved in the documentation's favour, and neither
was used to weaken anything.

## 8. Tests

| Suite | Count | Covers |
|---|---|---|
| `backend/test/imageset-config-schema.test.js` | 38 | conformance of all 16 generated shapes; the rejected-path set; **negative control** on the byte-exact pre-fix artifact; architecture propagation; fail-closed minor; catalog-vs-schema agreement |
| `backend/test/operator-version-constraints.test.js` | 10 | rewritten — previously codified the defect |

The negative control asserts the exact pre-fix artifact **fails** the conformance model,
and asserts that it fails — so a change that made the checker vacuous again would itself
fail.

Hermetic: no network, no oc-mirror binary. Binary verdicts live in the fixture's
provenance block.

### Reproducing the binary verification

```bash
OCM=<verified oc-mirror v2 binary>
"$OCM" --v2 -c <imageset-config.yaml> --dry-run --workspace file://<scratch> docker://localhost:5000
# A registry-connection error means the CONFIGURATION was accepted.
# A "decode ImageSetConfiguration" / "invalid configuration" error is a real rejection.
```

## 9. DOC-166 status after this tranche

**Done — first implementation slice:**

- The global structural authority now **exists**, versioned and provenance-bearing, at
  `data/oc-mirror-v2/imageset-config-schema.json`, scoped GLOBAL and explicitly marked
  not-per-minor.
- Validation of the generated artifact is **no longer vacuous** — this is the O2
  requirement, and it immediately found two defects the old path could not see.
- The live generator defect is fixed and the catalog agrees with the binary.

**Deliberately NOT done — relocation deferred to Tranche 2.**
`data/params/4.20/oc-mirror-v2.json` stays where it is. Moving it is not a file move; the
blast radius measured here is:

| Touchpoint | Why it blocks a bounded pass |
|---|---|
| `backend/test/catalog-validation.test.js:53,59,95-112` | pins 13 catalogs at 4.20, `oc-mirror-v2` present at 4.20 and absent at 4.21 |
| `backend/test/catalog-schema-v2.test.js:270,292` | asserts `>= 13` catalog files, canonical and mirror |
| `validate-catalog.js`, `validate-param-authority.js`, parity and citation guards | all iterate `data/params/<minor>/`; a file outside that tree needs explicit wiring or becomes a second unguarded surface — the current failure mode, relocated |
| `scenarioId` / `outputFile` semantics | catalog schema v2.0.0 assumes a scenario; a global file needs either a synthetic `scenarioId` or a schema notion of non-scenario catalogs |
| `sync-catalogs` + frontend mirror | the mirror tree is per-minor by construction |

That is the *"substantially larger architecture change"* plan decision **O2** says to stop
at with evidence rather than improvise, and the tranche prompt explicitly permits
deferring it. **No per-minor oc-mirror catalog was created**, and none should be.

## 10. Not done here

- The `allowed` list for `platform.aws.lbType` at 4.20/4.21 still contains lowercase
  `nlb`, which is not in the 4.22 enum. Same-minor question, out of scope under R9.
- Catalog rows for v2 fields Architect does not emit (`mirror.platform.release`,
  `mirror.operators[].skipDependencies`, `targetCatalogSourceTemplate`,
  `mirror.samples`, package-level `minVersion`/`maxVersion`) were **not** added. The
  requirement was that no valid field be *silently lost from generated output*, which is
  satisfied; catalog completeness is a DOC-166 relocation question.
