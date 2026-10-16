"use strict";

/**
 * Tests for the frontend production-runtime guard (PROD-026) and for the
 * security gate's shipped-dependency scope detection.
 *
 * These two belong together: the guard asserts what the image ships, and the
 * gate decides which dependency set to audit from the same Containerfile. When
 * they disagree the result is the exact failure this work corrects — a build
 * printing "15 vulnerabilities (1 low, 4 moderate, 8 high, 2 critical)" while
 * the gate reported zero.
 *
 * Hermetic: synthetic fixture roots under os.tmpdir() plus a read-only pass
 * over the tracked tree. No network, no image build.
 */

const { test, describe } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const { run } = require("./validate-frontend-runtime.js");

const REPO_ROOT = path.join(__dirname, "..");
const GATE = path.join(REPO_ROOT, "scripts", "security", "tranche-security-gate.sh");

/** Silence the guard's own output while asserting its exit code. */
function quietly(fn) {
  const err = console.error;
  const log = console.log;
  const lines = [];
  console.error = (...a) => lines.push(a.join(" "));
  console.log = (...a) => lines.push(a.join(" "));
  try {
    return { status: fn(), output: lines.join("\n") };
  } finally {
    console.error = err;
    console.log = log;
  }
}

/** A throwaway copy of the files the guard reads, so fixtures can mutate one. */
function fixtureRoot(overrides = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "oaa-fe-runtime-"));
  const files = [
    "frontend/Containerfile",
    "frontend/index.html",
    "frontend/src/api.js",
    "frontend/container/nginx-oaa.conf",
    "frontend/container/oaa-entrypoint.sh",
    "docker-compose.yml",
    "manifests/base/frontend-service.yaml",
    "manifests/base/frontend-deployment.yaml",
  ];
  for (const rel of files) {
    const dest = path.join(root, rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    const content = Object.prototype.hasOwnProperty.call(overrides, rel)
      ? overrides[rel]
      : fs.readFileSync(path.join(REPO_ROOT, rel), "utf8");
    if (content !== null) fs.writeFileSync(dest, content);
  }
  return root;
}

const trackedContainerfile = () =>
  fs.readFileSync(path.join(REPO_ROOT, "frontend", "Containerfile"), "utf8");

describe("frontend production runtime — tracked tree", () => {
  test("the repository satisfies the production-runtime contract", () => {
    const { status } = quietly(() => run(REPO_ROOT));
    assert.strictEqual(status, 0);
  });

  test("the guard is not vacuous — an unmodified fixture copy also passes", () => {
    const root = fixtureRoot();
    const { status } = quietly(() => run(root));
    assert.strictEqual(status, 0);
    fs.rmSync(root, { recursive: true, force: true });
  });
});

