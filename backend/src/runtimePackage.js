import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const DEFAULT_BACKEND_IMAGE = "localhost/openshift-airgap-architect-backend:latest";
const DEFAULT_FRONTEND_IMAGE = "localhost/openshift-airgap-architect-frontend:latest";

const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");

const detectContainerEngine = () => {
  const podman = spawnSync("podman", ["--version"], { encoding: "utf8" });
  if (podman.status === 0) return "podman";
  const docker = spawnSync("docker", ["--version"], { encoding: "utf8" });
  if (docker.status === 0) return "docker";
  return null;
};

const inspectImage = (engine, image) => {
  const args = engine === "podman"
    ? ["image", "exists", image]
    : ["image", "inspect", image];
  const out = spawnSync(engine, args, { encoding: "utf8" });
  return out.status === 0;
};

const exportImageArchive = ({ engine, image, outputPath }) => {
  if (engine === "podman") {
    return spawnSync(engine, ["save", "--format", "oci-archive", "-o", outputPath, image], { encoding: "utf8" });
  }
  return spawnSync(engine, ["save", "-o", outputPath, image], { encoding: "utf8" });
};

const buildComposeYaml = ({
  backendImage,
  frontendImage,
  frontendPort,
  backendPort
}) => `version: "3.9"
services:
  backend:
    image: ${backendImage}
    environment:
      - PORT=4000
      - DATA_DIR=/data
      - AIRGAP_RUNTIME_SIDE=high-side
      - AIRGAP_PRELOAD_ON_START=true
      - AIRGAP_BUNDLED_PAYLOADS_DIR=/opt/airgap/payloads
    volumes:
      - backend-data:/data
      - ./payloads:/opt/airgap/payloads:ro
    ports:
      - "127.0.0.1:${backendPort}:4000"
    restart: unless-stopped
  frontend:
    image: ${frontendImage}
    environment:
      - VITE_API_BASE=http://localhost:${backendPort}
    depends_on:
      - backend
    ports:
      - "127.0.0.1:${frontendPort}:5173"
    restart: unless-stopped
volumes:
  backend-data:
`;

const buildLoadScript = ({ imageFiles }) => `#!/usr/bin/env bash
set -euo pipefail

ENGINE="\${1:-podman}"
if ! command -v "$ENGINE" >/dev/null 2>&1; then
  if command -v podman >/dev/null 2>&1; then
    ENGINE="podman"
  elif command -v docker >/dev/null 2>&1; then
    ENGINE="docker"
  else
    echo "No supported container engine found (podman/docker)." >&2
    exit 1
  fi
fi

SCRIPT_DIR="$(cd "$(dirname "\${BASH_SOURCE[0]}")" && pwd)"
IMAGES_DIR="$(cd "$SCRIPT_DIR/../images" && pwd)"

echo "Loading runtime images with $ENGINE..."
${imageFiles.map((file) => `"${"${ENGINE}"}" load -i "$IMAGES_DIR/${file}"`).join("\n")}
echo "Image import complete."
`;

const buildStartScript = () => `#!/usr/bin/env bash
set -euo pipefail

ENGINE="\${1:-podman}"
if ! command -v "$ENGINE" >/dev/null 2>&1; then
  if command -v podman >/dev/null 2>&1; then
    ENGINE="podman"
  elif command -v docker >/dev/null 2>&1; then
    ENGINE="docker"
  else
    echo "No supported container engine found (podman/docker)." >&2
    exit 1
  fi
fi

SCRIPT_DIR="$(cd "$(dirname "\${BASH_SOURCE[0]}")" && pwd)"
COMPOSE_FILE="$SCRIPT_DIR/../compose/high-side.compose.yml"

if [[ "$ENGINE" == "podman" ]]; then
  podman compose -f "$COMPOSE_FILE" up -d
else
  docker compose -f "$COMPOSE_FILE" up -d
fi

echo "High-side runtime started."
echo "UI: http://localhost:5173"
`;

