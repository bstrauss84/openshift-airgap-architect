# Kubernetes / OpenShift Deployment Manifests

Production-ready Kubernetes manifests for deploying OpenShift Airgap Architect to a
Kubernetes or OpenShift cluster using [Kustomize](https://kustomize.io/).

## Architecture

```
                  +-----------+         +------------------+
  User/Browser -->| frontend  |-------->| backend          |
                  | (Vite)    |  HTTP   | (Express + SQLite|
                  | port 5173 |         |  + oc/oc-mirror) |
                  +-----------+         +--------+---------+
                                                 |
                                          +------+------+
                                          |   PVC       |
                                          | /data       |
                                          | (SQLite DB  |
                                          |  + mirrors) |
                                          +-------------+
```

- **Backend** -- single replica (SQLite single-writer constraint), Express API with
  `oc` and `oc-mirror` binaries for generating OpenShift install configs.
- **Frontend** -- stateless Vite dev server, scales horizontally (default: 2 replicas).
- **PVC** -- 250 Gi by default (50 GB database + 200 GB oc-mirror workspace).

## Prerequisites

1. A running Kubernetes 1.25+ or OpenShift 4.12+ cluster.
2. `kubectl` (or `oc`) and `kustomize` installed locally.
3. Container images built and available to the cluster:
   - `localhost/openshift-airgap-architect-backend:latest`
   - `localhost/openshift-airgap-architect-frontend:latest`

   If using an internal registry, push the images there and update the `image:` fields
   in the Deployment manifests or use a Kustomize image override (see Customization).

4. A Red Hat pull secret from <https://console.redhat.com/openshift/install/pull-secret>.
5. A StorageClass that supports `ReadWriteOnce` PVCs (most clusters have a default).

## Quick Start (Kubernetes)

```bash
# 1. Build container images (from project root)
podman build -t localhost/openshift-airgap-architect-backend:latest \
  -f backend/Containerfile .
podman build -t localhost/openshift-airgap-architect-frontend:latest \
  -f frontend/Containerfile frontend/

# 2. Populate the Secret with your pull secret
#    Edit manifests/base/secret.yaml and paste your pull secret JSON into
#    the pull-secret.json field.

# 3. Validate (dry-run)
kubectl apply --dry-run=client -k manifests/

# 4. Deploy
kubectl apply -k manifests/

# 5. Check pod status
kubectl get pods -l app=airgap-architect
kubectl logs -l app=airgap-architect,component=backend --tail=50
```

## Quick Start (OpenShift)

OpenShift adds TLS-terminated Routes for external access.

```bash
# 1. Build images (same as above, or use OpenShift Builds/Tekton)

# 2. Populate secret (same as above)

# 3. Validate
oc apply --dry-run=client -k manifests/openshift/

# 4. Deploy (includes Routes)
oc apply -k manifests/openshift/

# 5. Get the Route URLs
oc get routes -l app=airgap-architect
```

The OpenShift overlay at `manifests/openshift/` includes all base resources plus the
Routes. There is no need to apply `manifests/` separately.

## Directory Layout

```
manifests/
  kustomization.yaml              # Base Kustomization (K8s, no Routes)
  README.md                       # This file
  base/
    backend-deployment.yaml       # Backend Deployment (1 replica, SQLite)
    backend-service.yaml          # Backend ClusterIP Service (port 4000)
    frontend-deployment.yaml      # Frontend Deployment (2 replicas)
    frontend-service.yaml         # Frontend ClusterIP Service (port 5173)
    pvc.yaml                      # PersistentVolumeClaim (250 Gi)
    configmap.yaml                # Non-sensitive configuration
    secret.yaml                   # Sensitive values (pull secret, registry auth)
  openshift/
    kustomization.yaml            # OpenShift overlay (base + Routes)
    route-backend.yaml            # TLS edge Route for the backend API
    route-frontend.yaml           # TLS edge Route for the frontend UI
```

## Customization

### Change the namespace

Uncomment the `namespace:` line in `manifests/kustomization.yaml` (or the OpenShift
overlay) and set it to your target namespace:

```yaml
namespace: airgap-architect
```

Or apply with `-n`:

```bash
kubectl apply -k manifests/ -n airgap-architect
```

### Override container images

If your images are in a private registry, use Kustomize's `images` transformer.
Add to `manifests/kustomization.yaml`:

```yaml
images:
  - name: localhost/openshift-airgap-architect-backend
    newName: registry.example.com/team/airgap-architect-backend
    newTag: v1.5.0
  - name: localhost/openshift-airgap-architect-frontend
    newName: registry.example.com/team/airgap-architect-frontend
    newTag: v1.5.0
```

### Change storage size or class

Edit `manifests/base/pvc.yaml`:

```yaml
spec:
  resources:
    requests:
      storage: 500Gi       # Increase for large mirror workloads
  storageClassName: gp3-csi # Set to your cluster's StorageClass
```

### Adjust resource limits

Edit the `resources:` section in the Deployment files. The defaults are:

| Component | CPU request | CPU limit | Memory request | Memory limit |
|-----------|-------------|-----------|----------------|--------------|
| Backend   | 500m        | 2000m     | 1 Gi           | 4 Gi         |
| Frontend  | 100m        | 500m      | 256 Mi         | 512 Mi       |

The backend may need higher limits when running `oc-mirror` operations that process
large image sets.

### Configure the backend API URL for external access

When exposing the frontend through an Ingress or Route, update `VITE_API_BASE` in the
ConfigMap so the browser can reach the backend:

```yaml
# manifests/base/configmap.yaml
data:
  VITE_API_BASE: "https://airgap-architect-backend.apps.mycluster.example.com"
```

Also set `VITE_ALLOWED_HOSTS` to the frontend's external hostname:

```yaml
  VITE_ALLOWED_HOSTS: "airgap-architect-frontend.apps.mycluster.example.com"
```

### Add an ImagePullSecret

If the images are in a private registry requiring authentication:

```bash
kubectl create secret docker-registry airgap-architect-pull \
  --docker-server=registry.example.com \
  --docker-username=user \
  --docker-password=pass

# Then add to Deployments via Kustomize patch or edit the YAML:
# spec.template.spec.imagePullSecrets:
#   - name: airgap-architect-pull
```

## OpenShift Security Context Constraints (SCC)

The manifests are designed for the **restricted-v2** SCC (OpenShift 4.12+ default):

- `runAsNonRoot: true`, `runAsUser: 1001`
- `allowPrivilegeEscalation: false`
- `capabilities.drop: [ALL]`
- `seccompProfile.type: RuntimeDefault`

No custom SCC should be required. If the backend entrypoint's `chown` call fails
in a restricted context, the `fsGroup: 1001` on the pod spec ensures the PVC is
writable.

## Troubleshooting

### Pods stuck in Pending

```bash
kubectl describe pod -l app=airgap-architect
```

Common causes:
- **No matching StorageClass**: Set `storageClassName` in `pvc.yaml` explicitly.
- **Insufficient resources**: Reduce `requests` in the Deployment resource limits.
- **ImagePullBackOff**: The container image is not reachable. Push to a registry
  the cluster can access and update the `image:` fields.

### Backend CrashLoopBackOff

```bash
kubectl logs -l app=airgap-architect,component=backend --tail=100
```

Common causes:
- **PVC not mounted / not writable**: Check `kubectl get pvc`. Ensure the PVC is
  Bound and the StorageClass supports `ReadWriteOnce`.
- **Missing /data directory**: The entrypoint script creates it. If `fsGroup` is
  correct, this should work automatically.
- **Port conflict**: Ensure nothing else listens on port 4000 inside the pod.

### Frontend cannot reach backend

Check the `VITE_API_BASE` value in the ConfigMap:

- **In-cluster** (default): `http://airgap-architect-backend:4000` -- uses the K8s
  Service DNS name. This works when the frontend Vite dev server proxies API requests
  server-side.
- **External access** (browser hits backend directly): Set `VITE_API_BASE` to the
  external Route/Ingress URL of the backend.

### Route returns 503 (OpenShift)

```bash
oc get endpoints airgap-architect-backend
```

If no endpoints are listed, the backend pod is not ready. Check readiness probe
logs and PVC status.

### Data persistence after pod restart

The SQLite database and oc-mirror workspace live on the PVC at `/data`. As long as
the PVC is not deleted, data survives pod restarts and redeployments. The
`Recreate` deployment strategy ensures only one pod accesses SQLite at a time.

## Validation

Run a dry-run to check manifests without applying:

```bash
# Kubernetes (base only)
kubectl apply --dry-run=client -k manifests/

# OpenShift (base + Routes)
kubectl apply --dry-run=client -k manifests/openshift/
```

## Uninstalling

```bash
# Kubernetes
kubectl delete -k manifests/

# OpenShift
oc delete -k manifests/openshift/
```

To also delete the persistent data:

```bash
kubectl delete pvc airgap-architect-data
```
