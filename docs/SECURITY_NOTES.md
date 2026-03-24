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

## If a secret was committed

1. Rotate or revoke the exposed secret immediately.
2. Do not rely only on removing it in a later commit — it remains in history.
3. Prefer rotating credentials and, if necessary, rewriting history (e.g. `git filter-repo` or support from your Git host) to remove the secret from history.

## Application behavior

- The app does **not** store or export credentials by default; generators are user-initiated and avoid persistence/logging of secrets (see `.cursor/rules/core-guidelines.mdc`).
- **Pull-secret retention:** On Blueprint lock, the user can choose “Retain pull secret for use on subsequent pages.” When retained, the value stays in memory only for the session; it is never persisted (frontend `getStateForPersistence` and backend state/export strip it). Backend receives credentials only when the user initiates generate/export and has opted in, or operator scan at lock (user-initiated).

## Feedback mechanism (DOC-041)

- Recipient identity/contact details for feedback must never appear in tracked frontend code, tracked docs, or client payloads.
- Feedback transport destinations are configured server-side only using environment variables or deployment secrets.
- Feedback payloads are validated and rate-limited, with anti-bot controls (challenge token + honeypot).
- Online feedback modes fail closed unless required runtime config is present (including explicit challenge signing secret).
- Feedback text is never written to logs; only metadata such as submission ID, mode, and status may be logged.
- High-side/disconnected mode must disable and hide feedback submission paths when that runtime mode is active.
