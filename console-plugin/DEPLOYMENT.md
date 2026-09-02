# OpenShift Console Plugin Deployment Guide

This guide walks through deploying the Airgap Architect console plugin to an OpenShift cluster.

## Prerequisites

- OpenShift 4.10+ cluster
- `oc` CLI logged in with admin privileges
- Images pushed to accessible registry (Quay.io by default via CI/CD)

## Container Images

Three images are built by CI/CD:

1. **Backend API**: `quay.io/<org>/openshift-airgap-architect-backend:latest`
2. **Standalone Frontend**: `quay.io/<org>/openshift-airgap-architect-frontend:latest` 
3. **Console Plugin**: `quay.io/<org>/openshift-airgap-architect-console-plugin:latest`

For console plugin mode, you need **backend + console-plugin** (NOT frontend).

## Deployment Steps

### 1. Create Namespace

```bash
oc create namespace openshift-airgap-architect
```

### 2. Update Image References

Edit `console-plugin/k8s/deployment.yaml` and replace `REPLACE-WITH-YOUR-ORG` with your Quay organization:

```yaml
image: quay.io/YOUR-ORG/openshift-airgap-architect-console-plugin:latest
```

### 3. Deploy Backend API

The console plugin requires the backend API to function.

```bash
# Deploy backend from manifests directory
oc apply -f manifests/base/backend-deployment.yaml -n openshift-airgap-architect
oc apply -f manifests/base/backend-service.yaml -n openshift-airgap-architect
oc apply -f manifests/base/pvc.yaml -n openshift-airgap-architect

# Wait for backend to be ready
oc rollout status deployment/airgap-architect-backend -n openshift-airgap-architect
```

### 4. Deploy Console Plugin

```bash
# Deploy plugin
oc apply -f console-plugin/k8s/deployment.yaml
oc apply -f console-plugin/k8s/service.yaml

# Wait for plugin to be ready
oc rollout status deployment/airgap-architect-plugin -n openshift-airgap-architect
```

### 5. Register Plugin with Console

```bash
# Create ConsolePlugin resource
oc apply -f console-plugin/k8s/consoleplugin.yaml

# Enable plugin in Console operator
oc patch console.operator.openshift.io cluster \
  --type='json' \
  -p='[{"op": "add", "path": "/spec/plugins/-", "value": "airgap-architect-plugin"}]'
```

### 6. Verify Installation

Check all pods are running:
```bash
oc get pods -n openshift-airgap-architect
```

Expected output:
```
NAME                                          READY   STATUS    RESTARTS   AGE
airgap-architect-backend-xxxxxxxxx-xxxxx      1/1     Running   0          2m
airgap-architect-plugin-xxxxxxxxx-xxxxx       1/1     Running   0          1m
```

Check plugin is registered:
```bash
oc get consoleplugin
```

Expected output:
```
NAME                      AGE
airgap-architect-plugin   1m
```

Verify Console operator loaded it:
```bash
oc get console.operator.openshift.io cluster -o jsonpath='{.spec.plugins}' | jq
```

Should include `"airgap-architect-plugin"` in the array.

### 7. Access the Plugin

1. Open your OpenShift Console in a browser
2. Refresh the page (Ctrl+Shift+R / Cmd+Shift+R)
3. Navigate to **Administrator** → **Airgap Architect**

The plugin landing page should appear with options to create ImageSet configurations.

## Troubleshooting

### Plugin Not Showing in Console

1. **Check Console operator has the plugin enabled:**
   ```bash
   oc get console.operator.openshift.io cluster -o yaml | grep -A5 plugins
   ```

2. **Check plugin service is accessible:**
   ```bash
   oc get svc airgap-architect-plugin -n openshift-airgap-architect
   curl http://airgap-architect-plugin.openshift-airgap-architect.svc:9001/plugin-manifest.json
   ```

3. **Check plugin logs:**
   ```bash
   oc logs -n openshift-airgap-architect deployment/airgap-architect-plugin
   ```

4. **Check browser console for CORS errors**
   - Open browser DevTools → Console
   - Look for errors mentioning `airgap-architect-plugin`

### Backend API Not Reachable

1. **Check backend service:**
   ```bash
   oc get svc airgap-architect-backend -n openshift-airgap-architect
   curl http://airgap-architect-backend.openshift-airgap-architect.svc:4000/api/health
   ```

2. **Check backend logs:**
   ```bash
   oc logs -n openshift-airgap-architect deployment/airgap-architect-backend
   ```

### Console Plugin Crashes or Won't Start

1. **Check for image pull errors:**
   ```bash
   oc describe pod -n openshift-airgap-architect -l app=airgap-architect-plugin
   ```

2. **Verify nginx config:**
   ```bash
   oc exec -n openshift-airgap-architect deployment/airgap-architect-plugin -- cat /etc/nginx/conf.d/plugin.conf
   ```

3. **Check nginx error logs:**
   ```bash
   oc logs -n openshift-airgap-architect deployment/airgap-architect-plugin --previous
   ```

## Uninstalling

Remove the plugin from OpenShift Console:

```bash
# Disable plugin
oc patch console.operator.openshift.io cluster \
  --type='json' \
  -p='[{"op": "remove", "path": "/spec/plugins", "value": ["airgap-architect-plugin"]}]'

# Delete resources
oc delete -f console-plugin/k8s/
oc delete namespace openshift-airgap-architect
```

## Architecture Notes

- **Backend API** runs on port 4000 (ClusterIP service)
- **Console Plugin** runs on port 9001 (nginx serving static files)
- **Frontend (standalone)** is NOT needed when using console plugin mode
- Both backend and plugin can scale horizontally (though backend needs shared PVC for SQLite)

## Next Steps

After deployment, see Phase 2 implementation to integrate the full wizard:
- Release selection
- Operator catalog browsing
- ImageSetConfiguration generation

Refer to `docs/OPENSHIFT_CONSOLE_PLUGIN.md` for the full implementation roadmap.
