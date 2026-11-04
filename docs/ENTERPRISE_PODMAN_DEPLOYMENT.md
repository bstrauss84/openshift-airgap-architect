# Enterprise Podman deployment (RHEL 9, FIPS, corporate proxy)

**Scope:** building and running OpenShift Airgap Architect with Podman on hardened enterprise hosts —
RHEL 9 with Podman 4.9 and podman-compose 1.0.6, FIPS mode, an HTTPS-inspecting corporate proxy,
restrictive umask, rootless users. It replaces the one-line `compose down && image prune && compose up
--build` flow as the recommended path on such hosts.

**Tooling:** [`scripts/deploy/oaa-deploy.sh`](../scripts/deploy/oaa-deploy.sh). Every stage can be run on
its own; none prunes images, resets storage, deletes volumes or touches other projects' containers.

## 1. Why the one-liner fails on these hosts

| Observed | Cause | What the script does |
|---|---|---|
| Both image builds fail, then compose tries to run `localhost/…:latest` images that do not exist | podman-compose 1.0.6 ignores a failed `podman build` and runs the image name anyway (and exits 0) | Builds each image with `podman build`, checks the exit status and the resulting image, and only then runs `compose up -d --no-build` |
| `curl: (60) SSL certificate problem: self-signed certificate in certificate chain` while building the backend | The inspecting proxy re-signs `mirror.openshift.com`; `curl` inside the build trusts only the UBI image's CAs. Trust on the **build host** does not reach a `RUN` step | Passes your proxy CA to the build as a **secret** (`OAA_BUILD_CA`) |
| `unable to start unit "runc-buildah-….scope": Interactive authentication required` | Rootless Podman with `cgroup_manager = "systemd"` and no systemd user session (typically `su`/`sudo -i`) | Preflight detects it; a documented temporary `cgroupfs` override is available |
| `failed to move the rootless netns slirp4netns process to the systemd user.slice` | Same missing user session; logged, not fatal | Preflight explains it; `verify` checks real HTTP reachability |
| `writing blob: … unexpected EOF` from `cdn01.quay.io` | Image layers are served by Quay's CDN; a proxy or firewall dropped the transfer. Podman 4.9 accepts `build --retry` but ignores it, and has no `pull --retry` | Bounded outer retries for transient failures only; CDN allow-list hint |
| Images built, but `podman --cgroup-manager=cgroupfs compose up -d` fails: `unable to start unit "libpod-….scope": Interactive authentication required` (plus a `slirp4netns … user.slice` warning) | The wrapper's global flag never reaches the compose provider's own `podman run` calls (§5.1), which still use systemd scopes without a usable user session. podman-compose 1.0.6 then reports success and tries the frontend anyway | Preflight blocks on the *effective* cgroup manager and session; a runtime smoke container must start before any application container; backend first, frontend only after the backend is running and answering HTTP |
| The running app is gone and the new one never came up | The one-liner removes containers and prunes images before knowing the new build works | Builds first; replaces running containers only with an explicit `up --recreate`, after both images exist |

## 2. The staged procedure

```bash
cd openshift-airgap-architect
scripts/deploy/oaa-deploy.sh preflight          # read-only host checks
scripts/deploy/oaa-deploy.sh images             # which UBI base images are needed / present
scripts/deploy/oaa-deploy.sh pull               # optional: pre-pull them, bounded retries
OAA_BUILD_CA=/etc/pki/corp/proxy-ca.pem \
  scripts/deploy/oaa-deploy.sh build            # backend, then frontend; stops at the first failure
scripts/deploy/oaa-deploy.sh smoke              # optional on its own: one throwaway container proves the runtime can start containers
scripts/deploy/oaa-deploy.sh up                 # smoke, then backend (running + HTTP), then frontend; no rebuild
scripts/deploy/oaa-deploy.sh verify             # container state + HTTP for both
# or everything:  OAA_BUILD_CA=… scripts/deploy/oaa-deploy.sh all --pull
```

Updating an existing deployment: `build`, then `up --recreate` (stops the old containers only after both new
images exist; the `backend-data` volume is kept), then `verify`. Nothing is pruned; remove old images yourself
when you no longer need to roll back (`podman images`, `podman rmi <id>`).

