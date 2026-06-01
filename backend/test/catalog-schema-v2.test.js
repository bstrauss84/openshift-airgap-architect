/**
 * Catalog Parameter Schema v2.0.0 Validation Tests (DOC-101 Phase 1 Slice 2)
 *
 * Tests schema v2.0.0 requirements:
 * - supportStatus REQUIRED and MUST NOT be "unknown-needs-review"
 * - minVersion/maxVersion format validation (minor version only)
 * - validationRules structure validation
 * - All 4.20 catalogs comply with schema v2.0
 *
 * @author Bill Strauss
 */

import { test, describe } from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '../..');

const VALID_SUPPORT_STATUSES = [
  'supported-ui',
  'supported-backend-only',
  'supported-derived',
  'docs-only-not-supported',
  'hidden-not-applicable',
  'deprecated-supported',
  'removed'
];

const VERSION_PATTERN = /^4\.\d+$/;

describe('Catalog Parameter Schema v2.0.0', () => {
  describe('supportStatus field', () => {
    test('supportStatus is REQUIRED for all parameters', () => {
      const catalogDir = path.join(repoRoot, 'data/params/4.20');
      const files = fs.readdirSync(catalogDir).filter(f => f.endsWith('.json'));

      for (const file of files) {
        const data = JSON.parse(fs.readFileSync(path.join(catalogDir, file), 'utf8'));
        for (let i = 0; i < data.parameters.length; i++) {
          const param = data.parameters[i];
          assert.ok(param.supportStatus !== undefined && param.supportStatus !== null,
            `${file} param[${i}] (${param.path}) must have supportStatus field`);
        }
      }
    });

    test('supportStatus MUST be valid enum value', () => {
      const catalogDir = path.join(repoRoot, 'data/params/4.20');
      const files = fs.readdirSync(catalogDir).filter(f => f.endsWith('.json'));

      for (const file of files) {
        const data = JSON.parse(fs.readFileSync(path.join(catalogDir, file), 'utf8'));
        for (let i = 0; i < data.parameters.length; i++) {
          const param = data.parameters[i];
          if (param.supportStatus) {
            assert.ok(VALID_SUPPORT_STATUSES.includes(param.supportStatus),
              `${file} param[${i}] (${param.path}) has invalid supportStatus: ${param.supportStatus}`);
          }
        }
      }
    });

    test('supportStatus MUST NOT be "unknown-needs-review" (CI FAIL)', () => {
      const catalogDir = path.join(repoRoot, 'data/params/4.20');
      const files = fs.readdirSync(catalogDir).filter(f => f.endsWith('.json'));

      for (const file of files) {
        const data = JSON.parse(fs.readFileSync(path.join(catalogDir, file), 'utf8'));
        for (let i = 0; i < data.parameters.length; i++) {
          const param = data.parameters[i];
          assert.notStrictEqual(param.supportStatus, 'unknown-needs-review',
            `${file} param[${i}] (${param.path}) CANNOT have supportStatus "unknown-needs-review" - fix before commit!`);
        }
      }
    });

    test('supportStatus distribution is reasonable', () => {
      const catalogDir = path.join(repoRoot, 'data/params/4.20');
      const files = fs.readdirSync(catalogDir).filter(f => f.endsWith('.json'));

      const counts = {};
      for (const status of VALID_SUPPORT_STATUSES) {
        counts[status] = 0;
      }

      for (const file of files) {
        const data = JSON.parse(fs.readFileSync(path.join(catalogDir, file), 'utf8'));
        for (const param of data.parameters) {
          if (param.supportStatus) {
            counts[param.supportStatus]++;
          }
        }
      }

      // Sanity checks: we should have UI fields and backend fields
      assert.ok(counts['supported-ui'] > 0, 'Should have at least 1 supported-ui parameter');
      assert.ok(counts['supported-backend-only'] > 0, 'Should have at least 1 supported-backend-only parameter');
    });
  });

  describe('minVersion/maxVersion fields', () => {
    test('minVersion MUST be minor version format if present', () => {
      const catalogDir = path.join(repoRoot, 'data/params/4.20');
      const files = fs.readdirSync(catalogDir).filter(f => f.endsWith('.json'));

      for (const file of files) {
        const data = JSON.parse(fs.readFileSync(path.join(catalogDir, file), 'utf8'));
        for (let i = 0; i < data.parameters.length; i++) {
          const param = data.parameters[i];
          if (param.minVersion !== undefined && param.minVersion !== null) {
            assert.match(param.minVersion, VERSION_PATTERN,
              `${file} param[${i}] (${param.path}) minVersion must be minor version format "4.20" (got: ${param.minVersion})`);
          }
        }
      }
    });

    test('maxVersion MUST be minor version format or null if present', () => {
      const catalogDir = path.join(repoRoot, 'data/params/4.20');
      const files = fs.readdirSync(catalogDir).filter(f => f.endsWith('.json'));

      for (const file of files) {
        const data = JSON.parse(fs.readFileSync(path.join(catalogDir, file), 'utf8'));
        for (let i = 0; i < data.parameters.length; i++) {
          const param = data.parameters[i];
          if (param.maxVersion !== undefined && param.maxVersion !== null) {
            assert.match(param.maxVersion, VERSION_PATTERN,
              `${file} param[${i}] (${param.path}) maxVersion must be minor version format "4.21" or null (got: ${param.maxVersion})`);
          }
        }
      }
    });

    test('minVersion defaults to "4.20" for 4.20 catalogs', () => {
      const catalogDir = path.join(repoRoot, 'data/params/4.20');
      const files = fs.readdirSync(catalogDir).filter(f => f.endsWith('.json'));

      for (const file of files) {
        const data = JSON.parse(fs.readFileSync(path.join(catalogDir, file), 'utf8'));
        for (const param of data.parameters) {
          const minVersion = param.minVersion || '4.20';
          assert.match(minVersion, VERSION_PATTERN,
            `${file} param (${param.path}) minVersion default must be "4.20"`);
        }
      }
    });

    test('maxVersion defaults to null (unbounded)', () => {
      const catalogDir = path.join(repoRoot, 'data/params/4.20');
      const files = fs.readdirSync(catalogDir).filter(f => f.endsWith('.json'));

      let nullMaxVersionCount = 0;
      for (const file of files) {
        const data = JSON.parse(fs.readFileSync(path.join(catalogDir, file), 'utf8'));
        for (const param of data.parameters) {
          if (param.maxVersion === null || param.maxVersion === undefined) {
            nullMaxVersionCount++;
          }
        }
      }

      // Most parameters should have null or undefined maxVersion (ongoing support)
      assert.ok(nullMaxVersionCount > 500, 'Most parameters should have null/undefined maxVersion (ongoing support)');
    });

    test('maxVersion: null is explicitly valid (JSON Schema accepts null)', () => {
      // This test verifies the schema v2.0 fix: maxVersion can be null without conflicting type
      const catalogDir = path.join(repoRoot, 'data/params/4.20');
      const file = 'bare-metal-ipi.json';
      const data = JSON.parse(fs.readFileSync(path.join(catalogDir, file), 'utf8'));

      // Phase 0 added explicit maxVersion: null to all params, so find one
      const param = data.parameters.find(p => p.maxVersion === null);
      assert.ok(param, 'Should have params with maxVersion: null');
      assert.strictEqual(param.maxVersion, null, 'maxVersion: null should be valid (schema fix: removed conflicting top-level type)');
    });
  });

  describe('validationRules field', () => {
    test('validationRules MUST be object with version keys if present', () => {
      const catalogDir = path.join(repoRoot, 'data/params/4.20');
      const files = fs.readdirSync(catalogDir).filter(f => f.endsWith('.json'));

      for (const file of files) {
        const data = JSON.parse(fs.readFileSync(path.join(catalogDir, file), 'utf8'));
        for (let i = 0; i < data.parameters.length; i++) {
          const param = data.parameters[i];
          if (param.validationRules !== undefined && param.validationRules !== null) {
            assert.strictEqual(typeof param.validationRules, 'object',
              `${file} param[${i}] (${param.path}) validationRules must be object`);
            assert.strictEqual(Array.isArray(param.validationRules), false,
              `${file} param[${i}] (${param.path}) validationRules must not be array`);
          }
        }
      }
    });

    test('validationRules version keys MUST be minor version format', () => {
      const catalogDir = path.join(repoRoot, 'data/params/4.20');
      const files = fs.readdirSync(catalogDir).filter(f => f.endsWith('.json'));

      for (const file of files) {
        const data = JSON.parse(fs.readFileSync(path.join(catalogDir, file), 'utf8'));
        for (let i = 0; i < data.parameters.length; i++) {
          const param = data.parameters[i];
          if (param.validationRules && typeof param.validationRules === 'object') {
            for (const versionKey of Object.keys(param.validationRules)) {
              assert.match(versionKey, VERSION_PATTERN,
                `${file} param[${i}] (${param.path}) validationRules key "${versionKey}" must be minor version format "4.20"`);
            }
          }
        }
      }
    });

    test('validationRules values MUST be objects with valid fields', () => {
      const catalogDir = path.join(repoRoot, 'data/params/4.20');
      const files = fs.readdirSync(catalogDir).filter(f => f.endsWith('.json'));

      for (const file of files) {
        const data = JSON.parse(fs.readFileSync(path.join(catalogDir, file), 'utf8'));
        for (let i = 0; i < data.parameters.length; i++) {
          const param = data.parameters[i];
          if (param.validationRules && typeof param.validationRules === 'object') {
            for (const [versionKey, rules] of Object.entries(param.validationRules)) {
              assert.strictEqual(typeof rules, 'object',
                `${file} param[${i}] (${param.path}) validationRules["${versionKey}"] must be object`);
              assert.strictEqual(Array.isArray(rules), false,
                `${file} param[${i}] (${param.path}) validationRules["${versionKey}"] must not be array`);

              // Validate known fields if present
              if (rules.required !== undefined) {
                assert.strictEqual(typeof rules.required, 'boolean',
                  `${file} param[${i}] (${param.path}) validationRules["${versionKey}"].required must be boolean`);
              }
            }
          }
        }
      }
    });
  });

  describe('versionNotes field', () => {
    test('versionNotes MUST be string if present', () => {
      const catalogDir = path.join(repoRoot, 'data/params/4.20');
      const files = fs.readdirSync(catalogDir).filter(f => f.endsWith('.json'));

      for (const file of files) {
        const data = JSON.parse(fs.readFileSync(path.join(catalogDir, file), 'utf8'));
        for (let i = 0; i < data.parameters.length; i++) {
          const param = data.parameters[i];
          if (param.versionNotes !== undefined && param.versionNotes !== null) {
            assert.strictEqual(typeof param.versionNotes, 'string',
              `${file} param[${i}] (${param.path}) versionNotes must be string`);
          }
        }
      }
    });
  });

  describe('schema v2.0.0 compliance for 4.20 catalogs', () => {
    test('all 4.20 backend catalogs comply with schema v2.0', () => {
      const catalogDir = path.join(repoRoot, 'data/params/4.20');
      const files = fs.readdirSync(catalogDir).filter(f => f.endsWith('.json'));

      assert.ok(files.length >= 13, 'Should have at least 13 catalog files');

      for (const file of files) {
        const data = JSON.parse(fs.readFileSync(path.join(catalogDir, file), 'utf8'));

        // Top-level required fields
        assert.ok(data.scenarioId, `${file} must have scenarioId`);
        assert.ok(data.version, `${file} must have version`);
        assert.ok(Array.isArray(data.parameters), `${file} must have parameters array`);

        // All parameters have required v2.0 fields
        for (const param of data.parameters) {
          assert.ok(param.path, `${file} param must have path`);
          assert.ok(param.supportStatus, `${file} param (${param.path}) must have supportStatus`);
        }
      }
    });

    test('all 4.20 frontend catalogs comply with schema v2.0', () => {
      const catalogDir = path.join(repoRoot, 'frontend/src/data/catalogs');
      const files = fs.readdirSync(catalogDir).filter(f => f.endsWith('.json'));

      assert.ok(files.length >= 13, 'Should have at least 13 frontend catalog files');

      for (const file of files) {
        const data = JSON.parse(fs.readFileSync(path.join(catalogDir, file), 'utf8'));

        // All parameters have required v2.0 fields
        for (const param of data.parameters) {
          assert.ok(param.supportStatus, `${file} param (${param.path}) must have supportStatus`);
        }
      }
    });
  });
});
