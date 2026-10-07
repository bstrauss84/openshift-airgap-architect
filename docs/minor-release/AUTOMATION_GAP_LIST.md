# Automation Gap List

> **Tranche 0A-0 deliverable 3 of 3.** Derived from the [4.21 Automation Harvest Ledger](AUTOMATION_HARVEST_LEDGER_4.21.md)
> ([machine-readable source](automation-harvest-ledger-4.21.json)), per OCP-4.22 v2.1 implementation plan Revision 3 §3.0.
>
> **Capabilities the 4.21 effort needed but never automated.** Every entry below was performed by hand
> during 4.20 and/or 4.21, or was required and silently skipped. Each will be needed again for 4.22.

**These `GAP-nn` identifiers are NOT backlog IDs.** Canonical IDs must be assigned from
`docs/BACKLOG_STATUS.md` (current namespaces: `DOC-` up to 164, `PROD-` up to 046, `PHX-`) by the human
before any of these is scheduled. `CLAUDE.md` execution-contract rule 11 forbids inventing or reusing
backlog IDs.

---

## Summary

| ID | Capability | Severity for 4.22 | Evidence it was missing |
|---|---|---|---|
| **GAP-01** | PDF → text conversion | **HIGH** | `pdftotext` named in two documents; no script performs it |
| **GAP-02** | Documentation HTML fetch | **HIGH** | `extract-from-html.js` exists with nothing to feed it |
| **GAP-03** | ASSET_MANIFEST generation | **HIGH** | Hand-written; already drifted from the tree it describes |
| **GAP-04** | Installer source clone (pinned) | MEDIUM | Manual `git clone` in the runbook only |
| **GAP-05** | Previous-minor extraction baseline retention | **HIGH** | Required 4.22 input exists in one gitignored copy |
| **GAP-06** | docs-index frontend sync | **HIGH** | `sync-catalogs.js` covers catalogs only |
| **GAP-07** | Binary acquisition + checksum verification | MEDIUM | Manual `curl`; checksums recorded after the fact |
| **GAP-08** | Field Guide minor onboarding | MEDIUM | `onboard-field-guide` referenced; does not exist |
| **GAP-09** | Catalog-citation version guard | **HIGH** | 810 drifted citations shipped undetected |
| **GAP-10** | Mock fixtures for current minors | MEDIUM | `backend/mock-data/` stops at 4.20 |
| **GAP-11** | Schema/validator conformance | MEDIUM | `catalog-parameter-schema.json` is decorative |
| **GAP-12** | Producer/consumer field-contract test | **HIGH** | Finding F1: a change class was structurally dead |
| **GAP-13** | CI coverage for existing checks | MEDIUM | 4 npm scripts exist, none wired into CI |

---

## GAP-01 — PDF → text conversion is entirely manual

**What is missing.** Nothing in either toolkit converts the acquired PDFs into the `../docs/extracted/*.txt`
files that `extract-all-params.sh` and `extract-table-params.sh` both iterate over.

**Evidence.** `PHASE_2_1_COMPLETION.md` §2.1.1 records *"Extracted text from all 12 OpenShift 4.20 PDFs
using pdftotext"* producing 6.1 MB of text, and `field-guide-certification/source-manifest.json` names
`extractionTool: "pdftotext (poppler)"`. Neither names a script, and no script in
`local-docs/ocp-4.2*/scripts/` invokes `pdftotext`. `AUDIT_AUTOMATION_GUIDE.md` lists `pdftotext` only
under "Optional but helpful" prerequisites.

**Consequence for 4.22.** The documentation-extraction pipeline has a manual step in the middle. During
4.21 this gap contributed to the entire documentation-extraction branch simply not being run: no
`*-params.json`, `*-table-params.json` or `parameter-inventory-complete.json` exists under
`ocp-4.21/analysis`.

