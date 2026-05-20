#!/bin/bash
# OpenShift Airgap Architect - SQLite Restore Script
# Restore SQLite database from backup file
#
# ⚠️  WARNING: This is a DESTRUCTIVE operation. Current database will be replaced.
#
# Usage: ./scripts/restore-sqlite.sh <backup-file> [namespace]
#
# Examples:
#   ./scripts/restore-sqlite.sh ./backups/airgap-architect-20260520-143000.db
#   ./scripts/restore-sqlite.sh ./backups/airgap-architect-20260520-143000.db production

set -euo pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
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

log_step() {
  echo -e "${BLUE}→${NC} $1"
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

  if [ ! -x "./scripts/verify-backup.sh" ]; then
    log_warn "Verification script not found or not executable: ./scripts/verify-backup.sh"
    log_warn "Backup verification will be skipped (not recommended)"
  fi
}

# Validate arguments
validate_arguments() {
  if [ $# -eq 0 ]; then
    log_error "No backup file specified"
    echo ""
    echo "Usage: $0 <backup-file> [namespace]"
    echo ""
    echo "Example:"
    echo "  $0 ./backups/airgap-architect-20260520-143000.db default"
    exit 1
  fi

  BACKUP_FILE=$1
  NAMESPACE=${2:-default}

  if [ ! -f "$BACKUP_FILE" ]; then
    log_error "Backup file not found: $BACKUP_FILE"
    exit 1
  fi

  if [ ! -r "$BACKUP_FILE" ]; then
    log_error "Backup file not readable: $BACKUP_FILE"
    exit 1
  fi

  if ! kubectl get namespace "$NAMESPACE" &> /dev/null; then
    log_error "Namespace '$NAMESPACE' not found"
    exit 1
  fi
}

# Verify backup before restore
verify_backup() {
  if [ ! -x "./scripts/verify-backup.sh" ]; then
    log_warn "Skipping backup verification (verify-backup.sh not available)"
    return 0
  fi

  log_step "Verifying backup integrity..."
  echo ""

  if ! ./scripts/verify-backup.sh "$BACKUP_FILE"; then
    log_error "Backup verification failed!"
    log_error "Backup file may be corrupted: $BACKUP_FILE"
    echo ""
    read -p "Continue anyway? (yes/no): " FORCE_CONTINUE
    if [ "$FORCE_CONTINUE" != "yes" ]; then
      echo "Restore cancelled."
      exit 1
    fi
    log_warn "Proceeding with potentially corrupted backup (user override)"
  fi

  echo ""
  log_info "Backup verification passed"
}

# Confirm restore operation
confirm_restore() {
  local pod=$1

  echo ""
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  log_warn "DESTRUCTIVE OPERATION WARNING"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo ""
  echo "This will REPLACE the current database with backup:"
  echo ""
  echo "  Namespace:    $NAMESPACE"
  echo "  Pod:          $pod"
  echo "  Backup file:  $BACKUP_FILE"
  echo ""
  echo "Current database will be backed up to:"
  echo "  /data/airgap-architect.db.old (inside pod)"
  echo ""
  log_warn "All unsaved wizard progress and jobs will be lost!"
  log_warn "Application will experience brief downtime (~30-60 seconds)"
  echo ""

  read -p "Are you absolutely sure you want to proceed? (yes/no): " CONFIRM

  if [ "$CONFIRM" != "yes" ]; then
    echo ""
    echo "Restore cancelled. No changes made."
    exit 0
  fi

  echo ""
  log_info "User confirmed restore operation"
}

# Find backend deployment
find_backend_deployment() {
  local deployment
  deployment=$(kubectl get deployment -n "$NAMESPACE" \
    -l app=airgap-architect,component=backend \
    -o jsonpath='{.items[0].metadata.name}' 2>/dev/null)

  if [ -z "$deployment" ]; then
    log_error "No backend deployment found in namespace '$NAMESPACE'"
    log_error "Looking for deployment with labels: app=airgap-architect,component=backend"
    exit 1
  fi

  echo "$deployment"
}

# Find backend pod
find_backend_pod() {
  local pod
  pod=$(kubectl get pod -n "$NAMESPACE" \
    -l app=airgap-architect,component=backend \
    -o jsonpath='{.items[0].metadata.name}' 2>/dev/null)

  echo "$pod"
}

# Scale down backend deployment
scale_down() {
  local deployment=$1

  log_step "Scaling down backend deployment..."

  if ! kubectl scale deployment -n "$NAMESPACE" "$deployment" --replicas=0; then
    log_error "Failed to scale down deployment"
    exit 1
  fi

  log_info "Deployment scaled to 0 replicas"

  # Wait for pod to terminate (with timeout)
  log_step "Waiting for pod to terminate..."
  if ! kubectl wait --for=delete pod -n "$NAMESPACE" \
    -l app=airgap-architect,component=backend \
    --timeout=60s 2>/dev/null; then
    log_warn "Pod did not terminate within timeout (may have already been deleted)"
  else
    log_info "Pod terminated"
  fi

  # Give it a moment to fully clean up
  sleep 2
}

# Scale up backend deployment
scale_up() {
  local deployment=$1

  log_step "Scaling up backend deployment..."

  if ! kubectl scale deployment -n "$NAMESPACE" "$deployment" --replicas=1; then
    log_error "Failed to scale up deployment"
    exit 1
  fi

  log_info "Deployment scaled to 1 replica"

  # Wait for pod to be ready
  log_step "Waiting for new pod to be ready..."
  if ! kubectl wait --for=condition=ready pod -n "$NAMESPACE" \
    -l app=airgap-architect,component=backend \
    --timeout=60s; then
    log_error "Pod did not become ready within timeout"
    log_error "Check pod status: kubectl get pods -n $NAMESPACE -l app=airgap-architect,component=backend"
    log_error "Check pod logs: kubectl logs -n $NAMESPACE -l app=airgap-architect,component=backend"
    exit 1
  fi

  log_info "New pod is ready"
}

# Copy backup to pod
copy_backup_to_pod() {
  local pod=$1
  local temp_restore_path="/data/airgap-architect-restore.db"

  log_step "Copying backup to pod..."

  if ! kubectl cp "$BACKUP_FILE" -n "$NAMESPACE" "${pod}:${temp_restore_path}"; then
    log_error "Failed to copy backup to pod"
    exit 1
  fi

  log_info "Backup copied to pod: $temp_restore_path"
  echo "$temp_restore_path"
}

# Replace database in pod
replace_database() {
  local pod=$1
  local restore_path=$2

  log_step "Replacing database..."

  # Backup current database (if exists), replace with restore, remove WAL files
  local replace_script="
    set -e
    if [ -f /data/airgap-architect.db ]; then
      mv /data/airgap-architect.db /data/airgap-architect.db.old || true
      echo 'Current database backed up to airgap-architect.db.old'
    fi
    mv $restore_path /data/airgap-architect.db
    echo 'Database replaced with restore'
    rm -f /data/airgap-architect.db-wal /data/airgap-architect.db-shm
    echo 'WAL files removed'
    ls -lh /data/airgap-architect.db
  "

  if ! kubectl exec -n "$NAMESPACE" "$pod" -- sh -c "$replace_script"; then
    log_error "Failed to replace database in pod"
    log_error "Original database may still be at /data/airgap-architect.db.old"
    exit 1
  fi

  log_info "Database replaced successfully"
}

# Restart pod to pick up new database
restart_pod() {
  local pod=$1

  log_step "Restarting pod to pick up new database..."

  if ! kubectl delete pod -n "$NAMESPACE" "$pod"; then
    log_error "Failed to delete pod for restart"
    exit 1
  fi

  log_info "Pod deleted, waiting for restart..."

  # Wait for new pod to be ready
  if ! kubectl wait --for=condition=ready pod -n "$NAMESPACE" \
    -l app=airgap-architect,component=backend \
    --timeout=60s; then
    log_error "Pod did not become ready after restart"
    exit 1
  fi

  log_info "Pod restarted successfully"
}

# Verify application is working
verify_application() {
  log_step "Verifying application health..."

  local new_pod
  new_pod=$(find_backend_pod)

  # Check if database file exists and is readable
  if ! kubectl exec -n "$NAMESPACE" "$new_pod" -- test -r /data/airgap-architect.db; then
    log_error "Database file not readable in pod"
    exit 1
  fi

  log_info "Database file is readable"

  # Check pod logs for errors
  local logs
  logs=$(kubectl logs -n "$NAMESPACE" "$new_pod" --tail=20 2>&1 || echo "")

  if echo "$logs" | grep -qi "error\|fatal\|panic"; then
    log_warn "Errors detected in pod logs:"
    echo "$logs" | grep -i "error\|fatal\|panic" | head -n 5
    echo ""
    log_warn "Check full logs: kubectl logs -n $NAMESPACE $new_pod"
  else
    log_info "No errors in recent pod logs"
  fi
}

# Show restore summary
show_summary() {
  local new_pod
  new_pod=$(find_backend_pod)

  echo ""
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  log_info "Restore completed successfully"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo ""
  echo "  Namespace:     $NAMESPACE"
  echo "  Pod:           $new_pod"
  echo "  Restored from: $BACKUP_FILE"
  echo ""
  echo "Next steps:"
  echo "  1. Verify application is accessible:"
  echo "     kubectl port-forward -n $NAMESPACE svc/airgap-architect-frontend 8080:80"
  echo "     Open: http://localhost:8080"
  echo ""
  echo "  2. Check wizard state and data"
  echo ""
  echo "  3. Verify background jobs (if any)"
  echo ""
  echo "  4. Check pod logs for any issues:"
  echo "     kubectl logs -n $NAMESPACE $new_pod"
  echo ""
  echo "Previous database backup (inside pod):"
  echo "  /data/airgap-architect.db.old"
  echo ""
  echo "To revert this restore:"
  echo "  kubectl exec -n $NAMESPACE $new_pod -- sh -c \\"
  echo "    'mv /data/airgap-architect.db.old /data/airgap-architect.db'"
  echo "  kubectl delete pod -n $NAMESPACE $new_pod"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo ""
}

# Main execution
main() {
  echo "OpenShift Airgap Architect - SQLite Restore"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo ""

  validate_arguments "$@"
  check_prerequisites

  verify_backup

  DEPLOYMENT=$(find_backend_deployment)
  log_info "Found backend deployment: $DEPLOYMENT"

  OLD_POD=$(find_backend_pod)
  if [ -n "$OLD_POD" ]; then
    log_info "Found current pod: $OLD_POD"
  else
    log_warn "No pod currently running (deployment may be scaled to 0)"
  fi

  confirm_restore "$OLD_POD"

  # Restore procedure
  scale_down "$DEPLOYMENT"

  scale_up "$DEPLOYMENT"

  NEW_POD=$(find_backend_pod)
  log_info "New pod started: $NEW_POD"

  RESTORE_PATH=$(copy_backup_to_pod "$NEW_POD")

  replace_database "$NEW_POD" "$RESTORE_PATH"

  restart_pod "$NEW_POD"

  verify_application

  show_summary
}

# Run main function
main "$@"
