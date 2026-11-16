/**
 * AXIS: compatibility — development-host and architecture matrix.
 *
 * Replaces the `compatibility` placeholder, whose reason was "only the local
 * host has ever been exercised; no evidence exists for any other platform or
 * architecture". That is still true of most of the matrix, and this axis says
 * so cell by cell instead of as one sentence.
 *
 * THE RULE THIS AXIS ENFORCES, from its own closure plan:
 *
 *   "Record PASS only where a run actually happened."
 *
 * So a cell is VERIFIED only when this process can observe that it is
 * executing on that platform right now. Everything else is UNVERIFIED with a
 * named reason. There is no inference: amd64 passing tells you nothing about
 * arm64, and Fedora passing tells you nothing about Debian. An axis that
 * extrapolated would be worse than the placeholder, because it would look
 * like evidence.
 *
 * TWO MATRICES, DELIBERATELY NOT ONE
 *
 * The closure plan is explicit: "Keep DEVELOPMENT HOST compatibility separate
 * from TARGET OPENSHIFT CLUSTER architecture support; they are different
 * matrices and conflating them would misstate the product's support
 * boundary." This is the same two-axis error CLAUDE.md records as a permanent
 * lesson — the host that RUNS Architect is not the cluster Architect BUILDS
 * FOR. A user on an aarch64 laptop can legitimately produce artifacts for an
 * x86_64 cluster. This axis certifies only the first matrix and states the
 * second is out of its scope rather than silently covering it.
 *
 * WHY IT CANNOT CURRENTLY PASS, AND WHY THAT IS CORRECT
 *
 * DOC-080 owns the published support matrix and records that only Fedora is
 * confirmed. Until the uncovered cells are either exercised or formally
 * declared unsupported in the published matrix, the honest verdict is
 * INCOMPLETE. The axis names exactly which cells and what would close each —
 * that list is the deliverable.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pass, incomplete, fail } from "../lib/status.mjs";
import { REUSE } from "../lib/evidence.mjs";
import { run, hasTool } from "../lib/exec.mjs";

const ID = "compatibility";

/**
 * The DEVELOPMENT HOST matrix: environments a user may run Architect from.
 *
 * `requiredForRelease` marks the cells the published support matrix (DOC-080)
 * claims or intends to claim. A cell that is unverified AND required is what
 * keeps this axis out of PASS.
 */
const HOST_MATRIX = Object.freeze([
  { id: "linux-x86_64-fedora", os: "linux", arch: "x64", distroMatch: /fedora/i, label: "Fedora Linux / x86_64", requiredForRelease: true },
  { id: "linux-x86_64-rhel", os: "linux", arch: "x64", distroMatch: /red hat enterprise|rhel|centos|rocky|alma/i, label: "RHEL family / x86_64", requiredForRelease: true },
  { id: "linux-x86_64-debian", os: "linux", arch: "x64", distroMatch: /debian|ubuntu/i, label: "Debian/Ubuntu / x86_64", requiredForRelease: true },
  { id: "linux-aarch64", os: "linux", arch: "arm64", distroMatch: /./, label: "Linux / aarch64", requiredForRelease: false },
  { id: "macos-podman-vm", os: "darwin", arch: null, distroMatch: /./, label: "macOS + Podman Desktop VM", requiredForRelease: false },
  { id: "windows-wsl2", os: "win32", arch: null, distroMatch: /./, label: "Windows + WSL2", requiredForRelease: false },
]);

/** Runtime prerequisites the product actually needs on a development host. */
const PREREQUISITES = Object.freeze([
  { tool: "node", minMajor: 20, why: "backend runtime" },
  { tool: "npm", minMajor: 10, why: "dependency install" },
  { tool: "git", minMajor: 2, why: "candidate identity" },
]);

/** Container engines; at least one is needed for the container workflow. */
const ENGINES = Object.freeze(["podman", "docker"]);

function readOsRelease() {
  for (const p of ["/etc/os-release", "/usr/lib/os-release"]) {
    try {
      const text = fs.readFileSync(p, "utf8");
      const fields = {};
      for (const line of text.split("\n")) {
        const m = line.match(/^([A-Z_]+)=(.*)$/);
        if (m) fields[m[1]] = m[2].replace(/^"|"$/g, "");
      }
      return fields;
    } catch {
      /* next candidate */
    }
  }
  return null;
}

function toolVersion(tool) {
  if (!hasTool(tool)) return null;
  const res = run(tool, ["--version"], { timeoutMs: 15_000 });
  return res.status === 0 ? (res.stdout || res.stderr || "").trim().split("\n")[0] : null;
}

function majorOf(versionText) {
  const m = String(versionText || "").match(/(\d+)\./);
  return m ? Number(m[1]) : null;
}

