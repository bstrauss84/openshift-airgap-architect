# AWS GovCloud UPI Preparation Guide

**Platform:** AWS GovCloud (US)  
**Install Method:** User-Provisioned Infrastructure (UPI)  
**OpenShift Version:** 4.20  
**Last Updated:** 2026-05-15

---

## Table of Contents

- [Overview](#overview)
- [Infrastructure Prerequisites Checklist](#infrastructure-prerequisites-checklist)
- [AWS Account and IAM Prerequisites](#aws-account-and-iam-prerequisites)
- [VPC and Networking Configuration](#vpc-and-networking-configuration)
- [DNS Configuration (Route53)](#dns-configuration-route53)
- [Load Balancer Configuration (Network Load Balancers)](#load-balancer-configuration-network-load-balancers)
- [S3 Bucket for Ignition (Optional)](#s3-bucket-for-ignition-optional)
- [EC2 Instance Provisioning](#ec2-instance-provisioning)
- [Mirror Registry Checklist (For Disconnected)](#mirror-registry-checklist-for-disconnected)
- [Trust Bundle Preparation](#trust-bundle-preparation)
- [Pull Secret Preparation](#pull-secret-preparation)
- [Network CIDR Planning](#network-cidr-planning)
- [Validation Commands](#validation-commands)
- [Next Steps](#next-steps)

---

## Overview

AWS GovCloud UPI installations require manual provisioning of AWS resources before running the OpenShift installer. This includes:

- VPC with public and private subnets across multiple Availability Zones
- IAM roles and instance profiles for control plane and worker nodes
- Network Load Balancers (NLB) for API, Machine Config Server, and Ingress
- Route53 hosted zone and DNS records
- Security groups with required firewall rules
- Optional: S3 bucket for hosting ignition files
- EC2 instances (bootstrap, control plane, worker nodes) from RHCOS AMI

**Key characteristic:** `platform.aws` block in install-config.yaml with region `us-gov-west-1` or `us-gov-east-1`. User provisions ALL AWS resources manually before installation.

**Reference documentation:**
- OpenShift 4.20 Installing on AWS GovCloud: User-provisioned infrastructure  
  https://docs.redhat.com/en/documentation/openshift_container_platform/4.20/html/installing_on_aws_govcloud/installing-aws-govcloud-upi
- Deep application documentation: `docs/SCENARIOS_CLOUD_FAMILY.md`

---

## Infrastructure Prerequisites Checklist

### AWS GovCloud Account Requirements

- [ ] Active AWS GovCloud account with programmatic access
- [ ] AWS CLI configured with GovCloud credentials
- [ ] Sufficient service quotas (EC2 instances, VPCs, EIPs, NLBs)
- [ ] Region selected: `us-gov-west-1` or `us-gov-east-1`

**Verify CLI configuration:**

```bash
# Configure AWS CLI for GovCloud
aws configure --profile govcloud
# AWS Access Key ID: <your-access-key>
# AWS Secret Access Key: <your-secret-key>
# Default region name: us-gov-west-1
# Default output format: json

# Test connectivity
aws sts get-caller-identity --profile govcloud
# Should return account ID and ARN
```

### Cluster Size Requirements

**Minimum cluster configuration:**

| Node Type | Count | Instance Type | vCPU | RAM | Disk | Purpose |
|-----------|-------|---------------|------|-----|------|---------|
| Bootstrap | 1 | m5.xlarge | 4 | 16 GB | 120 GB gp3 | Temporary instance for bootstrapping (terminated after install) |
| Control Plane | 3 | m5.xlarge | 4 | 16 GB | 120 GB gp3 | etcd + control plane services |
| Worker (optional) | 2+ | m5.2xlarge | 8 | 32 GB | 120 GB gp3 | Application workloads |

**Topology options:**
- **Compact cluster:** 3 control plane, 0 workers (control plane nodes also run workloads)
- **HA cluster:** 3 control plane, 2+ workers (production recommended)

### Service Quotas Check

```bash
# Check EC2 instance quotas
aws service-quotas get-service-quota \
  --service-code ec2 \
  --quota-code L-1216C47A \
  --region us-gov-west-1 \
  --profile govcloud

# Check VPC quotas
aws service-quotas get-service-quota \
  --service-code vpc \
  --quota-code L-F678F1CE \
  --region us-gov-west-1 \
  --profile govcloud

# Request quota increase if needed:
# https://console.amazonaws-us-gov.com/servicequotas/
```

---

## AWS Account and IAM Prerequisites

### IAM Roles and Instance Profiles

OpenShift control plane and worker nodes require IAM instance profiles with specific permissions.

**Required IAM roles:**
1. **Control plane role:** Permissions for EC2, ELB, Route53, S3 (for registry)
2. **Worker role:** Permissions for EC2, ELB, S3 (for registry)

**Minimal policy for control plane:**

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "ec2:DescribeInstances",
        "ec2:DescribeRegions",
        "ec2:DescribeRouteTables",
        "ec2:DescribeSecurityGroups",
        "ec2:DescribeSubnets",
        "ec2:DescribeVolumes",
        "ec2:CreateSecurityGroup",
        "ec2:CreateTags",
        "ec2:CreateVolume",
        "ec2:ModifyInstanceAttribute",
        "ec2:ModifyVolume",
        "ec2:AttachVolume",
        "ec2:AuthorizeSecurityGroupIngress",
        "ec2:DeleteSecurityGroup",
        "ec2:DeleteVolume",
        "ec2:DescribeVpcs",
        "elasticloadbalancing:DescribeLoadBalancers",
        "elasticloadbalancing:DescribeTargetGroups",
        "elasticloadbalancing:DescribeTargetHealth",
        "elasticloadbalancing:RegisterTargets",
        "elasticloadbalancing:DeregisterTargets"
      ],
      "Resource": "*"
    }
  ]
}
```

**Create IAM roles:**

```bash
# Create control plane role
aws iam create-role \
  --role-name openshift-control-plane-role \
  --assume-role-policy-document file://ec2-trust-policy.json \
  --profile govcloud

# Attach policy
aws iam put-role-policy \
  --role-name openshift-control-plane-role \
  --policy-name openshift-control-plane-policy \
  --policy-document file://control-plane-policy.json \
  --profile govcloud

# Create instance profile
aws iam create-instance-profile \
  --instance-profile-name openshift-control-plane-profile \
  --profile govcloud

# Add role to instance profile
aws iam add-role-to-instance-profile \
  --instance-profile-name openshift-control-plane-profile \
  --role-name openshift-control-plane-role \
  --profile govcloud

# Repeat for worker role
```

**ec2-trust-policy.json:**

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Service": "ec2.amazonaws.com"
      },
      "Action": "sts:AssumeRole"
    }
  ]
}
```

---

## VPC and Networking Configuration

### VPC Architecture

**Required resources:**
- 1 VPC with CIDR block (e.g., 10.0.0.0/16)
- 1 Internet Gateway attached to VPC
- 3 Availability Zones (AZs) for HA
- 3 public subnets (one per AZ) for load balancers
- 3 private subnets (one per AZ) for control plane/worker nodes
- NAT Gateways in each public subnet (for outbound internet from private subnets)
- Route tables for public and private subnets

**Checklist:**

- [ ] VPC created with appropriate CIDR
- [ ] Internet Gateway attached
- [ ] 3 public subnets across different AZs
- [ ] 3 private subnets across different AZs
- [ ] NAT Gateway in each public subnet (with Elastic IP)
- [ ] Public route table with 0.0.0.0/0 → IGW
- [ ] Private route tables with 0.0.0.0/0 → NAT Gateway

**Example CloudFormation template available:** `load-balancer-examples/aws-govcloud-upi-vpc.yaml` (to be created)

**Create VPC manually:**

```bash
# Create VPC
aws ec2 create-vpc \
  --cidr-block 10.0.0.0/16 \
  --tag-specifications 'ResourceType=vpc,Tags=[{Key=Name,Value=openshift-vpc}]' \
  --region us-gov-west-1 \
  --profile govcloud

# Create Internet Gateway
aws ec2 create-internet-gateway \
  --tag-specifications 'ResourceType=internet-gateway,Tags=[{Key=Name,Value=openshift-igw}]' \
  --region us-gov-west-1 \
  --profile govcloud

# Attach IGW to VPC
aws ec2 attach-internet-gateway \
  --internet-gateway-id <igw-id> \
  --vpc-id <vpc-id> \
  --region us-gov-west-1 \
  --profile govcloud

# Create public subnets (repeat for each AZ)
aws ec2 create-subnet \
  --vpc-id <vpc-id> \
  --cidr-block 10.0.0.0/24 \
  --availability-zone us-gov-west-1a \
  --tag-specifications 'ResourceType=subnet,Tags=[{Key=Name,Value=openshift-public-subnet-1a}]' \
  --region us-gov-west-1 \
  --profile govcloud

# Create private subnets (repeat for each AZ)
aws ec2 create-subnet \
  --vpc-id <vpc-id> \
  --cidr-block 10.0.10.0/24 \
  --availability-zone us-gov-west-1a \
  --tag-specifications 'ResourceType=subnet,Tags=[{Key=Name,Value=openshift-private-subnet-1a}]' \
  --region us-gov-west-1 \
  --profile govcloud

# Create NAT Gateways (one per public subnet, requires Elastic IP)
aws ec2 allocate-address --domain vpc --region us-gov-west-1 --profile govcloud
aws ec2 create-nat-gateway \
  --subnet-id <public-subnet-id> \
  --allocation-id <eip-allocation-id> \
  --tag-specifications 'ResourceType=natgateway,Tags=[{Key=Name,Value=openshift-nat-1a}]' \
  --region us-gov-west-1 \
  --profile govcloud
```

### Security Groups

**Required security groups:**
1. **Control plane security group:** Allow API (6443), MCS (22623), etcd (2379-2380), SSH (22)
2. **Worker security group:** Allow ingress (80, 443), NodePort (30000-32767), SSH (22)
3. **Bootstrap security group:** Same as control plane (temporary)

**Example: Create control plane security group:**

```bash
# Create security group
aws ec2 create-security-group \
  --group-name openshift-control-plane-sg \
  --description "OpenShift control plane security group" \
  --vpc-id <vpc-id> \
  --region us-gov-west-1 \
  --profile govcloud

# Allow API access from anywhere
aws ec2 authorize-security-group-ingress \
  --group-id <sg-id> \
  --protocol tcp \
  --port 6443 \
  --cidr 0.0.0.0/0 \
  --region us-gov-west-1 \
  --profile govcloud

# Allow MCS from VPC CIDR
aws ec2 authorize-security-group-ingress \
  --group-id <sg-id> \
  --protocol tcp \
  --port 22623 \
  --cidr 10.0.0.0/16 \
  --region us-gov-west-1 \
  --profile govcloud

# Allow all traffic within security group (for etcd, kubelet, etc.)
aws ec2 authorize-security-group-ingress \
  --group-id <sg-id> \
  --protocol all \
  --source-group <sg-id> \
  --region us-gov-west-1 \
  --profile govcloud
```

---

## DNS Configuration (Route53)

### Route53 Hosted Zone

**Required DNS records:**

- [ ] **Public hosted zone** for base domain (e.g., `example.com`)
- [ ] **A record:** `api.<cluster-name>.<base-domain>` → Network Load Balancer DNS (alias record)
- [ ] **A record:** `api-int.<cluster-name>.<base-domain>` → Internal Network Load Balancer DNS
- [ ] **A record (wildcard):** `*.apps.<cluster-name>.<base-domain>` → Ingress Network Load Balancer DNS

**Create hosted zone:**

```bash
# Create public hosted zone (if not exists)
aws route53 create-hosted-zone \
  --name example.com \
  --caller-reference $(date +%s) \
  --hosted-zone-config Comment="OpenShift cluster DNS" \
  --profile govcloud

# Get hosted zone ID
aws route53 list-hosted-zones-by-name \
  --dns-name example.com \
  --profile govcloud
```

**Create DNS records (after NLB created):**

```bash
# Create API record (alias to NLB)
cat > api-record.json <<EOF
{
  "Comment": "API endpoint for OpenShift cluster",
  "Changes": [
    {
      "Action": "CREATE",
      "ResourceRecordSet": {
        "Name": "api.ocp.example.com",
        "Type": "A",
        "AliasTarget": {
          "HostedZoneId": "<nlb-hosted-zone-id>",
          "DNSName": "<nlb-dns-name>",
          "EvaluateTargetHealth": false
        }
      }
    }
  ]
}
EOF

aws route53 change-resource-record-sets \
  --hosted-zone-id <zone-id> \
  --change-batch file://api-record.json \
  --profile govcloud

# Repeat for api-int and *.apps records
```

### Validation

```bash
# Test DNS resolution
dig api.ocp.example.com
dig api-int.ocp.example.com
dig test.apps.ocp.example.com

# Verify records resolve to NLB DNS names
nslookup api.ocp.example.com
```

**DNS Templates:** See `dns-examples/route53-terraform.tf` for Terraform automation example (to be created).

---

## Load Balancer Configuration (Network Load Balancers)

AWS GovCloud UPI requires Network Load Balancers (NLB) for API, MCS, and Ingress traffic.

### Load Balancer Architecture

**Required NLBs:**
1. **External API NLB** (internet-facing, port 6443)
2. **Internal API/MCS NLB** (internal, ports 6443 + 22623)
3. **Ingress NLB** (internet-facing, ports 80 + 443)

**Alternative (acceptable for non-production):**
- Combine external API + ingress into single internet-facing NLB

### Backend Target Groups

**API Target Group (port 6443):**
- [ ] **During installation:** Bootstrap instance + Control plane instances (3+)
- [ ] **After bootstrap complete:** Control plane instances only (deregister bootstrap)
- [ ] **Health check:** TCP 6443 or HTTPS /readyz

**MCS Target Group (port 22623):**
- [ ] **During installation:** Bootstrap instance + Control plane instances (3+)
- [ ] **After bootstrap complete:** Control plane instances only (deregister bootstrap)
- [ ] **Health check:** TCP 22623

**Ingress HTTP Target Group (port 80):**
- [ ] **Backends:** Worker instances (or control plane if no workers)
- [ ] **Health check:** HTTP GET /healthz/ready

**Ingress HTTPS Target Group (port 443):**
- [ ] **Backends:** Worker instances (or control plane if no workers)
- [ ] **Health check:** TCP 443 or HTTPS GET /healthz/ready

### Create NLB and Target Groups

**Example: Create external API NLB:**

```bash
# Create target group for API
aws elbv2 create-target-group \
  --name openshift-api-tg \
  --protocol TCP \
  --port 6443 \
  --vpc-id <vpc-id> \
  --health-check-protocol TCP \
  --health-check-port 6443 \
  --region us-gov-west-1 \
  --profile govcloud

# Create Network Load Balancer
aws elbv2 create-load-balancer \
  --name openshift-api-nlb \
  --scheme internet-facing \
  --type network \
  --subnets <public-subnet-1> <public-subnet-2> <public-subnet-3> \
  --tags Key=Name,Value=openshift-api-nlb \
  --region us-gov-west-1 \
  --profile govcloud

# Create listener
aws elbv2 create-listener \
  --load-balancer-arn <nlb-arn> \
  --protocol TCP \
  --port 6443 \
  --default-actions Type=forward,TargetGroupArn=<target-group-arn> \
  --region us-gov-west-1 \
  --profile govcloud
```

**CloudFormation template:** See `load-balancer-examples/aws-govcloud-nlb.yaml` for full automation example (to be created).

### Post-Installation Task

⚠️ **CRITICAL:** After bootstrap completes, deregister bootstrap instance from API and MCS target groups.

```bash
# Deregister bootstrap from API target group
aws elbv2 deregister-targets \
  --target-group-arn <api-tg-arn> \
  --targets Id=<bootstrap-instance-id> \
  --region us-gov-west-1 \
  --profile govcloud

# Deregister bootstrap from MCS target group
aws elbv2 deregister-targets \
  --target-group-arn <mcs-tg-arn> \
  --targets Id=<bootstrap-instance-id> \
  --region us-gov-west-1 \
  --profile govcloud

# Terminate bootstrap instance
aws ec2 terminate-instances \
  --instance-ids <bootstrap-instance-id> \
  --region us-gov-west-1 \
  --profile govcloud
```

---

## S3 Bucket for Ignition (Optional)

**Alternative to S3:** Host ignition files on EC2 instance with nginx/Apache (less common for AWS).

### Create S3 Bucket

```bash
# Create S3 bucket
aws s3 mb s3://openshift-ignition-<cluster-name> \
  --region us-gov-west-1 \
  --profile govcloud

# Upload ignition files (after generating with openshift-install)
aws s3 cp bootstrap.ign s3://openshift-ignition-<cluster-name>/ \
  --region us-gov-west-1 \
  --profile govcloud

aws s3 cp master.ign s3://openshift-ignition-<cluster-name>/ \
  --region us-gov-west-1 \
  --profile govcloud

aws s3 cp worker.ign s3://openshift-ignition-<cluster-name>/ \
  --region us-gov-west-1 \
  --profile govcloud

# Make files publicly readable (or use pre-signed URLs)
aws s3api put-object-acl \
  --bucket openshift-ignition-<cluster-name> \
  --key bootstrap.ign \
  --acl public-read \
  --region us-gov-west-1 \
  --profile govcloud
```

**Security note:** Use pre-signed URLs instead of public-read for production:

```bash
# Generate pre-signed URL (valid for 1 hour)
aws s3 presign s3://openshift-ignition-<cluster-name>/bootstrap.ign \
  --expires-in 3600 \
  --region us-gov-west-1 \
  --profile govcloud
```

---

## EC2 Instance Provisioning

### Find RHCOS AMI

```bash
# List RHCOS AMIs for OpenShift 4.20 in AWS GovCloud
# (AMI IDs vary by region and OCP version)

# Example AMI query (replace version as needed)
aws ec2 describe-images \
  --owners 219670896067 \
  --filters "Name=name,Values=rhcos-4.20*" \
  --query 'sort_by(Images, &CreationDate)[-1].ImageId' \
  --output text \
  --region us-gov-west-1 \
  --profile govcloud
```

**Note:** RHCOS AMI IDs are published in OpenShift 4.20 documentation. Verify AMI ID before use.

### Launch EC2 Instances

**Bootstrap instance:**

```bash
# Create user-data script with ignition URL
cat > bootstrap-userdata.sh <<EOF
#!/bin/bash
echo "ignition_url=https://s3.us-gov-west-1.amazonaws.com/openshift-ignition-<cluster-name>/bootstrap.ign" >> /etc/coreos/ignition.firstboot
EOF

# Launch instance
aws ec2 run-instances \
  --image-id <rhcos-ami-id> \
  --instance-type m5.xlarge \
  --key-name <ssh-key-name> \
  --subnet-id <private-subnet-id> \
  --security-group-ids <bootstrap-sg-id> \
  --iam-instance-profile Name=openshift-control-plane-profile \
  --user-data file://bootstrap-userdata.sh \
  --block-device-mappings 'DeviceName=/dev/xvda,Ebs={VolumeSize=120,VolumeType=gp3}' \
  --tag-specifications 'ResourceType=instance,Tags=[{Key=Name,Value=openshift-bootstrap}]' \
  --region us-gov-west-1 \
  --profile govcloud
```

**Control plane instances (repeat 3 times):**

```bash
# Create user-data for control plane
cat > master-userdata.sh <<EOF
#!/bin/bash
echo "ignition_url=https://s3.us-gov-west-1.amazonaws.com/openshift-ignition-<cluster-name>/master.ign" >> /etc/coreos/ignition.firstboot
EOF

# Launch instance
aws ec2 run-instances \
  --image-id <rhcos-ami-id> \
  --instance-type m5.xlarge \
  --key-name <ssh-key-name> \
  --subnet-id <private-subnet-id> \
  --security-group-ids <control-plane-sg-id> \
  --iam-instance-profile Name=openshift-control-plane-profile \
  --user-data file://master-userdata.sh \
  --block-device-mappings 'DeviceName=/dev/xvda,Ebs={VolumeSize=120,VolumeType=gp3}' \
  --tag-specifications 'ResourceType=instance,Tags=[{Key=Name,Value=openshift-master-0}]' \
  --region us-gov-west-1 \
  --profile govcloud
```

**Worker instances (optional, repeat 2+ times):**

```bash
# Similar to control plane, use worker.ign and worker security group
```

### Register Instances to Target Groups

```bash
# Register bootstrap to API target group
aws elbv2 register-targets \
  --target-group-arn <api-tg-arn> \
  --targets Id=<bootstrap-instance-id> \
  --region us-gov-west-1 \
  --profile govcloud

# Register control plane instances to API target group
for instance_id in <master-0-id> <master-1-id> <master-2-id>; do
  aws elbv2 register-targets \
    --target-group-arn <api-tg-arn> \
    --targets Id=$instance_id \
    --region us-gov-west-1 \
    --profile govcloud
done

# Repeat for MCS and ingress target groups
```

---

## Mirror Registry Checklist (For Disconnected)

If deploying in a disconnected AWS GovCloud environment, mirror OpenShift images to a local registry.

**See `docs/DISCONNECTED_SCENARIO_MATRIX.md` for comprehensive guidance.**

**High-level requirements:**
- [ ] Mirror registry accessible from VPC (EC2 instance or on-premises)
- [ ] Registry TLS certificate (self-signed or CA-signed)
- [ ] oc-mirror v2 workflow completed
- [ ] imageDigestSources configured in install-config.yaml
- [ ] Trust bundle with mirror registry CA

**Verification:**

```bash
# Test registry connectivity from VPC
ssh ec2-user@<control-plane-instance> \
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
| **VPC CIDR** | AWS VPC IP range | 10.0.0.0/16 | Must not overlap with cluster/service networks |
| **machineNetwork** | EC2 instance IPs | (VPC subnet CIDRs) | Matches private subnet CIDRs |
| **clusterNetwork** | Pod IP range | 10.128.0.0/14 | Internal pod-to-pod traffic |
| **serviceNetwork** | Service IP range | 172.30.0.0/16 | Kubernetes services |

**Validation:** Ensure VPC CIDR does NOT overlap with cluster/service networks.

---

## Validation Commands

### AWS Resource Validation

```bash
# Verify VPC exists
aws ec2 describe-vpcs --vpc-ids <vpc-id> --region us-gov-west-1 --profile govcloud

# Verify subnets
aws ec2 describe-subnets --filters "Name=vpc-id,Values=<vpc-id>" --region us-gov-west-1 --profile govcloud

# Verify security groups
aws ec2 describe-security-groups --filters "Name=vpc-id,Values=<vpc-id>" --region us-gov-west-1 --profile govcloud

# Verify NLB
aws elbv2 describe-load-balancers --region us-gov-west-1 --profile govcloud

# Verify target groups
aws elbv2 describe-target-groups --region us-gov-west-1 --profile govcloud

# Verify Route53 records
aws route53 list-resource-record-sets --hosted-zone-id <zone-id> --profile govcloud
```

### DNS Validation

```bash
# Test DNS resolution
dig api.ocp.example.com
dig api-int.ocp.example.com
dig test.apps.ocp.example.com

# Verify records resolve to NLB DNS names
nslookup api.ocp.example.com
```

### NLB Health Check Validation

```bash
# Check target health
aws elbv2 describe-target-health \
  --target-group-arn <api-tg-arn> \
  --region us-gov-west-1 \
  --profile govcloud

# Should show registered targets (bootstrap + control plane during install)
```

---

## Next Steps

After completing all checklists and validations:

1. **Generate install-config.yaml** using OpenShift Airgap Architect
   - Select: AWS GovCloud + UPI
   - Fill out region, VPC, subnets
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

4. **Upload ignition files to S3**
   ```bash
   aws s3 cp ocp-install/bootstrap.ign s3://openshift-ignition-<cluster-name>/ --profile govcloud
   aws s3 cp ocp-install/master.ign s3://openshift-ignition-<cluster-name>/ --profile govcloud
   aws s3 cp ocp-install/worker.ign s3://openshift-ignition-<cluster-name>/ --profile govcloud
   ```

5. **Launch EC2 instances** (see [EC2 Instance Provisioning](#ec2-instance-provisioning))

6. **Register instances to NLB target groups**

7. **Monitor bootstrap progress**
   ```bash
   openshift-install wait-for bootstrap-complete --dir=ocp-install --log-level=info
   ```

8. **Remove bootstrap from NLB** when "Bootstrap complete" appears

9. **Terminate bootstrap instance**

10. **Approve CSRs**
    ```bash
    export KUBECONFIG=ocp-install/auth/kubeconfig
    oc get csr -o name | xargs oc adm certificate approve
    ```

11. **Wait for installation complete**
    ```bash
    openshift-install wait-for install-complete --dir=ocp-install --log-level=info
    ```

---

## Related Documentation

- **Application docs:**
  - [SCENARIOS_CLOUD_FAMILY.md](../SCENARIOS_CLOUD_FAMILY.md) - Cloud scenario overview
  - [DISCONNECTED_SCENARIO_MATRIX.md](../DISCONNECTED_SCENARIO_MATRIX.md) - Disconnected deployment support

- **Templates:**
  - CloudFormation template (to be created): `load-balancer-examples/aws-govcloud-nlb.yaml`
  - Terraform example (to be created): `dns-examples/route53-terraform.tf`

- **Red Hat official docs:**
  - OpenShift 4.20 Installing on AWS GovCloud: User-provisioned infrastructure  
    https://docs.redhat.com/en/documentation/openshift_container_platform/4.20/html/installing_on_aws_govcloud/installing-aws-govcloud-upi

---

**Feedback:** If you find gaps in this guide or have suggestions, please create an issue in the project repository.
