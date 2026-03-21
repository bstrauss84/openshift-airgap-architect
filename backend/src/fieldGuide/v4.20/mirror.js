/**
 * v4.20 mirror compartments — mirror registry setup and oc-mirror workflows.
 */

export const mirrorRegistrySetup = {
  id: "mirror-registry-setup",
  version: "4.20",
  title: "Mirror Registry Setup",
  order: 310,
  conditions: { when: (ctx) => ctx.usingMirrorRegistry },
  docRefs: [
    { label: "mirror-registry for Red Hat OpenShift (OCP 4.20)", url: "https://docs.redhat.com/en/documentation/openshift_container_platform/4.20/html/disconnected_installation_mirroring/installing-mirroring-installation-images" },
    { label: "Using the mirror registry for disconnected installations", url: "https://docs.redhat.com/en/documentation/openshift_container_platform/4.20/html/disconnected_installation_mirroring/installing-mirroring-disconnected-v2" },
  ],
  items: [
    { text: "Install the mirror-registry tool (or configure an approved enterprise registry) on a host with persistent storage accessible from all cluster nodes:", cmd: "# Download mirror-registry:\ncurl -LO https://mirror.openshift.com/pub/cgw/mirror-registry/latest/mirror-registry.tar.gz\ntar xf mirror-registry.tar.gz" },
    { text: "Install the mirror registry on the high-side host with a fully-qualified hostname matching {{registryFqdn}}:", cmd: "sudo ./mirror-registry install \\\n  --quayHostname {{registryFqdn}} \\\n  --quayRoot /data/quay \\\n  --initUser admin \\\n  --initPassword '<strong-password>'" },
    { text: "Verify the registry is reachable and returns a healthy status:", cmd: "curl -Is https://{{registryFqdn}}/v2/ | head -3\n# Expect: HTTP/2 200 or HTTP/2 401" },
    { text: "Export the registry CA certificate and install it as a trusted CA on the installer host:", cmd: "sudo cp /data/quay/quay-rootCA/rootCA.pem /etc/pki/ca-trust/source/anchors/mirror-registry-ca.pem\nsudo update-ca-trust extract\ncurl -Is https://{{registryFqdn}}/v2/ | head -2\n# Must not show SSL errors" },
    { text: "Generate and validate registry credentials (base64-encode for pull-secret format):", cmd: "podman login {{registryFqdn}} -u admin\n# Or use:\necho -n 'admin:<password>' | base64" },
    { text: "Ensure storage backend for the registry has sufficient capacity. Minimum recommendation for OCP {{version}} base release + RHCOS: ~50 GB. With operators, plan 150–500 GB depending on operator count." },
    { text: "If the registry uses a custom TLS certificate (not mirror-registry's self-signed), ensure the certificate SAN includes {{registryFqdn}} and the CA is distributed to all nodes via additionalTrustBundle." },
    { text: "Create the repository namespace(s) needed by oc-mirror — by default oc-mirror v2 creates them automatically, but verify the registry user has create-repo permission:" },
    { text: "Test image push to the registry to confirm write access:", cmd: "podman pull ubi9/ubi:latest\npodman tag ubi9/ubi:latest {{registryFqdn}}/test/ubi:latest\npodman push {{registryFqdn}}/test/ubi:latest\npodman rmi {{registryFqdn}}/test/ubi:latest" },
    { text: "For high availability, consider running two registry instances behind a load balancer or using an enterprise Quay deployment — a single mirror-registry instance is a SPOF for cluster operations." },
    { text: "Configure registry garbage collection and storage pruning schedule to manage disk usage over time." },
    { text: "Document the registry admin credentials, CA certificate location, and backup procedure before handing off to operations." },
    { text: "⚠ The mirror registry must remain operational for all cluster lifecycle actions: upgrades, operator installs, and new pod scheduling that requires new image pulls.", type: "warning" },
    { text: "Verify the registry FQDN resolves from all cluster nodes (add DNS record if not yet present):", cmd: "nslookup {{registryFqdn}}" },
    { text: "Confirm firewall allows HTTPS/443 from all cluster node IPs to the registry host." },
  ],
};

