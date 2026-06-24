# Operator Integration Requirements

This document outlines what the mirror-operator needs to do to fully integrate with the console plugin's CollectionPipeline detail view.

## CollectionPipeline Status Fields

The operator should populate the following fields in the `CollectionPipeline` status:

### Required Fields

```yaml
apiVersion: mirror.mirror.mathianasj.github.com/v1
kind: CollectionPipeline
metadata:
  name: collection-1718900000000
  namespace: mirror-operator-system
spec:
  imageSetConfig: |
    # The ImageSetConfiguration YAML
  storage:
    output:
      pvc: collection-4.x-output
  pvcSize: "100Gi"
  pvcStorageClass: "gp3-csi"
status:
  # Current phase of the pipeline
  phase: "Running" | "Complete" | "Succeeded" | "Failed" | "Pending"
  
  # OpenShift version being mirrored
  version: "4.14.0"
  
  # Pipeline execution times
  startTime: "2024-06-24T10:00:00Z"
  completionTime: "2024-06-24T10:30:00Z"  # Only when complete
  
  # Reference to the Tekton PipelineRun
  pipelineRunRef: "collection-1718900000000-run-xxxxx"
  
  # SBOM URL in Trusted Application Analyzer (new requirement)
  sbomUrl: "https://trustify.apps.cluster.example.com/packages/collection-1718900000000"
```

## SBOM URL Integration

### What the Operator Needs to Do

1. **After successful mirroring**: Upload the SBOM to the Trusted Application Analyzer (TrustifyHub)
2. **Get the SBOM URL**: Retrieve the URL where the SBOM can be viewed
3. **Update CollectionPipeline status**: Set the `sbomUrl` field in the status

### Example Workflow

```go
// Pseudocode showing operator workflow
func (r *CollectionPipelineReconciler) uploadSBOM(ctx context.Context, cp *mirrorv1.CollectionPipeline) error {
    // 1. Generate or extract SBOM from collection artifacts
    sbom, err := extractSBOM(cp)
    if err != nil {
        return err
    }
    
    // 2. Upload to Trusted Application Analyzer
    sbomURL, err := r.trustifyClient.Upload(ctx, sbom, cp.Name)
    if err != nil {
        return err
    }
    
    // 3. Update CollectionPipeline status with SBOM URL
    cp.Status.SbomUrl = sbomURL
    return r.Status().Update(ctx, cp)
}
```

### SBOM URL Format

The SBOM URL should be a direct link to view the SBOM in the Trusted Application Analyzer web interface, for example:

- `https://trustify.apps.cluster.example.com/packages/{collection-name}`
- `https://trustify.apps.cluster.example.com/sbom/{sbom-id}`

The exact format depends on your TrustifyHub deployment.

## PipelineRun Reference

The operator must set `pipelineRunRef` to the name of the Tekton PipelineRun resource. The console plugin will:

1. Fetch the PipelineRun details via Kubernetes API
2. Display task execution details including:
   - Task names
   - Task status (Succeeded, Running, Failed)
   - Duration per task
   - Start/completion timestamps
   - Overall pipeline duration

## Phase Values

The console plugin recognizes the following phase values:

- **`Pending`**: Pipeline created but not started
- **`Running`** or **`InProgress`**: Pipeline currently executing
- **`Complete`** or **`Succeeded`**: Pipeline completed successfully
- **`Failed`**: Pipeline execution failed

When `phase` is `Complete` or `Succeeded`, the console plugin will:
- Attempt to fetch pre-signed download URLs for artifacts
- Display the SBOM link (if `sbomUrl` is set)

## Testing the Integration

### 1. Create a CollectionPipeline

```yaml
apiVersion: mirror.mirror.mathianasj.github.com/v1
kind: CollectionPipeline
metadata:
  name: test-collection
  namespace: mirror-operator-system
spec:
  imageSetConfig: |
    apiVersion: mirror.openshift.io/v1alpha2
    kind: ImageSetConfiguration
    mirror:
      platform:
        channels:
        - name: stable-4.14
          minVersion: 4.14.0
          maxVersion: 4.14.0
  storage:
    output:
      pvc: collection-4.14-output
  pvcSize: "100Gi"
  pvcStorageClass: "gp3-csi"
```

### 2. Operator Updates Status

The operator should update the status as the pipeline progresses:

```yaml
status:
  phase: "Running"
  version: "4.14.0"
  startTime: "2024-06-24T10:00:00Z"
  pipelineRunRef: "test-collection-run-abc123"
```

### 3. On Completion

```yaml
status:
  phase: "Complete"
  version: "4.14.0"
  startTime: "2024-06-24T10:00:00Z"
  completionTime: "2024-06-24T10:45:00Z"
  pipelineRunRef: "test-collection-run-abc123"
  sbomUrl: "https://trustify.apps.cluster.example.com/packages/test-collection"
```

### 4. View in Console Plugin

Navigate to: `/airgap-architect/collections/test-collection`

The detail view should show:
- ✅ Status: Complete (green badge)
- ✅ Pipeline Tasks table with all task executions
- ✅ Total duration
- ✅ Download buttons for artifacts
- ✅ "View SBOM in Trusted Application Analyzer" link

## API Endpoints Required

The console plugin expects the following backend API endpoints to work:

### 1. Get Download URLs

**Endpoint**: `GET /api/collections/{name}/download-url`

**Response**:
```json
{
  "collectionName": "test-collection",
  "expiresIn": 3600,
  "urls": {
    "mirror_seq1_000000.tar": "https://s3.amazonaws.com/...",
    "mirror_seq1_000000.tar.sig": "https://s3.amazonaws.com/..."
  }
}
```

This endpoint should generate pre-signed S3 URLs (or equivalent) for downloading the collection artifacts.

## Troubleshooting

### SBOM Link Not Appearing

Check that:
1. `status.sbomUrl` is set in the CollectionPipeline
2. The URL is valid and accessible
3. The pipeline phase is `Complete` or `Succeeded`

### Task Details Not Showing

Check that:
1. `status.pipelineRunRef` is set correctly
2. The PipelineRun resource exists in the same namespace
3. The PipelineRun has `status.taskRuns` populated

### Download Buttons Not Appearing

Check that:
1. Pipeline phase is `Complete` or `Succeeded`
2. Backend API endpoint `/api/collections/{name}/download-url` is working
3. Artifacts exist in the configured storage location