Run the script **as the user that will own the containers**, in a real login session (ssh or console). Images
built by root are not visible to rootless users and vice versa; do not mix the two.

### Stage reference

| Stage | Reads | Changes |
|---|---|---|
| `preflight` | `podman --version`, `podman info` (rootless, storage, OCI runtime, cgroup manager and version, network backend, events logger), systemd user session, `loginctl` linger, `CONTAINERS_CONF*`, FIPS flag, umask, proxy variables (credentials redacted), the build CA file, ports, existing `*airgap-architect*` containers, free space, HTTPS reachability of `registry.access.redhat.com`, `cdn01.quay.io`, `mirror.openshift.com`, `registry.npmjs.org` | nothing |
| `images` | base images named in the Containerfiles | nothing |
| `pull` | — | pulls those base images |
| `build` | — | builds two images with the tags compose uses |
| `smoke` | the effective runtime | runs one container `oaa-deploy-smoke-*` from the backend image with a published loopback port, checks HTTP, removes exactly that container |
| `up` | the build record (each image must be the one `build` produced for this project — never an older image left behind by a failed build; `OAA_ALLOW_PREVIOUS_IMAGE=1` overrides deliberately), `compose config` (images must be the two just built; ports should bind 127.0.0.1), the project's existing containers | smoke; `compose up -d --no-build backend`, requires state `running` and HTTP 200; then `compose up -d --no-build --no-deps frontend`, same checks. With `--recreate`, first `compose down` of this project only (volumes kept) |
| `verify` | container state (`running` only) and HTTP status of the two URLs, through no proxy | nothing |

Configuration is by environment variable; see the header of the script (`OAA_BUILD_CA`, `OAA_BACKEND_IMAGE`,
`OAA_FRONTEND_IMAGE`, `OAA_COMPOSE_FILES`, `OAA_COMPOSE_PROJECT`, `OAA_BACKEND_URL`, `OAA_FRONTEND_URL`,
`OAA_RETRIES`, `OAA_RETRY_DELAY`, `OAA_HEALTH_TIMEOUT`).

### Reading a failure

Every failure names a class, the layer that is most likely responsible and the next safe step. The script never
classifies by an exit code such as 125 or 126 alone; it reads the primary error.

| Class | Typical stage | Layer | Next step |
|---|---|---|---|
| `tls` | pull, build | customer network (inspecting proxy) | proxy CA in host trust (pulls) and `OAA_BUILD_CA` (build) — §3 |
| `proxy-auth` | pull, build | customer proxy | credentials in `HTTPS_PROXY` |
| `transient` | pull, build | network / Quay CDN path | allow the CDN hosts (§4); bounded retries already applied |
| `fips` | any (only on an explicit FIPS rejection) | customer crypto policy / certificate | replace the rejected certificate or algorithm; do not disable FIPS |
| `session` | preflight, any | customer login/session | log in directly (ssh/console), or administrator enables lingering — §5 |
| `systemd-build` | build | customer session/systemd | §5.3 |
| `systemd-runtime` | smoke, up | customer session/systemd | §5.3; then `up --recreate` |
| `rootless-network` | smoke, up | customer host networking | §5.4 |
| `port-conflict` | smoke, up | host | free the port or change the host port |
| `volume-permission` | up | host storage / SELinux | `:Z` on added bind mounts, directory ownership |
| `image-missing` | up | deployment step | `build` as the same user (rootful and rootless stores differ) |
| `auth`, `not-found`, `integrity`, `arch` | pull, build | registry / content | as printed; never retried |
| `app-exit` | up | OAA application or its configuration | the container log; volume permissions; override environment |

## 3. Certificate trust: three separate places

An inspecting proxy has to be trusted in **three** places, and each is configured differently. Trusting it in
one does not make the others work.

