#!/usr/bin/env node
/**
 * Static validator for frontend container layout correctness.
 * Ensures container build will resolve shared/versionUtils.js imports.
 *
 * Run before expensive container smoke test to catch config errors early.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { spawnSync } from "child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

const errors = [];
const warn = (msg) => console.warn(`⚠️  ${msg}`);
const fail = (msg) => {
  console.error(`❌ ${msg}`);
  errors.push(msg);
};

console.log("🔍 Validating frontend container layout...\n");

// 0. Validate Compose syntax with real Compose implementation
let composeCmd = null;
const dockerCompose = spawnSync("docker", ["compose", "version"], { stdio: "pipe" });
if (dockerCompose.status === 0) {
  composeCmd = ["docker", "compose"];
} else {
  const podmanCompose = spawnSync("podman", ["compose", "version"], { stdio: "pipe" });
  if (podmanCompose.status === 0) {
    composeCmd = ["podman", "compose"];
  }
}

if (composeCmd) {
  console.log(`🐳 Using ${composeCmd.join(" ")} for validation`);
  const composeConfig = spawnSync(composeCmd[0], [composeCmd[1], "config"], {
    cwd: repoRoot,
    stdio: "pipe",
  });
  if (composeConfig.status !== 0) {
    fail(
      `${composeCmd.join(" ")} config failed: ${composeConfig.stderr.toString().trim()}`
    );
  } else {
    console.log("✅ Compose config is valid");
  }
} else {
  if (process.env.CI) {
    fail("Neither 'docker compose' nor 'podman compose' available in CI");
  } else {
    warn("Neither 'docker compose' nor 'podman compose' available (OK for local dev)");
  }
}

// 1. Verify docker-compose.yml frontend context is repo root
const composeFile = path.join(repoRoot, "docker-compose.yml");
if (!fs.existsSync(composeFile)) {
  fail("docker-compose.yml not found");
} else {
  const composeContent = fs.readFileSync(composeFile, "utf8");

  // Find the frontend service section
  const frontendSectionMatch = composeContent.match(/^\s*frontend:\s*$/m);
  if (!frontendSectionMatch) {
    fail("docker-compose.yml frontend service not found");
  } else {
    const frontendIndex = frontendSectionMatch.index;
    const afterFrontend = composeContent.substring(frontendIndex);
    const nextServiceMatch = afterFrontend.substring(1).match(/^\S/m);
    const frontendSection = nextServiceMatch
      ? afterFrontend.substring(0, nextServiceMatch.index + 1)
      : afterFrontend;

    const frontendContextMatch = frontendSection.match(/^\s*context:\s*(.+)$/m);
    const frontendDockerfileMatch = frontendSection.match(/^\s*dockerfile:\s*(.+)$/m);

    const frontendContext = frontendContextMatch?.[1]?.trim();
    const frontendDockerfile = frontendDockerfileMatch?.[1]?.trim();

    if (frontendContext !== ".") {
      fail(
        `docker-compose.yml frontend context is "${frontendContext}", expected "."`
      );
    } else {
      console.log("✅ docker-compose.yml frontend context is repo root");
    }

    if (frontendDockerfile !== "frontend/Containerfile") {
      fail(
        `docker-compose.yml frontend dockerfile is "${frontendDockerfile}", expected "frontend/Containerfile"`
      );
    } else {
      console.log("✅ docker-compose.yml points to frontend/Containerfile");
    }
  }
}

// 2. Verify the SUPPORTED build file encodes the sibling layout that makes
//    `../../shared/*` resolve, and that the shipped stage is not a dev server.
//
// WHAT THIS SECTION USED TO ASSERT, AND WHY IT WAS WRONG (v2.1 Tranche 8B).
//
// It required `WORKDIR /app/frontend` and byte-equivalence between
// frontend/Containerfile and frontend/Dockerfile. Both assumptions predate
// PROD-026 and are now objectively invalid:
//
//   - `/app/frontend` was the SINGLE-STAGE DEV-SERVER layout. The supported
//     Containerfile is multi-stage: the builder works in `/build/frontend` and
//     the runtime is nginx serving `/opt/app-root/src`. No `/app/frontend`
//     exists in the shipped image, by design.
//
//   - The parity check demanded the Containerfile match frontend/Dockerfile,
//     whose CMD is `node node_modules/vite/bin/vite.js` — the Vite DEV SERVER.
//     Satisfying that assertion would have REINTRODUCED the exact release
//     blocker PROD-026 removed. It was not merely stale; it required the defect.
//
// Neither check is deleted. The legitimate contract they were reaching for —
// "the build resolves shared/* imports, and we do not ship a dev server" — is
// asserted directly below, against properties that actually hold.
const containerfile = path.join(repoRoot, "frontend/Containerfile");
const dockerfile = path.join(repoRoot, "frontend/Dockerfile");

if (!fs.existsSync(containerfile)) {
  fail("frontend/Containerfile not found");
}

if (fs.existsSync(containerfile)) {
  const containerfileContent = fs.readFileSync(containerfile, "utf8");

  // THE RESOLUTION CONTRACT. frontend sources import `../../shared/*.js`, so
  // `frontend/` and `shared/` must be copied as SIBLINGS under one build root,
  // and the build must run from inside the frontend directory beneath it.
  const requiredInstructions = [
    {
      pattern: /^COPY --chown=1001:0 frontend\/package\.json frontend\/package-lock\.json \.\/frontend\/$/m,
      desc: "COPY --chown=1001:0 frontend/package.json frontend/package-lock.json ./frontend/",
    },
    {
      pattern: /^COPY --chown=1001:0 frontend\/ \.\/frontend\/$/m,
      desc: "COPY --chown=1001:0 frontend/ ./frontend/",
    },
    {
      pattern: /^COPY --chown=1001:0 shared\/ \.\/shared\/$/m,
      desc: "COPY --chown=1001:0 shared/ ./shared/ (sibling of frontend/, so ../../shared resolves)",
    },
    {
      pattern: /^RUN npm ci$/m,
      desc: "RUN npm ci",
    },
    {
      // Asserts the PROPERTY, not a hardcoded legacy path: the build runs from
      // `<build-root>/frontend`, whatever the root is named.
      pattern: /^WORKDIR \/\S+\/frontend$/m,
      desc: "WORKDIR <build-root>/frontend",
    },
  ];

  for (const { pattern, desc } of requiredInstructions) {
    if (!pattern.test(containerfileContent)) {
      fail(`frontend/Containerfile missing: ${desc}`);
    }
  }

  // Reject npm install (with or without arguments)
  if (/^RUN npm install\b/m.test(containerfileContent)) {
    fail("frontend/Containerfile contains 'RUN npm install' (must use 'npm ci')");
  }

  // The build root must be coherent: the directory holding `frontend/` and
  // `shared/` must be the parent of the build WORKDIR, or the relative import
  // cannot resolve no matter what the COPY lines say.
  const buildWorkdirs = [...containerfileContent.matchAll(/^WORKDIR (\/\S+)$/gm)].map((m) => m[1]);
  const frontendWorkdir = buildWorkdirs.find((w) => w.endsWith("/frontend"));
  if (frontendWorkdir) {
    const buildRoot = path.posix.dirname(frontendWorkdir);
    if (!buildWorkdirs.includes(buildRoot)) {
      fail(
        `frontend/Containerfile builds in ${frontendWorkdir} but never sets WORKDIR ${buildRoot}, ` +
          "where frontend/ and shared/ are copied as siblings"
      );
    } else {
      console.log(`✅ Build root ${buildRoot} holds frontend/ and shared/ as siblings`);
    }
  }

  // PROD-026: the SHIPPED stage must not be the Vite dev server. Only the final
  // stage is judged — a builder stage legitimately runs vite to build.
  const stages = containerfileContent.split(/^FROM /m);
  const finalStageCmd = stages[stages.length - 1].match(/^\s*CMD .*/m)?.[0] ?? "";
  if (/vite/i.test(finalStageCmd)) {
    fail("frontend/Containerfile final stage CMD runs the Vite dev server (PROD-026 regression)");
  } else {
    console.log("✅ Shipped stage does not run a development server");
  }
}

