# Evidence source precedence, and what to do when Red Hat's sources conflict

**Status:** durable onboarding rule. Added v2.1 Tranche 7C.2 (2026-10-08).
**Applies to:** every support claim recorded in `data/arch-support/<minor>.json`,
`data/scenario-support/<minor>.json`, `data/params/<minor>/`, `data/docs-index/<minor>.json`
and the Field Guide.

## Why this exists

Three support questions in this product turned out to have *more than one* Red Hat
answer, and the differences were not noise:

- **AWS GovCloud IPI / aarch64** — the installation-overview installer-provisioned
  matrix leaves the ARM column blank on the `Government regions` row, while the AWS
  book's GovCloud chapter contains a "Tested instance types for AWS on 64-bit ARM
  infrastructures" section. Reading the second as support would have widened a
  government-region claim on the strength of a module that appears **five times in the
  same book with one identical body** — reused commercial-AWS boilerplate.
- **AWS GovCloud UPI / aarch64** — aarch64 RHCOS AMIs are published for
  `us-gov-east-1` and `us-gov-west-1`. No sentence anywhere says the combination is
  supported. The overview's user-provisioned matrix has no `Government regions` row at
  all.
- **Nutanix + Agent-based Installer** — the overview "Supported platforms" table leaves
  the Agent cell blank, while the Agent book lists `nutanix` and the Nutanix book says
  you can do it.

In each case the tempting move was to let the more *convenient* source win. The rule
below exists so that choice is made by specificity, in advance, rather than per-case.

## Precedence order

Highest authority first. A lower-numbered source outranks a higher-numbered one.

1. **Exact minor + exact platform + exact method + exact region support statement or
   matrix.** The most specific thing Red Hat publishes about precisely the cell in
   question.
2. **Exact minor, platform-specific installation guide** (e.g. `installing_on_aws`).
3. **Exact minor, method-specific installation guide** (e.g. the Agent-based Installer
   book).
4. **Exact minor, general installation overview.**
5. **Exact installer/source capability**, as implementation corroboration only.
6. **Generic architecture availability** — a global architecture list, or an
   instance-type module reused across chapters.
7. **Artifact existence** — a published AMI, ISO or image.

### Rule 7 is not evidence of support

An artifact existing means someone can build something. It does not mean Red Hat
supports the result. **Artifact existence alone must never be recorded as supported.**
This is the rule that keeps `aws-govcloud-upi` / `aarch64` closed.

### Rule 6 does not beat rule 1

A generic architecture list or a reused instance-type module is not a statement about a
specific platform/method/region cell. Before citing one, check how many times the
identical block appears in the book; if it is boilerplate, it is rule 6, not rule 2.

### Independent lists must not be multiplied

The Agent book publishes a global architecture list *and* a global platform list. They
are two independent lists. **Do not cross them.** A cell is only supported if a sentence
actually names both. In practice exactly one sentence in that book does:

> Boot the `agent.x86_64.iso` , `agent.aarch64.iso` , or `agent.s390x.iso` image on the
> bare-metal machines.

which is why `bare-metal-agent` / `s390x` is recorded as upstream-supported and
`bare-metal-agent` / `ppc64le` is not.

### Government regions are not commercial regions

Red Hat documents AWS GovCloud and Azure Government as separate install types with their
own chapters and their own matrix rows. Commercial AWS or Azure evidence is **never**
evidence for a government region.

## When two high-authority sources directly conflict

Do not guess, and do not quietly pick the one that matches the current implementation.

1. Record **both** sources verbatim, each with its own `html-single` URL for **that**
   minor.
2. Set the upstream status to `documentation-conflict`.
3. **Fail closed on the OAA side** — the product does not expose the combination until
   the conflict is resolved.
4. Open or reuse a backlog item naming the conflict.

Both authorities enforce this: `scripts/validate-arch-support.js` rejects an *offered*
cell whose `upstreamSupport` is `documentation-conflict` or `unknown-needs-review`, and
`scripts/validate-scenario-support.js` rejects a *modelled* platform/method cell in the
same states.

## Upstream support and OAA support are different questions

Keep them in different fields. Red Hat supporting more than Architect exposes is a
deliberate product decision, not a defect — but it has to be written down.

| | field | vocabulary |
|---|---|---|
| What Red Hat documents | `upstreamSupport` (arch) / `upstream` (scenario) | `supported`, `unsupported` / `not-supported`, `documentation-conflict`, `unknown-needs-review` |
| What Architect does | `disposition` + `offered` (arch) / `oaa` (scenario) | see each validator |
| Why Architect narrows | `oaaScopeDecision` (arch) / `oaaReason` (scenario) | required prose, with a backlog ID |

A cell is a **defect** only when:

- Architect offers something upstream calls unsupported; or
- Architect offers something upstream has not decided, or where the sources conflict; or
- Architect narrows below upstream support without an explicit recorded decision; or
- the recorded rationale is false; or
- the UI/runtime disagrees with the recorded disposition.

A cell is **not** a defect merely because Architect supports less than Red Hat does.

## Onboarding a new minor

The scenario-surface diff (`node scripts/validate-scenario-support.js`, run by
`npm run validate-authority`) reports every platform × method change between consecutive
supported minors. Treat it as a sibling of — never a substitute for — the install-config
field delta, the AgentConfig delta, the NMState delta, the architecture delta, the
operator/catalog delta and the docs delta.

Never copy a prior minor's evidence forward. Both validators reject a source URL that
does not contain the minor it is filed under, because cross-minor backfill is how a
4.20-era reading becomes a 4.22 claim.

The full URL ledger behind the current dispositions is
[`ARCHITECTURE_EVIDENCE_LEDGER.md`](./ARCHITECTURE_EVIDENCE_LEDGER.md).
