/**
 * The v2.1 Tranche 8D finding ledger: real findings, real evidence.
 *
 * SOURCE OF THE NUMBERS. Containerized Trivy 0.75.0, digest-pinned
 * `docker.io/aquasec/trivy@sha256:af6acf9a6b85dfe389a1941505c0ce9efef52a4719635e1a962f022a3d855daa`,
 * vulnerability DB UpdatedAt 2026-10-13T19:11:46Z (NextUpdate
 * 2026-10-14T19:11:46Z — current, not stale, at the time of analysis). Scanned
 * artifacts were OCI layout DIRECTORIES produced with
 * `podman save --format oci-dir`, because Trivy's `--input` cannot read an
 * oci-archive tar.
 *
 *   backend  sha256:7252836047c2…  1 CRITICAL / 253 HIGH
 *   frontend sha256:6154276a8ba0…  0 CRITICAL /  29 HIGH
 *
 * WHAT IS AND IS NOT ASSERTED HERE. Every `not-applicable-with-evidence` row
 * below is backed by BOTH a Red Hat CSAF VEX justification AND an independent
 * local measurement of the shipping binary. Rows where only local reasoning
 * exists are left `unknown-applicability` and routed to a human, even where
 * the local reasoning is strong — see the kernel-headers entry, whose
 * "no executable code in the package" measurement is factual but is not a
 * vendor statement and is therefore not ours to close.
 *
 * NO WAIVER IS GRANTED IN THIS FILE. Waivers are human decisions governed by
 * `scripts/release/waivers.json` and validated by `scripts/release/lib/status.mjs`.
 */

import {
  CONFIDENCE,
  COMPONENT,
  EVIDENCE_SOURCE,
  FindingLedger,
  STATUS,
  makeEvidence,
  makeFinding,
  makeRemediation,
} from "./findingLedger.mjs";

/** Scanner provenance string reused by every row. */
export const SCANNER = "trivy-0.75.0@sha256:af6acf9a6b85dfe389a1941505c0ce9efef52a4719635e1a962f022a3d855daa; db UpdatedAt 2026-10-13T19:11:46Z";

/** The exact oc-mirror build under analysis, as measured, not as labelled. */
export const SHIPPED_OC_MIRROR = Object.freeze({
  tarball: "https://mirror.openshift.com/pub/openshift-v4/x86_64/clients/ocp/latest/oc-mirror.tar.gz",
  tarballSha256: "7bad7aeeb27f6fee911599fcab000587d4066eafb58a7c88aed366676599bb73",
  binarySha256: "7f995715680a560d75bca9dda3b39e6c236600b95d9413ee683d5374aee82baa",
  // These two are DIFFERENT commits, and both are correct. `gitCommit` is the
  // downstream release/version string baked into the binary (it appears
  // verbatim in `versionFromGit` below); `moduleVersion` carries the Go build
  // `vcs.revision`. Recorded side by side without comment they read like a
  // contradiction, so the distinction is stated here rather than rediscovered.
  moduleVersion: "github.com/openshift/oc-mirror/v2 v2.0.0-20260930132353-df4f46355037",
  gitCommit: "3f66edaf31831b93043b0baa55d02462d4e7ee39",
  versionFromGit: "4.22.0-202609301304.p2.g3f66eda.assembly.stream.el9-3f66eda",
  buildDate: "2026-09-30T13:37:46Z",
  vendoredGrpc: "google.golang.org/grpc v1.73.0",
});

// ---------------------------------------------------------------------------
// CRITICAL
// ---------------------------------------------------------------------------

