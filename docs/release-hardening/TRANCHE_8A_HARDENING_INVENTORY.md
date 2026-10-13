# v2.1 Tranche 8A — Release Hardening Foundation

**Status:** `done_pending_verification` — framework implemented and its own tests are green;
product findings below are recorded, not fixed.
**Baseline:** `21529ae24dad231ae28351755c86a69f0c206da4` on `work/v2.1-release-hardening`,
worktree clean at tranche start.
**Date:** 2026-10-12 (revised by Tranche 8A.1, same day)

This document is the Tranche 8A inventory, gap matrix and execution roadmap. It is
**not** a status authority: `docs/BACKLOG_STATUS.md` remains the single source of truth
for all status claims, and no backlog ID is created or closed here.

> **Tranche 8A.1 — certification framework integrity closure.** An independent source
> review of the 8A implementation found framework-level correctness gaps that would have
> let the instrument report a release as certified when it was not. The architecture was
> accepted; the defects were closed before the instrument was committed. §17 lists each
> correction, and the sections below describe the corrected behaviour rather than the
> original. **The findings queue in §5 is unchanged** — no product finding was fixed, and
> §5.11 was added by 8A.1.

---

## 1. Headline finding

**Continuous integration has been red on every push since 2026-05-27 — 89 of the last
100 `CI` runs — and the failure is at the first real step of `build-and-test`.**

`.github/workflows/ci.yml` runs the backend suite as:

```
npm test -- --reporter=spec
```

`backend/package.json` defines `test` as `node --test --test-concurrency=1 test/`, so
`--` appends the flag *after* the positional argument, producing
`node --test ... test/ --reporter=spec`. Node treats `--reporter=spec` as a **test file
path**:

```
Could not find '/home/runner/work/.../backend/--reporter=spec'
```

The step exits 1 and every subsequent step in the job is skipped. For the entire 4.21
and 4.22 onboarding program the following have therefore **never executed in CI**:

- backend test suite
- frontend install, production build and test suite
- frontend bundle budget (FQ-10)
- `validate-param-authority.js`
- `validate-frontend-container-layout.mjs`
- frontend container smoke test

