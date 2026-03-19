# Red Hat UBI 9 Node.js 20 — frontend (Vite dev server in container)
# Kept in sync with Containerfile; compose uses Containerfile.
FROM registry.access.redhat.com/ubi9/nodejs-20

USER root
RUN mkdir -p /app && chown -R 1001:0 /app
WORKDIR /app
COPY --chown=1001:0 package.json package-lock.json* ./
USER 1001
RUN npm install
USER root
COPY --chown=1001:0 . .
USER 1001

EXPOSE 5173
CMD ["node", "node_modules/vite/bin/vite.js", "--host", "0.0.0.0", "--port", "5173"]
