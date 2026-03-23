# AI Assistance Governance

This policy governs AI-assisted work in this repository.

It is written for current Cursor workflows and intentionally structured so future assistants can follow the same policy core.

## Policy objectives

- Keep human ownership and accountability for all merged changes.
- Preserve OpenShift docs alignment (4.17-4.20) and conservative behavior defaults.
- Prevent secrets/data leakage in prompts, outputs, code, and logs.
- Keep disconnected/airgap assumptions explicit in generated recommendations.
- Keep changes audit-ready with evidence and validation records.

## Human-in-the-loop requirements

- A human reviewer approves all AI-assisted code and docs before merge.
- AI output is advisory until validated by repository checks and reviewer judgment.
- High-risk areas require explicit human validation notes:
  - security and credentials
  - networking and proxy behavior
  - disconnected mirroring and registry workflows
  - long-running job behavior and filesystem writes

## Required evidence for AI-assisted changes

For non-trivial changes, include:

- affected file paths
- behavior summary tied to code/docs
- tests or checks run (or explicit reason not run)
- unresolved risks and follow-ups

Use existing project checks from `docs/CONTRIBUTING.md` and CI.

## Secret and data safety

- Never include real credentials or customer data in prompts.
- Never commit generated secrets, pull secrets, kubeconfigs, keys, or auth files.
- Follow `docs/SECURITY_NOTES.md` and `.gitignore` policy.
- AI-generated scripts and examples must default to non-sensitive placeholders.

## Airgap and networking guardrails

- Recommendations must not assume outbound internet is available unless explicitly stated by user workflow.
- For disconnected flows, include where artifacts are produced, transferred, and consumed.
- Do not introduce implicit phone-home behavior in tools/scripts.
- If a suggestion requires network access, state that requirement clearly.

## Attribution and commit metadata

AI attribution should be lightweight and consistent.

Recommended patterns (choose one team convention):

1. PR checkbox or section: "AI-assisted: yes/no"
2. Commit trailer: `AI-Assisted: yes`

Do not add noisy per-line attribution comments in source files.

## Legacy unmarked AI-assisted content

- Historical commits may not contain AI attribution.
- Do not rewrite history solely for attribution.
- Apply this policy to all new work going forward.

## Workflow profiles

### Cursor profile (current)

- Follow `AGENTS.md` and `.cursor/rules/core-guidelines.mdc`.
- Keep helper prompts concise and reference canonical docs instead of duplicating rules.

### Future assistant profile (portable policy)

- Apply the same policy core from this document.
- Keep tool-specific instructions in assistant-native config files while preserving this repo-level governance baseline.

## Change control and drift prevention

- Review this policy when major workflow changes occur (new assistant tools, new CI guardrails, or major product direction changes).
- Update `docs/INDEX.md` if authority or ownership changes.
- Any policy exception must be documented in a tracked doc with rationale and scope.
