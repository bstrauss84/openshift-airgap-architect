# Adding a new OpenShift version (e.g. 4.21)

Use this process when adding support for a new OpenShift version (e.g. 4.21) so scenario truth stays consistent. Single source: `data/docs-index/<version>.json` and params under `data/params/<version>/` or frontend catalogs keyed by version.

**Same rules:** Align to official docs for that version; no credentials stored; keep docs.redhat.com as canonical doc source.

---

## 1. Docs-index

1. Copy the current version’s docs-index to the new version:
   ```bash
   cp data/docs-index/4.20.json data/docs-index/4.21.json
   ```
2. Update in `data/docs-index/4.21.json`:
   - Top-level `version`: `"4.21"`
   - `baseUrl`: `https://docs.redhat.com/en/documentation/openshift_container_platform/4.21/`
   - In every doc entry, replace `4.20` in URLs with `4.21` (or the correct path for 4.21 on docs.redhat.com).
3. If the app uses a frontend copy of docs-index, sync it:
   ```bash
   cp data/docs-index/4.21.json frontend/src/data/docs-index/4.21.json
   ```
   (Adjust if your build copies from `data/` automatically.)
4. Validate:
   ```bash
   node scripts/validate-docs-index.js
   ```
5. Optionally refresh live URLs for the new version:
   ```bash
   node scripts/refresh-doc-index.js data/docs-index/4.21.json
   ```

---

## 2. Params / catalogs

1. For each scenario that should support the new version:
   - If using **data/params**: copy or create `data/params/4.21/<scenario>.json` from 4.20; update any version-specific URLs in citations.
   - If using **frontend catalogs** only: ensure the catalog’s `version` (or equivalent) can represent 4.21 and that doc links in citations point to 4.21 where applicable.
2. Validate catalogs:
   ```bash
   node scripts/validate-catalog.js frontend/src/data/catalogs/<scenario>.json
   ```
   (Run for each scenario catalog you changed.)

---

## 3. Discovery helper (optional)

To get a suggested doc tree for the new version before editing docs-index:

```bash
node scripts/docs-index-discovery.js 4.21
node scripts/docs-index-discovery.js 4.21 vsphere
```

Then open the suggested URLs and confirm they exist for 4.21 before merging into docs-index.

---

## 4. Scenario doc mapping and URL check

After updating docs-index for the new version:

```bash
node scripts/scenario-doc-mapping.js vsphere-ipi data/docs-index/4.21.json
node scripts/scenario-doc-mapping.js vsphere-ipi data/docs-index/4.21.json --check-urls
```

`--check-urls` fetches each URL and reports ok/fail (requires network).

---

## 5. App and tests

- Update the app’s version picker or default version if it’s hardcoded to 4.20.
- Run backend and frontend tests; add or adjust tests for 4.21 if behavior differs.

---

## Reference

- **Doc index rules:** `docs/DOC_INDEX_RULES.md`
- **Canonical doc source:** `docs/CANONICAL_DOC_SOURCE_AND_EXAMPLE_CAPTURE_RULES.md`
- **Params reconciliation:** `docs/PARAMS_RECONCILIATION_CHECKLIST.md`
