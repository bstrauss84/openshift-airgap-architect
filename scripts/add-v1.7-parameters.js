#!/usr/bin/env node
/**
 * Add v1.7.0 Missing Parameters Script
 *
 * Systematically adds 20 high-priority missing parameters from DOC-082 audit
 * to both backend and frontend parameter catalogs.
 *
 * Usage:
 *   node scripts/add-v1.7-parameters.js [--dry-run] [--verbose]
 *
 * Approach:
 * 1. Read missing-parameters-v1.7.0.json
 * 2. For each parameter, expand "all" applies_to to specific scenarios
 * 3. Add to backend data/params/4.20/*.json
 * 4. Add to frontend/src/data/catalogs/*.json
 * 5. Maintain alphabetical order within sections
 * 6. Preserve formatting and structure
 */

const fs = require('fs');
const path = require('path');

const ANALYSIS_FILE = path.join(__dirname, '../local-docs/ocp-4.20/analysis/missing-parameters-v1.7.0.json');
const BACKEND_CATALOGS_DIR = path.join(__dirname, '../data/params/4.20');
const FRONTEND_CATALOGS_DIR = path.join(__dirname, '../frontend/src/data/catalogs');

// All 13 scenario file names
const ALL_SCENARIOS = [
  'aws-govcloud-ipi',
  'aws-govcloud-upi',
  'azure-government-ipi',
  'azure-government-upi',
  'bare-metal-ipi',
  'bare-metal-upi',
  'bare-metal-agent',
  'vsphere-ipi',
  'vsphere-upi',
  'vsphere-agent',
  'nutanix-ipi',
  'ibm-cloud-ipi',
  'oc-mirror-v2'
];

// Command-line flags
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const verbose = args.includes('--verbose');

console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
console.log(`  Add v1.7.0 Missing Parameters`);
console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);

if (dryRun) {
  console.log(`⚠️  DRY RUN MODE - No files will be modified\n`);
}

// Load analysis file
const analysis = JSON.parse(fs.readFileSync(ANALYSIS_FILE, 'utf-8'));
console.log(`📄 Loaded ${analysis.parameters.length} parameters from analysis file\n`);

/**
 * Expand "all" applies_to to specific scenario names
 */
function expandAppliesTo(appliesTo) {
  if (appliesTo.includes('all')) {
    // Exclude oc-mirror-v2 from "all" (it's for ImageSetConfiguration, not install-config)
    return ALL_SCENARIOS.filter(s => s !== 'oc-mirror-v2');
  }
  return appliesTo;
}

/**
 * Create parameter object for catalog
 */
function createParameterObject(param) {
  const paramObj = {
    path: param.path,
    type: param.type,
    required: param.required || false,
    description: param.description
  };

  // Add default if present
  if (param.default !== undefined) {
    paramObj.default = param.default;
  }

  // Add enum if present
  if (param.enum) {
    paramObj.enum = param.enum;
  }

  // Add items_type for arrays
  if (param.items_type) {
    paramObj.items_type = param.items_type;
  }

  // Add citations
  paramObj.citations = [];
  if (param.installer_source) {
    paramObj.citations.push({
      source: "installer_source",
      url: param.installer_source,
      note: "Go struct definition"
    });
  }
  if (param.ocp_docs) {
    paramObj.citations.push({
      source: "ocp_docs",
      note: param.ocp_docs
    });
  }

  return paramObj;
}

/**
 * Insert parameter into catalog in alphabetical order
 */
function insertParameter(catalog, paramObj) {
  if (!catalog.parameters) {
    catalog.parameters = [];
  }

  // Find insertion point (alphabetical by path)
  const insertIndex = catalog.parameters.findIndex(p => p.path > paramObj.path);

  if (insertIndex === -1) {
    // Add to end
    catalog.parameters.push(paramObj);
  } else {
    // Insert at specific position
    catalog.parameters.splice(insertIndex, 0, paramObj);
  }
}

