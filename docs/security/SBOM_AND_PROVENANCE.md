# SBOM, vulnerability evidence and provenance

## Where the published evidence is

Release evidence is attached to the **GitHub Release for the matching tag**:

> **https://github.com/bstrauss84/openshift-airgap-architect/releases**

If a release for your version is listed there, it carries the files below. If it is not
listed, that evidence has not been published for that version — this page describes
what is generated and how it is verified either way, rather than asserting a
publication state that changes the moment a release is cut.

| asset | what it is |
|---|---|
| `oaa-<version>-sbom-backend.cyclonedx.json` | CycloneDX SBOM walked from the shipped backend image |
| `oaa-<version>-sbom-frontend.cyclonedx.json` | CycloneDX SBOM walked from the shipped frontend image |
| `oaa-<version>-offline-inventory.cdx.json` | Deterministic CycloneDX inventory from lockfiles + rpmdb |
| `oaa-<version>-external-binaries.json` | `oc`, `oc-mirror`, `openshift-install`, `mirror-registry` — version, digest, source URL, verification posture |
| `oaa-<version>-vulnerabilities-backend.json` | Complete raw scanner output, nothing filtered |
| `oaa-<version>-vulnerabilities-frontend.json` | Complete raw scanner output, nothing filtered |
| `oaa-<version>-vendor-risk-disposition.json` | Per-artifact record of accepted inherited vendor risk |
| `oaa-<version>-certification-summary.json` | All fifteen axis verdicts, including the failing ones |
| `openshift-airgap-architect-<version>-source.tar.gz` | Source snapshot taken from the tag |
| `SHA256SUMS` | Covers every asset above |

**Verify before trusting:**

```bash
sha256sum -c SHA256SUMS
```

**Read the raw findings, not just this page.** The vulnerability assets are the
complete scanner output. A count on this page is a dated snapshot of an image *and* a
database; the asset is the evidence.

This page describes what the project generates, what it deliberately does **not**
generate, and how each claim here can be checked against those files.

Tracked under **PROD-023** (SBOM generation for application images and packaged
external binaries, status `active`) and the **PROD-041** productization umbrella.

---

## How the evidence is produced

| | |
|---|---|
| Generator code | `scripts/release/axes/sbom.mjs`, `scripts/release/provenance/sbomGenerate.mjs` — tracked in git |
| Generated output | written under `release-certification/runs/<run-id>/` |
| Is the output in git? | **No.** `.gitignore` excludes `release-certification/` entirely — `git ls-files release-certification/` returns nothing |
| How it reaches you | copied verbatim onto the GitHub Release for the tag, under the names in the table above |

The evidence is regenerated per run by design, and is **bound to a candidate id** that
covers HEAD plus any uncommitted delta. Committing the output would dirty the working
tree on every run, changing that candidate id and invalidating the evidence just
produced — so a run against a dirty tree is marked dirty and is not release evidence.

Reproduce any of it locally:

```bash
node scripts/release/buildImages.mjs --no-cache   # build, emit the binding manifest
npm run release:certify                           # all fifteen axes
```

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

A full run on **2026-10-20** against the clean candidate
`bb9ace887169f7ee380a9858a2a65a44e788a260`, with a digest-pinned Trivy
(`docker.io/aquasec/trivy@sha256:af6acf9a…`, 0.75.0) and a vulnerability database
built `2026-10-20T01:16:59Z`, records:

| image | critical | high | medium | low | unknown |
|---|---|---|---|---|---|
| backend | 1 | 110 | 357 | 156 | 2 |
| frontend | 0 | 48 | 499 | 416 | 0 |

The `image-vulnerabilities` axis verdict is **FAIL** and the overall release verdict
is **RED**. Both are reported as they stand; neither is waived.

**A scan figure is perishable.** It describes an image *and* a database on a date, and
these counts are higher than earlier published figures (backend 1/96, frontend 0/30 on
2026-10-16) purely because the database moved. Nothing regressed in this project's own
code. The attached raw scanner assets, not this table, are the evidence.

### Who can fix each finding

This is the part that determines what can be done about them.

| source | backend C+H | frontend C+H | fix published? |
|---|---:|---:|---|
| UBI base-image RPMs — **this project's obligation** | 55 | 48 | **none of the 103** |
| `usr/local/bin/oc-mirror` (Red Hat binary, shipped verbatim) | 35 (incl. the 1 CRITICAL) | 0 | 33 of 35 upstream |
| `usr/local/bin/oc` (Red Hat binary, shipped verbatim) | 21 | 0 | 19 of 21 upstream |

