# OCP 4.22 asset authoring — Tranche 2 evidence

> **4.22 is still UNSUPPORTED and fail-closed.** This tranche authored the underlying
> **assets** behind the closed gate. `SUPPORTED_MINORS` is unchanged, no public boundary
> accepts 4.22. *(Tranche 3 has since implemented the runtime prerequisites behind the
> same closed gate — see [`TRANCHE_3_RUNTIME_PREREQUISITES.md`](TRANCHE_3_RUNTIME_PREREQUISITES.md).
> 4.22 is still unsupported.)*
>
> Status authority remains [`../../BACKLOG_STATUS.md`](../../BACKLOG_STATUS.md)
> (rows DOC-179, DOC-180, DOC-181, and the DOC-156 annotation).

Produced under [`../MINOR_ONBOARDING_RUNBOOK.md`](../MINOR_ONBOARDING_RUNBOOK.md)
Phases 4 and 5. All documentation retrieval below was performed **2026-10-07** as an
acquisition step, never from a test (runbook Rule 6).

---

## 1. Acquisition surface — `curl` now works

Tranche 1 recorded `curl` receiving **HTTP 403 from `docs.redhat.com` for every URL**,
`html` and `html-single` alike, and concluded that `curl`-based liveness checking was not
a usable gate from this environment.

**That no longer reproduces.** On 2026-10-07 `curl -sL` returned HTTP 200 for every
`docs.redhat.com` URL attempted, with the full server-rendered page body including the
numbered section navigation. The behaviour was calibrated against deliberate negatives
before being relied on:

| Probe | Result |
|---|---|
| `…/4.22/html/installing_on_bare_metal/installer-provisioned-infrastructure` | **200** |
| `…/4.22/html/installing_on_vSphere/installation-config-parameters-vsphere` (the known-bad short form) | **404** |
| `…/4.22/html/installing_on_bare_metal/this-chapter-does-not-exist` | **404** |
| `…/4.99/html/installing_on_bare_metal/installer-provisioned-infrastructure` | **404** |
| `github.com/openshift/installer/blob/release-4.99/pkg/types/installconfig.go` | **404** |

So a 200 here is a real 200 and a 404 is a real 404 — there is no soft-404. The
Tranche-1 note stands as a record of what that environment saw; it is not a permanent
property of the host.

---

## 2. Canonical parameter catalogs — `data/params/4.22/**`

12 scenarios, one for one with the canonical scenario architecture. **No
`oc-mirror-v2.json`**, per [`DOC166_OC_MIRROR_V2_AUTHORITY.md`](DOC166_OC_MIRROR_V2_AUTHORITY.md)
§6: the ImageSetConfiguration schema's authority is the globally-resolved oc-mirror
binary, not a target minor, and a per-minor copy would be the same rows three times over.

| Scenario | 4.21 | 4.22 | new |
|---|---|---|---|
| `aws-govcloud-ipi` | 74 | **81** | +7 |
| `aws-govcloud-upi` | 71 | **76** | +5 |
| `azure-government-ipi` | 73 | **77** | +4 |
| `azure-government-upi` | 72 | **76** | +4 |
| `bare-metal-agent` | 133 | **137** | +4 |
| `bare-metal-ipi` | 97 | **101** | +4 |
| `bare-metal-upi` | 61 | **64** | +3 |
| `ibm-cloud-ipi` | 71 | **74** | +3 |
| `nutanix-ipi` | 73 | **76** | +3 |
| `vsphere-agent` | 139 | **142** | +3 |
| `vsphere-ipi` | 96 | **99** | +3 |
| `vsphere-upi` | 91 | **94** | +3 |
| **total** | 1,051 | **1,097** | +46 |