const grpcAuthzBypass = makeFinding({
  id: "OAA-8D-001",
  cveIds: ["CVE-2026-33186"],
  packageName: "google.golang.org/grpc",
  installedVersion: "v1.73.0",
  component: COMPONENT.BACKEND_IMAGE_GO_BINARY,
  severity: "CRITICAL",
  scannerSource: `${SCANNER}; target usr/local/bin/oc-mirror (gobinary)`,
  status: STATUS.NOT_APPLICABLE_WITH_EVIDENCE,
  evidence: [
    makeEvidence({
      source: EVIDENCE_SOURCE.CSAF_VEX,
      ref: "https://security.access.redhat.com/data/csaf/v2/vex/2026/cve-2026-33186.json",
      justification: "vulnerable_code_not_present",
      confidence: CONFIDENCE.VENDOR_ASSERTED,
      summary:
        "Red Hat places registry.redhat.io/openshift4/oc-mirror-plugin-rhel9 in known_not_affected for OCP 4.15 through 4.22 (all four architectures), flagged vulnerable_code_not_present. Re-fetched and re-parsed independently on 2026-10-14; the document carries 39271 known_not_affected product ids and 362 known_affected, none of the latter being an oc-mirror product.",
      observedAt: "2026-10-14",
    }),
    makeEvidence({
      source: EVIDENCE_SOURCE.LOCAL_STATIC,
      ref: "go tool nm /usr/local/bin/oc-mirror (342979 nm lines) extracted from backend image sha256:7252836047c2…",
      confidence: CONFIDENCE.INFERRED,
      summary:
        "The vulnerable package google.golang.org/grpc/authz is entirely absent: 0 matching symbols and 0 occurrences of the string 'google.golang.org/grpc/authz' in the binary's path data. grpc.NewServer is also absent, so no *grpc.Server can be constructed through the exported API. CORRECTION to the prior wave's reasoning: 57 google.golang.org/grpc.(*Server).* method bodies ARE linked (Serve, ServeHTTP, handleStream, …), so the claim that 'no gRPC server code is present' was wrong; the correct and narrower claim is that the authz interceptor package is not linked at all and the server constructor is not reachable.",
      observedAt: "2026-10-14",
    }),
    makeEvidence({
      source: EVIDENCE_SOURCE.LOCAL_STATIC,
      ref: "go tool nm /usr/local/bin/oc-mirror | awk '$2==\"T\"'; go version -m and strings -a on /usr/local/bin/oc",
      confidence: CONFIDENCE.INFERRED,
      summary:
        "Two measurement caveats that materially change how the two records above should be read. (1) OUR EVIDENCE SUPPORTS A DIFFERENT JUSTIFICATION THAN THE VENDOR'S. Red Hat's label is vulnerable_code_not_present, but the upstream fix (grpc-go 1.79.3, grpc/grpc-go#8981) lands in grpc.(*Server).handleStream, and handleStream IS linked here. What our measurement actually supports is the vendor's OTHER justification, vulnerable_code_not_in_execute_path: no server is constructible via the exported API and no authorization policy exists to bypass. The NOT-APPLICABLE determination is unchanged and rests on two independent legs, but the two justifications must not be reported as agreeing. (2) nm DOUBLE-COUNTS. Each Go text symbol is emitted twice at one address, once as 'T name' and once as 't local.name', so the raw 114 lines are 57 distinct symbols at 57 distinct addresses; the prior '114 method bodies' figure was inflated 2x. The quoted 342979 total is nm LINES, not distinct symbols, for the same reason. Separately: oc links no grpc at all, but go tool nm CANNOT show that — oc is stripped and nm returns 'no symbol section'. The sound evidence is its Go build info (212 dep lines, zero google.golang.org/grpc entries) and strings -a (0 occurrences, against 13545 in oc-mirror).",
      observedAt: "2026-10-14",
    }),
  ],
  remediation: makeRemediation({
    action:
      "No action required for applicability. The grpc bump to >= 1.79.3 arrives automatically whenever Red Hat rebuilds oc-mirror; OAA does not and must not vendor its own grpc.",
    fixedVersion: null,
    effort: "none",
  }),
  notes:
    "CVE-2026-33186 is scoped by its own Red Hat title to google.golang.org/grpc/authz: an HTTP/2 :path pseudo-header validation bypass in the authorization interceptor. govulncheck -mode=binary would report the grpc symbols as present, but that mode has no call graph and reports linked bodies rather than reachability; it is cited here neither for nor against the determination.",
  humanDecision: null,
});

// ---------------------------------------------------------------------------
// oc-mirror local cache registry exposure
// ---------------------------------------------------------------------------

