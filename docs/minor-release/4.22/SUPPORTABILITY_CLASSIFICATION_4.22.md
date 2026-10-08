# OCP 4.22 Supportability Classification Ledger

> **Tranche 1 deliverable 3 of 10.** Classification is **proposed, not implemented.**
> No catalog row, UI control, validation rule or Field Guide text is created by this
> document. Machine-readable: [`supportability-classification-4.22.json`](supportability-classification-4.22.json).

**Authority model** (runbook Rule 2, plan O1): the installer owns mechanical reality; the
**same-minor Red Hat documentation owns user-facing supportedness and holds veto**.
Installer presence alone never authorizes `supported-ui`.

Documentation retrieved **2026-10-07**; the full acquisition manifest with URLs and
retrieval method is in [`FIELD_GUIDE_DOCS_INDEX_SOURCES_4.22.md`](FIELD_GUIDE_DOCS_INDEX_SOURCES_4.22.md) §1.

---

## 1. Summary

| Classification | Count |
|---|---|
| `SUPPORTED-UI` | **1** |
| `SUPPORTED-BACKEND-ONLY` | 0 |
| `DOCS-ONLY-NOT-SUPPORTED` | **3** |
| `HIDDEN-NOT-APPLICABLE` | **1** |
| `HUMAN-REVIEW-REQUIRED` | **4** |

Every row below is a *proposal* for Tranche 2 to implement after human acceptance.

---

## 2. C1 — `platform.baremetal.provisioningNetworkGateway` → **SUPPORTED-UI**

> ### ✅ CONFIRMED and implemented in Tranche 2 — with a corrected citation
>
> **The classification stands.** The *citation* below was corrected: the documentation
> is in the OCP 4.22 **Provisioning APIs** book, not the bare-metal installation book.
>
> Verified 2026-10-07 at
> `…/4.22/html/provisioning_apis/provisioning-metal3-io-v1alpha1` (HTTP 200),
> Chapter 13 *Provisioning [metal3.io/v1alpha1]* §13.1.1 `.spec`, verbatim:
>
> > "**provisioningNetworkGateway** string — ProvisioningNetworkGateway is the IP address
> > of the default gateway for the provisioning network. This gateway is provided to
> > baremetal hosts via DHCP to enable routing to external networks during inspection and
> > provisioning. This field is optional and only used when ProvisioningNetwork is set to
> > Managed. The gateway IP must be within the ProvisioningNetworkCIDR but outside of the
> > ProvisioningDHCPRange and must not be the same as ProvisioningIP."
>
> The same chapter at **4.20 and 4.21 contains zero occurrences**, which independently
> confirms `minVersion: 4.22` from each prior minor's own documentation.
>
> **The row below is wrong on one point and is corrected here:** the identifier does
> **not** appear in the 4.22 bare-metal book §3.3.15. A full-text search of the
> paginated chapter (4.3 MB, fully rendered — §3.3.15.1 is present and carries `apiVIPs`,
> `ingressVIPs`, `provisioningNetwork`, `provisioningNetworkCIDR`) and of the 9.2 MB
> `html-single` rendering of the whole book returns no match, and the sentence quoted in
> the row's "Documentation" cell does not occur there. The catalog therefore cites the
> Provisioning APIs chapter, which is where the text actually lives.
>
> **No policy requires an install-config path to appear verbatim in an installation-guide
> table.** Runbook Rule 2.4 asks for "Red Hat **product and installation** documentation
> for that same minor", and the Provisioning APIs book is Red Hat product documentation
> for OCP 4.22. For scale: **57 of the 394** `supported-ui` rows already shipping at 4.21
> carry *only* an installer-source citation, so a row with both installer-source evidence
> **and** a same-minor product-API citation is better evidenced than rows already in
> production.
>
> Implemented in `data/params/4.22/{bare-metal-ipi,bare-metal-agent}.json`. Evidence:
> [`TRANCHE_2_ASSET_AUTHORING_4.22.md`](TRANCHE_2_ASSET_AUTHORING_4.22.md) §2.5.

