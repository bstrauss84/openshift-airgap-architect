# DOC-166 — global oc-mirror v2 / ImageSetConfiguration authority

> **Tranche 1 deliverable 7 of 10.** Research and disposition proposal for **DOC-166**,
> `active`/`p1` in `docs/BACKLOG_STATUS.md`.
>
> ## ⚠ Partly superseded by Tranche 1.5
>
> Read [`FQ9_IMAGESET_CONFIG_REMEDIATION.md`](FQ9_IMAGESET_CONFIG_REMEDIATION.md) first.
> Three statements below are now out of date:
>
> 1. **`includeConfig` is NOT "a v1 construct".** It has never been a YAML key in any
>    oc-mirror API version. `IncludeConfig` is a Go type embedded `json:",inline"`, so
>    its `packages` field surfaces at the operator level and the type name itself never
>    serializes. Corrected after reading both the v1alpha2 and v2alpha1 sources.
> 2. **There were seven wrong catalog rows, not four.** `mirror.operators[].targetName`,
>    `mirror.platform.channels[].includeMin` and `...includeMax` were also rejected by
>    the binary.
> 3. **The generator defect and the catalog rows are now FIXED**, and the global
>    structural authority exists at `data/oc-mirror-v2/imageset-config-schema.json`.
>    The *relocation* of `data/params/4.20/oc-mirror-v2.json` remains deferred, for the
>    reasons in §6 below, which still stand.
>
> The authority-split analysis in §5 and §6 is unchanged and is what Tranche 2 should act on.

---

## 1. Resolved global oc-mirror v2

Per `CLAUDE.md`, `oc-mirror` is the latest available **globally**, from
`clients/ocp/latest`, independent of target minor.

| Field | Value |
|---|---|
| channel | `https://mirror.openshift.com/pub/openshift-v4/x86_64/clients/ocp/latest` |
| channel release name | **4.22.17** |
| tarball SHA256 | `2a2e3a3be56a5a44fca7c1e9249e7ed32a9dbf04c67225281c232b1cc31afe42` (verified before use) |
| binary SHA256 | `e03f81341d1186a03504a1be8f356265b974004782f07a35123e9cf6e35808d8` |
| component version | `4.22.0-202609301304.p2.g3f66eda.assembly.stream.el9-3f66eda` |
| git commit | `3f66edaf31831b93043b0baa55d02462d4e7ee39` |
| ImageSetConfiguration apiVersion | `mirror.openshift.io/v2alpha1` — **unchanged** at 4.22 |
| `--v2 list operators --catalog=…` | present |

This is the policy working as designed and worth stating plainly: **today, with 4.22
unsupported and fail-closed, Architect's own resolver already pulls an oc-mirror built
from the 4.22 stream.** That is correct and is not a target-support statement.

## 2. The 4.20 catalog is not merely vacuous — it is wrong

`data/params/4.20/oc-mirror-v2.json` holds 45 parameters, all
`outputFile: imageset-config.yaml`, all `supported-backend-only`. Lesson **L18** already
recorded it as *orphaned*: `buildImageSetConfig` is hand-coded and reads no catalog, and
`yamlValidator` validates `imageset-config.yaml` against the *install* scenario catalog,
so zero parameters apply and validation is vacuously true.

Every claimed path was probed against the **exact verified binary**. Vacuous validation
has been hiding real errors.

| Catalog claim | Binary verdict |
|---|---|
| `kubeVirtContainer` at **top level** | **REJECTED** — `json: unknown field "kubeVirtContainer"` |
| `mirror.operators[].packages[].channels[].includeConfig{.minVersion,.maxVersion}` | **REJECTED** — `json: unknown field "includeConfig"` |
| `mirror.blockedImages` as an array of **strings** | **REJECTED** — `cannot unmarshal string into Go struct field … of type v2alpha1.BlockedImage` |
| `mirror.helm.local[].charts.imagePaths` | **REJECTED** — `json: unknown field "charts"` |
| `archiveSize`, `mirror.platform.architectures`, `channels.type`, `channels.shortestPath`, `channels.full`, `additionalImages.targetRepo/targetTag` | accepted |

oc-mirror v2 **rejects unknown fields** (control probe: a deliberately bogus top-level key
is rejected), so these are hard failures, not tolerated extras.

### Corrected facts

- `kubeVirtContainer` belongs under **`mirror.platform`**. `backend/src/generate.js`
  already emits it there and is **correct**; the catalog row is wrong.
- Operator version filtering in v2 uses `minVersion`/`maxVersion` **directly** on the
  channel or package object. Both forms were accepted. `includeConfig` is a v1 construct.
- `mirror.blockedImages` entries are objects: `- name: docker.io/library/alpine`.

## 3. A live generated-artifact defect

This one is not theoretical. The **real product generator** was invoked and its output fed
to the **real binary**.

Input: one operator with `minVersion: 4.21.0`. `backend/src/generate.js`
`buildImageSetConfig` emitted:

```yaml
  operators:
    - catalog: registry.redhat.io/redhat/redhat-operator-index:v4.21
      packages:
        - name: odf-operator
          channels:
            - name: stable-4.21
              includeConfig:
                minVersion: 4.21.0
```

oc-mirror 4.22.17 verdict:

```
[ERROR] : [Executor] decode ImageSetConfiguration: json: unknown field "includeConfig"
```

