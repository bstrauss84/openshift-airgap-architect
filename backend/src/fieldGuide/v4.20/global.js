/**
 * v4.20 global compartments — always-included and common-condition sections.
 */

export const globalPrereqs = {
  id: "global-prereqs",
  version: "4.20",
  title: "Installation Prerequisites",
  order: 100,
  conditions: {},
  docRefs: [
    { label: "OCP 4.20 installation overview", url: "https://docs.redhat.com/en/documentation/openshift_container_platform/4.20/html/installing/index" },
    { label: "Preparing to install on bare metal", url: "https://docs.redhat.com/en/documentation/openshift_container_platform/4.20/html/installing/installing-on-bare-metal" },
  ],
  items: [
    { text: "Ensure the installer host runs RHEL 8.6+ or RHEL 9 (RHEL 9 is recommended for OCP 4.20)." },
    { text: "Verify the installer host has at least 4 vCPU, 16 GB RAM, and 120 GB free disk on the partition hosting {{installDir}}." },
    { text: "Confirm the installer host can reach the mirror registry at {{registryFqdn}} over HTTPS." },
    { text: "Ensure DNS is resolvable from the installer host: api.{{clusterName}}.{{baseDomain}} and *.apps.{{clusterName}}.{{baseDomain}}." },
    { text: "Verify DNS forward and reverse records for api.{{clusterName}}.{{baseDomain}} → {{apiVip}} and test.apps.{{clusterName}}.{{baseDomain}} → {{ingressVip}}.", cmd: "dig +short api.{{clusterName}}.{{baseDomain}}\ndig +short test.apps.{{clusterName}}.{{baseDomain}}" },
    { text: "Check VIP reachability (ensure no firewall blocks ICMP or TCP/6443, 22623, 443, 80):", cmd: "ping -c3 {{apiVip}}\nping -c3 {{ingressVip}}" },
    { text: "Confirm clock synchronization on the installer host:", cmd: "timedatectl status\nchronyc sources -v" },
    { text: "Ensure oc, oc-mirror (v2), and openshift-install binaries are the same version as the selected release ({{version}}).", cmd: "oc version --client\nopenshift-install version" },
    { text: "Confirm firewall rules open required ports: 6443 (API), 22623 (MCS), 443/80 (ingress), 2379–2380 (etcd peer), 9000–9999 (host-level services)." },
    { text: "Ensure the install directory {{installDir}} exists and is empty before running the installer.", cmd: "mkdir -p {{installDir}} && ls {{installDir}}" },
    { text: "Validate the pull secret / mirror registry credentials are correct and base64-encoded properly before embedding in install-config." },
    { text: "If installing on RHEL CoreOS (RHCOS), verify the RHCOS image version matches the installer version (the installer downloads it automatically when connected; for disconnected, it must be in the mirror)." },
    { text: "Confirm the cluster network CIDR does not overlap with existing node or host subnets (default: clusterNetwork 10.128.0.0/14, serviceNetwork 172.30.0.0/16)." },
    { text: "For multi-node clusters, ensure three control-plane nodes and at least two worker nodes are planned (three workers recommended for day-2 workloads)." },
    { text: "Review the release notes for OCP {{version}} for any known issues or prerequisites specific to this patch:", cmd: "# https://docs.redhat.com/en/documentation/openshift_container_platform/4.20/html/release_notes/index" },
  ],
};

