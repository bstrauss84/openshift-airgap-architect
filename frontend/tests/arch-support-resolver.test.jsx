/**
 * Target-cluster architecture support — D3 runtime authority (DOC-156, Tranche 3).
 *
 * Proves that `data/arch-support/<minor>.json` is the runtime authority and that
 * the thing it replaced cannot come back:
 *
 *   1. EVERY cell of the canonical matrix is enforced, for all three minors,
 *      all twelve scenarios and all four architectures — parameterized, not
 *      spot-checked, so a silently dropped row fails here.
 *   2. The generated frontend projection agrees with canonical on every cell.
 *   3. Fail-closed on unknown minor / scenario / architecture / malformed
 *      version / future minor, with NO fallback to another minor.
 *   4. The install method is part of the key and is never discarded.
 *   5. the PUBLIC adapter answers for every SUPPORTED minor (4.22 included
 *      since the v2.1 flip) and refuses any minor outside that set.
 *   6. The target-cluster axis stays separate from the export-binary axis.
 *
 * Canonical data is read from disk so the authority under test is the tracked
 * file, not a fixture that could drift away from it.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import {
  ARCHITECTURES,
  UNRESOLVED,
  ArchitectureSupportError,
  resolveArchitectureSupport,
  listArchitectureSupport,
  listArchitectureSupportAcrossMinors,
  assertArchitectureSupported,
  offeredArchitectures,
} from "../../shared/archSupport.js";
import {
  listArchSupportForState,
  offeredArchSupportForState,
  resolveArchSupport,
  hasArchSupportForMinor,
  availableArchSupportMinors,
  __archSupportDatasetForTests,
} from "../src/archSupportResolver.js";
import { SUPPORTED_MINORS } from "../src/shared/versionPolicy.js";
import { getScenarioId } from "../src/hostInventoryV2Helpers.js";

const REPO = join(__dirname, "..", "..");
const CANONICAL_DIR = join(REPO, "data", "arch-support");
const PROJECTION_DIR = join(REPO, "frontend", "src", "data", "arch-support");

const MINORS = readdirSync(CANONICAL_DIR)
  .filter((f) => f.endsWith(".json"))
  .map((f) => f.replace(".json", ""))
  .sort();

const canonical = Object.fromEntries(
  MINORS.map((m) => [m, JSON.parse(readFileSync(join(CANONICAL_DIR, `${m}.json`), "utf8"))])
);
const projection = Object.fromEntries(
  MINORS.map((m) => [m, JSON.parse(readFileSync(join(PROJECTION_DIR, `${m}.json`), "utf8"))])
);

/** Flat list of every canonical cell: [minor, scenarioId, platform, method, arch, cell]. */
const ALL_CELLS = [];
for (const minor of MINORS) {
  for (const row of canonical[minor].matrix) {
    for (const arch of ARCHITECTURES) {
      ALL_CELLS.push([minor, row.scenarioId, row.platform, row.installMethod, arch, row.architectures[arch]]);
    }
  }
}

const stateFor = (minor) =>
  minor
    ? { _schemaVersion: 3, version: { selectedMinor: minor, selectedPatch: `${minor}.1` } }
    : { _schemaVersion: 3, version: {} };

describe("D3 architecture matrix — every cell is enforced", () => {
  it("the matrix covers 3 minors x 12 scenarios x 4 architectures", () => {
    expect(MINORS).toEqual(["4.20", "4.21", "4.22"]);
    for (const minor of MINORS) expect(canonical[minor].matrix).toHaveLength(12);
    expect(ALL_CELLS).toHaveLength(144);
  });

  it.each(ALL_CELLS)(
    "%s %s (%s/%s) %s resolves to its canonical disposition",
    (minor, scenarioId, _platform, _method, architecture, cell) => {
      const got = resolveArchitectureSupport({ dataset: canonical, minor, scenarioId, architecture });
      expect(got.disposition).toBe(cell.disposition);
      expect(got.offered).toBe(cell.disposition === "supported");
      expect(got.unresolved).toBeUndefined();
      expect(got.summary).toBe(cell.summary);
      expect(got.reason).toBe(cell.reason);
      expect(got.provenance.length).toBeGreaterThan(0);
    }
  );

  it.each(ALL_CELLS)(
    "%s %s (%s/%s) %s is identical in the generated projection",
    (minor, scenarioId, _platform, _method, architecture, cell) => {
      const row = projection[minor].matrix.find((r) => r.scenarioId === scenarioId);
      expect(row).toBeTruthy();
      expect(row.installMethod).toBe(_method);
      expect(row.architectures[architecture]).toEqual({
        disposition: cell.disposition,
        offered: cell.offered,
        summary: cell.summary,
      });
    }
  );

  it("no cell is left unresolved", () => {
    const unresolved = ALL_CELLS.filter(([, , , , , c]) => c.disposition === "unknown");
    expect(unresolved).toEqual([]);
  });

  it("only `supported` cells are ever offered", () => {
    for (const [minor, scenarioId, , , architecture, cell] of ALL_CELLS) {
      if (cell.disposition === "supported") continue;
      const got = resolveArchitectureSupport({ dataset: canonical, minor, scenarioId, architecture });
      expect(got.offered, `${minor} ${scenarioId} ${architecture}`).toBe(false);
    }
  });

  it("every closed cell carries a usable one-sentence summary", () => {
    for (const [, , , , , cell] of ALL_CELLS) {
      expect(typeof cell.summary).toBe("string");
      expect(cell.summary.length).toBeGreaterThan(40);
      expect(cell.summary.length).toBeLessThanOrEqual(200);
    }
  });
});

