/**
 * Backend identity verification for the E2E/certification harness.
 *
 * WHY THIS EXISTS (finding F4).
 *
 * Tranche 6 ran the version-awareness E2E suite against `localhost:4000` and
 * got plausible-looking results. The backend answering was a container built
 * from old `main` — `version 2.0.0`, `buildTime 2026-10-06`, supported minors
 * `[4.20, 4.21]` — i.e. the pre-flip GA build, not the worktree under test.
 * The suite could not tell, because `global-setup.js` only checked that
 * something answered `/api/health`.
 *
 * Liveness is not identity. A certification run that cannot prove WHICH build
 * it is certifying is not evidence, and the failure mode is silent: the old
 * build passes every 4.20/4.21 assertion.
 *
 * WHAT IS CHECKED, and how the expectation is derived.
 *
 * Nothing here hardcodes a version or a commit. Every expectation is read from
 * the worktree at run time:
 *
 *   version        <- backend/package.json
 *   supportedMinors<- the backend's own SUPPORTED_MINORS, read from source
 *   gitSha         <- `git rev-parse HEAD`, compared ONLY when the backend
 *                     reports a real SHA (a dev server reports "unknown")
 *
 * The supported-minor check is behavioural rather than declarative: the harness
 * asks the running backend to generate for an unsupported minor and reads the
 * `supportedVersions` it returns. That is the one property the stale container
 * could not have faked, and it is exactly the property the certification is
 * about. The probe sends a client state inline, so it persists nothing.
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** The version this worktree would build. */
export function expectedVersion() {
  return JSON.parse(fs.readFileSync(path.join(REPO, 'backend', 'package.json'), 'utf8')).version;
}

/** The supported minors this worktree's backend declares, read from source. */
export function expectedSupportedMinors() {
  const src = fs.readFileSync(path.join(REPO, 'backend', 'src', 'versionPolicy.js'), 'utf8');
  const m = src.match(/const SUPPORTED_MINORS = Object\.freeze\(\[([^\]]*)\]\)/);
  if (!m) throw new Error('Could not read SUPPORTED_MINORS from backend/src/versionPolicy.js');
  return m[1].split(',').map((x) => x.trim().replace(/["']/g, '')).filter(Boolean);
}

/** HEAD of this worktree, or null when git is unavailable. */
export function expectedGitSha() {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: REPO, encoding: 'utf8' }).trim();
  } catch {
    return null;
  }
}

/**
 * Ask a running backend which minors it supports, by making it refuse one.
 * Side-effect free: the state is supplied inline and never persisted.
 */
