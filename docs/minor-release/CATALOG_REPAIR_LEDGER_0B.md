# Tranche 0B — Catalog Authority Repair Ledger

**Phase:** 0B complete. All provenance findings repaired, H3 closed by deterministic
same-minor authority, CI enforcing the strict provenance guard. 4.22 acquisition has
**not** begun.
**Machine-readable companion:** [`catalog-repair-ledger-0b.json`](catalog-repair-ledger-0b.json)
**Generator:** `scripts/minor/inventory/catalog-debt-inventory.js` (parameterized by `--minor`, no network)
**Baseline measured at commit:** `201fa7c` (before any canonical row was edited)
**Repair engine:** `scripts/minor/repair/apply-catalog-repairs.js`, rules in `scripts/minor/repair/proven-repairs.js`
**Consistency:** `scripts/minor/inventory/repair-ledger-consistency.test.js` holds this file and the JSON to each other
**Status authority:** `docs/BACKLOG_STATUS.md` remains the single source of truth for status claims.

Scope rule for every row below: **a 4.20 row is proven only by 4.20 evidence, a 4.21
row only by 4.21 evidence.** No value in this ledger was carried across minors.

---

## 1. Evidence base

Both minors have complete, provenance-recorded local evidence. Nothing in this
ledger rests on a single source.

| Minor | Documentation | Installer source (exact release) | Docs index |
|---|---|---|---|
| 4.20 | 12 extracted books, `local-docs/ocp-4.20/docs/extracted/` | **4.20.40**, installer commit `0c11c37e83ad8b8a328ffe0d0888ef70ed5bab56` | `data/docs-index/4.20.json` |
| 4.21 | 12 extracted books, `local-docs/ocp-4.21/docs/extracted/` | **4.21.35**, installer commit `006669f5812a47dbc733b6736584b87ef696e898` | `data/docs-index/4.21.json` |

Mechanical authority is the **exact official released artifact**, not a release
branch tip — see §12 and runbook Rule 2.1.

`local-docs/` is read **read-only** from the canonical worktree
`/home/bistraus/code/openshift-airgap-architect/` and is not modified.

**Live documentation is reachable from this environment.** `local-docs/ocp-4.21/analysis/SLICE-5F2-URL-VALIDATION-RESULTS.md`
recorded (2026-06-30) that every automated request to `docs.redhat.com` returned
HTTP 403. That is no longer the case here, so each structural conclusion below
was confirmed **twice** — once against the extracted text, once against the live
page — per the execution contract's "verify external behaviour twice" rule.

---

## 2. Baseline, reconciled against the accepted 0A-1 figures

Every accepted 0A-1 figure reproduces exactly from the current tree:

| Accepted fact | Measured now | |
|---|---|---|
| `validate-catalog data/params/4.20` | 296 errors | ✅ |
| `validate-catalog data/params/4.21` | 445 errors | ✅ |
| total catalog data debt | 741 | ✅ |
| `check:citation-minor` 4.20 wrong-minor | 0 | ✅ |
| `check:citation-minor` 4.21 wrong-minor | 810 | ✅ |
| `validate-param-authority` | 0 mechanism / 1 data failure | ✅ |

The 741 decomposes cleanly:

| | 4.20 | 4.21 |
|---|---|---|
| missing required parameter fields | 140 | 157 |
| malformed citation objects (×2 messages each) | 156 (78 objects) | 288 (144 objects) |
| **total validator errors** | **296** | **445** |

---

## 3. What the inventory found beyond the accepted baseline

The accepted baseline measures what the **current gates** detect. The inventory
measures what is **actually wrong**. Three classes sit outside the gates.

### 3.1 Cross-minor citations invisible to the citation guard — 129

`scripts/validate-catalog-citation-minor.js` judges a URL only when it carries
the `openshift_container_platform/<minor>` segment. That scoping is deliberate
and correct as far as it goes, but three other ways a citation carries a minor
do not match it:

| Signal | Occurrences in `data/params/4.21/**` | Seen by guard |
|---|---|---|
| `docs.redhat.com/.../openshift_container_platform/4.20/...` | 810 | ✅ |
| `docs.openshift.com/container-platform/4.20/...` (retired host) | 20 | ❌ |
| `github.com/openshift/installer/blob/release-4.20/...` | 109 | ❌ |
| `docTitle: "OpenShift Installer 4.20 Source Code"` *(same 109 objects, plus 1)* | 110 | ❌ |

**Distinct 4.21 citation objects carrying 4.20 evidence: 939** — 810 visible to
the guard, **129 invisible**. `data/params/4.20/**` is clean on all four signals (0).

Repairing only the 810 would turn `check:citation-minor:strict` green while 129
cross-minor citations remained in 4.21 — precisely the "silent permissive path"
the tranche forbids.

### 3.2 Section headings that do not exist in their own minor's documentation

Checked only for citations that actually point at a Red Hat documentation page
(installer-source and NMState citations legitimately carry non-documentation
headings and are excluded).

A first pass searched **every** extracted book and reported 568 rows. Two
systematic false-positive classes were found in the checker itself and fixed
before any row was treated as debt:

| Checker defect | Phantom rows | Fix |
|---|---|---|
| A heading was searched across all books, so a citation whose book is absent from the local evidence set (`installing_on_any_platform`, `installing_on_aws_govcloud`, `edge_computing`, …) matched a same-titled heading elsewhere and was reported as renumbered. | 347 | Judge only against the book the URL addresses; absence of evidence reports `unknown`, never a defect. |
| Only numbered *sections* were recognised, so numbered **table captions** — `Table 5.3. ImageSetConfiguration parameters`, which is exactly what a parameter citation sends a reader to — were reported missing. | 43 | Recognise `Table N.N.` captions as valid cited headings. |

