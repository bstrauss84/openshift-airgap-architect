# UPI Preparation Guides

**Version:** 1.0  
**Last Updated:** 2026-05-15  
**Purpose:** Standardized preparation templates, checklists, and examples for User-Provisioned Infrastructure (UPI) OpenShift deployments

---

## Overview

User-Provisioned Infrastructure (UPI) installations require manual provisioning of infrastructure components before running the OpenShift installer. These guides provide reusable templates, checklists, and validation commands to accelerate UPI deployment preparation **without over-assuming infrastructure specifics**.

**Philosophy:** Provide helpful templates and checklists WITHOUT assuming specific infrastructure details. Users still provision infrastructure using their organization's tools and processes, but we eliminate repetitive configuration work.

---

## What These Guides Provide

✅ **Infrastructure prerequisites checklists** - Node counts, CPU/RAM/disk requirements  
✅ **DNS configuration templates** - A records, CNAME records, wildcard ingress  
✅ **Load balancer configuration examples** - HAProxy, nginx, CloudFormation, ARM templates  
✅ **Mirror registry checklists** - For disconnected/air-gapped deployments  
✅ **Trust bundle preparation** - Merging CA certificates (mirror registry, vCenter, proxy)  
✅ **Pull secret preparation** - Combining Red Hat + mirror registry credentials  
✅ **Network CIDR planning worksheets** - Validating non-overlapping ranges  
✅ **Validation commands** - Testing DNS resolution, load balancer connectivity, registry access  

---

## What These Guides Do NOT Provide

❌ **Infrastructure provisioning automation** - Too org-specific (bare-metal hardware, vCenter topology, AWS accounts, Azure subscriptions)  
❌ **Load balancer vendor-specific config** - Too many vendors (HAProxy, F5, Citrix, AWS ALB, Azure LB, etc.) - **examples only**  
❌ **Ignition hosting server setup** - Too many options (nginx, Apache, S3, Azure Blob) - **requirement documented only**  
❌ **Bootstrap monitoring automation** - Too platform-specific (bare-metal console vs cloud serial console)  
❌ **CSR approval automation** - Already documented in Field Guide; automation risky  
❌ **Custom infrastructure scripts** - Risk over-assuming user's environment  

**Boundary:** Provide templates, checklists, and validation commands. Users provision infrastructure using their organization's tools/processes.

---

## Available Prep Guides

### Platform-Specific Guides

| Platform | Guide | Install Method | Key Considerations |
|----------|-------|----------------|-------------------|
| Bare Metal | [bare-metal-upi-prep-guide.md](bare-metal-upi-prep-guide.md) | UPI | Physical hardware, PXE boot, BMC access, external load balancers |
| vSphere | [vsphere-upi-prep-guide.md](vsphere-upi-prep-guide.md) | UPI | vCenter connectivity, OVA templates, VM cloning, vSphere trust bundles |
| AWS GovCloud | [aws-govcloud-upi-prep-guide.md](aws-govcloud-upi-prep-guide.md) | UPI | VPC configuration, IAM roles, Route53, Network Load Balancers |
| Azure Government | [azure-government-upi-prep-guide.md](azure-government-upi-prep-guide.md) | UPI | VNET configuration, NSGs, Azure Load Balancer, Azure DNS |

---

## Template Collections

### Load Balancer Templates

Location: `load-balancer-examples/`

| File | Platform | Technology | Use Case |
|------|----------|------------|----------|
| [bare-metal-haproxy.cfg](load-balancer-examples/bare-metal-haproxy.cfg) | Bare Metal, vSphere | HAProxy | On-premises load balancing (API, MCS, ingress) |
| [bare-metal-nginx.conf](load-balancer-examples/bare-metal-nginx.conf) | Bare Metal, vSphere | nginx | Alternative on-premises load balancing |
| [aws-govcloud-nlb.yaml](load-balancer-examples/aws-govcloud-nlb.yaml) | AWS GovCloud | CloudFormation | Network Load Balancer with target groups |
| [azure-government-lb.json](load-balancer-examples/azure-government-lb.json) | Azure Government | ARM Template | Azure Standard Load Balancer |

**Important:** All templates use `{{VARIABLE}}` markers for customization. See each file's header comments for required substitutions.

### DNS Examples

Location: `dns-examples/`

| File | Technology | Use Case |
|------|------------|----------|
| [bind-zone-template.zone](dns-examples/bind-zone-template.zone) | BIND | On-premises DNS zone file |
| [route53-terraform.tf](dns-examples/route53-terraform.tf) | Terraform + Route53 | AWS GovCloud DNS automation |
| [azure-dns-terraform.tf](dns-examples/azure-dns-terraform.tf) | Terraform + Azure DNS | Azure Government DNS automation |

---

## Common Preparation Tasks (All Platforms)

### 1. DNS Configuration

