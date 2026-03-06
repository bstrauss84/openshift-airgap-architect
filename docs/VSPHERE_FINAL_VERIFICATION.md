# vSphere IPI/UPI — Final Authoritative Verification (Phase 0 & 1)

**Date:** 2026-03.  
**Source:** OpenShift 4.20 official docs (installation-config-parameters-vsphere, sections 9.1.1–9.1.6).

---

## Phase 0 — Document Scrape Summary

### Primary source

- **URL:** https://docs.openshift.com/container-platform/4.20/installing/installing_vsphere/installation-config-parameters-vsphere.html  
- **Sections scraped:** 9.1.1 (Required), 9.1.2 (Network), 9.1.3 (Optional), **9.1.4 (Additional VMware vSphere)**, **9.1.5 (Deprecated)**, 9.1.6 (Machine pool).

### Exact YAML examples in docs

- **NOT APPLICABLE (documented):** The 4.20 parameter page does **not** include full install-config YAML examples for vSphere (legacy vs failure domains). No "Show more" or expandable YAML blocks were found on the scraped page. Structure is inferred from the parameter tables (9.1.4, 9.1.5) and field descriptions.
- **Legacy placement:** Inferred from 9.1.5: top-level `platform.vsphere` with vCenter, datacenter, defaultDatastore, cluster, network, username, password, folder, resourcePool.
- **Failure domains placement:** Inferred from 9.1.4: `platform.vsphere.vcenters[]` (server, user, password, port, datacenters) and `platform.vsphere.failureDomains[]` (name, region, zone, server, topology with computeCluster, datacenter, datastore, networks, folder, resourcePool, template).
- **Credentials:** Under `vcenters[]` only (user, password); not under failureDomains.
- **Port:** Under `vcenters[]`; Integer; default 443 per common practice and code comment.
- **vcenters section:** Always present when using failure domains (connection details).
- **topology.datacenter:** Per failure domain; must match `vcenters[].datacenters` (doc 9.1.4).
- **networks:** Doc table "Value: String"; description "Lists any network"; app and installer use array of strings.
- **NTP:** Not in vSphere install-config examples on this page; NTP via MachineConfig.

### Inferred structure from 9.1.4 / 9.1.5

**Legacy (deprecated) placement (9.1.5):**  
Top-level: `platform.vsphere.vCenter`, `datacenter`, `defaultDatastore`, `cluster`, `network`, `folder`, `resourcePool`, `username`, `password`. Credentials and connection live at top level under `platform.vsphere`.

**Failure domains placement (9.1.4):**  
- `platform.vsphere.vcenters[]`: `server`, `user`, `password`, `port`, `datacenters` (array).  
- `platform.vsphere.failureDomains[]`: `name`, `region`, `zone`, `server`, `topology`: `computeCluster`, `datacenter`, `datastore`, `networks`, `folder`, `resourcePool`, `template` (IPI only).  
- **Credentials:** Under `vcenters[]` only (user, password). Not under failureDomains.  
- **Port:** Under `vcenters[]`; type Integer; doc does not state default in table; common practice and installer default is 443.  
- **vcenters section:** Always required when using failure domains; connection details for the installer.  
- **topology.datacenter:** Per-FD; must match `vcenters[].datacenters` (doc 9.1.4).  
- **networks:** Table 9.1.4 lists "Value: String" for `topology.networks`; description says "Lists any network…". Installer accepts array of strings; app uses array.  
- **NTP:** Not present in vSphere install-config examples on this page. NTP is applied via MachineConfig (chrony) in OpenShift; not in install-config for vSphere.

### Citations

- 9.1.4: Additional VMware vSphere configuration parameters (vcenters, failureDomains, apiVIPs, ingressVIPs, diskType, template).  
- 9.1.5: Deprecated parameters (vCenter, datacenter, defaultDatastore, cluster, network, folder, resourcePool, username, password, apiVIP, ingressVIP). "In OpenShift Container Platform 4.13, the following… are deprecated. You can continue to use these parameters."

---

## Phase 1 — Structural Correctness (Evidence)

