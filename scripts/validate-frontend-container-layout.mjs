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

// 2. Verify both Containerfile and Dockerfile have equivalent structure
const containerfile = path.join(repoRoot, "frontend/Containerfile");
const dockerfile = path.join(repoRoot, "frontend/Dockerfile");

if (!fs.existsSync(containerfile)) {
  fail("frontend/Containerfile not found");
}
if (!fs.existsSync(dockerfile)) {
  fail("frontend/Dockerfile not found");
}

if (fs.existsSync(containerfile) && fs.existsSync(dockerfile)) {
  const containerfileContent = fs.readFileSync(containerfile, "utf8");
  const dockerfileContent = fs.readFileSync(dockerfile, "utf8");

  // Exact required instructions (anchored patterns)
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
      desc: "COPY --chown=1001:0 shared/ ./shared/",
    },
    {
      pattern: /^RUN npm ci$/m,
      desc: "RUN npm ci",
    },
    {
      pattern: /^WORKDIR \/app\/frontend$/m,
      desc: "WORKDIR /app/frontend",
    },
  ];

  for (const { pattern, desc } of requiredInstructions) {
    if (!pattern.test(containerfileContent)) {
      fail(`frontend/Containerfile missing: ${desc}`);
    }
    if (!pattern.test(dockerfileContent)) {
      fail(`frontend/Dockerfile missing: ${desc}`);
    }
  }

  // Reject npm install (with or without arguments)
  if (/^RUN npm install\b/m.test(containerfileContent)) {
    fail("frontend/Containerfile contains 'RUN npm install' (must use 'npm ci')");
  }
  if (/^RUN npm install\b/m.test(dockerfileContent)) {
    fail("frontend/Dockerfile contains 'RUN npm install' (must use 'npm ci')");
  }

  // Verify Containerfile and Dockerfile have equivalent effective instructions
  const extractInstructions = (content) => {
    return content
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#"))
      .join("\n");
  };

  const containerfileInstructions = extractInstructions(containerfileContent);
  const dockerfileInstructions = extractInstructions(dockerfileContent);

  if (containerfileInstructions !== dockerfileInstructions) {
    fail(
      "frontend/Containerfile and frontend/Dockerfile have different effective instructions"
    );
  } else {
    console.log(
      "✅ Both Containerfile and Dockerfile have equivalent effective instructions"
    );
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
