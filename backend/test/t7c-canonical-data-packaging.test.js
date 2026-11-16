/**
 * Tranche 7C — the canonical-data packaging defect behind the YAML Preview
 * architecture-support failure.
 *
 * THE REPORTED FAILURE. With OpenShift 4.21 / Bare Metal / Agent-Based
 * Installer / x86_64 — a configuration the wizard itself offered and accepted —
 * the YAML Preview was replaced by:
 *
 *   Target cluster architecture "x86_64" is not supported for bare-metal-agent
 *   on OpenShift 4.21. No architecture-support matrix is available for
 *   OpenShift 4.21.
 *
 * MECHANISM. Not a missing or wrong matrix: `data/arch-support/4.21.json`
 * exists and offers x86_64 for bare-metal-agent. The backend could not SEE it.
 * `archSupportData.js` resolved `path.resolve(__dirname, "../../data")`, which
 * is correct in the repository (`backend/src/../../data`) and wrong in the
 * container, where `backend/src` is flattened to `/app/src` — so `../../data`
 * became `/data`. And `/data` is not empty-and-harmless: `docker-compose.yml`
 * mounts the `backend-data` named volume there and sets `DATA_DIR=/data`. The
 * backend was reading the WRITABLE RUNTIME VOLUME instead of its shipped data.
 *
 * So `loadArchSupportDataset()` returned `{}`, every minor resolved
 * `unknown-minor`, and the generator's architecture guard — which correctly
 * refuses rather than guessing — rejected a supported configuration.
 *
 * NOT 4.21-SPECIFIC. In a container this failed identically for 4.20 and 4.22.
 * The minor in the message is just the one the user had selected.
 *
 * WHY IT SURVIVED CI. Every test and every dev run uses the repository layout,
 * where `../../data` happens to be right. Nothing asserted that the path the
 * CONTAINER uses resolves to the shipped data, and every loader fails closed,
 * so a total absence of data produced no startup error at all.
 *
 * WHY THESE TESTS FAIL IF IT RETURNS. The first group pins the end-to-end
 * generation outcome for the exact reported configuration. The second proves
 * every supported minor has a loadable authority. The third reproduces the
 * container condition deliberately and requires it to be caught at startup
 * rather than inside a generated artifact.
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import yaml from "js-yaml";

import { SUPPORTED_MINORS } from "../src/versionPolicy.js";
import { bareMetalAgent } from "./fixtures/base-states.js";
import { __resetArchSupportCacheForTests, loadArchSupportDataset } from "../src/archSupportData.js";
import { canonicalDataRoot, CANONICAL_DATA_ROOT_REPO_DEFAULT } from "../src/canonicalDataRoot.js";
import { checkCanonicalDataAvailable, assertCanonicalDataAvailable } from "../src/canonicalDataIntegrity.js";
import { buildInstallConfig, buildAgentConfig } from "../src/generate.js";

const PATCH = { "4.20": "4.20.40", "4.21": "4.21.35", "4.22": "4.22.16" };

/** The exact state from the screenshot, parameterised by minor/architecture. */
const reportedState = (minor, architecture = "x86_64") =>
  bareMetalAgent({
    version: {
      selectedMinor: minor,
      selectedPatch: PATCH[minor],
      selectedChannel: `stable-${minor}`,
      locked: true,
    },
    release: { channel: minor, patchVersion: PATCH[minor], confirmed: true },
    blueprint: {
      platform: "Bare Metal",
      arch: architecture,
      clusterName: "airgap-cluster",
      baseDomain: "example.com",
      confirmed: true,
    },
    methodology: { method: "Agent-Based Installer" },
  });

/** Point the loaders at a directory, as the container layout change does. */
function withCanonicalRoot(dir, fn) {
  const previous = process.env.OAA_CANONICAL_DATA_DIR;
  process.env.OAA_CANONICAL_DATA_DIR = dir;
  __resetArchSupportCacheForTests();
  try {
    return fn();
  } finally {
    if (previous === undefined) delete process.env.OAA_CANONICAL_DATA_DIR;
    else process.env.OAA_CANONICAL_DATA_DIR = previous;
    __resetArchSupportCacheForTests();
  }
}

/* ------------------------------------------------------------------ */
/* R2A — the exact human failure, across the generation boundary        */
/* ------------------------------------------------------------------ */

