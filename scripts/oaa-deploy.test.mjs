/**
 * scripts/deploy/oaa-deploy.sh (v2.2.0 M7, enterprise deployment reliability).
 *
 * Fake podman / compose / curl executables first on PATH record every call and
 * reproduce the customer-site failures: a CDN blob read ending in
 * "unexpected EOF", an inspecting proxy's self-signed chain inside the build,
 * refused credentials, and a container that is "Up" while its port is dead.
 */
import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPT = path.join(REPO, "scripts/deploy/oaa-deploy.sh");
const BACKEND = "localhost/oaa-test-backend:t";
const FRONTEND = "localhost/oaa-test-frontend:t";
let dir;

const write = (name, body) => { const p = path.join(dir, "bin", name); fs.writeFileSync(p, body, { mode: 0o755 }); return p; };

function fakes() {
  fs.mkdirSync(path.join(dir, "bin"), { recursive: true });
  fs.mkdirSync(path.join(dir, "xdg"), { mode: 0o700 });
  fs.writeFileSync(path.join(dir, "images"), "");
  fs.writeFileSync(path.join(dir, "containers"), ""); // id name service status
  // podman: behaviour per FAKE_* variables; container state in ${dir}/containers.
  write("podman", `#!/bin/bash
echo "podman $*" >> "${dir}/calls"
C="${dir}/containers"
case "$1" in
  --version) echo "podman version 4.9.4-rhel"; exit 0 ;;
  info) if [ -n "\${FAKE_INFO_FAIL:-}" ]; then echo "Failed to obtain podman configuration: lstat /run/user/1000: no such file or directory" >&2; exit 125; fi
    case "$3" in
      *Rootless*) echo "\${FAKE_ROOTLESS:-true}" ;; *CgroupManager*) echo "\${FAKE_CGM:-systemd}" ;;
      *CgroupsVersion*) echo v2 ;; *GraphRoot*) echo "${dir}" ;; *OCIRuntime*) echo crun ;;
      *NetworkBackend*) echo netavark ;; *EventLogger*) echo journald ;; *Arch*) echo amd64 ;; *) echo "?" ;; esac; exit 0 ;;
  image)
    if [ "$2" = exists ]; then grep -qxF "$3" "${dir}/images"; exit $?; fi
    echo "sha256:0000000000000000000000000000000000000000000000000000000000000000"; exit 0 ;;
  ps)
    svc=""; for a in "$@"; do case "$a" in label=com.docker.compose.service=*) svc="\${a#label=com.docker.compose.service=}";; esac; done
    [ -n "$svc" ] && awk -v s="$svc" '$3==s{print $1}' "$C"; exit 0 ;;
  inspect)
    id="\${@: -1}"; line=$(awk -v i="$id" '$1==i' "$C"); st=$(echo "$line" | awk '{print $4}')
    err=""; [ "$st" = created ] && err='unable to start unit "libpod-0123.scope": Interactive authentication required'
    fmt="$3"; printf '%s|%s|%s\\n' "$st" "$err" "$id"; exit 0 ;;
  logs) echo "fake log line"; exit 0 ;;
  rm) name="\${@: -1}"; awk -v n="$name" '$2!=n' "$C" > "$C.t" && mv "$C.t" "$C"; exit 0 ;;
  run)
    name=""; prev=""; for a in "$@"; do [ "$prev" = --name ] && name="$a"; prev="$a"; done
    case "\${FAKE_SMOKE:-ok}" in
      systemd) echo "time=\\"x\\" level=warning msg=\\"failed to move the rootless netns slirp4netns process to the systemd user.slice: Process org.freedesktop.systemd1 exited with status 1\\"" >&2
               echo "Error: unable to start unit \\"libpod-abc.scope\\": Interactive authentication required." >&2
               echo "smoke1 $name smoke created" >> "$C"; exit 126 ;;
      netfail) echo "Error: failed to start rootlessport: cannot listen on the TCP port" >&2; exit 126 ;;
      *) echo "smoke1 $name smoke running" >> "$C"; echo smoke1; exit 0 ;;
    esac ;;
  pull)
    n=$(cat "${dir}/pull-count" 2>/dev/null || echo 0); n=$((n+1)); echo $n > "${dir}/pull-count"
    case "\${FAKE_PULL:-ok}" in
      ok) exit 0 ;;
      eof-once) [ $n -ge 2 ] && exit 0; echo "Error: writing blob: storing blob to file: happened during read: unexpected EOF" >&2; exit 125 ;;
      always-eof) echo "Error: copying system image: writing blob: unexpected EOF" >&2; exit 125 ;;
      auth) echo "Error: initializing source: reading manifest latest: unauthorized: authentication required" >&2; exit 125 ;;
    esac ;;
  build)
    tag=""; role=""; prev=""
    for a in "$@"; do [ "$prev" = -t ] && tag="$a"; [ "$prev" = -f ] && role="\${a%%/*}"; prev="$a"; done
    var="FAKE_BUILD_\${role}"; mode="\${!var:-ok}"
    n=$(cat "${dir}/build-\${role}-count" 2>/dev/null || echo 0); n=$((n+1)); echo $n > "${dir}/build-\${role}-count"
    case "$mode" in
      ok) echo "$tag" >> "${dir}/images"; exit 0 ;;
      eof-once) if [ $n -ge 2 ]; then echo "$tag" >> "${dir}/images"; exit 0; fi
                echo "Error: creating build container: writing blob: storing blob to file: unexpected EOF" >&2; exit 125 ;;
      always-eof) echo "Error: writing blob: unexpected EOF" >&2; exit 125 ;;
      curl60) echo "curl: (60) SSL certificate problem: self-signed certificate in certificate chain" >&2
              echo "FATAL: TLS verification failed for https://mirror.openshift.com/... (curl 60)." >&2; exit 1 ;;
      systemd) echo 'error running container: unable to start unit "runc-buildah-1.scope": Interactive authentication required.' >&2; exit 1 ;;
    esac ;;
esac
exit 0
`);
  // compose: like podman-compose 1.0.6 — "up" exits 0 even when the container did not start.
  write("fake-compose", `#!/bin/bash
echo "compose $*" >> "${dir}/calls"
C="${dir}/containers"
last=""; for a in "$@"; do case "$a" in config|ps|up|down) last="$a";; esac; done
case "$last" in
  config) for i in \${FAKE_COMPOSE_IMAGES:-${BACKEND} ${FRONTEND}}; do echo "    image: $i"; done
          echo "    ports:"; echo "      - \${FAKE_PORT:-127.0.0.1:4000:4000}" ;;
  ps) awk '$3!="smoke"{print $1}' "$C" ;;
  down) awk '$3=="smoke"' "$C" > "$C.t"; mv "$C.t" "$C" ;;
  up) svc="\${@: -1}"; var="FAKE_UP_\${svc}"; st="\${!var:-running}"
      [ "$st" = created ] && echo "Error: unable to start unit \\"libpod-1.scope\\": Interactive authentication required" >&2
      echo "id-$svc proj_\${svc}_1 $svc $st" >> "$C" ;;
esac
exit 0
`);
  write("curl", `#!/bin/bash
echo "curl $*" >> "${dir}/calls"
for a in "$@"; do case "$a" in
  */api/health) printf '%s' "\${FAKE_HEALTH_backend:-\${FAKE_HEALTH:-200}}"; exit 0 ;;
  http://127.0.0.1:180*) printf '%s' "\${FAKE_SMOKE_HTTP:-200}"; exit 0 ;;
  http://127.0.0.1:*/) printf '%s' "\${FAKE_HEALTH_frontend:-\${FAKE_HEALTH:-200}}"; exit 0 ;;
esac; done
printf 200; exit 0
`);
  write("systemctl", `#!/bin/sh
echo "systemctl $*" >> "${dir}/calls"
[ "\${FAKE_SYSTEMD_USER:-ok}" = ok ] && exit 0
echo "Failed to connect to bus: No medium found" >&2; exit 1
`);
  write("loginctl", "#!/bin/sh\necho no\n");
  write("ss", "#!/bin/sh\nexit 0\n");
  write("sleep", "#!/bin/sh\nexit 0\n");
}