A third correction made real debt **visible**: the 4.20 vSphere book was
acquired as `Installing_on_vSphere` while the page has always been served from
`installing_on_vmware_vsphere`, so 4.20's vSphere citations resolved to no book
and their defects went unreported — the identical defect was visible at 4.21 and
invisible at 4.20. A single documented slug alias closes it (+39 rows at 4.20).

Both corrections are covered by fixture tests in
`scripts/minor/inventory/catalog-debt-inventory.test.js`.

**Real remainder after correction:**

| | 4.20 | 4.21 |
|---|---|---|
| heading title present, **section number differs** | 4 | 33 |
| heading **absent** from the cited book of that minor | 90 | 90 |
| **total** | **94** | **123** |

The single largest instance is `"9.1.4. VMware vSphere cluster parameters"`,
cited 51 times in **each** minor. That heading exists in neither 4.20 nor 4.21:
section 9.1.4 of the vSphere book is *"Additional VMware vSphere configuration
parameters"* in both — confirmed against the extracted text **and** the live
4.20 and 4.21 pages. A pre-existing content defect at 4.20, not drift introduced
at 4.21, and no current gate detects it.

### 3.2.1 A/B/C/D triage of every heading row

| Class | Meaning | 4.20 | 4.21 | Disposition |
|---|---|---|---|---|
| **A** | true same-minor documentation drift; authoritative same-minor replacement proven | 76 | 105 | repair (§6) |
| **B** | legitimate non-documentation provenance (installer source, NMState) or a checker false positive | 390 phantom rows withdrawn | | checker corrected + fixture-tested; **no catalog change** |
| **C** | internal / pseudo-citation | 30 | 30 | §3.2.2 |
| **D** | unresolved from same-minor authority | 18 | 18 | H3 (§8.1) |

Class C rows do not appear in the heading totals: their URL is the bare product
root, which addresses no book, so the corrected checker reports them `unknown`
rather than as heading debt. They are counted and dispositioned separately.

The class-D set is **identical at both minors** — the same eight headings, same
counts — which is itself evidence that it is pre-existing shared debt rather
than anything introduced at 4.21:

| Rows (each minor) | Heading | Why unresolved |
|---|---|---|
| 4 | `1.11.2. Configuring the cluster-wide proxy during installation` | Heading is real and correct, but the citation pairs it with the **IBM Cloud** book, where the proxy section is `5.6.4`/`6.7.4`/`7.9.4`/`8.7.1`. Which page the row should cite is a content decision. |
| 3 | `Mirroring and image sources (shared)` | Not a heading in any book at either minor; `imageDigestSources` appears in **no** extracted book of either minor. |
| 3 | `vSphere install-config parameters` | Not a heading in the vSphere book at either minor; the cited page is the IPI chapter, not the parameter reference. |
| 2 | `vSphere UPI install-config parameters` | As above, for the UPI chapter. |
| 2 | `Bare metal API and Ingress VIPs` | Not a heading in the bare-metal book at either minor. |
| 2 | `17.3.3. Reference specifications for the image-based-installation-config.yaml manifest` | A real heading, but in the **edge-computing** book; the citation pairs it with the IBM Cloud book. |
| 1 | `Bare metal hosts` | Not a heading in the bare-metal book at either minor. |
| 1 | `Provisioning network` | Not a heading in the bare-metal book at either minor. |

### 3.2.2 Internal pseudo-citations (class C)

30 parameters per minor carry `docId: missing-parameter-analysis`,
`docTitle: "DOC-082 Missing Parameter Analysis"`, a sectionHeading such as
`"OCP 4.20 Installing on Azure docs, BYO VNet section"`, and the bare
`.../openshift_container_platform/4.20/` product root as the URL. They are
internal analysis notes, not documentation citations.

**All 30 have no other citation**, so they cannot simply be removed: the
validator requires a non-empty `citations` array. Each therefore needs a real
same-minor citation derived from the parameter itself — resolved in §5.1.

The 24 `delta_analysis` and 10 `slice_5c_investigation` entries point at paths
under `local-docs/`, which is untracked and single-machine. They are neither
URIs nor reachable by any reader, and the schema has no representation for
them. Every parameter carrying one also carries an installer-source citation,
so the smallest evidence-backed normalization is removal — the delta-analysis
conclusion is already recorded in the tracked
[`AUTOMATION_HARVEST_LEDGER_4.21.md`](AUTOMATION_HARVEST_LEDGER_4.21.md).

### 3.3 Type aliases — 194

| Alias | 4.20 | 4.21 | Normalizes to |
|---|---|---|---|
| `int` | 67 | 70 | `integer` |
| `bool` | 32 | 25 | `boolean` |

Matches `DIVERGENCE_REGISTER` entry `type-enum-not-enforced` exactly (137 + 57).

**Classified metadata-only.** `param.type` is read in exactly one production
place — `frontend/src/catalogFieldMeta.js:58`, which copies it to `meta.type`
unchanged. No production code branches on the value, and
`backend/src/catalogValidator.js` never reads `type` at all. One frontend test
fixture (`frontend/tests/platform-specifics-step.test.jsx:2633`) mirrors
`"type": "bool"` and must be updated with the data.

