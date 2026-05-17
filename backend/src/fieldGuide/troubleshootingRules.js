/**
 * Troubleshooting Rule Engine for Field Guide
 *
 * Detects risky configurations and injects relevant troubleshooting guidance
 * based on the specific combination of features enabled by the user.
 *
 * Rules fire when specific conditions are met (e.g., proxy + FIPS + trust bundle)
 * and add targeted troubleshooting sections to the Field Guide.
 *
 * @author Bill Strauss
 *
 * Developed with AI assistance from Claude (Anthropic) and Cursor AI.
 */

/**
 * Get troubleshooting rules for the current configuration
 *
 * @param {Object} context - Field Guide context object (from context.js)
 * @returns {Array} Array of troubleshooting rule objects
 */
export const getTroubleshootingRules = (context) => {
  const rules = [];

  // Rule 1: Proxy + FIPS + custom trust bundle = complex certificate chain
  if (context.proxyEnabled && context.fips && context.trustBundleProvided) {
    rules.push({
      id: "proxy-fips-trust-bundle",
      severity: "warning",
      title: "Complex Certificate Chain (Proxy + FIPS + Custom Trust)",
      guidance: `
Your configuration combines:
- **Proxy:** Requires proxy CA trust
- **FIPS mode:** Strict certificate validation
- **Custom trust bundle:** Additional CA certificates

**Common failure:** Bootstrap fails with TLS handshake errors.

**Troubleshooting steps:**

1. **Verify trust bundle includes ALL certificates:**
   - Proxy CA certificate
   - Mirror registry CA certificate
   - Any intermediate CAs

   \`\`\`bash
   # Test certificate chain (replace <proxy-host> and <port> with your values):
   openssl s_client -connect <proxy-host>:<port> -CAfile trust-bundle.pem
   # Look for "Verify return code: 0 (ok)"
   \`\`\`

2. **Check FIPS-compliant ciphers:**
   Proxy must support TLS 1.2+ with FIPS-approved ciphers (AES-GCM, SHA-256/384).

   \`\`\`bash
   # Test FIPS cipher support (replace <proxy-host> and <port>):
   openssl s_client -connect <proxy-host>:<port> -cipher 'FIPS' -tls1_2
   \`\`\`

3. **Review bootstrap logs for TLS errors:**
   \`\`\`bash
   journalctl -u bootkube.service | grep -i 'tls\\|certificate\\|x509'
   journalctl -u kubelet.service | grep -i 'tls\\|certificate'
   \`\`\`

4. **Common mistakes:**
   - Trust bundle missing intermediate CA (chain incomplete)
   - Proxy CA certificate expired or not yet valid
   - Trust bundle in wrong format (must be PEM-encoded, concatenated)
   - Proxy using self-signed cert without CA in bundle

**Fix:** Rebuild trust bundle with all CAs and ensure valid PEM format.
      `
    });
  }

  // Rule 2: Disconnected + no NTP servers = clock drift failures
  if (context.connectivity === "disconnected" && (!context.ntpServers || context.ntpServers.length === 0)) {
    rules.push({
      id: "disconnected-no-ntp",
      severity: "error",
      title: "No NTP Servers in Disconnected Environment",
      guidance: `
**Critical:** Disconnected clusters require NTP for time synchronization.

**Failure modes:**
- etcd quorum fails due to clock drift (>500ms skew between nodes)
- Certificate validation fails (time skew causes "certificate not yet valid" or "expired")
- Operators fail to reconcile (time-based triggers don't fire)
- Cluster authentication breaks (token expiry issues)

**Required action:**

1. **Configure internal NTP servers:**
   Add at least 2 internal NTP servers to Global Strategy → Trust & Proxy step.

   Example NTP servers:
   - \`ntp.corp.local\` (primary)
   - \`ntp2.corp.local\` (secondary)

2. **Verify NTP server reachability from cluster nodes:**
   \`\`\`bash
   # From each node (or via agent-config.yaml pre-install):
   chronyc sources -v
   # Should show configured NTP servers with "^*" (selected) or "^+" (candidate)
   \`\`\`

3. **Check clock synchronization status:**
   \`\`\`bash
   timedatectl status
   # Look for "System clock synchronized: yes"

   chronyc tracking
   # Look for "Last offset" < 0.1 seconds
   \`\`\`

4. **If NTP servers are not reachable:**
   - Check firewall rules (NTP uses UDP port 123)
   - Verify DNS resolution for NTP server hostnames
   - Test NTP query: \`ntpdate -q <ntp-server-hostname>\`

**Post-install verification:**
\`\`\`bash
# Check chrony MachineConfig:
oc get mc | grep chrony

# Verify chrony running on nodes:
oc debug node/<node-name>
chroot /host
systemctl status chronyd
\`\`\`

**Note:** Without NTP, cluster may appear to install but will fail within hours due to time drift.
      `
    });
  }

  // Rule 3: vSphere + disconnected + IPI = vCenter API requirement
  if (context.platform === "VMware vSphere" && context.methodology === "IPI" && context.connectivity === "disconnected") {
    rules.push({
      id: "vsphere-ipi-disconnected",
      severity: "info",
      title: "vSphere IPI in Disconnected Environment",
      guidance: `
**Note:** vSphere IPI requires vCenter API reachability during installation.

**If bootstrap node cannot reach vCenter API:**
- IPI will fail during VM clone operations
- Consider switching to **Agent-Based Installer** (no vCenter API calls required)

**If vCenter itself has no internet but bootstrap can reach vCenter:**
- IPI will work (vCenter internet access not required, only bootstrap → vCenter connectivity)

**Network topology check:**

1. **Test vCenter API reachability from bootstrap network:**
   \`\`\`bash
   curl -k https://<vcenter-fqdn>/rest/com/vmware/cis/session
   # Should return 401 (authentication required) - means API is reachable
   # Connection timeout/refused = API not reachable, IPI will fail
   \`\`\`

2. **Verify NSX-T or distributed switch allows bootstrap → vCenter traffic:**
   - Bootstrap network: <machine-network-cidr>
   - vCenter FQDN: <vcenter-fqdn>
   - Required ports: TCP 443 (HTTPS/REST API)

3. **Common network isolation scenarios where IPI fails:**
   - vCenter on management network (10.0.0.0/24), bootstrap on workload network (10.1.0.0/24)
   - NSX-T distributed firewall blocks workload → management traffic
   - DMZ deployment with vCenter behind corporate firewall

**Troubleshooting:**
\`\`\`bash
# Test full vCenter API authentication:
curl -k -u administrator@vsphere.local https://<vcenter-fqdn>/rest/com/vmware/cis/session -X POST

# Check network route to vCenter:
traceroute <vcenter-fqdn>
\`\`\`

**Alternative:** Use Agent-Based Installer (no vCenter API requirement during bootstrap).
      `
    });
  }

  // Rule 4: Dual-stack + no IPv6 gateway = route failures
  if (context.enableIpv6 && context.nodes?.some(n => n.ipv6Cidr && !n.ipv6Gateway)) {
    rules.push({
      id: "dual-stack-no-ipv6-gateway",
      severity: "warning",
      title: "Dual-Stack with Missing IPv6 Gateway",
      guidance: `
**Warning:** IPv6 enabled but no IPv6 gateway configured on some nodes.

**Impact:**
- Nodes may not be able to route IPv6 traffic outside their local subnet
- IPv6 cluster network communication may fail
- Dual-stack services may fall back to IPv4-only

**Check configuration:**

1. **Review node IPv6 settings:**
   Check agent-config.yaml for nodes with IPv6 CIDR but no IPv6 gateway configured.

2. **Verify IPv6 gateway is reachable:**
   \`\`\`bash
   # From each node:
   ping6 -c 4 <ipv6-gateway>
   ip -6 route show
   # Should show default route via <ipv6-gateway>
   \`\`\`

3. **Common mistakes:**
   - IPv6 gateway not in same subnet as node IPv6 address
   - IPv6 gateway IP typo (common with long addresses)
   - Router advertisement disabled (if using SLAAC instead of static)

**Fix:** Add IPv6 gateway to node configuration in agent-config.yaml or ensure DHCP provides gateway via RA.
      `
    });
  }

  // Rule 5: Mirror registry + no trust bundle = TLS failures
  if (context.usingMirrorRegistry && !context.trustBundleProvided && !context.mirrorRegistryUnauthenticated) {
    rules.push({
      id: "mirror-no-trust-bundle",
      severity: "error",
      title: "Mirror Registry Without Trust Bundle",
      guidance: `
**Critical:** Mirror registry configured but no trust bundle provided.

**Failure:** Bootstrap will fail to pull images with TLS certificate errors.

**Error symptoms:**
\`\`\`
x509: certificate signed by unknown authority
failed to pull image <mirror-registry-fqdn>/<image>
\`\`\`

**Required action:**

1. **Export mirror registry CA certificate:**
   \`\`\`bash
   # If using Quay mirror registry:
   sudo cp /etc/quay-install/quay-config/ssl.cert /tmp/mirror-ca.pem

   # If using custom registry:
   openssl s_client -connect <mirror-registry-fqdn>:<port> \\
     -showcerts < /dev/null 2>/dev/null | \\
     openssl x509 -outform PEM > /tmp/mirror-ca.pem
   \`\`\`

2. **Add to trust bundle in Trust & Proxy step:**
   - Paste the CA certificate (PEM format) into "Additional trust bundle" field
   - If you have multiple CAs (proxy + mirror), concatenate them

3. **Verify certificate trust:**
   \`\`\`bash
   # Test registry reachability with CA trust:
   curl --cacert /tmp/mirror-ca.pem https://<mirror-registry-fqdn>/v2/
   # Should return: {"errors":[...]} (registry is reachable, just not authenticated)
   \`\`\`

**Alternative:** If mirror registry is truly unauthenticated (HTTP, not HTTPS), check the "Mirror registry is unauthenticated" checkbox.

**Note:** Without trust bundle, installation will fail at image pull during bootstrap.
      `
    });
  }

  // Rule 6: FIPS + non-FIPS binary selected = mismatch warning
  if (context.fips && context.installerBinarySelected && !context.installerBinarySelected.includes('fips')) {
    rules.push({
      id: "fips-non-fips-binary",
      severity: "warning",
      title: "FIPS Mode Enabled but Non-FIPS Binary Selected",
      guidance: `
**Warning:** FIPS mode enabled in cluster config but installer binary selection does not include FIPS.

**Impact:**
- Installer itself may not enforce FIPS cryptography
- Cluster will still run in FIPS mode (install-config.yaml fips: true)
- Risk: Installer uses non-FIPS crypto during bootstrap

**Recommendation:** Use FIPS-compliant installer binary for FIPS clusters.

**Binary naming:**
- FIPS binary: \`openshift-install-rhel9-amd64.tar.gz\` (RHEL 9 = FIPS-capable)
- Standard binary: \`openshift-install-linux.tar.gz\` (no FIPS enforcement)

**Verification:**
\`\`\`bash
# Check if installer binary is FIPS-aware:
ldd ./openshift-install | grep -i fips
# RHEL 9 binary links against FIPS-validated libraries
\`\`\`

**Note:** This is a recommendation, not a hard requirement. Cluster will still be FIPS-compliant post-install.
      `
    });
  }

  // Rule 7: Large node count (10+) + no load balancer hints = performance issues
  if (context.nodes && context.nodes.length >= 10 && context.platform !== "AWS GovCloud" && context.platform !== "Azure Government") {
    rules.push({
      id: "large-cluster-no-lb-hints",
      severity: "info",
      title: "Large Cluster Performance Considerations",
      guidance: `
**Info:** Large cluster configuration detected (10+ nodes).

**Performance recommendations:**

1. **API load balancing:**
   - Ensure external load balancer distributes API traffic across control plane nodes
   - Verify load balancer health checks target: \`https://<control-plane>:6443/readyz\`
   - Configure session persistence if using OAuth flows

2. **Ingress load balancing:**
   - Ingress VIP should be backed by load balancer targeting router pods
   - For bare metal, consider using MetalLB or keepalived for VIP management
   - Monitor router pod resource limits (may need tuning for high traffic)

3. **etcd performance:**
   - Large clusters generate more etcd writes (node heartbeats, pod updates)
   - Ensure control plane nodes have fast storage (NVMe/SSD recommended)
   - Monitor etcd latency: \`oc get --raw /metrics | grep etcd_disk_wal_fsync_duration\`

4. **Network plugin scale:**
   - OVN-Kubernetes handles 250+ nodes well
   - Verify MTU settings support overlay network (typically 1400 for VXLAN/GENEVE)

5. **Operator resource limits:**
   - Large clusters may need increased operator replica counts
   - Monitor cluster-version-operator, ingress-operator for high CPU/memory

**Post-install monitoring:**
\`\`\`bash
# Check node-to-node latency:
oc debug node/<node-name>
chroot /host
ping -c 10 <other-node-ip>

# Check etcd health:
oc get etcd -o jsonpath='{.items[0].status.conditions[?(@.type=="EtcdMembersAvailable")].status}'
# Should be "True"
\`\`\`

**Scale testing recommendation:** Run cluster conformance tests post-install to validate scale.
      `
    });
  }

  return rules;
};
