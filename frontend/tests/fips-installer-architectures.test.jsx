/**
 * FIPS installer EXPORT BINARY architectures — guards an axis-conflation error.
 *
 * `installerUseFips` + `installerPlatformArch` choose which **openshift-install client
 * binary** is downloaded into the exported bundle. That is the export/download tool
 * binary axis, which is independent of the target-cluster architecture axis
 * (docs/minor-release/4.22/PLATFORM_METHOD_ARCH_MATRIX_4.22.md §1).
 *
 * WHY THIS FILE EXISTS. An earlier revision removed the ARM64 FIPS option, reasoning
 * from Red Hat's statement that FIPS-validated RHEL crypto applies "on only the x86_64,
 * ppc64le, and s390x architectures". That sentence is about CLUSTER NODES running
 * RHEL/RHCOS. It is not a statement about which client binaries Red Hat publishes, and
 * using it that way hid a binary Red Hat does ship.
 *
 * Ground truth, from the official per-architecture client inventories (each release's
 * own sha256sum.txt), captured 2026-10-07:
 *
 *   openshift-install-rhel9-amd64.tar.gz     4.20.40  4.21.35  4.22.16
 *   openshift-install-rhel9-arm64.tar.gz     4.20.40  4.21.35  4.22.16
 *   openshift-install-rhel9-ppc64le.tar.gz   4.20.40  4.21.35  4.22.16
 *   openshift-install-rhel9-s390x.tar.gz     4.20.40  4.21.35  4.22.16
 *
 * The arm64 artifact was downloaded, SHA256-verified against the mirror's own checksum
 * file, and confirmed to extract to an "ELF 64-bit LSB executable, ARM aarch64" named
 * openshift-install-fips.
 */
import { describe, test, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const read = (rel) => fs.readFileSync(path.resolve(__dirname, rel), "utf8");

/** Comments stripped: the file deliberately documents the axis error in prose. */
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const REVIEW_RAW = read("../src/steps/ReviewStep.jsx");
const REVIEW = stripComments(REVIEW_RAW);
const INSTALLER = read("../../backend/src/openshiftInstaller.js");

const FIPS_EXPORT_ARCHES = ["linux-amd64", "linux-arm64", "linux-ppc64le", "linux-s390x"];

describe("FIPS installer export-binary architectures", () => {
  test("every architecture Red Hat publishes a FIPS installer for is offered", () => {
    for (const arch of FIPS_EXPORT_ARCHES) {
      expect(REVIEW).toMatch(new RegExp(`value="${arch}">[^<]*RHEL 9 FIPS`));
    }
  });

  test("ARM64 is offered for FIPS, because the arm64 FIPS binary exists", () => {
    // The specific regression. Red Hat publishes openshift-install-rhel9-arm64.tar.gz
    // for every supported minor; removing this option hides a real artifact.
    expect(REVIEW).toMatch(/<option value="linux-arm64">Linux ARM64 \(RHEL 9 FIPS\)<\/option>/);
  });

  test("the FIPS list is not narrowed to the cluster-node FIPS-validated set", () => {
    // Cluster-node validation covers x86_64/ppc64le/s390x. If the option list ever
    // matches exactly that set, someone has reapplied the axis-conflation error.
    const offered = FIPS_EXPORT_ARCHES.filter((a) =>
      new RegExp(`value="${a}">[^<]*RHEL 9 FIPS`).test(REVIEW)
    );
    expect(offered).toHaveLength(4);
    expect(offered).toContain("linux-arm64");
  });

  test("no constant encodes cluster-FIPS architectures as an export-binary restriction", () => {
    expect(REVIEW).not.toMatch(/FIPS_VALIDATED_INSTALLER_ARCHES/);
  });

  test("the backend builds a per-architecture FIPS URL, consistent with the inventory", () => {
    // getInstallerUrls composes openshift-install-rhel9-${fileArch}.tar.gz, i.e. it
    // already assumes a FIPS artifact exists for whatever arch is selected. The UI
    // offering fewer arches than the backend can fetch was the inconsistency.
    expect(INSTALLER).toMatch(/openshift-install-rhel9-\$\{fileArch\}\.tar\.gz/);
  });

  test("standard (non-FIPS) ARM64 downloads remain available", () => {
    expect(REVIEW).toMatch(/<option value="linux-arm64">Linux ARM64<\/option>/);
    expect(REVIEW).toMatch(/<option value="mac-arm64">macOS ARM64 \(Apple Silicon\)<\/option>/);
  });

  test("the axis distinction is documented in the source, not only in the ledger", () => {
    // Prose, deliberately asserted against the RAW file: the note is the thing that
    // stops the next reader repeating the error.
    expect(REVIEW_RAW).toMatch(/FIPS_EXPORT_BINARY_NOTE/);
    expect(REVIEW_RAW).toMatch(/cluster-node FIPS validation|CLUSTER NODES/i);
  });
});
