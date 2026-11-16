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
import { SUPPORTED_MINORS } from "../src/versionPolicy.js";

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
  it("contains exactly 4.20, 4.21 and 4.22", () => {
    assert.deepStrictEqual(
      [...FIELD_GUIDE_SUPPORTED_MINORS],
      ["4.20", "4.21", "4.22"]
    );
  });

  it("equals the product support list — a separate declaration that must not drift", () => {
    // S3 is its own constant, so it CAN diverge from SUPPORTED_MINORS. A Field
    // Guide that rejects a supported minor, or accepts an unsupported one, is a
    // half-flip; this is the assertion that makes the two move together.
    assert.deepStrictEqual([...FIELD_GUIDE_SUPPORTED_MINORS], [...SUPPORTED_MINORS]);
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

describe("unsupported 4.23 in each source category", () => {
  it("throws for 4.23 in version.selectedMinor", () => {
    const state = makeCanonicalState("4.23", "4.23.0", { selectedChannel: "stable-4.23" });
    assertThrowsFieldGuide(state, /4\.23.*not supported/, "4.23 selectedMinor");
  });

  it("throws for 4.23 in version.selectedPatch", () => {
    const state = makeCanonicalState("4.21", "4.23.0", { selectedChannel: "stable-4.21" });
    state.version.selectedMinor = "4.21";
    state.version.selectedPatch = "4.23.0";
    assertThrowsFieldGuide(state, /4\.23.*not supported/, "4.23 selectedPatch");
  });

  it("throws for 4.23 in version.selectedChannel", () => {
    const state = makeCanonicalState("4.21", "4.21.5", { selectedChannel: "stable-4.23" });
    assertThrowsFieldGuide(state, /4\.23.*not supported/, "4.23 selectedChannel");
  });

  it("throws for 4.23 in release.patchVersion even when canonical is 4.21", () => {
    assertThrowsFieldGuide(
      {
        blueprint: { platform: "Bare Metal", clusterName: "test", baseDomain: "example.com" },
        methodology: { method: "IPI" },
        version: { selectedMinor: "4.21", locked: true },
        release: { patchVersion: "4.23.0" },
      },
      /4\.23.*not supported/,
      "4.23 release.patchVersion"
    );
  });

  it("throws for 4.23 in release.channel even when canonical is 4.21", () => {
    assertThrowsFieldGuide(
      {
        blueprint: { platform: "Bare Metal", clusterName: "test", baseDomain: "example.com" },
        methodology: { method: "IPI" },
        version: { selectedMinor: "4.21", locked: true },
        release: { channel: "stable-4.23" },
      },
      /4\.23.*not supported/,
      "4.23 release.channel"
    );
  });

  it("throws for 4.23 in version.selectedVersion even when canonical is 4.21", () => {
    assertThrowsFieldGuide(
      {
        blueprint: { platform: "Bare Metal", clusterName: "test", baseDomain: "example.com" },
        methodology: { method: "IPI" },
        version: { selectedMinor: "4.21", selectedVersion: "4.23.0", locked: true },
        release: {},
      },
      /4\.23.*not supported/,
      "4.23 version.selectedVersion"
    );
  });

  it("throws for 4.23 in release.selectedVersion even when canonical is 4.21", () => {
    assertThrowsFieldGuide(
      {
        blueprint: { platform: "Bare Metal", clusterName: "test", baseDomain: "example.com" },
        methodology: { method: "IPI" },
        version: { selectedMinor: "4.21", locked: true },
        release: { selectedVersion: "4.23.0" },
      },
      /4\.23.*not supported/,
      "4.23 release.selectedVersion"
    );
  });

  it("throws for 4.23 in legacy-only state", () => {
    assertThrowsFieldGuide(
      {
        blueprint: { platform: "Bare Metal", clusterName: "test", baseDomain: "example.com" },
        methodology: { method: "IPI" },
        release: { patchVersion: "4.23.0", channel: "stable-4.23" },
      },
      /4\.23.*not supported/,
      "4.23 legacy-only"
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

// --- M03: Deterministic 4.23 rejection — production boundary evidence ---

describe("M03: deterministic 4.23 rejection — production boundary evidence", () => {
  const assertRejectsUnsupported = (state, label) => {
    let returned;
    try {
      returned = buildFieldGuide(state);
    } catch (err) {
      assert(err instanceof FieldGuideVersionError,
        `${label}: expected FieldGuideVersionError, got ${err.name}: ${err.message}`);
      assert.equal(err.code, 'FIELD_GUIDE_VERSION_ERROR',
        `${label}: wrong error code`);
      assert.match(err.message, /not supported/i,
        `${label}: error should indicate unsupported`);
      return;
    }
    assert.fail(
      `${label}: expected rejection but got: ${typeof returned === 'string' ? returned.substring(0, 80) + '...' : returned}`
    );
  };

  // --- Canonical locked single-source isolation ---

  it("rejects sole version.selectedMinor='4.23' (locked)", () => {
    assertRejectsUnsupported(
      { version: { selectedMinor: "4.23", locked: true } },
      "sole selectedMinor"
    );
  });

  it("rejects sole version.selectedPatch='4.23.0' (locked)", () => {
    assertRejectsUnsupported(
      { version: { selectedPatch: "4.23.0", locked: true } },
      "sole selectedPatch"
    );
  });

  it("rejects sole version.selectedChannel='stable-4.23' (locked)", () => {
    assertRejectsUnsupported(
      { version: { selectedChannel: "stable-4.23", locked: true } },
      "sole selectedChannel"
    );
  });

  // --- Legacy-only single-source isolation ---

  it("rejects sole release.patchVersion='4.23.0'", () => {
    assertRejectsUnsupported(
      { release: { patchVersion: "4.23.0" } },
      "sole release.patchVersion"
    );
  });

  it("rejects sole release.channel='stable-4.23'", () => {
    assertRejectsUnsupported(
      { release: { channel: "stable-4.23" } },
      "sole release.channel"
    );
  });

  it("rejects sole version.selectedVersion='4.23.0' without canonical state", () => {
    assertRejectsUnsupported(
      { version: { selectedVersion: "4.23.0" } },
      "sole version.selectedVersion"
    );
  });

  it("rejects sole release.selectedVersion='4.23.0'", () => {
    assertRejectsUnsupported(
      { release: { selectedVersion: "4.23.0" } },
      "sole release.selectedVersion"
    );
  });

  // --- Fail-closed: supported + unsupported coexistence, position-independent ---

  it("rejects when all prior sources=4.21 but release.selectedVersion=4.23 (last source)", () => {
    assertRejectsUnsupported({
      version: { selectedMinor: "4.21", selectedPatch: "4.21.5", selectedChannel: "stable-4.21", locked: true },
      release: { patchVersion: "4.21.5", channel: "stable-4.21", selectedVersion: "4.23.0" },
    }, "4.23 in last-checked source");
  });

  it("rejects when selectedMinor=4.23 but all other sources=4.21 (first source)", () => {
    assertRejectsUnsupported({
      version: { selectedMinor: "4.23", selectedPatch: "4.21.5", selectedChannel: "stable-4.21", locked: true },
      release: { patchVersion: "4.21.5", channel: "stable-4.21" },
    }, "4.23 in first-checked source");
  });

  it("rejects when only selectedChannel=stable-4.23 among supported sources (middle)", () => {
    assertRejectsUnsupported({
      version: { selectedMinor: "4.21", selectedPatch: "4.21.5", selectedChannel: "stable-4.23", locked: true },
      release: { patchVersion: "4.21.5" },
    }, "4.23 in middle-checked source");
  });

  // --- No fallback, no partial markdown ---

  it("buildFieldGuide returns no markdown for 4.23 canonical locked state", () => {
    let returned;
    let error;
    try {
      returned = buildFieldGuide(makeCanonicalState("4.23", "4.23.0", { selectedChannel: "stable-4.23" }));
    } catch (err) {
      error = err;
    }
    assert(error, "should have thrown");
    assert(returned === undefined, `no markdown should be assigned, got ${typeof returned}`);
    assert(error instanceof FieldGuideVersionError, "should be FieldGuideVersionError");
  });

  it("resolveFieldGuideVersion throws FieldGuideVersionError for 4.23, not a descriptor", () => {
    let descriptor;
    let error;
    try {
      descriptor = resolveFieldGuideVersion({ version: { selectedMinor: "4.23", locked: true } });
    } catch (err) {
      error = err;
    }
    assert(error, "should have thrown");
    assert(descriptor === undefined, "no descriptor should be returned");
    assert(error instanceof FieldGuideVersionError);
    assert.equal(error.code, 'FIELD_GUIDE_VERSION_ERROR');
  });

  // --- Positive controls: every supported minor produces its OWN markdown ---
  // Cross-minor leakage is the real hazard, so each control also asserts that
  // no OTHER supported minor's version string appears in the output.

  for (const [minor, patch] of [["4.20", "4.20.15"], ["4.21", "4.21.5"], ["4.22", "4.22.16"]]) {
    it(`${minor} locked canonical produces valid markdown with no other minor's content`, () => {
      const md = buildFieldGuide(makeCanonicalState(minor, patch));
      assert.equal(typeof md, "string");
      assert(md.length > 100, "should produce substantial output");
      assert(md.includes(minor), `should reference ${minor}`);
      // A guide may cite an OLDER minor as provenance ("bmcVerifyCA is available
      // in OpenShift 4.21 and later" is correct in the 4.22 guide). What it must
      // never do is name a NEWER minor, which would mean content from a release
      // this guide does not describe leaked in.
      for (const newer of ["4.20", "4.21", "4.22", "4.23"].filter((m) => m > minor)) {
        assert(!md.includes(newer), `${minor} guide must not contain newer minor ${newer}`);
      }
    });
  }

  // --- Missing/unlocked/incoherent state: error identity proves no silent 4.20 fallback ---

  it("null state throws FieldGuideVersionError, not silent 4.20 fallback", () => {
    assert.throws(
      () => resolveFieldGuideVersion(null),
      (err) => err instanceof FieldGuideVersionError
    );
  });

  it("empty state throws FieldGuideVersionError, not silent 4.20 fallback", () => {
    assert.throws(
      () => resolveFieldGuideVersion({}),
      (err) => err instanceof FieldGuideVersionError
    );
  });

  it("unlocked canonical throws FieldGuideVersionError, not silent 4.20 fallback", () => {
    assert.throws(
      () => resolveFieldGuideVersion({ version: { selectedMinor: "4.21", locked: false } }),
      (err) => err instanceof FieldGuideVersionError
    );
  });

  it("locked but no version fields throws FieldGuideVersionError, not silent 4.20 fallback", () => {
    assert.throws(
      () => resolveFieldGuideVersion({ version: { locked: true } }),
      (err) => err instanceof FieldGuideVersionError
    );
  });
});
