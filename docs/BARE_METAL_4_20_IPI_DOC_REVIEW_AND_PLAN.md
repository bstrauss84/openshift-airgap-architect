## Bare Metal 4.20 IPI — Working Doc

This file is the **working record** for the Bare Metal / 4.20 / IPI truth pass (docs-index mapping, full-doc review, params reconciliation, AS-IS inventory, discrepancy analysis, and implementation plan). It is intentionally concise; the main narrative and matrices live in this markdown plus the primary source docs.

### Snapshot

- **Scenario ID:** `bare-metal-ipi`
- **Version:** 4.20
- **Install method:** Installer-provisioned infrastructure (IPI)
- **Primary docs (confirmed):**
  - Bare metal install book (parent):  
    `https://docs.redhat.com/en/documentation/openshift_container_platform/4.20/html/installing_on_bare_metal/`
  - Bare metal IPI chapter (Chapter 3 — installer-provisioned infrastructure):  
    `https://docs.redhat.com/en/documentation/openshift_container_platform/4.20/html/installing_on_bare_metal/installer-provisioned-infrastructure`
  - Install-config/agent-config parameter tables (Agent-based installer):  
    `https://docs.redhat.com/en/documentation/openshift_container_platform/4.20/html/installing_an_on-premise_cluster_with_the_agent-based_installer/installation-config-parameters-agent`
  - Disconnected / mirroring (shared):  
    `https://docs.redhat.com/en/documentation/openshift_container_platform/4.20/html/disconnected_environments/index`
  - Platform-agnostic install-config (proxy / trust bundle, sample install-config):  
    `https://docs.redhat.com/en/documentation/openshift_container_platform/4.20/html/installing_on_any_platform/installing-platform-agnostic`

### Current high-confidence findings (summary)

1. **Docs-index mapping**
   - `data/docs-index/4.20.json` and `frontend/src/data/docs-index/4.20.json` both define a `bare-metal-ipi` scenario that points at:
     - `installation-config-parameters-agent`
     - `installing-disconnected`
     - `installing-bare-metal-ipi`
   - The **books and version are correct**, but `installing-bare-metal-ipi` currently uses the bare metal book root URL instead of the specific IPI chapter URL (`.../installer-provisioned-infrastructure`). This is **a structural weakness, not a functional bug**.

2. **Doc truth for special topics**
   - **Provisioning network modes:** docs clearly define `platform.baremetal.provisioningNetwork` with `Managed`, `Unmanaged`, and `Disabled`, plus associated expectations:
     - `Managed` — Ironic-managed DHCP/TFTP on provisioning network; no external DHCP on that network.
     - `Unmanaged` — provisioning network present but DHCP configured externally; virtual media recommended; PXE still possible.
     - `Disabled` — no provisioning network; virtual-media/Assisted only; two IPs on bare-metal network reserved for provisioning services; BMCs must be reachable on bare-metal network for power management.
   - **Provisioning CIDR/MAC/DHCP range:**  
     `clusterProvisioningIP`, `provisioningNetworkCIDR`, `provisioningDHCPRange`, `provisioningMACAddress`, and `provisioningNetworkInterface` are fully documented in both the IPI chapter and 9.1.4 bare metal parameter table.
   - **Hosts / BMC / rootDeviceHints / bootMACAddress:**  
     `platform.baremetal.hosts[]` with `name`, `role`, `bmc.{address,username,password,disableCertificateVerification}`, `bootMACAddress`, and `rootDeviceHints` (with strong guidance to use `/dev/disk/by-path/` or WWN) is extensively documented, including troubleshooting for “No disk found with matching rootDeviceHints”.
   - **VIPs and dual-stack:**  
     The bare metal IPI chapter includes an explicit dual-stack example using `platform.baremetal.apiVIPs` and `platform.baremetal.ingressVIPs` (lists) and explains that list order defines primary/secondary VIP addresses. Earlier single-stack usage of `apiVIP`/`ingressVIP` is still referenced via the Agent-based param tables and historical examples.

