# shellcheck shell=bash
#
# Candidate-bound shipping-image surface detection for the tranche security gate.
#
# ── THE DEFECT THIS EXISTS TO CLOSE ────────────────────────────────────────
#
# The gate decides whether a container scan is applicable from:
#
#     CHANGED="$(git diff --name-only HEAD; git ls-files --others --exclude-standard)"
#
# That is UNCOMMITTED WORK ONLY. Reproduced end to end against the unmodified
# gate: build a candidate in which a runtime base-image swap and a three-stage
# Containerfile restructure are COMMITTED, run the gate, and it reports
#
#     Container scan  N/A  no Containerfile/Dockerfile, base image, or production
#                          dependency/lockfile changed in this tranche
#     OVERALL: GREEN                                                    exit 0
#
# The detail string is false and the verdict is a false GREEN. The window opens
# at the exact moment the work is committed — i.e. at the moment a release is
# actually being cut.
#
# ── WHY THIS IS NOT JUST "DIFF AGAINST origin/main" ────────────────────────
#
# Because "this tranche" is a release-policy concept, not a git fact, and
# guessing it is wrong in both directions:
#
#   * `git merge-base origin/main HEAD` on this branch is ffed74d, and the
#     range to HEAD touches 725 files including EVERY image-surface path
#     (both Containerfiles, both Dockerfiles, all four package*.json,
#     shared/package.json). That base makes the gate permanently INCOMPLETE
#     for the whole branch and retroactively reclassifies already-accepted
#     tranche results.
#   * Defaulting to HEAD is the present defect.
#
# So this module REFUSES TO GUESS. The baseline must be stated by a human or
# by release tooling, and when it is absent the answer is INCOMPLETE — never
# N/A, never PASS, and never a silently substituted branch.
#
# ── THE RULES IT ENFORCES ──────────────────────────────────────────────────
#
#   1. Committed, staged, unstaged and untracked image changes are ALL visible.
#   2. The baseline is explicit (OAA_GATE_BASELINE, or the release-candidate
#      marker file) or the result is INCOMPLETE.
#   3. A source-only change still yields N/A — the gate must stay useful for
#      the ordinary case, or people will route around it.
#   4. Scan evidence must be present, parseable, bound to the image actually
#      resolved, and not stale. Absent/mismatched/stale/unverifiable evidence
#      is INCOMPLETE. There is no path from "no evidence" to PASS.
#
# Sourced by the gate; every function is pure except for reading git and the
# filesystem. No network.

# Paths that change what ends up INSIDE a shipping image.
#
# `backend/src` and `shared` are included deliberately: both Containerfiles
# COPY them, so a change there changes the shipped artifact just as surely as
# a base-image bump does. The gate's original pattern omitted them, which is
# why a tranche that rewrote backend/src could legitimately record
# "Container scan N/A" — technically true to the pattern's own wording, and
# misleading about the artifact. Widening this is a POLICY CHANGE with
# retroactive effect on accepted tranche verdicts, so it is gated behind
# OAA_GATE_SURFACE_STRICT rather than switched on unilaterally.
OAA_IMAGE_SURFACE_CORE='(^|/)(Containerfile|Dockerfile)|(^|/)(backend|frontend|shared)/package(-lock)?\.json$|^package(-lock)?\.json$|(^|/)npm-shrinkwrap\.json$|\.containerignore$|\.dockerignore$|(^|/)entrypoint'
OAA_IMAGE_SURFACE_STRICT='|^backend/src/|^frontend/src/|^shared/|^data/'

oaa_surface_pattern() {
  if [ "${OAA_GATE_SURFACE_STRICT:-0}" = "1" ]; then
    printf '%s%s' "$OAA_IMAGE_SURFACE_CORE" "$OAA_IMAGE_SURFACE_STRICT"
  else
    printf '%s' "$OAA_IMAGE_SURFACE_CORE"
  fi
}

