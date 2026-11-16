# 4.21 Automation Harvest Ledger

> **Tranche 0A-0 deliverable 1 of 3.** Produced under OCP-4.22 v2.1 implementation plan Revision 3 §3.0.
> Machine-readable source of truth: [`automation-harvest-ledger-4.21.json`](automation-harvest-ledger-4.21.json).
> **This markdown is generated from that JSON.** Edit the JSON, never this file.

| | |
|---|---|
| Ledger ID | `OAA-0A-0-HARVEST-4.21` |
| Produced | 2026-10-06 |
| Baseline commit | `09703fa675ac95ae8099c01f30454ad9db408a42` |
| Branch | `work/v2.1-ocp-4.22-onboarding` |
| Artifacts reviewed | **157** |

## Method

Every artifact opened and reviewed individually. Every forked 4.20/4.21 script pair diffed byte-for-byte. No bulk dispositions, no inference from filename. currentStatus asserted from reading, or from running only demonstrably read-only commands.

### Execution policy

No historical script was executed. Every 4.20/4.21 toolkit script writes into local-docs/<minor>/analysis/ and several fetch from the network; executing any of them would mutate read-only historical evidence or perform acquisition, both forbidden in 0A-0. Their currentStatus is therefore established by code inspection plus the recorded stderr logs and manifests they left behind. Tracked read-only validators WERE executed (see verifiedBaselineProbes).

## Verified baseline probes

All executed in this worktree at the baseline commit. Each is read-only.

| Probe | Result |
|---|---|
| `P3_VERSION` | 2.0.0 |
| `P4_validate-param-authority` | exit 1, 742 output lines |
| `P5_validate-catalog_4.20` | 296 error lines |
| `P6_validate-catalog_4.21` | 445 error lines |
| `P5P6_combined_data-params` | 741 error lines (296+445 = 741, consistent) |
| `P7_parity_4.21` | exit 1 — 'only in data/params/4.21: <all 12>' |
| `P7b_parity_4.20` | exit 1 — 'only in data/params/4.20: <all 13>' (plan documented 4.21 only; 4.20 is equally broken) |
| `P8_citations_4.21` | 810 x openshift_container_platform/4.20, zero /4.21 |
| `P8b_citations_4.20` | 855 x openshift_container_platform/4.20 (correct for 4.20) |
| `P8c_docsIndex_4.21` | 45 x /4.21 (correct) |
| `P10_find-hardcoded-versions_--check` | exit 1 — FAIL: 6 unclassified references, ALL SVG path coordinates in frontend/src/steps/HostInventoryV2Step.jsx:901-903,908-910. Plan expected exit 0. See discrepancy D1. |

_All run in this worktree at 09703fa. Each is read-only (reads files, prints, exits)._

## Disposition counts

| Disposition | Count |
|---|---:|
| REUSE AS-IS | 76 |
| PARAMETERIZE | 42 |
| REPLACE | 7 |
| RETIRE | 32 |
| **Total** | **157** |

### By group

| Group | Name | Plan count | Actual | REUSE AS-IS | PARAMETERIZE | REPLACE | RETIRE |
|---|---|---|---:|---:|---:|---:|---:|
| G1 | 4.20 audit/extraction toolkit | 18 | 18 | 0 | 0 | 0 | 18 |
| G2 | 4.21 audit/extraction toolkit | 20 | 20 | 2 | 12 | 2 | 4 |
| G3 | 4.21 analysis outputs | 32 | 32 | 30 | 0 | 0 | 2 |
| G4 | 4.21 Field Guide certification | 8 | 8 | 8 | 0 | 0 | 0 |
| G5 | Runbook and provenance | 2 | 2 | 0 | 1 | 1 | 0 |
| G6 | 4.20 phase records and platform audits | 13 ⚠ | 14 | 14 | 0 | 0 | 0 |
| G7 | Tracked scripts | 36 | 36 | 17 | 11 | 0 | 8 |
| G8 | Tracked sub-package scripts | 5 | 5 | 2 | 3 | 0 | 0 |
| G9 | CI and hooks | 4 | 4 | 1 | 2 | 1 | 0 |
| G10 | Workflow documentation | ~18 (20 paths named) ⚠ | 18 | 2 | 13 | 3 | 0 |

**RETIRE:** All 32 RETIRE rows carry a positive replacement justification naming what covers the capability. 18 of the 32 are the 4.20 toolkit copies, retired because their 4.21 twins (proven to differ only in minor literals) are promoted in their place.

**REUSE AS-IS:** 76 is high because it includes 30 analysis-output evidence artifacts (G3), 8 certification artifacts (G4), 14 historical phase/audit records (G6) and 6 operational scripts in G7 that have no OpenShift-version coupling. Among genuinely version-relevant tracked automation, REUSE AS-IS is rare: only validate-catalog.js, sync-catalogs.js, validate-docs-index.js, validate-catalog-agent-networkconfig-paths.js, validate-agent-nmstate-generator.js, validate-catalog-vs-doc-params.js, the two app-version scripts, extract-from-html.js and parse-ocp-param-tables.js.

---

## Fork-pair divergence summary

| | |
|---|---:|
| Pairs compared | 18 |
| Byte-identical | 5 |
| Divergent only in minor literal | 13 |
| **Divergent in logic** | **0** |

The entire 4.20 -> 4.21 toolkit fork is a pure minor-literal substitution. Not one line of logic, filtering rule, regex, threshold or control flow differs between any pair. The forking mechanism is recorded verbatim in local-docs/ocp-4.21/ASSET_MANIFEST.md section 7: sed -i 's/4\.20/4.21/g; s/ocp-4\.20/ocp-4.21/g; s/release-4\.20/release-4.21/g; s/stable-4\.20/stable-4.21/g' *.js *.sh

A single --minor / --workspace parameterization absorbs all 18 with zero behavioral risk, because there is no per-minor logic to preserve. This is the strongest possible evidence for the scripts/minor/** design and it removes the main risk the harvest gate existed to catch (discarding hard-won per-minor logic): there is no per-minor logic to discard. The hard-won knowledge lives in the filtering RULES inside corrected-analysis.js, not in the fork.

Byte-identical pairs: `consolidate-all-params.js`, `consolidate-params.js`, `extract-from-html.js`, `extract-table-params.sh`, `parse-ocp-param-tables.js`

---

## Ledger

## G1 — 4.20 audit/extraction toolkit

**Root:** `local-docs/ocp-4.20/scripts/` · **Plan count:** 18 · **Actual:** 18 · ✅ matches

| # | path | disposition | currentStatus (summary) |
|---:|---|---|---|
| 1 | `local-docs/ocp-4.20/scripts/analyze-by-scenario.js` | **RETIRE** | Not run (writes two files into read-only historical evidence). By inspection it would run, but PARAMS_DIR points at 4.20 so it can never analyse anoth… |
| 2 | `local-docs/ocp-4.20/scripts/compare-source-vs-catalogs.js` | **RETIRE** | Not run (writes ../analysis/source-catalog-comparison.json). Would execute by inspection; directory-driven so it picks up all 13 4.20 catalogs includi… |
| 3 | `local-docs/ocp-4.20/scripts/consolidate-all-params.js` | **RETIRE** | Not run (writes parameter-inventory-complete.json). Inspection shows it is version-clean and correctly excludes table files from the YAML branch via !… |
| 4 | `local-docs/ocp-4.20/scripts/consolidate-params.js` | **RETIRE** | Latently broken. Its filter is f.endsWith('-params.json'), which also matches '<doc>-table-params.json'; it then dereferences data.yamlExamples.length… |
| 5 | `local-docs/ocp-4.20/scripts/corrected-analysis.js` | **RETIRE** | Not run (writes corrected-analysis.json into read-only evidence). Fully readable; the filtering rules are intact and self-documenting. |
| 6 | `local-docs/ocp-4.20/scripts/download-docs.sh` | **RETIRE** | Not run — performs network acquisition, which is forbidden in 0A-0 and belongs to Tranche 1. Carries a KNOWN UNFIXED DEFECT: the vSphere entry uses fi… |
| 7 | `local-docs/ocp-4.20/scripts/extract-all-params.sh` | **RETIRE** | Not run (writes a JSON file per input doc). Inspection shows its input directory ../docs/extracted is produced by pdftotext, which NO script in the to… |
| 8 | `local-docs/ocp-4.20/scripts/extract-from-html.js` | **RETIRE** | Not run (requires an HTML input file that exists only inside the gitignored workspace). By inspection it is side-effect free apart from stdout, fully … |
| 9 | `local-docs/ocp-4.20/scripts/extract-oc-mirror-params-manual.js` | **RETIRE** | Would run and emit output, but the output is a transcription, not an extraction. Not executed. |
| 10 | `local-docs/ocp-4.20/scripts/extract-table-params.sh` | **RETIRE** | Not run (writes a JSON file per input). Note it invokes parse-parameter-tables.js, the parser with the recorded 91% malformed-path rate, and discards … |
| 11 | `local-docs/ocp-4.20/scripts/normalize-and-compare.js` | **RETIRE** | Not run (writes normalized-comparison.json). Readable and coherent; the stale 'Before: 72' console line would mislead on any other minor. |
| 12 | `local-docs/ocp-4.20/scripts/parse-agent-config-structs.js` | **RETIRE** | Not run (writes agent-config-params.json and requires a multi-GB installer clone that is not present in this worktree). Known to have worked at 4.21: … |
| 13 | `local-docs/ocp-4.20/scripts/parse-go-structs.js` | **RETIRE** | Not run (writes a ~500 KB output file and requires the installer clone). Known to have worked at 4.21: logs/parse-go-structs.stderr.log records 150 Go… |
| 14 | `local-docs/ocp-4.20/scripts/parse-imageset-params.js` | **RETIRE** | Unrunnable for 4.21 as forked: its input ../analysis/imageset-config-params-raw.txt exists only under ocp-4.20/analysis and was never produced for 4.2… |
| 15 | `local-docs/ocp-4.20/scripts/parse-ocp-param-tables.js` | **RETIRE** | Not run (no extracted text in this worktree). By inspection it is side-effect free and version-clean. |
| 16 | `local-docs/ocp-4.20/scripts/parse-parameters.js` | **RETIRE** | Not run (no extracted text present). PHASE_2_1_COMPLETION.md records it as the successful iteration but with weak required/optional detection and limi… |
| 17 | `local-docs/ocp-4.20/scripts/parse-parameter-tables.js` | **RETIRE** | Known defective. WEB_EXTRACTION_PLAN.md records a 91% path-building error rate (283 of 311 paths malformed) for this approach, and PHASE_2_1_COMPLETIO… |
| 18 | `local-docs/ocp-4.20/scripts/validate-findings.js` | **RETIRE** | Not run (writes validation-issues.json). Inspection shows it also reads sourceEntry.rawFieldDefinition and sourceEntry.structName, neither of which pa… |

#### G1.1 `local-docs/ocp-4.20/scripts/analyze-by-scenario.js`

| Field | Value |
|---|---|
| `path` | local-docs/ocp-4.20/scripts/analyze-by-scenario.js |
| `purpose` | Per-scenario coverage breakdown: for each of 12 scenarios, computes catalog params, applicable source params, present/missing/catalog-only counts, metadata discrepancies, coverage percent; emits JSON plus a rendered SCENARIO_BREAKDOWN.md. |
| `originalRole` | 4.20 Phase 3 reporting; re-run for 4.21 after the sed fork. |
| `inputs` | ../analysis/normalized-comparison.json, ../analysis/installer-source-params.json, ../analysis/agent-config-params.json, data/params/4.20/<scenario>.json |
| `outputs` | ../analysis/scenario-breakdown.json, ../analysis/SCENARIO_BREAKDOWN.md |
| `hardcodedVersionAssumptions` | PARAMS_DIR = <root>/data/params/4.20 (line 22). Also a hardcoded 12-element SCENARIOS array (lines 37-50) that silently excludes oc-mirror-v2 and any future scenario. |
| `currentStatus` | Not run (writes two files into read-only historical evidence). By inspection it would run, but PARAMS_DIR points at 4.20 so it can never analyse another minor without editing. |
| `disposition` | RETIRE |
| `action422` | None. Superseded by its 4.21 twin, which carries the identical logic and becomes scripts/minor/analyze-by-scenario.js. |
| `futureMinorValue` | Zero as a separate 4.20 copy; full value survives in the generic successor. |
| `requiredTestsGuards` | None for the retired copy. The successor needs a fixture test proving scenario discovery is read from the catalog directory rather than a literal array. |
| `evidenceReason` | RETIRE justified positively: diff against the 4.21 twin is a single line (PARAMS_DIR 4.20 -> 4.21). The 4.20 copy holds no capability the 4.21 copy lacks, so retiring it loses nothing and removes one of two files that must be kept in sync by hand. |
| `forkDivergence` | 1 hunk, 1 line: PARAMS_DIR minor literal only. |

#### G1.2 `local-docs/ocp-4.20/scripts/compare-source-vs-catalogs.js`

| Field | Value |
|---|---|
| `path` | local-docs/ocp-4.20/scripts/compare-source-vs-catalogs.js |
| `purpose` | Raw (un-normalized, un-filtered) comparison of installer-source + agent-config extractions against every catalog in a minor directory; classifies inBoth / onlyInSource / onlyInCatalog and raw metadata discrepancies with a possibleReasons hint list. |
| `originalRole` | 4.20 Phase 3.1 first-pass comparison — the step that produced the raw 366 'missing' figure later reduced to 120 by filtering. |
| `inputs` | ../analysis/installer-source-params.json, ../analysis/agent-config-params.json, every *.json in data/params/4.20 |
| `outputs` | ../analysis/source-catalog-comparison.json |
| `hardcodedVersionAssumptions` | CATALOG_DIR = ../../../data/params/4.20 (line 14). |
| `currentStatus` | Not run (writes ../analysis/source-catalog-comparison.json). Would execute by inspection; directory-driven so it picks up all 13 4.20 catalogs including oc-mirror-v2. |
| `disposition` | RETIRE |
| `action422` | None. The 4.21 twin becomes scripts/minor/compare-source-vs-catalogs.js. |
| `futureMinorValue` | Zero separately. The raw-comparison stage itself is valuable and survives in the successor. |
| `requiredTestsGuards` | None for the retired copy. |
| `evidenceReason` | RETIRE justified positively: diff is one line (CATALOG_DIR minor). Capability fully preserved by the 4.21 twin's generic successor. |
| `forkDivergence` | 1 hunk, 1 line: CATALOG_DIR minor literal only. |

#### G1.3 `local-docs/ocp-4.20/scripts/consolidate-all-params.js`

| Field | Value |
|---|---|
| `path` | local-docs/ocp-4.20/scripts/consolidate-all-params.js |
| `purpose` | Merges every *-params.json (YAML-example extractions) and *-table-params.json (table extractions) in the analysis directory into one keyed parameter inventory, tracking per-parameter occurrences, extraction methods, type set, requiredInAnyDoc, and an extractionIssues list for malformed table-derived paths. |
| `originalRole` | 4.20 Phase 2.1 consolidation of documentation-derived extractions. |
| `inputs` | ../analysis/*-params.json and ../analysis/*-table-params.json |
| `outputs` | ../analysis/parameter-inventory-complete.json |
| `hardcodedVersionAssumptions` | None. Byte-identical to its 4.21 twin. Contains no version literal; assumes only the per-minor fork directory layout (../analysis). |
| `currentStatus` | Not run (writes parameter-inventory-complete.json). Inspection shows it is version-clean and correctly excludes table files from the YAML branch via !f.includes('table'). |
| `disposition` | RETIRE |
| `action422` | None. The identical 4.21 twin is promoted and gains a --workspace argument. |
| `futureMinorValue` | Zero as a duplicate file. Its malformed-path quarantine logic is durable knowledge and travels with the successor. |
| `requiredTestsGuards` | None for the retired copy. |
| `evidenceReason` | RETIRE justified positively: cmp reports the two copies byte-for-byte identical, so this file is a pure duplicate. Keeping two identical copies is precisely the bus-factor/fork problem O4 exists to end. |
| `forkDivergence` | Byte-identical to the 4.21 copy. |

#### G1.4 `local-docs/ocp-4.20/scripts/consolidate-params.js`

| Field | Value |
|---|---|
| `path` | local-docs/ocp-4.20/scripts/consolidate-params.js |
| `purpose` | Earlier, narrower consolidation: merges only *-params.json into parameter-inventory.json, assuming every input has a yamlExamples array. |
| `originalRole` | 4.20 Phase 2.1 first-iteration consolidator, superseded within the same phase by consolidate-all-params.js. |
| `inputs` | ../analysis/*-params.json |
| `outputs` | ../analysis/parameter-inventory.json |
| `hardcodedVersionAssumptions` | None; byte-identical to its 4.21 twin. |
| `currentStatus` | Latently broken. Its filter is f.endsWith('-params.json'), which also matches '<doc>-table-params.json'; it then dereferences data.yamlExamples.length, which table extractions do not have. Once extract-table-params.sh has run into the same directory this script throws TypeError. Not executed (writes output and would corrupt/replace an evidence file). |
| `disposition` | RETIRE |
| `action422` | None. |
| `futureMinorValue` | Negative — reintroducing it would reintroduce the crash. |
| `requiredTestsGuards` | The successor (consolidate-all-params.js lineage) needs a fixture test that places both a *-params.json and a *-table-params.json in the input directory and asserts both are consolidated without error. |
| `evidenceReason` | RETIRE justified positively: consolidate-all-params.js is a strict functional superset — it consumes both extraction families, excludes table files from the YAML branch, and additionally quarantines malformed paths. It therefore replaces this script's entire capability while also fixing the endsWith collision defect documented above. |
| `forkDivergence` | Byte-identical to the 4.21 copy. |

#### G1.5 `local-docs/ocp-4.20/scripts/corrected-analysis.js`

| Field | Value |
|---|---|
| `path` | local-docs/ocp-4.20/scripts/corrected-analysis.js |
| `purpose` | THE false-positive filter. Re-runs the scenario comparison while suppressing four classes of spurious finding: CONDITIONAL_REQUIRED (nested fields required only if parent exists), TYPE_REPRESENTATION (ipnet.IPNet / configv1.* enums rendered as YAML strings), EXTERNAL_ENUMS, and PLATFORM_SPECIFIC (AWS params not counted missing from vSphere catalogs). |
| `originalRole` | 4.20 Phase 3 — the step that reduced 366 raw 'missing' parameters to 120 real ones, i.e. the 67% false-positive rate recorded in PHASE_2_EXECUTIVE_SUMMARY.md. |
| `inputs` | ../analysis/installer-source-params.json, ../analysis/agent-config-params.json, data/params/4.20/<scenario>.json |
| `outputs` | ../analysis/corrected-analysis.json |
| `hardcodedVersionAssumptions` | PARAMS_DIR = <root>/data/params/4.20 (line 25); hardcoded 12-element SCENARIOS array (lines 30-43). |
| `currentStatus` | Not run (writes corrected-analysis.json into read-only evidence). Fully readable; the filtering rules are intact and self-documenting. |
| `disposition` | RETIRE |
| `action422` | None. The 4.21 twin carries the byte-identical rule set and becomes scripts/minor/corrected-analysis.js. |
| `futureMinorValue` | Zero as a duplicate. The RULES are the single highest-value asset in the entire harvest and must survive verbatim in the successor. |
| `requiredTestsGuards` | The successor requires per-rule unit tests: one fixture per suppression class (nested-required, ipnet-as-string, configv1-as-string, capability/featureSet enum, controlPlane array notation, cross-platform applicability, deprecated-field skip, orphan-nested skip), each asserting the finding is suppressed, plus negative fixtures asserting a genuine discrepancy is NOT suppressed. |
| `evidenceReason` | RETIRE justified positively: byte-diff against the 4.21 twin is one line (PARAMS_DIR minor). Every filtering rule, regex and threshold is identical, so the 4.21 copy preserves 100% of the domain knowledge. This is the artifact Revision 3 §3.0 specifically warned against discarding; it is NOT being discarded, it is being promoted from its 4.21 copy. |
| `forkDivergence` | 1 hunk, 1 line: PARAMS_DIR minor literal only. All eight nestedRequiredPatterns regexes, both type-false-positive branches and the platformMap are identical. |

#### G1.6 `local-docs/ocp-4.20/scripts/download-docs.sh`

| Field | Value |
|---|---|
| `path` | local-docs/ocp-4.20/scripts/download-docs.sh |
| `purpose` | Downloads the 12 Red Hat OCP installation PDFs for a minor into ../docs/pdf, reporting per-file success and a final summary; exits nonzero if any download failed. |
| `originalRole` | 4.20 Phase 1.2 documentation acquisition. |
| `inputs` | network (docs.redhat.com PDF endpoints), hardcoded 12-entry docs array |
| `outputs` | ../docs/pdf/*.pdf (12 files, ~28 MB at 4.20) |
| `hardcodedVersionAssumptions` | BASE_URL carries the minor (line 9); all 12 PDF path+filename entries embed the minor (lines 18-29); two banner strings (lines 2, 33). |
| `currentStatus` | Not run — performs network acquisition, which is forbidden in 0A-0 and belongs to Tranche 1. Carries a KNOWN UNFIXED DEFECT: the vSphere entry uses filename 'Installing_on_vSphere' while the real 4.21 asset is 'Installing_on_VMware_vSphere'. ASSET_MANIFEST.md §10 records this produced a 404 at 4.21, was diagnosed in Slice 5F.1, and the PDF was fetched by hand — but neither the 4.20 nor the 4.21 script was ever corrected. |
| `disposition` | RETIRE |
| `action422` | None. The 4.21 twin becomes scripts/minor/fetch-docs.sh and MUST carry the vSphere filename correction. |
| `futureMinorValue` | Zero separately; the defect must not be carried forward twice. |
| `requiredTestsGuards` | The successor needs a dry-run/URL-construction unit test asserting the generated vSphere URL contains 'Installing_on_VMware_vSphere', so this specific 404 can never recur silently. |
| `evidenceReason` | RETIRE justified positively: the 4.21 twin is identical except for the minor literal and supersedes it. Retiring the 4.20 copy also halves the number of places the unfixed vSphere filename defect would have to be corrected. |
| `forkDivergence` | 3 hunks, all minor-literal: BASE_URL, 12 docs-array entries, 2 banner strings. The vSphere filename bug is present identically in both. |

#### G1.7 `local-docs/ocp-4.20/scripts/extract-all-params.sh`

| Field | Value |
|---|---|
| `path` | local-docs/ocp-4.20/scripts/extract-all-params.sh |
| `purpose` | Batch orchestrator: for every ../docs/extracted/*.txt, runs parse-parameters.js and writes <doc>-params.json, then prints a totals summary using jq. |
| `originalRole` | 4.20 Phase 2.1 extraction driver. |
| `inputs` | ../docs/extracted/*.txt (pdftotext output), parse-parameters.js, jq |
| `outputs` | ../analysis/<doc>-params.json (one per input text file) |
| `hardcodedVersionAssumptions` | Two banner strings only (lines 2, 10). All paths are relative to the per-minor fork directory. |
| `currentStatus` | Not run (writes a JSON file per input doc). Inspection shows its input directory ../docs/extracted is produced by pdftotext, which NO script in the toolkit performs — the PDF-to-text step is entirely manual. See gap list GAP-01. |
| `disposition` | RETIRE |
| `action422` | None. The 4.21 twin becomes scripts/minor/extract-doc-params.sh with an explicit --workspace argument. |
| `futureMinorValue` | Zero separately. |
| `requiredTestsGuards` | None for the retired copy. |
| `evidenceReason` | RETIRE justified positively: diff is two banner lines. The 4.21 twin preserves the orchestration logic exactly. |
| `forkDivergence` | 2 hunks, 2 lines: banner strings only. |

#### G1.8 `local-docs/ocp-4.20/scripts/extract-from-html.js`

| Field | Value |
|---|---|
| `path` | local-docs/ocp-4.20/scripts/extract-from-html.js |
| `purpose` | Regex-based HTML table scraper: finds tables whose markup matches /Parameter.*Description/, extracts rows into {path, description, valueType, type, table} and prints JSON to stdout. |
| `originalRole` | 4.20 Phase 2.1 — the deliberate replacement for PDF table parsing, per WEB_EXTRACTION_PLAN.md. |
| `inputs` | argv[2] = an HTML file |
| `outputs` | stdout JSON |
| `hardcodedVersionAssumptions` | None whatsoever. Byte-identical to the 4.21 twin; takes its input path as an argument and writes to stdout. |
| `currentStatus` | Not run (requires an HTML input file that exists only inside the gitignored workspace). By inspection it is side-effect free apart from stdout, fully generic, and the only extractor in the toolkit with no filesystem-layout assumption. |
| `disposition` | RETIRE |
| `action422` | None. The identical 4.21 twin is promoted unchanged. |
| `futureMinorValue` | Zero as a duplicate; high value via the promoted twin, because WEB_EXTRACTION_PLAN.md records HTML scraping as strictly superior to PDF table parsing (91% malformed-path rate). |
| `requiredTestsGuards` | None for the retired copy. |
| `evidenceReason` | RETIRE justified positively: cmp confirms byte-for-byte identity with the 4.21 copy, which is promoted as-is. Pure duplicate elimination. |
| `forkDivergence` | Byte-identical to the 4.21 copy. |

#### G1.9 `local-docs/ocp-4.20/scripts/extract-oc-mirror-params-manual.js`

| Field | Value |
|---|---|
| `path` | local-docs/ocp-4.20/scripts/extract-oc-mirror-params-manual.js |
| `purpose` | Despite the name it extracts nothing. It is a hand-transcribed, hardcoded array of ~56 ImageSetConfiguration parameters (including 6 deprecated storageConfig.* entries) copied by a human from Table 5.3 of the Disconnected Environments PDF, serialised to JSON with a provenance header. |
| `originalRole` | 4.20 Phase 2.4 — the fallback after parse-imageset-params.js could not be driven (its raw text input had to be produced by hand). |
| `inputs` | None. The parameter list is a literal in the source. |
| `outputs` | ../analysis/oc-mirror-v2-params.json |
| `hardcodedVersionAssumptions` | Two provenance strings naming the minor (lines 17, 88) and the entire parameter payload, which is minor-specific data frozen in code. |
| `currentStatus` | Would run and emit output, but the output is a transcription, not an extraction. Not executed. |
| `disposition` | RETIRE |
| `action422` | None. The 4.21 twin is dispositioned REPLACE and that replacement serves 4.22. |
| `futureMinorValue` | Negative. Carrying this pattern forward is what let the 4.21 copy claim 4.21 provenance over unchanged 4.20 content. |
| `requiredTestsGuards` | None for the retired copy; the replacement's guards are recorded on the 4.21 row. |
| `evidenceReason` | RETIRE justified positively: the capability (a canonical per-minor ImageSetConfiguration parameter inventory) is not lost — it is relocated to real catalog authority under O2 (data/params/<minor>/oc-mirror-v2.json with real validation), which is strictly better than a code-embedded list. The 4.20 copy is additionally a byte-duplicate of the 4.21 copy apart from two provenance strings. |
| `forkDivergence` | 2 hunks, 2 lines: provenance strings only. CRITICAL: the 56-parameter payload is IDENTICAL between the two copies, so the 4.21 copy asserts 'OpenShift 4.21 Disconnected Environments Documentation' over content never re-read against 4.21. See finding F3. |

#### G1.10 `local-docs/ocp-4.20/scripts/extract-table-params.sh`

| Field | Value |
|---|---|
| `path` | local-docs/ocp-4.20/scripts/extract-table-params.sh |
| `purpose` | Batch wrapper that runs parse-parameter-tables.js over every ../docs/extracted/*.txt and writes <doc>-table-params.json, printing per-document table/parameter counts. |
| `originalRole` | 4.20 Phase 2.1 table-extraction driver. |
| `inputs` | ../docs/extracted/*.txt, parse-parameter-tables.js, jq |
| `outputs` | ../analysis/<doc>-table-params.json |
| `hardcodedVersionAssumptions` | None. Byte-identical to the 4.21 twin; no version literal at all, only the per-minor directory layout. |
| `currentStatus` | Not run (writes a JSON file per input). Note it invokes parse-parameter-tables.js, the parser with the recorded 91% malformed-path rate, and discards its stderr (2>/dev/null), so parser failures surface only as suspiciously low counts. |
| `disposition` | RETIRE |
| `action422` | None. The identical 4.21 twin is promoted with a --workspace argument and must be re-pointed off the failed parser. |
| `futureMinorValue` | Zero as a duplicate. |
| `requiredTestsGuards` | None for the retired copy. |
| `evidenceReason` | RETIRE justified positively: cmp confirms byte-for-byte identity with the 4.21 copy, which is promoted. Pure duplicate elimination. |
| `forkDivergence` | Byte-identical to the 4.21 copy. |

#### G1.11 `local-docs/ocp-4.20/scripts/normalize-and-compare.js`

| Field | Value |
|---|---|
| `path` | local-docs/ocp-4.20/scripts/normalize-and-compare.js |
| `purpose` | Path-notation resolver: strips array notation (compute[].name -> compute.name), builds variant maps both ways, then re-runs the source-vs-catalog comparison on normalized paths. Raised match rate from 72 (15%) to the normalized figure printed at runtime. |
| `originalRole` | 4.20 Phase 3.1 — the fix for the single largest comparison artefact (array-notation mismatch). |
| `inputs` | ../analysis/installer-source-params.json, ../analysis/agent-config-params.json, data/params/4.20/*.json |
| `outputs` | ../analysis/normalized-comparison.json |
| `hardcodedVersionAssumptions` | CATALOG_DIR = ../../../data/params/4.20 (line 14). Also a hardcoded 'Before: 72 matches (15% overlap)' line (line 299) that is a frozen 4.20 statistic printed unconditionally for every minor. |
| `currentStatus` | Not run (writes normalized-comparison.json). Readable and coherent; the stale 'Before: 72' console line would mislead on any other minor. |
| `disposition` | RETIRE |
| `action422` | None. The 4.21 twin becomes scripts/minor/normalize-and-compare.js. |
| `futureMinorValue` | Zero separately. The normalization function is essential and survives in the successor. |
| `requiredTestsGuards` | The successor needs unit tests for normalizePath and getPathVariants, and the frozen 'Before: 72' baseline must become a computed or omitted value. |
| `evidenceReason` | RETIRE justified positively: diff is one line (CATALOG_DIR minor). The 4.21 twin preserves the normalization logic identically. |
| `forkDivergence` | 1 hunk, 1 line: CATALOG_DIR minor literal only. |

#### G1.12 `local-docs/ocp-4.20/scripts/parse-agent-config-structs.js`

| Field | Value |
|---|---|
| `path` | local-docs/ocp-4.20/scripts/parse-agent-config-structs.js |
| `purpose` | Parses Go struct definitions under pkg/types/agent and pkg/types/baremetal from a cloned installer tree, recursing from agent.Config to build agent-config.yaml parameter paths with type, requiredness (omitempty), kubebuilder default/enum, and validate tags. |
| `originalRole` | 4.20 Phase 2.2 agent-config extraction. |
| `inputs` | ../installer/source/installer/pkg/types/{agent,baremetal}/**/*.go |
| `outputs` | ../analysis/agent-config-params.json |
| `hardcodedVersionAssumptions` | One provenance string: 'github.com/openshift/installer release-4.20' (line 20). The traversal itself is version-agnostic. |
| `currentStatus` | Not run (writes agent-config-params.json and requires a multi-GB installer clone that is not present in this worktree). Known to have worked at 4.21: logs/parse-agent-config-structs.stderr.log records 13 Go files, 8 structs, 25 parameters, no warnings. |
| `disposition` | RETIRE |
| `action422` | None. The 4.21 twin becomes scripts/minor/parse-agent-config-structs.js. |
| `futureMinorValue` | Zero separately. |
| `requiredTestsGuards` | None for the retired copy. |
| `evidenceReason` | RETIRE justified positively: diff is one provenance line. Note the provenance string is the ONLY thing tying output to a minor, which is exactly why it must become a parameter rather than a literal in the successor. |
| `forkDivergence` | 1 hunk, 1 line: result.source provenance string only. |

#### G1.13 `local-docs/ocp-4.20/scripts/parse-go-structs.js`

| Field | Value |
|---|---|
| `path` | local-docs/ocp-4.20/scripts/parse-go-structs.js |
| `purpose` | Parses every non-test Go file under pkg/types in a cloned installer tree, builds a struct registry, then recurses from types.InstallConfig to emit install-config.yaml parameter paths with Go type, mapped type, requiredness, kubebuilder default/enum and a doc-comment description. |
| `originalRole` | 4.20 Phase 2.2 install-config extraction — the primary authoritative-source extractor for the whole audit. |
| `inputs` | ../installer/source/installer/pkg/types/**/*.go (non-test) |
| `outputs` | ../analysis/installer-source-params.json |
| `hardcodedVersionAssumptions` | One provenance string: 'github.com/openshift/installer release-4.20' (line 20). |
| `currentStatus` | Not run (writes a ~500 KB output file and requires the installer clone). Known to have worked at 4.21: logs/parse-go-structs.stderr.log records 150 Go files, 141 structs, 525 parameter paths, no warnings. Documented limitations (AUDIT_AUTOMATION_GUIDE.md §2.1) remain unfixed: nested structs only one level deep in places, no conditional-requiredness detection, no runtime defaulting. |
| `disposition` | RETIRE |
| `action422` | None. The 4.21 twin becomes scripts/minor/parse-go-structs.js. |
| `futureMinorValue` | Zero separately. |
| `requiredTestsGuards` | The successor needs golden-fixture tests over a small synthetic Go tree, and must emit the field names its own downstream comparator reads (see finding F1). |
| `evidenceReason` | RETIRE justified positively: diff is one provenance line. Logic, regexes and recursion guards are identical to the 4.21 twin, which supersedes it. |
| `forkDivergence` | 1 hunk, 1 line: result.source provenance string only. |

#### G1.14 `local-docs/ocp-4.20/scripts/parse-imageset-params.js`

| Field | Value |
|---|---|
| `path` | local-docs/ocp-4.20/scripts/parse-imageset-params.js |
| `purpose` | Column-aware parser for the ImageSetConfiguration parameter table, reading a hand-prepared raw text file and inferring path/type/required/default/example. |
| `originalRole` | 4.20 Phase 2.4 intended oc-mirror extractor. |
| `inputs` | ../analysis/imageset-config-params-raw.txt (produced by hand) |
| `outputs` | ../analysis/oc-mirror-v2-params.json |
| `hardcodedVersionAssumptions` | One provenance string (line 22). Additionally hardcodes Red Hat table numbering ('Table 5.4. DeleteImageSetConfiguration parameters', lines 41 and 65) — brittle across minors, since Revision 3 §1.2 records that Red Hat renumbers chapters/tables between minors. |
| `currentStatus` | Unrunnable for 4.21 as forked: its input ../analysis/imageset-config-params-raw.txt exists only under ocp-4.20/analysis and was never produced for 4.21. ASSET_MANIFEST.md §8 records oc-mirror extraction as 'Deferred' for exactly this reason. Not executed. |
| `disposition` | RETIRE |
| `action422` | None. The 4.21 twin is also retired/replaced; O2 supplies real oc-mirror authority. |
| `futureMinorValue` | Low. The hardcoded table numbers make it fragile, and O2 replaces the whole approach with a validated per-minor catalog. |
| `requiredTestsGuards` | None for the retired copy. |
| `evidenceReason` | RETIRE justified positively: the capability is replaced by O2's canonical per-minor oc-mirror catalog plus non-vacuous imageset-config.yaml validation (Tranche 0B), which is a strictly stronger mechanism than a brittle table-number-dependent text parser whose input was never produced for 4.21. |
| `forkDivergence` | 1 hunk, 1 line: result.source provenance string only. Table-number literals identical in both. |

#### G1.15 `local-docs/ocp-4.20/scripts/parse-ocp-param-tables.js`

| Field | Value |
|---|---|
| `path` | local-docs/ocp-4.20/scripts/parse-ocp-param-tables.js |
| `purpose` | Purpose-built two-column OCP PDF table parser: detects 'Table N.M. ...parameter...' boundaries, parses rows, reads 'Value:' lines for type, and reconstructs nested paths from indentation, suppressing parent-only rows. |
| `originalRole` | 4.20 Phase 2.1 (revised) — the third and best-performing PDF table parser iteration. |
| `inputs` | argv[2] = extracted PDF text file |
| `outputs` | stdout JSON |
| `hardcodedVersionAssumptions` | None. Byte-identical to the 4.21 twin; argv-driven, stdout-only. |
| `currentStatus` | Not run (no extracted text in this worktree). By inspection it is side-effect free and version-clean. |
| `disposition` | RETIRE |
| `action422` | None. The identical 4.21 twin is promoted unchanged. |
| `futureMinorValue` | Zero as a duplicate; real value via the promoted twin as the PDF fallback when HTML extraction is unavailable. |
| `requiredTestsGuards` | None for the retired copy. |
| `evidenceReason` | RETIRE justified positively: cmp confirms byte-for-byte identity with the 4.21 copy, which is promoted as-is. |
| `forkDivergence` | Byte-identical to the 4.21 copy. |

#### G1.16 `local-docs/ocp-4.20/scripts/parse-parameters.js`

| Field | Value |
|---|---|
| `path` | local-docs/ocp-4.20/scripts/parse-parameters.js |
| `purpose` | Extracts parameters from the 'Sample install-config.yaml file' / 'Sample agent-config.yaml file' sections of PDF-derived text: captures the YAML block, then parses the following 'where:' prose into per-parameter descriptions, inferring required/type from wording. |
| `originalRole` | 4.20 Phase 2.1 primary documentation extractor (iteration 3, the one that worked). |
| `inputs` | argv[2] = extracted PDF text file |
| `outputs` | stdout JSON |
| `hardcodedVersionAssumptions` | One header comment line naming the minor (line 3). No functional version dependency. |
| `currentStatus` | Not run (no extracted text present). PHASE_2_1_COMPLETION.md records it as the successful iteration but with weak required/optional detection and limited coverage from the 'where:' pattern. |
| `disposition` | RETIRE |
| `action422` | None. The 4.21 twin is promoted with a de-versioned banner. |
| `futureMinorValue` | Zero as a duplicate. |
| `requiredTestsGuards` | None for the retired copy. |
| `evidenceReason` | RETIRE justified positively: diff is a single comment line; the 4.21 twin preserves every parsing rule. |
| `forkDivergence` | 1 hunk, 1 line: header comment only. Zero functional difference. |

#### G1.17 `local-docs/ocp-4.20/scripts/parse-parameter-tables.js`

| Field | Value |
|---|---|
| `path` | local-docs/ocp-4.20/scripts/parse-parameter-tables.js |
| `purpose` | First-iteration PDF parameter-table parser using a line-oriented state machine with indentation-derived nesting. |
| `originalRole` | 4.20 Phase 2.1 iteration 1. |
| `inputs` | argv[2] = extracted PDF text file |
| `outputs` | stdout JSON |
| `hardcodedVersionAssumptions` | One header comment line naming the minor (line 3). |
| `currentStatus` | Known defective. WEB_EXTRACTION_PLAN.md records a 91% path-building error rate (283 of 311 paths malformed) for this approach, and PHASE_2_1_COMPLETION.md labels iteration 1 'FAILED'. consolidate-all-params.js carries a dedicated quarantine branch for its malformed output ('Table parser path-building logic needs refinement'). Not executed. |
| `disposition` | RETIRE |
| `action422` | None. |
| `futureMinorValue` | Negative. Re-adopting a parser with a measured 91% error rate would poison the extraction corpus. |
| `requiredTestsGuards` | None for the retired copy. extract-table-params.sh's successor must be re-pointed at parse-ocp-param-tables.js and must not discard stderr. |
| `evidenceReason` | RETIRE justified positively with TWO named replacements: (a) extract-from-html.js, which WEB_EXTRACTION_PLAN.md adopted specifically to replace PDF table parsing and which is promoted as-is; and (b) parse-ocp-param-tables.js, the revised purpose-built PDF parser, also promoted. Both are retained, so no capability is lost — only the measured-91%-wrong implementation is dropped. |
| `forkDivergence` | 1 hunk, 1 line: header comment only. |

#### G1.18 `local-docs/ocp-4.20/scripts/validate-findings.js`

| Field | Value |
|---|---|
| `path` | local-docs/ocp-4.20/scripts/validate-findings.js |
| `purpose` | A one-shot investigative transcript, not a reusable tool. Prints a hand-chosen set of diagnostics about imageContentSources/imageDigestSources union semantics, four suspect required-flag fields and five suspect type fields for the single scenario bare-metal-ipi, then writes a small findings file and prints recommendations for how a corrected analysis should categorise requiredness. |
| `originalRole` | 4.20 Phase 3 — the investigation that produced the design of corrected-analysis.js. |
| `inputs` | ../analysis/installer-source-params.json, ../analysis/agent-config-params.json, data/params/4.20/bare-metal-ipi.json |
| `outputs` | ../analysis/validation-issues.json, extensive stdout |
| `hardcodedVersionAssumptions` | PARAMS_DIR = <root>/data/params/4.20 (line 25); EXAMPLE_SCENARIO pinned to 'bare-metal-ipi' (line 51); hardcoded field name lists (lines 132-137, 161-167, 193-200). |
| `currentStatus` | Not run (writes validation-issues.json). Inspection shows it also reads sourceEntry.rawFieldDefinition and sourceEntry.structName, neither of which parse-go-structs.js ever emits (it emits struct, not structName, and no rawFieldDefinition), so VALIDATION 4 prints nothing and the struct field prints undefined. Partially broken by field-contract drift — the same class of defect as finding F1. |
| `disposition` | RETIRE |
| `action422` | None. |
| `futureMinorValue` | Low as code; high as a written record of WHY the filtering rules exist. |
| `requiredTestsGuards` | None. Its conclusions become the per-rule unit tests listed against corrected-analysis.js. |
| `evidenceReason` | RETIRE justified positively: its entire output is a set of recommendations ('RE-CATEGORIZE required discrepancies: CONDITIONAL_REQUIRED / UNION_REQUIRED / CONTEXT_REQUIRED / TRULY_REQUIRED') that were implemented in corrected-analysis.js, which is promoted. The capability is therefore already embodied in a retained artifact, and the script itself is a frozen single-scenario diagnostic with two dead field references. |
| `forkDivergence` | 1 hunk, 1 line: PARAMS_DIR minor literal only. |

---

## G2 — 4.21 audit/extraction toolkit

**Root:** `local-docs/ocp-4.21/scripts/` · **Plan count:** 20 · **Actual:** 20 · ✅ matches

> The 18 forked twins plus analyze-catalog-gaps.js and compare-raw-extractions.js. Every twin was diffed against its 4.20 counterpart; the divergence is recorded per row and is in every case confined to minor literals.

| # | path | disposition | currentStatus (summary) |
|---:|---|---|---|
| 1 | `local-docs/ocp-4.21/scripts/analyze-by-scenario.js` | **PARAMETERIZE** | Not run (writes two files into read-only historical evidence). Neither scenario-breakdown.json nor SCENARIO_BREAKDOWN.md exists under ocp-4.21/analysi… |
| 2 | `local-docs/ocp-4.21/scripts/analyze-catalog-gaps.js` | **REPLACE** | BROKEN AS OF TODAY, PROVEN. Line 21-22 reads frontend/src/data/catalogs and filters f.endsWith('.json'); that directory now contains only the subdirec… |
| 3 | `local-docs/ocp-4.21/scripts/compare-raw-extractions.js` | **PARAMETERIZE** | Works, with a proven latent defect. It is the single fully version-generic script in the entire toolkit: pure CLI arguments, no repo-path assumptions.… |
| 4 | `local-docs/ocp-4.21/scripts/compare-source-vs-catalogs.js` | **PARAMETERIZE** | Not run. source-catalog-comparison.json is absent from ocp-4.21/analysis (it is present under ocp-4.20/analysis), so on the evidence this step was not… |
| 5 | `local-docs/ocp-4.21/scripts/consolidate-all-params.js` | **PARAMETERIZE** | Not run. parameter-inventory-complete.json is absent from ocp-4.21/analysis, so the documentation-extraction branch of the pipeline was not completed … |
| 6 | `local-docs/ocp-4.21/scripts/consolidate-params.js` | **RETIRE** | Latently broken, same defect as the 4.20 copy: the endsWith('-params.json') filter also matches '*-table-params.json', after which data.yamlExamples.l… |
| 7 | `local-docs/ocp-4.21/scripts/corrected-analysis.js` | **PARAMETERIZE** | Not run (writes corrected-analysis.json). Output absent from ocp-4.21/analysis, so the filter stage was not executed for 4.21. The rules themselves ar… |
| 8 | `local-docs/ocp-4.21/scripts/download-docs.sh` | **PARAMETERIZE** | Partially defective, confirmed by its own acquisition record. ASSET_MANIFEST.md §3 records 11 of 12 PDFs acquired with the vSphere entry returning 404… |
| 9 | `local-docs/ocp-4.21/scripts/extract-all-params.sh` | **PARAMETERIZE** | Not run; no *-params.json documentation extractions exist under ocp-4.21/analysis. Its input directory ../docs/extracted must be produced by pdftotext… |
| 10 | `local-docs/ocp-4.21/scripts/extract-from-html.js` | **REUSE AS-IS** | Not run (no HTML input present in either workspace; no HTML-derived extractions exist under ocp-4.21/analysis, so this route appears never to have bee… |
| 11 | `local-docs/ocp-4.21/scripts/extract-oc-mirror-params-manual.js` | **REPLACE** | Runnable but provenance-false. The sed fork rewrote the two provenance strings from 4.20 to 4.21 while leaving all 56 parameter entries untouched, so … |
| 12 | `local-docs/ocp-4.21/scripts/extract-table-params.sh` | **PARAMETERIZE** | Not run; no *-table-params.json exist under ocp-4.21/analysis. Inspection shows two problems independent of versioning: it invokes parse-parameter-tab… |
| 13 | `local-docs/ocp-4.21/scripts/normalize-and-compare.js` | **PARAMETERIZE** | Not run; normalized-comparison.json is absent from ocp-4.21/analysis — which also means analyze-by-scenario.js could not have run for 4.21, since that… |
| 14 | `local-docs/ocp-4.21/scripts/parse-agent-config-structs.js` | **PARAMETERIZE** | WORKS — the strongest positive evidence in the toolkit. logs/parse-agent-config-structs.stderr.log records 13 Go files, 8 structs, 25 parameter paths,… |
| 15 | `local-docs/ocp-4.21/scripts/parse-go-structs.js` | **PARAMETERIZE** | WORKS. logs/parse-go-structs.stderr.log records 150 Go files, 141 structs, 525 parameter paths, zero warnings; the 489 KB output is present and is the… |
| 16 | `local-docs/ocp-4.21/scripts/parse-imageset-params.js` | **RETIRE** | UNRUNNABLE as forked. Its required input ../analysis/imageset-config-params-raw.txt does not exist under ocp-4.21/analysis (it exists only under ocp-4… |
| 17 | `local-docs/ocp-4.21/scripts/parse-ocp-param-tables.js` | **REUSE AS-IS** | Not run (no extracted text available). By inspection: side-effect free, version-clean, and the better of the two PDF table parsers. Note it detects ta… |
| 18 | `local-docs/ocp-4.21/scripts/parse-parameters.js` | **PARAMETERIZE** | Not run (no extracted text present for 4.21). PHASE_2_1_COMPLETION.md records it as the successful parser iteration with two acknowledged weaknesses: … |
| 19 | `local-docs/ocp-4.21/scripts/parse-parameter-tables.js` | **RETIRE** | Known defective, carried forward unexamined. WEB_EXTRACTION_PLAN.md records a 91% path-building error rate (283 of 311 malformed) and PHASE_2_1_COMPLE… |
| 20 | `local-docs/ocp-4.21/scripts/validate-findings.js` | **RETIRE** | Partially broken and not run. It reads sourceEntry.rawFieldDefinition and sourceEntry.structName; parse-go-structs.js emits neither (it emits struct, … |

#### G2.1 `local-docs/ocp-4.21/scripts/analyze-by-scenario.js`

| Field | Value |
|---|---|
| `path` | local-docs/ocp-4.21/scripts/analyze-by-scenario.js |
| `purpose` | Per-scenario coverage breakdown (catalog vs applicable source params, present/missing/catalog-only, metadata discrepancies, coverage %) emitting JSON plus a rendered markdown report. |
| `originalRole` | 4.21 re-run of the 4.20 Phase 3 reporting step. |
| `inputs` | ../analysis/normalized-comparison.json, ../analysis/installer-source-params.json, ../analysis/agent-config-params.json, data/params/4.21/<scenario>.json |
| `outputs` | ../analysis/scenario-breakdown.json, ../analysis/SCENARIO_BREAKDOWN.md |
| `hardcodedVersionAssumptions` | PARAMS_DIR = <root>/data/params/4.21 (line 22); hardcoded 12-element SCENARIOS array (lines 37-50) which omits oc-mirror-v2 and cannot see a new scenario. |
| `currentStatus` | Not run (writes two files into read-only historical evidence). Neither scenario-breakdown.json nor SCENARIO_BREAKDOWN.md exists under ocp-4.21/analysis, so on the evidence this script was never actually executed for 4.21 — unlike its 4.20 counterpart, whose outputs are present. |
| `disposition` | PARAMETERIZE |
| `action422` | Promote to scripts/minor/analyze-by-scenario.js taking --minor and --workspace; replace the literal SCENARIOS array with discovery from data/params/<minor>/ so oc-mirror-v2 and any future scenario are included automatically. |
| `futureMinorValue` | High. Per-scenario coverage is the report a human reads to decide where catalog work is needed; it must work for 4.22, 4.23 and beyond with no edit. |
| `requiredTestsGuards` | Fixture test asserting scenario discovery comes from the catalog directory, not a literal list (regression for the omitted oc-mirror-v2); test asserting --minor selects the right catalog directory and refuses an unsupported minor. |
| `evidenceReason` | PARAMETERIZE rather than REUSE because the minor and the scenario set are both literals; PARAMETERIZE rather than REPLACE because the comparison and reporting logic is sound and byte-identical to the 4.20 copy that did produce usable output. |
| `forkDivergence` | vs 4.20: 1 line (PARAMS_DIR). No logic divergence. |

#### G2.2 `local-docs/ocp-4.21/scripts/analyze-catalog-gaps.js`

| Field | Value |
|---|---|
| `path` | local-docs/ocp-4.21/scripts/analyze-catalog-gaps.js |
| `purpose` | Classifies each parameter in the installer delta against the app's supported platform/scenario set, assigning platform, supportBoundary, recommendedAction, recommendedMinVersion, P0-P3 priority and the UI/generation/validation change flags. |
| `originalRole` | 4.21 DOC-102 Slice 4 — the bridge from raw installer delta to catalog-work planning. This is the only script in the toolkit that encodes the app's product support boundary. |
| `inputs` | ../analysis/delta-installer-params.json; every *.json directly inside frontend/src/data/catalogs/ |
| `outputs` | ../analysis/catalog-gap-analysis.json |
| `hardcodedVersionAssumptions` | recommendedMinVersion hardcoded to '4.21' in four branches (lines 152, 176, 200, 224); classification literal 'added_in_4_21' inherited from the delta; supportedPlatforms and unsupportedPlatforms maps hardcoded (lines 43-59). |
| `currentStatus` | BROKEN AS OF TODAY, PROVEN. Line 21-22 reads frontend/src/data/catalogs and filters f.endsWith('.json'); that directory now contains only the subdirectories 4.20/ and 4.21/, so the filter yields zero files, allCurrentPaths is empty, and every parameter is classified 'not in catalog'. It also inverts authority by reading the frontend mirror instead of canonical data/params/. NOT executed. Separately: its recorded output has evidence 'Source: unknown' for all 49 rows, a downstream symptom of finding F1. Honest limit: it was NOT necessarily broken when it ran — commits e65e6ee and a45b20e migrated the frontend to versioned subdirectories on 2026-06-29, the same day this script was created, and the flat layout documented in DOC-102-SLICE-4B-RECONCILIATION.md was still present at Slice 4. Whether the run predated the migration is unresolved; the current breakage is not. |
| `disposition` | REPLACE |
| `action422` | Replace with scripts/minor/classify-delta.js that (a) reads canonical data/params/<minor>/ not the frontend mirror, (b) takes the target minor as an argument instead of hardcoding it into recommendedMinVersion, (c) sources the supported platform/scenario set from one shared constant rather than a private literal map, and (d) emits unknown-platform rows as an explicit stop-and-report per R6 rather than a P2 default. |
| `futureMinorValue` | The CAPABILITY is essential for every future minor — it is the only automated step that connects upstream deltas to product scope. The IMPLEMENTATION is not reusable. |
| `requiredTestsGuards` | Test asserting the canonical catalog directory is read and that a non-empty catalog set is loaded (fails loudly on zero files rather than mis-classifying); test asserting an unrecognised platform yields a stop-and-report, not a silent P2; test asserting the recommended minVersion equals the --minor argument. |
| `evidenceReason` | REPLACE, not PARAMETERIZE: fixing the directory path alone would leave three further defects (authority inversion to the frontend mirror, hardcoded platform policy duplicated from production code, and silent zero-catalog failure). Positive replacement named above. REPLACE, not RETIRE: the classification capability must survive. |
| `forkDivergence` | No 4.20 counterpart — introduced for 4.21. |

#### G2.3 `local-docs/ocp-4.21/scripts/compare-raw-extractions.js`

| Field | Value |
|---|---|
| `path` | local-docs/ocp-4.21/scripts/compare-raw-extractions.js |
| `purpose` | Generic A/B parameter-set delta: loads two extraction JSONs, keys by parameter path, and classifies added / removed / changed (type, requiredness, comment) / unchanged, flagging type or requiredness changes for manual review. |
| `originalRole` | 4.21 DOC-102 Slice 3 — produced delta-installer-params.json (49 added, 1 removed) and delta-agent-config-params.json (0 changes). |
| `inputs` | --baseline <file> --target <file> [--output <file>] |
| `outputs` | the --output file, or stdout |
| `hardcodedVersionAssumptions` | NONE in the code. The only minor-bearing strings are the two usage examples in the --help text (lines 38-40) and the classification labels 'added_in_4_21' / 'removed_in_4_21' (lines 86, 153), which are emitted into the data. |
| `currentStatus` | Works, with a proven latent defect. It is the single fully version-generic script in the entire toolkit: pure CLI arguments, no repo-path assumptions. DEFECT (finding F1): it reads targetParam.comment, .jsonTag and .file, but parse-go-structs.js emits description, and no jsonTag or file field at all. Verified against the real output: in delta-installer-params.json, 0 of 49 added rows carry file and 0 carry comment, and changed is 0. Because comment is undefined on both sides, commentChanged can never be true, so 'changed_description' detection is structurally dead. Not executed here (would write into read-only evidence). |
| `disposition` | PARAMETERIZE |
| `action422` | Promote to scripts/minor/diff-params.js. No version parameterization is needed for the comparison itself; what must change is (a) the hardcoded added_in_<minor> / removed_in_<minor> labels become derived from the two inputs, and (b) the producer/consumer field contract is fixed so description changes are actually detected. |
| `futureMinorValue` | Very high, and it is the correct architectural model for the whole scripts/minor/** family: baseline and target supplied as arguments, nothing about any minor baked in. |
| `requiredTestsGuards` | A contract test asserting every field compare-raw-extractions reads is a field parse-go-structs writes (this is the guard that would have caught F1); a fixture test with a changed doc comment asserting classification 'changed_description' is produced; a fixture test asserting type and requiredness changes land in needsManualReview. |
| `evidenceReason` | Not REUSE AS-IS despite being version-generic, because it carries a proven defect that silently suppressed an entire change class during the 4.21 delta. Not REPLACE, because the structure is right and the fix is narrow. |
| `forkDivergence` | No 4.20 counterpart — introduced for 4.21. |

#### G2.4 `local-docs/ocp-4.21/scripts/compare-source-vs-catalogs.js`

| Field | Value |
|---|---|
| `path` | local-docs/ocp-4.21/scripts/compare-source-vs-catalogs.js |
| `purpose` | Raw unfiltered source-vs-catalog comparison producing inBoth / onlyInSource / onlyInCatalog plus raw metadata discrepancies, each annotated with a possibleReasons hint list. |
| `originalRole` | 4.21 re-run of 4.20 Phase 3.1. |
| `inputs` | ../analysis/installer-source-params.json, ../analysis/agent-config-params.json, data/params/4.21/*.json |
| `outputs` | ../analysis/source-catalog-comparison.json |
| `hardcodedVersionAssumptions` | CATALOG_DIR = ../../../data/params/4.21 (line 14). |
| `currentStatus` | Not run. source-catalog-comparison.json is absent from ocp-4.21/analysis (it is present under ocp-4.20/analysis), so on the evidence this step was not executed for 4.21 — consistent with the 4.21 effort pivoting to the delta-based route (compare-raw-extractions.js) instead of the full comparison route. |
| `disposition` | PARAMETERIZE |
| `action422` | Promote to scripts/minor/compare-source-vs-catalogs.js with --minor and --workspace. |
| `futureMinorValue` | Moderate. The delta route is cheaper per minor, but the full comparison is what catches drift that a delta cannot see (a parameter missing from the catalog since 4.20 never appears in a 4.21->4.22 delta). 0B's 741 schema errors are precisely that class. |
| `requiredTestsGuards` | Fixture test asserting the catalog directory is derived from --minor; test asserting an empty catalog directory is a hard error, not an empty comparison. |
| `evidenceReason` | PARAMETERIZE: single minor literal, sound directory-driven logic, and a capability (full drift detection) not covered by the delta route. |
| `forkDivergence` | vs 4.20: 1 line (CATALOG_DIR). No logic divergence. |

#### G2.5 `local-docs/ocp-4.21/scripts/consolidate-all-params.js`

| Field | Value |
|---|---|
| `path` | local-docs/ocp-4.21/scripts/consolidate-all-params.js |
| `purpose` | Merges YAML-example and table extractions into a single keyed inventory with per-parameter occurrences, extraction methods, type set and requiredInAnyDoc, quarantining malformed table-derived paths into extractionIssues. |
| `originalRole` | 4.21 fork of the 4.20 Phase 2.1 consolidator. |
| `inputs` | ../analysis/*-params.json, ../analysis/*-table-params.json |
| `outputs` | ../analysis/parameter-inventory-complete.json |
| `hardcodedVersionAssumptions` | None. Byte-identical to the 4.20 copy; only the ../analysis fork-layout assumption. |
| `currentStatus` | Not run. parameter-inventory-complete.json is absent from ocp-4.21/analysis, so the documentation-extraction branch of the pipeline was not completed for 4.21 — consistent with ASSET_MANIFEST.md, which records only the two Go-struct extractions as complete. |
| `disposition` | PARAMETERIZE |
| `action422` | Promote to scripts/minor/consolidate-doc-params.js with an explicit --workspace argument replacing the implicit ../analysis sibling. |
| `futureMinorValue` | High if documentation extraction is re-enabled for 4.22; its malformed-path quarantine is the mechanism that keeps a bad parser from silently poisoning the inventory. |
| `requiredTestsGuards` | Fixture test with one *-params.json and one *-table-params.json asserting both are consolidated and that a malformed path ('.foo' or 'a..b') lands in extractionIssues rather than parameters. |
| `evidenceReason` | PARAMETERIZE rather than REUSE AS-IS: the file contains no version literal, but it hardcodes the per-minor fork directory layout (../analysis), which is exactly the assumption the un-forked scripts/minor/** home removes. |
| `forkDivergence` | Byte-identical to the 4.20 copy. |

#### G2.6 `local-docs/ocp-4.21/scripts/consolidate-params.js`

| Field | Value |
|---|---|
| `path` | local-docs/ocp-4.21/scripts/consolidate-params.js |
| `purpose` | Earlier narrower consolidator over *-params.json only, assuming a yamlExamples array on every input. |
| `originalRole` | 4.21 fork of a 4.20 artifact that had already been superseded within the 4.20 effort. |
| `inputs` | ../analysis/*-params.json |
| `outputs` | ../analysis/parameter-inventory.json |
| `hardcodedVersionAssumptions` | None; byte-identical to the 4.20 copy. |
| `currentStatus` | Latently broken, same defect as the 4.20 copy: the endsWith('-params.json') filter also matches '*-table-params.json', after which data.yamlExamples.length throws. Not run; its output is absent from ocp-4.21/analysis. |
| `disposition` | RETIRE |
| `action422` | None. |
| `futureMinorValue` | Negative. |
| `requiredTestsGuards` | None; the mixed-input regression test is recorded against consolidate-all-params.js. |
| `evidenceReason` | RETIRE justified positively: consolidate-all-params.js (promoted in this same group) is a strict functional superset — it consumes both extraction families, correctly excludes table files from the YAML branch, and adds malformed-path quarantine. Retiring this file removes a crash path while losing no capability. It is also evidence of the fork mechanism's cost: a script already dead at 4.20 was copied forward unexamined because sed does not read. |
| `forkDivergence` | Byte-identical to the 4.20 copy. |

#### G2.7 `local-docs/ocp-4.21/scripts/corrected-analysis.js`

| Field | Value |
|---|---|
| `path` | local-docs/ocp-4.21/scripts/corrected-analysis.js |
| `purpose` | The false-positive filter that converts a raw comparison into an actionable finding set, suppressing conditional-requiredness, Go-type-representation, external-enum and platform-applicability artefacts. |
| `originalRole` | 4.21 fork of the 4.20 Phase 3 filter — the artifact that embodies the 67% false-positive lesson. |
| `inputs` | ../analysis/installer-source-params.json, ../analysis/agent-config-params.json, data/params/4.21/<scenario>.json |
| `outputs` | ../analysis/corrected-analysis.json |
| `hardcodedVersionAssumptions` | PARAMS_DIR = <root>/data/params/4.21 (line 25); hardcoded 12-element SCENARIOS array (lines 30-43). |
| `currentStatus` | Not run (writes corrected-analysis.json). Output absent from ocp-4.21/analysis, so the filter stage was not executed for 4.21. The rules themselves are intact and readable. |
| `disposition` | PARAMETERIZE |
| `action422` | Promote to scripts/minor/corrected-analysis.js with --minor and catalog-directory-driven scenario discovery. EVERY suppression rule must be carried forward verbatim and individually test-covered; none may be 'cleaned up' during the move. |
| `futureMinorValue` | The highest of any artifact in the harvest. Without these rules a 4.22 comparison produces roughly 340 spurious findings for every 162 real ones, which is how a reviewer ends up either drowning or rubber-stamping. |
| `requiredTestsGuards` | One unit test per suppression rule, each with a positive fixture (artefact suppressed) and a negative fixture (genuine discrepancy NOT suppressed): the eight nestedRequiredPatterns regexes; controlPlane/compute .platform context-dependence; deep-nested (>2) array-indexed paths; ipnet.IPNet-as-string; configv1.*-as-string; baselineCapabilitySet/featureSet enum-as-string; controlPlane object-vs-array notation; cross-platform applicability via platformMap; agent-config-only-for-agent-scenarios; Deprecated-field skip; orphan-nested skip when the parent is absent from the catalog. |
| `evidenceReason` | PARAMETERIZE: only the minor literal and the scenario list are version-bound; the entire rule set is sound, byte-identical to the 4.20 copy that produced the validated 4.20 result, and is the specific knowledge Revision 3 §3.0 created this gate to protect. |
| `forkDivergence` | vs 4.20: 1 line (PARAMS_DIR). All eight nestedRequiredPatterns, both type-false-positive branches, the platformMap and every threshold are identical. |
| `requiredDomainKnowledge` | Raw comparison false-positive rate at 4.20 was 67% (340 of 502). Expect the same order at 4.22. · Largest single source of false positives is platform applicability (AWS params counted missing from vSphere catalogs). · Catalogs may legitimately be MORE strict than Go structs (Agent scenarios require VIPs though the struct is optional) — a stricter catalog is not a defect. · Go type aliases serialize as primitives in YAML: AWSLBType/CloudEnvironment/ProvisioningNetwork/DiskType -> string, ipnet.IPNet -> string in CIDR notation. Catalogs describe YAML, not Go. · imageContentSources and imageDigestSources are mutually exclusive union members; their .source children are required only if the parent array is present. |
| `disposition_note` | PARAMETERIZE, explicitly NOT REPLACE. Revision 3 §3.0 names the failure mode of rewriting this from scratch; the rules are hard-won and must move verbatim. |

#### G2.8 `local-docs/ocp-4.21/scripts/download-docs.sh`

| Field | Value |
|---|---|
| `path` | local-docs/ocp-4.21/scripts/download-docs.sh |
| `purpose` | Downloads the 12 Red Hat OCP installation PDFs for the minor into ../docs/pdf with per-file status and a nonzero exit if any failed. |
| `originalRole` | 4.21 Slice 1 documentation acquisition. |
| `inputs` | network (docs.redhat.com PDF endpoints) |
| `outputs` | ../docs/pdf/*.pdf |
| `hardcodedVersionAssumptions` | BASE_URL (line 9), all 12 PDF path+filename entries (lines 18-29), 2 banner strings (lines 2, 33). |
| `currentStatus` | Partially defective, confirmed by its own acquisition record. ASSET_MANIFEST.md §3 records 11 of 12 PDFs acquired with the vSphere entry returning 404; §10 (Slice 5F.1) records the root cause as the wrong filename — the script asks for 'Installing_on_vSphere' but the real asset is 'Installing_on_VMware_vSphere' — and records the PDF being fetched manually afterwards. The script was never corrected: line 24 still contains the 404-producing filename. Not executed (network acquisition, forbidden in 0A-0). |
| `disposition` | PARAMETERIZE |
| `action422` | Promote to scripts/minor/fetch-docs.sh taking --minor, deriving every URL from a single minor variable, AND correcting the vSphere filename. Record each download's SHA256 so the ASSET_MANIFEST generator (GAP-03) can consume it. |
| `futureMinorValue` | High — first step of every future minor's acquisition, and the place where an uncorrected filename costs a human a debugging session every single time. |
| `requiredTestsGuards` | A URL-construction unit test (no network) asserting all 12 URLs for a given minor, with an explicit assertion that the vSphere URL contains 'Installing_on_VMware_vSphere'. This is the regression guard for a defect that has already cost one cycle. |
| `evidenceReason` | PARAMETERIZE rather than REUSE: every URL embeds the minor. The vSphere correction is folded in here because leaving a diagnosed, documented, uncorrected defect in a promoted script would reproduce it at 4.22 — exactly the archaeology this harvest exists to prevent. |
| `forkDivergence` | vs 4.20: 3 hunks, all minor-literal (BASE_URL, 12 docs entries, 2 banners). The vSphere filename defect is identical in both copies, i.e. the sed fork propagated it unchanged. |

#### G2.9 `local-docs/ocp-4.21/scripts/extract-all-params.sh`

| Field | Value |
|---|---|
| `path` | local-docs/ocp-4.21/scripts/extract-all-params.sh |
| `purpose` | Runs parse-parameters.js over every extracted text file and reports per-document and total parameter/YAML-example counts. |
| `originalRole` | 4.21 fork of the 4.20 Phase 2.1 extraction driver. |
| `inputs` | ../docs/extracted/*.txt, parse-parameters.js, jq |
| `outputs` | ../analysis/<doc>-params.json |
| `hardcodedVersionAssumptions` | 2 banner strings only (lines 2, 10). |
| `currentStatus` | Not run; no *-params.json documentation extractions exist under ocp-4.21/analysis. Its input directory ../docs/extracted must be produced by pdftotext, which no script in the toolkit performs (GAP-01). |
| `disposition` | PARAMETERIZE |
| `action422` | Promote to scripts/minor/extract-doc-params.sh with --workspace, and chain it after the new pdftotext step from GAP-01. |
| `futureMinorValue` | Moderate — a thin orchestrator, but it is the step that makes documentation extraction a one-command operation instead of a 12-invocation manual loop. |
| `requiredTestsGuards` | Smoke test over a two-file synthetic text directory asserting one output per input and a nonzero exit when the parser fails (today a parse failure surfaces only as a low count). |
| `evidenceReason` | PARAMETERIZE: banners are the only version content, but the implicit ../analysis and ../docs/extracted siblings are fork-layout assumptions that must become explicit arguments. |
| `forkDivergence` | vs 4.20: 2 lines, banner strings only. |

#### G2.10 `local-docs/ocp-4.21/scripts/extract-from-html.js`

| Field | Value |
|---|---|
| `path` | local-docs/ocp-4.21/scripts/extract-from-html.js |
| `purpose` | Regex HTML table scraper producing {path, description, valueType, type, table} rows from any documentation HTML page containing a Parameter/Description table. |
| `originalRole` | 4.21 fork of the 4.20 artifact created by WEB_EXTRACTION_PLAN.md to replace PDF table parsing. |
| `inputs` | argv[2] = an HTML file |
| `outputs` | stdout JSON |
| `hardcodedVersionAssumptions` | None at all. No minor literal, no repo path, no workspace assumption; input by argument, output to stdout. |
| `currentStatus` | Not run (no HTML input present in either workspace; no HTML-derived extractions exist under ocp-4.21/analysis, so this route appears never to have been exercised for 4.21 despite being the documented preferred method). By inspection it is correct, side-effect free and genuinely generic. |
| `disposition` | REUSE AS-IS |
| `action422` | Promote verbatim to scripts/minor/extract-from-html.js. No code change required. Pair it with the HTML fetch step the gap list records as GAP-02. |
| `futureMinorValue` | High. WEB_EXTRACTION_PLAN.md records clean HTML table structure as the fix for the 91% PDF path-building error rate, and Revision 3 L4 records that 4.22 doc pages now return HTTP 200 (the 4.21-era 403s do not reproduce), so the HTML route is viable for 4.22 in a way it was not for 4.21. |
| `requiredTestsGuards` | Golden-fixture test over a small saved HTML table asserting extracted paths, types and the Parameter/Description table-detection heuristic. The fixture must be committed so the test stays network-hermetic (R4). |
| `evidenceReason` | REUSE AS-IS is defensible here and nowhere else in the toolkit: cmp proves byte identity with the 4.20 copy, the file contains no version string, no repo path and no workspace assumption, and it reads argv and writes stdout. It is the only extractor that needs literally zero change to serve 4.22. |
| `forkDivergence` | Byte-identical to the 4.20 copy. |

#### G2.11 `local-docs/ocp-4.21/scripts/extract-oc-mirror-params-manual.js`

| Field | Value |
|---|---|
| `path` | local-docs/ocp-4.21/scripts/extract-oc-mirror-params-manual.js |
| `purpose` | Emits a hardcoded, hand-transcribed array of ~56 ImageSetConfiguration parameters as JSON with a provenance header. Performs no extraction. |
| `originalRole` | 4.21 fork of the 4.20 Phase 2.4 fallback. |
| `inputs` | None — the parameter list is a source literal. |
| `outputs` | ../analysis/oc-mirror-v2-params.json |
| `hardcodedVersionAssumptions` | Two provenance strings naming 4.21 (lines 17, 88) plus the whole parameter payload. |
| `currentStatus` | Runnable but provenance-false. The sed fork rewrote the two provenance strings from 4.20 to 4.21 while leaving all 56 parameter entries untouched, so the file asserts 'Based on manual reading of Table 5.3 in OpenShift 4.21 Disconnected Environments PDF' and 'OpenShift 4.21 Disconnected Environments Documentation (manually extracted)' over content that was read only against 4.20. Its output is absent from ocp-4.21/analysis and ASSET_MANIFEST.md §8 records oc-mirror extraction as Deferred, so the false claim was never actually materialised — but the file would make it the moment it was run. Not executed. |
| `disposition` | REPLACE |
| `action422` | Do not port. O2 (Tranche 0B) gives ImageSetConfiguration a real canonical catalog per minor under data/params/<minor>/oc-mirror-v2.json with real imageset-config.yaml validation; Tranche 2 authors the 4.22 rows from authoritative 4.22 oc-mirror v2 documentation with 4.22 citations from birth. |
| `futureMinorValue` | The capability (a per-minor ImageSetConfiguration parameter inventory) is required. This mechanism must not survive: a code-embedded literal list with a sed-rewritten provenance header is a provenance-integrity hazard by construction. |
| `requiredTestsGuards` | On the replacement: the 0A-1 catalog-citation version guard applied to data/params/<minor>/oc-mirror-v2.json; the O2 non-vacuous validation tests that must fail on a deliberately invalid imageset-config.yaml; and a check that storageConfig.* is absent, since S4 confirms oc-mirror v2 has no storageConfig (this file still carries six deprecated storageConfig entries). |
| `evidenceReason` | REPLACE with a named positive replacement (O2 canonical catalog + Tranche 2 authoring). Not PARAMETERIZE, because parameterizing a hardcoded data payload is meaningless — the data itself is the version-specific part. Not RETIRE, because the capability is needed. This row is the single clearest demonstration of why a sed-based fork is unsafe: it rewrites claims without rewriting evidence. |
| `forkDivergence` | vs 4.20: 2 lines, both provenance strings. The 56-entry payload is byte-identical — the divergence IS the false claim. |

#### G2.12 `local-docs/ocp-4.21/scripts/extract-table-params.sh`

| Field | Value |
|---|---|
| `path` | local-docs/ocp-4.21/scripts/extract-table-params.sh |
| `purpose` | Runs parse-parameter-tables.js over every extracted text file, writing <doc>-table-params.json and printing table/parameter counts. |
| `originalRole` | 4.21 fork of the 4.20 table-extraction driver. |
| `inputs` | ../docs/extracted/*.txt, parse-parameter-tables.js, jq |
| `outputs` | ../analysis/<doc>-table-params.json |
| `hardcodedVersionAssumptions` | None; byte-identical to the 4.20 copy. |
| `currentStatus` | Not run; no *-table-params.json exist under ocp-4.21/analysis. Inspection shows two problems independent of versioning: it invokes parse-parameter-tables.js (the 91%-malformed iteration-1 parser) and it discards that parser's stderr with 2>/dev/null, so failures appear only as low counts. |
| `disposition` | PARAMETERIZE |
| `action422` | Promote to scripts/minor/extract-doc-tables.sh with --workspace, re-pointed at parse-ocp-param-tables.js, and with stderr preserved. |
| `futureMinorValue` | Moderate — useful as the PDF fallback when HTML extraction is unavailable; low priority if the HTML route is adopted for 4.22. |
| `requiredTestsGuards` | Smoke test asserting a parser failure produces a nonzero exit rather than an empty output file. |
| `evidenceReason` | PARAMETERIZE rather than REUSE AS-IS despite byte identity and the absence of any version literal, because it hardcodes the fork directory layout AND is wired to a parser being retired. Both must change for it to be usable from an un-forked home. |
| `forkDivergence` | Byte-identical to the 4.20 copy. |

#### G2.13 `local-docs/ocp-4.21/scripts/normalize-and-compare.js`

| Field | Value |
|---|---|
| `path` | local-docs/ocp-4.21/scripts/normalize-and-compare.js |
| `purpose` | Normalizes array notation across source and catalog paths, builds bidirectional variant maps, and re-runs the comparison on normalized keys, categorising catalog-only parameters into system fields, arbiter topology and probable oc-mirror fields. |
| `originalRole` | 4.21 fork of the 4.20 Phase 3.1 path-normalization step. |
| `inputs` | ../analysis/installer-source-params.json, ../analysis/agent-config-params.json, data/params/4.21/*.json |
| `outputs` | ../analysis/normalized-comparison.json |
| `hardcodedVersionAssumptions` | CATALOG_DIR = ../../../data/params/4.21 (line 14); frozen 4.20 statistic 'Before: 72 matches (15% overlap)' printed unconditionally (line 299). |
| `currentStatus` | Not run; normalized-comparison.json is absent from ocp-4.21/analysis — which also means analyze-by-scenario.js could not have run for 4.21, since that file is its first required input. Consistent chain of non-execution. |
| `disposition` | PARAMETERIZE |
| `action422` | Promote to scripts/minor/normalize-and-compare.js with --minor and --workspace; replace the frozen 'Before: 72' line with a computed or omitted value. |
| `futureMinorValue` | High. Array-notation mismatch was the single largest comparison artefact at 4.20 (15% -> much higher match rate); without normalization a 4.22 comparison is dominated by notation noise. |
| `requiredTestsGuards` | Unit tests for normalizePath and getPathVariants covering compute[].name, networking.clusterNetwork[].cidr and multi-segment arrays; a guard that no hardcoded historical statistic is printed as if current. |
| `evidenceReason` | PARAMETERIZE: one minor literal plus one stale hardcoded statistic; the normalization algorithm itself is sound and byte-identical to the validated 4.20 copy. |
| `forkDivergence` | vs 4.20: 1 line (CATALOG_DIR). The frozen 'Before: 72' 4.20 statistic was copied into the 4.21 script unchanged — a second, subtler instance of the sed fork propagating a stale claim. |

#### G2.14 `local-docs/ocp-4.21/scripts/parse-agent-config-structs.js`

| Field | Value |
|---|---|
| `path` | local-docs/ocp-4.21/scripts/parse-agent-config-structs.js |
| `purpose` | Extracts agent-config.yaml parameters by parsing Go structs under pkg/types/agent and pkg/types/baremetal, recursing from agent.Config, with primitive-type guards to avoid descending into *bool/*int and skipping TypeMeta/ObjectMeta. |
| `originalRole` | 4.21 Slice 2 agent-config extraction. |
| `inputs` | ../installer/source/installer/pkg/types/{agent,baremetal}/**/*.go at pinned commit 1accb6487cf3784561665c08048dde20ad672c39 |
| `outputs` | ../analysis/agent-config-params.json (33 KB, 25 parameters, 8 structs) |
| `hardcodedVersionAssumptions` | One provenance string: 'github.com/openshift/installer release-4.21 (agent-config)' (line 20). |
| `currentStatus` | WORKS — the strongest positive evidence in the toolkit. logs/parse-agent-config-structs.stderr.log records 13 Go files, 8 structs, 25 parameter paths, zero warnings, and the 33 KB output is present. Not re-executed here (requires the installer clone and would rewrite evidence). |
| `disposition` | PARAMETERIZE |
| `action422` | Promote to scripts/minor/parse-agent-config-structs.js taking --minor and --installer-root, with the provenance string derived from the actual resolved branch and commit rather than a literal. |
| `futureMinorValue` | High and recurring. 2.D records agent/agentconfig_types.go as showing no tag change at 4.22, so this is also the cheapest way to confirm that negative result independently. |
| `requiredTestsGuards` | Golden-fixture test over a synthetic Go tree covering embedded fields, pointer-to-primitive (must not recurse), package-qualified types and kubebuilder enum/default tags; and a provenance assertion that the emitted source string contains the resolved commit SHA, not just a branch name. |
| `evidenceReason` | PARAMETERIZE: the only version-bound content is a provenance string, and the extraction itself is proven to work at 4.21. Deriving provenance from the real clone instead of a literal is what prevents the extract-oc-mirror-params-manual.js failure mode recurring here. |
| `forkDivergence` | vs 4.20: 1 line (provenance string). No logic divergence. |

#### G2.15 `local-docs/ocp-4.21/scripts/parse-go-structs.js`

| Field | Value |
|---|---|
| `path` | local-docs/ocp-4.21/scripts/parse-go-structs.js |
| `purpose` | Primary install-config extractor: parses every non-test Go file under pkg/types, builds a struct registry, recurses from types.InstallConfig with a visited-set cycle guard, and emits parameter paths with Go type, mapped type, requiredness from omitempty, kubebuilder default and enum, and the preceding doc comment as description. |
| `originalRole` | 4.21 Slice 2 install-config extraction — the authoritative-source backbone of the whole audit. |
| `inputs` | ../installer/source/installer/pkg/types/**/*.go at pinned commit 1accb6487cf3784561665c08048dde20ad672c39 |
| `outputs` | ../analysis/installer-source-params.json (489 KB, 525 parameters, 141 structs) |
| `hardcodedVersionAssumptions` | One provenance string: 'github.com/openshift/installer release-4.21' (line 20). |
| `currentStatus` | WORKS. logs/parse-go-structs.stderr.log records 150 Go files, 141 structs, 525 parameter paths, zero warnings; the 489 KB output is present and is the baseline input for the 4.21->4.22 delta. Known limitations carried from 4.20 and never fixed: incomplete deep-nested struct traversal, no conditional-requiredness detection, no runtime defaulting from pkg/asset/installconfig (Revision 3 2.D lists all three as OPEN for Tranche 1). Field-contract defect F1 originates here: it emits description/struct but its own downstream comparator reads comment/jsonTag/file. Not re-executed. |
| `disposition` | PARAMETERIZE |
| `action422` | Promote to scripts/minor/parse-go-structs.js taking --minor and --installer-root; derive provenance from the resolved branch and commit; align the emitted field names with what diff-params.js reads (fix F1 at the producer end, or at the consumer end, but prove the contract with a test). |
| `futureMinorValue` | Highest of the extractors. Every future minor's delta begins here, and its output is the baseline the next minor diffs against. |
| `requiredTestsGuards` | Golden-fixture test over a synthetic Go tree (embedded fields, pointer structs, slices of structs, cyclic references, kubebuilder tags); a producer/consumer field-contract test shared with diff-params.js; and an explicit assertion that the recorded provenance contains the resolved commit SHA. |
| `evidenceReason` | PARAMETERIZE: one provenance literal, proven working at both 4.20 and 4.21, and byte-identical logic across the fork. The documented limitations are scope for Tranche 1 research, not reasons to replace a working extractor. |
| `forkDivergence` | vs 4.20: 1 line (provenance string). No logic divergence. |

#### G2.16 `local-docs/ocp-4.21/scripts/parse-imageset-params.js`

| Field | Value |
|---|---|
| `path` | local-docs/ocp-4.21/scripts/parse-imageset-params.js |
| `purpose` | Parses a hand-prepared raw text dump of the ImageSetConfiguration parameter table into structured JSON, inferring type from leading type keywords and required/default from description wording. |
| `originalRole` | 4.21 fork of the 4.20 intended oc-mirror extractor. |
| `inputs` | ../analysis/imageset-config-params-raw.txt |
| `outputs` | ../analysis/oc-mirror-v2-params.json |
| `hardcodedVersionAssumptions` | One provenance string (line 22); plus hardcoded Red Hat table numbering 'Table 5.4. DeleteImageSetConfiguration parameters' used as a parse boundary (lines 41, 65). |
| `currentStatus` | UNRUNNABLE as forked. Its required input ../analysis/imageset-config-params-raw.txt does not exist under ocp-4.21/analysis (it exists only under ocp-4.20/analysis), so the script would throw ENOENT immediately. ASSET_MANIFEST.md §8 independently records oc-mirror extraction as Deferred for 4.21, and L18 records that 4.21 consequently has no oc-mirror catalog at all. Not executed. |
| `disposition` | RETIRE |
| `action422` | None as a script. |
| `futureMinorValue` | Low and actively risky: hardcoding 'Table 5.4' as a parse boundary is unsafe given Revision 3 §1.2's finding that Red Hat renumbers chapters and tables between minors (oc-mirror v2 moved from Chapter 7 at 4.20 to Chapter 5 at 4.22). |
| `requiredTestsGuards` | None for the retired script; the replacement's guards are the O2 catalog and validation tests. |
| `evidenceReason` | RETIRE justified positively with a named replacement: O2 (Tranche 0B) gives ImageSetConfiguration a real canonical per-minor catalog and real imageset-config.yaml validation, sourced from authoritative oc-mirror v2 documentation. That is a strictly stronger mechanism than a text parser that (a) depends on a manually produced input which was never produced for 4.21, and (b) anchors on table numbers that demonstrably move between minors. The deferral this script caused is precisely the debt O2 exists to clear. |
| `forkDivergence` | vs 4.20: 1 line (provenance string). Table-number literals identical. |

#### G2.17 `local-docs/ocp-4.21/scripts/parse-ocp-param-tables.js`

| Field | Value |
|---|---|
| `path` | local-docs/ocp-4.21/scripts/parse-ocp-param-tables.js |
| `purpose` | Purpose-built OCP PDF parameter-table parser: detects table boundaries by 'Table N.M. ...parameter...' headings, parses rows, reads 'Value:' lines for type, reconstructs nested paths from indentation and filters out parent-only rows. |
| `originalRole` | 4.21 fork of the 4.20 revised (iteration 3) table parser. |
| `inputs` | argv[2] = extracted PDF text file |
| `outputs` | stdout JSON |
| `hardcodedVersionAssumptions` | None. Byte-identical to the 4.20 copy; argv in, stdout out, no repo or workspace path. |
| `currentStatus` | Not run (no extracted text available). By inspection: side-effect free, version-clean, and the better of the two PDF table parsers. Note it detects tables by the generic pattern /^Table\s+\d+\.\d+\.\s+.*[Pp]arameter/ rather than hardcoded numbers, so unlike parse-imageset-params.js it survives Red Hat renumbering. |
| `disposition` | REUSE AS-IS |
| `action422` | Promote verbatim to scripts/minor/parse-ocp-param-tables.js as the PDF fallback. No code change required. |
| `futureMinorValue` | Moderate. Secondary to the HTML route, but it is renumbering-resilient and needs no maintenance, so keeping it costs nothing and preserves a fallback if 4.22 HTML pages prove unscrapeable. |
| `requiredTestsGuards` | Golden-fixture test over a committed sample of extracted table text asserting path reconstruction from indentation and parent-row suppression (network-hermetic per R4). |
| `evidenceReason` | REUSE AS-IS: byte-identical across the fork, contains no version literal, no repo path and no workspace assumption, takes input by argument and writes to stdout. Like extract-from-html.js it is already in the shape scripts/minor/** requires. |
| `forkDivergence` | Byte-identical to the 4.20 copy. |

#### G2.18 `local-docs/ocp-4.21/scripts/parse-parameters.js`

| Field | Value |
|---|---|
| `path` | local-docs/ocp-4.21/scripts/parse-parameters.js |
| `purpose` | Extracts parameters from 'Sample install-config.yaml file' / 'Sample agent-config.yaml file' sections: captures the YAML block, parses the following 'where:' prose into per-parameter descriptions, and infers required/type from wording. Skips TOC entries and PDF page furniture. |
| `originalRole` | 4.21 fork of the 4.20 primary documentation extractor. |
| `inputs` | argv[2] = extracted PDF text file |
| `outputs` | stdout JSON |
| `hardcodedVersionAssumptions` | One header comment line (line 3). No functional version dependency; argv in, stdout out. |
| `currentStatus` | Not run (no extracted text present for 4.21). PHASE_2_1_COMPLETION.md records it as the successful parser iteration with two acknowledged weaknesses: limited coverage because only the 'where:' pattern is handled, and weak required/optional detection inferred from prose. |
| `disposition` | PARAMETERIZE |
| `action422` | Promote to scripts/minor/parse-doc-parameters.js with the minor-bearing banner removed or derived. Zero logic change. |
| `futureMinorValue` | Moderate. It is the only extractor that captures the authoritative 'where:' prose descriptions, which are the source of user-facing catalog description text. |
| `requiredTestsGuards` | Golden-fixture test over committed sample text covering a sample YAML block plus its 'where:' section, including a NOTE/IMPORTANT callout that must be skipped. |
| `evidenceReason` | PARAMETERIZE rather than REUSE AS-IS on a narrow but deliberate point: the change is banner-only with no logic impact, but a promoted script must not carry a header asserting it is the 'OpenShift 4.21 Parameter Extraction Script' while being run against 4.22. Mislabeled provenance is the exact failure mode this harvest documents in extract-oc-mirror-params-manual.js. |
| `forkDivergence` | vs 4.20: 1 line, header comment only. Zero functional difference. |

#### G2.19 `local-docs/ocp-4.21/scripts/parse-parameter-tables.js`

| Field | Value |
|---|---|
| `path` | local-docs/ocp-4.21/scripts/parse-parameter-tables.js |
| `purpose` | First-iteration PDF parameter-table parser using a line-oriented state machine with indentation-derived nesting and look-ahead parent detection. |
| `originalRole` | 4.21 fork of a 4.20 artifact already known to have failed at 4.20. |
| `inputs` | argv[2] = extracted PDF text file |
| `outputs` | stdout JSON |
| `hardcodedVersionAssumptions` | One header comment line (line 3). |
| `currentStatus` | Known defective, carried forward unexamined. WEB_EXTRACTION_PLAN.md records a 91% path-building error rate (283 of 311 malformed) and PHASE_2_1_COMPLETION.md labels this iteration FAILED; consolidate-all-params.js contains a quarantine branch written specifically for its bad output. Not executed. |
| `disposition` | RETIRE |
| `action422` | None. extract-table-params.sh's successor is re-pointed at parse-ocp-param-tables.js. |
| `futureMinorValue` | Negative. |
| `requiredTestsGuards` | None for the retired script. |
| `evidenceReason` | RETIRE justified positively with two named, retained replacements: extract-from-html.js (REUSE AS-IS in this same group — the replacement WEB_EXTRACTION_PLAN.md explicitly adopted for this failure) and parse-ocp-param-tables.js (REUSE AS-IS — the revised PDF parser). The capability is covered twice over; only the measured-91%-wrong implementation is dropped. This row is also the clearest cost of the fork mechanism: a script documented as FAILED at 4.20 was copied into 4.21 because sed does not read failure reports. |
| `forkDivergence` | vs 4.20: 1 line, header comment only. |

#### G2.20 `local-docs/ocp-4.21/scripts/validate-findings.js`

| Field | Value |
|---|---|
| `path` | local-docs/ocp-4.21/scripts/validate-findings.js |
| `purpose` | One-shot investigative transcript printing diagnostics for imageContentSources/imageDigestSources union semantics, four suspect required-flag fields and five suspect type fields in a single pinned scenario, then emitting recommendations for how requiredness discrepancies should be categorised. |
| `originalRole` | 4.21 fork of the 4.20 investigation that produced the design of corrected-analysis.js. |
| `inputs` | ../analysis/installer-source-params.json, ../analysis/agent-config-params.json, data/params/4.21/bare-metal-ipi.json |
| `outputs` | ../analysis/validation-issues.json, extensive stdout |
| `hardcodedVersionAssumptions` | PARAMS_DIR = <root>/data/params/4.21 (line 25); EXAMPLE_SCENARIO pinned to 'bare-metal-ipi'; three hardcoded field-name lists. |
| `currentStatus` | Partially broken and not run. It reads sourceEntry.rawFieldDefinition and sourceEntry.structName; parse-go-structs.js emits neither (it emits struct, and never rawFieldDefinition), so its VALIDATION 4 section silently prints nothing — another instance of the F1 field-contract drift. Its output is absent from ocp-4.21/analysis. |
| `disposition` | RETIRE |
| `action422` | None. |
| `futureMinorValue` | Low as code; its written reasoning is preserved as the test specification for corrected-analysis.js. |
| `requiredTestsGuards` | None. Its four recommended requiredness categories (CONDITIONAL_REQUIRED, UNION_REQUIRED, CONTEXT_REQUIRED, TRULY_REQUIRED) become named unit tests on the promoted corrected-analysis.js. |
| `evidenceReason` | RETIRE justified positively: every recommendation this script outputs was implemented in corrected-analysis.js, which is PARAMETERIZEd and promoted in this same group with per-rule test coverage. The capability therefore already lives in a retained, tested artifact, while the script itself is a frozen single-scenario diagnostic with two dead field references. |
| `forkDivergence` | vs 4.20: 1 line (PARAMS_DIR). No logic divergence. |

---

## G3 — 4.21 analysis outputs

**Root:** `local-docs/ocp-4.21/analysis/` · **Plan count:** 32 · **Actual:** 32 · ✅ matches

> These are evidence artifacts, not automation. Their harvest question is not 'does it run' but 'is it required input for 4.22, and does it survive only here'. Two are tombstones and are retired; the rest are retained as read-only evidence. The delta baseline among them is a hard Tranche-1 dependency that exists in exactly one gitignored copy (GAP-05).

| # | path | disposition | currentStatus (summary) |
|---:|---|---|---|
| 1 | `local-docs/ocp-4.21/analysis/installer-source-params.json` | **REUSE AS-IS** | Present, 489 KB, valid JSON, 525 parameters — verified by reading. Its generating run is logged with zero warnings. |
| 2 | `local-docs/ocp-4.21/analysis/agent-config-params.json` | **REUSE AS-IS** | Present, 33 KB, valid JSON, 25 parameters; generating run logged with zero warnings. |
| 3 | `local-docs/ocp-4.21/analysis/delta-installer-params.json` | **REUSE AS-IS** | Present and valid. Verified by reading: 0 of 49 added rows carry a file field and 0 carry a comment field, and changed is 0 — the materialised symptom… |
| 4 | `local-docs/ocp-4.21/analysis/delta-agent-config-params.json` | **REUSE AS-IS** | Present, valid, small (940 bytes). A clean verified negative result. |
| 5 | `local-docs/ocp-4.21/analysis/catalog-gap-analysis.json` | **REUSE AS-IS** | Present and valid, but carries two verified data defects: every one of the 49 rows has existsInCurrentCatalog false and alreadyCovered is 0 (consisten… |
| 6 | `local-docs/ocp-4.21/analysis/CATALOG_GAP_ANALYSIS.md` | **RETIRE** | Content destroyed. The file is 780 bytes and contains a SUPERSEDED banner, a list of four known errors, and the line '[Original content preserved but … |
| 7 | `local-docs/ocp-4.21/analysis/CATALOG_UPDATE_PLAN.md` | **RETIRE** | Content destroyed; 743 bytes. Same false 'Original Plan Below (for historical reference only)' / '[Original content preserved but superseded]' pattern… |
| 8 | `local-docs/ocp-4.21/analysis/DOC-102-SLICE-3-DELTA-REPORT.md` | **REUSE AS-IS** | Present, 13 KB, intact; pinned to repository commit 9e6ca1ba095215dad8dbfeb6516b0109e4d92be7. |
| 9 | `local-docs/ocp-4.21/analysis/DOC-102-SLICE-4B-RECONCILIATION.md` | **REUSE AS-IS** | Present, 13.5 KB, intact. This is the single most load-bearing analysis document in the 4.21 corpus and the authority that supersedes both tombstones. |
| 10 | `local-docs/ocp-4.21/analysis/SLICE-5A-PLAN.md` | **REUSE AS-IS** | Present, 15 KB, intact, and fully executed — the versioned layout it specifies is the layout in the tree today. |
| 11 | `local-docs/ocp-4.21/analysis/slice-5b-candidate-params.json` | **REUSE AS-IS** | Present, valid, 11 candidates. Supersedes catalog-gap-analysis.json. |
| 12 | `local-docs/ocp-4.21/analysis/slice-5c-manual-review-params.json` | **REUSE AS-IS** | Present, valid, 5 parameters investigated. |
| 13 | `local-docs/ocp-4.21/analysis/SLICE-5C-MANUAL-REVIEW-PARAMS.md` | **REUSE AS-IS** | Present, 23 KB, intact. |
| 14 | `local-docs/ocp-4.21/analysis/slice-5e-plan-reconciliation-and-placement.json` | **REUSE AS-IS** | Present, valid, intact. Records exactly 1 parameter safe for immediate implementation (controlPlane.platform.aws.rootVolume.throughput), 4 requiring b… |
| 15 | `local-docs/ocp-4.21/analysis/SLICE-5E-PLAN-RECONCILIATION-AND-PLACEMENT.md` | **REUSE AS-IS** | Present, 44 KB, intact. |
| 16 | `local-docs/ocp-4.21/analysis/slice-5f10-backend-skipped-test-audit.json` | **REUSE AS-IS** | Present, valid. Records the backend suite at 657 tests / 649 pass / 0 fail / 0 cancelled / 8 skipped after repair. |
| 17 | `local-docs/ocp-4.21/analysis/SLICE-5F10-BACKEND-SKIPPED-TEST-AUDIT.md` | **REUSE AS-IS** | Present, 5.3 KB, intact. Header records 657 tests / 649 pass / 0 fail / 0 cancelled / 8 skipped. |
| 18 | `local-docs/ocp-4.21/analysis/slice-5f2-curl-validation.txt` | **REUSE AS-IS** | Present, 3.7 KB, intact. Verified by reading: run started Tue Jun 30 03:42:05 PM EDT 2026, and the first three checks all return HTTP 403 — including … |
| 19 | `local-docs/ocp-4.21/analysis/SLICE-5F2-URL-VALIDATION-RESULTS.md` | **REUSE AS-IS** | Present, 3.5 KB, intact. Its subtitle is literally '(Corrected)' and its stated purpose is 'Actual HTTP validation attempts with honest evidence class… |
| 20 | `local-docs/ocp-4.21/analysis/slice-5f3-backend-test-nonpass-audit.json` | **REUSE AS-IS** | Present, valid, intact. |
| 21 | `local-docs/ocp-4.21/analysis/SLICE-5F3-BACKEND-TEST-NONPASS-AUDIT.md` | **REUSE AS-IS** | Present, 8.4 KB, intact. Note its figures are the pre-repair run; SLICE-5F10 records the post-repair state (649 pass, 0 fail). Not a contradiction — t… |
| 22 | `local-docs/ocp-4.21/analysis/SLICE-5F5-PARTIAL-STATUS.md` | **REUSE AS-IS** | Present, 13.6 KB, intact. |
| 23 | `local-docs/ocp-4.21/analysis/SLICE-5F6-FINAL-STATUS.md` | **REUSE AS-IS** | Present, 10.3 KB, intact. |
| 24 | `local-docs/ocp-4.21/analysis/slice-5f6-partial-commit-audit.json` | **REUSE AS-IS** | Present, valid, 4 entries. |
| 25 | `local-docs/ocp-4.21/analysis/SLICE-5F6-PARTIAL-COMMIT-AUDIT.md` | **REUSE AS-IS** | Present, 10.9 KB, intact. |
| 26 | `local-docs/ocp-4.21/analysis/slice-5f-catalog-only-field-guide-status.json` | **REUSE AS-IS** | Present, valid, 11 parameters. |
| 27 | `local-docs/ocp-4.21/analysis/SLICE-5F-DOCS-URL-VALIDATION.md` | **REUSE AS-IS** | Present, 5.6 KB, intact. |
| 28 | `local-docs/ocp-4.21/analysis/slice-5f-field-guide-v420-compartment-inventory.json` | **REUSE AS-IS** | Present, valid. Records totalCompartments 37 for v4.20. Note Revision 3 2.G describes v4.21 as having 41 compartments and the certification corpus rec… |
| 29 | `local-docs/ocp-4.21/analysis/slice-5f-url-validation-results.json` | **REUSE AS-IS** | Present, valid. Verified by reading: totalUrls 35, validated 0, failed 35 — a total block, consistent with the 403 anti-bot cause rather than with 35 … |
| 30 | `local-docs/ocp-4.21/analysis/SLICE-5F-URL-VALIDATION-RESULTS.md` | **REUSE AS-IS** | Present, 4.8 KB, intact. ASSET_MANIFEST.md §10 records the fallback evidence chain adopted when direct validation failed: successful PDF acquisition p… |
| 31 | `local-docs/ocp-4.21/analysis/logs/parse-go-structs.stderr.log` | **REUSE AS-IS** | Present, 383 bytes, intact. Verified by reading: 150 Go source files, 141 structs parsed, 525 parameter paths built, no warnings. This is the primary … |
| 32 | `local-docs/ocp-4.21/analysis/logs/parse-agent-config-structs.stderr.log` | **REUSE AS-IS** | Present, 675 bytes, intact. Verified by reading: 13 Go files, 8 structs, 25 parameter paths, no warnings, and a listing of the five top-level agent-co… |

#### G3.1 `local-docs/ocp-4.21/analysis/installer-source-params.json`

| Field | Value |
|---|---|
| `path` | local-docs/ocp-4.21/analysis/installer-source-params.json |
| `purpose` | The 4.21 install-config parameter extraction: 525 parameter paths from 141 structs across 150 Go files, each with path, type, goType, required, default, allowed, description, struct and field. |
| `originalRole` | Slice 2 output; the authoritative-source snapshot for 4.21. |
| `inputs` | produced by parse-go-structs.js from installer release-4.21 @ 1accb6487cf3784561665c08048dde20ad672c39 |
| `outputs` | consumed by compare-raw-extractions.js, normalize-and-compare.js, compare-source-vs-catalogs.js, corrected-analysis.js, validate-findings.js |
| `hardcodedVersionAssumptions` | source field states 'github.com/openshift/installer release-4.21'. Content is inherently 4.21-specific. |
| `currentStatus` | Present, 489 KB, valid JSON, 525 parameters — verified by reading. Its generating run is logged with zero warnings. |
| `disposition` | REUSE AS-IS |
| `action422` | This is the REQUIRED BASELINE for the 4.21->4.22 install-config delta in Tranche 1. It must be available and integrity-checked before the 4.22 extraction is diffed against it. |
| `futureMinorValue` | Critical and recurring: every minor's delta needs the previous minor's extraction. The pattern must become 'the previous minor's extraction is a tracked, hashed input', not 'it happens to still be on this laptop'. |
| `requiredTestsGuards` | A recorded SHA256 in the tracked provenance for 4.22 so Tranche 1 can prove it diffed against the same bytes this audit produced. |
| `evidenceReason` | REUSE AS-IS: regenerating it would require re-cloning installer release-4.21 and would risk a different result if the branch head moved. The existing file at a pinned commit is the better evidence. Single-copy risk recorded as GAP-05. |

#### G3.2 `local-docs/ocp-4.21/analysis/agent-config-params.json`

| Field | Value |
|---|---|
| `path` | local-docs/ocp-4.21/analysis/agent-config-params.json |
| `purpose` | The 4.21 agent-config parameter extraction: 25 parameter paths from 8 structs across 13 Go files. |
| `originalRole` | Slice 2 output. |
| `inputs` | produced by parse-agent-config-structs.js from installer release-4.21 @ 1accb6487 |
| `outputs` | consumed by the comparison and delta scripts |
| `hardcodedVersionAssumptions` | source field names release-4.21. |
| `currentStatus` | Present, 33 KB, valid JSON, 25 parameters; generating run logged with zero warnings. |
| `disposition` | REUSE AS-IS |
| `action422` | Baseline for the 4.21->4.22 agent-config delta. 2.D records agent/agentconfig_types.go as showing no tag change at 4.22; this file is what makes that a verified negative rather than an assumption. |
| `futureMinorValue` | Critical and recurring, same as the install-config extraction. |
| `requiredTestsGuards` | SHA256 recorded in 4.22 tracked provenance. |
| `evidenceReason` | REUSE AS-IS: a pinned-commit extraction is stronger evidence than a regeneration against a possibly-moved branch head. |

#### G3.3 `local-docs/ocp-4.21/analysis/delta-installer-params.json`

| Field | Value |
|---|---|
| `path` | local-docs/ocp-4.21/analysis/delta-installer-params.json |
| `purpose` | The 4.20->4.21 install-config delta: 477 -> 525 parameters, 49 added, 1 removed, 0 changed, 476 unchanged, 0 needing manual review. |
| `originalRole` | Slice 3 output; the input to catalog gap analysis. |
| `inputs` | produced by compare-raw-extractions.js from the 4.20 and 4.21 extractions |
| `outputs` | consumed by analyze-catalog-gaps.js |
| `hardcodedVersionAssumptions` | classification labels 'added_in_4_21' / 'removed_in_4_21' baked into the data. |
| `currentStatus` | Present and valid. Verified by reading: 0 of 49 added rows carry a file field and 0 carry a comment field, and changed is 0 — the materialised symptom of defect F1 (the comparator reads field names the extractor never emits). The single removed row is platform.gcp.serviceEndpoints, which Slice 4B independently resolved as a 4.20 misparse rather than a real removal. |
| `disposition` | REUSE AS-IS |
| `action422` | Retain as the shape precedent and as evidence of F1. Tranche 1 produces the 4.21->4.22 delta with the corrected field contract; the two must not be compared naively, because this one has structurally empty change detection. |
| `futureMinorValue` | Moderate as data; high as the proof that a producer/consumer contract test is mandatory. |
| `requiredTestsGuards` | The field-contract test recorded against compare-raw-extractions.js and parse-go-structs.js. |
| `evidenceReason` | REUSE AS-IS: it is the historical record of the 4.21 delta and the only concrete artifact demonstrating F1's real-world effect. |

#### G3.4 `local-docs/ocp-4.21/analysis/delta-agent-config-params.json`

| Field | Value |
|---|---|
| `path` | local-docs/ocp-4.21/analysis/delta-agent-config-params.json |
| `purpose` | The 4.20->4.21 agent-config delta: 25 -> 25 parameters, 0 added, 0 removed, 0 changed. |
| `originalRole` | Slice 3 output. |
| `inputs` | produced by compare-raw-extractions.js |
| `outputs` | evidence only |
| `hardcodedVersionAssumptions` | comparison labels only. |
| `currentStatus` | Present, valid, small (940 bytes). A clean verified negative result. |
| `disposition` | REUSE AS-IS |
| `action422` | Baseline shape for the 4.22 agent-config delta. |
| `futureMinorValue` | Moderate. A documented all-zero delta is genuinely useful: it tells a future reader that an empty result is a normal outcome, not a broken run. |
| `requiredTestsGuards` | None. |
| `evidenceReason` | REUSE AS-IS: durable negative evidence, costs nothing to retain. |

#### G3.5 `local-docs/ocp-4.21/analysis/catalog-gap-analysis.json`

| Field | Value |
|---|---|
| `path` | local-docs/ocp-4.21/analysis/catalog-gap-analysis.json |
| `purpose` | Per-parameter classification of all 49 added 4.21 parameters by platform, support boundary, recommended action, recommended minVersion and P0-P3 priority. |
| `originalRole` | Slice 4 output. |
| `inputs` | produced by analyze-catalog-gaps.js from delta-installer-params.json plus the frontend catalog mirror |
| `outputs` | superseded by slice-5b-candidate-params.json |
| `hardcodedVersionAssumptions` | recommendedMinVersion '4.21' throughout. |
| `currentStatus` | Present and valid, but carries two verified data defects: every one of the 49 rows has existsInCurrentCatalog false and alreadyCovered is 0 (consistent with the catalog-directory read, whose current breakage is proven and whose breakage at run time is unresolved), and every row's evidence array reads 'Source: unknown' because of F1. Its headline counts were corrected by Slice 4B. |
| `disposition` | REUSE AS-IS |
| `action422` | Retain as historical evidence only. Tranche 1 must take its classification numbers from DOC-102-SLICE-4B-RECONCILIATION.md and slice-5b-candidate-params.json, never from this file. |
| `futureMinorValue` | Low as data; moderate as a worked example of a classification output shape. |
| `requiredTestsGuards` | None; the replacement's guards are on the analyze-catalog-gaps.js row. |
| `evidenceReason` | REUSE AS-IS rather than RETIRE: unlike the two markdown tombstones, this file's content was not deleted, and it remains the only record of what Slice 4 actually computed before correction. Its superseded status is recorded here rather than by destroying it. |

#### G3.6 `local-docs/ocp-4.21/analysis/CATALOG_GAP_ANALYSIS.md`

| Field | Value |
|---|---|
| `path` | local-docs/ocp-4.21/analysis/CATALOG_GAP_ANALYSIS.md |
| `purpose` | Was the human-readable Slice 4 gap report. Is now a 22-line tombstone. |
| `originalRole` | Slice 4 narrative report, described in ASSET_MANIFEST.md §16 as '400+ lines'. |
| `inputs` | n/a |
| `outputs` | n/a |
| `hardcodedVersionAssumptions` | n/a |
| `currentStatus` | Content destroyed. The file is 780 bytes and contains a SUPERSEDED banner, a list of four known errors, and the line '[Original content preserved but superseded]' — but the original content is NOT preserved; it was deleted. The banner's own claim is false. The four recorded errors are substantive: fabricated Azure parameters (ultraSSDCapability, diskIOPSReadWrite, diskMBpsReadWrite, vmNetworkingType), fabricated networking/proxy parameters (clusterNetworkMTU, proxy.*), an incorrect P0/P1 count, and a wrong backend catalog structure assessment. |
| `disposition` | RETIRE |
| `action422` | None. |
| `futureMinorValue` | Zero as content. High as a cautionary record — which is why the replacement must be retained. |
| `requiredTestsGuards` | None. |
| `evidenceReason` | RETIRE justified positively: DOC-102-SLICE-4B-RECONCILIATION.md is retained and supersedes it completely, enumerating every error and giving the corrected figures. Nothing is lost by retiring a tombstone whose body is already gone. Recorded as finding F4 because a file that claims to preserve content it has deleted is a provenance-integrity defect in its own right. |
| `capturedBeforeRetirement` | Fabricated-parameter list and corrected counts are reproduced in DOC-102-SLICE-4B-RECONCILIATION.md §'Errors in Original Slice 4 Reports' and in this ledger's finding F4. |

#### G3.7 `local-docs/ocp-4.21/analysis/CATALOG_UPDATE_PLAN.md`

| Field | Value |
|---|---|
| `path` | local-docs/ocp-4.21/analysis/CATALOG_UPDATE_PLAN.md |
| `purpose` | Was the Slice 4 catalog implementation roadmap. Is now a 22-line tombstone. |
| `originalRole` | Slice 4 implementation plan. |
| `inputs` | n/a |
| `outputs` | n/a |
| `hardcodedVersionAssumptions` | n/a |
| `currentStatus` | Content destroyed; 743 bytes. Same false 'Original Plan Below (for historical reference only)' / '[Original content preserved but superseded]' pattern. Records four errors, the load-bearing one being that it assumed the catalog structure was already versioned when the frontend was still flat, and therefore omitted the migration that turned out to be a hard prerequisite. |
| `disposition` | RETIRE |
| `action422` | None. |
| `futureMinorValue` | Zero as content. |
| `requiredTestsGuards` | None. |
| `evidenceReason` | RETIRE justified positively: DOC-102-SLICE-4B-RECONCILIATION.md is retained, supersedes it, and carries the corrected Slice 5A/5B/5C sequencing including the migration prerequisite this plan missed. |

#### G3.8 `local-docs/ocp-4.21/analysis/DOC-102-SLICE-3-DELTA-REPORT.md`

| Field | Value |
|---|---|
| `path` | local-docs/ocp-4.21/analysis/DOC-102-SLICE-3-DELTA-REPORT.md |
| `purpose` | Human-readable narrative of the 4.20->4.21 delta with per-platform breakdown of the 49 additions. |
| `originalRole` | Slice 3 report. |
| `inputs` | delta-installer-params.json, delta-agent-config-params.json |
| `outputs` | evidence |
| `hardcodedVersionAssumptions` | 4.20->4.21 framing throughout. |
| `currentStatus` | Present, 13 KB, intact; pinned to repository commit 9e6ca1ba095215dad8dbfeb6516b0109e4d92be7. |
| `disposition` | REUSE AS-IS |
| `action422` | Template for the 4.21->4.22 delta report Tranche 1 must produce. |
| `futureMinorValue` | High as a report template — it is the shape a human reviewer needs to make support decisions. |
| `requiredTestsGuards` | None. |
| `evidenceReason` | REUSE AS-IS: intact, correctly scoped, and its 'no production catalog support is implied' framing is exactly the fail-closed discipline R3 requires. |

#### G3.9 `local-docs/ocp-4.21/analysis/DOC-102-SLICE-4B-RECONCILIATION.md`

| Field | Value |
|---|---|
| `path` | local-docs/ocp-4.21/analysis/DOC-102-SLICE-4B-RECONCILIATION.md |
| `purpose` | The correction record for Slice 4: identifies the frontend flat-vs-versioned catalog structure mismatch as a blocking prerequisite, corrects the parameter counts from 8 to 11 (7 high-confidence + 4 manual review), enumerates Slice 4's fabricated parameters, verifies AWS GovCloud and Azure Government applicability, and resolves GCP serviceEndpoints as a 4.20 misparse. |
| `originalRole` | Slice 4B reconciliation. |
| `inputs` | delta-installer-params.json, catalog-gap-analysis.json, the repository tree |
| `outputs` | slice-5b-candidate-params.json; the corrected Slice 5A/5B/5C sequence |
| `hardcodedVersionAssumptions` | 4.20/4.21 throughout; describes the then-current flat frontend layout, since migrated. |
| `currentStatus` | Present, 13.5 KB, intact. This is the single most load-bearing analysis document in the 4.21 corpus and the authority that supersedes both tombstones. |
| `disposition` | REUSE AS-IS |
| `action422` | Two uses. (1) Tranche 1 takes its corrected classification figures from here, never from Slice 4. (2) Its method — a dedicated reconciliation pass that re-derives every claim from the raw delta and names the errors found — should be repeated for 4.22. |
| `futureMinorValue` | Very high. It is the proof that an unreconciled classification pass produced fabricated parameters, and the template for catching that. |
| `requiredTestsGuards` | None (document). Its lesson becomes R6 enforcement: every classified parameter must be traceable to a row in the delta file. |
| `evidenceReason` | REUSE AS-IS: intact, authoritative, and the named replacement that justifies retiring both tombstones. |

#### G3.10 `local-docs/ocp-4.21/analysis/SLICE-5A-PLAN.md`

| Field | Value |
|---|---|
| `path` | local-docs/ocp-4.21/analysis/SLICE-5A-PLAN.md |
| `purpose` | Plan for migrating the frontend catalog mirror from flat files to versioned subdirectories with dynamic version-aware loading per ADR-001/ADR-005. |
| `originalRole` | Slice 5A plan; the prerequisite Slice 4 missed. |
| `inputs` | Slice 4B reconciliation |
| `outputs` | implemented in commits e65e6ee and a45b20e (2026-06-29) |
| `hardcodedVersionAssumptions` | 4.20/4.21 migration specifics. |
| `currentStatus` | Present, 15 KB, intact, and fully executed — the versioned layout it specifies is the layout in the tree today. |
| `disposition` | REUSE AS-IS |
| `action422` | Historical evidence of why the versioned layout exists. Directly relevant to 0A-1, because several tracked scripts and six tracked docs still assume the flat layout this plan replaced. |
| `futureMinorValue` | Low — a one-time structural migration that will not recur. |
| `requiredTestsGuards` | None. |
| `evidenceReason` | REUSE AS-IS: intact, and it is the authority explaining why flat-path references anywhere in the repo are now stale. |

#### G3.11 `local-docs/ocp-4.21/analysis/slice-5b-candidate-params.json`

| Field | Value |
|---|---|
| `path` | local-docs/ocp-4.21/analysis/slice-5b-candidate-params.json |
| `purpose` | The corrected 4.21 candidate parameter set: 11 candidates (7 high-confidence, 4 manual review) each with path, platform, scenarios, type, required, priority, recommended action, target catalog files, evidence source, whyIncluded, and UI/generation/validation change flags; plus a deferred block for PowerVC, GCP, OpenStack and imageDigestSources. |
| `originalRole` | Slice 4B corrected output; the authoritative 4.21 candidate list. |
| `inputs` | Slice 4B reconciliation |
| `outputs` | input to Slice 5C investigation and Slice 5E placement |
| `hardcodedVersionAssumptions` | 4.21-specific parameter set. |
| `currentStatus` | Present, valid, 11 candidates. Supersedes catalog-gap-analysis.json. |
| `disposition` | REUSE AS-IS |
| `action422` | Model for the 4.22 candidate list Tranche 1 must produce. Its field set — especially whyIncluded, evidenceSource and the three change flags — is the right schema and should be carried into the 4.22 classification table. |
| `futureMinorValue` | High as a schema; its specific contents are 4.21-only. |
| `requiredTestsGuards` | None (data). |
| `evidenceReason` | REUSE AS-IS: intact, corrected, and the per-candidate evidence fields are exactly what O1 and R6 require of a classification record. |

#### G3.12 `local-docs/ocp-4.21/analysis/slice-5c-manual-review-params.json`

| Field | Value |
|---|---|
| `path` | local-docs/ocp-4.21/analysis/slice-5c-manual-review-params.json |
| `purpose` | Evidence-based investigation of the 5 manual-review parameters, recording for each: resolved type and typeDetails, required, default, sourceFile, sourceLine, sourceEvidence, description, outputFile, featureGate and featureGateCondition, validationConstraint and validationFile. 4 recommended for addition, 1 deferred, 0 rejected. |
| `originalRole` | Slice 5C investigation output. |
| `inputs` | installer release-4.21 source |
| `outputs` | catalog additions |
| `hardcodedVersionAssumptions` | 4.21 source line numbers. |
| `currentStatus` | Present, valid, 5 parameters investigated. |
| `disposition` | REUSE AS-IS |
| `action422` | This is the GOLD STANDARD evidence record in the entire 4.21 corpus and the template Tranche 1 must follow for every 4.22 parameter requiring manual review. Note especially that it records file AND line AND verbatim source evidence AND feature-gate conditions AND the validation file — which is precisely what O1 requires to distinguish mechanical installer capability from product supportedness. |
| `futureMinorValue` | Very high as a schema. It is the concrete answer to 'what does adequate evidence for a parameter decision look like'. |
| `requiredTestsGuards` | None (data). Its schema should constrain the 4.22 classification table. |
| `evidenceReason` | REUSE AS-IS: intact and methodologically exemplary. Its featureGate/featureGateCondition fields are the mechanism by which O3-style TechPreview distinctions get recorded rather than lost. |

#### G3.13 `local-docs/ocp-4.21/analysis/SLICE-5C-MANUAL-REVIEW-PARAMS.md`

| Field | Value |
|---|---|
| `path` | local-docs/ocp-4.21/analysis/SLICE-5C-MANUAL-REVIEW-PARAMS.md |
| `purpose` | Human-readable narrative of the Slice 5C investigation, scoped explicitly to investigation and recommendation with NO catalog modifications. |
| `originalRole` | Slice 5C report. |
| `inputs` | slice-5c-manual-review-params.json |
| `outputs` | evidence |
| `hardcodedVersionAssumptions` | 4.21 specifics. |
| `currentStatus` | Present, 23 KB, intact. |
| `disposition` | REUSE AS-IS |
| `action422` | Report template for 4.22 manual-review investigations. |
| `futureMinorValue` | High as a template; its explicit investigate-then-recommend-then-stop scoping is the correct shape for a human-gated decision. |
| `requiredTestsGuards` | None. |
| `evidenceReason` | REUSE AS-IS: intact and the narrative companion to the gold-standard JSON. |

#### G3.14 `local-docs/ocp-4.21/analysis/slice-5e-plan-reconciliation-and-placement.json`

| Field | Value |
|---|---|
| `path` | local-docs/ocp-4.21/analysis/slice-5e-plan-reconciliation-and-placement.json |
| `purpose` | Implementation placement matrix: maps the 11 catalog-only parameters into four implementation groups, records a recommended five-slice sequence with timeline/risk/blockers, enumerates five critical blockers each with question/options/recommendation, and records an infrastructureReadiness assessment across seven axes (catalog loading, version selection, validation version-awareness, UI conditional rendering, generation version gating, state-migration handling of unsupported fields, Field Guide version gating). |
| `originalRole` | Slice 5E planning output. |
| `inputs` | slice-5b and slice-5c outputs |
| `outputs` | slice sequencing |
| `hardcodedVersionAssumptions` | 4.21 parameter set and slice numbering. |
| `currentStatus` | Present, valid, intact. Records exactly 1 parameter safe for immediate implementation (controlPlane.platform.aws.rootVolume.throughput), 4 requiring blocker resolution and 6 recommended catalog-only. |
| `disposition` | REUSE AS-IS |
| `action422` | The infrastructureReadiness seven-axis assessment is directly reusable as the Tranche 4 pre-flip gate structure, and the catalog-only-vs-full-implementation distinction is the mechanism that lets 4.22 catalog data land while UI work is deferred. |
| `futureMinorValue` | High. 'Catalog-only, no UI yet' is a legitimate and necessary landing state, and this artifact is where that pattern is articulated. |
| `requiredTestsGuards` | None (data). |
| `evidenceReason` | REUSE AS-IS: intact, and the only artifact that treats readiness as a multi-axis assessment rather than a single boolean. |

#### G3.15 `local-docs/ocp-4.21/analysis/SLICE-5E-PLAN-RECONCILIATION-AND-PLACEMENT.md`

| Field | Value |
|---|---|
| `path` | local-docs/ocp-4.21/analysis/SLICE-5E-PLAN-RECONCILIATION-AND-PLACEMENT.md |
| `purpose` | Human-readable Slice 5E narrative — the largest analysis document in the corpus at 44 KB. |
| `originalRole` | Slice 5E report. |
| `inputs` | slice-5e JSON |
| `outputs` | evidence |
| `hardcodedVersionAssumptions` | 4.21 specifics. |
| `currentStatus` | Present, 44 KB, intact. |
| `disposition` | REUSE AS-IS |
| `action422` | Reference when building the Tranche 4 verification gate. |
| `futureMinorValue` | Moderate. |
| `requiredTestsGuards` | None. |
| `evidenceReason` | REUSE AS-IS: intact narrative companion to the placement matrix. |

#### G3.16 `local-docs/ocp-4.21/analysis/slice-5f10-backend-skipped-test-audit.json`

| Field | Value |
|---|---|
| `path` | local-docs/ocp-4.21/analysis/slice-5f10-backend-skipped-test-audit.json |
| `purpose` | Audit of 8 skipped backend tests, each with test file, suite, test name, skip mechanism, reason-in-code, classification, stillValid, canUnskipNow, tracking item and recommended action; plus a record of a failed audit run and its resolution. |
| `originalRole` | Slice 5F.10 test-health audit. |
| `inputs` | backend test suite |
| `outputs` | evidence |
| `hardcodedVersionAssumptions` | None material. |
| `currentStatus` | Present, valid. Records the backend suite at 657 tests / 649 pass / 0 fail / 0 cancelled / 8 skipped after repair. |
| `disposition` | REUSE AS-IS |
| `action422` | Tranche 6 must re-audit skipped tests; this is the schema and the 4.21 baseline to compare against so no new permanent skip is introduced unnoticed. |
| `futureMinorValue` | High. A per-skip justification register is the only thing that stops skipped tests accumulating silently across minors. |
| `requiredTestsGuards` | Tranche 6 should assert the skipped-test count does not exceed this recorded baseline without an explicit justification entry. |
| `evidenceReason` | REUSE AS-IS: intact, and the stillValid/canUnskipNow fields make it actionable rather than merely descriptive. |

#### G3.17 `local-docs/ocp-4.21/analysis/SLICE-5F10-BACKEND-SKIPPED-TEST-AUDIT.md`

| Field | Value |
|---|---|
| `path` | local-docs/ocp-4.21/analysis/SLICE-5F10-BACKEND-SKIPPED-TEST-AUDIT.md |
| `purpose` | Narrative of the skipped-test audit. |
| `originalRole` | Slice 5F.10 report. |
| `inputs` | the companion JSON |
| `outputs` | evidence |
| `hardcodedVersionAssumptions` | None material. |
| `currentStatus` | Present, 5.3 KB, intact. Header records 657 tests / 649 pass / 0 fail / 0 cancelled / 8 skipped. |
| `disposition` | REUSE AS-IS |
| `action422` | Baseline for Tranche 6 test-health reporting. |
| `futureMinorValue` | Moderate. |
| `requiredTestsGuards` | None. |
| `evidenceReason` | REUSE AS-IS: intact. |

#### G3.18 `local-docs/ocp-4.21/analysis/slice-5f2-curl-validation.txt`

| Field | Value |
|---|---|
| `path` | local-docs/ocp-4.21/analysis/slice-5f2-curl-validation.txt |
| `purpose` | Raw curl transcript of documentation URL validation attempts with browser-like headers, one block per URL with the HTTP status. |
| `originalRole` | Slice 5F.2 evidence — THE primary evidence behind lesson L4. |
| `inputs` | network, 2026-06-30 |
| `outputs` | evidence |
| `hardcodedVersionAssumptions` | 4.21 doc URLs. |
| `currentStatus` | Present, 3.7 KB, intact. Verified by reading: run started Tue Jun 30 03:42:05 PM EDT 2026, and the first three checks all return HTTP 403 — including the 4.21 disconnected_environments index. |
| `disposition` | REUSE AS-IS |
| `action422` | Keep as the historical 403 baseline. Revision 3 L4 records that 4.22 doc HEAD checks now return 200 (verified 3/3), i.e. the blocker this file documents no longer reproduces. That transition is only demonstrable because this raw evidence survives. |
| `futureMinorValue` | High as precedent: it proves a doc-validation approach can be blocked by anti-bot protection rather than by a bad URL, which is a distinction that otherwise gets misdiagnosed as missing documentation. |
| `requiredTestsGuards` | None, and deliberately so: per R4 no test may reach docs.redhat.com. URL liveness belongs to acquisition only. |
| `evidenceReason` | REUSE AS-IS: irreplaceable raw evidence for a named lesson, and small. |

#### G3.19 `local-docs/ocp-4.21/analysis/SLICE-5F2-URL-VALIDATION-RESULTS.md`

| Field | Value |
|---|---|
| `path` | local-docs/ocp-4.21/analysis/SLICE-5F2-URL-VALIDATION-RESULTS.md |
| `purpose` | Corrected URL-validation results with explicitly honest evidence classification, replacing an earlier over-claim. |
| `originalRole` | Slice 5F.2 report. |
| `inputs` | slice-5f2-curl-validation.txt |
| `outputs` | evidence |
| `hardcodedVersionAssumptions` | 4.21 URLs. |
| `currentStatus` | Present, 3.5 KB, intact. Its subtitle is literally '(Corrected)' and its stated purpose is 'Actual HTTP validation attempts with honest evidence classification'. |
| `disposition` | REUSE AS-IS |
| `action422` | Methodological precedent: when direct validation is impossible, say so and state what the evidence actually supports, rather than asserting validation occurred. |
| `futureMinorValue` | High as a discipline example — it is the in-corpus instance of CLAUDE.md's 'hypothesis is not root cause' and 'edited is not fixed' rules being applied to evidence claims. |
| `requiredTestsGuards` | None. |
| `evidenceReason` | REUSE AS-IS: intact and carries durable methodological value disproportionate to its size. |

#### G3.20 `local-docs/ocp-4.21/analysis/slice-5f3-backend-test-nonpass-audit.json`

| Field | Value |
|---|---|
| `path` | local-docs/ocp-4.21/analysis/slice-5f3-backend-test-nonpass-audit.json |
| `purpose` | Structured audit of every non-passing backend test: 657 total, 643 pass, 3 fail, 3 cancelled, 8 skipped, with per-test failure message, stack/location, root cause, classification, recommended fix, whether fixed in this slice, whether the test was updated and the justification for any test update. |
| `originalRole` | Slice 5F.3 test-health audit. |
| `inputs` | backend npm test run of 2026-06-30 |
| `outputs` | evidence |
| `hardcodedVersionAssumptions` | None material. |
| `currentStatus` | Present, valid, intact. |
| `disposition` | REUSE AS-IS |
| `action422` | Schema for Tranche 6 test reporting. |
| `futureMinorValue` | High. The testUpdateJustification field is the guard against the commonest bad fix — changing the assertion instead of the behaviour — and should be mandatory in 4.22 test work. |
| `requiredTestsGuards` | None (data). |
| `evidenceReason` | REUSE AS-IS: intact, and the testUpdated/testUpdateJustification pair encodes a discipline worth carrying forward explicitly. |

#### G3.21 `local-docs/ocp-4.21/analysis/SLICE-5F3-BACKEND-TEST-NONPASS-AUDIT.md`

| Field | Value |
|---|---|
| `path` | local-docs/ocp-4.21/analysis/SLICE-5F3-BACKEND-TEST-NONPASS-AUDIT.md |
| `purpose` | Narrative of the non-pass audit; header records 643 pass, 3 fail, 3 cancelled, 8 skipped. |
| `originalRole` | Slice 5F.3 report. |
| `inputs` | the companion JSON |
| `outputs` | evidence |
| `hardcodedVersionAssumptions` | None material. |
| `currentStatus` | Present, 8.4 KB, intact. Note its figures are the pre-repair run; SLICE-5F10 records the post-repair state (649 pass, 0 fail). Not a contradiction — two different runs — but a reader must not quote them interchangeably. |
| `disposition` | REUSE AS-IS |
| `action422` | Baseline comparison for Tranche 6. |
| `futureMinorValue` | Moderate. |
| `requiredTestsGuards` | None. |
| `evidenceReason` | REUSE AS-IS: intact. |

#### G3.22 `local-docs/ocp-4.21/analysis/SLICE-5F5-PARTIAL-STATUS.md`

| Field | Value |
|---|---|
| `path` | local-docs/ocp-4.21/analysis/SLICE-5F5-PARTIAL-STATUS.md |
| `purpose` | Honest partial-completion record: 2 of 4 test failures fixed at commit 5e1b8bd, with the remaining work documented rather than glossed. |
| `originalRole` | Slice 5F.5 status. |
| `inputs` | the 5F.3 audit |
| `outputs` | evidence; input to the 5F.6 commit audit |
| `hardcodedVersionAssumptions` | None material. |
| `currentStatus` | Present, 13.6 KB, intact. |
| `disposition` | REUSE AS-IS |
| `action422` | Precedent for how to end a tranche that did not finish: state the partial state explicitly and enumerate the remainder. |
| `futureMinorValue` | High as a process example, directly supporting CLAUDE.md execution-contract rule 5 ('edited is not fixed') and rule 10 (final report maps requirement to remaining work). |
| `requiredTestsGuards` | None. |
| `evidenceReason` | REUSE AS-IS: intact and a good instance of honest incomplete reporting. |

#### G3.23 `local-docs/ocp-4.21/analysis/SLICE-5F6-FINAL-STATUS.md`

| Field | Value |
|---|---|
| `path` | local-docs/ocp-4.21/analysis/SLICE-5F6-FINAL-STATUS.md |
| `purpose` | Records Slice 5F.6 as INCOMPLETE with the stated cause 'Token budget exhausted before completing all required work', and no new commit produced. |
| `originalRole` | Slice 5F.6 closure attempt. |
| `inputs` | 5F.5 partial state |
| `outputs` | evidence |
| `hardcodedVersionAssumptions` | None material. |
| `currentStatus` | Present, 10.3 KB, intact. |
| `disposition` | REUSE AS-IS |
| `action422` | Keep. This is the most operationally important process lesson in the corpus for an agent-executed programme: a slice was sized larger than a single agent context could complete, and the failure mode was silent until this document named it. |
| `futureMinorValue` | High. It is direct evidence for Revision 3's tranche sizing and for the rule that a tranche must end with an explicit exit report rather than trailing off. |
| `requiredTestsGuards` | None. |
| `evidenceReason` | REUSE AS-IS: intact, and records a failure mode that recurs unless deliberately designed against. |

#### G3.24 `local-docs/ocp-4.21/analysis/slice-5f6-partial-commit-audit.json`

| Field | Value |
|---|---|
| `path` | local-docs/ocp-4.21/analysis/slice-5f6-partial-commit-audit.json |
| `purpose` | Per-file audit of the partial commit 5e1b8bd: four entries each with file, change summary, intended purpose, risk, keep-or-revert decision, reason and required tests. |
| `originalRole` | Slice 5F.6 commit audit. |
| `inputs` | git diff of 5e1b8bd |
| `outputs` | evidence |
| `hardcodedVersionAssumptions` | None material. |
| `currentStatus` | Present, valid, 4 entries. |
| `disposition` | REUSE AS-IS |
| `action422` | Template for auditing any partial commit that must be left in place. |
| `futureMinorValue` | Moderate. The explicit keepOrRevert decision per file is the right granularity for a partial-state handoff. |
| `requiredTestsGuards` | None (data). |
| `evidenceReason` | REUSE AS-IS: intact. |

#### G3.25 `local-docs/ocp-4.21/analysis/SLICE-5F6-PARTIAL-COMMIT-AUDIT.md`

| Field | Value |
|---|---|
| `path` | local-docs/ocp-4.21/analysis/SLICE-5F6-PARTIAL-COMMIT-AUDIT.md |
| `purpose` | Narrative audit of commit 5e1b8bd ('DOC-102 Slice 5F.5 (partial): Fix migration canonicalization and catalog schema test'). |
| `originalRole` | Slice 5F.6 report. |
| `inputs` | the companion JSON |
| `outputs` | evidence |
| `hardcodedVersionAssumptions` | None material. |
| `currentStatus` | Present, 10.9 KB, intact. |
| `disposition` | REUSE AS-IS |
| `action422` | Template for partial-commit auditing. |
| `futureMinorValue` | Moderate. |
| `requiredTestsGuards` | None. |
| `evidenceReason` | REUSE AS-IS: intact. |

#### G3.26 `local-docs/ocp-4.21/analysis/slice-5f-catalog-only-field-guide-status.json`

| Field | Value |
|---|---|
| `path` | local-docs/ocp-4.21/analysis/slice-5f-catalog-only-field-guide-status.json |
| `purpose` | Tracks Field Guide documentation status for the 11 catalog-only 4.21 parameters, with a per-parameter status, reason and future slice, plus a note explaining that Field Guide compartments document operational procedures rather than individual catalog parameters. |
| `originalRole` | Slice 5F tracking. |
| `inputs` | slice-5b candidates |
| `outputs` | evidence |
| `hardcodedVersionAssumptions` | 4.21 parameter set. |
| `currentStatus` | Present, valid, 11 parameters. |
| `disposition` | REUSE AS-IS |
| `action422` | Carry forward the stated principle: Field Guide compartments are operational procedures, so a catalog-only parameter with no UI or generation support correctly has NO Field Guide content. This prevents a 4.22 reviewer treating missing Field Guide coverage as a defect. |
| `futureMinorValue` | High — it is a boundary definition that prevents fabricated Field Guide content. |
| `requiredTestsGuards` | None (data). |
| `evidenceReason` | REUSE AS-IS: intact, and it records a scope boundary that would otherwise have to be rediscovered. |

#### G3.27 `local-docs/ocp-4.21/analysis/SLICE-5F-DOCS-URL-VALIDATION.md`

| Field | Value |
|---|---|
| `path` | local-docs/ocp-4.21/analysis/SLICE-5F-DOCS-URL-VALIDATION.md |
| `purpose` | Validation of official Red Hat 4.21 documentation URLs for Field Guide 4.21 creation. |
| `originalRole` | Slice 5F doc-URL validation. |
| `inputs` | data/docs-index/4.21.json URLs |
| `outputs` | evidence |
| `hardcodedVersionAssumptions` | 4.21 URLs. |
| `currentStatus` | Present, 5.6 KB, intact. |
| `disposition` | REUSE AS-IS |
| `action422` | Reference for the 4.22 docs-index validation, which per L4 can now use live HEAD checks because 4.22 pages return 200. |
| `futureMinorValue` | Moderate. |
| `requiredTestsGuards` | None; URL liveness is acquisition-only per R4. |
| `evidenceReason` | REUSE AS-IS: intact. |

#### G3.28 `local-docs/ocp-4.21/analysis/slice-5f-field-guide-v420-compartment-inventory.json`

| Field | Value |
|---|---|
| `path` | local-docs/ocp-4.21/analysis/slice-5f-field-guide-v420-compartment-inventory.json |
| `purpose` | v4.20 Field Guide compartment baseline for 4.21 differential review: 37 compartments across global/mirror/vsphere/baremetal/nutanix/aws/azure/ibmcloud, a differential review summary by disposition, and a map of which compartments each of the 7 new 4.21 parameters touches. |
| `originalRole` | Slice 5F Field Guide differential input. |
| `inputs` | backend/src/fieldGuide/v4.20/** |
| `outputs` | evidence |
| `hardcodedVersionAssumptions` | v4.20 compartment structure. |
| `currentStatus` | Present, valid. Records totalCompartments 37 for v4.20. Note Revision 3 2.G describes v4.21 as having 41 compartments and the certification corpus records 40; these are different counts of different things at different times and must not be conflated. |
| `disposition` | REUSE AS-IS |
| `action422` | The differential-review method — inventory the previous minor's compartments, then classify each as carry-forward-validated / update-required-for-URLs / update-required-for-URLs-and-new-params / defer — is directly reusable for the v4.21 -> v4.22 Field Guide differential in Tranche 2. |
| `futureMinorValue` | High as a method; the counts are snapshot-specific. |
| `requiredTestsGuards` | None (data). |
| `evidenceReason` | REUSE AS-IS: intact, and its four-way disposition vocabulary is directly applicable to the Class A/B/C Field Guide work in Tranche 2. |

#### G3.29 `local-docs/ocp-4.21/analysis/slice-5f-url-validation-results.json`

| Field | Value |
|---|---|
| `path` | local-docs/ocp-4.21/analysis/slice-5f-url-validation-results.json |
| `purpose` | Machine-readable results of the 35-URL validation attempt, each with url, scenario, docLabel, httpStatus, finalUrl, contentCheck, status, reason, validatedAt and durationMs. |
| `originalRole` | Slice 5F.1 evidence. |
| `inputs` | network, 2026-06-30T19:32:53Z |
| `outputs` | evidence |
| `hardcodedVersionAssumptions` | 4.21 URLs. |
| `currentStatus` | Present, valid. Verified by reading: totalUrls 35, validated 0, failed 35 — a total block, consistent with the 403 anti-bot cause rather than with 35 bad URLs. |
| `disposition` | REUSE AS-IS |
| `action422` | Keep as the structured companion to the curl transcript and as the before-state for L4's resolution at 4.22. |
| `futureMinorValue` | Moderate as data; high as the quantified form of L4. |
| `requiredTestsGuards` | None; R4 forbids network in tests. |
| `evidenceReason` | REUSE AS-IS: irreplaceable structured evidence for a named lesson. |

#### G3.30 `local-docs/ocp-4.21/analysis/SLICE-5F-URL-VALIDATION-RESULTS.md`

| Field | Value |
|---|---|
| `path` | local-docs/ocp-4.21/analysis/SLICE-5F-URL-VALIDATION-RESULTS.md |
| `purpose` | Narrative of the Slice 5F.1 URL validation with its evidence basis. |
| `originalRole` | Slice 5F.1 report. |
| `inputs` | slice-5f-url-validation-results.json |
| `outputs` | evidence |
| `hardcodedVersionAssumptions` | 4.21 URLs. |
| `currentStatus` | Present, 4.8 KB, intact. ASSET_MANIFEST.md §10 records the fallback evidence chain adopted when direct validation failed: successful PDF acquisition proves the documents exist, URL structure is validated against the pattern, and URLs derive from the validated 4.20 docs-index. |
| `disposition` | REUSE AS-IS |
| `action422` | Reference for how to justify a docs-index when direct validation is unavailable — explicitly a fallback, not a substitute. |
| `futureMinorValue` | Moderate; 4.22's 200 responses should make the fallback unnecessary. |
| `requiredTestsGuards` | None. |
| `evidenceReason` | REUSE AS-IS: intact. |

#### G3.31 `local-docs/ocp-4.21/analysis/logs/parse-go-structs.stderr.log`

| Field | Value |
|---|---|
| `path` | local-docs/ocp-4.21/analysis/logs/parse-go-structs.stderr.log |
| `purpose` | Captured stderr of the 4.21 install-config extraction run. |
| `originalRole` | Slice 2 execution evidence. |
| `inputs` | n/a |
| `outputs` | evidence |
| `hardcodedVersionAssumptions` | Contains an absolute output path under a historical home directory (/home/billstrauss/...), which no longer matches this machine's user. |
| `currentStatus` | Present, 383 bytes, intact. Verified by reading: 150 Go source files, 141 structs parsed, 525 parameter paths built, no warnings. This is the primary proof that parse-go-structs.js works. |
| `disposition` | REUSE AS-IS |
| `action422` | The practice of capturing extractor stderr is mandatory for 4.22 — it is what turns 'the script ran' into 'the script processed 150 files and emitted 525 paths with zero warnings'. |
| `futureMinorValue` | High as a practice; the specific log is 4.21 evidence. |
| `requiredTestsGuards` | The promoted extractors must continue writing a stderr log into the workspace, and the ASSET_MANIFEST generator (GAP-03) must record its counts. |
| `evidenceReason` | REUSE AS-IS: small, intact, and the only execution proof for the single most important extractor. |

#### G3.32 `local-docs/ocp-4.21/analysis/logs/parse-agent-config-structs.stderr.log`

| Field | Value |
|---|---|
| `path` | local-docs/ocp-4.21/analysis/logs/parse-agent-config-structs.stderr.log |
| `purpose` | Captured stderr of the 4.21 agent-config extraction run. |
| `originalRole` | Slice 2 execution evidence. |
| `inputs` | n/a |
| `outputs` | evidence |
| `hardcodedVersionAssumptions` | Historical absolute home-directory path. |
| `currentStatus` | Present, 675 bytes, intact. Verified by reading: 13 Go files, 8 structs, 25 parameter paths, no warnings, and a listing of the five top-level agent-config parameters (additionalNTPSources, rendezvousIP, bootArtifactsBaseURL, hosts, minimalISO), all optional. |
| `disposition` | REUSE AS-IS |
| `action422` | Same practice requirement as above. The top-level parameter listing is a useful cheap sanity check to repeat at 4.22. |
| `futureMinorValue` | High as a practice. |
| `requiredTestsGuards` | As above. |
| `evidenceReason` | REUSE AS-IS: small, intact, execution proof. |

---

## G4 — 4.21 Field Guide certification

**Root:** `local-docs/ocp-4.21/field-guide-certification/` · **Plan count:** 8 · **Actual:** 8 · ✅ matches

> A self-contained certification corpus under audit id FG-4.21-0-FINAL. Collectively the most methodologically mature material in the harvest, and it already contains an explicit 4.22 onboarding gate specification.

| # | path | disposition | currentStatus (summary) |
|---:|---|---|---|
| 1 | `local-docs/ocp-4.21/field-guide-certification/evidence-model.json` | **REUSE AS-IS** | Present, valid, intact, and directly on point for this effort. |
| 2 | `local-docs/ocp-4.21/field-guide-certification/compartment-certification-matrix.json` | **REUSE AS-IS** | Present, valid, intact, with self-checking arithmetic on every axis. |
| 3 | `local-docs/ocp-4.21/field-guide-certification/command-audit.json` | **REUSE AS-IS** | Present, valid, intact. Records minorDependentCommands as an empty list — a strong verified negative. |
| 4 | `local-docs/ocp-4.21/field-guide-certification/version-state-matrix.json` | **REUSE AS-IS** | Present, valid, intact. States the root cause verbatim: 'assembler.js uses ctx.versionMajorMinor (from patchVersion fallback) for compartment selectio… |
| 5 | `local-docs/ocp-4.21/field-guide-certification/cross-version-defect-analysis.json` | **REUSE AS-IS** | Present, valid, intact. |
| 6 | `local-docs/ocp-4.21/field-guide-certification/stale-literal-accounting.json` | **REUSE AS-IS** | Present, valid, intact, arithmetic self-consistent. |
| 7 | `local-docs/ocp-4.21/field-guide-certification/template-audit.json` | **REUSE AS-IS** | Present, valid, intact. usedButUndefined count is zero — a clean verified negative meaning no compartment references an undefined template variable. |
| 8 | `local-docs/ocp-4.21/field-guide-certification/source-manifest.json` | **REUSE AS-IS** | Present, valid, intact. |

#### G4.1 `local-docs/ocp-4.21/field-guide-certification/evidence-model.json`

| Field | Value |
|---|---|
| `path` | local-docs/ocp-4.21/field-guide-certification/evidence-model.json |
| `purpose` | Schema-versioned machine-readable certification state. Declares itself the 'Evidence Model for onboard-field-guide 4.22 --previous 4.21' and contains: compartment registry (v4.20 vs v4.21 totals, new/removed/shared, item and command counts), three classification axes, four certification levels, a versionOnboarding422 block with Gate A (onboarding readiness) and Gate B (support enablement), source mapping, five implementation tranches, a 32-item retrospective-harvest required-coverage list, and a documentation checkpoint policy. |
| `originalRole` | FG-4.21-0 final evidence model — written explicitly to support the next minor's onboarding. |
| `inputs` | the full 4.21 Field Guide certification pass |
| `outputs` | the 4.22 onboarding gate definition |
| `hardcodedVersionAssumptions` | supportedVersions [4.20, 4.21], baselineVersion 4.20, currentVersion 4.21. Gate B's action says 'Expand SUPPORTED_VERSIONS in assembler.js to include 4.22', which is a STALE code reference — the live list is FIELD_GUIDE_SUPPORTED_MINORS in backend/src/fieldGuide/versionResolution.js, and Revision 3 Tranche 5 enumerates eight separate boundaries that must flip together, not one. |
| `currentStatus` | Present, valid, intact, and directly on point for this effort. |
| `disposition` | REUSE AS-IS |
| `action422` | Treat Gate A / Gate B as a PRE-EXISTING, independently authored statement of the fail-closed enablement rule and reconcile it against Revision 3's Tranche 4/5 gate. Where they agree (4.22 must remain unsupported throughout all preparatory work; enablement only after enumerated acceptance), that is independent corroboration. Where Gate B names a single assembler.js edit, Revision 3's eight-boundary atomic list supersedes it and the stale reference must be corrected when this content is promoted. |
| `futureMinorValue` | Very high. It is a machine-readable minor-onboarding contract, which is exactly the durable artifact O4 asks for, and it generalises to 4.23. |
| `requiredTestsGuards` | When promoted into tracked docs, the Gate B boundary list must be reconciled with the actual code boundaries, and a guard should assert the documented boundary set matches the enumerated flip list. |
| `evidenceReason` | REUSE AS-IS: intact and uniquely valuable. The stale assembler.js reference is recorded as a correction to apply on promotion, not a reason to discard an otherwise sound onboarding contract. |

#### G4.2 `local-docs/ocp-4.21/field-guide-certification/compartment-certification-matrix.json`

| Field | Value |
|---|---|
| `path` | local-docs/ocp-4.21/field-guide-certification/compartment-certification-matrix.json |
| `purpose` | Per-compartment certification matrix across 40 compartments, 510 items and 257 commands: Axis A source delta (unchanged/changed/new/not-yet-compared), Axis B implementation status (current / stale-label / factually-incorrect / stale-command / source-verification-required / intentional-cross-version), app content delta, template variable reconciliation, and four certification-status levels — each dimension carrying its own checkPasses arithmetic assertion. |
| `originalRole` | FG-4.21-0 central certification artifact. |
| `inputs` | v4.20 and v4.21 compartment sources plus extracted documentation text |
| `outputs` | the certification status of record |
| `hardcodedVersionAssumptions` | baselineVersion 4.20, targetVersion 4.21; counts are snapshot-specific. |
| `currentStatus` | Present, valid, intact, with self-checking arithmetic on every axis. |
| `disposition` | REUSE AS-IS |
| `action422` | Adopt the two-axis model wholesale for the v4.22 Field Guide. Axis A (did the SOURCE change) separated from Axis B (is our IMPLEMENTATION current) is precisely the distinction Revision 3 2.H's Class A/B/C scheme needs in order to be auditable, and the IMPLEMENTATION_INTENTIONAL_CROSS_VERSION bucket is the formal home for Class C statements that must never be mechanically bumped. |
| `futureMinorValue` | Very high. The built-in checkPasses arithmetic is a pattern worth copying everywhere: a classification table that validates its own totals cannot silently lose rows. |
| `requiredTestsGuards` | The 4.22 equivalent must carry the same arithmetic self-checks, and a test should assert every compartment appears in exactly one Axis A and one Axis B bucket. |
| `evidenceReason` | REUSE AS-IS: intact, self-validating, and the model directly serves Tranche 2's Field Guide work. |

#### G4.3 `local-docs/ocp-4.21/field-guide-certification/command-audit.json`

| Field | Value |
|---|---|
| `path` | local-docs/ocp-4.21/field-guide-certification/command-audit.json |
| `purpose` | Runtime enumeration of all 257 commands across the 40 v4.21 compartments, classified by version dependence and customization, with arithmetic checks, an explicit list of the 4 patch-dependent commands (file, compartment, line, variable, interpolation points, usage), a confirmed-empty minor-dependent list, a version-interpolation summary, and a priorReportCorrections block. |
| `originalRole` | FG-4.21-0 command audit. |
| `inputs` | all v4.21 compartment sources, enumerated at runtime and verified by reading each file |
| `outputs` | evidence |
| `hardcodedVersionAssumptions` | v4.21 compartment set. |
| `currentStatus` | Present, valid, intact. Records minorDependentCommands as an empty list — a strong verified negative. |
| `disposition` | REUSE AS-IS |
| `action422` | The empty minor-dependent-command result is the evidence base for Revision 3 2.H's claim that the binary-download contract is already templated and survives a copy verbatim. Re-run the audit for v4.22 and the expected result is again zero minor-dependent commands; a nonzero result is a signal that someone hardcoded a version into a command. |
| `futureMinorValue` | High. 'Zero minor-dependent commands' is a durable invariant worth asserting rather than re-deriving. |
| `requiredTestsGuards` | A v4.22 Field Guide test asserting no command string contains a hardcoded minor literal outside the templated {{version}} / {{versionMajorMinor}} mechanism. |
| `evidenceReason` | REUSE AS-IS: intact, and its priorReportCorrections block (recording that an earlier count of 2 minor-dependent commands was wrong and is actually 0) is itself a model of honest correction. |

#### G4.4 `local-docs/ocp-4.21/field-guide-certification/version-state-matrix.json`

| Field | Value |
|---|---|
| `path` | local-docs/ocp-4.21/field-guide-certification/version-state-matrix.json |
| `purpose` | Cases A through E plus an inverse case, each enumerating a combination of version-resolution sources and the resulting guide behaviour; plus an architecture block and a named root cause. |
| `originalRole` | FG-4.21-0 version-resolution safety analysis; input to tranche FG-4.21-B. |
| `inputs` | assembler.js, the version resolution chain |
| `outputs` | three proposed fix options |
| `hardcodedVersionAssumptions` | Analyses 4.20/4.21 resolution paths. |
| `currentStatus` | Present, valid, intact. States the root cause verbatim: 'assembler.js uses ctx.versionMajorMinor (from patchVersion fallback) for compartment selection. The canonical minor from getOpenShiftMinorFromSources only feeds into channel. When these disagree, guide content is internally inconsistent.' Whether this has since been remediated is NOT established by this harvest and must be re-verified before any Field Guide edit (R5). |
| `disposition` | REUSE AS-IS |
| `action422` | Highest-priority carry-forward in this group. A compartment-selection path that can disagree with the canonical resolved minor is a direct fallback vector, and CLAUDE.md's no-fallback rule plus L2 ('never add a default: branch to assembler.js') make it load-bearing. Tranche 3 or 5 must re-verify the current state against live code before touching the assembler. |
| `futureMinorValue` | Very high. Adding a third supported minor increases the number of ways two version sources can disagree. |
| `requiredTestsGuards` | A test per matrix case asserting compartment selection and resolved channel agree, and that disagreement fails closed rather than silently selecting a compartment set. |
| `evidenceReason` | REUSE AS-IS: intact, names a specific mechanism with a specific file, and is the kind of finding that is expensive to rediscover and cheap to retain. |

#### G4.5 `local-docs/ocp-4.21/field-guide-certification/cross-version-defect-analysis.json`

| Field | Value |
|---|---|
| `path` | local-docs/ocp-4.21/field-guide-certification/cross-version-defect-analysis.json |
| `purpose` | Five cross-version factual defects, each with id, platform, affected compartments, the 4.20 source statement, the 4.21 source statement, the source delta, the Field Guide text at both versions, correctness booleans for each version, defect type, fix, owning tranche, files, lines and edit count. Includes an AMI comparison block. |
| `originalRole` | FG-4.21-0 defect analysis. |
| `inputs` | pdftotext extractions of official 4.20 and 4.21 documentation compared against Field Guide item text |
| `outputs` | defect list feeding implementation tranches |
| `hardcodedVersionAssumptions` | 4.20/4.21 comparison. |
| `currentStatus` | Present, valid, intact. |
| `disposition` | REUSE AS-IS |
| `action422` | Its METHOD is the Class B procedure Revision 3 2.H requires: extract both minors' official text, diff the source statements, then separately judge whether the app's text was correct for each minor. Recording correctFor420 and correctFor421 independently is what distinguishes 'the source changed' from 'we were always wrong', and that distinction decides whether a fix is a bump or a correction. |
| `futureMinorValue` | Very high as a method. |
| `requiredTestsGuards` | Each resolved defect should leave behind a stale-label test pinning the corrected string, consistent with the existing Class C stale-label test pattern. |
| `evidenceReason` | REUSE AS-IS: intact, and it is the only artifact in the corpus that separates source change from implementation error as first-class, independently recorded facts. |

#### G4.6 `local-docs/ocp-4.21/field-guide-certification/stale-literal-accounting.json`

| Field | Value |
|---|---|
| `path` | local-docs/ocp-4.21/field-guide-certification/stale-literal-accounting.json |
| `purpose` | Exhaustive accounting of version literals in Field Guide sources: 22 source lines, 25 literal occurrences, split into intentional versus requiring-correction, further split into mechanical versus source-verification-required, with arithmetic reconciliation, a user-facing versus JSDoc-comment-only split, two named individual resolutions, and a post-tranche projection. |
| `originalRole` | FG-4.21-0 stale-literal inventory. |
| `inputs` | v4.21 Field Guide sources |
| `outputs` | scoped edit lists per tranche |
| `hardcodedVersionAssumptions` | Counts specific to the v4.21 source tree. |
| `currentStatus` | Present, valid, intact, arithmetic self-consistent. |
| `disposition` | REUSE AS-IS |
| `action422` | Produce the v4.22 equivalent. Two distinctions must carry forward: intentional-cross-version versus requiring-correction (the Class C protection), and rendered-user-facing versus JSDoc-comment-only (so effort is spent where users can actually see it). |
| `futureMinorValue` | High. Literal-by-literal accounting with reconciling arithmetic is the only way to assert a version sweep is complete rather than merely extensive. |
| `requiredTestsGuards` | The v4.22 Field Guide test asserting zero raw 4.21 literals outside an enumerated Class C allowlist, as Revision 3 Tranche 2 requires. |
| `evidenceReason` | REUSE AS-IS: intact, and the intentional-versus-stale distinction is precisely what prevents a mechanical sweep destroying deliberate cross-version statements. |

#### G4.7 `local-docs/ocp-4.21/field-guide-certification/template-audit.json`

| Field | Value |
|---|---|
| `path` | local-docs/ocp-4.21/field-guide-certification/template-audit.json |
| `purpose` | Template variable reconciliation: engine file and interpolation regex, context builder with 45 total keys, 26 used-and-defined variables, a confirmed-zero used-but-undefined set, 19 defined-but-unused, and dedicated analyses of the minor, channel and version variables including a patch-precision warning and a correction to a prior claim about the minor variable's role. |
| `originalRole` | FG-4.21-0 template audit. |
| `inputs` | the Field Guide template engine and context builder |
| `outputs` | evidence |
| `hardcodedVersionAssumptions` | None material; it audits the mechanism, not a minor. |
| `currentStatus` | Present, valid, intact. usedButUndefined count is zero — a clean verified negative meaning no compartment references an undefined template variable. |
| `disposition` | REUSE AS-IS |
| `action422` | Re-run for v4.22. A used-but-undefined variable renders as a literal placeholder in user-facing output, so zero is an invariant worth asserting rather than hoping for. The patch-precision warning on the version variable matters directly for Revision 3's Include Tools behaviour, where install must pin an exact patch while oc-mirror must not. |
| `futureMinorValue` | High. |
| `requiredTestsGuards` | A test asserting every {{variable}} appearing in any compartment is present in the context builder's key set — cheap, and it makes the zero permanent. |
| `evidenceReason` | REUSE AS-IS: intact, mechanism-level rather than minor-level, and it audits the exact substitution machinery that lets the binary-download contract survive a version copy unchanged. |

#### G4.8 `local-docs/ocp-4.21/field-guide-certification/source-manifest.json`

| Field | Value |
|---|---|
| `path` | local-docs/ocp-4.21/field-guide-certification/source-manifest.json |
| `purpose` | Source provenance for the certification pass: official PDFs (status, count, location, 12 filenames), extracted text (status, count, location, method, and an explicit matchesV420Method boolean), installer source (repository, branch, location, 6 platforms), installer delta artifacts, oc-mirror binary/source/documentation, and release notes status. |
| `originalRole` | FG-4.21-0 source manifest, generated 2026-08-17. |
| `inputs` | the acquisition workspace |
| `outputs` | provenance of record for the certification |
| `hardcodedVersionAssumptions` | targetMinor 4.21, baselineMinor 4.20. |
| `currentStatus` | Present, valid, intact. |
| `disposition` | REUSE AS-IS |
| `action422` | This is the closest thing in the corpus to the generated ASSET_MANIFEST that GAP-03 calls for: it is already machine-readable and already carries a methodology-equivalence assertion (matchesV420Method). Use it as the schema for the generated 4.22 manifest rather than the hand-written markdown ASSET_MANIFEST.md. |
| `futureMinorValue` | Very high — it is the template for the missing manifest generator. |
| `requiredTestsGuards` | The generator must emit this schema and must fail if any declared asset is missing or hash-mismatched. |
| `evidenceReason` | REUSE AS-IS: intact, and the matchesV420Method field is a notable idea — asserting not just what was acquired but that it was acquired the same way as the baseline, which is what makes a cross-minor comparison legitimate. |

---

## G5 — Runbook and provenance

**Root:** `local-docs/` · **Plan count:** 2 · **Actual:** 2 · ✅ matches

| # | path | disposition | currentStatus (summary) |
|---:|---|---|---|
| 1 | `local-docs/AUDIT_AUTOMATION_GUIDE.md` | **REPLACE** | Untracked, single copy, and materially wrong in four ways. (1) It PRESCRIBES the copy-and-sed fork that O4 exists to eliminate and that produced every… |
| 2 | `local-docs/ocp-4.21/ASSET_MANIFEST.md` | **PARAMETERIZE** | Present, intact, and unusually high quality for a hand-written document: SHA256 for every asset, the installer pinned at 1accb6487cf3784561665c08048dd… |

#### G5.1 `local-docs/AUDIT_AUTOMATION_GUIDE.md`

| Field | Value |
|---|---|
| `path` | local-docs/AUDIT_AUTOMATION_GUIDE.md |
| `purpose` | The 1,274-line minor-onboarding runbook: when to run an audit, prerequisites, a three-phase process with per-step commands and expected outputs, troubleshooting, four audit deliverable templates, false-positive filtering rules, lessons learned (what worked, what did not, critical decisions), five named pitfalls with solutions, an authoritative-source precedence ranking, effort estimates, success criteria, a five-phase checklist and a key-scripts quick reference. |
| `originalRole` | THE durable process artifact of the whole programme — written after 4.20 specifically so 4.21 would take 1-2 weeks instead of 3-4, and the document the 4.21 effort actually followed. |
| `inputs` | the 4.20 audit experience |
| `outputs` | the 4.21 process |
| `hardcodedVersionAssumptions` | Pervasive. 4.20 as the source of scripts, 4.21 as the worked example, and most consequentially the fork instruction itself: 'cp local-docs/ocp-4.20/scripts/... local-docs/ocp-4.21/scripts/...' followed by 'sed -i s/4.20/4.21/g' (§1.2), and 'Copy to new version: cp -r local-docs/ocp-4.20/scripts local-docs/ocp-4.21/scripts' (§Quick Reference). |
| `currentStatus` | Untracked, single copy, and materially wrong in four ways. (1) It PRESCRIBES the copy-and-sed fork that O4 exists to eliminate and that produced every divergence in groups G1 and G2, including the false 4.21 provenance in extract-oc-mirror-params-manual.js. (2) Its source precedence is 'Installer Source Code (HIGHEST AUTHORITY) > Installer Binary Behavior > OpenShift Documentation > Existing Catalogs', with 'When docs conflict with installer code, trust installer code' stated unconditionally — directly contradicted by O1, which gives Red Hat product documentation authority over user-facing SUPPORTEDNESS while installer source owns mechanical schema reality. (3) Its §3.3 sync verification uses the vanished flat frontend path (md5sum ... frontend/src/data/catalogs/bare-metal-ipi.json). (4) It prescribes PDF table extraction while WEB_EXTRACTION_PLAN.md had already recorded HTML scraping as the replacement after a 91% path-building error rate. |
| `disposition` | REPLACE |
| `action422` | Replace with a tracked docs/minor-release/MINOR_ONBOARDING_RUNBOOK.md (O4). It must: open with the cumulative-minor-support rule as rule #1 and contain NO removal step in the add-a-minor procedure (R8, §1.0); carry the corrected O1 source hierarchy; invoke scripts/minor/** with a --minor argument and contain no cp/sed fork step anywhere; use versioned catalog paths; and preserve verbatim the content listed below, which is the genuinely durable part. |
| `futureMinorValue` | The DOCUMENT's structure and hard-won lessons are the highest-value prose in the harvest. Its PROCEDURE is actively harmful and must not be carried forward. |
| `requiredTestsGuards` | A docs guard asserting the tracked runbook contains no 'sed -i' fork instruction and no flat frontend catalog path; the R8 cumulative-support guard it must reference. |
| `evidenceReason` | REPLACE with a named positive replacement (the tracked runbook above). Not PARAMETERIZE, because the defect is not that the document names a version — it is that the core procedure (fork by copy-and-sed) and the core authority rule (code beats docs unconditionally) are both wrong and both have already caused recorded harm. Not RETIRE, because roughly a third of the document is irreplaceable domain knowledge, enumerated in mustSurviveVerbatim so nothing is lost in the replacement. |
| `mustSurviveVerbatim` | Expect a ~67% false-positive rate on raw comparison; platform applicability is the largest single source. · Catalogs may legitimately be stricter than Go structs; a stricter catalog is not a defect. · Go type aliases serialize as primitives in YAML (AWSLBType/CloudEnvironment/ProvisioningNetwork/DiskType -> string; ipnet.IPNet -> string in CIDR notation). Catalogs describe YAML, not Go. · Two-tier deprecation: P0 remove when the field breaks functionality or creates deprecated resources; P1 mark when it still works but is deprecated. · Never remove a parameter on 'it looks old' / 'docs do not mention it' / 'I think it is deprecated' — require an installer-source Deprecated: comment AND a replacement already present in the catalog. · PDF extraction succeeds only ~60-70% of the time and breaks when Red Hat changes document formatting. · Nested-struct extraction is shallow; deeply nested paths need manual inspection. · Conditional requiredness cannot be detected from struct tags; validation functions must be read. · Defaults applied at runtime live in pkg/asset/installconfig and are not visible in struct tags. · 100% automation is not achievable; filtering rules need human judgement and edge cases need domain knowledge. |

#### G5.2 `local-docs/ocp-4.21/ASSET_MANIFEST.md`

| Field | Value |
|---|---|
| `path` | local-docs/ocp-4.21/ASSET_MANIFEST.md |
| `purpose` | The 533-line 4.21 provenance record: acquisition summary, repository context with commit, 12 documentation PDFs with sizes and SHA256s, installer source with branch and pinned commit, 6 binary/metadata assets with SHA256s, verbatim tool version outputs, the script-copy record including the exact sed command, extraction outputs with exit codes and parameter counts, missing assets, risks, a sensitive-data assessment, integrity verification commands, and per-slice completion status for slices 1, 2, 3, 4, 4B and 5F.1. |
| `originalRole` | The single provenance artifact for the 4.21 acquisition. Revision 3 2.A notes correctly that no generator exists for it. |
| `inputs` | manual authoring during each slice |
| `outputs` | the provenance of record |
| `hardcodedVersionAssumptions` | Entirely 4.21-specific, as a provenance record should be. |
| `currentStatus` | Present, intact, and unusually high quality for a hand-written document: SHA256 for every asset, the installer pinned at 1accb6487cf3784561665c08048dde20ad672c39, verbatim openshift-install (4.21.20) and oc-mirror (4.21.0 component-versioned) outputs, copy-pasteable verification commands, and honest in-place corrections (§10 reverses the earlier 'vSphere PDF unavailable' conclusion). Its weakness is that it is hand-maintained: §16 claims CATALOG_GAP_ANALYSIS.md is '400+ lines' when that file is now a 22-line tombstone, so the manifest has drifted from the tree it describes. |
| `disposition` | PARAMETERIZE |
| `action422` | Become the specification for the generated per-minor manifest (GAP-03), emitted in the machine-readable shape of field-guide-certification/source-manifest.json with this document's field coverage. Generation removes the drift class demonstrated by the '400+ lines' claim. |
| `futureMinorValue` | Very high. It is simultaneously the best available example of what a minor's provenance record must contain and the proof that hand-maintaining it does not hold. |
| `requiredTestsGuards` | The generator must fail closed on a missing asset, an unparseable or absent checksum, or a hash mismatch — mirroring the external-tool policy in CLAUDE.md. A consistency check should verify every file the manifest describes exists with the recorded hash. |
| `evidenceReason` | PARAMETERIZE rather than REPLACE: the document's CONTENT MODEL is correct and should be preserved almost field for field; only its production method (hand authoring) must change. Not REUSE AS-IS, because hand maintenance has already produced a documented drift. |
| `mustSurviveVerbatim` | oc-mirror uses component versioning (4.21.0) while openshift-install uses patch versioning (4.21.20). This is expected and is NOT a discrepancy — and it is the concrete precedent for CLAUDE.md's rule that a tool's version is not a statement about target support. · The correct vSphere PDF filename is Installing_on_VMware_vSphere, not Installing_on_vSphere. · Direct HTTP validation of docs.redhat.com returned 403 for all 35 URLs due to anti-bot protection; successful PDF acquisition was used as the fallback evidence that the documents exist. · Scripts were adapted by sed and the manifest itself warns 'manual review recommended before execution' — a warning that was not heeded, as the uncorrected vSphere filename and the false oc-mirror provenance both show. |

---

## G6 — 4.20 phase records and platform audits

**Root:** `local-docs/ocp-4.20/` · **Plan count:** 13 · **Actual:** 14 · ⚠ **does not match**

> **Count discrepancy.** Revision 3 §3.0 states 13 but enumerates 7 named top-level documents plus 'platform-audits/ (7 per-scenario doc-review plans)' = 14. The filesystem confirms 7 + 7 = 14. All 14 are rowed; see discrepancy D3.

| # | path | disposition | currentStatus (summary) |
|---:|---|---|---|
| 1 | `local-docs/ocp-4.20/PHASE_1_COMPLETION.md` | **REUSE AS-IS** | Present, 269 lines, intact. |
| 2 | `local-docs/ocp-4.20/PHASE_2_COMPLETE.md` | **REUSE AS-IS** | Present, 401 lines, intact. |
| 3 | `local-docs/ocp-4.20/PHASE_2_1_COMPLETION.md` | **REUSE AS-IS** | Present, 321 lines, intact. Two load-bearing facts verified by reading: pdftotext is the conversion tool and the step is manual (GAP-01), and the pars… |
| 4 | `local-docs/ocp-4.20/PHASE_2.4_COMPLETE.md` | **REUSE AS-IS** | Present, 485 lines, intact. |
| 5 | `local-docs/ocp-4.20/PHASE_2_EXECUTIVE_SUMMARY.md` | **REUSE AS-IS** | Present, 639 lines, intact. Source of the 67% false-positive metric (340 of 502) that Revision 3 §3.0 cites as the justification for this entire harve… |
| 6 | `local-docs/ocp-4.20/OC-MIRROR_CATALOG_COMPLETE.md` | **REUSE AS-IS** | Present, 339 lines, intact. The catalog it describes still exists at data/params/4.20/oc-mirror-v2.json and is the 13th file there, while data/params/… |
| 7 | `local-docs/ocp-4.20/WEB_EXTRACTION_PLAN.md` | **REUSE AS-IS** | Present, 163 lines, intact. Records the decisive metric verbatim: PDF parsing had a '91% path-building error rate (283/311 malformed)' because two-col… |
| 8 | `local-docs/ocp-4.20/platform-audits/BARE_METAL_4_20_AGENT_DOC_REVIEW_AND_PLAN.md` | **REUSE AS-IS** | Present, 148 lines, intact. Declares its own authority correctly: working doc, with docs/BACKLOG_STATUS.md as canonical status and docs/SCENARIOS_GUID… |
| 9 | `local-docs/ocp-4.20/platform-audits/BARE_METAL_4_20_IPI_DOC_REVIEW_AND_PLAN.md` | **REUSE AS-IS** | Present, 119 lines, intact — the most concise of the seven. Unlike its siblings it uses a single H2 heading, so its internal structure is flatter. |
| 10 | `local-docs/ocp-4.20/platform-audits/BARE_METAL_4_20_UPI_DOC_REVIEW_AND_PLAN.md` | **REUSE AS-IS** | Present, 154 lines, intact. Contains a dedicated 'Field-by-field classification (disputed UPI fields)' section. |
| 11 | `local-docs/ocp-4.20/platform-audits/NUTANIX_4_20_IPI_DOC_REVIEW_AND_PLAN.md` | **REUSE AS-IS** | Present, 219 lines, intact. |
| 12 | `local-docs/ocp-4.20/platform-audits/VSPHERE_4_20_AGENT_DOC_REVIEW_AND_PLAN.md` | **REUSE AS-IS** | Present, 224 lines, intact. Notably honest: it states enforcement is closed for the named areas but explicitly declines a blanket doc-truth claim, lis… |
| 13 | `local-docs/ocp-4.20/platform-audits/VSPHERE_4_20_IPI_DOC_REVIEW_AND_PLAN.md` | **REUSE AS-IS** | Present, 912 lines, intact. |
| 14 | `local-docs/ocp-4.20/platform-audits/VSPHERE_4_20_UPI_DOC_REVIEW_AND_PLAN.md` | **REUSE AS-IS** | Present, 259 lines, intact. The only platform audit with an explicit 'Phase D — Automation assessment' section, making it the nearest prior art to thi… |

#### G6.1 `local-docs/ocp-4.20/PHASE_1_COMPLETION.md`

| Field | Value |
|---|---|
| `path` | local-docs/ocp-4.20/PHASE_1_COMPLETION.md |
| `purpose` | Records 4.20 Phase 1: workspace creation, 12 PDFs downloaded (28 MB), installer source and binaries collected; plus success criteria, key findings, timeline, storage impact and lessons learned. |
| `originalRole` | 4.20 Phase 1 closure record, 2026-05-20, ~30 minutes. |
| `inputs` | the Phase 1 work |
| `outputs` | evidence |
| `hardcodedVersionAssumptions` | 4.20 throughout; also an absolute path under a historical home directory. |
| `currentStatus` | Present, 269 lines, intact. |
| `disposition` | REUSE AS-IS |
| `action422` | Reference for acquisition sizing. It records an oc-mirror deprecation warning observed at 4.20, which is the first appearance of the v1-deprecation thread that reaches 'oc adm release mirror deprecated in 4.22' in Revision 3 2.D. |
| `futureMinorValue` | Moderate — realistic effort and storage figures for the acquisition step. |
| `requiredTestsGuards` | None. |
| `evidenceReason` | REUSE AS-IS: intact historical record, costs nothing to retain, and carries the earliest datapoint on a live deprecation thread. |

#### G6.2 `local-docs/ocp-4.20/PHASE_2_COMPLETE.md`

| Field | Value |
|---|---|
| `path` | local-docs/ocp-4.20/PHASE_2_COMPLETE.md |
| `purpose` | Records 4.20 Phase 2: 502 parameters extracted (477 install-config from 130 structs + 25 agent-config) against 195-parameter catalogs; 27% true coverage after normalization; 73% gap; 60 metadata discrepancies; 59 catalog-only parameters. Includes four named parser issues and their resolutions. |
| `originalRole` | 4.20 Phase 2 closure record. |
| `inputs` | the extraction and comparison runs |
| `outputs` | evidence |
| `hardcodedVersionAssumptions` | 4.20 counts throughout. |
| `currentStatus` | Present, 401 lines, intact. |
| `disposition` | REUSE AS-IS |
| `action422` | Its four recorded parser issues — missed embedded pointer fields, failed type inference for RootDeviceHints, path notation mismatch, external package dependencies — are the known-limitations list for parse-go-structs.js and should be re-checked rather than rediscovered when it is promoted. |
| `futureMinorValue` | High. A named list of a tool's known failure modes is exactly what prevents each minor rediscovering them. |
| `requiredTestsGuards` | The promoted extractor's golden fixtures should cover all four recorded issues. |
| `evidenceReason` | REUSE AS-IS: intact, and the parser-issues section is directly actionable for the 0A-1 promotion work. |

#### G6.3 `local-docs/ocp-4.20/PHASE_2_1_COMPLETION.md`

| Field | Value |
|---|---|
| `path` | local-docs/ocp-4.20/PHASE_2_1_COMPLETION.md |
| `purpose` | Records 4.20 Phase 2.1 documentation extraction: 12 PDFs converted with pdftotext to 6.1 MB of text, the parser's handled and unhandled documentation patterns, four named parser limitations, and a three-iteration refinement history. |
| `originalRole` | 4.20 Phase 2.1 closure record, ~4 hours. |
| `inputs` | the PDF extraction work |
| `outputs` | evidence |
| `hardcodedVersionAssumptions` | 4.20 filenames and sizes. |
| `currentStatus` | Present, 321 lines, intact. Two load-bearing facts verified by reading: pdftotext is the conversion tool and the step is manual (GAP-01), and the parser refinement history records 'Iteration 1: Table-based parser (FAILED)' — the authority for retiring parse-parameter-tables.js. |
| `disposition` | REUSE AS-IS |
| `action422` | Primary evidence for GAP-01 (no scripted PDF-to-text step) and for the parse-parameter-tables.js retirement. |
| `futureMinorValue` | High. An explicit record of which parser iterations failed is what stops a future agent resurrecting iteration 1 because the file is still sitting there. |
| `requiredTestsGuards` | None. |
| `evidenceReason` | REUSE AS-IS: intact, and it supplies the positive justification for a RETIRE decision elsewhere in this ledger. |

#### G6.4 `local-docs/ocp-4.20/PHASE_2.4_COMPLETE.md`

| Field | Value |
|---|---|
| `path` | local-docs/ocp-4.20/PHASE_2.4_COMPLETE.md |
| `purpose` | Records 4.20 Phase 2.4 oc-mirror extraction: 51 ImageSetConfiguration parameters from Table 5.3; confirms ImageSetConfiguration and InstallConfig are distinct resources; resolves all 59 catalog-only parameters into named categories (3 system fields, 2 arbiter, 35 agent networkConfig NMState, 8 path-normalization matches, 11 platform variants); records API version evolution and deprecated v1 parameters. |
| `originalRole` | 4.20 Phase 2.4 closure record, 2 hours. |
| `inputs` | the oc-mirror extraction |
| `outputs` | evidence; the basis for the 4.20 oc-mirror catalog |
| `hardcodedVersionAssumptions` | 4.20 table numbering and counts. |
| `currentStatus` | Present, 485 lines, intact. |
| `disposition` | REUSE AS-IS |
| `action422` | Direct input to O2. It establishes the separation of concerns O2 must preserve (ImageSetConfiguration is not install-config, hence the outputFile distinction) and it resolves the catalog-only parameter mystery with named categories rather than speculation — the 35 agent networkConfig entries following an external NMState schema is the fact that explains why those paths will never appear in installer Go structs. |
| `futureMinorValue` | High. 'Catalog-only parameters are not an error, here is what each category actually is' is durable knowledge that prevents a future audit trying to delete them. |
| `requiredTestsGuards` | The O2 validation must preserve the outputFile distinction this document establishes. |
| `evidenceReason` | REUSE AS-IS: intact, and it supplies O2's conceptual foundation. |

#### G6.5 `local-docs/ocp-4.20/PHASE_2_EXECUTIVE_SUMMARY.md`

| Field | Value |
|---|---|
| `path` | local-docs/ocp-4.20/PHASE_2_EXECUTIVE_SUMMARY.md |
| `purpose` | The 639-line audit executive summary: 553 parameters from authoritative sources against 195-parameter catalogs, 27% coverage, 73% gap, 30% catalog-only, 60 metadata discrepancies, 10+ missing required parameters; business impact and severity; five detailed findings; extraction confidence levels and parser accuracy; repository impact; and prioritized P0/P1/P2 recommendations. |
| `originalRole` | 4.20 Phase 2 executive summary — the document AUDIT_AUTOMATION_GUIDE.md names as the single most important reading for the next audit. |
| `inputs` | all Phase 2 outputs |
| `outputs` | the prioritization that drove 4.20 implementation |
| `hardcodedVersionAssumptions` | 4.20 counts. |
| `currentStatus` | Present, 639 lines, intact. Source of the 67% false-positive metric (340 of 502) that Revision 3 §3.0 cites as the justification for this entire harvest gate. |
| `disposition` | REUSE AS-IS |
| `action422` | The quantified expectations — ~67% false-positive rate, platform applicability as the dominant cause, and the data-quality/confidence-level framing — are the calibration a 4.22 reviewer needs before looking at a raw comparison. |
| `futureMinorValue` | Very high. It is the numerical basis for the harvest gate itself. |
| `requiredTestsGuards` | None. |
| `evidenceReason` | REUSE AS-IS: intact and explicitly named by the runbook as critical reading. Its headline metric is load-bearing for Revision 3 §3.0. |

#### G6.6 `local-docs/ocp-4.20/OC-MIRROR_CATALOG_COMPLETE.md`

| Field | Value |
|---|---|
| `path` | local-docs/ocp-4.20/OC-MIRROR_CATALOG_COMPLETE.md |
| `purpose` | Records creation of the 4.20 oc-mirror v2 catalog: 45 parameters (51 extracted minus 6 deprecated storageConfig.* entries), backend and frontend byte-identical by MD5, complete metadata on every parameter, parameter breakdown by section, catalog format, documentation references, current and recommended future integration, and validation against source. |
| `originalRole` | 4.20 oc-mirror catalog creation record. |
| `inputs` | oc-mirror-v2-params.json |
| `outputs` | data/params/4.20/oc-mirror-v2.json (still present today) |
| `hardcodedVersionAssumptions` | 4.20; and it records the frontend copy at the now-vanished flat path frontend/src/data/catalogs/oc-mirror-v2.json. |
| `currentStatus` | Present, 339 lines, intact. The catalog it describes still exists at data/params/4.20/oc-mirror-v2.json and is the 13th file there, while data/params/4.21/ has 12 files and no oc-mirror catalog — the asymmetry recorded as L18. Verified by directory listing. |
| `disposition` | REUSE AS-IS |
| `action422` | Primary evidence for O2. It documents both the 45-parameter content and the deliberate exclusion of the 6 deprecated storageConfig entries — which matters because extract-oc-mirror-params-manual.js still carries those 6 entries, so the exclusion decision lives only in this document. |
| `futureMinorValue` | High. It is the specification for what a per-minor oc-mirror catalog must contain, and the record of a deliberate exclusion that would otherwise look like an omission. |
| `requiredTestsGuards` | O2's validation must assert storageConfig.* is absent from any minor's oc-mirror catalog, since S4 confirms oc-mirror v2 has no storageConfig. |
| `evidenceReason` | REUSE AS-IS: intact, describes a live tracked artifact, and preserves a deliberate exclusion decision that exists nowhere else. |

#### G6.7 `local-docs/ocp-4.20/WEB_EXTRACTION_PLAN.md`

| Field | Value |
|---|---|
| `path` | local-docs/ocp-4.20/WEB_EXTRACTION_PLAN.md |
| `purpose` | Plan to replace PDF text parsing with HTML scraping of docs.redhat.com, giving the quantified reason, the base URL pattern, the per-scenario section URLs, a three-phase extraction strategy, expected coverage and success criteria. |
| `originalRole` | 4.20 Phase 2.1 course correction. |
| `inputs` | the measured failure of PDF table parsing |
| `outputs` | extract-from-html.js |
| `hardcodedVersionAssumptions` | 4.20 base URL and section paths. |
| `currentStatus` | Present, 163 lines, intact. Records the decisive metric verbatim: PDF parsing had a '91% path-building error rate (283/311 malformed)' because two-column table layouts break in text conversion, nested indentation is inconsistent and page furniture interrupts content; HTML gives clean table structure and semantic markup. |
| `disposition` | REUSE AS-IS |
| `action422` | Elevate its decision to the tracked runbook. It is directly actionable for 4.22 because L4 records that 4.22 documentation pages now return HTTP 200 where the 4.21-era attempts got 403 — so the HTML route that was blocked during 4.21 is available for 4.22. |
| `futureMinorValue` | Very high, and currently the most under-used document in the corpus: the decision it records was made, implemented in extract-from-html.js, and then not followed, because AUDIT_AUTOMATION_GUIDE.md still prescribes the PDF route and the HTML route left no outputs at 4.21. |
| `requiredTestsGuards` | The promoted extract-from-html.js golden-fixture test. |
| `evidenceReason` | REUSE AS-IS: intact, and it supplies the quantified positive justification for retiring parse-parameter-tables.js. Recorded as finding F5 because a documented, implemented course correction was silently abandoned. |

#### G6.8 `local-docs/ocp-4.20/platform-audits/BARE_METAL_4_20_AGENT_DOC_REVIEW_AND_PLAN.md`

| Field | Value |
|---|---|
| `path` | local-docs/ocp-4.20/platform-audits/BARE_METAL_4_20_AGENT_DOC_REVIEW_AND_PLAN.md |
| `purpose` | Per-scenario working doc for bare-metal-agent at 4.20, structured as Snapshot, Repo grounding (Phase 0), Doc tree/mapping (A), Params/catalog (B), AS-IS app inventory (C), Delta analysis (D), Implementation/alignment (E), Testing/validation (F), Remaining items (honest), Canonical vs frontend two-place model, and a closure pass covering regression, SNO and arbiter. |
| `originalRole` | 4.20 per-scenario truth pass for the bare-metal agent-based scenario. |
| `inputs` | official 4.20 documentation, the repo, the catalog |
| `outputs` | scenario truth and implementation alignment |
| `hardcodedVersionAssumptions` | 4.20 scenario specifics and doc URLs. |
| `currentStatus` | Present, 148 lines, intact. Declares its own authority correctly: working doc, with docs/BACKLOG_STATUS.md as canonical status and docs/SCENARIOS_GUIDE.md as canonical navigation. |
| `disposition` | REUSE AS-IS |
| `action422` | Template for the per-scenario review that no script can perform. Its 'Remaining items (honest)' section is the pattern that keeps a scenario from being declared closed when it is not. |
| `futureMinorValue` | High. These audits are the human-semantic half of minor onboarding; the automation can only feed them. |
| `requiredTestsGuards` | None (methodology document). |
| `evidenceReason` | REUSE AS-IS: intact, correctly subordinated to canonical authority, and reusable as a structure for 4.22 scenario review. |

#### G6.9 `local-docs/ocp-4.20/platform-audits/BARE_METAL_4_20_IPI_DOC_REVIEW_AND_PLAN.md`

| Field | Value |
|---|---|
| `path` | local-docs/ocp-4.20/platform-audits/BARE_METAL_4_20_IPI_DOC_REVIEW_AND_PLAN.md |
| `purpose` | Per-scenario working doc for bare-metal-ipi at 4.20 covering docs-index mapping, full-doc review, params reconciliation, AS-IS inventory, discrepancy analysis and implementation plan. |
| `originalRole` | 4.20 bare-metal IPI truth pass. |
| `inputs` | official 4.20 documentation, the repo, the catalog |
| `outputs` | scenario truth |
| `hardcodedVersionAssumptions` | 4.20 specifics. |
| `currentStatus` | Present, 119 lines, intact — the most concise of the seven. Unlike its siblings it uses a single H2 heading, so its internal structure is flatter. |
| `disposition` | REUSE AS-IS |
| `action422` | Scenario-review template. bare-metal-ipi is also the scenario Revision 3 2.D identifies as carrying the strongest 4.22 supported-ui candidate (platform.baremetal.provisioningNetworkGateway), so this doc is the starting point for that specific review. |
| `futureMinorValue` | High. |
| `requiredTestsGuards` | None. |
| `evidenceReason` | REUSE AS-IS: intact and directly relevant to the strongest 4.22 field candidate. |

#### G6.10 `local-docs/ocp-4.20/platform-audits/BARE_METAL_4_20_UPI_DOC_REVIEW_AND_PLAN.md`

| Field | Value |
|---|---|
| `path` | local-docs/ocp-4.20/platform-audits/BARE_METAL_4_20_UPI_DOC_REVIEW_AND_PLAN.md |
| `purpose` | Per-scenario working doc for bare-metal-upi at 4.20, including a field-by-field classification of disputed UPI fields and a final resolved params reconciliation. |
| `originalRole` | 4.20 bare-metal UPI truth pass. |
| `inputs` | official 4.20 documentation, the repo, the catalog |
| `outputs` | scenario truth; the resolved disputed-field classification |
| `hardcodedVersionAssumptions` | 4.20 specifics. |
| `currentStatus` | Present, 154 lines, intact. Contains a dedicated 'Field-by-field classification (disputed UPI fields)' section. |
| `disposition` | REUSE AS-IS |
| `action422` | Its disputed-field classification is the precedent for O1 conflict handling: where sources disagree, classify the field explicitly rather than choosing silently. backend/scripts/validate-e2e-examples.js independently records the related 4.20 rule that bare-metal-upi must have platform none and no platform.baremetal. |
| `futureMinorValue` | High. UPI scenarios generate the most docs-versus-installer disagreement, which is exactly where O1 and H2 bite. |
| `requiredTestsGuards` | None. |
| `evidenceReason` | REUSE AS-IS: intact, and the disputed-field section is a worked example of the conflict-resolution method O1 formalises. |

#### G6.11 `local-docs/ocp-4.20/platform-audits/NUTANIX_4_20_IPI_DOC_REVIEW_AND_PLAN.md`

| Field | Value |
|---|---|
| `path` | local-docs/ocp-4.20/platform-audits/NUTANIX_4_20_IPI_DOC_REVIEW_AND_PLAN.md |
| `purpose` | Nutanix platform-family closeout for 4.20, in four parts: methodology discovery (official docs versus repo), the in-scope nutanix-ipi methodology, a family closure statement, and a prompt-compliance checklist. |
| `originalRole` | 4.20 Nutanix family closeout, 2026-03-19. |
| `inputs` | official 4.20 Nutanix documentation, the repo |
| `outputs` | family closure; app-scope boundary |
| `hardcodedVersionAssumptions` | 4.20 specifics; and it contains commented-out git add commands referencing the vanished flat frontend catalog path. |
| `currentStatus` | Present, 219 lines, intact. |
| `disposition` | REUSE AS-IS |
| `action422` | Its explicit family-versus-app-scope distinction is the precedent for O8 and O9 scope boundaries: the Nutanix documentation family includes an Agent-based Installer scenario that the app deliberately does not implement, and that decision is recorded rather than left as an apparent gap. |
| `futureMinorValue` | High. 'The documentation family is larger than our supported scope, and here is the explicit boundary' is exactly the pattern O8 and O9 need in Tranche 7. |
| `requiredTestsGuards` | None. |
| `evidenceReason` | REUSE AS-IS: intact, and it is the in-corpus precedent for recording a deliberate scope boundary instead of an implicit omission. |

#### G6.12 `local-docs/ocp-4.20/platform-audits/VSPHERE_4_20_AGENT_DOC_REVIEW_AND_PLAN.md`

| Field | Value |
|---|---|
| `path` | local-docs/ocp-4.20/platform-audits/VSPHERE_4_20_AGENT_DOC_REVIEW_AND_PLAN.md |
| `purpose` | Per-scenario working doc for vsphere-agent at 4.20 across Phases 0 and A-H, plus a dated dual-stack/arbiter/doc-tightening pass and an operator manual-validation checklist. |
| `originalRole` | 4.20 vSphere agent truth pass, 2026-03-19. |
| `inputs` | official 4.20 vSphere and agent documentation, the repo |
| `outputs` | scenario truth; topology/node-count/arbiter/SNO enforcement closure |
| `hardcodedVersionAssumptions` | 4.20 specifics. |
| `currentStatus` | Present, 224 lines, intact. Notably honest: it states enforcement is closed for the named areas but explicitly declines a blanket doc-truth claim, listing three named caveats that remain open. |
| `disposition` | REUSE AS-IS |
| `action422` | Template, and specifically a model for scoped closure claims — 'these areas are closed, these three are not' is the shape every 4.22 scenario review should produce. |
| `futureMinorValue` | High. |
| `requiredTestsGuards` | None. |
| `evidenceReason` | REUSE AS-IS: intact, and its refusal to over-claim closure is precisely the discipline CLAUDE.md's evidence rules require. |

#### G6.13 `local-docs/ocp-4.20/platform-audits/VSPHERE_4_20_IPI_DOC_REVIEW_AND_PLAN.md`

| Field | Value |
|---|---|
| `path` | local-docs/ocp-4.20/platform-audits/VSPHERE_4_20_IPI_DOC_REVIEW_AND_PLAN.md |
| `purpose` | The deepest per-scenario working doc at 912 lines: vsphere-ipi at 4.20 across Phases A-F with multiple reconciliation sub-passes (structural validation, deep reconciliation, closure plus metadata completion) and a final implementation-complete record. Opens with a 'current code truth' section explicitly separating implemented state from historical plan text. |
| `originalRole` | 4.20 vSphere IPI truth pass — the most thorough scenario review in the corpus. |
| `inputs` | official 4.20 vSphere documentation, the repo, the catalog |
| `outputs` | scenario truth; implementation |
| `hardcodedVersionAssumptions` | 4.20 specifics. |
| `currentStatus` | Present, 912 lines, intact. |
| `disposition` | REUSE AS-IS |
| `action422` | The reference depth standard. Its opening pattern — a 'current code truth' section that states implemented reality and explicitly labels superseded plan text as historical rather than deleting it — is directly opposed to the tombstone pattern that destroyed two Slice 4 documents, and is the pattern to adopt. |
| `futureMinorValue` | Very high, both as a depth benchmark and as the correct way to supersede content without losing it. |
| `requiredTestsGuards` | None. |
| `evidenceReason` | REUSE AS-IS: intact, and it demonstrates the supersession pattern that findings F4 shows was abandoned elsewhere. |

#### G6.14 `local-docs/ocp-4.20/platform-audits/VSPHERE_4_20_UPI_DOC_REVIEW_AND_PLAN.md`

| Field | Value |
|---|---|
| `path` | local-docs/ocp-4.20/platform-audits/VSPHERE_4_20_UPI_DOC_REVIEW_AND_PLAN.md |
| `purpose` | Per-scenario working doc for vsphere-upi at 4.20 across Phases A-J, including a dedicated automation assessment phase (D), open questions and blockers (H), deliverables summary (I), and backlog plus git commands (J). |
| `originalRole` | 4.20 vSphere UPI truth pass. |
| `inputs` | official 4.20 vSphere UPI documentation, the repo |
| `outputs` | scenario truth; an automation assessment |
| `hardcodedVersionAssumptions` | 4.20 specifics; states the canonical base URL is docs.redhat.com and that docs.openshift.com is shut down. |
| `currentStatus` | Present, 259 lines, intact. The only platform audit with an explicit 'Phase D — Automation assessment' section, making it the nearest prior art to this harvest ledger. |
| `disposition` | REUSE AS-IS |
| `action422` | Template; and its Phase D automation assessment should be folded into the tracked scenario-review structure so every future scenario review asks what could be automated, rather than leaving that to a separate archaeology pass like this one. |
| `futureMinorValue` | High. Per-scenario automation assessment at review time is cheaper than reconstructing it later. |
| `requiredTestsGuards` | None. |
| `evidenceReason` | REUSE AS-IS: intact, and it is the closest existing precedent for the kind of assessment 0A-0 performs. |

---

## G7 — Tracked scripts

**Root:** `scripts/` · **Plan count:** 36 · **Actual:** 36 · ✅ matches

> Revision 3 §3.0 describes this group as '12 validators, 7 one-shot catalog mutators, ...'. The filesystem shows 8 one-shot catalog mutators, not 7 (see discrepancy D4). All 36 files are rowed.

| # | path | disposition | currentStatus (summary) |
|---:|---|---|---|
| 1 | `scripts/validate-param-authority.js` | **PARAMETERIZE** | RED. Verified by running: exit 1 with 742 output lines. The failure is the known catalog data debt (741 schema errors across both minors) plus the par… |
| 2 | `scripts/validate-catalog-frontend-parity.js` | **PARAMETERIZE** | BROKEN FOR EVERY MINOR, verified by running. frontend/src/data/catalogs now contains only the subdirectories 4.20/ and 4.21/, so feFiles (filtered to … |
| 3 | `scripts/validate-catalog.js` | **REUSE AS-IS** | Works correctly; the red exit is real data debt, not a tool fault. Verified: data/params/4.20 -> 296 errors, data/params/4.21 -> 445 errors, data/para… |
| 4 | `scripts/sync-catalogs.js` | **REUSE AS-IS** | Works and is version-aware. Not executed here (it writes into frontend/src/data/catalogs, outside the 0A-0 write fence). Revision 3 2.C independently … |
| 5 | `scripts/validate-docs-index.js` | **REUSE AS-IS** | PASSES. Verified by running the parent: the first line of validate-param-authority.js output is 'Docs index validation passed.' Covers both 4.20.json … |
| 6 | `scripts/validate-docs-index-frontend-parity.js` | **PARAMETERIZE** | Structurally sound — unlike the catalog parity validator it correctly uses per-version FILE paths, which happen to be unaffected by the versioned-subd… |
| 7 | `scripts/validate-catalog-agent-networkconfig-paths.js` | **REUSE AS-IS** | Works for all minors. Its recursive walk means both the canonical and the frontend invocation cover every version subdirectory automatically. |
| 8 | `scripts/validate-agent-nmstate-generator.js` | **REUSE AS-IS** | Works. It fails loudly if the start marker is absent, which is the right behaviour, but if the END marker were renamed it would silently widen its sca… |
| 9 | `scripts/validate-catalog-vs-doc-params.js` | **REUSE AS-IS** | Works; fully path-driven and read-only. Its usage examples in the header still show the vanished flat frontend catalog path, but that is comment text,… |
| 10 | `scripts/find-hardcoded-versions.sh` | **PARAMETERIZE** | --check FAILS, exit 1, verified by running (this command is read-only: it only greps and prints). All 6 unclassified findings are SVG path-coordinate … |
| 11 | `scripts/refresh-doc-index.js` | **PARAMETERIZE** | Not run — it performs network acquisition and rewrites a tracked data file, both forbidden in 0A-0. By inspection it requires Node 18+ for global fetc… |
| 12 | `scripts/docs-index-discovery.js` | **PARAMETERIZE** | Works and is already effectively version-parameterized — the only version literal is the default. Read-only and offline despite containing URLs (it pr… |
| 13 | `scripts/scenario-doc-mapping.js` | **PARAMETERIZE** | Works. Read-only in its default mode; network only behind the explicit --check-urls flag, which is the right design. Revision 3 2.C already lists it a… |
| 14 | `scripts/backfill-citation-doc-title.js` | **PARAMETERIZE** | Not run — it mutates tracked catalog files and may perform network fetches, both outside the 0A-0 fence. Directly relevant to 0B: missing docTitle is … |
| 15 | `scripts/phase3-backfill-doc-title.js` | **PARAMETERIZE** | Not run — it mutates tracked catalog files. By inspection it is the R6-compliant one of the pair: it refuses to guess, refuses to proceed on conflict,… |
| 16 | `scripts/verify-parameter-coverage.js` | **PARAMETERIZE** | Not run (it writes an output file). By inspection it can only ever analyse 4.20; there is no CLI path to another minor. |
| 17 | `scripts/analyze-ui-coverage.js` | **PARAMETERIZE** | Read-only (no writes found). Analyses 4.20 only. Its original consumer, add-support-status-all.js, is retired in this ledger, so its remaining value i… |
| 18 | `scripts/add-missing-parameters.js` | **RETIRE** | Unsafe to run today. Its frontend target is the flat directory that the versioned migration removed, so a run would create stray flat .json files besi… |
| 19 | `scripts/add-proxy-params-to-catalogs.js` | **RETIRE** | Would run against 4.20 only. Not executed (mutates tracked catalogs). Its work is already applied — the proxy parameters are present in the catalogs t… |
| 20 | `scripts/add-support-status-all.js` | **RETIRE** | Not executed (mutates tracked catalogs). Its inference rules are heuristic by construction — 'the string appears in a JSX file' is not evidence of pro… |
| 21 | `scripts/add-support-status-oc-mirror.js` | **RETIRE** | Not executed. It targets the only oc-mirror catalog that exists (4.20); 4.21 has none, which is L18. |
| 22 | `scripts/add-v1.7-parameters.js` | **RETIRE** | Unsafe to run today, same flat-path hazard as add-missing-parameters.js, plus a gitignored input dependency. Its work is long since applied. Not execu… |
| 23 | `scripts/expand-catalogs-from-agent-doc.js` | **RETIRE** | Not executed (mutates tracked catalogs). Its effect is already applied. |
| 24 | `scripts/expand-nutanix-once.js` | **RETIRE** | Not executed (overwrites a tracked catalog). It is the most aggressive mutator in the tree: it rebuilds an entire scenario catalog from another platfo… |
| 25 | `scripts/patch-nutanix-ipi-catalog.mjs` | **RETIRE** | BROKEN — would throw ENOENT immediately. Verified by directory listing: frontend/src/data/catalogs contains only the subdirectories 4.20/ and 4.21/, s… |
| 26 | `scripts/validate-app-version.mjs` | **REUSE AS-IS** | Works. Not run here (invoking it is harmless but it is not needed to establish status, and VERSION is confirmed as 2.0.0 by direct read — matching pla… |
| 27 | `scripts/validate-app-version.test.mjs` | **REUSE AS-IS** | Present and self-contained; creates and removes its own temporary fixtures, no network, no repo mutation. Not run here (not required to establish stat… |
| 28 | `scripts/validate-frontend-container-layout.mjs` | **REUSE AS-IS** | In CI and presumed green (the plan records no failure and it is not a version-aware check). Not run here. |
| 29 | `scripts/smoke-frontend-container.sh` | **REUSE AS-IS** | In CI. Not run here — it builds and runs containers, which is well outside a read-only harvest. |
| 30 | `scripts/set-build-env.sh` | **REUSE AS-IS** | Works; 15 lines, read-only, degrades to 'unknown' outside a git work tree. |
| 31 | `scripts/check-secrets.sh` | **REUSE AS-IS** | Works; read-only scan. |
| 32 | `scripts/backup-sqlite.sh` | **REUSE AS-IS** | Not run (operational script touching a database). Version-agnostic by inspection. |
| 33 | `scripts/restore-sqlite.sh` | **REUSE AS-IS** | Not run, and deliberately so: it is destructive by design and CLAUDE.md requires explicit user approval for destructive operations. Version-agnostic b… |
| 34 | `scripts/verify-backup.sh` | **REUSE AS-IS** | Not run (no backup file to verify). Version-agnostic by inspection. |
| 35 | `scripts/test-backup-restore.sh` | **REUSE AS-IS** | Not run (creates databases and files). Version-agnostic by inspection; it is the self-test for the three backup scripts. |
| 36 | `scripts/load-test.sh` | **REUSE AS-IS** | Not run (requires a running instance and generates sustained load). Version-agnostic by inspection. |

#### G7.1 `scripts/validate-param-authority.js`

| Field | Value |
|---|---|
| `path` | scripts/validate-param-authority.js |
| `purpose` | Single CI and local entrypoint for catalog authority: sequentially runs docs-index schema validation, catalog schema validation over data/params, docs-index frontend parity, catalog frontend parity, agent networkConfig kebab-case guards over both canonical and frontend trees, and the buildNmState generator guard. Exits on the first failing child. |
| `originalRole` | The CI authority gate, invoked at .github/workflows/ci.yml:66 with no argument. |
| `inputs` | process.argv[2] (version, defaults to '4.20'); the six child validators |
| `outputs` | exit status; child stdio inherited |
| `hardcodedVersionAssumptions` | line 23: const version = process.argv[2] \|\| "4.20". This single value is passed to both parity checks. |
| `currentStatus` | RED. Verified by running: exit 1 with 742 output lines. The failure is the known catalog data debt (741 schema errors across both minors) plus the parity failure. IMPORTANT PRECISION on L9: the plan says this script 'checks ONE minor'. That is true of the two PARITY children only — validate-catalog.js is invoked with the parent directory data/params and walks recursively, so catalog SCHEMA validation does cover both minors today (296 + 445 = 741 = the 741 observed). Only docs-index frontend parity and catalog frontend parity are single-minor, and both default to 4.20, so 4.21 parity is never CI-checked. |
| `disposition` | PARAMETERIZE |
| `action422` | Iterate SUPPORTED_MINORS instead of taking one optional argument, so all three minors are parity-checked in CI. Keep the single-entrypoint shape. |
| `futureMinorValue` | High. With three minors, an unchecked minor is twice as likely as with two. |
| `requiredTestsGuards` | A test asserting the parity children are invoked once per entry in SUPPORTED_MINORS, so adding 4.22 to the constant automatically extends coverage with no edit here. |
| `evidenceReason` | PARAMETERIZE: the structure is right and the fix is to replace one default-valued argument with iteration over the shared constant. The red exit status is data debt owned by 0B, not a defect in this script. |

#### G7.2 `scripts/validate-catalog-frontend-parity.js`

| Field | Value |
|---|---|
| `path` | scripts/validate-catalog-frontend-parity.js |
| `purpose` | Asserts each frontend catalog mirror file is identical to its canonical data/params/<version>/ counterpart after stable normalization (parameters sorted by path + outputFile), and that the two file sets match. |
| `originalRole` | Parity enforcement; invoked by validate-param-authority.js. |
| `inputs` | process.argv[2] (version, default '4.20'); frontend/src/data/catalogs; data/params/<version> |
| `outputs` | exit status and error list |
| `hardcodedVersionAssumptions` | line 28 default '4.20'. The real defect is line 29: feDir is built as frontend/src/data/catalogs WITHOUT the version segment, while canonDir at line 30 correctly includes it. |
| `currentStatus` | BROKEN FOR EVERY MINOR, verified by running. frontend/src/data/catalogs now contains only the subdirectories 4.20/ and 4.21/, so feFiles (filtered to .json) is empty and every canonical file is reported as unmatched. Observed: 4.21 -> exit 1, 'only in data/params/4.21: <all 12>'; 4.20 -> exit 1, 'only in data/params/4.20: <all 13>'. Note the plan records only the 4.21 failure; 4.20 is equally broken (discrepancy D2). Because validate-param-authority.js defaults to 4.20 and exits on first child failure, this has been failing CI on the 4.20 path, not the 4.21 path. |
| `disposition` | PARAMETERIZE |
| `action422` | One-line fix: include the version segment in feDir. Then iterate SUPPORTED_MINORS via the parent entrypoint. |
| `futureMinorValue` | High. This is the only automated defence against frontend/backend catalog divergence, and the untracked pre-commit hook that currently papers over it auto-syncs rather than enforcing. |
| `requiredTestsGuards` | A test with a deliberately divergent mirror file asserting nonzero exit, and a test asserting the frontend directory is resolved per-version (regression for exactly this defect). |
| `evidenceReason` | PARAMETERIZE: the normalization logic is correct and the only fault is a missing path segment introduced when the frontend migrated to versioned subdirectories (commits e65e6ee, a45b20e, 2026-06-29) without this consumer being updated. |

#### G7.3 `scripts/validate-catalog.js`

| Field | Value |
|---|---|
| `path` | scripts/validate-catalog.js |
| `purpose` | Validates catalog files against schema v2.0.0: required path, outputFile, description, applies_to, non-empty citations with docId/docTitle/sectionHeading/url, required supportStatus from a seven-value enum with unknown-needs-review explicitly CI-fatal, minVersion/maxVersion in 4.x minor format with maxVersion nullable but present, optional versionNotes and version-keyed validationRules, no duplicate path+outputFile, scenarioId matching filename, and — when given a versioned directory — that every scenario in that minor's docs-index has a catalog. |
| `originalRole` | The catalog schema gate (DOC-101 Phase 1 Slice 2). |
| `inputs` | process.argv[2] = file or directory (default data/params/4.20); data/docs-index/<version>.json for the cross-check |
| `outputs` | exit status and per-error lines |
| `hardcodedVersionAssumptions` | Only the default target path. Everything else is derived: versionFromParamsPath infers the minor from the directory name, and the version format regex /^4\.\d+$/ already accepts 4.22 and beyond. |
| `currentStatus` | Works correctly; the red exit is real data debt, not a tool fault. Verified: data/params/4.20 -> 296 errors, data/params/4.21 -> 445 errors, data/params (recursive) -> 741. Error classes observed include missing outputFile, missing applies_to, and citations missing docId/sectionHeading/url/docTitle. |
| `disposition` | REUSE AS-IS |
| `action422` | No change needed. Point it at data/params/4.22 and it validates, because it is genuinely path-driven and its version regex is open-ended. This is the clearest example in the tracked tree of automation that was written version-generically from the start. |
| `futureMinorValue` | Very high and zero-maintenance. |
| `requiredTestsGuards` | Per §1.1 and plan work item 8, the separate change is to make schema/catalog-parameter-schema.json non-decorative — either drive this validator off it or add a conformance test asserting the two agree. That is a NEW test, not a modification here, which is why this row stays REUSE AS-IS. |
| `evidenceReason` | REUSE AS-IS: directory-driven, minor inferred from the path, version regex already future-open. Needs nothing to serve 4.22. |

#### G7.4 `scripts/sync-catalogs.js`

| Field | Value |
|---|---|
| `path` | scripts/sync-catalogs.js |
| `purpose` | Synchronizes data/params/<version>/ to frontend/src/data/catalogs/<version>/, preserving version subdirectories per ADR-001/ADR-005, using MD5 comparison to copy only changed files; supports --dry-run and --verbose. |
| `originalRole` | Catalog mirror maintenance; invoked by npm run sync-catalogs and by the untracked pre-commit hook. |
| `inputs` | data/params/** ; CLI flags |
| `outputs` | frontend/src/data/catalogs/<version>/*.json |
| `hardcodedVersionAssumptions` | None. Both roots are directory constants and version subdirectories are discovered, not enumerated. |
| `currentStatus` | Works and is version-aware. Not executed here (it writes into frontend/src/data/catalogs, outside the 0A-0 write fence). Revision 3 2.C independently identifies it as 'the one fully generic piece'. |
| `disposition` | REUSE AS-IS |
| `action422` | No change for catalogs. A 4.22 directory under data/params is picked up automatically. |
| `futureMinorValue` | Very high and zero-maintenance for catalogs. |
| `requiredTestsGuards` | A --dry-run drift check wired into CI, per plan work item 5. Note the SEPARATE gap: this script covers catalogs only, not data/docs-index/<version>.json, whose frontend mirror is still copied by hand (correction #4, GAP-06). |
| `evidenceReason` | REUSE AS-IS: genuinely generic, already ADR-compliant, and the model the rest of the tracked tooling should have followed. |

#### G7.5 `scripts/validate-docs-index.js`

| Field | Value |
|---|---|
| `path` | scripts/validate-docs-index.js |
| `purpose` | Validates every data/docs-index/*.json against the Phase 1 schema: required top-level version, baseUrl, generatedAt, scenarios and sharedDocs; scenarios as an object map of scenarioId to { docs: [...] }; each doc carrying id, title, url, configTypes and tags arrays, with configTypes drawn from install-config / agent-config / imageset-config / other. |
| `originalRole` | Docs-index schema gate; first child of validate-param-authority.js. |
| `inputs` | every .json in data/docs-index/ |
| `outputs` | exit status |
| `hardcodedVersionAssumptions` | None; it iterates the directory and validates whatever minors are present. |
| `currentStatus` | PASSES. Verified by running the parent: the first line of validate-param-authority.js output is 'Docs index validation passed.' Covers both 4.20.json and 4.21.json. One fragility worth recording: INDEX_DIR is built from process.cwd() rather than from __dirname like every sibling script, so it only works when invoked from the repository root. |
| `disposition` | REUSE AS-IS |
| `action422` | No change. A new data/docs-index/4.22.json is validated automatically. |
| `futureMinorValue` | High and zero-maintenance. |
| `requiredTestsGuards` | Optionally make the cwd dependency explicit; not required for 4.22. |
| `evidenceReason` | REUSE AS-IS: directory-driven, currently green, and already covers all minors present. The cwd fragility is recorded but does not affect correctness under the documented invocation. |

#### G7.6 `scripts/validate-docs-index-frontend-parity.js`

| Field | Value |
|---|---|
| `path` | scripts/validate-docs-index-frontend-parity.js |
| `purpose` | Asserts frontend/src/data/docs-index/<version>.json matches canonical data/docs-index/<version>.json after stable normalization (scenario keys sorted, doc lists sorted by id, sharedDocs sorted by id). |
| `originalRole` | Docs-index parity; third child of validate-param-authority.js. |
| `inputs` | process.argv[2] (version, default '4.20') |
| `outputs` | exit status |
| `hardcodedVersionAssumptions` | line 43: process.argv[2] \|\| "4.20". |
| `currentStatus` | Structurally sound — unlike the catalog parity validator it correctly uses per-version FILE paths, which happen to be unaffected by the versioned-subdirectory migration because docs-index was always <version>.json. It checks only the one minor it is given, and the parent passes no argument, so 4.21 docs-index parity is not CI-verified today. |
| `disposition` | PARAMETERIZE |
| `action422` | Iterate SUPPORTED_MINORS via the parent entrypoint rather than defaulting to a single minor. |
| `futureMinorValue` | High. Combined with GAP-06 (the docs-index frontend copy is manual), this is the only thing standing between a hand-copy slip and a wrong documentation link in the UI. |
| `requiredTestsGuards` | A test with a deliberately divergent frontend docs-index asserting nonzero exit. |
| `evidenceReason` | PARAMETERIZE: the comparison is correct; only the single-minor default needs replacing with iteration. |

#### G7.7 `scripts/validate-catalog-agent-networkconfig-paths.js`

| Field | Value |
|---|---|
| `path` | scripts/validate-catalog-agent-networkconfig-paths.js |
| `purpose` | Guards NMState naming: every catalog parameter path describing hosts[].networkConfig for agent-config.yaml must use kebab-case NMState segments. Rejects eight camelCase leaks (prefixLength, baseIface, linkAggregation, nextHopAddress, nextHopInterface, routeTableId, totalVfs, macAddress). |
| `originalRole` | Catalog naming guard; invoked twice by validate-param-authority.js, once over data/params and once over frontend/src/data/catalogs. |
| `inputs` | process.argv[2] = target directory (default data/params) |
| `outputs` | exit status |
| `hardcodedVersionAssumptions` | None. It walks directories recursively, so the versioned-subdirectory migration did not break it — unlike the catalog parity validator, which uses a flat readdir. |
| `currentStatus` | Works for all minors. Its recursive walk means both the canonical and the frontend invocation cover every version subdirectory automatically. |
| `disposition` | REUSE AS-IS |
| `action422` | No change. A 4.22 catalog directory is covered the moment it exists. |
| `futureMinorValue` | High and zero-maintenance. Worth noting as the counter-example to validate-catalog-frontend-parity.js: recursive walking survived the layout migration, flat readdir did not. |
| `requiredTestsGuards` | None additional. |
| `evidenceReason` | REUSE AS-IS: version-agnostic by construction and demonstrably migration-resilient. |

#### G7.8 `scripts/validate-agent-nmstate-generator.js`

| Field | Value |
|---|---|
| `path` | scripts/validate-agent-nmstate-generator.js |
| `purpose` | Static source guard: extracts the buildNmState function body from backend/src/generate.js by string markers and fails if it contains prefixLength, linkAggregation, or a vlan.baseIface object key — the camelCase forms that would conflict with NMState and the catalogs. |
| `originalRole` | Generator-side counterpart to the catalog naming guard; last child of validate-param-authority.js. |
| `inputs` | backend/src/generate.js |
| `outputs` | exit status |
| `hardcodedVersionAssumptions` | None. It is version-agnostic, but it IS coupled to source structure: it locates the function with indexOf('const buildNmState') and ends at '\nconst getPrimaryInterfaceName'. |
| `currentStatus` | Works. It fails loudly if the start marker is absent, which is the right behaviour, but if the END marker were renamed it would silently widen its scan to the remainder of the file rather than narrowing it — a false-negative-resistant but imprecise failure mode. |
| `disposition` | REUSE AS-IS |
| `action422` | No change. Relevant to Tranche 3 only in that generate.js is edited there (the 16 fallback removals), so the markers must survive. |
| `futureMinorValue` | Moderate; it guards a naming contract that does not vary by minor. |
| `requiredTestsGuards` | None additional. If generate.js is refactored in Tranche 3, confirm both markers still exist. |
| `evidenceReason` | REUSE AS-IS: version-agnostic, currently effective, no change required for 4.22. |

#### G7.9 `scripts/validate-catalog-vs-doc-params.js`

| Field | Value |
|---|---|
| `path` | scripts/validate-catalog-vs-doc-params.js |
| `purpose` | Reconciliation helper: compares one scenario catalog against an optional expected doc-params list, reporting missing-in-catalog, extra-in-catalog and required-flag mismatches. Makes no edits. Prints catalog paths and required flags when no comparison list is supplied. |
| `originalRole` | Manual companion to docs/PARAMS_RECONCILIATION_CHECKLIST.md. |
| `inputs` | argv[2] = catalog path, argv[3] = optional doc-params JSON |
| `outputs` | stdout report; no writes |
| `hardcodedVersionAssumptions` | None. Both paths are arguments. |
| `currentStatus` | Works; fully path-driven and read-only. Its usage examples in the header still show the vanished flat frontend catalog path, but that is comment text, not behaviour. |
| `disposition` | REUSE AS-IS |
| `action422` | No change. Point it at data/params/4.22/<scenario>.json during Tranche 2 authoring. |
| `futureMinorValue` | Moderate. It is the per-scenario manual reconciliation aid that pairs with the human doc-review audits in group G6. |
| `requiredTestsGuards` | None. The stale flat path in its usage comment should be corrected alongside the group G10 doc fixes. |
| `evidenceReason` | REUSE AS-IS: argument-driven, read-only, no version literal in any code path. |

#### G7.10 `scripts/find-hardcoded-versions.sh`

| Field | Value |
|---|---|
| `path` | scripts/find-hardcoded-versions.sh |
| `purpose` | The versioned-copy guard. Three modes: default audit (eight-category inventory written to a temp directory), --check (CI enforcement over frontend production source), and --self-test (synthetic-fixture validation of the classifier). The classifier is a single shared filter chain applying nine adjudication categories: INFRA, CDEFLT, COMMENT, LOGIC, FMT, THRESH, ENUMVAL, VMAP, VGATED. |
| `originalRole` | CI guard for hardcoded user-facing version copy; both steps of .github/workflows/validate-versioned-copy.yml. |
| `inputs` | frontend/src/**/*.{js,jsx} excluding tests; for --self-test, synthetic fixtures in TMPDIR |
| `outputs` | exit status; audit mode writes to ${OAA_SUPERVISOR_SCRATCH:-${TMPDIR:-/tmp}}/versioned-copy-audit-results |
| `hardcodedVersionAssumptions` | Pervasive and by design — the adjudications must be narrow. THRESH enumerates 4.11/4.12/4.13/4.20/4.21 (line 83); ENUMVAL enumerates v4.11/v4.12/v4.20 (line 89); VGATED enumerates six exact 4.20/4.21 phrases (lines 105-106); the self-test pins the expected violation count at exactly 11 (line 328) and includes a fixture named VIOLATE_thresh_4_22 asserting that 4.22 copy MUST currently be rejected. |
| `currentStatus` | --check FAILS, exit 1, verified by running (this command is read-only: it only greps and prints). All 6 unclassified findings are SVG path-coordinate literals in frontend/src/steps/HostInventoryV2Step.jsx lines 901-903 and 908-910, for example <path d="M14.25 6H10V1.75" />. ROOT CAUSE, characterised precisely: SEARCH_PATTERN is 4\.([0-9]{2,}) with no left boundary, so it matches the tail of any decimal whose integer part ends in 4 and whose fraction has two or more digits — 14.25 yields a 4.25 match — and the classifier chain has no SVG or attribute exclusion. Lineage: the SVG was introduced in commit 6e54610 (2026-10-05), which git merge-base confirms is an ancestor of the 09703fa baseline, 12 commits back. The Versioned Copy Guard workflow has therefore been red since 2026-10-05, including at the frozen baseline. The --self-test is reported PASS 38/38 (11 violation + 25 exemption + 2 structural assertions); it was NOT re-run here because it creates fixtures in TMPDIR and leaves them behind, and the baseline addendum already supplies the result. |
| `disposition` | PARAMETERIZE |
| `action422` | Two separable pieces of work. (A) 0A-1 must eliminate the SVG false-positive class WITHOUT weakening real detection, and add regression coverage for it while preserving all 38 existing self-test assertions. Analysis for the fix: a left-boundary anchor alone is INSUFFICIENT — it would resolve only lines 901 and 910 (where the only match comes from 14.25), because lines 902, 903, 908 and 909 contain a standalone 4.25 preceded by an SVG command letter (v4.25, h4.25), which no digit-boundary rule excludes. A correct fix needs the boundary anchor AND an SVG path-data exclusion (for example, suppressing matches inside a <path ... d="..."> attribute whose value is pure path-command syntax). (B) Tranche 2 extends THRESH, ENUMVAL and VGATED for legitimate 4.22 copy, re-points the VIOLATE_thresh_4_22 fixture to 4.23, and updates docs/VERSIONED_COPY_INVENTORY.md in the SAME commit as the copy (L17). |
| `futureMinorValue` | Very high, and it is the single highest-risk piece of tracked automation in this effort: it is the gate that will reject legitimate 4.22 user-facing copy by design. |
| `requiredTestsGuards` | New self-test fixtures for the SVG class: an EXEMPT_svg_path fixture containing real path data with 14.25 and v4.25 that must be classified, PLUS a negative fixture proving a genuine violation adjacent to SVG markup is still caught. The expected-violation-count assertion must remain exactly 11 and the existing 38 assertions must all still pass; new fixtures raise the exemption and total counts only. |
| `evidenceReason` | PARAMETERIZE: the three-mode structure, the shared classify_raw chain and the self-test harness are sound and unusually well engineered — the narrow, attributable adjudications are exactly right. What must change is the search pattern's boundary handling, an SVG exclusion, and the enumerated minor sets. Not REPLACE: rewriting would risk losing adjudication precision that is documented line by line in docs/VERSIONED_COPY_INVENTORY.md. |

#### G7.11 `scripts/refresh-doc-index.js`

| Field | Value |
|---|---|
| `path` | scripts/refresh-doc-index.js |
| `purpose` | Reads data/docs-index/<version>.json, HEAD-checks every doc URL, and rewrites the index deterministically retaining only live URLs. Supports --dry-run. |
| `originalRole` | Docs-index liveness maintenance. |
| `inputs` | argv path (default data/docs-index/4.20.json); network via fetch |
| `outputs` | rewrites the index file in place unless --dry-run |
| `hardcodedVersionAssumptions` | line 16 default path pins 4.20. |
| `currentStatus` | Not run — it performs network acquisition and rewrites a tracked data file, both forbidden in 0A-0. By inspection it requires Node 18+ for global fetch. Its usefulness changed materially between minors: during 4.21 all 35 URL checks returned 403 (slice-5f2-curl-validation.txt), whereas L4 records 4.22 doc HEAD checks returning 200 (verified 3/3), so the tool is usable for 4.22 in a way it was not for 4.21. |
| `disposition` | PARAMETERIZE |
| `action422` | Take --minor and derive the path. Use in Tranche 1 and 0B acquisition steps ONLY, never from a test (R4). CAUTION: its retain-only-live-URLs behaviour means a transient 403 or network blip silently DELETES doc entries. Given the 4.21 experience, it should refuse to write when the failure rate exceeds a threshold rather than emptying the index. |
| `futureMinorValue` | High for 4.22 given the 200 responses, and it is the mechanism 0B needs to verify that each repaired 4.21 citation resolves to a live page. |
| `requiredTestsGuards` | Unit tests against a local fixture server only; the network-hermeticity test must continue to forbid this script's egress pattern inside the suite. A new guard should reject a rewrite that would remove more than a small fraction of entries. |
| `evidenceReason` | PARAMETERIZE: one hardcoded default path; the liveness logic is sound. The mass-deletion hazard is recorded as a guard requirement rather than a reason to replace. |

#### G7.12 `scripts/docs-index-discovery.js`

| Field | Value |
|---|---|
| `path` | scripts/docs-index-discovery.js |
| `purpose` | For a given version and optional platform, prints the suggested doc tree (ids, path segments, URLs) from a KNOWN_SECTIONS map of install-book path segments, for manual review before merging into the docs-index. |
| `originalRole` | Scenario and version onboarding aid. |
| `inputs` | argv[2] version (default 4.20), argv[3] platform (default all) |
| `outputs` | stdout only; no writes, no network |
| `hardcodedVersionAssumptions` | line 20 default '4.20'. The base URL is correctly interpolated from the version argument, so passing 4.22 already produces 4.22 URLs. |
| `currentStatus` | Works and is already effectively version-parameterized — the only version literal is the default. Read-only and offline despite containing URLs (it prints them, it does not fetch them). Its KNOWN_SECTIONS map is the part that ages: a doc-tree reorganisation between minors is not detected, only a changed version segment is handled. |
| `disposition` | PARAMETERIZE |
| `action422` | Remove the 4.20 default (require --minor explicitly) and review KNOWN_SECTIONS against the 4.22 doc tree during Tranche 1. Revision 3 §1.2 records that Red Hat moved the oc-mirror v2 topic from Chapter 7 at 4.20 to Chapter 5 at 4.22, so section stability must not be assumed. |
| `futureMinorValue` | High. It is the fastest route to a candidate 4.22 docs-index, and it is offline, so it can run before acquisition. |
| `requiredTestsGuards` | A test asserting every generated URL contains the requested minor and no other. |
| `evidenceReason` | PARAMETERIZE: a defaulted version is a weak form of hardcoding that silently produces 4.20 output when the argument is forgotten — exactly the fallback class CLAUDE.md forbids. Making the minor explicit is the fix. |

#### G7.13 `scripts/scenario-doc-mapping.js`

| Field | Value |
|---|---|
| `path` | scripts/scenario-doc-mapping.js |
| `purpose` | Lists doc ids and URLs for a given scenario from a docs-index file, optionally HEAD-checking each URL with --check-urls. |
| `originalRole` | Per-scenario doc discovery aid for the scenario-by-scenario review method used by the group G6 platform audits. |
| `inputs` | argv[0] scenarioId (default vsphere-ipi), argv[1] index path (default data/docs-index/4.20.json), --check-urls |
| `outputs` | stdout; network only when --check-urls is passed |
| `hardcodedVersionAssumptions` | line 19 default index path pins 4.20; the default scenario is also pinned to vsphere-ipi. |
| `currentStatus` | Works. Read-only in its default mode; network only behind the explicit --check-urls flag, which is the right design. Revision 3 2.C already lists it among the scripts that are 'already version-parameterized', which is accurate in that the index path is an argument. |
| `disposition` | PARAMETERIZE |
| `action422` | Take --minor and derive the index path instead of defaulting to the 4.20 file. Use in Tranche 2 when mapping 4.22 scenario docs. |
| `futureMinorValue` | Moderate. It supports the human per-scenario review that remains irreducibly manual. |
| `requiredTestsGuards` | None beyond asserting the default no longer silently selects a minor. |
| `evidenceReason` | PARAMETERIZE: same defaulted-minor hazard as docs-index-discovery.js. Keeping network behind an explicit flag is correct and must be preserved. |

#### G7.14 `scripts/backfill-citation-doc-title.js`

| Field | Value |
|---|---|
| `path` | scripts/backfill-citation-doc-title.js |
| `purpose` | Backfills missing or empty citation.docTitle in data/params/<version>/*.json: builds a docId-to-title map from that minor's docs-index, applies it, and for any citation whose docId is absent from the map falls back to FETCHING the URL and scraping an H1 or <title>. |
| `originalRole` | Phase 3.x citation metadata repair. |
| `inputs` | argv[2] version (default 4.20); data/docs-index/<version>.json; data/params/<version>/*.json; network for the fallback |
| `outputs` | rewrites data/params/<version>/*.json in place |
| `hardcodedVersionAssumptions` | line 20 default '4.20'. |
| `currentStatus` | Not run — it mutates tracked catalog files and may perform network fetches, both outside the 0A-0 fence. Directly relevant to 0B: missing docTitle is one of the observed error classes in the 741 schema failures. |
| `disposition` | PARAMETERIZE |
| `action422` | Take --minor explicitly. CAUTION for 0B: the network-scrape fallback derives a title from whatever the page returns, which under the 403 conditions observed at 4.21 could write an error-page title into a citation. Under R6 a title that cannot be resolved from the minor's own docs-index must stop and report, not be scraped speculatively. |
| `futureMinorValue` | Moderate. The docs-index-driven path is sound and reusable; the scrape fallback should be removed or made opt-in. |
| `requiredTestsGuards` | A test asserting an unmapped docId causes a stop-and-report rather than a fetch, and the 0A-1 citation guard asserting every citation URL's minor matches its directory. |
| `evidenceReason` | PARAMETERIZE rather than RETIRE: phase3-backfill-doc-title.js (below) is the stricter sibling and is preferred for 0B, but this script's docs-index map-building is the same mechanism and its explicit fallback behaviour is worth retaining as an opt-in. Both are kept and the 0B runbook must state which to use. |

#### G7.15 `scripts/phase3-backfill-doc-title.js`

| Field | Value |
|---|---|
| `path` | scripts/phase3-backfill-doc-title.js |
| `purpose` | Stricter docTitle backfill: builds the docId-to-title map from the minor's docs-index, EXITS on any docId that maps to conflicting titles, EXITS and writes nothing if any citation references a docId absent from the index, and otherwise fills only missing or empty docTitle values. Never touches docId, sectionHeading or url. No network. |
| `originalRole` | Phase 3 consistency fix. |
| `inputs` | argv[2] version (default 4.20); data/docs-index/<version>.json; data/params/<version>/*.json |
| `outputs` | rewrites data/params/<version>/*.json in place, or writes nothing and exits on any unresolved mapping |
| `hardcodedVersionAssumptions` | line 16 default '4.20'. |
| `currentStatus` | Not run — it mutates tracked catalog files. By inspection it is the R6-compliant one of the pair: it refuses to guess, refuses to proceed on conflict, and performs no network access. |
| `disposition` | PARAMETERIZE |
| `action422` | Take --minor explicitly and use THIS script, in preference to backfill-citation-doc-title.js, for the 0B docTitle repairs. Its fail-closed behaviour is exactly what R6 demands and is also what makes it safe to run unattended. |
| `futureMinorValue` | High. A backfill tool that stops rather than inventing is the only kind safe to run against catalog data. |
| `requiredTestsGuards` | Tests asserting that a conflicting-title docs-index causes exit with no writes, and that an unmapped docId causes exit with no writes. Both behaviours are the script's main value and must not regress. |
| `evidenceReason` | PARAMETERIZE: one defaulted minor; the logic already embodies the no-guessing rule. Named here as the preferred 0B tool so the choice between the two backfill scripts is not left to chance. |

#### G7.16 `scripts/verify-parameter-coverage.js`

| Field | Value |
|---|---|
| `path` | scripts/verify-parameter-coverage.js |
| `purpose` | Cross-references catalog parameter paths against field accesses in backend/src/generate.js to report per-scenario coverage, catalog parameters absent from generation, generation accesses absent from catalogs, and suspicious patterns. Exits 1 on critical gaps. |
| `originalRole` | Catalog-to-generation coverage verification. |
| `inputs` | data/params/4.20 (hardcoded, line 27); backend/src/generate.js; --scenario and --verbose flags |
| `outputs` | stdout report; writes a JSON output file (line 289) |
| `hardcodedVersionAssumptions` | line 27: CATALOGS_DIR pinned to ../data/params/4.20 with no argument to override it. |
| `currentStatus` | Not run (it writes an output file). By inspection it can only ever analyse 4.20; there is no CLI path to another minor. |
| `disposition` | PARAMETERIZE |
| `action422` | Take --minor. Valuable in Tranche 3, where the version-gated 4.22 fields (provisioningNetworkGateway, AWS and Azure ipFamily) must actually be consumed by generation — this script is the check that a catalog entry is not merely declared but wired. |
| `futureMinorValue` | High. 'The catalog says this parameter exists but generation never reads it' is a silent-failure class that no other tracked check covers. |
| `requiredTestsGuards` | A test asserting the analysed catalog directory follows --minor, and a fixture case proving a catalog parameter absent from generate.js is reported as a gap. |
| `evidenceReason` | PARAMETERIZE: a single hardcoded directory constant with no override; the cross-referencing logic itself is version-agnostic and worth keeping. |

#### G7.17 `scripts/analyze-ui-coverage.js`

| Field | Value |
|---|---|
| `path` | scripts/analyze-ui-coverage.js |
| `purpose` | Reads every frontend step component, extracts referenced state field paths, cross-references them against catalog parameters, and reports UI coverage to inform supportStatus inference. |
| `originalRole` | Phase 0 input to the supportStatus backfill. |
| `inputs` | frontend/src/steps/*.jsx; data/params/4.20 (hardcoded, line 17) |
| `outputs` | stdout report only; no file writes |
| `hardcodedVersionAssumptions` | line 17: CATALOGS_DIR pinned to ../data/params/4.20, no override. |
| `currentStatus` | Read-only (no writes found). Analyses 4.20 only. Its original consumer, add-support-status-all.js, is retired in this ledger, so its remaining value is diagnostic rather than generative. |
| `disposition` | PARAMETERIZE |
| `action422` | Take --minor. Useful in Tranche 3 and 4 as a cross-check that fields marked supported-ui genuinely have UI, but it must NOT be used to infer or backfill supportStatus — that is the R6 violation for which add-support-status-all.js is retired. |
| `futureMinorValue` | Moderate as a diagnostic. Explicitly NOT as an authority: a heuristic scan of JSX cannot establish product supportedness. |
| `requiredTestsGuards` | A test asserting the analysed directory follows --minor. Its report should carry an explicit 'diagnostic only, not an authority for supportStatus' banner. |
| `evidenceReason` | PARAMETERIZE: one hardcoded directory. Retained as a diagnostic with an explicit authority caveat, because its historical use as an inference source is precisely the pattern R6 forbids. |

#### G7.18 `scripts/add-missing-parameters.js`

| Field | Value |
|---|---|
| `path` | scripts/add-missing-parameters.js |
| `purpose` | One-shot migration that read local-docs/ocp-4.20/analysis/missing-parameters-analysis.json and injected high-priority missing parameters into the 4.20 catalogs in alphabetical order. |
| `originalRole` | DOC-082 4.20 catalog expansion. |
| `inputs` | local-docs/ocp-4.20/analysis/missing-parameters-analysis.json (gitignored); data/params/4.20; frontend/src/data/catalogs (FLAT) |
| `outputs` | mutates backend and frontend catalogs |
| `hardcodedVersionAssumptions` | BACKEND_CATALOGS_DIR pinned to data/params/4.20 (line 13); FRONTEND_CATALOGS_DIR pinned to the flat frontend/src/data/catalogs (line 14). |
| `currentStatus` | Unsafe to run today. Its frontend target is the flat directory that the versioned migration removed, so a run would create stray flat .json files beside the 4.20/ and 4.21/ subdirectories — which would then be picked up by the import.meta.glob catalog loader and by validate-catalog-frontend-parity.js's flat readdir, actively corrupting the layout. It also depends on a gitignored analysis file. Not executed. |
| `disposition` | RETIRE |
| `action422` | None. Do not port. |
| `futureMinorValue` | Negative — running it would damage the catalog layout. |
| `requiredTestsGuards` | None for the retired script. |
| `evidenceReason` | RETIRE justified positively with named replacements: parameter additions for a minor are now performed as evidence-backed catalog authoring (Tranche 0B for 4.20/4.21, Tranche 2 for 4.22) validated by validate-catalog.js and mirrored by sync-catalogs.js, which writes to the correct versioned path. That pipeline fully covers this script's capability and does so without the flat-path hazard or the gitignored input dependency. |

#### G7.19 `scripts/add-proxy-params-to-catalogs.js`

| Field | Value |
|---|---|
| `path` | scripts/add-proxy-params-to-catalogs.js |
| `purpose` | One-shot injection of proxy.* and additionalTrustBundlePolicy parameters into every 4.20 install-config scenario catalog, copying the exact parameter objects out of bare-metal-agent.json and rewriting applies_to per scenario. |
| `originalRole` | 4.20 catalog completeness pass. |
| `inputs` | data/params/4.20/bare-metal-agent.json as the donor; the other 4.20 catalogs |
| `outputs` | mutates data/params/4.20/*.json |
| `hardcodedVersionAssumptions` | paramsDir pinned to data/params/4.20 (line 13). |
| `currentStatus` | Would run against 4.20 only. Not executed (mutates tracked catalogs). Its work is already applied — the proxy parameters are present in the catalogs today. |
| `disposition` | RETIRE |
| `action422` | None, and explicitly so: copying parameter objects from one catalog into others is cross-catalog propagation of unverified metadata, which is the generalised form of the cross-minor backfill R9 forbids. |
| `futureMinorValue` | Negative. The mechanism conflicts with R9's evidence-isolation principle. |
| `requiredTestsGuards` | None for the retired script. |
| `evidenceReason` | RETIRE justified positively: the capability (every install-config scenario carries the shared proxy parameters) is permanently enforced by validate-catalog.js, which requires complete metadata and citations on every parameter in every catalog, and by the Tranche 0B reconciliation which sources each row from that minor's own authoritative documentation. A validator that proves completeness is strictly better than a script that imposes it by copying. |

#### G7.20 `scripts/add-support-status-all.js`

| Field | Value |
|---|---|
| `path` | scripts/add-support-status-all.js |
| `purpose` | One-shot backfill of supportStatus across all 4.20 catalogs by INFERENCE: if the parameter path appears in a frontend step file mark supported-ui; if structural mark supported-derived; if the description reads as computed mark supported-derived; otherwise mark supported-backend-only. |
| `originalRole` | Phase 0 schema v2.0.0 migration, when supportStatus became a required field. |
| `inputs` | frontend/src/steps/*.jsx; data/params/4.20 |
| `outputs` | mutates data/params/4.20/*.json |
| `hardcodedVersionAssumptions` | CATALOGS_DIR pinned to data/params/4.20 (line 17). |
| `currentStatus` | Not executed (mutates tracked catalogs). Its inference rules are heuristic by construction — 'the string appears in a JSX file' is not evidence of product support. |
| `disposition` | RETIRE |
| `action422` | None. Do not port under any circumstances. |
| `futureMinorValue` | Strongly negative. Inferring supportStatus is exactly the R6 violation ('do not make a validator green by weakening the schema or backfilling invented values') and would undermine O1, under which supportedness is a recorded product decision rather than a derived property. |
| `requiredTestsGuards` | None for the retired script. The relevant live guard is validate-catalog.js, which makes supportStatus required and makes unknown-needs-review CI-fatal. |
| `evidenceReason` | RETIRE justified positively: supportStatus is now (a) a required field enforced on every parameter by validate-catalog.js, (b) authored deliberately per parameter with citations, and (c) governed by O1's source hierarchy, with docs-only-not-supported available for the installer-accepts-but-product-does-not-support case (as O3 applies it to osImageStream). That combination replaces the capability with something stronger, and this was a one-time migration for a schema change that has already happened. |

#### G7.21 `scripts/add-support-status-oc-mirror.js`

| Field | Value |
|---|---|
| `path` | scripts/add-support-status-oc-mirror.js |
| `purpose` | One-shot 35-line script setting supportStatus to supported-backend-only on every parameter in the 4.20 oc-mirror catalog, on the rule that oc-mirror parameters have no dedicated UI step. |
| `originalRole` | Phase 0 schema v2.0.0 migration for the one catalog add-support-status-all.js did not cover. |
| `inputs` | data/params/4.20/oc-mirror-v2.json (pinned, line 12) |
| `outputs` | mutates that single file |
| `hardcodedVersionAssumptions` | The full path including the minor is a single pinned constant. |
| `currentStatus` | Not executed. It targets the only oc-mirror catalog that exists (4.20); 4.21 has none, which is L18. |
| `disposition` | RETIRE |
| `action422` | None. O2 authors per-minor oc-mirror catalogs with deliberate supportStatus values. |
| `futureMinorValue` | Negative, for the same reason as its sibling: blanket supportStatus assignment is inference, not evidence. |
| `requiredTestsGuards` | None for the retired script. |
| `evidenceReason` | RETIRE justified positively: O2 (Tranche 0B) gives ImageSetConfiguration a real canonical catalog per minor with real validation, in which every parameter's supportStatus is authored deliberately. Note the blanket rule this script applied is also now questionable — O2 explicitly ends the 'oc-mirror parameters are backend-only and unvalidated' situation, so re-applying a uniform supported-backend-only would prejudge O2's outcome. |

#### G7.22 `scripts/add-v1.7-parameters.js`

| Field | Value |
|---|---|
| `path` | scripts/add-v1.7-parameters.js |
| `purpose` | One-shot addition of 20 high-priority DOC-082 parameters to backend and frontend catalogs with applies_to expansion from 'all' to explicit scenarios and alphabetical insertion; supports --dry-run and --verbose. |
| `originalRole` | v1.7.0 release parameter expansion. |
| `inputs` | missing-parameters-v1.7.0.json (gitignored, under local-docs/ocp-4.20/analysis); data/params/4.20; frontend/src/data/catalogs (FLAT) |
| `outputs` | mutates backend and frontend catalogs |
| `hardcodedVersionAssumptions` | data/params/4.20 and the flat frontend/src/data/catalogs, both pinned (header lines 14-15, constants lines 24-25). |
| `currentStatus` | Unsafe to run today, same flat-path hazard as add-missing-parameters.js, plus a gitignored input dependency. Its work is long since applied. Not executed. |
| `disposition` | RETIRE |
| `action422` | None. |
| `futureMinorValue` | Negative. |
| `requiredTestsGuards` | None for the retired script. |
| `evidenceReason` | RETIRE justified positively: identical replacement to add-missing-parameters.js — evidence-backed catalog authoring in 0B/Tranche 2, validated by validate-catalog.js and mirrored by sync-catalogs.js onto the correct versioned path. The release-specific v1.7.0 scope has no recurrence. |

#### G7.23 `scripts/expand-catalogs-from-agent-doc.js`

| Field | Value |
|---|---|
| `path` | scripts/expand-catalogs-from-agent-doc.js |
| `purpose` | One-shot expansion giving every 4.20 install-config scenario the full shared parameter set taken from bare-metal-agent.json (the Agent-based Installer doc's sections 9.1.1 Required, 9.1.2 Network, 9.1.3 Optional), plus platform-specific parameters, never overwriting the donor. |
| `originalRole` | 4.20 catalog completeness pass. |
| `inputs` | data/params/4.20/bare-metal-agent.json as donor; the other 4.20 catalogs |
| `outputs` | mutates data/params/4.20 scenario files |
| `hardcodedVersionAssumptions` | data/params/4.20 donor path pinned. |
| `currentStatus` | Not executed (mutates tracked catalogs). Its effect is already applied. |
| `disposition` | RETIRE |
| `action422` | None, and the mechanism is explicitly disallowed going forward. |
| `futureMinorValue` | Negative. Propagating one scenario's parameter metadata into eleven others means eleven catalogs cite the Agent-based Installer documentation for parameters a reader would expect to be cited from that scenario's own platform documentation. That is a citation-provenance defect of the same family as the 810 drifted 4.21 citations 0B must repair. |
| `requiredTestsGuards` | None for the retired script. The relevant forward guard is the 0A-1 catalog-citation version guard, extended in spirit to citation appropriateness. |
| `evidenceReason` | RETIRE justified positively: completeness is now enforced by validate-catalog.js (every parameter must carry outputFile, applies_to, supportStatus, version range and non-empty citations with docId, docTitle, sectionHeading and url) and achieved by per-minor evidence-backed authoring in 0B/Tranche 2. A validator that proves completeness replaces a script that manufactures it by copying, and avoids the citation-provenance side effect. |

#### G7.24 `scripts/expand-nutanix-once.js`

| Field | Value |
|---|---|
| `path` | scripts/expand-nutanix-once.js |
| `purpose` | A 31-line one-shot that rebuilt nutanix-ipi.json by taking every non-platform.vsphere parameter from vsphere-ipi.json, rewriting applies_to to nutanix-ipi, and re-attaching the existing platform.nutanix parameters. |
| `originalRole` | 4.20 Nutanix catalog bootstrap. The filename says 'once'. |
| `inputs` | data/params/4.20/vsphere-ipi.json, data/params/4.20/nutanix-ipi.json |
| `outputs` | overwrites data/params/4.20/nutanix-ipi.json |
| `hardcodedVersionAssumptions` | dataDir pinned to data/params/4.20. |
| `currentStatus` | Not executed (overwrites a tracked catalog). It is the most aggressive mutator in the tree: it rebuilds an entire scenario catalog from another platform's catalog. |
| `disposition` | RETIRE |
| `action422` | None. Do not port. |
| `futureMinorValue` | Strongly negative. Cross-PLATFORM parameter copying carries vSphere-sourced citations into Nutanix rows, which is the same defect class as cross-MINOR backfill and is forbidden by the same reasoning as R9. NUTANIX_4_20_IPI_DOC_REVIEW_AND_PLAN.md is the authority for what Nutanix scenario truth should actually be. |
| `requiredTestsGuards` | None for the retired script. |
| `evidenceReason` | RETIRE justified positively: scenario catalogs are now authored per scenario from that scenario's own authoritative documentation — the method demonstrated by the seven platform audits in group G6 and formalised in docs/PARAMS_RECONCILIATION_CHECKLIST.md — and completeness is enforced by validate-catalog.js. The script's own name declares it single-use. |

#### G7.25 `scripts/patch-nutanix-ipi-catalog.mjs`

| Field | Value |
|---|---|
| `path` | scripts/patch-nutanix-ipi-catalog.mjs |
| `purpose` | One-shot nutanix-ipi cleanup: removes arbiter parameters, fixes platform and replicas entries, and replaces Agent-doc citations with the Nutanix install-config parameter documentation URL. |
| `originalRole` | 4.20 Nutanix catalog correction — notably, a repair of the citation damage caused by the copy-based catalog construction described above. |
| `inputs` | frontend/src/data/catalogs/nutanix-ipi.json (line 12, FLAT path) |
| `outputs` | mutates that file |
| `hardcodedVersionAssumptions` | The flat frontend path and a hardcoded 4.20 Nutanix documentation URL. |
| `currentStatus` | BROKEN — would throw ENOENT immediately. Verified by directory listing: frontend/src/data/catalogs contains only the subdirectories 4.20/ and 4.21/, so frontend/src/data/catalogs/nutanix-ipi.json does not exist. It also edits the frontend MIRROR rather than canonical data/params, inverting the authority direction that docs/PARAM_AUTHORITY.md establishes. Not executed. |
| `disposition` | RETIRE |
| `action422` | None. |
| `futureMinorValue` | Negative — broken, and authority-inverted. |
| `requiredTestsGuards` | None for the retired script. |
| `evidenceReason` | RETIRE justified positively: citation correction is now a first-class, evidence-isolated activity — Tranche 0B repairs citations against each minor's own authoritative documentation under R9, with no blind string replacement, and the 0A-1 catalog-citation version guard makes a wrong-minor citation URL a CI failure rather than something a one-shot patch script must chase. That is a strictly stronger replacement for this script's entire purpose, and unlike this script it operates on canonical data rather than the mirror. |

#### G7.26 `scripts/validate-app-version.mjs`

| Field | Value |
|---|---|
| `path` | scripts/validate-app-version.mjs |
| `purpose` | Validates application identity consistency: reads the canonical VERSION file, checks SemVer 2.0.0 validity, and asserts every package.json and lockfile agrees. Exports isValidSemVer, readCanonicalVersion and validate for testing. |
| `originalRole` | Application identity gate; npm run check:app-version. |
| `inputs` | VERSION; the four package.json files, three lockfiles and shared/package.json |
| `outputs` | exit status |
| `hardcodedVersionAssumptions` | None. It validates consistency, not a specific value. Its SemVer regex handles prerelease forms such as 2.1.0-dev. |
| `currentStatus` | Works. Not run here (invoking it is harmless but it is not needed to establish status, and VERSION is confirmed as 2.0.0 by direct read — matching plan precondition P3). It is NOT wired into CI: .github/workflows/ci.yml contains no check:app-version step, which the plan records as correction #3 work for 0A-1. |
| `disposition` | REUSE AS-IS |
| `action422` | No change to the script. 0A-1 moves VERSION to 2.1.0-dev and Tranche 7 to 2.1.0, both via the canonical mechanism, and 0A-1 adds the missing CI step. |
| `futureMinorValue` | High and zero-maintenance. Application version is independent of supported OpenShift minors, and this script correctly treats it that way. |
| `requiredTestsGuards` | Its own test file already exists (below) and must be wired into CI alongside the check itself. |
| `evidenceReason` | REUSE AS-IS: value-agnostic, SemVer-correct, prerelease-capable. The gap is CI wiring, not the script. |

#### G7.27 `scripts/validate-app-version.test.mjs`

| Field | Value |
|---|---|
| `path` | scripts/validate-app-version.test.mjs |
| `purpose` | 309-line node:test suite for the app-version validator, building temporary fixture trees with configurable overrides and asserting both the exported functions and the CLI exit behaviour. |
| `originalRole` | Test coverage for the identity gate; npm run test:app-version. |
| `inputs` | self-contained temporary fixtures under os.tmpdir() |
| `outputs` | test results |
| `hardcodedVersionAssumptions` | Fixture default '2.0.0-dev' — a fixture value, not a product assertion, and it already exercises the prerelease form 0A-1 will adopt. |
| `currentStatus` | Present and self-contained; creates and removes its own temporary fixtures, no network, no repo mutation. Not run here (not required to establish status). Like the validator it guards, it is not in CI. |
| `disposition` | REUSE AS-IS |
| `action422` | No change. Wire test:app-version into CI together with check:app-version. |
| `futureMinorValue` | High. It is the model the new 0A-1 guards should follow: temp-fixture-based, hermetic, exercising both the API and the CLI exit code. |
| `requiredTestsGuards` | Itself. |
| `evidenceReason` | REUSE AS-IS: hermetic, self-cleaning, already covers the prerelease case. Nothing to change. |

#### G7.28 `scripts/validate-frontend-container-layout.mjs`

| Field | Value |
|---|---|
| `path` | scripts/validate-frontend-container-layout.mjs |
| `purpose` | Static validator proving the frontend container build will resolve shared/versionUtils.js imports, run before the expensive container smoke test to catch configuration errors early. |
| `originalRole` | Container build correctness gate; .github/workflows/ci.yml:69. |
| `inputs` | frontend build configuration and the shared module layout |
| `outputs` | exit status |
| `hardcodedVersionAssumptions` | None — it concerns module resolution, not OpenShift versions. |
| `currentStatus` | In CI and presumed green (the plan records no failure and it is not a version-aware check). Not run here. |
| `disposition` | REUSE AS-IS |
| `action422` | None. |
| `futureMinorValue` | Moderate; relevant because shared/versionUtils.js is the canonical version-parsing module CLAUDE.md mandates, so its resolvability in the container is indirectly version-infrastructure-critical. |
| `requiredTestsGuards` | None additional. |
| `evidenceReason` | REUSE AS-IS: version-agnostic build-correctness check, unaffected by adding a minor. |

#### G7.29 `scripts/smoke-frontend-container.sh`

| Field | Value |
|---|---|
| `path` | scripts/smoke-frontend-container.sh |
| `purpose` | Builds and runs the frontend container to prove Vite resolves shared/versionUtils.js at runtime, with unique image and container names per run and rejection of unsafe image-name overrides. |
| `originalRole` | Runtime container smoke test; .github/workflows/ci.yml:71-77. |
| `inputs` | Docker or Podman; the frontend tree |
| `outputs` | exit status and a log |
| `hardcodedVersionAssumptions` | None. |
| `currentStatus` | In CI. Not run here — it builds and runs containers, which is well outside a read-only harvest. |
| `disposition` | REUSE AS-IS |
| `action422` | None. |
| `futureMinorValue` | Moderate, for the same shared/versionUtils.js reason as above. |
| `requiredTestsGuards` | None additional. |
| `evidenceReason` | REUSE AS-IS: version-agnostic. |

#### G7.30 `scripts/set-build-env.sh`

| Field | Value |
|---|---|
| `path` | scripts/set-build-env.sh |
| `purpose` | Emits export statements for APP_GIT_SHA and APP_BUILD_TIME for use with docker run or OpenShift when build args are unavailable. |
| `originalRole` | Build metadata helper. |
| `inputs` | git |
| `outputs` | stdout export statements |
| `hardcodedVersionAssumptions` | None. |
| `currentStatus` | Works; 15 lines, read-only, degrades to 'unknown' outside a git work tree. |
| `disposition` | REUSE AS-IS |
| `action422` | None. |
| `futureMinorValue` | Low but nonzero — build provenance. |
| `requiredTestsGuards` | None. |
| `evidenceReason` | REUSE AS-IS: version-agnostic, out of scope for minor onboarding. |

#### G7.31 `scripts/check-secrets.sh`

| Field | Value |
|---|---|
| `path` | scripts/check-secrets.sh |
| `purpose` | Local secret scan using gitleaks when installed, falling back to ripgrep for high-confidence patterns. |
| `originalRole` | Pre-commit secret scan; the sole hook in .pre-commit-config.yaml. CI runs gitleaks unconditionally in a separate job. |
| `inputs` | a path argument (default .) |
| `outputs` | exit status |
| `hardcodedVersionAssumptions` | None. |
| `currentStatus` | Works; read-only scan. |
| `disposition` | REUSE AS-IS |
| `action422` | None, though .pre-commit-config.yaml itself is PARAMETERIZEd in group G9 to also carry the catalog-sync hook. |
| `futureMinorValue` | Low for version work; high for release hygiene, which CLAUDE.md requires before committing. |
| `requiredTestsGuards` | None. |
| `evidenceReason` | REUSE AS-IS: version-agnostic, out of scope for minor onboarding. |

#### G7.32 `scripts/backup-sqlite.sh`

| Field | Value |
|---|---|
| `path` | scripts/backup-sqlite.sh |
| `purpose` | Kubernetes-aware online SQLite backup using VACUUM INTO, with namespace and backup-directory arguments. |
| `originalRole` | Operations. |
| `inputs` | namespace, backup directory |
| `outputs` | backup files |
| `hardcodedVersionAssumptions` | None. |
| `currentStatus` | Not run (operational script touching a database). Version-agnostic by inspection. |
| `disposition` | REUSE AS-IS |
| `action422` | None — out of scope for minor onboarding. |
| `futureMinorValue` | None for version work. |
| `requiredTestsGuards` | Covered by test-backup-restore.sh. |
| `evidenceReason` | REUSE AS-IS, out of scope: operational tooling with no OpenShift-version coupling. |

#### G7.33 `scripts/restore-sqlite.sh`

| Field | Value |
|---|---|
| `path` | scripts/restore-sqlite.sh |
| `purpose` | Restores the SQLite database from a backup file. Explicitly documented as a DESTRUCTIVE operation that replaces the current database. |
| `originalRole` | Operations. |
| `inputs` | backup file, namespace |
| `outputs` | a replaced database |
| `hardcodedVersionAssumptions` | None. |
| `currentStatus` | Not run, and deliberately so: it is destructive by design and CLAUDE.md requires explicit user approval for destructive operations. Version-agnostic by inspection. |
| `disposition` | REUSE AS-IS |
| `action422` | None — out of scope. |
| `futureMinorValue` | None for version work. |
| `requiredTestsGuards` | Covered by test-backup-restore.sh, which exercises restore without requiring Kubernetes. |
| `evidenceReason` | REUSE AS-IS, out of scope: operational tooling with no OpenShift-version coupling. |

#### G7.34 `scripts/verify-backup.sh`

| Field | Value |
|---|---|
| `path` | scripts/verify-backup.sh |
| `purpose` | Verifies SQLite backup file integrity. |
| `originalRole` | Operations. |
| `inputs` | a backup file |
| `outputs` | exit status |
| `hardcodedVersionAssumptions` | None. |
| `currentStatus` | Not run (no backup file to verify). Version-agnostic by inspection. |
| `disposition` | REUSE AS-IS |
| `action422` | None — out of scope. |
| `futureMinorValue` | None for version work. |
| `requiredTestsGuards` | Covered by test-backup-restore.sh. |
| `evidenceReason` | REUSE AS-IS, out of scope: operational tooling with no OpenShift-version coupling. |

#### G7.35 `scripts/test-backup-restore.sh`

| Field | Value |
|---|---|
| `path` | scripts/test-backup-restore.sh |
| `purpose` | Creates a test database, backs it up, verifies it and tests restore, all without requiring Kubernetes. |
| `originalRole` | Operations test harness. |
| `inputs` | none beyond a temp workspace |
| `outputs` | test results |
| `hardcodedVersionAssumptions` | None. |
| `currentStatus` | Not run (creates databases and files). Version-agnostic by inspection; it is the self-test for the three backup scripts. |
| `disposition` | REUSE AS-IS |
| `action422` | None — out of scope. |
| `futureMinorValue` | None for version work. |
| `requiredTestsGuards` | It is itself the guard for the backup family. |
| `evidenceReason` | REUSE AS-IS, out of scope: operational tooling with no OpenShift-version coupling. |

#### G7.36 `scripts/load-test.sh`

| Field | Value |
|---|---|
| `path` | scripts/load-test.sh |
| `purpose` | Drives realistic concurrent wizard workflows against a running instance to validate resource limits and capacity planning. |
| `originalRole` | Operations and capacity planning (docs/LOAD_TESTING.md, docs/CAPACITY_PLANNING.md). |
| `inputs` | base URL, concurrent users, duration |
| `outputs` | load-test results |
| `hardcodedVersionAssumptions` | None. |
| `currentStatus` | Not run (requires a running instance and generates sustained load). Version-agnostic by inspection. |
| `disposition` | REUSE AS-IS |
| `action422` | None — out of scope. |
| `futureMinorValue` | None for version work. |
| `requiredTestsGuards` | None. |
| `evidenceReason` | REUSE AS-IS, out of scope: operational tooling with no OpenShift-version coupling. |

---

## G8 — Tracked sub-package scripts

**Root:** `backend/scripts/, frontend/scripts/` · **Plan count:** 5 · **Actual:** 5 · ✅ matches

| # | path | disposition | currentStatus (summary) |
|---:|---|---|---|
| 1 | `backend/scripts/crawl-doc-examples.js` | **PARAMETERIZE** | Not run — it performs network acquisition and writes into docs/, both outside the 0A-0 fence. Note docs/e2e-examples/snippets/ does not exist in the t… |
| 2 | `backend/scripts/e2e-matrix.js` | **PARAMETERIZE** | Not run — it writes e2e artifacts and a report into docs/. By inspection it generates and validates for 4.20 only; there is no path to exercise the ma… |
| 3 | `backend/scripts/validate-e2e-examples.js` | **PARAMETERIZE** | Not run — it writes a report into docs/. By inspection its EXAMPLE_MAP is a static scenario-to-example mapping that would need entries for any new exa… |
| 4 | `backend/scripts/entrypoint.sh` | **REUSE AS-IS** | Works (in use in the container image). Not run here. Version-agnostic by inspection; its comments correctly note that neither chown nor chmod can fix … |
| 5 | `frontend/scripts/check-bundle-size.js` | **REUSE AS-IS** | Works but is NOT wired into CI, which Revision 3 2.C lists among the missing CI coverage. Minor defect found while reading: the header comment states … |

#### G8.1 `backend/scripts/crawl-doc-examples.js`

| Field | Value |
|---|---|
| `path` | backend/scripts/crawl-doc-examples.js |
| `purpose` | Fetches every doc URL in a minor's docs-index, extracts install-config, agent-config and imageset examples from code blocks (markdown fences, <pre> and <code>), and writes them to docs/e2e-examples/snippets/ with source URLs plus a snippets inventory. |
| `originalRole` | Part 4 of the e2e example collection effort. |
| `inputs` | data/docs-index/4.20.json (hardcoded, line 14); network |
| `outputs` | docs/e2e-examples/snippets/**, docs/e2e-examples/SNIPPETS_INVENTORY.md |
| `hardcodedVersionAssumptions` | line 14 pins data/docs-index/4.20.json; the header comment says 'Fetch every 4.20 doc URL'. |
| `currentStatus` | Not run — it performs network acquisition and writes into docs/, both outside the 0A-0 fence. Note docs/e2e-examples/snippets/ does not exist in the tree today (only install-config/, agent-config/, INVENTORY.md, README.md and REFERENCE.md are present), so its output was either never committed or has since been removed. |
| `disposition` | PARAMETERIZE |
| `action422` | Take --minor and derive the docs-index path. Acquisition-only (R4). Useful in Tranche 2 for sourcing real 4.22 example YAML rather than hand-writing fixtures. |
| `futureMinorValue` | Moderate. Real documentation examples are the strongest check that generated YAML matches what Red Hat actually publishes. |
| `requiredTestsGuards` | No test may invoke it (R4); its outputs become committed fixtures that tests consume locally. |
| `evidenceReason` | PARAMETERIZE: one hardcoded docs-index path; the crawling and extraction logic is minor-agnostic. |

#### G8.2 `backend/scripts/e2e-matrix.js`

| Field | Value |
|---|---|
| `path` | backend/scripts/e2e-matrix.js |
| `purpose` | Runs the full scenario-by-path e2e matrix (minimal, with-fips, with-proxy, dual-stack, node-counts, aws-with-instance-types, vsphere-failure-domains, bare-metal-provisioning) by calling buildInstallConfig and buildAgentConfig directly, saving generated YAML per cell and writing a report. |
| `originalRole` | Workstream K generation matrix. |
| `inputs` | data/e2e-fixtures/fixtures.json; backend/src/generate.js |
| `outputs` | e2e-artifacts/**, docs/E2E_REPORT_4.20.md |
| `hardcodedVersionAssumptions` | Three distinct kinds. (a) Report path pinned to docs/E2E_REPORT_4.20.md (line 19). (b) A hardcoded release object: release: { channel: "4.20", patchVersion: "4.20.0", confirmed: true } (line 95) — so every generated artifact is a 4.20 artifact. (c) Version-specific validation rules in prose and code, for example the bare-metal-upi rule at lines 448-454 asserting platform must be only none per the 4.20 documentation. |
| `currentStatus` | Not run — it writes e2e artifacts and a report into docs/. By inspection it generates and validates for 4.20 only; there is no path to exercise the matrix at another minor. |
| `disposition` | PARAMETERIZE |
| `action422` | Take --minor, derive both the release object and the report path from it. This is DIRECTLY ENABLING for Revision 3's pre-flip testing strategy: because it calls the generation builders as plain functions rather than through the HTTP boundary, it can exercise 4.22 generation before SUPPORTED_MINORS is widened — exactly the 'pure logic, script-level proof' layer the plan relies on in Tranches 2 and 3. |
| `futureMinorValue` | Very high, and currently underrated. A matrix runner that drives the real builders is the cheapest way to get broad 4.22 generation coverage without touching the public gate. |
| `requiredTestsGuards` | The per-minor validation rules (such as the bare-metal-upi platform rule) must be expressed as version-gated data rather than inline literals, so a 4.22 rule change does not silently apply to 4.20. |
| `evidenceReason` | PARAMETERIZE: the matrix structure and the direct-builder approach are exactly right; only the pinned release object, report path and inline version rules need to become parameters. |

#### G8.3 `backend/scripts/validate-e2e-examples.js`

| Field | Value |
|---|---|
| `path` | backend/scripts/validate-e2e-examples.js |
| `purpose` | Validates each e2e matrix output against the curated example collection: loads artifacts, resolves matching examples by scenario and path through an EXAMPLE_MAP, compares structure and keys, checks imageDigestSources length, and refuses to mark a cell 'pass vs example' unless it was compared against a real matching example or is explicitly reported as 'no example' with its unverified parts named. |
| `originalRole` | Workstream K follow-up part 2. |
| `inputs` | e2e-artifacts/**; docs/e2e-examples/** |
| `outputs` | docs/E2E_PART2_REPORT_4.20.md |
| `hardcodedVersionAssumptions` | Report path pinned to docs/E2E_PART2_REPORT_4.20.md (line 19); the report body cites three 4.20 documentation URLs (lines 291-293) and attributes unverified areas to '4.20 param rules' (line 288). |
| `currentStatus` | Not run — it writes a report into docs/. By inspection its EXAMPLE_MAP is a static scenario-to-example mapping that would need entries for any new example. |
| `disposition` | PARAMETERIZE |
| `action422` | Take --minor for the report path and the cited documentation URLs; keep EXAMPLE_MAP as data. |
| `futureMinorValue` | High, chiefly for its discipline: refusing to claim 'pass vs example' without a real comparison, and naming the unverified parts, is precisely the evidence standard CLAUDE.md requires and the opposite of the false-confidence pattern Revision 3 2.C catalogues. |
| `requiredTestsGuards` | A test asserting that a cell with no matching example is reported as 'no example' with its unverified parts enumerated, never as a pass. |
| `evidenceReason` | PARAMETERIZE: version content is confined to the report path and cited URLs; the comparison logic and its honesty constraint are minor-agnostic and worth preserving verbatim. |

#### G8.4 `backend/scripts/entrypoint.sh`

| Field | Value |
|---|---|
| `path` | backend/scripts/entrypoint.sh |
| `purpose` | Container entrypoint: fixes DATA_DIR ownership as root (chown, falling back to chmod), sources build-env.sh, then drops to the unprivileged app user to run the backend. |
| `originalRole` | Container runtime. |
| `inputs` | DATA_DIR environment variable |
| `outputs` | the running backend process |
| `hardcodedVersionAssumptions` | None. |
| `currentStatus` | Works (in use in the container image). Not run here. Version-agnostic by inspection; its comments correctly note that neither chown nor chmod can fix a missing SELinux :Z label, which must be set in the compose volume mount. |
| `disposition` | REUSE AS-IS |
| `action422` | None. |
| `futureMinorValue` | None for version work. |
| `requiredTestsGuards` | None. |
| `evidenceReason` | REUSE AS-IS: container runtime plumbing with no OpenShift-version coupling. |

#### G8.5 `frontend/scripts/check-bundle-size.js`

| Field | Value |
|---|---|
| `path` | frontend/scripts/check-bundle-size.js |
| `purpose` | Performance budget: walks the built dist directory and fails if total bundle size exceeds a limit. |
| `originalRole` | Frontend performance budget; run after npm run build. |
| `inputs` | frontend/dist; BUNDLE_SIZE_LIMIT_KB environment variable |
| `outputs` | exit status |
| `hardcodedVersionAssumptions` | None. |
| `currentStatus` | Works but is NOT wired into CI, which Revision 3 2.C lists among the missing CI coverage. Minor defect found while reading: the header comment states the default limit is 2048 KB while the code uses 2500 (line 12) — a doc/code mismatch, recorded in the findings queue as FQ-3. |
| `disposition` | REUSE AS-IS |
| `action422` | None to the script. Relevant to this effort only indirectly: adding a third minor's catalogs and a v4.22 Field Guide tree increases bundle size, so wiring this into CI is worth doing before the 4.22 data lands rather than after. |
| `futureMinorValue` | Moderate. Catalog and Field Guide data grow linearly with supported minors, so an unguarded budget will eventually be breached by version work. |
| `requiredTestsGuards` | CI wiring, and correction of the 2048-versus-2500 comment. |
| `evidenceReason` | REUSE AS-IS: version-agnostic and functionally correct; the gaps are CI wiring and a stale comment, neither of which changes its behaviour. |

---

## G9 — CI and hooks

**Root:** `.github/workflows/, repository root, git common dir` · **Plan count:** 4 · **Actual:** 4 · ✅ matches

| # | path | disposition | currentStatus (summary) |
|---:|---|---|---|
| 1 | `.github/workflows/ci.yml` | **PARAMETERIZE** | Four findings from reading. (1) Triggers are limited to branches [master, main, develop] for both push and pull_request, so pushes to work/v2.1-ocp-4.… |
| 2 | `.github/workflows/validate-versioned-copy.yml` | **REUSE AS-IS** | The workflow is correctly shaped — self-test before enforcement is the right order, since a broken classifier should fail before it is trusted to judg… |
| 3 | `.pre-commit-config.yaml` | **PARAMETERIZE** | Works for what it declares, but it is NOT the hook that actually runs catalog sync. Verified by reading: this file contains only check-secrets. The ca… |
| 4 | `<git-common-dir>/hooks/pre-commit  [UNTRACKED — resolved to /home/bistraus/code/openshift-airgap-architect/.git/hooks/pre-commit]` | **REPLACE** | PRESENT and executable — 1711 bytes, mode -rwxr-xr-x, dated 2026-06-29, confirmed by listing the git common directory. The plan's instruction to recor… |

#### G9.1 `.github/workflows/ci.yml`

| Field | Value |
|---|---|
| `path` | .github/workflows/ci.yml |
| `purpose` | Main CI: rejects committed junk, installs and tests backend, installs/builds/tests frontend, uploads logs on failure, runs validate-param-authority.js, runs the frontend container layout validator, runs the container smoke test, and runs Gitleaks in a separate job. |
| `originalRole` | The primary quality gate. |
| `inputs` | the repository |
| `outputs` | CI status |
| `hardcodedVersionAssumptions` | No OpenShift version literals. The version-relevant content is what it OMITS and which branches it watches. |
| `currentStatus` | Four findings from reading. (1) Triggers are limited to branches [master, main, develop] for both push and pull_request, so pushes to work/v2.1-ocp-4.22-onboarding get NO CI; coverage arrives only when a PR targets one of those branches. This matters operationally for every tranche of this effort. (2) validate-param-authority.js is invoked with no argument at line 66, so parity is checked for 4.20 only — and it is currently RED (verified exit 1), meaning this step is failing today. (3) check:app-version and test:app-version are absent. (4) Playwright e2e, bundle-size and catalog-sync drift checks are all absent, matching Revision 3 2.C's missing-CI list. |
| `disposition` | PARAMETERIZE |
| `action422` | 0A-1: add check:app-version (plan work item 12) and the catalog-sync --dry-run drift check (work item 5); ensure the authority gate iterates SUPPORTED_MINORS. Separately, and worth raising now: consider adding the working branch to the trigger list so this effort's tranches get CI feedback before PR time. |
| `futureMinorValue` | High. CI is where the cumulative-support guard, the superset guard and the citation guard must run for the rules to be enforcement rather than convention. |
| `requiredTestsGuards` | The workflow itself is the guard. Its correctness condition is that every gate the plan relies on actually appears as a step. |
| `evidenceReason` | PARAMETERIZE: structurally sound and version-literal-free; what it needs is additional steps and a multi-minor authority invocation, not a rewrite. |

#### G9.2 `.github/workflows/validate-versioned-copy.yml`

| Field | Value |
|---|---|
| `path` | .github/workflows/validate-versioned-copy.yml |
| `purpose` | Two-step guard workflow: run find-hardcoded-versions.sh --self-test, then --check. |
| `originalRole` | CI enforcement of the versioned-copy adjudication ledger. |
| `inputs` | scripts/find-hardcoded-versions.sh |
| `outputs` | CI status |
| `hardcodedVersionAssumptions` | None in the workflow; all version content lives in the script it calls. |
| `currentStatus` | The workflow is correctly shaped — self-test before enforcement is the right order, since a broken classifier should fail before it is trusted to judge the codebase. However the workflow is RED at the baseline: --check exits 1 on the 6 SVG false positives. Verified by running --check directly and by git merge-base confirming the SVG-introducing commit 6e54610 (2026-10-05) is an ancestor of 09703fa. It shares ci.yml's branch-trigger limitation. |
| `disposition` | REUSE AS-IS |
| `action422` | No change to the workflow. Everything that must change lives in find-hardcoded-versions.sh and docs/VERSIONED_COPY_INVENTORY.md. |
| `futureMinorValue` | High and zero-maintenance: it will automatically enforce whatever the improved classifier decides. |
| `requiredTestsGuards` | None for the workflow; the script's self-test is the guard, and the workflow's value is that it runs the self-test first. |
| `evidenceReason` | REUSE AS-IS: the file is six lines of correct orchestration. Its current red status is caused entirely by the script it invokes, which is PARAMETERIZEd in group G7, so changing this file would address nothing. |

#### G9.3 `.pre-commit-config.yaml`

| Field | Value |
|---|---|
| `path` | .pre-commit-config.yaml |
| `purpose` | Pre-commit framework configuration. Currently declares exactly one local hook: check-secrets, running bash scripts/check-secrets.sh with pass_filenames false. |
| `originalRole` | Tracked pre-commit configuration. |
| `inputs` | scripts/check-secrets.sh |
| `outputs` | pre-commit enforcement for developers who have run 'pre-commit install' |
| `hardcodedVersionAssumptions` | None. |
| `currentStatus` | Works for what it declares, but it is NOT the hook that actually runs catalog sync. Verified by reading: this file contains only check-secrets. The catalog-sync hook exists solely as an untracked executable in the git common directory (next row). A fresh clone therefore gets secret scanning and no catalog synchronization. |
| `disposition` | PARAMETERIZE |
| `action422` | Absorb the catalog-sync hook so it is tracked and obtained by every clone, per O4. Consider also adding the catalog parity check once validate-catalog-frontend-parity.js is fixed, so divergence is caught rather than silently auto-corrected. |
| `futureMinorValue` | High. Every added minor multiplies the catalog files that must stay mirrored, and an untracked hook does not scale to additional contributors or machines. |
| `requiredTestsGuards` | A check that the tracked configuration declares the catalog-sync hook, so it cannot silently revert to untracked-only. |
| `evidenceReason` | PARAMETERIZE: the file is valid and its existing hook is correct; what is required is extending it to cover the capability currently provided only by an untracked file. |

#### G9.4 `<git-common-dir>/hooks/pre-commit  [UNTRACKED — resolved to /home/bistraus/code/openshift-airgap-architect/.git/hooks/pre-commit]`

| Field | Value |
|---|---|
| `path` | <git-common-dir>/hooks/pre-commit  [UNTRACKED — resolved to /home/bistraus/code/openshift-airgap-architect/.git/hooks/pre-commit] |
| `purpose` | Untracked executable pre-commit hook. Detects staged catalog files matching data/params/<minor>/*.json or frontend/src/data/catalogs/<minor>/*.json, runs node scripts/sync-catalogs.js, aborts the commit if sync fails, and re-stages the versioned catalog files (explicitly 'no flat files'). |
| `originalRole` | Catalog mirror enforcement on the maintainer's machine. |
| `inputs` | the staged file list; scripts/sync-catalogs.js |
| `outputs` | synchronized and re-staged catalog files; commit abort on sync failure |
| `hardcodedVersionAssumptions` | None. Its detection regexes and its git add globs both use [0-9]+\.[0-9]+ / [0-9]*.[0-9]* version patterns, so it is genuinely minor-agnostic and will pick up 4.22 with no edit. |
| `currentStatus` | PRESENT and executable — 1711 bytes, mode -rwxr-xr-x, dated 2026-06-29, confirmed by listing the git common directory. The plan's instruction to record its absence does not apply; it exists. IMPORTANT PRECISION on L8: the plan describes it as 'the only live parity enforcement'. Reading it shows it is an auto-SYNCER, not an enforcer — it overwrites the mirror from canonical and re-stages, so divergence is silently corrected rather than reported. That is a materially different guarantee: it keeps the maintainer's commits consistent, but it would never surface a case where someone edited the frontend mirror intending that edit to count. Verified by reading. Note also it lives in the SHARED common git directory, so it applies to this worktree too. |
| `disposition` | REPLACE |
| `action422` | Replace the untracked file with a tracked equivalent: declare the catalog-sync hook in .pre-commit-config.yaml (or add a tracked scripts/hooks/pre-commit plus a documented install step), and ADD a real parity assertion alongside the sync once validate-catalog-frontend-parity.js is fixed, so divergence fails loudly instead of being absorbed. |
| `futureMinorValue` | High. This is the exact single-machine bus-factor artifact O4 exists to eliminate: correct, load-bearing, minor-agnostic, and present on precisely one machine. |
| `requiredTestsGuards` | A test or CI step asserting the tracked configuration provides catalog synchronization, plus the fixed parity validator running in CI so the guarantee does not depend on any hook being installed at all. |
| `evidenceReason` | REPLACE with a named positive replacement (tracked hook configuration plus CI-enforced parity). Not REUSE AS-IS, because an untracked file cannot be reused by anyone else. Not RETIRE, because the capability is load-bearing today. Recorded here rather than left implicit because the plan asked for its absence to be recorded if absent — it is present, and its real behaviour differs from how the plan characterised it. |

---

## G10 — Workflow documentation

**Root:** `docs/` · **Plan count:** ~18 (20 paths named) · **Actual:** 18 · ⚠ **does not match**

> **Count discrepancy.** Revision 3 §3.0 names 20 document paths; 18 exist. docs/SCENARIO_CATALOG_PLAN.md and docs/HANDOFF_PACKET.md have NEVER existed as tracked files (git log --all --diff-filter=A returns nothing for either). Both are recorded in docs/LOCAL_IGNORED_DOCS_TRIAGE.md as local gitignored docs triaged archive_now. See discrepancy D5. No rows are invented for them.

| # | path | disposition | currentStatus (summary) |
|---:|---|---|---|
| 1 | `docs/PARAM_AUTHORITY.md` | **REPLACE** | Partly stale and actively misleading. Verified by grep: line 9 still prescribes the flat frontend path. A contributor following this document literall… |
| 2 | `docs/DATA_AND_FRONTEND_COPIES.md` | **REPLACE** | Stale in three distinct ways, all verified by reading the full file. (1) Flat frontend catalog paths at lines 23, 31 and 40. (2) A false CI claim at l… |
| 3 | `docs/CATALOG_SYNC_GUIDE.md` | **REPLACE** | Stale. Verified by reading its overview and grepping: it describes the two locations as 'data/params/4.20/ — Backend/canonical source (12 files)' and … |
| 4 | `docs/PARAMETER_CATALOG.md` | **PARAMETERIZE** | Stale on layout and authority. Verified by reading the header and grepping line 273. Naming the frontend mirror as THE location is the same authority … |
| 5 | `docs/NEW_SCENARIO_COVERAGE_CHECKLIST.md` | **PARAMETERIZE** | Nearly correct. Verified by grep: zero version literals, one flat frontend path. |
| 6 | `docs/PARAMS_RECONCILIATION_CHECKLIST.md` | **PARAMETERIZE** | Nearly correct, with one authority-inverting suggestion. Verified by grep. Offering the mirror as an acceptable file to open is how the authority inve… |
| 7 | `docs/PARAMS_CATALOG_RULES.md` | **REUSE AS-IS** | Correct on structure. It is the ONLY document in this group that gets both the versioned layout and the canonical-only authority right. Its per-parame… |
| 8 | `docs/DOC_INDEX_RULES.md` | **PARAMETERIZE** | Structurally correct and carries two durable rules verified by reading: docs.redhat.com is the only canonical source and docs.openshift.com is shut do… |
| 9 | `docs/VERSIONED_COPY_INVENTORY.md` | **PARAMETERIZE** | Accurate for what it covers and in sync with the script's categories, but now incomplete in two ways. (1) It documents the search pattern as '4\.([0-9… |
| 10 | `docs/VERSION_AWARE_UI_FIELD_CHECKLIST.md` | **REUSE AS-IS** | Clean and current. The only document in this group with no version literal and no stale path. |
| 11 | `docs/VERSION_AWARENESS_MASTER_STRATEGY.md` | **PARAMETERIZE** | Historically important and partly superseded. Still marked 'Version: 1.0 DRAFT' and 'Status: Phase 1 Architecture Design - AWAITING APPROVAL' although… |
| 12 | `docs/VERSION_AWARENESS_COMPLETION_MATRIX.md` | **PARAMETERIZE** | Stale by date and by authority. Last updated 2026-09-18, which Revision 3 2.A correctly notes predates the final v2.0.0 reconciliation commits — and t… |
| 13 | `docs/SCENARIOS_GUIDE.md` | **PARAMETERIZE** | Current as navigation and correctly scoped, but version-skewed: it names 4.20 throughout while the product supports 4.20 and 4.21. No flat-path defect… |
| 14 | `docs/SCENARIOS_BARE_METAL_FAMILY.md` | **PARAMETERIZE** | Current as navigation, version-skewed to 4.20. No flat-path defects. |
| 15 | `docs/SCENARIOS_CLOUD_FAMILY.md` | **PARAMETERIZE** | Current as navigation, version-skewed to 4.20. It explicitly acknowledges that these scenarios have no per-scenario deep doc — unlike bare metal and v… |
| 16 | `docs/SCENARIOS_NUTANIX_FAMILY.md` | **PARAMETERIZE** | Current as navigation, version-skewed to 4.20. |
| 17 | `docs/SCENARIOS_VSPHERE_FAMILY.md` | **PARAMETERIZE** | Current as navigation, version-skewed to 4.20. vSphere has by far the largest tracked document set — five additional VSPHERE_* documents in docs/ beyo… |
| 18 | `docs/IMPLEMENTATION_ROADMAP_2026-05-14.md` | **PARAMETERIZE** | Stale on two counts, verified by reading the header: last updated 2026-08-13, and it still describes v2.0.0 as 'Phases 0-2 complete, Phases 3-5 active… |

#### G10.1 `docs/PARAM_AUTHORITY.md`

| Field | Value |
|---|---|
| `path` | docs/PARAM_AUTHORITY.md |
| `purpose` | Declares data/params/<version>/ the single source of truth for installation parameters and data/docs-index/<version>.json canonical for per-scenario doc links, with rules for contributors and automation and a pointer to the CI authority gate. |
| `originalRole` | The parameter-authority contract. |
| `inputs` | n/a |
| `outputs` | governance |
| `hardcodedVersionAssumptions` | Canonical paths are correctly written as <version>. The defect is the frontend side: rule 1 instructs copying to frontend/src/data/catalogs/<scenario-id>.json — the FLAT path removed by the versioned migration. |
| `currentStatus` | Partly stale and actively misleading. Verified by grep: line 9 still prescribes the flat frontend path. A contributor following this document literally would create a stray flat catalog file, which is the precise hazard described on the add-missing-parameters.js row. |
| `disposition` | REPLACE |
| `action422` | Rewrite in 0A-1 (an explicitly permitted path under the 0A-1 fence): correct the frontend path to frontend/src/data/catalogs/<version>/<scenario-id>.json, replace manual copying with sync-catalogs.js, and state the authority direction unambiguously (canonical to mirror, never the reverse). |
| `futureMinorValue` | High. It is the document a contributor reads to learn where parameter truth lives, so a wrong path here propagates everywhere. |
| `requiredTestsGuards` | A docs guard asserting no tracked governance document references a flat frontend catalog path, which would have caught this at migration time. |
| `evidenceReason` | REPLACE rather than PARAMETERIZE: the error is not a version literal but a structurally wrong instruction that post-dates the ADR-001/005 migration, and Revision 3 2.A independently classifies this document as HISTORICAL/STALE describing the pre-ADR flat layout. |

#### G10.2 `docs/DATA_AND_FRONTEND_COPIES.md`

| Field | Value |
|---|---|
| `path` | docs/DATA_AND_FRONTEND_COPIES.md |
| `purpose` | Defines one standard location for repo data and its frontend copies, with a sync table, consumer list and contributor rules. |
| `originalRole` | Data-location contract. |
| `inputs` | n/a |
| `outputs` | governance |
| `hardcodedVersionAssumptions` | Canonical paths correct (<version>). Frontend catalog paths wrong: the sync table and the contributor rule both use frontend/src/data/catalogs/*.json and .../<scenario-id>.json, flat. |
| `currentStatus` | Stale in three distinct ways, all verified by reading the full file. (1) Flat frontend catalog paths at lines 23, 31 and 40. (2) A false CI claim at line 27: it states CI 'requires each frontend/src/data/catalogs/<scenario>.json to match data/params/4.20/<scenario>.json' — CI does invoke that check, but the check is broken (empty flat readdir), so the stated guarantee does not hold. (3) Advice at line 23 to 'copy only the scenario files the UI actually uses' and 'do not copy all scenarios upfront', which contradicts sync-catalogs.js's whole-directory mirroring and the parity validator's set-equality assertion. Its docs-index guidance, by contrast, is correct and versioned. |
| `disposition` | REPLACE |
| `action422` | Rewrite in 0A-1: versioned frontend paths; describe sync-catalogs.js as the mechanism rather than manual copying; remove the partial-copy advice; and restate the CI guarantee only once the parity validator is actually fixed. |
| `futureMinorValue` | High. A document asserting a CI guarantee that does not hold is worse than silence, because it discourages the very verification that would catch the gap. |
| `requiredTestsGuards` | The same no-flat-path docs guard, plus the fixed parity validator so the restated claim is true. |
| `evidenceReason` | REPLACE rather than PARAMETERIZE: the false CI guarantee and the contradicted partial-copy rule are substantive content errors, not version literals. Revision 3 2.A also classifies this document as HISTORICAL/STALE. |

#### G10.3 `docs/CATALOG_SYNC_GUIDE.md`

| Field | Value |
|---|---|
| `path` | docs/CATALOG_SYNC_GUIDE.md |
| `purpose` | Explains the two-location catalog model and the synchronization workflow. |
| `originalRole` | Catalog sync operational guide. |
| `inputs` | n/a |
| `outputs` | governance |
| `hardcodedVersionAssumptions` | Pervasive 4.20 (11 occurrences) and flat frontend paths. |
| `currentStatus` | Stale. Verified by reading its overview and grepping: it describes the two locations as 'data/params/4.20/ — Backend/canonical source (12 files)' and 'frontend/src/data/catalogs/ — Frontend source (12 files)'. Both are wrong today: data/params/4.20 holds 13 files (the 12 scenarios plus oc-mirror-v2.json) and the frontend location is versioned. Its worked examples at lines 102 and 110 use flat paths, and line 110 shows copying FROM the frontend INTO data/params/4.20 — the reverse of the authority direction PARAM_AUTHORITY.md establishes. |
| `disposition` | REPLACE |
| `action422` | Rewrite in 0A-1 against the versioned layout and sync-catalogs.js, with the authority direction stated once and never contradicted by an example. NOTE: Revision 3 2.A does NOT list this document among the stale ones; it is an additional finding of this harvest (discrepancy D6). |
| `futureMinorValue` | High — it is the guide most likely to be read by someone about to touch catalogs. |
| `requiredTestsGuards` | The no-flat-path docs guard, and ideally a guard that no document shows copying from mirror to canonical. |
| `evidenceReason` | REPLACE rather than PARAMETERIZE: wrong file counts, wrong layout and a reversed authority example are content errors throughout, not substitutable literals. Recorded as an addition to the plan's stale-doc list. |

#### G10.4 `docs/PARAMETER_CATALOG.md`

| Field | Value |
|---|---|
| `path` | docs/PARAMETER_CATALOG.md |
| `purpose` | 664-line reference for the parameter catalog system: structure, metadata fields, allowed values, defaults, citations, and instructions for creating a new scenario catalog. |
| `originalRole` | Catalog schema reference. |
| `inputs` | n/a |
| `outputs` | governance |
| `hardcodedVersionAssumptions` | Declares 'Location: frontend/src/data/catalogs/' at the top — both flat AND pointing at the mirror rather than canonical. Line 273 instructs creating frontend/src/data/catalogs/<scenario-id>.json. 11 occurrences of 4.20, 7 of 4.21. |
| `currentStatus` | Stale on layout and authority. Verified by reading the header and grepping line 273. Naming the frontend mirror as THE location is the same authority inversion seen in analyze-catalog-gaps.js and patch-nutanix-ipi-catalog.mjs — a recurring pattern worth noting rather than treating as three unrelated slips. |
| `disposition` | PARAMETERIZE |
| `action422` | 0A-1: correct the location to canonical data/params/<version>/, correct the creation instructions, and ensure the documented schema matches what validate-catalog.js actually enforces (supportStatus, minVersion, maxVersion and the rest of schema v2.0.0). |
| `futureMinorValue` | High. It is the reference a Tranche 2 author will consult while writing the 4.22 catalogs. |
| `requiredTestsGuards` | The §1.1 schema-conformance test, which makes schema/catalog-parameter-schema.json non-decorative, is the structural fix; this document should then describe that schema rather than restate it independently. |
| `evidenceReason` | PARAMETERIZE rather than REPLACE: the bulk of the 664 lines is accurate schema description that remains useful; the defects are a wrong location header, a wrong creation path and version literals. Revision 3 2.A does not list this document as stale — an additional harvest finding (discrepancy D6). |

#### G10.5 `docs/NEW_SCENARIO_COVERAGE_CHECKLIST.md`

| Field | Value |
|---|---|
| `path` | docs/NEW_SCENARIO_COVERAGE_CHECKLIST.md |
| `purpose` | Per-scenario onboarding checklist: canonical doc sweep using docs.redhat.com only, collecting the full scenario family, and the artifacts each new scenario requires. |
| `originalRole` | Scenario onboarding gate. |
| `inputs` | n/a |
| `outputs` | governance |
| `hardcodedVersionAssumptions` | No 4.20 or 4.21 literals at all — commendably version-neutral. One flat-path defect: line 48 lists the required artifact as 'frontend catalog copy (frontend/src/data/catalogs/<scenario>.json)'. |
| `currentStatus` | Nearly correct. Verified by grep: zero version literals, one flat frontend path. |
| `disposition` | PARAMETERIZE |
| `action422` | 0A-1: fix the one flat path to frontend/src/data/catalogs/<version>/<scenario>.json. Otherwise reusable for 4.22 as written. |
| `futureMinorValue` | High. It is already version-neutral, which is exactly the property the rest of the documentation set should be converging on. |
| `requiredTestsGuards` | The no-flat-path docs guard. |
| `evidenceReason` | PARAMETERIZE: a single-line path correction. Its version-neutrality is a positive model worth noting rather than a defect to fix. |

#### G10.6 `docs/PARAMS_RECONCILIATION_CHECKLIST.md`

| Field | Value |
|---|---|
| `path` | docs/PARAMS_RECONCILIATION_CHECKLIST.md |
| `purpose` | Scenario-by-scenario checklist for reconciling a params catalog against official install-config or agent-config documentation, scoped to one (platform, version, install method) per run. |
| `originalRole` | The reconciliation method, paired with scripts/validate-catalog-vs-doc-params.js and demonstrated by the group G6 platform audits. |
| `inputs` | n/a |
| `outputs` | governance |
| `hardcodedVersionAssumptions` | One 4.20 reference, as an example scope ('e.g. vSphere 4.20 IPI') which is legitimate. One flat-path defect at line 26 offering 'frontend copy frontend/src/data/catalogs/<scenario>.json' as an alternative to the canonical file. |
| `currentStatus` | Nearly correct, with one authority-inverting suggestion. Verified by grep. Offering the mirror as an acceptable file to open is how the authority inversion seen elsewhere gets learned. |
| `disposition` | PARAMETERIZE |
| `action422` | 0A-1: remove the frontend-copy alternative entirely and name only the canonical path; its version example is fine as-is. |
| `futureMinorValue` | High. This checklist plus the G6 audits is the human-semantic method that no automation replaces, and Tranche 0B and Tranche 2 both depend on it. |
| `requiredTestsGuards` | The no-flat-path docs guard. |
| `evidenceReason` | PARAMETERIZE: one line to remove. The method itself is sound and directly reusable for 4.22. |

#### G10.7 `docs/PARAMS_CATALOG_RULES.md`

| Field | Value |
|---|---|
| `path` | docs/PARAMS_CATALOG_RULES.md |
| `purpose` | Rules for data/params: one JSON file per scenario per version at data/params/<version>/<scenario-id>.json, required top-level keys, required per-parameter fields, and a pointer to the CI workflow. |
| `originalRole` | Catalog file-format rules. |
| `inputs` | n/a |
| `outputs` | governance |
| `hardcodedVersionAssumptions` | 7 occurrences of 4.20, all in command examples such as 'node scripts/validate-catalog.js data/params/4.20'. Zero flat-path references — verified by grep. |
| `currentStatus` | Correct on structure. It is the ONLY document in this group that gets both the versioned layout and the canonical-only authority right. Its per-parameter field list predates schema v2.0.0 (it names path, outputFile, type, allowed, default, required, description, applies_to, citations but not supportStatus, minVersion or maxVersion), so it is incomplete relative to what validate-catalog.js enforces. |
| `disposition` | REUSE AS-IS |
| `action422` | No structural change needed for 4.22 — a data/params/4.22/ directory is already what this document prescribes. The schema v2.0.0 field list should be completed, but that is the §1.1 schema-conformance work rather than a layout correction. |
| `futureMinorValue` | High and low-maintenance. It is the template the other five documents in this group should be rewritten to match. |
| `requiredTestsGuards` | The §1.1 conformance test ensures the documented and enforced schemas agree. |
| `evidenceReason` | REUSE AS-IS on the layout and authority question, which is what this harvest is assessing: correct versioned paths, canonical-only, no flat references. The incomplete field list is recorded as a known gap closed by the §1.1 work, not by rewriting this document. |

#### G10.8 `docs/DOC_INDEX_RULES.md`

| Field | Value |
|---|---|
| `path` | docs/DOC_INDEX_RULES.md |
| `purpose` | Rules for data/docs-index: its purpose as a scenario-to-doc-page map, canonical source restrictions, base URL conventions, and how to record gaps. |
| `originalRole` | Docs-index contract. |
| `inputs` | n/a |
| `outputs` | governance |
| `hardcodedVersionAssumptions` | 6 occurrences of 4.20, including the base URL given concretely as 'Base URL for 4.20: https://docs.redhat.com/en/documentation/openshift_container_platform/4.20/'. |
| `currentStatus` | Structurally correct and carries two durable rules verified by reading: docs.redhat.com is the only canonical source and docs.openshift.com is shut down and must not be added or retained; and where an equivalent page cannot be located, the gap must be documented in the doc entry's notes and in the scenario working doc rather than silently omitted — a no-guessing rule predating R6. It also references schema/scenarios.json (line 23), which §1.1 establishes as dead and slated for deletion. |
| `disposition` | PARAMETERIZE |
| `action422` | 0A-1: generalise the base URL to <version> with 4.20 as an example, and remove the scenarios.json reference as part of work item 7. Add 4.22 once its docs-index exists. |
| `futureMinorValue` | High. The document-the-gap rule is exactly what Tranche 2 needs when a 4.22 page has no 4.21 equivalent, and the docs.openshift.com prohibition prevents resurrecting dead URLs. |
| `requiredTestsGuards` | validate-docs-index.js already enforces the schema; a guard asserting no tracked docs-index entry uses a docs.openshift.com URL would make the prohibition enforceable rather than advisory. |
| `evidenceReason` | PARAMETERIZE: concrete version literals plus one reference to a file being deleted. The substantive rules are correct and worth preserving verbatim. |

#### G10.9 `docs/VERSIONED_COPY_INVENTORY.md`

| Field | Value |
|---|---|
| `path` | docs/VERSIONED_COPY_INVENTORY.md |
| `purpose` | The nine-category adjudication ledger backing find-hardcoded-versions.sh: enforcement description, search pattern, a resolved-violations table with per-file lines and resolving commits, and the adjudicated exclusions with their category codes. |
| `originalRole` | The documentary half of the versioned-copy guard; CLAUDE.md-adjacent governance. |
| `inputs` | n/a |
| `outputs` | governance; the human-readable justification for every classifier exclusion |
| `hardcodedVersionAssumptions` | 24 occurrences of 4.20 and 12 of 4.21, necessarily — the adjudications are deliberately narrow and enumerate exact versions and phrases. |
| `currentStatus` | Accurate for what it covers and in sync with the script's categories, but now incomplete in two ways. (1) It documents the search pattern as '4\.([0-9]{2,}) — detects all OpenShift 4.x two-digit minors (4.10+)' with no acknowledgement that it also matches decimal fragments such as the 4.25 inside 14.25, which is the live 6-finding failure. (2) It contains no SVG or non-version-numeric category. Its resolved-violations table is otherwise exemplary: file, exact lines, resolution and commit for every entry. |
| `disposition` | PARAMETERIZE |
| `action422` | Two updates, in two different tranches, and they must not be merged. 0A-1: document the SVG/decimal-fragment false-positive class and the adjudication chosen for it, alongside the classifier fix. Tranche 2: add the 4.22 adjudications in the SAME commit as the 4.22 copy they justify, per L17. |
| `futureMinorValue` | Very high. The per-exclusion justification is what keeps the guard from degenerating into whole-file suppressions, and it is the artifact that makes the classifier auditable by a human. |
| `requiredTestsGuards` | Ideally a guard asserting every category code used in find-hardcoded-versions.sh appears in this ledger and vice versa, so script and ledger cannot drift. |
| `evidenceReason` | PARAMETERIZE: the structure and discipline are right; the content needs a new category and the 4.22 entries. Not REPLACE — the resolved-violations history is valuable and must be preserved. |

#### G10.10 `docs/VERSION_AWARE_UI_FIELD_CHECKLIST.md`

| Field | Value |
|---|---|
| `path` | docs/VERSION_AWARE_UI_FIELD_CHECKLIST.md |
| `purpose` | 87-line operational checklist for adding a version-gated parameter field to the frontend, to be completed in full before opening a PR, with docs/DESIGN_SYSTEM.md named as the canonical contract. |
| `originalRole` | UI version-gating gate; CLAUDE.md directs agents to read it before adding or modifying version-gated UI fields. |
| `inputs` | n/a |
| `outputs` | governance |
| `hardcodedVersionAssumptions` | NONE. Verified by grep: zero occurrences of 4.20 and zero of 4.21, and no flat paths. |
| `currentStatus` | Clean and current. The only document in this group with no version literal and no stale path. |
| `disposition` | REUSE AS-IS |
| `action422` | No change. Use as written for the Tranche 3 version-gated 4.22 fields (provisioningNetworkGateway, AWS and Azure ipFamily). |
| `futureMinorValue` | Very high precisely because it is version-neutral — it required no maintenance across the 4.20 to 4.21 transition and will require none for 4.22. |
| `requiredTestsGuards` | None. Its canonical contract, docs/DESIGN_SYSTEM.md, is separately correct on versioned catalog paths (verified: it references frontend/src/data/catalogs/<version>/<scenario>.json). |
| `evidenceReason` | REUSE AS-IS: genuinely version-neutral, correctly subordinated to DESIGN_SYSTEM.md, and the clearest demonstration in the repository that governance documents do not have to carry version literals at all. |

#### G10.11 `docs/VERSION_AWARENESS_MASTER_STRATEGY.md`

| Field | Value |
|---|---|
| `path` | docs/VERSION_AWARENESS_MASTER_STRATEGY.md |
| `purpose` | 1,216-line architecture design for the version-awareness system, scoped as 'OpenShift 4.20 (Baseline) to 4.21 (First Target)', targeting v2.0.0 as a breaking change. |
| `originalRole` | The v2.0.0 version-awareness architecture authority. |
| `inputs` | n/a |
| `outputs` | the architecture that v2.0.0 implemented |
| `hardcodedVersionAssumptions` | 43 occurrences of 4.20 and 41 of 4.21; its stated scope is explicitly the two-minor transition. |
| `currentStatus` | Historically important and partly superseded. Still marked 'Version: 1.0 DRAFT' and 'Status: Phase 1 Architecture Design - AWAITING APPROVAL' although the architecture shipped in v2.0.0. Revision 3 2.A records that its line 206 references scripts/validate-param-support-status.js, which was NEVER WRITTEN — confirmed: no such file exists in scripts/. |
| `disposition` | PARAMETERIZE |
| `action422` | Update in 0A-1 or Tranche 7: correct the stale DRAFT/AWAITING APPROVAL status, generalise the two-minor framing to the cumulative rule (R8, §1.0), and resolve the dangling reference to the never-written validator by either writing it or removing the reference. |
| `futureMinorValue` | Moderate as architecture (the design is implemented and stable); high as the record of WHY the version-awareness architecture looks the way it does. |
| `requiredTestsGuards` | A docs guard asserting no governance document references a script that does not exist would have caught the dangling validator reference. |
| `evidenceReason` | PARAMETERIZE: the architecture is sound and implemented; what is stale is the two-minor scope framing, the draft status and one dangling reference. Not REPLACE — the design rationale is irreplaceable. |

#### G10.12 `docs/VERSION_AWARENESS_COMPLETION_MATRIX.md`

| Field | Value |
|---|---|
| `path` | docs/VERSION_AWARENESS_COMPLETION_MATRIX.md |
| `purpose` | 613-line completion matrix tracking version-awareness work, pinned to specific accepted baselines (2afd742 for the identity sync, 8282f68 for the Field Guide milestone, 1d3b2e4 for the GA register). |
| `originalRole` | Version-awareness status tracking under DOC-059. |
| `inputs` | n/a |
| `outputs` | status claims |
| `hardcodedVersionAssumptions` | 32 occurrences of 4.20, 62 of 4.21 — the densest 4.21 content of any tracked document. |
| `currentStatus` | Stale by date and by authority. Last updated 2026-09-18, which Revision 3 2.A correctly notes predates the final v2.0.0 reconciliation commits — and the baseline for this effort, 09703fa, is dated later still. Per CLAUDE.md's documentation authority hierarchy, docs/BACKLOG_STATUS.md is the single source of truth for status claims, so this matrix is supporting evidence rather than authority. It also records its branch as supervised/v2.0, which is not this effort's branch. |
| `disposition` | PARAMETERIZE |
| `action422` | Extend for 4.22 during Tranche 4 and reconcile in Tranche 7 — and only AFTER final tested behaviour, per CLAUDE.md execution-contract rule 8. Treat its current contents as as-of-2026-09-18 claims requiring re-verification before reuse (R5). |
| `futureMinorValue` | High as a per-minor completion matrix, provided it is regenerated or reconciled rather than trusted as-is. |
| `requiredTestsGuards` | None (status document). Its correctness condition is that it never contradicts docs/BACKLOG_STATUS.md. |
| `evidenceReason` | PARAMETERIZE: it must grow a 4.22 dimension. Explicitly NOT an authority for status in this effort — BACKLOG_STATUS.md is — and its claims carry a date that precedes the baseline. |

#### G10.13 `docs/SCENARIOS_GUIDE.md`

| Field | Value |
|---|---|
| `path` | docs/SCENARIOS_GUIDE.md |
| `purpose` | The canonical scenario navigation entry point: where scenario truth lives, scoped to tracked repository docs, with local and archived docs triaged through docs/LOCAL_IGNORED_DOCS_TRIAGE.md. |
| `originalRole` | Canonical scenario navigation; named as such by every platform audit in group G6. |
| `inputs` | n/a |
| `outputs` | navigation |
| `hardcodedVersionAssumptions` | 15 occurrences of 4.20; no 4.21. The scenario map is framed around 4.20 scenarios. |
| `currentStatus` | Current as navigation and correctly scoped, but version-skewed: it names 4.20 throughout while the product supports 4.20 and 4.21. No flat-path defects — verified by grep. |
| `disposition` | PARAMETERIZE |
| `action422` | Generalise the scenario map so scenarios are described independently of minor, with per-minor specifics delegated to the catalogs and docs-index. Scenario identity (platform x install method) does not vary by minor, so this document should not either. |
| `futureMinorValue` | High. Because scenario identity is minor-invariant, a version-neutral rewrite is low effort and permanently removes this document from the per-minor maintenance set. |
| `requiredTestsGuards` | None. |
| `evidenceReason` | PARAMETERIZE: version literals in a document describing something that is not version-specific. It is also the document that pointed this harvest to LOCAL_IGNORED_DOCS_TRIAGE.md, which resolved discrepancy D5. |

#### G10.14 `docs/SCENARIOS_BARE_METAL_FAMILY.md`

| Field | Value |
|---|---|
| `path` | docs/SCENARIOS_BARE_METAL_FAMILY.md |
| `purpose` | Family-level consolidation guide for bare-metal scenarios (bare-metal-ipi, bare-metal-upi, bare-metal-agent), centralising navigation and validation status without replacing the deep working docs. |
| `originalRole` | Bare-metal family navigation. |
| `inputs` | n/a |
| `outputs` | navigation |
| `hardcodedVersionAssumptions` | 10 occurrences of 4.20; no 4.21. |
| `currentStatus` | Current as navigation, version-skewed to 4.20. No flat-path defects. |
| `disposition` | PARAMETERIZE |
| `action422` | Generalise alongside SCENARIOS_GUIDE.md. Bare metal carries the most 4.22-specific change of any family — platform.baremetal.provisioningNetworkGateway is Revision 3's strongest supported-ui candidate, and heterogeneous ARM compute on bare metal is the O8 boundary — so this family guide is the natural place for the O8 scope statement Tranche 4 must add. |
| `futureMinorValue` | High, and the highest of the four family guides for this specific effort. |
| `requiredTestsGuards` | None. |
| `evidenceReason` | PARAMETERIZE: version literals in minor-invariant navigation content, plus a concrete 4.22 role as the home for the O8 boundary note. |

#### G10.15 `docs/SCENARIOS_CLOUD_FAMILY.md`

| Field | Value |
|---|---|
| `path` | docs/SCENARIOS_CLOUD_FAMILY.md |
| `purpose` | Family guide for cloud scenarios (aws-govcloud-ipi/upi, azure-government-ipi/upi, ibm-cloud-ipi) that lack a deep standalone tracked doc each; canonical for cloud scenario navigation and coverage framing. |
| `originalRole` | Cloud family navigation. |
| `inputs` | n/a |
| `outputs` | navigation |
| `hardcodedVersionAssumptions` | 8 occurrences of 4.20; no 4.21. |
| `currentStatus` | Current as navigation, version-skewed to 4.20. It explicitly acknowledges that these scenarios have no per-scenario deep doc — unlike bare metal and vSphere, which have seven between them in group G6. That is an honest statement of uneven coverage depth. |
| `disposition` | PARAMETERIZE |
| `action422` | Generalise alongside the others. Directly relevant to 4.22: both AWS and Azure gain platform-level ipFamily enums (Revision 3 2.D), affecting exactly the four scenarios this guide covers, and both are supported-ui candidates for Tranche 3. |
| `futureMinorValue` | High, and its acknowledged shallower coverage is itself useful: it tells a 4.22 reviewer that AWS and Azure changes will NOT have a deep working doc to check against, so more primary documentation review is required. |
| `requiredTestsGuards` | None. |
| `evidenceReason` | PARAMETERIZE: version literals in minor-invariant navigation, plus a concrete 4.22 role for the two ipFamily additions. |

#### G10.16 `docs/SCENARIOS_NUTANIX_FAMILY.md`

| Field | Value |
|---|---|
| `path` | docs/SCENARIOS_NUTANIX_FAMILY.md |
| `purpose` | Family guide isolating Nutanix scenario truth (nutanix-ipi) so the cloud-family guidance stays focused. |
| `originalRole` | Nutanix family navigation. |
| `inputs` | n/a |
| `outputs` | navigation |
| `hardcodedVersionAssumptions` | 4 occurrences of 4.20; no 4.21. The shortest family guide at 57 lines, matching its single supported scenario. |
| `currentStatus` | Current as navigation, version-skewed to 4.20. |
| `disposition` | PARAMETERIZE |
| `action422` | Generalise alongside the others. It should carry forward the family-versus-app-scope boundary that NUTANIX_4_20_IPI_DOC_REVIEW_AND_PLAN.md established — the Nutanix documentation family includes an Agent-based Installer scenario the app deliberately does not implement — since that boundary is currently recorded only in a gitignored local doc. |
| `futureMinorValue` | Moderate. The scope boundary it should absorb is the valuable part, and absorbing it reduces dependence on local-docs. |
| `requiredTestsGuards` | None. |
| `evidenceReason` | PARAMETERIZE: version literals in minor-invariant navigation, with a specific opportunity to promote a scope boundary out of untracked storage and into tracked documentation per O4. |

#### G10.17 `docs/SCENARIOS_VSPHERE_FAMILY.md`

| Field | Value |
|---|---|
| `path` | docs/SCENARIOS_VSPHERE_FAMILY.md |
| `purpose` | Family-level consolidation guide for vSphere scenarios (vsphere-ipi, vsphere-upi, vsphere-agent), centralising the large vSphere document set without deleting any detail docs. |
| `originalRole` | vSphere family navigation. |
| `inputs` | n/a |
| `outputs` | navigation |
| `hardcodedVersionAssumptions` | 4.20-framed, consistent with its siblings. |
| `currentStatus` | Current as navigation, version-skewed to 4.20. vSphere has by far the largest tracked document set — five additional VSPHERE_* documents in docs/ beyond this guide, plus three platform audits in group G6 — which is why a consolidation guide exists for it. |
| `disposition` | PARAMETERIZE |
| `action422` | Generalise alongside the others. Note for Tranche 1: the vSphere documentation PDF is the one asset whose filename changed between minors (Installing_on_vSphere to Installing_on_VMware_vSphere), so vSphere acquisition deserves explicit attention rather than assumed continuity. |
| `futureMinorValue` | Moderate to high, given the size of the vSphere document set it indexes. |
| `requiredTestsGuards` | None. |
| `evidenceReason` | PARAMETERIZE: version literals in minor-invariant navigation content. |

#### G10.18 `docs/IMPLEMENTATION_ROADMAP_2026-05-14.md`

| Field | Value |
|---|---|
| `path` | docs/IMPLEMENTATION_ROADMAP_2026-05-14.md |
| `purpose` | The versioned roadmap, based on BACKLOG_STATUS.md plus the revised phased plan plus version-aware planning, tracking the release sequence and the parallel enterprise productization programme (PROD-024 through PROD-046). |
| `originalRole` | Authority #4 in CLAUDE.md's documentation hierarchy. |
| `inputs` | n/a |
| `outputs` | release planning |
| `hardcodedVersionAssumptions` | Product-version framing (1.7.0 released, v2.0.0 next major) rather than OpenShift-minor framing. It cites local-docs/version-aware-planning/ as a basis — a gitignored directory, so part of its evidential basis is untracked (an O4-relevant observation). |
| `currentStatus` | Stale on two counts, verified by reading the header: last updated 2026-08-13, and it still describes v2.0.0 as 'Phases 0-2 complete, Phases 3-5 active/partial' when v2.0.0 has since shipped (the baseline commit message is 'docs(v2): record final release reconciliation contracts'). It also references docs/REVISED_PHASED_PLAN_2026-05-10.md as replaced, which is correct and present. |
| `disposition` | PARAMETERIZE |
| `action422` | Add the v2.1.0 line in Tranche 7, after final tested behaviour, per CLAUDE.md execution-contract rule 8. Do not edit during 0A-0 or 0A-1. |
| `futureMinorValue` | Moderate. It tracks product releases rather than OpenShift minors, so it needs one entry per release rather than per-minor restructuring. |
| `requiredTestsGuards` | npm run check:app-version keeps the declared product version honest once it is wired into CI; this document should not contradict VERSION. |
| `evidenceReason` | PARAMETERIZE: it needs a new release entry, not restructuring. Recorded as stale-as-of-2026-08-13 so no one treats its v2.0.0 progress statement as current. |

---

## Findings

Discoveries that are durable knowledge or defects, each with the evidence that establishes it. F-items are findings about the harvested material; D-items are discrepancies against Revision 3; FQ-items are unrelated discoveries parked for the backlog per CLAUDE.md execution-contract rule 7.

### F1 — Producer/consumer field-contract drift silently disabled an entire change class in the 4.21 delta

- **detail:** parse-go-structs.js emits description, struct and field. compare-raw-extractions.js reads comment, jsonTag and file. Because comment is undefined on both the baseline and target sides, commentChanged can never evaluate true, so changed_description detection is structurally dead. validate-findings.js has the same defect independently, reading rawFieldDefinition and structName which are never emitted.
- **evidence:** Verified against the real output: in local-docs/ocp-4.21/analysis/delta-installer-params.json, 0 of 49 added rows carry a file field, 0 carry a comment field, and changed is 0. Downstream, every one of the 49 classification rows in catalog-gap-analysis.json has evidence 'Source: unknown'.
- **consequence:** A documentation-comment change between 4.20 and 4.21 would not have been detected. The same would be true for 4.21 to 4.22 unless the contract is fixed.
- **requiredAction:** A producer/consumer contract test shared between the promoted parse-go-structs.js and diff-params.js, asserting every field the consumer reads is a field the producer writes.

### F2 — The 4.20 to 4.21 fork contains zero logic divergence

- **detail:** All 18 forked script pairs were diffed. Five are byte-identical. The other 13 differ only in minor literals: directory paths, provenance strings, banner text and URL segments. No regex, threshold, filtering rule or control-flow construct differs anywhere.
- **evidence:** cmp and diff -u across all 18 pairs; the exact fork command is recorded in ASSET_MANIFEST.md §7 as a single sed invocation.
- **consequence:** Strongly positive for this effort. The main risk Revision 3 §3.0 created this gate to catch — discarding hard-won per-minor logic — does not materialise, because there is no per-minor logic. Parameterization is low-risk. The hard-won knowledge is in the RULES inside corrected-analysis.js, which are identical across the fork and must move verbatim.

### F3 — The sed fork rewrote provenance claims without rewriting the evidence behind them

- **detail:** extract-oc-mirror-params-manual.js in ocp-4.21 asserts its 56-parameter payload was manually read from the OpenShift 4.21 Disconnected Environments PDF. The payload is byte-identical to the 4.20 copy; only the two provenance strings were changed. The same mechanism copied a frozen 4.20 statistic ('Before: 72 matches (15% overlap)') into the 4.21 normalize-and-compare.js, where it prints unconditionally.
- **evidence:** diff -u of both file pairs; the sed command in ASSET_MANIFEST.md §7.
- **consequence:** A provenance claim produced by string substitution is not evidence. This is the strongest argument against any copy-and-sed onboarding step and the reason the tracked runbook must contain none.
- **mitigatingFact:** The false 4.21 oc-mirror claim was never materialised: the script's output is absent from ocp-4.21/analysis and ASSET_MANIFEST.md §8 records oc-mirror extraction as deferred.

### F4 — Two superseded analysis documents claim to preserve content they deleted

- **detail:** CATALOG_GAP_ANALYSIS.md and CATALOG_UPDATE_PLAN.md each carry a SUPERSEDED banner followed by '[Original content preserved but superseded]'. Both bodies are gone; the files are 780 and 743 bytes. ASSET_MANIFEST.md §16 still describes the first as '400+ lines'.
- **evidence:** Both files read in full; byte sizes from the filesystem; the manifest claim read directly.
- **consequence:** The record of what Slice 4 actually claimed, including the full fabricated-parameter list in context, is lost. Only the summary in DOC-102-SLICE-4B-RECONCILIATION.md survives.
- **contrast:** VSPHERE_4_20_IPI_DOC_REVIEW_AND_PLAN.md demonstrates the correct pattern: a 'current code truth' section stating implemented reality, with superseded plan text retained and explicitly labelled historical.

### F5 — A documented, implemented course correction was silently abandoned

- **detail:** WEB_EXTRACTION_PLAN.md records a measured 91% path-building error rate (283 of 311 malformed) for PDF table parsing and adopts HTML scraping instead. extract-from-html.js was written and is byte-identical across the fork. But AUDIT_AUTOMATION_GUIDE.md still prescribes the PDF route, extract-table-params.sh still invokes the failed iteration-1 parser while discarding its stderr, and no HTML-derived extraction output exists under ocp-4.21/analysis.
- **evidence:** WEB_EXTRACTION_PLAN.md read in full; PHASE_2_1_COMPLETION.md's 'Iteration 1: Table-based parser (FAILED)'; extract-table-params.sh line 18; directory listing of ocp-4.21/analysis.
- **consequence:** The 4.21 effort used a method already known to be 91% wrong for table extraction, while a working alternative sat unused in the same directory. Relevant now because L4 records 4.22 doc pages returning 200, so the HTML route is viable for 4.22 in a way it was not for 4.21.

### F6 — Three independent artifacts invert catalog authority toward the frontend mirror

- **detail:** analyze-catalog-gaps.js reads frontend/src/data/catalogs as its catalog source; patch-nutanix-ipi-catalog.mjs edits frontend/src/data/catalogs/nutanix-ipi.json; docs/PARAMETER_CATALOG.md declares 'Location: frontend/src/data/catalogs/'. docs/PARAMS_RECONCILIATION_CHECKLIST.md line 26 offers the mirror as an acceptable file to open, and docs/CATALOG_SYNC_GUIDE.md line 110 shows copying FROM the mirror INTO data/params/4.20.
- **evidence:** Each file read directly; grep across docs/ for flat frontend catalog paths.
- **consequence:** This is a learned pattern, not three unrelated slips, and the documentation is teaching it. Any tool or instruction that treats the generated mirror as a source can silently reverse the authority direction docs/PARAM_AUTHORITY.md establishes.

### F7 — The 4.21 Field Guide certification already contains a 4.22 onboarding gate specification

- **detail:** field-guide-certification/evidence-model.json declares itself the 'Evidence Model for onboard-field-guide 4.22 --previous 4.21' and defines Gate A (onboarding readiness, with the constraint that 4.22 MUST remain unsupported in production throughout all Gate A work) and Gate B (support enablement, with ten required acceptances). It also carries a 32-item retrospective-harvest required-coverage list.
- **evidence:** evidence-model.json read in full.
- **consequence:** Independent corroboration of Revision 3's fail-closed enablement rule, authored before this plan. One correction needed on promotion: Gate B's action names a single 'Expand SUPPORTED_VERSIONS in assembler.js' edit, which is stale — the live list is FIELD_GUIDE_SUPPORTED_MINORS in versionResolution.js, and Revision 3 Tranche 5 enumerates eight boundaries that must flip atomically.
- **alsoNote:** The implied command name onboard-field-guide <minor> --previous <minor> does not exist as a script anywhere in the tree. Recorded as GAP-08.

### F8 — A Field Guide version-resolution inconsistency is recorded but its current status is unverified

- **detail:** field-guide-certification/version-state-matrix.json names the root cause verbatim: assembler.js uses ctx.versionMajorMinor (derived from a patchVersion fallback) to select compartments, while the canonical minor from getOpenShiftMinorFromSources only feeds the channel; when they disagree the guide is internally inconsistent.
- **evidence:** version-state-matrix.json read in full. This harvest did NOT verify whether the condition still exists in the current code — that is explicitly out of 0A-0 scope.
- **consequence:** If still present, this is a fallback vector, which CLAUDE.md's no-fallback rule and L2 ('never add a default: branch to assembler.js') make load-bearing. Adding a third supported minor increases the number of ways two version sources can disagree.
- **requiredAction:** Re-verify against live code (R5) before any Field Guide edit in Tranche 3 or 5. Treat as an unproven-but-documented hypothesis until then.

### F9 — oc-mirror component versioning is the in-repo precedent for tool-version-is-not-target-support

- **detail:** ASSET_MANIFEST.md §6 records openshift-install reporting 4.21.20 while oc-mirror reports GitVersion 4.21.0, and states explicitly that oc-mirror uses component versioning rather than patch versioning and that this is 'Not a discrepancy'.
- **evidence:** ASSET_MANIFEST.md §6 and §10 read directly.
- **consequence:** Concrete historical support for CLAUDE.md's rule that a CLI binary's version does not extend Architect's target OpenShift support, and for the deliberately different oc and oc-mirror resolution policies. Worth carrying into the tracked runbook so the asymmetry is not 'corrected' by a future maintainer.

### F10 — A prior tranche failed by exhausting its agent budget mid-execution

- **detail:** SLICE-5F6-FINAL-STATUS.md records status INCOMPLETE with the cause 'Token budget exhausted before completing all required work' and no new commit produced. The preceding SLICE-5F5-PARTIAL-STATUS.md records 2 of 4 test failures fixed at commit 5e1b8bd.
- **evidence:** Both documents read directly.
- **consequence:** Direct empirical support for Revision 3's tranche sizing and for requiring an explicit exit report per tranche. The recovery pattern used — a per-file keep-or-revert audit of the partial commit (slice-5f6-partial-commit-audit.json) — is the right response and should be the documented procedure when a tranche cannot finish.

### F11 — Recursive directory walking survived the catalog layout migration; flat readdir did not

- **detail:** validate-catalog.js and validate-catalog-agent-networkconfig-paths.js both walk recursively and were unaffected when frontend/src/data/catalogs gained version subdirectories. validate-catalog-frontend-parity.js uses a flat readdir and broke silently into a total mismatch. analyze-catalog-gaps.js uses a flat readdir and now reads zero catalogs.
- **evidence:** All four files read; parity validator run for both minors; directory listings confirming only subdirectories remain.
- **consequence:** A concrete design rule for scripts/minor/**: resolve catalog sets by recursive walk or by explicit per-version path, never by flat readdir of a directory that may contain version subdirectories.

### F12 — The Versioned Copy Guard workflow has been failing since before the frozen baseline

- **detail:** find-hardcoded-versions.sh --check exits 1 on 6 SVG path-coordinate false positives in HostInventoryV2Step.jsx. The SVG was introduced in commit 6e54610 (2026-10-05), which is an ancestor of the 09703fa baseline by 12 commits.
- **evidence:** --check run directly (read-only); git blame on lines 901-903; git merge-base --is-ancestor 6e54610 09703fa confirmed.
- **consequence:** Revision 3 precondition P10 expects exit 0 and is therefore stale. CI for this workflow is red at the baseline, which 0A-1 must fix before it can distinguish a new violation from the standing failure.

---

## Discrepancies against Revision 3

| ID | Severity | Summary |
|---|---|---|
| D1 | HIGH | Revision 3 §5 precondition P10 expects 'bash scripts/find-hardcoded-versions.sh --self-test && bash scripts/fi… |
| D2 | MEDIUM | Revision 3 L8 and precondition P7 describe the catalog parity validator failing for 4.21.… |
| D3 | LOW | Revision 3 §3.0 group '4.20 phase records + platform audits' states a count of 13.… |
| D4 | LOW | Revision 3 §3.0 describes scripts/ as containing '7 one-shot catalog mutators'.… |
| D5 | MEDIUM | Revision 3 §3.0 enumerates docs/SCENARIO_CATALOG_PLAN.md and docs/HANDOFF_PACKET.md among the tracked workflow… |
| D6 | MEDIUM | Revision 3 §2.A lists exactly two stale catalog-layout documents: docs/PARAM_AUTHORITY.md and docs/DATA_AND_FR… |
| D7 | LOW | Revision 3 L9 states validate-param-authority.js 'checks ONE minor'.… |
| D8 | LOW | Revision 3 L8 describes the untracked .git/hooks/pre-commit as 'the only live parity enforcement'.… |

### D1 (HIGH)

- **Plan claim:** Revision 3 §5 precondition P10 expects 'bash scripts/find-hardcoded-versions.sh --self-test && bash scripts/find-hardcoded-versions.sh --check; echo $?' to yield 0.
- **Actual:** --self-test passes 38/38, but --check exits 1 with 6 unclassified references, all SVG path-coordinate literals in frontend/src/steps/HostInventoryV2Step.jsx lines 901-903 and 908-910.
- **Evidence:** --check executed directly in this worktree at 09703fa (read-only: greps and prints only). Full output recorded in verifiedBaselineProbes. Lineage established via git blame and git merge-base.
- **Resolution:** Recorded as a classifier false-positive defect, not adjudicated as legitimate version copy. 0A-1 must eliminate this false-positive class without weakening detection of real hardcoded versions, preserve all 38 existing self-test assertions, and add regression coverage for the SVG class. Root-cause analysis and a note that boundary anchoring alone is insufficient are on the find-hardcoded-versions.sh row.

### D2 (MEDIUM)

- **Plan claim:** Revision 3 L8 and precondition P7 describe the catalog parity validator failing for 4.21.
- **Actual:** It fails identically for 4.20 ('only in data/params/4.20: <all 13>'). The defect is a missing version path segment in feDir, so it affects every minor. Because validate-param-authority.js defaults to 4.20 and exits on first child failure, the failure CI actually hits is the 4.20 one.
- **Evidence:** Validator run for both 4.20 and 4.21; source line 29 read directly.
- **Resolution:** Recorded. Does not change the required fix, but the exit report should not claim 4.20 parity is healthy.

### D3 (LOW)

- **Plan claim:** Revision 3 §3.0 group '4.20 phase records + platform audits' states a count of 13.
- **Actual:** The same row enumerates 7 named top-level documents plus 'platform-audits/ (7 per-scenario doc-review plans)', which is 14. The filesystem confirms 7 + 7 = 14.
- **Evidence:** Directory listing of local-docs/ocp-4.20/ and local-docs/ocp-4.20/platform-audits/.
- **Resolution:** All 14 are rowed. No artifact invented; the count in the plan appears to be an arithmetic slip, not a missing path.

### D4 (LOW)

- **Plan claim:** Revision 3 §3.0 describes scripts/ as containing '7 one-shot catalog mutators'.
- **Actual:** There are 8: add-missing-parameters.js, add-proxy-params-to-catalogs.js, add-support-status-all.js, add-support-status-oc-mirror.js, add-v1.7-parameters.js, expand-catalogs-from-agent-doc.js, expand-nutanix-once.js, patch-nutanix-ipi-catalog.mjs. The total of 36 files in scripts/ is correct.
- **Evidence:** Full directory listing of scripts/ and individual review of each file.
- **Resolution:** All 8 are rowed and all 8 are RETIRE with named positive replacements.

### D5 (MEDIUM)

- **Plan claim:** Revision 3 §3.0 enumerates docs/SCENARIO_CATALOG_PLAN.md and docs/HANDOFF_PACKET.md among the tracked workflow documentation to harvest.
- **Actual:** Neither exists, and neither has EVER existed as a tracked file — git log --all --diff-filter=A returns nothing for either path. Both are recorded in docs/LOCAL_IGNORED_DOCS_TRIAGE.md as local gitignored docs triaged archive_now: HANDOFF_PACKET.md as 'Local handoff note; non-canonical by design' (line 40) and SCENARIO_CATALOG_PLAN.md as 'Early planning artifact superseded by tracked scenario/docs-index rules and data' (line 69).
- **Evidence:** Filesystem check; git log --all --diff-filter=A for both paths; LOCAL_IGNORED_DOCS_TRIAGE.md read directly.
- **Resolution:** No rows invented. The group is 18 existing documents, all rowed. IMPORTANT CONSEQUENCE: CLAUDE.md line 127 lists docs/HANDOFF_PACKET.md as authority #3 in its Documentation Authority Hierarchy, pointing at a file that has never been tracked and that the triage document explicitly classifies as non-canonical. That dangling authority reference should be corrected in a later tranche; it is outside the 0A-0 write fence.

### D6 (MEDIUM)

- **Plan claim:** Revision 3 §2.A lists exactly two stale catalog-layout documents: docs/PARAM_AUTHORITY.md and docs/DATA_AND_FRONTEND_COPIES.md.
- **Actual:** Six of the 18 enumerated workflow documents carry stale flat frontend catalog paths: PARAM_AUTHORITY.md, DATA_AND_FRONTEND_COPIES.md, CATALOG_SYNC_GUIDE.md, PARAMETER_CATALOG.md, NEW_SCENARIO_COVERAGE_CHECKLIST.md and PARAMS_RECONCILIATION_CHECKLIST.md. Outside the enumerated set the same staleness appears in docs/SETUP_COMPLETE.md and several historical VSPHERE_* audits. AGENTS.md and docs/DESIGN_SYSTEM.md are correct on catalogs.
- **Evidence:** grep -rn for flat frontend catalog paths across docs/ and AGENTS.md; each of the six read to confirm the reference is instructional rather than historical.
- **Resolution:** All six are rowed with the correction recorded. The 0A-1 documentation scope is larger than Revision 3 anticipated. A repo-wide no-flat-path docs guard is recommended so the next layout change cannot leave instructions behind.

### D7 (LOW)

- **Plan claim:** Revision 3 L9 states validate-param-authority.js 'checks ONE minor'.
- **Actual:** True of the two PARITY children only. validate-catalog.js is invoked with the parent directory data/params and walks recursively, so catalog schema validation already covers both minors — confirmed arithmetically: 296 (4.20) + 445 (4.21) = 741, which is exactly the count produced by running it against data/params. Only docs-index frontend parity and catalog frontend parity are single-minor.
- **Evidence:** validate-param-authority.js and validate-catalog.js read; all three counts produced by running the validators.
- **Resolution:** Recorded for precision. The required fix (iterate SUPPORTED_MINORS) is unchanged, but the scope of what is currently unchecked is narrower than the lesson implies.

### D8 (LOW)

- **Plan claim:** Revision 3 L8 describes the untracked .git/hooks/pre-commit as 'the only live parity enforcement'.
- **Actual:** The hook exists and is load-bearing, but it is an auto-SYNCER, not an enforcer: it runs sync-catalogs.js, aborts only if sync itself fails, and re-stages the result. Divergence is silently corrected rather than reported.
- **Evidence:** The hook read in full from the shared git common directory; confirmed present at 1711 bytes, mode -rwxr-xr-x.
- **Resolution:** Recorded, and the plan's instruction to note the hook's absence does not apply — it is present. The distinction matters for 0A-1: tracking the hook alone does not give parity enforcement; the fixed parity validator running in CI is what does.

---

## Findings queue (backlog candidates)

Unrelated discoveries parked for the backlog rather than silently expanding 0A-0 scope (CLAUDE.md execution-contract rule 7). These are NOT backlog IDs. Canonical IDs must be assigned from docs/BACKLOG_STATUS.md (current namespaces: DOC- up to 164, PROD- up to 046, PHX-) by the human before any of these is scheduled.

| ID | Item |
|---|---|
| FQ-1 | CLAUDE.md line 127 names docs/HANDOFF_PACKET.md as authority #3 in the Documentation Authority Hierarchy. The file has never been tracked and docs/LOCAL_IGNORED_DOCS_TRIAGE.md classifies it as non-canonical by design. The hierarchy should be corrected. Outside the 0A-0 write fence. |
| FQ-2 | scripts/validate-docs-index.js builds its index directory from process.cwd() while every sibling script uses __dirname. It therefore only works when invoked from the repository root. Cosmetic today because that is how CI invokes it, but inconsistent and fragile. |
| FQ-3 | frontend/scripts/check-bundle-size.js documents a default limit of 2048 KB in its header comment while the code uses 2500 (line 12). Doc/code mismatch; harmless but misleading. |
| FQ-4 | scripts/refresh-doc-index.js retains only live URLs and rewrites the index in place. Under the kind of blanket 403 observed during 4.21 (35 of 35 failing) a single run would empty the docs-index. It should refuse to write when the failure rate exceeds a threshold. |
| FQ-5 | scripts/validate-agent-nmstate-generator.js locates the buildNmState body between two string markers. If the end marker '\nconst getPrimaryInterfaceName' is ever renamed, the guard silently widens its scan to the rest of the file rather than failing. Relevant because generate.js is edited in Tranche 3. |
| FQ-6 | find-hardcoded-versions.sh --self-test creates fixtures under ${TMPDIR:-/tmp}/versioned-copy-self-test-$$ and never removes them. Minor temp-directory accumulation on CI runners and developer machines. |
| FQ-7 | backend/scripts/crawl-doc-examples.js writes to docs/e2e-examples/snippets/ and docs/e2e-examples/SNIPPETS_INVENTORY.md, neither of which exists in the tree. Either the output was never committed or it was removed; the script's contract and the repository disagree. |
| FQ-8 | Both .github/workflows/ci.yml and .github/workflows/validate-versioned-copy.yml trigger only on branches [master, main, develop]. Work on the v2.1 branch receives no CI until a PR targets one of those branches. Worth a deliberate decision rather than an accident. |

---

## Scope and safety

- **Network acquisition:** NONE. No script performing network access was executed. No fetch, curl, clone or download was performed at any point in 0A-0.
- **Historical evidence mutation:** NONE. local-docs/** was read only. No file there was copied, renamed, deleted, normalized or modified.

**Commands executed (all read-only):**

- scripts/find-hardcoded-versions.sh --check (read-only: greps frontend/src and prints)
- scripts/validate-param-authority.js (read-only: runs read-only child validators)
- scripts/validate-catalog.js (read-only)
- scripts/validate-catalog-frontend-parity.js (read-only)
- git read-only commands: status, log, blame, merge-base, ls-files, rev-parse, show
- read-only shell inspection: ls, find, wc, grep, cmp, diff, head, sed -n, python3 -I for JSON structure inspection

**Deliberately not executed:** Every script under local-docs/ocp-4.2*/scripts/ (all write into the read-only historical analysis directories, and several perform network acquisition); every one-shot catalog mutator in scripts/ (all mutate tracked catalog data); refresh-doc-index.js, backfill-citation-doc-title.js, phase3-backfill-doc-title.js, sync-catalogs.js, verify-parameter-coverage.js (all write tracked files); the backup/restore/load-test family (destructive or operational); the container smoke test (builds and runs containers); find-hardcoded-versions.sh --self-test (creates and leaves temp fixtures; result supplied by the baseline addendum).
