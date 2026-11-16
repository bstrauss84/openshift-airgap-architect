# H1–H4 — final dispositions for 4.22 catalog authoring

> **Tranche 1.5 deliverable.** These are **deterministic dispositions**, directly usable
> when `data/params/4.22/**` is authored in Tranche 2. Nothing here is implemented:
> no 4.22 catalog exists and none is created.
>
> Supersedes the four `HUMAN-REVIEW-REQUIRED` rows in
> [`SUPPORTABILITY_CLASSIFICATION_4.22.md`](SUPPORTABILITY_CLASSIFICATION_4.22.md) §6.
>
> **Revised at the Tranche 1.5 final review.** Two dispositions were tightened:
> **H2** now states explicitly that a documented Technology Preview capability is never
> normal supported UI, and **H4** no longer routes installer-only deprecation evidence
> through `supportStatus`.

**Authority order applied** (runbook Rule 2): installer and binary own mechanical
reality; same-minor Red Hat documentation owns user-facing supportedness and holds veto.
**Absence of documentation never becomes `supported-ui`.** Where Red Hat support could
not be established, the row is classified conservatively with an explicit disposition
rather than left for Tranche 2 to guess.

---

## Correction to Tranche 1

Three of the four items were framed as *"the catalog schema cannot express this"*. **That
premise was wrong.** `schema/catalog-parameter-schema.json` already defines, and the
catalogs already use:

| Field | Purpose | Current uses |
|---|---|---|
| `deprecated` (boolean) | *"Shows orange 'Deprecated' badge in UI, adds warning to tooltip."* | 22 |
| `deprecatedReason` | migration guidance shown in the tooltip | 4 |
| `replacementPath` | canonical replacement field | 4 |
| `removalVersion` | planned removal major | 0 |
| `versionNotes` | *"Default changed from 100 to 120 in 4.21"* — version-specific behaviour notes | 6 |
| `conditionals` | `mutuallyExclusive`, `visibleWhen` | 50 |

So no schema extension is required for any of H1–H4. The work is choosing values, which
is what this document does.

Crucially, `deprecated` is **separate** from `supportStatus`, and it is explicitly the
badge flag.

Two rules follow, and they govern H2 and H4 respectively:

1. **`supportStatus` records the Red Hat *product* support disposition**, which is
   documentation-governed. It is not a place to park installer-only mechanical findings.
   Those belong in `versionNotes` plus an installer-source citation.
