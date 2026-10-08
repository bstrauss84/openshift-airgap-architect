/**
 * Tranche 4 — D3 architecture matrix verified against REAL GENERATED OUTPUT.
 *
 * Tranche 3 made `data/arch-support/<minor>.json` the runtime authority and
 * proved it at the resolver level. This file closes the remaining DOC-156
 * residual: for every cell the matrix calls `supported`, does the generator
 * actually put the right architecture in the YAML — and for every cell it
 * closes, does anything leak?
 *
 * SCOPE LIMIT, STATED UP FRONT. The matrix is exercised for 4.20 and 4.21 only.
 * `buildInstallConfig()` and `buildImageSetConfig()` assert a supported minor
 * before doing anything, so real 4.22 output cannot be produced while 4.22 is
 * unsupported. That gate is correct and Tranche 4 does not weaken it; the
 * resulting coverage gap is recorded in
 * `docs/minor-release/4.22/TRANCHE_4_PRE_FLIP_VERIFICATION.md` rather than
 * papered over here.
 *
 * What makes the 4.20/4.21 result meaningful for 4.22 anyway is narrow and is
 * asserted below rather than assumed: the architecture emission path takes the
 * minor as no input at all.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";

import { buildInstallConfig, buildImageSetConfig } from "../src/generate.js";
import { SUPPORTED_MINORS } from "../src/versionPolicy.js";
import {
  resolveArchitectureSupport,
  ARCHITECTURES,
} from "../../shared/archSupport.js";
import {
  minimal, bareMetalAgent, bareMetalIpi, vsphereIpi, vsphereAgent,
  awsGovcloudIpi, azureGovernmentIpi, nutanixIpi,
} from "./fixtures/base-states.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = join(__dirname, "..", "..");

const archSupport = Object.fromEntries(
  ["4.20", "4.21", "4.22"].map((m) => [
    m,
    JSON.parse(readFileSync(join(REPO, "data", "arch-support", `${m}.json`), "utf8")),
  ])
);

/** Blueprint spelling -> install-config / imageset spelling. */
const EMITTED = { x86_64: "amd64", aarch64: "arm64", ppc64le: "ppc64le", s390x: "s390x" };

/**
 * A realistic state per D3 scenario. Where a shared fixture exists it is used;
 * the remaining scenarios are composed from `minimal` with the platform and
 * method the scenario id denotes, so the generator takes its real branch.
 */
const SCENARIO_STATE = {
  "bare-metal-ipi": (o) => bareMetalIpi(o),
  "bare-metal-agent": (o) => bareMetalAgent(o),
  "bare-metal-upi": (o) => minimal({ ...o, blueprint: { platform: "Bare Metal", ...o.blueprint }, methodology: { method: "UPI" } }),
  "vsphere-ipi": (o) => vsphereIpi(o),
  "vsphere-agent": (o) => vsphereAgent(o),
  "vsphere-upi": (o) => minimal({ ...o, blueprint: { platform: "VMware vSphere", ...o.blueprint }, methodology: { method: "UPI" } }),
  "nutanix-ipi": (o) => nutanixIpi(o),
  "aws-govcloud-ipi": (o) => awsGovcloudIpi(o),
  "aws-govcloud-upi": (o) => minimal({ ...o, blueprint: { platform: "AWS GovCloud", ...o.blueprint }, methodology: { method: "UPI" } }),
  "azure-government-ipi": (o) => azureGovernmentIpi(o),
  "azure-government-upi": (o) => minimal({ ...o, blueprint: { platform: "Azure Government", ...o.blueprint }, methodology: { method: "UPI" } }),
  "ibm-cloud-ipi": (o) => minimal({ ...o, blueprint: { platform: "IBM Cloud", ...o.blueprint }, methodology: { method: "IPI" } }),
};

function stateFor(scenarioId, minor, arch) {
  return SCENARIO_STATE[scenarioId]({
    version: { selectedMinor: minor, selectedPatch: `${minor}.8`, locked: true },
    release: { channel: minor, patchVersion: `${minor}.8`, confirmed: true },
    blueprint: { arch },
  });
}

/** Every (minor, scenario, architecture) triple for the generatable minors. */
const CELLS = [];
for (const minor of SUPPORTED_MINORS) {
  for (const row of archSupport[minor].matrix) {
    for (const arch of ARCHITECTURES) {
      CELLS.push([minor, row.scenarioId, arch, row.architectures[arch].disposition]);
    }
  }
}
const SUPPORTED_CELLS = CELLS.filter(([, , , d]) => d === "supported");
const HIDDEN_CELLS = CELLS.filter(([, , , d]) => d === "hidden");
const LOCKED_CELLS = CELLS.filter(([, , , d]) => d === "locked");

