/**
 * v2.2.0 M4 / DOC-166 — the shared ImageSetConfiguration validator against
 * real evidence, not invented expectations:
 *
 *  - binary-probes.json: 37 documents with the verdict of the exact global
 *    oc-mirror binary (4.22.19, ed9ff0d). Architect must reject everything the
 *    binary rejects, and every place where Architect is STRICTER than the
 *    binary must be attributed to a documented Architect rule.
 *  - genuine.json: unmodified ImageSetConfigurations from the Red Hat 4.22
 *    documentation and from openshift/oc-mirror itself.
 *  - parser bounds (size, encoding, depth, aliases, tags, documents) and the
 *    credential-redaction contract.
 */
import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  validateImageSetConfigText,
  validateImageSetConfigDocument,
  parseImageSetConfigText,
  loadImageSetConfigSchema,
  _resetImageSetSchemaCacheForTests,
  ImageSetSchemaUnavailableError,
  MAX_IMAGESET_CONFIG_BYTES,
  MAX_YAML_ALIASES
} from "../src/imagesetConfigValidator.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FX = path.join(__dirname, "fixtures", "imageset-config");
const probes = JSON.parse(fs.readFileSync(path.join(FX, "binary-probes.json"), "utf8")).probes;
const genuine = JSON.parse(fs.readFileSync(path.join(FX, "genuine.json"), "utf8")).files;
const codes = (r) => r.errors.map((e) => e.code);

describe("parity with the exact oc-mirror binary (probe fixtures)", () => {
  test("the fixture set is non-trivial and covers each binary verdict", () => {
    assert.ok(probes.length >= 35);
    const verdicts = new Set(probes.map((p) => p.binary.verdict));
    assert.deepEqual([...verdicts].sort(), ["accepted", "decoded-then-failed-at-run", "rejected"]);
  });

  for (const probe of probes) {
    test(`${probe.id}: binary ${probe.binary.verdict} -> Architect ${probe.architect.verdict}${probe.architect.code ? ` (${probe.architect.code})` : ""}`, () => {
      const r = validateImageSetConfigText(probe.yaml);
      if (probe.binary.verdict === "rejected") assert.equal(r.ok, false, "never accept what oc-mirror rejects");
      if (probe.architect.verdict === "valid") {
        assert.equal(r.ok, true, JSON.stringify(r.errors));
        if (probe.architect.code) assert.ok(r.warnings.some((w) => w.code === probe.architect.code), JSON.stringify(r.warnings));
      } else {
        assert.equal(r.ok, false);
        assert.equal(r.stage, probe.architect.verdict === "parse" ? "parse" : "structure");
        assert.ok(codes(r).includes(probe.architect.code), `expected ${probe.architect.code}, got ${codes(r).join(",")}`);
      }
      // Stricter than the binary => it must be a documented Architect rule.
      if (probe.binary.verdict !== "rejected" && !r.ok && r.stage === "structure") {
        assert.ok(r.errors.some((e) => e.authority === "architect" || e.authority === "binary-at-run"),
          `${probe.id}: refused although oc-mirror loads it, without an architect or binary-at-run finding`);
        assert.ok(r.errors.every((e) => e.authority !== "binary"), `${probe.id}: claims oc-mirror refuses it at load, which the probe disproves`);
      }
    });
  }

  test("every finding names a rule recorded in the schema", () => {
    const ruleIds = new Set(loadImageSetConfigSchema().rules.map((r) => r.id));
    for (const probe of probes) {
      const r = validateImageSetConfigText(probe.yaml);
      for (const f of [...r.errors, ...r.warnings]) if (f.rule) assert.ok(ruleIds.has(f.rule), `${probe.id}: rule ${f.rule} is not in the schema`);
    }
  });
});

describe("genuine ImageSetConfigurations", () => {
  for (const g of genuine) {
    test(`${g.file} (${g.binary.verdict})`, () => {
      const text = fs.readFileSync(path.join(FX, g.file), "utf8");
      const r = validateImageSetConfigText(text);
      if (g.binary.verdict === "rejected") {
        assert.equal(r.ok, false);
        // The 4.22 docs still show oc-mirror v1 examples: storageConfig is v1-only.
        if (/storageConfig/.test(text)) assert.ok(r.errors.some((e) => e.path === "storageConfig" && e.code === "UNKNOWN_FIELD"));
      } else {
        assert.equal(r.ok, true, `${g.file}: ${JSON.stringify(r.errors)}`);
      }
    });
  }

  test("upstream test data: lowercase keys are read as the documented keys, with warnings", () => {
    const r = validateImageSetConfigText(fs.readFileSync(path.join(FX, "genuine", "u1-upstream-testdata-valid.yaml"), "utf8"));
    assert.equal(r.ok, true);
    assert.ok(r.normalized.mirror.additionalImages, "normalized to additionalImages");
    assert.ok(r.normalized.mirror.blockedImages, "normalized to blockedImages");
    assert.ok(r.warnings.some((w) => w.code === "KEY_CASE" && w.path === "mirror.additionalimages"));
    assert.ok(r.warnings.some((w) => w.code === "SHORT_IMAGE_NAME"), "redhat-operators:v4.7 resolves to Docker Hub");
  });
});

