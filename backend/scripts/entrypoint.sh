#!/bin/sh
# On OpenShift the container runs as an arbitrary UID (always in group 0).
# Local Docker/Podman runs as root by default.
# - As root: fix DATA_DIR ownership, then drop to appuser (UID 1001).
# - As non-root (OpenShift): skip runuser, execute directly.
#
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
if [ "$(id -u)" -eq 0 ]; then
  exec runuser -u appuser -- /bin/sh -c "cd /app && exec node src/index.js"
else
  cd /app && exec node src/index.js
fi
