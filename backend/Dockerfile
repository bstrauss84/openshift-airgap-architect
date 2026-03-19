# Red Hat UBI 9 Node.js 20 — backend (Express API, oc/oc-mirror, better-sqlite3)
# Standalone build from backend/ context (no build-info). Compose uses backend/Containerfile.
FROM registry.access.redhat.com/ubi9/nodejs-20

USER root
ARG OCP_CLIENT_URL="https://mirror.openshift.com/pub/openshift-v4/clients/ocp/latest/openshift-client-linux.tar.gz"
ARG OCP_MIRROR_URL="https://mirror.openshift.com/pub/openshift-v4/clients/ocp/latest/oc-mirror.tar.gz"

RUN dnf install -y --setopt=install_weak_deps=false \
    ca-certificates tar python3 make gcc-c++ gpgme openssh-clients util-linux \
    && dnf clean all \
    && rm -rf /var/cache/dnf

RUN curl -fsSL "${OCP_CLIENT_URL}" -o /tmp/oc.tgz \
  && tar -xzf /tmp/oc.tgz -C /usr/local/bin oc \
  && chmod +x /usr/local/bin/oc \
  && rm -f /tmp/oc.tgz

RUN curl -fsSL "${OCP_MIRROR_URL}" -o /tmp/oc-mirror.tgz \
  && tar -xzf /tmp/oc-mirror.tgz -C /usr/local/bin oc-mirror \
  && chmod +x /usr/local/bin/oc-mirror \
  && rm -f /tmp/oc-mirror.tgz

WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --production
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
