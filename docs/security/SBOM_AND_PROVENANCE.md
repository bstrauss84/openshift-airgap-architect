# SBOM, vulnerability evidence and provenance

**Status: nothing is published yet.**

No software bill of materials, vulnerability report, checksum file or signature for
OpenShift Airgap Architect is currently available to download. There are no published
GitHub Releases for this repository at all, so there is nowhere for such an asset to
have been attached.

This page exists so that the question "where is the SBOM?" has an honest answer today,
and a stable place to look once there is one. It describes what the project generates
internally, what it does **not** generate, and what has to be true before anything here
becomes a link you can click.

Tracked under **PROD-023** (SBOM generation for application images and packaged
external binaries, status `active`) and the **PROD-041** productization umbrella.

---

## What exists today

The generators are real, committed code, and they run. Their **output is not committed
and not published**.

| | |
|---|---|
| Generator code | `scripts/release/axes/sbom.mjs`, `scripts/release/provenance/sbomGenerate.mjs` — tracked in git |
| Generated output | written under `release-certification/runs/<run-id>/` |
| Is the output in git? | **No.** `.gitignore` excludes `release-certification/` in its entirety — `git ls-files release-certification/` returns nothing |
| Is the output published? | **No.** No GitHub Release exists |

The evidence is regenerable per run by design. Committing it would also dirty the
working tree on every run, which changes the candidate id and invalidates the evidence
just produced.

### The three documents a run produces

The certification axis is deliberately named **`component-inventory`**, not `sbom`,
because an SBOM alone does not describe everything this product ships.

1. **Per-image SBOMs** — `backend.cyclonedx-json.json`, `frontend.cyclonedx-json.json`
   CycloneDX **1.7**, produced by a digest-pinned containerized Trivy, covering OS
   packages, npm packages visible in the image layers, and Go modules embedded in the
   baked binaries. Each document is bound to its image config digest and rejected if
   that binding cannot be verified.

2. **Offline component inventory** — `offline-inventory.cdx.json`
   CycloneDX **1.5**, generated deterministically from the backend and frontend
   lockfiles plus each image's RPM database. Byte-identical across runs. It classifies
   components four ways (shipped-runtime, shipped-bundled, shipped-OS, builder-only) so
   that a build-host dependency is never mistaken for a shipped one.

   It carries its own caveat in metadata, and that caveat is accurate: it is **not a
   substitute for a filesystem-walking image scan**. It is derived from lockfiles and
   the rpmdb, so it omits anything neither source records.

3. **External-binaries document** — `external-binaries.json`
   A required companion, not an optional extra. `oc`, `oc-mirror`, `openshift-install`
   and `mirror-registry` are fetched as tarballs and have **no package-manager record**,
   so they appear in no generated SBOM. An SBOM presented without this document
   understates the shipped component set.

### Integrity of the four external binaries

All four are checksum-verified against the publishing channel's own `sha256sum.txt`
**at acquisition**, and the generated document's `verificationGaps` field is empty
*with respect to acquisition*. That qualifier is deliberate — see the scope note
below, which records what this does and does not cover.

- `oc` and `oc-mirror` — verified at **build time** in `backend/Containerfile`, and
  again at runtime by `backend/src/ocMirrorRuntime.js`. Installed digests recorded.
- `openshift-install` and `mirror-registry` — verified at **download time** by
  `backend/src/verifiedDownload.js`, fail-closed on download failure, missing or
  unparseable checksum metadata, a manifest with no entry for the file, or a digest
  mismatch. A cached **tarball** is reused only when a recorded digest exists and the
  bytes on disk still hash to it. The digest is computed on the staging file *before*
  the cache path is written, so bytes that fail verification never occupy it.
- `openshift-install` **after extraction** — the executable that is actually spawned
  and packaged is covered separately by `backend/src/binaryProvenance.js`. Each
  extracted binary carries an atomically written record binding its own SHA256 to the
  tool, version, platform, architecture, FIPS variant and the digest of the verified
  tarball it came from. Reuse re-hashes the executable and requires every field to
  match; a legacy, corrupt or mismatched cache is discarded rather than run or
  exported, and is reacquired when possible or failed closed with a stated reason when
  not. A valid record stays usable with no network.

