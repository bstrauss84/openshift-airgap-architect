# OpenShift Minor-Release Onboarding Runbook

**Authority:** tracked procedure for adding support for a new OpenShift minor.
**Status source:** `docs/BACKLOG_STATUS.md` remains the single source of truth for status claims.
**Replaces:** `local-docs/AUDIT_AUTOMATION_GUIDE.md` (untracked, single-machine, procedurally wrong — see §10).

---

## Rule 1 — Supported minors are cumulative

> **Adding a minor must NEVER remove an already-supported minor.**

Supported OpenShift minors are cumulative by default. The add-a-minor procedure
in this runbook contains **no removal step**, and a proposal to drop a minor
while onboarding a newer one is out of procedure.

Retiring a supported minor is a **standalone, human-authorized product
decision** with its own scope, migration story and acceptance criteria. It is
never a side effect of onboarding.

**No agent or process may infer retirement from** age, EUS status, odd/even
release number, supported-window size, or the addition of a newer minor. None
of those is evidence of retirement.

**Enforcement, not convention:**

| Guard | Asserts |
|---|---|
| `node scripts/validate-supported-minors.mjs` | `SUPPORTED_MINORS` is a superset of every previously released minor recorded in `scripts/lib/released-minor-support.json`; `SUPPORTED_MINORS[0]` still equals the recorded `baselineMinor`; the backend and frontend declarations agree. |
| `node scripts/validate-version-lists.mjs` | No tracked JSON carries a `supportedVersions`/`versionRange` array that disagrees with `SUPPORTED_MINORS`. |

Both run in CI. Current state: supported `[4.20, 4.21]`, baseline `4.20`.

**The version-awareness baseline is `4.20`** — `SUPPORTED_MINORS[0]`, and the
minor `catalogFieldMeta.js` compares against for "New in OpenShift X.Y" badges.
A field introduced in 4.21 must show no badge at 4.22 while keeping its
`minVersion` provenance, which is achieved by *not* moving the baseline.
Changing it is a separate human decision.

---

## Rule 2 — Source authority, and what to do when sources disagree

| Question | Authority |
|---|---|
| Is this **supported** for users? | **Red Hat product and installation documentation.** |
| What does the installer **mechanically accept** (schema, types, validation)? | **Installer source** (`pkg/types/**`, `pkg/types/*/validation/**`, `pkg/asset/installconfig/**`). |
| What does **this product** expose? | The reconciled catalog entry, which records an explicit product decision. |

**On disagreement: record both facts, choose neither silently, and escalate to a
human.** Never expose a feature as supported merely because installer code
accepts it.

> **This corrects the previous runbook.** `AUDIT_AUTOMATION_GUIDE.md` stated
> *"When docs conflict with installer code, trust installer code"* unconditionally
> and ranked documentation third of four. That rule is right about mechanical
> reality and wrong about supportedness — the installer accepting a field says
> nothing about whether Red Hat supports it. The `supportStatus` value
> `docs-only-not-supported` exists for exactly this case.

Worked example: `osImageStream` (`rhel-9` | `rhel-10`) is accepted by the 4.22
installer, but RHEL 10 is Technology Preview behind `TechPreviewNoUpgrade`, so
the catalog records `docs-only-not-supported` with the rationale attached.

---

## Rule 3 — Data direction is one-way

```
data/params/<minor>/<scenario>.json        ->  frontend/src/data/catalogs/<minor>/<scenario>.json
data/docs-index/<minor>.json               ->  frontend/src/data/docs-index/<minor>.json
            CANONICAL                                      GENERATED MIRROR
```

- Edit canonical. Regenerate the mirror with `npm run sync-catalogs` and `npm run sync-docs-index`.
- **Never copy a mirror back over canonical.** Never hand-edit a mirror.
- Never read the mirror as a data source in tooling.

Verify without writing: `npm run sync-catalogs:check`, `npm run sync-docs-index:check`.
Both run in CI, so a drifted mirror fails the build whether or not anyone has a
hook installed.

