# Advanced NMState bond-option parity audit

> **Tranche 7A deliverable.** Audit only — **no production code is changed by this
> document.** Baseline `85d93fddc2e0b8a2c4986f381d9205bd0597de26`.
>
> **Outcome: NOT release-blocking for v2.1.** No user-facing surface claims an advanced
> bond option works. The gap is a genuine capability gap, and it is **identical at
> 4.20, 4.21 and 4.22** — there is no cross-minor divergence. Tracked as **DOC-188**.
>
> One latent trap is recorded: the NMState generator **hardcodes**
> `link-aggregation.options = { miimon: "100" }` and silently discards any
> `bond.options` present in state. Unreachable through any supported workflow today,
> but it is the exact line that must change when the feature is implemented.

---

## 1. The question

The human asked whether advanced bond options — *especially* `xmit_hash_policy` — are
fully supported and replicated across versions.

Short answer: **they are not supported at all, at any version.** What *is* shipped is
bond `mode` and bond member ports (`port`). Everything under
`link-aggregation.options.*` is either absent or hardcoded.

The second half of the question matters as much as the first: **are they replicated
across versions?** Yes — the absence is uniform. 4.20, 4.21 and 4.22 catalogs are
identical for this surface, so onboarding 4.22 neither introduced nor widened a gap.

---

## 2. Naming, stated exactly

Underscores, hyphens and camelCase are **not** interchangeable here, so each layer's
spelling is given literally.

| Layer | Spelling |
|---|---|
| NMState / generated YAML | `interfaces[].link-aggregation.options.<option>` — hyphen in `link-aggregation`, **underscores** inside option names (`xmit_hash_policy`, `lacp_rate`, `min_links`) |
| Catalog `path` | `hosts[].networkConfig.interfaces[].link-aggregation.options.<option>` |
| Application state | `node.primary.bond.<field>` — camelCase, and bond **members are `slaves[]`**, not `port` |
| Generator | `addBond()` in `backend/src/generate.js` maps `bond.slaves[].name` → `link-aggregation.port` |

The state→YAML rename (`slaves` → `port`) is real and already handled. There is no
state field of any spelling for any `options.*` member.

---

## 3. Parity matrix

Legend: **✅** present · **❌** absent · **⚠️** present but not user-controlled.

| Option | Authoritative NMState key | 4.20 catalog | 4.21 catalog | 4.22 catalog | UI | State model | Validation | Backend generation | Import/export | Tests | Field Guide / help | Disposition |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| bond mode | `link-aggregation.mode` | ✅ row | ✅ row | ✅ row | ✅ dropdown, 2 values | ✅ `bond.mode` | ❌ none | ✅ from state | ✅ preserved | ✅ asserted | ✅ extensive help | **SHIPPED** |
| bond members | `link-aggregation.port` | ✅ row | ✅ row | ✅ row | ✅ repeatable rows | ✅ `bond.slaves[]` | ✅ name required | ✅ from state | ✅ preserved | ✅ asserted | ✅ | **SHIPPED** |
| `miimon` | `link-aggregation.options.miimon` | ❌ no row | ❌ no row | ❌ no row | ❌ | ❌ | ❌ | ⚠️ **hardcoded `"100"`** | ❌ **discarded** | ❌ none | ❌ | **GAP — hardcoded, untested** |
| **`xmit_hash_policy`** | `link-aggregation.options.xmit_hash_policy` | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ never emitted | ❌ discarded | ❌ | ❌ | **NOT IMPLEMENTED** |
| `lacp_rate` | `link-aggregation.options.lacp_rate` | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ discarded | ❌ | ❌ | **NOT IMPLEMENTED** |
| `updelay` | `link-aggregation.options.updelay` | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ discarded | ❌ | ❌ | **NOT IMPLEMENTED** |
| `downdelay` | `link-aggregation.options.downdelay` | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ discarded | ❌ | ❌ | **NOT IMPLEMENTED** |
| `primary` | `link-aggregation.options.primary` | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ discarded | ❌ | ❌ | **NOT IMPLEMENTED** — and it is the one option Red Hat documents *by example* |
| `min_links` | `link-aggregation.options.min_links` | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ discarded | ❌ | ❌ | **NOT IMPLEMENTED** |

