# DOC-165 — OCP 4.22 generated-config coverage, agent-config NMState first

> **Tranche 1 deliverable 6 of 10.** Research for **DOC-165**, which is `active`/`p1` in
> `docs/BACKLOG_STATUS.md`. **DOC-165 is not implemented here.** No
> `data/params/4.22/**` file is created. Candidate rows below are candidates only.

---

## 1. The headline result, stated up front

**Red Hat does not publish an enumerated supported-NMState matrix for the Agent-based
Installer's `agent-config.yaml` `hosts[].networkConfig`.** DOC-165's goal — *"every Red
Hat-supported field, value and combination … has an explicit application disposition"* —
cannot be satisfied from same-minor documentation alone, because the authoritative
same-minor documentation does not enumerate one.

What exists at 4.22 instead is: a broad permission statement, plus **worked examples**
covering a strict subset of NMState.

This is not a gap in the research. It is the finding, and it changes what DOC-165 has to
decide.

## 2. Why the installer source cannot answer it either

`pkg/types/agent/agent_config_type.go` at 4.22.16:

```go
NetworkConfig aiv1beta1.NetConfig `json:"networkConfig,omitempty"`
```

`aiv1beta1.NetConfig` is an **external assisted-service type** that carries raw YAML. The
NMState schema is therefore **absent from installer Go structs by construction** — exactly
as the runbook's Phase 3 note predicts for *"the ~35 agent `networkConfig` paths that
follow an external NMState schema and will never appear in installer Go structs"*.

Corroborating mechanical result from this tranche: the agent-config surface has
**21 parameter paths at both 4.21.35 and 4.22.16, with zero deltas of any class.** The
installer-first discovery that works for install-config yields nothing here.

## 3. Evidence sources examined, and what each is worth

| Source | Verdict |
|---|---|
| OCP 4.22 *Agent-based Installer* §9.2 *Available Agent configuration parameters* | Parameter tables for agent-config, but **none of** `networkConfig`, `link-aggregation`, `miimon`, `lacp_rate`, `min_links`, `xmit_hash_policy`, `dns-resolver`, `routes`, `mtu`, `vlan` appear in the portion read (chars 100 000–220 859). Verified with an explicit "report NOT PRESENT" protocol. |
| OCP 4.22 *Agent-based Installer* §1.5.3, §1.8, §1.9 | **The real source.** Worked `agent-config.yaml` examples — see §4. |
| OCP 4.22 **Kubernetes NMState** book | **Not authority for agent-config.** Scoped to the NMState Operator on a running cluster: *"To observe and update the node network state and configuration in your cluster, you can use the Kubernetes NMState Operator."* No mention of the Agent-based Installer or `agent-config.yaml`. Contains **no** enumerated supported bond-mode list; none of `link-aggregation`, `miimon`, `lacp_rate`, `min_links`, `xmit_hash_policy`, `802.3ad`, `active-backup` appear in the portion read. |
| `nmstate.io/examples.html` (already cited in `data/docs-index/4.21.json`) | Upstream capability. **Not** Red Hat OCP supportability. The prompt is explicit: do not equate the two. |

> A note on method. An early query returned a confident, complete-looking list of seven
> bond modes and five `options.*` fields. Re-querying with an explicit *"report only what
> is literally present; write NOT PRESENT otherwise"* protocol returned **NOT PRESENT for
> every one of them**. The first answer was the summarizing model supplying general NMState
> knowledge, not reading the page. Everything in §4 was captured under the strict protocol.

## 4. What OCP 4.22 documents by example — verified literal presence

From *Preparing to install with the Agent-based Installer*, §1.5.3 *Static networking*,
§1.8 *Example: Bonds and VLAN interface node network configuration*, §1.9 *Example: Bonds
and SR-IOV dual-NIC node network configuration*.

| NMState path | Documented value(s) at 4.22 | Section |
|---|---|---|
| `interfaces[].name` | free | 1.5.3, 1.8, 1.9 |
| `interfaces[].type` | `ethernet`, `bond`, `vlan` | 1.5.3, 1.8, 1.9 |
| `interfaces[].state` | `up`, `down` | 1.8, 1.9 |
| `interfaces[].mac-address` | free | 1.9 |
| `interfaces[].mtu` | `1500` | 1.8 |
| `interfaces[].ipv4` / `ipv6` | `enabled`, `dhcp`, `address[].ip`, `address[].prefix-length` | 1.5.3, 1.8, 1.9 |
| `interfaces[].ethernet.sr-iov.total-vfs` | `2` | 1.9 |
| `interfaces[].link-aggregation.mode` | **`802.3ad`** (§1.8), **`active-backup`** (§1.9) | 1.8, 1.9 |
| `interfaces[].link-aggregation.options.primary` | `sriov:eno1:0` | 1.9 |
| `interfaces[].link-aggregation.port[]` | list of ports | 1.8, 1.9 |
| `interfaces[].min-tx-rate` / `max-tx-rate` | `100` / `200` (bond over SR-IOV VFs) | 1.9 |
| `interfaces[].vlan.base-iface`, `.id` | `bond0`, `300` | 1.8 |
| `dns-resolver.config.server[]` | list | 1.8, 1.9 |
| `routes.config[].destination`, `.next-hop-address`, `.next-hop-interface`, `.table-id` | `0.0.0.0/0`, address, `bond0`, `254` | 1.8, 1.9 |