| | |
|---|---|
| **Mechanical** | New at 4.22.16. `pkg/types/baremetal/platform.go` `Platform.ProvisioningNetworkGateway`, `string`, `omitempty`, `+optional`, `+kubebuilder:validation:Format=ip`. **No feature gate.** |
| **Binary** | Accepted with `provisioningNetwork: Managed`; rejected as `"not-an-ip" is not a valid IP`; accepted-and-ignored with `provisioningNetwork: Disabled`. |
| **Documentation** | Documented in the OCP **4.22** bare-metal book, §3.3.15 *Configuring the install-config.yaml file*: *"The IP address of the gateway for the network on the `provisioning` interface."* Not listed as Technology Preview anywhere in the 4.22 release notes. |
| **Novelty** | Absent from 4.21.35 source. Not found in the 4.21 bare-metal book in the portions searched. |
| **Scenario applicability** | `bare-metal-ipi`, `bare-metal-agent` |
| **Install-method applicability** | IPI and Agent. **Not** `bare-metal-upi` — UPI has no installer-managed provisioning network. |
| **Architecture applicability** | No architecture dependency found. |
| `minVersion` | `4.22` |
| `maxVersion` | none |
| `introducedInMinor` | `4.22` |
| **Conditional** | Only honoured when `provisioningNetwork: Managed`; ignored for `Unmanaged`/`Disabled`. The UI already exposes `provisioningNetwork`, so this is a conditional on an existing control. |
| **Citation (human-facing)** | `https://docs.redhat.com/en/documentation/openshift_container_platform/4.22/html/installing_on_bare_metal/installer-provisioned-infrastructure` — §3.3.15 |
| **Ownership** | UI field on the bare-metal provisioning section + catalog row + backend generation. |
| **Tests required** | catalog row validates; generation emits only when Managed; validation rejects a non-IP; **negative test** that it is not offered for `bare-metal-upi`; version-gating test that it is invisible at 4.20/4.21. |

> **Do not** implement the DHCP-range overlap rule as a UI validation. The installer's own
> rule is inert against the shipped binary (delta ledger §7 D1). Claiming the check in the
> UI would assert a constraint the installer does not enforce.

## 3. C2 — `osImageStream` → **DOCS-ONLY-NOT-SUPPORTED**

Confirms plan decision **O3** from three independent directions.

| | |
|---|---|
| **Mechanical** | `pkg/types/installconfig.go` `InstallConfig.OSImageStream`, enum `rhel-9`/`rhel-10`. Gated by `OSStreams`, which `openshift/api` enables only `inTechPreviewNoUpgrade()` and `inDevPreviewNoUpgrade()` — **not** `inDefault()`. |
| **Binary** | `Forbidden: this field is protected by the OSStreams feature gate which must be enabled through either the TechPreviewNoUpgrade or CustomNoUpgrade feature set`. |
| **Documentation** | 4.22 release notes, Installation Technology Preview table §1.9.5: *"you can install a cluster using RHEL version 10 as the base image for all machines in the cluster. This feature is available as a Technology Preview"*, enabled by *"enable the `TechPreviewNoUpgrade` feature set and set the `osImageStream` parameter to `rhel-10`"*. |
| **Conclusion** | Record the capability with its rationale; do **not** expose it. Architect does not offer `TechPreviewNoUpgrade`, so the field could only ever produce a rejected install-config. |
| **Applicability** | All platforms; `rhel-10` forbidden on SCOS/OKD builds. |
| `introducedInMinor` | `4.22` |
| **Tests required** | catalog row carries `supportStatus: docs-only-not-supported`; a test asserting no UI surface renders it and generation never emits it. |

## 4. C3 — AWS Dedicated Hosts (`*.platform.aws.hostPlacement.*`) → **DOCS-ONLY-NOT-SUPPORTED**

| | |
|---|---|
| **Mechanical** | 16 paths from 4 fields × 4 machine-pool mount points. `pkg/types/aws/machinepool.go`. Gated `AWSDedicatedHosts` → TechPreview/DevPreview only. |
| **Binary** | `compute[0].platform.aws.hostPlacement: Forbidden: this field is protected by the AWSDedicatedHosts feature gate`. |
| **Documentation** | 4.22 release notes Machine-management TP table §1.9.7: *"You can now place compute machines on Amazon Web Services (AWS) Dedicated Hosts"* — **Technology Preview in 4.22**. |
| **Additional scope note** | Architect models **AWS GovCloud**, not commercial AWS. The release note does not state GovCloud applicability. Even if it graduated, GovCloud applicability would need separate evidence. |
| `introducedInMinor` | `4.22` |

## 5. C4 — `{controlPlane,compute[],arbiter}.management` → **HIDDEN-NOT-APPLICABLE**

| | |
|---|---|
| **Mechanical** | `pkg/types/machinepools.go` `MachinePool.Management`, enum `ClusterAPI`/`MachineAPI`, `+kubebuilder:default=ClusterAPI`. Gated `ClusterAPIControlPlaneInstall` / `ClusterAPIComputeInstall`, which `openshift/api` enables **`inDevPreviewNoUpgrade()` only** — not even TechPreview. |
| **Binary** | `controlPlane.management: Forbidden: this field is protected by the ClusterAPIControlPlaneInstall feature gate`. |
| **Documentation** | No mention in the 4.22 release notes, including the TP tables. Doc comment says *"Supported platforms: aws"*. |
| **Why HIDDEN rather than DOCS-ONLY** | `DOCS-ONLY-NOT-SUPPORTED` implies the documentation describes it. It does not — the capability is DevPreview-only and undocumented for users, so there is nothing to describe or cite. |
| **Nuance worth keeping** | The gate fires only when the value is *explicitly* `ClusterAPI`. An omitted field defaults to `ClusterAPI` later in the pipeline without tripping the gate. So omitting it is correct and safe; emitting it is not. |

