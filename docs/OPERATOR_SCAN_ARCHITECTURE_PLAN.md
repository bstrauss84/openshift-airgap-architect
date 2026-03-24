# Operator scan: OS/CPU architecture and oc-mirror

> Authority: Working architecture plan and historical context
> Canonical product behavior source: `README.md` (Platform and architecture)
> Canonical status source: `docs/BACKLOG_STATUS.md`

**Purpose:** Document the Operator scan failure on Apple Silicon (and other non-x86_64 hosts), root cause, and a plan to fix it while moving toward an **OS/CPU architecture–agnostic** posture for the app.

**Status:** Plan only. Implementation is tracked here; code and compose changes are done in separate work.

**Rollback (current state):** The forced-**linux/amd64** workaround (Phase 1 in §4 below) was implemented but has been **rolled back**. On Apple Silicon, oc-mirror **segfaults under amd64 emulation**, so that workaround is not reliable. The compose file no longer pins the backend to `platform: linux/amd64`. The correct path forward is an architecture-aware solution (native aarch64 binary and/or `OC_MIRROR_BIN` override), not forced emulation.

---

## 1. Problem summary

### User feedback (colleague on Mac, Podman)

- **Operators page:** Paste pull secret, click **Scan / Update Operators** → no visible feedback; scan appears to do nothing.
- **Operations logs:** Job fails immediately with:
  ```text
  qemu-x86_64-static: Could not open '/lib64/ld-linux-x86-64.so.2': No such file or directory
  ```
- **Backend logs:** Minimal (e.g. only "Backend listening on 4000"); no obvious error at HTTP layer.
- **POST /api/.../scan:** Returns **200** (job is accepted and enqueued); failure happens when the spawned `oc-mirror` process starts.
- **Pull secret:** Tried pasted, uploaded, and mounted via volume (`./registry-auth.json:/data/registry-auth.json:Z`); failure is immediate and unrelated to auth.

### Evidence from container

On the backend container (Apple Silicon host):

```bash
podman exec -it <backend_container> sh -lc 'uname -m; /usr/local/bin/oc-mirror --help'
# uname -m  →  aarch64
# oc-mirror --help  →  qemu-x86_64-static: Could not open '/lib64/ld-linux-x86-64.so.2': No such file or directory
```

So: **host/container is `aarch64` (ARM64)**; **`/usr/local/bin/oc-mirror` is an x86_64 binary**. The system tries to run it via QEMU user emulation (`qemu-x86_64-static`) but the arm64 rootfs does not provide the x86_64 dynamic loader (`/lib64/ld-linux-x86-64.so.2`), so the process exits immediately.

### Why POST returns 200

The backend accepts the scan request, creates the job, and spawns `oc-mirror` in a child process. The HTTP response is sent when the job is **started**, not when `oc-mirror` completes. The failure is in the child process; the backend correctly marks the job as failed and records stderr (the `qemu-x86_64-static...` message) in the job output.

---

## 2. Root cause

| Layer | What happens |
|-------|----------------|
| **Image base** | `backend/Containerfile` uses Red Hat UBI 9 Node.js 20 (`ubi9/nodejs-20`), which is **multi-arch**. On Apple Silicon, Podman builds/pulls the **linux/arm64** image by default. |
| **Binary install** | The Containerfile downloads `oc` and `oc-mirror` from OpenShift mirror URLs. The **default** (or non-arch-specific) paths used today resolve to **x86_64** tarballs (e.g. `.../clients/ocp/latest/oc-mirror.tar.gz` or equivalent). |
| **Result** | The backend container is **arm64** but **x86_64** binaries are installed in `/usr/local/bin`. When the Node process spawns `oc-mirror`, the kernel invokes QEMU emulation, which then fails due to the missing x86_64 loader in the arm64 filesystem. |

So the failure is an **architecture mismatch** between the container’s userspace (arm64) and the oc-mirror binary (x86_64), **not** pull-secret, network, or API logic.

**Relevant code/config:**

