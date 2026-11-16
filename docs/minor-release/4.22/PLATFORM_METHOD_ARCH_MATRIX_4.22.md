# OCP 4.22 Platform × Install Method × Architecture Matrix

> **Tranche 1 deliverable 4 of 10.** Research output. **Not implemented.** `BlueprintStep.jsx`
> `PLATFORM_ARCH_SUPPORT` is unchanged by this tranche.
> Machine-readable: [`platform-method-arch-4.22.json`](platform-method-arch-4.22.json).

Addresses backlog item **DOC-156** (revalidate the Target Platform × Installation Method ×
CPU Architecture matrix at each minor onboarding) and plan decision **D3**. DOC-156 is
`active`/`p2` in `docs/BACKLOG_STATUS.md` and explicitly scheduled for *"the next
minor-release onboarding effort, immediately before/within OCP 4.22 onboarding"* — this is
that research, not its implementation.

---

## 1. Three architectures, kept separate (prompt requirement)

| Kind | What it means | Where it lives today |
|---|---|---|
| **Target cluster architecture** | the arch RHCOS runs on across control plane and compute | `BlueprintStep.jsx` `archOptions`; emitted into install-config and the mirror payload |
| **Local / export binary architecture** | the arch of `openshift-install`, `oc`, `oc-mirror` the operator downloads | `ReviewStep.jsx` download selector; `ocMirrorRuntime.js` |
| **Runtime / container architecture** | the arch Architect itself runs on | `backend/Containerfile` |

These are independent. The matrix below is **target cluster architecture** unless a row
says otherwise.

Conflating them is an **analysis** error, and this document made it: an earlier revision
of §4 read the cluster-node FIPS validation statement as though it restricted the
**export/download binary** axis, and on that basis called `ReviewStep.jsx`'s
*"Linux ARM64 (RHEL 9 FIPS)"* download option a defect. It is not a defect — Red Hat
publishes `openshift-install-rhel9-arm64.tar.gz`, and the option is correct for the axis
it belongs to. See the corrected §4.

## 2. Current product state (unchanged, for comparison)

`frontend/src/steps/BlueprintStep.jsx`, comment `/** OCP 4.20 supported architectures per platform … */`:

| Platform | x86_64 | aarch64 | ppc64le | s390x |
|---|---|---|---|---|
| Bare Metal | ✓ | ✓ | ✓ | ✓ |
| VMware vSphere | ✓ | ✓ | | |
| Nutanix | ✓ | | | |
| AWS GovCloud | ✓ | ✓ | | |
| Azure Government | ✓ | | | |
| IBM Cloud | ✓ | | | |

Structural defects, unchanged and re-confirmed this tranche: keyed by **platform only**, so
install method cannot vary; an unknown platform allows **all four**; the arch silently
resets to `x86_64` on platform change; and the tooltip `Not supported on ${platform}` is
structurally incapable of citing an OpenShift-version reason.

## 3. OCP 4.22 documented evidence

From **Table 2.1 Installer-provisioned infrastructure options**, OCP 4.22
*Installation overview → Selecting a cluster installation method and preparing it for users*
(retrieved 2026-10-07):

| Platform as listed | IPI documented |
|---|---|
| AWS (64-bit x86) | ✓ |
| AWS (64-bit ARM) | ✓ |
| Azure (64-bit x86) | ✓ |
| Azure (64-bit ARM) | ✓ |
| Azure Stack Hub | ✓ |
| GCP (64-bit x86) | ✓ |
| GCP (64-bit ARM) | ✓ |
| Nutanix | ✓ |
| RHOSP | ✓ (custom only) |
| **Bare metal (64-bit x86)** | ✓ |
| **Bare metal (64-bit ARM)** | ✓ |
| vSphere | ✓ |
| IBM Cloud | ✓ |
| IBM Z | no IPI checkmark |
| IBM Power | no IPI checkmark |
| IBM Power Virtual Server | no IPI checkmark |

Note what this table does **and does not** say. It splits AWS, Azure, GCP and bare metal
by architecture, and it does **not** split vSphere, Nutanix or IBM Cloud. Absence of an
arch split is not a statement that only x86_64 is supported — it is simply no evidence
either way at this source.

## 4. FIPS — resolves plan decision O6

Verbatim, OCP 4.22 *Installation overview*, **Support for FIPS cryptography**:

> "When running Red Hat Enterprise Linux (RHEL) or Red Hat Enterprise Linux CoreOS (RHCOS)
> booted in FIPS mode, OpenShift Container Platform core components use the RHEL
> cryptographic libraries that have been submitted to NIST for FIPS 140-2/140-3 Validation
> on only the x86_64, ppc64le, and s390x architectures."

**aarch64 / arm64 is not FIPS-validated for CLUSTER NODES at 4.22.** That is the
target-cluster architecture axis (§1), and it belongs in the matrix below.

