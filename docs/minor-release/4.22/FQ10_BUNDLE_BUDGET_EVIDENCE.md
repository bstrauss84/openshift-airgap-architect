# FQ-10 — frontend bundle budget, pre-Tranche-2 blocker evidence

> **Tranche 1 deliverable 9 of 10.** Measurement and options only.
> **The threshold is not changed. No bundle architecture is implemented.**

> **Identifier note.** `FQ-10` was supplied by the tranche prompt and is kept **exactly as
> given** (execution-contract rule 2). `docs/BACKLOG_STATUS.md` was read first
> (rule 11): `FQ-10` is **not** a canonical backlog ID there. The `FQ-nn` namespace is the
> findings queue used by `AUTOMATION_HARVEST_LEDGER_4.21.md`, which runs **FQ-1 … FQ-8**.
> FQ-10 therefore extends that findings-queue sequence and still needs a canonical
> `DOC-`/`PROD-` ID from the human before it is scheduled.

---

## 1. Measured baseline — pre-4.22

```
cd frontend && npm run build && npm run check-size
```

| | |
|---|---|
| build | **exit 0** (vite 5.4.21, 131 modules, 1.29 s) |
| **total `dist/`** | **3,577 KB** (3,662,731 bytes) |
| configured limit | **2,500 KB** |
| `check-size` | **exit 1** — `bundle size 3577 KB exceeds limit 2500 KB` |
| overage **today, before any 4.22 work** | **+1,077 KB (143 % of budget)** |

## 2. What is counted

`frontend/scripts/check-bundle-size.js` walks `dist/` recursively and sums **every file's
raw byte size**. Not gzip. Not per-chunk. Not JS-only.

| Component | Bytes | Share |
|---|---|---|
| `assets/index-*.js` | 2,662,221 | 72.7 % |
| `airgap-architect-banner.png` | 331,141 | 9.0 % |
| `airgap-architect-logo.png` | 318,462 | 8.7 % |
| `info-icon.png` | 248,974 | 6.8 % |
| `assets/index-*.css` | 100,819 | 2.8 % |
| `index.html`, `logo.svg` | 1,114 | <0.1 % |

**Three PNGs are 898,577 bytes — 24.5 % of the measured total.** A quarter of the budget is
static imagery that has nothing to do with version data. `info-icon.png` at 249 KB for an
icon is the standout.

## 3. Why the baseline already exceeds the budget

Two causes, and they are different in kind.

**(a) The budget was never enforced.** `check-bundle-size.js` appears in **no** pipeline —
confirmed by reading `.github/workflows/` and `.pre-commit-config.yaml`. It is gap list
**GAP-13**. A budget nothing runs does not constrain anything, so the bundle drifted past
it without a signal.

**(b) Versioned catalog data dominates the JS.** `frontend/src/catalogPaths.js:17`:

```js
const catalogs = import.meta.glob('./data/catalogs/**/*.json', { eager: true });
```

`eager: true` means **every supported minor's catalogs are bundled into the main chunk and
loaded on page load**, regardless of which version the user selected. Confirmed empirically:
the built bundle contains 840 occurrences of the 4.21 documentation URL.

| Data | Raw | Minified (whitespace-stripped JSON) |
|---|---|---|
| `catalogs/4.20` (13 files) | 1,011 KB | **796 KB** |
| `catalogs/4.21` (12 files) | 1,000 KB | **787 KB** |
| `docs-index/4.21.json` | 27 KB | 20 KB |

**≈1,603 KB of the 2,600 KB JS bundle — about 62 % — is versioned catalog data.**

`frontend/src/docsIndexResolver.js:10-11` does the same thing with static top-level
`import` statements per minor.

## 4. Projected effect of adding 4.22

A 4.22 catalog set will be at least as large as 4.21's (it has strictly more parameters and
4.22-native citations).

| | Estimate |
|---|---|
| + `catalogs/4.22` minified | ≈ +790 KB |
| + `docs-index/4.22.json` | ≈ +20 KB |
| **projected `dist/` total** | **≈ 4,387 KB** |
| vs the 2,500 KB limit | **+1,887 KB — 175 % of budget** |

The Field Guide `v4.22/` tree is **backend-only** and does not enter the frontend bundle.

Growth is **linear in supported minors**, and R8 makes supported minors cumulative by
design. 4.23 would add another ~800 KB. This does not converge.

## 5. Doc/code mismatch — FQ-3, re-confirmed

The script header says *"Set `BUNDLE_SIZE_LIMIT_KB` (default 2048)"*; line 12 uses `2500`.
Already recorded as **FQ-3** in the 4.21 harvest ledger. Still present. Whichever number is
chosen, the two should agree.

## 6. The decision required before Tranche 2

Tranche 2 authors `data/params/4.22/**` and its generated frontend mirror. **That is the
commit that adds ~810 KB.** The budget question must be answered first, because afterwards
the "before" measurement is gone.

**Raising the threshold arbitrarily is explicitly out of bounds**, and it would not help:
the trend is linear and unbounded.

| Option | What it does | Cost | Honest assessment |
|---|---|---|---|
| **A — lazy-load catalogs per minor** | `import.meta.glob(..., { eager: false })`; same for `docsIndexResolver.js` | **Real API change** — catalog resolution becomes async, touching `catalogResolver.js`, `catalogFieldMeta.js` and ~6 step components | Addresses the actual cause. Main chunk drops by roughly the two non-selected minors. Makes growth flat in supported minors instead of linear. The only option that survives 4.23. |
| **B — optimise the three PNGs** | compress / resize / convert to WebP or SVG | Low. No API change. | Recovers up to ~870 KB — on its own nearly cancels the current overage. Does nothing about linear growth, but it is cheap, independent, and can land first. |
| **C — change what is counted** | count JS+CSS only, or measure gzip | Low | Defensible (gzip is what users download: the JS gzips to 432 KB), but it is **redefining the metric**, which needs to be a deliberate, stated decision rather than a way to go green. |
| **D — raise the threshold** | — | — | **Explicitly disallowed by the tranche prompt.** Also futile: linear growth. |

**Recommendation: B now, A before or with Tranche 2.** B is cheap and buys back most of
today's overage; A is the only change that makes the budget hold as minors accumulate.
C may be worth doing alongside, but as its own stated decision, not as the fix.

**Whatever is chosen, wire `check-bundle-size` into CI in the same commit** (GAP-13).
An unenforced budget is how this arrived here.

## 7. Blocker status

**This remains a BLOCKER BEFORE TRANCHE 2**, as the prompt states. It is a decision
blocker, not a research blocker: the measurement is complete and the options are costed.
Nothing further is needed from research to decide it.
