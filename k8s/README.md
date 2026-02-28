# OpenShift Airgap Architect – OpenShift/Kubernetes Deployment

Deploy the OpenShift Airgap Architect app on OpenShift 4.18+ (or Kubernetes with Ingress).

## Prerequisites

- OpenShift 4.18+ cluster (or Kubernetes with Ingress controller)
- `oc` or `kubectl` CLI
- Images built and pushed to a registry accessible by the cluster

## Build Images

```bash
# Backend
cd backend && podman build -f Containerfile -t openshift-airgap-architect-backend:latest .

# Frontend (multi-stage: build + static serve)
cd frontend && podman build -f Containerfile -t openshift-airgap-architect-frontend:latest .
```

For OpenShift internal registry:

```bash
# Log in to OpenShift registry
oc whoami -t | podman login -u unused --password-stdin $(oc get route default-route -n openshift-image-registry -o jsonpath='{.spec.host}' 2>/dev/null || echo "image-registry.openshift-image-registry.svc:5000")

# Tag and push (replace NAMESPACE with your project name)
podman tag openshift-airgap-architect-backend:latest image-registry.openshift-image-registry.svc:5000/ocp-airgap-architect/oaa-backend:latest
podman tag openshift-airgap-architect-frontend:latest image-registry.openshift-image-registry.svc:5000/ocp-airgap-architect/oaa-frontend:latest
podman push image-registry.openshift-image-registry.svc:5000/ocp-airgap-architect/oaa-backend:latest
podman push image-registry.openshift-image-registry.svc:5000/ocp-airgap-architect/oaa-frontend:latest
```

## Update Image References

Before applying, set the image names in the manifests to match your registry:

```bash
# If using internal registry (example)
 sed -i 's|openshift-airgap-architect-backend:latest|image-registry.openshift-image-registry.svc:5000/ocp-airgap-architect/oaa-backend:latest|g' k8s/backend-deployment.yaml
 sed -i 's|openshift-airgap-architect-frontend:latest|image-registry.openshift-image-registry.svc:5000/ocp-airgap-architect/oaa-frontend:latest|g' k8s/frontend-deployment.yaml
```

## Deploy

```bash
# Create namespace (or use existing)
oc create namespace ocp-airgap-architect
oc project ocp-airgap-architect

# Apply resources (order: services, deployments, ingress)
oc apply -f k8s/backend-service.yaml
oc apply -f k8s/backend-deployment.yaml
oc apply -f k8s/frontend-service.yaml
oc apply -f k8s/frontend-deployment.yaml
oc apply -f k8s/route.yaml
```

Or apply all at once:

```bash
oc apply -f k8s/
```

## Access

The Ingress exposes a single host with path-based routing:

- `/` → frontend (SPA)
- `/api` → backend API

Get the URL:

```bash
oc get ingress oaa -o jsonpath='{.status.loadBalancer.ingress[0].hostname}' 2>/dev/null || oc get route -l app=oaa -o jsonpath='{.items[0].spec.host}'
```

## MOCK_MODE

The backend deployment sets `MOCK_MODE=true` by default. This uses bundled mock data for Cincinnati (channels, patches) and operator catalogs, so the Blueprint and Operators steps work without external network access. For production with live Cincinnati, set `MOCK_MODE=false` and ensure the cluster has egress to `api.openshift.com` (or equivalent).

## Data Persistence (Optional)

By default, the backend stores state in `/tmp/airgap-architect-data` (ephemeral). For persistence across pod restarts:

1. Create a PVC
2. Mount it at `/data` in the backend deployment
3. Set `DATA_DIR=/data` in the deployment env

## Troubleshooting

- **Frontend 403/404 on refresh:** Ensure the Ingress routes `/` to the frontend with pathType Prefix.
- **API calls fail:** Check that `/api` is routed to the backend service.
- **Permission denied:** The manifests use non-root containers. If using custom SCC, ensure it allows `runAsNonRoot`.
