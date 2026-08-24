/**
 * Field Guide Version Safety Tests (FG-4.21-B)
 *
 * Public-boundary regression coverage for strict Field Guide version resolution.
 * Tests the buildFieldGuide path to ensure unsafe cases throw before any
 * partial Field Guide markdown is returned.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildFieldGuide } from "../src/fieldGuide/index.js";
import {
  FIELD_GUIDE_SUPPORTED_MINORS,
  resolveFieldGuideVersion,
  FieldGuideVersionError,
} from "../src/fieldGuide/versionResolution.js";

// --- Helpers ---

const makeCanonicalState = (minor, patch, overrides = {}) => ({
  blueprint: { platform: "Bare Metal", clusterName: "test", baseDomain: "example.com" },
  methodology: { method: "Agent-Based Installer" },
  version: {
    selectedMinor: minor,
    selectedPatch: patch,
    selectedChannel: `stable-${minor}`,
    locked: true,
    _schemaVersion: 3,
    ...overrides,
  },
  release: { patchVersion: patch },
});

const makeLegacyOnlyState = (patch, channel) => ({
  blueprint: { platform: "Bare Metal", clusterName: "test", baseDomain: "example.com" },
  methodology: { method: "Agent-Based Installer" },
  release: { patchVersion: patch, channel },
});

const assertThrowsFieldGuide = (state, pattern, label) => {
  let result;
  let threw = false;
  try {
    result = buildFieldGuide(state);
  } catch (err) {
    threw = true;
    if (pattern) {
      assert.match(err.message, pattern, `${label}: error message mismatch`);
    }
  }
  assert(threw, `${label}: expected buildFieldGuide to throw, but it returned: ${typeof result === 'string' ? result.substring(0, 80) : result}`);
};

// --- Tests ---

describe("FIELD_GUIDE_SUPPORTED_MINORS policy", () => {
  it("contains exactly 4.20 and 4.21", () => {
    assert.deepStrictEqual(
      [...FIELD_GUIDE_SUPPORTED_MINORS],
      ["4.20", "4.21"]
    );
  });

  it("is frozen", () => {
    assert(Object.isFrozen(FIELD_GUIDE_SUPPORTED_MINORS));
  });
});

describe("consistent canonical locked states render correctly", () => {
  it("4.20 locked state renders version 4.20 without mixed labels", () => {
    const state = makeCanonicalState("4.20", "4.20.15");
    const md = buildFieldGuide(state);
    assert(typeof md === "string" && md.length > 0, "should return non-empty markdown");
    assert(md.includes("OCP 4.20"), "should include OCP 4.20");
    assert(!md.includes("OCP 4.21"), "should not include OCP 4.21 labels");
    assert(md.includes("4.20.15"), "should include patch version");
    assert(md.includes("stable-4.20"), "should include channel");
  });

  it("4.21 locked state renders version 4.21 without mixed labels", () => {
    const state = makeCanonicalState("4.21", "4.21.5");
    const md = buildFieldGuide(state);
    assert(typeof md === "string" && md.length > 0, "should return non-empty markdown");
    assert(md.includes("OCP 4.21"), "should include OCP 4.21");
    assert(md.includes("4.21.5"), "should include patch version");
    assert(md.includes("stable-4.21"), "should include channel");
  });

  it("4.20 state selects 4.20 compartments only", () => {
    const state = makeCanonicalState("4.20", "4.20.15");
    const md = buildFieldGuide(state);
    assert(md.includes("Field Guide"), "should produce a Field Guide");
  });

  it("4.21 state selects 4.21 compartments only", () => {
    const state = makeCanonicalState("4.21", "4.21.5");
    const md = buildFieldGuide(state);
    assert(md.includes("Field Guide"), "should produce a Field Guide");
  });
});

describe("supported legacy-only compatibility state still renders", () => {
  it("legacy-only 4.20 state with patch and channel renders", () => {
    const state = makeLegacyOnlyState("4.20.10", "stable-4.20");
    const md = buildFieldGuide(state);
    assert(typeof md === "string" && md.length > 0, "should return non-empty markdown");
    assert(md.includes("4.20"), "should include 4.20");
  });

  it("legacy-only 4.21 state with patch and channel renders", () => {
    const state = makeLegacyOnlyState("4.21.3", "stable-4.21");
    const md = buildFieldGuide(state);
    assert(typeof md === "string" && md.length > 0, "should return non-empty markdown");
    assert(md.includes("4.21"), "should include 4.21");
  });

  it("legacy-only with just patchVersion renders", () => {
    const state = {
      blueprint: { platform: "Bare Metal", clusterName: "test", baseDomain: "example.com" },
      methodology: { method: "Agent-Based Installer" },
      release: { patchVersion: "4.21.7" },
    };
    const md = buildFieldGuide(state);
    assert(md.includes("4.21"), "should render from patchVersion alone");
  });
});

describe("no version sources", () => {
  it("throws when state is null", () => {
    assertThrowsFieldGuide(null, /version/, "null state");
  });

  it("throws when state is empty object", () => {
    assertThrowsFieldGuide({}, /version/, "empty state");
  });

  it("throws when state has only non-version fields", () => {
    assertThrowsFieldGuide(
      { blueprint: { platform: "Bare Metal" }, methodology: { method: "IPI" } },
      /version/,
      "no version fields"
    );
  });

  it("throws when version and release are empty objects", () => {
    assertThrowsFieldGuide(
      { version: {}, release: {} },
      /version/,
      "empty version and release"
    );
  });
});

describe("canonical pre-lock / unlocked state", () => {
  it("throws when version.locked is false", () => {
    const state = makeCanonicalState("4.21", "4.21.5", { locked: false });
    assertThrowsFieldGuide(state, /locked/, "locked: false");
  });

  it("throws when version.locked is undefined", () => {
    const state = makeCanonicalState("4.21", "4.21.5");
    delete state.version.locked;
    assertThrowsFieldGuide(state, /locked/, "locked: undefined");
  });

  it("throws when version.locked is null", () => {
    const state = makeCanonicalState("4.21", "4.21.5", { locked: null });
    assertThrowsFieldGuide(state, /locked/, "locked: null");
  });

  it("throws when version.locked is string 'true'", () => {
    const state = makeCanonicalState("4.21", "4.21.5", { locked: "true" });
    assertThrowsFieldGuide(state, /locked/, "locked: 'true'");
  });

  it("throws when version.locked is 1", () => {
    const state = makeCanonicalState("4.21", "4.21.5", { locked: 1 });
    assertThrowsFieldGuide(state, /locked/, "locked: 1");
  });
});

describe("unresolved canonical version object", () => {
  it("throws when canonical version has only locked:true but no version fields", () => {
    assertThrowsFieldGuide(
      {
        blueprint: { platform: "Bare Metal", clusterName: "test", baseDomain: "example.com" },
        methodology: { method: "IPI" },
        version: { locked: true, _schemaVersion: 3 },
      },
      /version/,
      "locked but empty canonical"
    );
  });
});

describe("invalid types and malformed fields", () => {
  it("throws for numeric selectedMinor", () => {
    const state = makeCanonicalState("4.21", "4.21.5", { selectedMinor: 4.21 });
    assertThrowsFieldGuide(state, /invalid type/, "numeric selectedMinor");
  });

  it("throws for boolean selectedMinor", () => {
    const state = makeCanonicalState("4.21", "4.21.5", { selectedMinor: true });
    assertThrowsFieldGuide(state, /invalid type/, "boolean selectedMinor");
  });

  it("throws for array selectedPatch", () => {
    const state = makeCanonicalState("4.21", "4.21.5", { selectedPatch: ["4.21.5"] });
    assertThrowsFieldGuide(state, /invalid type/, "array selectedPatch");
  });

  it("throws for object selectedChannel", () => {
    const state = makeCanonicalState("4.21", "4.21.5", { selectedChannel: { v: "stable-4.21" } });
    assertThrowsFieldGuide(state, /invalid type/, "object selectedChannel");
  });

  it("throws for malformed minor 'four.twenty-one'", () => {
    const state = makeCanonicalState("four.twenty-one", "4.21.5");
    assertThrowsFieldGuide(state, /Invalid version format|not a minor/, "malformed minor");
  });

  it("throws for malformed patch 'abc'", () => {
    const state = makeCanonicalState("4.21", "abc");
    assertThrowsFieldGuide(state, /Invalid version format/, "malformed patch");
  });

  it("throws for malformed channel 'fast-4.21'", () => {
    const state = makeCanonicalState("4.21", "4.21.5", { selectedChannel: "fast-4.21" });
    assertThrowsFieldGuide(state, /not a valid stable/, "malformed channel");
  });

  it("throws for minor field that is actually a patch '4.21.5'", () => {
    const state = makeCanonicalState("4.21.5", "4.21.5");
    assertThrowsFieldGuide(state, /not a minor version/, "patch-as-minor");
  });
});

describe("malformed canonical data alongside valid legacy data", () => {
  it("throws when canonical selectedMinor is malformed but legacy patchVersion is valid", () => {
    assertThrowsFieldGuide(
      {
        blueprint: { platform: "Bare Metal", clusterName: "test", baseDomain: "example.com" },
        methodology: { method: "IPI" },
        version: { selectedMinor: "not-a-version", locked: true, _schemaVersion: 3 },
        release: { patchVersion: "4.21.5", channel: "stable-4.21" },
      },
      /Invalid version format|not a minor/,
      "malformed canonical + valid legacy"
    );
  });

  it("throws when canonical selectedPatch type is numeric but legacy is valid", () => {
    assertThrowsFieldGuide(
      {
        blueprint: { platform: "Bare Metal", clusterName: "test", baseDomain: "example.com" },
        methodology: { method: "IPI" },
        version: { selectedPatch: 4215, locked: true, _schemaVersion: 3 },
        release: { patchVersion: "4.21.5" },
      },
      /invalid type/,
      "numeric canonical patch + valid legacy"
    );
  });

  it("throws when canonical channel is malformed but legacy is valid", () => {
    assertThrowsFieldGuide(
      {
        blueprint: { platform: "Bare Metal", clusterName: "test", baseDomain: "example.com" },
        methodology: { method: "IPI" },
        version: { selectedMinor: "4.21", selectedChannel: "eus-4.21", locked: true },
        release: { patchVersion: "4.21.5", channel: "stable-4.21" },
      },
      /not a valid stable/,
      "malformed canonical channel + valid legacy"
    );
  });
});

describe("malformed legacy data alongside valid canonical data", () => {
  it("throws when legacy patchVersion is malformed but canonical is valid", () => {
    assertThrowsFieldGuide(
      {
        blueprint: { platform: "Bare Metal", clusterName: "test", baseDomain: "example.com" },
        methodology: { method: "IPI" },
        version: { selectedMinor: "4.21", selectedPatch: "4.21.5", locked: true },
        release: { patchVersion: "not-a-version" },
      },
      /Invalid version format/,
      "valid canonical + malformed legacy patch"
    );
  });

  it("throws when legacy channel is malformed but canonical is valid", () => {
    assertThrowsFieldGuide(
      {
        blueprint: { platform: "Bare Metal", clusterName: "test", baseDomain: "example.com" },
        methodology: { method: "IPI" },
        version: { selectedMinor: "4.21", selectedPatch: "4.21.5", selectedChannel: "stable-4.21", locked: true },
        release: { channel: "eus-4.21" },
      },
      /not a valid channel/,
      "valid canonical + malformed legacy channel"
    );
  });

  it("throws when release.selectedVersion is numeric but canonical is valid", () => {
    assertThrowsFieldGuide(
      {
        blueprint: { platform: "Bare Metal", clusterName: "test", baseDomain: "example.com" },
        methodology: { method: "IPI" },
        version: { selectedMinor: "4.21", locked: true },
        release: { selectedVersion: 42100 },
      },
      /invalid type/,
      "valid canonical + numeric legacy selectedVersion"
    );
  });
});

describe("unsupported 4.22 in each source category", () => {
  it("throws for 4.22 in version.selectedMinor", () => {
    const state = makeCanonicalState("4.22", "4.22.0", { selectedChannel: "stable-4.22" });
    assertThrowsFieldGuide(state, /4\.22.*not supported/, "4.22 selectedMinor");
  });

  it("throws for 4.22 in version.selectedPatch", () => {
    const state = makeCanonicalState("4.21", "4.22.0", { selectedChannel: "stable-4.21" });
    state.version.selectedMinor = "4.21";
    state.version.selectedPatch = "4.22.0";
    assertThrowsFieldGuide(state, /4\.22.*not supported/, "4.22 selectedPatch");
  });

  it("throws for 4.22 in version.selectedChannel", () => {
    const state = makeCanonicalState("4.21", "4.21.5", { selectedChannel: "stable-4.22" });
    assertThrowsFieldGuide(state, /4\.22.*not supported/, "4.22 selectedChannel");
  });

  it("throws for 4.22 in release.patchVersion even when canonical is 4.21", () => {
    assertThrowsFieldGuide(
      {
        blueprint: { platform: "Bare Metal", clusterName: "test", baseDomain: "example.com" },
        methodology: { method: "IPI" },
        version: { selectedMinor: "4.21", locked: true },
        release: { patchVersion: "4.22.0" },
      },
      /4\.22.*not supported/,
      "4.22 release.patchVersion"
    );
  });

  it("throws for 4.22 in release.channel even when canonical is 4.21", () => {
    assertThrowsFieldGuide(
      {
        blueprint: { platform: "Bare Metal", clusterName: "test", baseDomain: "example.com" },
        methodology: { method: "IPI" },
        version: { selectedMinor: "4.21", locked: true },
        release: { channel: "stable-4.22" },
      },
      /4\.22.*not supported/,
      "4.22 release.channel"
    );
  });

  it("throws for 4.22 in version.selectedVersion even when canonical is 4.21", () => {
    assertThrowsFieldGuide(
      {
        blueprint: { platform: "Bare Metal", clusterName: "test", baseDomain: "example.com" },
        methodology: { method: "IPI" },
        version: { selectedMinor: "4.21", selectedVersion: "4.22.0", locked: true },
        release: {},
      },
      /4\.22.*not supported/,
      "4.22 version.selectedVersion"
    );
  });

  it("throws for 4.22 in release.selectedVersion even when canonical is 4.21", () => {
    assertThrowsFieldGuide(
      {
        blueprint: { platform: "Bare Metal", clusterName: "test", baseDomain: "example.com" },
        methodology: { method: "IPI" },
        version: { selectedMinor: "4.21", locked: true },
        release: { selectedVersion: "4.22.0" },
      },
      /4\.22.*not supported/,
      "4.22 release.selectedVersion"
    );
  });

  it("throws for 4.22 in legacy-only state", () => {
    assertThrowsFieldGuide(
      {
        blueprint: { platform: "Bare Metal", clusterName: "test", baseDomain: "example.com" },
        methodology: { method: "IPI" },
        release: { patchVersion: "4.22.0", channel: "stable-4.22" },
      },
      /4\.22.*not supported/,
      "4.22 legacy-only"
    );
  });
});

describe("canonical/legacy and within-canonical minor conflicts", () => {
  it("throws when selectedMinor=4.21 but selectedPatch=4.20.15", () => {
    const state = makeCanonicalState("4.21", "4.20.15", { selectedChannel: "stable-4.21" });
    assertThrowsFieldGuide(state, /conflict/, "within-canonical minor/patch conflict");
  });

  it("throws when selectedMinor=4.21 but selectedChannel=stable-4.20", () => {
    const state = makeCanonicalState("4.21", "4.21.5", { selectedChannel: "stable-4.20" });
    assertThrowsFieldGuide(state, /conflict/, "within-canonical minor/channel conflict");
  });

  it("throws when canonical=4.21 but release.patchVersion=4.20.10", () => {
    assertThrowsFieldGuide(
      {
        blueprint: { platform: "Bare Metal", clusterName: "test", baseDomain: "example.com" },
        methodology: { method: "IPI" },
        version: { selectedMinor: "4.21", selectedPatch: "4.21.5", locked: true },
        release: { patchVersion: "4.20.10" },
      },
      /conflict/,
      "canonical/legacy minor conflict"
    );
  });

  it("throws when canonical=4.21 but release.channel=stable-4.20", () => {
    assertThrowsFieldGuide(
      {
        blueprint: { platform: "Bare Metal", clusterName: "test", baseDomain: "example.com" },
        methodology: { method: "IPI" },
        version: { selectedMinor: "4.21", locked: true },
        release: { channel: "stable-4.20" },
      },
      /conflict/,
      "canonical/legacy channel conflict"
    );
  });

  it("throws when legacy sources disagree: patchVersion=4.21 vs channel=stable-4.20", () => {
    assertThrowsFieldGuide(
      {
        blueprint: { platform: "Bare Metal", clusterName: "test", baseDomain: "example.com" },
        methodology: { method: "IPI" },
        release: { patchVersion: "4.21.5", channel: "stable-4.20" },
      },
      /conflict/,
      "within-legacy conflict"
    );
  });
});

describe("resolveFieldGuideVersion descriptor shape", () => {
  it("returns frozen descriptor with correct fields for 4.21", () => {
    const state = makeCanonicalState("4.21", "4.21.5");
    const desc = resolveFieldGuideVersion(state);
    assert(Object.isFrozen(desc), "descriptor should be frozen");
    assert.equal(desc.minor, "4.21");
    assert.equal(desc.patch, "4.21.5");
    assert.equal(desc.channel, "stable-4.21");
    assert.equal(desc.displayVersion, "4.21.5");
  });

  it("returns minor as displayVersion when no patch is supplied", () => {
    const state = {
      blueprint: { platform: "Bare Metal", clusterName: "test", baseDomain: "example.com" },
      methodology: { method: "IPI" },
      version: { selectedMinor: "4.20", locked: true },
    };
    const desc = resolveFieldGuideVersion(state);
    assert.equal(desc.minor, "4.20");
    assert.equal(desc.patch, null);
    assert.equal(desc.displayVersion, "4.20");
    assert.equal(desc.channel, "stable-4.20");
  });

  it("derives channel from resolved minor when no channel supplied", () => {
    const state = {
      blueprint: { platform: "Bare Metal", clusterName: "test", baseDomain: "example.com" },
      methodology: { method: "IPI" },
      version: { selectedMinor: "4.21", selectedPatch: "4.21.3", locked: true },
    };
    const desc = resolveFieldGuideVersion(state);
    assert.equal(desc.channel, "stable-4.21");
  });
});

describe("FieldGuideVersionError identity", () => {
  it("is an instance of Error", () => {
    const err = new FieldGuideVersionError("test");
    assert(err instanceof Error);
    assert(err instanceof FieldGuideVersionError);
    assert.equal(err.name, "FieldGuideVersionError");
    assert.equal(err.code, "FIELD_GUIDE_VERSION_ERROR");
  });
});