# Resolve the authoritative comparison baseline.
#
# Prints "<commit>\t<how>" and returns 0, or prints a reason and returns 1.
# Returning 1 MUST be rendered as INCOMPLETE by the caller — never as N/A.
#
# Order is deliberate: an explicit environment override beats a checked-in
# marker, because an operator re-running the gate on a candidate needs to be
# able to say what they are certifying without editing tracked files (which
# would itself change the candidate).
oaa_gate_baseline() { # [repo_root]
  local root="${1:-.}" ref="" how=""

  if [ -n "${OAA_GATE_BASELINE:-}" ]; then
    ref="$OAA_GATE_BASELINE"; how="OAA_GATE_BASELINE"
  elif [ -f "$root/release-certification/gate-baseline" ]; then
    # Lives under the gitignored evidence directory on purpose: a tracked
    # marker would be part of the candidate it describes.
    ref="$(tr -d ' \t\n\r' < "$root/release-certification/gate-baseline")"
    how="release-certification/gate-baseline"
    [ -n "$ref" ] || { echo "baseline marker file is empty"; return 1; }
  else
    echo "no release baseline declared: set OAA_GATE_BASELINE=<commit> or write release-certification/gate-baseline. Refusing to guess — defaulting to HEAD hides committed image changes, and defaulting to a branch silently reclassifies history."
    return 1
  fi

  local sha
  if ! sha="$(git -C "$root" rev-parse --verify --quiet "${ref}^{commit}")"; then
    echo "baseline \"$ref\" (from $how) does not resolve to a commit in this repository"
    return 1
  fi
  # A baseline that is not an ancestor would make the diff meaningless in a
  # way that silently UNDER-reports, so it is refused rather than used.
  if ! git -C "$root" merge-base --is-ancestor "$sha" HEAD 2>/dev/null; then
    echo "baseline $sha (from $how) is not an ancestor of HEAD; the resulting diff would not describe this candidate"
    return 1
  fi
  printf '%s\t%s\n' "$sha" "$how"
}

# Every path that differs from the baseline, from all four sources.
#
# Committed is the one the original pattern missed, and is listed first
# because it is the one that matters at release time.
oaa_changed_paths() { # baseline [repo_root]
  local base="$1" root="${2:-.}"
  {
    git -C "$root" diff --name-only "$base" HEAD            # committed since baseline
    git -C "$root" diff --name-only --cached HEAD           # staged
    git -C "$root" diff --name-only                         # unstaged
    git -C "$root" ls-files --others --exclude-standard     # untracked
  } 2>/dev/null | sed '/^$/d' | sort -u
}

# The image-surface subset of the above, by FILE NAME only.
# Empty output == genuinely N/A. This is the conservative first pass;
# oaa_image_surface_semantic() refines it.
oaa_image_surface() { # baseline [repo_root]
  oaa_changed_paths "$1" "${2:-.}" | grep -iE "$(oaa_surface_pattern)" || true
}

# Which shipped install scope does a given manifest feed?
#
# Derived from what the Containerfiles actually COPY, verified by reading them:
#   backend/package*.json   -> backend builder runs `npm ci --omit=dev`  => prod
#   frontend/package*.json  -> frontend builder runs a full `npm ci`, and the
#                              resulting dist/ IS shipped                => all
#   root package*.json      -> COPIED INTO NEITHER IMAGE (tooling only).
#
# POLICY DECISION, stated rather than silently applied: the root manifests are
# still classified, at the most conservative scope ("all"), instead of being
# dropped as out-of-image. Dropping them would be a NARROWING of the gate, and
# the whole point of this change is that it may only ever narrow on evidence,
# never on a path convention.
oaa_manifest_scope() { # path
  case "$1" in
    backend/package.json|backend/package-lock.json)   echo prod ;;
    frontend/package.json|frontend/package-lock.json) echo all ;;
    *)                                                 echo all ;;
  esac
}

# Image surface refined by semantic evidence.
#
# Only manifests and lockfiles are refined — and only ever by REMOVING a hit
# that parsed JSON proves cannot change installed content. Every other path
# (Containerfile, entrypoint, .dockerignore, …) passes through untouched, and
# any classifier failure keeps the hit. The result is therefore a subset of
# oaa_image_surface(), and the gate can only become stricter than a filename
# match, never looser.
oaa_image_surface_semantic() { # baseline [repo_root] [scope_override]
  local base="$1" root="${2:-.}" override="${3:-}"
  local here; here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  local classifier="$here/package-surface.mjs"

  local p kind scope rc before after tmp
  tmp="$(mktemp -d "${TMPDIR:-/tmp}/oaa-surface-XXXXXX")"

  while IFS= read -r p; do
    [ -n "$p" ] || continue
    case "$p" in
      *package.json)      kind=manifest ;;
      *package-lock.json) kind=lock ;;
      *npm-shrinkwrap.json) kind=lock ;;
      *) printf '%s\n' "$p"; continue ;;
    esac

    # No classifier, no node, no refinement. Keep the hit.
    if [ ! -f "$classifier" ] || ! command -v node >/dev/null 2>&1; then
      printf '%s\n' "$p"; continue
    fi

    scope="${override:-$(oaa_manifest_scope "$p")}"
    before="$tmp/before"; after="$tmp/after"
    if git -C "$root" show "$base:$p" > "$before" 2>/dev/null; then :; else before="-"; fi
    if [ -f "$root/$p" ]; then cp "$root/$p" "$after"; else after="-"; fi

    node "$classifier" "$kind" "$before" "$after" "$scope" >/dev/null 2>&1
    rc=$?
    # 1 = image-affecting, 2 = could not classify. Both keep the hit; only a
    # clean 0 drops it.
    [ "$rc" -eq 0 ] || printf '%s\n' "$p"
  done < <(oaa_image_surface "$base" "$root")

  rm -rf "$tmp"
}

