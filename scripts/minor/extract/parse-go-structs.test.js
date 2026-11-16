"use strict";

/**
 * Hermetic fixture tests for the installer-source extractor.
 *
 * The load-bearing test here is `emits every field diff-params reads`
 * (gap list GAP-12, harvest finding F1). The 4.21-era producer emitted
 * `description`/`struct`/`field` while its consumer read `comment`/`jsonTag`/
 * `file`, so `changed_description` could never fire and the 4.20 -> 4.21 delta
 * reported `changed: 0` with apparent confidence. Asserting the producer
 * against the consumer's own exported contract is what stops that recurring.
 *
 * Every fixture is written to os.tmpdir() and initialised as a git repository,
 * because provenance is derived from the clone and the extractor fails closed
 * without it. No network, no installer checkout.
 */

const { test, describe } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync, spawnSync } = require("node:child_process");

const { parseGoFile } = require("./go-struct-parser.js");
const { walk, decompose } = require("./go-struct-walker.js");
const { extract, buildIndex, listGoFiles } = require("./parse-go-structs.js");
const { INPUT_CONTRACT } = require("../compare/diff-params.js");

const SCRIPT = path.join(__dirname, "parse-go-structs.js");

// ---------------------------------------------------------------------------
// Fixture tree: a miniature installer with the shapes that actually matter.
// ---------------------------------------------------------------------------

const TYPES_GO = `package types

import (
	"github.com/openshift/installer/pkg/types/baremetal"
	configv1 "github.com/openshift/api/config/v1"
)

// OSImageStream is the OS image stream.
// +kubebuilder:validation:Enum:="rhel-9";"rhel-10"
type OSImageStream string

const (
	// OSImageStreamRHEL9 is RHEL 9.
	OSImageStreamRHEL9 OSImageStream = "rhel-9"
	// OSImageStreamRHEL10 is RHEL 10.
	OSImageStreamRHEL10 OSImageStream = "rhel-10"
)

// InstallConfig is the root.
type InstallConfig struct {
	// BaseDomain is the base domain.
	BaseDomain string \`json:"baseDomain"\`

	// FIPS enables FIPS mode.
	// +optional
	FIPS bool \`json:"fips,omitempty"\`

	// Replicas is the replica count.
	// +optional
	Replicas *int64 \`json:"replicas,omitempty"\`

	// Platform is the platform.
	Platform Platform \`json:"platform"\`

	// Compute is the list of compute pools.
	// +optional
	Compute []MachinePool \`json:"compute,omitempty"\`

	// FeatureSet is an external enum that serializes as a string.
	// +optional
	FeatureSet configv1.FeatureSet \`json:"featureSet,omitempty"\`

	// OSImageStream selects the OS image stream.
	// +optional
	OSImageStream OSImageStream \`json:"osImageStream,omitempty"\`

	// Internal is not serialized.
	Internal string \`json:"-"\`

	// File has no tag at all.
	File *string
}

// Platform is the platform union.
type Platform struct {
	// BareMetal is the bare metal platform.
	// +optional
	BareMetal *baremetal.Platform \`json:"baremetal,omitempty"\`
}

// MachinePool is a pool.
type MachinePool struct {
	// Name is the pool name.
	Name string \`json:"name"\`
}
`;

const BAREMETAL_GO = `package baremetal

// ProvisioningNetwork determines how we will use the provisioning network.
type ProvisioningNetwork string

const (
	// ManagedProvisioningNetwork means managed.
	ManagedProvisioningNetwork ProvisioningNetwork = "Managed"
	// UnmanagedProvisioningNetwork means unmanaged.
	UnmanagedProvisioningNetwork ProvisioningNetwork = "Unmanaged"
	// DisabledProvisioningNetwork means disabled.
	DisabledProvisioningNetwork ProvisioningNetwork = "Disabled"

	// UnrelatedUntyped is an untyped constant sharing the block. It is NOT a
	// ProvisioningNetwork value, and Go does not make it one. Modelled on the
	// real pkg/types/gcp/platform.go block where CloudEnvironmentSovereign
	// sits alongside the FirewallRulesManagementPolicy constants.
	UnrelatedUntyped = "unrelated"
)

// Platform stores all the global bare metal configuration.
type Platform struct {
	// ProvisioningNetwork is the network mode.
	// +optional
	ProvisioningNetwork ProvisioningNetwork \`json:"provisioningNetwork,omitempty"\`

	// ProvisioningNetworkGateway is the gateway. Only honored when
	// provisioningNetwork is Managed.
	// +optional
	ProvisioningNetworkGateway string \`json:"provisioningNetworkGateway,omitempty"\`

	// DeprecatedAPIVIP is the VIP.
	// Deprecated: Use APIVIPs
	// +optional
	DeprecatedAPIVIP string \`json:"apiVIP,omitempty"\`

	// Hosts is the list of bare metal hosts.
	Hosts []*Host \`json:"hosts"\`
}

// Host stores a host.
type Host struct {
	// Name is the host name.
	Name string \`json:"name"\`
	// BMC is the BMC config.
	BMC BMC \`json:"bmc"\`
}

// BMC stores BMC access.
type BMC struct {
	// Username is the BMC username.
	Username string \`json:"username"\`
}
`;