describe("install method is part of the key and is never discarded", () => {
  it("every scenario id round-trips through getScenarioId(platform, method)", () => {
    const METHOD_LABEL = { ipi: "IPI", upi: "UPI", agent: "Agent-Based Installer" };
    const PLATFORM_LABEL = {
      "bare-metal": "Bare Metal",
      vsphere: "VMware vSphere",
      nutanix: "Nutanix",
      "aws-govcloud": "AWS GovCloud",
      "azure-government": "Azure Government",
      "ibm-cloud": "IBM Cloud",
    };
    for (const row of canonical["4.22"].matrix) {
      expect(getScenarioId(PLATFORM_LABEL[row.platform], METHOD_LABEL[row.installMethod])).toBe(row.scenarioId);
    }
  });

  it("bare metal resolves differently per install method, which a platform-only table could not express", () => {
    const ipi = resolveArchitectureSupport({
      dataset: canonical, minor: "4.22", scenarioId: "bare-metal-ipi", architecture: "s390x",
    });
    const agent = resolveArchitectureSupport({
      dataset: canonical, minor: "4.22", scenarioId: "bare-metal-agent", architecture: "s390x",
    });
    // Both closed, but for different documented reasons — the distinction the
    // platform-keyed constant erased.
    expect(ipi.offered).toBe(false);
    expect(agent.offered).toBe(false);
    expect(agent.summary).not.toBe(ipi.summary);
    expect(agent.summary).toMatch(/IBM Z/);
  });

  it("the three bare-metal install methods each have their own row", () => {
    const rows = canonical["4.22"].matrix.filter((r) => r.platform === "bare-metal");
    expect(rows.map((r) => r.installMethod).sort()).toEqual(["agent", "ipi", "upi"]);
  });
});

