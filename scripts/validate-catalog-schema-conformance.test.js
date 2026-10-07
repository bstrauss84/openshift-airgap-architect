"use strict";

/**
 * Schema <-> validator conformance.
 *
 * schema/catalog-parameter-schema.json documents catalog schema v2.0.0, but
 * nothing executes it: scripts/validate-catalog.js implements the rules in code
 * and is what runs in CI. That made the schema decorative and let the two drift
 * silently — the 0A-0 harvest found the schema under-declaring four required
 * fields. This test holds them to each other.
 *
 * It imports the validator's exported CONTRACT rather than restating the rules,
 * so a change to either artifact is detected rather than assumed.
 *
 * Divergences are allowed only when REGISTERED below with a reason and an
 * owning tranche. An unregistered divergence fails. Neither artifact may be
 * weakened to accommodate catalog data; where catalog data is the problem, the
 * divergence is registered against the tranche that owns the data.
 *
 * No network access. Reads only the schema file and the validator module.
 */

const { test, describe } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const { CONTRACT } = require("./validate-catalog.js");

const SCHEMA_PATH = path.join(__dirname, "..", "schema", "catalog-parameter-schema.json");
const schema = JSON.parse(fs.readFileSync(SCHEMA_PATH, "utf-8"));
const paramSchema = schema.properties.parameters.items;

/**
 * Reviewed, deliberate differences between the declared schema and the
 * executable validator.
 *
 * Each entry must say which side is stricter, why the gap exists, and who owns
 * closing it. This register is the thing a reviewer reads; it is not a mute
 * list. Entries should shrink over time.
 */
const DIVERGENCE_REGISTER = [
  {
    id: "type-enum-not-enforced",
    field: "type",
    stricterSide: "schema",
    detail:
      "The schema enumerates type values (string, integer, boolean, array, object, cidr, ipv4, ipv6). " +
      "The validator only requires `type` to be present and concrete; it does not check the value.",
    whyNotClosedNow:
      "Enforcing the enum today would newly fail 194 existing parameters that use the aliases " +
      "`int` (137) and `bool` (57) instead of `integer`/`boolean`. That is catalog data " +
      "normalization, and closing it in 0A-1 would silently change the measured 4.20/4.21 " +
      "data-debt baseline that Tranche 0B is scoped against. The schema is deliberately left " +
      "strict (it describes the target state) rather than widened to accept the aliases.",
    owner: "Tranche 0B (catalog data reconciliation)",
  },
  {
    id: "required-field-accepts-sentinel",
    field: "required",
    stricterSide: "schema",
    detail:
      'The schema declares `required` as a boolean. The validator additionally accepts the ' +
      'sentinel string "not specified in docs".',
    whyNotClosedNow:
      "All 2121 current catalog parameters already carry a boolean, so the sentinel allowance is " +
      "unused in practice. Removing it from the validator is safe but is a validator-behaviour " +
      "change with no 0A-1 driver; it is recorded rather than done opportunistically.",
    owner: "Tranche 0B (may drop the sentinel once data is confirmed clean)",
  },
  {
    id: "outputfile-enum-not-enforced",
    field: "outputFile",
    stricterSide: "schema",
    detail:
      "The schema enumerates outputFile values (install-config.yaml, agent-config.yaml, " +
      "imageset-config.yaml). The validator only requires presence.",
    whyNotClosedNow:
      "Every present value already satisfies the enum; the only failures are the 78 parameters " +
      "missing outputFile entirely, which the validator already reports and which are part of " +
      "the 0B data debt. Enforcement adds nothing until those are fixed.",
    owner: "Tranche 0B (then enforcement can be switched on at zero cost)",
  },
];

const registered = new Set(DIVERGENCE_REGISTER.map((d) => d.field));