> **A row count is not a field count.** These are catalog **rows**, keyed by
> (`path`, `outputFile`) per scenario. The +46 is **9 distinct new install-config
> paths** multiplied across the scenarios that model their parent surface — e.g.
> `osImageStream` is one installer field and twelve rows. The 1,051/1,097 totals
> likewise exceed the number of distinct paths: the two agent scenarios each carry
> `apiVersion`, `metadata` and `metadata.name` twice, once for `install-config.yaml`
> and once for `agent-config.yaml`. For the per-field view, see
> [`MECHANICAL_DELTA_LEDGER_4.21_TO_4.22.md`](MECHANICAL_DELTA_LEDGER_4.21_TO_4.22.md)
> §1–2 (**23** new install-config paths at the installer, 0 removed), and §2.6 below
> for the mapping between the two counts.

`supportStatus` distribution across the 1,097 rows:

| Status | Count |
|---|---|
| `supported-backend-only` | 606 |
| `supported-ui` | 396 |
| `supported-derived` | 35 |
| `docs-only-not-supported` | 32 |
| `hidden-not-applicable` | 28 |
| **`unknown-needs-review`** | **0** |

### 2.1 New rows, and the rule used to decide which to create

A row is created when Architect already models the **parent surface**, so a user could
reasonably expect the field, and the accepted Tranche 1/1.5 disposition says it is not
exposed. The existing 4.21 catalogs follow exactly this convention — they record
`platform.*.dnsRecordsType`, the Azure subnet fields and the AWS `cpuOptions` family as
`docs-only-not-supported` / `hidden-not-applicable` rather than omitting them.

9 distinct paths, 46 rows. The last column records the **evidence or provenance** the
classification rests on; it is deliberately not called an "authority", because a
`hidden-not-applicable` row rests on the *absence* of same-minor product documentation,
which is a provenance statement and not a positive citation. Only rows whose evidence is
a same-minor product-doc citation carry one, and only those can be `supported-*`
(runbook Rule 2: absence of documentation never becomes `supported-ui`).

| Path | Status | Scenarios | Rows | Evidence / provenance |
|---|---|---|---|---|
| `osImageStream` | `docs-only-not-supported` | all 12 | 12 | C2 / plan O3 — RHEL 10 is Technology Preview at 4.22 (positive doc citation) |
| `controlPlane.management` | `hidden-not-applicable` | all 12 | 12 | C4 — DevPreview-only; **no** same-minor product doc exists (negative result) |
| `compute[].management` | `hidden-not-applicable` | all 12 | 12 | C4 — as above |
| `platform.aws.ipFamily` | `docs-only-not-supported` | 2 AWS | 2 | H2 — AWS dual-stack is TP at 4.22 (positive doc citation) |
| `platform.azure.ipFamily` | `hidden-not-applicable` | 2 Azure | 2 | H1 — mechanically present in 4.22.16 source; **no** Azure citation exists to carry |
| `controlPlane.platform.aws.hostPlacement` | `docs-only-not-supported` | 2 AWS | 2 | C3 — AWS Dedicated Hosts, TP at 4.22 |
| `compute[].platform.aws.hostPlacement` | `docs-only-not-supported` | 1 AWS | 1 | C3 — as above |
| `platform.aws.defaultMachinePlatform.hostPlacement` | `docs-only-not-supported` | 1 AWS | 1 | C3 — as above |
| `platform.baremetal.provisioningNetworkGateway` | **`supported-ui`** (`bare-metal-ipi`) / `hidden-not-applicable` (`bare-metal-agent`) | 2 bare-metal | 2 | C1 — OCP 4.22 Provisioning APIs Ch. 13 §13.1.1 `.spec` + 4.22.16 source; see §2.5 |

> **`bare-metal-agent` corrected in Tranche 3.** This table originally recorded
> `supported-ui` for both bare-metal scenarios. The Agent-based Installer parameter
> chapter does not list the field (zero occurrences in the whole Agent book at 4.20,
> 4.21 and 4.22), Architect offers no Agent control, and the Agent Day-2 emission was
> removed — so the catalog now says `hidden-not-applicable` there. The data has carried
> the corrected value since Tranche 3; this prose had not caught up. See
> [`TRANCHE_3_RUNTIME_PREREQUISITES.md`](TRANCHE_3_RUNTIME_PREREQUISITES.md).

