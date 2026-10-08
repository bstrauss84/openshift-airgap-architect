import http from 'node:http';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

function checkUrl(url, retries = 15, delay = 2000) {
  return new Promise((resolve, reject) => {
    let attempts = 0;
    function attempt() {
      attempts++;
      http.get(url, (res) => {
        if (res.statusCode >= 200 && res.statusCode < 400) {
          resolve();
        } else if (attempts < retries) {
          setTimeout(attempt, delay);
        } else {
          reject(new Error(`${url} returned ${res.statusCode} after ${retries} attempts`));
        }
      }).on('error', () => {
        if (attempts < retries) {
          setTimeout(attempt, delay);
        } else {
          reject(new Error(`${url} unreachable after ${retries} attempts`));
        }
      });
    }
    attempt();
  });
}

export default async function globalSetup() {
  const backend = process.env.E2E_BACKEND_URL || 'http://localhost:4000';
  const frontend = process.env.E2E_FRONTEND_URL || 'http://localhost:5173';

  console.log(`Checking frontend at ${frontend}...`);
  await checkUrl(frontend);
  console.log('Frontend is up.');

  console.log(`Checking backend at ${backend}/api/health...`);
  await checkUrl(`${backend}/api/health`);
  console.log('Backend is up.');

  // Liveness is not identity (finding F4). Tranche 6 certified against a
  // container built from old `main` — version 2.0.0, supported minors
  // [4.20, 4.21] — because this setup stopped at /api/health. Refuse to run
  // against a backend that is not this worktree, rather than produce
  // confident results about the wrong build.
  // Run out-of-process: Playwright's loader transpiles files under e2e/, and
  // the helper must stay plain Node ESM so the same module can be unit-tested
  // by `scripts/t6a-backend-identity-guard.test.mjs`.
  const helper = path.join(path.dirname(fileURLToPath(import.meta.url)), 'helpers', 'backend-identity.mjs');
  try {
    const out = execFileSync('node', [helper, backend], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    console.log(out.trim());
  } catch (err) {
    throw new Error(String(err.stderr || err.stdout || err.message).trim());
  }
}
