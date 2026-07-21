# Host Inventory Slice 5H Persistence Register (H1-P)

## Metadata

- **Register ID:** H1-P
- **Type:** Host Inventory Slice 5H Persistence Register
- **Date:** 2026-07-17
- **Last updated:** 2026-07-21
- **Branch:** develop
- **Latest commit:** fac3c79 DOC-102: Enforce Host Inventory primary networking visibility
- **Scope:** Host Inventory Agent Drawer (NodeDrawerAgentContent.jsx + HostInventoryV2Step.jsx)
- **Scenarios:** bare-metal-agent, vsphere-agent
- **Constraint:** Planning and tracking register only. No production code, tests, or catalogs modified.

### Catalogs examined

**Canonical:**
- `data/params/4.20/bare-metal-agent.json`
- `data/params/4.21/bare-metal-agent.json`
- `data/params/4.20/vsphere-agent.json`
- `data/params/4.21/vsphere-agent.json`

**Mirror:**
- `frontend/src/data/catalogs/4.20/bare-metal-agent.json`
- `frontend/src/data/catalogs/4.21/bare-metal-agent.json`
- `frontend/src/data/catalogs/4.20/vsphere-agent.json`
- `frontend/src/data/catalogs/4.21/vsphere-agent.json`

**Identity:** All 4 catalog pairs verified byte-identical

### Gate design decisions

- **root_device_hints:** Parent gate on hosts[].rootDeviceHints (committed, 7b3c12a)
- **dns:** Parent gate on hosts[].networkConfig.dns-resolver (committed, 6a208bc)
- **bmc:** Parent gate on platform.baremetal.hosts[].bmc (committed, 6ac0668). Boot MAC: independent gate on platform.baremetal.hosts[].bootMACAddress. Wrapper: union under Day-2 structural eligibility. Username/password atomic.
- **networking:** Parent gate on hosts[].networkConfig (committed, fac3c79). Applies to primary component boundary only. Does not gate Additional Interfaces.

### Semantic class definitions

| Class | Definition |
|-------|-----------|
| A | independently editable catalog leaf |
| B | child of a composite editor whose proven parent metadata is the intended visibility gate |
| C | structural or workflow control |
| D | derived or read-only presentation |
| E | genuine backend-only parameter with no editable UI |
| F | unresolved architectural conflict, missing generation, contradictory taxonomy, or missing evidence |

> Semantic class describes architecture. It must not change merely because implementation has or has not been committed. Class F does not mean 'not yet committed'.

## Provenance

- **Source audit:** H1-R3
- **Source JSON SHA-256:** `681e6b213486b8b7b2e7fc4767491583d44c8001bf890cde7d75f2f37078896c`
- **Source Markdown SHA-256:** `8807b540f244e5bcd43c8d39f7488d4bc42af9bab3236138eac5ac08c7c002fb`
- **Source validation SHA-256:** `2f497821ebfd15414501ea7adf1de72f556954b0be416565ffe520eb2bcd8d95`
- **Independent review:** H1-R3 accepted as discovery evidence; semantic classifications and cohort readiness corrected before persistence.
- **H1-R3 terminal discrepancy:** Claude's terminal summary reported 45 blocked-by-gate-design controls while its actual H1-R3 JSON, Markdown, and validation files reported 48. The tracked register uses only its newly derived corrected totals.

## Corrected Counts

- **Interactive controls:** 59
- **Accepted completions:** 36
- **Composite groups:** 13
- **Structural controls:** 39
- **Blockers:** 4
- **Excluded candidates:** 5

### Semantic class totals

| Class | Count |
|-------|-------|
| A | 2 |
| B | 34 |
| C | 3 |
| F | 20 |
| **Total** | **59** |

### Disposition totals

| Disposition | Count |
|------------|-------|
| blocked-by-gate-design | 15 |
| completed | 36 |
| open-metadata-reconciliation | 0 |
| preserved-exception | 1 |
| structural | 3 |
| unresolved-Class-F | 4 |
| **Total** | **59** |

## Accepted Completion

