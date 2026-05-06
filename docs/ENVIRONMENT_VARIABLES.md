# Environment Variables Reference

This document catalogs all configurable environment variables for the OpenShift Airgap Architect application.

## Table of Contents

- [Core Application Settings](#core-application-settings)
- [Build and Version Information](#build-and-version-information)
- [Corporate Proxy Configuration](#corporate-proxy-configuration)
- [Cincinnati Integration](#cincinnati-integration)
- [Feedback System](#feedback-system)
- [File Paths and Runtime](#file-paths-and-runtime)
- [Operating Modes](#operating-modes)
- [Security and Rate Limiting](#security-and-rate-limiting)
- [Development and Debugging](#development-and-debugging)

---

## Core Application Settings

### `PORT`
- **Type:** Integer
- **Default:** `4000`
- **Required:** No
- **Description:** HTTP port for the Express backend server
- **Example:** `PORT=8080`
- **Security:** Bind only to `127.0.0.1` in production unless remote access is required

### `DATA_DIR`
- **Type:** Path (absolute)
- **Default:** `/data`
- **Required:** No
- **Description:** Base directory for SQLite database, job outputs, temp files, and exported bundles
- **Example:** `DATA_DIR=/var/app/data`
- **Security:** Must be writable by the backend process (UID 1001 in containers)
- **Notes:**
  - In containers, this is mounted as a volume
  - Contains `state.db` (SQLite), `tmp/` directory, and job output directories
  - Permissions must allow read/write for the application user

---

## Build and Version Information

These variables are typically set during CI/CD builds and displayed in the UI (Tools → About).

### `APP_GIT_SHA`
- **Type:** String
- **Default:** `"unknown"`
- **Required:** No
- **Description:** Git commit SHA of the build
- **Example:** `APP_GIT_SHA=a1b2c3d4e5f6`
- **Notes:** Displayed in About page and used for update checks

### `APP_BUILD_TIME`
- **Type:** ISO 8601 timestamp
- **Default:** `"unknown"`
- **Required:** No
- **Description:** When the build was created
- **Example:** `APP_BUILD_TIME=2026-04-30T12:00:00Z`

### `APP_REPO`
- **Type:** String (GitHub repository)
- **Default:** `"bstrauss84/openshift-airgap-architect"`
- **Required:** No
- **Description:** GitHub repository for update checks and documentation links
- **Example:** `APP_REPO=myorg/my-fork`

### `APP_BRANCH`
- **Type:** String
- **Default:** `"main"`
- **Required:** No
- **Description:** Git branch for documentation links
- **Example:** `APP_BRANCH=develop`

### `CHECK_UPDATES`
- **Type:** String (`"true"` | `"false"`)
- **Default:** `"true"` (enabled when `APP_GIT_SHA` is set)
- **Required:** No
- **Description:** Enable/disable automatic update checks against GitHub releases
- **Example:** `CHECK_UPDATES=false`
- **Notes:**
  - When enabled, fetches latest release tag from GitHub API
  - Set to `false` in fully disconnected environments
  - Failure to check is non-blocking (warning only)

---

## Corporate Proxy Configuration

Standard proxy variables used by Node.js `fetch`, `curl`, and Go-based tools (`oc`, `oc-mirror`).

### `HTTP_PROXY`
- **Type:** URL
- **Default:** None (direct connection)
- **Required:** No
- **Description:** HTTP proxy for outbound connections
- **Example:** `HTTP_PROXY=http://proxy.corp.example:8080`
- **Notes:**
  - Applies to backend container egress only (not wizard Trust/Proxy fields)
  - Used by Cincinnati, tool downloads, operator scans, oc-mirror runs

### `HTTPS_PROXY`
- **Type:** URL
- **Default:** None (direct connection)
- **Required:** No
- **Description:** HTTPS proxy for outbound connections
- **Example:** `HTTPS_PROXY=http://proxy.corp.example:8080`
- **Notes:** Same scope as `HTTP_PROXY`; both are typically set together

### `NO_PROXY`
- **Type:** Comma-separated list of hosts/domains
- **Default:** None
- **Required:** No
- **Description:** Bypass proxy for these destinations
- **Example:** `NO_PROXY=localhost,127.0.0.1,.svc.cluster.local,.internal`
- **Notes:** Use for internal registries, local services, cluster domains

### `TRUSTED_PROXIES`
- **Type:** Comma-separated list of IP addresses
- **Default:** None (empty)
- **Required:** No
- **Description:** IP addresses of trusted reverse proxies for rate limiting
- **Example:** `TRUSTED_PROXIES=10.0.0.1,10.0.0.2`
- **Security:** Only trust X-Forwarded-For headers from these IPs
- **Notes:**
  - Used for accurate client IP detection in rate limiting
  - Leave empty if app is not behind a reverse proxy
  - Critical for preventing rate limit bypass via spoofed headers

### `AIRGAP_FETCH_USE_ENV_PROXY`
- **Type:** String (`"true"` | `"false"` | `"0"`)
- **Default:** `"true"` (uses HTTP_PROXY/HTTPS_PROXY)
- **Required:** No
- **Description:** Control whether backend fetch uses environment proxy variables
- **Example:** `AIRGAP_FETCH_USE_ENV_PROXY=false`
- **Notes:**
  - Set to `"false"` or `"0"` to disable proxy usage for backend HTTP requests
  - Affects Cincinnati, tool downloads, but NOT spawned processes (oc-mirror)

---

## Cincinnati Integration

### `CINCINNATI_FETCH_TIMEOUT_MS`
- **Type:** Integer (milliseconds)
- **Default:** `45000` (45 seconds)
- **Min:** `5000` (5 seconds)
- **Max:** `120000` (120 seconds)
- **Required:** No
- **Description:** Timeout for GitHub API calls to fetch Cincinnati channel/patch data
- **Example:** `CINCINNATI_FETCH_TIMEOUT_MS=30000`
- **Notes:**
  - Prevents indefinite hangs behind misconfigured proxies
  - Increase if you see frequent timeout errors in slow networks
  - Decrease for faster failure detection in fully disconnected setups

---

## Feedback System

The feedback system allows users to submit issues/suggestions. All feedback variables are optional.

### `FEEDBACK_MODE`
- **Type:** String (`"github"` | `"offline"` | `"disabled"`)
- **Default:** `"github"`
- **Required:** No
- **Description:** Feedback submission mode
- **Values:**
  - `"github"`: Validate input and return pre-filled GitHub issue URL (user's browser opens it)
  - `"offline"`: Return JSON export only; no GitHub integration
  - `"disabled"`: Hide feedback UI entirely
- **Example:** `FEEDBACK_MODE=offline`

### `FEEDBACK_GITHUB_REPO`
- **Type:** String (GitHub repository)
- **Default:** `APP_REPO` value
- **Required:** No
- **Description:** Target repository for GitHub issue links
- **Example:** `FEEDBACK_GITHUB_REPO=myorg/feedback-repo`

### Rate Limiting

#### `FEEDBACK_RATE_LIMIT_WINDOW_MS`
- **Type:** Integer (milliseconds)
- **Default:** `900000` (15 minutes)
- **Required:** No
- **Description:** Time window for rate limiting feedback submissions

#### `FEEDBACK_RATE_LIMIT_MAX`
- **Type:** Integer
- **Default:** `5`
- **Required:** No
- **Description:** Maximum feedback submissions per client IP in the rate limit window

#### `FEEDBACK_BURST_WINDOW_MS`
- **Type:** Integer (milliseconds)
- **Default:** `60000` (1 minute)
- **Required:** No
- **Description:** Time window for burst rate limiting

#### `FEEDBACK_BURST_MAX`
- **Type:** Integer
- **Default:** `2`
- **Required:** No
- **Description:** Maximum feedback submissions per client IP in the burst window

**Example:**
```bash
FEEDBACK_RATE_LIMIT_WINDOW_MS=600000  # 10 minutes
FEEDBACK_RATE_LIMIT_MAX=3              # 3 per 10 minutes
FEEDBACK_BURST_WINDOW_MS=30000         # 30 seconds
FEEDBACK_BURST_MAX=1                   # 1 per 30 seconds
```

### Challenge (CAPTCHA-like) Rate Limiting

#### `FEEDBACK_CHALLENGE_WINDOW_MS`
- **Type:** Integer (milliseconds)
- **Default:** `60000` (1 minute)
- **Required:** No
- **Description:** Time window for challenge verification attempts

#### `FEEDBACK_CHALLENGE_MAX`
- **Type:** Integer
- **Default:** `20`
- **Required:** No
- **Description:** Maximum challenge verification attempts per IP in the window

#### `FEEDBACK_CHALLENGE_TTL_MS`
- **Type:** Integer (milliseconds)
- **Default:** `300000` (5 minutes)
- **Required:** No
- **Description:** How long a challenge token remains valid

#### `FEEDBACK_CHALLENGE_SECRET`
- **Type:** String (random secret)
- **Default:** Auto-generated random string on startup
- **Required:** No
- **Description:** Secret key for signing challenge tokens
- **Security:** Set to a persistent value for multi-instance deployments
- **Example:** `FEEDBACK_CHALLENGE_SECRET=$(openssl rand -hex 32)`
- **Notes:** If not set, tokens become invalid on server restart

### Content Limits

#### `FEEDBACK_MAX_SUMMARY_CHARS`
- **Type:** Integer
- **Default:** `200`
- **Required:** No
- **Description:** Maximum characters in feedback summary field

#### `FEEDBACK_MAX_DETAILS_CHARS`
- **Type:** Integer
- **Default:** `5000`
- **Required:** No
- **Description:** Maximum characters in feedback details field

#### `FEEDBACK_MAX_CONTACT_CHARS`
- **Type:** Integer
- **Default:** `200`
- **Required:** No
- **Description:** Maximum characters in feedback contact field

#### `FEEDBACK_MAX_PAYLOAD_BYTES`
- **Type:** Integer
- **Default:** `100000` (100 KB)
- **Required:** No
- **Description:** Maximum total size of feedback JSON payload
- **Security:** Prevents DoS via oversized submissions

### `FEEDBACK_MIN_DWELL_MS`
- **Type:** Integer (milliseconds)
- **Default:** `2000` (2 seconds)
- **Required:** No
- **Description:** Minimum time user must spend on feedback form before submission
- **Security:** Bot detection - rejects instant submissions

---

## File Paths and Runtime

### `PULL_SECRET_FILE`
- **Type:** Path (absolute)
- **Default:** None (uses discovery fallback)
- **Required:** No
- **Description:** Path to Red Hat pull secret JSON file for operator scans and oc-mirror
- **Example:** `PULL_SECRET_FILE=/opt/secrets/pull-secret.json`
- **Security:** File must be readable by backend process
- **Discovery Fallback (if not set):**
  1. `${HOME}/.openshift/pull-secret`
  2. `/run/secrets/pull-secret` (Kubernetes secret mount)
- **Notes:**
  - Required for operator scan and oc-mirror operations
  - Can be overridden by wizard-provided pull secret in state

### `REGISTRY_AUTH_FILE`
- **Type:** Path (absolute)
- **Default:** Generated dynamically for oc-mirror runs
- **Required:** No
- **Description:** Path to Docker/Podman auth config for oc-mirror registry operations
- **Example:** `REGISTRY_AUTH_FILE=/opt/auth/config.json`
- **Notes:**
  - Backend generates temporary auth files for oc-mirror runs
  - Permanent file can be provided for operator scans
  - Format: Docker registry auth JSON (same as `pull-secret.json` structure)

### `OC_MIRROR_BIN`
- **Type:** Path (absolute)
- **Default:** Auto-detected from PATH or bundled binary
- **Required:** No
- **Description:** Explicit path to oc-mirror binary
- **Example:** `OC_MIRROR_BIN=/usr/local/bin/oc-mirror`
- **Notes:**
  - Backend auto-detects from: environment PATH, `/usr/local/bin`, bundled in container
  - Override for custom oc-mirror versions or non-standard locations

### `OC_MIRROR_URL`
- **Type:** URL
- **Default:** `https://mirror.openshift.com/pub/openshift-v4/clients/ocp-dev-preview/latest/oc-mirror.tar.gz`
- **Required:** No
- **Description:** Download URL for oc-mirror tarball (used during container image build)
- **Example:** `OC_MIRROR_URL=https://internal-mirror.corp/tools/oc-mirror.tar.gz`
- **Notes:**
  - Used as build-arg in Containerfile
  - Disconnected builds should point to internal mirror

### `HOME`
- **Type:** Path (absolute)
- **Default:** `/root` or user's home directory
- **Required:** No (system-provided)
- **Description:** User home directory for pull secret discovery
- **Notes:** Used in pull secret fallback path `${HOME}/.openshift/pull-secret`

### `PATH`
- **Type:** Colon-separated paths
- **Default:** System default
- **Required:** No (system-provided)
- **Description:** Executable search path for spawned processes
- **Notes:** Used to locate `oc-mirror`, `oc`, `openshift-install` binaries

---

## Operating Modes

### `MOCK_MODE`
- **Type:** String (`"true"` | anything else)
- **Default:** `"false"` (off)
- **Required:** No
- **Description:** Use bundled Cincinnati mock data instead of GitHub API
- **Example:** `MOCK_MODE=true`
- **Use Cases:**
  - Fully disconnected demonstrations
  - Testing without GitHub access
  - Development without network
- **Limitations:**
  - Mock data may be outdated (4.15, 4.16 channels in current bundle)
  - Operator catalog and oc-mirror still require registry access

### `AIRGAP_OPERATING_MODE`
- **Type:** String
- **Default:** None
- **Required:** No
- **Description:** Reserved for future airgap mode variations
- **Notes:** Currently unused; placeholder for potential high-side/low-side workflow modes

### `AIRGAP_RUNTIME_SIDE`
- **Type:** String
- **Default:** None
- **Required:** No
- **Description:** Reserved for high-side/low-side deployment tracking
- **Notes:** Currently unused; placeholder for future disconnected workflow features

---

## Security and Rate Limiting

### `NODE_EXTRA_CA_CERTS`
- **Type:** Path (absolute)
- **Default:** None
- **Required:** No (Node.js standard)
- **Description:** Path to additional CA certificates for TLS validation
- **Example:** `NODE_EXTRA_CA_CERTS=/etc/ssl/certs/corporate-ca-bundle.pem`
- **Use Cases:**
  - Corporate TLS-intercepting proxies
  - Internal registries with self-signed certificates
  - Private mirror hosts
- **Security:** Only add trusted corporate CA certificates

---

## Development and Debugging

### `NODE_ENV`
- **Type:** String (`"production"` | `"development"` | `"test"`)
- **Default:** `"production"` in containers, `"development"` in local npm start
- **Required:** No (Node.js standard)
- **Description:** Node.js environment mode
- **Notes:**
  - `"test"`: Disables server startup, warm-up tasks
  - `"development"`: More verbose logging
  - `"production"`: Optimized for performance

### `DEBUG`
- **Type:** String (`"true"` | anything else)
- **Default:** `"false"` (off)
- **Required:** No
- **Description:** Enable verbose debug logging to console
- **Example:** `DEBUG=true`
- **Logging Output:**
  - Cincinnati cache warm failures
  - Pull secret discovery errors
  - Path permission check failures
  - Temp file cleanup errors
  - Job termination errors
- **Security:** Do NOT enable in production (may leak sensitive paths)

---

## Frontend-Specific Variables

These are set on the **frontend** container/service, not the backend.

### `VITE_API_BASE`
- **Type:** URL
- **Default:** `http://localhost:4000`
- **Required:** No
- **Description:** Base URL for backend API calls from the browser
- **Example:** `VITE_API_BASE=http://192.168.1.100:4000`
- **Notes:**
  - **Same-host access:** Leave as `localhost:4000` when UI and browser are on the same machine
  - **Remote access:** Set to backend's IP/hostname reachable from the client browser
  - Must be set **before** `npm run dev` or image build (baked into frontend JS)
- **Security:** Use HTTPS in production deployments

### `VITE_ALLOWED_HOSTS`
- **Type:** Comma-separated list of hosts
- **Default:** `localhost`
- **Required:** No
- **Description:** Allowed hostnames for Vite dev server connections
- **Example:** `VITE_ALLOWED_HOSTS=localhost,devserver.corp.example,192.168.1.100`
- **Notes:**
  - Prevents Host header mismatch errors
  - Add all hostnames/IPs that will access the UI
  - In containers, set via docker-compose or Kubernetes env

---

## Summary Table

| Variable | Default | Required | Scope | Purpose |
|----------|---------|----------|-------|---------|
| `PORT` | 4000 | No | Backend | HTTP server port |
| `DATA_DIR` | /data | No | Backend | SQLite + job outputs |
| `APP_GIT_SHA` | "unknown" | No | Backend | Build version (About page) |
| `APP_BUILD_TIME` | "unknown" | No | Backend | Build timestamp |
| `APP_REPO` | bstrauss84/… | No | Backend | GitHub repo for updates |
| `APP_BRANCH` | main | No | Backend | Git branch for docs |
| `CHECK_UPDATES` | true | No | Backend | Enable update checks |
| `HTTP_PROXY` | None | No | Backend | HTTP proxy URL |
| `HTTPS_PROXY` | None | No | Backend | HTTPS proxy URL |
| `NO_PROXY` | None | No | Backend | Proxy bypass list |
| `TRUSTED_PROXIES` | None | No | Backend | Reverse proxy IPs |
| `AIRGAP_FETCH_USE_ENV_PROXY` | true | No | Backend | Use env proxy for fetch |
| `CINCINNATI_FETCH_TIMEOUT_MS` | 45000 | No | Backend | API timeout (ms) |
| `MOCK_MODE` | false | No | Backend | Use bundled Cincinnati data |
| `FEEDBACK_MODE` | github | No | Backend | Feedback mode |
| `FEEDBACK_RATE_LIMIT_MAX` | 5 | No | Backend | Max per window |
| `FEEDBACK_BURST_MAX` | 2 | No | Backend | Max per burst |
| `PULL_SECRET_FILE` | (discovered) | No | Backend | RH pull secret path |
| `REGISTRY_AUTH_FILE` | (temp) | No | Backend | Registry auth config |
| `OC_MIRROR_BIN` | (auto) | No | Backend | oc-mirror binary path |
| `DEBUG` | false | No | Backend | Verbose logging |
| `NODE_ENV` | production | No | Both | Node environment |
| `VITE_API_BASE` | http://localhost:4000 | No | Frontend | Backend API URL |
| `VITE_ALLOWED_HOSTS` | localhost | No | Frontend | Vite dev allowed hosts |

---

## Common Configuration Examples

### Production Deployment (Docker Compose)

```yaml
services:
  backend:
    environment:
      - DATA_DIR=/data
      - PORT=4000
      - APP_GIT_SHA=${GIT_SHA}
      - APP_BUILD_TIME=${BUILD_TIME}
      - CHECK_UPDATES=false  # Disconnected
      - MOCK_MODE=false
      - FEEDBACK_MODE=offline
      - DEBUG=false
      - NODE_ENV=production
  
  frontend:
    environment:
      - VITE_API_BASE=http://192.168.1.100:4000
      - VITE_ALLOWED_HOSTS=localhost,192.168.1.100,airgap.corp.example
```

### Corporate Proxy Environment

```yaml
services:
  backend:
    environment:
      - HTTP_PROXY=http://proxy.corp.example:8080
      - HTTPS_PROXY=http://proxy.corp.example:8080
      - NO_PROXY=localhost,127.0.0.1,.corp.example,.cluster.local
      - TRUSTED_PROXIES=10.0.1.10,10.0.1.11
      - NODE_EXTRA_CA_CERTS=/etc/ssl/certs/corporate-ca.pem
    volumes:
      - /etc/pki/ca-trust/corporate-ca.pem:/etc/ssl/certs/corporate-ca.pem:ro
```

### Development Setup

```yaml
services:
  backend:
    environment:
      - DEBUG=true
      - NODE_ENV=development
      - MOCK_MODE=true  # Use bundled Cincinnati data
      - FEEDBACK_MODE=offline
      - CHECK_UPDATES=true
  
  frontend:
    environment:
      - VITE_API_BASE=http://localhost:4000
```

### Fully Disconnected (High-Side)

```yaml
services:
  backend:
    environment:
      - MOCK_MODE=true
      - CHECK_UPDATES=false
      - FEEDBACK_MODE=disabled
      - AIRGAP_FETCH_USE_ENV_PROXY=false
      - PULL_SECRET_FILE=/opt/secrets/pull-secret.json
    volumes:
      - ./pull-secret.json:/opt/secrets/pull-secret.json:ro
```

---

## Troubleshooting

### Cincinnati fails to load channels
- **Check:** `CINCINNATI_FETCH_TIMEOUT_MS` might be too low
- **Check:** `HTTP_PROXY`/`HTTPS_PROXY` configuration
- **Check:** Firewall allows `api.github.com`, `raw.githubusercontent.com`
- **Workaround:** Set `MOCK_MODE=true` for offline demo

### Rate limiting incorrectly blocking users
- **Check:** `TRUSTED_PROXIES` is set correctly if behind reverse proxy
- **Issue:** Without `TRUSTED_PROXIES`, all clients appear as proxy IP
- **Fix:** Add reverse proxy IPs to `TRUSTED_PROXIES`

### Operator scan fails with auth errors
- **Check:** `PULL_SECRET_FILE` points to valid pull secret
- **Check:** File is readable by UID 1001 (backend user in containers)
- **Check:** Pull secret contains `registry.redhat.io` and `quay.io` auth

### Backend can't reach registries through proxy
- **Check:** `HTTP_PROXY`/`HTTPS_PROXY` are set on **backend** service
- **Check:** `NO_PROXY` doesn't block required registry domains
- **Check:** `NODE_EXTRA_CA_CERTS` for TLS-intercepting proxies

### Update checks fail
- **Check:** `CHECK_UPDATES` is not explicitly set to `false`
- **Check:** `APP_GIT_SHA` is set (enables the check)
- **Check:** GitHub access allowed (`api.github.com`)
- **Workaround:** Set `CHECK_UPDATES=false` to disable

---

## See Also

- [README.md](../README.md) - Corporate proxy and container setup
- [API.md](API.md) - Backend API endpoint reference
- [ARCHITECTURE.md](ARCHITECTURE.md) - System architecture and data flow
