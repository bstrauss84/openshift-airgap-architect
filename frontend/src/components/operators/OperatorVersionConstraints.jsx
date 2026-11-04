/**
 * OpenShift Airgap Architect - per-operator version constraints (v2.2.0 M3)
 *
 * The optional minVersion / maxVersion editor the Install Operators step has
 * always offered, extracted so Mirroring profiles use the same fields and help.
 * The host owns the values and decides when to save (`onChange(id, patch)`).
 *
 * Help corrected while extracting: the old text said the values are written to
 * `…channels[].includeConfig.minVersion`. `includeConfig` is a Go type name,
 * never a YAML key (FQ-9); the generator writes minVersion / maxVersion
 * directly on the channel, which is what oc-mirror v2 accepts.
 *
 * @author Bill Strauss
 *
 * Developed with AI assistance from Claude (Anthropic).
 */
import React from "react";
import FieldLabelWithInfo from "../FieldLabelWithInfo.jsx";

const minHint = (name) => `Minimum operator version to mirror for ${name}.

**What is this:**
The lowest operator bundle version to include from this operator's default channel. Every version from minVersion up to maxVersion is mirrored.

**When needed:**
Optional. Use it to leave out older operator versions you will never install (for example, only 1.5.0 and newer).

**Format:**
The operator's own version string, usually MAJOR.MINOR.PATCH (for example 1.5.0).

**How it's used:**
Written on the channel in imageset-config.yaml, as mirror.operators[].packages[].channels[].minVersion. oc-mirror then mirrors only bundles at or above it.

**Important:**
⚠️ The version must exist in the channel; if nothing matches, mirroring fails.
⚠️ These are operator versions, not OpenShift versions.

**Example:**
web-terminal in channel fast: minVersion 1.9.0`;

const maxHint = (name) => `Maximum operator version to mirror for ${name}.

**What is this:**
The highest operator bundle version to include from this operator's default channel.

**When needed:**
Optional. Use it to hold back newer operator versions you have not tested.

**Format:**
The operator's own version string, usually MAJOR.MINOR.PATCH (for example 2.5.0).

**How it's used:**
Written on the channel in imageset-config.yaml, as mirror.operators[].packages[].channels[].maxVersion.

**Important:**
⚠️ The version must exist in the channel; if nothing matches, mirroring fails.
⚠️ maxVersion must not be lower than minVersion.

**Example:**
argocd-operator in channel alpha: maxVersion 0.12.0`;

const OperatorVersionConstraints = ({ selected, onChange }) => (
  <div className="operator-constraints-list">
    {selected.map((op) => (
      <div key={op.id} className="operator-constraints-item">
        <div className="operator-constraints-name">{op.displayName || op.name}</div>
        <div className="subtle" style={{ marginBottom: "1rem" }}>
          Channel: {op.defaultChannel || "unknown"}
        </div>
        <div className="operator-constraints-grid">
          <FieldLabelWithInfo label="Min version (optional)" hint={minHint(op.name)}>
            <input
              type="text"
              value={op.minVersion || ""}
              onChange={(e) => onChange(op.id, { minVersion: e.target.value.trim() || undefined })}
              placeholder="e.g. 1.5.0"
              style={{ width: "100%" }}
            />
          </FieldLabelWithInfo>
          <FieldLabelWithInfo label="Max version (optional)" hint={maxHint(op.name)}>
            <input
              type="text"
              value={op.maxVersion || ""}
              onChange={(e) => onChange(op.id, { maxVersion: e.target.value.trim() || undefined })}
              placeholder="e.g. 2.5.0"
              style={{ width: "100%" }}
            />
          </FieldLabelWithInfo>
        </div>
      </div>
    ))}
  </div>
);

export default OperatorVersionConstraints;
