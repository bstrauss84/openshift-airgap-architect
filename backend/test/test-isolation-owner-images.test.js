/**
 * Test-isolation boundary (v2.2.0 M7): a backend test run must never read or
 * export the operator's own container images.
 *
 * M6 found a suite run `podman save`-ing localhost/openshift-airgap-architect-*:latest
 * from the operator's default storage: a test exercised the high-side runtime
 * package in "auto" mode on a host that has podman. The runner now defaults to
 * AIRGAP_RUNTIME_PACKAGE_IMAGE_EXPORT_MODE=none and test-owned image names.
 *
 * Discriminating: fake `podman` / `docker` executables first on PATH record
 * every call. Under the runner's defaults nothing may be recorded; under
 * "auto" (positive control) the fakes must be called — and then only with the
 * test-owned image names, never the production tags.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const runtimePackageUrl = new URL("../src/runtimePackage.js", import.meta.url).href;
const PRODUCTION = /openshift-airgap-architect-(backend|frontend):latest/;
const RUNNER_DEFAULTS = {
  AIRGAP_RUNTIME_PACKAGE_IMAGE_EXPORT_MODE: "none",
  RUNTIME_PACKAGE_BACKEND_IMAGE: "localhost/oaa-test-owned-backend:never-built",
  RUNTIME_PACKAGE_FRONTEND_IMAGE: "localhost/oaa-test-owned-frontend:never-built"
};

function fakeEngines() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "oaa-fake-engine-"));
  const log = path.join(dir, "calls.log");
  for (const name of ["podman", "docker"]) {
    const exe = path.join(dir, name);
    // Records argv; "save -o <file>" writes a small file so the package completes.
    fs.writeFileSync(exe, `#!/bin/sh
echo "${name} $*" >> "${log}"
prev=""; for a in "$@"; do if [ "$prev" = "-o" ]; then echo fake > "$a"; fi; prev="$a"; done
exit 0
`, { mode: 0o755 });
  }
  return { dir, log, calls: () => (fs.existsSync(log) ? fs.readFileSync(log, "utf8").trim().split("\n").filter(Boolean) : []) };
}

function stageInChild(env, fake) {
  const script = `
    import { createRuntimePackageArtifacts } from ${JSON.stringify(runtimePackageUrl)};
    import fs from "node:fs"; import os from "node:os"; import path from "node:path";
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "oaa-isolation-data-"));
    const state = { exportOptions: { includeHighSideRuntimePackage: true } };
    const r = createRuntimePackageArtifacts({ state, exportOptions: state.exportOptions, runPayload: { state }, dataDir });
    console.log(JSON.stringify({ included: r.included, notes: r.notes }));
    r.cleanup?.(); fs.rmSync(dataDir, { recursive: true, force: true });
  `;
  const res = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
    cwd: here,
    encoding: "utf8",
    env: { PATH: `${fake.dir}:${process.env.PATH}`, HOME: os.tmpdir(), NODE_ENV: "test", ...env }
  });
  assert.equal(res.status, 0, res.stderr);
  return JSON.parse(res.stdout.trim().split("\n").pop());
}

test("the backend test runner (`npm test`) defaults to no engine and test-owned image names", () => {
  const script = JSON.parse(fs.readFileSync(path.join(here, "..", "package.json"), "utf8")).scripts.test;
  for (const [k, v] of Object.entries(RUNNER_DEFAULTS)) assert.ok(script.includes(`${k}=\${${k}:-${v}}`), `${k} default missing from the test script`);
  if (process.env.npm_lifecycle_event === "test") {
    for (const [k, v] of Object.entries(RUNNER_DEFAULTS)) assert.equal(process.env[k], v, k);
  }
});

test("with the runner's defaults no container engine is called at all", () => {
  const fake = fakeEngines();
  try {
    const r = stageInChild(RUNNER_DEFAULTS, fake);
    assert.equal(r.included, false);
    assert.match(r.notes.join(" "), /AIRGAP_RUNTIME_PACKAGE_IMAGE_EXPORT_MODE=none/);
    assert.deepEqual(fake.calls(), []);
  } finally {
    fs.rmSync(fake.dir, { recursive: true, force: true });
  }
});

test("positive control: auto mode does call the engine — and only with the configured, test-owned names", () => {
  const fake = fakeEngines();
  try {
    stageInChild({ ...RUNNER_DEFAULTS, AIRGAP_RUNTIME_PACKAGE_IMAGE_EXPORT_MODE: "auto" }, fake);
    const calls = fake.calls();
    assert.ok(calls.some((c) => /^podman save /.test(c)), `the fake engine must see the export: ${calls.join(" | ")}`);
    assert.ok(calls.every((c) => !PRODUCTION.test(c)), `a production tag reached the engine: ${calls.join(" | ")}`);
    assert.ok(calls.some((c) => c.includes(RUNNER_DEFAULTS.RUNTIME_PACKAGE_BACKEND_IMAGE)));
  } finally {
    fs.rmSync(fake.dir, { recursive: true, force: true });
  }
});
