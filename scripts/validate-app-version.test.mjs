import { test, describe } from "node:test";
import assert from "node:assert";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, chmodSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { validate, isValidSemVer, readCanonicalVersion } from "./validate-app-version.mjs";

function makeFixture(overrides = {}) {
  const root = mkdtempSync(join(tmpdir(), "oaa-ver-test-"));
  const ver = overrides.version ?? "2.0.0-dev";
  const versionFile = overrides.versionFile ?? ver;

  if (overrides.skipVersionFile !== true) {
    writeFileSync(join(root, "VERSION"), versionFile + "\n");
  }

  const pkg = (name, v) => JSON.stringify({ name, version: v ?? ver, private: true });
  const lock = (name, topV, rootV, transitivePkgs) => {
    const packages = { "": { name, version: rootV ?? topV ?? ver } };
    if (transitivePkgs) {
      for (const [path, dep] of Object.entries(transitivePkgs)) {
        packages[path] = dep;
      }
    }
    return JSON.stringify({
      name,
      version: topV ?? ver,
      lockfileVersion: 3,
      requires: true,
      packages,
    });
  };

  writeFileSync(join(root, "package.json"), pkg("root", overrides.rootPkg));
  mkdirSync(join(root, "backend"), { recursive: true });
  writeFileSync(join(root, "backend", "package.json"), pkg("backend", overrides.backendPkg));
  mkdirSync(join(root, "frontend"), { recursive: true });
  writeFileSync(join(root, "frontend", "package.json"), pkg("frontend", overrides.frontendPkg));
  mkdirSync(join(root, "shared"), { recursive: true });
  writeFileSync(join(root, "shared", "package.json"), pkg("shared", overrides.sharedPkg));
  writeFileSync(join(root, "package-lock.json"), lock("root", overrides.rootLockTop, overrides.rootLockRoot, overrides.rootLockTransitive));
  writeFileSync(join(root, "backend", "package-lock.json"), lock("backend", overrides.backendLockTop, overrides.backendLockRoot));
  writeFileSync(join(root, "frontend", "package-lock.json"), lock("frontend", overrides.frontendLockTop, overrides.frontendLockRoot));

  return root;
}

function cleanup(root) {
  rmSync(root, { recursive: true, force: true });
}

describe("isValidSemVer", () => {
  test("accepts bare GA version", () => {
    assert.ok(isValidSemVer("2.0.0"));
  });

  test("accepts prerelease version", () => {
    assert.ok(isValidSemVer("2.0.0-dev"));
    assert.ok(isValidSemVer("2.0.0-rc.1"));
    assert.ok(isValidSemVer("1.0.0-alpha.1.beta.2"));
  });

  test("accepts build metadata", () => {
    assert.ok(isValidSemVer("2.0.0+build.123"));
    assert.ok(isValidSemVer("2.0.0-dev+sha.abc123"));
  });

  test("rejects invalid versions", () => {
    assert.ok(!isValidSemVer(""));
    assert.ok(!isValidSemVer("v2.0.0"));
    assert.ok(!isValidSemVer("2.0"));
    assert.ok(!isValidSemVer("2"));
    assert.ok(!isValidSemVer("not-a-version"));
    assert.ok(!isValidSemVer("2.0.0-"));
    assert.ok(!isValidSemVer("02.0.0"));
  });
});

describe("readCanonicalVersion — missing VERSION", () => {
  test("throws when VERSION file does not exist", () => {
    const root = mkdtempSync(join(tmpdir(), "oaa-ver-test-"));
    try {
      assert.throws(() => readCanonicalVersion(root), /ENOENT/);
    } finally {
      cleanup(root);
    }
  });
});

describe("validate — synchronized success", () => {
  test("all files at 2.0.0-dev passes", () => {
    const root = makeFixture({ version: "2.0.0-dev" });
    try {
      const result = validate(root);
      assert.strictEqual(result.ok, true);
      assert.strictEqual(result.version, "2.0.0-dev");
      assert.deepStrictEqual(result.errors, []);
    } finally {
      cleanup(root);
    }
  });

  test("all files at bare GA version passes", () => {
    const root = makeFixture({ version: "3.1.0" });
    try {
      const result = validate(root);
      assert.strictEqual(result.ok, true);
      assert.strictEqual(result.version, "3.1.0");
    } finally {
      cleanup(root);
    }
  });

  test("prerelease with dots passes", () => {
    const root = makeFixture({ version: "2.0.0-rc.1" });
    try {
      const result = validate(root);
      assert.strictEqual(result.ok, true);
      assert.strictEqual(result.version, "2.0.0-rc.1");
    } finally {
      cleanup(root);
    }
  });
});

describe("validate — manifest mismatch", () => {
  test("detects single package.json mismatch", () => {
    const root = makeFixture({ version: "2.0.0-dev", backendPkg: "1.7.0" });
    try {
      const result = validate(root);
      assert.strictEqual(result.ok, false);
      assert.ok(result.errors.some(e => e.includes("backend/package.json") && e.includes("1.7.0")));
    } finally {
      cleanup(root);
    }
  });

  test("detects multiple mismatches with clear diagnostics", () => {
    const root = makeFixture({
      version: "2.0.0-dev",
      frontendPkg: "0.1.0",
      sharedPkg: "2.0.0",
    });
    try {
      const result = validate(root);
      assert.strictEqual(result.ok, false);
      assert.ok(result.errors.length >= 2);
      assert.ok(result.errors.some(e => e.includes("frontend/package.json")));
      assert.ok(result.errors.some(e => e.includes("shared/package.json")));
    } finally {
      cleanup(root);
    }
  });
});

