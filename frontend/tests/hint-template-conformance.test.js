/**
 * OpenShift Airgap Architect - Test Suite
 *
 * @author Bill Strauss
 *
 * Developed with AI assistance from Claude (Anthropic) and Cursor AI.
 */

/**
 * Every field tooltip must use the app's structured help template.
 *
 * Reported in 7C.4B: the provisioning-network CIDR and cluster-provisioning-IP
 * tooltips showed a single line of unstructured prose instead of the usual
 * sectioned help. The cause was a conditional hint whose Disabled-mode branch
 * had never been written to the template:
 *
 *     hint={provisioningMode === "Disabled"
 *       ? "When Disabled, provisioning services use the bare-metal network..."   // 0 sections
 *       : "CIDR (Classless Inter-Domain Routing) notation ... **What is this:** ..."}
 *
 * The gold-standard branch already documented all three provisioning modes, so
 * the downgrade was redundant as well as inconsistent. Both were removed.
 *
 * WHY A TERNARY-AWARE SCAN. The obvious check — look at the literal after
 * `hint=` — cannot see this defect at all, because a ternary does not start
 * with a quote. The first version of this scan reported 35 "sub-standard"
 * hints and missed both of the ones actually being complained about, while
 * flagging concatenated gold-standard hints as empty. This parses the whole
 * balanced `hint={...}` expression and scores EACH BRANCH a user can actually
 * see, which is the only unit that matters: a user reads one branch.
 *
 * THE BAR is deliberately structural, not editorial. A hint must carry at
 * least MIN_SECTIONS `**Header:**` sections. That catches an unstructured
 * paragraph without pretending to judge whether the prose is any good, and it
 * is cheap enough that nobody is tempted to delete it.
 *
 * ALLOWED_THIN is an explicit, enumerated list of short hints on simple fields
 * that read well with fewer sections. It is a budget, not an escape hatch: a
 * NEW hint below the bar fails, and an entry that climbs above the bar also
 * fails so the list cannot rot.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../src");
const MIN_SECTIONS = 3;

/**
 * Hints that are deliberately short. Keyed by file and a stable text excerpt
 * rather than a line number, so ordinary edits elsewhere do not churn it.
 */
const ALLOWED_THIN = [
  ["components/NodeDrawerAgentContent.jsx", "Configure extra network interfaces beyond the primary"],
  ["steps/GlobalStrategyStep.jsx", "How the cluster API and ingress endpoints are published"],
  ["steps/NetworkingV2Step.jsx", "Second API VIP for dual-stack"],
  ["steps/NetworkingV2Step.jsx", "Second Ingress VIP for dual-stack"],
  ["steps/PlatformSpecificsStep.jsx", "Choose how Azure virtual networking is configured"],
  ["steps/PlatformSpecificsStep.jsx", "Name of the existing Azure VNet to install the cluster into"],
  ["steps/PlatformSpecificsStep.jsx", "Name of the existing subnet within the VNet for control plane"],
  ["steps/PlatformSpecificsStep.jsx", "Names of existing subnets"],
  ["steps/PlatformSpecificsStep.jsx", "Name of the existing subnet within the VNet for compute"],
  ["steps/PlatformSpecificsStep.jsx", "Controls whether cluster endpoints are publicly accessible"],
  ["steps/PlatformSpecificsStep.jsx", "Password for the Prism Central username specified above"]
];

/** Walk the source tree for component files. */
function sourceFiles(dir, acc = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== "node_modules") sourceFiles(full, acc);
    } else if (/\.jsx?$/.test(entry.name)) acc.push(full);
  }
  return acc;
}

