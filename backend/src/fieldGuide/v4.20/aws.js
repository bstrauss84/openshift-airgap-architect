/**
 * v4.20 AWS GovCloud compartments.
 */

export const awsGovCloudPrereqs = {
  id: "aws-govcloud-prereqs",
  version: "4.20",
  title: "AWS GovCloud Prerequisites",
  order: 250,
  conditions: {
    platforms: ["AWS GovCloud"],
    methodologies: ["IPI"],
  },
  docRefs: [
    { label: "Installing a cluster on AWS (OCP 4.20)", url: "https://docs.redhat.com/en/documentation/openshift_container_platform/4.20/html/installing/installing-on-aws" },
    { label: "AWS GovCloud — disconnected install", url: "https://docs.redhat.com/en/documentation/openshift_container_platform/4.20/html/installing/installing-on-aws#installing-restricted-networks-aws-installer-provisioned" },
    { label: "AWS IPI install-config reference", url: "https://docs.redhat.com/en/documentation/openshift_container_platform/4.20/html/installing/installing-on-aws#installation-aws-config-yaml_installing-aws" },
  ],
  items: [
    { text: "Confirm you have an active AWS GovCloud account in region {{awsRegion}} with the required IAM permissions for OCP IPI installation." },
    { text: "Configure AWS CLI credentials on the installer host:", cmd: "aws configure\n# Or set environment variables:\nexport AWS_ACCESS_KEY_ID=...\nexport AWS_SECRET_ACCESS_KEY=...\nexport AWS_DEFAULT_REGION={{awsRegion}}" },
    { text: "Verify IAM permissions. The installer needs extensive AWS permissions (EC2, Route53, ELB, IAM, S3, etc.). See the OCP 4.20 AWS IPI required permissions list in the docs." },
    { text: "Verify connectivity to AWS GovCloud endpoints from the installer host:", cmd: "aws ec2 describe-availability-zones --region {{awsRegion}}\n# Expect: a list of AZs in {{awsRegion}}" },
    { text: "Confirm Route 53 hosted zone exists for {{baseDomain}} in the GovCloud account, or create it:", cmd: "aws route53 list-hosted-zones-by-name --region {{awsRegion}} | grep {{baseDomain}}" },
    { text: "For disconnected/restricted network installs: set up a VPC with private subnets and VPC endpoints for EC2, ELB, Route53, S3, and STS." },
    { text: "If using an existing VPC, note the VPC ID and private subnet IDs (one per AZ) to add to platform.aws.vpc.subnets in install-config.yaml." },
    { text: "For GovCloud with no Route 53: set platform.aws.hostedZone to empty and manage DNS records manually. Set publish: Internal for private clusters." },
    { text: "Obtain the RHCOS AMI ID for {{awsRegion}}. GovCloud regions require a custom AMI — check the OCP 4.20 AMI list in the installer or Red Hat docs.", cmd: "# List RHCOS AMIs in GovCloud:\naws ec2 describe-images --region {{awsRegion}} --owners 531415883065 \\\n  --filters 'Name=name,Values=rhcos-*4.20*' --query 'Images[*].{ID:ImageId,Name:Name}'" },
    { text: "Set platform.aws.amiID in install-config.yaml if the region requires a custom RHCOS AMI (GovCloud secret regions require this)." },
    { text: "Configure control-plane and worker instance types appropriate for GovCloud capacity. Recommended: m5.xlarge for control plane, m5.2xlarge for workers (or GovCloud equivalents)." },
    { text: "For a disconnected mirror registry in GovCloud: ensure the registry is reachable from the VPC private subnets (via VPC endpoint or internal routing)." },
    { text: "Set credentialsMode in install-config.yaml — for GovCloud disconnected, Manual mode is often required to avoid STS endpoint connectivity issues.", cmd: "# Example: credentialsMode: Manual\n# Requires generating CredentialsRequest objects manually." },
    { text: "⚠ AWS STS endpoints behave differently in GovCloud and isolated regions. If using manual credentials mode, ensure all CredentialsRequests are fulfilled before the install.", type: "warning" },
    { text: "Review the publish: Internal vs External setting in install-config.yaml. For GovCloud private clusters, use publish: Internal to prevent external exposure of the API endpoint." },
  ],
};

export const awsGovCloudInstall = {
  id: "aws-govcloud-install",
  version: "4.20",
  title: "AWS GovCloud Installation",
  order: 700,
  conditions: {
    platforms: ["AWS GovCloud"],
    methodologies: ["IPI"],
  },
  docRefs: [
    { label: "Installing a cluster on AWS — create cluster (OCP 4.20)", url: "https://docs.redhat.com/en/documentation/openshift_container_platform/4.20/html/installing/installing-on-aws#installing-aws" },
  ],
  items: [
    { text: "Place install-config.yaml in {{installDir}}. If you used the app and downloaded the export bundle, copy it from the bundle (it already has the AWS region, AMI ID, and mirror settings).", cmd: "mkdir -p {{installDir}}\ncp /path/to/bundle/install-config.yaml {{installDir}}/" },
    { text: "Back up install-config.yaml:", cmd: "cp {{installDir}}/install-config.yaml {{installDir}}/install-config.yaml.bak" },
    { text: "For manual credentials mode, generate and apply CredentialsRequests before running the installer:", cmd: "openshift-install create manifests --dir {{installDir}}\n# Process CredentialsRequests manually for each component\n# Apply with ccoctl or manually create IAM roles" },
    { text: "Start the installation:", cmd: "openshift-install create cluster --dir {{installDir}} --log-level=info" },
    { text: "Monitor bootstrap-complete. AWS EC2 instances will be launched in {{awsRegion}}:", cmd: "openshift-install wait-for bootstrap-complete --dir {{installDir}} --log-level=info" },
    { text: "Monitor EC2 instance state in the AWS Console or CLI:", cmd: "aws ec2 describe-instances --region {{awsRegion}} \\\n  --filters 'Name=tag:kubernetes.io/cluster/{{clusterName}},Values=owned' \\\n  --query 'Reservations[*].Instances[*].{ID:InstanceId,State:State.Name,Name:Tags[?Key==`Name`].Value|[0]}'" },
    { text: "Wait for install-complete:", cmd: "openshift-install wait-for install-complete --dir {{installDir}} --log-level=info" },
    { text: "Verify cluster access:", cmd: "export KUBECONFIG={{installDir}}/auth/kubeconfig\noc get nodes\noc get co" },
    { text: "Verify AWS cloud provider is operational:", cmd: "oc get pods -n openshift-cloud-controller-manager\noc get pods -n openshift-cluster-storage-operator" },
    { text: "Confirm EBS CSI driver is healthy (default storage for AWS):", cmd: "oc get csidriver ebs.csi.aws.com" },
    { text: "Check cluster operators:", cmd: "oc get co" },
    { text: "Review install log:", cmd: "grep -i 'warn\\|error\\|aws' {{installDir}}/.openshift_install.log | tail -20" },
    { text: "Set up cluster autoscaling MachineAutoscaler if variable workloads are expected in the GovCloud environment." },
  ],
};