> Three harvested scripts and three tracked documents had this backwards. One of
> them, `analyze-catalog-gaps.js`, read the mirror with a flat `readdir` and now
> silently sees zero catalogs.

---

## Rule 4 — No cross-minor backfill

A correction to `data/params/<minor>/**` must be sourced from **that minor's own**
authoritative documentation and/or that minor's installer release branch.

- Evidence from a newer minor may trigger *investigation* of an older row. It may
  never *populate* or *overwrite* one.
- `frontend/src/data/catalogs/<minor>/**` is a generated mirror of the same
  minor's canonical data. Never sourced from another minor.
- **A blind `4.20` → `4.21` string replacement on citations is forbidden.** Red Hat
  restructures documentation between minors: the oc-mirror v2 topic is Chapter 7
  at 4.20 and Chapter 5 at 4.22, with a stable slug but a changed chapter number.
  Each repaired citation must resolve to a live page for its own minor whose
  cited `sectionHeading` actually exists there.
- Unresolved mappings **stop and report**. They are not guessed, not left pointing
  at the previous minor, and not silently dropped.

---

## Rule 5 — No copy-and-sed script forks

`scripts/minor/**` is parameterized by `--minor`. Onboarding a new minor adds
**no new script**.

> The 4.20 → 4.21 toolkit was forked with one `sed` substitution. All 18 pairs
> differ only in minor literals — zero logic divergence — so the fork bought
> nothing and cost real correctness:
> - an oc-mirror extractor now claims 4.21 provenance over a parameter list that
>   was only ever read against 4.20, because `sed` rewrote the claim and not the evidence;
> - a frozen 4.20 statistic (`"Before: 72 matches (15% overlap)"`) prints
>   unconditionally for every minor;
> - a PDF table parser documented as **FAILED** at 4.20 (91% malformed paths,
>   283 of 311) was copied forward and kept in use, because `sed` does not read
>   failure reports;
> - a vSphere PDF filename that had already produced a 404 was copied forward uncorrected.

**Provenance is derived, never asserted.** Record the resolved branch **and
commit SHA** from the actual clone. A provenance string produced by string
substitution is not evidence.

---

## Rule 6 — Network acquisition is separated from tests

- Network access belongs to `scripts/minor/acquire/**` and is run deliberately by a human.
- **No test may reach the network.** `backend/test/test-network-hermeticity.test.js` fails any non-loopback egress.
- Acquisition conclusions are captured as tracked provenance and committed fixtures that tests consume locally.
- Commit: URLs, retrieval dates, hashes, pinned commits, reproduction instructions, small structured outputs.
- Do **not** commit: PDFs, documentation payloads, installer clones, binaries, GB-scale raw artifacts, credentials, machine scratch.

---

## Rule 7 — The human review boundary

Stop and ask a human; do not decide silently:

1. Red Hat documentation and installer source disagree about supportedness.
2. A catalog field value is not derivable from an authoritative source. **Do not guess** — an undeterminable value is a stop-and-report, not a judgement call.
3. A delta row cannot be classified against the supported platform/scenario set.
4. A new platform appears upstream (PowerVC added 32 parameters at 4.21; that is a product decision, not an onboarding task).
5. Closing a gap would require retiring a minor or moving the baseline.
6. A validator can only be made green by weakening it. **Never weaken a schema or backfill invented values to turn a check green.**

---

## Procedure

### Phase 0 — Prepare

- [ ] Confirm the target minor's installer release branch exists. If not, wait; do not substitute `main`.
- [ ] Create a workspace **outside the repository**: `WS=/var/tmp/oaa-<minor>`.
- [ ] Record the starting repository commit.
- [ ] `node scripts/validate-supported-minors.mjs` — confirm the current cumulative state before changing anything.

### Phase 1 — Acquisition *(network; human-run; `scripts/minor/acquire/**`)*

