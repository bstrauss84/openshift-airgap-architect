# Data and Frontend Copies — Single Standard Location

**Purpose:** One canonical place for “where repo data lives” and “where the frontend keeps its copies” so we avoid scattering and keep Docker/build consistent.

---

## Canonical source of truth (repo root)

- **`data/params/<version>/*.json`** — Parameter catalogs per scenario. Source of truth for required/allowed/default/type. Validated by `node scripts/validate-catalog.js data/params/<version>`. See `docs/PARAMS_CATALOG_RULES.md`.
- **`data/docs-index/<version>.json`** — Scenario → doc links. Source of truth for which docs are shown per scenario. Validated by `node scripts/validate-docs-index.js`. See `docs/DOC_INDEX_RULES.md` and `docs/CONTRIBUTING.md` § Doc index.

**Do not** have the frontend import or read these paths at runtime (e.g. `../../../data/...`). In Docker the frontend container only has the frontend tree; `data/` is not there.

---

## Frontend copies — single standard location

**All frontend copies of repo data live under `frontend/src/data/`.**

| Purpose | Frontend path | Canonical source | When to sync |
|--------|----------------|-------------------|--------------|
| **Param catalogs** (scenario params for UI/validation) | `frontend/src/data/catalogs/*.json` | `data/params/<version>/<scenario-id>.json` | When canonical params change or a new scenario is added to the UI. **Copy only the scenario files the UI actually uses** (e.g. bare-metal-agent, bare-metal-ipi, nutanix-ipi). Do not copy all scenarios upfront; add a catalog when an agent implements support for that scenario (see § For agents and contributors). |
| **Docs index** (scenario header doc links) | `frontend/src/data/docs-index/<version>.json` | `data/docs-index/<version>.json` | When canonical docs index changes (e.g. new version or updated doc URLs). |

- **Do not** add new ad-hoc locations (e.g. a second “catalogs” folder under `public/` or elsewhere). Use one of these two subdirs.
- Code that needs param catalogs: import from `./data/catalogs/` (or `../data/catalogs/` from components). Code that needs the docs index: import from `./data/docs-index/` (or `../data/docs-index/` from components).
- Syncing is manual: copy from canonical into `frontend/src/data/` and run validators on the canonical files; the frontend copies are not validated by scripts (they are assumed to match after sync).

---

## Who uses what

- **`frontend/src/data/catalogs/*.json`** — Used by `catalogPaths.js` and `catalogFieldMeta.js` (Host Inventory v2 and catalog-driven UI). Only include the scenario catalogs the app actually uses (e.g. bare-metal-agent, bare-metal-ipi).
- **`frontend/src/data/docs-index/<version>.json`** — Used by `ScenarioHeaderPanel.jsx` for the segmented-flow scenario header (doc links and version label).

---

## For agents and contributors

- When adding a **new scenario** to the UI that needs a param catalog: copy `data/params/<version>/<scenario-id>.json` to `frontend/src/data/catalogs/<scenario-id>.json` and add the import and mapping in `catalogPaths.js` and `catalogFieldMeta.js`.
- When adding or updating the **docs index**: copy `data/docs-index/<version>.json` to `frontend/src/data/docs-index/<version>.json` and ensure `ScenarioHeaderPanel` (or any consumer) imports the correct version path.
- Do **not** change canonical `data/params/**` or `data/docs-index/**` unless the plan explicitly allows it (e.g. catalog-building phases or PM/RC instruction). Frontend agents only change `frontend/src/**` and `frontend/tests/**` and update copies under `frontend/src/data/` when needed.
