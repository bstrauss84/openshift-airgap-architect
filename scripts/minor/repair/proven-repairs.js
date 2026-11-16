#!/usr/bin/env node
"use strict";

/**
 * Evidence-backed repair rules for Tranche 0B.
 *
 * This module is DATA, not heuristics. Every rule names the same-minor
 * authority it was derived from, and the repair engine applies a rule only on
 * an exact match. There is deliberately no pattern-rewriting fallback: a row
 * that matches no rule is reported and left untouched, so an unanticipated
 * shape can never be silently rewritten.
 *
 * SAME-MINOR ISOLATION. Rules that happen to be identical at 4.20 and 4.21 are
 * still derived twice, from each minor's own documentation and its own pinned
 * installer clone, and are recorded per minor below. Identical text is a
 * finding (the defect is shared), never an assumption.
 *
 * PINNED EVIDENCE
 *   4.20 docs     local-docs/ocp-4.20/docs/extracted/ (12 books)
 *   4.20 installer github.com/openshift/installer release-4.20 @ 13a5f6b91e1636b63bb0956c6fa49fab236e71c1
 *   4.21 docs     local-docs/ocp-4.21/docs/extracted/ (12 books)
 *   4.21 installer github.com/openshift/installer release-4.21 @ 1accb6487cf3784561665c08048dde20ad672c39
 *
 * See docs/minor-release/CATALOG_REPAIR_LEDGER_0B.md for the full derivation.
 */

/** The sentinel the executable validator accepts for an unstated value. */
const NOT_SPECIFIED = "not specified in docs";

/**
 * Mechanical provenance baseline: the exact OFFICIAL released artifact for each
 * minor, not the tip of its release branch.
 *
 * A `release-X.Y` branch tip is a moving reference that can sit either behind or
 * ahead of the released payload, so it cannot serve as final provenance. The
 * figures below were resolved with the same mechanism the product uses for
 * target-minor latest-patch resolution (the Cincinnati `stable-<minor>.yaml`
 * channel), the binary was integrity-verified against the mirror's own
 * `sha256sum.txt`, and `installerCommit` is what that exact binary reports via
 * `openshift-install version`.
 *
 * `branch` is retained ONLY as the human-readable form used in citation URLs —
 * readers land on a browsable branch page rather than a 40-character SHA. The
 * authority for every mechanical fact is `installerCommit`.
 *
 * Resolved 2026-10-07T16:30:10Z. See
 * docs/minor-release/CATALOG_REPAIR_LEDGER_0B.md for the full certification.
 */
const INSTALLER_PINS = Object.freeze({
  "4.20": Object.freeze({
    release: "4.20.40",
    payloadDigest: "sha256:5e7b078005685058604a617d52e416d3d152a6ab9197e51c81f4d446b6c0102b",
    binarySha256: "79c84ba583660a5f109f941246194091b3bb37a9cb127da1321aae3d92f25db5",
    tarballSha256: "b6904d3e7a7a0fe4f364187963da72a686a1adb6e0ac89559e8e12308363e824",
    installerCommit: "0c11c37e83ad8b8a328ffe0d0888ef70ed5bab56",
    arch: "amd64",
    branch: "release-4.20",
    // Snapshot Tranche 0B originally derived from, superseded by the above.
    supersededBranchTip: "13a5f6b91e1636b63bb0956c6fa49fab236e71c1",
  }),
  "4.21": Object.freeze({
    release: "4.21.35",
    payloadDigest: "sha256:1f8f423477982ce16193469c26f8941ba797a6f4fc3b3621a5d426ae19deb457",
    binarySha256: "c20790cb144e58f197d1fc87162f073f859b22670f21233a3032fb1ed5938da1",
    tarballSha256: "4e2e7a68bec8c24c1b1e7f3c676e6a564be4a269c93573e374820e3916804485",
    installerCommit: "006669f5812a47dbc733b6736584b87ef696e898",
    arch: "amd64",
    branch: "release-4.21",
    supersededBranchTip: "1accb6487cf3784561665c08048dde20ad672c39",
  }),
  // Transcribed from the committed Tranche 1 acquisition evidence,
  // docs/minor-release/4.22/acquisition-manifest-4.22.json `installer`:
  // resolved from the stable-4.22 Cincinnati channel (not the branch tip, not
  // fast/candidate 4.22.17), checksum-verified against the mirror's own
  // sha256sum.txt before use, and the commit is self-reported by that exact
  // released binary. Required here because every supported minor must carry
  // exact-release provenance.
  "4.22": Object.freeze({
    release: "4.22.16",
    payloadDigest: "sha256:55a0c0c8f9a285fa468009511dd878d5492436ceb4f0207933b6403d19353876",
    binarySha256: "62b3a91ca3f242dd6feec1aefec8f5f5e7af4e13982f65600eb84fc56ca71a33",
    tarballSha256: "6f26860ba4ebaaf346ce7711be166105205e9edfff9993d9f15834c54a2e0fe5",
    installerCommit: "92820966521d640aa5f0edfb69bcfd9c168c2210",
    arch: "amd64",
    branch: "release-4.22",
  }),
});

/** Canonical form of an installer-source citation, already used 109× in-tree. */
function installerCitation(minor, goFile, symbol) {
  return {
    docId: "installer-source-code",
    docTitle: `OpenShift Installer ${minor} Source Code`,
    sectionHeading: `${goFile} - ${symbol}`,
    url: `https://github.com/openshift/installer/blob/${INSTALLER_PINS[minor].branch}/${goFile}`,
  };
}

// ---------------------------------------------------------------------------
// R1 — type aliases
// ---------------------------------------------------------------------------

/**
 * `int`/`bool` are not in the documented schema enum. Normalizing them closes
 * DIVERGENCE_REGISTER entry `type-enum-not-enforced`.
 *
 * Metadata-only: `param.type` is read in exactly one production place
 * (frontend/src/catalogFieldMeta.js, which copies it to `meta.type` unchanged)
 * and no production code branches on the value. backend/src/catalogValidator.js
 * never reads it.
 */
const TYPE_ALIASES = Object.freeze({ int: "integer", bool: "boolean" });

// ---------------------------------------------------------------------------
// R2 — installer-source citations pointing at the wrong file
// ---------------------------------------------------------------------------

/**
 * Verified by locating the struct declaration and the field inside its body in
 * each minor's own pinned clone — not by grepping for the field name, which
 * false-matches.
 *
 * All 13 are wrong identically at BOTH minors, so this is pre-existing debt
 * rather than 4.21 drift. `pkg/types/baremetal/host.go` exists in neither
 * release branch.
 *
 * Keyed `<citedFile>|<Struct>.<Field>`.
 */
