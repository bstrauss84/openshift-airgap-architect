# Canonical doc source + example-capture rules

This document is the **authoritative** set of rules for scenario doc-truth passes and full-scenario document review. Use it when running or automating docs-index mapping, params reconciliation, and doc review (e.g. first-pass scenario-by-scenario).

---

## Canonical documentation source

- `docs.openshift.com` is shut down.
- For this app, the **ONLY** canonical OpenShift documentation source is:
  `https://docs.redhat.com/en/documentation/openshift_container_platform/<version>/`
- All doc-index entries, scenario links, parameter citations, notes, and supporting references must use `docs.redhat.com`.
- If you find any existing `docs.openshift.com` URLs in:
  - docs-index files
  - params/catalog files
  - working docs
  - helper docs
  - code comments
  they must be updated to the equivalent `docs.redhat.com` URL as part of the doc-truth pass, **unless you clearly document why an exact equivalent cannot yet be found.**

---

## Full-scenario document review requirements

- Do a **line-by-line review** of the relevant scenario doc family on `docs.redhat.com`, including:
  - parent install guide
  - install-method section
  - linked sub-scenario pages/anchors
  - restricted-network / private / disconnected variants
  - install-config / agent-config parameter tables
  - **all** config examples and config snippets
- You **MUST** expand and inspect all hidden content, including:
  - “Show more”
  - collapsed parameter rows
  - hidden example blocks
  - expandable YAML/config snippets

---

## Either/or and “choose one” rules

- For every place the docs present **mutually exclusive** or **alternate methods** (e.g. “Choose one of the following methods…”), you must capture the **FULL narrative** for each path, not just the parameter names.
- Examples:
  - `clusterOSImage` vs `topology.template`
  - legacy flat placement vs `failureDomains`
  - external load balancer vs API/Ingress VIP emission
  - internal vs external publish
- For each such case, record:
  - the exact condition
  - which path is recommended
  - which path is deprecated (if applicable)
  - what fields/parameters belong to each path (with example values/snippets from the doc)
  - **all numbered procedural steps** from the doc for each path (e.g. for topology.template: download OVA → Deploy OVF Template → Select OVF tab → name and folder → compute resource → storage → do not customize → set topology.template in install-config). Do not summarize; list steps so layout and order are traceable.
- This must be reflected in params metadata under **structured conditionals**.

---

## Install-config / agent-config example coverage

- List **EVERY** relevant config example or snippet in the scenario doc family with:
  - exact `docs.redhat.com` URL and **exact anchor**
  - when the same content exists in both multipage HTML and **html-single**, record URL+anchor for **both** (anchor IDs differ; e.g. html-single uses anchors like `#installation-installer-provisioned-vsphere-config-yaml_installing-restricted-networks-installer-provisioned-vsphere`, `#specifying-regions-zones-infrastructure-vsphere_post-install-vsphere-zones-regions-configuration`, `#installation-vsphere-regions-zones-host-groups_...`)
  - whether it is a full example or partial snippet
  - the **exact key hierarchy/layout** shown
  - the **use-case scenario** described by the surrounding text
- Resolve every scenario-specific section in the install book (e.g. regions/zones, regions-zones-host-groups, restricted-network config YAML); do not skip an example because it appears only under a specific html-single anchor.
- If a full example does not exist, say so explicitly.
- If examples exist in the install book but not in the parameter reference, you must still capture them.
- Do not stop at the parameter page.

---

## Docs-index requirements

- For each scenario, ensure `data/docs-index/<version>.json` and any mirrored/canonical copies:
  - use `docs.redhat.com`
  - include the correct parent guide
  - include the correct install-method entry
  - include relevant sub-scenario docs nested under the parent scenario
  - include useful notes/tags that reflect scenario-specific config relevance

---

## Params/citation cleanup requirements

- During any scenario doc-truth pass, if scenario params/catalog entries still cite `docs.openshift.com`, update them to `docs.redhat.com` equivalents.
- Do not leave mixed doc hosts in the same scenario after the pass unless you **explicitly document a blocker**.

---

## Completion rule

A scenario doc scan is **NOT complete** unless:

- `docs.redhat.com` was used as the canonical source
- hidden sections/examples were expanded and reviewed
- every relevant config example/snippet was cataloged
- every “choose one” / conditional path was captured
- docs-index and params citations were normalized to `docs.redhat.com`
- A **canonical docs normalization summary** was produced: which `docs.openshift.com` references were replaced with `docs.redhat.com` (and any that could not be replaced, with reason).
