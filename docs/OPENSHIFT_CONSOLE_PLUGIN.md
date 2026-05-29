# OpenShift Console Dynamic Plugin - Future Enhancement

**Status:** Not Started (Future Consideration)  
**Date Documented:** 2026-05-28  
**Context:** After implementing operator-managed connected flow with CollectionPipeline integration

---

## Overview

This document outlines the approach for converting the operator-managed flow into an OpenShift Console dynamic plugin, allowing the Airgap Architect UI to run natively inside the OpenShift web console.

### Current State

- **Standalone React App**: Frontend served by dedicated pod, accessed via OpenShift Route
- **Backend Service**: Express.js backend handles state, generation, operator scanning
- **Operator Deployment**: CRD-based deployment with frontend/backend pods
- **Two Flows**: Connected mode (operator-managed) and disconnected mode (standalone)

### Proposed State

- **Hybrid Deployment**: Both standalone app AND console plugin
- **Plugin Integration**: Appears in OpenShift console navigation when operator installed
- **Code Sharing**: 90% of React components shared between modes
- **Backend Unchanged**: Keep Express backend for complex operations

---

## Benefits of Console Plugin

### User Experience

1. **Native Integration**
   - Appears in OpenShift console Administrator/Developer perspectives
   - Consistent navigation with other OpenShift features
   - No need to remember separate Route URL

2. **Authentication & RBAC**
   - Uses OpenShift user authentication automatically
   - Respects existing RBAC policies
   - No separate login required

3. **Direct K8s API Access**
   - Console SDK provides authenticated k8s client
   - Create CollectionPipeline CRs directly from browser
   - Watch CR status in real-time

4. **Operator Discovery**
   - Plugin automatically available when operator installed
   - Removed when operator uninstalled
   - Version tied to operator version

### Developer Experience

1. **Consistent UX Patterns**
   - Follows OpenShift design guidelines
   - Users already familiar with console navigation
   - Matches look/feel of other OpenShift features

2. **Built-in Components**
   - Console SDK provides list/detail views
   - Status badges, resource links, breadcrumbs
   - K8s resource watchers with auto-refresh

---

## Difficulty Assessment

### Easy Parts ✅

#### 1. React Components Already Compatible

**Current Stack:**
- React 18
- Already using functional components with hooks
- State management via Context API

**Console Requirements:**
- React 17+ (compatible)
- Functional components preferred
- Context/hooks work fine

**Effort:** Minimal - components work as-is

#### 2. Patternfly Components

**Current Usage:**
```jsx
// Already using PatternFly in standalone app
import { Button, Card, Form } from '@patternfly/react-core';
```

**Console Requirement:**
- Uses same Patternfly library
- Same version range (v4/v5)

**Effort:** None - already compatible

#### 3. Build Tools

**Current:** Vite + React
**Console:** Webpack 5 + React

**Migration:**
- Create separate `console-plugin/` directory
- New webpack config for plugin
- Keep Vite for standalone mode

**Effort:** Low - well-documented pattern

---

### Medium Difficulty ⚙️

#### 1. Plugin Manifest Structure

**Required Files:**

```
console-plugin/
├── package.json
├── webpack.config.js
├── console-extensions.json       # Plugin metadata
└── src/
    ├── plugin.tsx                 # Plugin entry point
    ├── extensions.ts              # Console extension definitions
    └── components/                # Shared from ../frontend/src
```

**`console-extensions.json`:**
```json
{
  "name": "airgap-architect-plugin",
  "version": "1.0.0",
  "displayName": "Airgap Architect",
  "description": "Generate imageset-config.yaml for disconnected OpenShift deployments",
  "exposedModules": {
    "AirgapArchitectPage": "./components/AirgapArchitectPage",
    "CollectionPipelineList": "./components/CollectionPipelineList"
  },
  "dependencies": {
    "@console/pluginAPI": "*"
  }
}
```

**Effort:** 4-6 hours (setup + documentation)

#### 2. Console Navigation Registration