describe("T4 — matrix shape", () => {
  it("evaluates every cell of every generatable minor", () => {
    assert.equal(CELLS.length, SUPPORTED_MINORS.length * 12 * 4);
    // 96 before the 4.22 flip; 4.22 added its 48 cells with no change here,
    // because the minor list is derived from SUPPORTED_MINORS.
    assert.equal(CELLS.length, 144);
  });

  it("partitions into supported / hidden / locked with nothing unresolved", () => {
    assert.equal(SUPPORTED_CELLS.length + HIDDEN_CELLS.length + LOCKED_CELLS.length, CELLS.length);
    assert.equal(CELLS.filter(([, , , d]) => d === "unknown").length, 0);
  });

  it("records the counts this tranche reports", () => {
    // 15 supported / 33 hidden per minor, identical at 4.20, 4.21 and 4.22.
    // Tranche 4 §2 predicted this from `{x86_64: 12, aarch64: 3}`; the "12
    // supported / 36 hidden" figure in its G1 closure-condition paragraph was
    // an arithmetic slip that omitted the 3 aarch64 cells.
    assert.equal(SUPPORTED_CELLS.length, 45);
    assert.equal(HIDDEN_CELLS.length, 99);
    assert.equal(LOCKED_CELLS.length, 0, "the matrix declares no locked cell; see the evidence document");
  });

  it("every supported minor contributes the same shape — 4.22 is not special-cased", () => {
    for (const minor of SUPPORTED_MINORS) {
      assert.equal(SUPPORTED_CELLS.filter(([m]) => m === minor).length, 15, minor);
      assert.equal(HIDDEN_CELLS.filter(([m]) => m === minor).length, 33, minor);
    }
  });
});

describe("T4 — every SUPPORTED cell emits the right architecture in real YAML", () => {
  for (const [minor, scenarioId, arch] of SUPPORTED_CELLS) {
    it(`${minor} ${scenarioId} ${arch} -> install-config architecture ${EMITTED[arch]}`, () => {
      const out = buildInstallConfig(stateFor(scenarioId, minor, arch));
      const ic = yaml.load(out);
      assert.equal(ic.controlPlane.architecture, EMITTED[arch]);
      assert.equal(ic.compute[0].architecture, EMITTED[arch]);
    });
  }

  for (const [minor, scenarioId, arch] of SUPPORTED_CELLS) {
    it(`${minor} ${scenarioId} ${arch} -> imageset payload architecture ${EMITTED[arch]}`, () => {
      const state = { ...stateFor(scenarioId, minor, arch), operators: { selected: [] }, imagesetConfig: {} };
      const im = yaml.load(buildImageSetConfig(state));
      assert.deepEqual(im.mirror.platform.architectures, [EMITTED[arch]]);
    });
  }

  it("install-config and imageset never disagree on the architecture", () => {
    // The defect the shared normaliser consolidated away: an aarch64
    // install-config paired with an amd64 mirror payload.
    for (const [minor, scenarioId, arch] of SUPPORTED_CELLS) {
      const base = stateFor(scenarioId, minor, arch);
      const ic = yaml.load(buildInstallConfig(base));
      const im = yaml.load(buildImageSetConfig({ ...base, operators: { selected: [] }, imagesetConfig: {} }));
      assert.equal(ic.controlPlane.architecture, im.mirror.platform.architectures[0], `${minor} ${scenarioId} ${arch}`);
    }
  });
});

describe("T4 — no cross-minor fallback in generated output", () => {
  it("each minor names its own channel, never an older one", () => {
    for (const minor of SUPPORTED_MINORS) {
      const state = { ...stateFor("bare-metal-ipi", minor, "x86_64"), operators: { selected: [] }, imagesetConfig: {} };
      const im = buildImageSetConfig(state);
      assert.match(im, new RegExp(`stable-${minor.replace(".", "\\.")}`));
      for (const other of SUPPORTED_MINORS.filter((m) => m !== minor)) {
        assert.doesNotMatch(im, new RegExp(`stable-${other.replace(".", "\\.")}`), `${minor} leaked ${other}`);
      }
    }
  });

  it("an unsupported minor produces no output at all", () => {
    for (const minor of ["4.19", "4.23", "4.24"]) {
      assert.throws(
        () => buildInstallConfig(stateFor("bare-metal-ipi", minor, "x86_64")),
        (e) => e.code === "UNSUPPORTED_VERSION" && e.requestedVersion === minor
      );
    }
  });
});

