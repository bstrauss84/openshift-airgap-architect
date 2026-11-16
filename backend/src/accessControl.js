/**
 * OpenShift Airgap Architect — API access control boundary
 *
 * Implements the topology approved for v2.1 and recorded in
 * `docs/security/DECISION_RECORD_API_EXPOSURE_AND_TRUST_ANCHORS.md` (Decision
 * A): built-in OpenShift OAuth in front of ONE authenticated frontend Route,
 * a same-origin `/api` reverse proxy, no public backend Route, and real
 * authorization in the backend rather than a UI that merely looks protected.
 *
 * WHAT WAS HERE BEFORE: nothing. `app.use(cors())` with library defaults —
 * `Access-Control-Allow-Origin: *` — and 51 anonymous routes, several of
 * which start privileged work with mounted credentials, return a generated
 * SSH private key, or render an install-config containing the pull secret.
 * Wildcard CORS does not merely enable CSRF; it lets arbitrary cross-origin
 * JavaScript READ those responses.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * THE THREE LAYERS, AND WHY NONE OF THEM IS SUFFICIENT ALONE
 *
 * 1. ORIGIN POLICY (CORS). An allowlist replaces the wildcard. This stops a
 *    cross-origin page READING a response. It does NOT stop the request being
 *    SENT — CORS is enforced by the browser on the response, and a simple
 *    form POST is dispatched regardless.
 *
 * 2. CSRF. Because 19 of 22 POST routes accept an empty JSON body, a plain
 *    cross-site <form> reaches real handlers. So state-changing requests must
 *    carry an Origin/Referer this server accepts, AND a custom header that a
 *    simple form cannot set — which forces a preflight the origin policy then
 *    refuses. Belt and braces, because each covers a case the other misses:
 *    the header check fails closed when Origin is absent, and the Origin
 *    check fails closed when an attacker can set headers from a same-site
 *    context.
 *
 * 3. IDENTITY. The authenticating hop is `openshift/oauth-proxy`, which
 *    terminates the OpenShift OAuth flow and forwards identity headers. The
 *    backend must NOT simply believe those headers: it is a separate pod with
 *    a ClusterIP Service, so any pod in the namespace could set them and skip
 *    the proxy entirely. The decision record is explicit — "a sidecar that
 *    can be skipped by reaching the Service directly is not a boundary;
 *    NetworkPolicy has to back it."
 *
 *    So identity is accepted only when the request ALSO carries a shared
 *    secret that only the proxy has (`OAA_PROXY_SHARED_SECRET`, mounted from
 *    a Kubernetes Secret into both the proxy's nginx config and the backend).
 *    Forging identity then requires reading that Secret, which is a different
 *    and much higher bar than guessing a header name. NetworkPolicy remains
 *    the outer layer and is shipped alongside; neither replaces the other.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * MODES, AND WHY THE DEFAULT IS WHAT IT IS
 *
 *   OAA_AUTH_MODE=proxy      production. Identity required on every /api
 *                            route except the unauthenticated probe set.
 *   OAA_AUTH_MODE=disabled   local single-user Compose, which binds
 *                            127.0.0.1 only. The historical behaviour.
 *
 * The default is `disabled`, deliberately and narrowly: the shipped
 * docker-compose.yml publishes the backend on `127.0.0.1:4000` for one
 * developer on one machine, and defaulting to `proxy` would break every
 * existing local install at upgrade with an auth error they cannot satisfy.
 * The OpenShift manifests set `proxy` explicitly, which is the deployment
 * where the exposure actually exists.
 *
 * That default is only safe while `disabled` cannot be reached from a
 * network. `assertAccessControlConfig` therefore FAILS STARTUP when the
 * combination is dangerous rather than trusting the operator to notice:
 * `disabled` plus a non-loopback bind address is refused outright.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * THE BIND ADDRESS IS RESOLVED HERE AND THE SERVER BINDS EXACTLY IT.
 *
 * WHAT WAS WRONG BEFORE: this module refused a non-loopback `BIND_ADDRESS`
 * while `backend/src/index.js` called `app.listen(port)` with no host — and
 * Node, given no host, binds the UNSPECIFIED address (`::`, every interface).
 * So the guard validated a variable the server never read. `disabled` mode
 * passed its own loopback check and then listened on the whole network. A
 * check whose subject is not the thing that happens is not a check.
 *
 * `resolveBindAddress` is now the single source of that value, it is returned
 * in the config, and `index.js` passes it to `listen`. The two cannot drift
 * again without the listener test failing.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * CONTAINER BINDING IS NOT OPERATOR-FACING EXPOSURE, AND THE DIFFERENCE IS
 * NARROW ENOUGH TO STATE EXACTLY.
 *
 * `docker-compose.yml` publishes `127.0.0.1:4000:4000`. Port publishing
 * forwards to the CONTAINER's address, never to the container's loopback, so
 * a containerised process that binds `127.0.0.1` is unreachable through a
 * published port. Compose therefore needs a wildcard bind inside the
 * container's own network namespace while the operator-facing exposure stays
 * loopback — two different facts that the old single check conflated.
 *
 * The exception is deliberately not a bare "trust me" flag:
 *
 *   1. the operator must DECLARE it (`OAA_CONTAINER_NETWORK=isolated`), and
 *   2. the process must actually BE in a container (`/run/.containerenv`,
 *      `/.dockerenv`, or a container cgroup), checked at startup.
 *
 * (2) is what makes (1) more than decoration: the declaration copied onto a
 * bare host — the realistic accident, someone lifting environment lines out
 * of docker-compose.yml into a systemd unit or a shell profile — is refused.
 *
 * WHAT IT HONESTLY CANNOT DO: a process inside a container cannot observe how
 * its ports were published, nor whether the container shares the host's
 * network namespace. `podman run --network=host` or `-p 0.0.0.0:4000:4000`
 * exposes an unauthenticated API and no in-process check can see it. The
 * publish specification is the boundary there, which is why the shipped
 * Compose file pins `127.0.0.1:` and why the startup log says plainly which
 * address was bound and under which exception.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * EXTERNAL OIDC IS EXPLICITLY NOT SUPPORTED IN v2.1, AND FAILS VISIBLY.
 *
 * OpenShift 4.22 can be configured with direct external OIDC, which REMOVES
 * the built-in OAuth server and its `oauth.openshift.io` APIs. `oauth-proxy`
 * has no endpoints to talk to in that mode, so this topology silently will
 * not work. An operator who sets `OAA_OIDC_ISSUER` is told so at startup
 * rather than discovering it as a login loop.
 *
 * @author Bill Strauss
 *
 * Developed with AI assistance from Claude (Anthropic) and Cursor AI.
 */
