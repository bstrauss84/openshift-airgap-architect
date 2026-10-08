/**
 * ImageSetConfiguration schema conformance (FQ-9 / DOC-166 slice 1).
 *
 * The generated `imageset-config.yaml` used to be validated against the *install*
 * scenario catalog, where zero parameters applied, so validation was vacuously true
 * (lesson L18). That is how FQ-9 shipped: whenever a user set an operator
 * minVersion/maxVersion, Architect emitted `includeConfig`, which oc-mirror v2
 * rejects outright with `json: unknown field "includeConfig"`.
 *
 * These tests replace vacuous validation with real conformance against
 * `data/oc-mirror-v2/imageset-config-schema.json`, which is derived from the pinned
 * oc-mirror v2 API source and verified against the exact released binary.
 *
 * Hermetic: no network, no oc-mirror binary. The binary verdicts are captured in the
 * schema fixture's provenance block; the reproduction command is in
 * docs/minor-release/4.22/FQ9_IMAGESET_CONFIG_REMEDIATION.md.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";
import { buildImageSetConfig } from "../src/generate.js";
import { SUPPORTED_MINORS } from "../src/versionPolicy.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, "..", "..");

const SCHEMA = JSON.parse(
  fs.readFileSync(path.join(REPO, "data", "oc-mirror-v2", "imageset-config-schema.json"), "utf8")
);
const ALLOWED = new Set(SCHEMA.paths);

/** Flatten a parsed ImageSetConfiguration into catalog-style dotted paths. */
function emittedPaths(obj, prefix = "") {
  const out = [];
  for (const [key, value] of Object.entries(obj)) {
    if (value === undefined) continue;
    const here = prefix ? `${prefix}.${key}` : key;
    if (Array.isArray(value)) {
      out.push(here);
      for (const item of value) {
        if (item && typeof item === "object" && !Array.isArray(item)) {
          out.push(...emittedPaths(item, `${here}[]`));
        }
      }
    } else if (value && typeof value === "object") {
      out.push(here);
      out.push(...emittedPaths(value, here));
    } else {
      out.push(here);
    }
  }
  return out;
}

const operator = (extra = {}) => ({
  name: "odf-operator",
  catalogImage: "registry.redhat.io/redhat/redhat-operator-index:v4.21",
  defaultChannel: "stable-4.21",
  ...extra,
});

const stateWith = (over = {}) => ({
  release: { patchVersion: "4.21.35", channel: "4.21" },
  version: { selectedMinor: "4.21", selectedPatch: "4.21.35", selectedChannel: "stable-4.21", locked: true },
  blueprint: { arch: "x86_64" },
  operators: { selected: [] },
  imagesetConfig: {},
  ...over,
});

const load = (state) => yaml.load(buildImageSetConfig(state));

// Every shape the generator can produce, so the conformance sweep is not sampling.
const ALL_SHAPES = {
  minimal: stateWith(),
  graphOff: stateWith({ imagesetConfig: { graph: false } }),
  archiveSize: stateWith({ imagesetConfig: { archiveSize: "4" } }),
  kubeVirtContainer: stateWith({ imagesetConfig: { kubeVirtContainer: true } }),
  additionalImages: stateWith({ imagesetConfig: { additionalImages: "registry.redhat.io/ubi9/ubi:latest" } }),
  operatorPlain: stateWith({ operators: { selected: [operator()] } }),
  operatorMin: stateWith({ operators: { selected: [operator({ minVersion: "4.21.0" })] } }),
  operatorMax: stateWith({ operators: { selected: [operator({ maxVersion: "4.21.9" })] } }),
  operatorBoth: stateWith({ operators: { selected: [operator({ minVersion: "4.21.0", maxVersion: "4.21.9" })] } }),
  archAarch64: stateWith({ blueprint: { arch: "aarch64" } }),
  // ppc64le and s390x were shapes here until Tranche 4A. The D3 architecture
  // matrix offers them for NO scenario at any supported minor — every platform
  // book documents amd64, or amd64 and arm64 — and generation now enforces
  // that, so these states no longer produce a document to conform-check. The
  // arch -> mirror-arch MAPPING for both is still covered below; what changed
  // is that the product refuses to build such a cluster, which is asserted
  // explicitly rather than dropped.
  noArch: stateWith({ blueprint: {} }),
  noPatchVersion: stateWith({ release: { channel: "4.21" } }),
  everything: stateWith({
    blueprint: { arch: "aarch64" },
    imagesetConfig: { archiveSize: "8", kubeVirtContainer: true, additionalImages: "registry.redhat.io/ubi9/ubi:latest" },
    operators: { selected: [operator({ minVersion: "4.21.0" })] },
  }),
};