export const ocMirrorLowSide = {
  id: "oc-mirror-low-side",
  version: "4.20",
  title: "Mirror to Disk (Low Side)",
  order: 450,
  conditions: { when: (ctx) => ctx.usingMirrorRegistry && ctx.connectivity === "fully-disconnected" },
  docRefs: [
    { label: "oc-mirror v2: mirroring to disk", url: "https://docs.redhat.com/en/documentation/openshift_container_platform/4.20/html/disconnected_installation_mirroring/mirroring-images-disconnected-install-oc-mirror-v2#oc-mirror-creating-mirror-to-disk_oc-mirror-v2" },
    { label: "ImageSetConfiguration reference (v2)", url: "https://docs.redhat.com/en/documentation/openshift_container_platform/4.20/html/disconnected_installation_mirroring/mirroring-images-disconnected-install-oc-mirror-v2#oc-mirror-v2-imageset-config-ref" },
  ],
  items: [
    { text: "📦 If you used the OpenShift Airgap Architect app and downloaded the export bundle, {{imageSetConfig}} is pre-generated for {{clusterName}} with your selected OCP {{version}}, operators, and additional images. Copy it to your working directory on the low-side host before running oc-mirror." },
    { text: "On the connected (low side) host, ensure the REGISTRY_AUTH_FILE points to a pull secret with access to quay.io, registry.redhat.io, and registry.access.redhat.com:", cmd: "export REGISTRY_AUTH_FILE=/path/to/pull-secret.json\ncat $REGISTRY_AUTH_FILE | python3 -m json.tool | grep -o '\"[^\"]*\\.io\"' | sort -u" },
    { text: "Create the output directory for the mirror archive:", cmd: "mkdir -p {{archivePath}}" },
    { text: "Run oc-mirror v2 mirror-to-disk with the {{imageSetConfig}} configuration:", cmd: "oc-mirror --config {{imageSetConfig}} file://{{archivePath}} --v2" },
    { text: "Monitor progress — oc-mirror prints per-image progress. Expect runtime of 30–120 minutes depending on operator count and bandwidth.", cmd: "# oc-mirror logs progress to stdout; use tee to save:\noc-mirror --config {{imageSetConfig}} file://{{archivePath}} --v2 2>&1 | tee oc-mirror-lowside.log" },
    { text: "After completion, verify the archive directory contains the expected content:", cmd: "ls -lh {{archivePath}}\ndu -sh {{archivePath}}" },
    { text: "Generate SHA256 checksums for all files in the archive (required for transfer verification):", cmd: "cd {{archivePath}} && find . -type f -maxdepth 3 -print0 | xargs -0 sha256sum > SHA256SUMS.txt\nwc -l SHA256SUMS.txt" },
    { text: "Verify the checksum file itself is not empty:", cmd: "head -5 {{archivePath}}/SHA256SUMS.txt" },
    { text: "List the top-level archive structure to confirm expected directories (blobs, manifests, etc.) are present:", cmd: "ls -la {{archivePath}}/" },
    { text: "If oc-mirror reported any errors for specific images (partial mirror), check the log and re-run with --continue-on-error or address the missing images before transfer:" },
    { text: "⚠ Do NOT modify or extract the archive directory structure between mirror-to-disk and disk-to-mirror. oc-mirror v2 expects the exact layout it created.", type: "warning" },
    { text: "Confirm that the workspace directory {{workspacePath}} was created by oc-mirror (it stores metadata used in disk-to-mirror):", cmd: "ls {{workspacePath}}/working-dir/ 2>/dev/null || echo 'Workspace not created — check oc-mirror log'" },
    { text: "Note the total archive size before initiating transfer — ensure the transfer medium has sufficient capacity:", cmd: "du -sh {{archivePath}}" },
    { text: "Save the oc-mirror log for later audit/troubleshooting:", cmd: "cp oc-mirror-lowside.log {{archivePath}}/oc-mirror-lowside.log" },
    { text: "If differential (incremental) mirroring is planned for future updates, the {{workspacePath}}/working-dir metadata must also be transferred to the high side." },
    { text: "Verify the imageSetConfig version field matches the installed oc-mirror binary's supported API version before running subsequent mirrors." },
  ],
};