const ocMirrorCacheExposure = makeFinding({
  id: "OAA-8D-002",
  cveIds: ["CVE-2026-96577"],
  packageName: "openshift/oc-mirror (embedded distribution cache registry)",
  installedVersion: SHIPPED_OC_MIRROR.versionFromGit,
  component: COMPONENT.BACKEND_IMAGE_GO_BINARY,
  severity: "HIGH",
  scannerSource: "not reported by Trivy 0.75.0 against this image; sourced from Red Hat CSAF VEX and vendor advisory",
  status: STATUS.NOT_APPLICABLE_WITH_EVIDENCE,
  evidence: [
    makeEvidence({
      source: EVIDENCE_SOURCE.RHSA,
      ref: "RHSA-2026:74429 (https://access.redhat.com/errata/RHSA-2026:74429)",
      justification: "vendor_fix shipped in OpenShift Container Platform 4.22.17",
      confidence: CONFIDENCE.VENDOR_ASSERTED,
      summary:
        "'OpenShift Container Platform 4.22.17 bug fix and security update', initial release 2026-10-06T07:02:47Z, lists CVE-2026-96577 among its six CVEs. Companion errata: RHSA-2026:74434 (4.19), RHSA-2026:74380 (4.20), RHSA-2026:74383 (4.21).",
      observedAt: "2026-10-14",
    }),
    makeEvidence({
      source: EVIDENCE_SOURCE.CSAF_VEX,
      ref: "https://security.access.redhat.com/data/csaf/v2/vex/2026/cve-2026-96577.json",
      justification: "fixed (product_status.fixed) for oc-mirror-plugin-rhel9 on OCP 4.19, 4.20, 4.21 and 4.22, all four architectures",
      confidence: CONFIDENCE.VENDOR_ASSERTED,
      summary:
        "16 fixed product ids, all of them oc-mirror-plugin-rhel9. No oc-mirror product appears in known_not_affected or known_affected; the single under_investigation entry is assisted/agent-preinstall-image-builder-rhel9. Streams 4.15 through 4.18 carry no oc-mirror entry at all. CVSS v3.1 7.1 AV:A/AC:L/PR:N/UI:N/S:U/C:L/I:H/A:N, CWE-306.",
      observedAt: "2026-10-14",
    }),
    makeEvidence({
      source: EVIDENCE_SOURCE.UPSTREAM,
      ref: "openshift/oc-mirror PR #1558 'OCPBUGS-127479: Bind local storage registry to loopback only', merged 2026-09-25T08:24:04Z, merge commit 125fa8d536e32593c823cbf3dd2a91b4eaa33af6",
      justification: "upstream fix predates the shipped build date of 2026-09-30T13:37:46Z",
      confidence: CONFIDENCE.VENDOR_ASSERTED,
      summary:
        "Introduces const localStorageHost = \"127.0.0.1\"; changes the embedded registry config template from 'addr: :{{ .LocalStoragePort }}' to 'addr: {{ .LocalStorageHost }}:{{ .LocalStoragePort }}'; changes LocalStorageFQDN from \"localhost:\"+port to localStorageHost+\":\"+port; and makes isLocalStoragePortBound probe the real bind address.",
      observedAt: "2026-10-14",
    }),
    makeEvidence({
      source: EVIDENCE_SOURCE.LOCAL_STATIC,
      ref: "strings -a /usr/local/bin/oc-mirror (binary sha256 7f995715680a…)",
      confidence: CONFIDENCE.INFERRED,
      summary:
        "The shipped binary contains the POST-fix template literal 'addr: {{ .LocalStorageHost }}:{{ .LocalStoragePort }}' and the RegistryConfig field name 'LocalStorageHost'. The pre-fix marker 'localhost:%d' (the old isLocalStoragePortBound probe format) occurs 0 times. The fix is therefore compiled into commit 3f66eda.",
      observedAt: "2026-10-14",
    }),
    makeEvidence({
      source: EVIDENCE_SOURCE.LOCAL_EXECUTION,
      ref: "podman run --network=host localhost/openshift-airgap-architect-backend:latest -> oc-mirror --v2 --config isc.yaml file:///work/out ; ss -ltn",
      confidence: CONFIDENCE.VERIFIED_BY_EXECUTION,
      summary:
        "A real mirror-to-disk run of the SHIPPED binary, deliberately in the HOST network namespace so a wildcard bind would have been visible, produced exactly: 'LISTEN 0 4096 127.0.0.1:55000 0.0.0.0:*'. The cache registry binds loopback only. No 0.0.0.0:55000 listener existed at any point.",
      observedAt: "2026-10-14",
    }),
  ],
  remediation: makeRemediation({
    action:
      "None. The shipped binary already carries the fix. OAA's existing rule — resolve oc-mirror from clients/ocp/latest globally and verify against that channel's sha256sum.txt — is what delivered it, and must not be weakened.",
    fixedVersion: "4.22.17 (oc-mirror build 4.22.0-202609301304.p2.g3f66eda, commit 3f66eda)",
    effort: "none",
    provenBy: "local-execution",
  }),
  notes:
    "Artifact identity was proven, not assumed: the in-image binary sha256 7f995715680a… is byte-identical to the content of the CURRENT clients/ocp/latest/oc-mirror.tar.gz, whose tarball sha256 7bad7aee… matches the live published sha256sum.txt and the image's own /app/tools-provenance.env OC_MIRROR_RESOLVED_SHA256. There is therefore no newer official oc-mirror to adopt: the mirror directory was last modified 2026-10-06 and still serves this build. Note the label/build mismatch: the artifact is published under the 4.22.17 release yet self-reports 4.22.0-202609301304.p2.g3f66eda — version strings alone would not have settled this question.",
  humanDecision: null,
});

