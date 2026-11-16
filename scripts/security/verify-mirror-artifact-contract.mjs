#!/usr/bin/env node
/**
 * Verify that Red Hat's mirrors still publish what the acquisition code assumes.
 *
 *   node scripts/security/verify-mirror-artifact-contract.mjs
 *
 * REQUIRES NETWORK, and is therefore deliberately NOT part of any default
 * suite. The backend tests are hermetic on purpose — this is an airgap tool and
 * its test suite must run disconnected — and
 * `backend/test/test-integrity.test.js` forbids conditionally-skipped tests, so
 * "network test behind an env var" is not available as a shortcut. This is the
 * sanctioned place for a live check instead.
 *
 * WHAT IT PROVES, and why each assumption is load-bearing:
 *
 *   1. mirror-registry publishes a parseable sha256sum.txt naming amd64,
 *      ppc64le and s390x — the three values in MIRROR_REGISTRY_ARCHES
 *      (backend/src/index.js). Without the manifest, the bundle export now
 *      fails closed rather than shipping unverified bytes.
 *   2. mirror-registry publishes NO arm64/aarch64 build. If Red Hat ever adds
 *      one, MIRROR_REGISTRY_ARCHES and the frontend's architecture selector
 *      both become wrong by omission, and this check is how that is noticed.
 *   3. openshift-install is published per-architecture under
 *      /pub/openshift-v4/<arch>/clients/ocp/<version>/, and the four
 *      architectures carry FOUR DIFFERENT digests for the same file name. That
 *      difference is the whole reason backend/src/installer.js resolves the
 *      host architecture: the architecture-free legacy path is an x86_64 alias,
 *      so it silently served an unrunnable binary on aarch64 hosts.
 *
 * Exit codes: 0 all contracts hold, 1 a contract is broken, 2 could not check
 * (network/transport). A broken contract is a real finding — fix the code or
 * the constant, do not relax the check.
 */

// Side-effect import: routes global fetch through HTTP_PROXY/HTTPS_PROXY and
// applies the project's Go-compatible NO_PROXY CIDR matching. Without it this
// script would ignore an enterprise proxy that the backend itself honours, and
// report "unreachable" for a mirror that is in fact reachable.
import "../../backend/src/configureFetchProxy.js";
import { parseSha256Manifest } from "../../backend/src/verifiedDownload.js";

const MIRROR_REGISTRY_BASE = "https://mirror.openshift.com/pub/cgw/mirror-registry/latest";
const CLIENTS_BASE = "https://mirror.openshift.com/pub/openshift-v4";
const EXPECTED_MR_ARCHES = ["amd64", "ppc64le", "s390x"];
const ABSENT_MR_ARCHES = ["arm64", "aarch64"];
const INSTALLER_ARCHES = ["x86_64", "aarch64", "ppc64le", "s390x"];
const INSTALLER_PROBE_VERSION = process.env.OAA_INSTALLER_PROBE_VERSION || "4.22.16";

let failures = 0;
let checks = 0;

const ok = (msg) => { checks++; console.log(`  PASS  ${msg}`); };
const bad = (msg) => { checks++; failures++; console.log(`  FAIL  ${msg}`); };

async function fetchText(url) {
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.text();
}

async function headStatus(url) {
  const res = await fetch(url, { method: "HEAD", redirect: "follow" });
  return res.status;
}

async function checkMirrorRegistry() {
  console.log(`\nmirror-registry (${MIRROR_REGISTRY_BASE})`);
  const manifest = parseSha256Manifest(await fetchText(`${MIRROR_REGISTRY_BASE}/sha256sum.txt`));
  if (manifest.size === 0) {
    bad("sha256sum.txt parsed to zero entries — the export would now fail closed");
    return;
  }
  ok(`sha256sum.txt parses (${manifest.size} entries)`);

  for (const arch of EXPECTED_MR_ARCHES) {
    const name = `mirror-registry-${arch}.tar.gz`;
    if (manifest.has(name)) ok(`manifest names ${name}`);
    else bad(`manifest is MISSING ${name} — MIRROR_REGISTRY_ARCHES offers an arch the mirror does not publish`);
  }

  for (const arch of ABSENT_MR_ARCHES) {
    const name = `mirror-registry-${arch}.tar.gz`;
    if (!manifest.has(name)) {
      ok(`no ${arch} build, as expected`);
    } else {
      bad(`an ${arch} build now EXISTS — add it to MIRROR_REGISTRY_ARCHES (backend/src/index.js) and to the selector in frontend/src/steps/ReviewStep.jsx`);
    }
  }
}

