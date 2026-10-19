# Decision record: API exposure, authentication, and trust anchors

**Status: awaiting human decision. Nothing in this document has been implemented.**

Three decisions are blocked on a human. They are recorded together because they
share one property: each one changes a *trust boundary*, and the v2.1 execution
charter reserves those for explicit ratification rather than agent judgement.

No code in this repository was changed on the strength of anything below. The
only related changes made in this wave were checksum verification for external
artifact downloads (decision **C** explains why that is *not* signature
verification) and documentation corrections.

Evidence here was gathered read-only at `f9d59e3` on 2026-10-16 and verified
against source and installed dependency source. Where a prior claim could not be
reproduced, it is marked as such rather than repeated.

---

## Decision A — production API exposure and authentication

### A.1 What is true today

The backend has **no authentication on any route**. This is not a gap in
coverage; there is no mechanism at all. The entire middleware stack is four
registrations:

| `backend/src/index.js` | Middleware |
|---|---|
| `:116` | `app.use(cors());` |
| `:154` | `app.use(express.json({ limit: "10mb" }));` |
| `:158` | `loggingMiddleware` (assigns `X-Request-ID`, logs; rejects nothing) |
| `:163` | `metricsMiddleware` (Prometheus histograms; rejects nothing) |

There are **51 route registrations**, all in `index.js`, all anonymous: 26 GET,
22 POST, 1 DELETE, 2 `app.all`. There are no `express.Router()` modules. No
`helmet`, `csurf`, `express-session`, `passport` or rate-limit package is a
dependency; the only per-route middleware is Zod body validation plus two
in-memory rate limiters on the feedback routes.

The project's own documentation already says so — `docs/API.md:7`
("**Authentication:** None") and `docs/API.md:1372` — and
`docs/BACKLOG_STATUS.md` carries it as unnumbered blocker 1. **This decision
record does not report a new gap. It reports that the gap is worse than the
framing it has been carried under.**

### A.2 The part that was understated

The exposure has been discussed as a CSRF problem — an attacker can *trigger*
privileged operations. That is true, and it is the lesser half.

`app.use(cors())` takes the `cors@2.8.5` defaults
(`backend/node_modules/cors/lib/index.js:8-13`): `origin: '*'`, no
`credentials`. So every response carries `Access-Control-Allow-Origin: *`, and
a cross-origin `Content-Type: application/json` preflight is auto-approved
because `allowedHeaders` is unset and the middleware reflects the request
headers.

With no cookies and no auth, `ACAO: *` means arbitrary cross-origin JavaScript
can not only **invoke** these routes but **read their responses**. An attacker
does not need a form. Any page the operator visits while the backend is
reachable can run `fetch()` against it and read what comes back.

Three responses make that materially worse than "a CSRF issue":

- **`GET /api/generate`** (`index.js:3576`) renders install-config, agent-config
  and imageset-config from server state with credentials **forced on**:
  `index.js:3508-3516` sets `includeCredentials: true` with the comment
  `// CRITICAL: Force includeCredentials=true for preview`. The response body
  therefore contains the pull secret and any other configured credential.
- **`POST /api/ssh/keypair`** (`index.js:2040`) spawns `ssh-keygen` and
  **returns the generated private key in the response**
  (`index.js:916`: `resolve({ publicKey, privateKey })`).
- **`GET /api/jobs`** and `GET /api/jobs/:id` return whole job rows, including
  accumulated tool output and `metadata.fullCommand`.

So the realistic worst case is not "an attacker restarts a mirror job". It is
**silent exfiltration of the operator's Red Hat pull secret, generated SSH
private key, BMC and platform passwords, and full cluster design**, from a
drive-by page, leaving no trace in the OAA UI.

Of the 22 POST routes, 19 accept an empty JSON body (`req.body` is set to `{}`
by `body-parser` before the content-type test, so a cross-site form reaches the
handler). 18 reach meaningful handler logic that way, of which 8 are privileged.

> **One prior claim could not be reproduced and should not be repeated.** The
> figure "14 form-triggerable Tier-1 operations" does not correspond to anything
> measurable here: "Tier-1" is not defined anywhere in the tree. The measured
> numbers are 51 anonymous routes, 19/22 POST schemas accepting `{}`, 18
> form-reachable, 8 of those privileged. Treat 14 as unverified.

