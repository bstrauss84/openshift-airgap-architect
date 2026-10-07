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
 * MODES
 *   (none)      write the mirror. Human-invoked: npm run sync-catalogs
 *   --check     CI/hook gate. Writes nothing. Exits 1 if the mirror differs
 *               from canonical in any way, including orphaned mirror files.
 *   --dry-run   human PREVIEW only. Writes nothing, prints what would change,
 *               and exits 0 even when drift exists. NOT A GATE — use --check.
 *
 * The --check/--dry-run distinction is load-bearing. --dry-run counts a drifted
 * file in `totalSynced` but only a write ERROR sets a non-zero exit, so it
 * reports drift and still exits 0. Wiring --dry-run into CI would have produced
 * a gate that could never fail. --check exists so there is an unambiguous
 * non-mutating failure signal.
 *
 * --root <dir> operates on a fixture tree instead of the repository, so the
 * gate can be tested hermetically.
 *
 * @author Bill Strauss
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DEFAULT_ROOT = path.join(__dirname, '..');
const paramsRootFor = (root) => path.join(root, 'data', 'params');
const catalogsRootFor = (root) => path.join(root, 'frontend', 'src', 'data', 'catalogs');

const PARAMS_ROOT = paramsRootFor(DEFAULT_ROOT);
const CATALOGS_ROOT = catalogsRootFor(DEFAULT_ROOT);

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
  const { check = false, verbose = false, root = DEFAULT_ROOT, exitProcess = true } = options;
  // --check implies no writes. --dry-run is preview-only and also writes nothing.
  const dryRun = options.dryRun || check;

  const PARAMS_ROOT = paramsRootFor(root);
  const CATALOGS_ROOT = catalogsRootFor(root);

  const bail = (code) => {
    if (exitProcess) process.exit(code);
    throw Object.assign(new Error(`sync-catalogs bailed with ${code}`), { exitCode: code });
  };

  log('═══════════════════════════════════════════════════', 'blue');
  log('  Catalog Sync Utility (Version-Aware)', 'blue');
  log('═══════════════════════════════════════════════════', 'blue');

  if (check) {
    log('  [CHECK MODE - read-only; non-zero exit on any drift]', 'yellow');
  } else if (dryRun) {
    log('  [DRY RUN - preview only; exits 0 even on drift. Use --check to gate.]', 'yellow');
  }
  log('');

  // Verify root directories exist
  if (!fs.existsSync(PARAMS_ROOT)) {
    log(`❌ Params root not found: ${PARAMS_ROOT}`, 'red');
    bail(1);
  }

  if (!fs.existsSync(CATALOGS_ROOT)) {
    log(`❌ Catalogs root not found: ${CATALOGS_ROOT}`, 'red');
    bail(1);
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
    bail(check ? 1 : 0);
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

  // Orphan detection: a mirror file with no canonical counterpart. The sync
  // loop is canonical-driven, so without this an orphan is invisible — yet it
  // means either a scenario was removed canonically and the mirror kept a stale
  // copy, or someone authored straight into the mirror.
  const orphans = [];
  versions.forEach((version) => {
    const sourceDir = path.join(PARAMS_ROOT, version);
    const targetDir = path.join(CATALOGS_ROOT, version);
    if (!fs.existsSync(targetDir)) return;
    const sourceFiles = new Set(
      fs.existsSync(sourceDir) ? fs.readdirSync(sourceDir).filter((f) => f.endsWith('.json')) : []
    );
    fs.readdirSync(targetDir)
      .filter((f) => f.endsWith('.json') && !sourceFiles.has(f))
      .forEach((f) => orphans.push(`${version}/${f}`));
  });
  // A whole mirror version directory with no canonical source is also an orphan.
  if (fs.existsSync(CATALOGS_ROOT)) {
    fs.readdirSync(CATALOGS_ROOT)
      .filter((n) => /^\d+\.\d+$/.test(n) && !versions.includes(n))
      .forEach((n) => orphans.push(`${n}/ (entire version directory)`));
  }

  if (orphans.length) {
    log('');
    orphans.forEach((o) => log(`  ⚠ ORPHAN in mirror with no canonical source: ${o}`, 'red'));
  }

  log('═══════════════════════════════════════════════════', 'blue');
  log('  Summary', 'blue');
  log('═══════════════════════════════════════════════════', 'blue');
  log(`  ✓ Identical: ${totalIdentical}`, totalIdentical > 0 ? 'green' : 'gray');
  log(`  ↻ ${check || dryRun ? 'Drifted:  ' : 'Synced:   '} ${totalSynced}`, totalSynced > 0 ? 'yellow' : 'gray');
  log(`  ⚠ Orphans:   ${orphans.length}`, orphans.length > 0 ? 'red' : 'gray');
  log(`  ✗ Errors:    ${totalErrors}`, totalErrors > 0 ? 'red' : 'gray');
  log('═══════════════════════════════════════════════════', 'blue');

  if (totalErrors > 0) {
    bail(1);
  }

  const drift = totalSynced + orphans.length;

  if (check) {
    log('');
    if (drift > 0) {
      log(`❌ Catalog mirror is OUT OF SYNC (${drift} difference(s)).`, 'red');
      log('   data/params/<minor>/ is canonical; frontend/src/data/catalogs/<minor>/ is generated.', 'red');
      log('   Fix canonical if it is wrong, then run: npm run sync-catalogs', 'red');
      log('   Never copy the mirror back over canonical.', 'red');
      bail(1);
    }
    log('✅ Catalog mirror is in sync.', 'green');
    return { identical: totalIdentical, synced: 0, drift: 0, orphans, errors: 0 };
  }

  if (totalSynced > 0 && !dryRun) {
    log('');
    log('✅ Catalogs synchronized successfully!', 'green');
  } else if (totalSynced > 0 && dryRun) {
    log('');
    log('⚠️  Preview only. Run without --dry-run to apply changes.', 'yellow');
    log('   (--dry-run exits 0 even with drift; use --check to gate CI.)', 'yellow');
  } else {
    log('');
    log('✅ All catalogs already in sync!', 'green');
  }

  // A mutating run cannot remove orphans (it only writes canonical -> mirror),
  // so surface them rather than reporting a clean sync.
  if (!dryRun && orphans.length > 0) {
    log('');
    log(`⚠️  ${orphans.length} orphan mirror file(s) remain; remove them by hand.`, 'red');
    bail(1);
  }

  return { identical: totalIdentical, synced: totalSynced, drift, orphans, errors: totalErrors };
}

