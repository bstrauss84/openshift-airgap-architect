# Requirement Ledger — 33-file wave correction pass (2026-10-16)

Per the OAA Implementation-Agent Execution Contract (`CLAUDE.md`), recorded
**before** any edit. Baseline: branch `work/v2.1-release-hardening`, HEAD
`f9d59e39d53d0a08bdff034da6d832c8032f97bf`, 33 uncommitted paths, 2 pre-existing
stashes, PR #20 draft → `develop`.

The named report `OAA_V21_33FILE_SOURCE_REVIEW_20261016.md` is **not present on
this host** (only the correction brief,
`~/Downloads/OAA_V21_CLAUDE_33FILE_CORRECTION_20261016.md`). Every defect below
was therefore re-derived from source rather than taken from prose, which is what
the brief asks for in any case. All three reproduced exactly as described.

---

## R1 — Mirror-registry streaming must extend into the ZIP

| | |
|---|---|
| **Current behavior** | `backend/src/index.js:4013` registers the 1.19 GiB tarball with `tracked.file(...)`. |
| **Authoritative evidence** | `backend/src/exportIntegrity.js:223` — `const content = fs.readFileSync(filePath)`. Download-side streaming (`verifiedDownload.js`) is real, but the saving is given straight back at bundle-registration time. |
| **Planned change** | Hard-link the verified cache inode into a private per-request `0700` staging directory, register it with the existing `tracked.streamFile`, assert the streamed digest equals the digest `acquireVerifiedArtifact` verified, release staging only after the archive stream settles. |
| **Why a hard link** | `streamFile`'s documented precondition is *exclusive ownership* — archiver opens the path later, while the response drains. The cache path is shared and is `rm`/`rename`-able by a concurrent export, so it does not satisfy that precondition. A hard link is a second name for the same inode: zero bytes copied, and unlink/rename of the cache name cannot affect it. |
| **Deterministic test** | `backend/test/mirror-registry-export-streaming.test.js` — bounded-buffer assertion on a 64 MiB fixture, eager control, member selection/inclusion for all three arches, unsupported-arch rejection, digest-divergence fails the export. |
| **Manual verification** | No persistent giant fixture, no network in the default suite; `node --test` wall-clock and peak RSS observed. |

## R2 — Cached installer executables must be verified before reuse

| | |
|---|---|
| **Current behavior** | `backend/src/installer.js:113` and `backend/src/openshiftInstaller.js:167` return a pre-existing extracted binary with no revalidation. |
| **Authoritative evidence** | `installer.js:113` `if (fs.existsSync(target)) return target;` — and `installerPathFor(version)` carries **no architecture segment**, so an `x86_64` binary cached earlier is returned verbatim on an `aarch64` host and then `spawn`ed for `coreos print-stream-json`. `openshiftInstaller.js:167` keys its directory on `version-platform-arch-variant`, so it has no arch-collision bug, but it still reuses bytes that may predate verification, or be corrupt. |
| **Planned change** | New `backend/src/binaryProvenance.js`: an atomically published sidecar binding schema, tool, version, platform, architecture, FIPS variant, verified **tarball** SHA256 and extracted **executable** SHA256. Reuse re-hashes the executable and requires every identity field to match. Legacy/absent/corrupt/mismatched ⇒ never run or export; reacquire if the network allows, otherwise fail closed with a clear offline message. A valid record stays usable with no network. |
| **Deterministic test** | `backend/test/installer-cache-provenance.test.js` — pre-existing unverified cache, tampered executable, architecture change at the same version, sidecar corruption, process restart, valid offline reuse. |
| **Manual verification** | Fixture-fetch only; no mirror contact. Red Hat URL construction and image-variant policy asserted unchanged. |

## R3 — Concurrent destination downloads must not collide

| | |
|---|---|
| **Current behavior** | `backend/src/verifiedDownload.js:129` stages at `${destPath}.part-${process.pid}`. Two downloads in one process share the name; one wins the rename, the other gets `ENOENT`. |
| **Authoritative evidence** | Reproduced below as a red test before the fix. |
| **Planned change** | (a) per-destination in-flight de-duplication keyed on the resolved `destPath`, with an identity conflict (same path, different artifact) raised rather than silently resolved; (b) unique staging `${destPath}.part-${pid}-${uuid}`; (c) **verify before publish** — the digest is computed on the staging file and a mismatching download is deleted without the cache path ever being touched; (d) non-regular / symlinked cache destinations refused. |
| **Deterministic test** | `backend/test/verified-download-concurrency.test.js` — overlapping requests, simultaneous digest failure, abort/interruption cleanup, and proof that a rejected download removes neither another caller's verified file nor its sidecar. |
| **Manual verification** | Fixture fetch; staging directory inspected for leftovers after each case. |