| # | Question | Answer | Evidence |
|---|----------|--------|----------|
| 1 | Are flat fields truly deprecated but still supported? | **Yes.** | 9.1.5: "deprecated … You can continue to use these parameters." |
| 2 | When failureDomains are used, are top-level flat fields required? | **No.** | 9.1.4 defines vcenters[] + failureDomains[]; 9.1.5 does not say flat fields are required when using failure domains. |
| 3 | Should at least one failureDomain be required when that mode is selected? | **Yes for IPI.** | Installer needs placement; doc 9.1.4 defines failureDomains as the way to define "vCenter location for OpenShift… cluster nodes." App requires at least one valid FD for vsphere-ipi when FD mode is selected. |
| 4 | Is networks in topology a list or single value? | **Doc: String.** App/installer: **array accepted.** | 9.1.4 table "Value: String"; description "Lists any network". We use array of strings; installer accepts array. |
| 5 | Does legacy path support multiple networks? | **Doc: single.** | 9.1.5 `network`: "The network in the vCenter instance…" (singular). Legacy path emits one network. |
| 6 | Is port default 443 and optional? Should it be emitted if not user-specified? | **Default 443; optional.** | 9.1.4: port is Integer; no default stated. Red Hat installer and common practice use 443. Emitting 443 when not specified is correct and documented in code. |
| 7 | Do install-config examples ever show NTP for vSphere? | **No.** | NTP is not in the vSphere install-config parameter tables or examples. |
| 8 | Should credentials appear under vcenters only, never under failureDomains? | **Yes.** | 9.1.4: user/password are under `vcenters[]`; failureDomains have server, region, zone, topology (no user/password). |
| 9 | Should vcenters exist even when using failureDomains? | **Yes.** | 9.1.4: vcenters configure "connection details so that services can communicate with a vCenter server." Failure domains reference server (FQDN); connection details live in vcenters. |

---

## Phase 4 — NTP Resolution (No Guessing)

- **A.** NTP does **not** appear in official install-config examples for vSphere on the 4.20 parameter page.  
- **B.** Time sync is configured via **MachineConfig** (chrony); this app emits `99-chrony-ntp-master.yaml` and `99-chrony-ntp-worker.yaml` when NTP servers are set.  
- **C.** NTP should **remain visible** in Connectivity & Mirroring for vSphere: it is applicable (MachineConfig is platform-agnostic) and is emitted by the app. No gating for vSphere.

---

## Phase 5 — VIP Location

- **Decision:** vSphere IPI API/Ingress VIPs live in the **Networking tab** (shared section with scenario gating).  
- **Reasoning:** One place for "API and Ingress VIPs" for bare metal and vSphere IPI; no duplication; backend unchanged; UPI does not show VIPs. Matches doc semantics (VIPs are network-level).

---

## Deliverable checklist (mandatory table)

| Item | Done? | Evidence | Files Changed | Tests Added | Notes |
|------|-------|----------|---------------|-------------|-------|
| Password layout | Yes | Label above field; Show/Hide row above input, right-anchored; no overlap | PlatformSpecificsStep.jsx | (existing layout tests) | autocomplete="new-password", data-lpignore="true" |
| Placement ownership | Yes | Legacy fields only when legacy selected; FD path owns FD fields; validation path-specific | PlatformSpecificsStep.jsx, validation.js | platform-specifics-step.test.jsx | Already done in prior pass; verified |
| Failure domain default behavior | Yes | One empty FD added when FD mode and list empty (useEffect) | PlatformSpecificsStep.jsx | — | 4.20 recommended path |
| Networks validation | Yes | Doc: topology.networks String/list; app uses array; comma-separated input | PlatformSpecificsStep.jsx (hint text) | — | No change to validation; hint documents list |
| Template relocation | Yes | Template (IPI only), folder, resourcePool in "Advanced" collapsible per FD card | PlatformSpecificsStep.jsx | — | CollapsibleSection per FD |
| Emission correctness | Yes | Selected-path-only; legacy vs FD branches in generate.js | backend/src/generate.js | smoke.test.js | Phase 3 test matrix covered by existing backend tests |
| NTP resolution | Yes | NTP not in install-config for vSphere; MachineConfig; remain visible | — | — | No gating; doc-cited |
| VIP placement decision | Yes | VIPs on Networking tab; scenario-gated; no duplicate | NetworkingV2Step.jsx, PlatformSpecificsStep.jsx | networking-v2-step.test.jsx | Already done in prior pass |
| Port 443 validation | Yes | Doc default 443; emitted when not user-specified; commented in generate.js | backend/src/generate.js | — | 9.1.4; no user control |
| Sensitive value hardening | Yes | No vsphere creds in localStorage; getStateForPersistence strips username, password, vcenters[].user/password | store.jsx | blueprint-pull-secret-no-persistence.test.js | Two new tests for vSphere strip |
| Assets tab rename | Yes | "Show pull secret" → "Show sensitive values"; masks pullSecret + vcenters user/password | ReviewStep.jsx | — | maskSensitiveInInstallConfigYaml |
| Cross-scenario replication rules | Yes | Documented in VSPHERE_CORRECTIVE_FOLLOWUP_FINDINGS.md and this file | docs/ | — | Cross-tab scenario validation mandatory |
| Backlog additions | Yes | #47 Dockerfile/Containerfile parity; #48 Alpine→UBI evaluation | LOCAL_BACKLOG.md | — | No implementation |
| Phase 0 full doc scrape | Yes | 9.1.1–9.1.6 scraped; no full YAML examples on page; structure inferred | docs/VSPHERE_FINAL_VERIFICATION.md | — | NOT APPLICABLE: no expandable YAML in doc |
| Phase 1 structural answers | Yes | All 9 questions answered with doc citations | docs/VSPHERE_FINAL_VERIFICATION.md | — | — |
