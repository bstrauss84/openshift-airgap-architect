# Scenario Onboarding Checklist

Use this checklist for every new platform/method/version scenario before opening a PR.

## 1) Canonical doc sweep (required)

- Use `docs.redhat.com` only for OCP docs.
- Collect the full scenario family:
  - parent/install-method page
  - restricted/disconnected page
  - install-config parameter chapter/table page
  - sample YAML sections
  - IAM/credentials and proxy/trust sections
- Always review **expanded content**:
  - `Expand`, `Show more`, hidden parameter rows, and notes under tables
  - html-single pages are required for cross-checking hidden table content

## 2) Parameter extraction ledger (required)

- Build a ledger of all parameters mentioned in:
  - parameter tables
  - prose caveats
  - sample YAML snippets
- For each parameter, mark:
  - required/optional
  - supported values/defaults
  - scenario applicability
  - conflicts or ambiguity

## 3) Conflict handling rules (required)

- If docs conflict (table vs example vs prose):
  - record the exact conflict in the ledger
  - do **not** implement the ambiguous parameter until conflict is called out in PR notes
  - gate parameter as unsupported/blocked if needed

## 4) Coverage matrix (required)

For every parameter in scope, map to one of:

- `UI-exposed` (explicit control)
- `derived` (deterministic from existing inputs)
- `intentionally unsupported` (must include rationale)

Then verify coverage across all layers:

- canonical params file (`data/params/<version>/<scenario>.json`)
- frontend catalog copy (`frontend/src/data/catalogs/<scenario>.json`)
- UI/form placement in the correct tab
- validation behavior (requiredness, allowed values, conditional logic)
- backend emission (`install-config.yaml` and related outputs)
- docs-index links and field-guide references

Silent omission is not allowed.

## 5) Networking and dual-stack gate check (required)

- Validate network supportability from platform docs:
  - IPv4-only / dual-stack / IPv6 support
- Ensure scenario gating is consistent across:
  - networking UI fields
  - validation errors/warnings
  - backend YAML emission
- If scenario is IPv4-only, block IPv6 fields and prevent IPv6 emission.

## 6) Security and credentials check (required)

- Confirm sensitive fields are never exported by default.
- Confirm include/exclude credential toggles are respected.
- Confirm password/API key inputs use non-persistent safe patterns.

## 7) Test requirements (required)

- Add tests for:
  - scenario ID and method gating
  - required parameter validation
  - networking supportability rules
  - backend YAML emission and omission rules
  - docs-index/catalog resolver wiring
- Re-run:
  - `node scripts/validate-docs-index.js`
  - `node scripts/validate-catalog.js`
  - frontend targeted tests
  - backend tests

## 8) PR checklist (required)

- Include a gap summary vs previous state.
- Include explicit list of parameters added, gated, derived, or intentionally unsupported.
- Include doc links used for disputed or risky areas.