describe("bounded parsing", () => {
  test("size limit", () => {
    const big = `apiVersion: mirror.openshift.io/v2alpha1\nkind: ImageSetConfiguration\n# ${"x".repeat(MAX_IMAGESET_CONFIG_BYTES)}\nmirror: {}\n`;
    assert.equal(parseImageSetConfigText(big).errors[0].code, "TOO_LARGE");
  });
  test("encoding: invalid UTF-8, UTF-16 and control characters are refused; a UTF-8 BOM is fine", () => {
    assert.equal(parseImageSetConfigText(Buffer.from([0x6b, 0x69, 0x6e, 0x64, 0x3a, 0x20, 0xff, 0xfe])).errors[0].code, "ENCODING");
    const utf16 = Buffer.from("﻿kind: ImageSetConfiguration\n", "utf16le");
    assert.ok(["ENCODING", "CONTROL_CHARACTER"].includes(parseImageSetConfigText(utf16).errors[0].code));
    assert.equal(parseImageSetConfigText("kind: x\u0001\n").errors[0].code, "CONTROL_CHARACTER");
    const bom = "﻿apiVersion: mirror.openshift.io/v2alpha1\nkind: ImageSetConfiguration\nmirror:\n  additionalImages:\n  - name: quay.io/a/b:1\n";
    assert.equal(validateImageSetConfigText(bom).ok, true);
  });
  test("nesting depth", () => {
    assert.equal(parseImageSetConfigText(`a: ${"[".repeat(40)}${"]".repeat(40)}\n`).errors[0].code, "TOO_DEEP");
  });
  test("aliases: a few are fine, more than the bound are refused, expansion bombs are refused", () => {
    const few = "apiVersion: mirror.openshift.io/v2alpha1\nkind: ImageSetConfiguration\nmirror:\n  additionalImages:\n  - &i {name: quay.io/a/b:1}\n";
    assert.equal(parseImageSetConfigText(few).ok, true);
    const many = `x: &a 1\nl: [${Array.from({ length: MAX_YAML_ALIASES + 1 }, () => "*a").join(", ")}]\n`;
    assert.equal(parseImageSetConfigText(many).errors[0].code, "TOO_MANY_ALIASES");
    // Billion-laughs shape inside the alias count: 20 aliases expand 300 values to 30000.
    let bomb = `a0: &a0 [${Array.from({ length: 300 }, () => "x").join(", ")}]\n`;
    for (let i = 1; i <= 2; i += 1) bomb += `a${i}: &a${i} [${Array.from({ length: 10 }, () => `*a${i - 1}`).join(", ")}]\n`;
    const r = parseImageSetConfigText(bomb);
    assert.ok(!r.ok && ["TOO_MANY_ALIASES", "TOO_MANY_NODES"].includes(r.errors[0].code));
  });
  test("unsupported YAML tags and non-mapping documents", () => {
    assert.equal(parseImageSetConfigText("a: !!set {x}\n").errors[0].code, "UNSUPPORTED_TAG");
    assert.equal(parseImageSetConfigText("a: !custom x\n").errors[0].code, "UNSUPPORTED_TAG");
    assert.equal(parseImageSetConfigText("- a\n- b\n").errors[0].code, "NOT_A_MAPPING");
    assert.equal(parseImageSetConfigText("").errors[0].code, "EMPTY_FILE");
    assert.equal(parseImageSetConfigText("# only a comment\n").errors[0].code, "EMPTY_FILE");
  });
  test("malformed YAML reports a line", () => {
    const r = parseImageSetConfigText("kind: ImageSetConfiguration\nmirror:\n  additionalImages: [\n");
    assert.equal(r.errors[0].code, "INVALID_YAML");
    assert.ok(Number.isInteger(r.errors[0].line));
  });
  test("the original bytes are hashed", () => {
    const r = parseImageSetConfigText("kind: ImageSetConfiguration\n");
    assert.match(r.meta.sha256, /^[a-f0-9]{64}$/);
  });
});

