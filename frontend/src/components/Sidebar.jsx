/**
 * OpenShift Airgap Architect - Sidebar Navigation Component
 *
 * Collapsible sidebar navigation for wizard steps.
 * Displays step progress, completion status, errors, and review warnings.
 * Enforces foundational lock-in before other steps are accessible.
 *
 * @author Bill Strauss
 *
 * Developed with AI assistance from Claude (Anthropic) and Cursor AI.
 */
import React from "react";

const Sidebar = ({
  steps,
  activeStepId,
  onStepClick,
  sidebarOpen,
  setSidebarOpen,
  reviewFlags,
  errorFlags,
  completeFlags,
  visitedSteps,
  isImported = false,
  operationsCount = 0,
  foundationalLocked = true,
  lockToast,
  setLockToast
}) => {
  /** Before foundational lock-in, only Blueprint and Operations are reachable (Operations for job logs). */
  const isDisabled = (step) =>
    !foundationalLocked && step.id !== "blueprint" && step.id !== "operations";

  // Operational/output tabs don't show completion indicators
  const isOperationalTab = (stepId) => ["assets-guide", "run-oc-mirror", "operations"].includes(stepId);

  return (
    <aside className={`sidebar ${sidebarOpen ? "open" : "collapsed"}`} aria-label="Wizard steps">
      <div className="sidebar-header">
        <button type="button" className="ghost mobile-only" onClick={() => setSidebarOpen(false)} aria-label="Close sidebar">Close</button>
      </div>
      {lockToast ? (
        <div className="sidebar-lock-toast" role="status">
          <span>{lockToast}</span>
          <button type="button" className="ghost" onClick={() => setLockToast?.("")} aria-label="Dismiss">✕</button>
        </div>
      ) : null}
      <nav className="step-list" aria-label="Wizard steps">
        {steps.map((step) => {
          const disabled = isDisabled(step);
          return (
            <button
              key={step.id}
              type="button"
              className={`step-item ${activeStepId === step.id ? "active" : ""} ${disabled ? "disabled" : ""}`}
              onClick={() => {
                if (disabled) {
                  setLockToast?.("Lock your foundational selections to continue.");
                  return;
                }
                onStepClick(step.id);
              }}
              title={step.label}
              disabled={disabled}
              aria-current={activeStepId === step.id ? "step" : undefined}
            >
              <span className="step-label-wrap">
                <span className="step-label">{step.label}</span>
              </span>
              <span className="step-status">
                <span className="step-check">
                  {!isOperationalTab(step.id) && completeFlags?.[step.id] ? "✓" : ""}
                </span>
                {!isOperationalTab(step.id) &&
                activeStepId !== step.id &&
                (visitedSteps?.[step.id] || isImported) &&
                !completeFlags?.[step.id] &&
                (reviewFlags?.[step.id] || errorFlags?.[step.id]) ? (
                  <span className="badge warning">Needs review</span>
                ) : null}
              </span>
            </button>
          );
        })}
      </nav>
      <div className="sidebar-footer">
        <button type="button" className="ghost mobile-only" onClick={() => setSidebarOpen(!sidebarOpen)}>
          {sidebarOpen ? "Hide" : "Menu"}
        </button>
      </div>
    </aside>
  );
};

export default Sidebar;