describe("generated ImageSetConfiguration conforms to the oc-mirror v2 schema", () => {
  for (const [name, state] of Object.entries(ALL_SHAPES)) {
    test(`${name}: emits no key oc-mirror would reject`, () => {
      const paths = emittedPaths(load(state));
      const unknown = paths.filter((p) => !ALLOWED.has(p));
      assert.deepEqual(
        unknown,
        [],
        `oc-mirror decodes with DisallowUnknownFields, so these would be a hard parse failure: ${unknown.join(", ")}`
      );
    });
  }

  test("no shape emits any path the schema records as rejected", () => {
    const rejected = Object.keys(SCHEMA.rejectedPaths);
    for (const [name, state] of Object.entries(ALL_SHAPES)) {
      const paths = new Set(emittedPaths(load(state)));
      for (const bad of rejected) {
        assert.ok(!paths.has(bad), `${name} emitted the rejected path ${bad}`);
      }
    }
  });

  test("apiVersion and kind match the schema exactly", () => {
    const cfg = load(ALL_SHAPES.minimal);
    assert.equal(cfg.apiVersion, SCHEMA.apiVersion);
    assert.equal(cfg.kind, SCHEMA.kind);
  });
});

describe("FQ-9 regression: operator version filters", () => {
  test("minVersion and maxVersion sit directly on the channel", () => {
    const ch = load(ALL_SHAPES.operatorBoth).mirror.operators[0].packages[0].channels[0];
    assert.equal(ch.name, "stable-4.21");
    assert.equal(ch.minVersion, "4.21.0");
    assert.equal(ch.maxVersion, "4.21.9");
  });

  test("includeConfig is never emitted", () => {
    for (const [name, state] of Object.entries(ALL_SHAPES)) {
      const text = buildImageSetConfig(state);
      assert.ok(!text.includes("includeConfig"), `${name} still emits includeConfig`);
    }
  });

  test("only one of the two filters is set, because oc-mirror rejects mixing them", () => {
    const pkg = load(ALL_SHAPES.operatorBoth).mirror.operators[0].packages[0];
    assert.equal(pkg.minVersion, undefined);
    assert.equal(pkg.maxVersion, undefined);
    assert.equal(pkg.channels[0].minVersion, "4.21.0");
  });

  test("no version filter is emitted when the operator declares none", () => {
    const ch = load(ALL_SHAPES.operatorPlain).mirror.operators[0].packages[0].channels[0];
    assert.deepEqual(Object.keys(ch), ["name"]);
  });

  test("empty-string constraints emit nothing", () => {
    const ch = load(
      stateWith({ operators: { selected: [operator({ minVersion: "", maxVersion: "" })] } })
    ).mirror.operators[0].packages[0].channels[0];
    assert.deepEqual(Object.keys(ch), ["name"]);
  });
});

