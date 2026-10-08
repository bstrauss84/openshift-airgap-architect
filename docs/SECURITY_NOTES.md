# Security notes

## Do not commit secrets

The following must **never** be committed to the repo:

- **Pull secrets** (e.g. `pull-secret`, `pull-secret.json`)
- **Registry auth** (`auth.json`, `registry-auth.json`)
- **Kubeconfigs** (e.g. `kubeconfig`, `*.kubeconfig`)
- **Environment files** with secrets (`.env` with real credentials; `.env.example` is allowed)
- **Keys and certs** (e.g. `.pem`, private keys under `secrets/` or `.secrets/`)

They are listed in `.gitignore`. If you need to use them locally, keep them outside the repo or in ignored paths.

## How we reduce risk

1. **`.gitignore`** — Patterns for pull-secret, auth.json, kubeconfig, `.env`, and key/cert paths so they are not tracked.
2. **Pre-commit (optional)** — `scripts/check-secrets.sh` runs **gitleaks** when installed. Install [gitleaks](https://github.com/gitleaks/gitleaks#installation) and run `./scripts/check-secrets.sh` before committing, or use `pre-commit install` (see `docs/CONTRIBUTING.md`). For a **full-history** scan (recommended before public release), run `gitleaks detect --source . --verbose` from repo root (CI does this with `fetch-depth: 0`).
3. **CI** — Every push/PR runs the **gitleaks** action on the repo (including history) to detect leaked secrets.

## Tranche Security Gate (durable requirement)

> **No commit may be recommended for an implementation tranche until
> `./scripts/security/tranche-security-gate.sh` reports `OVERALL: GREEN`.**

The gate is fail-closed and covers both repository/supply-chain exposure (secret scans
of worktree, index and reachable history; sensitive-file hygiene; production dependency
severity policy) and runtime credential lifecycle (synthetic canaries across persistence,
logs, errors, previews and the default export). A clean `gitleaks` run alone is not
sufficient and never has been.

`scripts/security/gitleaks-selftest.sh` runs first inside the gate, because a gitleaks
config that loads no rules passes every scan vacuously — which is exactly the state this
repository was in until 2026-10-07.

## If a secret was committed

1. Rotate or revoke the exposed secret immediately.
2. Do not rely only on removing it in a later commit — it remains in history.
3. Prefer rotating credentials and, if necessary, rewriting history (e.g. `git filter-repo` or support from your Git host) to remove the secret from history.

Rewriting history is not always the right answer, and it is never a substitute for
rotation. Once a repository has been public, forks and existing clones hold independent
copies that no upstream rewrite can recall. See the section below.

## Scan baselines for resolved historical findings

A historical repository security finding identified during tranche certification has
been resolved. The affected credential is no longer valid, and the current source tree
no longer contains the artifact. Detailed incident evidence is retained outside this
repository.

Secret scanning stays fail-closed. A resolved and independently verified historical
finding may be represented by an **opaque scan baseline**
(`scripts/security/history-scan-baseline.json`). The scanner still detects the
underlying finding; the reconciliation layer
(`scripts/security/historyScanBaseline.mjs`) accepts only the exact registered
identity. Any new, changed, additional or unregistered finding fails the gate.

This is deliberately **not** a scanner allowlist. An allowlist suppresses detection, and
once a finding is invisible you can no longer tell that the historical content changed,
that something new appeared beside it, or that a fresh finding was added.

### What the baseline contains

Digests only. Every value is a SHA-256 of something that must be independently
re-derived from the scan at verification time, so the file carries no path, commit,
detector name or other descriptive metadata, and it cannot be widened by editing a
string.

| Check | Enforced by |
|---|---|
| Finding identity | SHA-256 over detector + path + normalized fingerprint, re-derived per finding |
| Occurrence count | per-identity and per-entry totals, compared in both directions |
| Historical content | the referenced object is re-read and its SHA-256 compared to the registered content identity |
| Status | must be `verified-inactive`; anything else keeps the findings blocking |
| Evidence | a resolved status requires a recognised evidence class and an evidence digest |

Failing any of these is RED, including: an unregistered finding; a changed path,
detector or fingerprint; changed historical content; a *new* occurrence of already-known
content; count drift in either direction; a registered identity that disappears (the
baseline has gone stale and must be reconciled deliberately); a malformed or missing
baseline; or content that cannot be resolved.

### Output and artifacts

For an exact match the gate reports only `resolved baseline matched; unexpected=0`. It
does not print paths, detectors, fingerprints, commits or digests, because restating
them would republish what the baseline covers. Unexpected findings are different: those
still emit the usual safe diagnostic metadata so they can be investigated.

Raw scanner reports are written to a temporary directory outside the repository. They
are never committed and are never uploaded as a CI artifact.

### Current-tree guard

Because resolved history is retained rather than rewritten, the current tree is the
boundary that matters. A content-aware guard fails the gate if tracked source carries a
credential-bearing cluster-import manifest, or an embedded kubeconfig with a real bearer
token or private key. Ordinary credential-free `kind: Secret` templates are explicitly
allowed — the guard requires *decodable credential material*, not merely the presence of
a Secret.

Behaviour is pinned by synthetic fixtures in
`backend/test/history-scan-baseline.test.js`.

## Application behavior

Every claim in this section is backed by an automated test. Where a claim is narrower
than it used to be, that is because a test proved the stronger wording was not true.

| Claim | Proven by |
|---|---|
| Credentials are not persisted to the backend SQLite store | `backend/test/credential-canary-surfaces.test.js` — searches the raw `.db`, `-wal` and `-shm` **bytes** for per-class synthetic canaries |
| `POST /api/state` refuses a payload containing a `credentials` block | same file — asserts HTTP 400 and that the rejection body does not echo what it rejected |
| Credentials are not persisted to browser storage | `frontend/tests/credential-canary-browser-storage.test.js` — localStorage, sessionStorage, IndexedDB |
| Credentials do not appear in HTTP error bodies, thrown messages or stacks | `backend/test/credential-canary-surfaces.test.js` error-path suite |
| Credentials are not left in temp/cache files after an operation | same file |
| The **default** downloadable bundle excludes pull secrets, platform credentials, BMC credentials **and proxy credentials** | same file, pinned per credential class, with the opt-in path tested separately |

- **Credential persistence.** Architect does **not** persist pull secrets, platform
  credentials (vSphere, AWS, Azure, IBM Cloud, Nutanix), BMC credentials or SSH private
  keys — neither in the backend store nor in browser storage. Both boundaries apply the
  **same** list, `shared/stateSanitizer.js`, so they cannot drift apart.

  *Corrected 2026-10-07:* the browser-side strip previously covered only the pull secrets
  and vSphere, so other platform secrets did reach `localStorage` even though the server
  refused to store them. Found by runtime credential canaries during the Tranche 1.5
  security gate and fixed by routing both boundaries through one list.

- **Non-secret identifiers are retained deliberately.** Usernames and client IDs (for
  example a mirror-registry username, an Azure `clientId`) are **not** stripped: they
  authenticate nothing on their own and keeping them makes a reloaded session usable.
  The retained set is pinned by a test so it cannot grow unnoticed.

- **Pull-secret retention.** On Blueprint lock the user may choose “Retain pull secret
  for use on subsequent pages.” Architect does not persist your pull secret in
  application storage. It remains transient in application memory for the session unless
  you explicitly choose to include credentials in a downloaded artifact. The backend
  receives it only when you initiate generate/export and have opted in, or for a
  user-initiated operator scan at lock.

- **Proxy credentials follow the same opt-in rule as every other credential.** A proxy
  URL may embed `user:password`. That userinfo is treated as a credential: generated
  `install-config.yaml` and the Field Guide carry the proxy **endpoint** (scheme, host,
  port, `noProxy`) but the credentials are removed unless you explicitly opt into
  credential inclusion.

  *Corrected 2026-10-07:* proxy was previously the only credential class that ignored the
  inclusion setting, so a default export carried the proxy password. Found by the
  Tranche 1.5 credential canaries. The earlier wording in this file, which described the
  leak as "by design", was wrong on both counts — it was neither intended nor consistent
  with the other five credential classes.

- **Explicit credential-inclusive export is a separate, opt-in path.** When you enable a
  per-class inclusion toggle, the credential is intentionally written into the downloaded
  artifact. That is deliberate user-selected inclusion, not a persistence leak, and it is
  tested separately from the default path.

## Feedback mechanism (DOC-041)

- Recipient identity/contact details for feedback must never appear in tracked frontend code, tracked docs, or client payloads.
- Feedback uses GitHub issue drafts (prefilled URL + markdown fallback) and does not require hosted relay/email services.
- Feedback payloads are validated and rate-limited, with anti-bot controls (challenge token + honeypot).
- High-side/disconnected profiles hide and disable feedback submission paths.
- Feedback text is never written to logs; only metadata such as submission ID, mode, and status may be logged.