describe("frontend production runtime — each regression is caught", () => {
  const cases = [
    [
      "the Vite dev server returns as the runtime process",
      {
        "frontend/Containerfile": trackedContainerfile().replace(
          /^CMD \[.*\]$/m,
          'CMD ["node", "node_modules/vite/bin/vite.js", "--host", "0.0.0.0", "--port", "5173"]'
        ),
      },
      /Vite dev server|runtime process is vite/,
    ],
    [
      "a dead Vite CMD remains even though a later CMD overrides it",
      {
        // A container engine honours only the last CMD, so this would still
        // start nginx and every runtime test would pass. The file would
        // nonetheless describe a dev-server runtime to the next reader.
        "frontend/Containerfile": trackedContainerfile().replace(
          'CMD ["/opt/app-root/bin/oaa-entrypoint.sh"]',
          'CMD ["node", "node_modules/vite/bin/vite.js", "--host", "0.0.0.0", "--port", "5173"]\n' +
            'CMD ["/opt/app-root/bin/oaa-entrypoint.sh"]'
        ),
      },
      /Vite runtime instruction remains|only the last takes effect/,
    ],
    [
      "the build collapses back to a single stage",
      {
        "frontend/Containerfile":
          "FROM registry.access.redhat.com/ubi9/nodejs-22\nWORKDIR /app\nRUN npm ci\nUSER 1001\nEXPOSE 5173\nCMD [\"sh\"]\n",
      },
      /multi-stage/,
    ],
    [
      "the final stage copies node_modules out of the builder",
      {
        "frontend/Containerfile":
          trackedContainerfile() +
          "\nCOPY --from=builder /build/frontend/node_modules /opt/app-root/src/node_modules\n",
      },
      /copies node_modules/,
    ],
    [
      "the final stage installs dev dependencies",
      { "frontend/Containerfile": trackedContainerfile() + "\nRUN npm ci\n" },
      /installs dev dependencies/,
    ],
    [
      "the runtime stops dropping root",
      {
        // The LAST USER directive is the effective one. Replacing the first
        // would only touch the builder stage and prove nothing.
        "frontend/Containerfile": (() => {
          const src = trackedContainerfile();
          const i = src.lastIndexOf("USER 1001");
          return src.slice(0, i) + "USER root" + src.slice(i + "USER 1001".length);
        })(),
      },
      /runs as root/,
    ],
    [
      "index.html stops loading the runtime config",
      {
        "frontend/index.html": fs
          .readFileSync(path.join(REPO_ROOT, "frontend", "index.html"), "utf8")
          .replace('<script src="/runtime-config.js"></script>', ""),
      },
      /does not load \/runtime-config\.js/,
    ],
    [
      "api.js stops honouring the runtime config",
      {
        "frontend/src/api.js": fs
          .readFileSync(path.join(REPO_ROOT, "frontend", "src", "api.js"), "utf8")
          .replace(/__OAA_RUNTIME_CONFIG__/g, "__SOMETHING_ELSE__"),
      },
      /VITE_API_BASE would be build-time only/,
    ],
    [
      "the SPA fallback is removed",
      {
        "frontend/container/nginx-oaa.conf": fs
          .readFileSync(path.join(REPO_ROOT, "frontend", "container", "nginx-oaa.conf"), "utf8")
          .replace(/try_files \$uri \$uri\/ \/index\.html;/, "try_files $uri =404;"),
      },
      /no index\.html fallback/,
    ],
    [
      "the Service drifts off the serving port",
      {
        "manifests/base/frontend-service.yaml": fs
          .readFileSync(path.join(REPO_ROOT, "manifests", "base", "frontend-service.yaml"), "utf8")
          .replace(/port:\s*5173/, "port: 8080"),
      },
      /frontend-service\.yaml does not reference the serving port/,
    ],
  ];

  for (const [name, overrides, expected] of cases) {
    test(name, () => {
      const root = fixtureRoot(overrides);
      const { status, output } = quietly(() => run(root));
      assert.strictEqual(status, 1, `expected failure for: ${name}`);
      assert.match(output, expected);
      fs.rmSync(root, { recursive: true, force: true });
    });
  }
});

/* ------------------------------------------------------------------ */
/* The security gate must audit the dependency set the image installs   */
/* ------------------------------------------------------------------ */

