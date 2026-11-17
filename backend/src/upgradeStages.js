/**
 * Upgrade stages ↔ Mirroring profiles (v2.3.0, RFC §4 and §8.2).
 *
 * The cluster's update route (graph) and the content that must be in the
 * disconnected registry are different things. Every release the cluster
 * passes through — every intermediate and the target, but not the release it
 * already runs — must be mirrored. Each of those releases becomes ONE stage,
 * and each stage is ONE Upgrade-owned Mirroring profile with exactly one
 * pinned release (`stable-<minor>`, minVersion = maxVersion = release) and
 * its own operator catalog at the same minor.
 *
 * Why one release per configuration (verified against the exact oc-mirror
 * 4.22 binary, docs/UPGRADE_WORKFLOW.md §4):
 *  - several platform channels in one configuration trigger oc-mirror's own
 *    cross-channel calculation, which adds releases nobody planned (it added
 *    4.20.44 to a pinned 4.20.14 + 4.21.40 + 4.22.22 set) and fails outright
 *    for eus-4.20 + eus-4.22 (NoVersionsFound in the empty eus-4.21);
 *  - a range with only maxVersion pulls in 4.18/4.19 releases.
 * One pinned release per configuration triggers none of that, and it is
 * exactly the configuration shape the Mirroring workflow already generates,
 * validates, runs, transfers and verifies.
 *
 * Developed with AI assistance from Claude (Anthropic).
 */
import { getMinorVersion, compareVersions } from "../../shared/versionUtils.js";

/** Graph API architecture → the profile's (blueprint-style) architecture name. */
export const PROFILE_ARCH = Object.freeze({ amd64: "x86_64", arm64: "aarch64", s390x: "s390x", ppc64le: "ppc64le" });

/**
 * The stages a solved route needs: one per release the cluster is updated to,
 * in update order.
 */
export const stageSpecs = (plan) => {
  if (!plan?.path?.hops?.length) return [];
  const seen = new Set();
  const specs = [];
  for (const hop of plan.path.hops) {
    if (seen.has(hop.to)) continue;
    seen.add(hop.to);
    specs.push({ release: hop.to, minor: getMinorVersion(hop.to) });
  }
  specs.sort((a, b) => compareVersions(a.release, b.release));
  return specs.map((s, i) => ({ ...s, id: `s${i + 1}`, graph: i === 0 }));
};

/**
 * Where a stage's content stands, from evidence only (profile records and
 * job results). Cluster progress is never inferred from mirroring.
 */
export const stageContentStatus = ({ profile, jobs }) => {
  if (!profile) return { state: "profile-missing", evidence: [] };
  const evidence = [];
  const ok = (j) => ["completed", "completed_with_warnings"].includes(j.status);
  const real = jobs.filter((j) => j.type === "oc-mirror-run" && !j.meta.dryRun);
  const m2d = real.filter((j) => j.meta.mode === "mirrorToDisk" && ok(j));
  const m2m = real.filter((j) => j.meta.mode === "mirrorToMirror" && ok(j));
  const d2m = real.filter((j) => j.meta.mode === "diskToMirror" && ok(j));
  const verified = [...m2m, ...d2m].filter((j) => j.meta.verification?.state === "fully-verified");
  if (m2d.length) evidence.push({ kind: "mirrored-to-disk", jobId: m2d[m2d.length - 1].id });
  if ((profile.transfers || []).length) evidence.push({ kind: "transfer-prepared", count: profile.transfers.length });
  if (m2m.length) evidence.push({ kind: "mirrored-to-registry", jobId: m2m[m2m.length - 1].id });
  if (d2m.length) evidence.push({ kind: "loaded-into-registry", jobId: d2m[d2m.length - 1].id });
  if (verified.length) evidence.push({ kind: "registry-verified", jobId: verified[verified.length - 1].id, scope: verified[verified.length - 1].meta.verification.scope || null });
  if ((profile.received || []).length) evidence.push({ kind: "transfer-received", count: profile.received.length });
  const running = jobs.some((j) => j.status === "running");
  const state = running ? "running"
    : verified.length ? "registry-verified"
      : m2m.length || d2m.length ? "in-registry-unverified"
        : (profile.received || []).length ? "transfer-received"
          : (profile.transfers || []).length ? "transfer-prepared"
            : m2d.length ? "mirrored-to-disk"
              : "planned";
  return { state, evidence };
};

/**
 * The Mirroring profile that carries a stage: the Upgrade-owned profile of a
 * planned plan, or — for a plan imported on the disconnected side — the
 * received profile created from that stage's transfer (matched by the
 * connected-side profile id the transfer manifest records).
 */
export const stageProfileFor = (plan, stage, profiles) => {
  if (plan.kind === "received") {
    return Object.values(profiles).find((p) => p.kind === "received" && stage.originProfileId && p.origin?.profileId === stage.originProfileId) || null;
  }
  const p = profiles[stage.profileId];
  return p && p.ownedBy?.planId === plan.id ? p : null;
};

/**
 * Do the prepared stages still match the route? (v2.3.0 owner QA, P0.) The route can change —
 * current release, target, conditional review, a chosen alternative — after the stages were
 * prepared; stages that no longer match must never be shown or mirrored as the current route.
 * Derived on every read, so no stored flag can go stale. null = they match (or none prepared).
 */
export const stageRouteMismatch = (plan) => {
  if (!plan?.stages?.length || plan.kind === "received") return null;
  const have = plan.stages.map((s) => s.release);
  if (!plan.path) return { reason: "route-cleared", want: [], have, missing: [], extra: have };
  const want = stageSpecs(plan).map((s) => s.release);
  const missing = want.filter((r) => !have.includes(r));
  const extra = have.filter((r) => !want.includes(r));
  return missing.length || extra.length ? { reason: "route-changed", want, have, missing, extra } : null;
};