// The legacy Dockerfile must not masquerade as the supported path. It is NOT
// required to match the Containerfile — it deliberately differs — but a reader
// must be able to tell which file actually builds the product.
if (fs.existsSync(dockerfile)) {
  const dockerfileContent = fs.readFileSync(dockerfile, "utf8");
  if (!/LEGACY|UNSUPPORTED|DO NOT USE|DEPRECATED/i.test(dockerfileContent)) {
    fail(
      "frontend/Dockerfile sits beside frontend/Containerfile but is not marked legacy/unsupported; " +
        "a reader cannot tell which file is the supported build path"
    );
  } else {
    console.log("✅ frontend/Dockerfile is marked as not the supported build path");
  }
}

// 3. Verify shared/versionUtils.js exists
const sharedVersionUtils = path.join(repoRoot, "shared/versionUtils.js");
if (!fs.existsSync(sharedVersionUtils)) {
  fail("shared/versionUtils.js not found in repository");
} else {
  console.log("✅ shared/versionUtils.js exists");
}

// 4. Verify frontend imports that reference shared/versionUtils.js
const frontendImports = [
  "frontend/src/App.jsx",
  "frontend/src/shared/versionPolicy.js",
  "frontend/src/shared/cincinnatiChannels.js",
];

for (const importFile of frontendImports) {
  const filePath = path.join(repoRoot, importFile);
  if (!fs.existsSync(filePath)) {
    fail(`${importFile} not found`);
    continue;
  }

  const content = fs.readFileSync(filePath, "utf8");
  const importMatch = content.match(
    /import.*from\s+["']([^"']+shared\/versionUtils\.js)["']/
  );

  if (!importMatch) {
    fail(`${importFile} does not import shared/versionUtils.js`);
  } else {
    const importPath = importMatch[1];
    // Verify the relative path resolves to repository shared/versionUtils.js
    const resolvedPath = path.resolve(path.dirname(filePath), importPath);
    if (path.relative(repoRoot, resolvedPath) !== "shared/versionUtils.js") {
      fail(
        `${importFile} import path "${importPath}" does not resolve to shared/versionUtils.js`
      );
    } else {
      console.log(`✅ ${importFile} imports shared/versionUtils.js correctly`);
    }
  }
}

