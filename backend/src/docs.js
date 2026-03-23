/** Doc link cache for field manual; version-specific OpenShift docs URLs, refresh via update job. */
import { db } from "./db.js";
import { createJob, updateJob } from "./utils.js";

const baseDocs = (version) =>
  `https://docs.redhat.com/en/documentation/openshift_container_platform/${version}/html`;

const mapping = {
  common: (version) => [
    {
      id: "mirror-v2",
      label: "Mirroring images for disconnected installations (oc-mirror v2)",
      urls: [
        `${baseDocs(version)}/disconnected_environments/about-installing-oc-mirror-v2`,
        `${baseDocs(version)}/disconnected_environments/mirroring-in-disconnected-environments`,
        `${baseDocs(version)}/installing/disconnected-installation-mirroring`
      ]
    },
    {
      id: "custom-pki",
      label: "Configuring a custom PKI (additionalTrustBundle)",
      urls: [
        `${baseDocs(version)}/configuring_network_settings/configuring-a-custom-pki`,
        `${baseDocs(version)}/security_and_compliance/configuring-a-custom-pki`
      ]
    },
    {
      id: "preparing-nodes",
      label: "Preparing host infrastructure for OpenShift",
      urls: [
        `${baseDocs(version)}/installing/installing-preparing`,
        `${baseDocs(version)}/installing_on_any_platform/installing-platform-agnostic`
      ]
    }
  ],
  platform: {
    "Bare Metal": (version, method) => {
      if (method === "Agent-Based Installer") {
        return [
          {
            id: "agent-bm",
            label: "Agent-based Installer configuration parameters",
            urls: [
              `${baseDocs(version)}/installing_an_on-premise_cluster_with_the_agent-based_installer/installation-config-parameters-agent`,
              `${baseDocs(version)}/installing_an_on-premise_cluster_with_the_agent-based_installer/preparing-to-install-with-agent-based-installer`
            ]
          }
        ];
      }
      return [
        {
          id: "bm-install",
          label: "Installing on bare metal",
          urls: [
            `${baseDocs(version)}/installing_on_any_platform/installing-platform-agnostic`,
            `${baseDocs(version)}/installing/installing_bare_metal`
          ]
        },
        {
          id: "bm-ipi",
          label: "Installing on bare metal with installer-provisioned infrastructure",
          urls: [
            `${baseDocs(version)}/installing_on_bare_metal/installer-provisioned-infrastructure`,
            `${baseDocs(version)}/installing/installing_bare_metal`
          ]
        },
        {
          id: "bm-upi",
          label: "Installing on bare metal with user-provisioned infrastructure",
          urls: [
            `${baseDocs(version)}/installing_on_bare_metal/user-provisioned-infrastructure`,
            `${baseDocs(version)}/installing/installing_bare_metal/installing-bare-metal#installing-bare-metal-user-provisioned`
          ]
        }
      ];
    },
    "VMware vSphere": (version, method) => {
      const shared = [
        {
          id: "vsphere-install",
          label: "vSphere install-config parameters",
          urls: [
            `${baseDocs(version)}/installing_on_vmware_vsphere/installation-config-parameters-vsphere`,
            `${baseDocs(version)}/installing_on_vmware_vsphere/index`
          ]
        },
        {
          id: "vsphere-ipi",
          label: "Installing on vSphere with installer-provisioned infrastructure",
          urls: [
            `${baseDocs(version)}/installing_on_vmware_vsphere/installer-provisioned-infrastructure`,
            `${baseDocs(version)}/installing_on_vmware_vsphere/installing-vsphere`
          ]
        },
        {
          id: "vsphere-upi",
          label: "Installing on vSphere with user-provisioned infrastructure",
          urls: [
            `${baseDocs(version)}/installing_on_vmware_vsphere/user-provisioned-infrastructure`,
            `${baseDocs(version)}/installing_on_vmware_vsphere/installing-vsphere-upi`
          ]
        },
        {
          id: "vsphere-disconnected",
          label: "Installing a cluster on vSphere in a disconnected environment",
          urls: [
            `${baseDocs(version)}/installing_on_vmware_vsphere/installing-vsphere-disconnected`,
            `${baseDocs(version)}/disconnected_environments/installing-disconnected-environments`
          ]
        }
      ];
      if (method === "Agent-Based Installer") {
        return [
          {
            id: "vsphere-agent-based-params",
            label: "Agent-based Installer (Chapter 9 install-config and agent-config parameters)",
            urls: [
              `${baseDocs(version)}/installing_an_on-premise_cluster_with_the_agent-based_installer/installation-config-parameters-agent`,
              `${baseDocs(version)}/installing_an_on-premise_cluster_with_the_agent-based_installer/`
            ]
          },
          ...shared
        ];
      }
      return shared;
    },
    Nutanix: (version) => [
      {
        id: "nutanix-install",
        label: "Nutanix install-config parameters",
        urls: [
          `${baseDocs(version)}/installing_on_nutanix/installation-config-parameters-nutanix`,
          `${baseDocs(version)}/installing_on_nutanix/index`
        ]
      },
      {
        id: "nutanix-disconnected",
        label: "Installing a cluster on Nutanix in a disconnected environment",
        urls: [
          `${baseDocs(version)}/installing_on_nutanix/installing-nutanix-disconnected`,
          `${baseDocs(version)}/installing_on_nutanix/installing-nutanix-restricted-network`
        ]
      }
    ],
    "AWS GovCloud": (version) => [
      {
        id: "aws-govcloud",
        label: "AWS install-config parameters",
        urls: [
          `${baseDocs(version)}/installing_on_aws/installation-config-parameters-aws`,
          `${baseDocs(version)}/installing_on_aws/index`,
          `${baseDocs(version)}/installing_on_aws/installing-aws-government-region`
        ]
      },
      {
        id: "aws-methods",
        label: "AWS installation methods (includes restricted network and gov/secret regions)",
        urls: [
          `${baseDocs(version)}/installing_on_aws/installing-methods-aws`,
          `${baseDocs(version)}/installing_on_aws/installation-methods-aws`
        ]
      },
      {
        id: "aws-existing-vpc",
        label: "Installing on AWS into an existing VPC",
        urls: [
          `${baseDocs(version)}/installing_on_aws/installing-aws-vpc`,
          `${baseDocs(version)}/installing_on_aws/installing-aws-existing-vpc`
        ]
      },
      {
        id: "aws-private-vpc",
        label: "Installing a private cluster on an existing VPC",
        urls: [
          `${baseDocs(version)}/installing_on_aws/installing-aws-private`,
          `${baseDocs(version)}/installing_on_aws/installing-aws-private-vpc`
        ]
      },
      {
        id: "aws-restricted-ipi",
        label: "Installing on AWS in a restricted network (IPI)",
        urls: [
          `${baseDocs(version)}/installing_on_aws/installing-restricted-networks-aws-installer-provisioned`,
          `${baseDocs(version)}/installing_on_aws/installing-aws-restricted-networks-ipi`,
          `${baseDocs(version)}/disconnected_environments/installing-restricted-networks`
        ]
      },
      {
        id: "aws-restricted-upi",
        label: "Installing on AWS in a restricted network (UPI)",
        urls: [
          `${baseDocs(version)}/installing_on_aws/installing-restricted-networks-aws`,
          `${baseDocs(version)}/installing_on_aws/installing-aws-restricted-networks-upi`,
          `${baseDocs(version)}/disconnected_environments/installing-restricted-networks`
        ]
      },
      {
        id: "aws-gov-secret",
        label: "Installing on AWS into government or secret regions",
        urls: [
          `${baseDocs(version)}/installing_on_aws/installing-aws-government-region`,
          `${baseDocs(version)}/installing_on_aws/installing-aws-secret-region`
        ]
      }
    ],
    "Azure Government": (version) => [
      {
        id: "azure-government",
        label: "Azure install-config parameters",
        urls: [
          `${baseDocs(version)}/installing_on_azure/installation-config-parameters-azure`,
          `${baseDocs(version)}/installing_on_azure/index`
        ]
      },
      {
        id: "azure-ipi",
        label: "Installing on Azure with installer-provisioned infrastructure",
        urls: [
          `${baseDocs(version)}/installing_on_azure/installer-provisioned-infrastructure`,
          `${baseDocs(version)}/installing_on_azure/installing-azure`
        ]
      },
      {
        id: "azure-upi",
        label: "Installing on Azure with user-provisioned infrastructure",
        urls: [
          `${baseDocs(version)}/installing_on_azure/user-provisioned-infrastructure`,
          `${baseDocs(version)}/installing_on_azure/installing-azure-upi`
        ]
      },
      {
        id: "azure-disconnected",
        label: "Installing a cluster on Azure in a disconnected environment",
        urls: [
          `${baseDocs(version)}/installing_on_azure/installing-azure-disconnected`,
          `${baseDocs(version)}/disconnected_environments/installing-disconnected-environments`
        ]
      }
    ],
    "IBM Cloud": (version) => [
      {
        id: "ibm-cloud-install",
        label: "Installing on IBM Cloud",
        urls: [
          `${baseDocs(version)}/installing_on_ibm_cloud/index`,
          `${baseDocs(version)}/installing_on_ibm_cloud/installing-ibm-cloud-restricted`
        ]
      },
      {
        id: "ibm-cloud-params",
        label: "IBM Cloud installation configuration parameters",
        urls: [
          `https://docs.redhat.com/en/documentation/openshift_container_platform/${version}/html-single/installing_on_ibm_cloud/`
        ]
      },
      {
        id: "ibm-cloud-disconnected",
        label: "Installing a cluster on IBM Cloud in a disconnected environment",
        urls: [
          `${baseDocs(version)}/installing_on_ibm_cloud/installing-ibm-cloud-restricted`,
          `${baseDocs(version)}/disconnected_environments/installing-disconnected-environments`
        ]
      }
    ]
  },
  methodology: {
    IPI: (version) => [
      {
        id: "ipi",
        label: "Installer-provisioned installation overview",
        urls: [
          `${baseDocs(version)}/installing/installing_overview`,
          `${baseDocs(version)}/installing_on_any_platform/installing-platform-agnostic`
        ]
      }
    ],
    UPI: (version) => [
      {
        id: "upi",
        label: "User-provisioned installation overview",
        urls: [
          `${baseDocs(version)}/installing_on_any_platform/installing-platform-agnostic`,
          `${baseDocs(version)}/installing/installing_bare_metal/installing-bare-metal#installing-bare-metal-user-provisioned`
        ]
      }
    ],
    "Agent-Based Installer": (version) => [
      {
        id: "abi",
        label: "Agent-based Installer workflow",
        urls: [
          `${baseDocs(version)}/installing_an_on-premise_cluster_with_the_agent-based_installer/preparing-to-install-with-agent-based-installer`,
          `${baseDocs(version)}/installing_an_on-premise_cluster_with_the_agent-based_installer/installation-config-parameters-agent`
        ]
      }
    ]
  },
  connectivity: {
    "fully-disconnected": (version) => [
      {
        id: "disconnected",
        label: "Disconnected installation considerations",
        urls: [
          `${baseDocs(version)}/disconnected_environments/mirroring-in-disconnected-environments`,
          `${baseDocs(version)}/installing/installing-mirroring-installation-images`
        ]
      }
    ],
    jumpbox: (version) => [
      {
        id: "jumpbox",
        label: "Restricted network installations",
        urls: [
          `${baseDocs(version)}/disconnected_environments/installing-restricted-networks`,
          `${baseDocs(version)}/installing/installing-restricted-networks`
        ]
      }
    ]
  }
};