describe("fail closed — no fallback to another minor", () => {
  it("an unknown minor does not borrow a known minor's answer", () => {
    const got = resolveArchitectureSupport({
      dataset: canonical, minor: "4.19", scenarioId: "bare-metal-ipi", architecture: "x86_64",
    });
    expect(got.offered).toBe(false);
    expect(got.unresolved).toBe(true);
    expect(got.unresolvedCause).toBe(UNRESOLVED.UNKNOWN_MINOR);
  });

  it("a FUTURE minor is not inferred from the newest known minor", () => {
    const got = resolveArchitectureSupport({
      dataset: canonical, minor: "4.23", scenarioId: "bare-metal-ipi", architecture: "x86_64",
    });
    expect(got.offered).toBe(false);
    expect(got.unresolvedCause).toBe(UNRESOLVED.UNKNOWN_MINOR);
  });

  it("an unmodelled scenario is closed", () => {
    const got = resolveArchitectureSupport({
      dataset: canonical, minor: "4.21", scenarioId: "nutanix-upi", architecture: "x86_64",
    });
    expect(got.offered).toBe(false);
    expect(got.unresolvedCause).toBe(UNRESOLVED.UNKNOWN_SCENARIO);
  });

  it("a missing install method yields no scenario and therefore no support", () => {
    expect(getScenarioId("Nutanix", "UPI")).toBeNull();
    const got = resolveArchitectureSupport({
      dataset: canonical, minor: "4.21", scenarioId: null, architecture: "x86_64",
    });
    expect(got.offered).toBe(false);
  });

  it("an unrecognised architecture is closed", () => {
    for (const bad of ["riscv64", "ARM64", "", null, undefined]) {
      const got = resolveArchitectureSupport({
        dataset: canonical, minor: "4.21", scenarioId: "bare-metal-ipi", architecture: bad,
      });
      expect(got.offered).toBe(false);
      expect(got.unresolvedCause).toBe(UNRESOLVED.UNKNOWN_ARCHITECTURE);
    }
  });

  it("a malformed version is closed rather than coerced", () => {
    for (const bad of ["", "   ", "four.twenty", "4", null, undefined, 421]) {
      const got = resolveArchitectureSupport({
        dataset: canonical, minor: bad, scenarioId: "bare-metal-ipi", architecture: "x86_64",
      });
      expect(got.offered).toBe(false);
      expect(got.unresolvedCause).toBe(UNRESOLVED.MALFORMED_VERSION);
    }
  });

  it("an empty dataset offers nothing", () => {
    expect(offeredArchitectures({ dataset: {}, minor: "4.21", scenarioId: "bare-metal-ipi" })).toEqual([]);
  });

  it("a patch version resolves to its minor", () => {
    const got = resolveArchitectureSupport({
      dataset: canonical, minor: "4.21.35", scenarioId: "bare-metal-ipi", architecture: "aarch64",
    });
    expect(got.minor).toBe("4.21");
    expect(got.offered).toBe(true);
  });

  it("assertArchitectureSupported throws for a closed cell and returns for an open one", () => {
    expect(() =>
      assertArchitectureSupported({ dataset: canonical, minor: "4.21", scenarioId: "vsphere-ipi", architecture: "s390x" })
    ).toThrow(ArchitectureSupportError);
    expect(
      assertArchitectureSupported({ dataset: canonical, minor: "4.21", scenarioId: "vsphere-ipi", architecture: "x86_64" }).offered
    ).toBe(true);
  });

  it("a hand-edited `offered: true` on a non-supported cell is ignored at runtime", () => {
    const tampered = JSON.parse(JSON.stringify(canonical));
    const row = tampered["4.21"].matrix.find((r) => r.scenarioId === "vsphere-ipi");
    row.architectures.s390x.offered = true;
    const got = resolveArchitectureSupport({
      dataset: tampered, minor: "4.21", scenarioId: "vsphere-ipi", architecture: "s390x",
    });
    expect(got.offered).toBe(false);
  });
});

describe("cross-minor intersection (used before a release is chosen)", () => {
  it("offers an architecture only when EVERY named minor offers it", () => {
    const cells = listArchitectureSupportAcrossMinors({
      dataset: canonical, minors: ["4.20", "4.21"], scenarioId: "bare-metal-ipi",
    });
    const offered = cells.filter((c) => c.offered).map((c) => c.architecture);
    expect(offered).toEqual(["x86_64", "aarch64"]);
  });

  it("one dissenting minor closes the cell", () => {
    const tampered = JSON.parse(JSON.stringify(canonical));
    tampered["4.20"].matrix.find((r) => r.scenarioId === "bare-metal-ipi").architectures.aarch64.disposition = "hidden";
    const cells = listArchitectureSupportAcrossMinors({
      dataset: tampered, minors: ["4.20", "4.21"], scenarioId: "bare-metal-ipi",
    });
    expect(cells.find((c) => c.architecture === "aarch64")?.offered).toBeFalsy();
  });

  it("an empty minor list offers nothing", () => {
    const cells = listArchitectureSupportAcrossMinors({ dataset: canonical, minors: [], scenarioId: "bare-metal-ipi" });
    expect(cells.every((c) => !c.offered)).toBe(true);
  });
});

