# `scripts/minor/**` — minor-release onboarding automation

> **Authority model.** These scripts implement the ingestion order in
> `docs/minor-release/MINOR_ONBOARDING_RUNBOOK.md` Rule 2: mechanical discovery
> is installer-first, pinned to the exact released `x.y.z` and its matching
> source revision; same-minor Red Hat documentation then enriches the result and
> holds veto authority over user-facing supportedness. Installer presence alone
> never authorizes `supported-ui`. The previous minor is a diff baseline, never
> an authority for the new one.

Tracked, un-forked tooling for onboarding a new OpenShift minor.

Design and traceability: [`docs/minor-release/SCRIPTS_MINOR_SPECIFICATION.md`](../../docs/minor-release/SCRIPTS_MINOR_SPECIFICATION.md).
Procedure: [`docs/minor-release/MINOR_ONBOARDING_RUNBOOK.md`](../../docs/minor-release/MINOR_ONBOARDING_RUNBOOK.md).

---

## Invocation contract

```
node scripts/minor/<area>/<script>.js --minor <X.Y> [--workspace <dir>] [script flags]
```

Four rules, each derived from a specific failure recorded in the
[4.21 automation harvest](../../docs/minor-release/AUTOMATION_HARVEST_LEDGER_4.21.md):

| Rule | Why |
|---|---|
| **`--minor` is required, never defaulted.** | The 4.21-era tooling used `process.argv[2] \|\| "4.20"` in seven places, so a forgotten argument silently produced 4.20 results that looked like success. |
| **`--workspace` is explicit.** | The harvested scripts assumed an implicit `../analysis` sibling, which only makes sense inside a per-minor fork directory. |
| **Canonical data only.** | Read `data/params/<minor>/`, never the generated `frontend/src/data/catalogs/<minor>/` mirror. Three harvested artifacts inverted this and one of them now reads zero catalogs. |
| **Fail closed.** | Zero catalogs found, a missing input, an unparseable argument — all are errors. A broken directory read must never be reported as "nothing to do". |

**Never fork these scripts per minor.** The 4.20 → 4.21 toolkit was duplicated
with a single `sed` substitution; all 18 pairs differ only in minor literals,
and the substitution rewrote provenance claims without rewriting the evidence
behind them. Onboarding 4.23 must add no new script.

---

## Implemented

| Script | Purpose |
|---|---|
| `lib/minor.js` | Minor parsing/validation, argument parsing, workspace resolution. Enforces the no-hidden-default rule. |
| `compare/diff-params.js` | Parameter-set delta between two extractions. Both minors explicit; classification labels derived, not baked in. Declares `INPUT_CONTRACT`, the field names any producer must emit. |
| `compare/corrected-analysis.js` | **The false-positive filter.** Carries forward, verbatim, the rules that reduced a 67% false-positive rate to an actionable set. Every rule individually test-covered with positive *and* negative fixtures. |

All three have hermetic fixture tests. Run them with:

```bash
npm run test:tooling
```

---

## Deferred to Tranche 1, deliberately

The acquisition and extraction scripts specified in
`SCRIPTS_MINOR_SPECIFICATION.md` §3 are **not** implemented here:

```
acquire/fetch-docs.sh        acquire/clone-installer.sh
acquire/fetch-doc-html.sh    acquire/fetch-binaries.sh
acquire/refresh-doc-index.js extract/pdf-to-text.sh
extract/parse-go-structs.js  extract/parse-agent-config-structs.js
extract/extract-from-html.js extract/parse-ocp-param-tables.js
...                          report/generate-asset-manifest.js
```

Reason: every one of them either performs network acquisition or requires a
multi-gigabyte installer clone to exercise. Tranche 0A-1 is network-free and
its tests must stay hermetic, so writing them now would mean committing
untested scripts whose first real execution happens in Tranche 1 anyway.
Creating them untested is worse than creating them late.

What 0A-1 *does* establish is the architecture they must follow: the argument
contract above, the `lib/minor.js` foundation, and `diff-params.js`
`INPUT_CONTRACT` — which `extract/parse-go-structs.js` must satisfy when it
lands, closing harvest finding F1 at the producer end.

The gap list tracks the missing capabilities:
[`docs/minor-release/AUTOMATION_GAP_LIST.md`](../../docs/minor-release/AUTOMATION_GAP_LIST.md)
(GAP-01 through GAP-08).

---

## Typical sequence (once Tranche 1 lands the acquisition half)

```bash
MINOR=4.22
PREV=4.21
WS=/var/tmp/oaa-$MINOR          # outside the repo; never committed

# Acquisition (Tranche 1, network)
node scripts/minor/acquire/clone-installer.sh --minor $MINOR --workspace $WS
node scripts/minor/extract/parse-go-structs.js --minor $MINOR --workspace $WS

# Comparison (available now)
node scripts/minor/compare/diff-params.js \
  --baseline $WS/../oaa-$PREV/installer-source-params.json \
  --target   $WS/installer-source-params.json \
  --previous-minor $PREV --minor $MINOR \
  --out $WS/delta-installer-params.json

node scripts/minor/compare/corrected-analysis.js \
  --minor $MINOR --workspace $WS \
  --out $WS/corrected-analysis.json
```

The workspace lives outside the repository. Per **O4**, PDFs, clones, binaries
and raw acquisition artifacts are never committed; tracked provenance records
URLs, retrieval dates, hashes, pinned commits and reproduction instructions.