- [ ] Documentation for the minor. **Check the vSphere filename**: it is `Installing_on_VMware_vSphere`, not `Installing_on_vSphere` — the short form 404s and has already cost one cycle.
- [ ] Installer source, shallow clone of `release-<minor>`. **Record the resolved commit SHA.**
- [ ] Client binaries, each verified against that channel's own `sha256sum.txt` **before** use. Fail closed on download failure, missing or unparseable checksum metadata, checksum mismatch, or unsupported architecture.
- [ ] Record every asset: size, SHA256, source URL, retrieval date.

> **`oc` and `oc-mirror` follow deliberately different policies. Do not collapse them.**
> `oc-mirror` comes from `clients/ocp/latest` — the latest available globally,
> independent of the target minor. `oc` comes from `clients/ocp/latest-<minor>`,
> because it carries a client/server compatibility expectation tied to the target cluster.
>
> **A tool's version is not a statement about target support.** At 4.21,
> `openshift-install` reported `4.21.20` while `oc-mirror` reported `4.21.0`
> (component versioning). That is expected and is **not** a discrepancy. Architect
> may ship an `oc-mirror` labelled 4.22+ while supporting only targets 4.20 and 4.21.

### Phase 2 — Extraction and delta

- [ ] Extract install-config and agent-config parameters from the pinned clone. Capture stderr to a workspace log; **never `2>/dev/null`** — a 91%-failing parser once surfaced only as suspiciously low counts.
- [ ] `diff-params.js --baseline <prev> --target <new> --previous-minor <P> --minor <M>`.
- [ ] `corrected-analysis.js --minor <M> --workspace $WS`.

> **Expect roughly a 67% false-positive rate on the raw comparison** (340 of 502 at
> 4.20). Platform applicability is the single largest source. The filtering rules
> in `corrected-analysis.js` exist for this and must never be "cleaned up" away.

Known limits of extraction, unchanged since 4.20 — plan for manual work:
- Nested-struct extraction is **shallow**; deep paths such as `failureDomains[].topology.datacenter` need manual inspection.
- **Conditional requiredness is not in struct tags.** Read `pkg/types/*/validation/**`.
- **Runtime defaults** live in `pkg/asset/installconfig/**` and are invisible in tags.
- PDF extraction succeeds ~60-70% of the time and breaks when Red Hat changes formatting. **Prefer HTML**: clean table markup, no layout artifacts. PDF table parsing measured a 91% path-building error rate.
- 100% automation is not achievable. Filtering rules need human judgement.

### Phase 3 — Classify *(human-gated)*

For each delta row record: path, type, requiredness, **source file and line**,
verbatim source evidence, feature gate and condition, validation constraint and
file, the recommended action, and the target catalogs.

Reading the raw comparison, these are **not** defects:
- **Catalogs may legitimately be stricter than Go structs.** Agent scenarios require VIPs though the struct marks them optional.
- **Go type aliases serialize as primitives in YAML.** `AWSLBType`, `CloudEnvironment`, `ProvisioningNetwork`, `DiskType` → `string`; `ipnet.IPNet` → `string` in CIDR notation. **Catalogs describe YAML, not Go.**
- `imageContentSources` and `imageDigestSources` are **mutually exclusive union members**; their `.source` children are required only if the parent array is present.
- Catalog-only parameters are usually legitimate: system fields, arbiter topology, and the ~35 agent `networkConfig` paths that follow an external NMState schema and will never appear in installer Go structs.

Deprecations use a **two-tier** strategy:
- **P0 remove** — the field breaks functionality or creates deprecated resources.
- **P1 mark** — it still works but is deprecated; mark it and provide a migration path.

**Never remove a parameter** on "it looks old", "the docs don't mention it", or
"I think it's deprecated". Require an installer-source `Deprecated:` comment
**and** a replacement already present in the catalog.

### Phase 4 — Author data *(the new minor only)*

- [ ] Create `data/params/<minor>/`, with **citations for that minor from birth**. Never clone the previous minor's citations.
- [ ] Create `data/docs-index/<minor>.json`; HEAD-validate every URL during acquisition, never from a test.
- [ ] `npm run sync-catalogs && npm run sync-docs-index`.
- [ ] `node scripts/validate-catalog.js data/params/<minor>` — must be clean.
- [ ] `node scripts/validate-param-authority.js`.