**Required records:**
- `api.<cluster-name>.<base-domain>` → Load balancer IP (API endpoint, port 6443)
- `api-int.<cluster-name>.<base-domain>` → Load balancer IP (internal API endpoint)
- `*.apps.<cluster-name>.<base-domain>` → Load balancer IP (ingress wildcard, ports 80/443)

**Validation:**
```bash
# Test DNS resolution
dig api.<cluster-name>.<base-domain>
dig test.apps.<cluster-name>.<base-domain>

# Verify A records resolve to correct IPs
nslookup api.<cluster-name>.<base-domain>
```

### 2. Load Balancer Configuration

**Required backends:**
- **API (TCP 6443):** Bootstrap node (during install only) + Control plane nodes (3+)
- **Machine Config Server (TCP 22623):** Bootstrap node (during install only) + Control plane nodes (3+)
- **Ingress HTTP (TCP 80):** Worker nodes (or control plane if no workers)
- **Ingress HTTPS (TCP 443):** Worker nodes (or control plane if no workers)

**Health checks:**
- API/MCS: TCP health check on respective ports
- Ingress: HTTP/HTTPS health check

**Bootstrap removal:**  
After bootstrap completes, remove bootstrap node from API and MCS load balancer backends.

### 3. Trust Bundle Preparation (For Disconnected Deployments)

**Sources to merge:**
1. **Mirror registry CA certificate** (if using self-signed registry)
2. **vCenter CA certificate** (if using vSphere with self-signed vCenter)
3. **Proxy MITM CA certificate** (if using proxy with SSL inspection)

**Merging process:**
```bash
# Concatenate all CA certificates into single PEM file
cat mirror-registry-ca.crt > trust-bundle.pem
cat vcenter-ca.crt >> trust-bundle.pem
cat proxy-ca.crt >> trust-bundle.pem

# Use in install-config.yaml:
additionalTrustBundle: |
  -----BEGIN CERTIFICATE-----
  [contents of trust-bundle.pem]
  -----END CERTIFICATE-----
```

### 4. Pull Secret Preparation

**For disconnected deployments:**

Merge Red Hat pull secret + mirror registry credentials:

```bash
# Original Red Hat pull secret (from cloud.redhat.com)
{
  "auths": {
    "cloud.openshift.com": {...},
    "quay.io": {...},
    "registry.connect.redhat.com": {...},
    "registry.redhat.io": {...}
  }
}

# Add mirror registry credentials
{
  "auths": {
    "cloud.openshift.com": {...},
    "quay.io": {...},
    "registry.connect.redhat.com": {...},
    "registry.redhat.io": {...},
    "mirror.registry.example.com:5000": {
      "auth": "<base64-encoded-user:password>",
      "email": "you@example.com"
    }
  }
}
```

**Generating mirror registry auth:**
```bash
echo -n 'username:password' | base64
```

### 5. Network CIDR Planning

**Required non-overlapping ranges:**
- **Machine network CIDR:** IP range for cluster nodes (e.g., `192.168.1.0/24`)
- **Cluster network CIDR:** Pod IP range (e.g., `10.128.0.0/14`)
- **Service network CIDR:** Service IP range (e.g., `172.30.0.0/16`)

**Validation:**
- Ensure machine network does NOT overlap with cluster/service networks
- Ensure machine network is routable within your organization (if required)
- Reserve static IPs for load balancers, mirror registry (outside DHCP range if using DHCP)

### 6. Pre-Flight Validation

**Before running openshift-install:**

```bash
# DNS resolution
dig api.<cluster-name>.<base-domain>
dig api-int.<cluster-name>.<base-domain>
dig test.apps.<cluster-name>.<base-domain>

# Load balancer connectivity (after LB provisioned)
curl -k https://api.<cluster-name>.<base-domain>:6443/healthz
# Should return connection refused (no cluster yet) or timeout (LB not ready)
# Should NOT return DNS resolution error

# Mirror registry connectivity (for disconnected)
curl -k https://mirror.registry.example.com:5000/v2/_catalog
# Should return {"repositories":[...]} with mirrored images

# Trust bundle validation
openssl verify -CAfile trust-bundle.pem mirror-registry-ca.crt
```

---

## Disconnected Deployment Considerations

All UPI scenarios support disconnected deployment. See [DISCONNECTED_SCENARIO_MATRIX.md](../DISCONNECTED_SCENARIO_MATRIX.md) for comprehensive guidance.

**Key requirements:**
1. Mirror registry with ≥100 GB storage
2. `oc-mirror v2` workflow completed (mirror-to-disk + disk-to-mirror)
3. Trust bundle with mirror registry CA certificate
4. Pull secret with mirror registry credentials
5. `imageContentSources` or `imageDigestSources` in install-config.yaml

**Prep guide integration:**  
Each platform-specific prep guide includes a "Mirror Registry Checklist" section for disconnected deployments.

---

## How to Use These Guides

### Step 1: Choose Your Platform