**Extension Definition (`src/extensions.ts`):**
```typescript
import type { EncodedExtension } from '@openshift/dynamic-plugin-sdk';
import type { NavigationSection, HrefNavItem } from '@openshift-console/dynamic-plugin-sdk';

const extensions: EncodedExtension[] = [
  // Add navigation section
  {
    type: 'console.navigation/section',
    properties: {
      id: 'airgap-architect-section',
      name: 'Airgap Architect',
      insertAfter: 'operators'
    }
  } as EncodedExtension<NavigationSection>,

  // Add navigation link
  {
    type: 'console.navigation/href',
    properties: {
      id: 'airgap-architect-imageset',
      name: 'ImageSet Configuration',
      href: '/airgap-architect/imageset',
      section: 'airgap-architect-section',
      namespaced: false
    }
  } as EncodedExtension<HrefNavItem>,

  // Add navigation link for CollectionPipelines
  {
    type: 'console.navigation/resource-ns',
    properties: {
      id: 'airgap-architect-pipelines',
      name: 'Collection Pipelines',
      section: 'airgap-architect-section',
      model: {
        group: 'mirror.mirror.mathianasj.github.com',
        version: 'v1',
        kind: 'CollectionPipeline'
      }
    }
  } as EncodedExtension<ResourceNSNavItem>
];

export default extensions;
```

**Effort:** 6-8 hours (routing + navigation)

#### 3. Backend API Integration

**Option A: Keep Current Backend (Recommended)**

```typescript
// Plugin uses same apiFetch as standalone
import { apiFetch } from '../../../frontend/src/api';

const RunCollectionStep = () => {
  const handleCreate = async () => {
    // Same code as standalone - hits backend service
    const response = await apiFetch('/api/collection-pipeline/create', {
      method: 'POST',
      body: JSON.stringify({ name, imageSetConfig, pvc, triggerType })
    });
  };
};
```

**Pros:**
- No changes to existing backend
- Complex operations (generation, scanning) stay server-side
- Works exactly like standalone

**Cons:**
- Still need backend pod running
- One extra network hop

**Option B: Direct K8s API for Simple Operations**

```typescript
import { k8sCreate, useK8sWatchResource } from '@openshift-console/dynamic-plugin-sdk';

const RunCollectionStep = () => {
  const handleCreate = async () => {
    // Direct CR creation via console SDK
    const cr = {
      apiVersion: 'mirror.mirror.mathianasj.github.com/v1',
      kind: 'CollectionPipeline',
      metadata: { name, namespace },
      spec: { imageSetConfig, storage: { output: { pvc } } }
    };
    
    await k8sCreate({ model: CollectionPipelineModel, data: cr });
  };

  // Watch CollectionPipeline status in real-time
  const [pipeline, loaded, error] = useK8sWatchResource({
    kind: 'CollectionPipeline',
    name: 'release1',
    namespace: 'mirror-operator-system'
  });
};
```

**Pros:**
- No backend needed for CR operations
- Real-time status updates
- Cleaner architecture

**Cons:**
- Still need backend for generation, operator scanning
- Split logic between plugin and backend

**Recommendation:** Hybrid approach
- Use K8s API for CollectionPipeline CRUD
- Keep backend for generation, scanning, Cincinnati

**Effort:** 8-12 hours (SDK integration)

---

### Harder Parts 🔧

#### 1. Development Workflow

**Challenge:** Can't run plugin standalone

**Current Dev Mode:**
```bash
cd frontend
npm run dev
# Opens http://localhost:5173
```

**Plugin Dev Mode:**
```bash
cd console-plugin
npm run dev
# Serves plugin at http://localhost:9001
# MUST open OpenShift console to see it
# Console loads plugin via proxy
```

**Solutions:**

1. **Local OpenShift Console**
   ```bash
   # Run console locally pointing to remote cluster
   oc login https://api.cluster.example.com
   ./console --public-dir=./public --plugins airgap-architect=http://localhost:9001
   ```

2. **Remote Deployment**
   - Deploy plugin to dev cluster
   - Rebuild/redeploy on changes
   - Slower iteration

3. **Mock Console Environment** (Advanced)
   - Stub console SDK APIs
   - Requires significant setup
   - Only for unit tests

**Recommendation:** Keep standalone app for rapid development

**Effort:** N/A (workflow change, not code)

#### 2. Testing Strategy

**Unit Tests:**
```typescript
// Harder - need to mock console SDK
import { k8sCreate } from '@openshift-console/dynamic-plugin-sdk';
jest.mock('@openshift-console/dynamic-plugin-sdk');

describe('CollectionPipeline creation', () => {
  it('creates CR with correct spec', async () => {
    const mockCreate = k8sCreate as jest.Mock;
    mockCreate.mockResolvedValue({ metadata: { name: 'test' } });
    
    // Test component
    await createPipeline('test', 'config.yaml');
    
    expect(mockCreate).toHaveBeenCalledWith({
      model: CollectionPipelineModel,
      data: expect.objectContaining({
        kind: 'CollectionPipeline'
      })
    });
  });
});
```