describe("T4 — the architecture emission path takes the minor as no input", () => {
  /**
   * This is what lets the 4.20/4.21 result say anything about 4.22. It is
   * asserted, not assumed: if emission ever becomes minor-dependent, the 4.22
   * coverage gap stops being benign and these tests fail.
   */
  it("the same architecture produces identical emission at every supported minor", () => {
    // Only architectures bare-metal-ipi actually offers can be generated; the
    // rest are refused by the D3 guard, which is itself minor-independent.
    const offered = ARCHITECTURES.filter((a) =>
      archSupport["4.21"].matrix.find((r) => r.scenarioId === "bare-metal-ipi").architectures[a].disposition === "supported"
    );
    assert.ok(offered.length >= 2, "expected bare-metal-ipi to offer more than one architecture");
    for (const arch of offered) {
      const emitted = SUPPORTED_MINORS.map((minor) => {
        const ic = yaml.load(buildInstallConfig(stateFor("bare-metal-ipi", minor, arch)));
        return ic.controlPlane.architecture;
      });
      assert.equal(new Set(emitted).size, 1, `${arch} emitted differently across minors: ${emitted}`);
    }
  });

  it("the normaliser's source carries no minor-conditional branch", () => {
    const src = readFileSync(join(REPO, "backend", "src", "generate.js"), "utf8");
    const start = src.indexOf("const normalizeBlueprintArch");
    assert.ok(start > -1, "normaliser not found");
    // Slice the function BODY only. A fixed character window overruns into the
    // neighbouring code, which legitimately mentions minors.
    const fn = src.slice(start, src.indexOf("\n};", start) + 3);
    assert.match(fn, /const normalizeBlueprintArch/);
    assert.ok(fn.length < 400, "slice should be the small normaliser, not a chunk of the file");
    assert.doesNotMatch(fn, /selectedMinor|isVersionGTE|4\.\d\d/);
  });
});

describe("T4 — the three architecture axes stay independent in real output", () => {
  it("target-cluster architecture does not change the installer-binary selection", () => {
    // installerPlatformArch lives in exportOptions and is never read from
    // blueprint.arch; openshiftInstaller.js never touches blueprint at all.
    const installer = readFileSync(join(REPO, "backend", "src", "openshiftInstaller.js"), "utf8");
    assert.doesNotMatch(installer, /blueprint/);
    const index = readFileSync(join(REPO, "backend", "src", "index.js"), "utf8");
    assert.match(index, /exportOptions\?\.installerPlatformArch/);
  });

  it("target-cluster architecture does not change the Architect runtime architecture", () => {
    const runtime = readFileSync(join(REPO, "backend", "src", "ocMirrorRuntime.js"), "utf8");
    assert.match(runtime, /process\.arch/);
    assert.doesNotMatch(runtime, /blueprint/);
  });

  it("changing blueprint.arch leaves exportOptions untouched", () => {
    for (const arch of ARCHITECTURES) {
      const s = stateFor("bare-metal-ipi", "4.21", arch);
      assert.equal(s.exportOptions?.installerPlatformArch, undefined);
    }
  });
});