export const proxyConfig = {
  id: "proxy-config",
  version: "4.20",
  title: "Proxy Environment Setup",
  order: 150,
  conditions: { when: (ctx) => ctx.proxyEnabled },
  docRefs: [
    { label: "Configuring a proxy during installation (OCP 4.20)", url: "https://docs.redhat.com/en/documentation/openshift_container_platform/4.20/html/installing/installing-with-a-proxy" },
  ],
  items: [
    { text: "Export proxy variables on the installer host before running any install commands:", cmd: "export HTTP_PROXY={{httpProxy}}\nexport HTTPS_PROXY={{httpsProxy}}\nexport NO_PROXY={{noProxy}}" },
    { text: "Verify the proxy can reach upstream registries (quay.io, registry.redhat.io) from the low side.", cmd: "curl -x {{httpsProxy}} -Is https://quay.io | head -2" },
    { text: "Ensure no_proxy includes the cluster's machine CIDR, service CIDR, cluster CIDR, api VIP, and .{{clusterName}}.{{baseDomain}}. Typical minimum: localhost,127.0.0.1,.svc,.cluster.local,{{apiVip}},{{ingressVip}},{{registryFqdn}}." },
    { text: "The proxy settings are embedded in install-config.yaml under spec.proxy.httpProxy, httpsProxy, and noProxy — verify they appear correctly before creating the cluster." },
    { text: "If the proxy uses a custom CA certificate, ensure that CA is added to the additionalTrustBundle in install-config.yaml." },
    { text: "⚠ FIPS + proxy: both HTTP and HTTPS proxy URLs must use HTTPS when FIPS is enabled. HTTP proxy is not FIPS-compliant.", type: "warning" },
    { text: "After install, verify the cluster-wide proxy is applied:", cmd: "oc get proxy cluster -o yaml" },
    { text: "For oc-mirror on the low side with a proxy, ensure oc-mirror respects the proxy variables (it reads HTTP_PROXY / HTTPS_PROXY from the environment)." },
  ],
};

export const fipsPrereqs = {
  id: "fips-prereqs",
  version: "4.20",
  title: "FIPS Mode Prerequisites",
  order: 160,
  conditions: { when: (ctx) => ctx.fips },
  docRefs: [
    { label: "Support for FIPS cryptography in OCP 4.20", url: "https://docs.redhat.com/en/documentation/openshift_container_platform/4.20/html/installing/installing-fips-validated-modules" },
    { label: "Enabling FIPS mode on RHEL 9", url: "https://docs.redhat.com/en/documentation/red_hat_enterprise_linux/9/html/security_hardening/assembly_installing-the-system-in-fips-mode_security-hardening" },
  ],
  items: [
    { text: "⚠ FIPS mode must be enabled on the installer host BEFORE running openshift-install. Enabling FIPS after install is not supported.", type: "warning" },
    { text: "Enable FIPS on the RHEL 9 installer host:", cmd: "sudo fips-mode-setup --enable\nsudo reboot" },
    { text: "After reboot, verify FIPS is active:", cmd: "fips-mode-setup --check\n# Expected output: FIPS mode is enabled." },
    { text: "Set fips: true in install-config.yaml under the top-level spec. Confirm it is present before proceeding." },
    { text: "All nodes will be provisioned in FIPS mode automatically when fips: true is set in install-config.yaml — no per-node action is needed." },
    { text: "The pull secret and mirror credentials must be stored in FIPS-compliant formats. Avoid md5-based auth tokens." },
    { text: "Confirm oc-mirror and openshift-install are FIPS-capable builds (Red Hat distributed binaries are; community-built binaries may not be)." },
    { text: "If a proxy is in use, ensure the proxy uses FIPS-approved TLS cipher suites and the proxy CA is trusted by the installer." },
    { text: "For bare-metal agent-based installs with FIPS, the agent ISO itself must be built with FIPS binaries — the openshift-install binary on a FIPS host will produce a FIPS-mode ISO automatically." },
    { text: "Verify etcd encryption uses FIPS-approved AES-CBC encryption post-install:", cmd: "oc get apiserver cluster -o jsonpath='{.spec.encryption}'" },
  ],
};