**All 103 project-owned critical/high findings have no fixed package available.**
Trivy reports no `FixedVersion` for any of them, so Red Hat has published no fixed
RPM and rebuilding on a newer base would not clear them. Both images are built from
the floating `ubi9/nodejs-22-minimal` and `ubi9/nginx-124:latest` tags, so they
already carry the newest base Red Hat publishes. The clusters are the `nodejs`/`npm`
family (10 each) on the backend and the `python3` and util-linux families on the
frontend; **none implicates nginx or Node's own runtime behaviour.**

**"Fix published upstream" is not "fix available to this project."** Those 52 vendor
entries mean a patched *Go module* exists, not that Red Hat has shipped a rebuilt
binary containing it. Verified against the live mirror on 2026-10-20: `oc` and
`oc-mirror` in the shipping image are both **4.22.18**, and 4.22.18 is the newest
version the `clients/ocp/latest-4.22` and `clients/ocp/latest` channels publish.
There is no newer artifact to adopt. The single CRITICAL — **CVE-2026-33186**,
`google.golang.org/grpc`, fixed upstream in 1.79.3 — is inside `oc-mirror`.

Two consequences follow, and they should not be softened:

- **This axis cannot be driven green by engineering work in this repository.** The
  remaining routes are a newer UBI base (which today contains no fixes for these),
  newer Red Hat client binaries (none exist), removing base packages not needed at
  runtime (the backend already does this for `nodejs-nodemon`), or an explicit,
  human-authored risk disposition.
- **A disposition exists for the vendor share only**, and it is emitted into the
  evidence as `vendor-risk-disposition.json`. The project-owned share is covered by
  the no-fix classification above, which is a statement about remediability, not an
  assertion that the findings are harmless. A findings count is not a risk
  assessment.

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
  There are no signatures, no attestations and no signing workflow. The `SHA256SUMS`
  attached to a release proves integrity, not authorship.
- **No SPDX output.** The generated documents are CycloneDX; SPDX is listed as the
  intended primary format in the axis contract but is not produced today.
- **No published container images.** This is a source and Compose release: you build
  the images locally. Nothing is pushed to a registry, so there is no remote image
  digest to pin or verify, and the `localhost/…` references in `docker-compose.yml`
  and `manifests/base/` name the images your own build produces. The `artifacts` axis
  **FAILs** on those mutable references for exactly that reason, and the failure is
  reported rather than waived away — closing it means publishing images, which is
  tracked under PROD-040/PROD-030/PROD-042 and is deliberately outside this release.
- **No attestation that a published asset came from a particular build host.** The
  evidence binds to a *source commit* and an *image config digest*, not to a builder
  identity.

### GitHub's dependency graph is not this

GitHub's native dependency graph, Dependabot alerts and the "Dependencies" tab read the
repository's manifests and lockfiles. They describe **source dependencies declared in
this repo**. They do not inventory the shipped container images, they do not see the
UBI base-image RPMs, and they do not see `oc`, `oc-mirror`, `openshift-install` or
`mirror-registry` at all.

Treating that graph as an SBOM for the shipped product would understate the component
set by the large majority of it — the backend image alone resolves to 711
components, against a couple of hundred backend npm entries. Do not substitute one for the other.

---

## Release gate — what must be true for a version's evidence to be published

These are checked by the publication tooling, not asserted here:

1. A candidate-bound scan against the **exact released commit**, from a clean tree —
   not a predecessor, and not a dirty candidate.
2. SBOMs that pass subject binding against the images actually built from that commit.
3. A recorded disposition for the vendor share, naming each artifact by version,
   architecture, SHA256 and source URL.
4. A fix-availability classification for the project-owned share, dated.
5. Checksum verification closed for every externally fetched binary.
6. Every asset present, non-empty, well-formed, and covered by `SHA256SUMS`.
7. The release's own raw verdict carried in the evidence, failing axes included.

**What is deliberately NOT on that list:** a green certification verdict. The
`image-vulnerabilities` axis is non-waivable and fails while unfixable base-image
findings exist, so a release can ship with a RED verdict **only** as a recorded owner
decision, published alongside the evidence that says so. A GREEN verdict is never
manufactured by editing this page, the scanner inputs, or the gate.

### What is still not done

- **Signing.** No cosign signature, attestation or signing workflow exists. Tracked
  under the PROD-041 productization umbrella.
- **SPDX.** CycloneDX only.
- **Published images.** Source and Compose only; see "What does not exist".
