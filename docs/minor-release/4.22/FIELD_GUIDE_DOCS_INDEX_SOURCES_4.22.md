# OCP 4.22 Field Guide and docs-index source inventory

> **Tranche 1 deliverable 8 of 10.** Source plan only.
> **`data/docs-index/4.22.json` and `backend/src/fieldGuide/v4.22/**` are NOT created.**
> Machine-readable: [`docs-sources-4.22.json`](docs-sources-4.22.json).

---

## 1. Acquisition method, and why it is recorded

| Surface | Result |
|---|---|
| `curl` against `docs.redhat.com` | **HTTP 403 for every URL attempted**, `html` and `html-single` alike, with a browser User-Agent |
| agent fetch tool | **HTTP 200**, same URLs |

This reproduces the anti-bot behaviour already recorded in the 0B ledger §8.2 and in
`local-docs/ocp-4.21/analysis/SLICE-5F2-URL-VALIDATION-RESULTS.md`. Per runbook Rule 2.4.1,
**a 403 is not evidence that a page is absent.** It also means the Revision-3 claim that
4.22 doc HEAD checks return 200 does not hold for `curl` from this environment — recorded
so a future tranche does not treat `curl` liveness checking as a working gate.

Two further rules followed, both from Rule 2.4.1:

- **Page past the chrome.** The first ~100 KB of an `html-single` page is site-wide product
  navigation. Reading only the start returns the **global** chapter list and will
  confidently report the wrong book structure — it did, on the first release-notes
  retrieval. Every retrieval that mattered was read at an offset.
- **`html-single` is a verification surface, not a citation target.** Catalog and Field
  Guide citations stay on the paginated `html/<book>/<chapter>` form readers land on.

### Retrievals used in this tranche

All retrieved **2026-10-07**. Offsets read are recorded in
`docs-sources-4.22.json` so a reviewer can tell what was searched from what was not.

| Book / page | Used for |
|---|---|
| `release_notes` | deprecated+removed tables; TP tables §1.9.3/§1.9.5/§1.9.7; ARM-on-x86 bare metal |
| `installing_on_bare_metal/installer-provisioned-infrastructure` | `provisioningNetworkGateway`, §3.3.15 |
| `installation_overview/installing-preparing` | Table 2.1; FIPS architecture statement |
| `.../agent-based-installer/preparing-to-install-with-agent-based-installer` | NMState examples §1.5.3, §1.8, §1.9 |
| `.../agent-based-installer/installation-config-parameters-agent` | §9.2; NMState tokens verified **NOT PRESENT** |
| `disconnected_environments` + `about-installing-oc-mirror-v2` | oc-mirror v2 is **Chapter 5** at 4.22; §5.13 ISC parameter table |
| `kubernetes_nmstate` | **negative result** — see §3 |
| ODF 4.22 `planning_your_deployment/disconnected-environment_rhodf` | package set |

## 2. Book inventory

The full OCP 4.22 book-root set was supplied by the human operator on 2026-10-07 and is
recorded in `docs-sources-4.22.json` so it is not re-derived next time. 19 in scope,
15 out of scope, 1 external.

**In scope and already used by the 4.21 docs-index:** `disconnected_environments` ·
`installation_overview` · `installing_on_bare_metal` ·
`installing_an_on-premise_cluster_with_the_agent-based_installer` ·
`installing_on_vmware_vsphere` · `installing_on_aws` · `installing_on_azure` ·
`installing_on_ibm_cloud` · `installing_on_nutanix` · `installing_on_any_platform` ·
`configuring_network_settings` · `edge_computing`.

**In scope and NEW to the inventory** — none of these is referenced by
`data/docs-index/4.21.json`:

| Book | Why it is now a candidate |
|---|---|
| `release_notes` | the authority for deprecation, removal and Technology Preview status. Four of this tranche's five classifications rest on it. Its absence from the 4.21 docs-index is a real gap. |
| `kubernetes_nmstate` | **reference only**, with its scope limitation recorded (§3) |
| `installing_a_two_node_openshift_cluster` | **new book at 4.22**; two-node with fencing moved TP → GA |
| `installing_on_a_single_node` | SNO topology, which Architect already models via `platform: none` |
| `validation_and_troubleshooting` | candidate for the Field Guide troubleshooting compartment |
| `installation_configuration`, `postinstallation_configuration` | candidates |

