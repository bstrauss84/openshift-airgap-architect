/**
 * Axes that are REGISTERED BUT NOT YET PROVABLE.
 *
 * Tranche 8A deliberately registers these rather than omitting them. An axis
 * that is absent from the registry is a gap nobody sees; an axis that is
 * present and reports INCOMPLETE is a gap that appears in every summary, keeps
 * the overall verdict out of GREEN, and carries its own closure plan. That is
 * the difference between a gap list in a document and a gap list that enforces
 * itself.
 *
 * Each entry declares the tranche that closes it and what "closed" means. When
 * the proof is built, the placeholder is replaced by a real axis module with
 * the same id, and nothing else in the harness changes.
 *
 * These MUST NOT be converted to PASS, NOT_APPLICABLE or WAIVED to obtain a
 * green run. NOT_APPLICABLE in particular would be false: every one of these
 * applies to this product.
 */

import { incomplete } from "../lib/status.mjs";
import { REUSE } from "../lib/evidence.mjs";

/**
 * @param {object} spec
 * @param {string} spec.id              axis id, stable across tranches
 * @param {string} spec.title           human title
 * @param {string[]} spec.inputs        staleness inputs the real axis will use
 * @param {string} spec.owner           canonical backlog item
 * @param {string} spec.tranche         tranche that closes it
 * @param {string} spec.reason          why the proof cannot be performed today
 * @param {string[]} spec.closure       concrete steps to close
 * @param {object} [spec.known]         what 8A established without proving
 */
function plannedAxis(spec) {
  return {
    id: spec.id,
    title: spec.title,
    inputs: spec.inputs,
    planned: true,
    // Planned axes are required: omitting them from the registry would hide
    // the gap, and marking them optional would let a full run go GREEN
    // without the proofs they stand for.
    required: true,
    // Nothing to reuse — these report the absence of a proof, and that answer
    // must be recomputed if the closure plan ever lands.
    reuse: REUSE.NEVER,
    async run() {
      return incomplete(spec.id, `${spec.reason} (owner: ${spec.owner}; closes in ${spec.tranche})`, {
        evidence: {
          plannedAxis: true,
          backlogItem: spec.owner,
          closesIn: spec.tranche,
          reason: spec.reason,
          closure: spec.closure,
          knownAtRegistration: spec.known ?? null,
        },
      });
    },
  };
}

export const lifecycle = plannedAxis({
  id: "lifecycle",
  title: "Resource and process lifecycle under repeated and failed operations",
  inputs: ["backend/src", "frontend/src"],
  owner: "PROD-036 / PROD-012",
  tranche: "8C",
  reason: "no deterministic resource-lifecycle probes exist; a static read cannot establish absence of leaks",
  closure: [
    "Add probes that drive each long-lived resource through N cycles and assert the resource count returns to baseline:",
    "  temp directories under os.tmpdir() across repeated bundle exports",
    "  child processes in activeProcesses across started/cancelled/failed oc-mirror jobs",
    "  SQLite statement and connection handles across repeated job cleanup",
    "  file descriptors across repeated archive generation",
    "Assert SIGTERM/SIGINT shutdown reaps every child and clears the cleanup interval.",
    "Frontend: assert no setInterval, listener or AbortController survives unmount across repeated step navigation.",
  ],
  known: {
    confirmedFinding:
      "backend/src/runtimePackage.js:225 creates an mkdtempSync temp root for the high-side runtime package and neither it nor its caller (backend/src/index.js:3732) ever removes it; the directory holds exported container image archives. Recorded for a bounded corrective tranche, not fixed in 8A.",
    staticCounts: {
      backendTimers: "7 setTimeout/setInterval sites, 10 clear* sites",
      backendChildProcesses: "spawn in installer.js, operators.js, openshiftInstaller.js, index.js; spawnSync in ocMirrorRuntime.js, runtimePackage.js",
      frontend: "204 useEffect, 29 timer sites vs 17 clears, 37 addEventListener vs 34 removeEventListener, 4 AbortController",
    },
    caution: "The raw counts above are signal for where to probe, not evidence of a defect. Asymmetry is often legitimate.",
  },
});

