# vSphere UPI Preparation Guide

**Platform:** VMware vSphere  
**Install Method:** User-Provisioned Infrastructure (UPI)  
**OpenShift Version:** 4.20  
**Last Updated:** 2026-05-15

---

## Table of Contents

- [Overview](#overview)
- [Infrastructure Prerequisites Checklist](#infrastructure-prerequisites-checklist)
- [vCenter Prerequisites and Permissions](#vcenter-prerequisites-and-permissions)
- [DNS Configuration Checklist](#dns-configuration-checklist)
- [Load Balancer Configuration Checklist](#load-balancer-configuration-checklist)
- [vSphere Resource Preparation](#vsphere-resource-preparation)
- [RHCOS OVA Template Preparation](#rhcos-ova-template-preparation)
- [VM Cloning and Provisioning](#vm-cloning-and-provisioning)
- [Mirror Registry Checklist (For Disconnected)](#mirror-registry-checklist-for-disconnected)
- [Trust Bundle Preparation](#trust-bundle-preparation)
- [Pull Secret Preparation](#pull-secret-preparation)
- [Network CIDR Planning](#network-cidr-planning)
- [Validation Commands](#validation-commands)
- [Next Steps](#next-steps)

---

## Overview

vSphere UPI installations require manual provisioning of virtual machines and supporting infrastructure before running the OpenShift installer. This includes:

- vCenter configuration (permissions, resource pools, folders, datastores)
- RHCOS OVA template uploaded to vSphere
- Manual VM cloning from OVA template (bootstrap, control plane, worker nodes)
- External load balancers (API, Machine Config Server, Ingress)
- DNS records (api.*, api-int.*, *.apps.*)
- Network configuration (port groups, VLANs)
- Optional: Mirror registry for disconnected deployment

**Key characteristic:** `platform.vsphere` block in install-config.yaml with vcenters + failureDomains topology. NO apiVIPs/ingressVIPs (those are IPI-only). User manually provisions VMs by cloning RHCOS OVA template.

**Reference documentation:**
- OpenShift 4.20 Installing on VMware vSphere: User-provisioned infrastructure  
  https://docs.redhat.com/en/documentation/openshift_container_platform/4.20/html/installing_on_vmware_vsphere/user-provisioned-infrastructure
- Deep application documentation: `docs/VSPHERE_4_20_UPI_DOC_REVIEW_AND_PLAN.md`

---

## Infrastructure Prerequisites Checklist

### Hardware Requirements (vSphere VMs)

**Minimum cluster configuration:**

| Node Type | Count | vCPU | RAM | Disk | Purpose |
|-----------|-------|------|-----|------|---------|
| Bootstrap | 1 | 8 vCPU | 16 GB | 120 GB | Temporary VM for cluster bootstrapping (removed after install) |
| Control Plane | 3 | 8 vCPU | 16 GB | 120 GB | etcd + control plane services |
| Worker (optional) | 2+ | 4 vCPU | 8 GB | 120 GB | Application workloads |

**Topology options:**
- **SNO (Single Node OpenShift):** 1 control plane, 0 workers (testing/edge only, uses `platform: none`)
- **Compact cluster:** 3 control plane, 0 workers (control plane nodes also run workloads)
- **HA cluster:** 3 control plane, 2+ workers (production recommended)

**Additional requirements:**
- [ ] All VMs on same vSphere cluster (or spread across failureDomains for multi-zone)
- [ ] All VMs connected to same port group (or routed networks)
- [ ] Static IPs assigned (DHCP or manual configuration)
- [ ] Internet access from VMs (for connected deployment) or mirror registry access (disconnected)
- [ ] Adequate vSphere resources (CPU, RAM, storage across all ESXi hosts)

### vSphere Requirements

- [ ] **vSphere version:** 7.0 Update 2 or later (OpenShift 4.20 requirement)
- [ ] **vCenter access:** Administrator@vsphere.local or equivalent privileges
- [ ] **ESXi hosts:** Time synchronized (NTP configured), adequate resources
- [ ] **Datastores:** ≥500 GB available per datastore (for cluster VMs)
- [ ] **Port groups:** Network connectivity configured (VLAN if required)
- [ ] **DRS:** Enabled on cluster (recommended for HA)
- [ ] **HA:** Enabled on cluster (recommended for production)

### Network Requirements

- [ ] **Bandwidth:** Minimum 1 Gbps network
- [ ] **Internet access (for connected deployments):** VMs can reach quay.io, registry.redhat.io
- [ ] **Firewall rules:** Allow traffic between VMs on required ports (see below)
- [ ] **Load balancer IPs reserved:** 1 IP for API/MCS, 1 IP for Ingress (or combined)
- [ ] **Mirror registry accessible (for disconnected):** VMs can reach mirror registry on port 5000

**Required port matrix:**

| Port | Protocol | Source | Destination | Purpose |
|------|----------|--------|-------------|---------|
| 6443 | TCP | External, nodes | Load balancer | Kubernetes API |
| 22623 | TCP | Nodes | Load balancer | Machine Config Server |
| 80 | TCP | External | Load balancer | HTTP ingress |
| 443 | TCP | External | Load balancer | HTTPS ingress |
| 9000-9999 | TCP | Nodes | Nodes | Host-level services |
| 10250-10259 | TCP | Nodes | Nodes | Kubelet, kube-scheduler, kube-controller-manager |
| 2379-2380 | TCP | Control plane | Control plane | etcd |
| 30000-32767 | TCP/UDP | Nodes | Nodes | NodePort services |

---

## vCenter Prerequisites and Permissions

### vCenter Account Requirements

**Required privileges for installation service account:**

- [ ] **Datastore:** Allocate space, Browse datastore, Low level file operations, Remove file, Update virtual machine files
- [ ] **Folder:** Create folder, Delete folder, Move folder, Rename folder
- [ ] **Network:** Assign network
- [ ] **Resource:** Assign virtual machine to resource pool
- [ ] **Virtual machine:**
  - Configuration: Add new disk, Add or remove device, Advanced configuration, Change CPU count, Change Memory, Change Settings, Change resource, Modify device settings, Remove disk, Rename, Reset guest information, Set annotation, Change resources (CPU, memory, etc.)
  - Interaction: Power on, Power off, Reset
  - Inventory: Create from existing, Create new, Move, Remove
  - Provisioning: Clone virtual machine, Clone template to virtual machine, Deploy template, Read customization specifications
  - Snapshot management: Create snapshot, Remove snapshot

**Account setup:**
```bash
# Create service account in vCenter
# (Via vSphere Client: Administration → Users and Groups → CREATE USER)

# Assign permissions to cluster/datacenter/folder
# (Via vSphere Client: select resource → Permissions → Add)
```

### vCenter Connectivity Validation

```bash
# Test vCenter API connectivity
curl -k https://<vcenter-fqdn>/ui
# Should return vSphere Client login page

# Test vCenter API authentication (requires PowerCLI or govc)
# Using govc (https://github.com/vmware/govmomi/tree/master/govc):
export GOVC_URL=https://<vcenter-fqdn>/sdk
export GOVC_USERNAME=administrator@vsphere.local
export GOVC_PASSWORD=<password>
export GOVC_INSECURE=true

govc about
# Should return vCenter version info
```

---

## DNS Configuration Checklist

**Required DNS records:**

### A Records (or CNAME if using external DNS)

- [ ] **API endpoint (external):**  
  `api.<cluster-name>.<base-domain>` → `<load-balancer-ip-for-api>`  
  Example: `api.ocp-vsphere.example.com` → `192.168.1.10`

- [ ] **API endpoint (internal):**  
  `api-int.<cluster-name>.<base-domain>` → `<load-balancer-ip-for-api>`  
  Example: `api-int.ocp-vsphere.example.com` → `192.168.1.10`

- [ ] **Ingress wildcard:**  
  `*.apps.<cluster-name>.<base-domain>` → `<load-balancer-ip-for-ingress>`  
  Example: `*.apps.ocp-vsphere.example.com` → `192.168.1.11`

### PTR Records (Optional but Recommended)

- [ ] Reverse DNS for all VM IPs (improves troubleshooting)

### Validation

```bash
# Test DNS resolution
dig api.<cluster-name>.<base-domain>
dig api-int.<cluster-name>.<base-domain>
dig test.apps.<cluster-name>.<base-domain>

# Verify A records resolve to correct IPs
nslookup api.<cluster-name>.<base-domain>
nslookup test.apps.<cluster-name>.<base-domain>
```

**Expected results:**
- All records resolve to correct IP addresses
- No NXDOMAIN errors
- Wildcard ingress resolves for any subdomain under *.apps.<cluster-name>.<base-domain>

### DNS Templates

See `dns-examples/bind-zone-template.zone` for BIND zone file example.

---

## Load Balancer Configuration Checklist

vSphere UPI requires **external load balancers** for API, Machine Config Server (MCS), and Ingress traffic.

**Note:** vSphere UPI does NOT use apiVIPs/ingressVIPs in install-config.yaml (those are IPI-only). Load balancer configuration is external.

### Load Balancer Architecture

**Option 1: Separate load balancers (recommended for production):**
- Load balancer A: API (6443) + MCS (22623)
- Load balancer B: Ingress (80, 443)

**Option 2: Single load balancer (acceptable for non-production):**
- One load balancer handles all traffic

### Backend Pools

**API Load Balancer (TCP 6443):**
- [ ] **During installation:** Bootstrap VM + Control plane VMs (3+)
- [ ] **After bootstrap complete:** Control plane VMs only (remove bootstrap)
- [ ] **Health check:** TCP 6443 or HTTPS GET /readyz

**Machine Config Server (TCP 22623):**
- [ ] **During installation:** Bootstrap VM + Control plane VMs (3+)
- [ ] **After bootstrap complete:** Control plane VMs only (remove bootstrap)
- [ ] **Health check:** TCP 22623 (no HTTPS endpoint available)

**Ingress HTTP (TCP 80):**
- [ ] **Backends:** Worker VMs (or control plane VMs if no workers)
- [ ] **Health check:** TCP 80 or HTTP GET /healthz/ready

**Ingress HTTPS (TCP 443):**
- [ ] **Backends:** Worker VMs (or control plane VMs if no workers)
- [ ] **Health check:** TCP 443 or HTTPS GET /healthz/ready

### Example Configurations

**HAProxy:** See `load-balancer-examples/bare-metal-haproxy.cfg` (applicable to vSphere UPI)

**nginx:** See `load-balancer-examples/bare-metal-nginx.conf` (applicable to vSphere UPI)

### Post-Installation Task

⚠️ **CRITICAL:** After bootstrap completes (when openshift-install reports "Bootstrap complete"), remove bootstrap VM from API and MCS load balancer backends.

```bash
# Monitor bootstrap progress
openshift-install wait-for bootstrap-complete --dir=<installation-directory> --log-level=info

# When "Bootstrap complete" appears, remove bootstrap from load balancer
# Update HAProxy/nginx config, remove bootstrap backends, reload config
```

---

## vSphere Resource Preparation

### Datacenter/Cluster Structure

**Identify target vSphere resources:**

- [ ] **Datacenter:** Name of target datacenter (e.g., `dc1`)
- [ ] **Cluster:** Name of target compute cluster (e.g., `cluster1`)
- [ ] **Datastore:** Name of target datastore (e.g., `datastore1`)
- [ ] **Network (port group):** Name of VM network port group (e.g., `VM Network`)

**Multiple datacenters (failureDomains):**

If deploying across multiple vSphere availability zones, define failureDomains:

| Failure Domain | Region | Zone | Server (vCenter) | Cluster | Datacenter | Datastore | Network |
|----------------|--------|------|------------------|---------|------------|-----------|---------|
| fd-zone-a | us-west | zone-a | vcenter.example.com | cluster1 | dc1 | datastore1 | VM Network |
| fd-zone-b | us-west | zone-b | vcenter.example.com | cluster2 | dc1 | datastore2 | VM Network |

**Validation:**

```bash
# Using govc to list datacenters
govc ls /

# List clusters
govc ls /dc1/host

# List datastores
govc ls /dc1/datastore

# List networks
govc ls /dc1/network
```

### Folder and Resource Pool (Optional)

**Create OpenShift-specific folder (recommended):**

```bash
# Using govc
govc folder.create /dc1/vm/ocp-cluster

# Or via vSphere Client:
# Right-click Datacenter → New Folder → New VM and Template Folder
```

**Create resource pool (optional):**

```bash
# Using govc
govc pool.create /dc1/host/cluster1/Resources/ocp-cluster

# Or via vSphere Client:
# Right-click Cluster → New Resource Pool
```

**Permissions:**

Ensure service account has permissions on folder/resource pool if used.

---

## RHCOS OVA Template Preparation

vSphere UPI requires a RHCOS (Red Hat Enterprise Linux CoreOS) OVA template. VMs are cloned from this template.

### Download RHCOS OVA

```bash
# Download RHCOS OVA for OpenShift 4.20
# (URLs from https://mirror.openshift.com/pub/openshift-v4/x86_64/dependencies/rhcos/)

RHCOS_VERSION="4.20"
BASE_URL="https://mirror.openshift.com/pub/openshift-v4/x86_64/dependencies/rhcos/${RHCOS_VERSION}/latest"

wget ${BASE_URL}/rhcos-vmware.x86_64.ova
```

### Upload OVA to vSphere

**Using govc:**

```bash
# Import OVA as VM template
govc import.ova \
  -dc=dc1 \
  -ds=datastore1 \
  -pool=/dc1/host/cluster1/Resources \
  -name=rhcos-4.20-template \
  rhcos-vmware.x86_64.ova

# Convert VM to template
govc vm.markastemplate rhcos-4.20-template
```

**Using vSphere Client:**

1. Right-click datacenter or cluster → Deploy OVF Template
2. Select local file: `rhcos-vmware.x86_64.ova`
3. Choose name: `rhcos-4.20-template`
4. Select compute resource (cluster)
5. Review details → Next
6. Select storage (datastore)
7. Select network (port group)
8. Finish deployment
9. Right-click VM → Template → Convert to Template

### Verify Template

```bash
# List templates
govc ls /dc1/vm | grep template

# Should return:
# /dc1/vm/rhcos-4.20-template
```

---

## VM Cloning and Provisioning

After uploading RHCOS OVA template, manually clone VMs for bootstrap, control plane, and workers.

### VM Specifications

**Bootstrap VM:**
- Name: `<cluster-name>-bootstrap`
- vCPU: 8
- RAM: 16 GB
- Disk: 120 GB (thin provisioned or thick)
- Network: Same port group as other nodes

**Control Plane VMs (3+):**
- Names: `<cluster-name>-control-plane-0`, `<cluster-name>-control-plane-1`, `<cluster-name>-control-plane-2`
- vCPU: 8
- RAM: 16 GB
- Disk: 120 GB each
- Network: Same port group

**Worker VMs (2+, optional):**
- Names: `<cluster-name>-worker-0`, `<cluster-name>-worker-1`
- vCPU: 4 (minimum)
- RAM: 8 GB (minimum)
- Disk: 120 GB each
- Network: Same port group

### Manual Cloning Process

**Using govc:**

```bash
# Clone bootstrap VM from template
govc vm.clone \
  -dc=dc1 \
  -ds=datastore1 \
  -pool=/dc1/host/cluster1/Resources \
  -vm=rhcos-4.20-template \
  -on=false \
  ocp-bootstrap

# Customize VM resources
govc vm.change -vm=ocp-bootstrap -c=8 -m=16384

# Clone control plane VMs
for i in {0..2}; do
  govc vm.clone \
    -dc=dc1 \
    -ds=datastore1 \
    -pool=/dc1/host/cluster1/Resources \
    -vm=rhcos-4.20-template \
    -on=false \
    ocp-control-plane-$i
  govc vm.change -vm=ocp-control-plane-$i -c=8 -m=16384
done

# Clone worker VMs
for i in {0..1}; do
  govc vm.clone \
    -dc=dc1 \
    -ds=datastore1 \
    -pool=/dc1/host/cluster1/Resources \
    -vm=rhcos-4.20-template \
    -on=false \
    ocp-worker-$i
  govc vm.change -vm=ocp-worker-$i -c=4 -m=8192
done
```

**Using vSphere Client:**

1. Right-click RHCOS template → Clone → Clone to Virtual Machine
2. Enter VM name (e.g., `ocp-bootstrap`)
3. Select compute resource
4. Select datastore
5. Customize hardware:
   - CPU: 8 vCPU
   - Memory: 16 GB
   - Disk: 120 GB (thin or thick)
6. Complete wizard
7. Repeat for all control plane and worker VMs

### Network Configuration

**Option 1: DHCP (recommended for simplicity):**
- Configure DHCP server with reservations for each VM MAC address
- Assign static IPs via DHCP reservations

**Option 2: Static IPs:**
- Boot VMs with ignition configs containing networkd configuration
- Or configure static IPs post-boot via console

**MAC address extraction (for DHCP reservations):**

```bash
# Get VM MAC address
govc vm.info -json ocp-bootstrap | jq -r '.VirtualMachines[].Config.Hardware.Device[] | select(.MacAddress) | .MacAddress'
```

---

## Mirror Registry Checklist (For Disconnected)

If deploying in a disconnected environment (no internet access from VMs), you must mirror OpenShift images to a local registry.

### Registry Requirements

- [ ] Mirror registry running with ≥100 GB storage (≥500 GB recommended for multiple OCP versions)
- [ ] Registry accessible from vSphere VMs (port 5000 or 443)
- [ ] Registry TLS certificate available (self-signed or CA-signed)
- [ ] Registry credentials created (username + password or token)

### oc-mirror Workflow (Required)

**See `docs/DISCONNECTED_SCENARIO_MATRIX.md` for comprehensive guidance.**

**High-level steps:**
1. **Connected environment:** Run `oc-mirror` to mirror images to disk
2. **Transfer:** Copy mirror archive to disconnected environment
3. **Disconnected environment:** Run `oc-mirror` disk-to-mirror upload
4. **Generate imageContentSources:** Use oc-mirror output for install-config.yaml

**Checklist items:**

- [ ] oc-mirror v2 installed on connected workstation
- [ ] ImageSetConfiguration created (defines OCP version, operators, additional images)
- [ ] Mirror-to-disk completed successfully
- [ ] Archive transferred to disconnected environment
- [ ] Disk-to-mirror upload completed
- [ ] imageContentSources or imageDigestSources generated
- [ ] Mirror registry CA certificate extracted (if self-signed)

**Verification:**

```bash
# Test registry connectivity
curl -k https://mirror.registry.example.com:5000/v2/_catalog

# Should return:
# {"repositories":["openshift/release-images", ...]}

# Verify specific image exists
curl -k https://mirror.registry.example.com:5000/v2/openshift/release-images/tags/list
```

---

## Trust Bundle Preparation

If using self-signed certificates for mirror registry, vCenter, or proxy, you must create a trust bundle.

### Sources to Merge

- [ ] **vCenter CA certificate** (if vCenter uses self-signed certificate)
- [ ] **Mirror registry CA certificate** (if using self-signed registry)
- [ ] **Proxy MITM CA certificate** (if using proxy with SSL inspection)

### Trust Bundle Assembly

**Extract vCenter CA certificate:**

```bash
# Method 1: Via web browser
# Navigate to https://<vcenter-fqdn>, view certificate, export as PEM

# Method 2: Via OpenSSL
openssl s_client -connect <vcenter-fqdn>:443 -showcerts </dev/null 2>/dev/null | \
  openssl x509 -outform PEM > vcenter-ca.crt

# Verify certificate
openssl x509 -in vcenter-ca.crt -text -noout
```

**Extract mirror registry CA certificate:**

```bash
# Extract from registry container
podman exec <registry-container> cat /etc/pki/ca-trust/source/anchors/registry-ca.crt > mirror-ca.crt

# OR extract via OpenSSL
openssl s_client -connect mirror.registry.example.com:5000 -showcerts </dev/null 2>/dev/null | \
  openssl x509 -outform PEM > mirror-ca.crt
```

**Concatenate all CA certificates:**

```bash
cat vcenter-ca.crt > trust-bundle.pem
cat mirror-ca.crt >> trust-bundle.pem

# If using proxy:
cat proxy-ca.crt >> trust-bundle.pem

# Verify bundle contains all certificates
grep -c "BEGIN CERTIFICATE" trust-bundle.pem
# Should match number of certificates merged
```

### Use in install-config.yaml

```yaml
additionalTrustBundle: |
  -----BEGIN CERTIFICATE-----
  MIIDXTCCAkWgAwIBAgIJAKZ... (vCenter CA)
  -----END CERTIFICATE-----
  -----BEGIN CERTIFICATE-----
  MIIDYDCCAkigAwIBAgIBAD... (Mirror registry CA)
  -----END CERTIFICATE-----
```

---

## Pull Secret Preparation

### For Connected Deployments

Download Red Hat pull secret from:  
https://console.redhat.com/openshift/install/pull-secret

### For Disconnected Deployments

Merge Red Hat pull secret + mirror registry credentials:

```bash
# Example: Red Hat pull secret
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
      "auth": "dXNlcm5hbWU6cGFzc3dvcmQ=",
      "email": "admin@example.com"
    }
  }
}
```

**Generate mirror registry auth:**

```bash
# Create base64-encoded username:password
echo -n 'username:password' | base64
# Output: dXNlcm5hbWU6cGFzc3dvcmQ=
```

**Validation:**

```bash
# Test pull secret auth against mirror registry
podman login mirror.registry.example.com:5000 \
  --authfile=merged-pull-secret.json

# Should succeed without errors
```

---

## Network CIDR Planning

vSphere UPI requires careful CIDR planning to avoid overlapping ranges.

### Required CIDRs

| CIDR | Purpose | Default | Notes |
|------|---------|---------|-------|
| **machineNetwork** | VM IP range | (your network) | MUST match your vSphere port group network CIDR |
| **clusterNetwork** | Pod IP range | 10.128.0.0/14 | Internal pod-to-pod traffic |
| **serviceNetwork** | Service IP range | 172.30.0.0/16 | Kubernetes services |

### Planning Worksheet

**Step 1: Identify your vSphere network CIDR**
- [ ] vSphere port group network CIDR: `____________` (e.g., 192.168.100.0/24)
- [ ] VM IP range: `____________ to ____________`
- [ ] Load balancer IP(s): `____________`

**Step 2: Choose cluster network CIDR (pods)**
- [ ] Cluster network CIDR: `____________` (default: 10.128.0.0/14)
- [ ] Host prefix: `____________` (default: /23, provides ~512 IPs per node)

**Step 3: Choose service network CIDR**
- [ ] Service network CIDR: `____________` (default: 172.30.0.0/16)

### Validation Rules

**MUST NOT overlap:**
- machineNetwork ∩ clusterNetwork = ∅
- machineNetwork ∩ serviceNetwork = ∅
- clusterNetwork ∩ serviceNetwork = ∅

**Example valid configuration:**
- machineNetwork: 192.168.100.0/24 (VM IPs)
- clusterNetwork: 10.128.0.0/14 (pods)
- serviceNetwork: 172.30.0.0/16 (services)

---

## Validation Commands

Run these commands BEFORE generating ignition configs to ensure prerequisites are met.

### DNS Validation

```bash
# Verify DNS resolution
dig api.<cluster-name>.<base-domain>
dig api-int.<cluster-name>.<base-domain>
dig test.apps.<cluster-name>.<base-domain>

# Check DNS returns correct IPs
nslookup api.<cluster-name>.<base-domain>
# Should return load balancer IP

# Verify wildcard ingress works
dig random-subdomain.apps.<cluster-name>.<base-domain>
# Should return ingress load balancer IP
```

### vCenter Connectivity Validation

```bash
# Test vCenter API connectivity
govc about

# List target datacenter
govc ls /

# List target cluster
govc ls /dc1/host

# List target datastore
govc ls /dc1/datastore

# Verify RHCOS template exists
govc vm.info rhcos-4.20-template
```

### Load Balancer Validation

```bash
# Test API load balancer (before cluster exists, should timeout or refuse)
curl -k https://api.<cluster-name>.<base-domain>:6443/healthz
# Expected: Connection refused (no backends yet) or timeout (LB not ready)
# NOT expected: DNS resolution error

# Test MCS load balancer
curl -k https://api.<cluster-name>.<base-domain>:22623/healthz
# Expected: Connection refused or timeout

# Test ingress load balancer
curl -k http://<cluster-name>.<base-domain>
# Expected: Connection refused or 503 (no backends yet)
```

### Mirror Registry Validation (For Disconnected)

```bash
# Test registry connectivity
curl -k https://mirror.registry.example.com:5000/v2/_catalog

# Should return:
# {"repositories":["openshift/release-images", ...]}

# Test authentication
podman login mirror.registry.example.com:5000 --authfile=pull-secret.json
# Should succeed without errors

# Verify specific image exists
skopeo inspect --authfile=pull-secret.json docker://mirror.registry.example.com:5000/openshift/release-images:4.20.0-x86_64
```

### Trust Bundle Validation

```bash
# Verify vCenter certificate in trust bundle
openssl verify -CAfile trust-bundle.pem vcenter-ca.crt
# Should return: vcenter-ca.crt: OK

# Verify mirror registry certificate
openssl verify -CAfile trust-bundle.pem mirror-ca.crt
# Should return: mirror-ca.crt: OK
```

---

## Next Steps

After completing all checklists and validations:

1. **Generate install-config.yaml** using OpenShift Airgap Architect
   - Select: vSphere + UPI
   - Fill out all required fields (vcenters, failureDomains, network CIDRs)
   - Download install-config.yaml

2. **Create installation directory**
   ```bash
   mkdir ocp-install
   cp install-config.yaml ocp-install/
   ```

3. **Generate ignition configs**
   ```bash
   openshift-install create ignition-configs --dir=ocp-install
   # Generates: bootstrap.ign, master.ign, worker.ign
   ```

4. **Encode ignition configs to base64 (for vApp properties)**
   ```bash
   base64 -w0 ocp-install/bootstrap.ign > bootstrap.64
   base64 -w0 ocp-install/master.ign > master.64
   base64 -w0 ocp-install/worker.ign > worker.64
   ```

5. **Set ignition data in VM vApp properties**

   **Using govc:**
   ```bash
   # Set bootstrap ignition
   govc vm.change -vm=ocp-bootstrap \
     -e="guestinfo.ignition.config.data=$(cat bootstrap.64)" \
     -e="guestinfo.ignition.config.data.encoding=base64"

   # Set control plane ignition (repeat for each control plane VM)
   govc vm.change -vm=ocp-control-plane-0 \
     -e="guestinfo.ignition.config.data=$(cat master.64)" \
     -e="guestinfo.ignition.config.data.encoding=base64"

   # Set worker ignition (repeat for each worker VM)
   govc vm.change -vm=ocp-worker-0 \
     -e="guestinfo.ignition.config.data=$(cat worker.64)" \
     -e="guestinfo.ignition.config.data.encoding=base64"
   ```

   **Using vSphere Client:**
   - Right-click VM → Edit Settings → VM Options → Advanced → Configuration Parameters
   - Add: `guestinfo.ignition.config.data` = `<base64-encoded-ignition>`
   - Add: `guestinfo.ignition.config.data.encoding` = `base64`

6. **Power on VMs in order:**
   ```bash
   # Power on bootstrap first
   govc vm.power -on ocp-bootstrap

   # Wait 2-3 minutes, then power on control plane nodes
   govc vm.power -on ocp-control-plane-0
   govc vm.power -on ocp-control-plane-1
   govc vm.power -on ocp-control-plane-2

   # Wait for control plane to stabilize (10-15 minutes), then power on workers
   govc vm.power -on ocp-worker-0
   govc vm.power -on ocp-worker-1
   ```

7. **Monitor bootstrap progress**
   ```bash
   openshift-install wait-for bootstrap-complete --dir=ocp-install --log-level=info
   ```

8. **Remove bootstrap from load balancer** when "Bootstrap complete" appears

9. **Power off and delete bootstrap VM**
   ```bash
   govc vm.power -off ocp-bootstrap
   govc vm.destroy ocp-bootstrap
   ```

10. **Approve CSRs (Certificate Signing Requests)**
    ```bash
    export KUBECONFIG=ocp-install/auth/kubeconfig
    oc get csr
    oc adm certificate approve <csr-name>
    
    # Or approve all pending CSRs:
    oc get csr -o name | xargs oc adm certificate approve
    ```

11. **Wait for installation complete**
    ```bash
    openshift-install wait-for install-complete --dir=ocp-install --log-level=info
    ```

12. **Access cluster**
    ```bash
    export KUBECONFIG=ocp-install/auth/kubeconfig
    oc get nodes
    oc get co  # Check cluster operators
    ```

---

## Related Documentation

- **Application docs:**
  - [VSPHERE_4_20_UPI_DOC_REVIEW_AND_PLAN.md](../VSPHERE_4_20_UPI_DOC_REVIEW_AND_PLAN.md) - Deep technical review
  - [SCENARIOS_VSPHERE_FAMILY.md](../SCENARIOS_VSPHERE_FAMILY.md) - Scenario family overview
  - [DISCONNECTED_SCENARIO_MATRIX.md](../DISCONNECTED_SCENARIO_MATRIX.md) - Disconnected deployment support
  - [PLATFORM_NONE_SUPPORT_BOUNDARIES.md](../PLATFORM_NONE_SUPPORT_BOUNDARIES.md) - When to use platform: none (vSphere Agent SNO only)

- **Templates:**
  - [HAProxy config](load-balancer-examples/bare-metal-haproxy.cfg) - Applicable to vSphere UPI
  - [nginx config](load-balancer-examples/bare-metal-nginx.conf) - Applicable to vSphere UPI
  - [BIND zone file](dns-examples/bind-zone-template.zone)

- **Red Hat official docs:**
  - OpenShift 4.20 Installing on VMware vSphere: User-provisioned infrastructure  
    https://docs.redhat.com/en/documentation/openshift_container_platform/4.20/html/installing_on_vmware_vsphere/user-provisioned-infrastructure

---

**Feedback:** If you find gaps in this guide or have suggestions, please create an issue in the project repository.