3. **Params vs docs (bare-metal-ipi catalog)**
   - `data/params/4.20/bare-metal-ipi.json` and `frontend/src/data/catalogs/bare-metal-ipi.json` model:
     - Shared install-config root fields (`apiVersion`, `baseDomain`, `metadata`, `networking.*`, `publish`, `proxy.*`, `imageContentSources`, `imageDigestSources`, `pullSecret`, `sshKey`, `capabilities`, `cpuPartitioningMode`, etc.) aligned with the Agent-based param tables.
     - Bare metal–specific fields from 9.1.4 and the IPI chapter: provisioning network family (`provisioningNetwork`, `provisioningNetworkCIDR`, `provisioningNetworkInterface`, `provisioningDHCPRange`, `clusterProvisioningIP`, `provisioningMACAddress`) and hosts/BMC (`hosts[]`, `hosts[].bmc.*`, `hosts[].bootMACAddress`, `hosts[].rootDeviceHints`).
   - **Notable nuance:** the catalog currently exposes **singular** `platform.baremetal.apiVIP` and `platform.baremetal.ingressVIP`. The 4.20 bare metal IPI chapter’s dual-stack example uses **plural** `apiVIPs` / `ingressVIPs` lists. It is very likely that:
     - `apiVIP` / `ingressVIP` remain supported but are conceptually **legacy / single-stack**.
     - `apiVIPs` / `ingressVIPs` are the preferred shape for dual-stack.
   - I am **not ≥95% certain** whether the bare metal 4.20 product docs intend singular vs plural VIP fields to be treated as:
     - “Legacy vs new” (like vSphere’s `apiVIP` vs `apiVIPs`), or
     - Two equally valid shapes (single IP vs list) for the same scenario.
   - Because of that uncertainty, this pass **does not** change VIP-related param paths; instead, the implementation plan will call out an explicit follow-up research task to confirm the intended 4.20 schema for bare metal VIPs.

4. **AS-IS backend behavior (bare metal IPI)**
   - In `backend/src/generate.js`, when **platform is `Bare Metal` and method is `IPI`**, the generator:
     - Emits `installConfig.platform.baremetal` with:
       - `apiVIPs` and `ingressVIPs` (arrays) from `hostInventory.apiVip` / `hostInventory.ingressVip` (single-element lists; 4.12+ canonical).
       - Provisioning network–related fields from `hostInventory` (`provisioningNetwork`, `provisioningNetworkCIDR`, `provisioningNetworkInterface`, `provisioningDHCPRange`, `clusterProvisioningIP`, `provisioningMACAddress`) when populated.
       - `hosts[]` built from `hostInventory.nodes` with:
         - `name` (from `hostname` + baseDomain when configured),
         - `role`,
         - `bmc` object including `address`, and optionally `username`/`password`/`disableCertificateVerification` (only when the user explicitly chooses to export credentials),
         - `bootMACAddress` (from `node.bmc.bootMACAddress`),
         - `rootDeviceHints.deviceName` (from `node.rootDevice`).
   - **No machine-pool or topology fields** (like vSphere’s `clusterOSImage` or failure domains) are relevant here; bare metal IPI uses host-based modeling instead.

5. **AS-IS wizard behavior (bare metal IPI) — high level**
   - VIPs:
     - The networking step (`NetworkingV2Step.jsx`) determines whether to show an API/Ingress VIP section by checking the catalog for `platform.baremetal.apiVIP`, `ingressVIP`, `apiVIPs`, or `ingressVIPs`. When present, a **bare metal VIP card** is rendered and wired to `hostInventory.apiVip` and `hostInventory.ingressVip` (emitted as apiVIPs/ingressVIPs in install-config).
   - Provisioning network and hosts:
     - The host inventory step (and related platform-specific inputs) drive `hostInventory` state for per-node BMC information, `bootMACAddress`, and `rootDevice` as well as global provisioning-network–related fields.
     - The generator directly consumes this `hostInventory` state to build `platform.baremetal` in `install-config.yaml`.

6. **Known / suspected deltas — VIP resolved**