**`hostPlacement` is recorded as the parent object only**, at the three machine-pool mount
points Architect actually models. The four leaf paths (`affinity`,
`dedicatedHost[]`, `dedicatedHost[].id`, with the exact enum and the 19-character
`h-`+17-hex constraint) are recorded in that row's `versionNotes`. Creating leaf rows for
structure Architect never emits would add catalog surface without adding truth. `arbiter`
mount points were not created at all: no 4.21 catalog models `arbiter.platform.aws.*`.

### 2.2 Delta-derived edits to existing rows

| Path | Change | Authority |
|---|---|---|
| `platform.aws.lbType` | `allowed` narrowed to `["Classic","NLB"]`; `default` becomes the conditional form; `versionNotes` records the condition and that the kubebuilder enum is **NOT** installer-enforced (binary-verified) | H3 |
| `platform.baremetal.bootstrapOSImage` | `deprecated: false`, `supportStatus` unchanged, installer `Deprecated:` marker recorded in `versionNotes` only | H4 |
| `platform.baremetal.clusterOSImage` | as above | H4 |
| `platform.baremetal.bmcVerifyCA` | the `pkg/asset/tls/bmcverifyca.go` citation **dropped**; `versionNotes` records why | §2.4 below |

Per H3, the lowercase `nlb` alias accepted at 4.21 is **not** carried into 4.22: the 4.22
enum declares `Classic` and `NLB` only. Whether 4.20/4.21 should also drop `nlb` is a
separate same-minor question and was deliberately **not** acted on (R9).

### 2.3 Citations are 4.22 from birth, and section headings were re-read

`npm run check:citation-minor:strict` scans 3,390 citations across 37 files in minors
[4.20, 4.21, 4.22] and reports no foreign provenance.

There are 119 distinct citation tuples at 4.21. Each was mapped explicitly; the authoring
script **fails closed** on any tuple not in its map, so nothing can be carried forward
unchecked. **A blind `4.21` → `4.22` substitution would have produced three wrong
citations**, which is precisely why runbook Rule 4 forbids it:

| 4.21 | 4.22 | Evidence |
|---|---|---|
| IBM Cloud `9.1.1`–`9.1.4` | **`10.1.1`–`10.1.4`** | the IBM Cloud installation-configuration-parameters chapter moved from Chapter 9 to **Chapter 10**; read off the 4.22 `html-single` rendering |
| agent `1.10. Validation checks before agent ISO creation` | **`1.11.`** | at 4.22, `1.10` is *Sample install-config.yaml file for bare metal* and the validation section is `1.11` |
| bare metal `3.3.13.2.1. Hosts` | **`3.3.15.1.1. Hosts`** | the install-config section is `3.3.15` at 4.22 (`3.3.13` is now *Local arbiter node configuration prerequisites*) |
| bare metal `2.5.1.3. Optional configuration parameters` | **`3.3.15.1. Additional installation configuration parameters`** | verified to contain `apiVIPs`, `ingressVIPs` and `provisioningNetwork` |

Headings verified **unchanged** at 4.22: the agent chapter (9.1.1–9.1.6, 9.2.1, 9.2.2),
vSphere (9.1.3–9.1.6), AWS (7.1.3, 7.1.4), Azure (7.1.3, 7.1.4), Nutanix (7.1.1, 7.1.3,
7.1.4), platform-agnostic 1.11.2, agent 1.4.2, IBM Cloud disconnected 8.3.2 and 8.11,
vSphere IPI 2.4.5.4, Nutanix prep 1.4. Two unnumbered 4.21 variants were normalised onto
the verified numbered 4.22 form (`7.1.2. Network configuration parameters` for Nutanix,
`7.1.4. Optional AWS configuration parameters` for AWS).

### 2.4 Installer-source citations verified against the exact release

