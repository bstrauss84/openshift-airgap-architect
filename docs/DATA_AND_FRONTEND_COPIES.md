# Data and Frontend Copies — Single Standard Location

**Purpose:** One canonical place for "where repo data lives" and "where the frontend keeps its copies", so data does not scatter and Docker/build stay consistent.

---

## Canonical source of truth (repo root)

- **`data/params/<version>/*.json`** — Parameter catalogs, one file per scenario per minor. Source of truth for path/type/required/allowed/default/outputFile. Validated by `node scripts/validate-catalog.js data/params/<version>`. See `docs/PARAMS_CATALOG_RULES.md`.
- **`data/docs-index/<version>.json`** — Scenario → doc links. Source of truth for which docs are shown per scenario. Validated by `node scripts/validate-docs-index.js`. See `docs/DOC_INDEX_RULES.md`.

**Do not** have the frontend import or read these paths at runtime (e.g. `../../../data/...`). In Docker the frontend container only has the frontend tree; `data/` is not there.

---

## Frontend copies — generated mirrors

**All frontend copies of repo data live under `frontend/src/data/`, versioned by minor.**

| Purpose | Frontend path (generated) | Canonical source | Regenerate with |
|---|---|---|---|
| **Param catalogs** | `frontend/src/data/catalogs/<version>/<scenario-id>.json` | `data/params/<version>/<scenario-id>.json` | `npm run sync-catalogs` |
| **Docs index** | `frontend/src/data/docs-index/<version>.json` | `data/docs-index/<version>.json` | `npm run sync-docs-index` |

Three properties of these mirrors:

1. **They are generated.** Never hand-edit one. Never author a new parameter or doc link into one.
2. **The direction is one-way.** Canonical → mirror, always. Never copy a mirror back over canonical, and never read a mirror as a data source in tooling.
3. **They mirror the whole directory.** The sync scripts copy every catalog for every minor. Do not maintain a partial mirror.

> **Corrections in this revision.** Earlier text gave the frontend paths without
> the `<version>` segment — a layout removed by the ADR-001/ADR-005 migration —
> and advised copying "only the scenario files the UI actually uses", which
> contradicts both the sync scripts and the parity validator's set-equality
> check. It also stated a CI parity guarantee that did not hold at the time,
> because the parity validator was itself reading the obsolete flat path and
> matching zero files. All three are fixed, and the guarantee below is now true.

---

## Enforcement

Drift is caught in CI, independent of whether any developer has a hook installed:

| Command | What it does |
|---|---|
| `npm run sync-catalogs:check` | Reports catalog mirror drift. Writes nothing. |
| `npm run sync-docs-index:check` | Reports docs-index mirror drift. Writes nothing. |
| `node scripts/validate-catalog-frontend-parity.js <minor>` | Asserts mirror ≡ canonical after stable normalization, per minor. |
| `node scripts/validate-docs-index-frontend-parity.js <minor>` | Same, for the docs index. |
| `node scripts/validate-param-authority.js` | Runs the parity checks for **every** supported minor. |

The parity validators take the minor explicitly and fail if it is omitted; they
no longer default to a single minor and report success for the repository.

---

## Who uses what

- **`frontend/src/data/catalogs/<version>/*.json`** — loaded by `frontend/src/catalogPaths.js` via `import.meta.glob`, and by `catalogFieldMeta.js`. Catalog resolution is version-aware and throws `UnsupportedVersionError` for any minor outside `SUPPORTED_MINORS` — there is no fallback to another minor.
- **`frontend/src/data/docs-index/<version>.json`** — used by `ScenarioHeaderPanel.jsx` for the scenario header doc links and version label.

---

## For agents and contributors

- Adding or changing a parameter: edit `data/params/<version>/<scenario-id>.json`, run `node scripts/validate-catalog.js data/params/<version>`, then `npm run sync-catalogs`.
- Adding or changing a doc link: edit `data/docs-index/<version>.json`, run `node scripts/validate-docs-index.js`, then `npm run sync-docs-index`.
- Adding a **new minor**: follow `docs/minor-release/MINOR_ONBOARDING_RUNBOOK.md`. Do not clone another minor's catalogs or citations.
- Do **not** change canonical `data/params/**` or `data/docs-index/**` unless the current plan explicitly allows it. Frontend agents change `frontend/src/**` and `frontend/tests/**`, and regenerate the mirrors with the sync scripts rather than editing them.