**Integration Tests:**
- Need running OpenShift console
- Harder to automate
- Cypress/Playwright possible but complex

**Recommendation:**
- Test shared components in standalone mode (existing tests)
- Manual testing in console for plugin-specific code
- Focus on contract tests (API boundaries)

**Effort:** 8-12 hours (test setup + coverage)

---

## Recommended Architecture: Hybrid Approach

### Directory Structure

```
openshift-airgap-architect/
├── frontend/                          # Standalone React app (KEEP)
│   ├── src/
│   │   ├── components/                # Shared components
│   │   │   ├── ReleaseSelectionStep.jsx
│   │   │   ├── OperatorsStep.jsx
│   │   │   ├── ImageSetConfigStep.jsx
│   │   │   └── RunCollectionStep.jsx
│   │   ├── store.jsx                  # Shared state management
│   │   ├── api.js                     # Shared API client
│   │   └── App.jsx                    # Standalone entry point
│   ├── package.json
│   └── vite.config.js
│
├── console-plugin/                    # NEW - OpenShift Console Plugin
│   ├── src/
│   │   ├── plugin.tsx                 # Plugin entry point
│   │   ├── extensions.ts              # Console extension definitions
│   │   ├── models.ts                  # K8s resource models
│   │   ├── pages/
│   │   │   ├── ImageSetConfigPage.tsx # Wrapper for shared components
│   │   │   └── CollectionPipelineListPage.tsx
│   │   └── components/                # Plugin-specific components
│   │       └── CollectionPipelineDetails.tsx
│   ├── package.json
│   ├── webpack.config.js
│   └── console-extensions.json
│
├── shared/                            # NEW - Shared utilities
│   └── package.json                   # Workspace package
│
├── backend/                           # KEEP - No changes
│   └── src/
│       ├── index.js
│       └── collectionPipeline.js
│
└── package.json                       # Root workspace config
```

### Workspace Configuration

**Root `package.json`:**
```json
{
  "name": "openshift-airgap-architect-workspace",
  "private": true,
  "workspaces": [
    "frontend",
    "console-plugin",
    "shared",
    "backend"
  ],
  "scripts": {
    "dev:standalone": "npm run dev -w frontend",
    "dev:plugin": "npm run dev -w console-plugin",
    "build:all": "npm run build -w frontend && npm run build -w console-plugin",
    "test:all": "npm run test -w frontend && npm run test -w console-plugin"
  }
}
```

**`shared/package.json`:**
```json
{
  "name": "@airgap-architect/shared",
  "version": "1.0.0",
  "main": "index.js",
  "exports": {
    "./components": "./src/components/index.js",
    "./store": "./src/store.jsx",
    "./api": "./src/api.js"
  }
}
```

### Code Sharing Pattern

**Standalone App (`frontend/src/App.jsx`):**
```jsx
// Uses shared components directly
import { ReleaseSelectionStep } from '@airgap-architect/shared/components';
import { useApp } from '@airgap-architect/shared/store';

function App() {
  const { state } = useApp();
  return <ReleaseSelectionStep />;
}
```

**Console Plugin (`console-plugin/src/pages/ImageSetConfigPage.tsx`):**
```tsx
// Wraps shared components with plugin context
import { ReleaseSelectionStep } from '@airgap-architect/shared/components';
import { useApp } from '@airgap-architect/shared/store';
import { Page, PageSection } from '@openshift-console/dynamic-plugin-sdk';

export const ImageSetConfigPage: React.FC = () => {
  const { state } = useApp();
  
  return (
    <Page>
      <PageSection variant="light">
        <ReleaseSelectionStep />
      </PageSection>
    </Page>
  );
};
```

### When to Use Which Mode

**Use Standalone App:**
- Development (faster iteration)
- Non-OpenShift deployments
- Laptop/bastion host usage
- CI/CD testing

**Use Console Plugin:**
- Production OpenShift deployments with operator
- Native console integration desired
- Users already in console workflow
- RBAC integration required

**Both Can Run Simultaneously:**
- Operator deploys both standalone pods AND plugin
- User chooses which to use
- Same backend serves both

---

## Implementation Steps

### Phase 1: Setup Plugin Infrastructure (1-2 days)

1. **Create Plugin Directory**
   ```bash
   mkdir -p console-plugin/src/{pages,components}
   cd console-plugin
   npm init -y
   ```

