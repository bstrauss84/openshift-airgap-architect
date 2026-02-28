# OpenShift Airgap Architect – OpenShift 4.18 Deployment

This document describes the **working OpenShift deployment model** for OpenShift Airgap Architect. The app runs as two deployments (backend, frontend), built in-cluster from Git, exposed through a **single host** with path-based routing.

## Deployment architecture

- **Backend:** Node.js API on port `4000`, state in PVC at `/data`
- **Frontend:** Static SPA on port `8080` (not 5173 — that is local dev only)
- **Exposure:** One Ingress host; `/api` → backend, `/` → frontend
- **Namespace (example):** `ocp-airgap-architect`

The frontend uses same-origin API routing: it is built with `VITE_API_BASE=""` so fetch calls go to `/api` on the same host. The Ingress routes `/api` to the backend. **Do not use a separate frontend route** or set `VITE_API_BASE` to a standalone backend URL for this deployment path.

---

## Prerequisites

- OpenShift 4.18+ cluster
- `oc` CLI
- Access to the Git repo (public or configured in-cluster)

---

## 1. Create project and apply base resources

```bash
oc create namespace ocp-airgap-architect
oc project ocp-airgap-architect
```

```bash
oc apply -f k8s/pvc.yaml
oc apply -f k8s/backend-service.yaml
oc apply -f k8s/frontend-service.yaml
```

---

## 2. Build from Git (BuildConfigs)

The app is built in-cluster from Git. Each BuildConfig uses a Dockerfile (Containerfile) in a context directory.

**Backend build:**

- ImageStream: `oaa-backend`
- BuildConfig: `oaa-backend`
- Source: Git, `contextDir: backend`, `dockerfilePath: Containerfile`

**Frontend build:**

- ImageStream: `oaa-frontend`
- BuildConfig: `oaa-frontend`
- Source: Git, `contextDir: frontend`, `dockerfilePath: Containerfile`

Apply the BuildConfigs (replace the Git URI/ref if using a fork or different branch):

```bash
oc apply -f k8s/buildconfig-backend.yaml
oc apply -f k8s/buildconfig-frontend.yaml
```

**Point BuildConfigs at another branch (e.g. `fix/openshift-deployment`):**

```bash
oc patch bc oaa-backend --type=merge -p '{"spec":{"source":{"git":{"ref":"fix/openshift-deployment"}}}}'
oc patch bc oaa-frontend --type=merge -p '{"spec":{"source":{"git":{"ref":"fix/openshift-deployment"}}}}'
```

Start builds:

```bash
oc start-build oaa-backend
oc start-build oaa-frontend
```

Wait for builds to complete:

```bash
oc get builds -w
```

---

## 3. Deployments and image triggers

Deployments must use the ImageStreamTag-backed images so new builds roll forward automatically. A plain `rollout restart` does **not** help if the Deployment is still pinned to an old image digest.

**Apply deployments:**

```bash
oc apply -f k8s/backend-deployment.yaml
oc apply -f k8s/frontend-deployment.yaml
```

**Add image change triggers** so successful builds update the deployments:

```bash
oc set triggers deployment/oaa-backend --from-image=oaa-backend:latest -c backend
oc set triggers deployment/oaa-frontend --from-image=oaa-frontend:latest -c frontend
```

This ensures:

- The deployment image follows the ImageStreamTag
- New builds automatically trigger a new rollout
- You do not stay pinned to an old digest

---

## 4. Single-host Ingress with path-based routing

Use **one Ingress host**; do not use separate frontend and backend routes as the primary setup.

- `/api` → backend service on port 4000
- `/` → frontend service on port 8080

```bash
oc apply -f k8s/route.yaml
```

OpenShift creates Route(s) from this Ingress. The Ingress manifest includes `spec.tls: [ {} ]`, which enables HTTPS through the OpenShift router’s default certificate. **HTTPS is enabled by the Ingress TLS config, not by app code.**

---

## 5. Backend configuration

| Env var | Value | Purpose |
|--------|-------|---------|
| `PORT` | `4000` | Service/deployment port |
| `DATA_DIR` | `/data` | State directory (must match PVC mount) |
| `REGISTRY_AUTH_FILE` | `/data/registry-auth.json` | Optional; for operator scan |
| `MOCK_MODE` | `false` | Use live Cincinnati; set `true` for offline mock data |

A PVC `oaa-backend-data` is mounted at `/data` for persistent state.

---

## 6. Frontend configuration