const buildStartupGuide = ({
  frontendPort,
  backendPort,
  sourceProfile,
  payloadFileName,
  imageEntries
}) => `# High-Side Runtime Startup Guide

## What was exported

- Runtime image archives:
${imageEntries.map((entry) => `  - \`${entry.archiveName}\` (${entry.archiveFormat})`).join("\n")}
- Compose file: \`compose/high-side.compose.yml\`
- Launch helpers: \`launch/load-runtime-images.sh\`, \`launch/start-high-side.sh\`
- Bundled payload: \`payloads/${payloadFileName}\`
- Checksums: \`SHA256SUMS.txt\`

## Host support scope

First-release validated host scope is **RHEL 8/9** with Podman or Docker compatible container runtime support.

## Startup flow (localhost-first)

1. Verify checksums:
   \`sha256sum -c SHA256SUMS.txt\`
2. Load images:
   \`bash launch/load-runtime-images.sh\`
3. Start runtime:
   \`bash launch/start-high-side.sh\`
4. Access locally:
   - UI: [http://localhost:${frontendPort}](http://localhost:${frontendPort})
   - API: [http://localhost:${backendPort}](http://localhost:${backendPort})

All published ports bind to \`127.0.0.1\` by default.

## Bundled payload preload behavior

- Exactly one payload is bundled: \`payloads/${payloadFileName}\`.
- On first startup in disconnected-execution mode, the backend auto-imports this payload.
- Auto-import is intentionally skipped when no payload exists, multiple payloads exist, or existing local runtime state is already populated.

## Remote access from another approved high-side workstation

Use SSH local forwarding from the remote workstation:

\`\`\`bash
ssh -L ${frontendPort}:localhost:${frontendPort} -L ${backendPort}:localhost:${backendPort} <user>@<runtime-host>
\`\`\`

Then browse \`http://localhost:${frontendPort}\` on the remote workstation.

## Firewall and exposure caveats

- Keep default localhost-only binds unless formally approved by your high-side policy.
- Do **not** expose \`0.0.0.0\` without explicit firewall and network-approval controls.

## Runtime profile and gating truth

- Runtime starts with \`AIRGAP_RUNTIME_SIDE=high-side\`.
- Operational profile resolves to \`disconnected-execution\`.
- Connected-only actions remain blocked by backend capability checks.

## Review-needed and omission behavior

- Placeholder/review-needed/finality status from source profile (\`${sourceProfile}\`) remains in exported readiness metadata.
- Secret classes omitted by policy remain omitted in bundled payload and generated assets unless explicitly included.
- Mirror payload content is not bundled; transfer mirror archive/workspace artifacts separately.
`;

const createChecksumFile = (entries) => {
  const lines = entries.map((entry) => `${entry.sha256}  ${entry.relativePath}`);
  return `${lines.join("\n")}\n`;
};

const makeExecutable = (filePath) => {
  fs.chmodSync(filePath, 0o755);
};

const archiveNameFor = (engine, role) => {
  if (engine === "podman") return `${role}.oci-archive.tar`;
  return `${role}.container-archive.tar`;
};