const INSTALLER_FILE_CORRECTIONS = Object.freeze({
  "pkg/types/baremetal/host.go|Host.BootMode": "pkg/types/baremetal/platform.go",
  "pkg/types/baremetal/host.go|Host.HardwareProfile": "pkg/types/baremetal/platform.go",
  "pkg/types/baremetal/host.go|Host.Role": "pkg/types/baremetal/platform.go",
  "pkg/types/baremetal/host.go|RootDeviceHints.WWNVendorExtension": "pkg/types/baremetal/rootdevice.go",
  "pkg/types/baremetal/host.go|RootDeviceHints.WWNWithExtension": "pkg/types/baremetal/rootdevice.go",
  "pkg/types/installconfig.go|MachinePool.DiskSetup": "pkg/types/machinepools.go",
  "pkg/types/installconfig.go|MachinePool.Fencing": "pkg/types/machinepools.go",
  "pkg/types/installconfig.go|MachinePoolPlatform.AWS": "pkg/types/machinepools.go",
  "pkg/types/installconfig.go|MachinePoolPlatform.Azure": "pkg/types/machinepools.go",
  "pkg/types/installconfig.go|MachinePoolPlatform.BareMetal": "pkg/types/machinepools.go",
  "pkg/types/installconfig.go|MachinePoolPlatform.IBMCloud": "pkg/types/machinepools.go",
  "pkg/types/installconfig.go|MachinePoolPlatform.Nutanix": "pkg/types/machinepools.go",
  "pkg/types/installconfig.go|MachinePoolPlatform.VSphere": "pkg/types/machinepools.go",
});

// ---------------------------------------------------------------------------
// R3 — documentation URLs whose 4.21 target is proven to exist
// ---------------------------------------------------------------------------

/**
 * A 4.21 catalog citing a 4.20 page is repaired ONLY when the 4.21 page is
 * proven to exist, by one of:
 *
 *   live   fetched from docs.redhat.com during 0B and confirmed to render,
 *          with its section headings read back
 *   index  present in data/docs-index/4.21.json, which is tracked, canonical
 *          and parity-validated in CI
 *
 * Keyed by the exact 4.20 URL (minus fragment). Anything not listed here is
 * left alone and reported — a transient 403/503 is not evidence of absence.
 */
const DOC_URL_PROVEN_4_21 = Object.freeze({
  "https://docs.redhat.com/en/documentation/openshift_container_platform/4.20/html/installing_an_on-premise_cluster_with_the_agent-based_installer/installation-config-parameters-agent":
    { to: "4.21", evidence: "live: chapter 9 renders with headings 9.1.1-9.1.6, 9.2.1-9.2.2; also in data/docs-index/4.21.json" },
  "https://docs.redhat.com/en/documentation/openshift_container_platform/4.20/html/installing_an_on-premise_cluster_with_the_agent-based_installer/preparing-to-install-with-agent-based-installer":
    { to: "4.21", evidence: "index: data/docs-index/4.21.json" },
  "https://docs.redhat.com/en/documentation/openshift_container_platform/4.20/html/installing_on_vmware_vsphere/installation-config-parameters-vsphere":
    { to: "4.21", evidence: "live: chapter 9 renders with headings 9.1.1-9.1.6 identical to 4.20" },
  "https://docs.redhat.com/en/documentation/openshift_container_platform/4.20/html/installing_on_any_platform/installing-platform-agnostic":
    { to: "4.21", evidence: "live: heading 1.11.2 'Configuring the cluster-wide proxy during installation' unchanged; also in data/docs-index/4.21.json" },
  "https://docs.redhat.com/en/documentation/openshift_container_platform/4.20/html/installing_on_nutanix/installation-config-parameters-nutanix":
    { to: "4.21", evidence: "index: data/docs-index/4.21.json" },
  "https://docs.redhat.com/en/documentation/openshift_container_platform/4.20/html-single/installing_on_ibm_cloud/":
    { to: "4.21", evidence: "index: data/docs-index/4.21.json" },
  "https://docs.redhat.com/en/documentation/openshift_container_platform/4.20/html/installing_on_ibm_cloud/installing-ibm-cloud-restricted":
    { to: "4.21", evidence: "index: data/docs-index/4.21.json" },
  "https://docs.redhat.com/en/documentation/openshift_container_platform/4.20/html/edge_computing/image-based-installation-for-single-node-openshift":
    { to: "4.21", evidence: "index: data/docs-index/4.21.json" },
  "https://docs.redhat.com/en/documentation/openshift_container_platform/4.20/html/installing_on_vmware_vsphere/installer-provisioned-infrastructure":
    { to: "4.21", evidence: "live: 'Chapter 2. Installer-provisioned infrastructure'" },
  "https://docs.redhat.com/en/documentation/openshift_container_platform/4.20/html/installing_on_aws/installation-config-parameters-aws":
    { to: "4.21", evidence: "live: 'Chapter 7. Installation configuration parameters for AWS'" },
  "https://docs.redhat.com/en/documentation/openshift_container_platform/4.20/html/installing_on_bare_metal/":
    { to: "4.21", evidence: "live: 'Installing on bare metal | OpenShift Container Platform | 4.21'" },
  "https://docs.redhat.com/en/documentation/openshift_container_platform/4.20/html/installing_on_nutanix/preparing-to-install-on-nutanix":
    { to: "4.21", evidence: "live: 'Chapter 1. Installation methods'" },
  "https://docs.redhat.com/en/documentation/openshift_container_platform/4.20/html-single/installing_an_on-premise_cluster_with_the_agent-based_installer/index":
    { to: "4.21", evidence: "live: 'Installing an on-premise cluster with the Agent-based Installer | 4.21'" },
  "https://docs.redhat.com/en/documentation/openshift_container_platform/4.20/html/disconnected_environments/index":
    { to: "4.21", evidence: "index: data/docs-index/4.21.json" },
  "https://docs.redhat.com/en/documentation/openshift_container_platform/4.20/":
    { to: "4.21", evidence: "index: product root, data/docs-index/4.21.json" },
});

/**
 * Citations on the retired `docs.openshift.com` host whose modern equivalent is
 * proven. The vSphere parameter-reference page was fetched live at BOTH 4.20
 * and 4.21 and renders the same chapter 9, so this is a host migration within
 * the same book and chapter, done per minor to that minor's own page.
 *
 * `docs.openshift.com/.../installing-vsphere-ipi.html` is deliberately absent:
 * its cited heading is an H3 row, so those citations are frozen entirely.
 */
const LEGACY_HOST_URL_MAP = Object.freeze({
  "installing/installing_vsphere/installation-config-parameters-vsphere.html": (m) =>
    `https://docs.redhat.com/en/documentation/openshift_container_platform/${m}/html/installing_on_vmware_vsphere/installation-config-parameters-vsphere`,
});

/**
 * Pages that do not exist at EITHER minor, and the proven same-minor page the
 * citation should address instead. Keyed by the URL path after
 * `openshift_container_platform/<minor>/`, so one rule serves both minors and
 * each row is rebuilt against its own minor's page.
 *
 * These are pre-existing broken links, not 4.21 drift — each was confirmed
 * HTTP 404 at 4.20 as well as 4.21.
 */
const PAGE_RELOCATIONS = Object.freeze({
  "html/installing_on_nutanix/installing-nutanix-ipi": {
    family: "nutanix",
    evidence: "HTTP 404 at both 4.20 and 4.21; the cited heading resolves to the Nutanix parameter-reference chapter, which is proven at both minors",
  },
  "html/installation_configuration_parameters_understanding_installation_configuration_parameters/installation-config-parameters-nutanix": {
    family: "nutanix",
    evidence: "HTTP 404 at both 4.20 and 4.21; that book does not exist",
  },
  "pdf/installing_an_on-premise_cluster_with_the_agent-based_installer/OpenShift_Container_Platform-4.20-Installing_an_on-premise_cluster_with_the_Agent-based_Installer-en-US.pdf": {
    url: (m) =>
      `https://docs.redhat.com/en/documentation/openshift_container_platform/${m}/html/installing_an_on-premise_cluster_with_the_agent-based_installer/preparing-to-install-with-agent-based-installer`,
    docId: "installing-bare-metal-agent",
    docTitle: "Installing an on-premise cluster with the Agent-based Installer",
    evidence:
      "a PDF asset cited as the documentation page, with a 4.20 filename that a minor swap would not correct. The cited section lives in chapter 1, whose HTML page is in both minors' tracked docs index.",
  },
});