### Cross-minor alignment — verified mechanically

All three minors carry exactly three bond rows per agent scenario
(`link-aggregation`, `.mode`, `.port`), all `supportStatus: supported-backend-only`,
with identical `allowed` text, in both `bare-metal-agent` and `vsphere-agent`. The
generated frontend mirrors are **byte-identical** to the canonical catalogs for these
rows at every minor. **No `link-aggregation.options` row exists at any minor.**

---

## 4. Why this is not release-blocking

The release-blocking test is: *does an existing surface claim an option works while it
is silently dropped or generated wrongly?* Each possible claim was checked and none
exists:

| Possible claim | Present? |
|---|---|
| A UI control for any bond option | **No** — the node drawer offers a bond **mode** dropdown and member rows, nothing else |
| A tooltip or help text promising option control | **No** — bond help covers mode choice and LACP switch requirements only |
| A catalog row marking an option `supported-ui` | **No** — no `options.*` row exists at any minor |
| Validation implying an option is accepted | **No** — no bond-option validation anywhere |
| Documentation telling users to hand-edit state to add options | **No** |

So the only way to get `bond.options` into state is to hand-craft or hand-edit an
exported file, which the product neither produces nor documents.

### The latent trap, recorded precisely

`backend/src/generate.js` `addBond()`:

```js
"link-aggregation": {
  mode: bond.mode || "active-backup",
  options: { miimon: "100" },          // unconditional, ignores state
  port: (bond.slaves || []).map((s) => s.name).filter(Boolean)
}
```

Reproduced at 4.22: a state carrying
`bond.options = { miimon: "250", xmit_hash_policy: "layer3+4", lacp_rate: "fast", updelay: "200", downdelay: "200" }`
generates `{"mode":"802.3ad","options":{"miimon":"100"},"port":[...]}` — every supplied
option **silently discarded**, with no warning.

Severity today: **low**, because the path is unreachable through supported use.
Severity when DOC-188 is implemented: **this is the defect**. The hardcode must become
state-driven in the same change, or user input will be accepted by the UI and dropped
by the generator — which *would* be release-blocking.

`miimon: "100"` is itself a defensible default: it is mode-agnostic link monitoring and
Red Hat's own 4.21 agent example uses `miimon`. It is not wrong; it is merely fixed.
**No test asserts it**, so changing or losing it today would be silent.

---

## 5. Support authority — what Red Hat actually documents

Taken from the committed Tranche 1 research
([`DOC165_GENERATED_CONFIG_COVERAGE_4.22.md`](DOC165_GENERATED_CONFIG_COVERAGE_4.22.md)),
which performed the authoritative same-minor pass. Not re-derived here.

- Red Hat's 4.22 *Agent-based Installer* book documents NMState **by example**, not by
  parameter table. `options.primary` appears in an example; `options.miimon` appears in
  the **4.21** example.
- `lacp_rate`, `min_links` and **`xmit_hash_policy` are verified absent** from the 4.22
  Agent book in the portions read — they are **upstream NMState capability only**.
- The *Kubernetes NMState* book is **not** authority for `agent-config.yaml`.
- Only `802.3ad` and `active-backup` are documented bond modes at 4.22. The other five
  upstream modes are undocumented — and, correctly, the UI offers exactly those two.

**Upstream NMState capability is not Red Hat OpenShift support.** That distinction is
the reason this audit does not simply recommend exposing every option the kernel
accepts.

### One wording inconsistency, non-blocking

The catalog description for `link-aggregation.mode` reads *"e.g. balance-rr,
active-backup"*. `balance-rr` is one of the five modes Red Hat does **not** document at
4.22, and `802.3ad` — which the UI does offer — is missing from the example text. This
is descriptive prose on a `supported-backend-only` row, not an enum the product
enforces, so nothing is mis-generated. Folded into DOC-188 rather than raised
separately.

---