function makeTree(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "oaa-go-fixture-"));
  for (const [rel, text] of Object.entries(files)) {
    const full = path.join(dir, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, text, "utf-8");
  }
  execFileSync("git", ["-C", dir, "init", "-q"], { stdio: "ignore" });
  execFileSync("git", ["-C", dir, "add", "-A"], { stdio: "ignore" });
  execFileSync(
    "git",
    ["-C", dir, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "-m", "fixture"],
    { stdio: "ignore" }
  );
  return dir;
}

const FIXTURE = {
  "pkg/types/installconfig.go": TYPES_GO,
  "pkg/types/baremetal/platform.go": BAREMETAL_GO,
};

function extractFixture(overrides) {
  const dir = makeTree({ ...FIXTURE, ...(overrides || {}) });
  try {
    return extract({
      sourceDir: dir,
      rootKey: "install-config",
      scanDirs: ["pkg/types"],
      minor: "4.22",
      release: "4.22.16",
    });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function byPath(result, p) {
  return result.parameters.find((x) => x.path === p);
}

// ---------------------------------------------------------------------------

describe("go-struct-parser", () => {
  test("records struct, field, file and line", () => {
    const parsed = parseGoFile("pkg/types/baremetal/platform.go", BAREMETAL_GO);
    assert.equal(parsed.pkg, "baremetal");
    const platform = parsed.structs.Platform;
    assert.ok(platform, "Platform struct found");
    assert.equal(platform.file, "pkg/types/baremetal/platform.go");
    const gw = platform.fields.find((f) => f.name === "ProvisioningNetworkGateway");
    assert.ok(gw.line > 0, "line number captured");
    assert.equal(gw.jsonName, "provisioningNetworkGateway");
    assert.equal(gw.omitempty, true);
  });

  test("joins the doc comment and drops kubebuilder markers from prose", () => {
    const parsed = parseGoFile("pkg/types/baremetal/platform.go", BAREMETAL_GO);
    const gw = parsed.structs.Platform.fields.find((f) => f.name === "ProvisioningNetworkGateway");
    assert.equal(
      gw.description,
      "ProvisioningNetworkGateway is the gateway. Only honored when provisioningNetwork is Managed."
    );
    assert.deepEqual(gw.markers, ["+optional"]);
  });

  test("captures a Deprecated: marker and its replacement text", () => {
    const parsed = parseGoFile("pkg/types/baremetal/platform.go", BAREMETAL_GO);
    const vip = parsed.structs.Platform.fields.find((f) => f.name === "DeprecatedAPIVIP");
    assert.equal(vip.deprecated, "Use APIVIPs");
  });

  test("collects typed constants as enum candidates", () => {
    const parsed = parseGoFile("pkg/types/baremetal/platform.go", BAREMETAL_GO);
    assert.deepEqual(
      parsed.consts.ProvisioningNetwork.map((c) => c.value),
      ["Managed", "Unmanaged", "Disabled"]
    );
  });

  test("an untyped constant sharing a const block is not attributed to the typed one", () => {
    // Regression: the carry-forward version of collectConsts reported a false
    // 4.21 -> 4.22 enum change adding "sovereign" to GCP firewallRulesManagement.
    const parsed = parseGoFile("pkg/types/baremetal/platform.go", BAREMETAL_GO);
    assert.ok(
      !parsed.consts.ProvisioningNetwork.some((c) => c.value === "unrelated"),
      "untyped constant leaked into the typed enum"
    );
  });

  test("a kubebuilder Enum marker on the type is captured", () => {
    const parsed = parseGoFile("pkg/types/installconfig.go", TYPES_GO);
    assert.deepEqual(parsed.aliases.OSImageStream.enum, ["rhel-9", "rhel-10"]);
  });

  test("records a type alias with its defining file", () => {
    const parsed = parseGoFile("pkg/types/installconfig.go", TYPES_GO);
    assert.equal(parsed.aliases.OSImageStream.underlying, "string");
    assert.equal(parsed.aliases.OSImageStream.file, "pkg/types/installconfig.go");
  });
});

describe("go-struct-walker", () => {
  test("decompose strips pointers, slices and maps", () => {
    assert.deepEqual(decompose("*[]*baremetal.Host"), {
      base: "baremetal.Host",
      isArray: true,
      isMap: false,
    });
    assert.deepEqual(decompose("map[string]string"), {
      base: "string",
      isArray: false,
      isMap: true,
    });
  });
});

describe("parse-go-structs extraction", () => {
  const result = extractFixture();

  test("emits every field diff-params declares in INPUT_CONTRACT", () => {
    // GAP-12 / F1. This is the assertion whose absence let the producer and
    // the consumer drift apart through an entire minor onboarding.
    const names = [INPUT_CONTRACT.key, ...INPUT_CONTRACT.compared, ...INPUT_CONTRACT.provenance];
    for (const rec of result.parameters) {
      for (const field of names) {
        assert.ok(
          Object.prototype.hasOwnProperty.call(rec, field),
          `record ${rec.path} is missing contract field "${field}"`
        );
      }
    }
  });

  test("builds dotted YAML paths through nested structs", () => {
    assert.ok(byPath(result, "platform.baremetal.provisioningNetworkGateway"));
    assert.ok(byPath(result, "platform.baremetal.hosts[].bmc.username"));
  });

  test("an array of structs contributes a [] segment", () => {
    assert.equal(byPath(result, "compute[]").type, "array");
    assert.ok(byPath(result, "compute[].name"));
  });

  test("required is the absence of omitempty, and omitempty is reported too", () => {
    assert.equal(byPath(result, "baseDomain").required, true);
    assert.equal(byPath(result, "baseDomain").omitempty, false);
    assert.equal(byPath(result, "fips").required, false);
    assert.equal(byPath(result, "fips").omitempty, true);
  });

  test("named string types resolve to the primitive they serialize as", () => {
    // Catalogs describe YAML, not Go.
    assert.equal(byPath(result, "platform.baremetal.provisioningNetwork").type, "string");
    assert.equal(byPath(result, "osImageStream").type, "string");
  });

  test("attaches declared constants as the enum for a named type", () => {
    const pn = byPath(result, "platform.baremetal.provisioningNetwork");
    assert.deepEqual(pn.enum, ["Managed", "Unmanaged", "Disabled"]);
    assert.equal(pn.enumSource, "typed-constants");
  });

  test("a kubebuilder enum marker outranks harvested constants and is labelled as such", () => {
    const osi = byPath(result, "osImageStream");
    assert.deepEqual(osi.enum, ["rhel-9", "rhel-10"]);
    assert.equal(osi.enumSource, "kubebuilder-enum-marker");
  });

  test("an unresolvable external type does not invent child paths", () => {
    assert.equal(byPath(result, "featureSet").type, "object");
    assert.equal(
      result.parameters.filter((p) => p.path.startsWith("featureSet.")).length,
      0
    );
  });

  test("pointers to primitives keep the primitive type", () => {
    assert.equal(byPath(result, "replicas").type, "integer");
  });

  test('json:"-" and untagged fields are not emitted', () => {
    assert.equal(byPath(result, "-"), undefined);
    assert.equal(byPath(result, "internal"), undefined);
    assert.equal(byPath(result, "File"), undefined);
    assert.equal(byPath(result, "file"), undefined);
  });

  test("deprecation is carried onto the parameter record", () => {
    const vip = byPath(result, "platform.baremetal.apiVIP");
    assert.equal(vip.deprecated, true);
    assert.equal(vip.deprecationNote, "Use APIVIPs");
  });

  test("provenance is derived from the clone, not asserted", () => {
    assert.match(result.installerCommit, /^[0-9a-f]{40}$/);
    assert.ok(result.source.includes(result.installerCommit));
  });

  test("line and file provenance point at the declaring file", () => {
    const gw = byPath(result, "platform.baremetal.provisioningNetworkGateway");
    assert.equal(gw.file, "pkg/types/baremetal/platform.go");
    assert.equal(gw.struct, "baremetal.Platform");
    assert.equal(gw.field, "ProvisioningNetworkGateway");
    assert.ok(gw.line > 0);
  });
});

describe("parse-go-structs failure modes", () => {
  test("fails closed on an empty source tree rather than reporting zero", () => {
    const dir = makeTree({ "README.md": "nothing here" });
    try {
      assert.throws(
        () =>
          extract({ sourceDir: dir, rootKey: "install-config", scanDirs: ["pkg/types"], minor: "4.22" }),
        /Refusing to report an empty extraction as success/
      );
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test("fails closed when the root struct is absent", () => {
    const dir = makeTree({ "pkg/types/other.go": "package types\n\ntype Other struct {\n\tA string `json:\"a\"`\n}\n" });
    try {
      assert.throws(
        () =>
          extract({ sourceDir: dir, rootKey: "install-config", scanDirs: ["pkg/types"], minor: "4.22" }),
        /Root struct types.InstallConfig not found/
      );
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test("fails closed when the tree carries no derivable commit", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "oaa-go-nogit-"));
    try {
      fs.mkdirSync(path.join(dir, "pkg/types"), { recursive: true });
      fs.writeFileSync(path.join(dir, "pkg/types/installconfig.go"), TYPES_GO, "utf-8");
      fs.mkdirSync(path.join(dir, "pkg/types/baremetal"), { recursive: true });
      fs.writeFileSync(path.join(dir, "pkg/types/baremetal/platform.go"), BAREMETAL_GO, "utf-8");
      assert.throws(
        () =>
          extract({ sourceDir: dir, rootKey: "install-config", scanDirs: ["pkg/types"], minor: "4.22" }),
        /Provenance is derived, never asserted/
      );
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test("CLI refuses a defaulted minor", () => {
    const r = spawnSync(process.execPath, [SCRIPT, "--source", "/tmp"], { encoding: "utf-8" });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /--minor is required/);
  });

  test("CLI refuses an unknown root", () => {
    const dir = makeTree(FIXTURE);
    try {
      const r = spawnSync(
        process.execPath,
        [SCRIPT, "--minor", "4.22", "--source", dir, "--root", "nonsense"],
        { encoding: "utf-8" }
      );
      assert.equal(r.status, 1);
      assert.match(r.stderr, /Unknown --root/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test("CLI accepts an unsupported minor, because 4.22 evidence must be acquirable while 4.22 is fail-closed", () => {
    const dir = makeTree(FIXTURE);
    const out = path.join(dir, "out.json");
    try {
      const r = spawnSync(
        process.execPath,
        [SCRIPT, "--minor", "4.22", "--source", dir, "--out", out],
        { encoding: "utf-8" }
      );
      assert.equal(r.status, 0);
      assert.equal(JSON.parse(fs.readFileSync(out, "utf-8")).minor, "4.22");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("producer feeds the comparator end to end", () => {
  test("a changed doc comment surfaces as changed_description", () => {
    // The negative result the 4.21 pipeline could not produce.
    const { diffParams } = require("../compare/diff-params.js");
    const baseline = extractFixture();
    const mutated = BAREMETAL_GO.replace(
      "// ProvisioningNetworkGateway is the gateway. Only honored when",
      "// ProvisioningNetworkGateway is the gateway address. Only honored when"
    );
    const target = extractFixture({ "pkg/types/baremetal/platform.go": mutated });

    const delta = diffParams({ baseline, target, previousMinor: "4.21", minor: "4.22" });
    const row = delta.changed.find(
      (c) => c.path === "platform.baremetal.provisioningNetworkGateway"
    );
    assert.ok(row, "description change detected");
    assert.ok(row.classification.includes("changed_description"));
    assert.equal(delta.summary.added, 0);
    assert.equal(delta.summary.removed, 0);
  });

  test("a new field surfaces as added, carrying its provenance", () => {
    const { diffParams } = require("../compare/diff-params.js");
    const baseline = extractFixture();
    const withNew = BAREMETAL_GO.replace(
      "\t// Hosts is the list of bare metal hosts.",
      "\t// NewThing is new in this minor.\n\t// +optional\n\tNewThing string `json:\"newThing,omitempty\"`\n\n\t// Hosts is the list of bare metal hosts."
    );
    const target = extractFixture({ "pkg/types/baremetal/platform.go": withNew });

    const delta = diffParams({ baseline, target, previousMinor: "4.21", minor: "4.22" });
    const row = delta.added.find((a) => a.path === "platform.baremetal.newThing");
    assert.ok(row, "added field detected");
    assert.equal(row.classification, "added_in_4.22");
    assert.equal(row.struct, "baremetal.Platform");
    assert.equal(row.field, "NewThing");
  });
});

describe("listGoFiles", () => {
  test("skips tests and generated deepcopy files", () => {
    const dir = makeTree({
      ...FIXTURE,
      "pkg/types/installconfig_test.go": "package types\n",
      "pkg/types/zz_generated.deepcopy.go": "package types\n",
    });
    try {
      const files = listGoFiles(dir, ["pkg/types"]).map((f) => path.relative(dir, f));
      assert.ok(files.includes("pkg/types/installconfig.go"));
      assert.ok(!files.some((f) => f.endsWith("_test.go")));
      assert.ok(!files.some((f) => f.startsWith("pkg/types/zz_generated")));
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test("buildIndex reports a package-name collision instead of resolving it silently", () => {
    const dir = makeTree({
      ...FIXTURE,
      "pkg/types/aws/validation/v.go": "package validation\n\ntype Rule struct {\n\tA string `json:\"a\"`\n}\n",
      "pkg/types/azure/validation/v.go": "package validation\n\ntype Rule struct {\n\tB string `json:\"b\"`\n}\n",
    });
    try {
      const files = listGoFiles(dir, ["pkg/types"]);
      const { collisions } = buildIndex(dir, files);
      assert.ok(collisions.some((c) => c.pkg === "validation" && c.struct === "Rule"));
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