describe("T7C R2A — 4.21 Bare Metal Agent x86_64 generates instead of erroring", () => {
  beforeEach(() => __resetArchSupportCacheForTests());
  afterEach(() => __resetArchSupportCacheForTests());

  it("install-config generation succeeds and carries the selected architecture", () => {
    const out = buildInstallConfig(reportedState("4.21"));
    const doc = yaml.load(out);
    assert.equal(doc.controlPlane.architecture, "amd64");
    assert.equal(doc.metadata.name, "airgap-cluster");
  });

  it("agent-config generation succeeds", () => {
    const out = buildAgentConfig(reportedState("4.21"));
    assert.ok(yaml.load(out).hosts.length > 0, "no hosts generated");
  });

  it("generation emits no architecture-support error text", () => {
    // The literal strings the user saw in place of their YAML.
    const out = buildInstallConfig(reportedState("4.21"));
    assert.equal(/No architecture-support matrix is available/.test(out), false);
    assert.equal(/is not supported for/.test(out), false);
  });

  it("the same configuration generates at every supported minor", () => {
    // The container defect was never 4.21-specific; pinning only 4.21 would
    // let a per-minor recurrence through.
    for (const minor of SUPPORTED_MINORS) {
      assert.doesNotThrow(
        () => buildInstallConfig(reportedState(minor)),
        `${minor} / bare-metal-agent / x86_64 failed to generate`
      );
    }
  });

  it("aarch64 on bare metal is also accepted — the matrix offers it", () => {
    // Guards against "fixing" the preview by narrowing support to x86_64.
    assert.doesNotThrow(() => buildInstallConfig(reportedState("4.21", "aarch64")));
  });

  it("the guard still REJECTS a genuinely unsupported architecture", () => {
    // The fix restores visibility of the matrix; it must not disable the gate.
    // ppc64le is hidden for bare-metal-agent at every supported minor.
    assert.throws(
      () => buildInstallConfig(reportedState("4.21", "ppc64le")),
      (err) => err.code === "UNSUPPORTED_ARCHITECTURE"
    );
  });
});

/* ------------------------------------------------------------------ */
/* Matrix availability for every supported minor                        */
/* ------------------------------------------------------------------ */

describe("T7C — every supported minor has a loadable architecture authority", () => {
  beforeEach(() => __resetArchSupportCacheForTests());
  afterEach(() => __resetArchSupportCacheForTests());

  it("the canonical root resolves to the repository data directory by default", () => {
    delete process.env.OAA_CANONICAL_DATA_DIR;
    assert.equal(canonicalDataRoot(), CANONICAL_DATA_ROOT_REPO_DEFAULT);
    assert.ok(fs.existsSync(path.join(canonicalDataRoot(), "arch-support")));
  });

  it("the canonical root is never the writable runtime volume", () => {
    // DATA_DIR (/data) holds the database, downloaded tools and oc-mirror
    // archives. Reading shipped data from it is precisely the defect.
    const runtimeDir = process.env.DATA_DIR || "/data";
    assert.notEqual(canonicalDataRoot(), path.resolve(runtimeDir));
  });

  it("each supported minor loads a non-empty matrix", () => {
    const dataset = loadArchSupportDataset();
    for (const minor of SUPPORTED_MINORS) {
      assert.ok(dataset[minor], `no matrix loaded for supported minor ${minor}`);
      assert.ok(dataset[minor].matrix.length > 0, `matrix for ${minor} is empty`);
    }
  });

  it("each supported minor offers x86_64 for bare-metal-agent", () => {
    // The specific cell the user's configuration needed.
    const dataset = loadArchSupportDataset();
    for (const minor of SUPPORTED_MINORS) {
      const row = dataset[minor].matrix.find((r) => r.scenarioId === "bare-metal-agent");
      assert.ok(row, `${minor} has no bare-metal-agent row`);
      assert.equal(row.architectures.x86_64.offered, true, `${minor} does not offer x86_64`);
    }
  });

  it("the startup integrity check passes on a correctly laid-out tree", () => {
    const result = checkCanonicalDataAvailable();
    assert.deepEqual(result.problems, []);
    assert.equal(result.ok, true);
  });

  it("an unsupported minor is still absent from the dataset", () => {
    // 4.23 must fail closed, not inherit a supported minor's answer.
    assert.equal(Object.prototype.hasOwnProperty.call(loadArchSupportDataset(), "4.23"), false);
  });
});

/* ------------------------------------------------------------------ */
/* The container condition, reproduced deliberately                     */
/* ------------------------------------------------------------------ */