describe("security gate — shipped dependency scope is stage-aware", () => {
  /**
   * Invokes the real shell function out of the gate script, so this tests
   * behaviour rather than asserting on the script's text.
   */
  function scopeOf(containerfileText) {
    const tmp = path.join(os.tmpdir(), `oaa-cf-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    fs.writeFileSync(tmp, containerfileText);
    try {
      return execFileSync(
        "bash",
        ["-c", `source <(sed -n '/^shipped_install_scope()/,/^}/p' "$1"); shipped_install_scope "$2"`, "_", GATE, tmp],
        { encoding: "utf8" }
      ).trim();
    } finally {
      fs.rmSync(tmp, { force: true });
    }
  }

  test("the current frontend image ships no npm dependency surface", () => {
    assert.strictEqual(scopeOf(trackedContainerfile()), "none");
  });

  test("the backend image ships production dependencies only", () => {
    assert.strictEqual(
      scopeOf(fs.readFileSync(path.join(REPO_ROOT, "backend", "Containerfile"), "utf8")),
      "prod"
    );
  });

  test("a copied tree is scoped by the install that BUILT it, not by the copy", () => {
    // There are two independent implementations of this rule — this shell
    // function and shippedInstallScope() in axes/dependencies.mjs. They must
    // not drift: the same cases are asserted in scripts/release/axes.test.mjs.
    assert.strictEqual(
      scopeOf("FROM node AS builder\nRUN npm ci --omit=dev\n\nFROM node\nCOPY --from=builder /app/node_modules /app/node_modules\n"),
      "prod"
    );
    assert.strictEqual(
      scopeOf("FROM node AS builder\nRUN npm ci\n\nFROM node\nCOPY --from=builder /app/node_modules /app/node_modules\n"),
      "all"
    );
  });

  test("the flag and command vocabulary matches the JS classifier", () => {
    // Parity cases that previously diverged. The matching assertions live in
    // scripts/release/axes.test.mjs; changing one implementation alone must
    // break one of these two files.
    assert.strictEqual(
      scopeOf("FROM node AS builder\nRUN npm ci --only=prod\n\nFROM node\nCOPY --from=builder /app/node_modules /app/node_modules\n"),
      "prod"
    );
    assert.strictEqual(
      scopeOf("FROM node AS builder\nRUN npm i --omit=dev\n\nFROM node\nCOPY --from=builder /app/node_modules /app/node_modules\n"),
      "prod"
    );
    assert.strictEqual(scopeOf("FROM node\nRUN npm i\nCMD [\"node\"]\n"), "all");
  });

  test("a final stage that copies a prod tree AND installs on top ships everything", () => {
    // Mirror of the same case in scripts/release/axes.test.mjs. This is the
    // one shape where resolving the builder stage was WEAKER than the
    // pre-8D "any copy is all" rule.
    assert.strictEqual(
      scopeOf("FROM node AS builder\nRUN npm ci --omit=dev\n\nFROM node\nCOPY --from=builder /app/node_modules /app/node_modules\nRUN npm i express\n"),
      "all"
    );
    assert.strictEqual(
      scopeOf("FROM node AS builder\nRUN npm ci --omit=dev\n\nFROM node\nCOPY --from=builder /app/node_modules /app/node_modules\nRUN npm i --omit=dev express\n"),
      "prod"
    );
  });

  test("a COPY whose --from is not the first flag is still seen", () => {
    // `--chown` before `--from` used to classify as "none", which here means
    // an unconditional PASS — the audit would be skipped for a stage that
    // ships the entire tree.
    assert.strictEqual(
      scopeOf("FROM node AS builder\nRUN npm ci\n\nFROM node\nCOPY --chown=1001:0 --from=builder /app/node_modules ./node_modules\n"),
      "all"
    );
    assert.strictEqual(
      scopeOf("FROM node AS builder\nRUN npm ci --omit=dev\n\nFROM node\nCOPY --chown=1001:0 --from=builder /app/node_modules ./node_modules\n"),
      "prod"
    );
  });

  test("a chained `&&` install is read as two installs, not one", () => {
    assert.strictEqual(scopeOf("FROM node\nRUN npm ci --omit=dev && npm ci\n"), "all");
    assert.strictEqual(scopeOf("FROM node\nRUN npm ci --omit=dev && npm i --omit=dev\n"), "prod");
  });

  test("FROM flags do not hide the stage alias", () => {
    assert.strictEqual(
      scopeOf("FROM --platform=linux/amd64 node AS builder\nRUN npm ci --omit=dev\n\nFROM node\nCOPY --from=builder /app/node_modules /app/node_modules\n"),
      "prod"
    );
  });

  test("an unresolvable copy source over-reports rather than under-reports", () => {
    assert.strictEqual(
      scopeOf("FROM node\nCOPY --from=somewhere-else /app/node_modules /app/node_modules\n"),
      "all"
    );
    assert.strictEqual(
      scopeOf("FROM node AS builder\nCOPY node_modules /app/node_modules\n\nFROM node\nCOPY --from=builder /app/node_modules /app/node_modules\n"),
      "all"
    );
  });

  test("a single-stage image with a bare `npm ci` is reported as shipping the dev tree", () => {
    // The pre-PROD-026 shape. Reporting this as "prod" is the original defect.
    assert.strictEqual(
      scopeOf("FROM registry.access.redhat.com/ubi9/nodejs-22\nRUN npm ci\nCMD [\"node\"]\n"),
      "all"
    );
  });

  test("a builder-stage `npm ci` alone does not count as shipped", () => {
    assert.strictEqual(
      scopeOf(
        "FROM node AS builder\nRUN npm ci\nRUN npm run build\n" +
          "FROM nginx\nCOPY --from=builder /b/dist/ /usr/share/nginx/html/\nCMD [\"nginx\"]\n"
      ),
      "none"
    );
  });

  test("copying node_modules into the final stage still counts as shipped", () => {
    assert.strictEqual(
      scopeOf(
        "FROM node AS builder\nRUN npm ci\n" +
          "FROM node\nCOPY --from=builder /b/node_modules /app/node_modules\nCMD [\"node\"]\n"
      ),
      "all"
    );
  });

  test("an `--omit=dev` install in the final stage is production scope", () => {
    assert.strictEqual(
      scopeOf("FROM node AS builder\nRUN npm ci\nFROM node\nRUN npm ci --omit=dev\nCMD [\"node\"]\n"),
      "prod"
    );
  });
});
