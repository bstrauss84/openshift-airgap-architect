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
 * Does the FINAL stage of a Containerfile install npm packages?
 *
 * Stage awareness is the whole point: a multi-stage build legitimately runs a
 * full `npm ci` in a builder and ships only its output. Only directives after
 * the last FROM count, plus any `COPY --from=` that drags node_modules into
 * the final stage. Comments are stripped first so an explanation above a
 * directive cannot be mistaken for the directive.
 */
export function shippedInstallScope(containerfileText) {
  const lines = containerfileText
    .split("\n")
    .map((l) => l.replace(/^\s*#.*$/, ""))
    .join("\n");
  const fromIdx = lines.lastIndexOf("\nFROM ");
  const finalStage = fromIdx === -1 ? lines : lines.slice(fromIdx);

  if (/COPY\s+--from=[^\n]*node_modules/.test(finalStage)) return "all";
  const install = finalStage.match(/RUN[^\n]*npm\s+(ci|install)[^\n]*/g) ?? [];
  if (!install.length) return "none";
  return install.every((cmd) => /--omit=dev|--production/.test(cmd)) ? "prod" : "all";
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