### Phase 5 — Extend the guards *(same commit as the copy they justify)*

- [ ] Add the minor's legitimate user-facing copy adjudications to `scripts/find-hardcoded-versions.sh` **and** `docs/VERSIONED_COPY_INVENTORY.md` **in one commit**. The guard rejects a new minor's copy by design, so splitting these leaves CI red or the ledger lying.
- [ ] Re-point the unsupported-sentinel fixtures to the next unsupported minor.
- [ ] `bash scripts/find-hardcoded-versions.sh --self-test && bash scripts/find-hardcoded-versions.sh --check`.

### Phase 6 — Enable *(one atomic commit)*

**The new minor stays publicly unsupported until every prerequisite is green.**
No partial flips, no preview flag, no "temporarily supported" state — each
would be a fallback vector.

Every independent boundary flips **together**, in one commit:

1. `backend/src/versionPolicy.js` — `SUPPORTED_MINORS` and the trust-bundle row
2. `frontend/src/shared/versionPolicy.js` — the same, mirrored
3. `backend/src/fieldGuide/versionResolution.js` — `FIELD_GUIDE_SUPPORTED_MINORS`
4. `backend/src/fieldGuide/assembler.js` — import and branch
5. `backend/src/fieldGuide/provenance.js` — `getAuthoritativeExport`
6. `frontend/src/docsIndexResolver.js` — static import map
7. `e2e/helpers/asset-validation.js` — `SUPPORTED_VERSIONS`
8. Any pinning assertion that deep-equals the old supported list
9. `scripts/lib/released-minor-support.json` — append the new minor to `previouslyReleasedMinors`

- [ ] `node scripts/validate-supported-minors.mjs` — superset and baseline hold.
- [ ] Full backend and frontend suites.

> There is **no `default:` branch** in the Field Guide assembler, and none may be
> added. The Field Guide silently fell back to 4.20 once; it is now fail-closed
> across six version sources.

### Phase 7 — Reconcile

- [ ] `VERSION` via `node scripts/set-app-version.mjs <version>` — never hand-edit the manifests.
- [ ] `CHANGELOG.md`, `README.md`, `CLAUDE.md` scope, `AGENTS.md`.
- [ ] `docs/BACKLOG_STATUS.md` **last**, after final tested behaviour.

---

## §10 — Why the previous runbook was replaced

`local-docs/AUDIT_AUTOMATION_GUIDE.md` (1,274 lines, untracked, one machine)
captured genuinely valuable domain knowledge — all of it is preserved above —
but its two core instructions were wrong:

| Previous instruction | Why it was replaced |
|---|---|
| `cp -r local-docs/ocp-4.20/scripts local-docs/ocp-4.21/scripts` then `sed -i 's/4.20/4.21/g'` | Produced false provenance, propagated a known-failed parser and an uncorrected 404, and froze 4.20 statistics into 4.21 output. See Rule 5. |
| "When docs conflict with installer code, trust installer code" (docs ranked third of four) | Correct for mechanical reality, wrong for supportedness. See Rule 2. |
| `md5sum data/params/4.21/x.json frontend/src/data/catalogs/x.json` | Flat frontend path, removed by the ADR-001/ADR-005 versioned migration. See Rule 3. |
| PDF table extraction as the primary route | `WEB_EXTRACTION_PLAN.md` had already measured 91% malformed paths and adopted HTML scraping — a decision that was implemented and then never followed. See Phase 2. |

Being untracked was itself the defect: the only copy of the process for
onboarding a minor lived on one laptop, outside review and outside CI.

**Full evidence:** [`AUTOMATION_HARVEST_LEDGER_4.21.md`](AUTOMATION_HARVEST_LEDGER_4.21.md)
(157 artifacts, findings F1-F12) ·
[`SCRIPTS_MINOR_SPECIFICATION.md`](SCRIPTS_MINOR_SPECIFICATION.md) ·
[`AUTOMATION_GAP_LIST.md`](AUTOMATION_GAP_LIST.md) (GAP-01 to GAP-13).
