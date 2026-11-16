# NMState / networkConfig coverage audit — Day-1 installation surfaces

> **Tranche 7A.1 deliverable.** Audit and design only. **No production code is changed
> by this document.** Baseline `85d93fddc2e0b8a2c4986f381d9205bd0597de26`.
>
> ## OUTCOME — Tranche 7A.1: RED. Tranche 7B: **CLOSED**.
>
> **7A.1 found a release blocker.** OAA emitted SR-IOV as a top-level
> `interfaces[].sriov` key. Both upstream NMState and Red Hat's own Agent-based
> Installer documentation define it as `interfaces[].ethernet.sr-iov`. NMState's
> deserializer is strict, so this did not merely lose the setting — it
> **invalidated the entire host `networkConfig`**. A visible UI checkbox reached it,
> and a backend test pinned the wrong shape, which is why it survived.
>
> **7B corrected it** (§6.1 and §14). The emission now nests under `ethernet.sr-iov`,
> the test that pinned the defect is fixed, and a **structural guard** now rejects any
> generated NMState key outside a schema-derived allow-list — the control whose absence
> let this ship. The current-UI safety sweep (§15) found **no second structural
> defect**.

---

---

## 1. Four networking domains, deliberately not conflated

Every evidence record below states which domain it proves. These share an underlying
schema lineage but are **not interchangeable support surfaces**.

| ID | Domain | Where it lives | OAA generates it? |
|---|---|---|---|
| **A** | **Day-1 Agent NMState** | `agent-config.yaml` → `hosts[].networkConfig` | **Yes** — `buildNmState()`, the full-featured generator |
| **B** | **Day-1 bare-metal IPI NMState** | `install-config.yaml` → `platform.baremetal.hosts[].networkConfig` | **Yes** — a separate, far smaller inline builder |
| **C** | **Post-install Kubernetes NMState** | `NodeNetworkConfigurationPolicy` → `spec.desiredState` | **No** — out of scope for OAA |
| **D** | **Secondary-network Bond CNI** | CNI plugin config, property `xmitHashPolicy` (camelCase) | **No** — out of scope |

Two consequences that matter for this audit:

- **A and B are different implementations in this codebase**, not one generator with two
  callers. B supports only a single ethernet interface with an IPv4 address, DNS and a
  default route — **no bond, no VLAN, no IPv6, no MTU, no SR-IOV, no VRF**. Any claim
  about "OAA's NMState support" is really a claim about domain A.
- **Domain C is the best-documented**, and it is tempting to read its statements as
  product-wide. It is used below only where explicitly labelled, and never as proof of
  Day-1 applicability on its own.
- **Domain D is a different schema entirely.** `xmitHashPolicy` (Bond CNI) and
  `xmit_hash_policy` (NMState/Linux bonding) are not the same property and must never
  be cited for one another.

---

## 2. Authorities used