export const ntpConfig = {
  id: "ntp-config",
  version: "4.20",
  title: "NTP Configuration",
  order: 170,
  conditions: { when: (ctx) => ctx.ntpServersList && ctx.ntpServersList.length > 0 },
  docRefs: [
    { label: "Configuring chrony time service for OCP nodes", url: "https://docs.redhat.com/en/documentation/openshift_container_platform/4.20/html/post-installation_configuration/post-install-machine-configuration-tasks#nodes-nodes-working-setting-timeouts-for-termination_post-install-machine-configuration-tasks" },
  ],
  items: [
    { text: "Ensure the installer host uses the same NTP source as the cluster nodes to prevent clock skew errors during installation." },
    { text: "Configure chrony on the installer host with the designated NTP servers ({{ntpServers}}):", cmd: "sudo sed -i 's/^pool/#pool/' /etc/chrony.conf\n{{#ntpServersList}}echo 'server {{.}} iburst' | sudo tee -a /etc/chrony.conf\n{{/ntpServersList}}sudo systemctl restart chronyd && chronyc makestep" },
    { text: "Verify the installer host is synchronized:", cmd: "chronyc sources -v\ntimedatectl show --property=NTPSynchronized" },
    { text: "The MachineConfig manifests (99-chrony-ntp-master.yaml, 99-chrony-ntp-worker.yaml) embed the NTP servers for cluster nodes. If you used the app and downloaded the bundle, these files are pre-generated with your configured servers ({{ntpServers}}) — apply them after install:", cmd: "oc create -f 99-chrony-ntp-master.yaml\noc create -f 99-chrony-ntp-worker.yaml" },
    { text: "Confirm nodes pick up the NTP config (MachineConfigPool must complete rollout, which triggers a controlled node drain/reboot):", cmd: "oc get mcp\noc get nodes -o wide" },
    { text: "⚠ Clock skew > 1 second between etcd members causes leader election failures. Verify time sync before and immediately after node boot.", type: "warning" },
    { text: "For bare-metal agent-based installs, NMState in agent-config.yaml can reference NTP servers per-host if needed; the MachineConfig approach handles cluster-wide post-install config." },
    { text: "Confirm firewall allows UDP/123 outbound from all nodes to {{ntpServers}}." },
  ],
};

export const trustBundle = {
  id: "trust-bundle",
  version: "4.20",
  title: "Trust Bundle & Custom CA",
  order: 180,
  conditions: { when: (ctx) => ctx.trustBundleConfigured },
  docRefs: [
    { label: "Configuring a custom PKI / additionalTrustBundle (OCP 4.20)", url: "https://docs.redhat.com/en/documentation/openshift_container_platform/4.20/html/installing/installing-disconnected-environments#installation-configure-proxy_installing-disconnected-environments" },
  ],
  items: [
    { text: "Install the custom CA certificate on the installer host so oc-mirror and the installer can validate TLS connections to {{registryFqdn}}:", cmd: "sudo cp ca-bundle.pem /etc/pki/ca-trust/source/anchors/mirror-registry-ca.pem\nsudo update-ca-trust extract" },
    { text: "Verify the installer host trusts the registry after updating CA trust:", cmd: "curl -Is https://{{registryFqdn}}/v2/ | head -2\n# Expect: HTTP/2 200 or HTTP/2 401 (not SSL error)" },
    { text: "The CA PEM content must be embedded verbatim in install-config.yaml under additionalTrustBundle (indented, PEM format). Verify it is a valid PEM block:", cmd: "openssl x509 -in ca-bundle.pem -noout -subject -dates" },
    { text: "Set additionalTrustBundlePolicy: Always in install-config.yaml if the cluster nodes must also trust this CA (required for disconnected mirror registries)." },
    { text: "If the proxy CA is separate from the registry CA, combine both PEM files into one trust bundle before embedding in install-config.yaml:", cmd: "cat registry-ca.pem proxy-ca.pem > combined-ca.pem" },
    { text: "After install, verify the trust bundle was injected into the cluster:", cmd: "oc get cm user-ca-bundle -n openshift-config -o yaml | head -20" },
    { text: "⚠ Mismatched CA (expired, wrong CN, or wrong SAN) causes oc-mirror disk-to-mirror to fail with TLS errors. Always verify the CA with openssl before embedding.", type: "warning" },
    { text: "For image registry operator configuration, the additionalTrustedCA field in the Image CR may also need to reference the registry CA by configmap name." },
  ],
};