Adding a book to the docs-index is a scope decision, not a mechanical step; these are
recorded as candidates for human triage in Tranche 2, not scheduled.

**Out of scope (15)** are listed with a reason each in the JSON. Two deserve a note:
`installing_on_ibm_z_and_ibm_linuxone` and `installing_on_ibm_power` are out of *scenario*
scope but are directly relevant to the `s390x`/`ppc64le` **OPEN cells** in the architecture
matrix — the Blueprint offers those target architectures today with no 4.22 evidence
behind them.

> **vSphere filename caution, carried forward:** the book is
> `Installing_on_VMware_vSphere`, **not** `Installing_on_vSphere`. The short form 404s and
> has already cost one cycle (runbook Phase 1).

## 3. `kubernetes_nmstate` is not agent-config authority

Verified directly rather than assumed:

> "To observe and update the node network state and configuration in your cluster, you can
> use the Kubernetes NMState Operator."

The book addresses the **NMState Operator on a running cluster**. No mention of the
Agent-based Installer or `agent-config.yaml` appears, and it contains **no** enumerated
supported bond-mode list. Recorded explicitly so a future agent does not cite it as
justification for an `agent-config.yaml` catalog row. See
[`DOC165_GENERATED_CONFIG_COVERAGE_4.22.md`](DOC165_GENERATED_CONFIG_COVERAGE_4.22.md).

## 4. Compartment plan and what must change from 4.21

The v4.21 tree is 9 modules / ~1302 lines / 124 occurrences of `4.21`. Class A is
mechanical, Class B must be re-verified against Tranche-1 evidence, **Class C is re-decided,
never mechanically bumped** (plan §2.H).

| Compartment | What must change for 4.22 |
|---|---|
| **global** | RHCOS is RHEL 9.8; RHEL 10 is **Technology Preview** (Class B). FIPS statement: x86_64, ppc64le, s390x only. |
| **mirror** | oc-mirror v2 moved Chapter 7 (4.20) → **Chapter 5** (4.22) — chapter numbers in prose need re-verification, slugs are stable. `oc adm release mirror` deprecated. oc-mirror v1 deprecated. Docker v2 registries deprecated. **ICSP deprecated** — Architect emits `imageDigestSources`, so it is on the right side; worth saying. `CatalogSource` must be named `redhat-operators`. Red Hat Marketplace removed. |
| **platform-specific** | bare metal: `provisioningNetworkGateway` new and documented; `bootstrapOSImage`/`clusterOSImage` newly deprecated; Fujitsu iRMC deprecated; ARM compute on x86 control planes exists but **Architect does not model it — state the limitation rather than staying silent**. |
| **agent / NMState** | zero mechanical deltas. The 4.22 bond example uses `mode: 802.3ad` where 4.21 used `active-backup` + `miimon`. |
| **operator / ODF** | `ocs-tls-profiles` and `odr-volsync-plugin-operator` added; SQLite catalog format deprecated. |
| **architecture** | FIPS **not** validated on aarch64; bare-metal 64-bit ARM IPI documented; homogeneous-only boundary stated. |
| **disconnected install** | mirrors absent from `pullSecret.auths` now produce an installer **warning**, not a rejection — do not overstate it. |
| **binary / tool guidance** | **NO CHANGE.** The contract is already templated (`clients/ocp/{{version}}/…`, `clients/ocp/latest-{{versionMajorMinor}}/…`, `clients/ocp/latest/oc-mirror.tar.gz`) and survives a copy verbatim. `command-audit.json` records **zero** minor-dependent commands. **Do not pin oc-mirror to 4.22**, and do not "helpfully" rewrite this during scaffolding (gap list GAP-08). |

## 5. The guard that protects all of this

`backend/src/fieldGuide/provenance.js` `certifyDocRefs` throws if any
`docs.redhat.com/.../openshift_container_platform/<X>/` URL's `<X>` does not equal the
resolved minor. It is the model the catalog-citation guard was ported from, and it is why
Field Guide `docRefs` did not accumulate the 810-citation drift the catalogs did.

Runtime-compartment and `certifyDocRefs` assertions for 4.22 **cannot run before the flip**
— they need `getAuthoritativeExport("4.22")` — so they ship with Tranche 5, not Tranche 2.
Tranche 2 gets source-tree assertions only.
