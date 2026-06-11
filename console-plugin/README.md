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

### Testing in OpenShift Console

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

3. Enable the plugin in your OpenShift Console:
   - Edit the console operator: `oc edit console.operator.openshift.io cluster`
   - Add to `spec.plugins`:
     ```yaml
     spec:
       plugins:
         - airgap-architect-plugin
     ```

4. Create a ConsolePlugin resource pointing to your dev server:
   ```yaml
   apiVersion: console.openshift.io/v1alpha1
   kind: ConsolePlugin
   metadata:
     name: airgap-architect-plugin
   spec:
     displayName: 'Airgap Architect'
     service:
       name: airgap-architect-plugin
       namespace: default
       port: 9001
       basePath: '/'
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