| Control | Label | Commit | Gate expression | Tests |
|---------|-------|--------|-----------------|-------|
| HI-002 | Hostname input | 9632caf | `isCatalogFieldVisible("hosts[].hostname", AGENT_CONFIG)` | 12 |
| HI-003 | FQDN checkbox | 9632caf | `shares hostname gate (showHostname prop)` | 12 |
| HI-004 | Root device — deviceName | 7b3c12a | `shares rootDeviceHints parent gate (showRootDeviceHints prop)` | 18 |
| HI-005 | Root device — hctl | 7b3c12a | `shares rootDeviceHints parent gate (showRootDeviceHints prop)` | 18 |
| HI-006 | Root device — model | 7b3c12a | `shares rootDeviceHints parent gate (showRootDeviceHints prop)` | 18 |
| HI-007 | Root device — vendor | 7b3c12a | `shares rootDeviceHints parent gate (showRootDeviceHints prop)` | 18 |
| HI-008 | Root device — serialNumber | 7b3c12a | `shares rootDeviceHints parent gate (showRootDeviceHints prop)` | 18 |
| HI-009 | Root device — wwn | 7b3c12a | `shares rootDeviceHints parent gate (showRootDeviceHints prop)` | 18 |
| HI-010 | Root device — minSizeGb | 7b3c12a | `shares rootDeviceHints parent gate (showRootDeviceHints prop)` | 18 |
| HI-011 | Root device — rotational | 7b3c12a | `shares rootDeviceHints parent gate (showRootDeviceHints prop)` | 18 |
| HI-012 | Primary interface type select | fac3c79 | `shares networkConfig parent gate (showPrimaryNetwork prop)` | 22 |
| HI-013 | Primary IP assignment select | fac3c79 | `shares networkConfig parent gate (showPrimaryNetwork prop)` | 22 |
| HI-014 | Primary ethernet name | fac3c79 | `shares networkConfig parent gate (showPrimaryNetwork prop)` | 22 |
| HI-015 | Primary ethernet MAC | fac3c79 | `shares networkConfig parent gate (showPrimaryNetwork prop)` | 22 |
| HI-016 | Primary bond name | fac3c79 | `shares networkConfig parent gate (showPrimaryNetwork prop)` | 22 |
| HI-017 | Primary bond mode select | fac3c79 | `shares networkConfig parent gate (showPrimaryNetwork prop)` | 22 |
| HI-018 | Primary bond member name | fac3c79 | `shares networkConfig parent gate (showPrimaryNetwork prop)` | 22 |
| HI-019 | Primary bond member MAC | fac3c79 | `shares networkConfig parent gate (showPrimaryNetwork prop)` | 22 |
| HI-020 | Primary VLAN ID | fac3c79 | `shares networkConfig parent gate (showPrimaryNetwork prop)` | 22 |
| HI-021 | Primary VLAN name | fac3c79 | `shares networkConfig parent gate (showPrimaryNetwork prop)` | 22 |
| HI-022 | Primary IPv4 CIDR | fac3c79 | `shares networkConfig parent gate (showPrimaryNetwork prop)` | 22 |
| HI-023 | Primary IPv4 gateway | fac3c79 | `shares networkConfig parent gate (showPrimaryNetwork prop)` | 22 |
| HI-024 | Primary IPv6 CIDR | fac3c79 | `shares networkConfig parent gate (showPrimaryNetwork prop)` | 22 |
| HI-025 | Primary IPv6 gateway | fac3c79 | `shares networkConfig parent gate (showPrimaryNetwork prop)` | 22 |
| HI-026 | DNS servers | 6a208bc | `shares dns-resolver parent gate (showDns prop)` | 14 |
| HI-027 | DNS search | 6a208bc | `shares dns-resolver parent gate (showDns prop)` | 14 |
| HI-028 | BMC address | 6ac0668 | `shares bmc parent gate (showBmcCore prop)` | 26 |
| HI-029 | BMC username | 6ac0668 | `shares bmc parent gate (showBmcCore prop)` | 26 |
| HI-030 | BMC password | 6ac0668 | `shares bmc parent gate (showBmcCore prop)` | 26 |
| HI-031 | Boot MAC | 6ac0668 | `isCatalogFieldVisible("platform.baremetal.hosts[].bootMACAddress", INSTALL_CONFIG)` | 26 |
| HI-032 | BMC disable cert verification | 6ac0668 | `shares bmc parent gate (showBmcCore prop)` | 26 |
| HI-033 | Primary MTU | fac3c79 | `shares networkConfig parent gate (showPrimaryNetwork prop)` | 22 |
| HI-034 | Primary route destination | fac3c79 | `shares networkConfig parent gate (showPrimaryNetwork prop)` | 22 |
| HI-035 | Primary route next-hop address | fac3c79 | `shares networkConfig parent gate (showPrimaryNetwork prop)` | 22 |
| HI-036 | Primary route next-hop interface | fac3c79 | `shares networkConfig parent gate (showPrimaryNetwork prop)` | 22 |
| HI-056 | Boot artifacts base URL | e939a41 | `isCatalogFieldVisible("bootArtifactsBaseURL", AGENT_CONFIG)` | 16 |

## Interactive Controls

