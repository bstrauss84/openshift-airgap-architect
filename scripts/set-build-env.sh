#!/usr/bin/env bash
# Output export statements for APP_GIT_SHA and APP_BUILD_TIME. Optional for Compose
# (Compose backend image gets them from .git at build time). Use for docker run or
# OpenShift when you need to set these at container start (e.g. eval "$(bash scripts/set-build-env.sh)").
set -e
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"
SHA="unknown"
if command -v git >/dev/null 2>&1 && git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  SHA=$(git rev-parse HEAD 2>/dev/null || echo "unknown")
fi
BUILD_TIME=$(date -u +"%Y-%m-%dT%H:%M:%SZ" 2>/dev/null || date -u +"%Y-%m-%d %H:%M:%S" 2>/dev/null || echo "unknown")
echo "export APP_GIT_SHA=\"$SHA\""
echo "export APP_BUILD_TIME=\"$BUILD_TIME\""
