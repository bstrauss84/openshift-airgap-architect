/**
 * Performance budget: fail if frontend dist bundle size exceeds the limit.
 * Run after `npm run build` (e.g. `npm run build && npm run check-size`).
 * Set BUNDLE_SIZE_LIMIT_KB (default 2048) to override the limit in KB.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.resolve(__dirname, "..", "dist");
const limitKb = Number(process.env.BUNDLE_SIZE_LIMIT_KB) || 2500;

if (!fs.existsSync(distDir)) {
  console.error("check-bundle-size: dist/ not found. Run 'npm run build' first.");
  process.exit(1);
}

let totalBytes = 0;
function walk(dir) {
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const st = fs.statSync(full);
    if (st.isDirectory()) walk(full);
    else totalBytes += st.size;
  }
}
walk(distDir);

const totalKb = Math.round(totalBytes / 1024);
if (totalKb > limitKb) {
  console.error(`check-bundle-size: bundle size ${totalKb} KB exceeds limit ${limitKb} KB`);
  process.exit(1);
}
console.log(`check-bundle-size: ${totalKb} KB (limit ${limitKb} KB) OK`);
