# vSphere SDK Constraints for Disconnected Deployments

**Created:** 2026-05-17 (v1.3.0 Phase 5, Item #1: DOC-039)  
**Purpose:** Document vCenter API connectivity requirements and decision criteria for methodology selection in air-gapped environments

---

## Overview

OpenShift installation on vSphere supports three methodologies: **IPI** (Installer-Provisioned Infrastructure), **Agent-Based Installer**, and **UPI** (User-Provisioned Infrastructure). Each has different vCenter SDK requirements that affect viability in disconnected or network-segmented environments.

This document clarifies when each methodology works in disconnected scenarios and provides decision guidance.

---

## Methodology Comparison: vCenter API Requirements

### IPI (Installer-Provisioned Infrastructure)

**vCenter API Requirements:**
- Bootstrap node **MUST** reach vCenter API during installation
- vCenter API used for VM clone operations, storage provisioning, network configuration
- API calls happen throughout bootstrap and control plane bring-up

**Disconnected scenarios:**

| vCenter Connectivity | Bootstrap → vCenter | Result |
|---------------------|---------------------|--------|
| vCenter has internet access | ✅ Can reach | ✅ IPI works |
| vCenter is air-gapped | ✅ Can reach | ✅ IPI works |
| Network isolation prevents bootstrap → vCenter | ❌ Cannot reach | ❌ IPI fails |

**When IPI fails in disconnected:**
- NSX-T firewall blocks bootstrap → vCenter traffic
- vCenter on separate management network with no route from bootstrap network
- DMZ/security policy prevents automated API access from bootstrap node

**Failure symptoms:**
```
ERROR: Failed to connect to vCenter API: dial tcp <vcenter-ip>:443: i/o timeout
ERROR: VM clone operation failed: context deadline exceeded
```

---

### Agent-Based Installer

**vCenter API Requirements:**
- **NO** vCenter API calls during bootstrap
- ISO boots nodes directly without vCenter SDK interaction
- VMs must be pre-created or manually created from ISO

**Disconnected advantages:**
- ✅ Works even if bootstrap cannot reach vCenter API
- ✅ Works when vCenter is on isolated management network
- ✅ No automated API operations that might be blocked by security policy

**Workflow:**
1. User creates VMs manually (or via Terraform/Ansible outside OpenShift installer)
2. User mounts ISO to VMs
3. VMs boot from ISO and self-configure using embedded agent-config.yaml
4. No vCenter SDK calls from OpenShift installer

**Post-installation:**
If vSphere integration is desired post-install (vSphere CSI, cloud provider), cluster nodes will need vCenter API access. But this is **after** cluster is running, not during bootstrap.

---

### UPI (User-Provisioned Infrastructure)

**vCenter API Requirements:**
- **NO** OpenShift installer → vCenter API calls
- User provisions VMs manually (vCenter UI, Terraform, Ansible, etc.)
- User manually configures networking, storage, ignition
- OpenShift installer only generates ignition configs

**Disconnected advantages:**
- ✅ Full manual control - no automated API access
- ✅ Works in any network topology (user handles provisioning)
- ✅ Best for strict security policies that prohibit automated vCenter API access

**Trade-offs:**
- ❌ Most manual effort (no automation)
- ❌ User responsible for all VM configuration, networking, storage
- ❌ Longer deployment time

---

## Decision Matrix: Which Methodology for Disconnected vSphere?

### Use **IPI** when:

✅ vCenter API is reachable from bootstrap node network  
✅ Automated provisioning is desired  
✅ vCenter internet access is NOT required (vCenter can be air-gapped)  
✅ Network policy allows bootstrap → vCenter API traffic  

**Common scenarios:**
- Fully air-gapped datacenter with flat network (all nodes can reach vCenter)
- Disconnected environment where vCenter and cluster nodes are on same network segment
- Internet-restricted but not network-segmented

---

### Use **Agent-Based Installer** when:

✅ Bootstrap node cannot reach vCenter API  
✅ vCenter is on isolated management network  
✅ Security policy restricts automated vCenter API access  
✅ Prefer declarative configuration (agent-config.yaml) over API-driven provisioning  

**Common scenarios:**
- NSX-T firewall isolates management network from workload network
- DMZ deployment where vCenter is behind firewall
- High-security environment requiring manual VM creation approval
- Network-segmented architecture (management vs. workload networks)

**Recommended as default for disconnected vSphere.**

---

### Use **UPI** when:

✅ Maximum manual control required  
✅ Custom VM provisioning workflow (e.g., ServiceNow tickets, change management)  
✅ Integration with existing IaC tooling (Terraform, Ansible outside OpenShift installer)  
✅ Policy prohibits ALL automated provisioning tools  

**Common scenarios:**
- Highly regulated environments (financial, government) requiring manual approval per VM
- Existing VM provisioning workflow that must be followed
- Complex networking requiring manual configuration

---

## Troubleshooting: IPI Failures in Disconnected vSphere

### Symptom: "Failed to connect to vCenter API"

**Diagnosis:**
```bash
# From bootstrap node (or bastion):
curl -k https://<vcenter-fqdn>/rest/com/vmware/cis/session
```

**If curl fails:**
- Network route missing: Check routing table, NSX-T firewall rules
- DNS resolution: Check `/etc/resolv.conf`, test `nslookup <vcenter-fqdn>`
- Firewall: Check NSX-T distributed firewall, vCenter appliance firewall

**If curl succeeds but installer fails:**
- Check vCenter credentials in install-config.yaml
- Verify vCenter username has required permissions (Administrator@vsphere.local or delegated role)
- Check vCenter certificate trust (installer requires valid or explicitly-ignored TLS)

### Symptom: "VM clone operation failed"

**Diagnosis:**
```bash
# Check vCenter datastores, resource pools, folders exist:
govc datastore.info <datastore-name>
govc pool.info <resource-pool>
govc folder.info <folder-path>
```

**Common causes:**
- Datastore path incorrect in install-config.yaml (must be full path: `/DC1/datastore/DS1`)
- Resource pool full (CPU, memory limits exceeded)
- Insufficient vSphere permissions for user

---

## References

- **Red Hat BZ#1953035:** Internal publish strategy not supported on vSphere (non-cloud platform limitation)
- **OpenShift Documentation:** [Installing on vSphere](https://docs.openshift.com/container-platform/4.20/installing/installing_vsphere/)
- **vSphere API Requirements:** [vSphere API Reference](https://developer.vmware.com/apis/vsphere-automation/latest/)

---

## Summary

| Methodology | vCenter API Required? | Best For |
|-------------|----------------------|----------|
| IPI | ✅ Yes (bootstrap → vCenter) | Automated provisioning, flat network, vCenter reachable from bootstrap |
| Agent | ❌ No (manual VM creation) | **Recommended for disconnected:** Network segmentation, vCenter on isolated network, security restrictions |
| UPI | ❌ No (fully manual) | Maximum control, custom workflows, strict policies |

**Default recommendation for disconnected vSphere:** **Agent-Based Installer** - balances automation (declarative agent-config) with network flexibility (no vCenter API requirement during bootstrap).