import crypto from "node:crypto";
import fs from "node:fs";

/** Header the authenticating proxy sets to prove it is the authenticating proxy. */
const PROXY_SECRET_HEADER = "x-oaa-proxy-auth";

/**
 * Identity headers `openshift/oauth-proxy` forwards after a successful login.
 *
 * These two, and ONLY these two. `openshift/oauth-proxy`'s
 * `addHeadersForProxying` calls `setRequestHeader` — which strips the
 * incoming value before setting its own — for `X-Forwarded-User` and
 * `X-Forwarded-Email`, so a client cannot smuggle either past the proxy.
 *
 * `X-Forwarded-Groups` IS NOT IN THAT LIST. openshift/oauth-proxy never sets
 * it and never strips it, so whatever a caller sends arrives at the upstream
 * untouched. It used to be parsed here into `req.identity.groups`, which
 * meant the one field in `identity` that looked like an authorization input
 * was the one field any caller could choose for themselves. Nothing reads
 * groups today, so this was a trap rather than a live escalation — but the
 * trap is the point: the next `if (req.identity.groups.includes("admin"))`
 * would have been forgeable by anyone who could reach the proxy.
 *
 * `groups` therefore stays in the identity shape, always empty, and the
 * nginx hop clears the header as well. Restoring it requires a source that
 * is actually authenticated — a SubjectAccessReview, or a token the backend
 * validates itself — not a header.
 */
const IDENTITY_USER_HEADER = "x-forwarded-user";
const IDENTITY_EMAIL_HEADER = "x-forwarded-email";

/**
 * Custom header a state-changing request must carry.
 *
 * Its VALUE is irrelevant and is never checked. Its presence is the whole
 * point: `fetch` cannot set a custom header cross-origin without triggering
 * a CORS preflight, and a plain HTML `<form>` cannot set one at all. This is
 * what closes the empty-body form-POST path.
 */