// CLI handling
if (require.main === module) {
  const args = process.argv.slice(2);
  const rootIdx = args.indexOf('--root');
  const options = {
    check: args.includes('--check'),
    dryRun: args.includes('--dry-run') || args.includes('-n'),
    verbose: args.includes('--verbose') || args.includes('-v'),
    root: rootIdx !== -1 && args[rootIdx + 1] ? path.resolve(args[rootIdx + 1]) : DEFAULT_ROOT
  };

  if (args.includes('--help') || args.includes('-h')) {
    console.log(`
Catalog Sync Utility (Version-Aware)

Syncs data/params/<version>/*.json → frontend/src/data/catalogs/<version>/*.json

Usage: node scripts/sync-catalogs.js [options]

Options:
  --check          Read-only GATE. Writes nothing. Exits 1 on ANY drift,
                   including orphan mirror files. Use this in CI and hooks.
  --dry-run, -n    Human PREVIEW. Writes nothing, prints what would change,
                   and exits 0 even when drift exists. NOT a gate.
  --verbose, -v    Show all files including identical ones
  --root <dir>     Operate on a fixture tree instead of the repository
  --help, -h       Show this help message

Examples:
  node scripts/sync-catalogs.js              # Sync catalogs (writes)
  node scripts/sync-catalogs.js --check      # CI gate (exits 1 on drift)
  node scripts/sync-catalogs.js --dry-run    # Preview only (always exits 0)
`);
    process.exit(0);
  }

  syncCatalogs(options);
}

module.exports = { syncCatalogs };