export const airGapTransfer = {
  id: "air-gap-transfer",
  version: "4.20",
  title: "Air Gap Transfer",
  order: 500,
  conditions: { when: (ctx) => ctx.connectivity === "fully-disconnected" },
  docRefs: [
    { label: "Preparing for a disconnected install (OCP 4.20)", url: "https://docs.redhat.com/en/documentation/openshift_container_platform/4.20/html/disconnected_installation_mirroring/index" },
  ],
  items: [
    { text: "Package the archive and all supporting files for transfer. If you used the OpenShift Airgap Architect app, the install-config.yaml, agent-config.yaml, imageset-config.yaml, NTP MachineConfigs, and this field guide are in your export bundle ZIP — include them in the transfer.", cmd: "# Transfer checklist:\n# {{archivePath}}/              (oc-mirror archive)\n# {{workspacePath}}/            (oc-mirror workspace — needed for incremental updates)\n# SHA256SUMS.txt\n# imageset-config.yaml          (app-generated if using the app)\n# install-config.yaml           (app-generated if using the app)\n# agent-config.yaml             (app-generated for Agent-Based Installer)\n# 99-chrony-ntp-*.yaml          (app-generated if NTP configured)\n# pull-secret.json (mirror registry portion only)\n# ca-bundle.pem (if custom CA)\n# openshift-install binary\n# oc binary\n# oc-mirror binary" },
    { text: "Transfer using your organization's approved media (encrypted USB drive, secure FTP to DMZ jump host, or approved data diode)." },
    { text: "After transfer to the high side, verify checksums against the SHA256SUMS.txt generated on the low side:", cmd: "cd {{archivePath}} && sha256sum -c SHA256SUMS.txt 2>&1 | grep -v OK\n# Zero output means all files verified successfully" },
    { text: "⚠ Any checksum mismatch indicates file corruption during transfer. Re-transfer the affected files before proceeding.", type: "warning" },
    { text: "Confirm the total file count on the high side matches the low side:", cmd: "find {{archivePath}} -type f | wc -l\n# Compare with the low-side count from the checksum file:\nwc -l {{archivePath}}/SHA256SUMS.txt" },
    { text: "If using a jumpbox scenario, also verify files survive the second hop (low side → jumpbox → high side) with checksums at each hop." },
    { text: "Log the transfer timestamp, media ID, and operator signature per your organization's chain-of-custody requirements." },
    { text: "After transfer, place the archive at {{archivePath}} on the high-side host that has access to the mirror registry at {{registryFqdn}}." },
  ],
};

