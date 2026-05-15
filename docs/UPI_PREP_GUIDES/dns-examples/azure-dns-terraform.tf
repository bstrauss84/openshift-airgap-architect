# Azure DNS Configuration for OpenShift UPI
#
# IMPORTANT: This is an EXAMPLE template only. You MUST customize:
# - Azure DNS zone name and resource group to match your Azure account
# - Cluster name to match your install-config.yaml
# - IP addresses for your load balancer(s)
# - Azure subscription and region
#
# DO NOT use this template verbatim in production without customization.
#
# PREREQUISITES:
# - Azure DNS zone exists for your base domain
# - Terraform 1.0+ installed with Azure provider
# - Azure credentials configured (az login or service principal)
# - Load balancers already created (or use outputs from LB Terraform module)

terraform {
  required_providers {
    azurerm = {
      source  = "hashicorp/azurerm"
      version = "~> 3.0"
    }
  }
}

provider "azurerm" {
  features {}
  # subscription_id = "12345678-1234-1234-1234-123456789abc"  # Uncomment if using service principal
  # tenant_id       = "87654321-4321-4321-4321-cba987654321"
}

# Variables (customize these or use terraform.tfvars)
variable "cluster_name" {
  description = "OpenShift cluster name"
  type        = string
  # Example: "ocp-prod"
}

variable "base_domain" {
  description = "Base DNS domain (must match existing Azure DNS zone)"
  type        = string
  # Example: "example.com"
}

variable "dns_zone_resource_group" {
  description = "Azure resource group containing the DNS zone"
  type        = string
  # Example: "dns-resources-rg"
}

variable "lb_api_ip" {
  description = "Load balancer IP or DNS name for Kubernetes API (port 6443)"
  type        = string
  # For Azure LB with public IP: Use public IP address (e.g., "203.0.113.10")
  # For Azure LB DNS name: Use DNS name (e.g., "ocp-api-lb.westus.cloudapp.azure.com")
}

variable "lb_ingress_ip" {
  description = "Load balancer IP or DNS name for application ingress (ports 80/443)"
  type        = string
  # For Azure LB with public IP: Use public IP address
  # For Azure LB DNS name: Use DNS name
}

# Optional: If using Azure LB DNS names instead of IPs
variable "use_dns_names" {
  description = "Set to true if lb_api_ip and lb_ingress_ip are DNS names, false if IPs"
  type        = bool
  default     = false
}

# Data source: Existing Azure DNS zone
data "azurerm_dns_zone" "base" {
  name                = var.base_domain
  resource_group_name = var.dns_zone_resource_group
}

# Kubernetes API endpoint (external)
# Used by: oc, kubectl, openshift-install
resource "azurerm_dns_a_record" "api" {
  count               = var.use_dns_names ? 0 : 1
  name                = "api.${var.cluster_name}"
  zone_name           = data.azurerm_dns_zone.base.name
  resource_group_name = var.dns_zone_resource_group
  ttl                 = 300
  records             = [var.lb_api_ip]
}

resource "azurerm_dns_cname_record" "api_cname" {
  count               = var.use_dns_names ? 1 : 0
  name                = "api.${var.cluster_name}"
  zone_name           = data.azurerm_dns_zone.base.name
  resource_group_name = var.dns_zone_resource_group
  ttl                 = 300
  record              = var.lb_api_ip
}

# Kubernetes API endpoint (internal)
# Used by: cluster components for internal API access
resource "azurerm_dns_a_record" "api_int" {
  count               = var.use_dns_names ? 0 : 1
  name                = "api-int.${var.cluster_name}"
  zone_name           = data.azurerm_dns_zone.base.name
  resource_group_name = var.dns_zone_resource_group
  ttl                 = 300
  records             = [var.lb_api_ip]
}

resource "azurerm_dns_cname_record" "api_int_cname" {
  count               = var.use_dns_names ? 1 : 0
  name                = "api-int.${var.cluster_name}"
  zone_name           = data.azurerm_dns_zone.base.name
  resource_group_name = var.dns_zone_resource_group
  ttl                 = 300
  record              = var.lb_api_ip
}

# Application ingress wildcard
# Used by: console, oauth, all application routes
resource "azurerm_dns_a_record" "ingress" {
  count               = var.use_dns_names ? 0 : 1
  name                = "*.apps.${var.cluster_name}"
  zone_name           = data.azurerm_dns_zone.base.name
  resource_group_name = var.dns_zone_resource_group
  ttl                 = 300
  records             = [var.lb_ingress_ip]
}

resource "azurerm_dns_cname_record" "ingress_cname" {
  count               = var.use_dns_names ? 1 : 0
  name                = "*.apps.${var.cluster_name}"
  zone_name           = data.azurerm_dns_zone.base.name
  resource_group_name = var.dns_zone_resource_group
  ttl                 = 300
  record              = var.lb_ingress_ip
}

# Outputs for verification
output "api_fqdn" {
  description = "Kubernetes API FQDN"
  value       = "api.${var.cluster_name}.${var.base_domain}"
}

output "api_int_fqdn" {
  description = "Kubernetes API internal FQDN"
  value       = "api-int.${var.cluster_name}.${var.base_domain}"
}

output "ingress_wildcard" {
  description = "Application ingress wildcard domain"
  value       = "*.apps.${var.cluster_name}.${var.base_domain}"
}

output "console_url" {
  description = "OpenShift Console URL (available after installation)"
  value       = "https://console-openshift-console.apps.${var.cluster_name}.${var.base_domain}"
}

output "dns_zone_id" {
  description = "Azure DNS zone ID"
  value       = data.azurerm_dns_zone.base.id
}

# USAGE INSTRUCTIONS:
#
# 1. Create terraform.tfvars file:
#    cluster_name              = "ocp-prod"
#    base_domain               = "example.com"
#    dns_zone_resource_group   = "dns-resources-rg"
#    lb_api_ip                 = "203.0.113.10"
#    lb_ingress_ip             = "203.0.113.20"
#    use_dns_names             = false
#
# 2. Log in to Azure:
#    az login
#    az account set --subscription "Your Subscription Name"
#
# 3. Initialize Terraform:
#    terraform init
#
# 4. Plan changes:
#    terraform plan
#
# 5. Apply DNS records:
#    terraform apply
#
# 6. Verify DNS resolution:
#    dig api.ocp-prod.example.com
#    dig console-openshift-console.apps.ocp-prod.example.com
#
# 7. Test API connectivity:
#    curl -k https://api.ocp-prod.example.com:6443/healthz
#
# IMPORTANT NOTES:
#
# - Azure DNS zone must exist before running this Terraform
# - Find DNS zone resource group: az network dns zone list --query "[].{Name:name, RG:resourceGroup}"
# - If using Azure Standard Load Balancer with static public IPs, use A records (use_dns_names = false)
# - If using Azure LB DNS names, use CNAME records (use_dns_names = true)
# - Azure DNS propagation typically takes 60-90 seconds
# - Wildcard DNS (*.apps) must resolve for console, oauth, and all application routes
# - No DNS changes required after bootstrap completes (already pointing to load balancer)
#
# AZURE GOVERNMENT NOTES:
#
# - Use Azure Government cloud: az cloud set --name AzureUSGovernment
# - Provider configuration: environment = "usgovernment"
# - DNS zones in Azure Government work identically to commercial Azure