> **Scope, stated precisely.** Until 2026-10-16 this section said all four binaries
> were verified and there were no gaps. That was true of the **tarballs** and was not
> true of the **extracted executables**: `installer.js` and `openshiftInstaller.js`
> both returned a pre-existing binary on an `fs.existsSync` check alone, so a binary
> that predated the checksum work, had been corrupted, or — because the `installer.js`
> cache path carried no architecture segment — had been extracted for a different
> execution host, was spawned and shipped unverified. The code now closes that gap;
> the claim above is narrowed to match what the code actually proves rather than left
> to overstate it.

Until 2026-10-16 the last two had **no integrity check at all** — `curl` exiting zero,
and for mirror-registry a non-zero file size. That mattered because
`openshift-install` is *executed* by the backend (`coreos print-stream-json`) and both
are packaged into the offline bundle an operator carries across the air gap.

> **This is checksum verification, not signature verification.** The manifest and the
> artifact come from the same origin over the same TLS connection, so this proves the
> bytes match what that origin published — not that the origin is authentic. Detached
> GPG signatures (`sha256sum.txt.gpg`, `.asc`) do exist on the mirror and are **not**
> checked; doing so requires pinning a Red Hat signing key as a trust anchor, which is
> a human decision recorded in
> [the API-exposure and trust-anchor decision record](DECISION_RECORD_API_EXPOSURE_AND_TRUST_ANCHORS.md#decision-b--red-hat-signing-key-as-a-trust-anchor).

`scripts/security/verify-mirror-artifact-contract.mjs` re-checks the live mirror still
publishes what this code assumes. It needs network and is deliberately not in any
default suite.

---

## Vulnerability scanning

Image scanning runs and produces real findings — this is not scaffolding. It is also
**not a clean result, and not a completed risk disposition.**

A full run on **2026-10-16** against candidate `f9d59e3+dirty:7a7dd8e2215b`, with a
digest-pinned Trivy (`docker.io/aquasec/trivy@sha256:af6acf9a…`) and a vulnerability
database built `2026-10-16T01:13:54Z`, records:

| image | critical | high | medium | low | unknown |
|---|---|---|---|---|---|
| backend | 1 | 96 | 361 | 155 | 6 |
| frontend | 0 | 30 | 494 | 402 | 0 |

The `image-vulnerabilities` axis verdict is **FAIL** and the overall release verdict
is **RED**.

**These counts are higher than the previous published figures** (backend 1/86,
frontend 0/22, from a scan bound to the stale, dirty candidate `f860d7db4457+dirty`).
Nothing regressed in this project's own code; the database moved. Treat any scan
figure as perishable — it describes an image *and* a database on a date.

### Where the findings actually live

This is the part that determines what can be done about them.

| source | backend | of which critical |
|---|---|---|
| UBI 9.8 base-image RPMs | 43 | 0 |
| `usr/local/bin/oc-mirror` (Red Hat binary, shipped verbatim) | 34 | 1 |
| `usr/local/bin/oc` (Red Hat binary, shipped verbatim) | 20 | 0 |

**54 of the backend's 97 critical/high findings are inside Red Hat's own `oc` and
`oc-mirror` binaries**, which this project does not build and cannot patch. The single
CRITICAL — **CVE-2026-33186**, `google.golang.org/grpc` v1.73.0, fixed upstream in
1.79.3 — is one of them, embedded in `oc-mirror`. Both tools are already at the newest
release the Red Hat channels offer (4.22.18), so there is no newer artifact to adopt.

The frontend's 30 are **entirely base-image RPMs with no fix available** — util-linux
family 14, python3 family 9, vim 2, libX11 2, expat 2, gnutls 1. **None implicates
nginx itself.**

Two consequences follow, and they should not be softened:

- **This axis cannot be driven green by engineering work in this repository.** The
  remaining routes are a newer UBI base, newer Red Hat client binaries, removing
  base packages that are not needed at runtime (the backend already does this for
  `nodejs-nodemon`), or an explicit, human-authored risk disposition.
- **A partial disposition now exists**, covering the vendor share only. See below.
  The UBI and application shares remain untriaged, and a findings count is still not
  a risk assessment.

### Vendor inherited risk — scope, and what it does not do

The project owner has approved **documented, per-artifact acceptance of inherited
risk** for unmodified, authentic official Red Hat binaries that this project ships
but does not build: `oc`, `oc-mirror` and `mirror-registry`. The project will not
fork, rebuild or patch a vendor binary merely to remediate an upstream CVE — doing so
would hand operators an artifact Red Hat does not support.

Implemented in `scripts/release/vex/vendorInheritedRisk.mjs`, and the constraints are
enforced in code rather than promised here:

- **Attribution is by in-image PATH, never by package name.** A finding counts as
  vendor-owned only when the scanner reports it against the exact path of a declared
  vendored binary. Name matching would be catastrophic: `golang.org/x/net` appears
  inside `oc-mirror` and could appear elsewhere, and accepting by name would silently
  accept findings this project owns. An unrecognised path is attributed to the
  **project** — the fail-closed direction.
- **Acceptance requires immutable identity, and the identity must COVER the findings.**
  Tool, version, architecture, SHA256 and source URL, for every binary the accepted
  findings are in. An acceptance that cannot name the exact artifact throws, because
  that would be a blanket tool exception, which was explicitly withheld. The
  acceptance expires the moment the artifact changes.

  > **Corrected 2026-10-19 (EVIDENCE-01).** The first implementation validated the
  > *members* of the identity list and nothing else, so an **empty list passed**:
  > `vendorRiskDisposition({toolIdentity: [], findings})` returned a complete
  > acceptance record for findings whose artifact was never named — precisely the
  > blanket exception the code above it said it refused. Nothing related identities to
  > findings either, so an identity for `oc` would have covered accepted findings in
  > `oc-mirror`. It now rejects an empty or missing list, a malformed SHA-256 or
  > source URL, an identity still carrying the `<arch>`/`<version>` template markers,
  > a tool that is not a declared vendored binary, duplicate or conflicting entries
  > for one tool, a finding whose vendor attribution does not re-derive from its scan
  > target, and — the check whose absence made the rest ornamental — any accepted
  > finding in a binary no identity names. **No count, scanner result or axis verdict
  > changed:** this makes acceptance harder to record, never findings easier to lose.
- **Nothing is suppressed.** No finding is dropped, no count is reduced, no scanner is
  disabled and `image-vulnerabilities` remains **non-waivable**. The axis continues to
  report every finding and continues to fail on what this project owns.

> **This is not a waiver, and the distinction is the whole point.** The owner accepted
> the *risk*, not the *absence* of the risk. An accepted risk is a known, recorded,
> still-present vulnerability. The axis answers "what is wrong with this image"; the
> disposition answers the separate question "who can fix each one, and what did the
> owner decide". Both are published and neither overwrites the other, which is how a
> non-waivable axis and an approved acceptance coexist without either being a lie.

**Explicitly out of scope:** UBI base-image OS packages, npm dependencies, and any
code in this repository. Those remain this project's obligation. A regression test
(`vendorInheritedRisk.test.mjs`) re-derives every attribution from the path and fails
the run if a UBI or application finding is ever attributed to the vendor.

### Certification axes closed in this wave

Four axes were registered by Tranche 8A as placeholders hard-coded to INCOMPLETE —
`lifecycle`, `compatibility`, `connectivity`, `artifacts`. All four are now real:

| axis | verdict | what changed |
|---|---|---|
| `lifecycle` | **PASS** | Executes real resource probes: temp dirs, file descriptors, SQLite handles and staging across repeated AND failed exports, plus child-process and shutdown-timer checks. Counts must return to a post-warm-up baseline. |
| `connectivity` | INCOMPLETE | Runs the profile suite twice, the second time inside `unshare -rn` — a network namespace with loopback only, so egress is denied at the network layer, not by an environment variable. The core offline workflow attempts **zero** egress. Still INCOMPLETE: proxy, CA-interception and restricted-DNS profiles need infrastructure this harness does not provision (PROD-043). |
| `compatibility` | INCOMPLETE | Records a cell as verified only when the run actually executed on it. 1 of 6 (Fedora/x86_64). Keeps development-host compatibility separate from target-cluster architecture support. |
| `artifacts` | FAIL | Defines the release unit, hashes it reproducibly, emits a coreutils-verifiable `SHA256SUMS`, and checks version-identity coherence. Fails on mutable `:latest` image references, which cannot identify a release artifact (PROD-030/PROD-042). |

Evidence manifests also no longer embed absolute host paths; a bundle copied to
another machine now produces an identical `manifestDigest`, which is what makes
off-host verification possible at all.

The run above is still **not final evidence**: it is bound to a dirty working tree,
so it is not bound to any committed state. It must be regenerated against the final
accepted commit.

Builder-host advisories are tracked separately from shipped ones, under **DOC-207**.

---

## What does not exist

Stated plainly, because absence is the part most easily misread:

- **No image signatures.** Cosign is checked for by the harness and recorded as absent.
  There are no signatures, no attestations and no signing workflow.
- **No `SHA256SUMS` file** for this project's own images or release artifacts.
- **No published SBOM** in any format, at any URL.
- **No SPDX output.** The generated documents are CycloneDX; SPDX is listed as the
  intended primary format in the axis contract but is not produced today.
- **No release bundle.** The `artifacts` axis is `INCOMPLETE` because no release bundle
  format is defined yet, so there is no artifact whose lifecycle could be certified.

### GitHub's dependency graph is not this

GitHub's native dependency graph, Dependabot alerts and the "Dependencies" tab read the
repository's manifests and lockfiles. They describe **source dependencies declared in
this repo**. They do not inventory the shipped container images, they do not see the
UBI base-image RPMs, and they do not see `oc`, `oc-mirror`, `openshift-install` or
`mirror-registry` at all.

Treating that graph as an SBOM for the shipped product would understate the component
set by the large majority of it — the backend image alone resolves to roughly 641
components against 196 backend npm entries. Do not substitute one for the other.

---

## Where to look once something is published

When a GA release exists, this section becomes links. Until then it is a checklist of
what will be attached and where, so the location is predictable:

- **GitHub Release assets** for the tagged release, under
  `https://github.com/bstrauss84/openshift-airgap-architect/releases`
- Per-image CycloneDX SBOMs, one per shipped image
- The external-binaries companion document
- The offline component inventory
- A `SHA256SUMS` file covering every attached asset
- A vulnerability summary **with dispositions**, not a raw findings dump
- Signed provenance — **only** where signing has actually been performed and verified

Nothing in that list may be linked from here speculatively. A link appears when the
asset exists and has been verified, not when it is planned.

---

## Release gate

The following must all be true before this page can claim anything is available:

1. A candidate-bound scan against the **final accepted commit**, not a predecessor.
2. A triaged vulnerability disposition for every critical and high finding.
3. An SBOM axis that passes against the final candidate, with subject binding verified.
4. Checksum verification closed for `openshift-install` and `mirror-registry`.
5. A defined release bundle format (`artifacts` axis no longer `INCOMPLETE`).
6. A decision, and then an implementation, for artifact signing.
7. An actual GitHub Release to attach the assets to.

Until then the honest status is the one at the top of this page: **not published yet.**

---

**See also:** [v2.1.0 release notes](../releases/v2.1.0.md) ·
[Backlog and status registry](../BACKLOG_STATUS.md) ·
[Release-history evidence](../releases/evidence/README.md)