| ID | Label | Class | Disposition | Cohort | Catalog path | Output |
|-----|-------|-------|-------------|--------|-------------|--------|
| HI-001 | Role select | F | preserved-exception | H9 | `hosts[].role` | agent-config.yaml |
| HI-002 | Hostname input | A | completed | — | `hosts[].hostname` | agent-config.yaml |
| HI-003 | FQDN checkbox | B | completed | — | — | agent-config.yaml |
| HI-004 | Root device — deviceName | B | completed | — | `hosts[].rootDeviceHints.deviceName` | agent-config.yaml |
| HI-005 | Root device — hctl | B | completed | — | `hosts[].rootDeviceHints.hctl` | agent-config.yaml |
| HI-006 | Root device — model | B | completed | — | `hosts[].rootDeviceHints.model` | agent-config.yaml |
| HI-007 | Root device — vendor | B | completed | — | `hosts[].rootDeviceHints.vendor` | agent-config.yaml |
| HI-008 | Root device — serialNumber | B | completed | — | `hosts[].rootDeviceHints.serialNumber` | agent-config.yaml |
| HI-009 | Root device — wwn | B | completed | — | `hosts[].rootDeviceHints.wwn` | agent-config.yaml |
| HI-010 | Root device — minSizeGb | B | completed | — | `hosts[].rootDeviceHints.minSizeGigabytes` | agent-config.yaml |
| HI-011 | Root device — rotational | B | completed | — | `hosts[].rootDeviceHints.rotational` | agent-config.yaml |
| HI-012 | Primary interface type select | B | completed | — | `hosts[].networkConfig.interfaces[].type` | agent-config.yaml |
| HI-013 | Primary IP assignment select | B | completed | — | `hosts[].networkConfig.interfaces[].ipv4.dhcp` | agent-config.yaml |
| HI-014 | Primary ethernet name | B | completed | — | `hosts[].networkConfig.interfaces[].name` | agent-config.yaml |
| HI-015 | Primary ethernet MAC | B | completed | — | `hosts[].interfaces[].macAddress` | agent-config.yaml |
| HI-016 | Primary bond name | B | completed | — | `hosts[].networkConfig.interfaces[].name` | agent-config.yaml |
| HI-017 | Primary bond mode select | B | completed | — | `hosts[].networkConfig.interfaces[].link-aggregation.mode` | agent-config.yaml |
| HI-018 | Primary bond member name | B | completed | — | `hosts[].networkConfig.interfaces[].name` | agent-config.yaml |
| HI-019 | Primary bond member MAC | B | completed | — | `hosts[].interfaces[].macAddress` | agent-config.yaml |
| HI-020 | Primary VLAN ID | B | completed | — | `hosts[].networkConfig.interfaces[].vlan.id` | agent-config.yaml |
| HI-021 | Primary VLAN name | B | completed | — | `hosts[].networkConfig.interfaces[].name` | agent-config.yaml |
| HI-022 | Primary IPv4 CIDR | B | completed | — | `hosts[].networkConfig.interfaces[].ipv4.address[].ip` | agent-config.yaml |
| HI-023 | Primary IPv4 gateway | B | completed | — | `hosts[].networkConfig.routes.config[].next-hop-address` | agent-config.yaml |
| HI-024 | Primary IPv6 CIDR | B | completed | — | `hosts[].networkConfig.interfaces[].ipv6.address` | agent-config.yaml |
| HI-025 | Primary IPv6 gateway | B | completed | — | `hosts[].networkConfig.routes.config[].next-hop-address` | agent-config.yaml |
| HI-026 | DNS servers | B | completed | — | `hosts[].networkConfig.dns-resolver.config.server` | agent-config.yaml |
| HI-027 | DNS search | B | completed | — | `hosts[].networkConfig.dns-resolver.config.search` | agent-config.yaml |
| HI-028 | BMC address | B | completed | — | `platform.baremetal.hosts[].bmc.address` | install-config.yaml |
| HI-029 | BMC username | B | completed | — | `platform.baremetal.hosts[].bmc.username` | install-config.yaml |
| HI-030 | BMC password | B | completed | — | `platform.baremetal.hosts[].bmc.password` | install-config.yaml |
| HI-031 | Boot MAC | B | completed | — | `platform.baremetal.hosts[].bootMACAddress` | install-config.yaml |
| HI-032 | BMC disable cert verification | B | completed | — | `platform.baremetal.hosts[].bmc.disableCertificateVerification` | install-config.yaml |
| HI-033 | Primary MTU | B | completed | — | — | agent-config.yaml |
| HI-034 | Primary route destination | B | completed | — | `hosts[].networkConfig.routes.config[].destination` | agent-config.yaml |
| HI-035 | Primary route next-hop address | B | completed | — | `hosts[].networkConfig.routes.config[].next-hop-address` | agent-config.yaml |
| HI-036 | Primary route next-hop interface | B | completed | — | `hosts[].networkConfig.routes.config[].next-hop-interface` | agent-config.yaml |
| HI-037 | Additional interface type select | F | blocked-by-gate-design | H6 | `hosts[].networkConfig.interfaces[].type` | agent-config.yaml |
| HI-038 | Additional interface IP assignment select | F | blocked-by-gate-design | H6 | `hosts[].networkConfig.interfaces[].ipv4.dhcp` | agent-config.yaml |
| HI-039 | Additional ethernet name | F | blocked-by-gate-design | H6 | `hosts[].networkConfig.interfaces[].name` | agent-config.yaml |
| HI-040 | Additional ethernet MAC | F | blocked-by-gate-design | H6 | `hosts[].interfaces[].macAddress` | agent-config.yaml |
| HI-041 | Additional bond name | F | blocked-by-gate-design | H7 | `hosts[].networkConfig.interfaces[].name` | agent-config.yaml |
| HI-042 | Additional bond mode select | F | blocked-by-gate-design | H7 | `hosts[].networkConfig.interfaces[].link-aggregation.mode` | agent-config.yaml |
| HI-043 | Additional bond member name | F | blocked-by-gate-design | H7 | `hosts[].networkConfig.interfaces[].name` | agent-config.yaml |
| HI-044 | Additional bond member MAC | F | blocked-by-gate-design | H7 | `hosts[].interfaces[].macAddress` | agent-config.yaml |
| HI-045 | Additional VLAN ID | F | blocked-by-gate-design | H8 | `hosts[].networkConfig.interfaces[].vlan.id` | agent-config.yaml |
| HI-046 | Additional VLAN name | F | blocked-by-gate-design | H8 | `hosts[].networkConfig.interfaces[].name` | agent-config.yaml |
| HI-047 | Additional IPv4 CIDR | F | blocked-by-gate-design | H6 | `hosts[].networkConfig.interfaces[].ipv4.address[].ip` | agent-config.yaml |
| HI-048 | Additional IPv6 CIDR | F | blocked-by-gate-design | H6 | `hosts[].networkConfig.interfaces[].ipv6.address` | agent-config.yaml |
| HI-049 | Additional MTU | F | blocked-by-gate-design | H6 | — | agent-config.yaml |
| HI-050 | Additional SR-IOV enabled checkbox | F | blocked-by-gate-design | H6 | — | agent-config.yaml |
| HI-051 | Additional SR-IOV Total VFs | F | blocked-by-gate-design | H6 | — | agent-config.yaml |
| HI-052 | Additional VRF enabled checkbox | F | unresolved-Class-F | H6 | — | none |
| HI-053 | Additional VRF name | F | unresolved-Class-F | H6 | — | none |
| HI-054 | Additional VRF table ID | F | unresolved-Class-F | H6 | — | none |
| HI-055 | Additional VRF ports | F | unresolved-Class-F | H6 | — | none |
| HI-056 | Boot artifacts base URL | A | completed | — | `bootArtifactsBaseURL` | agent-config.yaml |
| HI-057 | Control plane count | C | structural | H9 | — | none |
| HI-058 | Worker count | C | structural | H9 | — | none |
| HI-059 | Infrastructure count | C | structural | H9 | — | none |

