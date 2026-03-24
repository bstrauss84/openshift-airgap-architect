# Clusterfile vs OpenShift Airgap Architect — Feature Analysis and Implementation Plan

> Authority: Working comparative analysis
> Canonical status source: `docs/BACKLOG_STATUS.md`
> Canonical navigation source: `docs/INDEX.md`

**Purpose:** Comprehensive comparison between our app (OpenShift Airgap Architect) in its current state and [purefield/clusterfile](https://github.com/purefield/clusterfile), followed by a detailed plan for adopting beneficial and doc-aligned improvements in our own way (not as a 1:1 clone).

**References:**
- Our app: `frontend/src`, `backend/src`, `data/params`, `data/docs-index`, `AGENTS.md`, `README.md`, `docs/DATA_AND_FRONTEND_COPIES.md`
- Clusterfile: README, DATA_SCHEMA.md, schema/clusterfile.schema.json, data/baremetal.clusterfile, process.py, TEMPLATE_install-config.md, apps/editor

---

## 1. Executive Summary

| Dimension | Our app | Clusterfile |
|-----------|---------|-------------|
| **Primary model** | Wizard (Blueprint → Methodology → scenario steps → Operators → Assets) | Single declarative YAML “clusterfile” + Jinja2 templates → rendered outputs |
| **Outputs** | install-config.yaml, agent-config.yaml (when agent), imageset-config.yaml, FIELD_MANUAL.md, NTP MachineConfigs | install-config, agent-config, ACM ZTP, operators, pre-flight scripts, KubeVirt, SiteConfig, etc. |
| **UI** | React + Vite, scenario-driven steps, catalog-driven Host Inventory v2 | Web editor (FastAPI + vanilla JS), schema-driven forms; CLI-first (process.py) |
| **Validation** | JS step/field validation (IP/CIDR, SSH, pull secret, catalog-driven required paths) | JSON Schema + optional -s/-S; yamllint on output; template meta |
| **Data source** | Canonical `data/params/<ver>/*.json` + `data/docs-index`; frontend copies under `frontend/src/data/` | Single clusterfile YAML + schema; file paths for secrets/manifests |
| **Doc links** | Scenario-level (ScenarioHeaderPanel); catalogs have citations but no per-field doc links in UI | Schema `x-doc-url` per property; editor can surface “link to docs” in tooltips/icons |

Findings that matter most for us:
- **Location and manifests:** Clusterfile has `cluster.location` and `cluster.manifests` (extra Kubernetes manifests at install). We do not. Per official docs, **manifests** (extra manifests at install) are a documented bare-metal/install-config capability; **location** is a logical label (not a direct install-config field) but useful for ops/labeling.
- **Per-field doc links:** Clusterfile’s schema drives `x-doc-url` into the editor; we have citations in catalogs but do not surface “open docs” next to fields. Adding doc links to our tooltips/labels would improve usability without copying their UI.
- **Pre-flight checks, ACM ZTP, SiteConfig, KubeVirt:** Clusterfile generates scripts and CRs we don’t. Some (e.g. pre-flight scripts, ACM ZTP) are high value for advanced users; we should consider as optional/future scope rather than cloning.

---

## 2. Our App — Summary of Current State

### 2.1 Architecture and flow
- **Landing** → **Blueprint** (platform, arch, release, pull secret) → **Methodology** (IPI/UPI/Agent-Based) → **Segmented steps:** Identity & Access, Networking, Connectivity & Mirroring, Trust & Proxy, Platform Specifics, Hosts/Inventory (when Bare Metal) → **Operators** → **Assets & Guide** (preview, export, FIELD_MANUAL).
- **State:** React context (`store.jsx`), synced to backend and localStorage; credentials stripped for persistence (`getStateForPersistence`).
- **Backend:** Express, SQLite (state, job history), Cincinnati, operator scan (oc-mirror), YAML generation (`generate.js`), export ZIP, docs cache.

### 2.2 Key outputs
- **install-config.yaml** — All scenarios; platform blocks: baremetal, vsphere, aws, nutanix, none (UPI).
- **agent-config.yaml** — Bare Metal + Agent-Based only; hosts, rendezvousIP, networkConfig (NMState), rootDeviceHints, NTP, etc.
- **imageset-config.yaml** — oc-mirror v2 (channel/version + operators).
- **FIELD_MANUAL.md** — Version-specific notes and doc links (from docs cache).
- **NTP MachineConfigs** — When NTP set: `99-chrony-ntp-master.yaml`, `99-chrony-ntp-worker.yaml`.

### 2.3 Data and catalogs
- **Canonical:** `data/params/<version>/*.json` (parameter catalogs per scenario), `data/docs-index/<version>.json` (scenario → doc links). See `docs/DATA_AND_FRONTEND_COPIES.md`.
- **Frontend copies:** `frontend/src/data/catalogs/*.json`, `frontend/src/data/docs-index/*.json`. Catalogs include `path`, `outputFile`, `type`, `required`, `description`, `citations` (docId, docTitle, sectionHeading, url).
- **Catalog usage:** `catalogPaths.js`, `catalogFieldMeta.js` (getFieldMeta, hasAllowedList), Host Inventory v2 and Platform Specifics use catalog for sections/required paths; validation uses `getRequiredParamsForOutput` and catalog-driven rules.

### 2.4 Validation
- **validation.js:** IPv4/IPv6/CIDR, MAC, SSH public key, pull secret JSON, CIDR overlap, AWS subnet roles, trust bundle policy (version-aware), platform-specific (e.g. VIPs for bare-metal-agent). Host inventory: per-node and catalog-driven required paths via `getCatalogValidationForInventoryV2` / `mergeNodeValidation`.

### 2.5 Documentation and links
- **Scenario-level:** `ScenarioHeaderPanel` shows scenario name, version, “This will generate,” and **documentation** links from `docs-index` (per scenario).
- **Per-field:** Catalogs have `citations[]` with `url` and `docTitle`, but the UI only passes `description` (or composed hint) to `FieldLabelWithInfo`; **no per-field “Open docs” link or icon** next to inputs.

### 2.6 Logging and debugging
- **logger.js:** `logAction(action, context)` — safe, no credentials; used for step changes, generate, export, theme, etc.
- **Backend:** Job logs for operator scan and long-running work; no structured request/validation logging described in codebase.

### 2.7 Conditional gating and presentation
- Steps and sections are scenario-driven: e.g. Hosts/Inventory only for Bare Metal; Platform Specifics varies (vSphere IPI vs bare-metal-agent); API/Ingress VIPs when catalog has platform.baremetal.apiVIPs/ingressVIPs; provisioning network for bare-metal-ipi.
- `schema/stepMap.json` and `getScenarioId` drive which steps appear; Host Inventory v2 uses `getSectionOrderForRender` and catalog paths.

### 2.8 What we do not have (relative to clusterfile)
- No **cluster “location”** field (logical env/datacenter label).
- No **extra manifests** (install-config mechanism to add user manifests at install); generate.js does not emit any manifest list.
- No **per-field doc link** in tooltips/labels (citations exist in data only).
- No **pre-flight check** script generation (DNS, NTP, BMC, network, registry).
- No **ACM ZTP / CAPI / SiteConfig / KubeVirt** output; we focus on install-config, agent-config, imageset-config, and field manual.
- No **Jinja2/template** engine; we build YAML programmatically in `generate.js`.
- No **JSON Schema** validation of full state; we use ad-hoc step/field validators.
- No **CLI** or “parameter-only” mode; we are UI + API only.

---

## 3. Clusterfile — Summary

### 3.1 Model
- **One YAML file (clusterfile)** with sections: `account`, `cluster`, `network`, `hosts`, optional `plugins` (operators, platforms). Single source of truth; **templates** (Jinja2) produce install-config, agent-config, ACM ZTP, operator manifests, pre-check scripts, etc.
- **CLI:** `process.py data/file.clusterfile templates/install-config.yaml.tpl`; `-p key=value` overrides; `-s schema.json` and `-S` for validation.

### 3.2 Cluster section (relevant to “location” and “manifests”)
- **location:** String (max 128 chars), “Logical environment identifier for labels and metadata.” Not a standard install-config key; used for labeling/organization.
- **manifests:** Array of `{ name, file }` — “Extra Kubernetes manifests to apply during installation.” Schema points to Red Hat doc: “installation-user-infra-generate-k8s-manifest-ignition”. This maps to the **install-time extra-manifests** mechanism in OpenShift (bare metal / agent-based docs).

### 3.3 Schema and editor
- **clusterfile.schema.json:** Full JSON Schema with `$defs` (ipv4, ipv6, cidr, macAddress, bondMode, vlanId, etc.), `x-doc-url` and `x-group` on many properties; `x-is-file` for paths. Editor uses schema for form generation and can surface doc links.
- **DATA_SCHEMA.md:** Human-readable summary of required/optional and “files to import” (pullSecret, trustBundle, bmc.password, sshKeys, manifests, etc.).

### 3.4 Outputs and use cases
- install-config, agent-config; ACM ZTP (Namespace, Secrets, AgentClusterInstall, ClusterDeployment, BareMetalHosts, NMState, InfraEnv); ACM CAPI + Metal3; Day-2 operators (ArgoCD, LVM, ODF, ACM, cert-manager, external-secrets); SiteConfig ClusterInstance; KubeVirt; **pre-flight scripts** (pre-check.sh.tpl, pre-check-dns, pre-check-bmc, etc.).

### 3.5 Validation and tooling
- Schema validation before/after `-p` overrides; yamllint on rendered YAML; template `@meta` for requires/platforms; `LoggingUndefined` for missing vars (warnings to stderr).

### 3.6 Web editor
- FastAPI app, vanilla JS, schema-driven forms, live YAML preview, template rendering; offline-first; runs as container (quay.io/dds/clusterfile-editor).

---

## 4. Aspect-by-Aspect Comparison

| Aspect | Our app | Clusterfile |
|--------|---------|-------------|
| **Layout / structure** | Wizard with sticky step headers; cards and notes; sidebar step list | Single-page editor + CLI; schema-driven form layout; optional groups (x-group, x-group-collapsed) |
| **Font / format** | PatternFly-derived CSS; consistent cards, buttons, animations | Editor- and CLI-specific; no shared design system with our app |
| **Form structure** | Step per “theme” (Identity, Networking, …); Host Inventory: grid + drawer; catalog-driven sections | Schema-driven; one big clusterfile edited as form or YAML |
| **Validation** | Step-level + field-level in JS; catalog required paths; no schema validation of full payload | JSON Schema (-s/-S); yamllint on output; template meta |
| **Logging** | Frontend: logAction (safe); backend: job logs | process.py: WARNING to stderr for missing vars, validation errors; no structured app logging |
| **Debugging** | Browser devtools; backend job history and logs | stderr; no built-in debug UI |
| **Documentation presentation** | Scenario summary with doc links; FIELD_MANUAL in Assets step | Schema x-doc-url; editor can show “docs” link per field |
| **Conditional gating** | Scenario + stepMap + catalog (which steps/sections show) | Template conditionals (if platform, if disconnected); schema required/optional |
| **Templating** | None; generate.js builds objects and js-yaml | Jinja2; includes; platform/operator plugins |
| **Data model** | Nested state (blueprint, methodology, globalStrategy, hostInventory, platformConfig, …) | Flat clusterfile (account, cluster, network, hosts, plugins) |
| **Credentials** | Never persisted by default; optional export; helpers (pull secret, SSH) not stored | File paths in clusterfile (pullSecret, bmc.password, etc.); content not in repo |
| **Bare metal host model** | Nodes array; role, hostname, interfaces, primary/bond/vlan, rootDevice, BMC, networkConfig | Hosts keyed by FQDN; role, storage, bmc, network (interfaces, primary.address/ports) |
| **Location** | Not present | cluster.location (string, logical env) |
| **Manifests** | Not present | cluster.manifests (array of {name, file}) for extra install manifests |
| **Version support** | 4.17–4.20; version in Blueprint; version-aware policies | Schema enums 4.14–4.21 + semver; single version in clusterfile |
| **Operators** | Operators step; discovery (oc-mirror list operators); imageset-config; Quick Picks | plugins.operators with channel/source/approval; templates emit manifests + ACM policies |

---

## 5. What Clusterfile Does That We Do Not

- **Location:** `cluster.location` — logical identifier (e.g. dc1) for labels/metadata.
- **Manifests:** `cluster.manifests` — list of {name, file} for extra Kubernetes manifests at install (documented install-config capability for bare metal).
- **Per-field doc links:** Schema `x-doc-url` surfaced in editor (tooltips/icons linking to Red Hat docs).
- **Pre-flight scripts:** Templates that generate shell scripts for DNS, NTP, BMC, network, registry checks.
- **ACM ZTP / CAPI / SiteConfig:** Full CR generation for managed clusters and SiteConfig ClusterInstance.
- **KubeVirt / OpenShift Virtualization:** VirtualMachine and related manifests.
- **Day-2 operator manifests + ACM policies:** Standalone manifests and Policy/PlacementBinding for each operator.
- **Jinja2 + JSON Schema:** Template-based generation and schema validation of input.
- **CLI and -p overrides:** Parameter-only and override-from-command-line.
- **Single declarative file:** One clusterfile vs our multi-step wizard state.
- **Schema-driven form generation:** Editor builds forms from schema (we use explicit React components + catalog for Host Inventory / Platform Specifics).
- **Mirror “insecure” and “prefix”:** Explicit insecure and prefix in mirror entries (we have imageDigestSources; insecure is a separate concern in OpenShift).
- **catalogSources** in clusterfile: Custom CatalogSource list for disconnected (we have operator catalogs in imageset-config and UI; different shape).
- **Machine spec (cluster-level):** cpus, sockets, memory, storage (os/data) at cluster or host level in schema (we don’t model machine sizing in install-config).

---

## 6. What We Should Adopt (and Why)

### 6.1 Align with official docs / best practice (should have)

- **Extra manifests (install-config):**  
  Red Hat docs describe adding user-provided manifests at install (e.g. “Generate Kubernetes manifest and Ignition config” for bare metal). We **should** support this: optional list of manifests (name + path or content reference) and emit the appropriate install-config structure when supported for the scenario (e.g. bare-metal-agent). Design: path-only or “include in bundle” to avoid storing content in state; user-initiated only.

- **Per-field documentation links:**  
  Our catalogs already have `citations[].url` and `docTitle`. We **should** surface them in the UI (e.g. “Docs” or “?” link next to the info icon, or in the tooltip) so users can jump to the exact doc section. This is best practice for configuration UIs and does not require copying clusterfile’s schema or editor.

- **Location (optional, low priority):**  
  `cluster.location` is not an install-config field; it’s for labeling (e.g. topology.kubernetes.io/datacenter). We could add an optional “Location” or “Environment label” in Identity & Access or Blueprint and use it in FIELD_MANUAL or future metadata/labels. Not required by install-config; **nice-to-have** for consistency with clusterfile and ops.

### 6.2 Beneficial to implement (would help users)

- **Pre-flight check generation:**  
  Offering generated scripts (or a “Pre-flight” section in FIELD_MANUAL with commands) for DNS, NTP, BMC reachability, and registry would help users validate before install. We can do this in our own format (e.g. markdown with copy-paste commands or a single script in the export bundle) rather than adopting Jinja2.

- **Clearer “Disconnected” and mirror semantics:**  
  Clusterfile’s `disconnected: true` and explicit `catalogSources` make the disconnected story obvious. We already have mirroring and operator catalogs; we could add an explicit “Disconnected install” checkbox and a short “Custom CatalogSources” note in FIELD_MANUAL or Connectivity step to align with docs.

- **Schema or schema-like validation (optional):**  
  A JSON Schema for our persisted state (or at least for the payload we send to generate) could catch structural errors early. This is a larger change; benefit is consistency and fewer “mystery” generate errors. Not mandatory; consider after location/manifests/doc links.

### 6.3 Explicitly out of scope (for this plan)

- **ACM ZTP / CAPI / SiteConfig / KubeVirt:** Valuable for some users but different product surface; we stay focused on install-config, agent-config, imageset-config, and field manual unless product scope changes.
- **Jinja2 and single clusterfile:** Our wizard and state model are a strength; we don’t move to a single YAML input or template engine.
- **1:1 clone of clusterfile editor:** We keep our layout, fonts, and step flow; we only adopt concepts (e.g. doc links, manifests, location) in our own UI.

---

## 7. Implementation Plan (Making It Our Own)

### Phase 1 — Per-field doc links (high impact, low risk)

- **Goal:** Surface existing catalog citations as “Open documentation” next to relevant fields.
- **Data:** Catalogs already have `citations[].url` and `docTitle`. Add a small helper, e.g. `getCitationUrl(scenarioId, outputFile, path)` that returns the first citation URL for that parameter (or extend catalogFieldMeta.js to expose citation).
- **UI:** Extend `FieldLabelWithInfo` (or the pattern used where we show hints) to optionally accept a `docUrl` (and `docTitle`). When present, show a small “Open docs” link or icon next to the (i) that opens `docUrl` in a new tab. Use wherever we already use catalog description (Host Inventory v2, Platform Specifics, etc.).
- **Consistency:** Keep existing scenario-level doc links in ScenarioHeaderPanel; add per-field links only where we have a catalog path and citation. No new backend; no schema change.

### Phase 2 — Extra manifests (install-config, doc-aligned)

- **Goal:** Support optional “extra manifests” for install so generated install-config matches Red Hat’s documented capability (bare metal / agent-based).
- **Docs check:** Confirm exact install-config key name and shape for “user-provided manifests” for 4.17–4.20 (e.g. under platform.baremetal or top-level); implement to match.
- **State:** Add optional `extraManifests` (e.g. `{ name: string, filePath?: string }[]`) under a suitable key (e.g. `platformConfig` or a new `installConfigOverrides`). No file content in state; paths or “include in bundle” only.
- **UI:** New small section (e.g. in Platform Specifics or Identity & Access when scenario is bare-metal-agent) for “Extra manifests (optional)”: list of manifest name + path; “Add manifest” / remove. Help text + link to Red Hat “generate Kubernetes manifest and Ignition” (or equivalent) section.
- **Generate:** In `buildInstallConfig`, when scenario is bare-metal-agent (and optionally bare-metal-ipi if docs support it), if `extraManifests` has entries, emit the required install-config structure (paths only in YAML; export bundle can include files if we add “include in bundle” later).
- **Export:** If “include in bundle” is chosen, copy referenced files into the ZIP (with path validation and size limits); otherwise only paths in install-config.
- **Validation:** Optional: manifest names must be DNS-subdomain style; paths must be safe (no traversal). No credentials in manifest list.

### Phase 3 — Location (optional label)

- **Goal:** Optional “Location” / “Environment label” for use in docs or future metadata.
- **State:** Optional `blueprint.location` or `clusterIdentity.location` (string, max 128).
- **UI:** Single optional text field in Identity & Access or Blueprint step: “Location (e.g. datacenter name)” with short hint: “Used for labeling; not an install-config field.”
- **Output:** Do not emit to install-config (not a standard key). Use in FIELD_MANUAL (e.g. “Cluster location: {{ location }}”) or in future metadata/labels if we add that. Keeps our model simple.

### Phase 4 — Pre-flight guidance (our format)

- **Goal:** Help users run DNS/NTP/BMC/registry checks before install.
- **Approach:** No Jinja2. Add a “Pre-install checks” section to FIELD_MANUAL (or a separate card in Assets & Guide) with version-appropriate commands and placeholders (e.g. “Check NTP: chronyc sources; expected: your NTP servers”). Optionally, backend could generate a single `pre-flight.sh` (or markdown) from state (VIPs, NTP, registry, BMC hints) and include it in the export bundle. No clusterfile template dependency.

### Phase 5 — Disconnected and CatalogSources (clarity)

- **Goal:** Make disconnected install and custom CatalogSources more visible and doc-aligned.
- **UI:** In Connectivity & Mirroring (or Mirroring card), when mirroring is configured, show a short note: “For fully disconnected installs, disable default OperatorHub sources and use custom CatalogSources (see docs).” Optional checkbox “Disconnected install” that sets a flag used only for FIELD_MANUAL text and future use.
- **FIELD_MANUAL:** When disconnected flag is set (or mirroring is used), add a subsection on custom CatalogSources and link to Red Hat disconnected docs. No change to imageset-config structure unless we later add explicit CatalogSource YAML generation.

### Phase 6 — Validation and robustness (optional, later)

- **Goal:** Fewer generate-time surprises.
- **Options:** (a) Add a JSON Schema for the subset of state that drives generate and validate on “Generate” or export; (b) Add more catalog-driven required checks and clearer error messages. Choose one; schema is more work but pays off for API and future tooling.

---

## 8. Order and Dependencies

| Phase | Depends on | Effort (rough) |
|-------|------------|----------------|
| 1 — Per-field doc links | None | Small |
| 2 — Extra manifests | Docs confirmation | Medium |
| 3 — Location | None | Small |
| 4 — Pre-flight guidance | None | Small–medium |
| 5 — Disconnected/CatalogSources | None | Small |
| 6 — Schema/validation | 1–5 | Medium |

Recommended order: **1 → 2 → 3** (doc links first for immediate UX; then doc-mandated manifests; then location). Then 4 and 5 as capacity allows; 6 when we want stricter contracts.

---

## 9. What We Explicitly Do Not Copy

- **Single clusterfile YAML as primary input** — We keep the wizard and our state shape.
- **Jinja2 and template-based generation** — We keep programmatic generate.js.
- **Clusterfile’s editor layout and schema-driven form generation** — We keep our steps and components; we only adopt ideas (doc links, manifests, location).
- **ACM ZTP / CAPI / SiteConfig / KubeVirt outputs** — Out of scope unless product scope changes.
- **CLI and -p overrides** — Remain UI + API; no requirement to add a CLI.
- **File-path-only credentials** — We keep “paste/upload or generate; don’t persist” and optional export.

---

## 10. Git Commands to Add and Commit This Document

```bash
git add docs/CLUSTERFILE_FEATURE_ANALYSIS_AND_PLAN.md
git commit -m "docs: add Clusterfile vs Airgap Architect analysis and implementation plan

- Feature/comprehensiveness comparison (layout, validation, docs, templating, etc.)
- Gap analysis: location, manifests, per-field doc links, pre-flight, ACM/KubeVirt
- Doc-aligned recommendations: extra manifests, per-field doc links, optional location
- Phased implementation plan (doc links → manifests → location → pre-flight → disconnected)
- Explicit non-goals: single clusterfile, Jinja2, 1:1 editor clone, ACM ZTP/CAPI/SiteConfig"
```

---

*End of document.*