const createRuntimePackageArtifacts = ({
  state,
  exportOptions,
  runPayload,
  dataDir
}) => {
  const requested = Boolean(exportOptions?.includeHighSideRuntimePackage);
  if (!requested) {
    return {
      requested,
      included: false,
      entries: [],
      notes: ["Runtime package export not requested."],
      imageEntries: []
    };
  }

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "airgap-runtime-package-"));
  const packageRoot = path.join(tempRoot, "runtime-package");
  const imagesDir = path.join(packageRoot, "images");
  const composeDir = path.join(packageRoot, "compose");
  const launchDir = path.join(packageRoot, "launch");
  const payloadDir = path.join(packageRoot, "payloads");
  fs.mkdirSync(imagesDir, { recursive: true });
  fs.mkdirSync(composeDir, { recursive: true });
  fs.mkdirSync(launchDir, { recursive: true });
  fs.mkdirSync(payloadDir, { recursive: true });

  const backendImage = process.env.RUNTIME_PACKAGE_BACKEND_IMAGE || DEFAULT_BACKEND_IMAGE;
  const frontendImage = process.env.RUNTIME_PACKAGE_FRONTEND_IMAGE || DEFAULT_FRONTEND_IMAGE;
  const frontendPort = Number(exportOptions?.runtimePackageFrontendPort || 5173);
  const backendPort = Number(exportOptions?.runtimePackageBackendPort || 4000);
  const payloadFileName = "imported-run.bundle.json";
  const payloadPath = path.join(payloadDir, payloadFileName);
  fs.writeFileSync(payloadPath, JSON.stringify(runPayload, null, 2));

  const imageEntries = [];
  const notes = [];
  let included = true;

  const exportMode = String(process.env.AIRGAP_RUNTIME_PACKAGE_IMAGE_EXPORT_MODE || "auto").trim().toLowerCase();
  const engine = exportMode === "fixture" ? "fixture" : detectContainerEngine();
  if (!engine) {
    included = false;
    notes.push("No container engine detected (podman/docker). Runtime image archives could not be generated.");
  } else {
    const images = [
      { role: "backend", image: backendImage },
      { role: "frontend", image: frontendImage }
    ];
    for (const descriptor of images) {
      const archiveName = archiveNameFor(engine, descriptor.role);
      const outputPath = path.join(imagesDir, archiveName);
      if (engine === "fixture") {
        fs.writeFileSync(outputPath, `fixture archive for ${descriptor.image}\n`);
        imageEntries.push({
          role: descriptor.role,
          image: descriptor.image,
          archiveName,
          archivePath: outputPath,
          archiveFormat: "fixture"
        });
        continue;
      }
      if (!inspectImage(engine, descriptor.image)) {
        included = false;
        notes.push(`Container image not found locally: ${descriptor.image}`);
        continue;
      }
      const result = exportImageArchive({ engine, image: descriptor.image, outputPath });
      if (result.status !== 0) {
        included = false;
        notes.push(`Failed to export ${descriptor.image}: ${(result.stderr || result.stdout || "unknown error").trim()}`);
        continue;
      }
      imageEntries.push({
        role: descriptor.role,
        image: descriptor.image,
        archiveName,
        archivePath: outputPath,
        archiveFormat: engine === "podman" ? "oci-archive" : "docker-save"
      });
    }
    if (included && imageEntries.length !== 2) {
      included = false;
    }
  }

  const composeContent = buildComposeYaml({
    backendImage,
    frontendImage,
    frontendPort,
    backendPort
  });
  const composePath = path.join(composeDir, "high-side.compose.yml");
  fs.writeFileSync(composePath, composeContent);

  const loadScriptPath = path.join(launchDir, "load-runtime-images.sh");
  fs.writeFileSync(loadScriptPath, buildLoadScript({ imageFiles: imageEntries.map((entry) => entry.archiveName) }));
  makeExecutable(loadScriptPath);

  const startScriptPath = path.join(launchDir, "start-high-side.sh");
  fs.writeFileSync(startScriptPath, buildStartScript());
  makeExecutable(startScriptPath);

  const guidePath = path.join(packageRoot, "HIGH_SIDE_STARTUP_GUIDE.md");
  fs.writeFileSync(guidePath, buildStartupGuide({
    frontendPort,
    backendPort,
    sourceProfile: runPayload?.sourceProfile || "connected-authoring",
    payloadFileName,
    imageEntries
  }));

  const manifest = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    hostSupportScope: ["rhel8", "rhel9"],
    localhostOnlyByDefault: true,
    disconnectedProfile: "disconnected-execution",
    payloads: {
      bundledCount: 1,
      preloadBehavior: "autoload-exactly-one",
      files: [payloadFileName]
    },
    images: imageEntries.map((entry) => ({
      role: entry.role,
      image: entry.image,
      archive: entry.archiveName,
      format: entry.archiveFormat
    })),
    notes
  };
  const manifestPath = path.join(packageRoot, "HIGH_SIDE_RUNTIME_PACKAGE_MANIFEST.json");
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

  const checksumEntries = [];
  const addChecksumEntry = (relativePath, absolutePath) => {
    checksumEntries.push({
      relativePath,
      absolutePath,
      sha256: sha256(fs.readFileSync(absolutePath))
    });
  };

  [
    ["compose/high-side.compose.yml", composePath],
    ["launch/load-runtime-images.sh", loadScriptPath],
    ["launch/start-high-side.sh", startScriptPath],
    ["payloads/imported-run.bundle.json", payloadPath],
    ["HIGH_SIDE_STARTUP_GUIDE.md", guidePath],
    ["HIGH_SIDE_RUNTIME_PACKAGE_MANIFEST.json", manifestPath]
  ].forEach(([relativePath, absolutePath]) => addChecksumEntry(relativePath, absolutePath));
  imageEntries.forEach((entry) => {
    addChecksumEntry(`images/${entry.archiveName}`, entry.archivePath);
  });
  const checksumsPath = path.join(packageRoot, "SHA256SUMS.txt");
  fs.writeFileSync(checksumsPath, createChecksumFile(checksumEntries));

  const entries = [
    { relativePath: "compose/high-side.compose.yml", absolutePath: composePath, type: "file" },
    { relativePath: "launch/load-runtime-images.sh", absolutePath: loadScriptPath, type: "file" },
    { relativePath: "launch/start-high-side.sh", absolutePath: startScriptPath, type: "file" },
    { relativePath: "payloads/imported-run.bundle.json", absolutePath: payloadPath, type: "file" },
    { relativePath: "HIGH_SIDE_STARTUP_GUIDE.md", absolutePath: guidePath, type: "file" },
    { relativePath: "HIGH_SIDE_RUNTIME_PACKAGE_MANIFEST.json", absolutePath: manifestPath, type: "file" },
    { relativePath: "SHA256SUMS.txt", absolutePath: checksumsPath, type: "file" },
    ...imageEntries.map((entry) => ({
      relativePath: `images/${entry.archiveName}`,
      absolutePath: entry.archivePath,
      type: "file"
    }))
  ];

  return {
    requested,
    included,
    entries,
    notes,
    imageEntries,
    preload: {
      payloadFileName
    }
  };
};

export {
  createRuntimePackageArtifacts
};
