# Enhancement: Replace GitHub Catalog Polling with In-Cluster gRPC Catalog Pods

**Status:** Proposed  
**Priority:** P2 (Normal planned work)  
**Created:** 2026-06-24  
**Labels:** enhancement, backend, console-plugin, operators, connected-mode

---

## Summary

When running in connected mode, the backend currently polls GitHub for operator catalog information. This should be replaced with direct querying of gRPC catalog pods running in the cluster to get complete operator metadata (names, descriptions, icons) for display in the OpenShift console UI.

## Current State

**Backend catalog source:** GitHub repository polling  

**Limitations:**
- Limited operator metadata available
- Missing operator icons
- Incomplete descriptions
- Not using the authoritative source (the catalog pods that OpenShift itself uses)
- Potential for stale/outdated catalog data

## Proposed Enhancement

**New approach:** Spin up and query gRPC catalog pods directly in the cluster

**Architecture:**
1. Backend detects connected mode (when operator is running in OpenShift cluster)
2. Backend creates/manages catalog pods (similar to how OpenShift CatalogSource works)
3. Query catalog pods via gRPC for full operator metadata
4. Return rich operator information to console plugin UI

## Benefits

✅ **Complete operator metadata:**
- Full operator names and descriptions
- Operator icons/logos for visual identification
- Bundle metadata (channels, versions, dependencies)
- CSV (ClusterServiceVersion) data

✅ **Authoritative data source:**
- Same catalog source that OpenShift uses
- Consistent with what operators will actually install
- No discrepancies between displayed info and installed operators

✅ **Better UX in console plugin:**
- Visual operator selection with icons
- Rich descriptions for informed decisions
- Channel/version information

✅ **Real-time catalog state:**
- Live catalog data from cluster
- Reflects current catalog pod state
- No polling delays or stale data

## Technical Details

### Catalog Pod Management

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: catalog-grpc-query-temp
  namespace: mirror-operator-system
spec:
  containers:
  - name: registry-server
    image: registry.redhat.io/redhat/community-operator-index:v4.17
    command:
    - /bin/opm
    - serve
    - /configs
    ports:
    - containerPort: 50051
      protocol: TCP
```

### gRPC Query Protocol

The backend would use the operator registry gRPC API to query:
- `ListBundles()` - Get all available operator bundles
- `GetBundle()` - Get detailed bundle metadata including CSV
- `GetPackage()` - Get package-level metadata
- Icon data from bundle manifests

### Example Response Data

```json
{
  "name": "cert-manager-operator",
  "displayName": "cert-manager Operator for Red Hat OpenShift",
  "description": "Manages x.509 certificates in OpenShift clusters...",
  "icon": {
    "base64data": "iVBORw0KGgoAAAANSUhEUgAA...",
    "mediatype": "image/png"
  },
  "channels": [
    {
      "name": "stable",
      "currentCSV": "cert-manager-operator.v1.13.0"
    }
  ],
  "defaultChannel": "stable",
  "version": "1.13.0",
  "provider": {
    "name": "Red Hat"
  },
  "keywords": ["certificate", "tls", "ssl", "acme"],
  "maintainers": [
    {
      "name": "Red Hat Support",
      "email": "support@redhat.com"
    }
  ]
}
```

## Implementation Considerations

### When to Use

- **Connected mode only** - Cluster has internet access, operator is running
- **Backend running in-cluster** - Has RBAC permissions to create pods
- **Fallback to GitHub** - If in-cluster query fails, fall back to current GitHub polling

### RBAC Requirements

Backend ServiceAccount needs:
```yaml
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: airgap-architect-backend
  namespace: mirror-operator-system
rules:
- apiGroups: [""]
  resources: ["pods", "pods/log"]
  verbs: ["create", "get", "list", "delete"]
- apiGroups: [""]
  resources: ["pods/portforward"]
  verbs: ["create", "get"]
```

### Cleanup Strategy

**Option 1: Ephemeral Pods**
- Create temporary catalog pod on-demand
- Query via gRPC
- Delete pod after query completes (or after timeout)
- **Pros:** Clean, no resource waste
- **Cons:** Startup time for each query (~10-30 seconds)

**Option 2: Long-Running Catalog Pod**
- Create catalog pod on backend startup
- Reuse for multiple queries
- Delete on backend shutdown or after idle timeout
- **Pros:** Fast queries after initial startup
- **Cons:** Resource usage when not querying

**Recommendation:** Start with Option 2, add idle timeout (5-10 minutes)

### gRPC Client Implementation

**Node.js gRPC Libraries:**
```javascript
const grpc = require('@grpc/grpc-js');
const protoLoader = require('@grpc/proto-loader');