**Whenever a user sets an operator `minVersion` or `maxVersion`, Architect generates an
`imageset-config.yaml` that the current oc-mirror v2 refuses to parse.** The fix is to emit
`minVersion`/`maxVersion` directly on the channel object.

Scope discipline: this is **pre-existing and not 4.22-specific**, it affects currently
supported 4.20 and 4.21, and it is **not fixed in this tranche** (research only; Tranche 1
must not mutate product behaviour). Carried to the findings queue as **FQ-9** for the human
to schedule — it is the strongest possible argument for DOC-166, because non-vacuous
validation is precisely what would have caught it.

## 4. A documentation / binary disagreement

OCP 4.22 *Disconnected environments* §5.13 *ImageSet configuration parameters for oc-mirror
plugin v2* documents `mirror.blockedImages` as *"Array of strings, Example:
`docker.io/library/alpine`"*. The binary rejects an array of strings.

The same table lists `kubeVirtContainer` among the top-level entries (between `archiveSize`
and `mirror`), while the binary rejects it at top level.

Per runbook Rule 2.5 and prompt rule G: **reproduce against the binary; the binary wins
mechanically; record the discrepancy.** Recorded. Not silently resolved in either
direction, and **not** a reason to weaken anything.

## 5. Proposed authority split

Classification of what `data/params/4.20/oc-mirror-v2.json` currently owns.

### GLOBAL oc-mirror v2 structural authority — 43 of 45

The ImageSetConfiguration **schema** belongs to oc-mirror, not to OpenShift. Paths, types,
requiredness, structure and enums are properties of the resolved global binary:

`apiVersion` · `kind` · `archiveSize` · `mirror` · `mirror.additionalImages[]{,.name,.targetRepo,.targetTag}` ·
`mirror.blockedImages[]{,.name}` · `mirror.helm.**` · `mirror.operators[]{,.catalog,.full,.targetCatalog,.targetName,.targetTag}` ·
`mirror.operators[].packages[]{,.name,.channels[],.channels[].name,.channels[].minVersion,.channels[].maxVersion}` ·
`mirror.platform{,.architectures,.graph,.kubeVirtContainer}` ·
`mirror.platform.channels[]{,.name,.type,.minVersion,.maxVersion,.includeMin,.includeMax,.shortestPath,.full}`

Because `apiVersion` stays `mirror.openshift.io/v2alpha1` across 4.20→4.22, **a per-minor
copy would be the same 45 rows three times over** — the clone-and-drift pattern that
produced 810 stale citations.

### Target-OCP-minor-specific **emitted values**, not structure — 2 paths, 3 emission sites

These are values Architect computes from the selected target minor. The *path* is global;
only the *value* is minor-dependent:

| Emission site | `generate.js` | Minor dependence |
|---|---|---|
| `mirror.platform.channels[].name` | `` `stable-${catalogMinor}` `` | selected minor |
| `mirror.platform.channels[].{minVersion,maxVersion}` | `state.release.patchVersion` | selected patch |
| `mirror.operators[].catalog` tag filter | `:v${catalogMinor}` | selected minor |

Note the **L12 fallback is still live** at `backend/src/generate.js:1637`:
`getOpenShiftMinorFromState(state) || "4.20"`, which silently emits `stable-4.20`. Already
tracked; re-confirmed present, not changed here.

Also observed: `mirror.platform.architectures` is modelled in the catalog and documented by
Red Hat, but `buildImageSetConfig` **never emits it** — a DOC-165-shaped coverage gap on the
imageset surface.

## 6. Smallest correct canonical authority location

**Proposed — not implemented:**

```
data/oc-mirror-v2/imageset-config.json          # ONE file. Global structural authority.
                                                # Provenance: resolved oc-mirror version +
                                                # binary SHA256 + verification date.
```

Not `data/params/<minor>/oc-mirror-v2.json`, in any minor.

Rationale, in order:

1. The schema's authority is the **oc-mirror binary**, whose policy is explicitly global
   and minor-independent. Storing it per minor encodes a dependency that does not exist.
2. It makes the existing asymmetry (4.20 has the file, 4.21 does not) disappear rather than
   be papered over by cloning — which is what **F-0B-1** was reframed to say.
3. Minor-specific **emitted values** already live where they belong: in generation logic
   driven by the locked version. They are not catalog rows and should not become any.
4. One file can be validated against the resolved binary by a **non-vacuous** test, which
   is the O2 requirement and what would have caught §3.

**Consequences to decide before implementing (human):**

- `validate-param-authority.js` and the catalog-citation guard iterate
  `data/params/<minor>/`. A file outside that tree needs explicit wiring, or it becomes a
  second unguarded surface — the current failure mode, relocated.
- `scenarioId` / `outputFile` semantics: the schema v2.0.0 catalog shape assumes a scenario.
  A global file either keeps a synthetic `scenarioId: oc-mirror-v2` or the schema grows a
  notion of non-scenario catalogs.
- Removing `data/params/4.20/oc-mirror-v2.json` changes 4.20 catalog **count** from 13 to
  12 and will trip any test pinning that number.

## 7. Explicitly not done

- No migration. No new file. `data/params/4.20/oc-mirror-v2.json` untouched.
- No `data/params/4.21/oc-mirror-v2.json`, no `data/params/4.22/oc-mirror-v2.json`.
- The four wrong rows in §2 are **not** corrected — that is 4.20 canonical product data,
  outside this tranche's write fence.
- The `includeConfig` generation defect (§3) is **not** fixed.
- No general ImageSetConfiguration editor is proposed (plan O2 holds).