2. **Install Dependencies**
   ```bash
   npm install react react-dom
   npm install --save-dev @openshift-console/dynamic-plugin-sdk
   npm install --save-dev @openshift-console/dynamic-plugin-sdk-webpack
   npm install --save-dev webpack webpack-cli webpack-dev-server
   npm install --save-dev typescript @types/react @types/react-dom
   ```

3. **Create Webpack Config**
   ```javascript
   // console-plugin/webpack.config.js
   const path = require('path');
   const { ConsoleRemotePlugin } = require('@openshift-console/dynamic-plugin-sdk-webpack');

   module.exports = {
     mode: 'development',
     entry: './src/plugin.tsx',
     output: {
       path: path.resolve(__dirname, 'dist'),
       filename: '[name]-bundle.js',
       chunkFilename: '[name]-chunk.js'
     },
     resolve: {
       extensions: ['.ts', '.tsx', '.js', '.jsx']
     },
     module: {
       rules: [
         {
           test: /\.(jsx?|tsx?)$/,
           exclude: /node_modules/,
           use: ['ts-loader']
         },
         {
           test: /\.css$/,
           use: ['style-loader', 'css-loader']
         }
       ]
     },
     plugins: [
       new ConsoleRemotePlugin()
     ],
     devServer: {
       port: 9001,
       headers: {
         'Access-Control-Allow-Origin': '*'
       }
     }
   };
   ```

4. **Create Plugin Entry Point**
   ```typescript
   // console-plugin/src/plugin.tsx
   import type { EncodedExtension } from '@openshift/dynamic-plugin-sdk';
   import extensions from './extensions';

   const plugin: Plugin = {
     name: 'airgap-architect-plugin',
     extensions
   };

   export default plugin;
   ```

### Phase 2: Migrate First Component (2-3 days)

**Goal:** Get ImageSet Configuration page working in console

1. **Create Resource Model**
   ```typescript
   // console-plugin/src/models.ts
   import { K8sModel } from '@openshift-console/dynamic-plugin-sdk';

   export const CollectionPipelineModel: K8sModel = {
     apiGroup: 'mirror.mirror.mathianasj.github.com',
     apiVersion: 'v1',
     kind: 'CollectionPipeline',
     plural: 'collectionpipelines',
     label: 'Collection Pipeline',
     labelPlural: 'Collection Pipelines',
     abbr: 'CP',
     namespaced: true,
     crd: true
   };
   ```

2. **Create Page Component**
   ```typescript
   // console-plugin/src/pages/ImageSetConfigPage.tsx
   import React from 'react';
   import { Page, PageSection, Title } from '@patternfly/react-core';
   import { ImageSetConfigStep } from '@airgap-architect/shared/components';
   import { AppProvider } from '@airgap-architect/shared/store';

   export const ImageSetConfigPage: React.FC = () => {
     return (
       <AppProvider>
         <Page>
           <PageSection variant="light">
             <Title headingLevel="h1">ImageSet Configuration</Title>
           </PageSection>
           <PageSection>
             <ImageSetConfigStep />
           </PageSection>
         </Page>
       </AppProvider>
     );
   };
   ```

3. **Register Navigation**
   ```typescript
   // console-plugin/src/extensions.ts
   import type { EncodedExtension } from '@openshift/dynamic-plugin-sdk';
   
   const extensions: EncodedExtension[] = [
     {
       type: 'console.page/route',
       properties: {
         exact: true,
         path: '/airgap-architect/imageset',
         component: { $codeRef: 'ImageSetConfigPage' }
       }
     },
     {
       type: 'console.navigation/href',
       properties: {
         id: 'airgap-architect-imageset',
         name: 'ImageSet Config',
         href: '/airgap-architect/imageset',
         section: 'administration'
       }
     }
   ];

   export default extensions;
   ```

4. **Test in Console**
   ```bash
   # Terminal 1: Build plugin
   cd console-plugin
   npm run dev

   # Terminal 2: Run console locally
   oc login https://api.cluster.example.com
   ./bin/bridge --plugins airgap-architect=http://localhost:9001
   ```

### Phase 3: Add CollectionPipeline List/Detail (2-3 days)

1. **Create List View**
   ```typescript
   // console-plugin/src/pages/CollectionPipelineListPage.tsx
   import { ListPage } from '@openshift-console/dynamic-plugin-sdk';
   import { CollectionPipelineModel } from '../models';

   const CollectionPipelineListPage: React.FC = () => {
     return (
       <ListPage
         kind={CollectionPipelineModel.kind}
         ListComponent={CollectionPipelineList}
         filterLabel="Collection Pipelines"
       />
     );
   };
   ```

