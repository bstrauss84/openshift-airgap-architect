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

### Known gap in that third document

`oc` and `oc-mirror` are checksum-verified against the Red Hat mirror's own
`sha256sum.txt` at build time, and their installed digests are recorded.
`openshift-install` and `mirror-registry` are **not**: the current integrity check on
those two is a non-zero file size. This is recorded in the generated document's own
`verificationGaps` field and is not resolved.

---

## Vulnerability scanning

Image scanning runs and produces real findings — this is not scaffolding. It is also
**not a clean result, and not a completed risk disposition.**

The most recent full certification run records:

| image | critical | high | medium | low |
|---|---|---|---|---|
| backend | 1 | 86 | 338 | 153 |
| frontend | 0 | 22 | 490 | 400 |

The `image-vulnerabilities` axis verdict for that run is **FAIL**, and the overall
release verdict is **RED**.

Two further qualifications matter more than the numbers:

- **The scan is bound to a stale candidate.** It ran against commit `f860d7db4457`,
  which is six commits behind the current head — and two of those six are security
  fixes. The scan therefore does not describe the tree a release would ship.
- **No disposition exists.** Nothing here has been triaged into
  accepted/false-positive/will-not-fix. A findings count is not a risk assessment.

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
