/**
 * v4.20 vSphere compartments.
 */

export const vsphereIpiPrereqs = {
  id: "vsphere-ipi-prereqs",
  version: "4.20",
  title: "vSphere IPI Prerequisites",
  order: 250,
  conditions: {
    platforms: ["VMware vSphere"],
    methodologies: ["IPI"],
  },
  docRefs: [
    { label: "Preparing to install on vSphere — IPI (OCP 4.20)", url: "https://docs.redhat.com/en/documentation/openshift_container_platform/4.20/html/installing/installing-on-vsphere#preparing-to-install-on-vsphere" },
    { label: "vSphere IPI install-config parameters", url: "https://docs.redhat.com/en/documentation/openshift_container_platform/4.20/html/installing/installing-on-vsphere#installation-vsphere-config-yaml_installing-vsphere" },
    { label: "Required vCenter permissions for IPI", url: "https://docs.redhat.com/en/documentation/openshift_container_platform/4.20/html/installing/installing-on-vsphere#installation-vsphere-required-permissions_installing-vsphere" },
  ],
  items: [
    { text: "Confirm vSphere/ESXi version is 7.0 Update 2 or later (8.x is also supported for OCP 4.20). Check from vCenter:", cmd: "# vSphere UI: Home → vCenter → Summary → Version\n# Or via API:\ncurl -sk https://{{vcenter}}/rest/appliance/system/version | python3 -m json.tool | grep version" },
    { text: "Test HTTPS connectivity from the installer host to the vCenter API:", cmd: "curl -sk https://{{vcenter}}/rest/vcenter/datacenter -o /dev/null -w '%{http_code}\\n'\n# Expect: 200" },
    { text: "Confirm the vCenter account has the required IPI permissions. The installer needs cluster-level privileges (create VMs, attach networks, provision storage). See the required permissions list in the OCP docs for the exact vSphere privilege set." },
    { text: "Create or verify the target datacenter {{datacenter}}, cluster {{vsphereCluster}}, datastore {{datastore}}, and network {{vsphereNetwork}} exist in vCenter." },
    { text: "Ensure the datastore {{datastore}} has at least 800 GB free (3 control plane × 100 GB + N workers × 100 GB + bootstrap VM 100 GB + buffer)." },
    { text: "Confirm the VM network {{vsphereNetwork}} allows the required ports between all cluster node IPs (API: 6443, etcd: 2379-2380, SDN/OVN: 4789/4500 UDP, etc.)." },
    { text: "Verify DNS round-trip for vCenter FQDN resolves correctly from the installer host:", cmd: "nslookup {{vcenter}}\n# And reverse:\ndnslookup $(dig +short {{vcenter}} | head -1)" },
    { text: "Confirm NTP is synchronized between the installer host, vCenter, and ESXi hosts (clock skew > 1s causes etcd failures):" },
    { text: "Set the following values in install-config.yaml under platform.vsphere: vcenter={{vcenter}}, datacenter={{datacenter}}, cluster={{vsphereCluster}}, defaultDatastore={{datastore}}, network={{vsphereNetwork}}." },
    { text: "For IPI, set apiVIPs: [{{apiVip}}] and ingressVIPs: [{{ingressVip}}] in install-config.yaml (these are IPs that must be free in the VM network {{vsphereNetwork}})." },
    { text: "Verify the api VIP {{apiVip}} and ingress VIP {{ingressVip}} are not currently in use:", cmd: "ping -c2 {{apiVip}} 2>&1 | grep -E 'transmitted|received'\n# Expect: 0 received (VIPs must be free)" },
    { text: "If using a vSphere folder or resource pool, specify platform.vsphere.folder and platform.vsphere.resourcePool in install-config.yaml." },
    { text: "If a disconnected mirror registry is used, ensure the vCenter host can reach {{registryFqdn}} (the bootstrap VM launched in vCenter needs to pull from the registry)." },
    { text: "Add the mirror registry CA to the installer host's trust store and embed it in additionalTrustBundle in install-config.yaml." },
    { text: "⚠ Do not set platform.vsphere.clusterOSImage for a connected install — the installer downloads RHCOS automatically. For disconnected, the RHCOS OVA must be pre-uploaded to vCenter or available in the mirror.", type: "warning" },
    { text: "For vSphere IPI, the installer creates the bootstrap VM, control plane VMs, and worker VMs automatically. Do not create them manually before running the installer." },
    { text: "Confirm the vCenter credentials (username/password) are set correctly in the install-config.yaml platform.vsphere.username and password fields, or in the VSPHERE_PASSWORD env variable." },
    { text: "Review the vSphere CSI driver requirements for storage if persistent volumes are needed post-install." },
  ],
};