// ---------------------------------------------------------------------------
// R4 — section headings (triage class A)
// ---------------------------------------------------------------------------

/**
 * Same-minor heading corrections. Keyed by minor, then by the exact cited
 * string. Each target was located in that minor's own extracted book.
 *
 * Note TR-11: the parent section 3.3.13.2 was RENAMED between minors
 * ("Additional install-config parameters" -> "Additional installation
 * configuration parameters"), while the `3.3.13.2.1. Hosts` subsection the
 * citation actually names is stable. That is why the rules are stated per
 * minor even where the chosen target coincides.
 */
const HEADING_CORRECTIONS = Object.freeze({
  "4.20": Object.freeze({
    "9.1.4. VMware vSphere cluster parameters": {
      to: "9.1.4. Additional VMware vSphere configuration parameters",
      evidence: "Installing_on_vSphere 4.20: section 9.1.4; the cited string conflates it with the caption of Table 9.4. Additional VMware vSphere cluster parameters. Confirmed live at 4.20.",
    },
    "Required install-config parameters": {
      to: "7.1.1. Required configuration parameters",
      evidence: "Installing_on_Nutanix 4.20 section 7.1.1 (Table 7.1. Required parameters)",
    },
    "Optional install-config parameters": {
      to: "7.1.3. Optional configuration parameters",
      evidence: "Installing_on_Nutanix 4.20 section 7.1.3 (Table 7.3. Optional parameters)",
    },
    "Nutanix install-config parameters": {
      to: "7.1.4. Additional Nutanix configuration parameters",
      evidence: "Installing_on_Nutanix 4.20 section 7.1.4 (Table 7.4. Additional Nutanix cluster parameters)",
    },
    "3.3.13.2 Additional install-config parameters - Hosts parameter (Table 3.10)": {
      to: "3.3.13.2.1. Hosts",
      evidence: "Installing_on_bare_metal 4.20: 3.3.13.2. Additional install-config parameters, subsection 3.3.13.2.1. Hosts",
    },
    "Validation checks before agent ISO creation": {
      to: "1.11. Validation checks before agent ISO creation",
      evidence: "Agent-based_Installer 4.20 section 1.11",
    },
  }),
  "4.21": Object.freeze({
    "9.1.4. VMware vSphere cluster parameters": {
      to: "9.1.4. Additional VMware vSphere configuration parameters",
      evidence: "Installing_on_VMware_vSphere 4.21: section 9.1.4. Confirmed live at 4.21.",
    },
    "Required install-config parameters": {
      to: "7.1.1. Required configuration parameters",
      evidence: "Installing_on_Nutanix 4.21 section 7.1.1 (Table 7.1. Required parameters)",
    },
    "Optional install-config parameters": {
      to: "7.1.3. Optional configuration parameters",
      evidence: "Installing_on_Nutanix 4.21 section 7.1.3 (Table 7.3. Optional parameters)",
    },
    "Nutanix install-config parameters": {
      to: "7.1.4. Additional Nutanix configuration parameters",
      evidence: "Installing_on_Nutanix 4.21 section 7.1.4 (Table 7.4. Additional Nutanix cluster parameters)",
    },
    "3.3.13.2 Additional install-config parameters - Hosts parameter (Table 3.10)": {
      to: "3.3.13.2.1. Hosts",
      evidence: "Installing_on_bare_metal 4.21: parent section RENAMED to 3.3.13.2. Additional installation configuration parameters; subsection 3.3.13.2.1. Hosts is stable",
    },
    "1.5.2. About root device hints": {
      to: "1.4.2. About root device hints",
      evidence: "Agent-based_Installer 4.21: chapter 1 renumbered, 1.5.2 -> 1.4.2 (4.20 has 1.5.2)",
    },
    "1.11. Validation checks before agent ISO creation": {
      to: "1.10. Validation checks before agent ISO creation",
      evidence: "Agent-based_Installer 4.21: 1.11 -> 1.10 (4.20 has 1.11)",
    },
    "Validation checks before agent ISO creation": {
      to: "1.10. Validation checks before agent ISO creation",
      evidence: "Agent-based_Installer 4.21 section 1.10",
    },
  }),
});

/**
 * Citations that must move to a different PAGE, not just a different heading.
 *
 * The AWS GovCloud and Azure Government citations name books that do not
 * exist: `installing_on_aws_govcloud/installing-aws-govcloud-ipi` returns HTTP
 * 404 at 4.21 and neither book is in either minor's acquisition. Every
 * parameter carrying one of these citations is a generic install-config
 * parameter (`platform.aws.region`, `platform.azure.cloudName`, ...), not
 * GovCloud install-procedure content, so the authority is that minor's
 * parameter-reference chapter — verified live at BOTH 4.20 and 4.21.
 *
 * Keyed by cited sectionHeading, then parameter path, so a relocation is only
 * ever applied to a parameter whose section was actually located. The section
 * for each was found in that minor's own extracted book; every one resolved
 * identically at 4.20 and 4.21, verified separately.
 */
const CITATION_RELOCATIONS = Object.freeze({
  "AWS GovCloud install-config parameters": Object.freeze({
    family: "aws",
    sections: Object.freeze({
      "compute[].platform.aws.type": "7.1.4. Optional AWS configuration parameters",
      "controlPlane.platform.aws.type": "7.1.4. Optional AWS configuration parameters",
      "platform.aws": "7.1.4. Optional AWS configuration parameters",
      "platform.aws.amiID": "7.1.4. Optional AWS configuration parameters",
      "platform.aws.hostedZone": "7.1.4. Optional AWS configuration parameters",
      "platform.aws.hostedZoneRole": "7.1.4. Optional AWS configuration parameters",
      "platform.aws.lbType": "7.1.3. Optional configuration parameters",
      "platform.aws.region": "7.1.4. Optional AWS configuration parameters",
    }),
  }),
  "AWS GovCloud UPI install-config parameters": Object.freeze({
    family: "aws",
    sections: Object.freeze({
      "platform.aws": "7.1.4. Optional AWS configuration parameters",
      "platform.aws.amiID": "7.1.4. Optional AWS configuration parameters",
      "platform.aws.hostedZone": "7.1.4. Optional AWS configuration parameters",
      "platform.aws.hostedZoneRole": "7.1.4. Optional AWS configuration parameters",
      "platform.aws.lbType": "7.1.3. Optional configuration parameters",
      "platform.aws.region": "7.1.4. Optional AWS configuration parameters",
      "platform.aws.vpc.subnets": "7.1.4. Optional AWS configuration parameters",
    }),
  }),
  "Azure Government install-config parameters": Object.freeze({
    family: "azure",
    sections: Object.freeze({
      "platform.azure": "7.1.4. Additional Azure configuration parameters",
      "platform.azure.baseDomainResourceGroupName": "7.1.4. Additional Azure configuration parameters",
      "platform.azure.cloudName": "7.1.4. Additional Azure configuration parameters",
      "platform.azure.region": "7.1.4. Additional Azure configuration parameters",
      "platform.azure.resourceGroupName": "7.1.4. Additional Azure configuration parameters",
    }),
  }),
});