Select the prep guide matching your platform:
- Bare Metal → [bare-metal-upi-prep-guide.md](bare-metal-upi-prep-guide.md)
- vSphere → [vsphere-upi-prep-guide.md](vsphere-upi-prep-guide.md)
- AWS GovCloud → [aws-govcloud-upi-prep-guide.md](aws-govcloud-upi-prep-guide.md)
- Azure Government → [azure-government-upi-prep-guide.md](azure-government-upi-prep-guide.md)

### Step 2: Work Through Checklists

Each guide contains actionable checklists:
- [ ] Infrastructure prerequisites
- [ ] DNS configuration
- [ ] Load balancer configuration
- [ ] Mirror registry setup (if disconnected)
- [ ] Trust bundle preparation
- [ ] Pull secret preparation
- [ ] Network CIDR planning

### Step 3: Customize Templates

Use provided templates as starting points:
- Replace `{{VARIABLE}}` markers with your values
- Adapt to your organization's naming conventions
- Adjust for your network topology

⚠️ **IMPORTANT:** Templates are EXAMPLES ONLY. Customize for your organization's requirements.

### Step 4: Validate

Run validation commands from each guide:
- DNS resolution tests
- Load balancer connectivity tests
- Mirror registry connectivity tests (if disconnected)
- Network reachability tests

### Step 5: Generate Configs

Use OpenShift Airgap Architect (this application) to generate:
- `install-config.yaml`
- `agent-config.yaml` (if using Agent-Based installer)
- Kubernetes manifests (if needed)
- oc-mirror configs (if disconnected)

---

## Integration with OpenShift Airgap Architect

These prep guides complement the main application:

1. **Use prep guides BEFORE generating configs** - Ensure infrastructure is ready
2. **Generate configs with OpenShift Airgap Architect** - Fill out scenario-specific forms
3. **Use validation commands to verify** - Confirm DNS, LB, registry are accessible
4. **Run openshift-install** - Deploy with confidence that prerequisites are met

**Application features:**
- Scenario selection (bare-metal-upi, vsphere-upi, aws-govcloud-upi, azure-government-upi)
- Parameter validation (CIDR ranges, domain names, IP addresses)
- YAML generation (install-config, agent-config, manifests)
- Field Guide (installation steps, prerequisites, troubleshooting)
- Disconnected deployment support (oc-mirror configs, trust bundles, pull secrets)

---

## Maintenance and Updates

**When to update these guides:**
- OpenShift version changes (currently based on 4.20)
- New load balancer technologies become common
- User feedback identifies missing prep tasks
- Infrastructure tooling changes (Terraform, CloudFormation, ARM)

**How to update:**
1. Update platform-specific prep guides
2. Update load balancer templates if syntax changes
3. Update DNS examples if new DNS technologies emerge
4. Keep template variable naming consistent (`{{VARIABLE}}` format)
5. Maintain customization warnings in all templates

---

## Related Documentation

### OpenShift Airgap Architect Docs

- [SCENARIOS_GUIDE.md](../SCENARIOS_GUIDE.md) - Overview of all supported scenarios
- [SCENARIOS_BARE_METAL_FAMILY.md](../SCENARIOS_BARE_METAL_FAMILY.md) - Bare Metal scenario details
- [SCENARIOS_VSPHERE_FAMILY.md](../SCENARIOS_VSPHERE_FAMILY.md) - vSphere scenario details
- [SCENARIOS_CLOUD_FAMILY.md](../SCENARIOS_CLOUD_FAMILY.md) - AWS/Azure scenario details
- [DISCONNECTED_SCENARIO_MATRIX.md](../DISCONNECTED_SCENARIO_MATRIX.md) - Disconnected deployment support
- [PLATFORM_NONE_SUPPORT_BOUNDARIES.md](../PLATFORM_NONE_SUPPORT_BOUNDARIES.md) - When to use platform: none

### Deep UPI Documentation

- [BARE_METAL_4_20_UPI_DOC_REVIEW_AND_PLAN.md](../BARE_METAL_4_20_UPI_DOC_REVIEW_AND_PLAN.md)
- [VSPHERE_4_20_UPI_DOC_REVIEW_AND_PLAN.md](../VSPHERE_4_20_UPI_DOC_REVIEW_AND_PLAN.md)
- Cloud family docs (AWS/Azure sections)

---

## Feedback and Contributions

**Found a gap or improvement?**
- Create an issue in the project repository
- Include your platform, scenario, and specific prep task
- Suggest template improvements or additional examples

**Template quality standards:**
- Use `{{VARIABLE}}` markers for all customizable values
- Include comments explaining each section
- Add customization warnings prominently
- Provide realistic example values in comments
- Ensure syntactic validity (for configs, scripts, templates)

---

**Version History:**
- **1.0** (2026-05-15): Initial release with 4 platform guides, load balancer templates, DNS examples