describe("frontend adapter — support gating", () => {
  it("loads exactly the SUPPORTED minors, including 4.22 now that it is supported", () => {
    expect(availableArchSupportMinors()).toEqual([...SUPPORTED_MINORS].sort());
    expect(hasArchSupportForMinor("4.22")).toBe(true);
    expect(Object.keys(__archSupportDatasetForTests())).toContain("4.22");
  });

  it("refuses an unsupported minor through the public adapter", () => {
    const got = resolveArchSupport({ minor: "4.23", scenarioId: "bare-metal-ipi", architecture: "x86_64" });
    expect(got.offered).toBe(false);
    expect(got.unresolvedCause).toBe(UNRESOLVED.UNKNOWN_MINOR);
  });

  it("a state locked to an unsupported minor offers no architecture and says why", () => {
    const { cells } = listArchSupportForState(stateFor("4.23"), "bare-metal-ipi");
    expect(cells.every((c) => !c.offered)).toBe(true);
    expect(cells[0].summary).toMatch(/4\.23 is not supported/);
  });

  it("4.22 resolves real architecture support through the public adapter", () => {
    // The gate moved, it did not disappear: the same adapter that refuses 4.23
    // now answers for 4.22 from the canonical dataset, with no 4.22 special case.
    expect(offeredArchSupportForState(stateFor("4.22"), "bare-metal-ipi")).toEqual(["x86_64", "aarch64"]);
    expect(offeredArchSupportForState(stateFor("4.22"), "vsphere-ipi")).toEqual(["x86_64"]);
  });

  it("resolves per-minor once a supported release is chosen", () => {
    expect(offeredArchSupportForState(stateFor("4.21"), "bare-metal-ipi")).toEqual(["x86_64", "aarch64"]);
    expect(offeredArchSupportForState(stateFor("4.21"), "vsphere-ipi")).toEqual(["x86_64"]);
    expect(offeredArchSupportForState(stateFor("4.20"), "ibm-cloud-ipi")).toEqual(["x86_64"]);
  });

  it("falls back to no minor — not to a default minor — before a release is chosen", () => {
    const res = listArchSupportForState(stateFor(null), "bare-metal-ipi");
    expect(res.resolvedFromState).toBe(false);
    expect(res.minor).toBeNull();
    expect(res.cells.filter((c) => c.offered).map((c) => c.architecture)).toEqual(["x86_64", "aarch64"]);
  });

  it("offers nothing when the platform/method combination is not a scenario", () => {
    const res = listArchSupportForState(stateFor("4.21"), null);
    expect(res.cells.every((c) => !c.offered)).toBe(true);
  });

  it("the adapter's answers match canonical for every supported-minor cell", () => {
    for (const [minor, scenarioId, , , architecture, cell] of ALL_CELLS) {
      if (!SUPPORTED_MINORS.includes(minor)) continue;
      const got = resolveArchSupport({ minor, scenarioId, architecture });
      expect(got.disposition, `${minor} ${scenarioId} ${architecture}`).toBe(cell.disposition);
      expect(got.offered).toBe(cell.disposition === "supported");
    }
  });
});

describe("the architecture axes stay separate", () => {
  it("every canonical file keeps the three axes distinct", () => {
    for (const minor of MINORS) {
      const axes = canonical[minor].architectureAxes;
      expect(axes.targetCluster).toBeTruthy();
      expect(axes.exportBinary).toBeTruthy();
      expect(axes.runtimeHost).toBeTruthy();
      expect(axes.targetCluster.governedBy).toMatch(/This file/);
      expect(axes.exportBinary.governedBy).toMatch(/NOT governed by this file/);
      expect(axes.runtimeHost.governedBy).toMatch(/NOT governed by this file/);
    }
  });

  it("the matrix excludes aarch64 from CLUSTER-NODE FIPS without touching the export-binary axis", () => {
    for (const minor of MINORS) {
      const fips = canonical[minor].fipsValidatedArchitectures;
      expect(fips.axis).toBe("targetCluster");
      expect(fips.excludes).toContain("aarch64");
      expect(canonical[minor].architectureAxes.exportBinary.standingRule).toMatch(
        /openshift-install-rhel9-arm64\.tar\.gz/
      );
    }
  });

  it("aarch64 remains an OFFERED target-cluster architecture on bare metal despite the FIPS note", () => {
    // Cluster-node FIPS validation and architecture support are different
    // questions; conflating them is what produced the withdrawn O6 finding.
    expect(offeredArchSupportForState(stateFor("4.21"), "bare-metal-ipi")).toContain("aarch64");
  });

  it("no mixed-architecture cluster is implied", () => {
    for (const minor of MINORS) {
      expect(canonical[minor].homogeneousOnly.value).toBe(true);
      expect(canonical[minor].homogeneousOnly.mixedArchitectureSupported).toBe(false);
      expect(projection[minor].homogeneousOnly.mixedArchitectureSupported).toBe(false);
    }
  });
});

describe("the replaced platform-only table is gone", () => {
  it("BlueprintStep no longer declares its own architecture support table", () => {
    const src = readFileSync(join(REPO, "frontend", "src", "steps", "BlueprintStep.jsx"), "utf8");
    // Only the explanatory comment may mention the old name.
    const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(code).not.toMatch(/PLATFORM_ARCH_SUPPORT/);
    expect(code).toMatch(/listArchSupportForState/);
  });

  it("no module outside the matrix declares a platform-to-architecture map", () => {
    const suspects = [
      join(REPO, "frontend", "src", "steps", "BlueprintStep.jsx"),
      join(REPO, "frontend", "src", "steps", "MethodologyStep.jsx"),
    ];
    for (const f of suspects) {
      const code = readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
      expect(code).not.toMatch(/\[\s*"x86_64"\s*,\s*"aarch64"/);
    }
  });
});
