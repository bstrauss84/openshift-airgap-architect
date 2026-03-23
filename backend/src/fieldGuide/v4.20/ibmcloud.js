/**
 * v4.20 IBM Cloud compartments.
 */

export const ibmCloudIpiPrereqs = {
  id: "ibm-cloud-ipi-prereqs",
  version: "4.20",
  title: "IBM Cloud IPI Prerequisites",
  order: 250,
  conditions: {
    platforms: ["IBM Cloud"],
    methodologies: ["IPI"]
  },
  docRefs: [
    {
      label: "Installing on IBM Cloud (OCP 4.20)",
      url: "https://docs.redhat.com/en/documentation/openshift_container_platform/4.20/html/installing_on_ibm_cloud/index"
    },
    {
      label: "Installing on IBM Cloud in a disconnected environment",
      url: "https://docs.redhat.com/en/documentation/openshift_container_platform/4.20/html/installing_on_ibm_cloud/installing-ibm-cloud-restricted"
    }
  ],
  items: [
    { text: "Confirm installer-provisioned IBM Cloud install method (UPI is not supported for this platform in OCP 4.20)." },
    { text: "Prepare an existing VPC and subnets for control plane and compute nodes (one subnet per availability zone)." },
    { text: "Ensure the VPC can reach IBM service endpoints. If public endpoints are restricted, configure alternate platform.ibmcloud.serviceEndpoints values." },
    { text: "Set and export IBM Cloud API key on installer host:", cmd: "export IC_API_KEY=<api_key>" },
    { text: "Use ccoctl to prepare IAM resources and set credentialsMode: Manual in install-config.yaml." },
    { text: "Mirror release content to a reachable internal registry and include mirror mappings in install-config.yaml." },
    { text: "If using private CA for mirror or proxy, include additionalTrustBundle and optional additionalTrustBundlePolicy." },
    { text: "Optional private cluster path: set publish: Internal and validate internal DNS/resolution for API/apps endpoints." }
  ]
};

export const ibmCloudIpiInstall = {
  id: "ibm-cloud-ipi-install",
  version: "4.20",
  title: "IBM Cloud IPI Installation",
  order: 710,
  conditions: {
    platforms: ["IBM Cloud"],
    methodologies: ["IPI"]
  },
  docRefs: [
    {
      label: "Installing on IBM Cloud in a disconnected environment",
      url: "https://docs.redhat.com/en/documentation/openshift_container_platform/4.20/html/installing_on_ibm_cloud/installing-ibm-cloud-restricted"
    }
  ],
  items: [
    { text: "Place install-config.yaml in {{installDir}} and verify IBM Cloud fields: region, VPC/subnets, credentialsMode, and optional serviceEndpoints." },
    { text: "Back up install-config.yaml before running the installer.", cmd: "cp {{installDir}}/install-config.yaml {{installDir}}/install-config.yaml.bak" },
    { text: "Create IAM assets with ccoctl (manual mode) before cluster creation." },
    { text: "Start installation:", cmd: "openshift-install create cluster --dir {{installDir}} --log-level=info" },
    { text: "Wait for bootstrap and install completion:", cmd: "openshift-install wait-for bootstrap-complete --dir {{installDir}} --log-level=info\nopenshift-install wait-for install-complete --dir {{installDir}} --log-level=info" },
    { text: "Verify cluster health and operators:", cmd: "export KUBECONFIG={{installDir}}/auth/kubeconfig\noc get nodes\noc get co\noc get clusterversion" },
    { text: "Apply generated disconnected cluster-resources after install (IDMS/ITMS/CatalogSource/UpdateService as applicable)." }
  ]
};
