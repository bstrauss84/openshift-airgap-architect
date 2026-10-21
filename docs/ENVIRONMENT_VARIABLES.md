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
- **Notes:** Optional provenance shown in Tools → About when supplied, and omitted
  when not. It is **not** used for update checks.

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
- **Description:** GitHub repository whose published Releases are checked for updates, and used for documentation links
- **Example:** `APP_REPO=myorg/my-fork`

### `APP_BRANCH`
- **Type:** String
- **Default:** `"main"`
- **Required:** No
- **Description:** Git branch for documentation links. This is configuration, not
  build provenance (Compose sets it to `main`), so the UI does not present it as the
  build's source branch. It is not used for update checks.
- **Example:** `APP_BRANCH=develop`

### `CHECK_UPDATES`
- **Type:** String (`"true"` | `"false"`)
- **Default:** `"true"`
- **Required:** No
- **Description:** Enable/disable the automatic update check
- **Example:** `CHECK_UPDATES=false`
- **Notes:**
  - When enabled, the backend asks the GitHub **Releases** API for `APP_REPO` and
    compares the newest published, stable release with the installed application
    version from `package.json`. `APP_GIT_SHA` is not needed. Drafts and
    prereleases are never offered, and an older release never produces a downgrade
    prompt. See [docs/UPDATING.md](UPDATING.md#what-the-update-states-mean).
  - `false` or `0` disables the check without any network request. Set it in fully
    disconnected environments.
  - Failure to check is non-blocking and reports `offline`, never "up to date".

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
- **Description:** Path to a Red Hat pull secret JSON file used by oc-mirror operations
- **Example:** `PULL_SECRET_FILE=/opt/secrets/pull-secret.json`
- **Security:** File must be readable by backend process. **The contents are never sent to the browser** — the backend holds them in memory and uses them server-side only.
- **Discovery Fallback (if not set), first match wins:**
  1. `/run/secrets/pull-secret` (Docker/Podman native `--secret` mount)
  2. `<DATA_DIR>/pull-secret.json` (bind-mount into the data directory)
  3. `${HOME}/.openshift/pull-secret` (`oc` CLI default, non-container dev runs)
- **Notes:**
  - Used by `POST /api/ocmirror/preflight` and `POST /api/ocmirror/run` when the request selects `rhAuthSource: "mounted"`
  - **Not** used by operator catalog scans — those authenticate via `REGISTRY_AUTH_FILE`, a separate mechanism
  - Can be overridden by a wizard-provided pull secret in state
  - As of v2.1 the Blueprint pull-secret field is **not** pre-populated from this file, and `GET /api/secrets/rh-pull-secret/content` returns `410 ENDPOINT_WITHDRAWN`. Only `GET /api/secrets/rh-pull-secret` → `{ available: boolean }` is exposed.

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

### `BIND_ADDRESS`
- **Type:** IP address
- **Default:** `127.0.0.1` when `OAA_AUTH_MODE=disabled`, `0.0.0.0` when `OAA_AUTH_MODE=proxy`
- **Required:** No
- **Scope:** Backend
- **Description:** The interface the HTTP server binds. **This is the address
  the server actually binds**, not a hint: it is resolved once in
  `backend/src/accessControl.js` and passed to `listen`. Before the AUTH-01
  correction the server called `app.listen(port)` with no host — which binds
  the unspecified address `::`, every interface — while the startup guard
  checked this variable, so unauthenticated mode passed its own loopback check
  and served the network anyway.
- **Startup refusal:** `OAA_AUTH_MODE=disabled` with a non-loopback value is
  refused unless the container exception below applies. The whole
  `127.0.0.0/8` range counts as loopback.
- **`HOST`** is accepted as an alias, for compatibility.

### `OAA_CONTAINER_NETWORK`
- **Type:** `isolated` (the only accepted value)
- **Default:** unset
- **Required:** Only to bind a non-loopback address in `OAA_AUTH_MODE=disabled`
- **Scope:** Backend
- **Description:** Declares that the bind is confined to a container's own
  network namespace. A published port forwards to the *container's* address
  and never to the container's loopback, so a containerised backend must bind
  a wildcard address for `ports:` to work at all — which is a different fact
  from "the API is exposed on the operator's network".
- **Not a bare flag:** the backend also requires evidence that it really is in
  a container (`/run/.containerenv`, `/.dockerenv`, or a container cgroup) and
  refuses the declaration on a host. That is what stops these lines being
  lifted out of `docker-compose.yml` into a systemd unit.
- **What it cannot do:** a process cannot see how its ports were published, nor
  whether the container shares the host network namespace. `--network=host` or
  publishing on `0.0.0.0` exposes an unauthenticated API regardless. The
  shipped `docker-compose.yml` pins `127.0.0.1:4000:4000`; keep it that way, or
  use `OAA_AUTH_MODE=proxy`.
- **Example:** `BIND_ADDRESS=0.0.0.0` + `OAA_CONTAINER_NETWORK=isolated`

### `OAA_AUTH_MODE`
- **Type:** `disabled` | `proxy`
- **Default:** `disabled`
- **Scope:** Backend
- **Description:** `proxy` requires a proven identity on every `/api` route
  except `/api/health`, `/api/ready`, `/api/metrics`, and requires
  `OAA_PROXY_SHARED_SECRET` (≥32 chars) and `OAA_ALLOWED_ORIGINS`. `disabled`
  is the historical single-user local behaviour. See `docs/API.md` →
  Authentication and the decision record in
  `docs/security/DECISION_RECORD_API_EXPOSURE_AND_TRUST_ANCHORS.md`.

### `OAA_PROXY_SHARED_SECRET` / `OAA_ALLOWED_ORIGINS` / `OAA_OIDC_ISSUER`
- **Scope:** Backend. The shared secret proves a request traversed the
  authenticating proxy; the allowlist replaces wildcard CORS; setting
  `OAA_OIDC_ISSUER` makes the backend exit at startup, because external OIDC
  removes the built-in OAuth server this topology needs.
- **Never committed.** Both secrets are operator-created
  (`manifests/README.md` → "Before you apply"), and no manifest in this
  repository declares them — an empty value in an applied manifest would
  overwrite the live one.

### `OAA_NGINX_LISTEN_ADDRESS`
- **Type:** `127.0.0.1` | `0.0.0.0`
- **Default:** `0.0.0.0`
- **Scope:** Frontend container
- **Description:** The address nginx serves 5173 on. **`127.0.0.1` in the
  authenticated OpenShift overlay**, because oauth-proxy reaches nginx over
  the pod's loopback and nothing else should: that server block forwards the
  caller's identity headers and attaches the backend shared secret, so serving
  it on the pod IP is a complete authentication bypass for any pod that can
  reach the pod. `0.0.0.0` under Compose, where the container boundary plays
  that role.
- **Startup refusal:** rendering fails if `OAA_REQUIRE_PROXY_SECRET` is set and
  this is not loopback.

### `OAA_NGINX_RESOLVER` / `OAA_RESOLV_CONF`
- **Type:** IP address(es) / path
- **Default:** derived from the pod's `/etc/resolv.conf`
- **Scope:** Frontend container
- **Description:** nginx re-resolves the backend Service per request and needs
  a resolver to do it. It is read from `resolv.conf`, which is correct on
  OpenShift (`dns-default` in `openshift-dns`), on vanilla Kubernetes and under
  Compose. The old hard-coded default,
  `kube-dns.kube-system.svc.cluster.local`, is an upstream-Kubernetes name that
  does not exist on OpenShift — and nginx resolves a named resolver through the
  *system* resolver at config load, so it failed the config load rather than
  degrading. Set `OAA_NGINX_RESOLVER` explicitly only if your container has no
  usable `resolv.conf`; rendering fails closed if neither is available.

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
| `BIND_ADDRESS` | 127.0.0.1 (disabled) / 0.0.0.0 (proxy) | No | Backend | Interface the server actually binds |
| `OAA_CONTAINER_NETWORK` | None | Only for a non-loopback bind in `disabled` | Backend | Declares a container network namespace; corroborated, not believed |
| `OAA_AUTH_MODE` | disabled | No | Backend | `proxy` requires identity on every `/api` route |
| `OAA_PROXY_SHARED_SECRET` | None | Yes in `proxy` | Backend + frontend | Proves a request traversed the authenticating proxy |
| `OAA_ALLOWED_ORIGINS` | None | Yes in `proxy` | Backend | Origin allowlist replacing wildcard CORS |
| `OAA_OIDC_ISSUER` | None | No | Backend | If set, startup fails: external OIDC is unsupported here |
| `OAA_NGINX_LISTEN_ADDRESS` | 0.0.0.0 | No | Frontend | `127.0.0.1` in the authenticated overlay |
| `OAA_NGINX_RESOLVER` | (from resolv.conf) | No | Frontend | Override for the /api proxy's DNS resolver |
| `DATA_DIR` | /data | No | Backend | SQLite + job outputs |
| `APP_GIT_SHA` | "unknown" | No | Backend | Optional revision provenance (About page) |
| `APP_BUILD_TIME` | "unknown" | No | Backend | Build timestamp |
| `APP_REPO` | bstrauss84/… | No | Backend | GitHub repo whose Releases are checked |
| `APP_BRANCH` | main | No | Backend | Git branch for docs |
| `CHECK_UPDATES` | true | No | Backend | Enable published-release update checks |
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
- **Check:** `REGISTRY_AUTH_FILE` points to a valid pull secret. Operator scans read
  **only** this variable; a `PULL_SECRET_FILE` mount will not authenticate a scan.
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
