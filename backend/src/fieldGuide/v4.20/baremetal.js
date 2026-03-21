/**
 * v4.20 bare-metal compartments.
 */

export const bmAgentPrereqs = {
  id: "bm-agent-prereqs",
  version: "4.20",
  title: "Bare Metal Agent Prerequisites",
  order: 250,
  conditions: {
    platforms: ["Bare Metal"],
    methodologies: ["Agent-Based Installer"],
  },
  docRefs: [
    { label: "Agent-based Installer on bare metal (OCP 4.20)", url: "https://docs.redhat.com/en/documentation/openshift_container_platform/4.20/html/installing/installing-with-agent-based-installer" },
    { label: "Agent-based Installer — preparing the agent-config.yaml", url: "https://docs.redhat.com/en/documentation/openshift_container_platform/4.20/html/installing/installing-with-agent-based-installer#agent-config-yaml-reference" },
  ],
  items: [
    { text: "Inventory all physical nodes: hostname, BMC IP/credentials, MAC addresses (boot NIC), and planned IP addresses. Record in a spreadsheet or CMDB before proceeding." },
    { text: "Ensure each node's BMC is accessible from the installer host (IPMI/Redfish). Test connectivity:", cmd: "# IPMI:\nipmitool -I lanplus -H <bmc-ip> -U admin -P password chassis status\n# Redfish:\ncurl -sk https://<bmc-ip>/redfish/v1/Systems | python3 -m json.tool | head" },
    { text: "Verify all nodes are powered off and in a known good state before beginning. Wipe any existing OS or boot partition if nodes were previously in use." },
    { text: "Confirm DNS forward and reverse records exist for every node hostname and for the cluster VIPs: api.{{clusterName}}.{{baseDomain}} → {{apiVip}}, *.apps.{{clusterName}}.{{baseDomain}} → {{ingressVip}}." },
    { text: "Verify the API and ingress VIPs ({{apiVip}}, {{ingressVip}}) are currently free (no host responding):", cmd: "ping -c2 {{apiVip}} 2>&1 | grep '0 received'\nping -c2 {{ingressVip}} 2>&1 | grep '0 received'" },
    { text: "Confirm the installer host can reach the planned node IPs on the machine network (same subnet or routed with firewall rules open for required ports)." },
    { text: "Prepare install-config.yaml with the correct platform (bare metal for multi-node, or none for SNO), apiVIPs, and ingressVIPs." },
    { text: "Prepare agent-config.yaml with one host entry per node. Each entry needs: hostname, role (master/worker), rootDeviceHints (by wwn, hctl, or deviceName), and interfaces (NMState with MAC and IP config).", cmd: "cat {{installDir}}/agent-config.yaml" },
    { text: "Use rootDeviceHints to uniquely identify the boot disk on each host (by WWN is most reliable; avoid deviceName '/dev/sdX' which is not stable across reboots)." },
    { text: "For static IP addressing, write NMState per interface in agent-config.yaml. For DHCP, ensure MAC-based reservations are configured on the DHCP server before booting nodes." },
    { text: "Set the rendezvousIP in agent-config.yaml to one of the planned control-plane node IPs. The agent requires at least the rendezvous host to be reachable.", cmd: "grep rendezvousIP {{installDir}}/agent-config.yaml" },
    { text: "Generate the agent ISO:", cmd: "cp {{installDir}}/install-config.yaml.bak {{installDir}}/install-config.yaml\nopenshift-install agent create image --dir {{installDir}}" },
    { text: "Verify the generated ISO size (typically 100–500 MB):", cmd: "ls -lh {{installDir}}/agent.x86_64.iso" },
    { text: "Prepare the ISO boot method: write to USB drives (one per node, or use virtual media via BMC). Virtual media via Redfish is strongly preferred for bare metal deployments at scale." },
    { text: "⚠ UEFI vs Legacy BIOS: confirm all nodes use the same boot mode. The agent ISO supports both, but mixing modes in a cluster is unsupported.", type: "warning" },
    { text: "Test virtual media mount via Redfish (if using Redfish virtual media):", cmd: "# Insert ISO via Redfish:\ncurl -sk -X POST https://<bmc-ip>/redfish/v1/Managers/Self/VirtualMedia/CD/Actions/VirtualMedia.InsertMedia \\\n  -H 'Content-Type: application/json' \\\n  -d '{\"Image\": \"http://installer-host/agent.x86_64.iso\"}'" },
    { text: "Confirm firmware version and Secure Boot settings on each node. Disable Secure Boot if the environment does not have OCP-signed SHIM configured." },
    { text: "Verify all required firewall ports are open between nodes: 6443 (API), 22623 (MCS), 2379-2380 (etcd), 4789 (VXLAN), 4500 (IPSec), 9000-9999 (host services)." },
    { text: "For disconnected installs, ensure {{registryFqdn}} is reachable from all planned node IPs and that the CA trust is embedded in install-config.yaml additionalTrustBundle." },
  ],
};

