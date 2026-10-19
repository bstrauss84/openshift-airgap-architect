# Requirement ledger — final pre-push authentication corrections (2026-10-19)

Worktree `/home/bistraus/code/openshift-airgap-architect-v2.1-hardening`, branch
`work/v2.1-release-hardening`, HEAD `f9d59e39d53d0a08bdff034da6d832c8032f97bf`
(unchanged — no Git mutation performed by this wave).

Identifiers are the owner's: **AUTH-01 … AUTH-05, EVIDENCE-01**. They are not
renamed, renumbered or merged.

Each row records: current behaviour → authoritative evidence → planned change →
deterministic test → manual verification. Status is filled in as the work lands.

---

## AUTH-01 — the loopback check validated a bind address the server never used

| | |
|---|---|
| **Current behaviour** | `backend/src/accessControl.js:189-200` refuses `OAA_AUTH_MODE=disabled` with a non-loopback `BIND_ADDRESS`. `backend/src/index.js:4513` then calls `app.listen(port, …)` with **no host**, so Node binds the unspecified address (`::` with dual-stack, i.e. every interface). The validated value and the bound value are unrelated: the guard reads an environment variable nothing consumes. |
| **Authoritative evidence** | Node `net.Server.listen([port][, host])` — "If host is omitted, the server will accept connections on the unspecified IPv6 address (`::`) when IPv6 is available, or the unspecified IPv4 address (`0.0.0.0`) otherwise." Reproduced locally, see §Manual. |
| **Why Compose is not a counter-example** | `docker-compose.yml:27` publishes `127.0.0.1:4000:4000`. Port publishing forwards to the **container's** address, not to the container's loopback, so a container process that binds `127.0.0.1` is unreachable through a published port. The container therefore legitimately needs a wildcard bind *inside its own network namespace*; that is a different fact from "the API is exposed to the operator's network". |
| **Planned change** | Resolve the bind address in one place (`resolveBindAddress`), return it from `assertAccessControlConfig`, and have `index.js` bind exactly that. Default: `127.0.0.1` in `disabled` mode, `0.0.0.0` in `proxy` mode (authenticated, and the pod must be reachable from the frontend pod). A non-loopback bind in `disabled` mode requires BOTH an explicit `OAA_CONTAINER_NETWORK=isolated` declaration AND positive in-container evidence (`/run/.containerenv`, `/.dockerenv`, or a container cgroup); the declaration alone on a bare host is refused. Compose sets both, with the publish spec documented as the actual operator-facing boundary. |
| **Deterministic test** | `backend/test/listener-bind-boundary.test.js` — spawns the real server and makes real TCP connections to a real non-loopback interface address. Plus unit cases for `resolveBindAddress` in `backend/test/access-control-boundary.test.js`. |
| **Manual verification** | `ss -ltnp` against the spawned process; `podman run` of the shipped backend image confirming the published-port path still works. |

## AUTH-02 — the overlay could blank the operator's live Secret

| | |
|---|---|
| **Current behaviour** | `manifests/openshift/kustomization.yaml:34` lists `secret-proxy.yaml`, which declares `Secret/airgap-architect-proxy` with `stringData: {session_secret: "", proxy_shared_secret: ""}`. `manifests/README.md:275` tells the operator to `oc create secret generic airgap-architect-proxy …` **first**, and `:285`/`:288` then run `oc apply -k` **twice**. The second apply overwrites both keys with empty strings. |
| **Authoritative evidence** | `oc apply` performs a three-way merge against the last-applied configuration; a field present in the applied config replaces the live value. The empty strings are *present*, not absent, so they win. |
| **Planned change** | Stop the overlay managing the live Secret at all: delete `secret-proxy.yaml` and its `resources` entry. The Secret becomes operator-owned, documented in `manifests/README.md` with a non-clobbering create, a preflight existence check, and an explicit rotation procedure (patch + rollout restart of both Deployments). No secret value is committed. |
| **Deterministic test** | `scripts/validate-openshift-manifests.test.mjs` — the rendered overlay contains **no** `Secret/airgap-architect-proxy` and no `secretGenerator`; no file under `manifests/openshift/` declares `kind: Secret`; the `secretKeyRef` wiring in both Deployments still points at it. |
| **Manual verification** | `oc kustomize manifests/openshift` render inspected directly (no cluster apply). |

## AUTH-03 — nginx on 5173 is a direct authentication bypass if NetworkPolicy is absent