/** The balanced `{...}` expression starting at `start`, quote-aware. */
function balancedExpr(src, start) {
  let depth = 0;
  let quote = null;
  let out = "";
  for (let i = start; i < src.length; i++) {
    const c = src[i];
    const prev = src[i - 1];
    if (quote) {
      out += c;
      if (c === quote && prev !== "\\") quote = null;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") { quote = c; out += c; continue; }
    if (c === "{") { depth++; if (depth === 1) continue; }
    if (c === "}") { depth--; if (depth === 0) return out; }
    if (depth >= 1) out += c;
  }
  return out;
}

/** Split a top-level ternary into the branches a user can actually see. */
function visibleBranches(expr) {
  let depth = 0;
  let quote = null;
  let q = -1;
  let colon = -1;
  for (let i = 0; i < expr.length; i++) {
    const c = expr[i];
    const prev = expr[i - 1];
    if (quote) { if (c === quote && prev !== "\\") quote = null; continue; }
    if (c === '"' || c === "'" || c === "`") { quote = c; continue; }
    if (c === "(" || c === "[") depth++;
    if (c === ")" || c === "]") depth--;
    if (depth === 0 && c === "?" && q === -1) q = i;
    if (depth === 0 && c === ":" && q !== -1 && colon === -1) colon = i;
  }
  if (q === -1 || colon === -1) return [expr];
  return [expr.slice(q + 1, colon), expr.slice(colon + 1)];
}

/** Every hint branch in the tree, with its section count. */
function collectHints() {
  const rows = [];
  for (const file of sourceFiles(SRC)) {
    const src = fs.readFileSync(file, "utf8");
    const rel = path.relative(SRC, file);
    let idx = 0;
    while ((idx = src.indexOf("hint=", idx)) !== -1) {
      const brace = src.indexOf("{", idx);
      let expr = "";
      if (brace !== -1 && brace <= idx + 6) expr = balancedExpr(src, brace);
      else expr = src.slice(idx + 5).match(/^(["'`])(?:[^\\]|\\.)*?\1/s)?.[0] || "";
      if (expr) {
        const line = src.slice(0, idx).split("\n").length;
        for (const branch of visibleBranches(expr)) {
          const literals = (branch.match(/`[^`]*`|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/gs) || []).join(" ");
          if (!literals.trim()) continue;
          rows.push({
            file: rel,
            line,
            sections: (branch.match(/\*\*[^*]+:\*\*/g) || []).length,
            text: literals.replace(/\\n|\n/g, " ").replace(/\s+/g, " ")
          });
        }
      }
      idx += 5;
    }
  }
  return rows;
}

const allowedFor = (row) =>
  ALLOWED_THIN.find(([file, excerpt]) => row.file === file && row.text.includes(excerpt));

describe("field tooltips follow the structured help template", () => {
  const hints = collectHints();

  it("finds the hints — the scan cannot pass by seeing nothing", () => {
    // The first version of this scan silently missed ternary branches.
    expect(hints.length).toBeGreaterThan(200);
    expect(hints.some((h) => h.file === "steps/PlatformSpecificsStep.jsx")).toBe(true);
  });

  it("sees BOTH branches of a conditional hint", () => {
    // The property that makes this scan able to catch the reported defect.
    const expr = 'cond ? "a **X:** b **Y:** c" : "plain prose"';
    expect(visibleBranches(expr)).toHaveLength(2);
  });

  it("every hint carries at least three sections, or is an enumerated exception", () => {
    const offenders = hints
      .filter((h) => h.sections < MIN_SECTIONS && !allowedFor(h))
      .map((h) => `${h.file}:${h.line} (${h.sections} sections) ${h.text.slice(0, 90)}`);
    expect(offenders, "new or edited hints must use the structured template").toEqual([]);
  });

  it("no hint is wholly unstructured", () => {
    // The exact shape of the reported defect: a branch with zero sections.
    const bare = hints
      .filter((h) => h.sections === 0)
      .map((h) => `${h.file}:${h.line} ${h.text.slice(0, 90)}`);
    expect(bare).toEqual([]);
  });

  it("the provisioning fields the human reported are conformant in EVERY mode", () => {
    // They were conditional, and only the Disabled branch was substandard.
    const provisioning = hints.filter(
      (h) =>
        h.file === "steps/PlatformSpecificsStep.jsx" &&
        (h.text.includes("provisioning network's IP address range") ||
          h.text.includes("provisioning services (DHCP, TFTP, HTTP) listen"))
    );
    expect(provisioning.length).toBeGreaterThan(0);
    for (const hint of provisioning) expect(hint.sections).toBeGreaterThanOrEqual(MIN_SECTIONS);
  });

  it("the thin-hint budget does not rot", () => {
    // An entry that has since been improved must leave the list.
    const stale = ALLOWED_THIN.filter(([file, excerpt]) => {
      const matches = hints.filter((h) => h.file === file && h.text.includes(excerpt));
      return matches.length > 0 && matches.every((h) => h.sections >= MIN_SECTIONS);
    }).map(([file, excerpt]) => `${file}: ${excerpt}`);
    expect(stale, "these hints now meet the bar — remove them from ALLOWED_THIN").toEqual([]);
  });

  it("every thin-hint entry still matches something", () => {
    // A stale excerpt would silently widen the budget.
    const orphans = ALLOWED_THIN.filter(
      ([file, excerpt]) => !hints.some((h) => h.file === file && h.text.includes(excerpt))
    ).map(([file, excerpt]) => `${file}: ${excerpt}`);
    expect(orphans, "these ALLOWED_THIN entries match no hint — delete them").toEqual([]);
  });
});