export const ocMirrorHighSide = {
  id: "oc-mirror-high-side",
  version: "4.20",
  title: "Disk to Mirror (High Side)",
  order: 550,
  conditions: { when: (ctx) => ctx.usingMirrorRegistry && ctx.connectivity === "fully-disconnected" },
  docRefs: [
    { label: "oc-mirror v2: mirroring from disk to registry", url: "https://docs.redhat.com/en/documentation/openshift_container_platform/4.20/html/disconnected_installation_mirroring/mirroring-images-disconnected-install-oc-mirror-v2#oc-mirror-disk-to-mirror_oc-mirror-v2" },
  ],
  items: [
    { text: "On the high-side host, ensure the mirror registry ({{registryFqdn}}) is running and reachable:", cmd: "curl -Is https://{{registryFqdn}}/v2/ | head -2" },
    { text: "Ensure REGISTRY_AUTH_FILE is set to credentials with write access to {{registryFqdn}}:", cmd: "export REGISTRY_AUTH_FILE=/path/to/mirror-pull-secret.json\npodman login {{registryFqdn}}" },
    { text: "Run oc-mirror v2 disk-to-mirror to push content from the archive into the registry:", cmd: "oc-mirror --config {{imageSetConfig}} --from {{archivePath}} docker://{{registryFqdn}} --v2" },
    { text: "Monitor progress — disk-to-mirror is typically faster than mirror-to-disk since it's a local read. Expect 15–60 minutes.", cmd: "oc-mirror --config {{imageSetConfig}} --from {{archivePath}} docker://{{registryFqdn}} --v2 2>&1 | tee oc-mirror-highside.log" },
    { text: "After completion, verify the workspace results directory contains the cluster-resources manifests:", cmd: "ls {{workspacePath}}/working-dir/cluster-resources/\n# Expect: imageDigestMirrorSet.yaml, imageTagMirrorSet.yaml, catalogSource-*.yaml" },
    { text: "Verify the OCP release image is present in the registry:", cmd: "oc image info {{registryFqdn}}/openshift/release-images:{{version}}-x86_64 2>&1 | head -5" },
    { text: "If oc-mirror reported errors for specific images, check the log and re-push if necessary. Partial pushes may cause installer failures." },
    { text: "⚠ The cluster-resources manifests in {{workspacePath}}/working-dir/cluster-resources/ must be applied to the cluster AFTER install. Do not skip this step.", type: "warning" },
    { text: "Review the generated IDMS/ITMS resources to confirm they reference {{registryFqdn}} correctly:", cmd: "grep -r 'mirrors' {{workspacePath}}/working-dir/cluster-resources/ | head -10" },
    { text: "If CatalogSource manifests were generated, verify the catalog index image reference points to {{registryFqdn}}:", cmd: "grep 'image:' {{workspacePath}}/working-dir/cluster-resources/catalogSource-*.yaml 2>/dev/null | head -5" },
    { text: "Check registry storage usage after push to ensure sufficient space remains for future incremental mirrors:", cmd: "df -h /data/quay 2>/dev/null || du -sh {{registryFqdn}}" },
    { text: "Save the disk-to-mirror log:", cmd: "cp oc-mirror-highside.log {{workspacePath}}/oc-mirror-highside.log" },
    { text: "Confirm the registry can serve the release image to a test pull before starting the actual installation:", cmd: "skopeo inspect --tls-verify=true docker://{{registryFqdn}}/openshift/release-images:{{version}}-x86_64 2>&1 | head -5" },
    { text: "Note the exact registry paths for release image and release-images in the generated IDMS — these must match what is set in install-config.yaml imageDigestSources." },
    { text: "For subsequent differential mirrors (upgrades), re-run mirror-to-disk on low side with updated imagesetconfig, transfer, then re-run disk-to-mirror." },
  ],
};

export const clusterResourcesApply = {
  id: "cluster-resources-apply",
  version: "4.20",
  title: "Apply Cluster Resources",
  order: 560,
  conditions: { when: (ctx) => ctx.usingMirrorRegistry },
  docRefs: [
    { label: "Applying cluster resources after mirroring (OCP 4.20)", url: "https://docs.redhat.com/en/documentation/openshift_container_platform/4.20/html/disconnected_installation_mirroring/mirroring-images-disconnected-install-oc-mirror-v2#oc-mirror-v2-apply-cluster-resources" },
  ],
  items: [
    { text: "After the cluster is installed, apply the oc-mirror generated cluster-resources manifests:", cmd: "oc apply -f {{workspacePath}}/working-dir/cluster-resources/" },
    { text: "Verify IDMS (ImageDigestMirrorSet) resources were applied:", cmd: "oc get idms\noc describe idms | grep -A5 'mirrors'" },
    { text: "Verify ITMS (ImageTagMirrorSet) resources were applied:", cmd: "oc get itms" },
    { text: "If CatalogSource manifests exist, apply them and verify catalog pods come up:", cmd: "oc apply -f {{workspacePath}}/working-dir/cluster-resources/catalogSource-*.yaml 2>/dev/null\noc get catalogsource -n openshift-marketplace" },
    { text: "Wait for the catalog pods to reach Running state (may take 5–10 minutes for index image pull):", cmd: "oc get pods -n openshift-marketplace -w" },
    { text: "Verify the catalog is available by checking package manifests:", cmd: "oc get packagemanifest -n openshift-marketplace | head -20" },
    { text: "Test that the cluster can pull an image from the mirror registry using the applied IDMS:", cmd: "oc run mirror-test --image=ubi9/ubi:latest --restart=Never --command -- echo 'mirror pull OK'\noc logs mirror-test\noc delete pod mirror-test" },
    { text: "⚠ If IDMS/ITMS resources are not applied, cluster upgrades will attempt to pull from quay.io and fail in the disconnected environment.", type: "warning" },
  ],
};
