import React, { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Button from "./Button.jsx";
import { getFeedbackChallenge, submitFeedback } from "../feedbackApi.js";

const DRAWER_Z = 10070;

function FocusTrap({ children, onClose }) {
  const ref = useRef(null);

  useEffect(() => {
    if (!ref.current) return;
    const root = ref.current;
    const focusable = root.querySelectorAll(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (first) first.focus();

    const onKeyDown = (e) => {
      if (e.key === "Escape") {
        onClose();
        return;
      }
      if (e.key !== "Tab") return;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last?.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first?.focus();
      }
    };

    root.addEventListener("keydown", onKeyDown);
    return () => root.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return <div ref={ref}>{children}</div>;
}

const EMPTY_FORM = {
  category: "other",
  severity: "medium",
  summary: "",
  details: "",
  contactRequested: false,
  contactHandle: ""
};

const CATEGORY_LABELS = {
  bug: "Bug report",
  docs: "Documentation",
  ux: "UX / usability",
  request: "Feature request",
  security: "Security",
  other: "General feedback"
};

function downloadHandoffJson(handoff) {
  const content = JSON.stringify(handoff, null, 2);
  const blob = new Blob([content], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `feedback-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

async function copyTextToClipboard(text) {
  if (!text) return false;
  try {
    if (navigator?.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // fallback below
  }
  try {
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "true");
    area.style.position = "absolute";
    area.style.left = "-9999px";
    document.body.appendChild(area);
    area.select();
    const copied = document.execCommand("copy");
    document.body.removeChild(area);
    return copied;
  } catch {
    return false;
  }
}

export default function FeedbackDrawer({
  isOpen,
  onClose,
  config,
  uiContext = "",
  scenarioContext = {}
}) {
  const [form, setForm] = useState(EMPTY_FORM);
  const [challengeToken, setChallengeToken] = useState("");
  const [loadingChallenge, setLoadingChallenge] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  const categoryOptions = config?.enums?.categories || [
    "bug",
    "docs",
    "ux",
    "request",
    "security",
    "other"
  ];
  const severityOptions = config?.enums?.severities || [
    "low",
    "medium",
    "high",
    "critical"
  ];

  const limits = config?.limits || {};
  const summaryLimit = limits.summaryMaxChars || 200;
  const detailsLimit = limits.detailsMaxChars || 4000;
  const contactLimit = limits.contactMaxChars || 200;

  const isOfflineMode = config?.mode === "offline";
  const enabled = Boolean(config?.enabled);

  const detailsRemaining = useMemo(
    () => detailsLimit - form.details.length,
    [detailsLimit, form.details.length]
  );

  useEffect(() => {
    if (!isOpen || !enabled) return;
    setLoadingChallenge(true);
    setError("");
    getFeedbackChallenge()
      .then((data) => {
        setChallengeToken(data.token || "");
      })
      .catch((err) => {
        setError(String(err?.message || err));
        setChallengeToken("");
      })
      .finally(() => setLoadingChallenge(false));
  }, [isOpen, enabled]);

  useEffect(() => {
    if (!isOpen) {
      setForm(EMPTY_FORM);
      setResult(null);
      setError("");
      setSubmitting(false);
      setLoadingChallenge(false);
      setChallengeToken("");
      setCopied(false);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!enabled) return;
    setSubmitting(true);
    setError("");
    setResult(null);
    try {
      const response = await submitFeedback({
        ...form,
        honeypot: "",
        challengeToken,
        uiContext,
        scenarioContext
      });
      setResult(response);
    } catch (err) {
      setError(String(err?.message || err));
    } finally {
      setSubmitting(false);
    }
  };

  const copyIssueBody = async () => {
    const ok = await copyTextToClipboard(result?.issueDraft?.markdown || "");
    setCopied(ok);
    if (!ok) setError("Could not copy markdown automatically. Copy from preview text.");
  };

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
        aria-labelledby="feedback-drawer-title"
        style={{
          position: "fixed",
          top: 0,
          right: 0,
          bottom: 0,
          width: "min(420px, 100vw)",
          zIndex: DRAWER_Z + 1,
          display: "flex",
          flexDirection: "column",
          overflow: "hidden"
        }}
      >
        <FocusTrap onClose={onClose}>
          <div style={{ padding: 24, overflowY: "auto", minHeight: 0, flex: 1 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
              <h2 id="feedback-drawer-title" className="card-title" style={{ margin: 0 }}>
                Feedback
              </h2>
              <button type="button" className="ghost icon-button" onClick={onClose} aria-label="Close Feedback">
                ✕
              </button>
            </div>

            {!enabled ? (
              <div className="note warning">{config?.reason || "Feedback is unavailable."}</div>
            ) : (
              <form onSubmit={handleSubmit}>
                <p className="subtle" style={{ marginTop: 0 }}>
                  Share product feedback. Do not include secrets, credentials, or private keys.
                </p>
                {isOfflineMode ? (
                  <div className="note">
                    This instance is in offline feedback mode. A markdown issue draft and JSON handoff are generated locally.
                  </div>
                ) : null}
                {loadingChallenge ? (
                  <div className="note subtle">Preparing anti-abuse challenge…</div>
                ) : null}
                {error ? <div className="note warning">{error}</div> : null}
                {result?.ok ? (
                  <div className="note">
                    Issue draft ready.
                    {result?.githubIssueUrl
                      ? " Use Open GitHub Issue, or copy markdown if needed."
                      : " GitHub URL unavailable; copy markdown and paste it manually."}
                  </div>
                ) : null}
                {copied ? <div className="note">Issue markdown copied to clipboard.</div> : null}

                <label>
                  Category
                  <select
                    value={form.category}
                    onChange={(e) => setForm((prev) => ({ ...prev, category: e.target.value }))}
                  >
                    {categoryOptions.map((c) => (
                      <option key={c} value={c}>
                        {CATEGORY_LABELS[c] || c}
                      </option>
                    ))}
                  </select>
                </label>

                <label>
                  Severity
                  <select
                    value={form.severity}
                    onChange={(e) => setForm((prev) => ({ ...prev, severity: e.target.value }))}
                  >
                    {severityOptions.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                </label>

                <label>
                  Summary
                  <input
                    type="text"
                    value={form.summary}
                    maxLength={summaryLimit}
                    required
                    onChange={(e) => setForm((prev) => ({ ...prev, summary: e.target.value }))}
                  />
                </label>

                <label>
                  Details
                  <textarea
                    rows={8}
                    value={form.details}
                    maxLength={detailsLimit}
                    required
                    onChange={(e) => setForm((prev) => ({ ...prev, details: e.target.value }))}
                  />
                </label>
                <div className="subtle" style={{ marginTop: 4, marginBottom: 12 }}>
                  {detailsRemaining} characters remaining
                </div>

                <label className="toggle" style={{ marginBottom: 8 }}>
                  <input
                    type="checkbox"
                    checked={form.contactRequested}
                    onChange={(e) =>
                      setForm((prev) => ({ ...prev, contactRequested: e.target.checked }))
                    }
                  />
                  Contact me about this feedback
                </label>

                {form.contactRequested ? (
                  <label>
                    Contact handle (optional)
                    <input
                      type="text"
                      value={form.contactHandle}
                      maxLength={contactLimit}
                      onChange={(e) =>
                        setForm((prev) => ({ ...prev, contactHandle: e.target.value }))
                      }
                    />
                  </label>
                ) : null}

                {/* Honeypot field for simple bot mitigation: intentionally hidden from real users. */}
                <input
                  type="text"
                  name="company"
                  autoComplete="off"
                  tabIndex={-1}
                  style={{ display: "none" }}
                  value=""
                  onChange={() => {}}
                />

                <div className="actions" style={{ marginTop: 16 }}>
                  <Button variant="secondary" type="button" onClick={onClose}>
                    Close
                  </Button>
                  {result?.ok ? (
                    <>
                      <Button
                        variant="secondary"
                        type="button"
                        onClick={copyIssueBody}
                      >
                        Copy issue markdown
                      </Button>
                      {result?.handoff ? (
                        <Button
                          variant="secondary"
                          type="button"
                          onClick={() => downloadHandoffJson(result.handoff)}
                        >
                          Download issue JSON
                        </Button>
                      ) : null}
                      {result?.githubIssueUrl ? (
                        <a
                          href={result.githubIssueUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="primary"
                        >
                          Open GitHub issue
                        </a>
                      ) : null}
                    </>
                  ) : null}
                  <Button
                    variant="primary"
                    type="submit"
                    disabled={submitting || loadingChallenge || !challengeToken}
                  >
                    {submitting ? "Generating..." : "Generate issue draft"}
                  </Button>
                </div>
                {result?.issueDraft?.markdown ? (
                  <pre className="preview" style={{ marginTop: 12 }}>
                    {result.issueDraft.markdown}
                  </pre>
                ) : null}
              </form>
            )}
          </div>
        </FocusTrap>
      </div>
    </>
  );

  return createPortal(content, document.body);
}