**Proposed.** `scripts/minor/extract/pdf-to-text.sh` taking `--workspace`, iterating the acquired PDFs,
asserting `pdftotext` is present, writing one `.txt` per PDF, and reporting per-file character counts so
a silent empty conversion is visible.

---

## GAP-02 — No fetcher for documentation HTML

**What is missing.** `extract-from-html.js` takes an HTML file as `argv[2]`. Nothing acquires that file.

**Evidence.** `WEB_EXTRACTION_PLAN.md` specifies the base URL pattern and per-scenario section paths, and
records the quantified reason for preferring HTML: PDF table parsing had a **91% path-building error rate
(283 of 311 malformed)**. The extractor was written. No fetcher ever was, and no HTML-derived extraction
output exists under either minor's `analysis/`.

**Consequence for 4.22.** This is the gap behind ledger finding **F5** — a documented, implemented course
correction that was silently abandoned. It matters more now than it did in 2026: lesson **L4** records
4.21-era doc checks returning **403** for all 35 URLs, whereas 4.22 doc HEAD checks return **200**
(verified 3/3). The HTML route is viable for 4.22 in a way it was not for 4.21.

**Proposed.** `scripts/minor/acquire/fetch-doc-html.sh` taking `--minor`, fetching the parameter-table
pages enumerated by `docs-index-discovery.js`, recording each URL's SHA256. Acquisition-only (plan R4).

---

## GAP-03 — No ASSET_MANIFEST generator

**What is missing.** `local-docs/ocp-4.21/ASSET_MANIFEST.md` is 533 hand-written lines. Revision 3 §2.A
already notes *"no generator exists"*.

**Evidence.** The document is high quality — SHA256 for every asset, the installer pinned at
`1accb6487cf3784561665c08048dde20ad672c39`, verbatim tool version outputs, copy-pasteable verification
commands. It has nonetheless **already drifted**: §16 describes `CATALOG_GAP_ANALYSIS.md` as "400+ lines"
when that file is now a 780-byte tombstone.

**Consequence for 4.22.** Provenance is the backbone of **O1** and **O4**. Hand-maintained provenance
drifts, and drifted provenance is worse than none because it is trusted.

**Proposed.** `scripts/minor/report/generate-asset-manifest.js` emitting the machine-readable schema of
`field-guide-certification/source-manifest.json` with `ASSET_MANIFEST.md`'s field coverage: per-asset
size, SHA256, source URL, retrieval date; resolved branch **and commit SHA**; verbatim tool version
outputs; extraction counts harvested from the stderr logs. It must **fail closed** on a missing asset, an
absent or unparseable checksum, or a hash mismatch — mirroring the external-tool policy in `CLAUDE.md`.

Note the existing manifest's `matchesV420Method` boolean, which asserts not merely *what* was acquired but
that it was acquired *the same way as the baseline*. That is what makes a cross-minor comparison
legitimate, and the generator should preserve it.

---

## GAP-04 — Installer clone is a manual `git clone`

**What is missing.** A script that clones the installer at a release branch, records the resolved commit,
and verifies the expected `pkg/types` files are present.

**Evidence.** `AUDIT_AUTOMATION_GUIDE.md` §1.3 gives the commands for a human to run and lists eight key
files to verify by hand. `ASSET_MANIFEST.md` §4 records the resulting commit and a file count of 116,043.

**Consequence for 4.22.** The pinned commit is the single most load-bearing provenance fact in the whole
audit — every extracted parameter traces to it. Capturing it by hand is how provenance strings become
assertions rather than derivations (ledger finding **F3**).

**Proposed.** `scripts/minor/acquire/clone-installer.sh` taking `--minor`, doing a shallow clone of
`release-<minor>`, emitting the resolved commit SHA in a form `parse-go-structs.js` consumes directly
(design rule **R-5**), and failing if the release branch does not exist rather than silently falling back
to `main`.

---

## GAP-05 — The previous minor's extraction baseline survives in exactly one gitignored copy