| | |
|---|---|
| **Current behaviour** | `frontend/container/nginx-oaa.conf.template:14-15` listens on `5173` and `[::]:5173` — every interface, i.e. the pod IP. The same server block forwards client-supplied `X-Forwarded-User/-Email/-Groups` (`:84-86`) and attaches the backend shared secret (`:91`). Any pod that can reach the frontend pod IP on 5173 therefore gets an authenticated-looking request minted for it, with no OAuth. The shared secret is not independent defence here: nginx adds it on the attacker's behalf. |
| **Authoritative evidence** | `openshift/oauth-proxy` is configured `--upstream=http://localhost:5173` (`patch-frontend-oauth.yaml:82`) — a same-pod loopback upstream, which is the only path that is supposed to exist. NetworkPolicy is the only thing currently refusing the pod-IP path, and `docs/releases/evidence/V2_1_EXHAUSTIVE_RELEASE_CLOSURE_REPORT_2026-10-16.md:346-351` already records that an unenforcing network plugin applies the objects silently. |
| **Planned change** | Make the loopback-only property intrinsic to the serving process: render the listen address at container start (`OAA_NGINX_LISTEN_ADDRESS`), default `0.0.0.0` for Compose, `127.0.0.1` + `[::1]` in the authenticated overlay, and **fail closed** when `OAA_REQUIRE_PROXY_SECRET` is set with a non-loopback listen address. Add a probe-only `/healthz` listener on 8081 that serves nothing else, so the kubelet can still probe a pod whose app port is loopback-bound; repoint the overlay probes at it and drop port 5173 from the overlay Service. |
| **Deterministic test** | `scripts/validate-nginx-runtime-config.test.mjs` — renders the real template through the real render script and then **binds real sockets to the rendered listen directives**, asserting a non-loopback interface address is refused in proxy mode and accepted in Compose mode; plus the fail-closed exit of the entrypoint. |
| **Manual verification** | Real `nginx` from `registry.access.redhat.com/ubi9/nginx-124` run under podman with the rendered config, probed from a non-loopback address. |

## AUTH-04 — `inject-cabundle` on a Route does nothing

| | |
|---|---|
| **Current behaviour** | `manifests/openshift/route-frontend.yaml:29` sets `service.beta.openshift.io/inject-cabundle: "true"` and the comment at `:16-17` claims "the service CA operator injects it via the annotation below". |
| **Authoritative evidence** | `openshift/service-ca-operator` README: the generic CA bundle injector covers **APIServices, MutatingWebhookConfigurations, ValidatingWebhookConfigurations and CRDs**; the ConfigMap injector covers **ConfigMaps**. Route is not an injection target. The correct mechanism is the router's own default: `openshift/api` `route/v1/types.go` — "If this field is not specified, the router may provide its own destination CA and perform hostname validation using the short service name (service.namespace.svc)"; `openshift/cluster-ingress-operator` `pkg/manifests/assets/router/deployment.yaml` sets `DEFAULT_DESTINATION_CA_PATH=/var/run/configmaps/service-ca/service-ca.crt` from the mounted `service-ca-bundle` ConfigMap; `openshift/router` `haproxy-config.template` emits `verify required ca-file {{ $defaultDestinationCA }}` for a reencrypt backend with no per-route CA. |
| **Planned change** | Remove the annotation and the incorrect claim. Keep `destinationCACertificate` absent — that is what selects the router's service-CA default — and state the real mechanism with its citations. No claim of live-cluster validation. |
| **Deterministic test** | `scripts/validate-openshift-manifests.test.mjs` — no Route carries `inject-cabundle`; a reencrypt Route carries no inline `destinationCACertificate`; the Service still requests a serving certificate. |
| **Manual verification** | Render inspection only. Live reencrypt handshake remains owner-deferred. |

## AUTH-05 — the nginx resolver names a service that does not exist on OpenShift

| | |
|---|---|
| **Current behaviour** | `frontend/container/nginx-oaa.conf.template:69` and `oaa-entrypoint.sh:75` default the resolver to `kube-dns.kube-system.svc.cluster.local`. |
| **Authoritative evidence** | OpenShift 4's cluster DNS is `dns-default` in namespace `openshift-dns` (cluster-dns-operator); there is no `kube-dns` Service in `kube-system`. nginx's `resolver` directive does accept a domain name, but nginx must resolve it through the **system** resolver when the configuration is loaded — so the one name supplied is the one name that cannot be looked up through the resolver being configured, and an unresolvable value is a config-load failure, i.e. CrashLoopBackOff rather than a degraded `/api`. |
| **Planned change** | Derive the resolver from the Pod's own `/etc/resolv.conf` `nameserver` lines at container start (correct on OpenShift, vanilla Kubernetes and Compose alike), bracketing IPv6 addresses as nginx requires. `OAA_NGINX_RESOLVER` remains an explicit override; no fictitious address is ever baked in. |
| **Deterministic test** | `scripts/validate-nginx-runtime-config.test.mjs` — fixture `resolv.conf` files (IPv4, IPv6, comments, `options`/`search` lines, multiple nameservers, empty) rendered through the real script, asserting the exact emitted directive. |
| **Manual verification** | Rendered config diffed against this host's `/etc/resolv.conf`; real nginx config load under podman. |

