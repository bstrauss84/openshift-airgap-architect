# Bare Metal UPI Preparation Guide

**Platform:** Bare Metal  
**Install Method:** User-Provisioned Infrastructure (UPI)  
**OpenShift Version:** 4.20  
**Last Updated:** 2026-05-15

---

## Table of Contents

- [Overview](#overview)
- [Infrastructure Prerequisites Checklist](#infrastructure-prerequisites-checklist)
- [DNS Configuration Checklist](#dns-configuration-checklist)
- [Load Balancer Configuration Checklist](#load-balancer-configuration-checklist)
- [Mirror Registry Checklist (For Disconnected)](#mirror-registry-checklist-for-disconnected)
- [Trust Bundle Preparation](#trust-bundle-preparation)
- [Pull Secret Preparation](#pull-secret-preparation)
- [Network CIDR Planning](#network-cidr-planning)
- [RHCOS Boot Preparation](#rhcos-boot-preparation)
- [Ignition File Hosting](#ignition-file-hosting)
- [Validation Commands](#validation-commands)
- [Next Steps](#next-steps)

---

## Overview

Bare Metal UPI installations require manual provisioning of ALL infrastructure components before running the OpenShift installer. This includes:

- Physical or virtual hardware (bootstrap, control plane, worker nodes)
- External load balancers (API, Machine Config Server, Ingress)
- DNS records (api.*, api-int.*, *.apps.*)
- RHCOS boot mechanism (PXE, ISO, iPXE)
- Ignition file hosting (HTTPS server)
- Network configuration (DHCP or static IPs)
- Optional: Mirror registry for disconnected deployment

**Key characteristic:** `platform: none` in install-config.yaml (NO `platform.baremetal` block). The installer does NOT provision infrastructure—you do.

**Reference documentation:**
- OpenShift 4.20 Installing on bare metal: User-provisioned infrastructure  
  https://docs.redhat.com/en/documentation/openshift_container_platform/4.20/html/installing_on_bare_metal/user-provisioned-infrastructure
- Deep application documentation: `docs/BARE_METAL_4_20_UPI_DOC_REVIEW_AND_PLAN.md`

---

## Infrastructure Prerequisites Checklist

### Hardware Requirements

**Minimum cluster configuration:**

| Node Type | Count | CPU | RAM | Disk | Purpose |
|-----------|-------|-----|-----|------|---------|
| Bootstrap | 1 | 8 vCPU | 16 GB | 120 GB | Temporary node for cluster bootstrapping (removed after install) |
| Control Plane | 3 | 8 vCPU | 16 GB | 120 GB | etcd + control plane services |
| Worker (optional) | 2+ | 4 vCPU | 8 GB | 120 GB | Application workloads |

**Topology options:**
- **SNO (Single Node OpenShift):** 1 control plane, 0 workers (testing/edge only)
- **Compact cluster:** 3 control plane, 0 workers (control plane nodes also run workloads)
- **HA cluster:** 3 control plane, 2+ workers (production recommended)

**Additional requirements:**
- [ ] All nodes have network connectivity (same L2 network or routed)
- [ ] All nodes have assigned IP addresses (DHCP or static)
- [ ] Bootstrap node has internet access (or pre-staged RHCOS image)
- [ ] BMC access (IPMI, iLO, iDRAC) for physical servers (if using PXE boot)
- [ ] UEFI or BIOS boot capability

### Network Requirements

- [ ] **Bandwidth:** Minimum 1 Gbps network interface per node
- [ ] **Internet access (for connected deployments):** Nodes can reach quay.io, registry.redhat.io
- [ ] **Firewall rules:** Allow traffic between nodes on required ports (see table below)
- [ ] **Load balancer IPs reserved:** 1 IP for API/MCS, 1 IP for Ingress (or combined)
- [ ] **Mirror registry accessible (for disconnected):** Nodes can reach mirror registry on port 5000

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

## DNS Configuration Checklist

**Required DNS records:**

### A Records (or CNAME if using external DNS)

- [ ] **API endpoint (external):**  
  `api.<cluster-name>.<base-domain>` → `<load-balancer-ip-for-api>`  
  Example: `api.ocp.example.com` → `192.168.1.10`

- [ ] **API endpoint (internal):**  
  `api-int.<cluster-name>.<base-domain>` → `<load-balancer-ip-for-api>`  
  Example: `api-int.ocp.example.com` → `192.168.1.10`

- [ ] **Ingress wildcard:**  
  `*.apps.<cluster-name>.<base-domain>` → `<load-balancer-ip-for-ingress>`  
  Example: `*.apps.ocp.example.com` → `192.168.1.11`

### PTR Records (Optional but Recommended)

- [ ] Reverse DNS for all node IPs (improves troubleshooting)

### Validation

```bash
# Test DNS resolution
dig api.<cluster-name>.<base-domain>
dig api-int.<cluster-name>.<base-domain>
dig test.apps.<cluster-name>.<base-domain>

# Verify A records resolve to correct IPs
nslookup api.<cluster-name>.<base-domain>
nslookup test.apps.<cluster-name>.<base-domain>

# Verify reverse DNS (optional)
dig -x <node-ip>
```

**Expected results:**
- All records resolve to correct IP addresses
- No NXDOMAIN errors
- Wildcard ingress resolves for any subdomain under *.apps.<cluster-name>.<base-domain>

### DNS Templates

See `dns-examples/bind-zone-template.zone` for BIND zone file example.

---

## Load Balancer Configuration Checklist

Bare Metal UPI requires **external load balancers** for API, Machine Config Server (MCS), and Ingress traffic.

### Load Balancer Architecture

**Option 1: Separate load balancers (recommended for production):**
- Load balancer A: API (6443) + MCS (22623)
- Load balancer B: Ingress (80, 443)

**Option 2: Single load balancer (acceptable for non-production):**
- One load balancer handles all traffic

### Backend Pools

**API Load Balancer (TCP 6443):**
- [ ] **During installation:** Bootstrap node + Control plane nodes (3+)
- [ ] **After bootstrap complete:** Control plane nodes only (remove bootstrap)
- [ ] **Health check:** TCP 6443 or HTTPS GET /readyz

**Machine Config Server (TCP 22623):**
- [ ] **During installation:** Bootstrap node + Control plane nodes (3+)
- [ ] **After bootstrap complete:** Control plane nodes only (remove bootstrap)
- [ ] **Health check:** TCP 22623 (no HTTPS endpoint available)

**Ingress HTTP (TCP 80):**
- [ ] **Backends:** Worker nodes (or control plane nodes if no workers)
- [ ] **Health check:** TCP 80 or HTTP GET /healthz/ready

**Ingress HTTPS (TCP 443):**
- [ ] **Backends:** Worker nodes (or control plane nodes if no workers)
- [ ] **Health check:** TCP 443 or HTTPS GET /healthz/ready

### Example Configurations

**HAProxy:** See `load-balancer-examples/bare-metal-haproxy.cfg`

**nginx:** See `load-balancer-examples/bare-metal-nginx.conf`

### Post-Installation Task

⚠️ **CRITICAL:** After bootstrap completes (when openshift-install reports "Bootstrap complete"), remove bootstrap node from API and MCS load balancer backends.

```bash
# Monitor bootstrap progress
openshift-install wait-for bootstrap-complete --dir=<installation-directory> --log-level=info

# When "Bootstrap complete" appears, remove bootstrap from load balancer
# Update HAProxy/nginx config, remove bootstrap backends, reload config
```

---

## Mirror Registry Checklist (For Disconnected)

If deploying in a disconnected environment (no internet access), you must mirror OpenShift images to a local registry.

### Registry Requirements

- [ ] Mirror registry running with ≥100 GB storage (≥500 GB recommended for multiple OCP versions)
- [ ] Registry accessible from installation network (port 5000 or 443)
- [ ] Registry TLS certificate available (self-signed or CA-signed)
- [ ] Registry credentials created (username + password or token)

### oc-mirror Workflow (Required)

**See `docs/DISCONNECTED_SCENARIO_MATRIX.md` for comprehensive guidance.**

**High-level steps:**
1. **Connected environment:** Run `oc-mirror` to mirror images to disk
2. **Transfer:** Copy mirror archive to disconnected environment
3. **Disconnected environment:** Run `oc-mirror` disk-to-mirror upload
4. **Generate imageContentSources:** Use oc-mirror output for install-config.yaml

**Example oc-mirror v2 workflow:**

```bash
# Connected environment: mirror to disk
oc-mirror mirror-to-disk \
  --config=mirror-config.yaml \
  --dest-dir=/path/to/mirror-archive

# Transfer mirror-archive/ to disconnected environment

# Disconnected environment: upload to mirror registry
oc-mirror disk-to-mirror \
  --from=/path/to/mirror-archive \
  --dest-registry=mirror.registry.example.com:5000

# Output includes imageContentSources for install-config.yaml
```

### Checklist Items

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

If using self-signed certificates for mirror registry, proxy, or other services, you must create a trust bundle.

### Sources to Merge

- [ ] **Mirror registry CA certificate** (if using self-signed registry)
- [ ] **Proxy MITM CA certificate** (if using proxy with SSL inspection)
- [ ] **vCenter CA certificate** (NOT applicable to bare-metal, included here for cross-platform reference)

### Trust Bundle Assembly

```bash
# Extract mirror registry CA (example using podman)
podman exec <registry-container> cat /etc/pki/ca-trust/source/anchors/registry-ca.crt > mirror-ca.crt

# OR extract from OpenSSL connection
openssl s_client -connect mirror.registry.example.com:5000 -showcerts </dev/null 2>/dev/null | \
  openssl x509 -outform PEM > mirror-ca.crt

# If using proxy with MITM, obtain proxy CA certificate
# (Method varies by proxy vendor)

# Concatenate all CA certificates
cat mirror-ca.crt > trust-bundle.pem
cat proxy-ca.crt >> trust-bundle.pem

# Verify bundle contains all certificates
grep -c "BEGIN CERTIFICATE" trust-bundle.pem
# Should match number of certificates merged
```

### Use in install-config.yaml

```yaml
additionalTrustBundle: |
  -----BEGIN CERTIFICATE-----
  MIIDXTCCAkWgAwIBAgIJAKZ... (contents of trust-bundle.pem)
  -----END CERTIFICATE-----
  -----BEGIN CERTIFICATE-----
  MIIDYDCCAkigAwIBAgIBAD... (second certificate if multiple)
  -----END CERTIFICATE-----
```

**Formatting notes:**
- PEM format required (BEGIN/END CERTIFICATE markers)
- Proper indentation under `additionalTrustBundle:` key
- No extra whitespace or line breaks within certificate blocks

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
    "cloud.openshift.com": {
      "auth": "b3BlbnNo...",
      "email": "you@example.com"
    },
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

# Or use htpasswd (if installed)
htpasswd -Bbn username password | cut -d: -f2 | base64
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

Bare Metal UPI requires careful CIDR planning to avoid overlapping ranges.

### Required CIDRs

| CIDR | Purpose | Default | Notes |
|------|---------|---------|-------|
| **machineNetwork** | Node IP range | (your network) | MUST match your physical network CIDR |
| **clusterNetwork** | Pod IP range | 10.128.0.0/14 | Internal pod-to-pod traffic |
| **serviceNetwork** | Service IP range | 172.30.0.0/16 | Kubernetes services |

### Planning Worksheet

**Step 1: Identify your physical network CIDR**
- [ ] Physical network CIDR: `____________` (e.g., 192.168.1.0/24)
- [ ] Node IP range: `____________ to ____________`
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
- machineNetwork: 192.168.1.0/24 (node IPs)
- clusterNetwork: 10.128.0.0/14 (pods)
- serviceNetwork: 172.30.0.0/16 (services)

**Example INVALID configuration (overlap):**
- machineNetwork: 10.0.0.0/16
- clusterNetwork: 10.128.0.0/14  ← OVERLAP with machineNetwork (both in 10.0.0.0/8)

### Validation Commands

```bash
# Check for CIDR overlap (requires ipcalc or sipcalc)
ipcalc -c 192.168.1.0/24 10.128.0.0/14
# Should return: CIDR ranges do not overlap

# Or manual check using Python
python3 -c "
import ipaddress
machine = ipaddress.ip_network('192.168.1.0/24')
cluster = ipaddress.ip_network('10.128.0.0/14')
service = ipaddress.ip_network('172.30.0.0/16')
print('Overlaps:')
print('machine ∩ cluster:', machine.overlaps(cluster))
print('machine ∩ service:', machine.overlaps(service))
print('cluster ∩ service:', cluster.overlaps(service))
# All should print False
"
```

---

## RHCOS Boot Preparation

Bare Metal UPI requires manual RHCOS (Red Hat CoreOS) boot configuration.

### Boot Methods

**Option 1: PXE Boot (Recommended for multiple nodes)**
- [ ] PXE server configured (dnsmasq, ISC DHCP + TFTP)
- [ ] RHCOS kernel, initramfs, rootfs images downloaded
- [ ] PXE boot menu configured with ignition URL parameters

**Option 2: ISO Boot (Simpler for small clusters)**
- [ ] RHCOS ISO downloaded
- [ ] ISO burned to USB drives or mounted to BMC virtual media
- [ ] Boot each node from ISO, append ignition URL to kernel parameters

**Option 3: iPXE Boot (Advanced)**
- [ ] iPXE chain-loading configured
- [ ] RHCOS images hosted on HTTP server

### RHCOS Image Download

```bash
# Download RHCOS images for OpenShift 4.20
# (URLs from https://mirror.openshift.com/pub/openshift-v4/x86_64/dependencies/rhcos/)

RHCOS_VERSION="4.20"
BASE_URL="https://mirror.openshift.com/pub/openshift-v4/x86_64/dependencies/rhcos/${RHCOS_VERSION}/latest"

# For PXE boot
wget ${BASE_URL}/rhcos-live-kernel-x86_64
wget ${BASE_URL}/rhcos-live-initramfs.x86_64.img
wget ${BASE_URL}/rhcos-live-rootfs.x86_64.img

# For ISO boot
wget ${BASE_URL}/rhcos-live.x86_64.iso
```

### PXE Boot Example (dnsmasq)

```conf
# /etc/dnsmasq.d/pxe.conf
dhcp-range=192.168.1.100,192.168.1.200,24h
dhcp-boot=pxelinux.0

# Enable TFTP
enable-tftp
tftp-root=/var/lib/tftpboot
```

**PXE boot menu example (/var/lib/tftpboot/pxelinux.cfg/default):**

```
DEFAULT rhcos-install

LABEL rhcos-install
  KERNEL rhcos-live-kernel-x86_64
  APPEND initrd=rhcos-live-initramfs.x86_64.img coreos.live.rootfs_url=http://192.168.1.10:8080/rhcos-live-rootfs.x86_64.img ignition.firstboot ignition.platform.id=metal ignition.config.url=http://192.168.1.10:8080/ignition/bootstrap.ign
```

**Note:** Replace `http://192.168.1.10:8080` with your ignition file hosting server URL.

### ISO Boot Example

```bash
# Boot node from ISO
# At GRUB prompt, press 'e' to edit boot parameters
# Append to kernel line:
coreos.inst.install_dev=/dev/sda \
coreos.inst.ignition_url=http://192.168.1.10:8080/ignition/bootstrap.ign
```

---

## Ignition File Hosting

OpenShift generates ignition files (bootstrap.ign, master.ign, worker.ign) during installation. Nodes must fetch these files via HTTPS during boot.

### Requirements

- [ ] HTTPS web server (nginx, Apache, Python SimpleHTTPServer)
- [ ] Server accessible from node network
- [ ] Ignition files hosted at predictable URLs
- [ ] Self-signed certificate acceptable (RHCOS trusts ignition URLs by default)

### Example: nginx Ignition Server

```nginx
# /etc/nginx/conf.d/ignition.conf
server {
    listen 8080;
    server_name _;
    root /var/www/ignition;
    
    location / {
        autoindex on;
        types {
            application/json ign;
        }
    }
}
```

```bash
# Create ignition directory
mkdir -p /var/www/ignition

# Copy generated ignition files (after running openshift-install create ignition-configs)
cp <installation-directory>/bootstrap.ign /var/www/ignition/
cp <installation-directory>/master.ign /var/www/ignition/
cp <installation-directory>/worker.ign /var/www/ignition/

# Set permissions
chmod 644 /var/www/ignition/*.ign

# Restart nginx
systemctl restart nginx

# Test access
curl http://192.168.1.10:8080/ignition/bootstrap.ign
# Should return JSON ignition config
```

### Example: Python SimpleHTTPServer

```bash
# Navigate to directory containing ignition files
cd /var/www/ignition

# Start HTTP server
python3 -m http.server 8080

# Test access
curl http://192.168.1.10:8080/bootstrap.ign
```

---

## Validation Commands

Run these commands BEFORE running `openshift-install` to ensure prerequisites are met.

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

### Network Connectivity Validation

```bash
# Ping test between nodes (example)
ping -c 3 <control-plane-node-ip>

# Port connectivity test (requires nc/netcat)
nc -zv <control-plane-node-ip> 6443
nc -zv <control-plane-node-ip> 22623

# Firewall rule test (from node)
curl -k https://api.<cluster-name>.<base-domain>:6443
```

### Ignition File Hosting Validation

```bash
# Test ignition files are accessible
curl http://192.168.1.10:8080/ignition/bootstrap.ign | jq .ignition.version
# Should return: "3.2.0" or similar

curl http://192.168.1.10:8080/ignition/master.ign | jq .ignition.version
curl http://192.168.1.10:8080/ignition/worker.ign | jq .ignition.version
```

---

## Next Steps

After completing all checklists and validations:

1. **Generate install-config.yaml** using OpenShift Airgap Architect
   - Select: Bare Metal + UPI
   - Fill out all required fields
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

4. **Copy ignition files to hosting server** (see [Ignition File Hosting](#ignition-file-hosting))

5. **Boot nodes in order:**
   - Bootstrap node first (wait for bootstrap.ign fetch)
   - Control plane nodes (all 3 simultaneously)
   - Worker nodes (after control plane stabilizes)

6. **Monitor bootstrap progress**
   ```bash
   openshift-install wait-for bootstrap-complete --dir=ocp-install --log-level=info
   ```

7. **Remove bootstrap from load balancer** when "Bootstrap complete" appears

8. **Approve CSRs (Certificate Signing Requests)**
   ```bash
   export KUBECONFIG=ocp-install/auth/kubeconfig
   oc get csr
   oc adm certificate approve <csr-name>
   ```

9. **Wait for installation complete**
   ```bash
   openshift-install wait-for install-complete --dir=ocp-install --log-level=info
   ```

10. **Access cluster**
    ```bash
    export KUBECONFIG=ocp-install/auth/kubeconfig
    oc get nodes
    oc get co  # Check cluster operators
    ```

---

## Related Documentation

- **Application docs:**
  - [BARE_METAL_4_20_UPI_DOC_REVIEW_AND_PLAN.md](../BARE_METAL_4_20_UPI_DOC_REVIEW_AND_PLAN.md) - Deep technical review
  - [SCENARIOS_BARE_METAL_FAMILY.md](../SCENARIOS_BARE_METAL_FAMILY.md) - Scenario family overview
  - [DISCONNECTED_SCENARIO_MATRIX.md](../DISCONNECTED_SCENARIO_MATRIX.md) - Disconnected deployment support
  - [PLATFORM_NONE_SUPPORT_BOUNDARIES.md](../PLATFORM_NONE_SUPPORT_BOUNDARIES.md) - When to use platform: none

- **Templates:**
  - [HAProxy config](load-balancer-examples/bare-metal-haproxy.cfg)
  - [nginx config](load-balancer-examples/bare-metal-nginx.conf)
  - [BIND zone file](dns-examples/bind-zone-template.zone)

- **Red Hat official docs:**
  - OpenShift 4.20 Installing on bare metal: User-provisioned infrastructure  
    https://docs.redhat.com/en/documentation/openshift_container_platform/4.20/html/installing_on_bare_metal/user-provisioned-infrastructure

---

**Feedback:** If you find gaps in this guide or have suggestions, please create an issue in the project repository.
