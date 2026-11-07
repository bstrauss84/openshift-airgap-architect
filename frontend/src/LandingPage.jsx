/**
 * OpenShift Airgap Architect - Landing Page
 *
 * Three independent workflows: Install, Upgrade and Mirroring (v2.3.0).
 * Each card says what already exists, and every action is scoped to its own
 * workflow (RFC §18.2): there is no global reset. Opening a workflow is
 * navigation only. "New Install…" is the one destructive action here,
 * and it opens a confirmation that lists exactly what is cleared and kept.
 *
 * @author Bill Strauss
 *
 * Developed with AI assistance from Claude (Anthropic) and Cursor AI.
 */
import React, { useEffect, useState } from "react";
import { apiFetch } from "./api.js";

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/** What Mirroring and Upgrade already hold (read-only; failures just hide the line). */
function useWorkflowSummaries(enabled) {
  const [summaries, setSummaries] = useState({ mirroring: null, upgrade: null });
  useEffect(() => {
    if (!enabled) return undefined;
    let cancelled = false;
    (async () => {
      const [m, u] = await Promise.allSettled([apiFetch("/api/mirroring"), apiFetch("/api/upgrade")]);
      if (cancelled) return;
      setSummaries({
        // Upgrade-owned stage profiles belong to their plans: counted on the Upgrade card, not as Mirroring profiles.
        mirroring: m.status === "fulfilled" && Array.isArray(m.value?.profiles)
          ? { profiles: m.value.profiles.filter((p) => !p.ownedBy).length }
          : null,
        upgrade: u.status === "fulfilled" && Array.isArray(u.value?.plans)
          ? { plans: u.value.plans.length, stages: u.value.plans.reduce((n, p) => n + (Array.isArray(p.stages) ? p.stages.length : 0), 0) }
          : null
      });
    })();
    return () => { cancelled = true; };
  }, [enabled]);
  return summaries;
}

const LandingPage = ({ hasProgress, installStatus = null, onStartInstall, onStartNewInstall = null, onStartMirroring, onStartUpgrade = null, loadSummaries = false }) => {
  const installCta = hasProgress ? "Continue install →" : "Start install →";
  const summaries = useWorkflowSummaries(loadSummaries);
  const installLine = hasProgress
    ? `In progress${installStatus?.step ? ` — ${installStatus.step}` : ""}${installStatus?.version ? ` · OpenShift ${installStatus.version}` : ""}`
    : "Not started";
  const mirroringLine = summaries.mirroring
    ? summaries.mirroring.profiles ? plural(summaries.mirroring.profiles, "profile", "profiles") : "No profiles yet"
    : null;
  const upgradeLine = summaries.upgrade
    ? summaries.upgrade.plans
      ? `${plural(summaries.upgrade.plans, "plan", "plans")}${summaries.upgrade.stages ? ` · ${plural(summaries.upgrade.stages, "mirroring stage", "mirroring stages")}` : ""}`
      : "No plans yet"
    : null;

  return (
    <div className="landing">
      <div className="landing-header">
        <h1 className="landing-title">What would you like to do?</h1>
        <p className="landing-subtitle">Choose a path to get started. Each workflow keeps its own work; opening one never changes another.</p>
      </div>
      <div className="landing-cards">
        <div className="landing-card-wrap">
          {/* Two separate actions in the card's own footer bar (owner correction): the card body is not a
              button, so the actions never nest inside one another. */}
          <div className="landing-card landing-card-install" role="group" aria-labelledby="landing-install-title">
            <div className="landing-card-inner">
              <div className="landing-card-top">
                <h2 className="landing-card-title" id="landing-install-title">Install</h2>
                <p className="landing-card-subtitle">Net-new disconnected install</p>
              </div>
              <p className="landing-card-desc">
                Create a new OpenShift cluster in an air-gapped environment. Configure blueprint, release,
                methodology, operators, and generate install assets.
              </p>
              <p className="landing-card-status" data-testid="landing-install-status">{installLine}</p>
              <div className="landing-card-footer-rail landing-card-actions">
                <button type="button" className="landing-card-action" onClick={onStartInstall}>{installCta}</button>
                {hasProgress && onStartNewInstall ? (
                  <>
                    <span className="landing-card-action-divider" aria-hidden="true" />
                    <button type="button" className="landing-card-action" onClick={onStartNewInstall}>New Install</button>
                  </>
                ) : null}
              </div>
            </div>
          </div>
        </div>

        <div className="landing-card-wrap">
          <button
            type="button"
            className="landing-card landing-card-upgrade"
            onClick={onStartUpgrade || undefined}
            disabled={!onStartUpgrade}
            aria-label={summaries.upgrade?.plans ? "Open Upgrade" : "Plan an upgrade"}
          >
            <div className="landing-card-inner">
              <div className="landing-card-top">
                <h2 className="landing-card-title">Upgrade</h2>
                <p className="landing-card-subtitle">Disconnected cluster updates</p>
              </div>
              <p className="landing-card-desc">
                Plan a supported update route from the OpenShift update graph, mirror every release on it in
                stages, move them across the air gap, and follow OSUS, CLI or web console steps.
              </p>
              {upgradeLine ? <p className="landing-card-status" data-testid="landing-upgrade-status">{upgradeLine}</p> : null}
              <div className="landing-card-footer-rail">{summaries.upgrade?.plans ? "Open Upgrade →" : "Plan an upgrade →"}</div>
            </div>
          </button>
        </div>

        <div className="landing-card-wrap">
          <button
            type="button"
            className="landing-card landing-card-mirroring"
            onClick={onStartMirroring}
            aria-label="Open Mirroring"
          >
            <div className="landing-card-inner">
              <div className="landing-card-top">
                <h2 className="landing-card-title">Mirroring</h2>
                <p className="landing-card-subtitle">Plan content for disconnected sites</p>
              </div>
              <p className="landing-card-desc">
                Plan oc-mirror v2 content without an install: the OpenShift platform release, operators and
                additional images, in independent profiles.
              </p>
              {mirroringLine ? <p className="landing-card-status" data-testid="landing-mirroring-status">{mirroringLine}</p> : null}
              <div className="landing-card-footer-rail">Open Mirroring →</div>
            </div>
          </button>
        </div>
      </div>
    </div>
  );
};

export default LandingPage;