## EVIDENCE-01 — an acceptance that names no artifact was still accepted

| | |
|---|---|
| **Current behaviour** | `scripts/release/vex/vendorInheritedRisk.mjs:185-198` iterates `toolIdentity` and reports members with missing fields. An **empty** array iterates zero times, so `vendorRiskDisposition({toolIdentity: [], findings: vendorFindings})` returns a full "inherited-risk-accepted" record covering findings whose artifact is never identified — exactly the blanket tool exception the header says it refuses. Nothing requires the accepted findings' binaries to be *covered* by an identity. |
| **Authoritative evidence** | The module's own contract, `:173-184`, and `docs/security/SBOM_AND_PROVENANCE.md` / closure report §3.4, which state the acceptance is per-artifact. |
| **Planned change** | Require: at least one identity; every identity complete and well-formed (64-hex SHA-256, absolute `https://` source URL, no unresolved `<placeholder>` template markers); no duplicate tool entries; no two entries conflicting on the same tool; every identity naming a declared vendored binary; and **every accepted vendor finding's binary covered by an identity**. Raw counts, scanner results and the non-waivable verdict are untouched. |
| **Deterministic test** | `scripts/release/vex/vendorInheritedRisk.test.mjs` — adversarial cases for each rejection, plus a regression test that UBI/npm findings still never enter the vendor bucket. |
| **Manual verification** | `npm run test:tooling`; the axis (`image-vulnerabilities`) still reports every finding and still FAILs. |

---

## Outcome — all six closed, with red→green evidence

| ID | Status | Red proof | Green proof |
|---|---|---|---|
| AUTH-01 | done_pending_verification | `listener-bind-boundary.test.js` 3/5 fail with the host argument removed (`boundAddress: '::'`) | 5/5; live spawn binds `127.0.0.1`, LAN connect `ECONNREFUSED` |
| AUTH-02 | done_pending_verification | restoring `secret-proxy.yaml` + the strategic-merge Service patch fails 5 overlay tests | 26/26 manifest guards; `oc kustomize` renders zero Secrets |
| AUTH-03 | done_pending_verification | inline test binds the old `listen 5173` and connects from a non-loopback address | 21/21; real nginx under podman refuses the published port, probe port serves `/healthz` only |
| AUTH-04 | done_pending_verification | re-adding the annotation fails the Route guard | annotation gone; reencrypt Route has no inline CA |
| AUTH-05 | done_pending_verification | the old default would fail `NEVER emits the kube-dns name…` on directive lines | resolver derived from `resolv.conf`; 8 fixture cases |
| EVIDENCE-01 | done_pending_verification | the previous validation logic, replayed, returns `ACCEPTED` for `toolIdentity: []` | 32/32; empty, uncovered, malformed, duplicate, undeclared and tampered inputs all throw |

Suites after the change: backend **3166 pass / 0 fail**, frontend **4435 pass / 0
fail**, tooling + release harness **1248 pass / 0 fail**, frontend build exit 0,
`git diff --check` exit 0, live mirror artifact contract 12/12, security gate
**RED/INCOMPLETE** (expected: the container-scan axis is bound to the previous
candidate because this wave changed the tree).

**Still not verified:** anything requiring a live OpenShift cluster. Owner-deferred,
unchanged by this wave.

## Findings queue (recorded, not silently actioned)

1. **`vendorRiskDisposition` has no production caller.** Only tests import it;
   `scripts/release/axes/image-vulnerabilities.mjs` imports `attributeFindings` and
   `assertNoProjectFindingAccepted` but never the disposition, so the owner's
   acceptance record is never emitted into release evidence. EVIDENCE-01 makes the
   function correct; wiring it into the evidence bundle is a separate decision
   (compare the previously-fixed "orphaned release gate").
2. **The backend NetworkPolicy's second rule was commented as kubelet-probe
   access but selects Prometheus pods.** A `podSelector` cannot match the kubelet.
   The comment is corrected in place; whether Prometheus scraping is wanted at all
   is an owner decision.
3. **`manifests/base/configmap.yaml` still sets `VITE_API_BASE` to the in-cluster
   Service DNS name**, which a browser cannot resolve — the steer toward a public
   backend Route that the decision record flagged (§A.4). The OpenShift overlay
   overrides it with `/api`; the base does not.
4. **`containerPort: 5173` remains in the frontend pod spec** in the authenticated
   overlay although nginx binds loopback there. containerPort is informational in
   Kubernetes, so this is cosmetic, but it reads as though the port is reachable.
5. **`frontend/container/nginx-oaa.conf` (the pre-template file) is still staged as
   a deletion** alongside the new `.template`; that is from the earlier wave and is
   left exactly as found.