- **Port:** `8080` (OpenShift deployment path)
- **API:** Same-origin; built with empty `VITE_API_BASE` so `/api` is used on the current host
- **No `VITE_API_BASE`** should point to a separate backend route for this path

---

## 7. Verification

```bash
# BuildConfigs and builds
oc get bc
oc get builds

# ImageStreams / tags
oc get is
oc describe is oaa-backend
oc describe is oaa-frontend

# Deployment images
oc get deployment oaa-backend -o jsonpath='{.spec.template.spec.containers[0].image}'
oc get deployment oaa-frontend -o jsonpath='{.spec.template.spec.containers[0].image}'

# Rollout status
oc rollout status deployment/oaa-backend
oc rollout status deployment/oaa-frontend

# Pods
oc get pods

# Services
oc get svc

# Ingress and routes
oc get ingress
oc get routes

# Backend health
oc run curl --rm -i --restart=Never --image=curlimages/curl -- curl -s http://oaa-backend:4000/api/health

# Frontend (from outside cluster; replace host with your Ingress host)
# Example: openshift-airgap-architect.apps.tacos.dota-lab.iad.redhat.com
INGRESS_HOST=$(oc get ingress oaa -o jsonpath='{.status.loadBalancer.ingress[0].hostname}' 2>/dev/null || oc get route -l app=oaa -o jsonpath='{.items[0].spec.host}' 2>/dev/null)
curl -sk "https://${INGRESS_HOST}/"
curl -sk "https://${INGRESS_HOST}/api/health"
```

**Logs:**

```bash
oc logs -f deployment/oaa-backend    # Expect: listening on 4000
oc logs -f deployment/oaa-frontend   # Expect: listening on 8080
```

---

## 8. Troubleshooting

### A) Namespace mismatch

Commands must use the same project as the deployment. If you use `airgap-architect` in some places and `ocp-airgap-architect` in others, you will see "not found" or wrong-image errors. Use:

```bash
oc project ocp-airgap-architect
```

consistently.

### B) Builds succeed but pods run old code

The Deployment may still reference an old image digest. Fix by:

1. Ensuring the Deployment uses the ImageStreamTag:

   ```bash
   oc set deployment oaa-backend --image=oaa-backend:latest
   oc set deployment oaa-frontend --image=oaa-frontend:latest
   ```

2. Adding image change triggers:

   ```bash
   oc set triggers deployment/oaa-backend --from-image=oaa-backend:latest -c backend
   oc set triggers deployment/oaa-frontend --from-image=oaa-frontend:latest -c frontend
   ```

3. Restarting the rollout after the triggers are in place.

### C) App stuck on “Loading Airgap Architect...”

The frontend loads, but `/api` is not routed on the same host. For this deployment path:

- Use a single Ingress host
- Route `/api` → backend
- Route `/` → frontend

Do not rely on separate frontend and backend routes.

### D) Frontend service/route port mismatch

The OpenShift frontend deployment listens on **8080**, not 5173. Ensure:

- Service targets port 8080
- Ingress backend for `/` points to port 8080

### E) HTTPS not working

Enable TLS on the Ingress:

```bash
oc patch ingress oaa --type=merge -p '{"spec":{"tls":[{}]}}'
```

This enables HTTPS via the OpenShift router’s default certificate path.

### F) DiskPressure during build

If builds fail with node pressure, this is cluster/node capacity, not app logic. Resolve by freeing disk on nodes or scaling the cluster.

---

## 9. Resource summary

| Resource | Name | Purpose |
|----------|------|---------|
| PVC | `oaa-backend-data` | Backend state at `/data` |
| BuildConfig | `oaa-backend` | Build from Git `backend/` |
| BuildConfig | `oaa-frontend` | Build from Git `frontend/` |
| ImageStream | `oaa-backend` | Output of backend build |
| ImageStream | `oaa-frontend` | Output of frontend build |
| Deployment | `oaa-backend` | Backend app, port 4000 |
| Deployment | `oaa-frontend` | Frontend app, port 8080 |
| Service | `oaa-backend` | Backend service |
| Service | `oaa-frontend` | Frontend service |
| Ingress | `oaa` | Path routing + TLS |

---

## 10. Example hostname

The Ingress host is assigned by OpenShift. Example (for documentation only):

```
openshift-airgap-architect.apps.tacos.dota-lab.iad.redhat.com
```

Use `oc get ingress` or `oc get routes` to see the actual hostname in your cluster.
