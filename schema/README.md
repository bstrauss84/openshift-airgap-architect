# Schema store

This directory holds JSON schema and schema-store artifacts for the OpenShift Airgap Architect wizard.

## Contents

### Live

- **`stepMap.json`** — Wizard step flow and sub-steps; drives left nav and step ordering. Read at runtime by `backend/src/index.js` (with an in-code `defaultStepMap` fallback). **This is the only file here that is loaded at runtime.**
- **`catalog-parameter-schema.json`** — Catalog parameter schema v2.0.0: the declared contract for `data/params/<version>/*.json`.

### Not executed at validation time

`catalog-parameter-schema.json` is **documentation, not the rule set that runs**.
`scripts/validate-catalog.js` implements the rules in code and is what CI
executes. Because nothing held the two together they were able to drift, and
the v2.1 automation harvest found the schema under-declaring four required
fields.

They are now held to each other by
`scripts/validate-catalog-schema-conformance.test.js`, which imports the
validator's exported `CONTRACT` and compares it against this file. Known,
reviewed differences live in that test's `DIVERGENCE_REGISTER`, each with a
reason and an owning tranche; an unregistered difference fails the test.

**When changing catalog validation, change both** — the validator and this
schema — and let the conformance test confirm they still agree.

### Retained, with no current consumer

These have zero code or configuration references. They are kept because they
document earlier design intent, not because anything reads them. Do not treat
them as authority, and do not add a consumer without re-deriving the content
first.

- **`parameters.json`** — Early parameter-definition store (key, YAML path, type, constraints, defaults, tooltip, doc reference, applicability). Superseded by `data/params/<version>/*.json`, which is canonical.
- **`needsReview.json`** — Developer-mode list of parameters/questions missing doc citations. Superseded by the `citations` requirement that `validate-catalog.js` enforces on every parameter.
- **`installMethodQuestions.json`** — Early install-method question set. Superseded by the wizard step map and the scenario catalogs.

### Removed in v2.1

- **`scenarios.json`** — Deleted. It had zero code, test, script and CI references, and carried a stale `supportedVersions: ["4.17".."4.20"]` plus six copies of the same stale `versionRange`. Scenario truth is owned by `frontend/src/hostInventoryV2Helpers.js:getScenarioId()` (platform × method → scenario id) together with the catalog file set in `data/params/<version>/`. The historical `DOC-002` row in `docs/BACKLOG_STATUS.md` still references it as evidence of work completed at the time; that row is intentionally left in place.

  A repository-wide guard, `scripts/validate-version-lists.mjs`, now fails any
  tracked JSON carrying a `supportedVersions`/`versionRange` array that
  disagrees with `SUPPORTED_MINORS`, so the next dead list with a stale version
  array is caught regardless of filename.

## Conventions

- **Applicability**: Parameters and UI blocks are filtered by `platform`, `versionRange`, `installFamily`, `installMethod`. Only applicable fields are shown and emitted in YAML.
- **Doc vs heuristic**: Every question/guidance carries `source_type: "doc" | "heuristic"`. Doc-sourced items include a citation (doc id + section). Heuristic items are rendered with distinct styling and a short disclaimer.
- **Ambiguity**: If a parameter is unclear or contradictory across docs, stop and report it. Do not guess.

## Versioned docs

Official documentation is referenced per minor from `docs.redhat.com`; the
per-scenario link map is `data/docs-index/<version>.json`. See
`docs/DOC_INDEX_RULES.md`.