### Verified absent from the 4.22 Agent-based Installer book (portions read)

`lacp_rate` · `min_links` · `xmit_hash_policy` · `route-rules` · bond modes
`balance-rr`, `balance-xor`, `broadcast`, `balance-tlb`, `balance-alb`.

`miimon` is **NOT PRESENT** in the portions read (chars 100 000–247 885 of *Preparing to
install*, and the §9 parameters chapter). It **is** present in the equivalent 4.21 example.
Two honest readings — the 4.22 example switched to `802.3ad` where 4.21 used
`active-backup` + `miimon`, or `miimon` survives in a portion not read (chars 0–100 000 of
that page were not searched). **Recorded as unresolved**, not as a removal. Do not record
"removed in 4.22" on this evidence.

## 5. Current catalog coverage, re-verified

`data/params/4.2{0,1}/bare-metal-agent.json` model `hosts[].networkConfig.interfaces[].link-aggregation`,
`.link-aggregation.port` and `.link-aggregation.mode`, while `link-aggregation.options` is
described only in prose on the parent object, with **no catalog row for any individual
option** — exactly as the DOC-165 backlog row states. This tranche changes none of it.

So Red Hat documents `options.primary` (and, at 4.21, `options.miimon`) by example, and
Architect models no `options.*` row at all.

## 6. Candidate rows for `data/params/4.22/bare-metal-agent.json` and `vsphere-agent.json`

**NOT CREATED in this tranche.** Each would need `path`, `outputFile: agent-config.yaml`,
`type`, `required`, `description`, `supportStatus`, `minVersion`, `maxVersion`, citation.

| Candidate path | Proposed `supportStatus` | Basis |
|---|---|---|
| `hosts[].networkConfig.interfaces[].link-aggregation.options.primary` | `supported-ui` | documented by example, §1.9 |
| `hosts[].networkConfig.interfaces[].link-aggregation.options.miimon` | **HUMAN-REVIEW** | documented at 4.21; not located at 4.22 in the portions read |
| `hosts[].networkConfig.interfaces[].link-aggregation.options.lacp_rate` | **HUMAN-REVIEW** | upstream NMState only; no Red Hat 4.22 evidence |
| `hosts[].networkConfig.interfaces[].link-aggregation.options.min_links` | **HUMAN-REVIEW** | as above |
| `hosts[].networkConfig.interfaces[].link-aggregation.options.xmit_hash_policy` | **HUMAN-REVIEW** | as above |
| `hosts[].networkConfig.interfaces[].mtu` | `supported-ui` | documented by example, §1.8 |
| `hosts[].networkConfig.routes.config[].table-id` | `supported-ui` | documented by example, §1.9 |
| `hosts[].networkConfig.interfaces[].{min,max}-tx-rate` | **HUMAN-REVIEW** | documented only in the SR-IOV example; Intel NICs reportedly do not support `min-tx-rate` |
| `hosts[].networkConfig.interfaces[].ethernet.sr-iov.total-vfs` | **HUMAN-REVIEW** | documented by example; whether Architect models SR-IOV at all is a product-scope question |
| `link-aggregation.mode` allowed values | **HUMAN-REVIEW** | only `802.3ad` and `active-backup` are documented at 4.22; the other five modes are upstream-only |

## 7. The decision DOC-165 actually needs

Not "which fields are supported" — that is unanswerable from Red Hat documentation as it
stands. The real question is the **policy**:

> When Red Hat documents an NMState field only by example, and upstream NMState supports
> far more, what is Architect's rule?

Three coherent options, for the human:

| Option | Rule | Consequence |
|---|---|---|
| **A — documented-by-example only** | model only what a Red Hat same-minor example shows | smallest, most defensible; excludes `lacp_rate`, `min_links`, `xmit_hash_policy`, and five bond modes that work in practice |
| **B — upstream NMState, Red Hat-annotated** | model the upstream schema, flag each row by whether Red Hat documents it | largest coverage; risks implying Red Hat support the docs do not give — the exact failure Rule 2.4 exists to prevent |
| **C — passthrough with validation** | keep a curated documented subset as first-class fields, allow a validated raw-NMState escape hatch for the rest | matches how Red Hat actually describes it ("any network configuration that is in NMState format"); largest implementation cost |

**Recommendation: A for v2.1**, with C recorded as the direction. A is the only option
consistent with "installer or documentation presence alone does not authorize
`supported-ui`" applied in reverse — it refuses to assert support Red Hat has not stated.

This is a **product decision and a stop-and-report** under runbook Rule 7 item 2. It is not
an agent decision and it is not made here.

## 8. Related backlog, reconciled not duplicated

`docs/BACKLOG_STATUS.md` read first (execution-contract rule 11). **No new backlog ID is
invented.** Already reconciled under DOC-165 and unchanged by this tranche:

- **PHX-007** — E2E/UI path for bond/VLAN nmstate outputs (`deferred`/`p3`)
- **PHX-025** — bond mode naming vs nmstate alignment (`deferred`/`p3`); §4 is the 4.22
  evidence that question needs, and it shows only two modes are documented
- **PHX-034** — broaden backend generation unit tests (`active`/`p2`)