**What is missing.** A tracked, hashed retention mechanism for each minor's `installer-source-params.json`
and `agent-config-params.json`.

**Evidence.** The 4.21 → 4.22 delta **requires** `local-docs/ocp-4.21/analysis/installer-source-params.json`
(489 KB, 525 parameters) as its baseline. `local-docs/**` is gitignored in full. The file exists on one
machine.

**Consequence for 4.22.** This is the sharpest instance of the single-machine bus factor **O4** exists to
remove. If the file is lost, the only recovery is re-cloning `release-4.21` and re-extracting — and that
would not necessarily reproduce the same bytes if the branch head has moved, which would make the delta
incomparable with the recorded 4.21 result.

**Proposed.** Decide deliberately between (a) committing the extraction JSONs as tracked baselines — they
are ~500 KB each, which is large but not GB-scale, and **O4** excludes PDFs, clones and binaries but not
small structured outputs — or (b) recording their SHA256 in tracked provenance plus deterministic
reproduction instructions pinned to the exact installer commit. **(a) is the safer choice** given that
(b) depends on a branch head that has already been observed to move. This is a human decision, not an
agent one.

---

## GAP-06 — docs-index frontend sync is manual

**What is missing.** `sync-catalogs.js` mirrors `data/params/<version>/` to
`frontend/src/data/catalogs/<version>/`. Nothing mirrors `data/docs-index/<version>.json` to
`frontend/src/data/docs-index/<version>.json`.

**Evidence.** `sync-catalogs.js` reads only `PARAMS_ROOT`/`CATALOGS_ROOT`. `docs/PARAM_AUTHORITY.md` and
`docs/DATA_AND_FRONTEND_COPIES.md` both instruct a human to "copy" the docs-index. Revision 3 records this
as correction #4.

**Consequence for 4.22.** A hand-copy step produces a silent divergence class whose symptom is wrong
documentation links in the UI. `validate-docs-index-frontend-parity.js` would catch it — but it is passed
no argument by the authority entrypoint, so it only ever checks 4.20.

**Proposed.** Extend `sync-catalogs.js` (or add a sibling) to cover docs-index, plus a `--dry-run` drift
check wired into CI. Plan work item 5 for Tranche 0A-1.

---

## GAP-07 — Binary acquisition and checksum verification are manual

**What is missing.** A script that resolves the latest patch for a minor, downloads `openshift-install`,
`oc` and `oc-mirror`, verifies each against that channel's own `sha256sum.txt` **before** use, and records
version, SHA256, architecture and source URL.

**Evidence.** `AUDIT_AUTOMATION_GUIDE.md` §1.4 gives manual `curl` commands. `ASSET_MANIFEST.md` §5 records
SHA256 for six assets — computed locally *after* download, not verified against Red Hat's published
`sha256sum.txt`. Revision 3 marks **S9** (mirror checksums for `latest`, `latest-4.22` and the patch
channel across architectures) as **OPEN**.

**Consequence for 4.22.** `CLAUDE.md` mandates that both tools be *"verified against that channel's own
`sha256sum.txt` before use or packaging"* and that acquisition **fail closed** on download failure, missing
or unparseable checksum metadata, checksum mismatch, or unsupported architecture. The audit workspace
acquisition does not currently meet the standard the product itself enforces.

**Proposed.** `scripts/minor/acquire/fetch-binaries.sh` implementing the two deliberately **different**
policies `CLAUDE.md` specifies and warns must not be collapsed: `oc-mirror` from `clients/ocp/latest`
(latest globally, independent of target minor) and `oc` from `clients/ocp/latest-<minor>`. Fail closed on
every failure mode listed above; never fall back to a cached binary, to `--v1`, or to unverified bytes.

---

## GAP-08 — No Field Guide minor-onboarding automation

