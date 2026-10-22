/**
 * E2E must fail closed unless an isolated environment is explicitly selected.
 *
 * Every Playwright spec resets application state (POST /api/start-over). The
 * config used to hardcode the frontend at :5173 and the helpers to default to
 * :4000 — exactly the owner's normal Compose app — so a plain
 * `npm run test:e2e` could wipe it; only an accidental version mismatch in the
 * backend-identity check stood in the way.
 *
 * These tests load the REAL playwright.config.js via `playwright test --list`,
 * which parses config and specs but runs no test, no global setup and makes no
 * network request — so they are safe to run anywhere.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

function list(extraEnv) {
  const env = { ...process.env };
  for (const k of ["E2E_FRONTEND_URL", "E2E_BACKEND_URL", "OAA_BROWSER_BACKEND_URL", "OAA_E2E_ALLOW_PROTECTED_PORTS", "CI"]) delete env[k];
  Object.assign(env, extraEnv);
  const r = spawnSync(process.execPath, [join(ROOT, "node_modules", "@playwright", "test", "cli.js"), "test", "--list"], { cwd: ROOT, env, encoding: "utf8", timeout: 120000 });
  return { status: r.status, out: `${r.stdout}\n${r.stderr}` };
}

describe("E2E isolation guard (playwright.config.js)", () => {
  test("refuses to load with no target selected", () => {
    const r = list({});
    assert.notEqual(r.status, 0);
    assert.match(r.out, /E2E refused: set E2E_FRONTEND_URL and E2E_BACKEND_URL/);
  });

  test("refuses the owner's frontend port 5173", () => {
    const r = list({ E2E_FRONTEND_URL: "http://127.0.0.1:5173", E2E_BACKEND_URL: "http://127.0.0.1:4999" });
    assert.notEqual(r.status, 0);
    assert.match(r.out, /E2E_FRONTEND_URL uses port 5173/);
  });

  test("refuses the owner's backend port 4000", () => {
    const r = list({ E2E_FRONTEND_URL: "http://127.0.0.1:5999", E2E_BACKEND_URL: "http://localhost:4000" });
    assert.notEqual(r.status, 0);
    assert.match(r.out, /E2E_BACKEND_URL uses port 4000/);
  });

  test("accepts an explicitly selected isolated environment", () => {
    const r = list({ E2E_FRONTEND_URL: "http://127.0.0.1:5999", E2E_BACKEND_URL: "http://127.0.0.1:4999" });
    assert.equal(r.status, 0, r.out.slice(-2000));
    assert.match(r.out, /Total: \d+ tests? in \d+ files?/);
  });

  test("protected ports need an explicit disposable-instance opt-in", () => {
    const r = list({ E2E_FRONTEND_URL: "http://127.0.0.1:5173", E2E_BACKEND_URL: "http://127.0.0.1:4000", OAA_E2E_ALLOW_PROTECTED_PORTS: "1" });
    assert.equal(r.status, 0, r.out.slice(-2000));
  });
});

describe("no e2e file falls back to the owner's ports", () => {
  test("helpers, global setup and specs carry no localhost:4000/5173 default", () => {
    const offenders = [];
    const walk = (dir) => {
      for (const name of readdirSync(dir)) {
        const full = join(dir, name);
        if (statSync(full).isDirectory()) { walk(full); continue; }
        if (!/\.(m?js)$/.test(name)) continue;
        readFileSync(full, "utf8").split("\n").forEach((line, i) => {
          if (/^\s*(\*|\/\/)/.test(line)) return; // comments may describe the history
          if (/localhost:(4000|5173)/.test(line)) offenders.push(`${full.replace(ROOT + "/", "")}:${i + 1}`);
        });
      }
    };
    walk(join(ROOT, "e2e"));
    for (const f of ["playwright.config.js"]) {
      readFileSync(join(ROOT, f), "utf8").split("\n").forEach((line, i) => {
        if (!/^\s*(\*|\/\/)/.test(line) && /localhost:(4000|5173)/.test(line)) offenders.push(`${f}:${i + 1}`);
      });
    }
    assert.deepEqual(offenders, []);
  });
});