### A.3 Why this was not fixed in this wave

Tightening CORS looks like a small, obviously-correct change. It is not
independent of the topology decision, and shipping it alone would break the
product as documented:

- `docker-compose.yml:37` sets `VITE_API_BASE=http://localhost:4000` while the
  frontend serves from `:5173`. The frontend's own traffic is **cross-origin by
  construction** and always sends `Content-Type: application/json`
  (`frontend/src/api.js:41-43`), so it depends on the permissive CORS policy.
- `frontend/container/oaa-entrypoint.sh:24-30` **hard-fails** unless
  `VITE_API_BASE` is empty or an absolute `http(s)://` URL. A same-origin
  relative base such as `/api` is rejected *by design*, which is exactly what
  forces the browser→backend hop to be cross-origin.
- `frontend/container/nginx-oaa.conf` has four `location` blocks and **no
  `proxy_pass`**. `frontend/Containerfile:33-35` states it outright: "There is
  no /api proxy here and there never was."
- `frontend/src/api.js:30` falls back to the absolute `http://localhost:4000`.

An allowlist CORS policy therefore cannot be chosen without first choosing the
topology. That is the decision being asked for.

### A.4 Current deployment exposure

`manifests/openshift/route-backend.yaml` publishes the backend on an edge-TLS
Route with no authentication, and it **is active** in the OpenShift overlay
(`manifests/openshift/kustomization.yaml:7-10`). `oc apply -k manifests/openshift/`
publishes all 51 anonymous routes on the public cluster router.

The root overlay is safer — `manifests/kustomization.yaml:7-12` has both Routes
commented out — and Compose binds to loopback (`127.0.0.1:4000:4000`), though
the process itself still listens on `0.0.0.0` (`index.js:4384`, no host
argument).

`manifests/base/configmap.yaml:37` sets `VITE_API_BASE` to the in-cluster
Service DNS name, which a browser cannot resolve — so an operator following the
manifests is actively steered toward setting it to the public backend Route,
i.e. toward the fully-exposed topology.

### A.5 Recommendation

**Same-origin, with the backend not routable.** This is the direction already
approved; what follows is the concrete shape, which is what needs ratifying.

1. Add an nginx `location /api { proxy_pass http://airgap-architect-backend:4000; }`
   to the frontend image, and allow `VITE_API_BASE` to be a *relative* base so
   the browser calls the serving origin. This is the change
   `oaa-entrypoint.sh:24-30` currently forbids, so that validation must be
   relaxed deliberately, not by accident.
2. Delete `manifests/openshift/route-backend.yaml` from the overlay. Keep the
   frontend Route.
3. Replace `cors()` with an explicit allowlist. Once (1) lands, the browser is
   same-origin and CORS can default to *deny*, with Compose-only origins added
   from configuration.
4. Add CSRF defence that survives the empty-body form case — require a custom
   header (which forces a preflight) on all mutating and privileged routes, or
   a token. Note a header requirement is only meaningful *after* CORS stops
   being `*`.
5. Enforce identity at the backend or at a non-bypassable boundary. A sidecar
   that can be skipped by reaching the Service directly is not a boundary;
   NetworkPolicy has to back it.

**The OAuth question must not be collapsed into one answer.** `openshift/oauth-proxy`
fits clusters using the built-in OAuth server. OpenShift 4.22 also supports
**direct external OIDC**, which *removes* the built-in OAuth server and its
APIs — a cluster in that mode has no OAuth endpoints for the proxy to use. These
are different deployment modes and need separate, tested answers. Red Hat's
documentation for the 4.22 behaviour is at
`https://docs.redhat.com/en/documentation/openshift_container_platform/4.22/html/authentication_and_authorization/external-auth`.
For a fully disconnected install, an in-cluster IdP must be reachable inside the
air gap, or the mode must be documented as unsupported.

**`restricted-v2` is a separate, unresolved question that blocks the same work.**
`manifests/base/backend-deployment.yaml:29-31,111-119` hardcodes `runAsUser: 1001`
and `fsGroup: 1001`. Under `restricted-v2`, OpenShift assigns a UID from the
namespace's `openshift.io/sa.scc.uid-range`, and 1001 is not in a default range.
The backend entrypoint also expects to start as root to chown `DATA_DIR`
(`backend/scripts/entrypoint.sh:33-45`). **No admission test has ever been run.**
This wave corrected `manifests/README.md`, which until now claimed "No custom SCC
should be required".