All 77 distinct installer-source citations were checked against the **exact released
4.22.16 clone**, commit `92820966521d640aa5f0edfb69bcfd9c168c2210` — file existence and,
where the heading names a symbol, the symbol itself. 76 resolve unchanged. Three
corrections:

- `Platform.BootstrapOSImage` → **`Platform.DeprecatedBootstrapOSImage`** (Go symbol
  renamed at 4.22; the JSON tag `bootstrapOSImage` is unchanged)
- `Platform.ClusterOSImage` → **`Platform.DeprecatedClusterOSImage`**
- `pkg/asset/tls/bmcverifyca.go` — **removed at 4.22.16**. Present at 4.21.35, absent at
  4.22.16, and `github.com/openshift/installer/blob/release-4.22/pkg/asset/tls/bmcverifyca.go`
  returns 404. The citation was **dropped**, not re-pointed: there is no replacement file,
  and a dead permalink is not evidence. The `bmcVerifyCA` row keeps its
  `pkg/types/baremetal/platform.go` and `pkg/asset/manifests/bmcverifycaconfigmap.go`
  citations, which both still resolve.

This is not contradicted by the delta ledger's "0 removals": that figure counts
install-config **parameter paths**, and no parameter was removed. A supporting asset file
was.

### 2.5 `provisioningNetworkGateway` — C1 authored, with a corrected citation

Classification **C1** is the only `SUPPORTED-UI` parameter the 4.22 onboarding adds. The
classification stands; its *citation* was corrected.

An earlier revision of this tranche concluded the field was undocumented at 4.22. That
conclusion was **wrong, and the reason is worth recording**: the search covered twelve
books, including the bare-metal book that C1 named — but not `provisioning_apis`, where
the text actually lives. A twelve-book sweep that misses the right book returns a
confident false negative.

**Documentation (verified 2026-10-07, HTTP 200)** —
`…/4.22/html/provisioning_apis/provisioning-metal3-io-v1alpha1`, Chapter 13
*Provisioning [metal3.io/v1alpha1]* §13.1.1 `.spec`:

> "**provisioningNetworkGateway** string — ProvisioningNetworkGateway is the IP address of
> the default gateway for the provisioning network. This gateway is provided to baremetal
> hosts via DHCP to enable routing to external networks during inspection and
> provisioning. This field is optional and only used when ProvisioningNetwork is set to
> Managed. The gateway IP must be within the ProvisioningNetworkCIDR but outside of the
> ProvisioningDHCPRange and must not be the same as ProvisioningIP."

The **same chapter at 4.20 and 4.21 contains zero occurrences**, so `minVersion: 4.22` is
established from each prior minor's own documentation, not by inference.

**One correction to C1 as written:** the identifier does *not* appear in the 4.22
bare-metal book §3.3.15. A full-text search of the paginated chapter (4.3 MB, fully
rendered — §3.3.15.1 is present and carries `apiVIPs`, `ingressVIPs`,
`provisioningNetwork`, `provisioningNetworkCIDR`) and of the 9.2 MB `html-single`
rendering returns no match. The catalog cites the Provisioning APIs chapter instead.

**No policy was bent to get here.** Runbook Rule 2.4 asks for "Red Hat **product and
installation** documentation for that same minor"; the Provisioning APIs book is Red Hat
product documentation for OCP 4.22. No tracked rule requires an install-config path to
appear verbatim in an installation-guide table — and **57 of the 394** `supported-ui` rows
already shipping at 4.21 carry *only* an installer-source citation, so this row, which has
both, clears the existing bar comfortably.

**Applicability is derived, not assumed.** The row was added exactly where the
provisioning-network family it constrains already exists — `bare-metal-ipi` and
`bare-metal-agent`. `bare-metal-upi` models `platform.none` in this application and
carries no `provisioningNetwork`, `provisioningNetworkCIDR` or `provisioningDHCPRange`
row, so it gets none here either.

