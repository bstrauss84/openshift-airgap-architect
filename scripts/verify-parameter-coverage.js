#!/usr/bin/env node
/**
 * Parameter Coverage Verification Tool
 *
 * Automated verification that catalog parameters are properly handled in backend generation.
 * Cross-references catalog parameter paths against backend/src/generate.js field access.
 *
 * Usage:
 *   node scripts/verify-parameter-coverage.js
 *   node scripts/verify-parameter-coverage.js --scenario aws-govcloud-ipi
 *   node scripts/verify-parameter-coverage.js --verbose
 *
 * Output:
 *   - Coverage statistics per scenario
 *   - List of catalog parameters not found in generate.js
 *   - List of generate.js field accesses not in catalogs
 *   - Warnings for suspicious patterns
 *
 * Exit codes:
 *   0 - All parameters covered or only warnings
 *   1 - Critical gaps found (catalog parameters missing from generate.js)
 */

const fs = require('fs');
const path = require('path');

const CATALOGS_DIR = path.join(__dirname, '../data/params/4.20');
const GENERATE_FILE = path.join(__dirname, '../backend/src/generate.js');

// Parse command-line arguments
const args = process.argv.slice(2);
const verbose = args.includes('--verbose') || args.includes('-v');
const scenarioFilter = args.find(arg => arg.startsWith('--scenario='))?.split('=')[1];
const helpRequested = args.includes('--help') || args.includes('-h');

if (helpRequested) {
  console.log(`
Parameter Coverage Verification Tool

Usage:
  node scripts/verify-parameter-coverage.js [options]

Options:
  --scenario=<name>  Only check specific scenario (e.g., aws-govcloud-ipi)
  --verbose, -v      Show detailed parameter-by-parameter analysis
  --help, -h         Show this help message

Examples:
  node scripts/verify-parameter-coverage.js
  node scripts/verify-parameter-coverage.js --scenario aws-govcloud-ipi --verbose
`);
  process.exit(0);
}

console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
console.log(`  Parameter Coverage Verification`);
console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);

// Load generate.js and extract field access patterns
const generateCode = fs.readFileSync(GENERATE_FILE, 'utf-8');

/**
 * Extract field access patterns from generate.js
 * Looks for patterns like:
 * - state.networking.clusterNetworkMTU
 * - state.platform?.aws?.vpc
 * - inventory.nodes[0].hostname
 * - node.bmc.address
 */
function extractFieldAccessPatterns(code) {
  const patterns = new Set();

  // Match state.path.to.field patterns
  const stateAccessRegex = /state\.[\w.?]+/g;
  const stateMatches = code.match(stateAccessRegex) || [];
  stateMatches.forEach(match => {
    // Remove optional chaining operators
    const clean = match.replace(/\?/g, '.');
    // Remove 'state.' prefix and handle nested paths
    const path = clean.replace(/^state\./, '');
    patterns.add(path);
  });

  // Match direct property access (for platform-specific paths)
  const platformAccessRegex = /platform\.[\w.?]+/g;
  const platformMatches = code.match(platformAccessRegex) || [];
  platformMatches.forEach(match => {
    const clean = match.replace(/\?/g, '.');
    patterns.add(clean);
  });

  // Match networking paths
  const networkingAccessRegex = /networking\.[\w.?]+/g;
  const networkingMatches = code.match(networkingAccessRegex) || [];
  networkingMatches.forEach(match => {
    const clean = match.replace(/\?/g, '.');
    patterns.add(clean);
  });

  return patterns;
}

const fieldAccessPatterns = extractFieldAccessPatterns(generateCode);

console.log(`📊 Backend field access patterns detected: ${fieldAccessPatterns.size}`);
if (verbose) {
  console.log(`   Sample patterns: ${Array.from(fieldAccessPatterns).slice(0, 10).join(', ')}...\n`);
}

// Load all catalog files
const catalogFiles = fs.readdirSync(CATALOGS_DIR)
  .filter(f => f.endsWith('.json'))
  .filter(f => !scenarioFilter || f === `${scenarioFilter}.json`);

console.log(`📂 Catalog files to analyze: ${catalogFiles.length}\n`);

let totalParams = 0;
let totalCovered = 0;
let totalMissing = 0;
let totalWarnings = 0;

const scenarioResults = [];

