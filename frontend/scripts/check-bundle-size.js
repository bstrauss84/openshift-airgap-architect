/**
 * Frontend bundle budget (FQ-10).
 *
 * Replaces a single recursive byte count over dist/, which was misleading in two ways:
 * it counted static artwork as executable weight (three PNGs were 24.5% of the measured
 * total), and it could not distinguish code the browser must download before the app
 * runs from per-minor data fetched on demand.
 *
 * Three metrics, two of them gating:
 *
 *   A  EAGER  (gating)      initial application JS + CSS: the entry chunk, every chunk
 *                           statically imported by it, and all CSS. This is what a user
 *                           waits for before the app is usable.
 *   B  LAZY   (gating)      the largest single on-demand chunk. Per-minor catalog data
 *                           lives here. Gated per-chunk, not cumulatively, because
 *                           supported minors are cumulative by design (R8) and a
 *                           cumulative budget would fail purely for supporting more
 *                           OpenShift versions.
 *   C  TOTAL  (reported)    every byte in dist/, artwork included. Informational: useful
 *                           for packaging and transfer size, wrong as a performance gate.
 *
 * Thresholds and their derivation live in bundle-budget.json next to this script, so the
 * numbers are reviewable rather than buried in code.
 *
 * Usage:  npm run build && npm run check-size
 *         --json   machine-readable output
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.resolve(__dirname, "..", "dist");
const budgetPath = path.resolve(__dirname, "bundle-budget.json");

const KB = (bytes) => Math.round(bytes / 1024);

if (!fs.existsSync(distDir)) {
  console.error("check-bundle-size: dist/ not found. Run 'npm run build' first.");
  process.exit(1);
}

const budget = JSON.parse(fs.readFileSync(budgetPath, "utf8"));

function walk(dir, acc = []) {
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const st = fs.statSync(full);
    if (st.isDirectory()) walk(full, acc);
    else acc.push({ path: path.relative(distDir, full), bytes: st.size });
  }
  return acc;
}

const files = walk(distDir);

const indexHtmlPath = path.join(distDir, "index.html");
if (!fs.existsSync(indexHtmlPath)) {
  console.error("check-bundle-size: dist/index.html not found; cannot determine the eager set.");
  process.exit(1);
}
const indexHtml = fs.readFileSync(indexHtmlPath, "utf8");

/**
 * The eager set is derived from index.html, not guessed from filenames.
 *
 * Vite emits <script type="module" src> for the entry and <link rel="modulepreload">
 * for every chunk the entry statically imports; a dynamically imported chunk gets
 * neither. Reading the document is therefore the honest definition of "what the browser
 * fetches before the app runs", and it cannot be gamed by renaming a chunk.
 */
const referenced = new Set();
for (const re of [
  /<script[^>]+src="\/?([^"]+\.js)"/g,
  /<link[^>]+rel="modulepreload"[^>]+href="\/?([^"]+\.js)"/g,
  /<link[^>]+rel="stylesheet"[^>]+href="\/?([^"]+\.css)"/g,
]) {
  for (const m of indexHtml.matchAll(re)) referenced.add(m[1].replace(/^\.\//, ""));
}

const isCode = (f) => f.path.endsWith(".js") || f.path.endsWith(".css");
const codeFiles = files.filter(isCode);
const eagerFiles = codeFiles.filter((f) => referenced.has(f.path));
const lazyFiles = codeFiles.filter((f) => !referenced.has(f.path));

// CSS is always eager in this build (a single stylesheet link). Guard the assumption
// rather than assume it: an unreferenced stylesheet would silently leave the budget.
const strayCss = codeFiles.filter((f) => f.path.endsWith(".css") && !referenced.has(f.path));

const eagerBytes = eagerFiles.reduce((n, f) => n + f.bytes, 0);
const largestLazy = lazyFiles.reduce((max, f) => (f.bytes > max.bytes ? f : max), { path: "(none)", bytes: 0 });
const totalBytes = files.reduce((n, f) => n + f.bytes, 0);
const nonCodeBytes = files.filter((f) => !isCode(f)).reduce((n, f) => n + f.bytes, 0);

const results = [
  {
    id: "A",
    label: "eager app JS+CSS",
    actualKb: KB(eagerBytes),
    limitKb: budget.eagerAppJsCssKb,
    gating: true,
  },
  {
    id: "B",
    label: `largest lazy chunk (${largestLazy.path})`,
    actualKb: KB(largestLazy.bytes),
    limitKb: budget.largestLazyChunkKb,
    gating: true,
  },
  {
    id: "C",
    label: "total dist (informational)",
    actualKb: KB(totalBytes),
    limitKb: null,
    gating: false,
  },
];

const failures = results.filter((r) => r.gating && r.actualKb > r.limitKb);

if (process.argv.includes("--json")) {
  console.log(
    JSON.stringify(
      {
        results,
        eagerFiles: eagerFiles.map((f) => f.path).sort(),
        lazyChunkCount: lazyFiles.length,
        nonCodeKb: KB(nonCodeBytes),
        pass: failures.length === 0,
      },
      null,
      2
    )
  );
} else {
  console.log("Frontend bundle budget");
  for (const r of results) {
    const limit = r.limitKb === null ? "reported" : `limit ${r.limitKb} KB`;
    const mark = !r.gating ? "·" : r.actualKb > r.limitKb ? "FAIL" : "ok";
    console.log(`  ${r.id}  ${r.label.padEnd(44)} ${String(r.actualKb).padStart(5)} KB  (${limit}) ${mark}`);
  }
  console.log(`     lazy chunks: ${lazyFiles.length}    non-code assets: ${KB(nonCodeBytes)} KB (not counted in A or B)`);
}

if (strayCss.length) {
  console.error(
    `check-bundle-size: stylesheet(s) not referenced from index.html: ${strayCss
      .map((f) => f.path)
      .join(", ")}. Refusing to report a budget that silently excludes CSS.`
  );
  process.exit(1);
}

if (eagerFiles.length === 0) {
  console.error("check-bundle-size: no eager files resolved from index.html; the parser is wrong, not the bundle.");
  process.exit(1);
}

if (failures.length) {
  for (const f of failures) {
    console.error(`check-bundle-size: ${f.id} ${f.label} ${f.actualKb} KB exceeds limit ${f.limitKb} KB`);
  }
  console.error(
    "\nDo not raise these limits to go green. See frontend/scripts/bundle-budget.json for the derivation,\n" +
      "and docs/minor-release/4.22/FQ10_BUNDLE_BUDGET_EVIDENCE.md for why the eager budget must stay flat\n" +
      "as supported minors accumulate."
  );
  process.exit(1);
}
