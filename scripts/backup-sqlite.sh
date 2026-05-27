#!/bin/bash
# OpenShift Airgap Architect - SQLite Backup Script
# Kubernetes-aware backup using VACUUM INTO (online, no downtime)
#
# Usage: ./scripts/backup-sqlite.sh [namespace] [backup-dir]
#
# Examples:
#   ./scripts/backup-sqlite.sh                      # default namespace, ./backups
#   ./scripts/backup-sqlite.sh production           # production namespace, ./backups
#   ./scripts/backup-sqlite.sh default /mnt/nfs     # default namespace, custom directory

set -euo pipefail

# Configuration
NAMESPACE=${1:-default}
BACKUP_DIR=${2:-./backups}
TIMESTAMP=$(date +%Y%m%d-%H%M%S)
BACKUP_FILENAME="airgap-architect-${TIMESTAMP}.db"
TEMP_BACKUP_PATH="/data/backup-${TIMESTAMP}.db"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Helper functions
log_info() {
  echo -e "${GREEN}✓${NC} $1"
}

log_warn() {
  echo -e "${YELLOW}⚠${NC} $1"
}

log_error() {
  echo -e "${RED}✗${NC} $1" >&2
}

# Check prerequisites
check_prerequisites() {
  if ! command -v kubectl &> /dev/null; then
    log_error "kubectl not found. Please install kubectl."
    exit 1
  fi

  if ! kubectl cluster-info &> /dev/null; then
    log_error "Cannot connect to Kubernetes cluster. Check kubeconfig."
    exit 1
  fi

  if ! kubectl get namespace "$NAMESPACE" &> /dev/null; then
    log_error "Namespace '$NAMESPACE' not found."
    exit 1
  fi
}

# Find backend pod
find_backend_pod() {
  local pod
  pod=$(kubectl get pod -n "$NAMESPACE" \
    -l app=airgap-architect,component=backend \
    -o jsonpath='{.items[0].metadata.name}' 2>/dev/null)

  if [ -z "$pod" ]; then
    log_error "No backend pod found in namespace '$NAMESPACE'"
    log_error "Looking for pods with labels: app=airgap-architect,component=backend"
    echo ""
    echo "Available pods in namespace:"
    kubectl get pods -n "$NAMESPACE"
    exit 1
  fi

  echo "$pod"
}

# Check if pod is ready
check_pod_ready() {
  local pod=$1
  local ready
  ready=$(kubectl get pod -n "$NAMESPACE" "$pod" -o jsonpath='{.status.conditions[?(@.type=="Ready")].status}')

  if [ "$ready" != "True" ]; then
    log_error "Pod '$pod' is not ready (status: $ready)"
    kubectl get pod -n "$NAMESPACE" "$pod"
    exit 1
  fi
}

# Create backup directory
create_backup_dir() {
  mkdir -p "$BACKUP_DIR"
  log_info "Backup directory: $BACKUP_DIR"
}

# Create backup using VACUUM INTO
create_backup() {
  local pod=$1

  log_info "Creating backup from pod '$pod' in namespace '$NAMESPACE'..."

  # VACUUM INTO creates a consistent point-in-time backup
  # No downtime, no write pauses required
  if ! kubectl exec -n "$NAMESPACE" "$pod" -- \
    sqlite3 /data/airgap-architect.db "VACUUM INTO '${TEMP_BACKUP_PATH}'"; then
    log_error "Failed to create backup using VACUUM INTO"
    log_error "Check pod logs: kubectl logs -n $NAMESPACE $pod"
    exit 1
  fi

  log_info "Backup created in pod: ${TEMP_BACKUP_PATH}"
}

# Copy backup from pod to local
copy_backup() {
  local pod=$1
  local local_path="${BACKUP_DIR}/${BACKUP_FILENAME}"

  log_info "Copying backup from pod to local storage..."

  if ! kubectl cp -n "$NAMESPACE" "${pod}:${TEMP_BACKUP_PATH}" "$local_path"; then
    log_error "Failed to copy backup from pod"
    # Cleanup pod backup before exit
    kubectl exec -n "$NAMESPACE" "$pod" -- rm -f "$TEMP_BACKUP_PATH" || true
    exit 1
  fi

  log_info "Backup copied to: $local_path"
  echo "$local_path"
}

# Cleanup temporary backup in pod
cleanup_pod_backup() {
  local pod=$1

  log_info "Cleaning up temporary backup in pod..."

  if ! kubectl exec -n "$NAMESPACE" "$pod" -- rm -f "$TEMP_BACKUP_PATH"; then
    log_warn "Failed to cleanup temporary backup in pod (non-critical)"
    log_warn "You may want to manually remove: $TEMP_BACKUP_PATH"
  else
    log_info "Temporary backup removed from pod"
  fi
}

# Verify backup integrity
verify_backup() {
  local backup_path=$1

  log_info "Verifying backup integrity..."

  # Check if verify script exists
  if [ ! -x "./scripts/verify-backup.sh" ]; then
    log_warn "Verification script not found or not executable: ./scripts/verify-backup.sh"
    log_warn "Skipping automatic verification. Please verify manually."
    return 0
  fi

  if ! ./scripts/verify-backup.sh "$backup_path"; then
    log_error "Backup verification failed!"
    log_error "Backup file may be corrupted: $backup_path"
    exit 1
  fi

  log_info "Backup verification passed"
}

# Display backup info
show_backup_info() {
  local backup_path=$1
  local size

  if command -v numfmt &> /dev/null; then
    size=$(numfmt --to=iec-i --suffix=B "$(stat -c%s "$backup_path")")
  else
    size=$(stat -c%s "$backup_path") bytes
  fi

  echo ""
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  log_info "Backup completed successfully"
  echo ""
  echo "  File: $backup_path"
  echo "  Size: $size"
  echo "  Timestamp: $TIMESTAMP"
  echo ""
  echo "To restore this backup:"
  echo "  ./scripts/restore-sqlite.sh $backup_path $NAMESPACE"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo ""
}

# Main execution
main() {
  echo "OpenShift Airgap Architect - SQLite Backup"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo ""

  check_prerequisites
  create_backup_dir

  POD=$(find_backend_pod)
  log_info "Found backend pod: $POD"

  check_pod_ready "$POD"
  log_info "Pod is ready"

  create_backup "$POD"

  BACKUP_PATH=$(copy_backup "$POD")

  cleanup_pod_backup "$POD"

  verify_backup "$BACKUP_PATH"

  show_backup_info "$BACKUP_PATH"
}

# Run main function
main "$@"
