# Bare Metal 4.20 Agent-based — Working Doc

> Authority: Working doc (scenario deep-dive)
> Canonical status source: `docs/BACKLOG_STATUS.md`
> Canonical navigation source: `docs/SCENARIOS_GUIDE.md`

Working record for the Bare Metal / 4.20 / Agent-based Installer scenario truth and implementation alignment.

## Snapshot

- **Scenario ID:** `bare-metal-agent`
- **Version:** 4.20
- **Install method:** Agent-based Installer
- **Primary docs (from docs-index):**
  - Installation config parameters (Chapter 9):  
    `https://docs.redhat.com/en/documentation/openshift_container_platform/4.20/html/installing_an_on-premise_cluster_with_the_agent-based_installer/installation-config-parameters-agent`
  - Installing with Agent-based Installer (parent):  
    `https://docs.redhat.com/en/documentation/openshift_container_platform/4.20/html/installing_an_on-premise_cluster_with_the_agent-based_installer/`
  - Disconnected / mirroring (shared):  
    `https://docs.redhat.com/en/documentation/openshift_container_platform/4.20/html/disconnected_environments/index`

## Repo grounding (Phase 0)

| Item | Path | Exists |
|------|------|--------|
| Canonical scenario params | `data/params/4.20/bare-metal-agent.json` | Yes |
| Frontend catalog | `frontend/src/data/catalogs/bare-metal-agent.json` | Yes |
| Docs-index (canonical) | `data/docs-index/4.20.json` | Yes |
| Docs-index (frontend) | `frontend/src/data/docs-index/4.20.json` | Yes |
| DATA_AND_FRONTEND_COPIES.md | `docs/DATA_AND_FRONTEND_COPIES.md` | Yes |
| PARAMS_CATALOG_RULES.md | `docs/PARAMS_CATALOG_RULES.md` | Yes |
| Bare Metal Agent working doc | `docs/BARE_METAL_4_20_AGENT_DOC_REVIEW_AND_PLAN.md` | Yes (this file) |

## Doc tree / mapping (Phase A)

| Doc | Purpose |
|-----|--------|
| installing_an_on-premise_cluster_with_the_agent-based_installer (root) | Parent agent-based installer guide |
| installation-config-parameters-agent | Chapter 9: install-config and agent-config parameter tables (9.1 install-config, 9.1.4 bare metal, 9.2 agent-config) |
| installing-disconnected | Restricted network / mirroring; shared |

**docs-index:** `data/docs-index/4.20.json` and `frontend/src/data/docs-index/4.20.json` define `bare-metal-agent` with:
- `installation-config-parameters-agent` (install-config + agent-config)
- `installing-disconnected`
- `installing-bare-metal-agent` → parent guide URL

## Params / catalog (Phase B) — summary

- **VIP truth (doc proof):** 4.20 agent-based installer guide PDF, **“Validation checks before agent ISO creation”**: **“apiVIPs and ingressVIPs parameters must be set for bare metal and vSphere platforms.”** The same section shows `platform.baremetal.apiVIPs` / `ingressVIPs` lists (dual-stack example).
- **Canonical:** `data/params/4.20/bare-metal-agent.json` includes install-config params (platform.baremetal: apiVIP/apiVIPs, ingressVIP/ingressVIPs, hosts, provisioning*, etc.) and agent-config params (rendezvousIP, bootArtifactsBaseURL, additionalNTPSources, hosts[], networkConfig, minimalISO, etc.).
- **Frontend:** `frontend/src/data/catalogs/bare-metal-agent.json` is the frontend copy; must stay in sync with canonical per DATA_AND_FRONTEND_COPIES.md.
- **Metadata:** Catalog drives getParamMeta/getCatalogForScenario, required paths, and UI hints (e.g. NTP “emitted to agent-config additionalNTPSources” for bare-metal-agent).

## AS-IS app inventory (Phase C)

- **Methodology:** Bare Metal + Agent-Based Installer → scenarioId `bare-metal-agent`.
- **Outputs:** install-config.yaml and agent-config.yaml (both generated when platform is Bare Metal and method is Agent-Based Installer).
- **Install-config:** Built by `buildInstallConfig`; for Bare Metal (non-UPI) emits `platform.baremetal` with apiVIPs, ingressVIPs, hosts, provisioning* from hostInventory; controlPlane/compute get name, replicas, architecture, hyperthreading; no controlPlane.platform or compute.platform set for bare-metal-agent in current generator (optional per params).
- **Agent-config:** Built by `buildAgentConfig`; uses hostInventory.nodes (sorted), derives rendezvousIP from first master primary IPv4; emits hosts with hostname, role, interfaces, rootDeviceHints, networkConfig (NMState); additionalNTPSources from globalStrategy.ntpServers; bootArtifactsBaseURL and minimalISO from hostInventory.
- **Networking step:** API/Ingress VIPs card shown when catalog has platform.baremetal.apiVIP* / ingressVIP* (bare-metal-agent has these; bare-metal-upi does not after Part A closeout).
- **Platform Specifics:** Provisioning network section shown for bare-metal-ipi only; for bare-metal-agent, Advanced and other catalog-driven sections apply.
- **Host Inventory:** Host drawer and node list feed both install-config (platform.baremetal.hosts) and agent-config (hosts[]) for bare-metal-agent.

