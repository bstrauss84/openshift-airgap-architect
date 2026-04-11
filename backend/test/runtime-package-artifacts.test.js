import { test } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRuntimePackageArtifacts } from "../src/runtimePackage.js";

test("runtime package artifacts encode localhost ports, SELinux-safe payload mount, and startup output", () => {
  const prevMode = process.env.AIRGAP_RUNTIME_PACKAGE_IMAGE_EXPORT_MODE;
  process.env.AIRGAP_RUNTIME_PACKAGE_IMAGE_EXPORT_MODE = "fixture";
  const artifacts = createRuntimePackageArtifacts({
    state: {},
    exportOptions: {
      includeHighSideRuntimePackage: true,
      runtimePackageFrontendPort: 55173,
      runtimePackageBackendPort: 54000
    },
    runPayload: {
      schemaVersion: 2,
      sourceProfile: "connected-authoring",
      state: {}
    },
    dataDir: os.tmpdir()
  });
  try {
    assert.strictEqual(artifacts.requested, true);
    const composeEntry = artifacts.entries.find((entry) => entry.relativePath === "compose/high-side.compose.yml");
    const startEntry = artifacts.entries.find((entry) => entry.relativePath === "launch/start-high-side.sh");
    const manifestEntry = artifacts.entries.find((entry) => entry.relativePath === "HIGH_SIDE_RUNTIME_PACKAGE_MANIFEST.json");
    assert.ok(composeEntry?.absolutePath);
    assert.ok(startEntry?.absolutePath);
    assert.ok(manifestEntry?.absolutePath);

    const compose = fs.readFileSync(composeEntry.absolutePath, "utf8");
    const start = fs.readFileSync(startEntry.absolutePath, "utf8");
    const manifest = JSON.parse(fs.readFileSync(manifestEntry.absolutePath, "utf8"));

    assert.match(compose, /127\.0\.0\.1:54000:4000/);
    assert.match(compose, /127\.0\.0\.1:55173:5173/);
    assert.match(compose, /\$\{RUNTIME_PACKAGE_PAYLOAD_DIR:-\.\.\/payloads\}:\/opt\/airgap\/payloads:ro,Z/);
    assert.match(start, /UI: http:\/\/localhost:55173/);
    assert.match(start, /sed 's\/:ro,Z\/:ro\/g'/);
    assert.deepStrictEqual(manifest.hostSupportScope, ["rhel8", "rhel9"]);
    assert.strictEqual(manifest.localhostOnlyByDefault, true);
  } finally {
    const composeEntry = artifacts.entries.find((entry) => entry.relativePath === "compose/high-side.compose.yml");
    if (composeEntry?.absolutePath) {
      const packageRoot = path.dirname(path.dirname(composeEntry.absolutePath));
      const tempRoot = path.dirname(packageRoot);
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
    if (prevMode == null) delete process.env.AIRGAP_RUNTIME_PACKAGE_IMAGE_EXPORT_MODE;
    else process.env.AIRGAP_RUNTIME_PACKAGE_IMAGE_EXPORT_MODE = prevMode;
  }
});