// ---------------------------------------------------------------------------
// OS package HIGHs, grouped by package
// ---------------------------------------------------------------------------

const scannerEvidence = (target, detail) =>
  makeEvidence({
    source: EVIDENCE_SOURCE.SCANNER,
    ref: `${SCANNER}; target ${target}`,
    confidence: CONFIDENCE.INFERRED,
    summary: detail,
    observedAt: "2026-10-13",
  });

const kernelHeaders = makeFinding({
  id: "OAA-8D-003",
  cveIds: ["kernel-headers-5.14.0-687.55.1.el9_8:141-distinct-HIGH-CVEs"],
  packageName: "kernel-headers",
  installedVersion: "5.14.0-687.55.1.el9_8",
  component: COMPONENT.BACKEND_IMAGE_OS_PKG,
  severity: "HIGH",
  scannerSource: `${SCANNER}; target /scan/backend (redhat 9.8)`,
  status: STATUS.UNKNOWN_APPLICABILITY,
  evidence: [
    scannerEvidence(
      "/scan/backend (redhat 9.8)",
      "141 of the backend image's 200 OS-package HIGH findings attach to kernel-headers alone. Every one has an empty FixedVersion: Red Hat has shipped no fixed kernel-headers NVR for them.",
    ),
    makeEvidence({
      source: EVIDENCE_SOURCE.LOCAL_EXECUTION,
      ref: "podman run … rpm -ql kernel-headers | file (backend image sha256:7252836047c2…)",
      confidence: CONFIDENCE.VERIFIED_BY_EXECUTION,
      summary:
        "The installed package contains 1036 files, 0 of them outside /usr/include and 0 of them ELF objects. It is C headers only: no kernel, no module, no executable code, and a container does not run its own kernel in any case.",
      observedAt: "2026-10-14",
    }),
    makeEvidence({
      source: EVIDENCE_SOURCE.LOCAL_EXECUTION,
      ref: "podman run … rpm -q kernel-headers (candidate image localhost/oaa-backend:hardened)",
      confidence: CONFIDENCE.VERIFIED_BY_EXECUTION,
      summary:
        "kernel-headers is not installed in the hardened candidate at all, which is the larger part of that image's drop from 253 HIGH to 86 HIGH. The remediation is therefore demonstrated, not theoretical.",
      observedAt: "2026-10-14",
    }),
  ],
  remediation: makeRemediation({
    action:
      "Remove kernel-headers from the runtime backend image rather than argue its exploitability. It is a build-time dependency that leaked into the shipping layer; the hardened candidate already proves it can be dropped.",
    fixedVersion: null,
    effort: "Containerfile change, already prototyped",
    provenBy: "local-execution",
  }),
  notes:
    "Deliberately NOT marked not-applicable. The 'headers contain no executable code' measurement is factual and was verified by execution, but it is OAA's own reasoning: Red Hat publishes no VEX statement retiring these CVEs for the kernel-headers subpackage. Under this ledger's fail-closed rule a local measurement cannot retire a finding, so it escalates. The right answer is almost certainly to delete the package, which makes the applicability question moot.",
  humanDecision:
    "HUMAN DECISION: adopt the hardened base (drop kernel-headers from the runtime image) for v2.1, or formally waive 141 HIGH CVEs with a dated, owned waiver. Do not resolve this by lowering a severity threshold.",
});