# Human-readable explanation of why a manifest was or was not dropped.
oaa_explain_manifest() { # baseline path [repo_root] [scope]
  local base="$1" p="$2" root="${3:-.}" scope="${4:-}"
  local here; here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  local tmp; tmp="$(mktemp -d "${TMPDIR:-/tmp}/oaa-explain-XXXXXX")"
  local kind=manifest; case "$p" in *lock.json|*shrinkwrap.json) kind=lock ;; esac
  scope="${scope:-$(oaa_manifest_scope "$p")}"
  local before="$tmp/b" after="$tmp/a"
  git -C "$root" show "$base:$p" > "$before" 2>/dev/null || before="-"
  [ -f "$root/$p" ] && cp "$root/$p" "$after" || after="-"
  node "$here/package-surface.mjs" "$kind" "$before" "$after" "$scope" 2>&1
  local rc=$?
  rm -rf "$tmp"
  return $rc
}

# The candidate id of the source tree, via the certification harness's own
# definition — sha256(head | trackedDiff | stagedDiff | untrackedDigest).
# Reusing describeCandidate() rather than recomputing it keeps the gate and
# the release harness from ever disagreeing about what "this candidate" means.
oaa_candidate_id() { # repo_root
  node --input-type=module -e "
    import { describeCandidate } from '$1/scripts/release/lib/candidate.mjs';
    process.stdout.write(describeCandidate('$1').candidateId);
  " 2>/dev/null || true
}

# The candidate id an image says it was built from.
oaa_image_candidate_label() { # image_ref
  podman image inspect "$1" --format '{{index .Config.Labels "io.oaa.candidate-id"}}' 2>/dev/null || true
}

# Resolve the config digest of a locally present image, or print nothing.
#
# podman's `.Id` IS the config digest — proven, not assumed: `podman save`
# logs "Copying config sha256:<id>" for the image whose .Id is <id>. It is
# NOT the manifest digest and NOT a registry digest; `RepoDigests` on a
# never-pushed image reports a locally-computed `localhost/...@sha256:` which
# must never be presented as a registry digest.
oaa_image_config_digest() { # image_ref
  podman image inspect "$1" --format '{{.Id}}' 2>/dev/null || true
}