## 6. HUMAN-REVIEW-REQUIRED

> **⚠ RESOLVED in Tranche 1.5.** All four items below now have deterministic
> dispositions in [`H_ITEM_DISPOSITIONS.md`](H_ITEM_DISPOSITIONS.md), which supersedes
> this section. Note in particular that the "the catalog schema cannot express this"
> premise used in H3 and H4 below was **wrong**: `versionNotes`, `conditionals`,
> `deprecated`, `deprecatedReason` and `replacementPath` all already exist and are in
> use. No schema change is required for any of the four.

### H1 — `platform.azure.ipFamily`: installer mechanics and documentation disagree

**This is the O1 / Rule 2.5 case and must not be decided silently.**

- **Installer:** `platform.azure.ipFamily` exists at 4.22.16 with the same three-value enum
  as AWS, gated by `AzureDualStackInstall` (TechPreview/DevPreview).
- **Documentation:** the 4.22 release notes Installation TP table §1.9.5 lists
  *"Installing a cluster on Amazon Web Services (AWS) with dual-stack networking"* —
  **Technology Preview in 4.22, Not Available in 4.20 and 4.21**. It lists **no Azure
  equivalent**, and no Azure dual-stack entry was found elsewhere in the release notes.

So AWS dual-stack is documented as TP and Azure dual-stack is mechanically present but
undocumented. Both facts are recorded; neither is chosen.

**Smallest decision required:** does an undocumented-but-feature-gated capability get
`docs-only-not-supported` (same as AWS, on the grounds that both are unreachable without
TechPreviewNoUpgrade) or `hidden-not-applicable` (on the grounds that nothing documents
it)? Either way it is **not** exposed in v2.1, so this does not block Tranche 2 — but the
two statuses carry different meanings in the catalog and the choice should be deliberate.

Additional unresolved sub-question: Architect models **Azure Government**, and the
release-note table says *AWS* without qualifying GovCloud. Commercial-cloud TP status is
not automatically GovCloud TP status.

### H2 — `platform.aws.ipFamily` for **AWS GovCloud** specifically

AWS dual-stack is documented TP for AWS. Architect's scenarios are
`aws-govcloud-{ipi,upi}`. No 4.22 evidence was found either way for GovCloud regions.
Disposition is `docs-only-not-supported` on TP grounds regardless, so this does not block
Tranche 2; recorded so the catalog note does not overclaim.

### H3 — `platform.aws.lbType` conditional default

The documented default changed from unconditional `Classic` to conditional on `ipFamily`
(delta ledger §5). Since `ipFamily` will not be exposed, Architect always lands in the
`Classic` branch — so **no behaviour change is required**. But the catalog currently
records a flat default, and recording a conditional default has no schema support today.

**Smallest decision required:** leave the flat `Classic` default with an explanatory note,
or extend the catalog schema for conditional defaults? Recommend the note; a schema
change for one row is not proportionate.

Also record (D2, delta ledger §7): the new `lbType` kubebuilder enum is **not** enforced by
`openshift-install`. Do not add a UI validation citing it as installer-enforced.

### H4 — the two newly deprecated bare-metal OS-image fields

`platform.baremetal.bootstrapOSImage` and `platform.baremetal.clusterOSImage` carry
`Deprecated:` markers at 4.22 and are still accepted by the binary.

The runbook requires **both** an installer `Deprecated:` comment **and** a replacement
already present in the catalog before a field is removed. The first is satisfied; the
second is not — the stated replacement is *"the OS image is now part of the OpenShift
release"*, which is an absence of a field, not a replacement field.

Per the two-tier strategy this is **P1 mark, not P0 remove**. Marking requires deprecation
metadata that the catalog schema does not currently express — the same gap
`DOC-167` already carries for the Azure subnet fields.

**Smallest decision required:** should 4.22 catalogs carry a `deprecated` / `deprecationNote`
pair, and does that reopen `DOC-167` as a schema question rather than a per-field one?
Checked against `docs/BACKLOG_STATUS.md`: `DOC-167` is `active`/`p2` and is scoped to the
Azure subnet fields. **No new backlog ID is invented here** (execution-contract rule 11);
this is referred to the human as a possible `DOC-167` scope extension.

---

## 7. Deliberately not classified

Extracted, out of Architect's platform scope, recorded so a future reader does not mistake
silence for absence: `platform.gcp.*` (including the GCP sovereign-cloud work),
`powervc`, `powervs`, `openstack`, `ovirt`, `external`, `none`, and Azure Stack Hub.

## 8. Agent-config

**Zero deltas** between 4.21.35 and 4.22.16. No agent-config row requires classification.
The DOC-165 coverage question is independent of this and is handled in
[`DOC165_GENERATED_CONFIG_COVERAGE_4.22.md`](DOC165_GENERATED_CONFIG_COVERAGE_4.22.md).
