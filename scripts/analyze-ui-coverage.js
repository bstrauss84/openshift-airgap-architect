#!/usr/bin/env node
/**
 * scripts/analyze-ui-coverage.js
 * Phase 0: Analyze which catalog params have UI fields
 *
 * Strategy:
 * 1. Read all frontend step files
 * 2. Extract field paths (look for state.field references, FieldLabelWithInfo, input names)
 * 3. Cross-reference with catalog params
 * 4. Generate coverage report for supportStatus inference
 */

const fs = require('fs');
const path = require('path');

const STEPS_DIR = path.resolve(__dirname, '../frontend/src/steps');
const CATALOGS_DIR = path.resolve(__dirname, '../data/params/4.20');

console.log('Analyzing UI field coverage for supportStatus inference...\n');

// Read all step files
const stepFiles = fs.readdirSync(STEPS_DIR).filter(f => f.endsWith('.jsx'));
let allStepContent = '';
stepFiles.forEach(file => {
  allStepContent += fs.readFileSync(path.join(STEPS_DIR, file), 'utf-8') + '\n';
});

// Extract common state paths mentioned in UI
const statePathPattern = /state\.(blueprint|methodology|release|globalStrategy|trustProxy|platformConfig|networking|hostInventory|operators|mirrorConfig|version)\.([a-zA-Z0-9_]+)/g;
const fieldPaths = new Set();

let match;
while ((match = statePathPattern.exec(allStepContent)) !== null) {
  const topLevel = match[1];
  const field = match[2];
  fieldPaths.add(`${topLevel}.${field}`);
}

console.log(`Found ${fieldPaths.size} unique state paths in frontend steps\n`);

// Analyze each catalog
const catalogFiles = fs.readdirSync(CATALOGS_DIR).filter(f => f.endsWith('.json'));

const report = [];

catalogFiles.forEach(catalogFile => {
  const catalogPath = path.join(CATALOGS_DIR, catalogFile);
  const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf-8'));

  let uiFieldCount = 0;
  let backendOnlyCount = 0;
  let derivedCount = 0;

  catalog.parameters.forEach(param => {
    const paramPath = param.path;

    // Check if param path appears in UI
    const hasUIField = fieldPaths.has(paramPath) ||
                       allStepContent.includes(`"${paramPath}"`) ||
                       allStepContent.includes(`'${paramPath}'`);

    // Check if it's a derived/computed field (common patterns)
    const isDerived = param.description?.includes('calculated') ||
                      param.description?.includes('derived') ||
                      param.description?.includes('auto-generated') ||
                      paramPath.includes('imageDigestSources') ||
                      paramPath === 'metadata.name' ||
                      paramPath === 'apiVersion' ||
                      paramPath === 'kind';

    if (hasUIField) {
      uiFieldCount++;
    } else if (isDerived) {
      derivedCount++;
    } else {
      backendOnlyCount++;
    }
  });

  const total = catalog.parameters.length;
  const coverage = total > 0 ? ((uiFieldCount / total) * 100).toFixed(1) : 0;

  report.push({
    catalog: catalogFile,
    total,
    ui: uiFieldCount,
    derived: derivedCount,
    backendOnly: backendOnlyCount,
    coverage: parseFloat(coverage)
  });
});

// Sort by coverage descending
report.sort((a, b) => b.coverage - a.coverage);

console.log('UI Field Coverage by Catalog:\n');
console.log('Catalog'.padEnd(40) + 'Total'.padStart(6) + 'UI'.padStart(6) + 'Derived'.padStart(9) + 'Backend'.padStart(9) + 'Coverage'.padStart(10));
console.log('-'.repeat(85));

report.forEach(r => {
  console.log(
    r.catalog.padEnd(40) +
    r.total.toString().padStart(6) +
    r.ui.toString().padStart(6) +
    r.derived.toString().padStart(9) +
    r.backendOnly.toString().padStart(9) +
    `${r.coverage}%`.padStart(10)
  );
});

const totals = report.reduce((acc, r) => ({
  total: acc.total + r.total,
  ui: acc.ui + r.ui,
  derived: acc.derived + r.derived,
  backendOnly: acc.backendOnly + r.backendOnly
}), { total: 0, ui: 0, derived: 0, backendOnly: 0 });

const avgCoverage = report.reduce((sum, r) => sum + r.coverage, 0) / report.length;

console.log('-'.repeat(85));
console.log(
  'TOTAL'.padEnd(40) +
  totals.total.toString().padStart(6) +
  totals.ui.toString().padStart(6) +
  totals.derived.toString().padStart(9) +
  totals.backendOnly.toString().padStart(9) +
  `${avgCoverage.toFixed(1)}%`.padStart(10)
);

console.log('\nSupportStatus Inference Strategy:');
console.log('- UI fields (detected in step files) → supported-ui');
console.log('- Derived fields (apiVersion, kind, calculated) → supported-derived');
console.log('- Remaining fields (emitted by backend) → supported-backend-only');
console.log('\nReady to apply supportStatus to remaining catalogs.');