## Completion Register

| Control | Label | Class | Disposition | Cohort |
|---------|-------|-------|-------------|--------|
| HI-001 | Role select | F | preserved-exception | H9 |
| HI-002 | Hostname input | A | completed | — |
| HI-003 | FQDN checkbox | B | completed | — |
| HI-004 | Root device — deviceName | B | completed | — |
| HI-005 | Root device — hctl | B | completed | — |
| HI-006 | Root device — model | B | completed | — |
| HI-007 | Root device — vendor | B | completed | — |
| HI-008 | Root device — serialNumber | B | completed | — |
| HI-009 | Root device — wwn | B | completed | — |
| HI-010 | Root device — minSizeGb | B | completed | — |
| HI-011 | Root device — rotational | B | completed | — |
| HI-012 | Primary interface type select | B | completed | — |
| HI-013 | Primary IP assignment select | B | completed | — |
| HI-014 | Primary ethernet name | B | completed | — |
| HI-015 | Primary ethernet MAC | B | completed | — |
| HI-016 | Primary bond name | B | completed | — |
| HI-017 | Primary bond mode select | B | completed | — |
| HI-018 | Primary bond member name | B | completed | — |
| HI-019 | Primary bond member MAC | B | completed | — |
| HI-020 | Primary VLAN ID | B | completed | — |
| HI-021 | Primary VLAN name | B | completed | — |
| HI-022 | Primary IPv4 CIDR | B | completed | — |
| HI-023 | Primary IPv4 gateway | B | completed | — |
| HI-024 | Primary IPv6 CIDR | B | completed | — |
| HI-025 | Primary IPv6 gateway | B | completed | — |
| HI-026 | DNS servers | B | completed | — |
| HI-027 | DNS search | B | completed | — |
| HI-028 | BMC address | B | completed | — |
| HI-029 | BMC username | B | completed | — |
| HI-030 | BMC password | B | completed | — |
| HI-031 | Boot MAC | B | completed | — |
| HI-032 | BMC disable cert verification | B | completed | — |
| HI-033 | Primary MTU | B | completed | — |
| HI-034 | Primary route destination | B | completed | — |
| HI-035 | Primary route next-hop address | B | completed | — |
| HI-036 | Primary route next-hop interface | B | completed | — |
| HI-037 | Additional interface type select | F | blocked-by-gate-design | H6 |
| HI-038 | Additional interface IP assignment select | F | blocked-by-gate-design | H6 |
| HI-039 | Additional ethernet name | F | blocked-by-gate-design | H6 |
| HI-040 | Additional ethernet MAC | F | blocked-by-gate-design | H6 |
| HI-041 | Additional bond name | F | blocked-by-gate-design | H7 |
| HI-042 | Additional bond mode select | F | blocked-by-gate-design | H7 |
| HI-043 | Additional bond member name | F | blocked-by-gate-design | H7 |
| HI-044 | Additional bond member MAC | F | blocked-by-gate-design | H7 |
| HI-045 | Additional VLAN ID | F | blocked-by-gate-design | H8 |
| HI-046 | Additional VLAN name | F | blocked-by-gate-design | H8 |
| HI-047 | Additional IPv4 CIDR | F | blocked-by-gate-design | H6 |
| HI-048 | Additional IPv6 CIDR | F | blocked-by-gate-design | H6 |
| HI-049 | Additional MTU | F | blocked-by-gate-design | H6 |
| HI-050 | Additional SR-IOV enabled checkbox | F | blocked-by-gate-design | H6 |
| HI-051 | Additional SR-IOV Total VFs | F | blocked-by-gate-design | H6 |
| HI-052 | Additional VRF enabled checkbox | F | unresolved-Class-F | H6 |
| HI-053 | Additional VRF name | F | unresolved-Class-F | H6 |
| HI-054 | Additional VRF table ID | F | unresolved-Class-F | H6 |
| HI-055 | Additional VRF ports | F | unresolved-Class-F | H6 |
| HI-056 | Boot artifacts base URL | A | completed | — |
| HI-057 | Control plane count | C | structural | H9 |
| HI-058 | Worker count | C | structural | H9 |
| HI-059 | Infrastructure count | C | structural | H9 |

