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
  -f frontend/Containerfile .

# 2. Create the Secret with your pull secret, OUT OF TREE.
#    `manifests/base/secret.yaml` is a template and is NOT applied by the
#    kustomization — its empty values would otherwise overwrite your real
#    credential on the next `apply -k`, because an empty string is a value.
kubectl create secret generic airgap-architect-secrets \
  --from-file=pull-secret.json=/path/to/pull-secret.json
#    Re-running this fails with AlreadyExists, which is the safe outcome: it
#    will not silently replace a working credential. To change it deliberately:
#      kubectl create secret generic airgap-architect-secrets \
#        --from-file=pull-secret.json=/path/to/pull-secret.json \
#        --dry-run=client -o yaml | kubectl replace -f -
#    NOTE (PROD-035): the backend Deployment does not yet reference this Secret,
#    so this step has no effect on the running backend today.
#    A mounted pull secret is read server-side only; its contents are never sent
#    to the browser.

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

The manifests were **written with** the **restricted-v2** SCC (OpenShift 4.12+
default) in mind, and set:

- `runAsNonRoot: true`, `runAsUser: 1001`
- `allowPrivilegeEscalation: false`
- `capabilities.drop: [ALL]`
- `seccompProfile.type: RuntimeDefault`

> **CORRECTED 2026-10-16, AND STILL UNVERIFIED ON A CLUSTER.**
>
> The `manifests/openshift/` overlay now **removes** the hardcoded
> `runAsUser: 1001` and `fsGroup: 1001`
> (`patch-restricted-v2.yaml`, `patch-restricted-v2-frontend.yaml`), letting
> `restricted-v2` assign both from the namespace's own
> `openshift.io/sa.scc.uid-range`. That was the specific reason the previous
> manifests would have been rejected at admission. The controls the SCC
> actually wants asserted — `runAsNonRoot`, `allowPrivilegeEscalation: false`,
> `capabilities.drop: [ALL]`, `seccompProfile: RuntimeDefault` — all remain,
> and a rendering test pins that
> (`scripts/validate-openshift-manifests.test.mjs`).
>
> `manifests/base/` **deliberately keeps the pins**, and that asymmetry is not
> an oversight. Plain Kubernetes has no SCC to assign a UID, and the backend
> image's final stage is `USER root` (it drops privileges itself in
> `entrypoint.sh` via `runuser`). Removing `runAsUser` from the base while
> `runAsNonRoot: true` stays would make the kubelet refuse the pod with
> "container has runAsNonRoot and image will run as root". The base targets
> vanilla Kubernetes; the overlay adapts it to OpenShift.
>
> **Rendering is not admission.** No OpenShift cluster was reachable when this
> was written, so nothing below has been observed:
> admission accepting the pod, the PVC being writable under an assigned
> fsGroup, OAuth login completing, or the NetworkPolicy actually being
> enforced by the installed network plugin. Run the smoke checks in
> [Verifying the authenticated deployment](#verifying-the-authenticated-deployment)
> before describing this as `restricted-v2` compatible.
>
> Tracked as **PROD-039** (SCC admission and arbitrary-UID validation) and
> **PROD-003**.

An earlier revision of this page said "No custom SCC should be required" and
that `fsGroup: 1001` would keep the PVC writable if the entrypoint's `chown`
failed. Both were unverified inferences from the YAML rather than observed
behaviour, and the second does not follow: an fsGroup outside the namespace
range is itself a reason for admission to reject the pod.

## Deploying the authenticated OpenShift overlay

`manifests/openshift/` deploys an **authenticated** topology. `manifests/base/`
on its own is unauthenticated and is intended for plain Kubernetes behind your
own boundary.

```
Route (reencrypt TLS, :8443)
  └─ oauth-proxy                  built-in OpenShift OAuth + SubjectAccessReview
       └─ nginx 127.0.0.1:5173    serves the UI, proxies /api SAME-ORIGIN
            └─ backend Service :4000   requires the proxy shared secret
                                        NetworkPolicy: frontend pod only
       nginx 0.0.0.0:8081/healthz  probe-only; serves nothing else
```

There is **no backend Route**. The file that used to create one was deleted,
not commented out.

**nginx listens on the pod's loopback, not the pod IP**, and that is load
bearing rather than tidy. That server block forwards the caller's identity
headers and attaches the backend's shared secret, so when it answered on the
pod IP any pod in the namespace could send `X-Forwarded-User: admin` straight
to it and be proxied to the backend as an authenticated user — with the
shared secret added on its behalf, and NetworkPolicy the only thing in the
way. oauth-proxy's upstream was already `http://localhost:5173`; the bind now
matches. Because the kubelet connects to the pod IP and cannot reach
loopback, probes use the separate `/healthz` listener on 8081, which has no
root, no SPA fallback, no `/api` proxy and no secret.

The reencrypt Route carries **no `destinationCACertificate` and no
`inject-cabundle` annotation**. The annotation would do nothing — service-ca
injects into ConfigMaps, APIServices, CRDs and webhook configurations, not
Routes — and omitting the certificate is what makes the router fall back to
its own mounted service-CA bundle
(`DEFAULT_DESTINATION_CA_PATH=/var/run/configmaps/service-ca/service-ca.crt`
in the ingress operator's router Deployment), which is exactly the CA that
signed the Service's serving certificate.

### Before you apply

Two secrets must be generated, and **they are yours, not the overlay's**.

`airgap-architect-proxy` is created by you and never appears in
`manifests/openshift/`. An earlier revision shipped a `secret-proxy.yaml` with
empty `stringData` for this exact Secret while this page told you to create it
first — and because `oc apply` three-way merges, an empty string is a *present*
value that wins. The documented two-apply sequence below therefore used to
blank both keys on the second apply, taking down an authenticated deployment
with a `fails closed` message and no obvious cause. Nothing in the overlay now
creates, patches or generates it; the Deployments only read it through
`secretKeyRef`, and a test fails the build if a Secret reappears in that
directory.

```bash
NS=airgap-architect            # your namespace

# Create once. Re-running fails with AlreadyExists — deliberately, so a repeated
# setup run cannot replace a live secret with fresh random values and log every
# user out.
oc -n "$NS" create secret generic airgap-architect-proxy \
  --from-literal=session_secret="$(head -c 32 /dev/urandom | base64)" \
  --from-literal=proxy_shared_secret="$(head -c 32 /dev/urandom | base64)"

# Preflight: the overlay no longer carries a placeholder, so applying without
# this Secret leaves both Deployments unable to start. Check before you apply.
oc -n "$NS" get secret airgap-architect-proxy \
  -o jsonpath='{range .data}{""}{end}{.metadata.name} exists{"\n"}' \
  || echo "CREATE IT FIRST — see above"
```

Neither value is printed by these commands and neither is ever committed.
`session_secret` is oauth-proxy's cookie encryption key; rotating it logs
everyone out and authenticates nothing by itself. `proxy_shared_secret` is the
trust anchor for the identity headers: anything holding it can assert any
identity, so treat it as an admin credential — that is why NetworkPolicy backs
it rather than replacing it.

Then set the origin allowlist to your Route's real external URL in
`manifests/openshift/patch-backend-auth.yaml` (it ships with an
`apps.example.com` placeholder):

```bash
oc apply -k manifests/openshift/            # creates the Route first
oc get route airgap-architect -o jsonpath='https://{.spec.host}{"\n"}'
# put that value in OAA_ALLOWED_ORIGINS, then re-apply
oc apply -k manifests/openshift/
```

Applying twice is now safe: the overlay has no opinion about the contents of
`airgap-architect-proxy`.

### Rotating the proxy secrets

Rotation is an explicit act, never a side effect of re-applying. Patch the one
key you mean to change, then restart what reads it — both Deployments mount
`proxy_shared_secret`, and a pod keeps the value it started with.

```bash
# proxy_shared_secret — the backend/proxy trust anchor.
oc -n "$NS" patch secret airgap-architect-proxy --type=merge \
  -p "{\"stringData\":{\"proxy_shared_secret\":\"$(head -c 32 /dev/urandom | base64)\"}}"
oc -n "$NS" rollout restart deploy/airgap-architect-frontend deploy/airgap-architect-backend
oc -n "$NS" rollout status  deploy/airgap-architect-backend

# session_secret — oauth-proxy's cookie key. Rotating it invalidates every
# session, so every signed-in user is sent back through login.
oc -n "$NS" patch secret airgap-architect-proxy --type=merge \
  -p "{\"stringData\":{\"session_secret\":\"$(head -c 32 /dev/urandom | base64)\"}}"
oc -n "$NS" rollout restart deploy/airgap-architect-frontend
```

**Expect a short window of 401s** while the two Deployments restart out of
step: the frontend sends the new secret before the backend expects it, or the
reverse. The restarts above are ordered to keep it to the rollout, and the
window is why rotation is a maintenance action rather than something a
deployment script should do on every run. Nothing degrades to unauthenticated
during it — a mismatched secret is rejected, not ignored.

**Disconnected clusters** must also mirror the proxy image:
`registry.redhat.io/openshift4/ose-oauth-proxy:v4.22`.

### Not supported: clusters using direct external OIDC

OpenShift 4.22 can be configured with external OIDC, which **removes the
built-in OAuth server** and the `oauth.openshift.io` APIs. `oauth-proxy` then
has nothing to authenticate against. This overlay integrates with the built-in
server, so it does not work there — and says so instead of failing at login:
setting `OAA_OIDC_ISSUER` makes the backend exit at startup with an
explanation. Deploy behind your own authenticating proxy instead, setting
`OAA_AUTH_MODE=proxy` and `OAA_PROXY_SHARED_SECRET` to a value only that proxy
knows.

## Verifying the authenticated deployment

> **These have NOT been run.** No OpenShift cluster was reachable when this
> overlay was written, so OAuth login, `restricted-v2` admission and
> NetworkPolicy enforcement are **unverified**. What *is* verified is that the
> overlay renders correctly, that the backend rejects forged identity, direct
> access, cross-site POSTs, cross-origin reads and forged group claims, that
> the backend binds the address it was configured with (tested by connecting
> over a real interface, not by reading the configuration), and that the
> rendered nginx configuration binds loopback only — tested by binding the
> directives it produced and failing to connect from a non-loopback address
> (`backend/test/access-control-boundary.test.js`,
> `backend/test/listener-bind-boundary.test.js`,
> `scripts/validate-nginx-runtime-config.test.mjs`,
> `scripts/validate-openshift-manifests.test.mjs`). The rendered config was
> also loaded by a real `nginx` from `registry.access.redhat.com/ubi9/nginx-124`
> under podman, which is syntax validation and a local bind check — not a
> cluster.
>
> **Operational risk of deferring these:** if admission rejects the pods the
> application simply does not start, which is loud and safe. The quieter risk
> is the NetworkPolicy: if the cluster's network plugin does not enforce
> NetworkPolicy, the objects apply without error and restrict nothing, leaving
> the backend Service reachable from any pod in the namespace. The shared
> secret still stands in the way, but one of the two layers would be silently
> absent. **Check 4 below is the one not to skip.**

Required access: a user who can create these objects in the target namespace
(`oc auth can-i create deployment,route,networkpolicy,secret,serviceaccount`),
and for check 4 the ability to run a throwaway pod. No cluster-admin is needed
unless your namespace lacks a `uid-range` annotation.

```bash
NS=airgap-architect            # your namespace
ROUTE=$(oc -n "$NS" get route airgap-architect -o jsonpath='https://{.spec.host}')

# 1. ADMISSION — did restricted-v2 accept the pods, and what UID was assigned?
oc -n "$NS" get pods -l app=airgap-architect
oc -n "$NS" get pod -l component=backend \
  -o jsonpath='{.items[0].spec.securityContext}{"\n"}{.items[0].spec.containers[0].securityContext}{"\n"}'
oc -n "$NS" get namespace "$NS" -o jsonpath='{.metadata.annotations.openshift\.io/sa\.scc\.uid-range}{"\n"}'
# EXPECT: pods Running; no runAsUser in the pod spec; an assigned UID inside the range.
# A pod stuck in CreateContainerConfigError with "unable to validate against any
# security context constraint" means admission refused it.

# 2. PVC WRITABILITY under the assigned fsGroup (the backend exits with a clear
#    message if this fails, so check the log rather than guessing).
oc -n "$NS" logs deploy/airgap-architect-backend | head -20
# EXPECT: no "DATA_DIR is not writable" message.

# 3. OAUTH — an unauthenticated request must be redirected to login, not served.
curl -sS -o /dev/null -w '%{http_code} %{redirect_url}\n' "$ROUTE/"
# EXPECT: 302/303 to the cluster OAuth server. 200 with the UI means the Route
# is terminating at nginx (5173) instead of oauth-proxy (8443).

# 4. THE BYPASS CHECK — the most important one. From an UNRELATED pod, try to
#    reach the backend Service directly, skipping the proxy entirely.
oc -n "$NS" run bypass-probe --rm -it --restart=Never --image=registry.access.redhat.com/ubi9/ubi-minimal \
  -- curl -sS -o /dev/null -w 'direct=%{http_code}\n' --max-time 10 \
     http://airgap-architect-backend:4000/api/state
# EXPECT: a connection timeout/failure (NetworkPolicy enforced).
# A 401 means NetworkPolicy is NOT enforced but the shared secret held — one
# layer is missing; investigate the network plugin.
# A 200 means BOTH layers failed. Stop and do not use this deployment.

# 5. FORGED IDENTITY — the shared-secret check, from the same unrelated pod.
oc -n "$NS" run forge-probe --rm -it --restart=Never --image=registry.access.redhat.com/ubi9/ubi-minimal \
  -- curl -sS -o /dev/null -w 'forged=%{http_code}\n' --max-time 10 \
     -H 'X-Forwarded-User: admin' http://airgap-architect-backend:4000/api/state
# EXPECT: timeout (policy) or 401 (secret). NEVER 200.

# 5b. THE PRE-AUTHENTICATION nginx PORT — the AUTH-03 check, and the one that
#     does not depend on NetworkPolicy being enforced. Send a forged identity
#     DIRECTLY to the frontend pod's IP on 5173, which is what nginx used to
#     answer on. nginx would have attached the backend's shared secret to it.
FE_IP=$(oc -n "$NS" get pod -l component=frontend -o jsonpath='{.items[0].status.podIP}')
oc -n "$NS" run nginx-bypass-probe --rm -it --restart=Never --image=registry.access.redhat.com/ubi9/ubi-minimal \
  -- curl -sS -o /dev/null -w 'nginx_direct=%{http_code}\n' --max-time 10 \
     -H 'X-Forwarded-User: admin' "http://${FE_IP}:5173/api/state"
# EXPECT: connection refused. nginx binds 127.0.0.1 in this overlay, so the
# pod's own kernel refuses it whether or not the network plugin enforces
# NetworkPolicy. A 200 or a 401 both mean something is listening there that
# should not be — check OAA_NGINX_LISTEN_ADDRESS on the frontend container.

# 5c. The probe listener is reachable and discloses nothing.
oc -n "$NS" run probe-probe --rm -it --restart=Never --image=registry.access.redhat.com/ubi9/ubi-minimal \
  -- sh -c "curl -sS -w ' healthz=%{http_code}\n' --max-time 10 http://${FE_IP}:8081/healthz;
            curl -sS -o /dev/null -w 'root=%{http_code}\n' --max-time 10 http://${FE_IP}:8081/"
# EXPECT: `ok healthz=200` and `root=404`. Anything else served on 8081 is a
# second way in and must not be there.

# 6. AUTHENTICATED USE — log in through the browser at $ROUTE and confirm the
#    wizard loads, an Operator scan runs, and a bundle downloads. The bundle
#    download and the job log stream are the two paths that do not go through
#    the JSON fetch wrapper, so they exercise cookie auth separately.
```

Record the results against **PROD-039** before describing the deployment as
`restricted-v2` verified.

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
