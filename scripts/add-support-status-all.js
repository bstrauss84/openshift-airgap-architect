#!/usr/bin/env node
/**
 * scripts/add-support-status-all.js
 * Phase 0: Add supportStatus to all 4.20 catalogs
 *
 * Inference rules:
 * 1. Check if param path appears in frontend step files → supported-ui
 * 2. Check if param is structural (apiVersion, kind, metadata.name) → supported-derived
 * 3. Check if param is computed/calculated per description → supported-derived
 * 4. Otherwise → supported-backend-only
 */

const fs = require('fs');
const path = require('path');

const STEPS_DIR = path.resolve(__dirname, '../frontend/src/steps');
const CATALOGS_DIR = path.resolve(__dirname, '../data/params/4.20');

console.log('Adding supportStatus to all 4.20 catalogs...\n');

// Read all frontend step files into one string for searching
const stepFiles = fs.readdirSync(STEPS_DIR).filter(f => f.endsWith('.jsx'));
let allStepContent = '';
stepFiles.forEach(file => {
  allStepContent += fs.readFileSync(path.join(STEPS_DIR, file), 'utf-8') + '\n';
});

// Structural/derived fields (always auto-generated)
const DERIVED_FIELDS = new Set([
  'apiVersion',
  'kind',
  'metadata.name',
  'metadata.namespace'
]);

function inferSupportStatus(param, stepContent) {
  const paramPath = param.path;

  // Check if structural/derived
  if (DERIVED_FIELDS.has(paramPath)) {
    return 'supported-derived';
  }

  // Check if description indicates derivation
  const desc = (param.description || '').toLowerCase();
  if (desc.includes('calculated') ||
      desc.includes('derived') ||
      desc.includes('auto-generated') ||
      desc.includes('automatically generated')) {
    return 'supported-derived';
  }

  // Check if param path appears in frontend code (UI field exists)
  // Look for common patterns:
  // - state.section.field
  // - "field" or 'field' in JSX
  // - name="field"
  // - FieldLabelWithInfo references

  const fieldName = paramPath.split('.').pop(); // Get last segment

  // Search for field in UI code
  const patterns = [
    new RegExp(`state\\.\\w+\\.${fieldName}`, 'g'),
    new RegExp(`["']${paramPath}["']`, 'g'),
    new RegExp(`["']${fieldName}["']`, 'g'),
    new RegExp(`name=["']${fieldName}["']`, 'g')
  ];

  for (const pattern of patterns) {
    if (pattern.test(stepContent)) {
      return 'supported-ui';
    }
  }

  // Default: backend-only (emitted in YAML but no UI input)
  return 'supported-backend-only';
}

// Process each catalog
const catalogFiles = fs.readdirSync(CATALOGS_DIR)
  .filter(f => f.endsWith('.json'))
  .sort();

const summary = {
  catalogs: 0,
  totalParams: 0,
  updated: 0,
  skipped: 0,
  byStatus: {
    'supported-ui': 0,
    'supported-derived': 0,
    'supported-backend-only': 0
  }
};

catalogFiles.forEach(catalogFile => {
  const catalogPath = path.join(CATALOGS_DIR, catalogFile);
  const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf-8'));

  let catalogUpdated = 0;
  const catalogStatusCount = {
    'supported-ui': 0,
    'supported-derived': 0,
    'supported-backend-only': 0
  };

  catalog.parameters.forEach(param => {
    summary.totalParams++;

    if (param.supportStatus) {
      summary.skipped++;
      return; // Already has supportStatus
    }

    const status = inferSupportStatus(param, allStepContent);
    param.supportStatus = status;
    param.minVersion = '4.20'; // v2.0.0 baseline
    param.maxVersion = null;   // No known removal

    summary.updated++;
    catalogUpdated++;
    summary.byStatus[status]++;
    catalogStatusCount[status]++;
  });

  if (catalogUpdated > 0) {
    fs.writeFileSync(catalogPath, JSON.stringify(catalog, null, 2) + '\n', 'utf-8');
    console.log(`✅ ${catalogFile.padEnd(35)} +${catalogUpdated.toString().padStart(3)} params (UI: ${catalogStatusCount['supported-ui']}, Derived: ${catalogStatusCount['supported-derived']}, Backend: ${catalogStatusCount['supported-backend-only']})`);
    summary.catalogs++;
  } else {
    console.log(`⏭️  ${catalogFile.padEnd(35)} Already complete`);
  }
});

console.log('\n' + '='.repeat(80));
console.log('Summary:');
console.log(`  Catalogs processed: ${summary.catalogs}`);
console.log(`  Total parameters:   ${summary.totalParams}`);
console.log(`  Updated:            ${summary.updated}`);
console.log(`  Skipped (existing): ${summary.skipped}`);
console.log('\nBy supportStatus:');
console.log(`  supported-ui:             ${summary.byStatus['supported-ui']}`);
console.log(`  supported-derived:        ${summary.byStatus['supported-derived']}`);
console.log(`  supported-backend-only:   ${summary.byStatus['supported-backend-only']}`);
console.log('\n✅ All catalogs updated with supportStatus metadata');
console.log('   minVersion: 4.20 (v2.0.0 baseline)');
console.log('   maxVersion: null (no known removals)');