## Composite Groups

### HG-001 — Hostname / FQDN

- **Children:** HI-002, HI-003
- **Candidate parent:** `hosts[].hostname`
- **Gate model:** parent (committed)
- **Atomicity:** atomic — FQDN shares hostname lifecycle and gate

### HG-002 — Root-device hints

- **Children:** HI-004, HI-005, HI-006, HI-007, HI-008, HI-009, HI-010, HI-011
- **Candidate parent:** `hosts[].rootDeviceHints`
- **Gate model:** parent (committed, 7b3c12a)
- **Atomicity:** atomic — all 8 hints share identical supportStatus (supported-backend-only) and lifecycle

### HG-003 — BMC

- **Children:** HI-028, HI-029, HI-030, HI-032
- **Candidate parent:** `platform.baremetal.hosts[].bmc`
- **Gate model:** parent (committed, 6ac0668 — BMC core parent + independent Boot MAC gate, wrapper union)
- **Atomicity:** non-atomic — Boot MAC (HI-031) has separate catalog path (resolved: both bmc and bootMACAddress now supported-ui, HB-003 resolved 6ac0668)

### HG-004 — Primary networking

- **Children:** HI-012, HI-013, HI-014, HI-015, HI-022, HI-023, HI-024, HI-025, HI-033, HI-034, HI-035, HI-036
- **Candidate parent:** `hosts[].networkConfig`
- **Gate model:** parent (committed, fac3c79 — hosts[].networkConfig at primary component boundary)
- **Atomicity:** non-atomic — children span supported-ui (dhcp) and supported-backend-only; MTU has no catalog entry
- **Parent evidence:** hosts[].networkConfig is supported-ui in Bare Metal Agent and vSphere Agent, versions 4.20 and 4.21, with canonical/mirror identity.

### HG-005 — Primary bond

- **Children:** HI-016, HI-017, HI-018, HI-019
- **Candidate parent:** `hosts[].networkConfig`
- **Gate model:** parent (committed, fac3c79 — shares hosts[].networkConfig parent gate at primary component boundary)
- **Atomicity:** atomic — all bond fields share lifecycle
- **Parent evidence:** hosts[].networkConfig is supported-ui in Bare Metal Agent and vSphere Agent, versions 4.20 and 4.21, with canonical/mirror identity.

### HG-006 — Primary VLAN

- **Children:** HI-020, HI-021
- **Candidate parent:** `hosts[].networkConfig`
- **Gate model:** parent (committed, fac3c79 — shares hosts[].networkConfig parent gate at primary component boundary)
- **Atomicity:** atomic — VLAN ID and name share lifecycle
- **Parent evidence:** hosts[].networkConfig is supported-ui in Bare Metal Agent and vSphere Agent, versions 4.20 and 4.21, with canonical/mirror identity.

### HG-007 — DNS

- **Children:** HI-026, HI-027
- **Candidate parent:** `hosts[].networkConfig.dns-resolver`
- **Gate model:** parent (committed, 6a208bc)
- **Atomicity:** atomic — both DNS fields share lifecycle

### HG-008 — Additional interfaces

- **Children:** HI-037, HI-038, HI-039, HI-040, HI-047, HI-048, HI-049, HI-050, HI-051, HI-052, HI-053, HI-054, HI-055
- **Candidate parent:** `hosts[].networkConfig.interfaces`
- **Gate model:** undecided (Additional Interface architecture unresolved — HB-001 VRF generation, HB-002 additional scope)
- **Atomicity:** non-atomic — Class F VRF controls alongside functional controls
- **Blockers:** HB-001, HB-002

### HG-009 — Additional bond

- **Children:** HI-041, HI-042, HI-043, HI-044
- **Candidate parent:** `hosts[].networkConfig.interfaces[].link-aggregation`
- **Gate model:** undecided (part of shared networking schema — HB-002)
- **Atomicity:** atomic
- **Blockers:** HB-002

### HG-010 — Additional VLAN

