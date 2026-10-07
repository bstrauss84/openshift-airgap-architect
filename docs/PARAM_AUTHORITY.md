# Parameter authority (catalogs and docs index)

This project treats **versioned JSON under `data/params/<version>/`** as the single source of truth for installation parameters: paths, types, required flags, allowed values, defaults, and which output file (`install-config.yaml`, `agent-config.yaml`, `imageset-config.yaml`) each field belongs to.

**Doc links per scenario** live in **`data/docs-index/<version>.json`** (canonical).

## Canonical and mirror

```
data/params/<version>/<scenario-id>.json   ->  frontend/src/data/catalogs/<version>/<scenario-id>.json
data/docs-index/<version>.json             ->  frontend/src/data/docs-index/<version>.json
        CANONICAL  (edit this)                         GENERATED MIRROR  (never edit)
```

Both frontend trees are **generated mirrors**. They are produced by the sync
scripts, never hand-edited, and never read as a data source by tooling.

> **Never copy a mirror back over canonical.** Earlier revisions of this document
> and of `docs/CATALOG_SYNC_GUIDE.md` showed exactly that, and three scripts
> learned the habit — one of which now reads the mirror with a flat `readdir`
> and silently sees zero catalogs.

## Rules for contributors and automation

1. **Edit canonical first.** Update `data/params/<version>/<scenario-id>.json`, then:

   ```bash
   node scripts/validate-catalog.js data/params/<version>
   npm run sync-catalogs            # regenerate frontend/src/data/catalogs/<version>/
   ```

   For doc links, edit `data/docs-index/<version>.json`, then:

   ```bash
   node scripts/validate-docs-index.js
   npm run sync-docs-index          # regenerate frontend/src/data/docs-index/<version>.json
   ```

2. **Verify before you sync.** `npm run sync-catalogs:check` and
   `npm run sync-docs-index:check` are the read-only **gates**: they write
   nothing and exit non-zero on any drift, including an orphan mirror file.
   These are what CI and the pre-commit hook run.

   The `:preview` variants (`--dry-run`) print the same information but exit 0
   even when drift exists, so they are for human inspection only. Never wire a
   `--dry-run` invocation into CI — it produces a gate that cannot fail.

3. **One minor at a time, from that minor's own sources.** A correction to
   `data/params/4.20/**` is sourced from OpenShift 4.20 documentation and/or the
   `release-4.20` installer branch. Evidence from a different minor may trigger
   *investigation* of a row; it may never populate or overwrite one. See
   `docs/minor-release/MINOR_ONBOARDING_RUNBOOK.md` rule 4.

4. **Do not guess.** A field whose correct value is not derivable from an
   authoritative source is a stop-and-report, not a judgement call. Do not make
   a validator green by weakening the schema or backfilling invented values.

## Enforcement

`node scripts/validate-param-authority.js` is the single entrypoint, and runs in CI.
It iterates **every** supported minor from the canonical `SUPPORTED_MINORS`
rather than defaulting to one, and reports a PASS/FAIL summary for:

| Check | Scope |
|---|---|
| `validate-docs-index.js` | docs-index schema, all minors present |
| `validate-catalog.js data/params` | catalog schema v2.0.0, recursive, all minors |
| `validate-docs-index-frontend-parity.js <minor>` | once per supported minor |
| `validate-catalog-frontend-parity.js <minor>` | once per supported minor |
| `validate-catalog-agent-networkconfig-paths.js` | canonical and mirror trees |
| `validate-agent-nmstate-generator.js` | generator naming contract |

The schema itself is `schema/catalog-parameter-schema.json`. It is **documentation,
not the executable rule set** — `scripts/validate-catalog.js` implements the rules
in code. `scripts/validate-catalog-schema-conformance.test.js` holds the two to
each other so they cannot drift.

## Related

- `docs/DATA_AND_FRONTEND_COPIES.md` — where repo data and its mirrors live
- `docs/PARAMS_CATALOG_RULES.md` — catalog file format
- `docs/DOC_INDEX_RULES.md` — docs-index rules
- `docs/minor-release/MINOR_ONBOARDING_RUNBOOK.md` — adding a new minor
