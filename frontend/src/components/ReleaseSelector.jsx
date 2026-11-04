/**
 * OpenShift Airgap Architect - OpenShift release selector (v2.2.0 M2)
 *
 * The "OpenShift release" card shared by the Install Blueprint and a Mirroring
 * profile. Presentation only: all selection state and Cincinnati behaviour come
 * from `useOpenShiftRelease`, passed in as `selection`. Workflow-specific
 * controls (Install's "Change release", Mirroring's Lock/Unlock) and the
 * footer note are supplied by the host through `headerActions` and `footer`.
 *
 * @author Bill Strauss
 *
 * Developed with AI assistance from Claude (Anthropic).
 */
import React from "react";
import Button from "./Button.jsx";
import FieldLabelWithInfo from "./FieldLabelWithInfo.jsx";
import { SUPPORTED_MINORS, getNewestSupportedMinor } from "../shared/versionPolicy.js";

/* Examples are DERIVED from the supported-minor policy, never hardcoded
   (docs/VERSIONED_COPY_INVENTORY.md). Every minor has a ".0" GA release, so
   the patch example is always a real release. */
const EXAMPLE_MINOR = getNewestSupportedMinor();
const EXAMPLE_PATCH = `${EXAMPLE_MINOR}.0`;

const MINOR_CHANNEL_HINT = `The OpenShift minor release stream, shown as its Red Hat update channel (for example stable-${EXAMPLE_MINOR}).

**What it controls:**
The exact patch releases offered in Patch version come from the Red Hat OpenShift Update Service (Cincinnati) for this channel.

**Which minors appear:**
Only minors this version of OpenShift Airgap Architect supports are listed. Newer minors that already exist upstream are reported in a notice above the selectors and are never selected for you.

**When to choose a different minor:**
• Installing: the minor your new cluster will run.
• Mirroring: the minor whose release payload you need on the disconnected (high) side.

**Important notes:**
• Changing the channel clears the selected patch until the new list loads.
• ⚠️ A locked release cannot be changed here. Unlock it first (Install: Change release; Mirroring: Unlock release).`;

const PATCH_VERSION_HINT = `The exact OpenShift release (z-stream), for example ${EXAMPLE_PATCH}.

**Why it matters:**
This exact release payload is what gets installed or mirrored. A disconnected cluster can only install or update to releases whose images were mirrored to it.

**How the list is built:**
Newest first, from the Update Service for the selected channel. Use Update to refresh the list from Red Hat.

**Low side vs high side:**
Choose the release on the connected (low) side, where the Update Service is reachable. The disconnected (high) side cannot refresh this list.

**Important notes:**
• ⚠️ Pick a release that Red Hat lists in a stable channel; candidate and fast releases are not offered here.
• Once locked, refreshed data never changes the selected release.`;

const MANUAL_MINOR_HINT = `Type an OpenShift minor when the Update Service list is empty or unreachable, for example ${EXAMPLE_MINOR}.

**When to use:**
Only when the channel list cannot be loaded, or does not match the release you have verified for your environment.

**Requirements:**
The minor must be one this tool supports. Unsupported minors are rejected; nothing is substituted.

**Example:**
${EXAMPLE_MINOR}`;

const MANUAL_PATCH_HINT = `Type the exact OpenShift release that belongs to the minor above, for example ${EXAMPLE_PATCH}.

**Why verify it:**
A manually entered release is not checked against the Update Service. Confirm it exists in the openshift/cincinnati-graph-data channels before you lock it.

**Requirements:**
Its minor must match the Minor field.

**Example:**
${EXAMPLE_PATCH}`;

/**
 * @param {object}   props
 * @param {object}   props.selection     return value of useOpenShiftRelease
 * @param {object}   props.release       the workflow's release object
 * @param {string}   props.idPrefix      prefix for DOM ids / test ids ("blueprint", "mirroring")
 * @param {React.ReactNode} [props.headerActions] workflow-specific buttons beside Update
 * @param {React.ReactNode} [props.footer]        workflow-specific note under the selectors
 * @param {string}   [props.title]
 */