- **Children:** HI-045, HI-046
- **Candidate parent:** `hosts[].networkConfig.interfaces[].vlan`
- **Gate model:** undecided (part of shared networking schema — HB-002)
- **Atomicity:** atomic
- **Blockers:** HB-002

### HG-011 — Additional SR-IOV

- **Children:** HI-050, HI-051
- **Candidate parent:** `None`
- **Gate model:** undecided (no catalog parameter exists)
- **Atomicity:** atomic — enabled checkbox and totalVfs share lifecycle

### HG-012 — Additional VRF

- **Children:** HI-052, HI-053, HI-054, HI-055
- **Candidate parent:** `None`
- **Gate model:** N/A (Class F — no catalog, no generation)
- **Atomicity:** atomic — all 4 VRF controls are Class F together
- **Blockers:** HB-001

### HG-013 — Replication modal

- **Children:** 
- **Candidate parent:** `None`
- **Gate model:** N/A (structural workflow)
- **Atomicity:** structural — modal is a workflow element
- **Blockers:** HB-004

## BMC Sub-Boundaries

### BMC core group: `platform.baremetal.hosts[].bmc`

- **Controls:** HI-028, HI-029, HI-030, HI-032
- **Notes:** Username and password remain an atomic credential pair.

### Boot MAC separate: `platform.baremetal.hosts[].bootMACAddress`

- **Control:** HI-031
- **Notes:** Boot MAC receives an independent leaf decision. The rendered wrapper may use the union of BMC-core and Boot-MAC eligibility.

**Structural condition:** `showAgentDay2InstallConfigBmc: scenarioId === 'bare-metal-agent' && !isBareMetalAgentSnoTopology && !!inventory.includeBareMetalDay2InInstallConfig`

**Required decisions:**
- Username and password remain an atomic credential pair
- Boot MAC receives an independent leaf decision
- The rendered wrapper may use the union of BMC-core and Boot-MAC eligibility
- The existing bare-metal-Agent, non-SNO, Day-2 structural condition remains authoritative

**Constraint:** Do not claim that Boot MAC's separate path prevents all BMC-core migration.

## Blockers

### HB-001 — Additional-interface VRF generation missing

generate.js:1394-1431 additional-interface loop does not read iface.advanced.vrf. Primary VRF generation exists at 1376-1392 but primary has no UI controls. UI collects VRF name/tableId/ports for additional interfaces; values are silently discarded during generation.

- **Severity:** Class-F-blocker
- **Affected:** HI-052, HI-053, HI-054, HI-055, HG-012
- **Resolution:** Either add VRF generation to additional-interface loop in generate.js or remove VRF UI from additional interface advanced section.

### HB-002 — Shared primary/additional networking gate constraint

PARTIALLY RESOLVED (primary networking committed, fac3c79). Primary Networking, primary Bond, and primary VLAN were completed through component-scoped use of hosts[].networkConfig. Additional Interfaces remain unresolved: the hosts[].networkConfig.interfaces catalog path applies to every rendered instance, and Additional Interface visibility requires its own design decision after HB-001 VRF generation is fixed.

- **Status:** partially-resolved
- **Severity:** gate-design-blocker
- **Affected:** HG-008, HG-009, HG-010, HI-037, HI-038, HI-039, HI-040, HI-041, HI-042, HI-043, HI-044, HI-045, HI-046, HI-047, HI-048, HI-049, HI-050, HI-051, HI-052, HI-053, HI-054, HI-055
- **Resolution:** Resolve Additional Interfaces using the existing hosts[].networkConfig.interfaces parent after HB-001 VRF generation is fixed, without changing the completed Primary Networking gate.

### HB-003 — Boot MAC versus BMC lifecycle

RESOLVED. Metadata reconciliation: cb8c253 (bootMACAddress supportStatus changed to supported-ui). Visibility implementation: 6ac0668. Historical concern: Boot MAC (HI-031) had catalog path platform.baremetal.hosts[].bootMACAddress with supported-backend-only, separate from bmc parent platform.baremetal.hosts[].bmc (supported-ui). Both are now supported-ui.

- **Status:** resolved
- **Severity:** gate-design-blocker
- **Affected:** (none)
- **Resolution:** Accepted implementation: independent BMC-core gate, independent Boot-MAC gate, wrapper union under existing Day-2 structural eligibility, username/password atomic.

### HB-004 — Replication of metadata-hidden field values

Latent compatibility/safety concern, not currently proven destructive for the 4.20/4.21 catalog pair. applyReplicateSettings (hostInventoryV2Helpers.js:264-353) copies state values directly without checking catalog-based visibility. Sub-cases: (1) same-version hidden-value preservation, (2) scenario-ineligible replication, (3) version-ineligible replication, (4) downstream validation/generation behavior. Does not block H4 or H5.

- **Severity:** closeout-blocker
- **Affected:** HG-013
- **Resolution:** Filter REPLICATE_OPTIONS by current visibility state before rendering. Add version-aware replication that skips fields whose catalog metadata indicates they should be hidden for the selected version/scenario.

## Structural Controls