const CSRF_HEADER = "x-oaa-request";

/** Methods that cannot change state and therefore need no CSRF defence. */
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * Routes reachable without identity.
 *
 * Deliberately tiny, and each entry has a reason:
 *   /api/health, /api/ready  kubelet probes, which carry no identity and must
 *                            not be made to. They disclose liveness only.
 *   /api/metrics             scraped by Prometheus from inside the namespace;
 *                            protected by NetworkPolicy, not by identity.
 *
 * Everything else — including every GET — requires identity, because reads
 * here are not harmless: GET /api/generate renders the pull secret and
 * GET /api/jobs returns full tool output.
 */
const UNAUTHENTICATED_PATHS = new Set(["/api/health", "/api/ready", "/api/metrics"]);

const AUTH_MODES = Object.freeze(["disabled", "proxy"]);

function readMode(env) {
  const raw = String(env.OAA_AUTH_MODE || "disabled").toLowerCase().trim();
  return AUTH_MODES.includes(raw) ? raw : null;
}

function parseOrigins(env) {
  return String(env.OAA_ALLOWED_ORIGINS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Loopback-only bind addresses. Anything else is reachable from a network. */
function isLoopbackBind(host) {
  const h = String(host || "").trim();
  if (h === "localhost" || h === "::1" || h === "[::1]" || h === "::ffff:127.0.0.1") return true;
  // The whole 127.0.0.0/8 range is loopback, not just .0.0.1 — `127.0.0.2` is
  // a legitimate local-only bind and refusing it would be wrong.
  return /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(h);
}

/**
 * Files and cgroup markers that prove this process is inside a container.
 *
 * `/run/.containerenv` is podman's, `/.dockerenv` is Docker's. The cgroup
 * check catches the Kubernetes case, where neither file is guaranteed.
 */
export function detectContainerRuntime(io = fs) {
  for (const marker of ["/run/.containerenv", "/.dockerenv"]) {
    try {
      if (io.existsSync(marker)) return { inContainer: true, evidence: marker };
    } catch {
      /* unreadable marker is not evidence */
    }
  }
  try {
    const cgroup = io.readFileSync("/proc/self/cgroup", "utf8");
    const hit = /\b(docker|libpod|containerd|kubepods|crio)\b/.exec(cgroup);
    if (hit) return { inContainer: true, evidence: `/proc/self/cgroup contains "${hit[1]}"` };
  } catch {
    /* no procfs: treat as not-a-container, which is the fail-closed answer */
  }
  return { inContainer: false, evidence: null };
}

/**
 * The address the HTTP server will actually bind. One source of truth.
 *
 * Defaults differ by mode because the safe answer differs by mode:
 *
 *   disabled → 127.0.0.1. Unauthenticated; must not be reachable.
 *   proxy    → 0.0.0.0. Authenticated, and the backend is a separate pod that
 *              the frontend pod reaches over the ClusterIP Service — a
 *              loopback bind there would mean nothing could reach it at all.
 *
 * Throws, rather than quietly downgrading, when `disabled` is asked to bind a
 * network interface without the container exception being both declared and
 * corroborated.
 */
export function resolveBindAddress(env = process.env, probe = detectContainerRuntime) {
  const mode = readMode(env);
  const explicit = String(env.BIND_ADDRESS || env.HOST || "").trim();
  const bindAddress = explicit || (mode === "proxy" ? "0.0.0.0" : "127.0.0.1");

  if (mode !== "disabled" || isLoopbackBind(bindAddress)) {
    return { bindAddress, loopbackOnly: isLoopbackBind(bindAddress), containerException: false, evidence: null };
  }

  const declared = String(env.OAA_CONTAINER_NETWORK || "").toLowerCase().trim() === "isolated";
  if (!declared) {
    throw new Error(
      `OAA_AUTH_MODE=disabled refuses to start bound to "${bindAddress}". ` +
        "Unauthenticated mode is for local single-user use on loopback only, and this server now binds " +
        "exactly the address checked here. Either set OAA_AUTH_MODE=proxy (with OAA_PROXY_SHARED_SECRET and " +
        "OAA_ALLOWED_ORIGINS) to expose this API, or — if this is a container whose ports are published to " +
        "loopback by the container engine — declare that with OAA_CONTAINER_NETWORK=isolated."
    );
  }

  const evidence = probe();
  if (!evidence.inContainer) {
    throw new Error(
      `OAA_CONTAINER_NETWORK=isolated was declared with BIND_ADDRESS="${bindAddress}", but this process is ` +
        "NOT running inside a container (no /run/.containerenv, no /.dockerenv, no container cgroup). " +
        "That declaration means 'the bind is confined to a container network namespace'; on a host it would " +
        "publish an unauthenticated API on every interface. Remove it, or bind loopback."
    );
  }

  return { bindAddress, loopbackOnly: false, containerException: true, evidence: evidence.evidence };
}

/**
 * Validate the access-control configuration, or throw.
 *
 * Called at startup so a dangerous or incoherent combination stops the
 * process instead of serving. Every branch here is a configuration an
 * operator could plausibly produce by accident.
 */
export function assertAccessControlConfig(env = process.env, probe = detectContainerRuntime) {
  const mode = readMode(env);
  if (!mode) {
    throw new Error(
      `OAA_AUTH_MODE="${env.OAA_AUTH_MODE}" is not a supported value. Use one of: ${AUTH_MODES.join(", ")}.`
    );
  }

  // External OIDC removes the built-in OAuth server this topology depends on.
  if (env.OAA_OIDC_ISSUER) {
    throw new Error(
      "OAA_OIDC_ISSUER is set, but direct external OIDC is NOT supported by this deployment mode in v2.1. " +
        "This build integrates with the cluster's BUILT-IN OpenShift OAuth server via openshift/oauth-proxy. " +
        "On a cluster configured for external OIDC the built-in OAuth server and its oauth.openshift.io APIs " +
        "are removed, so oauth-proxy has no endpoints to use and login cannot succeed. " +
        "Unset OAA_OIDC_ISSUER, or deploy behind your own authenticating proxy with OAA_AUTH_MODE=proxy and " +
        "OAA_PROXY_SHARED_SECRET set to a value only that proxy knows."
    );
  }

  if (mode === "proxy") {
    const secret = env.OAA_PROXY_SHARED_SECRET || "";
    if (!secret) {
      throw new Error(
        "OAA_AUTH_MODE=proxy requires OAA_PROXY_SHARED_SECRET. Without it the backend would trust identity " +
          "headers from any caller that can reach its Service, which is exactly the bypass this mode exists to close."
      );
    }
    if (secret.length < 32) {
      throw new Error(
        `OAA_PROXY_SHARED_SECRET is ${secret.length} characters; at least 32 are required. ` +
          "It is the only thing standing between a namespace-local pod and forged identity headers."
      );
    }
    if (parseOrigins(env).length === 0) {
      throw new Error(
        "OAA_AUTH_MODE=proxy requires OAA_ALLOWED_ORIGINS (comma-separated), e.g. " +
          "https://airgap-architect.apps.example.com. It is the origin allowlist that replaces wildcard CORS."
      );
    }
  }

  // Resolve the listening address here, and refuse the dangerous combinations
  // while refusing them still means something: this value is what index.js
  // passes to `listen`, so the check and the socket cannot disagree.
  const bind = resolveBindAddress(env, probe);

  return {
    mode,
    allowedOrigins: parseOrigins(env),
    hasSharedSecret: Boolean(env.OAA_PROXY_SHARED_SECRET),
    bindAddress: bind.bindAddress,
    bindLoopbackOnly: bind.loopbackOnly,
    bindContainerException: bind.containerException,
    bindContainerEvidence: bind.evidence,
  };
}

/** Constant-time compare that does not leak length through early return. */
function secretsMatch(provided, expected) {
  const a = Buffer.from(String(provided || ""), "utf8");
  const b = Buffer.from(String(expected || ""), "utf8");
  if (a.length !== b.length) {
    // Still do a comparison so the timing of a length mismatch resembles a
    // value mismatch. The result is discarded.
    crypto.timingSafeEqual(b, b);
    return false;
  }
  return crypto.timingSafeEqual(a, b);
}

/**
 * Origin policy middleware. Replaces `cors()`.
 *
 * In `proxy` mode the UI is same-origin with the API (nginx proxies /api), so
 * a compliant browser sends no Origin on same-origin requests and no CORS
 * headers are needed at all. An allowlisted Origin is still answered — some
 * deployments front the UI with an additional hostname — but anything else
 * gets no `Access-Control-Allow-Origin`, so the browser withholds the
 * response body.
 */
export function originPolicy(config) {
  const allowed = new Set(config.allowedOrigins);
  return function originPolicyMiddleware(req, res, next) {
    const origin = req.headers.origin;

    if (config.mode === "disabled") {
      // Local development: preserve the permissive behaviour, but echo the
      // specific origin rather than `*` so credentialed requests behave
      // predictably if they are ever added.
      if (origin) {
        res.setHeader("Access-Control-Allow-Origin", origin);
        res.setHeader("Vary", "Origin");
        res.setHeader("Access-Control-Allow-Credentials", "true");
      }
    } else if (origin && allowed.has(origin)) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Vary", "Origin");
      res.setHeader("Access-Control-Allow-Credentials", "true");
    }

    if (req.method === "OPTIONS") {
      // Only answer a preflight for an origin we would actually serve.
      const permitted = config.mode === "disabled" ? Boolean(origin) : Boolean(origin && allowed.has(origin));
      if (!permitted) {
        return res.status(403).json({ error: "Origin not permitted", code: "ORIGIN_FORBIDDEN" });
      }
      res.setHeader("Access-Control-Allow-Methods", "GET,POST,DELETE,OPTIONS");
      res.setHeader(
        "Access-Control-Allow-Headers",
        ["content-type", "x-request-id", CSRF_HEADER].join(",")
      );
      res.setHeader("Access-Control-Max-Age", "600");
      return res.status(204).end();
    }

    return next();
  };
}

/**
 * CSRF defence for state-changing requests.
 *
 * Two independent conditions, both required:
 *   - a custom header a cross-site form cannot set;
 *   - an Origin/Referer this server accepts, when one is present.
 *
 * A same-origin browser request from the SPA satisfies both. A cross-site
 * form satisfies neither. A non-browser client (curl, CI) satisfies the
 * header trivially and sends no Origin, which is correct: CSRF is a browser
 * ambient-authority problem, and a client that sets its own headers is not
 * being ridden.
 */
export function csrfPolicy(config) {
  const allowed = new Set(config.allowedOrigins);

  return function csrfMiddleware(req, res, next) {
    if (SAFE_METHODS.has(req.method)) return next();
    if (UNAUTHENTICATED_PATHS.has(req.path)) return next();

    const origin = req.headers.origin;

    // ---- The Origin check. Load-bearing in BOTH modes. -------------------
    //
    // This is the layer that actually stops cross-site request forgery.
    // Browsers send `Origin` on every POST, including a plain HTML <form>
    // submission — which is precisely the vector that matters here, because
    // 19 of 22 POST routes accept an empty JSON body and so are reachable
    // from a form. A request carrying a foreign Origin is rejected outright.
    //
    // A client that sends NO Origin is not a browser acting on ambient
    // authority: curl, a CI job and the test suite all land here. CSRF is a
    // browser-cookie problem, so refusing those would cost compatibility and
    // buy no security.
    if (origin) {
      const permitted = config.mode === "disabled" ? isLocalDevOrigin(origin) : allowed.has(origin);
      if (!permitted) {
        return res.status(403).json({ error: "Origin not permitted", code: "ORIGIN_FORBIDDEN" });
      }
    } else {
      // No Origin, but a Referer can still betray a cross-site browser POST.
      const referer = req.headers.referer;
      if (referer) {
        let refOrigin = null;
        try {
          refOrigin = new URL(referer).origin;
        } catch {
          refOrigin = null;
        }
        if (refOrigin) {
          const permitted = config.mode === "disabled" ? isLocalDevOrigin(refOrigin) : allowed.has(refOrigin);
          if (!permitted) {
            return res.status(403).json({ error: "Referer not permitted", code: "ORIGIN_FORBIDDEN" });
          }
        }
      }
    }

    // ---- The custom-header check. `proxy` mode only. ---------------------
    //
    // Scoped deliberately, and the scoping is a judgement rather than an
    // oversight. The header is a second, independent barrier: a <form>
    // cannot set it, and `fetch` setting it cross-origin forces a preflight
    // the origin policy then refuses. That is worth having where the API is
    // exposed to a network.
    //
    // Requiring it in `disabled` mode would change the client contract for
    // every existing local caller — scripts, curl, the test suite — to defend
    // a loopback-bound, single-user process whose cross-site exposure the
    // Origin check above already closes. Breaking those for no additional
    // protection is a bad trade, and a defence everybody has to work around
    // is a defence that gets switched off.
    if (config.mode === "proxy" && !req.headers[CSRF_HEADER]) {
      return res.status(403).json({
        error: `State-changing requests must send the ${CSRF_HEADER} header.`,
        code: "CSRF_HEADER_REQUIRED",
      });
    }

    return next();
  };
}

/**
 * Origins the local development topology legitimately uses.
 *
 * In `disabled` mode the Vite dev server (5173) and the browser talk to the
 * backend (4000) cross-origin, so an allowlist cannot be configured the way
 * it is in production. Any loopback origin is accepted; everything else —
 * which is to say every real attacker page — is not.
 */
function isLocalDevOrigin(origin) {
  try {
    const { hostname } = new URL(origin);
    return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1" || hostname === "[::1]";
  } catch {
    return false;
  }
}

/**
 * Identity enforcement.
 *
 * Populates `req.identity` and rejects anonymous callers in `proxy` mode.
 * The shared secret is checked BEFORE the identity headers are read, so an
 * unauthenticated caller cannot influence anything downstream by supplying
 * them.
 */
export function requireIdentity(config, env = process.env) {
  const expectedSecret = env.OAA_PROXY_SHARED_SECRET || "";

  return function identityMiddleware(req, res, next) {
    if (config.mode === "disabled") {
      req.identity = { authenticated: false, mode: "disabled", user: null, email: null, groups: [] };
      return next();
    }

    if (UNAUTHENTICATED_PATHS.has(req.path)) {
      req.identity = { authenticated: false, mode: "proxy", user: null, email: null, groups: [], probe: true };
      return next();
    }

    if (!secretsMatch(req.headers[PROXY_SECRET_HEADER], expectedSecret)) {
      // Covers both "no secret" and "wrong secret", and deliberately does not
      // distinguish them. A caller that reached the Service directly, skipping
      // the proxy, lands here.
      return res.status(401).json({
        error: "Request did not arrive through the authenticating proxy.",
        code: "PROXY_AUTH_REQUIRED",
      });
    }

    const user = req.headers[IDENTITY_USER_HEADER];
    if (!user) {
      return res.status(401).json({
        error: "Authenticated identity is required.",
        code: "IDENTITY_REQUIRED",
      });
    }

    req.identity = {
      authenticated: true,
      mode: "proxy",
      user: String(user),
      email: req.headers[IDENTITY_EMAIL_HEADER] ? String(req.headers[IDENTITY_EMAIL_HEADER]) : null,
      // Deliberately always empty. See IDENTITY_*_HEADER above: oauth-proxy
      // does not set or strip X-Forwarded-Groups, so any value here is the
      // caller's own and must not be presented as an authenticated claim.
      groups: [],
    };
    return next();
  };
}

/** Install the whole boundary, in the only order that is correct. */
export function installAccessControl(app, env = process.env, probe = detectContainerRuntime) {
  const config = assertAccessControlConfig(env, probe);
  // Origin policy first: a preflight must be answered before anything else
  // inspects the request, and a forbidden origin should not reach CSRF or
  // identity logic at all.
  app.use(originPolicy(config));
  app.use(csrfPolicy(config));
  app.use(requireIdentity(config, env));
  return config;
}

export const ACCESS_CONTROL_HEADERS = Object.freeze({
  PROXY_SECRET_HEADER,
  IDENTITY_USER_HEADER,
  IDENTITY_EMAIL_HEADER,
  // Exported so tests can send it and prove it is IGNORED. It is not an
  // identity header here: oauth-proxy neither sets nor strips it.
  UNTRUSTED_GROUPS_HEADER: "x-forwarded-groups",
  CSRF_HEADER,
});

export const UNAUTHENTICATED_ROUTES = UNAUTHENTICATED_PATHS;
