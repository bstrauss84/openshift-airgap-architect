#!/usr/bin/env bash
# Pre-commit: verify the generated frontend mirrors match canonical data.
#
# READ-ONLY BY DESIGN. This hook reports drift and tells you what to run. It
# never modifies a file and never stages one.
#
# It replaces an untracked hook that ran `sync-catalogs.js` and then
# `git add`-ed the result mid-commit. That hook was load-bearing but existed on
# exactly one machine, and auto-staging meant a commit could contain files the
# author never saw. Staging is the author's decision.
#
# The same invariant is enforced in CI, so the guarantee does not depend on
# anyone having installed this hook.
#
# Wired up by .pre-commit-config.yaml. Install with: pre-commit install
#
# Exit 0 in sync, 1 drift.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'

failed=0

echo "Checking generated data mirrors (read-only)..."

if ! node scripts/sync-catalogs.js --check >/tmp/oaa-precommit-catalogs.log 2>&1; then
  echo -e "${RED}FAIL${NC}  catalog mirror is out of sync with data/params/"
  sed 's/^/      /' /tmp/oaa-precommit-catalogs.log
  failed=1
else
  echo -e "${GREEN}ok${NC}    catalog mirror in sync"
fi

if ! node scripts/sync-docs-index.js --check >/tmp/oaa-precommit-docsidx.log 2>&1; then
  echo -e "${RED}FAIL${NC}  docs-index mirror is out of sync with data/docs-index/"
  sed 's/^/      /' /tmp/oaa-precommit-docsidx.log
  failed=1
else
  echo -e "${GREEN}ok${NC}    docs-index mirror in sync"
fi

if [ "$failed" -ne 0 ]; then
  cat <<EOF

$(echo -e "${YELLOW}Commit stopped: generated mirrors do not match canonical data.${NC}")

  data/params/<minor>/      is canonical  ->  frontend/src/data/catalogs/<minor>/    is generated
  data/docs-index/<minor>.json is canonical ->  frontend/src/data/docs-index/<minor>.json is generated

To fix, from the repository root:

    npm run sync-catalogs
    npm run sync-docs-index

then review and stage the regenerated files yourself.

If the mirror looked right and canonical looked wrong, fix canonical and
regenerate. Never copy a mirror back over canonical.

This hook does not edit or stage anything on your behalf.
EOF
  exit 1
fi

exit 0
