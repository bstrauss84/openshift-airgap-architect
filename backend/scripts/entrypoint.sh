#!/bin/sh
# Run as root only to fix DATA_DIR ownership; then drop to UID 1001 for the app.
# chown transfers bind-mount ownership to UID 1001 when possible (rootless Podman: maps
# to a subuid; rootful Docker: straightforward). If chown fails (e.g. host dir owned by
# root and container root lacks CAP_CHOWN over it), fall back to chmod o+rwX so UID 1001
# can still access the directory.  Neither step can fix a missing SELinux :Z label —
# that must be set in the compose volume mount on SELinux hosts (Fedora/RHEL/CentOS).
set -e
DATA_DIR="${DATA_DIR:-/data}"
if [ -d "$DATA_DIR" ]; then
  chown -R 1001:0 "$DATA_DIR" 2>/dev/null || chmod -R o+rwX "$DATA_DIR" 2>/dev/null || true
fi
. /app/build-env.sh 2>/dev/null || true
exec runuser -u appuser -- /bin/sh -c "cd /app && exec node src/index.js"