### A.6 Interim mitigation, if the decision slips past the release

This is **not** a fix and must not be recorded as one:

- Ship the OpenShift overlay with `route-backend.yaml` removed, so the default
  `oc apply -k` does not publish the backend. Operators who need it today can
  re-add it knowingly.
- State the exposure plainly in `README.md` and `docs/API.md` — including the
  cross-origin *read* of credential-bearing responses, not only CSRF.

### A.7 Decision requested

1. Integrated OpenShift OAuth only, or integrated **and** direct external OIDC?
2. Is a disconnected deployment required to support authentication at GA, and if
   so against which in-air-gap IdP?
3. May the frontend image gain an `/api` reverse proxy and a relative
   `VITE_API_BASE`, accepting the `oaa-entrypoint.sh` validation change?
4. May `route-backend.yaml` be removed from the overlay (a breaking change for
   anyone depending on it)?
5. Is the `restricted-v2` securityContext to be changed to a namespace-assigned
   UID, or is granting an SCC the supported answer?

---

## Decision B — Red Hat signing key as a trust anchor

### B.1 What is true today

`oc` and `oc-mirror` are verified against each channel's own `sha256sum.txt`,
at build time (`backend/Containerfile:96-146`) and at runtime
(`backend/src/ocMirrorRuntime.js`, `acquireVerifiedTool`).

`openshift-install` and `mirror-registry` were **not** verified at all. This
wave closed that gap with the same mechanism — see `backend/src/verifiedDownload.js`.

### B.2 What is still missing, and why it was not done

Checksum verification proves the bytes match the manifest. It does **not** prove
the manifest is authentic: the manifest and the artifact come from the **same
origin over the same TLS connection**, so an attacker who can serve one can serve
both. That is a meaningfully weaker property than a signature, and nothing in
this repository may be described as signature verification.

Detached signatures do exist. Verified 2026-10-16:

| Artifact | Signature | Result |
|---|---|---|
| `…/x86_64/clients/ocp/4.20.18/sha256sum.txt.gpg` | GPG | HTTP 200 |
| `…/x86_64/clients/ocp/latest/sha256sum.txt.gpg` | GPG | HTTP 200 |
| `…/cgw/mirror-registry/latest/sha256sum.txt.gpg` | GPG | present |
| `…/cgw/mirror-registry/latest/mirror-registry-<arch>.tar.gz.asc` | detached | present |

Implementing this requires **pinning a Red Hat public signing key into the
repository and/or the images** as a trust anchor. The charter reserves new trust
anchors for human review, and rightly: a wrong or unverified key is worse than
no signature check, because it manufactures confidence. The key fingerprint has
to be confirmed out-of-band against Red Hat's published product-signing keys, not
fetched from the same mirror it is meant to authenticate.

### B.3 Recommendation

Adopt GPG verification with a pinned key, **after** a human confirms the
fingerprint out-of-band, with a strict no-unsigned-fallback policy.

Files that would change: `backend/src/verifiedDownload.js` (add a verify step),
`backend/Containerfile` and `frontend/Containerfile` (ship the keyring and
`gnupg`), a new tracked key file, and the `external-binaries.json` generator to
record signature status per artifact.

This is **not** required to make the current wave's checksum verification
correct. Checksum verification is a strict improvement on what was there (a
non-zero file size) and is independently valuable.

### B.4 Decision requested

1. Which Red Hat signing key(s), by fingerprint, and verified against what
   out-of-band source?
2. Keyring in the image, or in the repository, or both?
3. Is `oc-mirror`'s global-`latest` channel in scope, given its digest changes
   whenever Red Hat publishes?

---

## Decision C — release evidence signing and publication

### C.1 What is true today

`docs/security/SBOM_AND_PROVENANCE.md` is accurate and should be read first.
In short: the generators are real, committed, running code; **nothing is
committed or published**; there are no GitHub Releases at all; there are no
image signatures (cosign is checked for and recorded as absent); there is no
`SHA256SUMS`; and no SPDX is produced despite the axis contract naming it.