describe("FQ-9 negative control: the exact pre-fix artifact is rejected by the schema model", () => {
  // Byte-for-byte the artifact the pre-fix generator produced for an operator with a
  // minVersion, captured from the real generator and confirmed against oc-mirror
  // 4.22.17 as `json: unknown field "includeConfig"`.
  const PRE_FIX_ARTIFACT = `apiVersion: mirror.openshift.io/v2alpha1
kind: ImageSetConfiguration
mirror:
  platform:
    channels:
      - name: stable-4.21
        minVersion: 4.21.35
        maxVersion: 4.21.35
    graph: true
  operators:
    - catalog: registry.redhat.io/redhat/redhat-operator-index:v4.21
      packages:
        - name: odf-operator
          channels:
            - name: stable-4.21
              includeConfig:
                minVersion: 4.21.0
`;

  test("the pre-fix artifact contains a key the schema rejects", () => {
    const paths = emittedPaths(yaml.load(PRE_FIX_ARTIFACT));
    const unknown = paths.filter((p) => !ALLOWED.has(p));
    assert.ok(
      unknown.length > 0,
      "the negative control must fail; if this passes, the conformance check cannot detect FQ-9"
    );
    assert.ok(unknown.some((p) => p.endsWith("includeConfig")));
  });

  test("the schema records the rejection with the binary's verbatim error", () => {
    const entry = SCHEMA.rejectedPaths["mirror.operators[].packages[].channels[].includeConfig"];
    assert.ok(entry, "schema must record the includeConfig rejection");
    assert.match(entry.error, /unknown field "includeConfig"/);
  });

  test("the current generator no longer produces the pre-fix artifact", () => {
    const now = buildImageSetConfig(
      stateWith({ operators: { selected: [operator({ minVersion: "4.21.0" })] } })
    );
    assert.notEqual(now, PRE_FIX_ARTIFACT);
    assert.ok(now.includes("minVersion: 4.21.0"));
    assert.ok(!now.includes("includeConfig"));
  });
});

describe("mirror.platform.architectures reflects the Blueprint target architecture", () => {
  // Omitting architectures is NOT harmless: oc-mirror defaults to amd64, so a
  // non-x86 cluster silently gets the wrong release payload while the config parses.
  // Only architectures the D3 matrix actually offers can be generated. See
  // ARCHITECTURES_OFFERED_BY_NO_SCENARIO below for the other two.
  const cases = [
    ["x86_64", "amd64"],
    ["aarch64", "arm64"],
  ];
  for (const [blueprintArch, mirrorArch] of cases) {
    test(`${blueprintArch} emits architectures: [${mirrorArch}]`, () => {
      const cfg = load(stateWith({ blueprint: { arch: blueprintArch } }));
      assert.deepEqual(cfg.mirror.platform.architectures, [mirrorArch]);
    });
  }

  test("every emitted architecture is one oc-mirror accepts", () => {
    const accepted = new Set(
      SCHEMA.semanticRules.find((r) => r.id === "architectures-default").acceptedValues
    );
    for (const [blueprintArch] of cases) {
      const [emitted] = load(stateWith({ blueprint: { arch: blueprintArch } })).mirror.platform.architectures;
      assert.ok(accepted.has(emitted), `${emitted} is not an accepted oc-mirror architecture`);
    }
  });

  test("architectures is omitted when the Blueprint architecture is unset", () => {
    const cfg = load(stateWith({ blueprint: {} }));
    assert.equal(cfg.mirror.platform.architectures, undefined);
  });

  const ARCHITECTURES_OFFERED_BY_NO_SCENARIO = ["ppc64le", "s390x"];

  for (const arch of ARCHITECTURES_OFFERED_BY_NO_SCENARIO) {
    test(`${arch} is refused by generation — no scenario offers it (D3)`, () => {
      assert.throws(
        () => load(stateWith({ blueprint: { arch } })),
        (err) => err.code === "UNSUPPORTED_ARCHITECTURE" && err.requestedArchitecture === arch
      );
    });

    test(`${arch} still has a correct arch -> mirror mapping recorded`, () => {
      // The mapping is not wrong; the product simply does not offer a cluster
      // on it. Keeping this pinned means a future scenario that DOES offer
      // ppc64le/s390x inherits a verified mapping.
      assert.equal(SCHEMA.architectMapping[arch], arch);
    });
  }

  test("the imageset architecture agrees with the install-config architecture", () => {
    // The defect this guards against is the two artifacts disagreeing: an aarch64
    // install-config paired with an amd64 mirror payload.
    const cfg = load(stateWith({ blueprint: { arch: "aarch64" } }));
    assert.deepEqual(cfg.mirror.platform.architectures, ["arm64"]);
    assert.equal(SCHEMA.architectMapping.aarch64, "arm64");
  });
});