export const toolsAndCreds = {
  id: "tools-and-creds",
  version: "4.20",
  title: "Obtain Tools and Set Credentials",
  order: 400,
  conditions: {},
  docRefs: [
    { label: "Downloading OpenShift CLI tools", url: "https://docs.redhat.com/en/documentation/openshift_container_platform/4.20/html/cli_tools/openshift-cli-oc#cli-getting-started" },
    { label: "oc-mirror v2 overview", url: "https://docs.redhat.com/en/documentation/openshift_container_platform/4.20/html/disconnected_installation_mirroring/mirroring-images-disconnected-install-oc-mirror-v2" },
  ],
  items: [
    { text: "📦 If you used the OpenShift Airgap Architect app and downloaded the export bundle, the following files are pre-generated for this cluster ({{clusterName}}.{{baseDomain}}) and are included in your ZIP: install-config.yaml, imageset-config.yaml (if mirroring), agent-config.yaml (if Agent-Based Installer), 99-chrony-ntp-*.yaml (if NTP configured). Place them at {{installDir}} as directed below." },
    { text: "Download the correct binaries for OCP {{version}} from the Red Hat Console or the mirror host (all must match the release version):", cmd: "# On a connected host:\ncurl -LO https://mirror.openshift.com/pub/openshift-v4/clients/ocp/{{version}}/openshift-client-linux.tar.gz\ncurl -LO https://mirror.openshift.com/pub/openshift-v4/clients/ocp/{{version}}/openshift-install-linux.tar.gz\ncurl -LO https://mirror.openshift.com/pub/openshift-v4/clients/ocp/{{version}}/oc-mirror.tar.gz" },
    { text: "Verify SHA256 checksums before extracting:", cmd: "sha256sum -c sha256sum.txt" },
    { text: "Extract and place binaries in PATH:", cmd: "tar xf openshift-client-linux.tar.gz -C /usr/local/bin oc kubectl\ntar xf openshift-install-linux.tar.gz -C /usr/local/bin openshift-install\ntar xf oc-mirror.tar.gz -C /usr/local/bin oc-mirror\nchmod +x /usr/local/bin/oc-mirror" },
    { text: "Confirm tool versions all match {{version}}:", cmd: "oc version --client\nopenshift-install version\noc-mirror version" },
    { text: "Download your Red Hat pull secret from https://console.redhat.com/openshift/install/pull-secret and save it as pull-secret.json." },
    { text: "Set the REGISTRY_AUTH_FILE environment variable:", cmd: "export REGISTRY_AUTH_FILE=/path/to/pull-secret.json" },
    { text: "If using a mirror registry, merge the mirror registry credentials into pull-secret.json:", cmd: "# Use podman or oc-mirror to add mirror registry credentials\noc registry login --registry {{registryFqdn}} --auth-basic='admin:password' --to=pull-secret.json" },
    { text: "Confirm you can log in to the mirror registry:", cmd: "podman login {{registryFqdn}}\n# or: oc registry login --registry {{registryFqdn}}" },
    { text: "Place {{imageSetConfig}} in your working directory. If you used the app and downloaded the bundle, use the generated {{imageSetConfig}} from the ZIP — it is already configured for {{clusterName}} with your selected release and operators.", cmd: "cat {{imageSetConfig}}" },
    { text: "Place install-config.yaml in {{installDir}}. If you used the app, copy it from the export bundle — it already contains your platform settings, network config, pull secret, and trust bundle.", cmd: "mkdir -p {{installDir}}\ncp /path/to/bundle/install-config.yaml {{installDir}}/\n# Back up immediately — the installer consumes it:\ncp {{installDir}}/install-config.yaml {{installDir}}/install-config.yaml.bak" },
    { text: "Validate install-config.yaml with a preflight manifests check:", cmd: "openshift-install create manifests --dir {{installDir}} 2>&1 | head -20\n# If manifests are created without error, install-config.yaml is valid.\n# Clean up after the check:\nrm -rf {{installDir}}/manifests {{installDir}}/openshift\ncp {{installDir}}/install-config.yaml.bak {{installDir}}/install-config.yaml" },
    { text: "If installing with Agent-Based Installer, place agent-config.yaml in {{installDir}} as well. If you used the app, it is in the export bundle alongside install-config.yaml." },
  ],
};