**What the row claims, and what it refuses to claim.** The three Red Hat constraints
(within `provisioningNetworkCIDR`, outside `provisioningDHCPRange`, different from the
provisioning IP) are recorded as **documented product semantics**. They are *not* recorded
as installer-enforced: mechanical delta ledger **D1** proved the installer's own
DHCP-overlap check is **inert against the shipped 4.22.16 binary** — a gateway inside the
allocated range was accepted, and the pre-existing `clusterProvisioningIP` check of the
same shape is equally inert. Only the IP-format rejection is binary-verified, and only
that is claimed. `backend/test/catalog-4.22-provisioning-network-gateway.test.js` pins
both halves.

> **Generation wiring, corrected in Tranche 3.** At Tranche 2 this paragraph also said
> "no generator emits the field", which was true then because the wiring was deferred.
> Tranche 3 added it for `bare-metal-ipi`, gated by
> `isVersionGTE(selectedMinor, "4.22")`, and the test above was rewritten to pin the
> *gate* instead of the absence. 4.20/4.21 install-config remains byte-identical with
> and without the field in state.

### 2.6 Reconciling the three counts

Three different numbers describe the same 4.21 → 4.22 change, and they are not
interchangeable:

| Count | Value | What it measures |
|---|---|---|
| Installer parameter paths added | **23** | distinct new `install-config.yaml` paths between exact 4.21.35 and exact 4.22.16, including leaf paths and all four machine-pool mount points |
| Installer parameter paths removed | **0** | — |
| Distinct catalog paths added | **9** | the subset Architect models, with `hostPlacement` recorded as the parent object only (its 4 leaf paths live in `versionNotes`) and `arbiter.*` mount points not modelled at all |
| Catalog rows added | **46** | the 9 paths × the scenarios whose parent surface Architect models |

23 → 9: the 16 `hostPlacement` leaf paths collapse to 3 parent rows at the three
machine-pool mount points Architect emits, and the `arbiter` mount points are dropped —
`23 − 16 + 3 − 1 (arbiter.management) = 9`.

9 → 46: `osImageStream` ×12, `controlPlane.management` ×12, `compute[].management` ×12,
`platform.aws.ipFamily` ×2, `platform.azure.ipFamily` ×2,
`controlPlane.platform.aws.hostPlacement` ×2, `compute[].platform.aws.hostPlacement` ×1,
`platform.aws.defaultMachinePlatform.hostPlacement` ×1,
`platform.baremetal.provisioningNetworkGateway` ×2.

For where each of the 9 is represented in the frontend and the backend today, and whether
it should be, see
[`TRANCHE_4_PRE_FLIP_VERIFICATION.md`](TRANCHE_4_PRE_FLIP_VERIFICATION.md) §10.

---

## 3. Documentation index — `data/docs-index/4.22.json`

12 scenarios, 48 entries, 30 distinct URLs. **All 30 returned HTTP 200** on 2026-10-07.

Every chapter number quoted in a `notes` field was read off that same 4.22 page:
oc-mirror v2 is **Chapter 5**, *About disconnected installation mirroring* Chapter 3,
*Configuring a custom PKI* Chapter 6, *Support for FIPS cryptography* Chapter 4,
*Using Operator Lifecycle Manager in disconnected environments* Chapter 10,
image-based installation for single-node OpenShift Chapter 17, IBM Cloud disconnected
Chapter 8, and the IBM Cloud parameter chapter **Chapter 10** (9 at 4.21).

`azure-government-upi` is **new** to the index — see DOC-180. The scenario and its catalog
exist at 4.20 and 4.21 but neither index lists it, so it renders with no documentation
links. Rather than carry a known gap into a brand-new index, the entry was authored from
the verified 4.22 `installing_on_azure/user-provisioned-infrastructure` chapter. 4.20 and
4.21 are left untouched (no cross-minor backfill).

