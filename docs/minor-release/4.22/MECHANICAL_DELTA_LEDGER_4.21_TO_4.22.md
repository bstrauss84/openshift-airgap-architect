# Mechanical Delta Ledger — exact 4.21.35 → exact 4.22.16

> **Tranche 1 deliverable 2 of 10.** Mechanical findings only. **No supportability conclusion
> is drawn here** — installer presence never authorizes `supported-ui` (runbook Rule 2.4).
> Supportability is in [`SUPPORTABILITY_CLASSIFICATION_4.22.md`](SUPPORTABILITY_CLASSIFICATION_4.22.md).
> Machine-readable: [`mechanical-delta-4.21-to-4.22.json`](mechanical-delta-4.21-to-4.22.json).

**Basis:** exact released source for **both** minors.
4.21.35 @ `006669f5812a47dbc733b6736584b87ef696e898` → 4.22.16 @ `92820966521d640aa5f0edfb69bcfd9c168c2210`.
Neither `release-4.21` nor `release-4.22` branch tip was used.

---

## 1. Totals

| Surface | 4.21.35 | 4.22.16 |
|---|---|---|
| install-config parameter paths | 1,104 | **1,127** |
| agent-config parameter paths | 21 | **21** |

| Delta class | Count |
|---|---|
| parameter/path additions | **23** |
| removals | **0** |
| moves/renames (YAML path) | **0** |
| Go symbol renames (JSON tag unchanged) | **2** |
| type changes | **0** |
| requiredness (`omitempty`) changes | **0** |
| object/array structure changes | **0** |
| enum / allowed-value changes | **1** |
| default changes | **1** (documented default, conditional — see §5) |
| validation-rule changes | **5** (§6) |
| `+optional` marker additions | **8** |
| new deprecation markers | **2** |
| conditional relationships (new feature gates) | **6** |
| **agent-config deltas of any class** | **0** |

The agent-config zero is a real negative result, independently reproducing the
Revision-3 prediction, and it is load-bearing for DOC-165: the agent-config surface did
not move at all between these two exact releases.

## 2. Additions (23)

They collapse to **six distinct capabilities**; the count is inflated because machine-pool
fields appear once each under `controlPlane`, `compute[]`, `arbiter` and
`platform.aws.defaultMachinePlatform`.

| # | Capability | Paths | Source (4.22.16) | Candidate owner |
|---|---|---|---|---|
| A1 | `osImageStream` | 1 | `pkg/types/installconfig.go` `InstallConfig.OSImageStream` | ALL in-scope scenarios |
| A2 | `platform.baremetal.provisioningNetworkGateway` | 1 | `pkg/types/baremetal/platform.go` `Platform.ProvisioningNetworkGateway` | `bare-metal-ipi`, `bare-metal-agent` |
| A3 | `platform.aws.ipFamily` | 1 | `pkg/types/aws/platform.go` `Platform.IPFamily` | `aws-govcloud-ipi`, `aws-govcloud-upi` |
| A4 | `platform.azure.ipFamily` | 1 | `pkg/types/azure/platform.go` `Platform.IPFamily` | `azure-government-ipi`, `azure-government-upi` |
| A5 | `*.platform.aws.hostPlacement{,.affinity,.dedicatedHost[],.dedicatedHost[].id}` | 16 | `pkg/types/aws/machinepool.go` `MachinePool.HostPlacement`, `HostPlacement`, `DedicatedHost` | AWS GovCloud scenarios |
| A6 | `{controlPlane,compute[],arbiter}.management` | 3 | `pkg/types/machinepools.go` `MachinePool.Management` | ALL in-scope scenarios |

New supporting type package: `pkg/types/network/ipfamily.go` (`network.IPFamily`).
New file `pkg/types/azure/network.go`.

### Allowed values, with the evidence class recorded

| Path | Values | Evidence |
|---|---|---|
| `osImageStream` | `rhel-9`, `rhel-10` | `+kubebuilder:validation:Enum` on the type |
| `platform.{aws,azure}.ipFamily` | `IPv4`, `DualStackIPv4Primary`, `DualStackIPv6Primary` | `+kubebuilder:validation:Enum` |
| `*.hostPlacement.affinity` | `DedicatedHost`, `AnyAvailable` | `+kubebuilder:validation:Enum` |
| `*.management` | `ClusterAPI`, `MachineAPI` (`+kubebuilder:default=ClusterAPI`) | `+kubebuilder:validation:Enum` |
| `platform.baremetal.provisioningNetworkGateway` | free IP string, `+kubebuilder:validation:Format=ip` | marker + validation function |

> The extractor records `enumSource` per row (`kubebuilder-enum-marker` vs
> `typed-constants`) rather than presenting both as equivalent, because
> §7 shows the two are not interchangeable.

## 3. Removals, moves, renames

**No path was removed and no path moved.** Two Go symbols were renamed while their JSON
tags stayed identical — the installer's standard way of marking a field deprecated:

| YAML path (unchanged) | 4.21.35 symbol | 4.22.16 symbol |
|---|---|---|
| `platform.baremetal.bootstrapOSImage` | `Platform.BootstrapOSImage` | `Platform.DeprecatedBootstrapOSImage` |
| `platform.baremetal.clusterOSImage` | `Platform.ClusterOSImage` | `Platform.DeprecatedClusterOSImage` |

A rename of this kind is invisible to a JSON-tag-only comparison. It surfaced here only
because the extractor records `struct`/`field` provenance per path.

## 4. New deprecations (2)

| Path | `Deprecated:` note, verbatim | File |
|---|---|---|
| `platform.baremetal.bootstrapOSImage` | `This is no longer used.` | `pkg/types/baremetal/platform.go` |
| `platform.baremetal.clusterOSImage` | `This is no longer required, the OS image is now part of the OpenShift release.` | `pkg/types/baremetal/platform.go` |

Both remain **accepted** by the 4.22.16 binary (§7) — they are P1 "mark", not P0 "remove",
under the runbook's two-tier deprecation strategy. 4.22 additionally logs
`"<field> is no longer required"` at info level when either is set.

These two were found **only** through description-change detection, which is the exact
capability harvest finding **F1** had left structurally dead. Had the producer/consumer
field contract still been broken, this ledger would have reported `changed: 0` and both
deprecations would have shipped into a 4.22 catalog unnoticed.

## 5. Enum and default changes

**`platform.aws.lbType`** gained `+kubebuilder:validation:Enum="Classic";"NLB"` at 4.22
(absent at 4.21). Its documented default also became **conditional**:

> 4.21: *"If this field is not set explicitly, it defaults to `Classic`."*
> 4.22: *"If this field is not set explicitly, the default value depends on the ipFamily field:
> `Classic` when ipFamily is not set or set to `IPv4`; `NLB` when ipFamily is set to
> `DualStackIPv4Primary` or `DualStackIPv6Primary`."*

This is a genuine conditional relationship between two parameters, one of which (A3) is
new. **But see §7** — the enum marker is not enforced by `openshift-install`.

**No real enum change** exists for `platform.gcp.firewallRulesManagement`; an early pass of
this ledger reported one and it was a parser defect, now fixed and regression-tested (§8).

## 6. Validation-rule changes

| # | Rule | Location (4.22.16) |
|---|---|---|
| V1 | `provisioningNetworkGateway` must be a valid IP | `pkg/types/baremetal/validation/platform.go` |
| V2 | `provisioningNetworkGateway` must not overlap the allocated DHCP range | same — **but does not fire; see §7** |
| V3 | `validateOSImageStream`: forbidden on SCOS; value must be `rhel-9`/`rhel-10` | `pkg/types/validation/installconfig.go` |
| V4 | `validateMirrorCredentials`: mirrors absent from `pullSecret.auths` are reported — **`logrus.Warnf` only, returns an empty error list** | `pkg/types/validation/installconfig.go` |
| V5 | Azure cluster name reserved-word check (`validate.AzureClusterName`) | `pkg/types/validation/installconfig.go` |
| V6 | New IPv4 network/broadcast-address helper `isNetworkOrBroadcastAddress` | `pkg/types/baremetal/validation/platform.go` |

V4 matters to Architect's disconnected workflow and is easy to over-read: it is a
**warning**, not a rejection. Recorded as such.

### Feature-gate dependency changes

| Field | Gate | Enabled in (from vendored `openshift/api` `features.go`) |
|---|---|---|
| `osImageStream` | `OSStreams` | TechPreviewNoUpgrade, DevPreviewNoUpgrade — **not Default** |
| `platform.aws.ipFamily` (dual-stack values only) | `AWSDualStackInstall` | TechPreviewNoUpgrade, DevPreviewNoUpgrade |
| `platform.azure.ipFamily` (dual-stack values only) | `AzureDualStackInstall` | TechPreviewNoUpgrade, DevPreviewNoUpgrade |
| `compute[].platform.aws.hostPlacement` | `AWSDedicatedHosts` | TechPreviewNoUpgrade, DevPreviewNoUpgrade |
| `{controlPlane,compute}.management` = `ClusterAPI` | `ClusterAPIControlPlaneInstall` / `ClusterAPIComputeInstall` | **DevPreviewNoUpgrade only** |
| `platform.baremetal.provisioningNetworkGateway` | **none** | always available |

**Gate removed in 4.22:** `HighlyAvailableArbiter`. At 4.21.35 arbiter validation was
wrapped in a gate check that emitted `field.Forbidden` when the gate was off; at 4.22.16
`validateArbiter` runs unconditionally and the gate no longer exists in
`openshift/api`. Arbiter has graduated.