function run(args, env = {}) {
  const r = spawnSync("bash", [SCRIPT, ...args], {
    encoding: "utf8",
    env: {
      PATH: `${path.join(dir, "bin")}:/usr/bin:/bin`, HOME: dir, TMPDIR: dir,
      OAA_COMPOSE: path.join(dir, "bin", "fake-compose"), OAA_BACKEND_IMAGE: BACKEND, OAA_FRONTEND_IMAGE: FRONTEND,
      OAA_RETRY_DELAY: "1", OAA_HEALTH_TIMEOUT: "2", OAA_DEPLOY_LOG_DIR: path.join(dir, "logs"),
      XDG_RUNTIME_DIR: path.join(dir, "xdg"), OAA_COMPOSE_PROJECT: "oaa-test", OAA_DEPLOY_STATE_DIR: path.join(dir, "state"), ...env
    }
  });
  return { ...r, out: `${r.stdout}${r.stderr}` };
}
/** A build record as `build` writes it (the fake image id is all zeros). */
const built = (status = "built") => {
  fs.mkdirSync(path.join(dir, "state"), { recursive: true });
  const id = status === "built" ? `sha256:${"0".repeat(64)}` : "-";
  fs.writeFileSync(path.join(dir, "state", "oaa-test.builds"), `backend ${status} ${id} 1\nfrontend built sha256:${"0".repeat(64)} 1\n`);
};
const calls = () => (fs.existsSync(path.join(dir, "calls")) ? fs.readFileSync(path.join(dir, "calls"), "utf8").trim().split("\n") : []);
const count = (re) => calls().filter((c) => re.test(c)).length;

beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), "oaa-deploy-test-")); fakes(); });
afterEach(() => {
  // Whatever happened, nothing destructive was ever issued.
  for (const c of calls()) {
    assert.doesNotMatch(c, /\b(prune|reset|migrate|rmi|volume rm)\b/, `destructive call: ${c}`);
    if (/^compose .*\bdown\b/.test(c)) assert.doesNotMatch(c, /\s-v\b|--volumes/, `down must keep volumes: ${c}`);
  }
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("build: exit codes are checked and failures are never followed by compose up", () => {
  test("a TLS failure inside the build (inspecting proxy) stops at once: not retried, classified, nothing started", () => {
    const r = run(["all"], { FAKE_BUILD_backend: "curl60" });
    assert.notEqual(r.status, 0);
    assert.match(r.out, /class: tls/);
    assert.match(r.out, /OAA_BUILD_CA/);
    assert.equal(count(/^podman build .*backend\/Containerfile/), 1, "TLS failures are not retried");
    assert.equal(count(/^podman build .*frontend\/Containerfile/), 0);
    assert.equal(count(/^compose .*\bup\b/), 0, "compose up must not run after a failed build");
  });
  test("a dropped CDN connection is retried and the deployment completes", () => {
    const r = run(["all"], { FAKE_BUILD_frontend: "eof-once" });
    assert.equal(r.status, 0, r.out);
    assert.equal(count(/^podman build .*frontend\/Containerfile/), 2);
    assert.match(r.out, /cdn01\.quay\.io/);
    const ups = calls().filter((c) => /^compose .*up -d --no-build/.test(c));
    assert.equal(ups.length, 2, "backend, then frontend");
    assert.match(ups[0], /up -d --no-build backend$/);
    assert.match(ups[1], /up -d --no-build --no-deps frontend$/);
    assert.match(r.out, /Deployment started and verified\./);
  });
  test("a CDN failure that persists is retried a bounded number of times, then stops before compose", () => {
    const r = run(["build"], { FAKE_BUILD_backend: "always-eof", OAA_RETRIES: "3" });
    assert.notEqual(r.status, 0);
    assert.equal(count(/^podman build .*backend\/Containerfile/), 3);
    assert.match(r.out, /nothing was started or replaced/);
  });
  test("missing systemd user session is recognised and explained", () => {
    const r = run(["build", "backend"], { FAKE_BUILD_backend: "systemd" });
    assert.notEqual(r.status, 0);
    assert.match(r.out, /class: systemd/);
    assert.match(r.out, /write-cgroupfs-override/);
    assert.equal(count(/^podman build/), 1);
  });
});

describe("pull: bounded retries, permanent failures stop", () => {
  test("EOF once then success", () => {
    const r = run(["pull"], { FAKE_PULL: "eof-once" });
    assert.equal(r.status, 0, r.out);
    assert.ok(count(/^podman pull /) >= 2);
  });
  test("refused credentials are not retried and are not called a TLS problem", () => {
    const r = run(["pull"], { FAKE_PULL: "auth" });
    assert.notEqual(r.status, 0);
    assert.equal(count(/^podman pull /), 1);
    assert.match(r.out, /class: auth/);
  });
});

describe("up: only images this script built, no silent replacement", () => {
  test("refuses when the images do not exist", () => {
    const r = run(["up"]);
    assert.notEqual(r.status, 0);
    assert.match(r.out, /run '.*build' first/);
    assert.equal(count(/^compose .*\bup\b/), 0);
  });
  test("refuses when compose names an image the script did not build", () => {
    fs.writeFileSync(path.join(dir, "images"), `${BACKEND}\n${FRONTEND}\n`); built();
    const r = run(["up"], { FAKE_COMPOSE_IMAGES: `${BACKEND} localhost/openshift-airgap-architect-frontend:latest` });
    assert.notEqual(r.status, 0);
    assert.match(r.out, /which this script did not build/);
    assert.equal(count(/^compose .*\bup\b/), 0);
  });
  test("existing containers of the project are replaced only with --recreate, keeping volumes", () => {
    fs.writeFileSync(path.join(dir, "images"), `${BACKEND}\n${FRONTEND}\n`); built();
    fs.writeFileSync(path.join(dir, "containers"), "id-backend proj_backend_1 backend created\n");
    const refused = run(["up"]);
    assert.notEqual(refused.status, 0);
    assert.match(refused.out, /already has containers \(any state\).*up --recreate/);
    assert.equal(count(/^compose .*\b(down|up)\b/), 0);
    const ok = run(["up", "--recreate"]);
    assert.equal(ok.status, 0, ok.out);
    const seq = calls().filter((c) => /^compose .*\b(down|up)\b/.test(c));
    assert.match(seq[0], /-p oaa-test .*\bdown$/, "down is scoped to the project");
    assert.match(seq[1], /up -d --no-build backend$/);
  });
});

describe("startup: the customer's libpod-scope failure and staged start", () => {
  const ready = () => { fs.writeFileSync(path.join(dir, "images"), `${BACKEND}\n${FRONTEND}\n`); built(); };
  test("images exist but the runtime cannot create the libpod scope: the smoke test stops it before any application container", () => {
    ready();
    const r = run(["up"], { FAKE_SMOKE: "systemd" });
    assert.notEqual(r.status, 0);
    assert.match(r.out, /class: systemd-runtime/);
    assert.match(r.out, /'--cgroup-manager' flag on 'podman compose' does NOT reach/);
    assert.match(r.out, /No application container was created/);
    assert.equal(count(/^compose .*\bup\b/), 0);
    assert.ok(calls().some((c) => /^podman rm -f oaa-deploy-smoke-/.test(c)), "the smoke container is removed");
    assert.equal(fs.readFileSync(path.join(dir, "containers"), "utf8").trim(), "", "nothing left behind");
  });
  test("rootless networking failure is reported as such, not as an application failure", () => {
    ready();
    const r = run(["smoke"], { FAKE_SMOKE: "netfail" });
    assert.notEqual(r.status, 0);
    assert.match(r.out, /class: rootless-network/);
  });
  test("a smoke container that runs but whose port is dead stops the deployment", () => {
    ready();
    const r = run(["up"], { FAKE_SMOKE_HTTP: "000" });
    assert.notEqual(r.status, 0);
    assert.match(r.out, /does not answer/);
    assert.equal(count(/^compose .*\bup\b/), 0);
  });
  test("backend stays Created (compose exit 0, as podman-compose 1.0.6 does): frontend is never attempted", () => {
    ready();
    const r = run(["up"], { FAKE_UP_backend: "created" });
    assert.notEqual(r.status, 0);
    assert.match(r.out, /backend is created \(compose exit 0/);
    assert.match(r.out, /class: systemd-runtime/);
    assert.match(r.out, /nothing after backend was started/);
    assert.equal(count(/^compose .*up .*frontend/), 0);
  });
  for (const state of ["configured", "stopping", "exited"]) {
    test(`a backend in state "${state}" is not success`, () => {
      ready();
      const r = run(["up"], { [`FAKE_UP_backend`]: state });
      assert.notEqual(r.status, 0);
      assert.match(r.out, new RegExp(`backend is ${state}`));
      if (state === "exited") assert.match(r.out, /class: app-exit/);
      assert.equal(count(/^compose .*up .*frontend/), 0);
    });
  }
  test("backend running but not answering HTTP is not ready; frontend not started", () => {
    ready();
    const r = run(["up"], { FAKE_HEALTH_backend: "000" });
    assert.notEqual(r.status, 0);
    assert.match(r.out, /'Up' is not ready/);
    assert.equal(count(/^compose .*up .*frontend/), 0);
  });
  test("a published port not bound to loopback is flagged", () => {
    ready();
    assert.match(run(["up"], { FAKE_PORT: "4000:4000" }).out, /not bound to 127\.0\.0\.1/);
  });
});

describe("stale images are never started silently", () => {
  const images = () => fs.writeFileSync(path.join(dir, "images"), `${BACKEND}\n${FRONTEND}\n`);
  test("after a failed build, up refuses the older image that still carries the tag", () => {
    images(); built("failed");
    const r = run(["up"]);
    assert.notEqual(r.status, 0);
    assert.match(r.out, /the last backend build failed; .* is an older image/);
    assert.equal(count(/^compose .*\bup\b/), 0);
    assert.equal(count(/^podman run/), 0);
  });
  test("a failed build is recorded by build itself", () => {
    run(["build", "backend"], { FAKE_BUILD_backend: "curl60" });
    assert.match(fs.readFileSync(path.join(dir, "state", "oaa-test.builds"), "utf8"), /^backend failed - /m);
  });
  test("images with no build record, or a tag that changed since the build, are refused unless explicitly allowed", () => {
    images();
    assert.match(run(["up"]).out, /no record of building/);
    fs.mkdirSync(path.join(dir, "state"), { recursive: true });
    fs.writeFileSync(path.join(dir, "state", "oaa-test.builds"), `backend built sha256:${"f".repeat(64)} 1\nfrontend built sha256:${"0".repeat(64)} 1\n`);
    assert.match(run(["up"]).out, /now points at .* not the image this script built/);
    const allowed = run(["up"], { OAA_ALLOW_PREVIOUS_IMAGE: "1" });
    assert.equal(allowed.status, 0, allowed.out);
  });
  test("a successful build records the image id that up then accepts", () => {
    const b = run(["build"]);
    assert.equal(b.status, 0, b.out);
    const r = run(["up"]);
    assert.equal(r.status, 0, r.out);
    assert.match(r.out, /backend image is the one built by this script/);
  });
});

describe("verify: state and HTTP decide, not 'Up'", () => {
  test("a running container whose port is dead fails verification and prints diagnostics", () => {
    fs.writeFileSync(path.join(dir, "containers"), "id-backend p_backend_1 backend running\nid-frontend p_frontend_1 frontend running\n");
    const r = run(["verify"], { FAKE_HEALTH: "000" });
    assert.notEqual(r.status, 0);
    assert.match(r.out, /did not answer 200/);
    assert.ok(calls().some((c) => /^curl --noproxy \*/.test(c)), "health checks must bypass the proxy");
  });
  test("a frontend that is only Created fails verification", () => {
    fs.writeFileSync(path.join(dir, "containers"), "id-backend p_backend_1 backend running\nid-frontend p_frontend_1 frontend created\n");
    const r = run(["verify"]);
    assert.notEqual(r.status, 0);
    assert.match(r.out, /frontend is created, not running/);
  });
});

describe("session and the compose-provider boundary", () => {
  test("no systemd user instance with an effective systemd cgroup manager blocks preflight and every container stage", () => {
    const pf = run(["preflight"], { FAKE_SYSTEMD_USER: "down" });
    assert.notEqual(pf.status, 0);
    assert.match(pf.out, /\[BLOCK\] effective cgroup manager is systemd/);
    fs.writeFileSync(path.join(dir, "images"), `${BACKEND}\n${FRONTEND}\n`); built();
    for (const stage of [["build"], ["smoke"], ["up"]]) {
      const r = run(stage, { FAKE_SYSTEMD_USER: "down" });
      assert.notEqual(r.status, 0, stage[0]);
      assert.match(r.out, /cannot run in this session/);
    }
    assert.equal(count(/^podman (build|run)/), 0);
    assert.equal(count(/^compose .*\bup\b/), 0);
    assert.notEqual(run(["all"], { FAKE_SYSTEMD_USER: "down" }).status, 0);
    assert.equal(count(/^podman build/), 0, "all stops at preflight");
  });
  test("an effective cgroupfs override (the verified workaround) passes without a systemd user instance, with its limits stated", () => {
    const r = run(["preflight"], { FAKE_SYSTEMD_USER: "down", FAKE_CGM: "cgroupfs", CONTAINERS_CONF_OVERRIDE: path.join(dir, "o.conf") });
    assert.equal(r.status, 0, r.out);
    assert.match(r.out, /effective cgroup manager: cgroupfs \(CONTAINERS_CONF_OVERRIDE=/);
    assert.match(r.out, /no cgroup resource limits/);
  });
  test("an override that does not take effect is not trusted: the effective manager decides", () => {
    const r = run(["preflight"], { FAKE_SYSTEMD_USER: "down", FAKE_CGM: "systemd", CONTAINERS_CONF_OVERRIDE: path.join(dir, "ignored.conf") });
    assert.notEqual(r.status, 0);
    assert.match(r.out, /\[BLOCK\] effective cgroup manager is systemd \(CONTAINERS_CONF_OVERRIDE=/);
  });
  test("podman options on the podman/compose command are refused: they do not reach the provider's podman", () => {
    const a = run(["preflight"], { OAA_COMPOSE: `podman --cgroup-manager=cgroupfs compose` });
    assert.notEqual(a.status, 0);
    assert.match(a.out, /not forwarded to the provider's nested podman calls/);
    const b = run(["preflight"], { OAA_PODMAN: "podman --cgroup-manager=cgroupfs" });
    assert.match(b.out, /options given to this podman do not reach the compose provider/);
  });
  test("an unset or foreign XDG_RUNTIME_DIR is not healthy", () => {
    const unset = run(["preflight"], { XDG_RUNTIME_DIR: "" });
    assert.notEqual(unset.status, 0);
    assert.match(unset.out, /\[BLOCK\] XDG_RUNTIME_DIR is not set/);
    const missing = run(["preflight"], { XDG_RUNTIME_DIR: path.join(dir, "nope") });
    assert.notEqual(missing.status, 0);
    assert.match(missing.out, /\[BLOCK\] XDG_RUNTIME_DIR=.* is missing, not owned/);
    assert.match(missing.out, /not su \/ sudo -i/);
  });
  test("proxy credentials are never printed", () => {
    const r = run(["preflight"], { HTTPS_PROXY: "http://alice:s3cret@proxy.corp:8080" });
    assert.doesNotMatch(r.out, /s3cret|alice/);
    assert.match(r.out, /http:\/\/\*\*\*@proxy\.corp:8080/);
  });
});

describe("classification of the customer's errors", () => {
  const cls = (text, stage = "build") => {
    const f = path.join(dir, "msg.log"); fs.writeFileSync(f, text);
    const r = spawnSync("bash", ["-c", `source <(sed -n '/^classify() {/,/^}/p' "${SCRIPT}"); classify "${f}" ${stage}`], { encoding: "utf8" });
    return r.stdout.trim();
  };
  test("build-time and runtime systemd scope failures are distinguished", () => {
    assert.equal(cls('unable to start unit "runc-buildah-12.scope": Interactive authentication required'), "systemd-build");
    assert.equal(cls('Error: unable to start unit "libpod-ab.scope": Interactive authentication required'), "systemd-runtime");
    assert.equal(cls("Interactive authentication required", "runtime"), "systemd-runtime");
  });
  test("the slirp4netns user.slice warning alone is not a cause; session, network, volume, FIPS each have their own class", () => {
    assert.equal(cls("failed to move the rootless netns slirp4netns process to the systemd user.slice: Process org.freedesktop.systemd1 exited with status 1"), "unknown");
    assert.equal(cls("Failed to obtain podman configuration: lstat /run/user/1001: no such file or directory"), "session");
    assert.equal(cls("Error: failed to start rootlessport: cannot expose privileged port"), "rootless-network");
    assert.equal(cls("Error: lsetxattr /home/u/data: operation not supported"), "volume-permission");
    assert.equal(cls("crypto/rsa: 1024-bit keys are not allowed in FIPS mode"), "fips");
    assert.equal(cls("Error: rootlessport listen tcp 127.0.0.1:4000: bind: address already in use"), "port-conflict");
    assert.equal(cls("Error: localhost/x:latest: image not known"), "image-missing");
    assert.equal(cls("Error: OCI runtime error: exit status 125"), "unknown", "exit codes alone are not classified");
  });
});

describe("build CA: given as a secret, never as an arg, never from inside the repo", () => {
  test("a CA outside the repository is passed as --secret id=oaa_build_ca,…,type=file", () => {
    const ca = path.join(dir, "corp-ca.pem");
    fs.writeFileSync(ca, "-----BEGIN CERTIFICATE-----\nMIIBfake\n-----END CERTIFICATE-----\n");
    const r = run(["build"], { OAA_BUILD_CA: ca });
    assert.equal(r.status, 0, r.out);
    const builds = calls().filter((c) => /^podman build/.test(c));
    assert.equal(builds.length, 2);
    for (const b of builds) {
      assert.match(b, new RegExp(`--secret id=oaa_build_ca,src=${ca.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")},type=file`));
      // The variable NAME must not carry a CA. (Matching the whole argument case-insensitively also
      // hit the commit hash in APP_GIT_SHA=<hex>, e.g. "9cae978", and failed on some commits only.)
      assert.doesNotMatch(b, /--build-arg [A-Za-z0-9_]*(CA|CERT|PEM)[A-Za-z0-9_]*=/i);
      assert.doesNotMatch(b, /--build-arg [^ =]+=[^ ]*\.(pem|crt)\b/i, "no certificate file passed as a build argument");
    }
  });
  test("refused: inside the repository, with a private key, or not a certificate", () => {
    const inRepo = path.join(REPO, "scripts", `oaa-test-ca-${process.pid}.pem`);
    fs.writeFileSync(inRepo, "-----BEGIN CERTIFICATE-----\nx\n-----END CERTIFICATE-----\n");
    try {
      assert.match(run(["build"], { OAA_BUILD_CA: inRepo }).out, /outside the repository/);
    } finally { fs.rmSync(inRepo, { force: true }); }
    const key = path.join(dir, "bundle.pem");
    fs.writeFileSync(key, "-----BEGIN CERTIFICATE-----\nx\n-----END CERTIFICATE-----\n-----BEGIN PRIVATE KEY-----\ny\n-----END PRIVATE KEY-----\n");
    assert.match(run(["build"], { OAA_BUILD_CA: key }).out, /PRIVATE KEY/);
    const junk = path.join(dir, "junk.pem");
    fs.writeFileSync(junk, "hello");
    assert.match(run(["build"], { OAA_BUILD_CA: junk }).out, /no PEM certificate/);
    assert.equal(count(/^podman build/), 0);
  });
});

describe("preflight and the cgroupfs workaround", () => {
  test("preflight is read-only even when it blocks", () => {
    run(["preflight"], { FAKE_SYSTEMD_USER: "down" });
    assert.equal(count(/^podman (build|pull|run|rm|stop|create|start)/), 0);
    assert.equal(count(/^compose (?!version$|--version$)/), 0, "only version queries");
  });
  test("podman that cannot read its configuration (su without a session) stops preflight with the reason", () => {
    const r = run(["preflight"], { FAKE_INFO_FAIL: "1" });
    assert.notEqual(r.status, 0);
    assert.match(r.out, /podman cannot start for this user: Failed to obtain podman configuration/);
    assert.match(r.out, /su/);
  });
  test("CONTAINERS_CONF is flagged as replacing all configuration", () => {
    assert.match(run(["preflight"], { CONTAINERS_CONF: "/etc/x.conf" }).out, /prefer CONTAINERS_CONF_OVERRIDE/);
  });
  test("write-cgroupfs-override writes a layered override and never overwrites", () => {
    const f = path.join(dir, "override.conf");
    const r = run(["write-cgroupfs-override", f]);
    assert.equal(r.status, 0);
    assert.match(fs.readFileSync(f, "utf8"), /\[engine\]\ncgroup_manager = "cgroupfs"/);
    assert.match(r.out, /export CONTAINERS_CONF_OVERRIDE=/);
    assert.notEqual(run(["write-cgroupfs-override", f]).status, 0);
  });
});

describe("Containerfiles and build context: build CA support cannot silently regress", () => {
  const runSteps = (file) => fs.readFileSync(path.join(REPO, file), "utf8")
    .split("\n").filter((l) => !/^\s*#/.test(l)).join("\n")
    .split(/\n(?=RUN |FROM |COPY |ARG |ENV |USER |WORKDIR |LABEL |EXPOSE |CMD |ENTRYPOINT )/)
    .filter((s) => s.startsWith("RUN "));
  for (const file of ["backend/Containerfile", "frontend/Containerfile"]) {
    test(`${file}: every networked RUN mounts the optional oaa_build_ca secret`, () => {
      const networked = runSteps(file).filter((s) => /\b(dnf|microdnf)\s+install\b|\bcurl\b|\bnpm\s+ci\b/.test(s));
      assert.ok(networked.length > 0);
      for (const s of networked) {
        assert.match(s, /^RUN --mount=type=secret,id=oaa_build_ca,required=false,mode=0444/, s.slice(0, 120));
        assert.match(s, /oaa-build-ca\.pem/, "the temporary bundle is built in the step");
        assert.match(s, /rm -[rf]+ [^\n]*\/tmp\/oaa-build-ca\.pem/, "and removed in the same step");
      }
    });
    test(`${file}: no CA or proxy credential is passed as a build ARG`, () => {
      // Whole name components: CA, CERT(S), TRUST, PROXY — not CANDIDATE or CACHE.
      assert.doesNotMatch(fs.readFileSync(path.join(REPO, file), "utf8"), /^ARG\s+(?:\w+_)?(?:CA|CERTS?|TRUST|PROXY)(?:_\w+)?(?:=|\s|$)/im);
    });
  }
  test(".dockerignore keeps certificates and keys out of the build context", () => {
    const ignore = fs.readFileSync(path.join(REPO, ".dockerignore"), "utf8").split("\n").map((l) => l.trim());
    for (const p of ["**/*.pem", "**/*.crt", "**/*.key"]) assert.ok(ignore.includes(p), p);
  });
});