---

## 4. Repair row totals

| Class | 4.20 | 4.21 |
|---|---|---|
| missing required field | 140 | 157 |
| malformed citation object | 78 | 144 |
| cross-minor `doc-url` | 0 | 830 |
| cross-minor `installer-branch` | 0 | 109 |
| cross-minor `doc-title` | 0 | 110 |
| section heading absent/renumbered | 94 | 123 |
| type alias | 99 | 95 |
| **total rows** | **411** | **1568** |

Per-row detail — scenario file, parameter index, parameter path, failing field,
current value, proposed value where derived, evidence type, evidence source,
confidence and repair class — is in
[`catalog-repair-ledger-0b.json`](catalog-repair-ledger-0b.json).

---

## 5. Structure of the malformed-citation debt

All 104 failing parameters (39 at 4.20, 65 at 4.21) fail for the same reason:
their citations use a **legacy provenance shape** that predates catalog schema
v2.0.0.

```jsonc
// legacy shape — fails the validator (222 objects: 144 with a url, 78 without)
{ "source": "installer_source", "url": "github.com/openshift/installer/pkg/types/installconfig.go ControlPlane.Platform", "note": "Go struct definition" }
{ "source": "ocp_docs", "note": "OpenShift 4.20 install-config reference" }
```

| `source` value | Count | Has URL |
|---|---|---|
| `installer_source` | 104 | yes |
| `ocp_docs` | 78 | **no** |
| `delta_analysis` | 24 | local path only |
| `slice_5c_investigation` | 10 | local path only |
| `tls_asset_source` | 3 | yes |
| `configmap_source` | 3 | yes |

**No schema change is needed to repair these.** The repository already carries
an accepted, validator-passing convention for installer-source provenance inside
the schema-shaped citation object, used 109 times:

```jsonc
{
  "docId": "installer-source-code",
  "docTitle": "OpenShift Installer 4.20 Source Code",
  "sectionHeading": "pkg/types/installconfig.go - MachinePool.DiskSetup",
  "url": "https://github.com/openshift/installer/blob/release-4.20/pkg/types/installconfig.go"
}
```

So the repair is **normalization onto an existing convention**, not fabrication
and not validator weakening. The minor is carried in both the branch and the
title, which is what makes §3.1 detectable at all.

The 78 URL-less `ocp_docs` stubs are the one sub-class that cannot be normalized
mechanically: they assert that documentation exists without identifying a page.
Each needs a same-minor documentation citation derived from the parameter, or —
where the parameter is genuinely undocumented — removal, leaving the
installer-source citation as the row's evidence. Spot-checked against both
minors' extracted text:

| Parameter | Documented at 4.20 | Documented at 4.21 |
|---|---|---|
| `controlPlane.platform` | yes (7 books) | yes (7 books) |
| `controlPlane.replicas` | yes (4 books) | yes (4 books) |
| `platform.*.defaultMachinePlatform*` | yes (4 books) | yes (4 books) |
| `platform.baremetal.externalBridge` | yes (1 book) | yes (1 book) |
| **`platform.baremetal.libvirtURI`** | **no — 0 hits** | **no — 0 hits** |

`platform.baremetal.libvirtURI` is `supported-backend-only` and absent from
product documentation in both minors. Its repair is installer-source evidence
only; inventing a documentation citation for it would be fabrication.

---

## 6. Transformation rules proven so far

Each rule below is confirmed against the extracted text **and** the live page,
for the target minor only.

| ID | Scope | Rule | Evidence | Citations |
|---|---|---|---|---|
| TR-1 | agent book, 4.21 | chapter slug `installing_an_on-premise_cluster_with_the_agent-based_installer/installation-config-parameters-agent` unchanged; headings 9.1.1–9.1.6, 9.2.1–9.2.2 **identical** at 4.20 and 4.21 | extraction + live page + `data/docs-index/4.21.json` | 462 |
| TR-2 | agent book, 4.21 | `1.5.2. About root device hints` → **`1.4.2. About root device hints`** (chapter 1 renumbered) | extraction, both minors | 27 |
| TR-3 | agent book, 4.21 | `1.11. Validation checks before agent ISO creation` → **`1.10.`** | extraction, both minors | 4 |
| TR-4 | vSphere book, 4.21 | `html/installing_on_vmware_vsphere/installation-config-parameters-vsphere` exists at 4.21; headings 9.1.1–9.1.6 **unchanged** | extraction + live page | 56 |
| TR-5 | any-platform book, 4.21 | `installing_on_any_platform/installing-platform-agnostic`, heading `1.11.2. Configuring the cluster-wide proxy during installation` **unchanged** | live page | 48 |
| TR-6 | installer citations, 4.21 | `blob/release-4.20/` → `blob/release-4.21/` and `"OpenShift Installer 4.20 Source Code"` → `4.21`, **each symbol re-verified in the pinned `release-4.21` clone** | `local-docs/ocp-4.21/installer/source/installer` @ `1accb64` | 109 |

Heading corrections proven since, each confirmed in **both** minors from that
minor's own evidence (the correction is the same; the evidence is separate):