export const preInstallReadiness = {
  id: "pre-install-readiness",
  version: "4.20",
  title: "Pre-Install Readiness Check",
  order: 600,
  conditions: {},
  docRefs: [
    { label: "OCP 4.20 installation validation", url: "https://docs.redhat.com/en/documentation/openshift_container_platform/4.20/html/installing/overview-of-installation-methods" },
  ],
  items: [
    { text: "Re-verify DNS resolution for all required records from the installer host:", cmd: "dig +short api.{{clusterName}}.{{baseDomain}}\ndig +short api-int.{{clusterName}}.{{baseDomain}}\ndig +short test.apps.{{clusterName}}.{{baseDomain}}" },
    { text: "Confirm both VIPs are reachable and not responding (they should be free/unbound before install):", cmd: "ping -c2 {{apiVip}}\nping -c2 {{ingressVip}}" },
    { text: "Verify mirror registry is healthy and the OCP release image is present:", cmd: "curl -Is https://{{registryFqdn}}/v2/ | head -2\noc image info {{registryFqdn}}/openshift/release-images:{{version}}-x86_64 2>&1 | head -5" },
    { text: "Confirm {{installDir}} contains install-config.yaml (and agent-config.yaml for agent-based), and no stale manifests from a previous run:", cmd: "ls -la {{installDir}}/" },
    { text: "Verify install-config.yaml pull secret matches the mirror registry auth (base64 decode and check auths):", cmd: "cat {{installDir}}/install-config.yaml | grep -A2 pullSecret | head -3" },
    { text: "Check disk space on the installer host — the installer creates temporary files and logs:", cmd: "df -h {{installDir}}" },
    { text: "If FIPS is enabled, confirm the installer host FIPS mode is still active after any reboots:", cmd: "fips-mode-setup --check" },
    { text: "If NTP is configured, do a final time sync check:", cmd: "chronyc tracking | grep -E 'System|RMS|Freq'" },
    { text: "For vSphere IPI/Agent: test vCenter API reachability one final time:", cmd: "curl -sk https://{{vcenter}}/rest/vcenter/datacenter -o /dev/null -w '%{http_code}\\n'" },
    { text: "For bare-metal: verify all BMC/IPMI addresses respond (IPI) or all nodes are powered off and ready to boot the agent ISO (Agent)." },
    { text: "Run the installer preflight manifests step to catch config errors before committing:", cmd: "cp {{installDir}}/install-config.yaml.bak {{installDir}}/install-config.yaml\nopenshift-install create manifests --dir {{installDir}}" },
    { text: "Review any warnings produced by 'create manifests' before proceeding — warnings often indicate a missing field that causes late-stage failures." },
    { text: "For agent-based: create and inspect the rendezvous IP logic in agent-config.yaml before generating the ISO." },
    { text: "Confirm the bootstrap node (for IPI/UPI) or the first rendezvous node (for agent-based) has network connectivity on both the machine network and the cluster network CIDR." },
    { text: "Document the expected cluster FQDN, API URL, and console URL for handoff:", cmd: "# API: https://api.{{clusterName}}.{{baseDomain}}:6443\n# Console: https://console-openshift-console.apps.{{clusterName}}.{{baseDomain}}" },
  ],
};

export const postInstallValidation = {
  id: "post-install-validation",
  version: "4.20",
  title: "Post-Install Validation",
  order: 800,
  conditions: {},
  docRefs: [
    { label: "Verifying node health (OCP 4.20)", url: "https://docs.redhat.com/en/documentation/openshift_container_platform/4.20/html/nodes/working-with-nodes" },
    { label: "Understanding cluster operators", url: "https://docs.redhat.com/en/documentation/openshift_container_platform/4.20/html/operators/understanding-operators" },
  ],
  items: [
    { text: "Export kubeconfig and verify API access:", cmd: "export KUBECONFIG={{installDir}}/auth/kubeconfig\noc whoami\n# Expected: system:admin" },
    { text: "Confirm all nodes are in Ready state:", cmd: "oc get nodes -o wide\n# All nodes must show STATUS=Ready" },
    { text: "Check cluster version (should show Completed, not Progressing):", cmd: "oc get clusterversion\noc get clusterversion -o jsonpath='{.items[0].status.conditions[?(@.type==\"Available\")].status}'" },
    { text: "Verify all cluster operators are Available and not Degraded:", cmd: "oc get co\n# All should show AVAILABLE=True, PROGRESSING=False, DEGRADED=False" },
    { text: "Check etcd health:", cmd: "oc -n openshift-etcd get pods -l app=etcd\noc -n openshift-etcd exec -it etcd-$(oc get nodes -l node-role.kubernetes.io/master -o name | head -1 | cut -d/ -f2) -c etcd -- etcdctl endpoint health" },
    { text: "Spot-check pod health across critical namespaces:", cmd: "oc get pods -n openshift-ingress\noc get pods -n openshift-apiserver\noc get pods -n openshift-image-registry" },
    { text: "Test the cluster console is reachable:", cmd: "curl -Is https://console-openshift-console.apps.{{clusterName}}.{{baseDomain}} | head -2\n# Expect: HTTP/1.1 200 or redirect" },
    { text: "Verify image registry is in Managed state (or Removed if intentionally disabled):", cmd: "oc get config.imageregistry.operator.openshift.io cluster -o jsonpath='{.spec.managementState}'" },
    { text: "If mirror registry was used, verify the IDMS/ITMS resources were applied:", cmd: "oc get idms\noc get itms" },
    { text: "Run a smoke-test pod to confirm the cluster can pull images from the mirror registry:", cmd: "oc run test-pod --image={{registryFqdn}}/ubi9/ubi:latest --restart=Never --command -- sleep 60\noc get pod test-pod\noc delete pod test-pod" },
    { text: "Confirm ingress (router) is functioning by checking IngressController:", cmd: "oc get ingresscontroller default -n openshift-ingress-operator -o yaml | grep -E 'domain|replicas|status'" },
    { text: "Verify the OAuth server is healthy (required for web console login):", cmd: "oc get pods -n openshift-authentication" },
    { text: "Record the kubeadmin password and store it securely:", cmd: "cat {{installDir}}/auth/kubeadmin-password" },
    { text: "Review the installation log for any non-fatal warnings that may affect day-2 operations:", cmd: "cat {{installDir}}/.openshift_install.log | grep -i 'warn\\|error' | tail -30" },
    { text: "Document the cluster version, API endpoint, and console URL for operations handoff and change management records." },
  ],
};