2. **`deprecated: true` is a user-facing presentation claim** (*"Shows orange
   'Deprecated' badge"*) and needs same-minor product documentation behind it.

Together they let a row carry "the installer marks this deprecated" as provenance while
making no support or presentation claim Red Hat has not made.

---

## H1 — `platform.azure.ipFamily` → **`hidden-not-applicable`**

| | |
|---|---|
| **Mechanical** | Present at 4.22.16: `pkg/types/azure/platform.go` `Platform.IPFamily`, enum `IPv4`/`DualStackIPv4Primary`/`DualStackIPv6Primary`. Gated `AzureDualStackInstall`, which `openshift/api` enables `inTechPreviewNoUpgrade()` and `inDevPreviewNoUpgrade()` only. |
| **Documentation** | **NOT PRESENT.** Checked twice under a strict "report only what is literally present" protocol: the 4.22 release notes Installation Technology Preview table §1.9.5 lists *AWS* dual-stack and no Azure equivalent; the 4.22 *Installing on Azure* book contains no `ipFamily`, no Azure dual-stack text, and no dual-stack TP mention. |
| **Disposition** | `hidden-not-applicable`, `minVersion: 4.22`, `introducedInMinor: 4.22`, no UI surface, never emitted. |

**Why `hidden-not-applicable` and not `docs-only-not-supported`.** The latter means the
documentation describes a capability the product chooses not to expose, and it carries a
documentation citation. There is no Azure citation to carry — attaching the AWS release
note would be citing one platform's status as another's. This also keeps the taxonomy
consistent with `*.management` (classification C4), which is likewise gated and
undocumented.

**Catalog note to record:** the mechanically identical AWS sibling *is* documented as
Technology Preview at 4.22. Revisit if Red Hat documents Azure dual-stack in a later
4.22 z-stream. The installer-source citation convention established in 0B carries the
mechanical evidence.

**Conservative either way:** both candidate statuses yield "not exposed in v2.1", so this
never blocked Tranche 2; only the recorded meaning differed.

---

## H2 — `platform.aws.ipFamily` → **`docs-only-not-supported`** (Technology Preview is not normal supported UI)

| | |
|---|---|
| **Mechanical** | `pkg/types/aws/platform.go` `Platform.IPFamily`, same enum. Gate `AWSDualStackInstall` fires only on `DualStackEnabled()`, so `IPv4` is ungated — but `IPv4` is the only non-dual-stack value, making the field a no-op without the gate. |
| **Binary** | `platform.aws.ipFamily: DualStackIPv4Primary` → `Forbidden: this field is protected by the AWSDualStackInstall feature gate`, plus *"when installing dual-stack IPv4/IPv6 you must provide two service networks"*. `IPv4` accepted. |
| **Documentation** | 4.22 release notes §1.9.5: *"Installing a cluster on Amazon Web Services (AWS) with dual-stack networking"* — **Technology Preview in 4.22**, Not Available at 4.20/4.21. The table says *AWS*; it does not address GovCloud. |
| **Disposition** | `docs-only-not-supported`, `minVersion: 4.22`, `introducedInMinor: 4.22`, no UI surface. |

Unlike H1 there **is** a same-minor citation, and it says Technology Preview — which is a
documented not-supported-for-GA status, exactly what `docs-only-not-supported` means.

### Technology Preview is explicitly NOT normal supported UI

Red Hat states that Technology Preview features are **not supported with Red Hat
production service level agreements**, are **not recommended for production**, and may
be functionally incomplete. The product requirement is to expose Red Hat-**supported**
choices by default.

Therefore, and stated unambiguously so Tranche 2 cannot read this as a soft preference:

| | |
|---|---|
| ❌ | The dual-stack values `DualStackIPv4Primary` / `DualStackIPv6Primary` are **NOT** `supported-ui` and **MUST NOT** appear in the normal UI. |
| ❌ | No Tech Preview value is offered by default, on any platform, for any minor. |
| ✅ | `supportStatus: docs-only-not-supported` for the `ipFamily` row, with the Technology Preview citation attached. |
| ✅ | The installer mechanical evidence, the exact documented enum values and the gate name are all preserved in the row for provenance. |
| 🔒 | A Technology Preview opt-in UX requires **explicit human approval** and is out of scope for Tranche 2. Absent that approval, the correct behaviour is to omit the field entirely from generated output. |

The same rule governs every other Tech Preview capability found in this onboarding —
`osImageStream` (C2) and AWS Dedicated Hosts (C3) — so the taxonomy stays consistent:
**documented Technology Preview ⇒ `docs-only-not-supported`, never `supported-ui`.**

**Catalog note to record, so the row does not overclaim:** Architect models
`aws-govcloud-{ipi,upi}`. Commercial-cloud Technology Preview status is not automatically
a government-cloud status, and no GovCloud-specific evidence was found either way. The
disposition is unaffected because TP is not exposed regardless.

**Unchanged by this correction:** the `lbType` conditional-default behaviour in H3. It
depends on `ipFamily`, and because `ipFamily` is never emitted, Architect always lands in
the `Classic` branch — which is exactly what H3 records.

---

## H3 — `platform.aws.lbType` conditional default → **`supported-ui`, with the condition recorded, not flattened**

| | |
|---|---|
| **Mechanical** | 4.22 adds `+kubebuilder:validation:Enum="Classic";"NLB"` (absent at 4.21) and changes the documented default from unconditional `Classic` to conditional on `ipFamily`. |
| **Binary** | **The enum marker is NOT enforced by `openshift-install`.** `lbType: Bogus` passed install-config validation. Kubebuilder markers generate CRD/API validation; the installer's own validator does not apply them. |
| **Disposition** | Keep `supported-ui`. Do **not** record a bare unconditional default. |

Verbatim 4.22 source, for the record:

> "If this field is not set explicitly, the default value depends on the ipFamily field:
> `Classic` when ipFamily is not set or set to `IPv4`; `NLB` when ipFamily is set to
> `DualStackIPv4Primary` or `DualStackIPv6Primary`."

**Exact values for the 4.22 row:**

```jsonc
{
  "path": "platform.aws.lbType",
  "default": "Classic (conditional — see versionNotes)",
  "versionNotes": "4.22: the default is conditional on platform.aws.ipFamily — Classic when ipFamily is unset or IPv4, NLB when DualStackIPv4Primary or DualStackIPv6Primary. Architect does not expose ipFamily (hidden/docs-only at 4.22), so the effective default is always Classic.",
  "supportStatus": "supported-ui"
}
```

This satisfies the instruction to prefer an explicit authoritative note over pretending
there is one unconditional default. `versionNotes` is the documented field for exactly
this (*"Default changed from 100 to 120 in 4.21"*), so no schema change is needed.

**Two things Tranche 2 must not do:**

1. **Do not add UI validation citing the new enum as installer-enforced.** It is not
   (binary-verified). Constraining the UI to `Classic`/`NLB` is defensible on product
   grounds; claiming the installer rejects other values is not.
2. **Do not copy 4.21's `allowed` list verbatim.** It is `["Classic", "NLB", "nlb"]`. The
   4.22 enum declares `Classic` and `NLB` only; lowercase `nlb` is not in it. Whether
   4.20/4.21 should also drop `nlb` is a separate same-minor question and is **out of
   scope here** (R9) — recorded in the findings queue.

**Behaviour impact: none.** `ipFamily` is not exposed, so Architect always lands in the
`Classic` branch.

---

## H4 — `bootstrapOSImage` / `clusterOSImage` → **keep the docs-backed status; `deprecated: false`**

| | |
|---|---|
| **Mechanical (installer only)** | Newly deprecated at 4.22.16. Go symbols renamed `BootstrapOSImage`→`DeprecatedBootstrapOSImage` and `ClusterOSImage`→`DeprecatedClusterOSImage`; JSON tags unchanged. Markers: *"This is no longer used."* and *"This is no longer required, the OS image is now part of the OpenShift release."* 4.22 also logs `"<field> is no longer required"` at info level when either is set. |
| **Binary** | Both still **accepted** by `openshift-install` 4.22.16. |
| **Red Hat product documentation** | The 4.22 release notes *Installation → Deprecated features* table does **not** list either field. (It lists `--cloud`, CoreDNS wildcard queries, RHOSP `rootVolume.type`, singular `ingressVIP`/`apiVIP`, `preserveBootstrapIgnition`, AWS Outposts, kvc, Fujitsu iRMC.) |

### `supportStatus` is NOT a container for installer-only evidence

An earlier revision proposed `supportStatus: deprecated-supported` on the strength of the
installer marker alone. **That is withdrawn.** `supportStatus` records the **Red Hat
product support disposition**, which is documentation-governed (runbook Rule 2.4). An
installer-source `Deprecated:` marker is *mechanical* evidence; it is not a Red Hat
product deprecation and must not be laundered into the support vocabulary.

Red Hat 4.22 documentation does not establish these fields as deprecated, so:

```jsonc
{
  // The normal docs-backed product support disposition — UNCHANGED from 4.20/4.21.
  "supportStatus": "supported-backend-only",   // platform.baremetal.bootstrapOSImage
  // "supportStatus": "supported-ui",          // platform.baremetal.clusterOSImage

  "deprecated": false,                          // no badge: docs do not support that presentation

  // Mechanical provenance only. NOT a product support claim.
  "versionNotes": "Installer source marks this Deprecated: at 4.22 (symbol DeprecatedClusterOSImage, pkg/types/baremetal/platform.go) with the note that the OS image is now part of the OpenShift release; openshift-install 4.22.16 still accepts the field and 4.22 logs an informational 'no longer required' message when it is set. Red Hat 4.22 product documentation does NOT list this field as deprecated, so no user-facing deprecation is asserted."
  // plus an installer-source citation, per the 0B convention
}
```

| Field | Value | Why |
|---|---|---|
| `supportStatus` | the existing docs-backed value, unchanged | docs govern support disposition |
| `deprecated` | **`false`** | documented as *"Shows orange 'Deprecated' badge in UI"*; docs do not support that presentation |
| `deprecatedReason` | **unset** | only meaningful alongside a badge |
| `replacementPath` | **unset** | the stated replacement is the absence of a field, not a field |
| `removalVersion` | **unset** | no Red Hat source states one; inventing it would be a guess |
| `versionNotes` | installer-marker text, explicitly labelled as installer-source | mechanical provenance, kept out of the support vocabulary |

### Instruction to Tranche 2, so the two kinds of deprecation cannot be confused

> **Installer-source `Deprecated:` ≠ Red Hat product deprecation.**
>
> A `Deprecated:` marker in `openshift/installer` is mechanical evidence about the
> installer's own Go API. It justifies a `versionNotes` entry and an installer-source
> citation, and **nothing else**.
>
> Changing `supportStatus`, or setting `deprecated: true`, requires the field to be
> listed as deprecated in **that minor's own Red Hat product documentation**. If it is
> not listed, the row keeps its existing docs-backed status and shows no badge.
>
> This applies to every future minor, not just 4.22.

`deprecated-supported` therefore remains **unused** (count: 0) and is not introduced by
this onboarding. If Red Hat later documents these fields as deprecated, that is when the
status changes and the badge turns on — and `DOC-167`'s Azure-subnet question is the
same shape, so both should be settled by the same rule.

## Summary

| Item | Disposition | Badge / UI | Blocks Tranche 2 |
|---|---|---|---|
| H1 `platform.azure.ipFamily` | `hidden-not-applicable` | none | no — resolved |
| H2 `platform.aws.ipFamily` | `docs-only-not-supported` — **Tech Preview is never normal supported UI** | none | no — resolved |
| H3 `platform.aws.lbType` | `supported-ui` + `versionNotes` conditional default | visible, unchanged | no — resolved |
| H4 `bootstrapOSImage`/`clusterOSImage` | **unchanged docs-backed status**, `deprecated: false`, installer marker in `versionNotes` | visible, no badge | no — resolved |

All four are now deterministic. **No schema change is required for any of them.**
