/**
 * OpenShift Airgap Architect - Scenario Quick Picks buttons, shared by Install
 * and Mirroring (v2.2.0, R-UX07)
 *
 * Presentation only: the definitions and the version-aware resolution come
 * from shared/operatorQuickPicks.js; each workflow says which picks are
 * active or pending for ITS selection and what a click does. A version-aware
 * pick with no row for the minor is disabled (no fallback to another minor).
 *
 * @author Bill Strauss
 *
 * Developed with AI assistance from Claude (Anthropic).
 */
import React from "react";

export default function ScenarioQuickPicks({ scenarios, version, ready, isActive, isPending, onToggle, notReadyTitle = "Scenario picks need operator catalogs" }) {
  return (
    <div className="scenario-picks">
      {scenarios.map((scenario) => {
        const isVersionAware = Boolean(scenario.versionPicks);
        // No `default` fallback: a version-aware pick with no row for this
        // minor is undefined, not "the previous minor's list".
        const effectiveVersion = isVersionAware && scenario.versionPicks[version] ? version : null;
        const isUndefinedForVersion = isVersionAware && !effectiveVersion;
        const active = Boolean(isActive(scenario.id));
        // Chosen under a previous minor and not yet reconciled: this is
        // intent, not a current selection, so it must not read as active.
        const pending = !active && Boolean(isPending(scenario.id));
        const titleText = pending
          ? `Previously selected — will be re-applied after the OpenShift ${version} operator scan`
          : isUndefinedForVersion
            ? `Not defined for OpenShift ${version || "(no version selected)"}`
            : !ready
              ? notReadyTitle
              : scenario.description
                ? `${scenario.description}${isVersionAware ? ` (${effectiveVersion})` : ""}`
                : isVersionAware
                  ? `Version-aware quick pick (${effectiveVersion})`
                  : "";

        return (
          <button
            key={scenario.id}
            type="button"
            className={`scenario-pick ${active ? "selected" : ""}${pending ? " pending" : ""}`}
            onClick={() => onToggle(scenario)}
            title={titleText}
            disabled={!ready || isUndefinedForVersion}
            aria-pressed={active}
            data-selection-state={active ? "active" : pending ? "pending" : "none"}
          >
            <span className="scenario-pick-label">{scenario.label}</span>
            {isVersionAware && effectiveVersion && (
              <span className="scenario-pick-version subtle" aria-label={`for OpenShift ${effectiveVersion}`}>
                {effectiveVersion}
              </span>
            )}
            {active ? <span className="scenario-pick-check" aria-hidden>✓</span> : null}
            {pending ? (
              <span className="scenario-pick-pending">Pending review</span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
