# AWS Route53 DNS Configuration for OpenShift UPI
#
# IMPORTANT: This is an EXAMPLE template only. You MUST customize:
# - Route53 hosted zone ID to match your AWS account
# - Cluster name and base domain to match your install-config.yaml
# - IP addresses for your load balancer(s)
# - AWS region and credentials
#
# DO NOT use this template verbatim in production without customization.
#
# PREREQUISITES:
# - Route53 hosted zone exists for your base domain
# - Terraform 1.0+ installed
# - AWS credentials configured (aws configure or environment variables)
# - Load balancers already created (or use outputs from LB Terraform module)

# Variables (customize these or use terraform.tfvars)
variable "cluster_name" {
  description = "OpenShift cluster name"
  type        = string
  # Example: "ocp-prod"
}

variable "base_domain" {
  description = "Base DNS domain"
  type        = string
  # Example: "example.com"
}

variable "hosted_zone_id" {
  description = "Route53 hosted zone ID for base domain"
  type        = string
  # Find with: aws route53 list-hosted-zones-by-name --dns-name example.com
}

variable "lb_api_ip" {
  description = "Load balancer IP or DNS name for Kubernetes API (port 6443)"
  type        = string
  # For NLB: Use NLB DNS name (e.g., "ocp-api-nlb-abc123.elb.us-gov-west-1.amazonaws.com")
  # For external LB: Use IP address (e.g., "203.0.113.10")
}

variable "lb_ingress_ip" {
  description = "Load balancer IP or DNS name for application ingress (ports 80/443)"
  type        = string
  # For NLB: Use NLB DNS name
  # For external LB: Use IP address
}

# Optional: If using AWS NLB DNS names instead of IPs
variable "use_dns_names" {
  description = "Set to true if lb_api_ip and lb_ingress_ip are DNS names (NLB), false if IPs"
  type        = bool
  default     = true
}

# Kubernetes API endpoint (external)
# Used by: oc, kubectl, openshift-install
resource "aws_route53_record" "api" {
  zone_id = var.hosted_zone_id
  name    = "api.${var.cluster_name}.${var.base_domain}"
  type    = var.use_dns_names ? "CNAME" : "A"
  ttl     = 300

  records = [var.lb_api_ip]
}

# Kubernetes API endpoint (internal)
# Used by: cluster components for internal API access
resource "aws_route53_record" "api_int" {
  zone_id = var.hosted_zone_id
  name    = "api-int.${var.cluster_name}.${var.base_domain}"
  type    = var.use_dns_names ? "CNAME" : "A"
  ttl     = 300

  records = [var.lb_api_ip]
}

# Application ingress wildcard
# Used by: console, oauth, all application routes
resource "aws_route53_record" "ingress" {
  zone_id = var.hosted_zone_id
  name    = "*.apps.${var.cluster_name}.${var.base_domain}"
  type    = var.use_dns_names ? "CNAME" : "A"
  ttl     = 300

  records = [var.lb_ingress_ip]
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

# USAGE INSTRUCTIONS:
#
# 1. Create terraform.tfvars file:
#    cluster_name     = "ocp-prod"
#    base_domain      = "example.com"
#    hosted_zone_id   = "Z1234567890ABC"
#    lb_api_ip        = "ocp-api-nlb-abc123.elb.us-gov-west-1.amazonaws.com"
#    lb_ingress_ip    = "ocp-ingress-nlb-def456.elb.us-gov-west-1.amazonaws.com"
#    use_dns_names    = true
#
# 2. Initialize Terraform:
#    terraform init
#
# 3. Plan changes:
#    terraform plan
#
# 4. Apply DNS records:
#    terraform apply
#
# 5. Verify DNS resolution:
#    dig api.ocp-prod.example.com
#    dig console-openshift-console.apps.ocp-prod.example.com
#
# 6. Test API connectivity:
#    curl -k https://api.ocp-prod.example.com:6443/healthz
#
# IMPORTANT NOTES:
#
# - If using AWS Network Load Balancer (NLB), use DNS names not IPs (NLB IPs can change)
# - Set use_dns_names = true for NLB, false for external load balancers with static IPs
# - Route53 propagation typically takes 60 seconds, but allow up to 5 minutes
# - Wildcard DNS (*.apps) must resolve for console, oauth, and all application routes
# - No DNS changes required after bootstrap completes (already pointing to load balancer)