/**
 * Citation identifiers that embed a minor in their text.
 *
 * One citation does this: `docId: "ocp-4.20-baremetal-ipi"` with
 * `docTitle: "Installing OpenShift Container Platform 4.20 on bare metal
 * (IPI)"`. Repairing only its URL would leave a 4.21 row labelled 4.20 — a
 * cross-minor reference that survives in plain sight.
 *
 * Both patterns are anchored at the start of the field so an ordinary version
 * mention inside a title is never rewritten.
 */
const MINOR_LABELLED_FIELDS = Object.freeze([
  { field: "docId", pattern: /^ocp-(\d+\.\d+)-/ },
  { field: "docTitle", pattern: /^(?:Installing )?OpenShift Container Platform (\d+\.\d+) / },
]);

// ---------------------------------------------------------------------------
// R4b — H3 closure: deterministic same-minor authority resolution
// ---------------------------------------------------------------------------

/**
 * Pages that are not parameter references but are needed as citation targets.
 */
const EXTRA_PAGES = Object.freeze({
  platformAgnostic: {
    docId: "installing-platform-agnostic",
    docTitle: "Installing a cluster (platform-agnostic)",
    url: (m) =>
      `https://docs.redhat.com/en/documentation/openshift_container_platform/${m}/html/installing_on_any_platform/installing-platform-agnostic`,
  },
  bareMetalIpi: {
    docId: "installing-bare-metal-ipi",
    docTitle: "Installing on bare metal with installer-provisioned infrastructure",
    url: (m) =>
      `https://docs.redhat.com/en/documentation/openshift_container_platform/${m}/html/installing_on_bare_metal/installer-provisioned-infrastructure`,
  },
});

/**
 * Resolution of the citations Tranche 0B initially could not place.
 *
 * Applied by a fixed authority precedence, within the row's own minor:
 *
 *   1. exact parameter-reference documentation for the field
 *   2. authoritative global/shared documentation where the field is globally
 *      owned rather than platform-specific
 *   3. scenario/platform narrative documentation only for semantics the
 *      parameter reference does not carry
 *   4. exact same-minor installer source, for MECHANICAL capability only
 *
 * Tier 4 never establishes Red Hat user-facing supportedness, so no rule here
 * changes `supportStatus`. Where tier 4 is the only authority available, that
 * is recorded as a supportedness question for a later tranche rather than
 * settled by the citation.
 *
 * Rules are evaluated in order; the first whose `when` matches wins. Matching
 * is on explicit fields only — never a pattern over citation text.
 */
const CITATION_RESOLUTIONS = Object.freeze([
  {
    id: "global-proxy-and-trust-bundle",
    tier: 2,
    when: {
      docId: "installation-config-parameters-ibm-cloud",
      sectionHeading: "1.11.2. Configuring the cluster-wide proxy during installation",
    },
    to: { page: "platformAgnostic", sectionHeading: "1.11.2. Configuring the cluster-wide proxy during installation" },
    evidence:
      "additionalTrustBundlePolicy and proxy.* are globally owned cluster-wide install configuration, not IBM-Cloud-specific. The platform-agnostic cluster-wide proxy section is the same-minor authority and is already cited for these exact four fields by 11 of the 12 scenarios; ibm-cloud-ipi was the lone deviation. Page verified live at 4.21 and present in both minors' tracked docs index.",
  },
  {
    id: "image-digest-sources-installer-only",
    tier: 4,
    when: { paramPathPrefix: "imageDigestSources" },
    to: {
      installerByPath: {
        imageDigestSources: ["pkg/types/installconfig.go", "InstallConfig.ImageDigestSources"],
        "imageDigestSources[].mirrors": ["pkg/types/installconfig.go", "ImageDigestSource.Mirrors"],
        "imageDigestSources[].source": ["pkg/types/installconfig.go", "ImageDigestSource.Source"],
      },
    },
    evidence:
      "`imageDigestSources` appears in NO Red Hat documentation book at either 4.20 or 4.21 (all 12 extracted books searched per minor); the books document `imageContentSources`, which the installer itself marks DeprecatedImageContentSources. The field is real in both release branches, and backend/src/generate.js emits it for all supported minors. Tiers 1-3 are therefore unavailable and tier 4 applies. Existing citations pointed at the edge-computing image-based-installation-config.yaml reference, which documents a different artifact; that is corrected for every scenario, not only the unresolved ones. supportStatus is deliberately unchanged — see the backlog item on documentation-backed supportedness.",
  },
  {
    id: "vsphere-deprecated-flat-fields",
    tier: 1,
    when: { docId: "installing-vsphere-ipi", sectionHeading: "vSphere install-config parameters" },
    to: {
      byScenario: {
        "vsphere-agent": { family: "agent", sectionHeading: "9.1.6. Deprecated VMware vSphere configuration parameters" },
        "*": { family: "vsphere", sectionHeading: "9.1.5. Deprecated VMware vSphere configuration parameters" },
      },
    },
    evidence:
      "platform.vsphere.{datacenter,defaultDatastore,vcenter} are the deprecated flat vSphere fields. All three appear verbatim in the deprecated-parameters section of each minor's own parameter reference: 9.1.5 in the vSphere book and 9.1.6 in the Agent book (the field is spelled `vCenter:` in the tables). Exact parameter-reference ownership outranks the IPI narrative chapter previously cited.",
  },
  {
    id: "vsphere-deprecated-flat-fields-upi",
    tier: 1,
    when: { docId: "installing-vsphere-upi", sectionHeading: "vSphere UPI install-config parameters" },
    to: { family: "vsphere", sectionHeading: "9.1.5. Deprecated VMware vSphere configuration parameters" },
    evidence:
      "Same fields, same authority. IPI and UPI legitimately cite the same parameter reference for a shared vSphere field.",
  },
  {
    id: "bare-metal-parameter-reference",
    tier: 1,
    when: {
      docId: "installing-bare-metal-ipi",
      sectionHeadingOneOf: ["Bare metal API and Ingress VIPs", "Bare metal hosts", "Provisioning network"],
    },
    to: { page: "bareMetalIpi", sectionHeading: "2.5.1.3. Optional configuration parameters" },
    evidence:
      "apiVIPs, ingressVIPs, hosts and provisioningNetwork are all documented in the bare-metal parameter reference, section 2.5.1.3, in each minor's own extracted book. That reference is section 2.5 of the installer-provisioned-infrastructure chapter — the page these citations already address — so only the heading was wrong. Corroborated live at 4.21 via the html-single rendering of the book, whose table of contents carries '2.5. Installation configuration parameters for bare metal' verbatim; the paginated html chapter page itself returns 503 to automated fetches at both minors.",
  },
]);

// ---------------------------------------------------------------------------
// R5 — field values absent from schema-v2.0.0-incomplete rows
// ---------------------------------------------------------------------------

/**
 * The 39 parameters per minor that predate schema v2.0.0 and never gained
 * `outputFile`, `applies_to`, `allowed` or `default`.
 *
 * `allowed` is derived from the field's declared type in that minor's own
 * pinned installer clone — the authority for a `supported-backend-only` field,
 * and the convention already used by validated sibling rows in the same files
 * (e.g. `controlPlane.platform.vsphere` carries `"vsphere.MachinePool object"`).
 *
 * `default` is the installer's own default where the defaults package sets one,
 * and otherwise the sentinel. A `default` already present is never overwritten.
 *
 * `outputFile` is `install-config.yaml` for every row here: all are fields of
 * the InstallConfig struct. `applies_to` is the owning scenario, matching 2028
 * of the 2043 rows that already carry it.
 *
 * Keyed by parameter path; the declared Go type is identical at 4.20 and 4.21
 * for every row, verified separately in each clone.
 */
