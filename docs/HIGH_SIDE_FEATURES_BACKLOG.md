# High-Side Features Backlog

**Version:** 1.0  
**Created:** 2026-05-15  
**Status:** Planning / Requirements Gathering  
**Target:** v2.x (post-v1.2.0)

---

## Executive Summary

This document outlines proposed enhancements to the **high-side (disconnected) version** of OpenShift Airgap Architect to provide end-to-end deployment automation beyond current config generation capabilities.

**Current State:**
- Low-side (internet-facing) version: Generates install-config.yaml, agent-config.yaml, manifests, oc-mirror configs
- High-side (disconnected) bundle: Includes generated configs, downloadable binaries (openshift-install, oc, oc-mirror), runtime packages, operator catalog metadata
- User responsibility: Manual OpenShift installation using generated configs + Field Guide

**Proposed Enhancements:**
- Automated infrastructure services (DHCP/dnsmasq/iPXE for PXE boot)
- Actual OpenShift installation execution (run openshift-install for user)
- Automated mirror registry installation (deploy registry.redhat.io mirror)
- Multi-OS/architecture support considerations

**Complexity:** HIGH - Requires OS/architecture matrix support, persistent services, error handling, graceful degradation

---

## Feature 1: PXE Boot Services (DHCP/dnsmasq/iPXE)

### Overview

Provide automated PXE boot infrastructure for bare-metal UPI installations, eliminating manual DHCP/TFTP/HTTP server setup.

### Requirements

**Functionality:**
- [ ] Deploy dnsmasq service for DHCP + TFTP + DNS
- [ ] Host RHCOS kernel, initramfs, rootfs images via HTTP
- [ ] Generate PXE boot menu with ignition URL parameters
- [ ] Persist services outside app lifecycle (systemd units or containers)
- [ ] Provide start/stop/status controls in UI
- [ ] Auto-generate dnsmasq config based on user's network CIDR

**Supported Platforms:**
- Bare Metal UPI (primary use case)
- Bare Metal Agent-Based (optional, less common)
- vSphere UPI (low priority - VMs typically use template cloning)

**OS/Architecture Support:**

| OS | Architecture | Priority | Notes |
|---|---|---|---|
| RHEL 9 | x86_64 | P0 | Primary target |
| RHEL 8 | x86_64 | P1 | Legacy support |
| RHEL 9 | aarch64 | P2 | ARM servers |
| Ubuntu/Debian | x86_64 | P3 | Community request |

**User Experience:**

1. User navigates to **"High-Side Services"** tab (new)
2. **PXE Boot Services** card:
   - Enable/disable toggle
   - DHCP range configuration (e.g., `192.168.1.100-192.168.1.200`)
   - TFTP root directory (default: `/var/lib/tftpboot`)
   - HTTP root directory (default: `/var/www/html/rhcos`)
   - Status indicator (running / stopped / error)
3. Click **"Start PXE Services"**
4. App:
   - Validates network config (no IP conflicts, subnet matches machine network CIDR)
   - Generates dnsmasq.conf
   - Deploys dnsmasq as systemd service OR podman container
   - Downloads RHCOS images to HTTP root (if not already present)
   - Generates PXE boot menu with ignition URLs
5. User boots bare-metal nodes → automatic RHCOS installation

**Technical Implementation:**

```bash
# Example dnsmasq.conf generation
dhcp-range=192.168.1.100,192.168.1.200,24h
dhcp-boot=pxelinux.0

enable-tftp
tftp-root=/var/lib/tftpboot

# RHCOS boot config (generated)
default=rhcos-install
label rhcos-install
  kernel rhcos-live-kernel-x86_64
  append initrd=rhcos-live-initramfs.x86_64.img \
    coreos.live.rootfs_url=http://192.168.1.10:8080/rhcos-live-rootfs.x86_64.img \
    ignition.firstboot \
    ignition.platform.id=metal \
    ignition.config.url=http://192.168.1.10:8080/ignition/bootstrap.ign
```

**Deployment Options:**

**Option A: systemd service (requires root)**
```bash
# Install dnsmasq via dnf/yum
sudo dnf install dnsmasq

# Deploy config
sudo cp dnsmasq.conf /etc/dnsmasq.d/openshift.conf

# Start service
sudo systemctl start dnsmasq
sudo systemctl enable dnsmasq
```