## Delta analysis (Phase D)

**Delta set 1 (UI/backend/assets):**
- Preview and download both use same buildInstallConfig/buildAgentConfig; aligned.
- NTP hint in Connectivity & Mirroring explicitly mentions agent-config for bare-metal-agent.

**Delta set 2 (docs vs app):**
- **Resolved:** Catalog now includes `platform.baremetal.apiVIPs` / `platform.baremetal.ingressVIPs` list params (marked required) for bare-metal-agent, matching doc validation checks and example shape. Legacy singular forms remain as non-required “prefer list” entries.

## Implementation / alignment (Phase E)

- Updated bare-metal-agent canonical params and frontend catalog to add required VIP list params (`apiVIPs`/`ingressVIPs`) and to treat singular forms as legacy.
- Updated networking validation to enforce required VIPs when the catalog marks them required.
- Updated the Networking step helper note for bare-metal-agent to reflect requiredness.
- Updated e2e example `docs/e2e-examples/install-config/bare-metal-agent_minimal.yaml` to include required VIP lists.

## Testing / validation (Phase F)

- Backend smoke: includes bare-metal-agent (buildAgentConfig NTP, bootArtifactsBaseURL, minimalISO; buildInstallConfig K follow-up for bare-metal agent platform).
- validate-catalog.js: validates canonical params including bare-metal-agent.
- E2E matrix: bare-metal-agent scenario generates install-config + agent-config; validation expects platform.baremetal.

## Remaining items (honest)

- Full agent-based guide captures beyond Chapter 9 (validation checks before ISO, boot/discovery, nmstate vs per-host `networkConfig`).
- **IPv6-only** and **4+ control-plane** support: explicit 4.20 citations still **open** (see `docs/BARE_METAL_IPV4_IPV6_VIP_TRUTH_4_20.md`).
- **Mirroring gating:** scenario-by-scenario disconnected doc proof vs current heuristic — **open** (`docs/MIRRORING_SECTION_GATING.md`).
- **Placeholder / high-side–low-side:** future implementation per `docs/PLACEHOLDER_VALUES_DEFERRED.md` — **deferred**, not closed.

## Canonical vs frontend (two-place model)

See `docs/DATA_AND_FRONTEND_COPIES.md`. Canonical params in `data/params/4.20/`; frontend copy in `frontend/src/data/catalogs/`. Sync when canonical changes.

## Closure pass (Regression + SNO + Arbiter)

**Install-config vs agent-config (Goal 1):**
- Generator now branches Bare Metal by methodology and topology:
  - **UPI:** `platform.none` only (unchanged).
  - **Agent-based SNO** (1 control plane, 0 workers): `platform.none` only; no `platform.baremetal`, no hosts/provisioning in install-config.
  - **Agent-based multi-node:** `platform.baremetal` with **apiVIPs and ingressVIPs only**; no `hosts`, no `provisioningNetwork*` in install-config (per 4.20 doc: those are optional/Day 2; agent-config and host inventory drive provisioning).
  - **IPI:** Full `platform.baremetal` with apiVIPs, ingressVIPs, hosts, provisioning* (unchanged).
- VIP requiredness: Required for bare-metal-agent **multi-node** only. For SNO (1 master, 0 workers) validation and UI do not require API/Ingress VIPs; Networking step shows optional note for SNO.
- E2E bare-metal-agent override uses 3 master nodes so minimal path produces multi-node install-config (platform.baremetal, apiVIPs/ingressVIPs only).

**SNO (Goal 8):**
- When host inventory has 1 master and 0 workers, install-config uses `platform.none`, controlPlane.replicas: 1, compute.replicas: 0. Agent-config still emitted (rendezvousIP, hosts from inventory).

**Arbiter (Goal 9):**
- When host inventory has 2 masters and 1 arbiter (role `arbiter`), install-config gets controlPlane.replicas: 2 and `arbiter: { name: "arbiter", replicas: 1 }`.
- Catalog and host inventory support role `arbiter`; sort order is master → arbiter → worker.
- Validation: 2 control plane nodes with 0 arbiter is invalid for bare-metal-agent; hostInventoryV2Validation pushes an error and blocks generation.