| ID | Label | Type | Source | Class |
|-----|-------|------|--------|-------|
| HS-001 | Replicate option: DNS servers | checkbox | frontend/src/steps/HostInventoryV2Step.jsx:51-69 (REPLICATE_OPTIONS), 894-912 (render) | C |
| HS-002 | Replicate option: DNS search domains | checkbox | frontend/src/steps/HostInventoryV2Step.jsx:51-69 (REPLICATE_OPTIONS), 894-912 (render) | C |
| HS-003 | Replicate option: Primary interface type | checkbox | frontend/src/steps/HostInventoryV2Step.jsx:51-69 (REPLICATE_OPTIONS), 894-912 (render) | C |
| HS-004 | Replicate option: IP assignment (DHCP/static) | checkbox | frontend/src/steps/HostInventoryV2Step.jsx:51-69 (REPLICATE_OPTIONS), 894-912 (render) | C |
| HS-005 | Replicate option: IPv4 CIDR | checkbox | frontend/src/steps/HostInventoryV2Step.jsx:51-69 (REPLICATE_OPTIONS), 894-912 (render) | C |
| HS-006 | Replicate option: IPv6 CIDR | checkbox | frontend/src/steps/HostInventoryV2Step.jsx:51-69 (REPLICATE_OPTIONS), 894-912 (render) | C |
| HS-007 | Replicate option: IPv4 gateway | checkbox | frontend/src/steps/HostInventoryV2Step.jsx:51-69 (REPLICATE_OPTIONS), 894-912 (render) | C |
| HS-008 | Replicate option: IPv6 gateway | checkbox | frontend/src/steps/HostInventoryV2Step.jsx:51-69 (REPLICATE_OPTIONS), 894-912 (render) | C |
| HS-009 | Replicate option: VLAN settings | checkbox | frontend/src/steps/HostInventoryV2Step.jsx:51-69 (REPLICATE_OPTIONS), 894-912 (render) | C |
| HS-010 | Replicate option: Bond mode and structure (not MACs) | checkbox | frontend/src/steps/HostInventoryV2Step.jsx:51-69 (REPLICATE_OPTIONS), 894-912 (render) | C |
| HS-011 | Replicate option: MTU, routes, advanced | checkbox | frontend/src/steps/HostInventoryV2Step.jsx:51-69 (REPLICATE_OPTIONS), 894-912 (render) | C |
| HS-012 | Replicate option: Primary ethernet MAC | checkbox | frontend/src/steps/HostInventoryV2Step.jsx:51-69 (REPLICATE_OPTIONS), 894-912 (render) | C |
| HS-013 | Replicate option: Bond member MACs | checkbox | frontend/src/steps/HostInventoryV2Step.jsx:51-69 (REPLICATE_OPTIONS), 894-912 (render) | C |
| HS-014 | Replicate option: Hostname | checkbox | frontend/src/steps/HostInventoryV2Step.jsx:51-69 (REPLICATE_OPTIONS), 894-912 (render) | C |
| HS-015 | Replicate option: Use FQDN for hostname | checkbox | frontend/src/steps/HostInventoryV2Step.jsx:51-69 (REPLICATE_OPTIONS), 894-912 (render) | C |
| HS-016 | Replicate option: Root device hints | checkbox | frontend/src/steps/HostInventoryV2Step.jsx:51-69 (REPLICATE_OPTIONS), 894-912 (render) | C |
| HS-017 | Replicate option: BMC credentials | checkbox | frontend/src/steps/HostInventoryV2Step.jsx:51-69 (REPLICATE_OPTIONS), 894-912 (render) | C |
| HS-018 | Replicate select-all checkbox | checkbox | frontend/src/steps/HostInventoryV2Step.jsx:917-932 | C |
| HS-019 | Replicate target node checkbox (per node) | checkbox | frontend/src/steps/HostInventoryV2Step.jsx:939-958 | C |
| HS-020 | Replicate Apply button | button | frontend/src/steps/HostInventoryV2Step.jsx:963 | C |
| HS-021 | Replicate Cancel button | button | frontend/src/steps/HostInventoryV2Step.jsx:962 | C |
| HS-022 | Confirm Apply button | button | frontend/src/steps/HostInventoryV2Step.jsx:991 | C |
| HS-023 | Confirm Cancel button | button | frontend/src/steps/HostInventoryV2Step.jsx:988 | C |
| HS-024 | Generate nodes button | button | frontend/src/steps/HostInventoryV2Step.jsx:700-701 | C |
| HS-025 | Clear and set counts button | button | frontend/src/steps/HostInventoryV2Step.jsx:714 | C |
| HS-026 | Node grid tile (per node) | button | frontend/src/steps/HostInventoryV2Step.jsx:735-746 | C |
| HS-027 | Drawer close button | button | frontend/src/steps/HostInventoryV2Step.jsx:779 | C |
| HS-028 | Previous node button | button | frontend/src/steps/HostInventoryV2Step.jsx:782 | C |
| HS-029 | Next node button | button | frontend/src/steps/HostInventoryV2Step.jsx:784 | C |
| HS-030 | Apply settings to other nodes button | button | frontend/src/steps/HostInventoryV2Step.jsx:787 | C |
| HS-031 | Resize handle | separator | frontend/src/steps/HostInventoryV2Step.jsx:763-767 | C |
| HS-032 | Add bond member button (primary) | button | frontend/src/components/NodeDrawerAgentContent.jsx:654-656 | C |
| HS-033 | Remove bond member button (primary) | button | frontend/src/components/NodeDrawerAgentContent.jsx:646-649 | C |
| HS-034 | Add Route button (primary) | button | frontend/src/components/NodeDrawerAgentContent.jsx:923-924 | C |
| HS-035 | Remove Route button (primary) | button | frontend/src/components/NodeDrawerAgentContent.jsx:916-917 | C |
| HS-036 | Advanced toggle (primary) | button | frontend/src/components/NodeDrawerAgentContent.jsx:840-851 | C |
| HS-037 | Add Interface button (additional) | button | frontend/src/components/NodeDrawerAgentContent.jsx:1207-1209 | C |
| HS-038 | Remove Interface button (additional) | button | frontend/src/components/NodeDrawerAgentContent.jsx:956-958 | C |
| HS-039 | Advanced Networking toggle (additional, per interface) | button | frontend/src/components/NodeDrawerAgentContent.jsx:1106-1116 | C |