2. **Create Detail View**
   ```typescript
   // console-plugin/src/pages/CollectionPipelineDetailsPage.tsx
   import { DetailsPage } from '@openshift-console/dynamic-plugin-sdk';
   import { useK8sWatchResource } from '@openshift-console/dynamic-plugin-sdk';

   const CollectionPipelineDetailsPage: React.FC = ({ match }) => {
     const [pipeline, loaded, error] = useK8sWatchResource({
       kind: CollectionPipelineModel.kind,
       name: match.params.name,
       namespace: match.params.ns
     });

     return (
       <DetailsPage
         kind={CollectionPipelineModel.kind}
         name={match.params.name}
         namespace={match.params.ns}
         pages={[
           {
             href: '',
             name: 'Details',
             component: CollectionPipelineDetails
           },
           {
             href: 'yaml',
             name: 'YAML',
             component: ResourceYAMLEditor
           }
         ]}
       />
     );
   };
   ```

### Phase 4: Production Build & Deployment (1-2 days)

1. **Build Plugin for Production**
   ```bash
   cd console-plugin
   npm run build
   # Outputs to console-plugin/dist/
   ```

2. **Create Plugin Deployment Manifest**
   ```yaml
   # manifests/openshift/console-plugin-deployment.yaml
   apiVersion: apps/v1
   kind: Deployment
   metadata:
     name: airgap-architect-console-plugin
     namespace: mirror-operator-system
   spec:
     replicas: 1
     selector:
       matchLabels:
         app: airgap-architect-console-plugin
     template:
       metadata:
         labels:
           app: airgap-architect-console-plugin
       spec:
         containers:
         - name: plugin
           image: quay.io/mathianasj/airgap-architect-console-plugin:latest
           ports:
           - containerPort: 9443
             protocol: TCP
           volumeMounts:
           - name: plugin-serving-cert
             mountPath: /var/serving-cert
             readOnly: true
         volumes:
         - name: plugin-serving-cert
           secret:
             secretName: plugin-serving-cert
   ---
   apiVersion: v1
   kind: Service
   metadata:
     name: airgap-architect-console-plugin
     namespace: mirror-operator-system
     annotations:
       service.beta.openshift.io/serving-cert-secret-name: plugin-serving-cert
   spec:
     ports:
     - name: 9443-tcp
       protocol: TCP
       port: 9443
       targetPort: 9443
     selector:
       app: airgap-architect-console-plugin
   ```

3. **Create ConsolePlugin CR**
   ```yaml
   # manifests/openshift/console-plugin.yaml
   apiVersion: console.openshift.io/v1
   kind: ConsolePlugin
   metadata:
     name: airgap-architect-plugin
   spec:
     displayName: 'Airgap Architect'
     service:
       name: airgap-architect-console-plugin
       namespace: mirror-operator-system
       port: 9443
       basePath: '/'
   ```

4. **Update Operator to Deploy Plugin**
   ```go
   // operator reconcile logic
   func (r *AirgapArchitectReconciler) Reconcile(ctx context.Context, req ctrl.Request) {
     // ... existing code ...
     
     // Deploy console plugin
     if err := r.reconcileConsolePlugin(ctx, instance); err != nil {
       return ctrl.Result{}, err
     }
   }
   ```

5. **Enable Plugin in Console**
   ```bash
   # Operator enables automatically via ConsolePlugin CR
   # Or manually:
   oc patch console.operator.openshift.io cluster \
     --type=json \
     -p '[{"op": "add", "path": "/spec/plugins/-", "value": "airgap-architect-plugin"}]'
   ```

---

## Effort Estimate

### Total Implementation Time

| Phase | Task | Estimated Time |
|-------|------|----------------|
| Phase 1 | Plugin infrastructure setup | 1-2 days |
| Phase 2 | Migrate ImageSet Config page | 2-3 days |
| Phase 3 | CollectionPipeline list/detail | 2-3 days |
| Phase 4 | Production build & deployment | 1-2 days |
| Testing | Integration testing in console | 2-3 days |
| Documentation | User guide, dev guide | 1 day |
| **Total** | **End-to-end plugin** | **9-14 days** |

**Assumptions:**
- Developer familiar with React and TypeScript
- Basic understanding of OpenShift console plugins
- Access to OpenShift cluster for testing
- Standalone app remains functional (hybrid approach)

