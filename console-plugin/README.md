# OpenShift Console Plugin - Airgap Architect

This is an OpenShift Console Dynamic Plugin that integrates the Airgap Architect ImageSetConfiguration wizard directly into the OpenShift web console.

## Architecture

- **Standalone Mode**: The existing `frontend/` app continues to work independently
- **Plugin Mode**: This plugin adds the same functionality to OpenShift Console
- **Shared Backend**: Both modes use the same Express.js backend API (no backend changes needed)
- **Shared Components**: React components are shared between standalone and plugin (90%+ code reuse)

## Development

### Prerequisites

- Node.js 20+
- npm or yarn
- Access to an OpenShift cluster (for testing the plugin)

### Install Dependencies

```bash
npm install
```

### Development Mode

Run the plugin dev server (webpack dev server on port 9001):

```bash
npm run dev
```

This starts a webpack dev server that serves the plugin bundle with hot reloading.

### Build

Build the plugin for production:

```bash
npm run build
```

Output is in `dist/` directory.

## Deploying to OpenShift

### Quick Start (Using Pre-Built Images)

The console plugin is automatically built and pushed to Quay.io by CI/CD:

```
quay.io/<your-org>/openshift-airgap-architect-console-plugin:latest
quay.io/<your-org>/openshift-airgap-architect-backend:latest
```

**Deploy to your cluster:**

```bash
# Create namespace
oc create namespace openshift-airgap-architect

# Deploy backend (required - plugin uses backend API)
oc apply -f ../manifests/base/backend-deployment.yaml
oc apply -f ../manifests/base/backend-service.yaml

# Deploy console plugin
oc apply -f k8s/deployment.yaml
oc apply -f k8s/service.yaml
oc apply -f k8s/consoleplugin.yaml

# Enable the plugin in OpenShift Console
oc patch console.operator.openshift.io cluster \
  --type='json' \
  -p='[{"op": "add", "path": "/spec/plugins/-", "value": "airgap-architect-plugin"}]'
```

The plugin will appear in the **Administrator** menu as "Airgap Architect".

### Update Image References

Before deploying, update `k8s/deployment.yaml` with your Quay organization:

```yaml
image: quay.io/YOUR-ORG/openshift-airgap-architect-console-plugin:latest
```

### Local Development Testing

1. Start the backend API server (port 4000):
   ```bash
   cd ../backend
   npm start
   ```

2. Start the plugin dev server (port 9001):
   ```bash
   cd ../console-plugin
   npm run dev
   ```

3. Port-forward the dev server into your cluster (for testing):
   ```bash
   # In another terminal
   kubectl port-forward -n openshift-airgap-architect service/airgap-architect-plugin 9001:9001
   ```

4. Apply the ConsolePlugin resource:
   ```bash
   oc apply -f k8s/consoleplugin.yaml
   ```

5. Enable the plugin:
   ```bash
   oc patch console.operator.openshift.io cluster \
     --type='json' \
     -p='[{"op": "add", "path": "/spec/plugins/-", "value": "airgap-architect-plugin"}]'
   ```

6. Refresh your OpenShift Console - the plugin should load from your local dev server

### Verify Deployment

Check plugin is running:
```bash
oc get pods -n openshift-airgap-architect
oc logs -n openshift-airgap-architect deployment/airgap-architect-plugin
```

Check plugin is registered:
```bash
oc get consoleplugin airgap-architect-plugin
```

Check Console operator has loaded it:
```bash
oc get console.operator.openshift.io cluster -o jsonpath='{.spec.plugins}'
```

## Directory Structure

```
console-plugin/
├── src/
│   ├── pages/              # Console pages
│   │   ├── AirgapArchitectPage.tsx       # Landing page
│   │   └── CreateImageSetPage.tsx        # Wizard page (Phase 2)
│   ├── components/         # Shared React components (Phase 2)
│   ├── models/             # API client models (Phase 2)
│   └── plugin.tsx          # Plugin entry point
├── console-extensions.json # Plugin metadata and extension points
├── webpack.config.js       # Webpack config for plugin bundling
├── tsconfig.json           # TypeScript config
├── package.json
└── README.md
```

## Implementation Phases

### Phase 1: Plugin Infrastructure ✅ (Current)
- Basic plugin structure
- Navigation integration
- Landing page with stub wizard link

### Phase 2: Wizard Integration (Next)
- Reuse existing wizard components from `frontend/src/steps/`
- Wire up to existing backend API
- Full connected flow functionality

### Phase 3: Deployment & Testing
- Containerized plugin service
- Kubernetes manifests
- E2E testing in real OpenShift clusters

### Phase 4: Advanced Features
- List/manage existing ImageSetConfigurations
- Integration with oc-mirror job status
- Enhanced UX for console environment

## API Integration

The plugin uses the same backend API as the standalone app:

- `GET /api/releases` - Fetch available OpenShift releases
- `GET /api/catalogs` - Fetch operator catalogs
- `POST /api/catalogs/:name/sync` - Sync catalog
- `GET /api/catalogs/:name/operators` - List operators
- `POST /api/imageset/generate` - Generate ImageSetConfiguration YAML

No backend changes required - the Express.js server on port 4000 serves both standalone and plugin modes.

## Component Sharing

Components will be shared via relative imports from `../frontend/src/`:

```typescript
import ReleaseSelectionStep from '../../frontend/src/steps/ReleaseSelectionStep';
import OperatorsStep from '../../frontend/src/steps/OperatorsStep';
```

PatternFly components work in both contexts with minimal adaptation.

## Known Limitations

- Requires OpenShift 4.10+ (for ConsolePlugin API)
- Plugin dev server must be accessible from browser (CORS headers configured)
- Shared components assume PatternFly 5 styling