`frontend/src/data/docs-index/4.22.json` is the generated mirror; `npm run
sync-docs-index:check` reports 3 in sync, 0 drifted. **4.22 is not publicly resolvable:**
`frontend/src/docsIndexResolver.js` discovers indexes by glob but gates on
`SUPPORTED_MINORS`, so `ensureDocsIndexForMinor("4.22")` resolves to `null` with the file
present on disk. There is no longer a static import map to avoid adding to.

---

## 4. Architecture support — `data/arch-support/<minor>.json`

The approved D3 model for **4.20, 4.21 and 4.22**: minor × platform × install-method ×
architecture, 12 rows and 48 cells per minor, 144 cells total. Validated by
`scripts/validate-arch-support.js`, registered in `scripts/validate-param-authority.js`
and covered by 19 hermetic tests.

Per minor: **15 `supported`**, **33 `hidden`**, **0 `unknown`**, 0 `locked`. Every cell is decided.

Each minor was placed from **that minor's own** books, fetched separately. The three
minors agree, which is a finding rather than an assumption:

| Book (per minor) | Documented `architecture` valid values |
|---|---|
| Installing on bare metal | `amd64` and `arm64` |
| Installing on AWS | `amd64` and `arm64` |
| Installing on Azure | `amd64` and `arm64` |
| Installing on VMware vSphere | `amd64` (the default) |
| Installing on Nutanix | `amd64` (the default) |
| Installing on IBM Cloud | `amd64` (the default) |
| Agent-based Installer, Table 1.1 | 64-bit x86, 64-bit ARM, ppc64le, s390x — **not split by platform** |

Install-method dependence is real, which is the structural argument for D3 independent of
which cells are true: the Agent-based Installer table lists four architectures while the
vSphere book lists one, and a platform-keyed table cannot express the difference.

#### How the 21 initially-open cells were closed

They fell into three evidence classes, identical at each minor and resolved from that
minor's own books:

| Cells | Resolution | Evidence |
|---|---|---|
| `bare-metal/agent` × `ppc64le`, `s390x` (6) | **hidden** | `ppc64le`/`s390x` agent installation *is* IBM Power / IBM Z installation. The agent book handles it through dedicated procedures — for s390x, "Adding IBM Z agents" with z/VM, RHEL KVM or LPAR, with ISO boot restricted to RHEL KVM and PXE-only for z/VM and LPAR. Those are separate platforms with their own books, outside Architect's scenario set, and the bare-metal book's own architecture enum is `amd64 and arm64`. Table 1.1 is installer-wide and not platform-split. |
| `vsphere/agent` × `aarch64` (3) | **hidden** | The vSphere book documents `amd64 (the default)` as the only valid install-config architecture at all three minors, and the vSphere agent-based chapter contains no architecture statement at all. Platform applicability is governed by the platform's own documentation; an installer-wide table does not override it. This also makes the three vSphere rows mutually consistent. |
| `{aws-govcloud, azure-government}` × `{ipi, upi}` × `aarch64` (12) | **hidden** | Checked directly at each minor: **every** occurrence of the government-region term in each book was examined and **none** carries an `ARM`/`arm64` token within 700 characters. The government-region sections cover regions, service endpoints and disconnected restrictions; the tested-ARM-instance-type sections carry no region qualification. Under the documentation-veto rule, absence of documentation never becomes supported. |

The `unknown` disposition is **retained in the schema** so a future onboarding can record
an in-flight gap, and `scripts/validate-arch-support.test.js` asserts the tracked data
ships none while still proving an `unknown` cell can never be marked offered.

Three things the model is required to carry, and does:

1. **No mixed-architecture implication.** `homogeneousOnly.value: true`,
   `mixedArchitectureSupported: false`, with the verbatim same-minor citation present in
   all six platform books at all three minors: *"Currently, clusters with varied
   architectures are not supported. All pools must specify the same architecture."* The
   4.22 file additionally records that OCP 4.22 allows ARM compute on x86 bare-metal
   control planes and that **Architect does not model it** — recorded so silence is not
   read as impossibility.
