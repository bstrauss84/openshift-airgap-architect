/**
 * v4.20 Nutanix compartments.
 */

export const nutanixIpiPrereqs = {
  id: "nutanix-ipi-prereqs",
  version: "4.20",
  title: "Nutanix IPI Prerequisites",
  order: 250,
  conditions: {
    platforms: ["Nutanix"],
    methodologies: ["IPI"],
  },
  docRefs: [
    { label: "Installing a cluster on Nutanix (OCP 4.20)", url: "https://docs.redhat.com/en/documentation/openshift_container_platform/4.20/html/installing/installing-on-nutanix" },
    { label: "Nutanix IPI install-config reference (OCP 4.20)", url: "https://docs.redhat.com/en/documentation/openshift_container_platform/4.20/html/installing/installing-on-nutanix#installation-nutanix-config-yaml_installing-nutanix" },
  ],
  items: [
    { text: "Confirm Nutanix AOS version is 6.5.2 LTS or later (Prism Central 2023.x+ is required for OCP 4.20 IPI). Verify from Prism Central UI or API:", cmd: "curl -sk https://{{nutanixEndpoint}}:9440/api/nutanix/v3/clusters/list \\\n  -X POST -H 'Content-Type: application/json' \\\n  -d '{\"kind\":\"cluster\"}' | python3 -m json.tool | grep 'software_version'" },
    { text: "Confirm Prism Central credentials have the required roles: Prism Central Admin or a custom role with cluster list/describe, VM create/list/delete, image list/describe, and subnet list permissions." },
    { text: "Test API connectivity from the installer host to Prism Central:", cmd: "curl -sk -o /dev/null -w '%{http_code}\\n' https://{{nutanixEndpoint}}:9440/api/nutanix/v3/clusters/list \\\n  -X POST -H 'Content-Type: application/json' -d '{\"kind\":\"cluster\"}'\n# Expect: 200" },
    { text: "Obtain the Nutanix cluster UUID ({{nutanixCluster}}) and subnet UUID ({{nutanixSubnet}}) — these are required in install-config.yaml:", cmd: "# Cluster UUID:\ncurl -sk https://{{nutanixEndpoint}}:9440/api/nutanix/v3/clusters/list -X POST \\\n  -H 'Content-Type: application/json' -d '{\"kind\":\"cluster\"}' | python3 -m json.tool | grep uuid\n# Subnet UUID:\ncurl -sk https://{{nutanixEndpoint}}:9440/api/nutanix/v3/subnets/list -X POST \\\n  -H 'Content-Type: application/json' -d '{\"kind\":\"subnet\"}' | python3 -m json.tool | grep -E 'uuid|name'" },
    { text: "Set the following in install-config.yaml under platform.nutanix: prismCentral.endpoint={{nutanixEndpoint}}, prismCentral.port=9440, clusterOSImage reference, subnetUUIDs: [{{nutanixSubnet}}], prismElements[0].uuid={{nutanixCluster}}." },
    { text: "Set apiVIPs: [{{apiVip}}] and ingressVIPs: [{{ingressVip}}] in install-config.yaml — these must be free IPs on the subnet {{nutanixSubnet}}." },
    { text: "Confirm the Nutanix subnet {{nutanixSubnet}} has sufficient available IPs for all cluster nodes plus the two VIPs." },
    { text: "Verify DNS resolution of api.{{clusterName}}.{{baseDomain}} → {{apiVip}} and *.apps.{{clusterName}}.{{baseDomain}} → {{ingressVip}} from the installer host and from within the Nutanix subnet." },
    { text: "Ensure the Prism Central self-signed or custom CA certificate is trusted on the installer host (embed in additionalTrustBundle in install-config.yaml for disconnected setups)." },
    { text: "Confirm Nutanix image storage has ≥500 GB available. The RHCOS image (≈3 GB) is uploaded automatically by the installer; operators add significant storage requirements." },
    { text: "For disconnected installs, the RHCOS image for Nutanix must be available in the mirror or at an accessible HTTPS URL — configure platform.nutanix.clusterOSImage accordingly." },
    { text: "⚠ Nutanix IPI requires Prism Central to be reachable throughout the entire installation and during all lifecycle operations (upgrades, MachineSet scaling). Loss of PC connectivity during install will cause failures.", type: "warning" },
    { text: "Verify the installer host can reach Prism Central port 9440 through any intermediary firewalls." },
    { text: "Review Nutanix AHV guest VM settings: EFI boot and UEFI must be enabled for RHCOS VMs. Confirm the AHV version supports UEFI VM creation." },
    { text: "Confirm credentials are provided either in install-config.yaml (Nutanix credentials section) or via the NUTANIX_USERNAME / NUTANIX_PASSWORD environment variables." },
  ],
};

export const nutanixIpiInstall = {
  id: "nutanix-ipi-install",
  version: "4.20",
  title: "Nutanix IPI Installation",
  order: 700,
  conditions: {
    platforms: ["Nutanix"],
    methodologies: ["IPI"],
  },
  docRefs: [
    { label: "Installing a cluster on Nutanix — cluster creation (OCP 4.20)", url: "https://docs.redhat.com/en/documentation/openshift_container_platform/4.20/html/installing/installing-on-nutanix#installing-nutanix" },
  ],
  items: [
    { text: "Back up install-config.yaml before running the installer:", cmd: "cp {{installDir}}/install-config.yaml {{installDir}}/install-config.yaml.bak" },
    { text: "Start the IPI installation:", cmd: "openshift-install create cluster --dir {{installDir}} --log-level=info" },
    { text: "Monitor bootstrap-complete. The installer creates VMs in Nutanix via Prism Central API:", cmd: "openshift-install wait-for bootstrap-complete --dir {{installDir}} --log-level=info" },
    { text: "Monitor VM creation in Prism Central UI — you should see bootstrap, control-plane, and worker VMs appear in the cluster {{nutanixCluster}}." },
    { text: "If the bootstrap VM fails to pull images, verify the mirror registry {{registryFqdn}} is accessible from the Nutanix subnet and the CA trust is configured." },
    { text: "Approve any pending CSRs:", cmd: "oc get csr | grep Pending\noc adm certificate approve $(oc get csr -o name | xargs)" },
    { text: "Wait for install-complete:", cmd: "openshift-install wait-for install-complete --dir {{installDir}} --log-level=info" },
    { text: "Verify all nodes are Ready:", cmd: "export KUBECONFIG={{installDir}}/auth/kubeconfig\noc get nodes -o wide" },
    { text: "Check Nutanix Cloud Provider and CSI are operational:", cmd: "oc get pods -n openshift-cloud-controller-manager\noc get pods -n openshift-cluster-csi-drivers" },
    { text: "Test dynamic PVC provisioning via the Nutanix CSI driver:", cmd: "# Create a test PVC and verify it binds\noc apply -f - <<EOF\napiVersion: v1\nkind: PersistentVolumeClaim\nmetadata:\n  name: nutanix-test-pvc\n  namespace: default\nspec:\n  accessModes: [ReadWriteOnce]\n  storageClassName: nutanix-volume\n  resources:\n    requests:\n      storage: 5Gi\nEOF\noc get pvc nutanix-test-pvc" },
    { text: "Check cluster operators:", cmd: "oc get co" },
    { text: "Review install log for warnings:", cmd: "grep -i 'warn\\|nutanix\\|prism' {{installDir}}/.openshift_install.log | tail -20" },
  ],
};