describe("generation boundary enforces the supported-minor policy", () => {
  // The guard lives in buildImageSetConfig itself, not only in its callers. A route
  // that forgets to assert support must not be able to produce an unsupported
  // configuration; `POST /api/ocmirror/run` was exactly that call site.
  const forMinor = (minor, patch) => ({
    release: { patchVersion: patch, channel: minor },
    version: { selectedMinor: minor, selectedPatch: patch, selectedChannel: `stable-${minor}`, locked: true },
    blueprint: { arch: "x86_64" },
    operators: { selected: [] },
    imagesetConfig: {},
  });

  test("4.20 generation is allowed and names its own channel", () => {
    const cfg = yaml.load(buildImageSetConfig(forMinor("4.20", "4.20.40")));
    assert.equal(cfg.mirror.platform.channels[0].name, "stable-4.20");
  });

  test("4.21 generation is allowed and names its own channel", () => {
    const cfg = yaml.load(buildImageSetConfig(forMinor("4.21", "4.21.35")));
    assert.equal(cfg.mirror.platform.channels[0].name, "stable-4.21");
  });

  test("4.23 fails deterministically with UNSUPPORTED_VERSION", () => {
    assert.throws(
      () => buildImageSetConfig(forMinor("4.23", "4.23.0")),
      (err) => {
        assert.equal(err.code, "UNSUPPORTED_VERSION");
        assert.equal(err.requestedVersion, "4.23");
        assert.deepEqual(err.supportedVersions, SUPPORTED_MINORS);
        return true;
      }
    );
  });

  test("4.23 rejection is not a fallback: nothing is generated", () => {
    // The failure mode this replaces produced a stable-4.20 config for an
    // unsupported state. 4.22 is supported now, so 4.23 carries the case.
    let produced = null;
    try {
      produced = buildImageSetConfig(forMinor("4.23", "4.23.0"));
    } catch {
      /* expected */
    }
    assert.equal(produced, null);
  });

  test("every supported minor generates, every unsupported one throws", () => {
    for (const minor of SUPPORTED_MINORS) {
      assert.ok(buildImageSetConfig(forMinor(minor, `${minor}.1`)).includes(`stable-${minor}`));
    }
    for (const minor of ["4.19", "4.23", "4.24", "5.0"]) {
      assert.throws(
        () => buildImageSetConfig(forMinor(minor, `${minor}.1`)),
        (err) => err.code === "UNSUPPORTED_VERSION",
        `${minor} must be rejected at the generation boundary`
      );
    }
  });

  test("an unresolvable minor throws UNSUPPORTED_VERSION instead of defaulting to 4.20", () => {
    assert.throws(
      () => buildImageSetConfig({ operators: { selected: [] }, imagesetConfig: {} }),
      (err) => err.code === "UNSUPPORTED_VERSION" && err.requestedVersion === null
    );
  });
});

describe("the 4.20 oc-mirror catalog agrees with the global schema", () => {
  // The catalog claimed five paths oc-mirror rejects. Vacuous validation hid them.
  const catalog = JSON.parse(
    fs.readFileSync(path.join(REPO, "data", "params", "4.20", "oc-mirror-v2.json"), "utf8")
  );

  test("every catalog path exists in the oc-mirror v2 schema", () => {
    const unknown = catalog.parameters.map((p) => p.path).filter((p) => !ALLOWED.has(p));
    assert.deepEqual(unknown, [], `catalog claims paths oc-mirror rejects: ${unknown.join(", ")}`);
  });

  test("no catalog path is one the schema records as rejected", () => {
    const claimed = new Set(catalog.parameters.map((p) => p.path));
    for (const bad of Object.keys(SCHEMA.rejectedPaths)) {
      assert.ok(!claimed.has(bad), `catalog still claims rejected path ${bad}`);
    }
  });

  test("every catalog row targets imageset-config.yaml", () => {
    for (const p of catalog.parameters) {
      assert.equal(p.outputFile, "imageset-config.yaml", `${p.path} has the wrong outputFile`);
    }
  });

  test("blockedImages is modelled as an array of objects, not strings", () => {
    const parent = catalog.parameters.find((p) => p.path === "mirror.blockedImages");
    const child = catalog.parameters.find((p) => p.path === "mirror.blockedImages[].name");
    assert.equal(parent.type, "array");
    assert.ok(child, "mirror.blockedImages[].name row must exist");
    assert.match(parent.allowed, /object/i);
  });
});