catalogFiles.forEach(filename => {
  const scenarioName = filename.replace('.json', '');
  const catalogPath = path.join(CATALOGS_DIR, filename);
  const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf-8'));

  const params = catalog.parameters || [];
  const covered = [];
  const missing = [];
  const warnings = [];

  params.forEach(param => {
    const { path: paramPath } = param;

    // Check if this path or a parent path is accessed in generate.js
    const pathSegments = paramPath.split('.');
    let found = false;

    // Check exact match
    if (fieldAccessPatterns.has(paramPath)) {
      found = true;
    }

    // Check parent paths (e.g., platform.aws.vpc might be accessed via platform.aws)
    for (let i = pathSegments.length - 1; i > 0 && !found; i--) {
      const parentPath = pathSegments.slice(0, i).join('.');
      if (fieldAccessPatterns.has(parentPath)) {
        found = true;
        warnings.push({
          param: paramPath,
          reason: `Parent path '${parentPath}' accessed, but not specific field '${paramPath}'`
        });
      }
    }

    // Check for array notation (e.g., compute[0].replicas -> compute.replicas)
    const withoutArray = paramPath.replace(/\[\d+\]/g, '');
    if (withoutArray !== paramPath && fieldAccessPatterns.has(withoutArray)) {
      found = true;
    }

    // Special cases for parameters that are always handled
    const alwaysHandledPatterns = [
      'metadata.name',
      'baseDomain',
      'clusterName',
      'pullSecret',
      'sshKey',
      'additionalTrustBundle'
    ];

    if (alwaysHandledPatterns.some(pattern => paramPath.includes(pattern))) {
      found = true;
    }

    if (found) {
      covered.push(paramPath);
    } else {
      missing.push(paramPath);
    }
  });

  totalParams += params.length;
  totalCovered += covered.length;
  totalMissing += missing.length;
  totalWarnings += warnings.length;

  const coveragePercent = params.length > 0
    ? ((covered.length / params.length) * 100).toFixed(1)
    : 100;

  scenarioResults.push({
    scenario: scenarioName,
    total: params.length,
    covered: covered.length,
    missing: missing.length,
    warnings: warnings.length,
    coveragePercent,
    missingList: missing,
    warningsList: warnings
  });

  // Print scenario summary
  const statusIcon = missing.length === 0 ? '✅' : warnings.length > 0 ? '⚠️' : '❌';
  console.log(`${statusIcon} ${scenarioName}`);
  console.log(`   Parameters: ${params.length} total, ${covered.length} covered, ${missing.length} missing`);
  console.log(`   Coverage: ${coveragePercent}%`);

  if (verbose && missing.length > 0) {
    console.log(`   Missing from generate.js:`);
    missing.forEach(p => console.log(`     - ${p}`));
  }

  if (verbose && warnings.length > 0) {
    console.log(`   Warnings:`);
    warnings.forEach(w => console.log(`     ⚠️  ${w.param}: ${w.reason}`));
  }

  console.log();
});

// Overall summary
console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
console.log(`  Overall Summary`);
console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
console.log(`📊 Total parameters: ${totalParams}`);
console.log(`✅ Covered: ${totalCovered} (${((totalCovered / totalParams) * 100).toFixed(1)}%)`);
console.log(`❌ Missing: ${totalMissing} (${((totalMissing / totalParams) * 100).toFixed(1)}%)`);
console.log(`⚠️  Warnings: ${totalWarnings}`);
console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);

// List scenarios with gaps
const scenariosWithGaps = scenarioResults.filter(r => r.missing.length > 0);
if (scenariosWithGaps.length > 0) {
  console.log(`⚠️  Scenarios with missing parameters (${scenariosWithGaps.length}):\n`);
  scenariosWithGaps.forEach(result => {
    console.log(`   ${result.scenario}: ${result.missing.length} missing (${(100 - parseFloat(result.coveragePercent)).toFixed(1)}% gap)`);
    if (!verbose && result.missing.length <= 5) {
      result.missingList.forEach(p => console.log(`     - ${p}`));
    } else if (!verbose) {
      result.missingList.slice(0, 3).forEach(p => console.log(`     - ${p}`));
      console.log(`     ... and ${result.missing.length - 3} more (use --verbose to see all)`);
    }
  });
  console.log();
}

// Analysis notes
console.log(`📝 Analysis Notes:\n`);
console.log(`   This tool detects field access patterns in backend/src/generate.js.`);
console.log(`   Some parameters may be legitimately unhandled:`);
console.log(`     - Optional parameters with defaults (installer handles them)`);
console.log(`     - Platform-specific params not applicable to all scenarios`);
console.log(`     - Parameters handled by installer binary, not our generation code`);
console.log();
console.log(`   Consider these "missing" parameters as candidates for:`);
console.log(`     1. Backend generation implementation (if user-configurable)`);
console.log(`     2. Documentation (if installer-managed with defaults)`);
console.log(`     3. Removal from catalog (if truly unused/deprecated)`);
console.log();

// Recommendations
if (totalMissing > 0) {
  console.log(`💡 Recommendations:\n`);
  console.log(`   1. Review missing parameters to determine if they should be implemented`);
  console.log(`   2. Add backend generation logic for high-priority missing parameters`);
  console.log(`   3. Update catalog metadata for installer-managed parameters`);
  console.log(`   4. Create GitHub issues for parameters requiring UI + backend work`);
  console.log();
}

// Export results as JSON if requested
if (args.includes('--json')) {
  const jsonOutput = {
    summary: {
      totalParams,
      totalCovered,
      totalMissing,
      totalWarnings,
      coveragePercent: ((totalCovered / totalParams) * 100).toFixed(1)
    },
    scenarios: scenarioResults,
    fieldAccessPatterns: Array.from(fieldAccessPatterns)
  };

  const outputPath = path.join(__dirname, '../coverage-report.json');
  fs.writeFileSync(outputPath, JSON.stringify(jsonOutput, null, 2));
  console.log(`📄 Detailed JSON report written to: coverage-report.json\n`);
}

// Exit with appropriate code
const exitCode = totalMissing > 0 ? 1 : 0;
if (exitCode === 0) {
  console.log(`✅ All catalog parameters are covered by backend generation!\n`);
} else {
  console.log(`⚠️  ${totalMissing} catalog parameters are not explicitly handled in generate.js.\n`);
  console.log(`   This may be expected (installer defaults, platform-specific, etc.)`);
  console.log(`   Review the missing parameters above to determine next steps.\n`);
}

process.exit(exitCode);
