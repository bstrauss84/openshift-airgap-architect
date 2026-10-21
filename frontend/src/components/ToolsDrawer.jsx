/**
 * OpenShift Airgap Architect - Tools Drawer Component
 *
 * Right-side overlay drawer for global tools: dark mode toggle, export/import run,
 * start over, and about information. Job logs are on the Operations step (sidebar).
 * Portaled to document.body with backdrop, Escape key close, and focus trap.
 *
 * @author Bill Strauss
 *
 * Developed with AI assistance from Claude (Anthropic) and Cursor AI.
 */
import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Switch from "./Switch.jsx";
import OptionRow from "./OptionRow.jsx";
import Button from "./Button.jsx";
import AboutModal from "./AboutModal.jsx";
import { UPDATE_STATUS, updateStatusOf } from "../../../shared/updateStatus.js";

const DRAWER_Z = 10060;

const checkedSuffix = (updateInfo) =>
  updateInfo.checkedAt ? ` (checked: ${new Date(updateInfo.checkedAt).toLocaleString()})` : "";

/**
 * About-card update line.
 *
 * Driven by the shared update status rather than the legacy `isOutdated` boolean,
 * which only ever meant "the configured branch head differs from this build" and
 * so cannot tell a published release from an ordinary development commit — or
 * from a branch that is OLDER than what is running. Only a verified published
 * release offers an update link; everything else states plainly what is known.
 */
function renderUpdateLine(updateInfo) {
  const guideHref = `https://github.com/${updateInfo.repo || "bstrauss84/openshift-airgap-architect"}/blob/main/docs/UPDATING.md`;

  switch (updateStatusOf(updateInfo)) {
    case UPDATE_STATUS.DISABLED:
      return "Update checks disabled.";
    case UPDATE_STATUS.OFFLINE:
      return `Update check unavailable${updateInfo.checkedAt ? ` (last checked: ${new Date(updateInfo.checkedAt).toLocaleString()})` : ""}.`;
    case UPDATE_STATUS.UNKNOWN:
      return "This build cannot be identified, so update checks are unavailable.";
    case UPDATE_STATUS.DEVELOPMENT_BRANCH_AHEAD:
      return `Development build; ${updateInfo.branch || "main"} is at a different commit. No published release detected${checkedSuffix(updateInfo)}.`;
    case UPDATE_STATUS.PUBLISHED_SUPPORTED_UPDATE:
      return (
        <a href={guideHref} target="_blank" rel="noopener noreferrer">
          Update available — export your run before updating
        </a>
      );
    default:
      return `Up to date${checkedSuffix(updateInfo)}.`;
  }
}

