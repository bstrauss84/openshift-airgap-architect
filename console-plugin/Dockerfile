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

# Create complete nginx config
RUN echo 'worker_processes auto; \
error_log /dev/stderr info; \
pid /tmp/nginx.pid; \
\
events { \
    worker_connections 1024; \
} \
\
http { \
    client_body_temp_path /tmp/client_body; \
    proxy_temp_path /tmp/proxy; \
    fastcgi_temp_path /tmp/fastcgi; \
    uwsgi_temp_path /tmp/uwsgi; \
    scgi_temp_path /tmp/scgi; \
    \
    include /etc/nginx/mime.types; \
    default_type application/octet-stream; \
    \
    access_log /dev/stdout; \
    \
    sendfile on; \
    tcp_nopush on; \
    keepalive_timeout 65; \
    \
    server { \
        listen 9001; \
        server_name _; \
        root /usr/share/nginx/html; \
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
    } \
}' > /etc/nginx/nginx.conf && \
    # Ensure permissions for nginx to run as non-root \
    chown -R 1001:0 /usr/share/nginx/html && \
    chmod -R g+rwX /usr/share/nginx/html && \
    chown -R 1001:0 /etc/nginx && \
    chmod -R g+rwX /etc/nginx && \
    chown -R 1001:0 /var/log/nginx && \
    chmod -R g+rwX /var/log/nginx && \
    mkdir -p /tmp/client_body /tmp/proxy /tmp/fastcgi /tmp/uwsgi /tmp/scgi && \
    chown -R 1001:0 /tmp && \
    chmod -R g+rwX /tmp

USER 1001

EXPOSE 9001

CMD ["nginx", "-g", "daemon off;"]
