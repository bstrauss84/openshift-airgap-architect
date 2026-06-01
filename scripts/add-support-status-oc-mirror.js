#!/usr/bin/env node
/**
 * scripts/add-support-status-oc-mirror.js
 * Phase 0: Add supportStatus to oc-mirror-v2.json catalog
 *
 * Rule: All oc-mirror params are supported-backend-only (no dedicated UI step)
 */

const fs = require('fs');
const path = require('path');

const catalogPath = path.resolve(__dirname, '../data/params/4.20/oc-mirror-v2.json');

console.log('Adding supportStatus to oc-mirror-v2.json...');

const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf-8'));

let updated = 0;

catalog.parameters.forEach((param) => {
  if (!param.supportStatus) {
    // oc-mirror has no UI step - all params are backend-only
    param.supportStatus = 'supported-backend-only';
    param.minVersion = '4.20'; // v2.0.0 baseline
    param.maxVersion = null;   // No known removal version
    updated++;
  }
});

fs.writeFileSync(catalogPath, JSON.stringify(catalog, null, 2) + '\n', 'utf-8');

console.log(`✅ Updated ${updated} parameters in oc-mirror-v2.json`);
console.log(`   All params: supported-backend-only (no UI step)`);
console.log(`   minVersion: 4.20 (v2.0.0 baseline)`);
console.log(`   maxVersion: null (no known removal)`);
