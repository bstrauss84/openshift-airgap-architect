/**
 * The OpenShift overlay renders to an AUTHENTICATED deployment.
 *
 * These are static assertions over `oc kustomize manifests/openshift`, which
 * is the artifact an operator actually applies. They exist because every
 * property below is one somebody can silently undo with a one-line edit, and
 * none of them is visible in a diff review of a single file:
 *
 *   - re-adding route-backend.yaml republishes 51 anonymous endpoints;
 *   - pointing the Route at port 5173 skips oauth-proxy entirely;
 *   - restoring runAsUser: 1001 makes the pod inadmissible under
 *     restricted-v2, which is the claim the repository got wrong before;
 *   - dropping the NetworkPolicy turns the sidecar into decoration, because
 *     the backend Service stays reachable from every pod in the namespace.
 *
 * WHAT THESE TESTS ARE NOT. Rendering is not admission. Nothing here proves
 * the cluster accepts the pod, that oauth-proxy completes a login, or that
 * the NetworkPolicy is enforced by the installed network plugin. Those need
 * a cluster and are recorded as OWNER-DEFERRED with exact commands in
 * manifests/README.md. A green run of this file must never be described as
 * restricted-v2 certification.
 *
 * @author Bill Strauss
 * Developed with AI assistance from Claude (Anthropic) and Cursor AI.
 */

import { describe, test, before } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
// Namespace import, not default: js-yaml exposes no ESM default export, and
// scripts/t6a-e2e-helper-loadable.test.mjs exists because this exact mistake
// shipped once already.
import * as YAML from "js-yaml";

const REPO_ROOT = path.resolve(import.meta.dirname, "..");
const OVERLAY = path.join(REPO_ROOT, "manifests", "openshift");

let docs = null;
let renderError = null;

function kustomizeBinary() {
  for (const candidate of [["oc", ["kustomize"]], ["kubectl", ["kustomize"]], ["kustomize", ["build"]]]) {
    try {
      execFileSync(candidate[0], ["version", "--client"], { stdio: "ignore" });
      return candidate;
    } catch {
      /* try the next one */
    }
  }
  return null;
}

