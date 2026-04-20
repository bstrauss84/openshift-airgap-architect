# Params catalog rules (data/params)

CI and local workflow for canonical vs frontend copies and generator guards: **`docs/PARAM_AUTHORITY.md`** (`node scripts/validate-param-authority.js`).

## Schema

- One JSON file per scenario per version: `data/params/<version>/<scenario-id>.json`.
- Top-level keys: `version`, `scenarioId`, `parameters` (array).
- Each parameter: `path`, `outputFile`, `type`, `allowed` (optional), `default` (optional), `required`, `description`, `applies_to`, `citations` (array).
- Citation: `docId`, `docTitle`, `sectionHeading`, `url` are all **required**. `docTitle` must be non-empty; derive from `data/docs-index/<version>.json` (scenarios and sharedDocs).

## Validation rules

- **path**, **outputFile**, **description**, **applies_to**, **citations** are required.
- No duplicate (path, outputFile) within the same file.
- Each citation: `docId`, `docTitle`, `sectionHeading`, `url` must be present and non-empty. `docTitle` is **required** (Phase 3).
- **allowed**, **type**, **required**, **default**: must be present on every parameter; value must be either a concrete value or the exact string "not specified in docs" where the docs do not define them. For `required`, concrete means `true` or `false`.

## How to run the validator

- **No arguments (default):** validate all catalog files under `data/params/4.20/*.json` (or default version).
- **Directory:** `node scripts/validate-catalog.js data/params` or `node scripts/validate-catalog.js data/params/4.20` — validate all `*.json` in that directory (and version subdirs when target is `data/params`).
- **Single file:** `node scripts/validate-catalog.js data/params/4.20/bare-metal-agent.json` — validate that file only.

Exit code 0 if all selected files pass; non-zero and stderr output on validation failure.

## Proxy and trust-bundle parameters

The install-config parameters **proxy.httpProxy**, **proxy.httpsProxy**, **proxy.noProxy**, and **additionalTrustBundlePolicy** are documented in the platform-agnostic install doc (section 1.11.2 Configuring the cluster-wide proxy during installation), not in the Agent-based Installer parameter doc. They apply to all install-config scenarios; cite **installing-platform-agnostic** with that section heading and URL.

## Image mirroring (imageContentSources vs imageDigestSources)

Catalogs keep `imageDigestSources` as the canonical mirror-source parameter path used by app logic.

- Generator emission is version-gated for install-config compatibility:
  - OCP `4.14+` emits `imageDigestSources`.
  - OCP `4.13` and earlier emits `imageContentSources`.
- `imageDigestSources` and `imageContentSources` use the same source/mirror structure for release-image mapping.
- Post-install digest mirroring uses cluster API resources (`ImageDigestMirrorSet`, `ImageTagMirrorSet`) from oc-mirror v2; those are cluster objects, not install-config parameters.

### Installer code tie-breaker reference

When docs appear mixed across books/versions, use OpenShift installer source as a product-truth tie-breaker:

- `release-4.20` installer code includes both fields in the cluster info model:
  - `ImageDigestSources []types.ImageDigestSource`
  - `DeprecatedImageContentSources []types.ImageContentSource`
- Source: [openshift/installer `clusterinfo.go` (release-4.20)](https://github.com/openshift/installer/blob/release-4.20/pkg/asset/agent/joiner/clusterinfo.go)

Interpretation rule for this repo:

- Treat `ImageDigestSources` as the active path for modern versions.
- Treat `DeprecatedImageContentSources` as compatibility-only for older versions.
- Do not re-open this decision without either:
  - installer source changes in the target release branch, or
  - explicit Red Hat product guidance that supersedes current behavior.

## Agent-config hosts.networkConfig (nmstate)

The **hosts[].networkConfig** field in agent-config.yaml accepts a dictionary that must match the **Host Network Management API** defined in the [nmstate documentation](https://nmstate.io/examples.html). Red Hat OpenShift 4.20 supports static IPs, DNS, routes, and interfaces of type **ethernet**, **bond**, and **vlan** (VLANs and NIC bonds per Preparing to install).

The bare-metal-agent catalog includes sub-parameters for:

- **hosts[].networkConfig.interfaces** — name, type (ethernet, bond, vlan), state, mac-address; ipv4/ipv6 (enabled, dhcp, address with ip and prefix-length); **link-aggregation** (port, mode) for bonds; **vlan** (base-iface, id) for VLANs.
- **hosts[].networkConfig.dns-resolver** — config.server, config.search.
- **hosts[].networkConfig.routes** — config array with destination, next-hop-address, next-hop-interface, metric, table-id.

Top-level networkConfig and interface list cite **installation-config-parameters-agent** (9.2.2) and **nmstate-examples** (https://nmstate.io/examples.html). Deeper sub-fields cite nmstate-examples with the relevant section (Interfaces: ethernet, bond, VLAN, Route, DNS).

## Expanding scenario catalogs from the Agent-based Installer doc

The **Installation configuration parameters for the Agent-based Installer** (Chapter 9) doc defines shared `install-config.yaml` parameters (9.1.1–9.1.3) and platform-specific sections (9.1.4 bare metal, 9.1.5 vSphere) that apply to other scenarios. To expand all non–bare-metal-agent scenario catalogs with these parameters (so each has the same depth as `bare-metal-agent` for install-config):

```bash
node scripts/expand-catalogs-from-agent-doc.js
```

This reads `data/params/4.20/bare-metal-agent.json`, takes all `install-config.yaml` parameters (shared + platform.baremetal), and merges them into each of: bare-metal-ipi, bare-metal-upi, vsphere-ipi, vsphere-upi, nutanix-ipi, aws-govcloud-ipi, aws-govcloud-upi, azure-government-ipi (with `applies_to` set to that scenario and existing platform-specific params preserved). `ibm-cloud-ipi` is curated from IBM Cloud installation docs and is not part of this bulk-expansion script. Run from the repo root. Then run `node scripts/validate-catalog.js` to confirm.