export const bmAgentInstall = {
  id: "bm-agent-install",
  version: "4.20",
  title: "Bare Metal Agent Installation",
  order: 700,
  conditions: {
    platforms: ["Bare Metal"],
    methodologies: ["Agent-Based Installer"],
  },
  docRefs: [
    { label: "Agent-based Installer — creating and booting the cluster (OCP 4.20)", url: "https://docs.redhat.com/en/documentation/openshift_container_platform/4.20/html/installing/installing-with-agent-based-installer#installing-ocp-agent_installing-with-agent-based-installer" },
  ],
  items: [
    { text: "Ensure install-config.yaml and agent-config.yaml are in {{installDir}}. If you used the app and downloaded the export bundle, both files are pre-generated with your host inventory, NMState, and root device hints — copy them from the bundle.", cmd: "ls {{installDir}}/install-config.yaml {{installDir}}/agent-config.yaml" },
    { text: "Mount the agent ISO to all nodes via BMC virtual media or USB, then boot each node from the ISO." },
    { text: "Monitor bootstrap-complete from the installer host:", cmd: "openshift-install agent wait-for bootstrap-complete --dir {{installDir}} --log-level=info" },
    { text: "Monitor agent logs on the rendezvous host if any node does not check in within 10 minutes:", cmd: "# SSH to the rendezvous node:\nssh core@{{apiVip}}\nsudo journalctl -u assisted-service --no-pager -n 50" },
    { text: "As nodes check in to the rendezvous host, verify the cluster formation is progressing:", cmd: "# From the rendezvous node:\ncurl -s http://localhost:8090/api/assisted-install/v2/clusters | python3 -m json.tool | grep -E 'status|progress'" },
    { text: "If a node fails to boot the ISO (stays at BIOS screen), verify the boot order in firmware settings — ISO/virtual media must be first." },
    { text: "Approve any pending CSRs as nodes register:", cmd: "oc get csr | grep Pending\noc adm certificate approve $(oc get csr -o name | xargs)" },
    { text: "Wait for install-complete:", cmd: "openshift-install agent wait-for install-complete --dir {{installDir}} --log-level=info" },
    { text: "After install completes, verify nodes are Ready:", cmd: "export KUBECONFIG={{installDir}}/auth/kubeconfig\noc get nodes -o wide" },
    { text: "Remove ISO from all nodes (eject virtual media or remove USB drives) after install completes to prevent reboot loop." },
    { text: "Check cluster operators are healthy:", cmd: "oc get co | grep -v 'True.*False.*False'" },
    { text: "Verify the baremetal operator is healthy (if IPI provisioning was intended):", cmd: "oc get pods -n openshift-machine-api | grep baremetal" },
    { text: "Run post-install validation checks (see Post-Install Validation section)." },
    { text: "For production environments, record the kubeadmin password and kubeconfig in your secrets management system immediately." },
    { text: "Document node-to-IP mapping and BMC credentials in your CMDB for future operations." },
    { text: "Review the full install log for warnings:", cmd: "grep -i 'warn\\|error' {{installDir}}/.openshift_install.log | tail -30" },
  ],
};

