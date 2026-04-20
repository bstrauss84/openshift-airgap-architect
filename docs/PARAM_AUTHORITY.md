# Parameter authority (catalogs and docs index)

This project treats **versioned JSON under `data/params/<version>/`** as the single source of truth for installation parameters: paths, types, required flags, allowed values, defaults, and which output file (`install-config.yaml`, `agent-config.yaml`, etc.) each field belongs to.

**Doc links per scenario** live in **`data/docs-index/<version>.json`** (canonical). The UI copy is `frontend/src/data/docs-index/<version>.json`; it must match canonical after the same normalization used in CI.

## Rules for contributors and automation

1. **Edit canonical first** when adding or changing a parameter: update `data/params/<version>/<scenario-id>.json`, run `node scripts/validate-catalog.js data/params/<version>`, then copy the file to `frontend/src/data/catalogs/<scenario-id>.json` so the UI and backend assumptions stay aligned (see `docs/DATA_AND_FRONTEND_COPIES.md`). When doc links or scenario headers change, edit **`data/docs-index/<version>.json`**, run `node scripts/validate-docs-index.js`, then copy to **`frontend/src/data/docs-index/`**.
2. **Never invent YAML keys** for NMState / agent `networkConfig` that are not spelled exactly as in the catalog paths (kebab-case, e.g. `prefix-length`, `base-iface`, `link-aggregation`). Internal app state may stay camelCase; emitted YAML must match NMState and the catalog.
3. **After any catalog or generator change**, run the full authority gate locally:

   ```bash
   node scripts/validate-param-authority.js
   cd backend && npm test
   cd frontend && npm test
   ```

   CI runs `validate-param-authority.js` on every push/PR to `main`/`master`.

## What `validate-param-authority.js` enforces

| Check | Script | Purpose |
|--------|--------|---------|
| Docs index schema | `validate-docs-index.js` | Required keys, scenario map shape, doc entries, `configTypes` / `tags`. |
| Catalog schema | `validate-catalog.js` | Required fields, citations, duplicates, docs-index scenario coverage. |
| Docs index ↔ frontend parity | `validate-docs-index-frontend-parity.js` | `data/docs-index/<version>.json` matches `frontend/src/data/docs-index/<version>.json` after stable sort. |
| Canonical ↔ frontend parity | `validate-catalog-frontend-parity.js` | Same scenario file in `data/params/4.20/` and `frontend/src/data/catalogs/` must match after stable sort of `parameters`. |
| NMState path spelling | `validate-catalog-agent-networkconfig-paths.js` | No camelCase leak in `agent-config.yaml` paths that include `networkConfig`. |
| Generator guard | `validate-agent-nmstate-generator.js` | `buildNmState` must not reintroduce forbidden dump keys (`prefixLength`, `linkAggregation`, `vlan: { baseIface`). |

Optional manual diff tooling: `scripts/validate-catalog-vs-doc-params.js` (see `docs/PARAMS_RECONCILIATION_CHECKLIST.md`).

## Version drift

When OpenShift doc version bumps (e.g. 4.21), add `data/params/4.21/` and wire the app to that version deliberately; rerun all checks for the new directory.
