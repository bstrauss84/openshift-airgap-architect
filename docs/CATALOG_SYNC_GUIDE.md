# Catalog and Docs-Index Sync Guide

How the generated frontend mirrors are kept identical to canonical data.

Authority: `docs/PARAM_AUTHORITY.md`. Locations: `docs/DATA_AND_FRONTEND_COPIES.md`.

---

## The model

```
data/params/<minor>/<scenario>.json    ->  frontend/src/data/catalogs/<minor>/<scenario>.json
data/docs-index/<minor>.json           ->  frontend/src/data/docs-index/<minor>.json
         CANONICAL                                     GENERATED MIRROR
```

One direction only. The mirrors exist because the frontend container ships only
the frontend tree — `data/` is not present at runtime.

**Current minors:** 4.20 (13 catalogs, including `oc-mirror-v2.json`) and
4.21 (12 catalogs). The scripts discover minors from the directory; they are not
enumerated anywhere.

---

## Commands

```bash
# Regenerate the mirrors (canonical -> frontend)
npm run sync-catalogs
npm run sync-docs-index

# GATE: read-only, exits non-zero on any drift  (this is what CI and the hook run)
npm run sync-catalogs:check
npm run sync-docs-index:check

# PREVIEW: same report, but always exits 0. Human inspection only — never CI.
npm run sync-catalogs:preview
npm run sync-docs-index:preview

# Verbose
npm run sync-catalogs:verbose

# Validate canonical data
node scripts/validate-catalog.js data/params/<minor>
node scripts/validate-docs-index.js

# Full authority gate (every supported minor)
node scripts/validate-param-authority.js
```

---

## Workflow

**Always edit canonical.**

```bash
# 1. Edit the canonical catalog
$EDITOR data/params/4.21/vsphere-ipi.json

# 2. Validate it
node scripts/validate-catalog.js data/params/4.21

# 3. Regenerate the mirror
npm run sync-catalogs

# 4. Stage both the canonical file and the regenerated mirror
git add data/params/4.21/vsphere-ipi.json frontend/src/data/catalogs/4.21/vsphere-ipi.json
```

### If you edited a mirror by mistake

Do **not** copy it back. The mirror is generated output; treating it as a source
is how canonical data silently acquires edits nobody reviewed.

```bash
# Discard the mirror edit and re-derive it from canonical
git checkout -- frontend/src/data/catalogs/
npm run sync-catalogs
```

Then make the change in `data/params/<minor>/` and regenerate.

> An earlier revision of this guide documented copying
> `frontend/src/data/catalogs/<scenario>.json` back into `data/params/4.20/` as
> the "better" option. That was wrong and it propagated: three scripts and three
> documents ended up treating the mirror as a source. One of them,
> `analyze-catalog-gaps.js`, read the mirror with a flat `readdir` and now
> silently sees zero catalogs.

---

## Enforcement

Drift is caught in **CI**, so the guarantee does not depend on anyone's local setup:

| Gate | Asserts |
|---|---|
| `npm run sync-catalogs:check` | Every canonical catalog has an identical mirror. |
| `npm run sync-docs-index:check` | Every canonical docs index has an identical mirror. |
| `validate-catalog-frontend-parity.js <minor>` | Mirror ≡ canonical after stable normalization, per minor. |
| `validate-docs-index-frontend-parity.js <minor>` | Same for the docs index. |

A tracked pre-commit hook is available for local use and runs the same **check**
commands. It is deliberately **read-only**: it reports drift and tells you to run
the sync, and never modifies or re-stages files on your behalf.

Install it with:

```bash
pre-commit install          # uses .pre-commit-config.yaml
```

> The hook does not auto-fix. An earlier untracked hook ran the sync and
> `git add`-ed the result mid-commit, so a commit could contain files the author
> never saw. Staging is the author's decision.

**Do not bypass hooks** with `--no-verify`. If a hook fails, fix the cause.

---

## Troubleshooting

**`sync-catalogs:check` reports drift.** Canonical and mirror disagree. Decide
which side is *correct* — it should always be canonical — then run
`npm run sync-catalogs` and stage both files.

**Mirror files appear after `git pull`.** Someone added a scenario or a minor.
Run both sync commands; if they report no changes, you are already current.

**Parity passes but `validate-catalog.js` fails.** Those are different problems.
Parity says the mirror matches canonical; `validate-catalog.js` says whether the
canonical content satisfies catalog schema v2.0.0. A faithfully mirrored
invalid catalog fails the second and passes the first.

---

## Adding a new minor

Do not copy another minor's catalogs. Follow
`docs/minor-release/MINOR_ONBOARDING_RUNBOOK.md`: author `data/params/<minor>/`
from that minor's own authoritative sources, with its own citations, then run the
sync scripts. A cloned catalog carries the previous minor's citation URLs, which
is how 810 stale citations reached `data/params/4.21/`.