export const bmIpiPrereqs = {
  id: "bm-ipi-prereqs",
  version: "4.20",
  title: "Bare Metal IPI Prerequisites",
  order: 250,
  conditions: {
    platforms: ["Bare Metal"],
    methodologies: ["IPI"],
  },
  docRefs: [
    { label: "Installing a cluster on bare metal with IPI (OCP 4.20)", url: "https://docs.redhat.com/en/documentation/openshift_container_platform/4.20/html/installing/installing-on-bare-metal#installing-bare-metal-network-requirements_installing-bare-metal" },
    { label: "Bare metal IPI — configuring host inventory", url: "https://docs.redhat.com/en/documentation/openshift_container_platform/4.20/html/installing/installing-on-bare-metal#configuring-host-inventory_installing-bare-metal" },
  ],
  items: [
    { text: "Confirm Redfish or IPMI BMC is accessible for each node from the provisioning network or from the baremetal network (depending on provisioningNetwork setting)." },
    { text: "Determine provisioningNetwork mode: Managed (DHCP on a dedicated provisioning VLAN), Unmanaged (you run DHCP), or Disabled (no dedicated provisioning network — use baremetal network only)." },
    { text: "For 'Managed' provisioningNetwork: assign a dedicated NIC and subnet for the provisioning network on the installer host and all nodes. The installer runs a DHCP server on this network." },
    { text: "For 'Disabled' provisioningNetwork: the installer uses the baremetal network for both provisioning and cluster traffic. Ensure no external DHCP conflicts exist." },
    { text: "Verify BMC credentials for all hosts and test Redfish/IPMI connectivity:", cmd: "# Redfish test:\ncurl -sk https://<bmc-ip>/redfish/v1/Systems -u admin:password | python3 -m json.tool | head\n# IPMI test:\nipmitool -I lanplus -H <bmc-ip> -U admin -P password chassis power status" },
    { text: "Obtain the boot MAC address for each node (the NIC connected to the provisioning or baremetal network) — required for the install-config.yaml hosts list." },
    { text: "Populate install-config.yaml platform.baremetal.hosts[] with: name, bmc.address (redfish+https:// or ipmi://...), bmc.username, bmc.password, bootMACAddress, rootDeviceHints." },
    { text: "Set apiVIPs: [{{apiVip}}] and ingressVIPs: [{{ingressVip}}] in install-config.yaml — these must be unused IPs on the baremetal network." },
    { text: "Set platform.baremetal.provisioningNetwork: Managed|Unmanaged|Disabled and platform.baremetal.provisioningNetworkCIDR (for Managed)." },
    { text: "Ensure the installer host has two NICs for IPI: one on the provisioning network and one on the baremetal network (or use a single NIC with provisioningNetwork=Disabled)." },
    { text: "Confirm DHCP is NOT running on the baremetal network (unless you want cluster nodes to use DHCP after bootstrap, which is fine if you have stable DHCP reservations)." },
    { text: "Verify all nodes can boot via PXE or virtual media over the provisioning network — the IPI installer uses Ironic to PXE-boot nodes during provisioning." },
    { text: "For disconnected IPI, the RHCOS live ISO must be available in the mirror registry. The installer references it via imageURL in platform.baremetal.bootstrapOSImage. Verify this URL points to your mirror." },
    { text: "⚠ For FIPS-enabled IPI: all nodes must be capable of booting RHCOS in FIPS mode. Ensure Secure Boot or UEFI settings do not block unsigned bootloaders.", type: "warning" },
    { text: "Run a final check on DNS and VIPs:", cmd: "dig +short api.{{clusterName}}.{{baseDomain}}\nping -c2 {{apiVip}} 2>&1 | grep '0 received'" },
    { text: "Ensure the installer host's firewall allows the Ironic API port (6385) and the BMC ports (TCP/443 for Redfish, UDP/623 for IPMI) from the provisioning network." },
    { text: "Review the OCP 4.20 IPI bare metal release notes for any known hardware compatibility issues with your server models and BMC firmware versions." },
    { text: "Validate that rootDeviceHints match actual disks using lsblk or lshw output from each node's out-of-band console." },
  ],
};