describe("validate — lockfile representations", () => {
  test("detects lockfile top-level version mismatch with exact diagnostic", () => {
    const root = makeFixture({ version: "2.0.0-dev", rootLockTop: "1.7.0" });
    try {
      const result = validate(root);
      assert.strictEqual(result.ok, false);
      assert.ok(result.errors.some(e =>
        e.includes("package-lock.json") && e.includes("top-level") && e.includes('"1.7.0"')
      ));
    } finally {
      cleanup(root);
    }
  });

  test("detects lockfile packages[\"\"].version mismatch independently", () => {
    const root = makeFixture({ version: "2.0.0-dev", frontendLockRoot: "0.1.0" });
    try {
      const result = validate(root);
      assert.strictEqual(result.ok, false);
      assert.ok(result.errors.some(e =>
        e.includes("frontend/package-lock.json") && e.includes('packages[""]') && e.includes('"0.1.0"')
      ));
    } finally {
      cleanup(root);
    }
  });

  test("top-level correct but packages[\"\"] wrong reports only packages[\"\"] error", () => {
    const root = makeFixture({ version: "2.0.0-dev", backendLockRoot: "1.5.0" });
    try {
      const result = validate(root);
      assert.strictEqual(result.ok, false);
      const backendErrors = result.errors.filter(e => e.includes("backend/package-lock.json"));
      assert.strictEqual(backendErrors.length, 1);
      assert.ok(backendErrors[0].includes('packages[""]'));
      assert.ok(backendErrors[0].includes('"1.5.0"'));
    } finally {
      cleanup(root);
    }
  });

  test("packages[\"\"] correct but top-level wrong reports only top-level error", () => {
    const root = makeFixture({ version: "2.0.0-dev", rootLockTop: "0.9.0", rootLockRoot: "2.0.0-dev" });
    try {
      const result = validate(root);
      assert.strictEqual(result.ok, false);
      const rootErrors = result.errors.filter(e => e.startsWith("package-lock.json"));
      assert.strictEqual(rootErrors.length, 1);
      assert.ok(rootErrors[0].includes("top-level"));
      assert.ok(rootErrors[0].includes('"0.9.0"'));
    } finally {
      cleanup(root);
    }
  });

  test("transitive dependency versions are ignored", () => {
    const root = makeFixture({
      version: "2.0.0-dev",
      rootLockTransitive: {
        "node_modules/express": { version: "4.21.0", resolved: "https://registry.npmjs.org/express/-/express-4.21.0.tgz" },
        "node_modules/better-sqlite3": { version: "11.7.0" },
      },
    });
    try {
      const result = validate(root);
      assert.strictEqual(result.ok, true);
      assert.deepStrictEqual(result.errors, []);
    } finally {
      cleanup(root);
    }
  });
});

describe("validate — invalid canonical VERSION", () => {
  test("rejects non-SemVer VERSION", () => {
    const root = makeFixture({ version: "2.0.0-dev", versionFile: "v2.0.0-dev" });
    try {
      const result = validate(root);
      assert.strictEqual(result.ok, false);
      assert.ok(result.errors.some(e => e.includes("not valid SemVer")));
    } finally {
      cleanup(root);
    }
  });

  test("rejects empty VERSION", () => {
    const root = makeFixture({ version: "2.0.0-dev", versionFile: "" });
    try {
      const result = validate(root);
      assert.strictEqual(result.ok, false);
      assert.ok(result.errors.some(e => e.includes("empty")));
    } finally {
      cleanup(root);
    }
  });

  test("throws on missing VERSION file", () => {
    const root = makeFixture({ version: "2.0.0-dev", skipVersionFile: true });
    try {
      assert.throws(() => validate(root), /ENOENT/);
    } finally {
      cleanup(root);
    }
  });
});

describe("validate — CLI exit behavior", () => {
  const scriptPath = new URL("./validate-app-version.mjs", import.meta.url).pathname;

  test("exits 0 when synchronized", () => {
    const root = makeFixture({ version: "2.0.0-dev" });
    try {
      const result = spawnSync("node", [scriptPath, root], { encoding: "utf-8" });
      assert.strictEqual(result.status, 0, `expected exit 0, got ${result.status}: ${result.stderr}`);
      assert.ok(result.stdout.includes("2.0.0-dev"));
    } finally {
      cleanup(root);
    }
  });

  test("exits nonzero on manifest mismatch with FAILED diagnostic", () => {
    const root = makeFixture({ version: "2.0.0-dev", backendPkg: "1.7.0" });
    try {
      const result = spawnSync("node", [scriptPath, root], { encoding: "utf-8" });
      assert.ok(result.status > 0, `expected nonzero exit, got ${result.status}`);
      assert.ok(result.stderr.includes("FAILED"), `expected FAILED in stderr: ${result.stderr}`);
    } finally {
      cleanup(root);
    }
  });

  test("exits nonzero on invalid canonical SemVer", () => {
    const root = makeFixture({ version: "2.0.0-dev", versionFile: "not-semver" });
    try {
      const result = spawnSync("node", [scriptPath, root], { encoding: "utf-8" });
      assert.ok(result.status > 0, `expected nonzero exit, got ${result.status}`);
    } finally {
      cleanup(root);
    }
  });

  test("exits nonzero with VERSION path diagnostic when file missing", () => {
    const root = makeFixture({ version: "2.0.0-dev", skipVersionFile: true });
    try {
      const result = spawnSync("node", [scriptPath, root], { encoding: "utf-8" });
      assert.ok(result.status > 0, `expected nonzero exit, got ${result.status}`);
      assert.ok(result.stderr.includes("VERSION"), `expected VERSION in stderr: ${result.stderr}`);
      assert.ok(result.stderr.includes("FAILED"), `expected FAILED in stderr: ${result.stderr}`);
    } finally {
      cleanup(root);
    }
  });
});