**Risks:**
- Console SDK API changes (low risk - stable API)
- Complex state management edge cases (medium risk)
- Backend API compatibility (low risk - no changes needed)
- Testing complexity (medium risk - manual testing required)

---

## Decision Criteria

### Build Plugin If:

✅ **Users primarily work in OpenShift console**
- Users rarely leave console for other tasks
- Workflow is console-centric

✅ **Native integration is high value**
- Want plugin to feel like built-in OpenShift feature
- Navigation consistency important

✅ **Operator is primary deployment method**
- Users always install via operator
- Standalone deployment rare or never used

✅ **RBAC integration needed**
- Different users have different permissions
- Need to respect OpenShift RBAC for CR operations

✅ **Have 2+ weeks of development time**
- Team can dedicate focused time
- Not blocking other critical features

### Keep Standalone Only If:

❌ **Users work outside OpenShift**
- Need to run on laptops or bastion hosts
- Disconnected environments without console access

❌ **Rapid iteration priority**
- Need fast dev cycles (Vite vs Webpack + console)
- Plugin dev workflow too slow

❌ **Limited development resources**
- Can't dedicate 2 weeks to plugin work
- Standalone app meets all requirements

❌ **Standalone already meets needs**
- Current UX is good enough
- No user complaints about separate UI

### Hybrid Approach (Recommended) If:

✅ **Support both use cases**
- Some users in console, some standalone
- Want flexibility for different environments

✅ **Progressive enhancement**
- Start with standalone, add plugin later
- Gradual migration of users

✅ **Code reuse maximized**
- Share 90% of components
- Minimal duplication

---

## References

### OpenShift Console Plugin Documentation

- **Dynamic Plugin SDK**: https://github.com/openshift/dynamic-plugin-sdk
- **Console Extensions**: https://docs.openshift.com/container-platform/latest/web_console/dynamic-plug-ins.html
- **Example Plugins**: https://github.com/openshift/console/tree/master/frontend/packages/console-dynamic-plugin-sdk/docs/examples

### Sample Console Plugins

1. **ACM Console Plugin**: https://github.com/stolostron/console
2. **Logging Console Plugin**: https://github.com/openshift/logging-view-plugin
3. **Virtualization Console Plugin**: https://github.com/kubevirt-ui/kubevirt-plugin

### Webpack Configuration

- **ConsoleRemotePlugin**: https://www.npmjs.com/package/@openshift-console/dynamic-plugin-sdk-webpack
- **Plugin Webpack Example**: https://github.com/openshift/console/blob/master/frontend/packages/console-dynamic-plugin-sdk/docs/examples/webpack.config.js

---

## Next Steps (When Ready to Build)

1. **Create Proof of Concept**
   - Set up minimal plugin with one page
   - Validate build process works
   - Test in dev cluster
   - **Effort:** 1-2 days

2. **User Research**
   - Survey users: console vs standalone preference?
   - Identify pain points with current standalone UI
   - Validate plugin features users want
   - **Effort:** 1 week (async)

3. **Architecture Review**
   - Review workspace structure with team
   - Decide on code sharing strategy
   - Plan migration path
   - **Effort:** 1 day meeting

4. **Implement Phase 1**
   - Follow Phase 1 steps above
   - Get basic plugin loading in console
   - Validate navigation works
   - **Effort:** 1-2 days

5. **Iterate**
   - Migrate components one by one
   - Test each phase before proceeding
   - Keep standalone app working throughout

---

## Open Questions

1. **Deployment Strategy**
   - Should operator deploy plugin automatically?
   - Or make it optional (opt-in)?
   - How to handle plugin versioning vs operator versioning?

2. **Backend Dependency**
   - Keep Express backend for all operations?
   - Or move some logic to plugin (direct K8s API)?
   - What's the right split?

3. **Multi-Cluster Support**
   - Plugin runs in hub cluster
   - Can it manage CollectionPipelines in other clusters?
   - ACM integration needed?

4. **Offline Support**
   - Plugin requires console to be running
   - How to handle fully disconnected scenarios?
   - Keep standalone as fallback?

5. **Testing Strategy**
   - How to automate plugin testing?
   - CI/CD for plugin builds?
   - Integration tests with full console?

---

**Last Updated:** 2026-05-28  
**Author:** Claude Sonnet 4.5 (with user collaboration)  
**Status:** Documentation only - not yet implemented
