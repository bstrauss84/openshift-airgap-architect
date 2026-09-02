#!/usr/bin/env node
/**
 * Post-build script to add loadStylesheets to plugin-manifest.json
 * The ConsoleRemotePlugin doesn't automatically add this, so we patch it manually.
 */

const fs = require('fs');
const path = require('path');

const manifestPath = path.join(__dirname, '..', 'dist', 'plugin-manifest.json');

try {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

  // Add loadStylesheets array if CSS file exists
  const cssPath = path.join(__dirname, '..', 'dist', 'main.css');
  if (fs.existsSync(cssPath)) {
    manifest.loadStylesheets = ['main.css'];
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
    console.log('✓ Added loadStylesheets to plugin-manifest.json');
  } else {
    console.warn('⚠ No main.css found, skipping loadStylesheets');
  }
} catch (error) {
  console.error('✗ Failed to patch manifest:', error.message);
  process.exit(1);
}