describe("catalog schema <-> validator conformance", () => {
  describe("required-field contract", () => {
    test("schema required list exactly equals the validator's enforced required set", () => {
      // The validator requires paramRequired to be present AND non-null, and
      // paramRequiredConcrete to be present (value may be a sentinel). For
      // JSON Schema "required" — which means "the key must be present" — both
      // groups count.
      const validatorRequires = [...CONTRACT.paramRequired, ...CONTRACT.paramRequiredConcrete].sort();
      const schemaRequires = [...paramSchema.required].sort();

      assert.deepStrictEqual(
        schemaRequires,
        validatorRequires,
        "schema/catalog-parameter-schema.json properties.parameters.items.required must list " +
          "exactly the fields scripts/validate-catalog.js requires to be present.\n" +
          `  only in schema   : [${schemaRequires.filter((f) => !validatorRequires.includes(f)).join(", ")}]\n` +
          `  only in validator: [${validatorRequires.filter((f) => !schemaRequires.includes(f)).join(", ")}]`
      );
    });

    test("every required field is actually described in the schema properties", () => {
      for (const field of paramSchema.required) {
        assert.ok(
          Object.prototype.hasOwnProperty.call(paramSchema.properties, field),
          `schema requires "${field}" but does not describe it under properties`
        );
      }
    });

    test("file-level required keys agree", () => {
      assert.deepStrictEqual(
        [...schema.required].sort(),
        [...CONTRACT.fileRequired].sort(),
        "top-level required keys must match the validator's file-level check"
      );
    });
  });

  describe("enumerations", () => {
    test("supportStatus enum matches exactly", () => {
      assert.deepStrictEqual(
        [...paramSchema.properties.supportStatus.enum].sort(),
        [...CONTRACT.supportStatuses].sort(),
        "supportStatus is the field CI treats as fatal; schema and validator must agree exactly"
      );
    });

    test("the CI-fatal supportStatus value is absent from the schema enum", () => {
      assert.ok(
        !paramSchema.properties.supportStatus.enum.includes(CONTRACT.forbiddenSupportStatus),
        `"${CONTRACT.forbiddenSupportStatus}" must never be a schema-valid supportStatus`
      );
    });
  });

  describe("version patterns", () => {
    test("minVersion pattern matches the validator's", () => {
      assert.strictEqual(
        paramSchema.properties.minVersion.pattern,
        CONTRACT.versionPattern.source,
        "minVersion format must be declared identically in both places"
      );
    });

    test("maxVersion permits the same pattern, plus null", () => {
      const variants = paramSchema.properties.maxVersion.oneOf;
      assert.ok(Array.isArray(variants), "maxVersion should be declared as oneOf [pattern, null]");

      const patternVariant = variants.find((v) => v.pattern);
      const nullVariant = variants.find((v) => v.type === "null");

      assert.ok(patternVariant, "maxVersion must declare a version pattern variant");
      assert.strictEqual(patternVariant.pattern, CONTRACT.versionPattern.source);
      assert.ok(nullVariant, "maxVersion must permit null (unbounded)");
      assert.ok(
        CONTRACT.nullableRequired.includes("maxVersion"),
        "the validator must treat maxVersion as present-but-nullable"
      );
    });

    test("the shared version pattern accepts supported and future minors but not patches", () => {
      const re = CONTRACT.versionPattern;
      for (const good of ["4.20", "4.21", "4.22", "4.23"]) {
        assert.ok(re.test(good), `${good} should be a valid minor`);
      }
      for (const bad of ["4.21.15", "v4.21", "latest", "4", "5.0"]) {
        assert.ok(!re.test(bad), `${bad} should not be a valid minor`);
      }
    });
  });

  describe("citations", () => {
    test("citation required sub-fields match", () => {
      const schemaCitation = paramSchema.properties.citations.items;
      assert.deepStrictEqual(
        [...schemaCitation.required].sort(),
        [...CONTRACT.citationRequired].sort(),
        "citation sub-field contract must agree; these drive the 0B citation repair"
      );
    });
  });

  describe("divergence register", () => {
    test("every registered divergence is fully documented", () => {
      for (const d of DIVERGENCE_REGISTER) {
        assert.ok(d.id, "divergence needs an id");
        assert.ok(d.field, `${d.id}: needs a field`);
        assert.ok(["schema", "validator"].includes(d.stricterSide), `${d.id}: needs stricterSide`);
        assert.ok(d.detail && d.detail.length > 40, `${d.id}: needs a substantive detail`);
        assert.ok(
          d.whyNotClosedNow && d.whyNotClosedNow.length > 40,
          `${d.id}: must say why the gap is still open`
        );
        assert.ok(d.owner, `${d.id}: must name an owning tranche`);
      }
    });

    test("registered divergences are the ONLY enum fields the validator leaves unchecked", () => {
      // Any schema-declared enum that the validator does not enforce must be
      // registered. A new one appearing unregistered is the drift this test exists to catch.
      const schemaEnumFields = Object.entries(paramSchema.properties)
        .filter(([, decl]) => Array.isArray(decl.enum))
        .map(([field]) => field);

      // supportStatus is the one enum the validator does enforce.
      const enforcedEnumFields = new Set(["supportStatus"]);

      const unenforced = schemaEnumFields.filter((f) => !enforcedEnumFields.has(f));
      const unregistered = unenforced.filter((f) => !registered.has(f));

      assert.deepStrictEqual(
        unregistered,
        [],
        `schema declares enum(s) for [${unregistered.join(", ")}] that the validator does not ` +
          "enforce and that are not in DIVERGENCE_REGISTER. Either enforce them in " +
          "scripts/validate-catalog.js or register the gap with a reason and an owner."
      );
    });

    test("no divergence is resolved by having weakened the schema", () => {
      // Guards the failure mode the plan forbids: making things agree by
      // loosening the documented contract to match imperfect data.
      assert.ok(
        !paramSchema.properties.type.enum.includes("int"),
        "schema type enum must not be widened to accept the `int` alias; normalize the data in 0B"
      );
      assert.ok(
        !paramSchema.properties.type.enum.includes("bool"),
        "schema type enum must not be widened to accept the `bool` alias; normalize the data in 0B"
      );
    });
  });

  describe("schema self-consistency", () => {
    test("declares its enforcement model so the file is not mistaken for executable", () => {
      assert.ok(schema.enforcement, "schema must document how it is enforced");
      assert.strictEqual(schema.enforcement.executableValidator, "scripts/validate-catalog.js");
      assert.strictEqual(
        schema.enforcement.conformanceTest,
        "scripts/validate-catalog-schema-conformance.test.js"
      );
    });

    test("does not pin itself to a single minor", () => {
      assert.ok(
        !/data\/params\/4\.\d+\//.test(schema.description),
        "schema description must use <minor>, not a specific minor directory"
      );
    });
  });
});