2. **Three separate architecture axes**, with `exportBinary` carrying the standing rule
   that Red Hat publishes `openshift-install-rhel9-arm64.tar.gz` and that the
   *"Linux ARM64 (RHEL 9 FIPS)"* download option is **correct and not a defect**. The
   validator fails if that rule is deleted, so the Tranche-1.5 correction cannot be
   silently re-inverted.
3. **Cluster-node FIPS** on the target-cluster axis only: `x86_64, ppc64le, s390x`,
   excluding `aarch64`.

**Nothing reads this data.** `BlueprintStep.jsx` still uses its own platform-keyed
constant; replacing it is Tranche 3. See the DOC-156 annotation for the contradiction
between the shipped table and this evidence.

---

## 5. Field Guide — `backend/src/fieldGuide/v4.22/**`

9 modules, 40 compartments, identical ids and ordering to v4.21; every compartment
declares `version: "4.22"`. Classification applied to the transform:

| Class | Count | Meaning |
|---|---|---|
| A — mechanical | 9 modules | version fields, headers, `(OCP 4.21)` labels, `compartments_v421` → `compartments_v422` |
| B — re-verified | 59 docRef URLs | every URL re-checked; see below |
| C — re-decided | 11 content edits | each backed by a named 4.22 source |

### 5.1 Class B found a defect in the supported minors

18 of the 26 distinct v4.21 docRef base URLs are **dead at 4.21 itself** (DOC-179), so
they could not be "carried forward" in any meaningful sense. v4.22 is authored against 41
candidate 4.22 URLs that were each HTTP-200 validated, drawn from the real 4.22 chapter
slug inventory, and `backend/test/fieldGuide-4.22.test.js` fails if any v4.22 docRef cites
one of the three dead book paths.

### 5.2 Class C content, and its authority

| Statement | Source |
|---|---|
| RHCOS uses RHEL 9.8 at 4.22 | release notes §1.3.15 |
| RHEL 10 base image is Technology Preview and Architect does not offer it | release notes TP table §1.9.5; C2 |
| Cluster-node FIPS covers x86_64/ppc64le/s390x only — **and is not an export-binary restriction** | Installation overview Ch. 4; Tranche 1.5 ARM64 correction |
| oc-mirror v2 is Chapter 5 at 4.22 (7 at 4.20); slug unchanged | 4.22 Disconnected environments |
| `oc adm release mirror` **newly deprecated** at 4.22 (GA at 4.20 and 4.21) | release notes Table 1.6 |
| ICSP still deprecated; Architect emits `imageDigestSources` | release notes Table 1.5 |
| Red Hat Marketplace **removed** at 4.22 (deprecated at 4.20/4.21); SQLite catalog format still deprecated | release notes Table 1.7 |
| ARM compute on x86 bare-metal control planes exists at 4.22 — and Architect does not model it | release notes Multi-Architecture |
| Installer marks `bootstrapOSImage`/`clusterOSImage` deprecated, **but Red Hat 4.22 docs do not** | H4 + 4.22.16 source |
| Fujitsu iRMC drivers deprecated | release notes Tables 1.3 / 1.4 |
| `provisioningNetworkGateway` is new, Managed-only, with its three documented constraints — and the DHCP-overlap check is **not** installer-enforced | Provisioning APIs Ch. 13 §13.1.1; delta ledger D1 |

### 5.3 Zero unclassified 4.21 copy; the allowlist is exact

Exactly **five** cross-version statements remain, each semantic and each with a recorded
rationale:

| File | Statement | Why its minor must not move |
|---|---|---|
| `baremetal.js` | `title: "BMC CA Certificate Verification (4.21+)"` | `bmcVerifyCA` was introduced at 4.21; the introduction minor does not move |
| `baremetal.js` | *"available in OpenShift 4.21 and later"* | availability window, true at 4.22 |
| `azure.js` | *"must use OpenShift 4.21 or later"* | multi-node-subnet capability floor |
| `mirror.js` | *"it was generally available at 4.20 and 4.21"* | deprecation tracker for `oc adm release mirror` |
| `mirror.js` | *"it was deprecated at 4.20 and 4.21"* | deprecation tracker for Red Hat Marketplace |

