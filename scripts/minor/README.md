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
| `extract/parse-go-structs.js` | **Installer-source extractor** (added in Tranche 1). Walks `pkg/types` from a named root struct into a flat, YAML-shaped parameter list. Satisfies `diff-params.js` `INPUT_CONTRACT`, which is what closes harvest finding **F1** / **GAP-12** at the producer end. |
| `extract/go-struct-parser.js` | Filesystem-free Go reader used by the extractor: structs, fields, JSON tags, doc comments, `Deprecated:` markers, kubebuilder markers, typed constants. |
| `extract/go-struct-walker.js` | Struct registry → dotted YAML paths. Resolves named types to the primitive they serialize as, because catalogs describe YAML, not Go. |

All have hermetic fixture tests — no network, no installer checkout. Run them with:

```bash
npm run test:tooling
```

### Extractor contract

```
node scripts/minor/extract/parse-go-structs.js \
  --minor <X.Y> --source <installer-clone> \
  [--root install-config|agent-config] [--release <x.y.z>] [--out <file>]
```

**Provenance is derived, never asserted** (runbook Rule 5): the commit recorded in the
output is read from the clone with `git rev-parse HEAD`, and there is no flag to state
one. A tree with no derivable commit is a stop-and-report, as is an empty source tree or a
missing root struct — a broken read is never reported as "nothing to do".

`--minor` accepts an **unsupported** minor on purpose: acquiring 4.22 evidence has to be
possible while 4.22 is still fail-closed (plan R3, specification §3).

Two cautions the fixtures encode, both found the hard way:

- A `+kubebuilder:validation:Enum` marker **outranks** harvested constants, and every row
  records `enumSource` so a consumer can tell which evidence class it has. An untyped
  constant sharing a `const (…)` block is **not** a value of the preceding line's type —
  attributing it produced a false 4.21→4.22 enum finding before the fixture was added.
- A kubebuilder enum is **not** necessarily enforced by `openshift-install`. Verify against
  the exact binary before recording one as installer-enforced validation.

---

## Still missing

0A-1 deferred the whole acquisition and extraction family to Tranche 1. Tranche 1
landed **`extract/parse-go-structs.js`** — it was needed to acquire and classify 4.22, and
it is testable hermetically from in-memory Go fixtures, so the original objection
("untested until its first real run") did not apply to it.

The rest of `SCRIPTS_MINOR_SPECIFICATION.md` §3 is **still not implemented**:

```
acquire/fetch-docs.sh        acquire/clone-installer.sh
acquire/fetch-doc-html.sh    acquire/fetch-binaries.sh
acquire/refresh-doc-index.js extract/pdf-to-text.sh
extract/extract-from-html.js extract/parse-ocp-param-tables.js
...                          report/generate-asset-manifest.js
```

Each either performs network acquisition or needs a multi-gigabyte clone to exercise, so
writing them would mean committing untested scripts. Tranche 1 performed all of those
steps **manually**, with the commands and their outputs recorded in
[`docs/minor-release/4.22/ACQUISITION_MANIFEST_4.22.md`](../../docs/minor-release/4.22/ACQUISITION_MANIFEST_4.22.md)
— which is the specification a future `report/generate-asset-manifest.js` should emit.

One correction for whoever writes `acquire/fetch-doc-html.sh`: `curl` receives **HTTP 403
from `docs.redhat.com` for every URL**, `html` and `html-single` alike, even with a browser
User-Agent. The Revision-3 note that 4.22 doc checks return 200 does not hold for `curl`
from this environment. A 403 is **not** evidence a page is absent (runbook Rule 2.4.1).

`extract/parse-agent-config-structs.js` turned out to be unnecessary: `parse-go-structs.js`
takes `--root agent-config` and reaches the same surface, so a second script would be the
fork the rules forbid.

The gap list tracks what remains:
[`docs/minor-release/AUTOMATION_GAP_LIST.md`](../../docs/minor-release/AUTOMATION_GAP_LIST.md)
(GAP-01 through GAP-08; **GAP-12 is closed** at the producer end). Per-gap status after
Tranche 1 is in
[`docs/minor-release/4.22/AUTOMATION_REUSE_REPORT_TRANCHE_1.md`](../../docs/minor-release/4.22/AUTOMATION_REUSE_REPORT_TRANCHE_1.md).

---

## Typical sequence

This is the sequence Tranche 1 actually ran for 4.21.35 → 4.22.16.

```bash
MINOR=4.22; PREV=4.21
WS=/var/tmp/oaa-$MINOR          # outside the repo; never committed

# 1. Acquisition — still manual (no acquire/ scripts yet).
#    Resolve the exact x.y.z from the Cincinnati stable-<minor> channel, download
#    openshift-install, verify SHA256 against that release's own sha256sum.txt BEFORE
#    use, then read the commit the binary reports and fetch exactly that commit:
git -C "$WS/installer-$REL" fetch --depth 1 origin "$COMMIT"

# 2. Extraction — available now, one script for both surfaces.
for root in install-config agent-config; do
  node scripts/minor/extract/parse-go-structs.js \
    --minor $PREV  --release $PREV_REL --source "$WS/installer-$PREV_REL" \
    --root $root --out "$WS/$root-params-$PREV.json"
  node scripts/minor/extract/parse-go-structs.js \
    --minor $MINOR --release $REL      --source "$WS/installer-$REL" \
    --root $root --out "$WS/$root-params-$MINOR.json"

# 3. Comparison.
  node scripts/minor/compare/diff-params.js \
    --baseline "$WS/$root-params-$PREV.json" \
    --target   "$WS/$root-params-$MINOR.json" \
    --previous-minor $PREV --minor $MINOR \
    --out "$WS/delta-$root-$PREV-to-$MINOR.json"
done

# 4. False-positive filtering — only once the new minor's catalogs exist, because
#    its rules suppress catalog-vs-source artifacts. Not applicable to a
#    source-vs-source diff.
node scripts/minor/compare/corrected-analysis.js --minor $MINOR --workspace $WS \
  --out $WS/corrected-analysis.json
```

Extract from the **exact released commit for each minor**, never a `release-X.Y` branch
tip (runbook Rule 2.1). The drift is not hypothetical: `azure.Platform.AllowSharedKeyAccess`
was absent from the 4.20 tip and present in released 4.20.40.

The workspace lives outside the repository. Per **O4**, PDFs, clones, binaries and raw
acquisition artifacts are never committed; tracked provenance records URLs, retrieval
dates, hashes, pinned commits and reproduction instructions.
