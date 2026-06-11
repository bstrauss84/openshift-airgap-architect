# Red Hat UBI 9 Node.js 20 — console plugin builder
FROM registry.access.redhat.com/ubi9/nodejs-20 AS builder

USER root
RUN mkdir -p /app && chown -R 1001:0 /app && chmod -R g+rwX /app
WORKDIR /app

# Copy package files
COPY --chown=1001:0 package.json package-lock.json ./

# Install dependencies
USER 1001
RUN npm ci

# Copy source files and build
USER root
COPY --chown=1001:0 . .
USER 1001
RUN npm run build

# Production image - nginx to serve static plugin files
FROM registry.access.redhat.com/ubi9/nginx-124

USER root

# Copy built plugin files
COPY --from=builder --chown=1001:0 /app/dist /usr/share/nginx/html

# Create nginx config for console plugin
RUN echo 'server { \
    listen 9001; \
    server_name _; \
    root /usr/share/nginx/html; \
    index plugin-manifest.json; \
    \
    location / { \
        try_files $uri $uri/ =404; \
        add_header Access-Control-Allow-Origin * always; \
        add_header Access-Control-Allow-Methods "GET, OPTIONS" always; \
        add_header Access-Control-Allow-Headers "X-Requested-With, content-type, Authorization" always; \
        \
        if ($request_method = OPTIONS) { \
            return 204; \
        } \
    } \
}' > /etc/nginx/conf.d/plugin.conf && \
    # Remove default config \
    rm -f /etc/nginx/conf.d/default.conf && \
    # Ensure permissions \
    chown -R 1001:0 /usr/share/nginx/html && \
    chmod -R g+rwX /usr/share/nginx/html && \
    chown -R 1001:0 /etc/nginx && \
    chmod -R g+rwX /etc/nginx

USER 1001

EXPOSE 9001

CMD ["nginx", "-g", "daemon off;"]
