/**
 * AXES: dependencies-shipped and dependencies-builder.
 *
 * TWO AXES, NOT ONE, and the split is the point.
 *
 * SCOPE IS DERIVED FROM THE CONTAINERFILE, NOT ASSUMED. This is the lesson of
 * v2.1 Tranche 7C: the security gate used to audit `--omit=dev` everywhere and
 * call the result "production dependencies", which was true for the backend
 * (`npm ci --omit=dev`) and false for the frontend, whose image then ran the
 * Vite dev server with its whole devDependency tree resident. The gate
 * reported zero while a real build reported 15 findings.
 *
 * WHY THE BUILDER SCOPE IS ITS OWN RELEASE-OWNED AXIS. A single axis that
 * PASSes on clean shipped dependencies while merely *mentioning* 2 critical
 * and 8 high builder advisories cannot keep them out of a GREEN release — the
 * findings are recorded and then have no mechanical consequence. DOC-207
 * assigns them to 8G, so until 8G resolves or disposes of them they must hold
 * their own axis non-green. The failure mode here is the mirror image of 7C's:
 * declaring the frontend clean because its runtime image ships no npm tree,
 * while real critical advisories sit in the build path unaddressed.
 *
 * Builder dependencies are a genuine supply-chain exposure: they execute on
 * the build host with full access to the source tree and the resulting
 * artifact. "Not shipped" bounds the blast radius; it does not remove it.
 *
 * `--package-lock-only` makes the audit read the committed lockfile rather
 * than whatever happens to be installed, so the result is a property of the
 * candidate instead of a property of the operator's disk.
 */

import fs from "node:fs";
import path from "node:path";
import { pass, fail, incomplete } from "../lib/status.mjs";
import { REUSE } from "../lib/evidence.mjs";
import { run } from "../lib/exec.mjs";

/**
 * Shared vocabulary for npm install commands and production-only flags.
 *
 * There are TWO independent implementations of this classification — this one
 * and `shipped_install_scope()` in scripts/security/tranche-security-gate.sh.
 * They disagreed on `--only=prod` and on the `npm i` short form, which was
 * masked while both returned "all" unconditionally for a copied tree. Once
 * both started resolving the builder stage the flag set became load-bearing
 * and the drift became live, with the shell gate on the PERMISSIVE side.
 * Keep these two lists and that function in step; parity cases are asserted
 * in scripts/release/axes.test.mjs and scripts/validate-frontend-runtime.test.js.
 *
 * `[^\n&|]*` rather than `[^\n]*`: a chained `RUN npm ci --omit=dev && npm ci`
 * must be read as TWO installs. Swallowing the whole line matched only the
 * first, found `--omit=dev` in it, and reported "prod" for a stage that then
 * installed the full dev tree. The shell splits on `&&`/`|` for the same
 * reason, so this also keeps the two in step.
 */
const NPM_INSTALL_RE = /(?:RUN|&&|\|\|?|^)[^\n&|]*\bnpm\s+(ci|install|i)\b[^\n&|]*/g;
const PROD_ONLY_FLAG_RE = /--omit=dev|--production|--only=prod/;

/**
 * Does the FINAL stage of a Containerfile install npm packages?
 *
 * Stage awareness is the whole point: a multi-stage build legitimately runs a
 * full `npm ci` in a builder and ships only its output. Only directives after
 * the last FROM count, plus any `COPY --from=` that drags node_modules into
 * the final stage, and the final stage's OWN installs on top of it. Comments
 * are stripped first so an explanation above a directive cannot be mistaken
 * for the directive.
 */

