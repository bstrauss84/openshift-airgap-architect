#!/bin/sh
# Run as root only to fix DATA_DIR ownership; then drop to UID 1001 for the app.
set -e
DATA_DIR="${DATA_DIR:-/data}"
if [ -d "$DATA_DIR" ]; then
  chown -R 1001:0 "$DATA_DIR" 2>/dev/null || true
fi
. /app/build-env.sh 2>/dev/null || true
exec runuser -u appuser -- /bin/sh -c "cd /app && exec node src/index.js"
