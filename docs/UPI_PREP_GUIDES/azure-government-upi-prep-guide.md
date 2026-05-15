# Azure Government UPI Preparation Guide

**Platform:** Microsoft Azure Government  
**Install Method:** User-Provisioned Infrastructure (UPI)  
**OpenShift Version:** 4.20  
**Last Updated:** 2026-05-15

---

## Table of Contents

- [Overview](#overview)
- [Infrastructure Prerequisites Checklist](#infrastructure-prerequisites-checklist)
- [Azure Account and Service Principal Prerequisites](#azure-account-and-service-principal-prerequisites)
- [VNET and Networking Configuration](#vnet-and-networking-configuration)
- [DNS Configuration (Azure DNS)](#dns-configuration-azure-dns)
- [Load Balancer Configuration (Azure Standard Load Balancer)](#load-balancer-configuration-azure-standard-load-balancer)
- [Storage Account for Ignition (Optional)](#storage-account-for-ignition-optional)
- [VM Provisioning](#vm-provisioning)
- [Mirror Registry Checklist (For Disconnected)](#mirror-registry-checklist-for-disconnected)
- [Trust Bundle Preparation](#trust-bundle-preparation)
- [Pull Secret Preparation](#pull-secret-preparation)
- [Network CIDR Planning](#network-cidr-planning)
- [Validation Commands](#validation-commands)
- [Next Steps](#next-steps)

---

## Overview

Azure Government UPI installations require manual provisioning of Azure resources before running the OpenShift installer. This includes:

- Azure Government subscription with sufficient quotas
- Virtual Network (VNET) with public and private subnets
- Service principal with required permissions for cluster operation
- Azure Standard Load Balancer for API, Machine Config Server, and Ingress
- Azure DNS zone and DNS records
- Network Security Groups (NSGs) with required firewall rules
- Optional: Azure Storage Account for hosting ignition files
- Virtual Machines (VMs) from RHCOS VHD image

**Key characteristic:** `platform.azure` block in install-config.yaml with `cloudName: AzureUSGovernmentCloud`. User provisions ALL Azure resources manually before installation.

**Reference documentation:**
- OpenShift 4.20 Installing on Azure Government: User-provisioned infrastructure  
  https://docs.redhat.com/en/documentation/openshift_container_platform/4.20/html/installing_on_azure_government/installing-azure-government-upi
- Deep application documentation: `docs/SCENARIOS_CLOUD_FAMILY.md`

---

## Infrastructure Prerequisites Checklist

### Azure Government Account Requirements

- [ ] Active Azure Government subscription
- [ ] Azure CLI configured for Azure Government
- [ ] Sufficient service quotas (VMs, VNETs, Public IPs, Load Balancers)
- [ ] Region selected: `usgovvirginia`, `usgovtexas`, `usgovarizona`, or `usdodeast`/`usdodcentral`

**Verify Azure CLI configuration:**

```bash
# Configure Azure CLI for Azure Government cloud
az cloud set --name AzureUSGovernment

# Login
az login

# Verify subscription
az account show
# Should show: "environmentName": "AzureUSGovernmentCloud"

# List regions
az account list-locations --output table
```

### Cluster Size Requirements

**Minimum cluster configuration:**

| Node Type | Count | VM Size | vCPU | RAM | Disk | Purpose |
|-----------|-------|---------|------|-----|------|---------|
| Bootstrap | 1 | Standard_D4s_v3 | 4 | 16 GB | 120 GB Premium SSD | Temporary VM for bootstrapping (deleted after install) |
| Control Plane | 3 | Standard_D8s_v3 | 8 | 32 GB | 120 GB Premium SSD | etcd + control plane services |
| Worker (optional) | 2+ | Standard_D4s_v3 | 4 | 16 GB | 120 GB Premium SSD | Application workloads |

**Topology options:**
- **Compact cluster:** 3 control plane, 0 workers (control plane nodes also run workloads)
- **HA cluster:** 3 control plane, 2+ workers (production recommended)

### Service Quotas Check

```bash
# Check VM quota for region
az vm list-usage --location usgovvirginia --output table

# Check if you have enough quota for:
# - Standard DSv3 Family vCPUs (need at least 24 for compact, 40 for HA)
# - Public IP Addresses (need at least 2)
# - Standard Load Balancers (need at least 2)

# Request quota increase if needed:
# https://portal.azure.us → Support → New support request → Issue type: Service and subscription limits
```

---

## Azure Account and Service Principal Prerequisites

### Service Principal Creation

OpenShift control plane and worker nodes require a service principal with specific permissions.

**Create service principal:**

```bash
# Set variables
CLUSTER_NAME="ocp-cluster"
RESOURCE_GROUP="${CLUSTER_NAME}-rg"
LOCATION="usgovvirginia"

# Create resource group (if not exists)
az group create --name $RESOURCE_GROUP --location $LOCATION

# Create service principal
SP_OUTPUT=$(az ad sp create-for-rbac \
  --name "openshift-${CLUSTER_NAME}" \
  --role Contributor \
  --scopes /subscriptions/$(az account show --query id -o tsv)/resourceGroups/$RESOURCE_GROUP)

# Extract credentials
CLIENT_ID=$(echo $SP_OUTPUT | jq -r '.appId')
CLIENT_SECRET=$(echo $SP_OUTPUT | jq -r '.password')
TENANT_ID=$(echo $SP_OUTPUT | jq -r '.tenant')

# Save credentials securely
echo "Client ID (appId): $CLIENT_ID"
echo "Client Secret (password): $CLIENT_SECRET"
echo "Tenant ID: $TENANT_ID"
```

**Required permissions:**
- **Contributor** role on the resource group (minimum)
- **Network Contributor** on the VNET (if VNET is in separate resource group)
- **DNS Zone Contributor** on the DNS zone (if using Azure DNS)

**Validate service principal:**

```bash
# Test service principal login
az login --service-principal \
  --username $CLIENT_ID \
  --password $CLIENT_SECRET \
  --tenant $TENANT_ID

# Verify access
az group show --name $RESOURCE_GROUP
```

---

## VNET and Networking Configuration

### VNET Architecture

**Required resources:**
- 1 VNET with CIDR block (e.g., 10.0.0.0/16)
- 2+ subnets (control plane subnet + worker subnet, or combined)
- NAT Gateway OR Azure Firewall for outbound internet (for connected deployments)
- Network Security Groups (NSGs) for control plane and worker subnets

**Checklist:**

- [ ] VNET created with appropriate CIDR
- [ ] Control plane subnet created (e.g., 10.0.0.0/24)
- [ ] Worker subnet created (e.g., 10.0.1.0/24) OR use same subnet
- [ ] NAT Gateway created and associated with subnets (for outbound connectivity)
- [ ] NSGs created for control plane and worker subnets
- [ ] NSG rules configured for required ports

**Create VNET:**

```bash
# Set variables
VNET_NAME="${CLUSTER_NAME}-vnet"
VNET_CIDR="10.0.0.0/16"
CONTROL_PLANE_SUBNET_NAME="control-plane-subnet"
CONTROL_PLANE_SUBNET_CIDR="10.0.0.0/24"
WORKER_SUBNET_NAME="worker-subnet"
WORKER_SUBNET_CIDR="10.0.1.0/24"

# Create VNET
az network vnet create \
  --resource-group $RESOURCE_GROUP \
  --name $VNET_NAME \
  --address-prefix $VNET_CIDR \
  --location $LOCATION

# Create control plane subnet
az network vnet subnet create \
  --resource-group $RESOURCE_GROUP \
  --vnet-name $VNET_NAME \
  --name $CONTROL_PLANE_SUBNET_NAME \
  --address-prefix $CONTROL_PLANE_SUBNET_CIDR

# Create worker subnet
az network vnet subnet create \
  --resource-group $RESOURCE_GROUP \
  --vnet-name $VNET_NAME \
  --name $WORKER_SUBNET_NAME \
  --address-prefix $WORKER_SUBNET_CIDR
```

### Network Security Groups

**Create NSGs:**

```bash
# Create control plane NSG
az network nsg create \
  --resource-group $RESOURCE_GROUP \
  --name ${CLUSTER_NAME}-controlplane-nsg \
  --location $LOCATION

# Create worker NSG
az network nsg create \
  --resource-group $RESOURCE_GROUP \
  --name ${CLUSTER_NAME}-worker-nsg \
  --location $LOCATION

# Associate NSGs with subnets
az network vnet subnet update \
  --resource-group $RESOURCE_GROUP \
  --vnet-name $VNET_NAME \
  --name $CONTROL_PLANE_SUBNET_NAME \
  --network-security-group ${CLUSTER_NAME}-controlplane-nsg

az network vnet subnet update \
  --resource-group $RESOURCE_GROUP \
  --vnet-name $VNET_NAME \
  --name $WORKER_SUBNET_NAME \
  --network-security-group ${CLUSTER_NAME}-worker-nsg
```

**Required NSG rules:**

| Direction | Port | Protocol | Source | Destination | Purpose |
|-----------|------|----------|--------|-------------|---------|
| Inbound | 6443 | TCP | Internet | Control plane LB | Kubernetes API |
| Inbound | 22623 | TCP | VNET | Control plane nodes | Machine Config Server |
| Inbound | 80 | TCP | Internet | Worker LB | HTTP ingress |
| Inbound | 443 | TCP | Internet | Worker LB | HTTPS ingress |
| Inbound | 22 | TCP | VNET | All nodes | SSH (optional) |
| Inbound | * | * | VNET | VNET | All internal traffic |

**Add NSG rules (example for API):**

```bash
# Allow API access from internet
az network nsg rule create \
  --resource-group $RESOURCE_GROUP \
  --nsg-name ${CLUSTER_NAME}-controlplane-nsg \
  --name AllowAPIInbound \
  --priority 1000 \
  --source-address-prefixes '*' \
  --source-port-ranges '*' \
  --destination-address-prefixes '*' \
  --destination-port-ranges 6443 \
  --access Allow \
  --protocol Tcp \
  --direction Inbound
```

### NAT Gateway (For Outbound Connectivity)

**Create NAT Gateway:**

```bash
# Create public IP for NAT Gateway
az network public-ip create \
  --resource-group $RESOURCE_GROUP \
  --name ${CLUSTER_NAME}-nat-pip \
  --sku Standard \
  --location $LOCATION

# Create NAT Gateway
az network nat gateway create \
  --resource-group $RESOURCE_GROUP \
  --name ${CLUSTER_NAME}-nat-gateway \
  --public-ip-addresses ${CLUSTER_NAME}-nat-pip \
  --idle-timeout 10 \
  --location $LOCATION

# Associate NAT Gateway with subnets
az network vnet subnet update \
  --resource-group $RESOURCE_GROUP \
  --vnet-name $VNET_NAME \
  --name $CONTROL_PLANE_SUBNET_NAME \
  --nat-gateway ${CLUSTER_NAME}-nat-gateway

az network vnet subnet update \
  --resource-group $RESOURCE_GROUP \
  --vnet-name $VNET_NAME \
  --name $WORKER_SUBNET_NAME \
  --nat-gateway ${CLUSTER_NAME}-nat-gateway
```

---

## DNS Configuration (Azure DNS)

### Azure DNS Zone

**Required DNS records:**

- [ ] **Public DNS zone** for base domain (e.g., `example.com`)
- [ ] **A record:** `api.<cluster-name>.<base-domain>` → External Load Balancer Public IP
- [ ] **A record:** `api-int.<cluster-name>.<base-domain>` → Internal Load Balancer Private IP
- [ ] **A record (wildcard):** `*.apps.<cluster-name>.<base-domain>` → Ingress Load Balancer Public IP

**Create DNS zone:**

```bash
# Create public DNS zone (if not exists)
DNS_ZONE="example.com"
az network dns zone create \
  --resource-group $RESOURCE_GROUP \
  --name $DNS_ZONE

# Get DNS zone nameservers
az network dns zone show \
  --resource-group $RESOURCE_GROUP \
  --name $DNS_ZONE \
  --query nameServers
```

**Create DNS records (after load balancers created):**

```bash
# Create API record (A record to external LB public IP)
az network dns record-set a add-record \
  --resource-group $RESOURCE_GROUP \
  --zone-name $DNS_ZONE \
  --record-set-name api.ocp \
  --ipv4-address <external-lb-public-ip>

# Create API-INT record (A record to internal LB private IP)
az network dns record-set a add-record \
  --resource-group $RESOURCE_GROUP \
  --zone-name $DNS_ZONE \
  --record-set-name api-int.ocp \
  --ipv4-address <internal-lb-private-ip>

# Create wildcard ingress record
az network dns record-set a add-record \
  --resource-group $RESOURCE_GROUP \
  --zone-name $DNS_ZONE \
  --record-set-name *.apps.ocp \
  --ipv4-address <ingress-lb-public-ip>
```

### Validation

```bash
# Test DNS resolution
nslookup api.ocp.example.com
nslookup api-int.ocp.example.com
nslookup test.apps.ocp.example.com

# Verify A records resolve to correct IPs
dig api.ocp.example.com
```

**DNS Templates:** See `dns-examples/azure-dns-terraform.tf` for Terraform automation example (to be created).

---

## Load Balancer Configuration (Azure Standard Load Balancer)

Azure Government UPI requires Azure Standard Load Balancers for API, MCS, and Ingress traffic.

### Load Balancer Architecture

**Required load balancers:**
1. **External API Load Balancer** (internet-facing, port 6443)
2. **Internal API/MCS Load Balancer** (internal, ports 6443 + 22623)
3. **Ingress Load Balancer** (internet-facing, ports 80 + 443)

**Alternative (acceptable for non-production):**
- Combine external API + ingress into single internet-facing LB

### Create External API Load Balancer

```bash
# Create public IP
az network public-ip create \
  --resource-group $RESOURCE_GROUP \
  --name ${CLUSTER_NAME}-api-pip \
  --sku Standard \
  --location $LOCATION

# Create load balancer
az network lb create \
  --resource-group $RESOURCE_GROUP \
  --name ${CLUSTER_NAME}-api-lb \
  --sku Standard \
  --public-ip-address ${CLUSTER_NAME}-api-pip \
  --frontend-ip-name ${CLUSTER_NAME}-api-frontend \
  --backend-pool-name ${CLUSTER_NAME}-api-backend \
  --location $LOCATION

# Create health probe
az network lb probe create \
  --resource-group $RESOURCE_GROUP \
  --lb-name ${CLUSTER_NAME}-api-lb \
  --name ${CLUSTER_NAME}-api-probe \
  --protocol tcp \
  --port 6443

# Create load balancing rule
az network lb rule create \
  --resource-group $RESOURCE_GROUP \
  --lb-name ${CLUSTER_NAME}-api-lb \
  --name ${CLUSTER_NAME}-api-rule \
  --protocol tcp \
  --frontend-port 6443 \
  --backend-port 6443 \
  --frontend-ip-name ${CLUSTER_NAME}-api-frontend \
  --backend-pool-name ${CLUSTER_NAME}-api-backend \
  --probe-name ${CLUSTER_NAME}-api-probe
```

### Create Internal Load Balancer

```bash
# Create internal load balancer (no public IP)
az network lb create \
  --resource-group $RESOURCE_GROUP \
  --name ${CLUSTER_NAME}-internal-lb \
  --sku Standard \
  --vnet-name $VNET_NAME \
  --subnet $CONTROL_PLANE_SUBNET_NAME \
  --frontend-ip-name ${CLUSTER_NAME}-internal-frontend \
  --backend-pool-name ${CLUSTER_NAME}-internal-backend \
  --location $LOCATION

# Create health probes
az network lb probe create \
  --resource-group $RESOURCE_GROUP \
  --lb-name ${CLUSTER_NAME}-internal-lb \
  --name ${CLUSTER_NAME}-api-internal-probe \
  --protocol tcp \
  --port 6443

az network lb probe create \
  --resource-group $RESOURCE_GROUP \
  --lb-name ${CLUSTER_NAME}-internal-lb \
  --name ${CLUSTER_NAME}-mcs-probe \
  --protocol tcp \
  --port 22623

# Create load balancing rules
az network lb rule create \
  --resource-group $RESOURCE_GROUP \
  --lb-name ${CLUSTER_NAME}-internal-lb \
  --name ${CLUSTER_NAME}-api-internal-rule \
  --protocol tcp \
  --frontend-port 6443 \
  --backend-port 6443 \
  --frontend-ip-name ${CLUSTER_NAME}-internal-frontend \
  --backend-pool-name ${CLUSTER_NAME}-internal-backend \
  --probe-name ${CLUSTER_NAME}-api-internal-probe

az network lb rule create \
  --resource-group $RESOURCE_GROUP \
  --lb-name ${CLUSTER_NAME}-internal-lb \
  --name ${CLUSTER_NAME}-mcs-rule \
  --protocol tcp \
  --frontend-port 22623 \
  --backend-port 22623 \
  --frontend-ip-name ${CLUSTER_NAME}-internal-frontend \
  --backend-pool-name ${CLUSTER_NAME}-internal-backend \
  --probe-name ${CLUSTER_NAME}-mcs-probe
```

### Create Ingress Load Balancer

```bash
# Create public IP for ingress
az network public-ip create \
  --resource-group $RESOURCE_GROUP \
  --name ${CLUSTER_NAME}-ingress-pip \
  --sku Standard \
  --location $LOCATION

# Create ingress load balancer
az network lb create \
  --resource-group $RESOURCE_GROUP \
  --name ${CLUSTER_NAME}-ingress-lb \
  --sku Standard \
  --public-ip-address ${CLUSTER_NAME}-ingress-pip \
  --frontend-ip-name ${CLUSTER_NAME}-ingress-frontend \
  --backend-pool-name ${CLUSTER_NAME}-ingress-backend \
  --location $LOCATION

# Create health probes
az network lb probe create \
  --resource-group $RESOURCE_GROUP \
  --lb-name ${CLUSTER_NAME}-ingress-lb \
  --name ${CLUSTER_NAME}-http-probe \
  --protocol tcp \
  --port 80

az network lb probe create \
  --resource-group $RESOURCE_GROUP \
  --lb-name ${CLUSTER_NAME}-ingress-lb \
  --name ${CLUSTER_NAME}-https-probe \
  --protocol tcp \
  --port 443

# Create load balancing rules
az network lb rule create \
  --resource-group $RESOURCE_GROUP \
  --lb-name ${CLUSTER_NAME}-ingress-lb \
  --name ${CLUSTER_NAME}-http-rule \
  --protocol tcp \
  --frontend-port 80 \
  --backend-port 80 \
  --frontend-ip-name ${CLUSTER_NAME}-ingress-frontend \
  --backend-pool-name ${CLUSTER_NAME}-ingress-backend \
  --probe-name ${CLUSTER_NAME}-http-probe

az network lb rule create \
  --resource-group $RESOURCE_GROUP \
  --lb-name ${CLUSTER_NAME}-ingress-lb \
  --name ${CLUSTER_NAME}-https-rule \
  --protocol tcp \
  --frontend-port 443 \
  --backend-port 443 \
  --frontend-ip-name ${CLUSTER_NAME}-ingress-frontend \
  --backend-pool-name ${CLUSTER_NAME}-ingress-backend \
  --probe-name ${CLUSTER_NAME}-https-probe
```

### Post-Installation Task

⚠️ **CRITICAL:** After bootstrap completes, remove bootstrap VM from load balancer backend pools.

```bash
# Remove bootstrap from API backend pool
az network nic ip-config address-pool remove \
  --resource-group $RESOURCE_GROUP \
  --nic-name ${CLUSTER_NAME}-bootstrap-nic \
  --ip-config-name ipconfig1 \
  --lb-name ${CLUSTER_NAME}-api-lb \
  --address-pool ${CLUSTER_NAME}-api-backend

# Remove bootstrap from internal backend pool
az network nic ip-config address-pool remove \
  --resource-group $RESOURCE_GROUP \
  --nic-name ${CLUSTER_NAME}-bootstrap-nic \
  --ip-config-name ipconfig1 \
  --lb-name ${CLUSTER_NAME}-internal-lb \
  --address-pool ${CLUSTER_NAME}-internal-backend

# Delete bootstrap VM
az vm delete \
  --resource-group $RESOURCE_GROUP \
  --name ${CLUSTER_NAME}-bootstrap \
  --yes
```

**ARM template:** See `load-balancer-examples/azure-government-lb.json` for full automation example (to be created).

---

## Storage Account for Ignition (Optional)

**Alternative:** Host ignition files on Azure VM with nginx/Apache.

### Create Storage Account and Container

```bash
# Create storage account
STORAGE_ACCOUNT_NAME="${CLUSTER_NAME}ignition"
az storage account create \
  --resource-group $RESOURCE_GROUP \
  --name $STORAGE_ACCOUNT_NAME \
  --location $LOCATION \
  --sku Standard_LRS \
  --kind StorageV2

# Create blob container
az storage container create \
  --account-name $STORAGE_ACCOUNT_NAME \
  --name ignition \
  --public-access blob

# Upload ignition files (after generating with openshift-install)
az storage blob upload \
  --account-name $STORAGE_ACCOUNT_NAME \
  --container-name ignition \
  --name bootstrap.ign \
  --file bootstrap.ign

az storage blob upload \
  --account-name $STORAGE_ACCOUNT_NAME \
  --container-name ignition \
  --name master.ign \
  --file master.ign

az storage blob upload \
  --account-name $STORAGE_ACCOUNT_NAME \
  --container-name ignition \
  --name worker.ign \
  --file worker.ign
```

**Get ignition URLs:**

```bash
# Get blob URLs
az storage blob url \
  --account-name $STORAGE_ACCOUNT_NAME \
  --container-name ignition \
  --name bootstrap.ign

# Use these URLs in VM custom data during provisioning
```

---

## VM Provisioning

### Find RHCOS Image

```bash
# List RHCOS images in Azure Marketplace
az vm image list \
  --publisher RedHat \
  --offer RHCOS \
  --all \
  --output table

# Example RHCOS image URN for 4.20
RHCOS_URN="RedHat:RHCOS:rhcos-4.20:latest"
```

**Note:** RHCOS images are published in Azure Marketplace. Verify image availability for OpenShift 4.20.

### Create Bootstrap VM

```bash
# Create NIC for bootstrap
az network nic create \
  --resource-group $RESOURCE_GROUP \
  --name ${CLUSTER_NAME}-bootstrap-nic \
  --vnet-name $VNET_NAME \
  --subnet $CONTROL_PLANE_SUBNET_NAME \
  --network-security-group ${CLUSTER_NAME}-controlplane-nsg

# Add NIC to load balancer backend pools
az network nic ip-config address-pool add \
  --resource-group $RESOURCE_GROUP \
  --nic-name ${CLUSTER_NAME}-bootstrap-nic \
  --ip-config-name ipconfig1 \
  --lb-name ${CLUSTER_NAME}-api-lb \
  --address-pool ${CLUSTER_NAME}-api-backend

az network nic ip-config address-pool add \
  --resource-group $RESOURCE_GROUP \
  --nic-name ${CLUSTER_NAME}-bootstrap-nic \
  --ip-config-name ipconfig1 \
  --lb-name ${CLUSTER_NAME}-internal-lb \
  --address-pool ${CLUSTER_NAME}-internal-backend

# Create bootstrap VM
az vm create \
  --resource-group $RESOURCE_GROUP \
  --name ${CLUSTER_NAME}-bootstrap \
  --nics ${CLUSTER_NAME}-bootstrap-nic \
  --image $RHCOS_URN \
  --size Standard_D4s_v3 \
  --os-disk-size-gb 120 \
  --custom-data @bootstrap.ign \
  --admin-username core \
  --generate-ssh-keys
```

### Create Control Plane VMs (Repeat 3 times)

```bash
# Create control plane VM 0
az network nic create \
  --resource-group $RESOURCE_GROUP \
  --name ${CLUSTER_NAME}-master-0-nic \
  --vnet-name $VNET_NAME \
  --subnet $CONTROL_PLANE_SUBNET_NAME \
  --network-security-group ${CLUSTER_NAME}-controlplane-nsg

# Add to load balancer backend pools
az network nic ip-config address-pool add \
  --resource-group $RESOURCE_GROUP \
  --nic-name ${CLUSTER_NAME}-master-0-nic \
  --ip-config-name ipconfig1 \
  --lb-name ${CLUSTER_NAME}-api-lb \
  --address-pool ${CLUSTER_NAME}-api-backend

az network nic ip-config address-pool add \
  --resource-group $RESOURCE_GROUP \
  --nic-name ${CLUSTER_NAME}-master-0-nic \
  --ip-config-name ipconfig1 \
  --lb-name ${CLUSTER_NAME}-internal-lb \
  --address-pool ${CLUSTER_NAME}-internal-backend

# Create VM
az vm create \
  --resource-group $RESOURCE_GROUP \
  --name ${CLUSTER_NAME}-master-0 \
  --nics ${CLUSTER_NAME}-master-0-nic \
  --image $RHCOS_URN \
  --size Standard_D8s_v3 \
  --os-disk-size-gb 120 \
  --custom-data @master.ign \
  --admin-username core \
  --generate-ssh-keys

# Repeat for master-1 and master-2
```

### Create Worker VMs (Optional, repeat 2+ times)

```bash
# Similar to control plane, use worker.ign and add to ingress backend pool
```

---

## Mirror Registry Checklist (For Disconnected)

If deploying in a disconnected Azure Government environment, mirror OpenShift images to a local registry.

**See `docs/DISCONNECTED_SCENARIO_MATRIX.md` for comprehensive guidance.**

**High-level requirements:**
- [ ] Mirror registry accessible from VNET (Azure VM or on-premises)
- [ ] Registry TLS certificate (self-signed or CA-signed)
- [ ] oc-mirror v2 workflow completed
- [ ] imageDigestSources configured in install-config.yaml
- [ ] Trust bundle with mirror registry CA

**Verification:**

```bash
# Test registry connectivity from VNET
ssh core@<control-plane-vm-ip> \
  "curl -k https://mirror.registry.example.com:5000/v2/_catalog"
```

---

## Trust Bundle Preparation

If using self-signed certificates for mirror registry or proxy, create a trust bundle.

### Sources to Merge

- [ ] **Mirror registry CA certificate** (if using self-signed registry)
- [ ] **Proxy MITM CA certificate** (if using proxy with SSL inspection)

### Trust Bundle Assembly

```bash
# Concatenate CA certificates
cat mirror-ca.crt > trust-bundle.pem

# If using proxy:
cat proxy-ca.crt >> trust-bundle.pem

# Verify bundle
grep -c "BEGIN CERTIFICATE" trust-bundle.pem
# Should match number of certificates merged
```

### Use in install-config.yaml

```yaml
additionalTrustBundle: |
  -----BEGIN CERTIFICATE-----
  MIIDXTCCAkWgAwIBAgIJAKZ... (Mirror registry CA)
  -----END CERTIFICATE-----
```

---

## Pull Secret Preparation

### For Connected Deployments

Download Red Hat pull secret from:  
https://console.redhat.com/openshift/install/pull-secret

### For Disconnected Deployments

Merge Red Hat pull secret + mirror registry credentials (see Bare Metal prep guide for details).

---

## Network CIDR Planning

### Required CIDRs

| CIDR | Purpose | Default | Notes |
|------|---------|---------|-------|
| **VNET CIDR** | Azure VNET IP range | 10.0.0.0/16 | Must not overlap with cluster/service networks |
| **machineNetwork** | VM IPs | (VNET subnet CIDRs) | Matches subnet CIDRs |
| **clusterNetwork** | Pod IP range | 10.128.0.0/14 | Internal pod-to-pod traffic |
| **serviceNetwork** | Service IP range | 172.30.0.0/16 | Kubernetes services |

**Validation:** Ensure VNET CIDR does NOT overlap with cluster/service networks.

---

## Validation Commands

### Azure Resource Validation

```bash
# Verify resource group
az group show --name $RESOURCE_GROUP

# Verify VNET
az network vnet show --resource-group $RESOURCE_GROUP --name $VNET_NAME

# Verify subnets
az network vnet subnet list --resource-group $RESOURCE_GROUP --vnet-name $VNET_NAME

# Verify NSGs
az network nsg list --resource-group $RESOURCE_GROUP

# Verify load balancers
az network lb list --resource-group $RESOURCE_GROUP

# Verify DNS zone
az network dns zone show --resource-group $RESOURCE_GROUP --name $DNS_ZONE
```

### DNS Validation

```bash
# Test DNS resolution
dig api.ocp.example.com
dig api-int.ocp.example.com
dig test.apps.ocp.example.com

# Verify records resolve to load balancer IPs
nslookup api.ocp.example.com
```

### Load Balancer Health Check Validation

```bash
# Check backend pool health
az network lb show --resource-group $RESOURCE_GROUP --name ${CLUSTER_NAME}-api-lb

# List backend pool members
az network lb address-pool show \
  --resource-group $RESOURCE_GROUP \
  --lb-name ${CLUSTER_NAME}-api-lb \
  --name ${CLUSTER_NAME}-api-backend
```

---

## Next Steps

After completing all checklists and validations:

1. **Generate install-config.yaml** using OpenShift Airgap Architect
   - Select: Azure Government + UPI
   - Fill out cloudName, region, resource group
   - Download install-config.yaml

2. **Create installation directory**
   ```bash
   mkdir ocp-install
   cp install-config.yaml ocp-install/
   ```

3. **Generate ignition configs**
   ```bash
   openshift-install create ignition-configs --dir=ocp-install
   ```

4. **Upload ignition files to Azure Storage or host on VM**

5. **Create VMs** (see [VM Provisioning](#vm-provisioning))

6. **Monitor bootstrap progress**
   ```bash
   openshift-install wait-for bootstrap-complete --dir=ocp-install --log-level=info
   ```

7. **Remove bootstrap from load balancers** when "Bootstrap complete" appears

8. **Delete bootstrap VM**

9. **Approve CSRs**
   ```bash
   export KUBECONFIG=ocp-install/auth/kubeconfig
   oc get csr -o name | xargs oc adm certificate approve
   ```

10. **Wait for installation complete**
    ```bash
    openshift-install wait-for install-complete --dir=ocp-install --log-level=info
    ```

---

## Related Documentation

- **Application docs:**
  - [SCENARIOS_CLOUD_FAMILY.md](../SCENARIOS_CLOUD_FAMILY.md) - Cloud scenario overview
  - [DISCONNECTED_SCENARIO_MATRIX.md](../DISCONNECTED_SCENARIO_MATRIX.md) - Disconnected deployment support

- **Templates:**
  - ARM template (to be created): `load-balancer-examples/azure-government-lb.json`
  - Terraform example (to be created): `dns-examples/azure-dns-terraform.tf`

- **Red Hat official docs:**
  - OpenShift 4.20 Installing on Azure Government: User-provisioned infrastructure  
    https://docs.redhat.com/en/documentation/openshift_container_platform/4.20/html/installing_on_azure_government/installing-azure-government-upi

---

**Feedback:** If you find gaps in this guide or have suggestions, please create an issue in the project repository.