**What is missing.** `field-guide-certification/evidence-model.json` titles itself *"Evidence Model for
`onboard-field-guide 4.22 --previous 4.21`"*. No such command exists anywhere in the tree.

**Evidence.** The evidence model defines Gate A (onboarding readiness) and Gate B (support enablement) and
a four-way differential-review vocabulary (`carry_forward_validated`,
`update_required_for_421_urls`, `update_required_for_421_urls_and_new_params`, `defer_*`). The v4.21 tree
is 9 modules / ~1302 lines / 124 occurrences of `4.21`, and was produced by hand.

**Consequence for 4.22.** Tranche 2 must scaffold `v4.22/` with Class A mechanical rewrites, Class B
statements re-verified against Tranche-1 evidence, and Class C statements **re-decided, never mechanically
bumped**. Done by hand at that scale, Class C is where a mechanical sweep destroys deliberate
cross-version statements.

**Proposed.** A scaffolder that copies the previous minor's compartment tree, performs **Class A
mechanical** substitutions only, and emits a **worklist** of Class B and Class C sites for human decision
— explicitly refusing to touch them itself. Note `command-audit.json` records **zero** minor-dependent
commands, so the binary-download contract is already templated and survives a copy verbatim; the scaffolder
must not "helpfully" rewrite it.

**Correction required on promotion:** Gate B's action reads *"Expand SUPPORTED_VERSIONS in `assembler.js`"*.
That is stale — the live list is `FIELD_GUIDE_SUPPORTED_MINORS` in
`backend/src/fieldGuide/versionResolution.js`, and Revision 3 Tranche 5 enumerates **eight** boundaries that
must flip atomically, not one.

---

## GAP-09 — No catalog-citation version guard

**What is missing.** Nothing asserts that a citation URL inside `data/params/<minor>/**` points at that
minor's documentation.

**Evidence.** Verified at the baseline: `data/params/4.21/*.json` contains **810** citation URLs pointing at
`openshift_container_platform/4.20` and **zero** at `/4.21`, while `data/docs-index/4.21.json` correctly
contains 45 × `/4.21`. The Field Guide has exactly this guard — `provenance.js:certifyDocRefs` throws when a
doc URL's minor does not match the resolved minor — and the catalogs do not.

**Consequence for 4.22.** Without it, cloning the 4.21 catalogs to 4.22 yields a **third generation** of the
same drift (lesson L5). The guard must exist **before** 4.22 catalogs are authored, not after.

**Proposed.** Port the `certifyDocRefs` pattern to the catalogs: any citation URL whose OCP minor differs
from its directory fails. Plan work item 4 for Tranche 0A-1 — added there **non-blocking**, turned
**blocking** in 0B once the 810 citations are repaired.

---

## GAP-10 — No mock fixtures for currently supported minors

**What is missing.** `backend/mock-data/` covers 4.18–4.20. There is nothing for 4.21, so `MOCK_MODE` cannot
exercise the currently supported window, let alone 4.22.

**Evidence.** Revision 3 lesson L19, carried as a `REPORTED` item.

**Consequence for 4.22.** `MOCK_MODE` is the offline development and demonstration path. Adding a third
minor while the mock data stops two minors back widens an already-stale gap.

**Proposed.** Generate 4.21 **and** 4.22 mock fixtures. Tranche 6. Generation (rather than hand-authoring)
is what keeps this from recurring at 4.23.

---

## GAP-11 — The catalog schema file is decorative

**What is missing.** `schema/catalog-parameter-schema.json` documents catalog schema v2.0.0, but
`scripts/validate-catalog.js` enforces the rules **in code**. Nothing asserts the two agree, so they can
drift silently.

**Evidence.** Revision 3 §1.1, confirmed by reading `validate-catalog.js`: the required-field list,
the seven-value `supportStatus` enum and the `/^4\.\d+$/` version pattern are all hardcoded in the validator.

