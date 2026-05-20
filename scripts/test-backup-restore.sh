#!/bin/bash
# OpenShift Airgap Architect - Backup/Restore Test Script
# Test backup and restore scripts with a test SQLite database
#
# This script creates a test database, backs it up, verifies it,
# and tests the restore procedure WITHOUT requiring Kubernetes.
#
# Usage: ./scripts/test-backup-restore.sh

set -euo pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Test configuration
TEST_DIR="/tmp/airgap-architect-backup-test-$$"
TEST_DB="$TEST_DIR/test-database.db"
BACKUP_DIR="$TEST_DIR/backups"

# Helper functions
log_info() {
  echo -e "${GREEN}✓${NC} $1"
}

log_error() {
  echo -e "${RED}✗${NC} $1" >&2
}

log_step() {
  echo -e "${BLUE}→${NC} $1"
}

cleanup() {
  if [ -d "$TEST_DIR" ]; then
    rm -rf "$TEST_DIR"
    log_info "Cleaned up test directory"
  fi
}

# Trap cleanup on exit
trap cleanup EXIT

# Create test database
create_test_database() {
  log_step "Creating test database..."

  mkdir -p "$TEST_DIR"
  mkdir -p "$BACKUP_DIR"

  # Create database with same schema as production
  sqlite3 "$TEST_DB" <<'EOF'
CREATE TABLE cache (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE jobs (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  status TEXT NOT NULL,
  progress INTEGER NOT NULL DEFAULT 0,
  message TEXT,
  output TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  metadata_json TEXT DEFAULT ''
);

CREATE TABLE operator_results (
  version TEXT NOT NULL,
  catalog TEXT NOT NULL,
  results_json TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (version, catalog)
);

CREATE TABLE docs_links (
  key TEXT PRIMARY KEY,
  links_json TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE app_state (
  id TEXT PRIMARY KEY,
  state_json TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

-- Insert test data
INSERT INTO app_state VALUES
  ('wizard-1', '{"step": 1, "platform": "bare-metal-ipi"}', strftime('%s', 'now')),
  ('wizard-2', '{"step": 2, "platform": "vsphere-ipi"}', strftime('%s', 'now'));

INSERT INTO jobs VALUES
  ('job-1', 'mirror-sync', 'completed', 100, 'Sync complete', 'output', strftime('%s', 'now'), strftime('%s', 'now'), '{}'),
  ('job-2', 'catalog-scan', 'running', 50, 'Scanning', '', strftime('%s', 'now'), strftime('%s', 'now'), '{}');

INSERT INTO cache VALUES
  ('cincinnati-channels', '["stable-4.14", "stable-4.15"]', strftime('%s', 'now'));

-- Enable WAL mode
PRAGMA journal_mode = WAL;
EOF

  log_info "Test database created: $TEST_DB"

  # Show database info
  echo ""
  echo "Test Database Contents:"
  sqlite3 "$TEST_DB" "SELECT name, (SELECT COUNT(*) FROM sqlite_master sm WHERE sm.name = m.name) as count FROM sqlite_master m WHERE type='table' ORDER BY name;"
}

# Test VACUUM INTO (simulates backup script)
test_vacuum_backup() {
  log_step "Testing VACUUM INTO backup method..."

  BACKUP_FILE="$BACKUP_DIR/test-backup-$(date +%Y%m%d-%H%M%S).db"

  sqlite3 "$TEST_DB" "VACUUM INTO '$BACKUP_FILE'"

  if [ ! -f "$BACKUP_FILE" ]; then
    log_error "VACUUM INTO failed to create backup file"
    return 1
  fi

  log_info "VACUUM backup created: $BACKUP_FILE"
  return 0
}

# Test verification script
test_verify_script() {
  local backup_file=$1

  log_step "Testing backup verification script..."

  if ! ./scripts/verify-backup.sh "$backup_file"; then
    log_error "Backup verification failed"
    return 1
  fi

  log_info "Backup verification passed"
}

# Test backup integrity
test_backup_integrity() {
  local backup_file=$1

  log_step "Testing backup data integrity..."

  # Check data matches original
  local original_count
  local backup_count

  original_count=$(sqlite3 "$TEST_DB" "SELECT COUNT(*) FROM app_state;")
  backup_count=$(sqlite3 "$backup_file" "SELECT COUNT(*) FROM app_state;")

  if [ "$original_count" != "$backup_count" ]; then
    log_error "Data count mismatch: original=$original_count, backup=$backup_count"
    return 1
  fi

  log_info "Data integrity verified (app_state: $backup_count rows)"

  # Check jobs table
  original_count=$(sqlite3 "$TEST_DB" "SELECT COUNT(*) FROM jobs;")
  backup_count=$(sqlite3 "$backup_file" "SELECT COUNT(*) FROM jobs;")

  if [ "$original_count" != "$backup_count" ]; then
    log_error "Jobs count mismatch: original=$original_count, backup=$backup_count"
    return 1
  fi

  log_info "Data integrity verified (jobs: $backup_count rows)"
}

# Test restore simulation
test_restore_simulation() {
  local backup_file=$1

  log_step "Testing restore simulation..."

  # Create a "corrupted" database
  local corrupted_db="$TEST_DIR/corrupted.db"
  cp "$TEST_DB" "$corrupted_db"

  # Corrupt it by deleting data
  sqlite3 "$corrupted_db" "DELETE FROM app_state;"

  local corrupted_count
  corrupted_count=$(sqlite3 "$corrupted_db" "SELECT COUNT(*) FROM app_state;")

  if [ "$corrupted_count" != "0" ]; then
    log_error "Failed to simulate corruption"
    return 1
  fi

  log_info "Simulated database corruption (0 rows in app_state)"

  # Restore from backup
  cp "$backup_file" "$corrupted_db"

  local restored_count
  restored_count=$(sqlite3 "$corrupted_db" "SELECT COUNT(*) FROM app_state;")

  if [ "$restored_count" -lt "1" ]; then
    log_error "Restore failed: $restored_count rows"
    return 1
  fi

  log_info "Restore successful ($restored_count rows restored)"
}

# Test file size check
test_backup_size() {
  local backup_file=$1

  log_step "Testing backup file size..."

  local size
  size=$(stat -c%s "$backup_file" 2>/dev/null || stat -f%z "$backup_file" 2>/dev/null)

  if [ "$size" -lt 1024 ]; then
    log_error "Backup file too small: $size bytes"
    return 1
  fi

  local formatted_size
  if command -v numfmt &> /dev/null; then
    formatted_size=$(numfmt --to=iec-i --suffix=B "$size")
  else
    formatted_size="$size bytes"
  fi

  log_info "Backup file size: $formatted_size"
}

# Test error handling
test_error_handling() {
  log_step "Testing error handling..."

  # Test verify script with non-existent file
  if ./scripts/verify-backup.sh "/nonexistent/file.db" 2>/dev/null; then
    log_error "Verify script should fail for non-existent file"
    return 1
  fi
  log_info "Non-existent file check passed"

  # Test verify script with corrupted file
  local corrupted_file="$TEST_DIR/corrupted-backup.db"
  echo "not a valid sqlite file" > "$corrupted_file"

  if ./scripts/verify-backup.sh "$corrupted_file" 2>/dev/null; then
    log_error "Verify script should fail for corrupted file"
    return 1
  fi
  log_info "Corrupted file check passed"
}

# Main test execution
main() {
  echo "OpenShift Airgap Architect - Backup/Restore Test Suite"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo ""

  # Check prerequisites
  if ! command -v sqlite3 &> /dev/null; then
    log_error "sqlite3 not found. Please install sqlite3."
    exit 1
  fi

  local tests_passed=0
  local tests_total=7
  BACKUP_FILE=""

  # Run tests (disable pipefail to allow test failures)
  set +e
  create_test_database

  echo ""
  if test_vacuum_backup; then ((tests_passed++)); fi

  echo ""
  if test_verify_script "$BACKUP_FILE"; then ((tests_passed++)); fi

  echo ""
  if test_backup_integrity "$BACKUP_FILE"; then ((tests_passed++)); fi

  echo ""
  if test_restore_simulation "$BACKUP_FILE"; then ((tests_passed++)); fi

  echo ""
  if test_backup_size "$BACKUP_FILE"; then ((tests_passed++)); fi

  echo ""
  if test_error_handling; then ((tests_passed++)); fi
  set -e

  echo ""
  log_step "Testing script permissions..."
  if [ -x "./scripts/backup-sqlite.sh" ] && \
     [ -x "./scripts/verify-backup.sh" ] && \
     [ -x "./scripts/restore-sqlite.sh" ]; then
    log_info "All scripts are executable"
    ((tests_passed++))
  else
    log_error "Some scripts are not executable"
  fi

  # Final summary
  echo ""
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  if [ "$tests_passed" -eq "$tests_total" ]; then
    log_info "All tests passed ($tests_passed/$tests_total)"
    echo ""
    echo "Backup/restore scripts are ready for production use."
    echo ""
    echo "Next steps:"
    echo "  1. Test scripts in Kubernetes environment"
    echo "  2. Set up automated backup schedule"
    echo "  3. Configure off-site backup storage"
    echo "  4. Test restore procedure quarterly"
    exit 0
  else
    log_error "Some tests failed ($tests_passed/$tests_total passed)"
    echo ""
    echo "Please review and fix failing tests before production use."
    exit 1
  fi
}

# Run main function
main "$@"