// 5. Verify manifests/README.md build command uses repo root context
const manifestsReadme = path.join(repoRoot, "manifests/README.md");
if (!fs.existsSync(manifestsReadme)) {
  warn("manifests/README.md not found");
} else {
  const readmeContent = fs.readFileSync(manifestsReadme, "utf8");
  const badPattern = /frontend\/Containerfile\s+frontend\//;
  const goodPattern = /frontend\/Containerfile\s+\./;

  if (badPattern.test(readmeContent)) {
    fail(
      "manifests/README.md frontend build command uses wrong context (frontend/ instead of .)"
    );
  } else if (goodPattern.test(readmeContent)) {
    console.log("✅ manifests/README.md build command uses repo root context");
  } else {
    warn("manifests/README.md does not contain expected frontend build command");
  }
}

// 6. Verify frontend/vite.config.js allows both frontend and ../shared
const viteConfig = path.join(repoRoot, "frontend/vite.config.js");
if (!fs.existsSync(viteConfig)) {
  fail("frontend/vite.config.js not found");
} else {
  const viteContent = fs.readFileSync(viteConfig, "utf8");

  // Check for server.fs.allow configuration
  const hasServerFsAllow = /server:\s*{[\s\S]*fs:\s*{[\s\S]*allow:/m.test(viteContent);
  if (!hasServerFsAllow) {
    fail("frontend/vite.config.js missing server.fs.allow configuration");
  } else {
    // Check for __dirname and ../shared in allow array
    const hasDirname = /__dirname/.test(viteContent);
    const hasShared = /\.\.\/shared/.test(viteContent);

    if (!hasDirname) {
      fail("frontend/vite.config.js server.fs.allow missing __dirname");
    }
    if (!hasShared) {
      fail("frontend/vite.config.js server.fs.allow missing ../shared reference");
    }

    if (hasDirname && hasShared) {
      console.log(
        "✅ frontend/vite.config.js allows frontend directory and ../shared"
      );
    }
  }
}

// Summary
console.log("");
if (errors.length) {
  console.error(`\n❌ Validation failed with ${errors.length} error(s).\n`);
  process.exit(1);
} else {
  console.log("✅ All frontend container layout checks passed.\n");
  process.exit(0);
}