const nodejsStack = makeFinding({
  id: "OAA-8D-004",
  cveIds: ["nodejs/npm/nodejs-libs/nodejs-full-i18n/nodejs-docs/nodejs-nodemon:32-HIGH-findings-no-fix"],
  packageName: "nodejs (and npm, nodejs-libs, nodejs-full-i18n, nodejs-docs, nodejs-nodemon)",
  installedVersion: "as shipped in registry.access.redhat.com/ubi9/nodejs-22",
  component: COMPONENT.BACKEND_IMAGE_OS_PKG,
  severity: "HIGH",
  scannerSource: `${SCANNER}; target /scan/backend (redhat 9.8)`,
  status: STATUS.VENDOR_FIX_PENDING,
  evidence: [
    scannerEvidence(
      "/scan/backend (redhat 9.8)",
      "32 HIGH findings across the Node.js RPM family (npm 6, nodejs 6, nodejs-libs 6, nodejs-full-i18n 6, nodejs-docs 6, nodejs-nodemon 2), every one with an empty FixedVersion. Red Hat has published no fixed NVR, so there is nothing to adopt by rebuilding.",
    ),
    makeEvidence({
      source: EVIDENCE_SOURCE.LOCAL_EXECUTION,
      ref: "podman images / rpm -q against registry.access.redhat.com/ubi9/nodejs-22 and ubi9/nodejs-22-minimal",
      confidence: CONFIDENCE.VERIFIED_BY_EXECUTION,
      summary:
        "Both the full and -minimal UBI9 Node.js 22 base images were pulled fresh (within 18 hours of the scan) and still carry these NVRs, confirming the absence of a fix is upstream and not a stale local base image.",
      observedAt: "2026-10-14",
    }),
  ],
  remediation: makeRemediation({
    action:
      "Nothing to adopt today. Re-run the scan after each UBI9 nodejs-22 respin; the nodejs-docs and nodejs-full-i18n subpackages in particular are not needed at runtime and could be excluded to shrink the count independent of any fix.",
    fixedVersion: null,
    effort: "recurring check",
  }),
  notes: null,
  humanDecision:
    "HUMAN DECISION: accept shipping on the current UBI9 nodejs-22 base with no vendor fix available, or block v2.1 until Red Hat respins. Consider dropping nodejs-docs/nodejs-full-i18n/nodejs-nodemon from the runtime layer as independent reduction.",
});

const opensslBackend = makeFinding({
  id: "OAA-8D-005",
  cveIds: ["CVE-2026-84782"],
  packageName: "openssl, openssl-libs, openssl-devel",
  installedVersion: "1:3.5.8-1.el9_8",
  component: COMPONENT.BACKEND_IMAGE_OS_PKG,
  severity: "HIGH",
  scannerSource: `${SCANNER}; target /scan/backend (redhat 9.8)`,
  status: STATUS.FIX_AVAILABLE_NOW,
  evidence: [
    scannerEvidence(
      "/scan/backend (redhat 9.8)",
      "Three HIGH findings (one per subpackage) for CVE-2026-84782, each carrying FixedVersion 1:3.5.8-2.el9_8. A fixed RPM exists in the Red Hat 9.8 repositories and the image simply predates it.",
    ),
  ],
  remediation: makeRemediation({
    action:
      "Rebuild the backend image so dnf picks up 1:3.5.8-2.el9_8. Also drop openssl-devel from the runtime layer: a -devel package in a shipping image is build residue.",
    fixedVersion: "1:3.5.8-2.el9_8",
    effort: "rebuild",
  }),
  notes: null,
  humanDecision:
    "HUMAN DECISION (scheduling only): a fixed RPM exists, so this blocks until a rebuild is performed. No applicability analysis is needed or appropriate.",
});

const pcre2Backend = makeFinding({
  id: "OAA-8D-006",
  cveIds: ["CVE-2026-103111", "CVE-2026-86145", "CVE-2026-89161"],
  packageName: "pcre2, pcre2-syntax",
  installedVersion: "10.40-6.el9",
  component: COMPONENT.BACKEND_IMAGE_OS_PKG,
  severity: "HIGH",
  scannerSource: `${SCANNER}; target /scan/backend (redhat 9.8)`,
  status: STATUS.FIX_AVAILABLE_NOW,
  evidence: [
    scannerEvidence(
      "/scan/backend (redhat 9.8)",
      "Six HIGH findings: three CVEs across two subpackages, every one with FixedVersion 10.40-7.el9_8.",
    ),
  ],
  remediation: makeRemediation({
    action: "Rebuild the backend image to pick up 10.40-7.el9_8.",
    fixedVersion: "10.40-7.el9_8",
    effort: "rebuild",
  }),
  notes: null,
  humanDecision: "HUMAN DECISION (scheduling only): fixed RPM exists; blocks until rebuilt.",
});

