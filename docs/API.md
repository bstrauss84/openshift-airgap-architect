# API Reference

This document provides comprehensive documentation for all backend API endpoints in the OpenShift Airgap Architect application.

**Base URL:** `http://localhost:4000/api` (configurable via `VITE_API_BASE`)

**Authentication:** None (context-dependent deployment - see [Security Model](#security-model))

**Content-Type:** All requests and responses use `application/json` unless otherwise specified

---

## Table of Contents

- [Health & Status](#health--status)
- [State Management](#state-management)
- [Cincinnati (Release Channels)](#cincinnati-release-channels)
- [Operator Catalog](#operator-catalog)
- [oc-mirror Integration](#oc-mirror-integration)
- [Asset Generation](#asset-generation)
- [Bundle Export](#bundle-export)
- [Job Management](#job-management)
- [SSH Key Generation](#ssh-key-generation)
- [AWS Integration](#aws-integration)
- [Documentation Cache](#documentation-cache)
- [Feedback System](#feedback-system)
- [System Utilities](#system-utilities)
- [Security Model](#security-model)
- [Error Responses](#error-responses)
- [Rate Limiting](#rate-limiting)

---

## Health & Status

### `GET /api/health`

Health check endpoint for liveness probes.

**Response:**
```json
{
  "ok": true
}
```

**Status Codes:**
- `200 OK` - Service is running

---

### `GET /api/ready`

Readiness check endpoint. Validates critical dependencies.

**Response:**
```json
{
  "ready": true,
  "authAvailable": true,
  "dataDir": "/data",
  "dataDirWritable": true
}
```

**Fields:**
- `ready` (boolean) - Overall readiness status
- `authAvailable` (boolean) - Whether pull secret is available
- `dataDir` (string) - Configured data directory path
- `dataDirWritable` (boolean) - Whether data directory is writable

**Status Codes:**
- `200 OK` - Service is ready
- `503 Service Unavailable` - Service is not ready (returns same JSON with `ready: false`)

---

### `GET /api/build-info`

Returns build metadata for UI display (Tools → About).

**Response:**
```json
{
  "gitSha": "a1b2c3d4e5f6",
  "buildTime": "2026-05-01T12:00:00Z",
  "repo": "bstrauss84/openshift-airgap-architect",
  "branch": "main"
}
```

**Environment Variables:**
- `APP_GIT_SHA`
- `APP_BUILD_TIME`
- `APP_REPO`
- `APP_BRANCH`

---

### `GET /api/update-info`

Checks for available updates against GitHub releases.

**Query Parameters:**
- `force` (boolean, optional) - Bypass cache and force fresh check

**Response:**
```json
{
  "updateAvailable": true,
  "latestVersion": "v1.2.3",
  "currentVersion": "v1.2.0",
  "releaseUrl": "https://github.com/bstrauss84/openshift-airgap-architect/releases/tag/v1.2.3",
  "error": null
}
```

**Status Codes:**
- `200 OK` - Check completed (even if error)
- Returns `updateAvailable: false` with `error` field if check fails

**Notes:**
- Requires `CHECK_UPDATES` enabled and `APP_GIT_SHA` set
- Caches result for 1 hour
- Safe to call repeatedly (rate limited by cache)

---

## State Management

The application state is a single JSON object stored in SQLite, tracking wizard progress and configuration.

### `GET /api/state`

Retrieves current application state.

**Response:**
```json
{
  "blueprint": { ... },
  "methodology": { ... },
  "globalStrategy": { ... },
  "hostInventory": { ... },
  "credentials": { ... },
  "trust": { ... },
  "platformConfig": { ... },
  "exportOptions": { ... },
  "version": { ... },
  "ocMirrorConfig": { ... }
}
```

**Status Codes:**
- `200 OK` - Returns state object (may be empty `{}` on first load)

---

### `POST /api/state`

Updates application state (partial updates supported).

**Request Body:**
```json
{
  "blueprint": {
    "platform": "Bare Metal",
    "baseDomain": "example.com"
  },
  "methodology": {
    "method": "Agent-Based Installer"
  }
}
```

**Response:**
```json
{
  "blueprint": {
    "platform": "Bare Metal",
    "baseDomain": "example.com"
  },
  "methodology": {
    "method": "Agent-Based Installer"
  }
  // ... merged with existing state
}
```

**Behavior:**
- Deep merges incoming changes with existing state
- Returns the full merged state
- Persists to SQLite immediately

**Status Codes:**
- `200 OK` - State updated successfully

---

### `POST /api/start-over`

Clears all application state and jobs.

**Response:**
```json
{
  "ok": true,
  "jobsDeleted": 5,
  "tmpFilesCleaned": true
}
```

**Side Effects:**
- Deletes all rows from `run_state` table (SQLite)
- Deletes all jobs from `jobs` table
- Cleans temporary files in `${DATA_DIR}/tmp`

**Status Codes:**
- `200 OK` - State cleared successfully

---

### `GET /api/run/export`

Exports current state as JSON download.

**Response:**
- `Content-Type: application/json`
- `Content-Disposition: attachment; filename="airgap-architect-run-YYYYMMDD-HHMMSS.json"`
- Body: Current state JSON

**Example:**
```json
{
  "blueprint": { ... },
  "methodology": { ... },
  // ... full state
}
```

**Status Codes:**
- `200 OK` - Export successful

---

### `POST /api/run/import`

Imports state from JSON file.

**Request Body:**
```json
{
  "blueprint": { ... },
  "methodology": { ... }
  // ... state to import
}
```

**Response:**
```json
{
  "blueprint": { ... },
  "methodology": { ... }
  // ... imported state
}
```

**Behavior:**
- Replaces entire state with imported data
- Returns the new state

**Status Codes:**
- `200 OK` - Import successful
- `400 Bad Request` - Invalid JSON format

---

### `POST /api/run/duplicate`

Creates a copy of current run state with new ID.

**Response:**
```json
{
  "ok": true
}
```

**Behavior:**
- Clears ephemeral fields (job IDs, operator scan results)
- Resets wizard completion state
- Preserves configuration (blueprint, networking, hosts, etc.)

**Status Codes:**
- `200 OK` - Duplicate created

---

## Cincinnati (Release Channels)

Cincinnati integration provides OpenShift release channel and patch version data from GitHub.

### `GET /api/cincinnati/channels`

Returns available OpenShift release channels.

**Query Parameters:**
- `force` (boolean, optional) - Bypass cache and fetch fresh data

**Response:**
```json
{
  "channels": ["4.17", "4.18", "4.19", "4.20"],
  "error": null
}
```

**Status Codes:**
- `200 OK` - Returns channels (may include error field if fetch failed)

**Notes:**
- Data cached for 1 hour
- `MOCK_MODE=true` uses bundled `mock-data/channels.json`
- Fetches from `github.com/openshift/cincinnati-graph-data`

---

### `POST /api/cincinnati/update`

Triggers asynchronous refresh of Cincinnati channels.

**Response:**
```json
{
  "jobId": "abc123xyz",
  "status": "queued"
}
```

**Status Codes:**
- `200 OK` - Refresh job created

**Polling:**
- Use `GET /api/jobs/:id` to check job status
- Job completes when `status === "completed"`
- On completion, call `GET /api/cincinnati/channels` for fresh data

---

### `GET /api/cincinnati/patches`

Returns patch versions for a specific channel.

**Query Parameters:**
- `channel` (string, required) - Release channel (e.g., "4.20")
- `force` (boolean, optional) - Bypass cache

**Response:**
```json
{
  "versions": ["4.20.0", "4.20.1", "4.20.2"],
  "error": null
}
```

**Status Codes:**
- `200 OK` - Returns versions
- `400 Bad Request` - Missing `channel` parameter

**Notes:**
- Data cached for 1 hour per channel
- Automatically filters versions matching the channel prefix
- Sorted descending (newest first)

---

### `POST /api/cincinnati/patches/update`

Triggers asynchronous refresh of patch versions for a channel.

**Request Body:**
```json
{
  "channel": "4.20"
}
```

**Response:**
```json
{
  "jobId": "def456uvw",
  "status": "queued"
}
```

**Status Codes:**
- `200 OK` - Refresh job created
- `400 Bad Request` - Missing channel

---

### `POST /api/cincinnati/refresh-job`

Creates a background job to refresh Cincinnati data.

**Response:**
```json
{
  "jobId": "ghi789rst"
}
```

**Status Codes:**
- `200 OK` - Job created

---

## Operator Catalog

Operator catalog scanning uses `oc-mirror list operators` to query Red Hat catalogs.

### `GET /api/operators/credentials`

Checks if operator scan credentials are available.

**Response:**
```json
{
  "available": true,
  "source": "environment"
}
```

**Fields:**
- `available` (boolean) - Whether pull secret is configured
- `source` (string) - Where credentials were found (`"environment"`, `"file"`, `"state"`, `"none"`)

**Status Codes:**
- `200 OK`

---

### `POST /api/operators/confirm`

Confirms that user wants to proceed with operator scan despite missing credentials.

**Response:**
```json
{
  "confirmed": true
}
```

**Status Codes:**
- `200 OK`

**Notes:**
- No actual state change; frontend uses this to track user acknowledgment
- Scan will use wizard-provided pull secret if available

---

### `POST /api/operators/scan`

Initiates operator catalog scan (synchronous for now, may become async).

**Request Body:**
```json
{
  "pullSecret": "{\"auths\":{...}}",
  "catalog": "registry.redhat.io/redhat/redhat-operator-index:v4.20"
}
```

**Response:**
```json
{
  "operators": [
    {
      "name": "advanced-cluster-management",
      "displayName": "Advanced Cluster Management",
      "defaultChannel": "release-2.11"
    }
  ],
  "catalog": "registry.redhat.io/redhat/redhat-operator-index:v4.20",
  "scannedAt": 1714569600000
}
```

**Status Codes:**
- `200 OK` - Scan completed successfully
- `400 Bad Request` - Missing pull secret in MOCK_MODE
- `500 Internal Server Error` - Scan failed

**Notes:**
- Runs `oc-mirror list operators --catalog=<catalog>`
- Requires pull secret with `registry.redhat.io` auth
- `MOCK_MODE=true` bypasses actual scan, returns mock data

---

### `POST /api/operators/prefetch`

Pre-fetches operator catalog data in background (future async implementation).

**Request Body:**
```json
{
  "catalog": "registry.redhat.io/redhat/redhat-operator-index:v4.20"
}
```

**Response:**
```json
{
  "jobId": "jkl012mno",
  "status": "queued"
}
```

**Status Codes:**
- `200 OK` - Prefetch job created

---

### `GET /api/operators/status`

Returns status of last operator scan.

**Response:**
```json
{
  "scanning": false,
  "lastScan": {
    "catalog": "registry.redhat.io/redhat/redhat-operator-index:v4.20",
    "scannedAt": 1714569600000,
    "operatorCount": 247
  }
}
```

**Status Codes:**
- `200 OK`

---

## oc-mirror Integration

oc-mirror operations for mirroring OpenShift releases and operator catalogs.

### `POST /api/ocmirror/preflight`

Validates oc-mirror configuration before execution.

**Request Body:**
```json
{
  "imageSetConfig": "...",  // YAML content
  "pullSecret": "{\"auths\":{...}}",
  "mirrorRegistryUrl": "mirror.example.com:5000"
}
```

**Response:**
```json
{
  "valid": true,
  "errors": [],
  "warnings": ["Destination registry not reachable (expected in disconnected workflow)"]
}
```

**Validation Checks:**
- ImageSetConfig YAML syntax
- Required fields presence
- Source registry reachability (if not MOCK_MODE)
- Mirror registry format (warning only for unreachable)

**Status Codes:**
- `200 OK` - Validation completed (check `valid` field)
- `400 Bad Request` - Missing required fields

---

### `POST /api/ocmirror/run`

Executes oc-mirror to create a mirror archive.

**Request Body:**
```json
{
  "imageSetConfig": "...",  // YAML content
  "pullSecret": "{\"auths\":{...}}",
  "mirrorRegistryUrl": "mirror.example.com:5000",
  "skipMetadata": false,
  "skipCleanup": false
}
```

**Response:**
```json
{
  "jobId": "pqr345stu",
  "status": "running",
  "message": "oc-mirror started"
}
```

**Status Codes:**
- `200 OK` - Job created and started
- `400 Bad Request` - Invalid configuration
- `500 Internal Server Error` - Failed to start oc-mirror

**Job Streaming:**
- Use `GET /api/jobs/:id/stream` to watch real-time output
- oc-mirror output is streamed to `${DATA_DIR}/jobs/${jobId}/output.log`

**Notes:**
- Creates temporary auth file with pull secret (mode 0o600)
- Runs `oc-mirror --config /tmp/isc.yaml file://output`
- On completion, archives are in `${DATA_DIR}/jobs/${jobId}/`

---

## Asset Generation

Generates OpenShift installation assets (install-config.yaml, agent-config.yaml, etc.).

### `GET /api/generate`

Retrieves current generation status.

**Response:**
```json
{
  "ready": true,
  "lastGenerated": 1714569600000,
  "files": ["install-config.yaml", "agent-config.yaml"]
}
```

**Status Codes:**
- `200 OK`

---

### `POST /api/generate`

Generates installation configuration files from current state.

**Request Body:**
```json
{
  "format": "yaml",  // or "json"
  "includeManifests": true
}
```

**Response:**
```json
{
  "files": {
    "install-config.yaml": "...",
    "agent-config.yaml": "..."
  },
  "generatedAt": 1714569600000
}
```

**Generated Files:**
- `install-config.yaml` - OpenShift installer configuration
- `agent-config.yaml` - Agent-based installer configuration (if applicable)
- Additional manifests based on platform and methodology

**Status Codes:**
- `200 OK` - Generation successful
- `400 Bad Request` - Invalid state or missing required fields
- `500 Internal Server Error` - Generation failed

---

## Bundle Export

Creates downloadable ZIP bundles of generated assets.

### `POST /api/bundle.prepare`

Prepares files for bundling.

**Response:**
```json
{
  "ready": true,
  "files": [
    "install-config.yaml",
    "agent-config.yaml",
    "field-guide.pdf"
  ],
  "totalSize": 524288
}
```

**Status Codes:**
- `200 OK` - Bundle preparation complete

---

### `GET /api/bundle.zip`

Downloads prepared bundle as ZIP file.

**Response:**
- `Content-Type: application/zip`
- `Content-Disposition: attachment; filename="airgap-architect-bundle-YYYYMMDD-HHMMSS.zip"`
- Body: ZIP archive

**Status Codes:**
- `200 OK` - Download successful
- `404 Not Found` - Bundle not prepared

---

### `POST /api/bundle.zip`

Creates and streams ZIP bundle in one request.

**Request Body:**
```json
{
  "includeFieldGuide": true,
  "includeOcMirrorOutput": true
}
```

**Response:**
- Streaming ZIP archive

**Status Codes:**
- `200 OK` - Streaming started
- `500 Internal Server Error` - Bundle creation failed

---

## Job Management

Background job tracking for long-running operations (oc-mirror, Cincinnati refresh, operator scan).

### `GET /api/jobs`

Lists all jobs.

**Query Parameters:**
- `type` (string, optional) - Filter by job type (`"ocmirror"`, `"cincinnati-refresh"`, etc.)
- `status` (string, optional) - Filter by status (`"queued"`, `"running"`, `"completed"`, `"failed"`)

**Response:**
```json
{
  "jobs": [
    {
      "id": "abc123",
      "type": "ocmirror",
      "status": "running",
      "progress": 45,
      "message": "Mirroring release images...",
      "created_at": 1714569600000,
      "updated_at": 1714569650000
    }
  ]
}
```

**Status Codes:**
- `200 OK`

---

### `GET /api/jobs/count`

Returns count of jobs by status.

**Response:**
```json
{
  "total": 10,
  "queued": 2,
  "running": 1,
  "completed": 5,
  "failed": 2
}
```

**Status Codes:**
- `200 OK`

---

### `DELETE /api/jobs`

Deletes all completed and failed jobs.

**Response:**
```json
{
  "deleted": 7
}
```

**Status Codes:**
- `200 OK`

---

### `GET /api/jobs/:id`

Retrieves details for a specific job.

**Response:**
```json
{
  "id": "abc123",
  "type": "ocmirror",
  "status": "completed",
  "progress": 100,
  "message": "Mirror completed successfully",
  "output": "/data/jobs/abc123/output.log",
  "created_at": 1714569600000,
  "updated_at": 1714569800000,
  "metadata_json": "{\"archiveSize\":1073741824}"
}
```

**Status Codes:**
- `200 OK`
- `404 Not Found` - Job ID not found

---

### `GET /api/jobs/:id/stream`

Streams job output in real-time (Server-Sent Events).

**Response:**
- `Content-Type: text/event-stream`
- Events: `data: <log line>\n\n`

**Example:**
```
data: Starting oc-mirror...
data: Downloading release manifests...
data: Progress: 25%
data: Mirror completed
```

**Status Codes:**
- `200 OK` - Streaming started
- `404 Not Found` - Job not found

**Notes:**
- Connection stays open until job completes or client disconnects
- Automatically sends keepalive comments every 30 seconds
- Closes stream when job reaches terminal state

---

### `POST /api/jobs/:id/stop`

Terminates a running job.

**Response:**
```json
{
  "ok": true,
  "status": "stopped"
}
```

**Status Codes:**
- `200 OK` - Job stopped
- `404 Not Found` - Job not found
- `400 Bad Request` - Job not in stoppable state

**Notes:**
- Sends `SIGTERM` to job process
- Updates job status to `"failed"` with message `"Stopped by user"`

---

## SSH Key Generation

Generates SSH key pairs for OpenShift node access.

### `POST /api/ssh/keypair`

Generates a new SSH key pair.

**Request Body:**
```json
{
  "algorithm": "ed25519",  // or "rsa", "ecdsa"
  "comment": "user@hostname"
}
```

**Response:**
```json
{
  "privateKey": "-----BEGIN OPENSSH PRIVATE KEY-----\n...",
  "publicKey": "ssh-ed25519 AAAAC3... user@hostname"
}
```

**Supported Algorithms:**
- `ed25519` (default) - Recommended
- `rsa` - 4096-bit
- `ecdsa` - 521-bit

**Status Codes:**
- `200 OK` - Key pair generated
- `400 Bad Request` - Invalid algorithm
- `500 Internal Server Error` - ssh-keygen failed

**Notes:**
- Uses `ssh-keygen` binary
- Keys generated in `/tmp` and immediately read into memory
- Temporary files deleted after response

---

## AWS Integration

AWS-specific utilities for GovCloud deployments.

### `POST /api/aws/warm-installer`

Pre-downloads openshift-install for AWS region queries.

**Response:**
```json
{
  "ready": true,
  "path": "/data/bin/openshift-install"
}
```

**Status Codes:**
- `200 OK` - Installer ready

---

### `GET /api/aws/regions`

Returns available AWS GovCloud regions.

**Response:**
```json
{
  "regions": [
    {
      "id": "us-gov-west-1",
      "displayName": "GovCloud (US-West)"
    },
    {
      "id": "us-gov-east-1",
      "displayName": "GovCloud (US-East)"
    }
  ]
}
```

**Status Codes:**
- `200 OK` - Regions retrieved
- `500 Internal Server Error` - Failed to query openshift-install

**Notes:**
- Runs `openshift-install coreos print-stream-json`
- Parses AWS region metadata from stream

---

### `GET /api/aws/ami`

Returns AMI ID for a specific region and architecture.

**Query Parameters:**
- `region` (string, required) - AWS region ID
- `version` (string, required) - OpenShift version (e.g., "4.20.1")
- `arch` (string, optional) - Architecture (`"x86_64"` or `"aarch64"`, default: `"x86_64"`)

**Response:**
```json
{
  "ami": "ami-0abc123def456",
  "region": "us-gov-west-1",
  "version": "4.20.1",
  "arch": "x86_64"
}
```

**Status Codes:**
- `200 OK` - AMI found
- `400 Bad Request` - Missing parameters
- `404 Not Found` - No AMI for region/version/arch
- `500 Internal Server Error` - Query failed

---

## Documentation Cache

Caches OpenShift documentation for offline field guide generation.

### `GET /api/docs`

Returns list of cached documentation files.

**Response:**
```json
{
  "cached": [
    {
      "url": "https://docs.redhat.com/en/documentation/...",
      "cachedAt": 1714569600000,
      "size": 524288
    }
  ],
  "totalSize": 524288
}
```

**Status Codes:**
- `200 OK`

---

### `POST /api/docs/update`

Fetches and caches documentation for a URL.

**Request Body:**
```json
{
  "url": "https://docs.redhat.com/en/documentation/openshift_container_platform/4.20/html/installing/index"
}
```

**Response:**
```json
{
  "ok": true,
  "cached": true,
  "size": 524288
}
```

**Status Codes:**
- `200 OK` - Documentation cached
- `400 Bad Request` - Invalid URL
- `500 Internal Server Error` - Fetch failed

---

## Feedback System

User feedback submission with rate limiting and CAPTCHA-like challenge.

### `GET /api/feedback/config`

Returns feedback system configuration.

**Response:**
```json
{
  "enabled": true,
  "mode": "github",
  "repo": "bstrauss84/openshift-airgap-architect",
  "maxSummaryChars": 200,
  "maxDetailsChars": 5000,
  "maxContactChars": 200
}
```

**Status Codes:**
- `200 OK`

---

### `GET /api/feedback/challenge`

Generates a challenge token (CAPTCHA-like protection).

**Response:**
```json
{
  "challenge": "What is 7 + 3?",
  "token": "eyJhbGciOiJIUzI1NiIs..."
}
```

**Status Codes:**
- `200 OK` - Challenge generated
- `429 Too Many Requests` - Challenge request rate limit exceeded

**Notes:**
- Token valid for 5 minutes (configurable via `FEEDBACK_CHALLENGE_TTL_MS`)
- Signed with `FEEDBACK_CHALLENGE_SECRET`

---

### `POST /api/feedback/submit`

Submits user feedback.

**Request Body:**
```json
{
  "summary": "Feature request: dark mode",
  "details": "It would be great to have...",
  "contact": "user@example.com",
  "category": "feature",
  "challengeToken": "eyJhbGci...",
  "challengeAnswer": "10"
}
```

**Response (github mode):**
```json
{
  "ok": true,
  "githubIssueUrl": "https://github.com/bstrauss84/openshift-airgap-architect/issues/new?title=..."
}
```

**Response (offline mode):**
```json
{
  "ok": true,
  "exportJson": {
    "summary": "...",
    "details": "...",
    "timestamp": 1714569600000
  }
}
```

**Status Codes:**
- `200 OK` - Feedback accepted
- `400 Bad Request` - Validation failed
- `403 Forbidden` - Challenge verification failed
- `429 Too Many Requests` - Rate limit exceeded

**Rate Limits:**
- 5 submissions per 15 minutes (configurable)
- 2 submissions per 1 minute burst (configurable)

---

## System Utilities

### `POST /api/system/path-check`

Validates that a path exists and is writable.

**Request Body:**
```json
{
  "path": "/mnt/usb-drive"
}
```

**Response:**
```json
{
  "exists": true,
  "writable": true,
  "path": "/mnt/usb-drive"
}
```

**Status Codes:**
- `200 OK` - Check completed
- `400 Bad Request` - Path not allowed (not under DATA_DIR)

**Security:**
- Only allows checking paths under `DATA_DIR` or `/tmp`
- Prevents path traversal attacks

---

### `GET /api/fs/ls`

Lists contents of a directory.

**Query Parameters:**
- `path` (string, required) - Directory path to list

**Response:**
```json
{
  "path": "/data/jobs",
  "entries": [
    {
      "name": "abc123",
      "type": "directory",
      "size": 4096,
      "modified": 1714569600000
    },
    {
      "name": "output.log",
      "type": "file",
      "size": 524288,
      "modified": 1714569700000
    }
  ]
}
```

**Status Codes:**
- `200 OK` - Directory listed
- `400 Bad Request` - Invalid path
- `403 Forbidden` - Path not allowed
- `404 Not Found` - Path does not exist

**Security:**
- **CRITICAL:** Path traversal vulnerability exists (see Phase 1 security fixes)
- Must implement path whitelist validation before production

---

### `GET /api/schema/stepMap`

Returns wizard step navigation schema.

**Response:**
```json
{
  "steps": [
    {
      "id": "blueprint",
      "label": "Blueprint",
      "order": 1
    },
    {
      "id": "methodology",
      "label": "Install Method",
      "order": 2
    }
  ]
}
```

**Status Codes:**
- `200 OK`

---

### `GET /api/runtime-info`

Returns runtime environment information.

**Response:**
```json
{
  "dataDir": "/data",
  "platform": "linux",
  "nodeVersion": "v20.11.0",
  "ocMirrorVersion": "v2.1.0",
  "mockMode": false
}
```

**Status Codes:**
- `200 OK`

---

### `GET /api/secrets/rh-pull-secret`

Checks if Red Hat pull secret is available.

**Response:**
```json
{
  "available": true
}
```

**Status Codes:**
- `200 OK`

---

### `GET /api/secrets/rh-pull-secret/content`

Retrieves Red Hat pull secret content.

**Response:**
```json
{
  "pullSecret": "{\"auths\":{...}}"
}
```

**Status Codes:**
- `200 OK` - Pull secret available
- `404 Not Found` - Pull secret not found

**Security:**
- Exposes sensitive credential data
- Should be protected by authentication in untrusted deployments

---

## Security Model

### Authentication

The backend **does not implement authentication** by default. The security model is **context-dependent**:

**Trusted Network Deployment (Default):**
- Application runs on `127.0.0.1` (localhost only)
- Access requires local system access or SSH tunnel
- No authentication needed - physical/network security is the boundary

**Untrusted Network Deployment:**
- If exposing to LAN/WAN, implement authentication layer:
  - Reverse proxy with authentication (nginx + basic auth, OAuth2 proxy)
  - VPN/bastion host requirement
  - Network ACLs
- Document security model in deployment guide
- Consider disabling sensitive endpoints (`/api/fs/ls`, `/api/secrets/*`)

### Rate Limiting

**Feedback Endpoints:**
- Challenge requests: 20 per minute per IP (configurable)
- Submissions: 5 per 15 minutes, 2 per minute burst (configurable)

**General Endpoints:**
- No rate limiting on most endpoints
- Trusted proxy configuration via `TRUSTED_PROXIES` for accurate IP detection

### Sensitive Endpoints

Endpoints that expose sensitive data or operations:
- `GET /api/secrets/rh-pull-secret/content` - Exposes pull secret
- `GET /api/fs/ls` - Directory traversal risk
- `POST /api/ocmirror/run` - Executes arbitrary oc-mirror operations
- `POST /api/ssh/keypair` - Generates SSH keys

**Recommendations:**
- Deploy behind authentication in untrusted environments
- Implement path whitelisting for `/api/fs/ls`
- Consider disabling or protecting sensitive endpoints via middleware

---

## Error Responses

All endpoints return errors in consistent JSON format:

```json
{
  "error": "Descriptive error message",
  "details": "Additional context (optional)",
  "field": "fieldName (for validation errors)"
}
```

### Common Status Codes

- `200 OK` - Request successful
- `400 Bad Request` - Invalid request parameters or body
- `403 Forbidden` - Operation not allowed (rate limit, challenge failure)
- `404 Not Found` - Resource not found
- `429 Too Many Requests` - Rate limit exceeded
- `500 Internal Server Error` - Server-side error
- `503 Service Unavailable` - Service not ready

### Example Error Response

```json
{
  "error": "Invalid CIDR format",
  "field": "machineNetworkV4",
  "details": "Expected format: 10.0.0.0/24"
}
```

---

## Rate Limiting

### Feedback Submission

**Headers (when rate limited):**
```
X-RateLimit-Limit: 5
X-RateLimit-Remaining: 0
X-RateLimit-Reset: 1714569900000
Retry-After: 300
```

**Response:**
```json
{
  "error": "Too many requests. Please try again later.",
  "retryAfter": 300
}
```

### Configuration

Rate limits are configurable via environment variables:
- `FEEDBACK_RATE_LIMIT_WINDOW_MS` - Time window in milliseconds
- `FEEDBACK_RATE_LIMIT_MAX` - Max requests per window
- `FEEDBACK_BURST_WINDOW_MS` - Burst window
- `FEEDBACK_BURST_MAX` - Max burst requests

See [ENVIRONMENT_VARIABLES.md](ENVIRONMENT_VARIABLES.md) for details.

---

## Examples

### Complete Workflow Example

```bash
# 1. Check readiness
curl http://localhost:4000/api/ready

# 2. Get current state
curl http://localhost:4000/api/state

# 3. Update state with blueprint
curl -X POST http://localhost:4000/api/state \
  -H "Content-Type: application/json" \
  -d '{
    "blueprint": {
      "platform": "Bare Metal",
      "baseDomain": "example.com"
    }
  }'

# 4. Fetch release channels
curl http://localhost:4000/api/cincinnati/channels

# 5. Get patch versions for 4.20
curl "http://localhost:4000/api/cincinnati/patches?channel=4.20"

# 6. Generate install-config
curl -X POST http://localhost:4000/api/generate

# 7. Download bundle
curl http://localhost:4000/api/bundle.zip -o bundle.zip

# 8. Export run state
curl http://localhost:4000/api/run/export -o my-run.json
```

### oc-mirror Job with Streaming

```bash
# 1. Start oc-mirror job
JOB_ID=$(curl -X POST http://localhost:4000/api/ocmirror/run \
  -H "Content-Type: application/json" \
  -d '{
    "imageSetConfig": "...",
    "pullSecret": "{...}",
    "mirrorRegistryUrl": "mirror.example.com:5000"
  }' | jq -r '.jobId')

# 2. Stream output in real-time
curl "http://localhost:4000/api/jobs/$JOB_ID/stream"

# 3. Check job status
curl "http://localhost:4000/api/jobs/$JOB_ID"

# 4. Stop job if needed
curl -X POST "http://localhost:4000/api/jobs/$JOB_ID/stop"
```

---

## Versioning

This API is currently **unversioned**. All endpoints are subject to change.

**Future versioning strategy (proposed):**
- Version prefix: `/api/v1/...`
- Backward compatibility maintained within major version
- Deprecation notices 6 months before breaking changes

---

## See Also

- [ENVIRONMENT_VARIABLES.md](ENVIRONMENT_VARIABLES.md) - Environment configuration
- [STATE_SCHEMA.md](STATE_SCHEMA.md) - Application state structure (TBD)
- [ARCHITECTURE.md](ARCHITECTURE.md) - System architecture (TBD)
- [README.md](../README.md) - Setup and deployment
