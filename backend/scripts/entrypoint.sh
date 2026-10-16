#!/bin/sh
# Start the backend under whichever identity the platform gave us.
#
# TWO SUPPORTED STARTUP IDENTITIES, and they are genuinely different:
#
#   root        Compose/podman-compose start the container as root so that
#               DATA_DIR (a bind mount or named volume) can be chowned to the
#               app UID, then privileges are dropped with `runuser`.
#
#   non-root    Kubernetes/OpenShift start the container as a non-root UID
#               chosen by the securityContext or the SCC. manifests/base/
#               sets runAsNonRoot: true with capabilities drop ALL, and
#               OpenShift's restricted-v2 SCC additionally assigns an
#               ARBITRARY UID from the namespace range with gid 0.
#
# This script used to call `runuser` unconditionally, which cannot work in the
# second case: runuser is setuid-root-free and refuses outright for a non-root
# caller. Reproduced on the committed baseline image
# (localhost/openshift-airgap-architect-backend:latest) with the manifest's own
# securityContext:
#
#     podman run --user 1001 --cap-drop ALL --security-opt no-new-privileges …
#     -> runuser: may not be used by non-root users          (container exits 1)
#
# and identically for an arbitrary UID (`--user 12345:0`). So the shipped
# OpenShift manifests could never have started either image. Dropping
# privileges when we HAVE them, and simply not trying when we do not, fixes it
# without weakening anything: the securityContext keeps runAsNonRoot, drop ALL
# and allowPrivilegeEscalation: false exactly as they are.
set -e
DATA_DIR="${DATA_DIR:-/data}"

if [ "$(id -u)" = 0 ]; then
  # --- root: take ownership of DATA_DIR, then drop to the app UID ----------
  # chown transfers bind-mount ownership to UID 1001 when possible (rootless
  # Podman: maps to a subuid; rootful Docker: straightforward). If chown fails
  # (e.g. host dir owned by root and container root lacks CAP_CHOWN over it),
  # fall back to chmod o+rwX so UID 1001 can still access the directory.
  # Neither step can fix a missing SELinux :Z label — that must be set in the
  # compose volume mount on SELinux hosts (Fedora/RHEL/CentOS).
  if [ -d "$DATA_DIR" ]; then
    chown -R 1001:0 "$DATA_DIR" 2>/dev/null || chmod -R o+rwX "$DATA_DIR" 2>/dev/null || true
  fi
  . /app/build-env.sh 2>/dev/null || true
  exec runuser -u appuser -- /bin/sh -c "cd /app && exec node src/index.js"
fi

# --- already non-root: no chown, no runuser, no privilege to regain --------
#
# DATA_DIR must already be writable by this UID or its group. In Kubernetes
# that is what `fsGroup` is for: the kubelet applies the fsGroup GID to the
# volume and sets it group-writable, so an arbitrary UID with that supplementary
# group can write. When that is missing the failure would otherwise surface
# much later as an opaque SQLite error from a half-initialised process, so it
# is checked here and reported in terms of the thing an operator can actually
# change.
if [ ! -d "$DATA_DIR" ]; then
  echo "FATAL: DATA_DIR $DATA_DIR does not exist." >&2
  echo "       Running as UID $(id -u) (non-root), so it cannot be created here." >&2
  echo "       Mount a volume at $DATA_DIR." >&2
  exit 1
fi
if ! ( umask 077 && touch "$DATA_DIR/.write-probe" ) 2>/dev/null; then
  echo "FATAL: DATA_DIR $DATA_DIR is not writable by UID $(id -u) (groups: $(id -G))." >&2
  echo "       $DATA_DIR is currently $(stat -c '%u:%g mode=%a' "$DATA_DIR" 2>/dev/null || echo 'unreadable')." >&2
  echo "       The container runs non-root and cannot chown it. Set spec.securityContext.fsGroup" >&2
  echo "       on the pod so the kubelet makes the volume group-writable, or pre-create the" >&2
  echo "       volume owned by this UID." >&2
  exit 1
fi
rm -f "$DATA_DIR/.write-probe"

. /app/build-env.sh 2>/dev/null || true
cd /app
exec node src/index.js