| Where | Who connects | How to trust the proxy CA |
|---|---|---|
| **Host** | `podman pull` / `podman build` fetching the UBI base images | The host trust store: copy the CA to `/etc/pki/ca-trust/source/anchors/` and run `update-ca-trust` (root), or per registry `/etc/containers/certs.d/registry.access.redhat.com/ca.crt` |
| **Build** | `dnf`, `curl` (oc / oc-mirror download), `npm ci` inside `RUN` steps | `OAA_BUILD_CA=<pem>` — the script passes it as `podman build --secret id=oaa_build_ca,src=<pem>,type=file`. It is mounted only during the networked steps, combined with the image's system bundle into a temporary file, and deleted in the same step: it is **not** in any layer, the history or the exported runtime package. Never pass a CA as `--build-arg` (build args are recorded in the image history) |
| **Runtime** | The backend container: Node (Cincinnati, downloads), OAA's verified catalog downloads, `oc-mirror`, `oc`, `curl` | Mount the CA read-only and point the backend at it — see §3.1 |

Rules the tooling enforces: the CA file must be outside the repository (so it can never be committed or copied
into the build context); it must contain certificates only (a private key is refused); `.gitignore` and
`.dockerignore` exclude `*.pem`, `*.crt` and `*.key`.

### 3.1 Runtime CA (backend)

`compose.override.yml` next to `docker-compose.yml` (add `:Z` on SELinux hosts):

```yaml
services:
  backend:
    volumes:
      - /etc/pki/corp/proxy-ca.pem:/etc/oaa-trust/corp-ca.pem:ro,Z
    environment:
      - SSL_CERT_FILE=/etc/oaa-trust/corp-ca.pem        # Go (oc-mirror, oc) and OAA's verified catalog downloads
      - NODE_EXTRA_CA_CERTS=/etc/oaa-trust/corp-ca.pem  # Node fetch (Cincinnati, tool downloads)
      - HTTPS_PROXY=http://proxy.corp.example:8080
      - HTTP_PROXY=http://proxy.corp.example:8080
      - NO_PROXY=localhost,127.0.0.1
```

`SSL_CERT_FILE` replaces only the bundle *file*; the image's certificate directories (which on UBI contain the
system bundle) are still read, so public CAs stay trusted. Use the override with the script by setting
`OAA_COMPOSE_FILES=docker-compose.yml:compose.override.yml`.

## 4. Proxy and allow-list

Build and runtime need, through the proxy or directly:

| Host | Needed for |
|---|---|
| `registry.access.redhat.com` | UBI base images (build host) |
| `cdn.quay.io`, `cdn01.quay.io` … `cdn06.quay.io` | **image layers** for the above (Red Hat article 7084334). A dropped CDN transfer shows as `unexpected EOF`, not as a credentials or tag problem |
| `cdn-ubi.redhat.com` | `dnf` / `microdnf` inside the builds |
| `mirror.openshift.com` | `oc` / `oc-mirror` downloads in the backend build and at runtime |
| `registry.npmjs.org` | `npm ci` inside the builds |
| `nodejs.org`, `github.com` | backend build: the native SQLite module's install contacts them (Node headers for its compile; a prebuilt-binary attempt). Observed through the inspecting proxy during the validated build |
| `registry.redhat.io`, `quay.io` | runtime: operator catalogs and mirroring (see README for the full runtime list) |

Proxy credentials go in `HTTPS_PROXY` (`http://user:pass@proxy:port`); the script redacts them in its output. A
`407` is a proxy-credentials problem; a `401`/`403` from a registry is a registry-credentials problem; a
certificate error is a trust problem. The script classifies each and retries only transient transport failures
(connection reset, timeout, truncated body, `429`/`5xx`) — never certificate, authentication, not-found,
architecture or integrity failures. Retries are bounded (`OAA_RETRIES`, default 3, at most 10) with doubling delay.

## 5. systemd, cgroups, sessions and rootless networking

Rootless Podman on RHEL 9 defaults to `cgroup_manager = "systemd"`: every container (and every build step) gets
a transient systemd scope in the **user's** systemd instance, reached over the session D-Bus at
`$XDG_RUNTIME_DIR/bus`. That instance exists for a real login session (ssh or console) — not for `su` or
`sudo -i`, which keep the original user's environment or none. Without it, scope creation needs polkit
authorization and fails with *Interactive authentication required*:

