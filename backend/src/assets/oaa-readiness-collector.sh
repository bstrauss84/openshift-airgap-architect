#!/usr/bin/env bash
# OpenShift Airgap Architect - read-only readiness evidence collector (bundle format v1).
#
# What it does
#   Runs only read-only `oc get` commands against the cluster you are logged in to, keeps only
#   the fields Architect's readiness checks use (names, versions, channels, phases, conditions,
#   counts), and writes ONE JSON file you upload on Upgrade > Readiness.
#
# What it never does
#   - changes anything in the cluster (no create, apply, patch, delete, adm, debug or exec);
#   - reads Secrets, pull secrets, tokens, certificates or your kubeconfig's contents;
#   - records your user name, the cluster ID, the API server URL or the update service URL;
#   - sends anything anywhere. The file stays where you write it until you upload it.
#
# Requirements: bash, oc (logged in; the cluster-reader role is enough) and jq.
# Usage:        bash oaa-readiness-collector.sh [output-file]
# Review the output file before you upload it; it is plain JSON.
set -euo pipefail
umask 077

OUT="${1:-oaa-readiness-$(date -u +%Y%m%dT%H%M%SZ).json}"
command -v oc >/dev/null 2>&1 || { echo "oc was not found on PATH." >&2; exit 2; }
command -v jq >/dev/null 2>&1 || { echo "jq is required (dnf install jq). Or use the individual read-only commands under Advanced on the Readiness step." >&2; exit 2; }
oc whoami >/dev/null 2>&1 || { echo "Log in with 'oc login' first (the cluster-reader role is enough)." >&2; exit 2; }

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# Condition messages are free text: credential-like values are masked before anything is written
# (URL userinfo, bearer/basic values, token=/password= style pairs, long base64 runs).
REDACT='def redact: if type == "string" then (.[0:4000]
  | gsub("(?<s>[a-zA-Z][a-zA-Z0-9+.-]*://)[^\\s/@]+@"; "\(.s)[redacted]@")
  | gsub("(?<k>(?i)bearer|basic)\\s+[A-Za-z0-9._~+/=-]{8,}"; "\(.k) [redacted]")
  | gsub("(?<k>(?i)token|password|passwd|secret|auth|apikey|api_key|access_key)(?<sep>[\"'"'"']?\\s*[:=]\\s*[\"'"'"']?)[^\\s\"'"'"',;]+"; "\(.k)\(.sep)[redacted]")
  | gsub("[A-Za-z0-9+/]{64,}={0,2}"; "[redacted]")
  | .[0:1000]) else . end;'
CONDS='[.status.conditions[]? | {type, status, reason, message: (.message | redact)}]'

# collect <section> <jq filter> <oc get arguments...>
# On failure only a classification is recorded (forbidden | not-found | failed), never the
# error text, which can contain user and server names.
collect() {
  local name="$1" filter="$2"
  shift 2
  if oc get "$@" -o json >"$TMP/raw" 2>"$TMP/err"; then
    jq -c "$REDACT $filter" "$TMP/raw" >"$TMP/$name.json"
  else
    local why="failed"
    grep -qi "forbidden" "$TMP/err" && why="forbidden"
    grep -qiE "not ?found|the server doesn't have a resource type" "$TMP/err" && why="not-found"
    jq -nc --arg e "$why" '{error: $e}' >"$TMP/$name.json"
  fi
  rm -f "$TMP/raw" "$TMP/err"
  echo "  $name: $(jq -r 'if .error then "not collected (" + .error + ")" else "collected" end' "$TMP/$name.json")" >&2
}

echo "Collecting read-only readiness evidence..." >&2

