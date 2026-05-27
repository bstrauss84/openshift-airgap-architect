#!/usr/bin/env node
/**
 * Add missing high-priority parameters from DOC-082 analysis to catalog files
 *
 * Reads missing-parameters-analysis.json and systematically adds parameters
 * to appropriate catalog files while maintaining alphabetical order.
 */

const fs = require('fs');
const path = require('path');

const ANALYSIS_FILE = path.join(__dirname, '../local-docs/ocp-4.20/analysis/missing-parameters-analysis.json');
const BACKEND_CATALOGS_DIR = path.join(__dirname, '../data/params/4.20');
const FRONTEND_CATALOGS_DIR = path.join(__dirname, '../frontend/src/data/catalogs');

// Load analysis file
const analysis = JSON.parse(fs.readFileSync(ANALYSIS_FILE, 'utf-8'));
const highPriorityParams = analysis.categories.highPriority.parameters;

// Skip already implemented parameters
const SKIP_IDS = ['MISSING-022', 'MISSING-023', 'MISSING-027'];
const paramsToAdd = highPriorityParams.filter(p => !SKIP_IDS.includes(p.id));

console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
console.log(`  Add Missing Parameters to Catalogs`);
console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);
console.log(`📊 Parameters to add: ${paramsToAdd.length}`);
console.log(`📂 Backend catalogs: ${BACKEND_CATALOGS_DIR}`);
console.log(`📂 Frontend catalogs: ${FRONTEND_CATALOGS_DIR}\n`);

// Build parameter objects for each scenario
const paramsByScenario = {};

paramsToAdd.forEach(param => {
  const scenarios = param.applicableScenarios.includes('all')
    ? ['bare-metal-ipi', 'bare-metal-upi', 'bare-metal-agent', 'vsphere-ipi', 'vsphere-upi', 'vsphere-agent',
       'aws-govcloud-ipi', 'aws-govcloud-upi', 'azure-government-ipi', 'azure-government-upi',
       'nutanix-ipi', 'ibm-cloud-ipi']
    : param.applicableScenarios;

  scenarios.forEach(scenario => {
    if (!paramsByScenario[scenario]) {
      paramsByScenario[scenario] = [];
    }

    const paramObj = {
      path: param.path,
      outputFile: param.outputFile || 'install-config.yaml',
      type: param.type,
      allowed: param.allowed || 'not specified in docs',
      default: param.default || 'not specified in docs',
      required: param.required || false,
      description: param.description,
      applies_to: [scenario],
      citations: param.evidence.documentation ? [{
        docId: 'missing-parameter-analysis',
        docTitle: 'DOC-082 Missing Parameter Analysis',
        sectionHeading: param.evidence.documentation,
        url: 'https://docs.redhat.com/en/documentation/openshift_container_platform/4.20/'
      }] : []
    };

    paramsByScenario[scenario].push(paramObj);
  });
});

// Process each catalog file
let filesModified = 0;
let paramsAdded = 0;

Object.entries(paramsByScenario).forEach(([scenario, params]) => {
  const catalogFile = path.join(BACKEND_CATALOGS_DIR, `${scenario}.json`);

  if (!fs.existsSync(catalogFile)) {
    console.log(`⚠️  Catalog not found: ${scenario}.json (skipping)`);
    return;
  }

  const catalog = JSON.parse(fs.readFileSync(catalogFile, 'utf-8'));

  // Add new parameters if they don't already exist
  let added = 0;
  params.forEach(newParam => {
    const exists = catalog.parameters.some(p => p.path === newParam.path);
    if (!exists) {
      catalog.parameters.push(newParam);
      added++;
    }
  });

  if (added > 0) {
    // Sort parameters alphabetically by path
    catalog.parameters.sort((a, b) => a.path.localeCompare(b.path));

    // Write back to file
    fs.writeFileSync(catalogFile, JSON.stringify(catalog, null, 2) + '\n', 'utf-8');

    console.log(`✓ ${scenario}.json - added ${added} parameters`);
    filesModified++;
    paramsAdded += added;
  } else {
    console.log(`  ${scenario}.json - no new parameters`);
  }
});

console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
console.log(`  Summary`);
console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
console.log(`✓ Files modified: ${filesModified}`);
console.log(`✓ Parameters added: ${paramsAdded}`);
console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);

console.log(`Next steps:`);
console.log(`1. Run: npm run sync-catalogs (to sync backend → frontend)`);
console.log(`2. Verify: git diff data/params/4.20/ frontend/src/data/catalogs/`);
console.log(`3. Commit changes\n`);