describe("T4A — G2 CLOSED: a hidden architecture is rejected before any output", () => {
  /**
   * Tranche 4 proved the leak; Tranche 4A closed it. Generation now consults
   * the same D3 authority the UI uses, via `shared/archSupport.js` over
   * `data/arch-support/<minor>.json`. There is no second table.
   *
   * The rejection is deterministic and identifying: it names the requested
   * architecture, the minor, the platform, the install method, the scenario and
   * the disposition — and nothing else. No state is dumped.
   */

  /** Every hidden cell, parameterized — not a sample. */
  for (const [minor, scenarioId, arch] of HIDDEN_CELLS) {
    it(`${minor} ${scenarioId} ${arch} is refused by install-config generation`, () => {
      assert.throws(
        () => buildInstallConfig(stateFor(scenarioId, minor, arch)),
        (e) => e.code === "UNSUPPORTED_ARCHITECTURE"
      );
    });
  }

  it("the imageset boundary refuses it too, not just install-config", () => {
    for (const [minor, scenarioId, arch] of HIDDEN_CELLS.slice(0, 12)) {
      const state = { ...stateFor(scenarioId, minor, arch), operators: { selected: [] }, imagesetConfig: {} };
      assert.throws(() => buildImageSetConfig(state), (e) => e.code === "UNSUPPORTED_ARCHITECTURE");
    }
  });

  it("the error identifies the decision without dumping state", () => {
    try {
      buildInstallConfig(stateFor("vsphere-ipi", "4.21", "aarch64"));
      assert.fail("expected rejection");
    } catch (e) {
      assert.equal(e.code, "UNSUPPORTED_ARCHITECTURE");
      assert.equal(e.requestedArchitecture, "aarch64");
      assert.equal(e.selectedMinor, "4.21");
      assert.equal(e.platform, "VMware vSphere");
      assert.equal(e.installMethod, "IPI");
      assert.equal(e.scenarioId, "vsphere-ipi");
      assert.equal(e.disposition, "hidden");
      assert.ok(!("state" in e) && !("blueprint" in e));
      assert.doesNotMatch(e.message, /pullSecret|sshKey|password/i);
    }
  });

  it("STALE/IMPORTED STATE: a v2.0.0-era combination is refused, not repaired", () => {
    // The real threat. v2.0.0's PLATFORM_ARCH_SUPPORT offered vSphere aarch64
    // and AWS GovCloud aarch64, so saved states carry them.
    for (const [scenarioId, arch] of [["vsphere-ipi", "aarch64"], ["aws-govcloud-ipi", "aarch64"], ["bare-metal-ipi", "s390x"]]) {
      const legacy = stateFor(scenarioId, "4.21", arch);
      assert.throws(() => buildInstallConfig(legacy), (e) => e.code === "UNSUPPORTED_ARCHITECTURE");
      // and nothing is silently substituted
      try { buildInstallConfig(legacy); } catch (e) {
        assert.notEqual(e.requestedArchitecture, "amd64", "must not report a rewritten architecture");
      }
    }
  });

  it("no YAML is produced for a refused architecture", () => {
    let out = null;
    try { out = buildInstallConfig(stateFor("vsphere-ipi", "4.21", "aarch64")); } catch { /* expected */ }
    assert.equal(out, null, "generation must fail before emission, not after");
  });

  it("the alias spelling is resolved, not rejected", () => {
    // amd64/arm64 denote the same architectures as x86_64/aarch64 and have
    // always generated correctly; the guard must not refuse them.
    const ic = yaml.load(buildInstallConfig({ ...stateFor("bare-metal-ipi", "4.21", "x86_64"), blueprint: { ...stateFor("bare-metal-ipi", "4.21", "x86_64").blueprint, arch: "amd64" } }));
    assert.equal(ic.controlPlane.architecture, "amd64");
    assert.throws(
      () => buildInstallConfig({ ...stateFor("vsphere-ipi", "4.21", "x86_64"), blueprint: { ...stateFor("vsphere-ipi", "4.21", "x86_64").blueprint, arch: "arm64" } }),
      (e) => e.code === "UNSUPPORTED_ARCHITECTURE",
      "the alias of a hidden architecture is still hidden"
    );
  });

  it("an architecture the product does not model at all is refused", () => {
    assert.throws(
      () => buildInstallConfig(stateFor("bare-metal-ipi", "4.21", "riscv64")),
      (e) => e.code === "UNSUPPORTED_ARCHITECTURE"
    );
  });

  it("the generator consults the shared authority and declares no table of its own", () => {
    const src = readFileSync(join(REPO, "backend", "src", "generate.js"), "utf8");
    assert.match(src, /shared\/archSupport\.js/);
    assert.match(src, /assertTargetArchitectureSupported/);
    // No duplicated platform->architecture map IN CODE. Comments legitimately
    // name the constant this replaced, so they are stripped first.
    const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    assert.doesNotMatch(code, /"Bare Metal":\s*\[/);
    assert.doesNotMatch(code, /PLATFORM_ARCH_SUPPORT/);
  });

  it("cross-axis: refusing a target architecture leaves the binary/runtime axes untouched", () => {
    const gen = readFileSync(join(REPO, "backend", "src", "generate.js"), "utf8");
    const guard = gen.slice(gen.indexOf("const assertTargetArchitectureSupported"), gen.indexOf("const normalizeBlueprintArch"));
    assert.doesNotMatch(guard, /installerPlatformArch|process\.arch|exportOptions/);
  });
});