export const vsphereIpiInstall = {
  id: "vsphere-ipi-install",
  version: "4.20",
  title: "vSphere IPI Installation",
  order: 700,
  conditions: {
    platforms: ["VMware vSphere"],
    methodologies: ["IPI"],
  },
  docRefs: [
    { label: "Installing a cluster on vSphere with IPI (OCP 4.20)", url: "https://docs.redhat.com/en/documentation/openshift_container_platform/4.20/html/installing/installing-on-vsphere#installing-vsphere" },
  ],
  items: [
    { text: "Back up install-config.yaml before running the installer (it will be consumed):", cmd: "cp {{installDir}}/install-config.yaml {{installDir}}/install-config.yaml.bak" },
    { text: "Run the installer (IPI — it provisions all infrastructure):", cmd: "openshift-install create cluster --dir {{installDir}} --log-level=info" },
    { text: "Monitor the bootstrap phase in a separate terminal (optional but recommended):", cmd: "openshift-install wait-for bootstrap-complete --dir {{installDir}} --log-level=info" },
    { text: "While the installer runs, watch vCenter to confirm VMs (bootstrap, 3 control-plane, workers) appear and transition through Created → Powered On → IP assigned." },
    { text: "If bootstrap hangs at '99%', check that DNS records for api.{{clusterName}}.{{baseDomain}} and api-int.{{clusterName}}.{{baseDomain}} are resolvable from within the VM network." },
    { text: "After bootstrap completes, the installer continues with control plane and worker configuration — the bootstrap VM will be automatically destroyed." },
    { text: "If worker nodes do not appear, check the MachineSet and Machine resources:", cmd: "oc get machinesets -n openshift-machine-api\noc get machines -n openshift-machine-api" },
    { text: "Approve any pending CSRs (certificate signing requests) if nodes are stuck in NotReady:", cmd: "oc get csr | grep Pending\noc get csr -o json | jq '.items[].metadata.name' -r | xargs oc adm certificate approve" },
    { text: "Wait for the install-complete signal:", cmd: "openshift-install wait-for install-complete --dir {{installDir}} --log-level=info" },
    { text: "After install completes, export kubeconfig and verify cluster health:", cmd: "export KUBECONFIG={{installDir}}/auth/kubeconfig\noc get nodes\noc get co" },
    { text: "Verify vSphere CSI / Cloud Provider is operational:", cmd: "oc get pods -n openshift-cluster-storage-operator\noc get csidriver" },
    { text: "Test a PVC creation to confirm vSphere storage integration is working post-install:", cmd: "oc apply -f - <<EOF\napiVersion: v1\nkind: PersistentVolumeClaim\nmetadata:\n  name: test-pvc\n  namespace: default\nspec:\n  accessModes: [ReadWriteOnce]\n  resources:\n    requests:\n      storage: 1Gi\nEOF\noc get pvc test-pvc" },
    { text: "Clean up the test PVC:", cmd: "oc delete pvc test-pvc" },
    { text: "Review the install log for warnings about vSphere tags or permissions that may affect day-2 operations:", cmd: "grep -i 'warn\\|vsphere\\|vcenter' {{installDir}}/.openshift_install.log | tail -20" },
    { text: "Document the vCenter folder where cluster VMs were created for future reference (needed for cleanup or MachineSet modifications)." },
  ],
};