describe("T7C — a mispackaged data root is caught at startup, not in a preview", () => {
  let emptyRoot;

  beforeEach(() => {
    // Stands in for the container's /data: a real, EMPTY, writable runtime
    // volume — which is what made the original failure so quiet.
    emptyRoot = fs.mkdtempSync(path.join(os.tmpdir(), "oaa-runtime-volume-"));
    __resetArchSupportCacheForTests();
  });

  afterEach(() => {
    fs.rmSync(emptyRoot, { recursive: true, force: true });
    __resetArchSupportCacheForTests();
  });

  it("reproduces the exact reported error when the data root is wrong", () => {
    withCanonicalRoot(emptyRoot, () => {
      assert.throws(
        () => buildInstallConfig(reportedState("4.21")),
        (err) => {
          assert.equal(err.code, "UNSUPPORTED_ARCHITECTURE");
          assert.match(
            err.message,
            /Target cluster architecture "x86_64" is not supported for bare-metal-agent on OpenShift 4\.21\./
          );
          assert.match(err.message, /No architecture-support matrix is available for OpenShift 4\.21\./);
          return true;
        }
      );
    });
  });

  it("that condition fails identically for every supported minor", () => {
    // Evidence the defect was packaging, not a 4.21 data problem.
    withCanonicalRoot(emptyRoot, () => {
      for (const minor of SUPPORTED_MINORS) {
        assert.throws(
          () => buildInstallConfig(reportedState(minor)),
          (err) => err.code === "UNSUPPORTED_ARCHITECTURE",
          `${minor} unexpectedly generated with no matrix present`
        );
      }
    });
  });

  it("the startup check rejects it, with the failing root named", () => {
    withCanonicalRoot(emptyRoot, () => {
      const result = checkCanonicalDataAvailable();
      assert.equal(result.ok, false);
      assert.equal(result.root, emptyRoot);
      for (const minor of SUPPORTED_MINORS) {
        assert.ok(
          result.problems.some((p) => p.includes(minor)),
          `startup check did not report a problem for ${minor}`
        );
      }
    });
  });

  it("assertCanonicalDataAvailable throws a packaging-specific error", () => {
    withCanonicalRoot(emptyRoot, () => {
      assert.throws(assertCanonicalDataAvailable, (err) => {
        assert.equal(err.code, "CANONICAL_DATA_UNAVAILABLE");
        // The message must tell an operator what to set and what not to set it to.
        assert.match(err.message, /OAA_CANONICAL_DATA_DIR/);
        assert.match(err.message, /DATA_DIR/);
        return true;
      });
    });
  });

  it("pointing the canonical root AT the runtime volume is caught by name", () => {
    // The original defect, stated exactly: shipped read-only data resolved to
    // the writable volume. Checked explicitly rather than inferred from the
    // data being absent, because the absence is what made it silent.
    const prevData = process.env.DATA_DIR;
    process.env.DATA_DIR = emptyRoot;
    try {
      withCanonicalRoot(emptyRoot, () => {
        const result = checkCanonicalDataAvailable();
        assert.equal(result.ok, false);
        assert.match(result.problems[0], /is the writable runtime volume DATA_DIR/);
      });
    } finally {
      if (prevData === undefined) delete process.env.DATA_DIR;
      else process.env.DATA_DIR = prevData;
    }
  });

  it("a canonical root nested INSIDE the runtime volume is caught", () => {
    // A volume mount would shadow it even if the files exist in the image.
    const prevData = process.env.DATA_DIR;
    process.env.DATA_DIR = emptyRoot;
    try {
      withCanonicalRoot(path.join(emptyRoot, "shipped"), () => {
        const result = checkCanonicalDataAvailable();
        assert.equal(result.ok, false);
        assert.match(result.problems[0], /inside the writable runtime volume/);
      });
    } finally {
      if (prevData === undefined) delete process.env.DATA_DIR;
      else process.env.DATA_DIR = prevData;
    }
  });

  it("a root that does not exist at all is also caught", () => {
    withCanonicalRoot(path.join(emptyRoot, "does-not-exist"), () => {
      const result = checkCanonicalDataAvailable();
      assert.equal(result.ok, false);
      assert.match(result.problems[0], /canonical data root does not exist/);
    });
  });
});

/* ------------------------------------------------------------------ */
/* The container layout itself                                          */
/* ------------------------------------------------------------------ */

describe("T7C — the container declares where it put the canonical data", () => {
  const containerfile = fs.readFileSync(
    new URL("../Containerfile", import.meta.url),
    "utf8"
  );
  /** Directive lines only: comments explain the defect and would match. */
  const directives = containerfile
    .split("\n")
    .filter((l) => !l.trim().startsWith("#"))
    .join("\n");

  it("copies the shipped data into the image", () => {
    assert.match(directives, /^COPY data \.\/data$/m);
  });

  it("sets OAA_CANONICAL_DATA_DIR to where that COPY actually lands", () => {
    // WORKDIR is /app, so `COPY data ./data` is /app/data. Without this ENV the
    // backend resolves ../../data from /app/src and reads /data instead.
    assert.match(directives, /^ENV OAA_CANONICAL_DATA_DIR=\/app\/data$/m);
  });

  it("does not point the canonical root at the runtime volume", () => {
    assert.equal(/ENV OAA_CANONICAL_DATA_DIR=\/data\s*$/m.test(directives), false);
  });
});