before(() => {
  const bin = kustomizeBinary();
  if (!bin) {
    renderError = "no kustomize-capable binary (oc, kubectl or kustomize) on PATH";
    return;
  }
  try {
    const out = execFileSync(bin[0], [...bin[1], OVERLAY], { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
    docs = YAML.loadAll(out).filter(Boolean);
  } catch (err) {
    renderError = `kustomize render failed: ${err.stderr || err.message}`;
  }
});

const byKind = (kind) => (docs ?? []).filter((d) => d.kind === kind);
const named = (kind, name) => byKind(kind).find((d) => d.metadata?.name === name);
const containersOf = (deploy) => deploy?.spec?.template?.spec?.containers ?? [];

/** Skip cleanly when kustomize is unavailable, rather than passing vacuously. */
const requireRender = (t) => {
  if (renderError) {
    t.diagnostic(renderError);
    return false;
  }
  assert.ok(docs && docs.length, "overlay must render at least one object");
  return true;
};

describe("OpenShift overlay renders", () => {
  test("the overlay renders without error", (t) => {
    if (!requireRender(t)) return;
    assert.ok(docs.length > 5, `expected a full deployment, rendered ${docs.length} objects`);
  });
});

describe("OpenShift overlay — no unauthenticated API exposure", () => {
  test("publishes EXACTLY ONE Route", (t) => {
    if (!requireRender(t)) return;
    const routes = byKind("Route");
    assert.equal(routes.length, 1, `expected one Route, got: ${routes.map((r) => r.metadata.name).join(", ")}`);
  });

  test("no Route targets the backend Service", (t) => {
    if (!requireRender(t)) return;
    for (const r of byKind("Route")) {
      assert.notEqual(
        r.spec?.to?.name,
        "airgap-architect-backend",
        "a backend Route republishes the anonymous API and defeats the proxy"
      );
    }
  });

  test("the Route terminates at the oauth-proxy port, not the nginx port", (t) => {
    if (!requireRender(t)) return;
    const route = byKind("Route")[0];
    assert.equal(
      route.spec?.port?.targetPort,
      "public",
      "targeting `http` (5173) would bypass oauth-proxy and serve the UI and API unauthenticated"
    );
    assert.equal(route.spec?.tls?.termination, "reencrypt");
  });
});

describe("OpenShift overlay — identity is enforced and backed", () => {
  test("the frontend pod runs an oauth-proxy sidecar", (t) => {
    if (!requireRender(t)) return;
    const names = containersOf(named("Deployment", "airgap-architect-frontend")).map((c) => c.name);
    assert.ok(names.includes("oauth-proxy"), `frontend containers: ${names.join(", ")}`);
  });

  test("oauth-proxy authorizes, not merely authenticates", (t) => {
    if (!requireRender(t)) return;
    const proxy = containersOf(named("Deployment", "airgap-architect-frontend")).find((c) => c.name === "oauth-proxy");
    const args = (proxy?.args ?? []).join(" ");
    assert.match(args, /--provider=openshift/, "must use the built-in OpenShift OAuth provider");
    assert.match(
      args,
      /--openshift-sar=/,
      "without a SAR any cluster user who can log in is admitted; that is authentication without authorization"
    );
  });

  test("the backend runs in proxy auth mode with a secret-sourced shared secret", (t) => {
    if (!requireRender(t)) return;
    const backend = containersOf(named("Deployment", "airgap-architect-backend")).find((c) => c.name === "backend");
    const env = Object.fromEntries((backend?.env ?? []).map((e) => [e.name, e]));
    assert.equal(env.OAA_AUTH_MODE?.value, "proxy");
    assert.ok(env.OAA_PROXY_SHARED_SECRET?.valueFrom?.secretKeyRef, "the shared secret must come from a Secret, never a literal");
    assert.ok(env.OAA_ALLOWED_ORIGINS?.value, "an origin allowlist must be configured");
  });

  test("the frontend talks to the API same-origin", (t) => {
    if (!requireRender(t)) return;
    const fe = containersOf(named("Deployment", "airgap-architect-frontend")).find((c) => c.name === "frontend");
    const env = Object.fromEntries((fe?.env ?? []).map((e) => [e.name, e]));
    assert.equal(env.VITE_API_BASE?.value, "/api", "an absolute URL would not carry the oauth-proxy session cookie");
  });

  test("a NetworkPolicy restricts the backend to the frontend pod", (t) => {
    if (!requireRender(t)) return;
    const policies = byKind("NetworkPolicy");
    assert.ok(policies.length >= 1, "a bypassable sidecar is not a boundary; NetworkPolicy must back it");

    const backendPolicy = policies.find((p) => p.spec?.podSelector?.matchLabels?.component === "backend");
    assert.ok(backendPolicy, "the backend must have an ingress policy");
    assert.ok(
      (backendPolicy.spec.ingress ?? []).some((rule) =>
        (rule.from ?? []).some((f) => f.podSelector?.matchLabels?.component === "frontend")
      ),
      "the frontend pod must be an allowed source"
    );
  });

  test("no committed secret value", (t) => {
    if (!requireRender(t)) return;
    for (const s of byKind("Secret")) {
      for (const [k, v] of Object.entries(s.stringData ?? {})) {
        assert.equal(v, "", `${s.metadata.name}.${k} must ship empty; a default secret is the same as no secret`);
      }
      assert.deepEqual(s.data ?? {}, {}, `${s.metadata.name} must not ship base64 data`);
    }
  });
});

describe("AUTH-02 — the overlay cannot blank an operator-created Secret", () => {
  // THE DEFECT. `secret-proxy.yaml` declared the SAME Secret the deployment
  // guide tells the operator to create first, with empty stringData. `oc
  // apply` three-way merges and an empty string is a *present* value, so the
  // documented sequence — create the Secret, apply, read the Route host,
  // apply again — overwrote both keys with "" on the second apply. The
  // frontend then refuses to start on OAA_REQUIRE_PROXY_SECRET and the
  // backend refuses OAA_AUTH_MODE=proxy: an authenticated deployment
  // destroyed by its own idempotent re-apply.

  test("renders NO Secret named airgap-architect-proxy", (t) => {
    if (!requireRender(t)) return;
    const proxySecret = byKind("Secret").find((s) => s.metadata?.name === "airgap-architect-proxy");
    assert.equal(
      proxySecret,
      undefined,
      "the overlay must not manage the live proxy Secret; `oc apply -k` would overwrite the operator's keys"
    );
  });

  test("renders no Secret at all — every credential here is operator-created", (t) => {
    if (!requireRender(t)) return;
    // The same reasoning covers the base `airgap-architect-secrets`
    // placeholder, which would have blanked a real Red Hat pull secret.
    assert.deepEqual(
      byKind("Secret").map((s) => s.metadata?.name),
      [],
      "a Secret rendered with empty values is a credential-destroying apply waiting to happen"
    );
  });

  test("no file in the overlay declares a Secret, and no generator produces one", () => {
    // A `secretGenerator` would reintroduce the identical clobber under a
    // different spelling, and a file not currently in `resources` is one line
    // from being added back.
    for (const entry of fs.readdirSync(OVERLAY)) {
      if (!/\.(ya?ml)$/.test(entry)) continue;
      const text = fs.readFileSync(path.join(OVERLAY, entry), "utf8");
      const declares = text
        .split("\n")
        .some((l) => /^kind:\s*Secret\s*$/.test(l.trim()) || /^secretGenerator:/.test(l));
      assert.equal(declares, false, `${entry} declares a Secret; the proxy Secret is operator-owned`);
    }
  });

  test("the Deployments still READ the Secret they no longer manage", (t) => {
    if (!requireRender(t)) return;
    // Removing the resource must not have removed the wiring: `secretKeyRef`
    // reads and never writes, which is exactly the relationship wanted.
    const refs = [];
    for (const d of byKind("Deployment")) {
      for (const c of containersOf(d)) {
        for (const e of c.env ?? []) {
          const ref = e.valueFrom?.secretKeyRef;
          if (ref?.name === "airgap-architect-proxy") refs.push(`${d.metadata.name}/${c.name}:${e.name}`);
        }
      }
    }
    assert.ok(
      refs.some((r) => r.includes("airgap-architect-backend")),
      `the backend must still source OAA_PROXY_SHARED_SECRET from the Secret; found: ${refs.join(", ")}`
    );
    assert.ok(
      refs.some((r) => r.includes("airgap-architect-frontend")),
      `the frontend must still source the shared secret; found: ${refs.join(", ")}`
    );

    // And the volume oauth-proxy mounts its cookie key from.
    const fe = named("Deployment", "airgap-architect-frontend");
    const vol = (fe.spec.template.spec.volumes ?? []).find((v) => v.secret?.secretName === "airgap-architect-proxy");
    assert.ok(vol, "oauth-proxy still mounts the operator-created Secret for its session key");
  });
});

describe("AUTH-03 — the unauthenticated nginx port is not reachable past the proxy", () => {
  test("nginx is pinned to loopback in the authenticated overlay", (t) => {
    if (!requireRender(t)) return;
    const fe = containersOf(named("Deployment", "airgap-architect-frontend")).find((c) => c.name === "frontend");
    const env = Object.fromEntries((fe?.env ?? []).map((e) => [e.name, e]));
    assert.equal(
      env.OAA_NGINX_LISTEN_ADDRESS?.value,
      "127.0.0.1",
      "serving 5173 on the pod IP forwards forged identity with the backend secret attached"
    );
    assert.ok(env.OAA_REQUIRE_PROXY_SECRET?.value, "the entrypoint's fail-closed check keys off this");
  });

  test("the frontend Service publishes ONLY the authenticating port", (t) => {
    if (!requireRender(t)) return;
    const svc = named("Service", "airgap-architect-frontend");
    assert.deepEqual(
      (svc.spec.ports ?? []).map((p) => p.port).sort((a, b) => a - b),
      [8443],
      "a Service port on 5173 offers the pre-authentication nginx to the whole namespace"
    );
  });

  test("probes target the probe-only listener, so a loopback bind still becomes Ready", (t) => {
    if (!requireRender(t)) return;
    const fe = containersOf(named("Deployment", "airgap-architect-frontend")).find((c) => c.name === "frontend");
    for (const probe of ["livenessProbe", "readinessProbe"]) {
      assert.equal(fe[probe]?.httpGet?.port, 8081, `${probe} must not point at the loopback-bound serving port`);
      assert.equal(fe[probe]?.httpGet?.path, "/healthz");
    }
  });

  test("the rendered pod spec does not advertise the loopback-bound port", (t) => {
    if (!requireRender(t)) return;
    const fe = containersOf(named("Deployment", "airgap-architect-frontend")).find((c) => c.name === "frontend");
    const declared = (fe?.ports ?? []).map((p) => p.containerPort);

    // containerPort is informational — it neither opens nor closes anything,
    // so this is not a live hole. It is a correctness-of-evidence guard: the
    // base declares `5173/http`, the patch keys `ports` on `containerPort`,
    // and a plain merge therefore KEEPS 5173 in a pod where nginx binds
    // 127.0.0.1. The named `http` port left behind is what a future
    // `targetPort: http` would silently resolve to.
    assert.ok(
      !declared.includes(5173),
      `the overlay must not declare 5173, which nginx binds on loopback here; declared: ${declared.join(", ")}`
    );
    assert.deepEqual(declared, [8081], "only the probe listener is reachable on this pod's IP");
    assert.ok(
      !(fe?.ports ?? []).some((p) => p.name === "http"),
      "a named `http` port is what `targetPort: http` resolves to; it must not name a loopback-only port"
    );
  });

  test("NetworkPolicy admits the proxy port only — and is no longer the sole defence", (t) => {
    if (!requireRender(t)) return;
    const fe = byKind("NetworkPolicy").find((p) => p.spec?.podSelector?.matchLabels?.component === "frontend");
    assert.ok(fe, "the frontend still needs an ingress policy");
    const ports = (fe.spec.ingress ?? []).flatMap((r) => (r.ports ?? []).map((p) => p.port));
    assert.ok(ports.every((p) => p === 8443), `only the oauth-proxy port may be admitted; got ${ports.join(", ")}`);
  });
});

describe("AUTH-04 — the reencrypt Route describes a mechanism that exists", () => {
  test("no Route carries service.beta.openshift.io/inject-cabundle", (t) => {
    if (!requireRender(t)) return;
    // The service-ca operator injects into ConfigMaps, APIServices, CRDs and
    // webhook configurations. Route is not an injection target, so the
    // annotation did nothing and the comment beside it described a mechanism
    // that was not running.
    for (const r of byKind("Route")) {
      assert.equal(
        r.metadata?.annotations?.["service.beta.openshift.io/inject-cabundle"],
        undefined,
        "inject-cabundle on a Route is inert; it must not imply the router was configured by it"
      );
    }
  });

  test("a reencrypt Route omits destinationCACertificate, which is what selects the router default", (t) => {
    if (!requireRender(t)) return;
    const route = byKind("Route").find((r) => r.spec?.tls?.termination === "reencrypt");
    assert.ok(route, "the one Route terminates reencrypt");
    assert.equal(
      route.spec.tls.destinationCACertificate,
      undefined,
      "openshift/api: omitting it makes the router use its own destination CA (the mounted service-ca bundle)"
    );
  });

  test("the Service asks the cluster for the serving certificate the router will verify", (t) => {
    if (!requireRender(t)) return;
    const svc = named("Service", "airgap-architect-frontend");
    assert.equal(
      svc.metadata?.annotations?.["service.beta.openshift.io/serving-cert-secret-name"],
      "airgap-architect-proxy-tls",
      "without a service-CA serving certificate there is nothing for the router's default CA to verify"
    );
  });
});

describe("OpenShift overlay — restricted-v2 admissibility", () => {
  test("no Deployment pins runAsUser", (t) => {
    if (!requireRender(t)) return;
    for (const d of byKind("Deployment")) {
      for (const c of containersOf(d)) {
        assert.equal(
          c.securityContext?.runAsUser,
          undefined,
          `${d.metadata.name}/${c.name} pins runAsUser; restricted-v2 assigns a UID from the namespace range and rejects anything else`
        );
      }
    }
  });

  test("no Deployment pins fsGroup", (t) => {
    if (!requireRender(t)) return;
    for (const d of byKind("Deployment")) {
      assert.equal(
        d.spec?.template?.spec?.securityContext?.fsGroup,
        undefined,
        `${d.metadata.name} pins fsGroup; restricted-v2 assigns one`
      );
    }
  });

  test("the hardening that restricted-v2 DOES want is still asserted", (t) => {
    if (!requireRender(t)) return;
    // Removing the UID pin must not have removed the real controls with it.
    for (const d of byKind("Deployment")) {
      for (const c of containersOf(d)) {
        assert.equal(c.securityContext?.allowPrivilegeEscalation, false, `${d.metadata.name}/${c.name}`);
        assert.equal(c.securityContext?.runAsNonRoot, true, `${d.metadata.name}/${c.name}`);
        assert.deepEqual(c.securityContext?.capabilities?.drop, ["ALL"], `${d.metadata.name}/${c.name}`);
        assert.equal(c.securityContext?.seccompProfile?.type, "RuntimeDefault", `${d.metadata.name}/${c.name}`);
      }
    }
  });

  test("the backend does not mount a ServiceAccount token it has no use for", (t) => {
    if (!requireRender(t)) return;
    const backend = named("Deployment", "airgap-architect-backend");
    assert.equal(backend.spec.template.spec.automountServiceAccountToken, false);
  });
});

describe("base manifests stay deployable on plain Kubernetes", () => {
  test("the base still pins runAsUser, because vanilla Kubernetes has no SCC to assign one", () => {
    // Deliberate asymmetry, asserted so nobody "fixes" the base to match the
    // overlay. backend/Containerfile's final stage is USER root (it drops
    // privileges in its entrypoint), so removing runAsUser from the base
    // while runAsNonRoot stays true would make the kubelet refuse the pod.
    const text = fs.readFileSync(path.join(REPO_ROOT, "manifests", "base", "backend-deployment.yaml"), "utf8");
    assert.match(text, /runAsUser:\s*1001/, "the base targets plain Kubernetes and must keep its UID pin");
  });
});

/**
 * The base, which is plain Kubernetes and has no oauth-proxy.
 *
 * `VITE_API_BASE` is the one value in these manifests that is resolved by
 * the USER'S BROWSER rather than by a pod, and that is what made the original
 * value wrong in a way review kept missing: an in-cluster Service DNS name is
 * perfectly valid YAML, resolves fine from inside the cluster, and cannot be
 * resolved by the browser that actually has to use it. The documented
 * workaround was to publish the backend on its own Route, which is precisely
 * the API exposure the authenticated overlay exists to remove — so the defect
 * did not merely break the base, it steered operators toward the hole.
 */
describe("base manifests — VITE_API_BASE is resolvable by the browser that uses it", () => {
  const baseConfig = () =>
    YAML.load(fs.readFileSync(path.join(REPO_ROOT, "manifests", "base", "configmap.yaml"), "utf8"));

  test("the base sends the browser to a same-origin path, not a Service DNS name", () => {
    const value = baseConfig().data.VITE_API_BASE;
    assert.equal(value, "/api", "the browser must call the frontend's own origin, which nginx proxies in-pod");
  });

  test("it is not an absolute URL, and names no in-cluster Service", () => {
    const value = String(baseConfig().data.VITE_API_BASE);
    assert.ok(!/^https?:\/\//i.test(value), `an absolute URL here points the browser off-origin: ${value}`);
    assert.ok(
      !/airgap-architect-backend/.test(value),
      "a cluster-internal Service name cannot be resolved by a browser outside the cluster"
    );
  });

  test("the overlay and the base agree, so the authenticated path is not a special case", (t) => {
    if (!requireRender(t)) return;
    const fe = containersOf(named("Deployment", "airgap-architect-frontend")).find((c) => c.name === "frontend");
    const overlayValue = (fe?.env ?? []).find((e) => e.name === "VITE_API_BASE")?.value;
    assert.equal(overlayValue, baseConfig().data.VITE_API_BASE, "one origin shape in both deployments");
  });
});