export const vsphereUpiPrereqs = {
  id: "vsphere-upi-prereqs",
  version: "4.20",
  title: "vSphere UPI Prerequisites",
  order: 250,
  conditions: {
    platforms: ["VMware vSphere"],
    methodologies: ["UPI"],
  },
  docRefs: [
    { label: "Installing a cluster on vSphere with UPI (OCP 4.20)", url: "https://docs.redhat.com/en/documentation/openshift_container_platform/4.20/html/installing/installing-on-vsphere#installing-vsphere-installer-provisioned" },
    { label: "vSphere UPI infrastructure requirements", url: "https://docs.redhat.com/en/documentation/openshift_container_platform/4.20/html/installing/installing-on-vsphere#upi-vsphere-infrastructure" },
  ],
  items: [
    { text: "Confirm vSphere 7.0 U2+ or 8.x and that you have sufficient permissions to create VMs, clone templates, and assign networks in datacenter {{datacenter}}." },
    { text: "For UPI, you provision all VMs manually. Prepare a RHCOS OVA template in vCenter matching OCP {{version}}. Download from the Red Hat mirror or the installer artifacts." },
    { text: "Create the following VMs before running the installer: 1 bootstrap, 3 control-plane, and N worker nodes. All must use the RHCOS OVA template." },
    { text: "Set static or DHCP-reserved IP addresses for all VMs. Ensure DNS forward and reverse records exist for every VM hostname." },
    { text: "Verify that api.{{clusterName}}.{{baseDomain}} (→ {{apiVip}}) and *.apps.{{clusterName}}.{{baseDomain}} (→ {{ingressVip}}) have DNS records pointing to a load balancer you provision." },
    { text: "Configure a load balancer (HAProxy, F5, or equivalent) with backends: API (6443), Machine Config (22623) on control-plane IPs, and ingress (80/443) on worker IPs." },
    { text: "Generate ignition configs before powering on VMs:", cmd: "openshift-install create ignition-configs --dir {{installDir}}" },
    { text: "Host the bootstrap ignition file at an HTTPS URL accessible from within the VM network (or use base64 encoding in the VM extra config)." },
    { text: "Pass the correct ignition config to each VM via vApp properties or vSphere extra config: guestinfo.ignition.config.data and guestinfo.ignition.config.data.encoding=base64." },
    { text: "⚠ Bootstrap ignition is large (>10KB). It cannot be embedded in vApp properties directly — use an HTTPS URL with a pointer ignition file or a web server on the bootstrap network.", type: "warning" },
    { text: "Set platform: none or platform.vsphere with minimal vSphere fields in install-config.yaml for UPI (do not set vCenter credentials if you're managing VMs manually)." },
    { text: "Confirm the bootstrap VM has at least 4 vCPU, 16 GB RAM, 100 GB disk. Control plane nodes: 4 vCPU, 16 GB RAM, 100 GB disk. Workers: per workload requirements (min 2 vCPU, 8 GB RAM)." },
    { text: "Verify network connectivity between the bootstrap node and all control-plane nodes on port 22623 before powering on control-plane VMs." },
    { text: "Review firewall and security group rules for the vSphere port group — OVN-Kubernetes requires that overlay packets (Geneve UDP/6081) are not blocked between nodes." },
    { text: "Monitor the bootstrap process from the installer:", cmd: "openshift-install wait-for bootstrap-complete --dir {{installDir}} --log-level=info" },
  ],
};