const backendOsRemainder = makeFinding({
  id: "OAA-8D-007",
  cveIds: [
    "backend-os-remainder:python3",
    "backend-os-remainder:python3-libs",
    "backend-os-remainder:python3-pip-wheel",
    "backend-os-remainder:gnutls",
    "backend-os-remainder:expat",
    "backend-os-remainder:util-linux",
    "backend-os-remainder:util-linux-core",
    "backend-os-remainder:libuuid",
    "backend-os-remainder:libsmartcols",
    "backend-os-remainder:libmount",
    "backend-os-remainder:libfdisk",
    "backend-os-remainder:libblkid",
    "backend-os-remainder:vim-minimal",
    "backend-os-remainder:vim-filesystem",
  ],
  packageName: "python3 family, gnutls, expat, util-linux family, vim-minimal",
  installedVersion: "as shipped in redhat 9.8 base",
  component: COMPONENT.BACKEND_IMAGE_OS_PKG,
  severity: "HIGH",
  scannerSource: `${SCANNER}; target /scan/backend (redhat 9.8)`,
  status: STATUS.VENDOR_FIX_PENDING,
  evidence: [
    scannerEvidence(
      "/scan/backend (redhat 9.8)",
      "The 18 remaining OS HIGH findings outside kernel-headers (141), the Node.js family (32), openssl (3) and pcre2 (6) — which together account for all 200 backend OS HIGHs. All 18 carry an empty FixedVersion. Package counts: python3 2, python3-libs 2, gnutls 2, expat 2, util-linux 1, util-linux-core 1, libuuid 1, libsmartcols 1, libmount 1, libfdisk 1, libblkid 1, python3-pip-wheel 1, vim-minimal 1, vim-filesystem 1.",
    ),
  ],
  remediation: makeRemediation({
    action:
      "No vendor fix to adopt. vim-minimal, vim-filesystem and the python3 stack are not required by the backend runtime and are candidates for removal, which eliminates the findings outright rather than waiting on Red Hat.",
    fixedVersion: null,
    effort: "base image slimming",
  }),
  notes:
    "Grouped deliberately. These are long-tail base-image findings with no fix; enumerating 18 near-identical rows would bury the two rows that actually have fixes available (OAA-8D-005, OAA-8D-006).",
  humanDecision:
    "HUMAN DECISION: accept the no-fix base-image long tail for v2.1, or require the slimmed base. Removal is preferred over waiver where the package is genuinely unused at runtime.",
});

// ---------------------------------------------------------------------------
// Frontend
// ---------------------------------------------------------------------------

const opensslFrontend = makeFinding({
  id: "OAA-8D-008",
  cveIds: ["CVE-2026-84782"],
  packageName: "openssl, openssl-libs",
  installedVersion: "1:3.5.8-1.el9_8",
  component: COMPONENT.FRONTEND_IMAGE_OS_PKG,
  severity: "HIGH",
  scannerSource: `${SCANNER}; target /scan/frontend (redhat 9.8)`,
  status: STATUS.FIX_AVAILABLE_NOW,
  evidence: [
    scannerEvidence(
      "/scan/frontend (redhat 9.8)",
      "Two HIGH findings for CVE-2026-84782, FixedVersion 1:3.5.8-2.el9_8. Note openssl-devel is absent here, unlike the backend image.",
    ),
  ],
  remediation: makeRemediation({
    action: "Rebuild the frontend image to pick up 1:3.5.8-2.el9_8.",
    fixedVersion: "1:3.5.8-2.el9_8",
    effort: "rebuild",
  }),
  notes: null,
  humanDecision: "HUMAN DECISION (scheduling only): fixed RPM exists; blocks until rebuilt.",
});