**Option B: Podman container (rootless or rootful)**
```bash
# Run dnsmasq in container
podman run -d \
  --name openshift-pxe \
  --network host \
  -v /var/lib/tftpboot:/var/lib/tftpboot:Z \
  -v /var/www/html/rhcos:/var/www/html/rhcos:Z \
  quay.io/poseidon/dnsmasq \
  -d -q --conf-file=/etc/dnsmasq.conf
```

**Risks:**
- Requires root/sudo for systemd OR privileged container for network stack
- Network conflicts if existing DHCP server on same subnet
- Firewall rules (DHCP 67/68, TFTP 69, HTTP 8080)
- Persistence across reboots (systemd enable vs manual restart)

**Success Criteria:**
- [ ] Bare-metal node boots from PXE and fetches RHCOS
- [ ] Ignition file fetched from HTTP server
- [ ] Node joins cluster successfully
- [ ] Services survive host reboot
- [ ] UI shows service status (running / stopped / error)

**Alternatives:**
- Document manual PXE setup (current approach via UPI prep guides)
- Provide dnsmasq config template for copy/paste
- External tool integration (e.g., Foreman, Cobbler)

---

## Feature 2: Automated OpenShift Installation

### Overview

Execute `openshift-install` binary on behalf of the user, monitoring progress and handling errors gracefully.

### Requirements

**Functionality:**
- [ ] Run `openshift-install create cluster --dir=<install-dir> --log-level=info`
- [ ] Stream installation logs to UI in real-time
- [ ] Monitor bootstrap completion, CSR approval, installation completion
- [ ] Handle errors gracefully with actionable guidance
- [ ] Provide manual fallback if automated install fails

**Supported Scenarios:**

| Scenario | Install Method | Automated Install Feasible? | Notes |
|---|---|---|---|
| bare-metal-upi | UPI | ❌ Limited | Requires manual VM/hardware provisioning; app can only run `openshift-install` after infra ready |
| vsphere-upi | UPI | ❌ Limited | Requires manual VM provisioning; same limitation |
| aws-govcloud-upi | UPI | ❌ Limited | Requires manual AWS resource provisioning |
| azure-government-upi | UPI | ❌ Limited | Requires manual Azure resource provisioning |
| bare-metal-agent | Agent | ✅ **YES** | App has install-config + agent-config; can run agent-based installer |
| vsphere-agent | Agent | ✅ **YES** | Same as bare-metal-agent |
| bare-metal-ipi | IPI | ✅ **YES** | App has install-config with platform.baremetal; can run IPI installer |
| vsphere-ipi | IPI | ✅ **YES** | App has install-config with platform.vsphere; can run IPI installer |
| aws-govcloud-ipi | IPI | ⚠️ Partial | Requires AWS credentials; feasible if user provides credentials |
| azure-government-ipi | IPI | ⚠️ Partial | Requires Azure credentials; feasible if user provides credentials |
| nutanix-ipi | IPI | ⚠️ Partial | Requires Nutanix credentials; feasible if user provides credentials |
| ibm-cloud-ipi | IPI | ⚠️ Partial | Requires IBM Cloud credentials; feasible if user provides credentials |

**Key Insight:** Agent-Based and IPI scenarios are best candidates for automated installation. UPI scenarios require manual infrastructure provisioning first.

**User Experience:**

1. User completes wizard, generates configs
2. **New: "Run Installation" tab** appears (only for supported scenarios)
3. Tab shows:
   - Install-config.yaml preview
   - Agent-config.yaml preview (if agent-based)
   - Prerequisites checklist (e.g., "Infrastructure provisioned", "Ignition files hosted", "Load balancers configured")
   - **"Start Installation"** button (disabled until prerequisites checked)
4. User clicks **"Start Installation"**
5. App:
   - Validates prerequisites (DNS resolution, load balancer connectivity, etc.)
   - Runs `openshift-install create cluster --dir=./install --log-level=info`
   - Streams logs to UI
   - Monitors bootstrap completion
   - Auto-approves CSRs (optional toggle)
   - Monitors installation completion