export const vsphereUpiInstall = {
  id: "vsphere-upi-install",
  version: "4.20",
  title: "vSphere UPI Installation",
  order: 710,
  conditions: {
    platforms: ["VMware vSphere"],
    methodologies: ["UPI"],
  },
  docRefs: [
    { label: "vSphere UPI — cluster completion steps (OCP 4.20)", url: "https://docs.redhat.com/en/documentation/openshift_container_platform/4.20/html/installing/installing-on-vsphere#installation-installing-bare-metal_installing-vsphere-installer-provisioned" },
  ],
  items: [
    { text: "Power on the bootstrap VM first; wait for it to reach a Running state with an IP address visible in vCenter." },
    { text: "Power on all three control-plane VMs. The installer will configure them from the bootstrap node." },
    { text: "Monitor bootstrap progress:", cmd: "openshift-install wait-for bootstrap-complete --dir {{installDir}} --log-level=info" },
    { text: "Approve pending CSRs as control-plane nodes come up:", cmd: "oc get csr | grep Pending\noc adm certificate approve $(oc get csr -o name | xargs)" },
    { text: "After bootstrap completes, power off and delete the bootstrap VM from vCenter (it is no longer needed and may interfere with load balancer health checks)." },
    { text: "Power on worker VMs. Each worker will attempt to register with the cluster and generate a CSR." },
    { text: "Approve worker CSRs as they appear:", cmd: "watch oc get csr | grep Pending\noc adm certificate approve $(oc get csr -o name | xargs)" },
    { text: "Wait for the install-complete signal:", cmd: "openshift-install wait-for install-complete --dir {{installDir}} --log-level=info" },
    { text: "Remove the bootstrap load balancer backend (port 22623) from your load balancer configuration once control-plane is healthy." },
    { text: "Verify all nodes are Ready:", cmd: "oc get nodes -o wide" },
    { text: "Check cluster operators:", cmd: "oc get co" },
    { text: "For UPI, the vSphere cloud provider and CSI driver may require additional configuration (cloud-provider-config ConfigMap). Verify the storage operator is not degraded." },
  ],
};

export const vsphereAgentPrereqs = {
  id: "vsphere-agent-prereqs",
  version: "4.20",
  title: "vSphere Agent-Based Prerequisites",
  order: 250,
  conditions: {
    platforms: ["VMware vSphere"],
    methodologies: ["Agent-Based Installer"],
  },
  docRefs: [
    { label: "Installing with the Agent-based Installer on vSphere (OCP 4.20)", url: "https://docs.redhat.com/en/documentation/openshift_container_platform/4.20/html/installing/installing-with-agent-based-installer#installing-with-agent-based-installer" },
    { label: "Agent-based Installer prerequisites", url: "https://docs.redhat.com/en/documentation/openshift_container_platform/4.20/html/installing/installing-with-agent-based-installer#prerequisites-agent-based-installer" },
  ],
  items: [
    { text: "Confirm vSphere 7.0 U2+ or 8.x. For agent-based installs, you provision VMs manually (like UPI) but use the agent ISO for node bootstrapping." },
    { text: "Generate the agent ISO after preparing both install-config.yaml and agent-config.yaml:", cmd: "openshift-install agent create image --dir {{installDir}}" },
    { text: "Verify both config files are present in {{installDir}} before running agent create image:", cmd: "ls {{installDir}}/install-config.yaml {{installDir}}/agent-config.yaml" },
    { text: "For multi-node clusters on vSphere, set apiVIPs and ingressVIPs in install-config.yaml. For SNO (single-node), use platform: none and set the node IP directly in agent-config.yaml." },
    { text: "Prepare VMs in vCenter with the correct CPU/RAM/disk spec: control plane: 4 vCPU, 16 GB RAM, 100 GB disk; workers: 2+ vCPU, 8+ GB RAM, 100 GB disk." },
    { text: "Upload the generated agent.x86_64.iso to a vCenter datastore or host it via HTTP for virtual media attachment." },
    { text: "Verify the rendezvous IP in agent-config.yaml matches one of the planned control-plane node IPs in your network:", cmd: "grep rendezvousIP {{installDir}}/agent-config.yaml" },
    { text: "Ensure all VMs' NIC MAC addresses match the interfaces defined in agent-config.yaml if using NMState for static IP configuration." },
    { text: "Confirm DNS records exist: api.{{clusterName}}.{{baseDomain}} → {{apiVip}}, *.apps.{{clusterName}}.{{baseDomain}} → {{ingressVip}}." },
    { text: "Test network connectivity on the VM network {{vsphereNetwork}} between planned node IPs — all nodes must reach each other and the rendezvous IP before booting." },
    { text: "For disconnected installs, verify {{registryFqdn}} is reachable from the VM network and the CA trust is embedded in install-config.yaml additionalTrustBundle." },
    { text: "Review the agent-config.yaml host entries: each host needs hostname, role (master/worker), rootDeviceHints, and interfaces (with NMState config for static IPs).", cmd: "cat {{installDir}}/agent-config.yaml" },
    { text: "⚠ If using DHCP for node IPs with agent-based, ensure DHCP reservations (MAC → IP) are stable before booting. Dynamic IPs break NMState and the rendezvous flow.", type: "warning" },
    { text: "Confirm the vSphere ESXi host supports booting from ISO (CD/DVD virtual device). Set boot order to CD/DVD first in VM settings." },
    { text: "If the cluster size is SNO: set controlPlane.replicas: 1, compute.replicas: 0, and platform: none in install-config.yaml." },
  ],
};

