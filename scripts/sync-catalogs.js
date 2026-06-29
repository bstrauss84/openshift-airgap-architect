#!/usr/bin/env node
/**
 * Catalog Sync Utility (Version-Aware)
 *
 * Ensures catalog parameter files are synchronized between:
 * - data/params/<version>/ (backend source)
 * - frontend/src/data/catalogs/<version>/ (frontend mirror)
 *
 * Preserves version subdirectory structure per ADR-001/ADR-005.
 *
 * Run manually: node scripts/sync-catalogs.js
 * Auto-runs: pre-commit hook, npm run sync-catalogs
 *
 * @author Bill Strauss
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PARAMS_ROOT = path.join(__dirname, '..', 'data', 'params');
const CATALOGS_ROOT = path.join(__dirname, '..', 'frontend', 'src', 'data', 'catalogs');

const COLORS = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  blue: '\x1b[34m',
  gray: '\x1b[90m'
};

function log(message, color = 'reset') {
  console.log(`${COLORS[color]}${message}${COLORS.reset}`);
}

function getFileHash(filePath) {
  if (!fs.existsSync(filePath)) return null;
  const content = fs.readFileSync(filePath, 'utf8');
  return crypto.createHash('md5').update(content).digest('hex');
}

function syncCatalogs(options = {}) {
  const { dryRun = false, verbose = false } = options;

  log('═══════════════════════════════════════════════════', 'blue');
  log('  Catalog Sync Utility (Version-Aware)', 'blue');
  log('═══════════════════════════════════════════════════', 'blue');

  if (dryRun) {
    log('  [DRY RUN MODE - No files will be modified]', 'yellow');
  }
  log('');

  // Verify root directories exist
  if (!fs.existsSync(PARAMS_ROOT)) {
    log(`❌ Params root not found: ${PARAMS_ROOT}`, 'red');
    process.exit(1);
  }

  if (!fs.existsSync(CATALOGS_ROOT)) {
    log(`❌ Catalogs root not found: ${CATALOGS_ROOT}`, 'red');
    process.exit(1);
  }

  // Find all version directories in params root
  const versions = fs.readdirSync(PARAMS_ROOT)
    .filter(name => {
      const fullPath = path.join(PARAMS_ROOT, name);
      return fs.statSync(fullPath).isDirectory() && /^\d+\.\d+$/.test(name);
    })
    .sort();

  if (versions.length === 0) {
    log('⚠️  No version directories found in data/params/', 'yellow');
    process.exit(0);
  }

  log(`📂 Versions found: ${versions.join(', ')}`, 'gray');
  log('');

  let totalIdentical = 0;
  let totalSynced = 0;
  let totalErrors = 0;

  versions.forEach(version => {
    const sourceDir = path.join(PARAMS_ROOT, version);
    const targetDir = path.join(CATALOGS_ROOT, version);

    log(`Version ${version}:`, 'blue');

    // Ensure target version directory exists
    if (!fs.existsSync(targetDir)) {
      if (!dryRun) {
        fs.mkdirSync(targetDir, { recursive: true });
        log(`  Created directory: frontend/src/data/catalogs/${version}/`, 'green');
      } else {
        log(`  Would create directory: frontend/src/data/catalogs/${version}/`, 'yellow');
      }
    }

    // Get all JSON files from source version directory
    const sourceFiles = fs.readdirSync(sourceDir).filter(f => f.endsWith('.json'));

    if (sourceFiles.length === 0) {
      log(`  ⚠️  No catalog files found`, 'yellow');
      return;
    }

    sourceFiles.forEach(fileName => {
      const sourcePath = path.join(sourceDir, fileName);
      const targetPath = path.join(targetDir, fileName);

      const sourceHash = getFileHash(sourcePath);
      const targetHash = getFileHash(targetPath);

      if (!targetHash) {
        // Target doesn't exist - copy it
        if (!dryRun) {
          try {
            fs.copyFileSync(sourcePath, targetPath);
            log(`  ✓ ${fileName} - CREATED`, 'green');
            totalSynced++;
          } catch (err) {
            log(`  ✗ ${fileName} - ERROR: ${err.message}`, 'red');
            totalErrors++;
          }
        } else {
          log(`  → ${fileName} - WOULD CREATE`, 'yellow');
          totalSynced++;
        }
      } else if (sourceHash !== targetHash) {
        // Files differ - sync them
        if (!dryRun) {
          try {
            fs.copyFileSync(sourcePath, targetPath);
            log(`  ✓ ${fileName} - SYNCED`, 'green');
            totalSynced++;
          } catch (err) {
            log(`  ✗ ${fileName} - ERROR: ${err.message}`, 'red');
            totalErrors++;
          }
        } else {
          log(`  → ${fileName} - WOULD SYNC`, 'yellow');
          totalSynced++;
        }

        if (verbose) {
          log(`    Source: ${sourceHash}`, 'gray');
          log(`    Target: ${targetHash}`, 'gray');
        }
      } else {
        // Files are identical
        if (verbose) {
          log(`  ≡ ${fileName} - IDENTICAL`, 'gray');
        }
        totalIdentical++;
      }
    });

    log('');
  });

  log('═══════════════════════════════════════════════════', 'blue');
  log('  Summary', 'blue');
  log('═══════════════════════════════════════════════════', 'blue');
  log(`  ✓ Identical: ${totalIdentical}`, totalIdentical > 0 ? 'green' : 'gray');
  log(`  ↻ Synced:    ${totalSynced}`, totalSynced > 0 ? 'yellow' : 'gray');
  log(`  ✗ Errors:    ${totalErrors}`, totalErrors > 0 ? 'red' : 'gray');
  log('═══════════════════════════════════════════════════', 'blue');

  if (totalErrors > 0) {
    process.exit(1);
  }

  if (totalSynced > 0 && !dryRun) {
    log('');
    log('✅ Catalogs synchronized successfully!', 'green');
  } else if (totalSynced > 0 && dryRun) {
    log('');
    log('⚠️  Run without --dry-run to apply changes', 'yellow');
  } else {
    log('');
    log('✅ All catalogs already in sync!', 'green');
  }

  return { identical: totalIdentical, synced: totalSynced, errors: totalErrors };
}

// CLI handling
if (require.main === module) {
  const args = process.argv.slice(2);
  const options = {
    dryRun: args.includes('--dry-run') || args.includes('-n'),
    verbose: args.includes('--verbose') || args.includes('-v')
  };

  if (args.includes('--help') || args.includes('-h')) {
    console.log(`
Catalog Sync Utility (Version-Aware)

Syncs data/params/<version>/*.json → frontend/src/data/catalogs/<version>/*.json

Usage: node scripts/sync-catalogs.js [options]

Options:
  --dry-run, -n    Show what would be synced without making changes
  --verbose, -v    Show all files including identical ones
  --help, -h       Show this help message

Examples:
  node scripts/sync-catalogs.js              # Sync catalogs
  node scripts/sync-catalogs.js --dry-run    # Preview changes
  node scripts/sync-catalogs.js -v           # Verbose output
`);
    process.exit(0);
  }

  syncCatalogs(options);
}

module.exports = { syncCatalogs };