- during a build: `unable to start unit "runc-buildah-….scope"`;
- when starting containers: `unable to start unit "libpod-….scope"`, often preceded by the non-fatal warning
  `failed to move the rootless netns slirp4netns process to the systemd user.slice`.

**A successful build does not prove containers can start.** Builds and container starts create different
scopes; a workaround that let the build through may not be in effect for the containers.

### 5.1 Compose providers do not inherit `podman` options

`podman compose` is a wrapper. In Podman 4.9.4 (`cmd/podman/compose.go`) it runs the external provider
(podman-compose, docker-compose) with the current **environment** plus `DOCKER_HOST`, `DOCKER_BUILDKIT` and
`DOCKER_CONFIG`, and with only the arguments that follow `compose`. A global option such as
`podman --cgroup-manager=cgroupfs compose up` is consumed by the wrapper; the provider's own `podman run`
calls never see it and use the configured default. Environment variables — `CONTAINERS_CONF_OVERRIDE` among
them — are inherited by the provider and by every `podman` it starts. (Demonstrated on Podman 5.8.7: the flag
on the wrapper left the provider's `podman` at `systemd`; the exported override switched it to `cgroupfs`.)

The deploy script therefore refuses podman options in `OAA_PODMAN` / `OAA_COMPOSE`, and checks the setting
nested calls will actually use.

### 5.2 Check the effective cgroup manager and the session

Run these **in the shell that will deploy** (they read; they change nothing):

```bash
podman info --format '{{.Host.CgroupManager}} rootless={{.Host.Security.Rootless}}'   # what nested podman calls will use
echo "$XDG_RUNTIME_DIR"; ls -ld "$XDG_RUNTIME_DIR"                                     # must exist, be yours, mode 0700
systemctl --user show-environment >/dev/null && echo "user systemd reachable"           # needed when the manager is systemd
loginctl show-user "$(id -un)" -p Linger -p State
```

`scripts/deploy/oaa-deploy.sh preflight` performs the same checks and blocks (`[BLOCK]`) building, smoke and
startup when they fail.

### 5.3 What to do

1. **Supported path — a proper login session.** Log in as the deploying user directly (ssh or console). If the
   containers must keep running after logout, an administrator enables lingering for that user
   (`loginctl enable-linger <user>`). Changing PAM, polkit, systemd or SELinux policy is an administrator
   decision; the script never does it.
2. **Temporary workaround — only where verified.** A layered override switches this shell (and every process
   it starts, including the compose provider) to `cgroupfs`:
   ```bash
   scripts/deploy/oaa-deploy.sh write-cgroupfs-override ~/oaa-cgroupfs.conf
   export CONTAINERS_CONF_OVERRIDE=~/oaa-cgroupfs.conf
   podman info --format '{{.Host.CgroupManager}}'      # must print cgroupfs, or the override did not take effect
   scripts/deploy/oaa-deploy.sh preflight && scripts/deploy/oaa-deploy.sh smoke
   ```
   Limitations — this is not a permanent configuration:
   - rootless containers under `cgroupfs` get **no cgroup resource limits**, and they are not tracked by the
     user's systemd (they may be stopped at logout unless the session persists — not verified);
   - `CONTAINERS_CONF_OVERRIDE` must be exported in **every** shell that manages these containers (start, stop,
     logs) — a later shell without it uses systemd again;
   - do **not** use `CONTAINERS_CONF`, which replaces every `containers.conf` and discards site policy.
   On Podman 4.9.4-rhel this workaround is **UNVERIFIED** by OAA testing (established from upstream sources at
   the vendored containers/common version and demonstrated on Podman 5.8.7); prefer the supported path.
3. **After switching cgroup manager, recreate the containers.** A container keeps the cgroup manager it was
   created with. Containers left in `Created` by a failed start must be replaced:
   `scripts/deploy/oaa-deploy.sh up --recreate` — it removes only the containers of this deployment's compose
   project (volumes kept).

### 5.4 Rootless networking

A container can show `Up` while rootless port forwarding is broken. The smoke stage and `verify` check the
published ports over HTTP and report a rootless-network failure separately from an application failure.

### 5.5 Collecting diagnostics for Red Hat support

Collect from the deploying user's shell and review before sending (proxy credentials and tokens must not be
included; the script redacts them in its own output):

