/**
 * v4.20 Azure Government compartments.
 */

export const azureGovPrereqs = {
  id: "azure-gov-prereqs",
  version: "4.20",
  title: "Azure Government Prerequisites",
  order: 250,
  conditions: {
    platforms: ["Azure Government"],
    methodologies: ["IPI"],
  },
  docRefs: [
    { label: "Installing a cluster on Azure Government (OCP 4.20)", url: "https://docs.redhat.com/en/documentation/openshift_container_platform/4.20/html/installing/installing-on-azure" },
    { label: "Azure install-config reference (OCP 4.20)", url: "https://docs.redhat.com/en/documentation/openshift_container_platform/4.20/html/installing/installing-on-azure#installation-azure-config-yaml_installing-azure" },
  ],
  items: [
    { text: "Confirm you have an active Azure Government subscription in region {{azureRegion}} (cloudName: {{azureCloudName}})." },
    { text: "Configure Azure CLI for Government cloud and log in:", cmd: "az cloud set --name AzureUSGovernment\naz login\n# Verify:\naz account show" },
    { text: "Set environment credentials for the installer (Service Principal):", cmd: "export AZURE_CLIENT_ID=...\nexport AZURE_CLIENT_SECRET=...\nexport AZURE_TENANT_ID=...\nexport AZURE_SUBSCRIPTION_ID=..." },
    { text: "Verify the Service Principal has Contributor role on the subscription and User Access Administrator role (required for assigning roles to cluster identity)." },
    { text: "Confirm the base domain DNS zone exists in the resource group. Set platform.azure.baseDomainResourceGroupName in install-config.yaml:", cmd: "az network dns zone list --cloud AzureUSGovernment | grep {{baseDomain}}" },
    { text: "Set platform.azure.cloudName: {{azureCloudName}}, platform.azure.region: {{azureRegion}}, and platform.azure.resourceGroupName in install-config.yaml." },
    { text: "Confirm VM quota is sufficient in {{azureRegion}} for OCP cluster (3 control plane + N workers). Standard_D8s_v3 is recommended for control plane; check GovCloud availability:" , cmd: "az vm list-usage --location {{azureRegion}} --cloud AzureUSGovernment | grep 'Standard DSv3'" },
    { text: "For disconnected installs: set up a VNet with private subnets and Azure Private Endpoints for ACR / storage. Ensure the mirror registry {{registryFqdn}} is reachable from within the VNet." },
    { text: "Configure platform.azure.networkResourceGroupName and platform.azure.virtualNetwork if using an existing VNet." },
    { text: "For private clusters, set publish: Internal in install-config.yaml and configure Private DNS zones for api.{{clusterName}}.{{baseDomain}}." },
    { text: "Verify the credentialsMode: Manual or Mint — for GovCloud disconnected, Manual is typically required. Generate CredentialsRequests and IAM resources before install." },
    { text: "⚠ Azure Government regions may have different VM SKU availability than commercial Azure. Always validate instance type availability in {{azureRegion}} before starting the install.", type: "warning" },
  ],
};

export const azureGovInstall = {
  id: "azure-gov-install",
  version: "4.20",
  title: "Azure Government Installation",
  order: 700,
  conditions: {
    platforms: ["Azure Government"],
    methodologies: ["IPI"],
  },
  docRefs: [
    { label: "Installing a cluster on Azure — create cluster (OCP 4.20)", url: "https://docs.redhat.com/en/documentation/openshift_container_platform/4.20/html/installing/installing-on-azure#installing-azure" },
  ],
  items: [
    { text: "Place install-config.yaml in {{installDir}}. If you used the app and downloaded the export bundle, copy it from the bundle (it already has the Azure cloud name, region, and resource group settings).", cmd: "mkdir -p {{installDir}}\ncp /path/to/bundle/install-config.yaml {{installDir}}/" },
    { text: "Back up install-config.yaml:", cmd: "cp {{installDir}}/install-config.yaml {{installDir}}/install-config.yaml.bak" },
    { text: "For manual credentials mode, create manifests and process CredentialsRequests:", cmd: "openshift-install create manifests --dir {{installDir}}\n# Use ccoctl azure to create managed identities for each component" },
    { text: "Start the installation:", cmd: "openshift-install create cluster --dir {{installDir}} --log-level=info" },
    { text: "Monitor bootstrap-complete. Azure VMs will be created in resource group and region {{azureRegion}}:", cmd: "openshift-install wait-for bootstrap-complete --dir {{installDir}} --log-level=info" },
    { text: "Monitor VM creation in Azure Portal or CLI:", cmd: "az vm list --resource-group {{clusterName}}-rg --cloud AzureUSGovernment --query '[].{name:name,state:powerState}'" },
    { text: "Wait for install-complete:", cmd: "openshift-install wait-for install-complete --dir {{installDir}} --log-level=info" },
    { text: "Verify cluster access:", cmd: "export KUBECONFIG={{installDir}}/auth/kubeconfig\noc get nodes\noc get co" },
    { text: "Verify Azure Cloud Provider is operational:", cmd: "oc get pods -n openshift-cloud-controller-manager\noc get pods -n openshift-cluster-storage-operator" },
    { text: "Confirm Azure Disk CSI driver is healthy:", cmd: "oc get csidriver disk.csi.azure.com" },
    { text: "Check cluster operators:", cmd: "oc get co" },
    { text: "Review install log for warnings:", cmd: "grep -i 'warn\\|error\\|azure' {{installDir}}/.openshift_install.log | tail -20" },
    { text: "Verify the cluster resource group was created in Azure Government portal and all required resources are present (VMs, LBs, NSGs, Managed Disks)." },
  ],
};