const ReleaseSelector = ({ selection, release, idPrefix, headerActions = null, footer = null, title = "OpenShift release" }) => {
  const {
    channels, newerUnsupportedChannels, patches, loading, patchesLoading, refreshing, refreshNote,
    updatedMessage, refreshError, manualMinor, setManualMinor, manualPatch, setManualPatch,
    manualApplyError, setAdvancedOpen, updateChannel, updatePatch, refresh, applyManualRelease,
    locked: releaseLocked
  } = selection;

  return (
    <section className="card release-selector">
      <div className="card-header release-selector-header">
        <h3 style={{ margin: 0 }}>{title}</h3>
        <div className="release-selector-actions">
          <div className="release-selector-buttons">
            {headerActions}
            <Button variant="secondary" onClick={refresh} disabled={releaseLocked || refreshing}>
              Update
            </Button>
          </div>
          {((refreshing && refreshNote) || updatedMessage) && (
            <span className="subtle release-selector-status" role="status">
              {refreshing && refreshNote ? refreshNote : "Channels updated."}
            </span>
          )}
        </div>
      </div>
      {refreshError ? (
        <div className="note release-selector-error" role="alert">
          {refreshError}
        </div>
      ) : null}
      {newerUnsupportedChannels.length > 0 ? (
        <div className="note warning" style={{ marginBottom: 12 }} role="alert">
          ⚠️ OpenShift {newerUnsupportedChannels.join(", ")} {newerUnsupportedChannels.length === 1 ? "is" : "are"} available upstream but not yet supported by this version of OpenShift Airgap Architect.
          {" "}Supported versions: {SUPPORTED_MINORS.join(", ")}
        </div>
      ) : null}
      <div className="field-grid release-selector-grid">
        <FieldLabelWithInfo label="Minor channel" hint={MINOR_CHANNEL_HINT} className="label-emphasis">
          <select
            id={`${idPrefix}-release-channel`}
            aria-label="Minor channel"
            value={release?.channel ?? ""}
            disabled={releaseLocked}
            onChange={(e) => updateChannel(e.target.value || null)}
          >
            <option value="" disabled>Select channel</option>
            {release?.channel && !channels.includes(release.channel) ? (
              <option key={`manual-ch-${release.channel}`} value={release.channel}>
                stable-{release.channel} (manual)
              </option>
            ) : null}
            {channels.map((ch) => (
              <option key={ch} value={ch}>stable-{ch}</option>
            ))}
          </select>
        </FieldLabelWithInfo>
        <FieldLabelWithInfo label="Patch version" hint={PATCH_VERSION_HINT} className="label-emphasis">
          <select
            id={`${idPrefix}-release-patch`}
            aria-label="Patch version"
            value={release?.patchVersion ?? ""}
            disabled={releaseLocked || patchesLoading || !release?.channel}
            onChange={(e) => updatePatch(e.target.value || null)}
          >
            <option value="" disabled>Select patch</option>
            {release?.patchVersion && !patches.includes(release.patchVersion) ? (
              <option key={`manual-pv-${release.patchVersion}`} value={release.patchVersion}>
                {release.patchVersion} (manual)
              </option>
            ) : null}
            {patches.map((p) => (
              <option key={p} value={p}>{p}</option>
            ))}
          </select>
        </FieldLabelWithInfo>
      </div>
      {loading ? <div className="loading" role="status">Loading channels…</div> : null}
      {patchesLoading && release?.channel ? <div className="loading" role="status">Loading patches…</div> : null}
      <details
        className="subtle"
        style={{ marginTop: 12, marginBottom: 8 }}
        onToggle={(e) => setAdvancedOpen(e.target.open)}
      >
        <summary style={{ cursor: "pointer", fontWeight: 600 }}>Advanced: set release manually</summary>
        <p className="note" style={{ marginTop: 10, marginBottom: 8 }}>
          Use only when Cincinnati lists are empty or wrong for your environment. Verify versions against the{" "}
          <a
            href="https://github.com/openshift/cincinnati-graph-data/tree/master/channels"
            target="_blank"
            rel="noreferrer"
          >
            openshift/cincinnati-graph-data channels
          </a>{" "}
          tree for your disconnected reality before locking the release.
        </p>
        <div className="field-grid release-selector-manual-grid">
          <FieldLabelWithInfo label={`Minor (e.g. ${EXAMPLE_MINOR})`} hint={MANUAL_MINOR_HINT} className="label-emphasis">
            <input
              type="text"
              id={`${idPrefix}-manual-minor`}
              data-testid={`${idPrefix}-manual-minor`}
              aria-label={`Minor (e.g. ${EXAMPLE_MINOR})`}
              value={manualMinor}
              disabled={releaseLocked}
              onChange={(e) => setManualMinor(e.target.value)}
              placeholder={EXAMPLE_MINOR}
              autoComplete="off"
            />
          </FieldLabelWithInfo>
          <FieldLabelWithInfo label={`Patch (e.g. ${EXAMPLE_PATCH})`} hint={MANUAL_PATCH_HINT} className="label-emphasis">
            <input
              type="text"
              id={`${idPrefix}-manual-patch`}
              data-testid={`${idPrefix}-manual-patch`}
              aria-label={`Patch (e.g. ${EXAMPLE_PATCH})`}
              value={manualPatch}
              disabled={releaseLocked}
              onChange={(e) => setManualPatch(e.target.value)}
              placeholder={EXAMPLE_PATCH}
              autoComplete="off"
            />
          </FieldLabelWithInfo>
          <Button variant="primary" data-testid={`${idPrefix}-manual-apply`} onClick={applyManualRelease} disabled={releaseLocked}>
            Apply
          </Button>
        </div>
        {manualApplyError ? (
          <div className="note release-selector-error" style={{ marginTop: 8 }} role="alert">
            {manualApplyError}
          </div>
        ) : null}
      </details>
      {footer}
    </section>
  );
};

export default ReleaseSelector;