- `backend/Containerfile` — `ARG OCP_CLIENT_URL`, `ARG OCP_MIRROR_URL`; `RUN curl ...` installs into `/usr/local/bin`.
- `docker-compose.yml` — no `platform` specified; Compose uses host’s default (e.g. linux/arm64 on Apple Silicon).
- `backend/src/operators.js` — spawns `oc-mirror`; on non-zero exit or stderr, sets job status to `failed` and stores message (see lines ~78–96).

---

## 3. Design goal: architecture-agnostic

We want the app to work regardless of host OS and CPU architecture, **now and moving forward**:

- **Now:** On Apple Silicon (and other arm64 hosts), Operator scan should either work or fail with a **clear, actionable** message (not a raw loader error).
- **Moving forward:** Prefer solutions that support multiple architectures (e.g. amd64 and arm64) where Red Hat provides the binaries, and avoid hardcoding a single arch unless necessary.

Constraints:

- **oc-mirror** (and `oc`) are shipped by Red Hat; we do not control which arches are offered. Red Hat documents x86_64 and, for some versions, aarch64 (e.g. 4.14+); exact mirror paths and naming must be taken from authoritative sources.
- We should **not** guess arm64 mirror URLs; if we add native arm64 support, it must use verified URLs or documented layout.

---

## 4. Phased plan

### Phase 1 — Immediate fix (works on Apple Silicon today)

**Goal:** Operator scan works on Apple Silicon (and any host) by making the **backend** container always run as **linux/amd64**, so the installed x86_64 oc-mirror binary matches the container userspace.

1. **Compose**
   - In `docker-compose.yml`, add `platform: linux/amd64` to the **backend** service only (frontend can remain multi-arch unless we want consistency for other reasons).
   - Keep existing port bindings (e.g. `127.0.0.1:4000:4000`, `127.0.0.1:5173:5173`).

2. **Containerfile**
   - Make the default download URLs **explicitly x86_64** so the image is unambiguous:
     - `OCP_CLIENT_URL` → `https://mirror.openshift.com/pub/openshift-v4/x86_64/clients/ocp/latest/openshift-client-linux.tar.gz` (or the correct stable-4.20 path if we pin version).
     - `OCP_MIRROR_URL` → `https://mirror.openshift.com/pub/openshift-v4/x86_64/clients/ocp/latest/oc-mirror.tar.gz`.
   - This avoids “generic” URLs that might resolve differently depending on build context.

3. **Docs**
   - **README.md:** Add a short **“Apple Silicon / non-x86_64 hosts”** (or **“Platform and architecture”**) note: Operator scan runs in an amd64 backend container; on Apple Silicon this uses emulation and is slower but supported; full rebuild required after changing compose. Include rebuild commands for both Docker and Podman.
   - **CONTRIBUTING.md** (optional): Under “Run and build”, add one line pointing to this plan (or README) for contributors on Mac/ARM.

**Acceptance:** On an Apple Silicon Mac, `podman compose down && podman compose build --no-cache --pull && podman compose up`; then **Scan / Update Operators** completes without the `qemu-x86_64-static` / `ld-linux-x86-64.so.2` error.

---

### Phase 2 — Durable UX and clarity

**Goal:** If someone runs without the platform pin (e.g. old compose or custom setup), they get a **clear error** instead of a raw loader message.

1. **Backend**
   - In `backend/src/operators.js`, when the job fails and stderr contains the known architecture-mismatch signature (e.g. `ld-linux-x86-64.so.2` or `qemu-x86_64-static`), **replace** (or prefix) the user-facing job message with a short, actionable line, e.g.:
     - *“Operators scan requires a linux/amd64 backend container. On Apple Silicon, set `platform: linux/amd64` for the backend in docker-compose.yml and rebuild (see README).”*
   - Keep the raw stderr in logs or in a detail field for troubleshooting.

**Acceptance:** On an arm64 backend container (no platform pin), after scan fails, the Operations UI shows the guidance message; support/debug can still see the raw error in logs.

