# Placeholder / dummy values — deferred (UI hidden)

## Current product state (this repo)

- **UI:** The “Placeholder Values Mode” control on Methodology is **removed from the visible wizard**. Users do not get a toggle in normal flow.
- **Code (dormant):** Helpers remain in `frontend/src/placeholderValuesHelpers.js`. `HostInventoryV2Step` and state key `ui.placeholderValuesEnabled` can still apply placeholders when that flag is true (e.g. tests or future re-enablement), but there is **no** in-app entry point.

## Why deferred

- The implementation only covers a **narrow** subset of sensitive fields (host inventory / VIP-shaped state) and is **state-mutating**: turning the feature on overwrites live inventory fields and interacts with validation in ways that are hard to reason about for production UX.
- A credible **low-side / high-side** workflow needs **non-destructive** outputs: tokenized placeholders in **generated YAML and runbooks**, a **stable placeholder manifest** (names → semantics), and a **replacement map** applied out-of-band or in a dedicated export step—not silent mutation of the wizard model.
- Expanding placeholders inside the live wizard (baseDomain, proxy, trust bundle, pull secret, networking CIDRs, etc.) without that architecture would increase **correctness and validation bugs**.

## Preferred future direction (concrete)

1. **Exports:** Offer “Export with placeholders” / template mode that writes literal tokens (e.g. `{{API_VIP}}`) into `install-config.yaml`, `agent-config.yaml`, and related artifacts where appropriate, without rewriting stored state.
2. **Manifest:** Check in or generate a small JSON/YAML manifest: token id, description, required/optional, which outputs reference it.
3. **Replacement map:** Optional sidecar file for high-side substitution (`token → value`) used by a script or documented manual step.
4. **Minimize live-state mutation:** Default wizard path keeps real validation against real values; placeholder mode must not clear user data without explicit opt-in and undo.
5. **Doc alignment:** Any revival must be scoped per scenario against 4.17–4.20 official docs (same rule as the rest of the app).

## Related working docs

- `docs/BARE_METAL_4_20_AGENT_DOC_REVIEW_AND_PLAN.md` — implementation vs deferred honesty section.
- `docs/DATA_AND_FRONTEND_COPIES.md` / `docs/PARAMS_CATALOG_RULES.md` — unchanged; future placeholder work must not fork catalogs without syncing.