export function shippedInstallScope(containerfileText) {
  const lines = containerfileText
    .split("\n")
    .map((l) => l.replace(/^\s*#.*$/, ""))
    .join("\n");
  const fromIdx = lines.lastIndexOf("\nFROM ");
  const finalStage = fromIdx === -1 ? lines : lines.slice(fromIdx);

  // `--from=` need not be the first flag: `COPY --chown=1001:0 --from=builder`
  // is idiomatic, and requiring `--from` to come first classified it as "none"
  // — "ships no npm dependency surface" — for a stage that ships the whole
  // tree. In the shell gate "none" is an unconditional PASS, so that shape
  // silently skipped the audit entirely.
  const copied = finalStage.match(/COPY(?:\s+--\S+)*\s+--from=(\S+)[^\n]*node_modules/);
  const ownInstalls = finalStage.match(NPM_INSTALL_RE) ?? [];

  if (copied) {
    // A copied tree ships whatever the stage that BUILT it installed. Reading
    // this as unconditionally "all" was accurate only while every such copy
    // came from a bare `npm ci`: a builder that ran `--omit=dev` ships a
    // production-only tree, and reporting it as "all" makes the dependencies
    // axis audit dev advisories as though they were shipped.
    //
    // Unresolvable source => "all". That is the safe direction: this value
    // decides whether dev advisories count against the release, so an unknown
    // provenance must over-report, never under-report.
    const fromStage = installScopeOfStage(lines, copied[1]);
    // The final stage may ALSO install on top of what it copied. Returning the
    // builder's scope alone made `COPY --from=builder …` + `RUN npm i express`
    // report "prod" for a stage that installs the full dev tree — strictly
    // weaker than the pre-8D behaviour, which returned "all" for any copy.
    // Both sources ship, so the result is the weaker of the two.
    if (!ownInstalls.length) return fromStage;
    return fromStage === "prod" && installScopeOf(ownInstalls) === "prod" ? "prod" : "all";
  }
  if (!ownInstalls.length) return "none";
  return installScopeOf(ownInstalls);
}

/** "prod" only when every install in the list omits dev dependencies. */
function installScopeOf(installCommands) {
  if (!installCommands.length) return "none";
  return installCommands.every((cmd) => PROD_ONLY_FLAG_RE.test(cmd)) ? "prod" : "all";
}

/**
 * Scope of the npm installs inside a named build stage.
 *
 * @param {string} text  comment-stripped Containerfile
 * @param {string} stage the `--from=` target: a stage name, or an index
 */
function installScopeOfStage(text, stage) {
  // `(?:--\S+\s+)*` skips FROM flags. Without it `FROM --platform=linux/amd64
  // node AS builder` bound "--platform=linux/amd64" as the image and never saw
  // the alias, so the stage was unresolvable and the result fell back to "all"
  // while the shell implementation resolved it to "prod". Safe direction, but
  // a divergence, and the comment above claims these two are in step.
  const stageStarts = [...text.matchAll(/^FROM\s+(?:--\S+\s+)*(\S+)(?:\s+AS\s+(\S+))?/gim)].map((m) => ({
    index: m.index,
    alias: m[2] ? m[2].toLowerCase() : null,
  }));
  if (!stageStarts.length) return "all";

  let which = stageStarts.findIndex((s) => s.alias && s.alias === String(stage).toLowerCase());
  if (which === -1 && /^\d+$/.test(String(stage))) which = Number(stage);
  if (which === -1 || which >= stageStarts.length) return "all"; // unknown source

  const start = stageStarts[which].index;
  const end = which + 1 < stageStarts.length ? stageStarts[which + 1].index : text.length;
  const body = text.slice(start, end);
  const installs = body.match(NPM_INSTALL_RE) ?? [];
  // A stage that copies node_modules but installs nothing itself cannot be
  // vouched for from here.
  if (!installs.length) return "all";
  return installScopeOf(installs);
}

function audit(repoRoot, dir, omitDev) {
  const args = ["audit", "--json", "--package-lock-only", ...(omitDev ? ["--omit=dev"] : [])];
  const res = run("npm", args, { cwd: path.join(repoRoot, dir), timeoutMs: 10 * 60_000 });
  // `npm audit` exits non-zero when it FINDS vulnerabilities, so the exit code
  // is not an error signal. Only unparseable output means the audit failed.
  try {
    const parsed = JSON.parse(res.stdout);
    return { ok: true, counts: parsed?.metadata?.vulnerabilities ?? {}, exitCode: res.status };
  } catch {
    return { ok: false, exitCode: res.status, stderr: res.stderr.slice(0, 2000) };
  }
}

const COMPONENTS = [
  { name: "backend", dir: "backend", containerfile: "backend/Containerfile" },
  { name: "frontend", dir: "frontend", containerfile: "frontend/Containerfile" },
];

const DEP_INPUTS = [
  "backend/package.json",
  "backend/package-lock.json",
  "backend/Containerfile",
  "frontend/package.json",
  "frontend/package-lock.json",
  "frontend/Containerfile",
];

const sev = (c) => (c?.critical ?? 0) + (c?.high ?? 0);

/**
 * npm audit queries the registry's live advisory service, which exposes no
 * snapshot identifier. Its answer can therefore change with the candidate
 * unchanged, and no context key can faithfully represent the data it
 * consulted — so the result is never reused.
 */
const DEP_REUSE = REUSE.NEVER;

// ---------------------------------------------------------------------------

export const shipped = {
  id: "dependencies-shipped",
  title: "Dependency advisories in the SHIPPED runtime surface",
  required: true,
  inputs: DEP_INPUTS,
  reuse: DEP_REUSE,

  async run({ repoRoot, store }) {
    const findings = [];
    for (const c of COMPONENTS) {
      const cfPath = path.join(repoRoot, c.containerfile);
      if (!fs.existsSync(cfPath)) {
        findings.push({ component: c.name, ok: false, reason: `${c.containerfile} not found` });
        continue;
      }
      const scope = shippedInstallScope(fs.readFileSync(cfPath, "utf8"));
      const audited =
        scope === "none"
          ? { ok: true, counts: {}, note: "final stage installs no npm packages" }
          : audit(repoRoot, c.dir, scope === "prod");
      findings.push({ component: c.name, shippedScope: scope, ...audited });
    }

    const artifacts = [store.writeArtifact(shipped.id, "shipped-advisories.json", findings)];
    const broken = findings.filter((f) => f.ok === false);
    if (broken.length) {
      return incomplete(shipped.id, `npm audit could not be completed for: ${broken.map((f) => f.component).join(", ")}`, {
        evidence: { findings },
        artifacts,
      });
    }

    const blocking = findings.filter((f) => sev(f.counts) > 0);
    if (blocking.length) {
      const detail = blocking.map((f) => `${f.component}: ${f.counts.critical ?? 0} critical, ${f.counts.high ?? 0} high`).join("; ");
      return fail(shipped.id, `shipped runtime advisories — ${detail}`, { evidence: { findings }, artifacts });
    }
    const scopes = findings.map((f) => `${f.component}=${f.shippedScope}`).join(", ");
    return pass(shipped.id, `no critical/high advisories in shipped scope (${scopes})`, { evidence: { findings }, artifacts });
  },
};

// ---------------------------------------------------------------------------

export const builder = {
  id: "dependencies-builder",
  title: "Dependency advisories in the BUILD / supply-chain surface",
  required: true,
  inputs: DEP_INPUTS,
  reuse: DEP_REUSE,

  async run({ repoRoot, store }) {
    const findings = [];
    for (const c of COMPONENTS) {
      findings.push({ component: c.name, ...audit(repoRoot, c.dir, false) });
    }

    const artifacts = [store.writeArtifact(builder.id, "builder-advisories.json", findings)];
    const broken = findings.filter((f) => !f.ok);
    if (broken.length) {
      return incomplete(builder.id, `npm audit could not be completed for: ${broken.map((f) => f.component).join(", ")}`, {
        evidence: { findings },
        artifacts,
      });
    }

    const blocking = findings.filter((f) => sev(f.counts) > 0);
    if (blocking.length) {
      const detail = blocking.map((f) => `${f.component}: ${f.counts.critical ?? 0} critical, ${f.counts.high ?? 0} high`).join("; ");
      return fail(
        builder.id,
        `build-host advisories unresolved — ${detail} (DOC-207; owned by 8G, not shipped but release-owned)`,
        {
          evidence: {
            findings,
            backlogItem: "DOC-207",
            closesIn: "8G",
            scopeNote:
              "These packages execute on the build host with access to the source tree and the produced artifact. They are absent from the shipped runtime image, which bounds the blast radius but does not remove the exposure.",
          },
          artifacts,
        },
      );
    }
    return pass(builder.id, "no critical/high advisories in the build surface", { evidence: { findings }, artifacts });
  },
};

export default [shipped, builder];