export const awsGovCloudUpiPrereqs = {
  id: "aws-govcloud-upi-prereqs",
  version: "4.20",
  title: "AWS GovCloud UPI Prerequisites",
  order: 250,
  conditions: {
    platforms: ["AWS GovCloud"],
    methodologies: ["UPI"],
  },
  docRefs: [
    { label: "Installing a cluster on AWS with UPI (OCP 4.20)", url: "https://docs.redhat.com/en/documentation/openshift_container_platform/4.20/html/installing/installing-on-aws#installing-aws-user-infra" },
  ],
  items: [
    { text: "For UPI on AWS GovCloud, you provision all AWS infrastructure manually: VPC, subnets, IAM roles, Route53 records, ELBs, EC2 instances." },
    { text: "Use the OCP UPI CloudFormation templates (available in the installer artifacts) as a starting point, adapting them for GovCloud resource naming and service availability." },
    { text: "Create the VPC, subnets (3 AZs), internet gateway (or NAT for private), and security groups following the OCP UPI networking requirements." },
    { text: "Create the required IAM roles and instance profiles (master-role, worker-role) with policies specified in the OCP AWS UPI documentation." },
    { text: "Set up Route53 private hosted zone for {{clusterName}}.{{baseDomain}} within the VPC." },
    { text: "Create internal load balancers: API ELB (6443 + 22623) and ingress ELB (80 + 443). Note the DNS names for Route53 records." },
    { text: "Generate ignition configs:", cmd: "openshift-install create ignition-configs --dir {{installDir}}" },
    { text: "Upload bootstrap.ign to an S3 bucket accessible from within the VPC (private bucket with instance IAM role access)." },
    { text: "Launch EC2 instances (bootstrap, control-plane × 3, workers) using the RHCOS AMI for {{awsRegion}} and the appropriate instance type." },
    { text: "Pass ignition config to EC2 instances via user-data (pointer to S3 bootstrap.ign for bootstrap; encoded master.ign / worker.ign for others)." },
    { text: "⚠ Bootstrap ignition in EC2 user-data is limited to 16 KB. Use the S3 pointer ignition pattern for bootstrap.", type: "warning" },
    { text: "Monitor instance launch and confirm all VMs pass status checks in EC2 console." },
  ],
};

export const awsGovCloudUpiInstall = {
  id: "aws-govcloud-upi-install",
  version: "4.20",
  title: "AWS GovCloud UPI Installation",
  order: 720,
  conditions: {
    platforms: ["AWS GovCloud"],
    methodologies: ["UPI"],
  },
  docRefs: [
    { label: "AWS UPI — cluster installation steps (OCP 4.20)", url: "https://docs.redhat.com/en/documentation/openshift_container_platform/4.20/html/installing/installing-on-aws#installation-aws-user-infra-installation_installing-aws-user-infra" },
  ],
  items: [
    { text: "Monitor bootstrap-complete:", cmd: "openshift-install wait-for bootstrap-complete --dir {{installDir}} --log-level=info" },
    { text: "Approve control-plane CSRs:", cmd: "oc get csr | grep Pending\noc adm certificate approve $(oc get csr -o name | xargs)" },
    { text: "Remove bootstrap node from ELB target group after bootstrap-complete.", cmd: "aws elbv2 deregister-targets --region {{awsRegion}} --target-group-arn <api-tg-arn> --targets Id=<bootstrap-instance-id>" },
    { text: "Terminate the bootstrap EC2 instance after removing it from ELB:", cmd: "aws ec2 terminate-instances --region {{awsRegion}} --instance-ids <bootstrap-instance-id>" },
    { text: "Register worker nodes with ELB target groups after they launch." },
    { text: "Approve worker CSRs:", cmd: "oc get csr | grep Pending\noc adm certificate approve $(oc get csr -o name | xargs)" },
    { text: "Wait for install-complete:", cmd: "openshift-install wait-for install-complete --dir {{installDir}} --log-level=info" },
    { text: "Verify cluster:", cmd: "oc get nodes\noc get co" },
    { text: "Delete the S3 bootstrap ignition file after installation is confirmed complete.", cmd: "aws s3 rm s3://<your-bucket>/bootstrap.ign" },
    { text: "Remove the temporary security group rules added for bootstrap if any exist." },
  ],
};