const FIELD_FILLS = Object.freeze({
  "controlPlane.platform": {
    allowed: "MachinePoolPlatform object",
    goType: "MachinePool.Platform MachinePoolPlatform (pkg/types/machinepools.go)",
  },
  "controlPlane.replicas": {
    allowed: "Integer machine count for the control plane pool",
    goType: "MachinePool.Replicas *int64 (pkg/types/machinepools.go)",
  },
  "platform.aws.defaultMachinePlatform": {
    allowed: "aws.MachinePool object",
    goType: "aws.Platform.DefaultMachinePlatform *MachinePool (pkg/types/aws/platform.go)",
  },
  "platform.aws.defaultMachinePlatform.iamProfile": {
    allowed: "Existing AWS IAM instance profile name",
    goType: "aws.MachinePool.IAMProfile string (pkg/types/aws/machinepool.go)",
  },
  "platform.aws.defaultMachinePlatform.zones": {
    allowed: "Array of AWS availability zone names",
    goType: "aws.MachinePool.Zones []string (pkg/types/aws/machinepool.go)",
  },
  "platform.azure.defaultMachinePlatform.osDisk.diskSizeGB": {
    allowed: "Integer disk size in GB",
    goType: "azure.OSDisk.DiskSizeGB int32 (pkg/types/azure/machinepool.go)",
  },
  "platform.azure.defaultMachinePlatform.zones": {
    allowed: "Array of Azure availability zone names",
    goType: "azure.MachinePool.Zones []string (pkg/types/azure/machinepool.go)",
  },
  "platform.baremetal.defaultMachinePlatform": {
    allowed: "baremetal.MachinePool object",
    goType: "baremetal.Platform.DefaultMachinePlatform *MachinePool (pkg/types/baremetal/platform.go)",
  },
  "platform.baremetal.externalBridge": {
    allowed: "Name of an existing network bridge on the provisioning host",
    default: "baremetal",
    goType: "baremetal.Platform.ExternalBridge string (pkg/types/baremetal/platform.go)",
    defaultEvidence: 'pkg/types/baremetal/defaults/platform.go: ExternalBridge = "baremetal"',
  },
  "platform.baremetal.libvirtURI": {
    allowed: "libvirt connection URI",
    goType: "baremetal.Platform.LibvirtURI string (pkg/types/baremetal/platform.go)",
  },
  "platform.ibmcloud.defaultMachinePlatform": {
    allowed: "ibmcloud.MachinePool object",
    goType: "ibmcloud.Platform.DefaultMachinePlatform *MachinePool (pkg/types/ibmcloud/platform.go)",
  },
  "platform.nutanix.defaultMachinePlatform": {
    allowed: "nutanix.MachinePool object",
    goType: "nutanix.Platform.DefaultMachinePlatform *MachinePool (pkg/types/nutanix/platform.go)",
  },
  "platform.nutanix.defaultMachinePlatform.bootType": {
    allowed: ["Legacy", "UEFI", "SecureBoot"],
    goType: "nutanix.MachinePool.BootType machinev1.NutanixBootType (pkg/types/nutanix/machinepool.go)",
    allowedEvidence:
      "vendor/github.com/openshift/api/machine/v1/types_nutanixprovider.go: NutanixBootType enum = Legacy, UEFI, SecureBoot",
  },
  "platform.nutanix.defaultMachinePlatform.categories": {
    allowed: "Array of Nutanix category key/value objects",
    goType: "nutanix.MachinePool.Categories []machinev1.NutanixCategory (pkg/types/nutanix/machinepool.go)",
  },
  "platform.vsphere.defaultMachinePlatform": {
    allowed: "vsphere.MachinePool object",
    goType: "vsphere.Platform.DefaultMachinePlatform *MachinePool (pkg/types/vsphere/platform.go)",
  },
});

// ---------------------------------------------------------------------------
// R6 — legacy citation sources
// ---------------------------------------------------------------------------

/**
 * Legacy `{source, url, note}` citation sources and how each is handled.
 *
 *   installer    normalize onto the installer-source-code convention
 *   drop         internal analysis under local-docs/ — untracked, single-machine,
 *                not a URI and not reachable by any reader. The schema has no
 *                representation for it and inventing one would be a provenance
 *                redesign. Dropped only when the parameter keeps another
 *                citation; the conclusion survives in the tracked harvest ledger.
 *   docs         a URL-less assertion that documentation exists. Replaced by a
 *                derived same-minor documentation citation, or dropped where the
 *                parameter is genuinely undocumented (see UNDOCUMENTED).
 */
const LEGACY_SOURCE_HANDLING = Object.freeze({
  installer_source: "installer",
  tls_asset_source: "installer",
  configmap_source: "installer",
  delta_analysis: "drop",
  slice_5c_investigation: "drop",
  ocp_docs: "docs",
});

/**
 * Parameters not documented in their own platform book at EITHER minor,
 * verified independently in each minor's extracted book set.
 *
 * Every one is `supported-backend-only`, so installer source is the correct
 * authority and no `supportStatus` changes. The contentless `ocp_docs` stub is
 * removed; the verified same-minor installer-source citation is retained.
 * Inventing a documentation citation for these would be fabrication.
 */
const UNDOCUMENTED_PARAMETERS = Object.freeze([
  "platform.baremetal.libvirtURI",
  "platform.aws.defaultMachinePlatform",
  "platform.vsphere.defaultMachinePlatform",
  "networking.clusterNetworkMTU",
]);

// ---------------------------------------------------------------------------
// R6b — legacy installer citation URLs -> verified file and symbol
// ---------------------------------------------------------------------------

/**
 * The legacy `{source, url, note}` citations encode the Go location as free
 * text, in four different shapes, several of which name a file that does not
 * exist or a line number instead of a symbol:
 *
 *   github.com/openshift/installer/pkg/types/installconfig.go ControlPlane.Platform
 *   github.com/openshift/installer release-4.21 pkg/types/aws/machinepool.go CPUOptions
 *   github.com/openshift/installer release-4.21 pkg/types/baremetal/platform.go line 254
 *   github.com/openshift/installer release-4.21 pkg/asset/tls/bmcverifyca.go
 *
 * Rather than parse them, every distinct legacy URL is mapped explicitly to the
 * `<file>, <Struct>.<Field>` actually verified in that minor's pinned clone. A
 * legacy URL absent from this table is reported as unmatched and left alone.
 *
 * `null` means the citation names a file but no struct field (asset-generation
 * code); the rebuilt sectionHeading is then the file path alone.
 *
 * Entries present only under "4.21" are 4.21-additions: each was confirmed
 * ABSENT at release-4.20, which independently corroborates `minVersion: 4.21`.
 */