describe("credentials are refused and never echoed", () => {
  test("a helm repository URL with user:password is an error that does not contain the password", () => {
    const secret = "S3cr3tValue";
    const yamlText = `apiVersion: mirror.openshift.io/v2alpha1\nkind: ImageSetConfiguration\nmirror:\n  helm:\n    repositories:\n    - name: r\n      url: https://alice:${secret}@charts.example.com/\n      charts:\n      - name: c\n`;
    const r = validateImageSetConfigText(yamlText);
    assert.equal(r.ok, false);
    assert.ok(codes(r).includes("CREDENTIALS_IN_URL"));
    assert.doesNotMatch(JSON.stringify(r.errors), new RegExp(secret));
  });
  test("an invalid value with credentials is described with them redacted", () => {
    const r = validateImageSetConfigText("apiVersion: https://bob:hunter2@example.com/x\nkind: ImageSetConfiguration\nmirror:\n  additionalImages:\n  - name: quay.io/a/b:1\n");
    assert.doesNotMatch(JSON.stringify(r.errors), /hunter2/);
  });
});

describe("the schema is the single, complete authority", () => {
  test("typed fields and the path list describe exactly the same keys; rejected paths are not fields", () => {
    const s = loadImageSetConfigSchema();
    assert.deepEqual(Object.keys(s.fields).sort(), [...s.paths].sort());
    for (const bad of Object.keys(s.rejectedPaths)) assert.ok(!(bad in s.fields), bad);
    for (const [p, spec] of Object.entries(s.fields)) assert.ok(s.fieldTypes[spec.type], `${p}: unknown type ${spec.type}`);
  });

  test("structural validation is not vacuous: every field type is enforced", () => {
    const base = { apiVersion: "mirror.openshift.io/v2alpha1", kind: "ImageSetConfiguration", mirror: { additionalImages: [{ name: "quay.io/a/b:1" }] } };
    const bad = [
      [{ ...base, archiveSize: "8" }, "archiveSize"],
      [{ ...base, mirror: { ...base.mirror, platform: { channels: "stable-4.22" } } }, "mirror.platform.channels"],
      [{ ...base, mirror: { ...base.mirror, platform: { architectures: [1], channels: [{ name: "stable-4.22" }] } } }, "mirror.platform.architectures[0]"],
      [{ ...base, mirror: { ...base.mirror, operators: [{ catalog: "registry.redhat.io/redhat/redhat-operator-index:v4.22", full: "yes" }] } }, "mirror.operators[0].full"],
      [{ ...base, mirror: { ...base.mirror, operators: [{ catalog: "registry.redhat.io/redhat/redhat-operator-index:v4.22", packages: [{ name: "x", channels: [{ name: "fast", minVersion: 1.0 }] }] }] } }, "mirror.operators[0].packages[0].channels[0].minVersion"]
    ];
    for (const [doc, where] of bad) {
      const r = validateImageSetConfigDocument(doc);
      assert.equal(r.valid, false, where);
      assert.ok(r.errors.some((e) => e.path === where && e.code === "WRONG_TYPE"), `${where}: ${JSON.stringify(r.errors)}`);
    }
    assert.equal(validateImageSetConfigDocument(base).valid, true);
  });

  test("a rejected path suggests the correct one (FQ-9 includeConfig)", () => {
    const r = validateImageSetConfigText("apiVersion: mirror.openshift.io/v2alpha1\nkind: ImageSetConfiguration\nmirror:\n  operators:\n  - catalog: registry.redhat.io/redhat/redhat-operator-index:v4.22\n    packages:\n    - name: odf-operator\n      channels:\n      - name: stable-4.22\n        includeConfig:\n          minVersion: 4.22.0\n");
    const f = r.errors.find((e) => e.code === "UNKNOWN_FIELD");
    assert.match(f.message, /minVersion/);
  });

  test("fails closed when the authority is missing", () => {
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), "oaa-no-schema-"));
    const prev = process.env.OAA_CANONICAL_DATA_DIR;
    process.env.OAA_CANONICAL_DATA_DIR = empty;
    _resetImageSetSchemaCacheForTests();
    try {
      assert.throws(() => validateImageSetConfigText("kind: ImageSetConfiguration\nmirror: {}\n"), ImageSetSchemaUnavailableError);
    } finally {
      if (prev === undefined) delete process.env.OAA_CANONICAL_DATA_DIR; else process.env.OAA_CANONICAL_DATA_DIR = prev;
      _resetImageSetSchemaCacheForTests();
    }
  });
});

after(() => _resetImageSetSchemaCacheForTests());