export const compatibility = plannedAxis({
  id: "compatibility",
  title: "Development-host and architecture compatibility matrix",
  inputs: ["backend/Containerfile", "frontend/Containerfile", "docker-compose.yml", "manifests", "docs"],
  owner: "PROD-046",
  tranche: "8E",
  reason: "only the local host has ever been exercised; no evidence exists for any other platform or architecture",
  closure: [
    "Define the matrix explicitly and record PASS only where a run actually happened.",
    "Deterministically testable in CI today: Linux/amd64 (GitHub runner), Fedora/amd64 (local).",
    "Requires infrastructure, therefore INCOMPLETE until provided: RHEL, Ubuntu, Debian, macOS+Podman VM, Windows+WSL2, arm64.",
    "Keep DEVELOPMENT HOST compatibility separate from TARGET OPENSHIFT CLUSTER architecture support; they are different matrices and conflating them would misstate the product's support boundary.",
  ],
  known: { localHost: "Fedora Linux 44, x86_64, podman 5.8.7 rootless, node v20.20.2, npm 10.8.2" },
});

export const connectivity = plannedAxis({
  id: "connectivity",
  title: "Runtime connectivity profiles and egress inventory",
  inputs: ["backend/src", "frontend/src"],
  owner: "PROD-043",
  tranche: "8E",
  reason: "no profile harness exists; 'works offline' has not been proven by denying egress and observing behaviour",
  closure: [
    "Enumerate every runtime external-call site and classify each as required / optional / discovery-only / connected-only / build-time-only.",
    "Run the backend under each profile and assert behaviour: connected, HTTP(S) proxy, NO_PROXY, custom CA / TLS interception, restricted DNS, restricted egress, fully disconnected.",
    "The disconnected profile must be proven by denying egress at the network layer and asserting no unexpected outbound attempt — not by observing that generation happens to succeed.",
  ],
  known: {
    runtimeFetchSites: [
      "backend/src/cincinnati.js:45 api.github.com (cincinnati-graph-data channels)",
      "backend/src/cincinnati.js:96 Cincinnati graph",
      "backend/src/ocMirrorRuntime.js:87,232 mirror.openshift.com (tool resolution + download)",
      "backend/src/docs.js:334 documentation fetch",
      "backend/src/index.js:1104 GitHub (feedback)",
      "backend/src/index.js:3652 mirror.openshift.com (mirror-registry)",
    ],
    note: "Site list is from a static read of backend/src and is the input to the profile harness, not evidence of behaviour.",
  },
});

export const artifacts = plannedAxis({
  id: "artifacts",
  title: "Release artifact lifecycle: build, checksums, install, upgrade, rollback, offline use",
  inputs: ["backend", "frontend", "shared", "manifests", "docker-compose.yml", "scripts", "VERSION"],
  owner: "PROD-042 / PROD-046",
  tranche: "8F",
  reason: "no release bundle format is defined, so there is no artifact whose lifecycle could be certified",
  closure: [
    "Define the release unit before automating it. Test the release model the repository actually supports (compose + kustomize), not speculative enterprise deployment machinery.",
    "Then automate: clean build from a fresh clone, reproducible install, artifact generation, checksums, manifest, start, stop, backup, restore, upgrade, rollback, offline use, archive integrity, version identity.",
    "scripts/test-backup-restore.sh and scripts/verify-backup.sh already exist and should be folded in rather than reimplemented.",
  ],
  known: {
    blockers: [
      "docker-compose.yml and manifests/base/*-deployment.yaml both reference :latest, which cannot be certified — a mutable tag makes the artifact unidentifiable (PROD-030, PROD-042).",
      "Base images registry.access.redhat.com/ubi9/nodejs-22 and ubi9/nginx-124:latest are unpinned tags.",
    ],
  },
});

export default [lifecycle, compatibility, connectivity, artifacts];