const validateUrl = async (url) => {
  try {
    const res = await fetch(url, { redirect: "follow" });
    if (!res.ok) return null;
    if (res.status === 403 || res.status === 429) return null;
    const finalUrl = res.url;
    if (!finalUrl.includes("docs.redhat.com")) return null;
    return finalUrl;
  } catch {
    return null;
  }
};

const buildDocsList = ({ version, platform, methodology, connectivity }) => {
  const list = [
    ...mapping.common(version),
    ...(mapping.platform[platform] ? mapping.platform[platform](version, methodology) : []),
    ...(mapping.methodology[methodology] ? mapping.methodology[methodology](version) : []),
    ...(connectivity && mapping.connectivity[connectivity] ? mapping.connectivity[connectivity](version) : [])
  ];
  return list;
};

const docsKey = (version, platform, methodology, connectivity) =>
  `docs:${version}:${platform}:${methodology}:${connectivity || "unknown"}`;

const getDocsFromCache = (key) => {
  const row = db.prepare("SELECT links_json, updated_at FROM docs_links WHERE key = ?").get(key);
  if (!row) return null;
  return { links: JSON.parse(row.links_json), updatedAt: row.updated_at };
};

const storeDocs = (key, links) => {
  db.prepare(
    "INSERT INTO docs_links (key, links_json, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET links_json = excluded.links_json, updated_at = excluded.updated_at"
  ).run(key, JSON.stringify(links), Date.now());
};

const updateDocsLinks = async ({ version, platform, methodology, connectivity }) => {
  const jobId = createJob("docs-update", "Validating official documentation links...");
  updateJob(jobId, { status: "running", progress: 5 });
  const entries = buildDocsList({ version, platform, methodology, connectivity });
  const validated = [];
  let progress = 5;
  const step = entries.length ? Math.round(80 / entries.length) : 80;
  for (const entry of entries) {
    const candidates = entry.urls || [entry.url];
    let finalUrl = null;
    for (const candidate of candidates) {
      // eslint-disable-next-line no-await-in-loop
      finalUrl = await validateUrl(candidate);
      if (finalUrl) break;
    }
    if (finalUrl) {
      validated.push({ ...entry, url: finalUrl, validated: true });
    } else {
      validated.push({ ...entry, url: candidates[0], validated: false });
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
    progress += step;
    updateJob(jobId, { progress });
  }
  updateJob(jobId, { status: "completed", progress: 100, message: "Documentation links updated." });
  return { jobId, validated };
};

export {
  buildDocsList,
  updateDocsLinks,
  docsKey,
  getDocsFromCache,
  storeDocs
};