---

### Phase 3 — Optional: native arm64 (future)

**Goal:** When Red Hat’s mirror layout for **aarch64** oc-mirror (and oc) is verified and stable, support building and running the backend as **native arm64** on ARM hosts so we don’t rely on amd64 emulation.

1. **Research**
   - Confirm authoritative mirror URLs (or path pattern) for aarch64 `oc` and `oc-mirror` for the OCP versions we support (e.g. 4.17–4.20). Do not implement from guesswork.
   - Document the source (e.g. Red Hat doc, mirror index, or support) in this file.

2. **Build**
   - In Containerfile, use **build-time** `TARGETARCH` (or equivalent) to choose the correct URL per arch, e.g.:
     - `TARGETARCH=amd64` → existing x86_64 URLs.
     - `TARGETARCH=arm64` → verified aarch64 URLs (only after Step 1).
   - Optionally build a multi-arch image (e.g. `docker buildx` with `--platform linux/amd64,linux/arm64`) and document how to use it.

3. **Compose**
   - Once native arm64 image is available and tested, **remove** the hard `platform: linux/amd64` for backend so ARM hosts can run arm64 natively; keep Phase 1 behavior as fallback (e.g. amd64 emulation) if we document it.

**Acceptance:** On Apple Silicon, backend runs as linux/arm64, oc-mirror is arm64 binary, Operator scan succeeds without emulation. Amd64 hosts unchanged.

---

## 5. Implementation checklist (for implementer)

- [ ] **Phase 1**
  - [ ] `docker-compose.yml`: add `platform: linux/amd64` to `backend` service; leave ports and other settings unchanged.
  - [ ] `backend/Containerfile`: set default `OCP_CLIENT_URL` and `OCP_MIRROR_URL` to explicit x86_64 mirror paths (match Red Hat mirror layout for your chosen version, e.g. latest or stable-4.20).
  - [ ] `README.md`: add “Apple Silicon / non-x86_64 hosts” (or “Platform and architecture”) subsection with: backend runs as linux/amd64 for Operator scan; on Apple Silicon use `platform: linux/amd64` and rebuild; include `podman compose down && podman compose build --no-cache --pull && podman compose up` (and Docker equivalent if different).
  - [ ] Optional: `docs/CONTRIBUTING.md` — one-line pointer to this plan or README for Mac/ARM contributors.
- [ ] **Phase 2**
  - [ ] `backend/src/operators.js`: detect stderr containing `ld-linux-x86-64.so.2` or `qemu-x86_64-static`; set (or prefix) job failure message to the guidance text; keep raw stderr for logs/detail.
- [ ] **Phase 3** (when verified)
  - [ ] Document aarch64 mirror URLs and source in this file.
  - [ ] Containerfile: use `TARGETARCH` (or build-arg) to select amd64 vs arm64 URLs.
  - [ ] Test arm64 image on Apple Silicon; update README and optionally remove hard platform pin for backend.
  - [ ] CI: ensure existing tests still pass; add or document manual test for “Operator scan on amd64 and, if available, arm64”.

---

## 6. References

- **OpenShift mirror (example):** `https://mirror.openshift.com/pub/openshift-v4/clients/ocp/stable-4.20/` (and per-arch paths under x86_64, aarch64 when available).
- **Red Hat:** oc-mirror support for aarch64 documented from 4.14+; exact URL pattern must be verified from current docs or mirror index.
- **ChatGPT/cursor prompts:** Root cause (arch mismatch) and fix (platform linux/amd64 + explicit x86_64 URLs) are consistent with the analysis in the user’s conversation and the suggested compose/Containerfile changes.
- **Screenshots / assets:** User provided Operations UI and Scan Status screenshots showing the `qemu-x86_64-static` / `ld-linux-x86-64.so.2` error; stored in project assets for reference.

---

*Last updated: plan created from colleague feedback, ChatGPT analysis, and error evidence; implementation to be done in follow-up work.*