| Authority | Domain it proves | Used for |
|---|---|---|
| [NMState YAML API](https://nmstate.io/devel/yaml_api.html) | upstream schema (not OpenShift support) | Structural validity of every emitted key; the complete bond-option list; interface families |
| OCP 4.22 *Agent-based Installer* book | **A** | Day-1 applicability; which fields Red Hat documents by example |
| OCP 4.22 *Kubernetes NMState* §1.9.4 | **C** | OpenShift's supported bond-mode statement, verbatim |
| OCP 4.22 *installing on bare metal* | **B** | Bare-metal IPI host networkConfig |
| Committed Tranche 1 research (`DOC165_GENERATED_CONFIG_COVERAGE_4.22.md`) | **A** | Prior authoritative same-minor pass; reused rather than re-derived |

**Upstream NMState capability is not OpenShift support, and OpenShift support in domain
C is not automatically Day-1 applicability in domain A.** That ordering is applied
throughout.

---

## 3. What OAA actually emits — measured, not assumed

Generated with every supported feature enabled, then every key path extracted from the
parsed output. **26 distinct leaf paths across 8 families.**

| Family | Emitted paths | Schema verdict |
|---|---|---|
| Interface core | `name`, `type`, `state`, `mtu` | ✅ valid |
| IPv4 | `enabled`, `dhcp`, `address[].ip`, `address[].prefix-length` | ✅ valid |
| IPv6 | `enabled`, `dhcp`, `address[].ip`, `address[].prefix-length` | ✅ valid |
| Bond | `link-aggregation.mode`, `.options.miimon`, `.port` | ✅ valid |
| VLAN | `vlan.base-iface`, `vlan.id` | ✅ valid |
| VRF | `vrf.port`, `vrf.route-table-id` | ✅ valid |
| Routes | `routes.config[].destination`, `.next-hop-address`, `.next-hop-interface`, `.table-id` | ✅ valid |
| DNS | `dns-resolver.config.server`, `.search` | ✅ valid |
| **SR-IOV** | **`interfaces[].sriov.total-vfs`** | ❌ **INVALID — see §6** |

**25 of 26 paths are schema-valid.** Exactly one is not.

`mac-address` is deliberately **not** in `networkConfig`: OAA writes MAC addresses to
`hosts[].interfaces[].macAddress`, the agent-config host-identification block. That is
correct and is not a gap.

---

## 4. Coverage ledger

Legend — **OAA**: `UI` user-editable · `GEN` generated from state, not user-editable ·
`—` absent. **Disposition** uses the project's `supportStatus` vocabulary.

### 4.1 Interface core

| NMState path | Domain | 4.20 / 4.21 / 4.22 evidence | OAA | UI | Valid. | Gen | Imp/Exp | Tests | Help | Disposition |
|---|---|---|---|---|---|---|---|---|---|---|
| `interfaces[].name` | A, B | documented by example, all 3 | UI | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | `supported-ui` |
| `interfaces[].type` | A, B | all 3 | GEN | derived | ✅ | ✅ | ✅ | ✅ | ✅ | `supported-derived` |
| `interfaces[].state` | A, B | all 3 | GEN (always `up`) | — | — | ✅ | n/a | ✅ | — | `supported-derived` |
| `interfaces[].mtu` | A | by example §1.8, all 3 | UI | ✅ | — | ✅ | ✅ | ✅ | ✅ | `supported-ui` |
| `interfaces[].mac-address` | A | by example §1.9 | — (host block instead) | — | — | — | — | — | — | `hidden-not-applicable` — OAA identifies NICs via `hosts[].interfaces[].macAddress` |
| `identifier`, `description`, `profile-name`, `copy-mac-from`, `accept-all-mac-addresses`, `pci-address`, `controller`, `wait-ip`, `min-mtu`, `max-mtu` | upstream only | no Red Hat Day-1 evidence | — | — | — | — | — | — | — | `unknown-needs-review` — upstream capability, no OpenShift Day-1 authority |

### 4.2 IPv4 / IPv6

| NMState path | Domain | Evidence | OAA | Disposition |
|---|---|---|---|---|
| `ipv4.enabled` / `ipv6.enabled` | A, B | all 3 | GEN from IP-stack mode | `supported-derived` |
| `ipv4.dhcp` / `ipv6.dhcp` | A | all 3 | GEN from static/DHCP choice | `supported-derived` |
| `ipv4.address[].ip` / `.prefix-length` | A, B | all 3 | UI (CIDR, split on generation) | `supported-ui` |
| `ipv6.address[].ip` / `.prefix-length` | A | all 3 | UI | `supported-ui` |
| `ipv6.autoconf` | upstream; no Day-1 example | all 3 (absent) | — | `unknown-needs-review` — relevant to real SLAAC deployments |
| `auto-dns`, `auto-gateway`, `auto-routes`, `auto-route-table-id` | upstream only | — | — | `unknown-needs-review` |
| `dhcp-client-id`, `dhcp-duid`, `addr-gen-mode` | upstream only | — | — | `unknown-needs-review` |

> **Note on domain B:** the bare-metal IPI builder emits `ipv4.enabled` + `address` but
> never `ipv6` and never `dhcp`. IPv6-only or dual-stack bare-metal IPI hosts cannot be
> expressed. Classified `hidden-not-applicable` for B today; see the umbrella item.

### 4.3 Bond — see §5 for the mode-aware matrix

| NMState path | Domain | Evidence | OAA | Disposition |
|---|---|---|---|---|
| `link-aggregation.mode` | A (example), C (support statement) | `802.3ad` + `active-backup` documented at 4.22 | UI, 2 values | `supported-ui` (partial — see §5.1) |
| `link-aggregation.port` | A | all 3 | UI (`bond.slaves[]` → `port`) | `supported-ui` |
| `link-aggregation.options.miimon` | A (4.21 example), C (`'140'` example) | present | **GEN, hardcoded `"100"`, hidden** | `supported-backend-only` — **must become explicit**, see §5.2 |
| `.options.xmit_hash_policy` | upstream; **verified absent** from 4.22 Agent book | — | — | `unknown-needs-review` → candidate `supported-ui` |
| `.options.lacp_rate` | upstream; absent from 4.22 Agent book | — | — | `unknown-needs-review` |
| `.options.min_links` | upstream; absent from 4.22 Agent book | — | — | `unknown-needs-review` |
| `.options.primary` | A — **documented by example** §1.9 | present | — | `unknown-needs-review` → strongest `supported-ui` candidate |
| `.options.updelay` / `.downdelay` | upstream only | — | — | `unknown-needs-review` |
| 20 further upstream options (`ad_select`, `arp_interval`, `arp_ip_target`, `arp_validate`, `fail_over_mac`, `primary_reselect`, `use_carrier`, `lacp_active`, …) | upstream only | — | — | `unknown-needs-review` — accounted for, not proposed |

### 4.4 VLAN, VRF, routes, DNS

| NMState path | Domain | Evidence | OAA | Disposition |
|---|---|---|---|---|
| `vlan.base-iface`, `vlan.id` | A | by example §1.8, all 3 | UI | `supported-ui` |
| `vlan.protocol` | upstream (`802.1q`/`802.1ad`) | no Day-1 example | — | `unknown-needs-review` — QinQ unreachable |
| `vrf.port`, `vrf.route-table-id` | upstream | **no Red Hat Day-1 evidence found** | UI | ⚠️ `supported-ui` **with no documented authority** — see §6.2 |
| `routes.config[].destination`, `.next-hop-address`, `.next-hop-interface` | A | by example §1.9 | UI + GEN default route | `supported-ui` |
| `routes.config[].table-id` | A | by example §1.9 | GEN (always `254`) | `supported-derived` |
| `routes.config[].metric` | upstream | no Day-1 example | — | `unknown-needs-review` |
| `route-rules` | upstream; **verified absent** from 4.22 Agent book | — | — | `docs-only-not-supported` |
| `dns-resolver.config.server`, `.search` | A | by example §1.8/1.9 | UI | `supported-ui` |

### 4.5 Interface families not implemented

| Family | Upstream | Red Hat Day-1 evidence | OAA | Disposition |
|---|---|---|---|---|
| Ethernet SR-IOV (`ethernet.sr-iov.total-vfs`, `.vfs[]`) | ✅ | ✅ **documented by example §1.9** | ❌ **emits an invalid key** | **BLOCKER — §6.1** |
| `min-tx-rate` / `max-tx-rate` | ✅ | example only (bond over VFs) | — | `unknown-needs-review` |
| Linux bridge | ✅ | none for Day-1 | — | `unknown-needs-review` |
| OVS bridge / OVS interface | ✅ | none for Day-1 | — | `hidden-not-applicable` — OVN-Kubernetes manages the cluster network |
| VXLAN, MACVLAN, MACVTAP, InfiniBand, veth, dummy, loopback, IPsec, MPTCP | ✅ | none for Day-1 | — | `unknown-needs-review` (InfiniBand plausibly relevant; the rest unlikely for Day-1) |

### 4.6 Totals

| Measure | Count |
|---|---|
| Distinct paths/families accounted for | **64** |
| Emitted by OAA today | 26 |
| Schema-valid of those | **25** |
| **Schema-invalid** | **1** (SR-IOV) |
| `supported-ui` | 13 |
| `supported-derived` | 7 |
| `supported-backend-only` (hidden) | 1 (`miimon`) |
| `hidden-not-applicable` | 3 |
| `docs-only-not-supported` | 1 |
| `unknown-needs-review` | **39** |

**Nothing is unaccounted for.** The 39 `unknown-needs-review` entries are the real
output of this audit: previously they were simply absent from any ledger.

### 4.7 Cross-minor differences

**None.** Every catalog row, every generator branch and every UI control in this surface
is identical at 4.20, 4.21 and 4.22. The 4.22 onboarding introduced no NMState change —
consistent with the committed delta ledger recording **zero agent-config deltas**
between 4.21.35 and 4.22.16. The only documented difference is editorial: the 4.22 Agent
book's bond example uses `802.3ad` where 4.21's used `active-backup` + `miimon`.

---

## 5. Bond specifics

### 5.1 Bond modes — one supported mode is missing

OpenShift 4.22 *Kubernetes NMState* §1.9.4, verbatim (**domain C**):

> "OpenShift Container Platform only supports the following bond modes:
> `active-backup`, `balance-xor`, `802.3ad`. Other bond modes are not supported."

| Mode | OpenShift (C) | 4.22 Agent book (A) | OAA offers |
|---|---|---|---|
| `active-backup` | ✅ supported | ✅ by example | ✅ |
| `802.3ad` | ✅ supported | ✅ by example | ✅ |
| **`balance-xor`** | ✅ **supported** | not in example | ❌ **missing** |
| `balance-rr`, `broadcast`, `balance-tlb`, `balance-alb` | ❌ not supported | — | ❌ correctly absent |

**Disposition: backlog-worthy supported capability — NOT release-blocking.** OAA makes
no claim of complete bond-mode coverage: the dropdown offers two values and the help
text says "Bond (LACP or active-backup)". Nothing advertises `balance-xor`. The four
genuinely unsupported modes are correctly absent, so the dropdown is a *subset* of
supported, never a superset.

> Wording defect, non-blocking: the catalog description for `link-aggregation.mode`
> reads *"e.g. balance-rr, active-backup"* — citing a mode OpenShift does **not**
> support while omitting `802.3ad`, which OAA does offer. Already captured in DOC-188.

### 5.2 `miimon` — the hidden hardcode

`backend/src/generate.js` `addBond()` emits `options: { miimon: "100" }`
**unconditionally**, and discards any `bond.options` present in state.

| Question | Answer |
|---|---|
| Why `100`? | **No recorded rationale.** Present since the initial public release. 100 ms is the conventional Linux bonding default and matches common vendor guidance; Red Hat's own NNCP example uses `'140'`. |
| Documented anywhere in OAA? | **No** — not in the UI, not in help text, not in the Field Guide, not in any catalog row. |
| Safe across both offered modes? | **Yes.** `miimon` is mode-agnostic MII link monitoring, valid for `active-backup` and `802.3ad` alike. It is not wrong, merely fixed and invisible. |
| Tested? | **No test asserts it.** Changing or losing it today would be silent. |
| Type correct? | Yes — emitted as the string `"100"`, matching Red Hat's quoted `'140'`. |

**Disposition: `supported-backend-only`, must become explicit.** Recommended end state:
a user-editable field defaulting to 100 with the default visible in help text, so the
value stops being an accident. Omitting it entirely to inherit kernel defaults is *not*
recommended — link monitoring off by default would be a functional regression for
existing users.

**The hardcode is also the thing that makes any future option work dangerous:** it must
become state-driven in the same change, or the UI will accept values the generator
overwrites.

### 5.3 Per-option product matrix

| Option | Type | Valid values | Applicable modes | Default | Companion requirements | Switch-side | Disposition |
|---|---|---|---|---|---|---|---|
| `miimon` | string (ms) | positive integer | all | OAA forces `"100"` | pairs with `updelay`/`downdelay` | none | `supported-backend-only` → make editable |
| `xmit_hash_policy` | string | `layer2`, `layer2+3`, `layer3+4`, `encap2+3`, `encap3+4`, `vlan+srcmac` | **`balance-xor`, `802.3ad`** only | kernel `layer2` | — | switch hash policy should match for best distribution | candidate `supported-ui` — **constrained dropdown, not free text** |
| `lacp_rate` | string | `slow`, `fast` | **`802.3ad` only** | kernel `slow` | — | **switch must agree**; mismatch degrades failover | candidate `supported-ui`, mode-gated |
| `min_links` | integer | ≥ 0 | **`802.3ad` only** | `0` | — | — | candidate `supported-ui`, mode-gated |
| `primary` | string (iface name) | a member interface | **`active-backup`** (also tlb/alb, unsupported here) | none | must name a real `port[]` member | — | **strongest candidate** — the only option Red Hat documents by Day-1 example |
| `updelay` / `downdelay` | integer (ms) | multiple of `miimon` | all, requires `miimon > 0` | `0` | **invalid without `miimon`** | — | candidate `supported-ui`, dependent on `miimon` |

A UI that exposed these without mode gating would let users build configurations NMState
accepts but that do nothing — `lacp_rate` on `active-backup`, for instance. Mode-aware
conditional display is a hard requirement of any implementation.

---

## 6. Findings

### 6.1 BLOCKER — SR-IOV generates an invalid NMState property

| | |
|---|---|
| **Symptom** | Enabling SR-IOV produces `interfaces[].sriov: { total-vfs: N }` in `agent-config.yaml`. |
| **Authority** | Upstream NMState **and** OCP 4.22 Agent book §1.9 both define `interfaces[].ethernet.sr-iov.total-vfs`. No authority defines a top-level `sriov` interface key. |
| **Immediate mechanism** | `addEthernet(name, mtu, sriov)` does `if (sriov) entry.sriov = sriov;` — assigning to the wrong nesting level. |
| **Why it survived** | `backend/test/nic-bond-vlan-ipv6.test.js:571` asserts `ethIface.sriov["total-vfs"] === 8`. **The test pins the defect as expected behaviour.** There is no schema validation of generated NMState anywhere in the pipeline. |
| **Consequence** | NMState's deserializer is strict (serde `deny_unknown_fields`-style): an unknown property aborts the parse with `unknown field`. OpenShift's assisted-service surfaces this as *"Invalid YAML string: unknown field"*. This does **not** silently drop the SR-IOV setting — it **invalidates the entire host `networkConfig`**, so the Agent-based install fails at validation. |
| **Reachability** | **Fully reachable.** A visible "SR-IOV" checkbox plus an "SR-IOV Total VFs" input in the node drawer, on the primary interface and on additional interfaces. Affects ethernet, bond members, vlan-on-ethernet and vlan-on-bond — every path that calls `addEthernet`. |
| **Blast radius** | Domain **A** only (Agent-based). Domain B never emits SR-IOV. All three minors equally. Any host with SR-IOV enabled. |
| **Pre-existing?** | Yes — present since the initial public release and shipped in v2.0.0. **Attribution is not acceptability**: the question §13 asks is whether *current* v2.1.0 behaviour is blocking, and it is. |
| **Authoritative fix** | Emit `entry.ethernet = { "sr-iov": { "total-vfs": N } }`, merging rather than overwriting any future `ethernet` block. Correct the test that pins the wrong shape. Add a generated-NMState schema assertion so the class of defect cannot recur. |

This is §13's blocking criterion met twice over: *"UI claims an advanced field is
supported"* and *"generated NMState cannot be accepted by supported OpenShift/NMState
paths."*

### 6.2 Non-blocking — VRF is offered with no documented Day-1 authority

OAA offers a VRF control and emits structurally valid `vrf.port` / `vrf.route-table-id`.
No Red Hat Day-1 (domain A) evidence was found documenting VRF for `agent-config.yaml`.

Not blocking: the output is **schema-valid**, so it cannot break parsing the way SR-IOV
does; at worst it is a capability Red Hat has not explicitly blessed for Day-1. Recorded
as `supported-ui` **pending a documentation authority**, and folded into the umbrella
item for a supportedness decision.

### 6.3 Non-blocking findings carried forward

| Finding | Status |
|---|---|
| `balance-xor` missing from the mode dropdown | backlog (§5.1) |
| `miimon` hardcoded, hidden, untested | backlog (§5.2), already DOC-188 |
| Bond options silently discarded from state | backlog, already DOC-188 |
| Domain B cannot express IPv6, bond, VLAN or MTU | umbrella item |
| 39 families classified `unknown-needs-review` | umbrella item |
| `link-aggregation.mode` description cites an unsupported mode | DOC-188 |

---

## 7. Bounded corrective tranche (7A.2)

Deliberately minimal — fix the blocker, do not implement the feature surface.

1. **Correct the emission** in `addEthernet()`:
   `entry.ethernet = { ...entry.ethernet, "sr-iov": { "total-vfs": N } }`.
   Scope: one function, one assignment.
2. **Correct the test** `nic-bond-vlan-ipv6.test.js:571` to assert
   `ethIface.ethernet["sr-iov"]["total-vfs"]`, and add an assertion that **no top-level
   `sriov` key exists** on any interface.
3. **Add a structural guard** over generated NMState: a test asserting every emitted
   interface key is in an allow-list derived from the NMState schema, so an unknown
   property fails in CI rather than at install time. This is the control that was
   missing.
4. **Cross-minor coverage** at 4.20, 4.21 and 4.22 — the surface is shared.
5. **Decide and record** whether SR-IOV stays offered at all. The committed Tranche 1
   research already flags *"whether Architect models SR-IOV at all is a product-scope
   question"*. Two defensible outcomes: fix the shape and keep it, or remove the control
   and classify SR-IOV `unknown-needs-review`. **Both are acceptable; shipping the
   current invalid output is not.**
6. **Do not** implement bond options, `balance-xor`, or any `unknown-needs-review`
   family in 7A.2.

Explicitly out of scope: the NMState data architecture (§8), the helper contract (§9),
the onboarding pipeline (§10) and the validator strategy (§11).

---

## 8. Recommended canonical NMState data architecture

**Recommendation: Option 2 — a dedicated version-aware NMState authority**, with
scenario catalogs referencing it.

| Option | Verdict |
|---|---|
| 1 — keep synthesising nested NMState paths into each scenario catalog | **Rejected.** NMState is shared across `bare-metal-agent` and `vsphere-agent` and is identical in both. Today three bond rows are duplicated across 2 scenarios × 3 minors = 6 copies; a full surface would be ~64 families × 2 × 3 ≈ 384 hand-maintained rows that must stay byte-identical. The duplication is the defect generator. |
| **2 — `data/nmstate/<minor>/…` canonical authority** | **Recommended.** One definition per field per minor; scenario catalogs reference it by path. Matches the repository's existing canonical-plus-generated-mirror pattern (`data/params` → `frontend/src/data/catalogs`, enforced by `sync-catalogs:check`). Makes per-minor diffing — the thing the onboarding pipeline needs — a file comparison rather than a cross-scenario reconciliation. |
| 3 — something better in-repo | None found. `data/arch-support/<minor>.json` is the closest precedent and is itself a shared, version-keyed authority consumed by multiple scenarios — i.e. Option 2 already exists in this codebase, proven, for a different surface. |

Required properties, all already precedented here:

- one canonical source under `data/`, generated mirror under `frontend/src/data/`,
  never hand-edited, enforced by a `check` script;
- explicit `supportStatus` per field per minor, with `minVersion` / `maxVersion`;
- same-minor citations, with an explicit **domain** field (A/B/C/D) so a domain-C
  citation can never silently justify a domain-A claim — the single most important
  lesson from this audit;
- mode/scenario applicability expressed as data (`appliesWhen: { "link-aggregation.mode": ["802.3ad"] }`);
- reusable validation metadata (type, enum, range, companion-field requirements);
- helper-text metadata (§9);
- delta-ability: `diff(data/nmstate/4.22, data/nmstate/4.23)` as the onboarding entry point.

---

## 9. Helper / i-icon metadata contract

A reusable shape capable of producing the established detailed help, with conditional
variants. Defined now, populated when a field is implemented.

```jsonc
{
  "path": "link-aggregation.options.xmit_hash_policy",
  "label": "Transmit hash policy",
  "help": {
    "what":    "Chooses which packet fields the bond hashes to pick an outgoing member link.",
    "when":    "Set it when you want traffic spread across members. Only has an effect in balance-xor and 802.3ad; ignored in active-backup, where one member is active at a time.",
    "format":  "Enumerated string.",
    "values": [
      { "value": "layer2",     "summary": "Hash on source/destination MAC. Default. All traffic between two hosts uses one link." },
      { "value": "layer2+3",   "summary": "MAC plus IP. Better spread across multiple destination hosts." },
      { "value": "layer3+4",   "summary": "IP plus TCP/UDP port. Best spread for many connections between the same two hosts." }
    ],
    "howUsed": "Emitted as link-aggregation.options.xmit_hash_policy in the host's networkConfig in agent-config.yaml.",
    "dependencies": [
      "Requires bond mode balance-xor or 802.3ad.",
      "For even distribution the switch's port-channel hash policy should match; a mismatch is not an error but wastes bandwidth."
    ],
    "warnings": [
      "layer3+4 is not fully 802.3ad-compliant for fragmented traffic; most switches accept it."
    ],
    "example": "layer3+4"
  },
  "conditionalHelp": [
    { "when": { "link-aggregation.mode": "active-backup" },
      "note": "This setting has no effect in active-backup mode." }
  ]
}
```

Contract: `what` · `when` · `format` · `values[]` (value + summary, driving a
constrained dropdown) · `howUsed` (naming the generated artifact and path) ·
`dependencies[]` (including mode and switch-side) · `warnings[]` · `example`, plus
`conditionalHelp[]`. `values[]` doubles as the validation enum, so help and validation
cannot drift.

---

## 10. Future minor-onboarding pipeline

A permanent NMState step beside the existing installer-parameter audit. **Fails closed.**

| # | Question | Mechanism | Fail-closed behaviour |
|---|---|---|---|
| 1 | Which NMState version ships in the target release? | Record the nmstate version from the release payload / RHCOS content, with provenance (digest, source URL, date) alongside the existing installer pin in `proven-repairs.js` | Unresolvable version → **stop** |
| 2 | Has the schema changed since the last supported minor? | Extract the schema for the pinned version; diff against the stored previous-minor schema | Diff non-empty and unreviewed → **stop** |
| 3 | Have Red Hat support statements changed? | Re-read the Agent book (A) and Kubernetes NMState book (C) for the new minor; diff documented fields, examples and the supported bond-mode list | Any change unclassified → **stop** |
| 4 | What is new / removed / deprecated / behaviourally changed? | Produce a per-field delta classified against the `supportStatus` vocabulary | Any field `unknown-needs-review` → **stop**, human decision |
| 5 | Is OAA's supported subset still valid? | Assert every OAA `supported-ui`/`supported-derived` path still exists in the new schema and is still Red Hat-documented | A supported path that vanished → **stop** |
| 6 | Do frontend and backend agree? | `sync-nmstate:check`, mirroring the existing `sync-catalogs:check` | Mirror drift → **stop** |
| 7 | Are helper texts and citations still correct? | Assert every `supported-ui` field has help and a same-minor citation **tagged with its domain** | Missing or cross-minor citation → **stop** |
| 8 | Does representative generated output validate? | Validate generated NMState for a fixture matrix against the pinned schema (§11) | Validation failure → **stop** |

**Never inherit the previous minor's schema by default.** Absence of evidence for a new
minor must be an error, not a silent carry-forward — the same rule the supported-minor
guard already enforces for version support.

Hermetic-pinning options, in preference order: extract the JSON schema from the pinned
nmstate source revision and commit it (fully hermetic, diffable, no runtime dependency);
or run a pinned `nmstatectl` in a container during certification only; or, weakest,
consume the online devel schema — rejected, because it is **not** guaranteed to equal the
version in OCP 4.20/4.21/4.22.

---

## 11. Validator strategy

**Recommendation: both, at different stages — and no runtime dependency on `nmstatectl`.**

| Stage | Mechanism | Rationale |
|---|---|---|
| **Unit / CI (every change)** | JS schema validation of generated NMState against a **pinned, committed** extracted schema | Deterministic, hermetic, no network, no binary. This is the control whose absence allowed §6.1 to ship. Cheap enough to run on every generation test. |
| **Release certification (per minor)** | `nmstatectl` in a pinned container, over a fixture matrix | Catches semantic errors a schema cannot — mode/option incompatibilities, interface cross-references. |
| **Application runtime** | **None.** | A hard `nmstatectl` dependency would break the disconnected, local-first deployment model. Users already run `nmstatectl` themselves if they wish, as Red Hat recommends. |

Adding a runtime dependency would be an architecture decision requiring explicit human
approval; this audit does not propose one. Note this environment's `nmstatectl` is a
broken stub (`ModuleNotFoundError: No module named 'nmstatectl'`), so no empirical
validation was possible here — another reason to prefer a committed schema over a
tool that may or may not be present.

---

## 12. Sanitized regression fixture design

Models the real-world shape the human supplied — **802.3ad + advanced bond options +
VLAN + static IPv6** — using only documentation-safe values. Designed, not implemented:
it asserts options OAA does not yet support.

**Values:** `bond0`, `ethernet0`, `ethernet1`, VLAN `100`, IPv6 documentation prefix
`2001:db8::/32` (RFC 3849), MACs from the `00:00:5E:00:53:xx` documentation range
(RFC 7042). **No customer MAC, IP, VLAN ID, interface name, hostname, registry, cluster
name or username appears.**

**Frontend state:**

```jsonc
{
  "primary": {
    "type": "vlan-on-bond", "mode": "static",
    "ipv6Cidr": "2001:db8:1::10/64", "ipv6Gateway": "2001:db8:1::1",
    "bond": {
      "name": "bond0", "mode": "802.3ad",
      "slaves": [
        { "name": "ethernet0", "macAddress": "00:00:5E:00:53:01" },
        { "name": "ethernet1", "macAddress": "00:00:5E:00:53:02" }
      ],
      "options": { "miimon": "100", "lacp_rate": "fast", "xmit_hash_policy": "layer3+4" }
    },
    "vlan": { "id": "100", "baseIface": "bond0", "name": "bond0.100" },
    "advanced": { "mtu": "9000" }
  }
}
```

**Expected NMState** (abbreviated — bond carries the options; the VLAN carries the IPv6
address; both members appear as ethernet interfaces):

```yaml
interfaces:
  - { name: ethernet0, type: ethernet, state: up, mtu: 9000 }
  - { name: ethernet1, type: ethernet, state: up, mtu: 9000 }
  - name: bond0
    type: bond
    state: up
    mtu: 9000
    ipv4: { enabled: false }
    ipv6: { enabled: false }
    link-aggregation:
      mode: 802.3ad
      options: { miimon: "100", lacp_rate: fast, xmit_hash_policy: layer3+4 }
      port: [ethernet0, ethernet1]
  - name: bond0.100
    type: vlan
    state: up
    vlan: { base-iface: bond0, id: 100 }
    ipv4: { enabled: false }
    ipv6:
      enabled: true
      dhcp: false
      address: [{ ip: "2001:db8:1::10", prefix-length: 64 }]
```

**Assertions:** every supplied option reaches the YAML and is **not** overwritten by the
hardcode; `lacp_rate` and `xmit_hash_policy` are rejected if the mode is changed to
`active-backup`; IPv6 is on the VLAN and the bond carries `ipv6.enabled: false`; the
export/import round-trip preserves every option; and the document passes schema
validation (§11). Required at **4.20, 4.21 and 4.22**.

---

## 13. Release-note and documentation accuracy

Checked against the unstaged Tranche 7A candidate. The v2.1 notes, CHANGELOG and README
**do not** claim complete NMState coverage, do not claim every bond option is exposed,
and already carry a Known Limitation naming `xmit_hash_policy`, `lacp_rate`, `updelay`
and `downdelay` as unavailable. One addition is warranted: the SR-IOV blocker, once
fixed, and the fact that OAA supports a **documented subset** of NMState. Applied in
§14 of the Tranche 7A candidate rather than here.

**4.22 Field Guide:** reviewed. Networking guidance is generic and accurate — it directs
users to write NMState in `agent-config.yaml` for static addressing and says nothing
false. It does **not** claim OAA supports all of NMState, does not misstate bond modes,
does not mention `miimon`, and does not confuse Day-1 with NNCP or NMState with Bond
CNI. **No change required now.** A pointer to Red Hat's advanced NMState guidance for
configurations beyond OAA's subset is worth adding — but it should land with the
corrective tranche, because what is true about SR-IOV support depends on that outcome.

---

# Tranche 7B — blocker correction and current-UI safety sweep

Baseline unchanged: `85d93fddc2e0b8a2c4986f381d9205bd0597de26`.

## 14. SR-IOV — corrected

### Authority, re-verified per minor before editing code

Day-1 Agent domain (**A**), "Bonds and SR-IOV dual-NIC node network configuration",
§1.9 of the Agent-based Installer book in each release:

| Minor | Verbatim nesting | Value shown |
|---|---|---|
| 4.20 | `ethernet:` → `sr-iov:` → `total-vfs:` | `2` |
| 4.21 | `ethernet:` → `sr-iov:` → `total-vfs:` (plus `vfs[]` with `vlan-id`) | `2` |
| 4.22 | `ethernet:` → `sr-iov:` → `total-vfs:` | `8` |

Upstream NMState YAML API agrees: `interfaces[].ethernet.sr-iov.total-vfs`.
**No authority defines a top-level `sriov` interface key.** Post-install SR-IOV
Operator configuration and Bond CNI were explicitly *not* used as evidence — different
domains (C and D).

### Root cause and blast radius

| | |
|---|---|
| **Symptom** | Enabling SR-IOV produced `interfaces[].sriov: { total-vfs: N }`. |
| **Immediate mechanism** | `addEthernet()` did `if (sriov) entry.sriov = sriov;` — correct value, wrong nesting level. |
| **Lifecycle cause** | Nothing validated the *structure* of generated NMState. The only SR-IOV test asserted `ethIface.sriov["total-vfs"]`, so the defect was encoded as expected behaviour and every suite stayed green. |
| **Minor blast radius** | 4.20, 4.21, 4.22 **equally** — no version gating exists on this path. |
| **Scenario blast radius** | **Agent-Based Installer on Bare Metal or VMware vSphere only** — `buildAgentConfig` runs only for those two, and it is the sole caller of `buildNmState`. Within them, every path that calls `addEthernet`: plain ethernet, bond members, vlan-on-ethernet and vlan-on-bond, on both the primary and additional interfaces. |
| **Bare-metal IPI** | **Unaffected.** Its builder is a separate inline function reading a different state shape (`node.networkConfig.primaryInterface`) and has no SR-IOV code path at all. |
| **Persisted / imported state** | Affected — `primary.advanced.sriov` round-trips through export/import, so a saved configuration regenerated the bad shape. Now regenerates correctly; the state shape did not change, so no migration is needed. |
| **Authoritative fix** | Emit under `ethernet`, merging rather than replacing: `entry.ethernet = { ...entry.ethernet, "sr-iov": sriov }`. |

### The correction

One assignment in `backend/src/generate.js` `addEthernet()`. The merge spread is
deliberate: a future ethernet-level field must not be clobbered by ordering. The
internal state property (`primary.advanced.sriov`) was **not** renamed — the defect was
at the serialization seam, and renaming state would have forced a migration for no
functional gain.

### Verified output

```yaml
- name: ethernet0
  type: ethernet
  state: up
  mtu: 1500
  ethernet:
    sr-iov:
      total-vfs: 8
```

### Tests

- The test that pinned the bug now asserts `ethIface.ethernet["sr-iov"]["total-vfs"]`
  **and** that no top-level `sriov` key exists.
- `backend/test/t7b-sriov-nmstate-shape.test.js` — **50 assertions**: the corrected
  nesting at 4.20/4.21/4.22 × bare-metal-agent and vsphere-agent; bond members,
  vlan-on-bond and vlan-on-ethernet; shape identical across minors; disabled, empty and
  non-numeric VF counts all emit nothing; disabled output byte-identical to a state
  with no `sriov` key; a persisted/imported state regenerates correctly.

### The missing control, now added

A structural guard asserts every key in a fully-exercised generated document (ethernet,
bond, vlan, vrf, routes, dns, IPv4 and IPv6) is in a schema-derived allow-list, and is
proven non-vacuous by rejecting an injected unknown key. **An unknown NMState property
now fails in CI rather than at install time.**

## 15. Current-UI NMState safety sweep

Every currently reachable networking control, traced UI → state → generated NMState.

| UI control | State path | Generated NMState path | Evidence | Verdict |
|---|---|---|---|---|
| Interface name | `primary.ethernet.name` / `bond.name` | `interfaces[].name` | A, all 3 | ✅ |
| Interface type | `primary.type` | `interfaces[].type` | A, all 3 | ✅ |
| MTU | `primary.advanced.mtu` | `interfaces[].mtu` | A §1.8 | ✅ |
| Static IPv4 CIDR | `primary.ipv4Cidr` | `ipv4.address[].ip` + `.prefix-length` | A | ✅ |
| IPv4 gateway | `primary.ipv4Gateway` | `routes.config[]` default route | A §1.9 | ✅ |
| Static IPv6 CIDR | `primary.ipv6Cidr` | `ipv6.address[].ip` + `.prefix-length` | A | ✅ |
| IPv6 gateway | `primary.ipv6Gateway` | `routes.config[]` `::/0` | A | ✅ |
| DHCP / static mode | `primary.mode` | `ipv4.dhcp` / `ipv6.dhcp` | A | ✅ |
| Bond mode | `primary.bond.mode` | `link-aggregation.mode` | A §1.8/1.9 | ✅ |
| Bond members | `primary.bond.slaves[]` | `link-aggregation.port[]` | A | ✅ |
| *(no control)* | — | `link-aggregation.options.miimon` | hardcoded `"100"` | ⚠️ hidden default, DOC-188 |
| VLAN ID / base | `primary.vlan.{id,baseIface}` | `vlan.{id,base-iface}` | A §1.8 | ✅ |
| DNS servers / search | `node.dnsServers` / `dnsSearch` | `dns-resolver.config.{server,search}` | A | ✅ |
| Extra routes | `primary.advanced.routes[]` | `routes.config[]` | A §1.9 | ✅ |
| **SR-IOV / Total VFs** | `primary.advanced.sriov` | `ethernet.sr-iov.total-vfs` | A §1.9, all 3 | ✅ **fixed in 7B** |
| **VRF / name / table ID** | `primary.advanced.vrf` | `vrf.{port,route-table-id}` | upstream only | ⚠️ valid output, evidence incomplete — §16 |
| *(IPI drawer)* Static IP | `node.networkConfig.primaryInterface` | ethernet + `ipv4.address` + dns + route | B | ✅ |

**No second currently advertised control emits an invalid path, is silently discarded,
maps to the wrong schema, or is accepted in state but omitted from generation.**

## 16. VRF — explicit current-release disposition

**Classification: B — a valid NMState capability whose product-support evidence is
incomplete.** Not blocking.

| Question | Answer |
|---|---|
| Where is it exposed? | Agent node drawer, **additional interfaces**, alongside SR-IOV. Not in the IPI drawer. |
| Generated structure | `{ name, type: vrf, state: up, vrf: { route-table-id, port[] } }` |
| Upstream NMState recognises it? | **Yes** — `vrf.port` and `vrf.route-table-id` are exactly the documented keys. |
| Red Hat Day-1 Agent evidence? | **NOT PRESENT.** A full-text search of the 4.22 Agent book for `vrf` and `route-table-id` returns no `type: vrf` example. |
| Catalog row? | None, at any minor. |

Why **B** and not **C** (incorrectly exposed): the output is **structurally valid**, so
NMState parses and applies it. Unlike SR-IOV it cannot break the document. The gap is
evidentiary — Red Hat has not documented VRF for Day-1 agent-config — not structural.
Why not **D**: it *is* reachable in a supported workflow. Why not **A**: there is no
adequate authority.

**Action:** a product-support decision is required — either find/establish authority and
add a catalog row with a citation, or withdraw the control. Tracked under DOC-191. It
does not block v2.1.0 because it generates valid configuration and nothing misrepresents
it as Red Hat-blessed.

## 17. Bare-metal IPI subset — explicit disposition

**Classification: deliberate subset limitation. Not blocking.**

Bare Metal + IPI renders a **separate drawer** (`NodeDrawerIpiContent`), selected
explicitly: *"only show IPI-specific form when user chose Bare Metal + IPI; otherwise
show full agent-oriented form."* It offers exactly four groups: BMC, **Network
Configuration (Static IP)**, root-device hints, and FQDN hostname.

| IPI generator cannot express | Does the IPI UI offer it? | Verdict |
|---|---|---|
| Bond | **No** | subset, not a drop |
| VLAN | **No** | subset, not a drop |
| IPv6 | **No** | subset, not a drop |
| MTU | **No** | subset, not a drop |
| SR-IOV / VRF | **No** | subset, not a drop |

**The IPI UI's advertised surface exactly matches its generator's capability.** Nothing
is shown and then discarded, and no tooltip or Field Guide text implies otherwise.
Agent/IPI capability parity remains deferred under DOC-191.

## 18. Validation performed

The locally available `nmstatectl` is a broken stub
(`ModuleNotFoundError: No module named 'nmstatectl'`). **No package was installed and no
`nmstatectl` validation was performed — none is claimed.** This correction is validated
by exact documented-structure assertions against the per-minor Red Hat examples above,
plus the new allow-list guard. The pinned-schema / containerised-`nmstatectl`
certification pipeline remains future work under DOC-191.

## 19. Reusable 4.22 documentation source index

The maintainer supplied a consolidated 4.22 documentation URL list during this tranche.
The `html-single` renderings are materially better for automated acquisition — one
document per book, so a fetcher can page by character offset instead of guessing at
paginated chapter URLs, which is how the per-minor onboarding pipeline (DOC-191) should
consume them.

Highest-value for NMState / Day-1 networking:

| Book | `html-single` URL |
|---|---|
| Agent-based Installer (**domain A** authority) | `…/4.22/html-single/installing_an_on-premise_cluster_with_the_agent-based_installer` |
| Installing on bare metal (**domain B**) | `…/4.22/html-single/installing_on_bare_metal` |
| Kubernetes NMState (**domain C** — never cite for Day-1) | `…/4.22/html-single/kubernetes_nmstate` |
| Hardware networks (SR-IOV Operator — **post-install**, not Day-1) | `…/4.22/html-single/hardware_networks` |
| Multiple networks (Bond CNI — **domain D**) | `…/4.22/html-single/multiple_networks` |
| Configuring network settings · Advanced networking · Networking overview | `…/4.22/html-single/{configuring_network_settings,advanced_networking,networking_overview}` |
| Installation configuration · Installation overview | `…/4.22/html-single/{installation_configuration,installation_overview}` |
| Platform installs | `…/4.22/html-single/installing_on_{aws,azure,nutanix,vmware_vsphere,a_single_node,any_platform}` |
| Disconnected environments · OVN-Kubernetes · Postinstallation · Updating · Validation and troubleshooting | `…/4.22/html-single/{disconnected_environments,ovn-kubernetes_network_plugin,postinstallation_configuration,updating_clusters,validation_and_troubleshooting}` |

The domain labels matter more than the list: **Hardware networks** and **Multiple
networks** are exactly the books most likely to be mis-cited as Day-1 NMState authority,
and they are not. Fold this index into `docs-sources-<minor>.json` when DOC-191 builds
the acquisition step.
