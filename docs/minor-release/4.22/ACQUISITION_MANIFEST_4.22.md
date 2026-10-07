# OCP 4.22 Acquisition and Provenance Manifest

> **Tranche 1 deliverable 1 of 10.** Research and acquisition only.
> **4.22 remains unsupported and fail-closed.** Nothing in this document authorizes any
> product behaviour. Machine-readable source: [`acquisition-manifest-4.22.json`](acquisition-manifest-4.22.json).

**Status authority** for anything in here remains `docs/BACKLOG_STATUS.md`.
**Procedure** is `docs/minor-release/MINOR_ONBOARDING_RUNBOOK.md` Rule 2 and Phase 1.

---

## 1. Exact release pin

Resolved with the **same mechanism the product itself uses** for target-minor latest-patch
resolution — the Cincinnati `stable-<minor>.yaml` channel read by
`backend/src/cincinnati.js` `fetchStableFile()`, filtered and sorted by
`fetchPatchesForChannel()`. No nightly, CI, release-candidate, prerelease or
`release-4.22` branch tip was considered (runbook Rule 2.1).

| Field | Value |
|---|---|
| minor | **4.22** |
| exact release | **4.22.16** |
| release discovery source | `https://raw.githubusercontent.com/openshift/cincinnati-graph-data/master/channels/stable-4.22.yaml` |
| channel node count | 92 |
| resolution timestamp | `2026-10-07T17:08:58Z` |
| payload digest | `sha256:55a0c0c8f9a285fa468009511dd878d5492436ceb4f0207933b6403d19353876` |
| binary download source | `https://mirror.openshift.com/pub/openshift-v4/x86_64/clients/ocp/4.22.16/openshift-install-linux-4.22.16.tar.gz` |
| checksum source | that release's own `sha256sum.txt`, verified **before** use |
| tarball SHA256 | `6f26860ba4ebaaf346ce7711be166105205e9edfff9993d9f15834c54a2e0fe5` |
| binary SHA256 | `62b3a91ca3f242dd6feec1aefec8f5f5e7af4e13982f65600eb84fc56ca71a33` |
| architecture | `amd64` |
| embedded installer commit | **`92820966521d640aa5f0edfb69bcfd9c168c2210`** |
| matching source retrieval | `git fetch --depth 1 https://github.com/openshift/installer.git 92820966521d640aa5f0edfb69bcfd9c168c2210` |

`openshift-install version`, verbatim:

```
4.22.16
built from commit 92820966521d640aa5f0edfb69bcfd9c168c2210
release image quay.io/openshift-release-dev/ocp-release@sha256:55a0c0c8f9a285fa468009511dd878d5492436ceb4f0207933b6403d19353876
release architecture amd64
```

**Binary-to-source relationship: ESTABLISHED.** The digest the binary prints matches the
`Digest:` field of the channel's own `release.txt`, and the commit the binary reports
resolves in `openshift/installer`. The runbook's fail-closed condition (Rule 2.6) does not
fire.

## 2. Prior-minor mechanical baseline

Re-verified from **committed 0B provenance** — `scripts/minor/repair/proven-repairs.js`
`INSTALLER_PINS` — rather than from the tranche prompt, as instructed.

| Field | Value |
|---|---|
| minor | 4.21 |
| release | **4.21.35** |
| installer commit | **`006669f5812a47dbc733b6736584b87ef696e898`** |
| payload digest | `sha256:1f8f423477982ce16193469c26f8941ba797a6f4fc3b3621a5d426ae19deb457` |
| superseded branch tip (**not used**) | `1accb6487cf3784561665c08048dde20ad672c39` |

Both prompt-supplied values match the committed record exactly.

> The 4.21 extraction baseline in `local-docs/ocp-4.21/analysis/installer-source-params.json`
> (gap list **GAP-05**) was **not** used. It was produced from the superseded `release-4.21`
> branch tip, so it is not "exact released 4.21 source" and would have violated the
> comparison's own premise. 4.21 was re-extracted from `006669f5…` for this diff.

## 3. Global oc-mirror v2 (DOC-166 input)

`oc-mirror` follows a **deliberately different** policy from `oc`: latest available
**globally** from `clients/ocp/latest`, independent of the target minor.

| Field | Value |
|---|---|
| channel | `https://mirror.openshift.com/pub/openshift-v4/x86_64/clients/ocp/latest` |
| channel release name | **4.22.17** |
| artifact | `oc-mirror.rhel9.tar.gz` |
| tarball SHA256 | `2a2e3a3be56a5a44fca7c1e9249e7ed32a9dbf04c67225281c232b1cc31afe42` (verified before use) |
| binary SHA256 | `e03f81341d1186a03504a1be8f356265b974004782f07a35123e9cf6e35808d8` |
| component version | `4.22.0-202609301304.p2.g3f66eda.assembly.stream.el9-3f66eda` |
| git commit | `3f66edaf31831b93043b0baa55d02462d4e7ee39` |
| build date | `2026-09-30T13:40:59Z` |
| architecture | `linux/amd64` |