const pcre2Frontend = makeFinding({
  id: "OAA-8D-009",
  cveIds: ["CVE-2026-103111", "CVE-2026-86145", "CVE-2026-89161"],
  packageName: "pcre2, pcre2-syntax",
  installedVersion: "10.40-6.el9",
  component: COMPONENT.FRONTEND_IMAGE_OS_PKG,
  severity: "HIGH",
  scannerSource: `${SCANNER}; target /scan/frontend (redhat 9.8)`,
  status: STATUS.FIX_AVAILABLE_NOW,
  evidence: [
    scannerEvidence("/scan/frontend (redhat 9.8)", "Six HIGH findings: three CVEs across two subpackages, FixedVersion 10.40-7.el9_8."),
  ],
  remediation: makeRemediation({
    action: "Rebuild the frontend image to pick up 10.40-7.el9_8.",
    fixedVersion: "10.40-7.el9_8",
    effort: "rebuild",
  }),
  notes: null,
  humanDecision: "HUMAN DECISION (scheduling only): fixed RPM exists; blocks until rebuilt.",
});

const gdFrontend = makeFinding({
  id: "OAA-8D-010",
  cveIds: ["CVE-2026-9672"],
  packageName: "gd",
  installedVersion: "2.3.2-3.el9",
  component: COMPONENT.FRONTEND_IMAGE_OS_PKG,
  severity: "HIGH",
  scannerSource: `${SCANNER}; target /scan/frontend (redhat 9.8)`,
  status: STATUS.FIX_AVAILABLE_NOW,
  evidence: [
    scannerEvidence("/scan/frontend (redhat 9.8)", "One HIGH finding, FixedVersion 2.3.2-3.el9_8.1. gd is an image-manipulation library with no role in serving the built frontend bundle."),
  ],
  remediation: makeRemediation({
    action: "Rebuild to pick up 2.3.2-3.el9_8.1, or remove gd from the frontend runtime image where it appears to be unused.",
    fixedVersion: "2.3.2-3.el9_8.1",
    effort: "rebuild or removal",
  }),
  notes: "'gd appears unused' is INFERRED, not measured. It is recorded as a remediation hint only and is not used to retire the finding.",
  humanDecision: "HUMAN DECISION (scheduling only): fixed RPM exists; blocks until rebuilt.",
});

const frontendOsRemainder = makeFinding({
  id: "OAA-8D-011",
  cveIds: [
    "frontend-os-remainder:python3",
    "frontend-os-remainder:python3-libs",
    "frontend-os-remainder:python3-pip-wheel",
    "frontend-os-remainder:gnutls",
    "frontend-os-remainder:expat",
    "frontend-os-remainder:util-linux",
    "frontend-os-remainder:util-linux-core",
    "frontend-os-remainder:libuuid",
    "frontend-os-remainder:libsmartcols",
    "frontend-os-remainder:libmount",
    "frontend-os-remainder:libfdisk",
    "frontend-os-remainder:libblkid",
    "frontend-os-remainder:libX11",
    "frontend-os-remainder:libX11-common",
    "frontend-os-remainder:vim-minimal",
    "frontend-os-remainder:vim-filesystem",
  ],
  packageName: "python3 family, gnutls, expat, util-linux family, libX11, vim-minimal",
  installedVersion: "as shipped in redhat 9.8 base",
  component: COMPONENT.FRONTEND_IMAGE_OS_PKG,
  severity: "HIGH",
  scannerSource: `${SCANNER}; target /scan/frontend (redhat 9.8)`,
  status: STATUS.VENDOR_FIX_PENDING,
  evidence: [
    scannerEvidence(
      "/scan/frontend (redhat 9.8)",
      "The 20 remaining frontend OS HIGH findings, all with an empty FixedVersion. libX11 and libX11-common in a frontend serving image are a particularly clear removal candidate.",
    ),
  ],
  remediation: makeRemediation({
    action: "No vendor fix to adopt. Slim the frontend base; libX11, vim and the python3 stack have no role in serving static assets.",
    fixedVersion: null,
    effort: "base image slimming",
  }),
  notes: null,
  humanDecision: "HUMAN DECISION: accept the no-fix frontend base-image long tail for v2.1, or require the slimmed base.",
});

// ---------------------------------------------------------------------------
// Go binary HIGHs
// ---------------------------------------------------------------------------

