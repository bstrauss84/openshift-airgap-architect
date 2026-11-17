# Operators across a multi-minor OpenShift update

**Question (owner QA round 3, P3):** when a cluster updates across several minors (for example
4.20 → 4.21 → 4.22), must every installed Operator be updated at every intermediate minor?

**Short answer:** no. Before each minor update, every installed OLM Operator must **allow** the
next minor. Operators that do not block it may stay where they are. The ones that need action are:

- Operators that declare a maximum OpenShift version below the next minor;
- Operators whose channel is named after an OpenShift version;
- Operators the vendor ties to the platform minor (for example OpenShift Virtualization and
  OpenShift Data Foundation).

Sources were read from the official `openshift/openshift-docs` repository (branches
`enterprise-4.20`, `enterprise-4.21` and `enterprise-4.22`) on 2026-11-17. docs.redhat.com was not
reachable from the research environment. The file names below are the source modules and
assemblies behind the published pages.

## Findings

| # | Finding | Source (openshift-docs) |
|---|---|---|
| 1 | Before a minor update, installed Operators must be compatible with the next minor. An Operator whose CSV declares `olm.maxOpenShiftVersion` below it makes the `olm` cluster operator report `Upgradeable=False`, which blocks the minor update; z-stream updates still proceed. | `updating-without-osus-prereqs.adoc`, `olmv1-ocp-compat.adoc`, `olmv1-blocked-cluster-updates.adoc`, `cluster-operators-ref-olm-list.adoc` |
| 2 | An Operator **without** a declared maximum does not block the update. That alone does not mean it is supported on the new minor; support is checked per Operator (Red Hat's Operator Update Information Checker). | `update-best-practices.adoc`, `olmv1-ocp-compat.adoc` |
| 3 | Operators with channels named after a platform version (for example ODF `stable-4.y`, SR-IOV, PTP) need a channel change to move to the version for the next minor. Channels only move forward. With Automatic approval, an available update installs immediately. | `core-cluster-upgrade-operator-coordination.adoc`, `olm-preparing-upgrade.adoc`, `olm-changing-update-channel.adoc` |
| 4 | OLM updates along `replaces` one version at a time. `skips` / `skipRange` allow single-hop updates across several versions. `startingCSV` with Manual approval pins a version. | `olm-upgrades.adoc`; OLM upstream "Creating an update graph" |
| 5 | OpenShift Virtualization is supported only with the corresponding OpenShift minor. It is updated after the platform at each minor, and Manual approval is the documented way to control it. | `virt-about-upgrading-virt.adoc`, `virt-manual-approval-strategy.adoc`, `virt-about-control-plane-only-updates.adoc` |
| 6 | OpenShift Data Foundation is updated after OpenShift at each minor through its `stable-4.y` channel. | `updating-control-plane-only-layered-products.adoc` (plus the ODF 4.20 updating guide, search excerpts only) |
| 7 | Logging and Service Mesh: no per-minor lockstep rule was found in the platform docs. Follow each product's own update documentation. | (none found; stated as a gap, not a rule) |
| 8 | Each minor's catalog carries the Operator versions for that minor. oc-mirror's filtered catalogs mirror channel **heads** only unless the range is widened (`minVersion` / `full`), dependencies are not inferred, and content that is no longer requested is pruned. | `oc-mirror-operator-catalog-filtering.adoc`, `oc-mirror-updating-registry-about.adoc` |
| 9 | Pre-staging a new catalog is safe with Manual approval. When a CatalogSource refreshes, Operators with Automatic approval update right away. | `olm-upgrades.adoc`, `olm-preparing-upgrade.adoc` |
| 10 | The preparing-to-update guides for 4.21 and 4.22 list no Kubernetes API removals. 4.22 adds an administrator acknowledgement for boot-image opt-out on Azure and vSphere (`ack-4.21-boot-image-opt-out-in-4.22`). | `updating/preparing_for_updates/updating-cluster-prepare.adoc` (4.21, 4.22), `update-preparing-azure-vsphere-ack.adoc` |

## What Architect does with this

- **Platform hops run one at a time**, each with its own stage (release plus that minor's
  catalogs). The stage set always matches the route (P0).
- **Compatibility gate per minor hop.** Readiness reads, from the evidence bundle:
  - the `olm` cluster operator's `Upgradeable` condition;
  - each installed CSV's `olm.maxOpenShiftVersion`.

  A maximum below the next minor is **Blocked**. A maximum that blocks only a later hop is a
  **Warning** ("update before that hop"). No maximum is never shown as supported: that item stays
  the administrator's statement.
- **Per-stage channels.** The Content matrix shows each stage's selected channel next to that
  stage's catalog listing. Version-named channels get reviewable suggestions; nothing is changed
  silently (P2).
- **Operators do not have to appear in every stage.** Choose an Operator only for the stages
  where it is updated or must be present. Mirroring keeps the previous stage's content until the
  hop completes.
- **Bundles on the update path.** Filtered catalogs mirror channel heads. If an installed version
  cannot reach the head through `replaces` / `skipRange`, widen that Operator's version range in
  the stage (Mirroring's version constraints) so the path is mirrored.
- **Not automated.** Architect does not decide which Operator version is supported on a minor,
  and it never approves InstallPlans or applies CatalogSources. Those stay with the administrator,
  following each Operator's documentation.