// Load operator registry proto definitions
const packageDefinition = protoLoader.loadSync(
  'api/registry.proto',
  {
    keepCase: true,
    longs: String,
    enums: String,
    defaults: true,
    oneofs: true
  }
);
const registryProto = grpc.loadPackageDefinition(packageDefinition).api;

// Connect to catalog pod
const client = new registryProto.Registry(
  'catalog-grpc-query-temp.mirror-operator-system.svc:50051',
  grpc.credentials.createInsecure()
);

// Query packages
client.ListPackages({}, (error, packages) => {
  if (error) {
    console.error('gRPC error:', error);
    return;
  }
  console.log('Packages:', packages);
});
```

### Kubernetes API Integration

```javascript
const k8s = require('@kubernetes/client-node');

async function createCatalogPod() {
  const kc = new k8s.KubeConfig();
  kc.loadFromCluster(); // Load in-cluster config
  
  const k8sApi = kc.makeApiClient(k8s.CoreV1Api);
  
  const podManifest = {
    metadata: {
      name: 'catalog-grpc-query',
      namespace: 'mirror-operator-system',
      labels: {
        app: 'airgap-architect-catalog-query'
      }
    },
    spec: {
      containers: [{
        name: 'registry-server',
        image: 'registry.redhat.io/redhat/community-operator-index:v4.17',
        command: ['/bin/opm', 'serve', '/configs'],
        ports: [{
          containerPort: 50051,
          protocol: 'TCP'
        }]
      }],
      restartPolicy: 'Never'
    }
  };
  
  await k8sApi.createNamespacedPod('mirror-operator-system', podManifest);
  
  // Wait for pod to be ready
  await waitForPodReady('catalog-grpc-query', 'mirror-operator-system');
}
```

## Console Plugin UI Integration

### Current OperatorsSelectionStep

```tsx
// Current: Basic list without icons
{operators.map(op => (
  <Checkbox
    key={op.name}
    label={op.name}
    isChecked={selectedOperators.includes(op.name)}
    onChange={() => toggleOperator(op.name)}
  />
))}
```

### Enhanced with gRPC Metadata

```tsx
// Enhanced: Cards with icons and descriptions
{operators.map(op => (
  <Card key={op.name} isSelectable onClick={() => toggleOperator(op.name)}>
    <CardHeader>
      {op.icon && (
        <img 
          src={`data:${op.icon.mediatype};base64,${op.icon.base64data}`} 
          alt={op.displayName}
          style={{ width: 48, height: 48 }}
        />
      )}
      <CardTitle>{op.displayName || op.name}</CardTitle>
    </CardHeader>
    <CardBody>
      <Text component="p">{op.description}</Text>
      <Text component="small">
        Provider: {op.provider?.name || 'Unknown'} | 
        Channel: {op.defaultChannel} | 
        Version: {op.version}
      </Text>
    </CardBody>
  </Card>
))}
```

## Implementation Phases

### Phase 1: Backend gRPC Client (Week 1-2)
- [ ] Add gRPC dependencies (@grpc/grpc-js, @grpc/proto-loader)
- [ ] Add operator-registry proto definitions
- [ ] Implement Kubernetes pod creation/deletion
- [ ] Implement gRPC client for catalog queries
- [ ] Add error handling and fallback to GitHub polling

### Phase 2: Enhanced API Endpoint (Week 2-3)
- [ ] Create new API endpoint: `GET /api/operators/catalog/grpc`
- [ ] Return full operator metadata (icons, descriptions, channels)
- [ ] Add caching layer (5-10 minute TTL)
- [ ] Add metrics/logging for gRPC queries

### Phase 3: Console Plugin UI (Week 3-4)
- [ ] Update OperatorsSelectionStep to consume new API
- [ ] Display operator icons
- [ ] Show full descriptions in tooltips/cards
- [ ] Add channel/version selection UI
- [ ] Test with multiple catalog sources

### Phase 4: Testing & Refinement (Week 4-5)
- [ ] Integration tests for gRPC client
- [ ] UI testing with real catalog data
- [ ] Performance testing (pod startup time, query latency)
- [ ] Documentation updates

## Acceptance Criteria

- [ ] Backend can create and manage catalog gRPC pods in the cluster
- [ ] Backend can query catalog pods via gRPC API for full metadata
- [ ] Operator metadata includes icons, full descriptions, channel info
- [ ] Console plugin displays operator icons in selection UI
- [ ] Console plugin shows rich operator descriptions
- [ ] Fallback to GitHub polling if in-cluster query fails
- [ ] Proper cleanup of temporary catalog pods (no resource leaks)
- [ ] Documentation for RBAC requirements
- [ ] Unit tests for gRPC client
- [ ] Integration tests for full catalog query flow

## Testing Strategy

### Unit Tests
```javascript
describe('gRPC Catalog Client', () => {
  it('should create catalog pod', async () => {
    const pod = await createCatalogPod();
    expect(pod.metadata.name).toBe('catalog-grpc-query');
  });
  
  it('should query packages via gRPC', async () => {
    const packages = await listPackages();
    expect(packages).toHaveLength(greaterThan(0));
  });
  
  it('should cleanup catalog pod', async () => {
    await deleteCatalogPod();
    const pods = await listPods({ labelSelector: 'app=airgap-architect-catalog-query' });
    expect(pods.items).toHaveLength(0);
  });
});
```

### Integration Tests
- Deploy backend to test cluster
- Create catalog pod
- Query multiple operators
- Verify icon data is base64 encoded
- Verify descriptions are complete
- Test fallback to GitHub on gRPC failure

## Related Components

- **Backend:** `backend/src/` - Add gRPC catalog query logic
  - New file: `backend/src/grpcCatalogClient.js`
  - Update: `backend/src/index.js` (new API endpoint)
- **Console Plugin:** `console-plugin/src/components/OperatorsSelectionStep*.tsx`
  - Display rich operator metadata with icons
- **Operator:** Mirror operator RBAC for backend ServiceAccount
- **Manifests:** `manifests/base/` - Update backend Role/RoleBinding

## Dependencies

### NPM Packages (Backend)
```json
{
  "@grpc/grpc-js": "^1.10.0",
  "@grpc/proto-loader": "^0.7.10",
  "@kubernetes/client-node": "^0.20.0"
}
```

### Proto Definitions
- Vendor operator-registry proto files or reference from container image
- Source: https://github.com/operator-framework/operator-registry/tree/master/pkg/api

### Container Images
- `registry.redhat.io/redhat/community-operator-index:v4.17`
- `registry.redhat.io/redhat/certified-operator-index:v4.17`
- `registry.redhat.io/redhat/redhat-marketplace-index:v4.17`
- `registry.redhat.io/redhat/redhat-operator-index:v4.17`

## References

- [Operator Registry gRPC API](https://github.com/operator-framework/operator-registry/blob/master/docs/design/opm-server.md)
- [OpenShift CatalogSource](https://docs.openshift.com/container-platform/4.17/operators/understanding/olm/olm-understanding-operatorgroups.html)
- [OPM Serve Command](https://github.com/operator-framework/operator-registry/blob/master/docs/design/opm-serve.md)
- [Operator Registry Proto Definitions](https://github.com/operator-framework/operator-registry/tree/master/pkg/api)
- [gRPC Node.js Guide](https://grpc.io/docs/languages/node/)

## Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| gRPC pod startup time too slow | High - Poor UX if queries take 30+ seconds | Use long-running pod with idle timeout |
| RBAC permissions denied | High - Feature doesn't work | Document RBAC requirements clearly, provide install manifests |
| Catalog pod crashes | Medium - Queries fail | Implement retry logic, fallback to GitHub |
| Proto version mismatch | Medium - gRPC calls fail | Version-lock proto definitions, test with multiple OCP versions |
| Resource usage concerns | Low - Cluster admin pushback | Implement idle timeout, document resource requirements |

## Success Metrics

- **Query latency:** < 2 seconds for catalog queries (after pod startup)
- **Pod startup time:** < 20 seconds for catalog pod ready
- **Cache hit rate:** > 80% (most queries hit cache, not gRPC)
- **Fallback rate:** < 5% (gRPC should work in most connected scenarios)
- **Operator icon coverage:** > 90% of operators have icons displayed

## Future Enhancements

- Support for custom catalog sources beyond Red Hat indexes
- Offline catalog browsing (pre-cache operator metadata)
- Operator comparison view (side-by-side feature comparison)
- Dependency graph visualization
- Automatic operator updates detection

---

**Next Steps:**
1. Review and approve this enhancement proposal
2. Create implementation tasks in project backlog
3. Assign to developer for Phase 1 implementation
4. Schedule design review for console plugin UI mockups
