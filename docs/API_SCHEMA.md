# API Schema Documentation

OpenShift Airgap Architect backend API reference. All POST endpoints are validated using Zod schemas via `validateBody()` middleware.

**Validation approach:** Every POST route passes through `validateBody(schema)` middleware which:
- Parses and validates the request body against a Zod schema
- Replaces `req.body` with the validated/transformed data
- Returns `400` with structured error details on validation failure
- Returns `500` with error ID on unexpected validation errors
- Logs all validation failures via Pino structured logger

**Error response format:**
```json
{
  "error": "Validation failed",
  "errorId": "err_<uuid>",
  "details": [
    { "path": "field.name", "message": "Error description" }
  ]
}
```

The `errorId` correlates the error response with server-side log entries for debugging.

---

## Table of Contents

- [Health and System](#health-and-system)
- [State Management](#state-management)
- [Cincinnati (Release Channels)](#cincinnati-release-channels)
- [Operators](#operators)
- [Jobs](#jobs)
- [oc-mirror](#oc-mirror)
- [Collection Pipelines](#collection-pipelines)
- [SSH](#ssh)
- [AWS](#aws)
- [Trust and Proxy](#trust-and-proxy)
- [Documentation](#documentation)
- [Generation and Bundles](#generation-and-bundles)
- [Feedback](#feedback)
- [Filesystem](#filesystem)

---

## Health and System

### GET /api/health
Liveness probe. Returns 200 if the server process is running.

**Response:** `{ "status": "ok", ... }`

### GET /api/ready
Readiness probe. Checks data directory access and database connectivity.

**Response:** `{ "status": "ready" | "degraded", ... }`

### GET /api/build-info
Returns build metadata (git SHA, build time, branch).

### GET /api/runtime-info
Returns runtime architecture information for the server environment.

### GET /api/update-info
Returns available update information.

### GET /api/schema/stepMap
Returns the wizard step configuration map.

### POST /api/system/path-check
Validates a filesystem path exists and is accessible.

**Schema:** `pathCheckSchema`
```
{
  path: string (1-4096 chars, required)
}
```

---

## State Management

### GET /api/state
Returns the current wizard state.

### POST /api/state
Updates the wizard state. Permissive schema -- accepts any object to avoid stripping unknown fields.

**Schema:** `stateUpdateSchema` -- `z.object({}).catchall(z.unknown())`

### POST /api/start-over
Resets the wizard to default state, optionally cancelling running oc-mirror jobs.

**Schema:** `startOverSchema`
```
{
  cancelRunningOcMirror?: boolean  // default: true (cancel running jobs)
}
```

### GET /api/run/export
Exports the current run state as a JSON bundle.

### POST /api/run/import
Imports a previously exported run bundle.

**Schema:** `runImportSchema`
```
{
  state: object (required)       // The wizard state to import
  schemaVersion?: integer (1-2)  // Bundle schema version
  exportedAt?: string            // ISO timestamp
  runId?: string                 // Run identifier
  ...extra fields allowed
}
```

### POST /api/run/duplicate
Duplicates the current run with a new ID. No body required.

**Schema:** `runDuplicateSchema` -- `z.object({}).passthrough()`

---

## Cincinnati (Release Channels)

### GET /api/cincinnati/channels
Returns cached list of available OpenShift release channels.

### POST /api/cincinnati/update
Forces a refresh of the channel list. No body fields used.

**Schema:** `cincinnatiUpdateSchema` -- `z.object({}).passthrough()`

### GET /api/cincinnati/patches
Returns patch versions for a channel. Query param: `?channel=stable-4.20`

### POST /api/cincinnati/patches/update
Forces a refresh of patch versions for a specific channel.

**Schema:** `cincinnatiPatchesUpdateSchema`
```
{
  channel: string (required, min 1 char)  // e.g., "stable-4.20"
}
```

### POST /api/cincinnati/refresh-job
Launches an async background job to refresh Cincinnati data.

**Schema:** `cincinnatiRefreshSchema`
```
{
  preferredChannel?: string | null  // e.g., "4.20" or null
  channel?: string | null           // alternative channel field
  ...extra fields allowed
}
```

**Response:** `{ "jobId": "<id>" }` (HTTP 202)

---

## Operators

### GET /api/operators/credentials
Returns whether registry authentication is available.

### POST /api/operators/confirm
Confirms the release version for operator scanning. Reads from server state; no body fields used.

**Schema:** `operatorConfirmSchema` -- `z.object({}).passthrough()`

### POST /api/operators/scan
Launches operator catalog scanning jobs.

**Schema:** `operatorScanSchema`
```
{
  pullSecret?: string  // Valid JSON with auths object (optional if using mounted auth)
  catalog?: string     // Specific catalog to scan (optional, scans all if omitted)
}
```

### POST /api/operators/prefetch
Prefetches operator data from catalogs. Reads from server state; no body fields used.

**Schema:** `operatorsPrefetchSchema` -- `z.object({}).passthrough()`

### GET /api/operators/status
Returns cached operator scan results. Query param: `?version=4.20`

---

## Jobs

### GET /api/jobs
Lists all jobs. Query param: `?type=operator-scan`

### GET /api/jobs/count
Returns the total job count.

### GET /api/jobs/:id
Returns a specific job by ID.

### GET /api/jobs/:id/stream
SSE stream for real-time job progress updates.

### POST /api/jobs/:id/stop
Stops a running job. Job ID is in the URL parameter; no body fields used.

**Schema:** `jobStopSchema` -- `z.object({}).passthrough()`

### DELETE /api/jobs
Deletes completed jobs. Query param: `?completed=true`

---

## oc-mirror

### POST /api/ocmirror/preflight
Runs preflight checks before oc-mirror execution.

**Schema:** `ocMirrorPreflightSchema`
```
{
  mode?: "mirrorToDisk" | "diskToMirror" | "mirrorToMirror" (default: "mirrorToDisk")
  archivePath?: string
  workspacePath?: string
  cachePath?: string
  registryUrl?: string (max 2048 chars)
  configSourceType?: "generated" | "uploaded" (default: "generated")
  configPath?: string
  rhAuthSource?: "inline" | "mounted"
  rhPullSecret?: string (valid JSON with auths)
  mirrorAuthSource?: "reuse" | "inline"
  mirrorPullSecret?: string (valid JSON with auths)
  minBytes?: number (>= 0)
  advanced?: {
    logLevel?: "info" | "debug"
    parallelImages?: integer (1-32)
    parallelLayers?: integer (1-32)
    imageTimeout?: string
    retryTimes?: integer (0-10)
    retryDelay?: string
    since?: string
    strictArchive?: boolean
    signatureOptions?: {
      disableCertified?: boolean
      disableCommunity?: boolean
      customRegistries?: string[]
    }
    removeSignatures?: boolean
  }
  ...extra fields allowed
}
```

### POST /api/ocmirror/run
Launches an oc-mirror job.

**Schema:** `ocMirrorRunSchema` (same fields as preflight, plus `configContent?: string`)

---

## Collection Pipelines

**Note:** Collection Pipeline endpoints are only available when running in operator-managed mode (inside an OpenShift cluster with the mirror-operator).

### POST /api/collection-pipeline/create
Creates a new CollectionPipeline custom resource for the mirror-operator.

**Body:**
```json
{
  "name": "string (required)",              // Name of the CollectionPipeline CR
  "imageSetConfig": "string (required)",    // ImageSetConfiguration YAML content
  "pvc": "string (required)",               // PVC name for storage output
  "triggerType": "manual" | "event" | "scheduled" (default: "manual")
}
```

**Response (201):**
```json
{
  "success": true,
  "pipeline": {
    "name": "collection-12345",
    "namespace": "mirror-operator-system",
    "uid": "abc-123-...",
    "creationTimestamp": "2024-06-24T10:00:00Z"
  }
}
```

**Error Responses:**
- `403` - Not running in operator-managed mode
- `400` - Missing required fields
- `409` - CollectionPipeline with that name already exists
- `500` - Failed to create CR (e.g., Kubernetes API error)

### GET /api/collection-pipeline/list
Lists all CollectionPipeline custom resources in the current namespace.

**Response (200):**
```json
{
  "pipelines": [
    {
      "name": "collection-12345",
      "namespace": "mirror-operator-system",
      "creationTimestamp": "2024-06-24T10:00:00Z",
      "triggerType": "manual",
      "pvc": "collection-4.20-output"
    }
  ]
}
```

**Error Responses:**
- `403` - Not running in operator-managed mode
- `500` - Failed to list CRs

### GET /api/collections/:name/download-url
Generates pre-signed S3 download URLs for collection artifacts.

Reads S3 credentials from the `collection-artifacts` Kubernetes secret and generates temporary download URLs for collection bundle files. URLs expire after 1 hour.

**URL Parameters:**
- `name` - Collection name (required)

**Response (200):**
```json
{
  "collectionName": "collection-12345",
  "expiresIn": 3600,
  "urls": {
    "mirror_seq1_000000.tar": "https://s3.amazonaws.com/bucket/collection-12345/mirror_seq1_000000.tar?X-Amz-Algorithm=...",
    "imageset-config.yaml": "https://s3.amazonaws.com/bucket/collection-12345/imageset-config.yaml?X-Amz-Algorithm=...",
    "imageContentSourcePolicy.yaml": "https://s3.amazonaws.com/bucket/collection-12345/publish/imageContentSourcePolicy.yaml?...",
    "catalogSource.yaml": "https://s3.amazonaws.com/bucket/collection-12345/publish/catalogSource.yaml?...",
    "release-signatures.json": "https://s3.amazonaws.com/bucket/collection-12345/publish/release-signatures.json?..."
  }
}
```

**Error Responses:**
- `403` - Not running in operator-managed mode
- `400` - Collection name is missing
- `404` - Secret not found, or no artifacts found for collection
- `500` - Not running in Kubernetes cluster, or S3 credential error

**Required Kubernetes Secret:**
The endpoint expects a Kubernetes secret (in the current namespace) with the following base64-encoded data fields:
- `AWS_ACCESS_KEY_ID` - S3 access key ID (required)
- `AWS_SECRET_ACCESS_KEY` - S3 secret access key (required)
- `S3_BUCKET` - S3 bucket name (required)
- `AWS_REGION` - AWS region (optional, defaults to `us-east-1`)
- `S3_ENDPOINT` - Custom S3 endpoint URL for S3-compatible storage like MinIO (optional)

**Secret Name Configuration:**
The secret name can be configured via the `S3_SECRET_NAME` environment variable. If not set, defaults to `collection-artifacts`.

Example deployment configuration:
```yaml
env:
  - name: S3_SECRET_NAME
    value: "my-custom-s3-secret"
```

**Artifact Paths:**
The endpoint attempts to generate URLs for the following artifacts (if they exist):
- `{collectionName}/mirror_seq1_000000.tar` - Main mirror archive
- `{collectionName}/imageset-config.yaml` - ImageSet configuration
- `{collectionName}/publish/imageContentSourcePolicy.yaml` - Image content source policy
- `{collectionName}/publish/catalogSource.yaml` - Catalog source definition
- `{collectionName}/publish/release-signatures.json` - Release signatures

**URL Expiration:**
All pre-signed URLs expire after **3600 seconds (1 hour)**. After expiration, new URLs must be generated via another API call.

**Usage Example:**
```bash
# Get download URLs for a collection
curl http://backend:3000/api/collections/collection-12345/download-url

# Download an artifact using the pre-signed URL
curl -o mirror_seq1_000000.tar "https://s3.amazonaws.com/bucket/collection-12345/mirror_seq1_000000.tar?X-Amz-Algorithm=..."
```

---

## SSH

### POST /api/ssh/keypair
Generates an SSH key pair.

**Schema:** `sshKeypairSchema`
```
{
  algorithm?: "ed25519" | "rsa" | "ecdsa" (default: "ed25519")
}
```

---

## AWS

### POST /api/aws/warm-installer
Pre-warms the OpenShift installer binary for a specific version.

**Schema:** `awsWarmInstallerSchema`
```
{
  version?: string (1-100 chars)  // e.g., "4.20.1" (also accepted via query param)
  arch?: string (max 50 chars)    // e.g., "x86_64"
  ...extra fields allowed
}
```

### GET /api/aws/regions
Returns available AWS regions. Query params: `?version=4.20.1&arch=x86_64&force=true`

### GET /api/aws/ami
Returns AWS AMI for a region. Query params: `?version=4.20.1&arch=x86_64&region=us-east-1`

---

## Trust and Proxy

### POST /api/trust/analyze
Analyzes trust configuration (CA bundles, certificates) from wizard state.

**Schema:** `trustAnalyzeSchema`
```
{
  state?: object | null  // Wizard state (falls back to server state if omitted)
  ...extra fields allowed
}
```

---

## Documentation

### GET /api/docs
Returns cached documentation links for the current configuration.

### POST /api/docs/update
Refreshes documentation links. Reads from server state; no body fields used.

**Schema:** `docsUpdateSchema` -- `z.object({}).passthrough()`

---

## Generation and Bundles

### GET /api/generate
Generates YAML configuration files from server state.

### POST /api/generate
Generates YAML configuration files from client-provided state.

**Schema:** `generateSchema` -- `z.object({}).catchall(z.unknown())`
```
{
  state?: object  // Wizard state (falls back to server state if omitted)
  ...any fields allowed
}
```

### POST /api/bundle.prepare
Prepares a bundle download and returns a token.

**Schema:** `bundlePrepareSchema`
```
{
  state?: object | null  // Wizard state (falls back to server state if omitted)
  ...extra fields allowed
}
```

**Response:** `{ "token": "<nanoid>", "expiresAt": "<ISO timestamp>" }`

### GET /api/bundle.zip
Downloads the prepared bundle zip. Query param: `?token=<token>`

### POST /api/bundle.zip
Downloads a bundle zip with state provided in the request body.

**Schema:** `bundleZipSchema`
```
{
  state?: object | null  // Wizard state
  ...extra fields allowed
}
```

---

## Feedback

### GET /api/feedback/config
Returns feedback system configuration.

### GET /api/feedback/challenge
Returns a challenge token for feedback submission (rate limited).

### POST /api/feedback/submit
Submits user feedback (rate limited, challenge-verified).

**Schema:** `feedbackSubmitSchema`
```
{
  category?: string (max 100 chars)
  severity?: string (max 100 chars)
  summary?: string (max 5000 chars)
  details?: string (max 50000 chars)
  contactRequested?: boolean
  contactHandle?: string (max 500 chars)
  challengeToken?: string (max 1024 chars)
  uiContext?: string (max 200 chars)
  honeypot?: string (max 500 chars)
  ...extra fields allowed (e.g., scenarioContext)
}
```

Note: The route handler performs additional validation via `validateFeedbackPayload()` for business logic checks (valid categories, required fields, etc.).

---

## Filesystem

### GET /api/fs/ls
Lists files in a directory. Query param: `?path=/data`

### GET /api/secrets/rh-pull-secret
Returns whether a Red Hat pull secret is available.

### GET /api/secrets/rh-pull-secret/content
Returns the pull secret content.

---

## Schema Validation Coverage

| Route | Schema | Validation Type |
|---|---|---|
| POST /api/state | stateUpdateSchema | Permissive (catchall) |
| POST /api/start-over | startOverSchema | Typed fields |
| POST /api/run/import | runImportSchema | Required state + optional fields |
| POST /api/run/duplicate | runDuplicateSchema | Permissive (passthrough) |
| POST /api/cincinnati/update | cincinnatiUpdateSchema | Permissive (passthrough) |
| POST /api/cincinnati/patches/update | cincinnatiPatchesUpdateSchema | Required channel |
| POST /api/cincinnati/refresh-job | cincinnatiRefreshSchema | Optional nullable strings |
| POST /api/operators/confirm | operatorConfirmSchema | Permissive (passthrough) |
| POST /api/operators/scan | operatorScanSchema | Optional typed fields |
| POST /api/operators/prefetch | operatorsPrefetchSchema | Permissive (passthrough) |
| POST /api/jobs/:id/stop | jobStopSchema | Permissive (passthrough) |
| POST /api/system/path-check | pathCheckSchema | Required path string |
| POST /api/ssh/keypair | sshKeypairSchema | Enum with default |
| POST /api/ocmirror/preflight | ocMirrorPreflightSchema | Rich typed schema |
| POST /api/ocmirror/run | ocMirrorRunSchema | Rich typed schema |
| POST /api/docs/update | docsUpdateSchema | Permissive (passthrough) |
| POST /api/aws/warm-installer | awsWarmInstallerSchema | Optional typed fields |
| POST /api/trust/analyze | trustAnalyzeSchema | Optional nullable state |
| POST /api/generate | generateSchema | Permissive (catchall) |
| POST /api/bundle.prepare | bundlePrepareSchema | Optional nullable state |
| POST /api/bundle.zip | bundleZipSchema | Optional nullable state |
| POST /api/feedback/submit | feedbackSubmitSchema | Max-length constraints |

**Total: 22 POST routes, all validated (100% coverage)**
