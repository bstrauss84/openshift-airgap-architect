# Red Hat UBI 9 Node.js 20 — backend (Express API, oc/oc-mirror, better-sqlite3)
# Standalone build from backend/ context (no build-info). Compose uses backend/Containerfile.
FROM registry.access.redhat.com/ubi9/nodejs-20

USER root
# Override these ARGs to force a specific binary URL (optional — auto-detected by default)
ARG OCP_CLIENT_URL=""
ARG OCP_MIRROR_URL=""

RUN dnf install -y --setopt=install_weak_deps=false \
    ca-certificates tar python3 make gcc-c++ gpgme openssh-clients util-linux \
    && dnf clean all \
    && rm -rf /var/cache/dnf

# Detect build-host architecture and download matching binaries.
# uname -m returns the native build architecture (no cross-compilation/emulation needed).
# Supported: x86_64, aarch64 (arm64), ppc64le, s390x.
RUN set -e && \
    _arch="$(uname -m)" && \
    case "$_arch" in \
      x86_64)         _dir="x86_64" ;; \
      aarch64|arm64)  _dir="aarch64" ;; \
      ppc64le)        _dir="ppc64le" ;; \
      s390x)          _dir="s390x" ;; \
      *)              _dir="x86_64"; echo "WARNING: unknown arch $_arch, defaulting to x86_64" ;; \
    esac && \
    _base="https://mirror.openshift.com/pub/openshift-v4/${_dir}/clients/ocp/latest" && \
    _oc_url="${OCP_CLIENT_URL:-${_base}/openshift-client-linux.tar.gz}" && \
    _mirror_url="${OCP_MIRROR_URL:-${_base}/oc-mirror.tar.gz}" && \
    echo "Downloading oc from: ${_oc_url}" && \
    curl -fsSL "${_oc_url}" -o /tmp/oc.tgz && \
    tar -xzf /tmp/oc.tgz -C /usr/local/bin oc && chmod +x /usr/local/bin/oc && rm -f /tmp/oc.tgz && \
    echo "Downloading oc-mirror from: ${_mirror_url}" && \
    curl -fsSL "${_mirror_url}" -o /tmp/oc-mirror.tgz && \
    tar -xzf /tmp/oc-mirror.tgz -C /usr/local/bin oc-mirror && chmod +x /usr/local/bin/oc-mirror && rm -f /tmp/oc-mirror.tgz

WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --omit=dev
ARG CACHE_BUST=1
RUN echo "cache bust ${CACHE_BUST}" >/dev/null
COPY src ./src
COPY mock-data ./mock-data
COPY scripts/entrypoint.sh /app/entrypoint.sh
RUN chmod +x /app/entrypoint.sh && chown -R 1001:0 /app \
    && useradd -r -u 1001 -g 0 -o -M -d /app appuser 2>/dev/null || true

ENV NODE_ENV=production
EXPOSE 4000
CMD ["/app/entrypoint.sh"]