## 6. Relationship to existing backlog items

| Item | Covers this? |
|---|---|
| **DOC-165** | Yes, but as the *umbrella*: "every Red Hat-supported field … for every structured configuration artifact", with bond options as its **motivating example**. It names `miimon`, `primary`, `lacp_rate`, `min_links`, `xmit_hash_policy`. Far broader than bond, and its blocking question is a **policy decision** (below). |
| **PHX-007** | E2E/UI path coverage for bond/VLAN NMState output. Test-coverage scope, not option parity. |
| **PHX-025** | Bond **mode** naming vs NMState alignment. Mode only. |
| **PHX-034** | Broaden backend generation unit tests. Test scope. |

None of the three PHX items establishes `xmit_hash_policy` closure, and DOC-165 is too
broad to track it discretely. **DOC-188 is therefore created** as the explicit,
narrowly-scoped item, cross-referenced to DOC-165 rather than duplicating it.

### The decision DOC-188 inherits from DOC-165

Red Hat documents these fields only by example while upstream NMState supports many
more. The policy question — already posed in the committed research — is:

| Option | Rule | Consequence |
|---|---|---|
| **A** | model only what a Red Hat same-minor example shows | smallest and most defensible; **excludes `xmit_hash_policy`** |
| **B** | model the upstream NMState schema, annotated by Red Hat coverage | largest coverage; risks implying support Red Hat has not stated |
| **C** | curated documented subset + a validated raw-NMState escape hatch | matches how Red Hat describes it; largest cost |

The research recommends **A for v2.1, C as the direction**. This is a **product
decision for the human**, not an agent decision, and it is not made here.

Note the consequence worth being explicit about: **under Option A, `xmit_hash_policy`
would remain unexposed**, because Red Hat does not document it for the Agent-based
installer. "Not implemented" would then be the *correct* end state, not a gap to close.

---

## 7. Recommended release target

**v2.1.x — not a v2.1.0 blocker.**

Reasoning:

1. **Nothing is falsely claimed.** No control, tooltip, catalog row or validation
   promises any advanced bond option, so no user can be misled by shipping v2.1.0.
2. **No regression.** The surface is byte-identical across 4.20/4.21/4.22; the 4.22
   onboarding neither caused nor worsened it.
3. **It is blocked on a product decision**, not on engineering. Shipping an
   implementation before the human chooses A/B/C would hard-code a support policy by
   accident — exactly the failure the documentation-veto rule exists to prevent.
4. **Users are not stuck.** Bond `mode` and members — the configuration that determines
   whether a bond comes up at all — are shipped and tested.

If the human instead wants `xmit_hash_policy` in v2.1.0, the honest scope is: the
policy decision, catalog rows at **all three** minors, UI, state, validation,
generator change (removing the hardcode), import/export round-trip, and tests —
realistically its own tranche, not a patch.

---

## 8. Acceptance criteria for DOC-188

Whatever option is chosen, closure requires **all** of:

1. A recorded product decision (A / B / C) with its authority cited.
2. For each option the decision includes: a catalog row at **4.20, 4.21 and 4.22**
   (the surface must stay aligned), with `supportStatus`, `minVersion` and a same-minor
   citation.
3. Regenerated frontend catalog mirrors (`npm run sync-catalogs`) — never hand-edited.
4. A UI control, with help text that distinguishes Red Hat-documented options from
   upstream-only ones.
5. State-model fields, with explicit UI → state → NMState name mapping.
6. Validation, including mode-specific constraints (e.g. `lacp_rate` and
   `xmit_hash_policy` are meaningless outside `802.3ad`).
7. **The `addBond()` hardcode replaced by state-driven emission**, with a test proving
   a user-supplied option reaches the YAML and is not overwritten.
8. A test proving options absent from state are omitted rather than defaulted — or, if
   a default is retained deliberately, a test pinning it.
9. Import/export round-trip preserving every option.
10. Cross-minor tests at all three supported minors.
11. Field Guide / help copy.
12. The `link-aggregation.mode` description corrected so its examples match the modes
    the product actually offers.