6. **Success:** Shows `kubeconfig` download + cluster console URL
7. **Failure:** Shows error message + link to Field Guide troubleshooting section

**Technical Implementation:**

```javascript
// Backend API endpoint: POST /api/install/start
async function startInstallation(req, res) {
  const { installDir, scenarioId } = req.body;

  // Validate prerequisites
  const prereqs = await validatePrerequisites(scenarioId);
  if (!prereqs.valid) {
    return res.status(400).json({ error: prereqs.message });
  }

  // Start installation process
  const child = spawn('openshift-install', [
    'create', 'cluster',
    '--dir', installDir,
    '--log-level', 'info'
  ]);

  // Stream logs to client via SSE or WebSocket
  child.stdout.on('data', (data) => {
    emitLog(data.toString());
  });

  child.stderr.on('data', (data) => {
    emitLog(data.toString(), 'error');
  });

  child.on('close', (code) => {
    if (code === 0) {
      res.json({ success: true, kubeconfig: fs.readFileSync(`${installDir}/auth/kubeconfig`) });
    } else {
      res.json({ success: false, error: 'Installation failed', logs: capturedLogs });
    }
  });
}
```

**Error Handling:**

```
⚠️ Installation failed: Bootstrap timeout after 30 minutes

Possible causes:
- Load balancer not configured (API 6443, MCS 22623)
- DNS records not resolving (api.<cluster-name>.<base-domain>)
- Ignition files not accessible from nodes
- Firewall blocking required ports

Next steps:
1. Review installation logs above
2. Consult Field Guide: Bare Metal UPI Troubleshooting
3. Retry installation after fixing issues
4. OR proceed with manual installation using generated configs

[View Field Guide] [Retry Installation] [Download Logs]
```

