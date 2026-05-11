#!/usr/bin/env node
/**
 * Catalog Sync Utility
 *
 * Ensures catalog parameter files are synchronized between:
 * - data/params/4.20/ (backend source)
 * - frontend/src/data/catalogs/ (frontend source)
 *
 * Run manually: node scripts/sync-catalogs.js
 * Auto-runs: pre-commit hook, npm run sync-catalogs
 *
 * @author Bill Strauss
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const SOURCE_DIR = path.join(__dirname, '..', 'data', 'params', '4.20');
const TARGET_DIR = path.join(__dirname, '..', 'frontend', 'src', 'data', 'catalogs');

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
  log('  Catalog Sync Utility', 'blue');
  log('═══════════════════════════════════════════════════', 'blue');

  if (dryRun) {
    log('  [DRY RUN MODE - No files will be modified]', 'yellow');
  }
  log('');

  // Verify directories exist
  if (!fs.existsSync(SOURCE_DIR)) {
    log(`❌ Source directory not found: ${SOURCE_DIR}`, 'red');
    process.exit(1);
  }

  if (!fs.existsSync(TARGET_DIR)) {
    log(`❌ Target directory not found: ${TARGET_DIR}`, 'red');
    process.exit(1);
  }

  // Get all JSON files from source
  const sourceFiles = fs.readdirSync(SOURCE_DIR).filter(f => f.endsWith('.json'));

  if (sourceFiles.length === 0) {
    log('⚠️  No catalog files found in source directory', 'yellow');
    process.exit(0);
  }

  log(`📂 Source: ${path.relative(process.cwd(), SOURCE_DIR)}`, 'gray');
  log(`📂 Target: ${path.relative(process.cwd(), TARGET_DIR)}`, 'gray');
  log(`📄 Files: ${sourceFiles.length} catalog files`, 'gray');
  log('');

  let identical = 0;
  let synced = 0;
  let errors = 0;

  sourceFiles.forEach(fileName => {
    const sourcePath = path.join(SOURCE_DIR, fileName);
    const targetPath = path.join(TARGET_DIR, fileName);

    const sourceHash = getFileHash(sourcePath);
    const targetHash = getFileHash(targetPath);

    if (!targetHash) {
      // Target doesn't exist - copy it
      if (!dryRun) {
        try {
          fs.copyFileSync(sourcePath, targetPath);
          log(`  ✓ ${fileName} - CREATED`, 'green');
          synced++;
        } catch (err) {
          log(`  ✗ ${fileName} - ERROR: ${err.message}`, 'red');
          errors++;
        }
      } else {
        log(`  → ${fileName} - WOULD CREATE`, 'yellow');
        synced++;
      }
    } else if (sourceHash !== targetHash) {
      // Files differ - sync them
      if (!dryRun) {
        try {
          fs.copyFileSync(sourcePath, targetPath);
          log(`  ✓ ${fileName} - SYNCED`, 'green');
          synced++;
        } catch (err) {
          log(`  ✗ ${fileName} - ERROR: ${err.message}`, 'red');
          errors++;
        }
      } else {
        log(`  → ${fileName} - WOULD SYNC`, 'yellow');
        synced++;
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
      identical++;
    }
  });

  log('');
  log('═══════════════════════════════════════════════════', 'blue');
  log('  Summary', 'blue');
  log('═══════════════════════════════════════════════════', 'blue');
  log(`  ✓ Identical: ${identical}`, identical > 0 ? 'green' : 'gray');
  log(`  ↻ Synced:    ${synced}`, synced > 0 ? 'yellow' : 'gray');
  log(`  ✗ Errors:    ${errors}`, errors > 0 ? 'red' : 'gray');
  log('═══════════════════════════════════════════════════', 'blue');

  if (errors > 0) {
    process.exit(1);
  }

  if (synced > 0 && !dryRun) {
    log('');
    log('✅ Catalogs synchronized successfully!', 'green');
  } else if (synced > 0 && dryRun) {
    log('');
    log('⚠️  Run without --dry-run to apply changes', 'yellow');
  } else {
    log('');
    log('✅ All catalogs already in sync!', 'green');
  }

  return { identical, synced, errors };
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
Catalog Sync Utility

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
