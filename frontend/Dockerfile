# ============================================================================
# LEGACY / UNSUPPORTED — DO NOT USE FOR BUILDS OR FOR PRODUCTION
# ============================================================================
# Retained for local development reference only. It builds the VITE DEV SERVER
# as the long-lived process, with the full devDependency tree resident in the
# image — the exact configuration PROD-026 removed, and the one that made a
# container build report 15 vulnerabilities while the dependency gate reported
# zero (see the header of frontend/Containerfile).
#
# The previous comment here claimed "Kept in sync with Containerfile", which
# was false: the Containerfile has been a two-stage nginx build since PROD-026
# and these two files deliberately differ. Anyone who trusted that line and
# built from this file reintroduced the release blocker.
#
# The SUPPORTED build path is:  frontend/Containerfile  (used by docker-compose.yml)
# ============================================================================
#
# Red Hat UBI 9 Node.js 22 — frontend (Vite dev server in container)
FROM registry.access.redhat.com/ubi9/nodejs-22

USER root
RUN mkdir -p /app && chown -R 1001:0 /app
WORKDIR /app
COPY --chown=1001:0 frontend/package.json frontend/package-lock.json ./frontend/
WORKDIR /app/frontend
USER 1001
RUN npm ci
USER root
WORKDIR /app
COPY --chown=1001:0 frontend/ ./frontend/
COPY --chown=1001:0 shared/ ./shared/
USER 1001

EXPOSE 5173
WORKDIR /app/frontend
CMD ["node", "node_modules/vite/bin/vite.js", "--host", "0.0.0.0", "--port", "5173"]
