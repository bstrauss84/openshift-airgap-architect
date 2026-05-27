#!/bin/bash
# OpenShift Airgap Architect - Backup Verification Script
# Verifies SQLite backup file integrity
#
# Usage: ./scripts/verify-backup.sh <backup-file>
#
# Example:
#   ./scripts/verify-backup.sh ./backups/airgap-architect-20260520-143000.db

set -euo pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Configuration
EXPECTED_MIN_TABLES=5  # Expect at least: cache, jobs, operator_results, docs_links, app_state

# Helper functions
log_info() {
  echo -e "${GREEN}✓${NC} $1"
}

log_error() {
  echo -e "${RED}✗${NC} $1" >&2
}

check_passed() {
  echo -e -n "  $1... "
}

result_ok() {
  echo -e "${GREEN}✓ OK${NC} $1"
}

result_fail() {
  echo -e "${RED}✗ FAILED${NC}"
  echo -e "    ${RED}$1${NC}"
}

# Check prerequisites
check_prerequisites() {
  if ! command -v sqlite3 &> /dev/null; then
    log_error "sqlite3 not found. Please install SQLite3 command-line tool."
    echo ""
    echo "Installation:"
    echo "  Ubuntu/Debian: sudo apt-get install sqlite3"
    echo "  RHEL/Fedora:   sudo dnf install sqlite"
    echo "  macOS:         brew install sqlite3"
    exit 1
  fi
}

# Validate arguments
validate_arguments() {
  if [ $# -eq 0 ]; then
    log_error "No backup file specified"
    echo ""
    echo "Usage: $0 <backup-file>"
    echo ""
    echo "Example:"
    echo "  $0 ./backups/airgap-architect-20260520-143000.db"
    exit 1
  fi

  BACKUP_FILE=$1

  if [ ! -f "$BACKUP_FILE" ]; then
    log_error "Backup file not found: $BACKUP_FILE"
    exit 1
  fi

  if [ ! -r "$BACKUP_FILE" ]; then
    log_error "Backup file not readable: $BACKUP_FILE"
    exit 1
  fi
}

# Check 1: SQLite integrity check
check_integrity() {
  check_passed "Integrity check"

  local result
  result=$(sqlite3 "$BACKUP_FILE" "PRAGMA integrity_check;" 2>&1)

  if [ "$result" = "ok" ]; then
    result_ok ""
    return 0
  else
    result_fail "Database integrity check failed"
    echo "$result" | head -n 10
    return 1
  fi
}

# Check 2: Verify app_state table exists and is readable
check_app_state_table() {
  check_passed "App state check"

  local count
  if ! count=$(sqlite3 "$BACKUP_FILE" "SELECT COUNT(*) FROM app_state;" 2>&1); then
    result_fail "Failed to query app_state table"
    echo "$count"
    return 1
  fi

  result_ok "($count rows)"
  return 0
}

# Check 3: Verify all expected tables exist
check_tables_exist() {
  check_passed "Table check"

  local table_count
  if ! table_count=$(sqlite3 "$BACKUP_FILE" "SELECT COUNT(*) FROM sqlite_master WHERE type='table';" 2>&1); then
    result_fail "Failed to query sqlite_master"
    echo "$table_count"
    return 1
  fi

  if [ "$table_count" -ge "$EXPECTED_MIN_TABLES" ]; then
    result_ok "($table_count tables)"
    return 0
  else
    result_fail "Only $table_count tables found, expected at least $EXPECTED_MIN_TABLES"
    echo ""
    echo "Expected tables: cache, jobs, operator_results, docs_links, app_state"
    echo ""
    echo "Actual tables:"
    sqlite3 "$BACKUP_FILE" "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name;" | sed 's/^/    /'
    return 1
  fi
}

# Check 4: Verify database can be read (not locked)
check_not_locked() {
  check_passed "Lock check"

  local result
  if result=$(timeout 5 sqlite3 "$BACKUP_FILE" "SELECT 1;" 2>&1); then
    result_ok ""
    return 0
  else
    result_fail "Database is locked or unreadable"
    echo "$result"
    return 1
  fi
}

# Check 5: Verify file size is reasonable
check_file_size() {
  check_passed "File size check"

  local size
  size=$(stat -c%s "$BACKUP_FILE" 2>/dev/null || stat -f%z "$BACKUP_FILE" 2>/dev/null)

  local min_size=1024  # 1 KB minimum
  local max_size=$((10 * 1024 * 1024 * 1024))  # 10 GB maximum (reasonable for SQLite)

  if [ "$size" -lt "$min_size" ]; then
    result_fail "File size too small: $size bytes (expected >= $min_size bytes)"
    return 1
  fi

  if [ "$size" -gt "$max_size" ]; then
    result_fail "File size unusually large: $size bytes (expected < $max_size bytes)"
    return 1
  fi

  # Format size for human-readable output
  local formatted_size
  if command -v numfmt &> /dev/null; then
    formatted_size=$(numfmt --to=iec-i --suffix=B "$size")
  else
    formatted_size="${size} bytes"
  fi

  result_ok "($formatted_size)"
  return 0
}

# Check 6: Verify WAL mode is set (consistency with production)
check_wal_mode() {
  check_passed "WAL mode check"

  local journal_mode
  if ! journal_mode=$(sqlite3 "$BACKUP_FILE" "PRAGMA journal_mode;" 2>&1); then
    result_fail "Failed to query journal mode"
    echo "$journal_mode"
    return 1
  fi

  # WAL mode expected (set in backend/src/db.js)
  # But VACUUM INTO creates a rollback-mode database, which is fine
  if [ "$journal_mode" = "wal" ] || [ "$journal_mode" = "delete" ]; then
    result_ok "($journal_mode mode)"
    return 0
  else
    result_fail "Unexpected journal mode: $journal_mode"
    return 1
  fi
}

# Show detailed table information
show_table_details() {
  echo ""
  echo "Table Details:"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

  local tables
  tables=$(sqlite3 "$BACKUP_FILE" "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name;")

  while IFS= read -r table; do
    local count
    count=$(sqlite3 "$BACKUP_FILE" "SELECT COUNT(*) FROM \"$table\";" 2>&1 || echo "ERROR")
    printf "  %-20s %s\n" "$table:" "$count rows"
  done <<< "$tables"

  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
}

# Main verification
main() {
  validate_arguments "$@"

  echo "Verifying backup: $BACKUP_FILE"
  echo ""

  local checks_passed=0
  local checks_total=6

  # Run all checks (disable pipefail to allow failures)
  set +e
  if check_integrity; then ((checks_passed++)); fi
  if check_app_state_table; then ((checks_passed++)); fi
  if check_tables_exist; then ((checks_passed++)); fi
  if check_not_locked; then ((checks_passed++)); fi
  if check_file_size; then ((checks_passed++)); fi
  if check_wal_mode; then ((checks_passed++)); fi
  set -e

  # Show detailed table information if all checks passed
  if [ "$checks_passed" -eq "$checks_total" ]; then
    show_table_details
  fi

  echo ""

  # Final verdict
  if [ "$checks_passed" -eq "$checks_total" ]; then
    log_info "Backup verification complete ($checks_passed/$checks_total checks passed)"
    echo ""
    echo "This backup is ready for restore operations."
    exit 0
  else
    log_error "Backup verification failed ($checks_passed/$checks_total checks passed)"
    echo ""
    echo "This backup may be corrupted or incomplete."
    echo "Do NOT use this backup for restore operations."
    exit 1
  fi
}

# Check prerequisites first
check_prerequisites

# Run main function
main "$@"