- **Docs vs params/backend (VIP):** Resolved. Catalog now documents apiVIPs/ingressVIPs (canonical) and apiVIP/ingressVIP (deprecated). Backend emits apiVIPs/ingressVIPs. UI collects single values and backend emits as single-element arrays.
- **Docs vs params/backend (other):**
  - Provisioning network:
    - Catalog allowed values (`Managed`, `Unmanaged`, `Disabled`) for `provisioningNetwork` **match** the IPI chapter text, including DHCP behavior and external-DHCP requirements.
    - Backend correctly carries through `Managed`, `Unmanaged`, and `Disabled` when set.
- **App vs docs (behavioral gaps — not changed in this pass):**
  - No UI-level modeling of the full DHCP/Redfish caveats for each `provisioningNetwork` mode (Managed / Unmanaged / Disabled); these are doc-only today.
  - No explicit UI gating for required `bootMACAddress` when provisioning network is disabled; generator simply omits hosts’ `bootMACAddress` when not set.

7. **VIP schema (resolved in follow-up pass)**

- **Conclusion:** Official 4.20 bare metal IPI docs state that from OpenShift 4.12 onward, `apiVIP` and `ingressVIP` are **deprecated**; the installer expects **`apiVIPs`** and **`ingressVIPs`** (list format). Single-stack = one element in each list; dual-stack = two elements (order = primary/secondary).
- **Change applied:** Backend `generate.js` now emits `apiVIPs` and `ingressVIPs` (arrays) for Bare Metal IPI. The UI continues to collect a single API VIP and single Ingress VIP; they are emitted as single-element arrays. Dual-stack can be added later.
- **(Superseded) Singular vs plural VIP fields — previously uncertain:**
  - Evidence (historical):
    - Agent-based param tables (9.1.4) focus on **install-config structure** and reference `platform.baremetal.*`, but the cached text inspected in this pass does **not** clearly list `apiVIP` vs `apiVIPs`.
    - The bare metal IPI chapter’s dual-stack example uses `apiVIPs` / `ingressVIPs` lists.
    - The app and catalog currently use singular `apiVIP` / `ingressVIP`.
  - I am **not ≥95% certain** whether the intended 4.20 canonical shape for bare metal IPI is:
    - (a) “Either `apiVIP`/`ingressVIP` (single IP) or `apiVIPs`/`ingressVIPs` (lists) are both valid”, or
    - (b) “`apiVIPs`/`ingressVIPs` are the long-term canonical shape and `apiVIP`/`ingressVIP` are officially deprecated but still accepted”.
  - Because of this, **no change** is made to any VIP-related param or emission behavior in this pass; the implementation plan will require an explicit schema check against current 4.20 install-config validation (outside this repo) before changing shapes.

---

This working doc is the anchor for:

- The **full doc tree / mapping** for bare-metal-ipi (rooted at the URLs above).
- The **parameter truth table** for `platform.baremetal.*` and shared install-config fields (taken from manual review of the cached HTML plus `data/params/4.20/bare-metal-ipi.json`).
- The **AS-IS inventory and delta analysis** for bare metal 4.20 IPI (to be expanded in subsequent edits if/when the implementation pass proceeds).

### Canonical vs frontend params (two-place model)

See **`docs/DATA_AND_FRONTEND_COPIES.md`** for the authoritative explanation. Summary:

- **Canonical:** `data/params/<version>/*.json` (e.g. `data/params/4.20/bare-metal-ipi.json`) — source of truth; validated by `node scripts/validate-catalog.js`. The frontend container in Docker does not have access to `data/` at runtime.
- **Frontend copies:** `frontend/src/data/catalogs/*.json` — copied from canonical when params change or a new scenario is added. Used by `catalogPaths.js`, `catalogFieldMeta.js`, and catalog-driven UI (e.g. Networking, Platform Specifics, Host Inventory v2).
- **Sync:** Manual. When canonical bare-metal-ipi or bare-metal-upi is updated, copy the file(s) to `frontend/src/data/catalogs/` so the UI and validation use the same param set. After this closeout pass, canonical and frontend copies for bare-metal-ipi and bare-metal-upi are in sync (including apiVIPs/ingressVIPs and deprecated singular VIP entries).