| ID | Cited (wrong) | 4.20 | 4.21 | Evidence |
|---|---|---|---|---|
| TR-7 | `9.1.4. VMware vSphere cluster parameters` | `9.1.4. Additional VMware vSphere configuration parameters` | same | extraction + live page, both minors. The cited string conflates section 9.1.4 with the caption of *Table 9.4. Additional VMware vSphere cluster parameters*. |
| TR-8 | `Required install-config parameters` | `7.1.1. Required configuration parameters` | same | Nutanix book, both minors |
| TR-9 | `Optional install-config parameters` | `7.1.3. Optional configuration parameters` | same | Nutanix book, both minors |
| TR-10 | `Nutanix install-config parameters` | `7.1.4. Additional Nutanix configuration parameters` | same | Nutanix book, both minors |
| TR-11 | `3.3.13.2 Additional install-config parameters - Hosts parameter (Table 3.10)` | `3.3.13.2.1. Hosts` | `3.3.13.2.1. Hosts` | bare-metal book. **Note the parent section was renamed**: 3.3.13.2 is *"Additional install-config parameters"* at 4.20 and *"Additional installation configuration parameters"* at 4.21. The `3.3.13.2.1. Hosts` subsection is stable in both and is what the citation names. |
| TR-12 | `AWS GovCloud install-config parameters` / `AWS GovCloud UPI …` | `3.7. Installing a cluster on AWS into a specialized region` | same | AWS book, both minors. The cited `installing_on_aws_govcloud` **book does not exist** — confirmed HTTP 404 at 4.21 and absent from both acquisitions; the GovCloud content is chapter 3.7 of *Installing on AWS* (`3.7.2. Installation requirements for government regions`). |
| TR-13 | `Azure Government install-config parameters` | `3.7. Installing a cluster on Azure into a government region` | same | Azure book, both minors |

TR-2, TR-3 and TR-11 are the concrete proof that a blind `s#/4.20/#/4.21/#g`
would have been wrong: the URL is right and the cited section is not.

### 6.1 Installer-source citations: per-symbol verification

All 35 distinct `installer-source-code` citations were checked against each
minor's own pinned clone by locating the struct declaration and the field
inside its body (not by grepping for the field name, which produces false
matches).

**22 of 35 are correct. 13 cite the wrong file — identically at both minors**,
so this too is pre-existing debt rather than drift:

| Cited file | Symbols | Actual file (both minors) |
|---|---|---|
| `pkg/types/baremetal/host.go` | `Host.BootMode`, `Host.HardwareProfile`, `Host.Role` | `pkg/types/baremetal/platform.go` |
| `pkg/types/baremetal/host.go` | `RootDeviceHints.WWNVendorExtension`, `RootDeviceHints.WWNWithExtension` | `pkg/types/baremetal/rootdevice.go` |
| `pkg/types/installconfig.go` | `MachinePool.DiskSetup`, `MachinePool.Fencing` | `pkg/types/machinepools.go` |
| `pkg/types/installconfig.go` | `MachinePoolPlatform.{AWS,Azure,BareMetal,IBMCloud,Nutanix,VSphere}` | `pkg/types/machinepools.go` |

`pkg/types/baremetal/host.go` exists in neither release branch.

### 6.2 Coverage of the 4.21 citation-URL repair

Of the 830 cross-minor documentation URLs in `data/params/4.21/**`:

| | Distinct URLs | Citations |
|---|---|---|
| 4.21 target **proven to exist** (live-verified, or present in the tracked, parity-validated `data/docs-index/4.21.json`) | 11 | **760** |
| 4.21 target **not yet verified** | 16 | **70** |

The unverified 70 are the long tail, and several are already proven *wrong*
rather than merely unverified (the `installing_on_aws_govcloud` and
`installing_on_azure_government` books, resolved by TR-12/TR-13; the 20
`docs.openshift.com` citations; two citations whose URL is a **PDF**).
`docs.redhat.com` began returning HTTP 503 to this environment partway through
verification, so the residue is listed in §8.1 rather than assumed.

### 6.3 Parameters needing a derived documentation citation

138 parameters carry either a URL-less `ocp_docs` stub or only an internal
pseudo-citation. Resolving each against its own scenario's platform book, in
its own minor:

| Outcome | Count |
|---|---|
| section and table resolved unambiguously | 72 |
| ambiguous (`controlPlane.platform` family) | 28 |
| not documented in that scenario's own book | 38 |