/**
 * Add parameter to a specific catalog file
 */
function addParameterToCatalog(catalogPath, paramObj, scenarioName) {
  const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf-8'));

  // Check if parameter already exists
  const exists = catalog.parameters && catalog.parameters.some(p => p.path === paramObj.path);
  if (exists) {
    if (verbose) {
      console.log(`  ⏭️  ${scenarioName}: ${paramObj.path} already exists, skipping`);
    }
    return false;
  }

  // Insert parameter
  insertParameter(catalog, paramObj);

  // Write back to file (only if not dry-run)
  if (!dryRun) {
    fs.writeFileSync(catalogPath, JSON.stringify(catalog, null, 2) + '\n', 'utf-8');
  }

  return true;
}

/**
 * Process all parameters
 */
function processParameters() {
  let totalAdded = 0;
  const addedByScenario = {};

  analysis.parameters.forEach((param, index) => {
    console.log(`\n[${index + 1}/${analysis.parameters.length}] Processing: ${param.id} - ${param.path}`);
    console.log(`   Priority: ${param.priority}, Use case: ${param.use_case}`);

    const scenarios = expandAppliesTo(param.applies_to);
    console.log(`   Applies to: ${scenarios.length} scenarios`);

    const paramObj = createParameterObject(param);
    let addedCount = 0;

    scenarios.forEach(scenarioName => {
      // Add to backend catalog
      const backendPath = path.join(BACKEND_CATALOGS_DIR, `${scenarioName}.json`);
      if (fs.existsSync(backendPath)) {
        const added = addParameterToCatalog(backendPath, paramObj, `${scenarioName} (backend)`);
        if (added) {
          addedCount++;
          addedByScenario[scenarioName] = (addedByScenario[scenarioName] || 0) + 1;
        }
      }

      // Add to frontend catalog
      const frontendPath = path.join(FRONTEND_CATALOGS_DIR, `${scenarioName}.json`);
      if (fs.existsSync(frontendPath)) {
        const added = addParameterToCatalog(frontendPath, paramObj, `${scenarioName} (frontend)`);
        // Don't double-count (backend + frontend = 1 parameter instance)
      }
    });

    console.log(`   ✅ Added to ${addedCount} scenarios (backend + frontend synced)`);
    totalAdded += addedCount;
  });

  return { totalAdded, addedByScenario };
}

// Main execution
try {
  const results = processParameters();

  console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`  Summary`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`📊 Parameters processed: ${analysis.parameters.length}`);
  console.log(`✅ Parameter instances added: ${results.totalAdded}`);
  console.log(`📁 Scenarios modified:`);

  Object.entries(results.addedByScenario)
    .sort((a, b) => b[1] - a[1])
    .forEach(([scenario, count]) => {
      console.log(`   ${scenario}: +${count} parameters`);
    });

  if (dryRun) {
    console.log(`\n⚠️  DRY RUN MODE - No files were actually modified`);
    console.log(`   Run without --dry-run to apply changes`);
  } else {
    console.log(`\n✅ All parameters added successfully!`);
    console.log(`   Backend catalogs: ${BACKEND_CATALOGS_DIR}`);
    console.log(`   Frontend catalogs: ${FRONTEND_CATALOGS_DIR}`);
  }

  console.log(`\n📋 Next steps:`);
  console.log(`   1. Verify catalogs synchronized: npm run verify-catalogs`);
  console.log(`   2. Update backend generation: backend/src/generate.js`);
  console.log(`   3. Add frontend UI fields: frontend/src/steps/*.jsx`);
  console.log(`   4. Add validation: frontend/src/validation.js`);
  console.log(`   5. Run parameter coverage tool: node scripts/verify-parameter-coverage.js`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);

  process.exit(0);
} catch (error) {
  console.error(`\n❌ Error: ${error.message}`);
  if (verbose) {
    console.error(error.stack);
  }
  process.exit(1);
}
