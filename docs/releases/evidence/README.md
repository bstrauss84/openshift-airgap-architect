# Release-history evidence

Raw evidence behind the v2.x release notes. This directory exists so the published
notes can stay readable prose while the underlying claim-by-claim audit remains
inspectable. Nothing here is user documentation; start at
[CHANGELOG.md](../../../CHANGELOG.md) or the
[v2.1.0 notes](../v2.1.0.md) instead.

## `v2-commit-coverage-ledger.csv`

One row per **unique commit** between the v1.7.1 production anchor and the v2.1
release-hardening head. Produced mechanically from git, then given a coverage
disposition by explicit rule.

| field | meaning |
|---|---|
| `seq` | position in chronological order (1 = oldest) |
| `sha`, `short`, `date`, `parents`, `parent_count` | verbatim from `git log` |
| `reachability` | which refs the commit is reachable from |
| `classification` | `v2.0`, `v2.1`, or `cannot-determine` |
| `files_changed`, `insertions`, `deletions` | from `git show --numstat` |
| `areas` | product areas derived from changed paths by a fixed rule table |
| `changed_paths` | first 12 changed paths (count appended when truncated) |
| `impact_kind` | `user-visible` or `infrastructure-only` |
| `impact_reason` | why — for infrastructure-only rows, the exclusion reason |
| `theme` | release-note grouping |
| `backlog_ids` | IDs **present in the commit message**. Never inferred, never invented. |
| `github_refs` | issue/PR references and full URLs found in the message |
| `release_note` | which release note covers the row |
| `coverage_anchor` | the specific release-note section, or the omission/exclusion reason |
| `disposition` | `represented`, `not applicable (infrastructure-only)`, `missing`, `needs verification` |

### Counting semantics

The boundary commits and counts are stated explicitly because "how many commits"
has no single answer without them.

| range | count |
|---|---|
| `main..develop` | 188 |
| `develop..work/v2.1-release-hardening` | 21 |
| `main..work/v2.1-release-hardening` | **209** |

`main` is `ffed74d0807d7a3bfcd321b660d7145b6d43b44d`, which is exactly the `v1.7.1`
tag — the production anchor. The ledger now covers through
`f9d59e39d53d0a08bdff034da6d832c8032f97bf`.

**All counting modes agree**: `--all` (reachable), `--no-merges`, and
`--first-parent` return the same number, because the range contains **zero merge
commits**. Every row in the ledger has `parent_count = 1`. There is therefore no
first-parent-versus-reachable ambiguity to resolve, and no merge to explain.

> **A ledger cannot contain the commit that writes it.** The first published
> version of this file counted 209 commits as 208 and named `f1459a5` as the head.
> That was correct at the moment it was drafted and wrong the moment it was
> committed: the act of committing the ledger created commit
> `f9d59e3`, a 209th commit that the ledger it contained did not list.
>
> This is structural, not a one-off mistake, so it needs a rule rather than a
> patch. **The commit that updates this ledger must be appended to it by the next
> update**, and the counts above name an explicit head rather than saying "HEAD".
> Verify with `git rev-list --no-merges --count <main>..<stated head>`; if the
> working head is ahead of the stated head, the difference should be exactly the
> commits added since, and they belong in the next revision.

No commit in the range is a cherry-pick duplicate of another: comparing
`git patch-id --stable` across all 209 commits yields no duplicate patch ids. Two
*subjects* repeat (`DOC-102: Complete version-aware UI standards` and
`DOCS: Move platform audit docs to local archive`), but they are distinct patches.

### Version boundary

The `v2.0.0` tag is an annotated tag (`a9063d4`) pointing at
`09703fa675ac95ae8099c01f30454ad9db408a42`. That commit is an ancestor of both
`develop` and the hardening head, which makes the boundary unambiguous:

- `main..09703fa` = **176** commits → classified `v2.0`
- `09703fa..f9d59e3` = **33** commits → classified `v2.1`
- 176 + 33 = 209 ✓

### Branches that are *not* counted separately

These refs were checked and contribute **zero** unique commits, because each is
already an ancestor of the hardening head. They are not double counted:

| ref | head | unique commits vs HEAD |
|---|---|---|
| `work/v2.1-ocp-4.22-onboarding` | `21529ae` (identical to `develop`) | 0 |
| `work/v2.0-colleague-runtime-ui-20261001` | `e8d6714` | 0 |
| `supervised/v2.0`, `release/v2.0.0` | `09703fa` | 0 |
| `backup/develop-pre-v2.0-*` | `8cb53ad` | 0 |
| `backup/reimage-20260925-supervised-v2-wip` | `9ab7dbe` | 0 |

### Completeness

```
represented                          137
not applicable (infrastructure-only)  64
missing                                7
needs verification                     1
                                     ---
total unique commits                 209
```

The identity `represented + excluded-with-reason + pending = total` holds exactly.
It is not rounded and no row is unaccounted for.

The seven `missing` rows are genuine omissions this audit found in the published
notes; each row's `coverage_anchor` names what is missing and from which document.
The single `needs verification` row (`9ab7dbe`) is an aggregate WIP checkpoint that
carries no single release-note theme.

### What this ledger does *not* do

It does not infer user-facing features from commit subjects. `impact_kind` is
derived from **changed paths**, and a row is only marked `represented` when a named
release-note section actually covers it. Rows that nothing covers are marked
`missing`, not quietly dropped.

### Regenerating

The ledger is a point-in-time artifact pinned to the head recorded above. It is
committed rather than generated on demand because its purpose is to record what was
audited, at the commit it was audited against.