```bash
podman version; podman info                      # host, storage, cgroup manager, network backend
loginctl show-user "$(id -un)"; systemctl --user status 2>&1 | head -20
echo "XDG_RUNTIME_DIR=$XDG_RUNTIME_DIR"; env | grep -iE '^(https?|no)_proxy=' | sed -E 's#(://)[^/@]*@#\1***@#'
scripts/deploy/oaa-deploy.sh preflight 2>&1 | tee oaa-preflight.txt
journalctl --user -n 100 --no-pager 2>/dev/null   # user systemd messages, if available
```

Add the failing stage's log from `${TMPDIR:-/tmp}/oaa-deploy-<uid>/`. For a support case, Red Hat may also ask
for an `sos report` from the host (administrator).

### 5.6 Failed or partially created containers

`podman ps -a --filter label=com.docker.compose.project=<project>` shows this deployment's containers only.
`Created`, `Exited` or `stopping` after a start means the start failed even if podman-compose returned 0. Read
the stage's log and the container's own log (`podman logs <name>`), fix the cause, then
`scripts/deploy/oaa-deploy.sh up --recreate` — it removes only this project's containers and keeps the data
volume. Do not remove other containers, prune, or reset to get a clean state.

## 6. FIPS and umask

- **FIPS:** keep FIPS enabled. Nothing here needs it relaxed and no privileged container is used. Podman
  propagates FIPS mode into the containers; corporate CAs signed with algorithms FIPS rejects will fail TLS
  inside them — replace such a CA rather than weakening the host.
- **Restrictive umask (077):** a checkout made under it has files only its owner can read, and `COPY` keeps
  those modes. Both images normalise permissions after copying (read for all, traverse on directories; no
  write), so the non-root application user — and OpenShift's arbitrary UID — can read the application.
  Bind mounts you add keep their host modes: use `:U` or set modes explicitly.

## 7. Never in the deployment path

`podman system reset`, `podman system migrate`, `podman image prune`, `podman volume prune`, `podman network
prune` and `compose down -v` are not part of deploying or updating OAA. They act on **every** image, container,
volume or network of that user — other applications' included — and cannot be undone. `system reset` in particular removes
**every** image, container and volume of that user (all projects, not just this one) and can disrupt the
rootless network of containers that are still running.

## 8. Validated

On a Podman 5.8.7 / podman-compose 1.6 host, in isolated storage with non-production image names, a separate
compose project and separate ports (2026-10-30):

- A TLS-inspecting proxy re-signing every HTTPS connection with a throwaway CA sat between the builds and the
  Internet; the source tree had umask-077 modes (files 0600, directories 0700).
- **Without** `OAA_BUILD_CA` the backend build failed at its first networked step with
  `SSL certificate problem` (curl 60), was classified as a trust problem and was not retried.
- **With** `OAA_BUILD_CA` both images built through the proxy: `dnf`, `microdnf`, `curl` and `npm ci` (10 steps)
  used the secret; the proxy saw `cdn-ubi.redhat.com`, `mirror.openshift.com`, `registry.npmjs.org`,
  `nodejs.org`, `github.com`. Neither image contains the CA in any file or in its history.
- In the backend image the copied sources are readable (0644) despite the 0600 tree.
- `up` started the project with the just-built images only, `verify` got HTTP 200 from both ports, and a second
  `up` without `--recreate` was refused.

**Startup follow-up (same host, 2026-10-30):** the compose-provider boundary (§5.1) was demonstrated — the flag on
`podman compose` left the provider's `podman` at `systemd`, the exported override switched it to `cgroupfs`; a
session with an invalid `XDG_RUNTIME_DIR` was blocked by preflight; with a backend that exits, `up` stopped after
the backend (podman-compose returned 0) and no frontend container was created; with the built images, smoke,
backend (running + HTTP 200) and frontend (running + HTTP 200) passed and only that project was cleaned up. The
customer's exact `libpod-….scope` failure needs a host without a user session and could not be reproduced here;
the script's handling of it is covered by tests with the customer's error text.