Introduced in `e9692a9` (2026-05-27, *"Improve CI pipeline error reporting and
logging"*). Two further workflow defects compound it — see §5.

This is a certification-infrastructure defect, which places it squarely in Tranche 8
scope. It is the reason this tranche adds a `ci-integrity` axis: a gate nobody reads is
not a gate, so the CI conclusion for the exact candidate commit is now certified in its
own right rather than assumed.

> **CLOSED BY 8B.** All three workflow defects are fixed (§5.1–§5.3) and every gate
> listed above now runs and passes from a pristine clone. The section above is retained
> as the historical record of what was wrong and for how long — it is **not** a
> statement of current state. Remote CI will show green from the first commit that
> carries these fixes; until that commit exists, `ci-integrity` honestly reports
> INCOMPLETE rather than asserting a result it cannot have.

---

## 2. Baseline proof

| field | value |
| --- | --- |
| worktree | `/home/bistraus/code/openshift-airgap-architect-v2.1-hardening` |
| branch | `work/v2.1-release-hardening` |
| HEAD | `21529ae24dad231ae28351755c86a69f0c206da4` |
| `git status --short` | *(empty)* |
| HEAD subject | `fix(v2.1): close final OpenShift 4.22 release QA findings` |

Six-ref convergence re-verified: `origin/develop`, `origin/work/v2.1-ocp-4.22-onboarding`,
`continuity/develop`, `continuity/work/v2.1-ocp-4.22-onboarding`, local `develop` and
local `work/v2.1-ocp-4.22-onboarding` all resolve to `21529ae`.

---

## 3. Inventory summary

### Repository shape

911 tracked files. `frontend` 300, `backend` 192, `docs` 166, `scripts` 87, `data` 47,
`e2e` 44, `shared` 15, `manifests` 13.

### Host and toolchain as found

| tool | state |
| --- | --- |
| Fedora Linux 44, x86_64 | — |
| node / npm | v20.20.2 / 10.8.2 |
| podman | 5.8.7, rootless, overlay |
| skopeo | 1.22.3 |
| gitleaks | 8.30.0 |
| jq / sqlite3 / gh | 1.8.1 / present / 2.97.0 (authenticated) |
| docker, buildah | absent |
| **trivy, grype, syft, cosign** | **absent — this is the Tranche 8 blocker** |

Shipping images are present locally and were built ~1h before this inventory:
`localhost/openshift-airgap-architect-backend:latest` (1.32 GB) and
`...-frontend:latest` (347 MB).

### Existing reusable infrastructure (do not duplicate)

| area | artifact | verdict |
| --- | --- | --- |
| secret scanning + credential lifecycle | `scripts/security/tranche-security-gate.sh` (493 lines) | **Strong.** Correctly separates PASS / BASELINE / RED / INCOMPLETE / N/A; derives dependency scope from the Containerfile; reconciles history findings against an opaque baseline instead of allowlisting them. Reused wholesale by the `secrets` axis. |
| history baseline | `scripts/security/history-scan-baseline{.json,-cli.mjs,.mjs}` | Strong. Reused. |
| gitleaks config self-test | `scripts/security/gitleaks-selftest.sh` | Strong — guards the vacuous-config failure mode. Reused. |
| version identity | `validate-app-version.mjs`, `validate-supported-minors.mjs`, `validate-version-lists.mjs` | Strong. Reused by the `identity` axis. |
| catalog / docs authority | `validate-param-authority.js` + ~20 validators | Strong. Reused by the `docs` axis. |
| container layout | `validate-frontend-container-layout.mjs` (283 lines) | Good static check. Fold into `containers` in 8D. |
| container smoke | `smoke-frontend-container.sh` (168 lines) | Good runtime check with safe cleanup. Fold into `containers` in 8D. |
| release docs | `validate-release-docs.test.mjs` | Good — validates facts, not words. Reused. |
| backup / restore | `test-backup-restore.sh`, `verify-backup.sh`, `backup-sqlite.sh`, `restore-sqlite.sh` | Exist; unwired into any gate. Fold into `artifacts` in 8F. |
| pre-commit | `.pre-commit-config.yaml` | Good — every hook read-only, every invariant also in CI. |
| E2E | Playwright, 24 specs, page objects | Exists; runs in no pipeline. |

### Missing entirely

Container-image scanning · SBOM generation · base-image digest pinning · image signing
or attestation · release bundle definition · connectivity-profile testing · lifecycle /
resource probes · compatibility matrix evidence · dependency scanning in CI ·
`SECURITY.md` · any top-level release-certification entry point.

---

## 4. Gap matrix by certification axis

Status is the **certified status of the candidate today**, as produced by the new
harness. `INCOMPLETE` means the proof could not be performed — it is not a pass.

15 axes, all required. **Current verdict after Tranche 8B: RED**, attributable to a
single unresolved axis (`dependencies-builder`) plus axes awaiting later tranches.

Two columns: what 8A found, and where the axis stands now. Historical findings are
preserved in §5 regardless of present status.

| axis | §  | FOUND AT 8A | CURRENT | gap remaining | owner | closes |
| --- | --- | --- | --- | --- | --- | --- |
| `identity` | 6 | PASS | **PASS** | — | — | — |
| `repo-hygiene` | 14 | FAIL | **PASS** ✅ 8B | — | — | — |
| `docs` | 15 | FAIL | **PASS** ✅ 8B | — | — | — |
| `dependencies-shipped` | 8 | PASS | **PASS** | — | — | — |
| `dependencies-builder` | 8 | FAIL | **FAIL** | frontend builder 2 critical / 8 high, **unresolved** | DOC-207 | **8G** |
| `secrets` | 8 | INCOMPLETE | **PASS** ✅ 8B | — | — | — |
| `tests` | 11 | INCOMPLETE | **PASS** ✅ 8B | — | — | — |
| `ci-integrity` | — | INCOMPLETE | INCOMPLETE | candidate is dirty/uncommitted, so no remote CI evidence can exist for it yet. The CI *defects* (§5.1–§5.3) are closed | — | needs a qualifying remote run (§13a) |
| `containers` | 10 | INCOMPLETE | INCOMPLETE | no image carries candidate provenance (§5.11) | — | **8D** |
| `image-vulnerabilities` | 8 | INCOMPLETE | INCOMPLETE | **named Tranche 8 blocker** — no provenance, no scanner. NON-WAIVABLE | PROD-020 / PROD-044 | **8D** |
| `component-inventory` | 9 | INCOMPLETE | INCOMPLETE | no provenance, no generator. NON-WAIVABLE | PROD-023 | **8D** |
| `lifecycle` | 12 | INCOMPLETE | INCOMPLETE | no probes; one confirmed leak (§6) | PROD-036 / PROD-012 | 8C |
| `compatibility` | 16 | INCOMPLETE | INCOMPLETE | only the local host exercised | PROD-046 | 8E |
| `connectivity` | 17 | INCOMPLETE | INCOMPLETE | no profile harness | PROD-043 | 8E |
| `artifacts` | 18 | INCOMPLETE | INCOMPLETE | no release bundle defined | PROD-042 / PROD-046 | 8F |

**Deterministic test baseline after 8B — zero known failures:**

| suite | total | pass | fail |
| --- | --- | --- | --- |
| `npm run test:tooling` | 701 | 701 | **0** |
| `npm run test:release-certify` | 141 | 141 | **0** |
| `cd backend && npm test` | 2914 | 2909 (+5 TODO) | **0** |
| `cd frontend && npm test` | 4380 | 4379 (+1 skipped) | **0** |

The 10 tooling failures recorded in §1 and §5.2 are **closed**; `test:tooling` is
701/701 from a pristine clone after the declared bootstrap.

The remaining 5 backend TODOs and 1 frontend skip are recorded in full in §14c. All are
justified; the one invalid skip found by the audit was closed by 8B.4 (§5.12).

Three entries changed meaning in 8A.1 and are worth reading twice:

- **`dependencies` split into two axes.** The single axis PASSed on clean shipped
  dependencies while merely *mentioning* the builder's 2 critical and 8 high. Recorded
  findings with no mechanical consequence cannot keep a release from going green, so the
  build surface now holds its own axis non-green until 8G disposes of it.
- **`containers` went PASS → INCOMPLETE.** Its 20 assertions still pass, but they were
  being evaluated against whatever image carried the right tag. Nothing proved that image
  was built from the candidate.
- **`sbom` renamed `component-inventory`**, because that is what it produces (§11).

Not separately axed, tracked against existing backlog items: signing and attestation
(PROD-031), digest pinning (PROD-030), vulnerability disclosure policy (PROD-045).

---

## 5. Findings queue

Recorded, **not fixed in 8A**. Severity is release impact.

> **Tranche 8B disposition.** §5.1–§5.6 are **CLOSED**; the detail below is kept as the
> historical record of what was wrong and why. §5.7 (runtimePackage temp leak → 8C),
> §5.8 (repository governance → human), §5.9 (mutable tags → 8F), §5.10 (file size,
> informational) and §5.11 (image provenance → 8D) remain **OPEN** and unchanged.
> DOC-207 builder advisories remain open and are now enforced by the
> `dependencies-builder` axis until 8G.
>
> §5.5 was mis-diagnosed in 8A. The ledger content was never stale and the canonical
> inputs had not changed: `gen-architecture-evidence-ledger.js` pushed a trailing empty
> line, so the **generator** disagreed with its own committed output permanently. 8B
> removed the stray `w("")`, after which the generator reproduces the committed ledger
> byte-for-byte — the ledger file itself needed no change.
>
> 8B also corrected `scripts/validate-frontend-container-layout.mjs`, which CI had never
> reached. It required `WORKDIR /app/frontend` (the pre-PROD-026 dev-server path) and
> byte-equivalence between `frontend/Containerfile` and `frontend/Dockerfile` — an
> assertion that, if satisfied, would have reintroduced the PROD-026 dev-server blocker.
> Both assertions were replaced with the contract they were reaching for; none was
> deleted.

### 5.1 — CI `build-and-test` has never run since 2026-05-27 · blocking

See §1. Fix: `cd backend && npm test` with the reporter inside the script, or
`node --test --test-reporter=spec ... test/`. Verify against the real workflow, not
locally — the defect is in argument forwarding, which `npm test` alone does not exercise.

### 5.2 — CI `tooling-gates` asserts a hermetic property that is false · blocking

The job's header comment states every script uses Node built-ins only and that the
sequence was verified with all `node_modules` removed. That is no longer true:
`scripts/t6a-e2e-helper-loadable.test.mjs` imports `e2e/helpers/asset-validation.js`,
which imports `js-yaml` — a **root devDependency** the job never installs.
10 of 560 tests fail with `ERR_MODULE_NOT_FOUND`.

Reproduced locally in a worktree with no `node_modules`: identical 10 failures.
Fix: add `npm ci` to the job (and correct the comment), or make the helper's YAML
dependency optional. Do not delete the test.

### 5.3 — `Versioned Copy Guard` newly red at the accepted baseline · blocking

34 unclassified hardcoded version references, all in
`frontend/src/shared/operatorQuickPicks.js` (lines 51–154): per-minor operator sets keyed
`"4.16"`–`"4.22"`. Reproduced locally; the guard's own `--self-test` passes 43/43, so the
classifier is sound and the finding is about the data. This went red at `21529ae`,
i.e. introduced by the 4.22 work. Needs adjudication (version-derived? keyed data that
is legitimately literal?) rather than mechanical rewriting.

### 5.4 — `frontend/Dockerfile` falsely claims parity with the Containerfile · high

`backend/Dockerfile` carries a `LEGACY / UNSUPPORTED — DO NOT USE` banner.
`frontend/Dockerfile` does not. It says *"Kept in sync with Containerfile; compose uses
Containerfile"* while actually building the **Vite dev server** with the full
devDependency tree:

```
CMD ["node", "node_modules/vite/bin/vite.js", "--host", "0.0.0.0", "--port", "5173"]
```

That is precisely the configuration `frontend/Containerfile`'s own header documents as
the release blocker PROD-026 removed — the one that made a container build report 15
vulnerabilities while the security gate reported zero. Anyone who trusts the comment and
builds from this file reintroduces the blocker. Either mark it legacy or delete it.

### 5.5 — Architecture evidence ledger is out of sync with its source data · high

`npm run check:evidence-ledger` exits 1 at the accepted baseline:
*"Architecture evidence ledger is out of date — run `npm run gen:evidence-ledger`."*
The ledger is generated from `data/arch-support` and `data/scenario-support`, so this is
regenerate-and-review, not authoring. It is the single `[data]` failure in
`validate-param-authority.js` (15 of 16 checks pass; **no mechanism, parity or schema
defect**). Undetected because CI dies before reaching that step (§1).

### 5.6 — `package.json` declares the wrong GitHub repository · medium

`repository.url` is `https://github.com/billstrauss/openshift-airgap-architect.git`.
Every git remote is `bstrauss84/...`. Published package metadata, tooling issue links and
provenance resolution all read this field.

### 5.7 — High-side runtime package leaks a temp directory permanently · high

`backend/src/runtimePackage.js:225`:

```js
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "airgap-runtime-package-"));
```

Neither `createRuntimePackageArtifacts` nor its only caller
(`backend/src/index.js:3732`) ever removes it. The directory holds **exported container
image archives** — the backend and frontend images, ~1.7 GB combined at current sizes.
Every high-side runtime package export leaves that in `/tmp` forever.

Fix requires care and therefore a bounded tranche, not a one-liner: the caller streams
files out of `tempRoot` into an archive that is finalised **asynchronously**
(`archive.finalize()`), so a naive `rmSync` after the loop is a use-after-free. Cleanup
must be tied to the archive's completion, and must also run on the error path.

### 5.8 — No branch protection, Dependabot disabled, no code scanning · medium

Neither `main` nor `develop` is protected (`HTTP 404 Branch not protected`). Dependabot
alerts are disabled. No code-scanning analysis exists. Secret scanning is enabled and
reports 0 alerts. Governance decision, not a code change — see §13.

### 5.9 — Mutable `:latest` everywhere · medium (PROD-030 / PROD-042)

`docker-compose.yml` and both `manifests/base/*-deployment.yaml` reference
`:latest`. Base images `registry.access.redhat.com/ubi9/nodejs-22` and
`ubi9/nginx-124:latest` are unpinned tags. An artifact addressed by a mutable tag cannot
be certified, because the thing scanned is not provably the thing shipped.

### 5.11 — No shipping image can be bound to the source it was built from · high

*(Added by Tranche 8A.1.)* Neither Containerfile sets
`org.opencontainers.image.revision`, neither sets a candidate-id label, and no build
step emits a release manifest. There is therefore no way to prove that
`localhost/openshift-airgap-architect-backend:latest` was built from the commit being
certified — a month-old image satisfies every structural assertion while containing none
of the certified source.

Until this is closed, `containers`, `image-vulnerabilities` and `component-inventory` are
INCOMPLETE by design. Closure is a product change owed to 8D/8F: add
`--label org.opencontainers.image.revision=$APP_GIT_SHA` (the build arg already exists in
`backend/Containerfile`) plus `io.oaa.candidate-id` for dirty candidates, or emit
`release-certification/release-build-manifest.json`. Both proofs are already implemented
and tested on the verification side in `scripts/release/lib/provenance.mjs`.

### 5.12 — Bare-metal UPI "no installer-managed provisioning" copy was unreachable · **CLOSED by 8B.4**

*(Found by Tranche 8B.3 while attempting to correct a skipped test.)*
`PlatformSpecificsStep.jsx` rendered a `bare-metal-upi`-specific message only when no
other section applied, but `showAdvancedSection` was unconditionally true for that
scenario, so the branch never executed. A test skipped since the initial public release
had asserted it.

**Proof of unreachability (8B.4).** Reaching the block requires `!showAdvancedSection`.
`showAdvancedSection` is the disjunction of compute/controlPlane hyperthreading,
capabilities, `cpuPartitioningMode`, `featureSet`, `minimalISO`, `bootArtifactsBaseURL`
and the vSphere IPI section. A static read of the tracked catalogs shows the
`bare-metal-upi` catalog declaring six of those — `compute[].hyperthreading`,
`controlPlane[].hyperthreading`, `capabilities.baselineCapabilitySet`,
`capabilities.additionalEnabledCapabilities`, `cpuPartitioningMode`, `featureSet` — as
`supported-ui`, each with a minVersion at the baseline and no maxVersion, in **every**
supported minor. Visibility is a pure function of scenario, minor and catalog content,
with no mutable wizard state in the predicate, so the result is constant and the arm
could not be selected by any user action.

**Closure.** The unreachable ternary arm was removed; the surrounding block and its
generic message are unchanged. The skipped test was **replaced, not deleted**, by
executing per-minor tests asserting what `bare-metal-upi` actually does — Advanced
section present, IPI provisioning section absent, and the removed copy absent — so
neither the real surface nor the dead arm can change unnoticed.

The enumeration reads `SUPPORTED_MINORS` from the canonical authority
`frontend/src/shared/versionPolicy.js`, the same source the other frontend
version-aware tests consume. 8B.4 had hardcoded `["4.20","4.21","4.22"]`, which
delivered none of the forward protection the test claims: a newly onboarded minor would
have gone unexercised, which is exactly how the dead arm survived unnoticed in the first
place. Onboarding a minor now extends this test automatically.

No reachable behaviour changed: the block never rendered for `bare-metal-upi` before or
after, and every scenario that does reach it already took the generic arm.

### 5.10 — `backend/src/index.js` is 4,075 lines · low

Not a defect. Recorded as a maintainability observation only; Tranche 8 §14 explicitly
forbids cleanup driven by a tool's opinion, and nothing here justifies a refactor.

---

## 6. Lifecycle and resource risk inventory

Risk-ranked. Static counts are **where to probe**, never evidence of a defect —
asymmetry between acquire and release is frequently legitimate.

| rank | surface | signal | risk |
| --- | --- | --- | --- |
| 1 | runtime-package temp root | **confirmed leak**, §5.7 | **High** — unbounded disk growth, GB per export |
| 2 | `oc-mirror` / scan child processes | `spawn` in `operators.js:94`, `index.js:2640,2953`; tracked in `activeProcesses`; killed on SIGTERM | Medium — reaping on *cancel* and *error* paths unproven |
| 3 | frontend effect cleanup | 204 `useEffect`; 29 timer sites vs 17 clears; 37 `addEventListener` vs 34 removes; 4 `AbortController` | Medium — repeated step navigation untested for accumulation |
| 4 | SQLite handles | `better-sqlite3`; shutdown relies on `process.on('exit')` flush | Medium — documented and deliberate; needs a probe, not a redesign |
| 5 | `ocMirrorRuntime` fetch workdir | `mkdtempSync` at `:146`, `rmSync` at `:158` | Low — cleanup present; assert it holds on the error path |
| 6 | shutdown completeness | `process.exit(0)` without `server.close()`, with a documented undici rationale | Low — rationale is sound; assert children are reaped |
| 7 | job cleanup interval | `global.cleanupInterval`, cleared on shutdown | Low |

**8C deliverable:** drive each surface through N cycles and assert the resource count
returns to baseline. Do not claim "no leaks" from grep.

---

## 7. Certification architecture (implemented)

One entry point, independent axes, no logic in the orchestrator.

```
npm run release:certify              # FULL release certification
npm run release:certify -- --list    # registry, with required/non-waivable flags
npm run release:certify -- --axis <id> [--axis <id>…]   # PARTIAL: diagnostic
npm run release:certify -- --skip-containers            # PARTIAL: diagnostic
npm run release:certify -- --reuse   # reuse non-stale evidence only
```

```
scripts/release/
  certify.mjs              orchestrator only — selection, waivers, evidence, verdict
  waivers.json             TRACKED governance; currently empty
  certify.test.mjs         status model + orchestrator tests
  lib.test.mjs             candidate, evidence, provenance, scanner-DB tests
  axes.test.mjs            registry + per-axis pure-logic tests
  lib/status.mjs           five axis statuses, four run verdicts, waiver rules, exit codes
  lib/candidate.mjs        candidate identity binding (binary-safe)
  lib/evidence.mjs         run-scoped evidence store + reuse classes
  lib/provenance.mjs       source-candidate ↔ shipping-image binding
  lib/images.mjs           one-time image resolution + shared OCI archive lifecycle
  lib/scannerdb.mjs        vulnerability-database identity and freshness
  lib/exec.mjs             argv-only execution, uniform run records
  axes/                    15 registered axes (11 real, 4 planned), all required
```

124 deterministic tests across the three suites, all passing.

### Full versus partial runs

The central distinction, and the one 8A got wrong. `--axis` and `--skip-containers` both
omit required axes, and a run that omits a required axis has said *nothing* about release
readiness — however many of the axes it did run passed. Such a run is marked
`scope: partial` and its `releaseVerdict` can never be `GREEN`.

| axis status | meaning |
| --- | --- |
| `PASS` / `FAIL` | the proof ran |
| `INCOMPLETE` | the proof could not be performed |
| `WAIVED` | human-authorized exception, with owner and expiry |
| `NOT_APPLICABLE` | demonstrably does not apply, with evidence |

| run verdict | exit | meaning |
| --- | --- | --- |
| `GREEN` | 0 | every required axis ran and is non-blocking |
| `RED` | 1 | a required axis proved a defect |
| `INCOMPLETE` | 2 | all required axes attempted, some unprovable |
| `PARTIAL` | 4 | required axes were not attempted |
| *(harness error)* | 3 | the instrument itself failed |

Precedence is `RED > PARTIAL > INCOMPLETE > GREEN`. `PARTIAL` outranks `INCOMPLETE`
because it is the stronger statement: "we did not try" cannot be read as a near-miss.
`FAIL` still outranks both, because a proven defect is actionable now. Omitted required
axes are enumerated in the console output, in `summary.md` and in
`summary.json#missingRequiredAxes`, so a partial result cannot be mistaken for a complete
one by a human or by a script.

`.mjs` + `node:test` was chosen over shell because the repository's existing guards
already use exactly that (`validate-supported-minors.mjs`,
`validate-release-docs.test.mjs`), and because the result model needs structured JSON
that bash cannot express without a `jq` dependency in every axis. The existing shell
gate is **wrapped, not rewritten**.

**Exit codes:** `0` GREEN · `1` RED (a FAIL) · `2` INCOMPLETE · `3` harness error.

Design rules enforced in code, each from a specific past failure:

- an axis that throws becomes `INCOMPLETE`, never a crash and never a skip;
- nothing can upgrade a status; a waiver can never produce `PASS`;
- `NOT_APPLICABLE` without evidence throws at construction;
- the run never mutates the candidate — no install, no build, no git write.

### Evidence and retention policy

| class | location | policy |
| --- | --- | --- |
| harness | `scripts/release/**` | **tracked** |
| waivers | `scripts/release/waivers.json` | **tracked** — a waiver is a human decision and must be reviewable in history |
| generated run | `release-certification/runs/<runId>/**` | **gitignored** |
| CI | one run directory | workflow artifact, retention-limited |
| release | one *full*-scope run directory | attached to the release bundle |

Generated evidence is deliberately not committed: it is large and regenerable, and
committing it would dirty the tree on every run — which changes the candidate id and
invalidates the evidence just produced.

**Evidence is run-scoped.** Each run writes to a fresh
`release-certification/runs/<timestamp>-<candidate-prefix>/`, never into one shared
mutable directory. With a shared directory a later partial run overwrites `summary.json`
while the previous run's per-axis files and artifacts remain beside it, producing a
directory that mixes candidates and reads as current. Per-run directories make that
structurally impossible. Exclusivity is claimed with a non-recursive `mkdir`, so two runs
in the same second get separate directories rather than merging or aborting.
`latest.json` is a pointer file, not a symlink — evidence directories get archived and
copied between hosts, and a dangling symlink is worse than a stale pointer that names
what it points at.

### Candidate binding

`candidateId = sha256(HEAD | trackedDiffDigest | stagedDiffDigest | untrackedDigest)`.

Dirty trees are first-class: `HEAD = <sha>` is a lie when files on disk differ from that
commit, so the uncommitted delta is folded in. Two runs at the same HEAD with different
working-tree contents are different candidates.

The tracked diffs are taken with **`git diff --binary`**. This is load-bearing, not a
nicety: a plain `git diff` renders a changed binary file as the single line
`Binary files a/x and b/x differ`, which is *identical* for two completely different
replacement contents — so two different trees would have shared one candidate id, and
stale evidence would have been reused across them. Mode changes and deletions are carried
in the diff header either way.

### Evidence reuse policy

Matching the candidate and the declared inputs is sufficient only for axes whose truth is
a pure function of the source tree. It is not sufficient for anything whose answer can
change while the source stands still. Each axis therefore declares a reuse class:

**A full release certification never reuses evidence at all.** `--reuse` on a full run is
a harness error. Reused results are read out of an older run directory and their
artifacts are *not* copied forward, so a full run using reuse would produce a run
directory that is not self-contained while claiming to be the release evidence; and no
context key can fully specify an installed dependency tree, so "equivalent context" is
not provable for every axis. Rather than build a cache that copies artifacts and models
dependency state, reuse is scoped to diagnostics: **the certification of record executes
every required axis fresh.**

For scoped diagnostic runs, each axis declares a reuse class:

| class | axes | reuse requires |
| --- | --- | --- |
| `candidate` | `identity`, `repo-hygiene` | candidate id + input digest |
| `context` | `docs`, `containers` | the above **plus** a context digest |
| `never` | everything else | nothing; always re-run |

Only two axes are context-reusable, because only two have external context that can be
*completely* specified: `docs` (Node version) and `containers` (resolved image IDs plus
container-engine version). Everything else is `never`, conservatively:

- `tests` and `secrets` depend on three installed dependency trees; a Node version comes
  nowhere near describing them, and digesting `node_modules` on every run would be
  fragile, slow and still incomplete.
- `image-vulnerabilities` depends on the scanner **executable** and the advisory database
  together, and `grype db status` reports the database without reporting the binary that
  will read it.
- `component-inventory` depends on a native Syft resolved from `PATH`, whose version is
  not in reach of the selection logic.
- `dependencies-shipped` / `dependencies-builder`: `npm audit` queries the registry's
  live advisory service, which exposes no snapshot identifier.
- `ci-integrity`: a re-run, a new push or a cancellation changes the answer with the
  candidate untouched.

An axis declaring no inputs depends on the whole candidate, and an axis that declares no
reuse class defaults to `context` — conservative in both directions. The harness also
digests **itself**, so changing the instrument invalidates prior evidence.

### Image-to-candidate provenance

Resolving `:latest` to an immutable image ID guarantees every container axis inspects the
*same* image. It does not guarantee that image was built from the candidate. Tag, creation
time, and the developer's memory of having rebuilt are all worthless as proof, so two
independently verified bindings are accepted:

- **OCI labels (preferred):** `org.opencontainers.image.revision` matching HEAD for a
  clean candidate; `io.oaa.candidate-id` matching the candidate id for a dirty one — a
  commit SHA cannot describe uncommitted bytes.
- **Build manifest:** a release-build step emits
  `release-certification/release-build-manifest.json` naming the candidate and the exact
  image IDs it produced. The location matters: untracked files participate in the
  candidate id, so a manifest at the repository root would change the very candidate it
  exists to bind. `release-certification/` is gitignored, so files beneath it cannot move
  the candidate id. `OAA_CERT_BUILD_MANIFEST` may point elsewhere, but a location that
  participates in candidate identity is **refused, not used** — the fix is where the
  manifest lives, never a weakening of untracked-file binding.

The **complete** shipping set (`backend` and `frontend`) must be present and bound before
any image axis evaluates anything. Scanning whichever image happens to exist locally and
reporting PASS would certify half a release. Neither proof exists today — see §5.11.

---

## 8. Toolchain decisions

| need | choice | why |
| --- | --- | --- |
| image vulnerabilities | **Trivy** primary, **Grype** accepted | Trivy carries Red Hat OVAL/VEX data for UBI, which is what both shipping images are built on; a scanner without RHEL advisory data would under-report the base layers. Grype is supported as an alternate so a single vendor is not load-bearing. |
| SBOM generator | **Syft** | Emits SPDX and CycloneDX from one scan; same project as Grype. |
| SBOM format | **SPDX 2.3 JSON** primary, **CycloneDX** alternate | A **project and toolchain decision, not a regulatory one.** An earlier revision of this document claimed US federal guidance effectively selects SPDX; that is not accurate, and the claim is withdrawn. NTIA's minimum-elements work explicitly recognises multiple interoperable machine-readable formats — SPDX, CycloneDX and SWID — and deliberately does not name a winner. SPDX is chosen because it is the format most often *requested* by the disconnected and government OpenShift customers this product serves, and because Syft emits both from one scan so carrying the alternate costs nothing. |
| acquisition | **digest-pinned container, via `podman run`** | Needs no system package install (§8 forbids that without approval), pins by digest rather than a floating tag, and runs on Fedora/RHEL/CI/rootless alike. |
| scanned artifact | **one OCI archive per image from `podman save`**, addressed by **image ID** | §10 requires the image scanned to be the image reported. Tags do not satisfy that. Every strategy — native Trivy (`--input`), native Grype (`oci-archive:`) and containerized — reads the *same* archive, exported once per run and shared with the SBOM generator, then deleted. Letting each tool auto-detect its own source would mean the bytes scanned are not provably the bytes reported. Scanning an exported archive is also what makes the same bytes auditable on a disconnected high-side host. |

Both adapters are implemented. Both refuse to run until a human pins a digest:
`CONTAINERIZED_SCANNER.digest` and `CONTAINERIZED_GENERATOR.digest` are `null`, and the
axes report `INCOMPLETE` rather than run an unpinned scanner. Pinning is a human
decision — see §13.

> **8A.1 correction.** 8A named `docker.io/aquasec/trivy:0.68.0` and
> `docker.io/anchore/syft:v1.33.0`. `skopeo inspect` returned `manifest unknown` for the
> Trivy tag — **it does not exist**; the Syft tag was real but far behind. Both were
> written from memory rather than resolved. This is exactly why unpinned-and-unverified
> is refused rather than tolerated.

### Vulnerability database evidence

A pinned scanner digest fixes the code that interprets advisories; it does not fix the
advisories. The same binary over two database snapshots yields two verdicts for the same
image, so the database is recorded as evidence and gates the axis.

**No threshold is invented here**, because the two scanners genuinely differ in what they
declare:

- **Trivy** publishes its own validity horizon. `trivy version --format json` reports
  `VulnerabilityDB.NextUpdate` alongside `UpdatedAt` and `DownloadedAt`. Past
  `NextUpdate`, Trivy itself considers the database due for refresh — that is the tool's
  own declaration of staleness, and it is what gates.
- **Grype** publishes no horizon. `grype db status -o json` gives `schemaVersion`,
  `from`, `built`, `path` and `valid`; the `checksum` field was removed in DB v6 because
  the post-download index build makes the on-disk digest unstable. With no vendor-declared
  expiry, `built` is recorded and its age surfaced for human judgement rather than cut off
  at a fabricated number. `valid` is treated as **necessary but not sufficient** —
  Anchore has open reports of `db status` returning valid for a missing or unverified
  database.

  **Grype is therefore DIAGNOSTIC-ONLY for release certification in v2.1.** Treating
  `valid === true` as sufficient would let an arbitrarily old database produce a release
  PASS, and the only alternative is an invented age threshold, which is forbidden. If
  Grype is the selected scanner, `image-vulnerabilities` stays INCOMPLETE with that
  explanation; its findings remain worth reading, and its database identity and build age
  are still recorded. `GRYPE_FRESHNESS_POLICY.approved` in `lib/scannerdb.mjs` is a code
  constant, not configuration — 8D owns approving a policy, and doing so is a reviewed
  change.

If database identity cannot be established at all, the axis is INCOMPLETE.

**Disconnected caveat, stated rather than glossed:** both scanners need a vulnerability
database. On a disconnected certification host that database is a pre-seeded operator
input, and it remains identifiable evidence — the run records which snapshot it consulted.
It is not downloaded during an application run, and nothing in the shipped product
acquires it.

---

## 9. Container-scan closure plan (the named blocker)

0. **Close §5.11 first.** Without candidate-image provenance the scan is INCOMPLETE
   before a scanner is even selected. Add the OCI labels to both Containerfiles, or emit
   `release-build-manifest.json` from the release build.
1. Human approves and pins scanner digests. Resolved from the registry on 2026-10-12 and
   offered **for approval, not adopted** — 8D owns the decision, and these should be
   re-resolved at pinning time:

   | image | tag | digest resolved 2026-10-12 |
   | --- | --- | --- |
   | `docker.io/aquasec/trivy` | `0.75.0` | `sha256:af6acf9a6b85dfe389a1941505c0ce9efef52a4719635e1a962f022a3d855daa` |
   | `docker.io/anchore/syft` | `v1.54.1` | `sha256:3eb5379ba7b409c3f4069b686110527af0c47df993fa5c10d13e7cf34f49b1aa` |
   | `docker.io/anchore/grype` | `v0.120.1` | `sha256:e4a44ef45d285b829ce6efe2642980329661bd2d18eab5fc539138d4adaebbbe` |

   Record the approved values in `CONTAINERIZED_SCANNER` / `CONTAINERIZED_GENERATOR`.
2. Seed and record the vulnerability database (see §8). On a disconnected host this is a
   deliberate operator step.
3. `npm run release:certify -- --axis image-vulnerabilities --axis component-inventory`
   to iterate; a **full** run for the certification of record.
4. Triage findings in the UBI 9 base layers by severity against the Critical/High block
   policy already encoded.
5. Where a Critical/High has no fixed version available upstream, the **only** honest
   outcomes are: rebuild on an updated base image, or an explicit, reviewed policy change.
6. Attach SBOMs, the external-binaries document and scan reports to the release bundle;
   wire both axes into CI.

**The INCOMPLETE must not be converted to PASS, N/A or WAIVED to obtain GREEN.** Both
axes are marked `nonWaivable` in `scripts/release/axes/index.mjs`, so a `waivers.json`
entry naming either is rejected as a governance error and forces the run verdict off
GREEN. Relaxing that requires a reviewed code change, not a JSON edit.

---

## 9b. Component inventory: what the SBOM does and does not contain

*(Corrected by Tranche 8A.1.)* 8A titled this axis "SBOM generation for shipping images
**and packaged external binaries**" and satisfied the second half by attaching
`/app/tools-provenance.env` beside the SBOM. That overstated what was produced.

Syft inventories what a package manager can see: RPMs from the UBI 9 base layers and the
backend's production npm tree. `oc` and `oc-mirror` are `curl`-ed tarballs unpacked into
`/usr/local/bin` by the Containerfile — **no package database records them**, so they do
not appear as components in the generated SPDX or CycloneDX documents.

The axis is therefore named `component-inventory` and produces a **multi-document**
artifact set, with the contract stated in the evidence rather than implied:

1. **Syft SBOM** (SPDX + CycloneDX) — package-detectable image content.
2. **`external-binaries.json`** — a *required* companion document covering `oc` and
   `oc-mirror`, built from the build-time provenance the backend image records. Required
   fields: `OC_RESOLVED_VERSION`, `OC_RESOLVED_SHA256`, `OC_MIRROR_RESOLVED_VERSION`,
   `OC_MIRROR_RESOLVED_SHA256`, `TOOLS_RESOLVED_ARCH`.

Neither document alone is the component inventory. A missing or unparseable
external-binaries document makes the axis INCOMPLETE rather than letting a partial
inventory read as complete.

## 10. Compatibility and connectivity plans

**Compatibility.** Keep *development-host* compatibility strictly separate from *target
OpenShift cluster* architecture support; conflating them would misstate the product's
support boundary. Deterministically testable now: Linux/amd64 (GitHub runner),
Fedora 44/amd64 (local, evidenced above). Everything else — RHEL, Ubuntu, Debian,
macOS + Podman VM, Windows + WSL2, arm64 — is `INCOMPLETE` until infrastructure exists.
No fabricated PASS.

**Connectivity.** Six runtime egress sites inventoried statically (`cincinnati.js:45,96`,
`ocMirrorRuntime.js:87,232`, `docs.js:334`, `index.js:1104,3652`). 8E classifies each as
required / optional / discovery-only / connected-only / build-time-only, then runs the
backend under each profile. The disconnected profile must be proven by **denying egress
at the network layer and asserting no unexpected outbound attempt** — not by observing
that install generation happens to succeed offline.

---

## 11. GitHub triage (read-only; no mutation performed)

Assessed against current `develop` (`21529ae`). **No merge, close, comment, label or
rule change was made.**

Public repo, 34 stars, 12 forks, MIT, default branch `main`, no security policy.

| # | title | author | disposition | rationale |
| --- | --- | --- | --- | --- |
| 19 | Feature openshift arch integration | `mathianasj` | **MERGE AFTER REBASE/TEST** | Open since 2026-07-24, far behind develop. Arch support has since been rebuilt (`data/arch-support`, `validate-arch-support.js`); likely substantially superseded. Needs conflict assessment against the current matrix before any merge. |
| 17 | auto-detect/inject `custom-ca.pem` for build-time CA | `WadeBee-NG` | **MAINTAINER REFINE** | Real need (TLS interception is in the §17 connectivity matrix). Build-time CA injection touches the Containerfile, so it must land with the container axes, not before. |
| 14 | Making backend work on OpenShift | `cmays20` | **MERGE AFTER REBASE/TEST** | Overlaps `manifests/` and the PROD-026 frontend rework. Assess against current manifests. |

| # | issue | disposition | rationale |
| --- | --- | --- | --- |
| 18 | Default Availability Zones (multiple not available in UI) | **DEFER TO 2.1.x** | Product gap, not release-blocking. |
| 16 | Install error with self-signed certificates | **MAINTAINER REFINE** | Same root cause as PR 17; resolve together under PROD-043. |
| 15 | Quick Start Error | **MAINTAINER REFINE** | Needs reproduction against current develop before triage. |

**Repository posture (§5.8):** no branch protection on `main` or `develop`; Dependabot
disabled; no code scanning; secret scanning enabled with 0 alerts. Merging external PRs
into an unprotected default branch with a red CI gate is the governance risk worth fixing
before any of the three PRs is touched.

**Stale branches on `origin`:** `release/1.0` (duplicates `release/v1.0.0`),
`feat/highside-lowside-packaging-foundation`. No action taken.

---

## 12. Pre-main v1.x preservation — recorded, NOT executed

Tranche 8 §22 obligation, for execution in **Tranche 9**. Current state verified
read-only:

| ref | required | actual | state |
| --- | --- | --- | --- |
| `origin` tag `v1.7.1` | `ffed74d0807d7a3bfcd321b660d7145b6d43b44d` | `ffed74d0807d7a3bfcd321b660d7145b6d43b44d` | **already correct** |
| `continuity` tag `v1.7.1` | same | **absent** | **outstanding** |
| `release/v1.7.1` branch on `origin` | → `ffed74d…` | **absent** | **outstanding** |
| `release/v1.7.1` branch on `continuity` | → `ffed74d…` | **absent** | **outstanding** |

Before `main` advances to v2.x, the human must create the `release/v1.7.1` branch on both
remotes at `ffed74d…` and push the `v1.7.1` tag to `continuity`. **v1 history must not be
rewritten**; the stale 1.7.0 version strings at that commit stay as they are.

---

## 13. Human decisions required

Still open:

1. **Approve and pin the scanner and SBOM generator digests** (§9 step 1) — or approve
   installing `trivy`/`syft` as host packages instead. Candidate digests are recorded
   there; they were resolved, not remembered, but they are offered for approval rather
   than adopted. Blocks the named release blocker.
2. **Repository governance** (§5.8): enable branch protection on `main`/`develop`, enable
   Dependabot, add `SECURITY.md` (PROD-045)? All are account-level changes an agent must
   not make.
3. **Define the release unit** (§18 / PROD-042) before 8F automates its lifecycle.

Closed by Tranche 8B, retained so the decision trail is not lost:

- ~~Authorize 8B, the bounded CI-correctness tranche~~ — **authorized and executed.**
  §5.1–§5.6 are closed.
- ~~Adjudicate the 34 `operatorQuickPicks.js` version references~~ — **adjudicated as
  legitimate machine-readable version authority.** All 34 are strict `"4.x":` object
  keys in `versionPicks` maps; the module contains no version-bearing user-facing copy.
  The data had been moved verbatim out of `OperatorsStep.jsx`, where the same pattern
  was already adjudicated, and the guard rule simply had not followed the move. 8B.2
  narrowed the shared module's exemption to the object-key pattern alone — the
  `not OpenShift 4.`, `minVersion` and `maxVersion` patterns inherited from
  `OperatorsStep.jsx` were not required by any of the 34 findings and are **not**
  exempt there. Copy sharing a line with a map key is still caught, by stripping the
  key and re-testing the remainder.

---

## 13a. What `ci-integrity` actually requires

A commit alone is **not** sufficient, and earlier wording in this document ("resolves on
commit") was wrong. Both workflows trigger only on:

```yaml
push:         [master, main, develop]
pull_request: [master, main, develop]
```

`work/v2.1-release-hardening` appears in neither list, so pushing the hardening branch
produces **no workflow run at all** — and `ci-integrity` fails closed on a required
workflow that never ran, exactly as designed.

The contract, precisely:

1. the candidate must be **committed** (a dirty tree can have no remote evidence);
2. that exact commit must then receive an **applicable required remote CI run** — both
   `CI` and `Versioned Copy Guard`;
3. for this branch, **a pull request targeting `develop`** is the appropriate qualifying
   event, since `pull_request` fires on the target branch;
4. until such a run exists **for that exact commit**, `ci-integrity` stays INCOMPLETE.

Opening the PR is a **human-owned GitHub mutation** and is deliberately not automated.
`workflow_dispatch` was considered and deliberately not added: the PR path works, and
adding a manual trigger to make a gate satisfiable is the wrong instinct.

---

## 14. Ordered execution roadmap

| tranche | scope | gate |
| --- | --- | --- |
| ~~**8B**~~ **DONE** | CI correctness: backend reporter argv; declared root bootstrap; versioned-copy adjudication; evidence-ledger generator; `frontend/Dockerfile`; `package.json` repo URL | `tests`, `docs`, `repo-hygiene`, `secrets` green; `ci-integrity` needs a qualifying remote run (§13a) |
| **8C** | Lifecycle: fix §5.7 temp leak; build resource probes | `lifecycle` PASS |
| **8D** | **Close the container-scan blocker**: candidate-image provenance labels (§5.11), approve and pin digests, seed the advisory DB, scan, SBOM, triage base-layer CVEs | `containers`, `image-vulnerabilities`, `component-inventory` PASS — these two are non-waivable |
| **8E** | Connectivity profiles and compatibility matrix | `connectivity`, `compatibility` |
| **8F** | Release bundle definition + artifact lifecycle; digest pinning (PROD-030) | `artifacts` PASS |
| **8G** | Builder-stage advisories (DOC-207); signing/attestation (PROD-031) | `dependencies` builder scope clean |
| **8H** | Wire `release:certify` into CI; GitHub governance; PR/issue dispositions | full run GREEN |
| **9** | v1.7.1 preservation (§12), then `main` → v2.x | — |

8B is first because every other tranche's evidence is weakened while the project's own
CI gate is non-functional.

---

## 14b. Tranche 8A.1 — certification framework integrity corrections

Every item below is a defect in the **instrument**, found by independent review of the 8A
implementation before it was committed. No product finding was fixed and no product
behaviour changed.

| # | defect in 8A | correction |
| --- | --- | --- |
| 1 | `--axis` / `--skip-containers` removed axes from the rollup, so a partial run could print `VERDICT: GREEN` | run `scope` (full/partial) and a four-state `releaseVerdict`; omitted required axes enumerated in console, Markdown and JSON; exit 4 for PARTIAL |
| 2 | candidate identity hashed plain `git diff`, which renders any binary change as one identical line | `git diff --binary`, captured as raw bytes; regression test proves two different binary contents give different candidate ids |
| 3 | a stale local image with the right tag could certify newer source | `lib/provenance.mjs`: OCI-label or build-manifest binding, independently verified; container axes INCOMPLETE until proven |
| 4 | image axes used `images.filter(i => i.present)` and could PASS on one of two shipping images | complete required set (`backend` + `frontend`) enforced before any assertion |
| 5 | only the containerized path scanned an OCI archive; native Trivy/Grype read the local store | one archive per image per run, exported once, shared by scanner and SBOM, cleaned afterwards; explicit `--input` / `oci-archive:` sources |
| 6 | scanner pinned, advisory database unrecorded | `lib/scannerdb.mjs`; DB identity gates the axis; Trivy's own `NextUpdate` used as the staleness signal, no invented threshold for Grype |
| 7 | `--reuse` matched only candidate + inputs, so a DB or image change reused stale results | three reuse classes with context digests; `ci-integrity` and the dependency axes never reuse |
| 8 | one shared `release-certification/` directory mixed runs | run-scoped `runs/<runId>/`, exclusive `mkdir`, `latest.json` pointer |
| 9 | `ci-integrity` queried GitHub by HEAD even on a dirty tree, and accepted whatever workflows happened to return | dirty ⇒ INCOMPLETE; declared required workflow set; rerun-aware normalisation; missing required workflow ⇒ INCOMPLETE |
| 10 | builder Critical/High findings were recorded under a PASS and could not block GREEN | split into `dependencies-shipped` and `dependencies-builder`; builder findings FAIL their own required axis until 8G |
| 11 | axis claimed the SBOM covered `oc`/`oc-mirror`; it does not | renamed `component-inventory`; required companion document; field-level validation |
| 12 | every axis was waivable, including the named blockers | `nonWaivable` in the registry; duplicate ids, duplicate active waivers per axis and locale-ambiguous expiries rejected |
| 13 | malformed waivers produced `verdict: GREEN` with a non-zero exit | governance errors force the verdict off GREEN; console, Markdown, JSON and exit code agree |
| 14 | the `secrets` axis leaked its temp report directory | `try/finally` cleanup; shared OCI archives cleaned in the orchestrator's `finally` |
| 15 | privilege-drop proof regexed raw text, so a comment could satisfy it | shell comments stripped (quote-aware); `exec` into the helper required in executable position; drop target's uid verified non-zero inside the image |
| 16 | claimed US federal guidance selects SPDX | corrected to a project/toolchain decision; NTIA recognises SPDX, CycloneDX and SWID |
| 17 | named a Trivy image tag that does not exist | tags unpinned; real digests resolved via `skopeo` and recorded in §9 for human approval |

One further defect was found while testing the fixes and is also closed: run ids are
second-granular, so two runs started in the same second collided. Merging their evidence
would be wrong and aborting the second over a clock coincidence would be worse, so the
directory claim disambiguates with a suffix.

### Tranche 8A.2 — final instrument closure

Four remaining correctness issues, all found by the same independent review.

| # | defect | correction |
| --- | --- | --- |
| 1 | `evaluateDb` returned `acceptable: true` for any valid Grype DB with a build date, so an arbitrarily old database could produce a release PASS — contradicting the module's own "necessary but not sufficient" note | Grype is diagnostic-only until a human approves a freshness policy (`GRYPE_FRESHNESS_POLICY`, a code constant owned by 8D). Identity and build age are still recorded; sufficiency is refused. Trivy still gates on its vendor-declared `NextUpdate`. |
| 2 | `--reuse` on a full run inserted prior results into the summary without copying their artifacts forward, so the run directory was not self-contained | `--reuse` on a full run is a harness error. Reuse is a diagnostic convenience only; the certification of record runs every required axis fresh. Five more axes moved to `never` where external context cannot be fully specified. |
| 3 | the default build-manifest path was the repository root, which is untracked-and-not-ignored — writing it changed the candidate id it was meant to bind | default moved to `release-certification/` (gitignored, so outside candidate identity); an `OAA_CERT_BUILD_MANIFEST` override that would participate in candidate identity is refused. Untracked-file binding is unchanged. |
| 4 | the expiry regex was shape-only, so `2026-02-31` was normalised by `Date` to March 3 | every date component is round-tripped against the constructed `Date`; impossible dates and out-of-range times are rejected. `2028-02-29` is accepted, `2026-02-29` is not. |

**Test counts:** 141 harness tests across `certify.test.mjs`, `lib.test.mjs` and
`axes.test.mjs`, all passing (49 at 8A → 124 at 8A.1 → 141 at 8A.2). Repository
`test:tooling` goes from 609 to 701 tests with the same 10 pre-existing failures (§5.2)
and no new ones.

## 14c. TODO / skip audit (Tranche 8B.1, corrected by 8B.3)

Every non-executing test in the repository, with its disposition. "Pre-existing" is a
provenance label, not a disposition, and is not used as one here.

**None of the seven was introduced, newly skipped, deleted, weakened or quarantined by
8B, 8B.2 or 8B.3.** Suppression counts are identical to checkpoint `db1a4b6`.

### Backend — 5 TODOs, all DEFERRED_WITH_OWNER

All in `backend/test/nic-bond-vlan-ipv6.test.js`; introduced by `8cb036d` (2026-07-28,
*"DOC-102: Complete backend test integrity"*) as declarations of unimplemented
capability, not as suppressions of working behavior. Five TODOs across four backlog
items (DOC-123 owns two).

| line | test | owner |
| --- | --- | --- |
| 249 | multiple bonds on same node | DOC-123 `deferred`/p2 |
| 251 | multiple VLANs on same bond | DOC-123 `deferred`/p2 |
| 287 | asymmetric VIPs (IPv4 ingress only) | DOC-124 `deferred`/p2 |
| 289 | static IPv4 + DHCP IPv6 on one interface | DOC-125 `deferred`/p2 |
| 291 | IPv6 route destinations | DOC-126 `deferred`/p2 |

These are not honour-system. `backend/test/test-integrity.test.js` mechanically enforces
that each `test.todo` has no executable callback, matches `[BACKLOG-ID] description -
reason`, names an ID that exists in `docs/BACKLOG_STATUS.md`, and is not already
resolved — "todo should be implemented or removed".

### Frontend — 2 skips

**`HostInventoryV2Phase42.test.jsx` — "compare toggle calls updateState only with ui"
→ OBSOLETE; test DELETED by 8B.5.**

8B.1 classified this JUSTIFIED_NON_GATING, which kept a permanently-skipped test in the
suite. 8B.5 re-examined it and concluded the stronger disposition is correct: the test
is not deferred coverage, it is coverage of behaviour that no longer exists, and a skip
is the wrong container for that.

Evidence, re-verified before deletion: `compareMode` has **zero** occurrences in
`frontend/src`, `backend/src`, `shared/`, `schema/` and `docs/STATE_SCHEMA.md`, and
`HostInventoryV2Step.jsx` hardcodes `sectionCompareBadge = null`. There is no toggle and
no `ui.compareMode` state, so the asserted contract cannot exist.

Deleted rather than replaced. No active supported contract loses coverage; a stub
asserting the feature's absence would test nothing actionable, and re-skipping it would
have preserved the suppression this audit exists to remove. A residual inert
`CompareBadge` component remains in product code — recorded as an observation only,
untouched, and not owned by 8B.

**`platform-specifics-step.test.jsx` — "shows UPI message (integration)"
→ RESOLVED by 8B.4. No longer a suppression.**

Its history is worth keeping, because the classification changed twice:

- **8B.1** flagged it INVALID_TEST_TO_CORRECT, judging that it guarded a real
  user-facing contract with no executing coverage.
- **8B.3** disproved that. An empirical probe showed `upiMessagePresent = false` with
  `advancedButtonPresent = true` for a `bare-metal-upi` state: the asserted contract did
  not exist, and the skip's stated reason ("store sometimes receives default mock
  state") had misread a deterministic failure as flakiness. Writing an executing test
  would have required asserting something the product does not do, or changing product
  behaviour to satisfy a test. It was escalated as §5.12 instead of forced.
- **8B.4** proved unreachability across every supported minor, removed the dead arm, and
  replaced the skipped test with three executing per-minor tests. See §5.12.

### Current intentional suppression inventory

| kind | count |
| --- | --- |
| backend TODO (`deferred`/p2, backlog-owned; DOC-123 ×2, DOC-124, DOC-125, DOC-126) | 5 |
| frontend skipped tests | **0** |
| unresolved invalid skips | **0** |

The five backend TODOs are **not** resolved and are **not** completed — they remain
deferred product-capability declarations owned by their backlog entries, and the
`test-integrity` meta-guard will fail if any of those IDs is later marked resolved while
the TODO still stands.

The frontend now carries **no** skipped tests. The two it had were dispositioned on
their merits rather than by age: one described an unreachable contract and was replaced
with executing per-minor coverage (§5.12); the other described a removed feature and was
deleted.

---

## 15. Deferred work — confirmed untouched

DOC-188 advanced bond options · DOC-191 version-aware Day-1 NMState program · Service
Mesh distributed-tracing Quick Pick · IBM Power / IBM Z onboarding · heterogeneous
cluster architecture research · Additional Routes card polish · broader enterprise
productization · all other post-v2.1 backlog work.

No NMState feature work was performed. The support boundary (4.20 baseline, 4.21, 4.22;
4.23 unsupported) is unchanged, and no Agent Day-1 / bare-metal IPI Day-1 / post-install
NNCP / Bond CNI separation was altered. NMState future-minor automation foundations are
scheduled no earlier than 8F and remain scoped to schema-delta detection, support-authority
comparison, generated-path inventory and regression fixtures — not the deferred feature
program.