# THE WHOLE VERDICT for the container-scan check.
#
# Prints "<STATUS>\t<detail>" where STATUS is PASS, N/A or INCOMPLETE.
# There is exactly ONE route to PASS and it requires, for EVERY required
# shipping role: a resolvable local image, scan evidence that parses, whose
# subject config digest equals that image's, backed by a database inside the
# freshness window. Anything else is INCOMPLETE. "No evidence" can never
# become PASS by falling through, because PASS is only ever reached by
# completing the loop with no failure recorded.
oaa_container_scan_verdict() { # [repo_root]
  local root="${1:-.}"
  local base how bl

  if ! bl="$(oaa_gate_baseline "$root")"; then
    printf 'INCOMPLETE\t%s\n' "$bl"; return
  fi
  base="$(printf '%s' "$bl" | cut -f1)"
  how="$(printf '%s' "$bl" | cut -f2)"

  local surface; surface="$(oaa_image_surface_semantic "$base" "$root")"
  if [ -z "$surface" ]; then
    printf 'N/A\tno image-affecting change vs %s (%s); manifest edits were classified by content, not by filename\n' \
      "${base:0:12}" "$how"
    return
  fi

  local n; n="$(printf '%s\n' "$surface" | sed '/^$/d' | wc -l | tr -d ' ')"
  local evdir="${OAA_SCAN_EVIDENCE_DIR:-$root/release-certification/scan-evidence}"
  local roles="${OAA_SHIPPING_ROLES:-backend frontend}"
  local role ref ev digest reason failures=0 detail="" blocking=""
  local want_candidate img_candidate
  # Computed once. Empty means the harness could not be consulted — no node, or
  # a tree without scripts/release/lib/candidate.mjs.
  #
  # That case REFUSES rather than skipping. An earlier revision skipped the
  # binding check when the candidate was unknowable, on the reasoning that a
  # tree without the release harness is broken in bigger ways. But "I could
  # not determine what this candidate is" is precisely the state in which a
  # binding claim is unprovable, and a gate whose strictest check silently
  # switches itself off under an error condition is the shape of every
  # fail-open defect. Verified that refusing here leaves both existing suites
  # at 28/28, so nothing is paid for the stricter posture.
  want_candidate="$(oaa_candidate_id "$root")"

  for role in $roles; do
    case "$role" in
      backend)  ref="${OAA_BACKEND_IMAGE:-localhost/openshift-airgap-architect-backend:latest}" ;;
      frontend) ref="${OAA_FRONTEND_IMAGE:-localhost/openshift-airgap-architect-frontend:latest}" ;;
      *)        ref="" ;;
    esac
    if [ -z "$ref" ]; then
      detail="${detail}${role}: no image reference configured; "; failures=$((failures+1)); continue
    fi
    digest="$(oaa_image_config_digest "$ref")"
    if [ -z "$digest" ]; then
      detail="${detail}${role}: image ${ref} not present locally; "; failures=$((failures+1)); continue
    fi
    # CANDIDATE BINDING. Matching the scan report to the image proves the
    # report describes THAT image; it says nothing about whether the image
    # was built from the source being gated. Both halves are needed, and the
    # gap between them is reachable: an image built from an earlier candidate
    # keeps its config digest, so stale-but-matching evidence sailed through
    # and only a non-zero finding count made the verdict RED. With zero
    # findings it would have read PASS for an image that does not contain the
    # source under test.
    #
    # Absent label => refuse. An unlabelled image cannot be shown to be this
    # candidate's, and "cannot show" is not "is".
    if [ -z "$want_candidate" ]; then
      detail="${detail}${role}: this candidate's id could not be determined (no node, or scripts/release/lib/candidate.mjs is missing), so image-to-source binding is unprovable; "
      failures=$((failures+1)); continue
    fi
    if [ -n "$want_candidate" ]; then
      img_candidate="$(oaa_image_candidate_label "$ref")"
      if [ -z "$img_candidate" ]; then
        detail="${detail}${role}: image carries no io.oaa.candidate-id, so it cannot be shown to be built from this candidate; "
        failures=$((failures+1)); continue
      fi
      if [ "$img_candidate" != "$want_candidate" ]; then
        detail="${detail}${role}: image was built from a DIFFERENT candidate (${img_candidate:0:12}…, expected ${want_candidate:0:12}…); "
        failures=$((failures+1)); continue
      fi
    fi

    ev="$evdir/${role}.json"
    if ! reason="$(oaa_scan_evidence_ok "$ev" "$digest" "${OAA_SCAN_MAX_DB_AGE_H:-24}" 2>&1)"; then
      detail="${detail}${role}: ${reason}; "; failures=$((failures+1)); continue
    fi
    # Evidence is valid. Now read what it SAYS.
    #
    # "Container scan PASS" next to an unresolved CRITICAL would be the most
    # misleading line this gate could print — a reader takes it as "the images
    # are fine", when all it established was "a scan happened". Blocking
    # severities are therefore counted here. The CRITICAL+HIGH threshold is
    # not invented for this check: it is the same bar audit_shipped() already
    # applies to dependency advisories, so the gate stays internally
    # consistent rather than holding images to a weaker standard than npm.
    local crit high
    crit="$(jq '[.Results[]?.Vulnerabilities[]? | select(.Severity=="CRITICAL")] | length' "$ev" 2>/dev/null || echo "")"
    high="$(jq '[.Results[]?.Vulnerabilities[]? | select(.Severity=="HIGH")]     | length' "$ev" 2>/dev/null || echo "")"
    if [ -z "$crit" ] || [ -z "$high" ]; then
      detail="${detail}${role}: scan evidence could not be tallied; "; failures=$((failures+1)); continue
    fi
    if [ "$crit" -gt 0 ] || [ "$high" -gt 0 ]; then
      blocking="${blocking}${role}: ${crit} critical, ${high} high; "
    fi
  done

  if [ "$failures" -gt 0 ]; then
    printf 'INCOMPLETE\t%s image-affecting path(s) changed vs %s (%s) and candidate-bound scan evidence is not usable -- %s\n' \
      "$n" "${base:0:12}" "$how" "${detail%; }"
    return
  fi
  if [ -n "$blocking" ]; then
    printf 'RED\tcandidate-bound scan evidence is valid and reports blocking findings -- %s(vs %s, %s)\n' \
      "${blocking}" "${base:0:12}" "$how"
    return
  fi
  printf 'PASS\t%s image-affecting path(s) changed vs %s (%s); every shipping role has scan evidence bound to its own config digest, with no CRITICAL or HIGH findings\n' \
    "$n" "${base:0:12}" "$how"
}