`dnf`, `microdnf`, `curl` and `npm` run inside the UBI images, so those steps behave the same on any host. The
procedure targets Podman 4.9.4 / podman-compose 1.0.6; where those differ from the validation host (compose
ignoring build failures, `build --retry` ignored, secret-mount options) the behaviour was established from
those versions' sources and is handled by the script. It has not yet been run on a
Podman 4.9.4-rhel host; run `preflight` there first.

## 9. Mirroring storage on its own volume

Mirroring content — archive files, oc-mirror's workspace (incremental history) and cache, received transfers and
each run's plan — can be hundreds of GB. By default it lives in the data volume under `DATA_DIR/oc-mirror`. As in
the Install workflow's Run oc-mirror step, a profile can use any directory the server can write; a separate disk is
mounted into the container and chosen there.

1. Create the host directory and give the container user access. Rootless Podman maps container UID 1001 to a
   subordinate UID, so change ownership from inside the user namespace:
   ```bash
   sudo mkdir -p /data/mirror && sudo chown "$(id -un):" /data/mirror
   podman unshare chown 1001:0 /data/mirror
   ```
   (or add `:U` to the mount). The entrypoint does **not** change ownership of this volume; a recursive `chown`
   of a large customer mount on every start would be slow and is not the application's to do.
2. Mount it (a Compose override keeps the shipped file unchanged):
   ```yaml
   services:
     backend:
       volumes:
         - /data/mirror:/mnt/mirror-data:Z     # :Z private SELinux label; :z if another container shares it
       # optional default for new profiles:
       # environment:
       #   - OAA_MIRROR_STORAGE_ROOT=/mnt/mirror-data
   ```
3. Recreate the backend (`scripts/deploy/oaa-deploy.sh up --recreate`).
4. In the profile's **Storage and run options** card type `/mnt/mirror-data` — the **container** path; the server
   never sees `/data/mirror` — or pick it from the suggested volumes (mount points the server can write). A missing
   last folder such as `/mnt/mirror-data/site-a` is created.
5. Check: the card shows the location, its free space and the effective paths; the preflight item **Storage** checks —
   as the server's own user — that it exists, is not a symbolic link, can be read and written (a real write, which
   also catches SELinux and read-only mounts), and warns below 10 GiB free.

Layout under any location: `profiles/<id>/archives/sets/<plan>/` (each successful mirror to disk; the top of
`archives/` holds only oc-mirror's working-dir), `profiles/<id>/plans/<plan>/`, `profiles/<id>/received/<plan>/`,
`profiles/<id>/workspace/`, `profiles/<id>/cache/`.

Rules that keep history and transfers safe:

- **Chosen before anything is written.** The location can be changed while a profile has no runs, transfers,
  receipts or imports and nothing is running; after that it is fixed. Nothing is ever moved.
- **Refused locations:** relative paths, `/`, system directories (`/etc`, `/usr`, `/proc`, …), the application's own
  directory, another profile's directory, symbolic links, and anything the server's user cannot write.
- **No fallback.** If a profile's location later disappears (an unmounted volume), its runs, transfer preparation
  and receipts are blocked with the reason; nothing is written to `DATA_DIR` instead, and nothing is redirected.
- **Transfers on the volume.** A transfer copied under a profile's location can be received from there; every file
  is still verified, and a folder that is an already-received copy is refused.
- Moving an existing profile's content is a manual, offline operation that is not automated: oc-mirror's workspace
  history and cache must move together, and plans record absolute paths.

`OAA_MIRROR_STORAGE_ROOT` only sets the default location for new profiles (read at start-up).

**Design notes (not implemented):** separate locations for the cache and for archives were considered. oc-mirror's
incremental history (`working-dir/.history`) lives in the mirror-to-disk destination, and the cache must persist
with it; an archive folder on removable media would also bypass the per-run archive sets that protect transfers.