const LEGACY_INSTALLER_URL_MAP = Object.freeze({
  "4.20": Object.freeze({
    "github.com/openshift/installer/pkg/types/installconfig.go ControlPlane.Platform": ["pkg/types/machinepools.go", "MachinePool.Platform"],
    "github.com/openshift/installer/pkg/types/installconfig.go ControlPlane.Replicas": ["pkg/types/machinepools.go", "MachinePool.Replicas"],
    "github.com/openshift/installer/pkg/types/aws/machinepool.go IAMProfile": ["pkg/types/aws/machinepool.go", "MachinePool.IAMProfile"],
    "github.com/openshift/installer/pkg/types/aws/machinepool.go Zones": ["pkg/types/aws/machinepool.go", "MachinePool.Zones"],
    "github.com/openshift/installer/pkg/types/azure/machinepool.go OSDisk.DiskSizeGB": ["pkg/types/azure/disk.go", "OSDisk.DiskSizeGB"],
    "github.com/openshift/installer/pkg/types/azure/machinepool.go Zones": ["pkg/types/azure/machinepool.go", "MachinePool.Zones"],
    "github.com/openshift/installer/pkg/types/baremetal/platform.go DefaultMachinePlatform": ["pkg/types/baremetal/platform.go", "Platform.DefaultMachinePlatform"],
    "github.com/openshift/installer/pkg/types/baremetal/platform.go ExternalBridge": ["pkg/types/baremetal/platform.go", "Platform.ExternalBridge"],
    "github.com/openshift/installer/pkg/types/baremetal/platform.go LibvirtURI": ["pkg/types/baremetal/platform.go", "Platform.LibvirtURI"],
    "github.com/openshift/installer/pkg/types/ibmcloud/platform.go DefaultMachinePlatform": ["pkg/types/ibmcloud/platform.go", "Platform.DefaultMachinePlatform"],
    "github.com/openshift/installer/pkg/types/nutanix/machinepool.go BootType": ["pkg/types/nutanix/machinepool.go", "MachinePool.BootType"],
    "github.com/openshift/installer/pkg/types/nutanix/machinepool.go Categories": ["pkg/types/nutanix/machinepool.go", "MachinePool.Categories"],
    "github.com/openshift/installer/pkg/types/vsphere/platform.go DefaultMachinePlatform": ["pkg/types/vsphere/platform.go", "Platform.DefaultMachinePlatform"],
  }),
  "4.21": Object.freeze({
    "github.com/openshift/installer/pkg/types/installconfig.go ControlPlane.Platform": ["pkg/types/machinepools.go", "MachinePool.Platform"],
    "github.com/openshift/installer/pkg/types/installconfig.go ControlPlane.Replicas": ["pkg/types/machinepools.go", "MachinePool.Replicas"],
    "github.com/openshift/installer/pkg/types/aws/machinepool.go IAMProfile": ["pkg/types/aws/machinepool.go", "MachinePool.IAMProfile"],
    "github.com/openshift/installer/pkg/types/aws/machinepool.go Zones": ["pkg/types/aws/machinepool.go", "MachinePool.Zones"],
    "github.com/openshift/installer/pkg/types/azure/machinepool.go OSDisk.DiskSizeGB": ["pkg/types/azure/disk.go", "OSDisk.DiskSizeGB"],
    "github.com/openshift/installer/pkg/types/azure/machinepool.go Zones": ["pkg/types/azure/machinepool.go", "MachinePool.Zones"],
    "github.com/openshift/installer/pkg/types/baremetal/platform.go DefaultMachinePlatform": ["pkg/types/baremetal/platform.go", "Platform.DefaultMachinePlatform"],
    "github.com/openshift/installer/pkg/types/baremetal/platform.go ExternalBridge": ["pkg/types/baremetal/platform.go", "Platform.ExternalBridge"],
    "github.com/openshift/installer/pkg/types/baremetal/platform.go LibvirtURI": ["pkg/types/baremetal/platform.go", "Platform.LibvirtURI"],
    "github.com/openshift/installer/pkg/types/ibmcloud/platform.go DefaultMachinePlatform": ["pkg/types/ibmcloud/platform.go", "Platform.DefaultMachinePlatform"],
    "github.com/openshift/installer/pkg/types/nutanix/machinepool.go BootType": ["pkg/types/nutanix/machinepool.go", "MachinePool.BootType"],
    "github.com/openshift/installer/pkg/types/nutanix/machinepool.go Categories": ["pkg/types/nutanix/machinepool.go", "MachinePool.Categories"],
    "github.com/openshift/installer/pkg/types/vsphere/platform.go DefaultMachinePlatform": ["pkg/types/vsphere/platform.go", "Platform.DefaultMachinePlatform"],
    // 4.21 additions. Each is verified present in the exact 4.21.35 released
    // source. All but one are also verified ABSENT in the exact 4.20.40
    // released source, corroborating `minVersion: "4.21"`.
    //
    // EXCEPTION, found by exact-release certification: Platform.AllowSharedKeyAccess
    // IS present in released 4.20.40. It was absent from the April 4.20 branch
    // tip Tranche 0B first derived from, and was backported into the 4.20
    // z-stream afterwards. The citation below is still correct — it cites 4.21
    // source for a field that exists at 4.21 — but the field is NOT 4.21-only
    // mechanically. Whether 4.20 should expose it is a documented-supportedness
    // question (it appears in NO Red Hat book at either minor) and is tracked as
    // DOC-170. No minVersion or supportStatus was changed on that evidence.
    "github.com/openshift/installer release-4.21 pkg/types/aws/ec2_root_volume.go Throughput": ["pkg/types/aws/machinepool.go", "EC2RootVolume.Throughput"],
    "github.com/openshift/installer release-4.21 pkg/types/aws/machinepool.go CPUOptions": ["pkg/types/aws/machinepool.go", "MachinePool.CPUOptions"],
    "github.com/openshift/installer release-4.21 pkg/types/aws/machinepool.go ConfidentialComputePolicy": ["pkg/types/aws/machinepool.go", "CPUOptions.ConfidentialCompute"],
    "github.com/openshift/installer release-4.21 pkg/types/azure/platform.go AllowSharedKeyAccess": ["pkg/types/azure/platform.go", "Platform.AllowSharedKeyAccess"],
    "github.com/openshift/installer release-4.21 pkg/types/azure/platform.go Subnets": ["pkg/types/azure/platform.go", "Platform.Subnets"],
    "github.com/openshift/installer release-4.21 pkg/types/azure/platform.go SubnetSpec.Name": ["pkg/types/azure/platform.go", "SubnetSpec.Name"],
    "github.com/openshift/installer release-4.21 pkg/types/azure/platform.go SubnetSpec.Role": ["pkg/types/azure/platform.go", "SubnetSpec.Role"],
    "github.com/openshift/installer release-4.21 pkg/types/baremetal/platform.go line 254": ["pkg/types/baremetal/platform.go", "Platform.DNSRecordsType"],
    "github.com/openshift/installer release-4.21 pkg/types/baremetal/platform.go line 267": ["pkg/types/baremetal/platform.go", "Platform.BMCVerifyCA"],
    "github.com/openshift/installer release-4.21 pkg/types/nutanix/platform.go line 96": ["pkg/types/nutanix/platform.go", "Platform.DNSRecordsType"],
    "github.com/openshift/installer release-4.21 pkg/types/vsphere/platform.go line 166": ["pkg/types/vsphere/platform.go", "Platform.DNSRecordsType"],
    "github.com/openshift/installer release-4.21 pkg/asset/tls/bmcverifyca.go": ["pkg/asset/tls/bmcverifyca.go", null],
    "github.com/openshift/installer release-4.21 pkg/asset/manifests/bmcverifycaconfigmap.go": ["pkg/asset/manifests/bmcverifycaconfigmap.go", null],
  }),
});