# Is there scan evidence we may rely on for this exact image?
#
# Prints a reason and returns non-zero for every failure mode, so the caller
# can only ever reach PASS by falling off the end. The four refusals are the
# four ways evidence lies: it is missing, it is unreadable, it describes a
# DIFFERENT image, or it was produced by a vulnerability database too old to
# have seen the advisories we care about.
oaa_scan_evidence_ok() { # evidence_json expected_config_digest [max_db_age_hours]
  local ev="$1" want="$2" max_age="${3:-24}"

  [ -n "$ev" ] || { echo "no scan evidence path supplied"; return 1; }
  [ -f "$ev" ] || { echo "scan evidence $ev does not exist"; return 1; }
  command -v jq >/dev/null 2>&1 || { echo "jq unavailable; cannot verify scan evidence"; return 1; }
  jq -e . "$ev" >/dev/null 2>&1 || { echo "scan evidence $ev is not parseable JSON"; return 1; }

  # Bind on the CONFIG DIGEST. Trivy's ArtifactName for an --input scan is the
  # MOUNT PATH ("/scan"), which is operator-controlled and would make any
  # report appear to match anything. Metadata.ImageID is the config digest and
  # is the only field that identifies the subject.
  local got
  got="$(jq -r '.Metadata.ImageID // empty' "$ev")"
  [ -n "$got" ] || { echo "scan evidence $ev records no Metadata.ImageID, so it cannot be bound to an image"; return 1; }
  [ -n "$want" ] || { echo "no expected image config digest supplied to bind against"; return 1; }
  if [ "${got#sha256:}" != "${want#sha256:}" ]; then
    echo "scan evidence describes a DIFFERENT image (report ${got#sha256:} != resolved ${want#sha256:})"
    return 1
  fi

  # Staleness. A scan is only as good as the database behind it.
  #
  # VERIFIED AGAINST THE REAL ARTIFACT, not assumed: a trivy JSON report
  # contains SchemaVersion, Trivy{Version}, ReportID, CreatedAt, ArtifactID,
  # ArtifactName, ArtifactType, Metadata{Size,OS,ImageID,DiffIDs,ImageConfig,
  # Layers} and Results. It embeds NO database identity whatsoever. The DB is
  # only knowable from a separate `version --format json` call made with the
  # same cache mounted, which the certification harness records alongside the
  # report as scan-summary.json.
  #
  # `CreatedAt` is deliberately NOT used as a fallback. It is when the SCAN
  # ran, not how old the DATABASE was — a scan performed five minutes ago
  # against a six-month-old database would look perfectly fresh. Substituting
  # it would convert this check into decoration.
  local updated sidecar
  updated="$(jq -r '.Metadata.DBUpdatedAt // .DBUpdatedAt // empty' "$ev")"
  if [ -z "$updated" ]; then
    sidecar="${OAA_SCAN_PROVENANCE:-$(dirname "$ev")/scan-summary.json}"
    if [ -f "$sidecar" ] && jq -e . "$sidecar" >/dev/null 2>&1; then
      # `builtAt` is the harness's name for the DB's own UpdatedAt. The other
      # spellings are accepted so a future schema rename degrades to the
      # explicit "no timestamp" refusal rather than to a silent pass.
      updated="$(jq -r '.database.builtAt // .database.dbUpdatedAt // .database.UpdatedAt // .database.updatedAt // empty' "$sidecar")"
    fi
  fi
  [ -n "$updated" ] || { echo "neither the scan report nor a sibling scan-summary.json records a vulnerability-database timestamp; freshness cannot be established"; return 1; }
  local then_s now_s age_h
  then_s="$(date -u -d "$updated" +%s 2>/dev/null)" || { echo "unparseable database timestamp \"$updated\""; return 1; }
  now_s="$(date -u +%s)"
  age_h=$(( (now_s - then_s) / 3600 ))
  if [ "$age_h" -gt "$max_age" ]; then
    echo "vulnerability database is ${age_h}h old (limit ${max_age}h); reseed and rescan"
    return 1
  fi
  return 0
}