**Risks:**
- Long-running process (30-60 minutes)
- User closes browser → installation continues but UI loses connection
- Installation failures require deep troubleshooting (app can't fix all errors)
- CSR approval automation could approve invalid CSRs (security risk)

**Success Criteria:**
- [ ] Installation completes successfully for Agent-Based scenario
- [ ] Installation completes successfully for IPI scenario
- [ ] Logs streamed to UI in real-time
- [ ] Errors presented with actionable guidance
- [ ] Kubeconfig downloadable after success
- [ ] Manual fallback available if automation fails

**Alternatives:**
- Document manual installation steps (current approach via Field Guide)
- Provide installation monitoring only (show logs, but user runs openshift-install)
- External tool integration (e.g., Ansible playbooks)

---

## Feature 3: Automated Mirror Registry Installation

### Overview

Deploy and configure a mirror registry (Quay or registry:2) on the high-side system, eliminating manual registry setup.

### Requirements

**Functionality:**
- [ ] Deploy mirror registry using `mirror-registry` binary (included in downloadable bundle)
- [ ] Configure TLS certificates (self-signed or user-provided)
- [ ] Initialize registry with oc-mirror-generated content
- [ ] Provide start/stop/status controls in UI
- [ ] Generate trust bundle for install-config.yaml
- [ ] Generate pull secret with registry credentials

**Registry Options:**

| Registry | Tool | Priority | Notes |
|---|---|---|---|
| mirror-registry (Quay-based) | `mirror-registry` binary | P0 | Red Hat recommended, includes in oc-mirror downloads |
| Docker registry:2 | Podman/Docker | P1 | Simpler, less features |
| Harbor | Helm chart | P3 | Enterprise features, complex setup |

**OS/Architecture Support:**

| OS | Architecture | Priority | Notes |
|---|---|---|---|
| RHEL 9 | x86_64 | P0 | Primary target |
| RHEL 8 | x86_64 | P1 | Legacy support |
| RHEL 9 | aarch64 | P2 | ARM servers (if mirror-registry supports) |

**User Experience:**

1. User navigates to **"High-Side Services"** tab
2. **Mirror Registry** card:
   - Enable/disable toggle
   - Registry hostname (default: `<high-side-ip>:5000`)
   - Storage path (default: `/var/lib/mirror-registry`)
   - TLS certificate (self-signed OR upload custom)
   - Status indicator (running / stopped / error)
3. Click **"Install Mirror Registry"**
4. App:
   - Validates storage path (sufficient disk space: ≥500 GB recommended)
   - Runs `mirror-registry install --quayHostname <hostname> --quayRoot <storage-path>`
   - Generates self-signed TLS certificate (or uses user-provided)
   - Starts registry service
   - Extracts CA certificate for trust bundle
   - Generates pull secret JSON with registry credentials
5. User clicks **"Initialize Registry Content"**
6. App:
   - Runs `oc-mirror disk-to-mirror --from=<disk-archive> --dest-registry=<hostname>:5000`
   - Monitors upload progress
   - Generates `imageContentSources` YAML for install-config

**Technical Implementation:**

```bash
# Install mirror registry
mirror-registry install \
  --quayHostname mirror.local:5000 \
  --quayRoot /var/lib/mirror-registry \
  --quayStorage /var/lib/mirror-registry/storage \
  --initPassword <generated-password>

# Extract CA certificate
cp /var/lib/mirror-registry/quay-rootCA/rootCA.pem ./mirror-ca.crt

# Generate pull secret
cat > pull-secret.json <<EOF
{
  "auths": {
    "mirror.local:5000": {
      "auth": "$(echo -n 'init:<password>' | base64)",
      "email": "admin@example.com"
    }
  }
}
EOF

# Upload oc-mirror content
oc-mirror disk-to-mirror \
  --from=/path/to/mirror-archive \
  --dest-registry=mirror.local:5000
```

**Storage Requirements:**

| Content | Size | Notes |
|---|---|---|
| OpenShift release images | ~10 GB | Per OCP version |
| Operator catalog metadata | ~5 GB | If operators included |
| Operator images | 50-200 GB | Varies by operator count |
| **Total recommended** | **≥500 GB** | For multiple OCP versions + operators |

**Risks:**
- Requires root/sudo for systemd service installation
- Large disk space requirement (500+ GB)
- Long upload time for disk-to-mirror (hours for full operator catalog)
- TLS certificate management (self-signed requires trust bundle distribution)
- Registry persistence across reboots

**Success Criteria:**
- [ ] Mirror registry installed and running
- [ ] oc-mirror content uploaded successfully
- [ ] Pull secret generated with registry credentials
- [ ] Trust bundle generated with CA certificate
- [ ] OpenShift installer can pull images from registry
- [ ] Services survive host reboot

**Alternatives:**
- Document manual registry setup (current approach via UPI prep guides)
- Provide registry installation script for copy/paste
- External registry (user provides existing registry)

---

## Feature 4: Multi-OS/Architecture Support Considerations

### Overview

Support high-side features across multiple operating systems and CPU architectures where feasible.

### OS Support Matrix

| OS | x86_64 | aarch64 | ppc64le | s390x | Priority | Notes |
|---|---|---|---|---|---|---|
| **RHEL 9** | ✅ | ✅ | ⚠️ | ⚠️ | P0 | Primary target for all features |
| **RHEL 8** | ✅ | ✅ | ⚠️ | ⚠️ | P1 | Legacy support until EOL 2029 |
| **Ubuntu 22.04** | ⚠️ | ⚠️ | ❌ | ❌ | P3 | Community request; low priority |
| **Fedora** | ⚠️ | ⚠️ | ❌ | ❌ | P3 | Testing/development only |

**Legend:**
- ✅ Supported - Full feature support
- ⚠️ Partial - Limited feature support (research required)
- ❌ Not Supported - Feature not feasible on this platform

### Feature-Specific OS Requirements

| Feature | RHEL 9/8 | Ubuntu | Notes |
|---|---|---|---|
| PXE Boot (dnsmasq) | ✅ | ⚠️ | dnsmasq available on both; config differs |
| OpenShift Install | ✅ | ✅ | openshift-install binary is statically linked |
| Mirror Registry | ✅ | ⚠️ | mirror-registry supports RHEL only; registry:2 works on Ubuntu |

### Architecture Constraints

**OpenShift 4.20 Platform Support:**

| Platform | x86_64 | aarch64 | ppc64le | s390x |
|---|---|---|---|---|
| Bare Metal | ✅ | ✅ | ✅ | ✅ |
| vSphere | ✅ | ✅ | ❌ | ❌ |
| AWS GovCloud | ✅ | ✅ | ❌ | ❌ |
| Azure Gov | ✅ | ❌ | ❌ | ❌ |
| Nutanix | ✅ | ❌ | ❌ | ❌ |
| IBM Cloud | ✅ | ❌ | ❌ | ❌ |

**Key Constraint:** High-side host architecture must match cluster architecture.

**Example:**
- If deploying OpenShift on **aarch64 bare-metal**, high-side host must be **aarch64 RHEL 9/8**
- If deploying OpenShift on **x86_64 vSphere**, high-side host must be **x86_64 RHEL 9/8**

### Implementation Strategy

**Phase 1: RHEL 9 x86_64 Only**
- Simplest path to MVP
- Covers 80% of use cases
- Reduces testing matrix

**Phase 2: Add RHEL 8 x86_64**
- Legacy support for organizations on RHEL 8
- Similar to RHEL 9 (RPM packaging, systemd)

**Phase 3: Add aarch64 (RHEL 9/8)**
- Growing ARM server adoption
- Same OS, different architecture

**Phase 4: Research Ubuntu/Debian (P3)**
- Community request
- Different package management (apt vs dnf)
- Lower priority

### Detection and Validation

**Automatically detect host OS/architecture:**

```bash
# Detect OS
if [ -f /etc/redhat-release ]; then
  OS="RHEL"
  VERSION=$(grep -oP '(?<=release )\d+' /etc/redhat-release)
elif [ -f /etc/lsb-release ]; then
  OS="Ubuntu"
  VERSION=$(grep -oP '(?<=DISTRIB_RELEASE=)\d+' /etc/lsb-release)
fi

# Detect architecture
ARCH=$(uname -m)

# Validate support
if [[ "$OS" == "RHEL" && "$VERSION" -ge 8 && "$ARCH" == "x86_64" ]]; then
  echo "Supported: RHEL $VERSION x86_64"
elif [[ "$OS" == "RHEL" && "$VERSION" -ge 9 && "$ARCH" == "aarch64" ]]; then
  echo "Supported: RHEL $VERSION aarch64"
else
  echo "Unsupported: $OS $VERSION $ARCH"
  echo "Recommended: RHEL 9 x86_64"
fi
```

**UI Indication:**

```
⚠️ Unsupported High-Side Host Detected

Current host: Ubuntu 22.04 x86_64
Supported:    RHEL 9 x86_64, RHEL 8 x86_64

Some high-side features may not work:
- Mirror registry installation (requires RHEL)
- PXE boot services (untested on Ubuntu)

Recommendation: Run high-side version on RHEL 9 x86_64 for full feature support.

[Continue Anyway] [View Requirements]
```

---

## Research Questions

### Open Questions (Require Research)

1. **mirror-registry binary OS support:**
   - Official Red Hat documentation states RHEL only
   - Does it work on Ubuntu/Debian with compatibility libraries?
   - What about aarch64 RHEL?

2. **openshift-install on non-RHEL:**
   - Binary is statically linked, should work on any Linux
   - Need to verify on Ubuntu, Fedora, Debian

3. **dnsmasq PXE boot on Ubuntu:**
   - Package available, but config file locations differ
   - Need to test PXE boot workflow on Ubuntu

4. **Container-based deployment (rootless Podman):**
   - Can dnsmasq run rootless with network stack access?
   - Can mirror-registry run in rootless Podman?
   - Performance implications?

5. **Persistence across reboots:**
   - systemd units vs user services vs containers
   - Best practice for high-side services?

### Feasibility Research

**Task:** Test each feature on RHEL 9 x86_64, RHEL 8 x86_64, Ubuntu 22.04 x86_64, RHEL 9 aarch64

**Deliverable:** Support matrix with confirmed working configurations

---

## Dependencies

### External Dependencies

| Dependency | Required For | Source | Notes |
|---|---|---|---|
| openshift-install | Automated install | Included in low-side bundle | Statically linked binary |
| oc-mirror | Registry upload | Included in low-side bundle | Statically linked binary |
| mirror-registry | Registry install | Included in low-side bundle | RHEL only |
| dnsmasq | PXE boot | System package (dnf/apt) | Must be installed on high-side |
| podman | Container deployment | System package (dnf/apt) | Optional alternative to systemd |

### Internal Dependencies

| Feature | Depends On | Notes |
|---|---|---|
| Automated install | Mirror registry (if disconnected) | Must have registry running before install |
| PXE boot | Ignition files generated | Must have install-config/agent-config first |
| Registry upload | oc-mirror disk-to-mirror | Must have mirror archive from low-side |

---

## Implementation Phases

### Phase 1: Research & Prototyping (2-4 weeks)
- [ ] Test mirror-registry on RHEL 9 x86_64
- [ ] Test dnsmasq PXE boot on RHEL 9 x86_64
- [ ] Test openshift-install automation (Agent-Based)
- [ ] Document OS/architecture support matrix
- [ ] Identify technical blockers

### Phase 2: MVP - RHEL 9 x86_64 Only (4-6 weeks)
- [ ] Implement mirror registry installation
- [ ] Implement PXE boot services
- [ ] Implement automated install (Agent-Based only)
- [ ] UI for high-side services tab
- [ ] Error handling and graceful degradation
- [ ] Documentation and Field Guide updates

### Phase 3: Expanded OS Support (4-6 weeks)
- [ ] Add RHEL 8 x86_64 support
- [ ] Add RHEL 9 aarch64 support (if feasible)
- [ ] Test Ubuntu compatibility (stretch goal)

### Phase 4: Advanced Features (8-12 weeks)
- [ ] Automated install for IPI scenarios (requires credential handling)
- [ ] CSR auto-approval (with safety checks)
- [ ] Installation monitoring dashboard
- [ ] Multi-cluster support

---

## Success Criteria

### MVP (Phase 2)

- [ ] User can install mirror registry on RHEL 9 x86_64 high-side host
- [ ] User can deploy PXE boot services for Bare Metal UPI
- [ ] User can run automated OpenShift install for Agent-Based scenario
- [ ] All services persist across reboots
- [ ] Errors provide actionable guidance
- [ ] Manual fallback available for all features

### Long-term (Phases 3-4)

- [ ] Support RHEL 8 and RHEL 9 (x86_64 + aarch64)
- [ ] Support IPI scenarios with credential handling
- [ ] Support multi-cluster deployments
- [ ] Comprehensive error recovery

---

## Risks and Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Requires root/sudo access | HIGH | Provide rootless Podman alternative OR clear documentation |
| OS/architecture fragmentation | HIGH | Focus on RHEL 9 x86_64 MVP, expand later |
| Long-running processes (install 30-60 min) | MEDIUM | WebSocket for real-time logs, resumable on disconnect |
| Installation failures hard to debug | HIGH | Provide detailed error messages + Field Guide links |
| Security risk (CSR auto-approval) | HIGH | Require explicit user opt-in, show CSR details before approval |
| Persistence across reboots | MEDIUM | Use systemd units with `enable` for auto-start |

---

## Next Steps

1. **Research Phase:**
   - Test mirror-registry on RHEL 9 x86_64
   - Test dnsmasq PXE boot workflow
   - Test openshift-install automation (Agent-Based scenario)
   - Document findings and update support matrix

2. **Design Phase:**
   - UI mockups for "High-Side Services" tab
   - API design for service management
   - Error handling strategy

3. **Prototype:**
   - Build mirror registry installation workflow
   - Build PXE boot service deployment
   - Build openshift-install automation for Agent-Based

4. **Feedback:**
   - User testing with Bare Metal Agent-Based scenario
   - Iterate based on feedback

---

## References

- OpenShift 4.20 Disconnected Environments: https://docs.redhat.com/en/documentation/openshift_container_platform/4.20/html/disconnected_environments/
- mirror-registry documentation: https://docs.redhat.com/en/documentation/openshift_container_platform/4.20/html/installing_a_private_registry/
- dnsmasq PXE boot: http://www.thekelleys.org.uk/dnsmasq/doc.html
- Agent-Based Installer: https://docs.redhat.com/en/documentation/openshift_container_platform/4.20/html/installing_an_on-premise_cluster_with_the_agent-based_installer/

---

**Status:** Documented, awaiting research and prioritization

