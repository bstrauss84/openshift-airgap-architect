# E2E example collection inventory (K follow-up part 2, FINAL K part 3, Part 4 exhaustive)

Sources: OpenShift 4.20 installation docs (Red Hat), data/docs-index/4.20.json, nmstate.io examples. Each entry lists source (doc/section or URL), scenario/variant, and file location. This inventory currently tracks install-config coverage for the core scenario set used by this E2E collection; it is not the canonical scenario-ID registry (see `docs/DOC_INDEX_RULES.md` and `data/docs-index/4.20.json`).

## install-config examples

| File | Scenario | Variant | Source |
|------|----------|---------|--------|
| install-config/bare-metal-agent_minimal.yaml | bare-metal-agent | minimal | Red Hat 4.20 Agent-based Installer Ch 9.1 |
| install-config/bare-metal-agent_with-proxy.yaml | bare-metal-agent | with-proxy | 4.20 Installing on any platform, proxy section |
| install-config/bare-metal-agent_dual-stack.yaml | bare-metal-agent | dual-stack | 4.20 Agent doc 9.1.2 Network parameters (dual-stack) |
| install-config/bare-metal-agent_with-fips.yaml | bare-metal-agent | with-fips | 4.20 Agent doc 9.1.3 fips |
| install-config/bare-metal-upi_minimal.yaml | bare-metal-upi | minimal | 4.20 Bare metal UPI; platform none |
| install-config/bare-metal-ipi_minimal.yaml | bare-metal-ipi | minimal | **Synthetic from params** — data/params/4.20/bare-metal-ipi.json, docs-index installing-bare-metal-ipi |
| install-config/vsphere-ipi_minimal.yaml | vsphere-ipi | minimal | **Synthetic from params** — data/params/4.20/vsphere-ipi.json, installation-config-parameters-vsphere |
| install-config/vsphere-upi_minimal.yaml | vsphere-upi | minimal | **Synthetic from params** — data/params/4.20/vsphere-upi.json, docs-index installing-vsphere-upi |
| install-config/aws-govcloud-ipi_minimal.yaml | aws-govcloud-ipi | minimal | **Synthetic from params** — data/params/4.20/aws-govcloud-ipi.json, installing-aws-govcloud-ipi |
| install-config/aws-govcloud-upi_minimal.yaml | aws-govcloud-upi | minimal | **Synthetic from params** — data/params/4.20/aws-govcloud-upi.json, installing-aws-govcloud-upi |
| install-config/azure-government-ipi_minimal.yaml | azure-government-ipi | minimal | **Synthetic from params** — data/params/4.20/azure-government-ipi.json, installing-azure-government-ipi |
| install-config/nutanix-ipi_minimal.yaml | nutanix-ipi | minimal | **Synthetic from params** — data/params/4.20/nutanix-ipi.json, installing-nutanix-ipi |
| install-config/disconnected_imageDigestSources.yaml | (snippet) | mirroring | 4.20 disconnected; imageDigestSources with multiple sources/mirrors |

**Coverage:** The listed scenarios have >=1 example. Doc-sourced: bare-metal-agent (4 variants), bare-metal-upi (minimal). Synthetic from params: bare-metal-ipi, vsphere-ipi, vsphere-upi, aws-govcloud-ipi, aws-govcloud-upi, azure-government-ipi, nutanix-ipi (minimal each). Non-minimal paths for the latter scenarios use the minimal example for structure comparison.

## agent-config examples

| File | Scenario | Variant | Source |
|------|----------|---------|--------|
| agent-config/bare-metal-agent_minimal.yaml | bare-metal-agent | minimal | 4.20 Agent-based Installer Ch 9.2 |

## nmstate (agent-config networkConfig) — Part 4: zero exclusions

| File | Use | Source |
|------|-----|--------|
| nmstate/*.yaml (20 files) | iface up/down/absent, ethernet, bond, ovs-bridge, dummy, vlan, vxlan, linux-bridge, team, veth, route, route-rule, dns, dynamic-ip | https://nmstate.io/examples.html (full page fetched and every example extracted) |
| nmstate/nmstate-examples-raw.html | Raw fetched page | Same URL |

## Doc snippets (Part 4 crawl)

| Location | Count | Source |
|----------|-------|--------|
| docs/e2e-examples/snippets/ | ~1,357 blocks (after cleanup) | Every 4.20 doc URL fetched; HTML \<pre\>/\<code\> extracted. Snippets with wrong `kind` or oc/status output removed. See SNIPPETS_INVENTORY.md. |

## References

- Red Hat OpenShift 4.20: Installation configuration parameters for the Agent-based Installer — https://docs.redhat.com/en/documentation/openshift_container_platform/4.20/html/installing_an_on-premise_cluster_with_the_agent-based_installer/installation-config-parameters-agent
- Red Hat 4.20 Installing on any platform (proxy) — https://docs.redhat.com/en/documentation/openshift_container_platform/4.20/html/installing_on_any_platform/installing-platform-agnostic
- Red Hat 4.20 Bare metal UPI — https://docs.redhat.com/en/documentation/openshift_container_platform/4.20/html/installing_on_bare_metal/user-provisioned-infrastructure
- Red Hat 4.20 Disconnected — https://docs.redhat.com/en/documentation/openshift_container_platform/4.20/html/disconnected_environments/
- NMState state examples — https://nmstate.io/examples.html