export const bmIpiInstall = {
  id: "bm-ipi-install",
  version: "4.20",
  title: "Bare Metal IPI Installation",
  order: 705,
  conditions: {
    platforms: ["Bare Metal"],
    methodologies: ["IPI"],
  },
  docRefs: [
    { label: "Installing cluster on bare metal IPI — cluster creation (OCP 4.20)", url: "https://docs.redhat.com/en/documentation/openshift_container_platform/4.20/html/installing/installing-on-bare-metal#installing-bare-metal" },
  ],
  items: [
    { text: "Place install-config.yaml in {{installDir}}. If you used the app and downloaded the export bundle, copy it from the bundle (it already has all BMC addresses, boot MACs, and mirror settings).", cmd: "mkdir -p {{installDir}}\ncp /path/to/bundle/install-config.yaml {{installDir}}/" },
    { text: "Back up install-config.yaml before running the installer:", cmd: "cp {{installDir}}/install-config.yaml {{installDir}}/install-config.yaml.bak" },
    { text: "Start the IPI installation — the installer provisions all nodes via Ironic and BMC:", cmd: "openshift-install create cluster --dir {{installDir}} --log-level=info" },
    { text: "Monitor Ironic provisioning state for each host (the installer logs 'provisioning' stage progress).", cmd: "openshift-install wait-for bootstrap-complete --dir {{installDir}} --log-level=info" },
    { text: "While provisioning: check that nodes power on and PXE-boot from the provisioning network. Use your BMC console for out-of-band monitoring." },
    { text: "If a node gets stuck in 'inspecting' phase, verify the BMC credentials and that IPMI/Redfish are responding correctly." },
    { text: "Approve any pending CSRs after control-plane nodes come up:", cmd: "oc get csr | grep Pending\noc adm certificate approve $(oc get csr -o name | xargs)" },
    { text: "Wait for bootstrap complete, then wait for install-complete:", cmd: "openshift-install wait-for install-complete --dir {{installDir}} --log-level=info" },
    { text: "Verify all nodes are Ready:", cmd: "export KUBECONFIG={{installDir}}/auth/kubeconfig\noc get nodes -o wide" },
    { text: "Check BareMetalHost resources are in 'provisioned' state:", cmd: "oc get baremetalhosts -n openshift-machine-api" },
    { text: "Verify the baremetal operator is healthy:", cmd: "oc get pods -n openshift-machine-api | grep baremetal\noc get co baremetal" },
    { text: "Check cluster operators:", cmd: "oc get co" },
    { text: "Review install log for warnings:", cmd: "grep -i 'warn\\|error' {{installDir}}/.openshift_install.log | tail -20" },
    { text: "Run post-install validation." },
    { text: "Remove unnecessary provisioning network configuration if provisioningNetwork=Disabled to reduce cluster complexity." },
    { text: "Document BMC addresses, boot MAC addresses, and provisioning network details for future node replacement procedures." },
  ],
};

