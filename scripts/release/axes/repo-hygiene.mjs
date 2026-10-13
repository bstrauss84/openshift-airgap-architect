/**
 * AXIS: repo-hygiene — the candidate contains what it claims to and nothing else.
 *
 * Mechanical checks only. Tranche 8 §14 is explicit that broad cleanup must not
 * happen because a static tool called something unused, so this axis does not
 * attempt dead-code detection and does not propose deletions. It asserts a
 * small set of properties that are objectively true or false:
 *
 *   - no committed build output, dependency trees, caches or tool downloads;
 *   - no tracked file that `.gitignore` also claims to exclude (that pair means
 *     one of the two is wrong, and which one is a human decision);
 *   - no tracked file above a size threshold without being a known asset;
 *   - every Dockerfile that sits beside a Containerfile is either marked as
 *     unsupported or is genuinely equivalent.
 *
 * THE DOCKERFILE CHECK IS NOT COSMETIC. backend/Dockerfile carries a LEGACY /
 * UNSUPPORTED banner. frontend/Dockerfile does not: it claims "Kept in sync
 * with Containerfile" while actually building the Vite dev server with the full
 * devDependency tree — the exact configuration frontend/Containerfile's header
 * documents as a release blocker that PROD-026 removed. A reader who trusts
 * that comment reintroduces the blocker.
 */

import fs from "node:fs";
import path from "node:path";
import { pass, fail } from "../lib/status.mjs";
import { REUSE } from "../lib/evidence.mjs";
import { tryExec } from "../lib/candidate.mjs";

const ID = "repo-hygiene";

/** Paths that must never be committed. Mirrors the CI "reject committed junk" step. */
const JUNK = /node_modules\/|\/cache\/|\/tools\/|frontend\/dist\/|\.code-workspace$|^coverage\/|\.log$/;

/** Tracked files larger than this need to be a deliberate, recognisable asset. */
const LARGE_FILE_BYTES = 512 * 1024;
const ALLOWED_LARGE = /\.(png|jpg|jpeg|gif|svg|ico|woff2?)$/i;

/** A Dockerfile beside a Containerfile must say it is not the supported path. */
const LEGACY_MARKER = /LEGACY|UNSUPPORTED|DO NOT USE|DEPRECATED/i;

export default {
  id: ID,
  title: "Repository hygiene: committed artifacts, ignore consistency, build-file drift",
  required: true,
  reuse: REUSE.CANDIDATE,
  inputs: [], // whole-candidate: any added file can violate these properties

  async run({ repoRoot, store }) {
    const tracked = (tryExec("git", ["-C", repoRoot, "ls-files"]) ?? "").split("\n").filter(Boolean);
    const findings = [];

    const junk = tracked.filter((f) => JUNK.test(f));
    if (junk.length) findings.push({ check: "committed-junk", severity: "blocking", paths: junk.slice(0, 50), count: junk.length });

    // A tracked file that .gitignore also matches is a contradiction: either the
    // ignore rule is too broad or the file should not be in the index.
    const ignoredButTracked = (tryExec("git", ["-C", repoRoot, "ls-files", "--cached", "--ignored", "--exclude-standard"]) ?? "")
      .split("\n")
      .filter(Boolean);
    if (ignoredButTracked.length) {
      findings.push({
        check: "tracked-but-ignored",
        severity: "advisory",
        note: "these paths are tracked AND matched by .gitignore; one of the two is wrong",
        paths: ignoredButTracked.slice(0, 50),
        count: ignoredButTracked.length,
      });
    }

    const large = [];
    for (const rel of tracked) {
      if (ALLOWED_LARGE.test(rel)) continue;
      try {
        const { size } = fs.statSync(path.join(repoRoot, rel));
        if (size > LARGE_FILE_BYTES) large.push({ path: rel, bytes: size });
      } catch {
        /* a tracked path absent from the worktree is reported by git status, not here */
      }
    }
    if (large.length) {
      findings.push({
        check: "large-tracked-files",
        severity: "advisory",
        threshold: LARGE_FILE_BYTES,
        files: large.sort((a, b) => b.bytes - a.bytes).slice(0, 25),
        count: large.length,
      });
    }

    const drift = [];
    for (const dir of ["backend", "frontend"]) {
      const dockerfile = path.join(repoRoot, dir, "Dockerfile");
      const containerfile = path.join(repoRoot, dir, "Containerfile");
      if (fs.existsSync(dockerfile) && fs.existsSync(containerfile)) {
        const text = fs.readFileSync(dockerfile, "utf8");
        if (!LEGACY_MARKER.test(text)) {
          drift.push({
            path: `${dir}/Dockerfile`,
            note: "sits beside a Containerfile but is not marked legacy/unsupported; a reader cannot tell which is the supported build path",
          });
        }
      }
    }
    if (drift.length) findings.push({ check: "containerfile-dockerfile-drift", severity: "blocking", files: drift });

    const artifacts = [store.writeArtifact(ID, "hygiene.json", { trackedFileCount: tracked.length, findings })];
    const blocking = findings.filter((f) => f.severity === "blocking");
    const advisory = findings.filter((f) => f.severity === "advisory");

    if (blocking.length) {
      return fail(ID, `${blocking.length} blocking hygiene finding(s): ${blocking.map((f) => f.check).join(", ")}`, {
        evidence: { findings },
        artifacts,
      });
    }
    const note = advisory.length ? ` (${advisory.length} advisory: ${advisory.map((f) => f.check).join(", ")})` : "";
    return pass(ID, `${tracked.length} tracked files, no blocking hygiene findings${note}`, {
      evidence: { findings },
      artifacts,
    });
  },
};