Four parameter paths are **not documented in their own platform book at either
minor** (identical finding in both, from each minor's own evidence):

| Parameter | 4.20 | 4.21 | supportStatus |
|---|---|---|---|
| `platform.baremetal.libvirtURI` | 0 hits in any book | 0 hits in any book | `supported-backend-only` |
| `platform.aws.defaultMachinePlatform` | absent from *Installing on AWS* | absent | `supported-backend-only` |
| `platform.vsphere.defaultMachinePlatform` | absent from the vSphere book | absent | `supported-backend-only` |
| `networking.clusterNetworkMTU` | only in *Installing on AWS* `3.8.4.5. Customizing the cluster network MTU` | same | `supported-backend-only` |

**Every one is `supported-backend-only`; none is `supported-ui`.** So the
instruction to flag a record whose UI exposure would require docs-backed
supportedness does not fire for any of them: installer-source evidence is the
appropriate authority for a backend-only field, and no record claims
documentation-backed user-facing support. Their repair is the verified
same-minor installer-source citation alone, with the contentless `ocp_docs`
stub removed. No `supportStatus` is changed.

---

## 7. Conformance divergences owned by 0B

From `scripts/validate-catalog-schema-conformance.test.js` `DIVERGENCE_REGISTER`:

| id | Inventory finding | Closable when |
|---|---|---|
| `type-enum-not-enforced` | 194 rows confirmed (`int` 137, `bool` 57); metadata-only (§3.3) | data normalized → enforce enum in `validate-catalog.js` |
| `outputfile-enum-not-enforced` | 78 rows confirmed missing `outputFile`; every **present** value already satisfies the enum | the 78 are filled → enforce enum |
| `required-field-accepts-sentinel` | confirmed unused: all 2121 parameters carry a boolean `required` | sentinel allowance dropped from the validator |

None requires weakening either artifact.

---

## 8. H3 — unresolved, needs a human decision

### 8.1 Citations whose correct same-minor target is not derivable

Each row below is identical at 4.20 and 4.21 and was searched in that minor's
own extracted book set and, where the site was reachable, against the live
page. None is guessed.

| Rows per minor | Minor | Scenario | Current citation | Evidence searched | Smallest decision required |
|---|---|---|---|---|---|
| 4 | both | `ibm-cloud-ipi` | `1.11.2. Configuring the cluster-wide proxy during installation` @ `html-single/installing_on_ibm_cloud/` | IBM Cloud book, both minors: the proxy section is `5.6.4`, `6.7.4`, `7.9.4`, `8.7.1` depending on install type; `1.11.2` belongs to the *any-platform* book | Should these rows cite the any-platform proxy section (as the other 48 proxy citations do) or an IBM-Cloud-specific one, and if the latter, which install type? |
| 3 | both | `nutanix-ipi` | `Mirroring and image sources (shared)` @ `disconnected_environments/index` for `imageDigestSources*` | all 12 books, both minors: `imageDigestSources` appears in **none** | Which authoritative same-minor page documents `imageDigestSources` for this product? |
| 3 | both | `vsphere-ipi` | `vSphere install-config parameters` @ `installing_on_vmware_vsphere/installer-provisioned-infrastructure` | vSphere book, both minors: no such heading; the parameter reference is chapter 9 | Repoint to `9.1.x` in the parameter chapter, or to a heading in the IPI chapter? |
| 2 | both | `vsphere-upi` | `vSphere UPI install-config parameters` @ `…/user-provisioned-infrastructure#installing-vsphere` | as above | as above |
| 2 | both | `bare-metal-ipi` | `Bare metal API and Ingress VIPs` @ `installing_on_bare_metal/installer-provisioned-infrastructure` | bare-metal book, both minors: no such heading | Which section documents the bare-metal API/Ingress VIPs for this minor? |
| 2 | both | `ibm-cloud-ipi` | `17.3.3. Reference specifications for the image-based-installation-config.yaml manifest` @ `html-single/installing_on_ibm_cloud/` | the heading is real but lives in the **edge-computing** book, not IBM Cloud | Is the IBM Cloud pairing simply wrong, and should it become the edge-computing citation the other 30 rows use? |
| 1 | both | `bare-metal-ipi` | `Bare metal hosts` @ `installing_on_bare_metal/installer-provisioned-infrastructure` | bare-metal book, both minors: no such heading | Which section? |
| 1 | both | `bare-metal-ipi` | `Provisioning network` @ `installing_on_bare_metal/installer-provisioned-infrastructure` | bare-metal book, both minors: no such heading (`3.3.13.11. Deploying with no provisioning network` exists, but is not the same topic) | Which section? |

**36 rows total (18 per minor).** None blocks the other repairs.

### 8.2 4.21 target URLs not yet verified

16 distinct URLs / 70 citations (§6.2). `docs.redhat.com` returned HTTP 503 to
this environment partway through verification, and HTTP 403 to `curl` at all
times (the anti-bot behaviour already recorded in
`local-docs/ocp-4.21/analysis/SLICE-5F2-URL-VALIDATION-RESULTS.md`), so a 403
is **not** evidence of absence. These need a verification pass when the site is
reachable; TR-12 and TR-13 already resolve 25 of the 70.

---

## 9. Findings queue and canonical backlog

Canonical status authority for all of these is `docs/BACKLOG_STATUS.md`.

| # | Finding | Disposition |
|---|---|---|
| F-0B-1 | `data/params/4.20/` has 13 catalogs, `data/params/4.21/` has 12: 4.21 has no `oc-mirror-v2.json`, and `data/docs-index/4.21.json` lists no such scenario, so no gate fires. | **Reframed, not "add the missing catalog".** Product policy is that oc-mirror v2 is the latest supported official v2 globally, independent of target minor, so per-minor copies would be wrong. Owned by **DOC-166**. |
| F-0B-2 | 20 citations in each minor used the retired `docs.openshift.com` host. | **Closed in 0B.** 17 per minor migrated to the proven same-minor `docs.redhat.com` page; the remaining 3 were part of the vSphere deprecated-fields group and were relocated to the parameter reference. |
| F-0B-3 | Two citations cited a **PDF** URL as the documentation page, with a 4.20 filename a minor swap would not have corrected. | **Closed in 0B** by `PAGE_RELOCATIONS`: repointed to the chapter's HTML page for the row's own minor. |
| F-0B-4 | Citations pairing a `docId` with a `sectionHeading` from a different book — the IBM Cloud docId carrying the any-platform proxy section and the edge-computing IBI section. | **Closed in 0B** by the `global-proxy-and-trust-bundle` and `image-digest-sources-installer-only` resolution rules. |
| F-0B-5 | `docId: installing-azure-government-upi` carried `docTitle: "...with installer-provisioned infrastructure"`. | **Closed in 0B**: those citations were relocated to the Azure parameter reference, which carries a correct matched docId and title. |
| F-0B-6 | The same `docId` resolved to two different books (`installing_on_azure/...` and `installing_on_azure_government/...`). | **Closed in 0B** by the same relocation: both now address the single verified Azure parameter-reference page. |
| F-0B-7 | The citation array carries several distinct kinds of evidence (product docs, installer source, external NMState schema, and previously internal analysis notes). The schema describes only the first. | **Partly closed.** 0B removed the internal-analysis kind entirely and normalized installer-source onto the established in-repo convention, so the array now holds only product-doc, installer-source and external-schema citations. An explicit provenance model remains worth a later decision; no canonical item raised, as nothing is currently incorrect. |
| F-0B-8 | 12 rows in the `docs/BACKLOG_STATUS.md` active table have a malformed cell count (`DOC-082`, `-084`, `-100` to `-105`, `-107`, `-131`, `-142`, `-144`). Pre-existing at commit `201fa7c`; unchanged by 0B, which added only well-formed rows. | Recorded only. Cosmetic; no status claim is affected. |

New canonical backlog items raised by 0B, recorded in `docs/BACKLOG_STATUS.md`:

| id | title | status | priority |
|---|---|---|---|
| **DOC-165** | Complete generated-config parameter coverage, starting with agent-config.yaml NMState networkConfig | active | p1 |
| **DOC-166** | Single global oc-mirror-v2 / ImageSetConfiguration structural authority, decoupled from target OCP minor | active | p1 |
| **DOC-167** | Documentation-backed supportedness review of the Azure subnet fields the 4.21 installer marks deprecated | active | p2 |
| **DOC-168** | Documentation-backed supportedness review of `imageDigestSources` | active | p2 |

`PHX-007`, `PHX-025` and `PHX-034` were reconciled rather than duplicated: each is
annotated in `docs/BACKLOG_STATUS.md` as a narrower slice of **DOC-165**, to be
sequenced under its coverage matrix rather than actioned independently.

---

## 9.1 Exact-release certification

Mechanical provenance was re-baselined from `release-X.Y` branch tips onto the
exact official released artifacts, and every installer fact 0B asserted was
re-verified against them.

### Resolved baselines

Latest official **stable** `x.y.z` per minor, resolved from the Cincinnati
`stable-<minor>.yaml` channel — the same mechanism the product uses for
target-minor latest-patch resolution. No nightly, CI, release-candidate,
prerelease or branch HEAD was considered. Resolved `2026-10-07T16:30:10Z`.

| | 4.20 | 4.21 |
|---|---|---|
| release | **4.20.40** | **4.21.35** |
| payload digest | `sha256:5e7b0780…0102b` | `sha256:1f8f4234…b457` |
| tarball SHA256 (verified) | `b6904d3e…3e824` | `4e2e7a68…04485` |
| binary SHA256 | `79c84ba5…5db5` | `c20790cb…8da1` |
| `openshift-install version` | `4.20.40` | `4.21.35` |
| installer commit (reported by the binary) | `0c11c37e83ad8b8a328ffe0d0888ef70ed5bab56` | `006669f5812a47dbc733b6736584b87ef696e898` |
| architecture inspected | amd64 | amd64 |
| superseded branch tip | `13a5f6b91e16…` (2026-04-16) | `1accb6487cf3…` (2026-06-25) |

Each tarball was SHA256-verified against that release's own `sha256sum.txt`
before use. The release image digest the binary prints matches `release.txt`
for both, so binary and payload are self-consistent. Each commit was fetched
into a temporary evidence clone; the application repository was never moved.

### Certification result

| Verdict | Count |
|---|---|
| **IDENTICAL** | **97** (43 at 4.20, 54 at 4.21) |
| EXACT-RELEASE-CORRECTION-REQUIRED | 0 |
| SOURCE/BINARY-DISCREPANCY | 0 |
| UNRESOLVED | 0 |

Every installer file-and-symbol pair 0B cited — across
`INSTALLER_FILE_CORRECTIONS`, `LEGACY_INSTALLER_URL_MAP`,
`PSEUDO_CITATION_REPLACEMENTS` and the H3 `CITATION_RESOLUTIONS` — exists in the
exact released source for its own minor. **No catalog citation required
correction.**

### Did branch-tip usage actually matter?

Diffed across **all of `pkg/types`**, both minors:

| | Drift between tip and exact release |
|---|---|
| **4.20** | One JSON-tagged struct field added — `azure.Platform.AllowSharedKeyAccess` — plus its Azure Stack Hub validation rule. |
| **4.21** | **No field added or removed.** Two `,omitempty` JSON-tag additions (`nutanix MachinePool.GPUs`/`.DataDisks`, `vsphere MachinePool.DataDisks`) and one Go variable-scoping fix in vSphere failure-domain validation. |

**Catalog conclusions altered: 0. Claims falsified: 1.**

The 4.21 drift is semantically inert for the catalog: `,omitempty` changes
serialization of an empty value, not a path, type or enum, and none of those
three fields is modelled by a 0B rule. The scoping fix is internal validator
behaviour.

The 4.20 drift is real and was caught only by this certification. 0B recorded
that `azure.Platform.AllowSharedKeyAccess` is a 4.21 addition **absent at 4.20**,
which was true of the April branch tip and **false of released 4.20.40** — the
field was backported into the z-stream in between. Ten of the eleven
"4.21 addition" claims hold against the released 4.20; this one does not.

Impact is bounded and does **not** touch the catalogs: the 4.21 citation is
still correct, because the field genuinely exists at 4.21. Only the supporting
annotation in `scripts/minor/repair/proven-repairs.js` was wrong, and it has
been corrected. The field is documented in **no** Red Hat book at either minor,
so whether 4.20 should expose it, and whether its existing 4.21
`supported-ui` status is justified at all, are documentation questions — tracked
as **DOC-170**. No `minVersion` and no `supportStatus` was changed on installer
evidence alone.

### Preventing regression

`scripts/minor/repair/exact-release-provenance.test.js` (21 tests) fails the
build if any supported minor lacks a released `x.y.z`, payload digest, binary
and tarball SHA256, architecture, or a 40-character installer commit — or if
that commit equals the recorded superseded branch tip. Runbook Rule 2.1 and 2.6
carry the matching procedure.

---

## 10. Outcome

### 10.1 Before and after

| Measure | Baseline (`201fa7c`) | After PROVEN repairs |
|---|---|---|
| `validate-catalog data/params/4.20` | 296 errors | **0** |
| `validate-catalog data/params/4.21` | 445 errors | **0** |
| cross-minor citations in `data/params/4.21/**` | 939 | **0** |
| cross-minor citations in `data/params/4.20/**` | 0 | **0** |
| heading finding rows, 4.20 | 94 | **0** |
| heading finding rows, 4.21 | 123 | **0** |
| total provenance findings, 4.20 | 411 | **0** |
| total provenance findings, 4.21 | 1,568 | **0** |
| `check:citation-minor:strict` | exit 1 | **exit 0**, no suppression list |
| `validate-param-authority` | 1 data failure | **all checks passed** |
| open conformance divergences | 3 | **0** |

### 10.2 What changed, by unit

These are five different units counting five different things. They are not
interchangeable and must not be collapsed into the word "rows".

| Unit | What it counts | 4.20 | 4.21 | Total |
|---|---|---|---|---|
| **parameter records touched** | whole catalog parameter objects, once each | 364 | 1,007 | **1,371** |
| **metadata properties changed** | individual non-citation property assignments | 239 | 252 | **491** |
| **citation objects changed** | individual citation objects modified/removed/added | 312 | 1,083 | **1,395** |
| **provenance findings repaired** | individual inventory defects cleared | 411 | 1,568 | **1,979** |
| **engine rule applications** | individual rule firings — an operation count, *not* a record count | 551 | 1,367 | **1,918** |

Metadata properties by key:

| Key | 4.20 | 4.21 |
|---|---|---|
| `type` | 99 | 95 |
| `outputFile` | 39 | 39 |
| `allowed` | 39 | 39 |
| `default` | 23 | 40 |
| `applies_to` | 39 | 39 |
| **total** | **239** | **252** |

Citation objects: 304 modified + 8 removed at 4.20; 1,041 modified + 42 removed
at 4.21. None added.

### 10.2.1 Behaviour-affecting, classified by effect

A change counts as behaviour-affecting only when it alters what
`frontend/src/catalogFieldMeta.js` `getFieldMeta()` returns to a consumer — not
because of which key moved.

| Unit | 4.20 | 4.21 | Total |
|---|---|---|---|
| **behaviour-affecting parameter records** | 39 | 39 | **78** |
| **behaviour-affecting consumed-property changes** | 79 | 79 | **158** |

The 39 records per minor are exactly those that carried no `outputFile`.
`getFieldMeta()` matches on `(outputFile, path)`, so it could never match them
and returned `null`; filling `outputFile` makes them resolvable, and each also
gains a concrete `allowed`. One — `platform.baremetal.externalBridge` — also
gains a concrete `default` (`"baremetal"`, from that minor's own installer
defaults package). That is 39 + 39 + 1 = 79 consumed-property changes per minor.

Three categories of change are **inert** at the consumer and are deliberately
not counted as behavioural:

- `applies_to` — `backend/src/catalogValidator.js:277` and
  `yamlValidator.js:233` both read `!param.applies_to || param.applies_to.includes(scenarioId)`.
  Absent and `[ownScenarioId]` take the same branch.
- `type` — read in one place and copied through unchanged; no production code
  branches on the value.
- `default` moving between absent, `null` and the sentinel — `isSpecified()`
  treats all three as unspecified, so the returned meta is identical.

### 10.3 Conformance divergences closed

All three entries the register held are closed, and the register is now empty:

| id | Closed by |
|---|---|
| `type-enum-not-enforced` | 194 aliases normalized; `validate-catalog.js` now enforces `CONTRACT.typeEnum` |
| `outputfile-enum-not-enforced` | 78 missing values filled; now enforces `CONTRACT.outputFileEnum` |
| `required-field-accepts-sentinel` | sentinel allowance confirmed unused and dropped; `required` is a boolean in both artifacts |

0B also found a **fourth, unregistered** divergence: the schema declared
`default` as `oneOf [string, number, boolean, null]` while the validator
rejected null outright. 17 parameters in `data/params/4.21/**` had been authored
against the schema and were failing the validator for it; 4.20 used the sentinel
for all 810 of its no-default rows. The data was normalized to the sentinel and
the **schema tightened** to drop null — nothing was loosened to accommodate it.

---

## 11. Reconciliation (machine-checked)

`scripts/minor/inventory/repair-ledger-consistency.test.js` parses this table
and asserts every value against `catalog-repair-ledger-0b.json`, then checks the
arithmetic identities below. A number that appears here and nowhere else, or
disagrees with the JSON, fails the suite.

| key | value |
|---|---|
| baseline.validator.4.20 | 296 |
| baseline.validator.4.21 | 445 |
| baseline.validator.total | 741 |
| baseline.crossMinor.4.21.total | 939 |
| baseline.crossMinor.4.21.visible | 810 |
| baseline.crossMinor.4.21.invisible | 129 |
| baseline.crossMinor.4.20.total | 0 |
| baseline.heading.4.20 | 94 |
| baseline.heading.4.21 | 123 |
| baseline.heading.total | 217 |
| triage.A.total | 181 |
| triage.B.phantomWithdrawn | 390 |
| triage.C.total | 60 |
| triage.D.total | 36 |
| baseline.typeAliases.total | 194 |
| baseline.legacyCitations.total | 222 |
| baseline.provenanceFindings.4.20 | 411 |
| baseline.provenanceFindings.4.21 | 1568 |
| applied.parameterRecordsTouched.4.20 | 364 |
| applied.parameterRecordsTouched.4.21 | 1007 |
| applied.parameterRecordsTouched.total | 1371 |
| applied.metadataPropertiesChanged.4.20 | 239 |
| applied.metadataPropertiesChanged.4.21 | 252 |
| applied.metadataPropertiesChanged.total | 491 |
| applied.citationObjectsChanged.4.20 | 312 |
| applied.citationObjectsChanged.4.21 | 1083 |
| applied.citationObjectsChanged.total | 1395 |
| applied.provenanceFindingsRepaired.4.20 | 411 |
| applied.provenanceFindingsRepaired.4.21 | 1568 |
| applied.provenanceFindingsRepaired.total | 1979 |
| applied.behaviourParameterRecords.4.20 | 39 |
| applied.behaviourParameterRecords.4.21 | 39 |
| applied.behaviourParameterRecords.total | 78 |
| applied.behaviourConsumedPropertyChanges.4.20 | 79 |
| applied.behaviourConsumedPropertyChanges.4.21 | 79 |
| applied.behaviourConsumedPropertyChanges.total | 158 |
| applied.engineRuleApplications.total | 1918 |
| cert.assertions.4.20 | 43 |
| cert.assertions.4.21 | 54 |
| cert.assertions.total | 97 |
| cert.verdictIdentical | 97 |
| cert.correctionsRequired | 0 |
| cert.sourceBinaryDiscrepancies | 0 |
| cert.unresolved | 0 |
| cert.catalogConclusionsAltered | 0 |
| cert.claimsFalsified | 1 |
| final.validator.4.20 | 0 |
| final.validator.4.21 | 0 |
| final.crossMinor.4.21 | 0 |
| final.crossMinor.4.20 | 0 |
| final.heading.4.20 | 0 |
| final.heading.4.21 | 0 |
| h3.frozenCitationsPerMinor | 0 |
| h3.frozenCitationsTotal | 0 |
| h3.distinctHeadings | 0 |
| h3.closedByResolutionRules | 5 |
| final.provenanceFindings.4.20 | 0 |
| final.provenanceFindings.4.21 | 0 |
| h3.headingRowsTotal | 0 |

Identities the test checks:

- `baseline.validator.4.20 + baseline.validator.4.21 = baseline.validator.total`
- `baseline.heading.4.20 + baseline.heading.4.21 = baseline.heading.total`
- `triage.A.total + triage.D.total = baseline.heading.total` — every heading row is class A or class D; classes B and C are counted separately by construction (§3.2.1)
- `baseline.crossMinor.4.21.visible + baseline.crossMinor.4.21.invisible = baseline.crossMinor.4.21.total`
- `final.heading.4.20 + final.heading.4.21 = h3.headingRowsTotal = triage.D.total` — the only heading rows left are the H3 set
- `h3.frozenCitationsPerMinor × 2 = h3.frozenCitationsTotal`. The frozen count (21 per minor) exceeds the heading-row count (18 per minor) by three: the same unresolved heading `vSphere install-config parameters` is cited from two URLs, and the `docs.openshift.com` variant addresses a book absent from the evidence set, so the heading checker reports it `unknown` rather than as heading debt. Both variants are frozen.
- `final.heading.4.20 = triage.D.total / 2` and likewise for 4.21
- every `final.*` value is ≤ its `baseline.*` counterpart
- `applied.provenanceFindingsRepaired.<m> = baseline.provenanceFindings.<m> − remaining findings for <m>`
- `applied.behaviourParameterRecords.<m> ≤ applied.parameterRecordsTouched.<m>`
- `applied.behaviourConsumedPropertyChanges.<m> ≤ applied.metadataPropertiesChanged.<m>`
- every per-minor pair sums to its `.total`
- every reconciliation key names a unit: the test rejects a bare count key, so
  a future figure cannot be published as an unlabelled "row"
- `cert.assertions.4.20 + cert.assertions.4.21 = cert.assertions.total`
- `cert.verdictIdentical = cert.assertions.total` — every installer assertion
  certified against the exact released artifact
- `cert.correctionsRequired = cert.sourceBinaryDiscrepancies = cert.unresolved = 0`


---

## 12. Not done in this tranche

4.22 acquisition has **not** begun. No 4.22 catalog, Field Guide, operator or
product asset exists or was created. 4.20 and 4.21 remain the supported minors;
4.22 remains unsupported and fail-closed.