## Cross-Step Dependencies

### XD-001 — Include Day-2 nodes in install-config

- **UI source:** `frontend/src/steps/PlatformSpecificsStep.jsx` lines 1358-1359
- **State path:** `inventory.includeBareMetalDay2InInstallConfig`
- **Host Inventory effect:** Controls showAgentDay2InstallConfigBmc together with scenarioId === 'bare-metal-agent' and non-SNO topology
- **Validation:** `frontend/src/hostInventoryV2Validation.js:55`
- **Generation:** `backend/src/generate.js:292,309`
- **Class:** C — Cross-step workflow control
- **Scope:** Outside the Host Inventory interactive-control denominator, but an explicit H2 BMC dependency. Rendered UI belongs to Platform Specifics, not the Host Inventory step.

## Excluded Candidates

| ID | Label | Source | Reason |
|-----|-------|--------|--------|
| EX-001 | Delete node button (per grid tile) | frontend/src/steps/HostInventoryV2Step.jsx | Structural control. No configuration state. No emitted artifact. |
| EX-002 | Add node button | frontend/src/steps/HostInventoryV2Step.jsx | Structural control. No configuration state. No emitted artifact. |
| EX-003 | Copy-command buttons in host-information gathering section | frontend/src/steps/HostInventoryV2Step.jsx | Structural instructional controls. No configuration state. No emitted artifact. No catalog visibility requirement. Outside Slice 5H configuration-field scope. |
| EX-004 | Instructional CollapsibleSection toggles in host-information gathering | frontend/src/steps/HostInventoryV2Step.jsx | Structural instructional controls. No configuration state. No emitted artifact. No catalog visibility requirement. Outside Slice 5H configuration-field scope. |
| EX-005 | Other instructional buttons that only copy displayed shell commands | frontend/src/steps/HostInventoryV2Step.jsx | Structural instructional controls. No configuration state. No emitted artifact. No catalog visibility requirement. Outside Slice 5H configuration-field scope. |

> Non-configuration instructional controls in HostInventoryV2Step.jsx are explicitly excluded.
> No configuration-state mutation. No generated-artifact effect. No catalog visibility requirement.
> Outside Slice 5H configuration-field scope.

## Cohort Readiness

| Cohort | Name | Status | Controls |
|--------|------|--------|----------|
| H2 | BMC | completed | 5 (HI-028, HI-029, HI-030, HI-031, HI-032) |
| H3 | Primary networking | completed | 12 (HI-012, HI-013, HI-014, HI-015, HI-022, HI-023, HI-024, HI-025, HI-033, HI-034, HI-035, HI-036) |
| H4 | DNS | completed | 2 (HI-026, HI-027) |
| H5 | Root-device hints | completed | 8 (HI-004, HI-005, HI-006, HI-007, HI-008, HI-009, HI-010, HI-011) |
| H6 | Additional interfaces | blocked-by-Class-F | 13 (HI-037, HI-038, HI-039, HI-040, HI-047, HI-048, HI-049, HI-050, HI-051, HI-052, HI-053, HI-054, HI-055) |
| H7 | Bond | primary-complete-additional-deferred | 8 (HI-016, HI-017, HI-018, HI-019, HI-041, HI-042, HI-043, HI-044) |
| H8 | VLAN | primary-complete-additional-deferred | 4 (HI-020, HI-021, HI-045, HI-046) |
| H9 | Closeout | blocked-by-Class-F/open-closeout | 4 (HI-001, HI-057, HI-058, HI-059) |

## Next Actions

1. H6 Additional Interfaces architecture and generation resolution
2. HB-001 VRF generation decision
3. Additional Interface MTU and SR-IOV metadata/generation reconciliation
4. Additional Bond and VLAN visibility
5. HB-004 replication safety
6. H9 final closeout
7. Slice 5I version-aware validation
8. Slice 5J version-aware generation

---

*Generated from docs/HOST_INVENTORY_SLICE_5H_REGISTER.json. JSON is authoritative.*