export const vsphereAgentInstall = {
  id: "vsphere-agent-install",
  version: "4.20",
  title: "vSphere Agent-Based Installation",
  order: 720,
  conditions: {
    platforms: ["VMware vSphere"],
    methodologies: ["Agent-Based Installer"],
  },
  docRefs: [
    { label: "Installing with Agent-based Installer — cluster creation (OCP 4.20)", url: "https://docs.redhat.com/en/documentation/openshift_container_platform/4.20/html/installing/installing-with-agent-based-installer#installing-ocp-agent_installing-with-agent-based-installer" },
  ],
  items: [
    { text: "Attach the agent ISO to all VMs in vCenter and set boot order to CD/DVD first (or use a virtual media mount)." },
    { text: "Power on all VMs simultaneously (or start with the rendezvous host first if timing is critical)." },
    { text: "Monitor the agent installation from the installer host:", cmd: "openshift-install agent wait-for bootstrap-complete --dir {{installDir}} --log-level=info" },
    { text: "Observe VMs in vCenter: each VM boots from the ISO, runs the agent, and initiates the cluster formation process." },
    { text: "If a VM boots but doesn't appear in the agent monitoring output, SSH to the rendezvous node to check agent status:", cmd: "# SSH into the rendezvous node IP:\nssh core@<rendezvous-ip>\nsudo journalctl -u assisted-service -f\nsudo journalctl -u assisted-installer -f" },
    { text: "Approve any pending CSRs once nodes begin registering:", cmd: "oc get csr | grep Pending\noc adm certificate approve $(oc get csr -o name | xargs)" },
    { text: "Wait for the full install-complete signal:", cmd: "openshift-install agent wait-for install-complete --dir {{installDir}} --log-level=info" },
    { text: "After install completes, detach the ISO from all VMs to prevent re-booting from ISO on next VM restart." },
    { text: "Export kubeconfig and run post-install checks:", cmd: "export KUBECONFIG={{installDir}}/auth/kubeconfig\noc get nodes\noc get co" },
    { text: "Check that vSphere cloud provider is properly initialized if platform.vsphere was set in install-config.yaml:", cmd: "oc get pods -n openshift-cloud-controller-manager" },
    { text: "For agent-based + vSphere, verify that the cloud-provider-config ConfigMap contains the correct vCenter information:", cmd: "oc get cm cloud-provider-config -n openshift-config -o yaml | head -30" },
    { text: "Confirm worker nodes joined the cluster (may require CSR approval):", cmd: "oc get nodes -l node-role.kubernetes.io/worker\noc get csr | grep Pending" },
    { text: "Review the agent installation logs for any warnings:", cmd: "cat {{installDir}}/.openshift_install.log | grep -i 'warn\\|error' | tail -20" },
    { text: "Run the full post-install validation checklist once all nodes are Ready." },
    { text: "Remove ISO attachments from all VMs in vCenter and update boot order to disk-first." },
  ],
};