Three version numbers are in play and **all three are correct**:
the channel release is `4.22.17`, the supported-target stable release is `4.22.16`, and
oc-mirror's own component version reports `4.22.0-…`. This is exactly the asymmetry
`CLAUDE.md` warns must not be collapsed — and note that **today, with 4.22 unsupported,
the product's own resolver already pulls an oc-mirror built from the 4.22 stream.** That is
intentional and is not a target-support statement.

`--v2 list operators --catalog=<…>` exists in this binary, so the operator-discovery
requirement is met.

## 4. Cincinnati channel snapshot (Phase 1H input)

Retrieved `2026-10-07T17:08:58Z`.

| Channel | HTTP | Nodes | Latest |
|---|---|---|---|
| `stable-4.20` | 200 | 142 | 4.20.40 |
| `stable-4.21` | 200 | 75 | 4.21.35 |
| `stable-4.22` | 200 | 92 | **4.22.16** |
| `stable-4.23` | **404** | — | — |
| `eus-4.20` | 200 | 142 | 4.20.40 |
| `eus-4.21` | **404** | — | — |
| `eus-4.22` | 200 | 92 | 4.22.16 |
| `fast-4.22` | 200 | 95 | 4.22.17 |
| `candidate-4.22` | 200 | 96 | 4.22.17 |

**Correction to a Revision-3 figure.** The plan recorded `stable-4.23` and `eus-4.21` as
"0 nodes". They return **HTTP 404** — the channel file does not exist at all. The
distinction matters for the Tranche-6 fixtures: a fixture modelling "empty channel" would
not reproduce what the product actually encounters. 4.23 remains the fail-closed sentinel.

## 5. What is tracked and what is not

Tracked (this directory): URLs, retrieval timestamps, hashes, exact commits, release
digests, extracted facts, ledgers, reproduction instructions.

**Not tracked**, held under `/home/bistraus/oaa-v2.1-evidence/ocp-4.22/`: the installer
tarball and binary (469 MB / 752 MB), both installer source clones, documentation HTML,
the oc-mirror tarball and binary, and the binary-probe scratch directories.

### Extraction artifacts and their hashes

| Artifact | Size | SHA256 (first 16) |
|---|---|---|
| `install-config-params-4.21.json` | 792 KB | `75a8bb94c7f7533a` |
| `install-config-params-4.22.json` | 817 KB | `a38259c45ceb1bdb` |
| `agent-config-params-4.21.json` | 13 KB | `d8aaaff37e4828d3` |
| `agent-config-params-4.22.json` | 13 KB | `a7f1cda911dc3fb6` |
| `delta-install-config-4.21-to-4.22.json` | 26 KB | `db784d65fa35771c` |
| `delta-agent-config-4.21-to-4.22.json` | <1 KB | `d2379c56a7f8af66` |

> **GAP-05 decision still open, and now sharper.** The gap list asks the human to choose
> between committing these extraction JSONs as tracked baselines or recording hashes plus
> reproduction instructions. This tranche does the latter. The argument for committing has
> strengthened: the extractions are now pinned to **immutable commits** rather than moving
> branch tips, so reproduction is genuinely deterministic — which weakens the original
> worry. The counter-argument is unchanged: 1.6 MB of generated JSON in Git. Still a human
> decision; see the automation reuse report.

## 6. Deterministic reproduction

```bash
WS=/var/tmp/oaa-4.22                      # outside the repository
REL_421=006669f5812a47dbc733b6736584b87ef696e898
REL_422=92820966521d640aa5f0edfb69bcfd9c168c2210

for pair in 4.21.35:$REL_421 4.22.16:$REL_422; do
  rel=${pair%%:*}; sha=${pair##*:}
  mkdir -p "$WS/installer-$rel" && git -C "$WS/installer-$rel" init -q
  git -C "$WS/installer-$rel" remote add origin https://github.com/openshift/installer.git
  git -C "$WS/installer-$rel" fetch -q --depth 1 origin "$sha"
  git -C "$WS/installer-$rel" checkout -q FETCH_HEAD
done

for root in install-config agent-config; do
  node scripts/minor/extract/parse-go-structs.js \
    --minor 4.21 --release 4.21.35 --source "$WS/installer-4.21.35" \
    --root $root --out "$WS/$root-params-4.21.json"
  node scripts/minor/extract/parse-go-structs.js \
    --minor 4.22 --release 4.22.16 --source "$WS/installer-4.22.16" \
    --root $root --out "$WS/$root-params-4.22.json"
  node scripts/minor/compare/diff-params.js \
    --baseline "$WS/$root-params-4.21.json" --target "$WS/$root-params-4.22.json" \
    --previous-minor 4.21 --minor 4.22 --out "$WS/delta-$root-4.21-to-4.22.json"
done
```

`extractedDate` and `comparisonTimestamp` are wall-clock and will differ between runs;
every other field is a function of the pinned commits.
