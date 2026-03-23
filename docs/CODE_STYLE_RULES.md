# Code style rules (Workstream H)

**Purpose:** Consistent naming and structure across `frontend/src` and `backend/src`. No behavior change. See `docs/INDEX.md` for authority mapping and `docs/PARAMS_CATALOG_RULES.md` for catalog standards.

---

## Param and state paths

- **Catalog parameter paths:** Use dot notation as in the scenario catalogs (`data/params/<version>/*.json`), e.g. `networking.machineNetwork[].cidr`, `platform.baremetal.apiVIP`. These appear in `path` and map to install-config/agent-config keys.
- **State keys (app state):** **camelCase**. Top-level: `blueprint`, `methodology`, `globalStrategy`, `hostInventory`, `platformConfig`, `credentials`, `trust`, `version`, `release`, `exportOptions`, `ui`, `reviewFlags`, `docs`. Nested keys follow camelCase (e.g. `clusterName`, `baseDomain`, `machineNetworkV4`, `apiVip`).
- **Output file names:** Literals `install-config.yaml`, `agent-config.yaml`; use constants in code (e.g. `INSTALL_CONFIG`, `AGENT_CONFIG`) where repeated.
- **Backend emit:** Keys written to YAML follow OpenShift docs (e.g. `apiVIP`, `ingressVIP` in install-config; state may use `apiVip` and is normalized on emit).

---

## File and component organization

- **React components:** **PascalCase** (e.g. `IdentityAccessStep`, `NetworkingV2Step`, `PlatformSpecificsStep`). One main default export per step file.
- **Step files:** Under `frontend/src/steps/`. Replacement steps: `IdentityAccessStep.jsx`, `NetworkingV2Step.jsx`, `ConnectivityMirroringStep.jsx`, `TrustProxyStep.jsx`, `PlatformSpecificsStep.jsx`, `HostsInventorySegmentStep.jsx`, `HostInventoryV2Step.jsx`. Legacy: `GlobalStrategyStep.jsx`, `HostInventoryStep.jsx`, etc.
- **Shared UI:** `frontend/src/components/` (e.g. `Sidebar.jsx`, `ScenarioHeaderPanel.jsx`, `PlaceholderCard.jsx`). Utilities and non-UI: `frontend/src/*.js` (e.g. `validation.js`, `catalogResolver.js`, `formatUtils.js`).
- **Backend:** `backend/src/` — `generate.js` (install-config and agent-config build), `index.js` (API, defaultState), `cincinnati.js`, `docs.js`, etc. One logical module per file.

---

## Comments

- **Component purpose:** At least one JSDoc or block comment at the top of each replacement step (and major shared components) describing what the step does and which state paths it uses.
- **Non-obvious branches:** Comment scenario-specific or platform-specific branches (e.g. "AWS GovCloud only", "bare-metal UPI: platform = none").
- **Validation blocks:** Brief comment for each major validation function or step-id branch in `validation.js` (what is being checked).
- **Backend platform blocks:** Short comment above each platform block in `generate.js` (bare metal, vSphere, AWS GovCloud, Azure, Nutanix) so the flow is scannable.
- Do not comment every line; focus on "why" and scenario/condition.

---

## Consistency checks

- Param paths used in UI (e.g. `getParamMeta(scenarioId, path, outputFile)`) should match catalog `path` for that scenario.
- State keys read in `backend/src/generate.js` must match the keys written by the frontend (camelCase state).
- New step IDs (e.g. `identity-access`, `networking-v2`) use kebab-case; they are stable and must not be changed without updating `App.jsx` and validation.
