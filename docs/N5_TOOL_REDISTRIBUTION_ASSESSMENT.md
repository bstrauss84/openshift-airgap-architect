# N5 — oc / oc-mirror redistribution and third-party notices (v2.3.0 assessment)

Status: **assessment input for an owner (and, as needed, legal) decision. Not
legal advice. No new redistribution is enabled.** Owner direction R4
(2026-11-06): continue the assessment and the reusable packaging work; do not
newly enable binary redistribution in Mirroring or Upgrade without approval;
keep Install's existing behaviour; ship the acquire-on-destination fallback.

## 1. Distribution cases (kept distinct)

| Case | Binaries distributed? | By whom |
|---|---|---|
| Public OAA GitHub Release (source tarball, SBOMs, evidence) | No | OAA project |
| OAA container images built by a user (`backend/Containerfile`) | Yes: `oc`, `oc-mirror` in `/usr/local/bin` | the user, when they redistribute their image |
| Install bundle `tools/` (optional, user-generated) | Yes: `oc`, `oc-mirror` | the user who generates and shares the bundle |
| Mirroring transfer companions (`feat/v2.2.2-transfer-companions`, deferred) | Would be | the user |
| Upgrade plan package (v2.3.0) | **No** — `tools/ACQUIRE_TOOLS.md` only | — |

## 2. The binaries examined (this workstation, 2026-11-06)

- `oc-mirror` 4.22.0-202609221258.p2.g5b31abd (SHA-256 `4d0d4f91b867…48e1`),
  built with `CGO_ENABLED=1`, tags include `containers_image_openpgp` and
  `strictfipsruntime`. **209** Go module dependencies (from `go version -m`,
  which reads build metadata without executing the binary). Dynamic
  dependencies (`readelf -d`): libresolv, libpthread, libdl, libc only.
- `oc` 4.21.35: **196** module dependencies; dynamic: libresolv, libc.
- Evidence: `/var/tmp/oaa-v230-evidence/license-inputs/*-buildinfo.txt`.

## 3. Findings

1. **Top-level licenses:** openshift/oc and openshift/oc-mirror are Apache-2.0
   (GitHub license API). The downloaded `oc-mirror.tar.gz` contains only the
   binary — no LICENSE or NOTICE. `openshift-client-linux.tar.gz` contains
   `README.md` (states Apache 2.0), `oc` and `kubectl`, no LICENSE file.
2. **MPL-2.0 modules present** (module paths in build info; license confirmed
   upstream for these projects, to be re-confirmed from the exact vendored
   source): oc-mirror — `hashicorp/errwrap v1.1.0`, `hashicorp/go-multierror
   v1.1.1`, `hashicorp/golang-lru/v2 v2.0.7` (incl. `arc/v2`); oc —
   `hashicorp/golang-lru v1.0.2`. MPL-2.0 §3.2: executable distribution must
   make the MPL-covered source available and tell recipients how to obtain it.
3. **BSD/MIT/Apache modules**: the remainder (to be enumerated from the
   matching `openshift-client-src-<version>` tarball's vendored
   LICENSE/COPYING files, which the v2.2.1 research counted at 224 for oc).
   They require keeping copyright and license notices.
4. **libgpgme (LGPL)**: oc-mirror contains `github.com/proglottis/gpgme` cgo
   symbols and the string `libgpgme.so.11`, but neither `libgpgme` nor
   `libgpg-error`/`libassuan` internals are linked (`readelf` NEEDED has no
   gpgme; no `gpg_err_*`/`assuan_*` symbols). **Inference:** libgpgme is loaded
   at run time with `dlopen` when present, not embedded. If confirmed, the
   binary carries no LGPL code; redistributing libgpgme itself is a separate
   question that OAA does not raise (the images do not ship it for this).
5. **Go build metadata is not compliance evidence.** It lists module paths and
   versions; it does not carry license texts, NOTICE files or proof of which
   files are compiled in. The notice set must come from the exact source.

## 4. Proposed compliant implementation (for approval)

One shared packaging service for Install, Mirroring and Upgrade (the v2.2.2
companion code is the starting point, not merged as-is):

1. Resolve the exact tool build (versioned directory, never `latest`), verify
   against that directory's `sha256sum.txt` (existing `acquireVerifiedTool`).
2. Fetch the matching `openshift-client-src-<version>.tar.gz` (and the oc-mirror
   source at the recorded git commit), extract every vendored LICENSE, COPYING
   and NOTICE for the modules in that binary's build info, and write
   `THIRD_PARTY_NOTICES/` (one file per module + an index) beside the tool,
   plus the Apache-2.0 text and any upstream NOTICE.
3. Write a source offer: the exact source tarball URL and SHA-256 (satisfies
   MPL-2.0 §3.2 "how to obtain"), recorded in `TOOLS_PROVENANCE.json`.
4. Fail closed if any module lacks a license text in the source.
5. Apply the same to Install's existing `tools/` so all three workflows match.

## 5. What is needed before enabling

- Owner (and legal, as needed) approval of §4 and of the distribution cases in
  §1 (in particular user-built images and user-generated bundles).
- Confirmation of finding 4 (dlopen) on the exact shipped image binary.
- Confirmation that no Red Hat subscription or download terms add conditions
  for these client binaries (none were found on mirror.openshift.com).

Until then: Mirroring and Upgrade provide acquisition guidance only; Install's
behaviour is unchanged and its notice gap remains recorded under N5.
