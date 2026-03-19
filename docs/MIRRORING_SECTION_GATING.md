# Connectivity & Mirroring — UI and install-config gating (current code)

This documents **what the code does today**. It is **not** a scenario-by-scenario proof against every 4.20 disconnected-install page; a fuller doc audit remains **open**.

## Rule (frontend + backend aligned)

**`useMirrorPath`** is true when **either**:

1. `credentials.usingMirrorRegistry` is true (user explicitly chose the mirror-registry path), **or**
2. The Red Hat pull-secret placeholder is **empty or only** `{"auths":{}}` **and** the mirror-registry pull secret JSON is **non-empty** and not `{"auths":{}}`.

Source:

- `frontend/src/steps/ConnectivityMirroringStep.jsx` — `useMirrorPath`, `showMirroringConfig`
- `backend/src/generate.js` — `useMirrorPath` when building `install-config` pull secret and `imageDigestSources`
- `backend/src/generate.js` — same predicate for FIELD_MANUAL / runbook mirror registry lines (`useMirrorPathForManual`)

**`imageDigestSources`** are emitted only when `useMirrorPath` is true **and** there is at least one mirroring source with mirrors configured (`mirror.sources` mapped to `imageDigestSources`).

## Registry FQDN carry-over

When the mirror pull secret contains **exactly one** `auths` key, the UI may derive `globalStrategy.mirroring.registryFqdn` and rewrite mirror lines that used the previous default FQDN. See `deriveRegistryFqdnFromPullSecret` in `ConnectivityMirroringStep.jsx`.

## Status

| Aspect | Status |
|--------|--------|
| Frontend ↔ backend predicate match | Implemented (keep in sync on change) |
| Per-scenario disconnected doc proof for this heuristic | **Not** fully audited; treat as **current product behavior** |