export async function probeSupportedMinors(baseUrl, fetchImpl = fetch) {
  const state = {
    version: {
      _schemaVersion: 3,
      selectedMinor: '4.99',
      selectedPatch: '4.99.0',
      selectedChannel: 'stable-4.99',
      selectedVersion: '4.99.0',
      locked: true,
    },
    release: { channel: '4.99', patchVersion: '4.99.0', confirmed: true },
    blueprint: {
      platform: 'Bare Metal', arch: 'x86_64', clusterName: 'identity-probe',
      baseDomain: 'example.com', confirmed: true,
    },
    methodology: { method: 'Agent-Based Installer' },
    credentials: { sshPublicKey: 'ssh-rsa AAAA identity-probe' },
    globalStrategy: {
      networking: { networkType: 'OVNKubernetes', machineNetworkV4: '10.90.0.0/24' },
      mirroring: { registryFqdn: 'registry.local:5000', sources: [] },
    },
    hostInventory: { nodes: [] },
    exportOptions: { includeCredentials: false },
  };

  const res = await fetchImpl(`${baseUrl}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ state }),
  });
  const body = await res.json().catch(() => ({}));
  if (!Array.isArray(body.supportedVersions)) {
    throw new Error(
      `Backend at ${baseUrl} did not report supportedVersions when refusing 4.99 ` +
      `(status ${res.status}). It cannot be identified, so it must not be certified.`
    );
  }
  return body.supportedVersions;
}

/**
 * Compare a backend's reported identity against this worktree.
 * Pure, so it is unit-testable without a running server.
 *
 * @returns {{ok: boolean, problems: string[], checked: string[]}}
 */
export function compareIdentity({ buildInfo, supportedMinors, expected }) {
  const problems = [];
  const checked = [];

  checked.push('version');
  if (buildInfo?.version !== expected.version) {
    problems.push(
      `version mismatch: backend reports "${buildInfo?.version}", this worktree builds "${expected.version}". ` +
      `This is a different application build.`
    );
  }

  checked.push('supportedMinors');
  const got = [...(supportedMinors ?? [])].sort().join(',');
  const want = [...expected.supportedMinors].sort().join(',');
  if (got !== want) {
    problems.push(
      `supported-minor mismatch: backend supports [${got}], this worktree supports [${want}]. ` +
      `Certifying version-aware behaviour against a backend with a different supported set is meaningless.`
    );
  }

  // Only meaningful when the backend was built with APP_GIT_SHA; a dev server
  // reports "unknown", which is not a mismatch.
  const sha = buildInfo?.gitSha;
  if (sha && sha !== 'unknown' && expected.gitSha) {
    checked.push('gitSha');
    if (sha !== expected.gitSha) {
      problems.push(
        `source revision mismatch: backend was built from ${sha}, this worktree is at ${expected.gitSha}.`
      );
    }
  }

  return { ok: problems.length === 0, problems, checked };
}

/**
 * Verify a running backend corresponds to this worktree, or throw.
 * Called by `global-setup.js` before any spec runs.
 */
export async function assertBackendMatchesWorktree(baseUrl, fetchImpl = fetch) {
  const res = await fetchImpl(`${baseUrl}/api/build-info`);
  const buildInfo = await res.json();
  const supportedMinors = await probeSupportedMinors(baseUrl, fetchImpl);

  const expected = {
    version: expectedVersion(),
    supportedMinors: expectedSupportedMinors(),
    gitSha: expectedGitSha(),
  };

  const { ok, problems, checked } = compareIdentity({ buildInfo, supportedMinors, expected });
  if (!ok) {
    throw new Error(
      `REFUSING TO CERTIFY: the backend at ${baseUrl} is not this worktree.\n\n` +
      problems.map((p) => `  - ${p}`).join('\n') +
      `\n\n  backend build-info: ${JSON.stringify(buildInfo)}` +
      `\n  backend supported:  [${supportedMinors.join(', ')}]` +
      `\n\nStart a backend from this worktree (see e2e/README.md) and re-run. ` +
      `Liveness is not identity: a stale build answers /api/health perfectly well.`
    );
  }
  return { buildInfo, supportedMinors, checked };
}

/* ------------------------------------------------------------------ */
/* CLI entry                                                           */
/* ------------------------------------------------------------------ */

/**
 * Invoked as a child process by `global-setup.js`.
 *
 * Playwright transpiles files under `e2e/` through its own loader, which
 * mangles a statically-imported ESM helper ("exports is not defined in ES
 * module scope"). Running the check out-of-process keeps this module plain
 * Node ESM — the same way `scripts/t6a-backend-identity-guard.test.mjs`
 * imports it — and keeps the harness independent of that loader.
 *
 *   node e2e/helpers/backend-identity.mjs <baseUrl>
 *
 * Exit 0 on a match, 1 with the refusal on stderr otherwise.
 */
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const baseUrl = process.argv[2];
  if (!baseUrl) {
    console.error('usage: node e2e/helpers/backend-identity.mjs <baseUrl>');
    process.exit(2);
  }
  try {
    const identity = await assertBackendMatchesWorktree(baseUrl);
    console.log(
      `Backend identity verified (${identity.checked.join(', ')}): ` +
      `v${identity.buildInfo.version}, supports [${identity.supportedMinors.join(', ')}].`
    );
    process.exit(0);
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}
