#!/usr/bin/env bash
# Local secret scan: uses gitleaks if installed; otherwise falls back to ripgrep for high-confidence patterns.
# Usage: ./scripts/check-secrets.sh [path]
# From repo root: ./scripts/check-secrets.sh .
set -e
path="${1:-.}"

if command -v gitleaks >/dev/null 2>&1; then
  gitleaks detect --source "$path" --no-git
  exit 0
fi

# Fallback: ripgrep for high-confidence secret patterns (no node_modules/.git). CI still runs gitleaks.
if command -v rg >/dev/null 2>&1; then
  echo "gitleaks not installed; running fallback ripgrep scan (install gitleaks for full scan)."
  # Patterns that strongly suggest leaked secrets; exclude deps and build output
  if rg -n --no-ignore-vcs \
    -g '!node_modules' -g '!.git' -g '!*.lock' \
    -e 'ghp_[A-Za-z0-9]{36}' \
    -e 'github_pat_[A-Za-z0-9_]{38,}' \
    -e '-----BEGIN (RSA |EC )?PRIVATE KEY-----' \
    -e 'AKIA[0-9A-Z]{16}' \
    "$path" 2>/dev/null; then
    echo ":: Possible secret pattern(s) found. Install gitleaks for authoritative scan." >&2
    exit 1
  fi
  echo "OK (fallback scan found no high-confidence patterns)."
  exit 0
fi

echo "gitleaks not installed; ripgrep (rg) not found. Skipping secret scan. Install gitleaks for local scan (e.g. Fedora: dnf install gitleaks)."
exit 0