The test checks the allowlist **in both directions**, so a stale entry fails too.

### 5.4 The binary contract was copied verbatim (GAP-08)

`tools-and-creds` download commands are asserted **byte-identical** to v4.21:
`clients/ocp/{{version}}/openshift-install-linux.tar.gz`,
`clients/ocp/latest-{{versionMajorMinor}}/openshift-client-linux.tar.gz`,
`clients/ocp/latest/oc-mirror.tar.gz`. A separate assertion fails if oc-mirror is ever
pinned to a minor.

### 5.5 Deliberately NOT wired

v4.22 is not imported by `assembler.js` or `provenance.js`, is not in
`FIELD_GUIDE_SUPPORTED_MINORS`, and `getAuthoritativeExport("4.22")` returns `null`. The
test asserts all four. Runtime compartment certification and `certifyDocRefs("4.22")`
need the support flip and ship with the enablement tranche.

---

## 6. Versioned-copy guard

No exemption was added. `--check` scans `frontend/src/**/*.{js,jsx}` only, and none of the
five new 4.22 surfaces is a frontend JS/JSX file — but that is now **recorded** in
[`../../VERSIONED_COPY_INVENTORY.md`](../../VERSIONED_COPY_INVENTORY.md) along with the
guard that does cover each one, so a reader cannot mistake "out of scope" for
"adjudicated and exempt".

One fixture was **added**: `VIOLATE_stale_prev_minor`. The original set proved the guard
catches *future* versions; onboarding a minor creates the opposite risk, and stale
previous-minor copy must fail too. Violation count 12 → 13, assertions 42 → 43. No
existing fixture or exemption changed — in particular **`OpenShift 4.22+` in frontend copy
remains a violation**, and the THRESH/VGATED adjudications still enumerate only
4.11/4.12/4.13/4.20/4.21.

---

## 7. Fail-closed proof in the final tree

| Boundary | Result |
|---|---|
| `backend/src/versionPolicy.js` `SUPPORTED_MINORS` | `["4.20","4.21"]` |
| `frontend/src/shared/versionPolicy.js` `SUPPORTED_MINORS` | `["4.20","4.21"]` |
| `FIELD_GUIDE_SUPPORTED_MINORS` | `["4.20","4.21"]` |
| `isSupportedMinor("4.22")` (both sides) | `false` |
| `assertSupportedOpenShiftMinorForGeneration` with 4.22 state | throws `UNSUPPORTED_VERSION` |
| `selectAndOrder("4.22", …)` | throws |
| `getAuthoritativeExport("4.22")` | `null` |
| `certifyExport("4.22", …)` | throws |
| `ensureCatalogsForMinor("4.22")` | rejects with `UnsupportedVersionError` — gated before any fetch |
| `ensureDocsIndexForMinor("4.22")` | resolves `null` — gated on `SUPPORTED_MINORS` |
| `scripts/lib/released-minor-support.json` | unchanged; 4.22 not appended |

4.22 assets existing on disk change none of this: both frontend resolvers check
`SUPPORTED_MINORS` **before** touching their globs.

---

## 8. What was deliberately not done

No change to `SUPPORTED_MINORS` or any support-policy module. No runtime
architecture-support resolver migration. No 4.22 UI control, generation wiring or
ImageSet generation — `provisioningNetworkGateway` is a catalog and Field Guide **asset**
only, and `backend/src/generate.js` is asserted not to emit it. No
`data/params/4.22/oc-mirror-v2.json`. No repair of the 4.20/4.21 Field Guide docRefs
(DOC-179) or the 4.20/4.21 docs-index gap (DOC-180). No `nlb` removal at 4.20/4.21.
No Tranche 3, 4, 5 or 6 work.