export const bmUpiPrereqs = {
  id: "bm-upi-prereqs",
  version: "4.20",
  title: "Bare Metal UPI Prerequisites",
  order: 250,
  conditions: {
    platforms: ["Bare Metal"],
    methodologies: ["UPI"],
  },
  docRefs: [
    { label: "Installing a cluster on bare metal with UPI (OCP 4.20)", url: "https://docs.redhat.com/en/documentation/openshift_container_platform/4.20/html/installing/installing-on-bare-metal#installing-bare-metal-upi" },
  ],
  items: [
    { text: "For UPI bare metal, you provision ALL infrastructure: DNS, DHCP/static IPs, load balancers, PXE/virtual media, storage. The installer only generates ignition configs." },
    { text: "Configure DNS: api.{{clusterName}}.{{baseDomain}} → {{apiVip}}, api-int.{{clusterName}}.{{baseDomain}} → {{apiVip}}, *.apps.{{clusterName}}.{{baseDomain}} → {{ingressVip}}, and A records for every node." },
    { text: "Configure a load balancer (HAProxy, F5, or equivalent) with listeners on 6443 (API), 22623 (MCS, control plane only during bootstrap), 443 and 80 (ingress)." },
    { text: "Configure PXE boot server (TFTP + DHCP or HTTP boot) with the RHCOS kernel, initramfs, and rootfs artifacts. Or use virtual media with the RHCOS live ISO per node." },
    { text: "Download RHCOS bare metal artifacts for OCP {{version}} from the Red Hat mirror:", cmd: "# rhcos kernel, initramfs, rootfs URLs are embedded in the openshift-install binary:\nopenshift-install coreos print-stream-json | python3 -m json.tool | grep -E 'kernel|initramfs|rootfs'" },
    { text: "Generate ignition configs:", cmd: "openshift-install create ignition-configs --dir {{installDir}}" },
    { text: "Host the ignition files on an HTTPS server accessible from all node bootstrap addresses — bootstrap.ign, master.ign, worker.ign." },
    { text: "For each node, create a pointer ignition file that fetches the appropriate full ignition from your server:", cmd: "# pointer ignition example (base64 of JSON):\n# {\"ignition\":{\"version\":\"3.1.0\",\"config\":{\"merge\":[{\"source\":\"https://installer-host/master.ign\"}]}}}" },
    { text: "⚠ The bootstrap node needs its bootstrap.ign (large file). Do not embed it in PXE kernel arguments directly — host it via HTTPS and use a pointer ignition.", type: "warning" },
    { text: "Verify connectivity: all nodes must reach the HTTPS ignition server on their initial boot network." },
    { text: "Confirm the bootstrap node has 4 vCPU, 16 GB RAM, 100 GB disk. Destroy it after bootstrap completes." },
    { text: "Optionally pre-stage RHCOS rootfs to reduce boot time (serve locally instead of from CDN)." },
    { text: "Review OCP 4.20 UPI bare metal documentation for the complete node boot sequence and expected provisioning flow." },
    { text: "Plan for worker approval: each worker generates a CSR that must be manually approved." },
    { text: "Configure firewall to allow all required inter-node ports before booting any nodes." },
  ],
};

export const bmUpiInstall = {
  id: "bm-upi-install",
  version: "4.20",
  title: "Bare Metal UPI Installation",
  order: 715,
  conditions: {
    platforms: ["Bare Metal"],
    methodologies: ["UPI"],
  },
  docRefs: [
    { label: "Bare metal UPI — cluster creation steps (OCP 4.20)", url: "https://docs.redhat.com/en/documentation/openshift_container_platform/4.20/html/installing/installing-on-bare-metal#installing-bare-metal-upi" },
  ],
  items: [
    { text: "Boot the bootstrap node first using PXE or ISO (with bootstrap.ign or pointer ignition)." },
    { text: "Monitor bootstrap progress:", cmd: "openshift-install wait-for bootstrap-complete --dir {{installDir}} --log-level=info" },
    { text: "Boot all three control-plane nodes after the bootstrap node is initialized and serving the Machine Config Server on port 22623." },
    { text: "Monitor control-plane progress via the API server (should come up within 20–30 minutes):", cmd: "oc get nodes -l node-role.kubernetes.io/master" },
    { text: "Approve control-plane CSRs:", cmd: "oc get csr | grep Pending\noc adm certificate approve $(oc get csr -o name | xargs)" },
    { text: "Remove the bootstrap node from the load balancer backends (port 22623 and 6443) once control-plane is healthy." },
    { text: "Shut down and decommission the bootstrap node." },
    { text: "Boot worker nodes using PXE or ISO (with worker.ign or pointer ignition)." },
    { text: "Approve worker CSRs:", cmd: "watch oc get csr | grep Pending\noc adm certificate approve $(oc get csr -o name | xargs)" },
    { text: "Wait for install-complete:", cmd: "openshift-install wait-for install-complete --dir {{installDir}} --log-level=info" },
    { text: "Verify all nodes Ready:", cmd: "oc get nodes -o wide" },
    { text: "Check cluster operators:", cmd: "oc get co" },
  ],
};
