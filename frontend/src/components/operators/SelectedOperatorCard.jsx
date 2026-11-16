/**
 * OpenShift Airgap Architect - one selected operator (v2.2.0 M3)
 *
 * The card both workflows show in their Selected list. Display name leads,
 * the canonical package name follows, then the default channel. An entry kept
 * as intent across a catalog-minor change (no resolved channel yet) says so
 * in words rather than presenting a fabricated channel.
 *
 * @author Bill Strauss
 *
 * Developed with AI assistance from Claude (Anthropic).
 */
import React from "react";
import Button from "../Button.jsx";
import { isOperatorResolved } from "../../shared/operatorMinorReconciliation.js";

const SelectedOperatorCard = ({ op, onRemove, unresolvedNote = null, verificationNote = null }) => {
  const resolved = isOperatorResolved(op);
  return (
    <div className={`selected-card${resolved ? "" : " selected-card-unresolved"}`} data-operator-resolved={resolved ? "true" : "false"}>
      <div className="operator-name">{op.displayName || op.name}</div>
      {op.displayName ? <div className="subtle">Package: {op.name}</div> : null}
      <div className="subtle">Default channel: {op.defaultChannel || "unknown"}</div>
      {!resolved && unresolvedNote ? <div className="selected-card-note">{unresolvedNote}</div> : null}
      {resolved && verificationNote ? <div className="subtle selected-card-verification">{verificationNote}</div> : null}
      {/* Compact, left-aligned secondary control (owner M3 feedback): never a full-width bar. */}
      <Button variant="secondary" className="mini selected-card-remove" onClick={() => onRemove(op.id)} aria-label={`Remove ${op.displayName || op.name}`}>Remove</Button>
    </div>
  );
};

export default SelectedOperatorCard;
