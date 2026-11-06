/**
 * OpenShift Airgap Architect - Scoped confirmation dialog (v2.3.0, RFC §18.2)
 *
 * One confirmation for every destructive or scope-changing action (Start new
 * Install, delete an Upgrade plan, delete a Mirroring profile). It always says
 * what will be removed AND what will be kept, and which running work is or is
 * not affected — so the scope is clear before the user confirms. The content
 * comes from the caller (normally a server preview), never from guesses.
 *
 * Built on Modal (focus trap, Escape, backdrop) and Button; initial focus is on
 * Cancel. No secret value is ever passed in.
 *
 * Developed with AI assistance from Claude (Anthropic).
 */
import React, { useEffect } from "react";
import Modal from "./Modal.jsx";
import Button from "./Button.jsx";

const List = ({ items }) => (items?.length ? (
  <ul className="scoped-confirm-list">
    {items.map((item, i) => <li key={typeof item === "string" ? item : i}>{item}</li>)}
  </ul>
) : null);

export default function ScopedConfirmModal({
  isOpen,
  onClose,
  id,
  title,
  intro = null,
  removed = [],
  kept = [],
  affected = [],
  unaffected = [],
  notes = [],
  children = null,
  loading = false,
  error = null,
  confirmLabel,
  confirmVariant = "destructive",
  confirmDisabled = false,
  busy = false,
  onConfirm
}) {
  // Initial focus on Cancel: the safe choice is the default one.
  useEffect(() => {
    if (!isOpen) return undefined;
    const t = setTimeout(() => document.getElementById(`${id}-cancel`)?.focus(), 0);
    return () => clearTimeout(t);
  }, [isOpen, id]);
  const titleId = `${id}-title`;
  const descId = `${id}-desc`;
  return (
    <Modal isOpen={isOpen} onClose={busy ? () => {} : onClose} ariaLabelledBy={titleId} className="modal scoped-confirm">
      <h3 id={titleId}>{title}</h3>
      <div id={descId}>
        {intro ? <p className="modal-copy">{intro}</p> : null}
        {loading ? <div className="note subtle" role="status">Checking what this would affect…</div> : null}
        {error ? <div className="note warning" role="alert">{error}</div> : null}
        {!loading && removed.length ? (
          <section className="scoped-confirm-section" aria-label="Will be removed">
            <h4 className="scoped-confirm-heading">Will be removed</h4>
            <List items={removed} />
          </section>
        ) : null}
        {!loading && kept.length ? (
          <section className="scoped-confirm-section" aria-label="Will be kept">
            <h4 className="scoped-confirm-heading">Will be kept</h4>
            <List items={kept} />
          </section>
        ) : null}
        {!loading && affected.length ? (
          <section className="scoped-confirm-section" aria-label="Running work affected">
            <h4 className="scoped-confirm-heading">Running work that will be stopped</h4>
            <List items={affected} />
          </section>
        ) : null}
        {!loading && unaffected.length ? (
          <section className="scoped-confirm-section" aria-label="Running work not affected">
            <h4 className="scoped-confirm-heading">Running work that is not affected</h4>
            <List items={unaffected} />
          </section>
        ) : null}
        {children}
        {notes.map((n) => <p key={n} className="modal-copy subtle">{n}</p>)}
      </div>
      <div className="actions">
        <Button variant="secondary" id={`${id}-cancel`} onClick={onClose} disabled={busy}>Cancel</Button>
        <Button variant={confirmVariant} onClick={onConfirm} disabled={loading || busy || confirmDisabled || Boolean(error && !onConfirm)}>{busy ? "Working…" : confirmLabel}</Button>
      </div>
    </Modal>
  );
}