// ---------------------------------------------------------------------------
// R7 — internal pseudo-citations (triage class C)
// ---------------------------------------------------------------------------

/**
 * The 30 parameters per minor whose ONLY citation is
 * `docId: missing-parameter-analysis` / `docTitle: "DOC-082 Missing Parameter
 * Analysis"`, pointing at the bare product root. They are internal analysis
 * notes, not documentation, so they cannot stay — and they cannot simply be
 * deleted either, because the validator requires a non-empty citations array.
 *
 * Each is replaced by the installer-source citation for the Go field that
 * actually backs the YAML path, with the struct and field verified inside that
 * minor's own pinned clone. That swaps a fabricated citation for a verifiable
 * one without asserting documentation that was never identified.
 *
 * Enriching these with documentation citations is deliberately NOT done here:
 * the parameter-reference chapter URLs for the AWS, Azure and bare-metal books
 * are not in data/docs-index/<minor>.json and could not be confirmed live
 * (docs.redhat.com began returning 503). Deriving those URLs by analogy would
 * be inventing them. Recorded as a follow-up, not an H3 blocker: the rows below
 * end up schema-valid and truthful either way.
 *
 * Keyed by minor, then parameter path. Note `platform.azure.computeSubnet` and
 * `platform.azure.controlPlaneSubnet`: the Go field is renamed `Deprecated*` at
 * 4.21 and not at 4.20, so the two minors cite different symbols for the same
 * YAML path. This is exactly why the table is per minor.
 */
const PSEUDO_CITATION_REPLACEMENTS = Object.freeze({
  "4.20": Object.freeze({
    "networking.clusterNetworkMTU": ["pkg/types/installconfig.go", "Networking.ClusterNetworkMTU"],
    "platform.aws.defaultMachinePlatform": ["pkg/types/aws/platform.go", "Platform.DefaultMachinePlatform"],
    "platform.aws.subnets": ["pkg/types/aws/platform.go", "Platform.DeprecatedSubnets"],
    "platform.aws.vpc": ["pkg/types/aws/platform.go", "Platform.VPC"],
    "platform.azure.computeSubnet": ["pkg/types/azure/platform.go", "Platform.ComputeSubnet"],
    "platform.azure.controlPlaneSubnet": ["pkg/types/azure/platform.go", "Platform.ControlPlaneSubnet"],
    "platform.azure.defaultMachinePlatform": ["pkg/types/azure/platform.go", "Platform.DefaultMachinePlatform"],
    "platform.azure.networkResourceGroupName": ["pkg/types/azure/platform.go", "Platform.NetworkResourceGroupName"],
    "platform.azure.virtualNetwork": ["pkg/types/azure/platform.go", "Platform.VirtualNetwork"],
    "platform.baremetal.bootstrapOSImage": ["pkg/types/baremetal/platform.go", "Platform.BootstrapOSImage"],
    "platform.baremetal.clusterOSImage": ["pkg/types/baremetal/platform.go", "Platform.ClusterOSImage"],
    "platform.nutanix.defaultMachinePlatform": ["pkg/types/nutanix/platform.go", "Platform.DefaultMachinePlatform"],
    "platform.nutanix.failureDomains": ["pkg/types/nutanix/platform.go", "Platform.FailureDomains"],
    "platform.nutanix.prismElements": ["pkg/types/nutanix/platform.go", "Platform.PrismElements"],
    "platform.vsphere.defaultMachinePlatform": ["pkg/types/vsphere/platform.go", "Platform.DefaultMachinePlatform"],
  }),
  "4.21": Object.freeze({
    "networking.clusterNetworkMTU": ["pkg/types/installconfig.go", "Networking.ClusterNetworkMTU"],
    "platform.aws.defaultMachinePlatform": ["pkg/types/aws/platform.go", "Platform.DefaultMachinePlatform"],
    "platform.aws.subnets": ["pkg/types/aws/platform.go", "Platform.DeprecatedSubnets"],
    "platform.aws.vpc": ["pkg/types/aws/platform.go", "Platform.VPC"],
    "platform.azure.computeSubnet": ["pkg/types/azure/platform.go", "Platform.DeprecatedComputeSubnet"],
    "platform.azure.controlPlaneSubnet": ["pkg/types/azure/platform.go", "Platform.DeprecatedControlPlaneSubnet"],
    "platform.azure.defaultMachinePlatform": ["pkg/types/azure/platform.go", "Platform.DefaultMachinePlatform"],
    "platform.azure.networkResourceGroupName": ["pkg/types/azure/platform.go", "Platform.NetworkResourceGroupName"],
    "platform.azure.virtualNetwork": ["pkg/types/azure/platform.go", "Platform.VirtualNetwork"],
    "platform.baremetal.bootstrapOSImage": ["pkg/types/baremetal/platform.go", "Platform.BootstrapOSImage"],
    "platform.baremetal.clusterOSImage": ["pkg/types/baremetal/platform.go", "Platform.ClusterOSImage"],
    "platform.nutanix.defaultMachinePlatform": ["pkg/types/nutanix/platform.go", "Platform.DefaultMachinePlatform"],
    "platform.nutanix.failureDomains": ["pkg/types/nutanix/platform.go", "Platform.FailureDomains"],
    "platform.nutanix.prismElements": ["pkg/types/nutanix/platform.go", "Platform.PrismElements"],
    "platform.vsphere.defaultMachinePlatform": ["pkg/types/vsphere/platform.go", "Platform.DefaultMachinePlatform"],
  }),
});

// ---------------------------------------------------------------------------
// R7b — URL-less `ocp_docs` stubs that CAN become real documentation citations
// ---------------------------------------------------------------------------

/**
 * Parameter-reference pages whose URL is proven at BOTH minors — live-fetched
 * and/or present in that minor's tracked, parity-validated docs index.
 *
 * The AWS, Azure and bare-metal parameter-reference chapters are deliberately
 * absent: their URLs are in neither minor's docs index and could not be
 * confirmed live (docs.redhat.com began returning 503). Deriving them by
 * analogy with the four below would be inventing a URL, which rule 12 forbids.
 * Stubs in those scenarios fall through to installer-source provenance.
 */
const PARAM_REFERENCE_PAGES = Object.freeze({
  vsphere: {
    docId: "installation-config-parameters-vsphere",
    docTitle: "Installation configuration parameters for vSphere",
    url: (m) =>
      `https://docs.redhat.com/en/documentation/openshift_container_platform/${m}/html/installing_on_vmware_vsphere/installation-config-parameters-vsphere`,
    evidence: "live at 4.20 and 4.21; chapter 9 headings read back identical",
  },
  nutanix: {
    docId: "installation-config-parameters-nutanix",
    docTitle: "Installation configuration parameters for Nutanix",
    url: (m) =>
      `https://docs.redhat.com/en/documentation/openshift_container_platform/${m}/html/installing_on_nutanix/installation-config-parameters-nutanix`,
    evidence: "data/docs-index/4.20.json and data/docs-index/4.21.json",
  },
  ibmcloud: {
    docId: "installation-config-parameters-ibm-cloud",
    docTitle: "Installation configuration parameters for IBM Cloud",
    url: (m) =>
      `https://docs.redhat.com/en/documentation/openshift_container_platform/${m}/html-single/installing_on_ibm_cloud/`,
    evidence: "data/docs-index/4.20.json and data/docs-index/4.21.json",
  },
  aws: {
    docId: "installation-config-parameters-aws",
    docTitle: "Installation configuration parameters for AWS",
    url: (m) =>
      `https://docs.redhat.com/en/documentation/openshift_container_platform/${m}/html/installing_on_aws/installation-config-parameters-aws`,
    evidence: "live at 4.20 and 4.21: 'Chapter 7. Installation configuration parameters for AWS'",
  },
  azure: {
    docId: "installation-config-parameters-azure",
    docTitle: "Installation configuration parameters for Azure",
    url: (m) =>
      `https://docs.redhat.com/en/documentation/openshift_container_platform/${m}/html/installing_on_azure/installation-config-parameters-azure`,
    evidence: "live at 4.20 and 4.21: 'Chapter 7. Installation configuration parameters for Azure'",
  },
  agent: {
    docId: "installation-config-parameters-agent",
    docTitle: "Installation configuration parameters for the Agent-based Installer",
    url: (m) =>
      `https://docs.redhat.com/en/documentation/openshift_container_platform/${m}/html/installing_an_on-premise_cluster_with_the_agent-based_installer/installation-config-parameters-agent`,
    evidence: "live at 4.21; data/docs-index for both minors",
  },
});

