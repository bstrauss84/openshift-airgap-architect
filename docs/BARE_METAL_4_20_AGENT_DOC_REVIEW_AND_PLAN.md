# Bare Metal 4.20 Agent-based — Working Doc

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

- **Canonical:** `data/params/4.20/bare-metal-agent.json` includes install-config params (platform.baremetal: apiVIP, ingressVIP, hosts, provisioning*, etc.) and agent-config params (rendezvousIP, bootArtifactsBaseURL, additionalNTPSources, hosts[], networkConfig, etc.).
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
- Full doc scrub (install-config examples, agent-config examples, 9.1.4 / 9.2 tables, rendezvous IP, NMState) to be expanded in a dedicated pass; this doc records structure and repo state for that pass.
- apiVIPs/ingressVIPs: catalog has singular apiVIP/ingressVIP for bare-metal-agent; 4.12+ list form (apiVIPs/ingressVIPs) is canonical; backend already emits lists; consider adding apiVIPs/ingressVIPs to catalog if doc table uses them.

## Implementation / alignment (Phase E)

- No code changes in this pass for bare-metal-agent; working doc created and repo grounding verified.
- Future: align catalog with 9.1.4/9.2 tables (deprecations, allowed values, conditionals); ensure agent-config examples in docs match generator output shape.

## Testing / validation (Phase F)

- Backend smoke: includes bare-metal-agent (buildAgentConfig NTP, bootArtifactsBaseURL, minimalISO; buildInstallConfig K follow-up for bare-metal agent platform).
- validate-catalog.js: validates canonical params including bare-metal-agent.
- E2E matrix: bare-metal-agent scenario generates install-config + agent-config; validation expects platform.baremetal.

## Remaining items

- Optional: Add platform.baremetal.apiVIPs/ingressVIPs to bare-metal-agent catalog (with deprecation note for singular) to match 4.12+ doc and backend emission.
- Full Phase A doc scrub: capture all 9.1.x and 9.2.x tables, install-config and agent-config examples, and conditionals/deprecations from the official 4.20 agent doc.

## Canonical vs frontend (two-place model)

See `docs/DATA_AND_FRONTEND_COPIES.md`. Canonical params in `data/params/4.20/`; frontend copy in `frontend/src/data/catalogs/`. Sync when canonical changes.