## R4 — Documentation accuracy

`docs/security/SBOM_AND_PROVENANCE.md` currently says the external-binary
`verificationGaps` field is empty and that "a cached artifact is reused only
when a recorded digest exists and the bytes on disk still hash to it". That was
true of the **tarball** cache and untrue of the **extracted executable** cache
until R2 lands. Corrected only once the code supports the claim (contract rule
8: reconcile docs last).

Preserved verbatim: the README apology, the upgrade warning, the 208-commit
ledger, backlog cross-references, every supported-minor list, full
mirror-registry export functionality, and the vendor-owned CVE disposition with
its independent UBI/application obligations.

---

## Outcomes

Recorded after the final consolidated run, not before.

| Req | Implementation | Test | Result |
|---|---|---|---|
| R1 | `index.js` hard-links the verified inode into a private `0700` staging dir and calls `tracked.streamFile(..., { expectedSha256 })`; `exportIntegrity.js streamFile` verifies **before** mutating the tracker; staging released in the archive-stream `finally`. | `mirror-registry-export-streaming.test.js` | 16/16 |
| R2 | New `binaryProvenance.js`; both `installer.js` and `openshiftInstaller.js` verify on reuse, discard what they cannot prove, reacquire or fail closed with a stated reason. | `installer-cache-provenance.test.js` | 17/17 |
| R3 | `verifiedDownload.js` — per-destination in-flight de-duplication, unique `pid+uuid` staging, verify-before-publish, non-regular destination refused. | `verified-download-concurrency.test.js` | 12/12 |
| R4 | `SBOM_AND_PROVENANCE.md` scope note; `toolProvenance.mjs` hand-maintained block and both `verificationMethod` strings widened in the same change, as that block's own rule requires. | `toolProvenance.test.mjs` | 26/26 |

Consolidated: backend **3114 tests, 0 fail** (5 pre-existing todo); frontend
**4435 tests, 167 files, 0 fail**; `npm run build` exit 0; security gate
self-tests `gate-evidence-contract` 15/15, `gate-candidate-binding` 10/10,
`gate-container-scan` 28/28, `image-surface` 28/28. Backend source byte-stable
(`sha256sum -c`) across the final run.

`scripts/security/verify-mirror-artifact-contract.mjs` was run against the live
mirror (opt-in, not in the default suite) and independently confirms the premise
R2 rests on: the four architectures publish **four different binaries under one
file name**, and the architecture-free legacy path is an x86_64 alias.

### Evidence gap, stated rather than closed

The bounded-memory assertions use 64 MiB fixtures, not the real 1.19 GiB
artifact. A true 1.19 GiB export was **not** performed: it needs ~2.5 GiB of
free disk plus sustained egress, and a persistent giant fixture is exactly what
the default suite must not carry. What is proven is that registration cost does
not scale with member size (16 MiB vs 64 MiB, same bounded allocation) while the
eager control holds the whole member. That licenses the extrapolation; it is not
the same as a load test, and is not reported as one.

The container image vulnerability axis remains **FAIL / RED** and is unchanged
by this wave. Nothing here makes it green and nothing here claims it is.

### Scope note on the commit ledger

The brief asked to preserve a "208-commit" ledger. The accepted wave had already
corrected that number: `v2-commit-coverage-ledger.csv` carries **209** unique
commits, and `docs/releases/evidence/README.md:54` records that an earlier
revision "counted 209 commits as 208". Both files were left untouched, so the
wave's correction is what is preserved — not the stale figure.

## Findings Queue (out of scope, recorded not actioned)

- `backend/src/index.js:30` imports `installerPathFor` and never uses it.
- `backend/src/installer.js:150` `getStreamMetadata` parses its cache with
  `JSON.parse(fs.readFileSync(...))` and no shape check; a truncated
  `stream-<version>.json` throws rather than refetching.
- `verifiedDownload.js` de-duplication is process-local. Two backend processes
  sharing one `DATA_DIR` volume cannot corrupt each other's bytes (unique
  staging + atomic rename + verify-before-publish), but they can each perform
  the transfer. A lock file was considered and rejected: stale-lock recovery is
  a worse failure mode for an offline tool than a duplicated fetch. Documented
  in the module header.
- `installerPathFor(version)` still carries no architecture segment. The
  provenance record detects and corrects cross-architecture reuse, so this is
  no longer a correctness defect, but two architectures alternating on one host
  would re-extract each time. Changing the path shape touches an exported
  symbol and was left out of a correction pass.
- `backend/test/export-failure-contract.test.js` carried a comment asserting
  `openshiftInstaller.js` downloads via `runCmd("curl", ...)`, which this wave
  had already made false. Corrected in place rather than left to mislead about
  a security-relevant path — the one file touched outside the three fixes.