collect clusterversion "{kind, spec: {channel: .spec.channel, upstream: (if .spec.upstream then \"configured\" else null end)},
  status: {desired: {version: .status.desired.version},
           history: [.status.history[]? | {version, state, completionTime}][:50],
           conditions: $CONDS,
           conditionalUpdates: [.status.conditionalUpdates[]? | {release: {version: .release.version}, risks: [.risks[]? | {name}],
                                conditions: [.conditions[]? | select(.type == \"Recommended\") | {type, status, reason}]}]}}" \
  clusterversion version

collect clusteroperators "{kind: \"List\", items: [.items[] | {kind, metadata: {name: .metadata.name},
  status: {conditions: $CONDS, versions: [.status.versions[]? | select(.name == \"operator\") | {name, version}]}}]}" \
  clusteroperators

collect mcp "{kind: \"List\", items: [.items[] | {kind, metadata: {name: .metadata.name}, spec: {paused: (.spec.paused // false)},
  status: {conditions: [.status.conditions[]? | select(.type == \"Updated\" or .type == \"Updating\" or .type == \"Degraded\") | {type, status, reason}],
           machineCount: .status.machineCount, updatedMachineCount: .status.updatedMachineCount, degradedMachineCount: .status.degradedMachineCount}}]}" \
  machineconfigpools

# Subscriptions: spec.config (which can hold environment values) is never kept.
collect subscriptions "{kind: \"List\", items: [.items[] | {kind, metadata: {name: .metadata.name, namespace: .metadata.namespace},
  spec: {name: .spec.name, channel: .spec.channel, source: .spec.source, installPlanApproval: .spec.installPlanApproval},
  status: {installedCSV: .status.installedCSV, currentCSV: .status.currentCSV, state: .status.state}}]}" \
  subscriptions.operators.coreos.com -A

# CSVs: copies OLM places in every namespace are skipped; of the annotations only the
# olm.maxOpenShiftVersion property is kept.
collect csv "{kind: \"List\", items: [.items[] | select((.metadata.labels[\"olm.copiedFrom\"] // \"\") == \"\") | {kind,
  metadata: {name: .metadata.name, namespace: .metadata.namespace},
  spec: {version: .spec.version},
  status: {phase: .status.phase},
  maxOpenShiftVersion: ((.metadata.annotations[\"olm.properties\"] // \"[]\") | (try fromjson catch []) | map(select(.type == \"olm.maxOpenShiftVersion\") | .value) | first // null)}]}" \
  clusterserviceversions.operators.coreos.com -A

# APIRequestCount: only APIs that are scheduled for removal; totals only (no user names).
collect apirequestcounts "{kind: \"List\", items: [.items[] | select(.status.removedInRelease != null and .status.removedInRelease != \"\") | {kind,
  metadata: {name: .metadata.name}, status: {removedInRelease: .status.removedInRelease, requestCount: .status.requestCount}}]}" \
  apirequestcounts.apiserver.openshift.io

# Administrator acknowledgement gates (descriptions) and which ones were given (true/false only).
collect admingates "{kind, data: ((.data // {}) | map_values(redact))}" configmap admin-gates -n openshift-config-managed
collect adminacks "{kind, data: ((.data // {}) | with_entries(select(.key | startswith(\"ack-\")) | .value |= (. == \"true\")))}" configmap admin-acks -n openshift-config

jq -n --arg at "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  --slurpfile clusterversion "$TMP/clusterversion.json" --slurpfile clusteroperators "$TMP/clusteroperators.json" \
  --slurpfile mcp "$TMP/mcp.json" --slurpfile subscriptions "$TMP/subscriptions.json" --slurpfile csv "$TMP/csv.json" \
  --slurpfile apirequestcounts "$TMP/apirequestcounts.json" --slurpfile admingates "$TMP/admingates.json" --slurpfile adminacks "$TMP/adminacks.json" \
  '{kind: "OAAReadinessBundle", apiVersion: "v1", collector: "oaa-readiness-collector/1", collectedAt: $at,
    sections: {clusterversion: $clusterversion[0], clusteroperators: $clusteroperators[0], mcp: $mcp[0], subscriptions: $subscriptions[0],
               csv: $csv[0], apirequestcounts: $apirequestcounts[0], admingates: $admingates[0], adminacks: $adminacks[0]}}' >"$OUT"

echo "Wrote $OUT ($(wc -c <"$OUT") bytes). Review it, then upload it on Upgrade > Readiness." >&2