async function checkInstallerPerArch() {
  const v = INSTALLER_PROBE_VERSION;
  console.log(`\nopenshift-install per-architecture (${v})`);
  const digests = new Map();

  for (const arch of INSTALLER_ARCHES) {
    const url = `${CLIENTS_BASE}/${arch}/clients/ocp/${v}/sha256sum.txt`;
    let manifest;
    try {
      manifest = parseSha256Manifest(await fetchText(url));
    } catch (err) {
      bad(`${arch}: could not read sha256sum.txt (${err.message})`);
      continue;
    }
    const digest = manifest.get("openshift-install-linux.tar.gz");
    if (!digest) {
      bad(`${arch}: manifest does not name openshift-install-linux.tar.gz`);
      continue;
    }
    digests.set(arch, digest);
    ok(`${arch}: openshift-install-linux.tar.gz ${digest.slice(0, 12)}…`);
  }

  // The architecture axis only matters if the binaries actually differ.
  const unique = new Set(digests.values());
  if (digests.size > 1 && unique.size === digests.size) {
    ok(`all ${digests.size} architectures publish distinct binaries — the host-arch resolution in installer.js is load-bearing`);
  } else if (digests.size > 1) {
    bad(`two architectures share a digest; expected ${digests.size} distinct, saw ${unique.size}. Re-check the assumption in backend/src/installer.js`);
  }

  // The legacy architecture-free path must still be understood as an x86_64 alias.
  try {
    const legacy = parseSha256Manifest(await fetchText(`${CLIENTS_BASE}/clients/ocp/${v}/sha256sum.txt`));
    const legacyDigest = legacy.get("openshift-install-linux.tar.gz");
    if (legacyDigest && legacyDigest === digests.get("x86_64")) {
      ok("the architecture-free legacy path is still an x86_64 alias (why it must never be used)");
    } else if (legacyDigest) {
      bad("the architecture-free legacy path no longer matches x86_64 — re-examine backend/src/installer.js");
    }
  } catch {
    ok("the architecture-free legacy path is no longer served (it was an x86_64 alias)");
  }
}

async function checkSignatureAvailability() {
  console.log("\ndetached signatures (informational — NOT verified by this project)");
  for (const url of [
    `${CLIENTS_BASE}/x86_64/clients/ocp/${INSTALLER_PROBE_VERSION}/sha256sum.txt.gpg`,
    `${MIRROR_REGISTRY_BASE}/sha256sum.txt.gpg`
  ]) {
    try {
      const status = await headStatus(url);
      console.log(`  ${status === 200 ? "note " : "note "} HTTP ${status}  ${url}`);
    } catch (err) {
      console.log(`  note  unreachable  ${url} (${err.message})`);
    }
  }
  console.log(
    "  These exist but are NOT checked. Verifying them requires pinning a Red Hat\n" +
    "  signing key as a trust anchor — a human decision, see\n" +
    "  docs/security/DECISION_RECORD_API_EXPOSURE_AND_TRUST_ANCHORS.md (Decision B)."
  );
}

async function main() {
  console.log("Red Hat mirror artifact contract check");
  console.log("======================================");
  try {
    await checkMirrorRegistry();
    await checkInstallerPerArch();
    await checkSignatureAvailability();
  } catch (err) {
    console.error(`\nCould not complete the check: ${err.message}`);
    process.exit(2);
  }

  console.log(`\n${failures === 0 ? "OK" : "BROKEN"}: ${checks - failures}/${checks} contract checks passed`);
  process.exit(failures === 0 ? 0 : 1);
}

main();
