/**
 * Tools drawer: right-side overlay (not a route). Dark mode, Operations, Export/Import Run, Start Over.
 * Portaled to document.body; backdrop + Escape close; focus trap.
 */
import React, { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import Switch from "./Switch.jsx";
import OptionRow from "./OptionRow.jsx";
import Button from "./Button.jsx";

const DRAWER_Z = 10060;

function FocusTrap({ children, onClose }) {
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

  return <div ref={ref}>{children}</div>;
}

export default function ToolsDrawer({
  isOpen,
  onClose,
  theme,
  setTheme,
  onExportRun,
  onImportClick,
  onStartOver,
  jobsCount = 0,
  onNavigateToOperations,
  isLocked,
  logAction
}) {
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
        <FocusTrap onClose={onClose}>
          <div className="tools-drawer-inner" style={{ padding: 24, overflow: "auto", flex: 1 }}>
            <div className="tools-drawer-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
              <h2 id="tools-drawer-title" className="card-title" style={{ margin: 0 }}>Tools</h2>
              <button type="button" className="ghost icon-button" onClick={onClose} aria-label="Close Tools">
                ✕
              </button>
            </div>
            <p className="subtle" style={{ marginTop: 0, marginBottom: 20 }}>
              Theme, run export/import, start over, and operations.
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
                Export saves your current selections and run state to a JSON file. Import restores from a previously exported file.
              </p>
            </section>

            <section className="card" style={{ marginBottom: 16 }}>
              <h3 className="card-title" style={{ marginTop: 0 }}>Operations</h3>
              <p className="card-subtitle" style={{ marginTop: 0 }}>
                Background jobs (e.g. operator catalog scans) and logs.
              </p>
              {isLocked ? (
                <Button
                  variant="primary"
                  onClick={() => {
                    onClose();
                    onNavigateToOperations();
                  }}
                >
                  {jobsCount > 0 ? `Open Operations (${jobsCount})` : "Open Operations"}
                </Button>
              ) : (
                <p className="note subtle" style={{ marginBottom: 0 }}>
                  Available after lock-in. Lock your foundational selections on the Blueprint step to continue.
                </p>
              )}
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

            <section className="card" style={{ marginBottom: 0 }}>
              <h3 className="card-title" style={{ marginTop: 0 }}>About</h3>
              <p className="card-subtitle" style={{ marginTop: 0, marginBottom: 8 }}>
                Designed and maintained by Bill Strauss.
              </p>
              <p className="note" style={{ marginTop: 0, marginBottom: 8 }}>
                Reach out via{" "}
                <a href="https://github.com/bstrauss84/openshift-airgap-architect" target="_blank" rel="noopener noreferrer">
                  GitHub
                </a>{" "}
                (Issues or Discussions). Contributions welcome.
              </p>
              <p className="note subtle" style={{ marginBottom: 0 }}>
                For Red Hatters feeling generous 🙂 I can be found on RewardZone: Bill Strauss
              </p>
            </section>
          </div>
        </FocusTrap>
      </div>
    </>
  );

  return createPortal(content, document.body);
}