**Consequence for 4.22.** Plan rule **R6** ("do not weaken the schema") is unenforceable while the schema is
not what runs. A reader consulting the schema file may rely on a contract the validator does not enforce,
or vice versa.

**Proposed.** Either drive `validate-catalog.js` off the schema file, or add a conformance test asserting the
two agree. Plan work item 8 for Tranche 0A-1. Note `docs/PARAMS_CATALOG_RULES.md` is a **third**
independent statement of the same schema and is already incomplete — it predates v2.0.0 and omits
`supportStatus`, `minVersion` and `maxVersion`. The conformance work should collapse three statements into
one authority.

---

## GAP-12 — No producer/consumer field-contract test

**What is missing.** Nothing asserts that the fields an extraction consumer reads are fields the extraction
producer writes.

**Evidence.** Ledger finding **F1**, verified against real output: `parse-go-structs.js` emits `description`,
`struct` and `field`; `compare-raw-extractions.js` reads `comment`, `jsonTag` and `file`. In
`delta-installer-params.json`, **0 of 49** added rows carry `file`, **0** carry `comment`, and `changed` is
**0** — `changed_description` detection is structurally dead. Downstream, all 49 classification rows in
`catalog-gap-analysis.json` read `"Source: unknown"`. `validate-findings.js` has the same defect
independently, reading `rawFieldDefinition` and `structName` which are never emitted.

**Consequence for 4.22.** A documentation-comment change between 4.21 and 4.22 would not be detected, and
the delta would report `changed: 0` with apparent confidence. This defect survived an entire minor
onboarding **and** produced a plausible-looking result, which is exactly what makes it dangerous.

**Proposed.** A contract test shared between the promoted `parse-go-structs.js` and `diff-params.js`
asserting every field the consumer reads is a field the producer writes, plus a fixture with a changed doc
comment asserting `changed_description` is produced. Design rule **R-6**.

---

## GAP-13 — Existing checks are not wired into CI

**What is missing.** Four capabilities exist as npm scripts or files and run in no pipeline:
`check:app-version`, `test:app-version`, `sync-catalogs:check` (catalog drift), and
`frontend/scripts/check-bundle-size.js`. Playwright e2e (`test:e2e`) is likewise absent from CI.

**Evidence.** `.github/workflows/ci.yml` read in full: it runs backend tests, frontend build and tests,
`validate-param-authority.js`, the container layout validator, the container smoke test and Gitleaks.
None of the five above appears. Revision 3 §2.C lists the same omissions.

**Consequence for 4.22.** Two of these bear directly on this effort. `check:app-version` is how plan work
item 12 (moving `VERSION` to `2.1.0-dev`) stays honest across four `package.json` files, three lockfiles and
`shared/package.json`. Bundle size grows with each added minor's catalogs and Field Guide tree, so an
unguarded budget will eventually be breached **by** version work.

**Also observed, and worth a deliberate decision rather than an accident (findings-queue FQ-8):** both
workflows trigger only on branches `[master, main, develop]`. Pushes to `work/v2.1-ocp-4.22-onboarding`
receive **no CI** until a PR targets one of those branches — which affects every tranche of this effort.

**Proposed.** Wire the four checks in Tranche 0A-1 alongside the other CI changes, and decide explicitly
whether the working branch should receive CI.

---

## Cross-cutting observation

Eight of these thirteen gaps (**01, 02, 03, 04, 05, 07, 08, 12**) share one root cause: **the 4.21 effort
automated the transformation steps and left the acquisition, provenance and contract-verification steps to
a human.** That is why the toolkit could be forked with `sed` and still appear to work — the parts that
would have caught the fork's damage (derived provenance, verified checksums, contract tests) were the parts
that were never written.

`scripts/minor/**` should close the acquisition and provenance gaps **first**, before the transformation
scripts are promoted. Otherwise 4.22 reproduces the same shape: good extraction, hand-made provenance, and
no mechanism to detect that a claim and its evidence have come apart.
