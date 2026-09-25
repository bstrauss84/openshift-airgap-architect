# Migration Guide: v1.x to v2.0.0

This guide covers what changes when upgrading from OpenShift Airgap Architect v1.x to v2.0.0.

## Supported OpenShift Versions

v2.0.0 supports exactly **OpenShift 4.20** (baseline) and **4.21** (current).

- OpenShift 4.22 and later are **unsupported** and deterministically rejected at every boundary (UI, API, generation, Field Guide). There is no silent fallback to a supported version.
- OpenShift versions before 4.20 are not supported.

## State Schema Migration (Automatic)

v2.0.0 uses state schema **v3**, which introduces a canonical `version` object for version-lock state management. The migration is automatic and transparent:

| From | To | Trigger | User Action Required |
|------|----|---------|---------------------|
| v1 (no `version` object) | v3 | Import, hydration, or API call | None |
| v2 (partial `version` object) | v3 | Import, hydration, or API call | None |
| v3 | v3 | No-op | None |

Migration happens at all state boundaries: backend import/export, backend generation, frontend hydration, and frontend API calls.

### What changes in the state

- `release.channel` (e.g., `"stable-4.20"`) is normalized to `version.selectedMinor` (e.g., `"4.20"`)
- `release.confirmed` and `version.versionConfirmed` are canonicalized to `version.locked`
- A `version._schemaVersion: 3` marker is added
- The `release` object is kept in sync for backward compatibility but `version` is canonical

### Malformed state handling

States with unrecognizable channel formats or unknown schema versions are blocked with an error. The system never silently falls back to a default version.

## JSON Run Export/Import

v1.x JSON run exports are automatically migrated to v3 schema on import. The import process:

1. Validates the archive manifest and checksums
2. Migrates v1/v2 state to v3
3. Applies the migrated state

v2.0.0 exports include a version manifest with `stateSchemaVersion: 3`. These exports are **not backward-compatible** with v1.x.

## Version Lock Requirement

v2.0.0 requires an explicit version lock before generation. After selecting an OpenShift minor version (4.20 or 4.21) and a patch release in the Blueprint step, the version must be confirmed (locked) before proceeding. This lock determines:

- Which parameter catalog is used (version-specific field visibility)
- Which Field Guide content and documentation URLs are generated
- Which validation rules apply

The lock can be released and re-locked to change versions, but generated assets always reflect the locked version.

## New Features

### Version-Aware Parameter Catalogs

Each supported OpenShift minor version has its own parameter catalog. Fields introduced in 4.21 (e.g., AWS EBS throughput, Confidential Compute, Azure shared key access, Azure BYO VNet subnets, BMC CA verification) are only visible when the locked version is 4.21.

### Field Guide Versioning

The Field Guide (`FIELD_MANUAL.md`) now generates version-specific content with documentation URLs matching the locked minor version. There is no fallback — requesting a Field Guide for an unsupported version produces an error.

### Version Annotations

Fields introduced in 4.21 display "New in 4.21" annotations. Deprecated fields (e.g., vSphere legacy placement fields) display deprecation notices.

### vSphere Inventory Path Correctness

vSphere failure-domain topology fields (`computeCluster`, `datastore`) now require full inventory paths (e.g., `/<datacenter>/host/<cluster>`). The backend automatically constructs full paths from legacy short names when converting from legacy to failure-domain mode.

## Breaking Changes Summary

1. **OpenShift version scope**: Only 4.20 and 4.21 are supported. 4.22+ is rejected.
2. **Version lock required**: Generation requires a locked version selection.
3. **Export format**: v2.0.0 exports use manifest schema 1.0.0 with state schema v3. Not importable by v1.x.
4. **vSphere paths**: Full inventory paths required for `computeCluster` and `datastore` in failure-domain mode.
5. **Field Guide**: Version-specific content only. No cross-version fallback.