const goBinaryHighs = makeFinding({
  id: "OAA-8D-012",
  cveIds: [
    "gobinary-high:stdlib",
    "gobinary-high:golang.org/x/net",
    "gobinary-high:golang.org/x/text",
    "gobinary-high:golang.org/x/crypto",
    "gobinary-high:google.golang.org/grpc",
    "gobinary-high:oras.land/oras-go/v2",
    "gobinary-high:github.com/distribution/distribution/v3",
    "gobinary-high:github.com/docker/docker",
    "gobinary-high:github.com/docker/cli",
    "gobinary-high:github.com/containerd/containerd",
    "gobinary-high:github.com/moby/buildkit",
    "gobinary-high:github.com/moby/spdystream",
    "gobinary-high:github.com/moby/go-archive",
    "gobinary-high:github.com/sigstore/fulcio",
    "gobinary-high:github.com/go-git/go-git/v5",
    "gobinary-high:github.com/go-git/go-billy/v5",
    "gobinary-high:github.com/go-jose/go-jose/v4",
    "gobinary-high:github.com/opencontainers/selinux",
    "gobinary-high:go.opentelemetry.io/otel",
    "gobinary-high:go.opentelemetry.io/otel/sdk",
  ],
  packageName: "Go module dependencies vendored into /usr/local/bin/oc and /usr/local/bin/oc-mirror",
  installedVersion: "oc 4.22.17 / oc-mirror 4.22.0-202609301304.p2.g3f66eda (both Go 1.25.14, FIPS)",
  component: COMPONENT.BACKEND_IMAGE_GO_BINARY,
  severity: "HIGH",
  scannerSource: `${SCANNER}; targets usr/local/bin/oc (20 HIGH) and usr/local/bin/oc-mirror (33 HIGH)`,
  status: STATUS.UNKNOWN_APPLICABILITY,
  evidence: [
    scannerEvidence(
      "usr/local/bin/oc and usr/local/bin/oc-mirror (gobinary)",
      "53 HIGH findings across 20 distinct Go modules: 49 carry an upstream FixedVersion (e.g. golang.org/x/net v0.49.0 -> 0.55.0, stdlib v1.25.14 -> 1.26.9) and 4 have no upstream fix at all (github.com/docker/docker CVE-2026-41567 and CVE-2026-42306, in both binaries). Where a fixed version exists it is the UPSTREAM module version, not something OAA can apply: both binaries are vendor-built Red Hat artifacts.",
    ),
    makeEvidence({
      source: EVIDENCE_SOURCE.LOCAL_STATIC,
      ref: "go version -m on both binaries, extracted from backend image sha256:7252836047c2…",
      confidence: CONFIDENCE.INFERRED,
      summary:
        "Both are Red Hat builds (oc-mirror: go1.25.14 Red Hat 1.25.14-1.el8_10, X:strictfipsruntime). OAA neither compiles nor patches them, so the only remediation channel is a Red Hat respin picked up by the existing clients/ocp/latest resolution.",
      observedAt: "2026-10-14",
    }),
  ],
  remediation: makeRemediation({
    action:
      "Per-CVE Red Hat VEX triage of all 53, which has not been performed. Do NOT vendor or patch these binaries: OAA's policy is to take the vendor artifact and verify its checksum. A Red Hat respin is the only legitimate fix path.",
    fixedVersion: null,
    effort: "53-CVE VEX triage",
  }),
  notes:
    "Honest scope statement: only CVE-2026-33186 (CRITICAL) and CVE-2026-96577 were analysed to a determination in this tranche. The other 53 Go-binary HIGHs are recorded as unknown rather than assumed to share the CRITICAL's not-applicable outcome. The upstream FixedVersion column must not be read as 'a fix OAA can apply'.",
  humanDecision:
    "HUMAN DECISION: fund per-CVE Red Hat VEX triage of the 53 Go-binary HIGHs, or accept them as vendor-artifact risk for v2.1 with a dated, owned waiver. They cannot be auto-dispositioned.",
});

// ---------------------------------------------------------------------------

export const TRANCHE_8D_FINDINGS = Object.freeze([
  grpcAuthzBypass,
  ocMirrorCacheExposure,
  kernelHeaders,
  nodejsStack,
  opensslBackend,
  pcre2Backend,
  backendOsRemainder,
  opensslFrontend,
  pcre2Frontend,
  gdFrontend,
  frontendOsRemainder,
  goBinaryHighs,
]);

export function buildTranche8dLedger() {
  return new FindingLedger(TRANCHE_8D_FINDINGS);
}