Gating moved file: `pkg/types/defaults/validation/featuregates.go` →
`pkg/types/validation/featuregates.go`, and `GatedFeatures` →
`validateMachinePoolFeatureGates`. Internal refactor; no behavioural delta beyond the rows
above.

## 7. Exact-binary verification

Run against the exact released `openshift-install` 4.22.16
(`62b3a91ca3f242dd6feec1aefec8f5f5e7af4e13982f65600eb84fc56ca71a33`) via
`create manifests` on real install-config fixtures. Evidence retained under
`/home/bistraus/oaa-v2.1-evidence/ocp-4.22/analysis/binary-probe/run.sn8Vxn/`.

| Probe | Binary verdict |
|---|---|
| `osImageStream: rhel-9` / `rhel-10`, no feature set | **Rejected** — `Forbidden: this field is protected by the OSStreams feature gate` |
| `osImageStream: rhel-11` | **Rejected** twice — gate **and** `Unsupported OS Image Stream. Supported values are: rhel-9, rhel-10` |
| `controlPlane.management: ClusterAPI` | **Rejected** — `ClusterAPIControlPlaneInstall feature gate` |
| `compute[0].platform.aws.hostPlacement` | **Rejected** — `AWSDedicatedHosts feature gate` |
| `platform.aws.ipFamily: DualStackIPv4Primary` | **Rejected** — `AWSDualStackInstall feature gate`, plus "you must provide two service networks" |
| `platform.aws.ipFamily: IPv4` | **Accepted** |
| `platform.baremetal.provisioningNetworkGateway: 172.22.0.254` (Managed) | **Accepted** |
| `provisioningNetworkGateway: not-an-ip` | **Rejected** — `"not-an-ip" is not a valid IP` |
| `provisioningNetworkGateway` with `provisioningNetwork: Disabled` | **Accepted** (ignored, matching the doc comment) |
| `bootstrapOSImage` (newly deprecated) | **Accepted** |

### Two source/binary discrepancies, recorded rather than resolved

**D1 — the DHCP-overlap rule (V2) does not fire.** `provisioningNetworkGateway: 172.22.0.50`
inside an allocated range of `172.22.0.10,172.22.0.100` was **accepted**. A control probe
shows the pre-existing `clusterProvisioningIP` check — same code shape, present since
before 4.22 — also does not fire for the same input. So this is the **shared mechanism**,
not something specific to the new field, and not a 4.22 regression.
*Hypothesis, not proven:* `net.ParseIP` returns the 16-byte IPv4-in-IPv6 form while the
range bounds are 4-byte, so `bytes.Compare` never reports containment. Labelled a
hypothesis because it was not isolated in a debugger. **Binary behaviour is the
mechanical truth**: the rule is inert.

**D2 — the `lbType` enum marker is not enforced by the installer.** `platform.aws.lbType:
Bogus` passed install-config validation despite the new
`+kubebuilder:validation:Enum="Classic";"NLB"`. Kubebuilder markers generate CRD/API
validation; they are not applied by `openshift-install`'s own install-config validator.
Consequence for Tranche 2: a `kubebuilder` enum is good evidence of the *intended* value
set but **must not** be recorded as installer-enforced validation.

## 8. Extractor defect found and fixed during this tranche

The first run of this ledger reported an enum change adding `"sovereign"` to
`platform.gcp.firewallRulesManagement`. It was false. In
`pkg/types/gcp/platform.go` the untyped constant `CloudEnvironmentSovereign = "sovereign"`
shares a `const (…)` block with the two `FirewallRulesManagementPolicy` constants, and the
collector was carrying the preceding line's type forward. Go does not do that — a type
only carries forward by *implicit repetition*, a line with no `=` expression.

Fixed in `scripts/minor/extract/go-struct-parser.js`, with a named regression test
(`an untyped constant sharing a const block is not attributed to the typed one`) whose
fixture reproduces the exact shape. The same block in `pkg/types/installconfig.go` would
have mis-attributed `OSStreamLabelKey` to `OSImageStream`.

Worth stating plainly: this defect produced a **plausible-looking** false finding about a
real parameter. It is the same failure mode as harvest finding F1 — a pipeline that
appears to work and is quietly wrong — and it was caught only by checking the finding
against source instead of trusting the tool.

## 9. Still open

Honest limits of this pass, carried into Tranche 2 rather than papered over:

- **Runtime defaults** in `pkg/asset/installconfig/**` are not covered; struct tags cannot
  show them. `pkg/types/defaults/installconfig.go` changed only to add PowerVC defaulting
  (out of scope).
- **Conditional requiredness** inside the per-platform `validation` packages was read for
  the changed files only, not exhaustively.
- `platform.gcp.*`, `powervc`, `powervs`, `openstack`, `ovirt`, `external`, `none` deltas
  were extracted but are **out of Architect's platform scope** and were not classified.
- The 16 AWS `hostPlacement` rows are 4 distinct fields × 4 machine-pool mount points;
  Tranche 2 should decide whether the catalog models all four mount points.
