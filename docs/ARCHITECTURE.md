# Architecture Documentation

This document describes the system architecture of the OpenShift Airgap Architect application, covering major components, data flow, subsystem integration, and runtime behavior.

---

## Table of Contents

- [Overview](#overview)
- [System Architecture](#system-architecture)
- [Data Flow](#data-flow)
- [Component Details](#component-details)
- [Job Execution Model](#job-execution-model)
- [Cincinnati Integration](#cincinnati-integration)
- [oc-mirror Runtime Selection](#oc-mirror-runtime-selection)
- [Field Guide Generation](#field-guide-generation)
- [Asset Generation Pipeline](#asset-generation-pipeline)
- [Security Model](#security-model)
- [Deployment Patterns](#deployment-patterns)

---

## Overview

OpenShift Airgap Architect is a web-based wizard application that helps users plan and prepare OpenShift cluster installations in air-gapped (disconnected) environments. The application guides users through configuration choices, generates deployment artifacts, and orchestrates mirroring operations.

### Key Features

- **Interactive wizard** - Multi-step configuration flow with validation
- **State persistence** - All configuration stored in SQLite
- **Asset generation** - Produces install-config.yaml, agent-config.yaml, ImageSetConfiguration
- **Field Guide** - Contextual documentation tailored to user's configuration
- **oc-mirror integration** - Operator catalog scanning and image mirroring
- **Bundle export** - Complete deployment packages with configs, binaries, and docs

### Technology Stack

**Frontend:**
- React 18 with context-based state management
- Vite build system
- CSS modules for styling
- Fetch API for backend communication

**Backend:**
- Node.js with Express framework
- SQLite (better-sqlite3) for persistence
- Child process management for external tools
- Stream-based job output

**External Tools:**
- `oc-mirror` - Image mirroring and operator catalog scanning
- `openshift-install` - AMI/region metadata extraction
- `ssh-keygen` - SSH key pair generation

---

## System Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        Browser (Client)                      │
│  ┌───────────────────────────────────────────────────────┐  │
│  │  React App (Vite)                                     │  │
│  │  - Wizard Steps (Blueprint, Methodology, etc.)        │  │
│  │  - State Management (Context API)                     │  │
│  │  - Validation (frontend/src/validation.js)            │  │
│  │  - API Client (frontend/src/api.js)                   │  │
│  └───────────────────────────────────────────────────────┘  │
└──────────────────────────┬──────────────────────────────────┘
                           │ HTTP/JSON
                           ↓
┌─────────────────────────────────────────────────────────────┐
│                    Express Backend (Node.js)                 │
│  ┌───────────────────────────────────────────────────────┐  │
│  │  API Routes (backend/src/index.js)                    │  │
│  │  - State: GET/POST /api/state                         │  │
│  │  - Cincinnati: GET /api/channels, /api/versions       │  │
│  │  - Operators: POST /api/operators/scan, GET /results  │  │
│  │  - oc-mirror: POST /api/ocmirror/run, /cancel         │  │
│  │  - Generation: POST /api/generate/*                   │  │
│  │  - Export: GET /api/export/bundle, /export/run-file   │  │
│  │  - Jobs: GET /api/jobs, DELETE /api/jobs/completed    │  │
│  │  - SSH: POST /api/ssh/keypair                         │  │
│  │  - AWS: GET /api/aws/regions, /api/aws/ami            │  │
│  │  - Docs: POST /api/docs/generate                      │  │
│  │  - Feedback: POST /api/feedback/*                     │  │
│  │  - System: GET /api/system/path-check, GET /api/fs/ls │  │
│  └───────────────────────────────────────────────────────┘  │
│                           │                                  │
│  ┌────────────────────────┴──────────────────────────────┐  │
│  │  Core Modules                                         │  │
│  │  - generate.js - YAML builders                        │  │
│  │  - cincinnati.js - Version fetching with cache        │  │
│  │  - operators.js - oc-mirror scan jobs                 │  │
│  │  - installer.js - openshift-install wrapper           │  │
│  │  - ocMirrorRuntime.js - Arch-aware binary selection   │  │
│  │  - fieldGuide/index.js - Documentation generation     │  │
│  │  - utils.js - State/jobs/cache helpers                │  │
│  │  - feedback.js - User feedback submission             │  │
│  └───────────────────────────────────────────────────────┘  │
│                           │                                  │
│                           ↓                                  │
│  ┌───────────────────────────────────────────────────────┐  │
│  │  SQLite Database (better-sqlite3)                     │  │
│  │  - app_state: Full state JSON blob (singleton)        │  │
│  │  - cache: Cincinnati channels/versions, docs links    │  │
│  │  - jobs: Async job tracking (oc-mirror, operators)    │  │
│  │  - operator_results: Scan results by version/catalog  │  │
│  │  - docs_links: Cached documentation URLs              │  │
│  └───────────────────────────────────────────────────────┘  │
└──────────────────────────┬──────────────────────────────────┘
                           │ spawn()
                           ↓
┌─────────────────────────────────────────────────────────────┐
│              External Tools (Child Processes)                │
│  - oc-mirror (operator scan, image mirroring)                │
│  - openshift-install (AMI/region metadata)                   │
│  - ssh-keygen (key pair generation)                          │
│  - tar/curl (binary downloads, extraction)                   │
└─────────────────────────────────────────────────────────────┘
                           │
                           ↓
┌─────────────────────────────────────────────────────────────┐
│                   External Services                          │
│  - api.github.com/repos/openshift/cincinnati-graph-data     │
│  - raw.githubusercontent.com (stable-*.yaml)                 │
│  - mirror.openshift.com (binaries, installer)                │
│  - registry.redhat.io (pull secret validation)              │
└─────────────────────────────────────────────────────────────┘
```

---

## Data Flow

### 1. User Interaction Flow

```
User fills wizard → Frontend state update → POST /api/state → SQLite (singleton)
                                                               ↓
User navigates ← Frontend fetches state ← GET /api/state ← SQLite read
```

### 2. State Persistence

**State Structure:**
- Frontend maintains full application state in React context
- On every significant change, state is persisted to backend via `POST /api/state`
- Backend stores state as JSON blob in `app_state` table (singleton row with id='singleton')
- On page load/refresh, frontend fetches state via `GET /api/state`

**Why SQLite?**
- Simple persistence without external dependencies
- WAL mode for better concurrency
- Embedded in container, no separate database service
- Fast read/write for JSON blobs
- Built-in cache table for external API results

### 3. Generation Flow

```
User clicks "Export Bundle"
    ↓
Frontend POST /api/export/bundle with state
    ↓
Backend validates state
    ↓
Generate YAMLs (install-config.yaml, agent-config.yaml, ImageSetConfiguration)
    ↓
Generate Field Guide (markdown)
    ↓
Fetch/include binaries (oc, oc-mirror for export arch)
    ↓
Create ZIP archive with:
    - install-config.yaml
    - agent-config.yaml (if Agent-Based Installer)
    - ImageSetConfiguration.yaml
    - field-guide.md
    - oc (binary)
    - oc-mirror (binary)
    - ssh keys (if generated)
    - additional-trust-bundle.pem (if configured)
    - ntp-*.yaml (if NTP configured)
    ↓
Stream ZIP to client
```

### 4. Job Execution Flow

```
User triggers oc-mirror scan/run
    ↓
Backend creates job record (status=queued)
    ↓
Spawn child process (oc-mirror)
    ↓
Stream stdout/stderr to job.output (append-only, max 500KB)
    ↓
Update job.status=running, job.progress
    ↓
On completion: job.status=completed/failed
    ↓
Frontend polls GET /api/jobs/:id for status updates
    ↓
User views job.output (streamed console logs)
```

**Job Types:**
- `cincinnati` - Background channel/version refresh
- `operator-scan` - oc-mirror catalog scanning
- `oc-mirror-run` - Image mirroring execution

**Job Lifecycle:**
- `queued` → Job created, not yet started
- `running` → Child process active
- `completed` → Process exited with code 0
- `failed` → Process exited non-zero or error occurred
- `cancelled` → User-initiated cancellation via SIGTERM

**Stale Job Handling:**
- On server restart, all jobs with status=`running` are marked as `failed` with message "Server restarted; job marked stale."

---

## Component Details

### Frontend Architecture

**State Management:**
- React Context API (`frontend/src/store.jsx`)
- Single top-level state object containing all wizard configuration
- Reducer pattern for state updates
- `updateState(updates)` merges partial updates into existing state
- State persisted to backend on every update via debounced POST

**Wizard Flow:**
- Dynamic step visibility based on platform/method/version (see `wizardVisibleSteps.js`)
- Step validation happens on navigation (can block "Next" button)
- Validation errors displayed inline with field context
- Sub-steps for complex configurations (e.g., Global Strategy networking)

**Validation:**
- Client-side validation in `frontend/src/validation.js`
- Per-step validation with `validateStep(state, stepId)`
- Per-field validation (CIDR, IP, MAC, SSH key, pull secret)
- Cross-field validation (CIDR overlaps, VIP within machine network)
- Does NOT enforce validation - provides UI hints and error messages only

**Component Structure:**
```
App.jsx
├─ LandingPage.jsx (entry point)
├─ Sidebar.jsx (step navigation)
├─ steps/
│  ├─ BlueprintStep.jsx (platform + version selection)
│  ├─ MethodologyStep.jsx (IPI/UPI/Agent-Based)
│  ├─ IdentityAccessStep.jsx (cluster name, pull secret, SSH)
│  ├─ NetworkingV2Step.jsx (CIDRs, dual-stack, MTU)
│  ├─ HostInventoryV2Step.jsx (host definitions, network configs)
│  ├─ OperatorsStep.jsx (catalog scan, operator selection)
│  ├─ ReviewStep.jsx (asset generation, download)
│  ├─ RunOcMirrorStep.jsx (oc-mirror job execution)
│  └─ OperationsStep.jsx (import/export run file)
└─ components/
   ├─ ScenarioHeaderPanel.jsx (platform/method/version banner)
   ├─ ToolsDrawer.jsx (dev tools, state inspection)
   └─ FeedbackDrawer.jsx (user feedback submission)
```

### Backend Architecture

**Express API Server:**
- CORS enabled for frontend communication
- JSON body parser (10MB limit for state payloads)
- Rate limiting for feedback endpoints
- X-Forwarded-For trust from TRUSTED_PROXIES only

**Module Responsibilities:**

**`index.js`** - Main API routes and server setup
- Health/status endpoints
- State persistence (GET/POST /api/state)
- Proxies to specialized modules

**`generate.js`** - YAML generation
- `buildInstallConfig(state)` - Generates install-config.yaml
- `buildAgentConfig(state)` - Generates agent-config.yaml (Agent-Based Installer)
- `buildImageSetConfig(state)` - Generates ImageSetConfiguration (oc-mirror)
- `buildNtpMachineConfigs(state)` - Generates NTP MachineConfig manifests
- Platform-specific logic (bare metal, vSphere, Nutanix, AWS GovCloud, Azure Government, IBM Cloud)
- Dual-stack networking support (IPv4 + IPv6)
- Root device hint handling (deviceName, HCTL, model, vendor, serial, WWN, size, rotational)

**`cincinnati.js`** - OpenShift version discovery
- Fetches channels from GitHub (api.github.com/repos/openshift/cincinnati-graph-data)
- Parses stable-X.Y.yaml files for patch versions
- Caches channels and patch lists in SQLite cache table
- MOCK_MODE support with bundled YAML files
- Configurable fetch timeout (default 45s, max 120s)

**`operators.js`** - Operator catalog scanning
- Spawns oc-mirror with imageset-config for catalog indexing
- Parses oc-mirror output for available operators
- Stores results in `operator_results` table (keyed by version + catalog)
- Preflight check ensures oc-mirror available before scan

**`installer.js`** - openshift-install wrapper
- Downloads openshift-install binary for specific versions
- Executes `coreos print-stream-json` for AMI/region metadata
- Caches stream metadata per version
- In-flight promise deduplication (parallel requests share one download)

**`ocMirrorRuntime.js`** - Architecture-aware binary selection
- Resolves oc-mirror binary based on backend runtime architecture (NOT Blueprint arch)
- Priority: `OC_MIRROR_BIN` → baked-in `/usr/local/bin/oc-mirror` → mirror download → `OC_MIRROR_URL`
- Preflight check (`oc-mirror version`) validates binary before use
- Separate logic for local runtime vs. export architecture binaries
- Export binaries fetched on-demand for bundle inclusion

**`fieldGuide/index.js`** - Contextual documentation
- Builds markdown documentation tailored to user's configuration
- Includes platform-specific instructions
- Embeds relevant documentation URLs
- Warns about misconfigurations or edge cases
- Generated at export time, included in bundle as `field-guide.md`

**`utils.js`** - State and job helpers
- `getState()` / `setState(state)` - State persistence
- `createJob(type, message)` - Job creation
- `updateJob(id, patch)` - Job status updates
- `appendJobOutput(id, chunk, maxBytes)` - Streaming job logs (max 500KB)
- `writeTempAuth(contents)` - Temp file for pull secrets (mode 0o600)
- `mergePullSecrets(a, b)` - Merge auths from multiple pull secrets
- Cache helpers (`getCache(key)`, `setCache(key, value)`)

**`feedback.js`** - User feedback system
- Challenge token generation/verification (SHA-256 based)
- Payload validation (max 10KB feedback text, optional state JSON)
- GitHub issue draft builder
- Rate limiting integration

**`db.js`** - SQLite initialization
- Creates database at `${DATA_DIR}/airgap-architect.db`
- WAL mode for better concurrency
- Schema: `app_state`, `cache`, `jobs`, `operator_results`, `docs_links`
- Safe column addition for backward compatibility

---

## Job Execution Model

### Overview

Jobs represent long-running asynchronous operations that execute in child processes. The backend manages job lifecycle, streams output, and handles cancellation.

### Job Table Schema

```sql
CREATE TABLE jobs (
  id TEXT PRIMARY KEY,           -- nanoid (21 chars)
  type TEXT NOT NULL,             -- "cincinnati" | "operator-scan" | "oc-mirror-run"
  status TEXT NOT NULL,           -- "queued" | "running" | "completed" | "failed" | "cancelled"
  progress INTEGER NOT NULL,      -- 0-100 (percentage)
  message TEXT,                   -- Status message or error
  output TEXT,                    -- Streamed stdout/stderr (max 500KB)
  created_at INTEGER NOT NULL,    -- Unix timestamp (ms)
  updated_at INTEGER NOT NULL,    -- Unix timestamp (ms)
  metadata_json TEXT              -- Job-specific metadata (JSON string)
);
```

### Job Lifecycle

1. **Creation** (`status=queued`)
   - Frontend calls job endpoint (e.g., POST /api/operators/scan)
   - Backend validates request
   - Creates job record with `createJob(type, message)`
   - Returns job ID to frontend

2. **Execution** (`status=running`)
   - Backend spawns child process (e.g., `oc-mirror`)
   - Attaches stdout/stderr listeners
   - Streams output to job record via `appendJobOutput(id, chunk)`
   - Updates progress periodically

3. **Completion** (`status=completed`)
   - Child process exits with code 0
   - Final output appended
   - Job marked completed
   - Frontend displays success message

4. **Failure** (`status=failed`)
   - Child process exits non-zero
   - Error output captured in job.message and job.output
   - Frontend displays error with logs
   - Job remains in database for debugging

5. **Cancellation** (`status=cancelled`)
   - User clicks "Cancel" in UI
   - Frontend calls DELETE /api/jobs/:id/cancel
   - Backend sends SIGTERM to child process
   - Job marked cancelled
   - Temp files cleaned up

### Child Process Management

**Spawning:**
```javascript
const child = spawn("oc-mirror", args, {
  cwd: workingDir,
  env: { ...process.env, REGISTRY_AUTH_FILE: authFilePath },
  timeout: 3600000  // 1 hour
});
```

**Output Streaming:**
```javascript
child.stdout.on("data", (data) => {
  const chunk = data.toString();
  appendJobOutput(jobId, chunk, MAX_OUTPUT_BYTES);
  updateJob(jobId, { 
    progress: extractProgress(chunk),
    message: extractStatusMessage(chunk)
  });
});
```

**Error Handling:**
```javascript
child.on("error", (err) => {
  updateJob(jobId, {
    status: "failed",
    message: err.message
  });
});

child.on("close", (code, signal) => {
  if (signal) {
    updateJob(jobId, { status: "cancelled", message: `Killed by ${signal}` });
  } else if (code === 0) {
    updateJob(jobId, { status: "completed", progress: 100 });
  } else {
    updateJob(jobId, { status: "failed", message: `Exit code ${code}` });
  }
  cleanupTempFiles();
});
```

### Polling vs. Streaming

**Current Implementation: Polling**
- Frontend polls GET /api/jobs/:id every 2 seconds while job is running
- Simple implementation, works across all browsers
- Trade-off: slight latency in status updates

**Future: Server-Sent Events (SSE)**
- Could implement SSE for real-time job updates
- Reduces polling overhead
- Better UX for long-running jobs

### Output Truncation

- Job output limited to 500KB to prevent memory exhaustion
- When limit exceeded, oldest output is trimmed (keeps last 500KB)
- Full logs available in container logs if DEBUG=true

---

## Cincinnati Integration

### Purpose

Cincinnati is Red Hat's OpenShift update graph service. The app uses Cincinnati's GitHub data repository to fetch available OpenShift versions and update channels.

### Data Source

- **Channels:** `https://api.github.com/repos/openshift/cincinnati-graph-data/contents/channels`
- **Patch versions:** `https://raw.githubusercontent.com/openshift/cincinnati-graph-data/master/channels/stable-X.Y.yaml`

### Caching Strategy

**Why Cache?**
- GitHub API has rate limits (60 req/hour unauthenticated)
- Version data changes infrequently (new patches monthly)
- Reduces latency and external dependencies

**Cache Implementation:**
- SQLite `cache` table with key-value storage
- Cache keys:
  - `cincinnati_channels_v1` - List of available channels (e.g., ["4.20", "4.19"])
  - `cincinnati_patches_v1:4.20` - Patch versions for channel 4.20
- No TTL - cache invalidated by user-initiated refresh or `force=true` flag
- Background job (`POST /api/cincinnati/refresh`) can update cache asynchronously

**Cache Invalidation:**
- User clicks "Refresh versions" in Blueprint step
- Passes `?force=true` to `/api/channels` and `/api/versions/:channel`
- Backend fetches fresh data from GitHub, updates cache

### MOCK_MODE

For development/testing without network:
- Set `MOCK_MODE=true`
- Reads from `backend/mock-data/channels.json` and `backend/mock-data/stable-*.json`
- Eliminates external dependencies
- Allows airgap development

### Fetch Timeout

- Default: 45 seconds
- Configurable via `CINCINNATI_FETCH_TIMEOUT_MS` (min 5s, max 120s)
- Prevents indefinite hang behind misconfigured proxies
- Uses AbortSignal.timeout() for cancellation

### Version Sorting

Versions sorted descending by semver:
```javascript
const sortVersionsDesc = (versions) =>
  versions.sort((a, b) => {
    const [amj, ami, ap] = a.split(".").map(Number);
    const [bmj, bmi, bp] = b.split(".").map(Number);
    if (amj !== bmj) return bmj - amj;  // Major
    if (ami !== bmi) return bmi - ami;  // Minor
    return bp - ap;                      // Patch
  });
```

Result: `["4.20.5", "4.20.4", "4.20.3", ...]`

---

## oc-mirror Runtime Selection

### Problem

oc-mirror is a platform-specific binary. The backend container may run on x86_64, but the user's target environment could be aarch64. The app must:
1. Use a working oc-mirror for **operator scan** (matches backend runtime arch)
2. Include correct oc-mirror for **export bundle** (matches Blueprint target arch)

### Architecture Awareness

**Runtime Architecture:**
- Detected via Node.js `process.arch`
- Normalized: `x64`/`amd64` → `x86_64`, `arm64` → `aarch64`
- Used for operator scan (local execution)

**Export Architecture:**
- Specified in Blueprint step (`state.blueprint.exportArch`)
- Defaults to `x86_64` if not specified
- Used for bundle inclusion (target environment)

### Binary Resolution Priority

**For Local Execution (operator scan):**

1. **`OC_MIRROR_BIN` env var**
   - User-provided path to oc-mirror binary
   - Preflight check (`oc-mirror version`) validates executable
   - Use case: Custom builds, specific versions

2. **Baked-in binary** (`/usr/local/bin/oc-mirror`)
   - Included in container image at build time
   - Matches container base architecture
   - Preflight check ensures usability

3. **Mirror download** (runtime arch)
   - Download from `https://mirror.openshift.com/pub/openshift-v4/{arch}/clients/ocp/latest/oc-mirror.tar.gz`
   - Try arch candidates: `x86_64`/`amd64`, `aarch64`/`arm64`
   - Extract to `${DATA_DIR}/tools/bin/oc-mirror`
   - Preflight check before use

4. **`OC_MIRROR_URL` env var**
   - User-provided URL to oc-mirror tarball
   - Download and extract
   - Preflight check
   - Use case: Custom mirrors, airgap scenarios

**For Export Bundle (target arch):**

- If export arch == runtime arch, reuse local binary
- Otherwise, download from mirror for export arch
- Stored in `${DATA_DIR}/tools/export-{arch}/bin/oc-mirror`
- In-flight promise deduplication (parallel export requests share one download)

### Preflight Check

Before using any oc-mirror binary:
```javascript
function runPreflight(binPath) {
  // Check file exists and is executable
  const stat = fs.statSync(binPath);
  if (!stat.isFile() || !(stat.mode & 0o111)) return { ok: false };
  
  // Run 'oc-mirror version' with 10s timeout
  const result = spawnSync(binPath, ["version"], {
    encoding: "utf8",
    timeout: 10000
  });
  
  // Check exit code
  if (result.status !== 0) return { ok: false, rawStderr: result.stderr };
  
  return { ok: true };
}
```

Preflight failures common on Apple Silicon (x86_64 binary on arm64 host).

### Error Handling

If no usable oc-mirror found:
```
No usable oc-mirror binary. The Operators scan requires a local oc-mirror 
that matches the backend runtime architecture. Set OC_MIRROR_BIN to a native 
binary path, or OC_MIRROR_URL to download one. On Apple Silicon, use a native 
aarch64 binary or OC_MIRROR_URL.
```

---

## Field Guide Generation

### Purpose

The Field Guide is a context-aware markdown document that provides deployment instructions tailored to the user's specific configuration. It reduces cognitive load by showing only relevant information and highlighting potential issues.

### Generation Pipeline

```
State object (full configuration)
    ↓
buildContext(state) - Extract relevant facts
    ↓
renderGuide(state, ctx, docsLinks) - Assemble markdown sections
    ↓
Markdown string (field-guide.md)
    ↓
Included in export bundle
```

### Context Extraction

`fieldGuide/context.js` analyzes state and extracts:
- Platform and method
- Networking mode (single-stack vs dual-stack)
- Node count and topology (HA vs SNO)
- Mirroring configuration
- Special features (FIPS, NTP, proxy, additional trust)
- Validation issues or warnings

### Guide Sections

1. **Overview** - Deployment summary
2. **Prerequisites** - Required resources, network access
3. **Platform-Specific Setup** - vSphere templates, bare metal IPMI, etc.
4. **Network Configuration** - CIDR details, VIP assignments, VLAN setup
5. **Mirroring Process** - oc-mirror usage, registry setup
6. **Installation Steps** - Platform-specific install procedures
7. **Validation** - Post-install checks
8. **Troubleshooting** - Common issues and solutions
9. **Documentation Links** - Embedded doc URLs from `docs_links` cache

### Dynamic Content

**Example: Dual-Stack Warning**
```javascript
if (ctx.enableIpv6 && !ctx.clusterNetworkCidrV6) {
  sections.push({
    heading: "⚠️ IPv6 Configuration Incomplete",
    content: "IPv6 is enabled but cluster network IPv6 CIDR is missing..."
  });
}
```

**Example: Platform Instructions**
```javascript
if (ctx.platform === "VMware vSphere") {
  sections.push({
    heading: "vSphere Template Preparation",
    content: "1. Download RHCOS OVA\n2. Import to vCenter\n3. Configure template..."
  });
}
```

### Documentation Links

- Fetched via `/api/docs/generate` (calls external doc service or cache)
- Stored in `docs_links` SQLite table
- Embedded in Field Guide as hyperlinks
- Reduces need to search docs manually

### Output Format

Markdown with:
- Clear section headings (`##`, `###`)
- Code blocks for commands and YAML
- Numbered lists for procedures
- Warning boxes (`⚠️`) for critical info
- Hyperlinks to official docs

---

## Asset Generation Pipeline

### Overview

Asset generation transforms the application state into deployment-ready artifacts:
1. **install-config.yaml** - OpenShift installer input (all scenarios)
2. **agent-config.yaml** - Agent-Based Installer input (Agent scenarios only)
3. **ImageSetConfiguration.yaml** - oc-mirror input for mirroring
4. **NTP MachineConfigs** - chrony configuration manifests (if NTP enabled)
5. **field-guide.md** - Deployment documentation

### Generation Flow

**Trigger:** User clicks "Download Bundle" or "Export Run File"

**Backend Endpoint:** `POST /api/export/bundle`

**Request Body:**
```json
{
  "state": { /* full state object */ },
  "exportArch": "x86_64",
  "includeCredentials": true,
  "includeBinaries": true
}
```

**Processing Steps:**

1. **Validate State**
   - Required fields present (baseDomain, clusterName, pull secret)
   - Platform-specific requirements met
   - Networking configuration valid

2. **Generate YAMLs**
   ```javascript
   const installConfig = buildInstallConfig(state);
   const agentConfig = isAgent ? buildAgentConfig(state) : null;
   const imageSetConfig = buildImageSetConfig(state);
   const ntpConfigs = state.ntp?.enabled ? buildNtpMachineConfigs(state) : null;
   ```

3. **Generate Field Guide**
   ```javascript
   const docsLinks = await getDocsFromCache(docsKey(state));
   const fieldGuide = buildFieldGuide(state, docsLinks);
   ```

4. **Fetch Binaries** (if `includeBinaries=true`)
   ```javascript
   const { ocPath, ocMirrorPath } = await getBinariesForExportArch(exportArch, dataDir);
   ```

5. **Create ZIP Archive**
   ```javascript
   const archive = archiver("zip", { zlib: { level: 9 } });
   archive.append(installConfigYaml, { name: "install-config.yaml" });
   if (agentConfig) archive.append(agentConfigYaml, { name: "agent-config.yaml" });
   archive.append(imageSetConfigYaml, { name: "ImageSetConfiguration.yaml" });
   archive.append(fieldGuide, { name: "field-guide.md" });
   if (includeBinaries) {
     archive.file(ocPath, { name: "oc" });
     archive.file(ocMirrorPath, { name: "oc-mirror" });
   }
   if (sshPrivateKey) archive.append(sshPrivateKey, { name: "ssh-key" });
   if (additionalTrustBundle) archive.append(trustBundle, { name: "additional-trust-bundle.pem" });
   archive.finalize();
   ```

6. **Stream to Client**
   ```javascript
   res.setHeader("Content-Type", "application/zip");
   res.setHeader("Content-Disposition", `attachment; filename="${filename}.zip"`);
   archive.pipe(res);
   ```

### Platform-Specific Generation

**Bare Metal:**
- Host definitions with MAC addresses, BMC credentials
- Boot mode (UEFI vs Legacy)
- Root device hints
- Network interface configs (bonds, VLANs)
- API/Ingress VIPs

**vSphere:**
- vCenter credentials
- Datacenter, cluster, datastore, network paths
- Failure domain definitions (4.16+)
- Resource pool assignments

**Nutanix:**
- Prism Central/Element configuration
- Subnet UUIDs
- Storage container references
- SNO vs HA vs compact topology

**AWS GovCloud:**
- Region selection
- AMI IDs (from installer stream metadata)
- Subnet roles (public/private/edge)
- Security group configurations

**Azure Government:**
- Cloud name (AzureUSGovernment)
- Region, resource group
- Virtual network configuration
- Outbound type (LoadBalancer vs UserDefinedRouting)

**IBM Cloud:**
- VPC configuration
- Dedicated host assignment
- Service endpoints

### Validation Before Generation

- Frontend validation blocks "Download" if errors present
- Backend performs minimal validation (required fields only)
- Invalid configs may be rejected by openshift-install (user responsibility)

---

## Security Model

### Authentication and Authorization

**Current State: No Built-In Authentication**
- Application has no user authentication system
- Suitable for single-user workstation deployments
- Not designed for multi-tenant or public-facing deployments

**Security Model:**
- **Trusted Environment** - Assumes backend runs in user-controlled environment (local desktop, internal VM)
- **Network Isolation** - Backend should NOT be exposed to untrusted networks
- **Deployment Context** - Authentication is context-dependent (user's responsibility if deployed to shared environment)

**If Deployed to Shared Environment:**
- Add reverse proxy with authentication (nginx + OAuth2, Apache + LDAP)
- Use VPN or firewall to restrict access
- Run in Kubernetes with NetworkPolicy and Ingress authentication

### Credential Handling

**Pull Secrets:**
- NEVER persisted to SQLite or disk
- Held in memory during generation only
- Temp auth files created with mode `0o600` (owner-only read)
- Cleaned up after job completion
- Not included in export bundle unless user explicitly checks "Include Credentials"

**SSH Keys:**
- Generated on-demand via `ssh-keygen` child process
- Private key held in memory, returned to frontend
- User decides whether to include in export bundle
- Temporary files created with restrictive permissions

**BMC Credentials (Bare Metal):**
- Stored in state object (SQLite)
- Included in generated install-config.yaml
- Warning displayed if "Include Credentials" unchecked but BMC creds present

**Registry Credentials:**
- Written to temp file at `${DATA_DIR}/tmp/registry-auth-{nanoid}.json`
- File mode `0o600` (owner-only read)
- Passed to oc-mirror via `REGISTRY_AUTH_FILE` env var
- Deleted after job completion (via `safeUnlink`)

### Path Traversal Protection

**Vulnerability:** `/api/fs/ls` endpoint accepts user-supplied paths

**Mitigation (Implemented in Security Phase):**
```javascript
const ALLOWED_BASE_PATHS = [
  path.resolve(process.env.DATA_DIR || "/data"),
  "/tmp"
];

function isPathAllowed(requestedPath) {
  const resolved = path.resolve(requestedPath);
  return ALLOWED_BASE_PATHS.some(base => resolved.startsWith(base));
}
```

Only paths within `DATA_DIR` or `/tmp` are accessible.

### Command Injection Prevention

**SSH Key Generation:**
- Algorithm parameter validated against whitelist: `['ed25519', 'rsa', 'ecdsa']`
- No shell interpolation - uses child_process.spawn with array args

**Tar Extraction:**
- Uses `--no-absolute-filenames` flag to prevent path traversal
- No user-supplied data in tar command

**oc-mirror Execution:**
- Args passed as array to spawn (no shell interpolation)
- Temp files use `nanoid()` for unpredictable names
- No eval or exec of user-supplied strings

### Rate Limiting

**Feedback Endpoints:**
- POST /api/feedback/submit - 5 requests per 15 minutes (burst: 2 per minute)
- POST /api/feedback/challenge - 10 requests per 15 minutes
- In-memory rate limiter (per client IP)
- Trusts X-Forwarded-For only from TRUSTED_PROXIES

**Other Endpoints:**
- No rate limiting (assumes trusted environment)
- Add nginx rate limiting if deployed publicly

### Data Validation

**Frontend:**
- Input validation via `validation.js` (CIDR, IP, MAC, SSH key, pull secret format)
- Validation provides hints, does not enforce (user can bypass)

**Backend:**
- Minimal input validation on POST endpoints
- JSON parsing with try-catch (prevents crashes)
- Size limits: 10MB for /api/state, 10KB for feedback text

**Missing (Tracked in Plan):**
- Joi/Zod schema validation for POST /api/state
- Pull secret registry URL validation
- SSH public key format validation

---

## Deployment Patterns

### 1. Local Desktop (Recommended)

**Architecture:**
```
User's Laptop
├─ Docker Desktop / Podman
│  └─ openshift-airgap-architect container
│     ├─ Frontend (served at http://localhost:4000)
│     ├─ Backend (Express)
│     └─ SQLite (${DATA_DIR}/airgap-architect.db)
└─ User browses to http://localhost:4000
```

**Characteristics:**
- Single-user, trusted environment
- No authentication needed
- DATA_DIR mapped to host volume for persistence
- Binaries (oc, oc-mirror) downloaded on-demand

**Docker Compose:**
```yaml
services:
  app:
    image: openshift-airgap-architect:latest
    ports:
      - "4000:4000"
    volumes:
      - ./data:/data
    environment:
      - DATA_DIR=/data
      - MOCK_MODE=false
```

### 2. Shared VM (Team Environment)

**Architecture:**
```
Internal VM (internal.corp.com)
├─ nginx reverse proxy (HTTPS, OAuth2)
│  └─ Forwards to localhost:4000
└─ Docker container
   └─ openshift-airgap-architect
      └─ Listens on localhost:4000 only
```

**Security Additions:**
- Nginx with OAuth2 authentication (Google, GitHub, LDAP)
- HTTPS with corporate certificate
- Backend bound to 127.0.0.1 (not exposed directly)
- Firewall restricts access to internal network

**Nginx Config:**
```nginx
server {
  listen 443 ssl;
  server_name airgap.internal.corp.com;
  
  location /oauth2/ {
    proxy_pass http://oauth2-proxy:4180;
  }
  
  location / {
    auth_request /oauth2/auth;
    proxy_pass http://127.0.0.1:4000;
  }
}
```

### 3. Kubernetes (Multi-User SaaS)

**Architecture:**
```
Kubernetes Cluster
├─ Ingress (TLS termination, OAuth2)
│  └─ Routes to airgap-architect Service
└─ Deployment: airgap-architect
   ├─ Pod 1: app + ephemeral SQLite
   ├─ Pod 2: app + ephemeral SQLite
   └─ PersistentVolumeClaim (shared DATA_DIR)
```

**Challenges:**
- SQLite not designed for concurrent writes (WAL mode helps but has limits)
- Need shared PVC for operator scan results
- Session affinity required if SQLite per-pod

**Better Approach:**
- Use PostgreSQL instead of SQLite
- Refactor state storage to use proper DB transactions
- Horizontal scaling becomes feasible

### 4. Air-Gapped Bastion

**Use Case:** Bootstrap box inside air-gapped network

**Pre-Deployment:**
1. Build container image in connected environment
2. Export image: `docker save -o airgap-architect.tar openshift-airgap-architect:latest`
3. Transfer tarball to bastion via USB/CD

**Deployment:**
```bash
# Load image
docker load -i airgap-architect.tar

# Run with MOCK_MODE (no external network)
docker run -d -p 4000:4000 \
  -v /opt/data:/data \
  -e MOCK_MODE=true \
  openshift-airgap-architect:latest
```

**Limitations:**
- Cincinnati data frozen (use MOCK_MODE with pre-loaded channels)
- No oc-mirror binary download (must pre-populate or use OC_MIRROR_BIN)
- No documentation link fetching (cached docs only)

---

## Performance Considerations

### SQLite Write Contention

- WAL mode reduces lock contention
- Single-writer architecture (backend only writes state)
- Long-running writes (oc-mirror jobs) don't block state updates

### Job Output Truncation

- Max 500KB output per job prevents memory exhaustion
- Oldest output dropped when limit exceeded
- Full logs available in container stdout if DEBUG=true

### Binary Caching

- Downloaded binaries cached in `${DATA_DIR}/tools/`
- Reused across sessions
- Per-architecture directories for export binaries

### Cincinnati Caching

- Channels/versions cached indefinitely in SQLite
- Reduces GitHub API calls (rate limit: 60/hour unauthenticated)
- Background refresh job available

### In-Flight Download Deduplication

- Parallel requests for same resource share one download
- Implemented for installer downloads, oc-mirror downloads
- Prevents redundant network I/O

---

## Observability

### Logging

**Frontend:**
- Console logs for validation errors (development mode)
- Action logger (`logger.js`) tracks user interactions
- No persistent logging (browser console only)

**Backend:**
- stdout/stderr for Express server logs
- DEBUG=true enables verbose logging
- Job output captured in database

**Recommended for Production:**
- Ship container logs to aggregator (Splunk, ELK, Loki)
- Add structured logging with correlation IDs
- Implement request ID tracking across frontend/backend

### Metrics

**Not Currently Implemented**

Recommended additions:
- Prometheus metrics endpoint
- Job duration histograms
- API request rate/latency
- SQLite query performance
- oc-mirror success/failure rates

### Health Checks

**Endpoints:**
- `GET /api/health` - Basic liveness (returns 200 if server running)
- `GET /api/status` - Returns `{ ok: true }`

**Missing:**
- Readiness check (database connectivity)
- Dependency health (GitHub, mirror.openshift.com)
- Disk space check (DATA_DIR)

---

## Future Architecture Considerations

### Database Migration

**Current:** SQLite (embedded, single-file)
**Future:** PostgreSQL or MySQL

**Benefits:**
- Better concurrency for multi-user deployments
- Horizontal scaling capability
- Advanced query features
- Standard backup/restore tools

**Migration Path:**
- Add database abstraction layer (`repositories/`)
- Implement PostgreSQL adapter alongside SQLite
- Feature flag: `DB_TYPE=sqlite|postgres`

### Real-Time Updates

**Current:** Polling (frontend polls /api/jobs/:id every 2s)
**Future:** Server-Sent Events (SSE) or WebSocket

**Benefits:**
- Reduced network traffic
- Real-time job status updates
- Better UX for long-running operations

### Microservices Split

**Current:** Monolith (frontend + backend + jobs in one process)
**Future:** Separate services

**Potential Split:**
```
Frontend Service (nginx serving static React build)
API Service (Express REST API)
Job Service (Background job processor)
Shared Database (PostgreSQL)
Shared File Storage (S3, NFS)
```

**Benefits:**
- Independent scaling
- Fault isolation
- Technology flexibility (job service in Go for concurrency)

### Multi-Tenancy

**Current:** Single-user state (singleton row in app_state)
**Future:** Per-user state isolation

**Changes Needed:**
- User authentication system
- State keyed by user ID
- Row-level security or schema-per-tenant
- Quota enforcement (storage, jobs)

---

## Appendix: Data Directory Structure

```
${DATA_DIR}/
├─ airgap-architect.db          # SQLite database
├─ airgap-architect.db-shm       # Shared memory (WAL mode)
├─ airgap-architect.db-wal       # Write-ahead log
├─ tmp/                          # Temporary files
│  ├─ registry-auth-{id}.json   # Pull secret temp files (mode 0o600)
│  └─ ssh-key-{id}              # SSH key temp files
├─ tools/                        # Downloaded binaries
│  ├─ openshift-install-{ver}   # openshift-install binaries (per version)
│  ├─ bin/                       # Runtime oc/oc-mirror (local arch)
│  │  ├─ oc
│  │  └─ oc-mirror
│  ├─ export-x86_64/             # Export binaries (target arch)
│  │  └─ bin/
│  │     ├─ oc
│  │     └─ oc-mirror
│  └─ export-aarch64/
│     └─ bin/
│        ├─ oc
│        └─ oc-mirror
├─ cache/                        # Installer stream metadata cache
│  └─ stream-{version}.json
└─ oc-mirror-{jobid}/            # oc-mirror working directories (per job)
   ├─ imageset-config.yaml
   ├─ oc-mirror-workspace/
   └─ results/
```

---

## Summary

The OpenShift Airgap Architect is a full-stack web application designed to simplify disconnected OpenShift deployments. Its architecture balances simplicity (SQLite, embedded binaries) with flexibility (platform-agnostic YAML generation, architecture-aware binary selection). The system is suitable for single-user desktop deployments and can be extended to multi-user scenarios with authentication, database migration, and scaling enhancements.

**Key Architectural Strengths:**
- **Stateful wizard flow** with persistent SQLite storage
- **Platform-agnostic generation** supporting 6 platforms and 3 installation methods
- **Architecture-aware binary handling** for cross-platform export
- **Asynchronous job system** for long-running operations
- **Contextual documentation** via Field Guide generation
- **Caching strategy** reducing external dependencies

**Areas for Future Enhancement:**
- PostgreSQL migration for scalability
- Real-time updates via SSE/WebSocket
- Comprehensive observability (metrics, structured logging)
- Multi-tenancy support
- Advanced validation with schema enforcement