function FocusTrap({ children, onClose, className }) {
  const ref = useRef(null);

  useEffect(() => {
    if (!ref.current) return;
    const el = ref.current;
    const focusables = el.querySelectorAll(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (first) first.focus();

    const onKeyDown = (e) => {
      if (e.key === "Escape") {
        onClose();
        return;
      }
      if (e.key !== "Tab") return;
      if (e.shiftKey) {
        if (document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        }
      } else {
        if (document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };
    el.addEventListener("keydown", onKeyDown);
    return () => el.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return <div ref={ref} className={className}>{children}</div>;
}

export default function ToolsDrawer({
  isOpen,
  onClose,
  theme,
  setTheme,
  onExportRun,
  onImportClick,
  onStartOver,
  logAction,
  buildInfo = null,
  updateInfo = null
}) {
  const [aboutModalOpen, setAboutModalOpen] = useState(false);

  const handleThemeToggle = (checked) => {
    const next = checked ? "dark" : "light";
    if (typeof logAction === "function") logAction("theme_toggle", { theme: next });
    setTheme(next);
  };

  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const content = (
    <>
      <div
        className="tools-drawer-backdrop"
        role="presentation"
        aria-hidden
        onClick={onClose}
        style={{ position: "fixed", inset: 0, zIndex: DRAWER_Z, background: "rgba(0,0,0,0.35)" }}
      />
      <div
        className="tools-drawer-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="tools-drawer-title"
        style={{
          position: "fixed",
          top: 0,
          right: 0,
          bottom: 0,
          width: "min(380px, 100vw)",
          zIndex: DRAWER_Z + 1,
          display: "flex",
          flexDirection: "column",
          overflow: "hidden"
        }}
      >
        <FocusTrap onClose={onClose} className="tools-drawer-focus-trap">
          <div className="tools-drawer-scroll-wrap" style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
            <div className="tools-drawer-inner" style={{ padding: 24, overflowY: "auto", overflowX: "hidden", flex: 1, minHeight: 0 }}>
            <div className="tools-drawer-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
              <h2 id="tools-drawer-title" className="card-title" style={{ margin: 0 }}>Tools</h2>
              <button type="button" className="ghost icon-button" onClick={onClose} aria-label="Close Tools">
                ✕
              </button>
            </div>
            <p className="subtle" style={{ marginTop: 0, marginBottom: 20 }}>
              Theme, run export/import, and start over. Background jobs and logs are on the{" "}
              <strong>Operations</strong> step in the sidebar.
            </p>

            <section className="card" style={{ marginBottom: 16 }}>
              <h3 className="card-title" style={{ marginTop: 0 }}>Appearance</h3>
              <OptionRow
                title="Dark mode"
                description="Use dark theme for the app. Preference is saved locally."
              >
                <Switch
                  checked={theme === "dark"}
                  onChange={handleThemeToggle}
                  aria-label="Dark mode"
                />
              </OptionRow>
            </section>

            <section className="card" style={{ marginBottom: 16 }}>
              <h3 className="card-title" style={{ marginTop: 0 }}>Run state</h3>
              <div className="tools-actions" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <Button variant="secondary" onClick={onExportRun}>
                  Export Run
                </Button>
                <Button variant="secondary" onClick={onImportClick}>
                  Import Run
                </Button>
              </div>
              <p className="note" style={{ marginTop: 12, marginBottom: 0 }}>
                Export saves your current selections and run state to a JSON file — save one before
                updating the app. Import restores from a previously exported file. Credentials are
                deliberately excluded and must be re-entered. This is not the generated bundle ZIP,
                and it does not back up job history, downloaded binaries or server data volumes.
              </p>
            </section>

            <section className="card" style={{ marginBottom: 16 }}>
              <h3 className="card-title" style={{ marginTop: 0 }}>Start over</h3>
              <p className="card-subtitle" style={{ marginTop: 0 }}>
                Clear all selections and return to the landing page.
              </p>
              <Button
                variant="destructive"
                onClick={() => {
                  onClose();
                  onStartOver();
                }}
              >
                Start Over
              </Button>
            </section>

            <section className="card tools-about-section">
              <div className="about-header">
                <h3 className="card-title">About</h3>
                <button
                  type="button"
                  className="ghost"
                  onClick={() => setAboutModalOpen(true)}
                >
                  View Details
                </button>
              </div>
              {buildInfo && (
                <div className="about-build-info">
                  {/* The version is always known (package.json). The revision is
                      known only when APP_GIT_SHA was supplied at build time, and
                      the branch only when APP_BRANCH was. A missing value is
                      reported as unavailable — it is never guessed, and the
                      branch in particular must NOT fall back to "main", which
                      previously asserted a branch nobody had supplied. */}
                  <span className="about-version">
                    {buildInfo.version && buildInfo.version !== "unknown"
                      ? `Version ${buildInfo.version}`
                      : "Version unavailable"}
                  </span>
                  <span className="about-separator">•</span>
                  <span className="about-revision">
                    {buildInfo.gitSha && buildInfo.gitSha !== "unknown"
                      ? `Revision ${buildInfo.gitSha.slice(0, 7)}`
                      : "Revision unavailable"}
                  </span>
                  {buildInfo.buildTime && buildInfo.buildTime !== "unknown" && (
                    <>
                      <span className="about-separator">•</span>
                      <span className="about-time">{buildInfo.buildTime}</span>
                    </>
                  )}
                  {buildInfo.branch && buildInfo.branch !== "unknown" && (
                    <>
                      <span className="about-separator">•</span>
                      <span className="about-branch">{buildInfo.branch}</span>
                    </>
                  )}
                </div>
              )}
              {updateInfo && (
                <div className="about-update-info">
                  {renderUpdateLine(updateInfo)}
                </div>
              )}
              <div className="about-reward-note">
                For Red Hatters feeling generous 🙂 I can be found on RewardZone: Bill Strauss
              </div>
            </section>
            </div>
          </div>
        </FocusTrap>
      </div>
    </>
  );

  return (
    <>
      {createPortal(content, document.body)}
      {aboutModalOpen && (
        <AboutModal
          isOpen={true}
          onClose={() => setAboutModalOpen(false)}
          appVersion={buildInfo?.version}
          gitSha={buildInfo?.gitSha}
          buildTime={buildInfo?.buildTime}
        />
      )}
    </>
  );
}