export const day2Basics = {
  id: "day2-basics",
  version: "4.20",
  title: "Day 2 Essentials",
  order: 900,
  conditions: {},
  docRefs: [
    { label: "Post-installation configuration (OCP 4.20)", url: "https://docs.redhat.com/en/documentation/openshift_container_platform/4.20/html/post-installation_configuration/index" },
    { label: "Managing user workloads and RBAC", url: "https://docs.redhat.com/en/documentation/openshift_container_platform/4.20/html/authentication_and_authorization/index" },
  ],
  items: [
    { text: "Configure an identity provider (IdP) — the default kubeadmin credential should be removed after another admin account is confirmed:", cmd: "# Add HTPasswd IdP example:\nhtpasswd -c -B -b htpasswd-file admin MyPassword\noc create secret generic htpasswd-secret --from-file=htpasswd=./htpasswd-file -n openshift-config\n# Then apply an OAuth CR referencing the secret." },
    { text: "Remove the kubeadmin default secret after an alternative admin is verified:", cmd: "oc delete secret kubeadmin -n kube-system" },
    { text: "Apply cluster resource quotas and limit ranges for each project namespace to prevent resource exhaustion." },
    { text: "Configure the image registry storage backend (PVC, S3-compatible, or object store) if not done during install:", cmd: "oc edit config.imageregistry.operator.openshift.io cluster\n# Set .spec.storage and .spec.managementState: Managed" },
    { text: "Apply the NTP MachineConfigs if NTP servers were specified (99-chrony-ntp-master.yaml, 99-chrony-ntp-worker.yaml are in the export bundle if you used the app):", cmd: "oc create -f 99-chrony-ntp-master.yaml\noc create -f 99-chrony-ntp-worker.yaml\n# Monitor rollout:\noc get mcp" },
    { text: "Configure cluster monitoring persistent storage (Prometheus, AlertManager) for production environments:", cmd: "# Create cluster-monitoring-config ConfigMap in openshift-monitoring\noc apply -f cluster-monitoring-config.yaml" },
    { text: "Apply the generated cluster-resources IDMS/ITMS/CatalogSource manifests from oc-mirror if not already applied:", cmd: "oc apply -f {{workspacePath}}/working-dir/cluster-resources/" },
    { text: "If operators were selected ({{operatorList}}), install them via OperatorHub or the generated CatalogSource after verifying catalog reachability:", cmd: "oc get catalogsource -n openshift-marketplace" },
    { text: "Enable cluster autoscaling if variable workloads are expected (on platforms that support it).", cmd: "oc get machineautoscaler -A" },
    { text: "Schedule a backup of the etcd data using the etcd backup procedure:", cmd: "# Run on a control-plane node:\n/usr/local/bin/cluster-backup.sh /home/core/assets/backup" },
    { text: "Set up log forwarding (ClusterLogForwarder) if centralized logging is required in the environment.", cmd: "oc get clusterlogforwarder instance -n openshift-logging 2>/dev/null || echo 'Not yet configured'" },
    { text: "Review and tune the default IngressController settings (replica count, load balancing strategy) for production traffic." },
  ],
};