> ### ⚠ Correction (Tranche 1.5 final review) — this is NOT an export-binary restriction
>
> An earlier revision of this section read the sentence above as proving that
> `ReviewStep.jsx`'s *"Linux ARM64 (RHEL 9 FIPS)"* **download option** was a defect. That
> was an axis-conflation error: the quoted statement concerns RHEL/RHCOS **cluster
> nodes**, not which client binaries Red Hat publishes.
>
> Checked against the official per-architecture client inventories (each release's own
> `sha256sum.txt`), 2026-10-07:
>
> | Artifact | 4.20.40 | 4.21.35 | 4.22.16 |
> |---|---|---|---|
> | `openshift-install-rhel9-amd64.tar.gz` | ✅ | ✅ | ✅ |
> | `openshift-install-rhel9-arm64.tar.gz` | ✅ | ✅ | ✅ |
> | `openshift-install-rhel9-ppc64le.tar.gz` | ✅ | ✅ | ✅ |
> | `openshift-install-rhel9-s390x.tar.gz` | ✅ | ✅ | ✅ |
>
> The arm64 artifact was downloaded (437 MB, HTTP 200), **SHA256-verified against the
> mirror's own checksum file**, and extracts to
> `ELF 64-bit LSB executable, ARM aarch64` named `openshift-install-fips`.
>
> **Red Hat ships a FIPS `openshift-install` for ARM64.** The UI option is correct and
> the removal was reverted. There is **no O6 export-binary defect**; the O6 concern
> reduces to the cluster-node statement, which is recorded in the matrix below where it
> belongs. Regression coverage: `frontend/tests/fips-installer-architectures.test.jsx`.
>
> Standing rule: do not infer export/download tool-binary availability from
> cluster-node support text. The three axes in §1 are independent.

## 5. Proposed matrix, in the D3 shape

Cells are `state / reason`. `OPEN` means **no 4.22 evidence was found**, and is recorded as
such rather than being filled in from 4.20-era data — that is the whole point of DOC-156.

| Platform | Method | x86_64 | aarch64 | ppc64le | s390x |
|---|---|---|---|---|---|
| Bare Metal | IPI | supported | **supported** (Table 2.1) | OPEN | OPEN |
| Bare Metal | UPI | supported | OPEN | OPEN | OPEN |
| Bare Metal | Agent | supported | OPEN | OPEN | OPEN |
| VMware vSphere | IPI | supported | OPEN | hidden / platform | hidden / platform |
| VMware vSphere | UPI | supported | OPEN | hidden / platform | hidden / platform |
| VMware vSphere | Agent | supported | OPEN | hidden / platform | hidden / platform |
| Nutanix | IPI | supported | OPEN | hidden / platform | hidden / platform |
| AWS GovCloud | IPI | supported | OPEN (commercial AWS ARM is documented; GovCloud is not addressed) | hidden / platform | hidden / platform |
| AWS GovCloud | UPI | supported | OPEN | hidden / platform | hidden / platform |
| Azure Government | IPI | supported | OPEN (commercial Azure ARM is documented; Azure Government is not addressed) | hidden / platform | hidden / platform |
| Azure Government | UPI | supported | OPEN | hidden / platform | hidden / platform |
| IBM Cloud | IPI | supported | OPEN | hidden / platform | hidden / platform |

**The honest headline: the current product table asserts more than the 4.22 evidence
gathered here supports.** It claims bare-metal `ppc64le`/`s390x`, vSphere `aarch64`,
AWS GovCloud `aarch64`. Only bare-metal `aarch64` was positively confirmed for 4.22. Those
claims may well be correct — they came from a 4.20-era scan — but they are not confirmed
against 4.22, and Tranche 2 must close each `OPEN` from the per-platform 4.22 books (plan
source **S8**) before the matrix is authored as data.

### Install-method dependence (justifies D3)

Agent-based installer architecture support depends on whether the release image is
multi-payload or single-arch — a property of the **method**, not the platform. A
platform-keyed table cannot express that. This is the structural reason D3 replaces the
current shape, independent of which cells turn out to be true.

## 6. Heterogeneous compute — preserves plan boundary O8

OCP 4.22 release notes, Multi-Architecture section:

> "you can add ARM nodes to bare metal clusters with x86 control planes using PXE or
> virtual media"
> "expand your cluster by creating a `BareMetalHost` object with the `aarch64` architecture"

**The accepted product boundary is preserved: Architect v2.1 still models one target
cluster architecture.** Host Inventory is not redesigned in this tranche, and no mixed-arch
modelling is proposed.

This creates a real obligation on the matrix above, which the prompt calls out explicitly:
**the homogeneous matrix must not imply mixed-arch support.** Two consequences for Tranche 2:

1. The arch-support data needs an explicit `homogeneousOnly: true` marker with this
   citation, so a future reader does not read a per-platform arch list as permission to mix.
2. Field Guide / help text for bare metal should state that 4.22 supports ARM compute on
   x86 control planes **and that Architect does not model it**, rather than staying silent.
   Silence reads as "not possible", which is now wrong.

## 7. Other 4.22 topology changes affecting the Blueprint

| Finding | Evidence | Relevance |
|---|---|---|
| Two-node OpenShift **with fencing** moved Technology Preview (4.20, 4.21) → **GA (4.22)** | release notes Edge computing TP table §1.9.3 | Architect's topology model; new book `installing_a_two_node_openshift_cluster` |
| **Local arbiter node** GA across 4.20, 4.21, 4.22 | same table | corroborates the installer-side removal of the `HighlyAvailableArbiter` gate at 4.22 (delta ledger §6) |

Both are **recorded, not actioned**. Whether Architect should expose two-node-with-fencing
at 4.22 is a product decision, not an onboarding task (runbook Rule 7 item 4).

## 8. Open items for Tranche 2

1. Close every `OPEN` cell from the per-platform 4.22 install books (**S8**).
2. ~~Decide the O6 FIPS/ARM64 remediation~~ — **closed.** No export-binary defect
   exists; see §4. The cluster-node FIPS architecture limit is matrix data, below.
3. Author `data/arch-support/<minor>.json` for **all three** minors in the D3 shape with
   per-cell provenance, per plan Tranche 2.
4. Resolve whether `multi` (the oc-mirror payload value) belongs in the target-cluster arch
   model at all — it is a mirror-payload concept, and conflating it with target arch would
   repeat the category error in §1.