export default {
  id: ID,
  title: "Development-host and architecture compatibility matrix",
  required: true,
  // NEVER: this is a statement about the machine the run happened on, which
  // is not a property of the candidate source and must not be inherited from
  // a previous run on a different machine.
  reuse: REUSE.NEVER,
  inputs: ["backend/Containerfile", "frontend/Containerfile", "docker-compose.yml", "manifests", "docs"],

  async run({ repoRoot, store }) {
    const osRelease = readOsRelease();
    const prettyName = osRelease?.PRETTY_NAME || osRelease?.NAME || null;

    const host = {
      platform: process.platform,
      arch: process.arch,
      release: os.release(),
      distro: prettyName,
      node: process.version,
      npm: toolVersion("npm"),
      git: toolVersion("git"),
      engines: Object.fromEntries(ENGINES.map((e) => [e, toolVersion(e)])),
      cpus: os.cpus().length,
      totalMemGiB: Number((os.totalmem() / 1024 ** 3).toFixed(1)),
    };

    // Which matrix cell is this process actually standing in? At most one.
    const verifiedCell = HOST_MATRIX.find(
      (c) =>
        c.os === process.platform &&
        (c.arch === null || c.arch === process.arch) &&
        (process.platform !== "linux" || (prettyName ? c.distroMatch.test(prettyName) : false))
    );

    const cells = HOST_MATRIX.map((c) => {
      if (verifiedCell && c.id === verifiedCell.id) {
        return {
          id: c.id,
          label: c.label,
          requiredForRelease: c.requiredForRelease,
          status: "VERIFIED",
          evidence: `this certification run executed on ${prettyName || process.platform} ${process.arch}`,
        };
      }
      return {
        id: c.id,
        label: c.label,
        requiredForRelease: c.requiredForRelease,
        status: "UNVERIFIED",
        reason:
          c.os !== process.platform
            ? `requires a ${c.os} host; this run is ${process.platform}`
            : c.arch && c.arch !== process.arch
              ? `requires ${c.arch}; this run is ${process.arch}`
              : `requires a ${c.label} host; this run is ${prettyName || process.platform}`,
        closes: `run the certification harness on a ${c.label} host, or declare the cell unsupported in the published matrix (DOC-080)`,
      };
    });

    // Prerequisite check on the cell we ARE in. A verified cell whose
    // prerequisites are unmet is a failure, not an unverified cell.
    const prereqFindings = [];
    for (const p of PREREQUISITES) {
      const version = p.tool === "node" ? process.version : toolVersion(p.tool);
      if (!version) {
        prereqFindings.push({ tool: p.tool, severity: "blocking", note: `absent; required for ${p.why}` });
        continue;
      }
      const major = majorOf(version);
      if (major !== null && major < p.minMajor) {
        prereqFindings.push({ tool: p.tool, severity: "blocking", note: `version ${version} below required major ${p.minMajor} (${p.why})` });
      }
    }
    const anyEngine = ENGINES.some((e) => host.engines[e]);
    if (!anyEngine) {
      prereqFindings.push({
        tool: "container-engine",
        severity: "advisory",
        note: "neither podman nor docker present; the container workflow cannot run on this host",
      });
    }

    // The TARGET matrix is explicitly out of scope here, but naming it keeps
    // a reader from assuming this axis covered it.
    const targetScopeNote = {
      inScope: "development hosts that RUN OpenShift Airgap Architect",
      outOfScope:
        "target OpenShift cluster architectures that Architect GENERATES FOR (x86_64, aarch64, ppc64le, s390x). " +
        "These are a different matrix, certified by the catalog/arch-support guards and the generation suites, not here.",
      why: "conflating the two would misstate the support boundary; an aarch64 laptop legitimately targets an x86_64 cluster",
    };

    const unverifiedRequired = cells.filter((c) => c.requiredForRelease && c.status === "UNVERIFIED");
    const verifiedCount = cells.filter((c) => c.status === "VERIFIED").length;

    const artifacts = [
      store.writeArtifact(ID, "compatibility-matrix.json", {
        host,
        cells,
        prerequisites: { checked: PREREQUISITES, findings: prereqFindings },
        targetScopeNote,
        owner: "DOC-080 / PROD-046",
      }),
    ];

    const evidence = {
      host: { platform: host.platform, arch: host.arch, distro: host.distro, node: host.node },
      verifiedCells: cells.filter((c) => c.status === "VERIFIED").map((c) => c.id),
      unverifiedRequiredCells: unverifiedRequired.map((c) => c.id),
      prerequisiteFindings: prereqFindings,
      targetScopeNote,
    };

    const blockingPrereq = prereqFindings.filter((f) => f.severity === "blocking");
    if (blockingPrereq.length) {
      return fail(ID, `host prerequisites unmet: ${blockingPrereq.map((f) => `${f.tool} (${f.note})`).join("; ")}`, {
        evidence,
        artifacts,
      });
    }

    if (!verifiedCell) {
      return incomplete(ID, `this host (${prettyName || process.platform} ${process.arch}) matches no declared matrix cell`, {
        evidence,
        artifacts,
      });
    }

    if (unverifiedRequired.length) {
      return incomplete(
        ID,
        `${verifiedCount}/${cells.length} matrix cells verified by an actual run (${verifiedCell.label}); ` +
          `${unverifiedRequired.length} release-required cell(s) never exercised: ` +
          `${unverifiedRequired.map((c) => c.label).join(", ")} (DOC-080)`,
        { evidence, artifacts }
      );
    }

    return pass(ID, `all ${cells.length} declared matrix cells verified by an actual run`, { evidence, artifacts });
  },
};