**Day-2 include/exclude toggle (closeout):**
- Platform Specifics step shows "Include optional Day-2 bare metal fields in install-config" when scenario is bare-metal-agent.
- State: `hostInventory.includeBareMetalDay2InInstallConfig` (boolean). When OFF (default): Agent multi-node install-config emits only apiVIPs and ingressVIPs. When ON: also emits optional platform.baremetal hosts and provisioning* (provisioningNetwork, provisioningNetworkCIDR, etc.) per doc; agent-config remains source for install-time provisioning.
- Generator: `backend/src/generate.js` Agent multi-node branch checks `hi.includeBareMetalDay2InInstallConfig`; only when true does it add hosts and provisioning* to install-config.

**Dual-stack VIPs (closeout):**
- When `hostInventory.enableIpv6` is true, Networking step shows separate API VIP (IPv4), API VIP (IPv6), Ingress VIP (IPv4), Ingress VIP (IPv6) fields. Generator builds apiVIPs/ingressVIPs as [v4, v6].filter(Boolean); when enableIpv6 is false, uses comma-separated parsing for apiVip/ingressVip.

**Cincinnati / Blueprint minor channel (current behavior):**
- Patch list order: backend returns versions **newest first** (`backend/src/cincinnati.js` `sortVersionsDesc`).
- Minor channels: `getNewestChannel` is order-independent (semver).
- **Minor dropdown:** `sortChannelsBySemverDescending` in `frontend/src/shared/cincinnatiChannels.js` — **newest first**.
- **Default minor:** On first load when `release.channel` is unset, the app selects the newest minor and sets `release.followLatestMinor: true` (`frontend/src/steps/BlueprintStep.jsx`, `backend/src/index.js` defaultState).
- **User-chosen minor:** Changing the minor dropdown sets `followLatestMinor: false`. **Update** refreshes lists; if `followLatestMinor === true`, the minor **tracks** the newest available after refresh; if `false`, the user’s minor is **kept** when still present in the refreshed list (otherwise falls back to newest).
- **Locked foundational state:** Current minor is preserved; patches refresh for that minor.
- **Implementation note:** A forced patch fetch (`POST .../patches/update`) that **changes** the selected minor skips the next `release.channel` effect run so a follow-up `GET .../patches` cannot overwrite fresh results (`BlueprintStep.jsx` `skipChannelPatchFetchRef`).

**Placeholder values:** The Methodology **toggle is hidden**; feature deferred. See `docs/PLACEHOLDER_VALUES_DEFERRED.md`.

**IPv4 / IPv6 / VIP truth (partial audit):** See `docs/BARE_METAL_IPV4_IPV6_VIP_TRUTH_4_20.md`. IPv6-only bare metal is **not** claimed from the Chapter 9 excerpt reviewed there.

**Mirroring gating:** Documented as **current code heuristic**, not full scenario doc proof — `docs/MIRRORING_SECTION_GATING.md`.

**Node / control-plane topology:** App validates **2 control plane + 0 arbiter** as invalid for bare-metal-agent and documents **SNO** and **2+1 arbiter** flows above. **4+ control plane** and other counts are **not** re-proven against the full 4.20 agent install guide in this pass — treat stricter limits as **open** if you need explicit doc citations.

**Dual-stack field visibility (final fix):**
- Cluster Network IPv6 and Service Network IPv6 fields now appear as soon as IPv6 is enabled (`hostInventory.enableIpv6` or `showIpv6ForPlatform`), without requiring `machineNetworkV6` to be populated. Applied in `NetworkingV2Step.jsx` and `GlobalStrategyStep.jsx`. Helper text notes "Set when using dual-stack."

**Final closeout pass (2 CP + arbiter UX, role/hostname, Trust & Proxy):**
- **Generate nodes:** When scenario is bare-metal-agent and user sets Control plane = 2 and clicks "Generate nodes", the app auto-adds one arbiter node (2 masters + 1 arbiter). Node counts section shows message: "Two control plane nodes require one arbiter for this topology. Clicking Generate nodes will add one arbiter automatically." Notice appears as soon as control plane count is 2 and disappears when changed away from 2.
- **Arbiter tile/drawer:** Arbiter nodes use distinct styling (`.node-arbiter`). For arbiter role in bare-metal-agent, the drawer shows only doc-relevant fields: Role, Hostname, Use FQDN, Primary Interface/Network, DNS. Root device hint, Additional Interfaces, and Advanced (MTU, Additional Routes) are hidden for arbiter. Arbiter-specific note: "Arbiter node: hostname and primary network are used in agent-config for this 2 control plane + 1 arbiter topology."
- **Role → hostname coherence:** When user changes a node's role and the hostname is still the auto-generated default (e.g. `master-0`), the hostname is updated to the new default for that role. Custom hostnames are not overwritten.
- **Trust & Proxy:** Each proxy field passes a single child (textarea) to `FieldLabelWithInfo`; error message is a sibling. No card-level `highlight-errors`; only input-level `input-error`.