/** Which parameter-reference page each scenario's catalog cites. */
const SCENARIO_REFERENCE_PAGE = Object.freeze({
  "aws-govcloud-ipi": "aws",
  "aws-govcloud-upi": "aws",
  "azure-government-ipi": "azure",
  "azure-government-upi": "azure",
  "vsphere-ipi": "vsphere",
  "vsphere-upi": "vsphere",
  "nutanix-ipi": "nutanix",
  "ibm-cloud-ipi": "ibmcloud",
  "bare-metal-agent": "agent",
  "vsphere-agent": "agent",
});

/**
 * Section containing each parameter, located in that minor's own book.
 *
 * The `controlPlane:` / `platform:` and `controlPlane:` / `replicas:` stanza
 * rows sit in the "Optional configuration parameters" table of every book —
 * verified at both minors in the vSphere, IBM Cloud, Agent and Nutanix books.
 * Chapter numbers are stable across 4.20 and 4.21 for all four (vSphere 9,
 * IBM Cloud 9, Agent 9, Nutanix 7), so one table serves both minors; the
 * numbering was nonetheless confirmed separately in each.
 */
const STUB_SECTIONS = Object.freeze({
  vsphere: {
    "controlPlane.platform": "9.1.3. Optional configuration parameters",
    "controlPlane.replicas": "9.1.3. Optional configuration parameters",
  },
  agent: {
    "controlPlane.platform": "9.1.3. Optional configuration parameters",
    "controlPlane.replicas": "9.1.3. Optional configuration parameters",
  },
  ibmcloud: {
    "controlPlane.platform": "9.1.3. Optional configuration parameters",
    "controlPlane.replicas": "9.1.3. Optional configuration parameters",
    "platform.ibmcloud.defaultMachinePlatform": "9.1.4. Additional IBM Cloud configuration parameters",
  },
  aws: {
    "controlPlane.platform": "7.1.3. Optional configuration parameters",
    "controlPlane.replicas": "7.1.3. Optional configuration parameters",
    "platform.aws.defaultMachinePlatform.iamProfile": "7.1.4. Optional AWS configuration parameters",
    "platform.aws.defaultMachinePlatform.zones": "7.1.4. Optional AWS configuration parameters",
  },
  azure: {
    "controlPlane.platform": "7.1.3. Optional configuration parameters",
    "controlPlane.replicas": "7.1.3. Optional configuration parameters",
    "platform.azure.defaultMachinePlatform.osDisk.diskSizeGB": "7.1.4. Additional Azure configuration parameters",
    "platform.azure.defaultMachinePlatform.zones": "7.1.4. Additional Azure configuration parameters",
  },
  nutanix: {
    "controlPlane.platform": "7.1.3. Optional configuration parameters",
    "controlPlane.replicas": "7.1.3. Optional configuration parameters",
    "platform.nutanix.defaultMachinePlatform.bootType": "7.1.4. Additional Nutanix configuration parameters",
    "platform.nutanix.defaultMachinePlatform.categories": "7.1.4. Additional Nutanix configuration parameters",
  },
});

// ---------------------------------------------------------------------------
// R8 — `default: null`
// ---------------------------------------------------------------------------

/**
 * 17 parameters in data/params/4.21/** carry `"default": null`; 4.20 carries
 * none, using the sentinel for all 810 of its no-default rows.
 *
 * This exposed an UNREGISTERED schema/validator divergence: the schema declares
 * `default` as oneOf [string, number, boolean, null] and documents "Null if no
 * default", while the executable validator rejects null outright. The data
 * convention (1585 sentinel rows against 17 nulls) agrees with the validator,
 * and docs/PARAM_AUTHORITY.md makes the validator the executable rule, so the
 * 17 rows are normalized to the sentinel and the schema is TIGHTENED to match.
 *
 * Nothing is weakened: the schema loses a permission the data never used at the
 * baseline minor and the validator never honoured.
 */
const NULL_DEFAULT_NORMALIZES_TO = NOT_SPECIFIED;

// ---------------------------------------------------------------------------
// H3 — explicitly NOT repaired
// ---------------------------------------------------------------------------

/**
 * Citations for which no same-minor authority establishes the correct target.
 *
 * EMPTY. Tranche 0B closed all 21 per minor via CITATION_RESOLUTIONS, using
 * the fixed authority precedence recorded there. Nothing is suppressed: the
 * strict provenance guard passes because the data is correct, not because
 * anything is excused.
 *
 * The mechanism is retained deliberately. The next minor's ingestion will
 * surface citations that cannot be placed from that minor's own authorities,
 * and they must be frozen and reported rather than guessed. Adding an entry
 * here is how that is done; its behaviour is covered by fixture tests that do
 * not depend on this list being non-empty.
 *
 * Matched on `docId` AND `sectionHeading`, never on the heading alone — two
 * headings 0B froze were also used by entirely correct citations under a
 * different docId.
 */
const H3_CITATIONS = Object.freeze([]);

/**
 * True when this citation is registered unresolved and must not be touched.
 *
 * `register` is injectable so the freeze behaviour stays testable while
 * H3_CITATIONS is empty; production callers pass nothing.
 */
function isH3Citation(citation, register = H3_CITATIONS) {
  if (!citation) return false;
  return register.some(
    (h) => h.docId === citation.docId && h.sectionHeading === citation.sectionHeading
  );
}

module.exports = {
  NOT_SPECIFIED,
  INSTALLER_PINS,
  installerCitation,
  TYPE_ALIASES,
  INSTALLER_FILE_CORRECTIONS,
  DOC_URL_PROVEN_4_21,
  LEGACY_HOST_URL_MAP,
  HEADING_CORRECTIONS,
  CITATION_RELOCATIONS,
  PAGE_RELOCATIONS,
  EXTRA_PAGES,
  CITATION_RESOLUTIONS,
  MINOR_LABELLED_FIELDS,
  FIELD_FILLS,
  LEGACY_SOURCE_HANDLING,
  LEGACY_INSTALLER_URL_MAP,
  UNDOCUMENTED_PARAMETERS,
  PSEUDO_CITATION_REPLACEMENTS,
  PARAM_REFERENCE_PAGES,
  SCENARIO_REFERENCE_PAGE,
  STUB_SECTIONS,
  NULL_DEFAULT_NORMALIZES_TO,
  H3_CITATIONS,
  isH3Citation,
};
