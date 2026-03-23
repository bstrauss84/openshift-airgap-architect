/**
 * All v4.20 compartments, re-exported as a single flat array.
 */
import {
  globalPrereqs,
  proxyConfig,
  fipsPrereqs,
  ntpConfig,
  trustBundle,
  toolsAndCreds,
  preInstallReadiness,
  postInstallValidation,
  day2Basics,
} from "./global.js";

import {
  mirrorRegistrySetup,
  ocMirrorLowSide,
  airGapTransfer,
  ocMirrorHighSide,
  clusterResourcesApply,
} from "./mirror.js";

import {
  vsphereIpiPrereqs,
  vsphereIpiInstall,
  vsphereUpiPrereqs,
  vsphereUpiInstall,
  vsphereAgentPrereqs,
  vsphereAgentInstall,
} from "./vsphere.js";

import {
  bmAgentPrereqs,
  bmAgentInstall,
  bmIpiPrereqs,
  bmIpiInstall,
  bmUpiPrereqs,
  bmUpiInstall,
} from "./baremetal.js";

import { nutanixIpiPrereqs, nutanixIpiInstall } from "./nutanix.js";

import {
  awsGovCloudPrereqs,
  awsGovCloudInstall,
  awsGovCloudUpiPrereqs,
  awsGovCloudUpiInstall,
} from "./aws.js";

import {
  azureGovPrereqs,
  azureGovInstall,
  azureGovUpiPrereqs,
  azureGovUpiInstall,
} from "./azure.js";

import {
  ibmCloudIpiPrereqs,
  ibmCloudIpiInstall
} from "./ibmcloud.js";

const compartments_v420 = [
  // Global
  globalPrereqs,
  proxyConfig,
  fipsPrereqs,
  ntpConfig,
  trustBundle,
  toolsAndCreds,
  preInstallReadiness,
  postInstallValidation,
  day2Basics,
  // Mirror
  mirrorRegistrySetup,
  ocMirrorLowSide,
  airGapTransfer,
  ocMirrorHighSide,
  clusterResourcesApply,
  // vSphere
  vsphereIpiPrereqs,
  vsphereIpiInstall,
  vsphereUpiPrereqs,
  vsphereUpiInstall,
  vsphereAgentPrereqs,
  vsphereAgentInstall,
  // Bare Metal
  bmAgentPrereqs,
  bmAgentInstall,
  bmIpiPrereqs,
  bmIpiInstall,
  bmUpiPrereqs,
  bmUpiInstall,
  // Nutanix
  nutanixIpiPrereqs,
  nutanixIpiInstall,
  // AWS GovCloud
  awsGovCloudPrereqs,
  awsGovCloudInstall,
  awsGovCloudUpiPrereqs,
  awsGovCloudUpiInstall,
  // Azure Government
  azureGovPrereqs,
  azureGovInstall,
  azureGovUpiPrereqs,
  azureGovUpiInstall,
  // IBM Cloud
  ibmCloudIpiPrereqs,
  ibmCloudIpiInstall,
];

export { compartments_v420 };