The most recent full certification run is bound to candidate
`f860d7db4457+dirty` — **stale and dirty**, with 8 modified and 1 untracked path
at scan time. It is not bound to any committed state.

### C.2 Decision requested

1. Are release artifacts to be signed, and with what key custody?
2. Does evidence publish as GitHub Release assets, and does that imply making
   anything public that is not public now?
3. Does the offline/high-side package carry a copy of the evidence?

Publication is irreversible and is explicitly reserved to the human. No GitHub
Release may be created to satisfy this.

---

## What this wave did instead

So that the hold is auditable rather than a silent omission:

- **Did not** change CORS, CSRF, routes, manifests, SCC, service accounts,
  network policies, cookies, or session handling.
- **Did not** add a signing trust anchor or verify any signature.
- **Did not** create a GitHub Release, tag, sign anything, or publish evidence.
- **Did** close the checksum gap for `openshift-install` and `mirror-registry`,
  fail-closed (`backend/src/verifiedDownload.js`).
- **Did** correct `manifests/README.md`, which claimed `restricted-v2`
  compatibility that has never been tested.
- **Did** record the exposure accurately here and in `docs/BACKLOG_STATUS.md`.

---

## Addendum — 2026-10-19: Decision A implemented, then corrected

The analysis above is left exactly as written; this records what happened
after it, because a reader of the current tree would otherwise find §A.4 and
"What this wave did instead" describing a state the repository has left.

Decision A was approved and implemented in the v2.1 hardening wave:
`backend/src/accessControl.js`, the oauth-proxy sidecar, the same-origin
`/api` proxy, NetworkPolicy, and the deletion of
`manifests/openshift/route-backend.yaml`. A later review then found five
authentication defects in that implementation, all corrected on 2026-10-19
(ledger: `docs/releases/evidence/REQUIREMENT_LEDGER_AUTH_CORRECTIONS_20261019.md`):

1. **AUTH-01.** §A.4 of this record already noted that "the process itself
   still listens on `0.0.0.0` … no host argument". The implementation added a
   startup guard on `BIND_ADDRESS` and left `app.listen(port)` untouched, so
   the guard checked a value the server never used. The address is now
   resolved once and bound; a loopback bind is proven by connecting to a real
   interface in `backend/test/listener-bind-boundary.test.js`.
2. **AUTH-02.** The overlay shipped the proxy `Secret` with empty values while
   this page's own guidance told the operator to create it first — a
   credential-blanking re-apply. The Secret is now operator-owned and absent
   from every manifest.
3. **AUTH-03.** nginx served 5173 on the pod IP while forwarding identity
   headers and attaching the shared secret, so §A.5's point 5 ("a sidecar that
   can be skipped … is not a boundary") still held against the implementation:
   NetworkPolicy was the only thing refusing it. nginx now binds the pod's
   loopback, which is where oauth-proxy's upstream already pointed.
   `X-Forwarded-Groups` is additionally dropped: `openshift/oauth-proxy` never
   sets or strips it, so it was the one identity-shaped field a caller could
   choose for themselves.
4. **AUTH-04.** The Route's `service.beta.openshift.io/inject-cabundle`
   annotation does nothing — service-ca injects into ConfigMaps, APIServices,
   CRDs and webhook configurations, not Routes. Removed, with the real
   mechanism (the router's `DEFAULT_DESTINATION_CA_PATH` service-CA bundle)
   cited in `manifests/openshift/route-frontend.yaml`.
5. **AUTH-05.** The nginx resolver named `kube-dns.kube-system.svc.cluster.local`,
   which does not exist on OpenShift. Derived from the pod's `resolv.conf`.

**Unchanged by that correction:** Decision B (no signing trust anchor was
added; checksum verification is still not signature verification) and
Decision C (nothing published, nothing signed, no GitHub Release). The
cluster verification in §5 of the closure report remains owner-deferred: none
of the five corrections has been exercised on a live OpenShift cluster.

**See also:** [SBOM and provenance](SBOM_AND_PROVENANCE.md) ·
[Backlog and status registry](../BACKLOG_STATUS.md) ·
[API reference](../API.md)