export const azureGovUpiPrereqs = {
  id: "azure-gov-upi-prereqs",
  version: "4.20",
  title: "Azure Government UPI Prerequisites",
  order: 250,
  conditions: {
    platforms: ["Azure Government"],
    methodologies: ["UPI"],
  },
  docRefs: [
    { label: "Installing a cluster on Azure with UPI (OCP 4.20)", url: "https://docs.redhat.com/en/documentation/openshift_container_platform/4.20/html/installing/installing-on-azure#installing-azure-user-infra" },
  ],
  items: [
    { text: "For UPI on Azure Government, provision all Azure resources manually: VNet, subnets, NSGs, LBs, DNS zones, VMs." },
    { text: "Use the OCP UPI ARM templates (from the installer artifacts) adapted for {{azureCloudName}} resource naming." },
    { text: "Create the resource group, VNet, and subnets in {{azureRegion}}. For private clusters, disable public IPs on subnets." },
    { text: "Create internal load balancers for API (6443, 22623) and ingress (80, 443). Use Azure Standard LB (Basic LB is not supported for OCP)." },
    { text: "Configure Private DNS zones for {{clusterName}}.{{baseDomain}} within the VNet." },
    { text: "Generate ignition configs:", cmd: "openshift-install create ignition-configs --dir {{installDir}}" },
    { text: "Store bootstrap.ign in Azure Blob Storage (private container accessible from the bootstrap VM via managed identity or SAS token)." },
    { text: "Create VMs with the RHCOS VHD image. Upload or use the Azure Marketplace RHCOS image for OCP {{version}}." },
    { text: "Pass ignition config to VMs via custom data (bootstrap: SAS URL pointer; control-plane/workers: encoded ignition JSON)." },
    { text: "⚠ Azure custom data has an 87 KB limit. Use the SAS URL pointer for bootstrap. Control-plane and worker ignition must be base64-encoded and passed as customData.", type: "warning" },
    { text: "Monitor VM boot status in Azure Portal or CLI." },
  ],
};

export const azureGovUpiInstall = {
  id: "azure-gov-upi-install",
  version: "4.20",
  title: "Azure Government UPI Installation",
  order: 720,
  conditions: {
    platforms: ["Azure Government"],
    methodologies: ["UPI"],
  },
  docRefs: [
    { label: "Azure UPI — cluster installation steps (OCP 4.20)", url: "https://docs.redhat.com/en/documentation/openshift_container_platform/4.20/html/installing/installing-on-azure#installation-azure-user-infra-installation_installing-azure-user-infra" },
  ],
  items: [
    { text: "Monitor bootstrap-complete:", cmd: "openshift-install wait-for bootstrap-complete --dir {{installDir}} --log-level=info" },
    { text: "Approve control-plane CSRs:", cmd: "oc get csr | grep Pending\noc adm certificate approve $(oc get csr -o name | xargs)" },
    { text: "Remove bootstrap VM from LB backend pool after bootstrap-complete:", cmd: "az network lb address-pool address remove --pool-name <api-pool> \\\n  --lb-name <lb-name> -n bootstrap --resource-group <rg>" },
    { text: "Delete bootstrap VM and its associated NIC/OS disk after removing from LB." },
    { text: "Approve worker CSRs:", cmd: "oc get csr | grep Pending\noc adm certificate approve $(oc get csr -o name | xargs)" },
    { text: "Wait for install-complete:", cmd: "openshift-install wait-for install-complete --dir {{installDir}} --log-level=info" },
    { text: "Verify cluster:", cmd: "oc get nodes\noc get co" },
    { text: "Clean up the Blob Storage bootstrap.ign after install is confirmed.", cmd: "az storage blob delete --account-name <storage-acct> --container-name ocp-bootstrap --name bootstrap.ign" },
    { text: "Remove any temporary NSG rules added for bootstrap if applicable." },
    { text: "Verify the Private DNS zone records are correct for api and *.apps subdomains." },
  ],
};
